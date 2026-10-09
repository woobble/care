CREATE TABLE medication.reconciliations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'completed', 'cancelled')),
  reason text NOT NULL CHECK (reason IN ('initial_intake', 'hospital_discharge', 'physician_update', 'periodic_review', 'reported_change', 'other')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  input_version integer NOT NULL DEFAULT 0 CHECK (input_version >= 0),
  compared_input_version integer CHECK (compared_input_version IS NULL OR (compared_input_version >= 0 AND compared_input_version <= input_version)),
  comparison_version integer NOT NULL DEFAULT 0 CHECK (comparison_version >= 0),
  started_by_employee_id uuid NOT NULL,
  reviewed_by_employee_id uuid,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancellation_reason text CHECK (cancellation_reason IS NULL OR length(cancellation_reason) <= 1000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliations_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliations_client_reference_uq UNIQUE (tenant_id, id, client_id),
  CONSTRAINT medication_reconciliations_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliations_started_employee_fk FOREIGN KEY (tenant_id, started_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliations_reviewed_employee_fk FOREIGN KEY (tenant_id, reviewed_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliations_lifecycle_ck CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND reviewed_by_employee_id IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX medication_reconciliations_client_started_idx
  ON medication.reconciliations (tenant_id, client_id, started_at DESC);

CREATE TABLE medication.reconciliation_sources (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('physician', 'hospital_discharge', 'pharmacy', 'client', 'representative', 'other')),
  provenance_class text NOT NULL CHECK (provenance_class IN ('clinician_instruction', 'pharmacy_record', 'client_report', 'representative_report', 'other')),
  source_name text CHECK (source_name IS NULL OR length(trim(source_name)) BETWEEN 1 AND 200),
  source_date date,
  received_at timestamptz NOT NULL,
  recorded_by_employee_id uuid NOT NULL,
  reference text CHECK (reference IS NULL OR length(trim(reference)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_sources_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_sources_reference_uq UNIQUE (tenant_id, reconciliation_id, client_id, id),
  CONSTRAINT medication_reconciliation_sources_provenance_ck CHECK (
    (source_type IN ('physician', 'hospital_discharge') AND provenance_class = 'clinician_instruction')
    OR (source_type = 'pharmacy' AND provenance_class = 'pharmacy_record')
    OR (source_type = 'client' AND provenance_class = 'client_report')
    OR (source_type = 'representative' AND provenance_class = 'representative_report')
    OR (source_type = 'other' AND provenance_class = 'other')
  ),
  CONSTRAINT medication_reconciliation_sources_reconciliation_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id)
    REFERENCES medication.reconciliations (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_sources_employee_fk FOREIGN KEY (tenant_id, recorded_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_reconciliation_sources_history_idx
  ON medication.reconciliation_sources (tenant_id, reconciliation_id, received_at);

CREATE TABLE medication.reconciliation_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  source_id uuid NOT NULL,
  supersedes_entry_id uuid,
  correction_reason text,
  medication_name text NOT NULL CHECK (length(trim(medication_name)) BETWEEN 1 AND 200),
  active_ingredient text CHECK (active_ingredient IS NULL OR length(active_ingredient) <= 200),
  strength text CHECK (strength IS NULL OR length(strength) <= 120),
  dosage_form text CHECK (dosage_form IS NULL OR dosage_form IN ('tablet', 'capsule', 'drops', 'solution', 'injection', 'cream', 'patch', 'inhalation', 'other')),
  dose_amount numeric(12,3),
  dose_unit text CHECK (dose_unit IS NULL OR dose_unit IN ('mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch')),
  route text CHECK (route IS NULL OR route IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other')),
  schedule_description text CHECK (schedule_description IS NULL OR length(schedule_description) <= 1000),
  structured_schedule jsonb CHECK (
    structured_schedule IS NULL OR (
      jsonb_typeof(structured_schedule) = 'object'
      AND structured_schedule->>'type' IN ('fixed_times', 'interval', 'as_needed')
      AND length(trim(coalesce(structured_schedule->>'timezone', ''))) BETWEEN 1 AND 100
      AND ((structured_schedule->>'type' <> 'fixed_times') OR (jsonb_typeof(structured_schedule->'times') = 'array' AND jsonb_array_length(structured_schedule->'times') BETWEEN 1 AND 24))
      AND ((structured_schedule->>'type' <> 'interval') OR ((structured_schedule->>'anchorAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' AND (structured_schedule->>'intervalMinutes') ~ '^[0-9]+$' AND (structured_schedule->>'intervalMinutes')::integer BETWEEN 30 AND 10080))
      AND ((structured_schedule->>'type' <> 'as_needed') OR length(trim(coalesce(structured_schedule->>'indication', ''))) BETWEEN 1 AND 1000)
    )
  ),
  reported_status text NOT NULL CHECK (reported_status IN ('active', 'paused', 'discontinued', 'unknown')),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  recorded_by_employee_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_entries_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_entries_reference_uq UNIQUE (tenant_id, reconciliation_id, client_id, id),
  CONSTRAINT medication_reconciliation_entries_source_reference_uq UNIQUE (tenant_id, reconciliation_id, client_id, source_id, id),
  CONSTRAINT medication_reconciliation_entries_correction_ck CHECK (
    (supersedes_entry_id IS NULL AND correction_reason IS NULL)
    OR (supersedes_entry_id IS NOT NULL AND length(trim(coalesce(correction_reason, ''))) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT medication_reconciliation_entries_dose_ck CHECK (
    ((dose_amount IS NULL AND dose_unit IS NULL) OR (dose_amount > 0 AND dose_unit IS NOT NULL))
  ),
  CONSTRAINT medication_reconciliation_entries_supersedes_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, source_id, supersedes_entry_id)
    REFERENCES medication.reconciliation_entries (tenant_id, reconciliation_id, client_id, source_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_entries_source_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, source_id)
    REFERENCES medication.reconciliation_sources (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_entries_reconciliation_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id)
    REFERENCES medication.reconciliations (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_entries_employee_fk FOREIGN KEY (tenant_id, recorded_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX medication_reconciliation_entries_supersedes_uq
  ON medication.reconciliation_entries (tenant_id, supersedes_entry_id)
  WHERE supersedes_entry_id IS NOT NULL;
CREATE INDEX medication_reconciliation_entries_history_idx
  ON medication.reconciliation_entries (tenant_id, reconciliation_id, created_at);

CREATE TABLE medication.reconciliation_baselines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_revision_id uuid NOT NULL,
  order_version integer NOT NULL CHECK (order_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_baselines_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_baselines_order_uq UNIQUE (tenant_id, reconciliation_id, order_id),
  CONSTRAINT medication_reconciliation_baselines_reference_uq UNIQUE (tenant_id, reconciliation_id, client_id, id),
  CONSTRAINT medication_reconciliation_baselines_reconciliation_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id)
    REFERENCES medication.reconciliations (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_baselines_order_fk FOREIGN KEY (tenant_id, order_id, client_id)
    REFERENCES medication.orders (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_baselines_revision_fk FOREIGN KEY (tenant_id, order_revision_id, order_id, client_id, order_version)
    REFERENCES medication.order_revisions (tenant_id, id, order_id, client_id, version) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_reconciliation_baselines_order_idx
  ON medication.reconciliation_baselines (tenant_id, order_id, order_version);

CREATE TABLE medication.reconciliation_matches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  baseline_id uuid,
  version integer NOT NULL CHECK (version > 0),
  matched_by_employee_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_matches_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_matches_entry_version_uq UNIQUE (tenant_id, entry_id, version),
  CONSTRAINT medication_reconciliation_matches_reconciliation_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id)
    REFERENCES medication.reconciliations (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_matches_entry_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, entry_id)
    REFERENCES medication.reconciliation_entries (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_matches_baseline_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, baseline_id)
    REFERENCES medication.reconciliation_baselines (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_matches_employee_fk FOREIGN KEY (tenant_id, matched_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_reconciliation_matches_history_idx
  ON medication.reconciliation_matches (tenant_id, reconciliation_id, entry_id, version DESC);

CREATE TABLE medication.reconciliation_discrepancies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  comparison_version integer NOT NULL CHECK (comparison_version > 0),
  type text NOT NULL CHECK (type IN ('missing_in_internal_plan', 'missing_in_external_source', 'dose_mismatch', 'route_mismatch', 'schedule_mismatch', 'medication_mismatch', 'status_mismatch', 'insufficient_information')),
  field text NOT NULL CHECK (length(trim(field)) BETWEEN 1 AND 80),
  entry_id uuid,
  baseline_id uuid,
  external_value jsonb,
  internal_value jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_discrepancies_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_discrepancies_reference_uq UNIQUE (tenant_id, reconciliation_id, client_id, id),
  CONSTRAINT medication_reconciliation_discrepancies_reference_check CHECK (entry_id IS NOT NULL OR baseline_id IS NOT NULL),
  CONSTRAINT medication_reconciliation_discrepancies_reconciliation_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id)
    REFERENCES medication.reconciliations (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_discrepancies_entry_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, entry_id)
    REFERENCES medication.reconciliation_entries (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_discrepancies_baseline_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, baseline_id)
    REFERENCES medication.reconciliation_baselines (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_reconciliation_discrepancies_current_idx
  ON medication.reconciliation_discrepancies (tenant_id, reconciliation_id, comparison_version);

CREATE TABLE medication.reconciliation_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  discrepancy_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  decision text NOT NULL CHECK (decision IN ('accept_internal', 'accept_external', 'requires_clarification', 'no_change')),
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  clarification_outcome text CHECK (clarification_outcome IS NULL OR length(clarification_outcome) <= 2000),
  reviewed_by_employee_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_decisions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_decisions_discrepancy_version_uq UNIQUE (tenant_id, discrepancy_id, version),
  CONSTRAINT medication_reconciliation_decisions_reason_ck CHECK (decision <> 'requires_clarification' OR length(trim(coalesce(reason, ''))) BETWEEN 1 AND 1000),
  CONSTRAINT medication_reconciliation_decisions_discrepancy_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, discrepancy_id)
    REFERENCES medication.reconciliation_discrepancies (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_decisions_employee_fk FOREIGN KEY (tenant_id, reviewed_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_reconciliation_decisions_history_idx
  ON medication.reconciliation_decisions (tenant_id, discrepancy_id, version DESC);

CREATE TABLE medication.reconciliation_applications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  discrepancy_id uuid NOT NULL,
  action_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('applied', 'not_applied')),
  reason text,
  order_id uuid,
  order_revision_id uuid,
  order_version integer,
  applied_by_employee_id uuid NOT NULL,
  applied_at timestamptz NOT NULL,
  CONSTRAINT medication_reconciliation_applications_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_reconciliation_applications_discrepancy_uq UNIQUE (tenant_id, discrepancy_id),
  CONSTRAINT medication_reconciliation_applications_action_uq UNIQUE (tenant_id, reconciliation_id, action_id, discrepancy_id),
  CONSTRAINT medication_reconciliation_applications_values_ck CHECK (
    (disposition = 'applied' AND order_id IS NOT NULL AND order_revision_id IS NOT NULL AND order_version IS NOT NULL AND reason IS NULL)
    OR (disposition = 'not_applied' AND order_id IS NULL AND order_revision_id IS NULL AND order_version IS NULL AND length(trim(coalesce(reason, ''))) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT medication_reconciliation_applications_discrepancy_fk FOREIGN KEY (tenant_id, reconciliation_id, client_id, discrepancy_id)
    REFERENCES medication.reconciliation_discrepancies (tenant_id, reconciliation_id, client_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_applications_order_fk FOREIGN KEY (tenant_id, order_id, client_id)
    REFERENCES medication.orders (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_applications_revision_fk FOREIGN KEY (tenant_id, order_revision_id, order_id, client_id, order_version)
    REFERENCES medication.order_revisions (tenant_id, id, order_id, client_id, version) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_reconciliation_applications_employee_fk FOREIGN KEY (tenant_id, applied_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_reconciliation_applications_history_idx
  ON medication.reconciliation_applications (tenant_id, reconciliation_id, applied_at);

CREATE FUNCTION medication.guard_reconciliation_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Medication reconciliation is immutable' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_immutable_ck';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.client_id, NEW.reason, NEW.started_by_employee_id, NEW.started_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.client_id, OLD.reason, OLD.started_by_employee_id, OLD.started_at, OLD.created_at) THEN
    RAISE EXCEPTION 'Medication reconciliation identity is immutable' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_identity_immutable_ck';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.comparison_version < OLD.comparison_version OR NEW.comparison_version > OLD.comparison_version + 1 OR NEW.input_version < OLD.input_version OR NEW.input_version > OLD.input_version + 1 THEN
    RAISE EXCEPTION 'Medication reconciliation version must advance once' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_version_ck';
  END IF;
  IF NEW.compared_input_version IS DISTINCT FROM OLD.compared_input_version
     AND NEW.compared_input_version IS DISTINCT FROM NEW.input_version THEN
    RAISE EXCEPTION 'Comparison must capture the current input version' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_comparison_version_ck';
  END IF;
  IF NOT (
    (NEW.status = OLD.status AND OLD.status IN ('draft', 'in_review'))
    OR (OLD.status = 'draft' AND NEW.status IN ('in_review', 'cancelled'))
    OR (OLD.status = 'in_review' AND NEW.status IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid medication reconciliation state transition' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_transition_ck';
  END IF;
  IF NEW.status = 'completed' AND (NEW.comparison_version = 0 OR NEW.compared_input_version IS DISTINCT FROM NEW.input_version OR NEW.completed_at IS NULL OR NEW.reviewed_by_employee_id IS NULL) THEN
    RAISE EXCEPTION 'Completed reconciliation requires a comparison and reviewer' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_completion_ck';
  END IF;
  IF NEW.status <> 'completed' AND (NEW.completed_at IS NOT NULL OR NEW.reviewed_by_employee_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Reviewer and completion time are set only on completion' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_completion_ck';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancellation_reason IS NOT DISTINCT FROM OLD.cancellation_reason THEN
    NULL;
  ELSIF NEW.status <> 'cancelled' AND NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
    RAISE EXCEPTION 'Cancellation reason is set only when cancelling' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_cancel_reason_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER medication_reconciliation_update_guard
  BEFORE UPDATE ON medication.reconciliations
  FOR EACH ROW EXECUTE FUNCTION medication.guard_reconciliation_update();

CREATE FUNCTION medication.guard_reconciliation_child_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Medication reconciliation history is append-only' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_history_immutable_ck';
  END IF;
  SELECT status INTO current_status
    FROM medication.reconciliations
    WHERE tenant_id = NEW.tenant_id AND id = NEW.reconciliation_id
    FOR SHARE;
  IF current_status IS NULL THEN
    RAISE EXCEPTION 'Medication reconciliation does not exist' USING ERRCODE = '23503', CONSTRAINT = 'medication_reconciliation_child_fk';
  END IF;
  IF current_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Completed medication reconciliation is immutable' USING ERRCODE = '23514', CONSTRAINT = 'medication_reconciliation_immutable_ck';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'reconciliation_sources', 'reconciliation_entries', 'reconciliation_baselines',
    'reconciliation_matches', 'reconciliation_discrepancies', 'reconciliation_decisions',
    'reconciliation_applications'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON medication.%I FOR EACH ROW EXECUTE FUNCTION medication.guard_reconciliation_child_insert()',
      'medication_' || table_name || '_append_only', table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE medication.reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_baselines FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_matches FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_discrepancies FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.reconciliation_applications FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'reconciliations', 'reconciliation_sources', 'reconciliation_entries',
    'reconciliation_baselines', 'reconciliation_matches', 'reconciliation_discrepancies',
    'reconciliation_decisions', 'reconciliation_applications'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON medication.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON medication.reconciliations TO care_app;
GRANT SELECT, INSERT ON medication.reconciliation_sources, medication.reconciliation_entries,
  medication.reconciliation_baselines, medication.reconciliation_matches,
  medication.reconciliation_discrepancies, medication.reconciliation_decisions,
  medication.reconciliation_applications TO care_app;
