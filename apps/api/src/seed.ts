// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading seed configuration
import '@care/config/load-env';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { loadMigrationConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { employeesSchema, qualificationDefinitions } from '@care/employees';
import { identitySchema } from '@care/identity';
import {
  organizationsSchema,
  facilities,
  organizationsTable,
  teams,
  tenants,
} from '@care/organizations';
import { PERMISSIONS } from '@care/permissions';
import { platformSchema } from '@care/platform';
import {
  serviceAvailability,
  serviceCategories,
  serviceDefinitions,
  servicesSchema,
} from '@care/services';

const { NODE_ENV, MIGRATION_DATABASE_URL } = loadMigrationConfig();
if (NODE_ENV !== 'development') {
  throw new Error('Development seed only runs with NODE_ENV=development; no data was changed');
}

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
        set: { name: 'Demo Pflegedienst', status: 'active', updatedAt: new Date() },
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
        set: { organizationId, status: 'active', updatedAt: new Date() },
      })
      .returning({ id: facilities.id, name: facilities.name });

    const teamDefinitions = [
      { name: 'Team Nord', facilityName: 'Main Office' },
      { name: 'Team Süd', facilityName: 'Facility West' },
    ];
    const seededTeams: Array<{ id: string; name: string }> = [];
    // Resolve each scoped team against the existing partial unique indexes in this transaction.
    // oxlint-disable no-await-in-loop
    for (const definition of teamDefinitions) {
      const facility = seededFacilities.find((item) => item.name === definition.facilityName);
      if (!facility) continue;
      const [existing] = await transaction
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(
            eq(teams.tenantId, tenantId),
            eq(teams.organizationId, organizationId),
            eq(teams.facilityId, facility.id),
            eq(teams.name, definition.name),
          ),
        )
        .limit(1);
      if (existing) {
        await transaction
          .update(teams)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(teams.id, existing.id));
        seededTeams.push({ id: existing.id, name: definition.name });
      } else {
        const [created] = await transaction
          .insert(teams)
          .values({
            id: uuidv7(),
            tenantId,
            organizationId,
            facilityId: facility.id,
            name: definition.name,
            status: 'active',
          })
          .returning({ id: teams.id });
        if (created) seededTeams.push({ id: created.id, name: definition.name });
      }
    }
    // oxlint-enable no-await-in-loop
    const [qualification] = await transaction
      .insert(qualificationDefinitions)
      .values({
        id: uuidv7(),
        tenantId,
        name: 'Pflegefachkraft',
        code: 'PFK',
        description: null,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [qualificationDefinitions.tenantId, qualificationDefinitions.name],
        set: { status: 'active', updatedAt: new Date() },
      })
      .returning({ id: qualificationDefinitions.id });

    const categoryDefinitions = [
      { name: 'Grundpflege', code: 'BASIC_CARE', sortOrder: 10 },
      { name: 'Betreuung', code: 'COMPANIONSHIP', sortOrder: 20 },
      { name: 'Hauswirtschaft', code: 'HOUSEHOLD', sortOrder: 30 },
    ];
    const seededCategories: Array<{ id: string; code: string }> = [];
    // oxlint-disable no-await-in-loop
    for (const definition of categoryDefinitions) {
      const [existing] = await transaction
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(
          and(
            eq(serviceCategories.tenantId, tenantId),
            eq(serviceCategories.code, definition.code),
          ),
        )
        .limit(1);
      if (existing) {
        await transaction
          .update(serviceCategories)
          .set({
            name: definition.name,
            status: 'active',
            sortOrder: definition.sortOrder,
            updatedAt: new Date(),
          })
          .where(eq(serviceCategories.id, existing.id));
        seededCategories.push({ id: existing.id, code: definition.code });
      } else {
        const [created] = await transaction
          .insert(serviceCategories)
          .values({
            id: uuidv7(),
            tenantId,
            ...definition,
            description: null,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: serviceCategories.id });
        if (created) seededCategories.push({ id: created.id, code: definition.code });
      }
    }

    const serviceDefinitionsSeed = [
      { code: 'MORNING_CARE', name: 'Morning Care', categoryCode: 'BASIC_CARE', duration: 45 },
      {
        code: 'HOUSEHOLD_ASSISTANCE',
        name: 'Household Assistance',
        categoryCode: 'HOUSEHOLD',
        duration: 60,
      },
      {
        code: 'COMPANIONSHIP',
        name: 'Companionship',
        categoryCode: 'COMPANIONSHIP',
        duration: 30,
      },
    ];
    for (const definition of serviceDefinitionsSeed) {
      const category = seededCategories.find((item) => item.code === definition.categoryCode);
      if (!category) continue;
      const [existing] = await transaction
        .select({ id: serviceDefinitions.id })
        .from(serviceDefinitions)
        .where(
          and(
            eq(serviceDefinitions.tenantId, tenantId),
            eq(serviceDefinitions.code, definition.code),
          ),
        )
        .limit(1);
      let serviceId = existing?.id;
      if (serviceId) {
        await transaction
          .update(serviceDefinitions)
          .set({
            name: definition.name,
            categoryId: category.id,
            unit: 'occurrence',
            defaultDurationMinutes: definition.duration,
            status: 'active',
            validFrom: '2025-01-01',
            validUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(serviceDefinitions.id, serviceId));
      } else {
        const [created] = await transaction
          .insert(serviceDefinitions)
          .values({
            id: uuidv7(),
            tenantId,
            code: definition.code,
            name: definition.name,
            description: null,
            categoryId: category.id,
            unit: 'occurrence',
            defaultDurationMinutes: definition.duration,
            status: 'active',
            validFrom: '2025-01-01',
            validUntil: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: serviceDefinitions.id });
        serviceId = created?.id;
      }
      if (serviceId) {
        const [availability] = await transaction
          .select({ id: serviceAvailability.id })
          .from(serviceAvailability)
          .where(
            and(
              eq(serviceAvailability.tenantId, tenantId),
              eq(serviceAvailability.serviceId, serviceId),
              eq(serviceAvailability.organizationId, organizationId),
              eq(serviceAvailability.active, true),
            ),
          )
          .limit(1);
        if (!availability) {
          await transaction.insert(serviceAvailability).values({
            id: uuidv7(),
            tenantId,
            serviceId,
            organizationId,
            facilityId: null,
            active: true,
            validFrom: null,
            validUntil: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
    }
    // oxlint-enable no-await-in-loop

    const definitions = {
      Administrator: [...PERMISSIONS],
      Office: [
        'client.read',
        'client.create',
        'client.update',
        'client.archive',
        'employee.read',
        'employee.create',
        'employee.update',
        'employee.assign_facility',
        'employee.assign_team',
        'employee.link_user',
        'employee.manage_qualifications',
        'employee.manage_skills',
        'employee.manage_employment',
        'organization.read',
        'facility.read',
        'team.read',
        'service.read',
        'service.create',
        'service.update',
        'service.archive',
        'service.manage_categories',
        'service.manage_availability',
        'service_agreement.read',
        'service_agreement.create',
        'service_agreement.update',
        'service_agreement.activate',
        'service_agreement.suspend',
        'service_agreement.end',
        'service_agreement.manage_services',
      ] as const,
      Caregiver: [
        'client.read',
        'employee.read',
        'organization.read',
        'facility.read',
        'team.read',
        'service.read',
        'service_agreement.read',
      ] as const,
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
    return {
      tenantId,
      organizationId,
      facilities: seededFacilities,
      teams: seededTeams,
      qualificationId: qualification!.id,
      services: serviceDefinitionsSeed.map((service) => service.code),
    };
  });

  process.stdout.write(
    `Seeded Demo Care (${seeded.tenantId}), Demo Pflegedienst (${seeded.organizationId}), ${seeded.facilities.map((facility) => `${facility.name} (${facility.id})`).join(', ')}\n`,
  );
  process.stdout.write(
    `Seeded teams: ${seeded.teams.map((team) => `${team.name} (${team.id})`).join(', ')}; qualification ${seeded.qualificationId}.\n`,
  );
  process.stdout.write(
    'Seeded Administrator, Office, and Caregiver roles. No user membership was granted.\n',
  );
} finally {
  await database.close();
}
