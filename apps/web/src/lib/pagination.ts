import { redirect } from 'next/navigation';

export function redirectToValidPage(
  pathname: string,
  query: Record<string, string | undefined>,
  page: number,
  pageSize: number,
  totalItems: number,
  pageParam = 'page',
  pageSizeParam = 'pageSize',
): void {
  const lastPage = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = totalItems === 0 ? 1 : Math.min(page, lastPage);
  if (validPage === page) return;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value && key !== pageParam && key !== pageSizeParam) params.set(key, value);
  }
  params.set(pageParam, String(validPage));
  params.set(pageSizeParam, String(pageSize));
  redirect(`${pathname}?${params.toString()}`);
}
