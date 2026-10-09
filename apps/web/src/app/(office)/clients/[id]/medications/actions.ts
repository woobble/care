'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import { visitDateTimeFromInput } from '../../../../../lib/care-date';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function createMedicationDefinitionAction(formData: FormData): Promise<void> {
  const name = text(formData, 'name');
  const dosageForm = choice(formData, 'dosageForm', ['tablet', 'capsule', 'drops', 'solution', 'injection', 'cream', 'patch', 'inhalation', 'other']);
  const route = choice(formData, 'route', ['oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other']);
  if (!name || !dosageForm || !route) medicationRedirect(null, 'MEDICATION_INVALID');
  const clientId = uuid(formData.get('clientId'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medications', {
    params: { header: await getTenantHeader() },
    body: {
      name,
      activeIngredient: nullableText(formData, 'activeIngredient'),
      strength: nullableText(formData, 'strength'),
      dosageForm,
      route,
      manufacturer: nullableText(formData, 'manufacturer'),
      externalCode: nullableText(formData, 'externalCode'),
    },
  });
  if (error) medicationRedirect(clientId, error.code);
  if (clientId) refresh(clientId);
  redirect(clientId ? `/clients/${clientId}/medications` : '/administration');
}

export async function updateMedicationDefinitionAction(formData: FormData): Promise<void> {
  const clientId = uuid(formData.get('clientId'));
  const definitionId = uuid(formData.get('definitionId'));
  const status = choice(formData, 'status', ['active', 'archived']);
  if (!clientId || !definitionId || !status) medicationRedirect(clientId, 'MEDICATION_INVALID');
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/medications/{id}', {
    params: { path: { id: definitionId }, header: await getTenantHeader() },
    body: { status },
  });
  if (error) medicationRedirect(clientId, error.code);
  refresh(clientId);
  redirect(`/clients/${clientId}/medications`);
}

export async function saveMedicationOrderAction(formData: FormData): Promise<void> {
  const clientId = uuid(formData.get('clientId'));
  const orderId = uuid(formData.get('orderId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const input = await orderInput(formData);
  if (!clientId || (orderId && !expectedVersion) || !input) medicationRedirect(clientId, 'MEDICATION_ORDER_INVALID');
  const api = await getApiClient();
  const header = await getTenantHeader();
  const result = orderId
    ? await api.PATCH('/api/v1/medication-orders/{orderId}', {
        params: { path: { orderId }, header },
        body: { ...input, expectedVersion: expectedVersion! },
      })
    : await api.POST('/api/v1/clients/{clientId}/medication-orders', {
        params: { path: { clientId }, header },
        body: input,
      });
  if (result.error) medicationRedirect(clientId, result.error.code);
  refresh(clientId);
  redirect(`/clients/${clientId}/medications`);
}

export async function activateMedicationOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, 'activate');
}

export async function pauseMedicationOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, 'pause');
}

export async function resumeMedicationOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, 'resume');
}

export async function discontinueMedicationOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, 'discontinue');
}

export async function correctMedicationAdministrationAction(formData: FormData): Promise<void> {
  const clientId = uuid(formData.get('clientId'));
  const recordId = uuid(formData.get('recordId'));
  const outcome = choice(formData, 'outcome', ['administered', 'not_administered', 'refused', 'withheld']);
  const amount = text(formData, 'actualDoseAmount');
  const unit = choice(formData, 'actualDoseUnit', ['mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch']);
  const reason = choice(formData, 'reasonCode', ['client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other']);
  const administrationReason = nullableText(formData, 'administrationReason');
  const correctionReason = text(formData, 'correctionReason');
  if (!clientId || !recordId || !outcome || !correctionReason) medicationRedirect(clientId, 'MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
  if (outcome === 'administered' && (!amount || !unit)) medicationRedirect(clientId, 'MEDICATION_ADMINISTRATION_INVALID_DOSE');
  if (outcome !== 'administered' && (!reason || (reason === 'other' && !administrationReason))) medicationRedirect(clientId, 'MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-administrations/{recordId}/corrections', {
    params: { path: { recordId }, header: await getTenantHeader() },
    body: {
      outcome,
      actualDoseAmount: outcome === 'administered' ? amount : null,
      actualDoseUnit: outcome === 'administered' ? unit : null,
      reasonCode: outcome === 'administered' ? null : reason,
      administrationReason,
      note: nullableText(formData, 'note'),
      correctionReason,
    },
  });
  if (error) medicationRedirect(clientId, error.code);
  refresh(clientId);
  redirect(`/clients/${clientId}/medications?corrected=1`);
}

async function transitionOrder(formData: FormData, transition: 'activate' | 'pause' | 'resume' | 'discontinue') {
  const clientId = uuid(formData.get('clientId'));
  const orderId = uuid(formData.get('orderId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  if (!clientId || !orderId || !expectedVersion) medicationRedirect(clientId, 'MEDICATION_ORDER_VERSION_CONFLICT');
  const api = await getApiClient();
  const path = `/api/v1/medication-orders/{orderId}/${transition}` as const;
  const { error } = await api.POST(path, {
    params: { path: { orderId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) medicationRedirect(clientId, error.code);
  refresh(clientId);
  redirect(`/clients/${clientId}/medications`);
}

async function orderInput(formData: FormData) {
  const medicationDefinitionId = uuid(formData.get('medicationDefinitionId'));
  const doseAmount = text(formData, 'doseAmount');
  const doseUnit = choice(formData, 'doseUnit', ['mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch']);
  const route = choice(formData, 'route', ['oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other']);
  const sourceType = choice(formData, 'sourceType', ['prescriber', 'care_authorizing_source', 'staff_transcription']);
  const validFrom = text(formData, 'validFrom');
  const validUntil = text(formData, 'validUntil');
  const scheduleType = text(formData, 'scheduleType');
  if (!medicationDefinitionId || !doseAmount || !doseUnit || !route || !sourceType || !datePattern.test(validFrom) || (validUntil && !datePattern.test(validUntil))) return null;
  const prescribedAtInput = text(formData, 'prescribedAt');
  const clientId = uuid(formData.get('clientId'));
  const timezone = scheduleType === 'interval' || prescribedAtInput
    ? (clientId ? await clientTimezone(clientId) : null)
    : null;
  if ((scheduleType === 'interval' || prescribedAtInput) && !timezone) return null;
  const schedule = await scheduleInput(formData, scheduleType, timezone ?? undefined);
  if (!schedule) return null;
  return {
    medicationDefinitionId,
    doseAmount,
    doseUnit,
    route,
    instructions: nullableText(formData, 'instructions'),
    indication: nullableText(formData, 'indication'),
    prescriberName: nullableText(formData, 'prescriberName'),
    sourceType,
    sourceReference: nullableText(formData, 'sourceReference'),
    prescribedAt: prescribedAtInput ? visitDateTimeFromInput(prescribedAtInput, timezone!) : null,
    validFrom,
    validUntil: validUntil || null,
    schedule,
  };
}

async function scheduleInput(formData: FormData, type: string, timezone?: string) {
  if (type === 'fixed_times') {
    const times = text(formData, 'times').split(',').map((value) => value.trim()).filter(Boolean);
    return times.length > 0 ? { type: 'fixed_times' as const, times } : null;
  }
  if (type === 'interval') {
    const anchorInput = text(formData, 'anchorAt');
    const intervalMinutes = positiveInteger(formData.get('intervalMinutes'));
    if (!timezone || !anchorInput || !intervalMinutes) return null;
    const anchorAt = visitDateTimeFromInput(anchorInput, timezone);
    return anchorAt ? { type: 'interval' as const, anchorAt, intervalMinutes } : null;
  }
  if (type === 'as_needed') {
    const indication = text(formData, 'prnIndication');
    if (!indication) return null;
    const maximumDoseAmount = text(formData, 'maximumDoseAmount');
    const maximumAdministrations = positiveInteger(formData.get('maximumAdministrations'));
    const frequencyWindowMinutes = positiveInteger(formData.get('frequencyWindowMinutes'));
    const minimumIntervalMinutes = positiveInteger(formData.get('minimumIntervalMinutes'));
    if (Boolean(maximumAdministrations) !== Boolean(frequencyWindowMinutes)) return null;
    return {
      type: 'as_needed' as const,
      indication,
      ...(maximumDoseAmount ? { maximumDoseAmount } : {}),
      ...(maximumAdministrations ? { maximumAdministrations } : {}),
      ...(frequencyWindowMinutes ? { frequencyWindowMinutes } : {}),
      ...(minimumIntervalMinutes ? { minimumIntervalMinutes } : {}),
    };
  }
  return null;
}

async function clientTimezone(clientId: string): Promise<string | null> {
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [{ data: client }, { data: facilities }, { data: organizations }] = await Promise.all([
    api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
    api.GET('/api/v1/facilities', { params: { header } }),
    api.GET('/api/v1/organizations', { params: { header } }),
  ]);
  return facilities?.find((facility) => facility.id === client?.primaryFacilityId)?.timezone ??
    organizations?.find((organization) => organization.id === client?.organizationId)?.timezone ??
    null;
}

function medicationRedirect(clientId: string | null, error: string): never {
  redirect(clientId ? `/clients/${clientId}/medications?error=${encodeURIComponent(error)}` : `/clients?error=${encodeURIComponent(error)}`);
}
function refresh(clientId: string): void {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/medications`);
}
function text(formData: FormData, key: string) {
  return (formData.get(key)?.toString() ?? '').trim();
}
function nullableText(formData: FormData, key: string) {
  return text(formData, key) || null;
}
function uuid(value: FormDataEntryValue | null): string | null {
  const parsed = value?.toString() ?? '';
  return uuidPattern.test(parsed) ? parsed : null;
}
function positiveInteger(value: FormDataEntryValue | null): number | null {
  const parsed = Number(value?.toString());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function choice<const Values extends readonly string[]>(formData: FormData, key: string, values: Values): Values[number] | null {
  const value = text(formData, key);
  return values.includes(value) ? value as Values[number] : null;
}
