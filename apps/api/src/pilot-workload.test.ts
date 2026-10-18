import { describe, expect, test } from 'bun:test';

import { selectDailyPilotWorkload, type PilotWorkloadVisit } from './pilot-workload';

const visits: PilotWorkloadVisit[] = [
  {
    id: 'mon-1',
    localDate: '2026-09-14',
    plannedStart: new Date('2026-09-14T08:00:00Z'),
    employeeId: 'a',
  },
  {
    id: 'mon-2',
    localDate: '2026-09-14',
    plannedStart: new Date('2026-09-14T09:00:00Z'),
    employeeId: 'b',
  },
  {
    id: 'mon-3',
    localDate: '2026-09-14',
    plannedStart: new Date('2026-09-14T10:00:00Z'),
    employeeId: 'c',
  },
  {
    id: 'mon-4',
    localDate: '2026-09-14',
    plannedStart: new Date('2026-09-14T11:00:00Z'),
    employeeId: 'a',
  },
  {
    id: 'tue-1',
    localDate: '2026-09-15',
    plannedStart: new Date('2026-09-15T08:00:00Z'),
    employeeId: 'a',
  },
  {
    id: 'tue-2',
    localDate: '2026-09-15',
    plannedStart: new Date('2026-09-15T09:00:00Z'),
    employeeId: 'b',
  },
  {
    id: 'tue-3',
    localDate: '2026-09-15',
    plannedStart: new Date('2026-09-15T10:00:00Z'),
    employeeId: 'c',
  },
];

describe('daily synthetic pilot workload selection', () => {
  test('selects the requested daily count and spreads visits across caregivers', () => {
    const selected = selectDailyPilotWorkload({ visits, visitsPerWorkday: 3 });

    expect(selected).toHaveLength(6);
    expect(selected.map((visit) => visit.id)).toEqual([
      'mon-1',
      'mon-2',
      'mon-3',
      'tue-1',
      'tue-2',
      'tue-3',
    ]);
    expect(new Set(selected.slice(0, 3).map((visit) => visit.employeeId))).toHaveLength(3);
    expect(new Set(selected.slice(3).map((visit) => visit.employeeId))).toHaveLength(3);
  });

  test('keeps the existing financial visit in the selected workload', () => {
    const selected = selectDailyPilotWorkload({
      visits,
      visitsPerWorkday: 3,
      preferredVisitId: 'mon-4',
    });

    expect(selected.map((visit) => visit.id)).toContain('mon-4');
    expect(selected.filter((visit) => visit.localDate === '2026-09-14')).toHaveLength(3);
  });

  test('fails before execution when a retrospective day cannot meet the requested density', () => {
    expect(() =>
      selectDailyPilotWorkload({
        visits: visits.slice(0, 2),
        visitsPerWorkday: 3,
        requireTargetPerWorkday: true,
      }),
    ).toThrow('2026-09-14 has 2 ended visits; 3 are required');
  });

  test('rejects unavailable financial visits, duplicate rows, and invalid density', () => {
    expect(() =>
      selectDailyPilotWorkload({ visits, visitsPerWorkday: 3, preferredVisitId: 'missing' }),
    ).toThrow('Preferred pilot workload visit missing is unavailable');
    expect(() =>
      selectDailyPilotWorkload({ visits: [visits[0]!, visits[0]!], visitsPerWorkday: 3 }),
    ).toThrow('Duplicate pilot workload visit mon-1');
    expect(() => selectDailyPilotWorkload({ visits, visitsPerWorkday: 7 })).toThrow(
      'between 2 and 6 visits per workday',
    );
  });
});
