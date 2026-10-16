import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-fastify/multipart';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { apiMetrics } from '@app/api/operational-metrics';
import {
  BENEFITS_APPLICATION,
  BILLING_APPLICATION,
  BILLING_CLAIMS_APPLICATION,
  CLIENT_APPLICATION,
  CLIENT_MASTER_DATA_APPLICATION,
  DOCUMENTS_APPLICATION,
  ORGANIZATION_APPLICATION,
  SCHEDULING_APPLICATION,
  SERVICE_AGREEMENT_APPLICATION,
  SERVICE_EVIDENCE_APPLICATION,
} from '@app/api/tokens';
import { BenefitsApplicationService } from '@care/benefits';
import type { BillingClaimsApplicationService } from '@care/billing';
import { BillingApplicationService } from '@care/billing';
import {
  displayClientName,
  ClientApplicationService,
  ClientMasterDataApplicationService,
} from '@care/clients';
import {
  DocumentAccessDeniedError,
  DocumentArtifactNotFoundError,
  DocumentGenerationFailedError,
  DocumentSourceNotFoundError,
  DocumentSourceNotReadyError,
  DocumentsApplicationService,
  type DocumentAcknowledgement,
  type DocumentArtifactView,
  type DocumentLocale,
  type DocumentPayload,
  type DocumentType,
} from '@care/documents';
import { csvNumber, DOCUMENT_EXPORT_SCHEMAS, encodeCsv } from '@care/documents';
import { OrganizationApplicationService } from '@care/organizations';
import { AuthorizationDeniedError, type AuthorizationPrincipal } from '@care/permissions';
import { SchedulingApplicationService } from '@care/scheduling';
import { ServiceAgreementApplicationService } from '@care/service-agreements';
import { ServiceEvidenceApplicationService } from '@care/service-evidence';

import {
  documentGenerationCommandSchema,
  benefitAllocationExportQuerySchema,
  billingExportQuerySchema,
  documentListQuerySchema,
  documentLogoUploadSchema,
  documentTemplateInputSchema,
  documentTemplateQuerySchema,
  documentTemplateTypeSchema,
  type DocumentGenerationCommand,
} from './documents.dto';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';

@ApiTags('documents')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class DocumentsController {
  constructor(
    @Inject(DOCUMENTS_APPLICATION) private readonly documents: DocumentsApplicationService,
    @Inject(SERVICE_EVIDENCE_APPLICATION)
    private readonly evidence: ServiceEvidenceApplicationService,
    @Inject(SERVICE_AGREEMENT_APPLICATION)
    private readonly agreements: ServiceAgreementApplicationService,
    @Inject(BENEFITS_APPLICATION) private readonly benefits: BenefitsApplicationService,
    @Inject(BILLING_APPLICATION) private readonly billing: BillingApplicationService,
    @Inject(BILLING_CLAIMS_APPLICATION)
    private readonly claims: BillingClaimsApplicationService,
    @Inject(CLIENT_APPLICATION) private readonly clients: ClientApplicationService,
    @Inject(CLIENT_MASTER_DATA_APPLICATION)
    private readonly clientMasterData: ClientMasterDataApplicationService,
    @Inject(ORGANIZATION_APPLICATION)
    private readonly organizations: OrganizationApplicationService,
    @Inject(SCHEDULING_APPLICATION) private readonly scheduling: SchedulingApplicationService,
  ) {}

  @Get('documents')
  @ApiOperation({ summary: 'List authorized document metadata across the caller scope' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'documentType',
    required: false,
    enum: [
      'service_evidence',
      'service_agreement',
      'invoice',
      'invoice_correction',
      'benefit_overview',
      'claim_summary',
    ],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'ready', 'failed', 'superseded'] })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'until', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'sourceEntityType', required: false, type: String })
  @ApiQuery({ name: 'sourceEntityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'sort', required: false, enum: ['createdAt', 'name', 'type', 'status'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = documentListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const listed = await this.documents.listArtifacts(
      this.principal(request),
      withoutUndefined(parsed.data),
    );
    return {
      items: listed.items,
      page: listed.page,
      pageSize: listed.pageSize,
      totalItems: listed.total,
      totalPages: Math.ceil(listed.total / listed.pageSize),
      hasMore: listed.total > listed.page * listed.pageSize,
    };
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Read authorized document metadata without exposing its contents' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    const artifact = await this.documents.artifactForSourceAuthorization(
      this.principal(request),
      parseId(id),
    );
    await this.requireSourceAccess(this.principal(request), artifact);
    return artifact;
  }

  @Get('documents/:id/download')
  @ApiOperation({ summary: 'Download an authorized immutable PDF after integrity verification' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Res() response: FastifyReply,
  ) {
    const principal = this.principal(request);
    const artifact = await this.documents.artifactForSourceAuthorization(principal, parseId(id));
    await this.requireSourceAccess(principal, artifact);
    const file = await this.documents.download(
      principal,
      artifact.id,
      requestContext(request),
      auditContext(request),
    );
    sendPdf(response, file.fileName, file.bytes);
  }

  @Get('document-templates')
  @ApiOperation({ summary: 'List the latest organization-scoped document templates' })
  @ApiQuery({ name: 'organizationId', required: true, format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async templates(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = documentTemplateQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return {
      items: await this.documents.templates(this.principal(request), parsed.data.organizationId),
    };
  }

  @Put('document-templates/:type')
  @ApiOperation({ summary: 'Save a new version of an organization-scoped document template' })
  @ApiParam({
    name: 'type',
    enum: [
      'service_evidence',
      'service_agreement',
      'invoice',
      'invoice_correction',
      'benefit_overview',
      'claim_summary',
    ],
  })
  @ApiQuery({ name: 'organizationId', required: true, format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async saveTemplate(
    @Req() request: ApiRequest,
    @Param('type') type: string,
    @Query() query: Record<string, string | undefined>,
    @Body() body: unknown,
  ) {
    const typeResult = documentTemplateTypeSchema.safeParse(type);
    const queryResult = documentTemplateQuerySchema.safeParse(query);
    const bodyResult = documentTemplateInputSchema.safeParse(body);
    if (!typeResult.success || !queryResult.success || !bodyResult.success) {
      throw new BadRequestException();
    }
    return this.documents.saveTemplate(
      this.principal(request),
      queryResult.data.organizationId,
      typeResult.data,
      withoutUndefined(bodyResult.data),
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('document-templates/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 512 * 1024, files: 1 } }))
  @ApiOperation({ summary: 'Upload a bounded private PNG or JPEG organization logo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['organizationId', 'file'],
      properties: {
        organizationId: { type: 'string', format: 'uuid' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async uploadLogo(
    @Req() request: ApiRequest,
    @Body() body: unknown,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    const parsed = documentLogoUploadSchema.safeParse(body);
    if (!parsed.success || !file?.buffer?.byteLength) throw new BadRequestException();
    return this.documents.uploadLogo(
      this.principal(request),
      parsed.data.organizationId,
      file.buffer,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('billing/exports/invoices')
  @ApiOperation({
    summary: 'Export bounded billing invoices as the documented billing_invoices_v1 CSV',
  })
  @ApiProduces('text/csv')
  async exportInvoices(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
    @Res() response: FastifyReply,
  ) {
    const parsed = billingExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { bom, ...filters } = parsed.data;
    const rows = await this.billing.exportInvoices(
      this.principal(request),
      withoutUndefined(filters),
    );
    const csv = encodeCsv(
      DOCUMENT_EXPORT_SCHEMAS.billing_invoices_v1,
      rows.map((invoice) => [
        invoice.invoiceNumber,
        invoice.issueDate,
        invoice.clientId,
        invoice.recipientName ?? invoice.clientName,
        invoice.servicePeriodFrom,
        invoice.servicePeriodUntil,
        csvNumber(centsDecimal(invoice.grandTotalCents)),
        csvNumber(centsDecimal(invoice.taxTotalCents)),
        invoice.currency,
        invoice.dueDate,
        invoice.status === 'issued' ? (invoice.receivableStatus ?? 'unpaid') : invoice.status,
        invoice.outstandingCents === null
          ? null
          : csvNumber(centsDecimal(invoice.outstandingCents)),
      ]),
      { bom: bom === true },
    );
    await this.documents.recordExport(
      this.principal(request),
      {
        organizationId: filters.organizationId,
        type: 'billing',
        exportType: 'billing_invoices_v1',
        rowCount: rows.length,
      },
      requestContext(request),
      auditContext(request),
    );
    sendCsv(response, `billing_invoices_v1_${filters.from}_${filters.until}.csv`, csv);
  }

  @Get('billing/exports/invoice-lines')
  @ApiOperation({
    summary: 'Export immutable invoice line snapshots as the documented billing_lines_v1 CSV',
  })
  @ApiProduces('text/csv')
  async exportInvoiceLines(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
    @Res() response: FastifyReply,
  ) {
    const parsed = billingExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { bom, ...filters } = parsed.data;
    const rows = await this.billing.exportInvoiceLines(
      this.principal(request),
      withoutUndefined(filters),
    );
    const csv = encodeCsv(
      DOCUMENT_EXPORT_SCHEMAS.billing_lines_v1,
      rows.map(({ invoice, line }) => [
        invoice.invoiceNumber,
        line.id,
        line.serviceDate,
        line.serviceCodeSnapshot,
        line.serviceNameSnapshot,
        csvNumber(line.quantity),
        line.unit,
        csvNumber(centsDecimal(line.unitPriceCents)),
        csvNumber(centsDecimal(line.grossCents)),
        line.fundingLabelSnapshot ?? line.sourceKey,
        snapshotString(invoice.recipientSnapshot, 'payerReference'),
      ]),
      { bom: bom === true },
    );
    await this.documents.recordExport(
      this.principal(request),
      {
        organizationId: filters.organizationId,
        type: 'billing',
        exportType: 'billing_lines_v1',
        rowCount: rows.length,
      },
      requestContext(request),
      auditContext(request),
    );
    sendCsv(response, `billing_lines_v1_${filters.from}_${filters.until}.csv`, csv);
  }

  @Get('billing/exports/receivables')
  @ApiOperation({
    summary: 'Export issued receivables and allocated payment totals as billing_receivables_v1 CSV',
  })
  @ApiProduces('text/csv')
  async exportReceivables(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
    @Res() response: FastifyReply,
  ) {
    const parsed = billingExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { bom, ...filters } = parsed.data;
    const rows = await this.billing.exportReceivables(
      this.principal(request),
      withoutUndefined(filters),
    );
    const csv = encodeCsv(
      DOCUMENT_EXPORT_SCHEMAS.billing_receivables_v1,
      rows.map((invoice) => [
        invoice.invoiceNumber,
        invoice.issueDate,
        invoice.clientId,
        invoice.recipientName ?? invoice.clientName,
        csvNumber(centsDecimal(invoice.grandTotalCents)),
        csvNumber(
          centsDecimal(
            invoice.paymentHistory
              .filter((payment) => payment.reversedAt === null)
              .reduce((sum, payment) => sum + payment.amountCents, 0),
          ),
        ),
        invoice.outstandingCents === null
          ? null
          : csvNumber(centsDecimal(invoice.outstandingCents)),
        invoice.dueDate,
        invoice.receivableStatus ?? 'unpaid',
        invoice.currency,
      ]),
      { bom: bom === true },
    );
    await this.documents.recordExport(
      this.principal(request),
      {
        organizationId: filters.organizationId,
        type: 'billing',
        exportType: 'billing_receivables_v1',
        rowCount: rows.length,
      },
      requestContext(request),
      auditContext(request),
    );
    sendCsv(response, `billing_receivables_v1_${filters.from}_${filters.until}.csv`, csv);
  }

  @Get('benefits/exports/allocations')
  @ApiOperation({
    summary: 'Export provider-side benefit allocations as benefit_allocations_v1 CSV',
  })
  @ApiProduces('text/csv')
  async exportBenefitAllocations(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
    @Res() response: FastifyReply,
  ) {
    const parsed = benefitAllocationExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { bom, ...filters } = parsed.data;
    const rows = await this.benefits.exportAllocations(
      this.principal(request),
      withoutUndefined(filters),
    );
    const invoiceReferences = await this.billing.invoiceReferencesForAllocations(
      this.principal(request),
      rows.map((row) => row.allocationId),
    );
    const csv = encodeCsv(
      DOCUMENT_EXPORT_SCHEMAS.benefit_allocations_v1,
      rows.map((row) => [
        row.clientId,
        row.benefitType,
        row.fundingSourceId,
        row.fundingSourceType,
        row.fundingSourceLabel,
        row.serviceDate,
        row.performedServiceId,
        csvNumber(centsDecimal(row.amountCents)),
        row.verificationStatus,
        invoiceReferences.get(row.allocationId) ?? null,
      ]),
      { bom: bom === true },
    );
    await this.documents.recordExport(
      this.principal(request),
      {
        organizationId: filters.organizationId,
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        type: 'benefits',
        exportType: 'benefit_allocations_v1',
        rowCount: rows.length,
      },
      requestContext(request),
      auditContext(request),
    );
    sendCsv(response, `benefit_allocations_v1_${filters.from}_${filters.until}.csv`, csv);
  }

  @Post('documents/generate')
  @ApiOperation({ summary: 'Generate a persisted PDF from an authorized typed business source' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async generate(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = documentGenerationCommandSchema.safeParse(body);
    if (!parsed.success || parsed.data.preview || !parsed.data.idempotencyKey) {
      throw new BadRequestException();
    }
    return this.generateCommand(this.principal(request), parsed.data, request, false);
  }

  @Post('documents/preview')
  @ApiOperation({ summary: 'Render a source-authorized PDF preview without storing an artifact' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiProduces('application/pdf')
  async preview(@Req() request: ApiRequest, @Body() body: unknown, @Res() response: FastifyReply) {
    const parsed = documentGenerationCommandSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.generateCommand(this.principal(request), parsed.data, request, true);
    if (!(result instanceof Uint8Array)) throw new DocumentGenerationFailedError();
    sendPdf(response, `preview-${parsed.data.sourceType}.pdf`, result);
  }

  private async generateCommand(
    principal: AuthorizationPrincipal,
    command: DocumentGenerationCommand,
    request: ApiRequest,
    preview: boolean,
  ) {
    try {
      switch (command.sourceType) {
        case 'evidence_package':
          return await this.generateEvidencePackage(principal, command, request, preview);
        case 'evidence_period':
          return await this.generateEvidencePeriod(principal, command, request, preview);
        case 'service_agreement':
          return await this.generateAgreement(principal, command, request, preview);
        case 'benefit_overview':
          return await this.generateBenefitOverview(principal, command, request, preview);
      }
    } catch (error) {
      if (error instanceof DocumentGenerationFailedError) {
        apiMetrics.recordDocumentGenerationFailure(
          command.sourceType,
          preview ? 'preview' : 'generate',
        );
      }
      throw error;
    }
  }

  private async generateEvidencePackage(
    principal: AuthorizationPrincipal,
    command: Extract<DocumentGenerationCommand, { sourceType: 'evidence_package' }>,
    request: ApiRequest,
    preview: boolean,
  ) {
    const source = await this.evidence.getPackage(principal, command.evidencePackageId);
    const visit = await this.scheduling.get(principal, source.snapshot.visitId);
    const client = await this.clients.get(principal, source.snapshot.clientId);
    const addresses = await this.clientMasterData.listAddresses(principal, client.id);
    const config = await this.documents.renderingConfiguration(
      principal.tenantId,
      visit.visit.organizationId,
      'service_evidence',
    );
    const locale = command.locale ?? config.template.defaultLocale;
    const provider = await this.provider(principal, visit.visit.organizationId, config.template);
    const recipient = clientRecipient(
      client,
      primaryAddress(addresses, localDate(source.snapshot.actualStart, source.snapshot.timezone)),
    );
    const acknowledgements = await this.documentAcknowledgements(principal, source);
    const rows = source.snapshot.items.map((item) => [
      formatInZone(source.snapshot.actualStart, source.snapshot.timezone, locale),
      `${item.serviceCode} ${item.serviceName}`.trim(),
      `${item.actualQuantity ?? '—'} ${unitLabel(item.unit, locale)}`,
      outcomeLabel(item.outcome, locale),
      item.reasonCode ?? '',
    ]);
    const payload: DocumentPayload = {
      documentType: 'service_evidence',
      locale,
      title: locale === 'de' ? 'Leistungsnachweis' : 'Service evidence',
      subtitle: source.isCurrent
        ? null
        : locale === 'de'
          ? 'Historischer Nachweis'
          : 'Historical evidence',
      provider,
      recipient,
      metadata: [
        {
          label: locale === 'de' ? 'Einsatzdatum' : 'Service date',
          value: formatInZone(source.snapshot.actualStart, source.snapshot.timezone, locale),
        },
        {
          label: locale === 'de' ? 'Paketversion' : 'Package version',
          value: String(source.version),
        },
        { label: locale === 'de' ? 'Status' : 'Status', value: evidenceStatus(source, locale) },
      ],
      sections: [
        {
          title: locale === 'de' ? 'Erbrachte Leistungen' : 'Performed services',
          columns: [
            locale === 'de' ? 'Datum' : 'Date',
            locale === 'de' ? 'Leistung' : 'Service',
            locale === 'de' ? 'Menge' : 'Quantity',
            locale === 'de' ? 'Ergebnis' : 'Outcome',
            locale === 'de' ? 'Hinweis' : 'Note',
          ],
          rows,
        },
      ],
      acknowledgements,
      notices: source.isCurrent
        ? []
        : [
            locale === 'de'
              ? 'Dieser Nachweis bezieht sich auf ein historisches Leistungspaket. Die Bestätigung bleibt mit dessen Version verknüpft.'
              : 'This evidence refers to a historical service package. Any acknowledgement remains linked to that package version.',
          ],
    };
    const sourceVersion = digest({ package: source, acknowledgements });
    return this.deliver(principal, command, request, preview, {
      organizationId: visit.visit.organizationId,
      facilityId: visit.visit.facilityId,
      clientId: client.id,
      documentType: 'service_evidence',
      sourceEntityType: 'evidence_package',
      sourceEntityId: source.id,
      sourceVersion,
      configTemplateVersion: config.template.version,
      payload,
    });
  }

  private async generateEvidencePeriod(
    principal: AuthorizationPrincipal,
    command: Extract<DocumentGenerationCommand, { sourceType: 'evidence_period' }>,
    request: ApiRequest,
    preview: boolean,
  ) {
    if (principal.roles?.includes('Caregiver')) throw new DocumentAccessDeniedError();
    const client = await this.clients.get(principal, command.clientId);
    if (client.organizationId !== command.organizationId) throw new DocumentSourceNotFoundError();
    const from = new Date(`${command.from}T00:00:00.000Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    const until = new Date(`${command.until}T23:59:59.999Z`);
    until.setUTCDate(until.getUTCDate() + 1);
    const worklist = await this.evidence.worklist(principal, {
      from,
      until,
      page: 1,
      pageSize: 100,
      clientId: client.id,
      organizationId: command.organizationId,
      ...(command.facilityId ? { facilityId: command.facilityId } : {}),
    });
    if (worklist.total > 100) throw new DocumentSourceNotReadyError();
    const packageRows = await Promise.all(
      worklist.items
        .filter((item) => item.evidencePackageId !== null)
        .map(async (item) => {
          const source = await this.evidence.getPackage(principal, item.evidencePackageId!);
          const serviceDate = localDate(source.snapshot.actualStart, source.snapshot.timezone);
          return serviceDate >= command.from && serviceDate <= command.until
            ? { source, serviceDate }
            : null;
        }),
    );
    const packages = packageRows.filter((item): item is NonNullable<typeof item> => item !== null);
    const config = await this.documents.renderingConfiguration(
      principal.tenantId,
      command.organizationId,
      'service_evidence',
    );
    const locale = command.locale ?? config.template.defaultLocale;
    const provider = await this.provider(principal, command.organizationId, config.template);
    const recipient = clientRecipient(
      client,
      primaryAddress(
        await this.clientMasterData.listAddresses(principal, client.id),
        command.until,
      ),
    );
    const grouped = new Map<
      string,
      Array<{
        source: Awaited<ReturnType<ServiceEvidenceApplicationService['getPackage']>>;
        date: string;
      }>
    >();
    const acknowledgements: DocumentAcknowledgement[] = [];
    const allQuantities = new Map<string, string[]>();
    for (const item of packages) {
      const rows = grouped.get(item.serviceDate) ?? [];
      rows.push({ source: item.source, date: item.serviceDate });
      grouped.set(item.serviceDate, rows);
      // oxlint-disable-next-line no-await-in-loop -- Preserve sequential transaction and side-effect ordering.
      acknowledgements.push(...(await this.documentAcknowledgements(principal, item.source)));
      for (const service of item.source.snapshot.items) {
        if (service.actualQuantity === null) continue;
        const values = allQuantities.get(service.unit) ?? [];
        values.push(service.actualQuantity);
        allQuantities.set(service.unit, values);
      }
    }
    const sections = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([serviceDate, dayPackages]) => ({
        title: formatDate(serviceDate, locale),
        columns: [
          locale === 'de' ? 'Leistung' : 'Service',
          locale === 'de' ? 'Menge' : 'Quantity',
          locale === 'de' ? 'Ergebnis' : 'Outcome',
          locale === 'de' ? 'Bestätigung' : 'Acknowledgement',
        ],
        rows: dayPackages.flatMap(({ source }) =>
          source.snapshot.items.map((service) => [
            `${service.serviceCode} ${service.serviceName}`.trim(),
            `${service.actualQuantity ?? '—'} ${unitLabel(service.unit, locale)}`,
            outcomeLabel(service.outcome, locale),
            evidenceStatus(source, locale),
          ]),
        ),
      }));
    sections.push({
      title: locale === 'de' ? 'Mengenübersicht' : 'Quantity summary',
      columns: [
        locale === 'de' ? 'Einheit' : 'Unit',
        locale === 'de' ? 'Gesamtmenge' : 'Total quantity',
      ],
      rows: [...allQuantities.entries()].map(([unit, values]) => [
        unitLabel(unit, locale),
        sumDecimals(values),
      ]),
    });
    const payload: DocumentPayload = {
      documentType: 'service_evidence',
      locale,
      title: locale === 'de' ? 'Leistungsnachweis' : 'Service evidence',
      subtitle: locale === 'de' ? 'Zusammenstellung' : 'Consolidated report',
      provider,
      recipient,
      metadata: [
        {
          label: locale === 'de' ? 'Leistungszeitraum' : 'Service period',
          value: `${formatDate(command.from, locale)} – ${formatDate(command.until, locale)}`,
        },
        {
          label: locale === 'de' ? 'Leistungspakete' : 'Evidence packages',
          value: String(packages.length),
        },
      ],
      sections,
      acknowledgements,
      notices: [
        locale === 'de'
          ? 'Diese Zusammenstellung ist nicht selbst unterschrieben. Bestätigungen beziehen sich ausschließlich auf die jeweils aufgeführten Einzelnachweise.'
          : 'This consolidated report is not separately signed. Acknowledgements apply only to the individual evidence packages shown.',
      ],
    };
    const sourceVersion = `period:${command.from}:${command.until}:${digest(packages.map(({ source }) => source))}`;
    return this.deliver(principal, command, request, preview, {
      organizationId: command.organizationId,
      facilityId: command.facilityId ?? null,
      clientId: client.id,
      documentType: 'service_evidence',
      sourceEntityType: 'evidence_period',
      sourceEntityId: client.id,
      sourceVersion,
      configTemplateVersion: config.template.version,
      payload,
    });
  }

  private async generateAgreement(
    principal: AuthorizationPrincipal,
    command: Extract<DocumentGenerationCommand, { sourceType: 'service_agreement' }>,
    request: ApiRequest,
    preview: boolean,
  ) {
    if (principal.roles?.includes('Caregiver')) throw new DocumentAccessDeniedError();
    const agreement = await this.agreements.get(principal, command.agreementId);
    const services = await this.agreements.listServices(principal, agreement.id);
    const client = await this.clients.get(principal, agreement.clientId);
    const addresses = await this.clientMasterData.listAddresses(principal, client.id);
    const config = await this.documents.renderingConfiguration(
      principal.tenantId,
      agreement.organizationId,
      'service_agreement',
    );
    const locale = command.locale ?? config.template.defaultLocale;
    const provider = await this.provider(principal, agreement.organizationId, config.template);
    const recipient = clientRecipient(client, primaryAddress(addresses, agreement.validFrom));
    const payload: DocumentPayload = {
      documentType: 'service_agreement',
      locale,
      title: locale === 'de' ? 'Leistungsvereinbarung' : 'Service agreement',
      subtitle: agreement.status === 'draft' ? (locale === 'de' ? 'Entwurf' : 'Draft') : null,
      provider,
      recipient,
      metadata: [
        {
          label: locale === 'de' ? 'Vereinbarungsnummer' : 'Agreement reference',
          value: agreement.reference ?? agreement.id,
        },
        {
          label: locale === 'de' ? 'Gültig ab' : 'Valid from',
          value: formatDate(agreement.validFrom, locale),
        },
        {
          label: locale === 'de' ? 'Gültig bis' : 'Valid until',
          value: agreement.validUntil
            ? formatDate(agreement.validUntil, locale)
            : locale === 'de'
              ? 'Unbefristet'
              : 'Open-ended',
        },
        { label: locale === 'de' ? 'Status' : 'Status', value: agreement.status },
      ],
      sections: [
        {
          title: locale === 'de' ? 'Vereinbarte Leistungen' : 'Agreed services',
          columns: [
            locale === 'de' ? 'Leistung' : 'Service',
            locale === 'de' ? 'Menge' : 'Quantity',
            locale === 'de' ? 'Häufigkeit' : 'Frequency',
            locale === 'de' ? 'Gültigkeitszeitraum' : 'Validity period',
            locale === 'de' ? 'Vereinbarte Details' : 'Agreed details',
          ],
          rows: services.map((service) => [
            `${service.serviceCode} ${service.serviceName}`.trim(),
            service.quantity
              ? `${service.quantity} ${unitLabel(service.serviceUnit, locale)}`
              : '—',
            scheduleLabel(service.scheduleRule, locale),
            [service.validFrom, service.validUntil]
              .filter(Boolean)
              .map((value) => formatDate(value!, locale))
              .join(' – ') || '—',
            service.note ?? '—',
          ]),
        },
        ...(agreement.description
          ? [
              {
                title: locale === 'de' ? 'Beschreibung' : 'Description',
                paragraphs: [agreement.description],
              },
            ]
          : []),
        ...(config.template.contractTermsText
          ? [
              {
                title: locale === 'de' ? 'Vertragsbedingungen' : 'Contract terms',
                paragraphs: config.template.contractTermsText.split(/\r?\n/),
              },
            ]
          : []),
      ],
      notices:
        agreement.status === 'draft'
          ? [
              locale === 'de'
                ? 'Entwurfsvorschau – noch keine aktive Vereinbarung.'
                : 'Draft preview — this agreement is not active yet.',
            ]
          : [],
    };
    if (agreement.status === 'draft' && !preview) throw new DocumentSourceNotReadyError();
    const sourceVersion = digest({ agreement, services, client, address: recipient.addressLines });
    return this.deliver(principal, command, request, preview, {
      organizationId: agreement.organizationId,
      facilityId: agreement.facilityId,
      clientId: client.id,
      documentType: 'service_agreement',
      sourceEntityType: 'service_agreement',
      sourceEntityId: agreement.id,
      sourceReference: agreement.reference,
      sourceVersion,
      configTemplateVersion: config.template.version,
      payload,
    });
  }

  private async generateBenefitOverview(
    principal: AuthorizationPrincipal,
    command: Extract<DocumentGenerationCommand, { sourceType: 'benefit_overview' }>,
    request: ApiRequest,
    preview: boolean,
  ) {
    if (principal.roles?.includes('Caregiver')) throw new DocumentAccessDeniedError();
    const asOf = command.asOf ?? new Date().toISOString().slice(0, 10);
    const [budget, client] = await Promise.all([
      this.benefits.getBudget(principal, command.clientId, asOf),
      this.clients.get(principal, command.clientId),
    ]);
    if (!client.organizationId) throw new DocumentSourceNotReadyError();
    const addresses = await this.clientMasterData.listAddresses(principal, client.id);
    const config = await this.documents.renderingConfiguration(
      principal.tenantId,
      client.organizationId,
      'benefit_overview',
    );
    const locale = command.locale ?? config.template.defaultLocale;
    const provider = await this.provider(principal, client.organizationId, config.template);
    const recipient = clientRecipient(client, primaryAddress(addresses, asOf));
    const budgets = budget.entitlementBudgets;
    const rows = budgets.map((entry) => [
      entry.benefitType,
      formatMoney(entry.currentAllocationCents, locale),
      formatMoney(entry.carryoverCents, locale),
      formatMoney(entry.actualConsumptionCents, locale),
      entry.estimatedRemainingCents === null
        ? '—'
        : formatMoney(entry.estimatedRemainingCents, locale),
      entry.confirmedRemainingCents === null
        ? '—'
        : formatMoney(entry.confirmedRemainingCents, locale),
      entry.verificationStatuses.join(', ') || '—',
      entry.nextExpiry ? formatDate(entry.nextExpiry, locale) : '—',
    ]);
    const payload: DocumentPayload = {
      documentType: 'benefit_overview',
      locale,
      title: locale === 'de' ? 'Budgetübersicht' : 'Budget overview',
      provider,
      recipient,
      metadata: [
        {
          label: locale === 'de' ? 'Berichtsstand' : 'Reporting date',
          value: formatDate(asOf, locale),
        },
        {
          label: locale === 'de' ? 'Leistungszeitraum' : 'Benefit period',
          value: budget.currentPeriod,
        },
        {
          label: locale === 'de' ? 'Pflegegrad' : 'Care grade',
          value: String(budget.careGrade ?? '—'),
        },
      ],
      sections: [
        {
          title: locale === 'de' ? 'Leistungsbudgets' : 'Benefit budgets',
          columns: [
            locale === 'de' ? 'Leistungsart' : 'Benefit type',
            locale === 'de' ? 'Monatlicher Anspruch' : 'Monthly entitlement',
            locale === 'de' ? 'Übertrag' : 'Carryover',
            locale === 'de' ? 'Erfasster Verbrauch' : 'Recorded consumption',
            locale === 'de' ? 'Geschätzt verbleibend' : 'Estimated remaining',
            locale === 'de' ? 'Bestätigt verbleibend' : 'Confirmed remaining',
            locale === 'de' ? 'Prüfstatus' : 'Verification status',
            locale === 'de' ? 'Nächster Ablauf' : 'Next expiry',
          ],
          rows,
        },
      ],
      notices: [
        locale === 'de'
          ? 'Diese Übersicht zeigt interne Aufzeichnungen des Anbieters. Beträge sind nicht durch die Pflegekasse bestätigt und garantieren keine Erstattung.'
          : 'This overview reflects provider records. Amounts are not confirmed by the payer and do not guarantee reimbursement.',
      ],
    };
    const sourceVersion = `${asOf}:${digest({ budget, client, address: recipient.addressLines })}`;
    return this.deliver(principal, command, request, preview, {
      organizationId: client.organizationId,
      facilityId: client.primaryFacilityId,
      clientId: client.id,
      documentType: 'benefit_overview',
      sourceEntityType: 'benefit_overview',
      sourceEntityId: client.id,
      sourceVersion,
      configTemplateVersion: config.template.version,
      payload,
    });
  }

  private async deliver(
    principal: AuthorizationPrincipal,
    command: DocumentGenerationCommand,
    request: ApiRequest,
    preview: boolean,
    input: {
      organizationId: string;
      facilityId: string | null;
      clientId: string | null;
      documentType: DocumentType;
      sourceEntityType: string;
      sourceEntityId: string;
      sourceReference?: string | null;
      sourceVersion: string;
      configTemplateVersion: number;
      payload: DocumentPayload;
    },
  ) {
    if (preview) {
      return this.documents.renderPreview(principal, {
        organizationId: input.organizationId,
        documentType: input.documentType,
        templateVersion: input.configTemplateVersion,
        payload: input.payload,
      });
    }
    if (!command.idempotencyKey) throw new BadRequestException();
    return this.documents.generate(
      principal,
      {
        idempotencyKey: command.idempotencyKey,
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        clientId: input.clientId,
        documentType: input.documentType,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        ...(input.sourceReference !== undefined ? { sourceReference: input.sourceReference } : {}),
        sourceVersion: input.sourceVersion,
        expectedTemplateVersion: input.configTemplateVersion,
        locale: input.payload.locale,
        payload: input.payload,
      },
      requestContext(request),
      auditContext(request),
    );
  }

  private async documentAcknowledgements(
    principal: AuthorizationPrincipal,
    evidencePackage: Awaited<ReturnType<ServiceEvidenceApplicationService['getPackage']>>,
  ): Promise<DocumentAcknowledgement[]> {
    if (evidencePackage.acknowledgements.length === 0) {
      return [
        {
          status: evidencePackage.isCurrent ? 'awaiting_acknowledgement' : 'outdated',
          evidencePackageVersion: evidencePackage.version,
          evidencePackageHash: evidencePackage.snapshotHash,
        },
      ];
    }
    return Promise.all(
      evidencePackage.acknowledgements.map(async (acknowledgement) => {
        let signatureStrokes: DocumentAcknowledgement['signatureStrokes'] = null;
        if (
          acknowledgement.status === 'acknowledged' &&
          acknowledgement.method === 'touch_signature' &&
          acknowledgement.signatureAvailable
        ) {
          try {
            signatureStrokes = (await this.evidence.getSignature(principal, acknowledgement.id))
              .strokes;
          } catch (error) {
            if (!(error instanceof AuthorizationDeniedError)) throw error;
          }
        }
        return {
          status: evidencePackage.isCurrent ? acknowledgement.status : 'outdated',
          evidencePackageVersion: evidencePackage.version,
          evidencePackageHash: acknowledgement.evidencePackageHash,
          signatoryName: acknowledgement.signatoryName,
          method: (acknowledgement.method as DocumentAcknowledgement['method']) ?? null,
          statementVersion: acknowledgement.statementVersion,
          statementText: acknowledgement.statementText,
          occurredAt: acknowledgement.acknowledgedAt ?? acknowledgement.declinedAt,
          declineReason: acknowledgement.declineReasonCode,
          declineNote: acknowledgement.declineNote,
          signatureStrokes,
        };
      }),
    );
  }

  private async provider(
    principal: AuthorizationPrincipal,
    organizationId: string,
    template: Awaited<
      ReturnType<DocumentsApplicationService['renderingConfiguration']>
    >['template'],
  ) {
    const organization = await this.organizations.getOrganization(principal, organizationId);
    return {
      name: organization.legalName?.trim() || organization.name,
      addressLines: (organization.address ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      phone: template.contactPhone ?? organization.phone,
      email: template.contactEmail ?? organization.email,
      website: template.contactWebsite,
    };
  }

  private async requireSourceAccess(
    principal: AuthorizationPrincipal,
    artifact: DocumentArtifactView,
  ): Promise<void> {
    switch (artifact.documentType) {
      case 'service_evidence':
        if (
          artifact.sourceEntityType === 'evidence_package' ||
          artifact.sourceEntityType === 'claim_evidence'
        ) {
          const source = await this.evidence.getPackage(principal, artifact.sourceEntityId);
          if (source.snapshot.clientId !== artifact.clientId)
            throw new DocumentArtifactNotFoundError();
          return;
        }
        if (artifact.sourceEntityType === 'evidence_period') {
          if (principal.roles?.includes('Caregiver')) throw new DocumentAccessDeniedError();
          const range = artifact.sourceVersion.split(':');
          const from = range[1];
          const until = range[2];
          if (!from || !until || !artifact.clientId) throw new DocumentArtifactNotFoundError();
          await this.clients.get(principal, artifact.clientId);
          await this.evidence.worklist(principal, {
            from: new Date(`${from}T00:00:00.000Z`),
            until: new Date(`${until}T23:59:59.999Z`),
            page: 1,
            pageSize: 100,
            clientId: artifact.clientId,
            organizationId: artifact.organizationId,
            ...(artifact.facilityId ? { facilityId: artifact.facilityId } : {}),
          });
          return;
        }
        throw new DocumentArtifactNotFoundError();
      case 'service_agreement': {
        if (principal.roles?.includes('Caregiver')) throw new DocumentAccessDeniedError();
        const source = await this.agreements.get(principal, artifact.sourceEntityId);
        if (
          source.clientId !== artifact.clientId ||
          source.organizationId !== artifact.organizationId ||
          source.facilityId !== artifact.facilityId
        )
          throw new DocumentArtifactNotFoundError();
        return;
      }
      case 'benefit_overview':
        if (principal.roles?.includes('Caregiver') || !artifact.clientId)
          throw new DocumentAccessDeniedError();
        await this.benefits.getBudget(
          principal,
          artifact.clientId,
          artifact.sourceVersion.slice(0, 10),
        );
        return;
      case 'claim_summary': {
        const source = await this.claims.getClaim(principal, artifact.sourceEntityId);
        if (
          source.claim.clientId !== artifact.clientId ||
          source.claim.organizationId !== artifact.organizationId ||
          source.claim.facilityId !== artifact.facilityId
        )
          throw new DocumentArtifactNotFoundError();
        return;
      }
      case 'invoice':
      case 'invoice_correction': {
        const source = await this.billing.getInvoice(principal, artifact.sourceEntityId);
        if (
          source.clientId !== artifact.clientId ||
          source.organizationId !== artifact.organizationId ||
          source.facilityId !== artifact.facilityId
        )
          throw new DocumentArtifactNotFoundError();
        return;
      }
      default:
        throw new DocumentArtifactNotFoundError();
    }
  }

  private principal(request: ApiRequest): AuthorizationPrincipal {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function clientRecipient(
  client: Awaited<ReturnType<ClientApplicationService['get']>>,
  address?: {
    street: string;
    houseNumber: string | null;
    addressAddition: string | null;
    postalCode: string | null;
    city: string;
    countryCode: string;
  },
): NonNullable<DocumentPayload['recipient']> {
  const addressLines = address
    ? [
        `${address.street} ${address.houseNumber ?? ''}`.trim(),
        address.addressAddition,
        `${address.postalCode ?? ''} ${address.city}`.trim(),
        address.countryCode === 'DE' ? null : address.countryCode,
      ].filter((line): line is string => Boolean(line))
    : [];
  return { name: displayClientName(client), addressLines, reference: client.id };
}

function primaryAddress<
  T extends { isPrimary: boolean; validFrom: string | null; validUntil: string | null },
>(addresses: T[], asOf: string): T | undefined {
  return [...addresses]
    .filter(
      (address) =>
        (!address.validFrom || address.validFrom <= asOf) &&
        (!address.validUntil || address.validUntil >= asOf),
    )
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))[0];
}

function localDate(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatInZone(instant: string, timezone: string, locale: DocumentLocale): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}

function formatDate(date: string, locale: DocumentLocale): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 10)}T00:00:00.000Z`));
}

function unitLabel(unit: string, locale: DocumentLocale): string {
  const labels: Record<string, [string, string]> = {
    occurrence: ['Einsatz', 'visit'],
    minute: ['Min.', 'min'],
    hour: ['Std.', 'h'],
    day: ['Tag', 'day'],
  };
  return labels[unit]?.[locale === 'de' ? 0 : 1] ?? unit;
}

function outcomeLabel(outcome: string, locale: DocumentLocale): string {
  const labels: Record<string, [string, string]> = {
    performed: ['erbracht', 'performed'],
    partially_performed: ['teilweise erbracht', 'partially performed'],
    not_performed: ['nicht erbracht', 'not performed'],
  };
  return labels[outcome]?.[locale === 'de' ? 0 : 1] ?? outcome;
}

function evidenceStatus(
  source: Awaited<ReturnType<ServiceEvidenceApplicationService['getPackage']>>,
  locale: DocumentLocale,
): string {
  const status = source.isCurrent ? source.status : 'outdated';
  const labels: Record<string, [string, string]> = {
    ready: ['ausstehende Bestätigung', 'awaiting acknowledgement'],
    acknowledged: ['bestätigt', 'acknowledged'],
    declined: ['abgelehnt', 'declined'],
    revoked: ['widerrufen', 'revoked'],
    outdated: ['historisch / überholt', 'historical / outdated'],
  };
  return labels[status]?.[locale === 'de' ? 0 : 1] ?? status;
}

function scheduleLabel(
  rule: { type: string; weekdays?: string[]; count?: number; intervalDays?: number } | null,
  locale: DocumentLocale,
): string {
  if (!rule) return '—';
  if (rule.type === 'daily') return locale === 'de' ? 'täglich' : 'daily';
  if (rule.type === 'weekly')
    return `${locale === 'de' ? 'wöchentlich' : 'weekly'}: ${(rule.weekdays ?? []).join(', ')}`;
  if (rule.type === 'occurrences_per_week')
    return `${rule.count ?? 0} ${locale === 'de' ? 'Einsätze/Woche' : 'visits/week'}`;
  if (rule.type === 'interval_days')
    return `${locale === 'de' ? 'alle' : 'every'} ${rule.intervalDays ?? 0} ${locale === 'de' ? 'Tage' : 'days'}`;
  return locale === 'de' ? 'bei Bedarf' : 'on demand';
}

function formatMoney(cents: number, locale: DocumentLocale): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

function sumDecimals(values: readonly string[]): string {
  const parts = values.map((value) => value.split('.'));
  const scale = Math.max(0, ...parts.map(([, fraction = '']) => fraction.length));
  const divisor = 10n ** BigInt(scale);
  const sum = parts.reduce((total, [whole = '0', fraction = '']) => {
    const normalized = fraction.padEnd(scale, '0');
    return total + BigInt(whole) * divisor + BigInt(normalized || '0');
  }, 0n);
  const whole = sum / divisor;
  if (scale === 0) return whole.toString();
  const fraction = (sum % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function centsDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function snapshotString(snapshot: Record<string, unknown> | null, key: string): string | null {
  const value = snapshot?.[key];
  return typeof value === 'string' ? value : null;
}

function parseId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException();
  }
  return value;
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}

function sendPdf(response: FastifyReply, fileName: string, bytes: Uint8Array): void {
  response
    .code(200)
    .type('application/pdf')
    .header('Content-Disposition', `attachment; filename="${fileName.replace(/[\r\n"\\]/g, '_')}"`)
    .header('Cache-Control', 'private, no-store')
    .send(Buffer.from(bytes));
}

function sendCsv(response: FastifyReply, fileName: string, csv: string): void {
  response
    .code(200)
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${fileName}"`)
    .header('Cache-Control', 'private, no-store')
    .send(Buffer.from(csv, 'utf8'));
}
