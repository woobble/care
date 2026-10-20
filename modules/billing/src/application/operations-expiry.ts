import { and, asc, eq, gte, lte, isNotNull } from 'drizzle-orm';

import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import { AuthorizationDeniedError, can, type AuthorizationPrincipal } from '@care/permissions';

import { payerArrangements } from '@module/billing/schema';

export interface PayerArrangementExpiryQuery {
  fromDate: string;
  untilDate: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  offset: number;
  pageSize: 100;
  effectiveOn: string;
}
export interface PayerArrangementExpiryFact {
  id: string;
  organizationId: string;
  facilityId: string | null;
  validUntil: string | null;
  clientId: string;
  clientName: string;
}

export class PayerArrangementExpiryQueries {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: Pick<ClientApplicationService, 'operationsDeadlineContexts'>,
  ) {}
  async operationsExpiryPage(
    principal: AuthorizationPrincipal,
    query: PayerArrangementExpiryQuery,
  ): Promise<{ items: PayerArrangementExpiryFact[]; complete: boolean }> {
    if (!Number.isInteger(query.offset) || query.offset < 0 || query.pageSize !== 100)
      throw new RangeError('Expiry pages require a nonnegative offset and page size 100');
    if (!principal.grants.some((g) => g.permission === 'billing.read'))
      throw new AuthorizationDeniedError('billing.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          id: payerArrangements.id,
          clientId: payerArrangements.clientId,
          organizationId: payerArrangements.organizationId,
          validUntil: payerArrangements.validUntil,
        })
        .from(payerArrangements)
        .where(
          and(
            eq(payerArrangements.tenantId, principal.tenantId),
            eq(payerArrangements.mandateStatus, 'authorized'),
            lte(payerArrangements.validFrom, query.effectiveOn),
            isNotNull(payerArrangements.validUntil),
            gte(payerArrangements.validUntil, query.fromDate),
            lte(payerArrangements.validUntil, query.untilDate),
            ...(query.clientId ? [eq(payerArrangements.clientId, query.clientId)] : []),
          ),
        )
        .orderBy(asc(payerArrangements.validUntil), asc(payerArrangements.id))
        .limit(100)
        .offset(query.offset);
      const contexts = await this.clients.operationsDeadlineContexts(
        transaction,
        principal,
        rows.map((row) => ({ clientId: row.clientId, organizationId: row.organizationId })),
        'billing.read',
      );
      const byClient = new Map(contexts.map((row) => [row.clientId, row]));
      const items = rows.flatMap((row) => {
        const context = byClient.get(row.clientId);
        if (!context) return [];
        const fact = { ...row, ...context, organizationId: row.organizationId };
        if (
          !can(principal, {
            action: 'billing.read',
            resource: {
              tenantId: principal.tenantId,
              ...(fact.organizationId ? { organizationId: fact.organizationId } : {}),
              ...(fact.facilityId ? { facilityId: fact.facilityId } : {}),
              clientId: fact.clientId,
            },
          })
        )
          return [];
        if (query.organizationId && fact.organizationId !== query.organizationId) return [];
        if (query.facilityId && fact.facilityId !== query.facilityId) return [];
        return [fact];
      });
      // Completeness describes the raw source scan, even when every row was unauthorized.
      return { items, complete: rows.length < query.pageSize };
    });
  }
}
