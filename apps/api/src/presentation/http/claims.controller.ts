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
  Res,
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
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type {
  BillingClaimsApplicationService,
  CreateClaimInput,
  PayerBillingProfileInput,
  PayerInput,
} from '@care/billing';
import { BILLING_CLAIMS_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';
import {
  ClaimCreateDto,
  PayerInputDto,
  PayerProfileInputDto,
  PayerUpdateDto,
  claimDecisionSchema,
  claimSubmitSchema,
  claimsListQuerySchema,
  createClaimSchema,
  expectedVersionSchema,
  payerCreateSchema,
  payerProfileSchema,
  payerUpdateSchema,
} from './claims.dto';

@ApiTags('billing claims')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/billing')
export class ClaimsController {
  constructor(
    @Inject(BILLING_CLAIMS_APPLICATION)
    private readonly claims: BillingClaimsApplicationService,
  ) {}

  @Get('payers')
  @ApiOperation({ summary: 'List payer records in the authorized provider scope' })
  @ApiQuery({ name: 'organizationId', required: true, format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  async listPayers(@Req() request: ApiRequest, @Query('organizationId') organizationId: string) {
    return this.claims.listPayers(principal(request), parseId(organizationId));
  }

  @Post('payers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payer directory entry' })
  @ApiBody({ type: PayerInputDto })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  async createPayer(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = payerCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.createPayer(
      principal(request),
      withoutUndefined(parsed.data) as PayerInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('payers/:id')
  @ApiOperation({ summary: 'Get a payer record' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async getPayer(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.getPayer(principal(request), parseId(id));
  }

  @Patch('payers/:id')
  @ApiOperation({ summary: 'Update a payer with optimistic versioning' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: PayerUpdateDto })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async updatePayer(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = payerUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.updatePayer(
      principal(request),
      parseId(id),
      withoutUndefined(parsed.data) as PayerInput & { expectedVersion: number },
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('payers/:id/profiles')
  @ApiOperation({ summary: 'List immutable, versioned payer requirements profiles' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  async payerProfiles(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.payerProfiles(principal(request), parseId(id));
  }

  @Post('payers/:id/profiles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a new version of payer requirements' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: PayerProfileInputDto })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  async savePayerProfile(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = payerProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const input = {
      ...withoutUndefined(parsed.data),
      payerId: parseId(id),
    } as PayerBillingProfileInput;
    return this.claims.savePayerProfile(
      principal(request),
      input,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('claims')
  @ApiOperation({ summary: 'List claims using deterministic pagination and resource scope' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async listClaims(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = claimsListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.listClaims(principal(request), withoutUndefined(parsed.data));
  }

  @Post('claims')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a draft claim from issued invoice funding portions' })
  @ApiBody({ type: ClaimCreateDto })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  async createClaim(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createClaimSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.createClaim(
      principal(request),
      withoutUndefined(parsed.data) as CreateClaimInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('claims/:id')
  @ApiOperation({ summary: 'Get claim snapshot, package, decisions, and payment state' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async getClaim(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.getClaim(principal(request), parseId(id));
  }

  @Get('claims/:id/readiness')
  @ApiOperation({ summary: 'Evaluate payer requirements and return actionable blockers' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async readiness(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.readiness(principal(request), parseId(id));
  }

  @Post('claims/:id/prepare')
  @ApiOperation({ summary: 'Finalize a private, versioned claim package' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async prepare(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.prepare(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('claims/:id/submit')
  @ApiOperation({ summary: 'Record a manual external claim submission' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async submit(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = claimSubmitSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.submit(
      principal(request),
      parseId(id),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('claims/:id/decision')
  @ApiOperation({ summary: 'Record a payer response without mutating the invoice' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async recordDecision(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = claimDecisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.recordDecision(
      principal(request),
      parseId(id),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('claims/:id/resubmit')
  @ApiOperation({ summary: 'Create a linked claim for the unpaid, unresolved portion' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  async resubmit(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.resubmit(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('claims/:id/cancel')
  @ApiOperation({ summary: 'Cancel an unsubmitted claim and release its amount reservation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async cancel(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.claims.cancel(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('claims/:id/documents')
  @ApiOperation({ summary: 'List immutable package artifacts and source hashes' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  async packageDocuments(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.packageDocuments(principal(request), parseId(id));
  }

  @Get('claims/:id/documents/:documentId')
  @ApiOperation({
    summary: 'Download a private claim package artifact after authorization and hash verification',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async downloadPackageDocument(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() response: FastifyReply,
  ) {
    const file = await this.claims.downloadPackageDocument(
      principal(request),
      parseId(id),
      parseId(documentId),
      requestContext(request),
      auditContext(request),
    );
    sendPdf(response, file.fileName, file.bytes);
  }

  @Get('claims/:id/history')
  @ApiOperation({ summary: 'Read append-only submission and decision history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async history(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.history(principal(request), parseId(id));
  }

  @Get('claims/:id/payment-summary')
  @ApiOperation({ summary: 'Show accepted amounts separately from recorded payment allocations' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async paymentSummary(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.claims.paymentSummary(principal(request), parseId(id));
  }
}

function principal(request: ApiRequest) {
  if (!request.principal) throw new BadRequestException();
  return request.principal;
}

function parseId(value: string): string {
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

function sendPdf(response: FastifyReply, fileName: string, bytes: Uint8Array): void {
  const safeName = encodeURIComponent(fileName).replaceAll("'", '%27');
  response
    .code(HttpStatus.OK)
    .type('application/pdf')
    .header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`)
    .header('Cache-Control', 'private, no-store')
    .header('Content-Length', String(bytes.byteLength))
    .send(Buffer.from(bytes));
}
