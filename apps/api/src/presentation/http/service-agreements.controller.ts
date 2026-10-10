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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  InvalidScheduleRuleError,
  type ServiceAgreementApplicationService,
} from '@care/service-agreements';
import { SERVICE_AGREEMENT_APPLICATION } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import {
  AgreementServiceInputDto,
  AgreementServiceResponseDto,
  CreateServiceAgreementDto,
  ServiceAgreementListResponseDto,
  ServiceAgreementResponseDto,
  UpdateAgreementServiceDto,
  UpdateServiceAgreementDto,
  createAgreementServiceSchema,
  createServiceAgreementSchema,
  serviceAgreementClientQuerySchema,
  serviceAgreementQuerySchema,
  updateAgreementServiceSchema,
  updateServiceAgreementSchema,
} from './service-agreements.dto';
import {
  agreementServiceResponse,
  serviceAgreementListResponse,
  serviceAgreementResponse,
} from './service-agreements.mapper';
import { withoutUndefined } from './validation';

@ApiTags('service agreements')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/clients/:clientId/service-agreements')
export class ClientServiceAgreementsController {
  constructor(
    @Inject(SERVICE_AGREEMENT_APPLICATION)
    private readonly agreements: ServiceAgreementApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List service agreements for a client' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'active', 'suspended', 'ended'] })
  @ApiQuery({ name: 'validAt', required: false, format: 'date' })
  @ApiQuery({ name: 'serviceDefinitionId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['validFrom', 'createdAt', 'status'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: ServiceAgreementListResponseDto })
  async listForClient(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = serviceAgreementClientQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return serviceAgreementListResponse(
      await this.agreements.listForClient(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
      ),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a draft service agreement for a client' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: CreateServiceAgreementDto })
  @ApiCreatedResponse({ type: ServiceAgreementResponseDto })
  async create(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = createServiceAgreementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return serviceAgreementResponse(
      await this.agreements.create(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

@ApiTags('service agreements')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/service-agreements')
export class ServiceAgreementsController {
  constructor(
    @Inject(SERVICE_AGREEMENT_APPLICATION)
    private readonly agreements: ServiceAgreementApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search service agreements in the selected provider scope' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'active', 'suspended', 'ended'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'validAt', required: false, format: 'date' })
  @ApiQuery({ name: 'serviceDefinitionId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['validFrom', 'createdAt', 'status'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: ServiceAgreementListResponseDto })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = serviceAgreementQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return serviceAgreementListResponse(
      await this.agreements.search(this.principal(request), withoutUndefined(parsed.data)),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceAgreementResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceAgreementResponse(
      await this.agreements.get(this.principal(request), parseId(id)),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update service agreement details' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateServiceAgreementDto })
  @ApiOkResponse({ type: ServiceAgreementResponseDto })
  async update(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateServiceAgreementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return serviceAgreementResponse(
      await this.agreements.update(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a draft service agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceAgreementResponseDto })
  async activate(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceAgreementResponse(
      await this.agreements.activate(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an active service agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceAgreementResponseDto })
  async suspend(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceAgreementResponse(
      await this.agreements.suspend(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a suspended service agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceAgreementResponseDto })
  async resume(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceAgreementResponse(
      await this.agreements.resume(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End a service agreement permanently' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceAgreementResponseDto })
  async end(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceAgreementResponse(
      await this.agreements.end(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get(':id/services')
  @ApiOperation({ summary: 'List services on a service agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [AgreementServiceResponseDto] })
  async listServices(@Req() request: ApiRequest, @Param('id') id: string) {
    return (await this.agreements.listServices(this.principal(request), parseId(id))).map(
      agreementServiceResponse,
    );
  }

  @Post(':id/services')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a service to an agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AgreementServiceInputDto })
  @ApiCreatedResponse({ type: AgreementServiceResponseDto })
  async addService(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = parseScheduleBody(createAgreementServiceSchema, body);
    return agreementServiceResponse(
      await this.agreements.addService(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch(':id/services/:serviceId')
  @ApiOperation({ summary: 'Update a service agreement line' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiBody({ type: UpdateAgreementServiceDto })
  @ApiOkResponse({ type: AgreementServiceResponseDto })
  async updateService(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ) {
    const parsed = parseScheduleBody(updateAgreementServiceSchema, body);
    return agreementServiceResponse(
      await this.agreements.updateService(
        this.principal(request),
        parseId(id),
        parseId(serviceId),
        withoutUndefined(parsed),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/services/:serviceId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End a service line and retain its history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: AgreementServiceResponseDto })
  async endService(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
  ) {
    return agreementServiceResponse(
      await this.agreements.endService(
        this.principal(request),
        parseId(id),
        parseId(serviceId),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function parseScheduleBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path.includes('scheduleRule'))) {
      throw new InvalidScheduleRuleError();
    }
    throw new BadRequestException();
  }
  return parsed.data;
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
