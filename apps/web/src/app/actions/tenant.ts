'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getApiClient } from '@app/web/lib/api';
import { loadWebConfig } from '@care/config';

export async function selectTenantAction(formData: FormData): Promise<void> {
  const tenantId = formData.get('tenantId');
  if (typeof tenantId !== 'string') redirect('/?error=tenant');
  const api = await getApiClient(false);
  const { data, error } = await api.GET('/api/v1/me/tenants');
  if (error || !data?.some((tenant) => tenant.id === tenantId)) redirect('/?error=tenant');

  const config = loadWebConfig();
  (await cookies()).set('care-tenant', tenantId, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  redirect('/clients');
}
