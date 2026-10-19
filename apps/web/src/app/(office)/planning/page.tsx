import { getLocale, getTranslations } from 'next-intl/server';
import { CalendarPlus, Check, Clock3, UsersRound } from 'lucide-react';
import Link from 'next/link';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { FilterDisclosure } from '@app/web/components/filter-disclosure';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import {
  ScheduleCalendarGrid,
  ScheduleCalendarNavigation,
  type ScheduleCalendarBackgroundEventInput,
  type ScheduleCalendarEventInput,
  type ScheduleCalendarView,
} from '@app/web/components/schedule-calendar';
import { TourStopOrderForm } from '@app/web/components/tour-stop-order-form';
import type { Locale } from '@app/web/i18n/config';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatCurrency, formatLongDate, formatTime } from '@app/web/i18n/format';
import { visitStatusKey } from '@app/web/i18n/status';
import { dateRange } from '@app/web/lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { availabilityIntervalsBetween } from '@care/scheduling';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { Textarea } from '@care/ui/components/textarea';

import {
  applySuggestedTourOrderAction,
  createTourAction,
  createVisitAction,
  estimateTourRouteAction,
  publishTourAction,
  suggestTourOrderAction,
  updateVisitFromCalendarAction,
} from './actions';

type SearchParams = Promise<{
  date?: string;
  view?: string;
  page?: string;
  pageSize?: string;
  clientId?: string;
  admissionCaseId?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  status?: string;
  assigned?: string;
  serviceDefinitionId?: string;
  search?: string;
  estimateClientId?: string;
  estimateServiceId?: string;
  estimateDate?: string;
  estimateQuantity?: string;
  error?: string;
  updated?: string;
  tourId?: string;
  suggestedTourId?: string;
  suggestedOrder?: string;
  createStart?: string;
  createEnd?: string;
  createVisit?: string;
  sortBy?: string;
  sortOrder?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusValues = ['planned', 'confirmed', 'cancelled'] as const;
const scheduleViewValues = ['month', 'week', 'day', 'agenda'] as const;

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
  const view: ScheduleCalendarView =
    scheduleViewValues.find((value) => value === query.view) ??
    (query.view === 'list' ? 'agenda' : 'week');
  const selectedDate = validDate(query.date) ?? todayInBerlin();
  const page = view === 'agenda' ? positivePage(query.page) : 1;
  const requestedPageSize = Number(query.pageSize ?? '20');
  const pageSize =
    view === 'agenda'
      ? [10, 20, 50, 100].includes(requestedPageSize)
        ? requestedPageSize
        : 20
      : 100;
  const sortBy =
    query.sortBy === 'clientName' || query.sortBy === 'createdAt' ? query.sortBy : 'plannedStart';
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
  const requestedClientId = validUuid(query.clientId);
  const employeeId = validUuid(query.employeeId);
  const requestedOrganizationId = validUuid(query.organizationId);
  const requestedFacilityId = validUuid(query.facilityId);
  const requestedAdmissionCaseId = query.admissionCaseId?.trim();
  const admissionCaseId = validUuid(requestedAdmissionCaseId);
  const teamId = validUuid(query.teamId);
  const serviceDefinitionId = validUuid(query.serviceDefinitionId);
  const search = query.search?.trim().slice(0, 100) || undefined;
  const estimateClientId = validUuid(query.estimateClientId);
  const estimateServiceId = validUuid(query.estimateServiceId);
  const estimateDate = validDate(query.estimateDate) ?? selectedDate;
  const estimateQuantity = validQuantity(query.estimateQuantity) ?? '1';
  const status = statusValues.find((value) => value === query.status);
  const assigned =
    query.assigned === 'assigned' || query.assigned === 'unassigned' ? query.assigned : 'all';
  const period =
    view === 'day'
      ? dayPeriod(selectedDate)
      : view === 'month'
        ? monthVisiblePeriod(selectedDate)
        : weekPeriod(selectedDate);
  const plannerHref = viewHref({
    date: selectedDate,
    view,
    ...(view === 'agenda' ? { page, pageSize, sortBy, sortOrder } : {}),
    clientId: requestedClientId,
    admissionCaseId,
    employeeId,
    organizationId: requestedOrganizationId,
    facilityId: requestedFacilityId,
    teamId,
    status,
    assigned: assigned === 'all' ? undefined : assigned,
    serviceDefinitionId,
    search,
  });
  const visitHref = (visitId: string) =>
    `/visits/${visitId}?returnTo=${encodeURIComponent(plannerHref)}`;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const tenantId = header['X-Tenant-Id'];
  const permissions = await getPermissionGrants(api);
  const canCreate = hasPermission(permissions, 'schedule.create');
  const canReadSchedule = hasPermission(permissions, 'schedule.read');
  const canAssign = hasPermission(permissions, 'schedule.assign');
  const canEstimate = hasPermission(permissions, 'benefits.read');
  const canReadClient = hasPermission(permissions, 'client.read');
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
  const linkedClient = linkedClientResult?.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const admissionContextUsable = Boolean(admissionCaseVisible && linkedClient?.status === 'active');
  const clientId = admissionContextUsable ? admission!.clientId! : requestedClientId;
  const organizationId = admissionContextUsable
    ? admission!.organizationId
    : requestedOrganizationId;
  const facilityId = admissionContextUsable
    ? (admission!.facilityId ?? undefined)
    : requestedFacilityId;
  const [organizationResult, facilityResult] = await Promise.all([
    organizationId
      ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
      : Promise.resolve(null),
    facilityId
      ? get('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
      : Promise.resolve(null),
  ]);
  const selectedOrganization = organizationResult?.data as
    | components['schemas']['OrganizationResponseDto']
    | undefined;
  const selectedFacility = facilityResult?.data as
    | components['schemas']['FacilityResponseDto']
    | undefined;
  const calendarTimezone =
    selectedFacility?.timezone ?? selectedOrganization?.timezone ?? 'Europe/Berlin';
  const requestRange = apiRange(period.start, period.endExclusive, calendarTimezone);
  const visitFilters = {
    ...(clientId ? { clientId } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(facilityId ? { facilityId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(serviceDefinitionId ? { serviceDefinitionId } : {}),
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    ...(assigned === 'all'
      ? {}
      : { unassigned: assigned === 'unassigned' ? ('true' as const) : ('false' as const) }),
  };
  const fetchVisitPage = (from: string, until: string, requestedPage: number, limit: number) =>
    get('/api/v1/visits', {
      params: {
        query: {
          from,
          until,
          page: requestedPage,
          pageSize: limit,
          sortBy: view === 'agenda' ? sortBy : 'plannedStart',
          sortOrder: view === 'agenda' ? sortOrder : 'asc',
          ...visitFilters,
        },
        header,
      },
    });
  const visitLoad = (async () => {
    if (view === 'agenda') {
      const result = await fetchVisitPage(requestRange.from, requestRange.until, page, pageSize);
      return {
        data: result.data as components['schemas']['VisitListResponseDto'] | undefined,
        error: result.error,
      };
    }

    const allVisits = new Map<string, components['schemas']['VisitResponseDto']>();
    const chunkStarts = datesBetween(period.start, period.endExclusive);
    for (let index = 0; index < chunkStarts.length; index += 7) {
      const chunkStart = chunkStarts[index]!;
      const chunkEnd = chunkStarts[Math.min(index + 7, chunkStarts.length)] ?? period.endExclusive;
      const chunkRange = apiRange(chunkStart, chunkEnd, calendarTimezone);
      // oxlint-disable-next-line no-await-in-loop -- The first page supplies the total for this bounded chunk.
      const first = await fetchVisitPage(chunkRange.from, chunkRange.until, 1, 100);
      if (first.error || !first.data) return { data: undefined, error: first.error };
      first.data.items.forEach((visit) => allVisits.set(visit.id, visit));

      const pageCount = Math.ceil(first.data.total / first.data.pageSize);
      for (let batchStart = 2; batchStart <= pageCount; batchStart += 5) {
        // oxlint-disable-next-line no-await-in-loop -- Subsequent bounded batches depend on the first page's total.
        const pageResults = await Promise.all(
          Array.from({ length: Math.min(5, pageCount - batchStart + 1) }, (_, offset) =>
            fetchVisitPage(chunkRange.from, chunkRange.until, batchStart + offset, 100),
          ),
        );
        const failed = pageResults.find((result) => result.error || !result.data);
        if (failed) return { data: undefined, error: failed.error };
        pageResults.forEach((result) =>
          result.data?.items.forEach((visit) => allVisits.set(visit.id, visit)),
        );
      }
    }
    const items = [...allVisits.values()].sort(
      (left, right) =>
        left.plannedStart.localeCompare(right.plannedStart) || left.id.localeCompare(right.id),
    );
    return {
      data: { items, total: items.length, page: 1, pageSize: 100 },
      error: undefined,
    };
  })();
  const fetchWorklistPage = (from: string, until: string, requestedPage: number, limit: number) =>
    get('/api/v1/scheduling/worklist', {
      params: {
        query: {
          from,
          until,
          page: requestedPage,
          pageSize: limit,
          sortBy: 'plannedStart',
          sortOrder: 'asc',
          ...(employeeId ? { employeeId } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(teamId ? { teamId } : {}),
          ...(status ? { status } : {}),
          ...(search ? { search } : {}),
          ...(assigned === 'all'
            ? {}
            : { unassigned: assigned === 'unassigned' ? ('true' as const) : ('false' as const) }),
        },
        header,
      },
    });
  const worklistLoad = canReadSchedule
    ? (async () => {
        if (view === 'agenda') {
          return fetchWorklistPage(requestRange.from, requestRange.until, page, pageSize);
        }
        const items = new Map<string, components['schemas']['SchedulingWorklistItemDto']>();
        const chunkStarts = datesBetween(period.start, period.endExclusive);
        for (let index = 0; index < chunkStarts.length; index += 7) {
          const chunkRange = apiRange(
            chunkStarts[index]!,
            chunkStarts[Math.min(index + 7, chunkStarts.length)] ?? period.endExclusive,
            calendarTimezone,
          );
          // oxlint-disable-next-line no-await-in-loop -- The first page supplies the total for this bounded chunk.
          const first = await fetchWorklistPage(chunkRange.from, chunkRange.until, 1, 100);
          if (first.error || !first.data) return first;
          first.data.items.forEach((item) => items.set(item.visit.id, item));
          const pageCount = Math.ceil(first.data.total / first.data.pageSize);
          for (let batchStart = 2; batchStart <= pageCount; batchStart += 5) {
            // oxlint-disable-next-line no-await-in-loop -- Subsequent bounded batches depend on the first page's total.
            const pageResults = await Promise.all(
              Array.from({ length: Math.min(5, pageCount - batchStart + 1) }, (_, offset) =>
                fetchWorklistPage(chunkRange.from, chunkRange.until, batchStart + offset, 100),
              ),
            );
            const failed = pageResults.find((result) => result.error || !result.data);
            if (failed) return failed;
            pageResults.forEach((result) =>
              result.data?.items.forEach((item) => items.set(item.visit.id, item)),
            );
          }
        }
        const sortedItems = [...items.values()].sort(
          (left, right) =>
            left.visit.plannedStart.localeCompare(right.visit.plannedStart) ||
            left.visit.id.localeCompare(right.visit.id),
        );
        return {
          data: {
            items: sortedItems,
            total: sortedItems.length,
            page: 1,
            pageSize: 100,
          },
          error: undefined,
        };
      })()
    : Promise.resolve(null);
  const availabilityContextLoad =
    employeeId && view !== 'agenda' && canReadSchedule
      ? (async () => {
          const availabilityResult = await get('/api/v1/employees/{employeeId}/availability', {
            params: { path: { employeeId }, header },
          });
          if (availabilityResult.error || !availabilityResult.data) {
            return { availability: null, absences: [], failed: true };
          }
          const chunkStarts = datesBetween(period.start, period.endExclusive);
          const absenceResults = await Promise.all(
            Array.from({ length: Math.ceil(chunkStarts.length / 7) }, (_, index) => {
              const offset = index * 7;
              const range = apiRange(
                chunkStarts[offset]!,
                chunkStarts[Math.min(offset + 7, chunkStarts.length)] ?? period.endExclusive,
                calendarTimezone,
              );
              return get('/api/v1/employees/{employeeId}/unavailability', {
                params: { path: { employeeId }, query: range, header },
              });
            }),
          );
          if (absenceResults.some((result) => result.error || !result.data)) {
            return { availability: null, absences: [], failed: true };
          }
          const absences = new Map<string, components['schemas']['EmployeeAbsenceResponseDto']>();
          for (const result of absenceResults) {
            result.data?.absences.forEach((absence) => absences.set(absence.id, absence));
          }
          return {
            availability: availabilityResult.data.availability,
            absences: [...absences.values()].filter((absence) => absence.status === 'active'),
            failed: false,
          };
        })()
      : Promise.resolve(null);
  const [
    availabilityContext,
    visitResult,
    clientResult,
    employeeResult,
    teamResult,
    serviceResult,
  ] = await Promise.all([
    availabilityContextLoad,
    visitLoad,
    clientId && hasPermission(permissions, 'client.read')
      ? get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
      : Promise.resolve(null),
    employeeId && hasPermission(permissions, 'employee.read')
      ? get('/api/v1/employees/{id}', { params: { path: { id: employeeId }, header } })
      : Promise.resolve(null),
    teamId
      ? get('/api/v1/teams/{id}', { params: { path: { id: teamId }, header } })
      : Promise.resolve(null),
    canCreate && admissionContextUsable
      ? get('/api/v1/services', {
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
        })
      : Promise.resolve(null),
  ]);

  const visitData = visitResult.data;
  const visitError = visitResult.error as { code?: string } | undefined;
  if (view === 'agenda' && visitData) {
    redirectToValidPage('/planning', query, page, pageSize, visitData.total);
  }
  const [selectedServiceResult, estimateClientResult, estimateServiceResult] = await Promise.all([
    serviceDefinitionId
      ? get('/api/v1/services/{id}', {
          params: { path: { id: serviceDefinitionId }, header },
        })
      : Promise.resolve(null),
    estimateClientId && canReadClient
      ? get('/api/v1/clients/{id}', { params: { path: { id: estimateClientId }, header } })
      : Promise.resolve(null),
    estimateServiceId
      ? get('/api/v1/services/{id}', {
          params: { path: { id: estimateServiceId }, header },
        })
      : Promise.resolve(null),
  ]);
  const selectedClient = clientResult?.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const selectedEmployee = employeeResult?.data as
    | components['schemas']['EmployeeResponseDto']
    | undefined;
  const selectedTeam = teamResult?.data as components['schemas']['TeamResponseDto'] | undefined;
  const selectedService = selectedServiceResult?.data as
    | components['schemas']['ServiceResponseDto']
    | undefined;
  const estimateClient = estimateClientResult?.data as
    | components['schemas']['ClientResponseDto']
    | undefined;
  const estimateService = estimateServiceResult?.data as
    | components['schemas']['ServiceResponseDto']
    | undefined;
  const serviceData = serviceResult?.data as unknown as
    | components['schemas']['ServiceListResponseDto']
    | undefined;
  const services = serviceData?.items ?? [];
  const visits = visitData?.items ?? [];
  const [estimateResult, worklistResult] = await Promise.all([
    canEstimate && estimateClientId && estimateServiceId && validQuantity(query.estimateQuantity)
      ? get('/api/v1/clients/{clientId}/budgets/estimate', {
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
      : Promise.resolve(null),
    worklistLoad,
  ]);
  const worklistData = worklistResult?.data as unknown as
    | components['schemas']['SchedulingWorklistResponseDto']
    | undefined;
  const worklistFailed = Boolean(canReadSchedule && (worklistResult?.error || !worklistData));
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
  const conflictsByVisit = new Map(
    (worklistData?.items ?? []).map((item) => [item.visit.id, item.conflicts]),
  );
  const selectedEmployeeName = selectedEmployee
    ? `${selectedEmployee.preferredName || selectedEmployee.firstName} ${selectedEmployee.lastName}`
    : (visits
        .flatMap((visit) => visit.assignments)
        .find((assignment) => assignment.employeeId === employeeId)?.employeeDisplayName ??
      t('Planning.selectedEmployee'));
  const availabilityReasonLabels = {
    vacation: t('Employees.detail.absenceReasons.vacation'),
    sick_leave: t('Employees.detail.absenceReasons.sick_leave'),
    training: t('Employees.detail.absenceReasons.training'),
    personal_unavailability: t('Employees.detail.absenceReasons.personal_unavailability'),
    other: t('Employees.detail.absenceReasons.other'),
  };
  const availabilityBackgroundEvents: ScheduleCalendarBackgroundEventInput[] =
    employeeId && availabilityContext && !availabilityContext.failed
      ? [
          ...availabilityIntervalsBetween(
            new Date(requestRange.from),
            new Date(requestRange.until),
            availabilityContext.availability,
          ).map((interval, index) => ({
            id: `availability-${employeeId}-${index}`,
            start: interval.start.toISOString(),
            end: interval.end.toISOString(),
            resourceId: employeeId,
            resourceName: selectedEmployeeName,
            label:
              interval.kind === 'working'
                ? t('Planning.calendarWorkingHours')
                : t('Planning.calendarUnavailable'),
            kind: interval.kind,
          })),
          ...availabilityContext.absences.map((absence) => ({
            id: `absence-${absence.id}`,
            start: absence.startsAt,
            end: absence.endsAt,
            resourceId: employeeId,
            resourceName: selectedEmployeeName,
            label: t('Planning.calendarAbsence', {
              reason: availabilityReasonLabels[absence.reason],
            }),
            kind: 'absence' as const,
          })),
        ]
      : [];
  const canReadExecution = hasPermission(permissions, 'visit_execution.read');
  const canReschedule = hasPermission(permissions, 'schedule.update') && canReadExecution;
  const executionSummaryRows: components['schemas']['VisitExecutionSummaryResponseDto'][] = [];
  let executionSummaryFailed = false;
  if (canReschedule && view !== 'agenda') {
    const visitIdBatches = Array.from({ length: Math.ceil(visits.length / 100) }, (_, index) =>
      visits.slice(index * 100, (index + 1) * 100).map((visit) => visit.id),
    );
    for (let index = 0; index < visitIdBatches.length; index += 5) {
      // oxlint-disable-next-line no-await-in-loop -- Fetching summaries in groups of five bounds request fan-out.
      const summaryResults = await Promise.all(
        visitIdBatches.slice(index, index + 5).map((visitIds) =>
          get('/api/v1/visit-executions/summaries', {
            params: { query: { visitIds: visitIds.join(',') }, header },
          }),
        ),
      );
      if (summaryResults.some((result) => result.error || !result.data)) {
        executionSummaryFailed = true;
        break;
      }
      summaryResults.forEach((result) => executionSummaryRows.push(...(result.data ?? [])));
    }
  }
  const executionByVisit = new Map(
    executionSummaryRows.map((summary) => [summary.visitId, summary.executionStatus]),
  );
  const calendarEvents: ScheduleCalendarEventInput[] = visits.map((visit) => {
    const visitConflicts = conflictsByVisit.get(visit.id) ?? [];
    const conflictLabels = visitConflicts.map(
      (conflict) => conflictMessages[conflict.code] ?? conflict.code,
    );
    const timeLabel = `${formatTime(visit.plannedStart, locale, visit.timezone)}–${formatTime(visit.plannedEnd, locale, visit.timezone)}`;
    return {
      id: visit.id,
      clientName: visit.clientDisplayName,
      serviceNames: visit.services.map((service) => service.serviceName),
      employeeNames: visit.assignments.map((assignment) => assignment.employeeDisplayName),
      resourceIds: visit.assignments.map((assignment) => assignment.employeeId),
      start: visit.plannedStart,
      end: visit.plannedEnd,
      timezone: visit.timezone,
      status: visit.status,
      statusLabel: t(visitStatusKey(visit.status)),
      detail: [
        visit.clientDisplayName,
        timeLabel,
        visit.services.map((service) => service.serviceName).join(', '),
        visit.assignments.map((assignment) => assignment.employeeDisplayName).join(', '),
        t(visitStatusKey(visit.status)),
        ...conflictLabels,
      ]
        .filter(Boolean)
        .join(' · '),
      href: visitHref(visit.id),
      conflictLabels,
      protectedFromReschedule:
        executionSummaryFailed || executionByVisit.get(visit.id) !== 'not_started',
    };
  });
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
  const selectedDayVisits = visits.filter(
    (visit) => dateAtZone(visit.plannedStart, visit.timezone) === selectedDate,
  );
  const employeeVisitGroups = new Map<string, typeof selectedDayVisits>();
  for (const visit of selectedDayVisits) {
    for (const assignment of visit.assignments) {
      const group = employeeVisitGroups.get(assignment.employeeId) ?? [];
      group.push(visit);
      employeeVisitGroups.set(assignment.employeeId, group);
    }
  }
  const selectedTourId = validUuid(query.tourId);
  const [tourRows, selectedTourResult] = await Promise.all([
    view === 'day' && canAssign
      ? Promise.all(
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
            return {
              employeeId: tourEmployeeId,
              tours:
                (result.data as unknown as
                  | components['schemas']['TourListItemResponseDto'][]
                  | undefined) ?? [],
              error: result.error as { code?: string } | undefined,
            };
          }),
        )
      : Promise.resolve([]),
    selectedTourId && canAssign
      ? get('/api/v1/scheduling/tours/{id}', {
          params: { path: { id: selectedTourId }, header },
        })
      : Promise.resolve(null),
  ]);
  const toursByEmployee = new Map(tourRows.map((row) => [row.employeeId, row.tours]));
  const selectedTour = selectedTourResult?.data as
    | components['schemas']['TourResponseDto']
    | undefined;
  const selectedTourError = selectedTourResult?.error as { code?: string } | undefined;
  const suggestedTourId = validUuid(query.suggestedTourId);
  const suggestedOrder = (query.suggestedOrder ?? '')
    .split(',')
    .map((value) => validUuid(value))
    .filter((value): value is string => value !== null);
  const openCount = visits.filter((visit) => visit.assignments.length === 0).length;
  const error = query.error ?? visitError?.code;
  const calendarTitleKey =
    view === 'agenda'
      ? 'Planning.listOverview'
      : view === 'month'
        ? 'Planning.monthOverview'
        : view === 'week'
          ? 'Planning.weekOverview'
          : 'Planning.dayOverview';
  const calendarTitle = t(calendarTitleKey);
  const calendarDescription =
    view !== 'agenda' && !employeeId && canReadSchedule
      ? t('Planning.selectEmployeeForAvailability')
      : t('Planning.description');
  const estimateError = (estimateResult?.error as { code?: string } | undefined)?.code;
  const estimate = estimateResult?.data as
    | components['schemas']['BenefitEstimateResponseDto']
    | undefined;

  return (
    <div className="planning-dashboard grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title={calendarTitle}
        description={calendarDescription}
        actions={
          view === 'agenda' ? null : (
            <div className="planning-calendar-stats">
              <div className="planning-calendar-stat">
                <span className="planning-calendar-stat-icon planning-calendar-stat-icon-visits">
                  <UsersRound className="size-5" aria-hidden="true" />
                </span>
                <div className="grid gap-0.5">
                  <p className="planning-calendar-stat-value">
                    {t('Planning.visitCount', { count: visitData?.total ?? 0 })}
                  </p>
                  <p className="planning-calendar-stat-caption">
                    {t('Planning.calendarPeriodCaption')}
                  </p>
                </div>
              </div>
              <div className="planning-calendar-stat">
                <span className="planning-calendar-stat-icon planning-calendar-stat-icon-open">
                  <Clock3 className="size-5" aria-hidden="true" />
                </span>
                <div className="grid gap-0.5">
                  <p className="planning-calendar-stat-value">
                    {t('Planning.calendarOpenValue', { count: openCount })}
                  </p>
                  <p className="planning-calendar-stat-caption">
                    {t('Planning.calendarOpenCaption')}
                  </p>
                </div>
              </div>
            </div>
          )
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {admissionHandoffRequested && !admissionContextUsable ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {onboardingT('schedulingContextUnavailable')}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t(planningUpdateKey(query.updated))}
        </p>
      ) : null}

      <ScheduleCalendarNavigation
        date={selectedDate}
        view={view}
        locale={locale === 'de' ? 'de' : 'en'}
        timezone={calendarTimezone}
        labels={{
          month: t('Planning.month'),
          week: t('Planning.week'),
          day: t('Planning.day'),
          agenda: t('Planning.agenda'),
          previous: t('Planning.previous'),
          next: t('Planning.next'),
          today: t('Planning.today'),
          date: t('Planning.date'),
          goToDate: t('Planning.goToDate'),
          calendarNavigation: t('Planning.calendarNavigation'),
        }}
        employeeSelector={
          canReadSchedule ? (
            <form
              id="planning-employee-filter"
              method="get"
              className="planning-calendar-employee-form"
            >
              {Object.entries(query).map(([name, value]) =>
                name !== 'employeeId' &&
                name !== 'date' &&
                name !== 'view' &&
                name !== 'page' &&
                name !== 'pageSize' &&
                typeof value === 'string' ? (
                  <input key={name} type="hidden" name={name} value={value} />
                ) : null,
              )}
              <input type="hidden" name="date" value={selectedDate} />
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="page" value="1" />
              {view === 'agenda' ? <input type="hidden" name="pageSize" value={pageSize} /> : null}
              <div className="planning-calendar-employee-control">
                <UsersRound className="planning-calendar-employee-icon" aria-hidden="true" />
                <AsyncEntityCombobox
                  label={t('Planning.employees')}
                  name="employeeId"
                  entity="employees"
                  placeholder={t('Planning.calendarSelectEmployee')}
                  hideLabel
                  className="planning-calendar-employee-trigger"
                  {...(selectedEmployee
                    ? {
                        initialOption: {
                          id: selectedEmployee.id,
                          label: `${selectedEmployee.preferredName || selectedEmployee.firstName} ${selectedEmployee.lastName}`,
                        },
                      }
                    : {})}
                />
              </div>
              <Button
                type="submit"
                size="icon"
                variant="secondary"
                aria-label={t('Planning.applyFilters')}
              >
                <Check aria-hidden="true" />
              </Button>
            </form>
          ) : null
        }
      />

      <FilterDisclosure title={t('Planning.filters')} defaultOpenOnDesktop={false} desktopToggle>
        <form
          method="get"
          className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          <input type="hidden" name="date" value={selectedDate} />
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="page" value="1" />
          {employeeId ? <input type="hidden" name="employeeId" value={employeeId} /> : null}
          {view === 'agenda' ? <input type="hidden" name="pageSize" value={pageSize} /> : null}
          <Field
            label={t('Planning.search')}
            name="search"
            type="search"
            defaultValue={search ?? ''}
          />
          {view === 'agenda' ? (
            <>
              <SelectField label={t('Planning.sortBy')} name="sortBy" defaultValue={sortBy}>
                <option value="plannedStart">{t('Planning.sortByDate')}</option>
                <option value="clientName">{t('Planning.sortByClient')}</option>
                <option value="createdAt">{t('Planning.sortByCreated')}</option>
              </SelectField>
              <SelectField
                label={t('Planning.sortOrder')}
                name="sortOrder"
                defaultValue={sortOrder}
              >
                <option value="asc">{t('Planning.sortAscending')}</option>
                <option value="desc">{t('Planning.sortDescending')}</option>
              </SelectField>
            </>
          ) : null}
          <AsyncEntityCombobox
            label={t('Planning.organization')}
            name="organizationId"
            entity="organizations"
            placeholder={t('Planning.allOrganizations')}
            {...(selectedOrganization
              ? {
                  initialOption: {
                    id: selectedOrganization.id,
                    label: selectedOrganization.name,
                  },
                }
              : {})}
          />
          <AsyncEntityCombobox
            label={t('Planning.facility')}
            name="facilityId"
            entity="facilities"
            {...(organizationId ? { organizationId } : {})}
            placeholder={t('Planning.allFacilities')}
            {...(selectedFacility
              ? {
                  initialOption: {
                    id: selectedFacility.id,
                    label: `${selectedFacility.organizationName} · ${selectedFacility.name}`,
                  },
                }
              : {})}
          />
          <AsyncEntityCombobox
            label={t('Common.fields.team')}
            name="teamId"
            entity="teams"
            {...(organizationId ? { organizationId } : {})}
            placeholder={t('Planning.allTeams')}
            {...(selectedTeam
              ? {
                  initialOption: {
                    id: selectedTeam.id,
                    label: `${selectedTeam.organizationName} · ${selectedTeam.name}`,
                  },
                }
              : {})}
          />
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
          <AsyncEntityCombobox
            label={t('Planning.service')}
            name="serviceDefinitionId"
            entity="services"
            validAt={selectedDate}
            placeholder={t('Planning.allServices')}
            {...(selectedService
              ? {
                  initialOption: {
                    id: selectedService.id,
                    label: `${selectedService.code} · ${selectedService.name}`,
                  },
                }
              : {})}
          />
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
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
            <h2 id="budget-estimate-title" className="text-xl font-semibold">
              {t('Benefits.planningEstimateTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('Benefits.planningEstimateDescription')}
            </p>
          </summary>
          <section aria-labelledby="budget-estimate-title" className="grid gap-3 border-t p-4">
            <form method="get" className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="date" value={selectedDate} />
              <input type="hidden" name="view" value={view} />
              {canReadClient ? (
                <AsyncEntityCombobox
                  label={t('Benefits.planningEstimateClient')}
                  name="estimateClientId"
                  entity="clients"
                  required
                  placeholder={t('Planning.selectClient')}
                  {...(estimateClient
                    ? {
                        initialOption: {
                          id: estimateClient.id,
                          label: `${estimateClient.preferredName || estimateClient.firstName} ${estimateClient.lastName}`,
                        },
                      }
                    : {})}
                />
              ) : null}
              <AsyncEntityCombobox
                label={t('Benefits.planningEstimateService')}
                name="estimateServiceId"
                entity="services"
                validAt={estimateDate}
                required
                placeholder={t('Planning.allServices')}
                {...(estimateService
                  ? {
                      initialOption: {
                        id: estimateService.id,
                        label: `${estimateService.code} · ${estimateService.name}`,
                      },
                    }
                  : {})}
              />
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
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
              >
                {t(errorMessageKey(estimateError))}
              </p>
            ) : null}
            {estimate ? (
              <div className="grid gap-3 rounded-md bg-accent p-4 text-sm text-primary">
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
                  {t('Benefits.plannedEligible')}: {money(estimate.plannedEligible45bCents, locale)}
                  . {t('Benefits.plannedNotReserved')}
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
            {!canReadClient || !services.length ? (
              <p className="text-sm text-muted-foreground">{t('Benefits.noEstimateOptions')}</p>
            ) : null}
          </section>
        </details>
      ) : null}

      <section
        aria-label={calendarTitle}
        className="planning-calendar-section grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      >
        {worklistFailed ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {t('Planning.worklistLoadFailed')}
          </p>
        ) : null}
        {visitResult.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
          >
            {t(errorMessageKey(visitError?.code ?? 'UNKNOWN'))}
          </p>
        ) : view === 'agenda' ? (
          visits.length ? (
            <ol aria-label={t('Planning.listOverview')} className="grid gap-2">
              {visits.map((visit) => {
                const visitConflicts = conflictsByVisit.get(visit.id) ?? [];
                const clientLinkAllowed = hasClientPermission(
                  permissions,
                  'client.read',
                  tenantId,
                  visit.organizationId,
                  visit.facilityId,
                );
                return (
                  <li key={visit.id}>
                    <article className="grid min-w-0 gap-3 rounded-lg border bg-card p-3 md:grid-cols-[9rem_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                      <div className="grid min-w-0 gap-1">
                        <span className="text-xs text-muted-foreground md:hidden">
                          {t('Planning.dateTime')}
                        </span>
                        <Link
                          className="font-medium text-primary tabular-nums underline"
                          href={visitHref(visit.id)}
                          id={`visit-${visit.id}`}
                        >
                          {formatDay(dateAtZone(visit.plannedStart, visit.timezone), locale)}
                          <span className="block">
                            {formatTime(visit.plannedStart, locale, visit.timezone)}–
                            {formatTime(visit.plannedEnd, locale, visit.timezone)}
                          </span>
                        </Link>
                      </div>
                      <div className="grid min-w-0 gap-1">
                        <span className="text-xs text-muted-foreground md:hidden">
                          {t('Planning.client')}
                        </span>
                        <ResourceReference
                          className="truncate font-medium"
                          label={visit.clientDisplayName}
                          href={clientLinkAllowed ? `/clients/${visit.clientId}` : null}
                        />
                      </div>
                      <div className="grid min-w-0 gap-1">
                        <span className="text-xs text-muted-foreground md:hidden">
                          {t('Planning.service')}
                        </span>
                        <span className="text-sm">
                          {visit.services
                            .map((service) => `${service.serviceCode} · ${service.serviceName}`)
                            .join(' · ') || '–'}
                        </span>
                      </div>
                      <div className="grid min-w-0 gap-1">
                        <span className="text-xs text-muted-foreground md:hidden">
                          {t('Planning.employees')}
                        </span>
                        {visit.assignments.length ? (
                          <div className="flex min-w-0 flex-wrap gap-x-2 text-sm">
                            {visit.assignments.map((assignment) => (
                              <ResourceReference
                                key={assignment.id}
                                className="truncate"
                                label={assignment.employeeDisplayName}
                                href={
                                  hasPermission(permissions, 'employee.read')
                                    ? `/employees/${assignment.employeeId}`
                                    : null
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm">{t('Planning.open')}</span>
                        )}
                      </div>
                      <div className="grid min-w-0 gap-1">
                        <span className="text-xs text-muted-foreground md:hidden">
                          {t('Planning.facility')}
                        </span>
                        <span className="min-w-0 truncate text-sm">
                          {visit.facilityName} · {visit.organizationName}
                        </span>
                        <span className="rounded-full border px-2 py-1 text-xs md:justify-self-start">
                          {t(visitStatusKey(visit.status))}
                        </span>
                      </div>
                      {visitConflicts.length ? (
                        <ul className="flex flex-wrap gap-1 md:col-span-5">
                          {visitConflicts.map((conflict, index) => (
                            <li
                              key={`${conflict.code}-${conflict.relatedVisitId ?? index}`}
                              className={
                                'rounded-full px-2 py-1 text-xs ' +
                                (conflict.severity === 'blocking'
                                  ? 'bg-destructive/15 text-destructive'
                                  : 'bg-warning-muted text-warning-foreground')
                              }
                            >
                              {conflictMessages[conflict.code] ?? conflict.code}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {t('Planning.noVisits')}
            </p>
          )
        ) : view === 'month' || view === 'week' || view === 'day' ? (
          <>
            {availabilityContext?.failed ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {t('Planning.calendarContextLoadFailed')}
              </p>
            ) : null}
            {availabilityContext &&
            !availabilityContext.failed &&
            !availabilityContext.availability ? (
              <p className="rounded-md border bg-warning-muted p-3 text-sm text-warning-foreground">
                {t('Planning.calendarAvailabilityUnknown')}
              </p>
            ) : null}
            <ScheduleCalendarGrid
              events={calendarEvents}
              backgroundEvents={availabilityBackgroundEvents}
              date={selectedDate}
              view={view}
              timezone={calendarTimezone}
              locale={locale === 'de' ? 'de' : 'en'}
              monthCountLabels={{
                one: t('Planning.visitCount', { count: 1 }),
                other: t('Planning.visitCount', { count: 2 }),
              }}
              emptyLabel={t('Planning.noVisits')}
              emptyOverlay={
                !employeeId && canReadSchedule && calendarEvents.length === 0 ? (
                  <div className="planning-calendar-empty-state">
                    <span className="planning-calendar-empty-icon">
                      <CalendarPlus className="size-8" aria-hidden="true" />
                    </span>
                    <h3>{t('Planning.calendarNoEmployeeTitle')}</h3>
                    <p>{t('Planning.selectEmployeeForAvailability')}</p>
                    <Button asChild className="planning-calendar-empty-action">
                      <Link href="#planning-employee-filter">
                        <UsersRound aria-hidden="true" />
                        {t('Planning.calendarSelectEmployee')}
                      </Link>
                    </Button>
                  </div>
                ) : undefined
              }
              {...(canCreate && canReadClient
                ? { createVisitLabel: t('Planning.createVisit') }
                : {})}
              rescheduleErrorLabel={t('Planning.calendarRescheduleError')}
              canReschedule={canReschedule && canReadSchedule && !worklistFailed}
              rescheduleAction={updateVisitFromCalendarAction}
            />
          </>
        ) : null}
        {view === 'agenda' && visitData ? (
          <DataPagination
            pathname="/planning"
            page={visitData.page}
            pageSize={visitData.pageSize}
            totalItems={visitData.total}
            filters={{
              date: selectedDate,
              view,
              clientId,
              admissionCaseId,
              employeeId,
              organizationId,
              facilityId,
              teamId,
              status,
              assigned,
              serviceDefinitionId,
              search,
              sortBy,
              sortOrder,
              pageSize,
            }}
          />
        ) : null}
      </section>

      {view === 'day' && canAssign ? (
        <section aria-labelledby="tour-planning-title" className="grid gap-4">
          <div>
            <h2 id="tour-planning-title" className="text-xl font-semibold">
              {t('Planning.tourPlanning')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('Planning.tourPlanningDescription')}</p>
          </div>
          {employeeVisitGroups.size ? (
            [...employeeVisitGroups].map(([tourEmployeeId, employeeVisits]) => {
              const listedTour = toursByEmployee.get(tourEmployeeId)?.[0];
              const tour = selectedTourId === listedTour?.id ? selectedTour : null;
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
                <section key={tourEmployeeId} className="grid gap-3 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-semibold">
                      {employeeName ?? t('Planning.employeeTour')}
                    </h3>
                    {listedTour ? (
                      <Link
                        className="text-sm font-medium text-primary underline"
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
                      <p className="text-sm text-muted-foreground">
                        {t('Planning.tourVisitCount', { count: employeeVisits.length })}
                      </p>
                      <Button type="submit" className="w-fit">
                        {t('Planning.createTour')}
                      </Button>
                    </form>
                  ) : tour ? (
                    <div className="grid gap-3">
                      <p className="text-sm text-muted-foreground">
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
                                  <ResourceReference
                                    className="font-medium"
                                    label={
                                      visit?.clientDisplayName ?? t('Resources.unavailableVisit')
                                    }
                                    href={visit ? visitHref(stop.visitId) : null}
                                  />
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
                                <p className="mt-1 text-sm text-muted-foreground">
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
                                  <p className="mt-1 text-sm text-muted-foreground">
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
                        <p className="text-sm text-destructive">{t('Planning.emptyTour')}</p>
                      )}
                      {suggestedTourId === tour.id && suggestedOrder.length ? (
                        <form
                          action={applySuggestedTourOrderAction}
                          className="grid gap-2 rounded-md bg-accent p-3"
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
                      {tour.stops.length ? (
                        <TourStopOrderForm
                          key={`${tour.id}:${tour.version}`}
                          tourId={tour.id}
                          expectedVersion={tour.version}
                          localDate={tour.localDate}
                          employeeId={tour.employeeId}
                          stops={tour.stops.map((stop) => ({
                            visitId: stop.visitId,
                            clientName:
                              selectedDayVisits.find((item) => item.id === stop.visitId)
                                ?.clientDisplayName ?? t('Resources.unavailableVisit'),
                            dispatcherNote: stop.dispatcherNote ?? '',
                          }))}
                        />
                      ) : null}
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
                  ) : selectedTourError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {t(errorMessageKey(selectedTourError.code ?? 'UNKNOWN'))}
                    </p>
                  ) : null}
                </section>
              );
            })
          ) : (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {t('Planning.noAssignedVisitsForTour')}
            </p>
          )}
        </section>
      ) : null}

      {canCreate && (!admissionHandoffRequested || admissionContextUsable) ? (
        <section
          id="create-visit"
          aria-labelledby="create-title"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="create-title" className="text-xl font-semibold">
            {t('Planning.createTitle')}
          </h2>
          {admissionContextUsable && admission ? (
            <div className="grid gap-2 rounded-md bg-background p-3 text-sm">
              <Link className="w-fit text-primary underline" href={`/admissions/${admission.id}`}>
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
          {canReadClient ? (
            <RHFActionForm action={createVisitAction} className="grid gap-4 md:grid-cols-2">
              {admissionContextUsable && admission ? (
                <>
                  <input type="hidden" name="admissionCaseId" value={admission.id} />
                  <input type="hidden" name="expectedAdmissionVersion" value={admission.version} />
                </>
              ) : null}
              <AsyncEntityCombobox
                label={t('Planning.client')}
                name="clientId"
                entity="clients"
                required
                placeholder={t('Planning.selectClient')}
                {...((admissionContextUsable ? linkedClient : selectedClient)
                  ? {
                      initialOption: {
                        id: (admissionContextUsable ? linkedClient : selectedClient)!.id,
                        label: `${(admissionContextUsable ? linkedClient : selectedClient)!.preferredName || (admissionContextUsable ? linkedClient : selectedClient)!.firstName} ${(admissionContextUsable ? linkedClient : selectedClient)!.lastName}`,
                      },
                    }
                  : {})}
              />
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
                  validTime(query.createStart ?? '', '') ||
                  (admissionContextUsable && admission?.assessment?.preferredTimeStart
                    ? validTime(admission.assessment.preferredTimeStart, '08:00')
                    : '08:00')
                }
                required
              />
              <Field
                label={t('Planning.end')}
                name="localEndTime"
                type="time"
                defaultValue={
                  validTime(query.createEnd ?? '', '') ||
                  (admissionContextUsable && admission?.assessment?.preferredTimeEnd
                    ? validTime(admission.assessment.preferredTimeEnd, '09:00')
                    : '09:00')
                }
                required
              />
              <AsyncEntityCombobox
                label={t('Planning.services')}
                name="serviceDefinitionIds"
                entity="services"
                validAt={selectedDate}
                multiple
                required
                placeholder={t('Planning.allServices')}
                initialOptions={
                  admissionContextUsable
                    ? services
                        .filter((service) => preselectedServiceIds.includes(service.id))
                        .map((service) => ({
                          id: service.id,
                          label: `${service.code} · ${service.name}`,
                        }))
                    : []
                }
              />
              {canAssign ? (
                <AsyncEntityCombobox
                  label={t('Planning.employeesOptional')}
                  name="employeeId"
                  entity="employees"
                  placeholder={t('Planning.doNotAssign')}
                  {...(selectedEmployee
                    ? {
                        initialOption: {
                          id: selectedEmployee.id,
                          label: `${selectedEmployee.preferredName || selectedEmployee.firstName} ${selectedEmployee.lastName}`,
                        },
                      }
                    : {})}
                />
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
            <p className="text-sm text-muted-foreground">{t('Planning.createRequirements')}</p>
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
        selectClassName="min-h-10 w-full min-w-0 rounded-md border bg-card px-3 py-2"
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
      <dt className="text-primary">{label}</dt>
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

function monthVisiblePeriod(date: string): { start: string; endExclusive: string } {
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthStartValue = new Date(`${monthStart}T00:00:00Z`);
  const lastDay = new Date(
    Date.UTC(monthStartValue.getUTCFullYear(), monthStartValue.getUTCMonth() + 1, 0),
  );
  const lastDate = lastDay.toISOString().slice(0, 10);
  return {
    start: weekPeriod(monthStart).start,
    endExclusive: weekPeriod(lastDate).endExclusive,
  };
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

function apiRange(
  start: string,
  endExclusive: string,
  timezone: string,
): { from: string; until: string } {
  const range = dateRange(start, addDays(endExclusive, -1), timezone);
  return { from: range.from, until: range.until };
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
