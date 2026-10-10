import { describe, expect, test } from 'bun:test';
import {
  assertAvailableAmount,
  assertCorrectionAmount,
  assertPaymentAllocation,
  calculateInvoiceAmounts,
  calculateServiceAmountCents,
  deriveReceivableStatus,
  formatCorrectionNumber,
  formatInvoiceNumber,
  hasRequiredTaxIdentifier,
  BillingAmountExceededError,
  InvalidInvoiceCorrectionError,
  PaymentAllocationExceededError,
} from './billing';

describe('billing money and lifecycle rules', () => {
  test('prices visit and hourly services with the service catalog unit semantics', () => {
    expect(
      calculateServiceAmountCents({
        unitPriceCents: 4_500,
        pricingUnit: 'visit',
        serviceUnit: 'occurrence',
        quantity: '1',
      }),
    ).toBe(4_500);
    expect(
      calculateServiceAmountCents({
        unitPriceCents: 1_500,
        pricingUnit: 'hour',
        serviceUnit: 'hour',
        quantity: '1.5',
      }),
    ).toBe(2_250);
  });

  test('splits a gross price into net and tax with integer half-up rounding', () => {
    expect(calculateInvoiceAmounts(10_000, 'taxable', 1_900)).toEqual({
      netCents: 8_403,
      taxCents: 1_597,
      grossCents: 10_000,
    });
    expect(calculateInvoiceAmounts(4_500, 'tax_exempt', null)).toEqual({
      netCents: 4_500,
      taxCents: 0,
      grossCents: 4_500,
    });
  });

  test('derives unpaid, partial, paid, and overdue balances from facts', () => {
    const base = {
      invoiceCents: 10_000,
      correctionsCents: 0,
      dueDate: '2026-01-31',
      asOfDate: '2026-01-15',
    };
    expect(deriveReceivableStatus({ ...base, paymentsCents: 0 }).status).toBe('unpaid');
    expect(deriveReceivableStatus({ ...base, paymentsCents: 2_000 }).status).toBe('partially_paid');
    expect(deriveReceivableStatus({ ...base, paymentsCents: 10_000 }).status).toBe('paid');
    expect(
      deriveReceivableStatus({
        ...base,
        invoiceCents: 10_000,
        correctionsCents: 10_000,
        paymentsCents: 0,
      }).status,
    ).toBe('corrected');
    expect(
      deriveReceivableStatus({ ...base, dueDate: '2026-01-01', paymentsCents: 2_000 }).status,
    ).toBe('overdue');
  });

  test('limits reservations, payment allocations, corrections, and provider numbering', () => {
    expect(() => assertAvailableAmount(500, 499)).toThrow(BillingAmountExceededError);
    expect(() =>
      assertPaymentAllocation({
        amountCents: 501,
        paymentRemainingCents: 500,
        invoiceOutstandingCents: 1_000,
      }),
    ).toThrow(PaymentAllocationExceededError);
    expect(() => assertCorrectionAmount(500, 499)).toThrow(InvalidInvoiceCorrectionError);
    expect(formatInvoiceNumber('CARE-', 2026, 1)).toBe('CARE-2026-000001');
    expect(formatCorrectionNumber('CARE-', 2026, 2)).toBe('CARE-RK-2026-000002');
    expect(formatCorrectionNumber('CARE', 2026, 2)).toBe('CARE-RK-2026-000002');
    expect(formatCorrectionNumber('', 2026, 2)).toBe('RK-2026-000002');
  });

  test('requires an issuer tax identifier only above the small-invoice threshold', () => {
    expect(hasRequiredTaxIdentifier(25_000, null, null)).toBe(true);
    expect(hasRequiredTaxIdentifier(25_001, null, null)).toBe(false);
    expect(hasRequiredTaxIdentifier(25_001, '  12/345/67890  ', null)).toBe(true);
    expect(hasRequiredTaxIdentifier(25_001, null, ' DE123456789 ')).toBe(true);
  });
});
