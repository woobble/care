import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  gte,
  lt,
  max,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import {
  type BenefitEntitlementExpiryQueries,
  type BenefitsApplicationService,
  clientBenefitEntitlements,
} from '@care/benefits';
import {
  type PayerArrangementExpiryQueries,
  type BillingApplicationService,
  type BillingClaimsApplicationService,
  invoices,
  claims,
} from '@care/billing';
import {
  CareDocumentationNotFoundError,
  CareDocumentationVisitRelationshipRequiredError,
  type CareDocumentationApplicationService,
  careDocuments,
} from '@care/care-documentation';
import { clientRecords } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { documentArtifacts } from '@care/documents';
import { type QualificationExpiryQueries, employeeRecords } from '@care/employees';
import { createDomainEvent } from '@care/events';
import { tenantMemberships, users } from '@care/identity';
import {
  type OrganizationApplicationService,
  facilities,
  organizationsTable,
} from '@care/organizations';
import {
  assertCan,
  AuthorizationDeniedError,
  can,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  VisitNotFoundError,
  VisitOutsideProviderContextError,
  localDateTimeToInstant,
  type SchedulingApplicationService,
  visits,
} from '@care/scheduling';
import { type AgreementExpiryQueries, agreements } from '@care/service-agreements';
import {
  EvidencePackageNotFoundError,
  ServiceEvidenceVisitRelationshipRequiredError,
  type ServiceEvidenceApplicationService,
  evidencePackages,
} from '@care/service-evidence';
import type { VisitExecutionApplicationService } from '@care/visit-execution';

import {
  evidenceIssueCode,
  evidencePackageIssueCode,
  stableIssueId,
} from '@module/operations/domain/operations';
import {
  exceptionInteractions,
  exceptionOccurrences,
  reminderPolicies,
  schedulerRuns,
  tasks,
} from '@module/operations/schema';

import { validateOperationsAssignee } from './operations-guards';

import { OperationsTasksApplicationService } from './tasks.application';
import type { OperationsTaskData } from './tasks.ports';
import { sourcePermission } from './task-rules';
import { hasGrant, bounded, displayNameWithoutIdentifiers } from './operations-helpers';
import {
  InvalidOperationsInputError,
  OperationsTaskNotFoundError,
  OperationsSourceNotFoundError,
  OperationsTaskVersionConflictError,
} from './task.errors';
export {
  InvalidOperationsInputError,
  OperationsTaskNotFoundError,
  OperationsSourceNotFoundError,
  OperationsTaskVersionConflictError,
  OperationsTaskStateError,
} from './task.errors';
import type {
  SourceType,
  TaskStatus,
  TaskPriority,
  OperationsSourceReference,
  OperationsTaskInput,
  OperationsTaskPatch,
  OperationsTaskListQuery,
  TaskResourceContext,
} from './task.contracts';
export type {
  OperationsSourceReference,
  OperationsTaskInput,
  OperationsTaskPatch,
  OperationsTaskListQuery,
} from './task.contracts';

type AuditContext = { ip?: string; userAgent?: string };
type ClaimReadiness = Awaited<ReturnType<BillingClaimsApplicationService['readiness']>>;
const projectionSourceAt = Symbol('projectionSourceAt');
type ProjectedOperationsWorkItem = OperationsWorkItem & {
  [projectionSourceAt]: Date | null;
};
type ReconciliationWindow = {
  from: Date | null;
  until: Date | null;
};
type OnboardingReadinessCase = {
  id: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  stage: string;
  createdAt: Date;
  nextFollowUpAt: Date | null;
  preferredStartDate: string | null;
  blockerCount: number;
};

const MAX_STALE_EXCEPTION_RECONCILIATIONS = 20;
const REMINDER_POLICY_CATEGORIES = [
  'agreements',
  'employees',
  'benefits',
  'billing',
  'onboarding',
] as const;

export type OperationsReminderPolicyCategory = (typeof REMINDER_POLICY_CATEGORIES)[number];
export interface OperationsReminderPolicyInput {
  organizationId: string;
  category: OperationsReminderPolicyCategory;
  offsetsDays: number[];
  enabled: boolean;
  createFollowUpTask: boolean;
  assignedEmployeeId?: string | null;
  expectedVersion: number;
}

export interface OperationsSourceServices {
  organizations: Pick<OrganizationApplicationService, 'operationsTimezones'>;
  payerExpiry: Pick<PayerArrangementExpiryQueries, 'operationsExpiryPage'>;
  benefitExpiry: Pick<BenefitEntitlementExpiryQueries, 'operationsExpiryPage'>;
  qualifications: Pick<QualificationExpiryQueries, 'operationsExpiryPage'>;
  agreements: Pick<AgreementExpiryQueries, 'operationsExpiryPage'>;
  scheduling: Pick<SchedulingApplicationService, 'getWorklist' | 'getWorklistForVisit'>;
  execution: Pick<VisitExecutionApplicationService, 'operationsSummaries' | 'operationsIssueState'>;
  documentation: Pick<CareDocumentationApplicationService, 'worklist' | 'getForVisit'>;
  evidence: Pick<ServiceEvidenceApplicationService, 'worklist' | 'getPackage'>;
  benefits: Pick<BenefitsApplicationService, 'getWorklist' | 'listUnallocatedServices'>;
  billing: Pick<BillingApplicationService, 'listInvoicesPage' | 'receivablesPage'>;
  claims: Pick<BillingClaimsApplicationService, 'listClaims' | 'readiness' | 'readinessForClaims'>;
  onboarding?: {
    operationsReadinessWorklist(
      principal: AuthorizationPrincipal,
      deadlineWindow: {
        fromDate: string;
        untilDate: string;
        organizationId?: string;
        facilityId?: string;
        clientId?: string;
      },
      onPage?: (items: OnboardingReadinessCase[]) => Promise<void>,
    ): Promise<{ items: OnboardingReadinessCase[]; complete: boolean }>;
    operationsIssueState(
      principal: AuthorizationPrincipal,
      caseId: string,
    ): Promise<{
      readinessBlocked: boolean;
      followUpOverdue: boolean;
      followUpDue: boolean;
      startDateActionable: boolean;
    }>;
  };
}

export interface OperationsQuery {
  category?: OperationsWorkItem['category'];
  status?: OperationsWorkItem['status'];
  severity?: OperationsWorkItem['severity'];
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  employeeId?: string;
  sourceDomain?: string;
  fromDate?: string;
  untilDate?: string;
  deadlinesOnly?: boolean;
  assignedEmployeeId?: string;
  due?: 'overdue' | 'today' | 'upcoming';
  search?: string;
  sort?: 'relevance' | 'due';
  page?: number;
  pageSize?: number;
  offset?: number;
}

export interface OperationsWorkQueueQuery {
  itemType?: 'all' | 'tasks' | 'exceptions';
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  category?: OperationsWorkItem['category'];
  sourceDomain?: string;
  severity?: OperationsWorkItem['severity'];
  exceptionStatus?: OperationsWorkItem['status'];
  taskStatus?: TaskStatus;
  priority?: TaskPriority;
  assignedEmployeeId?: string;
  assignedToMe?: boolean;
  due?: 'overdue' | 'today' | 'upcoming';
  fromDate?: string;
  untilDate?: string;
  search?: string;
  sort?: 'priority' | 'due';
  page?: number;
  pageSize?: number;
}

export interface OperationsWorkItem {
  id: string;
  kind: 'exception';
  category:
    | 'scheduling'
    | 'visits'
    | 'documentation'
    | 'benefits'
    | 'billing'
    | 'claims'
    | 'onboarding'
    | 'agreements'
    | 'employees';
  sourceDomain: string;
  sourceEntityType: string;
  sourceEntityId: string;
  issueCode: string;
  titleCode: string;
  descriptionCode: string;
  categoryLabelCode: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'snoozed';
  organizationId: string | null;
  facilityId: string | null;
  clientId: string | null;
  clientName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  dueAt: string | null;
  firstDetectedAt: string;
  lastObservedAt: string;
  interaction: {
    action: 'acknowledged' | 'snoozed';
    occurredAt: string;
    snoozedUntil: string | null;
    reason: string | null;
  } | null;
}

const categorySourceDomains: Record<OperationsWorkItem['category'], ReadonlySet<string>> = {
  scheduling: new Set(['scheduling']),
  visits: new Set(['visit_execution']),
  documentation: new Set(['care_documentation', 'service_evidence']),
  benefits: new Set(['benefits']),
  billing: new Set(['billing']),
  claims: new Set(['claims']),
  onboarding: new Set(['onboarding']),
  agreements: new Set(['service_agreements']),
  employees: new Set(['employee_qualifications']),
};
const undatedSourceDomains = new Set(['care_documentation', 'service_evidence', 'claims']);
const employeeScopedSourceDomains = new Set([
  'scheduling',
  'care_documentation',
  'employee_qualifications',
]);

export class OperationsApplicationService {
  private readonly taskManagement: OperationsTasksApplicationService;
  private readonly taskData: OperationsTaskData;
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly sources: OperationsSourceServices,
  ) {
    this.taskData = new LegacyOperationsTaskData(unitOfWork);
    this.taskManagement = new OperationsTasksApplicationService(
      unitOfWork,
      audit,
      outbox,
      this.taskData,
    );
  }

  async dashboard(
    principal: AuthorizationPrincipal,
    query: Pick<OperationsQuery, 'organizationId' | 'facilityId'> = {},
  ) {
    const [worklist, tasksSummary] = await Promise.all([
      this.listWorkItems(principal, { ...query, page: 1, pageSize: 1000 }),
      this.taskManagement.taskSummary(principal, query),
    ]);
    const deadlineItems = worklist.items.filter(
      (item) => deadlinePolicyCategory(item) !== null && item.dueAt !== null,
    );
    const deadlineTimezones = await this.organizationTimezones(principal, [
      ...new Set(
        deadlineItems.flatMap((item) => (item.organizationId ? [item.organizationId] : [])),
      ),
    ]);
    const now = new Date();
    const deadlineCounts = { overdue: 0, today: 0, upcoming: 0 };
    for (const item of deadlineItems) {
      const timezone = deadlineTimezones.get(item.organizationId ?? '') ?? 'Europe/Berlin';
      const dueDate = localDateKey(new Date(item.dueAt!), timezone);
      const today = localDateKey(now, timezone);
      if (dueDate < today) deadlineCounts.overdue += 1;
      else if (dueDate === today) deadlineCounts.today += 1;
      else deadlineCounts.upcoming += 1;
    }
    const categoryCounts = Object.fromEntries(
      (
        [
          'scheduling',
          'visits',
          'documentation',
          'benefits',
          'billing',
          'claims',
          'onboarding',
          'agreements',
          'employees',
        ] as const
      ).map((category) => [
        category,
        worklist.items.filter((item) => item.category === category).length,
      ]),
    );
    const severityCounts = Object.fromEntries(
      (['info', 'warning', 'critical'] as const).map((severity) => [
        severity,
        worklist.items.filter((item) => item.severity === severity).length,
      ]),
    );
    return {
      generatedAt: new Date().toISOString(),
      exceptionCount: worklist.items.filter(
        (item) => item.status === 'open' || item.severity === 'critical',
      ).length,
      categoryCounts,
      severityCounts,
      deadlineCounts,
      worklistTruncated: worklist.truncated || worklist.total > worklist.items.length,
      tasks: tasksSummary,
      highPriorityExceptions: worklist.items
        .filter((item) => item.severity === 'critical' || item.severity === 'warning')
        .slice(0, 10),
    };
  }

  async reminderSettings(principal: AuthorizationPrincipal, organizationId?: string) {
    this.requireAnyGrant(principal, 'operations.reminder_settings.manage');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const organizations = await transaction
        .select({ id: organizationsTable.id, name: organizationsTable.name })
        .from(organizationsTable)
        .where(
          and(
            eq(organizationsTable.tenantId, principal.tenantId),
            ...(organizationId ? [eq(organizationsTable.id, organizationId)] : []),
          ),
        )
        .orderBy(asc(organizationsTable.name), asc(organizationsTable.id));
      const visible = organizations.filter((organization) =>
        can(principal, {
          action: 'operations.reminder_settings.manage',
          resource: { tenantId: principal.tenantId, organizationId: organization.id },
        }),
      );
      if (organizationId && !visible.length)
        throw new AuthorizationDeniedError('operations.reminder_settings.manage');
      const policyRows = visible.length
        ? await transaction
            .select()
            .from(reminderPolicies)
            .where(
              and(
                eq(reminderPolicies.tenantId, principal.tenantId),
                inArray(
                  reminderPolicies.organizationId,
                  visible.map((organization) => organization.id),
                ),
              ),
            )
        : [];
      const [schedulerRun] = await transaction
        .select({
          status: schedulerRuns.status,
          lastStartedAt: schedulerRuns.lastStartedAt,
          lastSucceededAt: schedulerRuns.lastSucceededAt,
          lastFailedAt: schedulerRuns.lastFailedAt,
          lastFailureCode: schedulerRuns.lastFailureCode,
          tasksCreated: schedulerRuns.tasksCreated,
          remindersTriggered: schedulerRuns.remindersTriggered,
        })
        .from(schedulerRuns)
        .where(
          and(
            eq(schedulerRuns.tenantId, principal.tenantId),
            eq(schedulerRuns.jobName, 'deadline_evaluation'),
          ),
        )
        .limit(1);
      const byKey = new Map(
        policyRows.map((policy) => [`${policy.organizationId}:${policy.category}`, policy]),
      );
      return {
        scheduler: schedulerRun
          ? {
              ...schedulerRun,
              lastStartedAt: schedulerRun.lastStartedAt.toISOString(),
              lastSucceededAt: schedulerRun.lastSucceededAt?.toISOString() ?? null,
              lastFailedAt: schedulerRun.lastFailedAt?.toISOString() ?? null,
            }
          : null,
        organizations: visible.map((organization) => ({
          ...organization,
          policies: REMINDER_POLICY_CATEGORIES.map((category) => {
            const policy = byKey.get(`${organization.id}:${category}`);
            return {
              category,
              offsetsDays: policy?.offsetsDays ?? [30, 7, 0],
              enabled: policy?.enabled ?? true,
              createFollowUpTask: policy?.createFollowUpTask ?? false,
              assignedEmployeeId: policy?.assignedEmployeeId ?? null,
              version: policy?.version ?? 0,
            };
          }),
        })),
      };
    });
  }

  async updateReminderPolicy(
    principal: AuthorizationPrincipal,
    input: OperationsReminderPolicyInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !REMINDER_POLICY_CATEGORIES.includes(input.category) ||
      !Array.isArray(input.offsetsDays) ||
      input.offsetsDays.length < 1 ||
      input.offsetsDays.length > 8 ||
      input.offsetsDays.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 365) ||
      new Set(input.offsetsDays).size !== input.offsetsDays.length ||
      typeof input.enabled !== 'boolean' ||
      typeof input.createFollowUpTask !== 'boolean' ||
      (input.createFollowUpTask && input.category !== 'agreements') ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      throw new InvalidOperationsInputError();
    const resource = { tenantId: principal.tenantId, organizationId: input.organizationId };
    assertCan(principal, { action: 'operations.reminder_settings.manage', resource });
    const assignedEmployeeId = input.assignedEmployeeId ?? null;
    if (assignedEmployeeId) {
      assertCan(principal, { action: 'operations.tasks.assign', resource });
      await this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
        validateOperationsAssignee(
          transaction,
          principal.tenantId,
          assignedEmployeeId,
          input.organizationId,
          null,
        ),
      );
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [organization] = await transaction
        .select({ id: organizationsTable.id })
        .from(organizationsTable)
        .where(
          and(
            eq(organizationsTable.tenantId, principal.tenantId),
            eq(organizationsTable.id, input.organizationId),
          ),
        )
        .limit(1);
      if (!organization) throw new InvalidOperationsInputError();
      const [current] = await transaction
        .select()
        .from(reminderPolicies)
        .where(
          and(
            eq(reminderPolicies.tenantId, principal.tenantId),
            eq(reminderPolicies.organizationId, input.organizationId),
            eq(reminderPolicies.category, input.category),
          ),
        )
        .for('update')
        .limit(1);
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new OperationsTaskVersionConflictError();
      const now = new Date();
      const version = input.expectedVersion + 1;
      const values = {
        enabled: input.enabled,
        offsetsDays: [...input.offsetsDays].sort((left, right) => right - left),
        createFollowUpTask: input.createFollowUpTask,
        assignedEmployeeId,
        version,
        updatedByUserId: principal.userId,
        updatedAt: now,
      };
      const [saved] = current
        ? await transaction
            .update(reminderPolicies)
            .set(values)
            .where(eq(reminderPolicies.id, current.id))
            .returning()
        : await transaction
            .insert(reminderPolicies)
            .values({
              id: uuidv7(),
              tenantId: principal.tenantId,
              organizationId: input.organizationId,
              category: input.category,
              ...values,
              createdAt: now,
            })
            .returning();
      const event = createDomainEvent({
        type: 'operations.reminder_settings_updated',
        tenantId: principal.tenantId,
        aggregateType: 'operations',
        aggregateId: input.organizationId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          organizationId: input.organizationId,
          category: input.category,
          version,
        },
      });
      await this.audit.append(transaction, {
        id: event.id,
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: event.type,
        resourceType: 'reminder_policy',
        resourceId: saved!.id,
        timestamp: new Date(event.occurredAt),
        requestId: request.requestId,
        correlationId: event.correlationId,
        metadata: { organizationId: input.organizationId, category: input.category, version },
        ...auditContext,
      });
      await this.outbox.enqueue(transaction, event);
      return {
        category: saved!.category,
        offsetsDays: saved!.offsetsDays,
        enabled: saved!.enabled,
        createFollowUpTask: saved!.createFollowUpTask,
        assignedEmployeeId: saved!.assignedEmployeeId,
        version: saved!.version,
      };
    });
  }

  async listWorkItems(principal: AuthorizationPrincipal, query: OperationsQuery = {}) {
    this.requireAnyGrant(principal, 'operations.read');
    const observedAt = new Date();
    const now = observedAt;
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const documentationFrom = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000 + 1);
    const sourceUntil = new Date(now.getTime() + 1);
    const canRead = (permission: Permission) => hasGrant(principal, permission);
    const sourceEnabled = (sourceDomain: string) =>
      (query.sourceDomain === undefined || query.sourceDomain === sourceDomain) &&
      (query.category === undefined || categorySourceDomains[query.category].has(sourceDomain)) &&
      (!query.employeeId || employeeScopedSourceDomains.has(sourceDomain)) &&
      (!(query.due || query.fromDate || query.untilDate) ||
        !undatedSourceDomains.has(sourceDomain));
    const sourceRequested = {
      scheduling: canRead('schedule.read') && sourceEnabled('scheduling'),
      execution: canRead('visit_execution.read') && sourceEnabled('visit_execution'),
      documentation: canRead('care_documentation.review') && sourceEnabled('care_documentation'),
      evidence: canRead('service_evidence.read') && sourceEnabled('service_evidence'),
      benefits: canRead('benefits.review') && sourceEnabled('benefits'),
      invoiceDocuments:
        canRead('billing.read') &&
        sourceEnabled('billing') &&
        !query.due &&
        !query.fromDate &&
        !query.untilDate,
      receivables: canRead('billing.payments.read') && sourceEnabled('billing'),
      claims: canRead('claims.read') && sourceEnabled('claims'),
      onboarding:
        canRead('onboarding.read') &&
        sourceEnabled('onboarding') &&
        Boolean(this.sources.onboarding),
      agreements: canRead('service_agreement.read') && sourceEnabled('service_agreements'),
      qualifications:
        canRead('employee.read') && sourceEnabled('employee_qualifications') && !query.clientId,
      benefitDeadlines: canRead('benefits.review') && sourceEnabled('benefits'),
      payerArrangements: canRead('billing.read') && sourceEnabled('billing'),
    };
    const policies = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) =>
        transaction
          .select({
            organizationId: reminderPolicies.organizationId,
            category: reminderPolicies.category,
            offsetsDays: reminderPolicies.offsetsDays,
            enabled: reminderPolicies.enabled,
          })
          .from(reminderPolicies)
          .where(eq(reminderPolicies.tenantId, principal.tenantId)),
    );
    const policyByOrganization = new Map(
      policies.map((policy) => [`${policy.organizationId}:${policy.category}`, policy]),
    );
    const lookaheadDays = Math.min(
      365,
      Math.max(30, ...policies.flatMap((row) => row.offsetsDays)),
    );
    const todayUtc = now.toISOString().slice(0, 10);
    const deadlineFrom = addDaysToDate(todayUtc, -365);
    const deadlineUntil = addDaysToDate(todayUtc, lookaheadDays);
    const responsePage = bounded(query.page, 1, 1, 100_000);
    const responsePageSize = bounded(query.pageSize, 50, 1, 1000);
    const resultOffset = bounded(
      query.offset,
      (responsePage - 1) * responsePageSize,
      0,
      10_000_000,
    );
    const retainCount = resultOffset + responsePageSize;
    const retained: ProjectedOperationsWorkItem[] = [];
    const searchTerm = query.search ? normalizeOperationsSearchText(query.search) : null;
    let total = 0;
    let truncated = false;
    if (query.assignedEmployeeId) this.requireAnyGrant(principal, 'operations.tasks.assign');
    const compareWorkItems = (left: OperationsWorkItem, right: OperationsWorkItem) => {
      const byDue =
        (left.dueAt ?? '9999').localeCompare(right.dueAt ?? '9999') ||
        right.id.localeCompare(left.id);
      if (query.sort === 'due') return byDue;
      const severity = severityWeight(right.severity) - severityWeight(left.severity);
      return severity || byDue;
    };
    const collectProjectedItems = async (projectedItems: ProjectedOperationsWorkItem[]) => {
      // oxlint-disable no-await-in-loop
      const uniqueProjectedItems = deduplicateWorkItems(projectedItems);
      for (let batchStart = 0; batchStart < uniqueProjectedItems.length; batchStart += 100) {
        const batch = uniqueProjectedItems.slice(batchStart, batchStart + 100);
        if (!batch.length) continue;
        const organizationIds = batch.flatMap((item) =>
          item.organizationId ? [item.organizationId] : [],
        );
        const timezones = await this.organizationTimezones(principal, organizationIds);
        const policyVisible = batch.filter((item) => {
          const policyCategory = deadlinePolicyCategory(item);
          if (!policyCategory || !item.dueAt || !item.organizationId) return true;
          const policy = policyByOrganization.get(`${item.organizationId}:${policyCategory}`);
          const timezone = timezones.get(item.organizationId) ?? 'Europe/Berlin';
          const remainingDays = dateDifferenceDays(
            localDateKey(new Date(item.dueAt), timezone),
            localDateKey(now, timezone),
          );
          if (remainingDays < 0 || item.severity === 'critical') return true;
          if (policy?.enabled === false) return false;
          return remainingDays <= Math.max(0, ...(policy?.offsetsDays ?? [30, 7, 0]));
        });
        const authorized = policyVisible.filter((item) => {
          const resource = workItemResource(principal, item);
          const readPermission = exceptionReadPermission(item.sourceDomain, item.issueCode);
          return (
            can(principal, { action: 'operations.read', resource }) &&
            readPermission !== null &&
            can(principal, { action: readPermission, resource })
          );
        });
        const attached: ProjectedOperationsWorkItem[] = [];
        for (let start = 0; start < authorized.length; start += 100) {
          const authorizedBatch = authorized.slice(start, start + 100);
          await this.syncExceptionOccurrences(principal, authorizedBatch, new Map(), observedAt);
          attached.push(...(await this.attachInteractions(principal, authorizedBatch)));
        }
        let assignedDeadlineKeys: Set<string> | null = null;
        if (query.assignedEmployeeId) {
          const deadlineKeys = attached
            .filter(
              (item) =>
                deadlinePolicyCategory(item) &&
                can(principal, {
                  action: 'operations.tasks.assign',
                  resource: workItemResource(principal, item),
                }),
            )
            .map((item) => item.id);
          const assignedTasks = deadlineKeys.length
            ? await this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
                transaction
                  .select({ sourceDeadlineKey: tasks.sourceDeadlineKey })
                  .from(tasks)
                  .where(
                    and(
                      eq(tasks.tenantId, principal.tenantId),
                      eq(tasks.assignedEmployeeId, query.assignedEmployeeId!),
                      inArray(tasks.sourceDeadlineKey, deadlineKeys),
                    ),
                  ),
              )
            : [];
          assignedDeadlineKeys = new Set(
            assignedTasks.flatMap((task) =>
              task.sourceDeadlineKey ? [task.sourceDeadlineKey] : [],
            ),
          );
        }
        for (const item of attached) {
          if (assignedDeadlineKeys && !assignedDeadlineKeys.has(item.id)) continue;
          if (query.category && item.category !== query.category) continue;
          if (query.status && item.status !== query.status) continue;
          if (query.severity && item.severity !== query.severity) continue;
          if (query.organizationId && item.organizationId !== query.organizationId) continue;
          if (query.facilityId && item.facilityId !== query.facilityId) continue;
          if (query.clientId && item.clientId !== query.clientId) continue;
          if (query.employeeId && item.employeeId !== query.employeeId) continue;
          if (query.sourceDomain && item.sourceDomain !== query.sourceDomain) continue;
          if (query.deadlinesOnly && (!item.dueAt || !deadlinePolicyCategory(item))) continue;
          const timezone = timezones.get(item.organizationId ?? '') ?? 'Europe/Berlin';
          const localDueDate = item.dueAt ? localDateKey(new Date(item.dueAt), timezone) : null;
          if (query.fromDate && (!localDueDate || localDueDate < query.fromDate)) continue;
          if (query.untilDate && (!localDueDate || localDueDate > query.untilDate)) continue;
          if (query.due && !matchesDueFilter(item.dueAt, query.due, now, timezone)) continue;
          if (
            searchTerm &&
            !normalizeOperationsSearchText(
              [
                item.issueCode,
                item.sourceDomain,
                item.category,
                item.clientName ?? '',
                item.employeeName ?? '',
                item.sourceEntityId,
              ].join(' '),
            ).includes(searchTerm)
          ) {
            continue;
          }
          total += 1;
          retainSortedPrefix(retained, item, retainCount, compareWorkItems);
        }
      }
      // oxlint-enable no-await-in-loop
    };
    const readSource = async (
      sourceDomain: string,
      enabled: boolean,
      read: () => Promise<boolean>,
    ): Promise<boolean> => {
      if (!enabled) return false;
      try {
        const complete = await read();
        truncated ||= !complete;
        return complete;
      } catch (error) {
        logOperationsSourceFailure(sourceDomain, error);
        truncated = true;
        return false;
      }
    };
    const streamExpiryPages = async <T>(
      sourceDomain: string,
      enabled: boolean,
      readPage: (offset: number) => Promise<{ items: readonly T[]; complete: boolean }>,
      visitPage: (rows: readonly T[]) => Promise<void>,
    ) =>
      readSource(sourceDomain, enabled, async () => {
        // oxlint-disable no-await-in-loop
        for (let offset = 0; ; offset += 100) {
          const page = await readPage(offset);
          await visitPage(page.items);
          if (page.complete) return true;
        }
        // oxlint-enable no-await-in-loop
      });
    const [
      scheduleComplete,
      executionComplete,
      documentationComplete,
      evidenceComplete,
      benefitsComplete,
      invoiceDocumentsComplete,
      receivablesComplete,
      claimsComplete,
      onboardingComplete,
      agreementsComplete,
      qualificationsComplete,
      benefitEntitlementsComplete,
      payerArrangementsComplete,
    ] = await Promise.all([
      readSource('scheduling', sourceRequested.scheduling, async () => {
        const result = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.scheduling.getWorklist(principal, {
              from: now,
              until,
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
              ...(query.employeeId ? { employeeId: query.employeeId } : {}),
              page,
              pageSize,
            }),
          async (rows) => {
            const projected: ProjectedOperationsWorkItem[] = [];
            for (const row of rows) {
              const visit = row.visit;
              for (const conflict of row.conflicts) {
                if (query.employeeId && conflict.employeeId !== query.employeeId) continue;
                projected.push(
                  this.workItem({
                    sourceDomain: 'scheduling',
                    entityType: 'visit',
                    entityId: visit.id,
                    issueCode: conflict.code,
                    category: 'scheduling',
                    severity: conflict.severity === 'blocking' ? 'critical' : 'warning',
                    organizationId: visit.organizationId,
                    facilityId: visit.facilityId,
                    clientId: visit.clientId,
                    clientName: visit.clientDisplayName,
                    employeeId: conflict.employeeId ?? null,
                    dueAt: visit.plannedStart.toISOString(),
                    sourceAt: visit.plannedStart,
                    descriptionCode: `operations.issues.scheduling.${conflict.code}`,
                  }),
                );
              }
            }
            await collectProjectedItems(projected);
          },
        );
        return result.complete;
      }),
      readSource('visit_execution', sourceRequested.execution, async () => {
        const result = await this.sources.execution.operationsSummaries(
          principal,
          from,
          sourceUntil,
          {
            ...(query.organizationId ? { organizationId: query.organizationId } : {}),
            ...(query.facilityId ? { facilityId: query.facilityId } : {}),
            ...(query.clientId ? { clientId: query.clientId } : {}),
          },
          async (summaries) =>
            collectProjectedItems(
              summaries.map((summary) =>
                this.workItem({
                  sourceDomain: 'visit_execution',
                  entityType: 'visit',
                  entityId: summary.visitId,
                  issueCode: 'visit_execution_overdue',
                  category: 'visits',
                  severity: 'warning',
                  organizationId: summary.organizationId,
                  facilityId: summary.facilityId,
                  clientId: summary.clientId,
                  clientName: summary.clientDisplayName,
                  dueAt: summary.plannedEnd,
                  sourceAt: new Date(summary.actualStart),
                  descriptionCode: 'operations.issues.visit_execution.overdue',
                }),
              ),
            ),
        );
        return result.complete;
      }),
      readSource('care_documentation', sourceRequested.documentation, async () => {
        const result = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.documentation.worklist(principal, {
              from: documentationFrom,
              until: sourceUntil,
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
              ...(query.employeeId ? { employeeId: query.employeeId } : {}),
              incomplete: true,
              page,
              pageSize,
            }),
          async (rows) => {
            const projected = rows.flatMap((row) =>
              row.missing.map((missing) => {
                const issueCode = `documentation_${missing.code.toLowerCase()}`;
                return this.workItem({
                  sourceDomain: 'care_documentation',
                  entityType: 'visit',
                  entityId: row.visitId,
                  issueCode,
                  category: 'documentation',
                  severity: 'warning',
                  organizationId: row.organizationId,
                  facilityId: row.facilityId,
                  clientId: row.clientId,
                  clientName: row.clientDisplayName,
                  employeeId: row.employeeId,
                  employeeName: row.employeeName,
                  dueAt: null,
                  sourceAt: new Date(row.plannedStart),
                  descriptionCode: `operations.issues.documentation.${missing.code.toLowerCase()}`,
                });
              }),
            );
            await collectProjectedItems(projected);
          },
        );
        return result.complete;
      }),
      readSource('service_evidence', sourceRequested.evidence, async () => {
        const result = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.evidence.worklist(principal, {
              from,
              until: sourceUntil,
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
              page,
              pageSize,
            }),
          async (rows) => {
            const resources = await this.clientResources(
              principal.tenantId,
              rows.map((row) => row.clientId),
            );
            const projected: ProjectedOperationsWorkItem[] = [];
            for (const row of rows) {
              const issueCode = evidenceIssueCode(row);
              if (!issueCode) continue;
              const resource = resources.get(row.clientId);
              projected.push(
                this.workItem({
                  sourceDomain: 'service_evidence',
                  entityType: row.evidencePackageId ? 'evidence_package' : 'documentation',
                  entityId: row.evidencePackageId ?? row.documentationId,
                  issueCode,
                  category: 'documentation',
                  severity:
                    row.status === 'declined' || row.status === 'revoked' ? 'critical' : 'warning',
                  organizationId: resource?.organizationId ?? null,
                  facilityId: resource?.facilityId ?? null,
                  clientId: row.clientId,
                  clientName: row.clientName,
                  dueAt: null,
                  sourceAt: new Date(row.plannedStart),
                  descriptionCode: `operations.issues.evidence.${issueCode}`,
                }),
              );
            }
            await collectProjectedItems(projected);
          },
        );
        return result.complete;
      }),
      readSource('benefits', sourceRequested.benefits, async () => {
        const readClientPage = (page: number, pageSize: number) =>
          this.sources.benefits.getWorklist(
            principal,
            {
              clientPage: page,
              clientPageSize: pageSize,
              servicePage: 1,
              servicePageSize: 1,
              expiryLookaheadDays: lookaheadDays,
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
            },
            25,
            lookaheadDays,
          );
        const clients = await forEachResultPage(
          100,
          async (page, pageSize) => (await readClientPage(page, pageSize)).clients,
          async (rows) => {
            const timezones = await this.organizationTimezones(
              principal,
              rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)),
            );
            const projected: ProjectedOperationsWorkItem[] = [];
            for (const row of rows) {
              const problems: Array<{
                code: string;
                severity: OperationsWorkItem['severity'];
              }> = [];
              if (row.missingEntitlement)
                problems.push({ code: 'missing_entitlement', severity: 'warning' });
              if (row.unverifiedOpeningBalance)
                problems.push({ code: 'unverified_balance', severity: 'warning' });
              if (row.expiringCarryoverCents > 0)
                problems.push({ code: 'carryover_expiring', severity: 'warning' });
              for (const problem of problems) {
                projected.push(
                  this.workItem({
                    sourceDomain: 'benefits',
                    entityType: 'client',
                    entityId: row.clientId,
                    issueCode: problem.code,
                    category: 'benefits',
                    severity: problem.severity,
                    organizationId: row.organizationId,
                    facilityId: row.facilityId,
                    clientId: row.clientId,
                    clientName: row.clientName,
                    dueAt:
                      problem.code === 'carryover_expiring' && row.expiringCarryoverDueDate
                        ? endOfLocalDay(
                            row.expiringCarryoverDueDate,
                            timezones.get(row.organizationId ?? '') ?? 'Europe/Berlin',
                          )
                        : null,
                    sourceAt:
                      problem.code === 'carryover_expiring' && row.expiringCarryoverDueDate
                        ? new Date(`${row.expiringCarryoverDueDate}T12:00:00.000Z`)
                        : null,
                    descriptionCode: `operations.issues.benefits.${problem.code}`,
                  }),
                );
              }
            }
            await collectProjectedItems(projected);
          },
        );
        const unallocatedServices = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.benefits.listUnallocatedServices(
              principal,
              query.clientId,
              page,
              pageSize,
              {
                ...(query.organizationId ? { organizationId: query.organizationId } : {}),
                ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              },
            ),
          async (rows) =>
            collectProjectedItems(
              rows.map((row) =>
                this.workItem({
                  sourceDomain: 'benefits',
                  entityType: 'performed_service',
                  entityId: row.performedServiceId,
                  issueCode: 'service_unallocated',
                  category: 'benefits',
                  severity: 'warning',
                  organizationId: row.organizationId,
                  facilityId: row.facilityId,
                  clientId: row.clientId,
                  clientName: row.clientName,
                  dueAt: null,
                  descriptionCode: 'operations.issues.benefits.service_unallocated',
                }),
              ),
            ),
        );
        return clients.complete && unallocatedServices.complete;
      }),
      readSource('billing', sourceRequested.invoiceDocuments, async () => {
        const result = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.billing.listInvoicesPage(principal, {
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
              page,
              pageSize,
            }),
          async (rows) =>
            collectProjectedItems(
              rows
                .filter((invoice) => invoice.pdfStatus === 'failed')
                .map((invoice) =>
                  this.workItem({
                    sourceDomain: 'billing',
                    entityType: 'invoice',
                    entityId: invoice.id,
                    issueCode: 'invoice_document_failed',
                    category: 'billing',
                    severity: 'critical',
                    organizationId: invoice.organizationId,
                    facilityId: invoice.facilityId,
                    clientId: invoice.clientId,
                    clientName: invoice.clientName,
                    dueAt: null,
                    descriptionCode: 'operations.issues.billing.invoice_document_failed',
                  }),
                ),
            ),
        );
        return result.complete;
      }),
      readSource('billing', sourceRequested.receivables, async () => {
        const result = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.billing.receivablesPage(principal, {
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
              ...(query.fromDate ? { from: query.fromDate } : {}),
              ...(query.untilDate ? { until: query.untilDate } : {}),
              page,
              pageSize,
            }),
          async (rows) => {
            const timezones = await this.organizationTimezones(
              principal,
              rows.map((row) => row.organizationId),
            );
            const projected = rows.flatMap((invoice) => {
              if (!invoice.dueDate) return [];
              const timezone = timezones.get(invoice.organizationId) ?? 'Europe/Berlin';
              return [
                this.workItem({
                  sourceDomain: 'billing',
                  entityType: 'invoice',
                  entityId: invoice.id,
                  issueCode: 'receivable_due',
                  category: 'billing',
                  severity: invoice.dueDate < localDateKey(now, timezone) ? 'critical' : 'warning',
                  organizationId: invoice.organizationId,
                  facilityId: invoice.facilityId,
                  clientId: invoice.clientId,
                  clientName: invoice.clientName,
                  dueAt: endOfLocalDay(invoice.dueDate, timezone),
                  sourceAt: new Date(`${invoice.dueDate}T12:00:00.000Z`),
                  descriptionCode: 'operations.issues.billing.receivable_due',
                }),
              ];
            });
            await collectProjectedItems(projected);
          },
        );
        return result.complete;
      }),
      readSource('claims', sourceRequested.claims, async () => {
        let readinessComplete = true;
        const result = await forEachResultPage(
          100,
          (page, pageSize) =>
            this.sources.claims.listClaims(principal, {
              ...(query.organizationId ? { organizationId: query.organizationId } : {}),
              ...(query.facilityId ? { facilityId: query.facilityId } : {}),
              ...(query.clientId ? { clientId: query.clientId } : {}),
              page,
              pageSize,
            }),
          async (claimsPage) => {
            const draftClaims = claimsPage.filter((claim) => claim.status === 'draft');
            const batchedReadiness = draftClaims.length
              ? await isolateOperationsSource('claims', () =>
                  this.sources.claims.readinessForClaims(
                    principal,
                    draftClaims.map((claim) => claim.id),
                  ),
                )
              : new Map<string, ClaimReadiness>();
            const readinessResults: Array<{
              claimId: string;
              readiness: ClaimReadiness | null;
            }> = [];
            if (batchedReadiness) {
              readinessResults.push(
                ...draftClaims.map((claim) => ({
                  claimId: claim.id,
                  readiness: batchedReadiness.get(claim.id) ?? null,
                })),
              );
            } else {
              // oxlint-disable no-await-in-loop
              for (let start = 0; start < draftClaims.length; start += 20) {
                readinessResults.push(
                  ...(await Promise.all(
                    draftClaims.slice(start, start + 20).map(async (claim) => ({
                      claimId: claim.id,
                      readiness: await isolateOperationsSource('claims', () =>
                        this.sources.claims.readiness(principal, claim.id),
                      ),
                    })),
                  )),
                );
              }
              // oxlint-enable no-await-in-loop
            }
            readinessComplete &&= readinessResults.every((entry) => entry.readiness !== null);
            if (!readinessComplete) truncated = true;
            const readinessByClaim = new Map(
              readinessResults.flatMap((entry) =>
                entry.readiness ? [[entry.claimId, entry.readiness] as const] : [],
              ),
            );
            const projected: ProjectedOperationsWorkItem[] = [];
            for (const claim of claimsPage) {
              let issueCode: string | null = null;
              if (claim.status === 'rejected') issueCode = 'claim_rejected';
              else if (claim.status === 'clarification_required') issueCode = 'claim_clarification';
              else if (claim.status === 'ready') issueCode = 'claim_ready_to_submit';
              else if (claim.status === 'draft') {
                if (readinessByClaim.get(claim.id)?.blockers.length)
                  issueCode = 'claim_readiness_blocked';
              } else if (claim.status === 'accepted' || claim.status === 'partially_accepted') {
                const accepted = claim.acceptedCents ?? claim.amountCents;
                if (claim.paidCents < accepted) issueCode = 'claim_payment_outstanding';
              }
              if (!issueCode) continue;
              projected.push(
                this.workItem({
                  sourceDomain: 'claims',
                  entityType: 'claim',
                  entityId: claim.id,
                  issueCode,
                  category: 'claims',
                  severity: issueCode === 'claim_rejected' ? 'critical' : 'warning',
                  organizationId: claim.organizationId,
                  facilityId: claim.facilityId,
                  clientId: claim.clientId,
                  clientName: claim.clientName,
                  dueAt: null,
                  descriptionCode: `operations.issues.claims.${issueCode}`,
                }),
              );
            }
            await collectProjectedItems(projected);
          },
        );
        return result.complete && readinessComplete;
      }),
      readSource('onboarding', sourceRequested.onboarding, async () => {
        if (!this.sources.onboarding) return false;
        const result = await this.sources.onboarding.operationsReadinessWorklist(
          principal,
          {
            fromDate: deadlineFrom,
            untilDate: deadlineUntil,
            ...(query.organizationId ? { organizationId: query.organizationId } : {}),
            ...(query.facilityId ? { facilityId: query.facilityId } : {}),
            ...(query.clientId ? { clientId: query.clientId } : {}),
          },
          async (admissions) => {
            const timezones = await this.organizationTimezones(
              principal,
              admissions.map((admission) => admission.organizationId),
            );
            const projected: ProjectedOperationsWorkItem[] = [];
            for (const admission of admissions) {
              const isOverdue = Boolean(
                admission.nextFollowUpAt && admission.nextFollowUpAt < observedAt,
              );
              if (admission.nextFollowUpAt) {
                projected.push(
                  this.workItem({
                    sourceDomain: 'onboarding',
                    entityType: 'admission_case',
                    entityId: admission.id,
                    issueCode: isOverdue
                      ? 'admission_follow_up_overdue'
                      : 'admission_follow_up_due',
                    category: 'onboarding',
                    severity: isOverdue ? 'critical' : 'warning',
                    organizationId: admission.organizationId,
                    facilityId: admission.facilityId,
                    clientId: admission.clientId,
                    clientName: `${admission.firstName} ${admission.lastName}`,
                    dueAt: admission.nextFollowUpAt.toISOString(),
                    sourceAt: admission.nextFollowUpAt,
                    descriptionCode: `operations.issues.onboarding.${isOverdue ? 'follow_up_overdue' : 'follow_up_due'}`,
                  }),
                );
              }
              if (admission.blockerCount > 0) {
                projected.push(
                  this.workItem({
                    sourceDomain: 'onboarding',
                    entityType: 'admission_case',
                    entityId: admission.id,
                    issueCode: 'admission_readiness_blocked',
                    category: 'onboarding',
                    severity: isOverdue ? 'critical' : 'warning',
                    organizationId: admission.organizationId,
                    facilityId: admission.facilityId,
                    clientId: admission.clientId,
                    clientName: `${admission.firstName} ${admission.lastName}`,
                    dueAt: admission.nextFollowUpAt?.toISOString() ?? null,
                    sourceAt: admission.createdAt,
                    descriptionCode: 'operations.issues.onboarding.readiness_blocked',
                  }),
                );
              }
              if (admission.preferredStartDate) {
                const dueAt = endOfLocalDay(
                  admission.preferredStartDate,
                  timezones.get(admission.organizationId) ?? 'Europe/Berlin',
                );
                if (dueAt) {
                  const startDatePassed = new Date(dueAt) < observedAt;
                  projected.push(
                    this.workItem({
                      sourceDomain: 'onboarding',
                      entityType: 'admission_case',
                      entityId: admission.id,
                      issueCode: 'admission_start_date',
                      category: 'onboarding',
                      severity: startDatePassed ? 'critical' : 'warning',
                      organizationId: admission.organizationId,
                      facilityId: admission.facilityId,
                      clientId: admission.clientId,
                      clientName: `${admission.firstName} ${admission.lastName}`,
                      dueAt,
                      sourceAt: new Date(`${admission.preferredStartDate}T12:00:00.000Z`),
                      descriptionCode: 'operations.issues.onboarding.start_date',
                    }),
                  );
                }
              }
            }
            await collectProjectedItems(projected);
          },
        );
        return result.complete;
      }),
      streamExpiryPages(
        'service_agreements',
        sourceRequested.agreements,
        (offset) =>
          this.sources.agreements.operationsExpiryPage(principal, {
            ...query,
            fromDate:
              query.fromDate && query.fromDate > deadlineFrom ? query.fromDate : deadlineFrom,
            untilDate:
              query.untilDate && query.untilDate < deadlineUntil ? query.untilDate : deadlineUntil,
            offset,
            pageSize: 100,
          }),
        async (rows) => {
          const timezones = await this.organizationTimezones(
            principal,
            rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)),
          );
          await collectProjectedItems(
            rows.flatMap((agreement) => {
              if (!agreement.validUntil) return [];
              const dueAt = endOfLocalDay(
                agreement.validUntil,
                timezones.get(agreement.organizationId) ?? 'Europe/Berlin',
              );
              if (!dueAt) return [];
              return [
                this.workItem({
                  sourceDomain: 'service_agreements',
                  entityType: 'agreement',
                  entityId: agreement.id,
                  issueCode: 'agreement_expiry',
                  category: 'agreements',
                  severity: new Date(dueAt) < observedAt ? 'critical' : 'warning',
                  organizationId: agreement.organizationId,
                  facilityId: agreement.facilityId,
                  clientId: agreement.clientId,
                  clientName: agreement.clientName,
                  dueAt,
                  sourceAt: new Date(`${agreement.validUntil}T12:00:00.000Z`),
                  descriptionCode: 'operations.issues.agreements.expiry',
                }),
              ];
            }),
          );
        },
      ),
      streamExpiryPages(
        'employee_qualifications',
        sourceRequested.qualifications,
        (offset) =>
          this.sources.qualifications.operationsExpiryPage(principal, {
            ...query,
            fromDate:
              query.fromDate && query.fromDate > deadlineFrom ? query.fromDate : deadlineFrom,
            untilDate:
              query.untilDate && query.untilDate < deadlineUntil ? query.untilDate : deadlineUntil,
            offset,
            pageSize: 100,
          }),
        async (rows) => {
          const timezones = await this.organizationTimezones(
            principal,
            rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)),
          );
          await collectProjectedItems(
            rows.flatMap((qualification) => {
              if (!qualification.validUntil || !qualification.organizationId) return [];
              const dueAt = endOfLocalDay(
                qualification.validUntil,
                timezones.get(qualification.organizationId) ?? 'Europe/Berlin',
              );
              if (!dueAt) return [];
              return [
                this.workItem({
                  sourceDomain: 'employee_qualifications',
                  entityType: 'employee_qualification',
                  entityId: qualification.id,
                  issueCode: 'qualification_expiry',
                  category: 'employees',
                  severity: new Date(dueAt) < observedAt ? 'critical' : 'warning',
                  organizationId: qualification.organizationId,
                  facilityId: qualification.facilityId,
                  clientId: null,
                  clientName: null,
                  employeeId: qualification.employeeId,
                  employeeName: qualification.employeeName,
                  dueAt,
                  sourceAt: new Date(`${qualification.validUntil}T12:00:00.000Z`),
                  descriptionCode: 'operations.issues.employees.qualification_expiry',
                }),
              ];
            }),
          );
        },
      ),
      streamExpiryPages(
        'benefits',
        sourceRequested.benefitDeadlines,
        (offset) =>
          this.sources.benefitExpiry.operationsExpiryPage(principal, {
            ...query,
            fromDate:
              query.fromDate && query.fromDate > deadlineFrom ? query.fromDate : deadlineFrom,
            untilDate:
              query.untilDate && query.untilDate < deadlineUntil ? query.untilDate : deadlineUntil,
            offset,
            pageSize: 100,
          }),
        async (rows) => {
          const timezones = await this.organizationTimezones(
            principal,
            rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)),
          );
          await collectProjectedItems(
            rows.flatMap((entitlement) => {
              if (!entitlement.validUntil || !entitlement.organizationId) return [];
              const dueAt = endOfLocalDay(
                entitlement.validUntil,
                timezones.get(entitlement.organizationId) ?? 'Europe/Berlin',
              );
              if (!dueAt) return [];
              return [
                this.workItem({
                  sourceDomain: 'benefits',
                  entityType: 'benefit_entitlement',
                  entityId: entitlement.id,
                  issueCode: 'benefit_entitlement_expiry',
                  category: 'benefits',
                  severity: new Date(dueAt) < observedAt ? 'critical' : 'warning',
                  organizationId: entitlement.organizationId,
                  facilityId: entitlement.facilityId,
                  clientId: entitlement.clientId,
                  clientName: entitlement.clientName,
                  dueAt,
                  sourceAt: new Date(`${entitlement.validUntil}T12:00:00.000Z`),
                  descriptionCode: 'operations.issues.benefits.entitlement_expiry',
                }),
              ];
            }),
          );
        },
      ),
      streamExpiryPages(
        'billing',
        sourceRequested.payerArrangements,
        (offset) =>
          this.sources.payerExpiry.operationsExpiryPage(principal, {
            ...query,
            fromDate:
              query.fromDate && query.fromDate > deadlineFrom ? query.fromDate : deadlineFrom,
            untilDate:
              query.untilDate && query.untilDate < deadlineUntil ? query.untilDate : deadlineUntil,
            offset,
            pageSize: 100,
            effectiveOn: todayUtc,
          }),
        async (rows) => {
          const timezones = await this.organizationTimezones(
            principal,
            rows.map((row) => row.organizationId),
          );
          await collectProjectedItems(
            rows.flatMap((arrangement) => {
              if (!arrangement.validUntil) return [];
              const timezone = timezones.get(arrangement.organizationId) ?? 'Europe/Berlin';
              const dueAt = endOfLocalDay(arrangement.validUntil, timezone);
              if (!dueAt) return [];
              return [
                this.workItem({
                  sourceDomain: 'billing',
                  entityType: 'payer_arrangement',
                  entityId: arrangement.id,
                  issueCode: 'payer_authorization_expiry',
                  category: 'billing',
                  severity: new Date(dueAt) < observedAt ? 'critical' : 'warning',
                  organizationId: arrangement.organizationId,
                  facilityId: arrangement.facilityId,
                  clientId: arrangement.clientId,
                  clientName: arrangement.clientName,
                  dueAt,
                  sourceAt: new Date(`${arrangement.validUntil}T12:00:00.000Z`),
                  descriptionCode: 'operations.issues.billing.payer_authorization_expiry',
                }),
              ];
            }),
          );
        },
      ),
    ]);
    const completeDomains = new Map<string, ReconciliationWindow>();
    if (scheduleComplete) completeDomains.set('scheduling', { from: now, until });
    if (executionComplete) completeDomains.set('visit_execution', { from, until: sourceUntil });
    if (documentationComplete)
      completeDomains.set('care_documentation', { from: documentationFrom, until: sourceUntil });
    if (evidenceComplete) completeDomains.set('service_evidence', { from, until: sourceUntil });
    if (benefitsComplete && benefitEntitlementsComplete)
      completeDomains.set('benefits', { from: null, until: null });
    if (invoiceDocumentsComplete && receivablesComplete && payerArrangementsComplete)
      completeDomains.set('billing', { from: null, until: null });
    if (claimsComplete) completeDomains.set('claims', { from: null, until: null });
    if (onboardingComplete) completeDomains.set('onboarding', { from: null, until: null });
    if (agreementsComplete) completeDomains.set('service_agreements', { from: null, until: null });
    if (qualificationsComplete)
      completeDomains.set('employee_qualifications', { from: null, until: null });

    const hasNarrowedResourceScope = Boolean(
      query.organizationId ||
      query.facilityId ||
      query.clientId ||
      query.employeeId ||
      query.fromDate ||
      query.untilDate,
    );
    await this.syncExceptionOccurrences(
      principal,
      [],
      hasNarrowedResourceScope ? new Map() : completeDomains,
      observedAt,
    );
    await this.reconcileStaleExceptionOccurrences(principal, [], observedAt);
    retained.sort(compareWorkItems);
    return {
      items: retained.slice(resultOffset, resultOffset + responsePageSize),
      page: responsePage,
      pageSize: responsePageSize,
      total,
      truncated,
    };
  }

  async exceptionHistory(
    principal: AuthorizationPrincipal,
    issueId: string,
    query: { page?: number; pageSize?: number } = {},
  ) {
    this.requireAnyGrant(principal, 'operations.read');
    if (!/^[a-f0-9]{64}$/.test(issueId)) throw new OperationsWorkItemNotFoundError();
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 50, 1, 100);

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const issueScope = and(
        eq(exceptionOccurrences.tenantId, principal.tenantId),
        eq(exceptionOccurrences.issueKey, issueId),
      );
      const visibleScope = and(
        issueScope,
        exceptionPermissionScope(principal, 'operations.read'),
        exceptionClientReadScope(principal),
        exceptionSourceReadScope(principal),
      );
      const [rawCountRows, visibleCountRows, occurrences] = await Promise.all([
        transaction.select({ value: count() }).from(exceptionOccurrences).where(issueScope),
        transaction.select({ value: count() }).from(exceptionOccurrences).where(visibleScope),
        transaction
          .select()
          .from(exceptionOccurrences)
          .where(visibleScope)
          .orderBy(desc(exceptionOccurrences.firstDetectedAt), desc(exceptionOccurrences.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);
      const rawCount = Number(rawCountRows[0]?.value ?? 0);
      const totalOccurrences = Number(visibleCountRows[0]?.value ?? 0);
      if (totalOccurrences === 0) throw new OperationsWorkItemNotFoundError();

      const occurrenceQuery = transaction
        .select({ id: exceptionOccurrences.id })
        .from(exceptionOccurrences)
        .where(visibleScope);
      const interactionLinks = [inArray(exceptionInteractions.occurrenceId, occurrenceQuery)];
      if (totalOccurrences === rawCount) {
        interactionLinks.push(isNull(exceptionInteractions.occurrenceId));
      }
      const interactionScope = and(
        eq(exceptionInteractions.tenantId, principal.tenantId),
        eq(exceptionInteractions.issueKey, issueId),
        or(...interactionLinks)!,
      );
      const [interactionCount] = await transaction
        .select({ value: count() })
        .from(exceptionInteractions)
        .where(interactionScope);
      const interactions = await transaction
        .select({
          id: exceptionInteractions.id,
          occurrenceId: exceptionInteractions.occurrenceId,
          action: exceptionInteractions.action,
          previousState: exceptionInteractions.previousState,
          snoozedUntil: exceptionInteractions.snoozedUntil,
          reason: exceptionInteractions.reason,
          actorUserId: exceptionInteractions.actorUserId,
          occurredAt: exceptionInteractions.occurredAt,
        })
        .from(exceptionInteractions)
        .where(interactionScope)
        .orderBy(desc(exceptionInteractions.occurredAt), desc(exceptionInteractions.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        issueId,
        page,
        pageSize,
        totalOccurrences,
        totalInteractions: Number(interactionCount?.value ?? 0),
        occurrences: occurrences.map((row) => ({
          id: row.id,
          sourceDomain: row.sourceDomain,
          sourceEntityType: row.sourceEntityType,
          sourceEntityId: row.sourceEntityId,
          issueCode: row.issueCode,
          category: row.category,
          severity: row.severity,
          organizationId: row.organizationId,
          facilityId: row.facilityId,
          clientId: row.clientId,
          firstDetectedAt: row.firstDetectedAt.toISOString(),
          lastObservedAt: row.lastObservedAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
        })),
        interactions: interactions.map((row) => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
          snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
        })),
      };
    });
  }

  async createTask(
    principal: AuthorizationPrincipal,
    input: OperationsTaskInput,
    request: RequestContext,
    auditContext: AuditContext,
    sourceDeadlineKey: string | null = null,
  ) {
    return this.taskManagement.createTask(
      principal,
      input,
      request,
      auditContext,
      sourceDeadlineKey,
    );
  }

  async createDeadlineTask(
    principal: AuthorizationPrincipal,
    issueId: string,
    input: Pick<OperationsTaskInput, 'title' | 'description' | 'priority' | 'assignedEmployeeId'>,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const deadline = await this.findCurrentWorkItem(principal, issueId, { deadlinesOnly: true });
    if (
      !deadline ||
      deadline.sourceDomain !== 'service_agreements' ||
      deadline.issueCode !== 'agreement_expiry'
    ) {
      throw new OperationsWorkItemNotFoundError();
    }
    if (!deadline.organizationId) throw new OperationsWorkItemNotFoundError();
    return this.createTask(
      principal,
      {
        organizationId: deadline.organizationId,
        facilityId: deadline.facilityId,
        clientId: deadline.clientId,
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.assignedEmployeeId !== undefined
          ? { assignedEmployeeId: input.assignedEmployeeId }
          : {}),
        dueAt: deadline.dueAt ? new Date(deadline.dueAt) : null,
        source: { type: 'service_agreement', id: deadline.sourceEntityId },
      },
      request,
      auditContext,
      issueId,
    );
  }

  async listTasks(principal: AuthorizationPrincipal, query: OperationsTaskListQuery = {}) {
    return this.taskManagement.listTasks(principal, query);
  }

  async listWorkQueue(principal: AuthorizationPrincipal, query: OperationsWorkQueueQuery = {}) {
    this.requireAnyGrant(principal, 'operations.read');
    const itemType = query.itemType ?? 'all';
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 50, 1, 100);
    const includeTasks = itemType !== 'exceptions';
    const includeExceptions = itemType !== 'tasks';
    const taskSourceTypes = query.sourceDomain
      ? taskSourceTypesForDomain(query.sourceDomain)
      : null;
    const exceptionAssigneeId =
      query.assignedEmployeeId ??
      (query.assignedToMe
        ? await this.taskData.employeeForUser(principal.tenantId, principal.userId)
        : undefined);
    const taskQuery: OperationsTaskListQuery = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.facilityId ? { facilityId: query.facilityId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.taskStatus ? { status: query.taskStatus } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
      ...(query.assignedToMe ? { assignedToMe: true } : {}),
      ...(query.due ? { due: query.due } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.untilDate ? { untilDate: query.untilDate } : {}),
      ...(query.search ? { search: query.search } : {}),
      order: query.sort !== 'due' ? 'priority' : 'due',
      ...(taskSourceTypes ? { sourceTypes: taskSourceTypes } : {}),
    };
    const exceptionQuery: OperationsQuery = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.facilityId ? { facilityId: query.facilityId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.sourceDomain ? { sourceDomain: query.sourceDomain } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.exceptionStatus ? { status: query.exceptionStatus } : {}),
      ...(exceptionAssigneeId ? { assignedEmployeeId: exceptionAssigneeId } : {}),
      ...(query.due ? { due: query.due } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.untilDate ? { untilDate: query.untilDate } : {}),
      ...(query.search ? { search: query.search } : {}),
      sort: query.sort === 'due' ? 'due' : 'relevance',
    };
    const [firstTaskPage, firstExceptionPage] = await Promise.all([
      includeTasks
        ? this.listTasks(principal, { ...taskQuery, page: 1, pageSize: 100, offset: 0 })
        : Promise.resolve({ items: [], page: 1, pageSize: 100, total: 0 }),
      includeExceptions && (!query.assignedToMe || exceptionAssigneeId)
        ? this.listWorkItems(principal, { ...exceptionQuery, page: 1, pageSize: 1000, offset: 0 })
        : Promise.resolve({ items: [], page: 1, pageSize: 1000, total: 0, truncated: false }),
    ]);
    const taskTotal = firstTaskPage.total;
    const exceptionTotal = firstExceptionPage.total;
    const total = taskTotal + exceptionTotal;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    let taskItems = firstTaskPage.items;
    let taskItemIndex = 0;
    let taskOffset = taskItems.length;
    let exceptionItems = firstExceptionPage.items;
    let exceptionItemIndex = 0;
    let exceptionOffset = exceptionItems.length;
    let truncated =
      firstExceptionPage.truncated ||
      taskItems.length !== Math.min(100, taskTotal) ||
      exceptionItems.length !== Math.min(1000, exceptionTotal);
    const nextTask = async () => {
      if (taskItemIndex >= taskItems.length && taskOffset < taskTotal) {
        const result = await this.listTasks(principal, {
          ...taskQuery,
          page: 1,
          pageSize: 100,
          offset: taskOffset,
        });
        truncated ||=
          result.total !== taskTotal ||
          result.items.length !== Math.min(100, taskTotal - taskOffset);
        taskItems = result.items;
        taskItemIndex = 0;
        taskOffset += taskItems.length;
      }
      return taskItems[taskItemIndex++] ?? null;
    };
    const nextException = async () => {
      if (exceptionItemIndex >= exceptionItems.length && exceptionOffset < exceptionTotal) {
        const result = await this.listWorkItems(principal, {
          ...exceptionQuery,
          page: 1,
          pageSize: 1000,
          offset: exceptionOffset,
        });
        truncated ||=
          result.total !== exceptionTotal ||
          result.items.length !== Math.min(1000, exceptionTotal - exceptionOffset);
        exceptionItems = result.items;
        exceptionItemIndex = 0;
        exceptionOffset += exceptionItems.length;
        truncated ||= result.truncated;
      }
      return exceptionItems[exceptionItemIndex++] ?? null;
    };
    const dueTime = (value: Date | string | null) =>
      value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
    const priority = (
      item: Awaited<ReturnType<typeof nextTask>> | Awaited<ReturnType<typeof nextException>>,
    ) => {
      if (!item) return Number.NEGATIVE_INFINITY;
      if ('priority' in item) {
        return item.priority === 'urgent'
          ? 4
          : item.priority === 'high'
            ? 3
            : item.priority === 'normal'
              ? 2
              : 1;
      }
      return severityWeight(item.severity);
    };
    const compareItems = (
      left:
        | NonNullable<Awaited<ReturnType<typeof nextTask>>>
        | NonNullable<Awaited<ReturnType<typeof nextException>>>,
      right:
        | NonNullable<Awaited<ReturnType<typeof nextTask>>>
        | NonNullable<Awaited<ReturnType<typeof nextException>>>,
    ) => {
      const byPriority = query.sort === 'due' ? 0 : priority(right) - priority(left);
      return (
        byPriority ||
        dueTime(left.dueAt) - dueTime(right.dueAt) ||
        ('priority' in left ? -1 : 1) - ('priority' in right ? -1 : 1) ||
        right.id.localeCompare(left.id)
      );
    };
    let taskHead = await nextTask();
    let exceptionHead = await nextException();
    let globalIndex = 0;
    const items: Array<
      | { kind: 'task'; task: NonNullable<typeof taskHead> }
      | { kind: 'exception'; exception: NonNullable<typeof exceptionHead> }
    > = [];
    // oxlint-disable no-await-in-loop
    while (globalIndex < end && (taskHead || exceptionHead)) {
      const takeTask =
        !exceptionHead || (taskHead !== null && compareItems(taskHead, exceptionHead) <= 0);
      if (takeTask && taskHead) {
        if (globalIndex >= start) items.push({ kind: 'task', task: taskHead });
        taskHead = await nextTask();
      } else if (exceptionHead) {
        if (globalIndex >= start) items.push({ kind: 'exception', exception: exceptionHead });
        exceptionHead = await nextException();
      }
      globalIndex += 1;
    }
    // oxlint-enable no-await-in-loop
    return {
      items,
      page,
      pageSize,
      total,
      truncated,
    };
  }

  async getTask(principal: AuthorizationPrincipal, taskId: string) {
    return this.taskManagement.getTask(principal, taskId);
  }

  async taskActivityList(principal: AuthorizationPrincipal, taskId: string) {
    return this.taskManagement.taskActivityList(principal, taskId);
  }

  async patchTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    input: OperationsTaskPatch,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.taskManagement.patchTask(principal, taskId, input, request, auditContext);
  }

  async startTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.taskManagement.startTask(principal, taskId, expectedVersion, request, auditContext);
  }

  async completeTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.taskManagement.completeTask(
      principal,
      taskId,
      expectedVersion,
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
    return this.taskManagement.reopenTask(
      principal,
      taskId,
      expectedVersion,
      request,
      auditContext,
    );
  }

  async cancelTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.taskManagement.cancelTask(
      principal,
      taskId,
      expectedVersion,
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
    return this.taskManagement.addComment(principal, taskId, comment, request, auditContext);
  }

  async acknowledgeException(
    principal: AuthorizationPrincipal,
    id: string,
    reason: string | undefined,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const item = await this.findCurrentWorkItem(principal, id);
    assertCan(principal, {
      action: 'operations.exceptions.manage',
      resource: workItemResource(principal, item),
    });
    if (reason !== undefined && (reason.trim().length < 1 || reason.trim().length > 500))
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const now = new Date();
      const occurrence = await this.activeExceptionOccurrence(
        transaction,
        principal.tenantId,
        item.id,
      );
      if (!occurrence) throw new OperationsWorkItemNotFoundError();
      const previous = await this.latestExceptionInteraction(
        transaction,
        principal.tenantId,
        occurrence.id,
      );
      await transaction.insert(exceptionInteractions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        issueKey: item.id,
        occurrenceId: occurrence.id,
        action: 'acknowledged',
        previousState: exceptionState(previous, now),
        snoozedUntil: null,
        reason: reason?.trim() || null,
        actorUserId: principal.userId,
        occurredAt: now,
      });
      await this.recordExceptionChange(
        transaction,
        principal,
        request,
        auditContext,
        item,
        occurrence.id,
        'acknowledged',
      );
      return { id: item.id, status: 'acknowledged' as const, occurredAt: now.toISOString() };
    });
  }

  async snoozeException(
    principal: AuthorizationPrincipal,
    id: string,
    snoozedUntil: Date,
    reason: string | undefined,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const item = await this.findCurrentWorkItem(principal, id);
    if (item.severity === 'critical') throw new InvalidOperationsInputError();
    assertCan(principal, {
      action: 'operations.exceptions.manage',
      resource: workItemResource(principal, item),
    });
    const now = new Date();
    if (
      !Number.isFinite(snoozedUntil.getTime()) ||
      snoozedUntil <= now ||
      snoozedUntil.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1000
    ) {
      throw new InvalidOperationsInputError();
    }
    if (reason !== undefined && (reason.trim().length < 1 || reason.trim().length > 500))
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const occurrence = await this.activeExceptionOccurrence(
        transaction,
        principal.tenantId,
        item.id,
      );
      if (!occurrence) throw new OperationsWorkItemNotFoundError();
      const previous = await this.latestExceptionInteraction(
        transaction,
        principal.tenantId,
        occurrence.id,
      );
      await transaction.insert(exceptionInteractions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        issueKey: item.id,
        occurrenceId: occurrence.id,
        action: 'snoozed',
        previousState: exceptionState(previous, now),
        snoozedUntil,
        reason: reason?.trim() || null,
        actorUserId: principal.userId,
        occurredAt: now,
      });
      await this.recordExceptionChange(
        transaction,
        principal,
        request,
        auditContext,
        item,
        occurrence.id,
        'snoozed',
        snoozedUntil,
      );
      return { id: item.id, status: 'snoozed' as const, snoozedUntil: snoozedUntil.toISOString() };
    });
  }

  private async clientResources(tenantId: string, clientIds: string[]) {
    if (!clientIds.length)
      return new Map<string, { organizationId: string | null; facilityId: string | null }>();
    const rows = await this.unitOfWork.transaction({ tenantId }, async (transaction) =>
      transaction
        .select({
          id: clientRecords.id,
          organizationId: clientRecords.organizationId,
          facilityId: clientRecords.primaryFacilityId,
        })
        .from(clientRecords)
        .where(
          and(
            eq(clientRecords.tenantId, tenantId),
            inArray(clientRecords.id, [...new Set(clientIds)]),
          ),
        ),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { organizationId: row.organizationId, facilityId: row.facilityId },
      ]),
    );
  }

  private organizationTimezones(principal: AuthorizationPrincipal, organizationIds: string[]) {
    return this.sources.organizations.operationsTimezones(principal, organizationIds);
  }

  private requireAnyGrant(principal: AuthorizationPrincipal, permission: Permission) {
    if (!hasGrant(principal, permission)) throw new AuthorizationDeniedError(permission);
  }

  private workItem(input: {
    sourceDomain: string;
    entityType: string;
    entityId: string;
    issueCode: string;
    category: OperationsWorkItem['category'];
    severity: OperationsWorkItem['severity'];
    organizationId: string | null;
    facilityId: string | null;
    clientId: string | null;
    clientName: string | null;
    employeeId?: string | null;
    employeeName?: string | null;
    dueAt: string | null;
    sourceAt?: Date | null;
    descriptionCode: string;
  }): ProjectedOperationsWorkItem {
    const { entityType, entityId, sourceAt, ...workItem } = input;
    const id = stableIssueId(input.sourceDomain, entityType, entityId, input.issueCode);
    return {
      ...workItem,
      clientName: displayNameWithoutIdentifiers(workItem.clientName),
      employeeId: input.employeeId ?? null,
      employeeName: displayNameWithoutIdentifiers(input.employeeName ?? null),
      [projectionSourceAt]: sourceAt ?? (input.dueAt ? new Date(input.dueAt) : null),
      id,
      kind: 'exception',
      sourceEntityType: entityType,
      sourceEntityId: entityId,
      titleCode: `operations.issueTitles.${input.issueCode}`,
      categoryLabelCode: `operations.categories.${input.category}`,
      status: 'open',
      firstDetectedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      interaction: null,
    };
  }

  private async reconcileStaleExceptionOccurrences(
    principal: AuthorizationPrincipal,
    currentItems: ProjectedOperationsWorkItem[],
    observedAt: Date,
  ) {
    const currentKeys = new Set(currentItems.map((item) => item.id));
    const candidates = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) =>
        transaction
          .select()
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              isNull(exceptionOccurrences.resolvedAt),
              lt(exceptionOccurrences.lastObservedAt, observedAt),
              inArray(exceptionOccurrences.sourceDomain, [
                'scheduling',
                'visit_execution',
                'care_documentation',
                'service_evidence',
                'onboarding',
                'service_agreements',
                'employee_qualifications',
              ]),
            ),
          )
          .orderBy(asc(exceptionOccurrences.lastObservedAt), asc(exceptionOccurrences.id))
          .limit(200),
    );
    const resolvable = candidates
      .filter((row) => {
        if (currentKeys.has(row.issueKey)) return false;
        const permission = exceptionReadPermission(row.sourceDomain, row.issueCode);
        const resource: ResourceContext = {
          tenantId: row.tenantId,
          ...(row.organizationId ? { organizationId: row.organizationId } : {}),
          ...(row.facilityId ? { facilityId: row.facilityId } : {}),
          ...(row.clientId ? { clientId: row.clientId } : {}),
        };
        return (
          permission !== null &&
          can(principal, { action: 'operations.read', resource }) &&
          can(principal, { action: permission, resource })
        );
      })
      .slice(0, MAX_STALE_EXCEPTION_RECONCILIATIONS);
    if (!resolvable.length) return;

    const resolved: Array<{ id: string; lastObservedAt: Date }> = [];
    // Keep this bounded read sequential so one refresh cannot burst dozens of source transactions.
    // oxlint-disable no-await-in-loop
    for (const occurrence of resolvable) {
      const stillCurrent = await this.staleOccurrenceStillCurrent(principal, occurrence);
      if (stillCurrent === false) {
        resolved.push({ id: occurrence.id, lastObservedAt: occurrence.lastObservedAt });
      }
    }
    // oxlint-enable no-await-in-loop
    if (!resolved.length) return;

    const expected = sql.join(
      resolved.map((row) => sql`(${row.id}::uuid, ${row.lastObservedAt}::timestamptz)`),
      sql`, `,
    );
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      transaction.execute(sql`
        UPDATE operations.exception_occurrences AS occurrence
        SET resolved_at = ${observedAt}, version = occurrence.version + 1
        FROM (VALUES ${expected}) AS checked(id, last_observed_at)
        WHERE occurrence.tenant_id = ${principal.tenantId}
          AND occurrence.id = checked.id
          AND occurrence.resolved_at IS NULL
          AND occurrence.last_observed_at = checked.last_observed_at
      `),
    );
  }

  private async staleOccurrenceStillCurrent(
    principal: AuthorizationPrincipal,
    occurrence: typeof exceptionOccurrences.$inferSelect,
  ): Promise<boolean | null> {
    if (occurrence.sourceDomain === 'scheduling' && occurrence.sourceEntityType === 'visit') {
      try {
        const result = await this.sources.scheduling.getWorklistForVisit(
          principal,
          occurrence.sourceEntityId,
        );
        if (!result.complete) return null;
        return (
          result.item?.conflicts.some((conflict) => conflict.code === occurrence.issueCode) ?? false
        );
      } catch (error) {
        if (
          error instanceof AuthorizationDeniedError ||
          error instanceof VisitNotFoundError ||
          error instanceof VisitOutsideProviderContextError
        ) {
          return null;
        }
        throw error;
      }
    }
    if (
      occurrence.sourceDomain === 'care_documentation' &&
      occurrence.sourceEntityType === 'visit'
    ) {
      try {
        const detail = await this.sources.documentation.getForVisit(
          principal,
          occurrence.sourceEntityId,
        );
        return detail.completeness.missing.some(
          (item) => `documentation_${item.code.toLowerCase()}` === occurrence.issueCode,
        );
      } catch (error) {
        if (error instanceof CareDocumentationNotFoundError) return false;
        if (
          error instanceof AuthorizationDeniedError ||
          error instanceof CareDocumentationVisitRelationshipRequiredError
        ) {
          return null;
        }
        throw error;
      }
    }
    if (occurrence.sourceDomain === 'visit_execution' && occurrence.sourceEntityType === 'visit') {
      const state = await this.sources.execution.operationsIssueState(
        principal,
        occurrence.sourceEntityId,
      );
      return state.overdueIncomplete;
    }
    if (occurrence.sourceDomain === 'service_evidence') {
      if (occurrence.sourceEntityType === 'documentation') return false;
      if (occurrence.sourceEntityType !== 'evidence_package') return null;
      try {
        const evidencePackage = await this.sources.evidence.getPackage(
          principal,
          occurrence.sourceEntityId,
        );
        return evidencePackageIssueCode(evidencePackage.status) === occurrence.issueCode;
      } catch (error) {
        if (error instanceof EvidencePackageNotFoundError) return false;
        if (
          error instanceof AuthorizationDeniedError ||
          error instanceof ServiceEvidenceVisitRelationshipRequiredError
        ) {
          return null;
        }
        throw error;
      }
    }
    if (
      occurrence.sourceDomain === 'onboarding' &&
      occurrence.sourceEntityType === 'admission_case'
    ) {
      if (!this.sources.onboarding) return null;
      try {
        const state = await this.sources.onboarding.operationsIssueState(
          principal,
          occurrence.sourceEntityId,
        );
        if (occurrence.issueCode === 'admission_readiness_blocked') return state.readinessBlocked;
        if (occurrence.issueCode === 'admission_follow_up_overdue') return state.followUpOverdue;
        if (occurrence.issueCode === 'admission_follow_up_due') return state.followUpDue;
        if (occurrence.issueCode === 'admission_start_date') return state.startDateActionable;
        return null;
      } catch (error) {
        if (
          error instanceof AuthorizationDeniedError ||
          (error instanceof Error && 'code' in error && error.code === 'ONBOARDING_CASE_NOT_FOUND')
        ) {
          return null;
        }
        throw error;
      }
    }
    return null;
  }

  private async syncExceptionOccurrences(
    principal: AuthorizationPrincipal,
    items: ProjectedOperationsWorkItem[],
    completeDomains: Map<string, ReconciliationWindow>,
    observedAt: Date,
  ) {
    const currentItems = deduplicateWorkItems(items);
    const issueKeys = [...new Set(currentItems.map((item) => item.id))];
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${principal.tenantId}, 0))
      `);
      const activeCurrent = issueKeys.length
        ? await transaction
            .select({
              id: exceptionOccurrences.id,
              issueKey: exceptionOccurrences.issueKey,
              sourceAt: exceptionOccurrences.sourceAt,
            })
            .from(exceptionOccurrences)
            .where(
              and(
                eq(exceptionOccurrences.tenantId, principal.tenantId),
                inArray(exceptionOccurrences.issueKey, issueKeys),
                isNull(exceptionOccurrences.resolvedAt),
              ),
            )
        : [];
      const itemByKey = new Map(currentItems.map((item) => [item.id, item]));
      const superseded = activeCurrent.filter((row) => {
        const item = itemByKey.get(row.issueKey);
        if (!item || !deadlinePolicyCategory(item) || !item.dueAt) return false;
        const nextSourceAt = item[projectionSourceAt];
        return row.sourceAt?.getTime() !== nextSourceAt?.getTime();
      });
      if (superseded.length) {
        await transaction
          .update(exceptionOccurrences)
          .set({ resolvedAt: observedAt, version: sql`${exceptionOccurrences.version} + 1` })
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              inArray(
                exceptionOccurrences.id,
                superseded.map((row) => row.id),
              ),
              isNull(exceptionOccurrences.resolvedAt),
            ),
          );
      }
      const supersededIds = new Set(superseded.map((row) => row.id));
      const activeKeys = new Set(
        activeCurrent.filter((row) => !supersededIds.has(row.id)).map((row) => row.issueKey),
      );
      const missing = currentItems.filter((item) => !activeKeys.has(item.id));
      if (missing.length) {
        const latestResolved = await transaction
          .select({
            issueKey: exceptionOccurrences.issueKey,
            resolvedAt: max(exceptionOccurrences.resolvedAt),
          })
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              inArray(
                exceptionOccurrences.issueKey,
                missing.map((item) => item.id),
              ),
              isNotNull(exceptionOccurrences.resolvedAt),
            ),
          )
          .groupBy(exceptionOccurrences.issueKey);
        const resolvedAtByKey = new Map(
          latestResolved.map((row) => [row.issueKey, row.resolvedAt]),
        );
        const candidates = missing.filter((item) => {
          const resolvedAt = resolvedAtByKey.get(item.id);
          return !resolvedAt || resolvedAt <= observedAt;
        });
        if (candidates.length) {
          await transaction
            .insert(exceptionOccurrences)
            .values(
              candidates.map((item) => ({
                id: uuidv7(),
                tenantId: principal.tenantId,
                issueKey: item.id,
                sourceDomain: item.sourceDomain,
                sourceEntityType: item.sourceEntityType,
                sourceEntityId: item.sourceEntityId,
                issueCode: item.issueCode,
                category: item.category,
                severity: item.severity,
                organizationId: item.organizationId,
                facilityId: item.facilityId,
                clientId: item.clientId,
                sourceAt: item[projectionSourceAt],
                firstDetectedAt: observedAt,
                lastObservedAt: observedAt,
                resolvedAt: null,
                version: 1,
              })),
            )
            .onConflictDoNothing();
        }
      }

      if (currentItems.length) {
        const observedValues = sql.join(
          currentItems.map((item) => sql`(${item.id}, ${item[projectionSourceAt]}::timestamptz)`),
          sql`, `,
        );
        await transaction.execute(sql`
          UPDATE operations.exception_occurrences AS occurrence
          SET last_observed_at = ${observedAt},
              source_at = observed.source_at,
              version = occurrence.version + 1
          FROM (VALUES ${observedValues}) AS observed(issue_key, source_at)
          WHERE occurrence.tenant_id = ${principal.tenantId}
            AND occurrence.issue_key = observed.issue_key
            AND occurrence.resolved_at IS NULL
            AND occurrence.last_observed_at < ${observedAt}
        `);
      }

      if (!completeDomains.size) return;
      // oxlint-disable no-await-in-loop
      for (const [sourceDomain, window] of completeDomains) {
        const sourceWindowScope = completeSourceEntityScope(
          transaction,
          principal,
          sourceDomain,
          window,
        );
        const conditions = [
          eq(exceptionOccurrences.tenantId, principal.tenantId),
          eq(exceptionOccurrences.sourceDomain, sourceDomain),
          isNull(exceptionOccurrences.resolvedAt),
          lt(exceptionOccurrences.lastObservedAt, observedAt),
          exceptionPermissionScope(principal, 'operations.read'),
          exceptionClientReadScope(principal),
          exceptionSourceReadScope(principal),
          ...(window.from ? [gte(exceptionOccurrences.sourceAt, window.from)] : []),
          ...(window.until ? [lt(exceptionOccurrences.sourceAt, window.until)] : []),
          ...(sourceWindowScope ? [sourceWindowScope] : []),
        ];
        await transaction
          .update(exceptionOccurrences)
          .set({ resolvedAt: observedAt, version: sql`${exceptionOccurrences.version} + 1` })
          .where(and(...conditions));
      }
      // oxlint-enable no-await-in-loop
    });
  }

  private async attachInteractions(
    principal: AuthorizationPrincipal,
    items: ProjectedOperationsWorkItem[],
  ) {
    if (!items.length) return items;
    const issueKeys = [...new Set(items.map((item) => item.id))];
    const [occurrences, interactions] = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const active = await transaction
          .select()
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              inArray(exceptionOccurrences.issueKey, issueKeys),
              isNull(exceptionOccurrences.resolvedAt),
            ),
          );
        const occurrenceIds = active.map((row) => row.id);
        const history = occurrenceIds.length
          ? await transaction
              .select()
              .from(exceptionInteractions)
              .where(
                and(
                  eq(exceptionInteractions.tenantId, principal.tenantId),
                  inArray(exceptionInteractions.occurrenceId, occurrenceIds),
                ),
              )
              .orderBy(desc(exceptionInteractions.occurredAt), desc(exceptionInteractions.id))
          : [];
        return [active, history] as const;
      },
    );
    const occurrenceByKey = new Map(occurrences.map((row) => [row.issueKey, row]));
    const latest = new Map<string, (typeof interactions)[number]>();
    for (const row of interactions) {
      if (row.occurrenceId && !latest.has(row.occurrenceId)) latest.set(row.occurrenceId, row);
    }
    const now = Date.now();
    return items.map((item) => {
      const occurrence = occurrenceByKey.get(item.id);
      if (!occurrence) return item;
      const current = {
        ...item,
        firstDetectedAt: occurrence.firstDetectedAt.toISOString(),
        lastObservedAt: occurrence.lastObservedAt.toISOString(),
      };
      const interaction = latest.get(occurrence.id);
      if (!interaction) return current;
      const status: OperationsWorkItem['status'] =
        interaction.action === 'snoozed' &&
        interaction.snoozedUntil &&
        interaction.snoozedUntil.getTime() > now
          ? 'snoozed'
          : interaction.action === 'acknowledged'
            ? 'acknowledged'
            : 'open';
      return {
        ...current,
        status,
        interaction: {
          action: interaction.action,
          occurredAt: interaction.occurredAt.toISOString(),
          previousState: interaction.previousState,
          snoozedUntil: interaction.snoozedUntil?.toISOString() ?? null,
          reason: interaction.reason,
        },
      };
    });
  }

  private async latestExceptionInteraction(
    transaction: DatabaseTransaction,
    tenantId: string,
    occurrenceId: string,
  ) {
    const [interaction] = await transaction
      .select()
      .from(exceptionInteractions)
      .where(
        and(
          eq(exceptionInteractions.tenantId, tenantId),
          eq(exceptionInteractions.occurrenceId, occurrenceId),
        ),
      )
      .orderBy(desc(exceptionInteractions.occurredAt), desc(exceptionInteractions.id))
      .limit(1);
    return interaction ?? null;
  }

  private async activeExceptionOccurrence(
    transaction: DatabaseTransaction,
    tenantId: string,
    issueKey: string,
  ) {
    const [occurrence] = await transaction
      .select()
      .from(exceptionOccurrences)
      .where(
        and(
          eq(exceptionOccurrences.tenantId, tenantId),
          eq(exceptionOccurrences.issueKey, issueKey),
          isNull(exceptionOccurrences.resolvedAt),
        ),
      )
      .limit(1);
    return occurrence ?? null;
  }

  private async findCurrentWorkItem(
    principal: AuthorizationPrincipal,
    id: string,
    query: OperationsQuery = {},
  ) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new OperationsWorkItemNotFoundError();
    const first = await this.listWorkItems(principal, { ...query, page: 1, pageSize: 1000 });
    const pages = Math.ceil(first.total / 1000);
    if (first.items.some((item) => item.id === id))
      return first.items.find((item) => item.id === id)!;
    // oxlint-disable no-await-in-loop
    for (let page = 2; page <= pages; page++) {
      const result = await this.listWorkItems(principal, { ...query, page, pageSize: 1000 });
      const found = result.items.find((item) => item.id === id);
      if (found) return found;
    }
    // oxlint-enable no-await-in-loop
    throw new OperationsWorkItemNotFoundError();
  }

  private async recordExceptionChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    item: OperationsWorkItem,
    occurrenceId: string,
    action: 'acknowledged' | 'snoozed',
    snoozedUntil?: Date,
  ) {
    const type =
      action === 'acknowledged'
        ? 'operations.exception_acknowledged'
        : 'operations.exception_snoozed';
    const payload =
      action === 'acknowledged'
        ? { issueKey: item.id, occurrenceId }
        : { issueKey: item.id, occurrenceId, snoozedUntil: snoozedUntil!.toISOString() };
    const event = createDomainEvent({
      type,
      tenantId: principal.tenantId,
      aggregateType: 'operations',
      aggregateId: item.sourceEntityId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload,
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: type,
      resourceType: 'operational_exception',
      resourceId: item.sourceEntityId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata:
        action === 'acknowledged'
          ? { issueKey: item.id, occurrenceId }
          : { issueKey: item.id, occurrenceId, snoozedUntil: snoozedUntil!.toISOString() },
    });
    await this.outbox.enqueue(transaction, event);
  }
}

export class OperationsWorkItemNotFoundError extends Error {
  readonly code = 'OPERATIONS_WORK_ITEM_NOT_FOUND';
  constructor() {
    super('The operational work item was not found');
  }
}

export function createOperationsApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  sources: OperationsSourceServices,
) {
  return new OperationsApplicationService(unitOfWork, audit, outbox, sources);
}

async function forEachResultPage<R extends { items: readonly unknown[]; total: number }>(
  pageSize: number,
  readPage: (page: number, pageSize: number) => Promise<R>,
  visitPage: (items: readonly R['items'][number][]) => Promise<void>,
): Promise<{ total: number; complete: boolean }> {
  const firstPage = await readPage(1, pageSize);
  let itemsRead = firstPage.items.length;
  let totalUnchanged = true;
  await visitPage(firstPage.items);
  const pageCount = Math.ceil(firstPage.total / pageSize);
  // oxlint-disable no-await-in-loop
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await readPage(page, pageSize);
    itemsRead += result.items.length;
    totalUnchanged &&= result.total === firstPage.total;
    await visitPage(result.items);
  }
  // oxlint-enable no-await-in-loop
  return {
    total: firstPage.total,
    complete: totalUnchanged && itemsRead === firstPage.total,
  };
}

function retainSortedPrefix<T>(
  heap: T[],
  item: T,
  limit: number,
  compare: (left: T, right: T) => number,
): void {
  if (limit === 0) return;
  if (heap.length < limit) {
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[parent]!, heap[index]!) >= 0) break;
      [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
      index = parent;
    }
    return;
  }
  if (compare(item, heap[0]!) >= 0) return;
  heap[0] = item;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let latest = index;
    if (left < heap.length && compare(heap[left]!, heap[latest]!) > 0) latest = left;
    if (right < heap.length && compare(heap[right]!, heap[latest]!) > 0) latest = right;
    if (latest === index) return;
    [heap[index], heap[latest]] = [heap[latest]!, heap[index]!];
    index = latest;
  }
}

function normalizeOperationsSearchText(value: string): string {
  return value.toLocaleLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
}

function taskSourceTypesForDomain(sourceDomain: string): SourceType[] {
  switch (sourceDomain) {
    case 'scheduling':
    case 'visit_execution':
      return ['visit'];
    case 'care_documentation':
      return ['document'];
    case 'service_evidence':
      return ['service_evidence'];
    case 'benefits':
      return ['benefit_entitlement'];
    case 'billing':
      return ['invoice'];
    case 'claims':
      return ['claim'];
    case 'onboarding':
      return ['client'];
    case 'service_agreements':
      return ['service_agreement'];
    case 'employee_qualifications':
      return [];
    default:
      return [];
  }
}

function deduplicateWorkItems<T extends OperationsWorkItem>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function exceptionReadPermission(sourceDomain: string, issueCode: string): Permission | null {
  switch (sourceDomain) {
    case 'service_agreements':
      return 'service_agreement.read';
    case 'employee_qualifications':
      return 'employee.read';
    case 'scheduling':
      return 'schedule.read';
    case 'visit_execution':
      return 'visit_execution.read';
    case 'care_documentation':
      return 'care_documentation.review';
    case 'service_evidence':
      return 'service_evidence.read';
    case 'benefits':
      return 'benefits.review';
    case 'billing':
      return issueCode === 'receivable_due' ? 'billing.payments.read' : 'billing.read';
    case 'claims':
      return 'claims.read';
    case 'onboarding':
      return 'onboarding.read';
    default:
      return null;
  }
}

function exceptionPermissionScope(principal: AuthorizationPrincipal, permission: Permission): SQL {
  const grants = principal.grants.filter(
    (grant) =>
      grant.permission === permission ||
      (permission === 'employee.read' && grant.permission === 'employee.manage'),
  );
  if (
    grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
  ) {
    return sql`true`;
  }

  const scopes: SQL[] = [];
  const organizationIds = grants
    .filter((grant) => grant.scopeType === 'organization')
    .map((grant) => grant.scopeId);
  const facilityIds = grants
    .filter((grant) => grant.scopeType === 'facility')
    .map((grant) => grant.scopeId);
  if (organizationIds.length)
    scopes.push(inArray(exceptionOccurrences.organizationId, organizationIds));
  if (facilityIds.length) scopes.push(inArray(exceptionOccurrences.facilityId, facilityIds));
  return scopes.length ? or(...scopes)! : sql`false`;
}

function exceptionClientReadScope(principal: AuthorizationPrincipal): SQL {
  return or(
    isNull(exceptionOccurrences.clientId),
    exceptionPermissionScope(principal, 'client.read'),
  )!;
}

function exceptionSourceReadScope(principal: AuthorizationPrincipal): SQL {
  const domainPermissions = [
    ['service_agreements', 'service_agreement.read'],
    ['employee_qualifications', 'employee.read'],
    ['scheduling', 'schedule.read'],
    ['visit_execution', 'visit_execution.read'],
    ['care_documentation', 'care_documentation.review'],
    ['service_evidence', 'service_evidence.read'],
    ['benefits', 'benefits.review'],
    ['claims', 'claims.read'],
    ['onboarding', 'onboarding.read'],
  ] as const satisfies readonly (readonly [string, Permission])[];
  const conditions = domainPermissions.map(([sourceDomain, permission]) =>
    and(
      eq(exceptionOccurrences.sourceDomain, sourceDomain),
      exceptionPermissionScope(principal, permission),
    ),
  );
  conditions.push(
    and(
      eq(exceptionOccurrences.sourceDomain, 'billing'),
      eq(exceptionOccurrences.issueCode, 'receivable_due'),
      exceptionPermissionScope(principal, 'billing.payments.read'),
    ),
    and(
      eq(exceptionOccurrences.sourceDomain, 'billing'),
      ne(exceptionOccurrences.issueCode, 'receivable_due'),
      exceptionPermissionScope(principal, 'billing.read'),
    ),
  );
  return or(...conditions)!;
}

function severityWeight(severity: OperationsWorkItem['severity']): number {
  return severity === 'critical' ? 3 : severity === 'warning' ? 2 : 1;
}

function matchesDueFilter(
  dueAt: string | null,
  filter: NonNullable<OperationsQuery['due']>,
  now: Date,
  timezone: string,
): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) return false;
  if (filter === 'overdue') return due < now;
  const dueDate = localDateKey(due, timezone);
  const today = localDateKey(now, timezone);
  return filter === 'today' ? dueDate === today : dueDate > today;
}

function taskDueLocalDates() {
  const timezone = sql`COALESCE((SELECT ${organizationsTable.timezone} FROM ${organizationsTable} WHERE ${organizationsTable.tenantId} = ${tasks.tenantId} AND ${organizationsTable.id} = ${tasks.organizationId} LIMIT 1), 'Europe/Berlin')`;
  return {
    dueDate: sql`(${tasks.dueAt} AT TIME ZONE ${timezone})::date`,
    today: sql`(now() AT TIME ZONE ${timezone})::date`,
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

function deadlinePolicyCategory(
  item: OperationsWorkItem,
): 'agreements' | 'employees' | 'benefits' | 'billing' | 'onboarding' | null {
  switch (item.issueCode) {
    case 'agreement_expiry':
      return 'agreements';
    case 'qualification_expiry':
      return 'employees';
    case 'carryover_expiring':
    case 'benefit_entitlement_expiry':
      return 'benefits';
    case 'receivable_due':
    case 'payer_authorization_expiry':
      return 'billing';
    case 'admission_start_date':
    case 'admission_follow_up_due':
    case 'admission_follow_up_overdue':
      return 'onboarding';
    default:
      return null;
  }
}

function dateDifferenceDays(laterDate: string, earlierDate: string): number {
  return Math.floor(
    (Date.parse(`${laterDate}T00:00:00Z`) - Date.parse(`${earlierDate}T00:00:00Z`)) / 86_400_000,
  );
}

function addDaysToDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function permissionScope(principal: AuthorizationPrincipal, permission: Permission) {
  const grants = principal.grants.filter(
    (grant) =>
      grant.permission === permission ||
      (permission === 'employee.read' && grant.permission === 'employee.manage'),
  );
  return {
    tenantWide: grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: grants
      .filter((grant) => grant.scopeType === 'organization')
      .map((grant) => grant.scopeId),
    facilityIds: grants
      .filter((grant) => grant.scopeType === 'facility')
      .map((grant) => grant.scopeId),
  };
}

function scopedTo(
  scope: ReturnType<typeof permissionScope>,
  organizationColumn: AnyPgColumn,
  facilityColumn: AnyPgColumn,
): SQL {
  if (scope.tenantWide) return sql`true`;
  const allowed: SQL[] = [];
  if (scope.organizationIds.length)
    allowed.push(inArray(organizationColumn, scope.organizationIds));
  if (scope.facilityIds.length) allowed.push(inArray(facilityColumn, scope.facilityIds));
  return allowed.length ? or(...allowed)! : sql`false`;
}

function completeSourceEntityScope(
  transaction: DatabaseTransaction,
  principal: AuthorizationPrincipal,
  sourceDomain: string,
  window: ReconciliationWindow,
): SQL | null {
  if (sourceDomain === 'scheduling') {
    return exists(
      transaction
        .select({ id: visits.id })
        .from(visits)
        .where(
          and(
            eq(visits.tenantId, principal.tenantId),
            eq(visits.id, exceptionOccurrences.sourceEntityId),
            ne(visits.status, 'cancelled'),
            ...(window.from ? [gte(visits.plannedStart, window.from)] : []),
            ...(window.until ? [lt(visits.plannedStart, window.until)] : []),
            scopedTo(
              permissionScope(principal, 'schedule.read'),
              visits.organizationId,
              visits.facilityId,
            ),
            scopedTo(
              permissionScope(principal, 'client.read'),
              visits.organizationId,
              visits.facilityId,
            ),
          ),
        ),
    );
  }
  if (sourceDomain === 'service_evidence') {
    const evidenceScope = permissionScope(principal, 'service_evidence.read');
    const clientScope = permissionScope(principal, 'client.read');
    const sourceFilters = [
      eq(careDocuments.tenantId, principal.tenantId),
      eq(careDocuments.status, 'finalized'),
      eq(visits.tenantId, principal.tenantId),
      ...(window.from ? [gte(visits.plannedStart, window.from)] : []),
      ...(window.until ? [lt(visits.plannedStart, window.until)] : []),
      scopedTo(evidenceScope, visits.organizationId, visits.facilityId),
      scopedTo(clientScope, visits.organizationId, visits.facilityId),
    ];
    const packageMatch = exists(
      transaction
        .select({ id: evidencePackages.id })
        .from(evidencePackages)
        .innerJoin(
          careDocuments,
          and(
            eq(careDocuments.tenantId, evidencePackages.tenantId),
            eq(careDocuments.id, evidencePackages.documentationId),
          ),
        )
        .innerJoin(
          visits,
          and(eq(visits.tenantId, careDocuments.tenantId), eq(visits.id, careDocuments.visitId)),
        )
        .where(and(eq(evidencePackages.id, exceptionOccurrences.sourceEntityId), ...sourceFilters)),
    );
    const documentationMatch = exists(
      transaction
        .select({ id: careDocuments.id })
        .from(careDocuments)
        .innerJoin(
          visits,
          and(eq(visits.tenantId, careDocuments.tenantId), eq(visits.id, careDocuments.visitId)),
        )
        .where(and(eq(careDocuments.id, exceptionOccurrences.sourceEntityId), ...sourceFilters)),
    );
    return or(
      and(eq(exceptionOccurrences.sourceEntityType, 'evidence_package'), packageMatch),
      and(eq(exceptionOccurrences.sourceEntityType, 'documentation'), documentationMatch),
    )!;
  }
  return null;
}

function endOfLocalDay(date: string, timezone: string): string | null {
  try {
    const lastMinute = localDateTimeToInstant(date, '23:59', timezone, 'later');
    return lastMinute ? new Date(lastMinute.getTime() + 59_999).toISOString() : null;
  } catch {
    return null;
  }
}

async function isolateOperationsSource<T>(
  sourceDomain: string,
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logOperationsSourceFailure(sourceDomain, error);
    return null;
  }
}

function logOperationsSourceFailure(sourceDomain: string, error: unknown): void {
  const errorName =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
      ? error.name
      : 'UnknownError';
  console.warn({ sourceDomain, errorName }, 'Operations worklist source read failed');
}

function workItemResource(
  principal: AuthorizationPrincipal,
  item: OperationsWorkItem,
): ResourceContext {
  return {
    tenantId: principal.tenantId,
    ...(item.organizationId ? { organizationId: item.organizationId } : {}),
    ...(item.facilityId ? { facilityId: item.facilityId } : {}),
    ...(item.clientId ? { clientId: item.clientId } : {}),
  };
}

function exceptionState(
  previous: typeof exceptionInteractions.$inferSelect | null,
  now: Date,
): 'open' | 'acknowledged' | 'snoozed' {
  if (!previous) return 'open';
  if (previous.action === 'acknowledged') return 'acknowledged';
  return previous.snoozedUntil && previous.snoozedUntil > now ? 'snoozed' : 'open';
}

/** Temporary foreign-data adapter. Keep baselined imports here until owner APIs replace these queries. */
class LegacyOperationsTaskData implements OperationsTaskData {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async validateSource(
    principal: AuthorizationPrincipal,
    source: OperationsSourceReference,
  ): Promise<TaskResourceContext> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      let result: TaskResourceContext | null = null;
      switch (source.type) {
        case 'client': {
          const [row] = await transaction
            .select()
            .from(clientRecords)
            .where(
              and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, source.id)),
            )
            .limit(1);
          result = row?.organizationId
            ? {
                organizationId: row.organizationId,
                facilityId: row.primaryFacilityId,
                clientId: row.id,
              }
            : null;
          break;
        }
        case 'visit': {
          const [row] = await transaction
            .select()
            .from(visits)
            .where(and(eq(visits.tenantId, principal.tenantId), eq(visits.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'service_agreement': {
          const [row] = await transaction
            .select()
            .from(agreements)
            .where(and(eq(agreements.tenantId, principal.tenantId), eq(agreements.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'service_evidence': {
          const [row] = await transaction
            .select({ visit: visits })
            .from(evidencePackages)
            .innerJoin(
              careDocuments,
              and(
                eq(careDocuments.tenantId, evidencePackages.tenantId),
                eq(careDocuments.id, evidencePackages.documentationId),
              ),
            )
            .innerJoin(
              visits,
              and(
                eq(visits.tenantId, careDocuments.tenantId),
                eq(visits.id, careDocuments.visitId),
              ),
            )
            .where(
              and(
                eq(evidencePackages.tenantId, principal.tenantId),
                eq(evidencePackages.id, source.id),
              ),
            )
            .limit(1);
          result = row
            ? {
                organizationId: row.visit.organizationId,
                facilityId: row.visit.facilityId,
                clientId: row.visit.clientId,
              }
            : null;
          break;
        }
        case 'invoice': {
          const [row] = await transaction
            .select()
            .from(invoices)
            .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'claim': {
          const [row] = await transaction
            .select()
            .from(claims)
            .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'benefit_entitlement': {
          const [row] = await transaction
            .select({ entitlement: clientBenefitEntitlements, client: clientRecords })
            .from(clientBenefitEntitlements)
            .innerJoin(
              clientRecords,
              and(
                eq(clientRecords.tenantId, clientBenefitEntitlements.tenantId),
                eq(clientRecords.id, clientBenefitEntitlements.clientId),
              ),
            )
            .where(
              and(
                eq(clientBenefitEntitlements.tenantId, principal.tenantId),
                eq(clientBenefitEntitlements.id, source.id),
              ),
            )
            .limit(1);
          result = row?.client.organizationId
            ? {
                organizationId: row.client.organizationId,
                facilityId: row.client.primaryFacilityId,
                clientId: row.client.id,
              }
            : null;
          break;
        }
        case 'document': {
          const [row] = await transaction
            .select()
            .from(documentArtifacts)
            .where(
              and(
                eq(documentArtifacts.tenantId, principal.tenantId),
                eq(documentArtifacts.id, source.id),
              ),
            )
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'communication': {
          const resultSet = await transaction.execute(sql`
            SELECT client.organization_id AS "organizationId",
                   client.primary_facility_id AS "facilityId",
                   interaction.client_id AS "clientId"
            FROM communications.interactions AS interaction
            INNER JOIN clients.clients AS client
              ON client.tenant_id = interaction.tenant_id
             AND client.id = interaction.client_id
            WHERE interaction.tenant_id = ${principal.tenantId}
              AND interaction.id = ${source.id}
            LIMIT 1
          `);
          const row = resultSet.rows[0] as
            | { organizationId: string | null; facilityId: string | null; clientId: string }
            | undefined;
          result = row?.organizationId
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
      }
      if (!result) throw new OperationsSourceNotFoundError();
      assertCan(principal, {
        action: sourcePermission(source.type),
        resource: {
          tenantId: principal.tenantId,
          organizationId: result.organizationId,
          ...(result.facilityId ? { facilityId: result.facilityId } : {}),
          ...(result.clientId ? { clientId: result.clientId } : {}),
        },
      });
      return result;
    });
  }

  async clientContext(
    principal: AuthorizationPrincipal,
    clientId: string,
  ): Promise<TaskResourceContext> {
    return this.validateSource(principal, { type: 'client', id: clientId });
  }

  async assertTaskScope(resource: ResourceContext) {
    const result = await this.unitOfWork.transaction(
      { tenantId: resource.tenantId },
      async (transaction) => {
        const [organization] = await transaction
          .select({ id: organizationsTable.id })
          .from(organizationsTable)
          .where(
            and(
              eq(organizationsTable.tenantId, resource.tenantId),
              eq(organizationsTable.id, resource.organizationId!),
            ),
          )
          .limit(1);
        if (!organization) return false;
        if (!resource.facilityId) return true;
        const [facility] = await transaction
          .select({ id: facilities.id })
          .from(facilities)
          .where(
            and(
              eq(facilities.tenantId, resource.tenantId),
              eq(facilities.organizationId, resource.organizationId!),
              eq(facilities.id, resource.facilityId),
            ),
          )
          .limit(1);
        return facility !== undefined;
      },
    );
    if (!result) throw new InvalidOperationsInputError();
  }

  async assertTaskClientAccess(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    task: typeof tasks.$inferSelect,
  ) {
    if (!task.clientId) return;
    const [client] = await transaction
      .select({
        id: clientRecords.id,
        organizationId: clientRecords.organizationId,
        facilityId: clientRecords.primaryFacilityId,
      })
      .from(clientRecords)
      .where(
        and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, task.clientId)),
      )
      .limit(1);
    if (!client) throw new OperationsTaskNotFoundError();
    assertCan(principal, {
      action: 'client.read',
      resource: {
        tenantId: principal.tenantId,
        clientId: client.id,
        ...(client.organizationId ? { organizationId: client.organizationId } : {}),
        ...(client.facilityId ? { facilityId: client.facilityId } : {}),
      },
    });
  }

  async employeeForUser(tenantId: string, userId: string) {
    const rows = await this.unitOfWork.transaction({ tenantId }, async (transaction) =>
      transaction
        .select({ id: employeeRecords.id })
        .from(employeeRecords)
        .where(
          and(
            eq(employeeRecords.tenantId, tenantId),
            eq(employeeRecords.userId, userId),
            eq(employeeRecords.status, 'active'),
          ),
        )
        .limit(1),
    );
    return rows[0]?.id ?? null;
  }

  async activityActors(transaction: DatabaseTransaction, tenantId: string, actorIds: string[]) {
    return await transaction
      .select({ id: users.id, displayName: users.displayName })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, tenantId), inArray(users.id, actorIds)));
  }

  async listWithDisplay(
    transaction: DatabaseTransaction,
    where: SQL | undefined,
    orderBy: SQL[],
    pageSize: number,
    offset: number,
  ) {
    return await transaction
      .select({
        task: tasks,
        clientName: sql<
          string | null
        >`nullif(concat_ws(' ', coalesce(nullif(${clientRecords.preferredName}, ''), ${clientRecords.firstName}), ${clientRecords.lastName}), '')`,
        assignedEmployeeName: sql<
          string | null
        >`nullif(concat_ws(' ', coalesce(nullif(${employeeRecords.preferredName}, ''), ${employeeRecords.firstName}), ${employeeRecords.lastName}), '')`,
      })
      .from(tasks)
      .leftJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, tasks.tenantId), eq(clientRecords.id, tasks.clientId)),
      )
      .leftJoin(
        employeeRecords,
        and(
          eq(employeeRecords.tenantId, tasks.tenantId),
          eq(employeeRecords.id, tasks.assignedEmployeeId),
        ),
      )
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset);
  }

  matchingClientName(pattern: string): SQL {
    return sql`
        EXISTS (
        SELECT 1
        FROM ${clientRecords}
        WHERE ${clientRecords.tenantId} = ${tasks.tenantId}
          AND ${clientRecords.id} = ${tasks.clientId}
          AND concat_ws(
            ' ',
            coalesce(nullif(${clientRecords.preferredName}, ''), ${clientRecords.firstName}),
            ${clientRecords.lastName}
          ) ILIKE ${pattern}
        )
      `;
  }

  dueLocalDates() {
    return taskDueLocalDates();
  }

  clientReadScope(principal: AuthorizationPrincipal): SQL | null {
    const clientGrants = principal.grants.filter((grant) => grant.permission === 'client.read');
    const clientTenantWide = clientGrants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    );
    const clientOrganizationIds = [
      ...new Set(
        clientGrants
          .filter((grant) => grant.scopeType === 'organization')
          .map((grant) => grant.scopeId),
      ),
    ];
    const clientFacilityIds = [
      ...new Set(
        clientGrants
          .filter((grant) => grant.scopeType === 'facility')
          .map((grant) => grant.scopeId),
      ),
    ];
    const conditions: SQL[] = [];
    if (!clientTenantWide) {
      const clientScopes: SQL[] = [];
      if (clientOrganizationIds.length) {
        clientScopes.push(inArray(clientRecords.organizationId, clientOrganizationIds));
      }
      if (clientFacilityIds.length) {
        clientScopes.push(inArray(clientRecords.primaryFacilityId, clientFacilityIds));
      }
      if (!clientScopes.length) {
        conditions.push(isNull(tasks.clientId));
      } else {
        const readableClient = exists(sql`
          SELECT 1 FROM ${clientRecords}
          WHERE ${clientRecords.tenantId} = ${tasks.tenantId}
            AND ${clientRecords.id} = ${tasks.clientId}
            AND ${or(...clientScopes)}
        `);
        conditions.push(or(isNull(tasks.clientId), readableClient)!);
      }
    }
    return conditions[0] ?? null;
  }
}
