import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { visitAssignments, visitServices, visits } from '../schema';

export interface SchedulingGuards {
  hasVisitsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
  hasFutureVisitsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
  hasFutureAssignmentsForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<boolean>;
  hasFutureVisitsForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean>;
  hasFutureVisitsForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<boolean>;
  hasFutureVisitsForAgreement(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    after?: Date,
  ): Promise<boolean>;
  hasFutureVisitsForAgreementService(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementServiceId: string,
  ): Promise<boolean>;
  hasFutureVisitsOutsideAgreementValidity(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    validFrom: string,
    validUntil: string | null,
  ): Promise<boolean>;
  hasFutureVisitsOutsideAgreementServiceValidity(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementServiceId: string,
    validFrom: string | null,
    validUntil: string | null,
  ): Promise<boolean>;
}

export class DrizzleSchedulingGuards implements SchedulingGuards {
  async hasVisitsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.tenantId, tenantId), eq(visits.clientId, clientId)))
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.clientId, clientId),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureAssignmentsForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitAssignments.id })
      .from(visitAssignments)
      .innerJoin(
        visits,
        and(
          eq(visits.tenantId, visitAssignments.tenantId),
          eq(visits.id, visitAssignments.visitId),
        ),
      )
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          eq(visitAssignments.employeeId, employeeId),
          eq(visitAssignments.status, 'active'),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.facilityId, facilityId),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.organizationId, organizationId),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsForAgreement(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    after = new Date(),
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.serviceAgreementId, agreementId),
          activeVisitFilter(),
          gt(visits.plannedEnd, after),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsForAgreementService(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementServiceId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: visitServices.id })
      .from(visitServices)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, visitServices.tenantId), eq(visits.id, visitServices.visitId)),
      )
      .where(
        and(
          eq(visitServices.tenantId, tenantId),
          eq(visitServices.agreementServiceId, agreementServiceId),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsOutsideAgreementValidity(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    validFrom: string,
    validUntil: string | null,
  ): Promise<boolean> {
    const localDate = sql`(${visits.plannedStart} AT TIME ZONE ${visits.timezone})::date`;
    const outside =
      validUntil === null
        ? sql`${localDate} < ${validFrom}::date`
        : sql`${localDate} < ${validFrom}::date OR ${localDate} > ${validUntil}::date`;
    const [row] = await transaction
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.serviceAgreementId, agreementId),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
          outside,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasFutureVisitsOutsideAgreementServiceValidity(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementServiceId: string,
    validFrom: string | null,
    validUntil: string | null,
  ): Promise<boolean> {
    const localDate = sql`(${visits.plannedStart} AT TIME ZONE ${visits.timezone})::date`;
    const bounds = [
      ...(validFrom === null ? [] : [sql`${localDate} < ${validFrom}::date`]),
      ...(validUntil === null ? [] : [sql`${localDate} > ${validUntil}::date`]),
    ];
    if (bounds.length === 0) return false;
    const [row] = await transaction
      .select({ id: visitServices.id })
      .from(visitServices)
      .innerJoin(
        visits,
        and(eq(visits.tenantId, visitServices.tenantId), eq(visits.id, visitServices.visitId)),
      )
      .where(
        and(
          eq(visitServices.tenantId, tenantId),
          eq(visitServices.agreementServiceId, agreementServiceId),
          activeVisitFilter(),
          gt(visits.plannedEnd, new Date()),
          sql`(${sql.join(bounds, sql` OR `)})`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}

function activeVisitFilter() {
  return inArray(visits.status, ['planned', 'confirmed'] as const);
}

export function createSchedulingGuards(): SchedulingGuards {
  return new DrizzleSchedulingGuards();
}
