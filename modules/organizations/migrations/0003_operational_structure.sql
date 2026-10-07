ALTER TABLE organizations.organizations
  ADD COLUMN legal_name text,
  ADD COLUMN code text,
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN address text,
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX organizations_tenant_code_uq
  ON organizations.organizations (tenant_id, code)
  WHERE code IS NOT NULL;

ALTER TABLE organizations.facilities
  ADD COLUMN code text,
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN address text,
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT facilities_tenant_organization_id_id_uq
    UNIQUE (tenant_id, organization_id, id);

CREATE UNIQUE INDEX facilities_tenant_code_uq
  ON organizations.facilities (tenant_id, code)
  WHERE code IS NOT NULL;

CREATE TABLE organizations.teams (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_tenant_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT teams_tenant_organization_facility_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  CONSTRAINT teams_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT teams_tenant_organization_id_id_uq UNIQUE (tenant_id, organization_id, id)
);

CREATE UNIQUE INDEX teams_org_name_without_facility_uq
  ON organizations.teams (tenant_id, organization_id, name)
  WHERE facility_id IS NULL;

CREATE UNIQUE INDEX teams_facility_name_uq
  ON organizations.teams (tenant_id, organization_id, facility_id, name)
  WHERE facility_id IS NOT NULL;

CREATE INDEX teams_tenant_organization_idx
  ON organizations.teams (tenant_id, organization_id, status, name, id);

ALTER TABLE organizations.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.teams FORCE ROW LEVEL SECURITY;
CREATE POLICY teams_tenant_isolation ON organizations.teams
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON organizations.organizations, organizations.facilities TO care_app;
GRANT SELECT, INSERT, UPDATE ON organizations.teams TO care_app;
