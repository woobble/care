import Link from 'next/link';
import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { formatLongDate } from '@app/web/i18n/format';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { formatVisitDateTime, formatVisitTime, todayRange } from '@app/web/lib/care-date';

const RECENT_CHANGE_MS = 24 * 60 * 60 * 1000;

export default async function CareTodayPage() {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const range = todayRange();
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [visitsResult, documentationResult, evidenceResult, tourResult] = await Promise.all([
    get('/api/v1/me/visits', {
      params: { query: { from: range.from, until: range.until }, header },
    }),
    get('/api/v1/me/documentation', {
      params: { query: { from: range.from, until: range.until }, header },
    }),
    get('/api/v1/me/service-evidence', {
      params: { query: { from: range.from, until: range.until }, header },
    }),
    get('/api/v1/me/today/tour', { params: { header } }),
  ]);
  const visits = visitsResult.data ?? [];
  const documentationItems = documentationResult.data?.items ?? [];
  const documentationByVisit = new Map(documentationItems.map((item) => [item.visitId, item]));
  const evidenceItems = evidenceResult.data?.items ?? [];
  const evidenceByVisit = new Map<string, (typeof evidenceItems)[number]>();
  for (const item of [...evidenceItems].sort(
    (left, right) => (left.packageVersion ?? 0) - (right.packageVersion ?? 0),
  )) {
    evidenceByVisit.set(item.visitId, item);
  }

  const tour = tourResult.data;
  const visitById = new Map(visits.map((visit) => [visit.id, visit]));
  const tourVisits = (tour?.stops ?? [])
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap((stop) => {
      const visit = visitById.get(stop.visitId);
      return visit && visit.status !== 'cancelled' ? [{ visit, stop }] : [];
    });
  const tourVisitIds = new Set(tourVisits.map(({ visit }) => visit.id));
  const fallbackVisits = visits
    .filter((visit) => !tourVisitIds.has(visit.id))
    .slice()
    .sort(
      (left, right) =>
        new Date(left.plannedStart).getTime() - new Date(right.plannedStart).getTime() ||
        left.id.localeCompare(right.id),
    );
  const orderedVisits = [
    ...tourVisits.map(({ visit, stop }) => ({ visit, stop, isFallback: false })),
    ...fallbackVisits.map((visit) => ({ visit, stop: null, isFallback: true })),
  ];
  const now = range.now;
  const inProgressVisit = visits.find((visit) => visit.executionStatus === 'in_progress');
  const nextVisit = visits
    .filter(
      (visit) =>
        visit.status !== 'cancelled' &&
        visit.executionStatus === 'not_started' &&
        new Date(visit.plannedStart).getTime() >= now,
    )
    .sort((left, right) => left.plannedStart.localeCompare(right.plannedStart))[0];
  const recentTourPublication = tour && isRecent(tour.publishedAt, now);
  const documentationUnavailable = Boolean(documentationResult.error || !documentationResult.data);
  const evidenceUnavailable = Boolean(evidenceResult.error || !evidenceResult.data);

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={t('Caregiver.todayLabel')}
        title={t('Caregiver.visitsTitle')}
        description={t('Caregiver.visitsForDate', {
          date: formatLongDate(range.from, locale, 'Europe/Berlin'),
        })}
      />

      {visits.some((visit) => Boolean(visit.address)) ? (
        <p className="text-xs text-slate-600">{t('Caregiver.navigationPrivacy')}</p>
      ) : null}

      {tour ? (
        <section className="grid gap-2 rounded-lg border bg-white p-4" aria-labelledby="tour-title">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="tour-title" className="text-lg font-semibold">
              {t('Caregiver.dailyTour')}
            </h2>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-900">
              {t('Caregiver.publishedTourVersion', { version: tour.version })}
            </span>
            {recentTourPublication ? (
              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-950">
                {t('Caregiver.recentTourChange')}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-600">
            {t('Caregiver.schedulePublishedAt', {
              date: formatVisitDateTime(tour.publishedAt, tour.timezone, locale),
            })}
          </p>
          {tour.version > 1 ? (
            <p className="text-sm text-slate-600">
              {tour.changeSummary.length
                ? t('Caregiver.publicationChanges', {
                    changes: tour.changeSummary
                      .map((change) => t(publicationChangeKey(change.type)))
                      .join(', '),
                  })
                : t('Caregiver.noPublicationChanges')}
            </p>
          ) : null}
          {tourVisits.length === 0 ? (
            <p className="text-sm text-slate-600">{t('Caregiver.noPublishedTourStops')}</p>
          ) : null}
          {fallbackVisits.length > 0 ? (
            <p className="text-sm text-slate-600">{t('Caregiver.fallbackVisitsIncluded')}</p>
          ) : null}
        </section>
      ) : null}

      {visitsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Caregiver.loadFailed')}
        </p>
      ) : null}
      {!tour ? (
        <p role="status" className="rounded-md border bg-white p-3 text-sm text-slate-700">
          {t(tourResult.error ? 'Caregiver.tourUnavailable' : 'Caregiver.chronologicalFallback')}
        </p>
      ) : null}
      {documentationResult.error || evidenceResult.error ? (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {t('Caregiver.workflowStatusUnavailable')}
        </p>
      ) : null}

      {orderedVisits.length > 0 ? (
        <ol className="grid gap-3" aria-label={t('Caregiver.visitsTitle')}>
          {orderedVisits.map(({ visit, stop, isFallback }) => {
            const changedAt = laterDate(visit.assignmentAssignedAt, visit.updatedAt);
            const recentlyChanged = isRecent(changedAt.toISOString(), now);
            const isFocusVisit = inProgressVisit?.id === visit.id;
            const isNextVisit = !isFocusVisit && nextVisit?.id === visit.id;
            const documentation = documentationByVisit.get(visit.id);
            const evidence = evidenceByVisit.get(visit.id);

            return (
              <li key={visit.id}>
                <article
                  className={
                    'grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-start ' +
                    (isFocusVisit ? 'border-primary ring-1 ring-ring/30' : '')
                  }
                >
                  <div className="grid gap-1">
                    <span className="text-xl font-semibold tabular-nums text-blue-900">
                      {formatVisitTime(visit.plannedStart, visit.timezone, locale)}
                    </span>
                    <span className="text-sm tabular-nums text-slate-600">
                      {formatVisitTime(visit.plannedEnd, visit.timezone, locale)}
                    </span>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={'/care/visits/' + visit.id}
                        className="min-h-11 content-center text-lg font-semibold text-blue-900 underline"
                      >
                        {visit.clientDisplayName}
                      </Link>
                      {isFocusVisit ? (
                        <FocusBadge>{t('Caregiver.focusInProgress')}</FocusBadge>
                      ) : null}
                      {isNextVisit ? <FocusBadge>{t('Caregiver.focusNext')}</FocusBadge> : null}
                      {recentlyChanged ? (
                        <FocusBadge>{t('Caregiver.recentScheduleChange')}</FocusBadge>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-700">
                      {visit.services.map((service) => service.name).join(' · ') ||
                        t('Caregiver.noPlannedServices')}
                    </p>
                    <p className="break-words text-sm text-slate-600">
                      {visit.address ?? t('Caregiver.addressUnavailable')}
                    </p>
                    {stop ? (
                      <p className="text-sm text-slate-600">
                        {t('Caregiver.stopNumber', { sequence: stop.sequence })}
                        {stop.estimatedTravelMinutes == null
                          ? ` · ${t('Caregiver.travelUnknown')}`
                          : ` · ${t('Caregiver.travelEstimate', { minutes: stop.estimatedTravelMinutes })}`}
                        {stop.estimatedDistanceMeters != null
                          ? ` · ${t('Caregiver.travelDistance', { meters: stop.estimatedDistanceMeters })}`
                          : ''}
                      </p>
                    ) : isFallback ? (
                      <p className="text-sm text-slate-600">
                        {t('Caregiver.chronologicalFallbackCard')}
                      </p>
                    ) : null}
                    {recentlyChanged ? (
                      <p className="text-xs text-slate-500">
                        {t('Caregiver.scheduleChangedAt', {
                          date: formatVisitDateTime(
                            changedAt.toISOString(),
                            visit.timezone,
                            locale,
                          ),
                        })}
                      </p>
                    ) : null}
                    <p className="text-sm font-medium">
                      {visit.status === 'cancelled'
                        ? t('Caregiver.status.cancelled')
                        : t(executionStatusKey(visit.executionStatus))}
                    </p>
                    <p className="text-sm">
                      {documentationUnavailable
                        ? `⚠ ${t('CareDocumentation.visit.unavailable')}`
                        : documentation?.documentationStatus === 'finalized'
                          ? `✓ ${t('CareDocumentation.finalized')}`
                          : documentation?.documentationStatus === 'draft'
                            ? `⚠ ${t('CareDocumentation.incomplete')}`
                            : visit.executionStatus === 'completed'
                              ? `⚠ ${t('CareDocumentation.missing')}`
                              : `${t('CareDocumentation.visit.title')}: ${t('CareDocumentation.visit.notCreated')}`}
                      {visit.executionStatus === 'completed' ? (
                        <>
                          {' · '}
                          {evidenceUnavailable
                            ? `⚠ ${t('ServiceEvidence.care.loadFailed')}`
                            : t(acknowledgementStatusKey(evidence?.status))}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:justify-items-end">
                    {visit.address ? (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-11 content-center text-sm font-semibold text-blue-800 underline"
                      >
                        {t('Caregiver.openNavigation')}
                      </a>
                    ) : null}
                    <Button asChild className="min-h-11 w-full sm:w-auto">
                      <Link href={'/care/visits/' + visit.id}>{t('Caregiver.openVisit')}</Link>
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : visitsResult.error ? null : (
        <section className="grid gap-2 rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">{t('Caregiver.noVisitsTitle')}</h2>
          <p className="text-slate-600">{t('Caregiver.noVisits')}</p>
          <Button asChild variant="secondary" className="mt-2 min-h-11 w-fit">
            <Link href="/care/today">{t('Caregiver.refresh')}</Link>
          </Button>
        </section>
      )}
    </div>
  );
}

function FocusBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
      {children}
    </span>
  );
}

function isRecent(value: string, now: number): boolean {
  const age = now - new Date(value).getTime();
  return age >= 0 && age <= RECENT_CHANGE_MS;
}

function laterDate(first: string, second: string): Date {
  return new Date(Math.max(new Date(first).getTime(), new Date(second).getTime()));
}

function executionStatusKey(
  status: string,
):
  | 'VisitExecution.executionStatus.notStarted'
  | 'VisitExecution.executionStatus.inProgress'
  | 'VisitExecution.executionStatus.completed'
  | 'VisitExecution.executionStatus.unknown' {
  if (status === 'not_started') return 'VisitExecution.executionStatus.notStarted';
  if (status === 'in_progress') return 'VisitExecution.executionStatus.inProgress';
  if (status === 'completed') return 'VisitExecution.executionStatus.completed';
  return 'VisitExecution.executionStatus.unknown';
}

function publicationChangeKey(
  type: string,
):
  | 'Caregiver.publicationChangeTypes.initial'
  | 'Caregiver.publicationChangeTypes.visit_added'
  | 'Caregiver.publicationChangeTypes.visit_removed'
  | 'Caregiver.publicationChangeTypes.tour_reordered'
  | 'Caregiver.publicationChangeTypes.visit_rescheduled' {
  switch (type) {
    case 'visit_added':
      return 'Caregiver.publicationChangeTypes.visit_added';
    case 'visit_removed':
      return 'Caregiver.publicationChangeTypes.visit_removed';
    case 'tour_reordered':
      return 'Caregiver.publicationChangeTypes.tour_reordered';
    case 'visit_rescheduled':
      return 'Caregiver.publicationChangeTypes.visit_rescheduled';
    default:
      return 'Caregiver.publicationChangeTypes.initial';
  }
}

function acknowledgementStatusKey(
  status: string | undefined,
):
  | 'ServiceEvidence.acknowledgementStatus.acknowledged'
  | 'ServiceEvidence.acknowledgementStatus.declined'
  | 'ServiceEvidence.acknowledgementStatus.outdated'
  | 'ServiceEvidence.acknowledgementStatus.revoked'
  | 'ServiceEvidence.acknowledgementStatus.missing' {
  if (status === 'acknowledged') return 'ServiceEvidence.acknowledgementStatus.acknowledged';
  if (status === 'declined') return 'ServiceEvidence.acknowledgementStatus.declined';
  if (status === 'outdated') return 'ServiceEvidence.acknowledgementStatus.outdated';
  if (status === 'revoked') return 'ServiceEvidence.acknowledgementStatus.revoked';
  return 'ServiceEvidence.acknowledgementStatus.missing';
}
