CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX organizations_name_trgm_idx
  ON organizations.organizations USING gin (name gin_trgm_ops);
CREATE INDEX organizations_legal_name_trgm_idx
  ON organizations.organizations USING gin (legal_name gin_trgm_ops)
  WHERE legal_name IS NOT NULL;
CREATE INDEX organizations_code_trgm_idx
  ON organizations.organizations USING gin (code gin_trgm_ops)
  WHERE code IS NOT NULL;
CREATE INDEX organizations_status_name_order_idx
  ON organizations.organizations (tenant_id, status, name, id);

CREATE INDEX facilities_name_trgm_idx
  ON organizations.facilities USING gin (name gin_trgm_ops);
CREATE INDEX facilities_code_trgm_idx
  ON organizations.facilities USING gin (code gin_trgm_ops)
  WHERE code IS NOT NULL;
CREATE INDEX facilities_status_name_order_idx
  ON organizations.facilities (tenant_id, status, organization_id, name, id);

CREATE INDEX teams_name_trgm_idx
  ON organizations.teams USING gin (name gin_trgm_ops);
