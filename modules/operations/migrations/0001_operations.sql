CREATE SCHEMA IF NOT EXISTS operations;

CREATE TABLE operations.tasks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  client_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_employee_id uuid,
  created_by_user_id uuid NOT NULL,
  completed_by_user_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  source_type text CHECK (source_type IN ('client', 'visit', 'service_agreement', 'service_evidence', 'invoice', 'claim', 'benefit_entitlement', 'document')),
  source_client_id uuid,
  source_visit_id uuid,
  source_agreement_id uuid,
  source_evidence_package_id uuid,
  source_invoice_id uuid,
  source_claim_id uuid,
  source_entitlement_id uuid,
  source_document_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_tasks_state_ck CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL AND completed_by_user_id IS NULL)
  ),
  CONSTRAINT operations_tasks_source_pair_ck CHECK (
    (source_type IS NULL AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'client' AND source_client_id IS NOT NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'visit' AND source_client_id IS NULL AND source_visit_id IS NOT NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'service_agreement' AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NOT NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'service_evidence' AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NOT NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'invoice' AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NOT NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'claim' AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NOT NULL AND source_entitlement_id IS NULL AND source_document_id IS NULL)
    OR (source_type = 'benefit_entitlement' AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NOT NULL AND source_document_id IS NULL)
    OR (source_type = 'document' AND source_client_id IS NULL AND source_visit_id IS NULL AND source_agreement_id IS NULL AND source_evidence_package_id IS NULL AND source_invoice_id IS NULL AND source_claim_id IS NULL AND source_entitlement_id IS NULL AND source_document_id IS NOT NULL)
  ),
  CONSTRAINT operations_tasks_tenant_organization_fk FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT operations_tasks_tenant_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id) REFERENCES organizations.facilities(tenant_id, organization_id, id),
  CONSTRAINT operations_tasks_tenant_client_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients(tenant_id, id),
  CONSTRAINT operations_tasks_tenant_assignee_fk FOREIGN KEY (tenant_id, assigned_employee_id) REFERENCES employees.employees(tenant_id, id),
  CONSTRAINT operations_tasks_source_client_fk FOREIGN KEY (tenant_id, source_client_id) REFERENCES clients.clients(tenant_id, id),
  CONSTRAINT operations_tasks_source_visit_fk FOREIGN KEY (tenant_id, source_visit_id) REFERENCES scheduling.visits(tenant_id, id),
  CONSTRAINT operations_tasks_source_agreement_fk FOREIGN KEY (tenant_id, source_agreement_id) REFERENCES service_agreements.agreements(tenant_id, id),
  CONSTRAINT operations_tasks_source_evidence_fk FOREIGN KEY (tenant_id, source_evidence_package_id) REFERENCES service_evidence.evidence_packages(tenant_id, id),
  CONSTRAINT operations_tasks_source_invoice_fk FOREIGN KEY (tenant_id, source_invoice_id) REFERENCES billing.invoices(tenant_id, id),
  CONSTRAINT operations_tasks_source_claim_fk FOREIGN KEY (tenant_id, source_claim_id) REFERENCES billing.claims(tenant_id, id),
  CONSTRAINT operations_tasks_source_entitlement_fk FOREIGN KEY (tenant_id, source_entitlement_id) REFERENCES benefits.client_entitlements(tenant_id, id),
  CONSTRAINT operations_tasks_source_document_fk FOREIGN KEY (tenant_id, source_document_id) REFERENCES documents.artifacts(tenant_id, id),
  CONSTRAINT operations_tasks_tenant_id_uq UNIQUE (tenant_id, id)
);

CREATE INDEX operations_tasks_scope_status_due_idx ON operations.tasks(tenant_id, organization_id, facility_id, status, due_at, id);
CREATE INDEX operations_tasks_assignee_status_due_idx ON operations.tasks(tenant_id, assigned_employee_id, status, due_at, id);

CREATE TABLE operations.task_activity (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'edited', 'assigned', 'priority_changed', 'due_date_changed', 'status_changed', 'comment')),
  details jsonb NOT NULL DEFAULT '{}',
  comment text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_task_activity_comment_ck CHECK ((kind = 'comment' AND comment IS NOT NULL) OR (kind <> 'comment' AND comment IS NULL)),
  CONSTRAINT operations_task_activity_task_fk FOREIGN KEY (tenant_id, task_id) REFERENCES operations.tasks(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX operations_task_activity_task_time_idx ON operations.task_activity(tenant_id, task_id, occurred_at, id);

CREATE TABLE operations.exception_interactions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  issue_key text NOT NULL CHECK (length(issue_key) = 64),
  action text NOT NULL CHECK (action IN ('acknowledged', 'snoozed')),
  previous_state text NOT NULL CHECK (previous_state IN ('open', 'acknowledged', 'snoozed')),
  snoozed_until timestamptz,
  reason text CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 500),
  actor_user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_exception_interactions_action_ck CHECK ((action = 'snoozed' AND snoozed_until IS NOT NULL) OR (action = 'acknowledged' AND snoozed_until IS NULL))
);
CREATE INDEX operations_exception_interactions_issue_time_idx ON operations.exception_interactions(tenant_id, issue_key, occurred_at, id);

ALTER TABLE operations.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_tasks_tenant_isolation ON operations.tasks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE operations.task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.task_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_task_activity_tenant_isolation ON operations.task_activity
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE operations.exception_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.exception_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_exception_interactions_tenant_isolation ON operations.exception_interactions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA operations TO care_app;
GRANT SELECT, INSERT, UPDATE ON operations.tasks TO care_app;
GRANT SELECT, INSERT ON operations.task_activity, operations.exception_interactions TO care_app;
