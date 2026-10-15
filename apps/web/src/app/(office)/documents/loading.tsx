import { getTranslations } from 'next-intl/server';

export default async function DocumentsLoading() {
  const t = await getTranslations('Documents');

  return (
    <div role="status" aria-label={t('workspace.loading')} aria-busy="true" className="grid gap-6">
      <div aria-hidden="true" className="grid gap-3">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="h-52 animate-pulse rounded-xl border bg-card" />
      <div aria-hidden="true" className="grid gap-3">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-16 animate-pulse rounded-lg border bg-card" />
        ))}
      </div>
    </div>
  );
}
