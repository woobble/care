'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { fetchCareApi } from '../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const localPathPattern =
  /^\/(?:service-evidence\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|clients\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/(?:benefits|service-agreements))?)$/i;

export async function generateDocumentAction(formData: FormData): Promise<void> {
  const sourceType = formData.get('sourceType');
  const returnTo = formData.get('returnTo');
  const localeValue = formData.get('locale');
  const locale = localeValue === 'en' || localeValue === 'de' ? localeValue : undefined;
  if (
    typeof sourceType !== 'string' ||
    typeof returnTo !== 'string' ||
    !localPathPattern.test(returnTo)
  ) {
    redirect('/clients');
  }

  let command:
    | { sourceType: 'evidence_package'; evidencePackageId: string }
    | { sourceType: 'service_agreement'; agreementId: string }
    | { sourceType: 'benefit_overview'; clientId: string; asOf?: string };
  if (sourceType === 'evidence_package') {
    const evidencePackageId = formData.get('evidencePackageId');
    if (typeof evidencePackageId !== 'string' || !uuidPattern.test(evidencePackageId)) {
      redirect(withError(returnTo, 'INVALID_REQUEST'));
    }
    command = { sourceType, evidencePackageId };
  } else if (sourceType === 'service_agreement') {
    const agreementId = formData.get('agreementId');
    if (typeof agreementId !== 'string' || !uuidPattern.test(agreementId)) {
      redirect(withError(returnTo, 'INVALID_REQUEST'));
    }
    command = { sourceType, agreementId };
  } else if (sourceType === 'benefit_overview') {
    const clientId = formData.get('clientId');
    const asOf = formData.get('asOf');
    if (
      typeof clientId !== 'string' ||
      !uuidPattern.test(clientId) ||
      (typeof asOf === 'string' && asOf !== '' && !datePattern.test(asOf))
    ) {
      redirect(withError(returnTo, 'INVALID_REQUEST'));
    }
    command = {
      sourceType,
      clientId,
      ...(typeof asOf === 'string' && asOf !== '' ? { asOf } : {}),
    };
  } else {
    redirect(withError(returnTo, 'INVALID_REQUEST'));
  }

  const response = await fetchCareApi('/api/v1/documents/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...command,
      ...(locale ? { locale } : {}),
      idempotencyKey: randomUUID(),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code =
      body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        ? body.code
        : 'DOCUMENT_GENERATION_FAILED';
    redirect(withError(returnTo, code));
  }

  const artifact = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (!artifact || typeof artifact.id !== 'string' || !uuidPattern.test(artifact.id)) {
    redirect(withError(returnTo, 'DOCUMENT_GENERATION_FAILED'));
  }
  redirect(`/documents/${artifact.id}/pdf`);
}

function withError(path: string, code: string): string {
  return `${path}?error=${encodeURIComponent(code)}`;
}
