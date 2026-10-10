import { describe, expect, test } from 'bun:test';
import { OsrmRouteProvider } from './route-provider';

describe('OSRM route provider', () => {
  test('includes an optional work start location and keeps its first leg separate from visit conflicts', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      expect(String(input)).toContain('/route/v1/driving/13.4,52.5;13.5,52.6;13.6,52.7');
      return Response.json({
        code: 'Ok',
        routes: [
          {
            legs: [
              { duration: 300, distance: 1000 },
              { duration: 600, distance: 2000 },
            ],
          },
        ],
      });
    }) as typeof fetch;
    try {
      const result = await new OsrmRouteProvider('http://routing.test').estimate(
        [
          { visitId: 'visit-1', location: { latitude: 52.6, longitude: 13.5 } },
          { visitId: 'visit-2', location: { latitude: 52.7, longitude: 13.6 } },
        ],
        { latitude: 52.5, longitude: 13.4 },
      );
      expect(result).toEqual({
        status: 'available',
        legs: [
          { fromVisitId: null, toVisitId: 'visit-1', durationSeconds: 300, distanceMeters: 1000 },
          {
            fromVisitId: 'visit-1',
            toVisitId: 'visit-2',
            durationSeconds: 600,
            distanceMeters: 2000,
          },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
