import { describe, expect, test } from 'bun:test';

import {
  allocateFromBuckets,
  applicableRule,
  bucketRemainingCents,
  monthlyEntitlementBuckets,
  serviceConsumptionInPeriodCents,
  serviceBenefitEligibility,
  type BenefitLedgerFact,
  type BenefitRule,
} from './benefits';

const rule: BenefitRule = {
  id: '45b-2026',
  benefitType: 'entlastungsbetrag_45b',
  jurisdiction: 'DE',
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  monthlyAmountCents: 13_100,
  annualAmountCents: null,
  eligibleCareGrades: [1, 2, 3, 4, 5],
  carryoverPolicy: 'calendar_year_june_30',
  eligibilityRequirements: 'confirmed Pflegegrad and recognized provider offering',
  ruleVersion: 2,
  sourceReference: '§ 45b SGB XI',
};

describe('benefit budgets', () => {
  test('selects the effective rule version for the service month', () => {
    const older = {
      ...rule,
      id: 'old',
      effectiveFrom: '2025-01-01',
      effectiveUntil: '2025-12-31',
      monthlyAmountCents: 12_500,
      ruleVersion: 1,
    };
    expect(applicableRule([older, rule], 'entlastungsbetrag_45b', 'DE', '2026-02-10')).toEqual(
      rule,
    );
    expect(applicableRule([older, rule], 'entlastungsbetrag_45b', 'DE', '2025-12-01')).toEqual(
      older,
    );
  });

  test('allocates a monthly entitlement bucket per period with June 30 carryover expiry', () => {
    const buckets = monthlyEntitlementBuckets(
      {
        id: 'entitlement',
        clientId: 'client',
        benefitType: 'entlastungsbetrag_45b',
        fundingSourceId: 'source',
        validFrom: '2026-01-18',
        validUntil: null,
        status: 'confirmed',
      },
      [rule],
      '2026-03-15',
      'payer_confirmed',
    );
    expect(buckets.map((bucket) => bucket.originPeriod)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(buckets.every((bucket) => bucket.amountCents === 13_100)).toBe(true);
    expect(buckets.every((bucket) => bucket.expiresAt === '2027-06-30')).toBe(true);
  });

  test('spends earliest expiry first and stops using prior-year carryover after June 30', () => {
    const buckets = [
      {
        id: '2025-12',
        fundingSourceId: 'source',
        entitlementId: 'entitlement',
        benefitType: 'entlastungsbetrag_45b' as const,
        originPeriod: '2025-12-01',
        amountCents: 5_000,
        expiresAt: '2026-06-30',
        verificationStatus: 'payer_confirmed' as const,
        bucketType: 'opening_balance' as const,
      },
      {
        id: '2026-01',
        fundingSourceId: 'source',
        entitlementId: 'entitlement',
        benefitType: 'entlastungsbetrag_45b' as const,
        originPeriod: '2026-01-01',
        amountCents: 13_100,
        expiresAt: '2027-06-30',
        verificationStatus: 'payer_confirmed' as const,
        bucketType: 'monthly_entitlement' as const,
      },
    ];
    const noLedger: BenefitLedgerFact[] = [];
    const atExpiry = allocateFromBuckets({
      buckets,
      ledger: noLedger,
      amountCents: 6_000,
      serviceDate: '2026-06-30',
      verification: 'confirmed',
    });
    expect(atExpiry.uses).toEqual([
      { bucketId: '2025-12', amountCents: 5_000 },
      { bucketId: '2026-01', amountCents: 1_000 },
    ]);
    const afterExpiry = allocateFromBuckets({
      buckets,
      ledger: noLedger,
      amountCents: 6_000,
      serviceDate: '2026-07-01',
      verification: 'confirmed',
    });
    expect(afterExpiry.uses).toEqual([{ bucketId: '2026-01', amountCents: 6_000 }]);
  });

  test('excludes unverified balances from confirmed allocations and supports append-only reversals', () => {
    const bucket = {
      id: 'opening',
      fundingSourceId: 'source',
      entitlementId: 'entitlement',
      benefitType: 'entlastungsbetrag_45b' as const,
      originPeriod: '2026-01-01',
      amountCents: 10_000,
      expiresAt: '2027-06-30',
      verificationStatus: 'client_reported' as const,
      bucketType: 'opening_balance' as const,
    };
    expect(
      allocateFromBuckets({
        buckets: [bucket],
        ledger: [],
        amountCents: 1_000,
        serviceDate: '2026-02-01',
        verification: 'confirmed',
      }).remainingCents,
    ).toBe(1_000);
    const ledger: BenefitLedgerFact[] = [
      {
        allocationBucketId: 'opening',
        entryType: 'service_consumption_allocated',
        amountCents: -2_500,
        effectiveDate: '2026-02-01',
        verificationStatus: 'provider_reported',
      },
      {
        allocationBucketId: 'opening',
        entryType: 'service_consumption_reversed',
        amountCents: 1_000,
        effectiveDate: '2026-02-02',
        verificationStatus: 'provider_reported',
      },
    ];
    expect(bucketRemainingCents(bucket, ledger, '2026-02-02', 'provisional')).toBe(8_500);
  });

  test('keeps positive manual adjustments from consuming their own bucket', () => {
    const bucket = {
      id: 'opening',
      fundingSourceId: 'source',
      entitlementId: 'entitlement',
      benefitType: 'entlastungsbetrag_45b' as const,
      originPeriod: '2026-01-01',
      amountCents: 10_000,
      expiresAt: '2027-06-30',
      verificationStatus: 'client_reported' as const,
      bucketType: 'manual_adjustment' as const,
    };
    const ledger: BenefitLedgerFact[] = [
      {
        allocationBucketId: 'opening',
        entryType: 'manual_adjustment',
        amountCents: 10_000,
        effectiveDate: '2026-01-01',
        verificationStatus: 'client_reported',
      },
    ];
    expect(bucketRemainingCents(bucket, ledger, '2026-02-01', 'provisional')).toBe(10_000);
  });

  test('projects an as-of balance without later consumption or reversals', () => {
    const bucket = {
      id: 'monthly',
      fundingSourceId: 'source',
      entitlementId: 'entitlement',
      benefitType: 'entlastungsbetrag_45b' as const,
      originPeriod: '2026-01-01',
      amountCents: 13_100,
      expiresAt: '2027-06-30',
      verificationStatus: 'payer_confirmed' as const,
      bucketType: 'monthly_entitlement' as const,
    };
    const ledger: BenefitLedgerFact[] = [
      {
        allocationBucketId: 'monthly',
        entryType: 'service_consumption_allocated',
        amountCents: -2_500,
        effectiveDate: '2026-02-01',
        verificationStatus: 'provider_reported',
      },
      {
        allocationBucketId: 'monthly',
        entryType: 'service_consumption_reversed',
        amountCents: 1_000,
        effectiveDate: '2026-02-03',
        verificationStatus: 'provider_reported',
      },
    ];
    expect(bucketRemainingCents(bucket, ledger, '2026-02-02', 'provisional')).toBe(10_600);
    expect(bucketRemainingCents(bucket, ledger, '2026-02-04', 'provisional')).toBe(11_600);
    expect(
      allocateFromBuckets({
        buckets: [bucket],
        ledger,
        amountCents: 11_000,
        serviceDate: '2026-02-02',
        verification: 'provisional',
      }),
    ).toMatchObject({ remainingCents: 400 });
  });

  test('attributes reversals to the original service period', () => {
    const ledger: BenefitLedgerFact[] = [
      {
        allocationBucketId: 'bucket',
        serviceAllocationId: 'allocation',
        entryType: 'service_consumption_allocated',
        amountCents: -4_500,
        effectiveDate: '2026-10-28',
        verificationStatus: 'provider_reported',
      },
      {
        allocationBucketId: 'bucket',
        serviceAllocationId: 'allocation',
        entryType: 'service_consumption_reversed',
        amountCents: 4_500,
        effectiveDate: '2026-11-02',
        verificationStatus: 'provider_reported',
      },
      {
        allocationBucketId: 'bucket',
        serviceAllocationId: 'another',
        entryType: 'service_consumption_allocated',
        amountCents: -2_000,
        effectiveDate: '2026-11-03',
        verificationStatus: 'provider_reported',
      },
    ];
    expect(serviceConsumptionInPeriodCents(ledger, '2026-10')).toBe(0);
    expect(serviceConsumptionInPeriodCents(ledger, '2026-11')).toBe(2_000);
  });

  test('requires Pflegegrad, recognized support, and externally recorded inputs for statutory funding', () => {
    expect(
      serviceBenefitEligibility({
        benefitType: 'entlastungsbetrag_45b',
        serviceCategory: 'recognized_support',
        jurisdiction: 'DE-NW',
        serviceDate: '2026-02-01',
        careGrade: null,
        rule,
        recognized: true,
        externalInputRecorded: false,
      }),
    ).toEqual({ eligible: false, reason: 'PFLEGEGRAD_REQUIRED' });
    expect(
      serviceBenefitEligibility({
        benefitType: 'entlastungsbetrag_45b',
        serviceCategory: 'clinical_nursing',
        jurisdiction: 'DE-NW',
        serviceDate: '2026-02-01',
        careGrade: 3,
        rule,
        recognized: true,
        externalInputRecorded: false,
      }),
    ).toEqual({ eligible: false, reason: 'SERVICE_NOT_RECOGNIZED_SUPPORT' });
    expect(
      serviceBenefitEligibility({
        benefitType: 'entlastungsbetrag_45b',
        serviceCategory: 'recognized_support',
        jurisdiction: 'DE-NW',
        serviceDate: '2026-02-01',
        careGrade: 3,
        rule,
        recognized: false,
        externalInputRecorded: false,
      }),
    ).toEqual({ eligible: false, reason: 'PROVIDER_RECOGNITION_REQUIRED' });
    expect(
      serviceBenefitEligibility({
        benefitType: 'umwandlungsanspruch_45a_4',
        serviceCategory: 'recognized_support',
        jurisdiction: 'DE-NW',
        serviceDate: '2026-02-01',
        careGrade: 3,
        rule: {
          ...rule,
          benefitType: 'umwandlungsanspruch_45a_4',
          eligibleCareGrades: [2, 3, 4, 5],
          monthlyAmountCents: null,
        },
        recognized: true,
        externalInputRecorded: false,
      }),
    ).toEqual({ eligible: false, reason: 'EXTERNAL_BENEFIT_INPUT_REQUIRED' });
  });
});
