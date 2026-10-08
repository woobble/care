import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CARE_PLAN_EVALUATION_RESULTS,
  CARE_PLAN_GOAL_STATUSES,
  CARE_PLAN_MEASURE_CATEGORIES,
  CARE_PLAN_NEED_CATEGORIES,
  CARE_PLAN_RESOURCE_CATEGORIES,
  CARE_PLAN_STATUSES,
} from '@care/care-planning';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableDate = dateString.nullable().optional();
const expectedVersion = z.number().int().min(1);
const shortText = (max: number) => z.string().min(1).max(max);
const optionalText = (max: number) => z.string().max(max).nullable().optional();

export const carePlanListQuerySchema = z
  .object({
    status: z.enum(CARE_PLAN_STATUSES).optional(),
    clientId: z.string().uuid().optional(),
    clientQuery: z.string().trim().min(1).max(120).optional(),
    facilityId: z.string().uuid().optional(),
    evaluationOverdue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    evaluationDueBefore: dateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const clientCarePlanListQuerySchema = carePlanListQuerySchema.pick({
  status: true,
  page: true,
  pageSize: true,
});

export const createCarePlanSchema = z
  .object({ validFrom: dateString, validUntil: nullableDate })
  .strict();

export const createCarePlanRevisionSchema = z
  .object({
    expectedVersion,
    effectiveFrom: dateString,
    reason: shortText(1000),
  })
  .strict();

export const updateCarePlanAssessmentSchema = z
  .object({
    expectedVersion,
    clientConcerns: optionalText(4000),
    clientWishes: optionalText(4000),
    clientGoals: optionalText(4000),
    clientHabits: optionalText(4000),
    clientPreferences: optionalText(4000),
    clientPriorities: optionalText(4000),
    professionalObservedNeeds: optionalText(4000),
    professionalResources: optionalText(4000),
    professionalLimitations: optionalText(4000),
    professionalRisks: optionalText(4000),
    professionalRationale: optionalText(4000),
  })
  .strict();

const careNeedSchema = z
  .object({
    category: z.enum(CARE_PLAN_NEED_CATEGORIES),
    title: shortText(200),
    description: optionalText(2000),
    source: z.enum([
      'client_report',
      'professional_observation',
      'representative_report',
      'clinical_record',
    ]),
    priority: z.enum(['low', 'normal', 'high']),
    status: z.enum(['active', 'addressed', 'deferred']),
  })
  .strict();

const careResourceSchema = z
  .object({
    category: z.enum(CARE_PLAN_RESOURCE_CATEGORIES),
    description: shortText(2000),
    status: z.enum(['available', 'needs_support', 'unavailable']),
  })
  .strict();

const careGoalSchema = z
  .object({
    title: shortText(200),
    description: optionalText(2000),
    targetDate: nullableDate,
    status: z.enum(CARE_PLAN_GOAL_STATUSES),
    priority: z.enum(['low', 'normal', 'high']),
    needIds: z.array(z.string().uuid()),
  })
  .strict();

const careMeasureSchema = z
  .object({
    title: shortText(200),
    instruction: shortText(4000),
    category: z.enum(CARE_PLAN_MEASURE_CATEGORIES),
    needIds: z.array(z.string().uuid()),
    goalIds: z.array(z.string().uuid()),
    serviceDefinitionId: z.string().uuid().nullable().optional(),
    frequencyText: optionalText(200),
    responsibleRole: optionalText(120),
    validFrom: dateString,
    validUntil: nullableDate,
    status: z.enum(['active', 'discontinued']),
  })
  .strict();

const careRiskResponseSchema = z
  .object({
    clinicalRecordId: z.string().uuid(),
    status: z.enum(['addressed', 'monitor', 'accepted']),
    plannedResponse: shortText(2000),
    needIds: z.array(z.string().uuid()),
    measureIds: z.array(z.string().uuid()),
  })
  .strict();

const carePlanSourceReferenceSchema = z
  .object({
    clinicalRecordId: z.string().uuid(),
    recordKind: z.enum(['measurement', 'observation', 'assessment', 'risk_assessment']),
    rationale: optionalText(1000),
  })
  .strict();

export const addCareNeedSchema = z.object({ ...careNeedSchema.shape, expectedVersion }).strict();
export const updateCareNeedSchema = addCareNeedSchema;
export const addCareResourceSchema = z
  .object({ ...careResourceSchema.shape, expectedVersion })
  .strict();
export const updateCareResourceSchema = addCareResourceSchema;
export const addCareGoalSchema = z.object({ ...careGoalSchema.shape, expectedVersion }).strict();
export const updateCareGoalSchema = addCareGoalSchema;
export const addCareMeasureSchema = z
  .object({ ...careMeasureSchema.shape, expectedVersion })
  .strict();
export const updateCareMeasureSchema = addCareMeasureSchema;
export const addCareRiskResponseSchema = z
  .object({ ...careRiskResponseSchema.shape, expectedVersion })
  .strict();
export const updateCareRiskResponseSchema = addCareRiskResponseSchema;
export const addCarePlanSourceReferenceSchema = z
  .object({ ...carePlanSourceReferenceSchema.shape, expectedVersion })
  .strict();
export const expectedVersionSchema = z.object({ expectedVersion }).strict();

export const carePlanEvaluationSchema = z
  .object({
    expectedVersion,
    revisionId: z.string().uuid(),
    result: z.enum(CARE_PLAN_EVALUATION_RESULTS),
    planChange: z.enum(['none', 'revision_required']),
    summary: shortText(4000),
    nextEvaluationDue: nullableDate,
    goals: z.array(
      z
        .object({
          goalId: z.string().uuid(),
          outcome: z.enum(['achieved', 'partially_achieved', 'not_achieved', 'not_applicable']),
          note: optionalText(1000),
        })
        .strict(),
    ),
  })
  .strict();

export const endCarePlanSchema = z.object({ expectedVersion, reason: shortText(1000) }).strict();

export class CreateCarePlanDto {
  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil?: string | null;
}

export class CreateCarePlanRevisionDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiProperty({ format: 'date' })
  effectiveFrom!: string;

  @ApiProperty({ maxLength: 1000 })
  reason!: string;
}

export class UpdateCarePlanAssessmentDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  clientConcerns?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  clientWishes?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  clientGoals?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  clientHabits?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  clientPreferences?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  clientPriorities?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  professionalObservedNeeds?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  professionalResources?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  professionalLimitations?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  professionalRisks?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  professionalRationale?: string | null;
}

export class CareNeedInputDto {
  @ApiProperty({ enum: [...CARE_PLAN_NEED_CATEGORIES] })
  category!: string;

  @ApiProperty({ maxLength: 200 })
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  description?: string | null;

  @ApiProperty({
    enum: ['client_report', 'professional_observation', 'representative_report', 'clinical_record'],
  })
  source!: string;

  @ApiProperty({ enum: ['low', 'normal', 'high'] })
  priority!: string;

  @ApiProperty({ enum: ['active', 'addressed', 'deferred'] })
  status!: string;

  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CareResourceInputDto {
  @ApiProperty({ enum: [...CARE_PLAN_RESOURCE_CATEGORIES] })
  category!: string;

  @ApiProperty({ maxLength: 2000 })
  description!: string;

  @ApiProperty({ enum: ['available', 'needs_support', 'unavailable'] })
  status!: string;

  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CareGoalInputDto {
  @ApiProperty({ maxLength: 200 })
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  targetDate?: string | null;

  @ApiProperty({ enum: [...CARE_PLAN_GOAL_STATUSES] })
  status!: string;

  @ApiProperty({ enum: ['low', 'normal', 'high'] })
  priority!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  needIds!: string[];

  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CareMeasureInputDto {
  @ApiProperty({ maxLength: 200 })
  title!: string;

  @ApiProperty({ maxLength: 4000 })
  instruction!: string;

  @ApiProperty({ enum: [...CARE_PLAN_MEASURE_CATEGORIES] })
  category!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  needIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  goalIds!: string[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  serviceDefinitionId?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  frequencyText?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  responsibleRole?: string | null;

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  validUntil?: string | null;

  @ApiProperty({ enum: ['active', 'discontinued'] })
  status!: string;

  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CareRiskResponseInputDto {
  @ApiProperty({ format: 'uuid' })
  clinicalRecordId!: string;

  @ApiProperty({ enum: ['addressed', 'monitor', 'accepted'] })
  status!: string;

  @ApiProperty({ maxLength: 2000 })
  plannedResponse!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  needIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  measureIds!: string[];

  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CarePlanSourceReferenceInputDto {
  @ApiProperty({ format: 'uuid' })
  clinicalRecordId!: string;

  @ApiProperty({ enum: ['measurement', 'observation', 'assessment', 'risk_assessment'] })
  recordKind!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  rationale?: string | null;

  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CarePlanGoalOutcomeInputDto {
  @ApiProperty({ format: 'uuid' })
  goalId!: string;

  @ApiProperty({ enum: ['achieved', 'partially_achieved', 'not_achieved', 'not_applicable'] })
  outcome!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  note?: string | null;
}

export class CarePlanEvaluationInputDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ enum: [...CARE_PLAN_EVALUATION_RESULTS] })
  result!: string;

  @ApiProperty({ enum: ['none', 'revision_required'] })
  planChange!: string;

  @ApiProperty({ maxLength: 4000 })
  summary!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  nextEvaluationDue?: string | null;

  @ApiProperty({ type: [CarePlanGoalOutcomeInputDto] })
  goals!: CarePlanGoalOutcomeInputDto[];
}

export class EndCarePlanDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiProperty({ maxLength: 1000 })
  reason!: string;
}

export class ExpectedVersionDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CarePlanPlanDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty({ enum: [...CARE_PLAN_STATUSES] })
  status!: string;

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiProperty({ format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'uuid' })
  createdByEmployeeId!: string;

  @ApiProperty({ nullable: true })
  createdByEmployeeName!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  endedByEmployeeId!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  endedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  endedReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanRevisionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  planId!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ minimum: 1 })
  revisionNumber!: number;

  @ApiProperty({ enum: ['draft', 'active', 'historical'] })
  status!: string;

  @ApiProperty({ format: 'uuid' })
  authorEmployeeId!: string;

  @ApiProperty({ nullable: true })
  authorEmployeeName!: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  reason!: string | null;

  @ApiProperty({ format: 'date' })
  effectiveFrom!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  activatedByEmployeeId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  activatedByEmployeeName!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  activatedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  supersededAt!: string | null;
}

export class CarePlanAssessmentDto {
  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ nullable: true })
  clientConcerns!: string | null;

  @ApiProperty({ nullable: true })
  clientWishes!: string | null;

  @ApiProperty({ nullable: true })
  clientGoals!: string | null;

  @ApiProperty({ nullable: true })
  clientHabits!: string | null;

  @ApiProperty({ nullable: true })
  clientPreferences!: string | null;

  @ApiProperty({ nullable: true })
  clientPriorities!: string | null;

  @ApiProperty({ nullable: true })
  professionalObservedNeeds!: string | null;

  @ApiProperty({ nullable: true })
  professionalResources!: string | null;

  @ApiProperty({ nullable: true })
  professionalLimitations!: string | null;

  @ApiProperty({ nullable: true })
  professionalRisks!: string | null;

  @ApiProperty({ nullable: true })
  professionalRationale!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanNeedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ enum: [...CARE_PLAN_NEED_CATEGORIES] })
  category!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({
    enum: ['client_report', 'professional_observation', 'representative_report', 'clinical_record'],
  })
  source!: string;

  @ApiProperty({ enum: ['low', 'normal', 'high'] })
  priority!: string;

  @ApiProperty({ enum: ['active', 'addressed', 'deferred'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanResourceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ enum: [...CARE_PLAN_RESOURCE_CATEGORIES] })
  category!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: ['available', 'needs_support', 'unavailable'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanRiskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ format: 'uuid' })
  clinicalRecordId!: string;

  @ApiProperty({ enum: ['addressed', 'monitor', 'accepted'] })
  status!: string;

  @ApiProperty()
  plannedResponse!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  needIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  measureIds!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanSourceReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clinicalRecordId!: string;

  @ApiProperty({ enum: ['measurement', 'observation', 'assessment', 'risk_assessment'] })
  recordKind!: string;

  @ApiProperty({ nullable: true })
  rationale!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CarePlanGoalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  targetDate!: string | null;

  @ApiProperty({ enum: [...CARE_PLAN_GOAL_STATUSES] })
  status!: string;

  @ApiProperty({ enum: ['low', 'normal', 'high'] })
  priority!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  needIds!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanMeasureDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty({ enum: [...CARE_PLAN_MEASURE_CATEGORIES] })
  category!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  needIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  goalIds!: string[];

  @ApiProperty({ format: 'uuid', nullable: true })
  serviceDefinitionId!: string | null;

  @ApiProperty({ nullable: true })
  frequencyText!: string | null;

  @ApiProperty({ nullable: true })
  responsibleRole!: string | null;

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiProperty({ format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ enum: ['active', 'discontinued'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CarePlanGoalOutcomeDto {
  @ApiProperty({ format: 'uuid' })
  goalId!: string;

  @ApiProperty({ enum: ['achieved', 'partially_achieved', 'not_achieved', 'not_applicable'] })
  outcome!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;
}

export class CarePlanEvaluationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  planId!: string;

  @ApiProperty({ format: 'uuid' })
  revisionId!: string;

  @ApiProperty({ format: 'uuid' })
  evaluatedByEmployeeId!: string;

  @ApiProperty({ nullable: true })
  evaluatedByEmployeeName!: string | null;

  @ApiProperty({ format: 'date-time' })
  evaluatedAt!: string;

  @ApiProperty({ enum: [...CARE_PLAN_EVALUATION_RESULTS] })
  result!: string;

  @ApiProperty({ enum: ['none', 'revision_required'] })
  planChange!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ format: 'date', nullable: true })
  nextEvaluationDue!: string | null;

  @ApiProperty({ type: [CarePlanGoalOutcomeDto] })
  goals!: CarePlanGoalOutcomeDto[];
}

export class CarePlanRevisionDetailDto {
  @ApiProperty({ type: CarePlanRevisionDto })
  revision!: CarePlanRevisionDto;

  @ApiProperty({ type: CarePlanAssessmentDto })
  assessment!: CarePlanAssessmentDto;

  @ApiProperty({ type: [CarePlanSourceReferenceDto] })
  sourceReferences!: CarePlanSourceReferenceDto[];

  @ApiProperty({ type: [CarePlanNeedDto] })
  needs!: CarePlanNeedDto[];

  @ApiProperty({ type: [CarePlanResourceDto] })
  resources!: CarePlanResourceDto[];

  @ApiProperty({ type: [CarePlanRiskResponseDto] })
  riskResponses!: CarePlanRiskResponseDto[];

  @ApiProperty({ type: [CarePlanGoalDto] })
  goals!: CarePlanGoalDto[];

  @ApiProperty({ type: [CarePlanMeasureDto] })
  measures!: CarePlanMeasureDto[];
}

export class CarePlanDetailDto {
  @ApiProperty({ type: CarePlanPlanDto })
  plan!: CarePlanPlanDto;

  @ApiProperty({ type: CarePlanRevisionDetailDto, nullable: true })
  activeRevision!: CarePlanRevisionDetailDto | null;

  @ApiProperty({ type: CarePlanRevisionDetailDto, nullable: true })
  draftRevision!: CarePlanRevisionDetailDto | null;

  @ApiProperty({ type: CarePlanEvaluationDto, nullable: true })
  latestEvaluation!: CarePlanEvaluationDto | null;

  @ApiProperty({ format: 'date', nullable: true })
  nextEvaluationDue!: string | null;
}

export class CarePlanHistoryDto {
  @ApiProperty({ type: [CarePlanRevisionDetailDto] })
  revisions!: CarePlanRevisionDetailDto[];

  @ApiProperty({ type: [CarePlanEvaluationDto] })
  evaluations!: CarePlanEvaluationDto[];
}

export class CarePlanRevisionDiffGroupDto {
  @ApiProperty({ type: [String] })
  added!: string[];

  @ApiProperty({ type: [String] })
  changed!: string[];

  @ApiProperty({ type: [String] })
  removed!: string[];
}

export class CarePlanRevisionDiffDto {
  @ApiProperty({ type: CarePlanRevisionDiffGroupDto })
  needs!: CarePlanRevisionDiffGroupDto;

  @ApiProperty({ type: CarePlanRevisionDiffGroupDto })
  resources!: CarePlanRevisionDiffGroupDto;

  @ApiProperty({ type: CarePlanRevisionDiffGroupDto })
  riskResponses!: CarePlanRevisionDiffGroupDto;

  @ApiProperty({ type: CarePlanRevisionDiffGroupDto })
  goals!: CarePlanRevisionDiffGroupDto;

  @ApiProperty({ type: CarePlanRevisionDiffGroupDto })
  measures!: CarePlanRevisionDiffGroupDto;

  @ApiProperty({ type: CarePlanRevisionDiffGroupDto })
  sourceReferences!: CarePlanRevisionDiffGroupDto;

  @ApiProperty()
  assessmentChanged!: boolean;
}

export class CarePlanWorklistLatestEvaluationDto {
  @ApiProperty({ format: 'date-time' })
  evaluatedAt!: string;

  @ApiProperty({ enum: [...CARE_PLAN_EVALUATION_RESULTS] })
  result!: string;

  @ApiProperty({ format: 'date', nullable: true })
  nextEvaluationDue!: string | null;
}

export class CarePlanWorklistItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty()
  clientDisplayName!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty()
  facilityName!: string;

  @ApiProperty({ enum: [...CARE_PLAN_STATUSES] })
  status!: string;

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiProperty({ format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: () => CarePlanWorklistLatestEvaluationDto, nullable: true })
  latestEvaluation!: CarePlanWorklistLatestEvaluationDto | null;
}

export class CarePlanListResponseDto {
  @ApiProperty({ type: [CarePlanWorklistItemDto] })
  items!: CarePlanWorklistItemDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

export class VisitCarePlanMeasureDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty({ enum: [...CARE_PLAN_MEASURE_CATEGORIES] })
  category!: string;

  @ApiProperty({ nullable: true })
  frequencyText!: string | null;

  @ApiProperty({ nullable: true })
  responsibleRole!: string | null;
}

export class VisitCarePlanDto {
  @ApiProperty({ format: 'uuid' })
  planId!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ enum: [...CARE_PLAN_STATUSES] })
  status!: string;

  @ApiProperty({ format: 'date' })
  validFrom!: string;

  @ApiProperty({ format: 'date', nullable: true })
  validUntil!: string | null;

  @ApiProperty({ type: [VisitCarePlanMeasureDto] })
  measures!: VisitCarePlanMeasureDto[];
}
