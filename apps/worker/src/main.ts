// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading worker configuration
import '@care/config/load-env';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';

import { count, eq } from 'drizzle-orm';

import { DrizzleAuditWriter } from '@care/audit';
import { benefitsSchema, createBenefitsApplicationService } from '@care/benefits';
import { billingSchema } from '@care/billing';
import { clientsSchema } from '@care/clients';
import { loadWorkerConfig } from '@care/config';
import { createDatabase, createUnitOfWork } from '@care/database';
import { employeesSchema } from '@care/employees';
import { EventDispatcher } from '@care/events';
import { createLogger } from '@care/logging';
import { startMetricsServer, startTelemetry, stopMetricsServer } from '@care/observability';
import { onboardingSchema, readOperationsDeadlineCases } from '@care/onboarding';
import {
  OperationsDeadlineTaskScheduler,
  OperationsRecurrenceApplicationService,
  operationsSchema,
} from '@care/operations';
import { organizationsSchema, tenants } from '@care/organizations';
import {
  DrizzleOutboxRepository,
  outboxMessages,
  platformSchema,
  workerHealth,
} from '@care/platform';

import { workerMetrics } from './operational-metrics';

const batchSize = 50;
const leaseMs = 120_000;
const maxAttempts = 10;
const workerHealthPort = 3002;
const heartbeatIntervalMs = 15_000;
const staleHeartbeatMs = 90_000;
const shutdownTimeoutMs = 10_000;

function waitForNextPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger('care-worker');
  const stopTelemetry = await startTelemetry('care-worker', config.OTEL_EXPORTER_OTLP_ENDPOINT);
  const database = createDatabase(config.WORKER_DATABASE_URL, {
    ...platformSchema,
    ...organizationsSchema,
    ...clientsSchema,
    ...employeesSchema,
    ...benefitsSchema,
    ...billingSchema,
    ...onboardingSchema,
    ...operationsSchema,
  });
  const outbox = new DrizzleOutboxRepository(database.db);
  const unitOfWork = createUnitOfWork(database.db);
  const auditWriter = new DrizzleAuditWriter();
  const recurrenceScheduler = new OperationsRecurrenceApplicationService(
    unitOfWork,
    auditWriter,
    outbox,
  );
  const deadlineScheduler = new OperationsDeadlineTaskScheduler(unitOfWork, auditWriter, outbox, {
    benefits: createBenefitsApplicationService(unitOfWork, auditWriter, outbox),
    onboardingCases: readOperationsDeadlineCases,
  });
  const dispatcher = new EventDispatcher();
  dispatcher.subscribeAll(async (event) => {
    logger.info({ eventType: event.type }, 'Domain event dispatched');
  });
  const startedAt = new Date();
  const workerId = `${hostname()}:${process.pid}:${startedAt.getTime()}`;
  const health = {
    schedulerStatus: 'starting' as 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped',
    lastScheduledSuccessAt: null as Date | null,
    lastScheduledFailureAt: null as Date | null,
    lastScheduledFailureName: null as string | null,
    lastOutboxFailureAt: null as Date | null,
    lastOutboxFailureName: null as string | null,
    lastPersistedAt: null as number | null,
  };

  const writeHealth = async (): Promise<void> => {
    const counts = await database.db
      .select({ status: outboxMessages.status, count: count() })
      .from(outboxMessages)
      .groupBy(outboxMessages.status);
    const pendingOutboxCount = counts
      .filter(({ status }) => status === 'pending' || status === 'processing')
      .reduce((total, row) => total + Number(row.count), 0);
    const deadOutboxCount = Number(counts.find(({ status }) => status === 'dead')?.count ?? 0);
    const heartbeatAt = new Date();

    await database.db
      .insert(workerHealth)
      .values({
        workerId,
        hostName: hostname(),
        startedAt,
        heartbeatAt,
        schedulerStatus: health.schedulerStatus,
        lastScheduledSuccessAt: health.lastScheduledSuccessAt,
        lastScheduledFailureAt: health.lastScheduledFailureAt,
        lastScheduledFailureName: health.lastScheduledFailureName,
        lastOutboxFailureAt: health.lastOutboxFailureAt,
        lastOutboxFailureName: health.lastOutboxFailureName,
        pendingOutboxCount,
        deadOutboxCount,
      })
      .onConflictDoUpdate({
        target: workerHealth.workerId,
        set: {
          heartbeatAt,
          schedulerStatus: health.schedulerStatus,
          lastScheduledSuccessAt: health.lastScheduledSuccessAt,
          lastScheduledFailureAt: health.lastScheduledFailureAt,
          lastScheduledFailureName: health.lastScheduledFailureName,
          lastOutboxFailureAt: health.lastOutboxFailureAt,
          lastOutboxFailureName: health.lastOutboxFailureName,
          pendingOutboxCount,
          deadOutboxCount,
        },
      });
    health.lastPersistedAt = heartbeatAt.getTime();
    workerMetrics.recordHealth({
      schedulerStatus: health.schedulerStatus,
      heartbeatAt,
      lastScheduledSuccessAt: health.lastScheduledSuccessAt,
      lastScheduledFailureAt: health.lastScheduledFailureAt,
      lastOutboxFailureAt: health.lastOutboxFailureAt,
      pendingOutboxCount,
      deadOutboxCount,
    });
  };

  let healthWrite: Promise<void> | null = null;
  const persistHealth = (): Promise<void> => {
    if (healthWrite) return healthWrite;
    healthWrite = writeHealth().finally(() => {
      healthWrite = null;
    });
    return healthWrite;
  };

  const healthServer = createServer((request, response) => {
    if (request.url !== '/health/live' && request.url !== '/health/ready') {
      response.writeHead(404).end();
      return;
    }
    const live = request.url === '/health/live';
    const ready =
      health.lastPersistedAt !== null &&
      Date.now() - health.lastPersistedAt < staleHeartbeatMs &&
      health.schedulerStatus !== 'starting' &&
      health.schedulerStatus !== 'stopping' &&
      health.schedulerStatus !== 'stopped';
    const ok = live || ready;
    response.writeHead(ok ? 200 : 503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    });
    response.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
  });

  await persistHealth();
  await new Promise<void>((resolve, reject) => {
    healthServer.once('error', reject);
    healthServer.listen(workerHealthPort, '0.0.0.0', resolve);
  });
  const metricsServer = await startMetricsServer(workerMetrics.registry, 3003);
  health.schedulerStatus = 'running';
  await persistHealth();
  const heartbeatTimer = setInterval(() => {
    void persistHealth().catch((error: unknown) => {
      logger.error({ errorName: safeErrorName(error) }, 'Worker heartbeat update failed');
    });
  }, heartbeatIntervalMs);

  let stopping = false;
  const shutdownController = new AbortController();
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

  const relay = async (): Promise<void> => {
    while (true) {
      if (stopping) break;
      let scheduledFailureName: string | null = null;
      try {
        // Start each batch after the previous one settles to keep polling bounded.
        // oxlint-disable-next-line no-await-in-loop
        const ids = await outbox.pendingIds(new Date(), leaseMs, batchSize);
        // Claim and dispatch in order to preserve the outbox's delivery sequence.
        // oxlint-disable no-await-in-loop
        for (const id of ids) {
          const message = await outbox.claim(id, workerId, { leaseMs, maxAttempts });
          if (!message) continue;
          const handlerContext = {
            eventId: message.id,
            eventType: message.event.type,
            handlerCategory: 'domain_event_dispatch',
            attemptCount: message.attemptCount,
          };
          const handlerStartedAt = performance.now();
          try {
            await dispatcher.dispatch(message.event);
            await outbox.markDelivered(message);
            logger.info(
              {
                ...handlerContext,
                handlerDurationMs: Math.max(0, Math.round(performance.now() - handlerStartedAt)),
                recoveryOutcome: message.attemptCount > 1 ? 'redelivery_succeeded' : 'delivered',
              },
              'Outbox event handled',
            );
          } catch (error) {
            health.lastOutboxFailureAt = new Date();
            health.lastOutboxFailureName = safeErrorName(error);
            workerMetrics.recordOutboxFailure('delivery');
            const handlerDurationMs = Math.max(0, Math.round(performance.now() - handlerStartedAt));
            logger.error(
              {
                ...handlerContext,
                handlerDurationMs,
                failureCategory: health.lastOutboxFailureName,
              },
              'Outbox event handling failed',
            );
            const recoveryStartedAt = performance.now();
            try {
              await outbox.markFailed(message, error, maxAttempts);
              logger.warn(
                {
                  ...handlerContext,
                  recoveryDurationMs: Math.max(
                    0,
                    Math.round(performance.now() - recoveryStartedAt),
                  ),
                  recoveryOutcome:
                    message.attemptCount >= maxAttempts ? 'dead_lettered' : 'retry_scheduled',
                },
                'Outbox recovery recorded',
              );
            } catch (recordError) {
              logger.error(
                {
                  ...handlerContext,
                  recoveryDurationMs: Math.max(
                    0,
                    Math.round(performance.now() - recoveryStartedAt),
                  ),
                  recoveryOutcome: 'recording_failed',
                  failureCategory: safeErrorName(recordError),
                },
                'Could not record outbox delivery failure',
              );
            }
          }
        }
        // oxlint-enable no-await-in-loop
        // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
        const tenantsToProcess = await database.db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.active, true))
          .orderBy(tenants.id);
        // Each tenant is isolated so one failure cannot block other tenant schedules.
        // oxlint-disable no-await-in-loop
        for (const tenant of tenantsToProcess) {
          try {
            const result = await recurrenceScheduler.runRecurringTaskScheduler(tenant.id, workerId);
            if (result.tasksCreated > 0) {
              logger.info(
                { tasksCreated: result.tasksCreated },
                'Recurring Operations tasks generated',
              );
            }
          } catch (error) {
            scheduledFailureName ??= safeErrorName(error);
            logger.error(
              {
                tenantId: tenant.id,
                errorName: safeErrorName(error),
              },
              'Recurring Operations evaluation failed',
            );
          }
          try {
            const deadlineResult = await deadlineScheduler.run(tenant.id, workerId);
            if (deadlineResult.tasksCreated > 0) {
              logger.info(
                { tasksCreated: deadlineResult.tasksCreated },
                'Agreement deadline Operations tasks generated',
              );
            }
            if ('remindersTriggered' in deadlineResult && deadlineResult.remindersTriggered > 0) {
              logger.info(
                { remindersTriggered: deadlineResult.remindersTriggered },
                'Operations deadline reminders evaluated',
              );
            }
            if ('failedDomains' in deadlineResult && deadlineResult.failedDomains.length > 0) {
              scheduledFailureName ??= 'DeadlineSourceEvaluationFailed';
              logger.error(
                { tenantId: tenant.id, failedDomains: deadlineResult.failedDomains },
                'Some Operations deadline sources could not be evaluated',
              );
            }
          } catch (error) {
            scheduledFailureName ??= safeErrorName(error);
            logger.error(
              {
                tenantId: tenant.id,
                errorName: safeErrorName(error),
                ...developmentErrorDetails(error, config.NODE_ENV),
              },
              'Agreement deadline Operations evaluation failed',
            );
          }
        }
        // oxlint-enable no-await-in-loop
        if (scheduledFailureName) {
          health.schedulerStatus = 'degraded';
          health.lastScheduledFailureAt = new Date();
          health.lastScheduledFailureName = scheduledFailureName;
          workerMetrics.recordSchedulerRun('failure');
        } else {
          health.schedulerStatus = 'running';
          health.lastScheduledSuccessAt = new Date();
          workerMetrics.recordSchedulerRun('success');
        }
        // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
        await persistHealth();
      } catch (error) {
        health.schedulerStatus = 'degraded';
        health.lastOutboxFailureAt = new Date();
        health.lastOutboxFailureName = safeErrorName(error);
        workerMetrics.recordOutboxFailure('poll');
        logger.error({ errorName: safeErrorName(error) }, 'Worker polling failed');
        try {
          // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
          await persistHealth();
        } catch (healthError) {
          logger.error(
            { errorName: safeErrorName(healthError) },
            'Worker health state could not be recorded',
          );
        }
      }

      if (!stopping) {
        // Wait between completed batches instead of scheduling overlapping polls.
        // oxlint-disable-next-line no-await-in-loop
        await waitForNextPoll(config.WORKER_POLL_INTERVAL_MS, shutdownController.signal);
      }
    }
  };

  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    health.schedulerStatus = 'stopping';
    logger.info({ signal }, 'Worker shutdown requested');
    shutdownTimer = setTimeout(() => {
      logger.error(
        { timeoutMs: shutdownTimeoutMs },
        'Worker shutdown timed out; exiting forcefully',
      );
      process.exit(1);
    }, shutdownTimeoutMs);
    shutdownController.abort();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  let exitCode = 0;
  const cleanup = async (name: string, operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      exitCode = 1;
      logger.error(
        {
          errorName: safeErrorName(error),
          cleanup: name,
        },
        'Worker shutdown cleanup failed',
      );
    }
  };

  const relayPromise = relay();
  try {
    await relayPromise;
  } catch (error) {
    exitCode = 1;
    logger.error({ errorName: safeErrorName(error) }, 'Worker relay stopped unexpectedly');
  } finally {
    clearInterval(heartbeatTimer);
    health.schedulerStatus = 'stopped';
    await cleanup('health-state', () => persistHealth());
    await cleanup(
      'health-server',
      () =>
        new Promise<void>((resolve, reject) => {
          healthServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    await cleanup('metrics-server', () => stopMetricsServer(metricsServer));
    await cleanup('database', () => database.close());
    await cleanup('telemetry', () => stopTelemetry());
    logger.info({ exitCode }, 'Worker shutdown complete');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
    if (shutdownTimer) clearTimeout(shutdownTimer);
    process.exit(exitCode);
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
    ? error.name
    : 'UnknownError';
}

function developmentErrorDetails(
  error: unknown,
  environment: string,
): { errorMessage?: string; errorCode?: string } {
  if (environment === 'production' || !(error instanceof Error)) return {};

  const message = error.message.replace(/\s+/g, ' ').slice(0, 240);
  const code = (error as Error & { code?: unknown }).code;
  return {
    ...(message ? { errorMessage: message } : {}),
    ...(typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? { errorCode: code } : {}),
  };
}

void main();
