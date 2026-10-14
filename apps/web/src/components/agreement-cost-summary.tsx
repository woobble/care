'use client';

import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { Badge } from '@care/ui/components/badge';
import { formatCurrency, formatDate, formatNumber } from '@app/web/i18n/format';
import type { Locale } from '@app/web/i18n/config';
import { unitLabelKey } from '@app/web/i18n/status';
import type {
  FourWeekServiceEstimate,
  ServicePriceEstimateReason,
  ServicePricingUnit,
} from '@module/services/domain/service-price';
import { summarizeFourWeekServiceEstimates } from '@module/services/domain/service-price';

export type AgreementCostLine = {
  label: string;
  quantity: string;
  pendingAddition: boolean;
  serviceUnit?: 'occurrence' | 'minute' | 'hour' | 'day';
  state: 'loading' | 'error' | 'missing' | 'loaded';
  price?: {
    priceCents: number;
    pricingUnit: ServicePricingUnit;
    validFrom: string;
  };
  estimate?: { totalCents: number; occurrences: number } | { reason: ServicePriceEstimateReason };
};

type AgreementCostSummaryContextValue = {
  report: (key: string, line: AgreementCostLine | null) => void;
  lines: Record<string, AgreementCostLine>;
  periodStart: string;
  setPeriodStart: (value: string) => void;
  periodEnd: string;
  setPeriodEnd: (value: string) => void;
};

const AgreementCostSummaryContext = createContext<AgreementCostSummaryContextValue | null>(null);

const pricingUnitMessageKeys = {
  hour: 'Services.pricing.units.hour',
  minute: 'Services.pricing.units.minute',
  visit: 'Services.pricing.units.visit',
  fixed: 'Services.pricing.units.fixed',
} as const satisfies Record<ServicePricingUnit, string>;

const estimateReasonMessageKeys = {
  unitUnknown: 'ServiceAgreements.costEstimate.reason.unitUnknown',
  shortValidity: 'ServiceAgreements.costEstimate.reason.shortValidity',
  priceBoundary: 'ServiceAgreements.costEstimate.reason.priceBoundary',
  quantityRequired: 'ServiceAgreements.costEstimate.reason.quantityRequired',
  quantityInvalid: 'ServiceAgreements.costEstimate.reason.quantityInvalid',
  cadenceRequired: 'ServiceAgreements.costEstimate.reason.cadenceRequired',
  cadenceIncomplete: 'ServiceAgreements.costEstimate.reason.cadenceIncomplete',
  weekdaysRequired: 'ServiceAgreements.costEstimate.reason.weekdaysRequired',
  onDemand: 'ServiceAgreements.costEstimate.reason.onDemand',
  unitMismatch: 'ServiceAgreements.costEstimate.reason.unitMismatch',
} as const satisfies Record<ServicePriceEstimateReason, string>;

export function AgreementCostSummary({
  periodStart: initialPeriodStart,
  periodEnd: initialPeriodEnd,
  children,
}: Readonly<{ periodStart: string; periodEnd: string; children: React.ReactNode }>) {
  const [lines, setLines] = useState<Record<string, AgreementCostLine>>({});
  const [periodStart, setPeriodStart] = useState(initialPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriodEnd);
  const report = useCallback((key: string, line: AgreementCostLine | null) => {
    setLines((current) => {
      if (line === null) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (JSON.stringify(current[key]) === JSON.stringify(line)) return current;
      return { ...current, [key]: line };
    });
  }, []);
  const value = useMemo(
    () => ({ report, lines, periodStart, setPeriodStart, periodEnd, setPeriodEnd }),
    [lines, periodEnd, periodStart, report, setPeriodEnd, setPeriodStart],
  );

  return (
    <AgreementCostSummaryContext.Provider value={value}>
      <>{children}</>
    </AgreementCostSummaryContext.Provider>
  );
}

export function useAgreementCostSummary() {
  return useContext(AgreementCostSummaryContext);
}

export function AgreementCostSummaryPanel() {
  const context = useContext(AgreementCostSummaryContext);
  return context ? (
    <AgreementCostPanel lines={Object.entries(context.lines)} periodStart={context.periodStart} />
  ) : null;
}

export function AgreementPeriodStartField({
  id,
  label,
  required,
}: Readonly<{ id: string; label: string; required?: boolean }>) {
  const context = useContext(AgreementCostSummaryContext);
  const value = context?.periodStart ?? '';
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name="validFrom"
        type="date"
        value={value}
        onChange={(event) => context?.setPeriodStart(event.target.value)}
        required={required}
      />
    </div>
  );
}

export function AgreementPeriodEndField({ id, label }: Readonly<{ id: string; label: string }>) {
  const context = useContext(AgreementCostSummaryContext);
  const value = context?.periodEnd ?? '';
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name="validUntil"
        type="date"
        value={value}
        onChange={(event) => context?.setPeriodEnd(event.target.value)}
      />
    </div>
  );
}

function AgreementCostPanel({
  lines,
  periodStart,
}: Readonly<{ lines: Array<[string, AgreementCostLine]>; periodStart: string }>) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const titleId = useId();
  if (lines.length === 0) return null;

  const end = addDays(periodStart, 27);
  const estimateSummary = summarizeFourWeekServiceEstimates(
    lines.map(
      ([, line]) =>
        line.estimate ?? ({ reason: 'cadenceRequired' } satisfies FourWeekServiceEstimate),
    ),
  );

  return (
    <section
      aria-labelledby={titleId}
      aria-live="polite"
      className="grid gap-3 rounded-lg border bg-muted/20 p-4"
    >
      <div className="grid gap-1">
        <h4 id={titleId} className="font-semibold">
          {t('ServiceAgreements.costEstimate.agreementTitle')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t('ServiceAgreements.costEstimate.period', {
            from: formatDate(periodStart, locale) ?? periodStart,
            until: formatDate(end, locale) ?? end,
          })}
        </p>
      </div>
      <ul className="grid gap-2">
        {lines.map(([key, line]) => (
          <li key={key} className="grid gap-1 rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{line.label}</span>
                {line.pendingAddition ? (
                  <Badge variant="outline">
                    {t('ServiceAgreements.costEstimate.pendingAddition')}
                  </Badge>
                ) : null}
              </div>
              <span className="text-sm text-muted-foreground">
                {line.quantity
                  ? `${formatQuantity(line.quantity, locale)}${line.serviceUnit ? ` ${t(unitLabelKey(line.serviceUnit))}` : ''}`
                  : t('ServiceAgreements.quantityOptional')}
              </span>
            </div>
            {line.state === 'loading' ? (
              <p className="text-sm text-muted-foreground">
                {t('ServiceAgreements.costEstimate.loading')}
              </p>
            ) : line.state === 'error' ? (
              <p className="text-sm text-destructive">
                {t('ServiceAgreements.costEstimate.loadFailed')}
              </p>
            ) : line.state === 'missing' ? (
              <p className="text-sm text-muted-foreground">
                {t('ServiceAgreements.costEstimate.noPrice')}
              </p>
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  {line.price
                    ? `${formatCurrency(line.price.priceCents / 100, locale)} / ${t(pricingUnitMessageKeys[line.price.pricingUnit])} · ${t('ServiceAgreements.costEstimate.effectiveFrom', { date: formatDate(line.price.validFrom, locale) ?? line.price.validFrom })}`
                    : t('ServiceAgreements.costEstimate.noPrice')}
                </span>
                {line.estimate && 'totalCents' in line.estimate ? (
                  <span className="font-medium">
                    {t('ServiceAgreements.costEstimate.lineTotal', {
                      amount: formatCurrency(line.estimate.totalCents / 100, locale),
                      count: formatNumber(line.estimate.occurrences, locale),
                    })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t(
                      estimateReasonMessageKeys[
                        line.estimate && 'reason' in line.estimate
                          ? line.estimate.reason
                          : 'cadenceRequired'
                      ],
                    )}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="grid gap-1 border-t pt-3">
        {estimateSummary.complete && !estimateSummary.overflow ? (
          <p className="font-semibold">
            {t('ServiceAgreements.costEstimate.agreementTotal', {
              amount: formatCurrency((estimateSummary.totalCents ?? 0) / 100, locale),
            })}
          </p>
        ) : (
          <>
            {estimateSummary.calculableCount > 0 && !estimateSummary.overflow ? (
              <p className="font-semibold">
                {t('ServiceAgreements.costEstimate.calculableSubtotal', {
                  amount: formatCurrency((estimateSummary.totalCents ?? 0) / 100, locale),
                })}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t(
                estimateSummary.overflow
                  ? 'ServiceAgreements.costEstimate.aggregateTooLarge'
                  : 'ServiceAgreements.costEstimate.incompleteTotal',
              )}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">{t('ServiceAgreements.costEstimate.note')}</p>
      </div>
    </section>
  );
}

function addDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function formatQuantity(value: string, locale: Locale): string {
  const quantity = Number(value);
  return Number.isFinite(quantity)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(quantity)
    : value;
}
