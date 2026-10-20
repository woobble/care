import { and, asc, count, desc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';

import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import {
  assertCan,
  AuthorizationDeniedError,
  can,
  type AuthorizationPrincipal,
  type Permission,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

import { taskActivity, tasks } from '@module/operations/schema';

import { validateOperationsAssignee } from './operations-guards';

import type {
  TaskStatus,
  OperationsSourceReference,
  OperationsTaskInput,
  OperationsTaskPatch,
  OperationsTaskListQuery,
} from './task.contracts';
import {
  InvalidOperationsInputError,
  OperationsTaskNotFoundError,
  OperationsTaskVersionConflictError,
  OperationsTaskStateError,
} from './task.errors';
import { hasGrant, bounded, displayNameWithoutIdentifiers } from './operations-helpers';
import {
  validTaskInput,
  validPatch,
  normalizeOptional,
  escapeLike,
  taskResource,
  sourcePermission,
  sourceColumnsFor,
  sourceIdFromRow,
} from './task-rules';
import type { OperationsTaskData } from './tasks.ports';

type AuditContext = { ip?: string; userAgent?: string };

/** Internal task lifecycle and queries; callers continue through the Operations facade. */
export class OperationsTasksApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly taskData: OperationsTaskData,
  ) {}

  async createTask(
    principal: AuthorizationPrincipal,
    input: OperationsTaskInput,
    request: RequestContext,
    auditContext: AuditContext,
    sourceDeadlineKey: string | null = null,
  ) {
    if (!validTaskInput(input)) throw new InvalidOperationsInputError();
    const sourceContext = input.source
      ? await this.taskData.validateSource(principal, input.source)
      : null;
    const referencedClientContext = input.clientId
      ? await this.taskData.clientContext(principal, input.clientId)
      : sourceContext?.clientId
        ? await this.taskData.clientContext(principal, sourceContext.clientId)
        : null;
    const organizationId =
      input.organizationId ??
      sourceContext?.organizationId ??
      referencedClientContext?.organizationId;
    if (!organizationId) throw new InvalidOperationsInputError();
    if (
      (sourceContext && sourceContext.organizationId !== organizationId) ||
      (referencedClientContext && referencedClientContext.organizationId !== organizationId)
    ) {
      throw new InvalidOperationsInputError();
    }
    const derivedFacilityId = sourceContext
      ? sourceContext.facilityId
      : (referencedClientContext?.facilityId ?? null);
    const facilityId = input.facilityId === undefined ? derivedFacilityId : input.facilityId;
    if (
      input.facilityId !== undefined &&
      ((sourceContext?.facilityId && sourceContext.facilityId !== input.facilityId) ||
        (!sourceContext &&
          referencedClientContext?.facilityId &&
          referencedClientContext.facilityId !== input.facilityId))
    ) {
      throw new InvalidOperationsInputError();
    }
    const clientId =
      input.clientId === undefined ? (sourceContext?.clientId ?? null) : input.clientId;
    if (
      sourceContext &&
      (sourceContext.facilityId !== facilityId ||
        (sourceContext.clientId && sourceContext.clientId !== clientId))
    ) {
      throw new InvalidOperationsInputError();
    }
    const resource = {
      tenantId: principal.tenantId,
      organizationId,
      ...(facilityId ? { facilityId } : {}),
      ...(clientId ? { clientId } : {}),
    };
    assertCan(principal, { action: 'operations.tasks.create', resource });
    await this.taskData.assertTaskScope(resource);
    if (input.assignedEmployeeId) {
      assertCan(principal, { action: 'operations.tasks.assign', resource });
    }

    const now = new Date();
    const id = uuidv7();
    const sourceColumns = sourceColumnsFor(input.source ?? null);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      if (sourceDeadlineKey) {
        await transaction.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`operations-deadline-task:${principal.tenantId}:${sourceDeadlineKey}`}, 0))`,
        );
        const [existing] = await transaction
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.tenantId, principal.tenantId),
              eq(tasks.sourceDeadlineKey, sourceDeadlineKey),
            ),
          )
          .limit(1);
        if (existing) return this.taskView(principal, existing);
      }
      if (input.assignedEmployeeId) {
        await this.validateAssignee(
          transaction,
          principal.tenantId,
          input.assignedEmployeeId,
          organizationId,
          facilityId,
        );
      }
      const [task] = await transaction
        .insert(tasks)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId,
          facilityId,
          clientId,
          title: input.title.trim(),
          description: normalizeOptional(input.description),
          status: 'open',
          priority: input.priority ?? 'normal',
          assignedEmployeeId: input.assignedEmployeeId ?? null,
          createdByUserId: principal.userId,
          completedByUserId: null,
          dueAt: input.dueAt ?? null,
          completedAt: null,
          sourceType: input.source?.type ?? null,
          ...sourceColumns,
          sourceDeadlineKey,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.addActivity(transaction, principal, task!, 'created', {
        status: 'open',
        priority: task!.priority,
      });
      if (task!.assignedEmployeeId) {
        await this.addActivity(transaction, principal, task!, 'assigned', {
          employeeId: task!.assignedEmployeeId,
        });
      }
      await this.recordStateChange(transaction, principal, request, auditContext, {
        type: 'operations.task_created',
        action: 'operations.task_created',
        aggregateId: id,
        payload: { taskId: id, organizationId, clientId },
        metadata: { taskId: id, organizationId, clientId },
      });
      if (task!.assignedEmployeeId) {
        await this.recordStateChange(transaction, principal, request, auditContext, {
          type: 'operations.task_assigned',
          action: 'operations.task_assigned',
          aggregateId: id,
          payload: { taskId: id, employeeId: task!.assignedEmployeeId },
          metadata: { taskId: id },
        });
      }
      return this.taskView(principal, task!);
    });
  }

  async getTask(principal: AuthorizationPrincipal, taskId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.read');
      return this.taskView(principal, task);
    });
  }

  async patchTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    input: OperationsTaskPatch,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.updateTask(principal, taskId, input, request, auditContext);
  }

  async startTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(
      principal,
      taskId,
      expectedVersion,
      'in_progress',
      request,
      auditContext,
    );
  }

  async completeTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(
      principal,
      taskId,
      expectedVersion,
      'completed',
      request,
      auditContext,
    );
  }

  async reopenTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(principal, taskId, expectedVersion, 'open', request, auditContext);
  }

  async cancelTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(
      principal,
      taskId,
      expectedVersion,
      'cancelled',
      request,
      auditContext,
    );
  }

  async addComment(
    principal: AuthorizationPrincipal,
    taskId: string,
    comment: string,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const normalized = comment.trim();
    if (normalized.length < 1 || normalized.length > 4000) throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.tasks.manage');
      const now = new Date();
      await transaction.insert(taskActivity).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        taskId: task.id,
        actorUserId: principal.userId,
        kind: 'comment',
        details: {},
        comment: normalized,
        occurredAt: now,
      });
      await this.recordAudit(transaction, principal, request, auditContext, {
        action: 'operations.task_comment_added',
        resourceId: task.id,
        metadata: { taskId: task.id },
      });
      return { added: true, occurredAt: now.toISOString() };
    });
  }

  async listTasks(principal: AuthorizationPrincipal, query: OperationsTaskListQuery = {}) {
    requireTaskGrant(principal, 'operations.read');
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 25, 1, 100);
    if (query.assignedEmployeeId) requireTaskGrant(principal, 'operations.tasks.assign');
    const scopeConditions = this.taskScopeConditions(principal);
    if (scopeConditions && !scopeConditions.length) return { items: [], page, pageSize, total: 0 };
    const conditions: SQL[] = [eq(tasks.tenantId, principal.tenantId), ...(scopeConditions ?? [])];
    if (query.organizationId) conditions.push(eq(tasks.organizationId, query.organizationId));
    if (query.facilityId) conditions.push(eq(tasks.facilityId, query.facilityId));
    if (query.clientId) conditions.push(eq(tasks.clientId, query.clientId));
    if (query.sourceTypes) {
      if (!query.sourceTypes.length) return { items: [], page, pageSize, total: 0 };
      conditions.push(inArray(tasks.sourceType, query.sourceTypes));
    }
    if (query.status) conditions.push(eq(tasks.status, query.status));
    if (query.priority) conditions.push(eq(tasks.priority, query.priority));
    if (query.assignedEmployeeId)
      conditions.push(eq(tasks.assignedEmployeeId, query.assignedEmployeeId));
    if (query.assignedToMe) {
      const employeeId = await this.taskData.employeeForUser(principal.tenantId, principal.userId);
      if (!employeeId) return { items: [], page, pageSize, total: 0 };
      conditions.push(eq(tasks.assignedEmployeeId, employeeId));
    }
    if (query.search?.trim()) {
      const pattern = `%${escapeLike(query.search.trim())}%`;
      const matchingClientName = this.taskData.matchingClientName(pattern);
      conditions.push(
        or(ilike(tasks.title, pattern), ilike(tasks.description, pattern), matchingClientName)!,
      );
    }
    const now = new Date();
    const { dueDate: localDueDate, today: localToday } = this.taskData.dueLocalDates();
    if (query.due === 'overdue') {
      conditions.push(lt(tasks.dueAt, now), inArray(tasks.status, ['open', 'in_progress']));
    } else if (query.due === 'today') {
      conditions.push(sql`${tasks.dueAt} IS NOT NULL AND ${localDueDate} = ${localToday}`);
      conditions.push(inArray(tasks.status, ['open', 'in_progress']));
    } else if (query.due === 'upcoming') {
      conditions.push(sql`${tasks.dueAt} IS NOT NULL AND ${localDueDate} > ${localToday}`);
      conditions.push(inArray(tasks.status, ['open', 'in_progress']));
    }
    if (query.fromDate) {
      conditions.push(sql`${localDueDate} >= ${query.fromDate}::date`);
    }
    if (query.untilDate) {
      conditions.push(sql`${localDueDate} <= ${query.untilDate}::date`);
    }
    if (query.order === 'created') {
      // Listing is stable by newest creation when explicitly requested.
    }
    const where = and(...conditions);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [totalRow] = await transaction.select({ count: count() }).from(tasks).where(where);
      const rows = await this.taskData.listWithDisplay(
        transaction,
        where,
        [
          query.order === 'created'
            ? desc(tasks.createdAt)
            : query.order === 'priority'
              ? sql`CASE ${tasks.priority} WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, ${tasks.dueAt} ASC NULLS LAST`
              : sql`${tasks.dueAt} asc nulls last`,
          desc(tasks.id),
        ],
        pageSize,
        bounded(query.offset, (page - 1) * pageSize, 0, 10_000_000),
      );
      const items = [];
      for (const row of rows) {
        const task = row.task;
        const resource = taskResource(task);
        if (!can(principal, { action: 'operations.read', resource })) continue;
        items.push({
          ...this.taskView(principal, task),
          clientName:
            task.clientId && can(principal, { action: 'client.read', resource })
              ? displayNameWithoutIdentifiers(row.clientName)
              : null,
          assignedEmployeeName:
            task.assignedEmployeeId && can(principal, { action: 'employee.read', resource })
              ? displayNameWithoutIdentifiers(row.assignedEmployeeName)
              : null,
        });
      }
      return { items, page, pageSize, total: totalRow?.count ?? 0 };
    });
  }

  async taskActivityList(principal: AuthorizationPrincipal, taskId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.read');
      const rows = await transaction
        .select()
        .from(taskActivity)
        .where(and(eq(taskActivity.tenantId, principal.tenantId), eq(taskActivity.taskId, task.id)))
        .orderBy(asc(taskActivity.occurredAt), asc(taskActivity.id))
        .limit(200);
      const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
      const actorRows = actorIds.length
        ? await this.taskData.activityActors(transaction, principal.tenantId, actorIds)
        : [];
      const actorNames = new Map(
        actorRows.flatMap((actor) =>
          actor.displayName ? [[actor.id, actor.displayName] as const] : [],
        ),
      );
      return rows.map((row) => ({ ...row, actorName: actorNames.get(row.actorUserId) ?? null }));
    });
  }

  private async updateTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    input: OperationsTaskPatch,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !validPatch(input)
    )
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.tasks.manage');
      if (task.version !== input.expectedVersion) throw new OperationsTaskVersionConflictError();
      if (task.status === 'completed' || task.status === 'cancelled')
        throw new OperationsTaskStateError();
      const changedFields: string[] = [];
      const values: Partial<typeof tasks.$inferInsert> = {
        version: task.version + 1,
        updatedAt: new Date(),
      };
      if (input.title !== undefined && input.title.trim() !== task.title) {
        values.title = input.title.trim();
        changedFields.push('title');
      }
      if (
        input.description !== undefined &&
        normalizeOptional(input.description) !== task.description
      ) {
        values.description = normalizeOptional(input.description);
        changedFields.push('description');
      }
      if (input.priority !== undefined && input.priority !== task.priority) {
        values.priority = input.priority;
        changedFields.push('priority');
      }
      if (input.dueAt !== undefined && input.dueAt?.getTime() !== task.dueAt?.getTime()) {
        values.dueAt = input.dueAt;
        changedFields.push('due_date');
      }
      if (
        input.assignedEmployeeId !== undefined &&
        input.assignedEmployeeId !== task.assignedEmployeeId
      ) {
        assertCan(principal, { action: 'operations.tasks.assign', resource: taskResource(task) });
        if (input.assignedEmployeeId)
          await this.validateAssignee(
            transaction,
            principal.tenantId,
            input.assignedEmployeeId,
            task.organizationId,
            task.facilityId,
          );
        values.assignedEmployeeId = input.assignedEmployeeId;
        changedFields.push('assigned_employee');
      }
      if (!changedFields.length) return this.taskView(principal, task);
      const [updated] = await transaction
        .update(tasks)
        .set(values)
        .where(
          and(
            eq(tasks.tenantId, principal.tenantId),
            eq(tasks.id, task.id),
            eq(tasks.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OperationsTaskVersionConflictError();
      await this.addActivity(transaction, principal, updated, 'edited', { changedFields });
      if (changedFields.includes('assigned_employee')) {
        await this.addActivity(transaction, principal, updated, 'assigned', {
          employeeId: updated.assignedEmployeeId,
        });
      }
      if (changedFields.includes('priority')) {
        await this.addActivity(transaction, principal, updated, 'priority_changed', {
          priority: updated.priority,
        });
      }
      if (changedFields.includes('due_date')) {
        await this.addActivity(transaction, principal, updated, 'due_date_changed', {
          dueAt: updated.dueAt?.toISOString() ?? null,
        });
      }
      const eventType = changedFields.includes('assigned_employee')
        ? 'operations.task_assigned'
        : 'operations.task_updated';
      const payload =
        eventType === 'operations.task_assigned'
          ? { taskId: task.id, employeeId: updated.assignedEmployeeId }
          : { taskId: task.id, changedFields };
      await this.recordStateChange(transaction, principal, request, auditContext, {
        type: eventType,
        action: eventType,
        aggregateId: task.id,
        payload,
        metadata: { taskId: task.id, changedFields },
      });
      return this.taskView(principal, updated);
    });
  }

  private async transitionTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    status: TaskStatus,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.tasks.manage');
      if (task.version !== expectedVersion) throw new OperationsTaskVersionConflictError();
      const allowed =
        status === 'in_progress'
          ? task.status === 'open'
          : status === 'completed'
            ? task.status === 'open' || task.status === 'in_progress'
            : status === 'open'
              ? task.status === 'completed'
              : task.status === 'open' || task.status === 'in_progress';
      if (!allowed) throw new OperationsTaskStateError();
      const now = new Date();
      const [updated] = await transaction
        .update(tasks)
        .set({
          status,
          completedAt: status === 'completed' ? now : null,
          completedByUserId: status === 'completed' ? principal.userId : null,
          version: task.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(tasks.tenantId, principal.tenantId),
            eq(tasks.id, task.id),
            eq(tasks.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OperationsTaskVersionConflictError();
      await this.addActivity(transaction, principal, updated, 'status_changed', {
        from: task.status,
        to: status,
      });
      const type =
        status === 'completed'
          ? 'operations.task_completed'
          : status === 'cancelled'
            ? 'operations.task_cancelled'
            : status === 'open'
              ? 'operations.task_reopened'
              : 'operations.task_updated';
      const action = type;
      const payload =
        type === 'operations.task_updated'
          ? { taskId: task.id, changedFields: ['status'] }
          : { taskId: task.id };
      await this.recordStateChange(transaction, principal, request, auditContext, {
        type,
        action,
        aggregateId: task.id,
        payload,
        metadata: { taskId: task.id, from: task.status, to: status },
      });
      return this.taskView(principal, updated);
    });
  }

  private async readTask(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    taskId: string,
    permission: 'operations.read' | 'operations.tasks.manage',
  ) {
    const [task] = await transaction
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, principal.tenantId), eq(tasks.id, taskId)))
      .limit(1);
    if (!task) throw new OperationsTaskNotFoundError();
    assertCan(principal, { action: permission, resource: taskResource(task) });
    await this.taskData.assertTaskClientAccess(transaction, principal, task);
    return task;
  }

  private async addActivity(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    task: typeof tasks.$inferSelect,
    kind: (typeof taskActivity.$inferInsert)['kind'],
    details: Record<string, unknown>,
  ) {
    await transaction.insert(taskActivity).values({
      id: uuidv7(),
      tenantId: principal.tenantId,
      taskId: task.id,
      actorUserId: principal.userId,
      kind,
      details,
      comment: null,
      occurredAt: new Date(),
    });
  }

  private taskView(principal: AuthorizationPrincipal, task: typeof tasks.$inferSelect) {
    let source: OperationsSourceReference | null = null;
    const sourceId = sourceIdFromRow(task);
    if (task.sourceType && sourceId) {
      const action = sourcePermission(task.sourceType);
      if (can(principal, { action, resource: taskResource(task) }))
        source = { type: task.sourceType, id: sourceId };
    }
    return {
      id: task.id,
      organizationId: task.organizationId,
      facilityId: task.facilityId,
      clientId: task.clientId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignedEmployeeId: task.assignedEmployeeId,
      assignmentWarningCode: task.assignmentWarningCode,
      createdByUserId: task.createdByUserId,
      completedByUserId: task.completedByUserId,
      dueAt: task.dueAt,
      completedAt: task.completedAt,
      source,
      version: task.version,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  async taskSummary(
    principal: AuthorizationPrincipal,
    query: Pick<OperationsTaskListQuery, 'organizationId' | 'facilityId'>,
  ) {
    const scopeConditions = this.taskScopeConditions(principal);
    if (scopeConditions && !scopeConditions.length)
      return { assignedToMe: 0, dueToday: 0, overdue: 0, urgent: 0 };
    const conditions: SQL[] = [
      eq(tasks.tenantId, principal.tenantId),
      ...(scopeConditions ?? []),
      inArray(tasks.status, ['open', 'in_progress']),
    ];
    if (query.organizationId) conditions.push(eq(tasks.organizationId, query.organizationId));
    if (query.facilityId) conditions.push(eq(tasks.facilityId, query.facilityId));
    const employeeId = await this.taskData.employeeForUser(principal.tenantId, principal.userId);
    if (!employeeId) return { assignedToMe: 0, dueToday: 0, overdue: 0, urgent: 0 };
    conditions.push(eq(tasks.assignedEmployeeId, employeeId));
    const { dueDate: localDueDate, today: localToday } = this.taskData.dueLocalDates();
    const where = and(...conditions);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [summary] = await transaction
        .select({
          assignedToMe: count(),
          dueToday: sql<number>`count(*) filter (where ${tasks.dueAt} IS NOT NULL AND ${localDueDate} = ${localToday})`,
          overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < now())`,
          urgent: sql<number>`count(*) filter (where ${tasks.priority} = 'urgent')`,
        })
        .from(tasks)
        .where(where);
      return {
        assignedToMe: Number(summary?.assignedToMe ?? 0),
        dueToday: Number(summary?.dueToday ?? 0),
        overdue: Number(summary?.overdue ?? 0),
        urgent: Number(summary?.urgent ?? 0),
      };
    });
  }

  private taskScopeConditions(principal: AuthorizationPrincipal): SQL[] | null {
    const grants = principal.grants.filter((grant) => grant.permission === 'operations.read');
    const tenantWide = grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    );
    const organizationIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ];
    const facilitiesInScope = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ];
    if (!tenantWide && !organizationIds.length && !facilitiesInScope.length) return [];

    const taskScope: SQL | null = tenantWide
      ? null
      : or(
          ...(organizationIds.length ? [inArray(tasks.organizationId, organizationIds)] : []),
          ...(facilitiesInScope.length ? [inArray(tasks.facilityId, facilitiesInScope)] : []),
        )!;

    const conditions: SQL[] = taskScope ? [taskScope] : [];
    const clientScope = this.taskData.clientReadScope(principal);
    if (clientScope) conditions.push(clientScope);
    return conditions.length ? conditions : null;
  }

  private async validateAssignee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    organizationId: string,
    facilityId: string | null,
  ) {
    await validateOperationsAssignee(transaction, tenantId, employeeId, organizationId, facilityId);
  }

  private async recordStateChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: {
      type: string;
      action: string;
      aggregateId: string;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
  ) {
    const event = createDomainEvent({
      type: input.type as import('@care/events').EventName,
      tenantId: principal.tenantId,
      aggregateType: 'operations',
      aggregateId: input.aggregateId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload: input.payload as never,
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'office_task',
      resourceId: input.aggregateId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }

  private async recordAudit(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: { action: string; resourceId: string; metadata: Record<string, unknown> },
  ) {
    await this.audit.append(transaction, {
      id: uuidv7(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'office_task',
      resourceId: input.resourceId,
      timestamp: new Date(),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata: input.metadata,
    });
  }
}

function requireTaskGrant(principal: AuthorizationPrincipal, permission: Permission) {
  if (!hasGrant(principal, permission)) throw new AuthorizationDeniedError(permission);
}
