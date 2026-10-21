import type { invoiceLines, invoiceCorrections } from '@module/billing/schema';
import type { ReceivableStatus } from '@module/billing/domain/billing';
export interface PaymentAllocationInput {
  paymentId: string;
  invoiceId: string;
  claimId?: string | null;
  amountCents: number;
}

export interface BillingPaymentView {
  id: string;
  organizationId: string;
  payerReference: string | null;
  payerNameSnapshot: string | null;
  amountCents: number;
  currency: 'EUR';
  receivedAt: Date;
  method: 'bank_transfer' | 'cash' | 'other';
  reference: string | null;
  allocatedCents: number;
  remainingCents: number;
  allocationHistory: Array<{
    allocationId: string;
    invoiceId: string;
    invoiceNumber: string | null;
    amountCents: number;
    allocatedAt: Date;
    reversedAt: Date | null;
    reversalReason: string | null;
  }>;
}

export interface BillingInvoiceView {
  id: string;
  organizationId: string;
  facilityId: string;
  clientId: string;
  clientName: string;
  recipientName: string | null;
  recipientAddress: string | null;
  payerArrangementId: string | null;
  recipientType: 'client' | 'payer';
  invoiceNumber: string | null;
  issueDate: string | null;
  servicePeriodFrom: string | null;
  servicePeriodUntil: string | null;
  dueDate: string | null;
  currency: 'EUR';
  subtotalCents: number;
  taxTotalCents: number;
  grandTotalCents: number;
  status: 'draft' | 'issued' | 'cancelled';
  version: number;
  issuerSnapshot: Record<string, unknown> | null;
  recipientSnapshot: Record<string, unknown> | null;
  lines: Array<typeof invoiceLines.$inferSelect>;
  corrections: Array<typeof invoiceCorrections.$inferSelect>;
  paymentHistory: Array<{
    allocationId: string;
    paymentId: string;
    amountCents: number;
    allocatedAt: Date;
    method: 'bank_transfer' | 'cash' | 'other';
    receivedAt: Date;
    reference: string | null;
    payerNameSnapshot: string | null;
    reversedAt: Date | null;
    reversalReason: string | null;
  }>;
  pdfStatus: 'pending' | 'ready' | 'failed' | null;
  receivableStatus: ReceivableStatus | null;
  paidCents: number;
  outstandingCents: number | null;
  evidenceDiscrepancy: boolean;
}

export interface RecordPaymentInput {
  organizationId: string;
  payerReference?: string | null;
  payerName?: string | null;
  amountCents: number;
  receivedAt: string;
  method: 'bank_transfer' | 'cash' | 'other';
  reference?: string | null;
}
