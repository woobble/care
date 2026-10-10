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
import { ServicePriceApplicationService } from '@care/services';
import { SERVICE_PRICE_APPLICATION } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';
import {
  createServicePriceSchema,
  ServicePriceInputDto,
  ServicePriceListResponseDto,
  ServicePriceResponseDto,
  servicePriceQuerySchema,
} from './service-prices.dto';

@ApiTags('service pricing')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/services/:serviceId/prices')
export class ServicePricesController {
  constructor(
    @Inject(SERVICE_PRICE_APPLICATION)
    private readonly prices: ServicePriceApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List effective service prices for a provider context' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'validAt', required: true, type: String, format: 'date' })
  @ApiOkResponse({ type: ServicePriceListResponseDto })
  async list(
    @Req() request: ApiRequest,
    @Param('serviceId') serviceId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = servicePriceQuerySchema.safeParse(query);
    if (!parsed.success || !isUuid(serviceId)) throw new BadRequestException();
    const items = await this.prices.list(
      request.principal!,
      serviceId,
      withoutUndefined(parsed.data),
    );
    return { items: items.map(priceResponse) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an effective-dated service price' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiBody({ type: ServicePriceInputDto })
  @ApiCreatedResponse({ type: ServicePriceResponseDto })
  async create(
    @Req() request: ApiRequest,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ) {
    const parsed = createServicePriceSchema.safeParse(body);
    if (!parsed.success || !isUuid(serviceId)) throw new BadRequestException();
    const price = await this.prices.create(
      request.principal!,
      { ...withoutUndefined(parsed.data), serviceId },
      requestContext(request),
      {
        ...(request.ip ? { ip: request.ip } : {}),
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
      },
    );
    return priceResponse(price);
  }
}

function priceResponse(price: Awaited<ReturnType<ServicePriceApplicationService['list']>>[number]) {
  return {
    id: price.id,
    serviceId: price.serviceId,
    organizationId: price.organizationId,
    facilityId: price.facilityId,
    priceCents: price.priceCents,
    pricingUnit: price.pricingUnit,
    validFrom: price.validFrom,
    validUntil: price.validUntil,
    createdAt: price.createdAt.toISOString(),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
