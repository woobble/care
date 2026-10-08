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
  const [visitsResult, documentationResult, evidenceResult] = await Promise.all([
    get('/api/v1/me/visits', {
      params: { query: { from: range.from, until: range.until }, header: await getTenantHeader() },
    }),
    get('/api/v1/me/documentation', {
      params: { query: { from: range.from, until: range.until }, header: await getTenantHeader() },
    }),
    get('/api/v1/me/service-evidence', {
      params: { query: { from: range.from, until: range.until }, header: await getTenantHeader() },
    }),
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

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Caregiver.loadFailed')}
        </p>
      ) : null}

      {visits.length ? (
        <ul className="grid gap-3">
          {visits.map((visit) => (
            <li key={visit.id}>
              <Link
                href={'/care/visits/' + visit.id}
                className="grid min-h-24 gap-3 rounded-lg border bg-white p-4 shadow-sm transition hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 sm:grid-cols-[5rem_1fr_auto] sm:items-center"
              >
                <span className="text-xl font-semibold tabular-nums text-blue-900">
                  {formatVisitTime(visit.plannedStart, visit.timezone, locale)}
                </span>
                <span className="grid gap-1">
                  <span className="text-lg font-semibold">{visit.clientDisplayName}</span>
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
              </Link>
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
