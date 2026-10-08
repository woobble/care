import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  ASSESSMENT_TYPES,
  MEASUREMENT_TYPES,
  OBSERVATION_CATEGORIES,
  OBSERVATION_SEVERITIES,
  RISK_LEVELS,
  RISK_TYPES,
} from '@care/clinical-documentation';
import { z } from 'zod';

const positiveVersion = z.number().int().positive();
const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const decimalString = z.string().regex(/^-?\d+(?:\.\d{1,3})?$/);
const measurementUnits = ['mmHg', 'Cel', 'kg', 'bpm', '/min', '%', 'mg/dL', 'mmol/L'] as const;
const measurementSource = ['manual', 'device'] as const;
const measurementFields = {
  measurementType: z.enum(MEASUREMENT_TYPES),
  value: decimalString.nullable(),
  integerValue: z.number().int().nullable(),
  systolic: z.number().int().nullable(),
  diastolic: z.number().int().nullable(),
  unit: z.enum(measurementUnits),
  measuredAt: timestamp,
  source: z.enum(measurementSource),
  note: z.string().max(1000).nullable().optional(),
};
const observationFields = {
  category: z.enum(OBSERVATION_CATEGORIES),
  valueCode: z.string().trim().min(1).max(128).nullable().optional(),
  painScore: z.number().int().min(0).max(10).nullable().optional(),
  location: z.string().trim().min(1).max(200).nullable().optional(),
  severity: z.string().trim().min(1).max(128).nullable().optional(),
  observedAt: timestamp,
  note: z.string().max(1000).nullable().optional(),
};
const assessmentFields = {
  assessmentType: z.enum(ASSESSMENT_TYPES),
  resultCode: z.string().trim().min(1).max(128).nullable().optional(),
  score: decimalString.nullable().optional(),
  assessedAt: timestamp,
  validUntil: timestamp.nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
};
const riskFields = {
  riskType: z.enum(RISK_TYPES),
  level: z.enum(RISK_LEVELS),
  assessedAt: timestamp,
  validUntil: timestamp.nullable().optional(),
  source: z.string().trim().min(1).max(128),
  note: z.string().max(1000).nullable().optional(),
};

export const addMeasurementSchema = z.object({
  expectedVersion: positiveVersion,
  ...measurementFields,
});
export const updateMeasurementSchema = z.object({
  expectedVersion: positiveVersion,
  expectedRecordVersion: positiveVersion,
  ...measurementFields,
});
export const addObservationSchema = z.object({
  expectedVersion: positiveVersion,
  ...observationFields,
});
export const updateObservationSchema = z.object({
  expectedVersion: positiveVersion,
  expectedRecordVersion: positiveVersion,
  ...observationFields,
});
export const addAssessmentSchema = z.object({
  expectedVersion: positiveVersion,
  ...assessmentFields,
});
export const updateAssessmentSchema = z.object({
  expectedVersion: positiveVersion,
  expectedRecordVersion: positiveVersion,
  ...assessmentFields,
});
export const addRiskAssessmentSchema = z.object({
  expectedVersion: positiveVersion,
  ...riskFields,
});
export const updateRiskAssessmentSchema = z.object({
  expectedVersion: positiveVersion,
  expectedRecordVersion: positiveVersion,
  ...riskFields,
});

const measurementReplacementSchema = z.object(measurementFields).strict();
const observationReplacementSchema = z
  .object({
    ...observationFields,
    category: z.enum(OBSERVATION_CATEGORIES),
    severity: z.enum(OBSERVATION_SEVERITIES).nullable().optional(),
  })
  .strict();
const assessmentReplacementSchema = z.object(assessmentFields).strict();
const riskReplacementSchema = z.object(riskFields).strict();
const clinicalRecordReplacementSchema = z.union([
  measurementReplacementSchema,
  observationReplacementSchema,
  assessmentReplacementSchema,
  riskReplacementSchema,
]);

export const deleteClinicalRecordSchema = z.object({
  expectedVersion: positiveVersion,
  expectedRecordVersion: positiveVersion,
});
export const amendClinicalRecordSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  replacement: clinicalRecordReplacementSchema,
});

const historyFields = {
  from: timestamp,
  until: timestamp,
  page: z.coerce.number().int().positive(),
  pageSize: z.coerce.number().int().positive().max(100),
};
export const measurementHistorySchema = z.object({
  ...historyFields,
  type: z.enum(MEASUREMENT_TYPES).optional(),
});
export const observationHistorySchema = z.object({
  ...historyFields,
  category: z.enum(OBSERVATION_CATEGORIES).optional(),
});
export const assessmentHistorySchema = z.object({
  ...historyFields,
  type: z.enum(ASSESSMENT_TYPES).optional(),
});
export const riskHistorySchema = z
  .object({
    from: timestamp.optional(),
    until: timestamp.optional(),
    page: historyFields.page,
    pageSize: historyFields.pageSize,
    riskType: z.enum(RISK_TYPES).optional(),
    currentOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .superRefine((query, context) => {
    if (!query.currentOnly && (!query.from || !query.until)) {
      if (!query.from) context.addIssue({ code: 'custom', path: ['from'], message: 'Required' });
      if (!query.until) context.addIssue({ code: 'custom', path: ['until'], message: 'Required' });
    }
  });

export class ClinicalRecordCoreDto {
  @ApiProperty({ enum: ['measurement', 'observation', 'assessment', 'risk_assessment'] })
  kind!: string;

  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) documentationId!: string;
  @ApiProperty({ minimum: 1 }) recordVersion!: number;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) recordedByEmployeeId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) correctsRecordId!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) correctedByRecordId!: string | null;
  @ApiPropertyOptional({ nullable: true }) correctionReason!: string | null;
}

export class ClinicalMeasurementDto extends ClinicalRecordCoreDto {
  @ApiProperty({ enum: ['measurement'] }) override kind!: 'measurement';
  @ApiProperty({ enum: MEASUREMENT_TYPES }) measurementType!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) value!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) integerValue!: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) systolic!: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) diastolic!: number | null;
  @ApiProperty({ enum: measurementUnits }) unit!: string;
  @ApiProperty({ format: 'date-time' }) measuredAt!: string;
  @ApiProperty({ enum: measurementSource }) source!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}

export class ClinicalObservationDto extends ClinicalRecordCoreDto {
  @ApiProperty({ enum: ['observation'] }) override kind!: 'observation';
  @ApiProperty({ enum: OBSERVATION_CATEGORIES }) category!: string;
  @ApiPropertyOptional({ nullable: true }) valueCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) painScore!: number | null;
  @ApiPropertyOptional({ nullable: true }) location!: string | null;
  @ApiPropertyOptional({ nullable: true }) severity!: string | null;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}

export class ClinicalAssessmentDto extends ClinicalRecordCoreDto {
  @ApiProperty({ enum: ['assessment'] }) override kind!: 'assessment';
  @ApiProperty({ enum: ASSESSMENT_TYPES }) assessmentType!: string;
  @ApiProperty({ nullable: true, type: String }) resultCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) score!: string | null;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) validUntil!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}

export class ClinicalRiskAssessmentDto extends ClinicalRecordCoreDto {
  @ApiProperty({ enum: ['risk_assessment'] }) override kind!: 'risk_assessment';
  @ApiProperty({ enum: RISK_TYPES }) riskType!: string;
  @ApiProperty({ enum: RISK_LEVELS }) level!: string;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) validUntil!: string | null;
  @ApiProperty() source!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}

@ApiExtraModels(
  ClinicalMeasurementDto,
  ClinicalObservationDto,
  ClinicalAssessmentDto,
  ClinicalRiskAssessmentDto,
)
export class ClinicalDocumentationDetailDto {
  @ApiProperty({ format: 'uuid' }) documentationId!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) documentationStatus!: string;
  @ApiProperty({ minimum: 1 }) documentationVersion!: number;
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ClinicalMeasurementDto) },
      { $ref: getSchemaPath(ClinicalObservationDto) },
      { $ref: getSchemaPath(ClinicalAssessmentDto) },
      { $ref: getSchemaPath(ClinicalRiskAssessmentDto) },
    ],
    isArray: true,
  })
  records!: Array<
    | ClinicalMeasurementDto
    | ClinicalObservationDto
    | ClinicalAssessmentDto
    | ClinicalRiskAssessmentDto
  >;
}

@ApiExtraModels(
  ClinicalMeasurementDto,
  ClinicalObservationDto,
  ClinicalAssessmentDto,
  ClinicalRiskAssessmentDto,
)
export class ClinicalRecordHistoryDto {
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) documentationStatus!: string;
}

export class ClinicalMeasurementHistoryDto extends ClinicalMeasurementDto {
  @ApiProperty({ nullable: true }) recordedByEmployeeName!: string | null;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) documentationStatus!: string;
}

export class ClinicalObservationHistoryDto extends ClinicalObservationDto {
  @ApiProperty({ nullable: true }) recordedByEmployeeName!: string | null;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) documentationStatus!: string;
}

export class ClinicalAssessmentHistoryDto extends ClinicalAssessmentDto {
  @ApiProperty({ nullable: true }) recordedByEmployeeName!: string | null;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) documentationStatus!: string;
}

export class ClinicalRiskAssessmentHistoryDto extends ClinicalRiskAssessmentDto {
  @ApiProperty({ nullable: true }) recordedByEmployeeName!: string | null;
  @ApiProperty({ format: 'uuid' }) visitId!: string;
  @ApiProperty({ format: 'date-time' }) plannedStart!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) documentationStatus!: string;
}

@ApiExtraModels(
  ClinicalMeasurementHistoryDto,
  ClinicalObservationHistoryDto,
  ClinicalAssessmentHistoryDto,
  ClinicalRiskAssessmentHistoryDto,
)
export class ClinicalRecordHistoryPageDto {
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ClinicalMeasurementHistoryDto) },
      { $ref: getSchemaPath(ClinicalObservationHistoryDto) },
      { $ref: getSchemaPath(ClinicalAssessmentHistoryDto) },
      { $ref: getSchemaPath(ClinicalRiskAssessmentHistoryDto) },
    ],
    isArray: true,
  })
  items!: Array<
    | ClinicalMeasurementHistoryDto
    | ClinicalObservationHistoryDto
    | ClinicalAssessmentHistoryDto
    | ClinicalRiskAssessmentHistoryDto
  >;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}

export class DeleteClinicalRecordRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ minimum: 1 }) expectedRecordVersion!: number;
}

export class AddMeasurementRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: MEASUREMENT_TYPES }) measurementType!: string;
  @ApiProperty({ nullable: true, type: String }) value!: string | null;
  @ApiProperty({ nullable: true, type: Number }) integerValue!: number | null;
  @ApiProperty({ nullable: true, type: Number }) systolic!: number | null;
  @ApiProperty({ nullable: true, type: Number }) diastolic!: number | null;
  @ApiProperty({ enum: measurementUnits }) unit!: string;
  @ApiProperty({ format: 'date-time' }) measuredAt!: string;
  @ApiProperty({ enum: measurementSource }) source!: string;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class UpdateMeasurementRequestDto extends AddMeasurementRequestDto {
  @ApiProperty({ minimum: 1 }) expectedRecordVersion!: number;
}

export class AddObservationRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: OBSERVATION_CATEGORIES }) category!: string;
  @ApiPropertyOptional({ nullable: true }) valueCode?: string | null;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10 }) painScore?: number | null;
  @ApiPropertyOptional({ nullable: true }) location?: string | null;
  @ApiPropertyOptional({ nullable: true }) severity?: string | null;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class UpdateObservationRequestDto extends AddObservationRequestDto {
  @ApiProperty({ minimum: 1 }) expectedRecordVersion!: number;
}

export class AddAssessmentRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: ASSESSMENT_TYPES }) assessmentType!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) resultCode?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) score?: string | null;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) validUntil?: string | null;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class UpdateAssessmentRequestDto extends AddAssessmentRequestDto {
  @ApiProperty({ minimum: 1 }) expectedRecordVersion!: number;
}

export class AddRiskAssessmentRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiProperty({ enum: RISK_TYPES }) riskType!: string;
  @ApiProperty({ enum: RISK_LEVELS }) level!: string;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) validUntil?: string | null;
  @ApiProperty() source!: string;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class UpdateRiskAssessmentRequestDto extends AddRiskAssessmentRequestDto {
  @ApiProperty({ minimum: 1 }) expectedRecordVersion!: number;
}

export class ClinicalMeasurementReplacementDto {
  @ApiProperty({ enum: MEASUREMENT_TYPES }) measurementType!: string;
  @ApiProperty({ nullable: true, type: String }) value!: string | null;
  @ApiProperty({ nullable: true, type: Number }) integerValue!: number | null;
  @ApiProperty({ nullable: true, type: Number }) systolic!: number | null;
  @ApiProperty({ nullable: true, type: Number }) diastolic!: number | null;
  @ApiProperty({ enum: measurementUnits }) unit!: string;
  @ApiProperty({ format: 'date-time' }) measuredAt!: string;
  @ApiProperty({ enum: measurementSource }) source!: string;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class ClinicalObservationReplacementDto {
  @ApiProperty({ enum: OBSERVATION_CATEGORIES }) category!: string;
  @ApiPropertyOptional({ nullable: true }) valueCode?: string | null;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 10 }) painScore?: number | null;
  @ApiPropertyOptional({ nullable: true }) location?: string | null;
  @ApiPropertyOptional({ enum: OBSERVATION_SEVERITIES, nullable: true }) severity?: string | null;
  @ApiProperty({ format: 'date-time' }) observedAt!: string;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class ClinicalAssessmentReplacementDto {
  @ApiProperty({ enum: ASSESSMENT_TYPES }) assessmentType!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) resultCode?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) score?: string | null;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) validUntil?: string | null;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

export class ClinicalRiskReplacementDto {
  @ApiProperty({ enum: RISK_TYPES }) riskType!: string;
  @ApiProperty({ enum: RISK_LEVELS }) level!: string;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) validUntil?: string | null;
  @ApiProperty() source!: string;
  @ApiPropertyOptional({ nullable: true }) note?: string | null;
}

@ApiExtraModels(
  ClinicalMeasurementReplacementDto,
  ClinicalObservationReplacementDto,
  ClinicalAssessmentReplacementDto,
  ClinicalRiskReplacementDto,
)
export class AmendClinicalRecordRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) reason!: string;
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ClinicalMeasurementReplacementDto) },
      { $ref: getSchemaPath(ClinicalObservationReplacementDto) },
      { $ref: getSchemaPath(ClinicalAssessmentReplacementDto) },
      { $ref: getSchemaPath(ClinicalRiskReplacementDto) },
    ],
  })
  replacement!:
    | ClinicalMeasurementReplacementDto
    | ClinicalObservationReplacementDto
    | ClinicalAssessmentReplacementDto
    | ClinicalRiskReplacementDto;
}
