import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { employeeRecords } from '@care/employees';
import { visits } from '@care/scheduling';
import { performedServices, visitExecutions } from '@care/visit-execution';

const careDocumentation = pgSchema('care_documentation');

export const careDocuments = careDocumentation.table(
  'documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    executionId: uuid('execution_id').notNull(),
    status: text('status').$type<'draft' | 'finalized'>().notNull(),
    createdByEmployeeId: uuid('created_by_employee_id').notNull(),
    finalizedByEmployeeId: uuid('finalized_by_employee_id'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('care_documents_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('care_documents_tenant_visit_uq').on(table.tenantId, table.visitId),
    uniqueIndex('care_documents_tenant_execution_uq').on(table.tenantId, table.executionId),
    uniqueIndex('care_documents_tenant_id_execution_uq').on(
      table.tenantId,
      table.id,
      table.executionId,
    ),
    index('care_documents_tenant_status_updated_idx').on(
      table.tenantId,
      table.status,
      table.updatedAt,
    ),
    check(
      'care_documents_finalized_ck',
      sql`(${table.status} = 'draft' AND ${table.finalizedAt} IS NULL AND ${table.finalizedByEmployeeId} IS NULL) OR (${table.status} = 'finalized' AND ${table.finalizedAt} IS NOT NULL AND ${table.finalizedByEmployeeId} IS NOT NULL)`,
    ),
    check('care_documents_version_ck', sql`${table.version} > 0`),
    foreignKey({
      name: 'care_documents_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'care_documents_execution_fk',
      columns: [table.tenantId, table.executionId, table.visitId],
      foreignColumns: [visitExecutions.tenantId, visitExecutions.id, visitExecutions.visitId],
    }),
    foreignKey({
      name: 'care_documents_created_by_employee_fk',
      columns: [table.tenantId, table.createdByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'care_documents_finalized_by_employee_fk',
      columns: [table.tenantId, table.finalizedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const documentationEntries = careDocumentation.table(
  'entries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    documentationId: uuid('documentation_id').notNull(),
    type: text('type').$type<'care_note' | 'observation' | 'deviation' | 'incident'>().notNull(),
    authorEmployeeId: uuid('author_employee_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    severity: text('severity').$type<'low' | 'moderate' | 'high' | 'critical'>(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('documentation_entries_tenant_id_uq').on(table.tenantId, table.id),
    index('documentation_entries_tenant_document_created_idx').on(
      table.tenantId,
      table.documentationId,
      table.createdAt,
    ),
    check(
      'documentation_entries_content_ck',
      sql`length(trim(${table.content})) BETWEEN 1 AND 4000`,
    ),
    check(
      'documentation_entries_incident_ck',
      sql`(${table.type} = 'incident' AND ${table.occurredAt} IS NOT NULL AND ${table.severity} IN ('low', 'moderate', 'high', 'critical')) OR (${table.type} <> 'incident' AND ${table.severity} IS NULL)`,
    ),
    foreignKey({
      name: 'documentation_entries_document_fk',
      columns: [table.tenantId, table.documentationId],
      foreignColumns: [careDocuments.tenantId, careDocuments.id],
    }),
    foreignKey({
      name: 'documentation_entries_author_employee_fk',
      columns: [table.tenantId, table.authorEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const serviceEvidence = careDocumentation.table(
  'service_evidence',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    documentationId: uuid('documentation_id').notNull(),
    executionId: uuid('execution_id').notNull(),
    performedServiceId: uuid('performed_service_id').notNull(),
    status: text('status').$type<'documented' | 'not_required'>().notNull(),
    documentedByEmployeeId: uuid('documented_by_employee_id').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_evidence_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('service_evidence_performed_service_uq').on(
      table.tenantId,
      table.documentationId,
      table.performedServiceId,
    ),
    index('service_evidence_execution_idx').on(
      table.tenantId,
      table.executionId,
      table.performedServiceId,
    ),
    check(
      'service_evidence_status_ck',
      sql`(${table.status} = 'documented') OR (${table.status} = 'not_required' AND length(trim(coalesce(${table.note}, ''))) > 0)`,
    ),
    check('service_evidence_note_ck', sql`${table.note} IS NULL OR length(${table.note}) <= 1000`),
    foreignKey({
      name: 'service_evidence_document_execution_fk',
      columns: [table.tenantId, table.documentationId, table.executionId],
      foreignColumns: [careDocuments.tenantId, careDocuments.id, careDocuments.executionId],
    }),
    foreignKey({
      name: 'service_evidence_performed_service_fk',
      columns: [table.tenantId, table.performedServiceId, table.executionId],
      foreignColumns: [
        performedServices.tenantId,
        performedServices.id,
        performedServices.executionId,
      ],
    }),
    foreignKey({
      name: 'service_evidence_author_employee_fk',
      columns: [table.tenantId, table.documentedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const documentationAmendments = careDocumentation.table(
  'amendments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    documentationId: uuid('documentation_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    reason: text('reason').notNull(),
    correction: text('correction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('documentation_amendments_tenant_id_uq').on(table.tenantId, table.id),
    index('documentation_amendments_document_created_idx').on(
      table.tenantId,
      table.documentationId,
      table.createdAt,
    ),
    check(
      'documentation_amendments_reason_ck',
      sql`length(trim(${table.reason})) BETWEEN 1 AND 500`,
    ),
    check(
      'documentation_amendments_correction_ck',
      sql`length(trim(${table.correction})) BETWEEN 1 AND 4000`,
    ),
    foreignKey({
      name: 'documentation_amendments_document_fk',
      columns: [table.tenantId, table.documentationId],
      foreignColumns: [careDocuments.tenantId, careDocuments.id],
    }),
  ],
);

export const documentationHistory = careDocumentation.table(
  'history',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    documentationId: uuid('documentation_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    actorEmployeeId: uuid('actor_employee_id'),
    action: text('action').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('documentation_history_tenant_id_uq').on(table.tenantId, table.id),
    index('documentation_history_document_occurred_idx').on(
      table.tenantId,
      table.documentationId,
      table.occurredAt,
    ),
    foreignKey({
      name: 'documentation_history_document_fk',
      columns: [table.tenantId, table.documentationId],
      foreignColumns: [careDocuments.tenantId, careDocuments.id],
    }),
    foreignKey({
      name: 'documentation_history_actor_employee_fk',
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const careDocumentationSchema = {
  careDocuments,
  documentationEntries,
  serviceEvidence,
  documentationAmendments,
  documentationHistory,
};
