import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IdentityService } from '@care/identity';
import { IDENTITY_SERVICE } from '../../tokens';
import { OidcGuard } from '../../http/auth.guards';
import type { ApiRequest } from '../../http/request';
import { MeResponseDto, ProblemDetailsDto, TenantSummaryDto } from './dto';

@ApiTags('identity')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard)
@Controller('api/v1/me')
export class MeController {
  constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current local user' })
  @ApiOkResponse({ type: MeResponseDto })
  async me(@Req() request: ApiRequest): Promise<MeResponseDto> {
    const user = await this.identity.getCurrentUser(request.identity!.userId);
    return { id: user.id, status: user.status };
  }

  @Get('tenants')
  @ApiOperation({ summary: 'List active tenant memberships for the current user' })
  @ApiOkResponse({ type: [TenantSummaryDto] })
  async tenants(@Req() request: ApiRequest): Promise<TenantSummaryDto[]> {
    return this.identity.listTenantMemberships(request.identity!.userId);
  }
}
