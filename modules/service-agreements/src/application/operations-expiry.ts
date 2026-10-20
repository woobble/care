import { and, asc, eq, gte, lte, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import {
  AuthorizationDeniedError,
  can,
  type AuthorizationPrincipal,
  type Permission,
} from '@care/permissions';

import { agreements } from '@module/service-agreements/schema';

export interface AgreementExpiryQuery {
  fromDate: string;
  untilDate: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  offset: number;
  pageSize: 100;
}
export interface AgreementExpiryFact {
  id: string;
  organizationId: string;
  facilityId: string | null;
  validUntil: string | null;
  clientId: string;
  clientName: string;
}

export class AgreementExpiryQueries {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: Pick<ClientApplicationService, 'operationsDeadlineContexts'>,
  ) {}
  async operationsExpiryPage(
    principal: AuthorizationPrincipal,
    query: AgreementExpiryQuery,
  ): Promise<{ items: AgreementExpiryFact[]; complete: boolean }> {
    if (!Number.isInteger(query.offset) || query.offset < 0 || query.pageSize !== 100)
      throw new RangeError('Expiry pages require a nonnegative offset and page size 100');
    if (!principal.grants.some((g) => g.permission === 'service_agreement.read'))
      throw new AuthorizationDeniedError('service_agreement.read');
    const agreementScope = permissionScope(principal, 'service_agreement.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          id: agreements.id,
          clientId: agreements.clientId,
          organizationId: agreements.organizationId,
          facilityId: agreements.facilityId,
          validUntil: agreements.validUntil,
        })
        .from(agreements)
        .where(
          and(
            eq(agreements.tenantId, principal.tenantId),
            inArray(agreements.status, ['active', 'suspended']),
            scopedTo(agreementScope, agreements.organizationId, agreements.facilityId),
            ...(query.organizationId ? [eq(agreements.organizationId, query.organizationId)] : []),
            ...(query.facilityId ? [eq(agreements.facilityId, query.facilityId)] : []),
            ...(query.clientId ? [eq(agreements.clientId, query.clientId)] : []),
            isNotNull(agreements.validUntil),
            gte(agreements.validUntil, query.fromDate),
            lte(agreements.validUntil, query.untilDate),
          ),
        )
        .orderBy(asc(agreements.validUntil), asc(agreements.id))
        .limit(100)
        .offset(query.offset);
      const contexts = await this.clients.operationsDeadlineContexts(
        transaction,
        principal,
        rows.map((row) => ({
          clientId: row.clientId,
          organizationId: row.organizationId,
          facilityId: row.facilityId,
        })),
        'service_agreement.read',
      );
      const byClient = new Map(contexts.map((row) => [row.clientId, row]));
      const items = rows.flatMap((row) => {
        const context = byClient.get(row.clientId);
        if (!context) return [];
        const fact = {
          ...row,
          ...context,
          organizationId: row.organizationId,
          facilityId: row.facilityId,
        };
        if (
          !can(principal, {
            action: 'service_agreement.read',
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
function permissionScope(principal: AuthorizationPrincipal, permission: Permission) {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  return {
    tenantWide: grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: grants
      .filter((grant) => grant.scopeType === 'organization')
      .map((grant) => grant.scopeId),
    facilityIds: grants
      .filter((grant) => grant.scopeType === 'facility')
      .map((grant) => grant.scopeId),
  };
}

function scopedTo(
  scope: ReturnType<typeof permissionScope>,
  organizationColumn: AnyPgColumn,
  facilityColumn: AnyPgColumn,
): SQL {
  if (scope.tenantWide) return sql`true`;
  const allowed: SQL[] = [];
  if (scope.organizationIds.length)
    allowed.push(inArray(organizationColumn, scope.organizationIds));
  if (scope.facilityIds.length) allowed.push(inArray(facilityColumn, scope.facilityIds));
  return allowed.length ? or(...allowed)! : sql`false`;
}
