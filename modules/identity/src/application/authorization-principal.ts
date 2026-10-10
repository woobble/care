import { and, eq, exists, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import {
  PERMISSIONS,
  type AuthorizationPrincipal,
  type Permission,
  type ScopeType,
} from '@care/permissions';
import { tenants } from '@care/organizations';
import {
  membershipRoles,
  membershipScopes,
  rolePermissions,
  roles,
  tenantMemberships,
} from '@module/identity/schema';
import {
  InvalidAuthorizationConfigurationError,
  TenantAccessDeniedError,
} from './identity.service';

export async function loadTenantAuthorizationPrincipal(
  transaction: DatabaseTransaction,
  userId: string,
  tenantId: string,
  options: { lockMembership?: boolean } = {},
): Promise<AuthorizationPrincipal> {
  await transaction.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
  const membershipQuery = transaction
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
        exists(
          transaction
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.id, tenantId), eq(tenants.active, true))),
        ),
      ),
    );
  const memberships = options.lockMembership
    ? await membershipQuery.for('update').limit(1)
    : await membershipQuery.limit(1);
  const membership = memberships[0];
  if (!membership) throw new TenantAccessDeniedError();

  const rows = await transaction
    .select({
      roleName: roles.name,
      permission: rolePermissions.permission,
      scopeType: membershipScopes.scopeType,
      scopeId: membershipScopes.scopeId,
    })
    .from(membershipRoles)
    .innerJoin(
      roles,
      and(
        eq(membershipRoles.roleId, roles.id),
        eq(membershipRoles.tenantId, tenantId),
        eq(roles.tenantId, tenantId),
      ),
    )
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(
      membershipScopes,
      and(
        eq(membershipScopes.membershipId, membership.id),
        eq(membershipScopes.tenantId, tenantId),
      ),
    )
    .where(eq(membershipRoles.membershipId, membership.id));

  const rolesForUser = [...new Set(rows.map((row) => row.roleName))];
  const grants = rows.map((row) => {
    if (!isPermission(row.permission) || !isScopeType(row.scopeType)) {
      throw new InvalidAuthorizationConfigurationError();
    }
    return { permission: row.permission, scopeType: row.scopeType, scopeId: row.scopeId };
  });
  return { userId, tenantId, roles: rolesForUser, grants };
}

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

function isScopeType(value: string): value is ScopeType {
  return ['assigned_clients', 'team', 'facility', 'organization', 'tenant'].includes(value);
}
