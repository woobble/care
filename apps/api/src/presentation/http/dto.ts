import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PERMISSIONS, type ScopeType } from '@care/permissions';

export class MeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: 'active' | 'disabled';
}

export class TenantSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class PermissionGrantDto {
  @ApiProperty({ enum: PERMISSIONS })
  permission!: (typeof PERMISSIONS)[number];

  @ApiProperty({ enum: ['assigned_clients', 'team', 'facility', 'organization', 'tenant'] })
  scopeType!: ScopeType;

  @ApiProperty({ format: 'uuid' })
  scopeId!: string;
}

export class ProblemDetailsDto {
  @ApiProperty({ format: 'uri' })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: number;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  traceId!: string;

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      plannedStart: { type: 'string', format: 'date-time' },
      plannedEnd: { type: 'string', format: 'date-time' },
      timezone: { type: 'string' },
    },
  })
  conflictingInterval?: {
    plannedStart: string;
    plannedEnd: string;
    timezone: string;
  };
}
