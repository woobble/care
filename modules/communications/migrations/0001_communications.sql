CREATE SCHEMA communications;

CREATE TABLE communications.interactions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid,
  facility_id uuid,
  client_id uuid NOT NULL,
  contact_id uuid,
  contact_label_snapshot text,
  contact_authorization text NOT NULL CHECK (contact_authorization IN ('legal_representative', 'authorized_contact', 'not_confirmed', 'not_applicable')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  channel text NOT NULL CHECK (channel IN ('phone', 'in_person', 'email', 'letter', 'portal', 'other')),
  category text NOT NULL CHECK (category IN ('general_inquiry', 'appointment_coordination', 'cancellation_rescheduling', 'service_request', 'service_agreement', 'documentation', 'billing_payment', 'benefits_payer', 'complaint_feedback', 'other')),
  subject text NOT NULL,
  summary text,
  outcome text NOT NULL CHECK (outcome IN ('information_provided', 'request_received', 'action_required', 'appointment_agreed', 'no_answer', 'resolved', 'other')),
  occurred_at timestamptz NOT NULL,
  recorded_by_user_id uuid NOT NULL,
  source_type text CHECK (source_type IN ('visit', 'service_agreement', 'operations_task', 'invoice', 'claim', 'document')),
  source_visit_id uuid,
  source_agreement_id uuid,
  source_task_id uuid,
  source_invoice_id uuid,
  source_claim_id uuid,
  source_document_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communications_interactions_content_ck CHECK (length(trim(subject)) BETWEEN 1 AND 200 AND (summary IS NULL OR length(summary) <= 4000) AND (contact_label_snapshot IS NULL OR length(trim(contact_label_snapshot)) BETWEEN 1 AND 120)),
  CONSTRAINT communications_interactions_contact_authorization_ck CHECK ((contact_id IS NULL AND contact_authorization IN ('not_confirmed', 'not_applicable')) OR (contact_id IS NOT NULL AND contact_authorization IN ('legal_representative', 'authorized_contact', 'not_confirmed'))),
  CONSTRAINT communications_interactions_source_pair_ck CHECK (
    (source_type IS NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 0)
    OR (source_type = 'visit' AND source_visit_id IS NOT NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 1)
    OR (source_type = 'service_agreement' AND source_agreement_id IS NOT NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 1)
    OR (source_type = 'operations_task' AND source_task_id IS NOT NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 1)
    OR (source_type = 'invoice' AND source_invoice_id IS NOT NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 1)
    OR (source_type = 'claim' AND source_claim_id IS NOT NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 1)
    OR (source_type = 'document' AND source_document_id IS NOT NULL AND num_nonnulls(source_visit_id, source_agreement_id, source_task_id, source_invoice_id, source_claim_id, source_document_id) = 1)
  ),
  CONSTRAINT communications_interactions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT communications_interactions_tenant_client_id_uq UNIQUE (tenant_id, client_id, id),
  CONSTRAINT communications_interactions_tenant_client_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients(tenant_id, id),
  CONSTRAINT communications_interactions_tenant_org_fk FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT communications_interactions_tenant_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id) REFERENCES organizations.facilities(tenant_id, organization_id, id),
  CONSTRAINT communications_interactions_contact_fk FOREIGN KEY (tenant_id, client_id, contact_id) REFERENCES clients.client_contacts(tenant_id, client_id, id),
  CONSTRAINT communications_interactions_author_fk FOREIGN KEY (recorded_by_user_id) REFERENCES identity.users(id),
  CONSTRAINT communications_interactions_source_visit_fk FOREIGN KEY (tenant_id, source_visit_id) REFERENCES scheduling.visits(tenant_id, id),
  CONSTRAINT communications_interactions_source_agreement_fk FOREIGN KEY (tenant_id, source_agreement_id) REFERENCES service_agreements.agreements(tenant_id, id),
  CONSTRAINT communications_interactions_source_task_fk FOREIGN KEY (tenant_id, source_task_id) REFERENCES operations.tasks(tenant_id, id),
  CONSTRAINT communications_interactions_source_invoice_fk FOREIGN KEY (tenant_id, source_invoice_id) REFERENCES billing.invoices(tenant_id, id),
  CONSTRAINT communications_interactions_source_claim_fk FOREIGN KEY (tenant_id, source_claim_id) REFERENCES billing.claims(tenant_id, id),
  CONSTRAINT communications_interactions_source_document_fk FOREIGN KEY (tenant_id, source_document_id) REFERENCES documents.artifacts(tenant_id, id)
);

CREATE INDEX communications_interactions_client_timeline_idx ON communications.interactions(tenant_id, client_id, occurred_at, id);
CREATE INDEX communications_interactions_timeline_idx ON communications.interactions(tenant_id, occurred_at, id);
CREATE INDEX communications_interactions_channel_timeline_idx ON communications.interactions(tenant_id, channel, occurred_at, id);
CREATE INDEX communications_interactions_category_timeline_idx ON communications.interactions(tenant_id, category, occurred_at, id);

CREATE TABLE communications.interaction_amendments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  interaction_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  channel text NOT NULL CHECK (channel IN ('phone', 'in_person', 'email', 'letter', 'portal', 'other')),
  category text NOT NULL CHECK (category IN ('general_inquiry', 'appointment_coordination', 'cancellation_rescheduling', 'service_request', 'service_agreement', 'documentation', 'billing_payment', 'benefits_payer', 'complaint_feedback', 'other')),
  subject text NOT NULL,
  summary text,
  outcome text NOT NULL CHECK (outcome IN ('information_provided', 'request_received', 'action_required', 'appointment_agreed', 'no_answer', 'resolved', 'other')),
  contact_id uuid,
  contact_label_snapshot text,
  contact_authorization text NOT NULL CHECK (contact_authorization IN ('legal_representative', 'authorized_contact', 'not_confirmed', 'not_applicable')),
  recorded_by_user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT communications_amendments_content_ck CHECK (length(trim(subject)) BETWEEN 1 AND 200 AND (summary IS NULL OR length(summary) <= 4000) AND (contact_label_snapshot IS NULL OR length(trim(contact_label_snapshot)) BETWEEN 1 AND 120)),
  CONSTRAINT communications_amendments_contact_authorization_ck CHECK ((contact_id IS NULL AND contact_authorization IN ('not_confirmed', 'not_applicable')) OR (contact_id IS NOT NULL AND contact_authorization IN ('legal_representative', 'authorized_contact', 'not_confirmed'))),
  CONSTRAINT communications_amendments_interaction_fk FOREIGN KEY (tenant_id, client_id, interaction_id) REFERENCES communications.interactions(tenant_id, client_id, id),
  CONSTRAINT communications_amendments_contact_fk FOREIGN KEY (tenant_id, client_id, contact_id) REFERENCES clients.client_contacts(tenant_id, client_id, id),
  CONSTRAINT communications_amendments_author_fk FOREIGN KEY (recorded_by_user_id) REFERENCES identity.users(id),
  CONSTRAINT communications_amendments_tenant_interaction_version_uq UNIQUE (tenant_id, interaction_id, version)
);

CREATE INDEX communications_amendments_timeline_idx ON communications.interaction_amendments(tenant_id, interaction_id, recorded_at, id);

CREATE TABLE communications.client_preferences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  preferred_channel text CHECK (preferred_channel IS NULL OR preferred_channel IN ('phone', 'in_person', 'email', 'letter', 'portal', 'other')),
  preferred_language text CHECK (preferred_language IS NULL OR preferred_language IN ('de', 'en')),
  preferred_contact_id uuid,
  preferred_contact_times text,
  correspondence_preference text NOT NULL CHECK (correspondence_preference IN ('unspecified', 'postal', 'electronic')),
  contact_restrictions text,
  version integer NOT NULL CHECK (version > 0),
  updated_by_user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT communications_client_preferences_content_ck CHECK ((preferred_contact_times IS NULL OR length(preferred_contact_times) <= 250) AND (contact_restrictions IS NULL OR length(contact_restrictions) <= 1000)),
  CONSTRAINT communications_preferences_client_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients(tenant_id, id),
  CONSTRAINT communications_preferences_contact_fk FOREIGN KEY (tenant_id, client_id, preferred_contact_id) REFERENCES clients.client_contacts(tenant_id, client_id, id),
  CONSTRAINT communications_preferences_author_fk FOREIGN KEY (updated_by_user_id) REFERENCES identity.users(id),
  CONSTRAINT communications_client_preferences_tenant_client_uq UNIQUE (tenant_id, client_id)
);

CREATE INDEX communications_client_preferences_contact_idx ON communications.client_preferences(tenant_id, preferred_contact_id);

ALTER TABLE communications.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_interactions_tenant_isolation ON communications.interactions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE communications.interaction_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.interaction_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_amendments_tenant_isolation ON communications.interaction_amendments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE communications.client_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.client_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_preferences_tenant_isolation ON communications.client_preferences
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA communications TO care_app;
GRANT SELECT, INSERT, UPDATE ON communications.interactions TO care_app;
GRANT SELECT, INSERT ON communications.interaction_amendments TO care_app;
GRANT SELECT, INSERT, UPDATE ON communications.client_preferences TO care_app;
