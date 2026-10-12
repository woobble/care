import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { clientAddresses, clientRecords } from '@care/clients';
import { employeeRecords, employeeTeamMemberships } from '@care/employees';
import {
  clientSchedulingPreferences,
  visitAssignments,
  visits,
  visitServices,
} from '@care/scheduling';
import { serviceAvailability, serviceDefinitions } from '@care/services';
import { performedServices, visitExecutions } from '@module/visit-execution/schema';

export type VisitExecutionVisit = typeof visits.$inferSelect;
export type PlannedVisitService = typeof visitServices.$inferSelect;
export type ExecutionRow = typeof visitExecutions.$inferSelect;
export type PerformedServiceRow = typeof performedServices.$inferSelect;
export type ServiceDefinitionRow = typeof serviceDefinitions.$inferSelect;

export class VisitExecutionRepository {
  async clientSchedulingPreferences(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ) {
    const [preferences] = await transaction
      .select({
        preferredWeekdays: clientSchedulingPreferences.preferredWeekdays,
        preferredTimeWindows: clientSchedulingPreferences.preferredTimeWindows,
      })
      .from(clientSchedulingPreferences)
      .where(
        and(
          eq(clientSchedulingPreferences.tenantId, tenantId),
          eq(clientSchedulingPreferences.clientId, clientId),
        ),
      )
      .limit(1);
    return preferences ?? null;
  }

  async operationalExecutions(
    transaction: DatabaseTransaction,
    tenantId: string,
    from: Date,
    until: Date,
  ) {
    return transaction
      .select({
        visit: visits,
        execution: visitExecutions,
        preferredName: clientRecords.preferredName,
        firstName: clientRecords.firstName,
        lastName: clientRecords.lastName,
      })
      .from(visitExecutions)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, visitExecutions.tenantId), eq(visits.id, visitExecutions.visitId)),
      )
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
          eq(visitExecutions.status, 'in_progress'),
          gte(visits.plannedEnd, from),
          lt(visits.plannedEnd, until),
        ),
      )
      .orderBy(asc(visits.plannedEnd), asc(visits.id))
      .limit(101);
  }

  async getVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    lock = false,
  ) {
    const where = and(eq(visits.tenantId, tenantId), eq(visits.id, visitId));
    const [visit] = lock
      ? await transaction.select().from(visits).where(where).for('update').limit(1)
      : await transaction.select().from(visits).where(where).limit(1);
    if (!visit) return null;
    const [client] = await transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, visit.clientId)))
      .limit(1);
    if (!client) return null;
    const [address] = await transaction
      .select()
      .from(clientAddresses)
      .where(
        and(
          eq(clientAddresses.tenantId, tenantId),
          eq(clientAddresses.clientId, client.id),
          eq(clientAddresses.isPrimary, true),
        ),
      )
      .limit(1);
    return {
      visit,
      clientDisplayName: (client.preferredName || client.firstName) + ' ' + client.lastName,
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
    };
  }

  async visitsForIds(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ): Promise<VisitExecutionVisit[]> {
    if (visitIds.length === 0) return [];
    return transaction
      .select()
      .from(visits)
      .where(and(eq(visits.tenantId, tenantId), inArray(visits.id, visitIds)));
  }

  async employeeForUser(transaction: DatabaseTransaction, tenantId: string, userId: string) {
    const [employee] = await transaction
      .select({ id: employeeRecords.id, status: employeeRecords.status })
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, tenantId),
          eq(employeeRecords.userId, userId),
          eq(employeeRecords.status, 'active'),
        ),
      )
      .limit(1);
    return employee ?? null;
  }

  async hasActiveAssignment(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    employeeId: string,
  ): Promise<boolean> {
    const [assignment] = await transaction
      .select({ id: visitAssignments.id })
      .from(visitAssignments)
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.employeeId, employeeId),
          eq(visitAssignments.status, 'active'),
        ),
      )
      .limit(1);
    return assignment !== undefined;
  }

  async teamIdsForVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<string[]> {
    const rows = await transaction
      .selectDistinct({ teamId: employeeTeamMemberships.teamId })
      .from(visitAssignments)
      .innerJoin(
        employeeTeamMemberships,
        and(
          eq(employeeTeamMemberships.tenantId, visitAssignments.tenantId),
          eq(employeeTeamMemberships.employeeId, visitAssignments.employeeId),
          eq(employeeTeamMemberships.status, 'active'),
        ),
      )
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.visitId, visitId),
          eq(visitAssignments.status, 'active'),
        ),
      );
    return rows.map((row) => row.teamId);
  }

  async getExecution(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
    lock = false,
  ): Promise<ExecutionRow | null> {
    const where = and(eq(visitExecutions.tenantId, tenantId), eq(visitExecutions.visitId, visitId));
    const [row] = lock
      ? await transaction.select().from(visitExecutions).where(where).for('update').limit(1)
      : await transaction.select().from(visitExecutions).where(where).limit(1);
    return row ?? null;
  }

  async getExecutionById(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionId: string,
    lock = false,
  ): Promise<ExecutionRow | null> {
    const where = and(eq(visitExecutions.tenantId, tenantId), eq(visitExecutions.id, executionId));
    const [row] = lock
      ? await transaction.select().from(visitExecutions).where(where).for('update').limit(1)
      : await transaction.select().from(visitExecutions).where(where).limit(1);
    return row ?? null;
  }

  async plannedServices(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<PlannedVisitService[]> {
    return transaction
      .select()
      .from(visitServices)
      .where(and(eq(visitServices.tenantId, tenantId), eq(visitServices.visitId, visitId)))
      .orderBy(asc(visitServices.createdAt), asc(visitServices.id));
  }

  async performedServiceRows(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionId: string,
  ): Promise<PerformedServiceRow[]> {
    return transaction
      .select()
      .from(performedServices)
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          eq(performedServices.executionId, executionId),
        ),
      )
      .orderBy(asc(performedServices.createdAt), asc(performedServices.id));
  }

  async findPlannedPerformedService(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionId: string,
    visitServiceId: string,
  ): Promise<PerformedServiceRow | null> {
    const [row] = await transaction
      .select()
      .from(performedServices)
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          eq(performedServices.executionId, executionId),
          eq(performedServices.visitServiceId, visitServiceId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findPerformedService(
    transaction: DatabaseTransaction,
    tenantId: string,
    executionId: string,
    performedServiceId: string,
  ): Promise<PerformedServiceRow | null> {
    const [row] = await transaction
      .select()
      .from(performedServices)
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          eq(performedServices.executionId, executionId),
          eq(performedServices.id, performedServiceId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async serviceForUnplanned(
    transaction: DatabaseTransaction,
    input: {
      tenantId: string;
      serviceDefinitionId: string;
      organizationId: string;
      facilityId: string;
      localDate: string;
    },
  ): Promise<ServiceDefinitionRow | null> {
    const [service] = await transaction
      .select()
      .from(serviceDefinitions)
      .where(
        and(
          eq(serviceDefinitions.tenantId, input.tenantId),
          eq(serviceDefinitions.id, input.serviceDefinitionId),
          eq(serviceDefinitions.status, 'active'),
          lte(serviceDefinitions.validFrom, input.localDate),
          or(
            isNull(serviceDefinitions.validUntil),
            gt(serviceDefinitions.validUntil, input.localDate),
          ),
        ),
      )
      .limit(1);
    if (!service) return null;
    const [availability] = await transaction
      .select({ id: serviceAvailability.id })
      .from(serviceAvailability)
      .where(
        and(
          eq(serviceAvailability.tenantId, input.tenantId),
          eq(serviceAvailability.serviceId, input.serviceDefinitionId),
          eq(serviceAvailability.organizationId, input.organizationId),
          eq(serviceAvailability.active, true),
          or(
            isNull(serviceAvailability.facilityId),
            eq(serviceAvailability.facilityId, input.facilityId),
          ),
          or(
            isNull(serviceAvailability.validFrom),
            lte(serviceAvailability.validFrom, input.localDate),
          ),
          or(
            isNull(serviceAvailability.validUntil),
            gt(serviceAvailability.validUntil, input.localDate),
          ),
        ),
      )
      .limit(1);
    return availability ? service : null;
  }

  async listAvailableServices(
    transaction: DatabaseTransaction,
    input: {
      tenantId: string;
      organizationId: string;
      facilityId: string;
      localDate: string;
    },
  ) {
    return transaction
      .selectDistinct({
        id: serviceDefinitions.id,
        code: serviceDefinitions.code,
        name: serviceDefinitions.name,
        unit: serviceDefinitions.unit,
      })
      .from(serviceDefinitions)
      .innerJoin(
        serviceAvailability,
        and(
          eq(serviceAvailability.tenantId, serviceDefinitions.tenantId),
          eq(serviceAvailability.serviceId, serviceDefinitions.id),
          eq(serviceAvailability.organizationId, input.organizationId),
          eq(serviceAvailability.active, true),
          or(
            isNull(serviceAvailability.facilityId),
            eq(serviceAvailability.facilityId, input.facilityId),
          ),
          or(
            isNull(serviceAvailability.validFrom),
            lte(serviceAvailability.validFrom, input.localDate),
          ),
          or(
            isNull(serviceAvailability.validUntil),
            gt(serviceAvailability.validUntil, input.localDate),
          ),
        ),
      )
      .where(
        and(
          eq(serviceDefinitions.tenantId, input.tenantId),
          eq(serviceDefinitions.status, 'active'),
          lte(serviceDefinitions.validFrom, input.localDate),
          or(
            isNull(serviceDefinitions.validUntil),
            gt(serviceDefinitions.validUntil, input.localDate),
          ),
        ),
      )
      .orderBy(asc(serviceDefinitions.name), asc(serviceDefinitions.id));
  }

  async listAssignedVisits(
    transaction: DatabaseTransaction,
    input: { tenantId: string; employeeId: string; from: Date; until: Date },
  ) {
    return transaction
      .select({
        visit: visits,
        preferredName: clientRecords.preferredName,
        firstName: clientRecords.firstName,
        lastName: clientRecords.lastName,
        address: clientAddresses,
        assignmentAssignedAt: visitAssignments.assignedAt,
      })
      .from(visits)
      .innerJoin(
        visitAssignments,
        and(
          eq(visitAssignments.tenantId, visits.tenantId),
          eq(visitAssignments.visitId, visits.id),
          eq(visitAssignments.employeeId, input.employeeId),
          eq(visitAssignments.status, 'active'),
        ),
      )
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .leftJoin(
        clientAddresses,
        and(
          eq(clientAddresses.tenantId, clientRecords.tenantId),
          eq(clientAddresses.clientId, clientRecords.id),
          eq(clientAddresses.isPrimary, true),
        ),
      )
      .where(
        and(
          eq(visits.tenantId, input.tenantId),
          lt(visits.plannedStart, input.until),
          gt(visits.plannedEnd, input.from),
        ),
      )
      .orderBy(asc(visits.plannedStart), asc(visits.id))
      .limit(100);
  }

  async plannedServicesForVisits(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ): Promise<PlannedVisitService[]> {
    if (visitIds.length === 0) return [];
    return transaction
      .select()
      .from(visitServices)
      .where(and(eq(visitServices.tenantId, tenantId), inArray(visitServices.visitId, visitIds)))
      .orderBy(asc(visitServices.visitId), asc(visitServices.createdAt), asc(visitServices.id));
  }

  async executionsForVisits(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ): Promise<ExecutionRow[]> {
    if (visitIds.length === 0) return [];
    return transaction
      .select()
      .from(visitExecutions)
      .where(
        and(eq(visitExecutions.tenantId, tenantId), inArray(visitExecutions.visitId, visitIds)),
      );
  }

  async performerNames(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeIds: string[],
  ): Promise<Map<string, string>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await transaction
      .select({
        id: employeeRecords.id,
        firstName: employeeRecords.firstName,
        preferredName: employeeRecords.preferredName,
        lastName: employeeRecords.lastName,
      })
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, tenantId), inArray(employeeRecords.id, employeeIds)));
    return new Map(
      rows.map((row) => [row.id, (row.preferredName || row.firstName) + ' ' + row.lastName]),
    );
  }
}
