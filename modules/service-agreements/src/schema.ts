import {
  date,
  index,
  numeric,
  pgSchema,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const serviceAgreements = pgSchema('service_agreements');

export const agreements = serviceAgreements.table(
  'agreements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    status: text('status').$type<'draft' | 'active' | 'suspended' | 'ended'>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    reference: text('reference'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('service_agreements_tenant_id_uq').on(table.tenantId, table.id),
    index('service_agreements_tenant_client_idx').on(
      table.tenantId,
      table.clientId,
      table.validFrom,
      table.id,
    ),
    index('service_agreements_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.validFrom,
      table.id,
    ),
    index('service_agreements_tenant_organization_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.validFrom,
    ),
    index('service_agreements_tenant_facility_idx').on(
      table.tenantId,
      table.facilityId,
      table.status,
      table.validFrom,
    ),
    index('service_agreements_tenant_validity_idx').on(
      table.tenantId,
      table.validFrom,
      table.validUntil,
    ),
  ],
);

export const agreementServices = serviceAgreements.table(
  'agreement_services',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    agreementId: uuid('agreement_id').notNull(),
    serviceDefinitionId: uuid('service_definition_id').notNull(),
    serviceCode: text('service_code').notNull(),
    serviceName: text('service_name').notNull(),
    serviceUnit: text('service_unit').$type<'occurrence' | 'minute' | 'hour' | 'day'>().notNull(),
    status: text('status').$type<'active' | 'ended'>().notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    quantity: numeric('quantity', { precision: 12, scale: 3 }),
    note: text('note'),
    scheduleType: text('schedule_type').$type<
      'daily' | 'weekly' | 'occurrences_per_week' | 'interval_days' | 'on_demand'
    >(),
    weekdays: text('weekdays')
      .array()
      .$type<
        Array<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'>
      >(),
    occurrencesPerWeek: smallint('occurrences_per_week'),
    intervalDays: smallint('interval_days'),
    preferredTimeStart: time('preferred_time_start'),
    preferredTimeEnd: time('preferred_time_end'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('agreement_services_tenant_agreement_status_idx').on(
      table.tenantId,
      table.agreementId,
      table.status,
      table.serviceDefinitionId,
    ),
    index('agreement_services_tenant_service_idx').on(
      table.tenantId,
      table.serviceDefinitionId,
      table.status,
      table.agreementId,
    ),
  ],
);

export const serviceAgreementsSchema = { agreements, agreementServices };
