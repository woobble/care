import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import {
  categoryTranslationKey,
  type OperationsWorkItem,
} from '@app/web/app/(office)/operations/ui';

type SearchParams = Promise<{ page?: string }>;
const issueIdPattern = /^[a-f0-9]{64}$/i;

export default async function OperationsDeadlineHistoryPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const [{ id }, query, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('Operations'),
    getLocale(),
  ]);
  if (!issueIdPattern.test(id)) notFound();

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read'))
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );

  const page = Math.max(1, Math.min(100_000, Number.parseInt(query.page ?? '1', 10) || 1));
  const { data, error } = await api.GET('/api/v1/operations/work-items/{id}/history', {
    params: { path: { id }, query: { page, pageSize: 25 }, header },
  });
  if (!data) notFound();

  const pageCount = Math.max(
    1,
    Math.ceil(data.totalOccurrences / data.pageSize),
    Math.ceil(data.totalInteractions / data.pageSize),
  );

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('deadlinesTitle')}
          </p>
          <h1 className="text-3xl font-semibold">{t('deadlineHistoryTitle')}</h1>
        </div>
        <Button asChild variant="secondary">
          <Link href="/operations/deadlines">{t('deadlinesTitle')}</Link>
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}
      {!data.occurrences.length && !data.interactions.length ? (
        <p className="rounded-lg border bg-white p-5">{t('noDeadlineHistory')}</p>
      ) : (
        <>
          <section aria-labelledby="occurrences-title" className="grid gap-3">
            <h2 id="occurrences-title" className="text-xl font-semibold">
              {t('occurrenceHistory')}
            </h2>
            {data.occurrences.length ? (
              <ol className="grid gap-3">
                {data.occurrences.map((occurrence) => (
                  <li
                    key={occurrence.id}
                    className="grid gap-1 rounded-lg border bg-white p-4 text-sm"
                  >
                    <strong>
                      {t(occurrence.resolvedAt ? 'resolvedOccurrence' : 'currentOccurrence')}
                    </strong>
                    <span>
                      {t('category')}:{' '}
                      {t(
                        categoryTranslationKey(
                          occurrence.category as OperationsWorkItem['category'],
                        ),
                      )}
                    </span>
                    <span>
                      {t('firstDetected')}:{' '}
                      {formatDateTime(occurrence.firstDetectedAt, locale as 'en' | 'de')}
                    </span>
                    <span>
                      {t('lastObserved')}:{' '}
                      {formatDateTime(occurrence.lastObservedAt, locale as 'en' | 'de')}
                    </span>
                    {occurrence.resolvedAt ? (
                      <span>
                        {t('resolvedAt')}:{' '}
                        {formatDateTime(occurrence.resolvedAt, locale as 'en' | 'de')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border bg-white p-4">{t('noDeadlineHistory')}</p>
            )}
          </section>

          <section aria-labelledby="interactions-title" className="grid gap-3">
            <h2 id="interactions-title" className="text-xl font-semibold">
              {t('interactionHistory')}
            </h2>
            {data.interactions.length ? (
              <ol className="grid gap-3">
                {data.interactions.map((interaction) => (
                  <li
                    key={interaction.id}
                    className="grid gap-1 rounded-lg border bg-white p-4 text-sm"
                  >
                    <strong>
                      {interaction.action === 'acknowledged' ? t('acknowledged') : t('snoozed')}
                    </strong>
                    <span>
                      {formatDateTime(interaction.occurredAt, locale as 'en' | 'de')} ·{' '}
                      {t('activityBy', { userId: interaction.actorUserId })}
                    </span>
                    {interaction.snoozedUntil ? (
                      <span>
                        {t('snoozedUntil')}:{' '}
                        {formatDateTime(interaction.snoozedUntil, locale as 'en' | 'de')}
                      </span>
                    ) : null}
                    {interaction.reason ? <p>{interaction.reason}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border bg-white p-4">{t('noActivity')}</p>
            )}
          </section>

          {pageCount > 1 ? (
            <nav aria-label={t('issuePages')} className="flex items-center justify-between">
              {page > 1 ? (
                <Link
                  className="text-blue-800 underline"
                  href={`/operations/work-items/${id}/history?page=${page - 1}`}
                >
                  {t('previousPage')}
                </Link>
              ) : (
                <span className="text-slate-400">{t('previousPage')}</span>
              )}
              <span>{t('pageOf', { page: data.page, pages: pageCount })}</span>
              {page < pageCount ? (
                <Link
                  className="text-blue-800 underline"
                  href={`/operations/work-items/${id}/history?page=${page + 1}`}
                >
                  {t('nextPage')}
                </Link>
              ) : (
                <span className="text-slate-400">{t('nextPage')}</span>
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
