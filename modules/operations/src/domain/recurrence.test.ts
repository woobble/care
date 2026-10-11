import { describe, expect, test } from 'bun:test';
import {
  isValidRecurrenceSchedule,
  nextRecurrenceDate,
  nextRecurrenceOccurrence,
  type RecurrenceSchedule,
} from './recurrence';

function schedule(
  frequency: RecurrenceSchedule['rule']['frequency'],
  startDate: string,
  rule: Partial<RecurrenceSchedule['rule']> = {},
  timeOfDay = '09:00',
  timezone = 'Europe/Berlin',
): RecurrenceSchedule {
  return {
    rule: { frequency, interval: 1, ...rule },
    startDate,
    endDate: null,
    timeOfDay,
    timezone,
  };
}

describe('recurrence schedule', () => {
  test('generates daily and interval schedules from their start date', () => {
    const daily = schedule('daily', '2026-01-01', { interval: 2 });
    expect(nextRecurrenceDate(daily)).toBe('2026-01-01');
    expect(nextRecurrenceDate(daily, '2026-01-01')).toBe('2026-01-03');
    expect(nextRecurrenceDate(daily, '2026-01-04')).toBe('2026-01-05');
  });

  test('supports selected weekdays and week intervals', () => {
    const weekly = schedule('weekly', '2026-01-07', { interval: 2, weekdays: [1, 3, 5] });
    expect(nextRecurrenceDate(weekly)).toBe('2026-01-07');
    expect(nextRecurrenceDate(weekly, '2026-01-07')).toBe('2026-01-09');
    expect(nextRecurrenceDate(weekly, '2026-01-09')).toBe('2026-01-19');
  });

  test('clamps monthly dates to the final day without skipping the month', () => {
    const monthly = schedule('monthly', '2026-01-31', { dayOfMonth: 31 });
    expect(nextRecurrenceDate(monthly)).toBe('2026-01-31');
    expect(nextRecurrenceDate(monthly, '2026-01-31')).toBe('2026-02-28');
    expect(nextRecurrenceDate(monthly, '2026-02-28')).toBe('2026-03-31');
  });

  test('clamps yearly leap day in non-leap years', () => {
    const yearly = schedule('yearly', '2024-02-29', { month: 2, dayOfMonth: 29 });
    expect(nextRecurrenceDate(yearly)).toBe('2024-02-29');
    expect(nextRecurrenceDate(yearly, '2024-02-29')).toBe('2025-02-28');
    expect(nextRecurrenceDate(yearly, '2025-02-28')).toBe('2026-02-28');
  });

  test('honors the end date and validates bounded rule fields', () => {
    const bounded = { ...schedule('daily', '2026-02-01'), endDate: '2026-02-02' };
    expect(nextRecurrenceDate(bounded, '2026-02-02')).toBeNull();
    expect(isValidRecurrenceSchedule(bounded)).toBe(true);
    expect(isValidRecurrenceSchedule(schedule('weekly', '2026-02-01', { weekdays: [1, 1] }))).toBe(
      false,
    );
    expect(isValidRecurrenceSchedule(schedule('daily', '2026-02-30'))).toBe(false);
  });

  test('uses the earlier instant for ambiguous DST time and skips a nonexistent one', () => {
    const repeated = nextRecurrenceOccurrence(
      schedule('daily', '2026-10-25', {}, '02:30', 'Europe/Berlin'),
    );
    expect(repeated?.date).toBe('2026-10-25');
    expect(repeated?.dueAt.toISOString()).toBe('2026-10-25T00:30:00.000Z');

    const missing = nextRecurrenceOccurrence(
      schedule('daily', '2026-03-29', {}, '02:30', 'Europe/Berlin'),
    );
    expect(missing?.date).toBe('2026-03-30');
  });
});
