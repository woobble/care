import { v7 as uuidv7 } from 'uuid';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { DrizzleAuditWriter } from '@care/audit';
import { createDatabase, createUnitOfWork } from '@care/database';
import type { AuthorizationPrincipal, PermissionGrant } from '@care/permissions';
import { DrizzleOutboxRepository } from '@care/platform';
import { startCareTestDatabase } from '@care/testing';
import {
  WorkforceComplianceApplicationService,
  WorkforceComplianceEmployeeNotFoundError,
  WorkforceComplianceRepository,
} from '@care/workforce-compliance';
import { databaseSchema } from '../src/database/schema';

describe('workforce compliance PostgreSQL visibility scopes', () => {
  test('filters organization, facility, and team scope before calculating summary counts', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const database = createDatabase(testDatabase.appUrl, databaseSchema);
    const service = new WorkforceComplianceApplicationService(
      createUnitOfWork(database.db),
      new DrizzleAuditWriter(),
      new DrizzleOutboxRepository(database.db),
      new WorkforceComplianceRepository(),
    );
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const otherTenantEmployeeId = uuidv7();
    const organizationOneId = uuidv7();
    const organizationTwoId = uuidv7();
    const facilityOneId = uuidv7();
    const facilityTwoId = uuidv7();
    const facilityOtherId = uuidv7();
    const teamOneId = uuidv7();
    const teamTwoId = uuidv7();
    const teamOtherId = uuidv7();
    const employeeOneId = uuidv7();
    const employeeTwoId = uuidv7();
    const employeeOtherId = uuidv7();
    const qualificationId = uuidv7();
    const otherTenantQualificationId = uuidv7();
    const assignmentOneId = uuidv7();
    const assignmentTwoId = uuidv7();
    const assignmentOtherId = uuidv7();
    const today = localDateInBerlin(new Date());
    const yesterday = addDays(today, -1);
    const fortyFiveDaysLater = addDays(today, 45);

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES ($1, 'Workforce scope integration', $2),
                ($3, 'Other workforce tenant', $4)`,
        [
          tenantId,
          `workforce-scope-${tenantId}`,
          otherTenantId,
          `other-workforce-scope-${otherTenantId}`,
        ],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name)
         VALUES ($1, $3, 'Scope organization one'), ($2, $3, 'Scope organization two')`,
        [organizationOneId, organizationTwoId, tenantId],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $4, $5, 'Scope facility one'),
                ($2, $4, $5, 'Scope facility two'),
                ($3, $4, $6, 'Other organization facility')`,
        [
          facilityOneId,
          facilityTwoId,
          facilityOtherId,
          tenantId,
          organizationOneId,
          organizationTwoId,
        ],
      );
      await owner.query(
        `INSERT INTO organizations.teams (id, tenant_id, organization_id, facility_id, name)
         VALUES ($1, $4, $5, $6, 'Scope team one'),
                ($2, $4, $5, $7, 'Scope team two'),
                ($3, $4, $8, $9, 'Other organization team')`,
        [
          teamOneId,
          teamTwoId,
          teamOtherId,
          tenantId,
          organizationOneId,
          facilityOneId,
          facilityTwoId,
          organizationTwoId,
          facilityOtherId,
        ],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, organization_id, first_name, last_name)
         VALUES ($1, $4, $5, 'Scope', 'One'),
                ($2, $4, $5, 'Scope', 'Two'),
                ($3, $4, $6, 'Other', 'Organization')`,
        [
          employeeOneId,
          employeeTwoId,
          employeeOtherId,
          tenantId,
          organizationOneId,
          organizationTwoId,
        ],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, first_name, last_name)
         VALUES ($1, $2, 'Other tenant', 'Employee')`,
        [otherTenantEmployeeId, otherTenantId],
      );
      await owner.query(
        `INSERT INTO employees.employee_facility_assignments
           (id, tenant_id, organization_id, employee_id, facility_id, is_primary)
         VALUES ($1, $4, $5, $6, $7, true),
                ($2, $4, $5, $8, $9, true),
                ($3, $4, $10, $11, $12, true)`,
        [
          uuidv7(),
          uuidv7(),
          uuidv7(),
          tenantId,
          organizationOneId,
          employeeOneId,
          facilityOneId,
          employeeTwoId,
          facilityTwoId,
          organizationTwoId,
          employeeOtherId,
          facilityOtherId,
        ],
      );
      await owner.query(
        `INSERT INTO employees.employee_team_memberships
           (id, tenant_id, organization_id, employee_id, team_id)
         VALUES ($1, $4, $5, $6, $7), ($2, $4, $5, $8, $9), ($3, $4, $10, $11, $12)`,
        [
          uuidv7(),
          uuidv7(),
          uuidv7(),
          tenantId,
          organizationOneId,
          employeeOneId,
          teamOneId,
          employeeTwoId,
          teamTwoId,
          organizationTwoId,
          employeeOtherId,
          teamOtherId,
        ],
      );
      await owner.query(
        `INSERT INTO employees.qualification_definitions (id, tenant_id, name, code)
         VALUES ($1, $2, 'Scope qualification', 'SCOPE'),
                ($3, $4, 'Other tenant qualification', 'OTHER')`,
        [qualificationId, tenantId, otherTenantQualificationId, otherTenantId],
      );
      await owner.query(
        `INSERT INTO employees.employee_qualifications
           (id, tenant_id, employee_id, qualification_id, valid_until)
         VALUES ($1, $4, $5, $6, $7), ($2, $4, $8, $6, $9), ($3, $4, $10, $6, $7)`,
        [
          assignmentOneId,
          assignmentTwoId,
          assignmentOtherId,
          tenantId,
          employeeOneId,
          qualificationId,
          yesterday,
          employeeTwoId,
          fortyFiveDaysLater,
          employeeOtherId,
        ],
      );

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const visibleTenantEmployees = await appRole.query<{ id: string }>(
        'SELECT id FROM employees.employees ORDER BY id',
      );
      expect(visibleTenantEmployees.rows.map((row) => row.id)).toHaveLength(3);
      expect(visibleTenantEmployees.rows.some((row) => row.id === otherTenantEmployeeId)).toBe(
        false,
      );
      const hiddenCrossTenantWrite = await appRole.query(
        `UPDATE employees.employees SET status = 'inactive' WHERE id = $1`,
        [otherTenantEmployeeId],
      );
      expect(hiddenCrossTenantWrite.rowCount).toBe(0);
      await appRole.query('COMMIT');

      await expect(
        owner.query(
          `INSERT INTO employees.employee_qualifications
             (id, tenant_id, employee_id, qualification_id)
           VALUES ($1, $2, $3, $4)`,
          [uuidv7(), tenantId, employeeOneId, otherTenantQualificationId],
        ),
      ).rejects.toMatchObject({ code: '23503' });

      const organizationSummary = await service.summary(
        principal(tenantId, { scopeType: 'organization', scopeId: organizationOneId }),
        { asOf: today },
      );
      expect(organizationSummary).toMatchObject({
        employeeCount: 2,
        expiredQualifications: 1,
        expiringQualifications: 1,
      });
      expect(organizationSummary.operations[0]?.findingCounts.COMPETENCY_POLICY_MISSING).toBe(2);

      const facilityOneSummary = await service.summary(
        principal(tenantId, { scopeType: 'facility', scopeId: facilityOneId }),
        { asOf: today },
      );
      expect(facilityOneSummary).toMatchObject({
        employeeCount: 1,
        expiredQualifications: 1,
        expiringQualifications: 0,
      });
      expect(facilityOneSummary.operations[0]?.findingCounts.COMPETENCY_POLICY_MISSING).toBe(1);

      const teamTwoSummary = await service.summary(
        principal(tenantId, { scopeType: 'team', scopeId: teamTwoId }),
        { asOf: today },
      );
      expect(teamTwoSummary).toMatchObject({
        employeeCount: 1,
        expiredQualifications: 0,
        expiringQualifications: 1,
      });
      expect(teamTwoSummary.operations[0]?.findingCounts.COMPETENCY_POLICY_MISSING).toBe(1);

      await expect(
        service.employee(
          principal(
            tenantId,
            { scopeType: 'organization', scopeId: organizationOneId },
            'workforce_compliance.read_details',
          ),
          employeeOtherId,
          { asOf: today },
        ),
      ).rejects.toBeInstanceOf(WorkforceComplianceEmployeeNotFoundError);
    } finally {
      await database.close();
      await appRole.end().catch(() => undefined);
      await owner.end().catch(() => undefined);
      await testDatabase.container.stop();
    }
  });
});

function principal(
  tenantId: string,
  scope: Pick<PermissionGrant, 'scopeType' | 'scopeId'>,
  permission:
    | 'workforce_compliance.read'
    | 'workforce_compliance.read_details' = 'workforce_compliance.read',
): AuthorizationPrincipal {
  return {
    tenantId,
    userId: uuidv7(),
    grants: [{ permission, ...scope }],
  };
}

function localDateInBerlin(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
