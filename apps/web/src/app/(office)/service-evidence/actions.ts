'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function revokeAcknowledgementAction(formData: FormData): Promise<void> {
  const acknowledgementId = readUuid(formData.get('acknowledgementId'));
  const evidencePackageId = readUuid(formData.get('evidencePackageId'));
  const reason = readString(formData, 'reason');
  if (!acknowledgementId || !evidencePackageId || !reason) {
    redirect(packagePath(evidencePackageId, 'INVALID_REQUEST'));
  }
  const { error } = await (
    await getApiClient()
  ).POST('/api/v1/acknowledgements/{id}/revoke', {
    params: { path: { id: acknowledgementId }, header: await getTenantHeader() },
    body: { reason },
  });
  if (error) redirect(packagePath(evidencePackageId, error.code));
  revalidatePath('/service-evidence');
  revalidatePath('/service-evidence/' + evidencePackageId);
  redirect(packagePath(evidencePackageId, 'acknowledgement-revoked'));
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

function packagePath(packageId: string | null, notice: string): string {
  return packageId
    ? `/service-evidence/${packageId}?notice=${encodeURIComponent(notice)}`
    : '/service-evidence?error=' + encodeURIComponent(notice);
}
