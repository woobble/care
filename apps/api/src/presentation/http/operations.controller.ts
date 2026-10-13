import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Put,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthorizationPrincipal } from '@care/permissions';
import {
  type OperationsApplicationService,
  type OperationsQuery,
  type OperationsTaskInput,
  type OperationsTaskListQuery,
  type OperationsTaskPatch,
  type OperationsReminderPolicyInput,
  type OperationsRecurrenceApplicationService,
  type RecurringTaskInput,
  type RecurringTaskPatch,
  type RecurringTaskQuery,
} from '@care/operations';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { OPERATIONS_APPLICATION, OPERATIONS_RECURRENCE_APPLICATION } from '@app/api/tokens';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';

const uuid = z.uuid();
const pageSchema = z.coerce.number().int().min(1).max(100_000).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(50);
const dashboardQuerySchema = z.object({
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
});
const workItemQuerySchema = z.object({
  category: z
    .enum([
      'scheduling',
      'visits',
      'documentation',
      'benefits',
      'billing',
      'claims',
      'onboarding',
      'agreements',
      'employees',
    ])
    .optional(),
  status: z.enum(['open', 'acknowledged', 'snoozed']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
  clientId: uuid.optional(),
  employeeId: uuid.optional(),
  assignedEmployeeId: uuid.optional(),
  sourceDomain: z.string().trim().min(1).max(100).optional(),
  fromDate: z.iso.date().optional(),
  untilDate: z.iso.date().optional(),
  due: z.enum(['overdue', 'today', 'upcoming']).optional(),
  sort: z.enum(['relevance', 'due']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
const exceptionHistoryQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
});
const taskQuerySchema = z.object({
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
  clientId: uuid.optional(),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedEmployeeId: uuid.optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  due: z.enum(['overdue', 'today', 'upcoming']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  order: z.enum(['due', 'created']).optional(),
  page: pageSchema,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const sourceSchema = z.object({
  type: z.enum([
    'client',
    'visit',
    'service_agreement',
    'service_evidence',
    'invoice',
    'claim',
    'benefit_entitlement',
    'document',
    'communication',
  ]),
  id: uuid,
});
const createTaskSchema = z.object({
  organizationId: uuid.optional(),
  facilityId: uuid.nullable().optional(),
  clientId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedEmployeeId: uuid.nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  source: sourceSchema.nullable().optional(),
});
const patchTaskSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(8000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedEmployeeId: uuid.nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const expectedVersionSchema = z.object({ expectedVersion: z.number().int().positive() });
const reminderSettingsQuerySchema = z.object({ organizationId: uuid.optional() });
const reminderPolicySchema = z.object({
  organizationId: uuid,
  category: z.enum(['agreements', 'employees', 'benefits', 'billing', 'onboarding']),
  offsetsDays: z.array(z.number().int().min(0).max(365)).min(1).max(8),
  enabled: z.boolean(),
  createFollowUpTask: z.boolean(),
  assignedEmployeeId: uuid.nullable().optional(),
  expectedVersion: z.number().int().nonnegative(),
});
const deadlineTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedEmployeeId: uuid.nullable().optional(),
});
const commentSchema = z.object({ comment: z.string().trim().min(1).max(4000) });
const acknowledgementSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });
const snoozeSchema = z.object({
  snoozedUntil: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500).optional(),
});
const recurrenceRuleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  month: z.number().int().min(1).max(12).optional(),
});
const recurringTaskFields = {
  organizationId: uuid,
  facilityId: uuid.nullable(),
  clientId: uuid.nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  assignedEmployeeId: uuid.nullable(),
  rule: recurrenceRuleSchema,
  timezone: z.string().trim().min(1).max(100),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  generationPolicy: z.enum(['generate_missed', 'skip_missed']),
};
const recurringTaskCreateSchema = z.object({
  ...recurringTaskFields,
  facilityId: recurringTaskFields.facilityId.optional(),
  clientId: recurringTaskFields.clientId.optional(),
  description: recurringTaskFields.description.optional(),
  priority: recurringTaskFields.priority.optional(),
  assignedEmployeeId: recurringTaskFields.assignedEmployeeId.optional(),
  timezone: recurringTaskFields.timezone.optional(),
  endDate: recurringTaskFields.endDate.optional(),
  timeOfDay: recurringTaskFields.timeOfDay.optional(),
  generationPolicy: recurringTaskFields.generationPolicy.optional(),
});
const recurringTaskPatchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  organizationId: recurringTaskFields.organizationId.optional(),
  facilityId: recurringTaskFields.facilityId.optional(),
  clientId: recurringTaskFields.clientId.optional(),
  title: recurringTaskFields.title.optional(),
  description: recurringTaskFields.description.optional(),
  priority: recurringTaskFields.priority.optional(),
  assignedEmployeeId: recurringTaskFields.assignedEmployeeId.optional(),
  rule: recurringTaskFields.rule.optional(),
  timezone: recurringTaskFields.timezone.optional(),
  startDate: recurringTaskFields.startDate.optional(),
  endDate: recurringTaskFields.endDate.optional(),
  timeOfDay: recurringTaskFields.timeOfDay.optional(),
  generationPolicy: recurringTaskFields.generationPolicy.optional(),
});
const recurringTaskQuerySchema = z.object({
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
  clientId: uuid.optional(),
  assignedEmployeeId: uuid.optional(),
  status: z.enum(['active', 'paused', 'ended']).optional(),
  page: pageSchema,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export class OperationsWorkItemResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: ['exception'] })
  kind!: 'exception';
  @ApiProperty({
    enum: [
      'scheduling',
      'visits',
      'documentation',
      'benefits',
      'billing',
      'claims',
      'onboarding',
      'agreements',
      'employees',
    ],
  })
  category!: string;
  @ApiProperty()
  sourceDomain!: string;
  @ApiProperty()
  sourceEntityType!: string;
  @ApiProperty()
  sourceEntityId!: string;
  @ApiProperty()
  issueCode!: string;
  @ApiProperty()
  titleCode!: string;
  @ApiProperty()
  descriptionCode!: string;
  @ApiProperty()
  categoryLabelCode!: string;
  @ApiProperty({ enum: ['info', 'warning', 'critical'] })
  severity!: 'info' | 'warning' | 'critical';
  @ApiProperty({ enum: ['open', 'acknowledged', 'snoozed'] })
  status!: 'open' | 'acknowledged' | 'snoozed';
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  organizationId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  facilityId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  clientId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  clientName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  employeeId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  employeeName!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dueAt!: string | null;
  @ApiProperty({ format: 'date-time' })
  firstDetectedAt!: string;
  @ApiProperty({ format: 'date-time' })
  lastObservedAt!: string;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  interaction!: Record<string, unknown> | null;
}

export class OperationsExceptionOccurrenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  sourceDomain!: string;
  @ApiProperty()
  sourceEntityType!: string;
  @ApiProperty({ format: 'uuid' })
  sourceEntityId!: string;
  @ApiProperty()
  issueCode!: string;
  @ApiProperty()
  category!: string;
  @ApiProperty()
  severity!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  organizationId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  facilityId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  clientId!: string | null;
  @ApiProperty({ format: 'date-time' })
  firstDetectedAt!: string;
  @ApiProperty({ format: 'date-time' })
  lastObservedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
}

export class OperationsExceptionInteractionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  occurrenceId!: string | null;
  @ApiProperty({ enum: ['acknowledged', 'snoozed'] })
  action!: string;
  @ApiProperty({ enum: ['open', 'acknowledged', 'snoozed'] })
  previousState!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  snoozedUntil!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ format: 'uuid' })
  actorUserId!: string;
  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class OperationsExceptionHistoryResponseDto {
  @ApiProperty()
  issueId!: string;
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  totalOccurrences!: number;
  @ApiProperty()
  totalInteractions!: number;
  @ApiProperty({ type: [OperationsExceptionOccurrenceResponseDto] })
  occurrences!: OperationsExceptionOccurrenceResponseDto[];
  @ApiProperty({ type: [OperationsExceptionInteractionResponseDto] })
  interactions!: OperationsExceptionInteractionResponseDto[];
}

export class OperationsWorklistResponseDto {
  @ApiProperty({ type: [OperationsWorkItemResponseDto] })
  items!: OperationsWorkItemResponseDto[];
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  total!: number;
  @ApiProperty()
  truncated!: boolean;
}

export class OperationsDashboardResponseDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
  @ApiProperty()
  exceptionCount!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  categoryCounts!: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  severityCounts!: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  deadlineCounts!: Record<string, number>;
  @ApiProperty()
  worklistTruncated!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  tasks!: Record<string, number>;
  @ApiProperty({ type: [OperationsWorkItemResponseDto] })
  highPriorityExceptions!: OperationsWorkItemResponseDto[];
}

export class ReminderPolicyRequestDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: ['agreements', 'employees', 'benefits', 'billing', 'onboarding'] })
  category!: string;
  @ApiProperty({ type: [Number], minItems: 1, maxItems: 8 }) offsetsDays!: number[];
  @ApiProperty() enabled!: boolean;
  @ApiProperty() createFollowUpTask!: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) assignedEmployeeId?:
    | string
    | null;
  @ApiProperty({ minimum: 0 }) expectedVersion!: number;
}

export class ReminderPolicySettingResponseDto {
  @ApiProperty({ enum: ['agreements', 'employees', 'benefits', 'billing', 'onboarding'] })
  category!: string;
  @ApiProperty({ type: [Number] }) offsetsDays!: number[];
  @ApiProperty() enabled!: boolean;
  @ApiProperty() createFollowUpTask!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) assignedEmployeeId!: string | null;
  @ApiProperty() version!: number;
}

export class ReminderOrganizationSettingsResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [ReminderPolicySettingResponseDto] })
  policies!: ReminderPolicySettingResponseDto[];
}

export class ReminderSettingsResponseDto {
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) scheduler!: Record<
    string,
    unknown
  > | null;
  @ApiProperty({ type: [ReminderOrganizationSettingsResponseDto] })
  organizations!: ReminderOrganizationSettingsResponseDto[];
}

export class RecurrenceRuleRequestDto {
  @ApiProperty({ enum: ['daily', 'weekly', 'monthly', 'yearly'] }) frequency!: string;
  @ApiProperty({ minimum: 1, maximum: 365 }) interval!: number;
  @ApiPropertyOptional({ type: [Number] }) weekdays?: number[];
  @ApiPropertyOptional({ minimum: 1, maximum: 31 }) dayOfMonth?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 12 }) month?: number;
}

export class RecurringTaskCreateRequestDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) facilityId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) clientId?: string | null;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ enum: ['low', 'normal', 'high', 'urgent'] }) priority?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) assignedEmployeeId?:
    | string
    | null;
  @ApiProperty({ type: RecurrenceRuleRequestDto }) rule!: RecurrenceRuleRequestDto;
  @ApiPropertyOptional() timezone?: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) endDate?: string | null;
  @ApiPropertyOptional({ format: 'time' }) timeOfDay?: string;
  @ApiPropertyOptional({ enum: ['generate_missed', 'skip_missed'] }) generationPolicy?: string;
}

export class RecurringTaskPatchRequestDto {
  @ApiProperty({ minimum: 1 }) expectedVersion!: number;
  @ApiPropertyOptional({ format: 'uuid' }) organizationId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) facilityId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) clientId?: string | null;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ enum: ['low', 'normal', 'high', 'urgent'] }) priority?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) assignedEmployeeId?:
    | string
    | null;
  @ApiPropertyOptional({ type: RecurrenceRuleRequestDto }) rule?: RecurrenceRuleRequestDto;
  @ApiPropertyOptional() timezone?: string;
  @ApiPropertyOptional({ format: 'date' }) startDate?: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) endDate?: string | null;
  @ApiPropertyOptional({ format: 'time' }) timeOfDay?: string;
  @ApiPropertyOptional({ enum: ['generate_missed', 'skip_missed'] }) generationPolicy?: string;
}

export class DeadlineTaskRequestDto {
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ enum: ['low', 'normal', 'high', 'urgent'] }) priority?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) assignedEmployeeId?:
    | string
    | null;
}

export class OperationsTaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  facilityId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  clientId!: string | null;
  @ApiProperty()
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ enum: ['open', 'in_progress', 'completed', 'cancelled'] })
  status!: 'open' | 'in_progress' | 'completed' | 'cancelled';
  @ApiProperty({ enum: ['low', 'normal', 'high', 'urgent'] })
  priority!: 'low' | 'normal' | 'high' | 'urgent';
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  assignedEmployeeId!: string | null;
  @ApiProperty({ enum: ['assignee_unavailable'], nullable: true })
  assignmentWarningCode!: 'assignee_unavailable' | null;
  @ApiProperty({ format: 'uuid' })
  createdByUserId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  completedByUserId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  source!: { type: string; id: string } | null;
  @ApiProperty()
  version!: number;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class OperationsTaskListResponseDto {
  @ApiProperty({ type: [OperationsTaskResponseDto] })
  items!: OperationsTaskResponseDto[];
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  total!: number;
}

export class OperationsTaskActivityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  tenantId!: string;
  @ApiProperty({ format: 'uuid' })
  taskId!: string;
  @ApiProperty({ format: 'uuid' })
  actorUserId!: string;
  @ApiProperty({ type: String, nullable: true })
  actorName!: string | null;
  @ApiProperty({
    enum: [
      'created',
      'edited',
      'assigned',
      'priority_changed',
      'due_date_changed',
      'status_changed',
      'comment',
    ],
  })
  kind!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  details!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;
  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class RecurringTaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  facilityId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  clientId!: string | null;
  @ApiProperty()
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ enum: ['low', 'normal', 'high', 'urgent'] })
  priority!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  assignedEmployeeId!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  rule!: Record<string, unknown>;
  @ApiProperty()
  timezone!: string;
  @ApiProperty({ format: 'date' })
  startDate!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  endDate!: string | null;
  @ApiProperty({ format: 'time' })
  timeOfDay!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  nextOccurrenceDate!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextOccurrenceAt!: string | null;
  @ApiProperty({ enum: ['active', 'paused', 'ended'] })
  status!: string;
  @ApiProperty({ enum: ['generate_missed', 'skip_missed'] })
  generationPolicy!: string;
  @ApiProperty()
  version!: number;
  @ApiProperty({ format: 'uuid' })
  createdByUserId!: string;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class RecurringTaskListResponseDto {
  @ApiProperty({ type: [RecurringTaskResponseDto] })
  items!: RecurringTaskResponseDto[];
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  total!: number;
}

export class RecurringTaskOccurrenceResponseDto {
  @ApiProperty({ format: 'uuid' }) taskId!: string;
  @ApiProperty({ format: 'date' }) occurrenceDate!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ enum: ['open', 'in_progress', 'completed', 'cancelled'] }) status!: string;
  @ApiProperty() title!: string;
}

@ApiTags('operations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/operations')
export class OperationsController {
  constructor(
    @Inject(OPERATIONS_APPLICATION) private readonly operations: OperationsApplicationService,
    @Inject(OPERATIONS_RECURRENCE_APPLICATION)
    private readonly recurringTasks: OperationsRecurrenceApplicationService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Read the bounded Office Operations dashboard summary' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: OperationsDashboardResponseDto })
  dashboard(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = dashboardQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.dashboard(principal(request), withoutUndefined(parsed.data));
  }

  @Get('work-items')
  @ApiOperation({ summary: 'List current source-derived operational exceptions' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: [
      'scheduling',
      'visits',
      'documentation',
      'benefits',
      'billing',
      'claims',
      'onboarding',
      'agreements',
      'employees',
    ],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'acknowledged', 'snoozed'] })
  @ApiQuery({ name: 'severity', required: false, enum: ['info', 'warning', 'critical'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'assignedEmployeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'sourceDomain', required: false })
  @ApiQuery({ name: 'fromDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'untilDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'due', required: false, enum: ['overdue', 'today', 'upcoming'] })
  @ApiQuery({ name: 'sort', required: false, enum: ['relevance', 'due'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: OperationsWorklistResponseDto })
  workItems(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = workItemQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.listWorkItems(principal(request), parsed.data as OperationsQuery);
  }

  @Get('deadlines')
  @ApiOperation({ summary: 'List paginated source-derived deadlines and reminder work items' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['agreements', 'employees', 'benefits', 'billing', 'onboarding'],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'acknowledged', 'snoozed'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'assignedEmployeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'sourceDomain', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['relevance', 'due'] })
  @ApiQuery({ name: 'due', required: false, enum: ['overdue', 'today', 'upcoming'] })
  @ApiQuery({ name: 'fromDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'untilDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: OperationsWorklistResponseDto })
  deadlines(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = workItemQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.listWorkItems(principal(request), {
      ...(parsed.data as OperationsQuery),
      deadlinesOnly: true,
    });
  }

  @Post('deadlines/:id/tasks')
  @ApiOperation({
    summary: 'Create or return the linked Operations task for a live agreement deadline',
  })
  @ApiParam({ name: 'id', description: 'Stable deadline work item identity' })
  @ApiBody({ type: DeadlineTaskRequestDto })
  @ApiCreatedResponse({ type: OperationsTaskResponseDto })
  createDeadlineTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = deadlineTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.createDeadlineTask(
      principal(request),
      id,
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('reminder-settings')
  @ApiOperation({ summary: 'Read organization-scoped deadline reminder policies' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: ReminderSettingsResponseDto })
  reminderSettings(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = reminderSettingsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.reminderSettings(principal(request), parsed.data.organizationId);
  }

  @Put('reminder-settings')
  @ApiOperation({ summary: 'Update one organization-scoped deadline reminder policy' })
  @ApiBody({ type: ReminderPolicyRequestDto })
  @ApiOkResponse({ type: ReminderPolicySettingResponseDto })
  updateReminderSettings(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = reminderPolicySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.updateReminderPolicy(
      principal(request),
      parsed.data as OperationsReminderPolicyInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('work-items/:id/history')
  @ApiOperation({ summary: 'Read scoped occurrence and action history for a stable exception' })
  @ApiParam({ name: 'id', description: 'Stable SHA-256 work-item identity' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: OperationsExceptionHistoryResponseDto })
  exceptionHistory(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = exceptionHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.exceptionHistory(principal(request), id, parsed.data);
  }

  @Post('work-items/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge a currently active exception' })
  @ApiParam({ name: 'id', description: 'Stable SHA-256 work-item identity' })
  @ApiBody({
    schema: { type: 'object', properties: { reason: { type: 'string', maxLength: 500 } } },
  })
  acknowledge(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = acknowledgementSchema.safeParse(body ?? {});
    if (!parsed.success || !/^[a-f0-9]{64}$/.test(id)) throw new BadRequestException();
    return this.operations.acknowledgeException(
      principal(request),
      id,
      parsed.data.reason,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('work-items/:id/snooze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Snooze an eligible warning for up to 30 days' })
  @ApiParam({ name: 'id', description: 'Stable SHA-256 work-item identity' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['snoozedUntil'],
      properties: {
        snoozedUntil: { type: 'string', format: 'date-time' },
        reason: { type: 'string', maxLength: 500 },
      },
    },
  })
  snooze(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = snoozeSchema.safeParse(body);
    if (!parsed.success || !/^[a-f0-9]{64}$/.test(id)) throw new BadRequestException();
    return this.operations.snoozeException(
      principal(request),
      id,
      new Date(parsed.data.snoozedUntil),
      parsed.data.reason,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('tasks')
  @ApiOperation({ summary: 'List manual operational tasks in the caller scope' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'in_progress', 'completed', 'cancelled'],
  })
  @ApiQuery({ name: 'priority', required: false, enum: ['low', 'normal', 'high', 'urgent'] })
  @ApiQuery({ name: 'assignedEmployeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'assignedToMe', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'due', required: false, enum: ['overdue', 'today', 'upcoming'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'order', required: false, enum: ['due', 'created'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: OperationsTaskListResponseDto })
  tasks(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = taskQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.listTasks(principal(request), parsed.data as OperationsTaskListQuery);
  }

  @Get('my-tasks')
  @ApiOperation({ summary: 'List tasks assigned to the current employee' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'in_progress', 'completed', 'cancelled'],
  })
  @ApiQuery({ name: 'priority', required: false, enum: ['low', 'normal', 'high', 'urgent'] })
  @ApiQuery({ name: 'due', required: false, enum: ['overdue', 'today', 'upcoming'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'order', required: false, enum: ['due', 'created'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: OperationsTaskListResponseDto })
  myTasks(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = taskQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.listTasks(principal(request), {
      ...withoutUndefined(parsed.data),
      assignedToMe: true,
    });
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Create a manual operational task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 8000 },
        organizationId: { type: 'string', format: 'uuid' },
        facilityId: { type: 'string', format: 'uuid', nullable: true },
        clientId: { type: 'string', format: 'uuid', nullable: true },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        assignedEmployeeId: { type: 'string', format: 'uuid', nullable: true },
        dueAt: { type: 'string', format: 'date-time', nullable: true },
        source: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            type: {
              type: 'string',
              enum: [
                'client',
                'visit',
                'service_agreement',
                'service_evidence',
                'invoice',
                'claim',
                'benefit_entitlement',
                'document',
                'communication',
              ],
            },
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
  })
  @ApiCreatedResponse({ type: OperationsTaskResponseDto })
  createTask(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const input = {
      ...parsed.data,
      ...(parsed.data.dueAt !== undefined
        ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }
        : {}),
    } as OperationsTaskInput;
    return this.operations.createTask(
      principal(request),
      input,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Read a manual operational task' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OperationsTaskResponseDto })
  getTask(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.operations.getTask(principal(request), parseId(id));
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Edit a task with optimistic version checking' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 8000, nullable: true },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        assignedEmployeeId: { type: 'string', format: 'uuid', nullable: true },
        dueAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiOkResponse({ type: OperationsTaskResponseDto })
  patchTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = patchTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const input = {
      ...parsed.data,
      ...(parsed.data.dueAt !== undefined
        ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }
        : {}),
    } as OperationsTaskPatch;
    return this.operations.patchTask(
      principal(request),
      parseId(id),
      input,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('tasks/:id/activity')
  @ApiOperation({ summary: 'Read task activity and comments' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [OperationsTaskActivityResponseDto] })
  activity(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.operations.taskActivityList(principal(request), parseId(id));
  }

  @Post('tasks/:id/comments')
  @ApiOperation({ summary: 'Add an attributed task comment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['comment'],
      properties: { comment: { type: 'string', minLength: 1, maxLength: 4000 } },
    },
  })
  addComment(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = commentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.addComment(
      principal(request),
      parseId(id),
      parsed.data.comment,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('tasks/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start work on a task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: OperationsTaskResponseDto })
  startTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.startTask(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('tasks/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: OperationsTaskResponseDto })
  completeTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.completeTask(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('tasks/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a completed task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: OperationsTaskResponseDto })
  reopenTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.reopenTask(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('tasks/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: OperationsTaskResponseDto })
  cancelTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.operations.cancelTask(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('recurring-tasks')
  @ApiOperation({ summary: 'List recurring administrative task definitions' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'assignedEmployeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'paused', 'ended'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: RecurringTaskListResponseDto })
  recurringTaskList(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = recurringTaskQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.recurringTasks.list(
      principal(request),
      withoutUndefined(parsed.data) as RecurringTaskQuery,
    );
  }

  @Post('recurring-tasks')
  @ApiOperation({ summary: 'Create a recurring administrative task definition' })
  @ApiBody({ type: RecurringTaskCreateRequestDto })
  @ApiCreatedResponse({ type: RecurringTaskResponseDto })
  createRecurringTask(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = recurringTaskCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.recurringTasks.create(
      principal(request),
      parsed.data as RecurringTaskInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('recurring-tasks/:id')
  @ApiOperation({ summary: 'Read a recurring task definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RecurringTaskResponseDto })
  getRecurringTask(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.recurringTasks.get(principal(request), parseId(id));
  }

  @Get('recurring-tasks/:id/occurrences')
  @ApiOperation({ summary: 'List generated Operations tasks for a recurrence' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [RecurringTaskOccurrenceResponseDto] })
  recurringTaskOccurrences(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.recurringTasks.occurrences(principal(request), parseId(id));
  }

  @Patch('recurring-tasks/:id')
  @ApiOperation({ summary: 'Edit future occurrences of a recurring task' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: RecurringTaskPatchRequestDto })
  @ApiOkResponse({ type: RecurringTaskResponseDto })
  patchRecurringTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = recurringTaskPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.recurringTasks.patch(
      principal(request),
      parseId(id),
      parsed.data as RecurringTaskPatch,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('recurring-tasks/:id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a recurring task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: RecurringTaskResponseDto })
  pauseRecurringTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transitionRecurringTask('pause', request, id, body);
  }

  @Post('recurring-tasks/:id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused recurring task' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: RecurringTaskResponseDto })
  resumeRecurringTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transitionRecurringTask('resume', request, id, body);
  }

  @Post('recurring-tasks/:id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End a recurring task and preserve its history' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: RecurringTaskResponseDto })
  endRecurringTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transitionRecurringTask('end', request, id, body);
  }

  private transitionRecurringTask(
    action: 'pause' | 'resume' | 'end',
    request: ApiRequest,
    id: string,
    body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const args = [
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    ] as const;
    if (action === 'pause') return this.recurringTasks.pause(...args);
    if (action === 'resume') return this.recurringTasks.resume(...args);
    return this.recurringTasks.end(...args);
  }
}

function principal(request: ApiRequest): AuthorizationPrincipal {
  if (!request.principal) throw new BadRequestException();
  return request.principal;
}

function parseId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
