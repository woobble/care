// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading worker configuration
import '@care/config/load-env';
import { hostname } from 'node:os';
import { EventDispatcher } from '@care/events';
import { loadWorkerConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { createLogger } from '@care/logging';
import { startTelemetry } from '@care/observability';
import { DrizzleOutboxRepository, platformSchema } from '@care/platform';

const batchSize = 50;
const leaseMs = 120_000;
const maxAttempts = 10;

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger('care-worker');
  const stopTelemetry = await startTelemetry('care-worker', config.OTEL_EXPORTER_OTLP_ENDPOINT);
  const database = createDatabase(config.WORKER_DATABASE_URL, platformSchema);
  const outbox = new DrizzleOutboxRepository(database.db);
  const dispatcher = new EventDispatcher();
  for (const eventType of [
    'client.created',
    'client.updated',
    'client.activated',
    'client.archived',
    'tenant.invitation.created',
    'tenant.invitation.accepted',
    'tenant.invitation.expired',
    'tenant.invitation.revoked',
    'tenant.member.invited',
    'tenant.member.activated',
    'tenant.member.deactivated',
    'tenant.member.revoked',
    'tenant.member.role_changed',
    'tenant.member.scope_changed',
  ] as const) {
    dispatcher.subscribe(eventType, async () => {
      logger.info({ eventType }, 'Domain event dispatched');
    });
  }
  const workerId = `${hostname()}:${process.pid}`;
  let stopping = false;

  const relay = async (): Promise<void> => {
    while (true) {
      if (stopping) break;
      try {
        // Start each batch after the previous one settles to keep polling bounded.
        // oxlint-disable-next-line no-await-in-loop
        const ids = await outbox.pendingIds(new Date(), leaseMs, batchSize);
        // Claim and dispatch in order to preserve the outbox's delivery sequence.
        // oxlint-disable no-await-in-loop
        for (const id of ids) {
          const message = await outbox.claim(id, workerId, { leaseMs, maxAttempts });
          if (!message) continue;
          try {
            await dispatcher.dispatch(message.event);
            await outbox.markDelivered(message);
            logger.info({ eventType: message.event.type }, 'Outbox event handled');
          } catch (error) {
            try {
              await outbox.markFailed(message, error, maxAttempts);
            } catch (recordError) {
              logger.error(
                { err: recordError, eventId: message.id },
                'Could not record outbox delivery failure',
              );
            }
          }
        }
        // oxlint-enable no-await-in-loop
      } catch (error) {
        logger.error({ err: error }, 'Outbox polling failed');
      }

      if (!stopping) {
        // Wait between completed batches instead of scheduling overlapping polls.
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
      }
    }
  };

  const relayPromise = relay();
  const shutdown = () => {
    stopping = true;
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  try {
    await relayPromise;
  } finally {
    await database.close();
    await stopTelemetry();
  }
}

void main();
