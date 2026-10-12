import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { loadApiConfig, loadMigrationConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { auditSchema, DrizzleAuditWriter } from '@care/audit';
import { identitySchema, seedSystemRoles } from '@care/identity';
import { organizationsSchema, tenants } from '@care/organizations';

export async function bootstrapInitialAdmin(args: string[]): Promise<void> {
  const allowedOptions = new Set([
    '--tenant-name',
    '--tenant-slug',
    '--subject',
    '--confirm-initial-admin',
  ]);
  const seenOptions = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (
      !name ||
      !allowedOptions.has(name) ||
      seenOptions.has(name) ||
      !args[index + 1] ||
      args[index + 1]?.startsWith('--')
    ) {
      throw new Error(
        'Usage: bootstrap-admin --tenant-name <name> --tenant-slug <slug> --subject <Authentik-sub> --confirm-initial-admin <slug>',
      );
    }
    seenOptions.add(name);
  }
  if (args.length !== 8) {
    throw new Error(
      'Usage: bootstrap-admin --tenant-name <name> --tenant-slug <slug> --subject <Authentik-sub> --confirm-initial-admin <slug>',
    );
  }
  const tenantName = option(args, '--tenant-name');
  const tenantSlug = option(args, '--tenant-slug');
  const subject = option(args, '--subject');
  const confirmation = option(args, '--confirm-initial-admin');
  if (!tenantName || !tenantSlug || !subject || !confirmation) {
    throw new Error(
      'Usage: bootstrap-admin --tenant-name <name> --tenant-slug <slug> --subject <Authentik-sub> --confirm-initial-admin <slug>',
    );
  }
  if (
    tenantName.trim().length === 0 ||
    tenantName.trim().length > 120 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug) ||
    tenantSlug.length > 63 ||
    subject.trim().length === 0 ||
    subject.trim().length > 255 ||
    [...subject].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error('Tenant name, slug, or Authentik subject is invalid.');
  }
  if (confirmation !== tenantSlug) {
    throw new Error(
      `Initial administrator creation requires --confirm-initial-admin ${tenantSlug}.`,
    );
  }

  const migration = loadMigrationConfig();
  if (migration.NODE_ENV !== 'production') {
    throw new Error('Initial production administrator bootstrap requires NODE_ENV=production.');
  }
  const { OIDC_ISSUER } = loadApiConfig();
  const databaseUrl = new URL(migration.MIGRATION_DATABASE_URL);
  if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== 'care') {
    throw new Error('MIGRATION_DATABASE_URL must target the care database.');
  }

  const database = createDatabase(migration.MIGRATION_DATABASE_URL, {
    ...identitySchema,
    ...organizationsSchema,
    ...auditSchema,
  });
  const auditWriter = new DrizzleAuditWriter();
  try {
    const result = await database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext('care-platform-first-admin'), hashtext(${OIDC_ISSUER}))`,
      );
      const databaseRole = await transaction.execute<{ rolsuper: boolean }>(
        sql`select rolsuper from pg_roles where rolname = current_user`,
      );
      if (!databaseRole.rows[0]?.rolsuper) {
        throw new Error(
          'Initial administrator bootstrap requires a PostgreSQL superuser connection.',
        );
      }

      const [existingTenant] = await transaction.select({ id: tenants.id }).from(tenants).limit(1);
      const [existingMembership] = await transaction
        .select({ id: identitySchema.tenantMemberships.id })
        .from(identitySchema.tenantMemberships)
        .limit(1);
      const [existingRole] = await transaction
        .select({ id: identitySchema.roles.id })
        .from(identitySchema.roles)
        .limit(1);
      if (existingTenant || existingMembership || existingRole) {
        throw new Error('Initial administrator bootstrap only runs on a fresh migrated database.');
      }

      const [existingIdentity] = await transaction
        .select({
          userId: identitySchema.externalIdentities.userId,
          status: identitySchema.users.status,
        })
        .from(identitySchema.externalIdentities)
        .innerJoin(
          identitySchema.users,
          eq(identitySchema.users.id, identitySchema.externalIdentities.userId),
        )
        .where(
          and(
            eq(identitySchema.externalIdentities.issuer, OIDC_ISSUER),
            eq(identitySchema.externalIdentities.subject, subject.trim()),
          ),
        )
        .limit(1);
      if (existingIdentity && existingIdentity.status !== 'active') {
        throw new Error(
          'The Authentik identity is disabled and cannot receive initial administrator access.',
        );
      }

      const userId = existingIdentity?.userId ?? uuidv7();
      if (!existingIdentity) {
        await transaction.insert(identitySchema.users).values({ id: userId, status: 'active' });
        await transaction.insert(identitySchema.externalIdentities).values({
          id: uuidv7(),
          userId,
          issuer: OIDC_ISSUER,
          subject: subject.trim(),
        });
      }

      const tenantId = uuidv7();
      await transaction.insert(tenants).values({
        id: tenantId,
        name: tenantName.trim(),
        slug: tenantSlug,
        active: true,
      });
      const roles = await seedSystemRoles(transaction, tenantId);
      const administrator = roles.find((role) => role.name === 'Administrator');
      if (!administrator) throw new Error('The built-in Administrator role could not be created.');

      const membershipId = uuidv7();
      await transaction.insert(identitySchema.tenantMemberships).values({
        id: membershipId,
        userId,
        tenantId,
        status: 'active',
      });
      await transaction.insert(identitySchema.membershipRoles).values({
        membershipId,
        tenantId,
        roleId: administrator.id,
      });
      await transaction.insert(identitySchema.membershipScopes).values({
        membershipId,
        tenantId,
        scopeType: 'tenant',
        scopeId: tenantId,
      });

      const auditId = uuidv7();
      await auditWriter.append(transaction, {
        id: auditId,
        tenantId,
        actorId: userId,
        action: 'tenant.initial_admin_bootstrapped',
        resourceType: 'tenant_membership',
        resourceId: membershipId,
        timestamp: new Date(),
        requestId: auditId,
        correlationId: auditId,
        metadata: { method: 'operator_bootstrap', role: 'Administrator' },
      });
      return { tenantId };
    });

    process.stdout.write(
      `Initial administrator access created for the configured Authentik subject; tenant ${tenantSlug} (${result.tenantId}).\n`,
    );
  } finally {
    await database.close();
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length || args[index + 1]?.startsWith('--'))
    return undefined;
  return args[index + 1];
}
