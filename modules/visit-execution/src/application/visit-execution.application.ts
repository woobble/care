import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent, type DomainEvent } from '@care/events';
import {
  assertCan,
  can,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { performedServices, visitExecutions } from '@module/visit-execution/schema';
import {
  validateServiceDecision,
  type ExecutionReasonCode,
  type PerformedServiceStatus,
} from '@module/visit-execution/domain/visit-execution';
import {
  VisitExecutionRepository,
  type ExecutionRow,
  type PerformedServiceRow,
  type PlannedVisitService,
  type VisitExecutionVisit,
} from '@module/visit-execution/infrastructure/visit-execution.repository';

type AuditContext = { ip?: string; userAgent?: string };
type ReasonCode = ExecutionReasonCode;

export interface RecordPerformedServiceInput {
  expectedVersion: number;
  visitServiceId?: string;
  serviceDefinitionId?: string;
  status: PerformedServiceStatus;
  actualQuantity: string | null;
  reasonCode?: ReasonCode | null;
}

export interface CorrectExecutionTimesInput {
  expectedVersion: number;
  actualStart?: Date;
  actualEnd?: Date;
  reason: string;
}

export interface VisitExecutionDetail {
  visit: {
    id: string;
    clientId: string;
    clientDisplayName: string;
    address: string | null;
    note: string | null;
    schedulingPreferences: {
      preferredWeekdays: number[];
      preferredTimeWindows: Array<{ startsAt: string; endsAt: string }>;
    } | null;
    status: 'planned' | 'confirmed' | 'cancelled';
    plannedStart: string;
    plannedEnd: string;
    timezone: string;
  };
  execution: {
    id: string | null;
    status: 'not_started' | 'in_progress' | 'completed';
    version: number;
    actualStart: string | null;
    actualEnd: string | null;
    startedByEmployeeId: string | null;
    startedByEmployeeName: string | null;
    completedByEmployeeId: string | null;
    completedByEmployeeName: string | null;
  };
  services: Array<{
    id: string | null;
    visitServiceId: string | null;
    serviceDefinitionId: string;
    serviceCode: string;
    serviceName: string;
    unit: 'occurrence' | 'minute' | 'hour' | 'day';
    plannedQuantity: string | null;
    actualQuantity: string | null;
    status: 'not_recorded' | PerformedServiceStatus;
    reasonCode: ReasonCode | null;
    performedByEmployeeId: string | null;
    performedByEmployeeName: string | null;
    unplanned: boolean;
  }>;
}

export interface CaregiverVisitSummary {
  id: string;
  clientId: string;
  clientDisplayName: string;
  address: string | null;
  note: string | null;
  updatedAt: string;
  assignmentAssignedAt: string;
  status: 'planned' | 'confirmed' | 'cancelled';
  plannedStart: string;
  plannedEnd: string;
  timezone: string;
  executionStatus: 'not_started' | 'in_progress' | 'completed';
  actualStart: string | null;
  actualEnd: string | null;
  services: Array<{
    id: string;
    code: string;
    name: string;
    unit: 'occurrence' | 'minute' | 'hour' | 'day';
    plannedQuantity: string;
  }>;
}

export interface VisitExecutionSummary {
  visitId: string;
  executionStatus: 'not_started' | 'in_progress' | 'completed';
  actualStart: string | null;
  actualEnd: string | null;
}

export interface VisitExecutionOperationsSummary {
  visitId: string;
  clientId: string;
  clientDisplayName: string;
  organizationId: string;
  facilityId: string;
  plannedEnd: string;
  actualStart: string;
}

export interface VisitExecutionOperationsSummaryResult {
  items: VisitExecutionOperationsSummary[];
  complete: boolean;
}

export interface VisitExecutionOperationsIssueState {
  overdueIncomplete: boolean | null;
}

export class VisitExecutionApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository = new VisitExecutionRepository(),
  ) {}

  async get(principal: AuthorizationPrincipal, visitId: string): Promise<VisitExecutionDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisit(transaction, principal.tenantId, visitId);
      await this.authorizeVisit(principal, transaction, context.visit, 'visit_execution.read');
      if (principal.roles?.includes('Caregiver')) {
        const employee = await this.requireEmployee(transaction, principal);
        await this.requireAssignment(transaction, principal.tenantId, visitId, employee.id);
      }
      return this.detailInTransaction(transaction, principal.tenantId, context);
    });
  }

  async summaries(
    principal: AuthorizationPrincipal,
    visitIds: string[],
  ): Promise<VisitExecutionSummary[]> {
    if (visitIds.length > 100 || new Set(visitIds).size !== visitIds.length) {
      throw new InvalidVisitExecutionQueryError();
    }
    if (visitIds.length === 0) return [];

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visits = await this.repository.visitsForIds(transaction, principal.tenantId, visitIds);
      if (visits.length !== visitIds.length) throw new VisitExecutionNotFoundError();

      const employee = principal.roles?.includes('Caregiver')
        ? await this.requireEmployee(transaction, principal)
        : null;
      // oxlint-disable no-await-in-loop
      for (const visit of visits) {
        await this.authorizeVisit(principal, transaction, visit, 'visit_execution.read');
        if (employee) {
          await this.requireAssignment(transaction, principal.tenantId, visit.id, employee.id);
        }
      }
      // oxlint-enable no-await-in-loop

      const executions = await this.repository.executionsForVisits(
        transaction,
        principal.tenantId,
        visitIds,
      );
      const executionsByVisit = new Map(
        executions.map((execution) => [execution.visitId, execution]),
      );
      return visitIds.map((visitId) => {
        const execution = executionsByVisit.get(visitId);
        return {
          visitId,
          executionStatus: execution?.status ?? 'not_started',
          actualStart: execution?.actualStart.toISOString() ?? null,
          actualEnd: execution?.actualEnd?.toISOString() ?? null,
        };
      });
    });
  }

  async operationsSummaries(
    principal: AuthorizationPrincipal,
    from: Date,
    until: Date,
  ): Promise<VisitExecutionOperationsSummaryResult> {
    if (!validInstant(from) || !validInstant(until) || until <= from) {
      throw new InvalidVisitExecutionQueryError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await this.repository.operationalExecutions(
        transaction,
        principal.tenantId,
        from,
        until,
      );
      const employee = principal.roles?.includes('Caregiver')
        ? await this.requireEmployee(transaction, principal)
        : null;
      const allowed = [] as typeof rows;
      // oxlint-disable no-await-in-loop
      for (const row of rows) {
        if (
          !can(principal, {
            action: 'visit_execution.read',
            resource: await this.visitResourceContext(transaction, principal.tenantId, row.visit),
          })
        ) {
          continue;
        }
        if (
          employee &&
          !(await this.repository.hasActiveAssignment(
            transaction,
            principal.tenantId,
            row.visit.id,
            employee.id,
          ))
        ) {
          continue;
        }
        allowed.push(row);
      }
      // oxlint-enable no-await-in-loop
      return {
        items: allowed
          .slice(0, 100)
          .map(({ visit, execution, preferredName, firstName, lastName }) => ({
            visitId: visit.id,
            clientId: visit.clientId,
            clientDisplayName: `${preferredName || firstName} ${lastName}`,
            organizationId: visit.organizationId,
            facilityId: visit.facilityId,
            plannedEnd: visit.plannedEnd.toISOString(),
            actualStart: execution.actualStart.toISOString(),
          })),
        complete: rows.length <= 100,
      };
    });
  }

  async operationsIssueState(
    principal: AuthorizationPrincipal,
    visitId: string,
  ): Promise<VisitExecutionOperationsIssueState> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.repository.getVisit(transaction, principal.tenantId, visitId);
      if (!context) return { overdueIncomplete: false };
      if (
        !can(principal, {
          action: 'visit_execution.read',
          resource: await this.visitResourceContext(transaction, principal.tenantId, context.visit),
        })
      ) {
        return { overdueIncomplete: null };
      }
      if (principal.roles?.includes('Caregiver')) {
        const employee = await this.requireEmployee(transaction, principal);
        if (
          !(await this.repository.hasActiveAssignment(
            transaction,
            principal.tenantId,
            visitId,
            employee.id,
          ))
        ) {
          return { overdueIncomplete: null };
        }
      }
      const execution = await this.repository.getExecution(
        transaction,
        principal.tenantId,
        visitId,
      );
      return {
        overdueIncomplete:
          execution?.status === 'in_progress' && context.visit.plannedEnd.getTime() < Date.now(),
      };
    });
  }

  async myVisits(
    principal: AuthorizationPrincipal,
    from: Date,
    until: Date,
  ): Promise<CaregiverVisitSummary[]> {
    if (
      !validInstant(from) ||
      !validInstant(until) ||
      until <= from ||
      until.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000
    ) {
      throw new InvalidVisitExecutionQueryError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireEmployee(transaction, principal);
      const rows = await this.repository.listAssignedVisits(transaction, {
        tenantId: principal.tenantId,
        employeeId: employee.id,
        from,
        until,
      });
      // Each visit still needs the caller's normal resource scope. Assignment only constrains self access.
      // oxlint-disable no-await-in-loop
      for (const row of rows) {
        await this.authorizeVisit(principal, transaction, row.visit, 'visit_execution.read');
      }
      // oxlint-enable no-await-in-loop
      const visitIds = rows.map((row) => row.visit.id);
      const plannedServices = await this.repository.plannedServicesForVisits(
        transaction,
        principal.tenantId,
        visitIds,
      );
      const executions = await this.repository.executionsForVisits(
        transaction,
        principal.tenantId,
        visitIds,
      );
      const servicesByVisit = groupBy(plannedServices, (service) => service.visitId);
      const executionByVisit = new Map(
        executions.map((execution) => [execution.visitId, execution]),
      );

      return rows.map(
        ({ visit, preferredName, firstName, lastName, address, assignmentAssignedAt }) => {
          const execution = executionByVisit.get(visit.id);
          return {
            id: visit.id,
            clientId: visit.clientId,
            clientDisplayName: (preferredName || firstName) + ' ' + lastName,
            address: address
              ? [
                  address.street,
                  address.houseNumber,
                  address.addressAddition,
                  [address.postalCode, address.city].filter(Boolean).join(' '),
                ]
                  .filter(Boolean)
                  .join(', ')
              : null,
            note: visit.note,
            updatedAt: visit.updatedAt.toISOString(),
            assignmentAssignedAt: assignmentAssignedAt.toISOString(),
            status: visit.status,
            plannedStart: visit.plannedStart.toISOString(),
            plannedEnd: visit.plannedEnd.toISOString(),
            timezone: visit.timezone,
            executionStatus: execution?.status ?? 'not_started',
            actualStart: execution?.actualStart.toISOString() ?? null,
            actualEnd: execution?.actualEnd?.toISOString() ?? null,
            services: (servicesByVisit.get(visit.id) ?? []).map((service) => ({
              id: service.id,
              code: service.serviceCodeSnapshot,
              name: service.serviceNameSnapshot,
              unit: service.unitSnapshot,
              plannedQuantity: service.plannedQuantity,
            })),
          };
        },
      );
    });
  }

  async availableServices(principal: AuthorizationPrincipal, visitId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisit(transaction, principal.tenantId, visitId, true);
      await this.authorizeVisit(
        principal,
        transaction,
        context.visit,
        'visit_execution.record_services',
      );
      await this.requireAssignedEmployee(transaction, principal, context);
      const execution = await this.repository.getExecution(
        transaction,
        principal.tenantId,
        visitId,
      );
      if (!execution || execution.status !== 'in_progress') {
        throw new VisitExecutionNotStartedError();
      }
      return this.repository.listAvailableServices(transaction, {
        tenantId: principal.tenantId,
        organizationId: context.visit.organizationId,
        facilityId: context.visit.facilityId,
        localDate: localDate(execution.actualStart, context.visit.timezone),
      });
    });
  }

  async start(
    principal: AuthorizationPrincipal,
    visitId: string,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitExecutionDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisit(transaction, principal.tenantId, visitId, true);
      await this.authorizeVisit(principal, transaction, context.visit, 'visit_execution.start');
      const employee = await this.requireAssignedEmployee(transaction, principal, context);
      if (context.visit.status === 'cancelled') throw new VisitExecutionVisitCancelledError();
      const existing = await this.repository.getExecution(
        transaction,
        principal.tenantId,
        visitId,
        true,
      );
      if (existing)
        return this.detailInTransaction(transaction, principal.tenantId, context, existing);

      const now = new Date();
      const execution: ExecutionRow = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        visitId,
        status: 'in_progress',
        actualStart: now,
        actualEnd: null,
        startedByEmployeeId: employee.id,
        completedByEmployeeId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await transaction.insert(visitExecutions).values(execution);
      const event = createDomainEvent({
        type: 'visit_execution.started',
        tenantId: principal.tenantId,
        aggregateType: 'visit_execution',
        aggregateId: execution.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          executionId: execution.id,
          visitId,
          clientId: context.visit.clientId,
          actualStart: now.toISOString(),
          version: execution.version,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'visit_execution.started',
        resourceType: 'client',
        resourceId: context.visit.clientId,
        metadata: { executionId: execution.id, visitId, status: execution.status, version: 1 },
      });
      return this.detailInTransaction(transaction, principal.tenantId, context, execution);
    });
  }

  async recordService(
    principal: AuthorizationPrincipal,
    visitId: string,
    performedServiceId: string,
    input: RecordPerformedServiceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisit(transaction, principal.tenantId, visitId, true);
      await this.authorizeVisit(
        principal,
        transaction,
        context.visit,
        'visit_execution.record_services',
      );
      const employee = await this.requireAssignedEmployee(transaction, principal, context);
      const execution = await this.repository.getExecution(
        transaction,
        principal.tenantId,
        visitId,
        true,
      );
      if (!execution) throw new VisitExecutionNotStartedError();

      const planned = input.visitServiceId
        ? (await this.repository.plannedServices(transaction, principal.tenantId, visitId)).find(
            (service) => service.id === input.visitServiceId,
          )
        : undefined;
      if (input.visitServiceId && !planned) throw new PerformedServiceServiceInvalidError();

      let existing =
        (planned &&
          (await this.repository.findPlannedPerformedService(
            transaction,
            principal.tenantId,
            execution.id,
            planned.id,
          ))) ||
        (await this.repository.findPerformedService(
          transaction,
          principal.tenantId,
          execution.id,
          performedServiceId,
        ));
      if (existing && input.visitServiceId && existing.visitServiceId !== input.visitServiceId) {
        throw new PerformedServiceNotFoundError();
      }
      if (existing && !input.visitServiceId && existing.visitServiceId !== null) {
        throw new PerformedServiceNotFoundError();
      }
      if (
        existing &&
        !input.visitServiceId &&
        input.serviceDefinitionId !== existing.serviceDefinitionId
      ) {
        throw new PerformedServiceServiceInvalidError();
      }
      if (
        existing &&
        existing.id !== performedServiceId &&
        input.expectedVersion === execution.version
      ) {
        throw new PerformedServiceNotFoundError();
      }

      const snapshot = planned
        ? {
            serviceDefinitionId: planned.serviceDefinitionId,
            serviceAgreementId: planned.serviceAgreementId,
            agreementServiceId: planned.agreementServiceId,
            serviceCodeSnapshot: planned.serviceCodeSnapshot,
            serviceNameSnapshot: planned.serviceNameSnapshot,
            unitSnapshot: planned.unitSnapshot,
            plannedQuantity: planned.plannedQuantity,
          }
        : await this.unplannedSnapshot(
            transaction,
            context,
            execution,
            input.serviceDefinitionId ?? existing?.serviceDefinitionId,
            existing,
          );
      if (input.serviceDefinitionId && input.serviceDefinitionId !== snapshot.serviceDefinitionId) {
        throw new PerformedServiceServiceInvalidError();
      }
      validateServiceDecision({
        status: input.status,
        plannedQuantity: snapshot.plannedQuantity,
        actualQuantity: input.actualQuantity,
        reasonCode: input.reasonCode ?? null,
      });
      const now = new Date();
      const row: PerformedServiceRow = {
        id: existing?.id ?? performedServiceId,
        tenantId: principal.tenantId,
        executionId: execution.id,
        visitId,
        visitServiceId: planned?.id ?? null,
        ...snapshot,
        actualQuantity: input.actualQuantity,
        status: input.status,
        reasonCode: input.reasonCode ?? null,
        performedByEmployeeId: employee.id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing && sameServiceDecision(existing, row)) {
        return { service: serviceResponse(existing), version: execution.version };
      }
      if (execution.status === 'completed') throw new VisitExecutionAlreadyCompletedError();
      if (input.expectedVersion !== execution.version)
        throw new VisitExecutionVersionConflictError();

      const nextVersion = execution.version + 1;
      await transaction
        .update(visitExecutions)
        .set({ version: nextVersion, updatedAt: now })
        .where(
          and(
            eq(visitExecutions.tenantId, principal.tenantId),
            eq(visitExecutions.id, execution.id),
            eq(visitExecutions.version, execution.version),
            eq(visitExecutions.status, 'in_progress'),
          ),
        );
      if (existing) {
        await transaction
          .update(performedServices)
          .set({
            actualQuantity: row.actualQuantity,
            status: row.status,
            reasonCode: row.reasonCode,
            performedByEmployeeId: row.performedByEmployeeId,
            updatedAt: now,
          })
          .where(
            and(
              eq(performedServices.tenantId, principal.tenantId),
              eq(performedServices.id, existing.id),
            ),
          );
      } else {
        await transaction.insert(performedServices).values(row);
      }

      const action = serviceAuditAction(existing, row);
      const eventType = serviceEventType(existing, row);
      const event = createDomainEvent({
        type: eventType,
        tenantId: principal.tenantId,
        aggregateType: 'visit_execution',
        aggregateId: execution.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: serviceEventPayload(eventType, {
          executionId: execution.id,
          visitId,
          performedServiceId: row.id,
          status: row.status,
          reasonCode: row.reasonCode,
          version: nextVersion,
        }),
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action,
        resourceType: 'visit',
        resourceId: visitId,
        metadata: {
          executionId: execution.id,
          visitId,
          performedServiceId: row.id,
          status: row.status,
          changedFields: serviceChangedFields(existing, row),
          version: nextVersion,
        },
      });
      return { service: serviceResponse(row), version: nextVersion };
    });
  }

  async complete(
    principal: AuthorizationPrincipal,
    visitId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<VisitExecutionDetail> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisit(transaction, principal.tenantId, visitId, true);
      await this.authorizeVisit(principal, transaction, context.visit, 'visit_execution.complete');
      const employee = await this.requireAssignedEmployee(transaction, principal, context);
      const execution = await this.repository.getExecution(
        transaction,
        principal.tenantId,
        visitId,
        true,
      );
      if (!execution) throw new VisitExecutionNotStartedError();
      if (execution.status === 'completed') {
        return this.detailInTransaction(transaction, principal.tenantId, context, execution);
      }
      if (expectedVersion !== execution.version) throw new VisitExecutionVersionConflictError();

      const planned = await this.repository.plannedServices(
        transaction,
        principal.tenantId,
        visitId,
      );
      const recorded = await this.repository.performedServiceRows(
        transaction,
        principal.tenantId,
        execution.id,
      );
      const recordedPlannedIds = new Set(
        recorded.flatMap((service) => (service.visitServiceId ? [service.visitServiceId] : [])),
      );
      if (planned.some((service) => !recordedPlannedIds.has(service.id))) {
        throw new PerformedServiceRequiredError();
      }
      const now = new Date();
      if (now <= execution.actualStart) throw new VisitExecutionTimeInvalidError();
      const nextVersion = execution.version + 1;
      await transaction
        .update(visitExecutions)
        .set({
          status: 'completed',
          actualEnd: now,
          completedByEmployeeId: employee.id,
          version: nextVersion,
          updatedAt: now,
        })
        .where(
          and(
            eq(visitExecutions.tenantId, principal.tenantId),
            eq(visitExecutions.id, execution.id),
            eq(visitExecutions.version, execution.version),
            eq(visitExecutions.status, 'in_progress'),
          ),
        );
      const performedCount = recorded.filter(
        (service) => service.status !== 'not_performed',
      ).length;
      const notPerformedCount = recorded.length - performedCount;
      const event = createDomainEvent({
        type: 'visit_execution.completed',
        tenantId: principal.tenantId,
        aggregateType: 'visit_execution',
        aggregateId: execution.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          executionId: execution.id,
          visitId,
          clientId: context.visit.clientId,
          actualStart: execution.actualStart.toISOString(),
          actualEnd: now.toISOString(),
          performedCount,
          notPerformedCount,
          version: nextVersion,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'visit_execution.completed',
        resourceType: 'client',
        resourceId: context.visit.clientId,
        metadata: {
          executionId: execution.id,
          visitId,
          status: 'completed',
          version: nextVersion,
          performedCount,
          notPerformedCount,
        },
      });
      return this.detailInTransaction(transaction, principal.tenantId, context, {
        ...execution,
        status: 'completed',
        actualEnd: now,
        completedByEmployeeId: employee.id,
        version: nextVersion,
        updatedAt: now,
      });
    });
  }

  async correctTimes(
    principal: AuthorizationPrincipal,
    executionId: string,
    input: CorrectExecutionTimesInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const reason = input.reason.trim();
    if (!reason || reason.length > 1000 || (!input.actualStart && !input.actualEnd)) {
      throw new ExecutionCorrectionReasonRequiredError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.repository.getExecutionById(
        transaction,
        principal.tenantId,
        executionId,
      );
      if (!current) throw new VisitExecutionNotFoundError();
      const context = await this.requireVisit(
        transaction,
        principal.tenantId,
        current.visitId,
        true,
      );
      await this.authorizeVisit(principal, transaction, context.visit, 'visit_execution.correct');
      const execution = await this.repository.getExecutionById(
        transaction,
        principal.tenantId,
        executionId,
        true,
      );
      if (!execution) throw new VisitExecutionNotFoundError();
      if (execution.version !== input.expectedVersion)
        throw new VisitExecutionVersionConflictError();
      const actualStart = input.actualStart ?? execution.actualStart;
      const actualEnd = input.actualEnd ?? execution.actualEnd;
      if (execution.status === 'in_progress' && actualEnd !== null) {
        throw new VisitExecutionTimeInvalidError();
      }
      if (actualEnd !== null && actualEnd <= actualStart) {
        throw new VisitExecutionTimeInvalidError();
      }
      const changedFields = [
        ...(actualStart.getTime() === execution.actualStart.getTime() ? [] : ['actualStart']),
        ...(actualEnd?.getTime() === execution.actualEnd?.getTime() ? [] : ['actualEnd']),
      ];
      if (changedFields.length === 0) return { version: execution.version };

      const nextVersion = execution.version + 1;
      const now = new Date();
      await transaction
        .update(visitExecutions)
        .set({ actualStart, actualEnd, version: nextVersion, updatedAt: now })
        .where(
          and(
            eq(visitExecutions.tenantId, principal.tenantId),
            eq(visitExecutions.id, executionId),
            eq(visitExecutions.version, execution.version),
          ),
        );
      const event = createDomainEvent({
        type: 'visit_execution.corrected',
        tenantId: principal.tenantId,
        aggregateType: 'visit_execution',
        aggregateId: executionId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          executionId,
          visitId: execution.visitId,
          clientId: context.visit.clientId,
          changedFields,
          version: nextVersion,
        },
      });
      await this.record(transaction, principal, request, auditContext, {
        event,
        action: 'visit_execution.times_corrected',
        resourceType: 'visit',
        resourceId: execution.visitId,
        metadata: {
          executionId,
          visitId: execution.visitId,
          previousActualStart: execution.actualStart.toISOString(),
          actualStart: actualStart.toISOString(),
          previousActualEnd: execution.actualEnd?.toISOString() ?? null,
          actualEnd: actualEnd?.toISOString() ?? null,
          reason,
          changedFields,
          version: nextVersion,
        },
      });
      return { version: nextVersion };
    });
  }

  private async detailInTransaction(
    transaction: DatabaseTransaction,
    tenantId: string,
    context: NonNullable<Awaited<ReturnType<VisitExecutionRepository['getVisit']>>>,
    execution?: ExecutionRow | null,
  ): Promise<VisitExecutionDetail> {
    const current =
      execution === undefined
        ? await this.repository.getExecution(transaction, tenantId, context.visit.id)
        : execution;
    const planned = await this.repository.plannedServices(transaction, tenantId, context.visit.id);
    const schedulingPreferences = await this.repository.clientSchedulingPreferences(
      transaction,
      tenantId,
      context.visit.clientId,
    );
    const recorded = current
      ? await this.repository.performedServiceRows(transaction, tenantId, current.id)
      : [];
    const employeeIds = [
      ...(current ? [current.startedByEmployeeId] : []),
      ...(current?.completedByEmployeeId ? [current.completedByEmployeeId] : []),
      ...recorded.map((service) => service.performedByEmployeeId),
    ];
    const names = await this.repository.performerNames(transaction, tenantId, [
      ...new Set(employeeIds),
    ]);
    const recordedByPlan = new Map(
      recorded.flatMap((service) =>
        service.visitServiceId ? [[service.visitServiceId, service] as const] : [],
      ),
    );
    return {
      visit: {
        id: context.visit.id,
        clientId: context.visit.clientId,
        clientDisplayName: context.clientDisplayName,
        address: context.address,
        note: context.visit.note,
        schedulingPreferences: schedulingPreferences
          ? {
              preferredWeekdays: schedulingPreferences.preferredWeekdays,
              preferredTimeWindows: schedulingPreferences.preferredTimeWindows,
            }
          : null,
        status: context.visit.status,
        plannedStart: context.visit.plannedStart.toISOString(),
        plannedEnd: context.visit.plannedEnd.toISOString(),
        timezone: context.visit.timezone,
      },
      execution: {
        id: current?.id ?? null,
        status: current?.status ?? 'not_started',
        version: current?.version ?? 0,
        actualStart: current?.actualStart.toISOString() ?? null,
        actualEnd: current?.actualEnd?.toISOString() ?? null,
        startedByEmployeeId: current?.startedByEmployeeId ?? null,
        startedByEmployeeName: current ? (names.get(current.startedByEmployeeId) ?? null) : null,
        completedByEmployeeId: current?.completedByEmployeeId ?? null,
        completedByEmployeeName: current?.completedByEmployeeId
          ? (names.get(current.completedByEmployeeId) ?? null)
          : null,
      },
      services: [
        ...planned.map((service) =>
          performedServiceView(recordedByPlan.get(service.id) ?? null, service, names),
        ),
        ...recorded
          .filter((service) => service.visitServiceId === null)
          .map((service) => performedServiceView(service, null, names)),
      ],
    };
  }

  private async unplannedSnapshot(
    transaction: DatabaseTransaction,
    context: NonNullable<Awaited<ReturnType<VisitExecutionRepository['getVisit']>>>,
    execution: ExecutionRow,
    serviceDefinitionId: string | undefined,
    existing: PerformedServiceRow | null,
  ) {
    if (!serviceDefinitionId) throw new PerformedServiceServiceInvalidError();
    if (existing) {
      return {
        serviceDefinitionId: existing.serviceDefinitionId,
        serviceAgreementId: existing.serviceAgreementId,
        agreementServiceId: existing.agreementServiceId,
        serviceCodeSnapshot: existing.serviceCodeSnapshot,
        serviceNameSnapshot: existing.serviceNameSnapshot,
        unitSnapshot: existing.unitSnapshot,
        plannedQuantity: existing.plannedQuantity,
      };
    }
    const service = await this.repository.serviceForUnplanned(transaction, {
      tenantId: execution.tenantId,
      serviceDefinitionId,
      organizationId: context.visit.organizationId,
      facilityId: context.visit.facilityId,
      localDate: localDate(new Date(), context.visit.timezone),
    });
    if (!service) throw new PerformedServiceServiceInvalidError();
    return {
      serviceDefinitionId: service.id,
      serviceAgreementId: null,
      agreementServiceId: null,
      serviceCodeSnapshot: service.code,
      serviceNameSnapshot: service.name,
      unitSnapshot: service.unit,
      plannedQuantity: null,
    };
  }

  private async requireVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    lock = false,
  ) {
    const context = await this.repository.getVisit(transaction, tenantId, visitId, lock);
    if (!context) throw new VisitExecutionNotFoundError();
    return context;
  }

  private async authorizeVisit(
    principal: AuthorizationPrincipal,
    transaction: DatabaseTransaction,
    visit: VisitExecutionVisit,
    permission: Permission,
  ): Promise<void> {
    const resource = await this.visitResourceContext(transaction, principal.tenantId, visit);
    assertCan(principal, { action: permission, resource });
  }

  private async visitResourceContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    visit: VisitExecutionVisit,
  ): Promise<ResourceContext> {
    const teamIds = await this.repository.teamIdsForVisit(transaction, tenantId, visit.id);
    return {
      tenantId: visit.tenantId,
      clientId: visit.clientId,
      organizationId: visit.organizationId,
      facilityId: visit.facilityId,
      teamIds,
    };
  }

  private async requireAssignedEmployee(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: NonNullable<Awaited<ReturnType<VisitExecutionRepository['getVisit']>>>,
  ) {
    const employee = await this.requireEmployee(transaction, principal);
    await this.requireAssignment(transaction, principal.tenantId, context.visit.id, employee.id);
    return employee;
  }

  private async requireEmployee(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
  ) {
    const employee = await this.repository.employeeForUser(
      transaction,
      principal.tenantId,
      principal.userId,
    );
    if (!employee) throw new EmployeeLinkRequiredError();
    return employee;
  }

  private async requireAssignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    employeeId: string,
  ): Promise<void> {
    if (!(await this.repository.hasActiveAssignment(transaction, tenantId, visitId, employeeId))) {
      throw new VisitNotAssignedToEmployeeError();
    }
  }

  private async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
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
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

export function createVisitExecutionApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
): VisitExecutionApplicationService {
  return new VisitExecutionApplicationService(unitOfWork, audit, outbox);
}

function performedServiceView(
  service: PerformedServiceRow | null,
  planned: PlannedVisitService | null,
  names: Map<string, string>,
): VisitExecutionDetail['services'][number] {
  if (planned) {
    return {
      id: service?.id ?? null,
      visitServiceId: planned.id,
      serviceDefinitionId: planned.serviceDefinitionId,
      serviceCode: planned.serviceCodeSnapshot,
      serviceName: planned.serviceNameSnapshot,
      unit: planned.unitSnapshot,
      plannedQuantity: planned.plannedQuantity,
      actualQuantity: service?.actualQuantity ?? null,
      status: service?.status ?? 'not_recorded',
      reasonCode: service?.reasonCode ?? null,
      performedByEmployeeId: service?.performedByEmployeeId ?? null,
      performedByEmployeeName: service ? (names.get(service.performedByEmployeeId) ?? null) : null,
      unplanned: false,
    };
  }
  if (!service) throw new Error('Performed service snapshot is missing');
  return {
    id: service.id,
    visitServiceId: null,
    serviceDefinitionId: service.serviceDefinitionId,
    serviceCode: service.serviceCodeSnapshot,
    serviceName: service.serviceNameSnapshot,
    unit: service.unitSnapshot,
    plannedQuantity: null,
    actualQuantity: service.actualQuantity,
    status: service.status,
    reasonCode: service.reasonCode,
    performedByEmployeeId: service.performedByEmployeeId,
    performedByEmployeeName: names.get(service.performedByEmployeeId) ?? null,
    unplanned: true,
  };
}

function sameServiceDecision(left: PerformedServiceRow, right: PerformedServiceRow): boolean {
  return (
    left.visitServiceId === right.visitServiceId &&
    left.serviceDefinitionId === right.serviceDefinitionId &&
    left.actualQuantity === right.actualQuantity &&
    left.status === right.status &&
    left.reasonCode === right.reasonCode &&
    left.performedByEmployeeId === right.performedByEmployeeId
  );
}

function serviceChangedFields(
  current: PerformedServiceRow | null,
  next: PerformedServiceRow,
): string[] {
  if (!current) return ['status', 'actualQuantity', 'reasonCode'];
  return [
    ...(current.status === next.status ? [] : ['status']),
    ...(current.actualQuantity === next.actualQuantity ? [] : ['actualQuantity']),
    ...(current.reasonCode === next.reasonCode ? [] : ['reasonCode']),
  ];
}

function serviceAuditAction(
  current: PerformedServiceRow | null,
  next: PerformedServiceRow,
): string {
  if (next.visitServiceId === null && current === null) {
    return 'performed_service.added_unplanned';
  }
  if (next.status === 'not_performed') return 'performed_service.marked_not_performed';
  return current ? 'performed_service.updated' : 'performed_service.recorded';
}

type ServiceEventName =
  | 'performed_service.recorded'
  | 'performed_service.updated'
  | 'performed_service.marked_not_performed'
  | 'performed_service.unplanned_added';

function serviceEventType(
  current: PerformedServiceRow | null,
  next: PerformedServiceRow,
): ServiceEventName {
  if (next.visitServiceId === null && current === null) return 'performed_service.unplanned_added';
  if (next.status === 'not_performed') return 'performed_service.marked_not_performed';
  return current ? 'performed_service.updated' : 'performed_service.recorded';
}

function serviceEventPayload(
  type: ServiceEventName,
  input: {
    executionId: string;
    visitId: string;
    performedServiceId: string;
    status: PerformedServiceStatus;
    reasonCode: ReasonCode | null;
    version: number;
  },
) {
  const base = {
    executionId: input.executionId,
    visitId: input.visitId,
    performedServiceId: input.performedServiceId,
    status: input.status,
    version: input.version,
  };
  return type === 'performed_service.marked_not_performed'
    ? { ...base, reasonCode: input.reasonCode ?? 'other' }
    : base;
}

function serviceResponse(service: PerformedServiceRow) {
  return {
    id: service.id,
    visitServiceId: service.visitServiceId,
    serviceDefinitionId: service.serviceDefinitionId,
    serviceCode: service.serviceCodeSnapshot,
    serviceName: service.serviceNameSnapshot,
    unit: service.unitSnapshot,
    plannedQuantity: service.plannedQuantity,
    actualQuantity: service.actualQuantity,
    status: service.status,
    reasonCode: service.reasonCode,
    performedByEmployeeId: service.performedByEmployeeId,
    unplanned: service.visitServiceId === null,
  };
}

function localDate(date: Date, timezone: string): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return values.year + '-' + values.month + '-' + values.day;
}

function groupBy<T, K>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const items = grouped.get(key) ?? [];
    items.push(row);
    grouped.set(key, items);
  }
  return grouped;
}

function validInstant(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export class VisitExecutionNotFoundError extends Error {
  readonly code = 'VISIT_EXECUTION_NOT_FOUND';
  constructor() {
    super('Visit execution or visit was not found');
    this.name = 'VisitExecutionNotFoundError';
  }
}

export class VisitExecutionNotStartedError extends Error {
  readonly code = 'VISIT_EXECUTION_NOT_STARTED';
  constructor() {
    super('Visit execution has not started');
    this.name = 'VisitExecutionNotStartedError';
  }
}

export class VisitExecutionAlreadyCompletedError extends Error {
  readonly code = 'VISIT_EXECUTION_ALREADY_COMPLETED';
  constructor() {
    super('Visit execution is already completed');
    this.name = 'VisitExecutionAlreadyCompletedError';
  }
}

export class VisitExecutionVersionConflictError extends Error {
  readonly code = 'VISIT_EXECUTION_VERSION_CONFLICT';
  constructor() {
    super('Visit execution has changed since it was read');
    this.name = 'VisitExecutionVersionConflictError';
  }
}

export class VisitExecutionTimeInvalidError extends Error {
  readonly code = 'VISIT_EXECUTION_TIME_INVALID';
  constructor() {
    super('Actual departure must be later than actual arrival');
    this.name = 'VisitExecutionTimeInvalidError';
  }
}

export class VisitExecutionVisitCancelledError extends Error {
  readonly code = 'VISIT_CANCELLED';
  constructor() {
    super('Cancelled visits cannot be started');
    this.name = 'VisitExecutionVisitCancelledError';
  }
}

export class VisitNotAssignedToEmployeeError extends Error {
  readonly code = 'VISIT_NOT_ASSIGNED_TO_EMPLOYEE';
  constructor() {
    super('The current employee is not actively assigned to this visit');
    this.name = 'VisitNotAssignedToEmployeeError';
  }
}

export class EmployeeLinkRequiredError extends Error {
  readonly code = 'EMPLOYEE_LINK_REQUIRED';
  constructor() {
    super('The current user is not linked to an active employee');
    this.name = 'EmployeeLinkRequiredError';
  }
}

export class PerformedServiceNotFoundError extends Error {
  readonly code = 'PERFORMED_SERVICE_NOT_FOUND';
  constructor() {
    super('Performed service was not found for this visit execution');
    this.name = 'PerformedServiceNotFoundError';
  }
}

export class PerformedServiceServiceInvalidError extends Error {
  readonly code = 'PERFORMED_SERVICE_SERVICE_INVALID';
  constructor() {
    super('Service is invalid for this visit or provider');
    this.name = 'PerformedServiceServiceInvalidError';
  }
}

export class PerformedServiceRequiredError extends Error {
  readonly code = 'PERFORMED_SERVICE_REQUIRED';
  constructor() {
    super('Every planned service needs an explicit execution result');
    this.name = 'PerformedServiceRequiredError';
  }
}

export class InvalidVisitExecutionQueryError extends Error {
  readonly code = 'VISIT_EXECUTION_QUERY_INVALID';
  constructor() {
    super('Visit execution query is invalid');
    this.name = 'InvalidVisitExecutionQueryError';
  }
}

export class ExecutionCorrectionReasonRequiredError extends Error {
  readonly code = 'EXECUTION_CORRECTION_REASON_REQUIRED';
  constructor() {
    super('Time corrections need a reason and at least one changed value');
    this.name = 'ExecutionCorrectionReasonRequiredError';
  }
}
