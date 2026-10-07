import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  VisitExecutionApplicationService,
  type RecordPerformedServiceInput,
} from '@care/visit-execution';
import { VISIT_EXECUTION_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  CaregiverVisitResponseDto,
  CompleteExecutionRequestDto,
  CorrectExecutionTimesRequestDto,
  CorrectExecutionTimesResponseDto,
  ExecutionNoteResponseDto,
  RecordPerformedServiceRequestDto,
  RecordedServiceResponseDto,
  VisitExecutionDetailResponseDto,
  UpdateExecutionNoteRequestDto,
  AvailableServiceResponseDto,
  completeExecutionSchema,
  correctExecutionTimesSchema,
  executionSummariesQuerySchema,
  myVisitsQuerySchema,
  recordPerformedServiceSchema,
  updateExecutionNoteSchema,
  VisitExecutionSummaryResponseDto,
} from './visit-execution.dto';

@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@ApiTags('visit execution')
@Controller('api/v1/visits/:visitId/execution')
export class VisitExecutionController {
  constructor(
    @Inject(VISIT_EXECUTION_APPLICATION)
    private readonly execution: VisitExecutionApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read visit execution and planned service decisions' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: VisitExecutionDetailResponseDto })
  get(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.execution.get(this.principal(request), parseId(visitId));
  }

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an assigned visit using server time' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: VisitExecutionDetailResponseDto })
  start(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.execution.start(
      this.principal(request),
      parseId(visitId),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('available-services')
  @ApiOperation({ summary: 'List services available for an unplanned execution record' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: [AvailableServiceResponseDto] })
  availableServices(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.execution.availableServices(this.principal(request), parseId(visitId));
  }

  @Put('services/:performedServiceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record or update one planned or unplanned service result' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiParam({ name: 'performedServiceId', format: 'uuid' })
  @ApiBody({ type: RecordPerformedServiceRequestDto })
  @ApiOkResponse({ type: RecordedServiceResponseDto })
  async recordService(
    @Req() request: ApiRequest,
    @Param('visitId') visitId: string,
    @Param('performedServiceId') performedServiceId: string,
    @Body() body: unknown,
  ) {
    const parsed = recordPerformedServiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.execution.recordService(
      this.principal(request),
      parseId(visitId),
      parseId(performedServiceId),
      parsed.data as RecordPerformedServiceInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Put('note')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the short operational execution note' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiBody({ type: UpdateExecutionNoteRequestDto })
  @ApiOkResponse({ type: ExecutionNoteResponseDto })
  async updateNote(
    @Req() request: ApiRequest,
    @Param('visitId') visitId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateExecutionNoteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.execution.updateNote(
      this.principal(request),
      parseId(visitId),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a visit after every planned service has a result' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiBody({ type: CompleteExecutionRequestDto })
  @ApiOkResponse({ type: VisitExecutionDetailResponseDto })
  async complete(
    @Req() request: ApiRequest,
    @Param('visitId') visitId: string,
    @Body() body: unknown,
  ) {
    const parsed = completeExecutionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.execution.complete(
      this.principal(request),
      parseId(visitId),
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

@ApiTags('caregiver')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/me/visits')
export class MyVisitsController {
  constructor(
    @Inject(VISIT_EXECUTION_APPLICATION)
    private readonly execution: VisitExecutionApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List visits actively assigned to the current employee' })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiOkResponse({ type: [CaregiverVisitResponseDto] })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = myVisitsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.execution.myVisits(this.principal(request), parsed.data.from, parsed.data.until);
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('visit execution')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/visit-executions')
export class VisitExecutionSummariesController {
  constructor(
    @Inject(VISIT_EXECUTION_APPLICATION)
    private readonly execution: VisitExecutionApplicationService,
  ) {}

  @Get('summaries')
  @ApiOperation({ summary: 'Read authorized execution status and actual times for visits' })
  @ApiQuery({
    name: 'visitIds',
    required: true,
    type: String,
    description: 'Comma-separated visit IDs; maximum 100',
  })
  @ApiOkResponse({ type: [VisitExecutionSummaryResponseDto] })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = executionSummariesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.execution.summaries(this.principal(request), parsed.data.visitIds);
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('visit execution')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/visit-executions')
export class VisitExecutionCorrectionsController {
  constructor(
    @Inject(VISIT_EXECUTION_APPLICATION)
    private readonly execution: VisitExecutionApplicationService,
  ) {}

  @Post(':id/correct-times')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Correct actual arrival or departure with a reason' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CorrectExecutionTimesRequestDto })
  @ApiOkResponse({ type: CorrectExecutionTimesResponseDto })
  async correctTimes(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = correctExecutionTimesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.execution.correctTimes(
      this.principal(request),
      parseId(id),
      {
        expectedVersion: parsed.data.expectedVersion,
        ...(parsed.data.actualStart ? { actualStart: parsed.data.actualStart } : {}),
        ...(parsed.data.actualEnd ? { actualEnd: parsed.data.actualEnd } : {}),
        reason: parsed.data.reason,
      },
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function parseId(value: string): string {
  if (!zUuid(value)) throw new BadRequestException();
  return value;
}

function zUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function auditContext(request: ApiRequest) {
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(request.headers['user-agent'] ? { userAgent: String(request.headers['user-agent']) } : {}),
  };
}
