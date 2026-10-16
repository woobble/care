import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { auth } from '@app/web/auth';
import { getPermissionGrantsForTenant } from '@app/web/lib/permission-cache';
import { createCareApi } from '@care/api-client';
import type { CareApi } from '@care/api-client';
import type { ApiClientOptions } from '@care/api-client';
import type { PermissionGrantDto } from '@care/api-client';
import { loadWebConfig } from '@care/config';

import { buildCareApiUrl } from './api-routes';
import type { CareApiRequest } from './api-routes';

const getRequestHeaders = cache(() => headers());

export const getAuthSession = cache(async () =>
  auth.api.getSession({ headers: await getRequestHeaders() }),
);

const requestAuthentication = cache(async () => {
  const requestHeaders = await getRequestHeaders();
  if (!(await getAuthSession())) redirect('/');

  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
  const account = accounts.find((item) => item.providerId === 'authentik');
  if (!account) redirect('/?error=auth');

  const token = await auth.api
    .getAccessToken({ headers: requestHeaders, body: { accountId: account.id } })
    .catch(() => redirect('/?error=auth'));

  const config = loadWebConfig();
  return {
    baseUrl: config.API_INTERNAL_URL,
    accessToken: token.accessToken,
    ...(requestHeaders.get('x-request-id')
      ? { requestId: requestHeaders.get('x-request-id')! }
      : {}),
    ...(requestHeaders.get('x-correlation-id')
      ? { correlationId: requestHeaders.get('x-correlation-id')! }
      : {}),
  };
});

const apiClientOptions = cache(async (requireTenant: boolean): Promise<ApiClientOptions> => {
  const authentication = await requestAuthentication();
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (requireTenant && !tenantId) redirect('/');
  return {
    ...authentication,
    ...(requireTenant && tenantId ? { tenantId } : {}),
  };
});

const createRequestApiClient = cache(async (requireTenant: boolean) =>
  createCareApi(await apiClientOptions(requireTenant)),
);

export function getApiClient(requireTenant = true) {
  return createRequestApiClient(requireTenant);
}

export async function fetchCareApi(request: CareApiRequest): Promise<Response> {
  const options = await apiClientOptions(true);
  const requestHeaders = new Headers(request.init?.headers);
  requestHeaders.set('Authorization', `Bearer ${options.accessToken}`);
  requestHeaders.set('X-Tenant-Id', options.tenantId!);
  if (options.requestId) requestHeaders.set('X-Request-Id', options.requestId);
  if (options.correlationId) requestHeaders.set('X-Correlation-Id', options.correlationId);
  return fetch(buildCareApiUrl(request, options.baseUrl), {
    ...request.init,
    headers: requestHeaders,
  });
}

const getTenantHeaderForRequest = cache(async (): Promise<{ 'X-Tenant-Id': string }> => {
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (!tenantId) redirect('/');
  return { 'X-Tenant-Id': tenantId };
});

export function getTenantHeader(): Promise<{ 'X-Tenant-Id': string }> {
  return getTenantHeaderForRequest();
}

export async function getPermissionGrants(api?: CareApi) {
  const client = api ?? (await getApiClient());
  const tenantHeader = await getTenantHeader();
  return getPermissionGrantsForTenant(client, tenantHeader['X-Tenant-Id']);
}

export type CurrentPermissionGrant = PermissionGrantDto;

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
  teamId: string | null = null,
): boolean {
  return grants.some(
    (grant) =>
      grant.permission === permission &&
      ((grant.scopeType === 'tenant' && grant.scopeId === tenantId) ||
        (grant.scopeType === 'organization' && grant.scopeId === organizationId) ||
        (grant.scopeType === 'facility' && grant.scopeId === facilityId) ||
        (grant.scopeType === 'team' && grant.scopeId === teamId)),
  );
}
