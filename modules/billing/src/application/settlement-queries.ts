import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';

import {
  InvoiceNotFoundError,
  PaymentAllocationExceededError,
} from '@module/billing/domain/billing';

import {
  invoiceCorrections,
  invoices,
  paymentAllocations,
  paymentReversals,
  payments,
} from '@module/billing/schema';

/** Billing-owned settlement reads. Every operation uses the caller transaction. */
export class BillingSettlementQueries {
  async lockInvoice(transaction: DatabaseTransaction, tenantId: string, invoiceId: string) {
    const [invoice] = await transaction
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .for('update')
      .limit(1);
    if (!invoice) throw new InvoiceNotFoundError();
    return invoice;
  }

  async receivableFacts(
    transaction: DatabaseTransaction,
    invoice: typeof invoices.$inferSelect,
  ): Promise<{ correctionsCents: number; paymentsCents: number; outstandingCents: number }> {
    return (await receivableFactsByInvoice(transaction, [invoice])).get(invoice.id)!;
  }

  async paymentBalance(
    transaction: DatabaseTransaction,
    tenantId: string,
    payment: Pick<typeof payments.$inferSelect, 'id' | 'amountCents'>,
  ) {
    const active = await transaction
      .select({ amountCents: paymentAllocations.amountCents })
      .from(paymentAllocations)
      .leftJoin(
        paymentReversals,
        and(
          eq(paymentReversals.tenantId, paymentAllocations.tenantId),
          eq(paymentReversals.allocationId, paymentAllocations.id),
        ),
      )
      .where(
        and(
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.paymentId, payment.id),
          isNull(paymentReversals.id),
        ),
      );
    const allocatedCents = active.reduce((sum, row) => sum + row.amountCents, 0);
    return { allocatedCents, remainingCents: payment.amountCents - allocatedCents };
  }

  invoiceBalanceExpressions() {
    const correctionsCents = sql<number>`coalesce((
          select sum(${invoiceCorrections.amountCents})
          from ${invoiceCorrections}
          where ${invoiceCorrections.tenantId} = ${invoices.tenantId}
            and ${invoiceCorrections.invoiceId} = ${invoices.id}
        ), 0)`;
    const paymentsCents = sql<number>`coalesce((
          select sum(${paymentAllocations.amountCents})
          from ${paymentAllocations}
          where ${paymentAllocations.tenantId} = ${invoices.tenantId}
            and ${paymentAllocations.invoiceId} = ${invoices.id}
            and not exists (
              select 1
              from ${paymentReversals}
              where ${paymentReversals.tenantId} = ${paymentAllocations.tenantId}
                and ${paymentReversals.allocationId} = ${paymentAllocations.id}
            )
        ), 0)`;
    const outstandingCents = sql<number>`
        ${invoices.grandTotalCents} - ${correctionsCents} - ${paymentsCents}
      `;
    return { correctionsCents, paymentsCents, outstandingCents };
  }
  remainingPaymentCondition() {
    return sql`${payments.amountCents} > coalesce((
          select sum(${paymentAllocations.amountCents})
          from ${paymentAllocations}
          where ${paymentAllocations.tenantId} = ${payments.tenantId}
            and ${paymentAllocations.paymentId} = ${payments.id}
            and not exists (
              select 1
              from ${paymentReversals}
              where ${paymentReversals.tenantId} = ${paymentAllocations.tenantId}
                and ${paymentReversals.allocationId} = ${paymentAllocations.id}
            )
        ), 0)`;
  }
}

export async function receivableFactsByInvoice(
  transaction: DatabaseTransaction,
  invoicesToCheck: Array<Pick<typeof invoices.$inferSelect, 'id' | 'tenantId' | 'grandTotalCents'>>,
) {
  if (!invoicesToCheck.length) return new Map();
  const tenantId = invoicesToCheck[0]!.tenantId;
  const invoiceIds = invoicesToCheck.map((invoice) => invoice.id);
  const corrections = await transaction
    .select({
      invoiceId: invoiceCorrections.invoiceId,
      amountCents: sql<number>`coalesce(sum(${invoiceCorrections.amountCents}), 0)::int`,
    })
    .from(invoiceCorrections)
    .where(
      and(
        eq(invoiceCorrections.tenantId, tenantId),
        inArray(invoiceCorrections.invoiceId, invoiceIds),
      ),
    )
    .groupBy(invoiceCorrections.invoiceId);
  const paymentsForInvoices = await transaction
    .select({
      invoiceId: paymentAllocations.invoiceId,
      amountCents: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::int`,
    })
    .from(paymentAllocations)
    .leftJoin(
      paymentReversals,
      and(
        eq(paymentReversals.tenantId, paymentAllocations.tenantId),
        eq(paymentReversals.allocationId, paymentAllocations.id),
      ),
    )
    .where(
      and(
        eq(paymentAllocations.tenantId, tenantId),
        inArray(paymentAllocations.invoiceId, invoiceIds),
        isNull(paymentReversals.id),
      ),
    )
    .groupBy(paymentAllocations.invoiceId);
  const correctedCentsByInvoice = new Map(
    corrections.map((row) => [row.invoiceId, row.amountCents]),
  );
  const paidCentsByInvoice = new Map(
    paymentsForInvoices.map((row) => [row.invoiceId, row.amountCents]),
  );
  const result = new Map<
    string,
    { correctionsCents: number; paymentsCents: number; outstandingCents: number }
  >();
  for (const invoice of invoicesToCheck) {
    const correctionsCents = correctedCentsByInvoice.get(invoice.id) ?? 0;
    const paymentsCents = paidCentsByInvoice.get(invoice.id) ?? 0;
    const outstandingCents = invoice.grandTotalCents - correctionsCents - paymentsCents;
    if (outstandingCents < 0) throw new PaymentAllocationExceededError();
    result.set(invoice.id, { correctionsCents, paymentsCents, outstandingCents });
  }
  return result;
}
