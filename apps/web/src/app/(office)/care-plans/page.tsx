import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { formatDate } from '../../../i18n/format';
import { getApiClient, getTenantHeader } from '../../../lib/api';

type SearchParams = Promise<{
  status?: string;
  clientQuery?: string;
  facilityId?: string;
  evaluationOverdue?: string;
  evaluationDueBefore?: string;
  page?: string;
}>;

const planStatuses = ['draft', 'active', 'under_review', 'ended'] as const;
const statusKeys = {
  draft: 'statuses.draft',
  active: 'statuses.active',
  under_review: 'statuses.underReview',
  ended: 'statuses.ended',
} as const;
const evaluationResultKeys = {
  effective: 'statuses.effective',
  partially_effective: 'statuses.partiallyEffective',
  not_effective: 'statuses.notEffective',
  changed_condition: 'statuses.changedCondition',
  no_change: 'statuses.noChange',
} as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CarePlansPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, common, locale] = await Promise.all([
    getTranslations('CarePlanning'),
    getTranslations('Common'),
    getLocale(),
  ]);
  const status = planStatuses.find((value) => value === query.status);
  const clientQuery = validSearchText(query.clientQuery, 120);
  const facilityId = validUuid(query.facilityId);
  const evaluationOverdue = query.evaluationOverdue === 'true' ? true : undefined;
  const evaluationDueBefore = validDate(query.evaluationDueBefore);
  const page = positivePage(query.page);
  const pageSize = 25;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [plansResult, facilitiesResult] = await Promise.all([
    get('/api/v1/care-plans', {
      params: {
        query: {
          page,
          pageSize,
          ...(status ? { status } : {}),
          ...(clientQuery ? { clientQuery } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(evaluationOverdue ? { evaluationOverdue } : {}),
          ...(evaluationDueBefore ? { evaluationDueBefore } : {}),
        },
        header,
      },
    }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  const rows = plansResult.data?.items ?? [];
  const facilities = facilitiesResult.data ?? [];
  const loadFailed = plansResult.error !== undefined || facilitiesResult.error !== undefined;
  const filterHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (clientQuery) params.set('clientQuery', clientQuery);
    if (facilityId) params.set('facilityId', facilityId);
    if (evaluationOverdue) params.set('evaluationOverdue', 'true');
    if (evaluationDueBefore) params.set('evaluationDueBefore', evaluationDueBefore);
    params.set('page', String(nextPage));
    return `/care-plans?${params.toString()}`;
  };
  const total = plansResult.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('client.title')}
        </p>
        <h1 className="text-3xl font-semibold">{t('worklist.title')}</h1>
        <p className="text-slate-700">{t('worklist.description')}</p>
      </header>

      <form
        method="get"
        className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="grid gap-1 text-sm">
          <span>{t('worklist.status')}</span>
          <select name="status" defaultValue={status ?? ''} className="h-10 rounded-md border px-3">
            <option value="">{t('worklist.allStatuses')}</option>
            {planStatuses.map((value) => (
              <option key={value} value={value}>
                {t(statusKeys[value])}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('worklist.client')}</span>
          <input
            type="search"
            name="clientQuery"
            maxLength={120}
            defaultValue={clientQuery ?? ''}
            className="h-10 rounded-md border px-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('worklist.facility')}</span>
          <select
            name="facilityId"
            defaultValue={facilityId ?? ''}
            className="h-10 rounded-md border px-3"
          >
            <option value="">{t('worklist.allFacilities')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t('worklist.evaluationDueBefore')}</span>
          <input
            type="date"
            name="evaluationDueBefore"
            defaultValue={evaluationDueBefore ?? ''}
            className="h-10 rounded-md border px-3"
          />
        </label>
        <div className="grid content-end gap-2">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="evaluationOverdue"
              value="true"
              defaultChecked={evaluationOverdue}
            />
            {t('worklist.evaluationOverdue')}
          </label>
          <input type="hidden" name="page" value="1" />
          <Button type="submit" variant="secondary">
            {t('worklist.applyFilters')}
          </Button>
        </div>
      </form>

      {loadFailed ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('worklist.loadFailed')}
        </p>
      ) : rows.length ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50">
              <tr>
                <th scope="col" className="p-3">
                  {t('worklist.client')}
                </th>
                <th scope="col" className="p-3">
                  {t('worklist.facility')}
                </th>
                <th scope="col" className="p-3">
                  {t('worklist.status')}
                </th>
                <th scope="col" className="p-3">
                  {t('worklist.validFrom')}
                </th>
                <th scope="col" className="p-3">
                  {t('worklist.validUntil')}
                </th>
                <th scope="col" className="p-3">
                  {t('worklist.nextEvaluationDue')}
                </th>
                <th scope="col" className="p-3">
                  {t('worklist.latestEvaluation')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((plan) => (
                <tr key={plan.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      className="font-semibold text-blue-900 underline"
                      href={`/clients/${plan.clientId}/care-plan?planId=${plan.id}`}
                    >
                      {plan.clientDisplayName}
                    </Link>
                  </td>
                  <td className="p-3">{plan.facilityName}</td>
                  <td className="p-3">{t(statusKeys[plan.status])}</td>
                  <td className="p-3">{formatDate(plan.validFrom, locale) ?? '–'}</td>
                  <td className="p-3">{formatDate(plan.validUntil, locale) ?? '–'}</td>
                  <td className="p-3">
                    {formatDate(plan.latestEvaluation?.nextEvaluationDue ?? null, locale) ?? '–'}
                  </td>
                  <td className="p-3">
                    {plan.latestEvaluation
                      ? `${t(evaluationResultKeys[plan.latestEvaluation.result])} · ${formatDate(plan.latestEvaluation.evaluatedAt, locale) ?? ''}`
                      : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border bg-white p-4 text-slate-700">{t('worklist.empty')}</p>
      )}

      {pageCount > 1 ? (
        <nav aria-label={t('worklist.title')} className="flex items-center justify-between">
          <span className="text-sm text-slate-600">{`${page} / ${pageCount}`}</span>
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={filterHref(page - 1)}>{common('actions.previous')}</Link>
            </Button>
          ) : (
            <span />
          )}
          {page < pageCount ? (
            <Button asChild variant="secondary">
              <Link href={filterHref(page + 1)}>{common('actions.next')}</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function validSearchText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function positivePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
