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
  ClientApplicationService,
  type ClientPersonalData,
  type ClientSnapshot,
} from '@care/clients';
import { CLIENT_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import {
  ClientListResponseDto,
  ClientResponseDto,
  CreateClientDto,
  UpdateClientDto,
  ProblemDetailsDto,
  createClientSchema,
  updateClientSchema,
} from './dto';

@ApiTags('clients')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/clients')
export class ClientsController {
  constructor(@Inject(CLIENT_APPLICATION) private readonly clients: ClientApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'Search clients in the selected tenant' })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: ClientListResponseDto })
  async list(
    @Req() request: ApiRequest,
    @Query('q') query?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ClientListResponseDto> {
    const pagination = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .safeParse({ page, pageSize });
    if (!pagination.success) throw new BadRequestException();
    const result = await this.clients.search(this.principal(request), {
      ...(query === undefined ? {} : { text: query }),
      ...pagination.data,
    });
    return {
      items: result.items.map(toResponse),
      page: pagination.data.page,
      pageSize: pagination.data.pageSize,
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string): Promise<ClientResponseDto> {
    return toResponse(await this.clients.get(this.principal(request), parseId(id)));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a pending client' })
  @ApiBody({ type: CreateClientDto })
  @ApiCreatedResponse({ type: ClientResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown): Promise<ClientResponseDto> {
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const client = await this.clients.create(
      this.principal(request),
      toPersonalData(parsed.data),
      requestContext(request),
      auditContext(request),
    );
    return toResponse(client);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client personal and contact data' })
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
    const client = await this.clients.update(
      this.principal(request),
      parseId(id),
      toPartialPersonalData(parsed.data),
      requestContext(request),
      auditContext(request),
    );
    return toResponse(client);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a pending client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientResponseDto })
  async activate(@Req() request: ApiRequest, @Param('id') id: string): Promise<ClientResponseDto> {
    return toResponse(
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
    return toResponse(
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

function toPersonalData(value: z.infer<typeof createClientSchema>): ClientPersonalData {
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    ...(value.preferredName === undefined ? {} : { preferredName: value.preferredName }),
    ...(value.dateOfBirth === undefined ? {} : { dateOfBirth: value.dateOfBirth }),
    ...(value.email === undefined ? {} : { email: value.email }),
    ...(value.phone === undefined ? {} : { phone: value.phone }),
  };
}

function toPartialPersonalData(
  value: z.infer<typeof updateClientSchema>,
): Partial<ClientPersonalData> {
  return {
    ...(value.firstName === undefined ? {} : { firstName: value.firstName }),
    ...(value.lastName === undefined ? {} : { lastName: value.lastName }),
    ...(value.preferredName === undefined ? {} : { preferredName: value.preferredName }),
    ...(value.dateOfBirth === undefined ? {} : { dateOfBirth: value.dateOfBirth }),
    ...(value.email === undefined ? {} : { email: value.email }),
    ...(value.phone === undefined ? {} : { phone: value.phone }),
  };
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}

function toResponse(client: ClientSnapshot): ClientResponseDto {
  return {
    id: client.id,
    tenantId: client.tenantId,
    firstName: client.firstName,
    lastName: client.lastName,
    preferredName: client.preferredName ?? null,
    dateOfBirth: client.dateOfBirth ?? null,
    email: client.email ?? null,
    phone: client.phone ?? null,
    status: client.status,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}
