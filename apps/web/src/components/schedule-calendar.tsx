'use client';

import { dateFnsLocalizer, Calendar } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import type { DateHeaderProps, EventProps, View } from 'react-big-calendar';
import { enUS } from 'date-fns/locale/en-US';
import { de } from 'date-fns/locale/de';
import { format, getDay, parse, startOfWeek } from 'date-fns';
import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { 'en-US': enUS, 'de-DE': de },
});
const DragAndDropCalendar = withDragAndDrop<CalendarEvent, CalendarResource>(Calendar);
const emptyBackgroundEvents: ScheduleCalendarBackgroundEventInput[] = [];
const monthHeaderContext = createContext<{
  counts: Map<string, number>;
  labels: { one: string; other: string };
  locale: 'en' | 'de';
} | null>(null);

export type ScheduleCalendarView = 'month' | 'week' | 'day' | 'agenda';

export type ScheduleCalendarEventInput = {
  id: string;
  clientName: string;
  serviceNames: string[];
  employeeNames: string[];
  resourceIds: string[];
  start: string;
  end: string;
  timezone: string;
  status: string;
  statusLabel: string;
  detail: string;
  href: string;
  tourLabel?: string;
  conflictLabels?: string[];
  protectedFromReschedule?: boolean;
  backgroundKind?: 'working' | 'unavailable' | 'absence';
};

export type ScheduleCalendarBackgroundEventInput = {
  id: string;
  start: string;
  end: string;
  resourceId: string;
  resourceName: string;
  label: string;
  kind: 'working' | 'unavailable' | 'absence';
};

type CalendarEvent = Omit<ScheduleCalendarEventInput, 'start' | 'end'> & {
  start: Date;
  end: Date;
  resourceIds: string[];
  draggable: boolean;
};

type CalendarResource = { id: string; title: string };

export function ScheduleCalendarNavigation({
  date,
  view,
  locale,
  timezone = 'Europe/Berlin',
  labels,
}: Readonly<{
  date: string;
  view: ScheduleCalendarView;
  locale: 'en' | 'de';
  timezone?: string;
  labels: {
    month: string;
    week: string;
    day: string;
    agenda: string;
    previous: string;
    next: string;
    today: string;
    date: string;
    goToDate: string;
    calendarNavigation: string;
  };
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const title = getRangeTitle(date, view, locale);

  useEffect(() => {
    if (searchParams.has('view') || view !== 'week') return;
    if (!window.matchMedia('(max-width: 639px)').matches) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', date);
    params.set('view', 'agenda');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [date, pathname, router, searchParams, view]);

  function updateUrl(nextDate: string, nextView = view) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', nextDate);
    params.set('view', nextView);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <section
      aria-label={labels.calendarNavigation}
      className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => updateUrl(shiftDate(date, view, -1))}
        >
          {labels.previous}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => updateUrl(todayInTimezone(timezone))}
        >
          {labels.today}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => updateUrl(shiftDate(date, view, 1))}
        >
          {labels.next}
        </Button>
      </div>
      <h2 className="text-center text-lg font-semibold" aria-live="polite">
        {title}
      </h2>
      <div className="flex flex-wrap items-end justify-start gap-2 sm:justify-end">
        <div className="grid gap-1">
          <Label htmlFor="schedule-calendar-date">{labels.date}</Label>
          <Input
            id="schedule-calendar-date"
            type="date"
            value={date}
            onChange={(event) => {
              if (event.currentTarget.value) updateUrl(event.currentTarget.value);
            }}
            className="min-h-10 w-40"
          />
        </div>
      </div>
      <div
        className="flex flex-wrap gap-1 sm:col-span-3"
        role="group"
        aria-label={labels.calendarNavigation}
      >
        {(['month', 'week', 'day', 'agenda'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={view === option ? 'default' : 'secondary'}
            aria-pressed={view === option}
            onClick={() => updateUrl(date, option)}
          >
            {labels[option]}
          </Button>
        ))}
      </div>
    </section>
  );
}

export function ScheduleCalendarGrid({
  events,
  backgroundEvents = emptyBackgroundEvents,
  monthCountLabels,
  date,
  view,
  timezone,
  locale,
  emptyLabel,
  createVisitLabel,
  rescheduleErrorLabel,
  canReschedule = false,
  rescheduleAction,
}: Readonly<{
  events: ScheduleCalendarEventInput[];
  backgroundEvents?: ScheduleCalendarBackgroundEventInput[];
  monthCountLabels: { one: string; other: string };
  date: string;
  view: Exclude<ScheduleCalendarView, 'agenda'>;
  timezone: string;
  locale: 'en' | 'de';
  emptyLabel: string;
  createVisitLabel?: string;
  rescheduleErrorLabel: string;
  canReschedule?: boolean;
  rescheduleAction?: (formData: FormData) => Promise<{ ok: boolean; errorCode?: string }>;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingMoves, setPendingMoves] = useState<Record<string, { start: Date; end: Date }>>({});
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const showResourceColumns = useSyncExternalStore(
    subscribeToResourceColumnMedia,
    getResourceColumnMediaSnapshot,
    () => false,
  );

  const calendarEvents = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        start: pendingMoves[event.id]?.start ?? toCalendarDate(event.start, timezone),
        end: pendingMoves[event.id]?.end ?? toCalendarDate(event.end, timezone),
        resourceIds: event.resourceIds.length ? event.resourceIds : ['unassigned'],
        draggable: canReschedule && !event.protectedFromReschedule && event.status !== 'cancelled',
      })),
    [canReschedule, events, pendingMoves, timezone],
  );

  const calendarBackgroundEvents = useMemo<CalendarEvent[]>(
    () =>
      backgroundEvents.map((event) => ({
        id: event.id,
        clientName: event.label,
        serviceNames: [],
        employeeNames: [event.resourceName],
        resourceIds: [event.resourceId],
        start: toCalendarDate(event.start, timezone),
        end: toCalendarDate(event.end, timezone),
        timezone,
        status: 'background',
        statusLabel: event.label,
        detail: event.label,
        href: '',
        backgroundKind: event.kind,
        draggable: false,
      })),
    [backgroundEvents, timezone],
  );

  const resources = useMemo(() => {
    const values = new Map<string, CalendarResource>();
    for (const event of [...events, ...calendarBackgroundEvents]) {
      if (event.resourceIds.length) {
        event.resourceIds.forEach((id, index) => {
          values.set(id, { id, title: event.employeeNames[index] ?? event.employeeNames[0] ?? '' });
        });
      } else {
        values.set('unassigned', { id: 'unassigned', title: emptyLabel });
      }
    }
    return [...values.values()].sort((left, right) =>
      left.title.localeCompare(right.title, locale),
    );
  }, [calendarBackgroundEvents, emptyLabel, events, locale]);

  const monthHeaderValue = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of calendarEvents) {
      const key = dateKey(event.start);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { counts, labels: monthCountLabels, locale };
  }, [calendarEvents, locale, monthCountLabels]);

  function openSlot(start: Date, end: Date) {
    if (!createVisitLabel) return;
    const params = new URLSearchParams(searchParams.toString());
    const localDate = dateKey(start);
    params.set('date', localDate);
    params.set('view', 'day');
    params.set('createStart', format(start, 'HH:mm'));
    params.set(
      'createEnd',
      format(
        end.getTime() > start.getTime() ? end : new Date(start.getTime() + 30 * 60_000),
        'HH:mm',
      ),
    );
    params.set('createVisit', '1');
    params.delete('page');
    router.push(`${pathname}?${params.toString()}#create-visit`, { scroll: true });
  }

  async function persistMove(event: CalendarEvent, start: Date, end: Date) {
    if (!rescheduleAction) return;
    const previous = {
      start: event.start,
      end: event.end,
    };
    setRescheduleError(null);
    setPendingMoves((current) => ({ ...current, [event.id]: { start, end } }));
    const formData = new FormData();
    formData.set('visitId', event.id);
    formData.set('localDate', dateKey(start));
    formData.set('localStartTime', format(start, 'HH:mm'));
    formData.set('localEndTime', format(end, 'HH:mm'));
    const result = await rescheduleAction(formData);
    if (!result.ok) {
      setPendingMoves((current) => ({ ...current, [event.id]: previous }));
      setRescheduleError(result.errorCode ?? 'UNKNOWN');
      return;
    }
    setPendingMoves((current) => {
      const next = { ...current };
      delete next[event.id];
      return next;
    });
    router.refresh();
  }

  const displayedView: View = view;
  const messages = locale === 'de' ? { showMore: (total: number) => `+${total} weitere` } : {};

  return (
    <div className="grid min-w-0 gap-3">
      {rescheduleError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {rescheduleErrorLabel}
        </p>
      ) : null}
      <div className="care-calendar min-w-0 rounded-xl border border-border bg-card p-2 sm:p-3">
        <monthHeaderContext.Provider value={monthHeaderValue}>
          <DragAndDropCalendar
            localizer={localizer}
            culture={locale === 'de' ? 'de-DE' : 'en-US'}
            date={dateAtNoon(date)}
            getNow={() => toCalendarDate(new Date().toISOString(), timezone)}
            view={displayedView}
            events={calendarEvents}
            backgroundEvents={calendarBackgroundEvents}
            views={['month', 'week', 'day']}
            toolbar={false}
            popup
            selectable={Boolean(createVisitLabel)}
            longPressThreshold={180}
            onSelectSlot={({ start, end }) => openSlot(start as Date, end as Date)}
            onNavigate={(nextDate) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('date', dateKey(nextDate));
              params.delete('page');
              router.push(`${pathname}?${params.toString()}`, { scroll: false });
            }}
            onView={(nextView) => {
              if (nextView === 'month' || nextView === 'week' || nextView === 'day') {
                const params = new URLSearchParams(searchParams.toString());
                params.set('view', nextView);
                router.push(`${pathname}?${params.toString()}`, { scroll: false });
              }
            }}
            onEventDrop={({ event, start, end }) => {
              const moved = event as CalendarEvent;
              if (moved.draggable && start instanceof Date && end instanceof Date)
                void persistMove(moved, start, end);
            }}
            onEventResize={({ event, start, end }) => {
              const moved = event as CalendarEvent;
              if (moved.draggable && start instanceof Date && end instanceof Date)
                void persistMove(moved, start, end);
            }}
            draggableAccessor={(event) => Boolean((event as CalendarEvent).draggable)}
            resizable={canReschedule}
            resizableAccessor={(event) => Boolean((event as CalendarEvent).draggable)}
            resources={view === 'day' && showResourceColumns ? resources : undefined}
            resourceIdAccessor="id"
            resourceTitleAccessor="title"
            resourceAccessor={(event) => (event as CalendarEvent).resourceIds}
            startAccessor="start"
            endAccessor="end"
            titleAccessor="clientName"
            tooltipAccessor="detail"
            step={15}
            timeslots={4}
            min={timeAt(6, 0)}
            max={timeAt(23, 0)}
            scrollToTime={timeAt(7, 0)}
            components={{ event: CalendarEventCard, month: { dateHeader: MonthDateHeader } }}
            eventPropGetter={(event) => ({
              className: event.backgroundKind
                ? `care-calendar-background care-calendar-background-${event.backgroundKind}`
                : `care-calendar-event care-calendar-event-${event.status}`,
            })}
            messages={messages}
            style={{ height: view === 'month' ? 'min(70vh, 760px)' : 'min(78vh, 900px)' }}
          />
        </monthHeaderContext.Provider>
      </div>
      {!calendarEvents.length ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : null}
    </div>
  );
}

function CalendarEventCard({ event }: EventProps<CalendarEvent>) {
  if (event.backgroundKind) {
    return <span className="care-calendar-background-label">{event.statusLabel}</span>;
  }
  return (
    <Link
      id={`visit-${event.id}`}
      href={event.href}
      aria-label={event.detail}
      className="care-calendar-event-content"
    >
      <span className="care-calendar-event-time">
        {format(event.start, 'HH:mm')}–{format(event.end, 'HH:mm')}
      </span>
      <strong className="care-calendar-event-client">{event.clientName}</strong>
      {event.serviceNames.length ? (
        <span className="care-calendar-event-services">{event.serviceNames.join(' · ')}</span>
      ) : null}
      {event.conflictLabels?.[0] ? (
        <span className="care-calendar-event-conflict">{event.conflictLabels[0]}</span>
      ) : null}
      {event.tourLabel ? <span className="care-calendar-event-tour">{event.tourLabel}</span> : null}
      <span className="care-calendar-event-status">{event.statusLabel}</span>
    </Link>
  );
}

function MonthDateHeader({ date: headerDate, label, onDrillDown }: DateHeaderProps) {
  const context = useContext(monthHeaderContext);
  const count = context?.counts.get(dateKey(headerDate)) ?? 0;
  const countLabel = (count === 1 ? context?.labels.one : context?.labels.other)?.replace(
    /\d+/u,
    new Intl.NumberFormat(context?.locale ?? 'en').format(count),
  );
  return (
    <button
      type="button"
      className="care-calendar-month-date"
      aria-label={countLabel ? `${label}, ${countLabel}` : label}
      onClick={onDrillDown}
    >
      <span>{label}</span>
      <span className="care-calendar-month-count" aria-hidden="true">
        {count}
      </span>
    </button>
  );
}

function subscribeToResourceColumnMedia(callback: () => void): () => void {
  const media = window.matchMedia('(min-width: 768px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function getResourceColumnMediaSnapshot(): boolean {
  return window.matchMedia('(min-width: 768px)').matches;
}

function getRangeTitle(date: string, view: ScheduleCalendarView, locale: 'en' | 'de'): string {
  const current = dateAtNoon(date);
  if (view === 'month')
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(current);
  if (view === 'day') return new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(current);
  const start = startOfWeek(current, { weekStartsOn: 1 });
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const formatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return `${formatter.format(start)} – ${formatter.format(end)}${start.getFullYear() === end.getFullYear() ? ` ${end.getFullYear()}` : ` ${start.getFullYear()} – ${end.getFullYear()}`}`;
}

function shiftDate(date: string, view: ScheduleCalendarView, direction: -1 | 1): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  if (view === 'month') {
    const day = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() + direction);
    value.setUTCDate(
      Math.min(
        day,
        new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate(),
      ),
    );
  } else {
    value.setUTCDate(value.getUTCDate() + direction * (view === 'day' ? 1 : 7));
  }
  return value.toISOString().slice(0, 10);
}

function dateAtNoon(value: string): Date {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function toCalendarDate(value: string, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const field = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
  return new Date(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
}

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function timeAt(hour: number, minute: number): Date {
  const value = new Date();
  value.setHours(hour, minute, 0, 0);
  return value;
}

function todayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const field = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}
