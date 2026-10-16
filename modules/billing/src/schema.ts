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
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { benefitFundingSources, serviceAllocations } from '@care/benefits';
import { clientInsurances, clientRecords } from '@care/clients';
import { organizationsTable, facilities } from '@care/organizations';
import { evidencePackages } from '@care/service-evidence';
import { servicePrices } from '@care/services';
import { performedServices } from '@care/visit-execution';

const billing = pgSchema('billing');

export const billingProfiles = billing.table(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    taxNumber: text('tax_number'),
    vatId: text('vat_id'),
    creditorIdentifier: text('creditor_identifier'),
    bankAccountHolder: text('bank_account_holder'),
    iban: text('iban'),
    bic: text('bic'),
    paymentTermsDays: integer('payment_terms_days').notNull(),
    invoiceNumberPrefix: text('invoice_number_prefix').notNull(),
    defaultCurrency: text('default_currency').$type<'EUR'>().notNull(),
    taxTreatment: text('tax_treatment')
      .$type<'taxable' | 'tax_exempt' | 'small_business'>()
      .notNull(),
    taxRateBasisPoints: integer('tax_rate_basis_points'),
    taxExemptionBasis: text('tax_exemption_basis'),
    requireAcknowledgement: boolean('require_acknowledgement').notNull(),
    requiredInvoiceFormat: text('required_invoice_format').$type<'pdf' | 'structured'>().notNull(),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('billing_profiles_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('billing_profiles_tenant_organization_uq').on(table.tenantId, table.organizationId),
    check('billing_profiles_terms_ck', sql`${table.paymentTermsDays} BETWEEN 0 AND 180`),
    check('billing_profiles_version_ck', sql`${table.version} > 0`),
    check(
      'billing_profiles_prefix_ck',
      sql`length(${table.invoiceNumberPrefix}) <= 24 AND ${table.invoiceNumberPrefix} !~ '[^A-Za-z0-9/-]'`,
    ),
    check(
      'billing_profiles_tax_ck',
      sql`(${table.taxTreatment} = 'taxable' AND ${table.taxRateBasisPoints} BETWEEN 1 AND 10000 AND ${table.taxExemptionBasis} IS NULL) OR (${table.taxTreatment} = 'tax_exempt' AND ${table.taxRateBasisPoints} IS NULL AND length(trim(coalesce(${table.taxExemptionBasis}, ''))) BETWEEN 1 AND 300) OR (${table.taxTreatment} = 'small_business' AND ${table.taxRateBasisPoints} IS NULL AND length(trim(coalesce(${table.taxExemptionBasis}, ''))) BETWEEN 1 AND 300)`,
    ),
    foreignKey({
      name: 'billing_profiles_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const payerArrangements = billing.table(
  'payer_arrangements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    clientId: uuid('client_id').notNull(),
    payerId: uuid('payer_id'),
    fundingSourceId: uuid('funding_source_id'),
    clientInsuranceId: uuid('client_insurance_id'),
    mandateDocumentArtifactId: uuid('mandate_document_artifact_id'),
    payerType: text('payer_type')
      .$type<'statutory_insurance' | 'private_insurance' | 'self_pay' | 'other'>()
      .notNull(),
    payerReference: text('payer_reference'),
    arrangementType: text('arrangement_type')
      .$type<'direct_payer_billing' | 'reimbursement_to_client' | 'other'>()
      .notNull(),
    recipientType: text('recipient_type')
      .$type<'client' | 'insurance' | 'contact' | 'other'>()
      .notNull(),
    recipientName: text('recipient_name'),
    recipientAddress: text('recipient_address'),
    mandateStatus: text('mandate_status')
      .$type<'authorized' | 'pending' | 'revoked' | 'not_applicable'>()
      .notNull(),
    documentedSource: text('documented_source'),
    documentedReference: text('documented_reference'),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payer_arrangements_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('payer_arrangements_claim_scope_uq').on(
      table.tenantId,
      table.organizationId,
      table.clientId,
      table.payerId,
      table.id,
    ),
    index('payer_arrangements_client_validity_idx').on(
      table.tenantId,
      table.organizationId,
      table.clientId,
      table.validFrom,
      table.validUntil,
    ),
    index('payer_arrangements_funding_source_idx').on(
      table.tenantId,
      table.clientId,
      table.fundingSourceId,
      table.validFrom,
      table.validUntil,
    ),
    check(
      'payer_arrangements_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    check('payer_arrangements_version_ck', sql`${table.version} > 0`),
    check(
      'payer_arrangements_mandate_ck',
      sql`${table.arrangementType} <> 'direct_payer_billing' OR ${table.mandateStatus} <> 'authorized' OR (length(trim(coalesce(${table.documentedSource}, ''))) > 0 AND length(trim(coalesce(${table.documentedReference}, ''))) > 0 AND ${table.recipientType} <> 'client')`,
    ),
    check(
      'payer_arrangements_recipient_ck',
      sql`(${table.recipientType} = 'client' AND ${table.recipientName} IS NULL AND ${table.recipientAddress} IS NULL) OR (${table.recipientType} <> 'client' AND length(trim(coalesce(${table.recipientName}, ''))) BETWEEN 1 AND 200 AND length(trim(coalesce(${table.recipientAddress}, ''))) BETWEEN 1 AND 1000)`,
    ),
    foreignKey({
      name: 'payer_arrangements_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'payer_arrangements_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'payer_arrangements_funding_source_fk',
      columns: [table.tenantId, table.clientId, table.fundingSourceId],
      foreignColumns: [
        benefitFundingSources.tenantId,
        benefitFundingSources.clientId,
        benefitFundingSources.id,
      ],
    }),
    foreignKey({
      name: 'payer_arrangements_insurance_fk',
      columns: [table.tenantId, table.clientId, table.clientInsuranceId],
      foreignColumns: [clientInsurances.tenantId, clientInsurances.clientId, clientInsurances.id],
    }),
  ],
);

export const invoices = billing.table(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    clientId: uuid('client_id').notNull(),
    payerArrangementId: uuid('payer_arrangement_id'),
    recipientType: text('recipient_type').$type<'client' | 'payer'>().notNull(),
    recipientSnapshot: jsonb('recipient_snapshot').$type<Record<string, unknown>>(),
    issuerSnapshot: jsonb('issuer_snapshot').$type<Record<string, unknown>>(),
    invoiceNumber: text('invoice_number'),
    issueDate: date('issue_date', { mode: 'string' }),
    servicePeriodFrom: date('service_period_from', { mode: 'string' }),
    servicePeriodUntil: date('service_period_until', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    currency: text('currency').$type<'EUR'>().notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    taxTotalCents: integer('tax_total_cents').notNull(),
    grandTotalCents: integer('grand_total_cents').notNull(),
    status: text('status').$type<'draft' | 'issued' | 'cancelled'>().notNull(),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    issuedBy: uuid('issued_by'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoices_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('invoices_claim_scope_uq').on(
      table.tenantId,
      table.id,
      table.organizationId,
      table.facilityId,
      table.clientId,
    ),
    uniqueIndex('invoices_provider_number_uq')
      .on(table.tenantId, table.organizationId, table.invoiceNumber)
      .where(sql`${table.invoiceNumber} IS NOT NULL`),
    index('invoices_status_created_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index('invoices_client_service_period_idx').on(
      table.tenantId,
      table.clientId,
      table.servicePeriodFrom,
    ),
    index('invoices_due_date_idx').on(table.tenantId, table.organizationId, table.dueDate),
    check(
      'invoices_amounts_ck',
      sql`${table.subtotalCents} >= 0 AND ${table.taxTotalCents} >= 0 AND ${table.grandTotalCents} >= 0 AND ${table.grandTotalCents} = ${table.subtotalCents} + ${table.taxTotalCents}`,
    ),
    check('invoices_version_ck', sql`${table.version} > 0`),
    check(
      'invoices_lifecycle_ck',
      sql`(${table.status} = 'draft' AND ${table.invoiceNumber} IS NULL AND ${table.issuedAt} IS NULL AND ${table.issuedBy} IS NULL) OR (${table.status} = 'issued' AND ${table.invoiceNumber} IS NOT NULL AND ${table.issueDate} IS NOT NULL AND ${table.dueDate} IS NOT NULL AND ${table.issuerSnapshot} IS NOT NULL AND ${table.recipientSnapshot} IS NOT NULL AND ${table.issuedAt} IS NOT NULL AND ${table.issuedBy} IS NOT NULL) OR (${table.status} = 'cancelled' AND ${table.invoiceNumber} IS NULL AND ${table.issuedAt} IS NULL AND ${table.issuedBy} IS NULL)`,
    ),
    check(
      'invoices_recipient_ck',
      sql`(${table.recipientType} = 'client' AND ${table.payerArrangementId} IS NULL) OR (${table.recipientType} = 'payer' AND ${table.payerArrangementId} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'invoices_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'invoices_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'invoices_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'invoices_payer_arrangement_fk',
      columns: [table.tenantId, table.payerArrangementId],
      foreignColumns: [payerArrangements.tenantId, payerArrangements.id],
    }),
  ],
);

export const invoiceLines = billing.table(
  'invoice_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    performedServiceId: uuid('performed_service_id').notNull(),
    fundingAllocationId: uuid('funding_allocation_id'),
    servicePriceId: uuid('service_price_id'),
    evidencePackageId: uuid('evidence_package_id').notNull(),
    evidenceSnapshotHash: text('evidence_snapshot_hash').notNull(),
    sourceKey: text('source_key').notNull(),
    serviceCodeSnapshot: text('service_code_snapshot').notNull(),
    serviceNameSnapshot: text('service_name_snapshot').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'string' }).notNull(),
    unit: text('unit').$type<'occurrence' | 'minute' | 'hour' | 'day'>().notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    serviceAmountCents: integer('service_amount_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    taxTreatment: text('tax_treatment')
      .$type<'taxable' | 'tax_exempt' | 'small_business'>()
      .notNull(),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
    netCents: integer('net_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    grossCents: integer('gross_cents').notNull(),
    taxExemptionBasis: text('tax_exemption_basis'),
    fundingLabelSnapshot: text('funding_label_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoice_lines_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('invoice_lines_tenant_invoice_id_uq').on(table.tenantId, table.invoiceId, table.id),
    uniqueIndex('invoice_lines_invoice_source_uq').on(
      table.tenantId,
      table.invoiceId,
      table.sourceKey,
    ),
    index('invoice_lines_service_idx').on(
      table.tenantId,
      table.performedServiceId,
      table.invoiceId,
    ),
    index('invoice_lines_allocation_idx').on(table.tenantId, table.fundingAllocationId),
    check(
      'invoice_lines_amount_ck',
      sql`${table.unitPriceCents} > 0 AND ${table.serviceAmountCents} > 0 AND ${table.amountCents} > 0 AND ${table.amountCents} <= ${table.serviceAmountCents} AND ${table.netCents} >= 0 AND ${table.taxCents} >= 0 AND ${table.grossCents} = ${table.netCents} + ${table.taxCents} AND ${table.grossCents} = ${table.amountCents}`,
    ),
    check('invoice_lines_tax_rate_ck', sql`${table.taxRateBasisPoints} BETWEEN 0 AND 10000`),
    check('invoice_lines_evidence_hash_ck', sql`${table.evidenceSnapshotHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'invoice_lines_source_ck',
      sql`(${table.fundingAllocationId} IS NULL AND ${table.sourceKey} = 'self-pay') OR (${table.fundingAllocationId} IS NOT NULL AND ${table.sourceKey} = 'allocation:' || ${table.fundingAllocationId}::text)`,
    ),
    foreignKey({
      name: 'invoice_lines_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'invoice_lines_performed_service_fk',
      columns: [table.tenantId, table.performedServiceId],
      foreignColumns: [performedServices.tenantId, performedServices.id],
    }),
    foreignKey({
      name: 'invoice_lines_allocation_fk',
      columns: [table.tenantId, table.fundingAllocationId],
      foreignColumns: [serviceAllocations.tenantId, serviceAllocations.id],
    }),
    foreignKey({
      name: 'invoice_lines_price_fk',
      columns: [table.tenantId, table.servicePriceId],
      foreignColumns: [servicePrices.tenantId, servicePrices.id],
    }),
    foreignKey({
      name: 'invoice_lines_evidence_package_fk',
      columns: [table.tenantId, table.evidencePackageId],
      foreignColumns: [evidencePackages.tenantId, evidencePackages.id],
    }),
  ],
);

export const invoiceNumberSequences = billing.table(
  'invoice_number_sequences',
  {
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    calendarYear: integer('calendar_year').notNull(),
    nextSequence: integer('next_sequence').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoice_number_sequences_provider_year_uq').on(
      table.tenantId,
      table.organizationId,
      table.calendarYear,
    ),
    check('invoice_number_sequences_year_ck', sql`${table.calendarYear} BETWEEN 2000 AND 9999`),
    check('invoice_number_sequences_next_ck', sql`${table.nextSequence} > 0`),
    foreignKey({
      name: 'invoice_number_sequences_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const invoiceNumbers = billing.table(
  'invoice_numbers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    calendarYear: integer('calendar_year').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoice_numbers_invoice_uq').on(table.tenantId, table.invoiceId),
    uniqueIndex('invoice_numbers_provider_number_uq').on(
      table.tenantId,
      table.organizationId,
      table.invoiceNumber,
    ),
    uniqueIndex('invoice_numbers_provider_sequence_uq').on(
      table.tenantId,
      table.organizationId,
      table.calendarYear,
      table.sequenceNumber,
    ),
    foreignKey({
      name: 'invoice_numbers_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
  ],
);

export const invoiceCorrections = billing.table(
  'invoice_corrections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    correctionNumber: text('correction_number').notNull(),
    amountCents: integer('amount_cents').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoice_corrections_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('invoice_corrections_number_uq').on(
      table.tenantId,
      table.organizationId,
      table.correctionNumber,
    ),
    index('invoice_corrections_invoice_idx').on(table.tenantId, table.invoiceId, table.createdAt),
    check('invoice_corrections_amount_ck', sql`${table.amountCents} > 0`),
    check('invoice_corrections_reason_ck', sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`),
    foreignKey({
      name: 'invoice_corrections_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'invoice_corrections_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const invoiceCorrectionLines = billing.table(
  'invoice_correction_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    correctionId: uuid('correction_id').notNull(),
    invoiceLineId: uuid('invoice_line_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoice_correction_lines_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('invoice_correction_lines_source_uq').on(
      table.tenantId,
      table.correctionId,
      table.invoiceLineId,
    ),
    check('invoice_correction_lines_amount_ck', sql`${table.amountCents} > 0`),
    foreignKey({
      name: 'invoice_correction_lines_correction_fk',
      columns: [table.tenantId, table.correctionId],
      foreignColumns: [invoiceCorrections.tenantId, invoiceCorrections.id],
    }),
    foreignKey({
      name: 'invoice_correction_lines_invoice_line_fk',
      columns: [table.tenantId, table.invoiceLineId],
      foreignColumns: [invoiceLines.tenantId, invoiceLines.id],
    }),
  ],
);

export const invoiceDocuments = billing.table(
  'invoice_documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    correctionId: uuid('correction_id'),
    documentVersion: integer('document_version').notNull(),
    rendererVersion: integer('renderer_version').notNull().default(1),
    templateVersion: integer('template_version').notNull().default(0),
    locale: text('locale').$type<'de' | 'en'>().notNull().default('de'),
    status: text('status').$type<'pending' | 'ready' | 'failed'>().notNull(),
    objectKey: text('object_key'),
    sha256: text('sha256'),
    failureCode: text('failure_code'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('invoice_documents_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('invoice_documents_tenant_invoice_id_uq').on(
      table.tenantId,
      table.invoiceId,
      table.id,
    ),
    uniqueIndex('invoice_documents_invoice_version_uq').on(
      table.tenantId,
      table.invoiceId,
      table.documentVersion,
    ),
    index('invoice_documents_invoice_status_idx').on(
      table.tenantId,
      table.invoiceId,
      table.status,
      table.documentVersion,
    ),
    check('invoice_documents_version_ck', sql`${table.documentVersion} > 0`),
    check('invoice_documents_renderer_version_ck', sql`${table.rendererVersion} > 0`),
    check('invoice_documents_template_version_ck', sql`${table.templateVersion} >= 0`),
    check('invoice_documents_locale_ck', sql`${table.locale} IN ('de', 'en')`),
    check(
      'invoice_documents_artifact_ck',
      sql`(${table.status} = 'ready' AND ${table.objectKey} IS NOT NULL AND ${table.sha256} ~ '^[a-f0-9]{64}$' AND ${table.generatedAt} IS NOT NULL) OR (${table.status} <> 'ready' AND ${table.sha256} IS NULL)`,
    ),
    foreignKey({
      name: 'invoice_documents_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'invoice_documents_correction_fk',
      columns: [table.tenantId, table.correctionId],
      foreignColumns: [invoiceCorrections.tenantId, invoiceCorrections.id],
    }),
  ],
);

export const payments = billing.table(
  'payments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    payerReference: text('payer_reference'),
    payerNameSnapshot: text('payer_name_snapshot'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').$type<'EUR'>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    method: text('method').$type<'bank_transfer' | 'cash' | 'other'>().notNull(),
    reference: text('reference'),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payments_tenant_id_uq').on(table.tenantId, table.id),
    index('payments_provider_received_idx').on(
      table.tenantId,
      table.organizationId,
      table.receivedAt,
    ),
    check('payments_amount_ck', sql`${table.amountCents} > 0`),
    check(
      'payments_reference_ck',
      sql`${table.reference} IS NULL OR length(${table.reference}) <= 500`,
    ),
    foreignKey({
      name: 'payments_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const paymentAllocations = billing.table(
  'payment_allocations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    claimId: uuid('claim_id'),
    amountCents: integer('amount_cents').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payment_allocations_tenant_id_uq').on(table.tenantId, table.id),
    index('payment_allocations_claim_idx').on(table.tenantId, table.claimId, table.createdAt),
    index('payment_allocations_payment_idx').on(table.tenantId, table.paymentId),
    index('payment_allocations_invoice_idx').on(table.tenantId, table.invoiceId),
    check('payment_allocations_amount_ck', sql`${table.amountCents} > 0`),
    foreignKey({
      name: 'payment_allocations_payment_fk',
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    foreignKey({
      name: 'payment_allocations_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
  ],
);

export const paymentReversals = billing.table(
  'payment_reversals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    allocationId: uuid('allocation_id').notNull(),
    reason: text('reason').notNull(),
    reversedBy: uuid('reversed_by').notNull(),
    reversedAt: timestamp('reversed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payment_reversals_allocation_uq').on(table.tenantId, table.allocationId),
    check('payment_reversals_reason_ck', sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`),
    foreignKey({
      name: 'payment_reversals_allocation_fk',
      columns: [table.tenantId, table.allocationId],
      foreignColumns: [paymentAllocations.tenantId, paymentAllocations.id],
    }),
  ],
);

export const billingSchema = {
  billingProfiles,
  payerArrangements,
  invoices,
  invoiceLines,
  invoiceNumberSequences,
  invoiceNumbers,
  invoiceCorrections,
  invoiceCorrectionLines,
  invoiceDocuments,
  payments,
  paymentAllocations,
  paymentReversals,
};
