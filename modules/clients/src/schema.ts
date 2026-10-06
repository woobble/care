import { index, pgSchema, text, timestamp, uniqueIndex, uuid, date } from 'drizzle-orm/pg-core';

const clients = pgSchema('clients');

export const clientRecords = clients.table(
  'clients',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    email: text('email'),
    phone: text('phone'),
    status: text('status').$type<'pending' | 'active' | 'archived'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('clients_tenant_id_uq').on(table.tenantId, table.id),
    index('clients_tenant_status_created_idx').on(table.tenantId, table.status, table.createdAt),
  ],
);

export const clientsSchema = { clientRecords };
