import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  SchedulingApplicationService,
  type CreateVisitInput,
  type VisitSearchQuery,
} from '@care/scheduling';
import { SCHEDULING_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  createVisitSchema,
  createVisitAssignmentSchema,
  employeeUnavailabilitySchema,
  scheduleGenerationSchema,
  updateVisitSchema,
  visitQuerySchema,
  CreateVisitAssignmentDto,
  CreateVisitDto,
  EmployeeUnavailabilityRequestDto,
  ScheduleGenerationRequestDto,
  UpdateVisitDto,
  VisitDetailResponseDto,
  VisitListResponseDto,
  VisitAssignmentResponseDto,
  VisitAssignmentMutationResponseDto,
  VisitMutationResponseDto,
  ScheduleGenerationResponseDto,
} from './scheduling.dto';
import {
  visitAssignmentMutationResponse,
  visitDetailResponse,
  visitMutationResponse,
  visitResponse,
} from './scheduling.mapper';
import { withoutUndefined } from './validation';

@ApiTags('visits')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/visits')
export class VisitsController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List visits in a bounded calendar range' })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'teamId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['planned', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'serviceDefinitionId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'unassigned', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'origin', required: false, enum: ['agreement_generated', 'manual'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['plannedStart', 'clientName', 'createdAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: VisitListResponseDto })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = visitQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.scheduling.search(
      this.principal(request),
      withoutUndefined(parsed.data) as VisitSearchQuery,
    );
    return { ...result, items: result.items.map(visitResponse) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a manually planned visit' })
  @ApiBody({ type: CreateVisitDto })
  @ApiCreatedResponse({ type: VisitMutationResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createVisitSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const input = withoutUndefined(parsed.data) as CreateVisitInput;
    const created = await this.scheduling.create(
      this.principal(request),
      input,
      requestContext(request),
      auditContext(request),
    );
    return visitMutationResponse(created);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a visit and its operational history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VisitDetailResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return visitDetailResponse(await this.scheduling.get(this.principal(request), parseId(id)));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reschedule or update an operational note' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateVisitDto })
  @ApiOkResponse({ type: VisitMutationResponseDto })
  async update(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateVisitSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const updated = await this.scheduling.update(
      this.principal(request),
      parseId(id),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
    return visitMutationResponse(updated);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a planned visit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VisitMutationResponseDto })
  async confirm(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.changeStatus(request, id, 'confirm');
  }

  @Post(':id/unconfirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return a confirmed visit to planned status' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VisitMutationResponseDto })
  async unconfirm(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.changeStatus(request, id, 'unconfirm');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a visit while retaining its history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VisitMutationResponseDto })
  async cancel(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.changeStatus(request, id, 'cancel');
  }

  @Get(':id/assignments')
  @ApiOperation({ summary: 'List assignment history for a visit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [VisitAssignmentResponseDto] })
  async assignments(@Req() request: ApiRequest, @Param('id') id: string) {
    return (await this.scheduling.listAssignments(this.principal(request), parseId(id))).map(
      assignmentResponse,
    );
  }

  @Post(':id/assignments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign an employee to a visit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateVisitAssignmentDto })
  @ApiCreatedResponse({ type: VisitAssignmentMutationResponseDto })
  async assign(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = createVisitAssignmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const assignment = await this.scheduling.assign(
      this.principal(request),
      parseId(id),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
    return visitAssignmentMutationResponse(assignment);
  }

  @Delete(':id/assignments/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unassign an employee while retaining assignment history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiNoContentResponse()
  async unassign(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    await this.scheduling.unassign(
      this.principal(request),
      parseId(id),
      parseId(assignmentId),
      requestContext(request),
      auditContext(request),
    );
  }

  private async changeStatus(
    request: ApiRequest,
    id: string,
    operation: 'confirm' | 'unconfirm' | 'cancel',
  ) {
    const principal = this.principal(request);
    const visitId = parseId(id);
    const context = requestContext(request);
    const metadata = auditContext(request);
    let updated: Awaited<ReturnType<SchedulingApplicationService['confirm']>>;
    if (operation === 'confirm') {
      updated = await this.scheduling.confirm(principal, visitId, context, metadata);
    } else if (operation === 'unconfirm') {
      updated = await this.scheduling.unconfirm(principal, visitId, context, metadata);
    } else {
      updated = await this.scheduling.cancel(principal, visitId, context, metadata);
    }
    return visitMutationResponse(updated);
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('visit planning')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/service-agreements')
export class AgreementVisitGenerationController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Post(':id/generate-visits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate planned visits from agreement cadence rules' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ScheduleGenerationRequestDto })
  @ApiOkResponse({ type: ScheduleGenerationResponseDto })
  async generate(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = scheduleGenerationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.generateAgreementVisits(
      this.principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('employee availability')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/employees/:employeeId/unavailability')
export class EmployeeUnavailabilityController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an employee unavailability period' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiBody({ type: EmployeeUnavailabilityRequestDto })
  @ApiCreatedResponse({ description: 'Employee unavailability recorded' })
  async create(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ) {
    const parsed = employeeUnavailabilitySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.createUnavailability(
      this.principal(request),
      { ...withoutUndefined(parsed.data), employeeId: parseId(employeeId) },
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function assignmentResponse(
  assignment: Awaited<ReturnType<SchedulingApplicationService['listAssignments']>>[number],
) {
  return {
    id: assignment.id,
    employeeId: assignment.employeeId,
    employeeDisplayName: assignment.employeeDisplayName,
    role: assignment.role,
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
  };
}

function parseId(value: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}

function auditContext(request: ApiRequest): { ip?: string; userAgent?: string } {
  const userAgent = request.get('user-agent');
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
