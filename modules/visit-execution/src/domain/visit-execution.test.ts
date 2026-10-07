import { describe, expect, test } from 'bun:test';
import {
  InvalidPerformedServiceQuantityError,
  InvalidPerformedServiceStatusError,
  validateServiceDecision,
} from './visit-execution';

describe('performed service decisions', () => {
  test('preserves planned quantity while accepting an actual quantity', () => {
    expect(() =>
      validateServiceDecision({
        status: 'partially_performed',
        plannedQuantity: '30.000',
        actualQuantity: '20.000',
      }),
    ).not.toThrow();
  });

  test('requires positive quantity for performed services', () => {
    expect(() =>
      validateServiceDecision({
        status: 'performed',
        plannedQuantity: '1.000',
        actualQuantity: '0',
      }),
    ).toThrow(InvalidPerformedServiceQuantityError);
  });

  test('requires a reason and zero or no quantity when not performed', () => {
    expect(() =>
      validateServiceDecision({
        status: 'not_performed',
        plannedQuantity: '1.000',
        actualQuantity: null,
      }),
    ).toThrow(InvalidPerformedServiceStatusError);
    expect(() =>
      validateServiceDecision({
        status: 'not_performed',
        plannedQuantity: '1.000',
        actualQuantity: '0',
        reasonCode: 'client_declined',
      }),
    ).not.toThrow();
  });

  test('rejects partial quantities that are zero or reach planned quantity', () => {
    for (const actualQuantity of ['0', '1']) {
      expect(() =>
        validateServiceDecision({
          status: 'partially_performed',
          plannedQuantity: '1',
          actualQuantity,
        }),
      ).toThrow(InvalidPerformedServiceQuantityError);
    }
  });

  test('accepts precise unplanned quantities without mutating a planned quantity', () => {
    expect(() =>
      validateServiceDecision({
        status: 'performed',
        plannedQuantity: null,
        actualQuantity: '0.125',
      }),
    ).not.toThrow();
  });

  test('rejects partial and invalid precision quantities without a valid plan', () => {
    expect(() =>
      validateServiceDecision({
        status: 'partially_performed',
        plannedQuantity: null,
        actualQuantity: '0.5',
      }),
    ).toThrow(InvalidPerformedServiceQuantityError);
    for (const input of [
      { status: 'performed' as const, plannedQuantity: '1', actualQuantity: '1.0000' },
      {
        status: 'not_performed' as const,
        plannedQuantity: '1',
        actualQuantity: '0.001',
        reasonCode: 'client_declined',
      },
    ]) {
      expect(() => validateServiceDecision(input)).toThrow(InvalidPerformedServiceQuantityError);
    }
  });

  test('rejects unknown reason codes and requires reasons for not-performed results', () => {
    expect(() =>
      validateServiceDecision({
        status: 'not_performed',
        plannedQuantity: '1',
        actualQuantity: null,
      }),
    ).toThrow(InvalidPerformedServiceStatusError);
    expect(() =>
      validateServiceDecision({
        status: 'performed',
        plannedQuantity: '1',
        actualQuantity: '1',
        reasonCode: 'unregistered_reason',
      }),
    ).toThrow(InvalidPerformedServiceStatusError);
  });
});
