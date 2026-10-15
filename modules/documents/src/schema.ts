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
import { clientRecords } from '@care/clients';
import { facilities, organizationsTable } from '@care/organizations';
import type { DocumentArtifactStatus, DocumentLocale, DocumentType } from './domain/documents';

const documents = pgSchema('documents');

export const logoAssets = documents.table(
  'logo_assets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').$type<'image/png' | 'image/jpeg'>().notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('document_logo_assets_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('document_logo_assets_tenant_org_id_uq').on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    uniqueIndex('document_logo_assets_object_key_uq').on(table.objectKey),
    index('document_logo_assets_org_idx').on(table.tenantId, table.organizationId, table.createdAt),
    check('document_logo_assets_hash_ck', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'document_logo_assets_object_key_ck',
      sql`${table.objectKey} LIKE 'documents/logos/%' AND length(${table.objectKey}) <= 300`,
    ),
    check('document_logo_assets_mime_ck', sql`${table.mimeType} IN ('image/png', 'image/jpeg')`),
    check(
      'document_logo_assets_dimensions_ck',
      sql`${table.sizeBytes} BETWEEN 1 AND 524288 AND ${table.width} BETWEEN 1 AND 2400 AND ${table.height} BETWEEN 1 AND 1200`,
    ),
    foreignKey({
      name: 'document_logo_assets_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
  ],
);

export const documentTemplates = documents.table(
  'templates',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    documentType: text('document_type').$type<DocumentType>().notNull(),
    logoAssetId: uuid('logo_asset_id'),
    primaryColor: text('primary_color').notNull(),
    headerText: text('header_text'),
    footerText: text('footer_text'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    contactWebsite: text('contact_website'),
    defaultLocale: text('default_locale').$type<DocumentLocale>().notNull(),
    contractTermsText: text('contract_terms_text'),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('document_templates_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('document_templates_org_type_version_uq').on(
      table.tenantId,
      table.organizationId,
      table.documentType,
      table.version,
    ),
    index('document_templates_current_idx').on(
      table.tenantId,
      table.organizationId,
      table.documentType,
      table.version,
    ),
    check('document_templates_version_ck', sql`${table.version} > 0`),
    check('document_templates_color_ck', sql`${table.primaryColor} ~ '^#[0-9A-Fa-f]{6}$'`),
    check('document_templates_locale_ck', sql`${table.defaultLocale} IN ('de', 'en')`),
    check(
      'document_templates_type_ck',
      sql`${table.documentType} IN ('service_evidence', 'service_agreement', 'invoice', 'invoice_correction', 'benefit_overview', 'claim_summary')`,
    ),
    check(
      'document_templates_lengths_ck',
      sql`length(coalesce(${table.headerText}, '')) <= 500 AND length(coalesce(${table.footerText}, '')) <= 500 AND length(coalesce(${table.contactEmail}, '')) <= 254 AND length(coalesce(${table.contactPhone}, '')) <= 80 AND length(coalesce(${table.contactWebsite}, '')) <= 254 AND length(coalesce(${table.contractTermsText}, '')) <= 8000`,
    ),
    foreignKey({
      name: 'document_templates_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'document_templates_logo_fk',
      columns: [table.tenantId, table.organizationId, table.logoAssetId],
      foreignColumns: [logoAssets.tenantId, logoAssets.organizationId, logoAssets.id],
    }),
  ],
);

export const documentArtifacts = documents.table(
  'artifacts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    facilityId: uuid('facility_id'),
    clientId: uuid('client_id'),
    title: text('title'),
    sourceReference: text('source_reference'),
    documentType: text('document_type').$type<DocumentType>().notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: uuid('source_entity_id').notNull(),
    sourceVersion: text('source_version').notNull(),
    templateVersion: integer('template_version').notNull(),
    locale: text('locale').$type<DocumentLocale>().notNull(),
    objectKey: text('object_key'),
    sha256: text('sha256'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes'),
    status: text('status').$type<DocumentArtifactStatus>().notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    generatedBy: uuid('generated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('document_artifacts_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('document_artifacts_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    index('document_artifacts_client_created_idx').on(
      table.tenantId,
      table.clientId,
      table.createdAt,
      table.id,
    ),
    index('document_artifacts_source_idx').on(
      table.tenantId,
      table.sourceEntityType,
      table.sourceEntityId,
      table.documentType,
      table.createdAt,
    ),
    index('document_artifacts_worklist_idx').on(table.tenantId, table.createdAt, table.id),
    index('document_artifacts_org_worklist_idx').on(
      table.tenantId,
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    check(
      'document_artifacts_source_ck',
      sql`length(trim(${table.sourceEntityType})) BETWEEN 1 AND 80 AND length(trim(${table.sourceVersion})) BETWEEN 1 AND 200`,
    ),
    check(
      'document_artifacts_source_reference_ck',
      sql`length(coalesce(${table.sourceReference}, '')) <= 160`,
    ),
    check(
      'document_artifacts_type_ck',
      sql`${table.documentType} IN ('service_evidence', 'service_agreement', 'invoice', 'invoice_correction', 'benefit_overview', 'claim_summary')`,
    ),
    check(
      'document_artifacts_status_ck',
      sql`(${table.status} = 'ready' AND ${table.objectKey} IS NOT NULL AND ${table.objectKey} LIKE 'documents/artifacts/%' AND ${table.sha256} IS NOT NULL AND ${table.sha256} ~ '^[a-f0-9]{64}$' AND ${table.sizeBytes} IS NOT NULL AND ${table.sizeBytes} > 0 AND ${table.generatedAt} IS NOT NULL) OR (${table.status} IN ('pending', 'failed') AND ${table.objectKey} IS NULL AND ${table.sha256} IS NULL AND ${table.sizeBytes} IS NULL AND ${table.generatedAt} IS NULL) OR (${table.status} = 'superseded' AND ${table.objectKey} IS NOT NULL AND ${table.objectKey} LIKE 'documents/artifacts/%' AND ${table.sha256} IS NOT NULL AND ${table.sha256} ~ '^[a-f0-9]{64}$' AND ${table.sizeBytes} IS NOT NULL AND ${table.sizeBytes} > 0 AND ${table.generatedAt} IS NOT NULL)`,
    ),
    check('document_artifacts_template_version_ck', sql`${table.templateVersion} >= 0`),
    check('document_artifacts_locale_ck', sql`${table.locale} IN ('de', 'en')`),
    check('document_artifacts_mime_ck', sql`${table.mimeType} = 'application/pdf'`),
    foreignKey({
      name: 'document_artifacts_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'document_artifacts_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
    foreignKey({
      name: 'document_artifacts_client_fk',
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clientRecords.tenantId, clientRecords.id],
    }),
  ],
);

export const documentsSchema = {
  documentArtifacts,
  documentTemplates,
  logoAssets,
};
