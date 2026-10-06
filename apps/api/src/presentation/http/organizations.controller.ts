import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { OrganizationApplicationService } from '@care/organizations';
import type { FacilitySnapshot, OrganizationSnapshot } from '@care/organizations';
import { ORGANIZATION_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import type { ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import { FacilityResponseDto, OrganizationResponseDto } from './tenant-access.dto';

@ApiTags('organizations')
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
  @ApiOperation({ summary: 'List organizations visible in the selected tenant' })
  @ApiOkResponse({ type: [OrganizationResponseDto] })
  async listOrganizations(@Req() request: ApiRequest): Promise<OrganizationResponseDto[]> {
    return (await this.organizations.listOrganizations(this.principal(request))).map(
      organizationResponse,
    );
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

  @Get('facilities')
  @ApiOperation({ summary: 'List facilities visible in the selected tenant' })
  @ApiOkResponse({ type: [FacilityResponseDto] })
  async listFacilities(@Req() request: ApiRequest): Promise<FacilityResponseDto[]> {
    return (await this.organizations.listFacilities(this.principal(request))).map(facilityResponse);
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

function organizationResponse(organization: OrganizationSnapshot): OrganizationResponseDto {
  return { ...organization, createdAt: organization.createdAt.toISOString() };
}

function facilityResponse(facility: FacilitySnapshot): FacilityResponseDto {
  return { ...facility, createdAt: facility.createdAt.toISOString() };
}
