import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { assertCan, type AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { OrganizationRepository } from '@care/organizations';
import {
  Client,
  type ClientPersonalData,
  type ClientProviderContext,
  type ClientSnapshot,
  type ClientStatus,
  InvalidProviderContextError,
} from '@module/clients/domain/client';
import {
  validateClientAddress,
  type ClientAddressData,
  type ClientAddressSnapshot,
} from '@module/clients/domain/client-master-data';
import { clientScopeFilter, authorizeClientResource } from './client-access';
import { appendClientChange } from './client-change';
import {
  ClientNotFoundError,
  FacilityNotInOrganizationError,
  InvalidPaginationError,
} from './errors';
import { ClientMasterDataRepository } from '@module/clients/infrastructure/persistence/client-master-data.repository';
import { ClientRepository } from '@module/clients/infrastructure/persistence/client.repository';

export interface CreateClientInput extends ClientPersonalData, ClientProviderContext {
  primaryAddress?: ClientAddressData | null;
}

export interface ClientServiceAgreementGuard {
  hasActiveForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
}

export interface ClientSchedulingGuard {
  hasVisitsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
  hasFutureVisitsForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
}

export interface ClientExecutionGuard {
  hasInProgressExecutionForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
}

export interface ClientSearchQuery {
  text?: string;
  status?: ClientStatus;
  organizationId?: string;
  facilityId?: string;
  pflegegrad?: number;
  page?: number;
  pageSize?: number;
  sortBy?: 'lastName' | 'firstName' | 'createdAt' | 'dateOfBirth';
  sortOrder?: 'asc' | 'desc';
}

export class ClientApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: ClientRepository,
    private readonly masterData: ClientMasterDataRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly serviceAgreements?: ClientServiceAgreementGuard,
    private readonly scheduling?: ClientSchedulingGuard,
    private readonly execution?: ClientExecutionGuard,
  ) {}

  async getForServiceAgreement(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    id: string,
    lock = false,
  ): Promise<ClientSnapshot> {
    return (await this.requireClient(transaction, principal, id, 'client.read', lock)).snapshot;
  }

  async search(principal: AuthorizationPrincipal, query: ClientSearchQuery = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sortBy = query.sortBy ?? 'lastName';
    const sortOrder = query.sortOrder ?? 'asc';
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (query.pflegegrad !== undefined &&
        (!Number.isInteger(query.pflegegrad) || query.pflegegrad < 1 || query.pflegegrad > 5))
    ) {
      throw new InvalidPaginationError();
    }
    const access = clientScopeFilter(principal, 'client.read');
    const validAt = new Date().toISOString().slice(0, 10);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.clients.search(transaction, {
        tenantId: principal.tenantId,
        access,
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.organizationId === undefined ? {} : { organizationId: query.organizationId }),
        ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
        ...(query.pflegegrad === undefined ? {} : { pflegegrad: query.pflegegrad }),
        page,
        pageSize,
        sortBy,
        sortOrder,
        validAt,
      }),
    );
  }

  async get(principal: AuthorizationPrincipal, id: string): Promise<ClientSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.clients.findById(transaction, principal.tenantId, id);
      if (!client) throw new ClientNotFoundError();
      authorizeClientResource(principal, 'client.read', client);
      return client;
    });
  }

  async create(
    principal: AuthorizationPrincipal,
    data: CreateClientInput,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    const now = new Date();
    if (data.primaryAddress) validateClientAddress({ ...data.primaryAddress, isPrimary: true });
    const client = Client.pending({
      id: uuidv7(),
      tenantId: principal.tenantId,
      organizationId: data.organizationId,
      primaryFacilityId: data.primaryFacilityId,
      firstName: data.firstName,
      lastName: data.lastName,
      preferredName: data.preferredName ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      dateOfDeath: data.dateOfDeath ?? null,
      gender: data.gender ?? null,
      salutation: data.salutation ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      mobile: data.mobile ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.validateProviderContext(transaction, principal.tenantId, data);
      assertCan(principal, {
        action: 'client.create',
        resource: {
          tenantId: principal.tenantId,
          organizationId: data.organizationId,
          facilityId: data.primaryFacilityId,
        },
      });
      const snapshot = client.snapshot;
      await this.clients.insert(transaction, snapshot);
      await appendClientChange({
        transaction,
        audit: this.audit,
        outbox: this.outbox,
        principal,
        context,
        auditContext,
        clientId: snapshot.id,
        occurredAt: now,
        action: 'client.created',
        metadata: {
          changedFields: [
            'firstName',
            'lastName',
            'preferredName',
            'dateOfBirth',
            'dateOfDeath',
            'gender',
            'salutation',
            'email',
            'phone',
            'mobile',
            'organizationId',
            'primaryFacilityId',
          ],
        },
        event: createDomainEvent({
          type: 'client.created',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: snapshot.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId: snapshot.id },
        }),
      });
      if (data.primaryAddress) {
        const address = this.addressSnapshot(
          principal.tenantId,
          snapshot.id,
          { ...data.primaryAddress, isPrimary: true },
          now,
        );
        await this.masterData.insertAddress(transaction, address);
        await appendClientChange({
          transaction,
          audit: this.audit,
          outbox: this.outbox,
          principal,
          context,
          auditContext,
          clientId: snapshot.id,
          occurredAt: now,
          action: 'client.address_added',
          metadata: { addressId: address.id, isPrimary: true },
          event: createDomainEvent({
            type: 'client.address_changed',
            tenantId: principal.tenantId,
            aggregateType: 'client',
            aggregateId: snapshot.id,
            actor: { type: 'user', id: principal.userId },
            correlationId: context.correlationId,
            payload: { clientId: snapshot.id, addressId: address.id, operation: 'added' },
          }),
        });
      }
    });
    return client.snapshot;
  }

  async update(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<ClientPersonalData>,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal, id, 'client.update', true);
      const current = client.snapshot;
      const changedFields = client.updatePersonalData({
        firstName: changes.firstName ?? current.firstName,
        lastName: changes.lastName ?? current.lastName,
        preferredName:
          changes.preferredName === undefined
            ? (current.preferredName ?? null)
            : changes.preferredName,
        dateOfBirth:
          changes.dateOfBirth === undefined ? (current.dateOfBirth ?? null) : changes.dateOfBirth,
        dateOfDeath:
          changes.dateOfDeath === undefined ? (current.dateOfDeath ?? null) : changes.dateOfDeath,
        gender: changes.gender === undefined ? (current.gender ?? null) : changes.gender,
        salutation:
          changes.salutation === undefined ? (current.salutation ?? null) : changes.salutation,
        email: changes.email === undefined ? (current.email ?? null) : changes.email,
        phone: changes.phone === undefined ? (current.phone ?? null) : changes.phone,
        mobile: changes.mobile === undefined ? (current.mobile ?? null) : changes.mobile,
      });
      if (changedFields.length === 0) return client.snapshot;
      const snapshot = client.snapshot;
      await this.clients.update(transaction, snapshot);
      await appendClientChange({
        transaction,
        audit: this.audit,
        outbox: this.outbox,
        principal,
        context,
        auditContext,
        clientId: id,
        occurredAt: snapshot.updatedAt,
        action: 'client.updated',
        metadata: { changedFields },
        event: createDomainEvent({
          type: 'client.updated',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId: id, changedFields },
        }),
      });
      return snapshot;
    });
  }

  async changeProviderContext(
    principal: AuthorizationPrincipal,
    id: string,
    contextChange: ClientProviderContext,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal, id, 'client.update', true);
      await this.validateProviderContext(transaction, principal.tenantId, contextChange);
      assertCan(principal, {
        action: 'client.update',
        resource: {
          tenantId: principal.tenantId,
          organizationId: contextChange.organizationId,
          facilityId: contextChange.primaryFacilityId,
          clientId: id,
        },
      });
      const previous = client.snapshot;
      if (
        (previous.organizationId !== contextChange.organizationId ||
          previous.primaryFacilityId !== contextChange.primaryFacilityId) &&
        (await this.serviceAgreements?.hasActiveForClient(transaction, principal.tenantId, id))
      ) {
        throw new ClientHasActiveServiceAgreementsError();
      }
      if (
        (previous.organizationId !== contextChange.organizationId ||
          previous.primaryFacilityId !== contextChange.primaryFacilityId) &&
        (await this.scheduling?.hasVisitsForClient(transaction, principal.tenantId, id))
      ) {
        throw new FutureVisitsExistError(
          'Provider context cannot change after a visit is recorded',
        );
      }
      const changedFields = client.changeProviderContext(contextChange);
      if (changedFields.length === 0) return previous;
      const snapshot = client.snapshot;
      await this.clients.update(transaction, snapshot);
      await appendClientChange({
        transaction,
        audit: this.audit,
        outbox: this.outbox,
        principal,
        context,
        auditContext,
        clientId: id,
        occurredAt: snapshot.updatedAt,
        action: 'client.provider_context_changed',
        metadata: {
          previousOrganizationId: previous.organizationId,
          previousFacilityId: previous.primaryFacilityId,
          organizationId: snapshot.organizationId,
          primaryFacilityId: snapshot.primaryFacilityId,
        },
        event: createDomainEvent({
          type: 'client.provider_context_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: {
            clientId: id,
            previousOrganizationId: previous.organizationId,
            previousFacilityId: previous.primaryFacilityId,
            organizationId: snapshot.organizationId!,
            primaryFacilityId: snapshot.primaryFacilityId!,
          },
        }),
      });
      return snapshot;
    });
  }

  async activate(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    return this.changeStatus(principal, id, 'activate', context, auditContext);
  }

  async archive(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    return this.changeStatus(principal, id, 'archive', context, auditContext);
  }

  private async changeStatus(
    principal: AuthorizationPrincipal,
    id: string,
    operation: 'activate' | 'archive',
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    const action = operation === 'archive' ? 'client.archive' : 'client.update';
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal, id, action, true);
      if (operation === 'activate') client.activate();
      else {
        client.archive();
        if (await this.serviceAgreements?.hasActiveForClient(transaction, principal.tenantId, id)) {
          throw new ClientHasActiveServiceAgreementsError();
        }
        if (await this.scheduling?.hasFutureVisitsForClient(transaction, principal.tenantId, id)) {
          throw new FutureVisitsExistError();
        }
        if (
          await this.execution?.hasInProgressExecutionForClient(transaction, principal.tenantId, id)
        ) {
          throw new ClientExecutionInProgressError();
        }
      }
      const snapshot = client.snapshot;
      await this.clients.update(transaction, snapshot);
      const eventType = operation === 'activate' ? 'client.activated' : 'client.archived';
      await appendClientChange({
        transaction,
        audit: this.audit,
        outbox: this.outbox,
        principal,
        context,
        auditContext,
        clientId: id,
        occurredAt: snapshot.updatedAt,
        action: eventType,
        metadata: { changedFields: ['status'] },
        event: createDomainEvent({
          type: eventType,
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId: id },
        }),
      });
      return snapshot;
    });
  }

  private async requireClient(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    id: string,
    action: 'client.read' | 'client.update' | 'client.archive',
    lock: boolean,
  ): Promise<Client> {
    const row = await this.clients.findById(transaction, principal.tenantId, id, lock);
    if (!row) throw new ClientNotFoundError();
    authorizeClientResource(principal, action, row);
    return Client.reconstitute(row);
  }

  private async validateProviderContext(
    transaction: DatabaseTransaction,
    tenantId: string,
    context: ClientProviderContext,
  ): Promise<void> {
    const organization = await this.organizations.getOrganization(
      transaction,
      tenantId,
      context.organizationId,
      true,
    );
    const facility = await this.organizations.getFacility(
      transaction,
      tenantId,
      context.primaryFacilityId,
      true,
    );
    if (!organization || !facility) throw new InvalidProviderContextError();
    if (facility.organizationId !== context.organizationId)
      throw new FacilityNotInOrganizationError();
    if (organization.status !== 'active' || facility.status !== 'active')
      throw new InvalidProviderContextError();
  }

  private addressSnapshot(
    tenantId: string,
    clientId: string,
    data: ClientAddressData,
    now: Date,
  ): ClientAddressSnapshot {
    return {
      id: uuidv7(),
      tenantId,
      clientId,
      addressType: data.addressType,
      street: data.street,
      houseNumber: data.houseNumber ?? null,
      addressAddition: data.addressAddition ?? null,
      postalCode: data.postalCode ?? null,
      city: data.city,
      countryCode: data.countryCode ?? 'DE',
      validFrom: data.validFrom ?? null,
      validUntil: data.validUntil ?? null,
      isPrimary: data.isPrimary,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export function createClientApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  serviceAgreements?: ClientServiceAgreementGuard,
  scheduling?: ClientSchedulingGuard,
  execution?: ClientExecutionGuard,
): ClientApplicationService {
  return new ClientApplicationService(
    unitOfWork,
    new ClientRepository(),
    new ClientMasterDataRepository(),
    new OrganizationRepository(),
    audit,
    outbox,
    serviceAgreements,
    scheduling,
    execution,
  );
}

export class ClientHasActiveServiceAgreementsError extends Error {
  readonly code = 'CLIENT_HAS_ACTIVE_SERVICE_AGREEMENTS';

  constructor() {
    super('End active service agreements before changing or archiving this client');
    this.name = 'ClientHasActiveServiceAgreementsError';
  }
}

export class FutureVisitsExistError extends Error {
  readonly code = 'FUTURE_VISITS_EXIST';

  constructor(message = 'Resolve future scheduled visits before archiving this client') {
    super(message);
    this.name = 'FutureVisitsExistError';
  }
}

export class ClientExecutionInProgressError extends Error {
  readonly code = 'CLIENT_EXECUTION_IN_PROGRESS';

  constructor() {
    super('Complete the in-progress visit before archiving this client');
    this.name = 'ClientExecutionInProgressError';
  }
}
