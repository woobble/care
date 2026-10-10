import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { issueTitleKey, workItemSourceHref } from './ui';

type SearchParams = Promise<{ organizationId?: string; facilityId?: string }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = [
  'scheduling',
  'visits',
  'documentation',
  'benefits',
  'billing',
  'claims',
] as const;

export default async function OperationsDashboardPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [t, translate, locale] = await Promise.all([
    getTranslations('Operations'),
    getTranslations(),
    getLocale(),
  ]);
  const query = await searchParams;
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const scope = {
    ...(organizationId ? { organizationId } : {}),
    ...(facilityId ? { facilityId } : {}),
  };
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read')) {
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  }
  const [dashboardResult, organizationsResult] = await Promise.all([
    api.GET('/api/v1/operations/dashboard', {
      params: {
        query: {
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
        },
        header,
      },
    }),
    api.GET('/api/v1/organizations', { params: { header } }),
  ]);
  const dashboard = dashboardResult.data;
  const timezoneByOrganization = new Map(
    (organizationsResult.data ?? []).map((organization) => [
      organization.id,
      organization.timezone,
    ]),
  );

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('title')}
          </p>
          <h1 className="text-3xl font-semibold">{t('dashboardTitle')}</h1>
          <p className="max-w-3xl text-slate-700">{t('dashboardSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href={operationsHref('/operations/worklist', scope)}>{t('openWorklist')}</Link>
          </Button>
          {hasPermission(permissions, 'operations.tasks.create') ? (
            <Button asChild>
              <Link href={operationsHref('/operations/tasks', scope)}>{t('createTask')}</Link>
            </Button>
          ) : null}
        </div>
      </header>

      {dashboardResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {translate(errorMessageKey(dashboardResult.error.code))}
        </p>
      ) : null}
      {dashboard ? (
        <>
          {dashboard.worklistTruncated ? (
            <p
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
            >
              {t('truncated')}
            </p>
          ) : null}
          <section aria-labelledby="attention-title" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="attention-title" className="text-xl font-semibold">
                {t('dashboardExceptions')}
              </h2>
              <Link
                className="text-sm font-medium text-blue-800 underline"
                href={operationsHref('/operations/worklist', scope)}
              >
                {t('openWorklist')}
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <Link
                  key={category}
                  href={operationsHref('/operations/worklist', scope, { category })}
                  className="rounded-lg border bg-white p-4 hover:border-blue-400"
                >
                  <span className="text-sm text-slate-600">{t(category)}</span>
                  <strong className="mt-1 block text-2xl">
                    {dashboard.categoryCounts[category] ?? 0}
                  </strong>
                </Link>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <CounterLink
                href={operationsHref('/operations/worklist', scope, { severity: 'critical' })}
                label={t('critical')}
                count={dashboard.severityCounts.critical ?? 0}
              />
              <CounterLink
                href={operationsHref('/operations/worklist', scope, { severity: 'warning' })}
                label={t('warning')}
                count={dashboard.severityCounts.warning ?? 0}
              />
              <CounterLink
                href={operationsHref('/operations/worklist', scope, { severity: 'info' })}
                label={t('info')}
                count={dashboard.severityCounts.info ?? 0}
              />
            </div>
          </section>

          <section aria-labelledby="my-tasks-title" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="my-tasks-title" className="text-xl font-semibold">
                {t('dashboardTasks')}
              </h2>
              <Link
                className="text-sm font-medium text-blue-800 underline"
                href={operationsHref('/operations/tasks', scope, { assignedToMe: 'true' })}
              >
                {t('assignedToMe')}
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CounterLink
                href={operationsHref('/operations/tasks', scope, { assignedToMe: 'true' })}
                label={t('assignedToMe')}
                count={dashboard.tasks.assignedToMe ?? 0}
              />
              <CounterLink
                href={operationsHref('/operations/tasks', scope, {
                  assignedToMe: 'true',
                  due: 'today',
                })}
                label={t('dueToday')}
                count={dashboard.tasks.dueToday ?? 0}
              />
              <CounterLink
                href={operationsHref('/operations/tasks', scope, {
                  assignedToMe: 'true',
                  due: 'overdue',
                })}
                label={t('overdue')}
                count={dashboard.tasks.overdue ?? 0}
              />
              <CounterLink
                href={operationsHref('/operations/tasks', scope, {
                  assignedToMe: 'true',
                  priority: 'urgent',
                })}
                label={t('urgent')}
                count={dashboard.tasks.urgent ?? 0}
              />
            </div>
          </section>

          <section aria-labelledby="priority-items-title" className="grid gap-3">
            <h2 id="priority-items-title" className="text-xl font-semibold">
              {t('mostRelevant')}
            </h2>
            <p className="text-sm text-slate-600">{t('systemIssueHelp')}</p>
            {dashboard.highPriorityExceptions.length ? (
              <ul className="grid gap-3">
                {dashboard.highPriorityExceptions.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={workItemSourceHref(item)}
                      className="grid gap-2 rounded-lg border bg-white p-4 hover:border-blue-400 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <span className="grid gap-1">
                        <span className="font-semibold">
                          {t(`issueTitles.${issueTitleKey(item.issueCode)}`)}
                        </span>
                        <span className="text-sm text-slate-600">
                          {item.clientName ?? t(item.category)} ·{' '}
                          {item.dueAt
                            ? formatDateTime(
                                item.dueAt,
                                locale as Locale,
                                timezoneByOrganization.get(item.organizationId ?? '') ??
                                  'Europe/Berlin',
                              )
                            : t('noDueDate')}
                        </span>
                      </span>
                      <span
                        className={`w-fit rounded-full px-3 py-1 text-sm ${item.severity === 'critical' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-950'}`}
                      >
                        {t(item.severity)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border bg-white p-5">
                <p>{t('worklistEmpty')}</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function CounterLink({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link href={href} className="rounded-lg border bg-white p-4 hover:border-blue-400">
      <span className="text-sm text-slate-600">{label}</span>
      <strong className="mt-1 block text-2xl">{count}</strong>
    </Link>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function operationsHref(
  path: string,
  scope: { organizationId?: string; facilityId?: string },
  filters: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  if (scope.organizationId) params.set('organizationId', scope.organizationId);
  if (scope.facilityId) params.set('facilityId', scope.facilityId);
  for (const [name, value] of Object.entries(filters)) params.set(name, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
