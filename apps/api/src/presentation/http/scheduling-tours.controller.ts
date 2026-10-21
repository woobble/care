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

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { SCHEDULING_APPLICATION } from '@app/api/tokens';
import {
  SchedulingApplicationService,
  type CreateTourInput,
  type UpdateTourStopsInput,
} from '@care/scheduling';

import { ProblemDetailsDto } from './dto';
import {
  createTourSchema,
  updateTourStopsSchema,
  tourVersionSchema,
  tourListQuerySchema,
  CreateTourDto,
  UpdateTourStopsDto,
  TourResponseDto,
  RouteOrderSuggestionResponseDto,
  TourListItemResponseDto,
} from './scheduling.dto';
import { parseId, auditContext } from './scheduling-http';

@ApiTags('scheduling tours')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/scheduling/tours')
export class SchedulingToursController {
  constructor(
    @Inject(SCHEDULING_APPLICATION)
    private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List one employee daily tours in a bounded date range' })
  @ApiQuery({ name: 'employeeId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'from', required: true, format: 'date' })
  @ApiQuery({ name: 'until', required: true, format: 'date', description: 'Exclusive end date' })
  @ApiOkResponse({ type: [TourListItemResponseDto] })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = tourListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.listTours(
      this.principal(request),
      parsed.data.employeeId,
      parsed.data.from,
      parsed.data.until,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a draft employee tour from existing assigned visits' })
  @ApiBody({ type: CreateTourDto })
  @ApiCreatedResponse({ type: TourResponseDto })
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createTourSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.createTour(
      this.principal(request),
      parsed.data as CreateTourInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a daily tour, stops, route estimates, and latest publication' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TourResponseDto })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.scheduling.getTour(this.principal(request), parseId(id));
  }

  @Put(':id/stops')
  @ApiOperation({ summary: 'Replace a draft stop order while preserving visit identity' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateTourStopsDto })
  @ApiOkResponse({ type: TourResponseDto })
  async updateStops(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateTourStopsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.updateTourStops(
      this.principal(request),
      parseId(id),
      parsed.data as UpdateTourStopsInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post(':id/suggest-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suggest a route-aware order without changing the tour' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RouteOrderSuggestionResponseDto })
  async suggestOrder(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.scheduling.suggestTourOrder(this.principal(request), parseId(id));
  }

  @Post(':id/estimate-travel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estimate route legs using the configured routing provider' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
      required: ['expectedVersion'],
    },
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  async estimateTravel(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = tourVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.estimateTourRoute(
      this.principal(request),
      parseId(id),
      parsed.data.expectedVersion,
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a versioned tour after feasibility checks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
      required: ['expectedVersion'],
    },
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  async publish(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = tourVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.scheduling.publishTour(
      this.principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}
