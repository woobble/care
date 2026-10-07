import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const positiveVersion = z.number().int().positive();
const reasonCodes = [
  'client_declined',
  'client_not_present',
  'service_not_required',
  'time_constraint',
  'provider_decision',
  'other',
] as const;

export const myVisitsQuerySchema = z.object({
  from: timestamp,
  until: timestamp,
});

export const executionSummariesQuerySchema = z
  .object({
    visitIds: z
      .string()
      .min(1)
      .transform((value) => value.split(','))
      .pipe(z.array(z.string().uuid()).min(1).max(100))
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export const recordPerformedServiceSchema = z
  .object({
    expectedVersion: positiveVersion,
    visitServiceId: z.string().uuid().optional(),
    serviceDefinitionId: z.string().uuid().optional(),
    status: z.enum(['performed', 'partially_performed', 'not_performed']),
    actualQuantity: z.string().nullable(),
    reasonCode: z.enum(reasonCodes).nullable().optional(),
  })
  .refine((value) => value.visitServiceId !== undefined || value.serviceDefinitionId !== undefined);

export const completeExecutionSchema = z.object({
  expectedVersion: positiveVersion,
});

export const correctExecutionTimesSchema = z
  .object({
    expectedVersion: positiveVersion,
    actualStart: timestamp.optional(),
    actualEnd: timestamp.optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine((value) => value.actualStart !== undefined || value.actualEnd !== undefined);

export class RecordPerformedServiceRequestDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  visitServiceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  serviceDefinitionId?: string;

  @ApiProperty({ enum: ['performed', 'partially_performed', 'not_performed'] })
  status!: 'performed' | 'partially_performed' | 'not_performed';

  @ApiProperty({ nullable: true, example: '20.000' })
  actualQuantity!: string | null;

  @ApiPropertyOptional({
    enum: reasonCodes,
    nullable: true,
  })
  reasonCode?: (typeof reasonCodes)[number] | null;
}

export class CompleteExecutionRequestDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;
}

export class CorrectExecutionTimesRequestDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiPropertyOptional({ format: 'date-time' })
  actualStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  actualEnd?: string;

  @ApiProperty({ minLength: 1, maxLength: 1000 })
  reason!: string;
}

export class ExecutionVisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty()
  clientDisplayName!: string;

  @ApiPropertyOptional({ nullable: true })
  address!: string | null;

  @ApiProperty({ enum: ['planned', 'confirmed', 'cancelled'] })
  status!: 'planned' | 'confirmed' | 'cancelled';

  @ApiProperty({ format: 'date-time' })
  plannedStart!: string;

  @ApiProperty({ format: 'date-time' })
  plannedEnd!: string;

  @ApiProperty()
  timezone!: string;
}

export class ExecutionResponseDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  id!: string | null;

  @ApiProperty({ enum: ['not_started', 'in_progress', 'completed'] })
  status!: 'not_started' | 'in_progress' | 'completed';

  @ApiProperty({ minimum: 0 })
  version!: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualStart!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualEnd!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  startedByEmployeeId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  startedByEmployeeName!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  completedByEmployeeId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  completedByEmployeeName!: string | null;
}

export class PerformedServiceResponseDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  id!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  visitServiceId!: string | null;

  @ApiProperty({ format: 'uuid' })
  serviceDefinitionId!: string;

  @ApiProperty()
  serviceCode!: string;

  @ApiProperty()
  serviceName!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit!: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiPropertyOptional({ nullable: true, example: '30.000' })
  plannedQuantity!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '20.000' })
  actualQuantity!: string | null;

  @ApiProperty({ enum: ['not_recorded', 'performed', 'partially_performed', 'not_performed'] })
  status!: 'not_recorded' | 'performed' | 'partially_performed' | 'not_performed';

  @ApiPropertyOptional({
    nullable: true,
    enum: reasonCodes,
  })
  reasonCode!: (typeof reasonCodes)[number] | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  performedByEmployeeId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  performedByEmployeeName!: string | null;

  @ApiProperty()
  unplanned!: boolean;
}

export class VisitExecutionDetailResponseDto {
  @ApiProperty({ type: ExecutionVisitResponseDto })
  visit!: ExecutionVisitResponseDto;

  @ApiProperty({ type: ExecutionResponseDto })
  execution!: ExecutionResponseDto;

  @ApiProperty({ type: [PerformedServiceResponseDto] })
  services!: PerformedServiceResponseDto[];
}

export class RecordedServiceResponseDto {
  @ApiProperty({ type: PerformedServiceResponseDto })
  service!: PerformedServiceResponseDto;

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class CorrectExecutionTimesResponseDto {
  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class AvailableServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit!: 'occurrence' | 'minute' | 'hour' | 'day';
}

export class CaregiverVisitServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit!: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiProperty({ example: '1.000' })
  plannedQuantity!: string;
}

export class CaregiverVisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty()
  clientDisplayName!: string;

  @ApiPropertyOptional({ nullable: true })
  address!: string | null;

  @ApiProperty({ enum: ['planned', 'confirmed', 'cancelled'] })
  status!: 'planned' | 'confirmed' | 'cancelled';

  @ApiProperty({ format: 'date-time' })
  plannedStart!: string;

  @ApiProperty({ format: 'date-time' })
  plannedEnd!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ enum: ['not_started', 'in_progress', 'completed'] })
  executionStatus!: 'not_started' | 'in_progress' | 'completed';

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualStart!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualEnd!: string | null;

  @ApiProperty({ type: [CaregiverVisitServiceResponseDto] })
  services!: CaregiverVisitServiceResponseDto[];
}

export class VisitExecutionSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ enum: ['not_started', 'in_progress', 'completed'] })
  executionStatus!: 'not_started' | 'in_progress' | 'completed';

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualStart!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualEnd!: string | null;
}
