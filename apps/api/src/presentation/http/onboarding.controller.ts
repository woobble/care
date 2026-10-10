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
import { z } from 'zod';
import type { AuthorizationPrincipal } from '@care/permissions';
import {
  type AdmissionCaseChanges,
  type AdmissionCaseInput,
  type AdmissionSearchQuery,
  type OnboardingApplicationService,
} from '@care/onboarding';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { ONBOARDING_APPLICATION } from '@app/api/tokens';
import { ProblemDetailsDto } from './dto';
import {
  onboardingAssessmentSchema,
  onboardingCaseCreateSchema,
  onboardingCasePatchSchema,
  onboardingChecklistResponseSchema,
  onboardingClientLinkSchema,
  onboardingCommunicationLinkSchema,
  onboardingDocumentLinkSchema,
  onboardingProspectCommunicationSchema,
  onboardingSearchSchema,
  onboardingTaskLinkSchema,
  onboardingTemplatePatchSchema,
  onboardingTemplateQuerySchema,
  onboardingTransitionSchema,
  onboardingVersionSchema,
  onboardingVisitLinkSchema,
} from './onboarding.dto';

const uuid = z.uuid();

@ApiTags('onboarding')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/onboarding')
export class OnboardingController {
  constructor(
    @Inject(ONBOARDING_APPLICATION)
    private readonly onboarding: OnboardingApplicationService,
  ) {}

  @Get('cases')
  @ApiOperation({ summary: 'Search admission cases visible to the current user' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'stage',
    required: false,
    enum: [
      'inquiry',
      'assessment',
      'preparation',
      'ready_for_admission',
      'admitted',
      'declined',
      'withdrawn',
    ],
  })
  @ApiQuery({ name: 'ownerEmployeeId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'createdFrom', required: false, format: 'date' })
  @ApiQuery({ name: 'createdTo', required: false, format: 'date' })
  @ApiQuery({ name: 'overdue', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'readiness', required: false, enum: ['ready', 'blocked'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  search(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = onboardingSearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.search(principal(request), parsed.data as AdmissionSearchQuery);
  }

  @Post('cases')
  @ApiOperation({ summary: 'Create an admission case' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['organizationId', 'firstName', 'lastName', 'contactMethod', 'inquirySource'],
      properties: {
        organizationId: { type: 'string', format: 'uuid' },
        facilityId: { type: 'string', format: 'uuid', nullable: true },
        ownerEmployeeId: { type: 'string', format: 'uuid', nullable: true },
        clientId: { type: 'string', format: 'uuid', nullable: true },
        firstName: { type: 'string', maxLength: 120 },
        lastName: { type: 'string', maxLength: 120 },
        contactMethod: { type: 'string', enum: ['phone', 'email', 'in_person', 'letter', 'other'] },
        requesterName: { type: 'string', maxLength: 160, nullable: true },
        requesterRelationship: { type: 'string', maxLength: 120, nullable: true },
        contactEmail: { type: 'string', format: 'email', maxLength: 254, nullable: true },
        contactPhone: { type: 'string', maxLength: 80, nullable: true },
        requestedServices: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', maxLength: 80 },
        },
        preferredStartDate: { type: 'string', format: 'date', nullable: true },
        serviceLocation: { type: 'string', maxLength: 500, nullable: true },
        inquirySource: { type: 'string', maxLength: 120 },
        fundingPlan: { type: 'string', enum: ['unknown', 'private_pay', 'benefits', 'other'] },
        fundingPlanDetails: { type: 'string', maxLength: 1000, nullable: true },
        initialNotes: { type: 'string', maxLength: 4000, nullable: true },
        nextFollowUpAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  create(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = onboardingCaseCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const input = {
      ...parsed.data,
      ...(parsed.data.nextFollowUpAt !== undefined
        ? {
            nextFollowUpAt: parsed.data.nextFollowUpAt
              ? new Date(parsed.data.nextFollowUpAt)
              : null,
          }
        : {}),
    } as AdmissionCaseInput;
    return this.onboarding.create(
      principal(request),
      input,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('cases/:id')
  @ApiOperation({
    summary: 'Read an admission case with assessment, checklist, readiness, and history',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  get(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.onboarding.get(principal(request), parseId(id));
  }

  @Patch('cases/:id')
  @ApiOperation({ summary: 'Update editable admission case details' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        facilityId: { type: 'string', format: 'uuid', nullable: true },
        ownerEmployeeId: { type: 'string', format: 'uuid', nullable: true },
        firstName: { type: 'string', maxLength: 120 },
        lastName: { type: 'string', maxLength: 120 },
        contactMethod: { type: 'string', enum: ['phone', 'email', 'in_person', 'letter', 'other'] },
        requesterName: { type: 'string', maxLength: 160, nullable: true },
        requesterRelationship: { type: 'string', maxLength: 120, nullable: true },
        contactEmail: { type: 'string', format: 'email', maxLength: 254, nullable: true },
        contactPhone: { type: 'string', maxLength: 80, nullable: true },
        requestedServices: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', maxLength: 80 },
        },
        preferredStartDate: { type: 'string', format: 'date', nullable: true },
        serviceLocation: { type: 'string', maxLength: 500, nullable: true },
        inquirySource: { type: 'string', maxLength: 120 },
        fundingPlan: { type: 'string', enum: ['unknown', 'private_pay', 'benefits', 'other'] },
        fundingPlanDetails: { type: 'string', maxLength: 1000, nullable: true },
        initialNotes: { type: 'string', maxLength: 4000, nullable: true },
        nextFollowUpAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  update(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingCasePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const { expectedVersion, ...changes } = parsed.data;
    const input = {
      expectedVersion,
      ...changes,
      ...(changes.nextFollowUpAt !== undefined
        ? { nextFollowUpAt: changes.nextFollowUpAt ? new Date(changes.nextFollowUpAt) : null }
        : {}),
    } as AdmissionCaseChanges;
    return this.onboarding.update(
      principal(request),
      parseId(id),
      input,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/client-link')
  @ApiOperation({ summary: 'Link an existing client to an admission case' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['clientId', 'expectedVersion'],
      properties: {
        clientId: { type: 'string', format: 'uuid' },
        expectedVersion: { type: 'integer', minimum: 1 },
        reason: { type: 'string', maxLength: 1000 },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  linkClient(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingClientLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const { reason, ...input } = parsed.data;
    return this.onboarding.linkClient(
      principal(request),
      parseId(id),
      { ...input, ...(reason !== undefined ? { reason } : {}) },
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/register-client')
  @ApiOperation({ summary: 'Create and link a pending client from an admission prospect' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  registerClient(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.registerClient(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Put('cases/:id/assessment')
  @ApiOperation({ summary: 'Save a structured needs assessment' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion', 'data'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        data: { type: 'object', additionalProperties: true },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  saveAssessment(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingAssessmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.saveAssessment(
      principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('cases/:id/readiness')
  @ApiOperation({ summary: 'Evaluate mandatory admission requirements' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  readiness(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.onboarding.readiness(principal(request), parseId(id));
  }

  @Post('cases/:id/transitions')
  @ApiOperation({ summary: 'Move an admission case through its allowed stages' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion', 'toStage'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        toStage: {
          type: 'string',
          enum: [
            'inquiry',
            'assessment',
            'preparation',
            'ready_for_admission',
            'admitted',
            'declined',
            'withdrawn',
          ],
        },
        reason: { type: 'string', maxLength: 1000 },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  transition(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const { reason, ...input } = parsed.data;
    return this.onboarding.transition(
      principal(request),
      parseId(id),
      { ...input, ...(reason !== undefined ? { reason } : {}) },
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/admit')
  @ApiOperation({ summary: 'Admit a ready case and activate its linked pending client atomically' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  admit(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.admit(
      principal(request),
      parseId(id),
      parsed.data.expectedVersion,
      requestContext(request),
      auditContext(request),
    );
  }

  @Put('cases/:id/checklist/:code')
  @ApiOperation({ summary: 'Record a manual checklist response' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion', 'status'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        status: { type: 'string', enum: ['complete', 'not_applicable'] },
        reason: { type: 'string', maxLength: 500 },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  respondChecklist(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const parsed = onboardingChecklistResponseSchema.safeParse(body);
    if (!parsed.success || !/^[a-z][a-z0-9_]{1,63}$/.test(code)) throw new BadRequestException();
    const { reason, ...input } = parsed.data;
    return this.onboarding.respondChecklist(
      principal(request),
      parseId(id),
      { ...input, itemCode: code, ...(reason !== undefined ? { reason } : {}) },
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/documents')
  @ApiOperation({ summary: 'Link a client document to a checklist requirement' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentArtifactId', 'requirementCode'],
      properties: {
        documentArtifactId: { type: 'string', format: 'uuid' },
        requirementCode: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  linkDocument(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingDocumentLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.linkDocument(
      principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/tasks')
  @ApiOperation({ summary: 'Link an operations task to an admission case' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: { taskId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  linkTask(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingTaskLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.linkTask(
      principal(request),
      parseId(id),
      parsed.data.taskId,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/communications')
  @ApiOperation({ summary: 'Link a client communication to an admission case' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['interactionId'],
      properties: { interactionId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  linkCommunication(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingCommunicationLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.linkCommunication(
      principal(request),
      parseId(id),
      parsed.data.interactionId,
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/communications/records')
  @ApiOperation({ summary: 'Record a communication with a prospective client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'channel', 'category', 'subject', 'outcome', 'occurredAt'],
      properties: {
        direction: { type: 'string', enum: ['inbound', 'outbound', 'internal'] },
        channel: {
          type: 'string',
          enum: ['phone', 'in_person', 'email', 'letter', 'portal', 'other'],
        },
        category: {
          type: 'string',
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
        },
        subject: { type: 'string', maxLength: 200 },
        summary: { type: 'string', maxLength: 4000, nullable: true },
        outcome: {
          type: 'string',
          enum: [
            'information_provided',
            'request_received',
            'action_required',
            'appointment_agreed',
            'no_answer',
            'resolved',
            'other',
          ],
        },
        occurredAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiCreatedResponse({ schema: { type: 'object', additionalProperties: true } })
  recordProspectCommunication(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = onboardingProspectCommunicationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.recordProspectCommunication(
      principal(request),
      parseId(id),
      {
        ...parsed.data,
        summary: parsed.data.summary ?? null,
        occurredAt: new Date(parsed.data.occurredAt),
      },
      requestContext(request),
      auditContext(request),
    );
  }

  @Post('cases/:id/first-visit')
  @ApiOperation({ summary: 'Link a scheduled visit as the first visit without admitting the case' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['visitId', 'expectedVersion'],
      properties: {
        visitId: { type: 'string', format: 'uuid' },
        expectedVersion: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  @HttpCode(HttpStatus.OK)
  linkFirstVisit(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingVisitLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.linkFirstVisit(
      principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('templates')
  @ApiOperation({ summary: 'List checklist templates visible to the current user' })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiOkResponse({
    schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
  })
  listTemplates(@Req() request: ApiRequest, @Query() query: Record<string, string | undefined>) {
    const parsed = onboardingTemplateQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.listTemplates(principal(request), parsed.data.organizationId);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Create a new immutable version of a checklist template' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersion', 'name', 'items'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        name: { type: 'string', maxLength: 120 },
        items: {
          type: 'array',
          minItems: 7,
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'category', 'label', 'source', 'mandatory', 'requirementType'],
            properties: {
              code: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
              category: { type: 'string', maxLength: 80 },
              label: { type: 'string', maxLength: 160 },
              source: { type: 'string', enum: ['automatic', 'manual', 'document'] },
              mandatory: { type: 'boolean' },
              requirementType: { type: 'string', enum: ['policy', 'external'] },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  updateTemplate(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = onboardingTemplatePatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.onboarding.updateTemplate(
      principal(request),
      parseId(id),
      parsed.data,
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('clients/:clientId/history')
  @ApiOperation({ summary: 'Read admission history for a client' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({
    schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
  })
  clientHistory(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return this.onboarding.clientHistory(principal(request), parseId(clientId));
  }
}

function principal(request: ApiRequest): AuthorizationPrincipal {
  if (!request.principal) throw new BadRequestException();
  return request.principal;
}

function parseId(value: string): string {
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
