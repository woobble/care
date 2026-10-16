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

export const workerHealth = platform.table(
  'worker_health',
  {
    workerId: text('worker_id').primaryKey(),
    hostName: text('host_name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
    schedulerStatus: text('scheduler_status')
      .$type<'starting' | 'running' | 'degraded' | 'stopping' | 'stopped'>()
      .notNull(),
    lastScheduledSuccessAt: timestamp('last_scheduled_success_at', { withTimezone: true }),
    lastScheduledFailureAt: timestamp('last_scheduled_failure_at', { withTimezone: true }),
    lastScheduledFailureName: text('last_scheduled_failure_name'),
    lastOutboxFailureAt: timestamp('last_outbox_failure_at', { withTimezone: true }),
    lastOutboxFailureName: text('last_outbox_failure_name'),
    pendingOutboxCount: integer('pending_outbox_count').notNull().default(0),
    deadOutboxCount: integer('dead_outbox_count').notNull().default(0),
  },
  (table) => [index('worker_health_heartbeat_idx').on(table.heartbeatAt)],
);

export const platformSchema = { outboxMessages, workerHealth };
