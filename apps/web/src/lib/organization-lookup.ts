import { fetchCareApi } from '@app/web/lib/api';

type Organization = { id: string; name: string; timezone: string };

const MAX_BATCH_SIZE = 100;

export async function getOrganizationsByIds(ids: readonly string[]) {
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
        const response = await fetchCareApi(`/api/v1/organizations/search?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) return { items: [] as Organization[], failed: true };
        const payload = (await response.json()) as { items?: Organization[] };
        return { items: payload.items ?? [], failed: false };
      } catch {
        return { items: [] as Organization[], failed: true };
      }
    }),
  );

  return {
    items: results.flatMap((result) => result.items),
    failed: results.some((result) => result.failed),
  };
}
