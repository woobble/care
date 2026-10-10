'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../lib/api';
import { visitDateTimeFromInput } from '../../../lib/care-date';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const priorities = ['low', 'normal', 'high', 'urgent'] as const;
const transitionActions = ['start', 'complete', 'reopen', 'cancel'] as const;

export async function createTaskAction(formData: FormData): Promise<void> {
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
    assignedEmployeeId === undefined
  ) {
    redirect('/operations/tasks?error=OPERATIONS_INVALID_INPUT');
  }

  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/operations/tasks', {
    params: { header: await getTenantHeader() },
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
  redirect(`/operations/tasks/${taskId}?updated=saved`);
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
  if (!/^[a-f0-9]{64}$/.test(issueId))
    redirect('/operations/worklist?error=OPERATIONS_INVALID_INPUT');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/operations/work-items/{id}/acknowledge', {
    params: { path: { id: issueId }, header: await getTenantHeader() },
    body: {},
  });
  if (error) redirect(`/operations/worklist?error=${error.code}`);
  revalidateOperations();
  redirect('/operations/worklist?updated=acknowledged');
}

export async function snoozeExceptionAction(formData: FormData): Promise<void> {
  const issueId = text(formData.get('issueId'));
  if (!/^[a-f0-9]{64}$/.test(issueId))
    redirect('/operations/worklist?error=OPERATIONS_INVALID_INPUT');
  const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/operations/work-items/{id}/snooze', {
    params: { path: { id: issueId }, header: await getTenantHeader() },
    body: { snoozedUntil },
  });
  if (error) redirect(`/operations/worklist?error=${error.code}`);
  revalidateOperations();
  redirect('/operations/worklist?updated=snoozed');
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

function choice<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  values: T,
): T[number] | null {
  const raw = text(value);
  return (values as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}
