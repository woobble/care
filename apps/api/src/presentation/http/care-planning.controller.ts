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
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { CarePlanningApplicationService } from '@care/care-planning';
import { CarePlanRevisionNotFoundError } from '@care/care-planning';
import { z } from 'zod';
import { CARE_PLANNING_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import type { ApiRequest } from '../../http/request';
import { requestContext } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  addCareGoalSchema,
  addCareMeasureSchema,
  addCareNeedSchema,
  addCarePlanSourceReferenceSchema,
  addCareResourceSchema,
  addCareRiskResponseSchema,
  carePlanEvaluationSchema,
  carePlanListQuerySchema,
  clientCarePlanListQuerySchema,
  createCarePlanRevisionSchema,
  createCarePlanSchema,
  endCarePlanSchema,
  expectedVersionSchema,
  updateCareGoalSchema,
  updateCareMeasureSchema,
  updateCareNeedSchema,
  updateCarePlanAssessmentSchema,
  updateCareResourceSchema,
  updateCareRiskResponseSchema,
  CareGoalInputDto,
  CareMeasureInputDto,
  CareNeedInputDto,
  CarePlanDetailDto,
  CarePlanEligibilityDto,
  CarePlanEvaluationDto,
  CarePlanEvaluationInputDto,
  CarePlanHistoryDto,
  CarePlanListResponseDto,
  CarePlanRevisionDetailDto,
  CarePlanRevisionDiffDto,
  CarePlanSourceReferenceInputDto,
  CareResourceInputDto,
  CareRiskResponseInputDto,
  CreateCarePlanDto,
  CreateCarePlanRevisionDto,
  EndCarePlanDto,
  ExpectedVersionDto,
  UpdateCarePlanAssessmentDto,
  VisitCarePlanDto,
} from './care-planning.dto';
import {
  carePlanDetailResponse,
  carePlanEvaluationResponse,
  carePlanHistoryResponse,
  carePlanListResponse,
  carePlanRevisionDetailResponse,
  carePlanRevisionDiffResponse,
  carePlanVisitResponse,
} from './care-planning.mapper';
import { withoutUndefined } from './validation';

@ApiTags('care planning')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class CarePlanningController {
  constructor(
    @Inject(CARE_PLANNING_APPLICATION)
    private readonly carePlans: CarePlanningApplicationService,
  ) {}

  @Get('clients/:clientId/care-plans')
  @ApiOperation({ operationId: 'listClientCarePlans', summary: 'List care plans for a client' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'active', 'under_review', 'ended'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: CarePlanListResponseDto })
  async listClientCarePlans(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = clientCarePlanListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return carePlanListResponse(
      await this.carePlans.listForClient(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
      ),
    );
  }

  @Post('clients/:clientId/care-plans')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createClientCarePlan', summary: 'Create a care plan' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: CreateCarePlanDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async createClientCarePlan(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = createCarePlanSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.create(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('clients/:clientId/care-plan')
  @ApiOperation({
    operationId: 'getClientCarePlan',
    summary: 'Get the current care plan for a client',
    description: 'Office read. Caregiver access is visit-scoped.',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: CarePlanDetailDto, nullable: true })
  async getClientCarePlan(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    const detail = await this.carePlans.getActiveForClient(
      this.principal(request),
      parseId(clientId),
    );
    return detail ? carePlanDetailResponse(detail) : null;
  }

  @Get('care-plans')
  @ApiOperation({ operationId: 'listCarePlans', summary: 'Search care plans in provider scope' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'active', 'under_review', 'ended'] })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'clientQuery', required: false, type: String, maxLength: 120 })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'evaluationOverdue', required: false, type: Boolean })
  @ApiQuery({ name: 'evaluationDueBefore', required: false, format: 'date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: CarePlanListResponseDto })
  async listCarePlans(
    @Req() request: ApiRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = carePlanListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return carePlanListResponse(
      await this.carePlans.search(this.principal(request), withoutUndefined(parsed.data)),
    );
  }

  @Get('care-plans/:planId')
  @ApiOperation({ operationId: 'getCarePlan', summary: 'Get a care plan' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async getCarePlan(@Req() request: ApiRequest, @Param('planId') planId: string) {
    return carePlanDetailResponse(
      await this.carePlans.get(this.principal(request), parseId(planId)),
    );
  }

  @Get('care-plans/:planId/revisions')
  @ApiOperation({
    operationId: 'getCarePlanHistory',
    summary: 'List care plan revisions and evaluations',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiOkResponse({ type: CarePlanHistoryDto })
  async getCarePlanHistory(@Req() request: ApiRequest, @Param('planId') planId: string) {
    return carePlanHistoryResponse(
      await this.carePlans.getHistory(this.principal(request), parseId(planId)),
    );
  }

  @Post('care-plans/:planId/revisions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createCarePlanRevision', summary: 'Create a draft plan revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiBody({ type: CreateCarePlanRevisionDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async createCarePlanRevision(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ) {
    const parsed = createCarePlanRevisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.createRevision(
        this.principal(request),
        parseId(planId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('care-plans/:planId/revisions/diff')
  @ApiOperation({
    operationId: 'diffCarePlanRevisions',
    summary: 'Compare two care plan revisions',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiQuery({ name: 'fromRevisionId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'toRevisionId', required: true, format: 'uuid' })
  @ApiOkResponse({ type: CarePlanRevisionDiffDto })
  async diffCarePlanRevisions(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = z
      .object({ fromRevisionId: z.string().uuid(), toRevisionId: z.string().uuid() })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return carePlanRevisionDiffResponse(
      await this.carePlans.diffRevisions(
        this.principal(request),
        parseId(planId),
        parseId(parsed.data.fromRevisionId),
        parseId(parsed.data.toRevisionId),
      ),
    );
  }

  @Get('care-plans/:planId/revisions/:revisionId')
  @ApiOperation({
    operationId: 'getCarePlanRevision',
    summary: 'Get a historical care plan revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiOkResponse({ type: CarePlanRevisionDetailDto })
  async getCarePlanRevision(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
  ) {
    const history = await this.carePlans.getHistory(this.principal(request), parseId(planId));
    const revision = history.revisions.find((item) => item.revision.id === parseId(revisionId));
    if (!revision) throw new CarePlanRevisionNotFoundError();
    return carePlanRevisionDetailResponse(revision);
  }

  @Patch('care-plans/:planId/revisions/:revisionId/assessment')
  @ApiOperation({ operationId: 'updateCarePlanAssessment', summary: 'Update a draft assessment' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: UpdateCarePlanAssessmentDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async updateCarePlanAssessment(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCarePlanAssessmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.updateAssessment(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/needs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'addCarePlanNeed', summary: 'Add a need to a draft revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: CareNeedInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async addCarePlanNeed(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = addCareNeedSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.addNeed(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('care-plans/:planId/revisions/:revisionId/needs/:needId')
  @ApiOperation({ operationId: 'updateCarePlanNeed', summary: 'Update a need in a draft revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'needId', format: 'uuid' })
  @ApiBody({ type: CareNeedInputDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async updateCarePlanNeed(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('needId') needId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCareNeedSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.updateNeed(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(needId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('care-plans/:planId/revisions/:revisionId/needs/:needId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'removeCarePlanNeed',
    summary: 'Remove a need from a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'needId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async removeCarePlanNeed(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('needId') needId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.removeNeed(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(needId),
        parsed.data.expectedVersion,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/resources')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'addCarePlanResource',
    summary: 'Add a resource to a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: CareResourceInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async addCarePlanResource(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = addCareResourceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.addResource(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('care-plans/:planId/revisions/:revisionId/resources/:resourceId')
  @ApiOperation({
    operationId: 'updateCarePlanResource',
    summary: 'Update a resource in a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'resourceId', format: 'uuid' })
  @ApiBody({ type: CareResourceInputDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async updateCarePlanResource(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCareResourceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.updateResource(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(resourceId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('care-plans/:planId/revisions/:revisionId/resources/:resourceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'removeCarePlanResource',
    summary: 'Remove a resource from a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'resourceId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async removeCarePlanResource(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.removeResource(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(resourceId),
        parsed.data.expectedVersion,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/goals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'addCarePlanGoal', summary: 'Add a goal to a draft revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: CareGoalInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async addCarePlanGoal(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = addCareGoalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.addGoal(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('care-plans/:planId/revisions/:revisionId/goals/:goalId')
  @ApiOperation({ operationId: 'updateCarePlanGoal', summary: 'Update a goal in a draft revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'goalId', format: 'uuid' })
  @ApiBody({ type: CareGoalInputDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async updateCarePlanGoal(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('goalId') goalId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCareGoalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.updateGoal(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(goalId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('care-plans/:planId/revisions/:revisionId/goals/:goalId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'removeCarePlanGoal',
    summary: 'Remove a goal from a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'goalId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async removeCarePlanGoal(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('goalId') goalId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.removeGoal(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(goalId),
        parsed.data.expectedVersion,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/measures')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'addCarePlanMeasure', summary: 'Add a measure to a draft revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: CareMeasureInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async addCarePlanMeasure(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = addCareMeasureSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.addMeasure(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('care-plans/:planId/revisions/:revisionId/measures/:measureId')
  @ApiOperation({
    operationId: 'updateCarePlanMeasure',
    summary: 'Update a measure in a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'measureId', format: 'uuid' })
  @ApiBody({ type: CareMeasureInputDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async updateCarePlanMeasure(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('measureId') measureId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCareMeasureSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.updateMeasure(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(measureId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('care-plans/:planId/revisions/:revisionId/measures/:measureId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'removeCarePlanMeasure',
    summary: 'Remove a measure from a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'measureId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async removeCarePlanMeasure(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('measureId') measureId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.removeMeasure(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(measureId),
        parsed.data.expectedVersion,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/risk-responses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'addCarePlanRiskResponse',
    summary: 'Add a risk response to a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: CareRiskResponseInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async addCarePlanRiskResponse(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = addCareRiskResponseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.addRiskResponse(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('care-plans/:planId/revisions/:revisionId/risk-responses/:riskResponseId')
  @ApiOperation({
    operationId: 'updateCarePlanRiskResponse',
    summary: 'Update a risk response in a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'riskResponseId', format: 'uuid' })
  @ApiBody({ type: CareRiskResponseInputDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async updateCarePlanRiskResponse(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('riskResponseId') riskResponseId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCareRiskResponseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.updateRiskResponse(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(riskResponseId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('care-plans/:planId/revisions/:revisionId/risk-responses/:riskResponseId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'removeCarePlanRiskResponse',
    summary: 'Remove a risk response from a draft revision',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'riskResponseId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async removeCarePlanRiskResponse(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('riskResponseId') riskResponseId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.removeRiskResponse(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(riskResponseId),
        parsed.data.expectedVersion,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/source-references')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'addCarePlanSourceReference',
    summary: 'Reference a clinical record',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: CarePlanSourceReferenceInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async addCarePlanSourceReference(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = addCarePlanSourceReferenceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.addSourceReference(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('care-plans/:planId/revisions/:revisionId/source-references/:clinicalRecordId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'removeCarePlanSourceReference',
    summary: 'Remove a clinical record reference',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiParam({ name: 'clinicalRecordId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async removeCarePlanSourceReference(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Param('clinicalRecordId') clinicalRecordId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.removeSourceReference(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        parseId(clinicalRecordId),
        parsed.data.expectedVersion,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('care-plans/:planId/revisions/:revisionId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'activateCarePlanRevision', summary: 'Activate a draft revision' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiBody({ type: ExpectedVersionDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async activateCarePlanRevision(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ) {
    const parsed = expectedVersionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.activateRevision(
        this.principal(request),
        parseId(planId),
        parseId(revisionId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('care-plans/:planId/eligibility')
  @ApiOperation({
    operationId: 'previewCarePlanEligibility',
    summary: 'Check permission scope and competency eligibility for a care plan action',
  })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiQuery({ name: 'operation', enum: ['activate', 'evaluate'], required: true })
  @ApiOkResponse({ type: CarePlanEligibilityDto })
  async previewCarePlanEligibility(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Query('operation') operation: string,
  ): Promise<CarePlanEligibilityDto> {
    const parsed = z.enum(['activate', 'evaluate']).safeParse(operation);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.carePlans.previewAuthorization(
      this.principal(request),
      parseId(planId),
      `care_plan.${parsed.data}`,
    );
    return {
      operation: result.operation,
      permissionAllowed: result.permissionAllowed,
      competency:
        result.competency === null
          ? null
          : result.competency.allowed
            ? {
                ...result.competency,
                matchedQualificationIds: [...result.competency.matchedQualificationIds],
                evaluatedAt: result.competency.evaluatedAt.toISOString(),
              }
            : result.competency,
    };
  }

  @Post('care-plans/:planId/evaluations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createCarePlanEvaluation', summary: 'Evaluate a care plan' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiBody({ type: CarePlanEvaluationInputDto })
  @ApiCreatedResponse({ type: CarePlanDetailDto })
  async createCarePlanEvaluation(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ) {
    const parsed = carePlanEvaluationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const evaluation = {
      ...withoutUndefined(parsed.data),
      goals: parsed.data.goals.map((goal) => ({
        goalId: goal.goalId,
        outcome: goal.outcome,
        note: goal.note ?? null,
      })),
    };
    return carePlanDetailResponse(
      await this.carePlans.evaluate(
        this.principal(request),
        parseId(planId),
        evaluation,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('care-plans/:planId/evaluations')
  @ApiOperation({ operationId: 'listCarePlanEvaluations', summary: 'List care plan evaluations' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiOkResponse({ type: [CarePlanEvaluationDto] })
  async listCarePlanEvaluations(@Req() request: ApiRequest, @Param('planId') planId: string) {
    const history = await this.carePlans.getHistory(this.principal(request), parseId(planId));
    return history.evaluations.map(carePlanEvaluationResponse);
  }

  @Post('care-plans/:planId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'endCarePlan', summary: 'End a care plan' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiBody({ type: EndCarePlanDto })
  @ApiOkResponse({ type: CarePlanDetailDto })
  async endCarePlan(
    @Req() request: ApiRequest,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ) {
    const parsed = endCarePlanSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return carePlanDetailResponse(
      await this.carePlans.end(
        this.principal(request),
        parseId(planId),
        parsed.data,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('visits/:visitId/care-plan')
  @ApiOperation({
    operationId: 'getVisitCarePlan',
    summary: 'Read active care measures for an assigned visit',
    description: 'Caregiver view. The visit service verifies the caller is assigned to the visit.',
  })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse({ type: VisitCarePlanDto, nullable: true })
  async getVisitCarePlan(@Req() request: ApiRequest, @Param('visitId') visitId: string) {
    const view = await this.carePlans.getActiveForVisit(this.principal(request), parseId(visitId));
    return view ? carePlanVisitResponse(view) : null;
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function parseId(value: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}

function auditContext(request: ApiRequest): { ip?: string; userAgent?: string } {
  const userAgent = request.get('user-agent');
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
