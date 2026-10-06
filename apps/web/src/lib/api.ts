import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCareApi } from '@care/api-client';
import { loadWebConfig } from '@care/config';
import { auth } from '../auth';

export async function getApiClient(requireTenant = true) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect('/');

  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
  const account = accounts.find((item) => item.providerId === 'authentik');
  if (!account) redirect('/?error=auth');

  const token = await auth.api
    .getAccessToken({ headers: requestHeaders, body: { accountId: account.id } })
    .catch(() => redirect('/?error=auth'));

  const config = loadWebConfig();
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (requireTenant && !tenantId) redirect('/');
  return createCareApi({
    baseUrl: config.API_INTERNAL_URL,
    accessToken: token.accessToken,
    ...(requireTenant && tenantId ? { tenantId } : {}),
    ...(requestHeaders.get('x-request-id')
      ? { requestId: requestHeaders.get('x-request-id')! }
      : {}),
    ...(requestHeaders.get('x-correlation-id')
      ? { correlationId: requestHeaders.get('x-correlation-id')! }
      : {}),
  });
}

export async function getTenantHeader(): Promise<{ 'X-Tenant-Id': string }> {
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (!tenantId) redirect('/');
  return { 'X-Tenant-Id': tenantId };
}
