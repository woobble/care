'use client';

import { useState } from 'react';
import { Input, Label } from '@care/ui';

type ScheduleType = 'unknown' | 'fixed_times' | 'interval' | 'as_needed';

type ScheduleFieldValues = Readonly<{
  type: ScheduleType;
  timezone: string;
  times: string;
  anchorAt: string;
  intervalMinutes: string;
  indication: string;
  maximumDoseAmount: string;
  maximumAdministrations: string;
  frequencyWindowMinutes: string;
  minimumIntervalMinutes: string;
}>;

type ScheduleFieldLabels = Readonly<{
  title: string;
  type: string;
  unknown: string;
  fixedTimes: string;
  interval: string;
  asNeeded: string;
  timezone: string;
  times: string;
  anchorAt: string;
  intervalMinutes: string;
  indication: string;
  maximumDoseAmount: string;
  maximumAdministrations: string;
  frequencyWindowMinutes: string;
  minimumIntervalMinutes: string;
}>;

export default function ReconciliationScheduleFields({
  idPrefix,
  values,
  labels,
}: Readonly<{
  idPrefix: string;
  values: ScheduleFieldValues;
  labels: ScheduleFieldLabels;
}>) {
  const [type, setType] = useState(values.type);
  const id = (field: string) => idPrefix + field;

  return (
    <fieldset className="grid gap-3 rounded-md border p-3">
      <legend className="px-1 font-medium">{labels.title}</legend>
      <div className="grid gap-1.5">
        <Label htmlFor={id('scheduleType')}>{labels.type}</Label>
        <select
          id={id('scheduleType')}
          name="scheduleType"
          value={type}
          onChange={(event) => setType(event.currentTarget.value as ScheduleType)}
          className="min-h-12 rounded-md border bg-white px-3"
        >
          <option value="unknown">{labels.unknown}</option>
          <option value="fixed_times">{labels.fixedTimes}</option>
          <option value="interval">{labels.interval}</option>
          <option value="as_needed">{labels.asNeeded}</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id('scheduleTimezone')}>{labels.timezone}</Label>
        <Input
          id={id('scheduleTimezone')}
          name="scheduleTimezone"
          defaultValue={values.timezone}
          required={type !== 'unknown'}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div hidden={type !== 'fixed_times'} className="grid gap-1.5">
          <Label htmlFor={id('times')}>{labels.times}</Label>
          <Input
            id={id('times')}
            name="times"
            defaultValue={values.times}
            required={type === 'fixed_times'}
          />
        </div>
        <div hidden={type !== 'interval'} className="grid gap-1.5">
          <Label htmlFor={id('anchorAt')}>{labels.anchorAt}</Label>
          <Input
            id={id('anchorAt')}
            name="anchorAt"
            type="datetime-local"
            defaultValue={values.anchorAt}
            required={type === 'interval'}
          />
        </div>
        <div hidden={type !== 'interval'} className="grid gap-1.5">
          <Label htmlFor={id('intervalMinutes')}>{labels.intervalMinutes}</Label>
          <Input
            id={id('intervalMinutes')}
            name="intervalMinutes"
            type="number"
            min="1"
            defaultValue={values.intervalMinutes}
            required={type === 'interval'}
          />
        </div>
        <div hidden={type !== 'as_needed'} className="grid gap-1.5">
          <Label htmlFor={id('indication')}>{labels.indication}</Label>
          <Input
            id={id('indication')}
            name="indication"
            defaultValue={values.indication}
            required={type === 'as_needed'}
          />
        </div>
        <div hidden={type !== 'as_needed'} className="grid gap-1.5">
          <Label htmlFor={id('maximumDoseAmount')}>{labels.maximumDoseAmount}</Label>
          <Input id={id('maximumDoseAmount')} name="maximumDoseAmount" defaultValue={values.maximumDoseAmount} />
        </div>
        <div hidden={type !== 'as_needed'} className="grid gap-1.5">
          <Label htmlFor={id('maximumAdministrations')}>{labels.maximumAdministrations}</Label>
          <Input
            id={id('maximumAdministrations')}
            name="maximumAdministrations"
            type="number"
            min="1"
            defaultValue={values.maximumAdministrations}
          />
        </div>
        <div hidden={type !== 'as_needed'} className="grid gap-1.5">
          <Label htmlFor={id('frequencyWindowMinutes')}>{labels.frequencyWindowMinutes}</Label>
          <Input
            id={id('frequencyWindowMinutes')}
            name="frequencyWindowMinutes"
            type="number"
            min="1"
            defaultValue={values.frequencyWindowMinutes}
          />
        </div>
        <div hidden={type !== 'as_needed'} className="grid gap-1.5">
          <Label htmlFor={id('minimumIntervalMinutes')}>{labels.minimumIntervalMinutes}</Label>
          <Input
            id={id('minimumIntervalMinutes')}
            name="minimumIntervalMinutes"
            type="number"
            min="1"
            defaultValue={values.minimumIntervalMinutes}
          />
        </div>
      </div>
    </fieldset>
  );
}
