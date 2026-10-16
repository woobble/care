import { createServer, type Server } from 'node:http';

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const readinessStates = [
  'ready',
  'degraded',
  'unavailable',
  'not_configured',
  'unverified',
] as const;
const schedulerStates = ['starting', 'running', 'degraded', 'stopping', 'stopped'] as const;

export type ApiDependencyState = (typeof readinessStates)[number];
export type WorkerSchedulerState = (typeof schedulerStates)[number];
export type DocumentGenerationSource =
  | 'evidence_package'
  | 'evidence_period'
  | 'service_agreement'
  | 'benefit_overview';

export interface ApiMetrics {
  registry: Registry;
  recordHttpRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void;
  recordReadiness(input: {
    status: 'ready' | 'unavailable';
    dependencies: Record<'database' | 'storage' | 'worker' | 'routing', ApiDependencyState>;
  }): void;
  recordDocumentGenerationFailure(
    sourceType: DocumentGenerationSource,
    operation: 'generate' | 'preview',
  ): void;
}

export interface WorkerMetrics {
  registry: Registry;
  recordOutboxFailure(operation: 'delivery' | 'poll'): void;
  recordSchedulerRun(result: 'success' | 'failure'): void;
  recordHealth(input: {
    schedulerStatus: WorkerSchedulerState;
    heartbeatAt: Date | null;
    lastScheduledSuccessAt: Date | null;
    lastScheduledFailureAt: Date | null;
    lastOutboxFailureAt: Date | null;
    pendingOutboxCount: number;
    deadOutboxCount: number;
  }): void;
}

export function createApiMetrics(): ApiMetrics {
  const registry = createRegistry('care-api');
  const requests = new Counter({
    name: 'care_api_http_requests_total',
    help: 'Completed API requests.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
  });
  const requestDuration = new Histogram({
    name: 'care_api_http_request_duration_seconds',
    help: 'Duration of completed API requests in seconds.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const readiness = new Gauge({
    name: 'care_api_readiness',
    help: 'One when required API dependencies are ready, otherwise zero.',
    registers: [registry],
  });
  const dependencies = new Gauge({
    name: 'care_api_dependency_status',
    help: 'One for the current status of each API dependency.',
    labelNames: ['dependency', 'state'] as const,
    registers: [registry],
  });
  const documentFailures = new Counter({
    name: 'care_document_generation_failures_total',
    help: 'Document generation failures by source type and operation.',
    labelNames: ['source_type', 'operation'] as const,
    registers: [registry],
  });

  return {
    registry,
    recordHttpRequest({ method, route, statusCode, durationSeconds }) {
      const labels = { method, route, status_code: String(statusCode) };
      requests.inc(labels);
      requestDuration.observe(labels, durationSeconds);
    },
    recordReadiness({ status, dependencies: currentDependencies }) {
      readiness.set(status === 'ready' ? 1 : 0);
      for (const [dependency, currentState] of Object.entries(currentDependencies)) {
        for (const state of readinessStates) {
          dependencies.set({ dependency, state }, state === currentState ? 1 : 0);
        }
      }
    },
    recordDocumentGenerationFailure(sourceType, operation) {
      documentFailures.inc({ source_type: sourceType, operation });
    },
  };
}

export function createWorkerMetrics(): WorkerMetrics {
  const registry = createRegistry('care-worker');
  const outboxFailures = new Counter({
    name: 'care_worker_outbox_failures_total',
    help: 'Worker outbox delivery and polling failures.',
    labelNames: ['operation'] as const,
    registers: [registry],
  });
  const schedulerRuns = new Counter({
    name: 'care_worker_scheduler_runs_total',
    help: 'Completed worker scheduler cycles by result.',
    labelNames: ['result'] as const,
    registers: [registry],
  });
  const schedulerStatus = new Gauge({
    name: 'care_worker_scheduler_status',
    help: 'One for the current worker scheduler state.',
    labelNames: ['state'] as const,
    registers: [registry],
  });
  const heartbeatTimestamp = new Gauge({
    name: 'care_worker_heartbeat_timestamp_seconds',
    help: 'Unix timestamp of the last persisted worker heartbeat.',
    registers: [registry],
  });
  const lastScheduledSuccessTimestamp = new Gauge({
    name: 'care_worker_last_scheduled_success_timestamp_seconds',
    help: 'Unix timestamp of the last successful scheduler cycle, or zero if none.',
    registers: [registry],
  });
  const lastScheduledFailureTimestamp = new Gauge({
    name: 'care_worker_last_scheduled_failure_timestamp_seconds',
    help: 'Unix timestamp of the last failed scheduler cycle, or zero if none.',
    registers: [registry],
  });
  const lastOutboxFailureTimestamp = new Gauge({
    name: 'care_worker_last_outbox_failure_timestamp_seconds',
    help: 'Unix timestamp of the last outbox failure, or zero if none.',
    registers: [registry],
  });
  const outboxMessages = new Gauge({
    name: 'care_worker_outbox_messages',
    help: 'Current outbox message counts reported by the worker.',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  return {
    registry,
    recordOutboxFailure(operation) {
      outboxFailures.inc({ operation });
    },
    recordSchedulerRun(result) {
      schedulerRuns.inc({ result });
    },
    recordHealth(input) {
      for (const state of schedulerStates) {
        schedulerStatus.set({ state }, state === input.schedulerStatus ? 1 : 0);
      }
      heartbeatTimestamp.set(input.heartbeatAt ? input.heartbeatAt.getTime() / 1000 : 0);
      lastScheduledSuccessTimestamp.set(
        input.lastScheduledSuccessAt ? input.lastScheduledSuccessAt.getTime() / 1000 : 0,
      );
      lastScheduledFailureTimestamp.set(
        input.lastScheduledFailureAt ? input.lastScheduledFailureAt.getTime() / 1000 : 0,
      );
      lastOutboxFailureTimestamp.set(
        input.lastOutboxFailureAt ? input.lastOutboxFailureAt.getTime() / 1000 : 0,
      );
      outboxMessages.set({ status: 'pending_or_processing' }, input.pendingOutboxCount);
      outboxMessages.set({ status: 'dead' }, input.deadOutboxCount);
    },
  };
}

export async function startMetricsServer(
  registry: Registry,
  port: number,
  host = '0.0.0.0',
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404, { 'cache-control': 'no-store' }).end();
      return;
    }
    void registry
      .metrics()
      .then((metrics) => {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': registry.contentType,
        });
        response.end(metrics);
      })
      .catch(() => response.writeHead(500, { 'cache-control': 'no-store' }).end());
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  return server;
}

export async function stopMetricsServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createRegistry(service: 'care-api' | 'care-worker'): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return registry;
}
