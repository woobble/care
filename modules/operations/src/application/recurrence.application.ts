import { and, asc, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import { clientRecords } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { facilities, organizationsTable } from '@care/organizations';
import {
  assertCan,
  can,
  type AuthorizationPrincipal,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  recurringTaskDefinitions,
  recurringTaskOccurrences,
  schedulerRuns,
  taskActivity,
  tasks,
} from '@module/operations/schema';

import {
  isValidRecurrenceSchedule,
  nextRecurrenceOccurrence,
  recurrenceOccurrenceAt,
  type RecurrenceOccurrence,
  type RecurrenceRule,
  type RecurrenceSchedule,
} from '../domain/recurrence';
import { OperationsAssigneeInvalidError, validateOperationsAssignee } from './operations-guards';

const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const MAX_CATCH_UP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DEFINITIONS_PER_RUN = 100;
const MAX_OCCURRENCES_PER_DEFINITION = 100;
const MAX_TASKS_PER_RUN = 500;
const SCHEDULER_LEASE_MS = 5 * 60 * 1000;

type RecurringTaskDefinition = typeof recurringTaskDefinitions.$inferSelect;
type RecurrenceStatus = RecurringTaskDefinition['status'];
type RecurringTaskPriority = RecurringTaskDefinition['priority'];

export interface RecurringTaskInput {
  organizationId: string;
  facilityId?: string | null;
  clientId?: string | null;
  title: string;
  description?: string | null;
  priority?: RecurringTaskPriority;
  assignedEmployeeId?: string | null;
  rule: RecurrenceRule;
  timezone?: string;
  startDate: string;
  endDate?: string | null;
  timeOfDay?: string;
  generationPolicy?: 'generate_missed' | 'skip_missed';
}

export interface RecurringTaskPatch extends Partial<RecurringTaskInput> {
  expectedVersion: number;
}

export interface RecurringTaskQuery {
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  assignedEmployeeId?: string;
  status?: RecurrenceStatus;
  page?: number;
  pageSize?: number;
}

type AuditContext = { ip?: string; userAgent?: string };

export class OperationsRecurrenceApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async list(principal: AuthorizationPrincipal, query: RecurringTaskQuery = {}) {
    this.requireGrant(principal, 'operations.read');
    if (query.assignedEmployeeId) this.requireGrant(principal, 'operations.tasks.assign');
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 25, 1, 100);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const conditions = [eq(recurringTaskDefinitions.tenantId, principal.tenantId)];
      const operationsScope = recurrencePermissionScope(principal, 'operations.read');
      if (operationsScope) conditions.push(operationsScope);
      const clientScope = recurrencePermissionScope(principal, 'client.read');
      if (clientScope) {
        conditions.push(or(isNull(recurringTaskDefinitions.clientId), clientScope)!);
      } else if (
        !principal.grants.some(
          (grant) =>
            grant.permission === 'client.read' &&
            grant.scopeType === 'tenant' &&
            grant.scopeId === principal.tenantId,
        )
      ) {
        conditions.push(isNull(recurringTaskDefinitions.clientId));
      }
      if (query.organizationId)
        conditions.push(eq(recurringTaskDefinitions.organizationId, query.organizationId));
      if (query.facilityId)
        conditions.push(eq(recurringTaskDefinitions.facilityId, query.facilityId));
      if (query.clientId) conditions.push(eq(recurringTaskDefinitions.clientId, query.clientId));
      if (query.assignedEmployeeId)
        conditions.push(eq(recurringTaskDefinitions.assignedEmployeeId, query.assignedEmployeeId));
      if (query.status) conditions.push(eq(recurringTaskDefinitions.status, query.status));
      const where = and(...conditions);
      const [totalRow] = await transaction
        .select({ total: count() })
        .from(recurringTaskDefinitions)
        .where(where);
      const rows = await transaction
        .select()
        .from(recurringTaskDefinitions)
        .where(where)
        .orderBy(
          sql`${recurringTaskDefinitions.nextOccurrenceAt} ASC NULLS LAST`,
          asc(recurringTaskDefinitions.id),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map(definitionView),
        page,
        pageSize,
        total: totalRow?.total ?? 0,
      };
    });
  }

  async get(principal: AuthorizationPrincipal, recurrenceId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const definition = await this.readDefinition(transaction, principal, recurrenceId);
      return definitionView(definition);
    });
  }

  async occurrences(principal: AuthorizationPrincipal, recurrenceId: string) {
    this.requireGrant(principal, 'operations.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const definition = await this.readDefinition(transaction, principal, recurrenceId);
      const rows = await transaction
        .select({
          taskId: recurringTaskOccurrences.taskId,
          occurrenceDate: recurringTaskOccurrences.occurrenceKey,
          dueAt: recurringTaskOccurrences.dueAt,
          status: tasks.status,
          title: tasks.title,
        })
        .from(recurringTaskOccurrences)
        .innerJoin(
          tasks,
          and(
            eq(tasks.tenantId, recurringTaskOccurrences.tenantId),
            eq(tasks.id, recurringTaskOccurrences.taskId),
          ),
        )
        .where(
          and(
            eq(recurringTaskOccurrences.tenantId, principal.tenantId),
            eq(recurringTaskOccurrences.recurrenceDefinitionId, definition.id),
          ),
        )
        .orderBy(sql`${recurringTaskOccurrences.occurrenceKey} DESC`)
        .limit(100);
      return rows.map((row) => ({
        taskId: row.taskId,
        occurrenceDate: row.occurrenceDate,
        dueAt: row.dueAt.toISOString(),
        status: row.status,
        title: row.title,
      }));
    });
  }

  async create(
    principal: AuthorizationPrincipal,
    input: RecurringTaskInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!validRecurringTaskInput(input)) throw new InvalidRecurringTaskInputError();
    const id = uuidv7();
    const now = new Date();
    const generationPolicy = input.generationPolicy ?? 'generate_missed';
    const definition = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const resource = inputResource(principal.tenantId, input);
        assertCan(principal, {
          action: 'operations.recurring_tasks.manage',
          resource,
        });
        assertCan(principal, { action: 'operations.tasks.create', resource });
        if (input.assignedEmployeeId)
          assertCan(principal, { action: 'operations.tasks.assign', resource });
        const context = await this.validateContext(transaction, principal, input);
        const timezone = input.timezone ?? context.timezone;
        const schedule = scheduleFromInput(input, timezone);
        if (!isValidRecurrenceSchedule(schedule)) throw new InvalidRecurringTaskInputError();
        const next = nextRecurrenceOccurrence(schedule);
        if (!next) throw new InvalidRecurringTaskInputError();
        if (input.assignedEmployeeId) {
          await validateOperationsAssignee(
            transaction,
            principal.tenantId,
            input.assignedEmployeeId,
            input.organizationId,
            context.facilityId,
          );
        }
        const [created] = await transaction
          .insert(recurringTaskDefinitions)
          .values({
            id,
            tenantId: principal.tenantId,
            organizationId: input.organizationId,
            facilityId: context.facilityId,
            clientId: input.clientId ?? null,
            title: input.title.trim(),
            description: normalizeOptional(input.description),
            priority: input.priority ?? 'normal',
            assignedEmployeeId: input.assignedEmployeeId ?? null,
            rule: input.rule,
            timezone,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            timeOfDay: input.timeOfDay ?? '09:00',
            nextOccurrenceDate: next.date,
            nextOccurrenceAt: next.dueAt,
            status: 'active',
            generationPolicy,
            version: 1,
            createdByUserId: principal.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await this.recordChange(transaction, principal, request, auditContext, {
          type: 'operations.recurrence_created',
          action: 'operations.recurrence_created',
          resourceType: 'recurring_task',
          resourceId: id,
          payload: { recurrenceId: id },
          metadata: { recurrenceId: id },
        });
        return created!;
      },
    );
    return definitionView(definition);
  }

  async patch(
    principal: AuthorizationPrincipal,
    recurrenceId: string,
    input: RecurringTaskPatch,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw new InvalidRecurringTaskInputError();
    const result = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const current = await this.readDefinition(
          transaction,
          principal,
          recurrenceId,
          'operations.recurring_tasks.manage',
        );
        if (current.version !== input.expectedVersion)
          throw new OperationsRecurrenceVersionConflictError();
        if (current.status === 'ended') throw new OperationsRecurrenceStateError();
        if (!validRecurringTaskPatch(input)) throw new InvalidRecurringTaskInputError();

        const updatedInput = mergeInput(current, input);
        const resource = inputResource(principal.tenantId, updatedInput);
        assertCan(principal, {
          action: 'operations.recurring_tasks.manage',
          resource,
        });
        assertCan(principal, { action: 'operations.tasks.create', resource });
        if (updatedInput.assignedEmployeeId)
          assertCan(principal, { action: 'operations.tasks.assign', resource });
        const context = await this.validateContext(transaction, principal, updatedInput);
        const timezone =
          input.timezone ??
          (updatedInput.organizationId === current.organizationId
            ? current.timezone
            : context.timezone);
        const schedule = scheduleFromInput(updatedInput, timezone);
        if (!isValidRecurrenceSchedule(schedule)) throw new InvalidRecurringTaskInputError();
        const now = new Date();
        const next = nextAfterNow(schedule, now);
        const changedFields = changedDefinitionFields(current, updatedInput, timezone);
        if (!changedFields.length) return { definition: current, changedFields };
        if (updatedInput.assignedEmployeeId) {
          await validateOperationsAssignee(
            transaction,
            principal.tenantId,
            updatedInput.assignedEmployeeId,
            updatedInput.organizationId,
            context.facilityId,
          );
        }
        const [updated] = await transaction
          .update(recurringTaskDefinitions)
          .set({
            organizationId: updatedInput.organizationId,
            facilityId: context.facilityId,
            clientId: updatedInput.clientId ?? null,
            title: updatedInput.title.trim(),
            description: normalizeOptional(updatedInput.description),
            priority: updatedInput.priority ?? 'normal',
            assignedEmployeeId: updatedInput.assignedEmployeeId ?? null,
            rule: updatedInput.rule,
            timezone,
            startDate: updatedInput.startDate,
            endDate: updatedInput.endDate ?? null,
            timeOfDay: updatedInput.timeOfDay ?? '09:00',
            nextOccurrenceDate: next?.date ?? null,
            nextOccurrenceAt: next?.dueAt ?? null,
            status: next ? current.status : 'ended',
            generationPolicy: updatedInput.generationPolicy ?? 'generate_missed',
            version: current.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(recurringTaskDefinitions.tenantId, principal.tenantId),
              eq(recurringTaskDefinitions.id, recurrenceId),
              eq(recurringTaskDefinitions.version, input.expectedVersion),
            ),
          )
          .returning();
        if (!updated) throw new OperationsRecurrenceVersionConflictError();
        await this.recordChange(transaction, principal, request, auditContext, {
          type: 'operations.recurrence_updated',
          action: 'operations.recurrence_updated',
          resourceType: 'recurring_task',
          resourceId: recurrenceId,
          payload: { recurrenceId, changedFields },
          metadata: { recurrenceId, changedFields },
        });
        if (!next) {
          await this.recordChange(transaction, principal, request, auditContext, {
            type: 'operations.recurrence_ended',
            action: 'operations.recurrence_ended',
            resourceType: 'recurring_task',
            resourceId: recurrenceId,
            payload: { recurrenceId },
            metadata: { recurrenceId, reason: 'schedule_has_ended' },
          });
        }
        return { definition: updated!, changedFields };
      },
    );
    return definitionView(result.definition);
  }

  async pause(
    principal: AuthorizationPrincipal,
    recurrenceId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transition(
      principal,
      recurrenceId,
      expectedVersion,
      'paused',
      request,
      auditContext,
    );
  }

  async resume(
    principal: AuthorizationPrincipal,
    recurrenceId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transition(
      principal,
      recurrenceId,
      expectedVersion,
      'active',
      request,
      auditContext,
    );
  }

  async end(
    principal: AuthorizationPrincipal,
    recurrenceId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transition(
      principal,
      recurrenceId,
      expectedVersion,
      'ended',
      request,
      auditContext,
    );
  }

  async runRecurringTaskScheduler(tenantId: string, workerId: string, now = new Date()) {
    const claimed = await this.claimRun(tenantId, workerId, now);
    if (!claimed) return { status: 'busy' as const, tasksCreated: 0 };
    try {
      const result = await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
        const lockResult = await transaction.execute(
          sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`operations-recurring:${tenantId}`}, 0)) AS locked`,
        );
        const locked = Boolean(
          (lockResult as unknown as { rows?: Array<{ locked?: boolean }> }).rows?.[0]?.locked,
        );
        if (!locked) return null;
        const cutoff = new Date(now.getTime() + LOOKAHEAD_MS);
        const definitions = await transaction
          .select()
          .from(recurringTaskDefinitions)
          .where(
            and(
              eq(recurringTaskDefinitions.tenantId, tenantId),
              eq(recurringTaskDefinitions.status, 'active'),
              lt(recurringTaskDefinitions.nextOccurrenceAt, new Date(cutoff.getTime() + 1)),
            ),
          )
          .orderBy(asc(recurringTaskDefinitions.nextOccurrenceAt), asc(recurringTaskDefinitions.id))
          .for('update')
          .limit(MAX_DEFINITIONS_PER_RUN);

        let tasksCreated = 0;
        for (const definition of definitions) {
          if (tasksCreated >= MAX_TASKS_PER_RUN) break;
          // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
          tasksCreated += await this.generateForDefinition(
            transaction,
            definition,
            now,
            cutoff,
            MAX_TASKS_PER_RUN - tasksCreated,
          );
        }
        return tasksCreated;
      });
      if (result === null) return { status: 'busy' as const, tasksCreated: 0 };
      await this.finishRun(tenantId, workerId, now, 'succeeded', result, null);
      return { status: 'succeeded' as const, tasksCreated: result };
    } catch (error) {
      await this.finishRun(tenantId, workerId, now, 'failed', 0, failureCode(error));
      throw error;
    }
  }

  private async transition(
    principal: AuthorizationPrincipal,
    recurrenceId: string,
    expectedVersion: number,
    nextStatus: RecurrenceStatus,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new InvalidRecurringTaskInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.readDefinition(
        transaction,
        principal,
        recurrenceId,
        'operations.recurring_tasks.manage',
      );
      if (current.version !== expectedVersion) throw new OperationsRecurrenceVersionConflictError();
      if (current.status === 'ended' || current.status === nextStatus)
        throw new OperationsRecurrenceStateError();
      if (nextStatus === 'paused' && current.status !== 'active')
        throw new OperationsRecurrenceStateError();
      if (nextStatus === 'active' && current.status !== 'paused')
        throw new OperationsRecurrenceStateError();

      let nextOccurrence: RecurrenceOccurrence | null = null;
      if (nextStatus === 'active')
        nextOccurrence = nextAfterNow(scheduleFromDefinition(current), new Date());
      const status: RecurrenceStatus =
        nextStatus === 'active' && !nextOccurrence ? 'ended' : nextStatus;
      const now = new Date();
      const [updated] = await transaction
        .update(recurringTaskDefinitions)
        .set({
          status,
          nextOccurrenceDate:
            nextStatus === 'ended'
              ? null
              : nextStatus === 'paused'
                ? current.nextOccurrenceDate
                : (nextOccurrence?.date ?? null),
          nextOccurrenceAt:
            nextStatus === 'ended'
              ? null
              : nextStatus === 'paused'
                ? current.nextOccurrenceAt
                : (nextOccurrence?.dueAt ?? null),
          version: current.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(recurringTaskDefinitions.tenantId, principal.tenantId),
            eq(recurringTaskDefinitions.id, recurrenceId),
            eq(recurringTaskDefinitions.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OperationsRecurrenceVersionConflictError();
      const eventType =
        status === 'ended'
          ? 'operations.recurrence_ended'
          : nextStatus === 'paused'
            ? 'operations.recurrence_paused'
            : 'operations.recurrence_resumed';
      await this.recordChange(transaction, principal, request, auditContext, {
        type: eventType,
        action: eventType,
        resourceType: 'recurring_task',
        resourceId: recurrenceId,
        payload: { recurrenceId },
        metadata: { recurrenceId },
      });
      return definitionView(updated!);
    });
  }

  private async generateForDefinition(
    transaction: DatabaseTransaction,
    definition: RecurringTaskDefinition,
    now: Date,
    cutoff: Date,
    taskBudget: number,
  ) {
    const schedule = scheduleFromDefinition(definition);
    if (!isValidRecurrenceSchedule(schedule) || !definition.nextOccurrenceDate) {
      throw new InvalidRecurringTaskInputError();
    }
    let cursor = definition.nextOccurrenceDate;
    let occurrence = recurrenceOccurrenceAt(schedule, cursor);
    if (!occurrence) {
      occurrence = nextRecurrenceOccurrence(schedule, previousDate(cursor));
    }
    let generated = 0;
    let inspected = 0;
    while (
      occurrence &&
      occurrence.dueAt <= cutoff &&
      inspected < MAX_OCCURRENCES_PER_DEFINITION &&
      generated < taskBudget
    ) {
      inspected += 1;
      if (occurrence.dueAt < now && shouldSkipMissed(definition, occurrence.dueAt, now)) {
        cursor = occurrence.date;
      } else {
        // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
        const [existing] = await transaction
          .select({ id: recurringTaskOccurrences.id })
          .from(recurringTaskOccurrences)
          .where(
            and(
              eq(recurringTaskOccurrences.tenantId, definition.tenantId),
              eq(recurringTaskOccurrences.recurrenceDefinitionId, definition.id),
              eq(recurringTaskOccurrences.occurrenceKey, occurrence.date),
            ),
          )
          .limit(1);
        if (!existing) {
          // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
          generated += await this.createOccurrence(transaction, definition, occurrence);
        }
        cursor = occurrence.date;
      }
      occurrence = nextRecurrenceOccurrence(schedule, cursor);
    }

    const next = occurrence ?? nextRecurrenceOccurrence(schedule, cursor);
    const nowWritten = new Date();
    await transaction
      .update(recurringTaskDefinitions)
      .set({
        status: next ? definition.status : 'ended',
        nextOccurrenceDate: next?.date ?? null,
        nextOccurrenceAt: next?.dueAt ?? null,
        version: definition.version + 1,
        updatedAt: nowWritten,
      })
      .where(
        and(
          eq(recurringTaskDefinitions.tenantId, definition.tenantId),
          eq(recurringTaskDefinitions.id, definition.id),
          eq(recurringTaskDefinitions.version, definition.version),
        ),
      );
    return generated;
  }

  private async createOccurrence(
    transaction: DatabaseTransaction,
    definition: RecurringTaskDefinition,
    occurrence: RecurrenceOccurrence,
  ) {
    let assignedEmployeeId = definition.assignedEmployeeId;
    let assignmentWarningCode: 'assignee_unavailable' | null = null;
    if (assignedEmployeeId) {
      try {
        await validateOperationsAssignee(
          transaction,
          definition.tenantId,
          assignedEmployeeId,
          definition.organizationId,
          definition.facilityId,
        );
      } catch (error) {
        if (!(error instanceof OperationsAssigneeInvalidError)) throw error;
        assignedEmployeeId = null;
        assignmentWarningCode = 'assignee_unavailable';
      }
    }

    const taskId = uuidv7();
    const now = new Date();
    await transaction.insert(tasks).values({
      id: taskId,
      tenantId: definition.tenantId,
      organizationId: definition.organizationId,
      facilityId: definition.facilityId,
      clientId: definition.clientId,
      title: definition.title,
      description: definition.description,
      status: 'open',
      priority: definition.priority,
      assignedEmployeeId,
      createdByUserId: definition.createdByUserId,
      completedByUserId: null,
      dueAt: occurrence.dueAt,
      completedAt: null,
      assignmentWarningCode,
      sourceType: null,
      sourceClientId: null,
      sourceVisitId: null,
      sourceAgreementId: null,
      sourceEvidencePackageId: null,
      sourceInvoiceId: null,
      sourceClaimId: null,
      sourceEntitlementId: null,
      sourceDocumentId: null,
      sourceCommunicationId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(recurringTaskOccurrences).values({
      id: uuidv7(),
      tenantId: definition.tenantId,
      recurrenceDefinitionId: definition.id,
      occurrenceKey: occurrence.date,
      definitionVersion: definition.version,
      taskId,
      dueAt: occurrence.dueAt,
      assignmentWarningCode,
      createdAt: now,
    });
    await transaction.insert(taskActivity).values({
      id: uuidv7(),
      tenantId: definition.tenantId,
      taskId,
      actorUserId: definition.createdByUserId,
      kind: 'created',
      details: {
        source: 'recurring_task',
        recurrenceDefinitionId: definition.id,
        occurrenceDate: occurrence.date,
        ...(assignmentWarningCode ? { assignmentWarningCode } : {}),
      },
      comment: null,
      occurredAt: now,
    });
    const event = createDomainEvent({
      type: 'operations.recurring_task_generated',
      tenantId: definition.tenantId,
      aggregateType: 'operations',
      aggregateId: definition.id,
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: {
        recurrenceId: definition.id,
        taskId,
        occurrenceDate: occurrence.date,
      },
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: definition.tenantId,
      actorId: definition.createdByUserId,
      action: 'operations.recurring_task_generated',
      resourceType: 'office_task',
      resourceId: taskId,
      timestamp: new Date(event.occurredAt),
      requestId: 'operations-scheduler',
      correlationId: event.correlationId,
      metadata: {
        recurrenceId: definition.id,
        taskId,
        occurrenceDate: occurrence.date,
      },
    });
    await this.outbox.enqueue(transaction, event);
    return 1;
  }

  private async validateContext(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    input: Pick<RecurringTaskInput, 'organizationId' | 'facilityId' | 'clientId'>,
  ) {
    const [organization] = await transaction
      .select({ id: organizationsTable.id, timezone: organizationsTable.timezone })
      .from(organizationsTable)
      .where(
        and(
          eq(organizationsTable.tenantId, principal.tenantId),
          eq(organizationsTable.id, input.organizationId),
        ),
      )
      .limit(1);
    if (!organization) throw new InvalidRecurringTaskInputError();

    let facilityId = input.facilityId ?? null;
    if (facilityId) {
      const [facility] = await transaction
        .select({ id: facilities.id })
        .from(facilities)
        .where(
          and(
            eq(facilities.tenantId, principal.tenantId),
            eq(facilities.organizationId, input.organizationId),
            eq(facilities.id, facilityId),
          ),
        )
        .limit(1);
      if (!facility) throw new InvalidRecurringTaskInputError();
    }

    if (input.clientId) {
      const [client] = await transaction
        .select({
          id: clientRecords.id,
          organizationId: clientRecords.organizationId,
          facilityId: clientRecords.primaryFacilityId,
        })
        .from(clientRecords)
        .where(
          and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, input.clientId)),
        )
        .limit(1);
      if (!client || client.organizationId !== input.organizationId)
        throw new InvalidRecurringTaskInputError();
      if (facilityId && client.facilityId && facilityId !== client.facilityId)
        throw new InvalidRecurringTaskInputError();
      if (!facilityId) facilityId = client.facilityId;
      assertCan(principal, {
        action: 'client.read',
        resource: {
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          ...(client.facilityId ? { facilityId: client.facilityId } : {}),
          clientId: client.id,
        },
      });
    }

    return { facilityId, timezone: organization.timezone };
  }

  private async readDefinition(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    recurrenceId: string,
    permission: 'operations.read' | 'operations.recurring_tasks.manage' = 'operations.read',
  ) {
    const [definition] = await transaction
      .select()
      .from(recurringTaskDefinitions)
      .where(
        and(
          eq(recurringTaskDefinitions.tenantId, principal.tenantId),
          eq(recurringTaskDefinitions.id, recurrenceId),
        ),
      )
      .limit(1);
    if (!definition || !this.canReadDefinition(principal, definition, permission))
      throw new OperationsRecurrenceNotFoundError();
    return definition;
  }

  private canReadDefinition(
    principal: AuthorizationPrincipal,
    definition: RecurringTaskDefinition,
    permission: 'operations.read' | 'operations.recurring_tasks.manage' = 'operations.read',
  ) {
    return (
      can(principal, { action: permission, resource: definitionResource(definition) }) &&
      (!definition.clientId ||
        can(principal, {
          action: 'client.read',
          resource: {
            tenantId: principal.tenantId,
            organizationId: definition.organizationId,
            ...(definition.facilityId ? { facilityId: definition.facilityId } : {}),
            clientId: definition.clientId,
          },
        }))
    );
  }

  private async claimRun(tenantId: string, workerId: string, now: Date) {
    return this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      const [claimed] = await transaction
        .insert(schedulerRuns)
        .values({
          id: uuidv7(),
          tenantId,
          jobName: 'recurring_tasks',
          status: 'running',
          workerId,
          leaseUntil: new Date(now.getTime() + SCHEDULER_LEASE_MS),
          lastStartedAt: now,
          lastSucceededAt: null,
          lastFailedAt: null,
          lastFailureCode: null,
          tasksCreated: 0,
          remindersTriggered: 0,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schedulerRuns.tenantId, schedulerRuns.jobName],
          set: {
            status: 'running',
            workerId,
            leaseUntil: new Date(now.getTime() + SCHEDULER_LEASE_MS),
            lastStartedAt: now,
            lastFailureCode: null,
            updatedAt: now,
          },
          setWhere: sql`${schedulerRuns.status} <> 'running' OR ${schedulerRuns.leaseUntil} < ${now}`,
        })
        .returning({ id: schedulerRuns.id });
      return claimed !== undefined;
    });
  }

  private async finishRun(
    tenantId: string,
    workerId: string,
    now: Date,
    status: 'succeeded' | 'failed',
    tasksCreated: number,
    lastFailureCode: string | null,
  ) {
    await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      await transaction
        .update(schedulerRuns)
        .set({
          status,
          workerId: null,
          leaseUntil: null,
          lastSucceededAt: status === 'succeeded' ? now : undefined,
          lastFailedAt: status === 'failed' ? now : undefined,
          lastFailureCode,
          tasksCreated,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schedulerRuns.tenantId, tenantId),
            eq(schedulerRuns.jobName, 'recurring_tasks'),
            eq(schedulerRuns.workerId, workerId),
          ),
        );
    });
  }

  private async recordChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: {
      type: string;
      action: string;
      resourceType: string;
      resourceId: string;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
  ) {
    const event = createDomainEvent({
      type: input.type as import('@care/events').EventName,
      tenantId: principal.tenantId,
      aggregateType: 'operations',
      aggregateId: input.resourceId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload: input.payload as never,
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }

  private requireGrant(
    principal: AuthorizationPrincipal,
    permission: 'operations.read' | 'operations.tasks.assign',
  ) {
    if (!principal.grants.some((grant) => grant.permission === permission))
      assertCan(principal, {
        action: permission,
        resource: { tenantId: principal.tenantId },
      });
  }
}

export class InvalidRecurringTaskInputError extends Error {
  readonly code = 'OPERATIONS_INVALID_INPUT';
  constructor() {
    super('The recurring task input is invalid');
  }
}

export class OperationsRecurrenceNotFoundError extends Error {
  readonly code = 'OPERATIONS_RECURRENCE_NOT_FOUND';
  constructor() {
    super('The recurring task was not found');
  }
}

export class OperationsRecurrenceVersionConflictError extends Error {
  readonly code = 'OPERATIONS_RECURRENCE_VERSION_CONFLICT';
  constructor() {
    super('The recurring task changed in another Office session');
  }
}

export class OperationsRecurrenceStateError extends Error {
  readonly code = 'OPERATIONS_RECURRENCE_INVALID_STATE';
  constructor() {
    super('The recurring task cannot make the requested transition');
  }
}

function validRecurringTaskInput(input: RecurringTaskInput): boolean {
  return (
    typeof input.title === 'string' &&
    input.title.trim().length > 0 &&
    input.title.trim().length <= 200 &&
    (input.description == null ||
      (typeof input.description === 'string' && input.description.length <= 8000)) &&
    (input.priority === undefined ||
      ['low', 'normal', 'high', 'urgent'].includes(input.priority)) &&
    isUuid(input.organizationId) &&
    (input.facilityId == null || isUuid(input.facilityId)) &&
    (input.clientId == null || isUuid(input.clientId)) &&
    (input.assignedEmployeeId == null || isUuid(input.assignedEmployeeId)) &&
    (input.generationPolicy === undefined ||
      ['generate_missed', 'skip_missed'].includes(input.generationPolicy)) &&
    isValidRecurrenceSchedule(scheduleFromInput(input, input.timezone ?? 'Europe/Berlin'))
  );
}

function validRecurringTaskPatch(input: RecurringTaskPatch): boolean {
  if (!Object.keys(input).some((key) => key !== 'expectedVersion')) return true;
  const changes = input;
  return (
    (changes.title === undefined ||
      (typeof changes.title === 'string' &&
        changes.title.trim().length > 0 &&
        changes.title.trim().length <= 200)) &&
    (changes.description === undefined ||
      changes.description === null ||
      (typeof changes.description === 'string' && changes.description.length <= 8000)) &&
    (changes.priority === undefined ||
      ['low', 'normal', 'high', 'urgent'].includes(changes.priority)) &&
    (changes.organizationId === undefined || isUuid(changes.organizationId)) &&
    (changes.facilityId === undefined ||
      changes.facilityId === null ||
      isUuid(changes.facilityId)) &&
    (changes.clientId === undefined || changes.clientId === null || isUuid(changes.clientId)) &&
    (changes.assignedEmployeeId === undefined ||
      changes.assignedEmployeeId === null ||
      isUuid(changes.assignedEmployeeId)) &&
    (changes.generationPolicy === undefined ||
      ['generate_missed', 'skip_missed'].includes(changes.generationPolicy))
  );
}

function scheduleFromInput(input: RecurringTaskInput, timezone: string): RecurrenceSchedule {
  return {
    rule: input.rule,
    timezone,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    timeOfDay: input.timeOfDay ?? '09:00',
  };
}

function scheduleFromDefinition(definition: RecurringTaskDefinition): RecurrenceSchedule {
  return {
    rule: definition.rule,
    timezone: definition.timezone,
    startDate: definition.startDate,
    endDate: definition.endDate,
    timeOfDay: definition.timeOfDay.slice(0, 5),
  };
}

function mergeInput(
  current: RecurringTaskDefinition,
  patch: RecurringTaskPatch,
): RecurringTaskInput {
  return {
    organizationId: patch.organizationId ?? current.organizationId,
    facilityId: patch.facilityId === undefined ? current.facilityId : patch.facilityId,
    clientId: patch.clientId === undefined ? current.clientId : patch.clientId,
    title: patch.title ?? current.title,
    description: patch.description === undefined ? current.description : patch.description,
    priority: patch.priority ?? current.priority,
    assignedEmployeeId:
      patch.assignedEmployeeId === undefined
        ? current.assignedEmployeeId
        : patch.assignedEmployeeId,
    rule: patch.rule ?? current.rule,
    timezone: patch.timezone ?? current.timezone,
    startDate: patch.startDate ?? current.startDate,
    endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
    timeOfDay: patch.timeOfDay ?? current.timeOfDay.slice(0, 5),
    generationPolicy: patch.generationPolicy ?? current.generationPolicy,
  };
}

function changedDefinitionFields(
  current: RecurringTaskDefinition,
  input: RecurringTaskInput,
  timezone: string,
) {
  const comparisons: Array<[string, unknown, unknown]> = [
    ['organization', current.organizationId, input.organizationId],
    ['facility', current.facilityId, input.facilityId ?? null],
    ['client', current.clientId, input.clientId ?? null],
    ['title', current.title, input.title.trim()],
    ['description', current.description, normalizeOptional(input.description)],
    ['priority', current.priority, input.priority ?? 'normal'],
    ['assigned_employee', current.assignedEmployeeId, input.assignedEmployeeId ?? null],
    ['recurrence_rule', JSON.stringify(current.rule), JSON.stringify(input.rule)],
    ['timezone', current.timezone, timezone],
    ['start_date', current.startDate, input.startDate],
    ['end_date', current.endDate, input.endDate ?? null],
    ['time_of_day', current.timeOfDay.slice(0, 5), input.timeOfDay ?? '09:00'],
    ['generation_policy', current.generationPolicy, input.generationPolicy ?? 'generate_missed'],
  ];
  return comparisons.filter(([, before, after]) => before !== after).map(([field]) => field);
}

function nextAfterNow(schedule: RecurrenceSchedule, now: Date): RecurrenceOccurrence | null {
  const today = localDateKey(now, schedule.timezone);
  let next = nextRecurrenceOccurrence(schedule, previousDate(today));
  if (next && next.dueAt <= now) next = nextRecurrenceOccurrence(schedule, next.date);
  return next;
}

function shouldSkipMissed(definition: RecurringTaskDefinition, dueAt: Date, now: Date) {
  if (definition.generationPolicy === 'skip_missed') return true;
  return dueAt.getTime() < now.getTime() - MAX_CATCH_UP_MS;
}

function definitionResource(definition: RecurringTaskDefinition): ResourceContext {
  return {
    tenantId: definition.tenantId,
    organizationId: definition.organizationId,
    ...(definition.facilityId ? { facilityId: definition.facilityId } : {}),
    ...(definition.clientId ? { clientId: definition.clientId } : {}),
  };
}

function recurrencePermissionScope(
  principal: AuthorizationPrincipal,
  permission: 'operations.read' | 'client.read',
): SQL | undefined {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  if (
    grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
  ) {
    return undefined;
  }
  const organizationIds = [
    ...new Set(
      grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
    ),
  ];
  const facilityIds = [
    ...new Set(
      grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
    ),
  ];
  const scopes: SQL[] = [];
  if (organizationIds.length)
    scopes.push(inArray(recurringTaskDefinitions.organizationId, organizationIds));
  if (facilityIds.length) scopes.push(inArray(recurringTaskDefinitions.facilityId, facilityIds));
  return scopes.length ? or(...scopes)! : sql`false`;
}

function inputResource(
  tenantId: string,
  input: Pick<RecurringTaskInput, 'organizationId' | 'facilityId' | 'clientId'>,
): ResourceContext {
  return {
    tenantId,
    organizationId: input.organizationId,
    ...(input.facilityId ? { facilityId: input.facilityId } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
  };
}

function definitionView(definition: RecurringTaskDefinition) {
  return {
    id: definition.id,
    organizationId: definition.organizationId,
    facilityId: definition.facilityId,
    clientId: definition.clientId,
    title: definition.title,
    description: definition.description,
    priority: definition.priority,
    assignedEmployeeId: definition.assignedEmployeeId,
    rule: definition.rule,
    timezone: definition.timezone,
    startDate: definition.startDate,
    endDate: definition.endDate,
    timeOfDay: definition.timeOfDay.slice(0, 5),
    nextOccurrenceDate: definition.nextOccurrenceDate,
    nextOccurrenceAt: definition.nextOccurrenceAt?.toISOString() ?? null,
    status: definition.status,
    generationPolicy: definition.generationPolicy,
    version: definition.version,
    createdByUserId: definition.createdByUserId,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}

function localDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function previousDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! - 1));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new InvalidRecurringTaskInputError();
  return result;
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function failureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z0-9_]{1,80}$/.test(error.name)) return error.name;
  return 'SchedulerError';
}
