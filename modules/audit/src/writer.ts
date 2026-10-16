import type { DatabaseTransaction } from '@care/database';

import { auditEntries } from './schema';

export interface AuditRecord {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  requestId: string;
  correlationId: string;
  ip?: string;
  userAgent?: string;
  metadata: Record<string, unknown>;
}

export interface AuditWriter {
  append(transaction: DatabaseTransaction, record: AuditRecord): Promise<void>;
}

export class DrizzleAuditWriter implements AuditWriter {
  async append(transaction: DatabaseTransaction, record: AuditRecord): Promise<void> {
    await transaction.insert(auditEntries).values({
      ...record,
      ip: record.ip ?? null,
      userAgent: record.userAgent ?? null,
    });
  }
}
