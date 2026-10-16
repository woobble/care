import { eq, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { PermissionGrant } from '@care/permissions';
import { facilities, organizationsTable, teams } from '@module/organizations/schema';

export type StructureVisibilityGrant = Pick<
  PermissionGrant,
  'permission' | 'scopeType' | 'scopeId'
>;
type StructureKind = 'organization' | 'facility' | 'team';

export function structureVisibilityPredicate(
  kind: StructureKind,
  tenantId: string,
  grants: readonly StructureVisibilityGrant[],
): SQL {
  const permission = kind === 'organization' ? 'organization.read' : `${kind}.read`;
  const relevant = grants.filter(
    (grant) => grant.permission === permission || grant.permission === 'organization.manage',
  );
  const scoped: SQL[] = [];
  for (const grant of relevant) {
    if (grant.scopeType === 'tenant' && grant.scopeId === tenantId) return sql`true`;
    if (grant.scopeType === 'organization') {
      scoped.push(
        eq(
          kind === 'organization'
            ? organizationsTable.id
            : kind === 'facility'
              ? facilities.organizationId
              : teams.organizationId,
          grant.scopeId,
        ),
      );
    } else if (grant.scopeType === 'facility') {
      if (kind === 'facility') scoped.push(eq(facilities.id, grant.scopeId));
      if (kind === 'team') scoped.push(eq(teams.facilityId, grant.scopeId));
    } else if (grant.scopeType === 'team' && kind === 'team') {
      scoped.push(eq(teams.id, grant.scopeId));
    }
  }
  return scoped.length ? or(...scoped)! : sql`false`;
}
