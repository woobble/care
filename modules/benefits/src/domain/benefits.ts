export type BenefitType =
  | 'entlastungsbetrag_45b'
  | 'umwandlungsanspruch_45a_4'
  | 'private'
  | 'other';

export type VerificationStatus =
  | 'estimated'
  | 'client_reported'
  | 'provider_reported'
  | 'payer_confirmed';

export type EntitlementStatus = 'confirmed' | 'provisional' | 'suspended' | 'ended';
export type BenefitCarryoverPolicy = 'calendar_year_june_30' | 'none';
export type BenefitLedgerEntryType =
  | 'entitlement_allocated'
  | 'opening_balance_adjusted'
  | 'external_consumption_recorded'
  | 'service_consumption_allocated'
  | 'service_consumption_reversed'
  | 'manual_adjustment'
  | 'benefit_expired';

export interface BenefitRule {
  id: string;
  benefitType: 'entlastungsbetrag_45b' | 'umwandlungsanspruch_45a_4';
  jurisdiction: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  monthlyAmountCents: number | null;
  annualAmountCents: number | null;
  eligibleCareGrades: readonly number[];
  carryoverPolicy: BenefitCarryoverPolicy;
  eligibilityRequirements: string;
  ruleVersion: number;
  sourceReference: string;
}

export interface ClientBenefitEntitlement {
  id: string;
  clientId: string;
  benefitType: BenefitType;
  fundingSourceId: string;
  validFrom: string;
  validUntil: string | null;
  status: EntitlementStatus;
}

export interface BenefitBucket {
  id: string;
  fundingSourceId: string;
  entitlementId: string | null;
  ruleVersionId?: string | null;
  benefitType: BenefitType;
  originPeriod: string;
  amountCents: number;
  expiresAt: string | null;
  verificationStatus: VerificationStatus;
  bucketType: 'monthly_entitlement' | 'opening_balance' | 'manual_adjustment' | 'external_input';
}

export interface BenefitLedgerFact {
  allocationBucketId: string | null;
  serviceAllocationId?: string | null;
  entryType: BenefitLedgerEntryType;
  amountCents: number;
  effectiveDate: string;
  verificationStatus: VerificationStatus;
}

export interface BucketUse {
  bucketId: string;
  amountCents: number;
}

export function applicableRule(
  rules: readonly BenefitRule[],
  benefitType: BenefitRule['benefitType'],
  jurisdiction: string,
  date: string,
): BenefitRule | null {
  const month = monthStart(date);
  return (
    rules
      .filter(
        (rule) =>
          rule.benefitType === benefitType &&
          rule.jurisdiction === jurisdiction &&
          rule.effectiveFrom <= month &&
          (rule.effectiveUntil === null || rule.effectiveUntil >= month),
      )
      .sort((a, b) =>
        a.effectiveFrom === b.effectiveFrom
          ? b.ruleVersion - a.ruleVersion
          : b.effectiveFrom.localeCompare(a.effectiveFrom),
      )[0] ?? null
  );
}

export function monthlyEntitlementBuckets(
  entitlement: ClientBenefitEntitlement,
  rules: readonly BenefitRule[],
  through: string,
  verificationStatus: VerificationStatus,
  jurisdiction = 'DE',
): BenefitBucket[] {
  if (
    entitlement.benefitType !== 'entlastungsbetrag_45b' &&
    entitlement.benefitType !== 'umwandlungsanspruch_45a_4'
  ) {
    return [];
  }
  if (entitlement.status === 'suspended') return [];

  const currentMonth = monthStart(through);
  let month = monthStart(entitlement.validFrom);
  const lastValidDay = entitlement.validUntil ?? through;
  if (monthStart(lastValidDay) < month) return [];
  const lastMonth = monthStart(lastValidDay < through ? lastValidDay : through);
  const buckets: BenefitBucket[] = [];

  while (month <= currentMonth && month <= lastMonth) {
    const rule = applicableRule(rules, entitlement.benefitType, jurisdiction, month);
    if (rule?.monthlyAmountCents !== null && rule?.monthlyAmountCents !== undefined) {
      const expiry =
        rule.carryoverPolicy === 'calendar_year_june_30'
          ? `${Number(month.slice(0, 4)) + 1}-06-30`
          : null;
      buckets.push({
        id: `${entitlement.id}:${month}`,
        fundingSourceId: entitlement.fundingSourceId,
        entitlementId: entitlement.id,
        ruleVersionId: rule.id,
        benefitType: entitlement.benefitType,
        originPeriod: month,
        amountCents: rule.monthlyAmountCents,
        expiresAt: expiry,
        verificationStatus,
        bucketType: 'monthly_entitlement',
      });
    }
    month = nextMonth(month);
  }
  return buckets;
}

export function allocateFromBuckets(input: {
  buckets: readonly BenefitBucket[];
  ledger: readonly BenefitLedgerFact[];
  amountCents: number;
  serviceDate: string;
  verification: 'provisional' | 'confirmed';
}): { uses: BucketUse[]; remainingCents: number } {
  requirePositiveCents(input.amountCents);
  const consumed = new Map<string, number>();
  for (const entry of input.ledger) {
    if (entry.effectiveDate > input.serviceDate) continue;
    if (!entry.allocationBucketId) continue;
    const usage = ledgerUsageCents(entry);
    if (usage === 0) continue;
    consumed.set(
      entry.allocationBucketId,
      addCents(consumed.get(entry.allocationBucketId) ?? 0, usage),
    );
  }

  const eligible = input.buckets
    .filter((bucket) => {
      if (bucket.originPeriod > monthStart(input.serviceDate)) return false;
      if (bucket.expiresAt !== null && bucket.expiresAt < input.serviceDate) return false;
      if (input.verification === 'confirmed' && bucket.verificationStatus !== 'payer_confirmed') {
        return false;
      }
      return addCents(bucket.amountCents, -(consumed.get(bucket.id) ?? 0)) > 0;
    })
    .sort((left, right) => {
      if (left.expiresAt === null && right.expiresAt !== null) return 1;
      if (left.expiresAt !== null && right.expiresAt === null) return -1;
      if (left.expiresAt !== right.expiresAt) {
        return (left.expiresAt ?? '').localeCompare(right.expiresAt ?? '');
      }
      return left.originPeriod.localeCompare(right.originPeriod);
    });

  let remainingCents = input.amountCents;
  const uses: BucketUse[] = [];
  for (const bucket of eligible) {
    const available = bucket.amountCents - (consumed.get(bucket.id) ?? 0);
    const amountCents = Math.min(available, remainingCents);
    if (amountCents <= 0) continue;
    uses.push({ bucketId: bucket.id, amountCents });
    remainingCents -= amountCents;
    if (remainingCents === 0) break;
  }
  return { uses, remainingCents };
}

export function serviceBenefitEligibility(input: {
  benefitType: BenefitType;
  serviceCategory: 'recognized_support' | 'clinical_nursing' | 'other';
  jurisdiction: string;
  serviceDate: string;
  careGrade: number | null;
  rule: BenefitRule | null;
  recognized: boolean;
  externalInputRecorded: boolean;
}): { eligible: boolean; reason?: string } {
  if (input.benefitType === 'private' || input.benefitType === 'other') {
    return { eligible: true };
  }
  if (input.serviceCategory !== 'recognized_support') {
    return { eligible: false, reason: 'SERVICE_NOT_RECOGNIZED_SUPPORT' };
  }
  if (input.jurisdiction === 'DE-NW' && !input.recognized) {
    return { eligible: false, reason: 'PROVIDER_RECOGNITION_REQUIRED' };
  }
  if (input.careGrade === null) return { eligible: false, reason: 'PFLEGEGRAD_REQUIRED' };
  if (!input.rule) return { eligible: false, reason: 'BENEFIT_RULE_NOT_FOUND' };
  if (!input.rule.eligibleCareGrades.includes(input.careGrade)) {
    return { eligible: false, reason: 'PFLEGEGRAD_NOT_ELIGIBLE' };
  }
  if (input.benefitType === 'umwandlungsanspruch_45a_4' && !input.externalInputRecorded) {
    return { eligible: false, reason: 'EXTERNAL_BENEFIT_INPUT_REQUIRED' };
  }
  return { eligible: true };
}

export function bucketRemainingCents(
  bucket: BenefitBucket,
  ledger: readonly BenefitLedgerFact[],
  serviceDate: string,
  verification: 'provisional' | 'confirmed',
): number {
  if (bucket.originPeriod > monthStart(serviceDate)) return 0;
  if (bucket.expiresAt !== null && bucket.expiresAt < serviceDate) return 0;
  if (verification === 'confirmed' && bucket.verificationStatus !== 'payer_confirmed') return 0;
  const consumed = ledger
    .filter((entry) => entry.allocationBucketId === bucket.id && entry.effectiveDate <= serviceDate)
    .reduce((sum, entry) => addCents(sum, ledgerUsageCents(entry)), 0);
  return Math.max(0, addCents(bucket.amountCents, -consumed));
}

export function serviceConsumptionInPeriodCents(
  ledger: readonly BenefitLedgerFact[],
  period: string,
): number {
  const allocationPeriod = new Map<string, string>();
  for (const entry of ledger) {
    if (entry.entryType === 'service_consumption_allocated' && entry.serviceAllocationId) {
      allocationPeriod.set(entry.serviceAllocationId, entry.effectiveDate.slice(0, 7));
    }
  }
  return ledger
    .filter((entry) => {
      if (entry.entryType === 'service_consumption_allocated')
        return entry.effectiveDate.slice(0, 7) === period;
      if (entry.entryType === 'service_consumption_reversed' && entry.serviceAllocationId) {
        return allocationPeriod.get(entry.serviceAllocationId) === period;
      }
      return false;
    })
    .reduce((sum, entry) => addCents(sum, -entry.amountCents), 0);
}

function ledgerUsageCents(entry: BenefitLedgerFact): number {
  if (
    entry.entryType === 'service_consumption_allocated' ||
    entry.entryType === 'external_consumption_recorded' ||
    entry.entryType === 'benefit_expired'
  ) {
    return -entry.amountCents;
  }
  if (entry.entryType === 'manual_adjustment') {
    return entry.amountCents < 0 ? -entry.amountCents : 0;
  }
  if (entry.entryType === 'service_consumption_reversed') return -entry.amountCents;
  return 0;
}

export function monthStart(date: string): string {
  if (!isIsoDate(date)) throw new InvalidBenefitDateError();
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const month = monthStart(date);
  const next = nextMonth(month);
  const day = new Date(`${next}T00:00:00.000Z`);
  day.setUTCDate(0);
  return day.toISOString().slice(0, 10);
}

export function nextMonth(month: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new InvalidBenefitDateError();
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export function addCents(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new InvalidBenefitAmountError();
  }
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new InvalidBenefitAmountError();
  return sum;
}

export function requirePositiveCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new InvalidBenefitAmountError();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export class InvalidBenefitAmountError extends Error {
  readonly code = 'INVALID_BENEFIT_AMOUNT';

  constructor() {
    super('Benefit amounts must be positive safe integer EUR cents');
    this.name = 'InvalidBenefitAmountError';
  }
}

export class InvalidBenefitDateError extends Error {
  readonly code = 'INVALID_BENEFIT_DATE';

  constructor() {
    super('Benefit date is invalid');
    this.name = 'InvalidBenefitDateError';
  }
}
