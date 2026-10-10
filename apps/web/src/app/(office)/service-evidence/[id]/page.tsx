import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { components } from '@care/api-client';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import {
  acknowledgementCapacityKey,
  acknowledgementMethodKey,
  declineReasonKey,
  evidenceOutcomeKey,
  evidenceStatusKey,
} from '../../../../i18n/evidence';
import { errorMessageKey } from '../../../../i18n/errors';
import { formatNumber } from '../../../../i18n/format';
import { quantityUnitKey } from '../../../../i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '../../../../lib/api';
import { formatVisitDateTime } from '../../../../lib/care-date';
import { ConfirmSubmitButton } from '../../administration/confirm-submit-button';
import { revokeAcknowledgementAction } from '../actions';
import { generateDocumentAction } from '../../documents/actions';

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
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        {t(errorMessageKey(packageResult.error?.code ?? ''))}
      </p>
    );
  }
  const sourceClientResult = await get('/api/v1/clients/{id}', {
    params: { path: { id: packageData.snapshot.clientId }, header },
  });
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link className="text-sm font-semibold text-blue-800 underline" href="/service-evidence">
            {t('ServiceEvidence.office.detail.backToList')}
          </Link>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('ServiceEvidence.office.detail.title', {
              version: formatNumber(packageData.version, locale),
            })}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{packageData.snapshot.clientName}</h1>
          <p className="mt-2 text-slate-600">
            {formatVisitDateTime(
              packageData.snapshot.plannedStart,
              packageData.snapshot.timezone,
              locale,
            )}
          </p>
        </div>
        <span
          className={
            packageData.isCurrent
              ? 'rounded-full bg-green-100 px-3 py-1 text-sm text-green-900'
              : 'rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-950'
          }
        >
          {t(
            packageData.isCurrent
              ? evidenceStatusKey(packageData.status)
              : 'ServiceEvidence.office.detail.outdated',
          )}
        </span>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {canGenerateDocument ? (
        <form
          action={generateDocumentAction}
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
        >
          <input type="hidden" name="sourceType" value="evidence_package" />
          <input type="hidden" name="evidencePackageId" value={packageData.id} />
          <input type="hidden" name="returnTo" value={`/service-evidence/${packageData.id}`} />
          <label className="grid gap-1 text-sm font-medium">
            <span>{t('Documents.language')}</span>
            <select
              name="locale"
              defaultValue={locale}
              className="h-10 rounded-md border bg-white px-3"
            >
              <option value="de">{t('Documents.languageOptions.german')}</option>
              <option value="en">{t('Documents.languageOptions.english')}</option>
            </select>
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
        </form>
      ) : null}

      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {query.notice === 'acknowledgement-revoked'
            ? t('ServiceEvidence.office.detail.revokedNotice')
            : t('Errors.saved')}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {t('ServiceEvidence.office.detail.servicesTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
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
          <span className="text-sm text-slate-600">
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
                  <p className="text-sm text-slate-600">{item.serviceCode}</p>
                </div>
                <div className="text-right text-sm">
                  <p>{t(evidenceOutcomeKey(item.outcome))}</p>
                  <p className="text-slate-600">
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
          <p className="rounded-md border p-3 text-slate-700">
            {t('ServiceEvidence.office.detail.noServices')}
          </p>
        )}
        <dl className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">{t('ServiceEvidence.office.detail.checksum')}</dt>
            <dd className="break-all font-mono">{packageData.snapshotHash}</dd>
          </div>
          <div>
            <dt className="text-slate-600">{t('ServiceEvidence.office.detail.created')}</dt>
            <dd>
              {formatVisitDateTime(packageData.generatedAt, packageData.snapshot.timezone, locale)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
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
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-sm">
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
                    <p className="break-all text-xs text-slate-500">
                      {t('ServiceEvidence.office.detail.signatureChecksum')}{' '}
                      {acknowledgement.signatureSha256}
                    </p>
                  ) : null}
                  {signature ? <SignatureView signature={signature} /> : null}
                  {acknowledgement.signatureAvailable && !signature ? (
                    <p className="text-sm text-amber-900">
                      {t('ServiceEvidence.office.detail.signatureUnavailable')}
                    </p>
                  ) : null}
                  {canRevoke ? (
                    <form
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
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-slate-700">{t('ServiceEvidence.office.detail.noAcknowledgement')}</p>
        )}
        <p className="text-xs text-slate-500">
          {t('ServiceEvidence.office.detail.statementLabel', {
            version: packageData.statementVersion,
          })}{' '}
          {packageData.statementText}
        </p>
      </section>

      {packageHistory.length > 1 ? (
        <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
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
                  className="font-medium text-blue-900 underline"
                >
                  {t('ServiceEvidence.office.detail.title', {
                    version: formatNumber(item.packageVersion ?? 0, locale),
                  })}{' '}
                  · {t(evidenceStatusKey(item.status))}
                </Link>
                <span className="text-sm text-slate-600">
                  {formatVisitDateTime(item.plannedStart, item.timezone, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Button asChild variant="secondary" className="w-fit">
        <Link href={`/visits/${packageData.snapshot.visitId}`}>
          {t('ServiceEvidence.office.detail.openVisit')}
        </Link>
      </Button>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

async function SignatureView({ signature }: { signature: Signature }) {
  const t = await getTranslations();
  return (
    <figure className="grid gap-2 rounded-md bg-slate-50 p-3">
      <figcaption className="text-sm font-medium">
        {t('ServiceEvidence.office.detail.savedSignature')}
      </figcaption>
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('ServiceEvidence.office.detail.savedSignature')}
        className="h-32 w-full border bg-white"
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
            className="text-slate-900"
          />
        ))}
      </svg>
    </figure>
  );
}
