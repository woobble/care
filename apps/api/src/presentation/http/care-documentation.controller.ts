import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CareDocumentationApplicationService,
  AmendmentReasonRequiredError,
  InvalidDocumentationEntryError,
  InvalidServiceEvidenceError,
  type AddDocumentationAmendmentInput,
  type AddDocumentationEntryInput,
  type DocumentationWorklistQuery,
  type RecordServiceEvidenceInput,
  type UpdateDocumentationEntryInput,
} from '@care/care-documentation';
import { CARE_DOCUMENTATION_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import type { ApiRequest } from '../../http/request';
import { requestContext } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  addDocumentationAmendmentSchema,
  addDocumentationEntrySchema,
  AddDocumentationAmendmentRequestDto,
  AddDocumentationEntryRequestDto,
  CareDocumentationDetailDto,
  DocumentationWorklistDto,
  documentationWorklistQuerySchema,
  finalizeDocumentationSchema,
  FinalizeDocumentationRequestDto,
  recordServiceEvidenceSchema,
  RecordServiceEvidenceRequestDto,
  updateDocumentationEntrySchema,
  UpdateDocumentationEntryRequestDto,
} from './care-documentation.dto';
import { z } from 'zod';

const removeEntrySchema = z.object({ expectedVersion: z.number().int().positive() });

@ApiTags('care documentation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class CareDocumentationController {
  constructor(
    @Inject(CARE_DOCUMENTATION_APPLICATION)
    private readonly documentation: CareDocumentationApplicationService,
  ) {}

  @Get('visits/:visitId/documentation')
  @ApiOperation({ summary: 'Read documentation, evidence, history, and completeness for a visit' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  getForVisit(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.documentation.getForVisit(this.principal(request), parseId(visitId));
  }

  @Post('visits/:visitId/documentation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create an idempotent documentation draft for an executed visit' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  createForVisit(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.documentation.createForVisit(
      this.principal(request),
      parseId(visitId),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('care-documentation')
  @ApiOperation({ summary: 'List scoped visit documentation and incomplete evidence' })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({ name: 'clientQuery', required: false, description: 'Client name metadata filter' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'finalized', 'missing'] })
  @ApiQuery({ name: 'incomplete', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: DocumentationWorklistDto })
  async worklist(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = documentationWorklistQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.documentation.worklist(
      this.principal(request),
      parsed.data as DocumentationWorklistQuery,
    );
  }

  @Get('me/documentation')
  @ApiTags('caregiver')
  @ApiOperation({
    summary: 'List documentation status for visits related to the current caregiver',
  })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: DocumentationWorklistDto })
  async myWorklist(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = documentationWorklistQuerySchema
      .pick({ from: true, until: true, page: true, pageSize: true })
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.documentation.worklist(
      this.principal(request),
      { ...parsed.data, page: parsed.data.page, pageSize: parsed.data.pageSize },
      true,
    );
  }

  @Get('care-documentation/:id')
  @ApiOperation({ summary: 'Read documentation by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  getById(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.documentation.getById(this.principal(request), parseId(id));
  }

  @Post('care-documentation/:id/entries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a note, observation, deviation, or incident entry' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AddDocumentationEntryRequestDto })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  async addEntry(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = addDocumentationEntrySchema.safeParse(body);
    if (!parsed.success) throw new InvalidDocumentationEntryError();
    return this.documentation.addEntry(
      this.principal(request),
      parseId(id),
      parsed.data as AddDocumentationEntryInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('care-documentation/:id/entries/:entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a draft documentation entry' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiBody({ type: UpdateDocumentationEntryRequestDto })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  async updateEntry(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateDocumentationEntrySchema.safeParse(body);
    if (!parsed.success) throw new InvalidDocumentationEntryError();
    return this.documentation.updateEntry(
      this.principal(request),
      parseId(id),
      parseId(entryId),
      parsed.data as UpdateDocumentationEntryInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Delete('care-documentation/:id/entries/:entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a draft documentation entry' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  async removeEntry(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
  ) {
    const parsed = removeEntrySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.documentation.removeEntry(
      this.principal(request),
      parseId(id),
      parseId(entryId),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Put('care-documentation/:id/evidence/:performedServiceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record or update evidence for a performed service' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'performedServiceId', format: 'uuid' })
  @ApiBody({ type: RecordServiceEvidenceRequestDto })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  async recordEvidence(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('performedServiceId') performedServiceId: string,
    @Body() body: unknown,
  ) {
    const parsed = recordServiceEvidenceSchema.safeParse(body);
    if (!parsed.success) throw new InvalidServiceEvidenceError();
    return this.documentation.recordEvidence(
      this.principal(request),
      parseId(id),
      parseId(performedServiceId),
      parsed.data as RecordServiceEvidenceInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('care-documentation/:id/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalize complete documentation for a completed execution' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: FinalizeDocumentationRequestDto })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  async finalize(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = finalizeDocumentationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.documentation.finalize(
      this.principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('care-documentation/:id/amendments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Append an explicit correction to finalized documentation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AddDocumentationAmendmentRequestDto })
  @ApiOkResponse({ type: CareDocumentationDetailDto })
  async amend(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = addDocumentationAmendmentSchema.safeParse(body);
    if (!parsed.success) throw new AmendmentReasonRequiredError();
    return this.documentation.amend(
      this.principal(request),
      parseId(id),
      parsed.data as AddDocumentationAmendmentInput,
      requestContext(request),
      auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function parseId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException();
  }
  return value;
}

function auditContext(request: ApiRequest) {
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(request.headers['user-agent'] ? { userAgent: String(request.headers['user-agent']) } : {}),
  };
}
