import { and, count, desc, eq, gte, lte } from 'drizzle-orm';

import type { UnitOfWork } from '@care/database';

import { auditEntries } from './schema';

export interface AuditQuery {
  page: number;
  pageSize: number;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
}

export class DrizzleAuditReader {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async list(
    tenantId: string,
    query: AuditQuery,
  ): Promise<{ items: Array<typeof auditEntries.$inferSelect>; total: number }> {
    const filters = [eq(auditEntries.tenantId, tenantId)];
    if (query.actorId) filters.push(eq(auditEntries.actorId, query.actorId));
    if (query.action) filters.push(eq(auditEntries.action, query.action));
    if (query.resourceType) filters.push(eq(auditEntries.resourceType, query.resourceType));
    if (query.resourceId) filters.push(eq(auditEntries.resourceId, query.resourceId));
    if (query.from) filters.push(gte(auditEntries.timestamp, query.from));
    if (query.to) filters.push(lte(auditEntries.timestamp, query.to));
    const where = and(...filters);
    return this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      const items = await transaction
        .select()
        .from(auditEntries)
        .where(where)
        .orderBy(desc(auditEntries.timestamp), desc(auditEntries.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const totals = await transaction.select({ total: count() }).from(auditEntries).where(where);
      return { items, total: Number(totals[0]?.total ?? 0) };
    });
  }
}
