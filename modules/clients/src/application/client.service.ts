import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { assertCan, type AuthorizationPrincipal, type Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { Client, type ClientPersonalData, type ClientSnapshot } from '../domain/client';
import { ClientRepository } from '../infrastructure/persistence/client.repository';

export class ClientApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: ClientRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async search(
    principal: AuthorizationPrincipal,
    query: { text?: string; page?: number; pageSize?: number } = {},
  ) {
    this.authorize(principal, 'client.read');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new InvalidPaginationError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      this.clients.search(transaction, {
        tenantId: principal.tenantId,
        ...(query.text === undefined ? {} : { query: query.text }),
        page,
        pageSize,
      }),
    );
  }

  async get(principal: AuthorizationPrincipal, id: string): Promise<ClientSnapshot> {
    this.authorize(principal, 'client.read', { clientId: id });
    const client = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.clients.findById(transaction, principal.tenantId, id),
    );
    if (!client) throw new ClientNotFoundError();
    return client;
  }

  async create(
    principal: AuthorizationPrincipal,
    data: ClientPersonalData,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    this.authorize(principal, 'client.create');
    const now = new Date();
    const client = Client.pending({
      id: uuidv7(),
      tenantId: principal.tenantId,
      ...data,
      createdAt: now,
      updatedAt: now,
    });
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const snapshot = client.snapshot;
      await this.clients.insert(transaction, snapshot);
      await this.audit.append(
        transaction,
        this.auditRecord({
          principal,
          context,
          auditContext,
          action: 'client.created',
          client: snapshot,
          metadata: { changedFields: Object.keys(data) },
        }),
      );
      await this.outbox.enqueue(
        transaction,
        createDomainEvent({
          type: 'client.created',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: snapshot.id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId: snapshot.id },
        }),
      );
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
    this.authorize(principal, 'client.update', { clientId: id });
    return this.mutate(principal, id, context, auditContext, 'client.updated', async (client) => {
      const current = client.snapshot;
      const personalData: ClientPersonalData = {
        firstName: changes.firstName ?? current.firstName,
        lastName: changes.lastName ?? current.lastName,
        preferredName:
          changes.preferredName === undefined
            ? (current.preferredName ?? null)
            : changes.preferredName,
        dateOfBirth:
          changes.dateOfBirth === undefined ? (current.dateOfBirth ?? null) : changes.dateOfBirth,
        email: changes.email === undefined ? (current.email ?? null) : changes.email,
        phone: changes.phone === undefined ? (current.phone ?? null) : changes.phone,
      };
      return client.updatePersonalData(personalData);
    });
  }

  async activate(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    this.authorize(principal, 'client.update', { clientId: id });
    return this.mutate(principal, id, context, auditContext, 'client.activated', (client) => {
      client.activate();
      return ['status'];
    });
  }

  async archive(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ): Promise<ClientSnapshot> {
    this.authorize(principal, 'client.archive', { clientId: id });
    return this.mutate(principal, id, context, auditContext, 'client.archived', (client) => {
      client.archive();
      return ['status'];
    });
  }

  private async mutate(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
    eventType: 'client.updated' | 'client.activated' | 'client.archived',
    change: (client: Client) => string[] | Promise<string[]>,
  ): Promise<ClientSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const row = await this.clients.findById(transaction, principal.tenantId, id, true);
      if (!row) throw new ClientNotFoundError();
      const client = Client.reconstitute(row);
      const changedFields = await change(client);
      const snapshot = client.snapshot;
      if (changedFields.length === 0) return snapshot;

      await this.clients.update(transaction, snapshot);
      await this.audit.append(
        transaction,
        this.auditRecord({
          principal,
          context,
          auditContext,
          action: eventType,
          client: snapshot,
          metadata: { changedFields },
        }),
      );
      const event =
        eventType === 'client.updated'
          ? createDomainEvent({
              type: eventType,
              tenantId: principal.tenantId,
              aggregateType: 'client',
              aggregateId: snapshot.id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { clientId: snapshot.id, changedFields },
            })
          : createDomainEvent({
              type: eventType,
              tenantId: principal.tenantId,
              aggregateType: 'client',
              aggregateId: snapshot.id,
              actor: { type: 'user', id: principal.userId },
              correlationId: context.correlationId,
              payload: { clientId: snapshot.id },
            });
      await this.outbox.enqueue(transaction, event);
      return snapshot;
    });
  }

  private authorize(
    principal: AuthorizationPrincipal,
    action: Permission,
    resource: { clientId?: string } = {},
  ): void {
    assertCan(principal, {
      action,
      resource: { tenantId: principal.tenantId, ...resource },
    });
  }

  private auditRecord(input: {
    principal: AuthorizationPrincipal;
    context: RequestContext;
    auditContext: { ip?: string; userAgent?: string };
    action: string;
    client: ClientSnapshot;
    metadata: Record<string, unknown>;
  }) {
    return {
      id: uuidv7(),
      tenantId: input.principal.tenantId,
      actorId: input.principal.userId,
      action: input.action,
      resourceType: 'client',
      resourceId: input.client.id,
      timestamp: input.client.updatedAt,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
      ...(input.auditContext.ip === undefined ? {} : { ip: input.auditContext.ip }),
      ...(input.auditContext.userAgent === undefined
        ? {}
        : { userAgent: input.auditContext.userAgent }),
      metadata: input.metadata,
    };
  }
}

export function createClientApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
): ClientApplicationService {
  return new ClientApplicationService(unitOfWork, new ClientRepository(), audit, outbox);
}

export class ClientNotFoundError extends Error {
  readonly code = 'CLIENT_NOT_FOUND';

  constructor() {
    super('Client not found');
    this.name = 'ClientNotFoundError';
  }
}

export class InvalidPaginationError extends Error {
  readonly code = 'INVALID_PAGINATION';

  constructor() {
    super('Pagination values are invalid');
    this.name = 'InvalidPaginationError';
  }
}
