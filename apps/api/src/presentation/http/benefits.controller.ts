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
import {
  BenefitsApplicationService,
  type BenefitAdjustmentInput,
  type EntitlementInput,
  type FundingSourceInput,
  type ServiceAllocationInput,
} from '@care/benefits';
import { BENEFITS_APPLICATION } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';
import {
  BenefitAdjustmentDto,
  BenefitAdjustmentResponseDto,
  BenefitAllocationsDto,
  BenefitDefinitionsResponseDto,
  BenefitBudgetResponseDto,
  BenefitAllocationReversalResponseDto,
  BenefitEstimateResponseDto,
  BenefitEntitlementDto,
  BenefitEntitlementInputDto,
  BenefitEntitlementUpdateDto,
  BenefitFundingSourceDto,
  BenefitFundingSourceInputDto,
  BenefitHistoryResponseDto,
  BenefitReversalDto,
  BenefitRulesResponseDto,
  BenefitServiceAllocationResultDto,
  ProviderRecognitionDto,
  BenefitWorklistResponseDto,
  BenefitUnallocatedServicesResponseDto,
  ProviderRecognitionInputDto,
  adjustmentSchema,
  allocationsSchema,
  entitlementSchema,
  entitlementUpdateSchema,
  fundingSourceSchema,
  recognitionSchema,
  reversalSchema,
} from './benefits.dto';
import { z } from 'zod';

const historyQuerySchema = z
  .object({
    from: z.string().optional(),
    until: z.string().optional(),
    fundingSourceId: z.uuid().optional(),
    entryType: z
      .enum([
        'entitlement_allocated',
        'opening_balance_adjusted',
        'external_consumption_recorded',
        'service_consumption_allocated',
        'service_consumption_reversed',
        'manual_adjustment',
        'benefit_expired',
      ])
      .optional(),
    reference: z.string().max(500).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const unallocatedQuerySchema = z
  .object({
    clientId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const estimateQuerySchema = z
  .object({
    serviceId: z.uuid(),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantity: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,3})?$/),
  })
  .strict();
const asOfSchema = z
  .object({
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

@ApiTags('benefits and budgets')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class BenefitsController {
  constructor(
    @Inject(BENEFITS_APPLICATION) private readonly benefits: BenefitsApplicationService,
  ) {}

  @Get('benefit-definitions')
  @ApiOperation({ summary: 'List supported benefit definitions' })
  @ApiOkResponse({ type: BenefitDefinitionsResponseDto })
  async definitions(@Req() request: ApiRequest) {
    return { items: await this.benefits.listDefinitions(this.principal(request)) };
  }

  @Get('benefit-rules')
  @ApiOperation({ summary: 'List effective-dated benefit rules and source references' })
  @ApiOkResponse({ type: BenefitRulesResponseDto })
  async rules(@Req() request: ApiRequest) {
    return { items: await this.benefits.listRules(this.principal(request)) };
  }

  @Get('clients/:clientId/benefits')
  @ApiOperation({
    summary: 'Get a client’s benefit entitlements, funding sources, and current budget projection',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: BenefitBudgetResponseDto })
  async benefitsForClient(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.benefits.getBudget(this.principal(request), parseId(clientId));
  }

  @Post('clients/:clientId/benefits')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a client benefit entitlement' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: BenefitEntitlementInputDto })
  @ApiCreatedResponse({ type: BenefitEntitlementDto })
  async createEntitlement(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = entitlementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.createEntitlement(
      this.principal(request),
      parseId(clientId),
      parsed.data as EntitlementInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('clients/:clientId/benefits/:entitlementId')
  @ApiOperation({ summary: 'Update entitlement status or end date using optimistic versioning' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'entitlementId', format: 'uuid' })
  @ApiBody({ type: BenefitEntitlementUpdateDto })
  @ApiOkResponse({ type: BenefitEntitlementDto })
  async updateEntitlement(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('entitlementId') entitlementId: string,
    @Body() body: unknown,
  ) {
    const parsed = entitlementUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.updateEntitlement(
      this.principal(request),
      parseId(clientId),
      parseId(entitlementId),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('clients/:clientId/budgets')
  @ApiOperation({
    summary: 'Get recorded and confirmed budget balances plus planned consumption estimate',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'asOf', required: false, type: String, format: 'date' })
  @ApiOkResponse({ type: BenefitBudgetResponseDto })
  async budget(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = asOfSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.getBudget(this.principal(request), parseId(clientId), parsed.data.asOf);
  }

  @Get('clients/:clientId/budget-history')
  @ApiOperation({ summary: 'Get a bounded, filterable budget ledger history' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'until', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'fundingSourceId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'entryType',
    required: false,
    enum: [
      'entitlement_allocated',
      'opening_balance_adjusted',
      'external_consumption_recorded',
      'service_consumption_allocated',
      'service_consumption_reversed',
      'manual_adjustment',
      'benefit_expired',
    ],
  })
  @ApiQuery({ name: 'reference', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: BenefitHistoryResponseDto })
  async history(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = historyQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.listHistory(
      this.principal(request),
      parseId(clientId),
      withoutUndefined(parsed.data),
    );
  }

  @Get('clients/:clientId/funding-sources')
  @ApiOperation({
    summary: 'List client funding sources linked to existing insurance records where applicable',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [BenefitFundingSourceDto] })
  async fundingSources(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.benefits.listFundingSources(this.principal(request), parseId(clientId));
  }

  @Post('clients/:clientId/funding-sources')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a client funding source' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: BenefitFundingSourceInputDto })
  @ApiCreatedResponse({ type: BenefitFundingSourceDto })
  async createFundingSource(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = fundingSourceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.createFundingSource(
      this.principal(request),
      parseId(clientId),
      parsed.data as FundingSourceInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('clients/:clientId/budget-adjustments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record an opening balance, external consumption, or append-only correction',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: BenefitAdjustmentDto })
  @ApiCreatedResponse({ type: BenefitAdjustmentResponseDto })
  async adjustment(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = adjustmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.recordAdjustment(
      this.principal(request),
      parseId(clientId),
      parsed.data as BenefitAdjustmentInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('benefits/worklist')
  @ApiOperation({
    summary: 'List clients needing benefit review and completed services awaiting allocation',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: BenefitWorklistResponseDto })
  async worklist(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.getWorklist(
      this.principal(request),
      parsed.data.page,
      parsed.data.pageSize,
    );
  }

  @Get('benefits/unallocated-services')
  @ApiOperation({ summary: 'List completed service facts with priced unallocated amounts' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: BenefitUnallocatedServicesResponseDto })
  async unallocatedServices(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = unallocatedQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.listUnallocatedServices(
      this.principal(request),
      parsed.data.clientId,
      parsed.data.page,
      parsed.data.pageSize,
    );
  }

  @Post('performed-services/:performedServiceId/funding-allocations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Allocate a completed service amount to one or more entitlements' })
  @ApiParam({ name: 'performedServiceId', format: 'uuid' })
  @ApiBody({ type: BenefitAllocationsDto })
  @ApiCreatedResponse({ type: BenefitServiceAllocationResultDto })
  async allocate(
    @Req() request: ApiRequest,
    @Param('performedServiceId') performedServiceId: string,
    @Body() body: unknown,
  ) {
    const parsed = allocationsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.allocateService(
      this.principal(request),
      parseId(performedServiceId),
      parsed.data.allocations as ServiceAllocationInput[],
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('funding-allocations/:allocationId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reverse a prior allocation while preserving the original ledger entry',
  })
  @ApiParam({ name: 'allocationId', format: 'uuid' })
  @ApiBody({ type: BenefitReversalDto })
  @ApiOkResponse({ type: BenefitAllocationReversalResponseDto })
  async reverse(
    @Req() request: ApiRequest,
    @Param('allocationId') allocationId: string,
    @Body() body: unknown,
  ) {
    const parsed = reversalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.reverseAllocation(
      this.principal(request),
      parseId(allocationId),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('benefits/provider-recognitions')
  @ApiOperation({ summary: 'List recognition records visible to the current provider scope' })
  @ApiOkResponse({ type: [ProviderRecognitionDto] })
  async recognitions(@Req() request: ApiRequest) {
    return this.benefits.listRecognitions(this.principal(request));
  }

  @Post('benefits/provider-recognitions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a jurisdiction-specific recognized service offering' })
  @ApiBody({ type: ProviderRecognitionInputDto })
  @ApiCreatedResponse({ type: ProviderRecognitionDto })
  async createRecognition(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = recognitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.createRecognition(
      this.principal(request),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('clients/:clientId/budgets/estimate')
  @ApiOperation({
    summary:
      'Estimate service price and benefit impact for planning without reserving or consuming funds',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'serviceId', required: true, type: String, format: 'uuid' })
  @ApiQuery({ name: 'serviceDate', required: true, type: String, format: 'date' })
  @ApiQuery({ name: 'quantity', required: true, type: String })
  @ApiOkResponse({ type: BenefitEstimateResponseDto })
  async estimate(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = estimateQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.benefits.estimate(this.principal(request), {
      clientId: parseId(clientId),
      ...parsed.data,
    });
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
