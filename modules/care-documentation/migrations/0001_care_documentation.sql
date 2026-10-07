CREATE SCHEMA IF NOT EXISTS care_documentation;

CREATE TABLE care_documentation.documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'finalized')),
  created_by_employee_id uuid NOT NULL,
  finalized_by_employee_id uuid,
  finalized_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT care_documents_finalized_ck CHECK (
    (status = 'draft' AND finalized_at IS NULL AND finalized_by_employee_id IS NULL)
    OR (status = 'finalized' AND finalized_at IS NOT NULL AND finalized_by_employee_id IS NOT NULL)
  ),
  CONSTRAINT care_documents_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT care_documents_tenant_visit_uq UNIQUE (tenant_id, visit_id),
  CONSTRAINT care_documents_tenant_execution_uq UNIQUE (tenant_id, execution_id),
  CONSTRAINT care_documents_tenant_id_execution_uq UNIQUE (tenant_id, id, execution_id),
  CONSTRAINT care_documents_visit_fk
    FOREIGN KEY (tenant_id, visit_id) REFERENCES scheduling.visits (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT care_documents_execution_fk
    FOREIGN KEY (tenant_id, execution_id, visit_id)
    REFERENCES visit_execution.executions (tenant_id, id, visit_id) ON DELETE RESTRICT,
  CONSTRAINT care_documents_created_by_employee_fk
    FOREIGN KEY (tenant_id, created_by_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT care_documents_finalized_by_employee_fk
    FOREIGN KEY (tenant_id, finalized_by_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX care_documents_tenant_status_updated_idx
  ON care_documentation.documents (tenant_id, status, updated_at);

CREATE TABLE care_documentation.entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  documentation_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('care_note', 'observation', 'deviation', 'incident')),
  author_employee_id uuid NOT NULL,
  occurred_at timestamptz,
  severity text,
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT documentation_entries_incident_ck CHECK (
    (type = 'incident' AND occurred_at IS NOT NULL AND severity IN ('low', 'moderate', 'high', 'critical'))
    OR (type <> 'incident' AND severity IS NULL)
  ),
  CONSTRAINT documentation_entries_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT documentation_entries_document_fk
    FOREIGN KEY (tenant_id, documentation_id) REFERENCES care_documentation.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT documentation_entries_author_employee_fk
    FOREIGN KEY (tenant_id, author_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX documentation_entries_tenant_document_created_idx
  ON care_documentation.entries (tenant_id, documentation_id, created_at, id);

CREATE TABLE care_documentation.service_evidence (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  documentation_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  performed_service_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('documented', 'not_required')),
  documented_by_employee_id uuid NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT service_evidence_status_ck CHECK (
    status = 'documented' OR (status = 'not_required' AND length(trim(coalesce(note, ''))) > 0)
  ),
  CONSTRAINT service_evidence_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT service_evidence_performed_service_uq UNIQUE (tenant_id, documentation_id, performed_service_id),
  CONSTRAINT service_evidence_document_execution_fk
    FOREIGN KEY (tenant_id, documentation_id, execution_id)
    REFERENCES care_documentation.documents (tenant_id, id, execution_id) ON DELETE RESTRICT,
  CONSTRAINT service_evidence_performed_service_fk
    FOREIGN KEY (tenant_id, performed_service_id, execution_id)
    REFERENCES visit_execution.performed_services (tenant_id, id, execution_id) ON DELETE RESTRICT,
  CONSTRAINT service_evidence_author_employee_fk
    FOREIGN KEY (tenant_id, documented_by_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX service_evidence_execution_idx
  ON care_documentation.service_evidence (tenant_id, execution_id, performed_service_id);

CREATE TABLE care_documentation.amendments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  documentation_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  correction text NOT NULL CHECK (length(trim(correction)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL,
  CONSTRAINT documentation_amendments_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT documentation_amendments_document_fk
    FOREIGN KEY (tenant_id, documentation_id) REFERENCES care_documentation.documents (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX documentation_amendments_document_created_idx
  ON care_documentation.amendments (tenant_id, documentation_id, created_at, id);

CREATE TABLE care_documentation.history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  documentation_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_employee_id uuid,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT documentation_history_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT documentation_history_document_fk
    FOREIGN KEY (tenant_id, documentation_id) REFERENCES care_documentation.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT documentation_history_actor_employee_fk
    FOREIGN KEY (tenant_id, actor_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX documentation_history_document_occurred_idx
  ON care_documentation.history (tenant_id, documentation_id, occurred_at, id);

-- Preserve the existing free text by moving it into the new documentation owner.
INSERT INTO care_documentation.documents (
  id, tenant_id, visit_id, execution_id, status, created_by_employee_id,
  finalized_by_employee_id, finalized_at, version, created_at, updated_at
)
SELECT uuidv7(), execution.tenant_id, execution.visit_id, execution.id, 'draft',
       execution.started_by_employee_id, NULL, NULL, 1, execution.created_at, execution.updated_at
FROM visit_execution.executions AS execution
WHERE execution.operational_note IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM visit_execution.performed_services AS service
     WHERE service.tenant_id = execution.tenant_id
       AND service.execution_id = execution.id
       AND service.note IS NOT NULL
   );

INSERT INTO care_documentation.entries (
  id, tenant_id, documentation_id, type, author_employee_id, occurred_at,
  severity, content, created_at, updated_at
)
SELECT uuidv7(), execution.tenant_id, document.id, 'care_note',
       execution.started_by_employee_id, NULL, NULL, execution.operational_note,
       execution.updated_at, execution.updated_at
FROM visit_execution.executions AS execution
JOIN care_documentation.documents AS document
  ON document.tenant_id = execution.tenant_id AND document.execution_id = execution.id
WHERE execution.operational_note IS NOT NULL;

INSERT INTO care_documentation.service_evidence (
  id, tenant_id, documentation_id, execution_id, performed_service_id, status,
  documented_by_employee_id, note, created_at, updated_at
)
SELECT uuidv7(), service.tenant_id, document.id, service.execution_id,
       service.id, 'documented', service.performed_by_employee_id, service.note,
       service.created_at, service.updated_at
FROM visit_execution.performed_services AS service
JOIN care_documentation.documents AS document
  ON document.tenant_id = service.tenant_id AND document.execution_id = service.execution_id
WHERE service.note IS NOT NULL;

ALTER TABLE visit_execution.executions DROP COLUMN operational_note;
ALTER TABLE visit_execution.performed_services DROP COLUMN note;

CREATE FUNCTION care_documentation.prevent_finalized_document_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'finalized care documentation is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER care_documents_finalized_immutable
  BEFORE UPDATE ON care_documentation.documents
  FOR EACH ROW EXECUTE FUNCTION care_documentation.prevent_finalized_document_update();

CREATE FUNCTION care_documentation.require_draft_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_tenant uuid;
  target_document uuid;
  parent_status text;
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
  WHERE tenant_id = target_tenant AND id = target_document;
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'care documentation entries are immutable after finalization' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documentation_entries_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON care_documentation.entries
  FOR EACH ROW EXECUTE FUNCTION care_documentation.require_draft_parent();
CREATE TRIGGER service_evidence_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON care_documentation.service_evidence
  FOR EACH ROW EXECUTE FUNCTION care_documentation.require_draft_parent();

CREATE FUNCTION care_documentation.append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'care documentation history is append only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER documentation_amendments_append_only
  BEFORE UPDATE OR DELETE ON care_documentation.amendments
  FOR EACH ROW EXECUTE FUNCTION care_documentation.append_only();
CREATE TRIGGER documentation_history_append_only
  BEFORE UPDATE OR DELETE ON care_documentation.history
  FOR EACH ROW EXECUTE FUNCTION care_documentation.append_only();

ALTER TABLE care_documentation.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_documentation.documents FORCE ROW LEVEL SECURITY;
CREATE POLICY care_documents_tenant_isolation ON care_documentation.documents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE care_documentation.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_documentation.entries FORCE ROW LEVEL SECURITY;
CREATE POLICY documentation_entries_tenant_isolation ON care_documentation.entries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE care_documentation.service_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_documentation.service_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY service_evidence_tenant_isolation ON care_documentation.service_evidence
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE care_documentation.amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_documentation.amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY documentation_amendments_tenant_isolation ON care_documentation.amendments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE care_documentation.history ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_documentation.history FORCE ROW LEVEL SECURITY;
CREATE POLICY documentation_history_tenant_isolation ON care_documentation.history
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA care_documentation TO care_app;
GRANT SELECT, INSERT, UPDATE ON care_documentation.documents TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON care_documentation.entries TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON care_documentation.service_evidence TO care_app;
GRANT SELECT, INSERT ON care_documentation.amendments, care_documentation.history TO care_app;
