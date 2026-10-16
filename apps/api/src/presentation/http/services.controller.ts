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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { SERVICE_APPLICATION } from '@app/api/tokens';
import { ServiceApplicationService } from '@care/services';

import { ProblemDetailsDto } from './dto';
import {
  ReplaceServiceAvailabilityDto,
  ServiceAvailabilityResponseDto,
  ServiceCategoryInputDto,
  ServiceCategoryPatchDto,
  ServiceCategoryResponseDto,
  ServiceInputDto,
  ServiceListResponseDto,
  ServicePatchDto,
  ServiceResponseDto,
  createServiceCategorySchema,
  createServiceSchema,
  replaceAvailabilitySchema,
  updateServiceCategorySchema,
  updateServiceSchema,
} from './services.dto';
import {
  serviceAvailabilityResponse,
  serviceCategoryResponse,
  serviceListItemResponse,
  serviceResponse,
} from './services.mapper';
import { withoutUndefined } from './validation';

const categoryListQuery = z
  .object({ includeArchived: z.enum(['true', 'false']).optional() })
  .strict();
const serviceSearchQuery = z
  .object({
    q: z.string().max(120).optional(),
    status: z.enum(['active', 'archived', 'all']).optional(),
    categoryId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    validAt: z.string().optional(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['name', 'category', 'status', 'code']).default('code'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

@ApiTags('service categories')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/service-categories')
export class ServiceCategoriesController {
  constructor(@Inject(SERVICE_APPLICATION) private readonly services: ServiceApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'List service categories' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ type: [ServiceCategoryResponseDto] })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = categoryListQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return (
      await this.services.listCategories(
        this.principal(request),
        parsed.data.includeArchived === 'true',
      )
    ).map(serviceCategoryResponse);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service category' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceCategoryResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceCategoryResponse(
      await this.services.getCategory(this.principal(request), parseId(id)),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a service category' })
  @ApiBody({ type: ServiceCategoryInputDto })
  @ApiCreatedResponse({ type: ServiceCategoryResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createServiceCategorySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return serviceCategoryResponse(
      await this.services.createCategory(
        this.principal(request),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service category' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ServiceCategoryPatchDto })
  @ApiOkResponse({ type: ServiceCategoryResponseDto })
  async update(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateServiceCategorySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return serviceCategoryResponse(
      await this.services.updateCategory(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a service category' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceCategoryResponseDto })
  async archive(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceCategoryResponse(
      await this.services.archiveCategory(
        this.principal(request),
        parseId(id),
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

@ApiTags('services')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/services')
export class ServicesController {
  constructor(@Inject(SERVICE_APPLICATION) private readonly services: ServiceApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'Search available service definitions' })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiQuery({ name: 'categoryId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'validAt', required: false, type: String, format: 'date' })
  @ApiQuery({
    name: 'validFrom',
    required: false,
    type: String,
    format: 'date',
    description: 'Return services available for the complete requested period',
  })
  @ApiQuery({ name: 'validUntil', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'category', 'status', 'code'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: ServiceListResponseDto })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = serviceSearchQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { q, ...filters } = withoutUndefined(parsed.data);
    const result = await this.services.search(this.principal(request), {
      ...(q === undefined ? {} : { text: q }),
      ...filters,
    });
    return {
      items: result.items.map(serviceListItemResponse),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceResponse(await this.services.get(this.principal(request), parseId(id)));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a service definition' })
  @ApiBody({ type: ServiceInputDto })
  @ApiCreatedResponse({ type: ServiceResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createServiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return serviceResponse(
      await this.services.create(
        this.principal(request),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ServicePatchDto })
  @ApiOkResponse({ type: ServiceResponseDto })
  async update(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateServiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return serviceResponse(
      await this.services.update(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a service definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceResponseDto })
  async archive(@Req() request: ApiRequest, @Param('id') id: string) {
    return serviceResponse(
      await this.services.archive(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'List a service definition availability history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [ServiceAvailabilityResponseDto] })
  async availability(@Req() request: ApiRequest, @Param('id') id: string) {
    return (await this.services.getAvailability(this.principal(request), parseId(id))).map(
      serviceAvailabilityResponse,
    );
  }

  @Put(':id/availability')
  @ApiOperation({ summary: 'Replace active service availability assignments' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ReplaceServiceAvailabilityDto })
  @ApiOkResponse({ type: [ServiceAvailabilityResponseDto] })
  async setAvailability(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = replaceAvailabilitySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return (
      await this.services.setAvailability(
        this.principal(request),
        parseId(id),
        parsed.data.items.map((item) => withoutUndefined(item)),
        requestContext(request),
        auditContext(request),
      )
    ).map(serviceAvailabilityResponse);
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function parseId(value: string): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new BadRequestException();
  return result.data;
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
