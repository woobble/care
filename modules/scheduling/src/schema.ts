import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientRecords } from '@care/clients';
import { employeeRecords } from '@care/employees';
import { facilities } from '@care/organizations';
import { agreementServices, agreements } from '@care/service-agreements';
import { serviceDefinitions } from '@care/services';

const scheduling = pgSchema('scheduling');

export const visits = scheduling.table(
  'visits',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    origin: text('origin').$type<'agreement_generated' | 'manual'>().notNull(),
    serviceAgreementId: uuid('service_agreement_id'),
    status: text('status').$type<'planned' | 'confirmed' | 'cancelled'>().notNull(),
    plannedStart: timestamp('planned_start', { withTimezone: true }).notNull(),
    plannedEnd: timestamp('planned_end', { withTimezone: true }).notNull(),
    timeWindowStart: timestamp('time_window_start', { withTimezone: true }),
    timeWindowEnd: timestamp('time_window_end', { withTimezone: true }),
    timezone: text('timezone').notNull(),
    note: text('note'),
    manuallyAdjusted: boolean('manually_adjusted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('visits_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('visits_tenant_id_agreement_uq').on(
      table.tenantId,
      table.id,
      table.serviceAgreementId,
    ),
    index('visits_tenant_start_id_idx').on(table.tenantId, table.plannedStart, table.id),
    index('visits_facility_start_id_idx').on(
      table.tenantId,
      table.facilityId,
      table.plannedStart,
      table.id,
    ),
    index('visits_client_start_idx').on(
      table.tenantId,
      table.clientId,
      table.plannedStart,
      table.id,
    ),
    index('visits_agreement_idx')
      .on(table.tenantId, table.serviceAgreementId, table.plannedStart)
      .where(sql`${table.serviceAgreementId} IS NOT NULL`),
    index('visits_status_start_idx').on(table.tenantId, table.status, table.plannedStart, table.id),
    check('visits_planned_range_ck', sql`${table.plannedEnd} > ${table.plannedStart}`),
    check(
      'visits_window_pair_ck',
      sql`(${table.timeWindowStart} IS NULL AND ${table.timeWindowEnd} IS NULL) OR (${table.timeWindowStart} IS NOT NULL AND ${table.timeWindowEnd} IS NOT NULL AND ${table.timeWindowEnd} > ${table.timeWindowStart})`,
    ),
    foreignKey({
      name: 'visits_tenant_provider_reference_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'visits_tenant_client_provider_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId, table.clientId],
      foreignColumns: [
        clientRecords.tenantId,
        clientRecords.organizationId,
        clientRecords.primaryFacilityId,
        clientRecords.id,
      ],
    }),
    foreignKey({
      name: 'visits_agreement_context_fk',
      columns: [
        table.tenantId,
        table.clientId,
        table.organizationId,
        table.facilityId,
        table.serviceAgreementId,
      ],
      foreignColumns: [
        agreements.tenantId,
        agreements.clientId,
        agreements.organizationId,
        agreements.facilityId,
        agreements.id,
      ],
    }),
  ],
);

export const visitServices = scheduling.table(
  'visit_services',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    serviceAgreementId: uuid('service_agreement_id'),
    agreementServiceId: uuid('agreement_service_id'),
    serviceDefinitionId: uuid('service_definition_id').notNull(),
    serviceCodeSnapshot: text('service_code_snapshot').notNull(),
    serviceNameSnapshot: text('service_name_snapshot').notNull(),
    unitSnapshot: text('unit_snapshot').$type<'occurrence' | 'minute' | 'hour' | 'day'>().notNull(),
    plannedQuantity: numeric('planned_quantity', {
      precision: 12,
      scale: 3,
      mode: 'string',
    }).notNull(),
    plannedDurationMinutes: integer('planned_duration_minutes'),
    generationKey: text('generation_key'),
    generatedFromRule: boolean('generated_from_rule').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('visit_services_tenant_visit_idx').on(table.tenantId, table.visitId, table.id),
    index('visit_services_service_idx').on(
      table.tenantId,
      table.serviceDefinitionId,
      table.visitId,
    ),
    uniqueIndex('visit_services_generation_key_uq')
      .on(table.tenantId, table.generationKey)
      .where(sql`${table.generationKey} IS NOT NULL`),
    check('visit_services_planned_quantity_ck', sql`${table.plannedQuantity} > 0`),
    check(
      'visit_services_agreement_reference_ck',
      sql`(${table.serviceAgreementId} IS NULL AND ${table.agreementServiceId} IS NULL) OR (${table.serviceAgreementId} IS NOT NULL AND ${table.agreementServiceId} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'visit_services_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'visit_services_visit_agreement_fk',
      columns: [table.tenantId, table.visitId, table.serviceAgreementId],
      foreignColumns: [visits.tenantId, visits.id, visits.serviceAgreementId],
    }),
    foreignKey({
      name: 'visit_services_service_fk',
      columns: [table.tenantId, table.serviceDefinitionId],
      foreignColumns: [serviceDefinitions.tenantId, serviceDefinitions.id],
    }),
    foreignKey({
      name: 'visit_services_agreement_service_fk',
      columns: [
        table.tenantId,
        table.serviceAgreementId,
        table.agreementServiceId,
        table.serviceDefinitionId,
      ],
      foreignColumns: [
        agreementServices.tenantId,
        agreementServices.agreementId,
        agreementServices.id,
        agreementServices.serviceDefinitionId,
      ],
    }),
  ],
);

export const visitAssignments = scheduling.table(
  'visit_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    role: text('role'),
    status: text('status').$type<'active' | 'unassigned'>().notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    assignedBy: uuid('assigned_by').notNull(),
    unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
  },
  (table) => [
    index('visit_assignments_employee_active_idx')
      .on(table.tenantId, table.employeeId, table.visitId)
      .where(sql`${table.status} = 'active'`),
    index('visit_assignments_visit_idx').on(
      table.tenantId,
      table.visitId,
      table.status,
      table.assignedAt,
    ),
    uniqueIndex('visit_assignments_active_employee_uq')
      .on(table.tenantId, table.visitId, table.employeeId)
      .where(sql`${table.status} = 'active'`),
    foreignKey({
      name: 'visit_assignments_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'visit_assignments_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const employeeUnavailability = scheduling.table(
  'employee_unavailability',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
  },
  (table) => [
    index('employee_unavailability_employee_range_idx').on(
      table.tenantId,
      table.employeeId,
      table.startsAt,
      table.endsAt,
    ),
    check('employee_unavailability_range_ck', sql`${table.endsAt} > ${table.startsAt}`),
    foreignKey({
      name: 'employee_unavailability_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const scheduleGenerations = scheduling.table(
  'schedule_generations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    agreementId: uuid('agreement_id').notNull(),
    generatedBy: uuid('generated_by').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    untilDate: date('until_date', { mode: 'string' }).notNull(),
    generatedCount: integer('generated_count').notNull(),
    alreadyExistingCount: integer('already_existing_count').notNull(),
    requiresManualPlacementCount: integer('requires_manual_placement_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('schedule_generations_agreement_created_idx').on(
      table.tenantId,
      table.agreementId,
      table.createdAt,
    ),
    check('schedule_generations_range_ck', sql`${table.untilDate} >= ${table.fromDate}`),
    check(
      'schedule_generations_counts_ck',
      sql`${table.generatedCount} >= 0 AND ${table.alreadyExistingCount} >= 0 AND ${table.requiresManualPlacementCount} >= 0`,
    ),
    foreignKey({
      name: 'schedule_generations_agreement_fk',
      columns: [table.tenantId, table.agreementId],
      foreignColumns: [agreements.tenantId, agreements.id],
    }),
  ],
);

export const schedulingSchema = {
  visits,
  visitServices,
  visitAssignments,
  employeeUnavailability,
  scheduleGenerations,
};
