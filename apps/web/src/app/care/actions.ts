'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';

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
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'started'));
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
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
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
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'service-saved'));
}

export async function completeVisitAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !expectedVersion) redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/execution/complete', {
    params: { path: { visitId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'completed'));
}

export async function createDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/visits/{visitId}/documentation', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'documentation-created'));
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
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
  }
  const severity = readString(formData, 'severity');
  if (type === 'incident' && !['low', 'moderate', 'high', 'critical'].includes(severity)) {
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
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
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'entry-saved'));
}

export async function updateDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const entryId = readUuid(formData.get('entryId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const content = readString(formData, 'content');
  if (!visitId || !documentationId || !entryId || !expectedVersion || !content) {
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/care-documentation/{id}/entries/{entryId}', {
    params: { path: { id: documentationId, entryId }, header: await getTenantHeader() },
    body: { expectedVersion, content },
  });
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'entry-saved'));
}

export async function removeDocumentationEntryAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const entryId = readUuid(formData.get('entryId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !documentationId || !entryId || !expectedVersion) {
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
  }
  const { error } = await (
    await getApiClient()
  ).DELETE('/api/v1/care-documentation/{id}/entries/{entryId}', {
    params: { path: { id: documentationId, entryId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'entry-removed'));
}

export async function recordServiceEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const performedServiceId = readUuid(formData.get('performedServiceId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const note = readNullableString(formData, 'note');
  if (!visitId || !documentationId || !performedServiceId || !expectedVersion) {
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/care-documentation/{id}/evidence/{performedServiceId}', {
    params: {
      path: { id: documentationId, performedServiceId },
      header: await getTenantHeader(),
    },
    body: { expectedVersion, status: 'documented', note },
  });
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'evidence-saved'));
}

export async function finalizeDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!visitId || !documentationId || !expectedVersion) {
    redirect(visitErrorPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-documentation/{id}/finalize', {
    params: { path: { id: documentationId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(visitErrorPath(visitId, error.code));
  refresh(visitId);
  redirect(visitNoticePath(visitId, 'documentation-finalized'));
}

export async function prepareEvidencePackageAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  if (!visitId) redirect('/care/today?error=INVALID_REQUEST');
  const { data, error } = await (
    await getApiClient()
  ).POST('/api/v1/visits/{visitId}/evidence-package', {
    params: { path: { visitId }, header: await getTenantHeader() },
  });
  if (error || !data)
    redirect(evidenceErrorPath(visitId, error?.code ?? 'EVIDENCE_PACKAGE_INVALID_STATE'));
  revalidateEvidence(visitId, data.id);
  redirect(evidenceNoticePath(visitId, 'package-prepared'));
}

export async function acknowledgeEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const evidencePackageId = readUuid(formData.get('evidencePackageId'));
  const idempotencyKey = readUuid(formData.get('idempotencyKey'));
  const signatory = readSignatory(formData);
  const method = readString(formData, 'method');
  if (!visitId || !evidencePackageId || !idempotencyKey || !signatory) {
    redirect(evidenceErrorPath(visitId, 'INVALID_REQUEST'));
  }

  const api = await getApiClient();
  const common = { idempotencyKey, signatory };
  const result =
    method === 'touch_signature'
      ? await api.POST('/api/v1/evidence-packages/{id}/acknowledgement', {
          params: { path: { id: evidencePackageId }, header: await getTenantHeader() },
          body: {
            ...common,
            method,
            strokes: parseSignatureStrokes(readString(formData, 'strokes')),
          },
        })
      : method === 'typed_confirmation'
        ? await api.POST('/api/v1/evidence-packages/{id}/acknowledgement', {
            params: { path: { id: evidencePackageId }, header: await getTenantHeader() },
            body: {
              ...common,
              method,
              confirmationName: readString(formData, 'confirmationName'),
            },
          })
        : null;

  if (!result) redirect(evidenceErrorPath(visitId, 'INVALID_REQUEST'));
  if (result.error) redirect(evidenceErrorPath(visitId, result.error.code));
  revalidateEvidence(visitId, evidencePackageId);
  redirect(evidenceNoticePath(visitId, 'acknowledged'));
}

export async function declineEvidenceAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const evidencePackageId = readUuid(formData.get('evidencePackageId'));
  const idempotencyKey = readUuid(formData.get('idempotencyKey'));
  const signatory = readSignatory(formData);
  const reasonCode = readString(formData, 'reasonCode');
  const reasons = [
    'declined_without_reason',
    'disagrees_with_record',
    'unable_to_sign',
    'signatory_not_available',
    'other',
  ] as const;
  if (
    !visitId ||
    !evidencePackageId ||
    !idempotencyKey ||
    !signatory ||
    !(reasons as readonly string[]).includes(reasonCode)
  ) {
    redirect(evidenceErrorPath(visitId, 'INVALID_REQUEST'));
  }

  const { error } = await (
    await getApiClient()
  ).POST('/api/v1/evidence-packages/{id}/decline', {
    params: { path: { id: evidencePackageId }, header: await getTenantHeader() },
    body: {
      idempotencyKey,
      signatory,
      reasonCode: reasonCode as (typeof reasons)[number],
      note: readNullableString(formData, 'note'),
    },
  });
  if (error) redirect(evidenceErrorPath(visitId, error.code));
  revalidateEvidence(visitId, evidencePackageId);
  redirect(evidenceNoticePath(visitId, 'declined'));
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

function readSignatory(
  formData: FormData,
):
  | { type: 'client' }
  | { type: 'representative' | 'other_authorized_person'; contactId: string }
  | null {
  const value = readString(formData, 'signatory');
  if (value === 'client') return { type: 'client' };
  const separator = value.indexOf(':');
  const type = value.slice(0, separator);
  const contactId = readUuid(separator > -1 ? value.slice(separator + 1) : null);
  if (!contactId || (type !== 'representative' && type !== 'other_authorized_person')) {
    return null;
  }
  return { type, contactId };
}

function parseSignatureStrokes(value: string): { x: number; y: number }[][] {
  if (!value || value.length > 48_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > 32) return [];
  let count = 0;
  for (const stroke of parsed) {
    if (!Array.isArray(stroke)) return [];
    count += stroke.length;
    if (count > 2_000) return [];
    for (const point of stroke) {
      if (
        typeof point !== 'object' ||
        point === null ||
        !('x' in point) ||
        !('y' in point) ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1
      ) {
        return [];
      }
    }
  }
  return parsed as { x: number; y: number }[][];
}

function evidenceNoticePath(visitId: string | null, notice: string): string {
  return visitId
    ? `/care/visits/${visitId}/evidence?notice=${encodeURIComponent(notice)}`
    : evidenceErrorPath(null, 'INVALID_REQUEST');
}

function evidenceErrorPath(visitId: string | null, error: string): string {
  return visitId
    ? `/care/visits/${visitId}/evidence?error=${encodeURIComponent(error)}`
    : '/care/today?error=' + encodeURIComponent(error);
}

function revalidateEvidence(visitId: string, evidencePackageId: string): void {
  revalidatePath('/care/today');
  revalidatePath('/care/visits/' + visitId);
  revalidatePath('/care/visits/' + visitId + '/evidence');
  revalidatePath('/service-evidence');
  revalidatePath('/service-evidence/' + evidencePackageId);
}

function visitNoticePath(visitId: string | null, notice: string): string {
  return visitId
    ? '/care/visits/' + visitId + '?notice=' + encodeURIComponent(notice)
    : visitErrorPath(null, 'INVALID_REQUEST');
}

function visitErrorPath(visitId: string | null, error: string): string {
  return visitId
    ? '/care/visits/' + visitId + '?error=' + encodeURIComponent(error)
    : '/care/today?error=' + encodeURIComponent(error);
}

function refresh(visitId: string): void {
  revalidatePath('/care/today');
  revalidatePath('/care/visits/' + visitId);
  revalidatePath('/visits/' + visitId);
}
