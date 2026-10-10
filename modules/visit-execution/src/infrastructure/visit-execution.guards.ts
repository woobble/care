import { and, eq, or, isNotNull } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { visitAssignments } from '@care/scheduling';
import { visits } from '@care/scheduling';
import { performedServices, visitExecutions } from '@module/visit-execution/schema';

export interface VisitExecutionGuards {
  hasExecutionForVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<boolean>;
  hasInProgressExecutionForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
  hasInProgressExecutionForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<boolean>;
  hasInProgressExecutionForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean>;
  hasInProgressExecutionForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<boolean>;
}

export class DrizzleVisitExecutionGuards implements VisitExecutionGuards {
  async hasExecutionForVisit(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitExecutions.id })
      .from(visitExecutions)
      .where(and(eq(visitExecutions.tenantId, tenantId), eq(visitExecutions.visitId, visitId)))
      .limit(1);
    return row !== undefined;
  }

  async hasInProgressExecutionForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitExecutions.id })
      .from(visitExecutions)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, visitExecutions.tenantId), eq(visits.id, visitExecutions.visitId)),
      )
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
          eq(visitExecutions.status, 'in_progress'),
          eq(visits.clientId, clientId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasInProgressExecutionForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitExecutions.id })
      .from(visitExecutions)
      .leftJoin(
        visitAssignments,
        and(
          eq(visitAssignments.tenantId, visitExecutions.tenantId),
          eq(visitAssignments.visitId, visitExecutions.visitId),
          eq(visitAssignments.employeeId, employeeId),
          eq(visitAssignments.status, 'active'),
        ),
      )
      .leftJoin(
        performedServices,
        and(
          eq(performedServices.tenantId, visitExecutions.tenantId),
          eq(performedServices.executionId, visitExecutions.id),
          eq(performedServices.performedByEmployeeId, employeeId),
        ),
      )
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
          eq(visitExecutions.status, 'in_progress'),
          or(
            eq(visitExecutions.startedByEmployeeId, employeeId),
            isNotNull(visitAssignments.id),
            isNotNull(performedServices.id),
          ),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasInProgressExecutionForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitExecutions.id })
      .from(visitExecutions)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, visitExecutions.tenantId), eq(visits.id, visitExecutions.visitId)),
      )
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
          eq(visitExecutions.status, 'in_progress'),
          eq(visits.facilityId, facilityId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasInProgressExecutionForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitExecutions.id })
      .from(visitExecutions)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, visitExecutions.tenantId), eq(visits.id, visitExecutions.visitId)),
      )
      .where(
        and(
          eq(visitExecutions.tenantId, tenantId),
          eq(visitExecutions.status, 'in_progress'),
          eq(visits.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}

export function createVisitExecutionGuards(): VisitExecutionGuards {
  return new DrizzleVisitExecutionGuards();
}
