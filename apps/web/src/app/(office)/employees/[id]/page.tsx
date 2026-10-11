import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '@app/web/i18n/status';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import type { Locale } from '@app/web/i18n/config';
import { formatVisitDateTime } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import {
  assignFacilityAction,
  cancelEmployeeAbsenceAction,
  createAvailabilityExceptionAction,
  createEmployeeAbsenceAction,
  assignQualificationAction,
  assignSkillAction,
  assignTeamAction,
  changeEmployeeStatusAction,
  deleteAvailabilityExceptionAction,
  linkEmployeeUserAction,
  removeQualificationAction,
  removeSkillAction,
  saveEmployeeAvailabilityAction,
  saveEmployeeSchedulingPreferencesAction,
  unassignFacilityAction,
  unassignTeamAction,
  unlinkEmployeeUserAction,
  updateEmployeeAction,
} from '@app/web/app/(office)/employees/actions';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const permissions = await getPermissionGrants(api);
  const canReadSchedule = hasPermission(permissions, 'schedule.read');
  const canManageSchedule = hasPermission(permissions, 'schedule.update');
  const employeeResult = await get('/api/v1/employees/{id}', { params: { path: { id }, header } });
  if (!employeeResult.data) notFound();
  const employee = employeeResult.data;
  const { scheduleNow, scheduleFrom, scheduleUntil } = employeeVisitRange();
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
  const recentVisitsResult = await get('/api/v1/visits', {
    params: {
      query: {
        from: scheduleFrom.toISOString(),
        until: scheduleNow.toISOString(),
        employeeId: id,
        page: 1,
        pageSize: 100,
      },
      header,
    },
  });
  const absenceUntil = new Date(scheduleNow.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [availabilityResult, absencesResult, preferencesResult] = canReadSchedule
    ? await Promise.all([
        get('/api/v1/employees/{employeeId}/availability', {
          params: { path: { employeeId: id }, header },
        }),
        get('/api/v1/employees/{employeeId}/unavailability', {
          params: {
            path: { employeeId: id },
            query: { from: scheduleNow.toISOString(), until: absenceUntil.toISOString() },
            header,
          },
        }),
        canManageSchedule
          ? get('/api/v1/employees/{employeeId}/scheduling-preferences', {
              params: { path: { employeeId: id }, header },
            })
          : Promise.resolve({ data: undefined, error: undefined }),
      ])
    : [null, null, null];
  const visitItems = visitsResult.data?.items ?? [];
  const recentVisitItems = recentVisitsResult.data?.items ?? [];
  const fetchExecutionSummaries = (items: typeof visitItems) =>
    items.length
      ? get('/api/v1/visit-executions/summaries', {
          params: {
            query: { visitIds: items.map((visit) => visit.id).join(',') },
            header,
          },
        })
      : Promise.resolve({ data: [], error: undefined });
  const [executionSummariesResult, recentExecutionSummariesResult] = await Promise.all([
    fetchExecutionSummaries(visitItems),
    fetchExecutionSummaries(recentVisitItems),
  ]);
  const executionByVisitId = new Map(
    (executionSummariesResult.data ?? []).map((summary) => [summary.visitId, summary]),
  );
  const recentExecutionByVisitId = new Map(
    (recentExecutionSummariesResult.data ?? []).map((summary) => [summary.visitId, summary]),
  );
  const recentExecutionItems = recentVisitItems.filter(
    (visit) =>
      recentExecutionByVisitId.get(visit.id)?.executionStatus !== undefined &&
      recentExecutionByVisitId.get(visit.id)?.executionStatus !== 'not_started',
  );
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
  const availability = availabilityResult?.data?.availability ?? null;
  const availabilityVersion = availabilityResult?.data?.version ?? 0;
  const absences = absencesResult?.data?.absences ?? [];
  const schedulingPreferences = preferencesResult?.data ?? null;
  const impactedVisits = absencesResult?.data?.impactedVisits ?? [];
  const availabilityTimezone = availability?.timezone ?? 'Europe/Berlin';
  const weekdays = [
    { weekday: 1, label: t('Employees.detail.weekdays.monday') },
    { weekday: 2, label: t('Employees.detail.weekdays.tuesday') },
    { weekday: 3, label: t('Employees.detail.weekdays.wednesday') },
    { weekday: 4, label: t('Employees.detail.weekdays.thursday') },
    { weekday: 5, label: t('Employees.detail.weekdays.friday') },
    { weekday: 6, label: t('Employees.detail.weekdays.saturday') },
    { weekday: 7, label: t('Employees.detail.weekdays.sunday') },
  ];

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/employees">{t('Employees.title')}</Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">
              {employee.preferredName || employee.firstName} {employee.lastName}
            </h1>
            <StatusBadge status={employee.status} label={t(statusLabelKey(employee.status))} />
          </div>
          <p className="text-slate-600">
            {employee.organizationName ?? t('Employees.detail.noOrganization')}
            {employee.personnelNumber ? ` · ${employee.personnelNumber}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPermission(permissions, 'operations.read') ? (
            <Button asChild variant="secondary">
              <Link href={`/operations/deadlines?employeeId=${employee.id}`}>
                {t('Operations.employeeDeadlines')}
              </Link>
            </Button>
          ) : null}
          {employee.status === 'active' ? (
            <StatusForm id={id} operation="deactivate" label={t('Employees.detail.deactivate')} />
          ) : employee.status === 'inactive' ? (
            <StatusForm id={id} operation="activate" label={t('Employees.detail.activate')} />
          ) : null}
          {writable ? (
            <form action={changeEmployeeStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="operation" value="archive" />
              <ConfirmSubmitButton confirmation={t('Employees.detail.archiveConfirmation')}>
                {t('Employees.detail.archive')}
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
            {t('Employees.detail.upcomingVisits')}
          </h2>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/planning?employeeId=${employee.id}`}>
              {t('Employees.detail.openPlanning')}
            </Link>
          </Button>
        </div>
        {visitsResult.error ? (
          <p className="text-sm text-slate-600">{t('Employees.detail.visitsUnavailable')}</p>
        ) : visitItems.length ? (
          <ol className="grid gap-2">
            {visitItems.map((visit) => {
              const execution = executionByVisitId.get(visit.id);
              return (
                <li key={visit.id}>
                  <Link
                    className="grid gap-1 rounded-md border p-3 hover:border-blue-400 sm:grid-cols-[12rem_1fr_auto]"
                    href={`/visits/${visit.id}`}
                  >
                    <time dateTime={visit.plannedStart}>
                      {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                    </time>
                    <span>
                      <strong>{visit.clientDisplayName}</strong>
                      <span className="block text-sm text-slate-600">
                        {visit.services.map((service) => service.serviceName).join(' · ')}
                      </span>
                      {execution ? (
                        <span className="block text-sm text-slate-600">
                          {t('Employees.detail.execution')}{' '}
                          {execution.executionStatus === 'completed'
                            ? t('Common.status.completed')
                            : execution.executionStatus === 'in_progress'
                              ? t('Common.status.inProgress')
                              : t('VisitExecution.executionStatus.notStarted')}
                          {execution.actualStart ? (
                            <>
                              {` · ${t('Employees.detail.actual')} `}
                              {formatVisitDateTime(execution.actualStart, visit.timezone, locale)}
                              {execution.actualEnd
                                ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                                : ''}
                            </>
                          ) : null}
                        </span>
                      ) : executionSummariesResult.error ? (
                        <span className="block text-sm text-slate-600">
                          {t('Employees.detail.executionStatusUnavailable')}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm">
                      {visit.status === 'cancelled'
                        ? t('Common.status.cancelled')
                        : visit.status === 'confirmed'
                          ? t('Common.status.confirmed')
                          : t('Common.status.planned')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-slate-600">{t('Employees.detail.noAssignedVisits')}</p>
        )}
        {recentVisitsResult.error ? (
          <p className="text-sm text-slate-600">
            {t('Employees.detail.pastExecutionsUnavailable')}
          </p>
        ) : recentExecutionSummariesResult.error ? (
          <p className="text-sm text-slate-600">
            {t('Employees.detail.pastExecutionStatusUnavailable')}
          </p>
        ) : recentExecutionItems.length ? (
          <div className="grid gap-3">
            <h3 className="font-semibold">{t('Employees.detail.recentVisits')}</h3>
            <ol className="grid gap-2">
              {recentExecutionItems.map((visit) => {
                const execution = recentExecutionByVisitId.get(visit.id);
                if (!execution) return null;
                return (
                  <li key={visit.id}>
                    <Link
                      className="grid gap-1 rounded-md border p-3 hover:border-blue-400"
                      href={`/visits/${visit.id}`}
                    >
                      <time dateTime={visit.plannedStart}>
                        {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                      </time>
                      <strong>{visit.clientDisplayName}</strong>
                      <span className="text-sm text-slate-600">
                        {visit.services.map((service) => service.serviceName).join(' · ')}
                      </span>
                      <span className="text-sm text-slate-600">
                        {t('Employees.detail.execution')}{' '}
                        {execution.executionStatus === 'completed'
                          ? t('Common.status.completed')
                          : t('Common.status.inProgress')}
                        {execution.actualStart
                          ? ` · ${t('Employees.detail.actual')} ${formatVisitDateTime(execution.actualStart, visit.timezone, locale)}`
                          : ''}
                        {execution.actualEnd
                          ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                          : ''}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </section>

      {canReadSchedule ? (
        <section
          id="availability"
          aria-labelledby="availability-title"
          className="grid gap-4 rounded-lg border bg-white p-5"
        >
          <div>
            <h2 id="availability-title" className="text-xl font-semibold">
              {t('Employees.detail.availabilityTitle')}
            </h2>
            <p className="text-sm text-slate-600">
              {t('Employees.detail.availabilityDescription')}
            </p>
          </div>
          {availabilityResult?.error ? (
            <p role="alert" className="text-sm text-red-800">
              {t(errorMessageKey(availabilityResult.error.code))}
            </p>
          ) : null}
          {canManageSchedule && employee.status === 'active' ? (
            <form action={saveEmployeeAvailabilityAction} className="grid gap-4">
              <input type="hidden" name="employeeId" value={employee.id} />
              <input type="hidden" name="expectedVersion" value={availabilityVersion} />
              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  id="availability-timezone"
                  name="timezone"
                  label={t('Employees.detail.timezone')}
                  defaultValue={availabilityTimezone}
                  required
                  maxLength={100}
                />
                <Field
                  id="availability-max-daily"
                  name="maxDailyMinutes"
                  label={t('Employees.detail.maxDailyMinutes')}
                  type="number"
                  min="1"
                  max="1440"
                  defaultValue={availability?.maxDailyMinutes?.toString() ?? ''}
                />
                <Field
                  id="availability-travel-buffer"
                  name="travelBufferMinutes"
                  label={t('Employees.detail.travelBufferMinutes')}
                  type="number"
                  min="0"
                  max="240"
                  defaultValue={String(availability?.travelBufferMinutes ?? 0)}
                  required
                />
              </div>
              <div className="grid gap-3">
                <h3 className="font-semibold">{t('Employees.detail.weeklyHours')}</h3>
                <div className="grid gap-3">
                  {weekdays.map(({ weekday, label }) => {
                    const windows =
                      availability?.windows.filter((window) => window.weekday === weekday) ?? [];
                    return (
                      <fieldset key={weekday} className="grid gap-2 rounded-md border p-3">
                        <legend className="px-1 font-medium">{label}</legend>
                        {[1, 2, 3, 4].map((slot) => {
                          const window = windows[slot - 1];
                          return (
                            <div key={slot} className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                              <Field
                                id={`availability-${weekday}-${slot}-start`}
                                name={`window_${weekday}_${slot}_start`}
                                label={t('Employees.detail.windowStart')}
                                type="time"
                                defaultValue={window?.startsAt ?? ''}
                              />
                              <Field
                                id={`availability-${weekday}-${slot}-end`}
                                name={`window_${weekday}_${slot}_end`}
                                label={t('Employees.detail.windowEnd')}
                                type="time"
                                defaultValue={window?.endsAt ?? ''}
                              />
                            </div>
                          );
                        })}
                      </fieldset>
                    );
                  })}
                </div>
              </div>
              <Button type="submit" className="w-fit">
                {t('Employees.detail.saveAvailability')}
              </Button>
            </form>
          ) : null}

          <div className="grid gap-3 border-t pt-4">
            <div>
              <h3 className="font-semibold">{t('Employees.detail.schedulingPreferences')}</h3>
              <p className="text-sm text-slate-600">
                {t('Employees.detail.schedulingPreferencesDescription')}
              </p>
            </div>
            {preferencesResult?.error ? (
              <p role="alert" className="text-sm text-red-800">
                {t(errorMessageKey(preferencesResult.error.code))}
              </p>
            ) : null}
            {canManageSchedule && employee.status === 'active' ? (
              <form action={saveEmployeeSchedulingPreferencesAction} className="grid gap-4">
                <input type="hidden" name="employeeId" value={employee.id} />
                <fieldset className="grid gap-2">
                  <legend className="font-medium">{t('Employees.detail.preferredWeekdays')}</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {weekdays.map(({ weekday, label }) => (
                      <label key={weekday} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="preferredWeekdays"
                          value={weekday}
                          defaultChecked={schedulingPreferences?.preferredWeekdays.includes(
                            weekday,
                          )}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3">
                  <p className="font-medium">{t('Employees.detail.preferredTimeWindows')}</p>
                  {[1, 2, 3, 4].map((slot) => {
                    const window = schedulingPreferences?.preferredTimeWindows[slot - 1];
                    return (
                      <div key={slot} className="grid gap-3 sm:grid-cols-2">
                        <Field
                          id={`employee-preferred-window-${slot}-start`}
                          name={`preferredWindow${slot}Start`}
                          label={t('Employees.detail.windowStart')}
                          type="time"
                          defaultValue={window?.startsAt ?? ''}
                        />
                        <Field
                          id={`employee-preferred-window-${slot}-end`}
                          name={`preferredWindow${slot}End`}
                          label={t('Employees.detail.windowEnd')}
                          type="time"
                          defaultValue={window?.endsAt ?? ''}
                        />
                      </div>
                    );
                  })}
                </div>
                <div>
                  <p className="font-medium">{t('Employees.detail.preferredStartLocation')}</p>
                  <p className="mb-2 text-sm text-slate-600">
                    {t('Employees.detail.preferredStartLocationDescription')}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="preferred-start-latitude"
                      name="preferredStartLatitude"
                      label={t('Employees.detail.latitude')}
                      type="number"
                      min="-90"
                      max="90"
                      step="0.000001"
                      defaultValue={schedulingPreferences?.preferredStartLatitude?.toString() ?? ''}
                    />
                    <Field
                      id="preferred-start-longitude"
                      name="preferredStartLongitude"
                      label={t('Employees.detail.longitude')}
                      type="number"
                      min="-180"
                      max="180"
                      step="0.000001"
                      defaultValue={
                        schedulingPreferences?.preferredStartLongitude?.toString() ?? ''
                      }
                    />
                  </div>
                </div>
                <p className="text-sm text-slate-600">{t('Employees.detail.travelModeDriving')}</p>
                <Button type="submit" className="w-fit">
                  {t('Employees.detail.saveSchedulingPreferences')}
                </Button>
              </form>
            ) : null}
          </div>

          <div className="grid gap-3 border-t pt-4">
            <h3 className="font-semibold">{t('Employees.detail.availabilityExceptions')}</h3>
            {availability?.exceptions.length ? (
              <ul className="grid gap-2">
                {availability.exceptions.map((exception) => (
                  <li
                    key={exception.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <span>
                      <strong>{exception.localDate}</strong> ·{' '}
                      {t(`Employees.detail.exceptionKinds.${exception.kind}`)}
                      {exception.startsAt ? ` · ${exception.startsAt}–${exception.endsAt}` : ''}
                    </span>
                    {canManageSchedule ? (
                      <form action={deleteAvailabilityExceptionAction}>
                        <input type="hidden" name="employeeId" value={employee.id} />
                        <input type="hidden" name="exceptionId" value={exception.id} />
                        <input type="hidden" name="expectedVersion" value={availabilityVersion} />
                        <Button type="submit" variant="secondary" size="sm">
                          {t('Employees.detail.remove')}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">
                {t('Employees.detail.noAvailabilityExceptions')}
              </p>
            )}
            {canManageSchedule && employee.status === 'active' && availability ? (
              <form
                action={createAvailabilityExceptionAction}
                className="grid gap-3 md:grid-cols-4"
              >
                <input type="hidden" name="employeeId" value={employee.id} />
                <input type="hidden" name="expectedVersion" value={availabilityVersion} />
                <Field
                  id="availability-exception-date"
                  name="localDate"
                  label={t('Employees.detail.exceptionDate')}
                  type="date"
                  required
                />
                <SelectField
                  label={t('Employees.detail.exceptionKind')}
                  name="kind"
                  defaultValue="closed"
                  required
                >
                  <option value="closed">{t('Employees.detail.exceptionKinds.closed')}</option>
                  <option value="working_hours">
                    {t('Employees.detail.exceptionKinds.working_hours')}
                  </option>
                  <option value="unavailable">
                    {t('Employees.detail.exceptionKinds.unavailable')}
                  </option>
                </SelectField>
                <Field
                  id="availability-exception-start"
                  name="startsAt"
                  label={t('Employees.detail.windowStart')}
                  type="time"
                />
                <Field
                  id="availability-exception-end"
                  name="endsAt"
                  label={t('Employees.detail.windowEnd')}
                  type="time"
                />
                <Button type="submit" className="w-fit md:col-span-4">
                  {t('Employees.detail.addAvailabilityException')}
                </Button>
              </form>
            ) : null}
          </div>

          <div className="grid gap-3 border-t pt-4">
            <div>
              <h3 className="font-semibold">{t('Employees.detail.absences')}</h3>
              <p className="text-sm text-slate-600">
                {t('Employees.detail.impactedVisitCount', {
                  count: absencesResult?.data?.impactedVisitCount ?? 0,
                })}
              </p>
            </div>
            {absencesResult?.error ? (
              <p className="text-sm text-red-800">
                {t(errorMessageKey(absencesResult.error.code))}
              </p>
            ) : absences.length ? (
              <ul className="grid gap-2">
                {absences.map((absence) => (
                  <li
                    key={absence.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <span>
                      <strong>{t(`Employees.detail.absenceReasons.${absence.reason}`)}</strong> ·{' '}
                      {formatVisitDateTime(absence.startsAt, availabilityTimezone, locale)} –{' '}
                      {formatVisitDateTime(absence.endsAt, availabilityTimezone, locale)}
                      {absence.status === 'cancelled'
                        ? ` · ${t('Employees.detail.cancelled')}`
                        : ''}
                    </span>
                    {canManageSchedule && absence.status === 'active' ? (
                      <form action={cancelEmployeeAbsenceAction}>
                        <input type="hidden" name="employeeId" value={employee.id} />
                        <input type="hidden" name="absenceId" value={absence.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          {t('Employees.detail.cancelAbsence')}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">{t('Employees.detail.noAbsences')}</p>
            )}
            {canManageSchedule && employee.status === 'active' ? (
              <form action={createEmployeeAbsenceAction} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <input type="hidden" name="timezone" value={availabilityTimezone} />
                <SelectField
                  label={t('Employees.detail.absenceReason')}
                  name="reason"
                  defaultValue="vacation"
                  required
                >
                  <option value="vacation">{t('Employees.detail.absenceReasons.vacation')}</option>
                  <option value="sick_leave">
                    {t('Employees.detail.absenceReasons.sick_leave')}
                  </option>
                  <option value="training">{t('Employees.detail.absenceReasons.training')}</option>
                  <option value="personal_unavailability">
                    {t('Employees.detail.absenceReasons.personal_unavailability')}
                  </option>
                  <option value="other">{t('Employees.detail.absenceReasons.other')}</option>
                </SelectField>
                <Field
                  id="absence-start"
                  name="localStart"
                  label={t('Employees.detail.absenceStart')}
                  type="datetime-local"
                  required
                />
                <Field
                  id="absence-end"
                  name="localEnd"
                  label={t('Employees.detail.absenceEnd')}
                  type="datetime-local"
                  required
                />
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="absence-note">{t('Employees.detail.protectedAbsenceNote')}</Label>
                  <textarea
                    id="absence-note"
                    name="note"
                    maxLength={1000}
                    className="min-h-16 rounded-md border px-3 py-2"
                  />
                </div>
                <Button type="submit" className="w-fit">
                  {t('Employees.detail.recordAbsence')}
                </Button>
              </form>
            ) : null}
          </div>
          {impactedVisits.length ? (
            <div className="grid gap-2 border-t pt-4">
              <h3 className="font-semibold">{t('Employees.detail.visitsNeedingAction')}</h3>
              <ul className="grid gap-2">
                {impactedVisits.map((visit) => (
                  <li key={visit.id}>
                    <Link
                      className="block rounded-md border p-3 hover:border-blue-400"
                      href={`/visits/${visit.id}`}
                    >
                      {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)} ·{' '}
                      {visit.clientDisplayName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        id="overview"
        aria-labelledby="overview-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="overview-title" className="text-xl font-semibold">
            {t('Employees.detail.overview')}
          </h2>
          <p className="text-sm text-slate-600">{t('Employees.detail.overviewDescription')}</p>
        </div>
        <form action={updateEmployeeAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={employee.id} />
          <Field
            id="firstName"
            name="firstName"
            label={t('Employees.detail.firstName')}
            defaultValue={employee.firstName}
            required
            maxLength={120}
          />
          <Field
            id="lastName"
            name="lastName"
            label={t('Employees.detail.lastName')}
            defaultValue={employee.lastName}
            required
            maxLength={120}
          />
          <Field
            id="preferredName"
            name="preferredName"
            label={t('Employees.detail.preferredName')}
            defaultValue={employee.preferredName ?? ''}
            maxLength={120}
          />
          <Field
            id="personnelNumber"
            name="personnelNumber"
            label={t('Employees.detail.personnelNumber')}
            defaultValue={employee.personnelNumber ?? ''}
            maxLength={64}
          />
          <Field
            id="email"
            name="email"
            label={t('Employees.detail.email')}
            type="email"
            defaultValue={employee.email ?? ''}
            maxLength={320}
          />
          <Field
            id="phone"
            name="phone"
            label={t('Employees.detail.phone')}
            type="tel"
            defaultValue={employee.phone ?? ''}
            maxLength={40}
          />
          <Field
            id="employmentType"
            name="employmentType"
            label={t('Employees.detail.employmentType')}
            defaultValue={employee.employmentType ?? ''}
            maxLength={80}
          />
          <Field
            id="startDate"
            name="startDate"
            label={t('Employees.detail.startDate')}
            type="date"
            defaultValue={employee.startDate ?? ''}
          />
          <Field
            id="endDate"
            name="endDate"
            label={t('Employees.detail.endDate')}
            type="date"
            defaultValue={employee.endDate ?? ''}
          />
          <Field
            id="weeklyHours"
            name="weeklyHours"
            label={t('Employees.detail.weeklyHours')}
            type="number"
            defaultValue={employee.weeklyHours?.toString() ?? ''}
            min="0"
            max="168"
            step="0.25"
          />
          <div className="md:col-span-2">
            <Button type="submit" disabled={!writable}>
              {t('Employees.detail.saveMasterData')}
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
            {t('Employees.detail.assignments')}
          </h2>
          <p className="text-sm text-slate-600">{t('Employees.detail.assignmentsDescription')}</p>
        </div>
        {employee.organizationId ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="grid content-start gap-3">
              <h3 className="font-semibold">{t('Employees.detail.facilities')}</h3>
              {assignments.length ? (
                assignments.map((assignment) => (
                  <article
                    key={assignment.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">
                        {assignment.facilityName}
                        {assignment.isPrimary ? ` · ${t('Employees.detail.primaryFacility')}` : ''}
                      </p>
                      <p className="text-sm text-slate-600">
                        {dateRange(
                          assignment.validFrom,
                          assignment.validUntil,
                          locale,
                          t('Employees.detail.open'),
                          t('Employees.detail.unlimited'),
                        )}
                      </p>
                    </div>
                    <form action={unassignFacilityAction}>
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="facilityId" value={assignment.facilityId} />
                      <ConfirmSubmitButton
                        confirmation={t('Employees.detail.removeFacilityConfirmation')}
                      >
                        {t('Employees.detail.remove')}
                      </ConfirmSubmitButton>
                    </form>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-600">{t('Employees.detail.noFacility')}</p>
              )}
              {facilities.length ? (
                <form action={assignFacilityAction} className="grid gap-3 rounded-md border p-3">
                  <input type="hidden" name="employeeId" value={id} />
                  <div className="grid gap-2">
                    <Label htmlFor="facilityId">{t('Employees.detail.assignFacility')}</Label>
                    <select
                      id="facilityId"
                      name="facilityId"
                      className="h-10 rounded-md border bg-white px-3"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {t('Employees.detail.selectFacility')}
                      </option>
                      {facilities.map((facility) => (
                        <option key={facility.id} value={facility.id}>
                          {facility.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isPrimary" />{' '}
                    {t('Employees.detail.setPrimaryFacility')}
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="facility-valid-from"
                      name="validFrom"
                      label={t('Employees.detail.validFrom')}
                      type="date"
                    />
                    <Field
                      id="facility-valid-until"
                      name="validUntil"
                      label={t('Employees.detail.validUntil')}
                      type="date"
                    />
                  </div>
                  <Button type="submit" disabled={!writable || employee.status !== 'active'}>
                    {t('Employees.detail.assignFacilityAction')}
                  </Button>
                </form>
              ) : null}
            </div>
            <div className="grid content-start gap-3">
              <h3 className="font-semibold">{t('Employees.detail.teams')}</h3>
              {teamMemberships.length ? (
                teamMemberships.map((membership) => (
                  <article
                    key={membership.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{membership.teamName}</p>
                      <p className="text-sm text-slate-600">
                        {membership.role || t('Employees.detail.member')} ·{' '}
                        {dateRange(
                          membership.validFrom,
                          membership.validUntil,
                          locale,
                          t('Employees.detail.open'),
                          t('Employees.detail.unlimited'),
                        )}
                      </p>
                    </div>
                    <form action={unassignTeamAction}>
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="teamId" value={membership.teamId} />
                      <ConfirmSubmitButton
                        confirmation={t('Employees.detail.removeTeamConfirmation')}
                      >
                        {t('Employees.detail.remove')}
                      </ConfirmSubmitButton>
                    </form>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-600">{t('Employees.detail.noTeam')}</p>
              )}
              {teams.length ? (
                <form action={assignTeamAction} className="grid gap-3 rounded-md border p-3">
                  <input type="hidden" name="employeeId" value={id} />
                  <div className="grid gap-2">
                    <Label htmlFor="teamId">{t('Employees.detail.assignTeam')}</Label>
                    <select
                      id="teamId"
                      name="teamId"
                      className="h-10 rounded-md border bg-white px-3"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {t('Employees.detail.selectTeam')}
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
                    label={t('Employees.detail.teamRoleOptional')}
                    maxLength={80}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="team-valid-from"
                      name="validFrom"
                      label={t('Employees.detail.validFrom')}
                      type="date"
                    />
                    <Field
                      id="team-valid-until"
                      name="validUntil"
                      label={t('Employees.detail.validUntil')}
                      type="date"
                    />
                  </div>
                  <Button type="submit" disabled={!writable || employee.status !== 'active'}>
                    {t('Employees.detail.assignTeamAction')}
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
            {t('Employees.detail.organizationRequired')}
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
            {t('Employees.detail.qualifications')}
          </h2>
          <p className="text-sm text-slate-600">
            {t('Employees.detail.qualificationsDescription')}
          </p>
        </div>
        {employee.qualifications.length ? (
          <ul className="grid gap-2">
            {employee.qualifications.map((qualification) => {
              const revokedAt = qualification.revokedAt;
              const revokedDate = revokedAt ? formatDate(revokedAt, locale) : null;
              return (
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
                      {dateRange(
                        qualification.validFrom,
                        qualification.validUntil,
                        locale,
                        t('Employees.detail.open'),
                        t('Employees.detail.unlimited'),
                      )}
                      {qualification.issuer ? ` · ${qualification.issuer}` : ''}
                      {qualification.status === 'archived'
                        ? ` · ${t('Employees.detail.archived')}`
                        : ''}
                      {qualification.assignmentStatus === 'revoked'
                        ? ` · ${t('Employees.detail.qualificationRevoked')}`
                        : ''}
                      {revokedDate
                        ? ` · ${t('Employees.detail.qualificationRevokedAt', { date: revokedDate })}`
                        : ''}
                    </p>
                  </div>
                  {qualification.assignmentStatus === 'active' ? (
                    <form action={removeQualificationAction}>
                      <input type="hidden" name="employeeId" value={id} />
                      <input
                        type="hidden"
                        name="qualificationId"
                        value={qualification.qualificationId}
                      />
                      <ConfirmSubmitButton
                        confirmation={t('Employees.detail.removeQualificationConfirmation')}
                      >
                        {t('Employees.detail.remove')}
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('Employees.detail.noQualifications')}</p>
        )}
        {qualifications.length ? (
          <form action={assignQualificationAction} className="grid gap-3 rounded-md border p-3">
            <input type="hidden" name="employeeId" value={id} />
            <div className="grid gap-2">
              <Label htmlFor="qualificationId">{t('Employees.detail.addQualification')}</Label>
              <select
                id="qualificationId"
                name="qualificationId"
                className="h-10 rounded-md border bg-white px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {t('Employees.detail.selectQualification')}
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
              <Field
                id="qualification-valid-from"
                name="validFrom"
                label={t('Employees.detail.validFrom')}
                type="date"
              />
              <Field
                id="qualification-valid-until"
                name="validUntil"
                label={t('Employees.detail.validUntil')}
                type="date"
              />
              <Field
                id="qualification-issuer"
                name="issuer"
                label={t('Employees.detail.issuer')}
                maxLength={160}
              />
            </div>
            <Button type="submit" disabled={!writable}>
              {t('Employees.detail.saveQualification')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">
            <Link className="underline" href="/administration/qualifications">
              {t('Employees.detail.manageQualifications')}
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
            {t('Employees.detail.skills')}
          </h2>
          <p className="text-sm text-slate-600">{t('Employees.detail.skillsDescription')}</p>
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
                  {skill.status === 'archived' ? ` · ${t('Employees.detail.archived')}` : ''}
                </span>
                {skill.status === 'active' ? (
                  <form action={removeSkillAction}>
                    <input type="hidden" name="employeeId" value={id} />
                    <input type="hidden" name="skillId" value={skill.skillId} />
                    <ConfirmSubmitButton
                      confirmation={t('Employees.detail.removeSkillConfirmation')}
                    >
                      {t('Employees.detail.remove')}
                    </ConfirmSubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('Employees.detail.noSkills')}</p>
        )}
        {skills.length ? (
          <form
            action={assignSkillAction}
            className="flex flex-wrap items-end gap-3 rounded-md border p-3"
          >
            <input type="hidden" name="employeeId" value={id} />
            <div className="grid gap-2">
              <Label htmlFor="skillId">{t('Employees.detail.addSkill')}</Label>
              <select
                id="skillId"
                name="skillId"
                className="h-10 rounded-md border bg-white px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {t('Employees.detail.selectSkill')}
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
              {t('Employees.detail.assignSkill')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">
            <Link className="underline" href="/administration/qualifications">
              {t('Employees.detail.manageSkills')}
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
              {t('Employees.detail.access')}
            </h2>
            <p className="text-sm text-slate-600">{t('Employees.detail.accessDescription')}</p>
          </div>
          <Link className="text-sm text-blue-900 underline" href="/administration/users">
            {t('Employees.detail.manageAccess')}
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
              {employee.linkedUser.email ?? t('Employees.detail.noEmail')} ·{' '}
              {t('Employees.detail.tenantMembership')}{' '}
              {t(statusLabelKey(employee.linkedUser.membershipStatus))}
            </p>
            <form action={unlinkEmployeeUserAction}>
              <input type="hidden" name="employeeId" value={id} />
              <ConfirmSubmitButton confirmation={t('Employees.detail.unlinkConfirmation')}>
                {t('Employees.detail.unlinkUser')}
              </ConfirmSubmitButton>
            </form>
          </div>
        ) : linkableUsersResult.error ? (
          <p className="text-sm text-slate-600">
            {t(errorMessageKey(linkableUsersResult.error.code))}
          </p>
        ) : linkableUsersResult.data?.length ? (
          <form action={linkEmployeeUserAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="employeeId" value={id} />
            <div className="grid gap-2">
              <Label htmlFor="userId">{t('Employees.detail.linkActiveUser')}</Label>
              <select
                id="userId"
                name="userId"
                className="h-10 rounded-md border bg-white px-3"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {t('Employees.detail.selectUser')}
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
              {t('Employees.detail.linkUser')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">{t('Employees.detail.noLinkableUser')}</p>
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

function SelectField({
  label,
  name,
  defaultValue,
  required = false,
  children,
}: Readonly<{
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  children: import('react').ReactNode;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="h-10 rounded-md border bg-white px-3"
      >
        {children}
      </select>
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

function dateRange(
  from: string | null,
  until: string | null,
  locale: Locale,
  open: string,
  unlimited: string,
): string {
  if (!from && !until) return unlimited;
  return `${formatDate(from, locale) ?? open} — ${formatDate(until, locale) ?? open}`;
}

function employeeVisitRange(): { scheduleNow: Date; scheduleFrom: Date; scheduleUntil: Date } {
  const scheduleNow = new Date();
  return {
    scheduleNow,
    scheduleFrom: new Date(scheduleNow.getTime() - 30 * 24 * 60 * 60 * 1000),
    scheduleUntil: new Date(scheduleNow.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}
