import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { ResourceCardLink } from '@app/web/components/resource-reference';
import {
  getApiClient,
  getTenantHeader,
  hasClientPermission,
  type CurrentPermissionGrant,
} from '@app/web/lib/api';
import { formatVisitDateTime } from '@app/web/lib/care-date';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';

export async function EmployeeVisitSection({
  employeeId,
  tenantId,
  permissions,
  canReadSchedule,
}: Readonly<{
  employeeId: string;
  tenantId: string;
  permissions: readonly CurrentPermissionGrant[];
  canReadSchedule: boolean;
}>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const { from, now, until } = employeeVisitRange();

  if (!canReadSchedule) {
    return (
      <section
        aria-labelledby="schedule-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="schedule-title" className="text-xl font-semibold">
          {t('Employees.detail.upcomingVisits')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('Employees.detail.visitsUnavailable')}</p>
      </section>
    );
  }

  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [visitsResult, recentVisitsResult] = await Promise.all([
    get('/api/v1/visits', {
      params: {
        query: {
          from: now.toISOString(),
          until: until.toISOString(),
          employeeId,
          page: 1,
          pageSize: 100,
        },
        header,
      },
    }),
    get('/api/v1/visits', {
      params: {
        query: {
          from: from.toISOString(),
          until: now.toISOString(),
          employeeId,
          page: 1,
          pageSize: 100,
        },
        header,
      },
    }),
  ]);
  const visitItems = visitsResult.data?.items ?? [];
  const recentVisitItems = recentVisitsResult.data?.items ?? [];
  const fetchExecutionSummaries = (items: typeof visitItems) =>
    items.length
      ? get('/api/v1/visit-executions/summaries', {
          params: { query: { visitIds: items.map((visit) => visit.id).join(',') }, header },
        })
      : Promise.resolve({
          data: [] as components['schemas']['VisitExecutionSummaryResponseDto'][],
          error: undefined,
        });
  const [executionSummariesResult, recentExecutionSummariesResult] = await Promise.all([
    fetchExecutionSummaries(visitItems),
    fetchExecutionSummaries(recentVisitItems),
  ]);
  const executionByVisitId = new Map(
    (executionSummariesResult.data ?? []).map((summary) => [summary.visitId, summary]),
  );
  const recentExecutionByVisitId = new Map(
    (recentExecutionSummariesResult.data ?? []).map((summary) => [summary.visitId, summary]),
  );
  const recentExecutionItems = recentVisitItems.filter(
    (visit) =>
      recentExecutionByVisitId.get(visit.id)?.executionStatus !== undefined &&
      recentExecutionByVisitId.get(visit.id)?.executionStatus !== 'not_started',
  );

  return (
    <section aria-labelledby="schedule-title" className="grid gap-3 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="schedule-title" className="text-xl font-semibold">
          {t('Employees.detail.upcomingVisits')}
        </h2>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/planning?employeeId=${employeeId}`}>
            {t('Employees.detail.openPlanning')}
          </Link>
        </Button>
      </div>
      {visitsResult.error ? (
        <p className="text-sm text-muted-foreground">{t('Employees.detail.visitsUnavailable')}</p>
      ) : visitItems.length ? (
        <ol className="grid gap-2">
          {visitItems.map((visit) => {
            const execution = executionByVisitId.get(visit.id);
            const visitHref = hasClientPermission(
              permissions,
              'schedule.read',
              tenantId,
              visit.organizationId,
              visit.facilityId,
            )
              ? `/visits/${visit.id}`
              : null;
            const clientLabel = hasClientPermission(
              permissions,
              'client.read',
              tenantId,
              visit.organizationId,
              visit.facilityId,
            )
              ? visit.clientDisplayName
              : t('Resources.unavailableClient');
            return (
              <li key={visit.id}>
                <ResourceCardLink
                  className="grid gap-1 rounded-md border p-3 hover:border-primary/40 sm:grid-cols-[12rem_1fr_auto]"
                  href={visitHref}
                >
                  <time dateTime={visit.plannedStart}>
                    {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                  </time>
                  <span>
                    <strong>{clientLabel}</strong>
                    <span className="block text-sm text-muted-foreground">
                      {visit.services.map((service) => service.serviceName).join(' · ')}
                    </span>
                    {execution ? (
                      <span className="block text-sm text-muted-foreground">
                        {t('Employees.detail.execution')}{' '}
                        {execution.executionStatus === 'completed'
                          ? t('Common.status.completed')
                          : execution.executionStatus === 'in_progress'
                            ? t('Common.status.inProgress')
                            : t('VisitExecution.executionStatus.notStarted')}
                        {execution.actualStart ? (
                          <>
                            {` · ${t('Employees.detail.actual')} `}
                            {formatVisitDateTime(execution.actualStart, visit.timezone, locale)}
                            {execution.actualEnd
                              ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                              : ''}
                          </>
                        ) : null}
                      </span>
                    ) : executionSummariesResult.error ? (
                      <span className="block text-sm text-muted-foreground">
                        {t('Employees.detail.executionStatusUnavailable')}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm">
                    {visit.status === 'cancelled'
                      ? t('Common.status.cancelled')
                      : visit.status === 'confirmed'
                        ? t('Common.status.confirmed')
                        : t('Common.status.planned')}
                  </span>
                </ResourceCardLink>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t('Employees.detail.noAssignedVisits')}</p>
      )}
      {recentVisitsResult.error ? (
        <p className="text-sm text-muted-foreground">
          {t('Employees.detail.pastExecutionsUnavailable')}
        </p>
      ) : recentExecutionSummariesResult.error ? (
        <p className="text-sm text-muted-foreground">
          {t('Employees.detail.pastExecutionStatusUnavailable')}
        </p>
      ) : recentExecutionItems.length ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">{t('Employees.detail.recentVisits')}</h3>
          <ol className="grid gap-2">
            {recentExecutionItems.map((visit) => {
              const execution = recentExecutionByVisitId.get(visit.id);
              if (!execution) return null;
              const visitHref = hasClientPermission(
                permissions,
                'schedule.read',
                tenantId,
                visit.organizationId,
                visit.facilityId,
              )
                ? `/visits/${visit.id}`
                : null;
              const clientLabel = hasClientPermission(
                permissions,
                'client.read',
                tenantId,
                visit.organizationId,
                visit.facilityId,
              )
                ? visit.clientDisplayName
                : t('Resources.unavailableClient');
              return (
                <li key={visit.id}>
                  <ResourceCardLink
                    className="grid gap-1 rounded-md border p-3 hover:border-primary/40"
                    href={visitHref}
                  >
                    <time dateTime={visit.plannedStart}>
                      {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                    </time>
                    <strong>{clientLabel}</strong>
                    <span className="text-sm text-muted-foreground">
                      {visit.services.map((service) => service.serviceName).join(' · ')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('Employees.detail.execution')}{' '}
                      {execution.executionStatus === 'completed'
                        ? t('Common.status.completed')
                        : t('Common.status.inProgress')}
                      {execution.actualStart
                        ? ` · ${t('Employees.detail.actual')} ${formatVisitDateTime(execution.actualStart, visit.timezone, locale)}`
                        : ''}
                      {execution.actualEnd
                        ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                        : ''}
                    </span>
                  </ResourceCardLink>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function employeeVisitRange() {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    now,
    until: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}
