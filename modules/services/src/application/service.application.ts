import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { AuthorizationDeniedError, assertCan, can } from '@care/permissions';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { OrganizationRepository } from '@care/organizations';
import {
  ServiceDefinition,
  InvalidServiceAvailabilityError,
  InvalidServicePaginationError,
  ServiceCategoryArchivedError,
  ServiceCategoryNotFoundError,
  ServiceDefinitionArchivedError,
  ServiceNotFoundError,
  validateServiceAvailability,
  validateServiceCategory,
  validateServiceDefinition,
  type ServiceAvailabilityData,
  type ServiceAvailabilitySnapshot,
  type ServiceCategoryData,
  type ServiceCategorySnapshot,
  type ServiceDefinitionData,
  type ServiceDefinitionSnapshot,
} from '@module/services/domain/service';
import {
  ServiceRepository,
  type ServiceReadScope,
} from '@module/services/infrastructure/service.repository';

type AuditContext = { ip?: string; userAgent?: string };

export interface ServiceSearchQuery {
  text?: string;
  status?: 'active' | 'archived' | 'all';
  categoryId?: string;
  organizationId?: string;
  facilityId?: string;
  validAt?: string;
  validFrom?: string;
  validUntil?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'category' | 'status' | 'code';
  sortOrder?: 'asc' | 'desc';
}

export interface ServiceAgreementArchiveGuard {
  hasActiveForService(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceDefinitionId: string,
  ): Promise<boolean>;
}

export class ServiceApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly services: ServiceRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly serviceAgreements?: ServiceAgreementArchiveGuard,
  ) {}

  async listCategories(
    principal: AuthorizationPrincipal,
    includeArchived = false,
  ): Promise<ServiceCategorySnapshot[]> {
    this.serviceReadScope(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.services.listCategories(transaction, principal.tenantId, includeArchived),
    );
  }

  async getCategory(
    principal: AuthorizationPrincipal,
    id: string,
  ): Promise<ServiceCategorySnapshot> {
    this.serviceReadScope(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const category = await this.services.getCategory(transaction, principal.tenantId, id);
      if (!category) throw new ServiceCategoryNotFoundError();
      return category;
    });
  }

  async createCategory(
    principal: AuthorizationPrincipal,
    data: ServiceCategoryData,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceCategorySnapshot> {
    this.requireTenantPermission(principal, 'service.manage_categories');
    validateServiceCategory(data);
    const now = new Date();
    const id = uuidv7();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const category = await this.services.insertCategory(
        transaction,
        principal.tenantId,
        id,
        data,
        now,
      );
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id,
        resourceType: 'service_category',
        action: 'service.category_created',
        occurredAt: now,
        metadata: { changedFields: ['name', 'code', 'description', 'sortOrder'] },
        event: createDomainEvent({
          type: 'service.category_created',
          tenantId: principal.tenantId,
          aggregateType: 'service_category',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { categoryId: id },
        }),
      });
      return category;
    });
  }

  async updateCategory(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<ServiceCategoryData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceCategorySnapshot> {
    this.requireTenantPermission(principal, 'service.manage_categories');
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.services.getCategory(transaction, principal.tenantId, id, true);
      if (!current) throw new ServiceCategoryNotFoundError();
      if (current.status === 'archived') throw new ServiceCategoryArchivedError();
      const input: ServiceCategoryData = {
        name: changes.name ?? current.name,
        code: changes.code === undefined ? current.code : changes.code,
        description: changes.description === undefined ? current.description : changes.description,
        sortOrder: changes.sortOrder === undefined ? current.sortOrder : changes.sortOrder,
      };
      validateServiceCategory(input);
      const changedFields = changedFieldsOf(current, input);
      if (changedFields.length === 0) return current;
      const category = await this.services.updateCategory(
        transaction,
        principal.tenantId,
        id,
        input,
        now,
      );
      if (!category) throw new ServiceCategoryNotFoundError();
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id,
        resourceType: 'service_category',
        action: 'service.category_updated',
        occurredAt: now,
        metadata: { changedFields },
        event: createDomainEvent({
          type: 'service.category_updated',
          tenantId: principal.tenantId,
          aggregateType: 'service_category',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { categoryId: id, changedFields },
        }),
      });
      return category;
    });
  }

  async archiveCategory(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceCategorySnapshot> {
    this.requireTenantPermission(principal, 'service.manage_categories');
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.services.getCategory(transaction, principal.tenantId, id, true);
      if (!current) throw new ServiceCategoryNotFoundError();
      if (current.status === 'archived') throw new ServiceCategoryArchivedError();
      const category = await this.services.archiveCategory(
        transaction,
        principal.tenantId,
        id,
        now,
      );
      if (!category) throw new ServiceCategoryNotFoundError();
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id,
        resourceType: 'service_category',
        action: 'service.category_archived',
        occurredAt: now,
        metadata: {},
        event: createDomainEvent({
          type: 'service.category_archived',
          tenantId: principal.tenantId,
          aggregateType: 'service_category',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { categoryId: id },
        }),
      });
      return category;
    });
  }

  async search(principal: AuthorizationPrincipal, query: ServiceSearchQuery = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidServicePaginationError();
    }
    const access = this.serviceReadScope(principal);
    if (
      (query.validAt !== undefined && query.validFrom !== undefined) ||
      (query.validUntil !== undefined && query.validFrom === undefined)
    ) {
      throw new InvalidServicePaginationError();
    }
    const validFrom = query.validFrom;
    const validUntil = query.validUntil;
    const validAt = query.validAt ?? validFrom ?? today(new Date());
    if (
      !isISODate(validAt) ||
      (validFrom !== undefined && !isISODate(validFrom)) ||
      (validUntil !== undefined && (!isISODate(validUntil) || validUntil < validFrom!))
    ) {
      throw new InvalidServicePaginationError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.services.search(transaction, {
        tenantId: principal.tenantId,
        access,
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
        ...(query.organizationId === undefined ? {} : { organizationId: query.organizationId }),
        ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
        ...(validFrom === undefined ? {} : { validFrom }),
        ...(validUntil === undefined ? {} : { validUntil }),
        validAt,
        page,
        pageSize,
        sortBy: query.sortBy ?? 'code',
        sortOrder: query.sortOrder ?? 'asc',
      }),
    );
  }

  async get(principal: AuthorizationPrincipal, id: string): Promise<ServiceDefinitionSnapshot> {
    const access = this.serviceReadScope(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const service = await this.services.getDefinition(transaction, principal.tenantId, id);
      if (!service) throw new ServiceNotFoundError();
      if (!access.tenantWide) {
        const visible = await this.services.search(transaction, {
          tenantId: principal.tenantId,
          access,
          serviceId: id,
          status: service.status,
          validAt: today(new Date()),
          page: 1,
          pageSize: 1,
        });
        if (visible.total === 0) throw new ServiceNotFoundError();
      }
      return service;
    });
  }

  async getForAgreement(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    input: {
      serviceDefinitionId: string;
      organizationId: string;
      facilityId: string;
      validFrom: string;
      validUntil: string | null;
      lock?: boolean;
    },
  ): Promise<ServiceDefinitionSnapshot> {
    assertCan(principal, {
      action: 'service.read',
      resource: {
        tenantId: principal.tenantId,
        organizationId: input.organizationId,
        facilityId: input.facilityId,
      },
    });
    const service = await this.services.getDefinition(
      transaction,
      principal.tenantId,
      input.serviceDefinitionId,
      input.lock ?? true,
    );
    if (!service) throw new ServiceNotFoundError();
    if (service.status === 'archived') throw new ServiceDefinitionArchivedError();
    if (
      service.validFrom > input.validFrom ||
      (service.validUntil !== null &&
        (input.validUntil === null || service.validUntil <= input.validUntil))
    ) {
      throw new ServiceNotValidForPeriodError();
    }
    const availability = await this.services.listAvailability(
      transaction,
      principal.tenantId,
      input.serviceDefinitionId,
    );
    const usable = availability.some(
      (row) =>
        row.active &&
        row.organizationId === input.organizationId &&
        (row.facilityId === null || row.facilityId === input.facilityId) &&
        (row.validFrom === null || row.validFrom <= input.validFrom) &&
        (row.validUntil === null ||
          (input.validUntil !== null && row.validUntil > input.validUntil)),
    );
    if (!usable) throw new ServiceNotAvailableForProviderError();
    return service;
  }

  async create(
    principal: AuthorizationPrincipal,
    data: ServiceDefinitionData,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceDefinitionSnapshot> {
    this.requireTenantPermission(principal, 'service.create');
    validateServiceDefinition(data);
    const now = new Date();
    const service = ServiceDefinition.create({
      id: uuidv7(),
      tenantId: principal.tenantId,
      ...data,
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = service.snapshot;
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireActiveCategory(transaction, principal.tenantId, data.categoryId);
      await this.services.insertDefinition(transaction, snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id: snapshot.id,
        resourceType: 'service',
        action: 'service.created',
        occurredAt: now,
        metadata: { categoryId: snapshot.categoryId },
        event: createDomainEvent({
          type: 'service.created',
          tenantId: principal.tenantId,
          aggregateType: 'service',
          aggregateId: snapshot.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { serviceId: snapshot.id },
        }),
      });
      return snapshot;
    });
  }

  async update(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<ServiceDefinitionData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceDefinitionSnapshot> {
    this.requireTenantPermission(principal, 'service.update');
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const currentRow = await this.services.getDefinition(
        transaction,
        principal.tenantId,
        id,
        true,
      );
      if (!currentRow) throw new ServiceNotFoundError();
      const service = ServiceDefinition.reconstitute(currentRow);
      const current = service.snapshot;
      const input: ServiceDefinitionData = {
        code: changes.code ?? current.code,
        name: changes.name ?? current.name,
        description: changes.description === undefined ? current.description : changes.description,
        categoryId: changes.categoryId ?? current.categoryId,
        unit: changes.unit ?? current.unit,
        benefitCategory: changes.benefitCategory ?? current.benefitCategory,
        defaultDurationMinutes:
          changes.defaultDurationMinutes === undefined
            ? current.defaultDurationMinutes
            : changes.defaultDurationMinutes,
        validFrom: changes.validFrom ?? current.validFrom,
        validUntil: changes.validUntil === undefined ? current.validUntil : changes.validUntil,
      };
      if (input.categoryId !== current.categoryId) {
        await this.requireActiveCategory(transaction, principal.tenantId, input.categoryId);
      }
      const changedFields = service.update(input, now);
      if (changedFields.length === 0) return current;
      const snapshot = service.snapshot;
      await this.services.updateDefinition(transaction, snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id,
        resourceType: 'service',
        action: 'service.updated',
        occurredAt: now,
        metadata: { changedFields },
        event: createDomainEvent({
          type: 'service.updated',
          tenantId: principal.tenantId,
          aggregateType: 'service',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { serviceId: id, changedFields },
        }),
      });
      return snapshot;
    });
  }

  async archive(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceDefinitionSnapshot> {
    this.requireTenantPermission(principal, 'service.archive');
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const row = await this.services.getDefinition(transaction, principal.tenantId, id, true);
      if (!row) throw new ServiceNotFoundError();
      const service = ServiceDefinition.reconstitute(row);
      service.archive(now);
      if (await this.serviceAgreements?.hasActiveForService(transaction, principal.tenantId, id)) {
        throw new ServiceDefinitionHasActiveServiceAgreementsError();
      }
      const snapshot = service.snapshot;
      await this.services.updateDefinition(transaction, snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id,
        resourceType: 'service',
        action: 'service.archived',
        occurredAt: now,
        metadata: {},
        event: createDomainEvent({
          type: 'service.archived',
          tenantId: principal.tenantId,
          aggregateType: 'service',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { serviceId: id },
        }),
      });
      return snapshot;
    });
  }

  async getAvailability(
    principal: AuthorizationPrincipal,
    serviceId: string,
  ): Promise<ServiceAvailabilitySnapshot[]> {
    const access = this.serviceReadScope(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const service = await this.services.getDefinition(transaction, principal.tenantId, serviceId);
      if (!service) throw new ServiceNotFoundError();
      if (!access.tenantWide) {
        const visible = await this.services.search(transaction, {
          tenantId: principal.tenantId,
          access,
          serviceId,
          status: service.status,
          validAt: today(new Date()),
          page: 1,
          pageSize: 1,
        });
        if (visible.total === 0) throw new ServiceNotFoundError();
      }
      const availability = await this.services.listAvailability(
        transaction,
        principal.tenantId,
        serviceId,
      );
      if (access.tenantWide) return availability;
      const result: ServiceAvailabilitySnapshot[] = [];
      const facilitiesById = new Map<string, string | null>();
      for (const row of availability) {
        if (access.organizationIds.includes(row.organizationId)) {
          result.push(row);
          continue;
        }
        if (row.facilityId && access.facilityIds.includes(row.facilityId)) {
          result.push(row);
          continue;
        }
        if (row.facilityId === null && access.facilityIds.length > 0) {
          let visible = false;
          // Lookups share the current transaction and are cached by facility ID.
          // oxlint-disable no-await-in-loop
          for (const facilityId of access.facilityIds) {
            let organizationId = facilitiesById.get(facilityId);
            if (organizationId === undefined) {
              organizationId =
                (await this.organizations.getFacility(transaction, principal.tenantId, facilityId))
                  ?.organizationId ?? null;
              facilitiesById.set(facilityId, organizationId);
            }
            if (organizationId === row.organizationId) visible = true;
          }
          // oxlint-enable no-await-in-loop
          if (visible) result.push(row);
        }
      }
      return result;
    });
  }

  async setAvailability(
    principal: AuthorizationPrincipal,
    serviceId: string,
    input: readonly ServiceAvailabilityData[],
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ServiceAvailabilitySnapshot[]> {
    this.requireTenantPermission(principal, 'service.manage_availability');
    input.forEach(validateServiceAvailability);
    const desiredInput = input.filter((item) => item.active);
    if (new Set(desiredInput.map(availabilityKey)).size !== desiredInput.length) {
      throw new InvalidServiceAvailabilityError();
    }
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const service = await this.services.getDefinition(
        transaction,
        principal.tenantId,
        serviceId,
        true,
      );
      if (!service) throw new ServiceNotFoundError();
      if (service.status === 'archived') throw new ServiceDefinitionArchivedError();
      // Provider checks are transaction-bound and each facility depends on its organization.
      // oxlint-disable no-await-in-loop
      for (const item of desiredInput) {
        await this.requireActiveAvailabilityProvider(transaction, principal.tenantId, item);
      }
      // oxlint-enable no-await-in-loop
      const current = await this.services.listAvailability(
        transaction,
        principal.tenantId,
        serviceId,
      );
      const activeRows = current.filter((item) => item.active);
      const active = activeRows.map(availabilityKey).sort();
      const desired = desiredInput.map(availabilityKey).sort();
      if (
        active.length === desired.length &&
        active.every((item, index) => item === desired[index])
      ) {
        return current;
      }
      const rows = desiredInput.map((item) =>
        this.availabilitySnapshot(principal.tenantId, serviceId, item, now),
      );
      const updated = await this.services.replaceAvailability(
        transaction,
        principal.tenantId,
        serviceId,
        rows,
        now,
      );
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        id: serviceId,
        resourceType: 'service',
        action: 'service.availability_changed',
        occurredAt: now,
        metadata: {
          organizationIds: [
            ...new Set([
              ...activeRows.map((item) => item.organizationId),
              ...desiredInput.map((item) => item.organizationId),
            ]),
          ],
          availabilityCount: desiredInput.length,
        },
        event: createDomainEvent({
          type: 'service.availability_changed',
          tenantId: principal.tenantId,
          aggregateType: 'service',
          aggregateId: serviceId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: {
            serviceId,
            changedOrganizationIds: [
              ...new Set([
                ...activeRows.map((item) => item.organizationId),
                ...desiredInput.map((item) => item.organizationId),
              ]),
            ],
          },
        }),
      });
      return updated;
    });
  }

  private serviceReadScope(principal: AuthorizationPrincipal): ServiceReadScope {
    const grants = principal.grants.filter((grant) => grant.permission === 'service.read');
    const tenantWide = grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    );
    const organizationIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ];
    const facilityIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ];
    if (!tenantWide && organizationIds.length === 0 && facilityIds.length === 0) {
      throw new AuthorizationDeniedError('service.read');
    }
    return { tenantWide, organizationIds, facilityIds };
  }

  private requireTenantPermission(principal: AuthorizationPrincipal, action: Permission): void {
    if (
      !can(principal, {
        action,
        resource: { tenantId: principal.tenantId },
      })
    ) {
      throw new AuthorizationDeniedError(action);
    }
  }

  private async requireActiveCategory(
    transaction: DatabaseTransaction,
    tenantId: string,
    id: string,
  ): Promise<void> {
    const category = await this.services.getCategory(transaction, tenantId, id, true);
    if (!category) throw new ServiceCategoryNotFoundError();
    if (category.status === 'archived') throw new ServiceCategoryArchivedError();
  }

  private async requireActiveAvailabilityProvider(
    transaction: DatabaseTransaction,
    tenantId: string,
    input: ServiceAvailabilityData,
  ): Promise<void> {
    const organization = await this.organizations.getOrganization(
      transaction,
      tenantId,
      input.organizationId,
      true,
    );
    if (!organization || organization.status !== 'active') {
      throw new InvalidServiceAvailabilityError();
    }
    if (input.facilityId) {
      const facility = await this.organizations.getFacility(
        transaction,
        tenantId,
        input.facilityId,
        true,
      );
      if (
        !facility ||
        facility.status !== 'active' ||
        facility.organizationId !== input.organizationId
      ) {
        throw new InvalidServiceAvailabilityError();
      }
    }
  }

  private availabilitySnapshot(
    tenantId: string,
    serviceId: string,
    input: ServiceAvailabilityData,
    now: Date,
  ): ServiceAvailabilitySnapshot {
    return {
      id: uuidv7(),
      tenantId,
      serviceId,
      organizationId: input.organizationId,
      facilityId: input.facilityId ?? null,
      active: input.active,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async recordChange(input: {
    transaction: DatabaseTransaction;
    principal: AuthorizationPrincipal;
    context: RequestContext;
    auditContext: AuditContext;
    id: string;
    resourceType: 'service' | 'service_category';
    action: string;
    occurredAt: Date;
    metadata: Record<string, unknown>;
    event: ReturnType<typeof createDomainEvent>;
  }): Promise<void> {
    await this.audit.append(input.transaction, {
      id: input.event.id,
      tenantId: input.principal.tenantId,
      actorId: input.principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.id,
      timestamp: input.occurredAt,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
      ...(input.auditContext.ip === undefined ? {} : { ip: input.auditContext.ip }),
      ...(input.auditContext.userAgent === undefined
        ? {}
        : { userAgent: input.auditContext.userAgent }),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(input.transaction, input.event);
  }
}

function availabilityKey(input: ServiceAvailabilityData): string {
  return [
    input.organizationId,
    input.facilityId ?? '',
    input.active,
    input.validFrom ?? '',
    input.validUntil ?? '',
  ].join(':');
}

function changedFieldsOf(before: object, after: object): string[] {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  return Object.keys(next).filter((key) => previous[key] !== next[key]);
}

function today(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isISODate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createServiceApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  serviceAgreements?: ServiceAgreementArchiveGuard,
): ServiceApplicationService {
  return new ServiceApplicationService(
    unitOfWork,
    new ServiceRepository(),
    new OrganizationRepository(),
    audit,
    outbox,
    serviceAgreements,
  );
}

export class ServiceNotAvailableForProviderError extends Error {
  readonly code = 'SERVICE_NOT_AVAILABLE_FOR_PROVIDER';

  constructor() {
    super('The service is not available to this provider for the requested period');
    this.name = 'ServiceNotAvailableForProviderError';
  }
}

export class ServiceNotValidForPeriodError extends Error {
  readonly code = 'SERVICE_NOT_VALID_FOR_PERIOD';

  constructor() {
    super('The service is not valid for the requested period');
    this.name = 'ServiceNotValidForPeriodError';
  }
}

export class ServiceDefinitionHasActiveServiceAgreementsError extends Error {
  readonly code = 'SERVICE_HAS_ACTIVE_AGREEMENTS';

  constructor() {
    super('End active service agreements before archiving this service');
    this.name = 'ServiceDefinitionHasActiveServiceAgreementsError';
  }
}
