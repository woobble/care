import type { SQL } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { invoices, invoiceLines } from '@module/billing/schema';

import type { BillingInvoiceView } from './payment.contracts';

/** Existing enrichment/foreign queries, always in a supplied transaction. */
export interface BillingInvoiceData {
  invoiceView(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    invoice: typeof invoices.$inferSelect,
    suppliedLines?: Array<typeof invoiceLines.$inferSelect>,
  ): Promise<BillingInvoiceView>;
  requireOrganizationExists(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<void>;
  matchingClientCondition(transaction: DatabaseTransaction, tenantId: string, pattern: string): SQL;
}
