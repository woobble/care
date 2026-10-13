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
import { OrganizationApplicationService } from '@care/organizations';
import type {
  FacilitySnapshot,
  OrganizationSnapshot,
  StructureStatus,
  TeamSnapshot,
} from '@care/organizations';
import { ORGANIZATION_APPLICATION } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import {
  CreateFacilityDto,
  CreateOrganizationDto,
  CreateTeamDto,
  FacilityResponseDto,
  PaginatedFacilitiesResponseDto,
  PaginatedOrganizationsResponseDto,
  PaginatedTeamsResponseDto,
  OrganizationResponseDto,
  TeamResponseDto,
  UpdateFacilityDto,
  UpdateOrganizationDto,
  UpdateTeamDto,
  createFacilitySchema,
  createOrganizationSchema,
  createTeamSchema,
  structureStatusSchema,
  updateFacilitySchema,
  updateOrganizationSchema,
  updateTeamSchema,
} from './organizations.dto';

const pageFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const organizationIdsQuerySchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.split(',').map((id) => id.trim()) : value),
    z.array(z.string().uuid()).min(1).max(100),
  )
  .optional();
const organizationSearchSchema = pageFilterSchema
  .extend({ ids: organizationIdsQuerySchema })
  .strict();
const facilitySearchSchema = pageFilterSchema
  .extend({ organizationId: z.string().uuid().optional(), ids: organizationIdsQuerySchema })
  .strict();
const teamSearchSchema = pageFilterSchema
  .extend({
    organizationId: z.string().uuid().optional(),
    facilityId: z.string().uuid().optional(),
    ids: organizationIdsQuerySchema,
  })
  .strict();

@ApiTags('organization structure')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, schema: { type: 'string', format: 'uuid' } })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class OrganizationsController {
  constructor(
    @Inject(ORGANIZATION_APPLICATION)
    private readonly organizations: OrganizationApplicationService,
  ) {}

  @Get('organizations')
  @ApiOperation({ summary: 'List visible organizations' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiOkResponse({ type: [OrganizationResponseDto] })
  async listOrganizations(
    @Req() request: ApiRequest,
    @Query('status') status?: string,
  ): Promise<OrganizationResponseDto[]> {
    const parsed = parseStatus(status);
    return (await this.organizations.listOrganizations(this.principal(request), parsed)).map(
      organizationResponse,
    );
  }

  @Get('organizations/search')
  @ApiOperation({ summary: 'Search authorized organizations with database pagination' })
  @ApiQuery({ name: 'q', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, maximum: 100 })
  @ApiQuery({
    name: 'ids',
    required: false,
    type: String,
    description: 'Comma-separated UUIDs; maximum 100',
  })
  @ApiOkResponse({ type: PaginatedOrganizationsResponseDto })
  async searchOrganizations(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<PaginatedOrganizationsResponseDto> {
    const parsed = organizationSearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.organizations.searchOrganizations(this.principal(request), {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      ...(parsed.data.ids ? { ids: parsed.data.ids } : {}),
      ...(parsed.data.q ? { text: parsed.data.q } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    return { ...result, items: result.items.map(organizationResponse) };
  }

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an organization' })
  @ApiBody({ type: CreateOrganizationDto })
  @ApiCreatedResponse({ type: OrganizationResponseDto })
  async createOrganization(
    @Req() request: ApiRequest,
    @Body() body: unknown,
  ): Promise<OrganizationResponseDto> {
    const parsed = createOrganizationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const organization = await this.organizations.createOrganization(
      this.principal(request),
      {
        name: parsed.data.name,
        legalName: parsed.data.legalName ?? null,
        code: parsed.data.code ?? null,
        address: parsed.data.address ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        ...(parsed.data.timezone === undefined ? {} : { timezone: parsed.data.timezone }),
      },
      requestContext(request),
      auditContext(request),
    );
    return organizationResponse(organization);
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'Get an organization' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  async getOrganization(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<OrganizationResponseDto> {
    return organizationResponse(
      await this.organizations.getOrganization(this.principal(request), parseId(id)),
    );
  }

  @Patch('organizations/:id')
  @ApiOperation({ summary: 'Update organization master data' })
  @ApiBody({ type: UpdateOrganizationDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  async updateOrganization(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OrganizationResponseDto> {
    const parsed = updateOrganizationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return organizationResponse(
      await this.organizations.updateOrganization(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('organizations/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an organization' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  async activateOrganization(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<OrganizationResponseDto> {
    return organizationResponse(
      await this.organizations.activateOrganization(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('organizations/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an organization without deleting it' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  async archiveOrganization(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<OrganizationResponseDto> {
    return organizationResponse(
      await this.organizations.archiveOrganization(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('facilities')
  @ApiOperation({ summary: 'List visible facilities' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'ids',
    required: false,
    type: String,
    description: 'Comma-separated facility IDs (up to 100)',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiOkResponse({ type: [FacilityResponseDto] })
  async listFacilities(
    @Req() request: ApiRequest,
    @Query('organizationId') organizationId?: string,
    @Query('status') status?: string,
  ): Promise<FacilityResponseDto[]> {
    return (
      await this.organizations.listFacilities(this.principal(request), {
        ...(organizationId === undefined ? {} : { organizationId: parseId(organizationId) }),
        ...(status === undefined ? {} : { status: parseStatus(status)! }),
      })
    ).map(facilityResponse);
  }

  @Get('facilities/search')
  @ApiOperation({ summary: 'Search authorized facilities with database pagination' })
  @ApiQuery({ name: 'q', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'ids',
    required: false,
    type: String,
    description: 'Comma-separated facility IDs (up to 100)',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, maximum: 100 })
  @ApiOkResponse({ type: PaginatedFacilitiesResponseDto })
  async searchFacilities(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<PaginatedFacilitiesResponseDto> {
    const parsed = facilitySearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.organizations.searchFacilities(this.principal(request), {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      ...(parsed.data.q ? { text: parsed.data.q } : {}),
      ...(parsed.data.organizationId ? { organizationId: parsed.data.organizationId } : {}),
      ...(parsed.data.ids ? { ids: parsed.data.ids } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    return { ...result, items: result.items.map(facilityResponse) };
  }

  @Post('facilities')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a facility inside an organization' })
  @ApiBody({ type: CreateFacilityDto })
  @ApiCreatedResponse({ type: FacilityResponseDto })
  async createFacility(
    @Req() request: ApiRequest,
    @Body() body: unknown,
  ): Promise<FacilityResponseDto> {
    const parsed = createFacilitySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const facility = await this.organizations.createFacility(
      this.principal(request),
      {
        organizationId: parsed.data.organizationId,
        name: parsed.data.name,
        code: parsed.data.code ?? null,
        address: parsed.data.address ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        ...(parsed.data.timezone === undefined ? {} : { timezone: parsed.data.timezone }),
      },
      requestContext(request),
      auditContext(request),
    );
    return facilityResponse(facility);
  }

  @Get('facilities/:id')
  @ApiOperation({ summary: 'Get a facility' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FacilityResponseDto })
  async getFacility(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<FacilityResponseDto> {
    return facilityResponse(
      await this.organizations.getFacility(this.principal(request), parseId(id)),
    );
  }

  @Patch('facilities/:id')
  @ApiOperation({ summary: 'Update facility master data' })
  @ApiBody({ type: UpdateFacilityDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FacilityResponseDto })
  async updateFacility(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<FacilityResponseDto> {
    const parsed = updateFacilitySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return facilityResponse(
      await this.organizations.updateFacility(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('facilities/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a facility' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FacilityResponseDto })
  async activateFacility(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<FacilityResponseDto> {
    return facilityResponse(
      await this.organizations.activateFacility(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('facilities/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a facility without deleting it' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FacilityResponseDto })
  async archiveFacility(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<FacilityResponseDto> {
    return facilityResponse(
      await this.organizations.archiveFacility(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('teams')
  @ApiOperation({ summary: 'List visible teams' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiOkResponse({ type: [TeamResponseDto] })
  async listTeams(
    @Req() request: ApiRequest,
    @Query('organizationId') organizationId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('status') status?: string,
  ): Promise<TeamResponseDto[]> {
    return (
      await this.organizations.listTeams(this.principal(request), {
        ...(organizationId === undefined ? {} : { organizationId: parseId(organizationId) }),
        ...(facilityId === undefined ? {} : { facilityId: parseId(facilityId) }),
        ...(status === undefined ? {} : { status: parseStatus(status)! }),
      })
    ).map(teamResponse);
  }

  @Get('teams/search')
  @ApiOperation({ summary: 'Search authorized teams with database pagination' })
  @ApiQuery({ name: 'q', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, maximum: 100 })
  @ApiQuery({
    name: 'ids',
    required: false,
    type: String,
    description: 'Comma-separated UUIDs; maximum 100',
  })
  @ApiOkResponse({ type: PaginatedTeamsResponseDto })
  async searchTeams(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<PaginatedTeamsResponseDto> {
    const parsed = teamSearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.organizations.searchTeams(this.principal(request), {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      ...(parsed.data.ids ? { ids: parsed.data.ids } : {}),
      ...(parsed.data.q ? { text: parsed.data.q } : {}),
      ...(parsed.data.organizationId ? { organizationId: parsed.data.organizationId } : {}),
      ...(parsed.data.facilityId ? { facilityId: parsed.data.facilityId } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    return { ...result, items: result.items.map(teamResponse) };
  }

  @Post('teams')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a team' })
  @ApiBody({ type: CreateTeamDto })
  @ApiCreatedResponse({ type: TeamResponseDto })
  async createTeam(@Req() request: ApiRequest, @Body() body: unknown): Promise<TeamResponseDto> {
    const parsed = createTeamSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return teamResponse(
      await this.organizations.createTeam(
        this.principal(request),
        {
          organizationId: parsed.data.organizationId,
          facilityId: parsed.data.facilityId ?? null,
          name: parsed.data.name,
        },
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('teams/:id')
  @ApiOperation({ summary: 'Get a team' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TeamResponseDto })
  async getTeam(@Req() request: ApiRequest, @Param('id') id: string): Promise<TeamResponseDto> {
    return teamResponse(await this.organizations.getTeam(this.principal(request), parseId(id)));
  }

  @Patch('teams/:id')
  @ApiOperation({ summary: 'Update a team' })
  @ApiBody({ type: UpdateTeamDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TeamResponseDto })
  async updateTeam(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TeamResponseDto> {
    const parsed = updateTeamSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return teamResponse(
      await this.organizations.updateTeam(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('teams/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a team' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TeamResponseDto })
  async activateTeam(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<TeamResponseDto> {
    return teamResponse(
      await this.organizations.activateTeam(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('teams/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a team without deleting it' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TeamResponseDto })
  async archiveTeam(@Req() request: ApiRequest, @Param('id') id: string): Promise<TeamResponseDto> {
    return teamResponse(
      await this.organizations.archiveTeam(
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

function withoutUndefined<T extends object>(
  value: T,
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

function parseStatus(value?: string): StructureStatus | undefined {
  if (value === undefined) return undefined;
  const result = structureStatusSchema.safeParse(value);
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

function organizationResponse(organization: OrganizationSnapshot): OrganizationResponseDto {
  return {
    ...organization,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

function facilityResponse(facility: FacilitySnapshot): FacilityResponseDto {
  return {
    ...facility,
    createdAt: facility.createdAt.toISOString(),
    updatedAt: facility.updatedAt.toISOString(),
  };
}

function teamResponse(team: TeamSnapshot): TeamResponseDto {
  return {
    ...team,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}
