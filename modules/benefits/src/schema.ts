import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { clientInsurances, clientRecords } from '@care/clients';
import { organizationsTable } from '@care/organizations';
import { servicePrices } from '@care/services';
import { performedServices } from '@care/visit-execution';

const benefits = pgSchema('benefits');

export const benefitDefinitions = benefits.table('definitions', {
  id: text('id').primaryKey(),
  benefitType: text('benefit_type')
    .$type<'entlastungsbetrag_45b' | 'umwandlungsanspruch_45a_4' | 'private' | 'other'>()
    .notNull(),
  name: text('name').notNull(),
  statutoryReference: text('statutory_reference'),
});

export const benefitRuleVersions = benefits.table(
  'rule_versions',
  {
    id: uuid('id').primaryKey(),
    benefitType: text('benefit_type')
      .$type<'entlastungsbetrag_45b' | 'umwandlungsanspruch_45a_4'>()
      .notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveUntil: date('effective_until', { mode: 'string' }),
    monthlyAmountCents: integer('monthly_amount_cents'),
    annualAmountCents: integer('annual_amount_cents'),
    eligibleCareGrades: smallint('eligible_care_grades').array().notNull(),
    carryoverPolicy: text('carryover_policy').$type<'calendar_year_june_30' | 'none'>().notNull(),
    eligibilityRequirements: text('eligibility_requirements').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    sourceReference: text('source_reference').notNull(),
  },
  (table) => [
    uniqueIndex('benefit_rule_versions_type_jurisdiction_from_version_uq').on(
      table.benefitType,
      table.jurisdiction,
      table.effectiveFrom,
      table.ruleVersion,
    ),
    index('benefit_rule_versions_effective_idx').on(
      table.benefitType,
      table.jurisdiction,
      table.effectiveFrom,
      table.effectiveUntil,
    ),
    check(
      'benefit_rule_versions_month_start_ck',
      sql`extract(day from ${table.effectiveFrom}::date) = 1`,
    ),
  ],
);

export const benefitFundingSources = benefits.table(
  'funding_sources',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    sourceType: text('source_type')
      .$type<
        | 'statutory_long_term_care_insurance'
        | 'private_long_term_care_insurance'
        | 'self_pay'
        | 'other'
      >()
      .notNull(),
    clientInsuranceId: uuid('client_insurance_id'),
    label: text('label'),
    status: text('status').$type<'active' | 'ended'>().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('benefit_funding_sources_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('benefit_funding_sources_tenant_client_id_uq').on(
      table.tenantId,
      table.clientId,
      table.id,
    ),
    index('benefit_funding_sources_client_idx').on(table.tenantId, table.clientId, table.status),
    check(
      'benefit_funding_sources_insurance_ck',
      sql`(${table.sourceType} IN ('statutory_long_term_care_insurance', 'private_long_term_care_insurance') AND ${table.clientInsuranceId} IS NOT NULL) OR (${table.sourceType} IN ('self_pay', 'other') AND ${table.clientInsuranceId} IS NULL)`,
    ),
    check(
      'benefit_funding_sources_label_ck',
      sql`${table.label} IS NULL OR length(trim(${table.label})) BETWEEN 1 AND 160`,
    ),
    foreignKey({
      name: 'benefit_funding_sources_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'benefit_funding_sources_insurance_fk',
      columns: [table.tenantId, table.clientId, table.clientInsuranceId],
      foreignColumns: [clientInsurances.tenantId, clientInsurances.clientId, clientInsurances.id],
    }),
  ],
);

export const clientBenefitEntitlements = benefits.table(
  'client_entitlements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    benefitType: text('benefit_type')
      .$type<'entlastungsbetrag_45b' | 'umwandlungsanspruch_45a_4' | 'private' | 'other'>()
      .notNull(),
    fundingSourceId: uuid('funding_source_id').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    status: text('status').$type<'confirmed' | 'provisional' | 'suspended' | 'ended'>().notNull(),
    calculationMode: text('calculation_mode')
      .$type<'rule_based' | 'manual' | 'external_input'>()
      .notNull(),
    source: text('source')
      .$type<'payer_confirmed' | 'client_reported' | 'provider_reported' | 'contract'>()
      .notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('client_benefit_entitlements_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('client_benefit_entitlements_tenant_client_id_uq').on(
      table.tenantId,
      table.clientId,
      table.id,
    ),
    index('client_benefit_entitlements_client_validity_idx').on(
      table.tenantId,
      table.clientId,
      table.benefitType,
      table.validFrom,
      table.validUntil,
    ),
    check(
      'client_benefit_entitlements_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    check('client_benefit_entitlements_version_ck', sql`${table.version} > 0`),
    foreignKey({
      name: 'client_benefit_entitlements_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'client_benefit_entitlements_funding_source_fk',
      columns: [table.tenantId, table.clientId, table.fundingSourceId],
      foreignColumns: [
        benefitFundingSources.tenantId,
        benefitFundingSources.clientId,
        benefitFundingSources.id,
      ],
    }),
  ],
);

export const benefitAllocationBuckets = benefits.table(
  'allocation_buckets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    fundingSourceId: uuid('funding_source_id').notNull(),
    entitlementId: uuid('entitlement_id'),
    ruleVersionId: uuid('rule_version_id'),
    benefitType: text('benefit_type')
      .$type<'entlastungsbetrag_45b' | 'umwandlungsanspruch_45a_4' | 'private' | 'other'>()
      .notNull(),
    originPeriod: date('origin_period', { mode: 'string' }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    expiresAt: date('expires_at', { mode: 'string' }),
    bucketType: text('bucket_type')
      .$type<'monthly_entitlement' | 'opening_balance' | 'manual_adjustment' | 'external_input'>()
      .notNull(),
    verificationStatus: text('verification_status')
      .$type<'estimated' | 'client_reported' | 'provider_reported' | 'payer_confirmed'>()
      .notNull(),
    sourceReference: text('source_reference').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('benefit_allocation_buckets_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('benefit_allocation_buckets_source_uq').on(table.tenantId, table.sourceReference),
    index('benefit_allocation_buckets_client_expiry_idx').on(
      table.tenantId,
      table.clientId,
      table.expiresAt,
      table.originPeriod,
    ),
    check('benefit_allocation_buckets_amount_ck', sql`${table.amountCents} > 0`),
    check(
      'benefit_allocation_buckets_month_start_ck',
      sql`${table.bucketType} <> 'monthly_entitlement' OR extract(day from ${table.originPeriod}::date) = 1`,
    ),
    check(
      'benefit_allocation_buckets_rule_version_ck',
      sql`${table.bucketType} <> 'monthly_entitlement' OR ${table.ruleVersionId} IS NOT NULL`,
    ),
    foreignKey({
      name: 'benefit_allocation_buckets_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'benefit_allocation_buckets_funding_source_fk',
      columns: [table.tenantId, table.clientId, table.fundingSourceId],
      foreignColumns: [
        benefitFundingSources.tenantId,
        benefitFundingSources.clientId,
        benefitFundingSources.id,
      ],
    }),
    foreignKey({
      name: 'benefit_allocation_buckets_entitlement_fk',
      columns: [table.tenantId, table.clientId, table.entitlementId],
      foreignColumns: [
        clientBenefitEntitlements.tenantId,
        clientBenefitEntitlements.clientId,
        clientBenefitEntitlements.id,
      ],
    }),
    foreignKey({
      name: 'benefit_allocation_buckets_rule_version_fk',
      columns: [table.ruleVersionId],
      foreignColumns: [benefitRuleVersions.id],
    }),
  ],
);

export const serviceAllocations = benefits.table(
  'service_allocations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    performedServiceId: uuid('performed_service_id').notNull(),
    fundingSourceId: uuid('funding_source_id').notNull(),
    entitlementId: uuid('entitlement_id'),
    servicePriceId: uuid('service_price_id'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    serviceAmountCents: integer('service_amount_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    priceCentsSnapshot: integer('price_cents_snapshot'),
    pricingUnitSnapshot: text('pricing_unit_snapshot'),
    actualQuantitySnapshot: text('actual_quantity_snapshot'),
    status: text('status').$type<'provisional' | 'confirmed'>().notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_allocations_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('service_allocations_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    index('service_allocations_performed_service_idx').on(
      table.tenantId,
      table.performedServiceId,
      table.recordedAt,
    ),
    index('service_allocations_client_date_idx').on(
      table.tenantId,
      table.clientId,
      table.recordedAt,
    ),
    check('service_allocations_amount_ck', sql`${table.amountCents} > 0`),
    check(
      'service_allocations_service_amount_ck',
      sql`${table.serviceAmountCents} > 0 AND ${table.amountCents} <= ${table.serviceAmountCents}`,
    ),
    foreignKey({
      name: 'service_allocations_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'service_allocations_performed_service_fk',
      columns: [table.tenantId, table.performedServiceId],
      foreignColumns: [performedServices.tenantId, performedServices.id],
    }),
    foreignKey({
      name: 'service_allocations_funding_source_fk',
      columns: [table.tenantId, table.clientId, table.fundingSourceId],
      foreignColumns: [
        benefitFundingSources.tenantId,
        benefitFundingSources.clientId,
        benefitFundingSources.id,
      ],
    }),
    foreignKey({
      name: 'service_allocations_entitlement_fk',
      columns: [table.tenantId, table.clientId, table.entitlementId],
      foreignColumns: [
        clientBenefitEntitlements.tenantId,
        clientBenefitEntitlements.clientId,
        clientBenefitEntitlements.id,
      ],
    }),
    foreignKey({
      name: 'service_allocations_service_price_fk',
      columns: [table.tenantId, table.servicePriceId],
      foreignColumns: [servicePrices.tenantId, servicePrices.id],
    }),
  ],
);

export const benefitLedgerEntries = benefits.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    fundingSourceId: uuid('funding_source_id').notNull(),
    allocationBucketId: uuid('allocation_bucket_id'),
    serviceAllocationId: uuid('service_allocation_id'),
    performedServiceId: uuid('performed_service_id'),
    entryType: text('entry_type')
      .$type<
        | 'entitlement_allocated'
        | 'opening_balance_adjusted'
        | 'external_consumption_recorded'
        | 'service_consumption_allocated'
        | 'service_consumption_reversed'
        | 'manual_adjustment'
        | 'benefit_expired'
      >()
      .notNull(),
    amountCents: integer('amount_cents').notNull(),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    sourceType: text('source_type').notNull(),
    reference: text('reference'),
    sourceReference: text('source_reference').notNull(),
    verificationStatus: text('verification_status')
      .$type<'estimated' | 'client_reported' | 'provider_reported' | 'payer_confirmed'>()
      .notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('benefit_ledger_entries_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('benefit_ledger_entries_source_reference_uq').on(
      table.tenantId,
      table.sourceReference,
    ),
    index('benefit_ledger_entries_client_history_idx').on(
      table.tenantId,
      table.clientId,
      table.effectiveDate,
      table.recordedAt,
    ),
    index('benefit_ledger_entries_bucket_idx').on(
      table.tenantId,
      table.allocationBucketId,
      table.effectiveDate,
    ),
    check('benefit_ledger_entries_amount_ck', sql`${table.amountCents} <> 0`),
    foreignKey({
      name: 'benefit_ledger_entries_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'benefit_ledger_entries_funding_source_fk',
      columns: [table.tenantId, table.clientId, table.fundingSourceId],
      foreignColumns: [
        benefitFundingSources.tenantId,
        benefitFundingSources.clientId,
        benefitFundingSources.id,
      ],
    }),
    foreignKey({
      name: 'benefit_ledger_entries_bucket_fk',
      columns: [table.tenantId, table.allocationBucketId],
      foreignColumns: [benefitAllocationBuckets.tenantId, benefitAllocationBuckets.id],
    }),
    foreignKey({
      name: 'benefit_ledger_entries_allocation_fk',
      columns: [table.tenantId, table.serviceAllocationId],
      foreignColumns: [serviceAllocations.tenantId, serviceAllocations.id],
    }),
    foreignKey({
      name: 'benefit_ledger_entries_performed_service_fk',
      columns: [table.tenantId, table.performedServiceId],
      foreignColumns: [performedServices.tenantId, performedServices.id],
    }),
  ],
);

export const serviceAllocationReversals = benefits.table(
  'service_allocation_reversals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    allocationId: uuid('allocation_id').notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    reversedBy: uuid('reversed_by').notNull(),
    reversedAt: timestamp('reversed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_allocation_reversals_allocation_uq').on(
      table.tenantId,
      table.allocationId,
    ),
    uniqueIndex('service_allocation_reversals_idempotency_uq').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: 'service_allocation_reversals_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'service_allocation_reversals_allocation_fk',
      columns: [table.tenantId, table.allocationId],
      foreignColumns: [serviceAllocations.tenantId, serviceAllocations.id],
    }),
    check(
      'service_allocation_reversals_reason_ck',
      sql`length(trim(${table.reason})) BETWEEN 1 AND 500`,
    ),
  ],
);

export const providerRecognitions = benefits.table(
  'provider_recognitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    recognizedOffering: text('recognized_offering').notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    reference: text('reference'),
    status: text('status').$type<'active' | 'ended'>().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('provider_recognitions_tenant_id_uq').on(table.tenantId, table.id),
    index('provider_recognitions_validity_idx').on(
      table.tenantId,
      table.organizationId,
      table.jurisdiction,
      table.status,
      table.validFrom,
      table.validUntil,
    ),
    check(
      'provider_recognitions_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    foreignKey({
      name: 'provider_recognitions_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const benefitsSchema = {
  benefitDefinitions,
  benefitRuleVersions,
  benefitFundingSources,
  clientBenefitEntitlements,
  benefitAllocationBuckets,
  benefitLedgerEntries,
  serviceAllocations,
  serviceAllocationReversals,
  providerRecognitions,
};
