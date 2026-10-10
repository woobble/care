import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../lib/api';
import { formatVisitTime, todayRange } from '../../../lib/care-date';
import { formatLongDate } from '../../../i18n/format';

export default async function CareTodayPage() {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const range = todayRange();
  const api = await getApiClient();
  const get = api.GET;
  const [visitsResult, documentationResult, evidenceResult, tourResult] = await Promise.all([
    get('/api/v1/me/visits', {
      params: { query: { from: range.from, until: range.until }, header: await getTenantHeader() },
    }),
    get('/api/v1/me/documentation', {
      params: { query: { from: range.from, until: range.until }, header: await getTenantHeader() },
    }),
    get('/api/v1/me/service-evidence', {
      params: { query: { from: range.from, until: range.until }, header: await getTenantHeader() },
    }),
    get('/api/v1/me/today/tour', { params: { header: await getTenantHeader() } }),
  ]);
  const { data, error } = visitsResult;
  const visits = data ?? [];
  const documentationByVisit = new Map(
    (documentationResult.data?.items ?? []).map((item) => [item.visitId, item]),
  );
  const evidenceItems = evidenceResult.data?.items ?? [];
  const evidenceByVisit = new Map<string, (typeof evidenceItems)[number]>();
  for (const item of [...evidenceItems].sort(
    (left, right) => (left.packageVersion ?? 0) - (right.packageVersion ?? 0),
  )) {
    evidenceByVisit.set(item.visitId, item);
  }
  const tour = tourResult.data;
  const visitById = new Map(visits.map((visit) => [visit.id, visit]));
  const tourVisits = (tour?.stops ?? []).flatMap((stop) => {
    const visit = visitById.get(stop.visitId);
    return visit ? [{ visit, stop }] : [];
  });
  const orderedVisits = tourVisits.length
    ? [
        ...tourVisits.map(({ visit }) => visit),
        ...visits.filter((visit) => !tourVisits.some((item) => item.visit.id === visit.id)),
      ]
    : visits;
  const routeStopByVisit = new Map(tourVisits.map(({ visit, stop }) => [visit.id, stop]));

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          {t('Caregiver.todayLabel')}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{t('Caregiver.visitsTitle')}</h1>
        <p className="mt-2 text-slate-600">
          {t('Caregiver.visitsForDate', {
            date: formatLongDate(range.from, locale, 'Europe/Berlin'),
          })}
        </p>
      </header>

      {visits.some((visit) => Boolean(visit.address)) ? (
        <p className="text-xs text-slate-600">{t('Caregiver.navigationPrivacy')}</p>
      ) : null}

      {tour ? (
        <section
          aria-labelledby="daily-tour-title"
          className="grid gap-3 rounded-lg border bg-white p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="daily-tour-title" className="text-xl font-semibold">
              {t('Caregiver.dailyTour')}
            </h2>
            <p className="text-sm text-slate-600">
              {t('Caregiver.publishedTourVersion', { version: tour.version })}
            </p>
          </div>
          <p className="text-sm text-slate-600">
            {t('Caregiver.schedulePublishedAt', {
              date: formatLongDate(tour.publishedAt, locale, tour.timezone),
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
          {!tourVisits.length ? (
            <p className="text-sm text-slate-600">{t('Caregiver.noPublishedTourStops')}</p>
          ) : (
            <ol className="grid gap-2">
              {tourVisits.map(({ visit, stop }) => (
                <li
                  key={visit.id}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[3rem_1fr_auto] sm:items-center"
                >
                  <span className="text-sm font-semibold text-blue-900">
                    {t('Caregiver.stopNumber', { sequence: stop.sequence })}
                  </span>
                  <span>
                    <Link
                      href={'/care/visits/' + visit.id}
                      className="font-semibold text-blue-900 underline"
                    >
                      {visit.clientDisplayName}
                    </Link>
                    <span className="block text-sm text-slate-600">
                      {formatVisitTime(visit.plannedStart, visit.timezone, locale)}–
                      {formatVisitTime(visit.plannedEnd, visit.timezone, locale)} ·{' '}
                      {visit.services.map((service) => service.name).join(' · ') ||
                        t('Caregiver.noPlannedServices')}
                    </span>
                    <span className="block text-sm text-slate-600">
                      {visit.address ?? t('Caregiver.addressUnavailable')}
                    </span>
                    {stop.sequence > 1 || stop.estimatedTravelMinutes !== null ? (
                      <span className="block text-sm text-slate-600">
                        {stop.estimatedTravelMinutes == null
                          ? t('Caregiver.travelUnknown')
                          : t('Caregiver.travelEstimate', { minutes: stop.estimatedTravelMinutes })}
                        {stop.estimatedDistanceMeters != null
                          ? ` · ${t('Caregiver.travelDistance', { meters: stop.estimatedDistanceMeters })}`
                          : ''}
                      </span>
                    ) : null}
                  </span>
                  {visit.address ? (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-fit text-sm font-semibold text-blue-800 underline"
                    >
                      {t('Caregiver.openNavigation')}
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Caregiver.loadFailed')}
        </p>
      ) : null}

      {orderedVisits.length ? (
        <ul className="grid gap-3">
          {orderedVisits.map((visit) => (
            <li key={visit.id}>
              <div className="grid gap-2 rounded-lg border bg-white p-4 shadow-sm sm:grid-cols-[5rem_1fr_auto] sm:items-center">
                <span className="text-xl font-semibold tabular-nums text-blue-900">
                  {formatVisitTime(visit.plannedStart, visit.timezone, locale)}
                </span>
                <span className="grid gap-1">
                  <Link
                    href={'/care/visits/' + visit.id}
                    className="text-lg font-semibold text-blue-900 underline"
                  >
                    {visit.clientDisplayName}
                  </Link>
                  <span className="text-sm text-slate-600">
                    {visit.services.map((service) => service.name).join(' · ') ||
                      t('Caregiver.noPlannedServices')}
                  </span>
                  {visit.executionStatus === 'completed' ? (
                    <span className="text-sm font-medium">
                      {documentationByVisit.get(visit.id)?.documentationStatus === 'finalized'
                        ? `✓ ${t('CareDocumentation.finalized')} · ${t(acknowledgementStatusKey(evidenceByVisit.get(visit.id)?.status))}`
                        : documentationByVisit.get(visit.id)?.documentationStatus === 'draft'
                          ? `⚠ ${t('CareDocumentation.incomplete')}`
                          : `⚠ ${t('CareDocumentation.missing')}`}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    'w-fit rounded-full px-3 py-1 text-sm font-medium ' +
                    statusClass(visit.executionStatus, visit.status)
                  }
                >
                  {visit.status === 'cancelled'
                    ? t('Common.status.cancelled')
                    : visit.executionStatus === 'completed'
                      ? t('Common.status.completed')
                      : visit.executionStatus === 'in_progress'
                        ? t('Common.status.inProgress')
                        : t('Common.status.upcoming')}
                </span>
                {visit.address ? (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-fit text-sm font-semibold text-blue-800 underline sm:col-start-2"
                  >
                    {t('Caregiver.openNavigation')}
                  </a>
                ) : null}
                {routeStopByVisit.get(visit.id) ? (
                  <span className="text-xs text-slate-600 sm:col-start-2">
                    {t('Caregiver.stopNumber', {
                      sequence: routeStopByVisit.get(visit.id)!.sequence,
                    })}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="grid gap-2 rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">{t('Caregiver.noVisitsTitle')}</h2>
          <p className="text-slate-600">{t('Caregiver.noVisits')}</p>
          <Button asChild variant="secondary" className="mt-2 w-fit">
            <Link href="/care/today">{t('Caregiver.refresh')}</Link>
          </Button>
        </section>
      )}
    </div>
  );
}

function statusClass(executionStatus: string, visitStatus: string): string {
  if (visitStatus === 'cancelled') return 'bg-slate-100 text-slate-700';
  if (executionStatus === 'completed') return 'bg-green-100 text-green-900';
  if (executionStatus === 'in_progress') return 'bg-blue-100 text-blue-900';
  return 'bg-amber-100 text-amber-900';
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
