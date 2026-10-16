import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';
import { facilities, organizationsTable } from '@care/organizations';
import type { ClientSnapshot, ClientStatus } from '@module/clients/domain/client';
import { clientInsurances, clientRecords, pflegegradRecords } from '@module/clients/schema';

export interface ClientScopeFilter {
  tenantWide: boolean;
  organizationIds: readonly string[];
  facilityIds: readonly string[];
}

export interface ClientSearchFilter {
  tenantId: string;
  access: ClientScopeFilter;
  identifierAccess: ClientScopeFilter;
  text?: string;
  status?: ClientStatus;
  organizationId?: string;
  facilityId?: string;
  pflegegrad?: number;
  validAt: string;
  page: number;
  pageSize: number;
  sortBy: 'lastName' | 'firstName' | 'createdAt' | 'dateOfBirth';
  sortOrder: 'asc' | 'desc';
}

export interface ClientSearchItem {
  client: {
    id: string;
    organizationId: string | null;
    primaryFacilityId: string | null;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    dateOfBirth: string | null;
    status: ClientStatus;
  };
  organizationName: string | null;
  facilityName: string | null;
  currentPflegegrad: number | null;
}

export class ClientRepository {
  async insert(transaction: DatabaseTransaction, client: ClientSnapshot): Promise<void> {
    await transaction.insert(clientRecords).values(toRow(client));
  }

  async findById(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<ClientSnapshot | null> {
    const query = transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, id)));
    const rows = lock ? await query.for('update').limit(1) : await query.limit(1);
    const row = rows[0];
    return row ? toSnapshot(row) : null;
  }

  async update(transaction: DatabaseTransaction, client: ClientSnapshot): Promise<void> {
    await transaction
      .update(clientRecords)
      .set(toRow(client))
      .where(and(eq(clientRecords.tenantId, client.tenantId), eq(clientRecords.id, client.id)));
  }

  async search(
    transaction: DatabaseTransaction,
    input: ClientSearchFilter,
  ): Promise<{ items: ClientSearchItem[]; total: number }> {
    const filters: SQL[] = [eq(clientRecords.tenantId, input.tenantId)];
    filters.push(clientScopePredicate(input.access, input.tenantId));
    if (input.text?.trim()) {
      const term = input.text
        .trim()
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      const pattern = `%${term}%`;
      const matches: SQL[] = [
        ilike(sql<string>`${clientRecords.firstName} || ' ' || ${clientRecords.lastName}`, pattern),
        ilike(clientRecords.preferredName, pattern),
        ilike(clientRecords.email, pattern),
        ilike(clientRecords.phone, pattern),
        ilike(clientRecords.mobile, pattern),
      ];
      if (
        input.identifierAccess.tenantWide ||
        input.identifierAccess.organizationIds.length > 0 ||
        input.identifierAccess.facilityIds.length > 0
      ) {
        matches.push(
          and(
            clientScopePredicate(input.identifierAccess, input.tenantId),
            exists(
              transaction
                .select({ id: clientInsurances.id })
                .from(clientInsurances)
                .where(
                  and(
                    eq(clientInsurances.tenantId, input.tenantId),
                    eq(clientInsurances.clientId, clientRecords.id),
                    or(
                      ilike(clientInsurances.insuranceNumber, pattern),
                      ilike(clientInsurances.memberNumber, pattern),
                    ),
                  ),
                ),
            ),
          )!,
        );
      }
      filters.push(or(...matches)!);
    }
    if (input.status) filters.push(eq(clientRecords.status, input.status));
    if (input.organizationId) filters.push(eq(clientRecords.organizationId, input.organizationId));
    if (input.facilityId) filters.push(eq(clientRecords.primaryFacilityId, input.facilityId));
    if (input.pflegegrad !== undefined) {
      filters.push(
        exists(
          transaction
            .select({ id: pflegegradRecords.id })
            .from(pflegegradRecords)
            .where(
              and(
                eq(pflegegradRecords.tenantId, input.tenantId),
                eq(pflegegradRecords.clientId, clientRecords.id),
                eq(pflegegradRecords.grade, input.pflegegrad),
                eq(pflegegradRecords.status, 'confirmed'),
                lte(pflegegradRecords.validFrom, input.validAt),
                or(
                  isNull(pflegegradRecords.validUntil),
                  gt(pflegegradRecords.validUntil, input.validAt),
                ),
              ),
            ),
        ),
      );
    }

    const where = and(...filters);
    const sortColumn = {
      lastName: clientRecords.lastName,
      firstName: clientRecords.firstName,
      createdAt: clientRecords.createdAt,
      dateOfBirth: clientRecords.dateOfBirth,
    }[input.sortBy];
    const ordered = input.sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn);
    const secondary =
      input.sortBy === 'lastName'
        ? [asc(clientRecords.firstName), asc(clientRecords.id)]
        : [asc(clientRecords.lastName), asc(clientRecords.firstName), asc(clientRecords.id)];
    const rows = await transaction
      .select({
        client: {
          id: clientRecords.id,
          organizationId: clientRecords.organizationId,
          primaryFacilityId: clientRecords.primaryFacilityId,
          firstName: clientRecords.firstName,
          lastName: clientRecords.lastName,
          preferredName: clientRecords.preferredName,
          dateOfBirth: clientRecords.dateOfBirth,
          status: clientRecords.status,
        },
        organizationName: organizationsTable.name,
        facilityName: facilities.name,
        currentPflegegrad: pflegegradRecords.grade,
      })
      .from(clientRecords)
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, clientRecords.tenantId),
          eq(organizationsTable.id, clientRecords.organizationId),
        ),
      )
      .leftJoin(
        facilities,
        and(
          eq(facilities.tenantId, clientRecords.tenantId),
          eq(facilities.id, clientRecords.primaryFacilityId),
          eq(facilities.organizationId, clientRecords.organizationId),
        ),
      )
      .leftJoin(
        pflegegradRecords,
        and(
          eq(pflegegradRecords.tenantId, clientRecords.tenantId),
          eq(pflegegradRecords.clientId, clientRecords.id),
          eq(pflegegradRecords.status, 'confirmed'),
          lte(pflegegradRecords.validFrom, input.validAt),
          or(isNull(pflegegradRecords.validUntil), gt(pflegegradRecords.validUntil, input.validAt)),
        ),
      )
      .where(where)
      .orderBy(ordered, ...secondary)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const totals = await transaction.select({ total: count() }).from(clientRecords).where(where);
    return {
      items: rows.map((row) => ({
        client: {
          ...row.client,
          preferredName: row.client.preferredName ?? null,
          dateOfBirth: row.client.dateOfBirth ?? null,
        },
        organizationName: row.organizationName,
        facilityName: row.facilityName,
        currentPflegegrad: row.currentPflegegrad === null ? null : Number(row.currentPflegegrad),
      })),
      total: Number(totals[0]?.total ?? 0),
    };
  }
}

function clientScopePredicate(scope: ClientScopeFilter, tenantId: string): SQL {
  const accessible: SQL[] = [];
  if (scope.tenantWide) accessible.push(eq(clientRecords.tenantId, tenantId));
  if (scope.organizationIds.length > 0) {
    accessible.push(inArray(clientRecords.organizationId, [...scope.organizationIds]));
  }
  if (scope.facilityIds.length > 0) {
    accessible.push(inArray(clientRecords.primaryFacilityId, [...scope.facilityIds]));
  }
  return or(...accessible) ?? sql`false`;
}

function toRow(client: ClientSnapshot) {
  return {
    id: client.id,
    tenantId: client.tenantId,
    organizationId: client.organizationId,
    primaryFacilityId: client.primaryFacilityId,
    firstName: client.firstName,
    lastName: client.lastName,
    preferredName: client.preferredName ?? null,
    dateOfBirth: client.dateOfBirth ?? null,
    dateOfDeath: client.dateOfDeath ?? null,
    gender: client.gender ?? null,
    salutation: client.salutation ?? null,
    email: client.email ?? null,
    phone: client.phone ?? null,
    mobile: client.mobile ?? null,
    status: client.status,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function toSnapshot(row: typeof clientRecords.$inferSelect): ClientSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    primaryFacilityId: row.primaryFacilityId,
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName,
    dateOfBirth: row.dateOfBirth,
    dateOfDeath: row.dateOfDeath,
    gender: row.gender,
    salutation: row.salutation,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
