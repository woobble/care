'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { visitDateTimeFromInput } from '@app/web/lib/care-date';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const priorities = ['low', 'normal', 'high', 'urgent'] as const;
const transitionActions = ['start', 'complete', 'reopen', 'cancel'] as const;
const recurrenceActions = ['pause', 'resume', 'end'] as const;
const recurrenceFrequencies = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const reminderCategories = [
  'agreements',
  'employees',
  'benefits',
  'billing',
  'onboarding',
] as const;

export async function createDeadlineTaskAction(formData: FormData): Promise<void> {
  const issueId = text(formData.get('issueId'));
  const title = text(formData.get('title')).trim();
  const priority = choice(formData.get('priority'), priorities) ?? 'high';
  if (!/^[a-f0-9]{64}$/.test(issueId) || title.length < 1 || title.length > 200)
    redirect('/operations/deadlines?error=OPERATIONS_INVALID_INPUT');
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/operations/deadlines/{id}/tasks', {
    params: { path: { id: issueId }, header: await getTenantHeader() },
    body: { title, priority },
  });
  if (error || !data)
    redirect(
      `/operations/deadlines?error=${encodeURIComponent(error?.code ?? 'OPERATIONS_INVALID_INPUT')}`,
    );
  revalidateOperations(data.id);
  redirect(`/operations/tasks/${data.id}?updated=created`);
}

export async function createRecurringTaskAction(formData: FormData): Promise<void> {
  const organizationId = uuid(formData.get('organizationId'));
  const facilityId = optionalUuid(formData.get('facilityId'));
  const clientId = optionalUuid(formData.get('clientId'));
  const assignedEmployeeId = optionalUuid(formData.get('assignedEmployeeId'));
  const frequency = choice(formData.get('frequency'), recurrenceFrequencies);
  const interval = boundedInteger(formData.get('interval'), 1, 365);
  const title = text(formData.get('title')).trim();
  const description = text(formData.get('description')).trim();
  const priority = choice(formData.get('priority'), priorities);
  const startDate = text(formData.get('startDate'));
  const endDate = text(formData.get('endDate'));
  const timeOfDay = text(formData.get('timeOfDay')) || '09:00';
  const generationPolicy = choice(formData.get('generationPolicy'), [
    'generate_missed',
    'skip_missed',
  ] as const);
  if (
    !organizationId ||
    !frequency ||
    !interval ||
    title.length < 1 ||
    title.length > 200 ||
    !priority ||
    !validDate(startDate) ||
    (endDate && !validDate(endDate)) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay) ||
    facilityId === undefined ||
    clientId === undefined ||
    assignedEmployeeId === undefined ||
    !generationPolicy
  )
    redirect('/operations/recurring-tasks?error=OPERATIONS_INVALID_INPUT');

  const rule: {
    frequency: (typeof recurrenceFrequencies)[number];
    interval: number;
    weekdays?: number[];
    dayOfMonth?: number;
    month?: number;
  } = { frequency, interval };
  if (frequency === 'weekly') {
    const weekdays = formData.getAll('weekdays').map((value) => Number(value));
    if (weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7))
      redirect('/operations/recurring-tasks?error=OPERATIONS_INVALID_INPUT');
    if (weekdays.length) rule.weekdays = weekdays;
  }
  if (frequency === 'monthly' || frequency === 'yearly') {
    const dayOfMonth = boundedInteger(formData.get('dayOfMonth'), 1, 31);
    if (!dayOfMonth) redirect('/operations/recurring-tasks?error=OPERATIONS_INVALID_INPUT');
    rule.dayOfMonth = dayOfMonth;
  }
  if (frequency === 'yearly') {
    const month = boundedInteger(formData.get('month'), 1, 12);
    if (!month) redirect('/operations/recurring-tasks?error=OPERATIONS_INVALID_INPUT');
    rule.month = month;
  }

  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/operations/recurring-tasks', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      title,
      priority,
      rule,
      startDate,
      timeOfDay,
      generationPolicy,
      ...(description ? { description } : {}),
      ...(facilityId ? { facilityId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
      ...(endDate ? { endDate } : {}),
    },
  });
  if (error || !data)
    redirect(
      `/operations/recurring-tasks?error=${encodeURIComponent(error?.code ?? 'OPERATIONS_INVALID_INPUT')}`,
    );
  revalidateOperations();
  redirect('/operations/recurring-tasks?updated=created');
}

export async function transitionRecurringTaskAction(formData: FormData): Promise<void> {
  const id = uuid(formData.get('recurrenceId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const action = choice(formData.get('action'), recurrenceActions);
  if (!id || !expectedVersion || !action)
    redirect('/operations/recurring-tasks?error=OPERATIONS_INVALID_INPUT');
  const api = await getApiClient();
  const params = { path: { id }, header: await getTenantHeader() };
  const body = { expectedVersion };
  const result =
    action === 'pause'
      ? await api.POST('/api/v1/operations/recurring-tasks/{id}/pause', { params, body })
      : action === 'resume'
        ? await api.POST('/api/v1/operations/recurring-tasks/{id}/resume', { params, body })
        : await api.POST('/api/v1/operations/recurring-tasks/{id}/end', { params, body });
  if (result.error)
    redirect(`/operations/recurring-tasks?error=${encodeURIComponent(result.error.code)}`);
  revalidateOperations();
  redirect('/operations/recurring-tasks?updated=saved');
}

export async function updateRecurringTaskAction(formData: FormData): Promise<void> {
  const id = uuid(formData.get('recurrenceId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const title = text(formData.get('title')).trim();
  const priority = choice(formData.get('priority'), priorities);
  if (!id || !expectedVersion || title.length < 1 || title.length > 200 || !priority)
    redirect('/operations/recurring-tasks?error=OPERATIONS_INVALID_INPUT');
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/operations/recurring-tasks/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { expectedVersion, title, priority },
  });
  if (error) redirect(`/operations/recurring-tasks?error=${encodeURIComponent(error.code)}`);
  revalidateOperations();
  redirect('/operations/recurring-tasks?updated=saved');
}

export async function updateReminderPolicyAction(formData: FormData): Promise<void> {
  const organizationId = uuid(formData.get('organizationId'));
  const category = choice(formData.get('category'), reminderCategories);
  const expectedVersion = nonnegativeInteger(formData.get('expectedVersion'));
  const assignedEmployeeId = optionalUuid(formData.get('assignedEmployeeId'));
  const offsetsDays = text(formData.get('offsetsDays'))
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));
  if (
    !organizationId ||
    !category ||
    expectedVersion === null ||
    assignedEmployeeId === undefined ||
    !offsetsDays.length ||
    offsetsDays.length > 8 ||
    offsetsDays.some((day) => day < 0 || day > 365)
  )
    redirect('/operations/reminder-settings?error=OPERATIONS_INVALID_INPUT');
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/operations/reminder-settings', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      category,
      offsetsDays: [...new Set(offsetsDays)],
      enabled: formData.get('enabled') === 'on',
      createFollowUpTask: formData.get('createFollowUpTask') === 'on',
      expectedVersion,
      ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
    },
  });
  if (error)
    redirect(
      `/operations/reminder-settings?organizationId=${organizationId}&error=${encodeURIComponent(error.code)}`,
    );
  revalidateOperations();
  redirect(`/operations/reminder-settings?organizationId=${organizationId}&updated=saved`);
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const admissionCaseId = optionalUuid(formData.get('admissionCaseId'));
  const organizationId = uuid(formData.get('organizationId'));
  const facilityId = optionalUuid(formData.get('facilityId'));
  const clientId = optionalUuid(formData.get('clientId'));
  const assignedEmployeeId = optionalUuid(formData.get('assignedEmployeeId'));
  const title = text(formData.get('title')).trim();
  const description = text(formData.get('description')).trim();
  const priority = choice(formData.get('priority'), priorities);
  const dueAt = dueDate(formData);
  if (
    !organizationId ||
    title.length < 1 ||
    title.length > 200 ||
    !priority ||
    dueAt === undefined ||
    facilityId === undefined ||
    clientId === undefined ||
    assignedEmployeeId === undefined ||
    admissionCaseId === undefined
  ) {
    redirect('/operations/tasks?error=OPERATIONS_INVALID_INPUT');
  }

  const api = await getApiClient();
  const header = await getTenantHeader();
  if (admissionCaseId) {
    const caseResult = await api.GET('/api/v1/onboarding/cases/{id}', {
      params: { path: { id: admissionCaseId }, header },
    });
    const admission = caseResult.data as unknown as
      | { organizationId: string; clientId: string | null; stage: string }
      | undefined;
    if (caseResult.error)
      redirect(`/operations/tasks?error=${encodeURIComponent(caseResult.error.code)}`);
    if (
      !admission ||
      ['declined', 'withdrawn'].includes(admission.stage) ||
      admission.organizationId !== organizationId ||
      (admission.clientId
        ? Boolean(clientId && clientId !== admission.clientId)
        : Boolean(clientId))
    ) {
      redirect(`/admissions/${admissionCaseId}?error=ONBOARDING_SOURCE_NOT_FOUND`);
    }
  }
  const { data, error } = await api.POST('/api/v1/operations/tasks', {
    params: { header },
    body: {
      organizationId,
      title,
      priority,
      ...(description ? { description } : {}),
      ...(facilityId !== undefined ? { facilityId } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      ...(formData.has('assignedEmployeeId')
        ? { assignedEmployeeId: assignedEmployeeId ?? null }
        : {}),
      ...(dueAt !== null ? { dueAt } : {}),
    },
  });
  if (error || !data)
    redirect(`/operations/tasks?error=${error?.code ?? 'OPERATIONS_INVALID_INPUT'}`);
  revalidateOperations(data.id);
  if (admissionCaseId) {
    const { error: linkError } = await api.POST('/api/v1/onboarding/cases/{id}/tasks', {
      params: { path: { id: admissionCaseId }, header },
      body: { taskId: data.id },
    });
    revalidatePath(`/admissions/${admissionCaseId}`);
    if (linkError)
      redirect(
        `/admissions/${admissionCaseId}?createdTaskId=${data.id}&error=${encodeURIComponent(linkError.code)}`,
      );
    redirect(`/admissions/${admissionCaseId}?updated=task_created`);
  }
  redirect(`/operations/tasks/${data.id}?updated=created`);
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  const taskId = uuid(formData.get('taskId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const title = text(formData.get('title')).trim();
  const description = text(formData.get('description')).trim();
  const priority = choice(formData.get('priority'), priorities);
  const dueAt = dueDate(formData);
  const assignedEmployeeId = optionalUuid(formData.get('assignedEmployeeId'));
  if (
    !taskId ||
    !expectedVersion ||
    title.length < 1 ||
    title.length > 200 ||
    !priority ||
    dueAt === undefined ||
    assignedEmployeeId === undefined
  ) {
    redirect(taskPath(taskId, 'OPERATIONS_INVALID_INPUT'));
  }

  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/operations/tasks/{id}', {
    params: { path: { id: taskId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      title,
      description: description || null,
      priority,
      dueAt,
      ...(formData.has('assignedEmployeeId')
        ? { assignedEmployeeId: assignedEmployeeId ?? null }
        : {}),
    },
  });
  if (error) redirect(taskPath(taskId, error.code));
  revalidateOperations(taskId);
  redirect(`/operations/tasks/${taskId}?updated=saved`);
}

export async function transitionTaskAction(formData: FormData): Promise<void> {
  const taskId = uuid(formData.get('taskId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const action = choice(formData.get('action'), transitionActions);
  const returnTo = choice(formData.get('returnTo'), [
    '/operations',
    '/operations/worklist',
    '/operations/tasks',
  ] as const);
  if (!taskId || !expectedVersion || !action)
    redirect(taskPath(taskId, 'OPERATIONS_INVALID_INPUT'));

  const api = await getApiClient();
  const params = { path: { id: taskId }, header: await getTenantHeader() };
  const body = { expectedVersion };
  const result =
    action === 'start'
      ? await api.POST('/api/v1/operations/tasks/{id}/start', { params, body })
      : action === 'complete'
        ? await api.POST('/api/v1/operations/tasks/{id}/complete', { params, body })
        : action === 'reopen'
          ? await api.POST('/api/v1/operations/tasks/{id}/reopen', { params, body })
          : await api.POST('/api/v1/operations/tasks/{id}/cancel', { params, body });
  if (result.error) redirect(taskPath(taskId, result.error.code));
  revalidateOperations(taskId);
  redirect(
    returnTo
      ? `${returnTo}?updated=${action === 'complete' ? 'completed' : 'saved'}`
      : `/operations/tasks/${taskId}?updated=saved`,
  );
}

export async function addTaskCommentAction(formData: FormData): Promise<void> {
  const taskId = uuid(formData.get('taskId'));
  const comment = text(formData.get('comment')).trim();
  if (!taskId || comment.length < 1 || comment.length > 4000) {
    redirect(taskPath(taskId, 'OPERATIONS_INVALID_INPUT'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/operations/tasks/{id}/comments', {
    params: { path: { id: taskId }, header: await getTenantHeader() },
    body: { comment },
  });
  if (error) redirect(taskPath(taskId, error.code));
  revalidateOperations(taskId);
  redirect(`/operations/tasks/${taskId}?updated=saved#activity`);
}

export async function acknowledgeExceptionAction(formData: FormData): Promise<void> {
  const issueId = text(formData.get('issueId'));
  const returnTo = safeOperationsReturn(text(formData.get('returnTo')));
  if (!/^[a-f0-9]{64}$/.test(issueId))
    redirect('/operations/worklist?error=OPERATIONS_INVALID_INPUT');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/operations/work-items/{id}/acknowledge', {
    params: { path: { id: issueId }, header: await getTenantHeader() },
    body: {},
  });
  if (error) redirect(`${returnTo}?error=${error.code}`);
  revalidateOperations();
  redirect(`${returnTo}?updated=acknowledged`);
}

export async function snoozeExceptionAction(formData: FormData): Promise<void> {
  const issueId = text(formData.get('issueId'));
  const returnTo = safeOperationsReturn(text(formData.get('returnTo')));
  if (!/^[a-f0-9]{64}$/.test(issueId))
    redirect('/operations/worklist?error=OPERATIONS_INVALID_INPUT');
  const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/operations/work-items/{id}/snooze', {
    params: { path: { id: issueId }, header: await getTenantHeader() },
    body: { snoozedUntil },
  });
  if (error) redirect(`${returnTo}?error=${error.code}`);
  revalidateOperations();
  redirect(`${returnTo}?updated=snoozed`);
}

function dueDate(formData: FormData): string | null | undefined {
  const value = text(formData.get('dueAt'));
  if (!value) return null;
  return (
    visitDateTimeFromInput(value, text(formData.get('timezone')) || 'Europe/Berlin') ?? undefined
  );
}

function revalidateOperations(taskId?: string) {
  revalidatePath('/operations');
  revalidatePath('/operations/worklist');
  revalidatePath('/operations/tasks');
  if (taskId) revalidatePath(`/operations/tasks/${taskId}`);
}

function taskPath(taskId: string | null, error: string): string {
  return taskId ? `/operations/tasks/${taskId}?error=${error}` : `/operations/tasks?error=${error}`;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

function uuid(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

function optionalUuid(value: FormDataEntryValue | null): string | null | undefined {
  const raw = text(value);
  if (!raw) return null;
  return uuid(raw) ?? undefined;
}

function positiveInteger(value: FormDataEntryValue | null): number | null {
  const parsed = Number(text(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: FormDataEntryValue | null): number | null {
  const parsed = Number(text(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function boundedInteger(
  value: FormDataEntryValue | null,
  minimum: number,
  maximum: number,
): number | null {
  const parsed = Number(text(value));
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function safeOperationsReturn(value: string): string {
  return value === '/operations/deadlines' ? value : '/operations/worklist';
}

function choice<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  values: T,
): T[number] | null {
  const raw = text(value);
  return (values as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}
