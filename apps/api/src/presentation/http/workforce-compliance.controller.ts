import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
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
import { can } from '@care/permissions';
import { COMPETENCY_OPERATIONS } from '@care/permissions';
import {
  InvalidWorkforceComplianceQueryError,
  InvalidWorkforceComplianceSettingsError,
  WorkforceComplianceApplicationService,
} from '@care/workforce-compliance';
import type {
  WorkforceComplianceImpactQuery,
  WorkforceComplianceReadQuery,
  WorkforceComplianceSettingsUpdate,
} from '@care/workforce-compliance';
import { z } from 'zod';
import { WORKFORCE_COMPLIANCE_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  workforceComplianceEmployeeQuerySchema,
  workforceComplianceImpactQuerySchema,
  workforceComplianceQualificationQuerySchema,
  workforceComplianceReadQuerySchema,
  workforceComplianceSettingsUpdateSchema,
  WorkforceComplianceEmployeeDetailDto,
  WorkforceComplianceEmployeePageDto,
  WorkforceCompliancePolicyDetailDto,
  WorkforceComplianceQualificationImpactPageDto,
  WorkforceComplianceQualificationPageDto,
  WorkforceComplianceSettingsDto,
  WorkforceComplianceSettingsReadDto,
  WorkforceComplianceSettingsUpdateDto,
  WorkforceComplianceSummaryDto,
} from './workforce-compliance.dto';

const operationSchema = z.enum(COMPETENCY_OPERATIONS);

@ApiTags('workforce compliance')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, schema: { type: 'string', format: 'uuid' } })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/workforce-compliance')
export class WorkforceComplianceController {
  constructor(
    @Inject(WORKFORCE_COMPLIANCE_APPLICATION)
    private readonly compliance: WorkforceComplianceApplicationService,
  ) {}

  @Get('summary')
  @ApiOperation({
    operationId: 'getWorkforceComplianceSummary',
    summary: 'Get scoped workforce qualification readiness and findings',
  })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'horizonDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiOkResponse({ type: WorkforceComplianceSummaryDto })
  async summary(
    @Req() request: ApiRequest,
    @Query() query: unknown,
  ): Promise<WorkforceComplianceSummaryDto> {
    const parsed = workforceComplianceReadQuerySchema.safeParse(query);
    if (!parsed.success) throw new InvalidWorkforceComplianceQueryError();
    return this.compliance.summary(this.principal(request), readQuery(parsed.data));
  }

  @Get('qualifications')
  @ApiOperation({
    operationId: 'listWorkforceComplianceQualifications',
    summary: 'List scoped employee qualification validity facts',
  })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['valid', 'expiring_soon', 'expired', 'not_yet_valid', 'revoked'],
  })
  @ApiQuery({ name: 'assignmentStatus', required: false, enum: ['active', 'revoked'] })
  @ApiQuery({ name: 'qualificationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'teamId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'expiresBefore', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'expiresWithinDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'horizonDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['priority', 'qualificationName', 'employeeName', 'validUntil', 'status'],
    default: 'priority',
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: WorkforceComplianceQualificationPageDto })
  async qualifications(
    @Req() request: ApiRequest,
    @Query() query: unknown,
  ): Promise<WorkforceComplianceQualificationPageDto> {
    const parsed = workforceComplianceQualificationQuerySchema.safeParse(query);
    if (!parsed.success) throw new InvalidWorkforceComplianceQueryError();
    const result = await this.compliance.qualifications(this.principal(request), {
      ...(parsed.data.asOf === undefined ? {} : { asOf: parsed.data.asOf }),
      ...(parsed.data.horizonDays === undefined ? {} : { horizonDays: parsed.data.horizonDays }),
      ...(parsed.data.page === undefined ? {} : { page: parsed.data.page }),
      ...(parsed.data.pageSize === undefined ? {} : { pageSize: parsed.data.pageSize }),
      ...(parsed.data.q === undefined ? {} : { text: parsed.data.q }),
      ...(parsed.data.qualificationId === undefined
        ? {}
        : { qualificationId: parsed.data.qualificationId }),
      ...(parsed.data.employeeId === undefined ? {} : { employeeId: parsed.data.employeeId }),
      ...(parsed.data.organizationId === undefined
        ? {}
        : { organizationId: parsed.data.organizationId }),
      ...(parsed.data.facilityId === undefined ? {} : { facilityId: parsed.data.facilityId }),
      ...(parsed.data.teamId === undefined ? {} : { teamId: parsed.data.teamId }),
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.assignmentStatus === undefined
        ? {}
        : { assignmentStatus: parsed.data.assignmentStatus }),
      ...(parsed.data.expiresBefore === undefined
        ? {}
        : { expiresBefore: parsed.data.expiresBefore }),
      ...(parsed.data.expiresWithinDays === undefined
        ? {}
        : { expiresWithinDays: parsed.data.expiresWithinDays }),
      ...(parsed.data.sortBy === undefined ? {} : { sortBy: parsed.data.sortBy }),
      ...(parsed.data.sortOrder === undefined ? {} : { sortOrder: parsed.data.sortOrder }),
    });
    return { ...result, items: result.items.map(qualificationResponse) };
  }

  @Get('qualifications/:qualificationDefinitionId/impact')
  @ApiOperation({
    operationId: 'getWorkforceQualificationImpact',
    summary: 'Preview how a qualification affects scoped employee readiness',
  })
  @ApiParam({ name: 'qualificationDefinitionId', format: 'uuid' })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'horizonDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'operationKey', required: false, enum: COMPETENCY_OPERATIONS })
  @ApiOkResponse({ type: WorkforceComplianceQualificationImpactPageDto })
  async qualificationImpact(
    @Req() request: ApiRequest,
    @Param('qualificationDefinitionId') qualificationDefinitionId: string,
    @Query() query: unknown,
  ): Promise<WorkforceComplianceQualificationImpactPageDto> {
    const id = z.string().uuid().safeParse(qualificationDefinitionId);
    const parsed = workforceComplianceImpactQuerySchema.safeParse(query);
    if (!id.success || !parsed.success) throw new InvalidWorkforceComplianceQueryError();
    return this.compliance.qualificationImpact(
      this.principal(request),
      id.data,
      impactQuery(parsed.data),
    );
  }

  @Get('employees')
  @ApiOperation({
    operationId: 'listWorkforceComplianceEmployees',
    summary: 'List scoped employees with workforce readiness',
  })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'archived'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'teamId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'horizonDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['lastName', 'firstName'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: WorkforceComplianceEmployeePageDto })
  async employees(
    @Req() request: ApiRequest,
    @Query() query: unknown,
  ): Promise<WorkforceComplianceEmployeePageDto> {
    const parsed = workforceComplianceEmployeeQuerySchema.safeParse(query);
    if (!parsed.success) throw new InvalidWorkforceComplianceQueryError();
    const result = await this.compliance.employees(this.principal(request), {
      ...(parsed.data.asOf === undefined ? {} : { asOf: parsed.data.asOf }),
      ...(parsed.data.horizonDays === undefined ? {} : { horizonDays: parsed.data.horizonDays }),
      ...(parsed.data.page === undefined ? {} : { page: parsed.data.page }),
      ...(parsed.data.pageSize === undefined ? {} : { pageSize: parsed.data.pageSize }),
      ...(parsed.data.q === undefined ? {} : { text: parsed.data.q }),
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.organizationId === undefined
        ? {}
        : { organizationId: parsed.data.organizationId }),
      ...(parsed.data.facilityId === undefined ? {} : { facilityId: parsed.data.facilityId }),
      ...(parsed.data.teamId === undefined ? {} : { teamId: parsed.data.teamId }),
      ...(parsed.data.sortBy === undefined ? {} : { sortBy: parsed.data.sortBy }),
      ...(parsed.data.sortOrder === undefined ? {} : { sortOrder: parsed.data.sortOrder }),
    });
    return result;
  }

  @Get('employees/:employeeId')
  @ApiOperation({
    operationId: 'getWorkforceComplianceEmployee',
    summary: 'Get scoped employee readiness, findings, and qualification history',
  })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'horizonDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiOkResponse({ type: WorkforceComplianceEmployeeDetailDto })
  async employee(
    @Req() request: ApiRequest,
    @Param('employeeId') employeeId: string,
    @Query() query: unknown,
  ): Promise<WorkforceComplianceEmployeeDetailDto> {
    const id = z.string().uuid().safeParse(employeeId);
    const parsed = workforceComplianceReadQuerySchema.safeParse(query);
    if (!id.success || !parsed.success) throw new InvalidWorkforceComplianceQueryError();
    const result = await this.compliance.employee(
      this.principal(request),
      id.data,
      readQuery(parsed.data),
    );
    return {
      ...result,
      operations: result.operations.map((operation) => ({
        ...operation,
        findings: operation.findings.map(({ employeeId: _employeeId, ...finding }) => finding),
      })),
      qualifications: result.qualifications.map(qualificationResponse),
      historyLimitations: [...result.historyLimitations],
    };
  }

  @Get('policies/:operationKey')
  @ApiOperation({
    operationId: 'getWorkforceCompliancePolicy',
    summary: 'Get an operation policy and scoped readiness impact',
  })
  @ApiParam({ name: 'operationKey', enum: COMPETENCY_OPERATIONS })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'horizonDays', required: false, type: Number, minimum: 1, maximum: 365 })
  @ApiOkResponse({ type: WorkforceCompliancePolicyDetailDto })
  async policy(
    @Req() request: ApiRequest,
    @Param('operationKey') operationKey: string,
    @Query() query: unknown,
  ): Promise<WorkforceCompliancePolicyDetailDto> {
    const operation = operationSchema.safeParse(operationKey);
    const parsed = workforceComplianceReadQuerySchema.safeParse(query);
    if (!operation.success || !parsed.success) throw new InvalidWorkforceComplianceQueryError();
    return this.compliance.policy(this.principal(request), operation.data, readQuery(parsed.data));
  }

  @Get('settings')
  @ApiOperation({
    operationId: 'getWorkforceComplianceSettings',
    summary: 'Get workforce compliance monitoring settings',
  })
  @ApiOkResponse({ type: WorkforceComplianceSettingsReadDto })
  async settings(@Req() request: ApiRequest): Promise<WorkforceComplianceSettingsReadDto> {
    const principal = this.principal(request);
    const settings = await this.compliance.getSettings(principal);
    return {
      ...settings,
      canManage: can(principal, {
        action: 'workforce_compliance.manage_settings',
        resource: { tenantId: principal.tenantId },
      }),
    };
  }

  @Put('settings')
  @ApiOperation({
    operationId: 'updateWorkforceComplianceSettings',
    summary: 'Update workforce compliance monitoring settings',
  })
  @ApiBody({ type: WorkforceComplianceSettingsUpdateDto })
  @ApiOkResponse({ type: WorkforceComplianceSettingsDto })
  async updateSettings(
    @Req() request: ApiRequest,
    @Body() body: unknown,
  ): Promise<WorkforceComplianceSettingsDto> {
    const input = workforceComplianceSettingsUpdateSchema.safeParse(body);
    if (!input.success) throw new InvalidWorkforceComplianceSettingsError();
    return this.compliance.updateSettings(
      this.principal(request),
      settingsUpdate(input.data),
      requestContext(request),
      requestMetadata(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function qualificationResponse<T extends { createdAt: Date; revokedAt: Date | null }>(
  qualification: T,
): Omit<T, 'createdAt' | 'revokedAt'> & { createdAt: string; revokedAt: string | null } {
  return {
    ...qualification,
    createdAt: qualification.createdAt.toISOString(),
    revokedAt: qualification.revokedAt?.toISOString() ?? null,
  };
}

function requestMetadata(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}

function readQuery(
  query: z.infer<typeof workforceComplianceReadQuerySchema>,
): WorkforceComplianceReadQuery {
  return {
    ...(query.asOf === undefined ? {} : { asOf: query.asOf }),
    ...(query.horizonDays === undefined ? {} : { horizonDays: query.horizonDays }),
  };
}

function impactQuery(
  query: z.infer<typeof workforceComplianceImpactQuerySchema>,
): WorkforceComplianceImpactQuery {
  return {
    ...readQuery(query),
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
    ...(query.operationKey === undefined ? {} : { operationKey: query.operationKey }),
  };
}

function settingsUpdate(
  input: z.infer<typeof workforceComplianceSettingsUpdateSchema>,
): WorkforceComplianceSettingsUpdate {
  return {
    expectedVersion: input.expectedVersion,
    ...(input.criticalDays === undefined ? {} : { criticalDays: input.criticalDays }),
    ...(input.warningDays === undefined ? {} : { warningDays: input.warningDays }),
    ...(input.reportingTimezone === undefined
      ? {}
      : { reportingTimezone: input.reportingTimezone }),
  };
}
