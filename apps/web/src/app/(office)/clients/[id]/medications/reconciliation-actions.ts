'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { localDateTimeToInstant } from '@care/scheduling';
import { v7 as uuidv7 } from 'uuid';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';

export async function startMedicationReconciliationAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  if (!clientId) redirect('/clients?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/clients/{clientId}/medication-reconciliations', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: { reason: readText(formData, 'reason') as never },
  });
  if (error || !data) redirectToClient(clientId, undefined, error?.code ?? 'MEDICATION_RECONCILIATION_INVALID');
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, data.reconciliation.id);
}

export async function addMedicationReconciliationSourceAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  if (!clientId || !reconciliationId) redirect('/clients?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/sources', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: {
      expectedVersion: readVersion(formData),
      sourceType: readText(formData, 'sourceType') as never,
      sourceName: nullableText(formData, 'sourceName'),
      sourceDate: nullableText(formData, 'sourceDate'),
      reference: nullableText(formData, 'reference'),
    },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function addMedicationReconciliationEntryAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  const sourceId = readUuid(formData, 'sourceId');
  if (!clientId || !reconciliationId || !sourceId) redirect('/clients?error=INVALID_REQUEST');
  const structuredSchedule = scheduleFromForm(formData);
  if (structuredSchedule === invalidSchedule) {
    redirectToClient(clientId, reconciliationId, 'MEDICATION_RECONCILIATION_ENTRY_INVALID');
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/entries', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: {
      expectedVersion: readVersion(formData),
      sourceId,
      supersedesEntryId: nullableUuid(formData, 'supersedesEntryId'),
      correctionReason: nullableText(formData, 'correctionReason'),
      medicationName: readText(formData, 'medicationName'),
      activeIngredient: nullableText(formData, 'activeIngredient'),
      strength: nullableText(formData, 'strength'),
      dosageForm: nullableText(formData, 'dosageForm') as never,
      doseAmount: nullableText(formData, 'doseAmount'),
      doseUnit: nullableText(formData, 'doseUnit') as never,
      route: nullableText(formData, 'route') as never,
      scheduleDescription: nullableText(formData, 'scheduleDescription'),
      structuredSchedule: structuredSchedule as never,
      reportedStatus: readText(formData, 'reportedStatus') as never,
      note: nullableText(formData, 'note'),
    },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function matchMedicationReconciliationEntryAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  const entryId = readUuid(formData, 'entryId');
  if (!clientId || !reconciliationId || !entryId) redirect('/clients?error=INVALID_REQUEST');
  const baselineId = nullableUuid(formData, 'baselineId');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/matches', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: { expectedVersion: readVersion(formData), entryId, baselineId },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function compareMedicationReconciliationAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  if (!clientId || !reconciliationId) redirect('/clients?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/compare', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: { expectedVersion: readVersion(formData) },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function recordMedicationReconciliationDecisionAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  const discrepancyId = readUuid(formData, 'discrepancyId');
  if (!clientId || !reconciliationId || !discrepancyId) redirect('/clients?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/decisions', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: {
      expectedVersion: readVersion(formData),
      discrepancyId,
      decision: readText(formData, 'decision') as never,
      reason: nullableText(formData, 'reason'),
      clarificationOutcome: nullableText(formData, 'clarificationOutcome'),
    },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function applyMedicationReconciliationAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  const actionId = readUuid(formData, 'actionId');
  if (!clientId || !reconciliationId || !actionId) redirect('/clients?error=INVALID_REQUEST');
  const items = formData.getAll('discrepancyId').flatMap((value) => {
    if (typeof value !== 'string' || !isUuid(value)) return [];
    const disposition = readText(formData, `disposition:${value}`);
    if (disposition !== 'apply_external' && disposition !== 'not_applied') return [];
    return [{
      discrepancyId: value,
      disposition,
      reason: disposition === 'not_applied' ? nullableText(formData, `reason:${value}`) : null,
    }];
  });
  if (items.length === 0) redirectToClient(clientId, reconciliationId, 'MEDICATION_RECONCILIATION_APPLICATION_INVALID');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/apply', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: { expectedVersion: readVersion(formData), actionId, items: items as never },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function completeMedicationReconciliationAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  if (!clientId || !reconciliationId) redirect('/clients?error=INVALID_REQUEST');
  if (readText(formData, 'confirm') !== 'yes') redirectToClient(clientId, reconciliationId, 'INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/complete', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: { expectedVersion: readVersion(formData) },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function cancelMedicationReconciliationAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData, 'clientId');
  const reconciliationId = readUuid(formData, 'reconciliationId');
  if (!clientId || !reconciliationId) redirect('/clients?error=INVALID_REQUEST');
  if (readText(formData, 'confirm') !== 'yes') redirectToClient(clientId, reconciliationId, 'INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/medication-reconciliations/{reconciliationId}/cancel', {
    params: { path: { reconciliationId }, header: await getTenantHeader() },
    body: { expectedVersion: readVersion(formData), reason: nullableText(formData, 'reason') },
  });
  if (error) redirectToClient(clientId, reconciliationId, error.code);
  revalidatePath(`/clients/${clientId}/medications`);
  redirectToClient(clientId, reconciliationId);
}

export async function newMedicationReconciliationActionId(): Promise<string> {
  return uuidv7();
}

const invalidSchedule = Symbol('invalid-schedule');
function scheduleFromForm(formData: FormData): Record<string, unknown> | null | typeof invalidSchedule {
  const type = readText(formData, 'scheduleType');
  if (!type || type === 'unknown') return null;
  const timezone = readText(formData, 'scheduleTimezone');
  if (!timezone) return invalidSchedule;
  if (type === 'fixed_times') {
    const times = readText(formData, 'times').split(',').map((time) => time.trim()).filter(Boolean);
    return times.length ? { type, times, timezone } : invalidSchedule;
  }
  if (type === 'interval') {
    const localValue = readText(formData, 'anchorAt');
    const [date, time] = localValue.split('T');
    const intervalMinutes = Number(readText(formData, 'intervalMinutes'));
    try {
      const anchor = date && time ? localDateTimeToInstant(date, time, timezone, 'earlier') : null;
      return anchor && Number.isInteger(intervalMinutes)
        ? { type, anchorAt: anchor.toISOString(), intervalMinutes, timezone }
        : invalidSchedule;
    } catch {
      return invalidSchedule;
    }
  }
  if (type === 'as_needed') {
    const indication = readText(formData, 'indication');
    if (!indication) return invalidSchedule;
    return {
      type,
      indication,
      timezone,
      ...optionalNumber(formData, 'maximumDoseAmount', true),
      ...optionalNumber(formData, 'maximumAdministrations'),
      ...optionalNumber(formData, 'frequencyWindowMinutes'),
      ...optionalNumber(formData, 'minimumIntervalMinutes'),
    };
  }
  return invalidSchedule;
}

function optionalNumber(formData: FormData, name: string, decimal = false): Record<string, string | number> {
  const value = readText(formData, name);
  if (!value) return {};
  if (decimal) return { [name]: value };
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? { [name]: parsed } : { [name]: Number.NaN };
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(formData: FormData, name: string): string | null {
  return readText(formData, name) || null;
}

function readVersion(formData: FormData): number {
  const version = Number(readText(formData, 'expectedVersion'));
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function readUuid(formData: FormData, name: string): string | null {
  const value = readText(formData, name);
  return isUuid(value) ? value : null;
}

function nullableUuid(formData: FormData, name: string): string | null {
  const value = readText(formData, name);
  return value ? (isUuid(value) ? value : null) : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function redirectToClient(clientId: string, reconciliationId?: string, error?: string): never {
  const query = new URLSearchParams();
  if (reconciliationId) query.set('reconciliationId', reconciliationId);
  if (error) query.set('error', error);
  const suffix = query.size ? `?${query.toString()}` : '';
  redirect(`/clients/${clientId}/medications${suffix}`);
}
