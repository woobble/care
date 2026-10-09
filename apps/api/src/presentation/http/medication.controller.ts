import {
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
  MedicationApplicationService,
  MedicationError,
  type MedicationOrderInput,
} from '@care/medication';
import { z } from 'zod';
import { MEDICATION_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';
import {
  expectedMedicationOrderVersionSchema,
  medicationAdministrationSchema,
  medicationCorrectionSchema,
  medicationDateRangeSchema,
  medicationDefinitionPatchSchema,
  medicationDefinitionSchema,
  medicationOrderSchema,
  MedicationAdministrationResponseDto,
  MedicationAdministrationRequestDto,
  MedicationCorrectionRequestDto,
  MedicationDefinitionDto,
  MedicationDefinitionPatchRequestDto,
  MedicationDefinitionRequestDto,
  MedicationOrderHistoryDto,
  MedicationOrderListDto,
  MedicationOrderRequestDto,
  MedicationOrderRevisionRequestDto,
  VisitMedicationAdministrationDto,
  reviseMedicationOrderSchema,
} from './medication.dto';

@ApiTags('medication')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class MedicationController {
  constructor(
    @Inject(MEDICATION_APPLICATION)
    private readonly medication: MedicationApplicationService,
  ) {}

  @Get('medications')
  @ApiOperation({ operationId: 'listMedicationDefinitions', summary: 'List tenant medication definitions' })
  @ApiOkResponse({ type: [MedicationDefinitionDto] })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid', description: 'Apply client resource scope for catalog use while managing this client' })
  listDefinitions(@Req() request: ApiRequest, @Query('clientId') clientId?: string) {
    return this.medication.listDefinitions(this.principal(request), clientId ? parseId(clientId) : undefined);
  }

  @Get('medications/:id')
  @ApiOperation({ operationId: 'getMedicationDefinition', summary: 'Read a tenant medication definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MedicationDefinitionDto })
  getDefinition(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.medication.definition(this.principal(request), parseId(id));
  }

  @Post('medications')
  @ApiOperation({ operationId: 'createMedicationDefinition', summary: 'Create a local medication catalog definition' })
  @ApiBody({ type: MedicationDefinitionRequestDto })
  @ApiCreatedResponse({ type: MedicationDefinitionDto })
  async createDefinition(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = medicationDefinitionSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_INVALID');
    return this.medication.createDefinition(this.principal(request), parsed.data);
  }

  @Patch('medications/:id')
  @ApiOperation({ operationId: 'updateMedicationDefinition', summary: 'Update or archive a local medication definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: MedicationDefinitionPatchRequestDto })
  @ApiOkResponse({ type: MedicationDefinitionDto })
  async updateDefinition(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = medicationDefinitionPatchSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_INVALID');
    return this.medication.updateDefinition(this.principal(request), parseId(id), withoutUndefined(parsed.data));
  }

  @Get('clients/:clientId/medication-orders')
  @ApiOperation({ operationId: 'listClientMedicationOrders', summary: 'List medication orders for a client' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [MedicationOrderListDto] })
  listOrders(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.medication.listOrders(this.principal(request), parseId(clientId));
  }

  @Post('clients/:clientId/medication-orders')
  @ApiOperation({ operationId: 'createClientMedicationOrder', summary: 'Create a draft medication order from documented source information' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: MedicationOrderRequestDto })
  @ApiCreatedResponse({ type: MedicationOrderListDto })
  async createOrder(@Req() request: ApiRequest, @Param('clientId') clientId: string, @Body() body: unknown) {
    const parsed = medicationOrderSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_ORDER_INVALID');
    return this.medication.createOrder(
      this.principal(request), parseId(clientId), parsed.data as MedicationOrderInput,
      requestContext(request), auditContext(request),
    );
  }

  @Get('medication-orders/:orderId')
  @ApiOperation({ operationId: 'getMedicationOrderHistory', summary: 'Read an order and its immutable revisions' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ type: MedicationOrderHistoryDto })
  getOrder(@Req() request: ApiRequest, @Param('orderId') orderId: string) {
    return this.medication.orderHistory(this.principal(request), parseId(orderId));
  }

  @Patch('medication-orders/:orderId')
  @ApiOperation({ operationId: 'reviseMedicationOrder', summary: 'Create a new medication order revision' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiBody({ type: MedicationOrderRevisionRequestDto })
  @ApiOkResponse({ type: MedicationOrderListDto })
  async reviseOrder(@Req() request: ApiRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    const parsed = reviseMedicationOrderSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_ORDER_INVALID');
    const { expectedVersion, ...input } = parsed.data;
    return this.medication.reviseOrder(
      this.principal(request), parseId(orderId), expectedVersion, input as MedicationOrderInput,
      requestContext(request), auditContext(request),
    );
  }

  @Post('medication-orders/:orderId/activate')
  @ApiOperation({ operationId: 'activateMedicationOrder', summary: 'Explicitly activate a sourced draft medication order' })
  @ApiBody({ schema: { type: 'object', required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } } })
  @ApiOkResponse({ type: MedicationOrderListDto })
  activate(@Req() request: ApiRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.transition(request, orderId, body, 'active');
  }

  @Post('medication-orders/:orderId/pause')
  @ApiOperation({ operationId: 'pauseMedicationOrder', summary: 'Pause an active medication order' })
  pause(@Req() request: ApiRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.transition(request, orderId, body, 'paused');
  }

  @Post('medication-orders/:orderId/resume')
  @ApiOperation({ operationId: 'resumeMedicationOrder', summary: 'Resume a paused medication order' })
  resume(@Req() request: ApiRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.transition(request, orderId, body, 'active');
  }

  @Post('medication-orders/:orderId/discontinue')
  @ApiOperation({ operationId: 'discontinueMedicationOrder', summary: 'Discontinue a medication order' })
  discontinue(@Req() request: ApiRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.transition(request, orderId, body, 'discontinued');
  }

  @Get('clients/:clientId/medication-administrations')
  @ApiOperation({ operationId: 'getClientMedicationAdministrationHistory', summary: 'Read a bounded client medication record' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'from', required: true, type: String, format: 'date' })
  @ApiQuery({ name: 'until', required: true, type: String, format: 'date' })
  @ApiOkResponse({ type: MedicationAdministrationResponseDto })
  async clientAdministrations(@Req() request: ApiRequest, @Param('clientId') clientId: string, @Query() query: unknown) {
    const parsed = medicationDateRangeSchema.safeParse(query);
    if (!parsed.success) throw medicationError('MEDICATION_DATE_RANGE_INVALID');
    return this.medication.administrationsForClient(this.principal(request), parseId(clientId), parsed.data);
  }

  @Get('visits/:visitId/medication-administrations')
  @ApiOperation({ operationId: 'getVisitMedicationAdministrations', summary: 'Read medication due during an assigned visit' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: VisitMedicationAdministrationDto })
  visitAdministrations(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    return this.medication.administrationsForVisit(this.principal(request), parseId(visitId));
  }

  @Post('medication-administrations/:occurrenceId/record')
  @ApiOperation({ operationId: 'recordMedicationAdministration', summary: 'Record an outcome for a pending medication occurrence' })
  @ApiParam({ name: 'occurrenceId', format: 'uuid' })
  @ApiBody({ type: MedicationAdministrationRequestDto })
  @ApiCreatedResponse({ schema: { type: 'object' } })
  @HttpCode(HttpStatus.CREATED)
  async recordAdministration(@Req() request: ApiRequest, @Param('occurrenceId') occurrenceId: string, @Body() body: unknown) {
    const parsed = medicationAdministrationSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
    return this.medication.recordOccurrence(this.principal(request), parseId(occurrenceId), parsed.data, requestContext(request), auditContext(request));
  }

  @Post('medication-orders/:orderId/prn-administrations')
  @ApiOperation({ operationId: 'recordPrnMedicationAdministration', summary: 'Record an explicitly indicated PRN administration during an assigned visit' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiBody({ type: MedicationAdministrationRequestDto })
  @HttpCode(HttpStatus.CREATED)
  async recordPrn(@Req() request: ApiRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    const parsed = medicationAdministrationSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
    return this.medication.recordPrn(this.principal(request), parseId(orderId), parsed.data, requestContext(request), auditContext(request));
  }

  @Post('medication-administrations/:recordId/corrections')
  @ApiOperation({ operationId: 'correctMedicationAdministration', summary: 'Append an attributable correction to finalized administration history' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiBody({ type: MedicationCorrectionRequestDto })
  @HttpCode(HttpStatus.CREATED)
  async correctAdministration(@Req() request: ApiRequest, @Param('recordId') recordId: string, @Body() body: unknown) {
    const parsed = medicationCorrectionSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
    return this.medication.correctAdministration(this.principal(request), parseId(recordId), parsed.data, requestContext(request), auditContext(request));
  }

  private transition(request: ApiRequest, orderId: string, body: unknown, status: 'active' | 'paused' | 'discontinued') {
    const parsed = expectedMedicationOrderVersionSchema.safeParse(body);
    if (!parsed.success) throw medicationError('MEDICATION_ORDER_VERSION_CONFLICT');
    return this.medication.transitionOrder(this.principal(request), parseId(orderId), parsed.data.expectedVersion, status, requestContext(request), auditContext(request));
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 401);
    return request.principal;
  }
}

function medicationError(code: string, status = 400) {
  return new MedicationError(code, code, status);
}
function parseId(value: string) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw medicationError('MEDICATION_INVALID');
  return parsed.data;
}
function auditContext(request: ApiRequest) {
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof request.headers['user-agent'] === 'string' ? { userAgent: request.headers['user-agent'] } : {}),
  };
}
