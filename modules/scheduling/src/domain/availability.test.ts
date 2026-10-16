import { describe, expect, test } from 'bun:test';

import {
  availabilityForVisit,
  validateEmployeeAvailability,
  InvalidEmployeeAvailabilityError,
} from './availability';

describe('employee availability', () => {
  const availability = {
    timezone: 'Europe/Berlin',
    maxDailyMinutes: 420,
    travelBufferMinutes: 15,
    windows: [{ weekday: 1, startsAt: '08:00', endsAt: '16:00' }],
    exceptions: [],
  };

  test('checks local weekly hours against unambiguous visit instants', () => {
    expect(
      availabilityForVisit(
        new Date('2026-10-12T07:00:00.000Z'),
        new Date('2026-10-12T08:00:00.000Z'),
        availability,
      ),
    ).toBe('available');
    expect(
      availabilityForVisit(
        new Date('2026-10-12T14:30:00.000Z'),
        new Date('2026-10-12T15:30:00.000Z'),
        availability,
      ),
    ).toBe('outside');
  });

  test('supports overnight windows and date-specific working hours', () => {
    const overnight = {
      ...availability,
      windows: [{ weekday: 1, startsAt: '22:00', endsAt: '02:00' }],
    };
    expect(
      availabilityForVisit(
        new Date('2026-10-12T21:30:00.000Z'),
        new Date('2026-10-12T22:30:00.000Z'),
        overnight,
      ),
    ).toBe('available');

    const exception = {
      ...availability,
      exceptions: [
        {
          localDate: '2026-10-12',
          kind: 'working_hours' as const,
          startsAt: '10:00',
          endsAt: '12:00',
        },
      ],
    };
    expect(
      availabilityForVisit(
        new Date('2026-10-12T07:30:00.000Z'),
        new Date('2026-10-12T08:30:00.000Z'),
        exception,
      ),
    ).toBe('outside');
    expect(
      availabilityForVisit(
        new Date('2026-10-12T08:30:00.000Z'),
        new Date('2026-10-12T09:30:00.000Z'),
        {
          ...exception,
          exceptions: [{ localDate: '2026-10-12', kind: 'closed', startsAt: null, endsAt: null }],
        },
      ),
    ).toBe('outside');
  });

  test('treats unconfigured availability as unknown and absence exceptions as blocking', () => {
    expect(
      availabilityForVisit(
        new Date('2026-10-12T07:00:00Z'),
        new Date('2026-10-12T08:00:00Z'),
        null,
      ),
    ).toBe('unknown');
    const absent = {
      ...availability,
      exceptions: [
        {
          localDate: '2026-10-12',
          kind: 'unavailable' as const,
          startsAt: '09:00',
          endsAt: '11:00',
        },
      ],
    };
    expect(
      availabilityForVisit(
        new Date('2026-10-12T08:30:00.000Z'),
        new Date('2026-10-12T09:30:00.000Z'),
        absent,
      ),
    ).toBe('outside');
  });

  test('rejects invalid time zones, windows, and duplicate windows', () => {
    expect(() =>
      validateEmployeeAvailability({ ...availability, timezone: 'Mars/Olympus' }),
    ).toThrow(InvalidEmployeeAvailabilityError);
    expect(() =>
      validateEmployeeAvailability({
        ...availability,
        windows: [{ weekday: 8, startsAt: '08:00', endsAt: '16:00' }],
      }),
    ).toThrow(InvalidEmployeeAvailabilityError);
    expect(() =>
      validateEmployeeAvailability({
        ...availability,
        windows: [...availability.windows, ...availability.windows],
      }),
    ).toThrow(InvalidEmployeeAvailabilityError);
  });
});
