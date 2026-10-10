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
import {
  ClientApplicationService,
  type ClientSearchQuery,
  type CreateClientInput,
} from '@care/clients';
import { CLIENT_APPLICATION } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import {
  ClientListResponseDto,
  ClientResponseDto,
  CreateClientDto,
  ProviderContextDto,
  UpdateClientDto,
  createClientSchema,
  providerContextSchema,
  updateClientSchema,
} from './clients.dto';
import { clientListItemResponse, clientResponse } from './clients.mapper';
import { withoutUndefined } from './validation';

const searchSchema = z
  .object({
    q: z.string().max(120).optional(),
    status: z.enum(['pending', 'active', 'archived']).optional(),
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    pflegegrad: z.coerce.number().int().min(1).max(5).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['lastName', 'firstName', 'createdAt', 'dateOfBirth']).default('lastName'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

@ApiTags('clients')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/clients')
export class ClientsController {
  constructor(@Inject(CLIENT_APPLICATION) private readonly clients: ClientApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'Search clients in the selected tenant and granted provider scopes' })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'active', 'archived'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'pflegegrad', required: false, type: Number, minimum: 1, maximum: 5 })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['lastName', 'firstName', 'createdAt', 'dateOfBirth'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: ClientListResponseDto })
  async list(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<ClientListResponseDto> {
    const parsed = searchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { q, ...filters } = parsed.data;
    const result = await this.clients.search(
      this.principal(request),
      withoutUndefined({
        ...(q === undefined ? {} : { text: q }),
        ...filters,
      }) satisfies ClientSearchQuery,
    );
    return {
      items: result.items.map(clientListItemResponse),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string): Promise<ClientResponseDto> {
    return clientResponse(await this.clients.get(this.principal(request), parseId(id)));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a pending client with provider context' })
  @ApiBody({ type: CreateClientDto })
  @ApiCreatedResponse({ type: ClientResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown): Promise<ClientResponseDto> {
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const { primaryAddress, ...personalAndProviderData } = withoutUndefined(parsed.data);
    const input: CreateClientInput = {
      ...personalAndProviderData,
      ...(primaryAddress
        ? { primaryAddress: withoutUndefined({ ...primaryAddress, isPrimary: true }) }
        : {}),
    };
    return clientResponse(
      await this.clients.create(
        this.principal(request),
        input,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client personal data' })
  @ApiBody({ type: UpdateClientDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async update(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ClientResponseDto> {
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientResponse(
      await this.clients.update(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put(':id/provider-context')
  @ApiOperation({ summary: 'Assign or change a client provider organization and primary facility' })
  @ApiBody({ type: ProviderContextDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async changeProviderContext(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ClientResponseDto> {
    const parsed = providerContextSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientResponse(
      await this.clients.changeProviderContext(
        this.principal(request),
        parseId(id),
        parsed.data,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a pending client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async activate(@Req() request: ApiRequest, @Param('id') id: string): Promise<ClientResponseDto> {
    return clientResponse(
      await this.clients.activate(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an active client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async archive(@Req() request: ApiRequest, @Param('id') id: string): Promise<ClientResponseDto> {
    return clientResponse(
      await this.clients.archive(
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
