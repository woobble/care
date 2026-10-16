import { sql } from 'drizzle-orm';
import {
  check,
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

import { employeeRecords } from '@care/employees';
import { visits, visitServices } from '@care/scheduling';
import { agreementServices } from '@care/service-agreements';
import { serviceDefinitions } from '@care/services';

const visitExecution = pgSchema('visit_execution');

export const visitExecutions = visitExecution.table(
  'executions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    status: text('status').$type<'in_progress' | 'completed'>().notNull(),
    actualStart: timestamp('actual_start', { withTimezone: true }).notNull(),
    actualEnd: timestamp('actual_end', { withTimezone: true }),
    startedByEmployeeId: uuid('started_by_employee_id').notNull(),
    completedByEmployeeId: uuid('completed_by_employee_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('visit_executions_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('visit_executions_tenant_visit_uq').on(table.tenantId, table.visitId),
    uniqueIndex('visit_executions_tenant_id_visit_uq').on(table.tenantId, table.id, table.visitId),
    index('visit_executions_tenant_status_idx').on(table.tenantId, table.status, table.updatedAt),
    check(
      'visit_executions_lifecycle_ck',
      sql.raw(
        "(status = 'in_progress' AND actual_end IS NULL AND completed_by_employee_id IS NULL) OR (status = 'completed' AND actual_end IS NOT NULL AND completed_by_employee_id IS NOT NULL)",
      ),
    ),
    check('visit_executions_time_ck', sql.raw('actual_end IS NULL OR actual_end > actual_start')),
    check('visit_executions_version_ck', sql.raw('version > 0')),
    foreignKey({
      name: 'visit_executions_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'visit_executions_started_by_employee_fk',
      columns: [table.tenantId, table.startedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'visit_executions_completed_by_employee_fk',
      columns: [table.tenantId, table.completedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const performedServices = visitExecution.table(
  'performed_services',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    executionId: uuid('execution_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    visitServiceId: uuid('visit_service_id'),
    serviceDefinitionId: uuid('service_definition_id').notNull(),
    serviceAgreementId: uuid('service_agreement_id'),
    agreementServiceId: uuid('agreement_service_id'),
    serviceCodeSnapshot: text('service_code_snapshot').notNull(),
    serviceNameSnapshot: text('service_name_snapshot').notNull(),
    unitSnapshot: text('unit_snapshot').$type<'occurrence' | 'minute' | 'hour' | 'day'>().notNull(),
    plannedQuantity: numeric('planned_quantity', {
      precision: 12,
      scale: 3,
      mode: 'string',
    }),
    actualQuantity: numeric('actual_quantity', {
      precision: 12,
      scale: 3,
      mode: 'string',
    }),
    status: text('status').$type<'performed' | 'partially_performed' | 'not_performed'>().notNull(),
    reasonCode: text('reason_code').$type<
      | 'client_declined'
      | 'client_not_present'
      | 'service_not_required'
      | 'time_constraint'
      | 'provider_decision'
      | 'other'
    >(),
    performedByEmployeeId: uuid('performed_by_employee_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('performed_services_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('performed_services_tenant_id_execution_uq').on(
      table.tenantId,
      table.id,
      table.executionId,
    ),
    uniqueIndex('performed_services_planned_service_uq')
      .on(table.tenantId, table.executionId, table.visitServiceId)
      .where(sql.raw('visit_service_id IS NOT NULL')),
    index('performed_services_execution_idx').on(
      table.tenantId,
      table.executionId,
      table.createdAt,
    ),
    check(
      'performed_services_snapshot_ck',
      sql.raw(
        "length(trim(service_code_snapshot)) BETWEEN 1 AND 64 AND length(trim(service_name_snapshot)) BETWEEN 1 AND 160 AND unit_snapshot IN ('occurrence', 'minute', 'hour', 'day')",
      ),
    ),
    check(
      'performed_services_quantity_ck',
      sql.raw(
        "((planned_quantity IS NULL AND visit_service_id IS NULL AND service_agreement_id IS NULL AND agreement_service_id IS NULL) OR (planned_quantity > 0 AND visit_service_id IS NOT NULL)) AND (actual_quantity IS NULL OR actual_quantity >= 0) AND ((status = 'performed' AND actual_quantity > 0) OR (status = 'partially_performed' AND planned_quantity IS NOT NULL AND actual_quantity > 0 AND actual_quantity < planned_quantity) OR (status = 'not_performed' AND (actual_quantity IS NULL OR actual_quantity = 0) AND reason_code IS NOT NULL))",
      ),
    ),
    check(
      'performed_services_agreement_reference_ck',
      sql.raw(
        '((service_agreement_id IS NULL AND agreement_service_id IS NULL) OR (service_agreement_id IS NOT NULL AND agreement_service_id IS NOT NULL))',
      ),
    ),
    check(
      'performed_services_reason_ck',
      sql.raw(
        "reason_code IS NULL OR reason_code IN ('client_declined', 'client_not_present', 'service_not_required', 'time_constraint', 'provider_decision', 'other')",
      ),
    ),
    foreignKey({
      name: 'performed_services_execution_fk',
      columns: [table.tenantId, table.executionId, table.visitId],
      foreignColumns: [visitExecutions.tenantId, visitExecutions.id, visitExecutions.visitId],
    }),
    foreignKey({
      name: 'performed_services_visit_service_fk',
      columns: [table.tenantId, table.visitId, table.visitServiceId, table.serviceDefinitionId],
      foreignColumns: [
        visitServices.tenantId,
        visitServices.visitId,
        visitServices.id,
        visitServices.serviceDefinitionId,
      ],
    }),
    foreignKey({
      name: 'performed_services_service_fk',
      columns: [table.tenantId, table.serviceDefinitionId],
      foreignColumns: [serviceDefinitions.tenantId, serviceDefinitions.id],
    }),
    foreignKey({
      name: 'performed_services_agreement_service_fk',
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
    foreignKey({
      name: 'performed_services_employee_fk',
      columns: [table.tenantId, table.performedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const visitExecutionSchema = { visitExecutions, performedServices };
