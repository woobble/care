import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { startCareTestDatabase } from './index';

describe('PostgreSQL tenant boundaries', () => {
  test('care_app sees and writes rows only for its transaction tenant', async () => {
    const database = await startCareTestDatabase();
    const owner = new Client({ connectionString: database.migrationUrl });
    const app = new Client({ connectionString: database.appUrl });
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const clientA = randomUUID();
    const clientB = randomUUID();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const facilityA = randomUUID();
    const facilityB = randomUUID();
    const addressA = randomUUID();
    const addressB = randomUUID();
    const contactA = randomUUID();
    const contactB = randomUUID();
    const insuranceA = randomUUID();
    const insuranceB = randomUUID();
    const pflegegradA = randomUUID();
    const pflegegradB = randomUUID();
    const categoryA = randomUUID();
    const categoryB = randomUUID();
    const serviceA = randomUUID();
    const serviceB = randomUUID();

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
          randomUUID(),
          tenantA,
          serviceA,
          organizationA,
          facilityA,
          randomUUID(),
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
          [randomUUID(), tenantB, organizationB, facilityB],
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
          values: [randomUUID(), tenantB, clientB],
        },
        {
          query: `INSERT INTO clients.client_contacts
                  (id, tenant_id, client_id, first_name, last_name, relationship_type, created_at, updated_at)
                  VALUES ($1, $2, $3, 'Denied', 'Denied', 'relative', now(), now())`,
          values: [randomUUID(), tenantB, clientB],
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
          values: [randomUUID(), tenantB, clientB],
        },
        {
          query: `INSERT INTO clients.pflegegrad_records
                  (id, tenant_id, client_id, grade, valid_from, status, created_at, updated_at)
                  VALUES ($1, $2, $3, 1, '2030-01-01', 'pending', now(), now())`,
          values: [randomUUID(), tenantB, clientB],
        },
        {
          query: `INSERT INTO services.service_categories
                  (id, tenant_id, name, status, created_at, updated_at)
                  VALUES ($1, $2, 'Denied', 'active', now(), now())`,
          values: [randomUUID(), tenantB],
        },
        {
          query: `INSERT INTO services.service_definitions
                  (id, tenant_id, code, name, category_id, unit, status, valid_from, created_at, updated_at)
                  VALUES ($1, $2, 'DENIED', 'Denied', $3, 'occurrence', 'active', '2030-01-01', now(), now())`,
          values: [randomUUID(), tenantB, categoryB],
        },
        {
          query: `INSERT INTO services.service_availability
                  (id, tenant_id, service_id, organization_id, facility_id, active, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, true, now(), now())`,
          values: [randomUUID(), tenantB, serviceB, organizationB, facilityB],
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
          [randomUUID(), tenantA, clientA],
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
          [randomUUID(), tenantA, organizationA, facilityB],
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
          [randomUUID(), tenantA, categoryB],
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
          [randomUUID(), tenantA, clientA],
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
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const organizationA2 = randomUUID();
    const facilityA = randomUUID();
    const facilityB = randomUUID();
    const facilityA2 = randomUUID();
    const teamA = randomUUID();
    const teamB = randomUUID();
    const employeeA = randomUUID();
    const employeeB = randomUUID();
    const qualificationA = randomUUID();
    const qualificationB = randomUUID();
    const skillA = randomUUID();
    const skillB = randomUUID();

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
          randomUUID(),
          tenantA,
          organizationA,
          employeeA,
          facilityA,
          randomUUID(),
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
          randomUUID(),
          tenantA,
          organizationA,
          employeeA,
          teamA,
          randomUUID(),
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
          randomUUID(),
          tenantA,
          employeeA,
          qualificationA,
          randomUUID(),
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
        [randomUUID(), tenantA, employeeA, skillA, randomUUID(), tenantB, employeeB, skillB],
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
          values: [randomUUID(), tenantB, organizationB, facilityB],
        },
        {
          query: `INSERT INTO employees.employees (id, tenant_id, organization_id, first_name, last_name)
                  VALUES ($1, $2, $3, 'RLS', 'Denied')`,
          values: [randomUUID(), tenantB, organizationB],
        },
        {
          query: `INSERT INTO employees.employee_facility_assignments
                  (id, tenant_id, organization_id, employee_id, facility_id, status)
                  VALUES ($1, $2, $3, $4, $5, 'inactive')`,
          values: [randomUUID(), tenantB, organizationB, employeeB, facilityB],
        },
        {
          query: `INSERT INTO employees.employee_team_memberships
                  (id, tenant_id, organization_id, employee_id, team_id, status)
                  VALUES ($1, $2, $3, $4, $5, 'inactive')`,
          values: [randomUUID(), tenantB, organizationB, employeeB, teamB],
        },
        {
          query: `INSERT INTO employees.qualification_definitions (id, tenant_id, name)
                  VALUES ($1, $2, 'RLS denied')`,
          values: [randomUUID(), tenantB],
        },
        {
          query: `INSERT INTO employees.employee_qualifications (id, tenant_id, employee_id, qualification_id)
                  VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), tenantB, employeeB, qualificationB],
        },
        {
          query: `INSERT INTO employees.skill_definitions (id, tenant_id, name)
                  VALUES ($1, $2, 'RLS denied')`,
          values: [randomUUID(), tenantB],
        },
        {
          query: `INSERT INTO employees.employee_skills (id, tenant_id, employee_id, skill_id)
                  VALUES ($1, $2, $3, $4)`,
          values: [randomUUID(), tenantB, employeeB, skillB],
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
          [randomUUID(), tenantA, organizationA, employeeA, facilityA2],
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
          [randomUUID(), tenantA, organizationA, employeeA, teamB],
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
    const eventId = randomUUID();

    try {
      await owner.connect();
      await worker.connect();
      await owner.query(
        `INSERT INTO platform.outbox_messages
         (id, tenant_id, event_type, event_version, event, status)
         VALUES ($1, $2, 'client.created', 1, '{"type":"client.created"}', 'pending')`,
        [eventId, randomUUID()],
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
