'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { visitDateTimeFromInput } from '@app/web/lib/care-date';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const directions = ['inbound', 'outbound', 'internal'] as const;
const channels = ['phone', 'in_person', 'email', 'letter', 'portal', 'other'] as const;
const categories = [
  'general_inquiry',
  'appointment_coordination',
  'cancellation_rescheduling',
  'service_request',
  'service_agreement',
  'documentation',
  'billing_payment',
  'benefits_payer',
  'complaint_feedback',
  'other',
] as const;
const outcomes = [
  'information_provided',
  'request_received',
  'action_required',
  'appointment_agreed',
  'no_answer',
  'resolved',
  'other',
] as const;

export async function createCommunicationAction(formData: FormData): Promise<void> {
  const clientId = validUuid(formData.get('clientId'));
  const direction = choice(formData.get('direction'), directions);
  const channel = choice(formData.get('channel'), channels);
  const category = choice(formData.get('category'), categories);
  const outcome = choice(formData.get('outcome'), outcomes);
  const subject = text(formData.get('subject')).trim();
  const summary = text(formData.get('summary')).trim();
  const contactId = optionalUuid(formData.get('contactId'));
  const contactLabel = text(formData.get('contactLabel')).trim();
  const occurredAtInput = text(formData.get('occurredAt'));
  const timezone = text(formData.get('timezone')) || 'Europe/Berlin';
  const occurredAt = visitDateTimeFromInput(occurredAtInput, timezone);
  const sourceValue = text(formData.get('source'));
  const [sourceType = '', sourceIdRaw = ''] = sourceValue ? sourceValue.split(':', 2) : [];
  const sourceId = sourceValue ? validUuid(sourceIdRaw as FormDataEntryValue) : null;
  if (
    !clientId ||
    !direction ||
    !channel ||
    !category ||
    !outcome ||
    subject.length < 1 ||
    subject.length > 200 ||
    summary.length > 4000 ||
    contactId === undefined ||
    !occurredAt ||
    (sourceValue &&
      (!sourceId ||
        !['visit', 'service_agreement', 'operations_task', 'invoice', 'claim', 'document'].includes(
          sourceType,
        )))
  )
    redirect(clientPath(clientId, 'COMMUNICATION_INVALID_INPUT'));

  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/communications/clients/{clientId}/interactions', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: {
      direction,
      channel,
      category,
      outcome,
      subject,
      summary: summary || null,
      occurredAt,
      ...(contactId ? { contactId } : {}),
      ...(contactLabel ? { contactLabel } : {}),
      ...(sourceType && sourceId
        ? {
            source: {
              type: sourceType as
                | 'visit'
                | 'service_agreement'
                | 'operations_task'
                | 'invoice'
                | 'claim'
                | 'document',
              id: sourceId,
            },
          }
        : {}),
    },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClient(clientId);
  redirect(clientPath(clientId, 'recorded'));
}

export async function amendCommunicationAction(formData: FormData): Promise<void> {
  const clientId = validUuid(formData.get('clientId'));
  const interactionId = validUuid(formData.get('interactionId'));
  const expectedVersion = positiveInteger(formData.get('expectedVersion'));
  const reason = text(formData.get('reason')).trim();
  const subject = text(formData.get('subject')).trim();
  const summary = text(formData.get('summary')).trim();
  if (
    !clientId ||
    !interactionId ||
    !expectedVersion ||
    !reason ||
    reason.length > 500 ||
    subject.length < 1 ||
    subject.length > 200 ||
    summary.length > 4000
  ) {
    redirect(clientPath(clientId, 'COMMUNICATION_INVALID_INPUT'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/communications/interactions/{id}/amendments', {
    params: { path: { id: interactionId }, header: await getTenantHeader() },
    body: { expectedVersion, reason, subject, summary: summary || null },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClient(clientId);
  redirect(clientPath(clientId, 'amended'));
}

export async function saveCommunicationPreferencesAction(formData: FormData): Promise<void> {
  const clientId = validUuid(formData.get('clientId'));
  const expectedVersion = nonnegativeInteger(formData.get('expectedVersion'));
  const preferredChannel = optionalChoice(formData.get('preferredChannel'), channels);
  const language = optionalChoice(formData.get('preferredLanguage'), ['de', 'en'] as const);
  const preferredContactId = optionalUuid(formData.get('preferredContactId'));
  const correspondencePreference = choice(formData.get('correspondencePreference'), [
    'unspecified',
    'postal',
    'electronic',
  ] as const);
  const preferredContactTimes = text(formData.get('preferredContactTimes')).trim();
  const contactRestrictions = text(formData.get('contactRestrictions')).trim();
  if (
    !clientId ||
    expectedVersion === null ||
    preferredChannel === undefined ||
    language === undefined ||
    preferredContactId === undefined ||
    !correspondencePreference ||
    preferredContactTimes.length > 250 ||
    contactRestrictions.length > 1000
  )
    redirect(clientPath(clientId, 'COMMUNICATION_INVALID_INPUT'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/communications/clients/{clientId}/preferences', {
    params: { path: { clientId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      preferredChannel: preferredChannel || null,
      preferredLanguage: language || null,
      preferredContactId: preferredContactId || null,
      preferredContactTimes: preferredContactTimes || null,
      correspondencePreference,
      contactRestrictions: contactRestrictions || null,
    },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClient(clientId);
  redirect(clientPath(clientId, 'preferences'));
}

export async function createCommunicationFollowUpAction(formData: FormData): Promise<void> {
  const clientId = validUuid(formData.get('clientId'));
  const interactionId = validUuid(formData.get('interactionId'));
  const organizationId = validUuid(formData.get('organizationId'));
  const assignedEmployeeId = optionalUuid(formData.get('assignedEmployeeId'));
  const title = text(formData.get('title')).trim();
  const priority = choice(formData.get('priority'), ['low', 'normal', 'high', 'urgent'] as const);
  const timezone = text(formData.get('timezone')) || 'Europe/Berlin';
  const dueValue = text(formData.get('dueAt'));
  const dueAt = dueValue ? visitDateTimeFromInput(dueValue, timezone) : null;
  if (
    !clientId ||
    !interactionId ||
    !organizationId ||
    assignedEmployeeId === undefined ||
    !title ||
    title.length > 200 ||
    !priority ||
    (dueValue && !dueAt)
  ) {
    redirect(clientPath(clientId, 'COMMUNICATION_INVALID_INPUT'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/operations/tasks', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      clientId,
      title,
      priority,
      ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
      ...(dueAt ? { dueAt } : {}),
      source: { type: 'communication', id: interactionId },
    },
  });
  if (error) redirect(clientPath(clientId, error.code));
  refreshClient(clientId);
  revalidatePath('/operations');
  revalidatePath('/operations/tasks');
  redirect(clientPath(clientId, 'followup'));
}

function refreshClient(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/communications`);
  revalidatePath('/communications');
}

function clientPath(clientId: string | null, value: string) {
  return clientId
    ? `/clients/${clientId}/communications?${value === 'COMMUNICATION_INVALID_INPUT' ? 'error' : 'updated'}=${encodeURIComponent(value)}`
    : '/communications?error=COMMUNICATION_INVALID_INPUT';
}

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}

function validUuid(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

function optionalUuid(value: FormDataEntryValue | null): string | null | undefined {
  const raw = text(value);
  if (!raw) return null;
  return validUuid(raw) ?? undefined;
}

function positiveInteger(value: FormDataEntryValue | null): number | null {
  const number = Number(text(value));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonnegativeInteger(value: FormDataEntryValue | null): number | null {
  const number = Number(text(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function choice<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  values: T,
): T[number] | null {
  const raw = text(value);
  return (values as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}

function optionalChoice<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  values: T,
): T[number] | null | undefined {
  const raw = text(value);
  return raw ? (choice(value, values) ?? undefined) : null;
}
