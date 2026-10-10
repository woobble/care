import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const benefitType = z.enum([
  'entlastungsbetrag_45b',
  'umwandlungsanspruch_45a_4',
  'private',
  'other',
]);
const verificationStatus = z.enum([
  'estimated',
  'client_reported',
  'provider_reported',
  'payer_confirmed',
]);
const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fundingSourceSchema = z
  .object({
    sourceType: z.enum([
      'statutory_long_term_care_insurance',
      'private_long_term_care_insurance',
      'self_pay',
      'other',
    ]),
    clientInsuranceId: z.uuid().nullable().optional(),
    label: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .strict();

export const entitlementSchema = z
  .object({
    benefitType,
    fundingSourceId: z.uuid(),
    validFrom: dateValue,
    validUntil: dateValue.nullable().optional(),
    status: z.enum(['confirmed', 'provisional']),
    calculationMode: z.enum(['rule_based', 'manual', 'external_input']),
    source: z.enum(['payer_confirmed', 'client_reported', 'provider_reported', 'contract']),
  })
  .strict();

export const entitlementUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(['confirmed', 'provisional', 'suspended', 'ended']).optional(),
    validUntil: dateValue.nullable().optional(),
    source: z
      .enum(['payer_confirmed', 'client_reported', 'provider_reported', 'contract'])
      .optional(),
  })
  .strict();

export const adjustmentSchema = z
  .object({
    idempotencyKey: z.uuid(),
    fundingSourceId: z.uuid(),
    entitlementId: z.uuid().optional(),
    benefitType,
    amountCents: z
      .number()
      .int()
      .min(-2_000_000_000)
      .max(2_000_000_000)
      .refine((value) => value !== 0),
    effectiveDate: dateValue,
    adjustmentType: z.enum([
      'opening_balance',
      'external_consumption',
      'manual_adjustment',
      'external_input',
    ]),
    sourceType: z.string().trim().min(1).max(80),
    reference: z.string().trim().max(500).nullable().optional(),
    verificationStatus,
  })
  .strict();

export const allocationSchema = z
  .object({
    fundingSourceId: z.uuid(),
    entitlementId: z.uuid(),
    amountCents: z.number().int().positive().max(2_000_000_000),
    status: z.enum(['provisional', 'confirmed']),
    idempotencyKey: z.uuid(),
    manualServiceAmountCents: z.number().int().positive().max(2_000_000_000).optional(),
  })
  .strict();

export const allocationsSchema = z
  .object({ allocations: z.array(allocationSchema).min(1).max(8) })
  .strict();

export const reversalSchema = z
  .object({ reason: z.string().trim().min(1).max(500), idempotencyKey: z.uuid() })
  .strict();

export const recognitionSchema = z
  .object({
    organizationId: z.uuid(),
    recognizedOffering: z.string().trim().min(1).max(160),
    jurisdiction: z.string().trim().min(1).max(40),
    validFrom: dateValue,
    validUntil: dateValue.nullable().optional(),
    reference: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export class BenefitFundingSourceInputDto {
  @ApiProperty({
    enum: [
      'statutory_long_term_care_insurance',
      'private_long_term_care_insurance',
      'self_pay',
      'other',
    ],
  })
  sourceType!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) clientInsuranceId?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 160 }) label?: string | null;
}

export class BenefitEntitlementInputDto {
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'] })
  benefitType!: string;
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ format: 'date', nullable: true }) validUntil?: string | null;
  @ApiProperty({ enum: ['confirmed', 'provisional'] }) status!: string;
  @ApiProperty({ enum: ['rule_based', 'manual', 'external_input'] }) calculationMode!: string;
  @ApiProperty({ enum: ['payer_confirmed', 'client_reported', 'provider_reported', 'contract'] })
  source!: string;
}

export class BenefitEntitlementUpdateDto {
  @ApiProperty() expectedVersion!: number;
  @ApiPropertyOptional({ enum: ['confirmed', 'provisional', 'suspended', 'ended'] })
  status?: string;
  @ApiPropertyOptional({ format: 'date', nullable: true }) validUntil?: string | null;
  @ApiPropertyOptional({
    enum: ['payer_confirmed', 'client_reported', 'provider_reported', 'contract'],
  })
  source?: string;
}

export class BenefitAdjustmentDto {
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) entitlementId?: string;
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'] })
  benefitType!: string;
  @ApiProperty({ description: 'Signed integer EUR cents' }) amountCents!: number;
  @ApiProperty({ format: 'date' }) effectiveDate!: string;
  @ApiProperty({
    enum: ['opening_balance', 'external_consumption', 'manual_adjustment', 'external_input'],
  })
  adjustmentType!: string;
  @ApiProperty() sourceType!: string;
  @ApiPropertyOptional({ nullable: true }) reference?: string | null;
  @ApiProperty({ enum: ['estimated', 'client_reported', 'provider_reported', 'payer_confirmed'] })
  verificationStatus!: string;
}

export class BenefitAdjustmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) bucketId!: string | null;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ format: 'date' }) effectiveDate!: string;
  @ApiProperty({ enum: ['estimated', 'client_reported', 'provider_reported', 'payer_confirmed'] })
  verificationStatus!: string;
}

export class BenefitAllocationDto {
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiProperty({ format: 'uuid' }) entitlementId!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: ['provisional', 'confirmed'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiPropertyOptional() manualServiceAmountCents?: number;
}

export class BenefitAllocationsDto {
  @ApiProperty({ type: [BenefitAllocationDto], maxItems: 8 }) allocations!: BenefitAllocationDto[];
}

export class BenefitReversalDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) reason!: string;
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
}

export class BenefitServiceAllocationItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: ['provisional', 'confirmed'] }) status!: string;
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'] })
  benefitType!: string;
}

export class BenefitServiceAllocationResultDto {
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiProperty() serviceAmountCents!: number;
  @ApiProperty() previouslyAllocatedCents!: number;
  @ApiProperty() allocatedCents!: number;
  @ApiProperty() remainingCents!: number;
  @ApiProperty({ type: [BenefitServiceAllocationItemDto] })
  allocations!: BenefitServiceAllocationItemDto[];
}

export class BenefitAllocationReversalResponseDto {
  @ApiProperty({ format: 'uuid' }) allocationId!: string;
  @ApiProperty({ format: 'uuid' }) reversalId!: string;
  @ApiProperty({ format: 'date-time' }) reversedAt!: string;
}

export class ProviderRecognitionInputDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ maxLength: 160 }) recognizedOffering!: string;
  @ApiProperty({ maxLength: 40 }) jurisdiction!: string;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ format: 'date', nullable: true }) validUntil?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 500 }) reference?: string | null;
}

export class ProviderRecognitionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() recognizedOffering!: string;
  @ApiProperty() jurisdiction!: string;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiProperty({ format: 'date', nullable: true }) validUntil!: string | null;
  @ApiProperty({ nullable: true }) reference!: string | null;
  @ApiProperty({ enum: ['active', 'ended'] }) status!: string;
}

export class BenefitEntitlementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'] })
  benefitType!: string;
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiProperty({ format: 'date', nullable: true }) validUntil!: string | null;
  @ApiProperty({ enum: ['confirmed', 'provisional', 'suspended', 'ended'] }) status!: string;
  @ApiProperty({ enum: ['rule_based', 'manual', 'external_input'] }) calculationMode!: string;
  @ApiProperty({ enum: ['payer_confirmed', 'client_reported', 'provider_reported', 'contract'] })
  source!: string;
  @ApiProperty({ nullable: true }) verifiedAt!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class BenefitFundingSourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({
    enum: [
      'statutory_long_term_care_insurance',
      'private_long_term_care_insurance',
      'self_pay',
      'other',
    ],
  })
  sourceType!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) clientInsuranceId!: string | null;
  @ApiProperty({ nullable: true }) label!: string | null;
  @ApiProperty({ enum: ['active', 'ended'] }) status!: string;
}

export class BenefitDefinitionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'] })
  benefitType!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) statutoryReference!: string | null;
}

export class BenefitRuleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4'] })
  benefitType!: string;
  @ApiProperty() jurisdiction!: string;
  @ApiProperty({ format: 'date' }) effectiveFrom!: string;
  @ApiProperty({ format: 'date', nullable: true }) effectiveUntil!: string | null;
  @ApiProperty({ nullable: true, description: 'Integer EUR cents' }) monthlyAmountCents!:
    | number
    | null;
  @ApiProperty({ nullable: true, description: 'Integer EUR cents' }) annualAmountCents!:
    | number
    | null;
  @ApiProperty({ type: [Number] }) eligibleCareGrades!: number[];
  @ApiProperty({ enum: ['calendar_year_june_30', 'none'] }) carryoverPolicy!: string;
  @ApiProperty() eligibilityRequirements!: string;
  @ApiProperty() ruleVersion!: number;
  @ApiProperty() sourceReference!: string;
}

export class BenefitDefinitionsResponseDto {
  @ApiProperty({ type: [BenefitDefinitionDto] }) items!: BenefitDefinitionDto[];
}
export class BenefitRulesResponseDto {
  @ApiProperty({ type: [BenefitRuleDto] }) items!: BenefitRuleDto[];
}

export class BenefitLedgerEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) allocationBucketId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) serviceAllocationId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) performedServiceId!: string | null;
  @ApiProperty({
    enum: [
      'entitlement_allocated',
      'opening_balance_adjusted',
      'external_consumption_recorded',
      'service_consumption_allocated',
      'service_consumption_reversed',
      'manual_adjustment',
      'benefit_expired',
    ],
  })
  entryType!: string;
  @ApiProperty({ description: 'Signed integer EUR cents' }) amountCents!: number;
  @ApiProperty({ format: 'date' }) effectiveDate!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty({ nullable: true }) reference!: string | null;
  @ApiProperty() verificationStatus!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class BenefitHistoryResponseDto {
  @ApiProperty({ type: [BenefitLedgerEntryDto] }) items!: BenefitLedgerEntryDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export class BenefitBudgetSourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) clientInsuranceId!: string | null;
  @ApiProperty({ enum: ['active', 'ended'] }) status!: string;
  @ApiProperty() unlimited!: boolean;
  @ApiProperty({ nullable: true }) label!: string | null;
  @ApiProperty({ type: [BenefitEntitlementDto] }) entitlements!: BenefitEntitlementDto[];
}

export class BenefitEntitlementBudgetDto {
  @ApiProperty({ format: 'uuid' }) entitlementId!: string;
  @ApiProperty({ enum: ['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'] })
  benefitType!: string;
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiProperty({ enum: ['confirmed', 'provisional', 'suspended', 'ended'] })
  entitlementStatus!: string;
  @ApiProperty({ description: 'Integer EUR cents' }) currentAllocationCents!: number;
  @ApiProperty({ description: 'Integer EUR cents' }) carryoverCents!: number;
  @ApiProperty({ nullable: true, description: 'Estimated provider-recorded balance in EUR cents' })
  estimatedRemainingCents!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Remaining amount from payer-confirmed balance records, in EUR cents',
  })
  confirmedRemainingCents!: number | null;
  @ApiProperty({
    description: 'Provider-reported service consumption in the current period, EUR cents',
  })
  actualConsumptionCents!: number;
  @ApiProperty({ type: [String] }) verificationStatuses!: string[];
  @ApiProperty({ format: 'date', nullable: true }) nextExpiry!: string | null;
}

export class BenefitBudgetResponseDto {
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'date' }) asOf!: string;
  @ApiProperty({ format: 'date' }) currentPeriod!: string;
  @ApiProperty({ nullable: true, enum: [1, 2, 3, 4, 5] }) careGrade!: number | null;
  @ApiProperty({ type: [BenefitBudgetSourceDto] }) fundingSources!: BenefitBudgetSourceDto[];
  @ApiProperty({ type: [BenefitEntitlementBudgetDto] })
  entitlementBudgets!: BenefitEntitlementBudgetDto[];
  @ApiProperty({
    description:
      'Potential cost of scheduled, eligible §45b services; this is not reserved consumption, EUR cents',
  })
  plannedEligible45bCents!: number;
  @ApiProperty({ type: [BenefitEntitlementDto] }) entitlements!: BenefitEntitlementDto[];
  @ApiProperty({ type: [BenefitLedgerEntryDto] }) history!: BenefitLedgerEntryDto[];
}

export class BenefitWorklistClientDto {
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) organizationId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) facilityId!: string | null;
  @ApiProperty({ nullable: true, enum: [1, 2, 3, 4, 5] }) careGrade!: number | null;
  @ApiProperty() missingPflegegrad!: boolean;
  @ApiProperty() missingEntitlement!: boolean;
  @ApiProperty() lowRecordedBalance!: boolean;
  @ApiProperty({ description: 'Integer EUR cents' }) recordedRemainingCents!: number;
  @ApiProperty({ description: 'Integer EUR cents' }) expiringCarryoverCents!: number;
  @ApiProperty() unverifiedOpeningBalance!: boolean;
}

export class BenefitUnallocatedServiceDto {
  @ApiProperty({ format: 'uuid' }) performedServiceId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) facilityId!: string | null;
  @ApiProperty() serviceName!: string;
  @ApiProperty({ enum: ['recognized_support', 'clinical_nursing', 'other'] })
  serviceCategory!: string;
  @ApiProperty({ format: 'date' }) serviceDate!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ nullable: true }) actualQuantity!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) priceId!: string | null;
  @ApiProperty({ nullable: true }) priceCents!: number | null;
  @ApiProperty({ nullable: true }) pricingUnit!: string | null;
  @ApiProperty({ nullable: true }) serviceAmountCents!: number | null;
  @ApiProperty() allocatedCents!: number;
  @ApiProperty({ nullable: true }) remainingCents!: number | null;
}

export class BenefitPagedWorklistDto {
  @ApiProperty({ type: [BenefitWorklistClientDto] }) items!: BenefitWorklistClientDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export class BenefitPagedServiceWorklistDto {
  @ApiProperty({ type: [BenefitUnallocatedServiceDto] }) items!: BenefitUnallocatedServiceDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export class BenefitUnallocatedServicesResponseDto {
  @ApiProperty({ type: [BenefitUnallocatedServiceDto] }) items!: BenefitUnallocatedServiceDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export class BenefitWorklistResponseDto {
  @ApiProperty({ type: BenefitPagedWorklistDto }) clients!: BenefitPagedWorklistDto;
  @ApiProperty({ type: BenefitPagedServiceWorklistDto })
  unallocatedServices!: BenefitPagedServiceWorklistDto;
}

export class BenefitEstimateOptionDto {
  @ApiProperty({ format: 'uuid' }) entitlementId!: string;
  @ApiProperty({ format: 'uuid' }) fundingSourceId!: string;
  @ApiProperty() benefitType!: string;
  @ApiProperty() eligible!: boolean;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ nullable: true, description: 'Integer EUR cents' }) estimatedAvailableCents!:
    | number
    | null;
  @ApiProperty({ nullable: true, description: 'Integer EUR cents' }) confirmedAvailableCents!:
    | number
    | null;
}

export class BenefitEstimateResponseDto {
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'uuid' }) serviceId!: string;
  @ApiProperty({ format: 'date' }) serviceDate!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty({ nullable: true, description: 'Integer EUR cents' }) serviceAmountCents!:
    | number
    | null;
  @ApiProperty({ format: 'uuid', nullable: true }) servicePriceId!: string | null;
  @ApiProperty({ description: 'Integer EUR cents' }) estimated45bAvailableCents!: number;
  @ApiProperty({ description: 'Integer EUR cents' }) confirmed45bAvailableCents!: number;
  @ApiProperty({
    nullable: true,
    description:
      'Estimated balance after all scheduled eligible services and this service, EUR cents',
  })
  estimated45bAfterCents!: number | null;
  @ApiProperty({
    description:
      'Potential cost of scheduled eligible §45b services; this is not reserved consumption, EUR cents',
  })
  plannedEligible45bCents!: number;
  @ApiProperty({ nullable: true, enum: [1, 2, 3, 4, 5] }) careGrade!: number | null;
  @ApiProperty() providerRecognized!: boolean;
  @ApiProperty({ type: [BenefitEstimateOptionDto] }) benefitOptions!: BenefitEstimateOptionDto[];
  @ApiProperty() isEstimate!: boolean;
}
