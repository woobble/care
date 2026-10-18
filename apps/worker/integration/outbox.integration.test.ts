import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

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
      type: 'scheduling.tour_created',
      tenantId,
      aggregateType: 'tour',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: {
        tourId: uuidv7(),
        employeeId: uuidv7(),
        localDate: '2026-10-16',
        visitIds: [uuidv7()],
        version: 1,
      },
    }),
    createDomainEvent({
      type: 'claim.payer_created',
      tenantId,
      aggregateType: 'payer',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: { payerId: uuidv7(), organizationId: uuidv7(), payerType: 'public' },
    }),
    createDomainEvent({
      type: 'document.template_updated',
      tenantId,
      aggregateType: 'document',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: { organizationId: uuidv7(), documentType: 'service_agreement', version: 2 },
    }),
    createDomainEvent({
      type: 'onboarding.case_created',
      tenantId,
      aggregateType: 'onboarding',
      aggregateId: uuidv7(),
      actor: { type: 'system' },
      correlationId: uuidv7(),
      payload: { caseId: uuidv7(), version: 1 },
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
  let workerLogPromise: Promise<string> | undefined;

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
      stdout: 'pipe',
      stderr: 'pipe',
    });
    workerLogPromise = new Response(worker.stdout).text();

    let delivered = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
      const result = await owner.query<{ id: string; status: string }>(
        'SELECT id, status FROM platform.outbox_messages WHERE id = ANY($1::uuid[])',
        [events.map((event) => event.id)],
      );
      delivered =
        result.rows.length === events.length &&
        result.rows.every((row) => row.status === 'delivered');
      if (delivered) break;
      if (worker.exitCode !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
        const stderr = await new Response(worker.stderr).text();
        throw new Error(`Outbox worker exited with ${worker.exitCode}: ${stderr}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Keep integration setup and polling ordered.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(delivered).toBe(true);
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill('SIGTERM');
      await worker.exited;
    }
    if (worker) expect(worker.exitCode).toBe(0);
    if (workerLogPromise) {
      const logLines = (await workerLogPromise)
        .split('\n')
        .filter((line) => line.trim().startsWith('{'));
      const logRows = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const handledEvents = logRows.filter((row) => row.msg === 'Outbox event handled');
      expect(handledEvents).toHaveLength(events.length);
      expect(handledEvents[0]).toMatchObject({
        eventId: expect.any(String),
        eventType: expect.any(String),
        handlerCategory: 'domain_event_dispatch',
        attemptCount: 1,
        recoveryOutcome: 'delivered',
      });
      expect(typeof handledEvents[0]?.handlerDurationMs).toBe('number');
    }
    await owner.end();
    await database.container.stop();
  }
}, 180_000);

test('worker restart does not duplicate a recurring Operations task committed before a process crash', async () => {
  const database = await startCareTestDatabase();
  const owner = new Client({ connectionString: database.migrationUrl });
  const tenantId = uuidv7();
  const organizationId = uuidv7();
  const recurrenceId = uuidv7();
  const now = new Date();
  const startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let crashedWorker: ReturnType<typeof Bun.spawn> | undefined;
  let restartedWorker: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await owner.connect();
    await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
      tenantId,
      'Worker Crash Test',
      `worker-crash-${tenantId}`,
    ]);
    await owner.query(
      'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
      [organizationId, tenantId, 'Worker Crash Test Provider'],
    );
    await owner.query(
      `INSERT INTO operations.recurring_task_definitions
         (id, tenant_id, organization_id, title, priority, recurrence_rule, timezone,
          start_date, time_of_day, next_occurrence_date, next_occurrence_at, status,
          generation_policy, created_by_user_id)
       VALUES ($1, $2, $3, 'Crash recovery follow-up', 'normal', $4, 'Europe/Berlin',
               $5, '00:00:00', $5, $6, 'active', 'generate_missed', $7)`,
      [
        recurrenceId,
        tenantId,
        organizationId,
        { frequency: 'yearly', interval: 1 },
        startDate,
        new Date(now.getTime() - 60_000),
        uuidv7(),
      ],
    );
    await owner.query(`
      CREATE FUNCTION operations.goal15_worker_finish_gate() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.job_name = 'recurring_tasks' AND NEW.status = 'succeeded' THEN
          PERFORM pg_sleep(20);
        END IF;
        RETURN NEW;
      END;
      $body$
    `);
    await owner.query(`
      CREATE TRIGGER goal15_worker_finish_gate
      BEFORE UPDATE ON operations.scheduler_runs
      FOR EACH ROW EXECUTE FUNCTION operations.goal15_worker_finish_gate()
    `);

    const workerEnvironment = {
      ...process.env,
      NODE_ENV: 'test',
      WORKER_DATABASE_URL: database.workerUrl,
      WORKER_POLL_INTERVAL_MS: '100',
    };
    crashedWorker = Bun.spawn([process.execPath, 'run', 'src/main.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: workerEnvironment,
      stdout: 'ignore',
      stderr: 'pipe',
    });

    let interruptedAfterCommit = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Poll until the committed side effect and in-flight scheduler state are observable.
      const result = await owner.query<{
        occurrences: string;
        tasks: string;
        status: string | null;
      }>(
        `SELECT
           (SELECT count(*) FROM operations.recurring_task_occurrences WHERE tenant_id = $1 AND recurrence_definition_id = $2)::text AS occurrences,
           (SELECT count(*) FROM operations.tasks WHERE tenant_id = $1 AND title = 'Crash recovery follow-up')::text AS tasks,
           (SELECT status FROM operations.scheduler_runs WHERE tenant_id = $1 AND job_name = 'recurring_tasks') AS status`,
        [tenantId, recurrenceId],
      );
      const state = result.rows[0];
      if (state?.occurrences === '1' && state.tasks === '1' && state.status === 'running') {
        interruptedAfterCommit = true;
        break;
      }
      if (crashedWorker.exitCode !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Read the failed worker output before deciding whether to retry the poll.
        const stderr = await new Response(crashedWorker.stderr).text();
        throw new Error(`Worker exited before the injected commit boundary: ${stderr}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Poll sequentially with a short fixed interval.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(interruptedAfterCommit).toBe(true);
    crashedWorker.kill('SIGKILL');
    await crashedWorker.exited;
    crashedWorker = undefined;

    await owner.query('DROP TRIGGER goal15_worker_finish_gate ON operations.scheduler_runs');
    await owner.query('DROP FUNCTION operations.goal15_worker_finish_gate()');
    await owner.query(
      `UPDATE operations.scheduler_runs
       SET lease_until = now() - interval '1 second'
       WHERE tenant_id = $1 AND job_name = 'recurring_tasks'`,
      [tenantId],
    );

    restartedWorker = Bun.spawn([process.execPath, 'run', 'src/main.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: workerEnvironment,
      stdout: 'ignore',
      stderr: 'pipe',
    });
    let recovered = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Poll until the restarted scheduler acknowledges recovery.
      const result = await owner.query<{
        occurrences: string;
        tasks: string;
        status: string | null;
        last_succeeded_at: Date | null;
      }>(
        `SELECT
           (SELECT count(*) FROM operations.recurring_task_occurrences WHERE tenant_id = $1 AND recurrence_definition_id = $2)::text AS occurrences,
           (SELECT count(*) FROM operations.tasks WHERE tenant_id = $1 AND title = 'Crash recovery follow-up')::text AS tasks,
           r.status,
           r.last_succeeded_at
         FROM operations.scheduler_runs AS r
         WHERE r.tenant_id = $1 AND r.job_name = 'recurring_tasks'`,
        [tenantId, recurrenceId],
      );
      const state = result.rows[0];
      if (state?.status === 'succeeded' && state.last_succeeded_at) {
        expect(state.occurrences).toBe('1');
        expect(state.tasks).toBe('1');
        recovered = true;
        break;
      }
      if (restartedWorker.exitCode !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Read the failed worker output before deciding whether to retry the poll.
        const stderr = await new Response(restartedWorker.stderr).text();
        throw new Error(`Restarted worker exited before recovery: ${stderr}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Poll sequentially with a short fixed interval.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(recovered).toBe(true);
  } finally {
    for (const worker of [crashedWorker, restartedWorker]) {
      if (worker && worker.exitCode === null) {
        worker.kill('SIGTERM');
        // oxlint-disable-next-line no-await-in-loop -- Await each worker exit before releasing its isolated database.
        await worker.exited;
      }
    }
    await owner.end();
    await database.container.stop();
  }
}, 180_000);

test('worker restart does not duplicate deadline reminder tasks committed before a process crash', async () => {
  const database = await startCareTestDatabase();
  const owner = new Client({ connectionString: database.migrationUrl });
  const tenantId = uuidv7();
  const organizationId = uuidv7();
  const facilityId = uuidv7();
  const clientId = uuidv7();
  const agreementId = uuidv7();
  const now = new Date();
  const expiredDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const validFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let crashedWorker: ReturnType<typeof Bun.spawn> | undefined;
  let restartedWorker: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await owner.connect();
    await owner.query('INSERT INTO organizations.tenants (id, name, slug) VALUES ($1, $2, $3)', [
      tenantId,
      'Deadline Worker Test',
      `deadline-worker-${tenantId}`,
    ]);
    await owner.query(
      'INSERT INTO organizations.organizations (id, tenant_id, name) VALUES ($1, $2, $3)',
      [organizationId, tenantId, 'Deadline Worker Test Provider'],
    );
    await owner.query(
      'INSERT INTO organizations.facilities (id, tenant_id, organization_id, name) VALUES ($1, $2, $3, $4)',
      [facilityId, tenantId, organizationId, 'Deadline Worker Test Facility'],
    );
    await owner.query(
      `INSERT INTO clients.clients
         (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Synthetic', 'Client', 'active', $5, $5)`,
      [clientId, tenantId, organizationId, facilityId, now],
    );
    await owner.query(
      `INSERT INTO service_agreements.agreements
         (id, tenant_id, client_id, organization_id, facility_id, status, valid_from, valid_until,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8)`,
      [agreementId, tenantId, clientId, organizationId, facilityId, validFrom, expiredDate, now],
    );
    await owner.query(
      `INSERT INTO operations.reminder_policies
         (id, tenant_id, organization_id, category, offsets_days, enabled,
          create_follow_up_task, updated_by_user_id)
       VALUES ($1, $2, $3, 'agreements', ARRAY[0], TRUE, TRUE, $4)`,
      [uuidv7(), tenantId, organizationId, uuidv7()],
    );
    await owner.query(`
      CREATE FUNCTION operations.goal15_deadline_finish_gate() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.job_name = 'deadline_evaluation' AND NEW.status = 'succeeded' THEN
          PERFORM pg_sleep(20);
        END IF;
        RETURN NEW;
      END;
      $body$
    `);
    await owner.query(`
      CREATE TRIGGER goal15_deadline_finish_gate
      BEFORE UPDATE ON operations.scheduler_runs
      FOR EACH ROW EXECUTE FUNCTION operations.goal15_deadline_finish_gate()
    `);

    const workerEnvironment = {
      ...process.env,
      NODE_ENV: 'test',
      WORKER_DATABASE_URL: database.workerUrl,
      WORKER_POLL_INTERVAL_MS: '100',
    };
    crashedWorker = Bun.spawn([process.execPath, 'run', 'src/main.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: workerEnvironment,
      stdout: 'ignore',
      stderr: 'pipe',
    });

    let interruptedAfterCommit = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Poll until committed reminder effects and the in-flight scheduler state are observable.
      const result = await owner.query<{
        tasks: string;
        occurrences: string;
        status: string | null;
      }>(
        `SELECT
           (SELECT count(*) FROM operations.tasks
            WHERE tenant_id = $1 AND source_agreement_id = $2 AND source_deadline_key IS NOT NULL)::text AS tasks,
           (SELECT count(*) FROM operations.exception_occurrences
            WHERE tenant_id = $1 AND source_entity_id = $2 AND issue_code = 'agreement_expiry'
              AND resolved_at IS NULL)::text AS occurrences,
           (SELECT status FROM operations.scheduler_runs
            WHERE tenant_id = $1 AND job_name = 'deadline_evaluation') AS status`,
        [tenantId, agreementId],
      );
      const state = result.rows[0];
      if (state?.tasks === '1' && state.occurrences === '1' && state.status === 'running') {
        interruptedAfterCommit = true;
        break;
      }
      if (crashedWorker.exitCode !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Read worker failure output before deciding whether to retry the poll.
        const stderr = await new Response(crashedWorker.stderr).text();
        throw new Error(`Worker exited before the injected deadline commit boundary: ${stderr}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Poll sequentially with a short fixed interval.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(interruptedAfterCommit).toBe(true);
    crashedWorker.kill('SIGKILL');
    await crashedWorker.exited;
    crashedWorker = undefined;

    await owner.query('DROP TRIGGER goal15_deadline_finish_gate ON operations.scheduler_runs');
    await owner.query('DROP FUNCTION operations.goal15_deadline_finish_gate()');
    await owner.query(
      `UPDATE operations.scheduler_runs
       SET lease_until = now() - interval '1 second'
       WHERE tenant_id = $1 AND job_name = 'deadline_evaluation'`,
      [tenantId],
    );

    restartedWorker = Bun.spawn([process.execPath, 'run', 'src/main.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: workerEnvironment,
      stdout: 'ignore',
      stderr: 'pipe',
    });
    let recovered = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Poll until the restarted scheduler acknowledges recovery.
      const result = await owner.query<{
        tasks: string;
        occurrences: string;
        status: string | null;
        last_succeeded_at: Date | null;
      }>(
        `SELECT
           (SELECT count(*) FROM operations.tasks
            WHERE tenant_id = $1 AND source_agreement_id = $2 AND source_deadline_key IS NOT NULL)::text AS tasks,
           (SELECT count(*) FROM operations.exception_occurrences
            WHERE tenant_id = $1 AND source_entity_id = $2 AND issue_code = 'agreement_expiry'
              AND resolved_at IS NULL)::text AS occurrences,
           r.status,
           r.last_succeeded_at
         FROM operations.scheduler_runs AS r
         WHERE r.tenant_id = $1 AND r.job_name = 'deadline_evaluation'`,
        [tenantId, agreementId],
      );
      const state = result.rows[0];
      if (state?.status === 'succeeded' && state.last_succeeded_at) {
        expect(state.tasks).toBe('1');
        expect(state.occurrences).toBe('1');
        recovered = true;
        break;
      }
      if (restartedWorker.exitCode !== null) {
        // oxlint-disable-next-line no-await-in-loop -- Read worker failure output before deciding whether to retry the poll.
        const stderr = await new Response(restartedWorker.stderr).text();
        throw new Error(`Restarted worker exited before deadline recovery: ${stderr}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Poll sequentially with a short fixed interval.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    expect(recovered).toBe(true);
  } finally {
    for (const worker of [crashedWorker, restartedWorker]) {
      if (worker && worker.exitCode === null) {
        worker.kill('SIGTERM');
        // oxlint-disable-next-line no-await-in-loop -- Await worker exit before releasing its isolated database.
        await worker.exited;
      }
    }
    await owner.end();
    await database.container.stop();
  }
}, 180_000);
