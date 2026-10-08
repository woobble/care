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
import type { ProfessionalCompetencyPolicyApplicationService } from '@care/competency-policies';
import { COMPETENCY_OPERATIONS } from '@care/permissions';
import { z } from 'zod';
import { COMPETENCY_POLICY_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import type { ApiRequest } from '../../http/request';
import { requestContext } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  CompetencyPolicyAdminDto,
  CompetencyPolicyDraftInputDto,
  competencyOperationSchema,
  competencyPolicyDraftSchema,
} from './competency-policies.dto';

@ApiTags('competency policies')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class CompetencyPoliciesController {
  constructor(
    @Inject(COMPETENCY_POLICY_APPLICATION)
    private readonly policies: ProfessionalCompetencyPolicyApplicationService,
  ) {}

  @Get('competency-policies')
  @ApiOperation({
    operationId: 'listCompetencyPolicies',
    summary: 'List tenant competency policies',
  })
  @ApiOkResponse({ type: CompetencyPolicyAdminDto })
  async list(@Req() request: ApiRequest): Promise<CompetencyPolicyAdminDto> {
    return competencyPolicyAdminResponse(await this.policies.list(this.principal(request)));
  }

  @Post('competency-policies/:operationKey/versions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'createCompetencyPolicyDraft',
    summary: 'Create a draft competency policy version',
  })
  @ApiParam({ name: 'operationKey', enum: COMPETENCY_OPERATIONS })
  @ApiBody({ type: CompetencyPolicyDraftInputDto })
  @ApiCreatedResponse({ type: CompetencyPolicyAdminDto })
  async createDraft(
    @Req() request: ApiRequest,
    @Param('operationKey') operationKey: string,
    @Body() body: unknown,
  ): Promise<CompetencyPolicyAdminDto> {
    const operation = competencyOperationSchema.safeParse(operationKey);
    const input = competencyPolicyDraftSchema.safeParse(body);
    if (!operation.success || !input.success) throw new BadRequestException();
    return competencyPolicyAdminResponse(
      await this.policies.configureDraft(
        this.principal(request),
        operation.data,
        {
          ...input.data,
          description: input.data.description ?? null,
        },
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('competency-policies/:operationKey/versions/:version/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'activateCompetencyPolicy', summary: 'Activate a policy version' })
  @ApiParam({ name: 'operationKey', enum: COMPETENCY_OPERATIONS })
  @ApiParam({ name: 'version', type: Number, description: 'Version number, starting at 1' })
  @ApiOkResponse({ type: CompetencyPolicyAdminDto })
  async activate(
    @Req() request: ApiRequest,
    @Param('operationKey') operationKey: string,
    @Param('version') version: string,
  ): Promise<CompetencyPolicyAdminDto> {
    const operation = competencyOperationSchema.safeParse(operationKey);
    const parsedVersion = z.coerce.number().int().min(1).safeParse(version);
    if (!operation.success || !parsedVersion.success) throw new BadRequestException();
    return competencyPolicyAdminResponse(
      await this.policies.activate(
        this.principal(request),
        operation.data,
        parsedVersion.data,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('competency-policies/:operationKey/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'deactivateCompetencyPolicy',
    summary: 'Deactivate the active policy version',
  })
  @ApiParam({ name: 'operationKey', enum: COMPETENCY_OPERATIONS })
  @ApiOkResponse({ type: CompetencyPolicyAdminDto })
  async deactivate(
    @Req() request: ApiRequest,
    @Param('operationKey') operationKey: string,
  ): Promise<CompetencyPolicyAdminDto> {
    const operation = competencyOperationSchema.safeParse(operationKey);
    if (!operation.success) throw new BadRequestException();
    return competencyPolicyAdminResponse(
      await this.policies.deactivate(
        this.principal(request),
        operation.data,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  private principal(request: ApiRequest) {
    if (!request.principal) throw new BadRequestException();
    return request.principal;
  }
}

function competencyPolicyAdminResponse(
  view: Awaited<ReturnType<ProfessionalCompetencyPolicyApplicationService['list']>>,
): CompetencyPolicyAdminDto {
  return {
    operations: view.operations.map((operation) => ({
      ...operation,
      versions: operation.versions.map((version) => ({
        ...version,
        createdAt: version.createdAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null,
        deactivatedAt: version.deactivatedAt?.toISOString() ?? null,
      })),
    })),
    qualificationDefinitions: view.qualificationDefinitions,
  };
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
