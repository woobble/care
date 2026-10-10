CREATE TABLE operations.exception_occurrences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  issue_key text NOT NULL CHECK (length(issue_key) = 64),
  source_domain text NOT NULL CHECK (
    source_domain IN ('scheduling', 'care_documentation', 'service_evidence', 'benefits', 'billing', 'claims')
  ),
  source_entity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  issue_code text NOT NULL,
  category text NOT NULL CHECK (
    category IN ('scheduling', 'visits', 'documentation', 'benefits', 'billing', 'claims')
  ),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  organization_id uuid,
  facility_id uuid,
  client_id uuid,
  source_at timestamptz,
  first_detected_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT operations_exception_occurrences_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT operations_exception_occurrences_tenant_organization_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT operations_exception_occurrences_tenant_facility_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities(tenant_id, organization_id, id),
  CONSTRAINT operations_exception_occurrences_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients(tenant_id, id)
);

CREATE UNIQUE INDEX operations_exception_occurrences_active_issue_uq
  ON operations.exception_occurrences (tenant_id, issue_key)
  WHERE resolved_at IS NULL;
CREATE INDEX operations_exception_occurrences_history_idx
  ON operations.exception_occurrences (tenant_id, issue_key, first_detected_at, id);
CREATE INDEX operations_exception_occurrences_reconcile_idx
  ON operations.exception_occurrences (tenant_id, source_domain, resolved_at, last_observed_at);

ALTER TABLE operations.exception_interactions
  ADD COLUMN occurrence_id uuid;
ALTER TABLE operations.exception_interactions
  ADD CONSTRAINT operations_exception_interactions_occurrence_fk
  FOREIGN KEY (tenant_id, occurrence_id)
  REFERENCES operations.exception_occurrences (tenant_id, id);
CREATE INDEX operations_exception_interactions_occurrence_time_idx
  ON operations.exception_interactions (tenant_id, occurrence_id, occurred_at, id);

ALTER TABLE operations.exception_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.exception_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_exception_occurrences_tenant_isolation
  ON operations.exception_occurrences
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON operations.exception_occurrences TO care_app;
