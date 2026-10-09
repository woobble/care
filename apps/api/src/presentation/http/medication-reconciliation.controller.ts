import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
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
  ApiTags,
} from '@nestjs/swagger';
import {
  MedicationReconciliationApplicationService,
  MedicationReconciliationError,
  type MedicationReconciliationEntryInput,
  type MedicationReconciliationSourceInput,
} from '@care/medication';
import { z } from 'zod';
import { MEDICATION_RECONCILIATION_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  medicationReconciliationApplySchema,
  medicationReconciliationCancelSchema,
  medicationReconciliationDecisionSchema,
  medicationReconciliationEntrySchema,
  medicationReconciliationExpectedVersionSchema,
  medicationReconciliationMatchSchema,
  medicationReconciliationSourceSchema,
  medicationReconciliationStartSchema,
  MedicationReconciliationApplyRequestDto,
  MedicationReconciliationCancelRequestDto,
  MedicationReconciliationCreatedDto,
  MedicationReconciliationDecisionRequestDto,
  MedicationReconciliationDetailDto,
  MedicationReconciliationEntryRequestDto,
  MedicationReconciliationExpectedVersionRequestDto,
  MedicationReconciliationMatchRequestDto,
  MedicationReconciliationSourceRequestDto,
  MedicationReconciliationStartRequestDto,
  MedicationReconciliationSummaryDto,
} from './medication.dto';

@ApiTags('medication reconciliation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class MedicationReconciliationController {
  constructor(
    @Inject(MEDICATION_RECONCILIATION_APPLICATION)
    private readonly reconciliations: MedicationReconciliationApplicationService,
  ) {}

  @Get('clients/:clientId/medication-reconciliations')
  @ApiOperation({ operationId: 'listMedicationReconciliations', summary: 'List reconciliation history for a client' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [MedicationReconciliationSummaryDto] })
  list(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.reconciliations.list(this.principal(request), parseId(clientId));
  }

  @Post('clients/:clientId/medication-reconciliations')
  @ApiOperation({ operationId: 'startMedicationReconciliation', summary: 'Start a reconciliation and snapshot the current medication orders' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationStartRequestDto })
  @ApiCreatedResponse({ type: MedicationReconciliationCreatedDto })
  @HttpCode(HttpStatus.CREATED)
  async start(@Req() request: ApiRequest, @Param('clientId') clientId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationStartSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    return this.reconciliations.start(
      this.principal(request), parseId(clientId), parsed.data.reason,
      requestContext(request), auditContext(request),
    );
  }

  @Get('medication-reconciliations/:reconciliationId')
  @ApiOperation({ operationId: 'getMedicationReconciliation', summary: 'Read sources, snapshots, comparisons, decisions, and applied changes' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiOkResponse({ type: MedicationReconciliationDetailDto })
  get(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string) {
    return this.reconciliations.get(this.principal(request), parseId(reconciliationId));
  }

  @Post('medication-reconciliations/:reconciliationId/sources')
  @ApiOperation({ operationId: 'addMedicationReconciliationSource', summary: 'Record an external source with its provenance' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationSourceRequestDto })
  @ApiCreatedResponse({ schema: { type: 'object' } })
  @HttpCode(HttpStatus.CREATED)
  async addSource(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationSourceSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    const { expectedVersion, ...input } = parsed.data;
    return this.reconciliations.addSource(
      this.principal(request), parseId(reconciliationId), expectedVersion,
      input as MedicationReconciliationSourceInput, requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/entries')
  @ApiOperation({ operationId: 'addMedicationReconciliationEntry', summary: 'Record an external medication statement or append a correction' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationEntryRequestDto })
  @ApiCreatedResponse({ schema: { type: 'object' } })
  @HttpCode(HttpStatus.CREATED)
  async addEntry(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationEntrySchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_ENTRY_INVALID');
    const { expectedVersion, ...input } = parsed.data;
    return this.reconciliations.addEntry(
      this.principal(request), parseId(reconciliationId), expectedVersion,
      input as MedicationReconciliationEntryInput, requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/matches')
  @ApiOperation({ operationId: 'matchMedicationReconciliationEntry', summary: 'Manually link an external entry to an immutable internal baseline' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationMatchRequestDto })
  @ApiCreatedResponse({ schema: { type: 'object' } })
  @HttpCode(HttpStatus.CREATED)
  async match(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationMatchSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    return this.reconciliations.matchEntry(
      this.principal(request), parseId(reconciliationId), parsed.data.expectedVersion,
      parseId(parsed.data.entryId), parsed.data.baselineId ? parseId(parsed.data.baselineId) : null,
      requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/compare')
  @ApiOperation({ operationId: 'compareMedicationReconciliation', summary: 'Create a versioned deterministic comparison' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationExpectedVersionRequestDto })
  @ApiOkResponse({ schema: { type: 'object' } })
  async compare(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationExpectedVersionSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_VERSION_CONFLICT');
    return this.reconciliations.compare(
      this.principal(request), parseId(reconciliationId), parsed.data.expectedVersion,
      requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/decisions')
  @ApiOperation({ operationId: 'recordMedicationReconciliationDecision', summary: 'Append an explicit reviewer decision' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationDecisionRequestDto })
  @ApiCreatedResponse({ schema: { type: 'object' } })
  @HttpCode(HttpStatus.CREATED)
  async decide(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationDecisionSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_DECISION_INVALID');
    return this.reconciliations.decide(
      this.principal(request), parseId(reconciliationId), parsed.data,
      requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/apply')
  @ApiOperation({ operationId: 'applyMedicationReconciliationChanges', summary: 'Apply accepted external facts through the medication order lifecycle' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationApplyRequestDto })
  @ApiOkResponse({ schema: { type: 'object' } })
  async apply(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationApplySchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_APPLICATION_INVALID');
    return this.reconciliations.apply(
      this.principal(request), parseId(reconciliationId), parsed.data,
      requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/complete')
  @ApiOperation({ operationId: 'completeMedicationReconciliation', summary: 'Complete a resolved reconciliation with competency authorization' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } } })
  @ApiOkResponse({ type: MedicationReconciliationSummaryDto })
  async complete(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationExpectedVersionSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_VERSION_CONFLICT');
    return this.reconciliations.complete(
      this.principal(request), parseId(reconciliationId), parsed.data.expectedVersion,
      requestContext(request), auditContext(request),
    );
  }

  @Post('medication-reconciliations/:reconciliationId/cancel')
  @ApiOperation({ operationId: 'cancelMedicationReconciliation', summary: 'Cancel an unfinished reconciliation' })
  @ApiParam({ name: 'reconciliationId', format: 'uuid' })
  @ApiBody({ type: MedicationReconciliationCancelRequestDto })
  @ApiOkResponse({ type: MedicationReconciliationSummaryDto })
  async cancel(@Req() request: ApiRequest, @Param('reconciliationId') reconciliationId: string, @Body() body: unknown) {
    const parsed = medicationReconciliationCancelSchema.safeParse(body);
    if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    return this.reconciliations.cancel(
      this.principal(request), parseId(reconciliationId), parsed.data.expectedVersion,
      parsed.data.reason, requestContext(request), auditContext(request),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw reconciliationError('MEDICATION_RECONCILIATION_NOT_AUTHORIZED', 401);
    return request.principal;
  }
}

function reconciliationError(code: string, status = 400) {
  return new MedicationReconciliationError(code, code, status);
}

function parseId(value: string) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
  return parsed.data;
}

function auditContext(request: ApiRequest) {
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof request.headers['user-agent'] === 'string' ? { userAgent: request.headers['user-agent'] } : {}),
  };
}
