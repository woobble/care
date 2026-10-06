// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading seed configuration
import '@care/config/load-env';
import { inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { loadMigrationConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { employeesSchema } from '@care/employees';
import { identitySchema } from '@care/identity';
import { organizationsSchema, facilities, organizationsTable, tenants } from '@care/organizations';
import { PERMISSIONS } from '@care/permissions';
import { platformSchema } from '@care/platform';

const { NODE_ENV, MIGRATION_DATABASE_URL } = loadMigrationConfig();
if (NODE_ENV !== 'development') {
  throw new Error('Development seed only runs with NODE_ENV=development; no data was changed');
}

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
  const seeded = await database.db.transaction(async (transaction) => {
    const [tenant] = await transaction
      .insert(tenants)
      .values({ id: uuidv7(), name: 'Demo Care', slug: 'demo-care', active: true })
      .onConflictDoUpdate({ target: tenants.slug, set: { name: 'Demo Care', active: true } })
      .returning({ id: tenants.id });
    const tenantId = tenant!.id;

    const [organization] = await transaction
      .insert(organizationsTable)
      .values({ id: uuidv7(), tenantId, name: 'Demo Pflegedienst' })
      .onConflictDoUpdate({
        target: [organizationsTable.tenantId, organizationsTable.name],
        set: { name: 'Demo Pflegedienst' },
      })
      .returning({ id: organizationsTable.id });
    const organizationId = organization!.id;

    const seededFacilities = await transaction
      .insert(facilities)
      .values(
        ['Main Office', 'Facility West'].map((name) => ({
          id: uuidv7(),
          tenantId,
          organizationId,
          name,
        })),
      )
      .onConflictDoUpdate({
        target: [facilities.tenantId, facilities.name],
        set: { organizationId },
      })
      .returning({ id: facilities.id, name: facilities.name });

    const definitions = {
      Administrator: [...PERMISSIONS],
      Office: [
        'client.read',
        'client.create',
        'client.update',
        'client.archive',
        'employee.read',
        'organization.read',
        'facility.read',
      ] as const,
      Caregiver: ['client.read', 'employee.read'] as const,
    };
    const roleDefinitions = Object.entries(definitions) as Array<
      [keyof typeof definitions, readonly string[]]
    >;
    const seededRoles = await transaction
      .insert(identitySchema.roles)
      .values(roleDefinitions.map(([name]) => ({ id: uuidv7(), tenantId, name })))
      .onConflictDoUpdate({
        target: [identitySchema.roles.tenantId, identitySchema.roles.name],
        set: { name: sql`excluded.name` },
      })
      .returning({ id: identitySchema.roles.id, name: identitySchema.roles.name });
    if (seededRoles.length) {
      await transaction.delete(identitySchema.rolePermissions).where(
        inArray(
          identitySchema.rolePermissions.roleId,
          seededRoles.map((role) => role.id),
        ),
      );
      await transaction.insert(identitySchema.rolePermissions).values(
        seededRoles.flatMap((role) =>
          definitions[role.name as keyof typeof definitions].map((permission) => ({
            roleId: role.id,
            permission,
          })),
        ),
      );
    }
    return { tenantId, organizationId, facilities: seededFacilities };
  });

  process.stdout.write(
    `Seeded Demo Care (${seeded.tenantId}), Demo Pflegedienst (${seeded.organizationId}), ${seeded.facilities.map((facility) => `${facility.name} (${facility.id})`).join(', ')}\n`,
  );
  process.stdout.write(
    'Seeded Administrator, Office, and Caregiver roles. No user membership was granted.\n',
  );
} finally {
  await database.close();
}
