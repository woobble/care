import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const audit = pgSchema('audit');

export const auditEntries = audit.table('audit_entries', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  requestId: text('request_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

export const auditSchema = { auditEntries };
