import { describe, expect, mock, test } from 'bun:test';

import type { AuditWriter } from '@care/audit';
import * as publicBilling from '@care/billing';
import type { UnitOfWork } from '@care/database';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

import { BillingPaymentsApplicationService } from './payments.application';
import type { BillingInvoiceData } from './payments.ports';
import { BillingSettlementQueries } from './settlement-queries';

const principal: AuthorizationPrincipal = {
  userId: 'user',
  tenantId: 'tenant',
  grants: [{ permission: 'billing.payments.manage', scopeType: 'tenant', scopeId: 'tenant' }],
};
const input = {
  organizationId: 'organization',
  amountCents: 100,
  receivedAt: '2026-01-01T12:00:00Z',
  method: 'cash' as const,
};
const request = { requestId: 'request', correlationId: 'correlation' };
function fixture() {
  const transaction = mock(async () => {
    throw new Error('Unexpected database write');
  });
  const service = new BillingPaymentsApplicationService(
    { transaction } as UnitOfWork,
    {} as AuditWriter,
    {} as OutboxWriter,
    new BillingSettlementQueries(),
    {} as BillingInvoiceData,
  );
  return { service, transaction };
}

describe('payment preflight and package compatibility', () => {
  test.each([0, -1, 0.1, 2_000_000_001, Number.MAX_SAFE_INTEGER, NaN, Infinity])(
    'rejects invalid cent amounts before persistence (%s)',
    async (amountCents) => {
      const f = fixture();
      await expect(
        f.service.recordPayment(principal, { ...input, amountCents }, request, {}),
      ).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_INVALID' });
      expect(f.transaction).not.toHaveBeenCalled();
    },
  );
  test('preserves permission precedence and invalid date/reversal validation', async () => {
    const f = fixture();
    await expect(
      f.service.recordPayment(
        { ...principal, grants: [] },
        { ...input, amountCents: -1 },
        request,
        {},
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' });
    await expect(
      f.service.recordPayment(principal, { ...input, receivedAt: 'invalid' }, request, {}),
    ).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_INVALID' });
    await expect(
      f.service.reversePaymentAllocation(principal, 'allocation', '  ', request, {}),
    ).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_CONFLICT' });
    expect(f.transaction).not.toHaveBeenCalled();
  });
  test('keeps internal implementation classes out of the public export-star surface', () => {
    expect(publicBilling).not.toHaveProperty('BillingPaymentsApplicationService');
    expect(publicBilling).not.toHaveProperty('BillingSettlementQueries');
    expect(publicBilling).not.toHaveProperty('LegacyBillingInvoiceData');
    expect(publicBilling).toHaveProperty('BillingApplicationService');
    expect(publicBilling).toHaveProperty('readOperationsReceivableDeadlines');
  });
});
