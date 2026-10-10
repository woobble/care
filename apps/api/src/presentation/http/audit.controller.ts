import { ApiProperty } from '@nestjs/swagger';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { DrizzleAuditReader } from '@care/audit';
import { AuthorizationDeniedError, can } from '@care/permissions';
import { z } from 'zod';
import { AUDIT_READER } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import type { ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';

class AuditEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  actorId!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  resourceType!: string;

  @ApiProperty({ format: 'uuid' })
  resourceId!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  correlationId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;
}

class AuditListDto {
  @ApiProperty({ type: [AuditEntryDto] })
  items!: AuditEntryDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  actor: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  resourceType: z.string().trim().min(1).max(120).optional(),
  resourceId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

@ApiTags('audit')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, schema: { type: 'string', format: 'uuid' } })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/audit')
export class AuditController {
  constructor(@Inject(AUDIT_READER) private readonly audit: DrizzleAuditReader) {}

  @Get()
  @ApiOperation({
    summary: 'List tenant audit records',
    description:
      'Records are always tenant-scoped. When both date bounds are set, from must not be later than to.',
  })
  @ApiQuery({ name: 'page', required: false, type: 'integer', minimum: 1, default: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @ApiQuery({ name: 'actor', required: false, format: 'uuid' })
  @ApiQuery({ name: 'action', required: false, type: String, minLength: 1, maxLength: 120 })
  @ApiQuery({ name: 'resourceType', required: false, type: String, minLength: 1, maxLength: 120 })
  @ApiQuery({ name: 'resourceId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiOkResponse({ type: AuditListDto })
  async list(
    @Req() request: ApiRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AuditListDto> {
    const parsed = querySchema.safeParse({
      page,
      pageSize,
      actor,
      action,
      resourceType,
      resourceId,
      from,
      to,
    });
    if (!parsed.success) throw new BadRequestException();
    const principal = request.principal;
    if (!principal) throw new BadRequestException();
    if (!can(principal, { action: 'audit.read', resource: { tenantId: principal.tenantId } })) {
      throw new AuthorizationDeniedError('audit.read');
    }
    const fromDate = parsed.data.from ? new Date(parsed.data.from) : undefined;
    const toDate = parsed.data.to ? new Date(parsed.data.to) : undefined;
    if (fromDate && toDate && fromDate > toDate) throw new BadRequestException();
    const result = await this.audit.list(principal.tenantId, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      ...(parsed.data.actor ? { actorId: parsed.data.actor } : {}),
      ...(parsed.data.action ? { action: parsed.data.action } : {}),
      ...(parsed.data.resourceType ? { resourceType: parsed.data.resourceType } : {}),
      ...(parsed.data.resourceId ? { resourceId: parsed.data.resourceId } : {}),
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
    });
    return {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
      items: result.items.map((entry) => ({ ...entry, timestamp: entry.timestamp.toISOString() })),
    };
  }
}
