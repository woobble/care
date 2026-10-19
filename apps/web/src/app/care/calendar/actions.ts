'use server';

import { revalidatePath } from 'next/cache';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';

export type CalendarSubscriptionActionResult =
  | { ok: true; active: true; httpsUrl: string; webcalUrl: string; createdAt: string }
  | { ok: true; active: false }
  | { ok: false };

export async function rotateCalendarSubscriptionAction(): Promise<CalendarSubscriptionActionResult> {
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/me/calendar-subscription', {
    params: { header: await getTenantHeader() },
  });
  if (error || !data) return { ok: false };
  revalidatePath('/care/calendar');
  return {
    ok: true,
    active: true,
    httpsUrl: data.httpsUrl,
    webcalUrl: data.webcalUrl,
    createdAt: data.createdAt,
  };
}

export async function revokeCalendarSubscriptionAction(): Promise<CalendarSubscriptionActionResult> {
  const api = await getApiClient();
  const { error } = await api.DELETE('/api/v1/me/calendar-subscription', {
    params: { header: await getTenantHeader() },
  });
  if (error) return { ok: false };
  revalidatePath('/care/calendar');
  return { ok: true, active: false };
}
