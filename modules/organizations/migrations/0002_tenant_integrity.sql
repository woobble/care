ALTER TABLE organizations.organizations
  ADD CONSTRAINT organizations_tenant_id_id_uq UNIQUE (tenant_id, id);

ALTER TABLE organizations.facilities
  ADD CONSTRAINT facilities_tenant_id_id_uq UNIQUE (tenant_id, id),
  ADD CONSTRAINT facilities_organization_tenant_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id);
