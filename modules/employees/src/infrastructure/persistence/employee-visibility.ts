import { and, eq, exists, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import type { PermissionGrant } from '@care/permissions';
import { facilities, teams } from '@care/organizations';
import {
  employeeFacilityAssignments,
  employeeRecords,
  employeeTeamMemberships,
} from '../../schema';

export type EmployeeVisibilityGrant = Pick<PermissionGrant, 'scopeType' | 'scopeId'>;

/** Build the employee visibility predicate for already-filtered authorization grants. */
export function employeeVisibilityPredicate(
  transaction: DatabaseTransaction,
  tenantId: string,
  grants: readonly EmployeeVisibilityGrant[],
): SQL {
  const scoped: SQL[] = [];
  for (const grant of grants) {
    if (grant.scopeType === 'tenant' && grant.scopeId === tenantId) return sql`true`;
    if (grant.scopeType === 'organization') {
      scoped.push(eq(employeeRecords.organizationId, grant.scopeId));
    } else if (grant.scopeType === 'facility') {
      scoped.push(
        exists(
          transaction
            .select({ id: employeeFacilityAssignments.id })
            .from(employeeFacilityAssignments)
            .innerJoin(
              facilities,
              and(
                eq(facilities.tenantId, employeeFacilityAssignments.tenantId),
                eq(facilities.id, employeeFacilityAssignments.facilityId),
              ),
            )
            .where(
              and(
                eq(employeeFacilityAssignments.tenantId, tenantId),
                eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
                eq(employeeFacilityAssignments.facilityId, grant.scopeId),
                eq(employeeFacilityAssignments.status, 'active'),
                eq(facilities.status, 'active'),
              ),
            ),
        ),
      );
    } else if (grant.scopeType === 'team') {
      scoped.push(
        exists(
          transaction
            .select({ id: employeeTeamMemberships.id })
            .from(employeeTeamMemberships)
            .innerJoin(
              teams,
              and(
                eq(teams.tenantId, employeeTeamMemberships.tenantId),
                eq(teams.id, employeeTeamMemberships.teamId),
              ),
            )
            .where(
              and(
                eq(employeeTeamMemberships.tenantId, tenantId),
                eq(employeeTeamMemberships.employeeId, employeeRecords.id),
                eq(employeeTeamMemberships.teamId, grant.scopeId),
                eq(employeeTeamMemberships.status, 'active'),
                eq(teams.status, 'active'),
              ),
            ),
        ),
      );
    }
  }
  return scoped.length ? or(...scoped)! : sql`false`;
}
