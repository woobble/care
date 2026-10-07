import { v7 as uuidv7 } from 'uuid';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { expect, test } from 'bun:test';
import { createDomainEvent } from '@care/events';
import { startCareTestDatabase } from '@care/testing';

test('worker dispatches an outbox event before marking it delivered', async () => {
  const database = await startCareTestDatabase();
  const owner = new Client({ connectionString: database.migrationUrl });
  const tenantId = uuidv7();
  const generatedVisitId = uuidv7();
  const events = [
    createDomainEvent({
      type: 'employee.created',
      tenantId,
      aggregateType: 'employee',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: { employeeId: uuidv7(), organizationId: uuidv7() },
    }),
    createDomainEvent({
      type: 'team.updated',
      tenantId,
      aggregateType: 'team',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: { teamId: uuidv7(), changedFields: ['name'] },
    }),
    createDomainEvent({
      type: 'client.created',
      tenantId,
      aggregateType: 'client',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: { clientId: uuidv7() },
    }),
    createDomainEvent({
      type: 'visit.generated',
      tenantId,
      aggregateType: 'visit',
      aggregateId: generatedVisitId,
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: {
        visitId: generatedVisitId,
        agreementId: uuidv7(),
        clientId: uuidv7(),
      },
    }),
  ];
  let worker: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await owner.connect();
    await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
      tenantId,
      'Worker Test',
      `worker-${tenantId}`,
    ]);
    for (const event of events) {
      // oxlint-disable-next-line no-await-in-loop
      await owner.query(
        `INSERT INTO platform.outbox_messages (id, tenant_id, event_type, event_version, event, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [event.id, tenantId, event.type, event.version, event],
      );
    }
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

    let delivered = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await owner.query<{ id: string; status: string }>(
        'SELECT id, status FROM platform.outbox_messages WHERE id = ANY($1::uuid[])',
        [events.map((event) => event.id)],
      );
      delivered =
        result.rows.length === events.length &&
        result.rows.every((row) => row.status === 'delivered');
      if (delivered) break;
      if (worker.exitCode !== null) {
        const stderr = await new Response(worker.stderr).text();
        throw new Error(`Outbox worker exited with ${worker.exitCode}: ${stderr}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(delivered).toBe(true);
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill('SIGTERM');
      await worker.exited;
    }
    await owner.end();
    await database.container.stop();
  }
}, 180_000);
