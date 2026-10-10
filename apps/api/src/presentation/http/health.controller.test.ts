import { describe, expect, test } from 'bun:test';
import { routingHealthStatus } from './health.controller';

describe('routing health status', () => {
  test('does not require OSRM when routing is not configured', async () => {
    expect(
      await routingHealthStatus({
        ROUTING_OSRM_URL: undefined,
        ROUTING_OSRM_PROBE_FROM: undefined,
        ROUTING_OSRM_PROBE_TO: undefined,
      }),
    ).toBe('not_configured');
  });

  test('reports configured routing as unverified without a region probe', async () => {
    expect(
      await routingHealthStatus({
        ROUTING_OSRM_URL: 'http://osrm:5000',
        ROUTING_OSRM_PROBE_FROM: undefined,
        ROUTING_OSRM_PROBE_TO: undefined,
      }),
    ).toBe('unverified');
  });

  test('uses the configured region probe and reports a valid OSRM route', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      expect(String(input)).toContain(
        '/route/v1/driving/6.95886,50.9413;6.956,50.936?overview=false',
      );
      return Response.json({
        code: 'Ok',
        routes: [{ legs: [{ distance: 100, duration: 20 }] }],
      });
    }) as typeof fetch;
    try {
      expect(
        await routingHealthStatus({
          ROUTING_OSRM_URL: 'http://osrm:5000',
          ROUTING_OSRM_PROBE_FROM: '6.95886,50.9413',
          ROUTING_OSRM_PROBE_TO: '6.956,50.936',
        }),
      ).toBe('ready');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps the application health status independent of a failed optional route probe', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    try {
      expect(
        await routingHealthStatus({
          ROUTING_OSRM_URL: 'http://osrm:5000',
          ROUTING_OSRM_PROBE_FROM: '6.95886,50.9413',
          ROUTING_OSRM_PROBE_TO: '6.956,50.936',
        }),
      ).toBe('unavailable');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
