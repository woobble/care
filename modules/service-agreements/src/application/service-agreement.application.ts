import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import {
  ClientArchivedError,
  type ClientApplicationService,
  type ClientSnapshot,
} from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { AuthorizationDeniedError, assertCan, can } from '@care/permissions';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { OrganizationApplicationService } from '@care/organizations';
import type { ServiceApplicationService } from '@care/services';
import {
  AgreementService,
  AgreementServiceDuplicateError,
  AgreementServiceInvalidValidityError,
  AgreementServiceNotFoundError,
  ServiceAgreement,
  ServiceAgreementAlreadyEndedError,
  ServiceAgreementNotFoundError,
  ServiceAgreementOverlapError,
  ServiceAgreementProviderContextError,
  ServiceAgreementRequiresServiceError,
  InvalidServiceAgreementQueryError,
  validateAgreementServiceFields,
  validateServiceAgreementData,
  type AgreementServiceFields,
  type AgreementServiceSnapshot,
  type AgreementStatus,
  type ServiceAgreementData,
  type AgreementServiceScheduleRule,
  type ServiceAgreementSnapshot,
} from '../domain/service-agreement';
import {
  ServiceAgreementRepository,
  type AgreementReadScope,
  type ServiceAgreementListRow,
  type ServiceAgreementSearchFilter,
} from '../infrastructure/service-agreement.repository';

type AuditContext = { ip?: string; userAgent?: string };

export interface ServiceAgreementSearchQuery {
  clientId?: string;
  status?: AgreementStatus;
  organizationId?: string;
  facilityId?: string;
  validAt?: string;
  serviceDefinitionId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'validFrom' | 'createdAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateServiceAgreementInput extends ServiceAgreementData {}

export interface AgreementServiceInput {
  serviceDefinitionId: string;
  validFrom?: string | null;
  validUntil?: string | null;
  quantity?: string | null;
  note?: string | null;
  scheduleRule?: AgreementServiceScheduleRule | null;
  preferredTimeStart?: string | null;
  preferredTimeEnd?: string | null;
}

export type AgreementServiceChanges = Partial<Omit<AgreementServiceInput, 'serviceDefinitionId'>>;

export class ServiceAgreementApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: ClientApplicationService,
    private readonly organizations: OrganizationApplicationService,
    private readonly services: ServiceApplicationService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository = new ServiceAgreementRepository(),
  ) {}

  async search(
    principal: AuthorizationPrincipal,
    query: ServiceAgreementSearchQuery = {},
  ): Promise<{ items: ServiceAgreementListRow[]; total: number; page: number; pageSize: number }> {
    const filter = this.searchFilter(principal, query);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      if (query.clientId) {
        await this.clients.getForServiceAgreement(transaction, principal, query.clientId);
      }
      const result = await this.repository.search(transaction, filter);
      return { ...result, page: filter.page, pageSize: filter.pageSize };
    });
  }

  async listForClient(
    principal: AuthorizationPrincipal,
    clientId: string,
    query: Omit<ServiceAgreementSearchQuery, 'clientId'> = {},
  ): Promise<{ items: ServiceAgreementListRow[]; total: number; page: number; pageSize: number }> {
    const filter = this.searchFilter(principal, { ...query, clientId });
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.clients.getForServiceAgreement(transaction, principal, clientId);
      const result = await this.repository.search(transaction, filter);
      return { ...result, page: filter.page, pageSize: filter.pageSize };
    });
  }

  async get(principal: AuthorizationPrincipal, id: string): Promise<ServiceAgreementSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const agreement = await this.repository.getAgreement(transaction, principal.tenantId, id);
      if (!agreement) throw new ServiceAgreementNotFoundError();
      await this.requireReadableAgreement(transaction, principal, agreement);
      return agreement;
    });
  }

  async create(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: CreateServiceAgreementInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    validateServiceAgreementData(input);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.getForServiceAgreement(
        transaction,
        principal,
        clientId,
        true,
      );
      if (client.status === 'archived') throw new ClientArchivedError();
      const provider = await this.requireClientProvider(transaction, principal.tenantId, client);
      const resource = agreementResource(client);
      assertCan(principal, { action: 'service_agreement.create', resource });
      const agreement = ServiceAgreement.create({
        id: uuidv7(),
        tenantId: principal.tenantId,
        clientId,
        organizationId: provider.organizationId,
        facilityId: provider.facilityId,
        ...input,
        createdAt: now,
        updatedAt: now,
      }).snapshot;
      await this.repository.insertAgreement(transaction, agreement);
      const event = createDomainEvent({
        type: 'service_agreement.created',
        tenantId: principal.tenantId,
        aggregateType: 'service_agreement',
        aggregateId: agreement.id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: {
          agreementId: agreement.id,
          clientId,
          organizationId: agreement.organizationId,
          facilityId: agreement.facilityId,
        },
      });
      await this.record(transaction, principal, context, auditContext, {
        id: agreement.id,
        clientId,
        action: 'service_agreement.created',
        timestamp: now,
        metadata: {
          clientId,
          organizationId: agreement.organizationId,
          facilityId: agreement.facilityId,
        },
        event,
      });
      return agreement;
    });
  }

  async update(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<ServiceAgreementData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { agreement: currentAgreement, client } = await this.lockForMutation(
        transaction,
        principal,
        id,
        'service_agreement.update',
      );
      if (client.status === 'archived') throw new ClientArchivedError();
      const agreement = ServiceAgreement.reconstitute(currentAgreement);
      const current = agreement.snapshot;
      const input: ServiceAgreementData = {
        validFrom: changes.validFrom ?? current.validFrom,
        validUntil: changes.validUntil === undefined ? current.validUntil : changes.validUntil,
        reference: changes.reference === undefined ? current.reference : changes.reference,
        description: changes.description === undefined ? current.description : changes.description,
      };
      validateServiceAgreementData(input);
      const changedFields = agreement.update(input);
      if (changedFields.length === 0) return agreement.snapshot;
      const snapshot = agreement.snapshot;
      if (snapshot.status === 'active') {
        await this.requireCurrentProvider(transaction, principal.tenantId, client, snapshot);
        await this.validateActiveServices(transaction, principal, snapshot);
        await this.ensureNoOverlap(transaction, snapshot, snapshot.id);
      }
      await this.repository.updateAgreement(transaction, snapshot);
      const event = createDomainEvent({
        type: 'service_agreement.updated',
        tenantId: principal.tenantId,
        aggregateType: 'service_agreement',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { agreementId: id, clientId: snapshot.clientId, changedFields },
      });
      await this.record(transaction, principal, context, auditContext, {
        id,
        clientId: snapshot.clientId,
        action: 'service_agreement.updated',
        timestamp: snapshot.updatedAt,
        metadata: { clientId: snapshot.clientId, changedFields },
        event,
      });
      return snapshot;
    });
  }

  async activate(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    return this.changeStatus(principal, id, 'activate', context, auditContext);
  }

  async suspend(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    return this.changeStatus(principal, id, 'suspend', context, auditContext);
  }

  async resume(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    return this.changeStatus(principal, id, 'resume', context, auditContext);
  }

  async end(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    return this.changeStatus(principal, id, 'end', context, auditContext);
  }

  async listServices(
    principal: AuthorizationPrincipal,
    agreementId: string,
  ): Promise<AgreementServiceSnapshot[]> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const agreement = await this.requireReadableAgreementById(
        transaction,
        principal,
        agreementId,
      );
      return this.repository.listServices(transaction, principal.tenantId, agreement.id);
    });
  }

  async addService(
    principal: AuthorizationPrincipal,
    agreementId: string,
    input: AgreementServiceInput,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<AgreementServiceSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { agreement, client } = await this.lockForMutation(
        transaction,
        principal,
        agreementId,
        'service_agreement.manage_services',
      );
      this.assertNotEnded(agreement);
      if (client.status === 'archived') throw new ClientArchivedError();
      await this.requireCurrentProvider(transaction, principal.tenantId, client, agreement);
      const fields = serviceFields(input);
      validateAgreementServiceFields({ ...fields, quantity: null }, 'occurrence');
      const period = servicePeriod(agreement, fields);
      const service = await this.services.getForAgreement(transaction, principal, {
        serviceDefinitionId: input.serviceDefinitionId,
        organizationId: agreement.organizationId,
        facilityId: agreement.facilityId,
        ...period,
        lock: true,
      });
      if (
        await this.repository.hasActiveServiceDefinition(
          transaction,
          principal.tenantId,
          agreementId,
          input.serviceDefinitionId,
        )
      ) {
        throw new AgreementServiceDuplicateError();
      }
      validateAgreementServiceFields(fields, service.unit);
      const line = AgreementService.create({
        id: uuidv7(),
        tenantId: principal.tenantId,
        agreementId,
        serviceDefinitionId: service.id,
        serviceCode: service.code,
        serviceName: service.name,
        serviceUnit: service.unit,
        status: 'active',
        endedAt: null,
        ...fields,
        createdAt: now,
        updatedAt: now,
      }).snapshot;
      await this.repository.insertService(transaction, line);
      const event = createDomainEvent({
        type: 'service_agreement.service_added',
        tenantId: principal.tenantId,
        aggregateType: 'service_agreement',
        aggregateId: agreementId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: {
          agreementId,
          clientId: agreement.clientId,
          agreementServiceId: line.id,
          serviceDefinitionId: line.serviceDefinitionId,
        },
      });
      await this.record(transaction, principal, context, auditContext, {
        id: agreementId,
        clientId: agreement.clientId,
        action: 'service_agreement.service_added',
        timestamp: now,
        metadata: {
          clientId: agreement.clientId,
          agreementServiceId: line.id,
          serviceDefinitionId: line.serviceDefinitionId,
        },
        event,
      });
      return line;
    });
  }

  async updateService(
    principal: AuthorizationPrincipal,
    agreementId: string,
    serviceId: string,
    changes: AgreementServiceChanges,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<AgreementServiceSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { agreement, client } = await this.lockForMutation(
        transaction,
        principal,
        agreementId,
        'service_agreement.manage_services',
      );
      this.assertNotEnded(agreement);
      if (client.status === 'archived') throw new ClientArchivedError();
      await this.requireCurrentProvider(transaction, principal.tenantId, client, agreement);
      const current = await this.repository.getService(
        transaction,
        principal.tenantId,
        agreementId,
        serviceId,
        true,
      );
      if (!current) throw new AgreementServiceNotFoundError();
      const line = AgreementService.reconstitute(current);
      const fields = mergeServiceFields(current, changes);
      const changedFields = line.update(fields);
      if (changedFields.length === 0) return line.snapshot;
      const period = servicePeriod(agreement, fields);
      await this.services.getForAgreement(transaction, principal, {
        serviceDefinitionId: current.serviceDefinitionId,
        organizationId: agreement.organizationId,
        facilityId: agreement.facilityId,
        ...period,
        lock: true,
      });
      const snapshot = line.snapshot;
      await this.repository.updateService(transaction, snapshot);
      const event = createDomainEvent({
        type: 'service_agreement.service_changed',
        tenantId: principal.tenantId,
        aggregateType: 'service_agreement',
        aggregateId: agreementId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: {
          agreementId,
          clientId: agreement.clientId,
          agreementServiceId: serviceId,
          serviceDefinitionId: current.serviceDefinitionId,
          changedFields,
        },
      });
      await this.record(transaction, principal, context, auditContext, {
        id: agreementId,
        clientId: agreement.clientId,
        action: 'service_agreement.service_updated',
        timestamp: snapshot.updatedAt,
        metadata: {
          clientId: agreement.clientId,
          agreementServiceId: serviceId,
          serviceDefinitionId: current.serviceDefinitionId,
          changedFields,
        },
        event,
      });
      return snapshot;
    });
  }

  async endService(
    principal: AuthorizationPrincipal,
    agreementId: string,
    serviceId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<AgreementServiceSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { agreement } = await this.lockForMutation(
        transaction,
        principal,
        agreementId,
        'service_agreement.manage_services',
      );
      this.assertNotEnded(agreement);
      const current = await this.repository.getService(
        transaction,
        principal.tenantId,
        agreementId,
        serviceId,
        true,
      );
      if (!current) throw new AgreementServiceNotFoundError();
      const line = AgreementService.reconstitute(current);
      if (
        agreement.status === 'active' &&
        (await this.repository.activeServiceCount(transaction, principal.tenantId, agreementId)) <=
          1
      ) {
        throw new ServiceAgreementRequiresServiceError();
      }
      line.end(now);
      const snapshot = line.snapshot;
      await this.repository.updateService(transaction, snapshot);
      const event = createDomainEvent({
        type: 'service_agreement.service_ended',
        tenantId: principal.tenantId,
        aggregateType: 'service_agreement',
        aggregateId: agreementId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: {
          agreementId,
          clientId: agreement.clientId,
          agreementServiceId: serviceId,
          serviceDefinitionId: current.serviceDefinitionId,
        },
      });
      await this.record(transaction, principal, context, auditContext, {
        id: agreementId,
        clientId: agreement.clientId,
        action: 'service_agreement.service_ended',
        timestamp: now,
        metadata: {
          clientId: agreement.clientId,
          agreementServiceId: serviceId,
          serviceDefinitionId: current.serviceDefinitionId,
        },
        event,
      });
      return snapshot;
    });
  }

  private async changeStatus(
    principal: AuthorizationPrincipal,
    id: string,
    operation: 'activate' | 'suspend' | 'resume' | 'end',
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAgreementSnapshot> {
    const action: Permission =
      operation === 'suspend'
        ? 'service_agreement.suspend'
        : operation === 'end'
          ? 'service_agreement.end'
          : 'service_agreement.activate';
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { agreement, client } = await this.lockForMutation(
        transaction,
        principal,
        id,
        action,
        operation === 'end',
      );
      const entity = ServiceAgreement.reconstitute(agreement);
      if (operation === 'activate' || operation === 'resume') {
        if (operation === 'activate') entity.activate(now);
        else entity.resume(now);
        if (client.status === 'archived') throw new ClientArchivedError();
        await this.requireCurrentProvider(transaction, principal.tenantId, client, agreement);
        await this.validateActivation(transaction, principal, agreement);
        await this.ensureNoOverlap(transaction, agreement, agreement.id);
      } else if (operation === 'suspend') {
        entity.suspend(now);
      } else {
        entity.end(now);
        await this.repository.endActiveServices(transaction, principal.tenantId, id, now);
      }
      const snapshot = entity.snapshot;
      await this.repository.updateAgreement(transaction, snapshot);
      const eventType =
        operation === 'activate'
          ? 'service_agreement.activated'
          : operation === 'suspend'
            ? 'service_agreement.suspended'
            : operation === 'resume'
              ? 'service_agreement.resumed'
              : 'service_agreement.ended';
      const event = createDomainEvent({
        type: eventType,
        tenantId: principal.tenantId,
        aggregateType: 'service_agreement',
        aggregateId: id,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { agreementId: id, clientId: snapshot.clientId },
      });
      await this.record(transaction, principal, context, auditContext, {
        id,
        clientId: snapshot.clientId,
        action: eventType,
        timestamp: now,
        metadata: { clientId: snapshot.clientId, status: snapshot.status },
        event,
      });
      return snapshot;
    });
  }

  private async validateActivation(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    agreement: ServiceAgreementSnapshot,
  ): Promise<void> {
    const lines = await this.repository.listServices(transaction, principal.tenantId, agreement.id);
    const active = lines.filter((line) => line.status === 'active');
    if (active.length === 0) throw new ServiceAgreementRequiresServiceError();
    // Definition locks share this transaction; keep the stable repository order to avoid lock
    // ordering differences and return validation errors consistently.
    // oxlint-disable no-await-in-loop
    for (const line of active) {
      validateAgreementServiceFields(line, line.serviceUnit);
      const period = servicePeriod(agreement, line);
      await this.services.getForAgreement(transaction, principal, {
        serviceDefinitionId: line.serviceDefinitionId,
        organizationId: agreement.organizationId,
        facilityId: agreement.facilityId,
        ...period,
        lock: true,
      });
    }
    // oxlint-enable no-await-in-loop
  }

  private async validateActiveServices(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    agreement: ServiceAgreementSnapshot,
  ): Promise<void> {
    const lines = await this.repository.listServices(transaction, principal.tenantId, agreement.id);
    // Definition locks share this transaction; keep the stable repository order to avoid lock
    // ordering differences and return validation errors consistently.
    // oxlint-disable no-await-in-loop
    for (const line of lines.filter((service) => service.status === 'active')) {
      const entity = AgreementService.reconstitute(line);
      validateAgreementServiceFields(entity.snapshot, entity.snapshot.serviceUnit);
      const period = servicePeriod(agreement, entity.snapshot);
      await this.services.getForAgreement(transaction, principal, {
        serviceDefinitionId: line.serviceDefinitionId,
        organizationId: agreement.organizationId,
        facilityId: agreement.facilityId,
        ...period,
        lock: true,
      });
    }
    // oxlint-enable no-await-in-loop
  }

  private async requireClientProvider(
    transaction: DatabaseTransaction,
    tenantId: string,
    client: ClientSnapshot,
  ) {
    if (!client.organizationId || !client.primaryFacilityId) {
      throw new ServiceAgreementProviderContextError();
    }
    const provider = await this.organizations.activeProviderContextForAgreement(
      transaction,
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
      true,
    );
    if (!provider) throw new ServiceAgreementProviderContextError();
    return provider;
  }

  private async requireCurrentProvider(
    transaction: DatabaseTransaction,
    tenantId: string,
    client: ClientSnapshot,
    agreement: ServiceAgreementSnapshot,
  ): Promise<void> {
    const provider = await this.requireClientProvider(transaction, tenantId, client);
    if (
      provider.organizationId !== agreement.organizationId ||
      provider.facilityId !== agreement.facilityId
    ) {
      throw new ServiceAgreementProviderContextError();
    }
  }

  private async ensureNoOverlap(
    transaction: DatabaseTransaction,
    agreement: ServiceAgreementSnapshot,
    excludeId?: string,
  ): Promise<void> {
    if (
      await this.repository.hasActiveOverlap(transaction, {
        tenantId: agreement.tenantId,
        clientId: agreement.clientId,
        organizationId: agreement.organizationId,
        facilityId: agreement.facilityId,
        validFrom: agreement.validFrom,
        validUntil: agreement.validUntil,
        ...(excludeId === undefined ? {} : { excludeId }),
      })
    ) {
      throw new ServiceAgreementOverlapError();
    }
  }

  private async lockForMutation(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    id: string,
    action: Permission,
    allowArchivedClient = false,
  ): Promise<{ agreement: ServiceAgreementSnapshot; client: ClientSnapshot }> {
    const initial = await this.repository.getAgreement(transaction, principal.tenantId, id);
    if (!initial) throw new ServiceAgreementNotFoundError();
    await this.requireAgreementPermission(principal, initial, action);
    const client = await this.clients.getForServiceAgreement(
      transaction,
      principal,
      initial.clientId,
      true,
    );
    if (client.status === 'archived' && !allowArchivedClient) throw new ClientArchivedError();
    const locked = await this.repository.getAgreement(transaction, principal.tenantId, id, true);
    if (!locked || locked.clientId !== client.id) throw new ServiceAgreementNotFoundError();
    await this.requireAgreementPermission(principal, locked, action);
    return { agreement: locked, client };
  }

  private async requireReadableAgreementById(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    id: string,
  ): Promise<ServiceAgreementSnapshot> {
    const agreement = await this.repository.getAgreement(transaction, principal.tenantId, id);
    if (!agreement) throw new ServiceAgreementNotFoundError();
    await this.requireReadableAgreement(transaction, principal, agreement);
    return agreement;
  }

  private async requireReadableAgreement(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    agreement: ServiceAgreementSnapshot,
  ): Promise<void> {
    await this.clients.getForServiceAgreement(transaction, principal, agreement.clientId);
    if (
      !can(principal, {
        action: 'service_agreement.read',
        resource: agreementResource(agreement),
      })
    ) {
      throw new ServiceAgreementNotFoundError();
    }
  }

  private async requireAgreementPermission(
    principal: AuthorizationPrincipal,
    agreement: ServiceAgreementSnapshot,
    action: Permission,
  ): Promise<void> {
    const clientResource = {
      tenantId: agreement.tenantId,
      clientId: agreement.clientId,
      organizationId: agreement.organizationId,
      facilityId: agreement.facilityId,
    };
    if (!can(principal, { action: 'client.read', resource: clientResource })) {
      throw new ServiceAgreementNotFoundError();
    }
    assertCan(principal, { action, resource: clientResource });
  }

  private assertNotEnded(agreement: ServiceAgreementSnapshot): void {
    if (agreement.status === 'ended') throw new ServiceAgreementAlreadyEndedError();
  }

  private searchFilter(
    principal: AuthorizationPrincipal,
    query: ServiceAgreementSearchQuery,
  ): ServiceAgreementSearchFilter {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (query.validAt !== undefined && !isISODate(query.validAt))
    ) {
      throw new InvalidServiceAgreementQueryError();
    }
    const clientReadScope = readScopeFor(principal, 'client.read');
    const agreementReadScope = readScopeFor(principal, 'service_agreement.read');
    return {
      tenantId: principal.tenantId,
      clientReadScope,
      agreementReadScope,
      ...(query.clientId === undefined ? {} : { clientId: query.clientId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.organizationId === undefined ? {} : { organizationId: query.organizationId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.validAt === undefined ? {} : { validAt: query.validAt }),
      ...(query.serviceDefinitionId === undefined
        ? {}
        : { serviceDefinitionId: query.serviceDefinitionId }),
      page,
      pageSize,
      sortBy: query.sortBy ?? 'validFrom',
      sortOrder: query.sortOrder ?? 'desc',
    };
  }

  private async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    input: {
      id: string;
      clientId: string;
      action: string;
      timestamp: Date;
      metadata: Record<string, unknown>;
      event: ReturnType<typeof createDomainEvent>;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: input.event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'service_agreement',
      resourceId: input.id,
      timestamp: input.timestamp,
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: { ...input.metadata, clientId: input.clientId },
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

function agreementResource(client: ClientSnapshot): {
  tenantId: string;
  clientId: string;
  organizationId?: string;
  facilityId?: string;
};
function agreementResource(agreement: ServiceAgreementSnapshot): {
  tenantId: string;
  clientId: string;
  organizationId: string;
  facilityId: string;
};
function agreementResource(resource: ClientSnapshot | ServiceAgreementSnapshot) {
  if ('clientId' in resource) {
    return {
      tenantId: resource.tenantId,
      clientId: resource.clientId,
      organizationId: resource.organizationId,
      facilityId: resource.facilityId,
    };
  }
  return {
    tenantId: resource.tenantId,
    clientId: resource.id,
    ...(resource.organizationId ? { organizationId: resource.organizationId } : {}),
    ...(resource.primaryFacilityId ? { facilityId: resource.primaryFacilityId } : {}),
  };
}

function readScopeFor(
  principal: AuthorizationPrincipal,
  permission: 'client.read' | 'service_agreement.read',
): AgreementReadScope {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  const scope: AgreementReadScope = {
    tenantWide: grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    ),
    organizationIds: [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ],
    facilityIds: [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ],
  };
  if (!scope.tenantWide && scope.organizationIds.length === 0 && scope.facilityIds.length === 0) {
    throw new AuthorizationDeniedError(permission);
  }
  return scope;
}

function serviceFields(input: AgreementServiceInput): AgreementServiceFields {
  return {
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    quantity: input.quantity ?? null,
    note: input.note?.trim() || null,
    scheduleRule: input.scheduleRule ?? null,
    preferredTimeStart: input.preferredTimeStart ?? null,
    preferredTimeEnd: input.preferredTimeEnd ?? null,
  };
}

function mergeServiceFields(
  current: AgreementServiceSnapshot,
  changes: AgreementServiceChanges,
): AgreementServiceFields {
  return {
    validFrom: changes.validFrom === undefined ? current.validFrom : changes.validFrom,
    validUntil: changes.validUntil === undefined ? current.validUntil : changes.validUntil,
    quantity: changes.quantity === undefined ? current.quantity : changes.quantity,
    note: changes.note === undefined ? current.note : changes.note?.trim() || null,
    scheduleRule: changes.scheduleRule === undefined ? current.scheduleRule : changes.scheduleRule,
    preferredTimeStart:
      changes.preferredTimeStart === undefined
        ? current.preferredTimeStart
        : changes.preferredTimeStart,
    preferredTimeEnd:
      changes.preferredTimeEnd === undefined ? current.preferredTimeEnd : changes.preferredTimeEnd,
  };
}

function servicePeriod(
  agreement: ServiceAgreementSnapshot,
  fields: Pick<AgreementServiceFields, 'validFrom' | 'validUntil'>,
): { validFrom: string; validUntil: string | null } {
  const validFrom = fields.validFrom ?? agreement.validFrom;
  const validUntil = fields.validUntil ?? agreement.validUntil;
  if (
    validFrom < agreement.validFrom ||
    (agreement.validUntil !== null && (validUntil === null || validUntil > agreement.validUntil)) ||
    (validUntil !== null && validUntil < validFrom)
  ) {
    throw new AgreementServiceInvalidValidityError();
  }
  return { validFrom, validUntil };
}

function isISODate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createServiceAgreementApplicationService(
  unitOfWork: UnitOfWork,
  clients: ClientApplicationService,
  organizations: OrganizationApplicationService,
  services: ServiceApplicationService,
  audit: AuditWriter,
  outbox: OutboxWriter,
): ServiceAgreementApplicationService {
  return new ServiceAgreementApplicationService(
    unitOfWork,
    clients,
    organizations,
    services,
    audit,
    outbox,
  );
}
