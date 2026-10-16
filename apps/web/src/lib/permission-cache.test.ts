import { expect, test } from 'bun:test';

import type { CareApi } from '@care/api-client';

import { getPermissionGrantsForTenant } from './permission-cache';

test('keeps permission lookups scoped to the selected tenant', async () => {
  const tenantHeaders: string[] = [];
  const api = {
    GET: async (_path: string, options: { params?: { header?: Record<string, string> } }) => {
      const tenantId = options.params?.header?.['X-Tenant-Id'];
      if (!tenantId) throw new Error('Tenant header is required');
      tenantHeaders.push(tenantId);
      return { data: [], error: undefined };
    },
  } as unknown as CareApi;

  await getPermissionGrantsForTenant(api, 'tenant-a');
  await getPermissionGrantsForTenant(api, 'tenant-b');

  expect(tenantHeaders).toEqual(['tenant-a', 'tenant-b']);
});
