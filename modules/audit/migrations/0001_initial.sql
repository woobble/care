CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.audit_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  timestamp timestamptz NOT NULL,
  request_id text NOT NULL,
  correlation_id text NOT NULL,
  ip text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_entries_tenant_timestamp_idx ON audit.audit_entries(tenant_id, timestamp DESC);
CREATE INDEX audit_entries_resource_idx ON audit.audit_entries(tenant_id, resource_type, resource_id);

ALTER TABLE audit.audit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_isolation ON audit.audit_entries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA audit TO care_app;
GRANT SELECT, INSERT ON audit.audit_entries TO care_app;
