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
import type {
  AssessmentInput,
  MeasurementInput,
  RiskAssessmentInput,
  StructuredObservationInput,
} from '@care/clinical-documentation';
import {
  ASSESSMENT_TYPES,
  MEASUREMENT_TYPES,
  OBSERVATION_CATEGORIES,
  RISK_TYPES,
} from '@care/clinical-documentation';
import {
  AssessmentInvalidError,
  CareDocumentationApplicationService,
  ClinicalHistoryInvalidQueryError,
  ClinicalRecordInvalidError,
  MeasurementInvalidError,
  ObservationInvalidError,
  RiskAssessmentInvalidError,
  type ClinicalHistoryQuery,
} from '@care/care-documentation';
import { CARE_DOCUMENTATION_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import type { ApiRequest } from '../../http/request';
import { requestContext } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  AddAssessmentRequestDto,
  AddMeasurementRequestDto,
  AddObservationRequestDto,
  AddRiskAssessmentRequestDto,
  AmendClinicalRecordRequestDto,
  ClinicalDocumentationDetailDto,
  ClinicalRecordHistoryPageDto,
  DeleteClinicalRecordRequestDto,
  UpdateAssessmentRequestDto,
  UpdateMeasurementRequestDto,
  UpdateObservationRequestDto,
  UpdateRiskAssessmentRequestDto,
  addAssessmentSchema,
  addMeasurementSchema,
  addObservationSchema,
  addRiskAssessmentSchema,
  amendClinicalRecordSchema,
  assessmentHistorySchema,
  deleteClinicalRecordSchema,
  measurementHistorySchema,
  observationHistorySchema,
  riskHistorySchema,
  updateAssessmentSchema,
  updateMeasurementSchema,
  updateObservationSchema,
  updateRiskAssessmentSchema,
} from './clinical-documentation.dto';
import type { ClinicalRecordReplacementInput } from '@care/care-documentation';

@ApiTags('clinical documentation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class ClinicalDocumentationController {
  constructor(
    @Inject(CARE_DOCUMENTATION_APPLICATION)
    private readonly documentation: CareDocumentationApplicationService,
  ) {}

  @Get('care-documentation/:id/clinical-records')
  @ApiOperation({ summary: 'Read structured clinical records for care documentation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  getRecords(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.documentation.getClinicalRecords(this.principal(request), parseId(id));
  }

  @Post('care-documentation/:id/measurements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a measurement in draft care documentation' })
  @ApiBody({ type: AddMeasurementRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async addMeasurement(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = addMeasurementSchema.safeParse(body);
    if (!parsed.success) throw new MeasurementInvalidError();
    const { expectedVersion, ...input } = parsed.data;
    return this.documentation.addClinicalRecord(
      this.principal(request),
      parseId(id),
      'measurement',
      expectedVersion,
      input as MeasurementInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('care-documentation/:id/measurements/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a measurement in draft care documentation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiBody({ type: UpdateMeasurementRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async updateMeasurement(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateMeasurementSchema.safeParse(body);
    if (!parsed.success) throw new MeasurementInvalidError();
    const { expectedVersion, expectedRecordVersion, ...input } = parsed.data;
    return this.documentation.updateClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'measurement',
      expectedVersion,
      expectedRecordVersion,
      input as MeasurementInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Delete('care-documentation/:id/measurements/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a measurement from draft care documentation' })
  @ApiBody({ type: DeleteClinicalRecordRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  deleteMeasurement(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = deleteClinicalRecordSchema.safeParse(body);
    if (!parsed.success) throw new MeasurementInvalidError();
    return this.documentation.deleteClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'measurement',
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('care-documentation/:id/observations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a structured observation in draft care documentation' })
  @ApiBody({ type: AddObservationRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async addObservation(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = addObservationSchema.safeParse(body);
    if (!parsed.success) throw new ObservationInvalidError();
    const { expectedVersion, ...input } = parsed.data;
    return this.documentation.addClinicalRecord(
      this.principal(request),
      parseId(id),
      'observation',
      expectedVersion,
      input as StructuredObservationInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('care-documentation/:id/observations/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a structured observation in draft care documentation' })
  @ApiBody({ type: UpdateObservationRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async updateObservation(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateObservationSchema.safeParse(body);
    if (!parsed.success) throw new ObservationInvalidError();
    const { expectedVersion, expectedRecordVersion, ...input } = parsed.data;
    return this.documentation.updateClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'observation',
      expectedVersion,
      expectedRecordVersion,
      input as StructuredObservationInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Delete('care-documentation/:id/observations/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a structured observation from draft care documentation' })
  @ApiBody({ type: DeleteClinicalRecordRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  deleteObservation(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = deleteClinicalRecordSchema.safeParse(body);
    if (!parsed.success) throw new ObservationInvalidError();
    return this.documentation.deleteClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'observation',
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('care-documentation/:id/assessments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record an assessment in draft care documentation' })
  @ApiBody({ type: AddAssessmentRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async addAssessment(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = addAssessmentSchema.safeParse(body);
    if (!parsed.success) throw new AssessmentInvalidError();
    const { expectedVersion, ...input } = parsed.data;
    return this.documentation.addClinicalRecord(
      this.principal(request),
      parseId(id),
      'assessment',
      expectedVersion,
      input as AssessmentInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('care-documentation/:id/assessments/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an assessment in draft care documentation' })
  @ApiBody({ type: UpdateAssessmentRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async updateAssessment(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateAssessmentSchema.safeParse(body);
    if (!parsed.success) throw new AssessmentInvalidError();
    const { expectedVersion, expectedRecordVersion, ...input } = parsed.data;
    return this.documentation.updateClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'assessment',
      expectedVersion,
      expectedRecordVersion,
      input as AssessmentInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Delete('care-documentation/:id/assessments/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an assessment from draft care documentation' })
  @ApiBody({ type: DeleteClinicalRecordRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  deleteAssessment(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = deleteClinicalRecordSchema.safeParse(body);
    if (!parsed.success) throw new AssessmentInvalidError();
    return this.documentation.deleteClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'assessment',
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('care-documentation/:id/risks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a risk assessment in draft care documentation' })
  @ApiBody({ type: AddRiskAssessmentRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async addRiskAssessment(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = addRiskAssessmentSchema.safeParse(body);
    if (!parsed.success) throw new RiskAssessmentInvalidError();
    const { expectedVersion, ...input } = parsed.data;
    return this.documentation.addClinicalRecord(
      this.principal(request),
      parseId(id),
      'risk_assessment',
      expectedVersion,
      input as RiskAssessmentInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Patch('care-documentation/:id/risks/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a risk assessment in draft care documentation' })
  @ApiBody({ type: UpdateRiskAssessmentRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async updateRiskAssessment(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateRiskAssessmentSchema.safeParse(body);
    if (!parsed.success) throw new RiskAssessmentInvalidError();
    const { expectedVersion, expectedRecordVersion, ...input } = parsed.data;
    return this.documentation.updateClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'risk_assessment',
      expectedVersion,
      expectedRecordVersion,
      input as RiskAssessmentInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Delete('care-documentation/:id/risks/:recordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a risk assessment from draft care documentation' })
  @ApiBody({ type: DeleteClinicalRecordRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  deleteRiskAssessment(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = deleteClinicalRecordSchema.safeParse(body);
    if (!parsed.success) throw new RiskAssessmentInvalidError();
    return this.documentation.deleteClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      'risk_assessment',
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('care-documentation/:id/clinical-records/:recordId/amendments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Append a typed correction to a finalized clinical record' })
  @ApiBody({ type: AmendClinicalRecordRequestDto })
  @ApiOkResponse({ type: ClinicalDocumentationDetailDto })
  async amendRecord(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = amendClinicalRecordSchema.safeParse(body);
    if (!parsed.success) throw new ClinicalRecordInvalidError();
    return this.documentation.amendClinicalRecord(
      this.principal(request),
      parseId(id),
      parseId(recordId),
      {
        reason: parsed.data.reason,
        replacement: parsed.data.replacement as ClinicalRecordReplacementInput,
      },
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('clients/:clientId/measurements')
  @ApiOperation({ summary: 'Read scoped client measurement history' })
  @ApiQuery({ name: 'from', required: true, type: String, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, type: String, format: 'date-time' })
  @ApiQuery({ name: 'page', required: true, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: true, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'type', required: false, enum: MEASUREMENT_TYPES })
  @ApiOkResponse({ type: ClinicalRecordHistoryPageDto })
  async measurementHistory(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = measurementHistorySchema.safeParse(query);
    if (!parsed.success) throw new ClinicalHistoryInvalidQueryError();
    return this.documentation.clientClinicalHistory(
      this.principal(request),
      parseId(clientId),
      'measurement',
      parsed.data as ClinicalHistoryQuery,
    );
  }

  @Get('clients/:clientId/observations')
  @ApiOperation({ summary: 'Read scoped client observation history' })
  @ApiQuery({ name: 'from', required: true, type: String, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, type: String, format: 'date-time' })
  @ApiQuery({ name: 'page', required: true, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: true, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'category', required: false, enum: OBSERVATION_CATEGORIES })
  @ApiOkResponse({ type: ClinicalRecordHistoryPageDto })
  async observationHistory(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = observationHistorySchema.safeParse(query);
    if (!parsed.success) throw new ClinicalHistoryInvalidQueryError();
    return this.documentation.clientClinicalHistory(
      this.principal(request),
      parseId(clientId),
      'observation',
      parsed.data as ClinicalHistoryQuery,
    );
  }

  @Get('clients/:clientId/assessments')
  @ApiOperation({ summary: 'Read scoped client assessment history' })
  @ApiQuery({ name: 'from', required: true, type: String, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, type: String, format: 'date-time' })
  @ApiQuery({ name: 'page', required: true, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: true, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'type', required: false, enum: ASSESSMENT_TYPES })
  @ApiOkResponse({ type: ClinicalRecordHistoryPageDto })
  async assessmentHistory(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = assessmentHistorySchema.safeParse(query);
    if (!parsed.success) throw new ClinicalHistoryInvalidQueryError();
    return this.documentation.clientClinicalHistory(
      this.principal(request),
      parseId(clientId),
      'assessment',
      parsed.data as ClinicalHistoryQuery,
    );
  }

  @Get('clients/:clientId/risks')
  @ApiOperation({ summary: 'Read scoped client risk assessment history and current projection' })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    format: 'date-time',
    description: 'Required for history reads. Ignored when currentOnly=true.',
  })
  @ApiQuery({
    name: 'until',
    required: false,
    type: String,
    format: 'date-time',
    description: 'Required for history reads. Ignored when currentOnly=true.',
  })
  @ApiQuery({ name: 'page', required: true, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: true, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'riskType', required: false, enum: RISK_TYPES })
  @ApiQuery({ name: 'currentOnly', required: false, type: Boolean })
  @ApiOkResponse({ type: ClinicalRecordHistoryPageDto })
  async riskHistory(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = riskHistorySchema.safeParse(query);
    if (!parsed.success) throw new ClinicalHistoryInvalidQueryError();
    return this.documentation.clientClinicalHistory(
      this.principal(request),
      parseId(clientId),
      'risk_assessment',
      parsed.data as ClinicalHistoryQuery,
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
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
