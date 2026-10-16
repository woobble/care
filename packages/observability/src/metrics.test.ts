import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';

import {
  createApiMetrics,
  createWorkerMetrics,
  startMetricsServer,
  stopMetricsServer,
} from './metrics';

function metricSample(
  body: string,
  name: string,
  labels: Record<string, string>,
): string | undefined {
  return body.split('\n').find((line) => {
    if (!line.startsWith(`${name}{`)) return false;
    return Object.entries(labels).every(([key, value]) => line.includes(`${key}="${value}"`));
  });
}

describe('Prometheus operational metrics', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await stopMetricsServer(server);
    server = undefined;
  });

  test('serves API readiness, bounded request labels, and document failures', async () => {
    const metrics = createApiMetrics();
    metrics.recordHttpRequest({
      method: 'GET',
      route: '/api/v1/clients/:id',
      statusCode: 200,
      durationSeconds: 0.04,
    });
    metrics.recordReadiness({
      status: 'ready',
      dependencies: {
        database: 'ready',
        storage: 'ready',
        worker: 'degraded',
        routing: 'not_configured',
      },
    });
    metrics.recordDocumentGenerationFailure('evidence_package', 'generate');

    server = await startMetricsServer(metrics.registry, 0, '127.0.0.1');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Metrics server did not bind.');

    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(metricSample(body, 'care_api_readiness', { service: 'care-api' })).toEndWith('} 1');
    expect(
      metricSample(body, 'care_api_dependency_status', {
        dependency: 'worker',
        state: 'degraded',
        service: 'care-api',
      }),
    ).toEndWith('} 1');
    expect(
      metricSample(body, 'care_api_http_requests_total', {
        method: 'GET',
        route: '/api/v1/clients/:id',
        status_code: '200',
        service: 'care-api',
      }),
    ).toEndWith('} 1');
    expect(
      metricSample(body, 'care_document_generation_failures_total', {
        source_type: 'evidence_package',
        operation: 'generate',
        service: 'care-api',
      }),
    ).toEndWith('} 1');
    expect(body).not.toContain('client-secret-name');
    expect((await fetch(`http://127.0.0.1:${address.port}/`)).status).toBe(404);
  });

  test('serves worker scheduler, outbox, and heartbeat state without tenant labels', async () => {
    const metrics = createWorkerMetrics();
    metrics.recordOutboxFailure('delivery');
    metrics.recordSchedulerRun('failure');
    metrics.recordHealth({
      schedulerStatus: 'degraded',
      heartbeatAt: new Date('2026-10-12T12:00:00.000Z'),
      lastScheduledSuccessAt: null,
      lastScheduledFailureAt: new Date('2026-10-12T11:59:00.000Z'),
      lastOutboxFailureAt: new Date('2026-10-12T11:58:00.000Z'),
      pendingOutboxCount: 3,
      deadOutboxCount: 1,
    });

    const body = await metrics.registry.metrics();
    expect(
      metricSample(body, 'care_worker_scheduler_status', {
        state: 'degraded',
        service: 'care-worker',
      }),
    ).toEndWith('} 1');
    expect(
      metricSample(body, 'care_worker_scheduler_runs_total', {
        result: 'failure',
        service: 'care-worker',
      }),
    ).toEndWith('} 1');
    expect(
      metricSample(body, 'care_worker_outbox_failures_total', {
        operation: 'delivery',
        service: 'care-worker',
      }),
    ).toEndWith('} 1');
    expect(
      metricSample(body, 'care_worker_outbox_messages', {
        status: 'pending_or_processing',
        service: 'care-worker',
      }),
    ).toEndWith('} 3');
    expect(body).toContain('care_worker_last_scheduled_success_timestamp_seconds');
    expect(body).not.toContain('tenant_id');
  });
});
