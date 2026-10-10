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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientRecords } from '@care/clients';
import { interactions } from '@care/communications';
import { documentArtifacts } from '@care/documents';
import { employeeRecords } from '@care/employees';
import { users } from '@care/identity';
import { tasks } from '@care/operations';
import { facilities, organizationsTable } from '@care/organizations';
import { visits } from '@care/scheduling';

const onboarding = pgSchema('onboarding');

export type AdmissionStage =
  | 'inquiry'
  | 'assessment'
  | 'preparation'
  | 'ready_for_admission'
  | 'admitted'
  | 'declined'
  | 'withdrawn';

export type NeedsAssessment = {
  requestedServices: string[];
  householdSupport: string;
  everydayAssistance: string;
  accompaniment: string;
  preferredDays: string[];
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  visitsPerWeek: number | null;
  preferredStartDate: string | null;
  accessibility: string;
  preferences: string;
  organizationalNotes: string;
};

export const admissionCases = onboarding.table(
  'cases',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    clientId: uuid('client_id'),
    ownerEmployeeId: uuid('owner_employee_id'),
    checklistTemplateId: uuid('checklist_template_id'),
    checklistTemplateVersion: integer('checklist_template_version'),
    firstVisitId: uuid('first_visit_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    contactMethod: text('contact_method')
      .$type<'phone' | 'email' | 'in_person' | 'letter' | 'other'>()
      .notNull(),
    requesterName: text('requester_name'),
    requesterRelationship: text('requester_relationship'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    requestedServices: text('requested_services')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    preferredStartDate: date('preferred_start_date', { mode: 'string' }),
    serviceLocation: text('service_location'),
    inquirySource: text('inquiry_source').notNull(),
    fundingPlan: text('funding_plan')
      .$type<'unknown' | 'private_pay' | 'benefits' | 'other'>()
      .notNull()
      .default('unknown'),
    fundingPlanDetails: text('funding_plan_details'),
    initialNotes: text('initial_notes'),
    stage: text('stage').$type<AdmissionStage>().notNull().default('inquiry'),
    version: integer('version').notNull().default(1),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    admittedAt: timestamp('admitted_at', { withTimezone: true }),
    admittedByUserId: uuid('admitted_by_user_id'),
    decisionSnapshot: jsonb('decision_snapshot').$type<Record<string, unknown> | null>(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('onboarding_cases_tenant_id_uq').on(table.tenantId, table.id),
    index('onboarding_cases_worklist_idx').on(
      table.tenantId,
      table.organizationId,
      table.stage,
      table.lastActivityAt,
      table.id,
    ),
    index('onboarding_cases_owner_idx').on(
      table.tenantId,
      table.ownerEmployeeId,
      table.stage,
      table.nextFollowUpAt,
    ),
    index('onboarding_cases_client_idx').on(table.tenantId, table.clientId, table.createdAt),
    check('onboarding_cases_version_ck', sql`${table.version} > 0`),
    check(
      'onboarding_cases_content_ck',
      sql`length(trim(${table.firstName})) BETWEEN 1 AND 120 AND length(trim(${table.lastName})) BETWEEN 1 AND 120 AND length(trim(${table.inquirySource})) BETWEEN 1 AND 120 AND (${table.requesterName} IS NULL OR length(trim(${table.requesterName})) <= 160) AND (${table.requesterRelationship} IS NULL OR length(trim(${table.requesterRelationship})) <= 120) AND (${table.contactEmail} IS NULL OR length(trim(${table.contactEmail})) <= 254) AND (${table.contactPhone} IS NULL OR length(trim(${table.contactPhone})) <= 80) AND (${table.serviceLocation} IS NULL OR length(trim(${table.serviceLocation})) <= 500) AND (${table.initialNotes} IS NULL OR length(${table.initialNotes}) <= 4000)`,
    ),
    check(
      'onboarding_cases_stage_ck',
      sql`${table.stage} IN ('inquiry', 'assessment', 'preparation', 'ready_for_admission', 'admitted', 'declined', 'withdrawn')`,
    ),
    check(
      'onboarding_cases_funding_plan_ck',
      sql`${table.fundingPlan} IN ('unknown', 'private_pay', 'benefits', 'other')`,
    ),
    check(
      'onboarding_cases_decision_ck',
      sql`(${table.stage} = 'admitted' AND ${table.admittedAt} IS NOT NULL AND ${table.admittedByUserId} IS NOT NULL AND ${table.decisionSnapshot} IS NOT NULL) OR (${table.stage} <> 'admitted' AND ${table.admittedAt} IS NULL AND ${table.admittedByUserId} IS NULL AND ${table.decisionSnapshot} IS NULL)`,
    ),
    check(
      'onboarding_cases_template_pair_ck',
      sql`(${table.checklistTemplateId} IS NULL AND ${table.checklistTemplateVersion} IS NULL) OR (${table.checklistTemplateId} IS NOT NULL AND ${table.checklistTemplateVersion} > 0)`,
    ),
    foreignKey({
      name: 'onboarding_cases_tenant_org_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'onboarding_cases_tenant_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'onboarding_cases_tenant_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'onboarding_cases_tenant_owner_fk',
      columns: [table.tenantId, table.ownerEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'onboarding_cases_tenant_first_visit_fk',
      columns: [table.tenantId, table.firstVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'onboarding_cases_creator_fk',
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'onboarding_cases_admitter_fk',
      columns: [table.admittedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const admissionAssessments = onboarding.table(
  'assessments',
  {
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    version: integer('version').notNull(),
    data: jsonb('data').$type<NeedsAssessment>().notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.caseId] }),
    check('onboarding_assessments_version_ck', sql`${table.version} > 0`),
    foreignKey({
      name: 'onboarding_assessments_case_fk',
      columns: [table.tenantId, table.caseId],
      foreignColumns: [admissionCases.tenantId, admissionCases.id],
    }),
    foreignKey({
      name: 'onboarding_assessments_author_fk',
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const checklistTemplates = onboarding.table(
  'checklist_templates',
  {
    id: uuid('id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    name: text('name').notNull(),
    currentVersion: integer('current_version').notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    uniqueIndex('onboarding_templates_scope_name_uq').on(
      table.tenantId,
      table.organizationId,
      table.facilityId,
      table.name,
    ),
    check('onboarding_templates_version_ck', sql`${table.currentVersion} > 0`),
    check('onboarding_templates_name_ck', sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
    foreignKey({
      name: 'onboarding_templates_org_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'onboarding_templates_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'onboarding_templates_author_fk',
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const checklistTemplateItems = onboarding.table(
  'checklist_template_items',
  {
    tenantId: uuid('tenant_id').notNull(),
    templateId: uuid('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    code: text('code').notNull(),
    category: text('category').notNull(),
    label: text('label').notNull(),
    source: text('source').$type<'automatic' | 'manual' | 'document'>().notNull(),
    mandatory: boolean('mandatory').notNull(),
    requirementType: text('requirement_type').$type<'policy' | 'external'>().notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.templateId, table.templateVersion, table.code] }),
    check('onboarding_template_items_version_ck', sql`${table.templateVersion} > 0`),
    check('onboarding_template_items_code_ck', sql`${table.code} ~ '^[a-z][a-z0-9_]{1,63}$'`),
    check(
      'onboarding_template_items_content_ck',
      sql`length(trim(${table.label})) BETWEEN 1 AND 160 AND length(trim(${table.category})) BETWEEN 1 AND 80 AND ${table.sortOrder} >= 0`,
    ),
    check(
      'onboarding_template_items_source_ck',
      sql`${table.source} IN ('automatic', 'manual', 'document')`,
    ),
    check(
      'onboarding_template_items_requirement_ck',
      sql`${table.requirementType} IN ('policy', 'external')`,
    ),
    check(
      'onboarding_template_items_auto_code_ck',
      sql`${table.source} <> 'automatic' OR ${table.code} IN ('client_identity', 'primary_contact', 'needs_assessment', 'funding_arrangement', 'service_agreement', 'first_visit')`,
    ),
    foreignKey({
      name: 'onboarding_template_items_template_fk',
      columns: [table.tenantId, table.templateId],
      foreignColumns: [checklistTemplates.tenantId, checklistTemplates.id],
    }),
  ],
);

export const checklistResponses = onboarding.table(
  'checklist_responses',
  {
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    itemCode: text('item_code').notNull(),
    status: text('status').$type<'complete' | 'not_applicable'>().notNull(),
    reason: text('reason'),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.caseId, table.itemCode] }),
    check('onboarding_checklist_response_version_ck', sql`${table.templateVersion} > 0`),
    check(
      'onboarding_checklist_response_reason_ck',
      sql`(${table.status} = 'not_applicable' AND length(trim(coalesce(${table.reason}, ''))) BETWEEN 1 AND 500) OR (${table.status} = 'complete' AND ${table.reason} IS NULL)`,
    ),
    foreignKey({
      name: 'onboarding_checklist_responses_case_fk',
      columns: [table.tenantId, table.caseId],
      foreignColumns: [admissionCases.tenantId, admissionCases.id],
    }),
    foreignKey({
      name: 'onboarding_checklist_responses_author_fk',
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const admissionTransitions = onboarding.table(
  'transitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    fromStage: text('from_stage').$type<AdmissionStage>(),
    toStage: text('to_stage').$type<AdmissionStage>().notNull(),
    version: integer('version').notNull(),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').notNull(),
    readinessSnapshot: jsonb('readiness_snapshot').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('onboarding_transitions_case_version_uq').on(
      table.tenantId,
      table.caseId,
      table.version,
    ),
    index('onboarding_transitions_timeline_idx').on(
      table.tenantId,
      table.caseId,
      table.occurredAt,
      table.id,
    ),
    check('onboarding_transitions_version_ck', sql`${table.version} > 0`),
    check(
      'onboarding_transitions_reason_ck',
      sql`${table.reason} IS NULL OR length(trim(${table.reason})) BETWEEN 1 AND 1000`,
    ),
    foreignKey({
      name: 'onboarding_transitions_case_fk',
      columns: [table.tenantId, table.caseId],
      foreignColumns: [admissionCases.tenantId, admissionCases.id],
    }),
    foreignKey({
      name: 'onboarding_transitions_actor_fk',
      columns: [table.actorUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const admissionDocuments = onboarding.table(
  'case_documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    documentArtifactId: uuid('document_artifact_id').notNull(),
    requirementCode: text('requirement_code').notNull(),
    linkedByUserId: uuid('linked_by_user_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('onboarding_case_documents_uq').on(
      table.tenantId,
      table.caseId,
      table.requirementCode,
      table.documentArtifactId,
    ),
    index('onboarding_case_documents_case_idx').on(
      table.tenantId,
      table.caseId,
      table.requirementCode,
    ),
    foreignKey({
      name: 'onboarding_case_documents_case_fk',
      columns: [table.tenantId, table.caseId],
      foreignColumns: [admissionCases.tenantId, admissionCases.id],
    }),
    foreignKey({
      name: 'onboarding_case_documents_artifact_fk',
      columns: [table.tenantId, table.documentArtifactId],
      foreignColumns: [documentArtifacts.tenantId, documentArtifacts.id],
    }),
    foreignKey({
      name: 'onboarding_case_documents_actor_fk',
      columns: [table.linkedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const admissionTasks = onboarding.table(
  'case_tasks',
  {
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    taskId: uuid('task_id').notNull(),
    linkedByUserId: uuid('linked_by_user_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.caseId, table.taskId] }),
    foreignKey({
      name: 'onboarding_case_tasks_case_fk',
      columns: [table.tenantId, table.caseId],
      foreignColumns: [admissionCases.tenantId, admissionCases.id],
    }),
    foreignKey({
      name: 'onboarding_case_tasks_task_fk',
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
    foreignKey({
      name: 'onboarding_case_tasks_actor_fk',
      columns: [table.linkedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const admissionCommunications = onboarding.table(
  'case_communications',
  {
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    interactionId: uuid('interaction_id').notNull(),
    linkedByUserId: uuid('linked_by_user_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.caseId, table.interactionId] }),
    foreignKey({
      name: 'onboarding_case_communications_case_fk',
      columns: [table.tenantId, table.caseId],
      foreignColumns: [admissionCases.tenantId, admissionCases.id],
    }),
    foreignKey({
      name: 'onboarding_case_communications_interaction_fk',
      columns: [table.tenantId, table.interactionId],
      foreignColumns: [interactions.tenantId, interactions.id],
    }),
    foreignKey({
      name: 'onboarding_case_communications_actor_fk',
      columns: [table.linkedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const onboardingSchema = {
  admissionCases,
  admissionAssessments,
  checklistTemplates,
  checklistTemplateItems,
  checklistResponses,
  admissionTransitions,
  admissionDocuments,
  admissionTasks,
  admissionCommunications,
};
