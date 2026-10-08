export interface LocalDayRange {
  date: string;
  from: string;
  until: string;
}

export function todayRange(timezone = 'Europe/Berlin', now = new Date()): LocalDayRange {
  const date = dateKey(now, timezone);
  const nextDate = shiftDateKey(date, 1);
  return {
    date,
    from: localMidnight(date, timezone).toISOString(),
    until: localMidnight(nextDate, timezone).toISOString(),
  };
}

export function dateRange(
  fromDate: string,
  untilDate: string,
  timezone = 'Europe/Berlin',
): LocalDayRange {
  if (!isDateKey(fromDate) || !isDateKey(untilDate) || untilDate < fromDate) {
    throw new TypeError('Invalid local date range');
  }
  return {
    date: fromDate,
    from: localMidnight(fromDate, timezone).toISOString(),
    until: localMidnight(shiftDateKey(untilDate, 1), timezone).toISOString(),
  };
}

export function todayDateKey(timezone = 'Europe/Berlin', now = new Date()): string {
  return dateKey(now, timezone);
}

export function shiftDate(value: string, days: number): string {
  return shiftDateKey(value, days);
}

export function formatVisitTime(value: string, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatVisitDateTime(value: string, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function visitDateTimeInputValue(value: string | Date, timezone: string): string {
  const parts = localParts(value instanceof Date ? value : new Date(value), timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function visitDateTimeFromInput(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const calendar = new Date(target);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  let guess = target;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = localParts(new Date(guess), timezone);
      const represented = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
      );
      const difference = target - represented;
      if (difference === 0) break;
      guess += difference;
    }
    if (visitDateTimeInputValue(new Date(guess), timezone) !== value) return null;
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

function dateKey(value: Date, timezone: string): string {
  const parts = localParts(value, timezone);
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return date.toISOString().slice(0, 10) === value;
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return (
    shifted.getUTCFullYear() +
    '-' +
    String(shifted.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(shifted.getUTCDate()).padStart(2, '0')
  );
}

function localMidnight(date: string, timezone: string): Date {
  const target = new Date(date + 'T00:00:00.000Z').getTime();
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(new Date(guess), timezone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += target - represented;
  }
  return new Date(guess);
}

function localParts(value: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
}
import type { Locale } from '../i18n/config';
