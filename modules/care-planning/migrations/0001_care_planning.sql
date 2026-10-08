CREATE SCHEMA IF NOT EXISTS care_planning;

CREATE TABLE care_planning.plans (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'under_review', 'ended')),
  valid_from date NOT NULL,
  valid_until date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_employee_id uuid NOT NULL,
  ended_by_employee_id uuid,
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT care_plans_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT care_plans_tenant_id_client_uq UNIQUE (tenant_id, id, client_id),
  CONSTRAINT care_plans_client_provider_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id, client_id)
    REFERENCES clients.clients (tenant_id, organization_id, primary_facility_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plans_facility_provider_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plans_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plans_creator_employee_fk
    FOREIGN KEY (tenant_id, created_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plans_ended_by_employee_fk
    FOREIGN KEY (tenant_id, ended_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plans_validity_ck CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT care_plans_ended_ck CHECK (
    (status = 'ended' AND ended_at IS NOT NULL AND ended_by_employee_id IS NOT NULL
      AND length(trim(coalesce(ended_reason, ''))) BETWEEN 1 AND 1000)
    OR (status <> 'ended' AND ended_at IS NULL AND ended_by_employee_id IS NULL AND ended_reason IS NULL)
  )
);
CREATE UNIQUE INDEX care_plans_one_current_per_client_uq
  ON care_planning.plans (tenant_id, client_id, organization_id, facility_id)
  WHERE status IN ('active', 'under_review');
CREATE INDEX care_plans_client_created_idx
  ON care_planning.plans (tenant_id, client_id, created_at DESC, id);
CREATE INDEX care_plans_facility_status_idx
  ON care_planning.plans (tenant_id, facility_id, status, created_at DESC);

CREATE TABLE care_planning.revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  client_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'historical')),
  author_employee_id uuid NOT NULL,
  reason text,
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL,
  activated_by_employee_id uuid,
  activated_at timestamptz,
  superseded_at timestamptz,
  CONSTRAINT care_plan_revisions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT care_plan_revisions_tenant_id_client_uq UNIQUE (tenant_id, id, client_id),
  CONSTRAINT care_plan_revisions_plan_number_uq UNIQUE (tenant_id, plan_id, revision_number),
  CONSTRAINT care_plan_revisions_tenant_plan_client_uq UNIQUE (tenant_id, id, plan_id, client_id),
  CONSTRAINT care_plan_revisions_plan_fk
    FOREIGN KEY (tenant_id, plan_id, client_id)
    REFERENCES care_planning.plans (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_revisions_author_fk
    FOREIGN KEY (tenant_id, author_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_revisions_activated_by_fk
    FOREIGN KEY (tenant_id, activated_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_revisions_reason_ck CHECK (
    reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 1000
  ),
  CONSTRAINT care_plan_revisions_lifecycle_ck CHECK (
    (status = 'draft' AND activated_at IS NULL AND activated_by_employee_id IS NULL AND superseded_at IS NULL)
    OR (status = 'active' AND activated_at IS NOT NULL AND activated_by_employee_id IS NOT NULL AND superseded_at IS NULL)
    OR (status = 'historical' AND activated_at IS NOT NULL AND activated_by_employee_id IS NOT NULL AND superseded_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX care_plan_one_draft_revision_uq
  ON care_planning.revisions (tenant_id, plan_id) WHERE status = 'draft';
CREATE UNIQUE INDEX care_plan_one_active_revision_uq
  ON care_planning.revisions (tenant_id, plan_id) WHERE status = 'active';
CREATE INDEX care_plan_revisions_history_idx
  ON care_planning.revisions (tenant_id, plan_id, revision_number DESC);

CREATE TABLE care_planning.assessments (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  client_concerns text,
  client_wishes text,
  client_goals text,
  client_habits text,
  client_preferences text,
  client_priorities text,
  professional_observed_needs text,
  professional_resources text,
  professional_limitations text,
  professional_risks text,
  professional_rationale text,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id),
  CONSTRAINT care_plan_assessments_revision_fk
    FOREIGN KEY (tenant_id, revision_id)
    REFERENCES care_planning.revisions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_assessments_text_length_ck CHECK (
    coalesce(length(client_concerns), 0) <= 4000 AND coalesce(length(client_wishes), 0) <= 4000
    AND coalesce(length(client_goals), 0) <= 4000 AND coalesce(length(client_habits), 0) <= 4000
    AND coalesce(length(client_preferences), 0) <= 4000 AND coalesce(length(client_priorities), 0) <= 4000
    AND coalesce(length(professional_observed_needs), 0) <= 4000
    AND coalesce(length(professional_resources), 0) <= 4000
    AND coalesce(length(professional_limitations), 0) <= 4000
    AND coalesce(length(professional_risks), 0) <= 4000
    AND coalesce(length(professional_rationale), 0) <= 4000
  )
);

CREATE TABLE care_planning.needs (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('personal_care', 'mobility', 'nutrition', 'hydration', 'communication', 'cognition', 'daily_living', 'social_participation', 'safety', 'other')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  source text NOT NULL CHECK (source IN ('client_report', 'professional_observation', 'representative_report', 'clinical_record')),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  status text NOT NULL CHECK (status IN ('active', 'addressed', 'deferred')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, id),
  CONSTRAINT care_plan_needs_revision_fk
    FOREIGN KEY (tenant_id, revision_id)
    REFERENCES care_planning.revisions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX care_plan_needs_revision_idx ON care_planning.needs (tenant_id, revision_id, status);

CREATE TABLE care_planning.resources (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('self_care', 'mobility', 'communication', 'cognition', 'daily_routine', 'social_support', 'personal_interest', 'other')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK (status IN ('available', 'needs_support', 'unavailable')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, id),
  CONSTRAINT care_plan_resources_revision_fk
    FOREIGN KEY (tenant_id, revision_id)
    REFERENCES care_planning.revisions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX care_plan_resources_revision_idx ON care_planning.resources (tenant_id, revision_id, status);

CREATE TABLE care_planning.risk_responses (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  client_id uuid NOT NULL,
  id uuid NOT NULL,
  clinical_record_id uuid NOT NULL,
  record_kind text NOT NULL DEFAULT 'risk_assessment' CHECK (record_kind = 'risk_assessment'),
  status text NOT NULL CHECK (status IN ('addressed', 'monitor', 'accepted')),
  planned_response text NOT NULL CHECK (length(trim(planned_response)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, id),
  CONSTRAINT care_plan_risk_responses_source_uq UNIQUE (tenant_id, revision_id, clinical_record_id),
  CONSTRAINT care_plan_risk_responses_revision_client_fk
    FOREIGN KEY (tenant_id, revision_id, client_id)
    REFERENCES care_planning.revisions (tenant_id, id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_risk_responses_clinical_record_fk
    FOREIGN KEY (tenant_id, client_id, clinical_record_id, record_kind)
    REFERENCES clinical_documentation.records (tenant_id, client_id, id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE care_planning.source_references (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  client_id uuid NOT NULL,
  clinical_record_id uuid NOT NULL,
  record_kind text NOT NULL CHECK (record_kind IN ('measurement', 'observation', 'assessment', 'risk_assessment')),
  rationale text CHECK (rationale IS NULL OR length(rationale) <= 1000),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, clinical_record_id),
  CONSTRAINT care_plan_source_refs_revision_client_fk
    FOREIGN KEY (tenant_id, revision_id, plan_id, client_id)
    REFERENCES care_planning.revisions (tenant_id, id, plan_id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_source_refs_clinical_record_fk
    FOREIGN KEY (tenant_id, client_id, clinical_record_id, record_kind)
    REFERENCES clinical_documentation.records (tenant_id, client_id, id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX care_plan_source_refs_record_idx
  ON care_planning.source_references (tenant_id, client_id, clinical_record_id);

CREATE TABLE care_planning.goals (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  target_date date,
  status text NOT NULL CHECK (status IN ('active', 'achieved', 'discontinued')),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, id),
  CONSTRAINT care_plan_goals_revision_fk
    FOREIGN KEY (tenant_id, revision_id)
    REFERENCES care_planning.revisions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX care_plan_goals_revision_idx ON care_planning.goals (tenant_id, revision_id, status);

CREATE TABLE care_planning.goal_needs (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  need_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, goal_id, need_id),
  CONSTRAINT care_plan_goal_needs_goal_fk
    FOREIGN KEY (tenant_id, revision_id, goal_id)
    REFERENCES care_planning.goals (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_goal_needs_need_fk
    FOREIGN KEY (tenant_id, revision_id, need_id)
    REFERENCES care_planning.needs (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE care_planning.measures (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instruction text NOT NULL CHECK (length(trim(instruction)) BETWEEN 1 AND 4000),
  category text NOT NULL CHECK (category IN ('personal_care', 'assistance', 'encouragement', 'monitoring', 'positioning', 'communication', 'other')),
  service_definition_id uuid,
  frequency_text text CHECK (frequency_text IS NULL OR length(frequency_text) <= 500),
  responsible_role text CHECK (responsible_role IS NULL OR length(responsible_role) <= 100),
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL CHECK (status IN ('active', 'discontinued')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, id),
  CONSTRAINT care_plan_measures_revision_fk
    FOREIGN KEY (tenant_id, revision_id)
    REFERENCES care_planning.revisions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_measures_service_fk
    FOREIGN KEY (tenant_id, service_definition_id)
    REFERENCES services.service_definitions (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_measures_validity_ck CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX care_plan_measures_revision_idx ON care_planning.measures (tenant_id, revision_id, status);

CREATE TABLE care_planning.risk_response_needs (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  risk_response_id uuid NOT NULL,
  need_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, risk_response_id, need_id),
  CONSTRAINT care_plan_risk_response_needs_response_fk
    FOREIGN KEY (tenant_id, revision_id, risk_response_id)
    REFERENCES care_planning.risk_responses (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_risk_response_needs_need_fk
    FOREIGN KEY (tenant_id, revision_id, need_id)
    REFERENCES care_planning.needs (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE care_planning.risk_response_measures (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  risk_response_id uuid NOT NULL,
  measure_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, risk_response_id, measure_id),
  CONSTRAINT care_plan_risk_response_measures_response_fk
    FOREIGN KEY (tenant_id, revision_id, risk_response_id)
    REFERENCES care_planning.risk_responses (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_risk_response_measures_measure_fk
    FOREIGN KEY (tenant_id, revision_id, measure_id)
    REFERENCES care_planning.measures (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE care_planning.measure_needs (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  measure_id uuid NOT NULL,
  need_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, measure_id, need_id),
  CONSTRAINT care_plan_measure_needs_measure_fk
    FOREIGN KEY (tenant_id, revision_id, measure_id)
    REFERENCES care_planning.measures (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_measure_needs_need_fk
    FOREIGN KEY (tenant_id, revision_id, need_id)
    REFERENCES care_planning.needs (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE care_planning.measure_goals (
  tenant_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  measure_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, revision_id, measure_id, goal_id),
  CONSTRAINT care_plan_measure_goals_measure_fk
    FOREIGN KEY (tenant_id, revision_id, measure_id)
    REFERENCES care_planning.measures (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_measure_goals_goal_fk
    FOREIGN KEY (tenant_id, revision_id, goal_id)
    REFERENCES care_planning.goals (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE care_planning.evaluations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  client_id uuid NOT NULL,
  evaluated_by_employee_id uuid NOT NULL,
  evaluated_at timestamptz NOT NULL,
  result text NOT NULL CHECK (result IN ('effective', 'partially_effective', 'not_effective', 'changed_condition', 'no_change')),
  plan_change text NOT NULL CHECK (plan_change IN ('none', 'revision_required')),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 4000),
  next_evaluation_due date,
  CONSTRAINT care_plan_evaluations_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT care_plan_evaluations_id_revision_uq UNIQUE (tenant_id, id, revision_id),
  CONSTRAINT care_plan_evaluations_revision_client_fk
    FOREIGN KEY (tenant_id, revision_id, plan_id, client_id)
    REFERENCES care_planning.revisions (tenant_id, id, plan_id, client_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_evaluations_evaluator_fk
    FOREIGN KEY (tenant_id, evaluated_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX care_plan_evaluations_latest_idx
  ON care_planning.evaluations (tenant_id, plan_id, evaluated_at DESC, id DESC);

CREATE TABLE care_planning.evaluation_goals (
  tenant_id uuid NOT NULL,
  evaluation_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('achieved', 'partially_achieved', 'not_achieved', 'not_applicable')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  PRIMARY KEY (tenant_id, evaluation_id, goal_id),
  CONSTRAINT care_plan_evaluation_goals_evaluation_fk
    FOREIGN KEY (tenant_id, evaluation_id, revision_id)
    REFERENCES care_planning.evaluations (tenant_id, id, revision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT care_plan_evaluation_goals_goal_fk
    FOREIGN KEY (tenant_id, revision_id, goal_id)
    REFERENCES care_planning.goals (tenant_id, revision_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION care_planning.guard_plan_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'care plans cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.created_by_employee_id IS DISTINCT FROM OLD.created_by_employee_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'care plan identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'care plan version must advance exactly once' USING ERRCODE = '40001';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'active')
    OR (OLD.status = 'active' AND NEW.status IN ('under_review', 'ended'))
    OR (OLD.status = 'under_review' AND NEW.status IN ('active', 'ended'))
  ) THEN
    RAISE EXCEPTION 'invalid care plan transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'ended' THEN
    RAISE EXCEPTION 'ended care plans are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER care_plans_lifecycle_guard
  BEFORE UPDATE OR DELETE ON care_planning.plans
  FOR EACH ROW EXECUTE FUNCTION care_planning.guard_plan_lifecycle();

CREATE FUNCTION care_planning.guard_revision_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'care plan revisions cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'active' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'activated_at', 'activated_by_employee_id']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'activated_at', 'activated_by_employee_id']::text[])
       OR NEW.activated_at IS NULL OR NEW.activated_by_employee_id IS NULL THEN
      RAISE EXCEPTION 'revision content is immutable during activation' USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'active' AND NEW.status = 'historical' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'superseded_at']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'superseded_at']::text[])
       OR NEW.superseded_at IS NULL THEN
      RAISE EXCEPTION 'historical revision content is immutable' USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'care plan revision lifecycle is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER care_plan_revisions_lifecycle_guard
  BEFORE UPDATE OR DELETE ON care_planning.revisions
  FOR EACH ROW EXECUTE FUNCTION care_planning.guard_revision_lifecycle();

CREATE FUNCTION care_planning.guard_draft_revision_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_tenant uuid;
  target_revision uuid;
  revision_status text;
  plan_status text;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    target_tenant := OLD.tenant_id;
    target_revision := OLD.revision_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_revision := NEW.revision_id;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.revision_id IS DISTINCT FROM OLD.revision_id) THEN
    RAISE EXCEPTION 'revision child identity is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT revisions.status, plans.status
    INTO revision_status, plan_status
    FROM care_planning.revisions AS revisions
    JOIN care_planning.plans AS plans
      ON plans.tenant_id = revisions.tenant_id AND plans.id = revisions.plan_id
    WHERE revisions.tenant_id = target_tenant AND revisions.id = target_revision;
  IF revision_status IS DISTINCT FROM 'draft' OR plan_status = 'ended' THEN
    RAISE EXCEPTION 'active and historical care plan revisions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER care_plan_assessments_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.assessments FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_needs_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.needs FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_resources_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.resources FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_risk_responses_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.risk_responses FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_source_refs_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.source_references FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_goals_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.goals FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_goal_needs_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.goal_needs FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_measures_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.measures FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_risk_response_needs_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.risk_response_needs FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_risk_response_measures_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.risk_response_measures FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_measure_needs_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.measure_needs FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();
CREATE TRIGGER care_plan_measure_goals_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON care_planning.measure_goals FOR EACH ROW EXECUTE FUNCTION care_planning.guard_draft_revision_child();

CREATE FUNCTION care_planning.guard_evaluation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'care plan evaluations are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER care_plan_evaluations_immutable_guard
  BEFORE UPDATE OR DELETE ON care_planning.evaluations
  FOR EACH ROW EXECUTE FUNCTION care_planning.guard_evaluation_immutable();
CREATE TRIGGER care_plan_evaluation_goals_immutable_guard
  BEFORE UPDATE OR DELETE ON care_planning.evaluation_goals
  FOR EACH ROW EXECUTE FUNCTION care_planning.guard_evaluation_immutable();

DO $$
DECLARE
  table_name text;
  care_plan_tables text[] := ARRAY[
    'plans', 'revisions', 'assessments', 'needs', 'resources', 'risk_responses',
    'source_references', 'goals', 'goal_needs', 'measures', 'risk_response_needs',
    'risk_response_measures', 'measure_needs', 'measure_goals', 'evaluations',
    'evaluation_goals'
  ];
BEGIN
  FOREACH table_name IN ARRAY care_plan_tables LOOP
    EXECUTE format('ALTER TABLE care_planning.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE care_planning.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON care_planning.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END;
$$;

GRANT USAGE ON SCHEMA care_planning TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  care_planning.plans,
  care_planning.revisions,
  care_planning.assessments,
  care_planning.needs,
  care_planning.resources,
  care_planning.risk_responses,
  care_planning.source_references,
  care_planning.goals,
  care_planning.goal_needs,
  care_planning.measures,
  care_planning.risk_response_needs,
  care_planning.risk_response_measures,
  care_planning.measure_needs,
  care_planning.measure_goals,
  care_planning.evaluations,
  care_planning.evaluation_goals TO care_app;
