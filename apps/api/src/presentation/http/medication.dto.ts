import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { DOSAGE_FORMS, DOSAGE_UNITS, MEDICATION_ROUTES } from '@care/medication';
import {
  EXTERNAL_MEDICATION_SOURCE_TYPES,
  MEDICATION_DISCREPANCY_TYPES,
  MEDICATION_RECONCILIATION_DECISIONS,
  MEDICATION_RECONCILIATION_REASONS,
  REPORTED_MEDICATION_STATUSES,
} from '@care/medication';

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
const nullableText = (max: number) => z.string().max(max).nullable();
const fixedTimesSchedule = z.object({
  type: z.literal('fixed_times'),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24),
}).strict();
const intervalSchedule = z.object({
  type: z.literal('interval'),
  anchorAt: z.string().datetime({ offset: true }),
  intervalMinutes: z.number().int().min(30).max(10080),
}).strict();
const prnSchedule = z.object({
  type: z.literal('as_needed'),
  indication: z.string().trim().min(1).max(1000),
  maximumDoseAmount: decimal.optional(),
  maximumAdministrations: z.number().int().min(1).optional(),
  frequencyWindowMinutes: z.number().int().min(1).optional(),
  minimumIntervalMinutes: z.number().int().min(1).optional(),
}).strict();
export const medicationScheduleSchema = z.discriminatedUnion('type', [fixedTimesSchedule, intervalSchedule, prnSchedule]);

export const medicationDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  activeIngredient: nullableText(200),
  strength: nullableText(120),
  dosageForm: z.enum(DOSAGE_FORMS),
  route: z.enum(MEDICATION_ROUTES),
  manufacturer: nullableText(200),
  externalCode: nullableText(100),
}).strict();
export const medicationDefinitionPatchSchema = medicationDefinitionSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
}).strict().refine((input) => Object.keys(input).length > 0);

export const medicationOrderSchema = z.object({
  medicationDefinitionId: z.string().uuid(),
  doseAmount: decimal,
  doseUnit: z.enum(DOSAGE_UNITS),
  route: z.enum(MEDICATION_ROUTES),
  instructions: nullableText(4000),
  indication: nullableText(1000),
  prescriberName: nullableText(200),
  sourceType: z.enum(['prescriber', 'care_authorizing_source', 'staff_transcription']),
  sourceReference: nullableText(1000),
  prescribedAt: z.string().datetime({ offset: true }).nullable(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  schedule: medicationScheduleSchema,
}).strict();
export const reviseMedicationOrderSchema = medicationOrderSchema.extend({ expectedVersion: z.number().int().min(1) }).strict();
export const expectedMedicationOrderVersionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export const medicationAdministrationSchema = z.object({
  visitId: z.string().uuid(),
  outcome: z.enum(['administered', 'not_administered', 'refused', 'withheld']),
  actualDoseAmount: decimal.nullable().default(null),
  actualDoseUnit: z.enum(DOSAGE_UNITS).nullable().default(null),
  reasonCode: z.enum(['client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other']).nullable().default(null),
  administrationReason: nullableText(1000).default(null),
  note: nullableText(2000).default(null),
}).strict();
export const medicationCorrectionSchema = medicationAdministrationSchema.omit({ visitId: true }).extend({
  correctionReason: z.string().trim().min(1).max(1000),
}).strict();
export const medicationDateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const reconciliationNullableText = (max: number) => z.string().max(max).nullable();
const externalFixedTimesSchedule = fixedTimesSchedule.extend({
  timezone: z.string().trim().min(1).max(100),
}).strict();
const externalIntervalSchedule = intervalSchedule.extend({
  timezone: z.string().trim().min(1).max(100),
}).strict();
const externalPrnSchedule = prnSchedule.extend({
  timezone: z.string().trim().min(1).max(100),
}).strict();
export const externalMedicationScheduleSchema = z.discriminatedUnion('type', [
  externalFixedTimesSchedule,
  externalIntervalSchedule,
  externalPrnSchedule,
]);

export const medicationReconciliationStartSchema = z.object({
  reason: z.enum(MEDICATION_RECONCILIATION_REASONS),
}).strict();
export const medicationReconciliationSourceSchema = z.object({
  expectedVersion: z.number().int().min(1),
  sourceType: z.enum(EXTERNAL_MEDICATION_SOURCE_TYPES),
  sourceName: reconciliationNullableText(200),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reference: reconciliationNullableText(1000),
}).strict();
export const medicationReconciliationEntrySchema = z.object({
  expectedVersion: z.number().int().min(1),
  sourceId: z.string().uuid(),
  supersedesEntryId: z.string().uuid().nullable(),
  correctionReason: reconciliationNullableText(1000),
  medicationName: z.string().trim().min(1).max(200),
  activeIngredient: reconciliationNullableText(200),
  strength: reconciliationNullableText(120),
  dosageForm: z.enum(DOSAGE_FORMS).nullable(),
  doseAmount: decimal.nullable(),
  doseUnit: z.enum(DOSAGE_UNITS).nullable(),
  route: z.enum(MEDICATION_ROUTES).nullable(),
  scheduleDescription: reconciliationNullableText(1000),
  structuredSchedule: externalMedicationScheduleSchema.nullable(),
  reportedStatus: z.enum(REPORTED_MEDICATION_STATUSES),
  note: reconciliationNullableText(2000),
}).strict().refine((entry) => (entry.doseAmount === null) === (entry.doseUnit === null));
export const medicationReconciliationExpectedVersionSchema = z.object({
  expectedVersion: z.number().int().min(1),
}).strict();
export const medicationReconciliationMatchSchema = medicationReconciliationExpectedVersionSchema.extend({
  entryId: z.string().uuid(),
  baselineId: z.string().uuid().nullable(),
}).strict();
export const medicationReconciliationDecisionSchema = medicationReconciliationExpectedVersionSchema.extend({
  discrepancyId: z.string().uuid(),
  decision: z.enum(MEDICATION_RECONCILIATION_DECISIONS),
  reason: reconciliationNullableText(1000),
  clarificationOutcome: reconciliationNullableText(2000),
}).strict();
export const medicationReconciliationApplySchema = medicationReconciliationExpectedVersionSchema.extend({
  actionId: z.string().uuid(),
  items: z.array(z.object({
    discrepancyId: z.string().uuid(),
    disposition: z.enum(['apply_external', 'not_applied']),
    reason: reconciliationNullableText(1000),
  }).strict()).min(1).max(100),
}).strict();
export const medicationReconciliationCancelSchema = medicationReconciliationExpectedVersionSchema.extend({
  reason: reconciliationNullableText(1000),
}).strict();

export class MedicationReconciliationStartRequestDto {
  @ApiProperty({ enum: MEDICATION_RECONCILIATION_REASONS }) reason!: string;
}
export class MedicationReconciliationSourceRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: EXTERNAL_MEDICATION_SOURCE_TYPES }) sourceType!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 }) sourceName!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) sourceDate!: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) reference!: string | null;
}
export class MedicationReconciliationEntryRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) supersedesEntryId!: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) correctionReason!: string | null;
  @ApiProperty({ minLength: 1, maxLength: 200 }) medicationName!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 }) activeIngredient!: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 120 }) strength!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: DOSAGE_FORMS }) dosageForm!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '1' }) doseAmount!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: DOSAGE_UNITS }) doseUnit!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: MEDICATION_ROUTES }) route!: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) scheduleDescription!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object }) structuredSchedule!: Record<string, unknown> | null;
  @ApiProperty({ enum: REPORTED_MEDICATION_STATUSES }) reportedStatus!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 }) note!: string | null;
}
export class MedicationReconciliationMatchRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) entryId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) baselineId!: string | null;
}
export class MedicationReconciliationDecisionRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ format: 'uuid' }) discrepancyId!: string;
  @ApiProperty({ enum: MEDICATION_RECONCILIATION_DECISIONS }) decision!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) reason!: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 }) clarificationOutcome!: string | null;
}
export class MedicationReconciliationApplyItemDto {
  @ApiProperty({ format: 'uuid' }) discrepancyId!: string;
  @ApiProperty({ enum: ['apply_external', 'not_applied'] }) disposition!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) reason!: string | null;
}
export class MedicationReconciliationApplyRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ format: 'uuid', description: 'Stable key reused when retrying this apply request' }) actionId!: string;
  @ApiProperty({ type: [MedicationReconciliationApplyItemDto], minItems: 1 }) items!: MedicationReconciliationApplyItemDto[];
}
export class MedicationReconciliationCancelRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ nullable: true, maxLength: 1000 }) reason!: string | null;
}
export class MedicationReconciliationExpectedVersionRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
}

export class MedicationReconciliationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ enum: ['draft', 'in_review', 'completed', 'cancelled'] }) status!: string;
  @ApiProperty({ enum: MEDICATION_RECONCILIATION_REASONS }) reason!: string;
  @ApiProperty() version!: number;
  @ApiProperty() inputVersion!: number;
  @ApiPropertyOptional({ nullable: true }) comparedInputVersion!: number | null;
  @ApiProperty() comparisonVersion!: number;
  @ApiProperty({ format: 'uuid' }) startedByEmployeeId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) reviewedByEmployeeId!: string | null;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) completedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class MedicationReconciliationCreatedDto {
  @ApiProperty({ type: MedicationReconciliationSummaryDto }) reconciliation!: MedicationReconciliationSummaryDto;
  @ApiProperty() baselineCount!: number;
}
export class MedicationReconciliationSourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) reconciliationId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ enum: EXTERNAL_MEDICATION_SOURCE_TYPES }) sourceType!: string;
  @ApiProperty({ enum: ['clinician_instruction', 'pharmacy_record', 'client_report', 'representative_report', 'other'] }) provenanceClass!: string;
  @ApiPropertyOptional({ nullable: true }) sourceName!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) sourceDate!: string | null;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByEmployeeId!: string;
  @ApiPropertyOptional({ nullable: true }) reference!: string | null;
}
export class MedicationReconciliationBaselineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ format: 'uuid' }) orderRevisionId!: string;
  @ApiProperty() orderVersion!: number;
  @ApiProperty({ type: Object }) snapshot!: Record<string, unknown>;
}
export class MedicationReconciliationEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) supersedesEntryId!: string | null;
  @ApiPropertyOptional({ nullable: true }) correctionReason!: string | null;
  @ApiProperty() medicationName!: string;
  @ApiPropertyOptional({ nullable: true }) activeIngredient!: string | null;
  @ApiPropertyOptional({ nullable: true }) strength!: string | null;
  @ApiPropertyOptional({ nullable: true }) dosageForm!: string | null;
  @ApiPropertyOptional({ nullable: true }) doseAmount!: string | null;
  @ApiPropertyOptional({ nullable: true }) doseUnit!: string | null;
  @ApiPropertyOptional({ nullable: true }) route!: string | null;
  @ApiPropertyOptional({ nullable: true }) scheduleDescription!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object }) structuredSchedule!: Record<string, unknown> | null;
  @ApiProperty({ enum: REPORTED_MEDICATION_STATUSES }) reportedStatus!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() isCurrent!: boolean;
  @ApiPropertyOptional({ nullable: true, type: Object }) currentMatch!: Record<string, unknown> | null;
}
export class MedicationReconciliationDecisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) discrepancyId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: MEDICATION_RECONCILIATION_DECISIONS }) decision!: string;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiPropertyOptional({ nullable: true }) clarificationOutcome!: string | null;
  @ApiProperty({ format: 'uuid' }) reviewedByEmployeeId!: string;
  @ApiProperty({ format: 'date-time' }) reviewedAt!: string;
}
export class MedicationReconciliationApplicationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) discrepancyId!: string;
  @ApiProperty({ format: 'uuid' }) actionId!: string;
  @ApiProperty({ enum: ['applied', 'not_applied'] }) disposition!: string;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) orderId!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) orderRevisionId!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderVersion!: number | null;
}
export class MedicationReconciliationDiscrepancyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() comparisonVersion!: number;
  @ApiProperty({ enum: MEDICATION_DISCREPANCY_TYPES }) type!: string;
  @ApiProperty() field!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) entryId!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) baselineId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object }) externalValue!: unknown;
  @ApiPropertyOptional({ nullable: true, type: Object }) internalValue!: unknown;
  @ApiProperty() isCurrent!: boolean;
  @ApiPropertyOptional({ nullable: true, type: MedicationReconciliationDecisionDto }) latestDecision!: MedicationReconciliationDecisionDto | null;
  @ApiProperty({ type: [MedicationReconciliationDecisionDto] }) decisions!: MedicationReconciliationDecisionDto[];
  @ApiPropertyOptional({ nullable: true, type: MedicationReconciliationApplicationDto }) application!: MedicationReconciliationApplicationDto | null;
}
export class MedicationReconciliationDetailDto {
  @ApiProperty({ type: MedicationReconciliationSummaryDto }) reconciliation!: MedicationReconciliationSummaryDto;
  @ApiProperty({ type: [MedicationReconciliationSourceDto] }) sources!: MedicationReconciliationSourceDto[];
  @ApiProperty({ type: [MedicationReconciliationEntryDto] }) entries!: MedicationReconciliationEntryDto[];
  @ApiProperty({ type: [MedicationReconciliationBaselineDto] }) baselines!: MedicationReconciliationBaselineDto[];
  @ApiProperty({ type: [MedicationReconciliationDiscrepancyDto] }) discrepancies!: MedicationReconciliationDiscrepancyDto[];
  @ApiProperty() comparisonCurrent!: boolean;
}

export class MedicationDefinitionRequestDto {
  @ApiProperty({ maxLength: 200 }) name!: string;
  @ApiPropertyOptional({ nullable: true }) activeIngredient!: string | null;
  @ApiPropertyOptional({ nullable: true }) strength!: string | null;
  @ApiProperty({ enum: DOSAGE_FORMS }) dosageForm!: string;
  @ApiProperty({ enum: MEDICATION_ROUTES }) route!: string;
  @ApiPropertyOptional({ nullable: true }) manufacturer!: string | null;
  @ApiPropertyOptional({ nullable: true }) externalCode!: string | null;
}

export class MedicationOrderRequestDto {
  @ApiProperty({ format: 'uuid' }) medicationDefinitionId!: string;
  @ApiProperty({ example: '1' }) doseAmount!: string;
  @ApiProperty({ enum: DOSAGE_UNITS }) doseUnit!: string;
  @ApiProperty({ enum: MEDICATION_ROUTES }) route!: string;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
  @ApiPropertyOptional({ nullable: true }) indication!: string | null;
  @ApiPropertyOptional({ nullable: true }) prescriberName!: string | null;
  @ApiProperty({ enum: ['prescriber', 'care_authorizing_source', 'staff_transcription'] }) sourceType!: string;
  @ApiPropertyOptional({ nullable: true }) sourceReference!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) prescribedAt!: string | null;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) validUntil!: string | null;
  @ApiProperty({
    oneOf: [
      {
        type: 'object',
        required: ['type', 'times'],
        properties: {
          type: { type: 'string', enum: ['fixed_times'] },
          times: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } },
        },
      },
      {
        type: 'object',
        required: ['type', 'anchorAt', 'intervalMinutes'],
        properties: {
          type: { type: 'string', enum: ['interval'] },
          anchorAt: { type: 'string', format: 'date-time' },
          intervalMinutes: { type: 'integer', minimum: 30, maximum: 10080 },
        },
      },
      {
        type: 'object',
        required: ['type', 'indication'],
        properties: {
          type: { type: 'string', enum: ['as_needed'] },
          indication: { type: 'string', minLength: 1, maxLength: 1000 },
          maximumDoseAmount: { type: 'string', pattern: '^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$' },
          maximumAdministrations: { type: 'integer', minimum: 1 },
          frequencyWindowMinutes: { type: 'integer', minimum: 1 },
          minimumIntervalMinutes: { type: 'integer', minimum: 1 },
        },
      },
    ],
  })
  schedule!: Record<string, unknown>;
}

export class MedicationOrderRevisionRequestDto extends MedicationOrderRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
}

export class MedicationAdministrationRequestDto {
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ enum: ['administered', 'not_administered', 'refused', 'withheld'] }) outcome!: string;
  @ApiPropertyOptional({ nullable: true, example: '1' }) actualDoseAmount?: string | null;
  @ApiPropertyOptional({ nullable: true, enum: DOSAGE_UNITS }) actualDoseUnit?: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other'] }) reasonCode?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) administrationReason?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 }) note?: string | null;
}

export class MedicationCorrectionRequestDto {
  @ApiProperty({ enum: ['administered', 'not_administered', 'refused', 'withheld'] }) outcome!: string;
  @ApiPropertyOptional({ nullable: true, example: '1' }) actualDoseAmount?: string | null;
  @ApiPropertyOptional({ nullable: true, enum: DOSAGE_UNITS }) actualDoseUnit?: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other'] }) reasonCode?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 }) administrationReason?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 }) note?: string | null;
  @ApiProperty({ minLength: 1, maxLength: 1000 }) correctionReason!: string;
}

export class MedicationDefinitionPatchRequestDto {
  @ApiPropertyOptional({ maxLength: 200 }) name?: string;
  @ApiPropertyOptional({ nullable: true }) activeIngredient?: string | null;
  @ApiPropertyOptional({ nullable: true }) strength?: string | null;
  @ApiPropertyOptional({ enum: DOSAGE_FORMS }) dosageForm?: string;
  @ApiPropertyOptional({ enum: MEDICATION_ROUTES }) route?: string;
  @ApiPropertyOptional({ nullable: true }) manufacturer?: string | null;
  @ApiPropertyOptional({ nullable: true }) externalCode?: string | null;
  @ApiPropertyOptional({ enum: ['active', 'archived'] }) status?: string;
}

export class MedicationDefinitionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) activeIngredient!: string | null;
  @ApiPropertyOptional({ nullable: true }) strength!: string | null;
  @ApiProperty() dosageForm!: string;
  @ApiProperty() route!: string;
  @ApiPropertyOptional({ nullable: true }) manufacturer!: string | null;
  @ApiPropertyOptional({ nullable: true }) externalCode!: string | null;
  @ApiProperty({ enum: ['active', 'archived'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class MedicationOrderSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ enum: ['draft', 'active', 'paused', 'discontinued'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) createdByUserId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class MedicationSnapshotDto {
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) activeIngredient!: string | null;
  @ApiPropertyOptional({ nullable: true }) strength!: string | null;
  @ApiProperty() dosageForm!: string;
  @ApiPropertyOptional({ nullable: true }) manufacturer!: string | null;
}

export class MedicationOrderRevisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['draft', 'active', 'paused', 'discontinued'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) medicationDefinitionId!: string;
  @ApiProperty({ type: () => MedicationSnapshotDto }) medicationSnapshot!: MedicationSnapshotDto;
  @ApiProperty() doseAmount!: string;
  @ApiProperty() doseUnit!: string;
  @ApiProperty() route!: string;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
  @ApiPropertyOptional({ nullable: true }) indication!: string | null;
  @ApiPropertyOptional({ nullable: true }) prescriberName!: string | null;
  @ApiProperty() sourceType!: string;
  @ApiPropertyOptional({ nullable: true }) sourceReference!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) prescribedAt!: string | null;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) validUntil!: string | null;
  @ApiProperty({
    oneOf: [
      { type: 'object', required: ['type', 'times', 'timezone'], properties: { type: { type: 'string', enum: ['fixed_times'] }, times: { type: 'array', items: { type: 'string' } }, timezone: { type: 'string' } } },
      { type: 'object', required: ['type', 'anchorAt', 'intervalMinutes', 'timezone'], properties: { type: { type: 'string', enum: ['interval'] }, anchorAt: { type: 'string', format: 'date-time' }, intervalMinutes: { type: 'integer' }, timezone: { type: 'string' } } },
      { type: 'object', required: ['type', 'indication', 'timezone'], properties: { type: { type: 'string', enum: ['as_needed'] }, indication: { type: 'string' }, timezone: { type: 'string' }, maximumDoseAmount: { type: 'string' }, maximumAdministrations: { type: 'integer' }, frequencyWindowMinutes: { type: 'integer' }, minimumIntervalMinutes: { type: 'integer' } } },
    ],
  })
  schedule!: MedicationScheduleResponseDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MedicationOrderListDto {
  @ApiProperty({ type: MedicationOrderSummaryDto }) order!: MedicationOrderSummaryDto;
  @ApiProperty({ type: MedicationOrderRevisionDto, nullable: true }) currentRevision!: MedicationOrderRevisionDto | null;
}

export class MedicationOrderHistoryDto {
  @ApiProperty({ type: MedicationOrderSummaryDto }) order!: MedicationOrderSummaryDto;
  @ApiProperty({ type: [MedicationOrderRevisionDto] }) revisions!: MedicationOrderRevisionDto[];
}

export type MedicationScheduleResponseDto =
  | { type: 'fixed_times'; times: string[]; timezone: string }
  | { type: 'interval'; anchorAt: string; intervalMinutes: number; timezone: string }
  | { type: 'as_needed'; indication: string; timezone: string; maximumDoseAmount?: string; maximumAdministrations?: number; frequencyWindowMinutes?: number; minimumIntervalMinutes?: number };

export class MedicationDoseDto {
  @ApiProperty() amount!: string;
  @ApiProperty({ enum: DOSAGE_UNITS }) unit!: string;
}

export class MedicationDueOccurrenceDto {
  @ApiProperty({ format: 'uuid' }) occurrenceId!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() orderVersion!: number;
  @ApiProperty({ format: 'date-time' }) scheduledAt!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ format: 'date' }) localDate!: string;
  @ApiProperty() localTime!: string;
  @ApiProperty({ enum: ['due', 'overdue_not_documented'] }) status!: string;
  @ApiProperty({ type: MedicationSnapshotDto }) medication!: MedicationSnapshotDto;
  @ApiProperty({ type: MedicationDoseDto }) orderedDose!: MedicationDoseDto;
  @ApiProperty({ enum: MEDICATION_ROUTES }) route!: string;
  @ApiPropertyOptional({ nullable: true }) instructions?: string | null;
}

export class MedicationPrnOrderDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() orderVersion!: number;
  @ApiProperty({ type: MedicationSnapshotDto }) medication!: MedicationSnapshotDto;
  @ApiProperty({ type: MedicationDoseDto }) orderedDose!: MedicationDoseDto;
  @ApiProperty({ enum: MEDICATION_ROUTES }) route!: string;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
  @ApiProperty() indication!: string;
}

export class MedicationCorrectionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['administered', 'not_administered', 'refused', 'withheld'] }) outcome!: string;
  @ApiPropertyOptional({ nullable: true }) actualDoseAmount!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: DOSAGE_UNITS }) actualDoseUnit!: string | null;
  @ApiPropertyOptional({ nullable: true }) reasonCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) administrationReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() correctionReason!: string;
  @ApiProperty({ format: 'uuid' }) correctedByEmployeeId!: string;
  @ApiProperty() correctedByEmployeeName!: string;
  @ApiProperty({ format: 'date-time' }) correctedAt!: string;
}

export class MedicationAdministrationRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() orderVersion!: number;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) occurrenceId!: string | null;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ enum: ['administered', 'not_administered', 'refused', 'withheld'] }) outcome!: string;
  @ApiProperty({ type: MedicationDoseDto }) orderedDose!: MedicationDoseDto;
  @ApiPropertyOptional({ type: MedicationDoseDto, nullable: true }) actualDose!: MedicationDoseDto | null;
  @ApiProperty({ enum: MEDICATION_ROUTES }) route!: string;
  @ApiPropertyOptional({ nullable: true }) reasonCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) administrationReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() administeredByEmployeeName!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ format: 'date-time' }) capturedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) scheduledAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) scheduledTimezone!: string | null;
  @ApiProperty({ type: MedicationSnapshotDto }) medication!: MedicationSnapshotDto;
  @ApiPropertyOptional({ type: MedicationCorrectionSummaryDto, nullable: true }) currentCorrection!: MedicationCorrectionSummaryDto | null;
  @ApiProperty({ type: [MedicationCorrectionSummaryDto] }) corrections!: MedicationCorrectionSummaryDto[];
}

export class MedicationAdministrationResponseDto {
  @ApiProperty({ type: [MedicationDueOccurrenceDto] }) due!: MedicationDueOccurrenceDto[];
  @ApiProperty({ type: [MedicationAdministrationRecordDto] }) history!: MedicationAdministrationRecordDto[];
}

export class VisitMedicationAdministrationDto {
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty({ description: 'A review is pending; this does not block medication administration' }) reconciliationReviewPending!: boolean;
  @ApiProperty({ type: [MedicationDueOccurrenceDto] }) due!: MedicationDueOccurrenceDto[];
  @ApiProperty({ type: [MedicationAdministrationRecordDto] }) history!: MedicationAdministrationRecordDto[];
  @ApiProperty({ type: [MedicationPrnOrderDto] }) prn!: MedicationPrnOrderDto[];
}
