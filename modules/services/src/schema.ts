import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { facilities, organizationsTable } from '@care/organizations';

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
    benefitCategory: text('benefit_category')
      .$type<'recognized_support' | 'clinical_nursing' | 'other'>()
      .notNull(),
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

export const servicePrices = services.table(
  'service_prices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    priceCents: integer('price_cents').notNull(),
    pricingUnit: text('pricing_unit').$type<'hour' | 'minute' | 'visit' | 'fixed'>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_prices_tenant_id_uq').on(table.tenantId, table.id),
    index('service_prices_lookup_idx').on(
      table.tenantId,
      table.serviceId,
      table.organizationId,
      table.facilityId,
      table.validFrom,
      table.validUntil,
    ),
    check('service_prices_amount_ck', sql`${table.priceCents} > 0`),
    check(
      'service_prices_unit_ck',
      sql.raw("pricing_unit IN ('hour', 'minute', 'visit', 'fixed')"),
    ),
    check(
      'service_prices_validity_ck',
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
    ),
    foreignKey({
      name: 'service_prices_service_fk',
      columns: [table.tenantId, table.serviceId],
      foreignColumns: [serviceDefinitions.tenantId, serviceDefinitions.id],
    }),
    foreignKey({
      name: 'service_prices_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'service_prices_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
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

export const servicesSchema = {
  serviceCategories,
  serviceDefinitions,
  serviceAvailability,
  servicePrices,
};
