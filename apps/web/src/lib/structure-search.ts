import { fetchCareApi } from '@app/web/lib/api';

export type StructureSearchEntity = 'organizations' | 'facilities' | 'teams';

export async function searchStructurePage<T>(
  entity: StructureSearchEntity,
  query: {
    page: number;
    pageSize: number;
    q?: string;
    organizationId?: string;
    facilityId?: string;
    status?: 'active' | 'archived';
  },
): Promise<{ items: T[]; page: number; pageSize: number; total: number; failed: boolean }> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'page' && key !== 'pageSize' && value) params.set(key, String(value));
  }
  try {
    const response = await fetchCareApi(`/api/v1/${entity}/search?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0, failed: true };
    }
    const payload = (await response.json()) as {
      items?: T[];
      page?: number;
      pageSize?: number;
      total?: number;
    };
    return {
      items: payload.items ?? [],
      page: payload.page ?? query.page,
      pageSize: payload.pageSize ?? query.pageSize,
      total: payload.total ?? 0,
      failed: false,
    };
  } catch {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0, failed: true };
  }
}
