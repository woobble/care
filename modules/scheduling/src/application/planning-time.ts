export function validLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dayDistance(from: string, until: string): number {
  return (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function dateInTimeZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDates(from: string, until: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= until; date = addCalendarDate(date, 1)) dates.push(date);
  return dates;
}
