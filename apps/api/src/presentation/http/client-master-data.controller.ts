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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { requestContext, type ApiRequest } from '@app/api/http/request';
import { CLIENT_MASTER_DATA_APPLICATION } from '@app/api/tokens';
import { ClientMasterDataApplicationService } from '@care/clients';

import {
  ClientAddressResponseDto,
  ClientContactInputDto,
  ClientContactPatchDto,
  ClientContactResponseDto,
  ClientContactSearchResponseDto,
  ClientInsuranceInputDto,
  ClientInsurancePatchDto,
  ClientInsuranceResponseDto,
  ClientTimelineEntryDto,
  CreateClientAddressDto,
  PflegegradInputDto,
  PflegegradPatchDto,
  PflegegradResponseDto,
  UpdateClientAddressDto,
  createAddressSchema,
  createContactSchema,
  createInsuranceSchema,
  createPflegegradSchema,
  updateAddressSchema,
  updateContactSchema,
  updateInsuranceSchema,
  updatePflegegradSchema,
} from './clients.dto';
import {
  clientAddressResponse,
  clientContactResponse,
  clientInsuranceResponse,
  clientTimelineResponse,
  pflegegradResponse,
} from './clients.mapper';
import { ProblemDetailsDto } from './dto';
import { withoutUndefined } from './validation';

@ApiTags('clients')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant selected for this request' })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Problem Details response' })
@UseGuards(OidcGuard, TenantContextGuard)
@Controller('api/v1/clients/:clientId')
export class ClientMasterDataController {
  constructor(
    @Inject(CLIENT_MASTER_DATA_APPLICATION)
    private readonly clients: ClientMasterDataApplicationService,
  ) {}

  @Get('addresses')
  @ApiOperation({ summary: 'List client addresses' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [ClientAddressResponseDto] })
  async listAddresses(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return (await this.clients.listAddresses(this.principal(request), parseId(clientId))).map(
      clientAddressResponse,
    );
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a client address' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: CreateClientAddressDto })
  @ApiCreatedResponse({ type: ClientAddressResponseDto })
  async addAddress(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = createAddressSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientAddressResponse(
      await this.clients.addAddress(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('addresses/:addressId')
  @ApiOperation({ summary: 'Update a client address' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiBody({ type: UpdateClientAddressDto })
  @ApiOkResponse({ type: ClientAddressResponseDto })
  async updateAddress(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('addressId') addressId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateAddressSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientAddressResponse(
      await this.clients.updateAddress(
        this.principal(request),
        parseId(clientId),
        parseId(addressId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a client address' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiNoContentResponse()
  async removeAddress(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.clients.removeAddress(
      this.principal(request),
      parseId(clientId),
      parseId(addressId),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('contacts')
  @ApiOperation({ summary: 'List client contacts and structured roles' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [ClientContactResponseDto] })
  async listContacts(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return (await this.clients.listContacts(this.principal(request), parseId(clientId))).map(
      clientContactResponse,
    );
  }

  @Get('contacts/search')
  @ApiOperation({ summary: 'Search a single client’s contacts for a bounded selector' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiQuery({ name: 'q', required: true, type: String, minLength: 2, maxLength: 120 })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: ClientContactSearchResponseDto })
  async searchContacts(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<ClientContactSearchResponseDto> {
    const parsed = z
      .object({
        q: z.string().trim().min(2).max(120),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const result = await this.clients.searchContacts(this.principal(request), parseId(clientId), {
      search: parsed.data.q,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return {
      ...result,
      items: result.items.map(({ id, firstName, lastName, relationshipType }) => ({
        id,
        firstName,
        lastName,
        relationshipType,
      })),
    };
  }

  @Post('contacts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a client contact' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: ClientContactInputDto })
  @ApiCreatedResponse({ type: ClientContactResponseDto })
  async addContact(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = createContactSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientContactResponse(
      await this.clients.addContact(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('contacts/:contactId')
  @ApiOperation({ summary: 'Update a client contact and its roles' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiBody({ type: ClientContactPatchDto })
  @ApiOkResponse({ type: ClientContactResponseDto })
  async updateContact(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateContactSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientContactResponse(
      await this.clients.updateContact(
        this.principal(request),
        parseId(clientId),
        parseId(contactId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Delete('contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a client contact' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiNoContentResponse()
  async removeContact(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
  ): Promise<void> {
    await this.clients.removeContact(
      this.principal(request),
      parseId(clientId),
      parseId(contactId),
      requestContext(request),
      auditContext(request),
    );
  }

  @Get('insurances')
  @ApiOperation({ summary: 'List client insurance relationships' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [ClientInsuranceResponseDto] })
  async listInsurances(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return (await this.clients.listInsurances(this.principal(request), parseId(clientId))).map(
      clientInsuranceResponse,
    );
  }

  @Post('insurances')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an insurance relationship' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: ClientInsuranceInputDto })
  @ApiCreatedResponse({ type: ClientInsuranceResponseDto })
  async addInsurance(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = createInsuranceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientInsuranceResponse(
      await this.clients.addInsurance(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('insurances/:insuranceId')
  @ApiOperation({ summary: 'Update an insurance relationship' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'insuranceId', format: 'uuid' })
  @ApiBody({ type: ClientInsurancePatchDto })
  @ApiOkResponse({ type: ClientInsuranceResponseDto })
  async updateInsurance(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('insuranceId') insuranceId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateInsuranceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return clientInsuranceResponse(
      await this.clients.updateInsurance(
        this.principal(request),
        parseId(clientId),
        parseId(insuranceId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('pflegegrade')
  @ApiOperation({ summary: 'List Pflegegrad history' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [PflegegradResponseDto] })
  async listPflegegrade(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return (await this.clients.listPflegegrade(this.principal(request), parseId(clientId))).map(
      pflegegradResponse,
    );
  }

  @Post('pflegegrade')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a Pflegegrad history record' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiBody({ type: PflegegradInputDto })
  @ApiCreatedResponse({ type: PflegegradResponseDto })
  async addPflegegrad(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const parsed = createPflegegradSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return pflegegradResponse(
      await this.clients.addPflegegrad(
        this.principal(request),
        parseId(clientId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Patch('pflegegrade/:recordId')
  @ApiOperation({ summary: 'Update a future pending Pflegegrad record' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiBody({ type: PflegegradPatchDto })
  @ApiOkResponse({ type: PflegegradResponseDto })
  async updatePflegegrad(
    @Req() request: ApiRequest,
    @Param('clientId') clientId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const parsed = updatePflegegradSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return pflegegradResponse(
      await this.clients.updatePflegegrad(
        this.principal(request),
        parseId(clientId),
        parseId(recordId),
        withoutUndefined(parsed.data),
        requestContext(request),
        auditContext(request),
      ),
    );
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Read a client-oriented timeline' })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: [ClientTimelineEntryDto] })
  async timeline(@Req() request: ApiRequest, @Param('clientId') clientId: string) {
    return (await this.clients.timeline(this.principal(request), parseId(clientId))).map(
      clientTimelineResponse,
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

function auditContext(request: ApiRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
