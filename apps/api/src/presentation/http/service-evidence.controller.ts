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
  UnauthorizedException,
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

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { SERVICE_EVIDENCE_APPLICATION } from '@app/api/tokens';
import type { AuthorizationPrincipal } from '@care/permissions';
import {
  ServiceEvidenceApplicationService,
  type AcknowledgeEvidenceInput,
  type DeclineEvidenceInput,
  type ServiceEvidenceWorklistQuery,
} from '@care/service-evidence';

import { ProblemDetailsDto } from './dto';
import {
  acknowledgeEvidenceSchema,
  AcknowledgeEvidenceRequestDto,
  declineEvidenceSchema,
  DeclineEvidenceRequestDto,
  EvidencePackageResponseDto,
  EvidenceAcknowledgementDto,
  revokeAcknowledgementSchema,
  RevokeAcknowledgementRequestDto,
  ServiceEvidenceWorklistDto,
  serviceEvidenceWorklistQuerySchema,
  SignatureResponseDto,
} from './service-evidence.dto';

@ApiTags('service evidence and acknowledgements')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class ServiceEvidenceController {
  constructor(
    @Inject(SERVICE_EVIDENCE_APPLICATION)
    private readonly evidence: ServiceEvidenceApplicationService,
  ) {}

  @Get('visits/:visitId/evidence-package')
  @ApiOperation({ summary: 'Read the current service evidence package for a visit' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: EvidencePackageResponseDto })
  getForVisit(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.evidence.getForVisit(this.principal(request), parseId(visitId));
  }

  @Post('visits/:visitId/evidence-package')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create or return the deterministic package for finalized service evidence',
  })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: EvidencePackageResponseDto })
  prepareForVisit(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.evidence.prepare(
      this.principal(request),
      parseId(visitId),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('evidence-packages/:id')
  @ApiOperation({
    summary: 'Read an immutable service evidence package and its acknowledgement history',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EvidencePackageResponseDto })
  getPackage(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.evidence.getPackage(this.principal(request), parseId(id));
  }

  @Post('evidence-packages/:id/acknowledgement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capture a touch signature or typed acknowledgement for a package' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AcknowledgeEvidenceRequestDto })
  @ApiOkResponse({
    type: EvidenceAcknowledgementDto,
    description: 'Acknowledgement created or idempotently returned',
  })
  async acknowledge(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = acknowledgeEvidenceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.evidence.acknowledge(
      this.principal(request),
      parseId(id),
      parsed.data as AcknowledgeEvidenceInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('evidence-packages/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a signatory decline without creating a signature' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: DeclineEvidenceRequestDto })
  @ApiOkResponse({ type: EvidenceAcknowledgementDto, description: 'Decline record created' })
  async decline(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = declineEvidenceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.evidence.decline(
      this.principal(request),
      parseId(id),
      parsed.data as DeclineEvidenceInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('acknowledgements/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an acknowledgement with a required reason' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: RevokeAcknowledgementRequestDto })
  @ApiOkResponse({ type: EvidenceAcknowledgementDto, description: 'Revocation recorded' })
  async revoke(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = revokeAcknowledgementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.evidence.revoke(
      this.principal(request),
      parseId(id),
      parsed.data.reason,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('acknowledgements/:id/signature')
  @ApiOperation({
    summary: 'Read a signature through an authorization-controlled private endpoint',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SignatureResponseDto })
  getSignature(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.evidence.getSignature(this.principal(request), parseId(id));
  }

  @Get('service-evidence')
  @ApiOperation({
    summary: 'List service evidence and acknowledgement status within the caller scope',
  })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'awaiting_acknowledgement',
      'acknowledged',
      'declined',
      'revoked',
      'outdated',
      'superseded',
    ],
  })
  @ApiQuery({ name: 'visitId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientQuery', required: false })
  @ApiQuery({ name: 'employeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'signatoryType',
    required: false,
    enum: ['client', 'representative', 'other_authorized_person'],
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['date', 'client', 'status', 'acknowledgement'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: ServiceEvidenceWorklistDto })
  worklist(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = serviceEvidenceWorklistQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.evidence.worklist(
      this.principal(request),
      parsed.data as ServiceEvidenceWorklistQuery,
    );
  }

  @Get('me/service-evidence')
  @ApiTags('caregiver')
  @ApiOperation({
    summary: 'List service evidence status for visits related to the current caregiver',
  })
  @ApiQuery({ name: 'from', required: true, format: 'date-time' })
  @ApiQuery({ name: 'until', required: true, format: 'date-time' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: ServiceEvidenceWorklistDto })
  myWorklist(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = serviceEvidenceWorklistQuerySchema
      .pick({ from: true, until: true, page: true, pageSize: true })
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.evidence.worklist(this.principal(request), {
      ...parsed.data,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
  }

  private principal(request: ApiRequest): AuthorizationPrincipal {
    if (!request.principal) throw new UnauthorizedException();
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
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}
