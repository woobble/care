import { describe, expect, test } from 'bun:test';
import { cadenceDates } from './schedule-generation';
import { localDateTimeInstants, localDateTimeToInstant } from './zoned-time';

describe('agreement cadence planning', () => {
  test('daily, weekly, and interval rules use calendar dates and a stable agreement anchor', () => {
    expect(
      cadenceDates({
        rule: { type: 'daily' },
        from: '2026-10-05',
        until: '2026-10-07',
        anchorDate: '2026-10-05',
      }).dates,
    ).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(
      cadenceDates({
        rule: { type: 'weekly', weekdays: ['monday', 'wednesday'] },
        from: '2026-10-05',
        until: '2026-10-09',
        anchorDate: '2026-10-05',
      }).dates,
    ).toEqual(['2026-10-05', '2026-10-07']);
    expect(
      cadenceDates({
        rule: { type: 'interval_days', intervalDays: 3 },
        from: '2026-10-05',
        until: '2026-10-11',
        anchorDate: '2026-10-06',
      }).dates,
    ).toEqual(['2026-10-06', '2026-10-09']);
  });

  test('occurrences-per-week remains unresolved and on-demand does not auto-generate', () => {
    expect(
      cadenceDates({
        rule: { type: 'occurrences_per_week', count: 2 },
        from: '2026-10-07',
        until: '2026-10-20',
        anchorDate: '2026-10-01',
      }),
    ).toEqual({ dates: [], requiresManualPlacement: 6 });
    expect(
      cadenceDates({
        rule: { type: 'on_demand' },
        from: '2026-10-07',
        until: '2026-10-20',
        anchorDate: '2026-10-01',
      }),
    ).toEqual({ dates: [], requiresManualPlacement: 0 });
  });
});

describe('Europe/Berlin daylight saving time', () => {
  test('the spring-forward gap has no local instant', () => {
    expect(localDateTimeInstants('2026-03-29', '02:30', 'Europe/Berlin')).toEqual([]);
    expect(localDateTimeToInstant('2026-03-29', '02:30', 'Europe/Berlin')).toBeNull();
  });

  test('the fall-back repeated hour has two instants with an explicit earlier default', () => {
    const instants = localDateTimeInstants('2026-10-25', '02:30', 'Europe/Berlin');
    expect(instants.map((instant) => instant.toISOString())).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
    expect(localDateTimeToInstant('2026-10-25', '02:30', 'Europe/Berlin')?.toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(
      localDateTimeToInstant('2026-10-25', '02:30', 'Europe/Berlin', 'later')?.toISOString(),
    ).toBe('2026-10-25T01:30:00.000Z');
  });
});
