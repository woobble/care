CREATE SCHEMA IF NOT EXISTS medication;

CREATE TABLE medication.definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  active_ingredient text,
  strength text,
  dosage_form text NOT NULL CHECK (dosage_form IN ('tablet', 'capsule', 'drops', 'solution', 'injection', 'cream', 'patch', 'inhalation', 'other')),
  route text NOT NULL CHECK (route IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other')),
  manufacturer text,
  external_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT medication_definitions_tenant_id_uq UNIQUE (tenant_id, id)
);
CREATE INDEX medication_definitions_tenant_name_idx ON medication.definitions (tenant_id, status, name);

CREATE TABLE medication.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'discontinued')),
  version integer NOT NULL CHECK (version > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT medication_orders_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_orders_tenant_id_client_uq UNIQUE (tenant_id, id, client_id),
  CONSTRAINT medication_orders_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_orders_client_status_idx ON medication.orders (tenant_id, client_id, status, updated_at DESC);

CREATE TABLE medication.order_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  client_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'discontinued')),
  medication_definition_id uuid NOT NULL,
  medication_snapshot jsonb NOT NULL CHECK (jsonb_typeof(medication_snapshot) = 'object'),
  dose_amount numeric(12,3) NOT NULL CHECK (dose_amount > 0),
  dose_unit text NOT NULL CHECK (dose_unit IN ('mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch')),
  route text NOT NULL CHECK (route IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other')),
  instructions text CHECK (instructions IS NULL OR length(instructions) <= 4000),
  indication text CHECK (indication IS NULL OR length(indication) <= 1000),
  prescriber_name text CHECK (prescriber_name IS NULL OR length(prescriber_name) <= 200),
  source_type text NOT NULL CHECK (source_type IN ('prescriber', 'care_authorizing_source', 'staff_transcription')),
  source_reference text CHECK (source_reference IS NULL OR length(trim(source_reference)) BETWEEN 1 AND 1000),
  prescribed_at timestamptz,
  valid_from date NOT NULL,
  valid_until date CHECK (valid_until IS NULL OR valid_until >= valid_from),
  schedule jsonb NOT NULL CHECK (
    jsonb_typeof(schedule) = 'object'
    AND schedule->>'type' IN ('fixed_times', 'interval', 'as_needed')
    AND length(trim(coalesce(schedule->>'timezone', ''))) BETWEEN 1 AND 100
    AND ((schedule->>'type' <> 'fixed_times') OR (jsonb_typeof(schedule->'times') = 'array' AND jsonb_array_length(schedule->'times') BETWEEN 1 AND 24))
    AND ((schedule->>'type' <> 'interval') OR (schedule ? 'anchorAt' AND (schedule->>'intervalMinutes') ~ '^[0-9]+$' AND (schedule->>'intervalMinutes')::integer BETWEEN 30 AND 10080))
    AND ((schedule->>'type' <> 'as_needed') OR length(trim(coalesce(schedule->>'indication', ''))) BETWEEN 1 AND 1000)
  ),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_order_revisions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_order_revisions_order_version_uq UNIQUE (tenant_id, order_id, version),
  CONSTRAINT medication_order_revisions_reference_uq UNIQUE (tenant_id, id, order_id, client_id, version),
  CONSTRAINT medication_order_revisions_order_fk FOREIGN KEY (tenant_id, order_id, client_id)
    REFERENCES medication.orders (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_order_revisions_definition_fk FOREIGN KEY (tenant_id, medication_definition_id)
    REFERENCES medication.definitions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_order_revisions_active_source_ck CHECK (
    status <> 'active' OR length(trim(coalesce(source_reference, ''))) BETWEEN 1 AND 1000
  )
);
CREATE INDEX medication_order_revisions_history_idx ON medication.order_revisions (tenant_id, order_id, version DESC);

CREATE TABLE medication.administration_occurrences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_revision_id uuid NOT NULL,
  order_version integer NOT NULL CHECK (order_version > 0),
  scheduled_at timestamptz NOT NULL,
  scheduled_timezone text NOT NULL CHECK (length(trim(scheduled_timezone)) BETWEEN 1 AND 100),
  local_date date NOT NULL,
  local_time text NOT NULL CHECK (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'recorded')),
  created_at timestamptz NOT NULL,
  CONSTRAINT medication_occurrences_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_occurrences_schedule_identity_uq UNIQUE (tenant_id, order_id, order_revision_id, scheduled_at),
  CONSTRAINT medication_occurrences_record_reference_uq UNIQUE (tenant_id, id, client_id, order_id, order_revision_id, order_version),
  CONSTRAINT medication_occurrences_order_fk FOREIGN KEY (tenant_id, order_id, client_id)
    REFERENCES medication.orders (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_occurrences_revision_fk FOREIGN KEY (tenant_id, order_revision_id, order_id, client_id, order_version)
    REFERENCES medication.order_revisions (tenant_id, id, order_id, client_id, version) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_occurrences_client_scheduled_idx ON medication.administration_occurrences (tenant_id, client_id, scheduled_at);
CREATE INDEX medication_occurrences_client_local_date_idx ON medication.administration_occurrences (tenant_id, client_id, local_date, local_time);

CREATE TABLE medication.administration_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_revision_id uuid NOT NULL,
  order_version integer NOT NULL CHECK (order_version > 0),
  occurrence_id uuid,
  visit_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('administered', 'not_administered', 'refused', 'withheld')),
  ordered_dose_amount numeric(12,3) NOT NULL CHECK (ordered_dose_amount > 0),
  ordered_dose_unit text NOT NULL CHECK (ordered_dose_unit IN ('mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch')),
  route text NOT NULL CHECK (route IN ('oral', 'topical', 'subcutaneous', 'intramuscular', 'inhalation', 'transdermal', 'other')),
  actual_dose_amount numeric(12,3),
  actual_dose_unit text,
  reason_code text CHECK (reason_code IS NULL OR reason_code IN ('client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other')),
  administration_reason text CHECK (administration_reason IS NULL OR length(administration_reason) <= 1000),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  administered_by_employee_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  CONSTRAINT medication_administration_records_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_administration_outcome_ck CHECK (
    (outcome = 'administered' AND actual_dose_amount > 0 AND actual_dose_unit = ordered_dose_unit AND actual_dose_amount = ordered_dose_amount AND reason_code IS NULL)
    OR (outcome <> 'administered' AND actual_dose_amount IS NULL AND actual_dose_unit IS NULL AND reason_code IS NOT NULL)
  ),
  CONSTRAINT medication_administration_capture_time_ck CHECK (occurred_at = captured_at),
  CONSTRAINT medication_administration_order_fk FOREIGN KEY (tenant_id, order_id, client_id)
    REFERENCES medication.orders (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_administration_revision_fk FOREIGN KEY (tenant_id, order_revision_id, order_id, client_id, order_version)
    REFERENCES medication.order_revisions (tenant_id, id, order_id, client_id, version) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_administration_occurrence_fk FOREIGN KEY (tenant_id, occurrence_id, client_id, order_id, order_revision_id, order_version)
    REFERENCES medication.administration_occurrences (tenant_id, id, client_id, order_id, order_revision_id, order_version) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_administration_visit_fk FOREIGN KEY (tenant_id, visit_id)
    REFERENCES scheduling.visits (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_administration_employee_fk FOREIGN KEY (tenant_id, administered_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX medication_administration_one_record_per_occurrence_uq ON medication.administration_records (tenant_id, occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE INDEX medication_administration_client_time_idx ON medication.administration_records (tenant_id, client_id, occurred_at DESC, id);
CREATE INDEX medication_administration_order_time_idx ON medication.administration_records (tenant_id, order_id, occurred_at DESC);

CREATE TABLE medication.administration_corrections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  outcome text NOT NULL CHECK (outcome IN ('administered', 'not_administered', 'refused', 'withheld')),
  actual_dose_amount numeric(12,3),
  actual_dose_unit text,
  reason_code text CHECK (reason_code IS NULL OR reason_code IN ('client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other')),
  administration_reason text CHECK (administration_reason IS NULL OR length(administration_reason) <= 1000),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  correction_reason text NOT NULL CHECK (length(trim(correction_reason)) BETWEEN 1 AND 1000),
  corrected_by_employee_id uuid NOT NULL,
  corrected_at timestamptz NOT NULL,
  CONSTRAINT medication_administration_corrections_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT medication_administration_corrections_record_version_uq UNIQUE (tenant_id, record_id, version),
  CONSTRAINT medication_administration_corrections_record_fk FOREIGN KEY (tenant_id, record_id)
    REFERENCES medication.administration_records (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT medication_administration_corrections_employee_fk FOREIGN KEY (tenant_id, corrected_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX medication_administration_corrections_history_idx ON medication.administration_corrections (tenant_id, record_id, version DESC);

CREATE FUNCTION medication.guard_order_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.client_id, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.client_id, OLD.created_by_user_id, OLD.created_at)
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Medication order changes require one new immutable version'
      USING ERRCODE = '23514', CONSTRAINT = 'medication_order_version_transition_ck';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER medication_order_version_transition
  BEFORE UPDATE ON medication.orders FOR EACH ROW EXECUTE FUNCTION medication.guard_order_version();

CREATE FUNCTION medication.reject_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finalized medication history is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'medication_history_immutable_ck';
END $$;
CREATE TRIGGER medication_order_revision_immutable
  BEFORE UPDATE OR DELETE ON medication.order_revisions FOR EACH ROW EXECUTE FUNCTION medication.reject_history_mutation();
CREATE TRIGGER medication_administration_record_immutable
  BEFORE UPDATE OR DELETE ON medication.administration_records FOR EACH ROW EXECUTE FUNCTION medication.reject_history_mutation();
CREATE TRIGGER medication_administration_correction_immutable
  BEFORE UPDATE OR DELETE ON medication.administration_corrections FOR EACH ROW EXECUTE FUNCTION medication.reject_history_mutation();

CREATE FUNCTION medication.guard_occurrence_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (NEW.tenant_id, NEW.id, NEW.client_id, NEW.order_id, NEW.order_revision_id,
      NEW.order_version, NEW.scheduled_at, NEW.scheduled_timezone, NEW.local_date, NEW.local_time, NEW.created_at)
      IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.client_id, OLD.order_id, OLD.order_revision_id,
      OLD.order_version, OLD.scheduled_at, OLD.scheduled_timezone, OLD.local_date, OLD.local_time, OLD.created_at)
      OR NOT ((OLD.status = 'pending' AND NEW.status IN ('cancelled', 'recorded')) OR (OLD.status = NEW.status)) THEN
    RAISE EXCEPTION 'Scheduled medication facts are immutable; pending occurrences may only be cancelled'
      USING ERRCODE = '23514', CONSTRAINT = 'medication_occurrence_immutable_ck';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER medication_occurrence_immutable
  BEFORE UPDATE OR DELETE ON medication.administration_occurrences FOR EACH ROW EXECUTE FUNCTION medication.guard_occurrence_change();

CREATE FUNCTION medication.guard_correction_values()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ordered_amount numeric(12,3); ordered_unit text;
BEGIN
  SELECT ordered_dose_amount, ordered_dose_unit INTO ordered_amount, ordered_unit
  FROM medication.administration_records WHERE tenant_id = NEW.tenant_id AND id = NEW.record_id;
  IF (NEW.outcome = 'administered' AND (NEW.actual_dose_amount IS DISTINCT FROM ordered_amount OR NEW.actual_dose_unit IS DISTINCT FROM ordered_unit OR NEW.reason_code IS NOT NULL))
     OR (NEW.outcome <> 'administered' AND (NEW.actual_dose_amount IS NOT NULL OR NEW.actual_dose_unit IS NOT NULL OR NEW.reason_code IS NULL)) THEN
    RAISE EXCEPTION 'Corrected administration facts must remain structurally valid'
      USING ERRCODE = '23514', CONSTRAINT = 'medication_administration_correction_values_ck';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER medication_administration_correction_values
  BEFORE INSERT ON medication.administration_corrections FOR EACH ROW EXECUTE FUNCTION medication.guard_correction_values();

ALTER TABLE medication.definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.order_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.order_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.administration_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.administration_occurrences FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.administration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.administration_records FORCE ROW LEVEL SECURITY;
ALTER TABLE medication.administration_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication.administration_corrections FORCE ROW LEVEL SECURITY;

CREATE POLICY medication_definitions_tenant_isolation ON medication.definitions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY medication_orders_tenant_isolation ON medication.orders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY medication_order_revisions_tenant_isolation ON medication.order_revisions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY medication_occurrences_tenant_isolation ON medication.administration_occurrences
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY medication_administration_records_tenant_isolation ON medication.administration_records
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY medication_administration_corrections_tenant_isolation ON medication.administration_corrections
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA medication TO care_app;
GRANT SELECT, INSERT, UPDATE ON medication.definitions, medication.orders TO care_app;
GRANT SELECT, INSERT ON medication.order_revisions, medication.administration_records,
  medication.administration_corrections TO care_app;
GRANT SELECT, INSERT, UPDATE ON medication.administration_occurrences TO care_app;
