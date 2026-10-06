import '@care/config/load-env';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { loadApiConfig, loadMigrationConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { identitySchema } from '@care/identity';
import { tenants } from '@care/organizations';
import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { employeesSchema } from '@care/employees';
import { organizationsSchema } from '@care/organizations';
import { platformSchema } from '@care/platform';

const { NODE_ENV, MIGRATION_DATABASE_URL } = loadMigrationConfig();
if (NODE_ENV === 'production')
  throw new Error('Development identity seed is disabled in production');
const { OIDC_ISSUER } = loadApiConfig();
const subject = process.env.DEV_SEED_OIDC_SUB?.trim();
if (!subject)
  throw new Error('Set DEV_SEED_OIDC_SUB to the Authentik OIDC sub for the local test user');

const schema = {
  ...identitySchema,
  ...organizationsSchema,
  ...employeesSchema,
  ...clientsSchema,
  ...auditSchema,
  ...platformSchema,
};
const database = createDatabase(MIGRATION_DATABASE_URL, schema);

try {
  const [tenant] = await database.db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, 'demo-care'))
    .limit(1);
  if (!tenant) throw new Error('Run `bun run seed` before seeding a local identity');

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

    const [membership] = await transaction
      .insert(identitySchema.tenantMemberships)
      .values({ id: uuidv7(), userId, tenantId: tenant.id, status: 'active' })
      .onConflictDoUpdate({
        target: [
          identitySchema.tenantMemberships.userId,
          identitySchema.tenantMemberships.tenantId,
        ],
        set: { status: 'active' },
      })
      .returning({ id: identitySchema.tenantMemberships.id });
    const [admin] = await transaction
      .select({ id: identitySchema.roles.id })
      .from(identitySchema.roles)
      .where(
        and(
          eq(identitySchema.roles.tenantId, tenant.id),
          eq(identitySchema.roles.name, 'Administrator'),
        ),
      )
      .limit(1);
    if (!admin || !membership)
      throw new Error('Administrator role is missing; run `bun run seed` first');

    await transaction
      .insert(identitySchema.membershipRoles)
      .values({ membershipId: membership.id, roleId: admin.id })
      .onConflictDoNothing();
    await transaction
      .insert(identitySchema.membershipScopes)
      .values({ membershipId: membership.id, scopeType: 'tenant', scopeId: tenant.id })
      .onConflictDoNothing();
  });

  process.stdout.write(
    `Granted local Administrator access for issuer ${OIDC_ISSUER} and configured subject.\n`,
  );
} finally {
  await database.close();
}
