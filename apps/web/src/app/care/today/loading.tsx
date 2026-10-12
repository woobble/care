import { getTranslations } from 'next-intl/server';
import { Skeleton } from '@care/ui';

export default async function CareTodayLoading() {
  const t = await getTranslations('Caregiver');

  return (
    <div className="grid min-w-0 gap-4" aria-busy="true" aria-describedby="care-today-loading">
      <p id="care-today-loading" role="status" className="text-sm text-muted-foreground">
        {t('loadingVisits')}
      </p>
      <div className="grid gap-3" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
          >
            <Skeleton className="h-9 w-20" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-3/4 max-w-sm" />
            </div>
            <Skeleton className="h-10 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
