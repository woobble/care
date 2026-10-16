import { sql } from 'drizzle-orm';
import {
  check,
  date,
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

import { clientRecords } from '@care/clients';
import { documentArtifacts } from '@care/documents';
import { facilities, organizationsTable } from '@care/organizations';
import {
  invoiceDocuments,
  invoiceLines,
  invoices,
  payerArrangements,
} from '@module/billing/schema';

import { payerBillingProfiles, payers } from './payer-schema';

const billing = pgSchema('billing');

export type ClaimStatus =
  | 'draft'
  | 'ready'
  | 'submitted'
  | 'accepted'
  | 'partially_accepted'
  | 'rejected'
  | 'clarification_required'
  | 'resubmitted'
  | 'cancelled';

export const claims = billing.table(
  'claims',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    clientId: uuid('client_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    payerId: uuid('payer_id').notNull(),
    payerArrangementId: uuid('payer_arrangement_id').notNull(),
    payerBillingProfileId: uuid('payer_billing_profile_id'),
    arrangementType: text('arrangement_type')
      .$type<'direct_payer_billing' | 'reimbursement_to_client'>()
      .notNull(),
    channel: text('channel').$type<
      'manual_portal' | 'manual_email' | 'postal' | 'customer_reimbursement'
    >(),
    fundingSourceType: text('funding_source_type')
      .$type<
        | 'statutory_long_term_care_insurance'
        | 'private_long_term_care_insurance'
        | 'self_pay'
        | 'other'
      >()
      .notNull(),
    status: text('status').$type<ClaimStatus>().notNull(),
    currency: text('currency').$type<'EUR'>().notNull(),
    amountCents: integer('amount_cents').notNull(),
    invoiceVersion: integer('invoice_version').notNull(),
    invoiceSnapshot: jsonb('invoice_snapshot').$type<Record<string, unknown>>().notNull(),
    payerSnapshot: jsonb('payer_snapshot').$type<Record<string, unknown>>().notNull(),
    arrangementSnapshot: jsonb('arrangement_snapshot').$type<Record<string, unknown>>().notNull(),
    profileSnapshot: jsonb('profile_snapshot').$type<Record<string, unknown>>().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    packageVersion: integer('package_version').notNull().default(0),
    packageHash: text('package_hash'),
    supersedesClaimId: uuid('supersedes_claim_id'),
    resubmissionOfSubmissionId: uuid('resubmission_of_submission_id'),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('claims_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('claims_tenant_invoice_id_uq').on(table.tenantId, table.id, table.invoiceId),
    uniqueIndex('claims_resubmission_source_uq')
      .on(table.tenantId, table.supersedesClaimId)
      .where(sql`${table.supersedesClaimId} IS NOT NULL`),
    index('claims_worklist_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index('claims_client_idx').on(table.tenantId, table.clientId, table.createdAt, table.id),
    index('claims_invoice_idx').on(table.tenantId, table.invoiceId, table.createdAt),
    check(
      'claims_status_ck',
      sql`${table.status} IN ('draft', 'ready', 'submitted', 'accepted', 'partially_accepted', 'rejected', 'clarification_required', 'resubmitted', 'cancelled')`,
    ),
    check('claims_amount_ck', sql`${table.amountCents} > 0`),
    check('claims_version_ck', sql`${table.version} > 0 AND ${table.invoiceVersion} > 0`),
    check('claims_snapshot_hash_ck', sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
    check('claims_package_version_ck', sql`${table.packageVersion} >= 0`),
    check(
      'claims_package_state_ck',
      sql`(${table.status} = 'draft' AND ${table.packageVersion} = 0 AND ${table.packageHash} IS NULL AND ${table.preparedAt} IS NULL) OR (${table.status} = 'cancelled' AND ((${table.packageVersion} = 0 AND ${table.packageHash} IS NULL AND ${table.preparedAt} IS NULL) OR (${table.packageVersion} > 0 AND ${table.packageHash} ~ '^[a-f0-9]{64}$' AND ${table.preparedAt} IS NOT NULL))) OR (${table.status} NOT IN ('draft', 'cancelled') AND ${table.packageVersion} > 0 AND ${table.packageHash} ~ '^[a-f0-9]{64}$' AND ${table.preparedAt} IS NOT NULL)`,
    ),
    check(
      'claims_channel_ck',
      sql`(${table.payerBillingProfileId} IS NULL AND (${table.channel} IS NULL OR (${table.arrangementType} = 'reimbursement_to_client' AND ${table.channel} = 'customer_reimbursement'))) OR (${table.payerBillingProfileId} IS NOT NULL AND ((${table.arrangementType} = 'direct_payer_billing' AND ${table.channel} IN ('manual_portal', 'manual_email', 'postal')) OR (${table.arrangementType} = 'reimbursement_to_client' AND ${table.channel} = 'customer_reimbursement')))`,
    ),
    foreignKey({
      name: 'claims_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'claims_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'claims_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'claims_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'claims_invoice_scope_fk',
      columns: [
        table.tenantId,
        table.invoiceId,
        table.organizationId,
        table.facilityId,
        table.clientId,
      ],
      foreignColumns: [
        invoices.tenantId,
        invoices.id,
        invoices.organizationId,
        invoices.facilityId,
        invoices.clientId,
      ],
    }),
    foreignKey({
      name: 'claims_payer_fk',
      columns: [table.tenantId, table.organizationId, table.payerId],
      foreignColumns: [payers.tenantId, payers.organizationId, payers.id],
    }),
    foreignKey({
      name: 'claims_arrangement_fk',
      columns: [
        table.tenantId,
        table.organizationId,
        table.clientId,
        table.payerId,
        table.payerArrangementId,
      ],
      foreignColumns: [
        payerArrangements.tenantId,
        payerArrangements.organizationId,
        payerArrangements.clientId,
        payerArrangements.payerId,
        payerArrangements.id,
      ],
    }),
    foreignKey({
      name: 'claims_billing_profile_fk',
      columns: [table.tenantId, table.payerBillingProfileId],
      foreignColumns: [payerBillingProfiles.tenantId, payerBillingProfiles.id],
    }),
    foreignKey({
      name: 'claims_supersedes_fk',
      columns: [table.tenantId, table.supersedesClaimId],
      foreignColumns: [table.tenantId, table.id],
    }),
  ],
);

export const claimLines = billing.table(
  'claim_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    claimId: uuid('claim_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceLineId: uuid('invoice_line_id').notNull(),
    fundingAllocationId: uuid('funding_allocation_id'),
    evidencePackageId: uuid('evidence_package_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    lineSnapshot: jsonb('line_snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('claim_lines_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('claim_lines_claim_source_uq').on(
      table.tenantId,
      table.claimId,
      table.invoiceLineId,
    ),
    index('claim_lines_source_idx').on(table.tenantId, table.invoiceLineId, table.claimId),
    check('claim_lines_amount_ck', sql`${table.amountCents} > 0`),
    foreignKey({
      name: 'claim_lines_claim_invoice_fk',
      columns: [table.tenantId, table.claimId, table.invoiceId],
      foreignColumns: [claims.tenantId, claims.id, claims.invoiceId],
    }),
    foreignKey({
      name: 'claim_lines_invoice_source_fk',
      columns: [table.tenantId, table.invoiceId, table.invoiceLineId],
      foreignColumns: [invoiceLines.tenantId, invoiceLines.invoiceId, invoiceLines.id],
    }),
  ],
);

export const claimSubmissions = billing.table(
  'claim_submissions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    claimId: uuid('claim_id').notNull(),
    submissionNumber: integer('submission_number').notNull(),
    channel: text('channel')
      .$type<'manual_portal' | 'manual_email' | 'postal' | 'customer_reimbursement'>()
      .notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: uuid('submitted_by').notNull(),
    recipientSnapshot: jsonb('recipient_snapshot').$type<Record<string, unknown>>().notNull(),
    externalReference: text('external_reference'),
    protectedNote: text('protected_note'),
    packageVersion: integer('package_version').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    packageHash: text('package_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('claim_submissions_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('claim_submissions_tenant_claim_id_uq').on(table.tenantId, table.claimId, table.id),
    uniqueIndex('claim_submissions_claim_number_uq').on(
      table.tenantId,
      table.claimId,
      table.submissionNumber,
    ),
    index('claim_submissions_history_idx').on(table.tenantId, table.claimId, table.submittedAt),
    check('claim_submissions_number_ck', sql`${table.submissionNumber} > 0`),
    check('claim_submissions_package_version_ck', sql`${table.packageVersion} > 0`),
    check('claim_submissions_package_hash_ck', sql`${table.packageHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'claim_submissions_lengths_ck',
      sql`length(coalesce(${table.externalReference}, '')) <= 160 AND length(coalesce(${table.protectedNote}, '')) <= 2000`,
    ),
    foreignKey({
      name: 'claim_submissions_claim_fk',
      columns: [table.tenantId, table.claimId, table.invoiceId],
      foreignColumns: [claims.tenantId, claims.id, claims.invoiceId],
    }),
  ],
);

export const claimDecisions = billing.table(
  'claim_decisions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    claimId: uuid('claim_id').notNull(),
    submissionId: uuid('submission_id').notNull(),
    decision: text('decision')
      .$type<'accepted' | 'partially_accepted' | 'rejected' | 'clarification_required'>()
      .notNull(),
    decisionDate: date('decision_date', { mode: 'string' }).notNull(),
    externalReference: text('external_reference'),
    acceptedCents: integer('accepted_cents').notNull(),
    rejectedCents: integer('rejected_cents').notNull(),
    reasonCode: text('reason_code'),
    protectedExplanation: text('protected_explanation'),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('claim_decisions_tenant_id_uq').on(table.tenantId, table.id),
    index('claim_decisions_history_idx').on(table.tenantId, table.claimId, table.createdAt),
    check(
      'claim_decisions_kind_ck',
      sql`${table.decision} IN ('accepted', 'partially_accepted', 'rejected', 'clarification_required')`,
    ),
    check(
      'claim_decisions_amounts_ck',
      sql`${table.acceptedCents} >= 0 AND ${table.rejectedCents} >= 0 AND ((${table.decision} = 'accepted' AND ${table.acceptedCents} > 0 AND ${table.rejectedCents} = 0) OR (${table.decision} = 'partially_accepted' AND ${table.acceptedCents} > 0 AND ${table.rejectedCents} > 0) OR (${table.decision} = 'rejected' AND ${table.acceptedCents} = 0 AND ${table.rejectedCents} > 0) OR (${table.decision} = 'clarification_required' AND ${table.acceptedCents} = 0 AND ${table.rejectedCents} = 0))`,
    ),
    check(
      'claim_decisions_lengths_ck',
      sql`length(coalesce(${table.externalReference}, '')) <= 160 AND length(coalesce(${table.reasonCode}, '')) <= 80 AND length(coalesce(${table.protectedExplanation}, '')) <= 4000`,
    ),
    foreignKey({
      name: 'claim_decisions_claim_fk',
      columns: [table.tenantId, table.claimId],
      foreignColumns: [claims.tenantId, claims.id],
    }),
    foreignKey({
      name: 'claim_decisions_submission_fk',
      columns: [table.tenantId, table.submissionId],
      foreignColumns: [claimSubmissions.tenantId, claimSubmissions.id],
    }),
  ],
);

export const claimDecisionLines = billing.table(
  'claim_decision_lines',
  {
    tenantId: uuid('tenant_id').notNull(),
    decisionId: uuid('decision_id').notNull(),
    claimLineId: uuid('claim_line_id').notNull(),
    acceptedCents: integer('accepted_cents').notNull(),
    rejectedCents: integer('rejected_cents').notNull(),
  },
  (table) => [
    uniqueIndex('claim_decision_lines_source_uq').on(
      table.tenantId,
      table.decisionId,
      table.claimLineId,
    ),
    check(
      'claim_decision_lines_amounts_ck',
      sql`${table.acceptedCents} >= 0 AND ${table.rejectedCents} >= 0 AND ${table.acceptedCents} + ${table.rejectedCents} > 0`,
    ),
    foreignKey({
      name: 'claim_decision_lines_decision_fk',
      columns: [table.tenantId, table.decisionId],
      foreignColumns: [claimDecisions.tenantId, claimDecisions.id],
    }),
    foreignKey({
      name: 'claim_decision_lines_claim_line_fk',
      columns: [table.tenantId, table.claimLineId],
      foreignColumns: [claimLines.tenantId, claimLines.id],
    }),
  ],
);

export const claimPackageDocuments = billing.table(
  'claim_package_documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    claimId: uuid('claim_id').notNull(),
    packageVersion: integer('package_version').notNull(),
    documentKind: text('document_kind')
      .$type<'invoice_pdf' | 'evidence_pdf' | 'mandate_pdf' | 'claim_summary'>()
      .notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceDocumentId: uuid('invoice_document_id'),
    documentArtifactId: uuid('document_artifact_id'),
    fileName: text('file_name').notNull(),
    sha256: text('sha256').notNull(),
    sourceVersion: text('source_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('claim_package_documents_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('claim_package_documents_claim_source_uq').on(
      table.tenantId,
      table.claimId,
      table.packageVersion,
      table.documentKind,
      table.fileName,
    ),
    index('claim_package_documents_claim_idx').on(
      table.tenantId,
      table.claimId,
      table.packageVersion,
    ),
    check('claim_package_documents_version_ck', sql`${table.packageVersion} > 0`),
    check(
      'claim_package_documents_source_ck',
      sql`(${table.documentKind} = 'invoice_pdf' AND ${table.invoiceDocumentId} IS NOT NULL AND ${table.documentArtifactId} IS NULL) OR (${table.documentKind} <> 'invoice_pdf' AND ${table.invoiceDocumentId} IS NULL AND ${table.documentArtifactId} IS NOT NULL)`,
    ),
    check('claim_package_documents_hash_ck', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'claim_package_documents_lengths_ck',
      sql`length(trim(${table.fileName})) BETWEEN 1 AND 180 AND length(trim(${table.sourceVersion})) BETWEEN 1 AND 200`,
    ),
    foreignKey({
      name: 'claim_package_documents_claim_fk',
      columns: [table.tenantId, table.claimId, table.invoiceId],
      foreignColumns: [claims.tenantId, claims.id, claims.invoiceId],
    }),
    foreignKey({
      name: 'claim_package_documents_invoice_document_fk',
      columns: [table.tenantId, table.invoiceId, table.invoiceDocumentId],
      foreignColumns: [invoiceDocuments.tenantId, invoiceDocuments.invoiceId, invoiceDocuments.id],
    }),
    foreignKey({
      name: 'claim_package_documents_artifact_fk',
      columns: [table.tenantId, table.documentArtifactId],
      foreignColumns: [documentArtifacts.tenantId, documentArtifacts.id],
    }),
  ],
);

export const billingClaimsSchema = {
  claims,
  claimLines,
  claimSubmissions,
  claimDecisions,
  claimDecisionLines,
  claimPackageDocuments,
};
