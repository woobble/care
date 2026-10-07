import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService, ClientSnapshot } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import {
  assertCan,
  AuthorizationDeniedError,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { OrganizationApplicationService } from '@care/organizations';
import type { EmployeeApplicationService } from '@care/employees';
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
} from '../domain';
import type {
  VisitAssignmentSnapshot,
  VisitData,
  VisitServiceData,
  VisitSnapshot,
  VisitStatus,
} from '../domain/visit';
import { SchedulingRepository } from '../infrastructure/scheduling.repository';
import type {
  VisitCalendarRow,
  VisitReadScope,
  VisitSearchFilter,
} from '../infrastructure/scheduling.repository';
import type { SchedulingExecutionGuard } from '../infrastructure/scheduling-guards';

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
  unassigned?: boolean;
  origin?: 'agreement_generated' | 'manual';
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
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
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
        updatedAt: new Date(),
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
      const now = new Date();
      const employee = await this.validateEmployeeAssignment(
        transaction,
        principal.tenantId,
        input.employeeId,
        visit,
      );
      const assignment = makeAssignment(principal, visit.id, employee.id, input.role ?? null, now);
      await this.repository.insertAssignment(transaction, assignment);
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
      const now = new Date();
      await this.repository.unassign(transaction, principal.tenantId, visit.id, assignmentId, now);
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

  async createUnavailability(
    principal: AuthorizationPrincipal,
    input: EmployeeUnavailabilityInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !validInstant(input.startsAt) ||
      !validInstant(input.endsAt) ||
      input.endsAt <= input.startsAt ||
      (input.note?.length ?? 0) > 1000
    ) {
      throw new InvalidEmployeeUnavailabilityError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { employee, facilityIds, teamIds } = await this.employees.getForSchedulingManagement(
        transaction,
        principal.tenantId,
        input.employeeId,
        true,
      );
      const resource: ResourceContext = {
        tenantId: principal.tenantId,
        ...(employee.organizationId ? { organizationId: employee.organizationId } : {}),
        facilityIds,
        teamIds,
      };
      assertCan(principal, { action: 'schedule.update', resource });
      await this.lockResources(transaction, principal.tenantId, [`employee:${employee.id}`]);
      const conflict = await this.repository.findEmployeeConflict(transaction, {
        tenantId: principal.tenantId,
        employeeId: employee.id,
        plannedStart: input.startsAt,
        plannedEnd: input.endsAt,
      });
      if (conflict) {
        throw new VisitEmployeeConflictError(
          conflict.visit.plannedStart,
          conflict.visit.plannedEnd,
          conflict.visit.timezone,
        );
      }
      const id = uuidv7();
      const now = new Date();
      await this.repository.insertUnavailability(transaction, {
        id,
        tenantId: principal.tenantId,
        employeeId: employee.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note?.trim() || null,
        createdAt: now,
        createdBy: principal.userId,
      });
      const event = createDomainEvent({
        type: 'employee.unavailability_created',
        tenantId: principal.tenantId,
        aggregateType: 'employee_availability',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { employeeId: employee.id, unavailabilityId: id },
      });
      await this.record(transaction, principal, context, auditContext, {
        event,
        action: 'employee.unavailability_created',
        resourceType: 'employee_availability',
        resourceId: id,
        metadata: { employeeId: employee.id },
      });
      return { id, employeeId: employee.id, startsAt: input.startsAt, endsAt: input.endsAt };
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
      const next = { ...visit, status, updatedAt: new Date() };
      await this.repository.updateVisit(transaction, next);
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
    ...(query.unassigned === undefined ? {} : { unassigned: query.unassigned }),
    ...(query.origin === undefined ? {} : { origin: query.origin }),
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
