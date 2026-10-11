import { isTimeZone, localDateTimeToInstant } from '@care/scheduling';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: number[];
  dayOfMonth?: number;
  month?: number;
}

export interface RecurrenceSchedule {
  rule: RecurrenceRule;
  timezone: string;
  startDate: string;
  endDate: string | null;
  timeOfDay: string;
}

export interface RecurrenceOccurrence {
  date: string;
  dueAt: Date;
}

export function isValidRecurrenceSchedule(schedule: RecurrenceSchedule): boolean {
  const { rule } = schedule;
  if (
    !isDate(schedule.startDate) ||
    (schedule.endDate !== null &&
      (!isDate(schedule.endDate) || schedule.endDate < schedule.startDate)) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.timeOfDay) ||
    !isTimeZone(schedule.timezone) ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 365
  ) {
    return false;
  }

  switch (rule.frequency) {
    case 'daily':
      return (
        rule.weekdays === undefined && rule.dayOfMonth === undefined && rule.month === undefined
      );
    case 'weekly':
      return (
        rule.dayOfMonth === undefined &&
        rule.month === undefined &&
        (rule.weekdays === undefined ||
          (rule.weekdays.length > 0 &&
            new Set(rule.weekdays).size === rule.weekdays.length &&
            rule.weekdays.every(
              (weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7,
            )))
      );
    case 'monthly':
      return (
        rule.weekdays === undefined &&
        rule.month === undefined &&
        (rule.dayOfMonth === undefined ||
          (Number.isInteger(rule.dayOfMonth) && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31))
      );
    case 'yearly':
      return (
        rule.weekdays === undefined &&
        (rule.month === undefined ||
          (Number.isInteger(rule.month) && rule.month >= 1 && rule.month <= 12)) &&
        (rule.dayOfMonth === undefined ||
          (Number.isInteger(rule.dayOfMonth) && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31))
      );
  }
}

/** Returns the first scheduled local date on or after startDate, or strictly after afterDate. */
export function nextRecurrenceDate(
  schedule: RecurrenceSchedule,
  afterDate?: string,
): string | null {
  if (!isValidRecurrenceSchedule(schedule) || (afterDate !== undefined && !isDate(afterDate)))
    return null;
  const start = schedule.startDate;
  const nextDay = afterDate ? addDays(afterDate, 1) : start;
  const minimum = nextDay < start ? start : nextDay;
  if (schedule.endDate !== null && minimum > schedule.endDate) return null;

  let candidate: string;
  switch (schedule.rule.frequency) {
    case 'daily':
      candidate = dailyCandidate(schedule, minimum);
      break;
    case 'weekly':
      candidate = weeklyCandidate(schedule, minimum);
      break;
    case 'monthly':
      candidate = monthlyCandidate(schedule, minimum);
      break;
    case 'yearly':
      candidate = yearlyCandidate(schedule, minimum);
      break;
  }
  return schedule.endDate !== null && candidate > schedule.endDate ? null : candidate;
}

/**
 * Resolves the next valid wall-clock occurrence. Ambiguous fall-back times use the earlier
 * instant; nonexistent spring-forward times are skipped and the next scheduled date is used.
 */
export function nextRecurrenceOccurrence(
  schedule: RecurrenceSchedule,
  afterDate?: string,
): RecurrenceOccurrence | null {
  let cursor = afterDate;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const date = nextRecurrenceDate(schedule, cursor);
    if (!date) return null;
    const dueAt = localDateTimeToInstant(date, schedule.timeOfDay, schedule.timezone, 'earlier');
    if (dueAt) return { date, dueAt };
    cursor = date;
  }
  return null;
}

export function recurrenceOccurrenceAt(
  schedule: RecurrenceSchedule,
  date: string,
): RecurrenceOccurrence | null {
  const previousDate = addDays(date, -1);
  const next = nextRecurrenceOccurrence(schedule, previousDate);
  return next?.date === date ? next : null;
}

function dailyCandidate(schedule: RecurrenceSchedule, minimum: string): string {
  const elapsed = daysBetween(schedule.startDate, minimum);
  const periods = Math.ceil(elapsed / schedule.rule.interval);
  return addDays(schedule.startDate, periods * schedule.rule.interval);
}

function weeklyCandidate(schedule: RecurrenceSchedule, minimum: string): string {
  const weekdays = [...(schedule.rule.weekdays ?? [isoWeekday(schedule.startDate)])].sort(
    (left, right) => left - right,
  );
  const anchorMonday = addDays(schedule.startDate, 1 - isoWeekday(schedule.startDate));
  let weekIndex = Math.max(
    0,
    Math.floor(daysBetween(anchorMonday, minimum) / 7 / schedule.rule.interval),
  );
  for (let search = 0; search < 3; search += 1, weekIndex += 1) {
    const weekStart = addDays(anchorMonday, weekIndex * schedule.rule.interval * 7);
    for (const weekday of weekdays) {
      const candidate = addDays(weekStart, weekday - 1);
      if (candidate >= schedule.startDate && candidate >= minimum) return candidate;
    }
  }
  throw new RangeError('Could not calculate the next weekly occurrence');
}

function monthlyCandidate(schedule: RecurrenceSchedule, minimum: string): string {
  const startMonth = monthIndex(schedule.startDate);
  const minimumMonth = monthIndex(minimum);
  const interval = schedule.rule.interval;
  let periods = Math.max(0, Math.ceil((minimumMonth - startMonth) / interval));
  for (let search = 0; search < 2; search += 1, periods += 1) {
    const index = startMonth + periods * interval;
    const [year, month] = yearMonth(index);
    const day = Math.min(
      schedule.rule.dayOfMonth ?? dayOfMonth(schedule.startDate),
      daysInMonth(year, month),
    );
    const candidate = formatDate(year, month, day);
    if (candidate >= schedule.startDate && candidate >= minimum) return candidate;
  }
  throw new RangeError('Could not calculate the next monthly occurrence');
}

function yearlyCandidate(schedule: RecurrenceSchedule, minimum: string): string {
  const startYear = yearOf(schedule.startDate);
  const interval = schedule.rule.interval;
  let periods = Math.max(0, Math.ceil((yearOf(minimum) - startYear) / interval));
  const month = schedule.rule.month ?? monthOf(schedule.startDate);
  const dayOfMonthValue = schedule.rule.dayOfMonth ?? dayOfMonth(schedule.startDate);
  for (let search = 0; search < 2; search += 1, periods += 1) {
    const year = startYear + periods * interval;
    const day = Math.min(dayOfMonthValue, daysInMonth(year, month));
    const candidate = formatDate(year, month, day);
    if (candidate >= schedule.startDate && candidate >= minimum) return candidate;
  }
  throw new RangeError('Could not calculate the next yearly occurrence');
}

function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  return (
    (Date.UTC(toYear!, toMonth! - 1, toDay!) - Date.UTC(fromYear!, fromMonth! - 1, fromDay!)) /
    86_400_000
  );
}

function isoWeekday(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function monthIndex(value: string): number {
  return yearOf(value) * 12 + monthOf(value) - 1;
}

function yearMonth(index: number): [number, number] {
  return [Math.floor(index / 12), (index % 12) + 1];
}

function yearOf(value: string): number {
  return Number(value.slice(0, 4));
}

function monthOf(value: string): number {
  return Number(value.slice(5, 7));
}

function dayOfMonth(value: string): number {
  return Number(value.slice(8, 10));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
