import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import { assertCan, can, type AuthorizationPrincipal, type Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  FacilityHasActiveTeamsError,
  OrganizationHasActiveChildrenError,
  transitionStructureStatus,
} from '../domain/organization';
import type {
  FacilityData,
  FacilitySnapshot,
  OrganizationData,
  OrganizationSnapshot,
  StructureStatus,
  TeamData,
  TeamSnapshot,
} from '../domain/organization';
import { OrganizationRepository } from '../infrastructure/persistence/organization.repository';

export class OrganizationApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly organizations: OrganizationRepository = new OrganizationRepository(),
  ) {}

  async listOrganizations(
    principal: AuthorizationPrincipal,
    status?: StructureStatus,
  ): Promise<OrganizationSnapshot[]> {
    this.requireAnyGrant(principal, 'organization.read');
    const rows = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) =>
        this.organizations.listOrganizations(transaction, principal.tenantId, status),
    );
    return rows.filter((organization) =>
      can(principal, {
        action: 'organization.read',
        resource: { tenantId: principal.tenantId, organizationId: organization.id },
      }),
    );
  }

  async getOrganization(
    principal: AuthorizationPrincipal,
    id: string,
  ): Promise<OrganizationSnapshot> {
    const organization = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.getOrganization(transaction, principal.tenantId, id),
    );
    if (!organization) throw new OrganizationNotFoundError();
    this.authorize(principal, 'organization.read', { organizationId: organization.id });
    return organization;
  }

  async createOrganization(
    principal: AuthorizationPrincipal,
    data: OrganizationData,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<OrganizationSnapshot> {
    this.authorize(principal, 'organization.create');
    const now = new Date();
    const id = uuidv7();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const organization = await this.organizations.createOrganization(
        transaction,
        principal.tenantId,
        id,
        data,
        now,
      );
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: id,
        timestamp: now,
        metadata: { changedFields: Object.keys(data) },
        event: createDomainEvent({
          type: 'organization.created',
          tenantId: principal.tenantId,
          aggregateType: 'organization',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { organizationId: id },
        }),
      });
      return organization;
    });
  }

  async updateOrganization(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<OrganizationData>,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<OrganizationSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.organizations.getOrganization(
        transaction,
        principal.tenantId,
        id,
        true,
      );
      if (!current) throw new OrganizationNotFoundError();
      this.authorize(principal, 'organization.update', { organizationId: id });
      if (current.status === 'archived') throw new OrganizationArchivedError();
      const fields = Object.keys(changes);
      if (fields.length === 0) return current;
      const now = new Date();
      const organization = await this.organizations.updateOrganization(
        transaction,
        principal.tenantId,
        id,
        changes,
        now,
      );
      if (!organization) throw new OrganizationNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: id,
        timestamp: now,
        metadata: { changedFields: fields },
        event: createDomainEvent({
          type: 'organization.updated',
          tenantId: principal.tenantId,
          aggregateType: 'organization',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { organizationId: id, changedFields: fields },
        }),
      });
      return organization;
    });
  }

  async activateOrganization(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<OrganizationSnapshot> {
    return this.setOrganizationStatus(principal, id, 'activate', context, request);
  }

  async archiveOrganization(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<OrganizationSnapshot> {
    return this.setOrganizationStatus(principal, id, 'archive', context, request);
  }

  async listFacilities(
    principal: AuthorizationPrincipal,
    filter: { organizationId?: string; status?: StructureStatus } = {},
  ): Promise<FacilitySnapshot[]> {
    this.requireAnyGrant(principal, 'facility.read');
    const rows = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.listFacilities(transaction, principal.tenantId, filter),
    );
    return rows.filter((facility) =>
      can(principal, {
        action: 'facility.read',
        resource: {
          tenantId: principal.tenantId,
          organizationId: facility.organizationId,
          facilityId: facility.id,
        },
      }),
    );
  }

  async getFacility(principal: AuthorizationPrincipal, id: string): Promise<FacilitySnapshot> {
    const facility = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.getFacility(transaction, principal.tenantId, id),
    );
    if (!facility) throw new FacilityNotFoundError();
    this.authorize(principal, 'facility.read', {
      organizationId: facility.organizationId,
      facilityId: facility.id,
    });
    return facility;
  }

  async createFacility(
    principal: AuthorizationPrincipal,
    data: FacilityData,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<FacilitySnapshot> {
    const now = new Date();
    const id = uuidv7();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const organization = await this.organizations.getOrganization(
        transaction,
        principal.tenantId,
        data.organizationId,
        true,
      );
      if (!organization) throw new OrganizationNotFoundError();
      this.authorize(principal, 'facility.create', { organizationId: organization.id });
      if (organization.status === 'archived') throw new OrganizationArchivedError();
      const facility = await this.organizations.createFacility(
        transaction,
        principal.tenantId,
        id,
        data,
        now,
      );
      if (!facility) throw new FacilityNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'facility.created',
        resourceType: 'facility',
        resourceId: id,
        timestamp: now,
        metadata: { organizationId: organization.id, changedFields: Object.keys(data) },
        event: createDomainEvent({
          type: 'facility.created',
          tenantId: principal.tenantId,
          aggregateType: 'facility',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { facilityId: id, organizationId: organization.id },
        }),
      });
      return facility;
    });
  }

  async updateFacility(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<Omit<FacilityData, 'organizationId'>>,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<FacilitySnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.organizations.getFacility(
        transaction,
        principal.tenantId,
        id,
        true,
      );
      if (!current) throw new FacilityNotFoundError();
      this.authorize(principal, 'facility.update', {
        organizationId: current.organizationId,
        facilityId: id,
      });
      if (current.status === 'archived') throw new FacilityArchivedError();
      if (current.organizationStatus === 'archived') throw new OrganizationArchivedError();
      const fields = Object.keys(changes);
      if (fields.length === 0) return current;
      const now = new Date();
      const facility = await this.organizations.updateFacility(
        transaction,
        principal.tenantId,
        id,
        changes,
        now,
      );
      if (!facility) throw new FacilityNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'facility.updated',
        resourceType: 'facility',
        resourceId: id,
        timestamp: now,
        metadata: { changedFields: fields },
        event: createDomainEvent({
          type: 'facility.updated',
          tenantId: principal.tenantId,
          aggregateType: 'facility',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { facilityId: id, changedFields: fields },
        }),
      });
      return facility;
    });
  }

  async activateFacility(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<FacilitySnapshot> {
    return this.setFacilityStatus(principal, id, 'activate', context, request);
  }

  async archiveFacility(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<FacilitySnapshot> {
    return this.setFacilityStatus(principal, id, 'archive', context, request);
  }

  async listTeams(
    principal: AuthorizationPrincipal,
    filter: { organizationId?: string; facilityId?: string; status?: StructureStatus } = {},
  ): Promise<TeamSnapshot[]> {
    this.requireAnyGrant(principal, 'team.read');
    const rows = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.listTeams(transaction, principal.tenantId, filter),
    );
    return rows.filter((team) =>
      can(principal, {
        action: 'team.read',
        resource: {
          tenantId: principal.tenantId,
          organizationId: team.organizationId,
          ...(team.facilityId ? { facilityId: team.facilityId } : {}),
          teamId: team.id,
        },
      }),
    );
  }

  async getTeam(principal: AuthorizationPrincipal, id: string): Promise<TeamSnapshot> {
    const team = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.getTeam(transaction, principal.tenantId, id),
    );
    if (!team) throw new TeamNotFoundError();
    this.authorize(principal, 'team.read', {
      organizationId: team.organizationId,
      ...(team.facilityId ? { facilityId: team.facilityId } : {}),
      teamId: team.id,
    });
    return team;
  }

  async createTeam(
    principal: AuthorizationPrincipal,
    data: TeamData,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<TeamSnapshot> {
    const now = new Date();
    const id = uuidv7();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const organization = await this.organizations.getOrganization(
        transaction,
        principal.tenantId,
        data.organizationId,
        true,
      );
      if (!organization) throw new OrganizationNotFoundError();
      if (organization.status === 'archived') throw new OrganizationArchivedError();
      if (data.facilityId) {
        const facility = await this.organizations.getFacility(
          transaction,
          principal.tenantId,
          data.facilityId,
        );
        if (!facility) throw new FacilityNotFoundError();
        if (facility.organizationId !== organization.id) throw new InvalidTeamAssignmentError();
        if (facility.status === 'archived') throw new FacilityArchivedError();
      }
      this.authorize(principal, 'team.manage', {
        organizationId: organization.id,
        ...(data.facilityId ? { facilityId: data.facilityId } : {}),
      });
      const team = await this.organizations.createTeam(
        transaction,
        principal.tenantId,
        id,
        data,
        now,
      );
      if (!team) throw new TeamNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'team.created',
        resourceType: 'team',
        resourceId: id,
        timestamp: now,
        metadata: { organizationId: organization.id },
        event: createDomainEvent({
          type: 'team.created',
          tenantId: principal.tenantId,
          aggregateType: 'team',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { teamId: id, organizationId: organization.id },
        }),
      });
      return team;
    });
  }

  async updateTeam(
    principal: AuthorizationPrincipal,
    id: string,
    changes: Partial<Pick<TeamData, 'name' | 'facilityId'>>,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<TeamSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.organizations.getTeam(transaction, principal.tenantId, id, true);
      if (!current) throw new TeamNotFoundError();
      this.authorize(principal, 'team.manage', {
        organizationId: current.organizationId,
        ...(current.facilityId ? { facilityId: current.facilityId } : {}),
        teamId: current.id,
      });
      if (current.status === 'archived') throw new TeamArchivedError();
      const targetFacilityId =
        changes.facilityId === undefined ? current.facilityId : changes.facilityId;
      if (targetFacilityId) {
        const facility = await this.organizations.getFacility(
          transaction,
          principal.tenantId,
          targetFacilityId,
        );
        if (!facility) throw new FacilityNotFoundError();
        if (facility.organizationId !== current.organizationId)
          throw new InvalidTeamAssignmentError();
        if (facility.status === 'archived') throw new FacilityArchivedError();
      }
      if (current.organizationStatus === 'archived') throw new OrganizationArchivedError();
      const fields = Object.keys(changes);
      if (fields.length === 0) return current;
      const now = new Date();
      const team = await this.organizations.updateTeam(
        transaction,
        principal.tenantId,
        id,
        changes,
        now,
      );
      if (!team) throw new TeamNotFoundError();
      await this.record(transaction, {
        principal,
        context,
        request,
        action: 'team.updated',
        resourceType: 'team',
        resourceId: id,
        timestamp: now,
        metadata: { changedFields: fields },
        event: createDomainEvent({
          type: 'team.updated',
          tenantId: principal.tenantId,
          aggregateType: 'team',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { teamId: id, changedFields: fields },
        }),
      });
      return team;
    });
  }

  async activateTeam(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<TeamSnapshot> {
    return this.setTeamStatus(principal, id, 'activate', context, request);
  }

  async archiveTeam(
    principal: AuthorizationPrincipal,
    id: string,
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<TeamSnapshot> {
    return this.setTeamStatus(principal, id, 'archive', context, request);
  }

  private async setOrganizationStatus(
    principal: AuthorizationPrincipal,
    id: string,
    operation: 'activate' | 'archive',
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<OrganizationSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.organizations.getOrganization(
        transaction,
        principal.tenantId,
        id,
        true,
      );
      if (!current) throw new OrganizationNotFoundError();
      this.authorize(
        principal,
        operation === 'activate' ? 'organization.activate' : 'organization.archive',
        { organizationId: id },
      );
      if (current.status === transitionStructureStatus(operation)) return current;
      if (
        operation === 'archive' &&
        (await this.organizations.hasActiveChildren(transaction, principal.tenantId, id))
      ) {
        throw new OrganizationHasActiveChildrenError();
      }
      const status = transitionStructureStatus(operation);
      const now = new Date();
      const organization = await this.organizations.setOrganizationStatus(
        transaction,
        principal.tenantId,
        id,
        status,
        now,
      );
      if (!organization) throw new OrganizationNotFoundError();
      const action = `organization.${operation === 'activate' ? 'activated' : 'archived'}` as const;
      await this.record(transaction, {
        principal,
        context,
        request,
        action,
        resourceType: 'organization',
        resourceId: id,
        timestamp: now,
        metadata: { status },
        event: createDomainEvent({
          type: action,
          tenantId: principal.tenantId,
          aggregateType: 'organization',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { organizationId: id },
        }),
      });
      return organization;
    });
  }

  private async setFacilityStatus(
    principal: AuthorizationPrincipal,
    id: string,
    operation: 'activate' | 'archive',
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<FacilitySnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.organizations.getFacility(
        transaction,
        principal.tenantId,
        id,
        true,
      );
      if (!current) throw new FacilityNotFoundError();
      this.authorize(
        principal,
        operation === 'activate' ? 'facility.activate' : 'facility.archive',
        { organizationId: current.organizationId, facilityId: id },
      );
      if (current.status === transitionStructureStatus(operation)) return current;
      if (operation === 'activate' && current.organizationStatus === 'archived') {
        throw new OrganizationArchivedError();
      }
      if (
        operation === 'archive' &&
        (await this.organizations.hasActiveTeamsForFacility(transaction, principal.tenantId, id))
      ) {
        throw new FacilityHasActiveTeamsError();
      }
      const now = new Date();
      const facility = await this.organizations.setFacilityStatus(
        transaction,
        principal.tenantId,
        id,
        transitionStructureStatus(operation),
        now,
      );
      if (!facility) throw new FacilityNotFoundError();
      const action = `facility.${operation === 'activate' ? 'activated' : 'archived'}` as const;
      await this.record(transaction, {
        principal,
        context,
        request,
        action,
        resourceType: 'facility',
        resourceId: id,
        timestamp: now,
        metadata: { status: facility.status },
        event: createDomainEvent({
          type: action,
          tenantId: principal.tenantId,
          aggregateType: 'facility',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { facilityId: id },
        }),
      });
      return facility;
    });
  }

  private async setTeamStatus(
    principal: AuthorizationPrincipal,
    id: string,
    operation: 'activate' | 'archive',
    context: RequestContext,
    request: RequestMetadata,
  ): Promise<TeamSnapshot> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.organizations.getTeam(transaction, principal.tenantId, id, true);
      if (!current) throw new TeamNotFoundError();
      this.authorize(principal, 'team.manage', {
        organizationId: current.organizationId,
        ...(current.facilityId ? { facilityId: current.facilityId } : {}),
        teamId: id,
      });
      if (current.status === transitionStructureStatus(operation)) return current;
      if (operation === 'activate') {
        if (current.organizationStatus === 'archived') throw new OrganizationArchivedError();
        if (current.facilityId) {
          const facility = await this.organizations.getFacility(
            transaction,
            principal.tenantId,
            current.facilityId,
          );
          if (!facility || facility.status === 'archived') throw new FacilityArchivedError();
        }
      }
      const now = new Date();
      const team = await this.organizations.setTeamStatus(
        transaction,
        principal.tenantId,
        id,
        transitionStructureStatus(operation),
        now,
      );
      if (!team) throw new TeamNotFoundError();
      const action = `team.${operation === 'activate' ? 'activated' : 'archived'}` as const;
      await this.record(transaction, {
        principal,
        context,
        request,
        action,
        resourceType: 'team',
        resourceId: id,
        timestamp: now,
        metadata: { status: team.status },
        event: createDomainEvent({
          type: action,
          tenantId: principal.tenantId,
          aggregateType: 'team',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { teamId: id },
        }),
      });
      return team;
    });
  }

  private authorize(
    principal: AuthorizationPrincipal,
    action: Permission,
    resource: { organizationId?: string; facilityId?: string; teamId?: string } = {},
  ): void {
    assertCan(principal, { action, resource: { tenantId: principal.tenantId, ...resource } });
  }

  private requireAnyGrant(principal: AuthorizationPrincipal, permission: Permission): void {
    const granted = principal.grants.some(
      (grant) =>
        grant.permission === permission ||
        (grant.permission === 'organization.manage' &&
          (permission.startsWith('organization.') ||
            permission.startsWith('facility.') ||
            permission.startsWith('team.'))),
    );
    if (!granted) this.authorize(principal, permission);
  }

  private async record(
    transaction: DatabaseTransaction,
    input: {
      principal: AuthorizationPrincipal;
      context: RequestContext;
      request: RequestMetadata;
      action: string;
      resourceType: string;
      resourceId: string;
      timestamp: Date;
      metadata: Record<string, unknown>;
      event: DomainEvent;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: uuidv7(),
      tenantId: input.principal.tenantId,
      actorId: input.principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: input.timestamp,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
      ...(input.request.ip ? { ip: input.request.ip } : {}),
      ...(input.request.userAgent ? { userAgent: input.request.userAgent } : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

export class OrganizationNotFoundError extends Error {
  readonly code = 'ORGANIZATION_NOT_FOUND';

  constructor() {
    super('Organization was not found');
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrganizationArchivedError extends Error {
  readonly code = 'ORGANIZATION_ARCHIVED';

  constructor() {
    super('Organization is archived');
    this.name = 'OrganizationArchivedError';
  }
}

export class FacilityNotFoundError extends Error {
  readonly code = 'FACILITY_NOT_FOUND';

  constructor() {
    super('Facility was not found');
    this.name = 'FacilityNotFoundError';
  }
}

export class FacilityArchivedError extends Error {
  readonly code = 'FACILITY_ARCHIVED';

  constructor() {
    super('Facility is archived');
    this.name = 'FacilityArchivedError';
  }
}

export class TeamNotFoundError extends Error {
  readonly code = 'TEAM_NOT_FOUND';

  constructor() {
    super('Team was not found');
    this.name = 'TeamNotFoundError';
  }
}

export class TeamArchivedError extends Error {
  readonly code = 'TEAM_ARCHIVED';

  constructor() {
    super('Team is archived');
    this.name = 'TeamArchivedError';
  }
}

export class InvalidTeamAssignmentError extends Error {
  readonly code = 'INVALID_TEAM_ASSIGNMENT';

  constructor() {
    super('The facility does not belong to the selected team organization');
    this.name = 'InvalidTeamAssignmentError';
  }
}
