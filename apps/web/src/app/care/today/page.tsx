import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Badge } from '@care/ui/components/badge';
import { Button } from '@care/ui/components/button';
import { PageHeader } from '@app/web/components/page-patterns';
import { CaregiverRetryButton } from '@app/web/components/caregiver-retry-button';
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
  const documentationPromise = getDocumentationResult(api, header, range);
  const evidencePromise = getEvidenceResult(api, header, range);
  const [visitsResult, tourResult] = await Promise.all([
    get('/api/v1/me/visits', {
      params: { query: { from: range.from, until: range.until }, header },
    }),
    get('/api/v1/me/today/tour', { params: { header } }),
  ]);
  const visits = visitsResult.data ?? [];

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
  const featuredVisits = [inProgressVisit, nextVisit]
    .filter((visit): visit is NonNullable<typeof visit> => Boolean(visit))
    .flatMap((focusVisit) => orderedVisits.filter(({ visit }) => visit.id === focusVisit.id));
  const featuredVisitIds = new Set(featuredVisits.map(({ visit }) => visit.id));
  const prioritizedVisits = [
    ...featuredVisits,
    ...orderedVisits.filter(({ visit }) => !featuredVisitIds.has(visit.id)),
  ];
  const recentTourPublication = tour && isRecent(tour.publishedAt, now);
  const visitLoadFailed = Boolean(visitsResult.error || !visitsResult.data);
  const employeeLinkRequired = visitsResult.error?.code?.endsWith('EMPLOYEE_LINK_REQUIRED');

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
        <p className="text-xs text-muted-foreground">{t('Caregiver.navigationPrivacy')}</p>
      ) : null}

      {tour ? (
        <section
          className="grid gap-2 rounded-xl border border-border bg-card p-4"
          aria-labelledby="tour-title"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="tour-title" className="text-lg font-semibold">
              {t('Caregiver.dailyTour')}
            </h2>
            <Badge variant="secondary">
              {t('Caregiver.publishedTourVersion', { version: tour.version })}
            </Badge>
            {recentTourPublication ? (
              <Badge variant="warning">{t('Caregiver.recentTourChange')}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {t('Caregiver.schedulePublishedAt', {
              date: formatVisitDateTime(tour.publishedAt, tour.timezone, locale),
            })}
          </p>
          {tour.version > 1 ? (
            <p className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">{t('Caregiver.noPublishedTourStops')}</p>
          ) : null}
          {fallbackVisits.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t('Caregiver.fallbackVisitsIncluded')}</p>
          ) : null}
        </section>
      ) : null}

      {visitLoadFailed ? (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-2xl text-sm text-foreground">
            {employeeLinkRequired ? t('Caregiver.employeeLinkRequired') : t('Caregiver.loadFailed')}
          </p>
          <CaregiverRetryButton
            label={t('Caregiver.retry')}
            pendingLabel={t('Caregiver.retrying')}
          />
        </section>
      ) : null}
      {!tour && !visitLoadFailed ? (
        <section
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 text-sm text-muted-foreground"
        >
          <p>
            {t(tourResult.error ? 'Caregiver.tourUnavailable' : 'Caregiver.chronologicalFallback')}
          </p>
          {tourResult.error && !visitLoadFailed ? (
            <CaregiverRetryButton
              label={t('Caregiver.retry')}
              pendingLabel={t('Caregiver.retrying')}
            />
          ) : null}
        </section>
      ) : null}
      {!visitLoadFailed ? (
        <Suspense fallback={null}>
          <WorkflowStatusNotice
            documentationPromise={documentationPromise}
            evidencePromise={evidencePromise}
          />
        </Suspense>
      ) : null}

      {orderedVisits.length > 0 ? (
        <ol className="grid gap-3" aria-label={t('Caregiver.visitsTitle')}>
          {prioritizedVisits.map(({ visit, stop, isFallback }) => {
            const changedAt = laterDate(visit.assignmentAssignedAt, visit.updatedAt);
            const recentlyChanged = isRecent(changedAt.toISOString(), now);
            const isFocusVisit = inProgressVisit?.id === visit.id;
            const isNextVisit = !isFocusVisit && nextVisit?.id === visit.id;
            const immediateAction =
              visit.status === 'cancelled'
                ? t('Caregiver.viewVisit')
                : visit.executionStatus === 'in_progress'
                  ? t('Caregiver.continueVisit')
                  : visit.executionStatus === 'not_started'
                    ? t('Caregiver.startVisit')
                    : t('Caregiver.openVisit');
            return (
              <li key={visit.id}>
                <article
                  className={
                    'grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4 transition-colors sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-start ' +
                    (isFocusVisit ? 'border-primary ring-1 ring-ring/30' : '')
                  }
                >
                  <div className="grid gap-1">
                    <span className="text-xl font-semibold tabular-nums text-foreground">
                      {formatVisitTime(visit.plannedStart, visit.timezone, locale)}
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {formatVisitTime(visit.plannedEnd, visit.timezone, locale)}
                    </span>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={'/care/visits/' + visit.id}
                        className="min-h-11 content-center text-lg font-semibold text-primary underline decoration-primary/50 underline-offset-4"
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
                    <p className="text-sm text-muted-foreground">
                      {visit.services.map((service) => service.name).join(' · ') ||
                        t('Caregiver.noPlannedServices')}
                    </p>
                    <p className="break-words text-sm text-muted-foreground">
                      {visit.address ?? t('Caregiver.addressUnavailable')}
                    </p>
                    {stop ? (
                      <p className="text-sm text-muted-foreground">
                        {t('Caregiver.stopNumber', { sequence: stop.sequence })}
                        {stop.estimatedTravelMinutes == null
                          ? ` · ${t('Caregiver.travelUnknown')}`
                          : ` · ${t('Caregiver.travelEstimate', { minutes: stop.estimatedTravelMinutes })}`}
                        {stop.estimatedDistanceMeters != null
                          ? ` · ${t('Caregiver.travelDistance', { meters: stop.estimatedDistanceMeters })}`
                          : ''}
                      </p>
                    ) : isFallback ? (
                      <p className="text-sm text-muted-foreground">
                        {t('Caregiver.chronologicalFallbackCard')}
                      </p>
                    ) : null}
                    {recentlyChanged ? (
                      <p className="text-xs text-muted-foreground">
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
                    <Suspense
                      fallback={
                        <div className="grid gap-2">
                          <p className="text-sm text-muted-foreground">
                            {t('Caregiver.workflowLoading')}
                          </p>
                          <Button
                            asChild
                            variant={isFocusVisit ? 'default' : 'outline'}
                            className="min-h-11 w-full sm:w-auto"
                          >
                            <Link href={'/care/visits/' + visit.id}>{immediateAction}</Link>
                          </Button>
                        </div>
                      }
                    >
                      <VisitWorkflowStatus
                        visitId={visit.id}
                        visitStatus={visit.status}
                        executionStatus={visit.executionStatus}
                        documentationPromise={documentationPromise}
                        evidencePromise={evidencePromise}
                      />
                    </Suspense>
                  </div>
                  <div className="grid gap-2 sm:justify-items-end">
                    {visit.address ? (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-11 content-center text-sm font-semibold text-primary underline"
                      >
                        {t('Caregiver.openNavigation')}
                      </a>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : visitLoadFailed ? null : (
        <section className="grid gap-2 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">{t('Caregiver.noVisitsTitle')}</h2>
          <p className="text-muted-foreground">{t('Caregiver.noVisits')}</p>
          <CaregiverRetryButton
            label={t('Caregiver.refresh')}
            pendingLabel={t('Caregiver.retrying')}
          />
        </section>
      )}
    </div>
  );
}

function getDocumentationResult(
  api: Awaited<ReturnType<typeof getApiClient>>,
  header: Awaited<ReturnType<typeof getTenantHeader>>,
  range: ReturnType<typeof todayRange>,
) {
  return api.GET('/api/v1/me/documentation', {
    params: { query: { from: range.from, until: range.until }, header },
  });
}

function getEvidenceResult(
  api: Awaited<ReturnType<typeof getApiClient>>,
  header: Awaited<ReturnType<typeof getTenantHeader>>,
  range: ReturnType<typeof todayRange>,
) {
  return api.GET('/api/v1/me/service-evidence', {
    params: { query: { from: range.from, until: range.until }, header },
  });
}

async function WorkflowStatusNotice({
  documentationPromise,
  evidencePromise,
}: {
  documentationPromise: ReturnType<typeof getDocumentationResult>;
  evidencePromise: ReturnType<typeof getEvidenceResult>;
}) {
  const [documentation, evidence] = await Promise.all([documentationPromise, evidencePromise]);
  const unavailable =
    documentation.error || !documentation.data || evidence.error || !evidence.data;
  if (!unavailable) return null;

  const t = await getTranslations();
  const employeeLinkRequired = [documentation.error?.code, evidence.error?.code].some((code) =>
    code?.endsWith('EMPLOYEE_LINK_REQUIRED'),
  );
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        {employeeLinkRequired
          ? t('Caregiver.employeeLinkRequired')
          : t('Caregiver.workflowStatusUnavailable')}
      </p>
      <CaregiverRetryButton label={t('Caregiver.retry')} pendingLabel={t('Caregiver.retrying')} />
    </section>
  );
}

async function VisitWorkflowStatus({
  visitId,
  visitStatus,
  executionStatus,
  documentationPromise,
  evidencePromise,
}: {
  visitId: string;
  visitStatus: string;
  executionStatus: string;
  documentationPromise: ReturnType<typeof getDocumentationResult>;
  evidencePromise: ReturnType<typeof getEvidenceResult>;
}) {
  const [documentationResult, evidenceResult] = await Promise.all([
    documentationPromise,
    evidencePromise,
  ]);
  const t = await getTranslations();
  const documentationUnavailable = Boolean(documentationResult.error || !documentationResult.data);
  const evidenceUnavailable = Boolean(evidenceResult.error || !evidenceResult.data);
  const documentation = documentationResult.data?.items.find((item) => item.visitId === visitId);
  const evidence = evidenceResult.data?.items
    .filter((item) => item.visitId === visitId)
    .sort((left, right) => (left.packageVersion ?? 0) - (right.packageVersion ?? 0))
    .at(-1);
  const documentationStatus = documentationUnavailable
    ? `⚠ ${t('CareDocumentation.visit.unavailable')}`
    : documentation?.documentationStatus === 'finalized'
      ? `✓ ${t('CareDocumentation.finalized')}`
      : documentation?.documentationStatus === 'draft'
        ? `⚠ ${t('CareDocumentation.incomplete')}`
        : executionStatus === 'completed'
          ? `⚠ ${t('CareDocumentation.missing')}`
          : `${t('CareDocumentation.visit.title')}: ${t('CareDocumentation.visit.notCreated')}`;
  const showEvidenceStatus = executionStatus === 'completed' && visitStatus !== 'cancelled';
  const evidenceStatus = evidenceUnavailable
    ? `⚠ ${t('ServiceEvidence.care.loadFailed')}`
    : t(acknowledgementStatusKey(evidence?.status));
  const href = `/care/visits/${visitId}`;
  const action =
    visitStatus === 'cancelled'
      ? t('Caregiver.viewVisit')
      : executionStatus === 'in_progress'
        ? t('Caregiver.continueVisit')
        : executionStatus === 'not_started'
          ? t('Caregiver.startVisit')
          : documentationUnavailable
            ? t('Caregiver.openVisit')
            : documentation?.documentationStatus !== 'finalized'
              ? t('Caregiver.reviewDocumentation')
              : evidenceUnavailable || !evidence || evidence.status !== 'acknowledged'
                ? t('Caregiver.reviewAcknowledgement')
                : t('Caregiver.viewVisit');
  const actionHref =
    executionStatus === 'completed' &&
    !documentationUnavailable &&
    documentation?.documentationStatus === 'finalized'
      ? `/care/visits/${visitId}/evidence`
      : href;

  return (
    <div className="grid gap-2">
      <p className="text-sm">
        {documentationStatus}
        {showEvidenceStatus ? <> · {evidenceStatus}</> : null}
      </p>
      <Button
        asChild
        variant={executionStatus === 'in_progress' ? 'default' : 'outline'}
        className="min-h-11 w-full sm:w-auto"
      >
        <Link href={actionHref}>{action}</Link>
      </Button>
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
