import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lt, lte, or, sql } from 'drizzle-orm';

import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { assertCan } from '@care/permissions';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

import { ClaimPaymentAmountExceededError } from '@module/billing/claims/domain';

import { claims, claimDecisions } from '@module/billing/claims/schema';
import {
  InvalidBillingProfileError,
  PaymentAllocationExceededError,
  PaymentAmountInvalidError,
  PaymentNotFoundError,
  PaymentReversalConflictError,
  assertPaymentAllocation,
  type ReceivableStatus,
} from '@module/billing/domain/billing';

import { invoices, paymentAllocations, paymentReversals, payments } from '@module/billing/schema';

import type {
  PaymentAllocationInput,
  BillingPaymentView,
  BillingInvoiceView,
  RecordPaymentInput,
} from './payment.contracts';
import {
  optionalText,
  currentDate,
  billingScopeConditions,
  billingPaymentScopeConditions,
  requireOrganization,
  requireClient,
  auditRecord,
} from './billing-support';
import type { BillingInvoiceData } from './payments.ports';
import type { BillingSettlementQueries } from './settlement-queries';

type AuditContext = { ip?: string; userAgent?: string };

/** Internal payment/receivable orchestration; public callers continue through Billing. */
export class BillingPaymentsApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly settlement: BillingSettlementQueries,
    private readonly invoiceData: BillingInvoiceData,
  ) {}

  async recordPayment(
    principal: AuthorizationPrincipal,
    input: RecordPaymentInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingPaymentView> {
    requireOrganization(principal, 'billing.payments.manage', input.organizationId);
    const receivedAt = new Date(input.receivedAt);
    if (
      !input.organizationId ||
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > 2_000_000_000 ||
      Number.isNaN(receivedAt.valueOf()) ||
      !['bank_transfer', 'cash', 'other'].includes(input.method) ||
      (input.reference?.length ?? 0) > 500 ||
      (input.payerName?.length ?? 0) > 200 ||
      (input.payerReference?.length ?? 0) > 200
    )
      throw new PaymentAmountInvalidError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.invoiceData.requireOrganizationExists(
        transaction,
        principal.tenantId,
        input.organizationId,
      );
      const id = uuidv7();
      const now = new Date();
      const [payment] = await transaction
        .insert(payments)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          payerReference: optionalText(input.payerReference),
          payerNameSnapshot: optionalText(input.payerName),
          amountCents: input.amountCents,
          currency: 'EUR',
          receivedAt,
          method: input.method,
          reference: optionalText(input.reference),
          recordedBy: principal.userId,
          createdAt: now,
        })
        .returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'payment.recorded',
        aggregateType: 'payment',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          paymentId: id,
          organizationId: input.organizationId,
          amountCents: input.amountCents,
        },
      });
      await this.audit.append(
        transaction,
        auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'payment.recorded',
          resourceType: 'payment',
          resourceId: id,
          metadata: {
            organizationId: input.organizationId,
            amountCents: input.amountCents,
            method: input.method,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return this.paymentView(transaction, principal.tenantId, payment!);
    });
  }

  async allocatePayment(
    principal: AuthorizationPrincipal,
    input: PaymentAllocationInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [payment] = await transaction
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, principal.tenantId), eq(payments.id, input.paymentId)))
        .for('update')
        .limit(1);
      if (!payment) throw new PaymentNotFoundError();
      const invoice = await this.settlement.lockInvoice(
        transaction,
        principal.tenantId,
        input.invoiceId,
      );
      requireClient(
        principal,
        'billing.payments.manage',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      if (invoice.status !== 'issued' || invoice.organizationId !== payment.organizationId) {
        throw new PaymentAllocationExceededError();
      }
      let claim: typeof claims.$inferSelect | null = null;
      if (input.claimId) {
        const [linkedClaim] = await transaction
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.tenantId, principal.tenantId),
              eq(claims.id, input.claimId),
              eq(claims.invoiceId, invoice.id),
            ),
          )
          .for('update')
          .limit(1);
        if (!linkedClaim) throw new ClaimPaymentAmountExceededError();
        assertCan(principal, {
          action: 'claims.reconcile',
          resource: {
            tenantId: principal.tenantId,
            organizationId: linkedClaim.organizationId,
            facilityId: linkedClaim.facilityId,
            clientId: linkedClaim.clientId,
          },
        });
        if (!['accepted', 'partially_accepted', 'resubmitted'].includes(linkedClaim.status)) {
          throw new ClaimPaymentAmountExceededError();
        }
        const [decision] = await transaction
          .select({ acceptedCents: claimDecisions.acceptedCents })
          .from(claimDecisions)
          .where(
            and(
              eq(claimDecisions.tenantId, principal.tenantId),
              eq(claimDecisions.claimId, linkedClaim.id),
            ),
          )
          .orderBy(desc(claimDecisions.createdAt), desc(claimDecisions.id))
          .limit(1);
        const claimAllocations = await transaction
          .select({ allocation: paymentAllocations, reversal: paymentReversals })
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
              eq(paymentAllocations.tenantId, principal.tenantId),
              eq(paymentAllocations.claimId, linkedClaim.id),
            ),
          );
        const activeAllocations = claimAllocations.filter((row) => !row.reversal);
        const paidCents = activeAllocations.reduce(
          (total, row) => total + row.allocation.amountCents,
          0,
        );
        if (
          !decision ||
          activeAllocations.some((row) => row.allocation.paymentId === payment.id) ||
          input.amountCents > decision.acceptedCents - paidCents
        ) {
          throw new ClaimPaymentAmountExceededError();
        }
        claim = linkedClaim;
      }
      const paymentUsage = await this.settlement.paymentBalance(
        transaction,
        principal.tenantId,
        payment,
      );
      const receivable = await this.settlement.receivableFacts(transaction, invoice);
      assertPaymentAllocation({
        amountCents: input.amountCents,
        paymentRemainingCents: paymentUsage.remainingCents,
        invoiceOutstandingCents: receivable.outstandingCents,
      });
      const id = uuidv7();
      const now = new Date();
      await transaction.insert(paymentAllocations).values({
        id,
        tenantId: principal.tenantId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        claimId: claim?.id ?? null,
        amountCents: input.amountCents,
        createdBy: principal.userId,
        createdAt: now,
      });
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'payment.allocated',
        aggregateType: 'payment',
        aggregateId: payment.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          paymentId: payment.id,
          allocationId: id,
          invoiceId: invoice.id,
          amountCents: input.amountCents,
        },
      });
      await this.audit.append(
        transaction,
        auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'payment.allocated',
          resourceType: 'payment_allocation',
          resourceId: id,
          metadata: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amountCents: input.amountCents,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      if (claim) {
        const claimEvent = createDomainEvent({
          tenantId: principal.tenantId,
          type: 'claim.payment_linked',
          aggregateType: 'claim',
          aggregateId: claim.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload: { claimId: claim.id, paymentAllocationId: id, amountCents: input.amountCents },
        });
        await this.audit.append(
          transaction,
          auditRecord(principal, request, auditContext, {
            id: claimEvent.id,
            action: 'claim.payment_linked',
            resourceType: 'claim',
            resourceId: claim.id,
            metadata: { paymentAllocationId: id, amountCents: input.amountCents },
          }),
        );
        await this.outbox.enqueue(transaction, claimEvent);
      }
      return {
        id,
        paymentId: payment.id,
        invoiceId: invoice.id,
        claimId: claim?.id ?? null,
        amountCents: input.amountCents,
        createdAt: now.toISOString(),
      };
    });
  }

  async reversePaymentAllocation(
    principal: AuthorizationPrincipal,
    allocationId: string,
    reason: string,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const normalizedReason = optionalText(reason);
    if (!normalizedReason || normalizedReason.length > 1000)
      throw new PaymentReversalConflictError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [source] = await transaction
        .select()
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.tenantId, principal.tenantId),
            eq(paymentAllocations.id, allocationId),
          ),
        )
        .limit(1);
      if (!source) throw new PaymentNotFoundError();
      const [payment] = await transaction
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, principal.tenantId), eq(payments.id, source.paymentId)))
        .for('update')
        .limit(1);
      if (!payment) throw new PaymentNotFoundError();
      const invoice = await this.settlement.lockInvoice(
        transaction,
        principal.tenantId,
        source.invoiceId,
      );
      requireClient(
        principal,
        'billing.payments.manage',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      if (source.claimId) {
        const [claim] = await transaction
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.tenantId, principal.tenantId),
              eq(claims.id, source.claimId),
              eq(claims.invoiceId, invoice.id),
            ),
          )
          .for('update')
          .limit(1);
        if (!claim) throw new ClaimPaymentAmountExceededError();
        assertCan(principal, {
          action: 'claims.reconcile',
          resource: {
            tenantId: principal.tenantId,
            organizationId: claim.organizationId,
            facilityId: claim.facilityId,
            clientId: claim.clientId,
          },
        });
      }
      const [existing] = await transaction
        .select({ id: paymentReversals.id })
        .from(paymentReversals)
        .where(
          and(
            eq(paymentReversals.tenantId, principal.tenantId),
            eq(paymentReversals.allocationId, allocationId),
          ),
        )
        .limit(1);
      if (existing) throw new PaymentReversalConflictError();
      const id = uuidv7();
      const now = new Date();
      await transaction.insert(paymentReversals).values({
        id,
        tenantId: principal.tenantId,
        allocationId,
        reason: normalizedReason,
        reversedBy: principal.userId,
        reversedAt: now,
      });
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'payment.allocation_reversed',
        aggregateType: 'payment',
        aggregateId: payment.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          paymentId: payment.id,
          allocationId,
          invoiceId: invoice.id,
          amountCents: source.amountCents,
        },
      });
      await this.audit.append(
        transaction,
        auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'payment.allocation_reversed',
          resourceType: 'payment_allocation',
          resourceId: allocationId,
          metadata: { paymentId: payment.id, invoiceId: invoice.id, reason: normalizedReason },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return { allocationId, reversedAt: now.toISOString() };
    });
  }

  async listPayments(
    principal: AuthorizationPrincipal,
    query: {
      organizationId?: string;
      q?: string;
      from?: string;
      until?: string;
      method?: 'bank_transfer' | 'cash' | 'other';
      remainingOnly?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<BillingPaymentView[]> {
    return (await this.listPaymentsPage(principal, query)).items;
  }

  async listPaymentsPage(
    principal: AuthorizationPrincipal,
    query: {
      organizationId?: string;
      q?: string;
      from?: string;
      until?: string;
      method?: 'bank_transfer' | 'cash' | 'other';
      remainingOnly?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidBillingProfileError();
    }
    if (query.organizationId)
      requireOrganization(principal, 'billing.payments.read', query.organizationId);
    if (query.from && query.until && query.from > query.until) {
      throw new InvalidBillingProfileError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const where = [eq(payments.tenantId, principal.tenantId)];
      where.push(billingPaymentScopeConditions(principal) ?? sql`false`);
      if (query.organizationId) where.push(eq(payments.organizationId, query.organizationId));
      if (query.method) where.push(eq(payments.method, query.method));
      const receivedDate = sql<string>`(${payments.receivedAt} at time zone 'Europe/Berlin')::date::text`;
      if (query.from) where.push(gte(receivedDate, query.from));
      if (query.until) where.push(lte(receivedDate, query.until));
      const search = query.q?.trim();
      if (search) {
        const pattern = `%${search}%`;
        const matchingPaymentsByInvoice = transaction
          .select({ paymentId: paymentAllocations.paymentId })
          .from(paymentAllocations)
          .innerJoin(
            invoices,
            and(
              eq(invoices.tenantId, paymentAllocations.tenantId),
              eq(invoices.id, paymentAllocations.invoiceId),
            ),
          )
          .where(
            and(
              eq(paymentAllocations.tenantId, principal.tenantId),
              ilike(invoices.invoiceNumber, pattern),
            ),
          );
        where.push(
          or(
            ilike(payments.reference, pattern),
            ilike(payments.payerReference, pattern),
            ilike(payments.payerNameSnapshot, pattern),
            inArray(payments.id, matchingPaymentsByInvoice),
          )!,
        );
      }
      if (query.remainingOnly) {
        where.push(this.settlement.remainingPaymentCondition());
      }
      const whereClause = and(...where);
      const [countRows, rows] = await Promise.all([
        transaction.select({ total: count() }).from(payments).where(whereClause),
        transaction
          .select()
          .from(payments)
          .where(whereClause)
          .orderBy(desc(payments.receivedAt), desc(payments.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);
      const items = await Promise.all(
        rows.map((payment) => this.paymentView(transaction, principal.tenantId, payment)),
      );
      const total = Number(countRows[0]?.total ?? 0);
      return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
    });
  }

  async receivables(
    principal: AuthorizationPrincipal,
    query: {
      organizationId?: string;
      facilityId?: string;
      clientId?: string;
      recipientType?: 'client' | 'payer';
      q?: string;
      from?: string;
      until?: string;
      status?: 'open' | ReceivableStatus;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<BillingInvoiceView[]> {
    return (await this.receivablesPage(principal, query)).items;
  }

  async receivablesPage(
    principal: AuthorizationPrincipal,
    query: {
      organizationId?: string;
      facilityId?: string;
      clientId?: string;
      recipientType?: 'client' | 'payer';
      q?: string;
      from?: string;
      until?: string;
      status?: 'open' | ReceivableStatus;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidBillingProfileError();
    }
    if (query.from && query.until && query.from > query.until) {
      throw new InvalidBillingProfileError();
    }
    if (query.organizationId)
      requireOrganization(principal, 'billing.payments.read', query.organizationId);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { correctionsCents, paymentsCents, outstandingCents } =
        this.settlement.invoiceBalanceExpressions();
      const where = [
        eq(invoices.tenantId, principal.tenantId),
        eq(invoices.status, 'issued'),
        billingScopeConditions(principal, 'billing.payments.read') ?? sql`false`,
      ];
      if (query.organizationId) where.push(eq(invoices.organizationId, query.organizationId));
      if (query.facilityId) where.push(eq(invoices.facilityId, query.facilityId));
      if (query.clientId) where.push(eq(invoices.clientId, query.clientId));
      if (query.recipientType) where.push(eq(invoices.recipientType, query.recipientType));
      if (query.from) where.push(gte(invoices.dueDate, query.from));
      if (query.until) where.push(lte(invoices.dueDate, query.until));
      const selectedStatus = query.status ?? 'open';
      switch (selectedStatus) {
        case 'open':
          where.push(gt(outstandingCents, 0));
          break;
        case 'unpaid':
          where.push(
            gt(outstandingCents, 0),
            eq(paymentsCents, 0),
            gte(invoices.dueDate, currentDate()),
          );
          break;
        case 'partially_paid':
          where.push(
            gt(outstandingCents, 0),
            gt(paymentsCents, 0),
            gte(invoices.dueDate, currentDate()),
          );
          break;
        case 'paid':
          where.push(eq(outstandingCents, 0), lt(correctionsCents, invoices.grandTotalCents));
          break;
        case 'overdue':
          where.push(gt(outstandingCents, 0), lt(invoices.dueDate, currentDate()));
          break;
        case 'corrected':
          where.push(eq(correctionsCents, invoices.grandTotalCents), eq(paymentsCents, 0));
          break;
      }
      const search = query.q?.trim();
      if (search) {
        const pattern = `%${search}%`;

        where.push(
          or(
            ilike(invoices.invoiceNumber, pattern),
            ilike(sql`coalesce(${invoices.recipientSnapshot}->>'name', '')`, pattern),
            this.invoiceData.matchingClientCondition(transaction, principal.tenantId, pattern),
          )!,
        );
      }
      const whereClause = and(...where);
      const [countRows, rows] = await Promise.all([
        transaction.select({ total: count() }).from(invoices).where(whereClause),
        transaction
          .select()
          .from(invoices)
          .where(whereClause)
          .orderBy(asc(invoices.dueDate), desc(invoices.issueDate), asc(invoices.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);
      const items = await Promise.all(
        rows.map((invoice) => this.invoiceData.invoiceView(transaction, principal, invoice)),
      );
      const total = Number(countRows[0]?.total ?? 0);
      return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
    });
  }

  private async paymentView(
    transaction: DatabaseTransaction,
    tenantId: string,
    payment: typeof payments.$inferSelect,
  ): Promise<BillingPaymentView> {
    const usage = await this.settlement.paymentBalance(transaction, tenantId, payment);
    const allocationHistory = await transaction
      .select({
        allocationId: paymentAllocations.id,
        invoiceId: paymentAllocations.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        amountCents: paymentAllocations.amountCents,
        allocatedAt: paymentAllocations.createdAt,
        reversedAt: paymentReversals.reversedAt,
        reversalReason: paymentReversals.reason,
      })
      .from(paymentAllocations)
      .innerJoin(
        invoices,
        and(
          eq(invoices.tenantId, paymentAllocations.tenantId),
          eq(invoices.id, paymentAllocations.invoiceId),
        ),
      )
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
        ),
      )
      .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
    return {
      id: payment.id,
      organizationId: payment.organizationId,
      payerReference: payment.payerReference,
      payerNameSnapshot: payment.payerNameSnapshot,
      amountCents: payment.amountCents,
      currency: payment.currency,
      receivedAt: payment.receivedAt,
      method: payment.method,
      reference: payment.reference,
      allocatedCents: usage.allocatedCents,
      remainingCents: usage.remainingCents,
      allocationHistory,
    };
  }
}
