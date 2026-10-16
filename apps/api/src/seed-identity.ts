// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading seed configuration
import '@care/config/load-env';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { loadApiConfig, loadMigrationConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { employeesSchema } from '@care/employees';
import { identitySchema } from '@care/identity';
import { tenants } from '@care/organizations';
import { organizationsSchema } from '@care/organizations';
import { platformSchema } from '@care/platform';
import { servicesSchema } from '@care/services';

const { NODE_ENV, MIGRATION_DATABASE_URL } = loadMigrationConfig();
if (NODE_ENV !== 'development') {
  throw new Error(
    'Development identity seed only runs with NODE_ENV=development; no data was changed',
  );
}
const { OIDC_ISSUER } = loadApiConfig();
const subject = process.env.DEV_SEED_OIDC_SUB?.trim();
const tenantSlug = process.env.DEV_SEED_TENANT_SLUG?.trim() || 'demo-care';
const roleName = process.env.DEV_SEED_ROLE?.trim() || 'Administrator';
if (!['demo-care', 'muster-betreuungsdienst-nrw'].includes(tenantSlug)) {
  throw new Error(
    'DEV_SEED_TENANT_SLUG must be demo-care or muster-betreuungsdienst-nrw; no data was changed',
  );
}
if (!['Administrator', 'Office'].includes(roleName)) {
  throw new Error('DEV_SEED_ROLE must be Administrator or Office; no data was changed');
}
if (!subject)
  throw new Error('Set DEV_SEED_OIDC_SUB to the Authentik OIDC sub for the local test user');

const schema = {
  ...identitySchema,
  ...organizationsSchema,
  ...employeesSchema,
  ...clientsSchema,
  ...servicesSchema,
  ...auditSchema,
  ...platformSchema,
};
const database = createDatabase(MIGRATION_DATABASE_URL, schema);

try {
  const [tenant] = await database.db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1);
  if (!tenant) {
    throw new Error(
      `Run the development seed for tenant ${tenantSlug} before seeding a local identity`,
    );
  }

  await database.db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${OIDC_ISSUER}), hashtext(${subject}))`,
    );
    const [existingIdentity] = await transaction
      .select({ userId: identitySchema.externalIdentities.userId })
      .from(identitySchema.externalIdentities)
      .where(
        and(
          eq(identitySchema.externalIdentities.issuer, OIDC_ISSUER),
          eq(identitySchema.externalIdentities.subject, subject),
        ),
      )
      .limit(1);

    let userId = existingIdentity?.userId;
    if (!userId) {
      userId = uuidv7();
      await transaction.insert(identitySchema.users).values({ id: userId, status: 'active' });
      await transaction.insert(identitySchema.externalIdentities).values({
        id: uuidv7(),
        userId,
        issuer: OIDC_ISSUER,
        subject,
      });
    }

    await transaction
      .insert(identitySchema.tenantMemberships)
      .values({ id: uuidv7(), userId, tenantId: tenant.id, status: 'active' })
      .onConflictDoNothing({
        target: [
          identitySchema.tenantMemberships.userId,
          identitySchema.tenantMemberships.tenantId,
        ],
      });
    const [membership] = await transaction
      .select({
        id: identitySchema.tenantMemberships.id,
        status: identitySchema.tenantMemberships.status,
      })
      .from(identitySchema.tenantMemberships)
      .where(
        and(
          eq(identitySchema.tenantMemberships.userId, userId),
          eq(identitySchema.tenantMemberships.tenantId, tenant.id),
        ),
      )
      .limit(1);
    if (!membership || membership.status === 'revoked') {
      throw new Error('This membership was revoked and cannot be restored by seeding');
    }
    const [role] = await transaction
      .select({ id: identitySchema.roles.id })
      .from(identitySchema.roles)
      .where(
        and(eq(identitySchema.roles.tenantId, tenant.id), eq(identitySchema.roles.name, roleName)),
      )
      .limit(1);
    if (!role || !membership) {
      throw new Error(`Role ${roleName} is missing; run the development seed first`);
    }

    await transaction
      .insert(identitySchema.membershipRoles)
      .values({ membershipId: membership.id, tenantId: tenant.id, roleId: role.id })
      .onConflictDoNothing();
    await transaction
      .insert(identitySchema.membershipScopes)
      .values({
        membershipId: membership.id,
        tenantId: tenant.id,
        scopeType: 'tenant',
        scopeId: tenant.id,
      })
      .onConflictDoNothing();
  });

  process.stdout.write(
    `Granted local ${roleName} access to ${tenantSlug} for issuer ${OIDC_ISSUER} and configured subject.\n`,
  );
} finally {
  await database.close();
}
