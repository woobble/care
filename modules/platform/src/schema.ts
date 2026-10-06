import { index, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DomainEvent } from '@care/events';

const platform = pgSchema('platform');

export const outboxMessages = platform.table(
  'outbox_messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    event: jsonb('event').$type<DomainEvent>().notNull(),
    status: text('status').$type<'pending' | 'processing' | 'delivered' | 'dead'>().notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('outbox_pending_idx').on(table.status, table.availableAt, table.createdAt)],
);

export const platformSchema = { outboxMessages };
