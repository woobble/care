'use client';

import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { useState } from 'react';

type Weekday = { weekday: number; label: string };
type AvailabilityWindow = { weekday: number; startsAt: string; endsAt: string };

export function WeeklyAvailabilityEditor({
  weekdays,
  windows,
  startLabel,
  endLabel,
  addLabel,
  removeLabel,
}: Readonly<{
  weekdays: Weekday[];
  windows: AvailabilityWindow[];
  startLabel: string;
  endLabel: string;
  addLabel: string;
  removeLabel: string;
}>) {
  const [counts, setCounts] = useState(() =>
    Object.fromEntries(
      weekdays.map(({ weekday }) => [
        weekday,
        Math.min(4, Math.max(1, windows.filter((window) => window.weekday === weekday).length)),
      ]),
    ),
  );

  return (
    <div className="grid gap-3">
      {weekdays.map(({ weekday, label }) => {
        const dayWindows = windows.filter((window) => window.weekday === weekday);
        const count = counts[weekday] ?? 1;
        return (
          <fieldset key={weekday} className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 font-medium">{label}</legend>
            {Array.from({ length: count }, (_, index) => {
              const slot = index + 1;
              const window = dayWindows[index];
              return (
                <div key={slot} className="grid gap-2 rounded-md bg-muted/40 p-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor={`availability-${weekday}-${slot}-start`}>{startLabel}</Label>
                      <Input
                        id={`availability-${weekday}-${slot}-start`}
                        name={`window_${weekday}_${slot}_start`}
                        type="time"
                        defaultValue={window?.startsAt ?? ''}
                        className="min-w-0"
                      />
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor={`availability-${weekday}-${slot}-end`}>{endLabel}</Label>
                      <Input
                        id={`availability-${weekday}-${slot}-end`}
                        name={`window_${weekday}_${slot}_end`}
                        type="time"
                        defaultValue={window?.endsAt ?? ''}
                        className="min-w-0"
                      />
                    </div>
                  </div>
                  {slot === count ? (
                    <div className="flex flex-wrap gap-2">
                      {count < 4 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setCounts((current) => ({ ...current, [weekday]: count + 1 }))
                          }
                        >
                          {addLabel}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setCounts((current) => ({ ...current, [weekday]: count - 1 }))
                        }
                      >
                        {removeLabel}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {count === 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setCounts((current) => ({ ...current, [weekday]: 1 }))}
              >
                {addLabel}
              </Button>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
