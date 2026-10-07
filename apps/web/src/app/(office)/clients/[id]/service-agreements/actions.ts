'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const cadenceTypes = [
  'none',
  'daily',
  'weekly',
  'occurrences_per_week',
  'interval_days',
  'on_demand',
] as const;
type ScheduleRule =
  | { type: 'daily' }
  | { type: 'weekly'; weekdays: (typeof weekdays)[number][] }
  | { type: 'occurrences_per_week'; count: number }
  | { type: 'interval_days'; intervalDays: number }
  | { type: 'on_demand' };

export async function createServiceAgreementAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const validFrom = readString(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (!clientId || !validFrom || !datePattern.test(validFrom) || validUntil === undefined) {
    redirect(clientPath(clientId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/clients/{clientId}/service-agreements', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: {
      validFrom,
      validUntil,
      reference: readNullableText(formData, 'reference'),
      description: readNullableText(formData, 'description'),
    },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClientAgreements(clientId);
  redirect(clientPath(clientId, ''));
}

export async function updateServiceAgreementAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const agreementId = readUuid(formData.get('agreementId'));
  const validFrom = readString(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (
    !clientId ||
    !agreementId ||
    !validFrom ||
    !datePattern.test(validFrom) ||
    validUntil === undefined
  ) {
    redirect(clientPath(clientId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/service-agreements/{id}', {
    params: { path: { id: agreementId }, header: await getTenantHeader() },
    body: {
      validFrom,
      validUntil,
      reference: readNullableText(formData, 'reference'),
      description: readNullableText(formData, 'description'),
    },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClientAgreements(clientId);
  redirect(clientPath(clientId, ''));
}

export async function changeServiceAgreementStatusAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const agreementId = readUuid(formData.get('agreementId'));
  const operation = readChoice(formData, 'operation', [
    'activate',
    'suspend',
    'resume',
    'end',
  ] as const);
  if (!clientId || !agreementId || !operation) {
    redirect(clientPath(clientId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const params = { path: { id: agreementId }, header: await getTenantHeader() };
  const response =
    operation === 'activate'
      ? await api.POST('/api/v1/service-agreements/{id}/activate', { params })
      : operation === 'suspend'
        ? await api.POST('/api/v1/service-agreements/{id}/suspend', { params })
        : operation === 'resume'
          ? await api.POST('/api/v1/service-agreements/{id}/resume', { params })
          : await api.POST('/api/v1/service-agreements/{id}/end', { params });
  if (response.error) redirect(clientPath(clientId, response.error.code));
  refreshClientAgreements(clientId);
  redirect(clientPath(clientId, ''));
}

export async function addAgreementServiceAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const agreementId = readUuid(formData.get('agreementId'));
  const serviceDefinitionId = readUuid(formData.get('serviceDefinitionId'));
  const fields = readAgreementServiceFields(formData);
  if (!clientId || !agreementId || !serviceDefinitionId || !fields) {
    redirect(clientPath(clientId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/service-agreements/{id}/services', {
    params: { path: { id: agreementId }, header: await getTenantHeader() },
    body: { serviceDefinitionId, ...fields },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClientAgreements(clientId);
  redirect(clientPath(clientId, ''));
}

export async function updateAgreementServiceAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const agreementId = readUuid(formData.get('agreementId'));
  const serviceId = readUuid(formData.get('serviceId'));
  const fields = readAgreementServiceFields(formData);
  if (!clientId || !agreementId || !serviceId || !fields) {
    redirect(clientPath(clientId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/service-agreements/{id}/services/{serviceId}', {
    params: {
      path: { id: agreementId, serviceId },
      header: await getTenantHeader(),
    },
    body: fields,
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClientAgreements(clientId);
  redirect(clientPath(clientId, ''));
}

export async function endAgreementServiceAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const agreementId = readUuid(formData.get('agreementId'));
  const serviceId = readUuid(formData.get('serviceId'));
  if (!clientId || !agreementId || !serviceId) {
    redirect(clientPath(clientId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/service-agreements/{id}/services/{serviceId}/end', {
    params: {
      path: { id: agreementId, serviceId },
      header: await getTenantHeader(),
    },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClientAgreements(clientId);
  redirect(clientPath(clientId, ''));
}

function readAgreementServiceFields(formData: FormData) {
  const validFrom = readNullableDate(formData, 'validFrom');
  const validUntil = readNullableDate(formData, 'validUntil');
  if (validFrom === undefined || validUntil === undefined) return null;

  const cadence = readChoice(formData, 'cadence', cadenceTypes);
  if (!cadence) return null;
  const scheduleRule = readScheduleRule(formData, cadence);
  if (scheduleRule === undefined) return null;

  const preferredTimeStart = readNullableTime(formData, 'preferredTimeStart');
  const preferredTimeEnd = readNullableTime(formData, 'preferredTimeEnd');
  if (
    preferredTimeStart === undefined ||
    preferredTimeEnd === undefined ||
    (preferredTimeStart === null) !== (preferredTimeEnd === null) ||
    (preferredTimeStart !== null &&
      preferredTimeEnd !== null &&
      preferredTimeStart >= preferredTimeEnd)
  ) {
    return null;
  }

  return {
    validFrom,
    validUntil,
    quantity: readNullableText(formData, 'quantity'),
    note: readNullableText(formData, 'note'),
    scheduleRule,
    preferredTimeStart,
    preferredTimeEnd,
  };
}

function readScheduleRule(
  formData: FormData,
  cadence: (typeof cadenceTypes)[number],
): ScheduleRule | null | undefined {
  switch (cadence) {
    case 'none':
      return null;
    case 'daily':
      return { type: 'daily' };
    case 'weekly': {
      const selectedWeekdays = readChoices(formData, 'weekdays', weekdays);
      return selectedWeekdays.length ? { type: 'weekly', weekdays: selectedWeekdays } : undefined;
    }
    case 'occurrences_per_week': {
      const count = readInteger(formData, 'count');
      return count && count >= 1 && count <= 14
        ? { type: 'occurrences_per_week', count }
        : undefined;
    }
    case 'interval_days': {
      const intervalDays = readInteger(formData, 'intervalDays');
      return intervalDays && intervalDays >= 1 && intervalDays <= 365
        ? { type: 'interval_days', intervalDays }
        : undefined;
    }
    case 'on_demand':
      return { type: 'on_demand' };
  }
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableText(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

function readNullableDate(formData: FormData, name: string): string | null | undefined {
  const value = readString(formData, name);
  if (!value) return null;
  return datePattern.test(value) ? value : undefined;
}

function readNullableTime(formData: FormData, name: string): string | null | undefined {
  const value = readString(formData, name);
  if (!value) return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
}

function readInteger(formData: FormData, name: string): number | undefined {
  const value = readString(formData, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readUuid(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = value.trim();
  return uuidPattern.test(parsed) ? parsed : undefined;
}

function readChoice<const Values extends readonly string[]>(
  formData: FormData,
  name: string,
  choices: Values,
): Values[number] | undefined {
  const value = readString(formData, name);
  return choices.includes(value) ? (value as Values[number]) : undefined;
}

function readChoices<const Values extends readonly string[]>(
  formData: FormData,
  name: string,
  choices: Values,
): Values[number][] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .filter((value): value is string => typeof value === 'string')
        .filter((value): value is Values[number] => choices.includes(value)),
    ),
  ];
}

function clientPath(clientId: string | undefined, error: string): string {
  if (!clientId) return '/clients?error=INVALID_REQUEST';
  return error
    ? `/clients/${encodeURIComponent(clientId)}/service-agreements?error=${encodeURIComponent(error)}`
    : `/clients/${encodeURIComponent(clientId)}/service-agreements`;
}

function refreshClientAgreements(clientId: string): void {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/service-agreements`);
}
