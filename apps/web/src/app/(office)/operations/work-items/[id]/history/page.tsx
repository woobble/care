import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  categoryTranslationKey,
  type OperationsWorkItem,
} from '@app/web/app/(office)/operations/ui';
import { DataPagination } from '@app/web/components/data-pagination';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';

type SearchParams = Promise<{ page?: string; pageSize?: string }>;
const issueIdPattern = /^[a-f0-9]{64}$/i;

export default async function OperationsDeadlineHistoryPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const [{ id }, query, t, translate, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('Operations'),
    getTranslations(),
    getLocale(),
  ]);
  if (!issueIdPattern.test(id)) notFound();

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read'))
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );

  const page = positiveInteger(query.page, 1, 100_000, 1);
  const pageSize = positiveInteger(query.pageSize, 20, 100, 20);
  const { data: responseData, error } = await api.GET(
    '/api/v1/operations/work-items/{id}/history',
    {
      params: { path: { id }, query: { page, pageSize }, header },
    },
  );
  const data = responseData as
    | components['schemas']['OperationsExceptionHistoryResponseDto']
    | undefined;
  if (!data) notFound();

  const pageCount = Math.max(
    1,
    Math.ceil(data.totalOccurrences / data.pageSize),
    Math.ceil(data.totalInteractions / data.pageSize),
  );
  redirectToValidPage(
    `/operations/work-items/${id}/history`,
    query,
    page,
    data.pageSize,
    Math.max(data.totalOccurrences, data.totalInteractions),
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('exceptionHistoryTitle')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/operations/worklist">{t('worklistTitle')}</Link>
          </Button>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('loadFailed')}
        </p>
      ) : null}
      {!data.occurrences.length && !data.interactions.length ? (
        <EmptyState title={t('noDeadlineHistory')} />
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
                    className="grid gap-1 rounded-lg border bg-card p-4 text-sm"
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
              <EmptyState title={t('noDeadlineHistory')} />
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
                    className="grid gap-1 rounded-lg border bg-card p-4 text-sm"
                  >
                    <strong>
                      {interaction.action === 'acknowledged' ? t('acknowledged') : t('snoozed')}
                    </strong>
                    <span>
                      {formatDateTime(interaction.occurredAt, locale as 'en' | 'de')} ·{' '}
                      {t('activityBy', {
                        name: translate('Resources.unavailableUser'),
                      })}
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
              <EmptyState title={t('noActivity')} />
            )}
          </section>

          <DataPagination
            pathname={`/operations/work-items/${id}/history`}
            page={data.page}
            pageSize={data.pageSize}
            totalPages={pageCount}
            summaryLabel={t('pageOf', { page: data.page, pages: pageCount })}
            filters={{}}
          />
        </>
      )}
    </div>
  );
}

function positiveInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
