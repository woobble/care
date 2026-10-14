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
  Put,
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
  type EmployeeAvailabilityInput,
  type EmployeeAvailabilityExceptionInput,
  type CreateVisitInput,
  type VisitSearchQuery,
  type CreateTourInput,
  type UpdateTourStopsInput,
} from '@care/scheduling';
import { SCHEDULING_APPLICATION } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import {
  createVisitSchema,
  createVisitAssignmentSchema,
  employeeUnavailabilitySchema,
  employeeUnavailabilityQuerySchema,
  createSubstitutionSchema,
  createTourSchema,
  updateTourStopsSchema,
  tourVersionSchema,
  tourListQuerySchema,
  routingLocationSchema,
  employeeSchedulingPreferencesSchema,
  clientSchedulingPreferencesSchema,
  employeeAvailabilitySchema,
  employeeAvailabilityExceptionSchema,
  scheduleGenerationSchema,
  updateVisitSchema,
  visitQuerySchema,
  CreateVisitAssignmentDto,
  CreateVisitDto,
  EmployeeUnavailabilityRequestDto,
  EmployeeAvailabilityRequestDto,
  EmployeeAvailabilityExceptionRequestDto,
  ScheduleGenerationRequestDto,
  UpdateVisitDto,
  VisitDetailResponseDto,
  VisitListResponseDto,
  VisitAssignmentResponseDto,
  VisitAssignmentMutationResponseDto,
  VisitMutationResponseDto,
  EmployeeAvailabilityResponseDto,
  EmployeeAbsenceListResponseDto,
  ScheduleGenerationResponseDto,
  CreateSubstitutionDto,
  CreateTourDto,
  UpdateTourStopsDto,
  TourResponseDto,
  RoutingLocationDto,
  EmployeeSchedulingPreferencesDto,
  ClientSchedulingPreferencesDto,
  SchedulingWorklistResponseDto,
  RouteOrderSuggestionResponseDto,
  TourListItemResponseDto,
  VisitSubstitutionResponseDto,
  MyTodayTourResponseDto,
  SubstituteCandidateResponseDto,
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
  @ApiQuery({ name: 'search', required: false, type: String, maxLength: 100 })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'serviceDefinitionId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'origin', required: false, enum: ['agreement_generated', 'manual'] })
  @ApiQuery({ name: 'status', required: false, enum: ['planned', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'serviceDefinitionId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'unassigned', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'origin', required: false, enum: ['agreement_generated', 'manual'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['plannedStart', 'clientName', 'createdAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
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

  @Get(':id/substitute-candidates')
  @ApiOperation({ summary: 'List available employees who can substitute this visit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [SubstituteCandidateResponseDto] })
  async substituteCandidates(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.scheduling.substituteCandidates(this.principal(request), parseId(id));
  }

  @Post(':id/substitutions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Propose a substitute while leaving the current assignment active' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateSubstitutionDto })
  @ApiCreatedResponse({ type: VisitSubstitutionResponseDto })
  async proposeSubstitution(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = createSubstitutionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.proposeSubstitution(
      this.principal(request),
      parseId(id),
      parsed.data,
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

  @Get()
  @ApiOperation({ summary: 'List employee absences and assigned visits that need action' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiOkResponse({ type: EmployeeAbsenceListResponseDto })
  async list(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = employeeUnavailabilityQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.scheduling.listUnavailability(
      this.principal(request),
      parseId(employeeId),
      parsed.data.from,
      parsed.data.until,
    );
    return { ...result, impactedVisits: result.impactedVisits.map(visitResponse) };
  }

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

  @Delete(':absenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an absence while preserving its history' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiParam({ name: 'absenceId', format: 'uuid' })
  @ApiNoContentResponse()
  async cancel(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Param('absenceId') absenceId: string,
  ) {
    await this.scheduling.cancelUnavailability(
      this.principal(request),
      parseId(employeeId),
      parseId(absenceId),
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
@Controller('api/v1/employees/:employeeId/availability')
export class EmployeeAvailabilityController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read an employee weekly working availability and dated exceptions' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeAvailabilityResponseDto })
  async get(@Req() request: ApiRequest, @Param('employeeId') employeeId: string) {
    return this.scheduling.getEmployeeAvailability(this.principal(request), parseId(employeeId));
  }

  @Put()
  @ApiOperation({ summary: 'Replace weekly employee working availability' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiBody({ type: EmployeeAvailabilityRequestDto })
  @ApiOkResponse({ type: EmployeeAvailabilityResponseDto })
  async save(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ) {
    const parsed = employeeAvailabilitySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.saveEmployeeAvailability(
      this.principal(request),
      { ...parsed.data, employeeId: parseId(employeeId) } as EmployeeAvailabilityInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('exceptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a date-specific working availability exception' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiBody({ type: EmployeeAvailabilityExceptionRequestDto })
  @ApiCreatedResponse()
  async createException(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ) {
    const parsed = employeeAvailabilityExceptionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.createAvailabilityException(
      this.principal(request),
      { ...parsed.data, employeeId: parseId(employeeId) } as EmployeeAvailabilityExceptionInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Delete('exceptions/:exceptionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a date-specific availability exception' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiParam({ name: 'exceptionId', format: 'uuid' })
  @ApiQuery({ name: 'expectedVersion', required: true, type: Number })
  @ApiNoContentResponse()
  async deleteException(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Param('exceptionId') exceptionId: string,
    @Query('expectedVersion') expectedVersion: string,
  ) {
    const version = Number(expectedVersion);
    if (!Number.isSafeInteger(version) || version < 1) throw new BadRequestException();
    await this.scheduling.deleteAvailabilityException(
      this.principal(request),
      parseId(employeeId),
      parseId(exceptionId),
      version,
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('scheduling operations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/scheduling')
export class SchedulingOperationsController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get('worklist')
  @ApiOperation({ summary: 'List visits requiring scheduling action with structured conflicts' })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'teamId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'serviceDefinitionId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'search', required: false, type: String, maxLength: 100 })
  @ApiQuery({ name: 'origin', required: false, enum: ['agreement_generated', 'manual'] })
  @ApiQuery({ name: 'status', required: false, enum: ['planned', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'unassigned', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['plannedStart', 'clientName', 'createdAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: SchedulingWorklistResponseDto })
  async worklist(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    return this.report(request, query);
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'List blocking scheduling conflicts and advisory warnings' })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'teamId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'search', required: false, type: String, maxLength: 100 })
  @ApiQuery({ name: 'status', required: false, enum: ['planned', 'confirmed', 'cancelled'] })
  @ApiQuery({ name: 'unassigned', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: SchedulingWorklistResponseDto })
  async conflicts(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    return this.report(request, query);
  }

  private async report(request: ApiRequest, query: Record<string, string | undefined>) {
    const parsed = visitQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.scheduling.getWorklist(
      this.principal(request),
      withoutUndefined(parsed.data) as VisitSearchQuery,
    );
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, visit: visitResponse(item.visit) })),
    };
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('scheduling tours')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/scheduling/tours')
export class SchedulingToursController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List one employee daily tours in a bounded date range' })
  @ApiQuery({ name: 'employeeId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'from', required: true, format: 'date' })
  @ApiQuery({ name: 'until', required: true, format: 'date', description: 'Exclusive end date' })
  @ApiOkResponse({ type: [TourListItemResponseDto] })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = tourListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.listTours(
      this.principal(request),
      parsed.data.employeeId,
      parsed.data.from,
      parsed.data.until,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a draft employee tour from existing assigned visits' })
  @ApiBody({ type: CreateTourDto })
  @ApiCreatedResponse({ type: TourResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createTourSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.createTour(
      this.principal(request),
      parsed.data as CreateTourInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a daily tour, stops, route estimates, and latest publication' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TourResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.scheduling.getTour(this.principal(request), parseId(id));
  }

  @Put(':id/stops')
  @ApiOperation({ summary: 'Replace a draft stop order while preserving visit identity' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateTourStopsDto })
  @ApiOkResponse({ type: TourResponseDto })
  async updateStops(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateTourStopsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.updateTourStops(
      this.principal(request),
      parseId(id),
      parsed.data as UpdateTourStopsInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post(':id/suggest-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suggest a route-aware order without changing the tour' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RouteOrderSuggestionResponseDto })
  async suggestOrder(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.scheduling.suggestTourOrder(this.principal(request), parseId(id));
  }

  @Post(':id/estimate-travel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estimate route legs using the configured routing provider' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
      required: ['expectedVersion'],
    },
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  async estimateTravel(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = tourVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.estimateTourRoute(
      this.principal(request),
      parseId(id),
      parsed.data.expectedVersion,
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a versioned tour after feasibility checks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
      required: ['expectedVersion'],
    },
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  async publish(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = tourVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.publishTour(
      this.principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('caregiver schedule')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/me/today')
export class MyTodayTourController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get('tour')
  @ApiOperation({ summary: 'Read the current user’s own latest published tour for today' })
  @ApiOkResponse({ type: MyTodayTourResponseDto, nullable: true })
  async getTour(@Req() request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return this.scheduling.getMyTodayTour(request.principal);
  }
}

@ApiTags('scheduling substitutions')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/substitutions')
export class SubstitutionsController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a proposed substitute and transactionally reassign the visit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object' } })
  async confirm(@Req() request: ApiRequest, @Param('id') id: string) {
    if (!request.principal) throw new BadRequestException();
    return this.scheduling.confirmSubstitution(
      request.principal,
      parseId(id),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a proposed substitute and preserve its history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object' } })
  async cancel(@Req() request: ApiRequest, @Param('id') id: string) {
    if (!request.principal) throw new BadRequestException();
    return this.scheduling.cancelSubstitution(
      request.principal,
      parseId(id),
      requestContext(request),
      auditContext(request),
    );
  }
}

@ApiTags('scheduling preferences')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/employees/:employeeId/scheduling-preferences')
export class EmployeeSchedulingPreferencesController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeSchedulingPreferencesDto, nullable: true })
  async get(@Req() request: ApiRequest, @Param('employeeId') employeeId: string) {
    if (!request.principal) throw new BadRequestException();
    return this.scheduling.getEmployeeSchedulingPreferences(request.principal, parseId(employeeId));
  }

  @Put()
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiBody({ type: EmployeeSchedulingPreferencesDto })
  @ApiOkResponse({ type: EmployeeSchedulingPreferencesDto })
  async save(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ) {
    const parsed = employeeSchedulingPreferencesSchema.safeParse(body);
    if (!parsed.success || !request.principal) throw new BadRequestException();
    return this.scheduling.saveEmployeeSchedulingPreferences(
      request.principal,
      {
        ...parsed.data,
        employeeId: parseId(employeeId),
      },
      requestContext(request),
      auditContext(request),
    );
  }
}

@ApiTags('scheduling preferences')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/clients/:clientId/scheduling-preferences')
export class ClientSchedulingPreferencesController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ClientSchedulingPreferencesDto, nullable: true })
  async get(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    if (!request.principal) throw new BadRequestException();
    return this.scheduling.getClientSchedulingPreferences(request.principal, parseId(clientId));
  }

  @Put()
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: ClientSchedulingPreferencesDto })
  @ApiOkResponse({ type: ClientSchedulingPreferencesDto })
  async save(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = clientSchedulingPreferencesSchema.safeParse(body);
    if (!parsed.success || !request.principal) throw new BadRequestException();
    return this.scheduling.saveClientSchedulingPreferences(
      request.principal,
      {
        ...parsed.data,
        clientId: parseId(clientId),
      },
      requestContext(request),
      auditContext(request),
    );
  }
}

@ApiTags('scheduling routing locations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/clients/:clientId/routing-location')
export class ClientRoutingLocationController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: RoutingLocationDto, nullable: true })
  async get(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    if (!request.principal) throw new BadRequestException();
    return this.scheduling.getClientRoutingLocation(request.principal, parseId(clientId));
  }

  @Put()
  @ApiOperation({
    summary: 'Set normalized coordinates for routing without sharing client identity',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: RoutingLocationDto })
  @ApiOkResponse({ type: RoutingLocationDto })
  async save(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = routingLocationSchema.safeParse(body);
    if (!parsed.success || !request.principal) throw new BadRequestException();
    return this.scheduling.setClientRoutingLocation(
      request.principal,
      parseId(clientId),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
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
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}
