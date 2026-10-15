import {
  boolean,
  date,
  index,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const clients = pgSchema('clients');

export const clientRecords = clients.table(
  'clients',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id'),
    primaryFacilityId: uuid('primary_facility_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    dateOfDeath: date('date_of_death', { mode: 'string' }),
    gender: text('gender').$type<'female' | 'male' | 'diverse'>(),
    salutation: text('salutation').$type<'mr' | 'ms' | 'mx' | 'other'>(),
    email: text('email'),
    phone: text('phone'),
    mobile: text('mobile'),
    status: text('status').$type<'pending' | 'active' | 'archived'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('clients_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('clients_scheduling_provider_reference_uq').on(
      table.tenantId,
      table.organizationId,
      table.primaryFacilityId,
      table.id,
    ),
    index('clients_tenant_status_created_idx').on(table.tenantId, table.status, table.createdAt),
    index('clients_tenant_organization_status_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
    ),
    index('clients_tenant_facility_status_idx').on(
      table.tenantId,
      table.primaryFacilityId,
      table.status,
    ),
  ],
);

export const clientAddresses = clients.table(
  'client_addresses',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    addressType: text('address_type').$type<'home' | 'billing' | 'other'>().notNull(),
    street: text('street').notNull(),
    houseNumber: text('house_number'),
    addressAddition: text('address_addition'),
    postalCode: text('postal_code'),
    city: text('city').notNull(),
    countryCode: text('country_code').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    isPrimary: boolean('is_primary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('client_addresses_client_idx').on(table.tenantId, table.clientId, table.id)],
);

export const clientContacts = clients.table(
  'client_contacts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    relationshipType: text('relationship_type')
      .$type<
        'daughter' | 'son' | 'spouse' | 'relative' | 'legal_representative' | 'guardian' | 'other'
      >()
      .notNull(),
    phone: text('phone'),
    mobile: text('mobile'),
    email: text('email'),
    addressStreet: text('address_street'),
    addressHouseNumber: text('address_house_number'),
    addressAddition: text('address_addition'),
    addressPostalCode: text('address_postal_code'),
    addressCity: text('address_city'),
    addressCountryCode: text('address_country_code'),
    representationType: text('representation_type').$type<
      'power_of_attorney' | 'legal_guardianship' | 'authorized_representative'
    >(),
    representationValidFrom: date('representation_valid_from', { mode: 'string' }),
    representationValidUntil: date('representation_valid_until', { mode: 'string' }),
    representationReference: text('representation_reference'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('client_contacts_client_idx').on(
      table.tenantId,
      table.clientId,
      table.lastName,
      table.firstName,
      table.id,
    ),
  ],
);

export const clientContactRoles = clients.table(
  'client_contact_roles',
  {
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    role: text('role')
      .$type<
        | 'primary_contact'
        | 'emergency_contact'
        | 'legal_representative'
        | 'authorized_contact'
        | 'invoice_recipient'
      >()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.contactId, table.role] }),
    index('client_contact_roles_client_idx').on(table.tenantId, table.clientId, table.role),
  ],
);

export const clientInsurances = clients.table(
  'client_insurances',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    insuranceType: text('insurance_type')
      .$type<'pflegeversicherung' | 'krankenversicherung' | 'private' | 'other'>()
      .notNull(),
    insurerName: text('insurer_name').notNull(),
    insuranceNumber: text('insurance_number'),
    memberNumber: text('member_number'),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    isPrimary: boolean('is_primary').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('client_insurances_client_idx').on(table.tenantId, table.clientId, table.id)],
);

export const pflegegradRecords = clients.table(
  'pflegegrad_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    grade: smallint('grade').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    decisionDate: date('decision_date', { mode: 'string' }),
    insurerReference: text('insurer_reference'),
    status: text('status').$type<'pending' | 'confirmed' | 'revoked'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('pflegegrad_client_validity_idx').on(
      table.tenantId,
      table.clientId,
      table.validFrom,
      table.validUntil,
    ),
  ],
);

export const clientsSchema = {
  clientRecords,
  clientAddresses,
  clientContacts,
  clientContactRoles,
  clientInsurances,
  pflegegradRecords,
};
