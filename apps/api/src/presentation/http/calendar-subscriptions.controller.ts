import {
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { API_CONFIG, CALENDAR_SUBSCRIPTION_APPLICATION, IDENTITY_SERVICE } from '@app/api/tokens';
import { DisabledUserError, IdentityService, TenantAccessDeniedError } from '@care/identity';
import { loadApiConfig } from '@care/config';
import {
  CalendarSubscriptionApplicationService,
  CalendarSubscriptionPermissionError,
  CalendarSubscriptionUnavailableError,
} from '@care/scheduling';

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import type { ApiRequest } from '@app/api/http/request';
import { requestContext } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import {
  CalendarSubscriptionCreatedResponseDto,
  CalendarSubscriptionRevokedResponseDto,
  CalendarSubscriptionStatusResponseDto,
} from './calendar-subscriptions.dto';
import { serializeCalendarFeed } from './icalendar-feed';

@ApiTags('caregiver calendar subscriptions')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/me/calendar-subscription')
export class MyCalendarSubscriptionController {
  constructor(
    @Inject(CALENDAR_SUBSCRIPTION_APPLICATION)
    private readonly subscriptions: CalendarSubscriptionApplicationService,
    @Inject(API_CONFIG) private readonly config: ReturnType<typeof loadApiConfig>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the current caregiver calendar subscription status' })
  @ApiOkResponse({ type: CalendarSubscriptionStatusResponseDto })
  async get(@Req() request: ApiRequest): Promise<CalendarSubscriptionStatusResponseDto> {
    try {
      const subscription = await this.subscriptions.getStatus(this.principal(request));
      return {
        active: subscription !== null,
        createdAt: subscription?.createdAt.toISOString() ?? null,
      };
    } catch (error) {
      if (error instanceof CalendarSubscriptionPermissionError) throw new NotFoundException();
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create or rotate a read-only caregiver calendar subscription' })
  @ApiCreatedResponse({ type: CalendarSubscriptionCreatedResponseDto })
  async create(@Req() request: ApiRequest): Promise<CalendarSubscriptionCreatedResponseDto> {
    let subscription;
    try {
      subscription = await this.subscriptions.rotate(
        this.principal(request),
        requestContext(request),
        auditContext(request),
      );
    } catch (error) {
      if (error instanceof CalendarSubscriptionPermissionError) throw new NotFoundException();
      throw error;
    }
    const path = `/api/v1/calendar-subscriptions/${subscription.tenantId}/${subscription.token}.ics`;
    const httpsUrl = new URL(path, this.config.API_PUBLIC_ORIGIN).toString();
    const webcalUrl = httpsUrl.replace(/^https:/, 'webcal:');
    return {
      active: true,
      httpsUrl,
      webcalUrl,
      createdAt: subscription.createdAt.toISOString(),
    };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current caregiver calendar subscription' })
  @ApiOkResponse({ type: CalendarSubscriptionRevokedResponseDto })
  async revoke(@Req() request: ApiRequest): Promise<CalendarSubscriptionRevokedResponseDto> {
    try {
      const revoked = await this.subscriptions.revoke(
        this.principal(request),
        requestContext(request),
        auditContext(request),
      );
      return { revoked };
    } catch (error) {
      if (error instanceof CalendarSubscriptionPermissionError) throw new NotFoundException();
      throw error;
    }
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new NotFoundException();
    return request.principal;
  }
}

@Injectable()
export class CalendarSubscriptionRateLimiter {
  private readonly clientWindows = new Map<string, { startedAt: number; count: number }>();
  private readonly tokenWindows = new Map<string, { startedAt: number; count: number }>();
  private requestsSinceSweep = 0;

  allowClient(ip: string, now = Date.now()): boolean {
    return this.allow(this.clientWindows, ip, 120, now);
  }

  allowToken(tokenHash: string, now = Date.now()): boolean {
    return this.allow(this.tokenWindows, tokenHash, 30, now);
  }

  private allow(
    windows: Map<string, { startedAt: number; count: number }>,
    key: string,
    limit: number,
    now: number,
  ): boolean {
    this.requestsSinceSweep += 1;
    if (this.requestsSinceSweep >= 128) {
      this.requestsSinceSweep = 0;
      for (const [windowKey, window] of windows) {
        if (window.startedAt + 60_000 <= now) windows.delete(windowKey);
      }
    }
    let window = windows.get(key);
    if (!window || window.startedAt + 60_000 <= now) {
      window = { startedAt: now, count: 0 };
      windows.set(key, window);
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }
}

@ApiTags('caregiver calendar subscriptions')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@Controller('api/v1/calendar-subscriptions')
export class CalendarSubscriptionFeedController {
  constructor(
    @Inject(CALENDAR_SUBSCRIPTION_APPLICATION)
    private readonly subscriptions: CalendarSubscriptionApplicationService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    private readonly rateLimiter: CalendarSubscriptionRateLimiter,
  ) {}

  @Get(':tenantId/:token.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="care-calendar.ics"')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Read a token-protected caregiver iCalendar subscription feed',
    description:
      'Read-only feed. The token is a bearer secret; access is checked against current caregiver membership and employee linkage on every request.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'token', description: 'Cryptographically random subscription token' })
  @ApiOkResponse({ description: 'RFC 5545 iCalendar feed', content: { 'text/calendar': {} } })
  async get(
    @Param('tenantId') tenantId: string,
    @Param('token') token: string,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    const clientIp = request.ip || 'unknown';
    if (!this.rateLimiter.allowClient(clientIp)) {
      reply.header('Retry-After', '60');
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const reference = await this.subscriptions.findToken(tenantId, token);
    if (!reference) throw new NotFoundException();
    if (!this.rateLimiter.allowToken(reference.tokenHash)) {
      reply.header('Retry-After', '60');
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    let principal;
    try {
      principal = await this.identity.loadTenantPrincipal(reference.userId, reference.tenantId);
    } catch (error) {
      if (error instanceof DisabledUserError || error instanceof TenantAccessDeniedError) {
        throw new NotFoundException();
      }
      throw error;
    }
    if (!principal.roles?.includes('Caregiver')) throw new NotFoundException();

    try {
      const events = await this.subscriptions.calendarEvents(principal, reference);
      return serializeCalendarFeed(events);
    } catch (error) {
      if (error instanceof CalendarSubscriptionUnavailableError) throw new NotFoundException();
      throw error;
    }
  }
}

function auditContext(request: ApiRequest): { ip?: string; userAgent?: string } {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}
