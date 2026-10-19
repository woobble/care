'use client';

import { dateFnsLocalizer, Calendar } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import type { DateHeaderProps, EventProps, EventWrapperProps, View } from 'react-big-calendar';
import { enUS } from 'date-fns/locale/en-US';
import { de } from 'date-fns/locale/de';
import { format, getDay, parse, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  cloneElement,
  createContext,
  useContext,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@care/ui/components/button';
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
  employeeSelector,
}: Readonly<{
  date: string;
  view: ScheduleCalendarView;
  locale: 'en' | 'de';
  timezone?: string;
  employeeSelector?: ReactNode;
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
  const dateInputRef = useRef<HTMLInputElement>(null);
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
      className={`schedule-calendar-navigation grid min-w-0 gap-3 rounded-2xl border border-border bg-card p-3 sm:items-center ${
        employeeSelector
          ? 'sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.85fr)_auto]'
          : 'sm:grid-cols-[minmax(0,1fr)_auto]'
      }`}
    >
      <div className="schedule-calendar-controls flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label={labels.previous}
          onClick={() => updateUrl(shiftDate(date, view, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div className="schedule-calendar-range flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-border bg-background/70 px-3">
          <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold tabular-nums" aria-live="polite">
            {title}
          </h2>
        </div>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label={labels.next}
          onClick={() => updateUrl(shiftDate(date, view, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-10 px-3 text-sm"
          onClick={() => updateUrl(todayInTimezone(timezone))}
        >
          {labels.today}
        </Button>
        <div className="schedule-calendar-date-picker">
          <Label htmlFor="schedule-calendar-date" className="sr-only">
            {labels.goToDate}
          </Label>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={labels.goToDate}
            onClick={() => {
              const input = dateInputRef.current;
              if (!input) return;
              if (typeof input.showPicker === 'function') input.showPicker();
              else input.click();
            }}
          >
            <CalendarDays aria-hidden="true" />
          </Button>
          <input
            ref={dateInputRef}
            id="schedule-calendar-date"
            type="date"
            value={date}
            tabIndex={-1}
            onChange={(event) => {
              if (event.currentTarget.value) updateUrl(event.currentTarget.value);
            }}
          />
        </div>
      </div>
      {employeeSelector ? (
        <div className="planning-calendar-employee min-w-0">{employeeSelector}</div>
      ) : null}
      <div
        className="schedule-calendar-views flex min-w-0 flex-wrap gap-1"
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
  emptyOverlay,
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
  emptyOverlay?: ReactNode;
  createVisitLabel?: string;
  rescheduleErrorLabel: string;
  canReschedule?: boolean;
  rescheduleAction?: (formData: FormData) => Promise<{ ok: boolean; errorCode?: string }>;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const calendarRef = useRef<HTMLDivElement>(null);
  const [pendingMoves, setPendingMoves] = useState<Record<string, { start: Date; end: Date }>>({});
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const showResourceColumns = useSyncExternalStore(
    subscribeToResourceColumnMedia,
    getResourceColumnMediaSnapshot,
    () => false,
  );

  useLayoutEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;

    const removeInvalidAllDayRoles = () => {
      // react-big-calendar assigns rowgroup/row roles to its all-day strip without a valid grid parent or child cells.
      for (const allDayCell of calendar.querySelectorAll('.rbc-allday-cell[role="rowgroup"]')) {
        allDayCell.removeAttribute('role');
        allDayCell.querySelectorAll('.rbc-row-content[role="row"]').forEach((row) => {
          row.removeAttribute('role');
        });
      }
    };

    removeInvalidAllDayRoles();
    const observer = new MutationObserver(removeInvalidAllDayRoles);
    observer.observe(calendar, {
      attributes: true,
      attributeFilter: ['role'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

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
      <div
        ref={calendarRef}
        className="care-calendar min-w-0 rounded-xl border border-border bg-card p-2 sm:p-3"
      >
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
            onSelectEvent={(event) => {
              const selectedEvent = event as CalendarEvent;
              if (!selectedEvent.backgroundKind) router.push(selectedEvent.href);
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
            components={{
              event: CalendarEventCard,
              eventWrapper: CalendarEventWrapper,
              month: { dateHeader: MonthDateHeader },
              week: { header: CalendarWeekHeader },
              day: { header: CalendarWeekHeader },
            }}
            eventPropGetter={(event) => {
              const calendarEvent = event as CalendarEvent;
              return {
                className: calendarEvent.backgroundKind
                  ? `care-calendar-background care-calendar-background-${calendarEvent.backgroundKind}`
                  : `care-calendar-event care-calendar-event-${calendarEvent.status}`,
              };
            }}
            messages={messages}
            style={{ height: view === 'month' ? 'min(70vh, 760px)' : 'min(78vh, 900px)' }}
          />
        </monthHeaderContext.Provider>
        {emptyOverlay ? <div className="care-calendar-empty-overlay">{emptyOverlay}</div> : null}
      </div>
      {!calendarEvents.length && !emptyOverlay ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : null}
    </div>
  );
}

function CalendarEventWrapper({
  children,
}: Readonly<EventWrapperProps<CalendarEvent> & { children?: ReactNode }>) {
  if (!isValidElement(children)) return children;
  const dndWrapper = children as ReactElement<{ children?: ReactNode }>;
  const eventElement = dndWrapper.props.children;
  if (!isValidElement(eventElement)) return children;
  const presentationalEvent = cloneElement(
    eventElement as ReactElement<{ role?: string; tabIndex?: number }>,
    {
      role: 'presentation',
      tabIndex: -1,
    },
  );
  return cloneElement(dndWrapper, { children: presentationalEvent });
}

function CalendarEventCard({ event }: EventProps<CalendarEvent>) {
  if (event.backgroundKind) {
    return <span className="care-calendar-background-label">{event.statusLabel}</span>;
  }
  return (
    <Link
      id={`visit-${event.id}`}
      href={event.href}
      className="care-calendar-event-content"
      onClick={(clickEvent) => clickEvent.stopPropagation()}
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

function CalendarWeekHeader({ label }: Readonly<{ label: ReactNode }>) {
  return <span>{label}</span>;
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
