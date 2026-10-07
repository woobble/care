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
import { clientContacts, clientRecords } from '@care/clients';
import { careDocuments } from '@care/care-documentation';
import { employeeRecords } from '@care/employees';

const serviceEvidenceDb = pgSchema('service_evidence');

export const evidencePackages = serviceEvidenceDb.table(
  'evidence_packages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    documentationId: uuid('documentation_id').notNull(),
    version: integer('version').notNull(),
    documentationVersion: integer('documentation_version').notNull(),
    executionVersion: integer('execution_version').notNull(),
    amendmentCount: integer('amendment_count').notNull(),
    snapshot: jsonb('snapshot')
      .$type<import('./domain/service-evidence').EvidenceSnapshot>()
      .notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
  },
  (table) => [
    uniqueIndex('evidence_packages_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('evidence_packages_tenant_document_version_uq').on(
      table.tenantId,
      table.documentationId,
      table.version,
    ),
    index('evidence_packages_tenant_document_generated_idx').on(
      table.tenantId,
      table.documentationId,
      table.generatedAt,
    ),
    check('evidence_packages_version_ck', sql`${table.version} > 0`),
    check(
      'evidence_packages_source_version_ck',
      sql`${table.documentationVersion} > 0 AND ${table.executionVersion} > 0 AND ${table.amendmentCount} >= 0`,
    ),
    check('evidence_packages_hash_ck', sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'evidence_packages_snapshot_ck',
      sql`jsonb_typeof(${table.snapshot}) = 'object' AND ${table.snapshot}->>'snapshotVersion' = '1' AND jsonb_typeof(${table.snapshot}->'items') = 'array'`,
    ),
    foreignKey({
      name: 'evidence_packages_document_fk',
      columns: [table.tenantId, table.documentationId],
      foreignColumns: [careDocuments.tenantId, careDocuments.id],
    }),
  ],
);

export const acknowledgements = serviceEvidenceDb.table(
  'acknowledgements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    evidencePackageId: uuid('evidence_package_id').notNull(),
    evidencePackageHash: text('evidence_package_hash').notNull(),
    clientId: uuid('client_id').notNull(),
    signatoryType: text('signatory_type')
      .$type<'client' | 'representative' | 'other_authorized_person'>()
      .notNull(),
    signatoryNameSnapshot: text('signatory_name_snapshot').notNull(),
    signatoryContactId: uuid('signatory_contact_id'),
    signatoryCapacity: text('signatory_capacity')
      .$type<'client' | 'legal_guardian' | 'authorized_representative' | 'relative' | 'other'>()
      .notNull(),
    signatoryRelationshipSnapshot: text('signatory_relationship_snapshot'),
    representationTypeSnapshot: text('representation_type_snapshot'),
    status: text('status').$type<'acknowledged' | 'declined'>().notNull(),
    method: text('method')
      .$type<'touch_signature' | 'typed_confirmation' | 'staff_recorded_decline'>()
      .notNull(),
    signatureStorageKey: text('signature_storage_key'),
    signatureSha256: text('signature_sha256'),
    statementVersion: text('statement_version').notNull(),
    statementTextSnapshot: text('statement_text_snapshot').notNull(),
    declineReasonCode: text('decline_reason_code'),
    declineNote: text('decline_note'),
    capturedByEmployeeId: uuid('captured_by_employee_id').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id'),
    revocationReason: text('revocation_reason'),
  },
  (table) => [
    uniqueIndex('acknowledgements_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('acknowledgements_tenant_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    uniqueIndex('acknowledgements_one_unrevoked_per_package_uq')
      .on(table.tenantId, table.evidencePackageId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('acknowledgements_tenant_client_created_idx').on(
      table.tenantId,
      table.clientId,
      table.createdAt,
    ),
    check(
      'acknowledgements_signatory_ck',
      sql`length(trim(${table.signatoryNameSnapshot})) BETWEEN 1 AND 200 AND ${table.signatoryCapacity} IN ('client', 'legal_guardian', 'authorized_representative', 'relative', 'other') AND ((${table.signatoryType} = 'client' AND ${table.signatoryContactId} IS NULL AND ${table.signatoryCapacity} = 'client' AND ${table.signatoryRelationshipSnapshot} IS NULL AND ${table.representationTypeSnapshot} IS NULL) OR (${table.signatoryType} <> 'client' AND ${table.signatoryContactId} IS NOT NULL AND ${table.signatoryCapacity} <> 'client' AND ${table.signatoryRelationshipSnapshot} IS NOT NULL AND ${table.representationTypeSnapshot} IS NOT NULL))`,
    ),
    check(
      'acknowledgements_outcome_ck',
      sql`((status = 'acknowledged' AND method IN ('touch_signature', 'typed_confirmation') AND ${table.acknowledgedAt} IS NOT NULL AND ${table.declinedAt} IS NULL AND ${table.declineReasonCode} IS NULL AND ${table.declineNote} IS NULL) OR (status = 'declined' AND method = 'staff_recorded_decline' AND ${table.acknowledgedAt} IS NULL AND ${table.declinedAt} IS NOT NULL AND ${table.declineReasonCode} IN ('declined_without_reason', 'disagrees_with_record', 'unable_to_sign', 'signatory_not_available', 'other') AND (${table.declineNote} IS NULL OR length(${table.declineNote}) <= 500)))`,
    ),
    check(
      'acknowledgements_signature_ck',
      sql`((method = 'touch_signature' AND ${table.status} = 'acknowledged' AND ${table.signatureStorageKey} IS NOT NULL AND ${table.signatureSha256} ~ '^[a-f0-9]{64}$') OR (method <> 'touch_signature' AND ${table.signatureStorageKey} IS NULL AND ${table.signatureSha256} IS NULL))`,
    ),
    check(
      'acknowledgements_revocation_ck',
      sql`(${table.revokedAt} IS NULL AND ${table.revokedByUserId} IS NULL AND ${table.revocationReason} IS NULL) OR (${table.status} = 'acknowledged' AND ${table.revokedAt} IS NOT NULL AND ${table.revokedByUserId} IS NOT NULL AND length(trim(${table.revocationReason})) BETWEEN 1 AND 500)`,
    ),
    check('acknowledgements_package_hash_ck', sql`${table.evidencePackageHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'acknowledgements_statement_ck',
      sql`length(trim(${table.statementVersion})) BETWEEN 1 AND 40 AND length(trim(${table.statementTextSnapshot})) BETWEEN 1 AND 500`,
    ),
    check(
      'acknowledgements_signature_key_ck',
      sql`${table.signatureStorageKey} IS NULL OR (${table.signatureStorageKey} LIKE 'service-evidence/signatures/%' AND length(${table.signatureStorageKey}) <= 300)`,
    ),
    foreignKey({
      name: 'acknowledgements_package_fk',
      columns: [table.tenantId, table.evidencePackageId],
      foreignColumns: [evidencePackages.tenantId, evidencePackages.id],
    }),
    foreignKey({
      name: 'acknowledgements_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'acknowledgements_signatory_contact_fk',
      columns: [table.tenantId, table.clientId, table.signatoryContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.clientId, clientContacts.id],
    }),
    foreignKey({
      name: 'acknowledgements_captured_by_employee_fk',
      columns: [table.tenantId, table.capturedByEmployeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
  ],
);

export const serviceEvidenceSchema = { evidencePackages, acknowledgements };
