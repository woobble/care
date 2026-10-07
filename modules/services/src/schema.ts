import {
  boolean,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const services = pgSchema('services');

export const serviceCategories = services.table(
  'service_categories',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    status: text('status').$type<'active' | 'archived'>().notNull(),
    sortOrder: integer('sort_order'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_categories_tenant_id_uq').on(table.tenantId, table.id),
    index('service_categories_tenant_status_order_idx').on(
      table.tenantId,
      table.status,
      table.sortOrder,
      table.name,
    ),
  ],
);

export const serviceDefinitions = services.table(
  'service_definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: uuid('category_id').notNull(),
    unit: text('unit').$type<'occurrence' | 'minute' | 'hour' | 'day'>().notNull(),
    defaultDurationMinutes: integer('default_duration_minutes'),
    status: text('status').$type<'active' | 'archived'>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_definitions_tenant_id_uq').on(table.tenantId, table.id),
    index('service_definitions_tenant_category_status_idx').on(
      table.tenantId,
      table.categoryId,
      table.status,
      table.code,
    ),
  ],
);

export const serviceAvailability = services.table(
  'service_availability',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    active: boolean('active').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('service_availability_tenant_service_idx').on(
      table.tenantId,
      table.serviceId,
      table.active,
      table.organizationId,
      table.facilityId,
    ),
  ],
);

export const servicesSchema = { serviceCategories, serviceDefinitions, serviceAvailability };
