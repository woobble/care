'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { safePlanningReturnTo } from '@app/web/lib/planning-return-to';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

export async function correctVisitExecutionTimesAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const clientId = readUuid(formData.get('clientId'));
  const executionId = readUuid(formData.get('executionId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const timezone = readString(formData, 'timezone');
  const actualStart = zonedLocalDateTimeToIso(readString(formData, 'actualStart'), timezone);
  const actualEndInput = readString(formData, 'actualEnd');
  const actualEnd = actualEndInput ? zonedLocalDateTimeToIso(actualEndInput, timezone) : null;
  const reason = readString(formData, 'reason');
  if (
    !visitId ||
    !clientId ||
    !executionId ||
    !expectedVersion ||
    !actualStart ||
    (actualEndInput && !actualEnd) ||
    !reason
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visit-executions/{id}/correct-times', {
    params: { path: { id: executionId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      actualStart,
      ...(actualEnd ? { actualEnd } : {}),
      reason,
    },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/care/visits/${visitId}`);
  redirect(`/visits/${visitId}?updated=times_corrected`);
}

export async function createVisitAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const rawAdmissionCaseId = readString(formData, 'admissionCaseId');
  const admissionCaseId = rawAdmissionCaseId
    ? readUuid(formData.get('admissionCaseId'))
    : undefined;
  const expectedAdmissionVersion = rawAdmissionCaseId
    ? readPositiveInteger(formData.get('expectedAdmissionVersion'))
    : undefined;
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
    serviceDefinitionIds.length === 0 ||
    (rawAdmissionCaseId && (!admissionCaseId || !expectedAdmissionVersion))
  ) {
    redirect('/planning?error=INVALID_REQUEST');
  }

  const api = await getApiClient();
  const header = await getTenantHeader();
  if (admissionCaseId && expectedAdmissionVersion) {
    const caseResult = await api.GET('/api/v1/onboarding/cases/{id}', {
      params: { path: { id: admissionCaseId }, header },
    });
    const admission = caseResult.data as unknown as
      | { clientId: string | null; version: number; stage: string }
      | undefined;
    if (caseResult.error)
      redirect(`/admissions/${admissionCaseId}?error=${encodeURIComponent(caseResult.error.code)}`);
    if (
      !admission ||
      admission.clientId !== clientId ||
      admission.version !== expectedAdmissionVersion
    ) {
      redirect(`/admissions/${admissionCaseId}?error=ONBOARDING_VERSION_CONFLICT`);
    }
    if (['declined', 'withdrawn'].includes(admission.stage))
      redirect(`/admissions/${admissionCaseId}?error=ONBOARDING_CASE_CLOSED`);
    if (!['preparation', 'ready_for_admission', 'admitted'].includes(admission.stage))
      redirect(`/admissions/${admissionCaseId}?error=ONBOARDING_FIRST_VISIT_STAGE_INVALID`);
  }
  const { data: visit, error } = await api.POST('/api/v1/visits', {
    params: { header },
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
  if (error || !visit) {
    const code = error?.code ?? 'SCHEDULING_VISIT_NOT_FOUND';
    redirect(
      admissionCaseId
        ? `/planning?admissionCaseId=${admissionCaseId}&clientId=${clientId}&date=${localDate}&error=${encodeURIComponent(code)}`
        : `/planning?date=${localDate}&error=${encodeURIComponent(code)}`,
    );
  }
  revalidatePath('/planning');
  revalidatePath(`/clients/${clientId}`);
  if (employeeId) revalidatePath(`/employees/${employeeId}`);
  if (admissionCaseId && expectedAdmissionVersion) {
    const { error: linkError } = await api.POST('/api/v1/onboarding/cases/{id}/first-visit', {
      params: { path: { id: admissionCaseId }, header },
      body: { visitId: visit.id, expectedVersion: expectedAdmissionVersion },
    });
    revalidatePath(`/admissions/${admissionCaseId}`);
    if (linkError)
      redirect(
        `/admissions/${admissionCaseId}?createdVisitId=${visit.id}&error=${encodeURIComponent(linkError.code)}`,
      );
    redirect(`/admissions/${admissionCaseId}?updated=first_visit`);
  }
  redirect(`/planning?date=${localDate}&updated=visit`);
}

export async function updateVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const localDate = readString(formData, 'localDate');
  const localStartTime = readString(formData, 'localStartTime');
  const localEndTime = readString(formData, 'localEndTime');
  const returnTo = safePlanningReturnTo(readString(formData, 'returnTo'));
  if (
    !visitId ||
    !datePattern.test(localDate) ||
    !timePattern.test(localStartTime) ||
    !timePattern.test(localEndTime) ||
    localEndTime <= localStartTime
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST', returnTo));
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
  if (error) redirect(visitPath(visitId, error.code, returnTo));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  const params = new URLSearchParams({ updated: 'updated' });
  if (returnTo) params.set('returnTo', returnTo);
  redirect(`/visits/${visitId}?${params.toString()}`);
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

export async function proposeSubstitutionAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const originalAssignmentId = readUuid(formData.get('originalAssignmentId'));
  const substituteEmployeeId = readUuid(formData.get('substituteEmployeeId'));
  const reason = readString(formData, 'reason').slice(0, 500);
  if (!visitId || !originalAssignmentId || !substituteEmployeeId || !reason) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{id}/substitutions', {
    params: { path: { id: visitId }, header: await getTenantHeader() },
    body: { originalAssignmentId, substituteEmployeeId, reason },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  redirect(`${visitPath(visitId, '')}?updated=substitution_proposed`);
}

export async function confirmSubstitutionAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const substitutionId = readUuid(formData.get('substitutionId'));
  if (!visitId || !substitutionId) redirect(visitPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/substitutions/{id}/confirm', {
    params: { path: { id: substitutionId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  revalidatePath('/care/today');
  redirect(`${visitPath(visitId, '')}?updated=substitution_confirmed`);
}

export async function cancelSubstitutionAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const substitutionId = readUuid(formData.get('substitutionId'));
  if (!visitId || !substitutionId) redirect(visitPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/substitutions/{id}/cancel', {
    params: { path: { id: substitutionId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/planning');
  revalidatePath(`/visits/${visitId}`);
  redirect(`${visitPath(visitId, '')}?updated=substitution_cancelled`);
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

export async function createTourAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const localDate = readString(formData, 'localDate');
  const timezone = readString(formData, 'timezone');
  const visitIds = readUuids(formData, 'visitIds').slice(0, 100);
  if (!employeeId || !datePattern.test(localDate) || !timezone || !visitIds.length) {
    redirect(planningTourPath(localDate, employeeId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/scheduling/tours', {
    params: { header: await getTenantHeader() },
    body: { employeeId, localDate, timezone, visitIds },
  });
  if (error || !data)
    redirect(planningTourPath(localDate, employeeId, error?.code ?? 'CREATE_FAILED'));
  revalidatePath('/planning');
  revalidatePath('/care/today');
  redirect(planningTourPath(localDate, employeeId, 'tour_created', data.id));
}

export async function updateTourStopsAction(formData: FormData): Promise<void> {
  const tourId = readUuid(formData.get('tourId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const localDate = readString(formData, 'localDate');
  const employeeId = readUuid(formData.get('employeeId'));
  const visitIds = readUuids(formData, 'visitId').slice(0, 100);
  const notes = formData
    .getAll('dispatcherNote')
    .map((value) => (typeof value === 'string' ? value.trim().slice(0, 500) : ''));
  if (
    !tourId ||
    !expectedVersion ||
    !visitIds.length ||
    new Set(visitIds).size !== visitIds.length
  ) {
    redirect(planningTourPath(localDate, employeeId, 'INVALID_REQUEST', tourId));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/scheduling/tours/{id}/stops', {
    params: { path: { id: tourId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      stops: visitIds.map((visitId, index) => ({
        visitId,
        ...(notes[index] ? { dispatcherNote: notes[index] } : {}),
      })),
    },
  });
  if (error) redirect(planningTourPath(localDate, employeeId, error.code, tourId));
  revalidatePath('/planning');
  redirect(planningTourPath(localDate, employeeId, 'tour_reordered', tourId));
}

export async function estimateTourRouteAction(formData: FormData): Promise<void> {
  const tourId = readUuid(formData.get('tourId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const localDate = readString(formData, 'localDate');
  const employeeId = readUuid(formData.get('employeeId'));
  if (!tourId || !expectedVersion)
    redirect(planningTourPath(localDate, employeeId, 'INVALID_REQUEST', tourId));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/scheduling/tours/{id}/estimate-travel', {
    params: { path: { id: tourId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(planningTourPath(localDate, employeeId, error.code, tourId));
  revalidatePath('/planning');
  redirect(planningTourPath(localDate, employeeId, 'travel_estimated', tourId));
}

export async function suggestTourOrderAction(formData: FormData): Promise<void> {
  const tourId = readUuid(formData.get('tourId'));
  const localDate = readString(formData, 'localDate');
  const employeeId = readUuid(formData.get('employeeId'));
  if (!tourId) redirect(planningTourPath(localDate, employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/scheduling/tours/{id}/suggest-order', {
    params: { path: { id: tourId }, header: await getTenantHeader() },
  });
  if (error || !data)
    redirect(planningTourPath(localDate, employeeId, error?.code ?? 'ROUTE_UNAVAILABLE', tourId));
  const path = new URLSearchParams({
    date: localDate,
    view: 'day',
    employeeId: employeeId ?? '',
    suggestedTourId: tourId,
    suggestedOrder: data.visitIds.join(','),
  });
  redirect(`/planning?${path.toString()}`);
}

export async function applySuggestedTourOrderAction(formData: FormData): Promise<void> {
  const tourId = readUuid(formData.get('tourId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const localDate = readString(formData, 'localDate');
  const employeeId = readUuid(formData.get('employeeId'));
  const visitIds = readUuids(formData, 'visitIds').slice(0, 100);
  if (
    !tourId ||
    !expectedVersion ||
    !visitIds.length ||
    new Set(visitIds).size !== visitIds.length
  ) {
    redirect(planningTourPath(localDate, employeeId, 'INVALID_REQUEST', tourId));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/scheduling/tours/{id}/stops', {
    params: { path: { id: tourId }, header: await getTenantHeader() },
    body: { expectedVersion, stops: visitIds.map((visitId) => ({ visitId })) },
  });
  if (error) redirect(planningTourPath(localDate, employeeId, error.code, tourId));
  revalidatePath('/planning');
  redirect(planningTourPath(localDate, employeeId, 'tour_reordered', tourId));
}

export async function publishTourAction(formData: FormData): Promise<void> {
  const tourId = readUuid(formData.get('tourId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const localDate = readString(formData, 'localDate');
  const employeeId = readUuid(formData.get('employeeId'));
  if (!tourId || !expectedVersion)
    redirect(planningTourPath(localDate, employeeId, 'INVALID_REQUEST', tourId));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/scheduling/tours/{id}/publish', {
    params: { path: { id: tourId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(planningTourPath(localDate, employeeId, error.code, tourId));
  revalidatePath('/planning');
  revalidatePath('/care/today');
  redirect(planningTourPath(localDate, employeeId, 'tour_published', tourId));
}

function planningTourPath(
  localDate: string,
  employeeId: string | undefined,
  status: string,
  tourId?: string,
): string {
  const query = new URLSearchParams({ view: 'day' });
  if (datePattern.test(localDate)) query.set('date', localDate);
  if (
    status &&
    status !== 'tour_created' &&
    status !== 'tour_reordered' &&
    status !== 'travel_estimated' &&
    status !== 'tour_published'
  ) {
    query.set('error', status);
  } else if (status) {
    query.set('updated', status);
  }
  if (employeeId) query.set('employeeId', employeeId);
  if (tourId) query.set('tourId', tourId);
  return `/planning?${query.toString()}`;
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveInteger(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function zonedLocalDateTimeToIso(value: string, timezone: string): string | null {
  const match = localDateTimePattern.exec(value);
  if (!match) return null;
  const target = match.slice(1).map(Number);
  const targetMillis = Date.UTC(target[0]!, target[1]! - 1, target[2]!, target[3]!, target[4]!);
  const targetTuple = target.join('-');
  try {
    const offsets = new Set<number>();
    for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
      const probe = targetMillis + hours * 60 * 60 * 1000;
      const parts = zonedDateParts(new Date(probe), timezone);
      offsets.add(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!) - probe);
    }
    const candidates = [...offsets]
      .map((offset) => targetMillis - offset)
      .filter(
        (candidate) => zonedDateParts(new Date(candidate), timezone).join('-') === targetTuple,
      );
    return candidates.length === 1 ? new Date(candidates[0]!).toISOString() : null;
  } catch {
    return null;
  }
}

function zonedDateParts(value: Date, timezone: string): number[] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return [part('year'), part('month'), part('day'), part('hour'), part('minute')];
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

function visitPath(visitId: string | undefined, message: string, returnTo?: string | null): string {
  if (!visitId) return '/planning?error=INVALID_REQUEST';
  const params = new URLSearchParams({ error: message });
  if (returnTo) params.set('returnTo', returnTo);
  return `/visits/${visitId}?${params.toString()}`;
}

function agreementPath(clientId: string | undefined, message: string): string {
  return clientId
    ? `/clients/${clientId}/service-agreements${message ? `?error=${encodeURIComponent(message)}` : ''}`
    : '/clients?error=INVALID_REQUEST';
}
