export interface OrganizationSnapshot {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface FacilitySnapshot {
  id: string;
  tenantId: string;
  organizationId: string;
  organizationName: string;
  name: string;
  createdAt: Date;
}
