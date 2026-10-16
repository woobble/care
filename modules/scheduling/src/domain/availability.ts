import { isSupportedTimeZone } from '@care/organizations';

import { localDateTimeToInstant } from './zoned-time';

export type AvailabilityExceptionKind = 'working_hours' | 'closed' | 'unavailable';

export interface AvailabilityWindow {
  weekday: number;
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityException {
  id?: string;
  localDate: string;
  kind: AvailabilityExceptionKind;
  startsAt: string | null;
  endsAt: string | null;
}

export interface EmployeeAvailability {
  timezone: string;
  maxDailyMinutes: number | null;
  travelBufferMinutes: number;
  windows: AvailabilityWindow[];
  exceptions: AvailabilityException[];
}

export type AvailabilityResult = 'available' | 'outside' | 'unknown';

export function validateEmployeeAvailability(value: EmployeeAvailability): void {
  if (
    !isSupportedTimeZone(value.timezone) ||
    (value.maxDailyMinutes !== null &&
      (!Number.isInteger(value.maxDailyMinutes) ||
        value.maxDailyMinutes < 1 ||
        value.maxDailyMinutes > 1440)) ||
    !Number.isInteger(value.travelBufferMinutes) ||
    value.travelBufferMinutes < 0 ||
    value.travelBufferMinutes > 240 ||
    value.windows.some(
      (window) =>
        !Number.isInteger(window.weekday) ||
        window.weekday < 1 ||
        window.weekday > 7 ||
        !validTime(window.startsAt) ||
        !validTime(window.endsAt) ||
        window.startsAt === window.endsAt,
    ) ||
    value.exceptions.some(
      (exception) =>
        !validDate(exception.localDate) ||
        (exception.kind === 'working_hours' &&
          (!validTime(exception.startsAt) ||
            !validTime(exception.endsAt) ||
            exception.startsAt === exception.endsAt)) ||
        (exception.kind === 'closed' &&
          (exception.startsAt !== null || exception.endsAt !== null)) ||
        (exception.kind === 'unavailable' &&
          ((exception.startsAt === null) !== (exception.endsAt === null) ||
            (exception.startsAt !== null &&
              (!validTime(exception.startsAt) ||
                !validTime(exception.endsAt) ||
                exception.startsAt === exception.endsAt)))),
    )
  ) {
    throw new InvalidEmployeeAvailabilityError();
  }

  const keys = new Set<string>();
  for (const window of value.windows) {
    const key = `${window.weekday}:${window.startsAt}:${window.endsAt}`;
    if (keys.has(key)) throw new InvalidEmployeeAvailabilityError();
    keys.add(key);
  }
  keys.clear();
  for (const exception of value.exceptions) {
    const key = `${exception.localDate}:${exception.kind}:${exception.startsAt ?? ''}:${exception.endsAt ?? ''}`;
    if (keys.has(key)) throw new InvalidEmployeeAvailabilityError();
    keys.add(key);
  }
  const exceptionKindsByDate = new Map<string, Set<AvailabilityExceptionKind>>();
  for (const exception of value.exceptions) {
    const kinds =
      exceptionKindsByDate.get(exception.localDate) ?? new Set<AvailabilityExceptionKind>();
    kinds.add(exception.kind);
    exceptionKindsByDate.set(exception.localDate, kinds);
  }
  if (
    [...exceptionKindsByDate.values()].some(
      (kinds) => kinds.has('closed') && kinds.has('working_hours'),
    )
  ) {
    throw new InvalidEmployeeAvailabilityError();
  }
}

export function availabilityForVisit(
  plannedStart: Date,
  plannedEnd: Date,
  availability: EmployeeAvailability | null,
): AvailabilityResult {
  if (!availability) return 'unknown';
  if (
    !Number.isFinite(plannedStart.getTime()) ||
    !Number.isFinite(plannedEnd.getTime()) ||
    plannedEnd <= plannedStart
  ) {
    return 'outside';
  }

  const startDate = localDate(plannedStart, availability.timezone);
  const endDate = localDate(plannedEnd, availability.timezone);
  const dates = datesBetween(addDays(startDate, -1), endDate);

  for (const date of dates) {
    for (const exception of availability.exceptions.filter(
      (candidate) =>
        candidate.localDate === date &&
        (candidate.kind === 'unavailable' || candidate.kind === 'closed'),
    )) {
      const interval = exceptionInterval(exception, availability.timezone);
      if (interval && overlaps(plannedStart, plannedEnd, interval.start, interval.end))
        return 'outside';
    }
  }

  for (const date of dates) {
    const dateExceptions = availability.exceptions.filter(
      (exception) => exception.localDate === date,
    );
    const hasOverride = dateExceptions.some(
      (exception) => exception.kind === 'closed' || exception.kind === 'working_hours',
    );
    const windows = hasOverride
      ? dateExceptions
          .filter(
            (
              exception,
            ): exception is AvailabilityException & { startsAt: string; endsAt: string } =>
              exception.kind === 'working_hours',
          )
          .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))
      : availability.windows
          .filter((window) => window.weekday === isoWeekday(date))
          .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));

    for (const window of windows) {
      const interval = windowInterval(date, window.startsAt, window.endsAt, availability.timezone);
      if (interval && plannedStart >= interval.start && plannedEnd <= interval.end)
        return 'available';
    }
  }

  return 'outside';
}

export class InvalidEmployeeAvailabilityError extends Error {
  readonly code = 'EMPLOYEE_AVAILABILITY_INVALID';

  constructor() {
    super('Employee availability settings are invalid');
    this.name = 'InvalidEmployeeAvailabilityError';
  }
}

function windowInterval(
  date: string,
  startsAt: string,
  endsAt: string,
  timezone: string,
): { start: Date; end: Date } | null {
  const endDate = endsAt <= startsAt ? addDays(date, 1) : date;
  const start = localDateTimeToInstant(date, startsAt, timezone, 'earlier');
  const end = localDateTimeToInstant(endDate, endsAt, timezone, 'later');
  return start && end && end > start ? { start, end } : null;
}

function exceptionInterval(
  exception: AvailabilityException,
  timezone: string,
): { start: Date; end: Date } | null {
  if (exception.startsAt === null || exception.endsAt === null) {
    const start = localDateTimeToInstant(exception.localDate, '00:00', timezone, 'earlier');
    const end = localDateTimeToInstant(addDays(exception.localDate, 1), '00:00', timezone, 'later');
    return start && end ? { start, end } : null;
  }
  return windowInterval(exception.localDate, exception.startsAt, exception.endsAt, timezone);
}

function localDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function datesBetween(from: string, until: string): string[] {
  const result: string[] = [];
  for (let date = from; date <= until; date = addDays(date, 1)) result.push(date);
  return result;
}

function validTime(value: string | null): value is string {
  return value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function overlaps(start: Date, end: Date, otherStart: Date, otherEnd: Date): boolean {
  return start < otherEnd && end > otherStart;
}
