import { and, asc, eq, gte, lte, inArray, isNotNull } from 'drizzle-orm';

import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import { AuthorizationDeniedError, can, type AuthorizationPrincipal } from '@care/permissions';

import { clientBenefitEntitlements, benefitFundingSources } from '@module/benefits/schema';

export interface BenefitEntitlementExpiryQuery {
  fromDate: string;
  untilDate: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  offset: number;
  pageSize: 100;
}
export interface BenefitEntitlementExpiryFact {
  id: string;
  organizationId: string | null;
  facilityId: string | null;
  validUntil: string | null;
  clientId: string;
  clientName: string;
}

export class BenefitEntitlementExpiryQueries {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: Pick<ClientApplicationService, 'operationsDeadlineContexts'>,
  ) {}
  async operationsExpiryPage(
    principal: AuthorizationPrincipal,
    query: BenefitEntitlementExpiryQuery,
  ): Promise<{ items: BenefitEntitlementExpiryFact[]; complete: boolean }> {
    if (!Number.isInteger(query.offset) || query.offset < 0 || query.pageSize !== 100)
      throw new RangeError('Expiry pages require a nonnegative offset and page size 100');
    if (!principal.grants.some((g) => g.permission === 'benefits.review'))
      throw new AuthorizationDeniedError('benefits.review');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          id: clientBenefitEntitlements.id,
          clientId: clientBenefitEntitlements.clientId,
          validUntil: clientBenefitEntitlements.validUntil,
        })
        .from(clientBenefitEntitlements)
        .innerJoin(
          benefitFundingSources,
          and(
            eq(benefitFundingSources.tenantId, clientBenefitEntitlements.tenantId),
            eq(benefitFundingSources.clientId, clientBenefitEntitlements.clientId),
            eq(benefitFundingSources.id, clientBenefitEntitlements.fundingSourceId),
            eq(benefitFundingSources.status, 'active'),
          ),
        )
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, principal.tenantId),
            inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional']),
            isNotNull(clientBenefitEntitlements.validUntil),
            gte(clientBenefitEntitlements.validUntil, query.fromDate),
            lte(clientBenefitEntitlements.validUntil, query.untilDate),
            ...(query.clientId ? [eq(clientBenefitEntitlements.clientId, query.clientId)] : []),
          ),
        )
        .orderBy(asc(clientBenefitEntitlements.validUntil), asc(clientBenefitEntitlements.id))
        .limit(100)
        .offset(query.offset);
      const contexts = await this.clients.operationsDeadlineContexts(
        transaction,
        principal,
        rows.map((row) => ({ clientId: row.clientId })),
        'benefits.review',
      );
      const byClient = new Map(contexts.map((row) => [row.clientId, row]));
      const items = rows.flatMap((row) => {
        const context = byClient.get(row.clientId);
        if (!context) return [];
        const fact = { ...row, ...context };
        if (
          !can(principal, {
            action: 'benefits.review',
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
