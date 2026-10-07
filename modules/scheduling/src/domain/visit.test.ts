import { describe, expect, test } from 'bun:test';
import {
  InvalidVisitDataError,
  InvalidVisitServiceError,
  InvalidVisitStatusError,
  VisitCancelledError,
  VisitLifecycle,
  isPositiveQuantity,
  validateVisit,
  validateVisitService,
} from './visit';

describe('visit planning invariants', () => {
  const start = new Date('2026-10-07T07:00:00Z');
  const end = new Date('2026-10-07T07:30:00Z');

  test('requires a concrete increasing interval and an agreement for generated origin', () => {
    expect(() =>
      validateVisit({
        origin: 'manual',
        serviceAgreementId: null,
        plannedStart: start,
        plannedEnd: end,
        timeWindowStart: null,
        timeWindowEnd: null,
        timezone: 'Europe/Berlin',
        note: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateVisit({
        origin: 'manual',
        serviceAgreementId: null,
        plannedStart: end,
        plannedEnd: start,
        timeWindowStart: null,
        timeWindowEnd: null,
        timezone: 'Europe/Berlin',
        note: null,
      }),
    ).toThrow(InvalidVisitDataError);
    expect(() =>
      validateVisit({
        origin: 'agreement_generated',
        serviceAgreementId: null,
        plannedStart: start,
        plannedEnd: end,
        timeWindowStart: null,
        timeWindowEnd: null,
        timezone: 'Europe/Berlin',
        note: null,
      }),
    ).toThrow(InvalidVisitDataError);
  });

  test('accepts positive fixed precision quantity and rejects invalid quantity or duration', () => {
    expect(isPositiveQuantity('0.125')).toBe(true);
    expect(isPositiveQuantity('0')).toBe(false);
    expect(isPositiveQuantity('1.0000')).toBe(false);
    expect(() =>
      validateVisitService({
        serviceCodeSnapshot: 'SVC',
        serviceNameSnapshot: 'Pflege',
        plannedQuantity: '1',
        plannedDurationMinutes: 0,
      }),
    ).toThrow(InvalidVisitServiceError);
  });

  test('allows only planned/confirmed planning transitions and preserves cancelled history', () => {
    const lifecycle = new VisitLifecycle('planned');
    expect(lifecycle.confirm()).toBe('confirmed');
    expect(lifecycle.unconfirm()).toBe('planned');
    expect(lifecycle.cancel()).toBe('cancelled');
    expect(() => lifecycle.confirm()).toThrow(VisitCancelledError);
    expect(() => new VisitLifecycle('planned').unconfirm()).toThrow(InvalidVisitStatusError);
  });
});
