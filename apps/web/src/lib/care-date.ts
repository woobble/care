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

export function formatVisitTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatVisitDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function dateKey(value: Date, timezone: string): string {
  const parts = localParts(value, timezone);
  return parts.year + '-' + parts.month + '-' + parts.day;
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
