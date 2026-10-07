'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createVisitAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const localDate = readString(formData, 'localDate');
  const localStartTime = readString(formData, 'localStartTime');
  const localEndTime = readString(formData, 'localEndTime');
  const serviceDefinitionIds = readUuids(formData, 'serviceDefinitionIds').slice(0, 20);
  const employeeId = readUuid(formData.get('employeeId'));
  if (
    !clientId ||
    !datePattern.test(localDate) ||
    !timePattern.test(localStartTime) ||
    !timePattern.test(localEndTime) ||
    localEndTime <= localStartTime ||
    serviceDefinitionIds.length === 0
  ) {
    redirect('/planning?error=INVALID_REQUEST');
  }

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits', {
    params: { header: await getTenantHeader() },
    body: {
      clientId,
      localDate,
      localStartTime,
      localEndTime,
      services: serviceDefinitionIds.map((serviceDefinitionId) => ({
        serviceDefinitionId,
        plannedQuantity: '1',
      })),
      ...(employeeId ? { employeeIds: [employeeId] } : {}),
      note: readNullableText(formData, 'note'),
    },
  });
  if (error) redirect(`/planning?date=${localDate}&error=${encodeURIComponent(error.code)}`);
  revalidatePath('/planning');
  revalidatePath(`/clients/${clientId}`);
  if (employeeId) revalidatePath(`/employees/${employeeId}`);
  redirect(`/planning?date=${localDate}&updated=visit`);
}

export async function updateVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const localDate = readString(formData, 'localDate');
  const localStartTime = readString(formData, 'localStartTime');
  const localEndTime = readString(formData, 'localEndTime');
  if (
    !visitId ||
    !datePattern.test(localDate) ||
    !timePattern.test(localStartTime) ||
    !timePattern.test(localEndTime) ||
    localEndTime <= localStartTime
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/visits/{id}', {
    params: { path: { id: visitId }, header: await getTenantHeader() },
    body: {
      localDate,
      localStartTime,
      localEndTime,
      note: readNullableText(formData, 'note'),
    },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  redirect(`/visits/${visitId}?updated=updated`);
}

export async function assignVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const employeeId = readUuid(formData.get('employeeId'));
  if (!visitId || !employeeId) redirect(visitPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{id}/assignments', {
    params: { path: { id: visitId }, header: await getTenantHeader() },
    body: { employeeId },
  });
  if (error) {
    const params = new URLSearchParams({ error: error.code });
    const interval = error.conflictingInterval;
    if (
      error.code === 'VISIT_EMPLOYEE_CONFLICT' &&
      interval?.plannedStart &&
      interval.plannedEnd &&
      interval.timezone
    ) {
      params.set('employeeId', employeeId);
      params.set('conflictStart', interval.plannedStart);
      params.set('conflictEnd', interval.plannedEnd);
      params.set('conflictTimezone', interval.timezone);
    }
    redirect(`/visits/${visitId}?${params.toString()}`);
  }
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  redirect(`/visits/${visitId}?updated=assigned`);
}

export async function unassignVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const assignmentId = readUuid(formData.get('assignmentId'));
  if (!visitId || !assignmentId) redirect(visitPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/visits/{id}/assignments/{assignmentId}', {
    params: {
      path: { id: visitId, assignmentId },
      header: await getTenantHeader(),
    },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  redirect(`/visits/${visitId}?updated=unassigned`);
}

export async function changeVisitStatusAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const operation = readString(formData, 'operation');
  if (!visitId || !['confirm', 'unconfirm', 'cancel'].includes(operation)) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const options = { params: { path: { id: visitId }, header: await getTenantHeader() } };
  const response =
    operation === 'confirm'
      ? await api.POST('/api/v1/visits/{id}/confirm', options)
      : operation === 'unconfirm'
        ? await api.POST('/api/v1/visits/{id}/unconfirm', options)
        : await api.POST('/api/v1/visits/{id}/cancel', options);
  if (response.error) redirect(visitPath(visitId, response.error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  redirect(`/visits/${visitId}?updated=${operation === 'cancel' ? 'cancelled' : 'updated'}`);
}

export async function generateAgreementVisitsAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const agreementId = readUuid(formData.get('agreementId'));
  const from = readString(formData, 'from');
  const until = readString(formData, 'until');
  if (
    !clientId ||
    !agreementId ||
    !datePattern.test(from) ||
    !datePattern.test(until) ||
    until < from
  ) {
    redirect(agreementPath(clientId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/service-agreements/{id}/generate-visits', {
    params: { path: { id: agreementId }, header: await getTenantHeader() },
    body: { from, until },
  });
  if (error || !data) redirect(agreementPath(clientId, error?.code ?? 'GENERATION_FAILED'));
  revalidatePath('/planning');
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/service-agreements`);
  redirect(
    `${agreementPath(clientId, '')}?generated=${data.generated}&existing=${data.alreadyExisting}&placement=${data.requiresManualPlacement}`,
  );
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableText(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

function readUuid(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string' || !uuidPattern.test(value.trim())) return undefined;
  return value.trim();
}

function readUuids(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => uuidPattern.test(value)),
    ),
  ];
}

function visitPath(visitId: string | undefined, message: string): string {
  return visitId
    ? `/visits/${visitId}?error=${encodeURIComponent(message)}`
    : '/planning?error=INVALID_REQUEST';
}

function agreementPath(clientId: string | undefined, message: string): string {
  return clientId
    ? `/clients/${clientId}/service-agreements${message ? `?error=${encodeURIComponent(message)}` : ''}`
    : '/clients?error=INVALID_REQUEST';
}
