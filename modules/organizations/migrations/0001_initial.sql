CREATE SCHEMA IF NOT EXISTS organizations;

CREATE TABLE organizations.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations.organizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE organizations.facilities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  organization_id uuid NOT NULL REFERENCES organizations.organizations(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE organizations.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON organizations.organizations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE organizations.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.facilities FORCE ROW LEVEL SECURITY;
CREATE POLICY facilities_tenant_isolation ON organizations.facilities
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA organizations TO care_app;
GRANT SELECT ON organizations.tenants TO care_app;
GRANT SELECT, INSERT, UPDATE ON organizations.organizations, organizations.facilities TO care_app;
