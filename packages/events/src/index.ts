import { v7 as uuidv7 } from 'uuid';

export interface EventPayloadMap {
  'organization.created': { organizationId: string };
  'organization.updated': { organizationId: string; changedFields: string[] };
  'organization.activated': { organizationId: string };
  'organization.archived': { organizationId: string };
  'facility.created': { facilityId: string; organizationId: string };
  'facility.updated': { facilityId: string; changedFields: string[] };
  'facility.activated': { facilityId: string };
  'facility.archived': { facilityId: string };
  'team.created': { teamId: string; organizationId: string };
  'team.updated': { teamId: string; changedFields: string[] };
  'team.activated': { teamId: string };
  'team.archived': { teamId: string };
  'employee.created': { employeeId: string; organizationId: string };
  'employee.updated': { employeeId: string; changedFields: string[] };
  'employee.status_changed': {
    employeeId: string;
    previousStatus: 'active' | 'inactive';
    status: 'active' | 'inactive' | 'archived';
  };
  'employee.user_linked': { employeeId: string; userId: string };
  'employee.user_unlinked': { employeeId: string };
  'employee.facility_assignment_changed': {
    employeeId: string;
    facilityId: string;
    operation: 'assigned' | 'unassigned' | 'primary_changed';
  };
  'employee.team_membership_changed': {
    employeeId: string;
    teamId: string;
    operation: 'assigned' | 'unassigned';
  };
  'employee.qualification_changed': {
    employeeId: string;
    qualificationId: string;
    operation: 'added' | 'updated' | 'removed';
  };
  'employee.skill_changed': { employeeId: string; skillId: string; operation: 'added' | 'removed' };
  'qualification.created': { qualificationId: string };
  'qualification.updated': { qualificationId: string; changedFields: string[] };
  'qualification.archived': { qualificationId: string };
  'skill.created': { skillId: string };
  'skill.updated': { skillId: string; changedFields: string[] };
  'skill.archived': { skillId: string };
  'client.created': { clientId: string };
  'client.updated': { clientId: string; changedFields: string[] };
  'client.activated': { clientId: string };
  'client.archived': { clientId: string };
  'client.provider_context_changed': {
    clientId: string;
    previousOrganizationId: string | null;
    previousFacilityId: string | null;
    organizationId: string;
    primaryFacilityId: string;
  };
  'client.address_changed': {
    clientId: string;
    addressId: string;
    operation: 'added' | 'updated' | 'removed';
  };
  'client.contact_changed': {
    clientId: string;
    contactId: string;
    operation: 'added' | 'updated' | 'removed';
  };
  'client.insurance_changed': {
    clientId: string;
    insuranceId: string;
    operation: 'added' | 'updated';
  };
  'client.pflegegrad_changed': {
    clientId: string;
    recordId: string;
    operation: 'added' | 'updated';
  };
  'service.category_created': { categoryId: string };
  'service.category_updated': { categoryId: string; changedFields: string[] };
  'service.category_archived': { categoryId: string };
  'service.created': { serviceId: string };
  'service.updated': { serviceId: string; changedFields: string[] };
  'service.archived': { serviceId: string };
  'service.availability_changed': { serviceId: string; changedOrganizationIds: string[] };
  'service_agreement.created': {
    agreementId: string;
    clientId: string;
    organizationId: string;
    facilityId: string;
  };
  'service_agreement.updated': { agreementId: string; clientId: string; changedFields: string[] };
  'service_agreement.activated': { agreementId: string; clientId: string };
  'service_agreement.suspended': { agreementId: string; clientId: string };
  'service_agreement.resumed': { agreementId: string; clientId: string };
  'service_agreement.ended': { agreementId: string; clientId: string };
  'service_agreement.service_added': {
    agreementId: string;
    clientId: string;
    agreementServiceId: string;
    serviceDefinitionId: string;
  };
  'service_agreement.service_changed': {
    agreementId: string;
    clientId: string;
    agreementServiceId: string;
    serviceDefinitionId: string;
    changedFields: string[];
  };
  'service_agreement.service_ended': {
    agreementId: string;
    clientId: string;
    agreementServiceId: string;
    serviceDefinitionId: string;
  };
  'visit.created': { visitId: string; clientId: string };
  'visit.generated': { visitId: string; agreementId: string; clientId: string };
  'visit.updated': { visitId: string; clientId: string; changedFields: string[] };
  'visit.rescheduled': { visitId: string; clientId: string };
  'visit.confirmed': { visitId: string; clientId: string };
  'visit.unconfirmed': { visitId: string; clientId: string };
  'visit.cancelled': { visitId: string; clientId: string };
  'visit.assignment_changed': {
    visitId: string;
    clientId: string;
    employeeId: string;
    operation: 'assigned' | 'unassigned';
  };
  'schedule.generation_completed': {
    generationId: string;
    agreementId: string;
    generatedCount: number;
    alreadyExistingCount: number;
    requiresManualPlacementCount: number;
  };
  'employee.unavailability_created': { employeeId: string; unavailabilityId: string };
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
  aggregateType:
    | 'organization'
    | 'facility'
    | 'team'
    | 'employee'
    | 'qualification'
    | 'skill'
    | 'client'
    | 'service_category'
    | 'service'
    | 'service_agreement'
    | 'visit'
    | 'schedule_generation'
    | 'employee_availability'
    | 'tenant_membership'
    | 'tenant_invitation';
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
