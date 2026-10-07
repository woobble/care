import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../../lib/api';
import { ConfirmSubmitButton } from '../../administration/confirm-submit-button';
import {
  assignVisitAction,
  changeVisitStatusAction,
  unassignVisitAction,
  updateVisitAction,
} from '../../planning/actions';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  employeeId?: string;
  conflictStart?: string;
  conflictEnd?: string;
  conflictTimezone?: string;
}>;

export default async function VisitDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const visitResult = await get('/api/v1/visits/{id}', { params: { path: { id }, header } });
  if (visitResult.error?.code === 'VISIT_NOT_FOUND') notFound();
  const visit = visitResult.data;
  if (!visit) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        Einsatz konnte nicht geladen werden.
      </p>
    );
  }
  const employeesResult = await get('/api/v1/employees', {
    params: {
      query: {
        status: 'active',
        organizationId: visit.organizationId,
        facilityId: visit.facilityId,
        page: 1,
        pageSize: 100,
      },
      header,
    },
  });
  const permissions = await getPermissionGrants(api);
  const canUpdate = hasPermission(permissions, 'schedule.update') && visit.status !== 'cancelled';
  const canAssign = hasPermission(permissions, 'schedule.assign') && visit.status !== 'cancelled';
  const canConfirm = hasPermission(permissions, 'schedule.confirm') && visit.status !== 'cancelled';
  const canCancel = hasPermission(permissions, 'schedule.cancel') && visit.status !== 'cancelled';
  const employees = employeesResult.data?.items ?? [];
  const conflictEmployee = employees.find((employee) => employee.id === query.employeeId);
  const conflictInterval = readConflictInterval(
    query.conflictStart,
    query.conflictEnd,
    query.conflictTimezone,
  );
  const localStart = localDateTime(visit.plannedStart, visit.timezone);
  const localEnd = localDateTime(visit.plannedEnd, visit.timezone);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/planning">Einsatzplanung</Link>
          </p>
          <h1 className="text-3xl font-semibold">{visit.clientDisplayName}</h1>
          <p className="text-slate-600">
            {visit.facilityName} · {visit.organizationName}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/planning">Zurück zur Planung</Link>
        </Button>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {query.error === 'VISIT_EMPLOYEE_CONFLICT' && conflictInterval
            ? `${conflictEmployee ? `${conflictEmployee.preferredName || conflictEmployee.firstName} ${conflictEmployee.lastName}` : 'Die ausgewählte Person'} ist bereits für einen Einsatz von ${formatDateTime(conflictInterval.start, conflictInterval.timezone)} bis ${formatTime(conflictInterval.end, conflictInterval.timezone)} eingeplant.`
            : `Änderung fehlgeschlagen (${query.error}).`}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          Einsatz wurde aktualisiert.
        </p>
      ) : null}

      <section aria-labelledby="visit-title" className="grid gap-4 rounded-lg border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="visit-title" className="text-xl font-semibold">
            Besuch
          </h2>
          <Status status={visit.status} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail
            label="Zeit"
            value={`${formatDateTime(visit.plannedStart, visit.timezone)}–${formatTime(visit.plannedEnd, visit.timezone)}`}
          />
          <Detail label="Zeitzone" value={visit.timezone} />
          <Detail
            label="Herkunft"
            value={
              visit.origin === 'agreement_generated'
                ? 'Aus Leistungsplanung erzeugt'
                : 'Manuell geplant'
            }
          />
          <Detail label="Manuell angepasst" value={visit.manuallyAdjusted ? 'Ja' : 'Nein'} />
          {visit.serviceAgreementId ? (
            <Detail
              label="Leistungsplanung"
              value={
                <Link
                  className="text-blue-800 underline"
                  href={`/clients/${visit.clientId}/service-agreements#agreement-${visit.serviceAgreementId}`}
                >
                  Vereinbarung öffnen
                </Link>
              }
            />
          ) : null}
        </dl>
        <div>
          <h3 className="font-semibold">Geplante Leistungen</h3>
          <ul className="mt-2 grid gap-2">
            {visit.services.map((service) => (
              <li key={service.id} className="rounded-md bg-slate-50 p-3">
                {service.serviceCode} · {service.serviceName} · {service.plannedQuantity}{' '}
                {unitLabel(service.unit)}
                {service.plannedDurationMinutes ? ` · ${service.plannedDurationMinutes} Min.` : ''}
              </li>
            ))}
          </ul>
        </div>
        {visit.note ? (
          <div>
            <h3 className="font-semibold">Hinweis für die Einsatzplanung</h3>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{visit.note}</p>
          </div>
        ) : null}
      </section>

      {canUpdate ? (
        <section
          aria-labelledby="reschedule-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <h2 id="reschedule-title" className="text-xl font-semibold">
            Zeit ändern
          </h2>
          <form action={updateVisitAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="visitId" value={visit.id} />
            <Field
              label="Datum"
              name="localDate"
              type="date"
              defaultValue={localStart.date}
              required
            />
            <Field
              label="Beginn"
              name="localStartTime"
              type="time"
              defaultValue={localStart.time}
              required
            />
            <Field
              label="Ende"
              name="localEndTime"
              type="time"
              defaultValue={localEnd.time}
              required
            />
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="visit-note">Hinweis für die Einsatzplanung</Label>
              <textarea
                id="visit-note"
                name="note"
                defaultValue={visit.note ?? ''}
                maxLength={2000}
                className="min-h-20 rounded-md border px-3 py-2"
              />
            </div>
            <Button type="submit" className="w-fit">
              Speichern
            </Button>
          </form>
        </section>
      ) : null}

      <section
        aria-labelledby="assignments-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="assignments-title" className="text-xl font-semibold">
          Mitarbeitende
        </h2>
        {visit.assignments.length ? (
          <ul className="grid gap-2">
            {visit.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  {assignment.employeeDisplayName}
                  {assignment.role ? ` · ${assignment.role}` : ''}
                </span>
                {canAssign ? (
                  <form action={unassignVisitAction}>
                    <input type="hidden" name="visitId" value={visit.id} />
                    <input type="hidden" name="assignmentId" value={assignment.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Zuweisung aufheben
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Noch niemand zugewiesen.</p>
        )}
        {canAssign ? (
          employees.length ? (
            <form action={assignVisitAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="visitId" value={visit.id} />
              <div className="grid gap-2">
                <Label htmlFor="employeeId">Mitarbeitende zuweisen</Label>
                <select
                  id="employeeId"
                  name="employeeId"
                  required
                  className="h-10 rounded-md border bg-white px-3"
                >
                  <option value="">Bitte auswählen</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.preferredName || employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Zuweisen</Button>
            </form>
          ) : (
            <p className="text-sm text-slate-600">
              Für diese Einrichtung sind keine aktiven Mitarbeitenden verfügbar.
            </p>
          )
        ) : null}
      </section>

      {canConfirm || canCancel ? (
        <section aria-label="Statusaktionen" className="flex flex-wrap gap-2">
          {canConfirm && visit.status === 'planned' ? (
            <StatusAction visitId={visit.id} operation="confirm" label="Bestätigen" />
          ) : null}
          {canConfirm && visit.status === 'confirmed' ? (
            <StatusAction
              visitId={visit.id}
              operation="unconfirm"
              label="Bestätigung zurücknehmen"
            />
          ) : null}
          {canCancel ? (
            <form action={changeVisitStatusAction}>
              <input type="hidden" name="visitId" value={visit.id} />
              <input type="hidden" name="operation" value="cancel" />
              <ConfirmSubmitButton confirmation="Dieser Einsatz wird abgesagt und bleibt in der Historie erhalten.">
                Einsatz absagen
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby="history-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="history-title" className="text-xl font-semibold">
          Verlauf
        </h2>
        {visit.history.length ? (
          <ol className="grid gap-2">
            {visit.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                <span>{historyLabel(entry.action)}</span>
                <time dateTime={entry.timestamp}>
                  {formatDateTime(entry.timestamp, visit.timezone)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-slate-600">Noch keine Änderungen.</p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Status({ status }: { status: 'planned' | 'confirmed' | 'cancelled' }) {
  const label =
    status === 'planned' ? 'Geplant' : status === 'confirmed' ? 'Bestätigt' : 'Abgesagt';
  return <span className="rounded-full border px-3 py-1 text-sm">{label}</span>;
}

function StatusAction({
  visitId,
  operation,
  label,
}: {
  visitId: string;
  operation: 'confirm' | 'unconfirm';
  label: string;
}) {
  return (
    <form action={changeVisitStatusAction}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="operation" value={operation} />
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

function localDateTime(value: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((entry) => entry.type === key)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(value),
  );
}

function readConflictInterval(
  start: string | undefined,
  end: string | undefined,
  timeZone: string | undefined,
): { start: string; end: string; timezone: string } | null {
  if (!start || !end || !timeZone) return null;
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone }).format(new Date(startTime));
    return { start, end, timezone: timeZone };
  } catch {
    return null;
  }
}

function unitLabel(unit: string): string {
  return (
    (
      { occurrence: 'Einsatz', minute: 'Minuten', hour: 'Stunden', day: 'Tage' } as Record<
        string,
        string
      >
    )[unit] ?? unit
  );
}

function historyLabel(action: string): string {
  return (
    (
      {
        'visit.created': 'Einsatz geplant',
        'visit.generated': 'Einsatz aus Leistungsplanung erzeugt',
        'visit.updated': 'Einsatzdetails geändert',
        'visit.rescheduled': 'Einsatz umgeplant',
        'visit.confirmed': 'Einsatz bestätigt',
        'visit.unconfirmed': 'Bestätigung zurückgenommen',
        'visit.cancelled': 'Einsatz abgesagt',
        'visit.employee_assigned': 'Mitarbeitende zugewiesen',
        'visit.employee_unassigned': 'Zuweisung aufgehoben',
      } as Record<string, string>
    )[action] ?? 'Einsatz geändert'
  );
}
