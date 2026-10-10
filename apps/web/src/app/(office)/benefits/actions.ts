'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const benefitTypes = [
  'entlastungsbetrag_45b',
  'umwandlungsanspruch_45a_4',
  'private',
  'other',
] as const;
const fundingSourceTypes = [
  'statutory_long_term_care_insurance',
  'private_long_term_care_insurance',
  'self_pay',
  'other',
] as const;
const adjustmentTypes = [
  'opening_balance',
  'external_consumption',
  'manual_adjustment',
  'external_input',
] as const;
const verificationStatuses = [
  'estimated',
  'client_reported',
  'provider_reported',
  'payer_confirmed',
] as const;

export async function createFundingSourceAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const sourceType = readChoice(formData.get('sourceType'), fundingSourceTypes);
  const insuranceId = readUuid(formData.get('clientInsuranceId'));
  if (!clientId || !sourceType) redirect(clientBenefitsPath(clientId, 'INVALID_REQUEST'));
  const requiresInsurance =
    sourceType === 'statutory_long_term_care_insurance' ||
    sourceType === 'private_long_term_care_insurance';
  if (requiresInsurance && !insuranceId)
    redirect(clientBenefitsPath(clientId, 'INVALID_BENEFIT_FUNDING_SOURCE'));

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/funding-sources', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: {
      sourceType,
      ...(requiresInsurance && insuranceId ? { clientInsuranceId: insuranceId } : {}),
      label: readNullableText(formData.get('label')),
    },
  });
  if (error) redirect(clientBenefitsPath(clientId, error.code));
  refreshClientBenefits(clientId);
  redirect(clientBenefitsPath(clientId, '', 'funding_source'));
}

export async function createEntitlementAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const benefitType = readChoice(formData.get('benefitType'), benefitTypes);
  const fundingSourceId = readUuid(formData.get('fundingSourceId'));
  const validFrom = readDate(formData.get('validFrom'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  const sourceChoice = readChoice(formData.get('source'), [
    'payer_confirmed',
    'client_reported',
    'provider_reported',
    'contract',
  ] as const);
  if (
    !clientId ||
    !benefitType ||
    !fundingSourceId ||
    !validFrom ||
    validUntil === undefined ||
    !sourceChoice
  ) {
    redirect(clientBenefitsPath(clientId, 'INVALID_REQUEST'));
  }
  const contractIsConfirmed =
    sourceChoice === 'contract' && (benefitType === 'private' || benefitType === 'other');
  const status =
    sourceChoice === 'payer_confirmed' || contractIsConfirmed ? 'confirmed' : 'provisional';
  const calculationMode =
    benefitType === 'entlastungsbetrag_45b'
      ? 'rule_based'
      : benefitType === 'umwandlungsanspruch_45a_4'
        ? 'external_input'
        : 'manual';
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/benefits', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: {
      benefitType,
      fundingSourceId,
      validFrom,
      validUntil,
      status,
      calculationMode,
      source: sourceChoice,
    },
  });
  if (error) redirect(clientBenefitsPath(clientId, error.code));
  refreshClientBenefits(clientId);
  redirect(clientBenefitsPath(clientId, '', 'entitlement'));
}

export async function recordBenefitAdjustmentAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const fundingSourceId = readUuid(formData.get('fundingSourceId'));
  const entitlementId = readUuid(formData.get('entitlementId'));
  const benefitType = readChoice(formData.get('benefitType'), benefitTypes);
  const idempotencyKey = readUuid(formData.get('idempotencyKey'));
  const amountCents = parseSignedEuroCents(readString(formData.get('amount')));
  const effectiveDate = readDate(formData.get('effectiveDate'));
  const adjustmentType = readChoice(formData.get('adjustmentType'), adjustmentTypes);
  const sourceType = readString(formData.get('sourceType')).trim();
  const verificationStatus = readChoice(formData.get('verificationStatus'), verificationStatuses);
  if (
    !clientId ||
    !fundingSourceId ||
    !benefitType ||
    !idempotencyKey ||
    amountCents === null ||
    !effectiveDate ||
    !adjustmentType ||
    !sourceType ||
    !verificationStatus
  ) {
    redirect(clientBenefitsPath(clientId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/budget-adjustments', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: {
      idempotencyKey,
      fundingSourceId,
      ...(entitlementId ? { entitlementId } : {}),
      benefitType,
      amountCents,
      effectiveDate,
      adjustmentType,
      sourceType,
      reference: readNullableText(formData.get('reference')),
      verificationStatus,
    },
  });
  if (error) redirect(clientBenefitsPath(clientId, error.code));
  refreshClientBenefits(clientId);
  redirect(clientBenefitsPath(clientId, '', 'adjustment'));
}

export async function allocatePerformedServiceAction(formData: FormData): Promise<void> {
  const performedServiceId = readUuid(formData.get('performedServiceId'));
  const manualServiceAmountCents = parseOptionalEuroCents(
    readString(formData.get('manualServiceAmount')),
  );
  const allocations = [];
  for (let index = 0; index < 3; index += 1) {
    const selection = readString(formData.get(`allocation-${index}-selection`));
    const amountInput = readString(formData.get(`allocation-${index}-amount`));
    if (!selection && !amountInput) continue;
    const [rawFundingSourceId, rawEntitlementId] = selection.split('|');
    const fundingSourceId = readUuid(rawFundingSourceId ?? null);
    const entitlementId = readUuid(rawEntitlementId ?? null);
    const amountCents = parseOptionalEuroCents(amountInput);
    const status = readChoice(formData.get(`allocation-${index}-status`), [
      'provisional',
      'confirmed',
    ] as const);
    const idempotencyKey = readUuid(formData.get(`allocation-${index}-key`));
    if (!fundingSourceId || !entitlementId || amountCents === null || !status || !idempotencyKey) {
      redirect('/benefits?error=INVALID_REQUEST');
    }
    allocations.push({
      fundingSourceId,
      entitlementId,
      amountCents,
      status,
      idempotencyKey,
      ...(manualServiceAmountCents !== null ? { manualServiceAmountCents } : {}),
    });
  }
  if (
    !performedServiceId ||
    allocations.length === 0 ||
    (manualServiceAmountCents === null && readString(formData.get('manualServiceAmount')))
  ) {
    redirect('/benefits?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { error } = await api.POST(
    '/api/v1/performed-services/{performedServiceId}/funding-allocations',
    {
      params: { path: { performedServiceId }, header: await getTenantHeader() },
      body: { allocations },
    },
  );
  if (error) redirect(`/benefits?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/benefits');
  revalidatePath('/planning');
  redirect('/benefits?updated=allocation');
}

export async function createProviderRecognitionAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const recognizedOffering = readString(formData.get('recognizedOffering')).trim();
  const validFrom = readDate(formData.get('validFrom'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  const reference = readNullableText(formData.get('reference'));
  if (!organizationId || !recognizedOffering || !validFrom || validUntil === undefined)
    redirect('/benefits?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/benefits/provider-recognitions', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      recognizedOffering,
      jurisdiction: 'DE-NW',
      validFrom,
      validUntil,
      reference,
    },
  });
  if (error) redirect(`/benefits?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/benefits');
  revalidatePath('/planning');
  redirect('/benefits?updated=recognition');
}

function refreshClientBenefits(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/benefits`);
  revalidatePath('/benefits');
  revalidatePath('/planning');
}

function clientBenefitsPath(clientId: string | null, error?: string, updated?: string) {
  const path = clientId ? `/clients/${clientId}/benefits` : '/benefits';
  const query = new URLSearchParams();
  if (error) query.set('error', error);
  if (updated) query.set('updated', updated);
  return query.size ? `${path}?${query.toString()}` : path;
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  return uuidPattern.test(parsed) ? parsed : null;
}

function readChoice<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  values: T,
): T[number] | null {
  const parsed = readString(value);
  return (values as readonly string[]).includes(parsed) ? (parsed as T[number]) : null;
}

function readDate(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return null;
  const date = new Date(`${parsed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed ? null : parsed;
}

function readOptionalDate(value: FormDataEntryValue | null): string | null | undefined {
  const parsed = readString(value);
  return parsed ? readDate(value) : null;
}

function readNullableText(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  return parsed || null;
}

function parseOptionalEuroCents(value: string): number | null {
  if (!value) return null;
  return parseSignedEuroCents(value);
}

function parseSignedEuroCents(value: string): number | null {
  const match = /^(-?)(0|[1-9]\d*)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  const signed = match[1] === '-' ? -amount : amount;
  if (signed < -2_000_000_000n || signed > 2_000_000_000n || signed === 0n) return null;
  return Number(signed);
}
