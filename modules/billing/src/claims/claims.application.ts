import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { DocumentsApplicationService, DocumentPayload } from '@care/documents';
import type { ObjectStorage } from '@care/storage';
import { createDomainEvent } from '@care/events';
import type { EventName, EventPayloadMap } from '@care/events';
import { clientInsurances, clientRecords } from '@care/clients';
import { organizationsTable } from '@care/organizations';
import { assertCan } from '@care/permissions';
import type { AuthorizationPrincipal, Permission, ResourceContext } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { ServiceEvidenceApplicationService } from '@care/service-evidence';
import { acknowledgements, evidencePackages } from '@care/service-evidence';
import {
  benefitFundingSources,
  providerRecognitions,
  serviceAllocations,
  serviceAllocationReversals,
} from '@care/benefits';
import {
  invoiceCorrections,
  invoiceDocuments,
  invoiceLines,
  invoices,
  payerArrangements,
  paymentAllocations,
  payments,
  paymentReversals,
} from '@module/billing/schema';
import {
  claimDecisionLines,
  claimDecisions,
  claimLines,
  claimPackageDocuments,
  claimSubmissions,
  claims,
} from './schema';
import { payerBillingProfiles, payers } from './payer-schema';
import {
  assertClaimDecision,
  ClaimAmountReservedError,
  ClaimDecisionInvalidError,
  ClaimInvalidStateError,
  ClaimNotReadyError,
  ClaimNotFoundError,
  ClaimSourceInvalidError,
  ClaimVersionConflictError,
  PayerInputInvalidError,
  PayerNotFoundError,
  PayerProfileVersionConflictError,
  validatePayerInput,
  validatePayerProfileInput,
} from './domain';
import type {
  ClaimDecisionInput,
  ClaimReadiness,
  ClaimReadinessFinding,
  ClaimPackageDocumentView,
  ClaimSubmitInput,
  CreateClaimInput,
  PayerBillingProfileInput,
  PayerInput,
} from './domain';

type AuditContext = { ip?: string; userAgent?: string };
type ClaimScope = {
  organizationId?: string;
  clientId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

const MAX_CLAIM_LINES = 100;

type ClaimEventName = Extract<EventName, `claim.${string}`>;
type ClaimAggregateType = 'claim' | 'payer' | 'payer_profile';
type ClaimEventPayload<T extends ClaimEventName> = EventPayloadMap[T];

interface ClaimReadinessLineFact {
  claimLine: typeof claimLines.$inferSelect;
  invoiceLine: typeof invoiceLines.$inferSelect | null;
  allocation: typeof serviceAllocations.$inferSelect | null;
  fundingSource: typeof benefitFundingSources.$inferSelect | null;
  evidencePackage: typeof evidencePackages.$inferSelect | null;
  acknowledgement: typeof acknowledgements.$inferSelect | null;
  acknowledged: boolean;
  allocationReversed: boolean;
  reservedCents: number;
}

interface ClaimReadinessFacts {
  claim: typeof claims.$inferSelect;
  invoice: typeof invoices.$inferSelect | null;
  arrangement: typeof payerArrangements.$inferSelect | null;
  payer: typeof payers.$inferSelect | null;
  profile: typeof payerBillingProfiles.$inferSelect | null;
  insurance: typeof clientInsurances.$inferSelect | null;
  invoiceDocument: typeof invoiceDocuments.$inferSelect | null;
  correctionCount: number;
  lines: ClaimReadinessLineFact[];
  providerRecognitionValid: boolean;
}

export class BillingClaimsApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly evidence: ServiceEvidenceApplicationService,
    private readonly documents: DocumentsApplicationService,
    private readonly storage: ObjectStorage,
  ) {}

  async listPayers(principal: AuthorizationPrincipal, organizationId: string) {
    this.requireScoped(principal, 'claims.read', { tenantId: principal.tenantId, organizationId });
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select()
        .from(payers)
        .where(
          and(eq(payers.tenantId, principal.tenantId), eq(payers.organizationId, organizationId)),
        )
        .orderBy(asc(payers.name), asc(payers.id));
      return rows;
    });
  }

  async getPayer(principal: AuthorizationPrincipal, payerId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) =>
      this.payerInScope(transaction, principal, payerId, 'claims.read'),
    );
  }

  async createPayer(
    principal: AuthorizationPrincipal,
    input: PayerInput,
    request: RequestContext,
    context: AuditContext,
  ) {
    this.requireScoped(principal, 'claims.settings.manage', {
      tenantId: principal.tenantId,
      organizationId: input.organizationId,
    });
    validatePayerInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [organization] = await transaction
        .select({ id: organizationsTable.id })
        .from(organizationsTable)
        .where(
          and(
            eq(organizationsTable.tenantId, principal.tenantId),
            eq(organizationsTable.id, input.organizationId),
          ),
        )
        .limit(1);
      if (!organization) throw new PayerInputInvalidError();
      const id = uuidv7();
      const now = new Date();
      const [payer] = await transaction
        .insert(payers)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          payerType: input.payerType,
          name: input.name.trim(),
          payerIdentifier: optionalText(input.payerIdentifier),
          addressText: optionalText(input.addressText),
          billingContactName: optionalText(input.billingContactName),
          billingContactEmail: optionalText(input.billingContactEmail),
          billingContactPhone: optionalText(input.billingContactPhone),
          submissionInstructions: optionalText(input.submissionInstructions),
          status: input.status,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          version: 1,
          createdBy: principal.userId,
          updatedBy: principal.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!payer) throw new PayerNotFoundError();
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.payer_created',
        action: 'claim.payer_created',
        aggregateType: 'payer',
        aggregateId: id,
        resourceType: 'payer',
        metadata: { organizationId: input.organizationId, payerType: payer!.payerType },
        payload: { payerId: id, organizationId: input.organizationId, payerType: payer!.payerType },
      });
      return payer;
    });
  }

  async updatePayer(
    principal: AuthorizationPrincipal,
    payerId: string,
    input: PayerInput & { expectedVersion: number },
    request: RequestContext,
    context: AuditContext,
  ) {
    this.requireScoped(principal, 'claims.settings.manage', {
      tenantId: principal.tenantId,
      organizationId: input.organizationId,
    });
    validatePayerInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(payers)
        .where(and(eq(payers.tenantId, principal.tenantId), eq(payers.id, payerId)))
        .for('update')
        .limit(1);
      if (!current) throw new PayerNotFoundError();
      this.requireScoped(principal, 'claims.settings.manage', {
        tenantId: principal.tenantId,
        organizationId: current.organizationId,
      });
      if (
        current.version !== input.expectedVersion ||
        current.organizationId !== input.organizationId
      ) {
        throw new PayerProfileVersionConflictError();
      }
      const now = new Date();
      const [updated] = await transaction
        .update(payers)
        .set({
          payerType: input.payerType,
          name: input.name.trim(),
          payerIdentifier: optionalText(input.payerIdentifier),
          addressText: optionalText(input.addressText),
          billingContactName: optionalText(input.billingContactName),
          billingContactEmail: optionalText(input.billingContactEmail),
          billingContactPhone: optionalText(input.billingContactPhone),
          submissionInstructions: optionalText(input.submissionInstructions),
          status: input.status,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          version: current.version + 1,
          updatedBy: principal.userId,
          updatedAt: now,
        })
        .where(and(eq(payers.tenantId, principal.tenantId), eq(payers.id, payerId)))
        .returning();
      if (!updated) throw new PayerNotFoundError();
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.payer_updated',
        action: 'claim.payer_updated',
        aggregateType: 'payer',
        aggregateId: payerId,
        resourceType: 'payer',
        metadata: { organizationId: current.organizationId, version: updated!.version },
        payload: { payerId, organizationId: current.organizationId, version: updated!.version },
      });
      return updated;
    });
  }

  async payerProfiles(principal: AuthorizationPrincipal, payerId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.payerInScope(transaction, principal, payerId, 'claims.read');
      return transaction
        .select()
        .from(payerBillingProfiles)
        .where(
          and(
            eq(payerBillingProfiles.tenantId, principal.tenantId),
            eq(payerBillingProfiles.payerId, payerId),
          ),
        )
        .orderBy(
          asc(payerBillingProfiles.channel),
          asc(payerBillingProfiles.fundingSourceType),
          desc(payerBillingProfiles.version),
        );
    });
  }

  async savePayerProfile(
    principal: AuthorizationPrincipal,
    input: PayerBillingProfileInput,
    request: RequestContext,
    context: AuditContext,
  ) {
    this.requireScoped(principal, 'claims.settings.manage', {
      tenantId: principal.tenantId,
      organizationId: input.organizationId,
    });
    validatePayerProfileInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [payer] = await transaction
        .select()
        .from(payers)
        .where(
          and(
            eq(payers.tenantId, principal.tenantId),
            eq(payers.organizationId, input.organizationId),
            eq(payers.id, input.payerId),
          ),
        )
        .for('update')
        .limit(1);
      if (!payer) throw new PayerNotFoundError();
      if (payer.status !== 'active') throw new PayerInputInvalidError();
      const existing = await transaction
        .select()
        .from(payerBillingProfiles)
        .where(
          and(
            eq(payerBillingProfiles.tenantId, principal.tenantId),
            eq(payerBillingProfiles.payerId, payer.id),
            eq(payerBillingProfiles.channel, input.channel),
            eq(payerBillingProfiles.fundingSourceType, input.fundingSourceType),
          ),
        )
        .orderBy(desc(payerBillingProfiles.version))
        .limit(1);
      const current = existing[0] ?? null;
      if ((current?.version ?? 0) !== input.expectedVersion) {
        throw new PayerProfileVersionConflictError();
      }
      const now = new Date();
      const [profile] = await transaction
        .insert(payerBillingProfiles)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          organizationId: payer.organizationId,
          payerId: payer.id,
          version: (current?.version ?? 0) + 1,
          channel: input.channel,
          fundingSourceType: input.fundingSourceType,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          sourceName: input.sourceName.trim(),
          sourceVersion: input.sourceVersion.trim(),
          sourceEffectiveDate: input.sourceEffectiveDate,
          sourceUrl: optionalText(input.sourceUrl),
          requiresClientInsuranceNumber: input.requiresClientInsuranceNumber,
          requiresPayerIdentifier: input.requiresPayerIdentifier,
          requiresAcknowledgement: input.requiresAcknowledgement,
          requiresMandate: input.requiresMandate,
          requiresInvoicePdf: input.requiresInvoicePdf,
          requiresEvidencePdf: input.requiresEvidencePdf,
          requiresMandateDocument: input.requiresMandateDocument,
          requiresExternalReference: input.requiresExternalReference,
          requiresProviderRecognition: input.requiresProviderRecognition,
          createdBy: principal.userId,
          createdAt: now,
        })
        .returning();
      if (!profile) throw new PayerInputInvalidError();
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.payer_profile_versioned',
        action: 'claim.payer_profile_versioned',
        aggregateType: 'payer_profile',
        aggregateId: profile.id,
        resourceType: 'payer_profile',
        metadata: {
          payerId: payer.id,
          channel: input.channel,
          fundingSourceType: input.fundingSourceType,
          version: profile.version,
          sourceName: profile.sourceName,
          sourceVersion: profile.sourceVersion,
        },
        payload: {
          payerId: payer.id,
          profileId: profile.id,
          version: profile.version,
          channel: profile.channel,
          fundingSourceType: profile.fundingSourceType,
        },
      });
      return profile;
    });
  }

  async listClaims(principal: AuthorizationPrincipal, filters: ClaimScope = {}) {
    const page = boundedInteger(filters.page, 1, 1, 100_000);
    const pageSize = boundedInteger(filters.pageSize, 25, 1, 100);
    const scope = this.listScope(principal, 'claims.read');
    const rows = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const conditions = [eq(claims.tenantId, principal.tenantId), scope];
        if (filters.organizationId)
          conditions.push(eq(claims.organizationId, filters.organizationId));
        if (filters.clientId) conditions.push(eq(claims.clientId, filters.clientId));
        if (filters.status)
          conditions.push(
            eq(claims.status, filters.status as (typeof claims.$inferSelect)['status']),
          );
        return transaction
          .select()
          .from(claims)
          .where(and(...conditions))
          .orderBy(desc(claims.createdAt), desc(claims.id))
          .limit(pageSize + 1)
          .offset((page - 1) * pageSize);
      },
    );
    const pageRows = rows.slice(0, pageSize);
    const claimIds = pageRows.map((claim) => claim.id);
    const summaries = claimIds.length
      ? await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
          const submissions = await transaction
            .select({
              claimId: claimSubmissions.claimId,
              submittedAt: claimSubmissions.submittedAt,
            })
            .from(claimSubmissions)
            .where(
              and(
                eq(claimSubmissions.tenantId, principal.tenantId),
                inArray(claimSubmissions.claimId, claimIds),
              ),
            )
            .orderBy(desc(claimSubmissions.submittedAt), desc(claimSubmissions.id));
          const decisions = await transaction
            .select({
              claimId: claimDecisions.claimId,
              acceptedCents: claimDecisions.acceptedCents,
            })
            .from(claimDecisions)
            .where(
              and(
                eq(claimDecisions.tenantId, principal.tenantId),
                inArray(claimDecisions.claimId, claimIds),
              ),
            )
            .orderBy(desc(claimDecisions.createdAt), desc(claimDecisions.id));
          const allocations = await transaction
            .select({
              claimId: paymentAllocations.claimId,
              amountCents: paymentAllocations.amountCents,
              reversalId: paymentReversals.id,
            })
            .from(paymentAllocations)
            .leftJoin(
              paymentReversals,
              and(
                eq(paymentReversals.tenantId, paymentAllocations.tenantId),
                eq(paymentReversals.allocationId, paymentAllocations.id),
              ),
            )
            .where(
              and(
                eq(paymentAllocations.tenantId, principal.tenantId),
                inArray(paymentAllocations.claimId, claimIds),
              ),
            );
          const clients = await transaction
            .select({
              id: clientRecords.id,
              firstName: clientRecords.firstName,
              lastName: clientRecords.lastName,
            })
            .from(clientRecords)
            .where(
              and(
                eq(clientRecords.tenantId, principal.tenantId),
                inArray(clientRecords.id, [...new Set(pageRows.map((claim) => claim.clientId))]),
              ),
            );
          const submittedAtByClaim = new Map<string, Date>();
          for (const row of submissions) {
            if (!submittedAtByClaim.has(row.claimId)) {
              submittedAtByClaim.set(row.claimId, row.submittedAt);
            }
          }
          const acceptedByClaim = new Map<string, number>();
          for (const row of decisions) {
            if (!acceptedByClaim.has(row.claimId)) {
              acceptedByClaim.set(row.claimId, row.acceptedCents);
            }
          }
          const paidByClaim = new Map<string, number>();
          const clientNameById = new Map<string, string>();
          for (const client of clients) {
            clientNameById.set(client.id, client.firstName + ' ' + client.lastName);
          }
          for (const row of allocations) {
            if (row.claimId && !row.reversalId) {
              paidByClaim.set(row.claimId, (paidByClaim.get(row.claimId) ?? 0) + row.amountCents);
            }
          }
          return { submittedAtByClaim, acceptedByClaim, paidByClaim, clientNameById };
        })
      : {
          submittedAtByClaim: new Map<string, Date>(),
          acceptedByClaim: new Map<string, number>(),
          paidByClaim: new Map<string, number>(),
          clientNameById: new Map<string, string>(),
        };
    return {
      items: pageRows.map((claim) => ({
        id: claim.id,
        organizationId: claim.organizationId,
        facilityId: claim.facilityId,
        clientId: claim.clientId,
        clientName: summaries.clientNameById.get(claim.clientId) ?? '',
        invoiceId: claim.invoiceId,
        invoiceNumber: snapshotText(claim.invoiceSnapshot, 'invoiceNumber'),
        payerId: claim.payerId,
        payerName: snapshotText(claim.payerSnapshot, 'name'),
        amountCents: claim.amountCents,
        acceptedCents: summaries.acceptedByClaim.get(claim.id) ?? null,
        paidCents: summaries.paidByClaim.get(claim.id) ?? 0,
        submittedAt: summaries.submittedAtByClaim.get(claim.id)?.toISOString() ?? null,
        channel: claim.channel,
        status: claim.status,
        version: claim.version,
        createdAt: claim.createdAt.toISOString(),
      })),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }

  async createClaim(
    principal: AuthorizationPrincipal,
    input: CreateClaimInput,
    request: RequestContext,
    context: AuditContext,
  ) {
    validateCreateInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const inserted = await this.insertClaim(transaction, principal, input, null, null);
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.created',
        action: 'claim.created',
        aggregateType: 'claim',
        aggregateId: inserted.id,
        resourceType: 'claim',
        metadata: {
          invoiceId: inserted.invoiceId,
          payerId: inserted.payerId,
          amountCents: inserted.amountCents,
          lineCount: input.lines.length,
        },
        payload: {
          claimId: inserted.id,
          invoiceId: inserted.invoiceId,
          payerId: inserted.payerId,
          organizationId: inserted.organizationId,
        },
      });
      return this.getClaimInTransaction(transaction, principal, inserted.id);
    });
  }

  async getClaim(principal: AuthorizationPrincipal, claimId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) =>
      this.getClaimInTransaction(transaction, principal, claimId),
    );
  }

  async readiness(principal: AuthorizationPrincipal, claimId: string): Promise<ClaimReadiness> {
    const data = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => this.claimReadinessFacts(transaction, principal, claimId),
    );
    return this.evaluateReadiness(principal, data);
  }

  async prepare(
    principal: AuthorizationPrincipal,
    claimId: string,
    expectedVersion: number,
    request: RequestContext,
    context: AuditContext,
  ) {
    const facts = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const loaded = await this.claimReadinessFacts(
          transaction,
          principal,
          claimId,
          'claims.manage',
        );
        if (loaded.claim.version !== expectedVersion) throw new ClaimVersionConflictError();
        if (loaded.claim.status === 'ready') {
          return { ...loaded, alreadyPrepared: true };
        }
        if (loaded.claim.status !== 'draft') throw new ClaimInvalidStateError();
        return { ...loaded, alreadyPrepared: false };
      },
    );
    if (facts.alreadyPrepared) return this.getClaim(principal, claimId);
    const readiness = await this.evaluateReadiness(principal, facts);
    if (!readiness.ready) throw new ClaimNotReadyError(readiness.blockers);
    if (!facts.invoice || !facts.invoiceDocument || !facts.payer || !facts.arrangement) {
      throw new ClaimSourceInvalidError();
    }

    const packageVersion = facts.claim.packageVersion + 1;
    const packageDocuments: Array<{
      id: string;
      documentKind: 'invoice_pdf' | 'evidence_pdf' | 'mandate_pdf' | 'claim_summary';
      fileName: string;
      sha256: string;
      sourceVersion: string;
      documentArtifactId: string | null;
      invoiceDocumentId: string | null;
    }> = [];
    packageDocuments.push({
      id: uuidv7(),
      documentKind: 'invoice_pdf',
      fileName: `invoice-${facts.invoice.invoiceNumber ?? facts.invoice.id}.pdf`,
      sha256: facts.invoiceDocument.sha256!,
      sourceVersion: `invoice-document:${facts.invoiceDocument.documentVersion}`,
      documentArtifactId: null,
      invoiceDocumentId: facts.invoiceDocument.id,
    });

    const evidenceByPackage = new Map<string, ClaimReadinessLineFact[]>();
    for (const line of facts.lines) {
      const matches = evidenceByPackage.get(line.claimLine.evidencePackageId) ?? [];
      matches.push(line);
      evidenceByPackage.set(line.claimLine.evidencePackageId, matches);
    }
    for (const [evidencePackageId, lines] of evidenceByPackage) {
      const evidencePackage = lines[0]?.evidencePackage;
      if (!evidencePackage) throw new ClaimSourceInvalidError();
      await this.evidence.getPackage(principal, evidencePackageId);
      const payload = evidenceDocumentPayload(facts, lines);
      const artifact = await this.documents.generate(
        principal,
        {
          idempotencyKey: stableUuid(
            `${principal.tenantId}:${claimId}:${packageVersion}:evidence:${evidencePackageId}`,
          ),
          organizationId: facts.claim.organizationId,
          facilityId: facts.claim.facilityId,
          clientId: facts.claim.clientId,
          documentType: 'service_evidence',
          sourceEntityType: 'claim_evidence',
          sourceEntityId: evidencePackageId,
          sourceVersion: `${evidencePackage.version}:${evidencePackage.snapshotHash}`,
          locale: 'de',
          payload,
        },
        request,
        context,
      );
      if (!artifact.sha256 || artifact.status !== 'ready') throw new ClaimSourceInvalidError();
      packageDocuments.push({
        id: uuidv7(),
        documentKind: 'evidence_pdf',
        fileName: `leistungsnachweis-${evidencePackageId}.pdf`,
        sha256: artifact.sha256,
        sourceVersion: `${evidencePackage.version}:${evidencePackage.snapshotHash}`,
        documentArtifactId: artifact.id,
        invoiceDocumentId: null,
      });
    }

    if (facts.profile?.requiresMandateDocument) {
      const artifactId = facts.arrangement.mandateDocumentArtifactId;
      if (!artifactId) throw new ClaimNotReadyError(readiness.blockers);
      const artifact = await this.documents.artifactForSourceAuthorization(principal, artifactId);
      if (!artifact.sha256 || (artifact.status !== 'ready' && artifact.status !== 'superseded')) {
        throw new ClaimSourceInvalidError();
      }
      packageDocuments.push({
        id: uuidv7(),
        documentKind: 'mandate_pdf',
        fileName: `mandat-${artifact.id}.pdf`,
        sha256: artifact.sha256,
        sourceVersion: `${artifact.sourceEntityType}:${artifact.sourceEntityId}@${artifact.sourceVersion}`,
        documentArtifactId: artifact.id,
        invoiceDocumentId: null,
      });
    }

    const manifestRows = packageDocuments.map((document) => ({
      kind: document.documentKind,
      fileName: document.fileName,
      sha256: document.sha256,
      sourceVersion: document.sourceVersion,
    }));
    const summary = await this.documents.generate(
      principal,
      {
        idempotencyKey: stableUuid(`${principal.tenantId}:${claimId}:${packageVersion}:summary`),
        organizationId: facts.claim.organizationId,
        facilityId: facts.claim.facilityId,
        clientId: facts.claim.clientId,
        documentType: 'claim_summary',
        sourceEntityType: 'claim',
        sourceEntityId: claimId,
        sourceVersion: `${packageVersion}:${facts.claim.snapshotHash}`,
        locale: 'de',
        payload: claimSummaryPayload(facts, packageVersion, manifestRows),
      },
      request,
      context,
    );
    if (!summary.sha256 || summary.status !== 'ready') throw new ClaimSourceInvalidError();
    packageDocuments.push({
      id: uuidv7(),
      documentKind: 'claim_summary',
      fileName: `claim-summary-${claimId}-v${packageVersion}.pdf`,
      sha256: summary.sha256,
      sourceVersion: `${packageVersion}:${facts.claim.snapshotHash}`,
      documentArtifactId: summary.id,
      invoiceDocumentId: null,
    });
    const packageHash = hashCanonical(
      packageDocuments.map((document) => ({
        kind: document.documentKind,
        fileName: document.fileName,
        sha256: document.sha256,
        sourceVersion: document.sourceVersion,
      })),
    );

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(claims)
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .for('update')
        .limit(1);
      if (!current) throw new ClaimNotFoundError();
      this.requireScoped(principal, 'claims.manage', this.resourceForClaim(current));
      if (current.version !== expectedVersion) throw new ClaimVersionConflictError();
      if (current.status !== 'draft') throw new ClaimInvalidStateError();
      const now = new Date();
      const [updated] = await transaction
        .update(claims)
        .set({
          status: 'ready',
          packageVersion,
          packageHash,
          preparedAt: now,
          version: current.version + 1,
          updatedBy: principal.userId,
          updatedAt: now,
        })
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .returning();
      await transaction.insert(claimPackageDocuments).values(
        packageDocuments.map((document) => ({
          id: document.id,
          tenantId: principal.tenantId,
          claimId,
          packageVersion,
          documentKind: document.documentKind,
          invoiceId: current.invoiceId,
          invoiceDocumentId: document.invoiceDocumentId,
          documentArtifactId: document.documentArtifactId,
          fileName: document.fileName,
          sha256: document.sha256,
          sourceVersion: document.sourceVersion,
          createdAt: now,
        })),
      );
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.prepared',
        action: 'claim.prepared',
        aggregateType: 'claim',
        aggregateId: claimId,
        resourceType: 'claim',
        metadata: { packageVersion, documentCount: packageDocuments.length, packageHash },
        payload: {
          claimId,
          packageVersion,
          documentCount: packageDocuments.length,
          packageHash,
        },
      });
      return this.getClaimInTransaction(transaction, principal, updated!.id, 'claims.manage');
    });
  }

  async submit(
    principal: AuthorizationPrincipal,
    claimId: string,
    input: ClaimSubmitInput,
    request: RequestContext,
    context: AuditContext,
  ) {
    validateSubmitInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [claim] = await transaction
        .select()
        .from(claims)
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .for('update')
        .limit(1);
      if (!claim) throw new ClaimNotFoundError();
      this.requireScoped(principal, 'claims.submit', this.resourceForClaim(claim));
      if (claim.version !== input.expectedVersion) throw new ClaimVersionConflictError();
      if (claim.status !== 'ready' || !claim.packageHash || !claim.channel) {
        throw new ClaimInvalidStateError();
      }
      const readiness = await this.evaluateReadiness(
        principal,
        await this.claimReadinessFacts(transaction, principal, claimId, 'claims.submit'),
      );
      if (!readiness.ready) throw new ClaimNotReadyError(readiness.blockers);
      const [latestSubmission] = await transaction
        .select({ submissionNumber: claimSubmissions.submissionNumber })
        .from(claimSubmissions)
        .where(
          and(
            eq(claimSubmissions.tenantId, principal.tenantId),
            eq(claimSubmissions.claimId, claimId),
          ),
        )
        .orderBy(desc(claimSubmissions.submissionNumber))
        .limit(1);
      const id = uuidv7();
      const now = new Date();
      const recipientSnapshot = snapshotRecord(claim.payerSnapshot);
      await transaction.insert(claimSubmissions).values({
        id,
        tenantId: principal.tenantId,
        claimId,
        submissionNumber: (latestSubmission?.submissionNumber ?? 0) + 1,
        channel: claim.channel,
        submittedAt: now,
        submittedBy: principal.userId,
        recipientSnapshot,
        externalReference: optionalText(input.externalReference),
        protectedNote: optionalText(input.protectedNote),
        packageVersion: claim.packageVersion,
        invoiceId: claim.invoiceId,
        packageHash: claim.packageHash,
        createdAt: now,
      });
      const [updated] = await transaction
        .update(claims)
        .set({
          status: 'submitted',
          version: claim.version + 1,
          updatedBy: principal.userId,
          updatedAt: now,
        })
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .returning();
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.submitted',
        action: 'claim.submitted',
        aggregateType: 'claim',
        aggregateId: claimId,
        resourceType: 'claim',
        metadata: {
          submissionId: id,
          channel: claim.channel,
          amountCents: claim.amountCents,
          packageVersion: claim.packageVersion,
        },
        payload: {
          claimId,
          submissionId: id,
          channel: claim.channel,
          amountCents: claim.amountCents,
          packageVersion: claim.packageVersion,
        },
      });
      return this.getClaimInTransaction(transaction, principal, updated!.id, 'claims.submit');
    });
  }

  async recordDecision(
    principal: AuthorizationPrincipal,
    claimId: string,
    input: ClaimDecisionInput,
    request: RequestContext,
    context: AuditContext,
  ) {
    validateDecisionInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [claim] = await transaction
        .select()
        .from(claims)
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .for('update')
        .limit(1);
      if (!claim) throw new ClaimNotFoundError();
      this.requireScoped(principal, 'claims.record_decision', this.resourceForClaim(claim));
      if (claim.version !== input.expectedVersion) throw new ClaimVersionConflictError();
      if (claim.status !== 'submitted') throw new ClaimInvalidStateError();
      const [submission] = await transaction
        .select()
        .from(claimSubmissions)
        .where(
          and(
            eq(claimSubmissions.tenantId, principal.tenantId),
            eq(claimSubmissions.claimId, claimId),
          ),
        )
        .orderBy(desc(claimSubmissions.submissionNumber))
        .limit(1);
      if (!submission) throw new ClaimInvalidStateError();
      const lines = await transaction
        .select()
        .from(claimLines)
        .where(and(eq(claimLines.tenantId, principal.tenantId), eq(claimLines.claimId, claimId)))
        .orderBy(asc(claimLines.createdAt), asc(claimLines.id));
      assertClaimDecision({
        decision: input.decision,
        decisionDate: input.decisionDate,
        acceptedCents: input.acceptedCents,
        rejectedCents: input.rejectedCents,
        amountCents: claim.amountCents,
        lines: input.lines,
        claimLines: lines.map((line) => ({ id: line.id, amountCents: line.amountCents })),
      });
      const decisionId = uuidv7();
      const now = new Date();
      await transaction.insert(claimDecisions).values({
        id: decisionId,
        tenantId: principal.tenantId,
        claimId,
        submissionId: submission.id,
        decision: input.decision,
        decisionDate: input.decisionDate,
        externalReference: optionalText(input.externalReference),
        acceptedCents: input.acceptedCents,
        rejectedCents: input.rejectedCents,
        reasonCode: optionalText(input.reasonCode),
        protectedExplanation: optionalText(input.protectedExplanation),
        recordedBy: principal.userId,
        createdAt: now,
      });
      if (input.lines.length > 0) {
        await transaction.insert(claimDecisionLines).values(
          input.lines.map((line) => ({
            tenantId: principal.tenantId,
            decisionId,
            claimLineId: line.claimLineId,
            acceptedCents: line.acceptedCents,
            rejectedCents: line.rejectedCents,
          })),
        );
      }
      const [updated] = await transaction
        .update(claims)
        .set({
          status: input.decision,
          version: claim.version + 1,
          updatedBy: principal.userId,
          updatedAt: now,
        })
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .returning();
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.decision_recorded',
        action: 'claim.decision_recorded',
        aggregateType: 'claim',
        aggregateId: claimId,
        resourceType: 'claim',
        metadata: {
          decisionId,
          decision: input.decision,
          acceptedCents: input.acceptedCents,
          rejectedCents: input.rejectedCents,
          reasonCode: optionalText(input.reasonCode),
        },
        payload: {
          claimId,
          decisionId,
          decision: input.decision,
          acceptedCents: input.acceptedCents,
          rejectedCents: input.rejectedCents,
        },
      });
      return this.getClaimInTransaction(
        transaction,
        principal,
        updated!.id,
        'claims.record_decision',
      );
    });
  }

  async resubmit(
    principal: AuthorizationPrincipal,
    claimId: string,
    expectedVersion: number,
    request: RequestContext,
    context: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [previous] = await transaction
        .select()
        .from(claims)
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .for('update')
        .limit(1);
      if (!previous) throw new ClaimNotFoundError();
      this.requireScoped(principal, 'claims.manage', this.resourceForClaim(previous));
      if (previous.version !== expectedVersion) throw new ClaimVersionConflictError();
      if (!['partially_accepted', 'rejected', 'clarification_required'].includes(previous.status)) {
        throw new ClaimInvalidStateError();
      }
      const [submission] = await transaction
        .select()
        .from(claimSubmissions)
        .where(
          and(
            eq(claimSubmissions.tenantId, principal.tenantId),
            eq(claimSubmissions.claimId, claimId),
          ),
        )
        .orderBy(desc(claimSubmissions.submissionNumber))
        .limit(1);
      if (!submission) throw new ClaimInvalidStateError();
      const previousLines = await transaction
        .select({ line: claimLines, decisionLine: claimDecisionLines })
        .from(claimLines)
        .leftJoin(
          claimDecisions,
          and(
            eq(claimDecisions.tenantId, claimLines.tenantId),
            eq(claimDecisions.claimId, claimLines.claimId),
          ),
        )
        .leftJoin(
          claimDecisionLines,
          and(
            eq(claimDecisionLines.tenantId, claimDecisions.tenantId),
            eq(claimDecisionLines.decisionId, claimDecisions.id),
            eq(claimDecisionLines.claimLineId, claimLines.id),
          ),
        )
        .where(and(eq(claimLines.tenantId, principal.tenantId), eq(claimLines.claimId, claimId)))
        .orderBy(asc(claimLines.createdAt), asc(claimLines.id));
      const selections = previousLines
        .map(({ line, decisionLine }) => ({
          invoiceLineId: line.invoiceLineId,
          amountCents: Math.max(0, line.amountCents - (decisionLine?.acceptedCents ?? 0)),
        }))
        .filter((line) => line.amountCents > 0);
      if (selections.length === 0) throw new ClaimInvalidStateError();
      await transaction
        .update(claims)
        .set({
          status: 'resubmitted',
          version: previous.version + 1,
          updatedBy: principal.userId,
          updatedAt: new Date(),
        })
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)));
      const next = await this.insertClaim(
        transaction,
        principal,
        {
          invoiceId: previous.invoiceId,
          expectedInvoiceVersion: previous.invoiceVersion,
          payerArrangementId: previous.payerArrangementId,
          payerBillingProfileId: previous.payerBillingProfileId,
          lines: selections,
        },
        previous.id,
        submission.id,
      );
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.resubmitted',
        action: 'claim.resubmitted',
        aggregateType: 'claim',
        aggregateId: next.id,
        resourceType: 'claim',
        metadata: {
          previousClaimId: claimId,
          claimId: next.id,
          previousStatus: previous.status,
        },
        payload: {
          previousClaimId: claimId,
          claimId: next.id,
          submissionId: submission.id,
        },
      });
      return this.getClaimInTransaction(transaction, principal, next.id, 'claims.manage');
    });
  }

  async cancel(
    principal: AuthorizationPrincipal,
    claimId: string,
    expectedVersion: number,
    request: RequestContext,
    context: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [claim] = await transaction
        .select()
        .from(claims)
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .for('update')
        .limit(1);
      if (!claim) throw new ClaimNotFoundError();
      this.requireScoped(principal, 'claims.manage', this.resourceForClaim(claim));
      if (claim.version !== expectedVersion) throw new ClaimVersionConflictError();
      if (!['draft', 'ready'].includes(claim.status)) throw new ClaimInvalidStateError();
      const [updated] = await transaction
        .update(claims)
        .set({
          status: 'cancelled',
          version: claim.version + 1,
          updatedBy: principal.userId,
          updatedAt: new Date(),
        })
        .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
        .returning();
      await this.recordLifecycle(transaction, principal, request, context, {
        type: 'claim.cancelled',
        action: 'claim.cancelled',
        aggregateType: 'claim',
        aggregateId: claimId,
        resourceType: 'claim',
        metadata: { packageVersion: claim.packageVersion },
        payload: { claimId },
      });
      return this.getClaimInTransaction(transaction, principal, updated!.id, 'claims.manage');
    });
  }

  async packageDocuments(
    principal: AuthorizationPrincipal,
    claimId: string,
  ): Promise<ClaimPackageDocumentView[]> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.getClaimRow(transaction, principal, claimId, 'claims.read');
      const rows = await transaction
        .select()
        .from(claimPackageDocuments)
        .where(
          and(
            eq(claimPackageDocuments.tenantId, principal.tenantId),
            eq(claimPackageDocuments.claimId, claimId),
          ),
        )
        .orderBy(
          asc(claimPackageDocuments.packageVersion),
          asc(claimPackageDocuments.documentKind),
        );
      return rows.map(packageDocumentView);
    });
  }

  async downloadPackageDocument(
    principal: AuthorizationPrincipal,
    claimId: string,
    documentId: string,
    request: RequestContext,
    context: AuditContext,
  ): Promise<{ fileName: string; bytes: Uint8Array }> {
    const document = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const claim = await this.getClaimRow(transaction, principal, claimId, 'claims.read');
        const [row] = await transaction
          .select()
          .from(claimPackageDocuments)
          .where(
            and(
              eq(claimPackageDocuments.tenantId, principal.tenantId),
              eq(claimPackageDocuments.claimId, claimId),
              eq(claimPackageDocuments.id, documentId),
            ),
          )
          .limit(1);
        if (!row || row.invoiceId !== claim.invoiceId) throw new ClaimSourceInvalidError();
        return row;
      },
    );
    let file: { fileName: string; bytes: Uint8Array };
    if (document.invoiceDocumentId) {
      const row = await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const [invoiceDocument] = await transaction
            .select()
            .from(invoiceDocuments)
            .where(
              and(
                eq(invoiceDocuments.tenantId, principal.tenantId),
                eq(invoiceDocuments.invoiceId, document.invoiceId),
                eq(invoiceDocuments.id, document.invoiceDocumentId!),
                eq(invoiceDocuments.status, 'ready'),
              ),
            )
            .limit(1);
          if (
            !invoiceDocument ||
            invoiceDocument.sha256 !== document.sha256 ||
            !invoiceDocument.objectKey
          ) {
            throw new ClaimSourceInvalidError();
          }
          return invoiceDocument;
        },
      );
      const bytes = await this.storage.get(row.objectKey!);
      if (!bytes || createHash('sha256').update(bytes).digest('hex') !== document.sha256) {
        throw new ClaimSourceInvalidError();
      }
      file = { fileName: document.fileName, bytes };
    } else if (document.documentArtifactId) {
      file = await this.documents.download(
        principal,
        document.documentArtifactId,
        request,
        context,
      );
      if (createHash('sha256').update(file.bytes).digest('hex') !== document.sha256) {
        throw new ClaimSourceInvalidError();
      }
      file = { ...file, fileName: document.fileName };
    } else {
      throw new ClaimSourceInvalidError();
    }
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, context, {
          action: 'claim.document_downloaded',
          resourceType: 'claim',
          resourceId: claimId,
          metadata: { documentKind: document.documentKind, sha256: document.sha256 },
        }),
      );
    });
    return file;
  }

  async history(principal: AuthorizationPrincipal, claimId: string) {
    const detail = await this.getClaim(principal, claimId);
    return {
      claimId,
      entries: [
        { type: 'created', at: detail.claim.createdAt.toISOString(), version: 1 },
        ...(detail.claim.preparedAt
          ? [
              {
                type: 'prepared',
                at: detail.claim.preparedAt.toISOString(),
                packageVersion: detail.claim.packageVersion,
              },
            ]
          : []),
        ...detail.submissions.map((submission: typeof claimSubmissions.$inferSelect) => ({
          type: 'submitted',
          at: submission.submittedAt.toISOString(),
          submissionNumber: submission.submissionNumber,
          channel: submission.channel,
          externalReference: submission.externalReference,
        })),
        ...detail.decisions.map((decision: typeof claimDecisions.$inferSelect) => ({
          type: 'decision',
          at: decision.createdAt.toISOString(),
          decision: decision.decision,
          decisionDate: decision.decisionDate,
          acceptedCents: decision.acceptedCents,
          rejectedCents: decision.rejectedCents,
          reasonCode: decision.reasonCode,
        })),
        ...(detail.claim.status === 'resubmitted'
          ? [{ type: 'resubmitted', at: detail.claim.updatedAt.toISOString() }]
          : []),
        ...(detail.claim.status === 'cancelled'
          ? [{ type: 'cancelled', at: detail.claim.updatedAt.toISOString() }]
          : []),
      ].sort((left, right) => left.at.localeCompare(right.at)),
    };
  }

  async paymentSummary(principal: AuthorizationPrincipal, claimId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const claim = await this.getClaimRow(transaction, principal, claimId, 'claims.read');
      const [decision] = await transaction
        .select({ acceptedCents: claimDecisions.acceptedCents })
        .from(claimDecisions)
        .where(
          and(eq(claimDecisions.tenantId, principal.tenantId), eq(claimDecisions.claimId, claimId)),
        )
        .orderBy(desc(claimDecisions.createdAt), desc(claimDecisions.id))
        .limit(1);
      const rows = await transaction
        .select({ allocation: paymentAllocations, payment: payments, reversal: paymentReversals })
        .from(paymentAllocations)
        .innerJoin(
          payments,
          and(
            eq(payments.tenantId, paymentAllocations.tenantId),
            eq(payments.id, paymentAllocations.paymentId),
          ),
        )
        .leftJoin(
          paymentReversals,
          and(
            eq(paymentReversals.tenantId, paymentAllocations.tenantId),
            eq(paymentReversals.allocationId, paymentAllocations.id),
          ),
        )
        .where(
          and(
            eq(paymentAllocations.tenantId, principal.tenantId),
            eq(paymentAllocations.claimId, claimId),
          ),
        )
        .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
      const paidCents = rows.reduce(
        (total, row) => total + (row.reversal ? 0 : row.allocation.amountCents),
        0,
      );
      const acceptedCents = decision?.acceptedCents ?? 0;
      return {
        claimId,
        status: claim.status,
        acceptedCents,
        paidCents,
        unpaidCents: Math.max(0, acceptedCents - paidCents),
        allocations: rows.map(({ allocation, payment, reversal }) => ({
          allocationId: allocation.id,
          paymentId: payment.id,
          paymentReference: payment.reference,
          amountCents: allocation.amountCents,
          allocatedAt: allocation.createdAt.toISOString(),
          reversedAt: reversal?.reversedAt.toISOString() ?? null,
        })),
      };
    });
  }

  private async insertClaim(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    input: CreateClaimInput,
    supersedesClaimId: string | null,
    resubmissionOfSubmissionId: string | null,
  ) {
    validateCreateInput(input);
    const [invoice] = await transaction
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, input.invoiceId)))
      .for('update')
      .limit(1);
    if (
      !invoice ||
      invoice.status !== 'issued' ||
      invoice.version !== input.expectedInvoiceVersion
    ) {
      throw new ClaimSourceInvalidError();
    }
    this.requireScoped(principal, 'claims.manage', {
      tenantId: principal.tenantId,
      organizationId: invoice.organizationId,
      facilityId: invoice.facilityId,
      clientId: invoice.clientId,
    });
    const [arrangement] = await transaction
      .select()
      .from(payerArrangements)
      .where(
        and(
          eq(payerArrangements.tenantId, principal.tenantId),
          eq(payerArrangements.organizationId, invoice.organizationId),
          eq(payerArrangements.clientId, invoice.clientId),
          eq(payerArrangements.id, input.payerArrangementId),
        ),
      )
      .for('update')
      .limit(1);
    if (
      !arrangement ||
      !arrangement.payerId ||
      (arrangement.arrangementType !== 'direct_payer_billing' &&
        arrangement.arrangementType !== 'reimbursement_to_client') ||
      (invoice.payerArrangementId !== null && invoice.payerArrangementId !== arrangement.id) ||
      (arrangement.arrangementType === 'direct_payer_billing' &&
        (invoice.recipientType !== 'payer' || invoice.payerArrangementId !== arrangement.id)) ||
      (arrangement.arrangementType === 'reimbursement_to_client' &&
        invoice.recipientType !== 'client')
    ) {
      throw new ClaimSourceInvalidError();
    }
    const [payer] = await transaction
      .select()
      .from(payers)
      .where(
        and(
          eq(payers.tenantId, principal.tenantId),
          eq(payers.organizationId, invoice.organizationId),
          eq(payers.id, arrangement.payerId),
        ),
      )
      .limit(1);
    if (!payer) throw new ClaimSourceInvalidError();

    const selections = new Map(input.lines.map((line) => [line.invoiceLineId, line.amountCents]));
    const sourceLines = await transaction
      .select()
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.tenantId, principal.tenantId),
          eq(invoiceLines.invoiceId, invoice.id),
          inArray(invoiceLines.id, [...selections.keys()]),
        ),
      )
      .orderBy(asc(invoiceLines.serviceDate), asc(invoiceLines.id));
    if (sourceLines.length !== selections.size) throw new ClaimSourceInvalidError();

    const allocationIds = sourceLines.flatMap((line) =>
      line.fundingAllocationId ? [line.fundingAllocationId] : [],
    );
    const allocations = allocationIds.length
      ? await transaction
          .select()
          .from(serviceAllocations)
          .where(
            and(
              eq(serviceAllocations.tenantId, principal.tenantId),
              inArray(serviceAllocations.id, allocationIds),
            ),
          )
      : [];
    const allocationById = new Map(allocations.map((allocation) => [allocation.id, allocation]));
    const fundingIds = [...new Set(allocations.map((allocation) => allocation.fundingSourceId))];
    const fundingSources = fundingIds.length
      ? await transaction
          .select()
          .from(benefitFundingSources)
          .where(
            and(
              eq(benefitFundingSources.tenantId, principal.tenantId),
              eq(benefitFundingSources.clientId, invoice.clientId),
              inArray(benefitFundingSources.id, fundingIds),
            ),
          )
      : [];
    const fundingById = new Map(fundingSources.map((source) => [source.id, source]));
    const evidenceIds = [...new Set(sourceLines.map((line) => line.evidencePackageId))];
    const evidenceRows = await transaction
      .select()
      .from(evidencePackages)
      .where(
        and(
          eq(evidencePackages.tenantId, principal.tenantId),
          inArray(evidencePackages.id, evidenceIds),
        ),
      );
    const evidenceById = new Map(evidenceRows.map((evidence) => [evidence.id, evidence]));

    const lineFacts = sourceLines.map((line) => {
      const allocation = line.fundingAllocationId
        ? (allocationById.get(line.fundingAllocationId) ?? null)
        : null;
      const fundingSource = allocation
        ? (fundingById.get(allocation.fundingSourceId) ?? null)
        : null;
      const evidence = evidenceById.get(line.evidencePackageId) ?? null;
      if (
        !evidence ||
        evidence.snapshotHash !== line.evidenceSnapshotHash ||
        (line.fundingAllocationId &&
          (!allocation || allocation.clientId !== invoice.clientId || !fundingSource)) ||
        (arrangement.fundingSourceId &&
          allocation?.fundingSourceId !== arrangement.fundingSourceId) ||
        (arrangement.clientInsuranceId &&
          fundingSource?.clientInsuranceId !== arrangement.clientInsuranceId)
      ) {
        throw new ClaimSourceInvalidError();
      }
      return { line, allocation, fundingSource, evidence };
    });
    const fundingTypes = new Set(
      lineFacts.map(({ fundingSource }) => fundingSource?.sourceType ?? 'self_pay'),
    );
    if (fundingTypes.size !== 1) throw new ClaimSourceInvalidError();
    const fundingSourceType = [...fundingTypes][0]!;
    const payerMatchesFunding =
      (payer.payerType === 'statutory_pflegekasse' &&
        fundingSourceType === 'statutory_long_term_care_insurance') ||
      (payer.payerType === 'private_pflegeversicherung' &&
        fundingSourceType === 'private_long_term_care_insurance') ||
      (payer.payerType === 'self_pay' && fundingSourceType === 'self_pay') ||
      (payer.payerType === 'other' && fundingSourceType === 'other');
    if (!payerMatchesFunding) throw new ClaimSourceInvalidError();

    const profile = input.payerBillingProfileId
      ? (
          await transaction
            .select()
            .from(payerBillingProfiles)
            .where(
              and(
                eq(payerBillingProfiles.tenantId, principal.tenantId),
                eq(payerBillingProfiles.organizationId, invoice.organizationId),
                eq(payerBillingProfiles.payerId, payer.id),
                eq(payerBillingProfiles.id, input.payerBillingProfileId),
                eq(payerBillingProfiles.fundingSourceType, fundingSourceType),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (input.payerBillingProfileId && !profile) throw new ClaimSourceInvalidError();
    const channel =
      profile?.channel ??
      (arrangement.arrangementType === 'reimbursement_to_client' ? 'customer_reimbursement' : null);
    const reserved = await this.reservedInvoiceLineAmounts(
      transaction,
      principal.tenantId,
      invoice.id,
      null,
    );
    const amountCents = sourceLines.reduce((total, line) => {
      const selected = selections.get(line.id)!;
      const available = line.grossCents - (reserved.get(line.id) ?? 0);
      if (!Number.isSafeInteger(selected) || selected <= 0 || selected > available) {
        throw new ClaimAmountReservedError();
      }
      return total + selected;
    }, 0);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new ClaimSourceInvalidError();
    const [client] = await transaction
      .select({ firstName: clientRecords.firstName, lastName: clientRecords.lastName })
      .from(clientRecords)
      .where(
        and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, invoice.clientId)),
      )
      .limit(1);
    if (!client) throw new ClaimSourceInvalidError();
    const now = new Date();
    const claimId = uuidv7();
    const invoiceSnapshot = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      servicePeriodFrom: invoice.servicePeriodFrom,
      servicePeriodUntil: invoice.servicePeriodUntil,
      currency: invoice.currency,
      subtotalCents: invoice.subtotalCents,
      taxTotalCents: invoice.taxTotalCents,
      grandTotalCents: invoice.grandTotalCents,
      invoiceVersion: invoice.version,
      recipientType: invoice.recipientType,
      recipientSnapshot: invoice.recipientSnapshot,
      clientName: `${client.firstName} ${client.lastName}`,
    };
    const payerSnapshot = {
      payerId: payer.id,
      payerType: payer.payerType,
      name: payer.name,
      payerIdentifier: payer.payerIdentifier,
      addressText: payer.addressText,
      billingContactName: payer.billingContactName,
      billingContactEmail: payer.billingContactEmail,
      submissionInstructions: payer.submissionInstructions,
    };
    const arrangementSnapshot = {
      arrangementId: arrangement.id,
      arrangementType: arrangement.arrangementType,
      recipientType: arrangement.recipientType,
      recipientName: arrangement.recipientName,
      recipientAddress: arrangement.recipientAddress,
      mandateStatus: arrangement.mandateStatus,
      documentedSource: arrangement.documentedSource,
      documentedReference: arrangement.documentedReference,
      mandateDocumentArtifactId: arrangement.mandateDocumentArtifactId,
      validFrom: arrangement.validFrom,
      validUntil: arrangement.validUntil,
      fundingSourceId: arrangement.fundingSourceId,
      clientInsuranceId: arrangement.clientInsuranceId,
    };
    const profileSnapshot = profile
      ? {
          configured: true,
          profileId: profile.id,
          version: profile.version,
          channel: profile.channel,
          fundingSourceType: profile.fundingSourceType,
          validFrom: profile.validFrom,
          validUntil: profile.validUntil,
          sourceName: profile.sourceName,
          sourceVersion: profile.sourceVersion,
          sourceEffectiveDate: profile.sourceEffectiveDate,
          sourceUrl: profile.sourceUrl,
          requiresClientInsuranceNumber: profile.requiresClientInsuranceNumber,
          requiresPayerIdentifier: profile.requiresPayerIdentifier,
          requiresAcknowledgement: profile.requiresAcknowledgement,
          requiresMandate: profile.requiresMandate,
          requiresInvoicePdf: profile.requiresInvoicePdf,
          requiresEvidencePdf: profile.requiresEvidencePdf,
          requiresMandateDocument: profile.requiresMandateDocument,
          requiresExternalReference: profile.requiresExternalReference,
          requiresProviderRecognition: profile.requiresProviderRecognition,
        }
      : { configured: false };
    const snapshotHash = hashCanonical({
      invoiceSnapshot,
      payerSnapshot,
      arrangementSnapshot,
      profileSnapshot,
      lineSnapshots: lineFacts.map(({ line, fundingSource, evidence }) => ({
        invoiceLineId: line.id,
        fundingAllocationId: line.fundingAllocationId,
        fundingSourceType: fundingSource?.sourceType ?? 'self_pay',
        evidencePackageId: evidence.id,
        evidenceSnapshotHash: evidence.snapshotHash,
        amountCents: selections.get(line.id),
      })),
    });
    const [claim] = await transaction
      .insert(claims)
      .values({
        id: claimId,
        tenantId: principal.tenantId,
        organizationId: invoice.organizationId,
        facilityId: invoice.facilityId,
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        payerId: payer.id,
        payerArrangementId: arrangement.id,
        payerBillingProfileId: profile?.id ?? null,
        arrangementType: arrangement.arrangementType,
        channel,
        fundingSourceType,
        status: 'draft',
        currency: invoice.currency,
        amountCents,
        invoiceVersion: invoice.version,
        invoiceSnapshot,
        payerSnapshot,
        arrangementSnapshot,
        profileSnapshot,
        snapshotHash,
        packageVersion: 0,
        packageHash: null,
        supersedesClaimId,
        resubmissionOfSubmissionId,
        version: 1,
        createdBy: principal.userId,
        updatedBy: principal.userId,
        createdAt: now,
        updatedAt: now,
        preparedAt: null,
      })
      .returning();
    await transaction.insert(claimLines).values(
      lineFacts.map(({ line, allocation, fundingSource, evidence }) => ({
        id: uuidv7(),
        tenantId: principal.tenantId,
        claimId,
        invoiceId: invoice.id,
        invoiceLineId: line.id,
        fundingAllocationId: allocation?.id ?? null,
        evidencePackageId: evidence.id,
        amountCents: selections.get(line.id)!,
        lineSnapshot: {
          serviceCode: line.serviceCodeSnapshot,
          serviceName: line.serviceNameSnapshot,
          serviceDate: line.serviceDate,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          invoiceLineAmountCents: line.grossCents,
          fundingSourceType: fundingSource?.sourceType ?? 'self_pay',
          fundingLabel: line.fundingLabelSnapshot,
          evidenceSnapshotHash: evidence.snapshotHash,
        },
        createdAt: now,
      })),
    );
    return claim!;
  }

  private async reservedInvoiceLineAmounts(
    transaction: DatabaseTransaction,
    tenantId: string,
    invoiceId: string,
    excludeClaimId: string | null,
  ): Promise<Map<string, number>> {
    const rows = await transaction
      .select({ line: claimLines, claim: claims })
      .from(claimLines)
      .innerJoin(
        claims,
        and(eq(claims.tenantId, claimLines.tenantId), eq(claims.id, claimLines.claimId)),
      )
      .where(
        and(
          eq(claimLines.tenantId, tenantId),
          eq(claimLines.invoiceId, invoiceId),
          ...(excludeClaimId ? [sql`${claimLines.claimId} <> ${excludeClaimId}::uuid`] : []),
        ),
      );
    const reserved = new Map<string, number>();
    for (const { line, claim } of rows) {
      if (
        [
          'draft',
          'ready',
          'submitted',
          'accepted',
          'partially_accepted',
          'clarification_required',
        ].includes(claim.status)
      ) {
        reserved.set(
          line.invoiceLineId,
          (reserved.get(line.invoiceLineId) ?? 0) + line.amountCents,
        );
      }
    }
    const historicalClaimIds = rows
      .filter(({ claim }) => claim.status === 'resubmitted')
      .map(({ claim }) => claim.id);
    if (historicalClaimIds.length > 0) {
      const acceptedRows = await transaction
        .select({
          invoiceLineId: claimLines.invoiceLineId,
          acceptedCents: claimDecisionLines.acceptedCents,
        })
        .from(claimDecisionLines)
        .innerJoin(
          claimLines,
          and(
            eq(claimLines.tenantId, claimDecisionLines.tenantId),
            eq(claimLines.id, claimDecisionLines.claimLineId),
          ),
        )
        .where(
          and(eq(claimLines.tenantId, tenantId), inArray(claimLines.claimId, historicalClaimIds)),
        );
      for (const row of acceptedRows) {
        reserved.set(row.invoiceLineId, (reserved.get(row.invoiceLineId) ?? 0) + row.acceptedCents);
      }
    }
    return reserved;
  }

  private async claimReadinessFacts(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    claimId: string,
    permission: Permission = 'claims.read',
  ): Promise<ClaimReadinessFacts> {
    const claim = await this.getClaimRow(transaction, principal, claimId, permission);
    const [invoice] = await transaction
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, claim.invoiceId)))
      .limit(1);
    const [arrangement] = await transaction
      .select()
      .from(payerArrangements)
      .where(
        and(
          eq(payerArrangements.tenantId, principal.tenantId),
          eq(payerArrangements.organizationId, claim.organizationId),
          eq(payerArrangements.clientId, claim.clientId),
          eq(payerArrangements.id, claim.payerArrangementId),
        ),
      )
      .limit(1);
    const [payer] = await transaction
      .select()
      .from(payers)
      .where(
        and(
          eq(payers.tenantId, principal.tenantId),
          eq(payers.organizationId, claim.organizationId),
          eq(payers.id, claim.payerId),
        ),
      )
      .limit(1);
    const [profile] = claim.payerBillingProfileId
      ? await transaction
          .select()
          .from(payerBillingProfiles)
          .where(
            and(
              eq(payerBillingProfiles.tenantId, principal.tenantId),
              eq(payerBillingProfiles.organizationId, claim.organizationId),
              eq(payerBillingProfiles.payerId, claim.payerId),
              eq(payerBillingProfiles.id, claim.payerBillingProfileId),
            ),
          )
          .limit(1)
      : [];
    const [insurance] = arrangement?.clientInsuranceId
      ? await transaction
          .select()
          .from(clientInsurances)
          .where(
            and(
              eq(clientInsurances.tenantId, principal.tenantId),
              eq(clientInsurances.clientId, claim.clientId),
              eq(clientInsurances.id, arrangement.clientInsuranceId),
            ),
          )
          .limit(1)
      : [];
    const [invoiceDocument] = await transaction
      .select()
      .from(invoiceDocuments)
      .where(
        and(
          eq(invoiceDocuments.tenantId, principal.tenantId),
          eq(invoiceDocuments.invoiceId, claim.invoiceId),
          eq(invoiceDocuments.status, 'ready'),
        ),
      )
      .orderBy(desc(invoiceDocuments.documentVersion), desc(invoiceDocuments.createdAt))
      .limit(1);
    const [correctionCount] = await transaction
      .select({ value: sql<number>`count(*)::int` })
      .from(invoiceCorrections)
      .where(
        and(
          eq(invoiceCorrections.tenantId, principal.tenantId),
          eq(invoiceCorrections.invoiceId, claim.invoiceId),
        ),
      );
    const claimLineRows = await transaction
      .select()
      .from(claimLines)
      .where(and(eq(claimLines.tenantId, principal.tenantId), eq(claimLines.claimId, claimId)))
      .orderBy(asc(claimLines.createdAt), asc(claimLines.id));
    const invoiceLineIds = claimLineRows.map((line) => line.invoiceLineId);
    const invoiceLineRows = invoiceLineIds.length
      ? await transaction
          .select()
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.tenantId, principal.tenantId),
              eq(invoiceLines.invoiceId, claim.invoiceId),
              inArray(invoiceLines.id, invoiceLineIds),
            ),
          )
      : [];
    const invoiceLineById = new Map(invoiceLineRows.map((line) => [line.id, line]));
    const allocationIds = claimLineRows.flatMap((line) =>
      line.fundingAllocationId ? [line.fundingAllocationId] : [],
    );
    const allocationRows = allocationIds.length
      ? await transaction
          .select()
          .from(serviceAllocations)
          .where(
            and(
              eq(serviceAllocations.tenantId, principal.tenantId),
              inArray(serviceAllocations.id, allocationIds),
            ),
          )
      : [];
    const allocationById = new Map(allocationRows.map((allocation) => [allocation.id, allocation]));
    const fundingSourceIds = [
      ...new Set(allocationRows.map((allocation) => allocation.fundingSourceId)),
    ];
    const fundingRows = fundingSourceIds.length
      ? await transaction
          .select()
          .from(benefitFundingSources)
          .where(
            and(
              eq(benefitFundingSources.tenantId, principal.tenantId),
              eq(benefitFundingSources.clientId, claim.clientId),
              inArray(benefitFundingSources.id, fundingSourceIds),
            ),
          )
      : [];
    const fundingById = new Map(fundingRows.map((source) => [source.id, source]));
    const evidenceIds = [...new Set(claimLineRows.map((line) => line.evidencePackageId))];
    const evidenceRows = evidenceIds.length
      ? await transaction
          .select()
          .from(evidencePackages)
          .where(
            and(
              eq(evidencePackages.tenantId, principal.tenantId),
              inArray(evidencePackages.id, evidenceIds),
            ),
          )
      : [];
    const evidenceById = new Map(evidenceRows.map((evidence) => [evidence.id, evidence]));
    const reservedByLine = await this.reservedInvoiceLineAmounts(
      transaction,
      principal.tenantId,
      claim.invoiceId,
      claimId,
    );
    const lines: ClaimReadinessLineFact[] = [];
    for (const claimLine of claimLineRows) {
      const invoiceLine = invoiceLineById.get(claimLine.invoiceLineId) ?? null;
      const allocation = claimLine.fundingAllocationId
        ? (allocationById.get(claimLine.fundingAllocationId) ?? null)
        : null;
      const fundingSource = allocation
        ? (fundingById.get(allocation.fundingSourceId) ?? null)
        : null;
      const evidencePackage = evidenceById.get(claimLine.evidencePackageId) ?? null;
      const [acknowledgement] = evidencePackage
        ? await transaction
            .select()
            .from(acknowledgements)
            .where(
              and(
                eq(acknowledgements.tenantId, principal.tenantId),
                eq(acknowledgements.evidencePackageId, evidencePackage.id),
                eq(acknowledgements.evidencePackageHash, evidencePackage.snapshotHash),
                eq(acknowledgements.status, 'acknowledged'),
                isNull(acknowledgements.revokedAt),
              ),
            )
            .limit(1)
        : [];
      const [reversal] = allocation
        ? await transaction
            .select({ id: serviceAllocationReversals.id })
            .from(serviceAllocationReversals)
            .where(
              and(
                eq(serviceAllocationReversals.tenantId, principal.tenantId),
                eq(serviceAllocationReversals.allocationId, allocation.id),
              ),
            )
            .limit(1)
        : [];
      lines.push({
        claimLine,
        invoiceLine,
        allocation,
        fundingSource,
        evidencePackage,
        acknowledgement: acknowledgement ?? null,
        acknowledged: Boolean(acknowledgement),
        allocationReversed: Boolean(reversal),
        reservedCents: reservedByLine.get(claimLine.invoiceLineId) ?? 0,
      });
    }
    const serviceDates = lines.flatMap((line) =>
      line.invoiceLine ? [line.invoiceLine.serviceDate] : [],
    );
    const minDate = serviceDates.length ? [...serviceDates].sort()[0]! : null;
    const maxDate = serviceDates.length ? [...serviceDates].sort().at(-1)! : null;
    const providerRecognition =
      profile?.requiresProviderRecognition && minDate && maxDate
        ? await transaction
            .select({ id: providerRecognitions.id })
            .from(providerRecognitions)
            .where(
              and(
                eq(providerRecognitions.tenantId, principal.tenantId),
                eq(providerRecognitions.organizationId, claim.organizationId),
                eq(providerRecognitions.jurisdiction, 'DE-NW'),
                eq(providerRecognitions.status, 'active'),
                lte(providerRecognitions.validFrom, minDate),
                or(
                  isNull(providerRecognitions.validUntil),
                  gte(providerRecognitions.validUntil, maxDate),
                ),
              ),
            )
            .limit(1)
        : [{ id: 'not-required' }];
    const facts: ClaimReadinessFacts = {
      claim,
      invoice: invoice ?? null,
      arrangement: arrangement ?? null,
      payer: payer ?? null,
      profile: profile ?? null,
      insurance: insurance ?? null,
      invoiceDocument: invoiceDocument ?? null,
      correctionCount: correctionCount?.value ?? 0,
      lines,
      providerRecognitionValid: providerRecognition.length > 0,
    } as ClaimReadinessFacts;
    return facts;
  }

  private async evaluateReadiness(
    principal: AuthorizationPrincipal,
    facts: ClaimReadinessFacts,
  ): Promise<ClaimReadiness> {
    const blockers: ClaimReadinessFinding[] = [];
    const add = (code: string, field: string, detail: string) => {
      if (!blockers.some((item) => item.code === code && item.field === field)) {
        blockers.push({ code, field, detail, blocking: true });
      }
    };
    const dates = facts.lines.flatMap((line) =>
      line.invoiceLine ? [line.invoiceLine.serviceDate] : [],
    );
    const firstDate = dates.length ? [...dates].sort()[0]! : null;
    const lastDate = dates.length ? [...dates].sort().at(-1)! : null;
    if (!facts.invoice || facts.invoice.status !== 'issued') {
      add('invoice_not_issued', 'invoiceId', 'Issue the source invoice before preparing a claim.');
    } else if (facts.invoice.version !== facts.claim.invoiceVersion) {
      add(
        'invoice_version_changed',
        'invoiceId',
        'The source invoice changed after this claim was created.',
      );
    }
    if (facts.correctionCount > 0) {
      add(
        'invoice_corrected',
        'invoiceId',
        'The invoice has a correction; review and create a claim from the corrected billing record.',
      );
    }
    if (!facts.invoiceDocument?.sha256 || !facts.invoiceDocument.objectKey) {
      add(
        'invoice_pdf_missing',
        'invoicePdf',
        'Generate a ready invoice PDF before preparing the package.',
      );
    }
    if (!facts.payer || facts.payer.status !== 'active') {
      add('payer_inactive', 'payerId', 'Select an active payer record.');
    } else if (
      firstDate &&
      (facts.payer.validFrom > firstDate ||
        (facts.payer.validUntil !== null && facts.payer.validUntil < (lastDate ?? firstDate)))
    ) {
      add(
        'payer_not_valid_for_period',
        'payerId',
        'The payer profile does not cover the service period.',
      );
    }
    if (!facts.arrangement) {
      add(
        'payer_arrangement_missing',
        'payerArrangementId',
        'Select a payer arrangement for this client and payer.',
      );
    } else {
      if (
        facts.arrangement.organizationId !== facts.claim.organizationId ||
        facts.arrangement.clientId !== facts.claim.clientId ||
        facts.arrangement.payerId !== facts.claim.payerId ||
        facts.arrangement.arrangementType !== facts.claim.arrangementType
      ) {
        add(
          'payer_arrangement_mismatch',
          'payerArrangementId',
          'The arrangement does not match this client, payer, or claim type.',
        );
      }
      if (
        firstDate &&
        (facts.arrangement.validFrom > firstDate ||
          (facts.arrangement.validUntil !== null &&
            facts.arrangement.validUntil < (lastDate ?? firstDate)))
      ) {
        add(
          'payer_arrangement_not_valid_for_period',
          'payerArrangementId',
          'The arrangement does not cover the service period.',
        );
      }
      if (facts.claim.arrangementType === 'direct_payer_billing') {
        if (
          facts.arrangement.mandateStatus !== 'authorized' ||
          !optionalText(facts.arrangement.documentedSource) ||
          !optionalText(facts.arrangement.documentedReference)
        ) {
          add(
            'mandate_missing',
            'payerArrangementId',
            'Direct payer billing requires an active documented mandate.',
          );
        }
      }
    }
    if (!facts.profile) {
      add(
        'payer_requirements_unconfigured',
        'payerBillingProfileId',
        'Configure an effective payer requirements profile before preparing this claim.',
      );
    } else {
      if (
        firstDate &&
        (facts.profile.validFrom > firstDate ||
          (facts.profile.validUntil !== null && facts.profile.validUntil < (lastDate ?? firstDate)))
      ) {
        add(
          'payer_requirements_not_valid_for_period',
          'payerBillingProfileId',
          'The selected payer requirements profile does not cover the service period.',
        );
      }
      if (
        facts.profile.fundingSourceType !== facts.claim.fundingSourceType ||
        facts.profile.channel !== facts.claim.channel
      ) {
        add(
          'payer_requirements_mismatch',
          'payerBillingProfileId',
          'The payer requirements profile does not match the claim funding type and submission channel.',
        );
      }
      if (facts.profile.requiresPayerIdentifier && !optionalText(facts.payer?.payerIdentifier)) {
        add(
          'payer_identifier_missing',
          'payerIdentifier',
          'Add the payer identifier required by this profile.',
        );
      }
      if (
        facts.profile.requiresClientInsuranceNumber &&
        !optionalText(facts.insurance?.insuranceNumber ?? facts.insurance?.memberNumber)
      ) {
        add(
          'client_insurance_number_missing',
          'insuranceNumber',
          'Add the client insurance number required by this profile.',
        );
      }
      if (
        facts.profile.requiresMandate &&
        facts.claim.arrangementType === 'direct_payer_billing' &&
        facts.arrangement?.mandateStatus !== 'authorized'
      ) {
        add(
          'mandate_required',
          'payerArrangementId',
          'Record the applicable authorization before direct billing.',
        );
      }
      if (facts.profile.requiresMandateDocument && facts.arrangement?.mandateDocumentArtifactId) {
        try {
          const artifact = await this.documents.artifactForSourceAuthorization(
            principal,
            facts.arrangement.mandateDocumentArtifactId,
          );
          if (
            artifact.organizationId !== facts.claim.organizationId ||
            artifact.clientId !== facts.claim.clientId ||
            !artifact.sha256 ||
            (artifact.status !== 'ready' && artifact.status !== 'superseded')
          ) {
            add(
              'mandate_document_unavailable',
              'mandateDocumentArtifactId',
              'The mandate document is not available as a finalized private artifact.',
            );
          }
        } catch {
          add(
            'mandate_document_unavailable',
            'mandateDocumentArtifactId',
            'The mandate document is missing or not accessible in this scope.',
          );
        }
      } else if (facts.profile.requiresMandateDocument) {
        add(
          'mandate_document_missing',
          'mandateDocumentArtifactId',
          'Attach the mandate document required by this profile.',
        );
      }
      if (facts.profile.requiresProviderRecognition && !facts.providerRecognitionValid) {
        add(
          'provider_recognition_missing',
          'providerRecognition',
          'Record valid NRW provider recognition for the complete service period.',
        );
      }
    }
    if (facts.lines.length === 0) {
      add('claim_lines_missing', 'lines', 'Add at least one invoice funding portion to the claim.');
    }
    for (const line of facts.lines) {
      const lineName =
        snapshotText(line.claimLine.lineSnapshot, 'serviceName') || line.claimLine.invoiceLineId;
      if (!line.invoiceLine) {
        add(
          'invoice_line_missing',
          `lines.${line.claimLine.id}`,
          `Invoice line ${lineName} is no longer available.`,
        );
        continue;
      }
      if (
        line.invoiceLine.fundingAllocationId !== line.claimLine.fundingAllocationId ||
        line.invoiceLine.evidencePackageId !== line.claimLine.evidencePackageId ||
        line.invoiceLine.grossCents < line.claimLine.amountCents
      ) {
        add(
          'invoice_line_changed',
          `lines.${line.claimLine.id}`,
          `Invoice line ${lineName} no longer matches the claim snapshot.`,
        );
      }
      if (
        !line.evidencePackage ||
        line.evidencePackage.snapshotHash !== line.invoiceLine.evidenceSnapshotHash
      ) {
        add(
          'evidence_missing_or_stale',
          `lines.${line.claimLine.id}`,
          `The Leistungsnachweis for ${lineName} is missing or outdated.`,
        );
      }
      if (line.claimLine.fundingAllocationId) {
        if (!line.allocation || !line.fundingSource || line.allocation.status !== 'confirmed') {
          add(
            'funding_allocation_missing',
            `lines.${line.claimLine.id}`,
            `The funding allocation for ${lineName} is not confirmed.`,
          );
        } else if (line.allocationReversed || line.fundingSource.status !== 'active') {
          add(
            'funding_allocation_reversed',
            `lines.${line.claimLine.id}`,
            `The funding allocation for ${lineName} is no longer available.`,
          );
        } else if (line.fundingSource.sourceType !== facts.claim.fundingSourceType) {
          add(
            'funding_type_mismatch',
            `lines.${line.claimLine.id}`,
            `The funding source for ${lineName} does not match the claim.`,
          );
        }
      } else if (facts.claim.fundingSourceType !== 'self_pay') {
        add(
          'funding_source_missing',
          `lines.${line.claimLine.id}`,
          `The funding source for ${lineName} is missing.`,
        );
      }
      if (facts.profile?.requiresAcknowledgement && !line.acknowledged) {
        add(
          'acknowledgement_missing',
          `lines.${line.claimLine.id}`,
          `A current client acknowledgement is required for ${lineName}.`,
        );
      }
      if (line.claimLine.amountCents + line.reservedCents > line.invoiceLine.grossCents) {
        add(
          'claim_amount_reserved',
          `lines.${line.claimLine.id}`,
          `Another claim already reserves part of ${lineName}.`,
        );
      }
    }
    if (facts.profile?.requiresExternalReference && facts.claim.status === 'ready') {
      // The payer reference is collected at manual submission, not package preparation.
    }
    let mandateDocumentArtifactId: string | null = null;
    if (
      facts.profile?.requiresMandateDocument &&
      facts.arrangement?.mandateDocumentArtifactId &&
      !blockers.some((item) => item.field === 'mandateDocumentArtifactId')
    ) {
      mandateDocumentArtifactId = facts.arrangement.mandateDocumentArtifactId;
    }
    const requiredEvidencePackageIds = [
      ...new Set(facts.lines.map((line) => line.claimLine.evidencePackageId)),
    ];
    return {
      claimId: facts.claim.id,
      ready: blockers.length === 0,
      blockers,
      requiredEvidencePackageIds,
      invoiceDocumentId: facts.invoiceDocument?.id ?? null,
      mandateDocumentArtifactId,
    };
  }

  private async getClaimRow(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    claimId: string,
    permission: Permission,
  ) {
    const [claim] = await transaction
      .select()
      .from(claims)
      .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, claimId)))
      .limit(1);
    if (!claim) throw new ClaimNotFoundError();
    this.requireScoped(principal, permission, this.resourceForClaim(claim));
    return claim;
  }

  private async getClaimInTransaction(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    claimId: string,
    permission: Permission = 'claims.read',
  ) {
    const claim = await this.getClaimRow(transaction, principal, claimId, permission);
    const lines = await transaction
      .select()
      .from(claimLines)
      .where(and(eq(claimLines.tenantId, principal.tenantId), eq(claimLines.claimId, claimId)))
      .orderBy(asc(claimLines.createdAt), asc(claimLines.id));
    const submissions = await transaction
      .select()
      .from(claimSubmissions)
      .where(
        and(
          eq(claimSubmissions.tenantId, principal.tenantId),
          eq(claimSubmissions.claimId, claimId),
        ),
      )
      .orderBy(asc(claimSubmissions.submissionNumber), asc(claimSubmissions.id));
    const decisions = await transaction
      .select()
      .from(claimDecisions)
      .where(
        and(eq(claimDecisions.tenantId, principal.tenantId), eq(claimDecisions.claimId, claimId)),
      )
      .orderBy(asc(claimDecisions.createdAt), asc(claimDecisions.id));
    const decisionIds = decisions.map((decision) => decision.id);
    const decisionLines = decisionIds.length
      ? await transaction
          .select()
          .from(claimDecisionLines)
          .where(
            and(
              eq(claimDecisionLines.tenantId, principal.tenantId),
              inArray(claimDecisionLines.decisionId, decisionIds),
            ),
          )
      : [];
    const packageDocuments = await transaction
      .select()
      .from(claimPackageDocuments)
      .where(
        and(
          eq(claimPackageDocuments.tenantId, principal.tenantId),
          eq(claimPackageDocuments.claimId, claimId),
        ),
      )
      .orderBy(asc(claimPackageDocuments.packageVersion), asc(claimPackageDocuments.documentKind));
    const payment = await this.paymentSummaryInTransaction(transaction, principal.tenantId, claim);
    return {
      claim,
      lines,
      submissions,
      decisions: decisions.map((decision) => ({
        ...decision,
        lines: decisionLines.filter((line) => line.decisionId === decision.id),
      })),
      packageDocuments: packageDocuments.map(packageDocumentView),
      payment,
    };
  }

  private async paymentSummaryInTransaction(
    transaction: DatabaseTransaction,
    tenantId: string,
    claim: typeof claims.$inferSelect,
  ) {
    const [decision] = await transaction
      .select({ acceptedCents: claimDecisions.acceptedCents })
      .from(claimDecisions)
      .where(and(eq(claimDecisions.tenantId, tenantId), eq(claimDecisions.claimId, claim.id)))
      .orderBy(desc(claimDecisions.createdAt), desc(claimDecisions.id))
      .limit(1);
    const rows = await transaction
      .select({ allocation: paymentAllocations, payment: payments, reversal: paymentReversals })
      .from(paymentAllocations)
      .innerJoin(
        payments,
        and(
          eq(payments.tenantId, paymentAllocations.tenantId),
          eq(payments.id, paymentAllocations.paymentId),
        ),
      )
      .leftJoin(
        paymentReversals,
        and(
          eq(paymentReversals.tenantId, paymentAllocations.tenantId),
          eq(paymentReversals.allocationId, paymentAllocations.id),
        ),
      )
      .where(
        and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.claimId, claim.id)),
      )
      .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
    const paidCents = rows.reduce(
      (total, row) => total + (row.reversal ? 0 : row.allocation.amountCents),
      0,
    );
    const acceptedCents = decision?.acceptedCents ?? 0;
    return {
      acceptedCents,
      paidCents,
      unpaidCents: Math.max(0, acceptedCents - paidCents),
      allocations: rows.map(({ allocation, payment, reversal }) => ({
        allocationId: allocation.id,
        paymentId: payment.id,
        paymentReference: payment.reference,
        amountCents: allocation.amountCents,
        allocatedAt: allocation.createdAt.toISOString(),
        reversedAt: reversal?.reversedAt.toISOString() ?? null,
      })),
    };
  }

  private async payerInScope(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    payerId: string,
    permission: Permission,
  ) {
    const [payer] = await transaction
      .select()
      .from(payers)
      .where(and(eq(payers.tenantId, principal.tenantId), eq(payers.id, payerId)))
      .limit(1);
    if (!payer) throw new PayerNotFoundError();
    this.requireScoped(principal, permission, {
      tenantId: principal.tenantId,
      organizationId: payer.organizationId,
    });
    return payer;
  }

  private requireScoped(
    principal: AuthorizationPrincipal,
    permission: Permission,
    resource: ResourceContext,
  ) {
    assertCan(principal, { action: permission, resource });
  }

  private listScope(principal: AuthorizationPrincipal, permission: Permission): SQL {
    const conditions: SQL[] = [];
    for (const grant of principal.grants) {
      if (grant.permission !== permission) continue;
      if (grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId) {
        return sql`true`;
      }
      if (grant.scopeType === 'organization') {
        conditions.push(eq(claims.organizationId, grant.scopeId));
      } else if (grant.scopeType === 'facility') {
        conditions.push(eq(claims.facilityId, grant.scopeId));
      }
    }
    return or(...conditions) ?? sql`false`;
  }

  private resourceForClaim(claim: typeof claims.$inferSelect): ResourceContext {
    return {
      tenantId: claim.tenantId,
      organizationId: claim.organizationId,
      facilityId: claim.facilityId,
      clientId: claim.clientId,
    };
  }

  private async recordLifecycle<T extends ClaimEventName>(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    context: AuditContext,
    input: {
      type: T;
      action: string;
      aggregateType: ClaimAggregateType;
      aggregateId: string;
      resourceType: string;
      metadata: Record<string, unknown>;
      payload: ClaimEventPayload<T>;
    },
  ) {
    const event = createDomainEvent({
      tenantId: principal.tenantId,
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload: input.payload,
    });
    await this.audit.append(
      transaction,
      this.auditRecord(principal, request, context, {
        id: event.id,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.aggregateId,
        metadata: input.metadata,
      }),
    );
    await this.outbox.enqueue(transaction, event);
  }

  private auditRecord(
    principal: AuthorizationPrincipal,
    request: RequestContext,
    context: AuditContext,
    input: {
      id?: string;
      action: string;
      resourceType: string;
      resourceId: string;
      metadata: Record<string, unknown>;
    },
  ) {
    return {
      id: input.id ?? uuidv7(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: new Date(),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(context.ip ? { ip: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      metadata: input.metadata,
    };
  }
}

export function createBillingClaimsApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  evidence: ServiceEvidenceApplicationService,
  documents: DocumentsApplicationService,
  storage: ObjectStorage,
): BillingClaimsApplicationService {
  return new BillingClaimsApplicationService(
    unitOfWork,
    audit,
    outbox,
    evidence,
    documents,
    storage,
  );
}

function validateCreateInput(input: CreateClaimInput): void {
  if (
    !isUuid(input.invoiceId) ||
    !Number.isSafeInteger(input.expectedInvoiceVersion) ||
    input.expectedInvoiceVersion < 1 ||
    !isUuid(input.payerArrangementId) ||
    (input.payerBillingProfileId != null && !isUuid(input.payerBillingProfileId)) ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > MAX_CLAIM_LINES
  ) {
    throw new ClaimSourceInvalidError();
  }
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (
      !isUuid(line.invoiceLineId) ||
      !Number.isSafeInteger(line.amountCents) ||
      line.amountCents <= 0 ||
      seen.has(line.invoiceLineId)
    ) {
      throw new ClaimSourceInvalidError();
    }
    seen.add(line.invoiceLineId);
  }
}

function validateSubmitInput(input: ClaimSubmitInput): void {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    (input.externalReference != null && input.externalReference.length > 160) ||
    (input.protectedNote != null && input.protectedNote.length > 2000)
  ) {
    throw new ClaimInvalidStateError();
  }
}

function validateDecisionInput(input: ClaimDecisionInput): void {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    (input.externalReference != null && input.externalReference.length > 160) ||
    (input.reasonCode != null && input.reasonCode.length > 80) ||
    (input.protectedExplanation != null && input.protectedExplanation.length > 4000) ||
    !Array.isArray(input.lines) ||
    input.lines.length > MAX_CLAIM_LINES
  ) {
    throw new ClaimDecisionInvalidError();
  }
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (!isUuid(line.claimLineId) || seen.has(line.claimLineId)) {
      throw new ClaimDecisionInvalidError();
    }
    seen.add(line.claimLineId);
  }
}

function packageDocumentView(
  row: typeof claimPackageDocuments.$inferSelect,
): ClaimPackageDocumentView {
  return {
    id: row.id,
    documentKind: row.documentKind,
    fileName: row.fileName,
    sha256: row.sha256,
    sourceVersion: row.sourceVersion,
    documentArtifactId: row.documentArtifactId,
    invoiceDocumentId: row.invoiceDocumentId,
  };
}

function evidenceDocumentPayload(
  facts: ClaimReadinessFacts,
  lines: readonly ClaimReadinessLineFact[],
): DocumentPayload {
  const evidencePackage = lines[0]?.evidencePackage;
  const acknowledgement = lines.find((line) => line.acknowledgement)?.acknowledgement ?? null;
  const invoiceSnapshot = snapshotRecord(facts.claim.invoiceSnapshot);
  const recipientName = snapshotText(invoiceSnapshot, 'clientName') || 'Client';
  const rows = lines.map(({ invoiceLine, claimLine }) => [
    invoiceLine?.serviceDate ?? '',
    snapshotText(claimLine.lineSnapshot, 'serviceCode'),
    snapshotText(claimLine.lineSnapshot, 'serviceName'),
    `${snapshotText(claimLine.lineSnapshot, 'quantity')} ${snapshotText(claimLine.lineSnapshot, 'unit')}`.trim(),
    formatEuro(claimLine.amountCents),
  ]);
  const packageSnapshot = evidencePackage?.snapshot as Record<string, unknown> | undefined;
  return {
    documentType: 'service_evidence',
    locale: 'de',
    title: 'Leistungsnachweis',
    subtitle: 'Abrechnungsbezogene Leistungsübersicht',
    provider: providerFromSnapshot(facts.invoice?.issuerSnapshot),
    recipient: { name: recipientName, addressLines: [] },
    metadata: [
      { label: 'Rechnungsnummer', value: snapshotText(invoiceSnapshot, 'invoiceNumber') || '—' },
      { label: 'Nachweisversion', value: String(evidencePackage?.version ?? '') },
      { label: 'Nachweishash', value: evidencePackage?.snapshotHash ?? '' },
    ],
    sections: [
      {
        title: 'Abgerechnete Betreuungsleistungen',
        columns: ['Datum', 'Leistungscode', 'Leistung', 'Umfang', 'Betrag'],
        rows,
      },
      {
        title: 'Bestätigung',
        paragraphs: [
          acknowledgement
            ? `Leistungsnachweis bestätigt am ${acknowledgement.acknowledgedAt?.toISOString() ?? '—'}.`
            : 'Für diese Leistung liegt keine aktuelle Bestätigung vor.',
          `Dokumentationsstand ${String(packageSnapshot?.documentationVersion ?? '')}; Nachweis unverändert durch Hash ${evidencePackage?.snapshotHash ?? ''}.`,
        ],
      },
    ],
    acknowledgements:
      acknowledgement && evidencePackage
        ? [
            {
              status: 'acknowledged',
              evidencePackageVersion: evidencePackage.version,
              evidencePackageHash: evidencePackage.snapshotHash,
              signatoryName: acknowledgement.signatoryNameSnapshot,
              method: acknowledgement.method,
              statementVersion: acknowledgement.statementVersion,
              statementText: acknowledgement.statementTextSnapshot,
              occurredAt: acknowledgement.acknowledgedAt?.toISOString() ?? null,
            },
          ]
        : [],
    notices: ['Auszug der für diese Abrechnung relevanten Leistungsangaben.'],
  };
}

function claimSummaryPayload(
  facts: ClaimReadinessFacts,
  packageVersion: number,
  manifestRows: readonly {
    kind: string;
    fileName: string;
    sha256: string;
    sourceVersion: string;
  }[],
): DocumentPayload {
  const claim = facts.claim;
  const invoiceSnapshot = snapshotRecord(claim.invoiceSnapshot);
  const payerSnapshot = snapshotRecord(claim.payerSnapshot);
  const clientName = snapshotText(invoiceSnapshot, 'clientName');
  const payerName = snapshotText(payerSnapshot, 'name');
  return {
    documentType: 'claim_summary',
    locale: 'de',
    title: 'Kostenträgerabrechnung',
    subtitle: `Abrechnungsfall ${claim.id}`,
    provider: providerFromSnapshot(facts.invoice?.issuerSnapshot),
    recipient: {
      name: payerName || clientName || 'Kostenträger',
      addressLines: snapshotText(payerSnapshot, 'addressText').split('\n').filter(Boolean),
      reference: snapshotText(payerSnapshot, 'payerIdentifier') || null,
    },
    metadata: [
      { label: 'Kunde', value: clientName || '—' },
      { label: 'Kostenträger', value: payerName || '—' },
      { label: 'Rechnungsnummer', value: snapshotText(invoiceSnapshot, 'invoiceNumber') || '—' },
      { label: 'Einreichungsweg', value: claim.channel ?? 'Nicht konfiguriert' },
      { label: 'Paketversion', value: String(packageVersion) },
      {
        label: 'Leistungszeitraum',
        value: `${snapshotText(invoiceSnapshot, 'servicePeriodFrom')} – ${snapshotText(invoiceSnapshot, 'servicePeriodUntil')}`,
      },
    ],
    sections: [
      {
        title: 'Abgerechnete Leistungsanteile',
        columns: ['Datum', 'Code', 'Leistung', 'Finanzierungsart', 'Betrag'],
        rows: facts.lines.map(({ claimLine, invoiceLine }) => [
          invoiceLine?.serviceDate ?? '',
          snapshotText(claimLine.lineSnapshot, 'serviceCode'),
          snapshotText(claimLine.lineSnapshot, 'serviceName'),
          snapshotText(claimLine.lineSnapshot, 'fundingSourceType'),
          formatEuro(claimLine.amountCents),
        ]),
      },
      {
        title: 'Enthaltene Unterlagen und Prüfsummen',
        columns: ['Unterlage', 'Datei', 'SHA-256', 'Quellstand'],
        rows: manifestRows.map((row) => [row.kind, row.fileName, row.sha256, row.sourceVersion]),
      },
    ],
    totals: [
      { label: 'Beantragter Betrag', value: formatEuro(claim.amountCents), emphasized: true },
    ],
    notices: [
      'Manuell einzureichendes Unterlagenpaket. Keine elektronische Übermittlung oder Eingangsbestätigung wird behauptet.',
    ],
  };
}

function providerFromSnapshot(snapshot: unknown): DocumentPayload['provider'] {
  const record = snapshotRecord(snapshot);
  const addressLines = Array.isArray(record.addressLines)
    ? record.addressLines.filter((line): line is string => typeof line === 'string')
    : snapshotText(record, 'addressText').split('\n').filter(Boolean);
  return {
    name:
      snapshotText(record, 'providerName') ||
      snapshotText(record, 'name') ||
      snapshotText(record, 'organizationName') ||
      'Betreuungsdienst',
    addressLines,
    phone: snapshotText(record, 'phone') || null,
    email: snapshotText(record, 'email') || null,
  };
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function snapshotText(value: unknown, key: string): string {
  const field = snapshotRecord(value)[key];
  return typeof field === 'string' ? field : '';
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ClaimSourceInvalidError();
  }
  return value;
}

function hashCanonical(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13)}`;
  const variant = ((Number.parseInt(versioned[16]!, 16) & 0x3) | 0x8).toString(16);
  const normalized = `${versioned.slice(0, 16)}${variant}${versioned.slice(17)}`;
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatEuro(amountCents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    amountCents / 100,
  );
}
