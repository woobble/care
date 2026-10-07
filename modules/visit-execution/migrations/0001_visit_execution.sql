CREATE SCHEMA IF NOT EXISTS visit_execution;

ALTER TABLE scheduling.visit_services
  DROP CONSTRAINT IF EXISTS visit_services_tenant_visit_id_uq;
DROP INDEX IF EXISTS scheduling.visit_services_tenant_visit_idx;
ALTER TABLE scheduling.visit_services
  ADD CONSTRAINT visit_services_tenant_visit_id_uq UNIQUE (tenant_id, visit_id, id);
ALTER TABLE scheduling.visit_services
  ADD CONSTRAINT visit_services_tenant_visit_service_definition_uq
  UNIQUE (tenant_id, visit_id, id, service_definition_id);

CREATE TABLE visit_execution.executions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  actual_start timestamptz NOT NULL,
  actual_end timestamptz,
  started_by_employee_id uuid NOT NULL,
  completed_by_employee_id uuid,
  operational_note text CHECK (operational_note IS NULL OR length(operational_note) <= 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT visit_executions_lifecycle_ck CHECK (
    (status = 'in_progress' AND actual_end IS NULL AND completed_by_employee_id IS NULL)
    OR (status = 'completed' AND actual_end IS NOT NULL AND completed_by_employee_id IS NOT NULL)
  ),
  CONSTRAINT visit_executions_time_ck CHECK (actual_end IS NULL OR actual_end > actual_start),
  CONSTRAINT visit_executions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT visit_executions_tenant_visit_uq UNIQUE (tenant_id, visit_id),
  CONSTRAINT visit_executions_tenant_id_visit_uq UNIQUE (tenant_id, id, visit_id),
  CONSTRAINT visit_executions_visit_fk
    FOREIGN KEY (tenant_id, visit_id) REFERENCES scheduling.visits (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_executions_started_by_employee_fk
    FOREIGN KEY (tenant_id, started_by_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_executions_completed_by_employee_fk
    FOREIGN KEY (tenant_id, completed_by_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX visit_executions_tenant_status_idx
  ON visit_execution.executions (tenant_id, status, updated_at);

CREATE TABLE visit_execution.performed_services (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  visit_service_id uuid,
  service_definition_id uuid NOT NULL,
  service_agreement_id uuid,
  agreement_service_id uuid,
  service_code_snapshot text NOT NULL CHECK (length(trim(service_code_snapshot)) BETWEEN 1 AND 64),
  service_name_snapshot text NOT NULL CHECK (length(trim(service_name_snapshot)) BETWEEN 1 AND 160),
  unit_snapshot text NOT NULL CHECK (unit_snapshot IN ('occurrence', 'minute', 'hour', 'day')),
  planned_quantity numeric(12, 3),
  actual_quantity numeric(12, 3),
  status text NOT NULL CHECK (status IN ('performed', 'partially_performed', 'not_performed')),
  reason_code text CHECK (
    reason_code IS NULL OR reason_code IN (
      'client_declined', 'client_not_present', 'service_not_required',
      'time_constraint', 'provider_decision', 'other'
    )
  ),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  performed_by_employee_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT performed_services_snapshot_ck CHECK (
    length(trim(service_code_snapshot)) BETWEEN 1 AND 64
    AND length(trim(service_name_snapshot)) BETWEEN 1 AND 160
  ),
  CONSTRAINT performed_services_quantity_ck CHECK (
    (
      (planned_quantity IS NULL AND visit_service_id IS NULL
        AND service_agreement_id IS NULL AND agreement_service_id IS NULL)
      OR (planned_quantity > 0 AND visit_service_id IS NOT NULL)
    )
    AND (actual_quantity IS NULL OR actual_quantity >= 0)
    AND (
      (status = 'performed' AND actual_quantity > 0)
      OR (status = 'partially_performed' AND planned_quantity IS NOT NULL
        AND actual_quantity > 0 AND actual_quantity < planned_quantity)
      OR (status = 'not_performed' AND (actual_quantity IS NULL OR actual_quantity = 0)
        AND reason_code IS NOT NULL)
    )
  ),
  CONSTRAINT performed_services_agreement_reference_ck CHECK (
    (service_agreement_id IS NULL AND agreement_service_id IS NULL)
    OR (service_agreement_id IS NOT NULL AND agreement_service_id IS NOT NULL)
  ),
  CONSTRAINT performed_services_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT performed_services_execution_fk
    FOREIGN KEY (tenant_id, execution_id, visit_id)
    REFERENCES visit_execution.executions (tenant_id, id, visit_id) ON DELETE RESTRICT,
  CONSTRAINT performed_services_visit_service_fk
    FOREIGN KEY (tenant_id, visit_id, visit_service_id, service_definition_id)
    REFERENCES scheduling.visit_services (tenant_id, visit_id, id, service_definition_id) ON DELETE RESTRICT,
  CONSTRAINT performed_services_service_fk
    FOREIGN KEY (tenant_id, service_definition_id)
    REFERENCES services.service_definitions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT performed_services_agreement_service_fk
    FOREIGN KEY (tenant_id, service_agreement_id, agreement_service_id, service_definition_id)
    REFERENCES service_agreements.agreement_services
      (tenant_id, agreement_id, id, service_definition_id) ON DELETE RESTRICT,
  CONSTRAINT performed_services_employee_fk
    FOREIGN KEY (tenant_id, performed_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX performed_services_planned_service_uq
  ON visit_execution.performed_services (tenant_id, execution_id, visit_service_id)
  WHERE visit_service_id IS NOT NULL;
CREATE INDEX performed_services_execution_idx
  ON visit_execution.performed_services (tenant_id, execution_id, created_at);

ALTER TABLE visit_execution.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_execution.executions FORCE ROW LEVEL SECURITY;
CREATE POLICY visit_executions_tenant_isolation ON visit_execution.executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE visit_execution.performed_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_execution.performed_services FORCE ROW LEVEL SECURITY;
CREATE POLICY performed_services_tenant_isolation ON visit_execution.performed_services
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA visit_execution TO care_app;
GRANT SELECT, INSERT, UPDATE ON visit_execution.executions TO care_app;
GRANT SELECT, INSERT, UPDATE ON visit_execution.performed_services TO care_app;
