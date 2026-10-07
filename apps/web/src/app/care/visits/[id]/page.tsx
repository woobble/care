import Link from 'next/link';
import { notFound } from 'next/navigation';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@care/api-client';
import { Button, Input, Label } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { formatVisitDateTime, formatVisitTime } from '../../../../lib/care-date';
import {
  completeVisitAction,
  recordPerformedServiceAction,
  startVisitAction,
  updateExecutionNoteAction,
} from '../../actions';

type SearchParams = Promise<{ error?: string; notice?: string }>;

export default async function CareVisitPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const { data, error } = await get('/api/v1/visits/{visitId}/execution', {
    params: { path: { visitId: id }, header },
  });
  if (error?.code === 'VISIT_EXECUTION_NOT_FOUND') notFound();
  if (!data) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        Einsatz konnte nicht geladen werden. {error?.code}
      </p>
    );
  }

  const { visit, execution, services } = data;
  const availableResult =
    execution.status === 'in_progress'
      ? await get('/api/v1/visits/{visitId}/execution/available-services', {
          params: { path: { visitId: id }, header },
        })
      : null;
  const availableServices = availableResult?.data ?? [];
  const unresolved = services.some((service) => service.status === 'not_recorded');
  const startAllowed = execution.status === 'not_started' && visit.status !== 'cancelled';
  const isCompleted = execution.status === 'completed';

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <header className="grid gap-3">
        <Link className="w-fit text-sm font-semibold text-blue-800 underline" href="/care/today">
          Zurück zu Heute
        </Link>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Einsatz</p>
          <h1 className="mt-1 text-3xl font-semibold">{visit.clientDisplayName}</h1>
        </div>
        <p className="text-slate-700">
          {formatVisitDateTime(visit.plannedStart, visit.timezone)}–
          {formatVisitTime(visit.plannedEnd, visit.timezone)}
        </p>
        {visit.address ? <p className="text-slate-700">{visit.address}</p> : null}
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Änderung fehlgeschlagen ({query.error}).
          {query.error === 'VISIT_EXECUTION_VERSION_CONFLICT'
            ? ' Bitte laden Sie den Einsatz neu und versuchen Sie es erneut.'
            : ''}
        </p>
      ) : null}
      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {noticeText(query.notice)}
        </p>
      ) : null}

      <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Ausführung</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
            {executionStatus(execution.status)}
          </span>
        </div>
        {execution.actualStart ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Time label="Ankunft" value={execution.actualStart} timezone={visit.timezone} />
            {execution.actualEnd ? (
              <Time label="Abfahrt" value={execution.actualEnd} timezone={visit.timezone} />
            ) : null}
          </dl>
        ) : (
          <p className="text-slate-600">Ankunftszeit wird beim Start serverseitig erfasst.</p>
        )}
        {startAllowed ? (
          <form action={startVisitAction}>
            <input type="hidden" name="visitId" value={visit.id} />
            <Button type="submit" className="min-h-12 w-full text-base sm:w-fit">
              Einsatz starten
            </Button>
          </form>
        ) : null}
        {visit.status === 'cancelled' ? (
          <p className="rounded-md bg-slate-100 p-3 text-slate-700">
            Dieser Einsatz wurde abgesagt.
          </p>
        ) : null}
        {execution.startedByEmployeeName ? (
          <p className="text-sm text-slate-600">Gestartet von {execution.startedByEmployeeName}</p>
        ) : null}
        {execution.completedByEmployeeName ? (
          <p className="text-sm text-slate-600">
            Abgeschlossen von {execution.completedByEmployeeName}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">Geplante Leistungen</h2>
        {services.filter((service) => !service.unplanned).length ? (
          <ul className="grid gap-4">
            {services
              .filter((service) => !service.unplanned)
              .map((service) => (
                <li key={service.visitServiceId}>
                  <ServiceCard
                    visitId={visit.id}
                    version={execution.version}
                    service={service}
                    performedServiceId={service.id ?? uuidv7()}
                    editable={execution.status === 'in_progress'}
                  />
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-slate-600">Für diesen Einsatz sind keine Leistungen geplant.</p>
        )}
        {services.some((service) => service.unplanned) ? (
          <div className="grid gap-3 border-t pt-4">
            <h3 className="font-semibold">Zusätzlich erfasste Leistungen</h3>
            {services
              .filter((service) => service.unplanned)
              .map((service) => (
                <ServiceCard
                  key={service.id}
                  visitId={visit.id}
                  version={execution.version}
                  service={service}
                  performedServiceId={service.id ?? uuidv7()}
                  editable={execution.status === 'in_progress'}
                />
              ))}
          </div>
        ) : null}
      </section>

      {execution.status === 'in_progress' ? (
        <>
          <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
            <h2 className="text-xl font-semibold">Ungeplante Leistung</h2>
            {availableServices.length ? (
              <form action={recordPerformedServiceAction} className="grid gap-4">
                <input type="hidden" name="visitId" value={visit.id} />
                <input type="hidden" name="performedServiceId" value={uuidv7()} />
                <input type="hidden" name="expectedVersion" value={execution.version} />
                <div className="grid gap-2">
                  <Label htmlFor="serviceDefinitionId">Leistung</Label>
                  <select
                    id="serviceDefinitionId"
                    name="serviceDefinitionId"
                    required
                    className="min-h-12 rounded-md border bg-white px-3"
                  >
                    <option value="">Bitte auswählen</option>
                    {availableServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.code} · {service.name} ({unitLabel(service.unit)})
                      </option>
                    ))}
                  </select>
                </div>
                <DecisionFields
                  status="performed"
                  actualQuantity="1"
                  reasonCode={null}
                  note={null}
                  unit="Einheit"
                  prefix="unplanned"
                />
                <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
                  Leistung erfassen
                </Button>
              </form>
            ) : (
              <p className="text-slate-600">
                Keine weiteren Leistungen sind für diesen Anbieter verfügbar.
              </p>
            )}
          </section>

          <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
            <h2 className="text-xl font-semibold">Kurzer Einsatzhinweis</h2>
            <form action={updateExecutionNoteAction} className="grid gap-3">
              <input type="hidden" name="visitId" value={visit.id} />
              <input type="hidden" name="expectedVersion" value={execution.version} />
              <Label htmlFor="operational-note">Hinweis für den nächsten Einsatz</Label>
              <textarea
                id="operational-note"
                name="note"
                defaultValue={execution.operationalNote ?? ''}
                maxLength={1000}
                className="min-h-24 rounded-md border px-3 py-2"
              />
              <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
                Hinweis speichern
              </Button>
            </form>
          </section>

          <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
            <h2 className="text-xl font-semibold">Einsatz abschließen</h2>
            {unresolved ? (
              <p className="text-slate-600">
                Erfassen Sie zuerst ein Ergebnis für jede geplante Leistung.
              </p>
            ) : null}
            <form action={completeVisitAction}>
              <input type="hidden" name="visitId" value={visit.id} />
              <input type="hidden" name="expectedVersion" value={execution.version} />
              <Button
                type="submit"
                disabled={unresolved}
                className="min-h-12 w-full text-base sm:w-fit"
              >
                Einsatz abschließen
              </Button>
            </form>
          </section>
        </>
      ) : null}

      {isCompleted && execution.operationalNote ? (
        <section className="grid gap-2 rounded-lg border bg-white p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Einsatzhinweis</h2>
          <p className="whitespace-pre-wrap text-slate-700">{execution.operationalNote}</p>
        </section>
      ) : null}
    </div>
  );
}

function ServiceCard({
  visitId,
  version,
  service,
  performedServiceId,
  editable,
}: {
  visitId: string;
  version: number;
  service: components['schemas']['PerformedServiceResponseDto'];
  performedServiceId: string;
  editable: boolean;
}) {
  return (
    <section className="grid gap-3 rounded-md border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{service.serviceName}</h3>
          <p className="text-sm text-slate-600">
            {service.serviceCode} · Geplant: {service.plannedQuantity ?? '–'}{' '}
            {unitLabel(service.unit)}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
          {serviceStatus(service.status)}
        </span>
      </div>
      {service.status !== 'not_recorded' ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">Tatsächlich</dt>
            <dd className="font-medium">
              {service.actualQuantity ?? '–'} {unitLabel(service.unit)}
            </dd>
          </div>
          {service.reasonCode ? (
            <div>
              <dt className="text-slate-600">Grund</dt>
              <dd className="font-medium">{reasonLabel(service.reasonCode)}</dd>
            </div>
          ) : null}
          {service.note ? (
            <div className="sm:col-span-2">
              <dt className="text-slate-600">Hinweis</dt>
              <dd className="whitespace-pre-wrap">{service.note}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {editable ? (
        <form action={recordPerformedServiceAction} className="grid gap-4 border-t pt-3">
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="performedServiceId" value={performedServiceId} />
          <input type="hidden" name="expectedVersion" value={version} />
          {service.visitServiceId ? (
            <input type="hidden" name="visitServiceId" value={service.visitServiceId} />
          ) : null}
          <DecisionFields
            status={service.status === 'not_recorded' ? 'performed' : service.status}
            actualQuantity={service.actualQuantity ?? service.plannedQuantity ?? '1'}
            reasonCode={service.reasonCode ?? null}
            note={service.note ?? null}
            unit={service.unit}
            prefix={service.visitServiceId ?? performedServiceId}
          />
          <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
            Ergebnis speichern
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function DecisionFields({
  status,
  actualQuantity,
  reasonCode,
  note,
  unit,
  prefix,
}: {
  status: 'performed' | 'partially_performed' | 'not_performed';
  actualQuantity: string;
  reasonCode: string | null;
  note: string | null;
  unit: string;
  prefix: string;
}) {
  const quantityId = 'quantity-' + prefix;
  const reasonId = 'reason-' + prefix;
  const noteId = 'service-note-' + prefix;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={'status-' + prefix}>Ergebnis</Label>
          <select
            id={'status-' + prefix}
            name="status"
            defaultValue={status}
            className="min-h-12 rounded-md border bg-white px-3"
          >
            <option value="performed">Erbracht</option>
            <option value="partially_performed">Teilweise erbracht</option>
            <option value="not_performed">Nicht erbracht</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={quantityId}>Tatsächliche Menge ({unitLabel(unit)})</Label>
          <Input
            id={quantityId}
            name="actualQuantity"
            type="number"
            min="0"
            step="0.001"
            inputMode="decimal"
            defaultValue={actualQuantity}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={reasonId}>Grund (erforderlich, wenn nicht erbracht)</Label>
        <select
          id={reasonId}
          name="reasonCode"
          defaultValue={reasonCode ?? ''}
          className="min-h-12 rounded-md border bg-white px-3"
        >
          <option value="">Kein Grund</option>
          <option value="client_declined">Klient lehnte ab</option>
          <option value="client_not_present">Klient nicht angetroffen</option>
          <option value="service_not_required">Leistung nicht erforderlich</option>
          <option value="time_constraint">Zeitliche Einschränkung</option>
          <option value="provider_decision">Entscheidung des Dienstes</option>
          <option value="other">Sonstiger Grund</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={noteId}>Kurzer Hinweis</Label>
        <textarea
          id={noteId}
          name="note"
          defaultValue={note ?? ''}
          maxLength={1000}
          className="min-h-20 rounded-md border px-3 py-2"
        />
      </div>
    </>
  );
}

function Time({ label, value, timezone }: { label: string; value: string; timezone: string }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium">{formatVisitDateTime(value, timezone)}</dd>
    </div>
  );
}

function unitLabel(unit: string): string {
  const labels: Record<string, string> = {
    occurrence: 'Vorkommen',
    minute: 'Minuten',
    hour: 'Stunden',
    day: 'Tage',
  };
  return labels[unit] ?? unit;
}

function serviceStatus(status: string): string {
  const labels: Record<string, string> = {
    not_recorded: 'Noch nicht erfasst',
    performed: 'Erbracht',
    partially_performed: 'Teilweise erbracht',
    not_performed: 'Nicht erbracht',
  };
  return labels[status] ?? status;
}

function executionStatus(status: string): string {
  const labels: Record<string, string> = {
    not_started: 'Nicht gestartet',
    in_progress: 'In Bearbeitung',
    completed: 'Abgeschlossen',
  };
  return labels[status] ?? status;
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    client_declined: 'Klient lehnte ab',
    client_not_present: 'Klient nicht angetroffen',
    service_not_required: 'Leistung nicht erforderlich',
    time_constraint: 'Zeitliche Einschränkung',
    provider_decision: 'Entscheidung des Dienstes',
    other: 'Sonstiger Grund',
  };
  return labels[reason] ?? reason;
}

function noticeText(notice: string): string {
  const labels: Record<string, string> = {
    started: 'Einsatz gestartet.',
    'service-saved': 'Leistungsergebnis gespeichert.',
    'note-saved': 'Hinweis gespeichert.',
    completed: 'Einsatz abgeschlossen.',
  };
  return labels[notice] ?? notice;
}
