'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@care/ui/components/button';
import { Checkbox } from '@care/ui/components/checkbox';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { Textarea } from '@care/ui/components/textarea';
import { AsyncEntityCombobox, type EntityOption } from './async-entity-combobox';
import { RHFActionForm } from './rhf-action-form';
import { unitLabelKey } from '@app/web/i18n/status';
import {
  estimateServicePriceForFourWeeks,
  type ServicePricingUnit,
} from '@module/services/domain/service-price';
import { useAgreementCostSummary } from './agreement-cost-summary';

const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
type Weekday = (typeof weekdays)[number];
type Cadence = 'none' | 'daily' | 'weekly' | 'occurrences_per_week' | 'interval_days' | 'on_demand';
type Price = {
  priceCents: number;
  pricingUnit: ServicePricingUnit;
  validFrom: string;
  validUntil: string | null;
  facilityId: string | null;
};

export function AgreementServiceFields({
  action,
  clientId,
  agreementId,
  serviceId,
  service,
  provider,
  validFrom,
  validUntil,
  quantity,
  note,
  scheduleRule,
  preferredTimeStart,
  preferredTimeEnd,
  submitLabel,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  agreementId: string;
  serviceId?: string;
  service?: { id: string; label: string; unit: EntityOption['serviceUnit'] };
  provider: {
    organizationId: string;
    facilityId: string;
    validAt: string;
    agreementValidFrom: string;
  };
  validFrom?: string | null;
  validUntil?: string | null;
  quantity?: string;
  note?: string;
  scheduleRule?:
    | { type: 'daily' }
    | { type: 'on_demand' }
    | { type: 'weekly'; weekdays: Weekday[] }
    | { type: 'occurrences_per_week'; count: number }
    | { type: 'interval_days'; intervalDays: number }
    | null;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  submitLabel: string;
}>) {
  const t = useTranslations();
  const prefix = useId();
  const costKey = serviceId ?? prefix;
  const costSummary = useAgreementCostSummary();
  const reportCostLine = costSummary?.report ?? null;
  const [selectedService, setSelectedService] = useState<EntityOption | null>(
    service
      ? {
          id: service.id,
          label: service.label,
          ...(service.unit ? { serviceUnit: service.unit } : {}),
        }
      : null,
  );
  const [lineStart, setLineStart] = useState(validFrom ?? '');
  const [lineEnd, setLineEnd] = useState(validUntil ?? '');
  const [quantityValue, setQuantityValue] = useState(quantity ?? '');
  const [cadence, setCadence] = useState<Cadence>(scheduleRule?.type ?? 'none');
  const [weekdaysValue, setWeekdaysValue] = useState<Weekday[]>(
    scheduleRule?.type === 'weekly' ? scheduleRule.weekdays : [],
  );
  const [weeklyCount, setWeeklyCount] = useState(
    scheduleRule?.type === 'occurrences_per_week' ? String(scheduleRule.count) : '',
  );
  const [intervalDays, setIntervalDays] = useState(
    scheduleRule?.type === 'interval_days' ? String(scheduleRule.intervalDays) : '',
  );
  const [priceLookup, setPriceLookup] = useState<{
    requestKey: string;
    result: { state: 'error' | 'missing' } | { state: 'loaded'; price: Price };
  } | null>(null);

  const serviceStart = lineStart || validFrom || provider.agreementValidFrom || provider.validAt;
  const estimateStart = costSummary?.periodStart || provider.agreementValidFrom || serviceStart;
  const estimateValidUntil =
    [lineEnd, costSummary?.periodEnd ?? ''].filter(Boolean).sort()[0] ?? null;
  const selectedServiceId = selectedService?.id ?? null;
  const priceRequestKey = selectedServiceId
    ? `${selectedServiceId}|${provider.organizationId}|${provider.facilityId}|${estimateStart}`
    : null;
  const priceResult = useMemo(
    () =>
      !priceRequestKey
        ? { state: 'idle' as const }
        : priceLookup?.requestKey === priceRequestKey
          ? priceLookup.result
          : { state: 'loading' as const },
    [priceLookup, priceRequestKey],
  );
  useEffect(() => {
    if (!selectedServiceId || !estimateStart || !priceRequestKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      organizationId: provider.organizationId,
      facilityId: provider.facilityId,
      validAt: estimateStart,
    });
    void fetch(`/api/service-prices/${encodeURIComponent(selectedServiceId)}?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Price lookup failed');
        return (await response.json()) as { items?: Price[] };
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const prices = payload.items ?? [];
        const effective =
          prices.find((item) => item.facilityId === provider.facilityId) ??
          prices.find((item) => item.facilityId === null);
        setPriceLookup({
          requestKey: priceRequestKey,
          result: effective ? { state: 'loaded', price: effective } : { state: 'missing' },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPriceLookup({ requestKey: priceRequestKey, result: { state: 'error' } });
        }
      });
    return () => controller.abort();
  }, [
    estimateStart,
    priceRequestKey,
    provider.facilityId,
    provider.organizationId,
    selectedServiceId,
  ]);

  const estimate =
    selectedService && priceResult.state === 'loaded'
      ? estimateServicePriceForFourWeeks({
          price: priceResult.price,
          serviceUnit: selectedService.serviceUnit,
          quantity: quantityValue,
          scheduleRule: scheduleRuleForEstimate(cadence, weekdaysValue, weeklyCount, intervalDays),
          validFrom: estimateStart,
          validUntil: estimateValidUntil,
          serviceValidFrom: serviceStart,
        })
      : null;

  useEffect(() => {
    if (!reportCostLine) return;
    if (!selectedService) {
      reportCostLine(costKey, null);
      return;
    }
    reportCostLine(costKey, {
      label: selectedService.label,
      quantity: quantityValue,
      pendingAddition: serviceId === undefined,
      ...(selectedService.serviceUnit ? { serviceUnit: selectedService.serviceUnit } : {}),
      state: priceResult.state === 'idle' ? 'loading' : priceResult.state,
      ...(priceResult.state === 'loaded' ? { price: priceResult.price } : {}),
      ...(estimate ? { estimate } : {}),
    });
  }, [costKey, estimate, priceResult, quantityValue, reportCostLine, selectedService, serviceId]);

  useEffect(() => {
    return () => reportCostLine?.(costKey, null);
  }, [costKey, reportCostLine]);

  return (
    <RHFActionForm action={action} className="grid gap-4" warnOnUnsavedChanges>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="agreementId" value={agreementId} />
      {serviceId ? <input type="hidden" name="serviceId" value={serviceId} /> : null}
      {service ? (
        <div className="grid gap-1.5">
          <Label>{t('ServiceAgreements.service')}</Label>
          <input type="hidden" name="serviceDefinitionId" value={service.id} />
          <p className="rounded-md border bg-background px-3 py-2 text-sm font-medium">
            {service.label}
          </p>
        </div>
      ) : (
        <AsyncEntityCombobox
          name="serviceDefinitionId"
          entity="services"
          label={t('ServiceAgreements.service')}
          required
          placeholder={t('ServiceAgreements.selectService')}
          organizationId={provider.organizationId}
          facilityId={provider.facilityId}
          validFrom={serviceStart}
          {...(lineEnd ? { validUntil: lineEnd } : {})}
          onSelectionChange={(options) => {
            setSelectedService(options[0] ?? null);
          }}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          id={`${prefix}-from`}
          name="validFrom"
          label={t('ServiceAgreements.validFromForService')}
          value={lineStart}
          onChange={setLineStart}
        />
        <DateField
          id={`${prefix}-until`}
          name="validUntil"
          label={t('ServiceAgreements.validUntilForService')}
          value={lineEnd}
          onChange={setLineEnd}
        />
        <TextField
          id={`${prefix}-quantity`}
          name="quantity"
          label={
            selectedService?.serviceUnit
              ? t('ServiceAgreements.quantityWithUnit', {
                  unit: t(unitLabelKey(selectedService.serviceUnit)),
                })
              : t('ServiceAgreements.quantityOptional')
          }
          value={quantityValue}
          onChange={setQuantityValue}
          maxLength={13}
          inputMode="decimal"
        />
        <SelectField
          id={`${prefix}-cadence`}
          name="cadence"
          label={t('ServiceAgreements.cadence')}
          value={cadence}
          onChange={(value) => setCadence(value as Cadence)}
        >
          <option value="none">{t('ServiceAgreements.cadenceUnspecified')}</option>
          <option value="daily">{t('ServiceAgreements.daily')}</option>
          <option value="weekly">{t('ServiceAgreements.weekly')}</option>
          <option value="occurrences_per_week">{t('ServiceAgreements.occurrencesPerWeek')}</option>
          <option value="interval_days">{t('ServiceAgreements.intervalDays')}</option>
          <option value="on_demand">{t('ServiceAgreements.onDemand')}</option>
        </SelectField>
        <TextField
          id={`${prefix}-count`}
          name="count"
          label={t('ServiceAgreements.occurrencesPerWeekHelp')}
          type="number"
          min={1}
          max={14}
          value={weeklyCount}
          onChange={setWeeklyCount}
        />
        <TextField
          id={`${prefix}-interval`}
          name="intervalDays"
          label={t('ServiceAgreements.intervalDaysHelp')}
          type="number"
          min={1}
          max={365}
          value={intervalDays}
          onChange={setIntervalDays}
        />
        <TimeField
          id={`${prefix}-preferred-start`}
          name="preferredTimeStart"
          label={t('ServiceAgreements.preferredTimeFrom')}
          defaultValue={preferredTimeStart ?? ''}
        />
        <TimeField
          id={`${prefix}-preferred-end`}
          name="preferredTimeEnd"
          label={t('ServiceAgreements.preferredTimeUntil')}
          defaultValue={preferredTimeEnd ?? ''}
        />
        <label className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`${prefix}-note`}>{t('ServiceAgreements.operationalNote')}</Label>
          <Textarea
            id={`${prefix}-note`}
            name="note"
            defaultValue={note ?? ''}
            maxLength={1000}
            className="min-h-20 rounded-md border px-3 py-2"
          />
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t('ServiceAgreements.weekdaysLegend')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {weekdays.map((day) => (
            <label key={day} className="flex min-h-10 items-center gap-2 text-sm">
              <Checkbox
                name="weekdays"
                value={day}
                checked={weekdaysValue.includes(day)}
                onCheckedChange={(checked) =>
                  setWeekdaysValue((current) =>
                    checked ? [...current, day] : current.filter((value) => value !== day),
                  )
                }
              />
              {t(`ServiceAgreements.weekdays.${day}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" className="w-fit">
        {submitLabel}
      </Button>
    </RHFActionForm>
  );
}

function scheduleRuleForEstimate(
  cadence: Cadence,
  weekdaysValue: Weekday[],
  weeklyCount: string,
  intervalDaysValue: string,
) {
  switch (cadence) {
    case 'none':
      return null;
    case 'daily':
      return { type: 'daily' as const };
    case 'weekly':
      return { type: 'weekly' as const, weekdays: weekdaysValue };
    case 'occurrences_per_week':
      return { type: 'occurrences_per_week' as const, count: Number(weeklyCount) };
    case 'interval_days':
      return { type: 'interval_days' as const, intervalDays: Number(intervalDaysValue) };
    case 'on_demand':
      return { type: 'on_demand' as const };
  }
}

function DateField({
  id,
  name,
  label,
  value,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  value,
  onChange,
  type = 'text',
  maxLength,
  inputMode,
  min,
  max,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength?: number;
  inputMode?: 'decimal' | 'numeric';
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        inputMode={inputMode}
        min={min}
        max={max}
      />
    </div>
  );
}

function TimeField({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="time" defaultValue={defaultValue} />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        selectClassName="h-10 rounded-md border bg-card px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}
