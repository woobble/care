import type { DatabaseTransaction } from '@care/database';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DomainEvent } from '@care/events';
import { outboxMessages } from './schema';

export interface OutboxWriter {
  enqueue(transaction: DatabaseTransaction, event: DomainEvent): Promise<void>;
}

export type ClaimedOutboxMessage = {
  id: string;
  event: DomainEvent;
  attemptCount: number;
  lockedBy: string;
};

export class DrizzleOutboxRepository implements OutboxWriter {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async enqueue(transaction: DatabaseTransaction, event: DomainEvent): Promise<void> {
    await transaction.insert(outboxMessages).values({
      id: event.id,
      tenantId: event.tenantId,
      eventType: event.type,
      eventVersion: event.version,
      event,
      status: 'pending',
      attemptCount: 0,
      availableAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      deliveredAt: null,
      lastError: null,
      createdAt: new Date(),
    });
  }

  async pendingIds(now = new Date(), leaseMs = 120_000, limit = 50): Promise<string[]> {
    const leaseExpiredBefore = new Date(now.getTime() - leaseMs);
    const rows = await this.db
      .select({ id: outboxMessages.id })
      .from(outboxMessages)
      .where(
        or(
          and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.availableAt, now)),
          and(
            eq(outboxMessages.status, 'processing'),
            lte(outboxMessages.lockedAt, leaseExpiredBefore),
          ),
        ),
      )
      .orderBy(asc(outboxMessages.createdAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async claim(
    id: string,
    workerId: string,
    options: { now?: Date; leaseMs?: number; maxAttempts?: number } = {},
  ): Promise<ClaimedOutboxMessage | null> {
    const now = options.now ?? new Date();
    const leaseExpiredBefore = new Date(now.getTime() - (options.leaseMs ?? 120_000));
    const maxAttempts = options.maxAttempts ?? 10;

    return this.db.transaction(async (transaction) => {
      const [message] = await transaction
        .select()
        .from(outboxMessages)
        .where(
          and(
            eq(outboxMessages.id, id),
            or(
              and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.availableAt, now)),
              and(
                eq(outboxMessages.status, 'processing'),
                lte(outboxMessages.lockedAt, leaseExpiredBefore),
              ),
            ),
          ),
        )
        .for('update', { skipLocked: true })
        .limit(1);

      if (!message) return null;
      const attemptCount = message.attemptCount + 1;
      if (attemptCount > maxAttempts) {
        await transaction
          .update(outboxMessages)
          .set({
            status: 'dead',
            lastError: 'Maximum attempts exceeded',
            lockedAt: null,
            lockedBy: null,
          })
          .where(eq(outboxMessages.id, id));
        return null;
      }

      await transaction
        .update(outboxMessages)
        .set({
          status: 'processing',
          attemptCount,
          lockedAt: now,
          lockedBy: workerId,
          lastError: null,
        })
        .where(eq(outboxMessages.id, id));

      return { id: message.id, event: message.event, attemptCount, lockedBy: workerId };
    });
  }

  async markDelivered(message: ClaimedOutboxMessage): Promise<void> {
    const updated = await this.db
      .update(outboxMessages)
      .set({ status: 'delivered', deliveredAt: new Date(), lockedAt: null, lockedBy: null })
      .where(
        and(
          eq(outboxMessages.id, message.id),
          eq(outboxMessages.status, 'processing'),
          eq(outboxMessages.lockedBy, message.lockedBy),
        ),
      )
      .returning({ id: outboxMessages.id });
    if (updated.length === 0) throw new Error('Outbox lease was lost before delivery');
  }

  async markFailed(message: ClaimedOutboxMessage, error: unknown, maxAttempts = 10): Promise<void> {
    const dead = message.attemptCount >= maxAttempts;
    const backoffMs = Math.min(60_000 * 2 ** Math.max(0, message.attemptCount - 1), 3_600_000);
    const summary = error instanceof Error ? error.name.slice(0, 100) : 'Event dispatch failed';
    const updated = await this.db
      .update(outboxMessages)
      .set({
        status: dead ? 'dead' : 'pending',
        availableAt: new Date(Date.now() + backoffMs),
        lockedAt: null,
        lockedBy: null,
        lastError: summary,
      })
      .where(
        and(
          eq(outboxMessages.id, message.id),
          eq(outboxMessages.status, 'processing'),
          eq(outboxMessages.lockedBy, message.lockedBy),
        ),
      )
      .returning({ id: outboxMessages.id });
    if (updated.length === 0) throw new Error('Outbox lease was lost before failure was recorded');
  }
}
