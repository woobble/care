import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
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
    legalName: text('legal_name'),
    code: text('code'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    timezone: text('timezone').notNull().default('Europe/Berlin'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organizations_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('organizations_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('organizations_tenant_code_uq')
      .on(table.tenantId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
  ],
);

export const facilities = organizations.table(
  'facilities',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    timezone: text('timezone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facilities_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('facilities_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('facilities_tenant_organization_id_id_uq').on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    uniqueIndex('facilities_tenant_code_uq')
      .on(table.tenantId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
    foreignKey({
      name: 'facilities_organization_tenant_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const teams = organizations.table(
  'teams',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    name: text('name').notNull(),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('teams_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('teams_tenant_organization_id_id_uq').on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    uniqueIndex('teams_org_name_without_facility_uq')
      .on(table.tenantId, table.organizationId, table.name)
      .where(sql`${table.facilityId} IS NULL`),
    uniqueIndex('teams_facility_name_uq')
      .on(table.tenantId, table.organizationId, table.facilityId, table.name)
      .where(sql`${table.facilityId} IS NOT NULL`),
    index('teams_tenant_organization_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.name,
      table.id,
    ),
    foreignKey({
      name: 'teams_tenant_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'teams_tenant_organization_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
  ],
);

export const organizationsSchema = { tenants, organizationsTable, facilities, teams };
