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
  ] as const) {
    dispatcher.subscribe(eventType, async () => {
      logger.info({ eventType }, 'Domain event dispatched');
    });
  }
  const workerId = `${hostname()}:${process.pid}`;
  let stopping = false;

  const relay = async (): Promise<void> => {
    while (!stopping) {
      try {
        const ids = await outbox.pendingIds(new Date(), leaseMs, batchSize);
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
      } catch (error) {
        logger.error({ err: error }, 'Outbox polling failed');
      }

      if (!stopping)
        await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
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
