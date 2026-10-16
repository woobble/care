'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { updateTourStopsAction } from '@app/web/app/(office)/planning/actions';
import { Button } from '@care/ui/components/button';

type TourStop = Readonly<{
  visitId: string;
  clientName: string;
  dispatcherNote: string;
}>;

type TourStopOrderFormProps = Readonly<{
  tourId: string;
  expectedVersion: number;
  localDate: string;
  employeeId: string;
  stops: readonly TourStop[];
}>;

export function TourStopOrderForm({
  tourId,
  expectedVersion,
  localDate,
  employeeId,
  stops: initialStops,
}: TourStopOrderFormProps) {
  const t = useTranslations('Planning');
  const [stops, setStops] = useState(() => [...initialStops]);
  const hasUnsavedOrder = stops.some(
    (stop, index) => stop.visitId !== initialStops[index]?.visitId,
  );

  function moveStop(index: number, offset: -1 | 1) {
    setStops((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }

  return (
    <form action={updateTourStopsAction} className="grid gap-3 rounded-md border p-3">
      <input type="hidden" name="tourId" value={tourId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <input type="hidden" name="localDate" value={localDate} />
      <input type="hidden" name="employeeId" value={employeeId} />
      {stops.map((stop, index) => (
        <div
          key={stop.visitId}
          className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-background p-2"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t('stopLabel', { sequence: index + 1 })}: {stop.clientName}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="secondary"
              size="icon-lg"
              className="min-h-11 min-w-11"
              aria-label={t('moveStopUp', { client: stop.clientName })}
              disabled={index === 0}
              onClick={() => moveStop(index, -1)}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon-lg"
              className="min-h-11 min-w-11"
              aria-label={t('moveStopDown', { client: stop.clientName })}
              disabled={index === stops.length - 1}
              onClick={() => moveStop(index, 1)}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
      {stops.map((stop) => (
        <span key={stop.visitId}>
          <input type="hidden" name="visitId" value={stop.visitId} />
          <input type="hidden" name="dispatcherNote" value={stop.dispatcherNote} />
        </span>
      ))}
      {hasUnsavedOrder ? (
        <p
          role="status"
          aria-live="polite"
          className="text-sm font-medium text-amber-700 dark:text-amber-300"
        >
          {t('unsavedTourOrder')}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" className="w-fit" disabled={!hasUnsavedOrder}>
        {t('saveTourOrder')}
      </Button>
    </form>
  );
}
