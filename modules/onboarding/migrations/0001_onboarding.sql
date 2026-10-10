CREATE SCHEMA IF NOT EXISTS onboarding;

CREATE TABLE onboarding.checklist_templates (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  current_version integer NOT NULL CHECK (current_version > 0),
  updated_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, organization_id, facility_id, name),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id, facility_id) REFERENCES organizations.facilities(tenant_id, organization_id, id)
);

CREATE TABLE onboarding.cases (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  client_id uuid,
  owner_employee_id uuid,
  checklist_template_id uuid,
  checklist_template_version integer,
  first_visit_id uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  contact_method text NOT NULL CHECK (contact_method IN ('phone', 'email', 'in_person', 'letter', 'other')),
  requester_name text,
  requester_relationship text,
  contact_email text,
  contact_phone text,
  requested_services text[] NOT NULL DEFAULT '{}',
  preferred_start_date date,
  service_location text,
  inquiry_source text NOT NULL,
  funding_plan text NOT NULL DEFAULT 'unknown' CHECK (funding_plan IN ('unknown', 'private_pay', 'benefits', 'other')),
  initial_notes text,
  stage text NOT NULL DEFAULT 'inquiry' CHECK (stage IN ('inquiry', 'assessment', 'preparation', 'ready_for_admission', 'admitted', 'declined', 'withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  next_follow_up_at timestamptz,
  last_activity_at timestamptz NOT NULL,
  admitted_at timestamptz,
  admitted_by_user_id uuid REFERENCES identity.users(id),
  decision_snapshot jsonb,
  created_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT onboarding_cases_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT onboarding_cases_scope_id_uq UNIQUE (tenant_id, organization_id, facility_id, id),
  CONSTRAINT onboarding_cases_content_ck CHECK (
    length(trim(first_name)) BETWEEN 1 AND 120 AND
    length(trim(last_name)) BETWEEN 1 AND 120 AND
    length(trim(inquiry_source)) BETWEEN 1 AND 120 AND
    (requester_name IS NULL OR length(trim(requester_name)) <= 160) AND
    (requester_relationship IS NULL OR length(trim(requester_relationship)) <= 120) AND
    (contact_email IS NULL OR length(trim(contact_email)) <= 254) AND
    (contact_phone IS NULL OR length(trim(contact_phone)) <= 80) AND
    (service_location IS NULL OR length(trim(service_location)) <= 500) AND
    (initial_notes IS NULL OR length(initial_notes) <= 4000)
  ),
  CONSTRAINT onboarding_cases_decision_ck CHECK (
    (stage = 'admitted' AND admitted_at IS NOT NULL AND admitted_by_user_id IS NOT NULL AND decision_snapshot IS NOT NULL)
    OR (stage <> 'admitted' AND admitted_at IS NULL AND admitted_by_user_id IS NULL AND decision_snapshot IS NULL)
  ),
  CONSTRAINT onboarding_cases_template_pair_ck CHECK (
    (checklist_template_id IS NULL AND checklist_template_version IS NULL)
    OR (checklist_template_id IS NOT NULL AND checklist_template_version > 0)
  ),
  CONSTRAINT onboarding_cases_org_fk FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT onboarding_cases_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id) REFERENCES organizations.facilities(tenant_id, organization_id, id),
  CONSTRAINT onboarding_cases_client_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients(tenant_id, id),
  CONSTRAINT onboarding_cases_owner_fk FOREIGN KEY (tenant_id, owner_employee_id) REFERENCES employees.employees(tenant_id, id),
  CONSTRAINT onboarding_cases_first_visit_fk FOREIGN KEY (tenant_id, first_visit_id) REFERENCES scheduling.visits(tenant_id, id),
  CONSTRAINT onboarding_cases_template_fk FOREIGN KEY (tenant_id, checklist_template_id) REFERENCES onboarding.checklist_templates(tenant_id, id)
);

CREATE INDEX onboarding_cases_worklist_idx ON onboarding.cases(tenant_id, organization_id, stage, last_activity_at DESC, id);
CREATE INDEX onboarding_cases_owner_idx ON onboarding.cases(tenant_id, owner_employee_id, stage, next_follow_up_at, id);
CREATE INDEX onboarding_cases_client_idx ON onboarding.cases(tenant_id, client_id, created_at DESC, id);
CREATE INDEX onboarding_cases_follow_up_idx ON onboarding.cases(tenant_id, next_follow_up_at, id) WHERE stage NOT IN ('admitted', 'declined', 'withdrawn');

ALTER TABLE communications.prospect_interactions
  ADD CONSTRAINT communications_prospect_interactions_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id);

CREATE TABLE onboarding.checklist_template_items (
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  category text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 160),
  source text NOT NULL CHECK (source IN ('automatic', 'manual', 'document')),
  mandatory boolean NOT NULL,
  requirement_type text NOT NULL CHECK (requirement_type IN ('policy', 'external')),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (tenant_id, template_id, template_version, code),
  CONSTRAINT onboarding_template_items_auto_code_ck CHECK (
    source <> 'automatic' OR code IN ('client_identity', 'primary_contact', 'needs_assessment', 'funding_arrangement', 'service_agreement', 'first_visit')
  ),
  CONSTRAINT onboarding_template_items_template_fk FOREIGN KEY (tenant_id, template_id) REFERENCES onboarding.checklist_templates(tenant_id, id)
);

CREATE TABLE onboarding.assessments (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  updated_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id)
);

CREATE TABLE onboarding.checklist_responses (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  item_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'not_applicable')),
  reason text,
  updated_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, item_code),
  CHECK ((status = 'not_applicable' AND length(trim(coalesce(reason, ''))) BETWEEN 1 AND 500) OR (status = 'complete' AND reason IS NULL)),
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id)
);

CREATE TABLE onboarding.transitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  from_stage text CHECK (from_stage IS NULL OR from_stage IN ('inquiry', 'assessment', 'preparation', 'ready_for_admission', 'admitted', 'declined', 'withdrawn')),
  to_stage text NOT NULL CHECK (to_stage IN ('inquiry', 'assessment', 'preparation', 'ready_for_admission', 'admitted', 'declined', 'withdrawn')),
  version integer NOT NULL CHECK (version > 0),
  reason text CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 1000),
  actor_user_id uuid NOT NULL REFERENCES identity.users(id),
  readiness_snapshot jsonb,
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, case_id, version),
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id)
);
CREATE INDEX onboarding_transitions_timeline_idx ON onboarding.transitions(tenant_id, case_id, occurred_at, id);

CREATE TABLE onboarding.case_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  document_artifact_id uuid NOT NULL,
  requirement_code text NOT NULL CHECK (requirement_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  linked_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  linked_at timestamptz NOT NULL,
  UNIQUE (tenant_id, case_id, requirement_code, document_artifact_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id),
  FOREIGN KEY (tenant_id, document_artifact_id) REFERENCES documents.artifacts(tenant_id, id)
);
CREATE INDEX onboarding_case_documents_case_idx ON onboarding.case_documents(tenant_id, case_id, requirement_code);

CREATE TABLE onboarding.case_tasks (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  task_id uuid NOT NULL,
  linked_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, task_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES operations.tasks(tenant_id, id)
);

CREATE TABLE onboarding.case_communications (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  interaction_id uuid NOT NULL,
  linked_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, interaction_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES onboarding.cases(tenant_id, id),
  FOREIGN KEY (tenant_id, interaction_id) REFERENCES communications.interactions(tenant_id, id)
);

CREATE FUNCTION onboarding.prevent_admitted_case_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stage = 'admitted' AND (
    NEW.stage IS DISTINCT FROM OLD.stage OR
    NEW.admitted_at IS DISTINCT FROM OLD.admitted_at OR
    NEW.admitted_by_user_id IS DISTINCT FROM OLD.admitted_by_user_id OR
    NEW.decision_snapshot IS DISTINCT FROM OLD.decision_snapshot OR
    NEW.client_id IS DISTINCT FROM OLD.client_id
  ) THEN
    RAISE EXCEPTION 'admission decisions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER onboarding_admitted_case_immutable
BEFORE UPDATE ON onboarding.cases
FOR EACH ROW EXECUTE FUNCTION onboarding.prevent_admitted_case_rewrite();

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'cases', 'assessments', 'checklist_templates', 'checklist_template_items',
    'checklist_responses', 'transitions', 'case_documents', 'case_tasks', 'case_communications'
  ] LOOP
    EXECUTE format('ALTER TABLE onboarding.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE onboarding.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format(
      'CREATE POLICY %I ON onboarding.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      'onboarding_' || relation_name || '_tenant_isolation', relation_name
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA onboarding TO care_app;
GRANT SELECT, INSERT, UPDATE ON onboarding.cases, onboarding.assessments, onboarding.checklist_templates, onboarding.checklist_responses TO care_app;
GRANT SELECT, INSERT ON onboarding.checklist_template_items, onboarding.transitions, onboarding.case_documents, onboarding.case_tasks, onboarding.case_communications TO care_app;
