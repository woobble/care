CREATE TABLE communications.prospect_interactions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  channel text NOT NULL CHECK (channel IN ('phone', 'in_person', 'email', 'letter', 'portal', 'other')),
  category text NOT NULL CHECK (category IN ('general_inquiry', 'appointment_coordination', 'cancellation_rescheduling', 'service_request', 'service_agreement', 'documentation', 'billing_payment', 'benefits_payer', 'complaint_feedback', 'other')),
  subject text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
  summary text CHECK (summary IS NULL OR length(summary) <= 4000),
  outcome text NOT NULL CHECK (outcome IN ('information_provided', 'request_received', 'action_required', 'appointment_agreed', 'no_answer', 'resolved', 'other')),
  occurred_at timestamptz NOT NULL,
  recorded_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communications_prospect_interactions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT communications_prospect_interactions_org_fk FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT communications_prospect_interactions_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id) REFERENCES organizations.facilities(tenant_id, organization_id, id)
);

CREATE INDEX communications_prospect_interactions_case_timeline_idx
  ON communications.prospect_interactions(tenant_id, case_id, occurred_at DESC, id DESC);

ALTER TABLE communications.prospect_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.prospect_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_prospect_interactions_tenant_isolation
  ON communications.prospect_interactions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON communications.prospect_interactions TO care_app;
