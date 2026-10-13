import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  });
const channel = z.enum(['manual_portal', 'manual_email', 'postal', 'customer_reimbursement']);
const fundingSourceType = z.enum([
  'statutory_long_term_care_insurance',
  'private_long_term_care_insurance',
  'self_pay',
  'other',
]);

export const payerCreateSchema = z
  .object({
    organizationId: z.uuid(),
    payerType: z.enum(['statutory_pflegekasse', 'private_pflegeversicherung', 'self_pay', 'other']),
    name: z.string().trim().min(1).max(200),
    payerIdentifier: z.string().trim().max(80).nullable().optional(),
    addressText: z.string().trim().max(1000).nullable().optional(),
    billingContactName: z.string().trim().max(200).nullable().optional(),
    billingContactEmail: z.email().max(254).nullable().optional(),
    billingContactPhone: z.string().trim().max(80).nullable().optional(),
    submissionInstructions: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(['active', 'inactive']).default('active'),
    validFrom: date,
    validUntil: date.nullable().optional(),
  })
  .strict();

export const payerUpdateSchema = payerCreateSchema
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict();

export const payersListQuerySchema = z
  .object({
    organizationId: z.uuid(),
    q: z.string().trim().max(120).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const payerIdsQuerySchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(',').map((id) => id.trim()) : value),
  z.array(z.uuid()).min(1).max(100),
);

export const payerLookupQuerySchema = z
  .object({ organizationId: z.uuid(), payerIds: payerIdsQuerySchema })
  .strict();

export const payerProfileSchema = z
  .object({
    organizationId: z.uuid(),
    channel,
    fundingSourceType,
    validFrom: date,
    validUntil: date.nullable().optional(),
    sourceName: z.string().trim().min(1).max(200),
    sourceVersion: z.string().trim().min(1).max(120),
    sourceEffectiveDate: date,
    sourceUrl: z.url().startsWith('https://').max(1000).nullable().optional(),
    requiresClientInsuranceNumber: z.boolean(),
    requiresPayerIdentifier: z.boolean(),
    requiresAcknowledgement: z.boolean(),
    requiresMandate: z.boolean(),
    requiresInvoicePdf: z.boolean(),
    requiresEvidencePdf: z.boolean(),
    requiresMandateDocument: z.boolean(),
    requiresExternalReference: z.boolean(),
    requiresProviderRecognition: z.boolean(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export const claimsListQuerySchema = z
  .object({
    organizationId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    status: z
      .enum([
        'draft',
        'ready',
        'submitted',
        'accepted',
        'partially_accepted',
        'rejected',
        'clarification_required',
        'resubmitted',
        'cancelled',
      ])
      .optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const createClaimSchema = z
  .object({
    invoiceId: z.uuid(),
    expectedInvoiceVersion: z.number().int().min(1),
    payerArrangementId: z.uuid(),
    payerBillingProfileId: z.uuid().nullable().optional(),
    lines: z
      .array(z.object({ invoiceLineId: z.uuid(), amountCents: z.number().int().min(1) }).strict())
      .min(1)
      .max(100),
  })
  .strict();

export const expectedVersionSchema = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();

export const claimSubmitSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    externalReference: z.string().trim().max(160).nullable().optional(),
    protectedNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const claimDecisionSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    decision: z.enum(['accepted', 'partially_accepted', 'rejected', 'clarification_required']),
    decisionDate: date,
    externalReference: z.string().trim().max(160).nullable().optional(),
    acceptedCents: z.number().int().min(0),
    rejectedCents: z.number().int().min(0),
    reasonCode: z.string().trim().max(80).nullable().optional(),
    protectedExplanation: z.string().max(4000).nullable().optional(),
    lines: z
      .array(
        z
          .object({
            claimLineId: z.uuid(),
            acceptedCents: z.number().int().min(0),
            rejectedCents: z.number().int().min(0),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export class PayerInputDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({
    enum: ['statutory_pflegekasse', 'private_pflegeversicherung', 'self_pay', 'other'],
  })
  payerType!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) payerIdentifier?: string | null;
  @ApiPropertyOptional({ nullable: true }) addressText?: string | null;
  @ApiPropertyOptional({ nullable: true }) billingContactName?: string | null;
  @ApiPropertyOptional({ nullable: true }) billingContactEmail?: string | null;
  @ApiPropertyOptional({ nullable: true }) billingContactPhone?: string | null;
  @ApiPropertyOptional({ nullable: true }) submissionInstructions?: string | null;
  @ApiProperty({ enum: ['active', 'inactive'], default: 'active' }) status!: string;
  @ApiProperty({ type: String, format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) validUntil?: string | null;
}

export class PayerUpdateDto extends PayerInputDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
}

export class PayerDirectoryEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({
    enum: ['statutory_pflegekasse', 'private_pflegeversicherung', 'self_pay', 'other'],
  })
  payerType!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) payerIdentifier!: string | null;
  @ApiPropertyOptional({ nullable: true }) addressText!: string | null;
  @ApiPropertyOptional({ nullable: true }) billingContactName!: string | null;
  @ApiPropertyOptional({ nullable: true }) billingContactEmail!: string | null;
  @ApiPropertyOptional({ nullable: true }) billingContactPhone!: string | null;
  @ApiPropertyOptional({ nullable: true }) submissionInstructions!: string | null;
  @ApiProperty({ enum: ['active', 'inactive'] }) status!: string;
  @ApiProperty({ type: String, format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) validUntil!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ format: 'uuid' }) updatedBy!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class PayerBillingProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) payerId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ enum: ['manual_portal', 'manual_email', 'postal', 'customer_reimbursement'] })
  channel!: string;
  @ApiProperty({
    enum: [
      'statutory_long_term_care_insurance',
      'private_long_term_care_insurance',
      'self_pay',
      'other',
    ],
  })
  fundingSourceType!: string;
  @ApiProperty({ type: String, format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) validUntil!: string | null;
  @ApiProperty() sourceName!: string;
  @ApiProperty() sourceVersion!: string;
  @ApiProperty({ type: String, format: 'date' }) sourceEffectiveDate!: string;
  @ApiPropertyOptional({ nullable: true }) sourceUrl!: string | null;
  @ApiProperty() requiresClientInsuranceNumber!: boolean;
  @ApiProperty() requiresPayerIdentifier!: boolean;
  @ApiProperty() requiresAcknowledgement!: boolean;
  @ApiProperty() requiresMandate!: boolean;
  @ApiProperty() requiresInvoicePdf!: boolean;
  @ApiProperty() requiresEvidencePdf!: boolean;
  @ApiProperty() requiresMandateDocument!: boolean;
  @ApiProperty() requiresExternalReference!: boolean;
  @ApiProperty() requiresProviderRecognition!: boolean;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PayerListResponseDto {
  @ApiProperty({ type: [PayerDirectoryEntryDto] }) items!: PayerDirectoryEntryDto[];
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
  @ApiProperty({ minimum: 0 }) totalItems!: number;
  @ApiProperty({ minimum: 0 }) totalPages!: number;
  @ApiProperty() hasMore!: boolean;
}

export class PayerProfileInputDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: ['manual_portal', 'manual_email', 'postal', 'customer_reimbursement'] })
  channel!: string;
  @ApiProperty({
    enum: [
      'statutory_long_term_care_insurance',
      'private_long_term_care_insurance',
      'self_pay',
      'other',
    ],
  })
  fundingSourceType!: string;
  @ApiProperty({ type: String, format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) validUntil?: string | null;
  @ApiProperty() sourceName!: string;
  @ApiProperty() sourceVersion!: string;
  @ApiProperty({ type: String, format: 'date' }) sourceEffectiveDate!: string;
  @ApiPropertyOptional({ nullable: true }) sourceUrl?: string | null;
  @ApiProperty() requiresClientInsuranceNumber!: boolean;
  @ApiProperty() requiresPayerIdentifier!: boolean;
  @ApiProperty() requiresAcknowledgement!: boolean;
  @ApiProperty() requiresMandate!: boolean;
  @ApiProperty() requiresInvoicePdf!: boolean;
  @ApiProperty() requiresEvidencePdf!: boolean;
  @ApiProperty() requiresMandateDocument!: boolean;
  @ApiProperty() requiresExternalReference!: boolean;
  @ApiProperty() requiresProviderRecognition!: boolean;
  @ApiProperty({ minimum: 0 }) expectedVersion!: number;
}

export class ClaimLineSelectionDto {
  @ApiProperty({ format: 'uuid' }) invoiceLineId!: string;
  @ApiProperty({ minimum: 1 }) amountCents!: number;
}

export class ClaimCreateDto {
  @ApiProperty({ format: 'uuid' }) invoiceId!: string;
  @ApiProperty({ minimum: 1 }) expectedInvoiceVersion!: number;
  @ApiProperty({ format: 'uuid' }) payerArrangementId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) payerBillingProfileId?: string | null;
  @ApiProperty({ type: [ClaimLineSelectionDto] }) lines!: ClaimLineSelectionDto[];
}

export class ClaimVersionDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
}
