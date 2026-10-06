import { v7 as uuidv7 } from 'uuid';

export interface EventPayloadMap {
  'client.created': { clientId: string };
  'client.updated': { clientId: string; changedFields: string[] };
  'client.activated': { clientId: string };
  'client.archived': { clientId: string };
  'tenant.invitation.created': { invitationId: string };
  'tenant.invitation.accepted': { invitationId: string; membershipId: string };
  'tenant.invitation.expired': { invitationId: string };
  'tenant.invitation.revoked': { invitationId: string };
  'tenant.member.invited': { membershipId: string; invitationId: string };
  'tenant.member.activated': { membershipId: string };
  'tenant.member.deactivated': { membershipId: string };
  'tenant.member.revoked': { membershipId: string };
  'tenant.member.role_changed': {
    membershipId: string;
    addedRoleIds: string[];
    removedRoleIds: string[];
  };
  'tenant.member.scope_changed': {
    membershipId: string;
    addedScopes: Array<{ scopeType: string; scopeId: string }>;
    removedScopes: Array<{ scopeType: string; scopeId: string }>;
  };
}

export type EventName = keyof EventPayloadMap;

export interface DomainEvent<T extends EventName = EventName> {
  id: string;
  type: T;
  version: 1;
  tenantId: string;
  aggregateType: 'client' | 'tenant_membership' | 'tenant_invitation';
  aggregateId: string;
  occurredAt: string;
  actor: { type: 'user' | 'system'; id?: string };
  correlationId: string;
  causationId?: string;
  payload: EventPayloadMap[T];
}

export function createDomainEvent<T extends EventName>(
  input: Omit<DomainEvent<T>, 'id' | 'version' | 'occurredAt'> & {
    id?: string;
    occurredAt?: string;
  },
): DomainEvent<T> {
  return {
    ...input,
    id: input.id ?? uuidv7(),
    version: 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export class EventDispatcher {
  private readonly handlers = new Map<EventName, EventHandler[]>();

  subscribe(type: EventName, handler: EventHandler): void {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    if (event.version !== 1) throw new UnsupportedEventVersionError(event.type, event.version);
    const handlers = this.handlers.get(event.type) ?? [];
    if (handlers.length === 0) throw new MissingEventHandlerError(event.type);
    // Preserve subscription order; handlers may rely on earlier side effects.
    // oxlint-disable-next-line no-await-in-loop
    for (const handler of handlers) await handler(event);
  }
}

export class MissingEventHandlerError extends Error {
  constructor(type: EventName) {
    super(`No handler registered for ${type}`);
    this.name = 'MissingEventHandlerError';
  }
}

export class UnsupportedEventVersionError extends Error {
  constructor(type: EventName, version: number) {
    super(`Unsupported ${type} version ${version}`);
    this.name = 'UnsupportedEventVersionError';
  }
}
