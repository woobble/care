export type StructureStatus = 'active' | 'archived';

export interface OrganizationData {
  name: string;
  legalName: string | null;
  code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface OrganizationSnapshot extends OrganizationData {
  id: string;
  tenantId: string;
  status: StructureStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilityData {
  organizationId: string;
  name: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface FacilitySnapshot extends FacilityData {
  id: string;
  tenantId: string;
  organizationName: string;
  organizationStatus: StructureStatus;
  status: StructureStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamData {
  organizationId: string;
  facilityId: string | null;
  name: string;
}

export interface TeamSnapshot extends TeamData {
  id: string;
  tenantId: string;
  organizationName: string;
  organizationStatus: StructureStatus;
  facilityName: string | null;
  status: StructureStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function transitionStructureStatus(operation: 'activate' | 'archive'): StructureStatus {
  return operation === 'activate' ? 'active' : 'archived';
}

export class OrganizationHasActiveChildrenError extends Error {
  readonly code = 'ORGANIZATION_HAS_ACTIVE_CHILDREN';

  constructor() {
    super('Archive active facilities and teams before archiving their organization');
    this.name = 'OrganizationHasActiveChildrenError';
  }
}

export class FacilityHasActiveTeamsError extends Error {
  readonly code = 'FACILITY_HAS_ACTIVE_TEAMS';

  constructor() {
    super('Archive active teams before archiving their facility');
    this.name = 'FacilityHasActiveTeamsError';
  }
}
