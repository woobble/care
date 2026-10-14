import { getTranslations } from 'next-intl/server';

export default async function PlanningLoading() {
  const t = await getTranslations('Planning');

  return (
    <div role="status" aria-label={t('loading')} aria-busy="true" className="grid gap-6">
      <div aria-hidden="true" className="grid gap-3">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="h-16 animate-pulse rounded-xl border bg-card" />
      <div aria-hidden="true" className="h-28 animate-pulse rounded-xl border bg-card" />
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="h-48 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    </div>
  );
}
