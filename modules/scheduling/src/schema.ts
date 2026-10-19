import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { clientRecords } from '@care/clients';
import { employeeRecords } from '@care/employees';
import { facilities } from '@care/organizations';
import { tenantMemberships } from '@care/identity';
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
    uniqueIndex('visit_services_tenant_visit_id_uq').on(table.tenantId, table.visitId, table.id),
    uniqueIndex('visit_services_tenant_visit_service_definition_uq').on(
      table.tenantId,
      table.visitId,
      table.id,
      table.serviceDefinitionId,
    ),
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
    uniqueIndex('visit_assignments_tenant_visit_id_uq').on(table.tenantId, table.visitId, table.id),
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

export const calendarSubscriptions = scheduling.table(
  'calendar_subscriptions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('calendar_subscriptions_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('calendar_subscriptions_tenant_token_hash_uq').on(table.tenantId, table.tokenHash),
    uniqueIndex('calendar_subscriptions_active_employee_uq')
      .on(table.tenantId, table.employeeId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('calendar_subscriptions_employee_created_idx').on(
      table.tenantId,
      table.employeeId,
      table.createdAt,
    ),
    check('calendar_subscriptions_token_hash_ck', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'calendar_subscriptions_revoked_at_ck',
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      name: 'calendar_subscriptions_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'calendar_subscriptions_membership_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
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
    reason: text('reason')
      .$type<'vacation' | 'sick_leave' | 'training' | 'personal_unavailability' | 'other'>()
      .notNull()
      .default('other'),
    status: text('status').$type<'active' | 'cancelled'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: uuid('updated_by').notNull(),
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

export const employeeAvailability = scheduling.table(
  'employee_availability',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    timezone: text('timezone').notNull(),
    maxDailyMinutes: integer('max_daily_minutes'),
    travelBufferMinutes: integer('travel_buffer_minutes').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('employee_availability_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('employee_availability_employee_uq').on(table.tenantId, table.employeeId),
    index('employee_availability_employee_idx').on(table.tenantId, table.employeeId),
    check(
      'employee_availability_daily_minutes_ck',
      sql`${table.maxDailyMinutes} IS NULL OR ${table.maxDailyMinutes} BETWEEN 1 AND 1440`,
    ),
    check(
      'employee_availability_travel_buffer_ck',
      sql`${table.travelBufferMinutes} BETWEEN 0 AND 240`,
    ),
    check('employee_availability_version_ck', sql`${table.version} >= 1`),
    foreignKey({
      name: 'employee_availability_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const employeeAvailabilityWindows = scheduling.table(
  'employee_availability_windows',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    availabilityId: uuid('availability_id').notNull(),
    weekday: integer('weekday').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
  },
  (table) => [
    index('employee_availability_windows_lookup_idx').on(
      table.tenantId,
      table.availabilityId,
      table.weekday,
      table.startsAt,
    ),
    check('employee_availability_windows_weekday_ck', sql`${table.weekday} BETWEEN 1 AND 7`),
    check('employee_availability_windows_range_ck', sql`${table.startsAt} <> ${table.endsAt}`),
    uniqueIndex('employee_availability_windows_unique_uq').on(
      table.tenantId,
      table.availabilityId,
      table.weekday,
      table.startsAt,
      table.endsAt,
    ),
    foreignKey({
      name: 'employee_availability_windows_policy_fk',
      columns: [table.tenantId, table.availabilityId],
      foreignColumns: [employeeAvailability.tenantId, employeeAvailability.id],
    }),
  ],
);

export const employeeAvailabilityExceptions = scheduling.table(
  'employee_availability_exceptions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    kind: text('kind').$type<'working_hours' | 'closed' | 'unavailable'>().notNull(),
    startsAt: time('starts_at'),
    endsAt: time('ends_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('employee_availability_exceptions_lookup_idx').on(
      table.tenantId,
      table.employeeId,
      table.localDate,
      table.id,
    ),
    check(
      'employee_availability_exceptions_range_ck',
      sql`(${table.kind} = 'working_hours' AND ${table.startsAt} IS NOT NULL AND ${table.endsAt} IS NOT NULL AND ${table.startsAt} <> ${table.endsAt}) OR (${table.kind} = 'closed' AND ${table.startsAt} IS NULL AND ${table.endsAt} IS NULL) OR (${table.kind} = 'unavailable' AND ((${table.startsAt} IS NULL AND ${table.endsAt} IS NULL) OR (${table.startsAt} IS NOT NULL AND ${table.endsAt} IS NOT NULL AND ${table.startsAt} <> ${table.endsAt})))`,
    ),
    foreignKey({
      name: 'employee_availability_exceptions_employee_fk',
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

export const visitSubstitutions = scheduling.table(
  'visit_substitutions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    originalAssignmentId: uuid('original_assignment_id').notNull(),
    originalEmployeeId: uuid('original_employee_id').notNull(),
    substituteEmployeeId: uuid('substitute_employee_id').notNull(),
    status: text('status').$type<'proposed' | 'confirmed' | 'cancelled'>().notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
  },
  (table) => [
    uniqueIndex('visit_substitutions_one_proposal_uq')
      .on(table.tenantId, table.visitId)
      .where(sql`${table.status} = 'proposed'`),
    index('visit_substitutions_employee_status_idx').on(
      table.tenantId,
      table.substituteEmployeeId,
      table.status,
      table.createdAt,
    ),
    check(
      'visit_substitutions_resolution_ck',
      sql`(${table.status} = 'proposed' AND ${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL) OR (${table.status} <> 'proposed' AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedBy} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'visit_substitutions_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'visit_substitutions_assignment_fk',
      columns: [table.tenantId, table.visitId, table.originalAssignmentId],
      foreignColumns: [visitAssignments.tenantId, visitAssignments.visitId, visitAssignments.id],
    }),
    foreignKey({
      name: 'visit_substitutions_original_employee_fk',
      columns: [table.tenantId, table.originalEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'visit_substitutions_substitute_employee_fk',
      columns: [table.tenantId, table.substituteEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const tours = scheduling.table(
  'tours',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    timezone: text('timezone').notNull(),
    status: text('status').$type<'draft' | 'published'>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('tours_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('tours_employee_date_uq').on(table.tenantId, table.employeeId, table.localDate),
    index('tours_date_employee_idx').on(
      table.tenantId,
      table.localDate,
      table.employeeId,
      table.id,
    ),
    check('tours_version_ck', sql`${table.version} >= 1`),
    foreignKey({
      name: 'tours_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'tours_provider_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
  ],
);

export const tourStops = scheduling.table(
  'tour_stops',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    tourId: uuid('tour_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    sequence: integer('sequence').notNull(),
    estimatedTravelMinutes: integer('estimated_travel_minutes'),
    estimatedDistanceMeters: integer('estimated_distance_meters'),
    routeStatus: text('route_status')
      .$type<'unknown' | 'available' | 'unavailable' | 'unresolved'>()
      .notNull()
      .default('unknown'),
    dispatcherNote: text('dispatcher_note'),
  },
  (table) => [
    uniqueIndex('tour_stops_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('tour_stops_tour_sequence_uq').on(table.tenantId, table.tourId, table.sequence),
    uniqueIndex('tour_stops_tour_visit_uq').on(table.tenantId, table.tourId, table.visitId),
    index('tour_stops_visit_idx').on(table.tenantId, table.visitId),
    check('tour_stops_sequence_ck', sql`${table.sequence} >= 1`),
    foreignKey({
      name: 'tour_stops_tour_fk',
      columns: [table.tenantId, table.tourId],
      foreignColumns: [tours.tenantId, tours.id],
    }),
    foreignKey({
      name: 'tour_stops_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
  ],
);

export const tourPublications = scheduling.table(
  'tour_publications',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    tourId: uuid('tour_id').notNull(),
    version: integer('version').notNull(),
    employeeId: uuid('employee_id').notNull(),
    snapshot: jsonb('snapshot').$type<unknown[]>().notNull(),
    changeSummary: jsonb('change_summary').$type<unknown[]>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    publishedBy: uuid('published_by').notNull(),
  },
  (table) => [
    uniqueIndex('tour_publications_tour_version_uq').on(
      table.tenantId,
      table.tourId,
      table.version,
    ),
    index('tour_publications_latest_idx').on(table.tenantId, table.tourId, table.version),
    foreignKey({
      name: 'tour_publications_tour_fk',
      columns: [table.tenantId, table.tourId],
      foreignColumns: [tours.tenantId, tours.id],
    }),
    foreignKey({
      name: 'tour_publications_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const clientRoutingLocations = scheduling.table(
  'client_routing_locations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('client_routing_locations_client_uq').on(table.tenantId, table.clientId),
    foreignKey({
      name: 'client_routing_locations_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
  ],
);

export const employeeSchedulingPreferences = scheduling.table(
  'employee_scheduling_preferences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    preferredWeekdays: smallint('preferred_weekdays').array().notNull().default([]),
    preferredTimeWindows: jsonb('preferred_time_windows')
      .$type<Array<{ startsAt: string; endsAt: string }>>()
      .notNull(),
    preferredStartLatitude: numeric('preferred_start_latitude', { precision: 9, scale: 6 }),
    preferredStartLongitude: numeric('preferred_start_longitude', { precision: 9, scale: 6 }),
    travelMode: text('travel_mode').$type<'driving'>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('employee_scheduling_preferences_employee_uq').on(table.tenantId, table.employeeId),
    foreignKey({
      name: 'employee_scheduling_preferences_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const clientSchedulingPreferences = scheduling.table(
  'client_scheduling_preferences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    preferredWeekdays: smallint('preferred_weekdays').array().notNull().default([]),
    preferredTimeWindows: jsonb('preferred_time_windows')
      .$type<Array<{ startsAt: string; endsAt: string }>>()
      .notNull(),
    preferredEmployeeId: uuid('preferred_employee_id'),
    avoidedEmployeeIds: uuid('avoided_employee_ids').array().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('client_scheduling_preferences_client_uq').on(table.tenantId, table.clientId),
    foreignKey({
      name: 'client_scheduling_preferences_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'client_scheduling_preferences_preferred_employee_fk',
      columns: [table.tenantId, table.preferredEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const schedulingSchema = {
  visits,
  visitServices,
  visitAssignments,
  calendarSubscriptions,
  employeeUnavailability,
  employeeAvailability,
  employeeAvailabilityWindows,
  employeeAvailabilityExceptions,
  scheduleGenerations,
  visitSubstitutions,
  tours,
  tourStops,
  tourPublications,
  clientRoutingLocations,
  employeeSchedulingPreferences,
  clientSchedulingPreferences,
};
