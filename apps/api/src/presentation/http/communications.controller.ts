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
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type {
  CommunicationAmendmentInput,
  CommunicationInput,
  CommunicationListQuery,
  CommunicationPreferencesInput,
  CommunicationsApplicationService,
} from '@care/communications';
import type { AuthorizationPrincipal } from '@care/permissions';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { COMMUNICATIONS_APPLICATION } from '@app/api/tokens';
import { ProblemDetailsDto } from './dto';

const uuid = z.uuid();
const pageSchema = z.coerce.number().int().min(1).max(100_000).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(25);
const channel = z.enum(['phone', 'in_person', 'email', 'letter', 'portal', 'other']);
const direction = z.enum(['inbound', 'outbound', 'internal']);
const category = z.enum([
  'general_inquiry',
  'appointment_coordination',
  'cancellation_rescheduling',
  'service_request',
  'service_agreement',
  'documentation',
  'billing_payment',
  'benefits_payer',
  'complaint_feedback',
  'other',
]);
const outcome = z.enum([
  'information_provided',
  'request_received',
  'action_required',
  'appointment_agreed',
  'no_answer',
  'resolved',
  'other',
]);
const followUpStatus = z.enum(['needs_task', 'open', 'overdue', 'completed']);
const source = z.object({
  type: z.enum(['visit', 'service_agreement', 'operations_task', 'invoice', 'claim', 'document']),
  id: uuid,
});
const listSchema = z.object({
  clientId: uuid.optional(),
  organizationId: uuid.optional(),
  facilityId: uuid.optional(),
  clientSearch: z.string().trim().min(1).max(120).optional(),
  recordedByUserId: uuid.optional(),
  channel: channel.optional(),
  direction: direction.optional(),
  category: category.optional(),
  outcome: outcome.optional(),
  followUpStatus: followUpStatus.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
const clientListSchema = listSchema.omit({
  clientId: true,
  organizationId: true,
  facilityId: true,
  clientSearch: true,
  recordedByUserId: true,
  followUpStatus: true,
});
const createSchema = z.object({
  direction,
  channel,
  category,
  subject: z.string().trim().min(1).max(200),
  summary: z.string().max(4000).nullable().optional(),
  outcome,
  occurredAt: z.iso.datetime({ offset: true }),
  contactId: uuid.nullable().optional(),
  contactLabel: z.string().trim().min(1).max(120).nullable().optional(),
  source: source.nullable().optional(),
});
const amendSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  direction: direction.optional(),
  channel: channel.optional(),
  category: category.optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(4000).nullable().optional(),
  outcome: outcome.optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  contactId: uuid.nullable().optional(),
  contactLabel: z.string().trim().min(1).max(120).nullable().optional(),
});
const preferencesSchema = z.object({
  expectedVersion: z.number().int().min(0),
  preferredChannel: channel.nullable().optional(),
  preferredLanguage: z.enum(['de', 'en']).nullable().optional(),
  preferredContactId: uuid.nullable().optional(),
  preferredContactTimes: z.string().max(250).nullable().optional(),
  correspondencePreference: z.enum(['unspecified', 'postal', 'electronic']),
  contactRestrictions: z.string().max(1000).nullable().optional(),
});

export class CommunicationSourceResponseDto {
  @ApiProperty({
    enum: ['visit', 'service_agreement', 'operations_task', 'invoice', 'claim', 'document'],
  })
  type!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
}

export class CommunicationInteractionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiPropertyOptional() clientName?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) recordedByName?: string | null;
  @ApiPropertyOptional({ enum: ['needs_task', 'open', 'overdue', 'completed', 'none'] })
  followUpStatus?: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) contactId!: string | null;
  @ApiProperty({ type: String, nullable: true }) contactLabel!: string | null;
  @ApiProperty({
    enum: ['legal_representative', 'authorized_contact', 'not_confirmed', 'not_applicable'],
  })
  contactAuthorization!: string;
  @ApiProperty({ enum: ['inbound', 'outbound', 'internal'] }) direction!: string;
  @ApiProperty({ enum: ['phone', 'in_person', 'email', 'letter', 'portal', 'other'] })
  channel!: string;
  @ApiProperty({
    enum: [
      'general_inquiry',
      'appointment_coordination',
      'cancellation_rescheduling',
      'service_request',
      'service_agreement',
      'documentation',
      'billing_payment',
      'benefits_payer',
      'complaint_feedback',
      'other',
    ],
  })
  category!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ type: String, nullable: true }) summary!: string | null;
  @ApiProperty({
    enum: [
      'information_provided',
      'request_received',
      'action_required',
      'appointment_agreed',
      'no_answer',
      'resolved',
      'other',
    ],
  })
  outcome!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ type: CommunicationSourceResponseDto, nullable: true })
  source!: CommunicationSourceResponseDto | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CommunicationInteractionListResponseDto {
  @ApiProperty({ type: [CommunicationInteractionResponseDto] })
  items!: CommunicationInteractionResponseDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export class CommunicationPreferencesResponseDto {
  @ApiProperty({ enum: ['unknown'] }) consentStatus!: 'unknown';
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ type: String, nullable: true }) preferredChannel!: string | null;
  @ApiProperty({ type: String, nullable: true }) preferredLanguage!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) preferredContactId!: string | null;
  @ApiProperty({ type: String, nullable: true }) preferredContactTimes!: string | null;
  @ApiProperty({ enum: ['unspecified', 'postal', 'electronic'] }) correspondencePreference!: string;
  @ApiProperty({ type: String, nullable: true }) contactRestrictions!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) updatedByUserId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CommunicationClientSummaryInteractionDto {
  @ApiProperty() subject!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
}

export class CommunicationClientSummaryAuthorizedContactDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['legal_representative', 'authorized_contact'] })
  authorization!: 'legal_representative' | 'authorized_contact';
}

export class CommunicationClientSummaryFollowUpDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['open', 'in_progress'] }) status!: 'open' | 'in_progress';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!: string | null;
}

export class CommunicationClientSummaryResponseDto {
  @ApiProperty({ type: String, nullable: true, enum: channel.options })
  preferredChannel!: (typeof channel.options)[number] | null;
  @ApiProperty({ type: String, nullable: true }) preferredContactName!: string | null;
  @ApiProperty({ type: CommunicationClientSummaryAuthorizedContactDto, nullable: true })
  primaryAuthorizedContact!: CommunicationClientSummaryAuthorizedContactDto | null;
  @ApiProperty({ type: CommunicationClientSummaryInteractionDto, nullable: true })
  mostRecentInteraction!: CommunicationClientSummaryInteractionDto | null;
  @ApiProperty({ type: [CommunicationClientSummaryFollowUpDto], maxItems: 3 })
  openFollowUps!: CommunicationClientSummaryFollowUpDto[];
}

@ApiTags('communications')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/communications')
export class CommunicationsController {
  constructor(
    @Inject(COMMUNICATIONS_APPLICATION)
    private readonly communications: CommunicationsApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List client communications in the caller scope' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientSearch', required: false, type: String })
  @ApiQuery({ name: 'recordedByUserId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'channel', required: false, enum: channel.options })
  @ApiQuery({ name: 'direction', required: false, enum: direction.options })
  @ApiQuery({ name: 'category', required: false, enum: category.options })
  @ApiQuery({ name: 'outcome', required: false, enum: outcome.options })
  @ApiQuery({ name: 'followUpStatus', required: false, enum: followUpStatus.options })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'until', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: CommunicationInteractionListResponseDto })
  list(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.communications.listInteractions(principal(request), toListQuery(parsed.data));
  }

  @Get('clients/:clientId/summary')
  @ApiOperation({ summary: 'Get a client communication overview' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: CommunicationClientSummaryResponseDto })
  summary(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.communications.clientSummary(principal(request), parseId(clientId));
  }

  @Get('clients/:clientId/interactions')
  @ApiOperation({ summary: 'List a client communication history' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'channel', required: false, enum: channel.options })
  @ApiQuery({ name: 'direction', required: false, enum: direction.options })
  @ApiQuery({ name: 'category', required: false, enum: category.options })
  @ApiQuery({ name: 'outcome', required: false, enum: outcome.options })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'until', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: CommunicationInteractionListResponseDto })
  clientInteractions(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = clientListSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.communications.listClientInteractions(
      principal(request),
      parseId(clientId),
      toListQuery(parsed.data),
    );
  }

  @Post('clients/:clientId/interactions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a client communication' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiCreatedResponse({ type: CommunicationInteractionResponseDto })
  create(@Req() request: ApiRequest, @Param('clientId') clientId: string, @Body() body: unknown) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.communications.createInteraction(
      principal(request),
      parseId(clientId),
      { ...parsed.data, occurredAt: new Date(parsed.data.occurredAt) } as CommunicationInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('clients/:clientId/preferences')
  @ApiOperation({ summary: 'Read client communication preferences' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: CommunicationPreferencesResponseDto })
  preferences(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.communications.getPreferences(principal(request), parseId(clientId));
  }

  @Post('clients/:clientId/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update client communication preferences' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ type: CommunicationPreferencesResponseDto })
  updatePreferences(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = preferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.communications.updatePreferences(
      principal(request),
      parseId(clientId),
      parsed.data as CommunicationPreferencesInput,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('interactions/:id')
  @ApiOperation({ summary: 'Read a communication and its amendment history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  get(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.communications.getInteraction(principal(request), parseId(id));
  }

  @Post('interactions/:id/amendments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Amend a communication with a reason and full snapshot' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ type: CommunicationInteractionResponseDto })
  amend(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = amendSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.communications.amendInteraction(
      principal(request),
      parseId(id),
      {
        ...parsed.data,
        ...(parsed.data.occurredAt ? { occurredAt: new Date(parsed.data.occurredAt) } : {}),
      } as CommunicationAmendmentInput,
      requestContext(request),
      auditContext(request),
    );
  }
}

function toListQuery(query: z.infer<typeof listSchema>): CommunicationListQuery {
  return {
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.facilityId ? { facilityId: query.facilityId } : {}),
    ...(query.clientSearch ? { clientSearch: query.clientSearch } : {}),
    ...(query.recordedByUserId ? { recordedByUserId: query.recordedByUserId } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.followUpStatus ? { followUpStatus: query.followUpStatus } : {}),
    ...(query.search ? { search: query.search } : {}),
    page: query.page,
    pageSize: query.pageSize,
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.until ? { until: new Date(query.until) } : {}),
  };
}

function principal(request: ApiRequest): AuthorizationPrincipal {
  if (!request.principal) throw new BadRequestException();
  return request.principal;
}

function parseId(value: string) {
  const parsed = uuid.safeParse(value);
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
