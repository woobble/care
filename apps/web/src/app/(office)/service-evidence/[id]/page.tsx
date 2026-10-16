import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import { generateDocumentAction } from '@app/web/app/(office)/documents/actions';
import { revokeAcknowledgementAction } from '@app/web/app/(office)/service-evidence/actions';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  acknowledgementCapacityKey,
  acknowledgementMethodKey,
  declineReasonKey,
  evidenceOutcomeKey,
  evidenceStatusKey,
} from '@app/web/i18n/evidence';
import { formatNumber } from '@app/web/i18n/format';
import { quantityUnitKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { formatVisitDateTime } from '@app/web/lib/care-date';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { NativeSelect } from '@care/ui/components/native-select';

type EvidencePackage = components['schemas']['EvidencePackageResponseDto'];
type Signature = components['schemas']['SignatureResponseDto'];
type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function ServiceEvidenceDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'service_evidence.read')) redirect('/service-evidence');
  const packageResult = await get('/api/v1/evidence-packages/{id}', {
    params: { path: { id }, header },
  });
  if (packageResult.error?.code === 'EVIDENCE_PACKAGE_NOT_FOUND') notFound();
  const packageData = packageResult.data as EvidencePackage | undefined;
  if (!packageData) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
      >
        {t(errorMessageKey(packageResult.error?.code ?? ''))}
      </p>
    );
  }
  const [sourceClientResult, sourceVisitResult] = await Promise.all([
    get('/api/v1/clients/{id}', {
      params: { path: { id: packageData.snapshot.clientId }, header },
    }),
    get('/api/v1/visits/{id}', {
      params: { path: { id: packageData.snapshot.visitId }, header },
    }),
  ]);
  const canGenerateDocument = sourceClientResult.data
    ? hasClientPermission(
        permissions,
        'documents.generate',
        header['X-Tenant-Id'],
        sourceClientResult.data.organizationId,
        sourceClientResult.data.primaryFacilityId,
      )
    : false;

  const acknowledged = hasPermission(permissions, 'acknowledgement.read');
  const mayRevoke = hasPermission(permissions, 'acknowledgement.revoke');
  const signatureResults = acknowledged
    ? await Promise.all(
        packageData.acknowledgements
          .filter((item) => item.signatureAvailable)
          .map(async (item) => {
            const result = await get('/api/v1/acknowledgements/{id}/signature', {
              params: { path: { id: item.id }, header },
            });
            return [item.id, result.data as Signature | undefined] as const;
          }),
      )
    : [];
  const signatures = new Map(signatureResults.filter(([, value]) => value));
  const start = new Date(
    new Date(packageData.snapshot.plannedStart).getTime() - 48 * 60 * 60 * 1000,
  );
  const end = new Date(new Date(packageData.snapshot.plannedStart).getTime() + 48 * 60 * 60 * 1000);
  const historyResult = await get('/api/v1/service-evidence', {
    params: {
      query: {
        from: start.toISOString(),
        until: end.toISOString(),
        visitId: packageData.snapshot.visitId,
        page: 1,
        pageSize: 100,
      },
      header,
    },
  });
  const packageHistory = (historyResult.data?.items ?? [])
    .filter((item) => item.visitId === packageData.snapshot.visitId && item.evidencePackageId)
    .sort((left, right) => (left.packageVersion ?? 0) - (right.packageVersion ?? 0));

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={t('ServiceEvidence.office.detail.title', {
          version: formatNumber(packageData.version, locale),
        })}
        title={packageData.snapshot.clientName}
        description={formatVisitDateTime(
          packageData.snapshot.plannedStart,
          packageData.snapshot.timezone,
          locale,
        )}
        meta={
          <span
            className={
              packageData.isCurrent
                ? 'rounded-full bg-success-muted px-3 py-1 text-sm text-success-foreground'
                : 'rounded-full bg-warning-muted px-3 py-1 text-sm text-warning-foreground'
            }
          >
            {t(
              packageData.isCurrent
                ? evidenceStatusKey(packageData.status)
                : 'ServiceEvidence.office.detail.outdated',
            )}
          </span>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href="/service-evidence">{t('ServiceEvidence.office.detail.backToList')}</Link>
          </Button>
        }
      />

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {canGenerateDocument ? (
        <RHFActionForm
          action={generateDocumentAction}
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
        >
          <input type="hidden" name="sourceType" value="evidence_package" />
          <input type="hidden" name="evidencePackageId" value={packageData.id} />
          <input type="hidden" name="returnTo" value={`/service-evidence/${packageData.id}`} />
          <label className="grid gap-1 text-sm font-medium">
            <span>{t('Documents.language')}</span>
            <NativeSelect
              name="locale"
              defaultValue={locale}
              selectClassName="h-10 rounded-md border bg-card px-3"
              className="w-full"
            >
              <option value="de">{t('Documents.languageOptions.german')}</option>
              <option value="en">{t('Documents.languageOptions.english')}</option>
            </NativeSelect>
          </label>
          <Button type="submit">{t('Documents.generateEvidence')}</Button>
          <Button asChild variant="secondary">
            <Link
              href={`/documents/preview?sourceType=evidence_package&id=${packageData.id}&locale=${locale}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('Documents.preview')}
            </Link>
          </Button>
        </RHFActionForm>
      ) : null}

      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {query.notice === 'acknowledgement-revoked'
            ? t('ServiceEvidence.office.detail.revokedNotice')
            : t('Errors.saved')}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {t('ServiceEvidence.office.detail.servicesTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('ServiceEvidence.office.detail.actualVisit')}{' '}
              {formatVisitDateTime(
                packageData.snapshot.actualStart,
                packageData.snapshot.timezone,
                locale,
              )}
              –
              {formatVisitDateTime(
                packageData.snapshot.actualEnd,
                packageData.snapshot.timezone,
                locale,
              )}
            </p>
          </div>
          <span className="text-sm text-muted-foreground">
            {t('ServiceEvidence.office.detail.documentationVersion', {
              version: formatNumber(packageData.snapshot.documentationVersion, locale),
            })}{' '}
            ·{' '}
            {t('ServiceEvidence.office.detail.amendmentCount', {
              count: formatNumber(packageData.snapshot.amendmentCount, locale),
            })}
          </span>
        </header>
        {packageData.snapshot.items.length ? (
          <ul className="grid gap-2">
            {packageData.snapshot.items.map((item) => (
              <li
                key={item.performedServiceId}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <h3 className="font-semibold">{item.serviceName}</h3>
                  <p className="text-sm text-muted-foreground">{item.serviceCode}</p>
                </div>
                <div className="text-right text-sm">
                  <p>{t(evidenceOutcomeKey(item.outcome))}</p>
                  <p className="text-muted-foreground">
                    {t('ServiceEvidence.care.actualQuantity', {
                      quantity:
                        item.actualQuantity == null
                          ? '–'
                          : t(quantityUnitKey(item.unit), { count: item.actualQuantity }),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border p-3 text-muted-foreground">
            {t('ServiceEvidence.office.detail.noServices')}
          </p>
        )}
        <dl className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('ServiceEvidence.office.detail.checksum')}</dt>
            <dd className="font-mono break-all">{packageData.snapshotHash}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('ServiceEvidence.office.detail.created')}</dt>
            <dd>
              {formatVisitDateTime(packageData.generatedAt, packageData.snapshot.timezone, locale)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5">
        <h2 className="text-xl font-semibold">
          {t('ServiceEvidence.office.detail.acknowledgementsTitle')}
        </h2>
        {packageData.acknowledgements.length ? (
          <ul className="grid gap-4">
            {packageData.acknowledgements.map((acknowledgement) => {
              const signature = signatures.get(acknowledgement.id);
              const canRevoke =
                mayRevoke &&
                acknowledgement.status === 'acknowledged' &&
                !acknowledgement.revokedAt;
              return (
                <li key={acknowledgement.id} className="grid gap-3 rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold">{acknowledgement.signatoryName}</h3>
                    <span className="rounded-full bg-muted px-2 py-1 text-sm">
                      {t(evidenceStatusKey(acknowledgement.status))}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <Detail
                      label={t('ServiceEvidence.office.detail.capacity')}
                      value={t(acknowledgementCapacityKey(acknowledgement.capacity))}
                    />
                    <Detail
                      label={t('ServiceEvidence.office.detail.method')}
                      value={t(acknowledgementMethodKey(acknowledgement.method))}
                    />
                    <Detail
                      label={t(
                        acknowledgement.status === 'declined'
                          ? 'ServiceEvidence.office.detail.capturedAt'
                          : 'ServiceEvidence.office.detail.confirmedAt',
                      )}
                      value={formatVisitDateTime(
                        acknowledgement.acknowledgedAt ??
                          acknowledgement.declinedAt ??
                          acknowledgement.createdAt ??
                          packageData.generatedAt,
                        packageData.snapshot.timezone,
                        locale,
                      )}
                    />
                    <Detail
                      label={t('ServiceEvidence.office.detail.statementVersion')}
                      value={acknowledgement.statementVersion}
                    />
                    {acknowledgement.status === 'declined' ? (
                      <Detail
                        label={t('ServiceEvidence.office.detail.reason')}
                        value={`${t(declineReasonKey(acknowledgement.declineReasonCode))}${acknowledgement.declineNote ? ` · ${acknowledgement.declineNote}` : ''}`}
                      />
                    ) : null}
                    {acknowledgement.revokedAt ? (
                      <Detail
                        label={t('ServiceEvidence.office.detail.revokedAt')}
                        value={`${formatVisitDateTime(acknowledgement.revokedAt, packageData.snapshot.timezone, locale)} · ${acknowledgement.revocationReason ?? ''}`}
                      />
                    ) : null}
                  </dl>
                  {acknowledgement.signatureSha256 ? (
                    <p className="text-xs break-all text-muted-foreground">
                      {t('ServiceEvidence.office.detail.signatureChecksum')}{' '}
                      {acknowledgement.signatureSha256}
                    </p>
                  ) : null}
                  {signature ? <SignatureView signature={signature} /> : null}
                  {acknowledgement.signatureAvailable && !signature ? (
                    <p className="text-sm text-warning-foreground">
                      {t('ServiceEvidence.office.detail.signatureUnavailable')}
                    </p>
                  ) : null}
                  {canRevoke ? (
                    <RHFActionForm
                      action={revokeAcknowledgementAction}
                      className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto] sm:items-end"
                    >
                      <input type="hidden" name="acknowledgementId" value={acknowledgement.id} />
                      <input type="hidden" name="evidencePackageId" value={packageData.id} />
                      <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                        <span>{t('ServiceEvidence.office.detail.revocationReason')}</span>
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          className="min-h-11 rounded-md border px-3"
                        />
                      </label>
                      <div />
                      <ConfirmSubmitButton
                        confirmation={t('ServiceEvidence.office.detail.revokeConfirmation')}
                      >
                        {t('ServiceEvidence.office.detail.revokeAction')}
                      </ConfirmSubmitButton>
                    </RHFActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {t('ServiceEvidence.office.detail.noAcknowledgement')}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('ServiceEvidence.office.detail.statementLabel', {
            version: packageData.statementVersion,
          })}{' '}
          {packageData.statementText}
        </p>
      </section>

      {packageHistory.length > 1 ? (
        <section className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="text-xl font-semibold">
            {t('ServiceEvidence.office.detail.packageVersions')}
          </h2>
          <ul className="grid gap-2">
            {packageHistory.map((item) => (
              <li
                key={item.evidencePackageId}
                className="flex flex-wrap justify-between gap-2 rounded-md border p-3"
              >
                <Link
                  href={`/service-evidence/${item.evidencePackageId}`}
                  className="font-medium text-primary underline"
                >
                  {t('ServiceEvidence.office.detail.title', {
                    version: formatNumber(item.packageVersion ?? 0, locale),
                  })}{' '}
                  · {t(evidenceStatusKey(item.status))}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {formatVisitDateTime(item.plannedStart, item.timezone, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sourceVisitResult.data ? (
        <Button asChild variant="secondary" className="w-fit">
          <Link href={`/visits/${packageData.snapshot.visitId}`}>
            {t('ServiceEvidence.office.detail.openVisit')}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

async function SignatureView({ signature }: { signature: Signature }) {
  const t = await getTranslations();
  return (
    <figure className="grid gap-2 rounded-md bg-background p-3">
      <figcaption className="text-sm font-medium">
        {t('ServiceEvidence.office.detail.savedSignature')}
      </figcaption>
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('ServiceEvidence.office.detail.savedSignature')}
        className="h-32 w-full border bg-card"
      >
        {signature.strokes.map((stroke) => (
          <path
            key={stroke.map((point) => `${point.x}:${point.y}`).join('|')}
            d={stroke
              .map(
                (point, pointIndex) =>
                  `${pointIndex === 0 ? 'M' : 'L'} ${point.x * 1000} ${point.y * 300}`,
              )
              .join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="text-foreground"
          />
        ))}
      </svg>
    </figure>
  );
}
