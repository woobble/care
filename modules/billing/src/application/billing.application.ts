import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { BenefitBillingAllocation, BenefitsApplicationService } from '@care/benefits';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { clientAddresses, clientInsurances, clientRecords } from '@care/clients';
import { facilities, organizationsTable } from '@care/organizations';
import { assertCan, can } from '@care/permissions';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { ObjectStorage } from '@care/storage';
import type { DocumentsApplicationService } from '@care/documents';
import { ExportFilterInvalidError, ExportRowLimitExceededError } from '@care/documents';
import { visits } from '@care/scheduling';
import type { ServiceEvidenceApplicationService } from '@care/service-evidence';
import { payers } from '@module/billing/claims/payer-schema';
import { claims, claimDecisions } from '@module/billing/claims/schema';
import { ClaimPaymentAmountExceededError } from '@module/billing/claims/domain';
import {
  calculateInvoiceAmounts,
  calculateServiceAmountCents,
  deriveReceivableStatus,
  formatCorrectionNumber,
  formatInvoiceNumber,
  hasRequiredTaxIdentifier,
  assertAvailableAmount,
  BillingCandidateNotReadyError,
  BillingClientNotFoundError,
  BillingFundingNotResolvedError,
  BillingProfileVersionConflictError,
  InvoiceEvidenceOutdatedError,
  InvoiceFormatUnsupportedError,
  InvoiceIssuerIncompleteError,
  InvoiceNumberConflictError,
  InvoiceNotFoundError,
  InvoicePdfNotReadyError,
  InvoiceRecipientInvalidError,
  InvoiceVersionConflictError,
  InvalidBillingProfileError,
  InvalidInvoiceAmountError,
  InvalidInvoiceCorrectionError,
  InvalidPayerArrangementError,
  InvoiceInvalidStateError,
  PayerArrangementNotFoundError,
  PaymentAllocationExceededError,
  PaymentAmountInvalidError,
  PaymentNotFoundError,
  PaymentReversalConflictError,
  assertCorrectionAmount,
  assertPaymentAllocation,
  type ReceivableStatus,
  type TaxTreatment,
} from '@module/billing/domain/billing';
import {
  billingProfiles,
  invoiceCorrectionLines,
  invoiceCorrections,
  invoiceDocuments,
  invoiceLines,
  invoiceNumberSequences,
  invoiceNumbers,
  invoices,
  payerArrangements,
  paymentAllocations,
  paymentReversals,
  payments,
} from '@module/billing/schema';
import { performedServices, visitExecutions } from '@care/visit-execution';
import { ServicePriceApplicationService } from '@care/services';
import type { ServicePricingUnit } from '@care/services';
import {
  BillingPdfRenderer,
  type CorrectionPdfData,
  type InvoicePdfData,
} from '@module/billing/infrastructure/invoice-pdf';

type AuditContext = { ip?: string; userAgent?: string };
type BillingPermission = Extract<Permission, `billing.${string}`>;

export interface BillingProfileInput {
  organizationId: string;
  taxNumber?: string | null;
  vatId?: string | null;
  creditorIdentifier?: string | null;
  bankAccountHolder?: string | null;
  iban?: string | null;
  bic?: string | null;
  paymentTermsDays: number;
  invoiceNumberPrefix: string;
  defaultCurrency: 'EUR';
  taxTreatment: TaxTreatment;
  taxRateBasisPoints?: number | null;
  taxExemptionBasis?: string | null;
  requireAcknowledgement: boolean;
  requiredInvoiceFormat: 'pdf' | 'structured';
  expectedVersion?: number;
}

export interface PayerArrangementInput {
  organizationId: string;
  clientId: string;
  fundingSourceId?: string | null;
  clientInsuranceId?: string | null;
  payerId?: string | null;
  mandateDocumentArtifactId?: string | null;
  payerType: 'statutory_insurance' | 'private_insurance' | 'self_pay' | 'other';
  payerReference?: string | null;
  arrangementType: 'direct_payer_billing' | 'reimbursement_to_client' | 'other';
  recipientType: 'client' | 'insurance' | 'contact' | 'other';
  recipientName?: string | null;
  recipientAddress?: string | null;
  mandateStatus: 'authorized' | 'pending' | 'revoked' | 'not_applicable';
  documentedSource?: string | null;
  documentedReference?: string | null;
  validFrom: string;
  validUntil?: string | null;
}

export interface PayerArrangementUpdateInput {
  expectedVersion: number;
  mandateStatus: 'authorized' | 'pending' | 'revoked' | 'not_applicable';
  validUntil?: string | null;
  documentedSource?: string | null;
  documentedReference?: string | null;
  payerId?: string | null;
  mandateDocumentArtifactId?: string | null;
}

export interface CandidateQuery {
  from?: string;
  until?: string;
  organizationId?: string;
  clientId?: string;
  facilityId?: string;
  fundingSourceId?: string;
  ready?: boolean;
  evidenceStatus?: string;
}

export interface BillingCandidateView {
  id: string;
  sourceKey: string;
  performedServiceId: string;
  visitId: string;
  clientId: string;
  clientName: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  serviceDate: string;
  quantity: string;
  unit: 'occurrence' | 'minute' | 'hour' | 'day';
  pricingUnit: ServicePricingUnit | null;
  servicePriceId: string | null;
  unitPriceCents: number | null;
  serviceAmountCents: number | null;
  fundingAllocationId: string | null;
  fundingSourceId: string | null;
  fundingLabel: string | null;
  fundingStatus: 'confirmed' | 'provisional' | null;
  amountCents: number | null;
  amountAlreadyBilledCents: number;
  amountReservedCents: number;
  remainingBillableAmountCents: number;
  recommendedRecipient: 'client' | 'payer';
  recommendedPayerArrangementId: string | null;
  evidencePackageId: string | null;
  evidenceSnapshotHash: string | null;
  evidenceStatus: string;
  ready: boolean;
  blockers: string[];
}

export interface InvoiceLineSelection {
  performedServiceId: string;
  fundingAllocationId?: string | null;
  amountCents: number;
}

export interface DraftInvoiceInput {
  organizationId: string;
  facilityId: string;
  clientId: string;
  recipientType: 'client' | 'payer';
  payerArrangementId?: string | null;
  lines: InvoiceLineSelection[];
}

export interface DraftInvoiceUpdateInput extends DraftInvoiceInput {
  expectedVersion: number;
}

export interface IssueInvoiceInput {
  expectedVersion: number;
}

export interface InvoiceCorrectionInput {
  reason: string;
  lines: Array<{ invoiceLineId: string; amountCents: number }>;
}

export interface PaymentAllocationInput {
  paymentId: string;
  invoiceId: string;
  claimId?: string | null;
  amountCents: number;
}

export interface BillingPaymentView {
  id: string;
  organizationId: string;
  payerReference: string | null;
  payerNameSnapshot: string | null;
  amountCents: number;
  currency: 'EUR';
  receivedAt: Date;
  method: 'bank_transfer' | 'cash' | 'other';
  reference: string | null;
  allocatedCents: number;
  remainingCents: number;
  allocationHistory: Array<{
    allocationId: string;
    invoiceId: string;
    invoiceNumber: string | null;
    amountCents: number;
    allocatedAt: Date;
    reversedAt: Date | null;
    reversalReason: string | null;
  }>;
}

export interface BillingInvoiceView {
  id: string;
  organizationId: string;
  facilityId: string;
  clientId: string;
  clientName: string;
  recipientName: string | null;
  recipientAddress: string | null;
  payerArrangementId: string | null;
  recipientType: 'client' | 'payer';
  invoiceNumber: string | null;
  issueDate: string | null;
  servicePeriodFrom: string | null;
  servicePeriodUntil: string | null;
  dueDate: string | null;
  currency: 'EUR';
  subtotalCents: number;
  taxTotalCents: number;
  grandTotalCents: number;
  status: 'draft' | 'issued' | 'cancelled';
  version: number;
  issuerSnapshot: Record<string, unknown> | null;
  recipientSnapshot: Record<string, unknown> | null;
  lines: Array<typeof invoiceLines.$inferSelect>;
  corrections: Array<typeof invoiceCorrections.$inferSelect>;
  paymentHistory: Array<{
    allocationId: string;
    paymentId: string;
    amountCents: number;
    allocatedAt: Date;
    method: 'bank_transfer' | 'cash' | 'other';
    receivedAt: Date;
    reference: string | null;
    payerNameSnapshot: string | null;
    reversedAt: Date | null;
    reversalReason: string | null;
  }>;
  pdfStatus: 'pending' | 'ready' | 'failed' | null;
  receivableStatus: ReceivableStatus | null;
  outstandingCents: number | null;
  evidenceDiscrepancy: boolean;
}

export interface BillingExportFilters {
  from: string;
  until: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  status?: 'draft' | 'issued' | 'cancelled';
  recipientType?: 'client' | 'payer';
  fundingType?: string;
}

export interface RecordPaymentInput {
  organizationId: string;
  payerReference?: string | null;
  payerName?: string | null;
  amountCents: number;
  receivedAt: string;
  method: 'bank_transfer' | 'cash' | 'other';
  reference?: string | null;
}

export class BillingApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly storage: ObjectStorage,
    private readonly prices: ServicePriceApplicationService,
    private readonly benefits: BenefitsApplicationService,
    private readonly evidence: ServiceEvidenceApplicationService,
    private readonly documents?: Pick<
      DocumentsApplicationService,
      'renderingConfiguration' | 'artifactForSourceAuthorization'
    >,
  ) {}

  private readonly pdfRenderer = new BillingPdfRenderer();

  async settings(principal: AuthorizationPrincipal) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          organizationId: organizationsTable.id,
          organizationName: organizationsTable.name,
          organizationAddress: organizationsTable.address,
          legalName: organizationsTable.legalName,
          address: organizationsTable.address,
          profile: billingProfiles,
        })
        .from(organizationsTable)
        .leftJoin(
          billingProfiles,
          and(
            eq(billingProfiles.tenantId, organizationsTable.tenantId),
            eq(billingProfiles.organizationId, organizationsTable.id),
          ),
        )
        .where(eq(organizationsTable.tenantId, principal.tenantId))
        .orderBy(asc(organizationsTable.name));
      return rows
        .filter((row) =>
          can(principal, {
            action: 'billing.read',
            resource: { tenantId: principal.tenantId, organizationId: row.organizationId },
          }),
        )
        .map((row) => ({ ...row, profile: row.profile ?? null }));
    });
  }

  async saveSettings(
    principal: AuthorizationPrincipal,
    input: BillingProfileInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    this.requireOrganization(principal, 'billing.settings.manage', input.organizationId);
    this.validateProfileInput(input);
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
      if (!organization) throw new BillingClientNotFoundError();

      const [existing] = await transaction
        .select()
        .from(billingProfiles)
        .where(
          and(
            eq(billingProfiles.tenantId, principal.tenantId),
            eq(billingProfiles.organizationId, input.organizationId),
          ),
        )
        .for('update')
        .limit(1);
      if (existing && input.expectedVersion !== existing.version) {
        throw new BillingProfileVersionConflictError();
      }
      if (!existing && input.expectedVersion !== undefined) {
        throw new BillingProfileVersionConflictError();
      }

      const now = new Date();
      const profileId = existing?.id ?? uuidv7();
      const version = (existing?.version ?? 0) + 1;
      const values = {
        id: profileId,
        tenantId: principal.tenantId,
        organizationId: input.organizationId,
        taxNumber: optionalText(input.taxNumber),
        vatId: optionalText(input.vatId),
        creditorIdentifier: optionalText(input.creditorIdentifier),
        bankAccountHolder: optionalText(input.bankAccountHolder),
        iban: normalizeIban(input.iban),
        bic: normalizeBic(input.bic),
        paymentTermsDays: input.paymentTermsDays,
        invoiceNumberPrefix: input.invoiceNumberPrefix.trim(),
        defaultCurrency: 'EUR' as const,
        taxTreatment: input.taxTreatment,
        taxRateBasisPoints:
          input.taxTreatment === 'taxable' ? (input.taxRateBasisPoints ?? null) : null,
        taxExemptionBasis:
          input.taxTreatment === 'taxable' ? null : optionalText(input.taxExemptionBasis),
        requireAcknowledgement: input.requireAcknowledgement,
        requiredInvoiceFormat: input.requiredInvoiceFormat,
        version,
        createdBy: existing?.createdBy ?? principal.userId,
        updatedBy: principal.userId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const [profile] = existing
        ? await transaction
            .update(billingProfiles)
            .set(values)
            .where(
              and(
                eq(billingProfiles.tenantId, principal.tenantId),
                eq(billingProfiles.id, existing.id),
              ),
            )
            .returning()
        : await transaction.insert(billingProfiles).values(values).returning();

      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'billing.profile.updated',
        aggregateType: 'billing_profile',
        aggregateId: profileId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { profileId, organizationId: input.organizationId, version },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'billing.profile_updated',
          resourceType: 'billing_profile',
          resourceId: profileId,
          metadata: { organizationId: input.organizationId, version },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return profile;
    });
  }

  async payerArrangements(
    principal: AuthorizationPrincipal,
    input: { clientId: string; organizationId?: string },
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [client] = await transaction
        .select({
          organizationId: clientRecords.organizationId,
          facilityId: clientRecords.primaryFacilityId,
        })
        .from(clientRecords)
        .where(
          and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, input.clientId)),
        )
        .limit(1);
      if (!client) throw new BillingClientNotFoundError();
      const organizationId = input.organizationId ?? client.organizationId;
      if (!organizationId) throw new InvoiceRecipientInvalidError();
      this.requireClient(
        principal,
        'billing.read',
        input.clientId,
        organizationId,
        client.facilityId,
      );
      const rows = await transaction
        .select()
        .from(payerArrangements)
        .where(
          and(
            eq(payerArrangements.tenantId, principal.tenantId),
            eq(payerArrangements.clientId, input.clientId),
            eq(payerArrangements.organizationId, organizationId),
          ),
        )
        .orderBy(desc(payerArrangements.validFrom), asc(payerArrangements.createdAt));
      return rows;
    });
  }

  async createPayerArrangement(
    principal: AuthorizationPrincipal,
    input: PayerArrangementInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    this.requireClient(principal, 'billing.settings.manage', input.clientId, input.organizationId);
    this.validatePayerArrangement(input);
    if (input.mandateDocumentArtifactId) {
      const documents = this.documents;
      if (!documents) throw new InvalidPayerArrangementError();
      const artifact = await documents.artifactForSourceAuthorization(
        principal,
        input.mandateDocumentArtifactId,
      );
      if (
        artifact.organizationId !== input.organizationId ||
        artifact.clientId !== input.clientId ||
        (artifact.status !== 'ready' && artifact.status !== 'superseded')
      ) {
        throw new InvalidPayerArrangementError();
      }
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [client] = await transaction
        .select({
          organizationId: clientRecords.organizationId,
          facilityId: clientRecords.primaryFacilityId,
        })
        .from(clientRecords)
        .where(
          and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, input.clientId)),
        )
        .limit(1);
      if (!client || client.organizationId !== input.organizationId) {
        throw new BillingClientNotFoundError();
      }
      const payerId = optionalText(input.payerId);
      if (payerId) {
        const [payer] = await transaction
          .select()
          .from(payers)
          .where(
            and(
              eq(payers.tenantId, principal.tenantId),
              eq(payers.organizationId, input.organizationId),
              eq(payers.id, payerId),
              eq(payers.status, 'active'),
            ),
          )
          .limit(1);
        if (!payer || !payerMatchesArrangementType(payer.payerType, input.payerType)) {
          throw new InvalidPayerArrangementError();
        }
      }
      let fundingSourceId = input.fundingSourceId ?? null;
      let clientInsuranceId = input.clientInsuranceId ?? null;
      let payerReference = optionalText(input.payerReference);
      if (fundingSourceId) {
        const source = await this.benefits.fundingSourceForBilling(
          transaction,
          principal.tenantId,
          input.clientId,
          fundingSourceId,
        );
        if (!source) throw new InvalidPayerArrangementError();
        if (clientInsuranceId && source.clientInsuranceId !== clientInsuranceId) {
          throw new InvalidPayerArrangementError();
        }
        clientInsuranceId ??= source.clientInsuranceId;
      }
      if (clientInsuranceId) {
        const [insurance] = await transaction
          .select()
          .from(clientInsurances)
          .where(
            and(
              eq(clientInsurances.tenantId, principal.tenantId),
              eq(clientInsurances.clientId, input.clientId),
              eq(clientInsurances.id, clientInsuranceId),
            ),
          )
          .limit(1);
        if (!insurance) throw new InvalidPayerArrangementError();
        if (!payerReference) payerReference = insurance.insuranceNumber ?? insurance.memberNumber;
      }
      const id = uuidv7();
      const now = new Date();
      const [arrangement] = await transaction
        .insert(payerArrangements)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          clientId: input.clientId,
          payerId,
          fundingSourceId,
          clientInsuranceId,
          mandateDocumentArtifactId: optionalText(input.mandateDocumentArtifactId),
          payerType: input.payerType,
          payerReference,
          arrangementType: input.arrangementType,
          recipientType: input.recipientType,
          recipientName:
            input.recipientType === 'client' ? null : optionalText(input.recipientName),
          recipientAddress:
            input.recipientType === 'client' ? null : optionalText(input.recipientAddress),
          mandateStatus: input.mandateStatus,
          documentedSource: optionalText(input.documentedSource),
          documentedReference: optionalText(input.documentedReference),
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          version: 1,
          createdBy: principal.userId,
          updatedBy: principal.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'billing.payer_arrangement.created',
        aggregateType: 'payer_arrangement',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          arrangementId: id,
          clientId: input.clientId,
          organizationId: input.organizationId,
          arrangementType: input.arrangementType,
        },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'billing.payer_arrangement_created',
          resourceType: 'payer_arrangement',
          resourceId: id,
          metadata: {
            clientId: input.clientId,
            organizationId: input.organizationId,
            arrangementType: input.arrangementType,
            mandateStatus: input.mandateStatus,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return arrangement;
    });
  }

  async updatePayerArrangement(
    principal: AuthorizationPrincipal,
    arrangementId: string,
    input: PayerArrangementUpdateInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw new InvalidPayerArrangementError();
    if (input.mandateDocumentArtifactId) {
      const [current] = await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) =>
          transaction
            .select({
              organizationId: payerArrangements.organizationId,
              clientId: payerArrangements.clientId,
            })
            .from(payerArrangements)
            .where(
              and(
                eq(payerArrangements.tenantId, principal.tenantId),
                eq(payerArrangements.id, arrangementId),
              ),
            )
            .limit(1),
      );
      if (!current) throw new PayerArrangementNotFoundError();
      const documents = this.documents;
      if (!documents) throw new InvalidPayerArrangementError();
      const artifact = await documents.artifactForSourceAuthorization(
        principal,
        input.mandateDocumentArtifactId,
      );
      if (
        artifact.organizationId !== current.organizationId ||
        artifact.clientId !== current.clientId ||
        (artifact.status !== 'ready' && artifact.status !== 'superseded')
      ) {
        throw new InvalidPayerArrangementError();
      }
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [arrangement] = await transaction
        .select()
        .from(payerArrangements)
        .where(
          and(
            eq(payerArrangements.tenantId, principal.tenantId),
            eq(payerArrangements.id, arrangementId),
          ),
        )
        .for('update')
        .limit(1);
      if (!arrangement) throw new PayerArrangementNotFoundError();
      this.requireClient(
        principal,
        'billing.settings.manage',
        arrangement.clientId,
        arrangement.organizationId,
      );
      if (arrangement.version !== input.expectedVersion)
        throw new BillingProfileVersionConflictError();
      const payerId =
        input.payerId === undefined ? arrangement.payerId : optionalText(input.payerId);
      if (payerId) {
        const [payer] = await transaction
          .select()
          .from(payers)
          .where(
            and(
              eq(payers.tenantId, principal.tenantId),
              eq(payers.organizationId, arrangement.organizationId),
              eq(payers.id, payerId),
              eq(payers.status, 'active'),
            ),
          )
          .limit(1);
        if (!payer || !payerMatchesArrangementType(payer.payerType, arrangement.payerType)) {
          throw new InvalidPayerArrangementError();
        }
      }
      const mandateDocumentArtifactId =
        input.mandateDocumentArtifactId === undefined
          ? arrangement.mandateDocumentArtifactId
          : optionalText(input.mandateDocumentArtifactId);
      const validUntil = input.validUntil === undefined ? arrangement.validUntil : input.validUntil;
      const documentedSource =
        input.documentedSource === undefined
          ? arrangement.documentedSource
          : optionalText(input.documentedSource);
      const documentedReference =
        input.documentedReference === undefined
          ? arrangement.documentedReference
          : optionalText(input.documentedReference);
      if (
        !['authorized', 'pending', 'revoked', 'not_applicable'].includes(input.mandateStatus) ||
        (validUntil !== null && (!isIsoDate(validUntil) || validUntil < arrangement.validFrom)) ||
        (arrangement.arrangementType === 'direct_payer_billing' &&
          input.mandateStatus === 'authorized' &&
          (!documentedSource || !documentedReference || arrangement.recipientType === 'client'))
      )
        throw new InvalidPayerArrangementError();
      const now = new Date();
      const [updated] = await transaction
        .update(payerArrangements)
        .set({
          payerId,
          mandateDocumentArtifactId,
          mandateStatus: input.mandateStatus,
          validUntil,
          documentedSource,
          documentedReference,
          version: arrangement.version + 1,
          updatedBy: principal.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(payerArrangements.tenantId, principal.tenantId),
            eq(payerArrangements.id, arrangement.id),
          ),
        )
        .returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'billing.payer_arrangement.updated',
        aggregateType: 'payer_arrangement',
        aggregateId: arrangement.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          arrangementId: arrangement.id,
          clientId: arrangement.clientId,
          version: updated!.version,
          mandateStatus: updated!.mandateStatus,
        },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'billing.payer_arrangement_updated',
          resourceType: 'payer_arrangement',
          resourceId: arrangement.id,
          metadata: {
            version: updated!.version,
            mandateStatus: updated!.mandateStatus,
            validUntil: updated!.validUntil,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return updated!;
    });
  }

  async candidates(
    principal: AuthorizationPrincipal,
    query: CandidateQuery = {},
  ): Promise<BillingCandidateView[]> {
    const today = currentDate();
    const from = query.from ?? addDays(today, -90);
    const until = query.until ?? today;
    if (!isIsoDate(from) || !isIsoDate(until) || from > until) {
      throw new InvalidBillingProfileError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const serviceDateExpression = sql<string>`(${visitExecutions.actualStart} AT TIME ZONE ${visits.timezone})::date::text`;
      const where = [
        eq(performedServices.tenantId, principal.tenantId),
        eq(visitExecutions.status, 'completed'),
        inArray(performedServices.status, ['performed', 'partially_performed']),
        gte(serviceDateExpression, from),
        lte(serviceDateExpression, until),
      ];
      if (query.organizationId) where.push(eq(visits.organizationId, query.organizationId));
      if (query.clientId) where.push(eq(visits.clientId, query.clientId));
      if (query.facilityId) where.push(eq(visits.facilityId, query.facilityId));
      const rows = await transaction
        .select({
          performedServiceId: performedServices.id,
          visitId: performedServices.visitId,
          executionId: performedServices.executionId,
          serviceId: performedServices.serviceDefinitionId,
          serviceCode: performedServices.serviceCodeSnapshot,
          serviceName: performedServices.serviceNameSnapshot,
          unit: performedServices.unitSnapshot,
          actualQuantity: performedServices.actualQuantity,
          status: performedServices.status,
          clientId: visits.clientId,
          clientFirstName: clientRecords.firstName,
          clientPreferredName: clientRecords.preferredName,
          clientLastName: clientRecords.lastName,
          organizationId: visits.organizationId,
          organizationName: organizationsTable.name,
          organizationAddress: organizationsTable.address,
          facilityId: visits.facilityId,
          facilityName: facilities.name,
          timezone: visits.timezone,
          actualStart: visitExecutions.actualStart,
          serviceDate: serviceDateExpression.as('service_date'),
        })
        .from(performedServices)
        .innerJoin(
          visitExecutions,
          and(
            eq(visitExecutions.tenantId, performedServices.tenantId),
            eq(visitExecutions.id, performedServices.executionId),
            eq(visitExecutions.visitId, performedServices.visitId),
          ),
        )
        .innerJoin(
          visits,
          and(
            eq(visits.tenantId, performedServices.tenantId),
            eq(visits.id, performedServices.visitId),
          ),
        )
        .innerJoin(
          clientRecords,
          and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
        )
        .innerJoin(
          organizationsTable,
          and(
            eq(organizationsTable.tenantId, visits.tenantId),
            eq(organizationsTable.id, visits.organizationId),
          ),
        )
        .innerJoin(
          facilities,
          and(
            eq(facilities.tenantId, visits.tenantId),
            eq(facilities.organizationId, visits.organizationId),
            eq(facilities.id, visits.facilityId),
          ),
        )
        .where(and(...where))
        .orderBy(asc(serviceDateExpression), asc(performedServices.id))
        .limit(1000);
      const output: BillingCandidateView[] = [];
      const profiles = new Map<string, typeof billingProfiles.$inferSelect | null>();
      for (const row of rows) {
        const resource = {
          tenantId: principal.tenantId,
          clientId: row.clientId,
          organizationId: row.organizationId,
          facilityId: row.facilityId,
        };
        if (!can(principal, { action: 'billing.read', resource })) continue;
        let profile = profiles.get(row.organizationId);
        if (profile === undefined) {
          profile = await this.profileForOrganization(
            transaction,
            principal.tenantId,
            row.organizationId,
          );
          profiles.set(row.organizationId, profile);
        }
        output.push(...(await this.candidatesForService(transaction, principal, row, profile)));
      }
      return output.filter(
        (candidate) =>
          (query.fundingSourceId === undefined ||
            candidate.fundingSourceId === query.fundingSourceId) &&
          (query.ready === undefined || candidate.ready === query.ready) &&
          (query.evidenceStatus === undefined || candidate.evidenceStatus === query.evidenceStatus),
      );
    });
  }

  async createDraft(
    principal: AuthorizationPrincipal,
    input: DraftInvoiceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingInvoiceView> {
    this.requireClient(
      principal,
      'billing.manage',
      input.clientId,
      input.organizationId,
      input.facilityId,
    );
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const prepared = await this.prepareDraft(transaction, principal, input);
      const id = uuidv7();
      const now = new Date();
      const [invoice] = await transaction
        .insert(invoices)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          facilityId: input.facilityId,
          clientId: input.clientId,
          payerArrangementId:
            input.recipientType === 'payer' ? (input.payerArrangementId ?? null) : null,
          recipientType: input.recipientType,
          recipientSnapshot: null,
          issuerSnapshot: null,
          invoiceNumber: null,
          issueDate: null,
          servicePeriodFrom: prepared.servicePeriodFrom,
          servicePeriodUntil: prepared.servicePeriodUntil,
          dueDate: null,
          currency: 'EUR',
          subtotalCents: prepared.subtotalCents,
          taxTotalCents: prepared.taxTotalCents,
          grandTotalCents: prepared.grandTotalCents,
          status: 'draft',
          version: 1,
          createdBy: principal.userId,
          issuedBy: null,
          issuedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const lineValues = prepared.lineValues.map((line) => ({
        ...line,
        tenantId: principal.tenantId,
        invoiceId: id,
      }));
      const lines = await transaction.insert(invoiceLines).values(lineValues).returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'invoice.created',
        aggregateType: 'invoice',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { invoiceId: id, clientId: input.clientId, organizationId: input.organizationId },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'invoice.created',
          resourceType: 'invoice',
          resourceId: id,
          metadata: {
            clientId: input.clientId,
            organizationId: input.organizationId,
            lineCount: lines.length,
            grandTotalCents: prepared.grandTotalCents,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return this.invoiceView(transaction, principal, invoice!, lines);
    });
  }

  async updateDraft(
    principal: AuthorizationPrincipal,
    invoiceId: string,
    input: DraftInvoiceUpdateInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingInvoiceView> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
      this.requireClient(
        principal,
        'billing.manage',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      if (invoice.status !== 'draft') throw new InvoiceInvalidStateError();
      if (invoice.version !== input.expectedVersion) throw new InvoiceVersionConflictError();
      if (
        invoice.organizationId !== input.organizationId ||
        invoice.facilityId !== input.facilityId ||
        invoice.clientId !== input.clientId
      ) {
        throw new InvoiceRecipientInvalidError();
      }
      const prepared = await this.prepareDraft(transaction, principal, input, invoiceId);
      await transaction
        .delete(invoiceLines)
        .where(
          and(eq(invoiceLines.tenantId, principal.tenantId), eq(invoiceLines.invoiceId, invoiceId)),
        );
      const lines = await transaction
        .insert(invoiceLines)
        .values(
          prepared.lineValues.map((line) => ({ ...line, tenantId: principal.tenantId, invoiceId })),
        )
        .returning();
      const [updated] = await transaction
        .update(invoices)
        .set({
          payerArrangementId:
            input.recipientType === 'payer' ? (input.payerArrangementId ?? null) : null,
          recipientType: input.recipientType,
          servicePeriodFrom: prepared.servicePeriodFrom,
          servicePeriodUntil: prepared.servicePeriodUntil,
          subtotalCents: prepared.subtotalCents,
          taxTotalCents: prepared.taxTotalCents,
          grandTotalCents: prepared.grandTotalCents,
          version: invoice.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, invoiceId)))
        .returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'invoice.updated',
        aggregateType: 'invoice',
        aggregateId: invoiceId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { invoiceId, version: updated!.version, changedFields: ['lines', 'recipient'] },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'invoice.updated',
          resourceType: 'invoice',
          resourceId: invoiceId,
          metadata: {
            version: updated!.version,
            lineCount: lines.length,
            grandTotalCents: updated!.grandTotalCents,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return this.invoiceView(transaction, principal, updated!, lines);
    });
  }

  async cancelDraft(
    principal: AuthorizationPrincipal,
    invoiceId: string,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingInvoiceView> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
      this.requireClient(
        principal,
        'billing.manage',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      if (invoice.status !== 'draft') throw new InvoiceInvalidStateError();
      const [cancelled] = await transaction
        .update(invoices)
        .set({ status: 'cancelled', version: invoice.version + 1, updatedAt: new Date() })
        .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, invoiceId)))
        .returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'invoice.cancelled',
        aggregateType: 'invoice',
        aggregateId: invoiceId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { invoiceId, clientId: invoice.clientId, reason: 'draft_cancelled' },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'invoice.cancelled',
          resourceType: 'invoice',
          resourceId: invoiceId,
          metadata: { status: 'cancelled' },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      const lines = await transaction
        .select()
        .from(invoiceLines)
        .where(
          and(eq(invoiceLines.tenantId, principal.tenantId), eq(invoiceLines.invoiceId, invoiceId)),
        )
        .orderBy(asc(invoiceLines.serviceDate), asc(invoiceLines.createdAt));
      return this.invoiceView(transaction, principal, cancelled!, lines);
    });
  }

  async listInvoices(
    principal: AuthorizationPrincipal,
    query: {
      organizationId?: string;
      clientId?: string;
      status?: 'draft' | 'issued' | 'cancelled';
      from?: string;
      until?: string;
      facilityId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<BillingInvoiceView[]> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidBillingProfileError();
    }
    if (query.organizationId)
      this.requireOrganization(principal, 'billing.read', query.organizationId);
    if (query.clientId && query.organizationId) {
      this.requireClient(principal, 'billing.read', query.clientId, query.organizationId);
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const where = [eq(invoices.tenantId, principal.tenantId)];
      if (query.organizationId) where.push(eq(invoices.organizationId, query.organizationId));
      if (query.facilityId) where.push(eq(invoices.facilityId, query.facilityId));
      if (query.clientId) where.push(eq(invoices.clientId, query.clientId));
      if (query.status) where.push(eq(invoices.status, query.status));
      if (query.from) where.push(gte(invoices.issueDate, query.from));
      if (query.until) where.push(lte(invoices.issueDate, query.until));
      const rows = await transaction
        .select()
        .from(invoices)
        .where(and(...where))
        .orderBy(desc(invoices.createdAt), desc(invoices.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const result: BillingInvoiceView[] = [];
      for (const invoice of rows) {
        if (
          !can(principal, {
            action: 'billing.read',
            resource: {
              tenantId: principal.tenantId,
              clientId: invoice.clientId,
              organizationId: invoice.organizationId,
              facilityId: invoice.facilityId,
            },
          })
        )
          continue;
        result.push(await this.invoiceView(transaction, principal, invoice));
      }
      return result;
    });
  }

  async getInvoice(
    principal: AuthorizationPrincipal,
    invoiceId: string,
  ): Promise<BillingInvoiceView> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
      this.requireClient(
        principal,
        'billing.read',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      return this.invoiceView(transaction, principal, invoice);
    });
  }

  async exportInvoices(
    principal: AuthorizationPrincipal,
    filters: BillingExportFilters,
  ): Promise<BillingInvoiceView[]> {
    const invoices = await this.exportInvoiceViews(principal, filters, false);
    if (filters.fundingType) {
      return invoices.filter((invoice) =>
        invoice.lines.some((line) => line.fundingLabelSnapshot === filters.fundingType),
      );
    }
    return invoices;
  }

  async exportInvoiceLines(
    principal: AuthorizationPrincipal,
    filters: BillingExportFilters,
  ): Promise<Array<{ invoice: BillingInvoiceView; line: typeof invoiceLines.$inferSelect }>> {
    const invoices = await this.exportInvoiceViews(principal, filters, false);
    const rows = invoices.flatMap((invoice) =>
      invoice.lines
        .filter((line) => !filters.fundingType || line.fundingLabelSnapshot === filters.fundingType)
        .map((line) => ({ invoice, line })),
    );
    if (rows.length > 5000) throw new ExportRowLimitExceededError();
    return rows;
  }

  async exportReceivables(
    principal: AuthorizationPrincipal,
    filters: BillingExportFilters,
  ): Promise<BillingInvoiceView[]> {
    return this.exportInvoiceViews(principal, { ...filters, status: 'issued' }, true);
  }

  async invoiceReferencesForAllocations(
    principal: AuthorizationPrincipal,
    allocationIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (
      allocationIds.length === 0 ||
      !principal.grants.some((grant) => grant.permission === 'billing.read')
    ) {
      return new Map();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          allocationId: invoiceLines.fundingAllocationId,
          invoiceNumber: invoices.invoiceNumber,
          clientId: invoices.clientId,
          organizationId: invoices.organizationId,
          facilityId: invoices.facilityId,
        })
        .from(invoiceLines)
        .innerJoin(
          invoices,
          and(
            eq(invoices.tenantId, invoiceLines.tenantId),
            eq(invoices.id, invoiceLines.invoiceId),
          ),
        )
        .where(
          and(
            eq(invoices.tenantId, principal.tenantId),
            eq(invoices.status, 'issued'),
            inArray(invoiceLines.fundingAllocationId, [...allocationIds]),
          ),
        );
      const result = new Map<string, string>();
      for (const row of rows) {
        if (
          row.allocationId &&
          row.invoiceNumber &&
          can(principal, {
            action: 'billing.read',
            resource: {
              tenantId: principal.tenantId,
              clientId: row.clientId,
              organizationId: row.organizationId,
              facilityId: row.facilityId,
            },
          })
        ) {
          result.set(row.allocationId, row.invoiceNumber);
        }
      }
      return result;
    });
  }

  private async exportInvoiceViews(
    principal: AuthorizationPrincipal,
    filters: BillingExportFilters,
    outstandingOnly: boolean,
  ): Promise<BillingInvoiceView[]> {
    validateExportRange(filters.from, filters.until);
    if (filters.organizationId)
      this.requireOrganization(principal, 'billing.read', filters.organizationId);
    if (filters.organizationId && filters.clientId) {
      this.requireClient(principal, 'billing.read', filters.clientId, filters.organizationId);
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const where = [
        eq(invoices.tenantId, principal.tenantId),
        gte(invoices.issueDate, filters.from),
        lte(invoices.issueDate, filters.until),
      ];
      if (outstandingOnly || filters.status === 'issued') where.push(eq(invoices.status, 'issued'));
      else if (filters.status) where.push(eq(invoices.status, filters.status));
      if (filters.organizationId) where.push(eq(invoices.organizationId, filters.organizationId));
      if (filters.facilityId) where.push(eq(invoices.facilityId, filters.facilityId));
      if (filters.clientId) where.push(eq(invoices.clientId, filters.clientId));
      if (filters.recipientType) where.push(eq(invoices.recipientType, filters.recipientType));
      const scopeConditions = billingScopeConditions(
        principal,
        outstandingOnly ? 'billing.payments.read' : 'billing.read',
      );
      if (scopeConditions === null) return [];
      where.push(scopeConditions);
      const rows = await transaction
        .select()
        .from(invoices)
        .where(and(...where))
        .orderBy(asc(invoices.issueDate), asc(invoices.invoiceNumber), asc(invoices.id))
        .limit(5001);
      if (rows.length > 5000) throw new ExportRowLimitExceededError();
      const result: BillingInvoiceView[] = [];
      for (const invoice of rows) {
        const permission = outstandingOnly ? 'billing.payments.read' : 'billing.read';
        if (
          !can(principal, {
            action: permission,
            resource: {
              tenantId: principal.tenantId,
              clientId: invoice.clientId,
              organizationId: invoice.organizationId,
              facilityId: invoice.facilityId,
            },
          })
        )
          continue;
        const view = await this.invoiceView(transaction, principal, invoice);
        if (!outstandingOnly || (view.outstandingCents !== null && view.outstandingCents > 0)) {
          result.push(view);
        }
      }
      if (result.some((invoice) => invoice.status === 'issued') && result.length > 5000) {
        throw new ExportRowLimitExceededError();
      }
      return result;
    });
  }

  async receivables(
    principal: AuthorizationPrincipal,
    query: { organizationId?: string; clientId?: string; page?: number; pageSize?: number } = {},
  ): Promise<BillingInvoiceView[]> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidBillingProfileError();
    }
    if (query.organizationId)
      this.requireOrganization(principal, 'billing.payments.read', query.organizationId);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const where = [eq(invoices.tenantId, principal.tenantId), eq(invoices.status, 'issued')];
      if (query.organizationId) where.push(eq(invoices.organizationId, query.organizationId));
      if (query.clientId) where.push(eq(invoices.clientId, query.clientId));
      const rows = await transaction
        .select()
        .from(invoices)
        .where(and(...where))
        .orderBy(asc(invoices.dueDate), desc(invoices.issueDate))
        .limit(Math.min(page * pageSize + 100, 500));
      const result: BillingInvoiceView[] = [];
      for (const invoice of rows) {
        if (
          !can(principal, {
            action: 'billing.payments.read',
            resource: {
              tenantId: principal.tenantId,
              clientId: invoice.clientId,
              organizationId: invoice.organizationId,
              facilityId: invoice.facilityId,
            },
          })
        )
          continue;
        const view = await this.invoiceView(transaction, principal, invoice);
        if (view.outstandingCents && view.outstandingCents > 0) result.push(view);
      }
      return result.slice((page - 1) * pageSize, page * pageSize);
    });
  }

  async listPayments(
    principal: AuthorizationPrincipal,
    query: { organizationId?: string; page?: number; pageSize?: number } = {},
  ): Promise<BillingPaymentView[]> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidBillingProfileError();
    }
    if (query.organizationId)
      this.requireOrganization(principal, 'billing.payments.read', query.organizationId);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const where = [eq(payments.tenantId, principal.tenantId)];
      if (query.organizationId) where.push(eq(payments.organizationId, query.organizationId));
      const rows = await transaction
        .select()
        .from(payments)
        .where(and(...where))
        .orderBy(desc(payments.receivedAt), desc(payments.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const output: BillingPaymentView[] = [];
      for (const payment of rows) {
        if (
          !can(principal, {
            action: 'billing.payments.read',
            resource: { tenantId: principal.tenantId, organizationId: payment.organizationId },
          })
        )
          continue;
        output.push(await this.paymentView(transaction, principal.tenantId, payment));
      }
      return output;
    });
  }

  async recordPayment(
    principal: AuthorizationPrincipal,
    input: RecordPaymentInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingPaymentView> {
    this.requireOrganization(principal, 'billing.payments.manage', input.organizationId);
    const receivedAt = new Date(input.receivedAt);
    if (
      !input.organizationId ||
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > 2_000_000_000 ||
      Number.isNaN(receivedAt.valueOf()) ||
      !['bank_transfer', 'cash', 'other'].includes(input.method) ||
      (input.reference?.length ?? 0) > 500 ||
      (input.payerName?.length ?? 0) > 200 ||
      (input.payerReference?.length ?? 0) > 200
    )
      throw new PaymentAmountInvalidError();
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
      if (!organization) throw new BillingClientNotFoundError();
      const id = uuidv7();
      const now = new Date();
      const [payment] = await transaction
        .insert(payments)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          payerReference: optionalText(input.payerReference),
          payerNameSnapshot: optionalText(input.payerName),
          amountCents: input.amountCents,
          currency: 'EUR',
          receivedAt,
          method: input.method,
          reference: optionalText(input.reference),
          recordedBy: principal.userId,
          createdAt: now,
        })
        .returning();
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'payment.recorded',
        aggregateType: 'payment',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          paymentId: id,
          organizationId: input.organizationId,
          amountCents: input.amountCents,
        },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'payment.recorded',
          resourceType: 'payment',
          resourceId: id,
          metadata: {
            organizationId: input.organizationId,
            amountCents: input.amountCents,
            method: input.method,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return this.paymentView(transaction, principal.tenantId, payment!);
    });
  }

  async allocatePayment(
    principal: AuthorizationPrincipal,
    input: PaymentAllocationInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [payment] = await transaction
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, principal.tenantId), eq(payments.id, input.paymentId)))
        .for('update')
        .limit(1);
      if (!payment) throw new PaymentNotFoundError();
      const invoice = await this.lockInvoice(transaction, principal.tenantId, input.invoiceId);
      this.requireClient(
        principal,
        'billing.payments.manage',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      if (invoice.status !== 'issued' || invoice.organizationId !== payment.organizationId) {
        throw new PaymentAllocationExceededError();
      }
      let claim: typeof claims.$inferSelect | null = null;
      if (input.claimId) {
        const [linkedClaim] = await transaction
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.tenantId, principal.tenantId),
              eq(claims.id, input.claimId),
              eq(claims.invoiceId, invoice.id),
            ),
          )
          .for('update')
          .limit(1);
        if (!linkedClaim) throw new ClaimPaymentAmountExceededError();
        assertCan(principal, {
          action: 'claims.reconcile',
          resource: {
            tenantId: principal.tenantId,
            organizationId: linkedClaim.organizationId,
            facilityId: linkedClaim.facilityId,
            clientId: linkedClaim.clientId,
          },
        });
        if (!['accepted', 'partially_accepted', 'resubmitted'].includes(linkedClaim.status)) {
          throw new ClaimPaymentAmountExceededError();
        }
        const [decision] = await transaction
          .select({ acceptedCents: claimDecisions.acceptedCents })
          .from(claimDecisions)
          .where(
            and(
              eq(claimDecisions.tenantId, principal.tenantId),
              eq(claimDecisions.claimId, linkedClaim.id),
            ),
          )
          .orderBy(desc(claimDecisions.createdAt), desc(claimDecisions.id))
          .limit(1);
        const claimAllocations = await transaction
          .select({ allocation: paymentAllocations, reversal: paymentReversals })
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
              eq(paymentAllocations.claimId, linkedClaim.id),
            ),
          );
        const activeAllocations = claimAllocations.filter((row) => !row.reversal);
        const paidCents = activeAllocations.reduce(
          (total, row) => total + row.allocation.amountCents,
          0,
        );
        if (
          !decision ||
          activeAllocations.some((row) => row.allocation.paymentId === payment.id) ||
          input.amountCents > decision.acceptedCents - paidCents
        ) {
          throw new ClaimPaymentAmountExceededError();
        }
        claim = linkedClaim;
      }
      const paymentUsage = await this.paymentUsage(transaction, principal.tenantId, payment.id);
      const receivable = await this.receivableFacts(transaction, invoice);
      assertPaymentAllocation({
        amountCents: input.amountCents,
        paymentRemainingCents: payment.amountCents - paymentUsage.allocatedCents,
        invoiceOutstandingCents: receivable.outstandingCents,
      });
      const id = uuidv7();
      const now = new Date();
      await transaction.insert(paymentAllocations).values({
        id,
        tenantId: principal.tenantId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        claimId: claim?.id ?? null,
        amountCents: input.amountCents,
        createdBy: principal.userId,
        createdAt: now,
      });
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'payment.allocated',
        aggregateType: 'payment',
        aggregateId: payment.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          paymentId: payment.id,
          allocationId: id,
          invoiceId: invoice.id,
          amountCents: input.amountCents,
        },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'payment.allocated',
          resourceType: 'payment_allocation',
          resourceId: id,
          metadata: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amountCents: input.amountCents,
          },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      if (claim) {
        const claimEvent = createDomainEvent({
          tenantId: principal.tenantId,
          type: 'claim.payment_linked',
          aggregateType: 'claim',
          aggregateId: claim.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload: { claimId: claim.id, paymentAllocationId: id, amountCents: input.amountCents },
        });
        await this.audit.append(
          transaction,
          this.auditRecord(principal, request, auditContext, {
            id: claimEvent.id,
            action: 'claim.payment_linked',
            resourceType: 'claim',
            resourceId: claim.id,
            metadata: { paymentAllocationId: id, amountCents: input.amountCents },
          }),
        );
        await this.outbox.enqueue(transaction, claimEvent);
      }
      return {
        id,
        paymentId: payment.id,
        invoiceId: invoice.id,
        claimId: claim?.id ?? null,
        amountCents: input.amountCents,
        createdAt: now.toISOString(),
      };
    });
  }

  async reversePaymentAllocation(
    principal: AuthorizationPrincipal,
    allocationId: string,
    reason: string,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const normalizedReason = optionalText(reason);
    if (!normalizedReason || normalizedReason.length > 1000)
      throw new PaymentReversalConflictError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [source] = await transaction
        .select()
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.tenantId, principal.tenantId),
            eq(paymentAllocations.id, allocationId),
          ),
        )
        .limit(1);
      if (!source) throw new PaymentNotFoundError();
      const [payment] = await transaction
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, principal.tenantId), eq(payments.id, source.paymentId)))
        .for('update')
        .limit(1);
      if (!payment) throw new PaymentNotFoundError();
      const invoice = await this.lockInvoice(transaction, principal.tenantId, source.invoiceId);
      this.requireClient(
        principal,
        'billing.payments.manage',
        invoice.clientId,
        invoice.organizationId,
        invoice.facilityId,
      );
      if (source.claimId) {
        const [claim] = await transaction
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.tenantId, principal.tenantId),
              eq(claims.id, source.claimId),
              eq(claims.invoiceId, invoice.id),
            ),
          )
          .for('update')
          .limit(1);
        if (!claim) throw new ClaimPaymentAmountExceededError();
        assertCan(principal, {
          action: 'claims.reconcile',
          resource: {
            tenantId: principal.tenantId,
            organizationId: claim.organizationId,
            facilityId: claim.facilityId,
            clientId: claim.clientId,
          },
        });
      }
      const [existing] = await transaction
        .select({ id: paymentReversals.id })
        .from(paymentReversals)
        .where(
          and(
            eq(paymentReversals.tenantId, principal.tenantId),
            eq(paymentReversals.allocationId, allocationId),
          ),
        )
        .limit(1);
      if (existing) throw new PaymentReversalConflictError();
      const id = uuidv7();
      const now = new Date();
      await transaction.insert(paymentReversals).values({
        id,
        tenantId: principal.tenantId,
        allocationId,
        reason: normalizedReason,
        reversedBy: principal.userId,
        reversedAt: now,
      });
      const event = createDomainEvent({
        tenantId: principal.tenantId,
        type: 'payment.allocation_reversed',
        aggregateType: 'payment',
        aggregateId: payment.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: {
          paymentId: payment.id,
          allocationId,
          invoiceId: invoice.id,
          amountCents: source.amountCents,
        },
      });
      await this.audit.append(
        transaction,
        this.auditRecord(principal, request, auditContext, {
          id: event.id,
          action: 'payment.allocation_reversed',
          resourceType: 'payment_allocation',
          resourceId: allocationId,
          metadata: { paymentId: payment.id, invoiceId: invoice.id, reason: normalizedReason },
        }),
      );
      await this.outbox.enqueue(transaction, event);
      return { allocationId, reversedAt: now.toISOString() };
    });
  }

  async issueInvoice(
    principal: AuthorizationPrincipal,
    invoiceId: string,
    input: IssueInvoiceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingInvoiceView> {
    const issued = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
        this.requireClient(
          principal,
          'billing.issue',
          invoice.clientId,
          invoice.organizationId,
          invoice.facilityId,
        );
        if (invoice.status !== 'draft') throw new InvoiceInvalidStateError();
        if (invoice.version !== input.expectedVersion) throw new InvoiceVersionConflictError();
        const existingLines = await transaction
          .select()
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.tenantId, principal.tenantId),
              eq(invoiceLines.invoiceId, invoiceId),
            ),
          )
          .orderBy(asc(invoiceLines.serviceDate), asc(invoiceLines.id));
        if (existingLines.length === 0) throw new BillingCandidateNotReadyError();
        const refreshed = await this.prepareDraft(
          transaction,
          principal,
          {
            organizationId: invoice.organizationId,
            facilityId: invoice.facilityId,
            clientId: invoice.clientId,
            recipientType: invoice.recipientType,
            payerArrangementId: invoice.payerArrangementId,
            lines: existingLines.map((line) => ({
              performedServiceId: line.performedServiceId,
              fundingAllocationId: line.fundingAllocationId,
              amountCents: line.amountCents,
            })),
          },
          invoice.id,
        );
        if (
          refreshed.subtotalCents !== invoice.subtotalCents ||
          refreshed.taxTotalCents !== invoice.taxTotalCents ||
          refreshed.grandTotalCents !== invoice.grandTotalCents ||
          refreshed.lineValues.length !== existingLines.length
        )
          throw new InvoiceVersionConflictError();
        for (const [index, current] of refreshed.lineValues.entries()) {
          const previous = existingLines[index]!;
          if (
            current.performedServiceId !== previous.performedServiceId ||
            current.sourceKey !== previous.sourceKey ||
            current.servicePriceId !== previous.servicePriceId ||
            current.serviceCodeSnapshot !== previous.serviceCodeSnapshot ||
            current.serviceNameSnapshot !== previous.serviceNameSnapshot ||
            current.serviceDate !== previous.serviceDate ||
            current.quantity !== previous.quantity ||
            current.unit !== previous.unit ||
            current.unitPriceCents !== previous.unitPriceCents ||
            current.amountCents !== previous.amountCents ||
            current.evidencePackageId !== previous.evidencePackageId ||
            current.evidenceSnapshotHash !== previous.evidenceSnapshotHash ||
            current.taxTreatment !== previous.taxTreatment ||
            current.taxRateBasisPoints !== previous.taxRateBasisPoints ||
            current.netCents !== previous.netCents ||
            current.taxCents !== previous.taxCents ||
            current.grossCents !== previous.grossCents
          )
            throw new InvoiceEvidenceOutdatedError();
        }
        const profile = refreshed.profile;
        if (!profile.bankAccountHolder?.trim() || !profile.iban?.trim())
          throw new InvoiceIssuerIncompleteError();
        if (
          !hasRequiredTaxIdentifier(refreshed.grandTotalCents, profile.taxNumber, profile.vatId)
        ) {
          throw new InvoiceIssuerIncompleteError();
        }
        const [organization] = await transaction
          .select()
          .from(organizationsTable)
          .where(
            and(
              eq(organizationsTable.tenantId, principal.tenantId),
              eq(organizationsTable.id, invoice.organizationId),
            ),
          )
          .limit(1);
        if (
          !organization?.address?.trim() ||
          !(organization.legalName?.trim() || organization.name.trim())
        ) {
          throw new InvoiceIssuerIncompleteError();
        }
        const recipientSnapshot = await this.recipientSnapshot(
          transaction,
          principal.tenantId,
          invoice,
          existingLines,
        );
        const issueDate = currentDate();
        const dueDate = addDays(issueDate, profile.paymentTermsDays);
        const year = Number(issueDate.slice(0, 4));
        const now = new Date();
        const [sequence] = await transaction
          .insert(invoiceNumberSequences)
          .values({
            tenantId: principal.tenantId,
            organizationId: invoice.organizationId,
            calendarYear: year,
            nextSequence: 2,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              invoiceNumberSequences.tenantId,
              invoiceNumberSequences.organizationId,
              invoiceNumberSequences.calendarYear,
            ],
            set: { nextSequence: sql`${invoiceNumberSequences.nextSequence} + 1`, updatedAt: now },
          })
          .returning({ nextSequence: invoiceNumberSequences.nextSequence });
        if (!sequence) throw new InvoiceNumberConflictError();
        const sequenceNumber = sequence.nextSequence - 1;
        const invoiceNumber = formatInvoiceNumber(
          profile.invoiceNumberPrefix,
          year,
          sequenceNumber,
        );
        const issuerSnapshot = {
          legalName: organization.legalName?.trim() || organization.name.trim(),
          tradingName: organization.name,
          address: organization.address.trim(),
          taxNumber: profile.taxNumber,
          vatId: profile.vatId,
          creditorIdentifier: profile.creditorIdentifier,
          bankAccountHolder: profile.bankAccountHolder,
          iban: profile.iban,
          bic: profile.bic,
          taxTreatment: profile.taxTreatment,
          taxRateBasisPoints: profile.taxRateBasisPoints,
          taxExemptionBasis: profile.taxExemptionBasis,
          currency: profile.defaultCurrency,
          invoiceNumberPrefix: profile.invoiceNumberPrefix,
        };
        const [updated] = await transaction
          .update(invoices)
          .set({
            invoiceNumber,
            issueDate,
            dueDate,
            recipientSnapshot,
            issuerSnapshot,
            status: 'issued',
            version: invoice.version + 1,
            issuedBy: principal.userId,
            issuedAt: now,
            updatedAt: now,
          })
          .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, invoice.id)))
          .returning();
        if (!updated) throw new InvoiceNotFoundError();
        await transaction.insert(invoiceNumbers).values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          calendarYear: year,
          sequenceNumber,
          invoiceNumber,
          assignedAt: now,
        });
        const documentVersion = await this.nextDocumentVersion(
          transaction,
          principal.tenantId,
          invoice.id,
        );
        const documentId = uuidv7();
        await transaction.insert(invoiceDocuments).values({
          id: documentId,
          tenantId: principal.tenantId,
          invoiceId: invoice.id,
          correctionId: null,
          documentVersion,
          status: 'pending',
          objectKey: null,
          sha256: null,
          failureCode: null,
          generatedAt: null,
          createdAt: now,
        });
        const event = createDomainEvent({
          tenantId: principal.tenantId,
          type: 'invoice.issued',
          aggregateType: 'invoice',
          aggregateId: invoice.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload: {
            invoiceId: invoice.id,
            invoiceNumber,
            clientId: invoice.clientId,
            grandTotalCents: invoice.grandTotalCents,
            currency: invoice.currency,
          },
        });
        await this.audit.append(
          transaction,
          this.auditRecord(principal, request, auditContext, {
            id: event.id,
            action: 'invoice.issued',
            resourceType: 'invoice',
            resourceId: invoice.id,
            metadata: {
              invoiceNumber,
              issueDate,
              dueDate,
              grandTotalCents: invoice.grandTotalCents,
            },
          }),
        );
        await this.outbox.enqueue(transaction, event);
        const pdfData = this.invoicePdfData(
          updated,
          issuerSnapshot,
          recipientSnapshot,
          existingLines,
        );
        return {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          documentId,
          documentVersion,
          pdfData,
        };
      },
    );
    await this.generateInvoicePdf(
      principal.tenantId,
      issued.organizationId,
      issued.invoiceId,
      issued.documentId,
      issued.documentVersion,
      issued.pdfData,
    );
    return this.getInvoice(principal, invoiceId);
  }

  async getInvoicePdf(
    principal: AuthorizationPrincipal,
    invoiceId: string,
  ): Promise<{ fileName: string; bytes: Uint8Array }> {
    const document = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
        this.requireClient(
          principal,
          'billing.read',
          invoice.clientId,
          invoice.organizationId,
          invoice.facilityId,
        );
        if (invoice.status !== 'issued') throw new InvoiceInvalidStateError();
        const [document] = await transaction
          .select()
          .from(invoiceDocuments)
          .where(
            and(
              eq(invoiceDocuments.tenantId, principal.tenantId),
              eq(invoiceDocuments.invoiceId, invoiceId),
              isNull(invoiceDocuments.correctionId),
              eq(invoiceDocuments.status, 'ready'),
            ),
          )
          .orderBy(desc(invoiceDocuments.documentVersion))
          .limit(1);
        if (!document?.objectKey) throw new InvoicePdfNotReadyError();
        return {
          fileName: `${safeFilePart(invoice.invoiceNumber ?? invoice.id)}.pdf`,
          objectKey: document.objectKey,
          sha256: document.sha256,
        };
      },
    );
    const bytes = await this.storage.get(document.objectKey);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== document.sha256)
      throw new InvoicePdfNotReadyError();
    return { fileName: document.fileName, bytes };
  }

  async regenerateInvoicePdf(
    principal: AuthorizationPrincipal,
    invoiceId: string,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<BillingInvoiceView> {
    const generated = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
        this.requireClient(
          principal,
          'billing.issue',
          invoice.clientId,
          invoice.organizationId,
          invoice.facilityId,
        );
        if (invoice.status !== 'issued') throw new InvoiceInvalidStateError();
        const lines = await transaction
          .select()
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.tenantId, principal.tenantId),
              eq(invoiceLines.invoiceId, invoice.id),
            ),
          )
          .orderBy(asc(invoiceLines.serviceDate), asc(invoiceLines.id));
        if (!invoice.issuerSnapshot || !invoice.recipientSnapshot || !invoice.invoiceNumber)
          throw new InvoicePdfNotReadyError();
        const documentVersion = await this.nextDocumentVersion(
          transaction,
          principal.tenantId,
          invoice.id,
        );
        const documentId = uuidv7();
        await transaction.insert(invoiceDocuments).values({
          id: documentId,
          tenantId: principal.tenantId,
          invoiceId: invoice.id,
          correctionId: null,
          documentVersion,
          status: 'pending',
          objectKey: null,
          sha256: null,
          failureCode: null,
          generatedAt: null,
          createdAt: new Date(),
        });
        const eventId = uuidv7();
        await this.audit.append(
          transaction,
          this.auditRecord(principal, request, auditContext, {
            id: eventId,
            action: 'invoice.pdf_regeneration_requested',
            resourceType: 'invoice_document',
            resourceId: documentId,
            metadata: { invoiceId, documentVersion },
          }),
        );
        return {
          invoiceId,
          organizationId: invoice.organizationId,
          documentId,
          documentVersion,
          pdfData: this.invoicePdfData(
            invoice,
            invoice.issuerSnapshot,
            invoice.recipientSnapshot,
            lines,
          ),
        };
      },
    );
    await this.generateInvoicePdf(
      principal.tenantId,
      generated.organizationId,
      generated.invoiceId,
      generated.documentId,
      generated.documentVersion,
      generated.pdfData,
    );
    return this.getInvoice(principal, invoiceId);
  }

  async correctInvoice(
    principal: AuthorizationPrincipal,
    invoiceId: string,
    input: InvoiceCorrectionInput,
    request: RequestContext,
    auditContext: AuditContext,
  ): Promise<{ correction: typeof invoiceCorrections.$inferSelect; invoice: BillingInvoiceView }> {
    const corrected = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
        this.requireClient(
          principal,
          'billing.correct',
          invoice.clientId,
          invoice.organizationId,
          invoice.facilityId,
        );
        if (invoice.status !== 'issued') throw new InvoiceInvalidStateError();
        const reason = optionalText(input.reason);
        if (
          !reason ||
          reason.length > 1000 ||
          !Array.isArray(input.lines) ||
          input.lines.length === 0 ||
          input.lines.length > 100
        ) {
          throw new InvalidInvoiceCorrectionError();
        }
        const lines = await transaction
          .select()
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.tenantId, principal.tenantId),
              eq(invoiceLines.invoiceId, invoice.id),
            ),
          )
          .orderBy(asc(invoiceLines.serviceDate), asc(invoiceLines.id));
        const lineById = new Map(lines.map((line) => [line.id, line]));
        const correctionRows = await transaction
          .select({
            invoiceLineId: invoiceCorrectionLines.invoiceLineId,
            amountCents: invoiceCorrectionLines.amountCents,
          })
          .from(invoiceCorrectionLines)
          .innerJoin(
            invoiceCorrections,
            and(
              eq(invoiceCorrections.tenantId, invoiceCorrectionLines.tenantId),
              eq(invoiceCorrections.id, invoiceCorrectionLines.correctionId),
            ),
          )
          .where(
            and(
              eq(invoiceCorrections.tenantId, principal.tenantId),
              eq(invoiceCorrections.invoiceId, invoice.id),
            ),
          );
        const correctedByLine = new Map<string, number>();
        for (const row of correctionRows)
          correctedByLine.set(
            row.invoiceLineId,
            (correctedByLine.get(row.invoiceLineId) ?? 0) + row.amountCents,
          );
        const seen = new Set<string>();
        let amountCents = 0;
        for (const selection of input.lines) {
          if (seen.has(selection.invoiceLineId)) throw new InvalidInvoiceCorrectionError();
          seen.add(selection.invoiceLineId);
          const source = lineById.get(selection.invoiceLineId);
          if (
            !source ||
            !Number.isSafeInteger(selection.amountCents) ||
            selection.amountCents <= 0
          ) {
            throw new InvalidInvoiceCorrectionError();
          }
          const remaining = source.grossCents - (correctedByLine.get(source.id) ?? 0);
          assertCorrectionAmount(selection.amountCents, remaining);
          amountCents += selection.amountCents;
        }
        if (!Number.isSafeInteger(amountCents)) throw new InvalidInvoiceCorrectionError();
        const receivable = await this.receivableFacts(transaction, invoice);
        assertCorrectionAmount(amountCents, receivable.outstandingCents);
        if (!invoice.issuerSnapshot) throw new InvoiceIssuerIncompleteError();
        const correctionDate = currentDate();
        const year = Number(correctionDate.slice(0, 4));
        const now = new Date();
        const [sequence] = await transaction
          .insert(invoiceNumberSequences)
          .values({
            tenantId: principal.tenantId,
            organizationId: invoice.organizationId,
            calendarYear: year,
            nextSequence: 2,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              invoiceNumberSequences.tenantId,
              invoiceNumberSequences.organizationId,
              invoiceNumberSequences.calendarYear,
            ],
            set: { nextSequence: sql`${invoiceNumberSequences.nextSequence} + 1`, updatedAt: now },
          })
          .returning({ nextSequence: invoiceNumberSequences.nextSequence });
        if (!sequence) throw new InvoiceNumberConflictError();
        const invoiceNumberPrefix = requiredSnapshotString(
          invoice.issuerSnapshot,
          'invoiceNumberPrefix',
        );
        const correctionNumber = formatCorrectionNumber(
          invoiceNumberPrefix,
          year,
          sequence.nextSequence - 1,
        );
        const correctionId = uuidv7();
        const [correction] = await transaction
          .insert(invoiceCorrections)
          .values({
            id: correctionId,
            tenantId: principal.tenantId,
            organizationId: invoice.organizationId,
            invoiceId: invoice.id,
            correctionNumber,
            amountCents,
            reason,
            createdBy: principal.userId,
            createdAt: now,
          })
          .returning();
        await transaction.insert(invoiceCorrectionLines).values(
          input.lines.map((selection) => ({
            id: uuidv7(),
            tenantId: principal.tenantId,
            correctionId,
            invoiceLineId: selection.invoiceLineId,
            amountCents: selection.amountCents,
            createdAt: now,
          })),
        );
        const documentVersion = await this.nextDocumentVersion(
          transaction,
          principal.tenantId,
          invoice.id,
        );
        const documentId = uuidv7();
        await transaction.insert(invoiceDocuments).values({
          id: documentId,
          tenantId: principal.tenantId,
          invoiceId: invoice.id,
          correctionId,
          documentVersion,
          status: 'pending',
          objectKey: null,
          sha256: null,
          failureCode: null,
          generatedAt: null,
          createdAt: now,
        });
        const event = createDomainEvent({
          tenantId: principal.tenantId,
          type: 'invoice.corrected',
          aggregateType: 'invoice',
          aggregateId: invoice.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: request.correlationId,
          payload: { invoiceId: invoice.id, correctionId, correctionNumber, amountCents },
        });
        await this.audit.append(
          transaction,
          this.auditRecord(principal, request, auditContext, {
            id: event.id,
            action: 'invoice.corrected',
            resourceType: 'invoice_correction',
            resourceId: correctionId,
            metadata: { invoiceId: invoice.id, correctionNumber, amountCents, reason },
          }),
        );
        await this.outbox.enqueue(transaction, event);
        const pdfData = this.correctionPdfData(
          invoice,
          correction!,
          lines,
          input.lines,
          reason,
          receivable.outstandingCents - amountCents,
        );
        return {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          correctionId,
          documentId,
          documentVersion,
          correction: correction!,
          pdfData,
        };
      },
    );
    await this.generateCorrectionPdf(
      principal.tenantId,
      corrected.organizationId,
      corrected.invoiceId,
      corrected.correctionId,
      corrected.documentId,
      corrected.documentVersion,
      corrected.pdfData,
    );
    return {
      correction: corrected.correction,
      invoice: await this.getInvoice(principal, invoiceId),
    };
  }

  async getCorrectionPdf(
    principal: AuthorizationPrincipal,
    invoiceId: string,
    correctionId: string,
  ): Promise<{ fileName: string; bytes: Uint8Array }> {
    const document = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const invoice = await this.lockInvoice(transaction, principal.tenantId, invoiceId);
        this.requireClient(
          principal,
          'billing.read',
          invoice.clientId,
          invoice.organizationId,
          invoice.facilityId,
        );
        const [correction] = await transaction
          .select()
          .from(invoiceCorrections)
          .where(
            and(
              eq(invoiceCorrections.tenantId, principal.tenantId),
              eq(invoiceCorrections.invoiceId, invoiceId),
              eq(invoiceCorrections.id, correctionId),
            ),
          )
          .limit(1);
        if (!correction) throw new InvoiceNotFoundError();
        const [document] = await transaction
          .select()
          .from(invoiceDocuments)
          .where(
            and(
              eq(invoiceDocuments.tenantId, principal.tenantId),
              eq(invoiceDocuments.invoiceId, invoiceId),
              eq(invoiceDocuments.correctionId, correctionId),
              eq(invoiceDocuments.status, 'ready'),
            ),
          )
          .orderBy(desc(invoiceDocuments.documentVersion))
          .limit(1);
        if (!document?.objectKey) throw new InvoicePdfNotReadyError();
        return {
          fileName: `${safeFilePart(correction.correctionNumber)}.pdf`,
          objectKey: document.objectKey,
          sha256: document.sha256,
        };
      },
    );
    const bytes = await this.storage.get(document.objectKey);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== document.sha256)
      throw new InvoicePdfNotReadyError();
    return { fileName: document.fileName, bytes };
  }

  private async prepareDraft(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    input: DraftInvoiceInput,
    excludeInvoiceId?: string,
  ) {
    if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
      throw new InvalidInvoiceAmountError();
    }
    if (
      (input.recipientType === 'payer' && !input.payerArrangementId) ||
      (input.recipientType === 'client' && input.payerArrangementId)
    ) {
      throw new InvoiceRecipientInvalidError();
    }
    const serviceIds = [...new Set(input.lines.map((line) => line.performedServiceId))].sort();
    await this.lockPerformedServices(transaction, principal.tenantId, serviceIds);
    const serviceRows = await this.serviceRowsByIds(transaction, principal.tenantId, serviceIds);
    if (serviceRows.length !== serviceIds.length) throw new BillingCandidateNotReadyError();
    const profiles = new Map<string, typeof billingProfiles.$inferSelect | null>();
    const candidates = new Map<string, BillingCandidateView>();
    const rowByService = new Map(serviceRows.map((row) => [row.performedServiceId, row]));
    for (const row of serviceRows) {
      if (
        row.organizationId !== input.organizationId ||
        row.facilityId !== input.facilityId ||
        row.clientId !== input.clientId
      ) {
        throw new InvoiceRecipientInvalidError();
      }
      this.requireClient(
        principal,
        'billing.manage',
        row.clientId,
        row.organizationId,
        row.facilityId,
      );
      let profile = profiles.get(row.organizationId);
      if (profile === undefined) {
        profile = await this.profileForOrganization(
          transaction,
          principal.tenantId,
          row.organizationId,
        );
        profiles.set(row.organizationId, profile);
      }
      const choices = await this.candidatesForService(
        transaction,
        principal,
        row,
        profile,
        excludeInvoiceId,
      );
      for (const choice of choices)
        candidates.set(`${choice.performedServiceId}:${choice.sourceKey}`, choice);
    }
    const seen = new Set<string>();
    const lineValues: Array<typeof invoiceLines.$inferInsert> = [];
    let subtotalCents = 0;
    let taxTotalCents = 0;
    let grandTotalCents = 0;
    const serviceDates: string[] = [];
    const profile = profiles.get(input.organizationId) ?? null;
    if (!profile) throw new InvoiceIssuerIncompleteError();
    if (
      !this.profileIsComplete(
        profile,
        serviceRows[0]!.organizationName,
        serviceRows[0]!.organizationAddress,
      )
    ) {
      throw new InvoiceIssuerIncompleteError();
    }
    if (profile.requiredInvoiceFormat === 'structured') throw new InvoiceFormatUnsupportedError();
    if (
      input.recipientType === 'client' &&
      !(await this.hasBillingAddress(transaction, principal.tenantId, input.clientId))
    ) {
      throw new InvoiceRecipientInvalidError();
    }
    for (const selection of input.lines) {
      const sourceKey = selection.fundingAllocationId
        ? `allocation:${selection.fundingAllocationId}`
        : 'self-pay';
      const key = `${selection.performedServiceId}:${sourceKey}`;
      if (seen.has(key)) throw new InvalidInvoiceAmountError();
      seen.add(key);
      const candidate = candidates.get(key);
      if (!candidate) throw new BillingCandidateNotReadyError();
      if (candidate.blockers.includes('FUNDING_ALLOCATION_PROVISIONAL')) {
        throw new BillingFundingNotResolvedError();
      }
      if (candidate.blockers.includes('INVOICE_ISSUER_INCOMPLETE')) {
        throw new InvoiceIssuerIncompleteError();
      }
      if (candidate.blockers.includes('INVOICE_FORMAT_UNSUPPORTED')) {
        throw new InvoiceFormatUnsupportedError();
      }
      if (candidate.blockers.includes('INVOICE_RECIPIENT_INVALID')) {
        throw new InvoiceRecipientInvalidError();
      }
      if (
        candidate.blockers.includes('EVIDENCE_OUTDATED') ||
        candidate.blockers.includes('EVIDENCE_MISSING')
      ) {
        throw new InvoiceEvidenceOutdatedError();
      }
      if (candidate.blockers.length > 0) throw new BillingCandidateNotReadyError();
      if (
        !candidate.ready ||
        candidate.serviceAmountCents === null ||
        candidate.unitPriceCents === null ||
        !candidate.servicePriceId
      ) {
        throw new BillingCandidateNotReadyError();
      }
      assertAvailableAmount(selection.amountCents, candidate.remainingBillableAmountCents);
      if (
        input.recipientType === 'payer' &&
        candidate.recommendedPayerArrangementId !== input.payerArrangementId
      ) {
        throw new InvoiceRecipientInvalidError();
      }
      const row = rowByService.get(selection.performedServiceId);
      if (!row) throw new BillingCandidateNotReadyError();
      const amount = calculateInvoiceAmounts(
        selection.amountCents,
        profile.taxTreatment,
        profile.taxRateBasisPoints,
      );
      lineValues.push({
        id: uuidv7(),
        tenantId: principal.tenantId,
        invoiceId: excludeInvoiceId ?? uuidv7(),
        performedServiceId: candidate.performedServiceId,
        fundingAllocationId: candidate.fundingAllocationId,
        servicePriceId: candidate.servicePriceId,
        evidencePackageId: candidate.evidencePackageId!,
        evidenceSnapshotHash: candidate.evidenceSnapshotHash!,
        sourceKey: candidate.sourceKey,
        serviceCodeSnapshot: candidate.serviceCode,
        serviceNameSnapshot: candidate.serviceName,
        serviceDate: candidate.serviceDate,
        quantity: candidate.quantity,
        unit: candidate.unit,
        unitPriceCents: candidate.unitPriceCents,
        serviceAmountCents: candidate.serviceAmountCents,
        amountCents: selection.amountCents,
        taxTreatment: profile.taxTreatment,
        taxRateBasisPoints: profile.taxRateBasisPoints ?? 0,
        netCents: amount.netCents,
        taxCents: amount.taxCents,
        grossCents: amount.grossCents,
        taxExemptionBasis: profile.taxExemptionBasis,
        fundingLabelSnapshot: candidate.fundingLabel,
        createdAt: new Date(),
      });
      subtotalCents += amount.netCents;
      taxTotalCents += amount.taxCents;
      grandTotalCents += amount.grossCents;
      serviceDates.push(candidate.serviceDate);
    }
    if (
      !Number.isSafeInteger(subtotalCents) ||
      !Number.isSafeInteger(taxTotalCents) ||
      !Number.isSafeInteger(grandTotalCents)
    ) {
      throw new InvalidInvoiceAmountError();
    }
    return {
      profile,
      lineValues,
      subtotalCents,
      taxTotalCents,
      grandTotalCents,
      servicePeriodFrom: serviceDates.sort()[0] ?? null,
      servicePeriodUntil: serviceDates.sort().at(-1) ?? null,
    };
  }

  private async lockInvoice(transaction: DatabaseTransaction, tenantId: string, invoiceId: string) {
    const [invoice] = await transaction
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .for('update')
      .limit(1);
    if (!invoice) throw new InvoiceNotFoundError();
    return invoice;
  }

  private async lockPerformedServices(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceIds: string[],
  ): Promise<void> {
    if (serviceIds.length === 0) throw new BillingCandidateNotReadyError();
    const rows = await transaction
      .select({ id: performedServices.id })
      .from(performedServices)
      .where(
        and(eq(performedServices.tenantId, tenantId), inArray(performedServices.id, serviceIds)),
      )
      .orderBy(asc(performedServices.id))
      .for('update');
    if (rows.length !== serviceIds.length) throw new BillingCandidateNotReadyError();
  }

  private async serviceRowsByIds(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceIds: string[],
  ): Promise<CandidateServiceRow[]> {
    const serviceDate = sql<string>`(${visitExecutions.actualStart} AT TIME ZONE ${visits.timezone})::date::text`;
    return transaction
      .select({
        performedServiceId: performedServices.id,
        visitId: performedServices.visitId,
        executionId: performedServices.executionId,
        serviceId: performedServices.serviceDefinitionId,
        serviceCode: performedServices.serviceCodeSnapshot,
        serviceName: performedServices.serviceNameSnapshot,
        unit: performedServices.unitSnapshot,
        actualQuantity: performedServices.actualQuantity,
        status: performedServices.status,
        clientId: visits.clientId,
        clientFirstName: clientRecords.firstName,
        clientPreferredName: clientRecords.preferredName,
        clientLastName: clientRecords.lastName,
        organizationId: visits.organizationId,
        organizationName: organizationsTable.name,
        organizationAddress: organizationsTable.address,
        facilityId: visits.facilityId,
        facilityName: facilities.name,
        timezone: visits.timezone,
        actualStart: visitExecutions.actualStart,
        serviceDate: serviceDate.as('service_date'),
      })
      .from(performedServices)
      .innerJoin(
        visitExecutions,
        and(
          eq(visitExecutions.tenantId, performedServices.tenantId),
          eq(visitExecutions.id, performedServices.executionId),
          eq(visitExecutions.visitId, performedServices.visitId),
        ),
      )
      .innerJoin(
        visits,
        and(
          eq(visits.tenantId, performedServices.tenantId),
          eq(visits.id, performedServices.visitId),
        ),
      )
      .innerJoin(
        clientRecords,
        and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
      )
      .innerJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, visits.tenantId),
          eq(organizationsTable.id, visits.organizationId),
        ),
      )
      .innerJoin(
        facilities,
        and(
          eq(facilities.tenantId, visits.tenantId),
          eq(facilities.organizationId, visits.organizationId),
          eq(facilities.id, visits.facilityId),
        ),
      )
      .where(
        and(
          eq(performedServices.tenantId, tenantId),
          inArray(performedServices.id, serviceIds),
          eq(visitExecutions.status, 'completed'),
          inArray(performedServices.status, ['performed', 'partially_performed']),
        ),
      )
      .orderBy(asc(performedServices.id));
  }

  private async invoiceView(
    transaction: DatabaseTransaction,
    _principal: AuthorizationPrincipal,
    invoice: typeof invoices.$inferSelect,
    suppliedLines?: Array<typeof invoiceLines.$inferSelect>,
  ): Promise<BillingInvoiceView> {
    const [client] = await transaction
      .select({
        firstName: clientRecords.firstName,
        preferredName: clientRecords.preferredName,
        lastName: clientRecords.lastName,
      })
      .from(clientRecords)
      .where(
        and(eq(clientRecords.tenantId, invoice.tenantId), eq(clientRecords.id, invoice.clientId)),
      )
      .limit(1);
    const clientName = client
      ? `${client.preferredName?.trim() || client.firstName} ${client.lastName}`
      : invoice.clientId;
    const issuedRecipientName = invoice.recipientSnapshot
      ? optionalSnapshotString(invoice.recipientSnapshot, 'name')
      : null;
    const issuedRecipientAddress = invoice.recipientSnapshot
      ? optionalSnapshotString(invoice.recipientSnapshot, 'address')
      : null;
    let draftRecipientName: string | null = null;
    let draftRecipientAddress: string | null = null;
    if (
      invoice.status === 'draft' &&
      invoice.recipientType === 'payer' &&
      invoice.payerArrangementId
    ) {
      const [arrangement] = await transaction
        .select({
          recipientName: payerArrangements.recipientName,
          recipientAddress: payerArrangements.recipientAddress,
        })
        .from(payerArrangements)
        .where(
          and(
            eq(payerArrangements.tenantId, invoice.tenantId),
            eq(payerArrangements.id, invoice.payerArrangementId),
          ),
        )
        .limit(1);
      draftRecipientName = arrangement?.recipientName ?? null;
      draftRecipientAddress = arrangement?.recipientAddress ?? null;
    } else if (invoice.status === 'draft') {
      const today = currentDate();
      const [address] = await transaction
        .select()
        .from(clientAddresses)
        .where(
          and(
            eq(clientAddresses.tenantId, invoice.tenantId),
            eq(clientAddresses.clientId, invoice.clientId),
            or(eq(clientAddresses.addressType, 'billing'), eq(clientAddresses.addressType, 'home')),
            or(isNull(clientAddresses.validFrom), lte(clientAddresses.validFrom, today)),
            or(isNull(clientAddresses.validUntil), gte(clientAddresses.validUntil, today)),
          ),
        )
        .orderBy(desc(clientAddresses.addressType), desc(clientAddresses.isPrimary))
        .limit(1);
      draftRecipientName = clientName;
      draftRecipientAddress = address ? formatPostalAddress(address) : null;
    }
    const lines =
      suppliedLines ??
      (await transaction
        .select()
        .from(invoiceLines)
        .where(
          and(eq(invoiceLines.tenantId, invoice.tenantId), eq(invoiceLines.invoiceId, invoice.id)),
        )
        .orderBy(asc(invoiceLines.serviceDate), asc(invoiceLines.id)));
    const corrections = await transaction
      .select()
      .from(invoiceCorrections)
      .where(
        and(
          eq(invoiceCorrections.tenantId, invoice.tenantId),
          eq(invoiceCorrections.invoiceId, invoice.id),
        ),
      )
      .orderBy(asc(invoiceCorrections.createdAt), asc(invoiceCorrections.id));
    const paymentHistory = await transaction
      .select({
        allocationId: paymentAllocations.id,
        paymentId: paymentAllocations.paymentId,
        amountCents: paymentAllocations.amountCents,
        allocatedAt: paymentAllocations.createdAt,
        method: payments.method,
        receivedAt: payments.receivedAt,
        reference: payments.reference,
        payerNameSnapshot: payments.payerNameSnapshot,
        reversedAt: paymentReversals.reversedAt,
        reversalReason: paymentReversals.reason,
      })
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
          eq(paymentAllocations.tenantId, invoice.tenantId),
          eq(paymentAllocations.invoiceId, invoice.id),
        ),
      )
      .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
    const [document] = await transaction
      .select()
      .from(invoiceDocuments)
      .where(
        and(
          eq(invoiceDocuments.tenantId, invoice.tenantId),
          eq(invoiceDocuments.invoiceId, invoice.id),
          isNull(invoiceDocuments.correctionId),
        ),
      )
      .orderBy(desc(invoiceDocuments.documentVersion))
      .limit(1);
    const facts =
      invoice.status === 'issued' ? await this.receivableFacts(transaction, invoice) : null;
    const receivable =
      facts && invoice.dueDate
        ? deriveReceivableStatus({
            invoiceCents: invoice.grandTotalCents,
            correctionsCents: facts.correctionsCents,
            paymentsCents: facts.paymentsCents,
            dueDate: invoice.dueDate,
            asOfDate: currentDate(),
          })
        : null;
    let evidenceDiscrepancy = false;
    if (invoice.status === 'issued' && lines.length > 0) {
      const sourceRows = await transaction
        .select({ performedServiceId: performedServices.id, visitId: performedServices.visitId })
        .from(performedServices)
        .where(
          and(
            eq(performedServices.tenantId, invoice.tenantId),
            inArray(
              performedServices.id,
              lines.map((line) => line.performedServiceId),
            ),
          ),
        );
      const visitByService = new Map(
        sourceRows.map((row) => [row.performedServiceId, row.visitId]),
      );
      const visitIds = [...new Set(sourceRows.map((row) => row.visitId))];
      for (const visitId of visitIds) {
        const readiness = await this.evidence.getBillingReadiness(
          transaction,
          invoice.tenantId,
          visitId,
        );
        const visitLines = lines.filter(
          (line) => visitByService.get(line.performedServiceId) === visitId,
        );
        if (
          !readiness.isCurrent ||
          visitLines.some(
            (line) =>
              line.evidencePackageId !== readiness.evidencePackageId ||
              line.evidenceSnapshotHash !== readiness.snapshotHash,
          )
        ) {
          evidenceDiscrepancy = true;
          break;
        }
      }
    }
    return {
      id: invoice.id,
      organizationId: invoice.organizationId,
      facilityId: invoice.facilityId,
      clientId: invoice.clientId,
      clientName,
      recipientName: issuedRecipientName ?? draftRecipientName,
      recipientAddress: issuedRecipientAddress ?? draftRecipientAddress,
      payerArrangementId: invoice.payerArrangementId,
      recipientType: invoice.recipientType,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      servicePeriodFrom: invoice.servicePeriodFrom,
      servicePeriodUntil: invoice.servicePeriodUntil,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      subtotalCents: invoice.subtotalCents,
      taxTotalCents: invoice.taxTotalCents,
      grandTotalCents: invoice.grandTotalCents,
      status: invoice.status,
      version: invoice.version,
      issuerSnapshot: invoice.issuerSnapshot,
      recipientSnapshot: invoice.recipientSnapshot,
      lines,
      corrections,
      paymentHistory,
      pdfStatus: document?.status ?? null,
      receivableStatus: receivable?.status ?? null,
      outstandingCents: receivable?.outstandingCents ?? null,
      evidenceDiscrepancy,
    };
  }

  private async receivableFacts(
    transaction: DatabaseTransaction,
    invoice: typeof invoices.$inferSelect,
  ): Promise<{ correctionsCents: number; paymentsCents: number; outstandingCents: number }> {
    const corrections = await transaction
      .select({ amountCents: invoiceCorrections.amountCents })
      .from(invoiceCorrections)
      .where(
        and(
          eq(invoiceCorrections.tenantId, invoice.tenantId),
          eq(invoiceCorrections.invoiceId, invoice.id),
        ),
      );
    const paymentsForInvoice = await transaction
      .select({ amountCents: paymentAllocations.amountCents })
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
          eq(paymentAllocations.tenantId, invoice.tenantId),
          eq(paymentAllocations.invoiceId, invoice.id),
          isNull(paymentReversals.id),
        ),
      );
    const correctionsCents = corrections.reduce((sum, row) => sum + row.amountCents, 0);
    const paymentsCents = paymentsForInvoice.reduce((sum, row) => sum + row.amountCents, 0);
    const outstandingCents = invoice.grandTotalCents - correctionsCents - paymentsCents;
    if (outstandingCents < 0) throw new PaymentAllocationExceededError();
    return { correctionsCents, paymentsCents, outstandingCents };
  }

  private async paymentUsage(
    transaction: DatabaseTransaction,
    tenantId: string,
    paymentId: string,
  ) {
    const active = await transaction
      .select({ amountCents: paymentAllocations.amountCents })
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
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.paymentId, paymentId),
          isNull(paymentReversals.id),
        ),
      );
    return { allocatedCents: active.reduce((sum, row) => sum + row.amountCents, 0) };
  }

  private async paymentView(
    transaction: DatabaseTransaction,
    tenantId: string,
    payment: typeof payments.$inferSelect,
  ): Promise<BillingPaymentView> {
    const usage = await this.paymentUsage(transaction, tenantId, payment.id);
    const allocationHistory = await transaction
      .select({
        allocationId: paymentAllocations.id,
        invoiceId: paymentAllocations.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        amountCents: paymentAllocations.amountCents,
        allocatedAt: paymentAllocations.createdAt,
        reversedAt: paymentReversals.reversedAt,
        reversalReason: paymentReversals.reason,
      })
      .from(paymentAllocations)
      .innerJoin(
        invoices,
        and(
          eq(invoices.tenantId, paymentAllocations.tenantId),
          eq(invoices.id, paymentAllocations.invoiceId),
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
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.paymentId, payment.id),
        ),
      )
      .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
    return {
      id: payment.id,
      organizationId: payment.organizationId,
      payerReference: payment.payerReference,
      payerNameSnapshot: payment.payerNameSnapshot,
      amountCents: payment.amountCents,
      currency: payment.currency,
      receivedAt: payment.receivedAt,
      method: payment.method,
      reference: payment.reference,
      allocatedCents: usage.allocatedCents,
      remainingCents: payment.amountCents - usage.allocatedCents,
      allocationHistory,
    };
  }

  private async recipientSnapshot(
    transaction: DatabaseTransaction,
    tenantId: string,
    invoice: typeof invoices.$inferSelect,
    lines: Array<typeof invoiceLines.$inferSelect>,
  ): Promise<Record<string, unknown>> {
    if (invoice.recipientType === 'payer') {
      if (!invoice.payerArrangementId) throw new InvoiceRecipientInvalidError();
      const [arrangement] = await transaction
        .select()
        .from(payerArrangements)
        .where(
          and(
            eq(payerArrangements.tenantId, tenantId),
            eq(payerArrangements.id, invoice.payerArrangementId),
            eq(payerArrangements.organizationId, invoice.organizationId),
            eq(payerArrangements.clientId, invoice.clientId),
          ),
        )
        .limit(1);
      const dates = lines.map((line) => line.serviceDate).sort();
      if (
        !arrangement ||
        arrangement.arrangementType !== 'direct_payer_billing' ||
        arrangement.mandateStatus !== 'authorized' ||
        arrangement.recipientType === 'client' ||
        !arrangement.recipientName?.trim() ||
        !arrangement.recipientAddress?.trim() ||
        arrangement.validFrom > (dates[0] ?? currentDate()) ||
        (arrangement.validUntil !== null &&
          arrangement.validUntil < (dates.at(-1) ?? currentDate()))
      )
        throw new InvoiceRecipientInvalidError();
      return {
        type: 'payer',
        name: arrangement.recipientName.trim(),
        address: arrangement.recipientAddress.trim(),
        payerReference: arrangement.payerReference,
        payerType: arrangement.payerType,
        arrangementType: arrangement.arrangementType,
        mandateReference: arrangement.documentedReference,
      };
    }
    const [client] = await transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, invoice.clientId)))
      .limit(1);
    const today = currentDate();
    const [address] = await transaction
      .select()
      .from(clientAddresses)
      .where(
        and(
          eq(clientAddresses.tenantId, tenantId),
          eq(clientAddresses.clientId, invoice.clientId),
          or(eq(clientAddresses.addressType, 'billing'), eq(clientAddresses.addressType, 'home')),
          or(isNull(clientAddresses.validFrom), lte(clientAddresses.validFrom, today)),
          or(isNull(clientAddresses.validUntil), gte(clientAddresses.validUntil, today)),
        ),
      )
      .orderBy(desc(clientAddresses.addressType), desc(clientAddresses.isPrimary))
      .limit(1);
    if (!client || !address) throw new InvoiceRecipientInvalidError();
    return {
      type: 'client',
      name: `${client.preferredName?.trim() || client.firstName} ${client.lastName}`,
      address: formatPostalAddress(address),
      email: client.email,
      phone: client.phone,
    };
  }

  private invoicePdfData(
    invoice: typeof invoices.$inferSelect,
    issuerSnapshot: Record<string, unknown> | null,
    recipientSnapshot: Record<string, unknown> | null,
    lines: Array<typeof invoiceLines.$inferSelect>,
  ): InvoicePdfData {
    if (
      !issuerSnapshot ||
      !recipientSnapshot ||
      !invoice.invoiceNumber ||
      !invoice.issueDate ||
      !invoice.dueDate
    ) {
      throw new InvoicePdfNotReadyError();
    }
    return {
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      servicePeriodFrom: invoice.servicePeriodFrom,
      servicePeriodUntil: invoice.servicePeriodUntil,
      issuer: {
        legalName: requiredSnapshotString(issuerSnapshot, 'legalName'),
        tradingName: requiredSnapshotString(issuerSnapshot, 'tradingName'),
        address: requiredSnapshotString(issuerSnapshot, 'address'),
        taxNumber: optionalSnapshotString(issuerSnapshot, 'taxNumber'),
        vatId: optionalSnapshotString(issuerSnapshot, 'vatId'),
        bankAccountHolder: optionalSnapshotString(issuerSnapshot, 'bankAccountHolder'),
        iban: optionalSnapshotString(issuerSnapshot, 'iban'),
        bic: optionalSnapshotString(issuerSnapshot, 'bic'),
        taxExemptionBasis: optionalSnapshotString(issuerSnapshot, 'taxExemptionBasis'),
      },
      recipient: {
        name: requiredSnapshotString(recipientSnapshot, 'name'),
        address: requiredSnapshotString(recipientSnapshot, 'address'),
        payerReference: optionalSnapshotString(recipientSnapshot, 'payerReference'),
        payerType: optionalSnapshotString(recipientSnapshot, 'payerType'),
      },
      currency: invoice.currency,
      lines: lines.map((line) => ({
        serviceCode: line.serviceCodeSnapshot,
        serviceName: line.serviceNameSnapshot,
        serviceDate: line.serviceDate,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        taxTreatment: line.taxTreatment,
        taxRateBasisPoints: line.taxRateBasisPoints,
        netCents: line.netCents,
        taxCents: line.taxCents,
        grossCents: line.grossCents,
        fundingReference: line.fundingLabelSnapshot,
      })),
      subtotalCents: invoice.subtotalCents,
      taxTotalCents: invoice.taxTotalCents,
      grandTotalCents: invoice.grandTotalCents,
    };
  }

  private correctionPdfData(
    invoice: typeof invoices.$inferSelect,
    correction: typeof invoiceCorrections.$inferSelect,
    lines: Array<typeof invoiceLines.$inferSelect>,
    selections: InvoiceCorrectionInput['lines'],
    reason: string,
    outstandingAfterCorrectionCents: number,
  ): CorrectionPdfData {
    const base = this.invoicePdfData(
      invoice,
      invoice.issuerSnapshot,
      invoice.recipientSnapshot,
      lines,
    );
    const lineById = new Map(lines.map((line) => [line.id, line]));
    return {
      ...base,
      correctionNumber: correction.correctionNumber,
      issueDate: invoice.issueDate ?? currentDate(),
      correctionDate: correction.createdAt.toISOString().slice(0, 10),
      originalIssueDate: invoice.issueDate,
      reason,
      correctionAmountCents: correction.amountCents,
      outstandingAfterCorrectionCents,
      correctionLines: selections.map((selection) => ({
        serviceName: lineById.get(selection.invoiceLineId)?.serviceNameSnapshot ?? 'Leistung',
        amountCents: selection.amountCents,
      })),
    };
  }

  private async nextDocumentVersion(
    transaction: DatabaseTransaction,
    tenantId: string,
    invoiceId: string,
  ): Promise<number> {
    const [latest] = await transaction
      .select({ version: invoiceDocuments.documentVersion })
      .from(invoiceDocuments)
      .where(
        and(eq(invoiceDocuments.tenantId, tenantId), eq(invoiceDocuments.invoiceId, invoiceId)),
      )
      .orderBy(desc(invoiceDocuments.documentVersion))
      .limit(1);
    return (latest?.version ?? 0) + 1;
  }

  private async generateInvoicePdf(
    tenantId: string,
    organizationId: string,
    invoiceId: string,
    documentId: string,
    documentVersion: number,
    data: InvoicePdfData,
  ): Promise<void> {
    const objectKey = `billing/invoices/${tenantId}/${invoiceId}/v${documentVersion}.pdf`;
    try {
      const config = await this.documents?.renderingConfiguration(
        tenantId,
        organizationId,
        'invoice',
      );
      const locale = config?.template.defaultLocale ?? 'de';
      const bytes = await this.pdfRenderer.renderInvoice(data, config?.branding, locale);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await this.storage.put({ key: objectKey, body: bytes, contentType: 'application/pdf' });
      await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
        await transaction
          .update(invoiceDocuments)
          .set({
            status: 'ready',
            objectKey,
            sha256,
            rendererVersion: 2,
            templateVersion: config?.template.version ?? 0,
            locale,
            failureCode: null,
            generatedAt: new Date(),
          })
          .where(and(eq(invoiceDocuments.tenantId, tenantId), eq(invoiceDocuments.id, documentId)));
      });
    } catch {
      await this.markDocumentFailed(tenantId, documentId);
    }
  }

  private async generateCorrectionPdf(
    tenantId: string,
    organizationId: string,
    invoiceId: string,
    correctionId: string,
    documentId: string,
    documentVersion: number,
    data: CorrectionPdfData,
  ): Promise<void> {
    const objectKey = `billing/invoices/${tenantId}/${invoiceId}/corrections/${correctionId}/v${documentVersion}.pdf`;
    try {
      const config = await this.documents?.renderingConfiguration(
        tenantId,
        organizationId,
        'invoice_correction',
      );
      const locale = config?.template.defaultLocale ?? 'de';
      const bytes = await this.pdfRenderer.renderCorrection(data, config?.branding, locale);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await this.storage.put({ key: objectKey, body: bytes, contentType: 'application/pdf' });
      await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
        await transaction
          .update(invoiceDocuments)
          .set({
            status: 'ready',
            objectKey,
            sha256,
            rendererVersion: 2,
            templateVersion: config?.template.version ?? 0,
            locale,
            failureCode: null,
            generatedAt: new Date(),
          })
          .where(and(eq(invoiceDocuments.tenantId, tenantId), eq(invoiceDocuments.id, documentId)));
      });
    } catch {
      await this.markDocumentFailed(tenantId, documentId);
    }
  }

  private async markDocumentFailed(tenantId: string, documentId: string): Promise<void> {
    try {
      await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
        await transaction
          .update(invoiceDocuments)
          .set({
            status: 'failed',
            objectKey: null,
            sha256: null,
            failureCode: 'PDF_GENERATION_FAILED',
          })
          .where(and(eq(invoiceDocuments.tenantId, tenantId), eq(invoiceDocuments.id, documentId)));
      });
    } catch {
      // The invoice remains issued; the administrator can request regeneration from its snapshot.
    }
  }

  private async candidatesForService(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    row: CandidateServiceRow,
    profile: typeof billingProfiles.$inferSelect | null,
    excludeInvoiceId?: string,
  ): Promise<BillingCandidateView[]> {
    const blockers: string[] = [];
    const serviceDate = row.serviceDate;
    const evidence = await this.evidence.getBillingReadiness(
      transaction,
      principal.tenantId,
      row.visitId,
    );
    const price = await this.prices.getEffectiveForBilling(
      transaction,
      principal.tenantId,
      row.serviceId,
      {
        organizationId: row.organizationId,
        facilityId: row.facilityId,
        validAt: serviceDate,
      },
    );
    let serviceAmountCents: number | null = null;
    let unitPriceCents: number | null = price?.priceCents ?? null;
    if (!price) blockers.push('PRICE_UNAVAILABLE');
    if (row.actualQuantity === null) blockers.push('SERVICE_QUANTITY_MISSING');
    if (price && row.actualQuantity !== null) {
      try {
        serviceAmountCents = calculateServiceAmountCents({
          unitPriceCents: price.priceCents,
          pricingUnit: price.pricingUnit,
          serviceUnit: row.unit,
          quantity: row.actualQuantity,
        });
      } catch {
        blockers.push('PRICE_UNIT_MISMATCH');
      }
    }
    if (evidence.executionStatus !== 'completed') blockers.push('EXECUTION_INCOMPLETE');
    if (evidence.documentationStatus !== 'finalized') blockers.push('DOCUMENTATION_INCOMPLETE');
    if (!evidence.evidencePackageId) blockers.push('EVIDENCE_MISSING');
    else if (!evidence.isCurrent || evidence.acknowledgementStatus === 'outdated') {
      blockers.push('EVIDENCE_OUTDATED');
    }
    if (profile?.requireAcknowledgement && evidence.acknowledgementStatus !== 'acknowledged') {
      blockers.push('ACKNOWLEDGEMENT_REQUIRED');
    }
    if (!this.profileIsComplete(profile, row.organizationName, row.organizationAddress)) {
      blockers.push('INVOICE_ISSUER_INCOMPLETE');
    }
    if (profile?.requiredInvoiceFormat === 'structured')
      blockers.push('INVOICE_FORMAT_UNSUPPORTED');

    const allocations = await this.benefits.allocationsForBilling(
      transaction,
      principal.tenantId,
      row.performedServiceId,
    );
    const allocatedCents = allocations.reduce(
      (total, allocation) => total + allocation.amountCents,
      0,
    );
    if (serviceAmountCents !== null && allocatedCents > serviceAmountCents) {
      blockers.push('FUNDING_ALLOCATION_EXCEEDS_SERVICE');
    }
    const reservations = await this.reservationsForService(
      transaction,
      principal.tenantId,
      row.performedServiceId,
      excludeInvoiceId,
    );
    let remainingServiceCents =
      serviceAmountCents === null
        ? null
        : Math.max(
            0,
            serviceAmountCents -
              [...reservations.values()].reduce(
                (total, reservation) => total + reservation.billedCents + reservation.reservedCents,
                0,
              ),
          );
    const slices: Array<{
      allocation: BenefitBillingAllocation | null;
      amountCents: number | null;
      sourceKey: string;
    }> = allocations.map((allocation) => ({
      allocation,
      amountCents: allocation.amountCents,
      sourceKey: `allocation:${allocation.id}`,
    }));
    if (serviceAmountCents !== null) {
      const privateRemainder = serviceAmountCents - allocatedCents;
      if (privateRemainder > 0) {
        slices.push({ allocation: null, amountCents: privateRemainder, sourceKey: 'self-pay' });
      }
    } else if (allocations.length === 0) {
      slices.push({ allocation: null, amountCents: null, sourceKey: 'self-pay' });
    }
    if (slices.length === 0 && serviceAmountCents !== null && serviceAmountCents > 0) {
      slices.push({ allocation: null, amountCents: serviceAmountCents, sourceKey: 'self-pay' });
    }

    const clientHasAddress = await this.hasBillingAddress(
      transaction,
      principal.tenantId,
      row.clientId,
    );
    const result: BillingCandidateView[] = [];
    for (const slice of slices) {
      const sourceBlockers = [...blockers];
      if (slice.allocation?.status !== undefined && slice.allocation.status !== 'confirmed') {
        sourceBlockers.push('FUNDING_ALLOCATION_PROVISIONAL');
      }
      if (slice.allocation && slice.amountCents !== null && slice.amountCents <= 0) {
        sourceBlockers.push('BILLING_FUNDING_NOT_RESOLVED');
      }
      const reservation = reservations.get(slice.sourceKey) ?? { billedCents: 0, reservedCents: 0 };
      const sourceAvailableCents =
        slice.amountCents === null
          ? 0
          : Math.max(0, slice.amountCents - reservation.billedCents - reservation.reservedCents);
      const availableCents =
        remainingServiceCents === null
          ? sourceAvailableCents
          : Math.min(sourceAvailableCents, remainingServiceCents);
      if (remainingServiceCents !== null) remainingServiceCents -= availableCents;
      if (availableCents === 0) sourceBlockers.push('BILLING_SERVICE_ALREADY_INVOICED');

      let arrangement: typeof payerArrangements.$inferSelect | null = null;
      if (slice.allocation) {
        arrangement = await this.activeDirectArrangement(
          transaction,
          principal.tenantId,
          row,
          slice.allocation,
          serviceDate,
        );
      }
      if (!arrangement && !clientHasAddress) sourceBlockers.push('INVOICE_RECIPIENT_INVALID');
      if (arrangement && (!arrangement.recipientName || !arrangement.recipientAddress)) {
        sourceBlockers.push('INVOICE_RECIPIENT_INVALID');
      }
      const uniqueBlockers = [...new Set(sourceBlockers)];
      result.push({
        id: `${row.performedServiceId}:${slice.sourceKey}`,
        sourceKey: slice.sourceKey,
        performedServiceId: row.performedServiceId,
        visitId: row.visitId,
        clientId: row.clientId,
        clientName: `${row.clientPreferredName || row.clientFirstName} ${row.clientLastName}`,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        facilityId: row.facilityId,
        facilityName: row.facilityName,
        serviceId: row.serviceId,
        serviceCode: row.serviceCode,
        serviceName: row.serviceName,
        serviceDate,
        quantity: row.actualQuantity ?? '0',
        unit: row.unit,
        pricingUnit: price?.pricingUnit ?? null,
        servicePriceId: price?.id ?? null,
        unitPriceCents,
        serviceAmountCents,
        fundingAllocationId: slice.allocation?.id ?? null,
        fundingSourceId: slice.allocation?.fundingSourceId ?? null,
        fundingLabel: slice.allocation?.sourceLabel ?? slice.allocation?.sourceType ?? null,
        fundingStatus: slice.allocation?.status ?? null,
        amountCents: slice.amountCents,
        amountAlreadyBilledCents: reservation.billedCents,
        amountReservedCents: reservation.reservedCents,
        remainingBillableAmountCents: availableCents,
        recommendedRecipient: arrangement ? 'payer' : 'client',
        recommendedPayerArrangementId: arrangement?.id ?? null,
        evidencePackageId: evidence.evidencePackageId,
        evidenceSnapshotHash: evidence.snapshotHash,
        evidenceStatus: evidence.acknowledgementStatus,
        ready: uniqueBlockers.length === 0,
        blockers: uniqueBlockers,
      });
    }
    return result;
  }

  private async activeDirectArrangement(
    transaction: DatabaseTransaction,
    tenantId: string,
    row: CandidateServiceRow,
    allocation: BenefitBillingAllocation,
    serviceDate: string,
  ) {
    const arrangements = await transaction
      .select()
      .from(payerArrangements)
      .where(
        and(
          eq(payerArrangements.tenantId, tenantId),
          eq(payerArrangements.organizationId, row.organizationId),
          eq(payerArrangements.clientId, row.clientId),
          eq(payerArrangements.fundingSourceId, allocation.fundingSourceId),
          eq(payerArrangements.arrangementType, 'direct_payer_billing'),
          eq(payerArrangements.mandateStatus, 'authorized'),
          lte(payerArrangements.validFrom, serviceDate),
          or(isNull(payerArrangements.validUntil), gte(payerArrangements.validUntil, serviceDate)),
        ),
      )
      .orderBy(desc(payerArrangements.validFrom), desc(payerArrangements.createdAt))
      .limit(1);
    return arrangements[0] ?? null;
  }

  private async reservationsForService(
    transaction: DatabaseTransaction,
    tenantId: string,
    performedServiceId: string,
    excludeInvoiceId?: string,
  ) {
    const rows = await transaction
      .select({
        invoiceId: invoiceLines.invoiceId,
        lineId: invoiceLines.id,
        sourceKey: invoiceLines.sourceKey,
        amountCents: invoiceLines.amountCents,
        status: invoices.status,
        correctionAmountCents: invoiceCorrectionLines.amountCents,
      })
      .from(invoiceLines)
      .innerJoin(
        invoices,
        and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)),
      )
      .leftJoin(
        invoiceCorrectionLines,
        and(
          eq(invoiceCorrectionLines.tenantId, invoiceLines.tenantId),
          eq(invoiceCorrectionLines.invoiceLineId, invoiceLines.id),
        ),
      )
      .where(
        and(
          eq(invoiceLines.tenantId, tenantId),
          eq(invoiceLines.performedServiceId, performedServiceId),
          inArray(invoices.status, ['draft', 'issued']),
          excludeInvoiceId ? sql`${invoiceLines.invoiceId} <> ${excludeInvoiceId}` : undefined,
        ),
      );
    const byLine = new Map<
      string,
      { sourceKey: string; amountCents: number; status: string; corrections: number }
    >();
    for (const row of rows) {
      const existing = byLine.get(row.lineId) ?? {
        sourceKey: row.sourceKey,
        amountCents: row.amountCents,
        status: row.status,
        corrections: 0,
      };
      existing.corrections += row.correctionAmountCents ?? 0;
      byLine.set(row.lineId, existing);
    }
    const result = new Map<string, { billedCents: number; reservedCents: number }>();
    for (const row of byLine.values()) {
      const source = result.get(row.sourceKey) ?? { billedCents: 0, reservedCents: 0 };
      if (row.status === 'draft') source.reservedCents += row.amountCents;
      else source.billedCents += Math.max(0, row.amountCents - row.corrections);
      result.set(row.sourceKey, source);
    }
    return result;
  }

  private async profileForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ) {
    const [profile] = await transaction
      .select()
      .from(billingProfiles)
      .where(
        and(
          eq(billingProfiles.tenantId, tenantId),
          eq(billingProfiles.organizationId, organizationId),
        ),
      )
      .limit(1);
    return profile ?? null;
  }

  private async hasBillingAddress(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean> {
    const [address] = await transaction
      .select({ id: clientAddresses.id })
      .from(clientAddresses)
      .where(
        and(
          eq(clientAddresses.tenantId, tenantId),
          eq(clientAddresses.clientId, clientId),
          or(eq(clientAddresses.addressType, 'billing'), eq(clientAddresses.addressType, 'home')),
          or(isNull(clientAddresses.validFrom), lte(clientAddresses.validFrom, currentDate())),
          or(isNull(clientAddresses.validUntil), gte(clientAddresses.validUntil, currentDate())),
        ),
      )
      .orderBy(desc(clientAddresses.isPrimary), asc(clientAddresses.addressType))
      .limit(1);
    return Boolean(address);
  }

  private profileIsComplete(
    profile: typeof billingProfiles.$inferSelect | null,
    organizationName: string,
    address: string | null,
  ): boolean {
    return Boolean(
      profile &&
      (organizationName.trim() || '').length > 0 &&
      address?.trim() &&
      profile.bankAccountHolder?.trim() &&
      profile.iban?.trim() &&
      profile.paymentTermsDays >= 0,
    );
  }

  private validateProfileInput(input: BillingProfileInput): void {
    if (
      !input.organizationId ||
      !Number.isSafeInteger(input.paymentTermsDays) ||
      input.paymentTermsDays < 0 ||
      input.paymentTermsDays > 180 ||
      !/^[A-Za-z0-9/-]{0,24}$/.test(input.invoiceNumberPrefix.trim()) ||
      input.defaultCurrency !== 'EUR' ||
      !['taxable', 'tax_exempt', 'small_business'].includes(input.taxTreatment) ||
      !['pdf', 'structured'].includes(input.requiredInvoiceFormat) ||
      (input.taxTreatment === 'taxable' &&
        (!Number.isSafeInteger(input.taxRateBasisPoints) ||
          (input.taxRateBasisPoints ?? 0) < 1 ||
          (input.taxRateBasisPoints ?? 0) > 10_000)) ||
      (input.taxTreatment !== 'taxable' &&
        (!optionalText(input.taxExemptionBasis) ||
          optionalText(input.taxExemptionBasis)!.length > 300)) ||
      (input.expectedVersion !== undefined &&
        (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1))
    ) {
      throw new InvalidBillingProfileError();
    }
  }

  private validatePayerArrangement(input: PayerArrangementInput): void {
    if (
      !input.organizationId ||
      !input.clientId ||
      !['statutory_insurance', 'private_insurance', 'self_pay', 'other'].includes(
        input.payerType,
      ) ||
      (input.payerId != null && !isUuid(input.payerId)) ||
      (input.mandateDocumentArtifactId != null && !isUuid(input.mandateDocumentArtifactId)) ||
      !['direct_payer_billing', 'reimbursement_to_client', 'other'].includes(
        input.arrangementType,
      ) ||
      !['client', 'insurance', 'contact', 'other'].includes(input.recipientType) ||
      !['authorized', 'pending', 'revoked', 'not_applicable'].includes(input.mandateStatus) ||
      !isIsoDate(input.validFrom) ||
      (input.validUntil !== undefined &&
        input.validUntil !== null &&
        (!isIsoDate(input.validUntil) || input.validUntil < input.validFrom))
    ) {
      throw new InvalidPayerArrangementError();
    }
    if (input.arrangementType === 'direct_payer_billing' && input.mandateStatus === 'authorized') {
      if (
        input.recipientType === 'client' ||
        !optionalText(input.documentedSource) ||
        !optionalText(input.documentedReference) ||
        !optionalText(input.recipientName) ||
        !optionalText(input.recipientAddress)
      ) {
        throw new InvalidPayerArrangementError();
      }
    }
    if (
      input.recipientType !== 'client' &&
      (!optionalText(input.recipientName) || !optionalText(input.recipientAddress))
    ) {
      throw new InvalidPayerArrangementError();
    }
  }

  private requireOrganization(
    principal: AuthorizationPrincipal,
    action: BillingPermission,
    organizationId: string,
  ): void {
    assertCan(principal, {
      action,
      resource: { tenantId: principal.tenantId, organizationId },
    });
  }

  private requireClient(
    principal: AuthorizationPrincipal,
    action: BillingPermission,
    clientId: string,
    organizationId: string,
    facilityId?: string | null,
  ): void {
    assertCan(principal, {
      action,
      resource: {
        tenantId: principal.tenantId,
        clientId,
        organizationId,
        ...(facilityId ? { facilityId } : {}),
      },
    });
  }

  private auditRecord(
    principal: AuthorizationPrincipal,
    request: RequestContext,
    context: AuditContext,
    input: {
      id: string;
      action: string;
      resourceType: string;
      resourceId: string;
      metadata: Record<string, unknown>;
    },
  ) {
    return {
      id: input.id,
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

interface CandidateServiceRow {
  performedServiceId: string;
  visitId: string;
  executionId: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  unit: 'occurrence' | 'minute' | 'hour' | 'day';
  actualQuantity: string | null;
  status: string;
  clientId: string;
  clientFirstName: string;
  clientPreferredName: string | null;
  clientLastName: string;
  organizationId: string;
  organizationName: string;
  organizationAddress: string | null;
  facilityId: string;
  facilityName: string;
  timezone: string;
  actualStart: Date;
  serviceDate: string;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'invoice';
}

function requiredSnapshotString(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  if (typeof value !== 'string' || !value.trim()) throw new InvoicePdfNotReadyError();
  return value;
}

function optionalSnapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function formatPostalAddress(address: typeof clientAddresses.$inferSelect): string {
  return [
    [address.street, address.houseNumber].filter(Boolean).join(' '),
    address.addressAddition,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.countryCode,
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeIban(value: string | null | undefined): string | null {
  const normalized = optionalText(value)?.replaceAll(' ', '').toUpperCase() ?? null;
  if (normalized && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) {
    throw new InvalidBillingProfileError();
  }
  return normalized;
}

function normalizeBic(value: string | null | undefined): string | null {
  const normalized = optionalText(value)?.replaceAll(' ', '').toUpperCase() ?? null;
  if (normalized && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalized)) {
    throw new InvalidBillingProfileError();
  }
  return normalized;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function payerMatchesArrangementType(
  payerType: (typeof payers.$inferSelect)['payerType'],
  arrangementType: PayerArrangementInput['payerType'],
): boolean {
  return (
    (payerType === 'statutory_pflegekasse' && arrangementType === 'statutory_insurance') ||
    (payerType === 'private_pflegeversicherung' && arrangementType === 'private_insurance') ||
    (payerType === 'self_pay' && arrangementType === 'self_pay') ||
    (payerType === 'other' && arrangementType === 'other')
  );
}

function validateExportRange(from: string, until: string): void {
  if (!isIsoDate(from) || !isIsoDate(until) || from > until) {
    throw new ExportFilterInvalidError();
  }
  const days =
    (new Date(`${until}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
    86_400_000;
  if (days > 366) throw new ExportFilterInvalidError();
}

function billingScopeConditions(
  principal: AuthorizationPrincipal,
  permission: 'billing.read' | 'billing.payments.read',
): SQL | null {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  if (
    grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
  ) {
    return sql`true`;
  }
  const organizations = grants
    .filter((grant) => grant.scopeType === 'organization')
    .map((grant) => grant.scopeId);
  const facilities = grants
    .filter((grant) => grant.scopeType === 'facility')
    .map((grant) => grant.scopeId);
  const clauses: SQL[] = [];
  if (organizations.length) clauses.push(inArray(invoices.organizationId, organizations));
  if (facilities.length) clauses.push(inArray(invoices.facilityId, facilities));
  return or(...clauses) ?? null;
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createBillingApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  storage: ObjectStorage,
  prices: ServicePriceApplicationService,
  benefits: BenefitsApplicationService,
  evidence: ServiceEvidenceApplicationService,
  documents?: Pick<
    DocumentsApplicationService,
    'renderingConfiguration' | 'artifactForSourceAuthorization'
  >,
): BillingApplicationService {
  return new BillingApplicationService(
    unitOfWork,
    audit,
    outbox,
    storage,
    prices,
    benefits,
    evidence,
    documents,
  );
}
