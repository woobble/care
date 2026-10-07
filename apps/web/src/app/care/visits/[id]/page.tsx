import Link from 'next/link';
import { notFound } from 'next/navigation';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@care/api-client';
import { Button, Input, Label } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { formatVisitDateTime, formatVisitTime } from '../../../../lib/care-date';
import {
  addDocumentationEntryAction,
  completeVisitAction,
  createDocumentationAction,
  finalizeDocumentationAction,
  recordPerformedServiceAction,
  recordServiceEvidenceAction,
  startVisitAction,
  updateDocumentationEntryAction,
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
  const documentationResult = await get('/api/v1/visits/{visitId}/documentation', {
    params: { path: { visitId: id }, header },
  });
  const availableResult =
    execution.status === 'in_progress'
      ? await get('/api/v1/visits/{visitId}/execution/available-services', {
          params: { path: { visitId: id }, header },
        })
      : null;
  const availableServices = availableResult?.data ?? [];
  const unresolved = services.some((service) => service.status === 'not_recorded');
  const startAllowed = execution.status === 'not_started' && visit.status !== 'cancelled';

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

      <DocumentationSection
        detail={documentationResult.data}
        {...(documentationResult.error?.code ? { errorCode: documentationResult.error.code } : {})}
        visitId={visit.id}
        executionStatus={execution.status}
      />
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
  unit,
  prefix,
}: {
  status: 'performed' | 'partially_performed' | 'not_performed';
  actualQuantity: string;
  reasonCode: string | null;
  unit: string;
  prefix: string;
}) {
  const quantityId = 'quantity-' + prefix;
  const reasonId = 'reason-' + prefix;
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
    </>
  );
}

function DocumentationSection({
  detail,
  errorCode,
  visitId,
  executionStatus: visitExecutionStatus,
}: {
  detail: components['schemas']['CareDocumentationDetailDto'] | undefined;
  errorCode?: string;
  visitId: string;
  executionStatus: 'not_started' | 'in_progress' | 'completed';
}) {
  if (errorCode || !detail) {
    return (
      <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">Dokumentation</h2>
        <p role="alert" className="text-red-800">
          Dokumentation konnte nicht geladen werden{errorCode ? ` (${errorCode})` : ''}.
        </p>
      </section>
    );
  }

  const document = detail.documentation;
  const editable = document?.status === 'draft';
  const finalized = document?.status === 'finalized';
  const serviceNames = new Map(
    detail.services.map((service) => [service.performedServiceId, service.serviceName]),
  );

  return (
    <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Dokumentation</h2>
          <p className="mt-1 text-sm text-slate-600">
            {finalized
              ? `Finalisiert${document.finalizedAt ? ` am ${formatVisitDateTime(document.finalizedAt, detail.visit.timezone)}` : ''}`
              : editable
                ? `Entwurf · erstellt von ${document.createdByEmployeeName ?? 'Mitarbeiter'}`
                : 'Noch nicht angelegt'}
          </p>
        </div>
        {finalized ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-900">
            Finalisiert
          </span>
        ) : null}
      </header>

      {!document ? (
        visitExecutionStatus === 'not_started' ? (
          <p className="rounded-md bg-slate-50 p-3 text-slate-700">
            Nach dem Start des Einsatzes können Sie die Dokumentation während oder nach der
            Ausführung beginnen.
          </p>
        ) : (
          <form action={createDocumentationAction}>
            <input type="hidden" name="visitId" value={visitId} />
            <Button type="submit" className="min-h-12 w-full sm:w-fit">
              Dokumentation beginnen
            </Button>
          </form>
        )
      ) : (
        <>
          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-lg font-semibold">Leistungsdokumentation</h3>
            {detail.services.length ? (
              <ul className="grid gap-3">
                {detail.services.map((service) => (
                  <li key={service.performedServiceId} className="grid gap-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-medium">{service.serviceName}</h4>
                        <p className="text-sm text-slate-600">
                          {serviceStatus(service.status)} · {service.actualQuantity ?? '–'}{' '}
                          {unitLabel(service.unit)}
                        </p>
                      </div>
                      <span
                        className={
                          service.evidence
                            ? 'text-sm text-green-800'
                            : 'text-sm font-medium text-amber-900'
                        }
                      >
                        {service.evidence ? 'Nachweis erfasst' : 'Nachweis fehlt'}
                      </span>
                    </div>
                    {service.evidence?.note ? (
                      <p className="whitespace-pre-wrap text-sm">{service.evidence.note}</p>
                    ) : null}
                    {service.evidence?.documentedByEmployeeName ? (
                      <p className="text-xs text-slate-500">
                        Dokumentiert von {service.evidence.documentedByEmployeeName}
                      </p>
                    ) : null}
                    {editable ? (
                      <form
                        action={recordServiceEvidenceAction}
                        className="grid gap-2 border-t pt-3"
                      >
                        <input type="hidden" name="visitId" value={visitId} />
                        <input type="hidden" name="documentationId" value={document.id} />
                        <input
                          type="hidden"
                          name="performedServiceId"
                          value={service.performedServiceId}
                        />
                        <input type="hidden" name="expectedVersion" value={document.version} />
                        <Label htmlFor={`evidence-${service.performedServiceId}`}>
                          Leistungsnachweis
                        </Label>
                        <textarea
                          id={`evidence-${service.performedServiceId}`}
                          name="note"
                          defaultValue={service.evidence?.note ?? ''}
                          maxLength={1000}
                          className="min-h-20 rounded-md border px-3 py-2"
                          placeholder="Kurzer Nachweis oder eine Erläuterung"
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          className="min-h-11 w-full sm:w-fit"
                        >
                          Nachweis speichern
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-600">
                Für diesen Einsatz wurden noch keine Leistungen erfasst.
              </p>
            )}
          </section>

          {(['care_note', 'observation', 'deviation', 'incident'] as const).map((type) => {
            const entries = detail.entries.filter((entry) => entry.type === type);
            const title = entryTypeLabel(type);
            return (
              <section key={type} className="grid gap-3 border-t pt-4">
                <h3 className="text-lg font-semibold">{title}</h3>
                {entries.length ? (
                  <ul className="grid gap-3">
                    {entries.map((entry) => (
                      <li key={entry.id} className="rounded-md border p-3">
                        <p className="whitespace-pre-wrap">{entry.content}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {entry.authorEmployeeName ?? 'Mitarbeiter'} ·{' '}
                          {formatVisitDateTime(entry.createdAt, detail.visit.timezone)}
                          {entry.severity ? ` · ${severityLabel(entry.severity)}` : ''}
                        </p>
                        {editable ? (
                          <form
                            action={updateDocumentationEntryAction}
                            className="mt-3 grid gap-2 border-t pt-3"
                          >
                            <input type="hidden" name="visitId" value={visitId} />
                            <input type="hidden" name="documentationId" value={document.id} />
                            <input type="hidden" name="entryId" value={entry.id} />
                            <input type="hidden" name="expectedVersion" value={document.version} />
                            <Label htmlFor={`entry-${entry.id}`}>Eintrag bearbeiten</Label>
                            <textarea
                              id={`entry-${entry.id}`}
                              name="content"
                              defaultValue={entry.content}
                              required
                              maxLength={4000}
                              className="min-h-20 rounded-md border px-3 py-2"
                            />
                            <Button
                              type="submit"
                              variant="secondary"
                              className="min-h-11 w-full sm:w-fit"
                            >
                              Änderung speichern
                            </Button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">Noch keine Einträge.</p>
                )}
                {editable ? (
                  <EntryComposer
                    visitId={visitId}
                    documentationId={document.id}
                    version={document.version}
                    type={type}
                  />
                ) : null}
              </section>
            );
          })}

          {editable ? (
            <section className="grid gap-3 border-t pt-4">
              <h3 className="text-lg font-semibold">Dokumentation finalisieren</h3>
              {detail.completeness.isComplete ? (
                visitExecutionStatus === 'completed' ? (
                  <form action={finalizeDocumentationAction}>
                    <input type="hidden" name="visitId" value={visitId} />
                    <input type="hidden" name="documentationId" value={document.id} />
                    <input type="hidden" name="expectedVersion" value={document.version} />
                    <Button type="submit" className="min-h-12 w-full sm:w-fit">
                      Dokumentation finalisieren
                    </Button>
                  </form>
                ) : (
                  <p className="text-slate-600">
                    Finalisieren ist nach Abschluss der Ausführung möglich.
                  </p>
                )
              ) : (
                <ul className="grid gap-2 text-sm text-amber-950">
                  {detail.completeness.missing.map((missing, index) => (
                    <li key={`${missing.code}-${missing.performedServiceId ?? index}`}>
                      {missing.performedServiceId
                        ? `${serviceNames.get(missing.performedServiceId) ?? 'Leistung'}: `
                        : ''}
                      {missingRequirementLabel(missing.code)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {finalized && detail.amendments.length ? (
            <section className="grid gap-3 border-t pt-4">
              <h3 className="text-lg font-semibold">Ergänzungen</h3>
              {detail.amendments.map((amendment) => (
                <article key={amendment.id} className="rounded-md bg-slate-50 p-3">
                  <p className="text-sm font-semibold">{amendment.reason}</p>
                  <p className="mt-1 whitespace-pre-wrap">{amendment.correction}</p>
                </article>
              ))}
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function EntryComposer({
  visitId,
  documentationId,
  version,
  type,
}: {
  visitId: string;
  documentationId: string;
  version: number;
  type: 'care_note' | 'observation' | 'deviation' | 'incident';
}) {
  return (
    <form action={addDocumentationEntryAction} className="grid gap-3 rounded-md bg-slate-50 p-3">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="documentationId" value={documentationId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="type" value={type} />
      <Label htmlFor={`new-${type}`}>Neuer Eintrag</Label>
      <textarea
        id={`new-${type}`}
        name="content"
        required
        maxLength={4000}
        className="min-h-20 rounded-md border bg-white px-3 py-2"
      />
      {type === 'incident' ? (
        <div className="grid gap-2">
          <Label htmlFor="incident-severity">Schweregrad</Label>
          <select
            id="incident-severity"
            name="severity"
            required
            className="min-h-11 rounded-md border bg-white px-3"
          >
            <option value="">Bitte auswählen</option>
            <option value="low">Niedrig</option>
            <option value="moderate">Mittel</option>
            <option value="high">Hoch</option>
            <option value="critical">Kritisch</option>
          </select>
        </div>
      ) : null}
      <Button type="submit" variant="secondary" className="min-h-11 w-full sm:w-fit">
        Eintrag speichern
      </Button>
    </form>
  );
}

function entryTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    care_note: 'Verlaufsnotizen',
    observation: 'Beobachtungen',
    deviation: 'Abweichungen',
    incident: 'Vorfälle',
  };
  return labels[type] ?? type;
}

function severityLabel(value: string): string {
  const labels: Record<string, string> = {
    low: 'niedrig',
    moderate: 'mittel',
    high: 'hoch',
    critical: 'kritisch',
  };
  return labels[value] ?? value;
}

function missingRequirementLabel(code: string): string {
  const labels: Record<string, string> = {
    DOCUMENTATION_REQUIRED: 'Dokumentation fehlt.',
    VISIT_EXECUTION_REQUIRED: 'Ausführung fehlt.',
    SERVICE_EVIDENCE_REQUIRED: 'Leistungsnachweis fehlt.',
    NOT_PERFORMED_REASON_REQUIRED: 'Grund für die nicht erbrachte Leistung fehlt.',
    PARTIAL_SERVICE_EXPLANATION_REQUIRED: 'Erklärung für die teilweise erbrachte Leistung fehlt.',
  };
  return labels[code] ?? code;
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
