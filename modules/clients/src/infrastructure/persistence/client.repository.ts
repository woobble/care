import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { clientRecords } from '../../schema';
import type { ClientSnapshot } from '../../domain/client';

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
    input: { tenantId: string; query?: string; page: number; pageSize: number },
  ): Promise<{ items: ClientSnapshot[]; total: number }> {
    const term = input.query?.trim();
    const escaped = term?.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const filters = [eq(clientRecords.tenantId, input.tenantId)];
    if (escaped) {
      const pattern = `%${escaped}%`;
      filters.push(
        or(ilike(clientRecords.firstName, pattern), ilike(clientRecords.lastName, pattern))!,
      );
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      transaction
        .select()
        .from(clientRecords)
        .where(where)
        .orderBy(desc(clientRecords.createdAt), asc(clientRecords.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      transaction.select({ total: count() }).from(clientRecords).where(where),
    ]);
    return { items: rows.map(toSnapshot), total: Number(totals[0]?.total ?? 0) };
  }
}

function toRow(client: ClientSnapshot) {
  return {
    id: client.id,
    tenantId: client.tenantId,
    firstName: client.firstName,
    lastName: client.lastName,
    preferredName: client.preferredName ?? null,
    dateOfBirth: client.dateOfBirth ?? null,
    email: client.email ?? null,
    phone: client.phone ?? null,
    status: client.status,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function toSnapshot(row: typeof clientRecords.$inferSelect): ClientSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName,
    dateOfBirth: row.dateOfBirth,
    email: row.email,
    phone: row.phone,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
