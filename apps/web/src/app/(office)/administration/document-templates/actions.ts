'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { fetchCareApi, getApiClient, getTenantHeader } from '@app/web/lib/api';
import type { DocumentsControllerSaveTemplateData } from '@care/api-client';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const documentTypes = [
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
] as const;
type DocumentType = (typeof documentTypes)[number];
type TemplateInput = DocumentsControllerSaveTemplateData['body'];

export async function saveDocumentTemplateAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const type = readType(formData.get('documentType'));
  const expectedVersion = Number(formData.get('expectedVersion'));
  if (!organizationId || !type || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    redirect('/administration/document-templates?error=INVALID_REQUEST');
  }

  const logoAssetIdValue = formData.get('logoAssetId');
  const logoAssetId = logoAssetIdValue === '' ? null : readUuid(logoAssetIdValue);
  if (logoAssetIdValue !== '' && !logoAssetId) {
    redirect(templatePath(organizationId, type, 'INVALID_REQUEST'));
  }
  const defaultLocale = formData.get('defaultLocale');
  if (defaultLocale !== 'de' && defaultLocale !== 'en') {
    redirect(templatePath(organizationId, type, 'INVALID_REQUEST'));
  }
  const body = {
    expectedVersion,
    logoAssetId,
    primaryColor: readNullableText(formData, 'primaryColor', 7),
    headerText: readNullableText(formData, 'headerText', 500),
    footerText: readNullableText(formData, 'footerText', 500),
    contactEmail: readNullableText(formData, 'contactEmail', 254),
    contactPhone: readNullableText(formData, 'contactPhone', 80),
    contactWebsite: readNullableText(formData, 'contactWebsite', 254),
    defaultLocale,
    contractTermsText: readNullableText(formData, 'contractTermsText', 8000),
  } satisfies TemplateInput;

  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/document-templates/{type}', {
    params: { path: { type }, query: { organizationId }, header: await getTenantHeader() },
    body,
  });
  if (error) redirect(templatePath(organizationId, type, error.code));
  revalidatePath('/administration/document-templates');
  redirect(templatePath(organizationId, type, 'saved'));
}

export async function uploadDocumentLogoAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const type = readType(formData.get('documentType'));
  const file = formData.get('file');
  if (
    !organizationId ||
    !type ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > 512 * 1024 ||
    (file.type !== 'image/png' && file.type !== 'image/jpeg')
  ) {
    redirect(templatePath(organizationId, type, 'DOCUMENT_TEMPLATE_INVALID'));
  }

  const payload = new FormData();
  payload.set('organizationId', organizationId);
  payload.set('file', file, file.name);
  const response = await fetchCareApi({
    route: 'documentTemplateLogo',
    init: { method: 'POST', body: payload },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code =
      body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        ? body.code
        : 'DOCUMENT_TEMPLATE_INVALID';
    redirect(templatePath(organizationId, type, code));
  }
  const logo = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (!logo || typeof logo.id !== 'string' || !uuidPattern.test(logo.id)) {
    redirect(templatePath(organizationId, type, 'DOCUMENT_TEMPLATE_INVALID'));
  }
  revalidatePath('/administration/document-templates');
  const query = new URLSearchParams({
    organizationId,
    type,
    logoAssetId: logo.id,
    notice: 'logoUploaded',
  });
  redirect(`/administration/document-templates?${query.toString()}`);
}

function readUuid(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

function readType(value: FormDataEntryValue | null): DocumentType | null {
  return typeof value === 'string' && documentTypes.includes(value as DocumentType)
    ? (value as DocumentType)
    : null;
}

function readNullableText(formData: FormData, key: string, maxLength: number): string | null {
  const value = formData.get(key);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, maxLength);
}

function templatePath(
  organizationId: string | null,
  type: DocumentType | null,
  value: string,
): string {
  const query = new URLSearchParams({ notice: value });
  if (organizationId) query.set('organizationId', organizationId);
  if (type) query.set('type', type);
  return `/administration/document-templates?${query.toString()}`;
}
