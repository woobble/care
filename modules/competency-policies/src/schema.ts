import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { qualificationDefinitions } from '@care/employees';
import { tenants } from '@care/organizations';
import type { CompetencyOperation } from '@care/permissions';

const authorization = pgSchema('authorization');

export const professionalCompetencyPolicies = authorization.table(
  'professional_competency_policies',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    operationKey: text('operation_key').$type<CompetencyOperation>().notNull(),
    latestVersion: integer('latest_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('professional_competency_policies_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('professional_competency_policies_tenant_id_operation_uq').on(
      table.tenantId,
      table.id,
      table.operationKey,
    ),
    uniqueIndex('professional_competency_policies_tenant_operation_uq').on(
      table.tenantId,
      table.operationKey,
    ),
    check(
      'professional_competency_policies_operation_check',
      sql`${table.operationKey} IN ('care_plan.activate', 'care_plan.evaluate', 'medication.administer', 'medication.administration.correct', 'medication.reconciliation.complete')`,
    ),
    check(
      'professional_competency_policies_latest_version_check',
      sql`${table.latestVersion} >= 0`,
    ),
    foreignKey({
      name: 'professional_competency_policies_tenant_fk',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const professionalCompetencyPolicyVersions = authorization.table(
  'professional_competency_policy_versions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    operationKey: text('operation_key').$type<CompetencyOperation>().notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    requirementMode: text('requirement_mode').$type<'ANY' | 'ALL'>().notNull(),
    requirementCount: integer('requirement_count').notNull().default(0),
    status: text('status').$type<'draft' | 'active' | 'inactive'>().notNull().default('draft'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('professional_competency_policy_versions_tenant_id_id_uq').on(
      table.tenantId,
      table.id,
    ),
    uniqueIndex('professional_competency_policy_versions_policy_version_uq').on(
      table.tenantId,
      table.policyId,
      table.version,
    ),
    uniqueIndex('professional_competency_policy_versions_active_operation_uq')
      .on(table.tenantId, table.operationKey)
      .where(sql`${table.status} = 'active'`),
    index('professional_competency_policy_versions_history_idx').on(
      table.tenantId,
      table.policyId,
      table.version,
    ),
    check('professional_competency_policy_versions_version_check', sql`${table.version} > 0`),
    check(
      'professional_competency_policy_versions_operation_check',
      sql`${table.operationKey} IN ('care_plan.activate', 'care_plan.evaluate', 'medication.administer', 'medication.administration.correct', 'medication.reconciliation.complete')`,
    ),
    check(
      'professional_competency_policy_versions_requirement_mode_check',
      sql`${table.requirementMode} IN ('ANY', 'ALL')`,
    ),
    check(
      'professional_competency_policy_versions_status_check',
      sql`${table.status} IN ('draft', 'active', 'inactive')`,
    ),
    check(
      'professional_competency_policy_versions_requirement_count_check',
      sql`${table.requirementCount} >= 0 AND (${table.status} <> 'active' OR ${table.requirementCount} > 0)`,
    ),
    check(
      'professional_competency_policy_versions_lifecycle_timestamps_check',
      sql`(${table.status} = 'draft' AND ${table.activatedAt} IS NULL AND ${table.deactivatedAt} IS NULL) OR (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.deactivatedAt} IS NULL) OR (${table.status} = 'inactive' AND ${table.activatedAt} IS NOT NULL AND ${table.deactivatedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'professional_competency_policy_versions_policy_fk',
      columns: [table.tenantId, table.policyId, table.operationKey],
      foreignColumns: [
        professionalCompetencyPolicies.tenantId,
        professionalCompetencyPolicies.id,
        professionalCompetencyPolicies.operationKey,
      ],
    }),
  ],
);

export const professionalCompetencyPolicyRequirements = authorization.table(
  'professional_competency_policy_requirements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    policyVersionId: uuid('policy_version_id').notNull(),
    qualificationDefinitionId: uuid('qualification_definition_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('professional_competency_policy_requirements_tenant_id_id_uq').on(
      table.tenantId,
      table.id,
    ),
    uniqueIndex('professional_competency_policy_requirements_version_qualification_uq').on(
      table.tenantId,
      table.policyVersionId,
      table.qualificationDefinitionId,
    ),
    index('professional_competency_policy_requirements_qualification_idx').on(
      table.tenantId,
      table.qualificationDefinitionId,
    ),
    foreignKey({
      name: 'professional_competency_policy_requirements_version_fk',
      columns: [table.tenantId, table.policyVersionId],
      foreignColumns: [
        professionalCompetencyPolicyVersions.tenantId,
        professionalCompetencyPolicyVersions.id,
      ],
    }),
    foreignKey({
      name: 'professional_competency_policy_requirements_qualification_fk',
      columns: [table.tenantId, table.qualificationDefinitionId],
      foreignColumns: [qualificationDefinitions.tenantId, qualificationDefinitions.id],
    }),
  ],
);

export const competencyPoliciesSchema = {
  professionalCompetencyPolicies,
  professionalCompetencyPolicyVersions,
  professionalCompetencyPolicyRequirements,
};
