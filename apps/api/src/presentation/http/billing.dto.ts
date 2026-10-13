import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const uuid = z.uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  });
const positiveCents = z.number().int().min(1).max(2_000_000_000);
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

export const billingCandidateQuerySchema = z
  .object({
    from: date.optional(),
    until: date.optional(),
    organizationId: uuid.optional(),
    facilityId: uuid.optional(),
    clientId: uuid.optional(),
    fundingSourceId: uuid.optional(),
    ready: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    evidenceStatus: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const billingProfileSchema = z
  .object({
    organizationId: uuid,
    taxNumber: z.string().trim().max(100).nullable().optional(),
    vatId: z.string().trim().max(100).nullable().optional(),
    creditorIdentifier: z.string().trim().max(100).nullable().optional(),
    bankAccountHolder: z.string().trim().max(200).nullable().optional(),
    iban: z.string().trim().max(34).nullable().optional(),
    bic: z.string().trim().max(11).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(180),
    invoiceNumberPrefix: z
      .string()
      .trim()
      .max(24)
      .regex(/^[A-Za-z0-9/-]*$/),
    defaultCurrency: z.literal('EUR'),
    taxTreatment: z.enum(['taxable', 'tax_exempt', 'small_business']),
    taxRateBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(),
    taxExemptionBasis: z.string().trim().max(300).nullable().optional(),
    requireAcknowledgement: z.boolean(),
    requiredInvoiceFormat: z.enum(['pdf', 'structured']),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();

export const payerArrangementQuerySchema = z
  .object({ clientId: uuid, organizationId: uuid.optional() })
  .strict();

export const payerArrangementSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    fundingSourceId: uuid.nullable().optional(),
    clientInsuranceId: uuid.nullable().optional(),
    payerId: uuid.nullable().optional(),
    mandateDocumentArtifactId: uuid.nullable().optional(),
    payerType: z.enum(['statutory_insurance', 'private_insurance', 'self_pay', 'other']),
    payerReference: z.string().trim().max(200).nullable().optional(),
    arrangementType: z.enum(['direct_payer_billing', 'reimbursement_to_client', 'other']),
    recipientType: z.enum(['client', 'insurance', 'contact', 'other']),
    recipientName: z.string().trim().max(200).nullable().optional(),
    recipientAddress: z.string().trim().max(1000).nullable().optional(),
    mandateStatus: z.enum(['authorized', 'pending', 'revoked', 'not_applicable']),
    documentedSource: z.string().trim().max(200).nullable().optional(),
    documentedReference: z.string().trim().max(200).nullable().optional(),
    validFrom: date,
    validUntil: date.nullable().optional(),
  })
  .strict();

export const payerArrangementUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    mandateStatus: z.enum(['authorized', 'pending', 'revoked', 'not_applicable']),
    validUntil: date.nullable().optional(),
    documentedSource: z.string().trim().max(200).nullable().optional(),
    documentedReference: z.string().trim().max(200).nullable().optional(),
    payerId: uuid.nullable().optional(),
    mandateDocumentArtifactId: uuid.nullable().optional(),
  })
  .strict();

const invoiceLineSelectionSchema = z
  .object({
    performedServiceId: uuid,
    fundingAllocationId: uuid.nullable().optional(),
    amountCents: positiveCents,
  })
  .strict();
const draftInvoiceFields = {
  organizationId: uuid,
  facilityId: uuid,
  clientId: uuid,
  recipientType: z.enum(['client', 'payer']),
  payerArrangementId: uuid.nullable().optional(),
  lines: z.array(invoiceLineSelectionSchema).min(1).max(100),
};
export const draftInvoiceSchema = z.object(draftInvoiceFields).strict();
export const draftInvoiceUpdateSchema = z
  .object({ ...draftInvoiceFields, expectedVersion: z.number().int().min(1) })
  .strict();
export const issueInvoiceSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export const invoiceListQuerySchema = z
  .object({
    organizationId: uuid.optional(),
    clientId: uuid.optional(),
    status: z.enum(['draft', 'issued', 'cancelled']).optional(),
    page,
    pageSize,
  })
  .strict();

export const receivablesQuerySchema = z
  .object({
    organizationId: uuid.optional(),
    clientId: uuid.optional(),
    q: z.string().trim().min(2).max(120).optional(),
    page,
    pageSize,
  })
  .strict();
export const paymentsQuerySchema = z
  .object({
    organizationId: uuid.optional(),
    remainingOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    page,
    pageSize,
  })
  .strict();

export const paymentSchema = z
  .object({
    organizationId: uuid,
    payerReference: z.string().trim().max(200).nullable().optional(),
    payerName: z.string().trim().max(200).nullable().optional(),
    amountCents: positiveCents,
    receivedAt: z
      .string()
      .min(1)
      .max(40)
      .refine((value) => !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)),
    method: z.enum(['bank_transfer', 'cash', 'other']),
    reference: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const paymentAllocationSchema = z
  .object({
    paymentId: uuid,
    invoiceId: uuid,
    claimId: uuid.nullable().optional(),
    amountCents: positiveCents,
  })
  .strict();
export const paymentReversalSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const invoiceCorrectionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    lines: z
      .array(z.object({ invoiceLineId: uuid, amountCents: positiveCents }).strict())
      .min(1)
      .max(100),
  })
  .strict();

export class BillingProfileInputDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiPropertyOptional({ nullable: true }) taxNumber?: string | null;
  @ApiPropertyOptional({ nullable: true }) vatId?: string | null;
  @ApiPropertyOptional({ nullable: true }) creditorIdentifier?: string | null;
  @ApiPropertyOptional({ nullable: true }) bankAccountHolder?: string | null;
  @ApiPropertyOptional({ nullable: true }) iban?: string | null;
  @ApiPropertyOptional({ nullable: true }) bic?: string | null;
  @ApiProperty({ minimum: 0, maximum: 180 }) paymentTermsDays!: number;
  @ApiProperty({ maxLength: 24 }) invoiceNumberPrefix!: string;
  @ApiProperty({ enum: ['EUR'] }) defaultCurrency!: 'EUR';
  @ApiProperty({ enum: ['taxable', 'tax_exempt', 'small_business'] }) taxTreatment!: string;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 10000 }) taxRateBasisPoints?:
    | number
    | null;
  @ApiPropertyOptional({ nullable: true }) taxExemptionBasis?: string | null;
  @ApiProperty() requireAcknowledgement!: boolean;
  @ApiProperty({ enum: ['pdf', 'structured'] }) requiredInvoiceFormat!: string;
  @ApiPropertyOptional({ minimum: 1 }) expectedVersion?: number;
}

export class PayerArrangementInputDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) fundingSourceId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) clientInsuranceId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) payerId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) mandateDocumentArtifactId?:
    | string
    | null;
  @ApiProperty({ enum: ['statutory_insurance', 'private_insurance', 'self_pay', 'other'] })
  payerType!: string;
  @ApiPropertyOptional({ nullable: true }) payerReference?: string | null;
  @ApiProperty({ enum: ['direct_payer_billing', 'reimbursement_to_client', 'other'] })
  arrangementType!: string;
  @ApiProperty({ enum: ['client', 'insurance', 'contact', 'other'] }) recipientType!: string;
  @ApiPropertyOptional({ nullable: true }) recipientName?: string | null;
  @ApiPropertyOptional({ nullable: true }) recipientAddress?: string | null;
  @ApiProperty({ enum: ['authorized', 'pending', 'revoked', 'not_applicable'] })
  mandateStatus!: string;
  @ApiPropertyOptional({ nullable: true }) documentedSource?: string | null;
  @ApiPropertyOptional({ nullable: true }) documentedReference?: string | null;
  @ApiProperty({ type: String, format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) validUntil?: string | null;
}

export class PayerArrangementUpdateDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: ['authorized', 'pending', 'revoked', 'not_applicable'] })
  mandateStatus!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) validUntil?: string | null;
  @ApiPropertyOptional({ nullable: true }) documentedSource?: string | null;
  @ApiPropertyOptional({ nullable: true }) documentedReference?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) payerId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) mandateDocumentArtifactId?:
    | string
    | null;
}

export class BillingInvoiceLineSelectionDto {
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) fundingAllocationId?: string | null;
  @ApiProperty({ minimum: 1 }) amountCents!: number;
}

export class DraftInvoiceInputDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) facilityId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ enum: ['client', 'payer'] }) recipientType!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) payerArrangementId?: string | null;
  @ApiProperty({ type: [BillingInvoiceLineSelectionDto] }) lines!: BillingInvoiceLineSelectionDto[];
}

export class DraftInvoiceUpdateDto extends DraftInvoiceInputDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
}

export class BillingCandidateResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() sourceKey!: string;
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() organizationName!: string;
  @ApiProperty({ format: 'uuid' }) facilityId!: string;
  @ApiProperty() facilityName!: string;
  @ApiProperty({ format: 'uuid' }) serviceId!: string;
  @ApiProperty() serviceCode!: string;
  @ApiProperty() serviceName!: string;
  @ApiProperty({ type: String, format: 'date' }) serviceDate!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] }) unit!: string;
  @ApiProperty({ nullable: true }) pricingUnit!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) servicePriceId!: string | null;
  @ApiProperty({ nullable: true }) unitPriceCents!: number | null;
  @ApiProperty({ nullable: true }) serviceAmountCents!: number | null;
  @ApiProperty({ format: 'uuid', nullable: true }) fundingAllocationId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) fundingSourceId!: string | null;
  @ApiProperty({ nullable: true }) fundingLabel!: string | null;
  @ApiProperty({ enum: ['confirmed', 'provisional'], nullable: true }) fundingStatus!:
    | string
    | null;
  @ApiProperty({ nullable: true }) amountCents!: number | null;
  @ApiProperty() amountAlreadyBilledCents!: number;
  @ApiProperty() amountReservedCents!: number;
  @ApiProperty() remainingBillableAmountCents!: number;
  @ApiProperty({ enum: ['client', 'payer'] }) recommendedRecipient!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) recommendedPayerArrangementId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) evidencePackageId!: string | null;
  @ApiProperty({ nullable: true }) evidenceSnapshotHash!: string | null;
  @ApiProperty() evidenceStatus!: string;
  @ApiProperty() ready!: boolean;
  @ApiProperty({ type: [String] }) blockers!: string[];
}

export class BillingCandidateListResponseDto {
  @ApiProperty({ type: [BillingCandidateResponseDto] }) items!: BillingCandidateResponseDto[];
}

export class BillingProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ nullable: true }) taxNumber!: string | null;
  @ApiProperty({ nullable: true }) vatId!: string | null;
  @ApiProperty({ nullable: true }) creditorIdentifier!: string | null;
  @ApiProperty({ nullable: true }) bankAccountHolder!: string | null;
  @ApiProperty({ nullable: true }) iban!: string | null;
  @ApiProperty({ nullable: true }) bic!: string | null;
  @ApiProperty() paymentTermsDays!: number;
  @ApiProperty() invoiceNumberPrefix!: string;
  @ApiProperty({ enum: ['EUR'] }) defaultCurrency!: 'EUR';
  @ApiProperty({ enum: ['taxable', 'tax_exempt', 'small_business'] }) taxTreatment!: string;
  @ApiProperty({ nullable: true }) taxRateBasisPoints!: number | null;
  @ApiProperty({ nullable: true }) taxExemptionBasis!: string | null;
  @ApiProperty() requireAcknowledgement!: boolean;
  @ApiProperty({ enum: ['pdf', 'structured'] }) requiredInvoiceFormat!: string;
  @ApiProperty() version!: number;
}

export class BillingSettingsEntryResponseDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() organizationName!: string;
  @ApiProperty({ nullable: true }) organizationAddress!: string | null;
  @ApiProperty({ nullable: true }) legalName!: string | null;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty({ type: BillingProfileResponseDto, nullable: true })
  profile!: BillingProfileResponseDto | null;
}

export class BillingSettingsListResponseDto {
  @ApiProperty({ type: [BillingSettingsEntryResponseDto] })
  items!: BillingSettingsEntryResponseDto[];
}

export class PayerArrangementResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) payerId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) fundingSourceId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) clientInsuranceId!: string | null;
  @ApiProperty({ enum: ['statutory_insurance', 'private_insurance', 'other'] }) payerType!: string;
  @ApiProperty({ nullable: true }) payerReference!: string | null;
  @ApiProperty({ enum: ['direct_payer_billing', 'reimbursement_to_client', 'other'] })
  arrangementType!: string;
  @ApiProperty({ enum: ['client', 'insurance', 'contact', 'other'] }) recipientType!: string;
  @ApiProperty({ nullable: true }) recipientName!: string | null;
  @ApiProperty({ nullable: true }) recipientAddress!: string | null;
  @ApiProperty({ enum: ['authorized', 'pending', 'revoked', 'not_applicable'] })
  mandateStatus!: string;
  @ApiProperty({ nullable: true }) documentedSource!: string | null;
  @ApiProperty({ nullable: true }) documentedReference!: string | null;
  @ApiProperty({ type: String, format: 'date' }) validFrom!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) validUntil!: string | null;
  @ApiProperty() version!: number;
}

export class PayerArrangementListResponseDto {
  @ApiProperty({ type: [PayerArrangementResponseDto] }) items!: PayerArrangementResponseDto[];
}

export class BillingInvoiceLineResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) fundingAllocationId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) servicePriceId!: string | null;
  @ApiProperty({ format: 'uuid' }) evidencePackageId!: string;
  @ApiProperty() evidenceSnapshotHash!: string;
  @ApiProperty() sourceKey!: string;
  @ApiProperty() serviceCodeSnapshot!: string;
  @ApiProperty() serviceNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date' }) serviceDate!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] }) unit!: string;
  @ApiProperty() unitPriceCents!: number;
  @ApiProperty() serviceAmountCents!: number;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: ['taxable', 'tax_exempt', 'small_business'] }) taxTreatment!: string;
  @ApiProperty() taxRateBasisPoints!: number;
  @ApiProperty() netCents!: number;
  @ApiProperty() taxCents!: number;
  @ApiProperty() grossCents!: number;
  @ApiProperty({ nullable: true }) taxExemptionBasis!: string | null;
  @ApiProperty({ nullable: true }) fundingLabelSnapshot!: string | null;
}

export class InvoiceCorrectionResponseItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() correctionNumber!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class InvoicePaymentHistoryResponseDto {
  @ApiProperty({ format: 'uuid' }) allocationId!: string;
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ type: String, format: 'date-time' }) allocatedAt!: Date;
  @ApiProperty({ enum: ['bank_transfer', 'cash', 'other'] }) method!: string;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: Date;
  @ApiProperty({ nullable: true }) reference!: string | null;
  @ApiProperty({ nullable: true }) payerNameSnapshot!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reversedAt!: Date | null;
  @ApiProperty({ nullable: true }) reversalReason!: string | null;
}

export class BillingInvoiceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) facilityId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ nullable: true }) recipientName!: string | null;
  @ApiProperty({ nullable: true }) recipientAddress!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) payerArrangementId!: string | null;
  @ApiProperty({ enum: ['client', 'payer'] }) recipientType!: string;
  @ApiProperty({ nullable: true }) invoiceNumber!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) issueDate!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) servicePeriodFrom!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) servicePeriodUntil!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) dueDate!: string | null;
  @ApiProperty({ enum: ['EUR'] }) currency!: 'EUR';
  @ApiProperty({ enum: ['draft', 'issued', 'cancelled'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  issuerSnapshot!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  recipientSnapshot!: Record<string, unknown> | null;
  @ApiProperty() subtotalCents!: number;
  @ApiProperty() taxTotalCents!: number;
  @ApiProperty() grandTotalCents!: number;
  @ApiProperty({ enum: ['pending', 'ready', 'failed'], nullable: true })
  pdfStatus!: 'pending' | 'ready' | 'failed' | null;
  @ApiProperty({
    enum: ['unpaid', 'partially_paid', 'paid', 'overdue', 'corrected'],
    nullable: true,
  })
  receivableStatus!: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'corrected' | null;
  @ApiProperty({ nullable: true }) outstandingCents!: number | null;
  @ApiProperty() evidenceDiscrepancy!: boolean;
  @ApiProperty({ type: [BillingInvoiceLineResponseDto] }) lines!: BillingInvoiceLineResponseDto[];
  @ApiProperty({ type: [InvoiceCorrectionResponseItemDto] })
  corrections!: InvoiceCorrectionResponseItemDto[];
  @ApiProperty({ type: [InvoicePaymentHistoryResponseDto] })
  paymentHistory!: InvoicePaymentHistoryResponseDto[];
}

export class BillingInvoiceListResponseDto {
  @ApiProperty({ type: [BillingInvoiceResponseDto] }) items!: BillingInvoiceResponseDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class InvoiceCorrectionResponseDto {
  @ApiProperty({ type: Object }) correction!: Record<string, unknown>;
  @ApiProperty({ type: BillingInvoiceResponseDto }) invoice!: BillingInvoiceResponseDto;
}

export class PaymentAllocationHistoryResponseDto {
  @ApiProperty({ format: 'uuid' }) allocationId!: string;
  @ApiProperty({ format: 'uuid' }) invoiceId!: string;
  @ApiProperty({ nullable: true }) invoiceNumber!: string | null;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ type: String, format: 'date-time' }) allocatedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reversedAt!: Date | null;
  @ApiProperty({ nullable: true }) reversalReason!: string | null;
}

export class BillingPaymentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ nullable: true }) payerReference!: string | null;
  @ApiProperty({ nullable: true }) payerNameSnapshot!: string | null;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: ['EUR'] }) currency!: 'EUR';
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: Date;
  @ApiProperty({ enum: ['bank_transfer', 'cash', 'other'] }) method!: string;
  @ApiProperty({ nullable: true }) reference!: string | null;
  @ApiProperty() allocatedCents!: number;
  @ApiProperty() remainingCents!: number;
  @ApiProperty({ type: [PaymentAllocationHistoryResponseDto] })
  allocationHistory!: PaymentAllocationHistoryResponseDto[];
}

export class BillingPaymentListResponseDto {
  @ApiProperty({ type: [BillingPaymentResponseDto] }) items!: BillingPaymentResponseDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
