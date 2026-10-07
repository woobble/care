import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvitationCreateDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    description:
      'Normalized to lowercase. Acceptance requires a matching verified Authentik email.',
  })
  email!: string;
}

export class TenantInvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['pending', 'accepted', 'expired', 'revoked'] })
  status!: 'pending' | 'accepted' | 'expired' | 'revoked';

  @ApiProperty({ format: 'uuid' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  acceptedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class InviteUserResponseDto {
  @ApiProperty({ type: TenantInvitationDto })
  invitation!: TenantInvitationDto;
}

export class TenantRoleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  permissions!: string[];
}

export class TenantScopeDto {
  @ApiProperty({ enum: ['tenant', 'organization', 'facility', 'team', 'assigned_clients'] })
  scopeType!: 'tenant' | 'organization' | 'facility' | 'team' | 'assigned_clients';

  @ApiProperty({ format: 'uuid' })
  scopeId!: string;

  @ApiProperty({ nullable: true })
  name!: string | null;
}

export class TenantMemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ format: 'email', nullable: true })
  email!: string | null;

  @ApiProperty({ enum: ['pending', 'active', 'inactive', 'revoked'] })
  status!: 'pending' | 'active' | 'inactive' | 'revoked';

  @ApiProperty({ type: [TenantRoleDto] })
  roles!: TenantRoleDto[];

  @ApiProperty({ type: [TenantScopeDto] })
  scopes!: TenantScopeDto[];

  @ApiProperty({ type: [String] })
  permissions!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TenantMemberListDto {
  @ApiProperty({ type: [TenantMemberDto] })
  items!: TenantMemberDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class ReplaceMembershipRolesDto {
  @ApiProperty({ type: [String], format: 'uuid', uniqueItems: true, maxItems: 20 })
  roleIds!: string[];
}

export class TenantScopeInputDto {
  @ApiProperty({ enum: ['tenant', 'organization', 'facility', 'team'] })
  scopeType!: 'tenant' | 'organization' | 'facility' | 'team';

  @ApiProperty({ format: 'uuid' })
  scopeId!: string;
}

export class ReplaceMembershipScopesDto {
  @ApiProperty({ type: [TenantScopeInputDto], uniqueItems: true, maxItems: 100 })
  scopes!: TenantScopeInputDto[];
}

export class OrganizationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class FacilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
