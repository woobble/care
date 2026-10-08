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
import { clientRecords, pflegegradRecords } from '../../schema';
import type { ClientSnapshot, ClientStatus } from '../../domain/client';

export interface ClientScopeFilter {
  tenantWide: boolean;
  organizationIds: readonly string[];
  facilityIds: readonly string[];
}

export interface ClientSearchFilter {
  tenantId: string;
  access: ClientScopeFilter;
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
  client: ClientSnapshot;
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
    const accessible: SQL[] = [];
    if (input.access.tenantWide) accessible.push(eq(clientRecords.tenantId, input.tenantId));
    if (input.access.organizationIds.length > 0) {
      accessible.push(inArray(clientRecords.organizationId, [...input.access.organizationIds]));
    }
    if (input.access.facilityIds.length > 0) {
      accessible.push(inArray(clientRecords.primaryFacilityId, [...input.access.facilityIds]));
    }
    filters.push(or(...accessible) ?? sql`false`);
    if (input.text?.trim()) {
      const term = input.text
        .trim()
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      const pattern = `%${term}%`;
      filters.push(
        or(
          ilike(clientRecords.firstName, pattern),
          ilike(clientRecords.lastName, pattern),
          ilike(clientRecords.preferredName, pattern),
        )!,
      );
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
        client: clientRecords,
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
        client: toSnapshot(row.client),
        organizationName: row.organizationName,
        facilityName: row.facilityName,
        currentPflegegrad: row.currentPflegegrad === null ? null : Number(row.currentPflegegrad),
      })),
      total: Number(totals[0]?.total ?? 0),
    };
  }
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
