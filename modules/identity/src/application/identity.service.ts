import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v7 as uuidv7 } from 'uuid';
import type { VerifiedIdentity } from '@care/auth';
import type { AuthorizationPrincipal } from '@care/permissions';
import { externalIdentities, tenantMemberships, users } from '@module/identity/schema';
import { tenants } from '@care/organizations';
import { loadTenantAuthorizationPrincipal } from './authorization-principal';

export interface TenantSummary {
  id: string;
  name: string;
}

export interface LocalUser {
  id: string;
  status: 'active' | 'disabled';
  displayName: string | null;
  email: string | null;
}

export class IdentityService {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async resolveOrProvision(identity: VerifiedIdentity): Promise<LocalUser> {
    const profile = verifiedProfile(identity);
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

      if (external) {
        if (profile.email !== undefined || profile.displayName !== undefined) {
          await transaction.update(users).set(profile).where(eq(users.id, external.userId));
        }
        return this.getUser(transaction, external.userId);
      }

      const userId = uuidv7();
      await transaction.insert(users).values({ id: userId, status: 'active', ...profile });
      await transaction.insert(externalIdentities).values({
        id: uuidv7(),
        userId,
        issuer: identity.issuer,
        subject: identity.subject,
      });
      return this.getUser(transaction, userId);
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
    const user = await this.requireActiveUser(userId);
    return { id: user.id, status: user.status };
  }

  async loadTenantPrincipal(userId: string, tenantId: string): Promise<AuthorizationPrincipal> {
    await this.requireActiveUser(userId);
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return loadTenantAuthorizationPrincipal(transaction, userId, tenantId);
    });
  }

  private async requireActiveUser(userId: string): Promise<LocalUser> {
    const [user] = await this.db
      .select({
        id: users.id,
        status: users.status,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.status !== 'active') throw new DisabledUserError();
    return user;
  }

  private async getUser(
    transaction: Parameters<
      Parameters<NodePgDatabase<Record<string, unknown>>['transaction']>[0]
    >[0],
    userId: string,
  ): Promise<LocalUser> {
    const [user] = await transaction
      .select({
        id: users.id,
        status: users.status,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new IdentityMappingBrokenError();
    return user;
  }
}

function verifiedProfile(identity: VerifiedIdentity): {
  email?: string;
  displayName?: string;
} {
  const profile: { email?: string; displayName?: string } = {};
  const email = identity.claims.email;
  if (
    identity.claims.email_verified === true &&
    typeof email === 'string' &&
    email.length <= 254 &&
    !/\s/.test(email) &&
    email.includes('@')
  ) {
    profile.email = email.trim().toLowerCase();
  }
  const displayName = identity.claims.name;
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    profile.displayName = displayName.trim().slice(0, 200);
  }
  return profile;
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
