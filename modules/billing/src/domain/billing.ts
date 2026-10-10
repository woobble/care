import { calculateServicePriceCents, type ServicePricingUnit } from '@care/services';
import type { ServiceUnit } from '@care/services';

export type TaxTreatment = 'taxable' | 'tax_exempt' | 'small_business';
export type ReceivableStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'corrected';

export interface InvoiceAmounts {
  netCents: number;
  taxCents: number;
  grossCents: number;
}

export function calculateServiceAmountCents(input: {
  unitPriceCents: number;
  pricingUnit: ServicePricingUnit;
  serviceUnit: ServiceUnit;
  quantity: string;
}): number {
  return calculateServicePriceCents(
    input.unitPriceCents,
    input.pricingUnit,
    input.serviceUnit,
    input.quantity,
  );
}

/** Service catalog prices are consumer-facing gross amounts; this preserves their billable total. */
export function calculateInvoiceAmounts(
  grossCents: number,
  treatment: TaxTreatment,
  taxRateBasisPoints: number | null,
): InvoiceAmounts {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
    throw new InvalidInvoiceAmountError();
  }
  if (treatment === 'taxable') {
    if (
      taxRateBasisPoints === null ||
      !Number.isSafeInteger(taxRateBasisPoints) ||
      taxRateBasisPoints < 1 ||
      taxRateBasisPoints > 10_000
    ) {
      throw new InvalidTaxConfigurationError();
    }
    const denominator = 10_000 + taxRateBasisPoints;
    const netCents = Number(
      (BigInt(grossCents) * 10_000n + BigInt(denominator / 2)) / BigInt(denominator),
    );
    return { netCents, taxCents: grossCents - netCents, grossCents };
  }
  if (taxRateBasisPoints !== null) throw new InvalidTaxConfigurationError();
  return { netCents: grossCents, taxCents: 0, grossCents };
}

export function deriveReceivableStatus(input: {
  invoiceCents: number;
  correctionsCents: number;
  paymentsCents: number;
  dueDate: string;
  asOfDate: string;
}): { status: ReceivableStatus; outstandingCents: number; paidCents: number } {
  if (
    !Number.isSafeInteger(input.invoiceCents) ||
    !Number.isSafeInteger(input.correctionsCents) ||
    !Number.isSafeInteger(input.paymentsCents) ||
    input.invoiceCents < 0 ||
    input.correctionsCents < 0 ||
    input.paymentsCents < 0 ||
    input.correctionsCents > input.invoiceCents
  ) {
    throw new InvalidReceivableFactsError();
  }
  const receivableCents = input.invoiceCents - input.correctionsCents;
  if (input.paymentsCents > receivableCents) throw new InvalidReceivableFactsError();
  const outstandingCents = receivableCents - input.paymentsCents;
  const status: ReceivableStatus =
    input.correctionsCents > 0 && receivableCents === 0 && input.paymentsCents === 0
      ? 'corrected'
      : outstandingCents === 0
        ? 'paid'
        : input.dueDate < input.asOfDate
          ? 'overdue'
          : input.paymentsCents > 0
            ? 'partially_paid'
            : 'unpaid';
  return { status, outstandingCents, paidCents: input.paymentsCents };
}

export function hasRequiredTaxIdentifier(
  grossCents: number,
  taxNumber: string | null,
  vatId: string | null,
): boolean {
  return grossCents <= 25_000 || Boolean(taxNumber?.trim() || vatId?.trim());
}

export function assertAvailableAmount(requestedCents: number, availableCents: number): void {
  if (
    !Number.isSafeInteger(requestedCents) ||
    !Number.isSafeInteger(availableCents) ||
    requestedCents <= 0
  ) {
    throw new InvalidInvoiceAmountError();
  }
  if (requestedCents > availableCents) throw new BillingAmountExceededError();
}

export function assertPaymentAllocation(input: {
  amountCents: number;
  paymentRemainingCents: number;
  invoiceOutstandingCents: number;
}): void {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PaymentAmountInvalidError();
  }
  if (
    input.amountCents > input.paymentRemainingCents ||
    input.amountCents > input.invoiceOutstandingCents
  ) {
    throw new PaymentAllocationExceededError();
  }
}

export function assertCorrectionAmount(amountCents: number, outstandingCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > outstandingCents) {
    throw new InvalidInvoiceCorrectionError();
  }
}

export function formatInvoiceNumber(prefix: string, year: number, sequence: number): string {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 9999 ||
    !Number.isSafeInteger(sequence) ||
    sequence <= 0
  ) {
    throw new InvalidInvoiceNumberError();
  }
  return `${prefix}${year}-${sequence.toString().padStart(6, '0')}`;
}

export function formatCorrectionNumber(prefix: string, year: number, sequence: number): string {
  const invoiceNumber = formatInvoiceNumber(prefix, year, sequence);
  const normalizedPrefix = prefix.endsWith('-') ? prefix.slice(0, -1) : prefix;
  return `${normalizedPrefix ? `${normalizedPrefix}-` : ''}RK-${invoiceNumber.slice(prefix.length)}`;
}

export class BillingDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInvoiceAmountError extends BillingDomainError {
  constructor() {
    super('BILLING_AMOUNT_EXCEEDED', 'The invoice amount must be a positive whole-cent amount');
  }
}

export class BillingAmountExceededError extends BillingDomainError {
  constructor() {
    super(
      'BILLING_AMOUNT_EXCEEDED',
      'The selected amount exceeds the service amount still available',
    );
  }
}

export class BillingCandidateNotReadyError extends BillingDomainError {
  constructor() {
    super('BILLING_CANDIDATE_NOT_READY', 'The performed service is not ready for billing');
  }
}

export class BillingServiceAlreadyInvoicedError extends BillingDomainError {
  constructor() {
    super(
      'BILLING_SERVICE_ALREADY_INVOICED',
      'The selected service amount is already reserved or invoiced',
    );
  }
}

export class BillingFundingNotResolvedError extends BillingDomainError {
  constructor() {
    super(
      'BILLING_FUNDING_NOT_RESOLVED',
      'The funding allocation is not confirmed or cannot be billed',
    );
  }
}

export class InvalidTaxConfigurationError extends BillingDomainError {
  constructor() {
    super('INVALID_BILLING_TAX_CONFIGURATION', 'The provider tax configuration is invalid');
  }
}

export class InvalidReceivableFactsError extends BillingDomainError {
  constructor() {
    super('PAYMENT_ALLOCATION_EXCEEDED', 'Invoice payments and corrections exceed the receivable');
  }
}

export class PaymentAmountInvalidError extends BillingDomainError {
  constructor() {
    super('PAYMENT_AMOUNT_INVALID', 'The payment allocation must be a positive whole-cent amount');
  }
}

export class PaymentAllocationExceededError extends BillingDomainError {
  constructor() {
    super('PAYMENT_ALLOCATION_EXCEEDED', 'The allocation exceeds the payment or invoice balance');
  }
}

export class PaymentReversalConflictError extends BillingDomainError {
  constructor() {
    super('PAYMENT_REVERSAL_CONFLICT', 'The payment allocation was already reversed');
  }
}

export class InvalidInvoiceCorrectionError extends BillingDomainError {
  constructor() {
    super('INVOICE_CORRECTION_INVALID', 'A correction must reduce the unpaid invoice amount');
  }
}

export class InvalidInvoiceNumberError extends BillingDomainError {
  constructor() {
    super('INVOICE_NUMBER_CONFLICT', 'The invoice number sequence is invalid');
  }
}

export class InvoiceNotFoundError extends BillingDomainError {
  constructor() {
    super('INVOICE_NOT_FOUND', 'The invoice could not be found');
  }
}

export class InvoiceInvalidStateError extends BillingDomainError {
  constructor() {
    super('INVOICE_INVALID_STATE', 'The invoice is not in a state that allows this operation');
  }
}

export class InvoiceVersionConflictError extends BillingDomainError {
  constructor() {
    super('INVOICE_VERSION_CONFLICT', 'The invoice was changed by another Office user');
  }
}

export class InvoiceRecipientInvalidError extends BillingDomainError {
  constructor() {
    super('INVOICE_RECIPIENT_INVALID', 'The invoice recipient is missing or no longer valid');
  }
}

export class InvoiceIssuerIncompleteError extends BillingDomainError {
  constructor() {
    super('INVOICE_ISSUER_INCOMPLETE', 'The provider billing profile is incomplete');
  }
}

export class InvoiceNumberConflictError extends BillingDomainError {
  constructor() {
    super('INVOICE_NUMBER_CONFLICT', 'A unique invoice number could not be assigned');
  }
}

export class InvoiceEvidenceOutdatedError extends BillingDomainError {
  constructor() {
    super(
      'INVOICE_EVIDENCE_OUTDATED',
      'The finalized service evidence changed after the draft was prepared',
    );
  }
}

export class InvoicePdfNotReadyError extends BillingDomainError {
  constructor() {
    super('INVOICE_PDF_NOT_READY', 'The invoice PDF is not ready yet');
  }
}

export class InvoiceFormatUnsupportedError extends BillingDomainError {
  constructor() {
    super(
      'INVOICE_FORMAT_UNSUPPORTED',
      'This payer requires a structured electronic invoice format',
    );
  }
}

export class PayerArrangementNotFoundError extends BillingDomainError {
  constructor() {
    super('INVOICE_RECIPIENT_INVALID', 'The payer arrangement is missing or no longer valid');
  }
}

export class BillingProfileNotFoundError extends BillingDomainError {
  constructor() {
    super('INVOICE_ISSUER_INCOMPLETE', 'The provider billing profile does not exist');
  }
}

export class BillingProfileVersionConflictError extends BillingDomainError {
  constructor() {
    super(
      'BILLING_PROFILE_VERSION_CONFLICT',
      'The provider billing profile changed in another session',
    );
  }
}

export class InvalidBillingProfileError extends BillingDomainError {
  constructor() {
    super('INVALID_BILLING_PROFILE', 'The provider billing profile contains invalid settings');
  }
}

export class InvalidPayerArrangementError extends BillingDomainError {
  constructor() {
    super('INVOICE_RECIPIENT_INVALID', 'The payer arrangement is incomplete or inconsistent');
  }
}

export class BillingClientNotFoundError extends BillingDomainError {
  constructor() {
    super('INVOICE_RECIPIENT_INVALID', 'The client could not be found in this provider scope');
  }
}

export class PaymentNotFoundError extends BillingDomainError {
  constructor() {
    super('PAYMENT_AMOUNT_INVALID', 'The payment could not be found');
  }
}
