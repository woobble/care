import { describe, expect, test } from 'bun:test';

import { compareTourStops, sameTourDate, tourFeasibilityConflicts } from './tour';
import type { VisitData } from './visit';

function visit(
  id: string,
  startsAt: string,
  endsAt: string,
  timezone = 'Europe/Berlin',
): VisitData {
  return {
    id,
    tenantId: 'tenant',
    clientId: `client-${id}`,
    organizationId: 'organization',
    facilityId: 'facility',
    origin: 'manual',
    serviceAgreementId: null,
    status: 'planned',
    plannedStart: new Date(startsAt),
    plannedEnd: new Date(endsAt),
    timeWindowStart: null,
    timeWindowEnd: null,
    timezone,
    note: null,
    manuallyAdjusted: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('tour planning', () => {
  test('reports insufficient travel as blocking and missing route data as a warning', () => {
    const first = visit('first', '2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z');
    const second = visit('second', '2026-10-10T09:15:00Z', '2026-10-10T10:00:00Z');
    const third = visit('third', '2026-10-10T10:30:00Z', '2026-10-10T11:00:00Z');

    expect(
      tourFeasibilityConflicts(
        [first, second, third],
        [
          { fromVisitId: null, toVisitId: first.id, travelMinutes: 5 },
          { fromVisitId: first.id, toVisitId: second.id, travelMinutes: 25 },
          { fromVisitId: second.id, toVisitId: third.id, travelMinutes: null },
        ],
      ),
    ).toEqual([
      {
        code: 'insufficient_travel_time',
        severity: 'blocking',
        visitId: 'second',
        relatedVisitId: 'first',
        requiredMinutes: 25,
        availableMinutes: 15,
      },
      {
        code: 'travel_feasibility_unknown',
        severity: 'warning',
        visitId: 'third',
        relatedVisitId: 'second',
      },
    ]);
  });

  test('keeps stop ordering deterministic and groups visits by their local operational date', () => {
    const laterId = visit('z', '2026-10-10T08:00:00Z', '2026-10-10T08:30:00Z');
    const earlierId = visit('a', '2026-10-10T08:00:00Z', '2026-10-10T08:30:00Z');
    const overnight = visit('overnight', '2026-10-09T22:30:00Z', '2026-10-09T23:30:00Z');

    expect([laterId, earlierId].sort(compareTourStops).map((item) => item.id)).toEqual(['a', 'z']);
    expect(sameTourDate(overnight, '2026-10-10', 'Europe/Berlin')).toBe(true);
  });
});
