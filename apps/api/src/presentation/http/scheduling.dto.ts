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
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    localStartDate: localDate.optional(),
    localStartTime: localTime.optional(),
    localEndDate: localDate.optional(),
    localEndTime: localTime.optional(),
    timezone: z.string().min(1).max(100).optional(),
    reason: z
      .enum(['vacation', 'sick_leave', 'training', 'personal_unavailability', 'other'])
      .default('other'),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => {
    const hasInstants = value.startsAt !== undefined || value.endsAt !== undefined;
    const hasLocal =
      value.localStartDate !== undefined ||
      value.localStartTime !== undefined ||
      value.localEndDate !== undefined ||
      value.localEndTime !== undefined;
    return (
      hasInstants !== hasLocal &&
      (hasInstants
        ? value.startsAt !== undefined && value.endsAt !== undefined && value.timezone === undefined
        : value.localStartDate !== undefined &&
          value.localStartTime !== undefined &&
          value.localEndDate !== undefined &&
          value.localEndTime !== undefined &&
          value.timezone !== undefined)
    );
  });

const availabilityWindowSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startsAt: localTime,
    endsAt: localTime,
  })
  .strict();

export const employeeAvailabilitySchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    timezone: z.string().min(1).max(100),
    maxDailyMinutes: z.number().int().min(1).max(1440).nullable(),
    travelBufferMinutes: z.number().int().min(0).max(240),
    windows: z.array(availabilityWindowSchema).max(28),
  })
  .strict();

export const employeeAvailabilityExceptionSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    localDate,
    kind: z.enum(['working_hours', 'closed', 'unavailable']),
    startsAt: localTime.nullable(),
    endsAt: localTime.nullable(),
  })
  .strict();

export const employeeUnavailabilityQuerySchema = z
  .object({ from: instant, until: instant })
  .strict();

const preferenceWindowSchema = z
  .object({ startsAt: localTime, endsAt: localTime })
  .strict()
  .refine((window) => window.startsAt < window.endsAt);

export const createSubstitutionSchema = z
  .object({
    originalAssignmentId: z.string().uuid(),
    substituteEmployeeId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const createTourSchema = z
  .object({
    employeeId: z.string().uuid(),
    localDate,
    timezone: z.string().min(1).max(100),
    visitIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export const updateTourStopsSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    stops: z
      .array(
        z
          .object({
            visitId: z.string().uuid(),
            dispatcherNote: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const tourVersionSchema = z
  .object({ expectedVersion: z.coerce.number().int().min(1) })
  .strict();

export const tourListQuerySchema = z
  .object({
    employeeId: z.string().uuid(),
    from: localDate,
    until: localDate,
  })
  .strict();

export const routingLocationSchema = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .strict();

export const employeeSchedulingPreferencesSchema = z
  .object({
    preferredWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
    preferredTimeWindows: z.array(preferenceWindowSchema).max(16),
    preferredStartLatitude: z.number().min(-90).max(90).nullable(),
    preferredStartLongitude: z.number().min(-180).max(180).nullable(),
    travelMode: z.literal('driving'),
  })
  .strict();

export const clientSchedulingPreferencesSchema = z
  .object({
    preferredWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
    preferredTimeWindows: z.array(preferenceWindowSchema).max(16),
    preferredEmployeeId: z.string().uuid().nullable(),
    avoidedEmployeeIds: z.array(z.string().uuid()).max(100),
  })
  .strict();

export const preferenceSubjectParamsSchema = z.object({ employeeId: z.string().uuid() }).strict();

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
  @ApiPropertyOptional({ format: 'date-time' })
  startsAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  endsAt?: string;

  @ApiPropertyOptional({ format: 'date' })
  localStartDate?: string;

  @ApiPropertyOptional({ format: 'time' })
  localStartTime?: string;

  @ApiPropertyOptional({ format: 'date' })
  localEndDate?: string;

  @ApiPropertyOptional({ format: 'time' })
  localEndTime?: string;

  @ApiPropertyOptional({ example: 'Europe/Berlin' })
  timezone?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  note?: string | null;

  @ApiPropertyOptional({
    enum: ['vacation', 'sick_leave', 'training', 'personal_unavailability', 'other'],
    default: 'other',
  })
  reason?: 'vacation' | 'sick_leave' | 'training' | 'personal_unavailability' | 'other';
}

export class EmployeeAvailabilityWindowDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday, Monday=1 and Sunday=7' })
  weekday!: number;

  @ApiProperty({ format: 'time', example: '08:00' })
  startsAt!: string;

  @ApiProperty({ format: 'time', example: '16:00' })
  endsAt!: string;
}

export class EmployeeAvailabilityExceptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  localDate!: string;

  @ApiProperty({ enum: ['working_hours', 'closed', 'unavailable'] })
  kind!: 'working_hours' | 'closed' | 'unavailable';

  @ApiProperty({ format: 'time', nullable: true })
  startsAt!: string | null;

  @ApiProperty({ format: 'time', nullable: true })
  endsAt!: string | null;
}

export class EmployeeAvailabilityPolicyDto {
  @ApiProperty({ example: 'Europe/Berlin' })
  timezone!: string;

  @ApiProperty({ minimum: 1, maximum: 1440, nullable: true })
  maxDailyMinutes!: number | null;

  @ApiProperty({ minimum: 0, maximum: 240 })
  travelBufferMinutes!: number;

  @ApiProperty({ type: [EmployeeAvailabilityWindowDto] })
  windows!: EmployeeAvailabilityWindowDto[];

  @ApiProperty({ type: [EmployeeAvailabilityExceptionDto] })
  exceptions!: EmployeeAvailabilityExceptionDto[];
}

export class EmployeeAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ minimum: 0 })
  version!: number;

  @ApiProperty({ type: EmployeeAvailabilityPolicyDto, nullable: true })
  availability!: EmployeeAvailabilityPolicyDto | null;
}

export class EmployeeAvailabilityRequestDto {
  @ApiProperty({ minimum: 0 })
  expectedVersion!: number;

  @ApiProperty({ example: 'Europe/Berlin' })
  timezone!: string;

  @ApiProperty({ minimum: 1, maximum: 1440, nullable: true })
  maxDailyMinutes!: number | null;

  @ApiProperty({ minimum: 0, maximum: 240 })
  travelBufferMinutes!: number;

  @ApiProperty({ type: [EmployeeAvailabilityWindowDto] })
  windows!: EmployeeAvailabilityWindowDto[];
}

export class EmployeeAvailabilityExceptionRequestDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiProperty({ format: 'date' })
  localDate!: string;

  @ApiProperty({ enum: ['working_hours', 'closed', 'unavailable'] })
  kind!: 'working_hours' | 'closed' | 'unavailable';

  @ApiProperty({ format: 'time', nullable: true })
  startsAt!: string | null;

  @ApiProperty({ format: 'time', nullable: true })
  endsAt!: string | null;
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

export class EmployeeAbsenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  endsAt!: string;

  @ApiProperty({ enum: ['vacation', 'sick_leave', 'training', 'personal_unavailability', 'other'] })
  reason!: 'vacation' | 'sick_leave' | 'training' | 'personal_unavailability' | 'other';

  @ApiProperty({ enum: ['active', 'cancelled'] })
  status!: 'active' | 'cancelled';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'uuid' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ format: 'uuid' })
  updatedBy!: string;
}

export class EmployeeAbsenceListResponseDto {
  @ApiProperty({ type: [EmployeeAbsenceResponseDto] })
  absences!: EmployeeAbsenceResponseDto[];

  @ApiProperty({ type: [VisitResponseDto] })
  impactedVisits!: VisitResponseDto[];

  @ApiProperty()
  impactedVisitCount!: number;
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

export class CreateSubstitutionDto {
  @ApiProperty({ format: 'uuid' })
  originalAssignmentId!: string;

  @ApiProperty({ format: 'uuid' })
  substituteEmployeeId!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  reason!: string;
}

export class SubstituteCandidateResponseDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  preferred!: boolean;
}

export class SchedulingPreferenceTimeWindowDto {
  @ApiProperty({ format: 'time', example: '08:00' })
  startsAt!: string;

  @ApiProperty({ format: 'time', example: '12:00' })
  endsAt!: string;
}

export class TourChangeSummaryDto {
  @ApiProperty()
  type!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  visitId?: string;
}

export class CreateTourDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ format: 'date' })
  localDate!: string;

  @ApiProperty({ example: 'Europe/Berlin' })
  timezone!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  visitIds!: string[];
}

export class TourStopInputDto {
  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  dispatcherNote?: string | null;
}

export class UpdateTourStopsDto {
  @ApiProperty({ minimum: 1 })
  expectedVersion!: number;

  @ApiProperty({ type: [TourStopInputDto] })
  stops!: TourStopInputDto[];
}

export class TourStopResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ minimum: 1 })
  sequence!: number;

  @ApiProperty({ format: 'date-time' })
  plannedStart!: string;

  @ApiProperty({ format: 'date-time' })
  plannedEnd!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ nullable: true })
  estimatedTravelMinutes!: number | null;

  @ApiProperty({ nullable: true })
  estimatedDistanceMeters!: number | null;

  @ApiProperty({ enum: ['unknown', 'available', 'unavailable', 'unresolved'] })
  routeStatus!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  dispatcherNote!: string | null;
}

export class TourPublicationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ type: [Object] })
  snapshot!: object[];

  @ApiProperty({ type: [TourChangeSummaryDto] })
  changeSummary!: TourChangeSummaryDto[];

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;

  @ApiProperty({ format: 'uuid' })
  publishedBy!: string;
}

export class TourResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'date' })
  localDate!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ enum: ['draft', 'published'] })
  status!: 'draft' | 'published';

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: [TourStopResponseDto] })
  stops!: TourStopResponseDto[];

  @ApiPropertyOptional({ nullable: true, type: TourPublicationResponseDto })
  latestPublication!: TourPublicationResponseDto | null;
}

export class TourListItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'date' })
  localDate!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ enum: ['draft', 'published'] })
  status!: 'draft' | 'published';

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty()
  stopCount!: number;

  @ApiPropertyOptional({ nullable: true })
  latestPublishedVersion!: number | null;
}

export class SchedulingConflictDto {
  @ApiProperty({
    enum: [
      'missing_assignment',
      'employee_overlap',
      'employee_absence',
      'outside_employee_availability',
      'employee_availability_unknown',
      'insufficient_travel_time',
      'travel_feasibility_unknown',
      'client_overlap',
      'employee_preference',
      'client_preference',
      'substitution_awaiting_confirmation',
      'unpublished_schedule_changes',
    ],
  })
  code!: string;

  @ApiProperty({ enum: ['blocking', 'warning'] })
  severity!: 'blocking' | 'warning';

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  relatedVisitId?: string;
}

export class VisitSubstitutionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ format: 'uuid' })
  originalEmployeeId!: string;

  @ApiProperty({ format: 'uuid' })
  substituteEmployeeId!: string;

  @ApiProperty({ enum: ['proposed', 'confirmed', 'cancelled'] })
  status!: 'proposed' | 'confirmed' | 'cancelled';

  @ApiProperty({ maxLength: 500 })
  reason!: string;
}

export class SchedulingWorklistItemDto {
  @ApiProperty({ type: VisitResponseDto })
  visit!: VisitResponseDto;

  @ApiProperty({ type: [SchedulingConflictDto] })
  conflicts!: SchedulingConflictDto[];

  @ApiProperty({ type: [VisitSubstitutionResponseDto] })
  proposedSubstitutions!: VisitSubstitutionResponseDto[];
}

export class SchedulingWorklistResponseDto {
  @ApiProperty({ type: [SchedulingWorklistItemDto] })
  items!: SchedulingWorklistItemDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class RouteOrderSuggestionResponseDto {
  @ApiProperty({ enum: ['available', 'unavailable', 'unresolved'] })
  status!: 'available' | 'unavailable' | 'unresolved';

  @ApiProperty({ type: [String], format: 'uuid' })
  visitIds!: string[];

  @ApiProperty({ type: [SchedulingConflictDto] })
  conflicts!: SchedulingConflictDto[];
}

export class CaregiverTourStopResponseDto {
  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ minimum: 1 })
  sequence!: number;

  @ApiProperty({ format: 'date-time' })
  plannedStart!: string;

  @ApiProperty({ format: 'date-time' })
  plannedEnd!: string;

  @ApiPropertyOptional({ nullable: true })
  estimatedTravelMinutes!: number | null;

  @ApiPropertyOptional({ nullable: true })
  estimatedDistanceMeters!: number | null;

  @ApiProperty({ enum: ['unknown', 'available', 'unavailable', 'unresolved'] })
  routeStatus!: string;
}

export class MyTodayTourResponseDto {
  @ApiProperty({ format: 'uuid' })
  tourId!: string;

  @ApiProperty({ format: 'date' })
  localDate!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;

  @ApiProperty({ type: [TourChangeSummaryDto] })
  changeSummary!: Array<{ type: string }>;

  @ApiProperty({ type: [CaregiverTourStopResponseDto] })
  stops!: CaregiverTourStopResponseDto[];
}

export class RoutingLocationDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  latitude!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  longitude!: number;
}

export class EmployeeSchedulingPreferencesDto {
  @ApiProperty({ type: [Number] })
  preferredWeekdays!: number[];

  @ApiProperty({ type: [SchedulingPreferenceTimeWindowDto] })
  preferredTimeWindows!: SchedulingPreferenceTimeWindowDto[];

  @ApiProperty({ nullable: true })
  preferredStartLatitude!: number | null;

  @ApiProperty({ nullable: true })
  preferredStartLongitude!: number | null;

  @ApiProperty({ enum: ['driving'] })
  travelMode!: 'driving';
}

export class ClientSchedulingPreferencesDto {
  @ApiProperty({ type: [Number] })
  preferredWeekdays!: number[];

  @ApiProperty({ type: [SchedulingPreferenceTimeWindowDto] })
  preferredTimeWindows!: SchedulingPreferenceTimeWindowDto[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  preferredEmployeeId!: string | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  avoidedEmployeeIds!: string[];
}
