import { describe, expect, it } from 'bun:test';

import {
  calculateServicePriceCents,
  estimateServicePriceForFourWeeks,
  summarizeFourWeekServiceEstimates,
} from './service-price';

const openPrice = {
  priceCents: 200,
  pricingUnit: 'hour' as const,
  validUntil: null,
};

describe('service price estimates', () => {
  it('combines service estimates in exact cents and marks partial totals', () => {
    expect(
      summarizeFourWeekServiceEstimates([
        { totalCents: 101, occurrences: 2 },
        { totalCents: 202, occurrences: 4 },
      ]),
    ).toEqual({ totalCents: 303, calculableCount: 2, complete: true, overflow: false });
    expect(
      summarizeFourWeekServiceEstimates([
        { totalCents: 101, occurrences: 2 },
        { reason: 'onDemand' },
      ]),
    ).toEqual({ totalCents: 101, calculableCount: 1, complete: false, overflow: false });
  });

  it('refuses to round a combined estimate beyond safe integer cents', () => {
    expect(
      summarizeFourWeekServiceEstimates([
        { totalCents: Number.MAX_SAFE_INTEGER, occurrences: 1 },
        { totalCents: 1, occurrences: 1 },
      ]),
    ).toEqual({ totalCents: null, calculableCount: 2, complete: false, overflow: true });
  });

  it('uses exact minor-unit rounding for each planned service', () => {
    expect(calculateServicePriceCents(123, 'hour', 'hour', '0.333')).toBe(41);
    expect(
      estimateServicePriceForFourWeeks({
        price: openPrice,
        serviceUnit: 'hour',
        quantity: '1.5',
        scheduleRule: { type: 'daily' },
        validFrom: '2026-01-01',
        validUntil: null,
      }),
    ).toEqual({ totalCents: 8400, occurrences: 28 });
  });

  it('estimates selected weekly days across four complete weeks', () => {
    expect(
      estimateServicePriceForFourWeeks({
        price: { priceCents: 100, pricingUnit: 'visit', validUntil: null },
        serviceUnit: 'occurrence',
        quantity: '2',
        scheduleRule: { type: 'weekly', weekdays: ['monday', 'thursday'] },
        validFrom: '2026-01-01',
        validUntil: '2026-01-28',
      }),
    ).toEqual({ totalCents: 1600, occurrences: 8 });
    expect(
      estimateServicePriceForFourWeeks({
        price: { priceCents: 100, pricingUnit: 'visit', validUntil: null },
        serviceUnit: 'occurrence',
        quantity: '1',
        scheduleRule: { type: 'weekly', weekdays: ['monday', 'monday'] },
        validFrom: '2026-01-01',
        validUntil: null,
      }),
    ).toEqual({ totalCents: 400, occurrences: 4 });
  });

  it('anchors interval cadence on the service start and rejects changing prices', () => {
    expect(
      estimateServicePriceForFourWeeks({
        price: { priceCents: 350, pricingUnit: 'visit', validUntil: null },
        serviceUnit: 'occurrence',
        quantity: '1',
        scheduleRule: { type: 'interval_days', intervalDays: 7 },
        validFrom: '2026-01-01',
        validUntil: null,
      }),
    ).toEqual({ totalCents: 1400, occurrences: 4 });
    expect(
      estimateServicePriceForFourWeeks({
        price: { priceCents: 350, pricingUnit: 'visit', validUntil: '2026-01-28' },
        serviceUnit: 'occurrence',
        quantity: '1',
        scheduleRule: { type: 'daily' },
        validFrom: '2026-01-01',
        validUntil: null,
      }),
    ).toEqual({ reason: 'priceBoundary' });
  });

  it('does not combine a line estimate that starts after the agreement period begins', () => {
    expect(
      estimateServicePriceForFourWeeks({
        price: { priceCents: 350, pricingUnit: 'visit', validUntil: null },
        serviceUnit: 'occurrence',
        quantity: '1',
        scheduleRule: { type: 'weekly', weekdays: ['monday'] },
        validFrom: '2026-01-01',
        validUntil: null,
        serviceValidFrom: '2026-01-08',
      }),
    ).toEqual({ reason: 'shortValidity' });
  });

  it('explains estimates that cannot be computed reliably', () => {
    const base = {
      price: { priceCents: 350, pricingUnit: 'visit' as const, validUntil: null },
      serviceUnit: 'occurrence' as const,
      quantity: '1',
      validFrom: '2026-01-01',
      validUntil: null,
    };
    expect(
      estimateServicePriceForFourWeeks({ ...base, scheduleRule: { type: 'on_demand' } }),
    ).toEqual({ reason: 'onDemand' });
    expect(
      estimateServicePriceForFourWeeks({
        ...base,
        scheduleRule: { type: 'daily' },
        validUntil: '2026-01-20',
      }),
    ).toEqual({ reason: 'shortValidity' });
    expect(
      estimateServicePriceForFourWeeks({
        ...base,
        price: { priceCents: 350, pricingUnit: 'hour', validUntil: null },
        scheduleRule: { type: 'daily' },
      }),
    ).toEqual({ reason: 'unitMismatch' });
  });
});
