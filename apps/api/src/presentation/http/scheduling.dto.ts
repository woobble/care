import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const nullableInstant = instant.nullable().optional();
const visitStatus = z.enum(['planned', 'confirmed', 'cancelled']);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const visitQuerySchema = z
  .object({
    from: instant,
    until: instant,
    clientId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    status: visitStatus.optional(),
    serviceDefinitionId: z.string().uuid().optional(),
    unassigned: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    origin: z.enum(['agreement_generated', 'manual']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
    sortBy: z.enum(['plannedStart', 'clientName', 'createdAt']).default('plannedStart'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

const visitServiceInput = z
  .object({
    serviceDefinitionId: z.string().uuid(),
    agreementServiceId: z.string().uuid().optional(),
    plannedQuantity: z.string().max(13).default('1'),
    plannedDurationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  })
  .strict();

export const createVisitSchema = z
  .object({
    clientId: z.string().uuid(),
    serviceAgreementId: z.string().uuid().nullable().optional(),
    plannedStart: instant.optional(),
    plannedEnd: instant.optional(),
    localDate: localDate.optional(),
    localStartTime: localTime.optional(),
    localEndTime: localTime.optional(),
    timeWindowStart: nullableInstant,
    timeWindowEnd: nullableInstant,
    note: z.string().max(2000).nullable().optional(),
    services: z.array(visitServiceInput).min(1).max(20),
    employeeIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict()
  .refine((value) => {
    const hasInstant = value.plannedStart !== undefined || value.plannedEnd !== undefined;
    const hasLocal =
      value.localDate !== undefined ||
      value.localStartTime !== undefined ||
      value.localEndTime !== undefined;
    return (
      hasInstant !== hasLocal &&
      (hasInstant
        ? value.plannedStart !== undefined && value.plannedEnd !== undefined
        : value.localDate !== undefined &&
          value.localStartTime !== undefined &&
          value.localEndTime !== undefined &&
          value.localEndTime > value.localStartTime)
    );
  });

export const updateVisitSchema = z
  .object({
    plannedStart: instant.optional(),
    plannedEnd: instant.optional(),
    localDate: localDate.optional(),
    localStartTime: localTime.optional(),
    localEndTime: localTime.optional(),
    timeWindowStart: nullableInstant,
    timeWindowEnd: nullableInstant,
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => {
    const hasLocal =
      value.localDate !== undefined ||
      value.localStartTime !== undefined ||
      value.localEndTime !== undefined;
    const hasInstant = value.plannedStart !== undefined || value.plannedEnd !== undefined;
    if (hasLocal) {
      return (
        !hasInstant &&
        value.localDate !== undefined &&
        value.localStartTime !== undefined &&
        value.localEndTime !== undefined &&
        value.localEndTime > value.localStartTime
      );
    }
    return Object.keys(value).length > 0;
  });

export const createVisitAssignmentSchema = z
  .object({
    employeeId: z.string().uuid(),
    role: z.string().max(80).nullable().optional(),
  })
  .strict();

export const scheduleGenerationSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export const employeeUnavailabilitySchema = z
  .object({
    startsAt: instant,
    endsAt: instant,
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

export class CreateVisitServiceDto {
  @ApiProperty({ format: 'uuid' })
  serviceDefinitionId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  agreementServiceId?: string;

  @ApiPropertyOptional({ default: '1', type: String })
  plannedQuantity?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440, nullable: true })
  plannedDurationMinutes?: number | null;
}

export class CreateVisitDto {
  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  serviceAgreementId?: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  plannedStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  plannedEnd?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-07' })
  localDate?: string;

  @ApiPropertyOptional({ format: 'time', example: '08:30' })
  localStartTime?: string;

  @ApiPropertyOptional({ format: 'time', example: '09:30' })
  localEndTime?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  note?: string | null;

  @ApiProperty({ type: [CreateVisitServiceDto] })
  services!: CreateVisitServiceDto[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  employeeIds?: string[];
}

export class UpdateVisitDto {
  @ApiPropertyOptional({ format: 'date-time' })
  plannedStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  plannedEnd?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-07' })
  localDate?: string;

  @ApiPropertyOptional({ format: 'time', example: '08:30' })
  localStartTime?: string;

  @ApiPropertyOptional({ format: 'time', example: '09:30' })
  localEndTime?: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  timeWindowStart?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  timeWindowEnd?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  note?: string | null;
}

export class CreateVisitAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  role?: string | null;
}

export class ScheduleGenerationRequestDto {
  @ApiProperty({ format: 'date', example: '2026-10-07' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-11-03' })
  until!: string;
}

export class EmployeeUnavailabilityRequestDto {
  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  endsAt!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  note?: string | null;
}

export class VisitServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceDefinitionId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  agreementServiceId!: string | null;

  @ApiProperty()
  serviceCode!: string;

  @ApiProperty()
  serviceName!: string;

  @ApiProperty({ enum: ['occurrence', 'minute', 'hour', 'day'] })
  unit!: 'occurrence' | 'minute' | 'hour' | 'day';

  @ApiProperty({ type: String })
  plannedQuantity!: string;

  @ApiPropertyOptional({ nullable: true })
  plannedDurationMinutes!: number | null;
}

export class VisitAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty()
  employeeDisplayName!: string;

  @ApiPropertyOptional({ nullable: true })
  role!: string | null;

  @ApiProperty({ enum: ['active', 'unassigned'] })
  status!: 'active' | 'unassigned';

  @ApiProperty({ format: 'date-time' })
  assignedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  unassignedAt!: string | null;
}

export class VisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty()
  clientDisplayName!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty()
  facilityName!: string;

  @ApiProperty({ enum: ['agreement_generated', 'manual'] })
  origin!: 'agreement_generated' | 'manual';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  serviceAgreementId!: string | null;

  @ApiProperty({ enum: ['planned', 'confirmed', 'cancelled'] })
  status!: 'planned' | 'confirmed' | 'cancelled';

  @ApiProperty({ format: 'date-time' })
  plannedStart!: string;

  @ApiProperty({ format: 'date-time' })
  plannedEnd!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  timeWindowStart!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  timeWindowEnd!: string | null;

  @ApiProperty({ example: 'Europe/Berlin' })
  timezone!: string;

  @ApiProperty()
  manuallyAdjusted!: boolean;

  @ApiProperty({ type: [VisitServiceResponseDto] })
  services!: VisitServiceResponseDto[];

  @ApiProperty({ type: [VisitAssignmentResponseDto] })
  assignments!: VisitAssignmentResponseDto[];

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  note?: string | null;
}

export class VisitMutationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  facilityId!: string;

  @ApiProperty({ enum: ['agreement_generated', 'manual'] })
  origin!: 'agreement_generated' | 'manual';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  serviceAgreementId!: string | null;

  @ApiProperty({ enum: ['planned', 'confirmed', 'cancelled'] })
  status!: 'planned' | 'confirmed' | 'cancelled';

  @ApiProperty({ format: 'date-time' })
  plannedStart!: string;

  @ApiProperty({ format: 'date-time' })
  plannedEnd!: string;

  @ApiProperty({ example: 'Europe/Berlin' })
  timezone!: string;

  @ApiProperty()
  manuallyAdjusted!: boolean;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  note!: string | null;

  @ApiProperty({ type: [VisitServiceResponseDto] })
  services!: VisitServiceResponseDto[];
}

export class VisitAssignmentMutationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  role!: string | null;

  @ApiProperty({ enum: ['active', 'unassigned'] })
  status!: 'active' | 'unassigned';

  @ApiProperty({ format: 'date-time' })
  assignedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  unassignedAt!: string | null;
}

export class VisitListResponseDto {
  @ApiProperty({ type: [VisitResponseDto] })
  items!: VisitResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class VisitHistoryEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  actorId!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

export class VisitDetailResponseDto extends VisitResponseDto {
  @ApiProperty({ type: [VisitAssignmentResponseDto] })
  assignmentHistory!: VisitAssignmentResponseDto[];

  @ApiProperty({ type: [VisitHistoryEntryDto] })
  history!: VisitHistoryEntryDto[];
}

export class ScheduleGenerationResponseDto {
  @ApiProperty({ format: 'uuid' })
  generationId!: string;

  @ApiProperty()
  generated!: number;

  @ApiProperty()
  alreadyExisting!: number;

  @ApiProperty()
  requiresManualPlacement!: number;
}
