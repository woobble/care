import { v7 as uuidv7 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { DomainEvent, EventName } from '@care/events';
import { createDomainEvent } from '@care/events';
import { evaluateDocumentationCompleteness } from '@care/care-documentation';
import type { ClientRepresentationType, ClientRelationshipType } from '@care/clients';
import { assertCan, can } from '@care/permissions';
import type { AuthorizationPrincipal, Permission, ResourceContext } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { ObjectStorage } from '@care/storage';
import {
  ACKNOWLEDGEMENT_STATEMENT_TEXT,
  ACKNOWLEDGEMENT_STATEMENT_VERSION,
  canonicalSignature,
  hashEvidenceSnapshot,
  hashSignatureArtifact,
  isRepresentativeAuthorizedAt,
  isTypedConfirmationValid,
  normalizeQuantity,
  verifyEvidenceSnapshot,
  type AcknowledgementMethod,
  type DeclineReasonCode,
  type EvidencePackageItem,
  type EvidenceSignatoryType,
  type EvidenceSnapshot,
  type SignatoryCapacity,
  type SignatureStrokes,
} from '@module/service-evidence/domain/service-evidence';
import { acknowledgements, evidencePackages } from '@module/service-evidence/schema';
import {
  ServiceEvidenceRepository,
  type EligibleContactRow,
  type EvidenceVisitContext,
} from '@module/service-evidence/infrastructure/service-evidence.repository';

type AuditContext = { ip?: string; userAgent?: string };
type SelectedSignatory =
  | { type: 'client' }
  | { type: 'representative' | 'other_authorized_person'; contactId: string };

export type AcknowledgeEvidenceInput = {
  idempotencyKey: string;
  signatory: SelectedSignatory;
  method: AcknowledgementMethod;
  confirmationName?: string;
  strokes?: SignatureStrokes;
};

export type DeclineEvidenceInput = {
  idempotencyKey: string;
  signatory: SelectedSignatory;
  reasonCode: DeclineReasonCode;
  note?: string | null;
};

export interface EvidenceAcknowledgementView {
  id: string;
  status: 'acknowledged' | 'declined' | 'revoked';
  signatoryType: EvidenceSignatoryType;
  signatoryName: string;
  signatoryContactId: string | null;
  capacity: SignatoryCapacity;
  relationship: string | null;
  representationType: string | null;
  method: string;
  statementVersion: string;
  statementText: string;
  evidencePackageHash: string;
  signatureSha256: string | null;
  signatureAvailable: boolean;
  acknowledgedAt: string | null;
  declinedAt: string | null;
  declineReasonCode: string | null;
  declineNote: string | null;
  capturedByEmployeeId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revocationReason: string | null;
}

export interface EligibleSignatoryView {
  contactId: string;
  displayName: string;
  signatoryType: 'representative' | 'other_authorized_person';
  capacity: Exclude<SignatoryCapacity, 'client'>;
  relationship: string;
  representationType: ClientRepresentationType;
}

export interface EvidencePackageView {
  id: string;
  documentationId: string;
  version: number;
  generatedAt: string;
  snapshotHash: string;
  snapshot: EvidenceSnapshot;
  statementVersion: string;
  statementText: string;
  isCurrent: boolean;
  status: 'ready' | 'acknowledged' | 'declined' | 'revoked' | 'outdated';
  acknowledgementRequired: boolean;
  acknowledgements: EvidenceAcknowledgementView[];
  eligibleSignatories: EligibleSignatoryView[];
}

export interface BillingEvidenceReadiness {
  documentationStatus: 'missing' | 'draft' | 'finalized';
  executionStatus: 'missing' | 'in_progress' | 'completed';
  evidencePackageId: string | null;
  snapshotHash: string | null;
  isCurrent: boolean;
  acknowledgementStatus: EvidencePackageView['status'] | 'missing';
}

export type ServiceEvidenceWorklistStatus =
  | 'awaiting_acknowledgement'
  | 'acknowledged'
  | 'declined'
  | 'revoked'
  | 'outdated'
  | 'superseded';

export interface ServiceEvidenceWorklistQuery {
  from: Date;
  until: Date;
  page: number;
  pageSize: number;
  status?: ServiceEvidenceWorklistStatus;
  visitId?: string;
  clientId?: string;
  clientQuery?: string;
  employeeId?: string;
  organizationId?: string;
  facilityId?: string;
  signatoryType?: EvidenceSignatoryType;
}

export interface ServiceEvidenceWorklistItem {
  visitId: string;
  documentationId: string;
  evidencePackageId: string | null;
  packageVersion: number | null;
  clientId: string;
  clientName: string;
  plannedStart: string;
  timezone: string;
  status: ServiceEvidenceWorklistStatus;
  snapshotHash: string | null;
  signatoryType: EvidenceSignatoryType | null;
  signatoryName: string | null;
  capacity: SignatoryCapacity | null;
  method: string | null;
  acknowledgedAt: string | null;
  signatureAvailable: boolean;
}

export interface ServiceEvidenceWorklist {
  items: ServiceEvidenceWorklistItem[];
  page: number;
  pageSize: number;
  total: number;
}

type LockedSource = {
  context: EvidenceVisitContext;
  document: NonNullable<Awaited<ReturnType<ServiceEvidenceRepository['documentForVisit']>>>;
  execution: NonNullable<Awaited<ReturnType<ServiceEvidenceRepository['executionById']>>>;
  client: NonNullable<Awaited<ReturnType<ServiceEvidenceRepository['lockClient']>>> | null;
};

type CaptureResult = { acknowledgement: EvidenceAcknowledgementView; created: boolean };

export class ServiceEvidenceApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly storage: ObjectStorage,
    private readonly repository = new ServiceEvidenceRepository(),
  ) {}

  async getForVisit(principal: AuthorizationPrincipal, visitId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const context = await this.requireVisitContext(transaction, principal.tenantId, visitId);
      await this.authorizeVisit(principal, transaction, context, 'service_evidence.read');
      const document = await this.repository.documentForVisit(
        transaction,
        principal.tenantId,
        visitId,
      );
      if (!document) throw new EvidencePackageNotFoundError();
      const evidencePackage = await this.repository.latestPackage(
        transaction,
        principal.tenantId,
        document.id,
      );
      if (!evidencePackage) throw new EvidencePackageNotFoundError();
      const source = await this.readSource(transaction, principal.tenantId, visitId);
      return this.packageView(transaction, principal.tenantId, evidencePackage, source);
    });
  }

  async getBillingReadiness(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<BillingEvidenceReadiness> {
    const document = await this.repository.documentForVisit(transaction, tenantId, visitId);
    if (!document) {
      return {
        documentationStatus: 'missing',
        executionStatus: 'missing',
        evidencePackageId: null,
        snapshotHash: null,
        isCurrent: false,
        acknowledgementStatus: 'missing',
      };
    }
    const source = await this.readSourceByDocument(transaction, tenantId, document.id);
    const evidencePackage = await this.repository.latestPackage(transaction, tenantId, document.id);
    if (!evidencePackage) {
      return {
        documentationStatus: source.document.status,
        executionStatus: source.execution.status,
        evidencePackageId: null,
        snapshotHash: null,
        isCurrent: false,
        acknowledgementStatus: 'missing',
      };
    }
    const view = await this.packageView(transaction, tenantId, evidencePackage, source);
    return {
      documentationStatus: source.document.status,
      executionStatus: source.execution.status,
      evidencePackageId: view.id,
      snapshotHash: view.snapshotHash,
      isCurrent: view.isCurrent,
      acknowledgementStatus: view.status,
    };
  }

  async getPackage(principal: AuthorizationPrincipal, evidencePackageId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const evidencePackage = await this.repository.packageById(
        transaction,
        principal.tenantId,
        evidencePackageId,
      );
      if (!evidencePackage) throw new EvidencePackageNotFoundError();
      const source = await this.readSourceByDocument(
        transaction,
        principal.tenantId,
        evidencePackage.documentationId,
      );
      await this.authorizeVisit(principal, transaction, source.context, 'service_evidence.read');
      return this.packageView(transaction, principal.tenantId, evidencePackage, source);
    });
  }

  async prepare(
    principal: AuthorizationPrincipal,
    visitId: string,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<EvidencePackageView> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const source = await this.lockSource(transaction, principal.tenantId, visitId);
      const permission: Permission = principal.roles?.includes('Caregiver')
        ? 'acknowledgement.capture'
        : 'service_evidence.prepare';
      await this.authorizeVisit(principal, transaction, source.context, permission);
      this.assertReadySource(source);

      if (!source.client) throw new EvidencePackageInvalidStateError();
      const snapshot = await this.createSnapshotFromRows(transaction, principal.tenantId, {
        visit: source.context.visit,
        execution: source.execution,
        client: source.client,
        document: source.document,
      });
      const snapshotHash = hashEvidenceSnapshot(snapshot);
      const latest = await this.repository.latestPackage(
        transaction,
        principal.tenantId,
        source.document.id,
      );
      if (
        latest &&
        latest.documentationVersion === source.document.version &&
        latest.executionVersion === source.execution.version &&
        latest.amendmentCount === snapshot.amendmentCount &&
        latest.snapshotHash === snapshotHash
      ) {
        if (!verifyEvidenceSnapshot(latest.snapshot, latest.snapshotHash)) {
          throw new EvidencePackageIntegrityError();
        }
        return this.packageView(transaction, principal.tenantId, latest, source);
      }

      const now = new Date();
      const packageId = uuidv7();
      const [created] = await transaction
        .insert(evidencePackages)
        .values({
          id: packageId,
          tenantId: principal.tenantId,
          documentationId: source.document.id,
          version: (latest?.version ?? 0) + 1,
          documentationVersion: source.document.version,
          executionVersion: source.execution.version,
          amendmentCount: snapshot.amendmentCount,
          snapshot,
          snapshotHash,
          generatedAt: now,
          createdByUserId: principal.userId,
        })
        .returning();
      if (!created) throw new EvidencePackageInvalidStateError();

      if (latest) {
        await this.recordLifecycle(transaction, principal, request, auditContext, {
          action: 'evidence_package.superseded',
          eventType: 'evidence_package.superseded',
          eventId: uuidv7(),
          source,
          aggregateId: packageId,
          payload: {
            evidencePackageId: packageId,
            supersedesEvidencePackageId: latest.id,
            documentationId: source.document.id,
            visitId,
            clientId: source.context.clientId,
            snapshotHash,
            version: created.version,
          },
          metadata: {
            evidencePackageId: packageId,
            supersedesEvidencePackageId: latest.id,
            documentationId: source.document.id,
            version: created.version,
          },
        });
      }
      await this.recordLifecycle(transaction, principal, request, auditContext, {
        action: 'evidence_package.created',
        eventType: 'evidence_package.created',
        eventId: uuidv7(),
        source,
        aggregateId: packageId,
        payload: {
          evidencePackageId: packageId,
          documentationId: source.document.id,
          visitId,
          clientId: source.context.clientId,
          version: created.version,
          snapshotHash,
        },
        metadata: {
          evidencePackageId: packageId,
          documentationId: source.document.id,
          version: created.version,
          snapshotHash,
        },
      });
      return this.packageView(transaction, principal.tenantId, created, source);
    });
  }

  async acknowledge(
    principal: AuthorizationPrincipal,
    evidencePackageId: string,
    input: AcknowledgeEvidenceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    validateIdempotencyKey(input.idempotencyKey);
    const signatureBytes =
      input.method === 'touch_signature' ? canonicalSignature(input.strokes ?? []) : null;
    if (input.method === 'typed_confirmation' && !input.confirmationName) {
      throw new AcknowledgementConfirmationRequiredError();
    }
    if (input.method === 'touch_signature' && input.confirmationName !== undefined) {
      throw new AcknowledgementInvalidInputError();
    }
    if (input.method === 'typed_confirmation' && input.strokes !== undefined) {
      throw new AcknowledgementInvalidInputError();
    }
    const signatureSha256 = signatureBytes ? hashSignatureArtifact(signatureBytes) : null;
    const candidateId = uuidv7();
    const signatureStorageKey = signatureBytes
      ? `service-evidence/signatures/${principal.tenantId}/${candidateId}.json`
      : null;

    const previous = await this.captureTransaction(
      principal,
      evidencePackageId,
      input,
      signatureSha256,
      null,
      request,
      auditContext,
      undefined,
      undefined,
      true,
    );
    if (previous) return previous.acknowledgement;

    if (signatureBytes && signatureStorageKey) {
      try {
        await this.storage.put({
          key: signatureStorageKey,
          body: signatureBytes,
          contentType: 'application/json',
        });
      } catch (error) {
        await this.deleteSignatureArtifact(signatureStorageKey);
        throw error;
      }
    }

    try {
      const result = await this.captureTransaction(
        principal,
        evidencePackageId,
        input,
        signatureSha256,
        signatureStorageKey,
        request,
        auditContext,
        candidateId,
      );
      if (!result) throw new AcknowledgementInvalidStateError();
      if (signatureStorageKey && result.acknowledgement.signatureSha256 !== signatureSha256) {
        await this.deleteSignatureArtifact(signatureStorageKey);
      } else if (signatureStorageKey && result.acknowledgement.id !== candidateId) {
        await this.deleteSignatureArtifact(signatureStorageKey);
      }
      return result.acknowledgement;
    } catch (error) {
      if (signatureStorageKey) await this.deleteSignatureArtifact(signatureStorageKey);
      throw error;
    }
  }

  async decline(
    principal: AuthorizationPrincipal,
    evidencePackageId: string,
    input: DeclineEvidenceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    validateIdempotencyKey(input.idempotencyKey);
    if (
      ![
        'declined_without_reason',
        'disagrees_with_record',
        'unable_to_sign',
        'signatory_not_available',
        'other',
      ].includes(input.reasonCode)
    ) {
      throw new AcknowledgementInvalidInputError();
    }
    const note = input.note?.trim() || null;
    if (note && note.length > 500) throw new AcknowledgementInvalidInputError();
    const result = await this.captureTransaction(
      principal,
      evidencePackageId,
      input,
      null,
      null,
      request,
      auditContext,
      uuidv7(),
      { reasonCode: input.reasonCode, note },
    );
    if (!result) throw new AcknowledgementInvalidStateError();
    return result.acknowledgement;
  }

  async revoke(
    principal: AuthorizationPrincipal,
    acknowledgementId: string,
    reason: string,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 1 || normalizedReason.length > 500) {
      throw new AcknowledgementRevocationReasonRequiredError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const existing = await this.repository.acknowledgementById(
        transaction,
        principal.tenantId,
        acknowledgementId,
      );
      if (!existing) throw new AcknowledgementNotFoundError();
      const evidencePackage = await this.repository.packageById(
        transaction,
        principal.tenantId,
        existing.evidencePackageId,
      );
      if (!evidencePackage) throw new EvidencePackageNotFoundError();
      const source = await this.lockSourceByDocument(
        transaction,
        principal.tenantId,
        evidencePackage.documentationId,
      );
      await this.authorizeVisit(principal, transaction, source.context, 'acknowledgement.revoke');
      const lockedPackage = await this.repository.packageById(
        transaction,
        principal.tenantId,
        evidencePackage.id,
      );
      const acknowledgement = await this.repository.acknowledgementById(
        transaction,
        principal.tenantId,
        acknowledgementId,
        true,
      );
      if (!lockedPackage || !acknowledgement) throw new AcknowledgementNotFoundError();
      if (acknowledgement.revokedAt) return acknowledgementView(acknowledgement);
      if (acknowledgement.status !== 'acknowledged') {
        throw new AcknowledgementInvalidStateError();
      }

      const now = new Date();
      const [revoked] = await transaction
        .update(acknowledgements)
        .set({
          revokedAt: now,
          revokedByUserId: principal.userId,
          revocationReason: normalizedReason,
        })
        .where(
          and(
            eq(acknowledgements.tenantId, principal.tenantId),
            eq(acknowledgements.id, acknowledgementId),
            eq(acknowledgements.status, 'acknowledged'),
          ),
        )
        .returning();
      if (!revoked) throw new AcknowledgementInvalidStateError();
      await this.recordLifecycle(transaction, principal, request, auditContext, {
        action: 'acknowledgement.revoked',
        eventType: 'service_evidence.acknowledgement_revoked',
        eventId: uuidv7(),
        source,
        aggregateId: acknowledgementId,
        payload: {
          acknowledgementId,
          evidencePackageId: evidencePackage.id,
          documentationId: source.document.id,
          visitId: source.context.visit.id,
          clientId: source.context.clientId,
          evidencePackageHash: acknowledgement.evidencePackageHash,
        },
        metadata: {
          acknowledgementId,
          evidencePackageId: evidencePackage.id,
          documentationId: source.document.id,
        },
      });
      return acknowledgementView(revoked);
    });
  }

  async getSignature(principal: AuthorizationPrincipal, acknowledgementId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const acknowledgement = await this.repository.acknowledgementById(
        transaction,
        principal.tenantId,
        acknowledgementId,
      );
      if (!acknowledgement) throw new AcknowledgementNotFoundError();
      if (!acknowledgement.signatureStorageKey || !acknowledgement.signatureSha256) {
        throw new AcknowledgementSignatureNotFoundError();
      }
      const evidencePackage = await this.repository.packageById(
        transaction,
        principal.tenantId,
        acknowledgement.evidencePackageId,
      );
      if (!evidencePackage) throw new EvidencePackageNotFoundError();
      const source = await this.readSourceByDocument(
        transaction,
        principal.tenantId,
        evidencePackage.documentationId,
      );
      await this.authorizeVisit(principal, transaction, source.context, 'acknowledgement.read');
      if (!verifyEvidenceSnapshot(evidencePackage.snapshot, evidencePackage.snapshotHash)) {
        throw new EvidencePackageIntegrityError();
      }
      if (acknowledgement.evidencePackageHash !== evidencePackage.snapshotHash) {
        throw new EvidencePackageIntegrityError();
      }
      const bytes = await this.storage.get(acknowledgement.signatureStorageKey);
      if (!bytes || hashSignatureArtifact(bytes) !== acknowledgement.signatureSha256) {
        throw new AcknowledgementSignatureIntegrityError();
      }
      let parsed: { version?: number; strokes?: SignatureStrokes };
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as typeof parsed;
      } catch {
        throw new AcknowledgementSignatureIntegrityError();
      }
      if (parsed.version !== 1 || !parsed.strokes)
        throw new AcknowledgementSignatureIntegrityError();
      const canonical = canonicalSignature(parsed.strokes);
      if (hashSignatureArtifact(canonical) !== acknowledgement.signatureSha256) {
        throw new AcknowledgementSignatureIntegrityError();
      }
      return { version: 1 as const, strokes: parsed.strokes };
    });
  }

  async worklist(
    principal: AuthorizationPrincipal,
    query: ServiceEvidenceWorklistQuery,
  ): Promise<ServiceEvidenceWorklist> {
    validateWorklistQuery(query);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await this.repository.finalizedDocumentationRows(
        transaction,
        principal.tenantId,
        query,
      );
      const visitIds = rows.map((row) => row.visit.id);
      const employee = principal.roles?.includes('Caregiver')
        ? await this.requireEmployee(transaction, principal)
        : null;
      const relatedVisits = employee
        ? await this.repository.caregiverVisitIds(transaction, principal.tenantId, employee.id)
        : null;
      const teamsByVisit = await this.repository.teamIdsForVisits(
        transaction,
        principal.tenantId,
        visitIds,
      );
      const allowedRows = rows.filter((row) => {
        const resource: ResourceContext = {
          tenantId: row.visit.tenantId,
          clientId: row.visit.clientId,
          organizationId: row.visit.organizationId,
          facilityId: row.visit.facilityId,
          teamIds: teamsByVisit.get(row.visit.id) ?? [],
        };
        return (
          can(principal, { action: 'service_evidence.read', resource }) &&
          (!relatedVisits || relatedVisits.has(row.visit.id))
        );
      });
      const packages = await this.repository.packagesForDocuments(
        transaction,
        principal.tenantId,
        allowedRows.map((row) => row.documentation.id),
      );
      const acks = await this.repository.acknowledgementsForPackages(
        transaction,
        principal.tenantId,
        packages.map((item) => item.id),
      );
      const acksByPackage = groupBy(acks, (item) => item.evidencePackageId);
      const packagesByDocument = groupBy(packages, (item) => item.documentationId);
      const items: ServiceEvidenceWorklistItem[] = [];

      for (const row of allowedRows) {
        const history = packagesByDocument.get(row.documentation.id) ?? [];
        if (history.length === 0) {
          if (query.status && query.status !== 'awaiting_acknowledgement') continue;
          if (query.signatoryType) continue;
          items.push({
            visitId: row.visit.id,
            documentationId: row.documentation.id,
            evidencePackageId: null,
            packageVersion: null,
            clientId: row.visit.clientId,
            clientName: row.clientName,
            plannedStart: row.visit.plannedStart.toISOString(),
            timezone: row.visit.timezone,
            status: 'awaiting_acknowledgement',
            snapshotHash: null,
            signatoryType: null,
            signatoryName: null,
            capacity: null,
            method: null,
            acknowledgedAt: null,
            signatureAvailable: false,
          });
          continue;
        }
        const latestVersion = history.at(-1)!.version;
        for (const evidencePackage of history) {
          const isLatest = evidencePackage.version === latestVersion;
          const isCurrent =
            evidencePackage.documentationVersion === row.documentation.version &&
            evidencePackage.executionVersion === row.execution.version &&
            evidencePackage.amendmentCount === row.amendmentCount;
          const historyAcks = acksByPackage.get(evidencePackage.id) ?? [];
          const acknowledgement = historyAcks.at(-1) ?? null;
          const status: ServiceEvidenceWorklistStatus = isCurrent
            ? acknowledgement?.revokedAt
              ? 'revoked'
              : acknowledgement?.status === 'acknowledged'
                ? 'acknowledged'
                : acknowledgement?.status === 'declined'
                  ? 'declined'
                  : 'awaiting_acknowledgement'
            : isLatest
              ? 'outdated'
              : 'superseded';
          if (query.status && query.status !== status) continue;
          if (query.signatoryType && acknowledgement?.signatoryType !== query.signatoryType) {
            continue;
          }
          items.push({
            visitId: row.visit.id,
            documentationId: row.documentation.id,
            evidencePackageId: evidencePackage.id,
            packageVersion: evidencePackage.version,
            clientId: evidencePackage.snapshot.clientId,
            clientName: evidencePackage.snapshot.clientName,
            plannedStart: evidencePackage.snapshot.plannedStart,
            timezone: evidencePackage.snapshot.timezone,
            status,
            snapshotHash: evidencePackage.snapshotHash,
            signatoryType: acknowledgement?.signatoryType ?? null,
            signatoryName: acknowledgement?.signatoryNameSnapshot ?? null,
            capacity: acknowledgement?.signatoryCapacity ?? null,
            method: acknowledgement?.method ?? null,
            acknowledgedAt:
              acknowledgement?.acknowledgedAt?.toISOString() ??
              acknowledgement?.declinedAt?.toISOString() ??
              null,
            signatureAvailable:
              acknowledgement?.signatureStorageKey !== null &&
              acknowledgement?.signatureStorageKey !== undefined,
          });
        }
      }

      items.sort((left, right) => right.plannedStart.localeCompare(left.plannedStart));
      const total = items.length;
      const offset = (query.page - 1) * query.pageSize;
      return {
        items: items.slice(offset, offset + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  private async captureTransaction(
    principal: AuthorizationPrincipal,
    evidencePackageId: string,
    input: AcknowledgeEvidenceInput | DeclineEvidenceInput,
    signatureSha256: string | null,
    signatureStorageKey: string | null,
    request: RequestContext,
    auditContext: AuditContext,
    candidateId?: string,
    decline?: { reasonCode: DeclineReasonCode; note: string | null },
    dryRun = false,
  ): Promise<CaptureResult | null> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const initialPackage = await this.repository.packageById(
        transaction,
        principal.tenantId,
        evidencePackageId,
      );
      if (!initialPackage) throw new EvidencePackageNotFoundError();
      const source = await this.lockSourceByDocument(
        transaction,
        principal.tenantId,
        initialPackage.documentationId,
      );
      await this.authorizeVisit(principal, transaction, source.context, 'acknowledgement.capture');
      const lockedPackage = await this.repository.packageById(
        transaction,
        principal.tenantId,
        evidencePackageId,
      );
      if (!lockedPackage) throw new EvidencePackageNotFoundError();

      const sameKey = await this.repository.acknowledgementByIdempotencyKey(
        transaction,
        principal.tenantId,
        input.idempotencyKey,
      );
      if (sameKey) {
        if (!sameSubmission(sameKey, lockedPackage, input, signatureSha256, decline)) {
          throw new AcknowledgementIdempotencyConflictError();
        }
        return { acknowledgement: acknowledgementView(sameKey), created: false };
      }

      this.assertReadySource(source);
      if (!verifyEvidenceSnapshot(lockedPackage.snapshot, lockedPackage.snapshotHash)) {
        throw new EvidencePackageIntegrityError();
      }
      const amendmentCount = await this.repository.amendmentCount(
        transaction,
        principal.tenantId,
        source.document.id,
      );
      if (
        lockedPackage.documentationVersion !== source.document.version ||
        lockedPackage.executionVersion !== source.execution.version ||
        lockedPackage.amendmentCount !== amendmentCount
      ) {
        throw new EvidencePackageStaleError();
      }
      if (lockedPackage.snapshotHash !== hashEvidenceSnapshot(lockedPackage.snapshot)) {
        throw new EvidencePackageIntegrityError();
      }

      const prior = await this.repository.acknowledgementForPackage(
        transaction,
        principal.tenantId,
        lockedPackage.id,
      );
      if (prior) throw new AcknowledgementAlreadyExistsError();
      const signatory = await this.resolveSignatory(
        transaction,
        principal.tenantId,
        lockedPackage.snapshot,
        input.signatory,
        new Date(),
        true,
      );
      const employee = await this.requireEmployee(transaction, principal);
      const now = new Date();
      if ('method' in input) {
        if (
          input.method === 'typed_confirmation' &&
          !isTypedConfirmationValid(signatory.name, input.confirmationName ?? '')
        ) {
          throw new AcknowledgementConfirmationNameMismatchError();
        }
        if (input.method === 'touch_signature' && !signatureSha256) {
          throw new AcknowledgementSignatureRequiredError();
        }
      }
      if (dryRun) return null;
      const declined = decline !== undefined;
      const id = candidateId ?? uuidv7();
      const method = declined
        ? 'staff_recorded_decline'
        : 'method' in input
          ? input.method
          : 'staff_recorded_decline';
      const [created] = await transaction
        .insert(acknowledgements)
        .values({
          id,
          tenantId: principal.tenantId,
          evidencePackageId: lockedPackage.id,
          evidencePackageHash: lockedPackage.snapshotHash,
          clientId: lockedPackage.snapshot.clientId,
          signatoryType: signatory.type,
          signatoryNameSnapshot: signatory.name,
          signatoryContactId: signatory.contactId,
          signatoryCapacity: signatory.capacity,
          signatoryRelationshipSnapshot: signatory.relationship,
          representationTypeSnapshot: signatory.representationType,
          status: declined ? 'declined' : 'acknowledged',
          method,
          signatureStorageKey: declined ? null : signatureStorageKey,
          signatureSha256: declined ? null : signatureSha256,
          statementVersion: ACKNOWLEDGEMENT_STATEMENT_VERSION,
          statementTextSnapshot: ACKNOWLEDGEMENT_STATEMENT_TEXT,
          declineReasonCode: decline?.reasonCode ?? null,
          declineNote: decline?.note ?? null,
          capturedByEmployeeId: employee.id,
          idempotencyKey: input.idempotencyKey,
          acknowledgedAt: declined ? null : now,
          declinedAt: declined ? now : null,
          createdAt: now,
          revokedAt: null,
          revokedByUserId: null,
          revocationReason: null,
        })
        .returning();
      if (!created) throw new AcknowledgementInvalidStateError();

      const eventType = declined ? 'service_evidence.declined' : 'service_evidence.acknowledged';
      await this.recordLifecycle(transaction, principal, request, auditContext, {
        action: declined ? 'acknowledgement.declined' : 'acknowledgement.created',
        eventType,
        eventId: uuidv7(),
        source,
        aggregateId: created.id,
        payload: {
          acknowledgementId: created.id,
          evidencePackageId: lockedPackage.id,
          documentationId: source.document.id,
          visitId: source.context.visit.id,
          clientId: source.context.clientId,
          evidencePackageHash: lockedPackage.snapshotHash,
          status: created.status,
          signatoryType: created.signatoryType,
          signatoryCapacity: created.signatoryCapacity,
          ...(created.signatureSha256 ? { signatureSha256: created.signatureSha256 } : {}),
        },
        metadata: {
          acknowledgementId: created.id,
          evidencePackageId: lockedPackage.id,
          documentationId: source.document.id,
          status: created.status,
          signatoryType: created.signatoryType,
          signatoryCapacity: created.signatoryCapacity,
          evidencePackageHash: lockedPackage.snapshotHash,
        },
      });
      return { acknowledgement: acknowledgementView(created), created: true };
    });
  }

  private async lockSource(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<LockedSource> {
    const document = await this.repository.documentForVisit(transaction, tenantId, visitId, true);
    if (!document) throw new DocumentationNotFinalizedError();
    return this.lockSourceRows(transaction, tenantId, document);
  }

  private async lockSourceByDocument(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<LockedSource> {
    const document = await this.repository.documentById(transaction, tenantId, documentId, true);
    if (!document) throw new EvidencePackageNotFoundError();
    return this.lockSourceRows(transaction, tenantId, document);
  }

  private async lockSourceRows(
    transaction: DatabaseTransaction,
    tenantId: string,
    document: NonNullable<Awaited<ReturnType<ServiceEvidenceRepository['documentById']>>>,
  ): Promise<LockedSource> {
    const visit = await this.repository.lockVisit(transaction, tenantId, document.visitId);
    if (!visit) throw new EvidencePackageNotFoundError();
    const client = await this.repository.lockClient(transaction, tenantId, visit.clientId);
    if (!client) throw new EvidencePackageNotFoundError();
    const execution = await this.repository.executionById(
      transaction,
      tenantId,
      document.executionId,
      true,
    );
    if (!execution || execution.visitId !== visit.id) throw new EvidencePackageInvalidStateError();
    return {
      context: {
        visit,
        execution,
        clientId: client.id,
        clientName: `${client.preferredName || client.firstName} ${client.lastName}`,
      },
      document,
      execution,
      client,
    };
  }

  private async readSource(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ): Promise<LockedSource> {
    const document = await this.repository.documentForVisit(transaction, tenantId, visitId);
    if (!document) throw new DocumentationNotFinalizedError();
    return this.readSourceByDocument(transaction, tenantId, document.id);
  }

  private async readSourceByDocument(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<LockedSource> {
    const document = await this.repository.documentById(transaction, tenantId, documentId);
    if (!document) throw new EvidencePackageNotFoundError();
    const context = await this.requireVisitContext(transaction, tenantId, document.visitId);
    if (!context.execution) throw new EvidencePackageInvalidStateError();
    const execution = await this.repository.executionById(
      transaction,
      tenantId,
      document.executionId,
    );
    if (!execution) throw new EvidencePackageInvalidStateError();
    return {
      context,
      document,
      execution,
      client: null,
    };
  }

  private async createSnapshotFromRows(
    transaction: DatabaseTransaction,
    tenantId: string,
    input: {
      visit: EvidenceVisitContext['visit'];
      execution: NonNullable<EvidenceVisitContext['execution']>;
      client: Awaited<ReturnType<ServiceEvidenceRepository['lockClient']>>;
      document: NonNullable<Awaited<ReturnType<ServiceEvidenceRepository['documentById']>>>;
    },
  ): Promise<EvidenceSnapshot> {
    if (!input.client) throw new EvidencePackageNotFoundError();
    const services = await this.repository.performedServices(
      transaction,
      tenantId,
      input.execution.id,
    );
    const evidence = await this.repository.evidenceForDocument(
      transaction,
      tenantId,
      input.document.id,
    );
    const amendmentCount = await this.repository.amendmentCount(
      transaction,
      tenantId,
      input.document.id,
    );
    const evidenceByService = new Map(evidence.map((item) => [item.performedServiceId, item]));
    const completeness = evaluateDocumentationCompleteness({
      hasExecution: true,
      hasDocumentation: true,
      services: services.map((service) => {
        const serviceEvidence = evidenceByService.get(service.id);
        return {
          performedServiceId: service.id,
          status: service.status,
          reasonCode: service.reasonCode,
          evidence: serviceEvidence
            ? { status: serviceEvidence.status, note: serviceEvidence.note }
            : null,
        };
      }),
    });
    if (!completeness.isComplete) throw new EvidencePackageNotReadyError();
    const items: EvidencePackageItem[] = services.map((service) => {
      const serviceEvidence = evidenceByService.get(service.id);
      if (!serviceEvidence) throw new EvidencePackageNotReadyError();
      return {
        performedServiceId: service.id,
        serviceCode: service.serviceCodeSnapshot,
        serviceName: service.serviceNameSnapshot,
        unit: service.unitSnapshot,
        plannedQuantity: normalizeQuantity(service.plannedQuantity),
        actualQuantity: normalizeQuantity(service.actualQuantity),
        outcome: service.status,
        reasonCode: service.reasonCode,
        performedByEmployeeId: service.performedByEmployeeId,
        evidenceState: serviceEvidence.status,
      };
    });
    return {
      snapshotVersion: 1,
      tenantId,
      clientId: input.client.id,
      clientName: `${input.client.preferredName || input.client.firstName} ${input.client.lastName}`,
      visitId: input.visit.id,
      plannedStart: input.visit.plannedStart.toISOString(),
      timezone: input.visit.timezone,
      executionId: input.execution.id,
      executionVersion: input.execution.version,
      actualStart: input.execution.actualStart.toISOString(),
      actualEnd: input.execution.actualEnd?.toISOString() ?? '',
      documentationId: input.document.id,
      documentationVersion: input.document.version,
      amendmentCount,
      items,
    };
  }

  private assertReadySource(source: LockedSource) {
    if (source.document.status !== 'finalized') throw new DocumentationNotFinalizedError();
    if (source.execution.status !== 'completed' || source.execution.actualEnd === null) {
      throw new EvidencePackageNotReadyError();
    }
  }

  private async packageView(
    transaction: DatabaseTransaction,
    tenantId: string,
    evidencePackage: typeof evidencePackages.$inferSelect,
    source: LockedSource,
  ): Promise<EvidencePackageView> {
    if (!verifyEvidenceSnapshot(evidencePackage.snapshot, evidencePackage.snapshotHash)) {
      throw new EvidencePackageIntegrityError();
    }
    const currentAmendmentCount = await this.repository.amendmentCount(
      transaction,
      tenantId,
      evidencePackage.documentationId,
    );
    const isCurrent =
      evidencePackage.documentationVersion === source.document.version &&
      evidencePackage.executionVersion === source.execution.version &&
      evidencePackage.amendmentCount === currentAmendmentCount &&
      source.document.status === 'finalized' &&
      source.execution.status === 'completed';
    const history = await this.repository.acknowledgementsForPackages(transaction, tenantId, [
      evidencePackage.id,
    ]);
    const views = history.map(acknowledgementView);
    const latestAck = views.at(-1) ?? null;
    const status: EvidencePackageView['status'] = !isCurrent
      ? 'outdated'
      : latestAck?.status === 'revoked'
        ? 'revoked'
        : latestAck?.status === 'acknowledged'
          ? 'acknowledged'
          : latestAck?.status === 'declined'
            ? 'declined'
            : 'ready';
    const eligibleSignatories = isCurrent
      ? await this.eligibleSignatories(
          transaction,
          tenantId,
          evidencePackage.snapshot.clientId,
          evidencePackage.snapshot.timezone,
        )
      : [];
    return {
      id: evidencePackage.id,
      documentationId: evidencePackage.documentationId,
      version: evidencePackage.version,
      generatedAt: evidencePackage.generatedAt.toISOString(),
      snapshotHash: evidencePackage.snapshotHash,
      snapshot: evidencePackage.snapshot,
      statementVersion: ACKNOWLEDGEMENT_STATEMENT_VERSION,
      statementText: ACKNOWLEDGEMENT_STATEMENT_TEXT,
      isCurrent,
      status,
      acknowledgementRequired: !isCurrent || latestAck?.status !== 'acknowledged',
      acknowledgements: views,
      eligibleSignatories,
    };
  }

  private async eligibleSignatories(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    timezone: string,
  ): Promise<EligibleSignatoryView[]> {
    const today = localDate(new Date(), timezone);
    return (await this.repository.eligibleContacts(transaction, tenantId, clientId))
      .filter((contact) =>
        isRepresentativeAuthorizedAt(
          {
            roles: contact.roles,
            representationType: contact.representationType,
            validFrom: contact.representationValidFrom,
            validUntil: contact.representationValidUntil,
          },
          today,
        ),
      )
      .map((contact) => signatoryView(contact));
  }

  private async resolveSignatory(
    transaction: DatabaseTransaction,
    tenantId: string,
    snapshot: EvidenceSnapshot,
    input: SelectedSignatory,
    acknowledgedAt: Date,
    lock: boolean,
  ): Promise<ResolvedSignatory> {
    if (input.type === 'client') {
      return {
        type: 'client',
        name: snapshot.clientName,
        contactId: null,
        capacity: 'client',
        relationship: null,
        representationType: null,
      };
    }
    const contact = await this.repository.contactForClient(
      transaction,
      tenantId,
      snapshot.clientId,
      input.contactId,
      lock,
    );
    const validOn = localDate(acknowledgedAt, snapshot.timezone);
    if (
      !contact ||
      !isRepresentativeAuthorizedAt(
        {
          roles: contact.roles,
          representationType: contact.representationType,
          validFrom: contact.representationValidFrom,
          validUntil: contact.representationValidUntil,
        },
        validOn,
      )
    ) {
      throw new AcknowledgementSignatoryInvalidError();
    }
    const normalized = signatoryView(contact);
    if (normalized.signatoryType !== input.type) throw new AcknowledgementSignatoryInvalidError();
    return {
      type: normalized.signatoryType,
      name: normalized.displayName,
      contactId: contact.id,
      capacity: normalized.capacity,
      relationship: contact.relationshipType,
      representationType: contact.representationType,
    };
  }

  private async authorizeVisit(
    principal: AuthorizationPrincipal,
    transaction: DatabaseTransaction,
    context: EvidenceVisitContext,
    permission: Permission,
  ) {
    const resource = await this.resourceForVisit(transaction, context);
    assertCan(principal, { action: permission, resource });
    if (principal.roles?.includes('Caregiver')) {
      const employee = await this.requireEmployee(transaction, principal);
      if (
        !(await this.repository.hasCaregiverRelationship(
          transaction,
          principal.tenantId,
          context.visit.id,
          employee.id,
        ))
      ) {
        throw new ServiceEvidenceVisitRelationshipRequiredError();
      }
    }
  }

  private async resourceForVisit(
    transaction: DatabaseTransaction,
    context: EvidenceVisitContext,
  ): Promise<ResourceContext> {
    return {
      tenantId: context.visit.tenantId,
      clientId: context.clientId,
      organizationId: context.visit.organizationId,
      facilityId: context.visit.facilityId,
      teamIds: await this.repository.teamIdsForVisit(
        transaction,
        context.visit.tenantId,
        context.visit.id,
      ),
    };
  }

  private async requireEmployee(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
  ) {
    const employee = await this.repository.employeeForUser(
      transaction,
      principal.tenantId,
      principal.userId,
    );
    if (!employee) throw new ServiceEvidenceEmployeeLinkRequiredError();
    return employee;
  }

  private async requireVisitContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitId: string,
  ) {
    const context = await this.repository.visitContext(transaction, tenantId, visitId);
    if (!context) throw new EvidencePackageNotFoundError();
    return context;
  }

  private async recordLifecycle(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: {
      action: string;
      eventType: EventName;
      eventId: string;
      source: LockedSource;
      aggregateId: string;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
  ) {
    const event = createDomainEvent({
      type: input.eventType,
      tenantId: principal.tenantId,
      aggregateType: 'service_evidence',
      aggregateId: input.aggregateId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload: input.payload,
      id: input.eventId,
    } as never) as DomainEvent;
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'client',
      resourceId: input.source.context.clientId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: {
        clientId: input.source.context.clientId,
        visitId: input.source.context.visit.id,
        ...input.metadata,
      },
    });
    await this.outbox.enqueue(transaction, event);
  }

  private async deleteSignatureArtifact(key: string) {
    try {
      await this.storage.delete(key);
    } catch {
      throw new AcknowledgementSignatureCleanupError();
    }
  }
}

interface ResolvedSignatory {
  type: EvidenceSignatoryType;
  name: string;
  contactId: string | null;
  capacity: SignatoryCapacity;
  relationship: string | null;
  representationType: ClientRepresentationType | null;
}

function acknowledgementView(
  row: typeof acknowledgements.$inferSelect,
): EvidenceAcknowledgementView {
  return {
    id: row.id,
    status: row.revokedAt ? 'revoked' : row.status,
    signatoryType: row.signatoryType,
    signatoryName: row.signatoryNameSnapshot,
    signatoryContactId: row.signatoryContactId,
    capacity: row.signatoryCapacity,
    relationship: row.signatoryRelationshipSnapshot,
    representationType: row.representationTypeSnapshot,
    method: row.method,
    statementVersion: row.statementVersion,
    statementText: row.statementTextSnapshot,
    evidencePackageHash: row.evidencePackageHash,
    signatureSha256: row.signatureSha256,
    signatureAvailable: row.signatureStorageKey !== null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineReasonCode: row.declineReasonCode,
    declineNote: row.declineNote,
    capturedByEmployeeId: row.capturedByEmployeeId,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedByUserId: row.revokedByUserId,
    revocationReason: row.revocationReason,
  };
}

function signatoryView(contact: EligibleContactRow): EligibleSignatoryView {
  if (!contact.representationType) throw new AcknowledgementSignatoryInvalidError();
  const relation = contact.relationshipType as ClientRelationshipType;
  const legalGuardian = contact.representationType === 'legal_guardianship';
  const relative = ['daughter', 'son', 'spouse', 'relative'].includes(relation);
  const representative = relative || relation === 'guardian' || relation === 'legal_representative';
  return {
    contactId: contact.id,
    displayName: `${contact.firstName} ${contact.lastName}`,
    signatoryType: representative ? 'representative' : 'other_authorized_person',
    capacity: legalGuardian
      ? 'legal_guardian'
      : relative
        ? 'relative'
        : contact.representationType === 'power_of_attorney' ||
            contact.representationType === 'authorized_representative'
          ? 'authorized_representative'
          : 'other',
    relationship: contact.relationshipType,
    representationType: contact.representationType,
  };
}

function sameSubmission(
  existing: typeof acknowledgements.$inferSelect,
  evidencePackage: typeof evidencePackages.$inferSelect,
  input: AcknowledgeEvidenceInput | DeclineEvidenceInput,
  signatureSha256: string | null,
  decline?: { reasonCode: DeclineReasonCode; note: string | null },
): boolean {
  if (
    existing.evidencePackageId !== evidencePackage.id ||
    existing.evidencePackageHash !== evidencePackage.snapshotHash
  ) {
    return false;
  }
  const selectedType = input.signatory.type;
  const contactId = selectedType === 'client' ? null : input.signatory.contactId;
  if (existing.signatoryType !== selectedType || existing.signatoryContactId !== contactId) {
    return false;
  }
  if (decline) {
    return (
      existing.status === 'declined' &&
      existing.method === 'staff_recorded_decline' &&
      existing.declineReasonCode === decline.reasonCode &&
      existing.declineNote === decline.note
    );
  }
  if (!('method' in input)) return false;
  if (existing.status !== 'acknowledged' || existing.method !== input.method) return false;
  if (input.method === 'touch_signature') return existing.signatureSha256 === signatureSha256;
  return isTypedConfirmationValid(existing.signatoryNameSnapshot, input.confirmationName ?? '');
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const value = key(item);
    const current = grouped.get(value) ?? [];
    current.push(item);
    grouped.set(value, current);
  }
  return grouped;
}

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new AcknowledgementInvalidInputError();
  return `${year}-${month}-${day}`;
}

function validateIdempotencyKey(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AcknowledgementInvalidInputError();
  }
}

function validateWorklistQuery(query: ServiceEvidenceWorklistQuery) {
  const range = query.until.getTime() - query.from.getTime();
  if (
    Number.isNaN(range) ||
    range <= 0 ||
    range > 366 * 24 * 60 * 60 * 1000 ||
    !Number.isInteger(query.page) ||
    query.page < 1 ||
    !Number.isInteger(query.pageSize) ||
    query.pageSize < 1 ||
    query.pageSize > 100
  ) {
    throw new InvalidServiceEvidenceWorklistQueryError();
  }
}

export function createServiceEvidenceApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  storage: ObjectStorage,
) {
  return new ServiceEvidenceApplicationService(unitOfWork, audit, outbox, storage);
}

export class DocumentationNotFinalizedError extends Error {
  readonly code = 'DOCUMENTATION_NOT_FINALIZED';
  constructor() {
    super('Care documentation is not finalized');
  }
}

export class EvidencePackageNotFoundError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_NOT_FOUND';
  constructor() {
    super('Evidence package was not found');
  }
}

export class EvidencePackageNotReadyError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_NOT_READY';
  constructor() {
    super('Finalized service evidence is incomplete');
  }
}

export class EvidencePackageStaleError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_STALE';
  constructor() {
    super('Evidence package no longer matches finalized source data');
  }
}

export class EvidencePackageIntegrityError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_INTEGRITY_FAILED';
  constructor() {
    super('Evidence package integrity check failed');
  }
}

export class EvidencePackageInvalidStateError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_INVALID_STATE';
  constructor() {
    super('Evidence package source state is invalid');
  }
}

export class AcknowledgementNotFoundError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_NOT_FOUND';
  constructor() {
    super('Acknowledgement was not found');
  }
}

export class AcknowledgementAlreadyExistsError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_ALREADY_EXISTS';
  constructor() {
    super('Evidence package already has an active outcome');
  }
}

export class AcknowledgementInvalidStateError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_INVALID_STATE';
  constructor() {
    super('Acknowledgement cannot transition from its current state');
  }
}

export class AcknowledgementSignatoryInvalidError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_SIGNATORY_INVALID';
  constructor() {
    super('Signatory is not eligible for this client');
  }
}

export class AcknowledgementSignatureRequiredError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_SIGNATURE_REQUIRED';
  constructor() {
    super('A touch signature is required');
  }
}

export class AcknowledgementConfirmationRequiredError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_CONFIRMATION_REQUIRED';
  constructor() {
    super('Typed confirmation is required');
  }
}

export class AcknowledgementConfirmationNameMismatchError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_CONFIRMATION_NAME_MISMATCH';
  constructor() {
    super('Typed confirmation must match the selected signatory name');
  }
}

export class AcknowledgementInvalidInputError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_INVALID_INPUT';
  constructor() {
    super('Acknowledgement input is invalid');
  }
}

export class AcknowledgementIdempotencyConflictError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_IDEMPOTENCY_CONFLICT';
  constructor() {
    super('Idempotency key was already used with another submission');
  }
}

export class AcknowledgementRevocationReasonRequiredError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_REVOCATION_REASON_REQUIRED';
  constructor() {
    super('Revocation needs a reason');
  }
}

export class AcknowledgementSignatureNotFoundError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_SIGNATURE_NOT_FOUND';
  constructor() {
    super('Acknowledgement has no touch signature');
  }
}

export class AcknowledgementSignatureIntegrityError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_SIGNATURE_INTEGRITY_FAILED';
  constructor() {
    super('Stored touch signature integrity check failed');
  }
}

export class AcknowledgementSignatureCleanupError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_SIGNATURE_CLEANUP_FAILED';
  constructor() {
    super('Failed to remove an unused private signature artifact');
  }
}

export class InvalidServiceEvidenceWorklistQueryError extends Error {
  readonly code = 'SERVICE_EVIDENCE_INVALID_QUERY';
  constructor() {
    super('Service evidence worklist filters are invalid');
  }
}

export class ServiceEvidenceEmployeeLinkRequiredError extends Error {
  readonly code = 'SERVICE_EVIDENCE_EMPLOYEE_LINK_REQUIRED';
  constructor() {
    super('Service evidence capture requires an active employee link');
  }
}

export class ServiceEvidenceVisitRelationshipRequiredError extends Error {
  readonly code = 'SERVICE_EVIDENCE_VISIT_RELATIONSHIP_REQUIRED';
  constructor() {
    super('Caregiver must be assigned to or participate in this visit');
  }
}
