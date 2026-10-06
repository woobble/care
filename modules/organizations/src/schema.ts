import {
  boolean,
  foreignKey,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const organizations = pgSchema('organizations');

export const tenants = organizations.table(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tenants_slug_uq').on(table.slug)],
);

export const organizationsTable = organizations.table(
  'organizations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organizations_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('organizations_tenant_id_id_uq').on(table.tenantId, table.id),
  ],
);

export const facilities = organizations.table(
  'facilities',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facilities_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('facilities_tenant_id_id_uq').on(table.tenantId, table.id),
    foreignKey({
      name: 'facilities_organization_tenant_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const organizationsSchema = { tenants, organizationsTable, facilities };
