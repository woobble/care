type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function localDateTimeInstants(date: string, time: string, timeZone: string): Date[] {
  const parsed = parseLocalDateTime(date, time);
  const formatter = formatterFor(timeZone);
  const wallClock = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute);
  const offsets = new Set<number>();

  for (let delta = -36; delta <= 36; delta += 3) {
    const instant = new Date(wallClock + delta * 60 * 60 * 1000);
    const parts = zonedParts(formatter, instant);
    offsets.add(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
        instant.getTime(),
    );
  }

  return [...offsets]
    .map((offset) => new Date(wallClock - offset))
    .filter((instant) => sameLocalDateTime(zonedParts(formatter, instant), parsed))
    .sort((left, right) => left.getTime() - right.getTime());
}

export function localDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
  ambiguity: 'earlier' | 'later' = 'earlier',
): Date | null {
  const values = localDateTimeInstants(date, time, timeZone);
  if (values.length === 0) return null;
  return ambiguity === 'earlier' ? values[0]! : values.at(-1)!;
}

export function isTimeZone(value: string): boolean {
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

function parseLocalDateTime(date: string, time: string): LocalDateTime {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dateMatch || !timeMatch) throw new RangeError('Invalid local date or time');
  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const dateCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    dateCheck.getUTCFullYear() !== parts.year ||
    dateCheck.getUTCMonth() + 1 !== parts.month ||
    dateCheck.getUTCDate() !== parts.day
  ) {
    throw new RangeError('Invalid local date');
  }
  formatterFor('UTC');
  return parts;
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatter.format(0);
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function zonedParts(formatter: Intl.DateTimeFormat, instant: Date): LocalDateTime {
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}
