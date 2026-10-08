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
import { EmployeeApplicationService } from '@care/employees';
import type {
  EmployeeDetailSnapshot,
  EmployeeSnapshot,
  QualificationDefinitionSnapshot,
  SkillDefinitionSnapshot,
} from '@care/employees';
import { EMPLOYEE_APPLICATION } from '../../tokens';
import { OidcGuard, TenantContextGuard } from '../../http/auth.guards';
import { requestContext, type ApiRequest } from '../../http/request';
import { ProblemDetailsDto } from './dto';
import {
  CreateDefinitionDto,
  CreateEmployeeDto,
  DefinitionResponseDto,
  EmployeeDetailResponseDto,
  EmployeeListResponseDto,
  EmployeeResponseDto,
  FacilityAssignmentDto,
  LinkUserDto,
  LinkableUserResponseDto,
  QualificationAssignmentDto,
  TeamMembershipDto,
  UpdateDefinitionDto,
  UpdateEmployeeDto,
  createDefinitionSchema,
  createEmployeeSchema,
  definitionStatusSchema,
  employeeSearchSchema,
  facilityAssignmentSchema,
  linkUserSchema,
  qualificationAssignmentSchema,
  teamMembershipSchema,
  updateDefinitionSchema,
  updateEmployeeSchema,
} from './employees.dto';

@ApiTags('employees')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, schema: { type: 'string', format: 'uuid' } })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1')
export class EmployeesController {
  constructor(
    @Inject(EMPLOYEE_APPLICATION)
    private readonly employees: EmployeeApplicationService,
  ) {}

  @Get('employees')
  @ApiOperation({ summary: 'Search employees in the selected tenant and authorized scopes' })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'archived'] })
  @ApiQuery({ name: 'organizationId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'teamId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['lastName', 'firstName', 'createdAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: EmployeeListResponseDto })
  async search(
    @Req() request: ApiRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('organizationId') organizationId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('teamId') teamId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ): Promise<EmployeeListResponseDto> {
    const parsed = employeeSearchSchema.safeParse({
      q,
      status,
      organizationId,
      facilityId,
      teamId,
      page,
      pageSize,
      sortBy,
      sortOrder,
    });
    if (!parsed.success) throw new BadRequestException();
    const result = await this.employees.search(this.principal(request), {
      ...(parsed.data.q === undefined ? {} : { text: parsed.data.q }),
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.organizationId === undefined
        ? {}
        : { organizationId: parsed.data.organizationId }),
      ...(parsed.data.facilityId === undefined ? {} : { facilityId: parsed.data.facilityId }),
      ...(parsed.data.teamId === undefined ? {} : { teamId: parsed.data.teamId }),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      sortBy: parsed.data.sortBy,
      sortOrder: parsed.data.sortOrder,
    });
    return {
      items: result.items.map((employee) => employeeResponse(employee, false)),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an employee without requiring a platform user account' })
  @ApiBody({ type: CreateEmployeeDto })
  @ApiCreatedResponse({ type: EmployeeDetailResponseDto })
  async create(
    @Req() request: ApiRequest,
    @Body() body: unknown,
  ): Promise<EmployeeDetailResponseDto> {
    const parsed = createEmployeeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return employeeDetailResponse(
      await this.employees.create(
        this.principal(request),
        {
          organizationId: parsed.data.organizationId,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          preferredName: parsed.data.preferredName ?? null,
          email: parsed.data.email ?? null,
          phone: parsed.data.phone ?? null,
          personnelNumber: parsed.data.personnelNumber ?? null,
          employmentType: parsed.data.employmentType ?? null,
          startDate: parsed.data.startDate ?? null,
          endDate: parsed.data.endDate ?? null,
          weeklyHours: parsed.data.weeklyHours ?? null,
        },
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'Get employee master data and authorized assignments' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async get(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ): Promise<EmployeeDetailResponseDto> {
    return employeeDetailResponse(await this.employees.get(this.principal(request), parseId(id)));
  }

  @Patch('employees/:id')
  @ApiOperation({ summary: 'Update employee master data' })
  @ApiBody({ type: UpdateEmployeeDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async update(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<EmployeeDetailResponseDto> {
    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return employeeDetailResponse(
      await this.employees.update(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('employees/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an inactive employee' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async activate(@Req() request: ApiRequest, @Param('id') id: string) {
    return employeeDetailResponse(
      await this.employees.activate(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('employees/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an employee' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async deactivate(@Req() request: ApiRequest, @Param('id') id: string) {
    return employeeDetailResponse(
      await this.employees.deactivate(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('employees/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an employee without deleting the record' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async archive(@Req() request: ApiRequest, @Param('id') id: string) {
    return employeeDetailResponse(
      await this.employees.archive(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('employees/:id/linkable-users')
  @ApiOperation({ summary: 'List active local users in this tenant that can be linked' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [LinkableUserResponseDto] })
  async linkableUsers(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.employees.listLinkableUsers(this.principal(request), parseId(id));
  }

  @Put('employees/:id/user')
  @ApiOperation({ summary: 'Link an employee to an existing local user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: LinkUserDto })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async linkUser(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = linkUserSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return employeeDetailResponse(
      await this.employees.linkUser(
        this.principal(request),
        parseId(id),
        parsed.data.userId,
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('employees/:id/user')
  @ApiOperation({ summary: 'Unlink a local user from an employee' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async unlinkUser(@Req() request: ApiRequest, @Param('id') id: string) {
    return employeeDetailResponse(
      await this.employees.unlinkUser(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put('employees/:id/facilities/:facilityId')
  @ApiOperation({ summary: 'Assign an employee to a facility and optionally make it primary' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'facilityId', format: 'uuid' })
  @ApiBody({ type: FacilityAssignmentDto })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async assignFacility(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
  ) {
    const parsed = facilityAssignmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return employeeDetailResponse(
      await this.employees.assignFacility(
        this.principal(request),
        parseId(id),
        parseId(facilityId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('employees/:id/facilities/:facilityId')
  @ApiOperation({ summary: 'Deactivate an employee facility assignment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'facilityId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async unassignFacility(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('facilityId') facilityId: string,
  ) {
    return employeeDetailResponse(
      await this.employees.unassignFacility(
        this.principal(request),
        parseId(id),
        parseId(facilityId),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put('employees/:id/teams/:teamId')
  @ApiOperation({ summary: 'Assign an employee to a team' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiBody({ type: TeamMembershipDto })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async assignTeam(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ) {
    const parsed = teamMembershipSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return employeeDetailResponse(
      await this.employees.assignTeam(
        this.principal(request),
        parseId(id),
        parseId(teamId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('employees/:id/teams/:teamId')
  @ApiOperation({ summary: 'Deactivate an employee team membership' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async unassignTeam(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
  ) {
    return employeeDetailResponse(
      await this.employees.unassignTeam(
        this.principal(request),
        parseId(id),
        parseId(teamId),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('qualifications')
  @ApiOperation({ summary: 'List tenant qualification definitions' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiOkResponse({ type: [DefinitionResponseDto] })
  async listQualifications(@Req() request: ApiRequest, @Query('status') status?: string) {
    return (
      await this.employees.listQualifications(
        this.principal(request),
        parseDefinitionStatus(status),
      )
    ).map(definitionResponse);
  }

  @Post('qualifications')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a tenant qualification definition' })
  @ApiBody({ type: CreateDefinitionDto })
  @ApiCreatedResponse({ type: DefinitionResponseDto })
  async createQualification(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return definitionResponse(
      await this.employees.createQualification(
        this.principal(request),
        {
          name: parsed.data.name,
          code: parsed.data.code ?? null,
          description: parsed.data.description ?? null,
        },
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('qualifications/:id')
  @ApiOperation({ summary: 'Update a qualification definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateDefinitionDto })
  @ApiOkResponse({ type: DefinitionResponseDto })
  async updateQualification(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = updateDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return definitionResponse(
      await this.employees.updateQualification(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('qualifications/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a qualification definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DefinitionResponseDto })
  async archiveQualification(@Req() request: ApiRequest, @Param('id') id: string) {
    return definitionResponse(
      await this.employees.archiveQualification(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put('employees/:id/qualifications/:qualificationId')
  @ApiOperation({ summary: 'Add or update an employee qualification' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'qualificationId', format: 'uuid' })
  @ApiBody({ type: QualificationAssignmentDto })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async assignQualification(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('qualificationId') qualificationId: string,
    @Body() body: unknown,
  ) {
    const parsed = qualificationAssignmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return employeeDetailResponse(
      await this.employees.assignQualification(
        this.principal(request),
        parseId(id),
        parseId(qualificationId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('employees/:id/qualifications/:qualificationId')
  @ApiOperation({ summary: 'Remove an employee qualification' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'qualificationId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async removeQualification(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('qualificationId') qualificationId: string,
  ) {
    return employeeDetailResponse(
      await this.employees.removeQualification(
        this.principal(request),
        parseId(id),
        parseId(qualificationId),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('skills')
  @ApiOperation({ summary: 'List tenant skill definitions' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived'] })
  @ApiOkResponse({ type: [DefinitionResponseDto] })
  async listSkills(@Req() request: ApiRequest, @Query('status') status?: string) {
    return (
      await this.employees.listSkills(this.principal(request), parseDefinitionStatus(status))
    ).map(definitionResponse);
  }

  @Post('skills')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a tenant skill definition' })
  @ApiBody({ type: CreateDefinitionDto })
  @ApiCreatedResponse({ type: DefinitionResponseDto })
  async createSkill(@Req() request: ApiRequest, @Body() body: unknown) {
    const parsed = createDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return definitionResponse(
      await this.employees.createSkill(
        this.principal(request),
        {
          name: parsed.data.name,
          code: parsed.data.code ?? null,
          description: parsed.data.description ?? null,
        },
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('skills/:id')
  @ApiOperation({ summary: 'Update a skill definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateDefinitionDto })
  @ApiOkResponse({ type: DefinitionResponseDto })
  async updateSkill(@Req() request: ApiRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = updateDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return definitionResponse(
      await this.employees.updateSkill(
        this.principal(request),
        parseId(id),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Post('skills/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a skill definition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DefinitionResponseDto })
  async archiveSkill(@Req() request: ApiRequest, @Param('id') id: string) {
    return definitionResponse(
      await this.employees.archiveSkill(
        this.principal(request),
        parseId(id),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Put('employees/:id/skills/:skillId')
  @ApiOperation({ summary: 'Assign an employee skill' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'skillId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async assignSkill(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('skillId') skillId: string,
  ) {
    return employeeDetailResponse(
      await this.employees.assignSkill(
        this.principal(request),
        parseId(id),
        parseId(skillId),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('employees/:id/skills/:skillId')
  @ApiOperation({ summary: 'Remove an employee skill' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'skillId', format: 'uuid' })
  @ApiOkResponse({ type: EmployeeDetailResponseDto })
  async removeSkill(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Param('skillId') skillId: string,
  ) {
    return employeeDetailResponse(
      await this.employees.removeSkill(
        this.principal(request),
        parseId(id),
        parseId(skillId),
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

function parseId(value: string): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new BadRequestException();
  return result.data;
}

function withoutUndefined<T extends object>(
  value: T,
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

function parseDefinitionStatus(value?: string): 'active' | 'archived' | undefined {
  if (value === undefined) return undefined;
  const result = definitionStatusSchema.safeParse(value);
  if (!result.success) throw new BadRequestException();
  return result.data;
}

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}

function employeeResponse(employee: EmployeeSnapshot, includeUserId: boolean): EmployeeResponseDto {
  return {
    ...employee,
    userId: includeUserId ? employee.userId : null,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

function employeeDetailResponse(employee: EmployeeDetailSnapshot): EmployeeDetailResponseDto {
  return {
    ...employeeResponse(employee, employee.linkedUser !== null),
    facilityAssignments: employee.facilityAssignments,
    teamMemberships: employee.teamMemberships,
    qualifications: employee.qualifications.map((qualification) => ({
      ...qualification,
      revokedAt: qualification.revokedAt?.toISOString() ?? null,
      updatedAt: qualification.updatedAt.toISOString(),
    })),
    skills: employee.skills,
    linkedUser: employee.linkedUser,
  };
}

function definitionResponse(
  definition: QualificationDefinitionSnapshot | SkillDefinitionSnapshot,
): DefinitionResponseDto {
  return {
    ...definition,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}
