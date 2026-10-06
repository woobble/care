import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { expect, test } from 'bun:test';
import { createDomainEvent } from '@care/events';
import { startCareTestDatabase } from '@care/testing';

test('worker dispatches an outbox event before marking it delivered', async () => {
  const database = await startCareTestDatabase();
  const owner = new Client({ connectionString: database.migrationUrl });
  const eventId = randomUUID();
  const tenantId = randomUUID();
  const event = createDomainEvent({
    id: eventId,
    type: 'client.created',
    tenantId,
    aggregateType: 'client',
    aggregateId: randomUUID(),
    actor: { type: 'system' },
    correlationId: randomUUID(),
    payload: { clientId: randomUUID() },
  });
  let worker: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await owner.connect();
    await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
      tenantId,
      'Worker Test',
      `worker-${tenantId}`,
    ]);
    await owner.query(
      `INSERT INTO platform.outbox_messages (id, tenant_id, event_type, event_version, event, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [eventId, tenantId, event.type, event.version, event],
    );
    worker = Bun.spawn([process.execPath, 'run', 'src/main.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WORKER_DATABASE_URL: database.workerUrl,
        WORKER_POLL_INTERVAL_MS: '100',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    });

    let status: string | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await owner.query<{ status: string }>(
        'SELECT status FROM platform.outbox_messages WHERE id = $1',
        [eventId],
      );
      status = result.rows[0]?.status;
      if (status === 'delivered') break;
      if (worker.exitCode !== null) {
        const stderr = await new Response(worker.stderr).text();
        throw new Error(`Outbox worker exited with ${worker.exitCode}: ${stderr}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(status).toBe('delivered');
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill('SIGTERM');
      await worker.exited;
    }
    await owner.end();
    await database.container.stop();
  }
}, 180_000);
