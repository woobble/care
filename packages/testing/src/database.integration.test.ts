import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { startCareTestDatabase } from './index';

describe('PostgreSQL tenant boundaries', () => {
  test('care_app sees and writes rows only for its transaction tenant', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const app = new Client({ connectionString: database.appUrl });
    const tenantA = uuidv7();
    const tenantB = uuidv7();
    const clientA = uuidv7();
    const clientB = uuidv7();
    const organizationA = uuidv7();
    const organizationB = uuidv7();
    const facilityA = uuidv7();
    const facilityB = uuidv7();
    const addressA = uuidv7();
    const addressB = uuidv7();
    const contactA = uuidv7();
    const contactB = uuidv7();
    const insuranceA = uuidv7();
    const insuranceB = uuidv7();
    const pflegegradA = uuidv7();
    const pflegegradB = uuidv7();
    const categoryA = uuidv7();
    const categoryB = uuidv7();
    const serviceA = uuidv7();
    const serviceB = uuidv7();

    try {
      await owner.connect();
      await app.connect();
      await owner.query(
        'INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
        [tenantA, 'Tenant A', `tenant-${tenantA}`, tenantB, 'Tenant B', `tenant-${tenantB}`],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name)
         VALUES ($1, $2, 'Organization A'), ($3, $4, 'Organization B')`,
        [organizationA, tenantA, organizationB, tenantB],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $2, $3, 'Facility A'), ($4, $5, $6, 'Facility B')`,
        [facilityA, tenantA, organizationA, facilityB, tenantB, organizationB],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Ada', 'A', 'pending', now(), now()),
                ($5, $6, $7, $8, 'Grace', 'B', 'pending', now(), now())`,
        [clientA, tenantA, organizationA, facilityA, clientB, tenantB, organizationB, facilityB],
      );
      await owner.query(
        `INSERT INTO clients.client_addresses
           (id, tenant_id, client_id, address_type, street, city, country_code, is_primary, created_at, updated_at)
         VALUES ($1, $2, $3, 'home', 'Street A', 'City A', 'DE', true, now(), now()),
                ($4, $5, $6, 'home', 'Street B', 'City B', 'DE', true, now(), now())`,
        [addressA, tenantA, clientA, addressB, tenantB, clientB],
      );
      await owner.query(
        `INSERT INTO clients.client_contacts
           (id, tenant_id, client_id, first_name, last_name, relationship_type, created_at, updated_at)
         VALUES ($1, $2, $3, 'Contact', 'A', 'relative', now(), now()),
                ($4, $5, $6, 'Contact', 'B', 'relative', now(), now())`,
        [contactA, tenantA, clientA, contactB, tenantB, clientB],
      );
      await owner.query(
        `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
         VALUES ($1, $2, $3, 'emergency_contact'), ($4, $5, $6, 'emergency_contact')`,
        [tenantA, clientA, contactA, tenantB, clientB, contactB],
      );
      await owner.query(
        `INSERT INTO clients.client_insurances
           (id, tenant_id, client_id, insurance_type, insurer_name, is_primary, created_at, updated_at)
         VALUES ($1, $2, $3, 'other', 'Insurer A', true, now(), now()),
                ($4, $5, $6, 'other', 'Insurer B', true, now(), now())`,
        [insuranceA, tenantA, clientA, insuranceB, tenantB, clientB],
      );
      await owner.query(
        `INSERT INTO clients.pflegegrad_records
           (id, tenant_id, client_id, grade, valid_from, status, created_at, updated_at)
         VALUES ($1, $2, $3, 2, '2020-01-01', 'confirmed', now(), now()),
                ($4, $5, $6, 4, '2020-01-01', 'confirmed', now(), now())`,
        [pflegegradA, tenantA, clientA, pflegegradB, tenantB, clientB],
      );
      await owner.query(
        `INSERT INTO services.service_categories (id, tenant_id, name, status, created_at, updated_at)
         VALUES ($1, $2, 'Category A', 'active', now(), now()),
                ($3, $4, 'Category B', 'active', now(), now())`,
        [categoryA, tenantA, categoryB, tenantB],
      );
      await owner.query(
        `INSERT INTO services.service_definitions
           (id, tenant_id, code, name, category_id, unit, status, valid_from, created_at, updated_at)
         VALUES ($1, $2, 'SERVICE-A', 'Service A', $3, 'occurrence', 'active', '2020-01-01', now(), now()),
                ($4, $5, 'SERVICE-B', 'Service B', $6, 'occurrence', 'active', '2020-01-01', now(), now())`,
        [serviceA, tenantA, categoryA, serviceB, tenantB, categoryB],
      );
      await owner.query(
        `INSERT INTO services.service_availability
           (id, tenant_id, service_id, organization_id, facility_id, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), now()),
                ($6, $7, $8, $9, $10, true, now(), now())`,
        [
          uuidv7(),
          tenantA,
          serviceA,
          organizationA,
          facilityA,
          uuidv7(),
          tenantB,
          serviceB,
          organizationB,
          facilityB,
        ],
      );

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const visible = await app.query<{ id: string }>('SELECT id FROM clients.clients ORDER BY id');
      expect(visible.rows.map((row) => row.id)).toEqual([clientA]);
      for (const table of [
        'clients.client_addresses',
        'clients.client_contacts',
        'clients.client_contact_roles',
        'clients.client_insurances',
        'clients.pflegegrad_records',
        'services.service_categories',
        'services.service_definitions',
        'services.service_availability',
      ]) {
        // Table names are fixed above, not user input.
        // oxlint-disable-next-line no-await-in-loop
        const scopedRows = await app.query(`SELECT * FROM ${table}`);
        expect(scopedRows.rows).toHaveLength(1);
      }
      await app.query('COMMIT');

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      let insertError: unknown;
      try {
        await app.query(
          `INSERT INTO clients.clients
             (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'Grace', 'B', 'pending', now(), now())`,
          [uuidv7(), tenantB, organizationB, facilityB],
        );
      } catch (error) {
        insertError = error;
      }
      expect(insertError).toMatchObject({ code: '42501' });
      await app.query('ROLLBACK');

      const deniedTenantWrites: Array<{ query: string; values: unknown[] }> = [
        {
          query: `INSERT INTO clients.client_addresses
                  (id, tenant_id, client_id, address_type, street, city, country_code, is_primary, created_at, updated_at)
                  VALUES ($1, $2, $3, 'home', 'Denied', 'Denied', 'DE', false, now(), now())`,
          values: [uuidv7(), tenantB, clientB],
        },
        {
          query: `INSERT INTO clients.client_contacts
                  (id, tenant_id, client_id, first_name, last_name, relationship_type, created_at, updated_at)
                  VALUES ($1, $2, $3, 'Denied', 'Denied', 'relative', now(), now())`,
          values: [uuidv7(), tenantB, clientB],
        },
        {
          query: `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
                  VALUES ($1, $2, $3, 'authorized_contact')`,
          values: [tenantB, clientB, contactB],
        },
        {
          query: `INSERT INTO clients.client_insurances
                  (id, tenant_id, client_id, insurance_type, insurer_name, is_primary, created_at, updated_at)
                  VALUES ($1, $2, $3, 'other', 'Denied', false, now(), now())`,
          values: [uuidv7(), tenantB, clientB],
        },
        {
          query: `INSERT INTO clients.pflegegrad_records
                  (id, tenant_id, client_id, grade, valid_from, status, created_at, updated_at)
                  VALUES ($1, $2, $3, 1, '2030-01-01', 'pending', now(), now())`,
          values: [uuidv7(), tenantB, clientB],
        },
        {
          query: `INSERT INTO services.service_categories
                  (id, tenant_id, name, status, created_at, updated_at)
                  VALUES ($1, $2, 'Denied', 'active', now(), now())`,
          values: [uuidv7(), tenantB],
        },
        {
          query: `INSERT INTO services.service_definitions
                  (id, tenant_id, code, name, category_id, unit, status, valid_from, created_at, updated_at)
                  VALUES ($1, $2, 'DENIED', 'Denied', $3, 'occurrence', 'active', '2030-01-01', now(), now())`,
          values: [uuidv7(), tenantB, categoryB],
        },
        {
          query: `INSERT INTO services.service_availability
                  (id, tenant_id, service_id, organization_id, facility_id, active, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, true, now(), now())`,
          values: [uuidv7(), tenantB, serviceB, organizationB, facilityB],
        },
      ];
      // Each invalid insert needs its own transaction and rollback.
      // oxlint-disable no-await-in-loop
      for (const item of deniedTenantWrites) {
        await app.query('BEGIN');
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
        let code: string | undefined;
        try {
          await app.query(item.query, item.values);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        await app.query('ROLLBACK');
        expect(code).toBe('42501');
      }
      // oxlint-enable no-await-in-loop

      let duplicatePrimaryAddress: string | undefined;
      try {
        await owner.query(
          `INSERT INTO clients.client_addresses
             (id, tenant_id, client_id, address_type, street, city, country_code, is_primary, created_at, updated_at)
           VALUES ($1, $2, $3, 'home', 'Second', 'City A', 'DE', true, now(), now())`,
          [uuidv7(), tenantA, clientA],
        );
      } catch (error) {
        duplicatePrimaryAddress = (error as { code?: string }).code;
      }
      expect(duplicatePrimaryAddress).toBe('23505');

      let crossOrganizationClientContext: string | undefined;
      try {
        await owner.query(
          `INSERT INTO clients.clients
             (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'Invalid', 'Context', 'pending', now(), now())`,
          [uuidv7(), tenantA, organizationA, facilityB],
        );
      } catch (error) {
        crossOrganizationClientContext = (error as { code?: string }).code;
      }
      expect(crossOrganizationClientContext).toBe('23503');

      let crossTenantServiceCategory: string | undefined;
      try {
        await owner.query(
          `INSERT INTO services.service_definitions
             (id, tenant_id, code, name, category_id, unit, status, valid_from, created_at, updated_at)
           VALUES ($1, $2, 'INVALID', 'Invalid reference', $3, 'occurrence', 'active', '2020-01-01', now(), now())`,
          [uuidv7(), tenantA, categoryB],
        );
      } catch (error) {
        crossTenantServiceCategory = (error as { code?: string }).code;
      }
      expect(crossTenantServiceCategory).toBe('23503');

      let overlappingConfirmedPflegegrad: string | undefined;
      try {
        await owner.query(
          `INSERT INTO clients.pflegegrad_records
             (id, tenant_id, client_id, grade, valid_from, status, created_at, updated_at)
           VALUES ($1, $2, $3, 3, '2022-01-01', 'confirmed', now(), now())`,
          [uuidv7(), tenantA, clientA],
        );
      } catch (error) {
        overlappingConfirmedPflegegrad = (error as { code?: string }).code;
      }
      expect(overlappingConfirmedPflegegrad).toBe('23P01');
    } finally {
      await app.end();
      await owner.end();
      await database.container.stop();
    }
  }, 180_000);

  test('organization and employee tables enforce tenant RLS and composite assignment integrity', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const app = new Client({ connectionString: database.appUrl });
    const tenantA = uuidv7();
    const tenantB = uuidv7();
    const organizationA = uuidv7();
    const organizationB = uuidv7();
    const organizationA2 = uuidv7();
    const facilityA = uuidv7();
    const facilityB = uuidv7();
    const facilityA2 = uuidv7();
    const teamA = uuidv7();
    const teamB = uuidv7();
    const employeeA = uuidv7();
    const employeeB = uuidv7();
    const qualificationA = uuidv7();
    const qualificationB = uuidv7();
    const skillA = uuidv7();
    const skillB = uuidv7();

    try {
      await owner.connect();
      await app.connect();
      await owner.query(
        'INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
        [
          tenantA,
          'Tenant A',
          `org-employee-${tenantA}`,
          tenantB,
          'Tenant B',
          `org-employee-${tenantB}`,
        ],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name)
         VALUES ($1, $2, 'Organization A'), ($3, $4, 'Organization B'), ($5, $2, 'Organization A2')`,
        [organizationA, tenantA, organizationB, tenantB, organizationA2],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $2, $3, 'Facility A'), ($4, $5, $6, 'Facility B'), ($7, $2, $8, 'Facility A2')`,
        [
          facilityA,
          tenantA,
          organizationA,
          facilityB,
          tenantB,
          organizationB,
          facilityA2,
          organizationA2,
        ],
      );
      await owner.query(
        `INSERT INTO organizations.teams (id, tenant_id, organization_id, facility_id, name)
         VALUES ($1, $2, $3, $4, 'Team A'), ($5, $6, $7, $8, 'Team B')`,
        [teamA, tenantA, organizationA, facilityA, teamB, tenantB, organizationB, facilityB],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, organization_id, first_name, last_name)
         VALUES ($1, $2, $3, 'Employee', 'A'), ($4, $5, $6, 'Employee', 'B')`,
        [employeeA, tenantA, organizationA, employeeB, tenantB, organizationB],
      );
      await owner.query(
        `INSERT INTO employees.employee_facility_assignments
         (id, tenant_id, organization_id, employee_id, facility_id)
         VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
        [
          uuidv7(),
          tenantA,
          organizationA,
          employeeA,
          facilityA,
          uuidv7(),
          tenantB,
          organizationB,
          employeeB,
          facilityB,
        ],
      );
      await owner.query(
        `INSERT INTO employees.employee_team_memberships
         (id, tenant_id, organization_id, employee_id, team_id)
         VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
        [
          uuidv7(),
          tenantA,
          organizationA,
          employeeA,
          teamA,
          uuidv7(),
          tenantB,
          organizationB,
          employeeB,
          teamB,
        ],
      );
      await owner.query(
        `INSERT INTO employees.qualification_definitions (id, tenant_id, name)
         VALUES ($1, $2, 'Qualification A'), ($3, $4, 'Qualification B')`,
        [qualificationA, tenantA, qualificationB, tenantB],
      );
      await owner.query(
        `INSERT INTO employees.employee_qualifications (id, tenant_id, employee_id, qualification_id)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [
          uuidv7(),
          tenantA,
          employeeA,
          qualificationA,
          uuidv7(),
          tenantB,
          employeeB,
          qualificationB,
        ],
      );
      await owner.query(
        `INSERT INTO employees.skill_definitions (id, tenant_id, name)
         VALUES ($1, $2, 'Skill A'), ($3, $4, 'Skill B')`,
        [skillA, tenantA, skillB, tenantB],
      );
      await owner.query(
        `INSERT INTO employees.employee_skills (id, tenant_id, employee_id, skill_id)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [uuidv7(), tenantA, employeeA, skillA, uuidv7(), tenantB, employeeB, skillB],
      );

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      for (const { table, visibleRows } of [
        { table: 'organizations.organizations', visibleRows: 2 },
        { table: 'organizations.facilities', visibleRows: 2 },
        { table: 'organizations.teams', visibleRows: 1 },
        { table: 'employees.employees', visibleRows: 1 },
        { table: 'employees.employee_facility_assignments', visibleRows: 1 },
        { table: 'employees.employee_team_memberships', visibleRows: 1 },
        { table: 'employees.qualification_definitions', visibleRows: 1 },
        { table: 'employees.employee_qualifications', visibleRows: 1 },
        { table: 'employees.skill_definitions', visibleRows: 1 },
        { table: 'employees.employee_skills', visibleRows: 1 },
      ]) {
        // Table names are a fixed list above, not user input.
        // oxlint-disable-next-line no-await-in-loop
        const result = await app.query(`SELECT id FROM ${table}`);
        expect(result.rows).toHaveLength(visibleRows);
      }
      await app.query('COMMIT');

      const deniedWrites: Array<{ query: string; values: unknown[] }> = [
        {
          query: `INSERT INTO organizations.teams (id, tenant_id, organization_id, facility_id, name)
                  VALUES ($1, $2, $3, $4, 'RLS denied')`,
          values: [uuidv7(), tenantB, organizationB, facilityB],
        },
        {
          query: `INSERT INTO employees.employees (id, tenant_id, organization_id, first_name, last_name)
                  VALUES ($1, $2, $3, 'RLS', 'Denied')`,
          values: [uuidv7(), tenantB, organizationB],
        },
        {
          query: `INSERT INTO employees.employee_facility_assignments
                  (id, tenant_id, organization_id, employee_id, facility_id, status)
                  VALUES ($1, $2, $3, $4, $5, 'inactive')`,
          values: [uuidv7(), tenantB, organizationB, employeeB, facilityB],
        },
        {
          query: `INSERT INTO employees.employee_team_memberships
                  (id, tenant_id, organization_id, employee_id, team_id, status)
                  VALUES ($1, $2, $3, $4, $5, 'inactive')`,
          values: [uuidv7(), tenantB, organizationB, employeeB, teamB],
        },
        {
          query: `INSERT INTO employees.qualification_definitions (id, tenant_id, name)
                  VALUES ($1, $2, 'RLS denied')`,
          values: [uuidv7(), tenantB],
        },
        {
          query: `INSERT INTO employees.employee_qualifications (id, tenant_id, employee_id, qualification_id)
                  VALUES ($1, $2, $3, $4)`,
          values: [uuidv7(), tenantB, employeeB, qualificationB],
        },
        {
          query: `INSERT INTO employees.skill_definitions (id, tenant_id, name)
                  VALUES ($1, $2, 'RLS denied')`,
          values: [uuidv7(), tenantB],
        },
        {
          query: `INSERT INTO employees.employee_skills (id, tenant_id, employee_id, skill_id)
                  VALUES ($1, $2, $3, $4)`,
          values: [uuidv7(), tenantB, employeeB, skillB],
        },
      ];
      // Keep the transaction setup, denied statement, and rollback on one connection in order.
      // oxlint-disable no-await-in-loop
      for (const item of deniedWrites) {
        await app.query('BEGIN');
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
        let code: string | undefined;
        try {
          await app.query(item.query, item.values);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        await app.query('ROLLBACK');
        expect(code).toBe('42501');
      }
      // oxlint-enable no-await-in-loop

      let crossOrganizationFacilityConstraint = false;
      try {
        await owner.query(
          `INSERT INTO employees.employee_facility_assignments
           (id, tenant_id, organization_id, employee_id, facility_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), tenantA, organizationA, employeeA, facilityA2],
        );
      } catch (error) {
        crossOrganizationFacilityConstraint = (error as { code?: string }).code === '23503';
      }
      expect(crossOrganizationFacilityConstraint).toBe(true);
      let crossOrganizationTeamConstraint = false;
      try {
        await owner.query(
          `INSERT INTO employees.employee_team_memberships
           (id, tenant_id, organization_id, employee_id, team_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), tenantA, organizationA, employeeA, teamB],
        );
      } catch (error) {
        crossOrganizationTeamConstraint = (error as { code?: string }).code === '23503';
      }
      expect(crossOrganizationTeamConstraint).toBe(true);
    } finally {
      await app.end();
      await owner.end();
      await database.container.stop();
    }
  }, 180_000);

  test('care_worker can read outbox rows through its explicit RLS policy', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const worker = new Client({ connectionString: database.workerUrl });
    const eventId = uuidv7();

    try {
      await owner.connect();
      await worker.connect();
      await owner.query(
        `INSERT INTO platform.outbox_messages
         (id, tenant_id, event_type, event_version, event, status)
         VALUES ($1, $2, 'client.created', 1, '{"type":"client.created"}', 'pending')`,
        [eventId, uuidv7()],
      );
      const rows = await worker.query<{ id: string }>(
        'SELECT id FROM platform.outbox_messages WHERE id = $1',
        [eventId],
      );
      expect(rows.rows).toEqual([{ id: eventId }]);
    } finally {
      await worker.end();
      await owner.end();
      await database.container.stop();
    }
  }, 180_000);
});

test('UUIDv7 migration rewrites legacy IDs and structured references while preserving external IDs', async () => {
  const database = await startCareTestDatabase();
  const owner = new Client({ connectionString: database.migrationUrl });
  const tenantId = '123e4567-e89b-42d3-a456-426614174000';
  const organizationId = '123e4567-e89b-42d3-a456-426614174001';
  const userId = '123e4567-e89b-42d3-a456-426614174002';
  const membershipId = '123e4567-e89b-42d3-a456-426614174003';
  const auditId = '123e4567-e89b-42d3-a456-426614174004';
  const outboxId = '123e4567-e89b-42d3-a456-426614174005';
  const authUserId = 'legacy-auth-user-id';
  const externalProviderId = '123e4567-e89b-42d3-a456-426614174099';
  const historyOnlyId = '123e4567-e89b-42d3-a456-426614174006';
  const correlationId = '123e4567-e89b-42d3-a456-426614174007';
  const stableTenantId = uuidv7();
  const stableAuthUserId = uuidv7();

  try {
    await owner.connect();
    await owner.query(
      'INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
      [
        tenantId,
        'Legacy Tenant',
        'legacy-uuidv7-migration',
        stableTenantId,
        'Stable Tenant',
        'stable-uuidv7-migration',
      ],
    );
    await owner.query(
      'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
      [organizationId, tenantId, 'Legacy Organization'],
    );
    await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [userId]);
    await owner.query(
      `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [membershipId, userId, tenantId],
    );
    await owner.query(
      `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
       VALUES ($1, $2, 'organization', $3)`,
      [membershipId, tenantId, organizationId],
    );
    await owner.query(
      `INSERT INTO identity.external_identities (id, user_id, issuer, subject)
       VALUES ($1, $2, $3, $4)`,
      [uuidv7(), userId, 'https://provider.example', externalProviderId],
    );

    await owner.query('INSERT INTO authentication.users (id, name, email) VALUES ($1, $2, $3)', [
      authUserId,
      'Legacy Auth User',
      'legacy-auth-user@example.test',
    ]);
    await owner.query('INSERT INTO authentication.users (id, name, email) VALUES ($1, $2, $3)', [
      stableAuthUserId,
      'Stable Auth User',
      'stable-auth-user@example.test',
    ]);
    await owner.query(
      `INSERT INTO authentication.sessions (id, expires_at, token, user_id)
       VALUES ($1, now() + interval '1 hour', $2, $3)`,
      ['legacy-auth-session-id', 'session-token-preserved', authUserId],
    );
    await owner.query(
      `INSERT INTO authentication.accounts (id, account_id, provider_id, user_id)
       VALUES ($1, $2, $3, $4)`,
      ['legacy-auth-account-id', externalProviderId, 'authentik', authUserId],
    );
    await owner.query(
      `INSERT INTO authentication.verifications (id, identifier, value, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      ['legacy-verification-id', 'legacy-auth-user@example.test', 'verification-value-preserved'],
    );

    await owner.query(
      `INSERT INTO audit.audit_entries
         (id, tenant_id, actor_id, action, resource_type, resource_id, timestamp,
          request_id, correlation_id, metadata)
       VALUES ($1, $2, $3, 'organization.created', 'organization', $4, now(),
               'request-id-preserved', 'correlation-id-preserved', $5)`,
      [
        auditId,
        tenantId,
        userId,
        organizationId,
        {
          organizationId,
          relatedRecordId: historyOnlyId,
          externalProviderId,
          freeText: `Historical reference ${organizationId}`,
        },
      ],
    );
    await owner.query(
      `INSERT INTO platform.outbox_messages
         (id, tenant_id, event_type, event_version, event, status)
       VALUES ($1, $2, 'organization.created', 1, $3, 'pending')`,
      [
        outboxId,
        tenantId,
        {
          id: outboxId,
          tenantId,
          aggregateType: 'organization',
          aggregateId: organizationId,
          actor: { type: 'user', id: userId },
          correlationId,
          payload: {
            organizationId,
            relatedRecordId: historyOnlyId,
            externalProviderId,
            note: `Historical reference ${organizationId}`,
          },
        },
      ],
    );

    const migration = await readFile(
      resolve(import.meta.dirname, '../../../modules/platform/migrations/0002_uuidv7_rekey.sql'),
      'utf8',
    );
    await owner.query('BEGIN');
    try {
      await owner.query(migration);
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }

    const rekeyedTenant = await owner.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'legacy-uuidv7-migration'",
    );
    const newTenantId = rekeyedTenant.rows[0]?.id;
    expect(newTenantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(newTenantId).not.toBe(tenantId);
    expect(
      (
        await owner.query<{ id: string }>(
          "SELECT id FROM organizations.tenants WHERE slug = 'stable-uuidv7-migration'",
        )
      ).rows[0]?.id,
    ).toBe(stableTenantId);

    const rekeyedOrganization = await owner.query<{ id: string; tenant_id: string }>(
      "SELECT id, tenant_id FROM organizations.organizations WHERE name = 'Legacy Organization'",
    );
    const newOrganizationId = rekeyedOrganization.rows[0]?.id;
    expect(newOrganizationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(rekeyedOrganization.rows[0]?.tenant_id).toBe(newTenantId);

    const membership = await owner.query<{ id: string; user_id: string; tenant_id: string }>(
      'SELECT id, user_id, tenant_id FROM identity.tenant_memberships',
    );
    const newMembershipId = membership.rows[0]?.id;
    expect(newMembershipId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(membership.rows[0]?.user_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(membership.rows[0]?.tenant_id).toBe(newTenantId);
    const scope = await owner.query<{ scope_id: string }>(
      'SELECT scope_id FROM identity.membership_scopes',
    );
    expect(scope.rows[0]?.scope_id).toBe(newOrganizationId);
    await expect(
      owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'organization', $3)`,
        [newMembershipId, newTenantId, stableTenantId],
      ),
    ).rejects.toThrow('organization scope must reference an organization in the same tenant');

    const identityForeignKeys = await owner.query<{ any_deferrable: boolean }>(
      `SELECT bool_or(condeferrable) AS any_deferrable
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'identity'::regnamespace`,
    );
    expect(identityForeignKeys.rows[0]?.any_deferrable).toBe(false);
    const auditRls = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE oid = 'audit.audit_entries'::regclass`,
    );
    expect(auditRls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const audit = await owner.query<{
      tenant_id: string;
      actor_id: string;
      resource_id: string;
      metadata: {
        organizationId: string;
        relatedRecordId: string;
        externalProviderId: string;
        freeText: string;
      };
    }>('SELECT tenant_id, actor_id, resource_id, metadata FROM audit.audit_entries');
    expect(audit.rows[0]).toMatchObject({
      tenant_id: newTenantId,
      actor_id: membership.rows[0]?.user_id,
      resource_id: newOrganizationId,
      metadata: {
        organizationId: newOrganizationId,
        relatedRecordId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        externalProviderId,
        freeText: `Historical reference ${organizationId}`,
      },
    });

    const outbox = await owner.query<{
      id: string;
      tenant_id: string;
      event: Record<string, unknown>;
    }>('SELECT id, tenant_id, event FROM platform.outbox_messages');
    expect(outbox.rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(outbox.rows[0]?.tenant_id).toBe(newTenantId);
    expect(outbox.rows[0]?.event).toMatchObject({
      id: outbox.rows[0]?.id,
      tenantId: newTenantId,
      aggregateId: newOrganizationId,
      actor: { id: membership.rows[0]?.user_id },
      correlationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      payload: {
        organizationId: newOrganizationId,
        relatedRecordId: audit.rows[0]?.metadata.relatedRecordId,
        externalProviderId,
        note: `Historical reference ${organizationId}`,
      },
    });

    const authRecords = await owner.query<{
      user_id: string;
      session_id: string;
      account_id: string;
      verification_id: string;
      external_account_id: string;
      session_token: string;
    }>(
      `SELECT auth_user.id AS user_id, session.id AS session_id, account.id AS account_id,
              verification.id AS verification_id, account.account_id AS external_account_id,
              session.token AS session_token
       FROM authentication.users AS auth_user
       JOIN authentication.sessions AS session ON session.user_id = auth_user.id
       JOIN authentication.accounts AS account ON account.user_id = auth_user.id
       CROSS JOIN authentication.verifications AS verification`,
    );
    expect(authRecords.rows[0]?.user_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(authRecords.rows[0]?.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(authRecords.rows[0]?.account_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(authRecords.rows[0]?.verification_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(authRecords.rows[0]?.external_account_id).toBe(externalProviderId);
    expect(authRecords.rows[0]?.session_token).toBe('session-token-preserved');
    const stableAuthUser = await owner.query<{ id: string }>(
      "SELECT id FROM authentication.users WHERE email = 'stable-auth-user@example.test'",
    );
    expect(stableAuthUser.rows[0]?.id).toBe(stableAuthUserId);
    const externalIdentity = await owner.query<{ subject: string }>(
      'SELECT subject FROM identity.external_identities',
    );
    expect(externalIdentity.rows[0]?.subject).toBe(externalProviderId);
  } finally {
    await owner.end();
    await database.container.stop();
  }
}, 180_000);

test('service evidence tables enforce forced RLS and append-only package history', async () => {
  const database = await startCareTestDatabase();
  const owner = new Client({ connectionString: database.migrationUrl });
  const app = new Client({ connectionString: database.appUrl });
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const organizationId = uuidv7();
  const facilityId = uuidv7();
  const clientId = uuidv7();
  const employeeId = uuidv7();
  const visitId = uuidv7();
  const executionId = uuidv7();
  const documentationId = uuidv7();
  const packageId = uuidv7();
  const acknowledgementId = uuidv7();
  const userId = uuidv7();
  const snapshotHash = 'a'.repeat(64);
  const now = new Date();

  try {
    await owner.connect();
    await app.connect();
    await owner.query(
      'INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
      [
        tenantId,
        'Evidence tenant',
        `evidence-${tenantId}`,
        otherTenantId,
        'Other tenant',
        `other-${otherTenantId}`,
      ],
    );
    await owner.query(
      'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
      [organizationId, tenantId, 'Evidence organization'],
    );
    await owner.query(
      `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $2, $3, 'Evidence facility')`,
      [facilityId, tenantId, organizationId],
    );
    await owner.query(
      `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Ada', 'Evidence', 'active', $5, $5)`,
      [clientId, tenantId, organizationId, facilityId, now],
    );
    await owner.query(
      `INSERT INTO employees.employees (id, tenant_id, organization_id, first_name, last_name)
         VALUES ($1, $2, $3, 'Care', 'Worker')`,
      [employeeId, tenantId, organizationId],
    );
    await owner.query(
      `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status,
            planned_start, planned_end, timezone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'planned', $6, $7, 'Europe/Berlin', $8, $8)`,
      [
        visitId,
        tenantId,
        clientId,
        organizationId,
        facilityId,
        now,
        new Date(now.getTime() + 3600000),
        now,
      ],
    );
    await owner.query(
      `INSERT INTO visit_execution.executions
           (id, tenant_id, visit_id, status, actual_start, actual_end,
            started_by_employee_id, completed_by_employee_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'completed', $4, $5, $6, $6, $4, $5)`,
      [executionId, tenantId, visitId, now, new Date(now.getTime() + 1800000), employeeId],
    );
    await owner.query(
      `INSERT INTO care_documentation.documents
           (id, tenant_id, visit_id, execution_id, status, created_by_employee_id,
            finalized_by_employee_id, finalized_at, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'finalized', $5, $5, $6, 1, $6, $6)`,
      [documentationId, tenantId, visitId, executionId, employeeId, now],
    );
    await owner.query(
      `INSERT INTO service_evidence.evidence_packages
           (id, tenant_id, documentation_id, version, documentation_version, execution_version,
            amendment_count, snapshot, snapshot_hash, generated_at, created_by_user_id)
         VALUES ($1, $2, $3, 1, 1, 1, 0, $4::jsonb, $5, $6, $7)`,
      [
        packageId,
        tenantId,
        documentationId,
        JSON.stringify({ snapshotVersion: 1, items: [] }),
        snapshotHash,
        now,
        userId,
      ],
    );

    const rls = await owner.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'service_evidence'
           AND relation.relname IN ('evidence_packages', 'acknowledgements')
         ORDER BY relation.relname`,
    );
    expect(rls.rows).toHaveLength(2);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const visiblePackages = await app.query<{ id: string }>(
      'SELECT id FROM service_evidence.evidence_packages',
    );
    expect(visiblePackages.rows.map((row) => row.id)).toEqual([packageId]);
    const visibleOtherTenant = await app.query<{ id: string }>(
      'SELECT id FROM service_evidence.acknowledgements',
    );
    expect(visibleOtherTenant.rows).toHaveLength(0);
    await app.query('COMMIT');

    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
    const hiddenPackages = await app.query<{ id: string }>(
      'SELECT id FROM service_evidence.evidence_packages',
    );
    expect(hiddenPackages.rows).toHaveLength(0);
    let crossTenantWriteCode: string | undefined;
    try {
      await app.query(
        `INSERT INTO service_evidence.evidence_packages
             (id, tenant_id, documentation_id, version, documentation_version, execution_version,
              amendment_count, snapshot, snapshot_hash, generated_at, created_by_user_id)
           VALUES ($1, $2, $3, 1, 1, 1, 0, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          tenantId,
          documentationId,
          JSON.stringify({ snapshotVersion: 1, items: [] }),
          snapshotHash,
          now,
          userId,
        ],
      );
    } catch (error) {
      crossTenantWriteCode = (error as { code?: string }).code;
    }
    await app.query('ROLLBACK');
    expect(crossTenantWriteCode).toBe('42501');

    let packageMutationCode: string | undefined;
    try {
      await owner.query(
        'UPDATE service_evidence.evidence_packages SET snapshot_hash = $1 WHERE id = $2',
        ['b'.repeat(64), packageId],
      );
    } catch (error) {
      packageMutationCode = (error as { code?: string }).code;
    }
    expect(packageMutationCode).toBe('23514');
    let packageDeleteCode: string | undefined;
    try {
      await owner.query('DELETE FROM service_evidence.evidence_packages WHERE id = $1', [
        packageId,
      ]);
    } catch (error) {
      packageDeleteCode = (error as { code?: string }).code;
    }
    expect(packageDeleteCode).toBe('23514');

    await owner.query(
      `INSERT INTO service_evidence.acknowledgements
           (id, tenant_id, evidence_package_id, evidence_package_hash, client_id, signatory_type,
            signatory_name_snapshot, signatory_capacity, status, method, statement_version,
            statement_text_snapshot, captured_by_employee_id, idempotency_key,
            acknowledged_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'client', 'Ada Evidence', 'client', 'acknowledged',
                 'typed_confirmation', 'de-v1', 'Test statement', $6, $7, $8, $8)`,
      [acknowledgementId, tenantId, packageId, snapshotHash, clientId, employeeId, uuidv7(), now],
    );
    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const visibleAcknowledgements = await app.query<{ id: string }>(
      'SELECT id FROM service_evidence.acknowledgements',
    );
    expect(visibleAcknowledgements.rows.map((row) => row.id)).toEqual([acknowledgementId]);
    await app.query('COMMIT');

    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
    const hiddenAcknowledgements = await app.query<{ id: string }>(
      'SELECT id FROM service_evidence.acknowledgements',
    );
    expect(hiddenAcknowledgements.rows).toHaveLength(0);
    let crossTenantAcknowledgementWriteCode: string | undefined;
    try {
      await app.query(
        `INSERT INTO service_evidence.acknowledgements
             (id, tenant_id, evidence_package_id, evidence_package_hash, client_id, signatory_type,
              signatory_name_snapshot, signatory_capacity, status, method, statement_version,
              statement_text_snapshot, captured_by_employee_id, idempotency_key,
              acknowledged_at, created_at)
           VALUES ($1, $2, $3, $4, $5, 'client', 'Ada Evidence', 'client', 'acknowledged',
                   'typed_confirmation', 'de-v1', 'Test statement', $6, $7, $8, $8)`,
        [uuidv7(), tenantId, packageId, snapshotHash, clientId, employeeId, uuidv7(), now],
      );
    } catch (error) {
      crossTenantAcknowledgementWriteCode = (error as { code?: string }).code;
    }
    await app.query('ROLLBACK');
    expect(crossTenantAcknowledgementWriteCode).toBe('42501');

    let acknowledgementMutationCode: string | undefined;
    try {
      await owner.query(
        `UPDATE service_evidence.acknowledgements
           SET signatory_name_snapshot = 'Changed name' WHERE id = $1`,
        [acknowledgementId],
      );
    } catch (error) {
      acknowledgementMutationCode = (error as { code?: string }).code;
    }
    expect(acknowledgementMutationCode).toBe('23514');
    await owner.query(
      `UPDATE service_evidence.acknowledgements
         SET revoked_at = $1, revoked_by_user_id = $2, revocation_reason = 'Test revocation'
         WHERE id = $3`,
      [now, userId, acknowledgementId],
    );
    const revoked = await owner.query<{ revoked_at: Date; revocation_reason: string }>(
      'SELECT revoked_at, revocation_reason FROM service_evidence.acknowledgements WHERE id = $1',
      [acknowledgementId],
    );
    expect(revoked.rows[0]).toMatchObject({
      revoked_at: expect.any(Date),
      revocation_reason: 'Test revocation',
    });
  } finally {
    await app.end();
    await owner.end();
    await database.container.stop();
  }
}, 180_000);
