CREATE SCHEMA IF NOT EXISTS clients;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE clients.clients (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  first_name text NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name text NOT NULL CHECK (length(trim(last_name)) > 0),
  preferred_name text,
  date_of_birth date,
  email text,
  phone text,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX clients_tenant_status_created_idx ON clients.clients(tenant_id, status, created_at DESC);
CREATE INDEX clients_name_trgm_idx ON clients.clients USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

ALTER TABLE clients.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients.clients FORCE ROW LEVEL SECURITY;
CREATE POLICY clients_tenant_isolation ON clients.clients
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA clients TO care_app;
GRANT SELECT, INSERT, UPDATE ON clients.clients TO care_app;
