CREATE SCHEMA IF NOT EXISTS services;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE services.service_categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  code text CHECK (code IS NULL OR length(trim(code)) <= 40),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  sort_order integer CHECK (sort_order IS NULL OR sort_order BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT service_categories_tenant_id_uq UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX service_categories_tenant_code_uq
  ON services.service_categories (tenant_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX service_categories_tenant_status_order_idx
  ON services.service_categories (tenant_id, status, sort_order, name);

CREATE TABLE services.service_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  category_id uuid NOT NULL,
  unit text NOT NULL CHECK (unit IN ('occurrence', 'minute', 'hour', 'day')),
  default_duration_minutes integer CHECK (
    default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 1 AND 1440
  ),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  valid_from date NOT NULL,
  valid_until date,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT service_definitions_validity_ck CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT service_definitions_tenant_category_fk
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES services.service_categories (tenant_id, id),
  CONSTRAINT service_definitions_tenant_id_uq UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX service_definitions_tenant_code_uq
  ON services.service_definitions (tenant_id, lower(code));
CREATE INDEX service_definitions_tenant_category_status_idx
  ON services.service_definitions (tenant_id, category_id, status, code, id);
CREATE INDEX service_definitions_name_trgm_idx
  ON services.service_definitions USING gin (name gin_trgm_ops);

CREATE TABLE services.service_availability (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  active boolean NOT NULL,
  valid_from date,
  valid_until date,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT service_availability_validity_ck CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT service_availability_tenant_service_fk
    FOREIGN KEY (tenant_id, service_id)
    REFERENCES services.service_definitions (tenant_id, id),
  CONSTRAINT service_availability_tenant_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT service_availability_tenant_organization_facility_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id)
);

CREATE UNIQUE INDEX service_availability_active_org_uq
  ON services.service_availability (tenant_id, service_id, organization_id)
  WHERE active AND facility_id IS NULL;
CREATE UNIQUE INDEX service_availability_active_facility_uq
  ON services.service_availability (tenant_id, service_id, organization_id, facility_id)
  WHERE active AND facility_id IS NOT NULL;
CREATE INDEX service_availability_scope_idx
  ON services.service_availability (tenant_id, organization_id, facility_id, service_id, active);

ALTER TABLE services.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE services.service_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY service_categories_tenant_isolation ON services.service_categories
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE services.service_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE services.service_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY service_definitions_tenant_isolation ON services.service_definitions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE services.service_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE services.service_availability FORCE ROW LEVEL SECURITY;
CREATE POLICY service_availability_tenant_isolation ON services.service_availability
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA services TO care_app;
GRANT SELECT, INSERT, UPDATE ON services.service_categories TO care_app;
GRANT SELECT, INSERT, UPDATE ON services.service_definitions TO care_app;
GRANT SELECT, INSERT, UPDATE ON services.service_availability TO care_app;
