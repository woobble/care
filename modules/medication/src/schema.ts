import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientRecords } from '@care/clients';
import { employeeRecords } from '@care/employees';
import { tenants } from '@care/organizations';
import type { MedicationOrderFacts, MedicationOutcome, MedicationReason, MedicationSchedule } from './domain/medication';

const medication = pgSchema('medication');

export const medicationDefinitions = medication.table(
  'definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    activeIngredient: text('active_ingredient'),
    strength: text('strength'),
    dosageForm: text('dosage_form').notNull(),
    route: text('route').notNull(),
    manufacturer: text('manufacturer'),
    externalCode: text('external_code'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('medication_definitions_tenant_id_uq').on(table.tenantId, table.id),
    index('medication_definitions_tenant_name_idx').on(table.tenantId, table.status, table.name),
    check('medication_definitions_name_ck', sql`length(trim(${table.name})) BETWEEN 1 AND 200`),
    check(
      'medication_definitions_status_ck',
      sql`${table.status} IN ('active', 'archived') AND ${table.dosageForm} IN ('tablet', 'capsule', 'drops', 'solution', 'injection', 'cream', 'patch', 'inhalation', 'other') AND ${table.route} IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other')`,
    ),
    foreignKey({
      name: 'medication_definitions_tenant_fk',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const medicationOrders = medication.table(
  'orders',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    status: text('status').$type<'draft' | 'active' | 'paused' | 'discontinued'>().notNull(),
    version: integer('version').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('medication_orders_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('medication_orders_tenant_id_client_uq').on(table.tenantId, table.id, table.clientId),
    index('medication_orders_client_status_idx').on(table.tenantId, table.clientId, table.status, table.updatedAt),
    check('medication_orders_status_ck', sql`${table.status} IN ('draft', 'active', 'paused', 'discontinued') AND ${table.version} > 0`),
    foreignKey({
      name: 'medication_orders_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
  ],
);

export const medicationOrderRevisions = medication.table(
  'order_revisions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    clientId: uuid('client_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').$type<'draft' | 'active' | 'paused' | 'discontinued'>().notNull(),
    medicationDefinitionId: uuid('medication_definition_id').notNull(),
    medicationSnapshot: jsonb('medication_snapshot').$type<MedicationOrderFacts['medicationSnapshot']>().notNull(),
    doseAmount: numeric('dose_amount', { precision: 12, scale: 3, mode: 'string' }).notNull(),
    doseUnit: text('dose_unit').notNull(),
    route: text('route').notNull(),
    instructions: text('instructions'),
    indication: text('indication'),
    prescriberName: text('prescriber_name'),
    sourceType: text('source_type').notNull(),
    sourceReference: text('source_reference'),
    prescribedAt: timestamp('prescribed_at', { withTimezone: true }),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    schedule: jsonb('schedule').$type<MedicationSchedule>().notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('medication_order_revisions_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('medication_order_revisions_order_version_uq').on(table.tenantId, table.orderId, table.version),
    uniqueIndex('medication_order_revisions_reference_uq').on(table.tenantId, table.id, table.orderId, table.clientId, table.version),
    index('medication_order_revisions_history_idx').on(table.tenantId, table.orderId, table.version),
    check('medication_order_revisions_status_ck', sql`${table.status} IN ('draft', 'active', 'paused', 'discontinued') AND ${table.version} > 0`),
    check('medication_order_revisions_dose_ck', sql`${table.doseAmount} > 0 AND ${table.doseUnit} IN ('mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch') AND ${table.route} IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other')`),
    check('medication_order_revisions_validity_ck', sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`),
    check('medication_order_revisions_source_ck', sql`${table.sourceType} IN ('prescriber', 'care_authorizing_source', 'staff_transcription') AND (${table.status} <> 'active' OR length(trim(coalesce(${table.sourceReference}, ''))) BETWEEN 1 AND 1000)`),
    foreignKey({
      name: 'medication_order_revisions_order_fk',
      columns: [table.tenantId, table.orderId, table.clientId],
      foreignColumns: [medicationOrders.tenantId, medicationOrders.id, medicationOrders.clientId],
    }),
    foreignKey({
      name: 'medication_order_revisions_definition_fk',
      columns: [table.tenantId, table.medicationDefinitionId],
      foreignColumns: [medicationDefinitions.tenantId, medicationDefinitions.id],
    }),
  ],
);

export const medicationAdministrationOccurrences = medication.table(
  'administration_occurrences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    orderId: uuid('order_id').notNull(),
    orderRevisionId: uuid('order_revision_id').notNull(),
    orderVersion: integer('order_version').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    scheduledTimezone: text('scheduled_timezone').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    localTime: text('local_time').notNull(),
    status: text('status').$type<'pending' | 'cancelled' | 'recorded'>().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('medication_occurrences_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('medication_occurrences_schedule_identity_uq').on(table.tenantId, table.orderId, table.orderRevisionId, table.scheduledAt),
    uniqueIndex('medication_occurrences_record_reference_uq').on(table.tenantId, table.id, table.clientId, table.orderId, table.orderRevisionId, table.orderVersion),
    index('medication_occurrences_client_scheduled_idx').on(table.tenantId, table.clientId, table.scheduledAt),
    index('medication_occurrences_client_local_date_idx').on(table.tenantId, table.clientId, table.localDate, table.localTime),
    check('medication_occurrences_status_ck', sql`${table.status} IN ('pending', 'cancelled', 'recorded') AND ${table.orderVersion} > 0`),
    foreignKey({
      name: 'medication_occurrences_order_fk',
      columns: [table.tenantId, table.orderId, table.clientId],
      foreignColumns: [medicationOrders.tenantId, medicationOrders.id, medicationOrders.clientId],
    }),
    foreignKey({
      name: 'medication_occurrences_revision_fk',
      columns: [table.tenantId, table.orderRevisionId, table.orderId, table.clientId, table.orderVersion],
      foreignColumns: [medicationOrderRevisions.tenantId, medicationOrderRevisions.id, medicationOrderRevisions.orderId, medicationOrderRevisions.clientId, medicationOrderRevisions.version],
    }),
  ],
);

export const medicationAdministrationRecords = medication.table(
  'administration_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    orderId: uuid('order_id').notNull(),
    orderRevisionId: uuid('order_revision_id').notNull(),
    orderVersion: integer('order_version').notNull(),
    occurrenceId: uuid('occurrence_id'),
    visitId: uuid('visit_id').notNull(),
    outcome: text('outcome').$type<MedicationOutcome>().notNull(),
    orderedDoseAmount: numeric('ordered_dose_amount', { precision: 12, scale: 3, mode: 'string' }).notNull(),
    orderedDoseUnit: text('ordered_dose_unit').notNull(),
    route: text('route').notNull(),
    actualDoseAmount: numeric('actual_dose_amount', { precision: 12, scale: 3, mode: 'string' }),
    actualDoseUnit: text('actual_dose_unit'),
    reasonCode: text('reason_code').$type<MedicationReason>(),
    administrationReason: text('administration_reason'),
    note: text('note'),
    administeredByEmployeeId: uuid('administered_by_employee_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('medication_administration_records_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('medication_administration_one_record_per_occurrence_uq').on(table.tenantId, table.occurrenceId).where(sql`${table.occurrenceId} IS NOT NULL`),
    index('medication_administration_client_time_idx').on(table.tenantId, table.clientId, table.occurredAt),
    index('medication_administration_order_time_idx').on(table.tenantId, table.orderId, table.occurredAt),
    check('medication_administration_values_ck', sql`${table.outcome} IN ('administered', 'not_administered', 'refused', 'withheld') AND ${table.orderedDoseAmount} > 0 AND ${table.orderedDoseUnit} IN ('mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch') AND ${table.route} IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other') AND ((outcome = 'administered' AND actual_dose_amount > 0 AND actual_dose_unit = ordered_dose_unit) OR (outcome <> 'administered' AND actual_dose_amount IS NULL AND actual_dose_unit IS NULL))`),
    check('medication_administration_reason_ck', sql`${table.reasonCode} IS NULL OR ${table.reasonCode} IN ('client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other')`),
    check('medication_administration_note_ck', sql`${table.note} IS NULL OR length(${table.note}) <= 2000`),
    check('medication_administration_reason_text_ck', sql`${table.administrationReason} IS NULL OR length(${table.administrationReason}) <= 1000`),
    foreignKey({
      name: 'medication_administration_order_fk',
      columns: [table.tenantId, table.orderId, table.clientId],
      foreignColumns: [medicationOrders.tenantId, medicationOrders.id, medicationOrders.clientId],
    }),
    foreignKey({
      name: 'medication_administration_revision_fk',
      columns: [table.tenantId, table.orderRevisionId, table.orderId, table.clientId, table.orderVersion],
      foreignColumns: [medicationOrderRevisions.tenantId, medicationOrderRevisions.id, medicationOrderRevisions.orderId, medicationOrderRevisions.clientId, medicationOrderRevisions.version],
    }),
    foreignKey({
      name: 'medication_administration_occurrence_fk',
      columns: [table.tenantId, table.occurrenceId, table.clientId, table.orderId, table.orderRevisionId, table.orderVersion],
      foreignColumns: [medicationAdministrationOccurrences.tenantId, medicationAdministrationOccurrences.id, medicationAdministrationOccurrences.clientId, medicationAdministrationOccurrences.orderId, medicationAdministrationOccurrences.orderRevisionId, medicationAdministrationOccurrences.orderVersion],
    }),
    foreignKey({
      name: 'medication_administration_employee_fk',
      columns: [table.tenantId, table.administeredByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const medicationAdministrationCorrections = medication.table(
  'administration_corrections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    recordId: uuid('record_id').notNull(),
    version: integer('version').notNull(),
    outcome: text('outcome').$type<MedicationOutcome>().notNull(),
    actualDoseAmount: numeric('actual_dose_amount', { precision: 12, scale: 3, mode: 'string' }),
    actualDoseUnit: text('actual_dose_unit'),
    reasonCode: text('reason_code').$type<MedicationReason>(),
    administrationReason: text('administration_reason'),
    note: text('note'),
    correctionReason: text('correction_reason').notNull(),
    correctedByEmployeeId: uuid('corrected_by_employee_id').notNull(),
    correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('medication_administration_corrections_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('medication_administration_corrections_record_version_uq').on(table.tenantId, table.recordId, table.version),
    index('medication_administration_corrections_history_idx').on(table.tenantId, table.recordId, table.version),
    check('medication_administration_corrections_version_ck', sql`${table.version} > 0`),
    check('medication_administration_corrections_reason_ck', sql`length(trim(${table.correctionReason})) BETWEEN 1 AND 1000`),
    check('medication_administration_corrections_reason_text_ck', sql`${table.administrationReason} IS NULL OR length(${table.administrationReason}) <= 1000`),
    foreignKey({
      name: 'medication_administration_corrections_record_fk',
      columns: [table.tenantId, table.recordId],
      foreignColumns: [medicationAdministrationRecords.tenantId, medicationAdministrationRecords.id],
    }),
    foreignKey({
      name: 'medication_administration_corrections_employee_fk',
      columns: [table.tenantId, table.correctedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const medicationSchema = {
  medicationDefinitions,
  medicationOrders,
  medicationOrderRevisions,
  medicationAdministrationOccurrences,
  medicationAdministrationRecords,
  medicationAdministrationCorrections,
};
