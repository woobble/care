import Link from 'next/link';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@care/api-client';
import { Button } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import { formatVisitDateTime } from '../../../../../lib/care-date';
import { prepareEvidencePackageAction } from '../../../actions';
import { EvidenceAcknowledgementForm } from './evidence-acknowledgement-form';

type EvidencePackage = components['schemas']['EvidencePackageResponseDto'];

type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function CareEvidencePage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id: visitId } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const documentationResult = await get('/api/v1/visits/{visitId}/documentation', {
    params: { path: { visitId }, header },
  });
  const documentation = documentationResult.data?.documentation;
  const finalized = documentation?.status === 'finalized';
  const packageResult = finalized
    ? await get('/api/v1/visits/{visitId}/evidence-package', {
        params: { path: { visitId }, header },
      })
    : null;
  const evidencePackage = packageResult?.data as EvidencePackage | undefined;
  const packageMissing = packageResult?.error?.code === 'EVIDENCE_PACKAGE_NOT_FOUND';
  const packageNeedsPreparation =
    finalized && (!evidencePackage || evidencePackage.status === 'outdated');

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <header className="grid gap-2">
        <Link
          className="w-fit text-sm font-semibold text-blue-800 underline"
          href={`/care/visits/${visitId}`}
        >
          Zurück zum Einsatz
        </Link>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          Leistungsbestätigung
        </p>
        <h1 className="text-3xl font-semibold">Leistungsnachweis prüfen</h1>
        <p className="text-slate-600">
          Die Bestätigung bezieht sich auf die angezeigten Leistungsdaten. Sie ist keine
          Abrechnungsfreigabe und keine qualifizierte elektronische Signatur.
        </p>
      </header>

      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {noticeLabel(query.notice)}
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Die Bestätigung konnte nicht gespeichert werden ({query.error}).
        </p>
      ) : null}

      {!documentation ? (
        <section className="grid gap-2 rounded-lg border bg-white p-4">
          <h2 className="text-lg font-semibold">Dokumentation fehlt</h2>
          <p className="text-slate-700">
            Ein Leistungsnachweis kann erst nach Abschluss und Finalisierung der Dokumentation
            vorbereitet werden.
          </p>
          {documentationResult.error ? (
            <p className="text-sm text-slate-600">{documentationResult.error.code}</p>
          ) : null}
        </section>
      ) : !finalized ? (
        <section className="grid gap-2 rounded-lg border bg-white p-4">
          <h2 className="text-lg font-semibold">Dokumentation noch nicht finalisiert</h2>
          <p className="text-slate-700">
            Finalisieren Sie zuerst die Leistungsdokumentation. Danach kann die bestätigende Person
            den unveränderlichen Nachweis prüfen.
          </p>
        </section>
      ) : null}

      {packageNeedsPreparation ? (
        <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
          <h2 className="text-xl font-semibold">
            {evidencePackage ? 'Neue Version erforderlich' : 'Leistungsnachweis vorbereiten'}
          </h2>
          <p className="text-slate-700">
            {evidencePackage
              ? 'Die Dokumentation oder Einsatzdaten wurden nach der letzten Version geändert. Die frühere Bestätigung bleibt erhalten und deckt diese Version nicht ab.'
              : 'Der Einsatz ist abgeschlossen und die Dokumentation finalisiert. Erstellen Sie daraus den unveränderlichen Nachweis zur Prüfung.'}
          </p>
          {evidencePackage ? <EvidenceSnapshot packageData={evidencePackage} /> : null}
          <form action={prepareEvidencePackageAction}>
            <input type="hidden" name="visitId" value={visitId} />
            <Button type="submit" className="min-h-12 w-full sm:w-fit">
              {evidencePackage
                ? 'Aktuellen Leistungsnachweis erstellen'
                : 'Leistungsnachweis erstellen'}
            </Button>
          </form>
        </section>
      ) : null}

      {evidencePackage && evidencePackage.status !== 'outdated' ? (
        <>
          <EvidenceSnapshot packageData={evidencePackage} />
          {evidencePackage.status === 'acknowledged' ? (
            <p
              role="status"
              className="rounded-lg border border-green-300 bg-green-50 p-4 text-green-900"
            >
              Leistungsnachweis bestätigt
              {evidencePackage.acknowledgements.at(-1)?.acknowledgedAt
                ? ` am ${formatVisitDateTime(evidencePackage.acknowledgements.at(-1)!.acknowledgedAt!, evidencePackage.snapshot.timezone)}`
                : ''}
              .
            </p>
          ) : null}
          {evidencePackage.status === 'declined' ? (
            <p
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
            >
              Die Ablehnung wurde für diese Version festgehalten. Eine spätere Änderung der
              Dokumentation erzeugt einen neuen Leistungsnachweis.
            </p>
          ) : null}
          {evidencePackage.status === 'revoked' ? (
            <p
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
            >
              Die frühere Bestätigung wurde widerrufen. Diese Version kann erneut geprüft und
              bestätigt werden.
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

      {finalized && !evidencePackage && packageResult?.error && !packageMissing ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Leistungsnachweis konnte nicht geladen werden ({packageResult.error.code}).
        </p>
      ) : null}
    </div>
  );
}

function EvidenceSnapshot({ packageData }: { packageData: EvidencePackage }) {
  const snapshot = packageData.snapshot;
  return (
    <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Angezeigte Leistungen</h2>
          <p className="mt-1 text-sm text-slate-600">
            {formatVisitDateTime(snapshot.plannedStart, snapshot.timezone)}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
          Version {packageData.version}
        </span>
      </header>
      <dl className="grid gap-3 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-600">Klientin oder Klient</dt>
          <dd className="font-medium">{snapshot.clientName}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Tatsächliche Einsatzzeit</dt>
          <dd className="font-medium">
            {formatVisitDateTime(snapshot.actualStart, snapshot.timezone)}–
            {formatVisitDateTime(snapshot.actualEnd, snapshot.timezone)}
          </dd>
        </div>
      </dl>
      {snapshot.items.length ? (
        <ul className="grid gap-2">
          {snapshot.items.map((item) => (
            <li key={item.performedServiceId} className="grid gap-1 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-semibold">{item.serviceName}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-sm">
                  {outcomeLabel(item.outcome)}
                </span>
              </div>
              <p className="text-sm text-slate-700">
                Tatsächlich: {item.actualQuantity ?? '–'} {unitLabel(item.unit)}
                {item.plannedQuantity !== null
                  ? ` · Geplant: ${item.plannedQuantity} ${unitLabel(item.unit)}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border p-3 text-slate-700">
          Für diesen Einsatz sind keine Leistungen erfasst.
        </p>
      )}
      <p className="min-w-0 text-xs text-slate-500">
        Prüfsumme: <code className="break-all font-mono">{packageData.snapshotHash}</code>
      </p>
    </section>
  );
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

function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    performed: 'Erbracht',
    partially_performed: 'Teilweise erbracht',
    not_performed: 'Nicht erbracht',
  };
  return labels[outcome] ?? outcome;
}

function noticeLabel(notice: string): string {
  const labels: Record<string, string> = {
    'package-prepared': 'Leistungsnachweis wurde erstellt.',
    acknowledged: 'Bestätigung wurde gespeichert.',
    declined: 'Ablehnung wurde festgehalten.',
  };
  return labels[notice] ?? notice;
}
