CREATE SCHEMA IF NOT EXISTS scheduling;

CREATE TABLE scheduling.visits (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('agreement_generated', 'manual')),
  service_agreement_id uuid,
  status text NOT NULL CHECK (status IN ('planned', 'confirmed', 'cancelled')),
  planned_start timestamptz NOT NULL,
  planned_end timestamptz NOT NULL,
  time_window_start timestamptz,
  time_window_end timestamptz,
  timezone text NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  manually_adjusted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT visits_planned_range_ck CHECK (planned_end > planned_start),
  CONSTRAINT visits_window_pair_ck CHECK (
    (time_window_start IS NULL AND time_window_end IS NULL)
    OR (time_window_start IS NOT NULL AND time_window_end IS NOT NULL AND time_window_end > time_window_start)
  ),
  CONSTRAINT visits_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT visits_tenant_id_agreement_uq UNIQUE (tenant_id, id, service_agreement_id),
  CONSTRAINT visits_tenant_provider_reference_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT visits_tenant_client_provider_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id, client_id)
    REFERENCES clients.clients (tenant_id, organization_id, primary_facility_id, id) ON DELETE RESTRICT,
  CONSTRAINT visits_agreement_context_fk
    FOREIGN KEY (tenant_id, client_id, organization_id, facility_id, service_agreement_id)
    REFERENCES service_agreements.agreements (tenant_id, client_id, organization_id, facility_id, id) ON DELETE RESTRICT
);

CREATE INDEX visits_tenant_start_id_idx
  ON scheduling.visits (tenant_id, planned_start, id);
CREATE INDEX visits_facility_start_id_idx
  ON scheduling.visits (tenant_id, facility_id, planned_start, id);
CREATE INDEX visits_client_start_idx
  ON scheduling.visits (tenant_id, client_id, planned_start, id);
CREATE INDEX visits_agreement_idx
  ON scheduling.visits (tenant_id, service_agreement_id, planned_start)
  WHERE service_agreement_id IS NOT NULL;
CREATE INDEX visits_status_start_idx
  ON scheduling.visits (tenant_id, status, planned_start, id);

CREATE TABLE scheduling.visit_services (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  service_agreement_id uuid,
  agreement_service_id uuid,
  service_definition_id uuid NOT NULL,
  service_code_snapshot text NOT NULL CHECK (length(trim(service_code_snapshot)) BETWEEN 1 AND 64),
  service_name_snapshot text NOT NULL CHECK (length(trim(service_name_snapshot)) BETWEEN 1 AND 160),
  unit_snapshot text NOT NULL CHECK (unit_snapshot IN ('occurrence', 'minute', 'hour', 'day')),
  planned_quantity numeric(12, 3) NOT NULL CHECK (planned_quantity > 0),
  planned_duration_minutes integer CHECK (
    planned_duration_minutes IS NULL OR planned_duration_minutes BETWEEN 1 AND 1440
  ),
  generation_key text,
  generated_from_rule boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT visit_services_agreement_reference_ck CHECK (
    (service_agreement_id IS NULL AND agreement_service_id IS NULL)
    OR (service_agreement_id IS NOT NULL AND agreement_service_id IS NOT NULL)
  ),
  CONSTRAINT visit_services_visit_fk
    FOREIGN KEY (tenant_id, visit_id) REFERENCES scheduling.visits (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_services_visit_agreement_fk
    FOREIGN KEY (tenant_id, visit_id, service_agreement_id)
    REFERENCES scheduling.visits (tenant_id, id, service_agreement_id) ON DELETE RESTRICT,
  CONSTRAINT visit_services_service_fk
    FOREIGN KEY (tenant_id, service_definition_id)
    REFERENCES services.service_definitions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_services_agreement_service_fk
    FOREIGN KEY (tenant_id, service_agreement_id, agreement_service_id, service_definition_id)
    REFERENCES service_agreements.agreement_services (tenant_id, agreement_id, id, service_definition_id) ON DELETE RESTRICT
);

CREATE INDEX visit_services_tenant_visit_idx
  ON scheduling.visit_services (tenant_id, visit_id, id);
CREATE INDEX visit_services_service_idx
  ON scheduling.visit_services (tenant_id, service_definition_id, visit_id);
CREATE UNIQUE INDEX visit_services_generation_key_uq
  ON scheduling.visit_services (tenant_id, generation_key)
  WHERE generation_key IS NOT NULL;

CREATE TABLE scheduling.visit_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  role text CHECK (role IS NULL OR length(role) <= 80),
  status text NOT NULL CHECK (status IN ('active', 'unassigned')),
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL,
  unassigned_at timestamptz,
  CONSTRAINT visit_assignments_status_ck CHECK (
    (status = 'active' AND unassigned_at IS NULL)
    OR (status = 'unassigned' AND unassigned_at IS NOT NULL)
  ),
  CONSTRAINT visit_assignments_visit_fk
    FOREIGN KEY (tenant_id, visit_id) REFERENCES scheduling.visits (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_assignments_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX visit_assignments_employee_active_idx
  ON scheduling.visit_assignments (tenant_id, employee_id, visit_id)
  WHERE status = 'active';
CREATE INDEX visit_assignments_visit_idx
  ON scheduling.visit_assignments (tenant_id, visit_id, status, assigned_at);
CREATE UNIQUE INDEX visit_assignments_active_employee_uq
  ON scheduling.visit_assignments (tenant_id, visit_id, employee_id)
  WHERE status = 'active';

CREATE TABLE scheduling.employee_unavailability (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  CONSTRAINT employee_unavailability_range_ck CHECK (ends_at > starts_at),
  CONSTRAINT employee_unavailability_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX employee_unavailability_employee_range_idx
  ON scheduling.employee_unavailability (tenant_id, employee_id, starts_at, ends_at);

CREATE TABLE scheduling.schedule_generations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  generated_by uuid NOT NULL,
  from_date date NOT NULL,
  until_date date NOT NULL,
  generated_count integer NOT NULL CHECK (generated_count >= 0),
  already_existing_count integer NOT NULL CHECK (already_existing_count >= 0),
  requires_manual_placement_count integer NOT NULL CHECK (requires_manual_placement_count >= 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT schedule_generations_range_ck CHECK (until_date >= from_date),
  CONSTRAINT schedule_generations_agreement_fk
    FOREIGN KEY (tenant_id, agreement_id) REFERENCES service_agreements.agreements (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX schedule_generations_agreement_created_idx
  ON scheduling.schedule_generations (tenant_id, agreement_id, created_at DESC);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'visits', 'visit_services', 'visit_assignments', 'employee_unavailability', 'schedule_generations'
  ] LOOP
    EXECUTE format('ALTER TABLE scheduling.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE scheduling.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON scheduling.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA scheduling TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.visits TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.visit_services TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.visit_assignments TO care_app;
GRANT SELECT, INSERT ON scheduling.employee_unavailability TO care_app;
GRANT SELECT, INSERT ON scheduling.schedule_generations TO care_app;
