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

    try {
      await owner.connect();
      await app.connect();
      await owner.query(
        'INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
        [tenantA, 'Tenant A', `tenant-${tenantA}`, tenantB, 'Tenant B', `tenant-${tenantB}`],
      );
      await owner.query(
        `INSERT INTO clients.clients (id, tenant_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, 'Ada', 'A', 'pending', now(), now()), ($3, $4, 'Grace', 'B', 'pending', now(), now())`,
        [clientA, tenantA, clientB, tenantB],
      );

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const visible = await app.query<{ id: string }>('SELECT id FROM clients.clients ORDER BY id');
      expect(visible.rows.map((row) => row.id)).toEqual([clientA]);
      await app.query('COMMIT');

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      let insertError: unknown;
      try {
        await app.query(
          `INSERT INTO clients.clients (id, tenant_id, first_name, last_name, status, created_at, updated_at)
           VALUES ($1, $2, 'Grace', 'B', 'pending', now(), now())`,
          [randomUUID(), tenantB],
        );
      } catch (error) {
        insertError = error;
      }
      expect(insertError).toMatchObject({ code: '42501' });
      await app.query('ROLLBACK');
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
