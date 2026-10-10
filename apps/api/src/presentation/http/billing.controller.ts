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
  Put,
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
import {
  BillingApplicationService,
  type DraftInvoiceInput,
  type DraftInvoiceUpdateInput,
  type InvoiceLineSelection,
} from '@care/billing';
import { BILLING_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';
import {
  BillingCandidateListResponseDto,
  BillingInvoiceListResponseDto,
  BillingInvoiceResponseDto,
  BillingPaymentListResponseDto,
  BillingPaymentResponseDto,
  BillingProfileInputDto,
  BillingSettingsListResponseDto,
  DraftInvoiceInputDto,
  DraftInvoiceUpdateDto,
  InvoiceCorrectionResponseDto,
  PayerArrangementInputDto,
  PayerArrangementListResponseDto,
  PayerArrangementUpdateDto,
  billingCandidateQuerySchema,
  billingProfileSchema,
  draftInvoiceSchema,
  draftInvoiceUpdateSchema,
  invoiceCorrectionSchema,
  invoiceListQuerySchema,
  issueInvoiceSchema,
  payerArrangementQuerySchema,
  payerArrangementSchema,
  payerArrangementUpdateSchema,
  paymentAllocationSchema,
  paymentReversalSchema,
  paymentSchema,
  paymentsQuerySchema,
  receivablesQuerySchema,
} from './billing.dto';

@ApiTags('billing')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/billing')
export class BillingController {
  constructor(@Inject(BILLING_APPLICATION) private readonly billing: BillingApplicationService) {}

  @Get('settings')
  @ApiOperation({ summary: 'List billing profiles in the current provider scope' })
  @ApiOkResponse({ type: BillingSettingsListResponseDto })
  async settings(@Req() request: ApiRequest) {
    return { items: await this.billing.settings(this.principal(request)) };
  }

  @Put('settings')
  @ApiOperation({ summary: 'Create or update provider billing settings' })
  @ApiBody({ type: BillingProfileInputDto })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async saveSettings(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = billingProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.saveSettings(
      this.principal(request),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('payer-arrangements')
  @ApiOperation({ summary: 'List a client’s payer arrangements and mandates' })
  @ApiQuery({ name: 'clientId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: PayerArrangementListResponseDto })
  async payerArrangements(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = payerArrangementQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return {
      items: await this.billing.payerArrangements(
        this.principal(request),
        withoutUndefined(parsed.data),
      ),
    };
  }

  @Post('payer-arrangements')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a payer arrangement and documented billing mandate' })
  @ApiBody({ type: PayerArrangementInputDto })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  async createPayerArrangement(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = payerArrangementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.createPayerArrangement(
      this.principal(request),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('payer-arrangements/:id')
  @ApiOperation({ summary: 'Update payer mandate status with optimistic versioning' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: PayerArrangementUpdateDto })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async updatePayerArrangement(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = payerArrangementUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.updatePayerArrangement(
      this.principal(request),
      parseId(id),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('candidates')
  @ApiOperation({ summary: 'List performed services and funding portions available for billing' })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'until', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'fundingSourceId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'ready', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'evidenceStatus', required: false, type: String })
  @ApiOkResponse({ type: BillingCandidateListResponseDto })
  async candidates(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = billingCandidateQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return {
      items: await this.billing.candidates(this.principal(request), withoutUndefined(parsed.data)),
    };
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices within the current tenant and resource scope' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'issued', 'cancelled'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: BillingInvoiceListResponseDto })
  async invoices(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = invoiceListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return {
      items: await this.billing.listInvoices(
        this.principal(request),
        withoutUndefined(parsed.data),
      ),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    };
  }

  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a draft invoice from reserved billing candidates' })
  @ApiBody({ type: DraftInvoiceInputDto })
  @ApiCreatedResponse({ type: BillingInvoiceResponseDto })
  async createDraft(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = draftInvoiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.createDraft(
      this.principal(request),
      draftInput(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get an invoice snapshot, corrections, and derived receivable state' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BillingInvoiceResponseDto })
  async invoice(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.billing.getInvoice(this.principal(request), parseId(id));
  }

  @Patch('invoices/:id')
  @ApiOperation({ summary: 'Replace draft lines using optimistic versioning' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: DraftInvoiceUpdateDto })
  @ApiOkResponse({ type: BillingInvoiceResponseDto })
  async updateDraft(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = draftInvoiceUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.updateDraft(
      this.principal(request),
      parseId(id),
      draftUpdateInput(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a draft and release its billing reservations' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BillingInvoiceResponseDto })
  async cancelDraft(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.billing.cancelDraft(
      this.principal(request),
      parseId(id),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revalidate and issue a draft with a provider-scoped invoice number' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: BillingInvoiceResponseDto })
  async issueInvoice(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = issueInvoiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.issueInvoice(
      this.principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('invoices/:id/pdf/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate an invoice PDF from its immutable issued snapshot' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BillingInvoiceResponseDto })
  async regeneratePdf(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.billing.regenerateInvoicePdf(
      this.principal(request),
      parseId(id),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('invoices/:id/pdf')
  @ApiOperation({
    summary: 'Download a private invoice PDF after authorization and hash verification',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async invoicePdf(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Res() response: FastifyReply,
  ) {
    const file = await this.billing.getInvoicePdf(this.principal(request), parseId(id));
    this.sendPdf(response, file.fileName, file.bytes);
  }

  @Post('invoices/:id/corrections')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an append-only invoice correction' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiCreatedResponse({ type: InvoiceCorrectionResponseDto })
  async correctInvoice(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = invoiceCorrectionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.correctInvoice(
      this.principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('invoices/:id/corrections/:correctionId/pdf')
  @ApiOperation({ summary: 'Download a private invoice correction PDF' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'correctionId', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async correctionPdf(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('correctionId') correctionId: string,
    @Res() response: FastifyReply,
  ) {
    const file = await this.billing.getCorrectionPdf(
      this.principal(request),
      parseId(id),
      parseId(correctionId),
    );
    this.sendPdf(response, file.fileName, file.bytes);
  }

  @Get('receivables')
  @ApiOperation({ summary: 'List issued invoices with outstanding balances and derived status' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: BillingInvoiceListResponseDto })
  async receivables(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = receivablesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return {
      items: await this.billing.receivables(this.principal(request), withoutUndefined(parsed.data)),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    };
  }

  @Get('payments')
  @ApiOperation({ summary: 'List recorded payment facts and remaining unallocated amounts' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: BillingPaymentListResponseDto })
  async payments(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = paymentsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return {
      items: await this.billing.listPayments(
        this.principal(request),
        withoutUndefined(parsed.data),
      ),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    };
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a payment received by the provider' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiCreatedResponse({ type: BillingPaymentResponseDto })
  async recordPayment(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = paymentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.recordPayment(
      this.principal(request),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('payment-allocations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Allocate part of a recorded payment to an outstanding invoice' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  async allocatePayment(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = paymentAllocationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.allocatePayment(
      this.principal(request),
      withoutUndefined(parsed.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('payment-allocations/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reverse an incorrect payment allocation with an append-only entry' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } },
    },
  })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async reversePaymentAllocation(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = paymentReversalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.billing.reversePaymentAllocation(
      this.principal(request),
      parseId(id),
      parsed.data.reason,
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }

  private sendPdf(response: FastifyReply, fileName: string, bytes: Uint8Array): void {
    const safeName = encodeURIComponent(fileName).replaceAll("'", '%27');
    response
      .code(HttpStatus.OK)
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`)
      .header('Cache-Control', 'private, no-store')
      .header('Content-Length', String(bytes.byteLength))
      .send(Buffer.from(bytes));
  }
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

function invoiceLineSelections(
  lines: Array<{
    performedServiceId: string;
    fundingAllocationId?: string | null | undefined;
    amountCents: number;
  }>,
): InvoiceLineSelection[] {
  return lines.map(({ fundingAllocationId, ...line }) =>
    fundingAllocationId === undefined ? line : { ...line, fundingAllocationId },
  );
}

function draftInput(input: z.infer<typeof draftInvoiceSchema>): DraftInvoiceInput {
  return {
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    clientId: input.clientId,
    recipientType: input.recipientType,
    ...(input.payerArrangementId === undefined
      ? {}
      : { payerArrangementId: input.payerArrangementId }),
    lines: invoiceLineSelections(input.lines),
  };
}

function draftUpdateInput(
  input: z.infer<typeof draftInvoiceUpdateSchema>,
): DraftInvoiceUpdateInput {
  return { ...draftInput(input), expectedVersion: input.expectedVersion };
}
