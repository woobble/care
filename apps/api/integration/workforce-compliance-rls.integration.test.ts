import { v7 as uuidv7 } from 'uuid';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { startCareTestDatabase } from '@care/testing';

describe('workforce compliance settings row-level security', () => {
  test('hides another tenant settings row from reads and writes', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const crossTenantWriteId = uuidv7();

    try {
      await owner.connect();
      await appRole.connect();
      const expiryIndex = await owner.query<{ indexdef: string }>(
        `SELECT indexdef
         FROM pg_indexes
         WHERE schemaname = 'employees'
           AND indexname = 'employee_qualification_tenant_valid_until_idx'`,
      );
      expect(expiryIndex.rows).toHaveLength(1);
      expect(expiryIndex.rows[0]?.indexdef).toContain('(tenant_id, valid_until)');
      expect(expiryIndex.rows[0]?.indexdef).toContain('WHERE (valid_until IS NOT NULL)');

      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES
           ($1, 'Workforce RLS tenant', $2),
           ($3, 'Other workforce tenant', $4),
           ($5, 'Cross tenant write target', $6)`,
        [
          tenantId,
          `workforce-${tenantId}`,
          otherTenantId,
          `other-workforce-${otherTenantId}`,
          crossTenantWriteId,
          `write-target-${crossTenantWriteId}`,
        ],
      );
      await owner.query(
        `INSERT INTO workforce_compliance.settings
           (tenant_id, critical_days, warning_days, reporting_timezone, version)
         VALUES ($1, 30, 90, 'Europe/Berlin', 1), ($2, 30, 90, 'Europe/Berlin', 1)`,
        [tenantId, otherTenantId],
      );

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const visible = await appRole.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM workforce_compliance.settings ORDER BY tenant_id',
      );
      expect(visible.rows.map((row) => row.tenant_id)).toEqual([tenantId]);

      const crossTenantWrite = await appRole.query(
        `UPDATE workforce_compliance.settings
         SET warning_days = 120, version = version + 1
         WHERE tenant_id = $1`,
        [otherTenantId],
      );
      expect(crossTenantWrite.rowCount).toBe(0);

      await appRole.query('SAVEPOINT before_cross_tenant_settings_insert');
      await expect(
        appRole.query(
          `INSERT INTO workforce_compliance.settings
             (tenant_id, critical_days, warning_days, reporting_timezone, version)
           VALUES ($1, 30, 90, 'Europe/Berlin', 1)`,
          [crossTenantWriteId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await appRole.query('ROLLBACK TO SAVEPOINT before_cross_tenant_settings_insert');
      await appRole.query('COMMIT');

      const unchanged = await owner.query<{ warning_days: number; version: number }>(
        `SELECT warning_days, version
         FROM workforce_compliance.settings WHERE tenant_id = $1`,
        [otherTenantId],
      );
      expect(unchanged.rows[0]).toMatchObject({ warning_days: 90, version: 1 });
    } finally {
      await appRole.query('ROLLBACK').catch(() => undefined);
      await appRole.end().catch(() => undefined);
      await owner.end().catch(() => undefined);
      await testDatabase.container.stop();
    }
  });
});
