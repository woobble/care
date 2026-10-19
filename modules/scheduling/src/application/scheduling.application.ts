import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService, ClientSnapshot } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { EmployeeApplicationService } from '@care/employees';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import { isSupportedTimeZone, type OrganizationApplicationService } from '@care/organizations';
import {
  assertCan,
  AuthorizationDeniedError,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type {
  AgreementServiceSnapshot,
  ServiceAgreementApplicationService,
  ServiceAgreementSnapshot,
} from '@care/service-agreements';
import type { ServiceApplicationService, ServiceDefinitionSnapshot } from '@care/services';
import {
  InvalidScheduleGenerationRangeError,
  InvalidVisitDataError,
  InvalidVisitServiceError,
  VisitCancelledError,
  VisitLifecycle,
  cadenceDates,
  localDateTimeToInstant,
  validateVisit,
  validateVisitService,
} from '@module/scheduling/domain';
import {
  availabilityForVisit,
  InvalidEmployeeAvailabilityError,
  validateEmployeeAvailability,
} from '@module/scheduling/domain/availability';
import type {
  AvailabilityException,
  AvailabilityWindow,
  EmployeeAvailability,
} from '@module/scheduling/domain/availability';
import { UnavailableRouteProvider } from '@module/scheduling/domain/route-provider';
import type {
  RouteEstimate,
  RouteOrderSuggestion,
  RouteProvider,
} from '@module/scheduling/domain/route-provider';
import {
  compareTourStops,
  InvalidTourError,
  sameTourDate,
  TourVersionConflictError,
  tourFeasibilityConflicts,
  type SchedulingConflict,
} from '@module/scheduling/domain/tour';
import type {
  VisitAssignmentSnapshot,
  VisitData,
  VisitServiceData,
  VisitSnapshot,
  VisitStatus,
} from '@module/scheduling/domain/visit';
import type { SchedulingExecutionGuard } from '@module/scheduling/infrastructure/scheduling-guards';
import { SchedulingRepository } from '@module/scheduling/infrastructure/scheduling.repository';
import type {
  VisitCalendarRow,
  VisitReadScope,
  VisitSearchFilter,
} from '@module/scheduling/infrastructure/scheduling.repository';
import {
  clientSchedulingPreferences,
  employeeSchedulingPreferences,
  tourPublications,
} from '@module/scheduling/schema';

// Each loop below awaits statements on one transaction-bound connection; the ordering is part of the transaction and lock semantics.
// oxlint-disable no-await-in-loop

type AuditContext = { ip?: string; userAgent?: string };

export interface ScheduleVisitServiceInput {
  serviceDefinitionId: string;
  agreementServiceId?: string;
  plannedQuantity: string;
  plannedDurationMinutes?: number | null;
}

export interface CreateVisitInput {
  clientId: string;
  serviceAgreementId?: string | null;
  plannedStart?: Date;
  plannedEnd?: Date;
  localDate?: string;
  localStartTime?: string;
  localEndTime?: string;
  timeWindowStart?: Date | null;
  timeWindowEnd?: Date | null;
  note?: string | null;
  services: ScheduleVisitServiceInput[];
  employeeIds?: string[];
}

export interface UpdateVisitInput {
  plannedStart?: Date;
  plannedEnd?: Date;
  localDate?: string;
  localStartTime?: string;
  localEndTime?: string;
  timeWindowStart?: Date | null;
  timeWindowEnd?: Date | null;
  note?: string | null;
}

export interface VisitSearchQuery {
  from: Date;
  until: Date;
  clientId?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  teamId?: string;
  status?: VisitStatus;
  serviceDefinitionId?: string;
  search?: string;
  unassigned?: boolean;
  origin?: 'agreement_generated' | 'manual';
  relatedToVisitId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'plannedStart' | 'clientName' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface ScheduleGenerationResult {
  generationId: string;
  generated: number;
  alreadyExisting: number;
  requiresManualPlacement: number;
}

export interface EmployeeUnavailabilityInput {
  employeeId: string;
  startsAt?: Date;
  endsAt?: Date;
  localStartDate?: string;
  localStartTime?: string;
  localEndDate?: string;
  localEndTime?: string;
  timezone?: string;
  reason?: 'vacation' | 'sick_leave' | 'training' | 'personal_unavailability' | 'other';
  note?: string | null;
}

export interface EmployeeAvailabilityInput {
  employeeId: string;
  expectedVersion: number;
  timezone: string;
  maxDailyMinutes: number | null;
  travelBufferMinutes: number;
  windows: AvailabilityWindow[];
}

export interface EmployeeAvailabilityExceptionInput {
  employeeId: string;
  expectedVersion: number;
  localDate: string;
  kind: AvailabilityException['kind'];
  startsAt: string | null;
  endsAt: string | null;
}

export interface CreateTourInput {
  employeeId: string;
  localDate: string;
  timezone: string;
  visitIds: string[];
}

export interface UpdateTourStopsInput {
  expectedVersion: number;
  stops: Array<{ visitId: string; dispatcherNote?: string | null }>;
}

export interface TourSummary {
  id: string;
  employeeId: string;
  organizationId: string;
  localDate: string;
  timezone: string;
  status: 'draft' | 'published';
  version: number;
  stops: Array<{
    id: string;
    visitId: string;
    sequence: number;
    plannedStart: Date;
    plannedEnd: Date;
    timezone: string;
    estimatedTravelMinutes: number | null;
    estimatedDistanceMeters: number | null;
    routeStatus: 'unknown' | 'available' | 'unavailable' | 'unresolved';
    dispatcherNote: string | null;
  }>;
  latestPublication: typeof tourPublications.$inferSelect | null;
}

export class SchedulingApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: ClientApplicationService,
    private readonly organizations: OrganizationApplicationService,
    private readonly employees: EmployeeApplicationService,
    private readonly services: ServiceApplicationService,
    private readonly agreements: ServiceAgreementApplicationService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository = new SchedulingRepository(),
    private readonly generationHorizonDays = 28,
    private readonly executionGuard?: SchedulingExecutionGuard,
    private readonly routeProvider: RouteProvider = new UnavailableRouteProvider(),
  ) {}

  async search(
    principal: AuthorizationPrincipal,
    query: VisitSearchQuery,
  ): Promise<{ items: VisitCalendarRow[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    if (
      !validInstant(query.from) ||
      !validInstant(query.until) ||
      query.until <= query.from ||
      query.until.getTime() - query.from.getTime() > 31 * 24 * 60 * 60 * 1000 ||
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidVisitQueryError();
    }
    const scope = visitReadScope(principal);
    if (
      query.teamId &&
      !scope.schedule.tenantWide &&
      scope.schedule.organizationIds.length === 0 &&
      scope.schedule.facilityIds.length === 0 &&
      !scope.schedule.teamIds.includes(query.teamId)
    ) {
      throw new AuthorizationDeniedError('schedule.read');
    }
    const filter = toSearchFilter(principal, query, scope, page, pageSize);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const result = await this.repository.list(transaction, filter);
      return { ...result, page, pageSize };
    });
  }

  async get(
    principal: AuthorizationPrincipal,
    visitId: string,
  ): Promise<{
    visit: VisitCalendarRow;
    assignmentHistory: Array<VisitAssignmentSnapshot & { employeeDisplayName: string }>;
    history: Array<{ id: string; actorId: string; action: string; timestamp: Date }>;
  }> {
    const scope = visitReadScope(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const raw = await this.repository.get(transaction, principal.tenantId, visitId);
      if (!raw) throw new VisitNotFoundError();
      await this.clients.getForServiceAgreement(transaction, principal, raw.clientId);
      const entry = await this.repository.getCalendarEntry(
        transaction,
        {
          tenantId: principal.tenantId,
          from: new Date(raw.plannedStart.getTime() - 1),
          until: new Date(raw.plannedEnd.getTime() + 1),
          scope,
          page: 1,
          pageSize: 1,
          sortBy: 'plannedStart',
          sortOrder: 'asc',
        },
        visitId,
      );
      if (!entry) throw new VisitNotFoundError();
      const assignments = await this.repository.listAssignments(
        transaction,
        principal.tenantId,
        visitId,
      );
      return {
        visit: entry,
        assignmentHistory: assignments.map((row) => ({
          ...(row.assignment as VisitAssignmentSnapshot),
          employeeDisplayName: `${row.preferredName || row.firstName} ${row.lastName}`,
        })),
        history: await this.repository.history(transaction, principal.tenantId, visitId),
      };
    });
  }

  async create(
    principal: AuthorizationPrincipal,
    input: CreateVisitInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(
        transaction,
        principal,
        input.clientId,
        true,
      );
      const provider = await this.providerForClient(transaction, principal.tenantId, client);
      const planned = resolvePlannedRange(input, provider.timezone);
      const resource = clientResource(client, provider.organizationId, provider.facilityId);
      assertCan(principal, { action: 'schedule.create', resource });
      await this.lockResources(transaction, principal.tenantId, [
        `client:${client.id}`,
        ...(input.employeeIds ?? []).map((id) => `employee:${id}`),
      ]);

      const agreementSource = input.serviceAgreementId
        ? await this.agreements.getForScheduling(transaction, principal, input.serviceAgreementId)
        : null;
      if (agreementSource) {
        this.validateAgreementContext(agreementSource.agreement, client, provider);
        if (agreementSource.agreement.status !== 'active') throw new VisitAgreementInvalidError();
      }
      const localDate = input.localDate ?? dateInTimeZone(planned.plannedStart, provider.timezone);
      if (
        agreementSource &&
        !isDateWithin(
          localDate,
          agreementSource.agreement.validFrom,
          agreementSource.agreement.validUntil,
        )
      ) {
        throw new VisitAgreementInvalidError();
      }
      const services = await this.resolveManualServices(
        transaction,
        principal,
        input.services,
        agreementSource,
        localDate,
        provider,
        now,
      );
      const visit: VisitData = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        clientId: client.id,
        organizationId: provider.organizationId,
        facilityId: provider.facilityId,
        origin: 'manual',
        serviceAgreementId: input.serviceAgreementId ?? null,
        status: 'planned',
        plannedStart: planned.plannedStart,
        plannedEnd: planned.plannedEnd,
        timeWindowStart: input.timeWindowStart ?? null,
        timeWindowEnd: input.timeWindowEnd ?? null,
        timezone: provider.timezone,
        note: input.note?.trim() || null,
        manuallyAdjusted: false,
        createdAt: now,
        updatedAt: now,
      };
      const visitServices = services.map((service) => ({ ...service, visitId: visit.id }));
      validateVisit(visit);
      if (visitServices.length === 0) throw new InvalidVisitServiceError();
      await this.ensureClientAvailable(transaction, visit);

      const employeeIds = [...new Set(input.employeeIds ?? [])].sort();
      if (employeeIds.length !== (input.employeeIds ?? []).length)
        throw new DuplicateVisitAssignmentError();
      if (employeeIds.length) assertCan(principal, { action: 'schedule.assign', resource });
      const assignments = [];
      for (const employeeId of employeeIds) {
        const employee = await this.validateEmployeeAssignment(
          transaction,
          principal.tenantId,
          employeeId,
          visit,
        );
        assignments.push(makeAssignment(principal, visit.id, employee.id, null, now));
      }

      await this.repository.insertVisit(transaction, visit);
      for (const service of visitServices)
        await this.repository.insertService(transaction, service);
      for (const assignment of assignments)
        await this.repository.insertAssignment(transaction, assignment);
      const event = createDomainEvent({
        type: 'visit.created',
        tenantId: principal.tenantId,
        aggregateType: 'visit',
        aggregateId: visit.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { visitId: visit.id, clientId: client.id },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'visit.created',
        resourceType: 'visit',
        resourceId: visit.id,
        metadata: { clientId: client.id, origin: visit.origin },
      });
      for (const assignment of assignments) {
        await this.recordAssignmentChange(
          transaction,
          principal,
          context,
          auditContext,
          visit,
          assignment.employeeId,
          'assigned',
          now,
        );
      }
      return { ...visit, services: visitServices };
    });
  }

  async update(
    principal: AuthorizationPrincipal,
    visitId: string,
    changes: UpdateVisitInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        visitId,
        'schedule.update',
        true,
      );
      if (visit.status === 'cancelled') throw new VisitCancelledError();
      const currentServices = await this.repository.servicesForVisit(
        transaction,
        principal.tenantId,
        visit.id,
      );
      const planned = resolveUpdatedRange(changes, visit);
      const next: VisitData = {
        ...visit,
        plannedStart: planned.plannedStart,
        plannedEnd: planned.plannedEnd,
        timeWindowStart:
          changes.timeWindowStart === undefined ? visit.timeWindowStart : changes.timeWindowStart,
        timeWindowEnd:
          changes.timeWindowEnd === undefined ? visit.timeWindowEnd : changes.timeWindowEnd,
        note: changes.note === undefined ? visit.note : changes.note?.trim() || null,
        manuallyAdjusted: visit.manuallyAdjusted || visit.origin === 'agreement_generated',
        updatedAt: nextVisitUpdatedAt(visit.updatedAt),
      };
      validateVisit(next);
      const timeChanged =
        next.plannedStart.getTime() !== visit.plannedStart.getTime() ||
        next.plannedEnd.getTime() !== visit.plannedEnd.getTime() ||
        next.timeWindowStart?.getTime() !== visit.timeWindowStart?.getTime() ||
        next.timeWindowEnd?.getTime() !== visit.timeWindowEnd?.getTime();
      if (timeChanged) await this.ensurePlanningMutable(transaction, visit);
      const changedFields = [
        ...(timeChanged ? ['plannedStart', 'plannedEnd'] : []),
        ...(next.note !== visit.note ? ['note'] : []),
      ];
      if (changedFields.length === 0) return { ...visit, services: currentServices };
      const employeeIds = await this.repository.activeEmployeeIds(
        transaction,
        principal.tenantId,
        visit.id,
      );
      await this.lockResources(transaction, principal.tenantId, [
        `client:${visit.clientId}`,
        ...employeeIds.map((id) => `employee:${id}`),
      ]);
      await this.ensureClientAvailable(transaction, next, visit.id);
      for (const employeeId of employeeIds) {
        await this.employees.validateForScheduling(
          transaction,
          principal.tenantId,
          employeeId,
          next.organizationId,
          next.facilityId,
          dateInTimeZone(next.plannedStart, next.timezone),
        );
        await this.ensureEmployeeAvailable(
          transaction,
          principal.tenantId,
          employeeId,
          next,
          visit.id,
        );
      }
      await this.repository.updateVisit(transaction, next);
      if (timeChanged) {
        await this.invalidateToursForVisit(
          transaction,
          principal.tenantId,
          next,
          principal.userId,
          next.updatedAt,
        );
      }
      const event = timeChanged
        ? createDomainEvent({
            type: 'visit.rescheduled',
            tenantId: principal.tenantId,
            aggregateType: 'visit',
            aggregateId: visit.id,
            actor: { type: 'user', id: principal.userId },
            correlationId: context.correlationId,
            payload: { visitId: visit.id, clientId: visit.clientId },
          })
        : createDomainEvent({
            type: 'visit.updated',
            tenantId: principal.tenantId,
            aggregateType: 'visit',
            aggregateId: visit.id,
            actor: { type: 'user', id: principal.userId },
            correlationId: context.correlationId,
            payload: { visitId: visit.id, clientId: visit.clientId, changedFields },
          });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: timeChanged ? 'visit.rescheduled' : 'visit.updated',
        resourceType: 'visit',
        resourceId: visit.id,
        metadata: { clientId: visit.clientId, changedFields },
      });
      return { ...next, services: currentServices };
    });
  }

  async confirm(
    principal: AuthorizationPrincipal,
    visitId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitSnapshot> {
    return this.changeVisitStatus(principal, visitId, 'confirm', context, auditContext);
  }

  async unconfirm(
    principal: AuthorizationPrincipal,
    visitId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitSnapshot> {
    return this.changeVisitStatus(principal, visitId, 'unconfirm', context, auditContext);
  }

  async cancel(
    principal: AuthorizationPrincipal,
    visitId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitSnapshot> {
    return this.changeVisitStatus(principal, visitId, 'cancel', context, auditContext);
  }

  async listAssignments(
    principal: AuthorizationPrincipal,
    visitId: string,
  ): Promise<Array<VisitAssignmentSnapshot & { employeeDisplayName: string }>> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireReadableVisit(transaction, principal, visitId);
      const rows = await this.repository.listAssignments(transaction, principal.tenantId, visit.id);
      return rows.map((row) => ({
        ...(row.assignment as VisitAssignmentSnapshot),
        employeeDisplayName: `${row.preferredName || row.firstName} ${row.lastName}`,
      }));
    });
  }

  async assign(
    principal: AuthorizationPrincipal,
    visitId: string,
    input: { employeeId: string; role?: string | null },
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitAssignmentSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        visitId,
        'schedule.assign',
        true,
      );
      if (visit.status === 'cancelled') throw new VisitCancelledError();
      await this.ensurePlanningMutable(transaction, visit);
      await this.lockResources(transaction, principal.tenantId, [
        `client:${visit.clientId}`,
        `employee:${input.employeeId}`,
      ]);
      const existing = await this.repository.activeEmployeeIds(
        transaction,
        principal.tenantId,
        visit.id,
      );
      if (existing.includes(input.employeeId)) throw new DuplicateVisitAssignmentError();
      const now = nextVisitUpdatedAt(visit.updatedAt);
      const employee = await this.validateEmployeeAssignment(
        transaction,
        principal.tenantId,
        input.employeeId,
        visit,
      );
      const assignment = makeAssignment(principal, visit.id, employee.id, input.role ?? null, now);
      await this.repository.insertAssignment(transaction, assignment);
      await this.repository.updateVisit(transaction, { ...visit, updatedAt: now });
      await this.invalidateToursForVisit(
        transaction,
        principal.tenantId,
        visit,
        principal.userId,
        now,
      );
      await this.recordAssignmentChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        employee.id,
        'assigned',
        now,
      );
      return assignment;
    });
  }

  async unassign(
    principal: AuthorizationPrincipal,
    visitId: string,
    assignmentId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<void> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        visitId,
        'schedule.assign',
        true,
      );
      const assignment = await this.repository.assignment(
        transaction,
        principal.tenantId,
        visit.id,
        assignmentId,
      );
      if (!assignment || assignment.status !== 'active') throw new VisitAssignmentNotFoundError();
      await this.ensurePlanningMutable(transaction, visit);
      await this.lockResources(transaction, principal.tenantId, [
        `client:${visit.clientId}`,
        `employee:${assignment.employeeId}`,
      ]);
      const now = nextVisitUpdatedAt(visit.updatedAt);
      await this.repository.unassign(transaction, principal.tenantId, visit.id, assignmentId, now);
      await this.repository.updateVisit(transaction, { ...visit, updatedAt: now });
      await this.invalidateToursForVisit(
        transaction,
        principal.tenantId,
        visit,
        principal.userId,
        now,
      );
      await this.recordAssignmentChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        assignment.employeeId,
        'unassigned',
        now,
      );
    });
  }

  async generateAgreementVisits(
    principal: AuthorizationPrincipal,
    agreementId: string,
    input: { from: string; until: string },
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ScheduleGenerationResult> {
    validateGenerationRange(input.from, input.until, this.generationHorizonDays);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const source = await this.agreements.getForScheduling(transaction, principal, agreementId);
      const { agreement, services: agreementServices } = source;
      const client = await this.clients.getForServiceAgreement(
        transaction,
        principal,
        agreement.clientId,
        true,
      );
      const provider = await this.providerForClient(transaction, principal.tenantId, client);
      this.validateAgreementContext(agreement, client, provider);
      const resource = clientResource(client, provider.organizationId, provider.facilityId);
      assertCan(principal, { action: 'schedule.generate', resource });
      if (agreement.status !== 'active') throw new VisitAgreementInvalidError();
      await this.lockResources(transaction, principal.tenantId, [`client:${client.id}`]);

      const serviceInputs: GeneratedServiceCandidate[] = [];
      let requiresManualPlacement = 0;
      const activeServices = agreementServices.filter((line) => line.status === 'active');
      for (const line of activeServices) {
        const effectiveFrom = maxDate(agreement.validFrom, line.validFrom ?? agreement.validFrom);
        const effectiveUntil = minNullableDate(agreement.validUntil, line.validUntil);
        const from = maxDate(input.from, effectiveFrom);
        const until = minNullableDate(input.until, effectiveUntil);
        if (until !== null && until < from) continue;
        if (!line.scheduleRule) {
          requiresManualPlacement += 1;
          continue;
        }
        const cadence = cadenceDates({
          rule: line.scheduleRule,
          from,
          until: until ?? input.until,
          anchorDate: line.validFrom ?? agreement.validFrom,
        });
        requiresManualPlacement += cadence.requiresManualPlacement;
        if (cadence.dates.length === 0) continue;
        if (!line.preferredTimeStart || !line.preferredTimeEnd) {
          requiresManualPlacement += cadence.dates.length;
          continue;
        }
        const catalog = await this.services.getForAgreement(transaction, principal, {
          serviceDefinitionId: line.serviceDefinitionId,
          organizationId: agreement.organizationId,
          facilityId: agreement.facilityId,
          validFrom: from,
          validUntil: until,
          lock: true,
        });
        for (const date of cadence.dates) {
          const plannedStart = localDateTimeToInstant(
            date,
            line.preferredTimeStart,
            provider.timezone,
            'earlier',
          );
          const windowEnd = localDateTimeToInstant(
            date,
            line.preferredTimeEnd,
            provider.timezone,
            'later',
          );
          if (!plannedStart || !windowEnd || !catalog.defaultDurationMinutes) {
            requiresManualPlacement += 1;
            continue;
          }
          serviceInputs.push({
            line,
            catalog,
            date,
            generationKey: `${line.id}:${date}`,
            plannedStart,
            timeWindowStart: plannedStart,
            timeWindowEnd: windowEnd,
            duration: catalog.defaultDurationMinutes,
          });
        }
      }

      const groups = groupGeneratedCandidates(serviceInputs);
      const generationKeys = serviceInputs.map((item) => item.generationKey);
      const existingKeys = await this.repository.existingGenerationKeys(
        transaction,
        principal.tenantId,
        generationKeys,
      );
      let alreadyExisting = 0;
      let generated = 0;
      const blockedGroups: GeneratedVisitGroup[] = [];
      for (const group of groups) {
        const existing = group.services.filter((item) => existingKeys.has(item.generationKey));
        alreadyExisting += existing.length;
        const fresh = group.services.filter((item) => !existingKeys.has(item.generationKey));
        if (fresh.length === 0) continue;
        if (existing.length > 0) {
          requiresManualPlacement += fresh.length;
          continue;
        }
        const duration = group.services.reduce((total, item) => total + item.duration, 0);
        const plannedEnd = new Date(group.plannedStart.getTime() + duration * 60_000);
        if (plannedEnd > group.timeWindowEnd) {
          requiresManualPlacement += group.services.length;
          continue;
        }
        blockedGroups.push({ ...group, plannedEnd });
      }

      blockedGroups.sort(
        (left, right) => left.plannedStart.getTime() - right.plannedStart.getTime(),
      );
      for (const group of blockedGroups) {
        const conflict = await this.repository.findClientConflict(transaction, {
          tenantId: principal.tenantId,
          clientId: client.id,
          plannedStart: group.plannedStart,
          plannedEnd: group.plannedEnd,
        });
        if (conflict) {
          requiresManualPlacement += group.services.length;
          continue;
        }
        const visit: VisitData = {
          id: uuidv7(),
          tenantId: principal.tenantId,
          clientId: client.id,
          organizationId: agreement.organizationId,
          facilityId: agreement.facilityId,
          origin: 'agreement_generated',
          serviceAgreementId: agreement.id,
          status: 'planned',
          plannedStart: group.plannedStart,
          plannedEnd: group.plannedEnd,
          timeWindowStart: group.timeWindowStart,
          timeWindowEnd: group.timeWindowEnd,
          timezone: provider.timezone,
          note: null,
          manuallyAdjusted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        validateVisit(visit);
        const visitServices = group.services.map((candidate) =>
          generatedVisitService(
            principal.tenantId,
            visit.id,
            agreement.id,
            candidate,
            visit.createdAt,
          ),
        );
        await this.repository.insertVisit(transaction, visit);
        for (const service of visitServices)
          await this.repository.insertService(transaction, service);
        generated += 1;
        const event = createDomainEvent({
          type: 'visit.generated',
          tenantId: principal.tenantId,
          aggregateType: 'visit',
          aggregateId: visit.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { visitId: visit.id, agreementId: agreement.id, clientId: client.id },
        });
        await this.record(transaction, principal, context, auditContext, {
          event,
          action: 'visit.generated',
          resourceType: 'visit',
          resourceId: visit.id,
          metadata: {
            clientId: client.id,
            agreementId: agreement.id,
            serviceCount: visitServices.length,
          },
        });
      }

      const generationId = uuidv7();
      await this.repository.saveGeneration(transaction, {
        id: generationId,
        tenantId: principal.tenantId,
        agreementId,
        generatedBy: principal.userId,
        fromDate: input.from,
        untilDate: input.until,
        generatedCount: generated,
        alreadyExistingCount: alreadyExisting,
        requiresManualPlacementCount: requiresManualPlacement,
        createdAt: new Date(),
      });
      const event = createDomainEvent({
        type: 'schedule.generation_completed',
        tenantId: principal.tenantId,
        aggregateType: 'schedule_generation',
        aggregateId: generationId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: {
          generationId,
          agreementId,
          generatedCount: generated,
          alreadyExistingCount: alreadyExisting,
          requiresManualPlacementCount: requiresManualPlacement,
        },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'schedule.generation_completed',
        resourceType: 'schedule_generation',
        resourceId: generationId,
        metadata: {
          agreementId,
          from: input.from,
          until: input.until,
          generated,
          alreadyExisting,
          requiresManualPlacement,
        },
      });
      return { generationId, generated, alreadyExisting, requiresManualPlacement };
    });
  }

  async proposeSubstitution(
    principal: AuthorizationPrincipal,
    visitId: string,
    input: { originalAssignmentId: string; substituteEmployeeId: string; reason: string },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!input.reason.trim() || input.reason.length > 500) throw new InvalidVisitAssignmentError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        visitId,
        'schedule.assign',
        true,
      );
      if (visit.status === 'cancelled') throw new VisitCancelledError();
      await this.ensurePlanningMutable(transaction, visit);
      const original = await this.repository.assignment(
        transaction,
        principal.tenantId,
        visit.id,
        input.originalAssignmentId,
      );
      if (!original || original.status !== 'active') throw new VisitAssignmentNotFoundError();
      if (original.employeeId === input.substituteEmployeeId)
        throw new InvalidVisitAssignmentError();
      await this.lockResources(transaction, principal.tenantId, [
        `client:${visit.clientId}`,
        `employee:${original.employeeId}`,
        `employee:${input.substituteEmployeeId}`,
        `visit:${visit.id}`,
      ]);
      if (
        await this.repository.activeProposedSubstitution(transaction, principal.tenantId, visit.id)
      ) {
        throw new ActiveVisitSubstitutionError();
      }
      await this.validateEmployeeAssignment(
        transaction,
        principal.tenantId,
        input.substituteEmployeeId,
        visit,
      );
      const now = new Date();
      const substitution = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        visitId: visit.id,
        originalAssignmentId: original.id,
        originalEmployeeId: original.employeeId,
        substituteEmployeeId: input.substituteEmployeeId,
        status: 'proposed' as const,
        reason: input.reason.trim(),
        createdAt: now,
        createdBy: principal.userId,
        resolvedAt: null,
        resolvedBy: null,
      };
      await this.repository.insertVisitSubstitution(transaction, substitution);
      await this.recordSubstitutionChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        substitution,
        'proposed',
        now,
      );
      return substitution;
    });
  }

  async confirmSubstitution(
    principal: AuthorizationPrincipal,
    substitutionId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const substitution = await this.repository.getVisitSubstitution(
        transaction,
        principal.tenantId,
        substitutionId,
        true,
      );
      if (!substitution || substitution.status !== 'proposed')
        throw new VisitSubstitutionNotFoundError();
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        substitution.visitId,
        'schedule.assign',
        true,
      );
      if (visit.status === 'cancelled') throw new VisitCancelledError();
      await this.ensurePlanningMutable(transaction, visit);
      await this.lockResources(transaction, principal.tenantId, [
        `client:${visit.clientId}`,
        `employee:${substitution.originalEmployeeId}`,
        `employee:${substitution.substituteEmployeeId}`,
        `visit:${visit.id}`,
      ]);
      const original = await this.repository.assignment(
        transaction,
        principal.tenantId,
        visit.id,
        substitution.originalAssignmentId,
      );
      if (
        !original ||
        original.status !== 'active' ||
        original.employeeId !== substitution.originalEmployeeId
      ) {
        throw new VisitSubstitutionStaleError();
      }
      await this.validateEmployeeAssignment(
        transaction,
        principal.tenantId,
        substitution.substituteEmployeeId,
        visit,
      );
      const now = nextVisitUpdatedAt(visit.updatedAt);
      await this.repository.insertAssignment(
        transaction,
        makeAssignment(principal, visit.id, substitution.substituteEmployeeId, original.role, now),
      );
      await this.repository.unassign(transaction, principal.tenantId, visit.id, original.id, now);
      await this.repository.updateVisit(transaction, { ...visit, updatedAt: now });
      if (
        !(await this.repository.updateVisitSubstitution(
          transaction,
          principal.tenantId,
          substitution.id,
          'confirmed',
          now,
          principal.userId,
        ))
      ) {
        throw new VisitSubstitutionStaleError();
      }
      await this.invalidateToursForVisit(
        transaction,
        principal.tenantId,
        visit,
        principal.userId,
        now,
      );
      await this.recordAssignmentChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        original.employeeId,
        'unassigned',
        now,
      );
      await this.recordAssignmentChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        substitution.substituteEmployeeId,
        'assigned',
        now,
      );
      await this.recordSubstitutionChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        substitution,
        'confirmed',
        now,
      );
      return {
        ...substitution,
        status: 'confirmed' as const,
        resolvedAt: now,
        resolvedBy: principal.userId,
      };
    });
  }

  async cancelSubstitution(
    principal: AuthorizationPrincipal,
    substitutionId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const substitution = await this.repository.getVisitSubstitution(
        transaction,
        principal.tenantId,
        substitutionId,
        true,
      );
      if (!substitution || substitution.status !== 'proposed')
        throw new VisitSubstitutionNotFoundError();
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        substitution.visitId,
        'schedule.assign',
        true,
      );
      const now = new Date();
      if (
        !(await this.repository.updateVisitSubstitution(
          transaction,
          principal.tenantId,
          substitution.id,
          'cancelled',
          now,
          principal.userId,
        ))
      ) {
        throw new VisitSubstitutionStaleError();
      }
      await this.recordSubstitutionChange(
        transaction,
        principal,
        context,
        auditContext,
        visit,
        substitution,
        'cancelled',
        now,
      );
      return {
        ...substitution,
        status: 'cancelled' as const,
        resolvedAt: now,
        resolvedBy: principal.userId,
      };
    });
  }

  async substituteCandidates(principal: AuthorizationPrincipal, visitId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        visitId,
        'schedule.assign',
        false,
      );
      const assigned = await this.repository.activeEmployeeIds(
        transaction,
        principal.tenantId,
        visit.id,
      );
      const clientPreferences = await this.repository.clientPreferences(
        transaction,
        principal.tenantId,
        visit.clientId,
      );
      const candidates = await this.repository.activeEmployeesForOrganization(
        transaction,
        principal.tenantId,
        visit.organizationId,
      );
      const eligible: Array<{ employeeId: string; displayName: string; preferred: boolean }> = [];
      for (const candidate of candidates) {
        if (assigned.includes(candidate.id)) continue;
        if (clientPreferences?.avoidedEmployeeIds.includes(candidate.id)) continue;
        try {
          await this.validateEmployeeAssignment(
            transaction,
            principal.tenantId,
            candidate.id,
            visit,
          );
          const preference = await this.repository.employeePreferences(
            transaction,
            principal.tenantId,
            candidate.id,
          );
          eligible.push({
            employeeId: candidate.id,
            displayName: `${candidate.preferredName || candidate.firstName} ${candidate.lastName}`,
            preferred:
              clientPreferences?.preferredEmployeeId === candidate.id ||
              preference?.preferredWeekdays.includes(
                weekdayNumber(visit.plannedStart, visit.timezone),
              ) === true,
          });
        } catch {
          // Ineligible candidates are excluded; the dispatcher still gets explicit reason codes from assignment attempts.
        }
      }
      return eligible.sort(
        (left, right) =>
          Number(right.preferred) - Number(left.preferred) ||
          left.displayName.localeCompare(right.displayName),
      );
    });
  }

  async createTour(
    principal: AuthorizationPrincipal,
    input: CreateTourInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<TourSummary> {
    validateTourRequest(input.localDate, input.timezone, input.visitIds);
    const tourId = uuidv7();
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        input.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [
        `employee:${employee.id}`,
        ...input.visitIds.map((visitId) => `visit:${visitId}`),
      ]);
      const visitsForTour = [] as VisitData[];
      for (const visitId of input.visitIds) {
        const visit = await this.requireVisitForMutation(
          transaction,
          principal,
          visitId,
          'schedule.update',
          true,
        );
        if (visit.status === 'cancelled' || !sameTourDate(visit, input.localDate, input.timezone)) {
          throw new InvalidTourError();
        }
        const employeeIds = await this.repository.activeEmployeeIds(
          transaction,
          principal.tenantId,
          visit.id,
        );
        if (!employeeIds.includes(employee.id)) throw new InvalidTourError();
        if (visitsForTour[0] && visitsForTour[0].organizationId !== visit.organizationId) {
          throw new InvalidTourError();
        }
        await this.ensurePlanningMutable(transaction, visit);
        await this.ensureEmployeeAvailable(
          transaction,
          principal.tenantId,
          employee.id,
          visit,
          visit.id,
        );
        visitsForTour.push(visit);
      }
      const now = new Date();
      const tour = {
        id: tourId,
        tenantId: principal.tenantId,
        employeeId: employee.id,
        organizationId: visitsForTour[0]!.organizationId,
        facilityId: null,
        localDate: input.localDate,
        timezone: input.timezone,
        status: 'draft' as const,
        version: 1,
        createdAt: now,
        createdBy: principal.userId,
        updatedAt: now,
        updatedBy: principal.userId,
      };
      await this.repository.insertTour(transaction, tour);
      await this.repository.insertTourStops(
        transaction,
        visitsForTour.sort(compareTourStops).map((visit, index) => ({
          id: uuidv7(),
          tenantId: principal.tenantId,
          tourId,
          visitId: visit.id,
          sequence: index + 1,
          estimatedTravelMinutes: null,
          estimatedDistanceMeters: null,
          routeStatus: 'unknown',
          dispatcherNote: null,
        })),
      );
      await this.recordTourChange(
        transaction,
        principal,
        context,
        auditContext,
        tour,
        'scheduling.tour_created',
        {
          employeeId: employee.id,
          localDate: tour.localDate,
          visitIds: visitsForTour.map((visit) => visit.id),
        },
        now,
      );
    });
    return this.getTour(principal, tourId);
  }

  async listTours(
    principal: AuthorizationPrincipal,
    employeeId: string,
    from: string,
    until: string,
  ) {
    if (
      !validLocalDate(from) ||
      !validLocalDate(until) ||
      until <= from ||
      dayDistance(from, until) > 31
    ) {
      throw new InvalidTourError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.read', resource });
      const rows = await this.repository.listTours(
        transaction,
        principal.tenantId,
        employeeId,
        from,
        until,
      );
      const summaries: Array<
        (typeof rows)[number] & {
          stopCount: number;
          latestPublishedVersion: number | null;
        }
      > = [];
      for (const tour of rows) {
        const publication = await this.repository.latestTourPublication(
          transaction,
          principal.tenantId,
          tour.id,
        );
        const stops = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        summaries.push({
          ...tour,
          stopCount: stops.length,
          latestPublishedVersion: publication?.version ?? null,
        });
      }
      return summaries;
    });
  }

  async getTour(principal: AuthorizationPrincipal, tourId: string): Promise<TourSummary> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const tour = await this.repository.getTour(transaction, principal.tenantId, tourId);
      if (!tour) throw new TourNotFoundError();
      const { resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        tour.employeeId,
      );
      assertCan(principal, { action: 'schedule.read', resource });
      const stops = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
      for (const row of stops) {
        const client = await this.clients.getForServiceAgreement(
          transaction,
          principal,
          row.visit.clientId,
        );
        assertCan(principal, {
          action: 'schedule.read',
          resource: {
            tenantId: principal.tenantId,
            clientId: row.visit.clientId,
            organizationId: row.visit.organizationId,
            facilityId: row.visit.facilityId,
          },
        });
        if (
          client.organizationId !== row.visit.organizationId ||
          client.primaryFacilityId !== row.visit.facilityId
        ) {
          throw new VisitOutsideProviderContextError();
        }
      }
      const latestPublication = await this.repository.latestTourPublication(
        transaction,
        principal.tenantId,
        tour.id,
      );
      return {
        id: tour.id,
        employeeId: tour.employeeId,
        organizationId: tour.organizationId,
        localDate: tour.localDate,
        timezone: tour.timezone,
        status: tour.status,
        version: tour.version,
        stops: stops.map(({ stop, visit }) => ({
          id: stop.id,
          visitId: stop.visitId,
          sequence: stop.sequence,
          plannedStart: visit.plannedStart,
          plannedEnd: visit.plannedEnd,
          timezone: visit.timezone,
          estimatedTravelMinutes: stop.estimatedTravelMinutes,
          estimatedDistanceMeters: stop.estimatedDistanceMeters,
          routeStatus: stop.routeStatus,
          dispatcherNote: stop.dispatcherNote,
        })),
        latestPublication,
      };
    });
  }

  async updateTourStops(
    principal: AuthorizationPrincipal,
    tourId: string,
    input: UpdateTourStopsInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<TourSummary> {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.stops.length < 1 ||
      input.stops.length > 100 ||
      new Set(input.stops.map((stop) => stop.visitId)).size !== input.stops.length ||
      input.stops.some((stop) => (stop.dispatcherNote?.length ?? 0) > 500)
    ) {
      throw new InvalidTourError();
    }
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const tour = await this.repository.getTour(transaction, principal.tenantId, tourId, true);
      if (!tour) throw new TourNotFoundError();
      if (tour.version !== input.expectedVersion) throw new TourVersionConflictError();
      const { resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        tour.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [
        `employee:${tour.employeeId}`,
        ...input.stops.map((stop) => `visit:${stop.visitId}`),
      ]);
      const visitsForTour: VisitData[] = [];
      for (const item of input.stops) {
        const visit = await this.requireVisitForMutation(
          transaction,
          principal,
          item.visitId,
          'schedule.update',
          true,
        );
        if (
          visit.status === 'cancelled' ||
          visit.organizationId !== tour.organizationId ||
          !sameTourDate(visit, tour.localDate, tour.timezone)
        ) {
          throw new InvalidTourError();
        }
        const employeeIds = await this.repository.activeEmployeeIds(
          transaction,
          principal.tenantId,
          visit.id,
        );
        if (!employeeIds.includes(tour.employeeId)) throw new InvalidTourError();
        await this.ensurePlanningMutable(transaction, visit);
        visitsForTour.push(visit);
      }
      const now = new Date();
      await this.repository.replaceTourStops(
        transaction,
        principal.tenantId,
        tour.id,
        input.stops.map((stop, index) => ({
          visitId: stop.visitId,
          sequence: index + 1,
          dispatcherNote: stop.dispatcherNote?.trim() || null,
        })),
      );
      if (
        !(await this.repository.updateTourVersion(
          transaction,
          principal.tenantId,
          tour.id,
          input.expectedVersion,
          now,
          principal.userId,
          'draft',
        ))
      ) {
        throw new TourVersionConflictError();
      }
      await this.recordTourChange(
        transaction,
        principal,
        context,
        auditContext,
        tour,
        'scheduling.tour_reordered',
        {
          employeeId: tour.employeeId,
          localDate: tour.localDate,
          visitIds: input.stops.map((stop) => stop.visitId),
        },
        now,
      );
    });
    return this.getTour(principal, tourId);
  }

  async estimateTourRoute(
    principal: AuthorizationPrincipal,
    tourId: string,
    expectedVersion: number,
  ): Promise<{ tour: TourSummary; route: RouteEstimate; conflicts: SchedulingConflict[] }> {
    const routeStops = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId);
        if (!tour) throw new TourNotFoundError();
        if (tour.version !== expectedVersion) throw new TourVersionConflictError();
        const { resource } = await this.employeeSchedulingResource(
          transaction,
          principal,
          tour.employeeId,
        );
        assertCan(principal, { action: 'schedule.update', resource });
        const rows = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        const preferences = await this.repository.employeePreferences(
          transaction,
          principal.tenantId,
          tour.employeeId,
        );
        return {
          stops: rows.map(({ stop, latitude, longitude }) => ({
            stopId: stop.id,
            visitId: stop.visitId,
            location:
              latitude === null || longitude === null
                ? null
                : { latitude: Number(latitude), longitude: Number(longitude) },
          })),
          startLocation:
            preferences?.preferredStartLatitude === null ||
            preferences?.preferredStartLongitude === null ||
            !preferences
              ? null
              : {
                  latitude: Number(preferences.preferredStartLatitude),
                  longitude: Number(preferences.preferredStartLongitude),
                },
        };
      },
    );
    const route = await this.routeProvider.estimate(
      routeStops.stops.map(({ visitId, location }) => ({ visitId, location })),
      routeStops.startLocation,
    );
    const result = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId, true);
        if (!tour) throw new TourNotFoundError();
        if (tour.version !== expectedVersion) throw new TourVersionConflictError();
        await this.repository.updateTourStopEstimates(
          transaction,
          principal.tenantId,
          tour.id,
          route.legs.map((leg) => ({
            toVisitId: leg.toVisitId,
            travelMinutes: Math.ceil(leg.durationSeconds / 60),
            distanceMeters: leg.distanceMeters,
            routeStatus: route.status,
          })),
          route.status,
        );
        const now = new Date();
        if (
          !(await this.repository.updateTourVersion(
            transaction,
            principal.tenantId,
            tour.id,
            expectedVersion,
            now,
            principal.userId,
            'draft',
          ))
        ) {
          throw new TourVersionConflictError();
        }
        const storedStops = await this.repository.tourStops(
          transaction,
          principal.tenantId,
          tour.id,
        );
        const conflicts = tourFeasibilityConflicts(
          storedStops.map((row) => row.visit as VisitData),
          storedStops.slice(1).map((row, index) => ({
            fromVisitId: storedStops[index]!.stop.visitId,
            toVisitId: row.stop.visitId,
            travelMinutes:
              row.stop.routeStatus === 'available' ? row.stop.estimatedTravelMinutes : null,
          })),
        );
        return { tour, conflicts };
      },
    );
    return {
      tour: await this.getTour(principal, tourId),
      route,
      conflicts: result.conflicts,
    };
  }

  async suggestTourOrder(
    principal: AuthorizationPrincipal,
    tourId: string,
  ): Promise<RouteOrderSuggestion & { conflicts: SchedulingConflict[] }> {
    const routeStops = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId);
        if (!tour) throw new TourNotFoundError();
        const { resource } = await this.employeeSchedulingResource(
          transaction,
          principal,
          tour.employeeId,
        );
        assertCan(principal, { action: 'schedule.read', resource });
        const rows = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        const preferences = await this.repository.employeePreferences(
          transaction,
          principal.tenantId,
          tour.employeeId,
        );
        return {
          stops: rows.map(({ stop, visit, latitude, longitude }) => ({
            visitId: stop.visitId,
            visit,
            location:
              latitude === null || longitude === null
                ? null
                : { latitude: Number(latitude), longitude: Number(longitude) },
          })),
          startLocation:
            preferences?.preferredStartLatitude === null ||
            preferences?.preferredStartLongitude === null ||
            !preferences
              ? null
              : {
                  latitude: Number(preferences.preferredStartLatitude),
                  longitude: Number(preferences.preferredStartLongitude),
                },
        };
      },
    );
    const suggestion = await this.routeProvider.suggestOrder(
      routeStops.stops.map(({ visitId, location }) => ({ visitId, location })),
      routeStops.startLocation,
    );
    const reOrdered = suggestion.visitIds
      .map((visitId) => routeStops.stops.find((stop) => stop.visitId === visitId)!)
      .filter(Boolean);
    const estimate = await this.routeProvider.estimate(
      reOrdered.map(({ visitId, location }) => ({ visitId, location })),
      routeStops.startLocation,
    );
    const conflicts = tourFeasibilityConflicts(
      reOrdered.map(({ visit }) => visit),
      estimate.legs.map((leg) => ({
        fromVisitId: leg.fromVisitId,
        toVisitId: leg.toVisitId,
        travelMinutes: Math.ceil(leg.durationSeconds / 60),
      })),
    );
    if (estimate.status !== 'available' && reOrdered.length > 1) {
      conflicts.push({
        code: 'travel_feasibility_unknown',
        severity: 'warning',
        visitId: reOrdered[1]!.visitId,
        relatedVisitId: reOrdered[0]!.visitId,
      });
    }
    return { ...suggestion, conflicts };
  }

  async publishTour(
    principal: AuthorizationPrincipal,
    tourId: string,
    expectedVersion: number,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const published = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const tour = await this.repository.getTour(transaction, principal.tenantId, tourId, true);
        if (!tour) throw new TourNotFoundError();
        if (tour.version !== expectedVersion) throw new TourVersionConflictError();
        const { resource } = await this.employeeSchedulingResource(
          transaction,
          principal,
          tour.employeeId,
        );
        assertCan(principal, { action: 'schedule.update', resource });
        const stopRows = await this.repository.tourStops(transaction, principal.tenantId, tour.id);
        if (stopRows.length === 0) throw new InvalidTourError();
        for (const row of stopRows) {
          const visit = await this.requireVisitForMutation(
            transaction,
            principal,
            row.visit.id,
            'schedule.update',
            true,
          );
          if (visit.status === 'cancelled' || !sameTourDate(visit, tour.localDate, tour.timezone)) {
            throw new InvalidTourError();
          }
          const assignments = await this.repository.activeEmployeeIds(
            transaction,
            principal.tenantId,
            visit.id,
          );
          if (!assignments.includes(tour.employeeId)) throw new InvalidTourError();
          await this.ensurePlanningMutable(transaction, visit);
          await this.ensureEmployeeAvailable(
            transaction,
            principal.tenantId,
            tour.employeeId,
            visit,
            visit.id,
          );
          if (
            await this.repository.activeProposedSubstitution(
              transaction,
              principal.tenantId,
              visit.id,
            )
          ) {
            throw new ActiveVisitSubstitutionError();
          }
        }
        const routeConflicts = tourFeasibilityConflicts(
          stopRows.map(({ visit }) => visit as VisitData),
          stopRows.slice(1).map((row, index) => ({
            fromVisitId: stopRows[index]!.stop.visitId,
            toVisitId: row.stop.visitId,
            travelMinutes:
              row.stop.routeStatus === 'available' ? row.stop.estimatedTravelMinutes : null,
          })),
        );
        const blocking = routeConflicts.filter((conflict) => conflict.severity === 'blocking');
        if (blocking.length) throw new SchedulingConflictsError(blocking);
        const now = new Date();
        const prior = await this.repository.latestTourPublication(
          transaction,
          principal.tenantId,
          tour.id,
        );
        const snapshot = stopRows.map(({ stop, visit }) => ({
          visitId: stop.visitId,
          sequence: stop.sequence,
          plannedStart: visit.plannedStart.toISOString(),
          plannedEnd: visit.plannedEnd.toISOString(),
          timezone: visit.timezone,
          employeeId: tour.employeeId,
          estimatedTravelMinutes: stop.estimatedTravelMinutes,
          estimatedDistanceMeters: stop.estimatedDistanceMeters,
          routeStatus: stop.routeStatus,
        }));
        const changes = publicationChanges(prior?.snapshot, snapshot);
        const publicationVersion = (prior?.version ?? 0) + 1;
        await this.repository.insertTourPublication(transaction, {
          id: uuidv7(),
          tenantId: principal.tenantId,
          tourId: tour.id,
          version: publicationVersion,
          employeeId: tour.employeeId,
          snapshot,
          changeSummary: changes,
          publishedAt: now,
          publishedBy: principal.userId,
        });
        if (
          !(await this.repository.updateTourVersion(
            transaction,
            principal.tenantId,
            tour.id,
            expectedVersion,
            now,
            principal.userId,
            'published',
          ))
        ) {
          throw new TourVersionConflictError();
        }
        const event = createDomainEvent({
          type: 'scheduling.tour_published',
          tenantId: principal.tenantId,
          aggregateType: 'tour',
          aggregateId: tour.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          occurredAt: now.toISOString(),
          payload: {
            tourId: tour.id,
            employeeId: tour.employeeId,
            localDate: tour.localDate,
            version: publicationVersion,
            visitIds: snapshot.map((stop) => stop.visitId),
          },
        });
        await this.record(transaction, principal, context, auditContext, {
          event,
          action: 'scheduling.tour_published',
          resourceType: 'tour',
          resourceId: tour.id,
          metadata: {
            employeeId: tour.employeeId,
            localDate: tour.localDate,
            version: publicationVersion,
            changes,
          },
        });
        return {
          tourId: tour.id,
          employeeId: tour.employeeId,
          localDate: tour.localDate,
          version: publicationVersion,
          changes,
        };
      },
    );
    return { ...published, tour: await this.getTour(principal, tourId) };
  }

  async getMyTodayTour(principal: AuthorizationPrincipal) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.repository.employeeByUser(
        transaction,
        principal.tenantId,
        principal.userId,
      );
      if (!employee) return null;
      const now = new Date();
      const utcDate = localDateInZone(now, 'UTC');
      const todayTours = await this.repository.listTours(
        transaction,
        principal.tenantId,
        employee.id,
        addCalendarDate(utcDate, -1),
        addCalendarDate(utcDate, 2),
      );
      const tour = todayTours.find(
        (candidate) => localDateInZone(now, candidate.timezone) === candidate.localDate,
      );
      if (!tour) return null;
      const { localDate, timezone } = tour;
      const publication = await this.repository.latestTourPublication(
        transaction,
        principal.tenantId,
        tour.id,
      );
      if (!publication) return null;
      const start = localDateTimeToInstant(localDate, '00:00', timezone, 'earlier');
      const until = localDateTimeToInstant(
        addCalendarDate(localDate, 1),
        '00:00',
        timezone,
        'later',
      );
      if (!start || !until) throw new InvalidTourError();
      const scheduleScope: VisitReadScope = {
        schedule: { tenantWide: true, organizationIds: [], facilityIds: [], teamIds: [] },
        client: { tenantWide: true, organizationIds: [], facilityIds: [] },
      };
      const currentVisits = await this.repository.list(transaction, {
        tenantId: principal.tenantId,
        from: start,
        until,
        scope: scheduleScope,
        employeeId: employee.id,
        page: 1,
        pageSize: 100,
        sortBy: 'plannedStart',
        sortOrder: 'asc',
      });
      const currentById = new Map(
        currentVisits.items
          .filter((visit) =>
            visit.assignments.some((assignment) => assignment.employeeId === employee.id),
          )
          .map((visit) => [visit.id, visit]),
      );
      const snapshot = Array.isArray(publication.snapshot)
        ? publication.snapshot.filter(isPublishedStop)
        : [];
      const stops = snapshot.flatMap((stop) => {
        const visit = currentById.get(stop.visitId);
        if (
          !visit ||
          visit.status === 'cancelled' ||
          !sameTourDate(visit, tour.localDate, tour.timezone)
        )
          return [];
        return [
          {
            visitId: visit.id,
            sequence: Number((stop as Record<string, unknown>).sequence),
            plannedStart: visit.plannedStart,
            plannedEnd: visit.plannedEnd,
            estimatedTravelMinutes:
              typeof (stop as Record<string, unknown>).estimatedTravelMinutes === 'number'
                ? ((stop as Record<string, unknown>).estimatedTravelMinutes as number)
                : null,
            estimatedDistanceMeters:
              typeof (stop as Record<string, unknown>).estimatedDistanceMeters === 'number'
                ? ((stop as Record<string, unknown>).estimatedDistanceMeters as number)
                : null,
            routeStatus: (stop as Record<string, unknown>).routeStatus,
          },
        ];
      });
      return {
        tourId: tour.id,
        localDate: tour.localDate,
        timezone: tour.timezone,
        version: publication.version,
        publishedAt: publication.publishedAt,
        changeSummary: Array.isArray(publication.changeSummary)
          ? publication.changeSummary.flatMap((change) => {
              if (typeof change !== 'object' || change === null) return [];
              const type = (change as Record<string, unknown>).type;
              return typeof type === 'string' ? [{ type }] : [];
            })
          : [],
        stops,
      };
    });
  }

  async getMyPublishedTours(principal: AuthorizationPrincipal, from: string, until: string) {
    if (
      !validLocalDate(from) ||
      !validLocalDate(until) ||
      until <= from ||
      dayDistance(from, until) > 31
    ) {
      throw new InvalidTourError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.repository.employeeByUser(
        transaction,
        principal.tenantId,
        principal.userId,
      );
      if (!employee) return [];
      const tours = await this.repository.listTours(
        transaction,
        principal.tenantId,
        employee.id,
        from,
        until,
      );
      const publications = await this.repository.latestTourPublicationsForTours(
        transaction,
        principal.tenantId,
        tours.map((tour) => tour.id),
      );
      const publicationsByTour = new Map(
        publications.map((publication) => [publication.tourId, publication]),
      );
      const snapshotStopsByTour = new Map(
        publications.map((publication) => [
          publication.tourId,
          Array.isArray(publication.snapshot)
            ? publication.snapshot.flatMap((value) => {
                if (!isPublishedStop(value)) return [];
                const row = value as Record<string, unknown>;
                const sequence = row.sequence;
                if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1)
                  return [];
                return [
                  {
                    visitId: value.visitId,
                    sequence,
                    estimatedTravelMinutes:
                      typeof row.estimatedTravelMinutes === 'number'
                        ? row.estimatedTravelMinutes
                        : null,
                    estimatedDistanceMeters:
                      typeof row.estimatedDistanceMeters === 'number'
                        ? row.estimatedDistanceMeters
                        : null,
                  },
                ];
              })
            : [],
        ]),
      );
      const snapshotVisitIds = [
        ...new Set(
          [...snapshotStopsByTour.values()].flatMap((stops) => stops.map((stop) => stop.visitId)),
        ),
      ];
      const currentVisits = await this.repository.visitsAssignedToEmployeeByIds(
        transaction,
        principal.tenantId,
        employee.id,
        snapshotVisitIds,
      );
      const currentVisitsById = new Map(currentVisits.map((visit) => [visit.id, visit]));
      const publishedTours = [];
      for (const tour of tours) {
        const publication = publicationsByTour.get(tour.id);
        if (!publication) continue;
        const stops = (snapshotStopsByTour.get(tour.id) ?? []).filter((stop) => {
          const visit = currentVisitsById.get(stop.visitId);
          return visit !== undefined && sameTourDate(visit, tour.localDate, tour.timezone);
        });
        if (!stops.length) continue;
        publishedTours.push({
          tourId: tour.id,
          localDate: tour.localDate,
          timezone: tour.timezone,
          version: publication.version,
          publishedAt: publication.publishedAt.toISOString(),
          changeSummary: Array.isArray(publication.changeSummary)
            ? publication.changeSummary.flatMap((change) => {
                if (typeof change !== 'object' || change === null) return [];
                const type = (change as Record<string, unknown>).type;
                return typeof type === 'string' ? [{ type }] : [];
              })
            : [],
          stops,
        });
      }
      return publishedTours;
    });
  }

  async setClientRoutingLocation(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: { latitude: number; longitude: number },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !Number.isFinite(input.latitude) ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      !Number.isFinite(input.longitude) ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      throw new InvalidTourError();
    }
    const savedClientId = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const client = await this.clients.getForServiceAgreement(
          transaction,
          principal,
          clientId,
          true,
        );
        if (!client.organizationId || !client.primaryFacilityId)
          throw new VisitOutsideProviderContextError();
        assertCan(principal, {
          action: 'schedule.update',
          resource: {
            tenantId: principal.tenantId,
            clientId: client.id,
            organizationId: client.organizationId,
            facilityId: client.primaryFacilityId,
          },
        });
        const now = new Date();
        await this.repository.upsertClientRoutingLocation(transaction, {
          id: uuidv7(),
          tenantId: principal.tenantId,
          clientId: client.id,
          latitude: input.latitude.toFixed(6),
          longitude: input.longitude.toFixed(6),
          updatedAt: now,
          updatedBy: principal.userId,
        });
        const event = createDomainEvent({
          type: 'scheduling.routing_location_updated',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: client.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          occurredAt: now.toISOString(),
          payload: { clientId: client.id },
        });
        await this.record(transaction, principal, context, auditContext, {
          event,
          action: 'scheduling.routing_location_updated',
          resourceType: 'client',
          resourceId: client.id,
          metadata: { clientId: client.id },
        });
        return client.id;
      },
    );
    return { clientId: savedClientId, ...input };
  }

  async getClientRoutingLocation(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(transaction, principal, clientId);
      if (!client.organizationId || !client.primaryFacilityId)
        throw new VisitOutsideProviderContextError();
      assertCan(principal, {
        action: 'schedule.update',
        resource: {
          tenantId: principal.tenantId,
          clientId: client.id,
          organizationId: client.organizationId,
          facilityId: client.primaryFacilityId,
        },
      });
      const location = await this.repository.clientRoutingLocation(
        transaction,
        principal.tenantId,
        client.id,
      );
      return location
        ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
        : null;
    });
  }

  async saveEmployeeSchedulingPreferences(
    principal: AuthorizationPrincipal,
    input: {
      employeeId: string;
      preferredWeekdays: number[];
      preferredTimeWindows: Array<{ startsAt: string; endsAt: string }>;
      preferredStartLatitude: number | null;
      preferredStartLongitude: number | null;
      travelMode: 'driving';
    },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    validatePreferences(input.preferredWeekdays, input.preferredTimeWindows);
    validateCoordinatePair(input.preferredStartLatitude, input.preferredStartLongitude);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        input.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.repository.upsertEmployeeSchedulingPreferences(transaction, {
        id: uuidv7(),
        tenantId: principal.tenantId,
        employeeId: employee.id,
        preferredWeekdays: input.preferredWeekdays,
        preferredTimeWindows: input.preferredTimeWindows,
        preferredStartLatitude: input.preferredStartLatitude?.toFixed(6) ?? null,
        preferredStartLongitude: input.preferredStartLongitude?.toFixed(6) ?? null,
        travelMode: input.travelMode,
        updatedAt: new Date(),
        updatedBy: principal.userId,
      });
      const event = createDomainEvent({
        type: 'scheduling.preferences_changed',
        tenantId: principal.tenantId,
        aggregateType: 'employee',
        aggregateId: employee.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        occurredAt: new Date().toISOString(),
        payload: { subjectType: 'employee', subjectId: employee.id },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'scheduling.preferences_changed',
        resourceType: 'employee',
        resourceId: employee.id,
        metadata: { subjectType: 'employee', subjectId: employee.id },
      });
      return employeeSchedulingPreferencesResponse(
        await this.repository.employeePreferences(transaction, principal.tenantId, employee.id),
      );
    });
  }

  async saveClientSchedulingPreferences(
    principal: AuthorizationPrincipal,
    input: {
      clientId: string;
      preferredWeekdays: number[];
      preferredTimeWindows: Array<{ startsAt: string; endsAt: string }>;
      preferredEmployeeId: string | null;
      avoidedEmployeeIds: string[];
    },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    validatePreferences(input.preferredWeekdays, input.preferredTimeWindows);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(
        transaction,
        principal,
        input.clientId,
        true,
      );
      if (!client.organizationId || !client.primaryFacilityId)
        throw new VisitOutsideProviderContextError();
      assertCan(principal, {
        action: 'schedule.update',
        resource: {
          tenantId: principal.tenantId,
          clientId: client.id,
          organizationId: client.organizationId,
          facilityId: client.primaryFacilityId,
        },
      });
      const employeeIds = [
        ...(input.preferredEmployeeId ? [input.preferredEmployeeId] : []),
        ...input.avoidedEmployeeIds,
      ];
      if (new Set(employeeIds).size !== employeeIds.length) throw new InvalidTourError();
      for (const employeeId of employeeIds) {
        await this.employees.validateForScheduling(
          transaction,
          principal.tenantId,
          employeeId,
          client.organizationId,
          client.primaryFacilityId,
          localDateInZone(new Date(), 'Europe/Berlin'),
        );
      }
      await this.repository.upsertClientSchedulingPreferences(transaction, {
        id: uuidv7(),
        tenantId: principal.tenantId,
        clientId: client.id,
        preferredWeekdays: input.preferredWeekdays,
        preferredTimeWindows: input.preferredTimeWindows,
        preferredEmployeeId: input.preferredEmployeeId,
        avoidedEmployeeIds: input.avoidedEmployeeIds,
        updatedAt: new Date(),
        updatedBy: principal.userId,
      });
      const event = createDomainEvent({
        type: 'scheduling.preferences_changed',
        tenantId: principal.tenantId,
        aggregateType: 'client',
        aggregateId: client.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        occurredAt: new Date().toISOString(),
        payload: { subjectType: 'client', subjectId: client.id },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'scheduling.preferences_changed',
        resourceType: 'client',
        resourceId: client.id,
        metadata: { subjectType: 'client', subjectId: client.id },
      });
      return clientSchedulingPreferencesResponse(
        await this.repository.clientPreferences(transaction, principal.tenantId, client.id),
      );
    });
  }

  async getEmployeeSchedulingPreferences(principal: AuthorizationPrincipal, employeeId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      return employeeSchedulingPreferencesResponse(
        await this.repository.employeePreferences(transaction, principal.tenantId, employee.id),
      );
    });
  }

  async getClientSchedulingPreferences(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(transaction, principal, clientId);
      if (!client.organizationId || !client.primaryFacilityId)
        throw new VisitOutsideProviderContextError();
      assertCan(principal, {
        action: 'schedule.update',
        resource: {
          tenantId: principal.tenantId,
          clientId: client.id,
          organizationId: client.organizationId,
          facilityId: client.primaryFacilityId,
        },
      });
      return clientSchedulingPreferencesResponse(
        await this.repository.clientPreferences(transaction, principal.tenantId, client.id),
      );
    });
  }

  async getWorklist(principal: AuthorizationPrincipal, query: VisitSearchQuery) {
    const result = await this.search(principal, query);
    const nowActive = result.items.filter((visit) => visit.status !== 'cancelled');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const conflictsByVisit = new Map<string, SchedulingConflict[]>();
      const addConflict = (conflict: SchedulingConflict) => {
        const list = conflictsByVisit.get(conflict.visitId) ?? [];
        list.push(conflict);
        conflictsByVisit.set(conflict.visitId, list);
      };
      for (const visit of nowActive) {
        if (visit.assignments.length === 0) {
          addConflict({ code: 'missing_assignment', severity: 'blocking', visitId: visit.id });
        }
      }
      const allEmployeeIds = [
        ...new Set(nowActive.flatMap((visit) => visit.assignments.map((item) => item.employeeId))),
      ];
      const allClientIds = [...new Set(nowActive.map((visit) => visit.clientId))];
      const absences = await this.repository.unavailabilityForEmployees(
        transaction,
        principal.tenantId,
        allEmployeeIds,
        query.from,
        query.until,
      );
      const employeePreferences = await this.repository.employeePreferencesForEmployees(
        transaction,
        principal.tenantId,
        allEmployeeIds,
      );
      const clientPreferences = await this.repository.clientPreferencesForClients(
        transaction,
        principal.tenantId,
        allClientIds,
      );
      const pendingSubstitutions = await this.repository.proposedSubstitutionsForVisits(
        transaction,
        principal.tenantId,
        nowActive.map((visit) => visit.id),
      );
      const tourRows = await this.repository.tourStopsForVisits(
        transaction,
        principal.tenantId,
        nowActive.map((visit) => visit.id),
      );
      const employeePreferenceById = new Map(
        employeePreferences.map((item) => [item.employeeId, item]),
      );
      const clientPreferenceById = new Map(clientPreferences.map((item) => [item.clientId, item]));
      const proposedByVisit = new Set(pendingSubstitutions.map((item) => item.visitId));
      for (const visit of nowActive) {
        const weekday = weekdayNumber(visit.plannedStart, visit.timezone);
        const minutes = timeMinutesInZone(visit.plannedStart, visit.timezone);
        const clientPreference = clientPreferenceById.get(visit.clientId);
        if (
          clientPreference &&
          ((clientPreference.preferredWeekdays.length > 0 &&
            !clientPreference.preferredWeekdays.includes(weekday)) ||
            (clientPreference.preferredEmployeeId !== null &&
              !visit.assignments.some(
                (assignment) => assignment.employeeId === clientPreference.preferredEmployeeId,
              )) ||
            (clientPreference.preferredTimeWindows.length > 0 &&
              !clientPreference.preferredTimeWindows.some(
                (window) =>
                  minutes >= timeStringMinutes(window.startsAt) &&
                  minutes < timeStringMinutes(window.endsAt),
              )))
        ) {
          addConflict({ code: 'client_preference', severity: 'warning', visitId: visit.id });
        }
        for (const assignment of visit.assignments) {
          const absence = absences.find(
            (item) =>
              item.employeeId === assignment.employeeId &&
              item.startsAt < visit.plannedEnd &&
              item.endsAt > visit.plannedStart,
          );
          if (absence) {
            addConflict({
              code: 'employee_absence',
              severity: 'blocking',
              visitId: visit.id,
              employeeId: assignment.employeeId,
            });
          }
          const availability = await this.repository.availabilityForEmployee(
            transaction,
            principal.tenantId,
            assignment.employeeId,
          );
          if (!availability) {
            addConflict({
              code: 'employee_availability_unknown',
              severity: 'warning',
              visitId: visit.id,
              employeeId: assignment.employeeId,
            });
          } else if (
            availabilityForVisit(visit.plannedStart, visit.plannedEnd, availability.value) ===
            'outside'
          ) {
            addConflict({
              code: 'outside_employee_availability',
              severity: 'blocking',
              visitId: visit.id,
              employeeId: assignment.employeeId,
            });
          }
          const preference = employeePreferenceById.get(assignment.employeeId);
          if (
            preference &&
            ((preference.preferredWeekdays.length > 0 &&
              !preference.preferredWeekdays.includes(weekday)) ||
              (preference.preferredTimeWindows.length > 0 &&
                !preference.preferredTimeWindows.some(
                  (window) =>
                    minutes >= timeStringMinutes(window.startsAt) &&
                    minutes < timeStringMinutes(window.endsAt),
                )))
          ) {
            addConflict({
              code: 'employee_preference',
              severity: 'warning',
              visitId: visit.id,
              employeeId: assignment.employeeId,
            });
          }
          if (clientPreference?.avoidedEmployeeIds.includes(assignment.employeeId)) {
            addConflict({
              code: 'client_preference',
              severity: 'warning',
              visitId: visit.id,
              employeeId: assignment.employeeId,
            });
          }
        }
        if (proposedByVisit.has(visit.id)) {
          addConflict({
            code: 'substitution_awaiting_confirmation',
            severity: 'warning',
            visitId: visit.id,
          });
        }
      }
      addOverlappingConflicts(nowActive, addConflict);
      const tourGroups = [...groupBy(tourRows, (row) => row.tour.id).values()];
      const routedPairs = new Set<string>();
      for (const rows of tourGroups) {
        if (rows[0]?.tour.status === 'draft') {
          for (const row of rows) {
            addConflict({
              code: 'unpublished_schedule_changes',
              severity: 'warning',
              visitId: row.stop.visitId,
              employeeId: row.tour.employeeId,
            });
          }
        }
        for (let index = 1; index < rows.length; index += 1) {
          const prior = rows[index - 1]!;
          const current = rows[index]!;
          routedPairs.add(`${prior.stop.visitId}:${current.stop.visitId}`);
          if (
            current.stop.routeStatus !== 'available' ||
            current.stop.estimatedTravelMinutes === null
          ) {
            addConflict({
              code: 'travel_feasibility_unknown',
              severity: 'warning',
              visitId: current.stop.visitId,
              relatedVisitId: prior.stop.visitId,
            });
            continue;
          }
          const priorVisit = nowActive.find((visit) => visit.id === prior.stop.visitId);
          const currentVisit = nowActive.find((visit) => visit.id === current.stop.visitId);
          if (!priorVisit || !currentVisit) continue;
          const availableMinutes = Math.floor(
            (currentVisit.plannedStart.getTime() - priorVisit.plannedEnd.getTime()) / 60_000,
          );
          if (current.stop.estimatedTravelMinutes > availableMinutes) {
            addConflict({
              code: 'insufficient_travel_time',
              severity: 'blocking',
              visitId: current.stop.visitId,
              relatedVisitId: prior.stop.visitId,
              requiredMinutes: current.stop.estimatedTravelMinutes,
              availableMinutes: Math.max(0, availableMinutes),
            });
          }
        }
      }
      const byEmployee = new Map<string, VisitCalendarRow[]>();
      for (const visit of nowActive) {
        for (const assignment of visit.assignments) {
          const group = byEmployee.get(assignment.employeeId) ?? [];
          group.push(visit);
          byEmployee.set(assignment.employeeId, group);
        }
      }
      for (const [employeeId, rows] of byEmployee) {
        const ordered = [...rows].sort(compareTourStops);
        for (let index = 1; index < ordered.length; index += 1) {
          const previous = ordered[index - 1]!;
          const current = ordered[index]!;
          if (
            previous.plannedEnd <= current.plannedStart &&
            !routedPairs.has(`${previous.id}:${current.id}`)
          ) {
            addConflict({
              code: 'travel_feasibility_unknown',
              severity: 'warning',
              visitId: current.id,
              relatedVisitId: previous.id,
              employeeId,
            });
          }
        }
      }
      return {
        ...result,
        items: result.items.map((visit) => ({
          visit,
          conflicts: conflictsByVisit.get(visit.id) ?? [],
          proposedSubstitutions: pendingSubstitutions.filter((item) => item.visitId === visit.id),
        })),
      };
    });
  }

  async getWorklistForVisit(principal: AuthorizationPrincipal, visitId: string) {
    const current = await this.get(principal, visitId);
    const localDate = dateInTimeZone(current.visit.plannedStart, current.visit.timezone);
    const from = localDateTimeToInstant(
      addCalendarDate(localDate, -1),
      '00:00',
      current.visit.timezone,
      'earlier',
    );
    const until = localDateTimeToInstant(
      addCalendarDate(localDate, 2),
      '00:00',
      current.visit.timezone,
      'later',
    );
    if (!from || !until) return { complete: false as const, item: null };

    const result = await this.getWorklist(principal, {
      from,
      until,
      relatedToVisitId: visitId,
      page: 1,
      pageSize: 100,
    });
    if (result.total > result.items.length) return { complete: false as const, item: null };
    return {
      complete: true as const,
      item: result.items.find((row) => row.visit.id === visitId) ?? null,
    };
  }

  async getEmployeeAvailability(
    principal: AuthorizationPrincipal,
    employeeId: string,
  ): Promise<{ employeeId: string; version: number; availability: EmployeeAvailability | null }> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.read', resource });
      const current = await this.repository.availabilityForEmployee(
        transaction,
        principal.tenantId,
        employee.id,
      );
      return {
        employeeId: employee.id,
        version: current?.version ?? 0,
        availability: current?.value ?? null,
      };
    });
  }

  async saveEmployeeAvailability(
    principal: AuthorizationPrincipal,
    input: EmployeeAvailabilityInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<{ employeeId: string; version: number; availability: EmployeeAvailability }> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new InvalidEmployeeAvailabilityError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        input.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [`employee:${employee.id}`]);
      const current = await this.repository.availabilityForEmployee(
        transaction,
        principal.tenantId,
        employee.id,
      );
      if ((current?.version ?? 0) !== input.expectedVersion) {
        throw new SchedulingVersionConflictError();
      }
      const next: EmployeeAvailability = {
        timezone: input.timezone,
        maxDailyMinutes: input.maxDailyMinutes,
        travelBufferMinutes: input.travelBufferMinutes,
        windows: input.windows,
        exceptions: current?.value.exceptions ?? [],
      };
      validateEmployeeAvailability(next);
      const now = new Date();
      const availabilityId = current?.id ?? uuidv7();
      if (current) {
        const updated = await this.repository.updateAvailabilityProfile(
          transaction,
          principal.tenantId,
          employee.id,
          input.expectedVersion,
          {
            timezone: next.timezone,
            maxDailyMinutes: next.maxDailyMinutes,
            travelBufferMinutes: next.travelBufferMinutes,
            updatedAt: now,
          },
        );
        if (!updated) throw new SchedulingVersionConflictError();
      } else {
        await this.repository.insertAvailabilityProfile(transaction, {
          id: availabilityId,
          tenantId: principal.tenantId,
          employeeId: employee.id,
          timezone: next.timezone,
          maxDailyMinutes: next.maxDailyMinutes,
          travelBufferMinutes: next.travelBufferMinutes,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      await this.repository.replaceAvailabilityWindows(
        transaction,
        principal.tenantId,
        availabilityId,
        next.windows.map((window) => ({
          id: uuidv7(),
          tenantId: principal.tenantId,
          availabilityId,
          weekday: window.weekday,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
        })),
      );
      const version = input.expectedVersion + 1;
      await this.recordAvailabilityChange(
        transaction,
        principal,
        context,
        auditContext,
        employee.id,
        version,
        now,
        'weekly_hours_updated',
      );
      const saved = await this.repository.availabilityForEmployee(
        transaction,
        principal.tenantId,
        employee.id,
      );
      if (!saved) throw new InvalidEmployeeAvailabilityError();
      return { employeeId: employee.id, version, availability: saved.value };
    });
  }

  async createAvailabilityException(
    principal: AuthorizationPrincipal,
    input: EmployeeAvailabilityExceptionInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<{
    id: string;
    employeeId: string;
    version: number;
    exception: AvailabilityException;
  }> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new InvalidEmployeeAvailabilityError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        input.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [`employee:${employee.id}`]);
      const current = await this.repository.availabilityForEmployee(
        transaction,
        principal.tenantId,
        employee.id,
      );
      if (!current) throw new InvalidEmployeeAvailabilityError();
      if (current.version !== input.expectedVersion) throw new SchedulingVersionConflictError();
      const exception: AvailabilityException = {
        localDate: input.localDate,
        kind: input.kind,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      };
      validateEmployeeAvailability({
        ...current.value,
        exceptions: [...current.value.exceptions, exception],
      });
      const now = new Date();
      const updated = await this.repository.updateAvailabilityProfile(
        transaction,
        principal.tenantId,
        employee.id,
        input.expectedVersion,
        {
          timezone: current.value.timezone,
          maxDailyMinutes: current.value.maxDailyMinutes,
          travelBufferMinutes: current.value.travelBufferMinutes,
          updatedAt: now,
        },
      );
      if (!updated) throw new SchedulingVersionConflictError();
      const id = uuidv7();
      await this.repository.insertAvailabilityException(transaction, {
        id,
        tenantId: principal.tenantId,
        employeeId: employee.id,
        localDate: exception.localDate,
        kind: exception.kind,
        startsAt: exception.startsAt,
        endsAt: exception.endsAt,
        createdAt: now,
      });
      const version = input.expectedVersion + 1;
      await this.recordAvailabilityChange(
        transaction,
        principal,
        context,
        auditContext,
        employee.id,
        version,
        now,
        'exception_added',
      );
      return { id, employeeId: employee.id, version, exception };
    });
  }

  async deleteAvailabilityException(
    principal: AuthorizationPrincipal,
    employeeId: string,
    exceptionId: string,
    expectedVersion: number,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<void> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new InvalidEmployeeAvailabilityError();
    }
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [`employee:${employee.id}`]);
      const current = await this.repository.availabilityForEmployee(
        transaction,
        principal.tenantId,
        employee.id,
      );
      if (!current) throw new AvailabilityExceptionNotFoundError();
      if (current.version !== expectedVersion) throw new SchedulingVersionConflictError();
      const now = new Date();
      const updated = await this.repository.updateAvailabilityProfile(
        transaction,
        principal.tenantId,
        employee.id,
        expectedVersion,
        {
          timezone: current.value.timezone,
          maxDailyMinutes: current.value.maxDailyMinutes,
          travelBufferMinutes: current.value.travelBufferMinutes,
          updatedAt: now,
        },
      );
      if (!updated) throw new SchedulingVersionConflictError();
      if (
        !(await this.repository.deleteAvailabilityException(
          transaction,
          principal.tenantId,
          employee.id,
          exceptionId,
        ))
      ) {
        throw new AvailabilityExceptionNotFoundError();
      }
      await this.recordAvailabilityChange(
        transaction,
        principal,
        context,
        auditContext,
        employee.id,
        expectedVersion + 1,
        now,
        'exception_removed',
      );
    });
  }

  async listUnavailability(
    principal: AuthorizationPrincipal,
    employeeId: string,
    from: Date,
    until: Date,
  ) {
    if (
      !validInstant(from) ||
      !validInstant(until) ||
      until <= from ||
      until.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000
    ) {
      throw new InvalidVisitQueryError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.read', resource });
      const absences = await this.repository.listUnavailability(
        transaction,
        principal.tenantId,
        employee.id,
        from,
        until,
      );
      const scheduleScope = visitReadScope(principal);
      const visits = await this.repository.list(transaction, {
        tenantId: principal.tenantId,
        from,
        until,
        scope: scheduleScope,
        employeeId: employee.id,
        page: 1,
        pageSize: 100,
        sortBy: 'plannedStart',
        sortOrder: 'asc',
      });
      const activeAbsences = absences.filter((absence) => absence.status === 'active');
      const impactedVisits = visits.items.filter(
        (visit) =>
          visit.status !== 'cancelled' &&
          visit.assignments.some((assignment) => assignment.employeeId === employee.id) &&
          activeAbsences.some(
            (absence) => visit.plannedStart < absence.endsAt && visit.plannedEnd > absence.startsAt,
          ),
      );
      return {
        absences: absences.map(({ note: _protectedNote, ...absence }) => absence),
        impactedVisits,
        impactedVisitCount: impactedVisits.length,
      };
    });
  }

  async createUnavailability(
    principal: AuthorizationPrincipal,
    input: EmployeeUnavailabilityInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if ((input.note?.length ?? 0) > 1000 || !isAbsenceReason(input.reason ?? 'other')) {
      throw new InvalidEmployeeUnavailabilityError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        input.employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [`employee:${employee.id}`]);
      const range = resolveEmployeeAbsenceRange(input);
      if (!range) throw new InvalidEmployeeUnavailabilityError();
      const id = uuidv7();
      const now = new Date();
      await this.repository.insertUnavailability(transaction, {
        id,
        tenantId: principal.tenantId,
        employeeId: employee.id,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        reason: input.reason ?? 'other',
        status: 'active',
        note: input.note?.trim() || null,
        createdAt: now,
        createdBy: principal.userId,
        updatedAt: now,
        updatedBy: principal.userId,
      });
      const event = createDomainEvent({
        type: 'scheduling.absence_recorded',
        tenantId: principal.tenantId,
        aggregateType: 'employee_availability',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { employeeId: employee.id, absenceId: id, reason: input.reason ?? 'other' },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'scheduling.absence_recorded',
        resourceType: 'employee_availability',
        resourceId: id,
        metadata: { employeeId: employee.id, reason: input.reason ?? 'other' },
      });
      return {
        id,
        employeeId: employee.id,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        reason: input.reason ?? 'other',
        status: 'active' as const,
      };
    });
  }

  async cancelUnavailability(
    principal: AuthorizationPrincipal,
    employeeId: string,
    absenceId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<void> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, resource } = await this.employeeSchedulingResource(
        transaction,
        principal,
        employeeId,
      );
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [`employee:${employee.id}`]);
      const now = new Date();
      if (
        !(await this.repository.cancelUnavailability(
          transaction,
          principal.tenantId,
          employee.id,
          absenceId,
          now,
          principal.userId,
        ))
      ) {
        throw new EmployeeUnavailabilityNotFoundError();
      }
      const event = createDomainEvent({
        type: 'scheduling.absence_cancelled',
        tenantId: principal.tenantId,
        aggregateType: 'employee_availability',
        aggregateId: absenceId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        occurredAt: now.toISOString(),
        payload: { employeeId: employee.id, absenceId },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'scheduling.absence_cancelled',
        resourceType: 'employee_availability',
        resourceId: absenceId,
        metadata: { employeeId: employee.id },
      });
    });
  }

  private async changeVisitStatus(
    principal: AuthorizationPrincipal,
    visitId: string,
    operation: 'confirm' | 'unconfirm' | 'cancel',
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitSnapshot> {
    const permission = operation === 'cancel' ? 'schedule.cancel' : 'schedule.confirm';
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisitForMutation(
        transaction,
        principal,
        visitId,
        permission,
        true,
      );
      await this.ensurePlanningMutable(transaction, visit);
      const lifecycle = new VisitLifecycle(visit.status);
      const status =
        operation === 'confirm'
          ? lifecycle.confirm()
          : operation === 'unconfirm'
            ? lifecycle.unconfirm()
            : lifecycle.cancel();
      const next = { ...visit, status, updatedAt: nextVisitUpdatedAt(visit.updatedAt) };
      await this.repository.updateVisit(transaction, next);
      if (operation === 'cancel') {
        await this.invalidateToursForVisit(
          transaction,
          principal.tenantId,
          next,
          principal.userId,
          next.updatedAt,
        );
      }
      const action =
        operation === 'confirm'
          ? 'visit.confirmed'
          : operation === 'unconfirm'
            ? 'visit.unconfirmed'
            : 'visit.cancelled';
      const type =
        operation === 'confirm'
          ? 'visit.confirmed'
          : operation === 'unconfirm'
            ? 'visit.unconfirmed'
            : 'visit.cancelled';
      const event = createDomainEvent({
        type,
        tenantId: principal.tenantId,
        aggregateType: 'visit',
        aggregateId: visit.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { visitId: visit.id, clientId: visit.clientId },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action,
        resourceType: 'visit',
        resourceId: visit.id,
        metadata: { clientId: visit.clientId, status },
      });
      return {
        ...next,
        services: await this.repository.servicesForVisit(transaction, principal.tenantId, visit.id),
      };
    });
  }

  private async requireReadableVisit(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    visitId: string,
  ): Promise<VisitData> {
    const visit = await this.repository.get(transaction, principal.tenantId, visitId);
    if (!visit) throw new VisitNotFoundError();
    await this.clients.getForServiceAgreement(transaction, principal, visit.clientId);
    const scope = visitReadScope(principal);
    const entry = await this.repository.getCalendarEntry(
      transaction,
      {
        tenantId: principal.tenantId,
        from: new Date(visit.plannedStart.getTime() - 1),
        until: new Date(visit.plannedEnd.getTime() + 1),
        scope,
        page: 1,
        pageSize: 1,
        sortBy: 'plannedStart',
        sortOrder: 'asc',
      },
      visitId,
    );
    if (!entry) throw new VisitNotFoundError();
    return visit;
  }

  private async ensurePlanningMutable(
    transaction: DatabaseTransaction,
    visit: VisitData,
  ): Promise<void> {
    if (await this.executionGuard?.hasExecutionForVisit(transaction, visit.tenantId, visit.id)) {
      throw new VisitExecutionPlanningLockedError();
    }
  }

  private async requireVisitForMutation(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    visitId: string,
    permission: Permission,
    lock: boolean,
  ): Promise<VisitData> {
    const visit = await this.repository.get(transaction, principal.tenantId, visitId, lock);
    if (!visit) throw new VisitNotFoundError();
    const client = await this.clients.getForServiceAgreement(
      transaction,
      principal,
      visit.clientId,
      lock,
    );
    assertCan(principal, {
      action: permission,
      resource: {
        tenantId: visit.tenantId,
        clientId: visit.clientId,
        organizationId: visit.organizationId,
        facilityId: visit.facilityId,
      },
    });
    if (
      client.organizationId !== visit.organizationId ||
      client.primaryFacilityId !== visit.facilityId
    ) {
      throw new VisitOutsideProviderContextError();
    }
    return visit;
  }

  private async providerForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    client: ClientSnapshot,
  ) {
    if (!client.organizationId || !client.primaryFacilityId || client.status === 'archived') {
      throw new VisitOutsideProviderContextError();
    }
    const provider = await this.organizations.activeProviderContextForAgreement(
      transaction,
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
      true,
    );
    if (!provider) throw new VisitOutsideProviderContextError();
    return {
      organizationId: provider.organizationId,
      facilityId: provider.facilityId,
      organizationName: provider.organizationName,
      facilityName: provider.facilityName,
      timezone: provider.facilityTimezone ?? provider.organizationTimezone ?? 'Europe/Berlin',
    };
  }

  private validateAgreementContext(
    agreement: ServiceAgreementSnapshot,
    client: ClientSnapshot,
    provider: { organizationId: string; facilityId: string },
  ): void {
    if (
      agreement.clientId !== client.id ||
      agreement.organizationId !== provider.organizationId ||
      agreement.facilityId !== provider.facilityId
    ) {
      throw new VisitAgreementInvalidError();
    }
  }

  private async resolveManualServices(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    inputs: ScheduleVisitServiceInput[],
    agreementSource: {
      agreement: ServiceAgreementSnapshot;
      services: AgreementServiceSnapshot[];
    } | null,
    onDate: string,
    provider: { organizationId: string; facilityId: string },
    now: Date,
  ): Promise<VisitServiceData[]> {
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 20) {
      throw new InvalidVisitServiceError();
    }
    const output: VisitServiceData[] = [];
    for (const input of inputs) {
      let service: Pick<
        ServiceDefinitionSnapshot,
        'id' | 'code' | 'name' | 'unit' | 'defaultDurationMinutes'
      >;
      let agreementService: AgreementServiceSnapshot | undefined;
      if (input.agreementServiceId) {
        agreementService = agreementSource?.services.find(
          (line) => line.id === input.agreementServiceId,
        );
        if (
          !agreementSource ||
          agreementSource.agreement.status !== 'active' ||
          !agreementService ||
          agreementService.status !== 'active' ||
          agreementService.serviceDefinitionId !== input.serviceDefinitionId ||
          !isDateWithin(
            onDate,
            agreementSource.agreement.validFrom,
            agreementSource.agreement.validUntil,
          ) ||
          !isDateWithin(onDate, agreementService.validFrom, agreementService.validUntil)
        ) {
          throw new VisitAgreementServiceInvalidError();
        }
        const catalog = await this.services.getForAgreement(transaction, principal, {
          serviceDefinitionId: agreementService.serviceDefinitionId,
          organizationId: provider.organizationId,
          facilityId: provider.facilityId,
          validFrom: onDate,
          validUntil: onDate,
          lock: true,
        });
        service = catalog;
      } else {
        service = await this.services.getForAgreement(transaction, principal, {
          serviceDefinitionId: input.serviceDefinitionId,
          organizationId: provider.organizationId,
          facilityId: provider.facilityId,
          validFrom: onDate,
          validUntil: onDate,
          lock: true,
        });
      }
      const plannedQuantity = input.plannedQuantity ?? agreementService?.quantity ?? '1';
      const plannedDurationMinutes =
        input.plannedDurationMinutes === undefined
          ? service.defaultDurationMinutes
          : input.plannedDurationMinutes;
      const line: VisitServiceData = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        visitId: '',
        serviceAgreementId: agreementService ? agreementSource!.agreement.id : null,
        agreementServiceId: agreementService?.id ?? null,
        serviceDefinitionId: service.id,
        serviceCodeSnapshot: agreementService?.serviceCode ?? service.code,
        serviceNameSnapshot: agreementService?.serviceName ?? service.name,
        unitSnapshot: agreementService?.serviceUnit ?? service.unit,
        plannedQuantity,
        plannedDurationMinutes,
        generationKey: null,
        generatedFromRule: false,
        createdAt: now,
        updatedAt: now,
      };
      validateVisitService(line);
      output.push(line);
    }
    return output;
  }

  private async validateEmployeeAssignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    visit: VisitData,
  ) {
    const employee = await this.employees.validateForScheduling(
      transaction,
      tenantId,
      employeeId,
      visit.organizationId,
      visit.facilityId,
      dateInTimeZone(visit.plannedStart, visit.timezone),
    );
    await this.ensureEmployeeAvailable(transaction, tenantId, employeeId, visit);
    return employee;
  }

  private async ensureClientAvailable(
    transaction: DatabaseTransaction,
    visit: VisitData,
    excludeVisitId?: string,
  ): Promise<void> {
    const conflict = await this.repository.findClientConflict(transaction, {
      tenantId: visit.tenantId,
      clientId: visit.clientId,
      plannedStart: visit.plannedStart,
      plannedEnd: visit.plannedEnd,
      ...(excludeVisitId === undefined ? {} : { excludeVisitId }),
    });
    if (conflict) throw new VisitClientConflictError(conflict.plannedStart, conflict.plannedEnd);
  }

  private async ensureEmployeeAvailable(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    visit: VisitData,
    excludeVisitId?: string,
  ): Promise<void> {
    const conflict = await this.repository.findEmployeeConflict(transaction, {
      tenantId,
      employeeId,
      plannedStart: visit.plannedStart,
      plannedEnd: visit.plannedEnd,
      ...(excludeVisitId === undefined ? {} : { excludeVisitId }),
    });
    if (conflict) {
      throw new VisitEmployeeConflictError(
        conflict.visit.plannedStart,
        conflict.visit.plannedEnd,
        conflict.visit.timezone,
      );
    }
    if (
      await this.repository.isEmployeeUnavailable(
        transaction,
        tenantId,
        employeeId,
        visit.plannedStart,
        visit.plannedEnd,
      )
    ) {
      throw new VisitEmployeeUnavailableError();
    }
    const availability = await this.repository.availabilityForEmployee(
      transaction,
      tenantId,
      employeeId,
    );
    if (
      availability &&
      availabilityForVisit(visit.plannedStart, visit.plannedEnd, availability.value) === 'outside'
    ) {
      throw new VisitOutsideEmployeeAvailabilityError();
    }
    if (availability) {
      const dates = calendarDates(
        dateInTimeZone(visit.plannedStart, availability.value.timezone),
        dateInTimeZone(visit.plannedEnd, availability.value.timezone),
      );
      const dayRanges = dates.map((date) => {
        const nextDate = addCalendarDate(date, 1);
        const startsAt = localDateTimeToInstant(
          date,
          '00:00',
          availability.value.timezone,
          'earlier',
        );
        const endsAt = localDateTimeToInstant(
          nextDate,
          '00:00',
          availability.value.timezone,
          'later',
        );
        if (!startsAt || !endsAt || endsAt <= startsAt)
          throw new InvalidEmployeeAvailabilityError();
        return { startsAt, endsAt };
      });
      const bufferMs = availability.value.travelBufferMinutes * 60_000;
      const assigned = await this.repository.assignedVisitsForEmployee(
        transaction,
        tenantId,
        employeeId,
        new Date(dayRanges[0]!.startsAt.getTime() - bufferMs),
        new Date(dayRanges.at(-1)!.endsAt.getTime() + bufferMs),
        excludeVisitId,
      );
      const stops = [...assigned, visit].sort(
        (left, right) =>
          left.plannedStart.getTime() - right.plannedStart.getTime() ||
          left.id.localeCompare(right.id),
      );
      const visitIndex = stops.findIndex((stop) => stop.id === visit.id);
      const previous = visitIndex > 0 ? stops[visitIndex - 1] : undefined;
      const next = visitIndex >= 0 ? stops[visitIndex + 1] : undefined;
      if (
        bufferMs > 0 &&
        ((previous && visit.plannedStart.getTime() - previous.plannedEnd.getTime() < bufferMs) ||
          (next && next.plannedStart.getTime() - visit.plannedEnd.getTime() < bufferMs))
      ) {
        throw new VisitTravelBufferConflictError();
      }
      if (availability.value.maxDailyMinutes !== null) {
        for (let index = 0; index < dayRanges.length; index += 1) {
          const day = dayRanges[index]!;
          const dayStops = stops.filter(
            (stop) => stop.plannedStart < day.endsAt && stop.plannedEnd > day.startsAt,
          );
          const visitMinutes = dayStops.reduce(
            (total, stop) =>
              total +
              Math.max(
                0,
                Math.min(stop.plannedEnd.getTime(), day.endsAt.getTime()) -
                  Math.max(stop.plannedStart.getTime(), day.startsAt.getTime()),
              ) /
                60_000,
            0,
          );
          const bufferedMinutes =
            visitMinutes +
            Math.max(0, dayStops.length - 1) * availability.value.travelBufferMinutes;
          if (bufferedMinutes > availability.value.maxDailyMinutes) {
            throw new VisitDailyPlanLimitError(availability.value.maxDailyMinutes);
          }
        }
      }
    }
  }

  private async employeeSchedulingResource(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    employeeId: string,
  ) {
    const { employee, facilityIds, teamIds } = await this.employees.getForSchedulingManagement(
      transaction,
      principal.tenantId,
      employeeId,
      true,
    );
    const resource: ResourceContext = {
      tenantId: principal.tenantId,
      ...(employee.organizationId ? { organizationId: employee.organizationId } : {}),
      facilityIds,
      teamIds,
    };
    return { employee, resource };
  }

  private async invalidateToursForVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visit: VisitData,
    actorId: string,
    now: Date,
  ): Promise<void> {
    const linked = await this.repository.toursForVisit(transaction, tenantId, visit.id);
    const assignedEmployeeIds = await this.repository.activeEmployeeIds(
      transaction,
      tenantId,
      visit.id,
    );
    for (const { tour: linkedTour } of linked) {
      const tour = await this.repository.getTour(transaction, tenantId, linkedTour.id, true);
      if (!tour) continue;
      const stops = await this.repository.tourStops(transaction, tenantId, tour.id);
      const stillBelongs =
        visit.status !== 'cancelled' &&
        assignedEmployeeIds.includes(tour.employeeId) &&
        visit.organizationId === tour.organizationId &&
        sameTourDate(visit, tour.localDate, tour.timezone);
      const remaining = stops
        .filter((row) => row.stop.visitId !== visit.id || stillBelongs)
        .map((row) => ({
          visitId: row.stop.visitId,
          sequence: row.stop.sequence,
          dispatcherNote: row.stop.dispatcherNote,
        }));
      if (!stillBelongs) {
        await this.repository.replaceTourStops(transaction, tenantId, tour.id, remaining);
      } else {
        await this.repository.updateTourStopEstimates(
          transaction,
          tenantId,
          tour.id,
          [],
          'unknown',
        );
      }
      await this.repository.updateTourVersion(
        transaction,
        tenantId,
        tour.id,
        tour.version,
        now,
        actorId,
        'draft',
      );
    }
  }

  private async recordSubstitutionChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    visit: VisitData,
    substitution: {
      id: string;
      originalEmployeeId: string;
      substituteEmployeeId: string;
      reason: string;
    },
    status: 'proposed' | 'confirmed' | 'cancelled',
    now: Date,
  ): Promise<void> {
    const event = createDomainEvent({
      type: 'scheduling.substitution_changed',
      tenantId: principal.tenantId,
      aggregateType: 'visit_substitution',
      aggregateId: substitution.id,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      occurredAt: now.toISOString(),
      payload: {
        visitId: visit.id,
        substitutionId: substitution.id,
        originalEmployeeId: substitution.originalEmployeeId,
        substituteEmployeeId: substitution.substituteEmployeeId,
        status,
      },
    });
    await this.record(transaction, principal, context, auditContext, {
      event,
      action: `scheduling.substitution_${status}`,
      resourceType: 'visit_substitution',
      resourceId: substitution.id,
      metadata: {
        visitId: visit.id,
        originalEmployeeId: substitution.originalEmployeeId,
        substituteEmployeeId: substitution.substituteEmployeeId,
        status,
        reason: substitution.reason,
      },
    });
    if (status === 'confirmed') {
      const substituted = createDomainEvent({
        type: 'scheduling.visit_substituted',
        tenantId: principal.tenantId,
        aggregateType: 'visit',
        aggregateId: visit.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        occurredAt: now.toISOString(),
        payload: {
          visitId: visit.id,
          originalEmployeeId: substitution.originalEmployeeId,
          substituteEmployeeId: substitution.substituteEmployeeId,
        },
      });
      await this.outbox.enqueue(transaction, substituted);
    }
  }

  private async recordTourChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    tour: { id: string; employeeId: string; localDate: string; version: number },
    operation: 'scheduling.tour_created' | 'scheduling.tour_reordered',
    metadata: { employeeId: string; localDate: string; visitIds: string[] },
    now: Date,
  ): Promise<void> {
    const event = createDomainEvent({
      type: operation,
      tenantId: principal.tenantId,
      aggregateType: 'tour',
      aggregateId: tour.id,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      occurredAt: now.toISOString(),
      payload: { tourId: tour.id, ...metadata, version: tour.version },
    });
    await this.record(transaction, principal, context, auditContext, {
      event,
      action: operation,
      resourceType: 'tour',
      resourceId: tour.id,
      metadata,
    });
  }

  private async recordAvailabilityChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    employeeId: string,
    version: number,
    now: Date,
    operation: 'weekly_hours_updated' | 'exception_added' | 'exception_removed',
  ): Promise<void> {
    const event = createDomainEvent({
      type: 'scheduling.availability_changed',
      tenantId: principal.tenantId,
      aggregateType: 'employee_availability',
      aggregateId: employeeId,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      occurredAt: now.toISOString(),
      payload: { employeeId, previousVersion: version - 1, version, operation },
    });
    await this.record(transaction, principal, context, auditContext, {
      event,
      action: 'scheduling.availability_changed',
      resourceType: 'employee_availability',
      resourceId: employeeId,
      metadata: { employeeId, previousVersion: version - 1, version, operation },
    });
  }

  private async lockResources(
    transaction: DatabaseTransaction,
    tenantId: string,
    resourceKeys: string[],
  ): Promise<void> {
    const keys = [...new Set(resourceKeys)].sort();
    for (const resource of keys) {
      const key = `${tenantId}:${resource}`;
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
  }

  private async recordAssignmentChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    visit: VisitData,
    employeeId: string,
    operation: 'assigned' | 'unassigned',
    now: Date,
  ): Promise<void> {
    const event = createDomainEvent({
      type: 'visit.assignment_changed',
      tenantId: principal.tenantId,
      aggregateType: 'visit',
      aggregateId: visit.id,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      payload: { visitId: visit.id, clientId: visit.clientId, employeeId, operation },
      occurredAt: now.toISOString(),
    });
    await this.record(transaction, principal, context, auditContext, {
      event,
      action: operation === 'assigned' ? 'visit.employee_assigned' : 'visit.employee_unassigned',
      resourceType: 'visit',
      resourceId: visit.id,
      metadata: { clientId: visit.clientId, employeeId, operation },
    });
  }

  private async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    input: {
      event: DomainEvent;
      action: string;
      resourceType: string;
      resourceId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: input.event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: new Date(input.event.occurredAt),
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

function validateTourRequest(localDate: string, timezone: string, visitIds: string[]): void {
  if (
    !validLocalDate(localDate) ||
    !isSupportedTimeZone(timezone) ||
    visitIds.length < 1 ||
    visitIds.length > 100 ||
    new Set(visitIds).size !== visitIds.length
  ) {
    throw new InvalidTourError();
  }
}

function nextVisitUpdatedAt(previous: Date): Date {
  const nextWholeSecond = Math.floor(previous.getTime() / 1_000) * 1_000 + 1_000;
  return new Date(Math.max(Date.now(), nextWholeSecond));
}

function validLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dayDistance(from: string, until: string): number {
  return (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

function localDateInZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function weekdayNumber(value: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    value,
  );
  return (
    ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as const)[weekday as 'Mon'] ?? 0
  );
}

function timeMinutesInZone(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return (
    Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
    Number(parts.find((part) => part.type === 'minute')?.value)
  );
}

function timeStringMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function employeeSchedulingPreferencesResponse(
  row: typeof employeeSchedulingPreferences.$inferSelect | null,
) {
  if (!row) return null;
  return {
    preferredWeekdays: row.preferredWeekdays,
    preferredTimeWindows: row.preferredTimeWindows as Array<{ startsAt: string; endsAt: string }>,
    preferredStartLatitude:
      row.preferredStartLatitude === null ? null : Number(row.preferredStartLatitude),
    preferredStartLongitude:
      row.preferredStartLongitude === null ? null : Number(row.preferredStartLongitude),
    travelMode: row.travelMode,
  };
}

function clientSchedulingPreferencesResponse(
  row: typeof clientSchedulingPreferences.$inferSelect | null,
) {
  if (!row) return null;
  return {
    preferredWeekdays: row.preferredWeekdays,
    preferredTimeWindows: row.preferredTimeWindows as Array<{ startsAt: string; endsAt: string }>,
    preferredEmployeeId: row.preferredEmployeeId,
    avoidedEmployeeIds: row.avoidedEmployeeIds,
  };
}

function validatePreferences(
  weekdays: number[],
  windows: Array<{ startsAt: string; endsAt: string }>,
): void {
  if (
    weekdays.length > 7 ||
    new Set(weekdays).size !== weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    windows.length > 16 ||
    windows.some(
      (window) =>
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startsAt) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endsAt) ||
        window.startsAt >= window.endsAt,
    )
  ) {
    throw new InvalidTourError();
  }
}

function validateCoordinatePair(latitude: number | null, longitude: number | null): void {
  if (
    (latitude === null) !== (longitude === null) ||
    (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
    (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
  ) {
    throw new InvalidTourError();
  }
}

function publicationChanges(
  previous: unknown,
  current: Array<{ visitId: string; sequence: number; plannedStart: string; plannedEnd: string }>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(previous)) return [{ type: 'initial' }];
  const oldStops = previous.filter(isPublishedStop);
  const oldIds = oldStops.map((stop) => stop.visitId);
  const newIds = current.map((stop) => stop.visitId);
  const changes: Array<Record<string, unknown>> = [];
  for (const visitId of newIds.filter((id) => !oldIds.includes(id)))
    changes.push({ type: 'visit_added', visitId });
  for (const visitId of oldIds.filter((id) => !newIds.includes(id)))
    changes.push({ type: 'visit_removed', visitId });
  if (oldIds.length === newIds.length && oldIds.some((id, index) => id !== newIds[index])) {
    changes.push({ type: 'tour_reordered' });
  }
  const oldById = new Map(oldStops.map((stop) => [stop.visitId, stop]));
  for (const stop of current) {
    const old = oldById.get(stop.visitId);
    if (old && (old.plannedStart !== stop.plannedStart || old.plannedEnd !== stop.plannedEnd)) {
      changes.push({ type: 'visit_rescheduled', visitId: stop.visitId });
    }
  }
  return changes;
}

function isPublishedStop(value: unknown): value is {
  visitId: string;
  plannedStart: string;
  plannedEnd: string;
} {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.visitId === 'string' &&
    typeof row.plannedStart === 'string' &&
    typeof row.plannedEnd === 'string'
  );
}

function addOverlappingConflicts(
  visits: VisitCalendarRow[],
  add: (conflict: SchedulingConflict) => void,
): void {
  const byClient = groupBy(visits, (visit) => visit.clientId);
  for (const group of byClient.values()) {
    addPairwiseOverlaps(group, undefined, add, 'client_overlap');
  }
  const byEmployee = new Map<string, VisitCalendarRow[]>();
  for (const visit of visits) {
    for (const assignment of visit.assignments) {
      const group = byEmployee.get(assignment.employeeId) ?? [];
      group.push(visit);
      byEmployee.set(assignment.employeeId, group);
    }
  }
  for (const [employeeId, group] of byEmployee) {
    addPairwiseOverlaps(group, employeeId, add, 'employee_overlap');
  }
}

function addPairwiseOverlaps(
  visits: VisitCalendarRow[],
  employeeId: string | undefined,
  add: (conflict: SchedulingConflict) => void,
  code: 'client_overlap' | 'employee_overlap',
): void {
  const ordered = [...visits].sort(compareTourStops);
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex]!;
      if (right.plannedStart >= left.plannedEnd) break;
      if (right.plannedEnd <= left.plannedStart) continue;
      add({
        code,
        severity: 'blocking',
        visitId: left.id,
        relatedVisitId: right.id,
        ...(employeeId ? { employeeId } : {}),
      });
      add({
        code,
        severity: 'blocking',
        visitId: right.id,
        relatedVisitId: left.id,
        ...(employeeId ? { employeeId } : {}),
      });
    }
  }
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const group = groups.get(key(value)) ?? [];
    group.push(value);
    groups.set(key(value), group);
  }
  return groups;
}

interface GeneratedServiceCandidate {
  line: AgreementServiceSnapshot;
  catalog: ServiceDefinitionSnapshot;
  date: string;
  generationKey: string;
  plannedStart: Date;
  timeWindowStart: Date;
  timeWindowEnd: Date;
  duration: number;
}

interface GeneratedVisitGroup {
  plannedStart: Date;
  plannedEnd: Date;
  timeWindowStart: Date;
  timeWindowEnd: Date;
  services: GeneratedServiceCandidate[];
}

function groupGeneratedCandidates(candidates: GeneratedServiceCandidate[]): GeneratedVisitGroup[] {
  const groups = new Map<string, GeneratedServiceCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.plannedStart.toISOString()}:${candidate.timeWindowEnd.toISOString()}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()].map((services) => ({
    plannedStart: services[0]!.plannedStart,
    plannedEnd: new Date(services[0]!.plannedStart.getTime()),
    timeWindowStart: services[0]!.timeWindowStart,
    timeWindowEnd: services[0]!.timeWindowEnd,
    services,
  }));
}

function generatedVisitService(
  tenantId: string,
  visitId: string,
  agreementId: string,
  candidate: GeneratedServiceCandidate,
  now: Date,
): VisitServiceData {
  const service: VisitServiceData = {
    id: uuidv7(),
    tenantId,
    visitId,
    serviceAgreementId: agreementId,
    agreementServiceId: candidate.line.id,
    serviceDefinitionId: candidate.line.serviceDefinitionId,
    serviceCodeSnapshot: candidate.line.serviceCode,
    serviceNameSnapshot: candidate.line.serviceName,
    unitSnapshot: candidate.line.serviceUnit,
    plannedQuantity: candidate.line.quantity ?? '1',
    plannedDurationMinutes: candidate.duration,
    generationKey: candidate.generationKey,
    generatedFromRule: true,
    createdAt: now,
    updatedAt: now,
  };
  validateVisitService(service);
  return service;
}

function makeAssignment(
  principal: AuthorizationPrincipal,
  visitId: string,
  employeeId: string,
  role: string | null,
  now: Date,
): VisitAssignmentSnapshot {
  if (role !== null && role.length > 80) throw new InvalidVisitAssignmentError();
  return {
    id: uuidv7(),
    tenantId: principal.tenantId,
    visitId,
    employeeId,
    role: role?.trim() || null,
    status: 'active',
    assignedAt: now,
    assignedBy: principal.userId,
    unassignedAt: null,
  };
}

function toSearchFilter(
  principal: AuthorizationPrincipal,
  query: VisitSearchQuery,
  scope: VisitReadScope,
  page: number,
  pageSize: number,
): VisitSearchFilter {
  return {
    tenantId: principal.tenantId,
    from: query.from,
    until: query.until,
    scope,
    ...(query.clientId === undefined ? {} : { clientId: query.clientId }),
    ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
    ...(query.organizationId === undefined ? {} : { organizationId: query.organizationId }),
    ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
    ...(query.teamId === undefined ? {} : { teamId: query.teamId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.serviceDefinitionId === undefined
      ? {}
      : { serviceDefinitionId: query.serviceDefinitionId }),
    ...(query.search === undefined ? {} : { search: query.search }),
    ...(query.unassigned === undefined ? {} : { unassigned: query.unassigned }),
    ...(query.origin === undefined ? {} : { origin: query.origin }),
    ...(query.relatedToVisitId === undefined ? {} : { relatedToVisitId: query.relatedToVisitId }),
    page,
    pageSize,
    sortBy: query.sortBy ?? 'plannedStart',
    sortOrder: query.sortOrder ?? 'asc',
  };
}

function visitReadScope(principal: AuthorizationPrincipal): VisitReadScope {
  const scheduleGrants = principal.grants.filter((grant) => grant.permission === 'schedule.read');
  const clientGrants = principal.grants.filter((grant) => grant.permission === 'client.read');
  const scheduleScope = {
    tenantWide: scheduleGrants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: unique(
      scheduleGrants
        .filter((grant) => grant.scopeType === 'organization')
        .map((grant) => grant.scopeId),
    ),
    facilityIds: unique(
      scheduleGrants
        .filter((grant) => grant.scopeType === 'facility')
        .map((grant) => grant.scopeId),
    ),
    teamIds: unique(
      scheduleGrants.filter((grant) => grant.scopeType === 'team').map((grant) => grant.scopeId),
    ),
  };
  const clientScope = {
    tenantWide: clientGrants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: unique(
      clientGrants
        .filter((grant) => grant.scopeType === 'organization')
        .map((grant) => grant.scopeId),
    ),
    facilityIds: unique(
      clientGrants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
    ),
  };
  if (
    !scheduleScope.tenantWide &&
    scheduleScope.organizationIds.length === 0 &&
    scheduleScope.facilityIds.length === 0 &&
    scheduleScope.teamIds.length === 0
  ) {
    throw new AuthorizationDeniedError('schedule.read');
  }
  if (
    !clientScope.tenantWide &&
    clientScope.organizationIds.length === 0 &&
    clientScope.facilityIds.length === 0
  ) {
    throw new AuthorizationDeniedError('client.read');
  }
  return { schedule: scheduleScope, client: clientScope };
}

function clientResource(
  client: ClientSnapshot,
  organizationId: string,
  facilityId: string,
): ResourceContext {
  return { tenantId: client.tenantId, clientId: client.id, organizationId, facilityId };
}

function dateInTimeZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDates(from: string, until: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= until; date = addCalendarDate(date, 1)) dates.push(date);
  return dates;
}

function isDateWithin(value: string, from: string | null, until: string | null): boolean {
  return (from === null || value >= from) && (until === null || value <= until);
}

function maxDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minNullableDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left <= right ? left : right;
}

function validateGenerationRange(from: string, until: string, maximumDays: number): void {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!valid(from) || !valid(until) || until < from)
    throw new InvalidScheduleGenerationRangeError();
  const days =
    (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > maximumDays) throw new InvalidScheduleGenerationRangeError();
}

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function resolveEmployeeAbsenceRange(
  input: EmployeeUnavailabilityInput,
): { startsAt: Date; endsAt: Date } | null {
  const hasInstants = input.startsAt !== undefined || input.endsAt !== undefined;
  const hasLocalValues =
    input.localStartDate !== undefined ||
    input.localStartTime !== undefined ||
    input.localEndDate !== undefined ||
    input.localEndTime !== undefined;
  if (hasInstants === hasLocalValues) return null;
  if (hasInstants) {
    if (
      !input.startsAt ||
      !input.endsAt ||
      !validInstant(input.startsAt) ||
      !validInstant(input.endsAt) ||
      input.endsAt <= input.startsAt
    ) {
      return null;
    }
    return { startsAt: input.startsAt, endsAt: input.endsAt };
  }
  if (
    !input.localStartDate ||
    !input.localStartTime ||
    !input.localEndDate ||
    !input.localEndTime ||
    !input.timezone
  ) {
    return null;
  }
  try {
    const startsAt = localDateTimeToInstant(
      input.localStartDate,
      input.localStartTime,
      input.timezone,
      'earlier',
    );
    const endsAt = localDateTimeToInstant(
      input.localEndDate,
      input.localEndTime,
      input.timezone,
      'later',
    );
    return startsAt && endsAt && endsAt > startsAt ? { startsAt, endsAt } : null;
  } catch {
    return null;
  }
}

function isAbsenceReason(
  value: string,
): value is NonNullable<EmployeeUnavailabilityInput['reason']> {
  return ['vacation', 'sick_leave', 'training', 'personal_unavailability', 'other'].includes(value);
}

function resolvePlannedRange(
  input: Pick<
    CreateVisitInput,
    'plannedStart' | 'plannedEnd' | 'localDate' | 'localStartTime' | 'localEndTime'
  >,
  timezone: string,
): { plannedStart: Date; plannedEnd: Date } {
  const hasInstants = input.plannedStart !== undefined || input.plannedEnd !== undefined;
  const hasLocalValues =
    input.localDate !== undefined ||
    input.localStartTime !== undefined ||
    input.localEndTime !== undefined;
  if (hasInstants === hasLocalValues) throw new InvalidVisitDataError();
  if (hasInstants) {
    if (
      !validInstant(input.plannedStart!) ||
      !validInstant(input.plannedEnd!) ||
      input.plannedEnd! <= input.plannedStart!
    ) {
      throw new InvalidVisitDataError();
    }
    return { plannedStart: input.plannedStart!, plannedEnd: input.plannedEnd! };
  }
  if (
    !input.localDate ||
    !input.localStartTime ||
    !input.localEndTime ||
    input.localEndTime <= input.localStartTime
  ) {
    throw new InvalidVisitDataError();
  }
  try {
    const plannedStart = localDateTimeToInstant(
      input.localDate,
      input.localStartTime,
      timezone,
      'earlier',
    );
    const plannedEnd = localDateTimeToInstant(
      input.localDate,
      input.localEndTime,
      timezone,
      'earlier',
    );
    if (!plannedStart || !plannedEnd || plannedEnd <= plannedStart) {
      throw new InvalidVisitDataError();
    }
    return { plannedStart, plannedEnd };
  } catch (error) {
    if (error instanceof InvalidVisitDataError) throw error;
    throw new InvalidVisitDataError();
  }
}

function resolveUpdatedRange(
  changes: UpdateVisitInput,
  current: VisitData,
): { plannedStart: Date; plannedEnd: Date } {
  const hasLocalValues =
    changes.localDate !== undefined ||
    changes.localStartTime !== undefined ||
    changes.localEndTime !== undefined;
  const hasInstantValues = changes.plannedStart !== undefined || changes.plannedEnd !== undefined;
  if (hasLocalValues && hasInstantValues) throw new InvalidVisitDataError();
  if (hasLocalValues) {
    return resolvePlannedRange(
      {
        localDate: changes.localDate!,
        localStartTime: changes.localStartTime!,
        localEndTime: changes.localEndTime!,
      },
      current.timezone,
    );
  }
  const plannedStart = changes.plannedStart ?? current.plannedStart;
  const plannedEnd = changes.plannedEnd ?? current.plannedEnd;
  if (!validInstant(plannedStart) || !validInstant(plannedEnd) || plannedEnd <= plannedStart) {
    throw new InvalidVisitDataError();
  }
  return { plannedStart, plannedEnd };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function createSchedulingApplicationService(
  unitOfWork: UnitOfWork,
  clients: ClientApplicationService,
  organizations: OrganizationApplicationService,
  employees: EmployeeApplicationService,
  services: ServiceApplicationService,
  agreements: ServiceAgreementApplicationService,
  audit: AuditWriter,
  outbox: OutboxWriter,
  generationHorizonDays = 28,
  executionGuard?: SchedulingExecutionGuard,
  routeProvider?: RouteProvider,
): SchedulingApplicationService {
  return new SchedulingApplicationService(
    unitOfWork,
    clients,
    organizations,
    employees,
    services,
    agreements,
    audit,
    outbox,
    new SchedulingRepository(),
    generationHorizonDays,
    executionGuard,
    routeProvider,
  );
}

export class VisitExecutionPlanningLockedError extends Error {
  readonly code = 'VISIT_EXECUTION_PLANNING_LOCKED';

  constructor() {
    super('Scheduling changes are locked after visit execution starts');
    this.name = 'VisitExecutionPlanningLockedError';
  }
}

export class InvalidVisitQueryError extends Error {
  readonly code = 'VISIT_INVALID_QUERY';
  constructor() {
    super('Visit date range, pagination, or filters are invalid');
    this.name = 'InvalidVisitQueryError';
  }
}

export class VisitNotFoundError extends Error {
  readonly code = 'VISIT_NOT_FOUND';
  constructor() {
    super('Visit was not found');
    this.name = 'VisitNotFoundError';
  }
}

export class VisitOutsideProviderContextError extends Error {
  readonly code = 'VISIT_OUTSIDE_PROVIDER_CONTEXT';
  constructor() {
    super('Client is not available through an active provider context');
    this.name = 'VisitOutsideProviderContextError';
  }
}

export class VisitClientConflictError extends Error {
  readonly code = 'VISIT_CLIENT_CONFLICT';
  constructor(
    readonly plannedStart: Date,
    readonly plannedEnd: Date,
  ) {
    super('Client already has an overlapping planned visit');
    this.name = 'VisitClientConflictError';
  }
}

export class VisitEmployeeConflictError extends Error {
  readonly code = 'VISIT_EMPLOYEE_CONFLICT';
  constructor(
    readonly plannedStart: Date,
    readonly plannedEnd: Date,
    readonly timezone: string,
  ) {
    super('Employee already has an overlapping planned visit');
    this.name = 'VisitEmployeeConflictError';
  }
}

export class VisitEmployeeUnavailableError extends Error {
  readonly code = 'VISIT_EMPLOYEE_NOT_AVAILABLE';
  constructor() {
    super('Employee is unavailable during the visit time');
    this.name = 'VisitEmployeeUnavailableError';
  }
}

export class VisitAgreementInvalidError extends Error {
  readonly code = 'VISIT_AGREEMENT_INVALID';
  constructor() {
    super('Agreement is not active or does not match the visit provider context');
    this.name = 'VisitAgreementInvalidError';
  }
}

export class VisitAgreementServiceInvalidError extends Error {
  readonly code = 'VISIT_AGREEMENT_SERVICE_INVALID';
  constructor() {
    super('Agreement service is not active or valid for this visit');
    this.name = 'VisitAgreementServiceInvalidError';
  }
}

export class DuplicateVisitAssignmentError extends Error {
  readonly code = 'VISIT_ASSIGNMENT_DUPLICATE';
  constructor() {
    super('Employee is already assigned to this visit');
    this.name = 'DuplicateVisitAssignmentError';
  }
}

export class VisitAssignmentNotFoundError extends Error {
  readonly code = 'VISIT_ASSIGNMENT_NOT_FOUND';
  constructor() {
    super('Active visit assignment was not found');
    this.name = 'VisitAssignmentNotFoundError';
  }
}

export class InvalidVisitAssignmentError extends Error {
  readonly code = 'VISIT_ASSIGNMENT_INVALID';
  constructor() {
    super('Visit assignment role is invalid');
    this.name = 'InvalidVisitAssignmentError';
  }
}

export class InvalidEmployeeUnavailabilityError extends Error {
  readonly code = 'EMPLOYEE_UNAVAILABILITY_INVALID';
  constructor() {
    super('Employee unavailability range or note is invalid');
    this.name = 'InvalidEmployeeUnavailabilityError';
  }
}

export class EmployeeUnavailabilityNotFoundError extends Error {
  readonly code = 'EMPLOYEE_UNAVAILABILITY_NOT_FOUND';

  constructor() {
    super('Employee absence was not found or has already been cancelled');
    this.name = 'EmployeeUnavailabilityNotFoundError';
  }
}

export class VisitOutsideEmployeeAvailabilityError extends Error {
  readonly code = 'VISIT_OUTSIDE_EMPLOYEE_AVAILABILITY';

  constructor() {
    super('Visit falls outside the employee working availability');
    this.name = 'VisitOutsideEmployeeAvailabilityError';
  }
}

export class VisitTravelBufferConflictError extends Error {
  readonly code = 'VISIT_TRAVEL_BUFFER_CONFLICT';

  constructor() {
    super('There is not enough time for the configured travel buffer between visits');
    this.name = 'VisitTravelBufferConflictError';
  }
}

export class VisitDailyPlanLimitError extends Error {
  readonly code = 'VISIT_DAILY_PLAN_LIMIT';

  constructor(readonly maxDailyMinutes: number) {
    super(`The employee's planned daily minutes would exceed ${maxDailyMinutes}`);
    this.name = 'VisitDailyPlanLimitError';
  }
}

export class SchedulingVersionConflictError extends Error {
  readonly code = 'SCHEDULING_VERSION_CONFLICT';

  constructor() {
    super('Scheduling data changed; reload before saving');
    this.name = 'SchedulingVersionConflictError';
  }
}

export class AvailabilityExceptionNotFoundError extends Error {
  readonly code = 'AVAILABILITY_EXCEPTION_NOT_FOUND';

  constructor() {
    super('Availability exception was not found');
    this.name = 'AvailabilityExceptionNotFoundError';
  }
}

export class ActiveVisitSubstitutionError extends Error {
  readonly code = 'VISIT_SUBSTITUTION_ACTIVE';
  constructor() {
    super('A visit already has a proposed substitute');
    this.name = 'ActiveVisitSubstitutionError';
  }
}

export class VisitSubstitutionNotFoundError extends Error {
  readonly code = 'VISIT_SUBSTITUTION_NOT_FOUND';
  constructor() {
    super('Substitution was not found or is no longer proposed');
    this.name = 'VisitSubstitutionNotFoundError';
  }
}

export class VisitSubstitutionStaleError extends Error {
  readonly code = 'VISIT_SUBSTITUTION_STALE';
  constructor() {
    super('The assignment changed after this substitution was proposed');
    this.name = 'VisitSubstitutionStaleError';
  }
}

export class TourNotFoundError extends Error {
  readonly code = 'SCHEDULING_TOUR_NOT_FOUND';
  constructor() {
    super('Tour was not found');
    this.name = 'TourNotFoundError';
  }
}

export class SchedulingConflictsError extends Error {
  readonly code = 'SCHEDULING_CONFLICT';
  constructor(readonly conflicts: SchedulingConflict[]) {
    super('Tour cannot be published while blocking travel conflicts remain');
    this.name = 'SchedulingConflictsError';
  }
}
