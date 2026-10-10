import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCareApi } from '@care/api-client';
import type { CareApi } from '@care/api-client';
import type { ApiClientOptions } from '@care/api-client';
import { loadWebConfig } from '@care/config';
import { auth } from '@app/web/auth';

export async function getApiClient(requireTenant = true) {
  return createCareApi(await apiClientOptions(requireTenant));
}

export async function fetchCareApi(path: string, init: RequestInit = {}): Promise<Response> {
  const options = await apiClientOptions(true);
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set('Authorization', `Bearer ${options.accessToken}`);
  requestHeaders.set('X-Tenant-Id', options.tenantId!);
  if (options.requestId) requestHeaders.set('X-Request-Id', options.requestId);
  if (options.correlationId) requestHeaders.set('X-Correlation-Id', options.correlationId);
  return fetch(new URL(path, options.baseUrl), { ...init, headers: requestHeaders });
}

async function apiClientOptions(requireTenant: boolean): Promise<ApiClientOptions> {
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
  return {
    baseUrl: config.API_INTERNAL_URL,
    accessToken: token.accessToken,
    ...(requireTenant && tenantId ? { tenantId } : {}),
    ...(requestHeaders.get('x-request-id')
      ? { requestId: requestHeaders.get('x-request-id')! }
      : {}),
    ...(requestHeaders.get('x-correlation-id')
      ? { correlationId: requestHeaders.get('x-correlation-id')! }
      : {}),
  };
}

export async function getTenantHeader(): Promise<{ 'X-Tenant-Id': string }> {
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (!tenantId) redirect('/');
  return { 'X-Tenant-Id': tenantId };
}

export async function getPermissionGrants(api?: CareApi) {
  const client = api ?? (await getApiClient());
  const { data, error } = await client.GET('/api/v1/me/permissions', {
    params: { header: await getTenantHeader() },
  });
  return error ? [] : (data ?? []);
}

export type CurrentPermissionGrant = Awaited<ReturnType<typeof getPermissionGrants>>[number];

export function hasPermission(
  grants: readonly CurrentPermissionGrant[],
  permission: CurrentPermissionGrant['permission'],
): boolean {
  return grants.some((grant) => grant.permission === permission);
}

export function hasTenantPermission(
  grants: readonly CurrentPermissionGrant[],
  permission: CurrentPermissionGrant['permission'],
  tenantId: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.permission === permission && grant.scopeType === 'tenant' && grant.scopeId === tenantId,
  );
}

export function hasClientPermission(
  grants: readonly CurrentPermissionGrant[],
  permission: CurrentPermissionGrant['permission'],
  tenantId: string,
  organizationId: string | null,
  facilityId: string | null,
): boolean {
  return grants.some(
    (grant) =>
      grant.permission === permission &&
      ((grant.scopeType === 'tenant' && grant.scopeId === tenantId) ||
        (grant.scopeType === 'organization' && grant.scopeId === organizationId) ||
        (grant.scopeType === 'facility' && grant.scopeId === facilityId)),
  );
}
