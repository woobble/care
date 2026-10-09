import type { Locale } from './config';

export function formatDate(
  value: string | Date | null,
  locale: Locale,
  timeZone = 'UTC',
): string | null {
  if (!value) return null;
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = asDate(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: dateOnly ? 'UTC' : timeZone,
  }).format(date);
}

export function formatDateTime(
  value: string | Date | null,
  locale: Locale,
  timeZone = 'UTC',
): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(asDate(value));
}

export function formatLongDate(value: string | Date, locale: Locale, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone }).format(asDate(value));
}

export function formatTime(value: string | Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(asDate(value));
}

export function formatNumber(value: number | null, locale: Locale): string {
  return value === null
    ? '–'
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatCurrency(value: number, locale: Locale, currency = 'EUR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

function asDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}
