'use client';

import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { formatCurrency } from '@app/web/i18n/format';
import type { Locale } from '@app/web/i18n/config';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

const maximumLines = 8;

type AllocationLine = {
  key: string;
  selection: string;
  amount: string;
  status: 'provisional' | 'confirmed';
};

export type AllocationEditorOption = {
  value: string;
  label: string;
};

export function AllocationEditor({
  performedServiceId,
  amountCents,
  previouslyAllocatedCents,
  initialIdempotencyKey,
  options,
  locale,
}: Readonly<{
  performedServiceId: string;
  amountCents: number | null;
  previouslyAllocatedCents: number;
  initialIdempotencyKey: string;
  options: readonly AllocationEditorOption[];
  locale: Locale;
}>) {
  const t = useTranslations('Benefits');
  const [lines, setLines] = useState<AllocationLine[]>([
    {
      key: initialIdempotencyKey,
      selection: '',
      amount: '',
      status: 'provisional',
    },
  ]);

  const manualAmountFieldId = `manual-service-amount-${performedServiceId}`;
  const manualAmountFieldName = 'manualServiceAmount';
  const [manualAmount, setManualAmount] = useState('');
  const enteredAmounts = lines.map((line) => ({
    populated: Boolean(line.selection || line.amount),
    selection: line.selection,
    cents: parseEuroCents(line.amount),
  }));
  const hasEnteredLines = enteredAmounts.some((line) => line.populated);
  const hasIncompleteLine = enteredAmounts.some(
    (line) => line.populated && (!line.selection || line.cents === null || line.cents <= 0n),
  );
  const submittedCents = enteredAmounts.reduce(
    (total, line) => total + (line.cents !== null && line.cents > 0n ? line.cents : 0n),
    0n,
  );
  const serviceAmountCents =
    amountCents === null ? parseEuroCents(manualAmount) : BigInt(amountCents);
  const availableBefore =
    serviceAmountCents === null ? null : serviceAmountCents - BigInt(previouslyAllocatedCents);
  const allocatedAfter =
    hasEnteredLines && !hasIncompleteLine
      ? BigInt(previouslyAllocatedCents) + submittedCents
      : null;
  const remainingAfter =
    serviceAmountCents !== null && allocatedAfter !== null
      ? serviceAmountCents - allocatedAfter
      : null;
  const exceedsRemaining =
    hasEnteredLines &&
    !hasIncompleteLine &&
    availableBefore !== null &&
    submittedCents > availableBefore;

  function updateLine(index: number, patch: Partial<AllocationLine>) {
    setLines((current) =>
      current.map((line, currentIndex) => (currentIndex === index ? { ...line, ...patch } : line)),
    );
  }

  return (
    <div className="grid gap-3">
      {amountCents === null ? (
        <label className="grid gap-2">
          <Label htmlFor={manualAmountFieldId}>{t('serviceAmount')}</Label>
          <Input
            id={manualAmountFieldId}
            name={manualAmountFieldName}
            value={manualAmount}
            onChange={(event) => setManualAmount(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            required
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('allocationRows')}</p>
        <Button
          type="button"
          variant="secondary"
          disabled={lines.length >= maximumLines}
          onClick={() =>
            setLines((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                selection: '',
                amount: '',
                status: 'provisional',
              },
            ])
          }
        >
          {t('addAllocationLine')}
        </Button>
      </div>

      <div className="grid gap-3">
        {lines.map((line, index) => {
          const sourceId = `allocation-${index}-selection-${performedServiceId}`;
          const amountId = `allocation-${index}-amount-${performedServiceId}`;
          const statusId = `allocation-${index}-status-${performedServiceId}`;
          return (
            <fieldset
              key={line.key}
              className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_minmax(0,1fr)_auto] xl:items-end"
            >
              <legend className="sr-only">{t('allocationLine', { number: index + 1 })}</legend>
              <input type="hidden" name={`allocation-${index}-key`} value={line.key} />
              <label className="grid min-w-0 gap-2">
                <Label htmlFor={sourceId}>{t('fundingSource')}</Label>
                <NativeSelect
                  id={sourceId}
                  name={`allocation-${index}-selection`}
                  value={line.selection}
                  onChange={(event) => updateLine(index, { selection: event.target.value })}
                  required={Boolean(line.amount)}
                  selectClassName="min-h-10 rounded-md border bg-background px-3 py-2"
                  className="w-full"
                >
                  <option value="">{t('selectFundingSource')}</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-2">
                <Label htmlFor={amountId}>{t('allocationAmount')}</Label>
                <Input
                  id={amountId}
                  name={`allocation-${index}-amount`}
                  value={line.amount}
                  onChange={(event) => updateLine(index, { amount: event.target.value })}
                  inputMode="decimal"
                  autoComplete="off"
                  required={Boolean(line.selection)}
                />
              </label>
              <label className="grid gap-2">
                <Label htmlFor={statusId}>{t('allocationStatus')}</Label>
                <NativeSelect
                  id={statusId}
                  name={`allocation-${index}-status`}
                  value={line.status}
                  onChange={(event) =>
                    updateLine(index, {
                      status: event.target.value === 'confirmed' ? 'confirmed' : 'provisional',
                    })
                  }
                  selectClassName="min-h-10 rounded-md border bg-background px-3 py-2"
                  className="w-full"
                >
                  <option value="provisional">{t('provisionalAllocation')}</option>
                  <option value="confirmed">{t('confirmedAllocation')}</option>
                </NativeSelect>
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={lines.length === 1}
                aria-label={t('removeAllocationLine', { number: index + 1 })}
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
              >
                {t('removeAllocationLineShort')}
              </Button>
            </fieldset>
          );
        })}
      </div>

      <section
        aria-labelledby={`allocation-preview-${performedServiceId}`}
        className="grid gap-2 rounded-md bg-accent p-3"
      >
        <h4 id={`allocation-preview-${performedServiceId}`} className="font-medium">
          {t('allocationPreview')}
        </h4>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <PreviewMetric
            label={t('remainingToAllocate')}
            value={availableBefore === null ? t('unknownBalance') : money(availableBefore, locale)}
          />
          <PreviewMetric
            label={t('allocatedAfterSave')}
            value={allocatedAfter === null ? '—' : money(allocatedAfter, locale)}
          />
          <PreviewMetric
            label={t('unallocatedAfterSave')}
            value={remainingAfter === null ? '—' : money(remainingAfter, locale)}
          />
        </dl>
        {exceedsRemaining ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t('allocationExceedsRemaining')}
          </p>
        ) : null}
        {amountCents === null && serviceAmountCents === null ? (
          <p className="text-sm text-muted-foreground">{t('enterServiceAmountForPreview')}</p>
        ) : null}
      </section>
    </div>
  );
}

function PreviewMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function parseEuroCents(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
}

function money(cents: bigint, locale: Locale): string {
  return formatCurrency(Number(cents) / 100, locale);
}
