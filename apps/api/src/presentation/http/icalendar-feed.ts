import type { CalendarFeedEvent } from '@care/scheduling';

export function serializeCalendarFeed(events: readonly CalendarFeedEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Care Platform//Caregiver Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    const status = eventStatus(event.status);
    const description =
      event.status === 'cancelled'
        ? 'Cancelled caregiver visit.'
        : `Scheduled caregiver visit. Status: ${event.status}.`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcalendarText(event.uid)}`,
      `DTSTAMP:${formatIcalendarUtc(event.updatedAt)}`,
      `CREATED:${formatIcalendarUtc(event.createdAt)}`,
      `LAST-MODIFIED:${formatIcalendarUtc(event.updatedAt)}`,
      `SEQUENCE:${Math.max(0, event.updatedAt.getTime())}`,
      `DTSTART:${formatIcalendarUtc(event.plannedStart)}`,
      `DTEND:${formatIcalendarUtc(event.plannedEnd)}`,
      `STATUS:${status}`,
      'SUMMARY:Care visit',
      `DESCRIPTION:${escapeIcalendarText(description)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcalendarLine).join('\r\n')}\r\n`;
}

export function escapeIcalendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function foldIcalendarLine(line: string): string {
  let output = '';
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > 75) {
      output += `${current}\r\n`;
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += characterBytes;
  }
  return `${output}${current}`;
}

function formatIcalendarUtc(value: Date): string {
  return value
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function eventStatus(status: CalendarFeedEvent['status']): 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED' {
  if (status === 'confirmed') return 'CONFIRMED';
  if (status === 'cancelled') return 'CANCELLED';
  return 'TENTATIVE';
}
