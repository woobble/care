import { and, asc, eq, gte, lte, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { UnitOfWork } from '@care/database';
import {
  AuthorizationDeniedError,
  type AuthorizationPrincipal,
  type Permission,
} from '@care/permissions';

import {
  employeeQualifications,
  employeeRecords,
  qualificationDefinitions,
  employeeFacilityAssignments,
} from '@module/employees/schema';

export interface QualificationExpiryQuery {
  fromDate: string;
  untilDate: string;
  organizationId?: string;
  facilityId?: string;
  employeeId?: string;
  offset: number;
  pageSize: 100;
}
export interface QualificationExpiryFact {
  id: string;
  organizationId: string | null;
  facilityId: string | null;
  validUntil: string | null;
  employeeId: string;
  employeeName: string;
  qualificationName: string;
}

export class QualificationExpiryQueries {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async operationsExpiryPage(
    principal: AuthorizationPrincipal,
    query: QualificationExpiryQuery,
  ): Promise<{ items: QualificationExpiryFact[]; complete: boolean }> {
    if (!Number.isInteger(query.offset) || query.offset < 0 || query.pageSize !== 100)
      throw new RangeError('Expiry pages require a nonnegative offset and page size 100');
    if (
      !principal.grants.some(
        (g) => g.permission === 'employee.read' || g.permission === 'employee.manage',
      )
    )
      throw new AuthorizationDeniedError('employee.read');
    const employeeScope = permissionScope(principal, 'employee.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          id: employeeQualifications.id,
          employeeId: employeeRecords.id,
          employeeName: sql<string>`concat_ws(' ', coalesce(nullif(${employeeRecords.preferredName}, ''), ${employeeRecords.firstName}), ${employeeRecords.lastName})`,
          qualificationName: qualificationDefinitions.name,
          organizationId: employeeRecords.organizationId,
          facilityId: employeeFacilityAssignments.facilityId,
          validUntil: employeeQualifications.validUntil,
        })
        .from(employeeQualifications)
        .innerJoin(
          employeeRecords,
          and(
            eq(employeeRecords.tenantId, employeeQualifications.tenantId),
            eq(employeeRecords.id, employeeQualifications.employeeId),
          ),
        )
        .innerJoin(
          qualificationDefinitions,
          and(
            eq(qualificationDefinitions.tenantId, employeeQualifications.tenantId),
            eq(qualificationDefinitions.id, employeeQualifications.qualificationId),
          ),
        )
        .leftJoin(
          employeeFacilityAssignments,
          and(
            eq(employeeFacilityAssignments.tenantId, employeeRecords.tenantId),
            eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
            eq(employeeFacilityAssignments.organizationId, employeeRecords.organizationId),
            eq(employeeFacilityAssignments.isPrimary, true),
            eq(employeeFacilityAssignments.status, 'active'),
          ),
        )
        .where(
          and(
            eq(employeeQualifications.tenantId, principal.tenantId),
            eq(employeeQualifications.status, 'active'),
            eq(employeeRecords.status, 'active'),
            scopedTo(
              employeeScope,
              employeeRecords.organizationId,
              employeeFacilityAssignments.facilityId,
            ),
            ...(query.organizationId
              ? [eq(employeeRecords.organizationId, query.organizationId)]
              : []),
            ...(query.facilityId
              ? [eq(employeeFacilityAssignments.facilityId, query.facilityId)]
              : []),
            ...(query.employeeId ? [eq(employeeRecords.id, query.employeeId)] : []),
            isNotNull(employeeQualifications.validUntil),
            gte(employeeQualifications.validUntil, query.fromDate),
            lte(employeeQualifications.validUntil, query.untilDate),
          ),
        )
        .orderBy(asc(employeeQualifications.validUntil), asc(employeeQualifications.id))
        .limit(100)
        .offset(query.offset);
      return { items: rows, complete: rows.length < query.pageSize };
    });
  }
}
function permissionScope(principal: AuthorizationPrincipal, permission: Permission) {
  const grants = principal.grants.filter(
    (grant) =>
      grant.permission === permission ||
      (permission === 'employee.read' && grant.permission === 'employee.manage'),
  );
  return {
    tenantWide: grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: grants
      .filter((grant) => grant.scopeType === 'organization')
      .map((grant) => grant.scopeId),
    facilityIds: grants
      .filter((grant) => grant.scopeType === 'facility')
      .map((grant) => grant.scopeId),
  };
}

function scopedTo(
  scope: ReturnType<typeof permissionScope>,
  organizationColumn: AnyPgColumn,
  facilityColumn: AnyPgColumn,
): SQL {
  if (scope.tenantWide) return sql`true`;
  const allowed: SQL[] = [];
  if (scope.organizationIds.length)
    allowed.push(inArray(organizationColumn, scope.organizationIds));
  if (scope.facilityIds.length) allowed.push(inArray(facilityColumn, scope.facilityIds));
  return allowed.length ? or(...allowed)! : sql`false`;
}
