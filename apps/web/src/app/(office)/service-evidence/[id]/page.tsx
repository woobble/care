import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { components } from '@care/api-client';
import { Button } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../../lib/api';
import { formatVisitDateTime } from '../../../../lib/care-date';
import { ConfirmSubmitButton } from '../../administration/confirm-submit-button';
import { revokeAcknowledgementAction } from '../actions';

type EvidencePackage = components['schemas']['EvidencePackageResponseDto'];
type Signature = components['schemas']['SignatureResponseDto'];
type SearchParams = Promise<{ notice?: string }>;

export default async function ServiceEvidenceDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
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
        Leistungsnachweis konnte nicht geladen werden ({packageResult.error?.code}).
      </p>
    );
  }

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
            Zurück zur Leistungsnachweisliste
          </Link>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-blue-800">
            Leistungsnachweis · Version {packageData.version}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{packageData.snapshot.clientName}</h1>
          <p className="mt-2 text-slate-600">
            {formatVisitDateTime(packageData.snapshot.plannedStart, packageData.snapshot.timezone)}
          </p>
        </div>
        <span
          className={
            packageData.isCurrent
              ? 'rounded-full bg-green-100 px-3 py-1 text-sm text-green-900'
              : 'rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-950'
          }
        >
          {packageData.isCurrent ? statusLabel(packageData.status) : 'Veraltet'}
        </span>
      </header>

      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {query.notice === 'acknowledgement-revoked'
            ? 'Bestätigung wurde widerrufen.'
            : query.notice}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Angezeigte Leistungen</h2>
            <p className="mt-1 text-sm text-slate-600">
              Tatsächlicher Einsatz:{' '}
              {formatVisitDateTime(packageData.snapshot.actualStart, packageData.snapshot.timezone)}
              –{formatVisitDateTime(packageData.snapshot.actualEnd, packageData.snapshot.timezone)}
            </p>
          </div>
          <span className="text-sm text-slate-600">
            Dokumentationsversion {packageData.snapshot.documentationVersion} · Änderung{' '}
            {packageData.snapshot.amendmentCount}
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
                  <p>{outcomeLabel(item.outcome)}</p>
                  <p className="text-slate-600">
                    Tatsächlich: {item.actualQuantity ?? '–'} {unitLabel(item.unit)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border p-3 text-slate-700">Keine Leistungen im Paket.</p>
        )}
        <dl className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">Prüfsumme</dt>
            <dd className="break-all font-mono">{packageData.snapshotHash}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Erstellt</dt>
            <dd>{formatVisitDateTime(packageData.generatedAt, packageData.snapshot.timezone)}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">Bestätigungen und Verlauf</h2>
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
                      {statusLabel(acknowledgement.status)}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <Detail label="Kapazität" value={capacityLabel(acknowledgement.capacity)} />
                    <Detail label="Methode" value={methodLabel(acknowledgement.method)} />
                    <Detail
                      label={acknowledgement.status === 'declined' ? 'Erfasst am' : 'Bestätigt am'}
                      value={formatVisitDateTime(
                        acknowledgement.acknowledgedAt ??
                          acknowledgement.declinedAt ??
                          acknowledgement.createdAt,
                        packageData.snapshot.timezone,
                      )}
                    />
                    <Detail label="Aussageversion" value={acknowledgement.statementVersion} />
                    {acknowledgement.status === 'declined' ? (
                      <Detail
                        label="Grund"
                        value={`${declineReasonLabel(acknowledgement.declineReasonCode ?? null)}${acknowledgement.declineNote ? ` · ${acknowledgement.declineNote}` : ''}`}
                      />
                    ) : null}
                    {acknowledgement.revokedAt ? (
                      <Detail
                        label="Widerrufen am"
                        value={`${formatVisitDateTime(acknowledgement.revokedAt, packageData.snapshot.timezone)} · ${acknowledgement.revocationReason ?? ''}`}
                      />
                    ) : null}
                  </dl>
                  {acknowledgement.signatureSha256 ? (
                    <p className="break-all text-xs text-slate-500">
                      Signatur-Prüfsumme: {acknowledgement.signatureSha256}
                    </p>
                  ) : null}
                  {signature ? <SignatureView signature={signature} /> : null}
                  {acknowledgement.signatureAvailable && !signature ? (
                    <p className="text-sm text-amber-900">
                      Unterschrift konnte nicht geladen werden.
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
                        <span>Grund für den Widerruf</span>
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          className="min-h-11 rounded-md border px-3"
                        />
                      </label>
                      <div />
                      <ConfirmSubmitButton confirmation="Diese Bestätigung mit Begründung widerrufen?">
                        Bestätigung widerrufen
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-slate-700">
            Für diese Paketversion wurde noch keine Bestätigung erfasst.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Aussage ({packageData.statementVersion}): {packageData.statementText}
        </p>
      </section>

      {packageHistory.length > 1 ? (
        <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
          <h2 className="text-xl font-semibold">Paketversionen für diesen Einsatz</h2>
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
                  Version {item.packageVersion} · {statusLabel(item.status)}
                </Link>
                <span className="text-sm text-slate-600">
                  {formatVisitDateTime(item.plannedStart, item.timezone)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Button asChild variant="secondary" className="w-fit">
        <Link href={`/visits/${packageData.snapshot.visitId}`}>Einsatzdetails öffnen</Link>
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

function SignatureView({ signature }: { signature: Signature }) {
  return (
    <figure className="grid gap-2 rounded-md bg-slate-50 p-3">
      <figcaption className="text-sm font-medium">Gespeicherte Unterschrift</figcaption>
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        role="img"
        aria-label="Gespeicherte Unterschrift"
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

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ready: 'Ausstehend',
    acknowledged: 'Bestätigt',
    declined: 'Abgelehnt',
    revoked: 'Widerrufen',
    outdated: 'Veraltet',
    superseded: 'Ersetzt',
  };
  return labels[status] ?? status;
}

function capacityLabel(capacity: string): string {
  const labels: Record<string, string> = {
    client: 'Klientin oder Klient',
    legal_guardian: 'gesetzliche Betreuung',
    authorized_representative: 'bevollmächtigte Vertretung',
    relative: 'Angehörige Person',
    other: 'sonstige berechtigte Person',
  };
  return labels[capacity] ?? capacity;
}

function methodLabel(method: string): string {
  if (method === 'touch_signature') return 'Unterschrift';
  if (method === 'typed_confirmation') return 'Namensbestätigung';
  return 'Ablehnung';
}

function declineReasonLabel(reason: string | null): string {
  const labels: Record<string, string> = {
    declined_without_reason: 'Ohne Angabe abgelehnt',
    disagrees_with_record: 'Mit Dokumentation nicht einverstanden',
    unable_to_sign: 'Unterschrift nicht möglich',
    signatory_not_available: 'Bestätigende Person nicht anwesend',
    other: 'Anderer Grund',
  };
  return reason ? (labels[reason] ?? reason) : '–';
}

function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    performed: 'Erbracht',
    partially_performed: 'Teilweise erbracht',
    not_performed: 'Nicht erbracht',
  };
  return labels[outcome] ?? outcome;
}

function unitLabel(unit: string): string {
  const labels: Record<string, string> = {
    occurrence: 'Einheit',
    minute: 'Minuten',
    hour: 'Stunden',
    day: 'Tage',
  };
  return labels[unit] ?? unit;
}
