import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { EmptyState, PageHeader, SectionHeader, StatCard } from '@app/web/components/page-patterns';
import { categoryTranslationKey, issueTitleKey, workItemSourceHref } from './ui';

type SearchParams = Promise<{ organizationId?: string; facilityId?: string }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = [
  'scheduling',
  'visits',
  'documentation',
  'benefits',
  'billing',
  'claims',
  'onboarding',
  'agreements',
  'employees',
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
      <p role="alert" className="rounded-xl border border-border bg-card p-5">
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
    <div className="grid min-w-0 gap-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('dashboardTitle')}
        description={t('dashboardSubtitle')}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={operationsHref('/operations/worklist', scope)}>{t('openWorklist')}</Link>
            </Button>
            {hasPermission(permissions, 'operations.tasks.create') ? (
              <Button asChild>
                <Link href={operationsHref('/operations/tasks', scope)}>{t('createTask')}</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={operationsHref('/operations/deadlines', scope)}>
                {t('deadlinesTitle')}
              </Link>
            </Button>
            {hasPermission(permissions, 'operations.recurring_tasks.manage') ? (
              <Button asChild variant="outline">
                <Link href={operationsHref('/operations/recurring-tasks', scope)}>
                  {t('recurringTasks')}
                </Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'operations.reminder_settings.manage') ? (
              <Button asChild variant="outline">
                <Link href="/operations/reminder-settings">{t('reminderSettings')}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {dashboardResult.error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-red-50 p-4 text-red-900"
        >
          {translate(errorMessageKey(dashboardResult.error.code))}
        </p>
      ) : null}
      {dashboard ? (
        <>
          {dashboard.worklistTruncated ? (
            <p
              role="status"
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            >
              {t('truncated')}
            </p>
          ) : null}

          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.9fr)]">
            <Card>
              <CardHeader>
                <SectionHeader
                  title={t('dashboardExceptions')}
                  description={t('systemIssueHelp')}
                  action={
                    <Button asChild variant="ghost" size="sm">
                      <Link href={operationsHref('/operations/worklist', scope)}>
                        {t('openWorklist')}
                      </Link>
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category) => (
                  <StatCard
                    key={category}
                    href={operationsHref(
                      category === 'agreements' ||
                        category === 'employees' ||
                        category === 'benefits' ||
                        category === 'billing'
                        ? '/operations/deadlines'
                        : '/operations/worklist',
                      scope,
                      { category },
                    )}
                    label={t(categoryTranslationKey(category))}
                    value={dashboard.categoryCounts[category] ?? 0}
                  />
                ))}
              </CardContent>
            </Card>

            <div className="grid content-start gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>{t('deadlinesTitle')}</CardTitle>
                  <CardDescription>{t('deadlinesDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1 2xl:gap-2">
                  <CounterLink
                    href={operationsHref('/operations/deadlines', scope, { due: 'overdue' })}
                    label={t('overdue')}
                    count={dashboard.deadlineCounts.overdue ?? 0}
                  />
                  <CounterLink
                    href={operationsHref('/operations/deadlines', scope, { due: 'today' })}
                    label={t('dueToday')}
                    count={dashboard.deadlineCounts.today ?? 0}
                  />
                  <CounterLink
                    href={operationsHref('/operations/deadlines', scope, { due: 'upcoming' })}
                    label={t('upcoming')}
                    count={dashboard.deadlineCounts.upcoming ?? 0}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboardTasks')}</CardTitle>
                  <CardDescription>{t('manualTaskHelp')}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
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
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <SectionHeader
                title={t('severity')}
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href={operationsHref('/operations/worklist', scope)}>
                      {t('openWorklist')}
                    </Link>
                  </Button>
                }
              />
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('mostRelevant')}</CardTitle>
              <CardDescription>{t('systemIssueHelp')}</CardDescription>
            </CardHeader>
            <CardContent>
              {dashboard.highPriorityExceptions.length ? (
                <ul className="grid gap-2">
                  {dashboard.highPriorityExceptions.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={workItemSourceHref(item)}
                        className="grid gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      >
                        <span className="grid min-w-0 gap-1">
                          <span className="truncate font-semibold">
                            {t(`issueTitles.${issueTitleKey(item.issueCode)}`)}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {item.clientName ?? t(categoryTranslationKey(item.category))}{' '}
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
                        <Badge variant={severityVariant(item.severity)}>{t(item.severity)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={t('worklistEmpty')} />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      {!dashboard && !dashboardResult.error ? (
        <p
          role="alert"
          className="rounded-xl border border-border bg-card p-5 text-muted-foreground"
        >
          {t('loadFailed')}
        </p>
      ) : null}
    </div>
  );
}

function CounterLink({ href, label, count }: { href: string; label: string; count: number }) {
  return <StatCard href={href} label={label} value={count} />;
}

function severityVariant(severity: 'critical' | 'warning' | 'info') {
  if (severity === 'critical') return 'destructive' as const;
  if (severity === 'warning') return 'warning' as const;
  return 'secondary' as const;
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
