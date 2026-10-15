import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { PDFDocument } from 'pdf-lib';
import { assertCan, can } from '@care/permissions';
import { clientRecords, displayClientName } from '@care/clients';
import type { AuthorizationPrincipal, Permission, ResourceContext } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { ObjectStorage } from '@care/storage';
import {
  DocumentAccessDeniedError,
  DocumentArtifactIntegrityError,
  DocumentArtifactNotFoundError,
  DocumentGenerationFailedError,
  DocumentIdempotencyConflictError,
  DocumentLogoInvalidError,
  DocumentLogoNotFoundError,
  DocumentTemplateVersionConflictError,
  defaultDocumentTemplate,
  validateTemplateInput,
} from '@module/documents/domain/documents';
import type {
  DocumentArtifactView,
  DocumentArtifactStatus,
  DocumentGenerationInput,
  DocumentPayload,
  DocumentTemplateConfig,
  DocumentTemplateInput,
  DocumentType,
} from '@module/documents/domain/documents';
import { documentArtifacts, documentTemplates, logoAssets } from '@module/documents/schema';
import { renderDocumentPdf } from '@module/documents/infrastructure/pdf-renderer';
import type { PdfBranding } from '@module/documents/infrastructure/pdf-renderer';

export interface DocumentAuditContext {
  ip?: string;
  userAgent?: string;
}

export interface DocumentTemplateView extends DocumentTemplateConfig {
  id: string | null;
}

export interface DocumentLogoView {
  id: string;
  mimeType: 'image/png' | 'image/jpeg';
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
}

export interface DocumentRenderingConfiguration {
  template: DocumentTemplateConfig;
  branding: PdfBranding;
}

export interface DocumentArtifactFilters {
  clientId?: string;
  organizationId?: string;
  facilityId?: string;
  documentType?: DocumentType;
  status?: DocumentArtifactStatus;
  from?: string;
  until?: string;
  search?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  sort?: 'createdAt' | 'name' | 'type' | 'status';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface DocumentPreviewInput {
  organizationId: string;
  documentType: DocumentType;
  templateVersion?: number;
  payload: DocumentPayload;
}

const DOCUMENT_TEMPLATE_TYPES: readonly DocumentType[] = [
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
];
type LogoImage = {
  mimeType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
  width: number;
  height: number;
};
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_LOGO_BYTES = 512 * 1024;

export class DocumentsApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly storage: ObjectStorage,
  ) {}

  async templates(
    principal: AuthorizationPrincipal,
    organizationId: string,
  ): Promise<DocumentTemplateView[]> {
    const resource = { tenantId: principal.tenantId, organizationId };
    this.requireTemplateRead(principal, resource);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select()
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.tenantId, principal.tenantId),
            eq(documentTemplates.organizationId, organizationId),
          ),
        )
        .orderBy(desc(documentTemplates.version));
      const latest = new Map<DocumentType, DocumentTemplateView>();
      for (const row of rows) {
        if (!latest.has(row.documentType)) latest.set(row.documentType, templateView(row));
      }
      return DOCUMENT_TEMPLATE_TYPES.map(
        (type) =>
          latest.get(type) ?? defaultDocumentTemplate(principal.tenantId, organizationId, type),
      );
    });
  }

  async saveTemplate(
    principal: AuthorizationPrincipal,
    organizationId: string,
    type: DocumentType,
    input: DocumentTemplateInput,
    request: RequestContext,
    auditContext: DocumentAuditContext,
  ): Promise<DocumentTemplateView> {
    validateTemplateInput(input);
    const resource = { tenantId: principal.tenantId, organizationId };
    assertCan(principal, { action: 'documents.templates.manage', resource });
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${principal.tenantId}:${organizationId}:${type}`}, 0))`,
      );
      const [latest] = await transaction
        .select()
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.tenantId, principal.tenantId),
            eq(documentTemplates.organizationId, organizationId),
            eq(documentTemplates.documentType, type),
          ),
        )
        .orderBy(desc(documentTemplates.version))
        .limit(1);
      const currentVersion = latest?.version ?? 0;
      if (input.expectedVersion !== currentVersion)
        throw new DocumentTemplateVersionConflictError();
      const logoAssetId =
        input.logoAssetId === undefined ? (latest?.logoAssetId ?? null) : input.logoAssetId;
      if (logoAssetId) {
        const [logo] = await transaction
          .select({ id: logoAssets.id })
          .from(logoAssets)
          .where(
            and(
              eq(logoAssets.tenantId, principal.tenantId),
              eq(logoAssets.organizationId, organizationId),
              eq(logoAssets.id, logoAssetId),
            ),
          )
          .limit(1);
        if (!logo) throw new DocumentLogoNotFoundError();
      }
      const [row] = await transaction
        .insert(documentTemplates)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          organizationId,
          documentType: type,
          logoAssetId,
          primaryColor: input.primaryColor ?? latest?.primaryColor ?? '#1D4ED8',
          headerText:
            input.headerText === undefined
              ? (latest?.headerText ?? null)
              : cleanText(input.headerText),
          footerText:
            input.footerText === undefined
              ? (latest?.footerText ?? null)
              : cleanText(input.footerText),
          contactEmail:
            input.contactEmail === undefined
              ? (latest?.contactEmail ?? null)
              : cleanText(input.contactEmail),
          contactPhone:
            input.contactPhone === undefined
              ? (latest?.contactPhone ?? null)
              : cleanText(input.contactPhone),
          contactWebsite:
            input.contactWebsite === undefined
              ? (latest?.contactWebsite ?? null)
              : cleanText(input.contactWebsite),
          defaultLocale: input.defaultLocale ?? latest?.defaultLocale ?? 'de',
          contractTermsText:
            input.contractTermsText === undefined
              ? (latest?.contractTermsText ?? null)
              : cleanText(input.contractTermsText),
          version: currentVersion + 1,
          createdBy: principal.userId,
          createdAt: now,
        })
        .returning();
      if (!row) throw new DocumentGenerationFailedError();
      await this.audit.append(
        transaction,
        this.auditRecord(
          principal,
          request,
          auditContext,
          'document.template_updated',
          'document_template',
          row.id,
          {
            organizationId,
            documentType: type,
            version: row.version,
          },
        ),
      );
      await this.outbox.enqueue(
        transaction,
        createDomainEvent({
          tenantId: principal.tenantId,
          type: 'document.template_updated',
          aggregateType: 'document',
          aggregateId: row.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload: { organizationId, documentType: type, version: row.version },
        }),
      );
      return templateView(row);
    });
  }

  async uploadLogo(
    principal: AuthorizationPrincipal,
    organizationId: string,
    bytes: Uint8Array,
    request: RequestContext,
    auditContext: DocumentAuditContext,
  ): Promise<DocumentLogoView> {
    const resource = { tenantId: principal.tenantId, organizationId };
    assertCan(principal, { action: 'documents.templates.manage', resource });
    const image = inspectLogo(bytes);
    try {
      const validator = await PDFDocument.create();
      if (image.mimeType === 'image/png') await validator.embedPng(bytes);
      else await validator.embedJpg(bytes);
    } catch {
      throw new DocumentLogoInvalidError();
    }
    const id = uuidv7();
    const objectKey = `documents/logos/${principal.tenantId}/${organizationId}/${id}.${image.extension}`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.storage.put({ key: objectKey, body: bytes, contentType: image.mimeType });
    try {
      await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
        await transaction.insert(logoAssets).values({
          id,
          tenantId: principal.tenantId,
          organizationId,
          objectKey,
          sha256,
          mimeType: image.mimeType,
          sizeBytes: bytes.byteLength,
          width: image.width,
          height: image.height,
          createdBy: principal.userId,
          createdAt: new Date(),
        });
        await this.audit.append(
          transaction,
          this.auditRecord(
            principal,
            request,
            auditContext,
            'document.logo_uploaded',
            'document_logo',
            id,
            {
              organizationId,
              mimeType: image.mimeType,
              sizeBytes: bytes.byteLength,
              sha256,
            },
          ),
        );
      });
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
    return {
      id,
      mimeType: image.mimeType,
      sizeBytes: bytes.byteLength,
      width: image.width,
      height: image.height,
      sha256,
    };
  }

  async renderingConfiguration(
    tenantId: string,
    organizationId: string,
    type: DocumentType,
    version?: number,
  ): Promise<DocumentRenderingConfiguration> {
    const config = await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      const filters = [
        eq(documentTemplates.tenantId, tenantId),
        eq(documentTemplates.organizationId, organizationId),
        eq(documentTemplates.documentType, type),
      ];
      if (version !== undefined) {
        if (version === 0)
          return { template: defaultDocumentTemplate(tenantId, organizationId, type), logo: null };
        filters.push(eq(documentTemplates.version, version));
      }
      const [row] = await transaction
        .select()
        .from(documentTemplates)
        .where(and(...filters))
        .orderBy(desc(documentTemplates.version))
        .limit(1);
      if (!row)
        return { template: defaultDocumentTemplate(tenantId, organizationId, type), logo: null };
      if (!row.logoAssetId) return { template: templateView(row), logo: null };
      const [logo] = await transaction
        .select()
        .from(logoAssets)
        .where(
          and(
            eq(logoAssets.tenantId, tenantId),
            eq(logoAssets.organizationId, organizationId),
            eq(logoAssets.id, row.logoAssetId),
          ),
        )
        .limit(1);
      if (!logo) throw new DocumentLogoNotFoundError();
      return { template: templateView(row), logo };
    });
    let logo: PdfBranding['logo'] = null;
    if (config.logo) {
      const bytes = await this.storage.get(config.logo.objectKey);
      if (
        !bytes ||
        bytes.byteLength !== config.logo.sizeBytes ||
        createHash('sha256').update(bytes).digest('hex') !== config.logo.sha256
      ) {
        throw new DocumentArtifactIntegrityError();
      }
      logo = { bytes, mimeType: config.logo.mimeType };
    }
    return {
      template: config.template,
      branding: {
        primaryColor: config.template.primaryColor,
        headerText: config.template.headerText,
        footerText: config.template.footerText,
        contactEmail: config.template.contactEmail,
        contactPhone: config.template.contactPhone,
        contactWebsite: config.template.contactWebsite,
        logo,
      },
    };
  }

  async generate(
    principal: AuthorizationPrincipal,
    input: DocumentGenerationInput,
    request: RequestContext,
    auditContext: DocumentAuditContext,
  ): Promise<DocumentArtifactView> {
    validateGenerationInput(input);
    this.requireScopedGrant(principal, 'documents.generate', {
      tenantId: principal.tenantId,
      organizationId: input.organizationId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.facilityId ? { facilityId: input.facilityId } : {}),
    });
    if (input.payload.documentType !== input.documentType)
      throw new DocumentGenerationFailedError();
    const artifactId = uuidv7();
    const artifact = await this.reserveArtifact(principal, input, artifactId);
    if (artifact.status === 'ready' || artifact.status === 'superseded')
      return artifactView(artifact);
    const objectKey = `documents/artifacts/${principal.tenantId}/${input.organizationId}/${artifact.id}.pdf`;
    let stored = false;
    try {
      const configured = await this.renderingConfiguration(
        principal.tenantId,
        input.organizationId,
        input.documentType,
        artifact.templateVersion,
      );
      const payload: DocumentPayload = { ...input.payload, locale: artifact.locale };
      const bytes = await renderDocumentPdf(payload, configured.branding);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) {
        throw new DocumentGenerationFailedError();
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await this.storage.put({ key: objectKey, body: bytes, contentType: 'application/pdf' });
      stored = true;
      const storedBytes = await this.storage.get(objectKey);
      if (
        !storedBytes ||
        storedBytes.byteLength !== bytes.byteLength ||
        createHash('sha256').update(storedBytes).digest('hex') !== sha256
      ) {
        throw new DocumentGenerationFailedError();
      }
      const updated = await this.finishArtifact(
        principal,
        artifact,
        objectKey,
        sha256,
        bytes.byteLength,
        request,
        auditContext,
      );
      if (!updated) throw new DocumentGenerationFailedError();
      return artifactView(updated);
    } catch (error) {
      if (stored) await this.storage.delete(objectKey).catch(() => undefined);
      await this.failArtifact(principal.tenantId, artifact.id).catch(() => undefined);
      if (error instanceof DocumentGenerationFailedError) throw error;
      throw new DocumentGenerationFailedError();
    }
  }

  async renderPreview(
    principal: AuthorizationPrincipal,
    input: DocumentPreviewInput,
  ): Promise<Uint8Array> {
    this.requireScopedGrant(principal, 'documents.generate', {
      tenantId: principal.tenantId,
      organizationId: input.organizationId,
    });
    if (input.payload.documentType !== input.documentType)
      throw new DocumentGenerationFailedError();
    const configured = await this.renderingConfiguration(
      principal.tenantId,
      input.organizationId,
      input.documentType,
      input.templateVersion,
    );
    const bytes = await renderDocumentPdf(
      { ...input.payload, locale: input.payload.locale ?? configured.template.defaultLocale },
      configured.branding,
    );
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) {
      throw new DocumentGenerationFailedError();
    }
    return bytes;
  }

  async listArtifacts(
    principal: AuthorizationPrincipal,
    filters: DocumentArtifactFilters,
  ): Promise<{ items: DocumentArtifactView[]; page: number; pageSize: number; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new DocumentAccessDeniedError();
    }
    const selectedScope = {
      tenantId: principal.tenantId,
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.facilityId ? { facilityId: filters.facilityId } : {}),
    };
    if (filters.organizationId || filters.clientId || filters.facilityId) {
      this.requireScopedGrant(principal, 'documents.read', selectedScope);
    } else if (!principal.grants.some((grant) => grant.permission === 'documents.read')) {
      throw new DocumentAccessDeniedError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const conditions = [eq(documentArtifacts.tenantId, principal.tenantId)];
      if (filters.clientId) conditions.push(eq(documentArtifacts.clientId, filters.clientId));
      if (filters.organizationId)
        conditions.push(eq(documentArtifacts.organizationId, filters.organizationId));
      if (filters.facilityId) conditions.push(eq(documentArtifacts.facilityId, filters.facilityId));
      if (filters.documentType)
        conditions.push(eq(documentArtifacts.documentType, filters.documentType));
      if (filters.status) conditions.push(eq(documentArtifacts.status, filters.status));
      if (filters.from)
        conditions.push(
          gte(documentArtifacts.createdAt, new Date(`${filters.from}T00:00:00.000Z`)),
        );
      if (filters.until) {
        const untilExclusive = new Date(`${filters.until}T00:00:00.000Z`);
        untilExclusive.setUTCDate(untilExclusive.getUTCDate() + 1);
        conditions.push(lt(documentArtifacts.createdAt, untilExclusive));
      }
      if (filters.sourceEntityType)
        conditions.push(eq(documentArtifacts.sourceEntityType, filters.sourceEntityType));
      if (filters.sourceEntityId)
        conditions.push(eq(documentArtifacts.sourceEntityId, filters.sourceEntityId));
      if (filters.search?.trim()) {
        const pattern = `%${escapeLike(filters.search.trim())}%`;
        conditions.push(
          or(
            ilike(documentArtifacts.title, pattern),
            ilike(documentArtifacts.sourceReference, pattern),
            ilike(documentArtifacts.documentType, pattern),
            ilike(documentArtifacts.sourceEntityType, pattern),
            ilike(clientRecords.firstName, pattern),
            ilike(clientRecords.preferredName, pattern),
            ilike(clientRecords.lastName, pattern),
            ilike(
              sql`concat(coalesce(nullif(${clientRecords.preferredName}, ''), ${clientRecords.firstName}), ' ', ${clientRecords.lastName})`,
              pattern,
            ),
          )!,
        );
      }
      const supportedTypes: DocumentType[] = [
        'service_evidence',
        'service_agreement',
        'invoice',
        'invoice_correction',
        'benefit_overview',
        'claim_summary',
      ];
      const permittedTypes = (principal.roles?.includes('Caregiver') ? [] : supportedTypes)
        .filter((type) => !filters.documentType || type === filters.documentType)
        .filter((type) =>
          principal.grants.some((grant) => grant.permission === sourceReadPermission(type)),
        );
      const documentsScope = documentArtifactPermissionScope(principal, 'documents.read');
      const clientScope = documentArtifactPermissionScope(principal, 'client.read');
      conditions.push(
        permittedTypes.length
          ? or(
              ...permittedTypes.map((type) =>
                and(
                  eq(documentArtifacts.documentType, type),
                  documentsScope,
                  documentArtifactPermissionScope(principal, sourceReadPermission(type)),
                  ...(type === 'service_agreement'
                    ? [or(isNull(documentArtifacts.clientId), clientScope)!]
                    : []),
                ),
              ),
            )!
          : sql`false`,
      );
      const order = filters.order ?? 'desc';
      const direction = (expression: SQLWrapper) =>
        order === 'asc' ? asc(expression) : desc(expression);
      const orderBy =
        filters.sort === 'type'
          ? [
              direction(documentArtifacts.documentType),
              desc(documentArtifacts.createdAt),
              desc(documentArtifacts.id),
            ]
          : filters.sort === 'status'
            ? [
                direction(documentArtifacts.status),
                desc(documentArtifacts.createdAt),
                desc(documentArtifacts.id),
              ]
            : filters.sort === 'name'
              ? [
                  direction(
                    sql`coalesce(${documentArtifacts.title}, ${documentArtifacts.documentType})`,
                  ),
                  desc(documentArtifacts.createdAt),
                  desc(documentArtifacts.id),
                ]
              : [direction(documentArtifacts.createdAt), direction(documentArtifacts.id)];
      const rows = await transaction
        .select({
          artifact: documentArtifacts,
          clientFirstName: clientRecords.firstName,
          clientPreferredName: clientRecords.preferredName,
          clientLastName: clientRecords.lastName,
        })
        .from(documentArtifacts)
        .leftJoin(
          clientRecords,
          and(
            eq(clientRecords.tenantId, documentArtifacts.tenantId),
            eq(clientRecords.id, documentArtifacts.clientId),
          ),
        )
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [count] = await transaction
        .select({ value: sql<number>`count(*)::int` })
        .from(documentArtifacts)
        .leftJoin(
          clientRecords,
          and(
            eq(clientRecords.tenantId, documentArtifacts.tenantId),
            eq(clientRecords.id, documentArtifacts.clientId),
          ),
        )
        .where(and(...conditions));
      return {
        items: rows.map((row) =>
          artifactView(
            row.artifact,
            row.artifact.clientId &&
              can(principal, {
                action: 'client.read',
                resource: {
                  tenantId: principal.tenantId,
                  organizationId: row.artifact.organizationId,
                  ...(row.artifact.facilityId ? { facilityId: row.artifact.facilityId } : {}),
                  clientId: row.artifact.clientId,
                },
              }) &&
              row.clientFirstName &&
              row.clientLastName
              ? displayClientName({
                  firstName: row.clientFirstName,
                  preferredName: row.clientPreferredName,
                  lastName: row.clientLastName,
                })
              : null,
          ),
        ),
        page,
        pageSize,
        total: count?.value ?? 0,
      };
    });
  }

  async artifactForSourceAuthorization(
    principal: AuthorizationPrincipal,
    artifactId: string,
  ): Promise<DocumentArtifactView> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [row] = await transaction
        .select({
          artifact: documentArtifacts,
          clientFirstName: clientRecords.firstName,
          clientPreferredName: clientRecords.preferredName,
          clientLastName: clientRecords.lastName,
        })
        .from(documentArtifacts)
        .leftJoin(
          clientRecords,
          and(
            eq(clientRecords.tenantId, documentArtifacts.tenantId),
            eq(clientRecords.id, documentArtifacts.clientId),
          ),
        )
        .where(
          and(
            eq(documentArtifacts.tenantId, principal.tenantId),
            eq(documentArtifacts.id, artifactId),
          ),
        )
        .limit(1);
      if (!row) throw new DocumentArtifactNotFoundError();
      const artifact = row.artifact;
      this.requireScopedGrant(principal, 'documents.read', {
        tenantId: principal.tenantId,
        organizationId: artifact.organizationId,
        ...(artifact.clientId ? { clientId: artifact.clientId } : {}),
        ...(artifact.facilityId ? { facilityId: artifact.facilityId } : {}),
      });
      this.requireScopedGrant(principal, sourceReadPermission(artifact.documentType), {
        tenantId: principal.tenantId,
        organizationId: artifact.organizationId,
        ...(artifact.clientId ? { clientId: artifact.clientId } : {}),
        ...(artifact.facilityId ? { facilityId: artifact.facilityId } : {}),
      });
      const canReadClientName = artifact.clientId
        ? can(principal, {
            action: 'client.read',
            resource: {
              tenantId: principal.tenantId,
              organizationId: artifact.organizationId,
              ...(artifact.facilityId ? { facilityId: artifact.facilityId } : {}),
              clientId: artifact.clientId,
            },
          })
        : false;
      return artifactView(
        artifact,
        canReadClientName && row.clientFirstName && row.clientLastName
          ? displayClientName({
              firstName: row.clientFirstName,
              preferredName: row.clientPreferredName,
              lastName: row.clientLastName,
            })
          : null,
      );
    });
  }

  async download(
    principal: AuthorizationPrincipal,
    artifactId: string,
    request: RequestContext,
    auditContext: DocumentAuditContext,
  ): Promise<{ fileName: string; bytes: Uint8Array }> {
    const metadata = await this.artifactForSourceAuthorization(principal, artifactId);
    if (metadata.status !== 'ready' && metadata.status !== 'superseded') {
      throw new DocumentArtifactNotFoundError();
    }
    const full = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const [row] = await transaction
          .select()
          .from(documentArtifacts)
          .where(
            and(
              eq(documentArtifacts.tenantId, principal.tenantId),
              eq(documentArtifacts.id, artifactId),
            ),
          )
          .limit(1);
        if (
          !row ||
          (row.status !== 'ready' && row.status !== 'superseded') ||
          !row.objectKey ||
          !row.sha256
        ) {
          throw new DocumentArtifactNotFoundError();
        }
        return row;
      },
    );
    const bytes = await this.storage.get(full.objectKey!);
    if (
      !bytes ||
      bytes.byteLength !== full.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== full.sha256
    ) {
      throw new DocumentArtifactIntegrityError();
    }
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.audit.append(
        transaction,
        this.auditRecord(
          principal,
          request,
          auditContext,
          'document.downloaded',
          'document_artifact',
          full.id,
          {
            documentType: full.documentType,
            clientId: full.clientId,
            sha256: full.sha256,
          },
        ),
      );
    });
    return {
      fileName: documentFileName(full.title, full.documentType, full.generatedAt),
      bytes,
    };
  }

  async recordExport(
    principal: AuthorizationPrincipal,
    input: {
      organizationId: string;
      clientId?: string | null;
      type: 'billing' | 'benefits';
      exportType: string;
      rowCount: number;
    },
    request: RequestContext,
    auditContext: DocumentAuditContext,
  ): Promise<void> {
    this.requireGrant(principal, 'documents.exports.read');
    const resource = {
      tenantId: principal.tenantId,
      organizationId: input.organizationId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    };
    if (!this.hasScopedGrant(principal, 'documents.exports.read', resource)) {
      throw new DocumentAccessDeniedError();
    }
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const eventType =
        input.type === 'billing' ? 'billing.export_generated' : 'benefits.export_generated';
      await this.audit.append(
        transaction,
        this.auditRecord(
          principal,
          request,
          auditContext,
          eventType,
          'data_export',
          input.organizationId,
          {
            exportType: input.exportType,
            rowCount: input.rowCount,
            clientId: input.clientId ?? null,
          },
        ),
      );
      await this.outbox.enqueue(
        transaction,
        createDomainEvent({
          tenantId: principal.tenantId,
          type: eventType,
          aggregateType: input.type === 'billing' ? 'invoice' : 'benefit',
          aggregateId: input.clientId ?? input.organizationId,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload:
            input.type === 'billing'
              ? {
                  organizationId: input.organizationId,
                  exportType: input.exportType,
                  rowCount: input.rowCount,
                }
              : {
                  clientId: input.clientId ?? null,
                  exportType: input.exportType,
                  rowCount: input.rowCount,
                },
        }),
      );
    });
  }

  private async reserveArtifact(
    principal: AuthorizationPrincipal,
    input: DocumentGenerationInput,
    newId: string,
  ): Promise<typeof documentArtifacts.$inferSelect> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [latestTemplate] = await transaction
        .select({
          version: documentTemplates.version,
          defaultLocale: documentTemplates.defaultLocale,
        })
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.tenantId, principal.tenantId),
            eq(documentTemplates.organizationId, input.organizationId),
            eq(documentTemplates.documentType, input.documentType),
          ),
        )
        .orderBy(desc(documentTemplates.version))
        .limit(1);
      const selectedLocale = input.locale ?? latestTemplate?.defaultLocale ?? 'de';
      const [inserted] = await transaction
        .insert(documentArtifacts)
        .values({
          id: newId,
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          facilityId: input.facilityId,
          clientId: input.clientId,
          title: input.payload.title.trim() || null,
          sourceReference: cleanText(input.sourceReference)?.slice(0, 160) ?? null,
          documentType: input.documentType,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          sourceVersion: input.sourceVersion,
          templateVersion: latestTemplate?.version ?? 0,
          locale: selectedLocale,
          objectKey: null,
          sha256: null,
          mimeType: 'application/pdf',
          sizeBytes: null,
          status: 'pending',
          idempotencyKey: input.idempotencyKey,
          generatedAt: null,
          generatedBy: principal.userId,
          createdAt: new Date(),
        })
        .onConflictDoNothing({
          target: [documentArtifacts.tenantId, documentArtifacts.idempotencyKey],
        })
        .returning();
      const row =
        inserted ??
        (
          await transaction
            .select()
            .from(documentArtifacts)
            .where(
              and(
                eq(documentArtifacts.tenantId, principal.tenantId),
                eq(documentArtifacts.idempotencyKey, input.idempotencyKey),
              ),
            )
            .for('update')
            .limit(1)
        )[0];
      if (!row) throw new DocumentGenerationFailedError();
      if (
        row.organizationId !== input.organizationId ||
        row.clientId !== input.clientId ||
        row.documentType !== input.documentType ||
        row.sourceEntityType !== input.sourceEntityType ||
        row.sourceEntityId !== input.sourceEntityId ||
        row.sourceVersion !== input.sourceVersion
      ) {
        throw new DocumentIdempotencyConflictError();
      }
      if (
        input.expectedTemplateVersion !== undefined &&
        row.templateVersion !== input.expectedTemplateVersion
      ) {
        throw new DocumentTemplateVersionConflictError();
      }
      if (row.status === 'failed') {
        const [retried] = await transaction
          .update(documentArtifacts)
          .set({ status: 'pending' })
          .where(
            and(
              eq(documentArtifacts.tenantId, principal.tenantId),
              eq(documentArtifacts.id, row.id),
            ),
          )
          .returning();
        return retried ?? row;
      }
      return row;
    });
  }

  private async finishArtifact(
    principal: AuthorizationPrincipal,
    artifact: typeof documentArtifacts.$inferSelect,
    objectKey: string,
    sha256: string,
    sizeBytes: number,
    request: RequestContext,
    auditContext: DocumentAuditContext,
  ): Promise<typeof documentArtifacts.$inferSelect | null> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const now = new Date();
      const [updated] = await transaction
        .update(documentArtifacts)
        .set({ status: 'ready', objectKey, sha256, sizeBytes, generatedAt: now })
        .where(
          and(
            eq(documentArtifacts.tenantId, principal.tenantId),
            eq(documentArtifacts.id, artifact.id),
            eq(documentArtifacts.status, 'pending'),
          ),
        )
        .returning();
      if (!updated) {
        const [existing] = await transaction
          .select()
          .from(documentArtifacts)
          .where(
            and(
              eq(documentArtifacts.tenantId, principal.tenantId),
              eq(documentArtifacts.id, artifact.id),
            ),
          )
          .limit(1);
        return existing?.status === 'ready' ? existing : null;
      }
      await this.audit.append(
        transaction,
        this.auditRecord(
          principal,
          request,
          auditContext,
          'document.generated',
          'document_artifact',
          updated.id,
          {
            documentType: updated.documentType,
            sourceEntityType: updated.sourceEntityType,
            sourceEntityId: updated.sourceEntityId,
            sourceVersion: updated.sourceVersion,
            templateVersion: updated.templateVersion,
            locale: updated.locale,
            sha256,
            sizeBytes,
          },
        ),
      );
      await this.outbox.enqueue(
        transaction,
        createDomainEvent({
          tenantId: principal.tenantId,
          type: 'document.generated',
          aggregateType: 'document',
          aggregateId: updated.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload: {
            artifactId: updated.id,
            clientId: updated.clientId,
            documentType: updated.documentType,
            sourceEntityType: updated.sourceEntityType,
            sourceEntityId: updated.sourceEntityId,
            templateVersion: updated.templateVersion,
            locale: updated.locale,
            sha256,
          },
        }),
      );
      const superseded = await transaction
        .update(documentArtifacts)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(documentArtifacts.tenantId, principal.tenantId),
            eq(documentArtifacts.organizationId, updated.organizationId),
            eq(documentArtifacts.documentType, updated.documentType),
            eq(documentArtifacts.sourceEntityType, updated.sourceEntityType),
            eq(documentArtifacts.sourceEntityId, updated.sourceEntityId),
            eq(documentArtifacts.status, 'ready'),
            sql`${documentArtifacts.id} <> ${updated.id}`,
          ),
        )
        .returning({
          id: documentArtifacts.id,
          sourceEntityType: documentArtifacts.sourceEntityType,
          sourceEntityId: documentArtifacts.sourceEntityId,
          documentType: documentArtifacts.documentType,
        });
      for (const previous of superseded) {
        await this.outbox.enqueue(
          transaction,
          createDomainEvent({
            tenantId: principal.tenantId,
            type: 'document.artifact_superseded',
            aggregateType: 'document',
            aggregateId: previous.id,
            actor: { type: 'user', id: principal.userId },
            correlationId: request.correlationId,
            payload: {
              artifactId: previous.id,
              sourceEntityType: previous.sourceEntityType,
              sourceEntityId: previous.sourceEntityId,
              documentType: previous.documentType,
            },
          }),
        );
      }
      return updated;
    });
  }

  private async failArtifact(tenantId: string, artifactId: string): Promise<void> {
    await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      await transaction
        .update(documentArtifacts)
        .set({
          status: 'failed',
          objectKey: null,
          sha256: null,
          sizeBytes: null,
          generatedAt: null,
        })
        .where(
          and(
            eq(documentArtifacts.tenantId, tenantId),
            eq(documentArtifacts.id, artifactId),
            eq(documentArtifacts.status, 'pending'),
          ),
        );
    });
  }

  private requireTemplateRead(principal: AuthorizationPrincipal, resource: ResourceContext): void {
    if (
      !can(principal, { action: 'documents.read', resource }) &&
      !can(principal, { action: 'documents.templates.manage', resource })
    ) {
      throw new DocumentAccessDeniedError();
    }
  }

  private requireGrant(principal: AuthorizationPrincipal, permission: Permission): void {
    if (
      principal.tenantId.length === 0 ||
      !principal.grants.some((grant) => grant.permission === permission)
    ) {
      throw new DocumentAccessDeniedError();
    }
  }

  private requireScopedGrant(
    principal: AuthorizationPrincipal,
    permission: Permission,
    resource: ResourceContext,
  ): void {
    if (!can(principal, { action: permission, resource })) throw new DocumentAccessDeniedError();
  }

  private hasScopedGrant(
    principal: AuthorizationPrincipal,
    permission: Permission,
    resource: ResourceContext,
  ): boolean {
    return can(principal, { action: permission, resource });
  }

  private auditRecord(
    principal: AuthorizationPrincipal,
    request: RequestContext,
    context: DocumentAuditContext,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    return {
      id: uuidv7(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action,
      resourceType,
      resourceId,
      timestamp: new Date(),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(context.ip ? { ip: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      metadata,
    };
  }
}

export function createDocumentsApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  storage: ObjectStorage,
): DocumentsApplicationService {
  return new DocumentsApplicationService(unitOfWork, audit, outbox, storage);
}

function templateView(row: typeof documentTemplates.$inferSelect): DocumentTemplateView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    documentType: row.documentType,
    logoAssetId: row.logoAssetId,
    primaryColor: row.primaryColor,
    headerText: row.headerText,
    footerText: row.footerText,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    contactWebsite: row.contactWebsite,
    defaultLocale: row.defaultLocale,
    contractTermsText: row.contractTermsText,
    version: row.version,
    createdAt: row.createdAt,
  };
}

function artifactView(
  row: typeof documentArtifacts.$inferSelect,
  clientName: string | null = null,
): DocumentArtifactView {
  return {
    id: row.id,
    title: row.title,
    sourceReference: row.sourceReference,
    clientName,
    clientId: row.clientId,
    organizationId: row.organizationId,
    facilityId: row.facilityId,
    documentType: row.documentType,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    sourceVersion: row.sourceVersion,
    templateVersion: row.templateVersion,
    locale: row.locale,
    sha256: row.sha256,
    mimeType: 'application/pdf',
    sizeBytes: row.sizeBytes,
    status: row.status,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    generatedBy: row.generatedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function documentFileName(
  title: string | null,
  documentType: DocumentType,
  generatedAt: Date | null,
): string {
  const slug = (title || documentType)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const date = generatedAt?.toISOString().slice(0, 10).replaceAll('-', '') ?? '';
  return `${slug || 'document'}${date ? `-${date}` : ''}.pdf`;
}

function validateGenerationInput(input: DocumentGenerationInput): void {
  if (
    !isUuid(input.idempotencyKey) ||
    !isUuid(input.organizationId) ||
    (input.facilityId !== null && !isUuid(input.facilityId)) ||
    (input.clientId !== null && !isUuid(input.clientId)) ||
    (input.sourceReference !== undefined &&
      input.sourceReference !== null &&
      input.sourceReference.length > 160) ||
    !isUuid(input.sourceEntityId) ||
    !input.sourceEntityType.trim() ||
    input.sourceEntityType.length > 80 ||
    !input.sourceVersion.trim() ||
    input.sourceVersion.length > 200 ||
    (input.expectedTemplateVersion !== undefined &&
      (!Number.isInteger(input.expectedTemplateVersion) || input.expectedTemplateVersion < 0)) ||
    input.payload.sections.length > 100 ||
    (input.payload.acknowledgements && input.payload.acknowledgements.length > 100)
  ) {
    throw new DocumentGenerationFailedError();
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function sourceReadPermission(type: DocumentType): Permission {
  switch (type) {
    case 'service_evidence':
      return 'service_evidence.read';
    case 'service_agreement':
      return 'service_agreement.read';
    case 'invoice':
    case 'invoice_correction':
      return 'billing.read';
    case 'benefit_overview':
      return 'benefits.read';
    case 'claim_summary':
      return 'claims.read';
  }
}

function documentArtifactPermissionScope(
  principal: AuthorizationPrincipal,
  permission: Permission,
): SQL {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  if (
    grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
  ) {
    return sql`true`;
  }

  const scopes: SQL[] = [];
  const organizationIds = grants
    .filter((grant) => grant.scopeType === 'organization')
    .map((grant) => grant.scopeId);
  const facilityIds = grants
    .filter((grant) => grant.scopeType === 'facility')
    .map((grant) => grant.scopeId);
  if (organizationIds.length)
    scopes.push(inArray(documentArtifacts.organizationId, organizationIds));
  if (facilityIds.length) scopes.push(inArray(documentArtifacts.facilityId, facilityIds));
  return scopes.length ? or(...scopes)! : sql`false`;
}

function inspectLogo(bytes: Uint8Array): {
  mimeType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
  width: number;
  height: number;
} {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES)
    throw new DocumentLogoInvalidError();
  const png =
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR';
  let image: LogoImage | null = null;
  if (png) {
    image = {
      mimeType: 'image/png',
      extension: 'png',
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20),
    };
  } else {
    image = jpegDimensions(bytes);
  }
  if (!image || image.width < 1 || image.width > 2400 || image.height < 1 || image.height > 1200) {
    throw new DocumentLogoInvalidError();
  }
  return image;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function jpegDimensions(bytes: Uint8Array): {
  mimeType: 'image/jpeg';
  extension: 'jpg';
  width: number;
  height: number;
} | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return { mimeType: 'image/jpeg', extension: 'jpg', width, height };
    }
    offset += length;
  }
  return null;
}
