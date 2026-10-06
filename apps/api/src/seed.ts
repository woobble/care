import '@care/config/load-env';
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
if (NODE_ENV === 'production') throw new Error('Development seed is disabled in production');

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
    .insert(tenants)
    .values({ id: uuidv7(), name: 'Demo Care', slug: 'demo-care', active: true })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: 'Demo Care', active: true } })
    .returning({ id: tenants.id });

  const [organization] = await database.db
    .insert(organizationsTable)
    .values({ id: uuidv7(), tenantId: tenant!.id, name: 'Demo Pflegedienst' })
    .onConflictDoUpdate({
      target: [organizationsTable.tenantId, organizationsTable.name],
      set: { name: 'Demo Pflegedienst' },
    })
    .returning({ id: organizationsTable.id });

  const [facility] = await database.db
    .insert(facilities)
    .values({
      id: uuidv7(),
      tenantId: tenant!.id,
      organizationId: organization!.id,
      name: 'Main Office',
    })
    .onConflictDoUpdate({
      target: [facilities.tenantId, facilities.name],
      set: { organizationId: organization!.id },
    })
    .returning({ id: facilities.id });

  const rolePermissions = identitySchema.rolePermissions;
  const roleTable = identitySchema.roles;
  const definitions = {
    Administrator: [...PERMISSIONS],
    Office: [
      'client.read',
      'client.create',
      'client.update',
      'client.archive',
      'employee.read',
      'employee.manage',
      'organization.read',
      'organization.manage',
      'audit.read',
    ] as const,
    Caregiver: ['client.read', 'employee.read'] as const,
  };

  for (const [name, permissions] of Object.entries(definitions)) {
    const [role] = await database.db
      .insert(roleTable)
      .values({ id: uuidv7(), tenantId: tenant!.id, name })
      .onConflictDoUpdate({
        target: [roleTable.tenantId, roleTable.name],
        set: { name },
      })
      .returning({ id: roleTable.id });
    for (const permission of permissions) {
      await database.db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permission })
        .onConflictDoNothing();
    }
  }

  process.stdout.write(
    `Seeded Demo Care (${tenant!.id}), Demo Pflegedienst (${organization!.id}), Main Office (${facility!.id})\n`,
  );
  process.stdout.write(
    'Seeded Administrator, Office, and Caregiver roles. No user membership was granted.\n',
  );
} finally {
  await database.close();
}
