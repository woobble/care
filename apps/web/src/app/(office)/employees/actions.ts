'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function createEmployeeAction(formData: FormData): Promise<void | boolean> {
  const organizationId = readUuid(formData.get('organizationId'));
  const firstName = readText(formData, 'firstName');
  const lastName = readText(formData, 'lastName');
  const weeklyHours = readNumber(formData, 'weeklyHours');
  const startDate = readDate(formData, 'startDate');
  const endDate = readDate(formData, 'endDate');
  if (
    !organizationId ||
    !firstName ||
    !lastName ||
    weeklyHours === undefined ||
    startDate === undefined ||
    endDate === undefined
  ) {
    return false;
  }
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/employees', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      firstName,
      lastName,
      preferredName: readNullableText(formData, 'preferredName'),
      email: readNullableText(formData, 'email'),
      phone: readNullableText(formData, 'phone'),
      personnelNumber: readNullableText(formData, 'personnelNumber'),
      employmentType: readNullableText(formData, 'employmentType'),
      startDate,
      endDate,
      weeklyHours,
    },
  });
  if (error || !data) return false;
  revalidatePath('/employees');
  redirect(`/employees/${data.id}`);
}

export async function updateEmployeeAction(formData: FormData): Promise<void | boolean> {
  const id = readUuid(formData.get('id'));
  const firstName = readText(formData, 'firstName');
  const lastName = readText(formData, 'lastName');
  const weeklyHours = readNumber(formData, 'weeklyHours');
  const startDate = readDate(formData, 'startDate');
  const endDate = readDate(formData, 'endDate');
  if (
    !id ||
    !firstName ||
    !lastName ||
    weeklyHours === undefined ||
    startDate === undefined ||
    endDate === undefined
  ) {
    return false;
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/employees/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      firstName,
      lastName,
      preferredName: readNullableText(formData, 'preferredName'),
      email: readNullableText(formData, 'email'),
      phone: readNullableText(formData, 'phone'),
      personnelNumber: readNullableText(formData, 'personnelNumber'),
      employmentType: readNullableText(formData, 'employmentType'),
      startDate,
      endDate,
      weeklyHours,
    },
  });
  if (error) return false;
  revalidatePath('/employees');
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}?updated=employee`);
}

export async function saveEmployeeAvailabilityAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const expectedVersion = readInteger(formData, 'expectedVersion', 0, Number.MAX_SAFE_INTEGER);
  const timezone = readText(formData, 'timezone');
  const maxDailyText = readText(formData, 'maxDailyMinutes');
  const parsedMaxDailyMinutes = maxDailyText
    ? readInteger(formData, 'maxDailyMinutes', 1, 1440)
    : null;
  const travelBufferMinutes = readInteger(formData, 'travelBufferMinutes', 0, 240);
  if (
    !employeeId ||
    expectedVersion === undefined ||
    !timezone ||
    parsedMaxDailyMinutes === undefined ||
    travelBufferMinutes === undefined
  ) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const maxDailyMinutes = parsedMaxDailyMinutes;

  const windows: Array<{ weekday: number; startsAt: string; endsAt: string }> = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (let slot = 1; slot <= 4; slot += 1) {
      const startsAt = readText(formData, `window_${weekday}_${slot}_start`);
      const endsAt = readText(formData, `window_${weekday}_${slot}_end`);
      if (!startsAt && !endsAt) continue;
      if (!validTime(startsAt) || !validTime(endsAt) || startsAt === endsAt) {
        redirect(employeePath(employeeId, 'INVALID_EMPLOYEE_AVAILABILITY'));
      }
      windows.push({ weekday, startsAt, endsAt });
    }
  }

  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{employeeId}/availability', {
    params: { path: { employeeId }, header: await getTenantHeader() },
    body: { expectedVersion, timezone, maxDailyMinutes, travelBufferMinutes, windows },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  revalidatePath('/planning');
  revalidatePath('/care/today');
  redirect(`/employees/${employeeId}?updated=availability`);
}

export async function createAvailabilityExceptionAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const expectedVersion = readInteger(formData, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  const localDate = readDate(formData, 'localDate');
  const kind = readText(formData, 'kind');
  const startsAt = readText(formData, 'startsAt');
  const endsAt = readText(formData, 'endsAt');
  if (
    !employeeId ||
    expectedVersion === undefined ||
    !localDate ||
    (kind !== 'working_hours' && kind !== 'closed' && kind !== 'unavailable')
  ) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const isClosed = kind === 'closed';
  if (!isClosed && startsAt !== '' && !validTime(startsAt)) {
    redirect(employeePath(employeeId, 'INVALID_EMPLOYEE_AVAILABILITY'));
  }
  if (!isClosed && endsAt !== '' && !validTime(endsAt)) {
    redirect(employeePath(employeeId, 'INVALID_EMPLOYEE_AVAILABILITY'));
  }
  const timePair: [string | null, string | null] = isClosed
    ? [null, null]
    : [startsAt || null, endsAt || null];
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/employees/{employeeId}/availability/exceptions', {
    params: { path: { employeeId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      localDate,
      kind,
      startsAt: timePair[0],
      endsAt: timePair[1],
    },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/planning');
  redirect(`/employees/${employeeId}?updated=availability`);
}

export async function deleteAvailabilityExceptionAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const exceptionId = readUuid(formData.get('exceptionId'));
  const expectedVersion = readInteger(formData, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  if (!employeeId || !exceptionId || expectedVersion === undefined) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.DELETE(
    '/api/v1/employees/{employeeId}/availability/exceptions/{exceptionId}',
    {
      params: {
        path: { employeeId, exceptionId },
        query: { expectedVersion },
        header: await getTenantHeader(),
      },
    },
  );
  if (error) redirect(employeePath(employeeId, error.code));
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/planning');
  redirect(`/employees/${employeeId}?updated=availability`);
}

export async function createEmployeeAbsenceAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const localStart = readText(formData, 'localStart');
  const localEnd = readText(formData, 'localEnd');
  const timezone = readText(formData, 'timezone');
  const reason = readText(formData, 'reason');
  const localStartParts = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T(([01][0-9]|2[0-3]):[0-5][0-9])$/.exec(
    localStart,
  );
  const localEndParts = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T(([01][0-9]|2[0-3]):[0-5][0-9])$/.exec(
    localEnd,
  );
  if (
    !employeeId ||
    !localStartParts ||
    !localEndParts ||
    !timezone ||
    !['vacation', 'sick_leave', 'training', 'personal_unavailability', 'other'].includes(reason)
  ) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/employees/{employeeId}/unavailability', {
    params: { path: { employeeId }, header: await getTenantHeader() },
    body: {
      localStartDate: localStartParts[1]!,
      localStartTime: localStartParts[2]!,
      localEndDate: localEndParts[1]!,
      localEndTime: localEndParts[2]!,
      timezone,
      reason: reason as
        | 'vacation'
        | 'sick_leave'
        | 'training'
        | 'personal_unavailability'
        | 'other',
      note: readNullableText(formData, 'note'),
    },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/planning');
  revalidatePath('/care/today');
  redirect(`/employees/${employeeId}?updated=absence`);
}

export async function cancelEmployeeAbsenceAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const absenceId = readUuid(formData.get('absenceId'));
  if (!employeeId || !absenceId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/employees/{employeeId}/unavailability/{absenceId}', {
    params: { path: { employeeId, absenceId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/planning');
  revalidatePath('/care/today');
  redirect(`/employees/${employeeId}?updated=absence`);
}

export async function saveEmployeeSchedulingPreferencesAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const preferredWeekdays = readIntegerValues(formData, 'preferredWeekdays', 1, 7);
  const latitudeText = readText(formData, 'preferredStartLatitude');
  const longitudeText = readText(formData, 'preferredStartLongitude');
  const preferredStartLatitude = latitudeText ? readCoordinate(latitudeText, -90, 90) : null;
  const preferredStartLongitude = longitudeText ? readCoordinate(longitudeText, -180, 180) : null;
  const preferredTimeWindows: Array<{ startsAt: string; endsAt: string }> = [];
  for (let slot = 1; slot <= 4; slot += 1) {
    const startsAt = readText(formData, `preferredWindow${slot}Start`);
    const endsAt = readText(formData, `preferredWindow${slot}End`);
    if (!startsAt && !endsAt) continue;
    if (!validTime(startsAt) || !validTime(endsAt) || startsAt >= endsAt) {
      redirect(employeePath(employeeId, 'SCHEDULING_TOUR_INVALID'));
    }
    preferredTimeWindows.push({ startsAt, endsAt });
  }
  if (
    !employeeId ||
    preferredStartLatitude === undefined ||
    preferredStartLongitude === undefined ||
    (preferredStartLatitude === null) !== (preferredStartLongitude === null)
  ) {
    redirect(employeePath(employeeId, 'SCHEDULING_TOUR_INVALID'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{employeeId}/scheduling-preferences', {
    params: { path: { employeeId }, header: await getTenantHeader() },
    body: {
      preferredWeekdays,
      preferredTimeWindows,
      preferredStartLatitude,
      preferredStartLongitude,
      travelMode: 'driving',
    },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/planning');
  redirect(`/employees/${employeeId}?updated=scheduling_preferences#availability`);
}

export async function changeEmployeeStatusAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('id'));
  const operation = formData.get('operation');
  if (!id || (operation !== 'activate' && operation !== 'deactivate' && operation !== 'archive')) {
    redirect('/employees?error=INVALID_REQUEST');
  }
  const api = await getApiClient();
  const options = { params: { path: { id }, header: await getTenantHeader() } };
  const response =
    operation === 'activate'
      ? await api.POST('/api/v1/employees/{id}/activate', options)
      : operation === 'deactivate'
        ? await api.POST('/api/v1/employees/{id}/deactivate', options)
        : await api.POST('/api/v1/employees/{id}/archive', options);
  if (response.error) redirect(`/employees/${id}?error=${encodeURIComponent(response.error.code)}`);
  revalidatePath('/employees');
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}?updated=${operation}`);
}

export async function assignFacilityAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const facilityId = readUuid(formData.get('facilityId'));
  const validFrom = readDate(formData, 'validFrom');
  const validUntil = readDate(formData, 'validUntil');
  if (!employeeId || !facilityId || validFrom === undefined || validUntil === undefined) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{id}/facilities/{facilityId}', {
    params: { path: { id: employeeId, facilityId }, header: await getTenantHeader() },
    body: {
      ...(formData.get('isPrimary') === 'on' ? { isPrimary: true } : {}),
      validFrom,
      validUntil,
    },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=assignment`);
}

export async function unassignFacilityAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const facilityId = readUuid(formData.get('facilityId'));
  if (!employeeId || !facilityId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/employees/{id}/facilities/{facilityId}', {
    params: { path: { id: employeeId, facilityId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=assignment`);
}

export async function assignTeamAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const teamId = readUuid(formData.get('teamId'));
  const validFrom = readDate(formData, 'validFrom');
  const validUntil = readDate(formData, 'validUntil');
  if (!employeeId || !teamId || validFrom === undefined || validUntil === undefined) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{id}/teams/{teamId}', {
    params: { path: { id: employeeId, teamId }, header: await getTenantHeader() },
    body: {
      role: readNullableText(formData, 'role'),
      validFrom,
      validUntil,
    },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=assignment`);
}

export async function unassignTeamAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const teamId = readUuid(formData.get('teamId'));
  if (!employeeId || !teamId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/employees/{id}/teams/{teamId}', {
    params: { path: { id: employeeId, teamId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=assignment`);
}

export async function linkEmployeeUserAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const userId = readUuid(formData.get('userId'));
  if (!employeeId || !userId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{id}/user', {
    params: { path: { id: employeeId }, header: await getTenantHeader() },
    body: { userId },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=access`);
}

export async function unlinkEmployeeUserAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  if (!employeeId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/employees/{id}/user', {
    params: { path: { id: employeeId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=access`);
}

export async function assignQualificationAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const qualificationId = readUuid(formData.get('qualificationId'));
  const validFrom = readDate(formData, 'validFrom');
  const validUntil = readDate(formData, 'validUntil');
  if (!employeeId || !qualificationId || validFrom === undefined || validUntil === undefined) {
    redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{id}/qualifications/{qualificationId}', {
    params: { path: { id: employeeId, qualificationId }, header: await getTenantHeader() },
    body: { validFrom, validUntil, issuer: readNullableText(formData, 'issuer') },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=qualification`);
}

export async function removeQualificationAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const qualificationId = readUuid(formData.get('qualificationId'));
  if (!employeeId || !qualificationId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/employees/{id}/qualifications/{qualificationId}', {
    params: { path: { id: employeeId, qualificationId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=qualification`);
}

export async function assignSkillAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const skillId = readUuid(formData.get('skillId'));
  if (!employeeId || !skillId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/employees/{id}/skills/{skillId}', {
    params: { path: { id: employeeId, skillId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=skill`);
}

export async function removeSkillAction(formData: FormData): Promise<void> {
  const employeeId = readUuid(formData.get('employeeId'));
  const skillId = readUuid(formData.get('skillId'));
  if (!employeeId || !skillId) redirect(employeePath(employeeId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/employees/{id}/skills/{skillId}', {
    params: { path: { id: employeeId, skillId }, header: await getTenantHeader() },
  });
  if (error) redirect(employeePath(employeeId, error.code));
  await refreshEmployee(employeeId);
  redirect(`/employees/${employeeId}?updated=skill`);
}

export async function createQualificationAction(formData: FormData): Promise<void> {
  await createDefinition(formData, 'qualification');
}

export async function updateQualificationAction(formData: FormData): Promise<void> {
  await updateDefinition(formData, 'qualification');
}

export async function archiveQualificationAction(formData: FormData): Promise<void> {
  await archiveDefinition(formData, 'qualification');
}

export async function createSkillAction(formData: FormData): Promise<void> {
  await createDefinition(formData, 'skill');
}

export async function updateSkillAction(formData: FormData): Promise<void> {
  await updateDefinition(formData, 'skill');
}

export async function archiveSkillAction(formData: FormData): Promise<void> {
  await archiveDefinition(formData, 'skill');
}

async function createDefinition(
  formData: FormData,
  kind: 'qualification' | 'skill',
): Promise<void> {
  const name = readText(formData, 'name');
  if (!name || name.length > 160) redirect('/administration/qualifications?error=INVALID_REQUEST');
  const api = await getApiClient();
  const path = kind === 'qualification' ? '/api/v1/qualifications' : '/api/v1/skills';
  const { error } = await api.POST(path, {
    params: { header: await getTenantHeader() },
    body: {
      name,
      code: readNullableText(formData, 'code'),
      description: readNullableText(formData, 'description'),
    },
  });
  if (error) redirect(`/administration/qualifications?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/qualifications');
  redirect('/administration/qualifications?updated=definition');
}

async function updateDefinition(
  formData: FormData,
  kind: 'qualification' | 'skill',
): Promise<void> {
  const id = readUuid(formData.get('id'));
  const name = readText(formData, 'name');
  if (!id || !name || name.length > 160)
    redirect('/administration/qualifications?error=INVALID_REQUEST');
  const api = await getApiClient();
  const path = kind === 'qualification' ? '/api/v1/qualifications/{id}' : '/api/v1/skills/{id}';
  const { error } = await api.PATCH(path, {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      name,
      code: readNullableText(formData, 'code'),
      description: readNullableText(formData, 'description'),
    },
  });
  if (error) redirect(`/administration/qualifications?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/qualifications');
  redirect('/administration/qualifications?updated=definition');
}

async function archiveDefinition(
  formData: FormData,
  kind: 'qualification' | 'skill',
): Promise<void> {
  const id = readUuid(formData.get('id'));
  if (!id) redirect('/administration/qualifications?error=INVALID_REQUEST');
  const api = await getApiClient();
  const path =
    kind === 'qualification'
      ? '/api/v1/qualifications/{id}/archive'
      : '/api/v1/skills/{id}/archive';
  const { error } = await api.POST(path, {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error) redirect(`/administration/qualifications?error=${encodeURIComponent(error.code)}`);
  revalidatePath('/administration/qualifications');
  redirect('/administration/qualifications?updated=definition');
}

async function refreshEmployee(id: string): Promise<void> {
  revalidatePath('/employees');
  revalidatePath(`/employees/${id}`);
  revalidatePath('/administration/qualifications');
}

function employeePath(id: string | null, error: string): string {
  return id
    ? `/employees/${id}?error=${encodeURIComponent(error)}`
    : `/employees?error=${encodeURIComponent(error)}`;
}

function readUuid(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableText(formData: FormData, name: string): string | null {
  return readText(formData, name) || null;
}

function readDate(formData: FormData, name: string): string | null | undefined {
  const value = readText(formData, name);
  if (!value) return null;
  if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return undefined;
  return value;
}

function readNumber(formData: FormData, name: string): number | null | undefined {
  const value = readText(formData, name);
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 168 ? number : undefined;
}

function readInteger(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = readText(formData, name);
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function readIntegerValues(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
): number[] {
  return [...new Set(formData.getAll(name))]
    .filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function readCoordinate(value: string, minimum: number, maximum: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}
