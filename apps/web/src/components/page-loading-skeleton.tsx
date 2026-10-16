import { getTranslations } from 'next-intl/server';

import { Skeleton } from '@care/ui/components/skeleton';

export async function PageLoadingSkeleton() {
  const t = await getTranslations('Common');
  return (
    <main role="status" aria-live="polite" aria-busy="true" className="grid gap-6">
      <span className="sr-only">{t('loadingPage')}</span>
      <div aria-hidden="true" className="grid gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div aria-hidden="true" className="grid gap-3 rounded-lg border bg-card p-5">
        <Skeleton className="h-6 w-48 max-w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-3">
        <Skeleton className="h-6 w-40 max-w-full" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </main>
  );
}
