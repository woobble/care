import { describe, expect, test } from 'bun:test';
import ICAL from 'ical.js';

import type { CalendarFeedEvent } from '@care/scheduling';

import { escapeIcalendarText, foldIcalendarLine, serializeCalendarFeed } from './icalendar-feed';

const event: CalendarFeedEvent = {
  uid: '019a0b6e-2f05-7b52-a76a-0800f1e670d0@calendar.care-platform.invalid',
  status: 'confirmed',
  plannedStart: new Date('2026-10-19T08:00:00.000Z'),
  plannedEnd: new Date('2026-10-19T09:00:00.000Z'),
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  updatedAt: new Date('2026-10-12T10:30:00.000Z'),
};

describe('caregiver iCalendar feed', () => {
  test('serializes RFC 5545 timestamps and stable event metadata accepted by ical.js', () => {
    const feed = serializeCalendarFeed([event]);
    const calendar = new ICAL.Component(ICAL.parse(feed));
    const components = calendar.getAllSubcomponents('vevent');
    expect(components).toHaveLength(1);

    const parsed = new ICAL.Event(components[0]!);
    expect(parsed.uid).toBe(event.uid);
    expect(parsed.summary).toBe('Care visit');
    expect(parsed.startDate.toJSDate().toISOString()).toBe(event.plannedStart.toISOString());
    expect(parsed.endDate.toJSDate().toISOString()).toBe(event.plannedEnd.toISOString());
    expect(Number(parsed.component.getFirstPropertyValue('sequence'))).toBe(
      event.updatedAt.getTime(),
    );
    expect(feed).toContain('LAST-MODIFIED:20261012T103000Z');
    expect(feed).toContain('METHOD:PUBLISH\r\n');
    expect(feed).toEndWith('END:VCALENDAR\r\n');
  });

  test('publishes cancellation state for the same UID', () => {
    const feed = serializeCalendarFeed([{ ...event, status: 'cancelled' }]);
    const calendar = new ICAL.Component(ICAL.parse(feed));
    const parsed = new ICAL.Event(calendar.getAllSubcomponents('vevent')[0]!);
    expect(parsed.uid).toBe(event.uid);
    expect(parsed.component.getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(parsed.description).toBe('Cancelled caregiver visit.');
  });

  test('escapes RFC 5545 text and folds UTF-8 lines at 75 octets', () => {
    expect(escapeIcalendarText('A,B; C\\D\nE')).toBe('A\\,B\\; C\\\\D\\nE');
    const folded = foldIcalendarLine(`DESCRIPTION:${'ä'.repeat(80)}`);
    for (const line of folded.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((line) => line.startsWith(' ')),
    ).toBe(true);
  });
});
