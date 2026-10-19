import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { CaregiverRetryButton } from '@app/web/components/caregiver-retry-button';
import { CalendarSubscriptionManager } from './calendar-subscription-manager';
import { PageHeader } from '@app/web/components/page-patterns';
import {
  ScheduleCalendarGrid,
  ScheduleCalendarNavigation,
  type ScheduleCalendarEventInput,
  type ScheduleCalendarView,
} from '@app/web/components/schedule-calendar';
import {
  dateRange,
  formatVisitDate,
  formatVisitDateTime,
  formatVisitTime,
} from '@app/web/lib/care-date';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { Button } from '@care/ui/components/button';
import type { components } from '@care/api-client';

const RECENT_CHANGE_MS = 24 * 60 * 60 * 1000;

type SearchParams = Promise<{ date?: string; view?: string; page?: string; pageSize?: string }>;

export default async function CareCalendarPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, planningT, locale] = await Promise.all([
    getTranslations('Caregiver'),
    getTranslations('Planning'),
    getLocale(),
  ]);
  const selectedDate = validDate(query.date) ?? todayInBerlin();
  const view: ScheduleCalendarView =
    query.view === 'month' ||
    query.view === 'week' ||
    query.view === 'day' ||
    query.view === 'agenda'
      ? query.view
      : 'agenda';
  const period =
    view === 'day'
      ? dayPeriod(selectedDate)
      : view === 'month'
        ? monthVisiblePeriod(selectedDate)
        : weekPeriod(selectedDate);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const dateValues = datesBetween(period.start, period.endExclusive);
  const visitsLoad = (async () => {
    const allVisits = new Map<string, components['schemas']['CaregiverVisitResponseDto']>();
    for (let index = 0; index < dateValues.length; index += 7) {
      const range = apiRange(
        dateValues[index]!,
        dateValues[Math.min(index + 7, dateValues.length)] ?? period.endExclusive,
      );
      // oxlint-disable-next-line no-await-in-loop -- Each visible date chunk is bounded and supplies its own page total.
      const first = await get('/api/v1/me/visits', {
        params: { query: { ...range, page: 1, pageSize: 100 }, header },
      });
      if (first.error || !first.data) return { items: [], error: first.error, failed: true };
      first.data.items.forEach((visit) => allVisits.set(visit.id, visit));
      const pageCount = Math.ceil(first.data.total / first.data.pageSize);
      for (let batchStart = 2; batchStart <= pageCount; batchStart += 5) {
        // oxlint-disable-next-line no-await-in-loop -- Subsequent bounded batches depend on the first page's total.
        const pageResults = await Promise.all(
          Array.from({ length: Math.min(5, pageCount - batchStart + 1) }, (_, offset) =>
            get('/api/v1/me/visits', {
              params: {
                query: { ...range, page: batchStart + offset, pageSize: 100 },
                header,
              },
            }),
          ),
        );
        const failed = pageResults.find((result) => result.error || !result.data);
        if (failed) return { items: [], error: failed.error, failed: true };
        pageResults.forEach((result) =>
          result.data?.items.forEach((visit) => allVisits.set(visit.id, visit)),
        );
      }
    }
    const items = [...allVisits.values()].sort(
      (left, right) =>
        left.plannedStart.localeCompare(right.plannedStart) || left.id.localeCompare(right.id),
    );
    return { items, error: undefined, failed: false };
  })();
  const toursLoad = (async () => {
    const tourRanges = [];
    for (let index = 0; index < dateValues.length; index += 7) {
      tourRanges.push({
        from: dateValues[index]!,
        until: dateValues[Math.min(index + 7, dateValues.length)] ?? period.endExclusive,
      });
    }
    const results = await Promise.all(
      tourRanges.map(({ from, until }) =>
        get('/api/v1/me/tours', { params: { query: { from, until }, header } }),
      ),
    );
    return {
      items: results.flatMap((result) => result.data ?? []),
      failed: results.some((result) => Boolean(result.error || !result.data)),
    };
  })();
  const subscriptionLoad = get('/api/v1/me/calendar-subscription', { params: { header } });
  const [visitsResult, toursResult, subscriptionResult] = await Promise.all([
    visitsLoad,
    toursLoad,
    subscriptionLoad,
  ]);
  const subscriptionStatus =
    subscriptionResult.error || !subscriptionResult.data
      ? 'unavailable'
      : subscriptionResult.data.active
        ? 'active'
        : 'inactive';
  const employeeLinkRequired =
    visitsResult.error?.code?.endsWith('EMPLOYEE_LINK_REQUIRED') ?? false;
  const loadFailed = visitsResult.failed;
  const visits = loadFailed ? [] : visitsResult.items;
  const toursByVisit = new Map<
    string,
    { sequence: number; travelMinutes: number | null; version: number }
  >();
  for (const tour of toursResult.items) {
    for (const stop of tour.stops) {
      toursByVisit.set(stop.visitId, {
        sequence: stop.sequence,
        travelMinutes: stop.estimatedTravelMinutes ?? null,
        version: tour.version,
      });
    }
  }
  const timezone = visits[0]?.timezone ?? 'Europe/Berlin';
  const calendarEvents: ScheduleCalendarEventInput[] = visits.map((visit) => {
    const tourStop = toursByVisit.get(visit.id);
    const timeLabel = `${formatVisitTime(visit.plannedStart, visit.timezone, locale)}–${formatVisitTime(visit.plannedEnd, visit.timezone, locale)}`;
    const executionLabel = t(executionStatusKey(visit.executionStatus));
    const statusLabel = visit.status === 'cancelled' ? t('status.cancelled') : executionLabel;
    return {
      id: visit.id,
      clientName: visit.clientDisplayName,
      serviceNames: visit.services.map((service) => service.name),
      employeeNames: [],
      resourceIds: [],
      start: visit.plannedStart,
      end: visit.plannedEnd,
      timezone: visit.timezone,
      status: visit.status,
      statusLabel,
      detail: [
        visit.clientDisplayName,
        timeLabel,
        visit.services.map((service) => service.name).join(', '),
        visit.address,
        statusLabel,
        tourStop ? t('stopNumber', { sequence: tourStop.sequence }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/care/visits/${visit.id}`,
      ...(tourStop ? { tourLabel: t('stopNumber', { sequence: tourStop.sequence }) } : {}),
      protectedFromReschedule: true,
    };
  });

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        eyebrow={t('todayLabel')}
        title={t('calendarTitle')}
        description={t('calendarDescription')}
      />
      <ScheduleCalendarNavigation
        date={selectedDate}
        view={view}
        locale={locale === 'de' ? 'de' : 'en'}
        timezone={timezone}
        labels={{
          month: planningT('month'),
          week: planningT('week'),
          day: planningT('day'),
          agenda: planningT('agenda'),
          previous: planningT('previous'),
          next: planningT('next'),
          today: planningT('today'),
          date: planningT('date'),
          goToDate: planningT('goToDate'),
          calendarNavigation: planningT('calendarNavigation'),
        }}
      />
      <CalendarSubscriptionManager status={subscriptionStatus} />

      {loadFailed ? (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-2xl text-sm text-foreground">
            {employeeLinkRequired ? t('employeeLinkRequired') : t('calendarLoadFailed')}
          </p>
          <CaregiverRetryButton label={t('retry')} pendingLabel={t('retrying')} />
        </section>
      ) : view === 'agenda' ? (
        visits.length ? (
          <ol aria-label={t('calendarTitle')} className="grid min-w-0 gap-3">
            {visits.map((visit) => {
              const tourStop = toursByVisit.get(visit.id);
              const changedAt = laterDate(visit.assignmentAssignedAt, visit.updatedAt);
              const recentlyChanged = isRecent(changedAt.toISOString());
              const executionLabel = t(executionStatusKey(visit.executionStatus));
              const actionLabel =
                visit.status === 'cancelled'
                  ? t('viewVisit')
                  : visit.executionStatus === 'in_progress'
                    ? t('continueVisit')
                    : visit.executionStatus === 'not_started'
                      ? t('startVisit')
                      : t('openVisit');
              return (
                <li key={visit.id}>
                  <article className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-start">
                    <div className="grid gap-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        {formatVisitDate(visit.plannedStart, visit.timezone, locale)}
                      </span>
                      <span className="text-xl font-semibold tabular-nums">
                        {formatVisitTime(visit.plannedStart, visit.timezone, locale)}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatVisitTime(visit.plannedEnd, visit.timezone, locale)}
                      </span>
                    </div>
                    <div className="grid min-w-0 gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/care/visits/${visit.id}`}
                          className="min-h-11 content-center text-lg font-semibold text-primary underline decoration-primary/50 underline-offset-4"
                        >
                          {visit.clientDisplayName}
                        </Link>
                        {recentlyChanged ? (
                          <BadgeLike>{t('recentScheduleChange')}</BadgeLike>
                        ) : null}
                        {tourStop ? (
                          <BadgeLike>{t('stopNumber', { sequence: tourStop.sequence })}</BadgeLike>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {visit.services.map((service) => service.name).join(' · ') ||
                          t('noPlannedServices')}
                      </p>
                      <p className="break-words text-sm text-muted-foreground">
                        {visit.address ?? t('addressUnavailable')}
                      </p>
                      <p className="text-sm font-medium">
                        {visit.status === 'cancelled' ? t('status.cancelled') : executionLabel}
                      </p>
                      {tourStop?.travelMinutes !== null && tourStop?.travelMinutes !== undefined ? (
                        <p className="text-xs text-muted-foreground">
                          {t('travelEstimate', { minutes: tourStop.travelMinutes })}
                          {' · '}
                          {t('calendarRouteVersion', { version: tourStop.version })}
                        </p>
                      ) : null}
                      {recentlyChanged ? (
                        <p className="text-xs text-muted-foreground">
                          {t('scheduleChangedAt', {
                            date: formatVisitDateTime(
                              changedAt.toISOString(),
                              visit.timezone,
                              locale,
                            ),
                          })}
                        </p>
                      ) : null}
                      <Button asChild variant="outline" className="min-h-11 w-full sm:w-fit">
                        <Link href={`/care/visits/${visit.id}`}>{actionLabel}</Link>
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:justify-items-end">
                      {visit.address ? (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-11 content-center text-sm font-semibold text-primary underline"
                        >
                          {t('openNavigation')}
                        </a>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        ) : (
          <CalendarEmpty title={t('noVisitsTitle')} description={t('calendarNoVisits')} />
        )
      ) : (
        <ScheduleCalendarGrid
          events={calendarEvents}
          date={selectedDate}
          view={view}
          timezone={timezone}
          locale={locale === 'de' ? 'de' : 'en'}
          monthCountLabels={{
            one: planningT('visitCount', { count: 1 }),
            other: planningT('visitCount', { count: 2 }),
          }}
          emptyLabel={t('calendarNoVisits')}
          rescheduleErrorLabel={t('calendarLoadFailed')}
        />
      )}
      {toursResult.failed && !loadFailed ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('tourUnavailable')}
        </p>
      ) : null}
      {!loadFailed && visits.some((visit) => Boolean(visit.address)) ? (
        <p className="text-xs text-muted-foreground">{t('navigationPrivacy')}</p>
      ) : null}
    </div>
  );
}

function CalendarEmpty({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <section className="grid gap-2 rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </section>
  );
}

function BadgeLike({ children }: Readonly<{ children: React.ReactNode }>) {
  return <span className="rounded-full border px-2 py-1 text-xs font-medium">{children}</span>;
}

function executionStatusKey(
  status: string,
):
  | 'calendarExecutionStatusNotStarted'
  | 'calendarExecutionStatusInProgress'
  | 'calendarExecutionStatusCompleted'
  | 'calendarExecutionStatusUnknown' {
  if (status === 'not_started') return 'calendarExecutionStatusNotStarted';
  if (status === 'in_progress') return 'calendarExecutionStatusInProgress';
  if (status === 'completed') return 'calendarExecutionStatusCompleted';
  return 'calendarExecutionStatusUnknown';
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function todayInBerlin(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const field = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function dayPeriod(date: string): { start: string; endExclusive: string } {
  return { start: date, endExclusive: addDays(date, 1) };
}

function weekPeriod(date: string): { start: string; endExclusive: string } {
  const dateValue = new Date(`${date}T00:00:00Z`);
  const mondayOffset = (dateValue.getUTCDay() + 6) % 7;
  const start = addDays(date, -mondayOffset);
  return { start, endExclusive: addDays(start, 7) };
}

function monthVisiblePeriod(date: string): { start: string; endExclusive: string } {
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthStartValue = new Date(`${monthStart}T00:00:00Z`);
  const lastDay = new Date(
    Date.UTC(monthStartValue.getUTCFullYear(), monthStartValue.getUTCMonth() + 1, 0),
  );
  const lastDate = lastDay.toISOString().slice(0, 10);
  return { start: weekPeriod(monthStart).start, endExclusive: weekPeriod(lastDate).endExclusive };
}

function datesBetween(from: string, until: string): string[] {
  const values: string[] = [];
  for (let date = from; date < until; date = addDays(date, 1)) values.push(date);
  return values;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function apiRange(start: string, endExclusive: string): { from: string; until: string } {
  const range = dateRange(start, addDays(endExclusive, -1));
  return { from: range.from, until: range.until };
}

function laterDate(first: string, second: string): Date {
  return new Date(Math.max(new Date(first).getTime(), new Date(second).getTime()));
}

function isRecent(value: string): boolean {
  const age = Date.now() - new Date(value).getTime();
  return age >= 0 && age <= RECENT_CHANGE_MS;
}
