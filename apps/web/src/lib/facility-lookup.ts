import { fetchCareApi } from '@app/web/lib/api';

export type FacilityLookupItem = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
};

const MAX_BATCH_SIZE = 100;

export async function getFacilitiesByIds(ids: readonly string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const batches: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += MAX_BATCH_SIZE) {
    batches.push(uniqueIds.slice(index, index + MAX_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        ids: batch.join(','),
        page: '1',
        pageSize: String(batch.length),
      });
      try {
        const response = await fetchCareApi(`/api/v1/facilities/search?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) return { items: [] as FacilityLookupItem[], failed: true };
        const payload = (await response.json()) as { items?: FacilityLookupItem[] };
        return { items: payload.items ?? [], failed: false };
      } catch {
        return { items: [] as FacilityLookupItem[], failed: true };
      }
    }),
  );

  return {
    items: results.flatMap((result) => result.items),
    failed: results.some((result) => result.failed),
  };
}
