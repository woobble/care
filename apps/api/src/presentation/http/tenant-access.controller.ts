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
import { TENANT_ACCESS_SERVICE } from '@app/api/tokens';
import { TenantAccessError, TenantAccessService } from '@care/identity';
import type { TenantInvitationView, TenantMemberView } from '@care/identity';

import { ProblemDetailsDto } from './dto';
import {
  InvitationCreateDto,
  InviteUserResponseDto,
  ReplaceMembershipRolesDto,
  ReplaceMembershipScopesDto,
  TenantInvitationDto,
  TenantInvitationListDto,
  TenantMemberDto,
  TenantMemberListDto,
  TenantRoleDto,
  type TenantScopeInputDto,
} from './tenant-access.dto';

const invitationSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict();
const roleAssignmentSchema = z
  .object({ roleIds: z.array(z.string().uuid()).max(20) })
  .strict()
  .refine((input) => new Set(input.roleIds).size === input.roleIds.length, 'Duplicate role id');
const scopeAssignmentSchema = z
  .object({
    scopes: z
      .array(
        z
          .object({
            scopeType: z.enum(['tenant', 'organization', 'facility', 'team']),
            scopeId: z.string().uuid(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    ({ scopes }) =>
      new Set(scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`)).size === scopes.length,
    'Duplicate scope',
  );
const membershipQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'active', 'inactive', 'revoked']).optional(),
  q: z.string().trim().max(120).optional(),
  roleId: z.string().uuid().optional(),
  scopeType: z.enum(['tenant', 'organization', 'facility', 'team']).optional(),
  organizationId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
});
const invitationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional(),
});

@ApiTags('tenant administration')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, schema: { type: 'string', format: 'uuid' } })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/admin')
export class TenantAccessController {
  constructor(@Inject(TENANT_ACCESS_SERVICE) private readonly tenantAccess: TenantAccessService) {}

  @Get('members')
  @ApiOperation({ summary: 'List tenant members' })
  @ApiQuery({ name: 'page', required: false, type: 'integer', minimum: 1, default: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'active', 'inactive', 'revoked'] })
  @ApiQuery({ name: 'q', required: false, maxLength: 120 })
  @ApiQuery({ name: 'roleId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'scopeType',
    required: false,
    enum: ['tenant', 'organization', 'facility', 'team'],
  })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberListDto })
  async listMembers(
    @Req() request: ApiRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('roleId') roleId?: string,
    @Query('scopeType') scopeType?: string,
    @Query('organizationId') organizationId?: string,
    @Query('facilityId') facilityId?: string,
  ): Promise<TenantMemberListDto> {
    const parsed = membershipQuerySchema.safeParse({
      page,
      pageSize,
      status,
      q,
      roleId,
      scopeType,
      organizationId,
      facilityId,
    });
    if (!parsed.success) throw invalidRequest();
    const result = await this.tenantAccess.listMembers(this.principal(request), {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.q ? { q: parsed.data.q } : {}),
      ...(parsed.data.roleId ? { roleId: parsed.data.roleId } : {}),
      ...(parsed.data.scopeType ? { scopeType: parsed.data.scopeType } : {}),
      ...(parsed.data.organizationId ? { organizationId: parsed.data.organizationId } : {}),
      ...(parsed.data.facilityId ? { facilityId: parsed.data.facilityId } : {}),
    });
    return { ...result, items: result.items.map(toMemberDto) };
  }

  @Get('members/:id')
  @ApiOperation({ summary: 'Get a tenant member and effective permissions' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberDto })
  async getMember(@Req() request: ApiRequest, @Param('id') id: string): Promise<TenantMemberDto> {
    return toMemberDto(await this.tenantAccess.getMember(this.principal(request), parseId(id)));
  }

  @Post('invitations')
  @ApiOperation({
    summary: 'Invite an identity by verified email address',
    description:
      'The invitation remains pending until a valid Authentik identity presents the same verified email.',
  })
  @ApiBody({ type: InvitationCreateDto })
  @ApiCreatedResponse({ type: InviteUserResponseDto })
  async invite(@Req() request: ApiRequest, @Body() body: unknown): Promise<InviteUserResponseDto> {
    const parsed = invitationSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    const result = await this.tenantAccess.invite(
      this.principal(request),
      parsed.data.email,
      requestContext(request),
      auditContext(request),
    );
    return {
      invitation: toInvitationDto(result.invitation),
    };
  }

  @Get('invitations')
  @ApiOperation({ summary: 'List tenant invitations' })
  @ApiQuery({ name: 'page', required: false, type: 'integer', minimum: 1, default: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'accepted', 'expired', 'revoked'],
  })
  @ApiOkResponse({ type: TenantInvitationListDto })
  async listInvitations(
    @Req() request: ApiRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ): Promise<TenantInvitationListDto> {
    const parsed = invitationListQuerySchema.safeParse({ page, pageSize, status });
    if (!parsed.success) throw invalidRequest();
    const result = await this.tenantAccess.listInvitationsPage(this.principal(request), {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    return { ...result, items: result.items.map(toInvitationDto) };
  }

  @Post('invitations/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantInvitationDto })
  async revokeInvitation(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<TenantInvitationDto> {
    return toInvitationDto(
      await this.tenantAccess.revokeInvitation(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('roles')
  @ApiOperation({ summary: 'List tenant system roles and permissions' })
  @ApiOkResponse({ type: [TenantRoleDto] })
  async listRoles(@Req() request: ApiRequest): Promise<TenantRoleDto[]> {
    return this.tenantAccess.listRoles(this.principal(request));
  }

  @Post('members/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a pending or inactive membership' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberDto })
  async activate(@Req() request: ApiRequest, @Param('id') id: string): Promise<TenantMemberDto> {
    return toMemberDto(
      await this.tenantAccess.activate(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('members/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an active membership' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberDto })
  async deactivate(@Req() request: ApiRequest, @Param('id') id: string): Promise<TenantMemberDto> {
    return toMemberDto(
      await this.tenantAccess.deactivate(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('members/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke tenant access permanently' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberDto })
  async revoke(@Req() request: ApiRequest, @Param('id') id: string): Promise<TenantMemberDto> {
    return toMemberDto(
      await this.tenantAccess.revoke(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put('members/:id/roles')
  @ApiOperation({ summary: 'Replace a member’s assigned system roles' })
  @ApiBody({ type: ReplaceMembershipRolesDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberDto })
  async replaceRoles(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TenantMemberDto> {
    const parsed = roleAssignmentSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    return toMemberDto(
      await this.tenantAccess.replaceRoles(
        this.principal(request),
        parseId(id),
        parsed.data.roleIds,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put('members/:id/scopes')
  @ApiOperation({
    summary: 'Replace a member’s tenant, organization, and facility scopes',
    description: 'A tenant scope cannot be combined with organization or facility scopes.',
  })
  @ApiBody({ type: ReplaceMembershipScopesDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberDto })
  async replaceScopes(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TenantMemberDto> {
    const parsed = scopeAssignmentSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    return toMemberDto(
      await this.tenantAccess.replaceScopes(
        this.principal(request),
        parseId(id),
        parsed.data.scopes as TenantScopeInputDto[],
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
  if (!result.success) throw invalidRequest();
  return result.data;
}

function invalidRequest(): TenantAccessError {
  return new TenantAccessError('INVALID_REQUEST', 400, 'The request is invalid');
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}

function toInvitationDto(invitation: TenantInvitationView): TenantInvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    createdBy: invitation.createdBy,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
  };
}

function toMemberDto(member: TenantMemberView): TenantMemberDto {
  return {
    ...member,
    invitation: member.invitation
      ? {
          status: member.invitation.status,
          expiresAt: member.invitation.expiresAt.toISOString(),
          createdAt: member.invitation.createdAt.toISOString(),
        }
      : null,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}
