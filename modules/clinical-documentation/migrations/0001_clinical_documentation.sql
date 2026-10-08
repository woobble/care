CREATE SCHEMA IF NOT EXISTS clinical_documentation;

CREATE TABLE clinical_documentation.records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  documentation_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('measurement', 'observation', 'assessment', 'risk_assessment')),
  recorded_by_user_id uuid NOT NULL,
  recorded_by_employee_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  corrects_record_id uuid,
  correction_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT clinical_records_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT clinical_records_tenant_id_document_execution_kind_uq
    UNIQUE (tenant_id, id, documentation_id, execution_id, kind),
  CONSTRAINT clinical_records_document_execution_fk
    FOREIGN KEY (tenant_id, documentation_id, execution_id)
    REFERENCES care_documentation.documents (tenant_id, id, execution_id) ON DELETE RESTRICT,
  CONSTRAINT clinical_records_recorder_user_fk
    FOREIGN KEY (tenant_id, recorded_by_user_id)
    REFERENCES identity.tenant_memberships (tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT clinical_records_recorder_employee_fk
    FOREIGN KEY (tenant_id, recorded_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_records_corrects_fk
    FOREIGN KEY (tenant_id, corrects_record_id, documentation_id, execution_id, kind)
    REFERENCES clinical_documentation.records
      (tenant_id, id, documentation_id, execution_id, kind) ON DELETE RESTRICT,
  CONSTRAINT clinical_records_correction_ck CHECK (
    (corrects_record_id IS NULL AND correction_reason IS NULL)
    OR (corrects_record_id IS NOT NULL AND corrects_record_id <> id
      AND length(trim(coalesce(correction_reason, ''))) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT clinical_records_employee_attribution_ck CHECK (
    recorded_by_employee_id IS NOT NULL OR corrects_record_id IS NOT NULL
  )
);

CREATE INDEX clinical_records_document_created_idx
  ON clinical_documentation.records (tenant_id, documentation_id, created_at, id);
CREATE INDEX clinical_records_execution_created_idx
  ON clinical_documentation.records (tenant_id, execution_id, created_at);
CREATE UNIQUE INDEX clinical_records_corrects_record_uq
  ON clinical_documentation.records (tenant_id, corrects_record_id)
  WHERE corrects_record_id IS NOT NULL;

CREATE TABLE clinical_documentation.measurements (
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL,
  measurement_type text NOT NULL,
  value numeric(10, 3),
  integer_value integer,
  systolic integer,
  diastolic integer,
  unit text NOT NULL,
  measured_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'device')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT clinical_measurements_pk PRIMARY KEY (tenant_id, record_id),
  CONSTRAINT clinical_measurements_record_fk
    FOREIGN KEY (tenant_id, record_id)
    REFERENCES clinical_documentation.records (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_measurements_value_ck CHECK (
    (measurement_type = 'blood_pressure' AND value IS NULL AND integer_value IS NULL
      AND systolic > 0 AND diastolic > 0 AND unit = 'mmHg')
    OR (measurement_type = 'pulse' AND value IS NULL AND integer_value > 0
      AND systolic IS NULL AND diastolic IS NULL AND unit = 'bpm')
    OR (measurement_type = 'respiratory_rate' AND value IS NULL AND integer_value > 0
      AND systolic IS NULL AND diastolic IS NULL AND unit = '/min')
    OR (measurement_type = 'temperature' AND value IS NOT NULL AND integer_value IS NULL
      AND systolic IS NULL AND diastolic IS NULL AND unit = 'Cel')
    OR (measurement_type = 'weight' AND value > 0 AND integer_value IS NULL
      AND systolic IS NULL AND diastolic IS NULL AND unit = 'kg')
    OR (measurement_type = 'blood_glucose' AND value > 0 AND integer_value IS NULL
      AND systolic IS NULL AND diastolic IS NULL AND unit IN ('mg/dL', 'mmol/L'))
    OR (measurement_type = 'oxygen_saturation' AND value BETWEEN 0 AND 100 AND integer_value IS NULL
      AND systolic IS NULL AND diastolic IS NULL AND unit = '%')
  ),
  CONSTRAINT clinical_measurements_finite_value_ck CHECK (
    value IS NULL OR value::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);

CREATE INDEX clinical_measurements_type_time_idx
  ON clinical_documentation.measurements (tenant_id, measurement_type, measured_at, record_id);

CREATE TABLE clinical_documentation.observations (
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL,
  category text NOT NULL,
  value_code text,
  pain_score integer,
  location text,
  severity text,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  observed_at timestamptz NOT NULL,
  CONSTRAINT clinical_observations_pk PRIMARY KEY (tenant_id, record_id),
  CONSTRAINT clinical_observations_record_fk
    FOREIGN KEY (tenant_id, record_id)
    REFERENCES clinical_documentation.records (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_observations_values_ck CHECK (
    (category = 'mobility' AND value_code IN ('independent', 'assistance_required', 'bedbound')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'orientation' AND value_code IN ('oriented', 'disoriented')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'pain' AND value_code IS NULL AND pain_score BETWEEN 0 AND 10)
    OR (category = 'skin' AND value_code IN ('intact', 'redness', 'altered')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'nutrition' AND value_code IN ('adequate', 'reduced', 'declined')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'hydration' AND value_code IN ('adequate', 'reduced', 'declined')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'elimination' AND value_code IN ('unchanged', 'changed', 'incontinence')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'sleep' AND value_code IN ('restful', 'disturbed')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'mood' AND value_code IN ('calm', 'anxious', 'low', 'agitated')
      AND pain_score IS NULL AND location IS NULL)
    OR (category = 'general_condition' AND value_code IN ('stable', 'changed', 'declined')
      AND pain_score IS NULL AND location IS NULL)
  ),
  CONSTRAINT clinical_observations_severity_ck CHECK (
    severity IS NULL OR severity IN ('mild', 'moderate', 'severe')
  ),
  CONSTRAINT clinical_observations_codes_length_ck CHECK (
    length(trim(coalesce(value_code, ''))) <= 128
    AND length(trim(coalesce(location, ''))) <= 200
  )
);

CREATE INDEX clinical_observations_category_time_idx
  ON clinical_documentation.observations (tenant_id, category, observed_at, record_id);

CREATE TABLE clinical_documentation.assessments (
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL,
  assessment_type text NOT NULL,
  result_code text,
  score numeric(10, 3),
  assessed_at timestamptz NOT NULL,
  valid_until timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT clinical_assessments_pk PRIMARY KEY (tenant_id, record_id),
  CONSTRAINT clinical_assessments_record_fk
    FOREIGN KEY (tenant_id, record_id)
    REFERENCES clinical_documentation.records (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_assessments_code_ck CHECK (
    (assessment_type = 'general_condition'
      AND (result_code IN ('stable', 'changed', 'declined') OR (result_code IS NULL AND score IS NOT NULL)))
    OR (assessment_type = 'pain' AND result_code IS NULL AND score BETWEEN 0 AND 10 AND score = trunc(score))
  ),
  CONSTRAINT clinical_assessments_validity_ck CHECK (valid_until IS NULL OR valid_until >= assessed_at),
  CONSTRAINT clinical_assessments_finite_score_ck CHECK (
    score IS NULL OR score::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);

CREATE INDEX clinical_assessments_type_time_idx
  ON clinical_documentation.assessments (tenant_id, assessment_type, assessed_at, record_id);

CREATE TABLE clinical_documentation.risk_assessments (
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL,
  risk_type text NOT NULL CHECK (risk_type IN ('fall', 'pressure_ulcer', 'dehydration', 'malnutrition')),
  level text NOT NULL CHECK (level IN ('none', 'low', 'moderate', 'high')),
  assessed_at timestamptz NOT NULL,
  valid_until timestamptz,
  source text NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT clinical_risk_assessments_pk PRIMARY KEY (tenant_id, record_id),
  CONSTRAINT clinical_risk_assessments_record_fk
    FOREIGN KEY (tenant_id, record_id)
    REFERENCES clinical_documentation.records (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT clinical_risk_assessments_validity_ck CHECK (valid_until IS NULL OR valid_until >= assessed_at),
  CONSTRAINT clinical_risk_assessments_source_ck CHECK (length(trim(source)) BETWEEN 1 AND 128)
);

CREATE INDEX clinical_risk_assessments_type_time_idx
  ON clinical_documentation.risk_assessments (tenant_id, risk_type, assessed_at, record_id);

CREATE FUNCTION clinical_documentation.guard_record_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_tenant uuid;
  target_document uuid;
  parent_status text;
  original_corrects_record_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_document := OLD.documentation_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_document := NEW.documentation_id;
  END IF;

  SELECT status INTO parent_status
  FROM care_documentation.documents
  WHERE tenant_id = target_tenant AND id = target_document
  FOR UPDATE;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'clinical record parent documentation is missing' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF parent_status = 'draft' THEN
      IF NEW.corrects_record_id IS NOT NULL OR NEW.correction_reason IS NOT NULL THEN
        RAISE EXCEPTION 'corrections require finalized documentation' USING ERRCODE = '23514';
      END IF;
    ELSIF parent_status = 'finalized' THEN
      IF NEW.corrects_record_id IS NULL OR length(trim(coalesce(NEW.correction_reason, ''))) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'finalized clinical records can only be amended by a reasoned correction' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'clinical records cannot be written to this documentation state' USING ERRCODE = '23514';
    END IF;
    IF NEW.corrects_record_id IS NOT NULL THEN
      SELECT corrects_record_id INTO original_corrects_record_id
      FROM clinical_documentation.records
      WHERE tenant_id = NEW.tenant_id AND id = NEW.corrects_record_id
      FOR UPDATE;
      IF original_corrects_record_id IS NOT NULL THEN
        RAISE EXCEPTION 'a clinical correction cannot correct another correction' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF parent_status <> 'draft' OR OLD.corrects_record_id IS NOT NULL THEN
      RAISE EXCEPTION 'finalized clinical records and corrections are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.documentation_id IS DISTINCT FROM OLD.documentation_id
      OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id
      OR NEW.recorded_by_employee_id IS DISTINCT FROM OLD.recorded_by_employee_id
      OR NEW.corrects_record_id IS DISTINCT FROM OLD.corrects_record_id
      OR NEW.correction_reason IS DISTINCT FROM OLD.correction_reason
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.version <> OLD.version + 1
      OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'clinical record identity and attribution are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF parent_status <> 'draft' OR OLD.corrects_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'finalized clinical records and corrections are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER clinical_records_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON clinical_documentation.records
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.guard_record_write();

CREATE FUNCTION clinical_documentation.guard_typed_record_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_tenant uuid;
  target_record uuid;
  target_document uuid;
  record_kind text;
  record_corrects uuid;
  parent_status text;
  expected_kind text;
BEGIN
  expected_kind := CASE TG_TABLE_NAME
    WHEN 'measurements' THEN 'measurement'
    WHEN 'observations' THEN 'observation'
    WHEN 'assessments' THEN 'assessment'
    WHEN 'risk_assessments' THEN 'risk_assessment'
    ELSE NULL
  END;

  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_record := OLD.record_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_record := NEW.record_id;
  END IF;

  SELECT documentation_id, kind, corrects_record_id
    INTO target_document, record_kind, record_corrects
  FROM clinical_documentation.records
  WHERE tenant_id = target_tenant AND id = target_record
  FOR UPDATE;
  IF record_kind IS DISTINCT FROM expected_kind THEN
    RAISE EXCEPTION 'clinical record kind does not match its typed table' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO parent_status
  FROM care_documentation.documents
  WHERE tenant_id = target_tenant AND id = target_document
  FOR UPDATE;

  IF TG_OP = 'INSERT' THEN
    IF parent_status = 'draft' AND record_corrects IS NULL THEN RETURN NEW; END IF;
    IF parent_status = 'finalized' AND record_corrects IS NOT NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'typed clinical records are immutable after finalization' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND parent_status = 'draft'
    AND record_corrects IS NULL
    AND NEW.tenant_id = OLD.tenant_id
    AND NEW.record_id = OLD.record_id THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND parent_status = 'draft' AND record_corrects IS NULL THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'finalized clinical records and corrections are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER clinical_measurements_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON clinical_documentation.measurements
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.guard_typed_record_write();
CREATE TRIGGER clinical_observations_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON clinical_documentation.observations
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.guard_typed_record_write();
CREATE TRIGGER clinical_assessments_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON clinical_documentation.assessments
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.guard_typed_record_write();
CREATE TRIGGER clinical_risk_assessments_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON clinical_documentation.risk_assessments
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.guard_typed_record_write();

CREATE FUNCTION clinical_documentation.require_typed_payload() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_kind text;
  payload_exists boolean;
BEGIN
  SELECT kind INTO target_kind
  FROM clinical_documentation.records
  WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
  IF target_kind IS NULL THEN RETURN NEW; END IF;

  CASE target_kind
    WHEN 'measurement' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.measurements WHERE tenant_id = NEW.tenant_id AND record_id = NEW.id)
        INTO payload_exists;
    WHEN 'observation' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.observations WHERE tenant_id = NEW.tenant_id AND record_id = NEW.id)
        INTO payload_exists;
    WHEN 'assessment' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.assessments WHERE tenant_id = NEW.tenant_id AND record_id = NEW.id)
        INTO payload_exists;
    WHEN 'risk_assessment' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.risk_assessments WHERE tenant_id = NEW.tenant_id AND record_id = NEW.id)
        INTO payload_exists;
  END CASE;

  IF NOT payload_exists THEN
    RAISE EXCEPTION 'clinical record requires a matching typed payload' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER clinical_records_typed_payload_required
  AFTER INSERT OR UPDATE ON clinical_documentation.records
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.require_typed_payload();

CREATE FUNCTION clinical_documentation.require_typed_payload_after_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_kind text;
  payload_exists boolean;
BEGIN
  SELECT kind INTO target_kind
  FROM clinical_documentation.records
  WHERE tenant_id = OLD.tenant_id AND id = OLD.record_id;
  IF target_kind IS NULL THEN RETURN OLD; END IF;

  CASE target_kind
    WHEN 'measurement' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.measurements WHERE tenant_id = OLD.tenant_id AND record_id = OLD.record_id)
        INTO payload_exists;
    WHEN 'observation' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.observations WHERE tenant_id = OLD.tenant_id AND record_id = OLD.record_id)
        INTO payload_exists;
    WHEN 'assessment' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.assessments WHERE tenant_id = OLD.tenant_id AND record_id = OLD.record_id)
        INTO payload_exists;
    WHEN 'risk_assessment' THEN
      SELECT EXISTS (SELECT 1 FROM clinical_documentation.risk_assessments WHERE tenant_id = OLD.tenant_id AND record_id = OLD.record_id)
        INTO payload_exists;
  END CASE;

  IF NOT payload_exists THEN
    RAISE EXCEPTION 'clinical record requires a matching typed payload' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER clinical_measurements_typed_payload_required
  AFTER DELETE ON clinical_documentation.measurements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.require_typed_payload_after_delete();
CREATE CONSTRAINT TRIGGER clinical_observations_typed_payload_required
  AFTER DELETE ON clinical_documentation.observations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.require_typed_payload_after_delete();
CREATE CONSTRAINT TRIGGER clinical_assessments_typed_payload_required
  AFTER DELETE ON clinical_documentation.assessments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.require_typed_payload_after_delete();
CREATE CONSTRAINT TRIGGER clinical_risk_assessments_typed_payload_required
  AFTER DELETE ON clinical_documentation.risk_assessments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.require_typed_payload_after_delete();

ALTER TABLE clinical_documentation.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documentation.records FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_records_tenant_isolation ON clinical_documentation.records
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clinical_documentation.measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documentation.measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_measurements_tenant_isolation ON clinical_documentation.measurements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clinical_documentation.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documentation.observations FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_observations_tenant_isolation ON clinical_documentation.observations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clinical_documentation.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documentation.assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_assessments_tenant_isolation ON clinical_documentation.assessments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clinical_documentation.risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documentation.risk_assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_risk_assessments_tenant_isolation ON clinical_documentation.risk_assessments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA clinical_documentation TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  clinical_documentation.records,
  clinical_documentation.measurements,
  clinical_documentation.observations,
  clinical_documentation.assessments,
  clinical_documentation.risk_assessments TO care_app;
