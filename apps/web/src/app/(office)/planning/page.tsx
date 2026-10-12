import { Textarea } from '@care/ui';
import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import { PageHeader } from '@app/web/components/page-patterns';
import { FilterDisclosure } from '@app/web/components/filter-disclosure';
import { formatCurrency, formatLongDate, formatTime } from '@app/web/i18n/format';
import type { Locale } from '@app/web/i18n/config';
import { visitStatusKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import {
  applySuggestedTourOrderAction,
  createTourAction,
  createVisitAction,
  estimateTourRouteAction,
  publishTourAction,
  suggestTourOrderAction,
  updateTourStopsAction,
} from './actions';

type SearchParams = Promise<{
  date?: string;
  view?: string;
  page?: string;
  clientId?: string;
  admissionCaseId?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  status?: string;
  assigned?: string;
  serviceDefinitionId?: string;
  estimateClientId?: string;
  estimateServiceId?: string;
  estimateDate?: string;
  estimateQuantity?: string;
  error?: string;
  updated?: string;
  tourId?: string;
  suggestedTourId?: string;
  suggestedOrder?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusValues = ['planned', 'confirmed', 'cancelled'] as const;

type AdmissionPlanningContext = {
  id: string;
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  version: number;
  stage: string;
  firstName: string;
  lastName: string;
  requestedServices: string[];
  serviceLocation: string | null;
  assessment: {
    requestedServices: string[];
    preferredDays: string[];
    visitsPerWeek: number | null;
    preferredTimeStart: string | null;
    preferredTimeEnd: string | null;
    accessibility: string;
    preferences: string;
    organizationalNotes: string;
  } | null;
};

export default async function PlanningPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const view = query.view === 'day' ? 'day' : 'week';
  const selectedDate = validDate(query.date) ?? todayInBerlin();
  const page = positivePage(query.page);
  const requestedClientId = validUuid(query.clientId);
  const employeeId = validUuid(query.employeeId);
  const requestedOrganizationId = validUuid(query.organizationId);
  const requestedFacilityId = validUuid(query.facilityId);
  const requestedAdmissionCaseId = query.admissionCaseId?.trim();
  const admissionCaseId = validUuid(requestedAdmissionCaseId);
  const teamId = validUuid(query.teamId);
  const serviceDefinitionId = validUuid(query.serviceDefinitionId);
  const estimateClientId = validUuid(query.estimateClientId);
  const estimateServiceId = validUuid(query.estimateServiceId);
  const estimateDate = validDate(query.estimateDate) ?? selectedDate;
  const estimateQuantity = validQuantity(query.estimateQuantity) ?? '1';
  const status = statusValues.find((value) => value === query.status);
  const assigned =
    query.assigned === 'assigned' || query.assigned === 'unassigned' ? query.assigned : 'all';
  const period = view === 'day' ? dayPeriod(selectedDate) : weekPeriod(selectedDate);
  const requestRange = apiRange(period.start, period.endExclusive);

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const admissionResult =
    admissionCaseId && hasPermission(permissions, 'onboarding.read')
      ? await api.GET('/api/v1/onboarding/cases/{id}', {
          params: { path: { id: admissionCaseId }, header },
        })
      : null;
  const admission = admissionResult?.data as unknown as AdmissionPlanningContext | undefined;
  const admissionHandoffRequested = requestedAdmissionCaseId !== undefined;
  const admissionCaseVisible = Boolean(
    admission &&
    admission.clientId &&
    hasPermission(permissions, 'onboarding.manage') &&
    ['preparation', 'ready_for_admission', 'admitted'].includes(admission.stage) &&
    !['declined', 'withdrawn'].includes(admission.stage) &&
    (!requestedClientId || requestedClientId === admission.clientId),
  );
  const onboardingT = await getTranslations('Onboarding');
  const get = api.GET;
  const linkedClientResult =
    admissionCaseVisible && hasPermission(permissions, 'client.read')
      ? await get('/api/v1/clients/{id}', {
          params: { path: { id: admission!.clientId! }, header },
        })
      : null;
  const admissionContextUsable = Boolean(
    admissionCaseVisible && linkedClientResult?.data?.status === 'active',
  );
  const clientId = admissionContextUsable ? admission!.clientId! : requestedClientId;
  const organizationId = admissionContextUsable
    ? admission!.organizationId
    : requestedOrganizationId;
  const facilityId = admissionContextUsable
    ? (admission!.facilityId ?? undefined)
    : requestedFacilityId;
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

  const canCreate = hasPermission(permissions, 'schedule.create');
  const canAssign = hasPermission(permissions, 'schedule.assign');
  const canEstimate = hasPermission(permissions, 'benefits.read');
  const estimateResult =
    canEstimate && estimateClientId && estimateServiceId && validQuantity(query.estimateQuantity)
      ? await get('/api/v1/clients/{clientId}/budgets/estimate', {
          params: {
            path: { clientId: estimateClientId },
            query: {
              serviceId: estimateServiceId,
              serviceDate: estimateDate,
              quantity: estimateQuantity,
            },
            header,
          },
        })
      : null;
  const visits = (visitResult.data?.items ?? []).filter((visit) => {
    const localDate = dateAtZone(visit.plannedStart, visit.timezone);
    return localDate >= period.start && localDate < period.endExclusive;
  });
  const worklistResult = hasPermission(permissions, 'schedule.read')
    ? await get('/api/v1/scheduling/worklist', {
        params: {
          query: {
            from: requestRange.from,
            until: requestRange.until,
            page,
            pageSize: 100,
            sortBy: 'plannedStart',
            sortOrder: 'asc',
            ...(employeeId ? { employeeId } : {}),
            ...(organizationId ? { organizationId } : {}),
            ...(facilityId ? { facilityId } : {}),
            ...(teamId ? { teamId } : {}),
            ...(status ? { status } : {}),
            ...(assigned === 'all'
              ? {}
              : { unassigned: assigned === 'unassigned' ? 'true' : 'false' }),
          },
          header,
        },
      })
    : null;
  const conflictsByVisit = new Map(
    (worklistResult?.data?.items ?? []).map((item) => [item.visit.id, item.conflicts]),
  );
  const visitsByDate = new Map<string, typeof visits>();
  for (const visit of visits) {
    const localDate = dateAtZone(visit.plannedStart, visit.timezone);
    visitsByDate.set(localDate, [...(visitsByDate.get(localDate) ?? []), visit]);
  }
  const days = datesBetween(period.start, period.endExclusive);
  const clients = [...(clientResult.data?.items ?? [])];
  if (
    linkedClientResult?.data &&
    !clients.some((client) => client.id === linkedClientResult.data!.id)
  ) {
    clients.push({
      ...linkedClientResult.data,
      organizationName: null,
      facilityName: null,
      currentPflegegrad: null,
    });
  }
  const employees = employeeResult.data?.items ?? [];
  const organizations = organizationResult.data ?? [];
  const facilities = facilityResult.data ?? [];
  const teams = teamResult.data ?? [];
  const services = serviceResult.data?.items ?? [];
  const requestedServiceNames = admission
    ? admission.assessment?.requestedServices.length
      ? admission.assessment.requestedServices
      : admission.requestedServices
    : [];
  const preselectedServiceIds = services
    .filter((service) =>
      requestedServiceNames.some((requested) => {
        const value = requested.trim().toLocaleLowerCase();
        return [service.code, service.name].some(
          (candidate) => candidate.trim().toLocaleLowerCase() === value,
        );
      }),
    )
    .map((service) => service.id);
  const weekdayLabels: Record<string, string> = {
    monday: t('Employees.detail.weekdays.monday'),
    tuesday: t('Employees.detail.weekdays.tuesday'),
    wednesday: t('Employees.detail.weekdays.wednesday'),
    thursday: t('Employees.detail.weekdays.thursday'),
    friday: t('Employees.detail.weekdays.friday'),
    saturday: t('Employees.detail.weekdays.saturday'),
    sunday: t('Employees.detail.weekdays.sunday'),
  };
  const planningNote = admission
    ? [
        admission.serviceLocation
          ? `${onboardingT('serviceLocation')}: ${admission.serviceLocation}`
          : '',
        admission.assessment?.accessibility
          ? `${onboardingT('accessibility')}: ${admission.assessment.accessibility}`
          : '',
        admission.assessment?.preferences
          ? `${onboardingT('preferences')}: ${admission.assessment.preferences}`
          : '',
        admission.assessment?.preferredDays.length
          ? `${onboardingT('preferredDays')}: ${admission.assessment.preferredDays.map((day) => weekdayLabels[day] ?? day).join(', ')}`
          : '',
        admission.assessment?.visitsPerWeek
          ? `${onboardingT('visitsPerWeek')}: ${admission.assessment.visitsPerWeek}`
          : '',
        admission.assessment?.organizationalNotes
          ? `${onboardingT('organizationalNotes')}: ${admission.assessment.organizationalNotes}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 2000)
    : '';
  const selectedDayVisits = visitsByDate.get(selectedDate) ?? [];
  const employeeVisitGroups = new Map<string, typeof selectedDayVisits>();
  for (const visit of selectedDayVisits) {
    for (const assignment of visit.assignments) {
      const group = employeeVisitGroups.get(assignment.employeeId) ?? [];
      group.push(visit);
      employeeVisitGroups.set(assignment.employeeId, group);
    }
  }
  const tourRows =
    view === 'day' && canAssign
      ? await Promise.all(
          [...employeeVisitGroups].map(async ([tourEmployeeId]) => {
            const result = await get('/api/v1/scheduling/tours', {
              params: {
                query: {
                  employeeId: tourEmployeeId,
                  from: selectedDate,
                  until: addDays(selectedDate, 1),
                },
                header,
              },
            });
            return { employeeId: tourEmployeeId, tours: result.data ?? [], error: result.error };
          }),
        )
      : [];
  const toursByEmployee = new Map(tourRows.map((row) => [row.employeeId, row.tours]));
  const selectedTourId = validUuid(query.tourId);
  const selectedTourResult =
    selectedTourId && canAssign
      ? await get('/api/v1/scheduling/tours/{id}', {
          params: { path: { id: selectedTourId }, header },
        })
      : null;
  const suggestedTourId = validUuid(query.suggestedTourId);
  const suggestedOrder = (query.suggestedOrder ?? '')
    .split(',')
    .map((value) => validUuid(value))
    .filter((value): value is string => value !== null);
  const conflictMessages: Record<string, string> = {
    missing_assignment: t('Planning.conflicts.missing_assignment'),
    employee_overlap: t('Planning.conflicts.employee_overlap'),
    employee_absence: t('Planning.conflicts.employee_absence'),
    outside_employee_availability: t('Planning.conflicts.outside_employee_availability'),
    employee_availability_unknown: t('Planning.conflicts.employee_availability_unknown'),
    insufficient_travel_time: t('Planning.conflicts.insufficient_travel_time'),
    travel_feasibility_unknown: t('Planning.conflicts.travel_feasibility_unknown'),
    client_overlap: t('Planning.conflicts.client_overlap'),
    employee_preference: t('Planning.conflicts.employee_preference'),
    client_preference: t('Planning.conflicts.client_preference'),
    substitution_awaiting_confirmation: t('Planning.conflicts.substitution_awaiting_confirmation'),
    unpublished_schedule_changes: t('Planning.conflicts.unpublished_schedule_changes'),
  };
  const openCount = visits.filter((visit) => visit.assignments.length === 0).length;
  const error = query.error ?? visitResult.error?.code;
  const estimateError = estimateResult?.error?.code;
  const estimate = estimateResult?.data;

  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader
        eyebrow={t('Navigation.office')}
        title={t('Planning.title')}
        description={t('Planning.description')}
        actions={
          <>
            <Button asChild variant={view === 'week' ? 'default' : 'secondary'} size="sm">
              <Link href={viewHref({ ...query, date: selectedDate, view: 'week', page: '1' })}>
                {t('Planning.week')}
              </Link>
            </Button>
            <Button asChild variant={view === 'day' ? 'default' : 'secondary'} size="sm">
              <Link href={viewHref({ ...query, date: selectedDate, view: 'day', page: '1' })}>
                {t('Planning.day')}
              </Link>
            </Button>
          </>
        }
      />

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {admissionHandoffRequested && !admissionContextUsable ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {onboardingT('schedulingContextUnavailable')}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t(planningUpdateKey(query.updated))}
        </p>
      ) : null}

      <section
        aria-label={t('Planning.calendarNavigation')}
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
      >
        <Button asChild variant="secondary">
          <Link
            href={viewHref({
              ...query,
              date: addDays(period.start, view === 'day' ? -1 : -7),
              page: '1',
            })}
          >
            {t('Planning.previous')}
          </Link>
        </Button>
        <h2 className="text-lg font-semibold">
          {view === 'day'
            ? formatDay(period.start, locale)
            : `${formatDay(period.start, locale)} – ${formatDay(addDays(period.endExclusive, -1), locale)}`}
        </h2>
        <Button asChild variant="secondary">
          <Link
            href={viewHref({
              ...query,
              date: addDays(period.start, view === 'day' ? 1 : 7),
              page: '1',
            })}
          >
            {t('Planning.next')}
          </Link>
        </Button>
      </section>

      <FilterDisclosure title={t('Planning.filters')}>
        <form
          method="get"
          className="grid min-w-0 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <input type="hidden" name="view" value={view} />
          <Field label={t('Planning.date')} name="date" type="date" defaultValue={selectedDate} />
          <SelectField
            label={t('Planning.organization')}
            name="organizationId"
            defaultValue={organizationId ?? ''}
          >
            <option value="">{t('Planning.allOrganizations')}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('Planning.facility')}
            name="facilityId"
            defaultValue={facilityId ?? ''}
          >
            <option value="">{t('Planning.allFacilities')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Common.fields.team')} name="teamId" defaultValue={teamId ?? ''}>
            <option value="">{t('Planning.allTeams')}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('Planning.employees')}
            name="employeeId"
            defaultValue={employeeId ?? ''}
          >
            <option value="">{t('Planning.allEmployees')}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.preferredName || employee.firstName} {employee.lastName}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Planning.status')} name="status" defaultValue={status ?? ''}>
            <option value="">{t('Planning.allStatuses')}</option>
            <option value="planned">{t('Common.status.planned')}</option>
            <option value="confirmed">{t('Common.status.confirmed')}</option>
            <option value="cancelled">{t('Common.status.cancelled')}</option>
          </SelectField>
          <SelectField label={t('Planning.assignment')} name="assigned" defaultValue={assigned}>
            <option value="all">{t('Planning.allVisits')}</option>
            <option value="unassigned">{t('Planning.openVisits')}</option>
            <option value="assigned">{t('Planning.assigned')}</option>
          </SelectField>
          <SelectField
            label={t('Planning.service')}
            name="serviceDefinitionId"
            defaultValue={serviceDefinitionId ?? ''}
          >
            <option value="">{t('Planning.allServices')}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.code} · {service.name}
              </option>
            ))}
          </SelectField>
          {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary">
              {t('Planning.applyFilters')}
            </Button>
            <Button asChild variant="link">
              <Link href="/planning">{t('Planning.resetFilters')}</Link>
            </Button>
          </div>
        </form>
      </FilterDisclosure>

      {canEstimate ? (
        <section
          aria-labelledby="budget-estimate-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <div className="grid gap-1">
            <h2 id="budget-estimate-title" className="text-xl font-semibold">
              {t('Benefits.planningEstimateTitle')}
            </h2>
            <p className="text-sm text-slate-700">{t('Benefits.planningEstimateDescription')}</p>
          </div>
          <form method="get" className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="date" value={selectedDate} />
            <input type="hidden" name="view" value={view} />
            <SelectField
              label={t('Benefits.planningEstimateClient')}
              name="estimateClientId"
              defaultValue={estimateClientId ?? ''}
              required
            >
              <option value="">{t('Planning.selectClient')}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.preferredName || client.firstName} {client.lastName}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('Benefits.planningEstimateService')}
              name="estimateServiceId"
              defaultValue={estimateServiceId ?? ''}
              required
            >
              <option value="">{t('Planning.allServices')}</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.code} · {service.name} ({service.unit})
                </option>
              ))}
            </SelectField>
            <Field
              label={t('Benefits.planningEstimateDate')}
              name="estimateDate"
              type="date"
              defaultValue={estimateDate}
              required
            />
            <Field
              label={t('Benefits.planningEstimateQuantity')}
              name="estimateQuantity"
              type="number"
              min="0.001"
              step="0.001"
              defaultValue={estimateQuantity}
              required
            />
            <Button type="submit" className="w-fit">
              {t('Benefits.showEstimate')}
            </Button>
          </form>
          {estimateError ? (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
              {t(errorMessageKey(estimateError))}
            </p>
          ) : null}
          {estimate ? (
            <div className="grid gap-3 rounded-md bg-blue-50 p-4 text-sm text-blue-950">
              <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label={t('Benefits.estimatedCost')}
                  value={
                    estimate.serviceAmountCents === null
                      ? t('Benefits.priceUnknown')
                      : money(estimate.serviceAmountCents, locale)
                  }
                />
                <Metric
                  label={t('Benefits.available45b')}
                  value={money(estimate.estimated45bAvailableCents, locale)}
                />
                <Metric
                  label={t('Benefits.confirmedRemaining')}
                  value={money(estimate.confirmed45bAvailableCents, locale)}
                />
                <Metric
                  label={t('Benefits.estimated45bAfter')}
                  value={
                    estimate.estimated45bAfterCents === null
                      ? t('Benefits.unknownBalance')
                      : money(estimate.estimated45bAfterCents, locale)
                  }
                />
              </dl>
              <p>
                {t('Benefits.plannedEligible')}: {money(estimate.plannedEligible45bCents, locale)}.{' '}
                {t('Benefits.plannedNotReserved')}
              </p>
              {estimate.benefitOptions.length ? (
                <ul className="grid gap-1">
                  {estimate.benefitOptions.map((option) => (
                    <li key={option.entitlementId}>
                      {option.benefitType === 'entlastungsbetrag_45b'
                        ? t('Benefits.benefitTypes.entlastungsbetrag_45b')
                        : option.benefitType === 'umwandlungsanspruch_45a_4'
                          ? t('Benefits.benefitTypes.umwandlungsanspruch_45a_4')
                          : option.benefitType === 'private'
                            ? t('Benefits.benefitTypes.private')
                            : t('Benefits.benefitTypes.other')}
                      :{' '}
                      {option.eligible
                        ? t('Benefits.eligible')
                        : t('Benefits.errors.serviceNotEligible')}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t('Benefits.noEstimateEntitlement')}</p>
              )}
            </div>
          ) : null}
          {!clients.length || !services.length ? (
            <p className="text-sm text-slate-600">{t('Benefits.noEstimateOptions')}</p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="calendar-title" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="calendar-title" className="text-xl font-semibold">
            {t(view === 'week' ? 'Planning.weekOverview' : 'Planning.dayOverview')}
          </h2>
          <p className="text-sm text-slate-600">
            {t('Planning.visitCount', { count: visitResult.data?.total ?? 0 })} ·{' '}
            {t('Planning.openCount', { count: openCount })}
          </p>
        </div>
        {visitResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
            {t(errorMessageKey(visitResult.error.code))}
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
                  {formatDay(day, locale)}
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
                            {formatTime(visit.plannedStart, locale, visit.timezone)}–
                            {formatTime(visit.plannedEnd, locale, visit.timezone)}
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
                                : t('Planning.open')}{' '}
                              · {visit.facilityName}
                            </span>
                          </span>
                          <span className="self-start rounded-full border px-2 py-1 text-xs">
                            {t(visitStatusKey(visit.status))}
                          </span>
                          {(conflictsByVisit.get(visit.id)?.length ?? 0) > 0 ? (
                            <span className="sm:col-span-3">
                              <span className="flex flex-wrap gap-1 pt-1">
                                {(conflictsByVisit.get(visit.id) ?? []).map((conflict, index) => (
                                  <span
                                    key={`${conflict.code}-${conflict.relatedVisitId ?? index}`}
                                    className={
                                      'rounded-full px-2 py-1 text-xs ' +
                                      (conflict.severity === 'blocking'
                                        ? 'bg-red-100 text-red-900'
                                        : 'bg-amber-100 text-amber-900')
                                    }
                                  >
                                    {conflictMessages[conflict.code] ?? conflict.code}
                                  </span>
                                ))}
                              </span>
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-600">{t('Planning.noVisits')}</p>
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
                  {t('Planning.previousPage')}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={viewHref({ ...query, date: selectedDate, page: String(page + 1) })}>
                {t('Planning.moreVisits')}
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      {view === 'day' && canAssign ? (
        <section aria-labelledby="tour-planning-title" className="grid gap-4">
          <div>
            <h2 id="tour-planning-title" className="text-xl font-semibold">
              {t('Planning.tourPlanning')}
            </h2>
            <p className="text-sm text-slate-600">{t('Planning.tourPlanningDescription')}</p>
          </div>
          {employeeVisitGroups.size ? (
            [...employeeVisitGroups].map(([tourEmployeeId, employeeVisits]) => {
              const listedTour = toursByEmployee.get(tourEmployeeId)?.[0];
              const tour =
                selectedTourId === listedTour?.id && selectedTourResult?.data
                  ? selectedTourResult.data
                  : null;
              const employeeName = employeeVisits[0]?.assignments.find(
                (assignment) => assignment.employeeId === tourEmployeeId,
              )?.employeeDisplayName;
              const tourConflicts = tour
                ? tour.stops.flatMap((stop) =>
                    (conflictsByVisit.get(stop.visitId) ?? []).filter(
                      (conflict) => conflict.severity === 'blocking',
                    ),
                  )
                : [];
              return (
                <section key={tourEmployeeId} className="grid gap-3 rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-semibold">
                      {employeeName ?? t('Planning.employeeTour')}
                    </h3>
                    {listedTour ? (
                      <Link
                        className="text-sm font-medium text-blue-800 underline"
                        href={viewHref({
                          ...query,
                          date: selectedDate,
                          view: 'day',
                          tourId: listedTour.id,
                        })}
                      >
                        {t('Planning.openTour')}
                      </Link>
                    ) : null}
                  </div>
                  {!listedTour ? (
                    <form action={createTourAction} className="grid gap-2">
                      <input type="hidden" name="employeeId" value={tourEmployeeId} />
                      <input type="hidden" name="localDate" value={selectedDate} />
                      <input type="hidden" name="timezone" value={employeeVisits[0]!.timezone} />
                      {employeeVisits.map((visit) => (
                        <input key={visit.id} type="hidden" name="visitIds" value={visit.id} />
                      ))}
                      <p className="text-sm text-slate-600">
                        {t('Planning.tourVisitCount', { count: employeeVisits.length })}
                      </p>
                      <Button type="submit" className="w-fit">
                        {t('Planning.createTour')}
                      </Button>
                    </form>
                  ) : tour ? (
                    <div className="grid gap-3">
                      <p className="text-sm text-slate-600">
                        {tour.status === 'published'
                          ? t('Planning.tourPublished')
                          : t('Planning.tourDraft')}
                        {' · '}
                        {t('Planning.tourVersion', { version: tour.version })}
                        {tour.latestPublication
                          ? ` · ${t('Planning.latestPublishedVersion', { version: tour.latestPublication.version })}`
                          : ''}
                      </p>
                      {tour.stops.length ? (
                        <ol className="grid gap-2">
                          {tour.stops.map((stop) => {
                            const visit = selectedDayVisits.find(
                              (item) => item.id === stop.visitId,
                            );
                            return (
                              <li key={stop.id} className="rounded-md border p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Link
                                    className="font-medium text-blue-900 underline"
                                    href={`/visits/${stop.visitId}`}
                                  >
                                    {visit?.clientDisplayName ?? stop.visitId}
                                  </Link>
                                  <span className="text-sm tabular-nums">
                                    {formatTime(stop.plannedStart, locale, stop.timezone)}–
                                    {formatTime(stop.plannedEnd, locale, stop.timezone)}
                                    {' · '}
                                    {t('Planning.serviceDuration', {
                                      minutes: Math.round(
                                        (new Date(stop.plannedEnd).getTime() -
                                          new Date(stop.plannedStart).getTime()) /
                                          60_000,
                                      ),
                                    })}
                                  </span>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">
                                  {stop.estimatedTravelMinutes !== null
                                    ? t('Planning.travelEstimate', {
                                        minutes: stop.estimatedTravelMinutes,
                                      })
                                    : stop.sequence > 1 && stop.routeStatus === 'unknown'
                                      ? t('Planning.travelUnknown')
                                      : stop.sequence > 1 && stop.routeStatus === 'unresolved'
                                        ? t('Planning.routeUnresolved')
                                        : stop.sequence > 1 && stop.routeStatus === 'unavailable'
                                          ? t('Planning.routeUnavailable')
                                          : ''}
                                  {stop.estimatedDistanceMeters !== null
                                    ? ` · ${t('Planning.travelDistance', { meters: stop.estimatedDistanceMeters })}`
                                    : ''}
                                </p>
                                {visit?.services.length ? (
                                  <p className="mt-1 text-sm text-slate-600">
                                    {visit.services
                                      .map((service) => service.serviceName)
                                      .join(' · ')}
                                  </p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="text-sm text-red-800">{t('Planning.emptyTour')}</p>
                      )}
                      {suggestedTourId === tour.id && suggestedOrder.length ? (
                        <form
                          action={applySuggestedTourOrderAction}
                          className="grid gap-2 rounded-md bg-blue-50 p-3"
                        >
                          <input type="hidden" name="tourId" value={tour.id} />
                          <input type="hidden" name="expectedVersion" value={tour.version} />
                          <input type="hidden" name="localDate" value={tour.localDate} />
                          <input type="hidden" name="employeeId" value={tour.employeeId} />
                          {suggestedOrder.map((visitId) => (
                            <input key={visitId} type="hidden" name="visitIds" value={visitId} />
                          ))}
                          <p className="text-sm">{t('Planning.suggestedOrderReady')}</p>
                          <Button type="submit" variant="secondary" className="w-fit">
                            {t('Planning.useSuggestedOrder')}
                          </Button>
                        </form>
                      ) : null}
                      <RHFActionForm
                        action={updateTourStopsAction}
                        className="grid gap-3 rounded-md border p-3"
                      >
                        <input type="hidden" name="tourId" value={tour.id} />
                        <input type="hidden" name="expectedVersion" value={tour.version} />
                        <input type="hidden" name="localDate" value={tour.localDate} />
                        <input type="hidden" name="employeeId" value={tour.employeeId} />
                        {tour.stops.map((stop) => (
                          <div key={stop.id} className="grid gap-1 sm:grid-cols-[1fr_1fr]">
                            <Label htmlFor={`tour-stop-${stop.id}`}>
                              {t('Planning.stopLabel', { sequence: stop.sequence })}
                            </Label>
                            <NativeSelect
                              id={`tour-stop-${stop.id}`}
                              name="visitId"
                              defaultValue={stop.visitId}
                              selectClassName="h-10 rounded-md border bg-white px-3 text-sm"
                              className="w-full"
                            >
                              {tour.stops.map((candidate) => (
                                <option key={candidate.visitId} value={candidate.visitId}>
                                  {selectedDayVisits.find((item) => item.id === candidate.visitId)
                                    ?.clientDisplayName ?? candidate.visitId}
                                </option>
                              ))}
                            </NativeSelect>
                            <input
                              type="hidden"
                              name="dispatcherNote"
                              value={stop.dispatcherNote ?? ''}
                            />
                          </div>
                        ))}
                        <Button type="submit" variant="secondary" className="w-fit">
                          {t('Planning.saveTourOrder')}
                        </Button>
                      </RHFActionForm>
                      <div className="flex flex-wrap gap-2">
                        <form action={suggestTourOrderAction}>
                          <input type="hidden" name="tourId" value={tour.id} />
                          <input type="hidden" name="localDate" value={tour.localDate} />
                          <input type="hidden" name="employeeId" value={tour.employeeId} />
                          <Button type="submit" variant="secondary">
                            {t('Planning.suggestOrder')}
                          </Button>
                        </form>
                        <form action={estimateTourRouteAction}>
                          <input type="hidden" name="tourId" value={tour.id} />
                          <input type="hidden" name="expectedVersion" value={tour.version} />
                          <input type="hidden" name="localDate" value={tour.localDate} />
                          <input type="hidden" name="employeeId" value={tour.employeeId} />
                          <Button type="submit" variant="secondary">
                            {t('Planning.estimateTravel')}
                          </Button>
                        </form>
                        <form action={publishTourAction}>
                          <input type="hidden" name="tourId" value={tour.id} />
                          <input type="hidden" name="expectedVersion" value={tour.version} />
                          <input type="hidden" name="localDate" value={tour.localDate} />
                          <input type="hidden" name="employeeId" value={tour.employeeId} />
                          <Button type="submit" disabled={tourConflicts.length > 0}>
                            {t('Planning.publishTour')}
                          </Button>
                        </form>
                      </div>
                    </div>
                  ) : selectedTourResult?.error ? (
                    <p role="alert" className="text-sm text-red-800">
                      {t(errorMessageKey(selectedTourResult.error.code))}
                    </p>
                  ) : null}
                </section>
              );
            })
          ) : (
            <p className="rounded-lg border bg-white p-4 text-sm text-slate-600">
              {t('Planning.noAssignedVisitsForTour')}
            </p>
          )}
        </section>
      ) : null}

      {canCreate && (!admissionHandoffRequested || admissionContextUsable) ? (
        <section
          aria-labelledby="create-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <h2 id="create-title" className="text-xl font-semibold">
            {t('Planning.createTitle')}
          </h2>
          {admissionContextUsable && admission ? (
            <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm">
              <Link className="w-fit text-blue-800 underline" href={`/admissions/${admission.id}`}>
                {onboardingT('backToAdmission')}: {admission.firstName} {admission.lastName}
              </Link>
              {requestedServiceNames.length ? (
                <p>
                  {onboardingT('requestedServices')}: {requestedServiceNames.join(', ')}
                  {!preselectedServiceIds.length
                    ? ` · ${onboardingT('selectMatchingServices')}`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : null}
          {clients.length && services.length ? (
            <RHFActionForm action={createVisitAction} className="grid gap-4 md:grid-cols-2">
              {admissionContextUsable && admission ? (
                <>
                  <input type="hidden" name="admissionCaseId" value={admission.id} />
                  <input type="hidden" name="expectedAdmissionVersion" value={admission.version} />
                </>
              ) : null}
              <SelectField
                label={t('Planning.client')}
                name="clientId"
                required
                defaultValue={
                  admissionContextUsable ? (admission?.clientId ?? '') : (clientId ?? '')
                }
              >
                <option value="">{t('Planning.selectClient')}</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.preferredName || client.firstName} {client.lastName}
                  </option>
                ))}
              </SelectField>
              <Field
                label={t('Planning.date')}
                name="localDate"
                type="date"
                defaultValue={selectedDate}
                required
              />
              <Field
                label={t('Planning.start')}
                name="localStartTime"
                type="time"
                defaultValue={
                  admissionContextUsable && admission?.assessment?.preferredTimeStart
                    ? validTime(admission.assessment.preferredTimeStart, '08:00')
                    : '08:00'
                }
                required
              />
              <Field
                label={t('Planning.end')}
                name="localEndTime"
                type="time"
                defaultValue={
                  admissionContextUsable && admission?.assessment?.preferredTimeEnd
                    ? validTime(admission.assessment.preferredTimeEnd, '09:00')
                    : '09:00'
                }
                required
              />
              <SelectField
                label={t('Planning.services')}
                name="serviceDefinitionIds"
                multiple
                required
                defaultValue={admissionContextUsable ? preselectedServiceIds : []}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.code} · {service.name}
                  </option>
                ))}
              </SelectField>
              {canAssign ? (
                <SelectField label={t('Planning.employeesOptional')} name="employeeId">
                  <option value="">{t('Planning.doNotAssign')}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.preferredName || employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="visit-note">{t('Planning.planningNote')}</Label>
                <Textarea
                  id="visit-note"
                  name="note"
                  maxLength={2000}
                  defaultValue={admissionContextUsable ? planningNote : ''}
                  className="min-h-20 rounded-md border px-3 py-2"
                />
              </div>
              <Button type="submit" className="w-fit">
                {t('Planning.createVisit')}
              </Button>
            </RHFActionForm>
          ) : (
            <p className="text-sm text-slate-600">{t('Planning.createRequirements')}</p>
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
  min,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        min={min}
        step={step}
      />
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
  defaultValue?: string | string[];
  required?: boolean;
  multiple?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={name}>{label}</Label>
      <NativeSelect
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        multiple={multiple}
        size={multiple ? 4 : undefined}
        selectClassName="min-h-10 w-full min-w-0 rounded-md border bg-white px-3 py-2"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-blue-800">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function money(cents: number, locale: Locale): string {
  return formatCurrency(cents / 100, locale);
}

function validTime(value: string, fallback: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
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

function validQuantity(value: string | undefined): string | undefined {
  if (!value || !/^(0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value) || Number(value) <= 0) return undefined;
  return value;
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

function formatDay(value: string, locale: Locale): string {
  return formatLongDate(new Date(`${value}T12:00:00Z`), locale);
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

function planningUpdateKey(
  value: string | undefined,
):
  | 'Planning.saved'
  | 'Planning.updates.tour_created'
  | 'Planning.updates.tour_reordered'
  | 'Planning.updates.travel_estimated'
  | 'Planning.updates.tour_published' {
  if (value === 'tour_created') return 'Planning.updates.tour_created';
  if (value === 'tour_reordered') return 'Planning.updates.tour_reordered';
  if (value === 'travel_estimated') return 'Planning.updates.travel_estimated';
  if (value === 'tour_published') return 'Planning.updates.tour_published';
  return 'Planning.saved';
}
