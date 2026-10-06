import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v7 as uuidv7 } from 'uuid';
import type { VerifiedIdentity } from '@care/auth';
import type { AuthorizationPrincipal, Permission, ScopeType } from '@care/permissions';
import { PERMISSIONS } from '@care/permissions';
import {
  externalIdentities,
  membershipRoles,
  membershipScopes,
  rolePermissions,
  roles,
  tenantMemberships,
  users,
} from '../schema';
import { tenants } from '@care/organizations';

export interface TenantSummary {
  id: string;
  name: string;
}

export class IdentityService {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async resolveOrProvision(
    identity: VerifiedIdentity,
  ): Promise<{ id: string; status: 'active' | 'disabled' }> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${identity.issuer}), hashtext(${identity.subject}))`,
      );
      const [external] = await transaction
        .select({ userId: externalIdentities.userId })
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.issuer, identity.issuer),
            eq(externalIdentities.subject, identity.subject),
          ),
        )
        .limit(1);

      if (external) return this.getUser(transaction, external.userId);

      const userId = uuidv7();
      await transaction.insert(users).values({ id: userId, status: 'active' });
      await transaction.insert(externalIdentities).values({
        id: uuidv7(),
        userId,
        issuer: identity.issuer,
        subject: identity.subject,
      });
      return { id: userId, status: 'active' };
    });
  }

  async listTenantMemberships(userId: string): Promise<TenantSummary[]> {
    await this.requireActiveUser(userId);
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return transaction
        .select({ id: tenants.id, name: tenants.name })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
        .where(
          and(
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.status, 'active'),
            eq(tenants.active, true),
          ),
        )
        .orderBy(tenants.name);
    });
  }

  async getCurrentUser(userId: string): Promise<{ id: string; status: 'active' | 'disabled' }> {
    return this.requireActiveUser(userId);
  }

  async loadTenantPrincipal(userId: string, tenantId: string): Promise<AuthorizationPrincipal> {
    await this.requireActiveUser(userId);
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      const [membership] = await transaction
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
        .where(
          and(
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.status, 'active'),
            eq(tenants.active, true),
          ),
        )
        .limit(1);
      if (!membership) throw new TenantAccessDeniedError();

      await transaction.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      const rows = await transaction
        .select({
          roleName: roles.name,
          permission: rolePermissions.permission,
          scopeType: membershipScopes.scopeType,
          scopeId: membershipScopes.scopeId,
        })
        .from(membershipRoles)
        .innerJoin(roles, and(eq(membershipRoles.roleId, roles.id), eq(roles.tenantId, tenantId)))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(membershipScopes, eq(membershipScopes.membershipId, membership.id))
        .where(eq(membershipRoles.membershipId, membership.id));

      const rolesForUser = [...new Set(rows.map((row) => row.roleName))];
      const grants = rows.map((row) => {
        if (!isPermission(row.permission) || !isScopeType(row.scopeType)) {
          throw new InvalidAuthorizationConfigurationError();
        }
        return { permission: row.permission, scopeType: row.scopeType, scopeId: row.scopeId };
      });
      return { userId, tenantId, roles: rolesForUser, grants };
    });
  }

  private async requireActiveUser(
    userId: string,
  ): Promise<{ id: string; status: 'active' | 'disabled' }> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.status !== 'active') throw new DisabledUserError();
    return { id: userId, status: user.status };
  }

  private async getUser(
    transaction: Parameters<
      Parameters<NodePgDatabase<Record<string, unknown>>['transaction']>[0]
    >[0],
    userId: string,
  ): Promise<{ id: string; status: 'active' | 'disabled' }> {
    const [user] = await transaction
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new IdentityMappingBrokenError();
    return user;
  }
}

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

function isScopeType(value: string): value is ScopeType {
  return ['assigned_clients', 'team', 'facility', 'organization', 'tenant'].includes(value);
}

export class DisabledUserError extends Error {
  readonly code = 'USER_DISABLED';

  constructor() {
    super('Local user is disabled');
    this.name = 'DisabledUserError';
  }
}

export class TenantAccessDeniedError extends Error {
  readonly code = 'TENANT_ACCESS_DENIED';

  constructor() {
    super('Tenant access is not allowed');
    this.name = 'TenantAccessDeniedError';
  }
}

export class IdentityMappingBrokenError extends Error {
  readonly code = 'IDENTITY_MAPPING_INVALID';

  constructor() {
    super('External identity mapping is invalid');
    this.name = 'IdentityMappingBrokenError';
  }
}

export class InvalidAuthorizationConfigurationError extends Error {
  readonly code = 'AUTHORIZATION_CONFIGURATION_INVALID';

  constructor() {
    super('A stored role contains an unknown permission or scope');
    this.name = 'InvalidAuthorizationConfigurationError';
  }
}
