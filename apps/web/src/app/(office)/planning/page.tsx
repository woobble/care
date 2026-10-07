import Link from 'next/link';
import { Button, Input, Label } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../lib/api';
import { createVisitAction } from './actions';

type SearchParams = Promise<{
  date?: string;
  view?: string;
  page?: string;
  clientId?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  status?: string;
  assigned?: string;
  serviceDefinitionId?: string;
  error?: string;
  updated?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusValues = ['planned', 'confirmed', 'cancelled'] as const;

export default async function PlanningPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const view = query.view === 'day' ? 'day' : 'week';
  const selectedDate = validDate(query.date) ?? todayInBerlin();
  const page = positivePage(query.page);
  const clientId = validUuid(query.clientId);
  const employeeId = validUuid(query.employeeId);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const teamId = validUuid(query.teamId);
  const serviceDefinitionId = validUuid(query.serviceDefinitionId);
  const status = statusValues.find((value) => value === query.status);
  const assigned =
    query.assigned === 'assigned' || query.assigned === 'unassigned' ? query.assigned : 'all';
  const period = view === 'day' ? dayPeriod(selectedDate) : weekPeriod(selectedDate);
  const requestRange = apiRange(period.start, period.endExclusive);

  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [
    visitResult,
    clientResult,
    employeeResult,
    organizationResult,
    facilityResult,
    teamResult,
    serviceResult,
  ] = await Promise.all([
    get('/api/v1/visits', {
      params: {
        query: {
          from: requestRange.from,
          until: requestRange.until,
          page,
          pageSize: 100,
          sortBy: 'plannedStart',
          sortOrder: 'asc',
          ...(clientId ? { clientId } : {}),
          ...(employeeId ? { employeeId } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(teamId ? { teamId } : {}),
          ...(serviceDefinitionId ? { serviceDefinitionId } : {}),
          ...(status ? { status } : {}),
          ...(assigned === 'all'
            ? {}
            : { unassigned: assigned === 'unassigned' ? 'true' : 'false' }),
        },
        header,
      },
    }),
    get('/api/v1/clients', {
      params: { query: { status: 'active', page: 1, pageSize: 100 }, header },
    }),
    get('/api/v1/employees', {
      params: { query: { status: 'active', page: 1, pageSize: 100 }, header },
    }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/teams', { params: { header } }),
    get('/api/v1/services', {
      params: {
        query: {
          status: 'active',
          validAt: selectedDate,
          page: 1,
          pageSize: 100,
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
        },
        header,
      },
    }),
  ]);

  const permissions = await getPermissionGrants(api);
  const canCreate = hasPermission(permissions, 'schedule.create');
  const canAssign = hasPermission(permissions, 'schedule.assign');
  const visits = (visitResult.data?.items ?? []).filter((visit) => {
    const localDate = dateAtZone(visit.plannedStart, visit.timezone);
    return localDate >= period.start && localDate < period.endExclusive;
  });
  const visitsByDate = new Map<string, typeof visits>();
  for (const visit of visits) {
    const localDate = dateAtZone(visit.plannedStart, visit.timezone);
    visitsByDate.set(localDate, [...(visitsByDate.get(localDate) ?? []), visit]);
  }
  const days = datesBetween(period.start, period.endExclusive);
  const clients = clientResult.data?.items ?? [];
  const employees = employeeResult.data?.items ?? [];
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const teams = teamResult.data ?? [];
  const services = serviceResult.data?.items ?? [];
  const openCount = visits.filter((visit) => visit.assignments.length === 0).length;
  const error = query.error ?? visitResult.error?.code;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Office</p>
          <h1 className="text-3xl font-semibold">Einsatzplanung</h1>
          <p className="text-slate-700">Geplante Besuche nach lokaler Einrichtungszeit.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant={view === 'week' ? 'default' : 'secondary'} size="sm">
            <Link href={viewHref({ ...query, date: selectedDate, view: 'week', page: '1' })}>
              Woche
            </Link>
          </Button>
          <Button asChild variant={view === 'day' ? 'default' : 'secondary'} size="sm">
            <Link href={viewHref({ ...query, date: selectedDate, view: 'day', page: '1' })}>
              Tag
            </Link>
          </Button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Planung konnte nicht geladen oder gespeichert werden ({error}).
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          Einsatz wurde gespeichert.
        </p>
      ) : null}

      <section
        aria-label="Kalendernavigation"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Button asChild variant="secondary">
          <Link
            href={viewHref({
              ...query,
              date: addDays(period.start, view === 'day' ? -1 : -7),
              page: '1',
            })}
          >
            Zurück
          </Link>
        </Button>
        <h2 className="text-lg font-semibold">
          {view === 'day'
            ? formatDay(period.start)
            : `${formatDay(period.start)} – ${formatDay(addDays(period.endExclusive, -1))}`}
        </h2>
        <Button asChild variant="secondary">
          <Link
            href={viewHref({
              ...query,
              date: addDays(period.start, view === 'day' ? 1 : 7),
              page: '1',
            })}
          >
            Weiter
          </Link>
        </Button>
      </section>

      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3 lg:grid-cols-4"
      >
        <input type="hidden" name="view" value={view} />
        <Field label="Datum" name="date" type="date" defaultValue={selectedDate} />
        <SelectField label="Organisation" name="organizationId" defaultValue={organizationId ?? ''}>
          <option value="">Alle Organisationen</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Einrichtung" name="facilityId" defaultValue={facilityId ?? ''}>
          <option value="">Alle Einrichtungen</option>
          {facilities.map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Team" name="teamId" defaultValue={teamId ?? ''}>
          <option value="">Alle Teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Mitarbeitende" name="employeeId" defaultValue={employeeId ?? ''}>
          <option value="">Alle Mitarbeitenden</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.preferredName || employee.firstName} {employee.lastName}
            </option>
          ))}
        </SelectField>
        <SelectField label="Status" name="status" defaultValue={status ?? ''}>
          <option value="">Alle Status</option>
          <option value="planned">Geplant</option>
          <option value="confirmed">Bestätigt</option>
          <option value="cancelled">Abgesagt</option>
        </SelectField>
        <SelectField label="Zuweisung" name="assigned" defaultValue={assigned}>
          <option value="all">Alle Einsätze</option>
          <option value="unassigned">Offene Einsätze</option>
          <option value="assigned">Zugewiesen</option>
        </SelectField>
        <SelectField
          label="Leistung"
          name="serviceDefinitionId"
          defaultValue={serviceDefinitionId ?? ''}
        >
          <option value="">Alle Leistungen</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.code} · {service.name}
            </option>
          ))}
        </SelectField>
        {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary">
            Filter anwenden
          </Button>
          <Button asChild variant="link">
            <Link href="/planning">Zurücksetzen</Link>
          </Button>
        </div>
      </form>

      <section aria-labelledby="calendar-title" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="calendar-title" className="text-xl font-semibold">
            {view === 'week' ? 'Wochenübersicht' : 'Tagesübersicht'}
          </h2>
          <p className="text-sm text-slate-600">
            {visitResult.data?.total ?? 0} Einsätze · {openCount} offen in dieser Ansicht
          </p>
        </div>
        {visitResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
            Einsätze konnten nicht geladen werden ({visitResult.error.code}).
          </p>
        ) : (
          days.map((day) => {
            const dayVisits = visitsByDate.get(day) ?? [];
            return (
              <section
                key={day}
                aria-labelledby={`day-${day}`}
                className="grid gap-2 rounded-lg border bg-white p-4"
              >
                <h3 id={`day-${day}`} className="font-semibold">
                  {formatDay(day)}
                </h3>
                {dayVisits.length ? (
                  <ol className="grid gap-2">
                    {dayVisits.map((visit) => (
                      <li key={visit.id}>
                        <Link
                          className="grid gap-1 rounded-md border p-3 hover:border-blue-400 hover:bg-blue-50 sm:grid-cols-[8rem_1fr_auto]"
                          href={`/visits/${visit.id}`}
                        >
                          <span className="font-medium">
                            {formatTime(visit.plannedStart, visit.timezone)}–
                            {formatTime(visit.plannedEnd, visit.timezone)}
                          </span>
                          <span>
                            <strong>{visit.clientDisplayName}</strong>
                            <span className="block text-sm text-slate-600">
                              {visit.services
                                .map((service) => `${service.serviceCode} ${service.serviceName}`)
                                .join(' · ')}
                            </span>
                            <span className="block text-sm text-slate-600">
                              {visit.assignments.length
                                ? visit.assignments
                                    .map((item) => item.employeeDisplayName)
                                    .join(', ')
                                : 'Offen'}{' '}
                              · {visit.facilityName}
                            </span>
                          </span>
                          <StatusLabel status={visit.status} />
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-600">Keine Einsätze geplant.</p>
                )}
              </section>
            );
          })
        )}
        {(visitResult.data?.total ?? 0) > 100 ? (
          <div className="flex justify-end gap-2">
            {page > 1 ? (
              <Button asChild variant="secondary">
                <Link href={viewHref({ ...query, date: selectedDate, page: String(page - 1) })}>
                  Vorherige Seite
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={viewHref({ ...query, date: selectedDate, page: String(page + 1) })}>
                Weitere Einsätze
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      {canCreate ? (
        <section
          aria-labelledby="create-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <h2 id="create-title" className="text-xl font-semibold">
            Einsatz manuell planen
          </h2>
          {clients.length && services.length ? (
            <form action={createVisitAction} className="grid gap-4 md:grid-cols-2">
              <SelectField label="Klientin oder Klient" name="clientId" required>
                <option value="">Bitte auswählen</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.preferredName || client.firstName} {client.lastName}
                  </option>
                ))}
              </SelectField>
              <Field
                label="Datum"
                name="localDate"
                type="date"
                defaultValue={selectedDate}
                required
              />
              <Field
                label="Beginn"
                name="localStartTime"
                type="time"
                defaultValue="08:00"
                required
              />
              <Field label="Ende" name="localEndTime" type="time" defaultValue="09:00" required />
              <SelectField
                label="Leistungen (Mehrfachauswahl möglich)"
                name="serviceDefinitionIds"
                multiple
                required
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.code} · {service.name}
                  </option>
                ))}
              </SelectField>
              {canAssign ? (
                <SelectField label="Mitarbeitende (optional)" name="employeeId">
                  <option value="">Noch nicht zuweisen</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.preferredName || employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="visit-note">Hinweis für die Einsatzplanung</Label>
                <textarea
                  id="visit-note"
                  name="note"
                  maxLength={2000}
                  className="min-h-20 rounded-md border px-3 py-2"
                />
              </div>
              <Button type="submit" className="w-fit">
                Einsatz anlegen
              </Button>
            </form>
          ) : (
            <p className="text-sm text-slate-600">
              Zum Anlegen werden zugängliche Klienten und aktive Leistungen benötigt.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  required,
  multiple,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  multiple?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        multiple={multiple}
        size={multiple ? 4 : undefined}
        className="min-h-10 rounded-md border bg-white px-3 py-2"
      >
        {children}
      </select>
    </div>
  );
}

function StatusLabel({ status }: { status: 'planned' | 'confirmed' | 'cancelled' }) {
  const label =
    status === 'planned' ? 'Geplant' : status === 'confirmed' ? 'Bestätigt' : 'Abgesagt';
  return <span className="self-start rounded-full border px-2 py-1 text-xs">{label}</span>;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function todayInBerlin(): string {
  return dateAtZone(new Date().toISOString(), 'Europe/Berlin');
}

function dateAtZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function dayPeriod(date: string): { start: string; endExclusive: string } {
  return { start: date, endExclusive: addDays(date, 1) };
}

function weekPeriod(date: string): { start: string; endExclusive: string } {
  const dateValue = new Date(`${date}T00:00:00Z`);
  const mondayOffset = (dateValue.getUTCDay() + 6) % 7;
  const start = addDays(date, -mondayOffset);
  return { start, endExclusive: addDays(start, 7) };
}

function datesBetween(from: string, until: string): string[] {
  const values: string[] = [];
  for (let date = from; date < until; date = addDays(date, 1)) values.push(date);
  return values;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function apiRange(start: string, endExclusive: string): { from: string; until: string } {
  const padding = 15 * 60 * 60 * 1000;
  return {
    from: new Date(Date.parse(`${start}T00:00:00Z`) - padding).toISOString(),
    until: new Date(Date.parse(`${endExclusive}T00:00:00Z`) + padding).toISOString(),
  };
}

function viewHref(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return `/planning?${params.toString()}`;
}
