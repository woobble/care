export const DOCUMENT_TYPES = [
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentLocale = 'de' | 'en';
export type DocumentArtifactStatus = 'pending' | 'ready' | 'failed' | 'superseded';

export interface DocumentTemplateConfig {
  id: string | null;
  tenantId: string;
  organizationId: string;
  documentType: DocumentType;
  logoAssetId: string | null;
  primaryColor: string;
  headerText: string | null;
  footerText: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  defaultLocale: DocumentLocale;
  contractTermsText: string | null;
  version: number;
  createdAt: Date | null;
}

export interface DocumentProvider {
  name: string;
  addressLines: string[];
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface DocumentRecipient {
  name: string;
  addressLines: string[];
  reference?: string | null;
}

export interface DocumentSection {
  title: string;
  columns?: string[];
  rows?: string[][];
  paragraphs?: string[];
}

export interface DocumentAcknowledgement {
  status: 'awaiting_acknowledgement' | 'acknowledged' | 'declined' | 'revoked' | 'outdated';
  evidencePackageVersion: number;
  evidencePackageHash: string;
  signatoryName?: string | null;
  method?: 'touch_signature' | 'typed_confirmation' | 'staff_recorded_decline' | null;
  statementVersion?: string | null;
  statementText?: string | null;
  occurredAt?: string | null;
  declineReason?: string | null;
  declineNote?: string | null;
  signatureStrokes?: Array<Array<{ x: number; y: number }>> | null;
}

export interface DocumentPayload {
  documentType: DocumentType;
  locale: DocumentLocale;
  title: string;
  subtitle?: string | null;
  provider: DocumentProvider;
  recipient?: DocumentRecipient | null;
  metadata?: Array<{ label: string; value: string }>;
  sections: DocumentSection[];
  totals?: Array<{ label: string; value: string; emphasized?: boolean }>;
  acknowledgements?: DocumentAcknowledgement[];
  notices?: string[];
}

export interface DocumentTemplateInput {
  expectedVersion: number;
  logoAssetId?: string | null;
  primaryColor?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWebsite?: string | null;
  defaultLocale?: DocumentLocale;
  contractTermsText?: string | null;
}

export interface DocumentArtifactView {
  id: string;
  clientId: string | null;
  organizationId: string;
  facilityId: string | null;
  documentType: DocumentType;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceVersion: string;
  templateVersion: number;
  locale: DocumentLocale;
  sha256: string | null;
  mimeType: 'application/pdf';
  sizeBytes: number | null;
  status: DocumentArtifactStatus;
  generatedAt: string | null;
  generatedBy: string;
  createdAt: string;
}

export interface DocumentGenerationInput {
  idempotencyKey: string;
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  documentType: DocumentType;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceVersion: string;
  expectedTemplateVersion?: number;
  locale?: DocumentLocale;
  payload: DocumentPayload;
}

export class DocumentDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentDomainError';
  }
}

export class DocumentSourceNotFoundError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_SOURCE_NOT_FOUND', 'The document source was not found');
  }
}

export class DocumentSourceNotReadyError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_SOURCE_NOT_READY', 'The source is not ready for document generation');
  }
}

export class DocumentTemplateInvalidError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_TEMPLATE_INVALID', 'The document template configuration is invalid');
  }
}

export class DocumentGenerationFailedError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_GENERATION_FAILED', 'The document could not be generated');
  }
}

export class DocumentArtifactNotFoundError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_ARTIFACT_NOT_FOUND', 'The document artifact was not found');
  }
}

export class DocumentArtifactIntegrityError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_ARTIFACT_INTEGRITY_FAILED', 'The document artifact failed its integrity check');
  }
}

export class DocumentAccessDeniedError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_ACCESS_DENIED', 'The document is not available to the current user');
  }
}

export class DocumentIdempotencyConflictError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_GENERATION_CONFLICT', 'The idempotency key was used for another document');
  }
}

export class DocumentTemplateVersionConflictError extends DocumentDomainError {
  constructor() {
    super(
      'DOCUMENT_TEMPLATE_VERSION_CONFLICT',
      'The document template changed; reload it and retry',
    );
  }
}

export class DocumentLogoInvalidError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_TEMPLATE_INVALID', 'The logo must be a valid, bounded PNG or JPEG image');
  }
}

export class DocumentLogoNotFoundError extends DocumentDomainError {
  constructor() {
    super('DOCUMENT_TEMPLATE_INVALID', 'The configured logo is unavailable');
  }
}

export class ExportFilterInvalidError extends DocumentDomainError {
  constructor() {
    super('EXPORT_FILTER_INVALID', 'The export filters are invalid or unbounded');
  }
}

export class ExportRowLimitExceededError extends DocumentDomainError {
  constructor() {
    super('EXPORT_ROW_LIMIT_EXCEEDED', 'The export exceeds the allowed row limit');
  }
}

export class ExportFormatUnsupportedError extends DocumentDomainError {
  constructor() {
    super('EXPORT_FORMAT_UNSUPPORTED', 'The requested export format is not supported');
  }
}

export function defaultDocumentTemplate(
  tenantId: string,
  organizationId: string,
  documentType: DocumentType,
): DocumentTemplateConfig {
  return {
    id: null,
    tenantId,
    organizationId,
    documentType,
    logoAssetId: null,
    primaryColor: '#1D4ED8',
    headerText: null,
    footerText: null,
    contactEmail: null,
    contactPhone: null,
    contactWebsite: null,
    defaultLocale: 'de',
    contractTermsText: null,
    version: 0,
    createdAt: null,
  };
}

export function validateTemplateInput(input: DocumentTemplateInput): void {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    (input.primaryColor != null && !/^#[0-9a-f]{6}$/i.test(input.primaryColor)) ||
    (input.headerText != null && input.headerText.length > 500) ||
    (input.footerText != null && input.footerText.length > 500) ||
    (input.contactEmail != null && input.contactEmail.length > 254) ||
    (input.contactPhone != null && input.contactPhone.length > 80) ||
    (input.contactWebsite != null && input.contactWebsite.length > 254) ||
    (input.contractTermsText != null && input.contractTermsText.length > 8000) ||
    (input.defaultLocale != null && input.defaultLocale !== 'de' && input.defaultLocale !== 'en')
  ) {
    throw new DocumentTemplateInvalidError();
  }
}
