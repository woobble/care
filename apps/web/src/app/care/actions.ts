'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const serviceStatuses = ['performed', 'partially_performed', 'not_performed'] as const;
const reasonCodes = [
  'client_declined',
  'client_not_present',
  'service_not_required',
  'time_constraint',
  'provider_decision',
  'other',
] as const;

export async function startVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/execution/start', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'started'));
}

export async function recordPerformedServiceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const performedServiceId = readUuid(formData.get('performedServiceId'));
  const visitServiceId = readUuid(formData.get('visitServiceId'));
  const serviceDefinitionId = readUuid(formData.get('serviceDefinitionId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const status = readString(formData, 'status');
  const actualQuantity = readNullableString(formData, 'actualQuantity');
  const reason = readString(formData, 'reasonCode');
  if (
    !visitId ||
    !performedServiceId ||
    !expectedVersion ||
    !(serviceStatuses as readonly string[]).includes(status) ||
    (!visitServiceId && !serviceDefinitionId) ||
    (reason !== '' && !(reasonCodes as readonly string[]).includes(reason))
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const { error } = await api.PUT(
    '/api/v1/visits/{visitId}/execution/services/{performedServiceId}',
    {
      params: {
        path: { visitId, performedServiceId },
        header: await getTenantHeader(),
      },
      body: {
        expectedVersion,
        ...(visitServiceId ? { visitServiceId } : {}),
        ...(serviceDefinitionId ? { serviceDefinitionId } : {}),
        status: status as (typeof serviceStatuses)[number],
        actualQuantity: status === 'not_performed' ? '0' : actualQuantity,
        reasonCode: reason ? (reason as (typeof reasonCodes)[number]) : null,
      },
    },
  );
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'service-saved'));
}

export async function completeVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !expectedVersion) redirect(visitPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/execution/complete', {
    params: { path: { visitId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'completed'));
}

export async function createDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/documentation', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'documentation-created'));
}

export async function addDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const type = readString(formData, 'type');
  const content = readString(formData, 'content');
  if (
    !visitId ||
    !documentationId ||
    !expectedVersion ||
    !content ||
    !['care_note', 'observation', 'deviation', 'incident'].includes(type)
  ) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const severity = readString(formData, 'severity');
  if (type === 'incident' && !['low', 'moderate', 'high', 'critical'].includes(severity)) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-documentation/{id}/entries', {
    params: { path: { id: documentationId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      type: type as 'care_note' | 'observation' | 'deviation' | 'incident',
      content,
      ...(type === 'incident'
        ? {
            occurredAt: new Date().toISOString(),
            severity: severity as 'low' | 'moderate' | 'high' | 'critical',
          }
        : {}),
    },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'entry-saved'));
}

export async function updateDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const entryId = readUuid(formData.get('entryId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const content = readString(formData, 'content');
  if (!visitId || !documentationId || !entryId || !expectedVersion || !content) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/care-documentation/{id}/entries/{entryId}', {
    params: { path: { id: documentationId, entryId }, header: await getTenantHeader() },
    body: { expectedVersion, content },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'entry-saved'));
}

export async function removeDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const entryId = readUuid(formData.get('entryId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !documentationId || !entryId || !expectedVersion) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const { error } = await (
    await getApiClient()
  ).DELETE('/api/v1/care-documentation/{id}/entries/{entryId}', {
    params: { path: { id: documentationId, entryId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'entry-removed'));
}

export async function recordServiceEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const performedServiceId = readUuid(formData.get('performedServiceId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const note = readNullableString(formData, 'note');
  if (!visitId || !documentationId || !performedServiceId || !expectedVersion) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/care-documentation/{id}/evidence/{performedServiceId}', {
    params: {
      path: { id: documentationId, performedServiceId },
      header: await getTenantHeader(),
    },
    body: { expectedVersion, status: 'documented', note },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'evidence-saved'));
}

export async function finalizeDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !documentationId || !expectedVersion) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-documentation/{id}/finalize', {
    params: { path: { id: documentationId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitPath(visitId, error.code));
  refresh(visitId);
  redirect(visitPath(visitId, 'documentation-finalized'));
}

function readUuid(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return uuidPattern.test(normalized) ? normalized : null;
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableString(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

function readPositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function visitPath(visitId: string | null, value: string): string {
  return visitId
    ? '/care/visits/' + visitId + '?notice=' + encodeURIComponent(value)
    : '/care/today?error=' + encodeURIComponent(value);
}

function refresh(visitId: string): void {
  revalidatePath('/care/today');
  revalidatePath('/care/visits/' + visitId);
  revalidatePath('/visits/' + visitId);
}
