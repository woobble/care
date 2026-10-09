'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getApiClient, getTenantHeader } from '../../../../lib/api';

function readInteger(formData: FormData, name: string): number | null {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function validTimezone(value: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en', { timeZone: value });
    return formatter.resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

export async function updateWorkforceComplianceSettingsAction(formData: FormData): Promise<void> {
  const expectedVersion = readInteger(formData, 'expectedVersion');
  const criticalDays = readInteger(formData, 'criticalDays');
  const warningDays = readInteger(formData, 'warningDays');
  const reportingTimezone = formData.get('reportingTimezone');
  if (
    expectedVersion === null ||
    expectedVersion < 0 ||
    criticalDays === null ||
    warningDays === null ||
    criticalDays < 1 ||
    criticalDays > 365 ||
    warningDays < 1 ||
    warningDays > 365 ||
    criticalDays > warningDays ||
    typeof reportingTimezone !== 'string' ||
    reportingTimezone.trim().length === 0 ||
    reportingTimezone.trim().length > 100 ||
    !validTimezone(reportingTimezone.trim())
  ) {
    redirect('/administration/workforce-compliance?error=INVALID_WORKFORCE_COMPLIANCE_SETTINGS');
  }

  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/workforce-compliance/settings', {
    params: { header: await getTenantHeader() },
    body: {
      expectedVersion,
      criticalDays,
      warningDays,
      reportingTimezone: reportingTimezone.trim(),
    },
  });
  if (error) {
    redirect(`/administration/workforce-compliance?error=${encodeURIComponent(error.code)}`);
  }
  revalidatePath('/administration/workforce-compliance');
  redirect('/administration/workforce-compliance?updated=settings');
}
