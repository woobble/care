import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientRecords } from '@care/clients';
import { employeeRecords } from '@care/employees';
import { facilities, organizationsTable } from '@care/organizations';
import { agreements } from '@care/service-agreements';
import { visits } from '@care/scheduling';
import { evidencePackages } from '@care/service-evidence';
import { invoices } from '@care/billing';
import { claims } from '@care/billing';
import { clientBenefitEntitlements } from '@care/benefits';
import { documentArtifacts } from '@care/documents';
import type { RecurrenceRule } from './domain/recurrence';

const operations = pgSchema('operations');

export const tasks = operations.table(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    clientId: uuid('client_id'),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').$type<'open' | 'in_progress' | 'completed' | 'cancelled'>().notNull(),
    priority: text('priority').$type<'low' | 'normal' | 'high' | 'urgent'>().notNull(),
    assignedEmployeeId: uuid('assigned_employee_id'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    completedByUserId: uuid('completed_by_user_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    assignmentWarningCode: text('assignment_warning_code').$type<'assignee_unavailable' | null>(),
    sourceType: text('source_type').$type<
      | 'client'
      | 'visit'
      | 'service_agreement'
      | 'service_evidence'
      | 'invoice'
      | 'claim'
      | 'benefit_entitlement'
      | 'document'
      | 'communication'
      | null
    >(),
    sourceClientId: uuid('source_client_id'),
    sourceVisitId: uuid('source_visit_id'),
    sourceAgreementId: uuid('source_agreement_id'),
    sourceEvidencePackageId: uuid('source_evidence_package_id'),
    sourceInvoiceId: uuid('source_invoice_id'),
    sourceClaimId: uuid('source_claim_id'),
    sourceEntitlementId: uuid('source_entitlement_id'),
    sourceDocumentId: uuid('source_document_id'),
    sourceCommunicationId: uuid('source_communication_id'),
    sourceDeadlineKey: text('source_deadline_key'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operations_tasks_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('operations_tasks_deadline_key_uq')
      .on(table.tenantId, table.sourceDeadlineKey)
      .where(sql`${table.sourceDeadlineKey} IS NOT NULL`),
    index('operations_tasks_scope_status_due_idx').on(
      table.tenantId,
      table.organizationId,
      table.facilityId,
      table.status,
      table.dueAt,
      table.id,
    ),
    index('operations_tasks_assignee_status_due_idx').on(
      table.tenantId,
      table.assignedEmployeeId,
      table.status,
      table.dueAt,
      table.id,
    ),
    check(
      'operations_tasks_state_ck',
      sql`(${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL) OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL)`,
    ),
    check('operations_tasks_version_ck', sql`${table.version} > 0`),
    check(
      'operations_tasks_assignment_warning_ck',
      sql`${table.assignmentWarningCode} IS NULL OR ${table.assignmentWarningCode} = 'assignee_unavailable'`,
    ),
    check('operations_tasks_title_ck', sql`length(trim(${table.title})) BETWEEN 1 AND 200`),
    check(
      'operations_tasks_source_type_ck',
      sql`${table.sourceType} IS NULL OR ${table.sourceType} IN ('client', 'visit', 'service_agreement', 'service_evidence', 'invoice', 'claim', 'benefit_entitlement', 'document', 'communication')`,
    ),
    check(
      'operations_tasks_source_pair_ck',
      sql`
      (${table.sourceType} IS NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 0)
      OR (${table.sourceType} = 'client' AND ${table.sourceClientId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'visit' AND ${table.sourceVisitId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'service_agreement' AND ${table.sourceAgreementId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'service_evidence' AND ${table.sourceEvidencePackageId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'invoice' AND ${table.sourceInvoiceId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'claim' AND ${table.sourceClaimId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'benefit_entitlement' AND ${table.sourceEntitlementId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'document' AND ${table.sourceDocumentId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
      OR (${table.sourceType} = 'communication' AND ${table.sourceCommunicationId} IS NOT NULL AND num_nonnulls(${table.sourceClientId}, ${table.sourceVisitId}, ${table.sourceAgreementId}, ${table.sourceEvidencePackageId}, ${table.sourceInvoiceId}, ${table.sourceClaimId}, ${table.sourceEntitlementId}, ${table.sourceDocumentId}, ${table.sourceCommunicationId}) = 1)
    `,
    ),
    foreignKey({
      name: 'operations_tasks_tenant_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'operations_tasks_tenant_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'operations_tasks_tenant_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'operations_tasks_tenant_assignee_fk',
      columns: [table.tenantId, table.assignedEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'operations_tasks_tenant_organization_assignee_fk',
      columns: [table.tenantId, table.organizationId, table.assignedEmployeeId],
      foreignColumns: [
        employeeRecords.tenantId,
        employeeRecords.organizationId,
        employeeRecords.id,
      ],
    }),
    foreignKey({
      name: 'operations_tasks_source_client_fk',
      columns: [table.tenantId, table.sourceClientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_visit_fk',
      columns: [table.tenantId, table.sourceVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_agreement_fk',
      columns: [table.tenantId, table.sourceAgreementId],
      foreignColumns: [agreements.tenantId, agreements.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_evidence_fk',
      columns: [table.tenantId, table.sourceEvidencePackageId],
      foreignColumns: [evidencePackages.tenantId, evidencePackages.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_invoice_fk',
      columns: [table.tenantId, table.sourceInvoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_claim_fk',
      columns: [table.tenantId, table.sourceClaimId],
      foreignColumns: [claims.tenantId, claims.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_entitlement_fk',
      columns: [table.tenantId, table.sourceEntitlementId],
      foreignColumns: [clientBenefitEntitlements.tenantId, clientBenefitEntitlements.id],
    }),
    foreignKey({
      name: 'operations_tasks_source_document_fk',
      columns: [table.tenantId, table.sourceDocumentId],
      foreignColumns: [documentArtifacts.tenantId, documentArtifacts.id],
    }),
  ],
);

export const recurringTaskDefinitions = operations.table(
  'recurring_task_definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    clientId: uuid('client_id'),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority').$type<'low' | 'normal' | 'high' | 'urgent'>().notNull(),
    assignedEmployeeId: uuid('assigned_employee_id'),
    rule: jsonb('recurrence_rule').$type<RecurrenceRule>().notNull(),
    timezone: text('timezone').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    timeOfDay: time('time_of_day').notNull(),
    nextOccurrenceDate: date('next_occurrence_date', { mode: 'string' }),
    nextOccurrenceAt: timestamp('next_occurrence_at', { withTimezone: true }),
    status: text('status').$type<'active' | 'paused' | 'ended'>().notNull(),
    generationPolicy: text('generation_policy')
      .$type<'generate_missed' | 'skip_missed'>()
      .notNull(),
    version: integer('version').notNull().default(1),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operations_recurring_task_definitions_tenant_id_uq').on(table.tenantId, table.id),
    index('operations_recurring_task_definitions_due_idx').on(
      table.tenantId,
      table.status,
      table.nextOccurrenceAt,
      table.id,
    ),
    index('operations_recurring_task_definitions_scope_idx').on(
      table.tenantId,
      table.organizationId,
      table.facilityId,
      table.status,
      table.id,
    ),
    check('operations_recurring_task_definitions_version_ck', sql`${table.version} > 0`),
    check(
      'operations_recurring_task_definitions_title_ck',
      sql`length(trim(${table.title})) BETWEEN 1 AND 200`,
    ),
    check(
      'operations_recurring_task_definitions_status_ck',
      sql`${table.status} IN ('active', 'paused', 'ended')`,
    ),
    check(
      'operations_recurring_task_definitions_policy_ck',
      sql`${table.generationPolicy} IN ('generate_missed', 'skip_missed')`,
    ),
    check(
      'operations_recurring_task_definitions_rule_ck',
      sql`jsonb_typeof(${table.rule}) = 'object' AND ${table.rule}->>'frequency' IN ('daily', 'weekly', 'monthly', 'yearly') AND ${table.rule}->>'interval' ~ '^[0-9]{1,3}$'`,
    ),
    foreignKey({
      name: 'operations_recurring_task_definitions_tenant_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'operations_recurring_task_definitions_tenant_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'operations_recurring_task_definitions_tenant_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'operations_recurring_task_definitions_tenant_assignee_fk',
      columns: [table.tenantId, table.assignedEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'operations_recurring_task_definitions_tenant_organization_assignee_fk',
      columns: [table.tenantId, table.organizationId, table.assignedEmployeeId],
      foreignColumns: [
        employeeRecords.tenantId,
        employeeRecords.organizationId,
        employeeRecords.id,
      ],
    }),
  ],
);

export const recurringTaskOccurrences = operations.table(
  'recurring_task_occurrences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    recurrenceDefinitionId: uuid('recurrence_definition_id').notNull(),
    occurrenceKey: date('occurrence_key', { mode: 'string' }).notNull(),
    definitionVersion: integer('definition_version').notNull(),
    taskId: uuid('task_id').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    assignmentWarningCode: text('assignment_warning_code').$type<'assignee_unavailable' | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operations_recurring_task_occurrences_definition_key_uq').on(
      table.tenantId,
      table.recurrenceDefinitionId,
      table.occurrenceKey,
    ),
    uniqueIndex('operations_recurring_task_occurrences_task_uq').on(table.tenantId, table.taskId),
    index('operations_recurring_task_occurrences_history_idx').on(
      table.tenantId,
      table.recurrenceDefinitionId,
      table.occurrenceKey,
    ),
    check('operations_recurring_task_occurrences_version_ck', sql`${table.definitionVersion} > 0`),
    check(
      'operations_recurring_task_occurrences_assignment_warning_ck',
      sql`${table.assignmentWarningCode} IS NULL OR ${table.assignmentWarningCode} = 'assignee_unavailable'`,
    ),
    foreignKey({
      name: 'operations_recurring_task_occurrences_definition_fk',
      columns: [table.tenantId, table.recurrenceDefinitionId],
      foreignColumns: [recurringTaskDefinitions.tenantId, recurringTaskDefinitions.id],
    }),
    foreignKey({
      name: 'operations_recurring_task_occurrences_task_fk',
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
  ],
);

export const reminderPolicies = operations.table(
  'reminder_policies',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    category: text('category')
      .$type<
        'agreements' | 'employees' | 'benefits' | 'billing' | 'claims' | 'documents' | 'onboarding'
      >()
      .notNull(),
    offsetsDays: integer('offsets_days').array().notNull().default([30, 7, 0]),
    enabled: boolean('enabled').notNull().default(true),
    createFollowUpTask: boolean('create_follow_up_task').notNull().default(false),
    assignedEmployeeId: uuid('assigned_employee_id'),
    version: integer('version').notNull().default(1),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operations_reminder_policies_org_category_uq').on(
      table.tenantId,
      table.organizationId,
      table.category,
    ),
    check('operations_reminder_policies_version_ck', sql`${table.version} > 0`),
    check(
      'operations_reminder_policies_offsets_ck',
      sql`cardinality(${table.offsetsDays}) BETWEEN 1 AND 8 AND array_position(${table.offsetsDays}, NULL) IS NULL`,
    ),
    foreignKey({
      name: 'operations_reminder_policies_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'operations_reminder_policies_assignee_fk',
      columns: [table.tenantId, table.organizationId, table.assignedEmployeeId],
      foreignColumns: [
        employeeRecords.tenantId,
        employeeRecords.organizationId,
        employeeRecords.id,
      ],
    }),
  ],
);

export const schedulerRuns = operations.table(
  'scheduler_runs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    jobName: text('job_name').$type<'recurring_tasks' | 'deadline_evaluation'>().notNull(),
    status: text('status').$type<'running' | 'succeeded' | 'failed'>().notNull(),
    workerId: text('worker_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastStartedAt: timestamp('last_started_at', { withTimezone: true }).notNull(),
    lastSucceededAt: timestamp('last_succeeded_at', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    lastFailureCode: text('last_failure_code'),
    tasksCreated: integer('tasks_created').notNull().default(0),
    remindersTriggered: integer('reminders_triggered').notNull().default(0),
    projectionCursors: jsonb('projection_cursors')
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operations_scheduler_runs_tenant_job_uq').on(table.tenantId, table.jobName),
    check('operations_scheduler_runs_task_count_ck', sql`${table.tasksCreated} >= 0`),
    check('operations_scheduler_runs_reminder_count_ck', sql`${table.remindersTriggered} >= 0`),
    check(
      'operations_scheduler_runs_status_ck',
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
  ],
);

export const taskActivity = operations.table(
  'task_activity',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    taskId: uuid('task_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    kind: text('kind')
      .$type<
        | 'created'
        | 'edited'
        | 'assigned'
        | 'priority_changed'
        | 'due_date_changed'
        | 'status_changed'
        | 'comment'
      >()
      .notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    comment: text('comment'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('operations_task_activity_task_time_idx').on(
      table.tenantId,
      table.taskId,
      table.occurredAt,
      table.id,
    ),
    check(
      'operations_task_activity_comment_ck',
      sql`(${table.kind} = 'comment' AND ${table.comment} IS NOT NULL) OR (${table.kind} <> 'comment' AND ${table.comment} IS NULL)`,
    ),
    foreignKey({
      name: 'operations_task_activity_task_fk',
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
  ],
);

export const exceptionOccurrences = operations.table(
  'exception_occurrences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    issueKey: text('issue_key').notNull(),
    sourceDomain: text('source_domain').notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: uuid('source_entity_id').notNull(),
    issueCode: text('issue_code').notNull(),
    category: text('category')
      .$type<
        | 'scheduling'
        | 'visits'
        | 'documentation'
        | 'benefits'
        | 'billing'
        | 'claims'
        | 'onboarding'
        | 'agreements'
        | 'employees'
      >()
      .notNull(),
    severity: text('severity').$type<'info' | 'warning' | 'critical'>().notNull(),
    organizationId: uuid('organization_id'),
    facilityId: uuid('facility_id'),
    clientId: uuid('client_id'),
    sourceAt: timestamp('source_at', { withTimezone: true }),
    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('operations_exception_occurrences_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('operations_exception_occurrences_active_issue_uq')
      .on(table.tenantId, table.issueKey)
      .where(sql`${table.resolvedAt} IS NULL`),
    index('operations_exception_occurrences_history_idx').on(
      table.tenantId,
      table.issueKey,
      table.firstDetectedAt,
      table.id,
    ),
    index('operations_exception_occurrences_reconcile_idx').on(
      table.tenantId,
      table.sourceDomain,
      table.resolvedAt,
      table.lastObservedAt,
    ),
    check('operations_exception_occurrences_key_ck', sql`length(${table.issueKey}) = 64`),
    check(
      'operations_exception_occurrences_source_domain_ck',
      sql`${table.sourceDomain} IN ('scheduling', 'visit_execution', 'care_documentation', 'service_evidence', 'benefits', 'billing', 'claims', 'onboarding', 'service_agreements', 'employee_qualifications')`,
    ),
    check(
      'operations_exception_occurrences_category_ck',
      sql`${table.category} IN ('scheduling', 'visits', 'documentation', 'benefits', 'billing', 'claims', 'onboarding', 'agreements', 'employees')`,
    ),
    check(
      'operations_exception_occurrences_severity_ck',
      sql`${table.severity} IN ('info', 'warning', 'critical')`,
    ),
    check('operations_exception_occurrences_version_ck', sql`${table.version} > 0`),
    foreignKey({
      name: 'operations_exception_occurrences_tenant_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'operations_exception_occurrences_tenant_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'operations_exception_occurrences_tenant_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
  ],
);

export const exceptionInteractions = operations.table(
  'exception_interactions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    issueKey: text('issue_key').notNull(),
    occurrenceId: uuid('occurrence_id'),
    action: text('action').$type<'acknowledged' | 'snoozed'>().notNull(),
    previousState: text('previous_state').$type<'open' | 'acknowledged' | 'snoozed'>().notNull(),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('operations_exception_interactions_tenant_id_uq').on(table.tenantId, table.id),
    index('operations_exception_interactions_issue_time_idx').on(
      table.tenantId,
      table.issueKey,
      table.occurredAt,
      table.id,
    ),
    index('operations_exception_interactions_occurrence_time_idx').on(
      table.tenantId,
      table.occurrenceId,
      table.occurredAt,
      table.id,
    ),
    check('operations_exception_interactions_key_ck', sql`length(${table.issueKey}) = 64`),
    check(
      'operations_exception_interactions_action_ck',
      sql`(${table.action} = 'snoozed' AND ${table.snoozedUntil} IS NOT NULL) OR (${table.action} = 'acknowledged' AND ${table.snoozedUntil} IS NULL)`,
    ),
    check(
      'operations_exception_interactions_reason_ck',
      sql`${table.reason} IS NULL OR length(trim(${table.reason})) BETWEEN 1 AND 500`,
    ),
    foreignKey({
      name: 'operations_exception_interactions_occurrence_fk',
      columns: [table.tenantId, table.occurrenceId],
      foreignColumns: [exceptionOccurrences.tenantId, exceptionOccurrences.id],
    }),
  ],
);

export const operationsSchema = {
  tasks,
  taskActivity,
  recurringTaskDefinitions,
  recurringTaskOccurrences,
  reminderPolicies,
  schedulerRuns,
  exceptionOccurrences,
  exceptionInteractions,
};
