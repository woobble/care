import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientContacts, clientRecords } from '@care/clients';
import { claims, invoices } from '@care/billing';
import { documentArtifacts } from '@care/documents';
import { users } from '@care/identity';
import { tasks } from '@care/operations';
import { facilities, organizationsTable } from '@care/organizations';
import { visits } from '@care/scheduling';
import { agreements } from '@care/service-agreements';

const communications = pgSchema('communications');

export const interactions = communications.table(
  'interactions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id'),
    facilityId: uuid('facility_id'),
    clientId: uuid('client_id').notNull(),
    contactId: uuid('contact_id'),
    contactLabelSnapshot: text('contact_label_snapshot'),
    contactAuthorization: text('contact_authorization')
      .$type<'legal_representative' | 'authorized_contact' | 'not_confirmed' | 'not_applicable'>()
      .notNull(),
    direction: text('direction').$type<'inbound' | 'outbound' | 'internal'>().notNull(),
    channel: text('channel')
      .$type<'phone' | 'in_person' | 'email' | 'letter' | 'portal' | 'other'>()
      .notNull(),
    category: text('category')
      .$type<
        | 'general_inquiry'
        | 'appointment_coordination'
        | 'cancellation_rescheduling'
        | 'service_request'
        | 'service_agreement'
        | 'documentation'
        | 'billing_payment'
        | 'benefits_payer'
        | 'complaint_feedback'
        | 'other'
      >()
      .notNull(),
    subject: text('subject').notNull(),
    summary: text('summary'),
    outcome: text('outcome')
      .$type<
        | 'information_provided'
        | 'request_received'
        | 'action_required'
        | 'appointment_agreed'
        | 'no_answer'
        | 'resolved'
        | 'other'
      >()
      .notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    sourceType: text('source_type').$type<
      'visit' | 'service_agreement' | 'operations_task' | 'invoice' | 'claim' | 'document' | null
    >(),
    sourceVisitId: uuid('source_visit_id'),
    sourceAgreementId: uuid('source_agreement_id'),
    sourceTaskId: uuid('source_task_id'),
    sourceInvoiceId: uuid('source_invoice_id'),
    sourceClaimId: uuid('source_claim_id'),
    sourceDocumentId: uuid('source_document_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('communications_interactions_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('communications_interactions_tenant_client_id_uq').on(
      table.tenantId,
      table.clientId,
      table.id,
    ),
    index('communications_interactions_client_timeline_idx').on(
      table.tenantId,
      table.clientId,
      table.occurredAt,
      table.id,
    ),
    index('communications_interactions_timeline_idx').on(
      table.tenantId,
      table.occurredAt,
      table.id,
    ),
    index('communications_interactions_channel_timeline_idx').on(
      table.tenantId,
      table.channel,
      table.occurredAt,
      table.id,
    ),
    index('communications_interactions_category_timeline_idx').on(
      table.tenantId,
      table.category,
      table.occurredAt,
      table.id,
    ),
    check(
      'communications_interactions_content_ck',
      sql`length(trim(${table.subject})) BETWEEN 1 AND 200 AND (${table.summary} IS NULL OR length(${table.summary}) <= 4000) AND (${table.contactLabelSnapshot} IS NULL OR length(trim(${table.contactLabelSnapshot})) BETWEEN 1 AND 120)`,
    ),
    check('communications_interactions_version_ck', sql`${table.version} > 0`),
    check(
      'communications_interactions_contact_authorization_ck',
      sql`(${table.contactId} IS NULL AND ${table.contactAuthorization} IN ('not_confirmed', 'not_applicable')) OR (${table.contactId} IS NOT NULL AND ${table.contactAuthorization} IN ('legal_representative', 'authorized_contact', 'not_confirmed'))`,
    ),
    check(
      'communications_interactions_source_pair_ck',
      sql`
        (${table.sourceType} IS NULL AND ${table.sourceVisitId} IS NULL AND ${table.sourceAgreementId} IS NULL AND ${table.sourceTaskId} IS NULL AND ${table.sourceInvoiceId} IS NULL AND ${table.sourceClaimId} IS NULL AND ${table.sourceDocumentId} IS NULL)
        OR (${table.sourceType} = 'visit' AND ${table.sourceVisitId} IS NOT NULL AND ${table.sourceAgreementId} IS NULL AND ${table.sourceTaskId} IS NULL AND ${table.sourceInvoiceId} IS NULL AND ${table.sourceClaimId} IS NULL AND ${table.sourceDocumentId} IS NULL)
        OR (${table.sourceType} = 'service_agreement' AND ${table.sourceVisitId} IS NULL AND ${table.sourceAgreementId} IS NOT NULL AND ${table.sourceTaskId} IS NULL AND ${table.sourceInvoiceId} IS NULL AND ${table.sourceClaimId} IS NULL AND ${table.sourceDocumentId} IS NULL)
        OR (${table.sourceType} = 'operations_task' AND ${table.sourceVisitId} IS NULL AND ${table.sourceAgreementId} IS NULL AND ${table.sourceTaskId} IS NOT NULL AND ${table.sourceInvoiceId} IS NULL AND ${table.sourceClaimId} IS NULL AND ${table.sourceDocumentId} IS NULL)
        OR (${table.sourceType} = 'invoice' AND ${table.sourceVisitId} IS NULL AND ${table.sourceAgreementId} IS NULL AND ${table.sourceTaskId} IS NULL AND ${table.sourceInvoiceId} IS NOT NULL AND ${table.sourceClaimId} IS NULL AND ${table.sourceDocumentId} IS NULL)
        OR (${table.sourceType} = 'claim' AND ${table.sourceVisitId} IS NULL AND ${table.sourceAgreementId} IS NULL AND ${table.sourceTaskId} IS NULL AND ${table.sourceInvoiceId} IS NULL AND ${table.sourceClaimId} IS NOT NULL AND ${table.sourceDocumentId} IS NULL)
        OR (${table.sourceType} = 'document' AND ${table.sourceVisitId} IS NULL AND ${table.sourceAgreementId} IS NULL AND ${table.sourceTaskId} IS NULL AND ${table.sourceInvoiceId} IS NULL AND ${table.sourceClaimId} IS NULL AND ${table.sourceDocumentId} IS NOT NULL)
      `,
    ),
    foreignKey({
      name: 'communications_interactions_tenant_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'communications_interactions_tenant_org_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'communications_interactions_tenant_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'communications_interactions_contact_fk',
      columns: [table.tenantId, table.clientId, table.contactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.clientId, clientContacts.id],
    }),
    foreignKey({
      name: 'communications_interactions_author_fk',
      columns: [table.recordedByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'communications_interactions_source_visit_fk',
      columns: [table.tenantId, table.sourceVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'communications_interactions_source_agreement_fk',
      columns: [table.tenantId, table.sourceAgreementId],
      foreignColumns: [agreements.tenantId, agreements.id],
    }),
    foreignKey({
      name: 'communications_interactions_source_task_fk',
      columns: [table.tenantId, table.sourceTaskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
    foreignKey({
      name: 'communications_interactions_source_invoice_fk',
      columns: [table.tenantId, table.sourceInvoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'communications_interactions_source_claim_fk',
      columns: [table.tenantId, table.sourceClaimId],
      foreignColumns: [claims.tenantId, claims.id],
    }),
    foreignKey({
      name: 'communications_interactions_source_document_fk',
      columns: [table.tenantId, table.sourceDocumentId],
      foreignColumns: [documentArtifacts.tenantId, documentArtifacts.id],
    }),
  ],
);

export const prospectInteractions = communications.table(
  'prospect_interactions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    caseId: uuid('case_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    direction: text('direction').$type<'inbound' | 'outbound' | 'internal'>().notNull(),
    channel: text('channel')
      .$type<'phone' | 'in_person' | 'email' | 'letter' | 'portal' | 'other'>()
      .notNull(),
    category: text('category')
      .$type<
        | 'general_inquiry'
        | 'appointment_coordination'
        | 'cancellation_rescheduling'
        | 'service_request'
        | 'service_agreement'
        | 'documentation'
        | 'billing_payment'
        | 'benefits_payer'
        | 'complaint_feedback'
        | 'other'
      >()
      .notNull(),
    subject: text('subject').notNull(),
    summary: text('summary'),
    outcome: text('outcome')
      .$type<
        | 'information_provided'
        | 'request_received'
        | 'action_required'
        | 'appointment_agreed'
        | 'no_answer'
        | 'resolved'
        | 'other'
      >()
      .notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('communications_prospect_interactions_tenant_id_uq').on(table.tenantId, table.id),
    index('communications_prospect_interactions_case_timeline_idx').on(
      table.tenantId,
      table.caseId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    check(
      'communications_prospect_interactions_content_ck',
      sql`length(trim(${table.subject})) BETWEEN 1 AND 200 AND (${table.summary} IS NULL OR length(${table.summary}) <= 4000)`,
    ),
    check(
      'communications_prospect_interactions_direction_ck',
      sql`${table.direction} IN ('inbound', 'outbound', 'internal')`,
    ),
    check(
      'communications_prospect_interactions_channel_ck',
      sql`${table.channel} IN ('phone', 'in_person', 'email', 'letter', 'portal', 'other')`,
    ),
    check(
      'communications_prospect_interactions_category_ck',
      sql`${table.category} IN ('general_inquiry', 'appointment_coordination', 'cancellation_rescheduling', 'service_request', 'service_agreement', 'documentation', 'billing_payment', 'benefits_payer', 'complaint_feedback', 'other')`,
    ),
    check(
      'communications_prospect_interactions_outcome_ck',
      sql`${table.outcome} IN ('information_provided', 'request_received', 'action_required', 'appointment_agreed', 'no_answer', 'resolved', 'other')`,
    ),
    foreignKey({
      name: 'communications_prospect_interactions_org_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'communications_prospect_interactions_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'communications_prospect_interactions_author_fk',
      columns: [table.recordedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const interactionAmendments = communications.table(
  'interaction_amendments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    interactionId: uuid('interaction_id').notNull(),
    version: integer('version').notNull(),
    reason: text('reason').notNull(),
    direction: text('direction').$type<'inbound' | 'outbound' | 'internal'>().notNull(),
    channel: text('channel')
      .$type<'phone' | 'in_person' | 'email' | 'letter' | 'portal' | 'other'>()
      .notNull(),
    category: text('category')
      .$type<
        | 'general_inquiry'
        | 'appointment_coordination'
        | 'cancellation_rescheduling'
        | 'service_request'
        | 'service_agreement'
        | 'documentation'
        | 'billing_payment'
        | 'benefits_payer'
        | 'complaint_feedback'
        | 'other'
      >()
      .notNull(),
    subject: text('subject').notNull(),
    summary: text('summary'),
    outcome: text('outcome')
      .$type<
        | 'information_provided'
        | 'request_received'
        | 'action_required'
        | 'appointment_agreed'
        | 'no_answer'
        | 'resolved'
        | 'other'
      >()
      .notNull(),
    contactId: uuid('contact_id'),
    contactLabelSnapshot: text('contact_label_snapshot'),
    contactAuthorization: text('contact_authorization')
      .$type<'legal_representative' | 'authorized_contact' | 'not_confirmed' | 'not_applicable'>()
      .notNull(),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('communications_amendments_tenant_interaction_version_uq').on(
      table.tenantId,
      table.interactionId,
      table.version,
    ),
    index('communications_amendments_timeline_idx').on(
      table.tenantId,
      table.interactionId,
      table.recordedAt,
      table.id,
    ),
    check('communications_amendments_version_ck', sql`${table.version} > 0`),
    check(
      'communications_amendments_reason_ck',
      sql`length(trim(${table.reason})) BETWEEN 1 AND 500`,
    ),
    check(
      'communications_amendments_content_ck',
      sql`length(trim(${table.subject})) BETWEEN 1 AND 200 AND (${table.summary} IS NULL OR length(${table.summary}) <= 4000) AND (${table.contactLabelSnapshot} IS NULL OR length(trim(${table.contactLabelSnapshot})) BETWEEN 1 AND 120)`,
    ),
    foreignKey({
      name: 'communications_amendments_interaction_fk',
      columns: [table.tenantId, table.clientId, table.interactionId],
      foreignColumns: [interactions.tenantId, interactions.clientId, interactions.id],
    }),
    foreignKey({
      name: 'communications_amendments_contact_fk',
      columns: [table.tenantId, table.clientId, table.contactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.clientId, clientContacts.id],
    }),
    foreignKey({
      name: 'communications_amendments_author_fk',
      columns: [table.recordedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const clientCommunicationPreferences = communications.table(
  'client_preferences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    preferredChannel: text('preferred_channel').$type<
      'phone' | 'in_person' | 'email' | 'letter' | 'portal' | 'other' | null
    >(),
    preferredLanguage: text('preferred_language').$type<'de' | 'en' | null>(),
    preferredContactId: uuid('preferred_contact_id'),
    preferredContactTimes: text('preferred_contact_times'),
    correspondencePreference: text('correspondence_preference')
      .$type<'unspecified' | 'postal' | 'electronic'>()
      .notNull(),
    contactRestrictions: text('contact_restrictions'),
    version: integer('version').notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('communications_client_preferences_tenant_client_uq').on(
      table.tenantId,
      table.clientId,
    ),
    index('communications_client_preferences_contact_idx').on(
      table.tenantId,
      table.preferredContactId,
    ),
    check('communications_client_preferences_version_ck', sql`${table.version} > 0`),
    check(
      'communications_client_preferences_content_ck',
      sql`(${table.preferredContactTimes} IS NULL OR length(${table.preferredContactTimes}) <= 250) AND (${table.contactRestrictions} IS NULL OR length(${table.contactRestrictions}) <= 1000)`,
    ),
    foreignKey({
      name: 'communications_preferences_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
    foreignKey({
      name: 'communications_preferences_contact_fk',
      columns: [table.tenantId, table.clientId, table.preferredContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.clientId, clientContacts.id],
    }),
    foreignKey({
      name: 'communications_preferences_author_fk',
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
    }),
  ],
);

export const communicationsSchema = {
  interactions,
  prospectInteractions,
  interactionAmendments,
  clientCommunicationPreferences,
};
