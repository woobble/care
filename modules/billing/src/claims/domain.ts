import type { ClaimFundingSourceType, PayerSubmissionChannel, PayerType } from './payer-schema';
import type { ClaimStatus } from './schema';

export interface PayerInput {
  organizationId: string;
  payerType: PayerType;
  name: string;
  payerIdentifier?: string | null;
  addressText?: string | null;
  billingContactName?: string | null;
  billingContactEmail?: string | null;
  billingContactPhone?: string | null;
  submissionInstructions?: string | null;
  status: 'active' | 'inactive';
  validFrom: string;
  validUntil?: string | null;
  expectedVersion?: number;
}

export interface PayerBillingProfileInput {
  organizationId: string;
  payerId: string;
  channel: PayerSubmissionChannel;
  fundingSourceType: ClaimFundingSourceType;
  validFrom: string;
  validUntil?: string | null;
  sourceName: string;
  sourceVersion: string;
  sourceEffectiveDate: string;
  sourceUrl?: string | null;
  requiresClientInsuranceNumber: boolean;
  requiresPayerIdentifier: boolean;
  requiresAcknowledgement: boolean;
  requiresMandate: boolean;
  requiresInvoicePdf: boolean;
  requiresEvidencePdf: boolean;
  requiresMandateDocument: boolean;
  requiresExternalReference: boolean;
  requiresProviderRecognition: boolean;
  expectedVersion: number;
}

export interface ClaimLineSelection {
  invoiceLineId: string;
  amountCents: number;
}

export interface CreateClaimInput {
  invoiceId: string;
  expectedInvoiceVersion: number;
  payerArrangementId: string;
  payerBillingProfileId?: string | null;
  lines: ClaimLineSelection[];
}

export interface ClaimSubmitInput {
  expectedVersion: number;
  externalReference?: string | null;
  protectedNote?: string | null;
}

export interface ClaimDecisionLineInput {
  claimLineId: string;
  acceptedCents: number;
  rejectedCents: number;
}

export interface ClaimDecisionInput {
  expectedVersion: number;
  decision: 'accepted' | 'partially_accepted' | 'rejected' | 'clarification_required';
  decisionDate: string;
  externalReference?: string | null;
  acceptedCents: number;
  rejectedCents: number;
  reasonCode?: string | null;
  protectedExplanation?: string | null;
  lines: ClaimDecisionLineInput[];
}

export interface ClaimReadinessFinding {
  code: string;
  field: string;
  detail: string;
  blocking: true;
}

export interface ClaimReadiness {
  claimId: string;
  ready: boolean;
  blockers: ClaimReadinessFinding[];
  requiredEvidencePackageIds: string[];
  invoiceDocumentId: string | null;
  mandateDocumentArtifactId: string | null;
}

export interface ClaimPackageDocumentView {
  id: string;
  documentKind: 'invoice_pdf' | 'evidence_pdf' | 'mandate_pdf' | 'claim_summary';
  fileName: string;
  sha256: string;
  sourceVersion: string;
  documentArtifactId: string | null;
  invoiceDocumentId: string | null;
}

export class ClaimsDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ClaimNotReadyError extends ClaimsDomainError {
  constructor(readonly blockers: readonly ClaimReadinessFinding[]) {
    super('CLAIM_NOT_READY', 'The claim has unresolved readiness blockers');
  }
}

export class ClaimNotFoundError extends ClaimsDomainError {
  constructor() {
    super('CLAIM_NOT_FOUND', 'The billing claim could not be found');
  }
}

export class PayerNotFoundError extends ClaimsDomainError {
  constructor() {
    super('PAYER_NOT_FOUND', 'The payer could not be found in this provider scope');
  }
}

export class PayerProfileNotFoundError extends ClaimsDomainError {
  constructor() {
    super('PAYER_PROFILE_NOT_FOUND', 'No applicable payer requirements profile was found');
  }
}

export class PayerProfileVersionConflictError extends ClaimsDomainError {
  constructor() {
    super('PAYER_PROFILE_VERSION_CONFLICT', 'The payer profile changed in another Office session');
  }
}

export class PayerInputInvalidError extends ClaimsDomainError {
  constructor() {
    super('PAYER_CONFIGURATION_INVALID', 'The payer configuration is incomplete or invalid');
  }
}

export class ClaimSourceInvalidError extends ClaimsDomainError {
  constructor() {
    super(
      'CLAIM_SOURCE_INVALID',
      'The invoice, payer arrangement, and funding portion do not match',
    );
  }
}

export class ClaimInvalidStateError extends ClaimsDomainError {
  constructor() {
    super('CLAIM_INVALID_STATE', 'The claim is not in a state that allows this operation');
  }
}

export class ClaimVersionConflictError extends ClaimsDomainError {
  constructor() {
    super('CLAIM_VERSION_CONFLICT', 'The claim changed in another Office session');
  }
}

export class ClaimAmountReservedError extends ClaimsDomainError {
  constructor() {
    super(
      'CLAIM_AMOUNT_RESERVED',
      'The selected invoice portion is already reserved by another claim',
    );
  }
}

export class ClaimDecisionInvalidError extends ClaimsDomainError {
  constructor() {
    super(
      'CLAIM_DECISION_INVALID',
      'The payer decision amounts do not match the submitted claim lines',
    );
  }
}

export class ClaimPaymentAmountExceededError extends ClaimsDomainError {
  constructor() {
    super(
      'CLAIM_PAYMENT_AMOUNT_EXCEEDED',
      'The payment allocation exceeds the accepted unpaid claim amount',
    );
  }
}

export function validatePayerInput(input: PayerInput): void {
  if (
    !input.organizationId ||
    !input.name.trim() ||
    input.name.trim().length > 200 ||
    !isIsoDate(input.validFrom) ||
    (input.validUntil !== undefined && input.validUntil !== null && !isIsoDate(input.validUntil)) ||
    (input.validUntil !== undefined &&
      input.validUntil !== null &&
      input.validUntil < input.validFrom) ||
    !['statutory_pflegekasse', 'private_pflegeversicherung', 'self_pay', 'other'].includes(
      input.payerType,
    ) ||
    !['active', 'inactive'].includes(input.status)
  ) {
    throw new PayerInputInvalidError();
  }
  for (const [value, max] of [
    [input.payerIdentifier, 80],
    [input.addressText, 1000],
    [input.billingContactName, 200],
    [input.billingContactEmail, 254],
    [input.billingContactPhone, 80],
    [input.submissionInstructions, 2000],
  ] as const) {
    if ((value?.length ?? 0) > max) throw new PayerInputInvalidError();
  }
}

export function validatePayerProfileInput(input: PayerBillingProfileInput): void {
  if (
    !input.organizationId ||
    !input.payerId ||
    !isIsoDate(input.validFrom) ||
    (input.validUntil !== undefined && input.validUntil !== null && !isIsoDate(input.validUntil)) ||
    (input.validUntil !== undefined &&
      input.validUntil !== null &&
      input.validUntil < input.validFrom) ||
    !isIsoDate(input.sourceEffectiveDate) ||
    !input.sourceName.trim() ||
    input.sourceName.trim().length > 200 ||
    !input.sourceVersion.trim() ||
    input.sourceVersion.trim().length > 120 ||
    (input.sourceUrl && !/^https:\/\//i.test(input.sourceUrl)) ||
    (input.sourceUrl?.length ?? 0) > 1000 ||
    (input.channel === 'customer_reimbursement' && input.fundingSourceType === 'self_pay')
  ) {
    throw new PayerInputInvalidError();
  }
}

export function assertClaimDecision(input: {
  decision: ClaimDecisionInput['decision'];
  decisionDate: string;
  acceptedCents: number;
  rejectedCents: number;
  amountCents: number;
  lines: readonly ClaimDecisionLineInput[];
  claimLines: readonly { id: string; amountCents: number }[];
}): void {
  const linesById = new Map(input.claimLines.map((line) => [line.id, line]));
  if (
    !isIsoDate(input.decisionDate) ||
    !Number.isSafeInteger(input.acceptedCents) ||
    !Number.isSafeInteger(input.rejectedCents) ||
    input.acceptedCents < 0 ||
    input.rejectedCents < 0 ||
    input.acceptedCents + input.rejectedCents > input.amountCents ||
    (input.decision === 'clarification_required'
      ? input.lines.length !== 0
      : input.lines.length !== input.claimLines.length)
  ) {
    throw new ClaimDecisionInvalidError();
  }
  let accepted = 0;
  let rejected = 0;
  const seen = new Set<string>();
  for (const line of input.lines) {
    const source = linesById.get(line.claimLineId);
    if (
      !source ||
      seen.has(line.claimLineId) ||
      !Number.isSafeInteger(line.acceptedCents) ||
      !Number.isSafeInteger(line.rejectedCents) ||
      line.acceptedCents < 0 ||
      line.rejectedCents < 0 ||
      line.acceptedCents + line.rejectedCents > source.amountCents
    ) {
      throw new ClaimDecisionInvalidError();
    }
    seen.add(line.claimLineId);
    accepted += line.acceptedCents;
    rejected += line.rejectedCents;
  }
  if (accepted !== input.acceptedCents || rejected !== input.rejectedCents) {
    throw new ClaimDecisionInvalidError();
  }
  const validShape =
    (input.decision === 'accepted' && accepted === input.amountCents && rejected === 0) ||
    (input.decision === 'partially_accepted' &&
      accepted > 0 &&
      rejected > 0 &&
      accepted + rejected === input.amountCents) ||
    (input.decision === 'rejected' && accepted === 0 && rejected === input.amountCents) ||
    (input.decision === 'clarification_required' && accepted === 0 && rejected === 0);
  if (!validShape) throw new ClaimDecisionInvalidError();
}

export function isAllowedClaimTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return (
    (from === 'draft' && (to === 'ready' || to === 'cancelled')) ||
    (from === 'ready' && (to === 'submitted' || to === 'cancelled')) ||
    (from === 'submitted' &&
      ['accepted', 'partially_accepted', 'rejected', 'clarification_required'].includes(to)) ||
    (['partially_accepted', 'rejected', 'clarification_required'].includes(from) &&
      to === 'resubmitted')
  );
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
