import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../../administration/action-notice';
import { ConfirmSubmitButton } from '../../administration/confirm-submit-button';
import {
  assignFacilityAction,
  assignQualificationAction,
  assignSkillAction,
  assignTeamAction,
  changeEmployeeStatusAction,
  linkEmployeeUserAction,
  removeQualificationAction,
  removeSkillAction,
  unassignFacilityAction,
  unassignTeamAction,
  unlinkEmployeeUserAction,
  updateEmployeeAction,
} from '../actions';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const employeeResult = await get('/api/v1/employees/{id}', { params: { path: { id }, header } });
  if (!employeeResult.data) notFound();
  const employee = employeeResult.data;
  const { scheduleNow, scheduleUntil } = employeeVisitRange();
  const [facilitiesResult, teamsResult, qualificationsResult, skillsResult, linkableUsersResult] =
    await Promise.all([
      get('/api/v1/facilities', {
        params: {
          query: employee.organizationId ? { organizationId: employee.organizationId } : {},
          header,
        },
      }),
      get('/api/v1/teams', {
        params: {
          query: employee.organizationId ? { organizationId: employee.organizationId } : {},
          header,
        },
      }),
      get('/api/v1/qualifications', { params: { query: { status: 'active' }, header } }),
      get('/api/v1/skills', { params: { query: { status: 'active' }, header } }),
      employee.linkedUser
        ? Promise.resolve({ data: undefined, error: undefined })
        : get('/api/v1/employees/{id}/linkable-users', { params: { path: { id }, header } }),
    ]);
  const visitsResult = await get('/api/v1/visits', {
    params: {
      query: {
        from: scheduleNow.toISOString(),
        until: scheduleUntil.toISOString(),
        employeeId: id,
        page: 1,
        pageSize: 100,
      },
      header,
    },
  });
  const facilities = (facilitiesResult.data ?? []).filter(
    (facility) => facility.status === 'active',
  );
  const teams = (teamsResult.data ?? []).filter((team) => team.status === 'active');
  const qualifications = qualificationsResult.data ?? [];
  const skills = skillsResult.data ?? [];
  const assignments = employee.facilityAssignments.filter(
    (assignment) => assignment.status === 'active',
  );
  const teamMemberships = employee.teamMemberships.filter(
    (membership) => membership.status === 'active',
  );
  const writable = employee.status !== 'archived';

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/employees">Mitarbeitende</Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">
              {employee.preferredName || employee.firstName} {employee.lastName}
            </h1>
            <StatusBadge status={employee.status} />
          </div>
          <p className="text-slate-600">
            {employee.organizationName ?? 'Keine Organisation'}
            {employee.personnelNumber ? ` · ${employee.personnelNumber}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {employee.status === 'active' ? (
            <StatusForm id={id} operation="deactivate" label="Deaktivieren" />
          ) : employee.status === 'inactive' ? (
            <StatusForm id={id} operation="activate" label="Aktivieren" />
          ) : null}
          {writable ? (
            <form action={changeEmployeeStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="operation" value="archive" />
              <ConfirmSubmitButton confirmation="Diese Person archivieren?">
                Archivieren
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />

      <section
        aria-labelledby="schedule-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="schedule-title" className="text-xl font-semibold">
            Kommende Einsätze
          </h2>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/planning?employeeId=${employee.id}`}>In der Einsatzplanung öffnen</Link>
          </Button>
        </div>
        {visitsResult.error ? (
          <p className="text-sm text-slate-600">
            Einsätze sind mit der aktuellen Berechtigung nicht verfügbar.
          </p>
        ) : visitsResult.data?.items.length ? (
          <ol className="grid gap-2">
            {visitsResult.data.items.map((visit) => (
              <li key={visit.id}>
                <Link
                  className="grid gap-1 rounded-md border p-3 hover:border-blue-400 sm:grid-cols-[12rem_1fr_auto]"
                  href={`/visits/${visit.id}`}
                >
                  <time dateTime={visit.plannedStart}>
                    {formatVisitDateTime(visit.plannedStart, visit.timezone)}
                  </time>
                  <span>
                    <strong>{visit.clientDisplayName}</strong>
                    <span className="block text-sm text-slate-600">
                      {visit.services.map((service) => service.serviceName).join(' · ')}
                    </span>
                  </span>
                  <span className="text-sm">
                    {visit.status === 'cancelled'
                      ? 'Abgesagt'
                      : visit.status === 'confirmed'
                        ? 'Bestätigt'
                        : 'Geplant'}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-600">
            Keine zugewiesenen Einsätze in den nächsten 30 Tagen.
          </p>
        )}
      </section>

      <section
        id="overview"
        aria-labelledby="overview-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="overview-title" className="text-xl font-semibold">
            Overview
          </h2>
          <p className="text-sm text-slate-600">Stammdaten und Beschäftigungsgrundlagen.</p>
        </div>
        <form action={updateEmployeeAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={employee.id} />
          <Field
            id="firstName"
            name="firstName"
            label="Vorname"
            defaultValue={employee.firstName}
            required
            maxLength={120}
          />
          <Field
            id="lastName"
            name="lastName"
            label="Nachname"
            defaultValue={employee.lastName}
            required
            maxLength={120}
          />
          <Field
            id="preferredName"
            name="preferredName"
            label="Bevorzugter Name"
            defaultValue={employee.preferredName ?? ''}
            maxLength={120}
          />
          <Field
            id="personnelNumber"
            name="personnelNumber"
            label="Personalnummer"
            defaultValue={employee.personnelNumber ?? ''}
            maxLength={64}
          />
          <Field
            id="email"
            name="email"
            label="E-Mail"
            type="email"
            defaultValue={employee.email ?? ''}
            maxLength={320}
          />
          <Field
            id="phone"
            name="phone"
            label="Telefon"
            type="tel"
            defaultValue={employee.phone ?? ''}
            maxLength={40}
          />
          <Field
            id="employmentType"
            name="employmentType"
            label="Beschäftigungsart"
            defaultValue={employee.employmentType ?? ''}
            maxLength={80}
          />
          <Field
            id="startDate"
            name="startDate"
            label="Beginn"
            type="date"
            defaultValue={employee.startDate ?? ''}
          />
          <Field
            id="endDate"
            name="endDate"
            label="Ende"
            type="date"
            defaultValue={employee.endDate ?? ''}
          />
          <Field
            id="weeklyHours"
            name="weeklyHours"
            label="Wochenstunden"
            type="number"
            defaultValue={employee.weeklyHours?.toString() ?? ''}
            min="0"
            max="168"
            step="0.25"
          />
          <div className="md:col-span-2">
            <Button type="submit" disabled={!writable}>
              Stammdaten speichern
            </Button>
          </div>
        </form>
      </section>

      <section
        id="assignments"
        aria-labelledby="assignments-title"
        className="grid gap-5 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="assignments-title" className="text-xl font-semibold">
            Assignments
          </h2>
          <p className="text-sm text-slate-600">
            Facility and team membership are operational assignments, separate from platform roles.
          </p>
        </div>
        {employee.organizationId ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="grid content-start gap-3">
              <h3 className="font-semibold">Facilities</h3>
              {assignments.length ? (
                assignments.map((assignment) => (
                  <article
                    key={assignment.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">
                        {assignment.facilityName}
                        {assignment.isPrimary ? ' · Hauptstandort' : ''}
                      </p>
                      <p className="text-sm text-slate-600">
                        {dateRange(assignment.validFrom, assignment.validUntil)}
                      </p>
                    </div>
                    <form action={unassignFacilityAction}>
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="facilityId" value={assignment.facilityId} />
                      <ConfirmSubmitButton confirmation="Facility assignment entfernen?">
                        Entfernen
                      </ConfirmSubmitButton>
                    </form>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-600">Noch keiner Einrichtung zugewiesen.</p>
              )}
              {facilities.length ? (
                <form action={assignFacilityAction} className="grid gap-3 rounded-md border p-3">
                  <input type="hidden" name="employeeId" value={id} />
                  <div className="grid gap-2">
                    <Label htmlFor="facilityId">Einrichtung zuweisen</Label>
                    <select
                      id="facilityId"
                      name="facilityId"
                      className="h-10 rounded-md border bg-white px-3"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Einrichtung auswählen
                      </option>
                      {facilities.map((facility) => (
                        <option key={facility.id} value={facility.id}>
                          {facility.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isPrimary" /> Als Hauptstandort festlegen
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="facility-valid-from"
                      name="validFrom"
                      label="Gültig ab"
                      type="date"
                    />
                    <Field
                      id="facility-valid-until"
                      name="validUntil"
                      label="Gültig bis"
                      type="date"
                    />
                  </div>
                  <Button type="submit" disabled={!writable || employee.status !== 'active'}>
                    Einrichtung zuweisen
                  </Button>
                </form>
              ) : null}
            </div>
            <div className="grid content-start gap-3">
              <h3 className="font-semibold">Teams</h3>
              {teamMemberships.length ? (
                teamMemberships.map((membership) => (
                  <article
                    key={membership.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{membership.teamName}</p>
                      <p className="text-sm text-slate-600">
                        {membership.role || 'Mitglied'} ·{' '}
                        {dateRange(membership.validFrom, membership.validUntil)}
                      </p>
                    </div>
                    <form action={unassignTeamAction}>
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="teamId" value={membership.teamId} />
                      <ConfirmSubmitButton confirmation="Teammitgliedschaft entfernen?">
                        Entfernen
                      </ConfirmSubmitButton>
                    </form>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-600">Noch keinem Team zugewiesen.</p>
              )}
              {teams.length ? (
                <form action={assignTeamAction} className="grid gap-3 rounded-md border p-3">
                  <input type="hidden" name="employeeId" value={id} />
                  <div className="grid gap-2">
                    <Label htmlFor="teamId">Team zuweisen</Label>
                    <select
                      id="teamId"
                      name="teamId"
                      className="h-10 rounded-md border bg-white px-3"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Team auswählen
                      </option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field
                    id="team-role"
                    name="role"
                    label="Teamfunktion (optional)"
                    maxLength={80}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="team-valid-from" name="validFrom" label="Gültig ab" type="date" />
                    <Field id="team-valid-until" name="validUntil" label="Gültig bis" type="date" />
                  </div>
                  <Button type="submit" disabled={!writable || employee.status !== 'active'}>
                    Team zuweisen
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        ) : (
          <p
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
          >
            Für diese Person fehlt eine Organisation; Zuweisungen sind daher nicht verfügbar.
          </p>
        )}
      </section>

      <section
        id="qualifications"
        aria-labelledby="qualifications-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="qualifications-title" className="text-xl font-semibold">
            Qualifications
          </h2>
          <p className="text-sm text-slate-600">
            Formale Qualifikationen mit optionaler Gültigkeitsdauer.
          </p>
        </div>
        {employee.qualifications.length ? (
          <ul className="grid gap-2">
            {employee.qualifications.map((qualification) => (
              <li
                key={qualification.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">
                    {qualification.name}
                    {qualification.code ? ` (${qualification.code})` : ''}
                  </p>
                  <p className="text-sm text-slate-600">
                    {dateRange(qualification.validFrom, qualification.validUntil)}
                    {qualification.issuer ? ` · ${qualification.issuer}` : ''}
                    {qualification.status === 'archived' ? ' · archiviert' : ''}
                  </p>
                </div>
                {qualification.status === 'active' ? (
                  <form action={removeQualificationAction}>
                    <input type="hidden" name="employeeId" value={id} />
                    <input
                      type="hidden"
                      name="qualificationId"
                      value={qualification.qualificationId}
                    />
                    <ConfirmSubmitButton confirmation="Qualifikation entfernen?">
                      Entfernen
                    </ConfirmSubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">Keine Qualifikationen zugeordnet.</p>
        )}
        {qualifications.length ? (
          <form action={assignQualificationAction} className="grid gap-3 rounded-md border p-3">
            <input type="hidden" name="employeeId" value={id} />
            <div className="grid gap-2">
              <Label htmlFor="qualificationId">Qualifikation hinzufügen</Label>
              <select
                id="qualificationId"
                name="qualificationId"
                className="h-10 rounded-md border bg-white px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Qualifikation auswählen
                </option>
                {qualifications.map((qualification) => (
                  <option key={qualification.id} value={qualification.id}>
                    {qualification.name}
                    {qualification.code ? ` (${qualification.code})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="qualification-valid-from" name="validFrom" label="Gültig ab" type="date" />
              <Field
                id="qualification-valid-until"
                name="validUntil"
                label="Gültig bis"
                type="date"
              />
              <Field id="qualification-issuer" name="issuer" label="Aussteller" maxLength={160} />
            </div>
            <Button type="submit" disabled={!writable}>
              Qualifikation speichern
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">
            <Link className="underline" href="/administration/qualifications">
              Qualifikationen verwalten
            </Link>
          </p>
        )}
      </section>

      <section
        id="skills"
        aria-labelledby="skills-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="skills-title" className="text-xl font-semibold">
            Skills
          </h2>
          <p className="text-sm text-slate-600">
            Zusätzliche Fähigkeiten getrennt von formalen Qualifikationen.
          </p>
        </div>
        {employee.skills.length ? (
          <ul className="grid gap-2">
            {employee.skills.map((skill) => (
              <li
                key={skill.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="font-medium">
                  {skill.name}
                  {skill.code ? ` (${skill.code})` : ''}
                  {skill.status === 'archived' ? ' · archiviert' : ''}
                </span>
                {skill.status === 'active' ? (
                  <form action={removeSkillAction}>
                    <input type="hidden" name="employeeId" value={id} />
                    <input type="hidden" name="skillId" value={skill.skillId} />
                    <ConfirmSubmitButton confirmation="Fähigkeit entfernen?">
                      Entfernen
                    </ConfirmSubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">Keine Fähigkeiten zugeordnet.</p>
        )}
        {skills.length ? (
          <form
            action={assignSkillAction}
            className="flex flex-wrap items-end gap-3 rounded-md border p-3"
          >
            <input type="hidden" name="employeeId" value={id} />
            <div className="grid gap-2">
              <Label htmlFor="skillId">Fähigkeit hinzufügen</Label>
              <select
                id="skillId"
                name="skillId"
                className="h-10 rounded-md border bg-white px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Fähigkeit auswählen
                </option>
                {skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                    {skill.code ? ` (${skill.code})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!writable}>
              Fähigkeit zuweisen
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">
            <Link className="underline" href="/administration/qualifications">
              Fähigkeiten verwalten
            </Link>
          </p>
        )}
      </section>

      <section
        id="access"
        aria-labelledby="access-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="access-title" className="text-xl font-semibold">
              Access
            </h2>
            <p className="text-sm text-slate-600">
              An employee record is separate from a platform user account.
            </p>
          </div>
          <Link className="text-sm text-blue-900 underline" href="/administration/users">
            Users &amp; Access verwalten
          </Link>
        </div>
        {employee.linkedUser ? (
          <div className="grid gap-2 rounded-md border p-3">
            <p className="font-medium">
              {employee.linkedUser.displayName ||
                employee.linkedUser.email ||
                employee.linkedUser.id}
            </p>
            <p className="text-sm text-slate-600">
              {employee.linkedUser.email ?? 'Keine E-Mail'} · Tenant membership:{' '}
              {employee.linkedUser.membershipStatus}
            </p>
            <form action={unlinkEmployeeUserAction}>
              <input type="hidden" name="employeeId" value={id} />
              <ConfirmSubmitButton confirmation="Die Benutzerverknüpfung lösen?">
                Benutzer lösen
              </ConfirmSubmitButton>
            </form>
          </div>
        ) : linkableUsersResult.error ? (
          <p className="text-sm text-slate-600">
            Benutzerverknüpfung kann nicht angezeigt werden ({linkableUsersResult.error.code}).
          </p>
        ) : linkableUsersResult.data?.length ? (
          <form action={linkEmployeeUserAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="employeeId" value={id} />
            <div className="grid gap-2">
              <Label htmlFor="userId">Aktiven Benutzer verknüpfen</Label>
              <select
                id="userId"
                name="userId"
                className="h-10 rounded-md border bg-white px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Benutzer auswählen
                </option>
                {linkableUsersResult.data.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName || user.email || user.id}
                    {user.email ? ` · ${user.email}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!writable}>
              Benutzer verknüpfen
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">
            Kein aktiver Benutzer ohne bestehende Mitarbeiterverknüpfung verfügbar.
          </p>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  defaultValue = '',
  type = 'text',
  required = false,
  maxLength,
  min,
  max,
  step,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

function StatusForm({
  id,
  operation,
  label,
}: Readonly<{ id: string; operation: 'activate' | 'deactivate'; label: string }>) {
  return (
    <form action={changeEmployeeStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operation" value={operation} />
      <Button variant="secondary" type="submit">
        {label}
      </Button>
    </form>
  );
}

function dateRange(from: string | null, until: string | null): string {
  if (!from && !until) return 'Unbefristet';
  return `${from ?? 'Offen'} — ${until ?? 'Offen'}`;
}

function formatVisitDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function employeeVisitRange(): { scheduleNow: Date; scheduleUntil: Date } {
  const scheduleNow = new Date();
  return {
    scheduleNow,
    scheduleUntil: new Date(scheduleNow.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}
