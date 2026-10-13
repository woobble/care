import Link from 'next/link';
import { CalendarDays, ClipboardCheck, FileCheck2, type LucideIcon } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@care/ui';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDateTime } from '@app/web/i18n/format';
import { formatVisitTime, todayRange } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { EmptyState, PageHeader, SectionHeader } from '@app/web/components/page-patterns';
import { ResourceCardLink } from '@app/web/components/resource-reference';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import type { components } from '@care/api-client';
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
  const tenantId = header['X-Tenant-Id'];
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read')) {
    return (
      <p role="alert" className="rounded-xl border border-border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }
  const dashboardResult = await api.GET('/api/v1/operations/dashboard', {
    params: {
      query: {
        ...(organizationId ? { organizationId } : {}),
        ...(facilityId ? { facilityId } : {}),
      },
      header,
    },
  });
  const dashboard = dashboardResult.data as
    | components['schemas']['OperationsDashboardResponseDto']
    | undefined;
  const canReadSchedule = hasPermission(permissions, 'schedule.read');
  const selectedOrganization = organizationId
    ? await getOrganizationsByIds([organizationId])
    : { items: [], failed: false };
  const workday = todayRange(
    (organizationId && selectedOrganization.items[0]?.timezone) || 'Europe/Berlin',
  );
  const scheduledVisitsResults = canReadSchedule
    ? await Promise.all(
        (['planned', 'confirmed'] as const).map((status) =>
          api.GET('/api/v1/visits', {
            params: {
              query: {
                from: workday.from,
                until: workday.until,
                page: 1,
                pageSize: 6,
                status,
                sortBy: 'plannedStart',
                sortOrder: 'asc',
                ...(organizationId ? { organizationId } : {}),
                ...(facilityId ? { facilityId } : {}),
              },
              header,
            },
          }),
        ),
      )
    : null;
  const scheduledVisitPages = (scheduledVisitsResults ?? []).map(
    (result) => result.data as components['schemas']['VisitListResponseDto'] | undefined,
  );
  const scheduledVisitCount = scheduledVisitsResults?.every(
    (result, index) => !result.error && scheduledVisitPages[index],
  )
    ? scheduledVisitPages.reduce((total, result) => total + (result?.total ?? 0), 0)
    : null;
  const todayVisits = scheduledVisitPages
    .flatMap((result) => result?.items ?? [])
    .sort((left, right) => left.plannedStart.localeCompare(right.plannedStart));
  const organizationIds = [
    ...new Set([
      ...(organizationId ? [organizationId] : []),
      ...(dashboard?.highPriorityExceptions.flatMap((item) =>
        item.organizationId ? [item.organizationId] : [],
      ) ?? []),
      ...todayVisits.map((visit) => visit.organizationId),
    ]),
  ];
  const organizationsResult = await getOrganizationsByIds(
    organizationIds.filter((id) => id !== organizationId),
  );
  const timezoneByOrganization = new Map(
    [...selectedOrganization.items, ...organizationsResult.items].map((organization) => [
      organization.id,
      organization.timezone,
    ]),
  );
  const scheduleUnavailable = Boolean(
    canReadSchedule && scheduledVisitsResults?.some((result) => result.error || !result.data),
  );

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        eyebrow={t('title')}
        title={t('dashboardTitle')}
        description={t('dashboardSubtitle')}
        actions={
          hasPermission(permissions, 'operations.tasks.create') ? (
            <Button asChild>
              <Link href={operationsHref('/operations/tasks', scope)}>{t('createTask')}</Link>
            </Button>
          ) : null
        }
      />

      {dashboardResult.error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive"
        >
          {translate(
            errorMessageKey(
              (dashboardResult.error as { code?: string } | undefined)?.code ?? 'UNKNOWN_ERROR',
            ),
          )}
        </p>
      ) : null}
      {dashboard ? (
        <div className="grid min-w-0 gap-5">
          {dashboard.worklistTruncated ? (
            <p
              role="status"
              className="rounded-xl border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground"
            >
              {t('truncated')}
            </p>
          ) : null}

          <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
            {canReadSchedule ? (
              <MetricTile
                href={operationsHref('/planning', scope)}
                icon={CalendarDays}
                label={t('scheduledVisits')}
                value={scheduledVisitCount}
                unavailableLabel={t('scheduledVisitsUnavailable')}
              />
            ) : null}
            <MetricTile
              href={operationsHref('/operations/worklist', scope, { category: 'visits' })}
              icon={CalendarDays}
              label={t('visitAttention')}
              value={dashboard.categoryCounts.visits ?? 0}
            />
            <MetricTile
              href={operationsHref('/operations/tasks', scope, { due: 'overdue' })}
              icon={ClipboardCheck}
              label={t('overdueTasks')}
              value={dashboard.tasks.overdue ?? 0}
              emphasis
              className="hidden sm:block"
            />
            <MetricTile
              href={operationsHref('/operations/worklist', scope, { category: 'documentation' })}
              icon={FileCheck2}
              label={t('documentationAttention')}
              value={dashboard.categoryCounts.documentation ?? 0}
              className="hidden sm:block"
            />
          </div>

          <div
            className={`grid min-w-0 gap-4 ${canReadSchedule ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.9fr)]' : ''}`}
          >
            {canReadSchedule ? (
              <Card className="order-2 lg:order-1">
                <CardHeader>
                  <SectionHeader
                    title={t('scheduleTitle')}
                    description={t('scheduleDescription')}
                    action={
                      <Button asChild variant="ghost" size="sm">
                        <Link href={operationsHref('/planning', scope)}>{t('openSchedule')}</Link>
                      </Button>
                    }
                  />
                </CardHeader>
                <CardContent>
                  {scheduleUnavailable ? (
                    <p
                      role="status"
                      className="rounded-lg border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground"
                    >
                      {t('scheduleUnavailable')}
                    </p>
                  ) : todayVisits.length ? (
                    <ol className="grid gap-2" aria-label={t('scheduleTitle')}>
                      {todayVisits.slice(0, 5).map((visit) => {
                        const visitHref = hasClientPermission(
                          permissions,
                          'schedule.read',
                          tenantId,
                          visit.organizationId,
                          visit.facilityId,
                        )
                          ? `/visits/${visit.id}`
                          : null;
                        const assignedEmployees = visit.assignments
                          .filter((assignment) => assignment.status === 'active')
                          .map((assignment) => assignment.employeeDisplayName);
                        return (
                          <li key={visit.id}>
                            <ResourceCardLink
                              href={visitHref}
                              className="grid min-w-0 gap-2 rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-4"
                            >
                              <time
                                dateTime={visit.plannedStart}
                                className="text-sm font-semibold tabular-nums text-foreground"
                              >
                                {formatVisitTime(visit.plannedStart, visit.timezone, locale)}
                                <span className="px-1 text-muted-foreground" aria-hidden="true">
                                  –
                                </span>
                                {formatVisitTime(visit.plannedEnd, visit.timezone, locale)}
                              </time>
                              <span className="grid min-w-0 gap-0.5">
                                <span className="truncate text-sm font-semibold">
                                  {visit.clientDisplayName}
                                </span>
                                <span className="truncate text-xs text-muted-foreground sm:text-sm">
                                  {visit.services.map((service) => service.serviceName).join(' · ')}
                                  {assignedEmployees.length
                                    ? ` · ${assignedEmployees.join(', ')}`
                                    : ` · ${t('unassignedEmployee')}`}
                                </span>
                              </span>
                              <Badge
                                variant={visit.status === 'confirmed' ? 'secondary' : 'outline'}
                              >
                                {translate(
                                  visit.status === 'confirmed'
                                    ? 'Common.status.confirmed'
                                    : 'Common.status.planned',
                                )}
                              </Badge>
                            </ResourceCardLink>
                          </li>
                        );
                      })}
                    </ol>
                  ) : scheduledVisitCount === 0 ? (
                    <EmptyState title={t('noVisitsToday')} />
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t('scheduleUnavailable')}
                    </p>
                  )}
                  {scheduledVisitCount !== null && scheduledVisitCount > 5 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('moreVisits', { count: scheduledVisitCount - 5 })}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <Card className={canReadSchedule ? 'order-1 lg:order-2' : undefined}>
              <CardHeader>
                <SectionHeader
                  title={t('mostRelevant')}
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
              <CardContent>
                {dashboard.highPriorityExceptions.length ? (
                  <ul className="grid gap-2">
                    {dashboard.highPriorityExceptions.slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <Link
                          href={workItemSourceHref(item)}
                          className="grid min-w-0 gap-2 rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4"
                        >
                          <span className="grid min-w-0 gap-1">
                            <span className="truncate text-sm font-semibold">
                              {t(`issueTitles.${issueTitleKey(item.issueCode)}`)}
                            </span>
                            <span className="truncate text-xs text-muted-foreground sm:text-sm">
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

            <div
              className={`order-3 grid min-w-0 content-start gap-4 sm:grid-cols-2 ${canReadSchedule ? 'lg:order-3 lg:col-span-2' : ''}`}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('deadlinesTitle')}</CardTitle>
                  <CardDescription>{t('deadlinesDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-1">
                  <CounterRow
                    href={operationsHref('/operations/deadlines', scope, { due: 'today' })}
                    label={t('dueToday')}
                    count={dashboard.deadlineCounts.today ?? 0}
                  />
                  <CounterRow
                    href={operationsHref('/operations/deadlines', scope, { due: 'upcoming' })}
                    label={t('upcoming')}
                    count={dashboard.deadlineCounts.upcoming ?? 0}
                  />
                  <Link
                    href={operationsHref('/operations/deadlines', scope)}
                    className="mt-1 flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('openDeadlines')}
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('dashboardTasks')}</CardTitle>
                  <CardDescription>{t('manualTaskHelp')}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-1">
                  <CounterRow
                    href={operationsHref('/operations/tasks', scope, { priority: 'urgent' })}
                    label={t('urgentTasks')}
                    count={dashboard.tasks.urgent ?? 0}
                  />
                  <CounterRow
                    href={operationsHref('/operations/tasks', scope, { assignedToMe: 'true' })}
                    label={t('assignedToMe')}
                    count={dashboard.tasks.assignedToMe ?? 0}
                  />
                  <CounterRow
                    href={operationsHref('/operations/tasks', scope, {
                      assignedToMe: 'true',
                      due: 'today',
                    })}
                    label={t('dueToday')}
                    count={dashboard.tasks.dueToday ?? 0}
                  />
                  <CounterRow
                    href={operationsHref('/operations/tasks', scope, {
                      assignedToMe: 'true',
                      due: 'overdue',
                    })}
                    label={t('overdue')}
                    count={dashboard.tasks.overdue ?? 0}
                  />
                  {hasPermission(permissions, 'operations.recurring_tasks.manage') ? (
                    <Link
                      href={operationsHref('/operations/recurring-tasks', scope)}
                      className="mt-1 flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t('recurringTasks')}
                    </Link>
                  ) : null}
                  {hasPermission(permissions, 'operations.reminder_settings.manage') ? (
                    <Link
                      href="/operations/reminder-settings"
                      className="flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t('reminderSettings')}
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <SectionHeader title={t('allWorkAreas')} />
            </CardHeader>
            <CardContent className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {categories.map((category) => (
                <WorkAreaLink
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
                  count={dashboard.categoryCounts[category] ?? 0}
                />
              ))}
            </CardContent>
          </Card>
        </div>
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

function MetricTile({
  href,
  icon: Icon,
  label,
  value,
  emphasis = false,
  className,
  unavailableLabel,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: number | null;
  emphasis?: boolean;
  className?: string;
  unavailableLabel?: string;
}) {
  return (
    <Link
      href={href}
      title={value === null ? unavailableLabel : undefined}
      aria-label={value === null ? `${label}: ${unavailableLabel}` : `${label}: ${value}`}
      className={`group block min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className ?? ''}`}
    >
      <Card
        className={
          'h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/35' +
          (emphasis ? ' border-primary/25' : '')
        }
      >
        <div className="flex min-w-0 items-start justify-between gap-2 p-3 sm:p-4">
          <div className="grid min-w-0 gap-1">
            <span className="line-clamp-2 text-xs font-medium leading-4 text-muted-foreground sm:text-sm">
              {label}
            </span>
            <strong className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
              {value ?? '—'}
            </strong>
          </div>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:size-9">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

function CounterRow({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums text-foreground">{count}</span>
    </Link>
  );
}

function WorkAreaLink({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="min-w-8 rounded-full bg-muted px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-foreground">
        {count}
      </span>
    </Link>
  );
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
