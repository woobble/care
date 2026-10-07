import type { AgreementServiceScheduleRule } from '@care/service-agreements';
import type { Weekday } from '@care/service-agreements';

export interface CadenceDates {
  dates: string[];
  requiresManualPlacement: number;
}

const weekdayByNumber: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function cadenceDates(input: {
  rule: AgreementServiceScheduleRule | null;
  from: string;
  until: string;
  anchorDate: string;
}): CadenceDates {
  validateDate(input.from);
  validateDate(input.until);
  validateDate(input.anchorDate);
  if (input.until < input.from) throw new InvalidScheduleGenerationRangeError();
  if (!input.rule || input.rule.type === 'on_demand') {
    return { dates: [], requiresManualPlacement: 0 };
  }
  if (input.rule.type === 'occurrences_per_week') {
    if (!Number.isInteger(input.rule.count) || input.rule.count < 1 || input.rule.count > 14) {
      throw new InvalidScheduleRuleError();
    }
    return {
      dates: [],
      requiresManualPlacement: input.rule.count * intersectingIsoWeeks(input.from, input.until),
    };
  }

  const dates: string[] = [];
  const anchor = toUtcDay(input.anchorDate);
  for (let day = toUtcDay(input.from); day <= toUtcDay(input.until); day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    const weekday = weekdayByNumber[new Date(day).getUTCDay()];
    if (input.rule.type === 'daily') dates.push(date);
    else if (input.rule.type === 'weekly' && input.rule.weekdays.includes(weekday!))
      dates.push(date);
    else if (
      input.rule.type === 'interval_days' &&
      Number.isInteger(input.rule.intervalDays) &&
      input.rule.intervalDays >= 1 &&
      Math.floor((day - anchor) / DAY_MS) % input.rule.intervalDays === 0
    ) {
      dates.push(date);
    } else if (
      input.rule.type === 'interval_days' &&
      (!Number.isInteger(input.rule.intervalDays) ||
        input.rule.intervalDays < 1 ||
        input.rule.intervalDays > 365)
    ) {
      throw new InvalidScheduleRuleError();
    } else if (input.rule.type === 'weekly' && input.rule.weekdays.length === 0) {
      throw new InvalidScheduleRuleError();
    }
  }
  return { dates, requiresManualPlacement: 0 };
}

function intersectingIsoWeeks(from: string, until: string): number {
  const first = toUtcDay(from);
  const last = toUtcDay(until);
  const firstWeek = mondayOfUtcWeek(first);
  const lastWeek = mondayOfUtcWeek(last);
  return Math.floor((lastWeek - firstWeek) / (7 * DAY_MS)) + 1;
}

function mondayOfUtcWeek(day: number): number {
  const weekday = new Date(day).getUTCDay();
  return day - ((weekday + 6) % 7) * DAY_MS;
}

function validateDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new InvalidScheduleGenerationRangeError();
  }
}

function toUtcDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class InvalidScheduleGenerationRangeError extends Error {
  readonly code = 'SCHEDULE_GENERATION_INVALID_RANGE';
  constructor() {
    super('Schedule generation date range is invalid');
    this.name = 'InvalidScheduleGenerationRangeError';
  }
}

export class InvalidScheduleRuleError extends Error {
  readonly code = 'SCHEDULE_GENERATION_INVALID_RULE';
  constructor() {
    super('Agreement schedule rule is invalid');
    this.name = 'InvalidScheduleRuleError';
  }
}
