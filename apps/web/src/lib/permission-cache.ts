import { cache } from 'react';

import type { CareApi, PermissionGrantDto } from '@care/api-client';

export const getPermissionGrantsForTenant = cache(
  async (api: CareApi, tenantId: string): Promise<PermissionGrantDto[]> => {
    const { data, error } = await api.GET('/api/v1/me/permissions', {
      params: { header: { 'X-Tenant-Id': tenantId } },
    });
    return error ? [] : ((data as unknown as PermissionGrantDto[] | undefined) ?? []);
  },
);
