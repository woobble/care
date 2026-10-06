import type { UnitOfWork } from '@care/database';
import { AuthorizationDeniedError, can, type AuthorizationPrincipal } from '@care/permissions';
import type { FacilitySnapshot, OrganizationSnapshot } from '../domain/organization';
import { OrganizationRepository } from '../infrastructure/persistence/organization.repository';

export class OrganizationApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizations: OrganizationRepository = new OrganizationRepository(),
  ) {}

  async listOrganizations(principal: AuthorizationPrincipal): Promise<OrganizationSnapshot[]> {
    this.requireAnyGrant(principal, 'organization.read');
    const rows = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.listOrganizations(transaction, principal.tenantId),
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
    if (
      !can(principal, {
        action: 'organization.read',
        resource: { tenantId: principal.tenantId, organizationId: organization.id },
      })
    ) {
      throw new AuthorizationDeniedError('organization.read');
    }
    return organization;
  }

  async listFacilities(principal: AuthorizationPrincipal): Promise<FacilitySnapshot[]> {
    this.requireAnyGrant(principal, 'facility.read');
    const rows = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) => this.organizations.listFacilities(transaction, principal.tenantId),
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
    if (
      !can(principal, {
        action: 'facility.read',
        resource: {
          tenantId: principal.tenantId,
          organizationId: facility.organizationId,
          facilityId: facility.id,
        },
      })
    ) {
      throw new AuthorizationDeniedError('facility.read');
    }
    return facility;
  }

  private requireAnyGrant(
    principal: AuthorizationPrincipal,
    permission: 'organization.read' | 'facility.read',
  ): void {
    if (!principal.grants.some((grant) => grant.permission === permission)) {
      throw new AuthorizationDeniedError(permission);
    }
  }
}

export class OrganizationNotFoundError extends Error {
  readonly code = 'ORGANIZATION_NOT_FOUND';

  constructor() {
    super('Organization was not found');
    this.name = 'OrganizationNotFoundError';
  }
}

export class FacilityNotFoundError extends Error {
  readonly code = 'FACILITY_NOT_FOUND';

  constructor() {
    super('Facility was not found');
    this.name = 'FacilityNotFoundError';
  }
}
