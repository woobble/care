import Link from 'next/link';
import { v7 as uuidv7 } from 'uuid';
import { getLocale, getTranslations } from 'next-intl/server';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { formatVisitDateTime } from '@app/web/lib/care-date';
import { formatNumber } from '@app/web/i18n/format';
import { errorMessageKey } from '@app/web/i18n/errors';
import { quantityUnitKey } from '@app/web/i18n/status';
import { prepareEvidencePackageAction } from '@app/web/app/care/actions';
import { CareForm } from '@app/web/app/care/care-form';
import { EvidenceAcknowledgementForm } from './evidence-acknowledgement-form';
import { PageHeader } from '@app/web/components/page-patterns';
import { CaregiverRetryButton } from '@app/web/components/caregiver-retry-button';

type EvidencePackage = components['schemas']['EvidencePackageResponseDto'];

type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function CareEvidencePage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const { id: visitId } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const documentationResult = await get('/api/v1/visits/{visitId}/documentation', {
    params: { path: { visitId }, header },
  });
  const documentation = documentationResult.data?.documentation;
  const documentationUnavailable = Boolean(documentationResult.error || !documentationResult.data);
  const finalized = documentation?.status === 'finalized';
  const packageResult = finalized
    ? await get('/api/v1/visits/{visitId}/evidence-package', {
        params: { path: { visitId }, header },
      })
    : null;
  const evidencePackage = packageResult?.data as EvidencePackage | undefined;
  const packageMissing = packageResult?.error?.code === 'EVIDENCE_PACKAGE_NOT_FOUND';
  const packageUnavailable = Boolean(packageResult?.error && !packageMissing);
  const packageNeedsPreparation =
    finalized && !packageUnavailable && (!evidencePackage || evidencePackage.status === 'outdated');

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader
        eyebrow={t('ServiceEvidence.care.section')}
        title={t('ServiceEvidence.care.title')}
        description={t('ServiceEvidence.care.description')}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/care/visits/${visitId}`}>{t('ServiceEvidence.care.backToVisit')}</Link>
          </Button>
        }
      />

      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t(noticeKey(query.notice))}
        </p>
      ) : null}
      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}

      {documentationUnavailable ? (
        <section className="grid gap-3 rounded-lg border bg-card p-4">
          <div className="grid gap-2">
            <h2 className="text-lg font-semibold">{t('CareDocumentation.visit.unavailable')}</h2>
            {documentationResult.error ? (
              <p className="text-sm text-muted-foreground">
                {t(errorMessageKey(documentationResult.error.code))}
              </p>
            ) : null}
          </div>
          <CaregiverRetryButton
            label={t('Caregiver.retry')}
            pendingLabel={t('Caregiver.retrying')}
          />
        </section>
      ) : !documentation ? (
        <section className="grid gap-2 rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold">
            {t('ServiceEvidence.care.documentationMissing')}
          </h2>
          <p className="text-muted-foreground">
            {t('ServiceEvidence.care.prepareAfterFinalization')}
          </p>
        </section>
      ) : !finalized ? (
        <section className="grid gap-2 rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold">
            {t('ServiceEvidence.care.documentationNotFinalized')}
          </h2>
          <p className="text-muted-foreground">{t('ServiceEvidence.care.finalizeFirst')}</p>
        </section>
      ) : null}

      {packageNeedsPreparation ? (
        <section className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="text-xl font-semibold">
            {evidencePackage
              ? t('ServiceEvidence.care.newVersionRequired')
              : t('ServiceEvidence.care.prepareTitle')}
          </h2>
          <p className="text-muted-foreground">
            {evidencePackage
              ? t('ServiceEvidence.care.changedSinceVersion')
              : t('ServiceEvidence.care.readyToPrepare')}
          </p>
          {evidencePackage ? <EvidenceSnapshot packageData={evidencePackage} /> : null}
          <CareForm action={prepareEvidencePackageAction} notice={query.notice}>
            <input type="hidden" name="visitId" value={visitId} />
            <Button type="submit" className="min-h-12 w-full sm:w-fit">
              {evidencePackage
                ? t('ServiceEvidence.care.createCurrentVersion')
                : t('ServiceEvidence.care.create')}
            </Button>
          </CareForm>
        </section>
      ) : null}

      {evidencePackage && evidencePackage.status !== 'outdated' ? (
        <>
          <EvidenceSnapshot packageData={evidencePackage} />
          {evidencePackage.status === 'acknowledged' ? (
            <p
              role="status"
              className="rounded-lg border border-success/40 bg-success-muted p-4 text-success-foreground"
            >
              {t('ServiceEvidence.care.acknowledged')}
              {evidencePackage.acknowledgements.at(-1)?.acknowledgedAt ||
              evidencePackage.acknowledgements.at(-1)?.declinedAt ||
              evidencePackage.acknowledgements.at(-1)?.createdAt
                ? ` · ${formatVisitDateTime(
                    evidencePackage.acknowledgements.at(-1)?.acknowledgedAt ??
                      evidencePackage.acknowledgements.at(-1)?.declinedAt ??
                      evidencePackage.acknowledgements.at(-1)?.createdAt ??
                      '',
                    evidencePackage.snapshot.timezone,
                    locale,
                  )}`
                : ''}
              .
            </p>
          ) : null}
          {evidencePackage.status === 'declined' ? (
            <p
              role="status"
              className="rounded-lg border border-warning/40 bg-warning-muted p-4 text-warning-foreground"
            >
              {t('ServiceEvidence.care.declined')}
            </p>
          ) : null}
          {evidencePackage.status === 'revoked' ? (
            <p
              role="status"
              className="rounded-lg border border-warning/40 bg-warning-muted p-4 text-warning-foreground"
            >
              {t('ServiceEvidence.care.revoked')}
            </p>
          ) : null}
          {evidencePackage.status === 'ready' || evidencePackage.status === 'revoked' ? (
            <EvidenceAcknowledgementForm
              visitId={visitId}
              evidencePackageId={evidencePackage.id}
              clientName={evidencePackage.snapshot.clientName}
              statementText={evidencePackage.statementText}
              eligibleSignatories={evidencePackage.eligibleSignatories}
              acknowledgementIdempotencyKey={uuidv7()}
              declineIdempotencyKey={uuidv7()}
            />
          ) : null}
        </>
      ) : null}

      {finalized && packageUnavailable ? (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          <p>{t('ServiceEvidence.care.loadFailed')}</p>
          <CaregiverRetryButton
            label={t('Caregiver.retry')}
            pendingLabel={t('Caregiver.retrying')}
          />
        </section>
      ) : null}
    </div>
  );
}

async function EvidenceSnapshot({ packageData }: { packageData: EvidencePackage }) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const snapshot = packageData.snapshot;
  return (
    <section className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('ServiceEvidence.care.snapshotTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatVisitDateTime(snapshot.plannedStart, snapshot.timezone, locale)}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm">
          {t('ServiceEvidence.care.version', {
            version: formatNumber(packageData.version, locale),
          })}
        </span>
      </header>
      <dl className="grid gap-3 rounded-md bg-background p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('ServiceEvidence.care.client')}</dt>
          <dd className="font-medium">{snapshot.clientName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('ServiceEvidence.care.actualVisitTime')}</dt>
          <dd className="font-medium">
            {snapshot.actualStart
              ? formatVisitDateTime(snapshot.actualStart, snapshot.timezone, locale)
              : t('ServiceEvidence.care.notRecorded')}
            –
            {snapshot.actualEnd
              ? formatVisitDateTime(snapshot.actualEnd, snapshot.timezone, locale)
              : t('ServiceEvidence.care.notRecorded')}
          </dd>
        </div>
      </dl>
      {snapshot.items.length ? (
        <ul className="grid gap-2">
          {snapshot.items.map((item) => (
            <li key={item.performedServiceId} className="grid gap-1 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-semibold">{item.serviceName}</span>
                <span className="rounded-full bg-muted px-2 py-1 text-sm">
                  {t(outcomeKey(item.outcome))}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('ServiceEvidence.care.actualQuantity', {
                  quantity:
                    item.actualQuantity == null
                      ? '–'
                      : t(quantityUnitKey(item.unit), { count: item.actualQuantity }),
                })}
                {item.plannedQuantity != null
                  ? ` · ${t('ServiceEvidence.care.plannedQuantity', {
                      quantity: t(quantityUnitKey(item.unit), { count: item.plannedQuantity }),
                    })}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border p-3 text-muted-foreground">
          {t('ServiceEvidence.care.noServices')}
        </p>
      )}
      <p className="min-w-0 text-xs text-muted-foreground">
        {t('ServiceEvidence.care.checksum')}:{' '}
        <code className="break-all font-mono">{packageData.snapshotHash}</code>
      </p>
    </section>
  );
}

function outcomeKey(
  outcome: string,
):
  | 'ServiceEvidence.care.outcome.performed'
  | 'ServiceEvidence.care.outcome.partiallyPerformed'
  | 'ServiceEvidence.care.outcome.notPerformed'
  | 'ServiceEvidence.care.outcome.unknown' {
  if (outcome === 'performed') return 'ServiceEvidence.care.outcome.performed';
  if (outcome === 'partially_performed') return 'ServiceEvidence.care.outcome.partiallyPerformed';
  if (outcome === 'not_performed') return 'ServiceEvidence.care.outcome.notPerformed';
  return 'ServiceEvidence.care.outcome.unknown';
}

function noticeKey(
  notice: string,
):
  | 'ServiceEvidence.care.notices.packagePrepared'
  | 'ServiceEvidence.care.notices.acknowledged'
  | 'ServiceEvidence.care.notices.declined'
  | 'ServiceEvidence.care.notices.unknown' {
  if (notice === 'package-prepared') return 'ServiceEvidence.care.notices.packagePrepared';
  if (notice === 'acknowledged') return 'ServiceEvidence.care.notices.acknowledged';
  if (notice === 'declined') return 'ServiceEvidence.care.notices.declined';
  return 'ServiceEvidence.care.notices.unknown';
}
