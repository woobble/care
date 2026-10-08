import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientRecords } from '@care/clients';
import { clinicalRecords } from '@care/clinical-documentation';
import { employeeRecords } from '@care/employees';
import { facilities, organizationsTable } from '@care/organizations';
import { serviceDefinitions } from '@care/services';

const carePlanning = pgSchema('care_planning');

export const carePlans = carePlanning.table(
  'plans',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    status: text('status').$type<'draft' | 'active' | 'under_review' | 'ended'>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    version: integer('version').notNull().default(1),
    createdByEmployeeId: uuid('created_by_employee_id').notNull(),
    endedByEmployeeId: uuid('ended_by_employee_id'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: text('ended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('care_plans_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('care_plans_tenant_id_client_uq').on(table.tenantId, table.id, table.clientId),
    uniqueIndex('care_plans_one_current_per_client_uq')
      .on(table.tenantId, table.clientId, table.organizationId, table.facilityId)
      .where(sql`${table.status} IN ('active', 'under_review')`),
    index('care_plans_client_created_idx').on(
      table.tenantId,
      table.clientId,
      table.createdAt,
      table.id,
    ),
    check(
      'care_plans_status_ck',
      sql`${table.status} IN ('draft', 'active', 'under_review', 'ended')`,
    ),
    check('care_plans_version_ck', sql`${table.version} > 0`),
    check(
      'care_plans_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    check(
      'care_plans_ended_ck',
      sql`(${table.status} = 'ended' AND ${table.endedAt} IS NOT NULL AND ${table.endedByEmployeeId} IS NOT NULL AND length(trim(coalesce(${table.endedReason}, ''))) BETWEEN 1 AND 1000) OR (${table.status} <> 'ended' AND ${table.endedAt} IS NULL AND ${table.endedByEmployeeId} IS NULL AND ${table.endedReason} IS NULL)`,
    ),
    foreignKey({
      name: 'care_plans_client_provider_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId, table.clientId],
      foreignColumns: [
        clientRecords.tenantId,
        clientRecords.organizationId,
        clientRecords.primaryFacilityId,
        clientRecords.id,
      ],
    }),
    foreignKey({
      name: 'care_plans_facility_provider_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'care_plans_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'care_plans_creator_employee_fk',
      columns: [table.tenantId, table.createdByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'care_plans_ended_by_employee_fk',
      columns: [table.tenantId, table.endedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const carePlanRevisions = carePlanning.table(
  'revisions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    planId: uuid('plan_id').notNull(),
    clientId: uuid('client_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: text('status').$type<'draft' | 'active' | 'historical'>().notNull(),
    authorEmployeeId: uuid('author_employee_id').notNull(),
    reason: text('reason'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    activatedByEmployeeId: uuid('activated_by_employee_id'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('care_plan_revisions_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('care_plan_revisions_tenant_id_client_uq').on(
      table.tenantId,
      table.id,
      table.clientId,
    ),
    uniqueIndex('care_plan_revisions_plan_number_uq').on(
      table.tenantId,
      table.planId,
      table.revisionNumber,
    ),
    uniqueIndex('care_plan_revisions_tenant_plan_client_uq').on(
      table.tenantId,
      table.id,
      table.planId,
      table.clientId,
    ),
    uniqueIndex('care_plan_one_draft_revision_uq')
      .on(table.tenantId, table.planId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('care_plan_one_active_revision_uq')
      .on(table.tenantId, table.planId)
      .where(sql`${table.status} = 'active'`),
    index('care_plan_revisions_history_idx').on(table.tenantId, table.planId, table.revisionNumber),
    check(
      'care_plan_revisions_status_ck',
      sql`${table.status} IN ('draft', 'active', 'historical')`,
    ),
    check('care_plan_revisions_number_ck', sql`${table.revisionNumber} > 0`),
    check(
      'care_plan_revisions_lifecycle_ck',
      sql`(${table.status} = 'draft' AND ${table.activatedAt} IS NULL AND ${table.activatedByEmployeeId} IS NULL AND ${table.supersededAt} IS NULL) OR (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.activatedByEmployeeId} IS NOT NULL AND ${table.supersededAt} IS NULL) OR (${table.status} = 'historical' AND ${table.activatedAt} IS NOT NULL AND ${table.activatedByEmployeeId} IS NOT NULL AND ${table.supersededAt} IS NOT NULL)`,
    ),
    check(
      'care_plan_revision_reason_ck',
      sql`${table.reason} IS NULL OR length(trim(${table.reason})) BETWEEN 1 AND 1000`,
    ),
    foreignKey({
      name: 'care_plan_revisions_plan_fk',
      columns: [table.tenantId, table.planId, table.clientId],
      foreignColumns: [carePlans.tenantId, carePlans.id, carePlans.clientId],
    }),
    foreignKey({
      name: 'care_plan_revisions_author_fk',
      columns: [table.tenantId, table.authorEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'care_plan_revisions_activated_by_fk',
      columns: [table.tenantId, table.activatedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const carePlanAssessments = carePlanning.table(
  'assessments',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    clientConcerns: text('client_concerns'),
    clientWishes: text('client_wishes'),
    clientGoals: text('client_goals'),
    clientHabits: text('client_habits'),
    clientPreferences: text('client_preferences'),
    clientPriorities: text('client_priorities'),
    professionalObservedNeeds: text('professional_observed_needs'),
    professionalResources: text('professional_resources'),
    professionalLimitations: text('professional_limitations'),
    professionalRisks: text('professional_risks'),
    professionalRationale: text('professional_rationale'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId] }),
    foreignKey({
      name: 'care_plan_assessments_revision_fk',
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [carePlanRevisions.tenantId, carePlanRevisions.id],
    }),
    check(
      'care_plan_assessments_text_length_ck',
      sql`coalesce(length(${table.clientConcerns}), 0) <= 4000 AND coalesce(length(${table.clientWishes}), 0) <= 4000 AND coalesce(length(${table.clientGoals}), 0) <= 4000 AND coalesce(length(${table.clientHabits}), 0) <= 4000 AND coalesce(length(${table.clientPreferences}), 0) <= 4000 AND coalesce(length(${table.clientPriorities}), 0) <= 4000 AND coalesce(length(${table.professionalObservedNeeds}), 0) <= 4000 AND coalesce(length(${table.professionalResources}), 0) <= 4000 AND coalesce(length(${table.professionalLimitations}), 0) <= 4000 AND coalesce(length(${table.professionalRisks}), 0) <= 4000 AND coalesce(length(${table.professionalRationale}), 0) <= 4000`,
    ),
  ],
);

export const carePlanNeeds = carePlanning.table(
  'needs',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    id: uuid('id').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    source: text('source').notNull(),
    priority: text('priority').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.id] }),
    index('care_plan_needs_revision_idx').on(table.tenantId, table.revisionId, table.status),
    check(
      'care_plan_needs_values_ck',
      sql`${table.category} IN ('personal_care', 'mobility', 'nutrition', 'hydration', 'communication', 'cognition', 'daily_living', 'social_participation', 'safety', 'other') AND ${table.source} IN ('client_report', 'professional_observation', 'representative_report', 'clinical_record') AND ${table.priority} IN ('low', 'normal', 'high') AND ${table.status} IN ('active', 'addressed', 'deferred') AND length(trim(${table.title})) BETWEEN 1 AND 200 AND coalesce(length(${table.description}), 0) <= 2000`,
    ),
    foreignKey({
      name: 'care_plan_needs_revision_fk',
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [carePlanRevisions.tenantId, carePlanRevisions.id],
    }),
  ],
);

export const carePlanResources = carePlanning.table(
  'resources',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    id: uuid('id').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.id] }),
    index('care_plan_resources_revision_idx').on(table.tenantId, table.revisionId, table.status),
    check(
      'care_plan_resources_values_ck',
      sql`${table.category} IN ('self_care', 'mobility', 'communication', 'cognition', 'daily_routine', 'social_support', 'personal_interest', 'other') AND ${table.status} IN ('available', 'needs_support', 'unavailable') AND length(trim(${table.description})) BETWEEN 1 AND 2000`,
    ),
    foreignKey({
      name: 'care_plan_resources_revision_fk',
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [carePlanRevisions.tenantId, carePlanRevisions.id],
    }),
  ],
);

export const carePlanRiskResponses = carePlanning.table(
  'risk_responses',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    clientId: uuid('client_id').notNull(),
    id: uuid('id').notNull(),
    clinicalRecordId: uuid('clinical_record_id').notNull(),
    recordKind: text('record_kind').$type<'risk_assessment'>().notNull().default('risk_assessment'),
    status: text('status').notNull(),
    plannedResponse: text('planned_response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.id] }),
    uniqueIndex('care_plan_risk_responses_source_uq').on(
      table.tenantId,
      table.revisionId,
      table.clinicalRecordId,
    ),
    check(
      'care_plan_risk_responses_values_ck',
      sql`${table.recordKind} = 'risk_assessment' AND ${table.status} IN ('addressed', 'monitor', 'accepted') AND length(trim(${table.plannedResponse})) BETWEEN 1 AND 2000`,
    ),
    foreignKey({
      name: 'care_plan_risk_responses_revision_client_fk',
      columns: [table.tenantId, table.revisionId, table.clientId],
      foreignColumns: [
        carePlanRevisions.tenantId,
        carePlanRevisions.id,
        carePlanRevisions.clientId,
      ],
    }),
    foreignKey({
      name: 'care_plan_risk_responses_clinical_record_fk',
      columns: [table.tenantId, table.clientId, table.clinicalRecordId, table.recordKind],
      foreignColumns: [
        clinicalRecords.tenantId,
        clinicalRecords.clientId,
        clinicalRecords.id,
        clinicalRecords.kind,
      ],
    }),
  ],
);

export const carePlanSourceReferences = carePlanning.table(
  'source_references',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    planId: uuid('plan_id').notNull(),
    clientId: uuid('client_id').notNull(),
    clinicalRecordId: uuid('clinical_record_id').notNull(),
    recordKind: text('record_kind').notNull(),
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.clinicalRecordId] }),
    index('care_plan_source_refs_record_idx').on(
      table.tenantId,
      table.clientId,
      table.clinicalRecordId,
    ),
    check(
      'care_plan_source_refs_kind_ck',
      sql`${table.recordKind} IN ('measurement', 'observation', 'assessment', 'risk_assessment') AND coalesce(length(${table.rationale}), 0) <= 1000`,
    ),
    foreignKey({
      name: 'care_plan_source_refs_revision_client_fk',
      columns: [table.tenantId, table.revisionId, table.planId, table.clientId],
      foreignColumns: [
        carePlanRevisions.tenantId,
        carePlanRevisions.id,
        carePlanRevisions.planId,
        carePlanRevisions.clientId,
      ],
    }),
    foreignKey({
      name: 'care_plan_source_refs_clinical_record_fk',
      columns: [table.tenantId, table.clientId, table.clinicalRecordId, table.recordKind],
      foreignColumns: [
        clinicalRecords.tenantId,
        clinicalRecords.clientId,
        clinicalRecords.id,
        clinicalRecords.kind,
      ],
    }),
  ],
);

export const carePlanGoals = carePlanning.table(
  'goals',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    id: uuid('id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    targetDate: date('target_date', { mode: 'string' }),
    status: text('status').notNull(),
    priority: text('priority').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.id] }),
    index('care_plan_goals_revision_idx').on(table.tenantId, table.revisionId, table.status),
    check(
      'care_plan_goals_values_ck',
      sql`${table.status} IN ('active', 'achieved', 'discontinued') AND ${table.priority} IN ('low', 'normal', 'high') AND length(trim(${table.title})) BETWEEN 1 AND 200 AND coalesce(length(${table.description}), 0) <= 2000`,
    ),
    foreignKey({
      name: 'care_plan_goals_revision_fk',
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [carePlanRevisions.tenantId, carePlanRevisions.id],
    }),
  ],
);

export const carePlanGoalNeeds = carePlanning.table(
  'goal_needs',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    goalId: uuid('goal_id').notNull(),
    needId: uuid('need_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.goalId, table.needId] }),
    foreignKey({
      name: 'care_plan_goal_needs_goal_fk',
      columns: [table.tenantId, table.revisionId, table.goalId],
      foreignColumns: [carePlanGoals.tenantId, carePlanGoals.revisionId, carePlanGoals.id],
    }),
    foreignKey({
      name: 'care_plan_goal_needs_need_fk',
      columns: [table.tenantId, table.revisionId, table.needId],
      foreignColumns: [carePlanNeeds.tenantId, carePlanNeeds.revisionId, carePlanNeeds.id],
    }),
  ],
);

export const carePlanMeasures = carePlanning.table(
  'measures',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    id: uuid('id').notNull(),
    title: text('title').notNull(),
    instruction: text('instruction').notNull(),
    category: text('category').notNull(),
    serviceDefinitionId: uuid('service_definition_id'),
    frequencyText: text('frequency_text'),
    responsibleRole: text('responsible_role'),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.id] }),
    index('care_plan_measures_revision_idx').on(table.tenantId, table.revisionId, table.status),
    check(
      'care_plan_measures_values_ck',
      sql`${table.category} IN ('personal_care', 'assistance', 'encouragement', 'monitoring', 'positioning', 'communication', 'other') AND ${table.status} IN ('active', 'discontinued') AND length(trim(${table.title})) BETWEEN 1 AND 200 AND length(trim(${table.instruction})) BETWEEN 1 AND 4000 AND coalesce(length(${table.frequencyText}), 0) <= 500 AND coalesce(length(${table.responsibleRole}), 0) <= 100 AND (${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom})`,
    ),
    foreignKey({
      name: 'care_plan_measures_revision_fk',
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [carePlanRevisions.tenantId, carePlanRevisions.id],
    }),
    foreignKey({
      name: 'care_plan_measures_service_fk',
      columns: [table.tenantId, table.serviceDefinitionId],
      foreignColumns: [serviceDefinitions.tenantId, serviceDefinitions.id],
    }),
  ],
);

export const carePlanRiskResponseNeeds = carePlanning.table(
  'risk_response_needs',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    riskResponseId: uuid('risk_response_id').notNull(),
    needId: uuid('need_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.riskResponseId, table.needId] }),
    foreignKey({
      name: 'care_plan_risk_response_needs_response_fk',
      columns: [table.tenantId, table.revisionId, table.riskResponseId],
      foreignColumns: [
        carePlanRiskResponses.tenantId,
        carePlanRiskResponses.revisionId,
        carePlanRiskResponses.id,
      ],
    }),
    foreignKey({
      name: 'care_plan_risk_response_needs_need_fk',
      columns: [table.tenantId, table.revisionId, table.needId],
      foreignColumns: [carePlanNeeds.tenantId, carePlanNeeds.revisionId, carePlanNeeds.id],
    }),
  ],
);

export const carePlanRiskResponseMeasures = carePlanning.table(
  'risk_response_measures',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    riskResponseId: uuid('risk_response_id').notNull(),
    measureId: uuid('measure_id').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.revisionId, table.riskResponseId, table.measureId],
    }),
    foreignKey({
      name: 'care_plan_risk_response_measures_response_fk',
      columns: [table.tenantId, table.revisionId, table.riskResponseId],
      foreignColumns: [
        carePlanRiskResponses.tenantId,
        carePlanRiskResponses.revisionId,
        carePlanRiskResponses.id,
      ],
    }),
    foreignKey({
      name: 'care_plan_risk_response_measures_measure_fk',
      columns: [table.tenantId, table.revisionId, table.measureId],
      foreignColumns: [carePlanMeasures.tenantId, carePlanMeasures.revisionId, carePlanMeasures.id],
    }),
  ],
);

export const carePlanMeasureNeeds = carePlanning.table(
  'measure_needs',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    measureId: uuid('measure_id').notNull(),
    needId: uuid('need_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.measureId, table.needId] }),
    foreignKey({
      name: 'care_plan_measure_needs_measure_fk',
      columns: [table.tenantId, table.revisionId, table.measureId],
      foreignColumns: [carePlanMeasures.tenantId, carePlanMeasures.revisionId, carePlanMeasures.id],
    }),
    foreignKey({
      name: 'care_plan_measure_needs_need_fk',
      columns: [table.tenantId, table.revisionId, table.needId],
      foreignColumns: [carePlanNeeds.tenantId, carePlanNeeds.revisionId, carePlanNeeds.id],
    }),
  ],
);

export const carePlanMeasureGoals = carePlanning.table(
  'measure_goals',
  {
    tenantId: uuid('tenant_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    measureId: uuid('measure_id').notNull(),
    goalId: uuid('goal_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.revisionId, table.measureId, table.goalId] }),
    foreignKey({
      name: 'care_plan_measure_goals_measure_fk',
      columns: [table.tenantId, table.revisionId, table.measureId],
      foreignColumns: [carePlanMeasures.tenantId, carePlanMeasures.revisionId, carePlanMeasures.id],
    }),
    foreignKey({
      name: 'care_plan_measure_goals_goal_fk',
      columns: [table.tenantId, table.revisionId, table.goalId],
      foreignColumns: [carePlanGoals.tenantId, carePlanGoals.revisionId, carePlanGoals.id],
    }),
  ],
);

export const carePlanEvaluations = carePlanning.table(
  'evaluations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    planId: uuid('plan_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    clientId: uuid('client_id').notNull(),
    evaluatedByEmployeeId: uuid('evaluated_by_employee_id').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    result: text('result').notNull(),
    planChange: text('plan_change').notNull(),
    summary: text('summary').notNull(),
    nextEvaluationDue: date('next_evaluation_due', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('care_plan_evaluations_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('care_plan_evaluations_id_revision_uq').on(
      table.tenantId,
      table.id,
      table.revisionId,
    ),
    index('care_plan_evaluations_latest_idx').on(
      table.tenantId,
      table.planId,
      table.evaluatedAt,
      table.id,
    ),
    check(
      'care_plan_evaluations_values_ck',
      sql`${table.result} IN ('effective', 'partially_effective', 'not_effective', 'changed_condition', 'no_change') AND ${table.planChange} IN ('none', 'revision_required') AND length(trim(${table.summary})) BETWEEN 1 AND 4000`,
    ),
    foreignKey({
      name: 'care_plan_evaluations_revision_client_fk',
      columns: [table.tenantId, table.revisionId, table.planId, table.clientId],
      foreignColumns: [
        carePlanRevisions.tenantId,
        carePlanRevisions.id,
        carePlanRevisions.planId,
        carePlanRevisions.clientId,
      ],
    }),
    foreignKey({
      name: 'care_plan_evaluations_evaluator_fk',
      columns: [table.tenantId, table.evaluatedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const carePlanEvaluationGoals = carePlanning.table(
  'evaluation_goals',
  {
    tenantId: uuid('tenant_id').notNull(),
    evaluationId: uuid('evaluation_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    goalId: uuid('goal_id').notNull(),
    outcome: text('outcome').notNull(),
    note: text('note'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.evaluationId, table.goalId] }),
    check(
      'care_plan_evaluation_goals_values_ck',
      sql`${table.outcome} IN ('achieved', 'partially_achieved', 'not_achieved', 'not_applicable') AND coalesce(length(${table.note}), 0) <= 1000`,
    ),
    foreignKey({
      name: 'care_plan_evaluation_goals_evaluation_fk',
      columns: [table.tenantId, table.evaluationId, table.revisionId],
      foreignColumns: [
        carePlanEvaluations.tenantId,
        carePlanEvaluations.id,
        carePlanEvaluations.revisionId,
      ],
    }),
    foreignKey({
      name: 'care_plan_evaluation_goals_goal_fk',
      columns: [table.tenantId, table.revisionId, table.goalId],
      foreignColumns: [carePlanGoals.tenantId, carePlanGoals.revisionId, carePlanGoals.id],
    }),
  ],
);

export const carePlanningSchema = {
  carePlans,
  carePlanRevisions,
  carePlanAssessments,
  carePlanNeeds,
  carePlanResources,
  carePlanRiskResponses,
  carePlanSourceReferences,
  carePlanGoals,
  carePlanGoalNeeds,
  carePlanMeasures,
  carePlanRiskResponseNeeds,
  carePlanRiskResponseMeasures,
  carePlanMeasureNeeds,
  carePlanMeasureGoals,
  carePlanEvaluations,
  carePlanEvaluationGoals,
};
