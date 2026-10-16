import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizationsTable } from '@care/organizations';

const billing = pgSchema('billing');

export type PayerType =
  | 'statutory_pflegekasse'
  | 'private_pflegeversicherung'
  | 'self_pay'
  | 'other';
export type PayerSubmissionChannel =
  | 'manual_portal'
  | 'manual_email'
  | 'postal'
  | 'customer_reimbursement';
export type ClaimFundingSourceType =
  | 'statutory_long_term_care_insurance'
  | 'private_long_term_care_insurance'
  | 'self_pay'
  | 'other';

export const payers = billing.table(
  'payers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    payerType: text('payer_type').$type<PayerType>().notNull(),
    name: text('name').notNull(),
    payerIdentifier: text('payer_identifier'),
    addressText: text('address_text'),
    billingContactName: text('billing_contact_name'),
    billingContactEmail: text('billing_contact_email'),
    billingContactPhone: text('billing_contact_phone'),
    submissionInstructions: text('submission_instructions'),
    status: text('status').$type<'active' | 'inactive'>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payers_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('payers_tenant_organization_id_uq').on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    index('payers_org_status_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.name,
    ),
    check(
      'payers_type_ck',
      sql`${table.payerType} IN ('statutory_pflegekasse', 'private_pflegeversicherung', 'self_pay', 'other')`,
    ),
    check('payers_status_ck', sql`${table.status} IN ('active', 'inactive')`),
    check('payers_version_ck', sql`${table.version} > 0`),
    check(
      'payers_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    check(
      'payers_fields_ck',
      sql`length(trim(${table.name})) BETWEEN 1 AND 200 AND length(coalesce(${table.payerIdentifier}, '')) <= 80 AND length(coalesce(${table.addressText}, '')) <= 1000 AND length(coalesce(${table.billingContactName}, '')) <= 200 AND length(coalesce(${table.billingContactEmail}, '')) <= 254 AND length(coalesce(${table.billingContactPhone}, '')) <= 80 AND length(coalesce(${table.submissionInstructions}, '')) <= 2000`,
    ),
    foreignKey({
      name: 'payers_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const payerBillingProfiles = billing.table(
  'payer_billing_profiles',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    payerId: uuid('payer_id').notNull(),
    version: integer('version').notNull(),
    channel: text('channel').$type<PayerSubmissionChannel>().notNull(),
    fundingSourceType: text('funding_source_type').$type<ClaimFundingSourceType>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    sourceName: text('source_name').notNull(),
    sourceVersion: text('source_version').notNull(),
    sourceEffectiveDate: date('source_effective_date', { mode: 'string' }).notNull(),
    sourceUrl: text('source_url'),
    requiresClientInsuranceNumber: boolean('requires_client_insurance_number').notNull(),
    requiresPayerIdentifier: boolean('requires_payer_identifier').notNull(),
    requiresAcknowledgement: boolean('requires_acknowledgement').notNull(),
    requiresMandate: boolean('requires_mandate').notNull(),
    requiresInvoicePdf: boolean('requires_invoice_pdf').notNull(),
    requiresEvidencePdf: boolean('requires_evidence_pdf').notNull(),
    requiresMandateDocument: boolean('requires_mandate_document').notNull(),
    requiresExternalReference: boolean('requires_external_reference').notNull(),
    requiresProviderRecognition: boolean('requires_provider_recognition').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payer_billing_profiles_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('payer_billing_profiles_tenant_org_id_uq').on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    uniqueIndex('payer_billing_profiles_version_uq').on(
      table.tenantId,
      table.payerId,
      table.channel,
      table.fundingSourceType,
      table.version,
    ),
    index('payer_billing_profiles_effective_idx').on(
      table.tenantId,
      table.payerId,
      table.fundingSourceType,
      table.validFrom,
      table.validUntil,
    ),
    check('payer_billing_profiles_version_ck', sql`${table.version} > 0`),
    check(
      'payer_billing_profiles_channel_ck',
      sql`${table.channel} IN ('manual_portal', 'manual_email', 'postal', 'customer_reimbursement')`,
    ),
    check(
      'payer_billing_profiles_funding_ck',
      sql`${table.fundingSourceType} IN ('statutory_long_term_care_insurance', 'private_long_term_care_insurance', 'self_pay', 'other')`,
    ),
    check(
      'payer_billing_profiles_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    check(
      'payer_billing_profiles_source_ck',
      sql`length(trim(${table.sourceName})) BETWEEN 1 AND 200 AND length(trim(${table.sourceVersion})) BETWEEN 1 AND 120 AND (${table.sourceUrl} IS NULL OR ${table.sourceUrl} ~ '^https://')`,
    ),
    foreignKey({
      name: 'payer_billing_profiles_payer_fk',
      columns: [table.tenantId, table.organizationId, table.payerId],
      foreignColumns: [payers.tenantId, payers.organizationId, payers.id],
    }),
  ],
);

export const payerDirectorySchema = { payers, payerBillingProfiles };
