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
} from '@care/operations';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { OPERATIONS_APPLICATION } from '../../tokens';
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
    .enum(['scheduling', 'visits', 'documentation', 'benefits', 'billing', 'claims'])
    .optional(),
  status: z.enum(['open', 'acknowledged', 'snoozed']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
  clientId: uuid.optional(),
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
const commentSchema = z.object({ comment: z.string().trim().min(1).max(4000) });
const acknowledgementSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });
const snoozeSchema = z.object({
  snoozedUntil: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500).optional(),
});

export class OperationsWorkItemResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: ['exception'] })
  kind!: 'exception';
  @ApiProperty({ enum: ['scheduling', 'visits', 'documentation', 'benefits', 'billing', 'claims'] })
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
  @ApiProperty()
  worklistTruncated!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  tasks!: Record<string, number>;
  @ApiProperty({ type: [OperationsWorkItemResponseDto] })
  highPriorityExceptions!: OperationsWorkItemResponseDto[];
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

@ApiTags('operations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/operations')
export class OperationsController {
  constructor(
    @Inject(OPERATIONS_APPLICATION) private readonly operations: OperationsApplicationService,
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
    enum: ['scheduling', 'visits', 'documentation', 'benefits', 'billing', 'claims'],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'acknowledged', 'snoozed'] })
  @ApiQuery({ name: 'severity', required: false, enum: ['info', 'warning', 'critical'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
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
