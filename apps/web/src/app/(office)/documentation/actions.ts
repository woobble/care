'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function amendDocumentationAction(formData: FormData): Promise<void> {
  const visitId = readUuid(formData.get('visitId'));
  const documentationId = readUuid(formData.get('documentationId'));
  const reason = readString(formData.get('reason'));
  const correction = readString(formData.get('correction'));
  if (!visitId || !documentationId || !reason || !correction) {
    redirect(visitPath(visitId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/care-documentation/{id}/amendments', {
    params: { path: { id: documentationId }, header: await getTenantHeader() },
    body: { reason, correction },
  });
  if (error) redirect(visitPath(visitId, error.code));
  revalidatePath('/documentation');
  revalidatePath(`/visits/${visitId}`);
  redirect(`/visits/${visitId}?updated=documentation-amended`);
}

function readUuid(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return uuidPattern.test(normalized) ? normalized : null;
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function visitPath(visitId: string | null, code: string): string {
  return visitId
    ? `/visits/${visitId}?error=${encodeURIComponent(code)}`
    : `/documentation?error=${encodeURIComponent(code)}`;
}
