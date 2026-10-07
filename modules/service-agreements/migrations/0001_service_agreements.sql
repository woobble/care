CREATE SCHEMA IF NOT EXISTS service_agreements;

CREATE TABLE service_agreements.agreements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'suspended', 'ended')),
  valid_from date NOT NULL,
  valid_until date,
  reference text CHECK (reference IS NULL OR length(trim(reference)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT service_agreements_validity_ck CHECK (
    valid_until IS NULL OR valid_until >= valid_from
  ),
  CONSTRAINT service_agreements_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_agreements_tenant_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_agreements_tenant_organization_facility_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_agreements_tenant_id_uq UNIQUE (tenant_id, id)
);

CREATE INDEX service_agreements_tenant_client_idx
  ON service_agreements.agreements (tenant_id, client_id, valid_from, id);
CREATE INDEX service_agreements_tenant_status_idx
  ON service_agreements.agreements (tenant_id, status, valid_from, id);
CREATE INDEX service_agreements_tenant_organization_idx
  ON service_agreements.agreements (tenant_id, organization_id, status, valid_from);
CREATE INDEX service_agreements_tenant_facility_idx
  ON service_agreements.agreements (tenant_id, facility_id, status, valid_from);
CREATE INDEX service_agreements_tenant_validity_idx
  ON service_agreements.agreements (tenant_id, valid_from, valid_until);

CREATE TABLE service_agreements.agreement_services (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  service_definition_id uuid NOT NULL,
  service_code text NOT NULL CHECK (length(trim(service_code)) BETWEEN 1 AND 64),
  service_name text NOT NULL CHECK (length(trim(service_name)) BETWEEN 1 AND 160),
  service_unit text NOT NULL CHECK (service_unit IN ('occurrence', 'minute', 'hour', 'day')),
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  valid_from date,
  valid_until date,
  quantity numeric(12, 3) CHECK (quantity IS NULL OR quantity > 0),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  schedule_type text CHECK (
    schedule_type IS NULL OR schedule_type IN (
      'daily', 'weekly', 'occurrences_per_week', 'interval_days', 'on_demand'
    )
  ),
  weekdays text[],
  occurrences_per_week smallint,
  interval_days smallint,
  preferred_time_start time,
  preferred_time_end time,
  ended_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT agreement_services_validity_ck CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from
  ),
  CONSTRAINT agreement_services_occurrence_quantity_ck CHECK (
    quantity IS NULL OR service_unit <> 'occurrence' OR quantity = trunc(quantity)
  ),
  CONSTRAINT agreement_services_schedule_ck CHECK (
    (schedule_type IS NULL AND weekdays IS NULL AND occurrences_per_week IS NULL AND interval_days IS NULL)
    OR (schedule_type = 'daily' AND weekdays IS NULL AND occurrences_per_week IS NULL AND interval_days IS NULL)
    OR (
      schedule_type = 'weekly'
      AND weekdays IS NOT NULL
      AND cardinality(weekdays) BETWEEN 1 AND 7
      AND weekdays <@ ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']::text[]
      AND occurrences_per_week IS NULL
      AND interval_days IS NULL
    )
    OR (
      schedule_type = 'occurrences_per_week'
      AND weekdays IS NULL
      AND occurrences_per_week BETWEEN 1 AND 14
      AND interval_days IS NULL
    )
    OR (
      schedule_type = 'interval_days'
      AND weekdays IS NULL
      AND occurrences_per_week IS NULL
      AND interval_days BETWEEN 1 AND 365
    )
    OR (
      schedule_type = 'on_demand'
      AND weekdays IS NULL
      AND occurrences_per_week IS NULL
      AND interval_days IS NULL
    )
  ),
  CONSTRAINT agreement_services_preferred_time_ck CHECK (
    (preferred_time_start IS NULL AND preferred_time_end IS NULL)
    OR (
      preferred_time_start IS NOT NULL
      AND preferred_time_end IS NOT NULL
      AND preferred_time_start < preferred_time_end
    )
  ),
  CONSTRAINT agreement_services_ended_at_ck CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  ),
  CONSTRAINT agreement_services_tenant_agreement_fk
    FOREIGN KEY (tenant_id, agreement_id)
    REFERENCES service_agreements.agreements (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT agreement_services_tenant_service_fk
    FOREIGN KEY (tenant_id, service_definition_id)
    REFERENCES services.service_definitions (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX agreement_services_tenant_agreement_status_idx
  ON service_agreements.agreement_services
    (tenant_id, agreement_id, status, service_definition_id);
CREATE INDEX agreement_services_tenant_service_idx
  ON service_agreements.agreement_services
    (tenant_id, service_definition_id, status, agreement_id);
CREATE UNIQUE INDEX agreement_services_active_definition_uq
  ON service_agreements.agreement_services (tenant_id, agreement_id, service_definition_id)
  WHERE status = 'active';

ALTER TABLE service_agreements.agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_agreements.agreements FORCE ROW LEVEL SECURITY;
CREATE POLICY service_agreements_tenant_isolation ON service_agreements.agreements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE service_agreements.agreement_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_agreements.agreement_services FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_services_tenant_isolation ON service_agreements.agreement_services
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA service_agreements TO care_app;
GRANT SELECT, INSERT, UPDATE ON service_agreements.agreements TO care_app;
GRANT SELECT, INSERT, UPDATE ON service_agreements.agreement_services TO care_app;
