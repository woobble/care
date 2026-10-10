CREATE TABLE billing.payers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  payer_type text NOT NULL CHECK (payer_type IN ('statutory_pflegekasse', 'private_pflegeversicherung', 'self_pay', 'other')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  payer_identifier text CHECK (length(coalesce(payer_identifier, '')) <= 80),
  address_text text CHECK (length(coalesce(address_text, '')) <= 1000),
  billing_contact_name text CHECK (length(coalesce(billing_contact_name, '')) <= 200),
  billing_contact_email text CHECK (length(coalesce(billing_contact_email, '')) <= 254),
  billing_contact_phone text CHECK (length(coalesce(billing_contact_phone, '')) <= 80),
  submission_instructions text CHECK (length(coalesce(submission_instructions, '')) <= 2000),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  valid_from date NOT NULL,
  valid_until date,
  version integer NOT NULL CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payers_validity_ck CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT payers_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT payers_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT payers_tenant_organization_id_uq UNIQUE (tenant_id, organization_id, id)
);
CREATE INDEX payers_org_status_idx ON billing.payers (tenant_id, organization_id, status, name);

CREATE TABLE billing.payer_billing_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  payer_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  channel text NOT NULL CHECK (channel IN ('manual_portal', 'manual_email', 'postal', 'customer_reimbursement')),
  funding_source_type text NOT NULL CHECK (funding_source_type IN ('statutory_long_term_care_insurance', 'private_long_term_care_insurance', 'self_pay', 'other')),
  valid_from date NOT NULL,
  valid_until date,
  source_name text NOT NULL CHECK (length(trim(source_name)) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (length(trim(source_version)) BETWEEN 1 AND 120),
  source_effective_date date NOT NULL,
  source_url text CHECK (source_url IS NULL OR source_url ~ '^https://'),
  requires_client_insurance_number boolean NOT NULL,
  requires_payer_identifier boolean NOT NULL,
  requires_acknowledgement boolean NOT NULL,
  requires_mandate boolean NOT NULL,
  requires_invoice_pdf boolean NOT NULL,
  requires_evidence_pdf boolean NOT NULL,
  requires_mandate_document boolean NOT NULL,
  requires_external_reference boolean NOT NULL,
  requires_provider_recognition boolean NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_billing_profiles_validity_ck CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT payer_billing_profiles_payer_fk FOREIGN KEY (tenant_id, organization_id, payer_id)
    REFERENCES billing.payers (tenant_id, organization_id, id),
  CONSTRAINT payer_billing_profiles_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT payer_billing_profiles_tenant_org_id_uq UNIQUE (tenant_id, organization_id, id),
  CONSTRAINT payer_billing_profiles_version_uq UNIQUE (tenant_id, payer_id, channel, funding_source_type, version)
);
CREATE INDEX payer_billing_profiles_effective_idx
  ON billing.payer_billing_profiles (tenant_id, payer_id, funding_source_type, valid_from, valid_until);

ALTER TABLE billing.payer_arrangements
  DROP CONSTRAINT IF EXISTS payer_arrangements_payer_type_check,
  ADD CONSTRAINT payer_arrangements_payer_type_ck
    CHECK (payer_type IN ('statutory_insurance', 'private_insurance', 'self_pay', 'other'));

ALTER TABLE billing.payer_arrangements
  ADD COLUMN payer_id uuid,
  ADD COLUMN mandate_document_artifact_id uuid,
  ADD CONSTRAINT payer_arrangements_claim_scope_uq
    UNIQUE (tenant_id, organization_id, client_id, payer_id, id),
  ADD CONSTRAINT payer_arrangements_payer_fk
    FOREIGN KEY (tenant_id, organization_id, payer_id)
    REFERENCES billing.payers (tenant_id, organization_id, id),
  ADD CONSTRAINT payer_arrangements_mandate_artifact_fk
    FOREIGN KEY (tenant_id, mandate_document_artifact_id)
    REFERENCES documents.artifacts (tenant_id, id);

CREATE UNIQUE INDEX invoices_claim_scope_uq
  ON billing.invoices (tenant_id, id, organization_id, facility_id, client_id);
CREATE UNIQUE INDEX invoice_lines_tenant_invoice_id_uq
  ON billing.invoice_lines (tenant_id, invoice_id, id);
CREATE UNIQUE INDEX invoice_documents_tenant_invoice_id_uq
  ON billing.invoice_documents (tenant_id, invoice_id, id);

CREATE TABLE billing.claims (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  client_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  payer_id uuid NOT NULL,
  payer_arrangement_id uuid NOT NULL,
  payer_billing_profile_id uuid,
  arrangement_type text NOT NULL CHECK (arrangement_type IN ('direct_payer_billing', 'reimbursement_to_client')),
  channel text CHECK (channel IN ('manual_portal', 'manual_email', 'postal', 'customer_reimbursement')),
  funding_source_type text NOT NULL CHECK (funding_source_type IN ('statutory_long_term_care_insurance', 'private_long_term_care_insurance', 'self_pay', 'other')),
  status text NOT NULL CHECK (status IN ('draft', 'ready', 'submitted', 'accepted', 'partially_accepted', 'rejected', 'clarification_required', 'resubmitted', 'cancelled')),
  currency text NOT NULL CHECK (currency = 'EUR'),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  invoice_version integer NOT NULL CHECK (invoice_version > 0),
  invoice_snapshot jsonb NOT NULL CHECK (jsonb_typeof(invoice_snapshot) = 'object'),
  payer_snapshot jsonb NOT NULL CHECK (jsonb_typeof(payer_snapshot) = 'object'),
  arrangement_snapshot jsonb NOT NULL CHECK (jsonb_typeof(arrangement_snapshot) = 'object'),
  profile_snapshot jsonb NOT NULL CHECK (jsonb_typeof(profile_snapshot) = 'object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  package_version integer NOT NULL DEFAULT 0 CHECK (package_version >= 0),
  package_hash text CHECK (package_hash IS NULL OR package_hash ~ '^[a-f0-9]{64}$'),
  supersedes_claim_id uuid,
  resubmission_of_submission_id uuid,
  version integer NOT NULL CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  prepared_at timestamptz,
  CONSTRAINT claims_package_state_ck CHECK (
    (status IN ('draft', 'cancelled') AND package_version = 0 AND package_hash IS NULL AND prepared_at IS NULL)
    OR (status NOT IN ('draft', 'cancelled') AND package_version > 0 AND package_hash IS NOT NULL AND prepared_at IS NOT NULL)
    OR (status = 'cancelled' AND package_version > 0 AND package_hash IS NOT NULL AND prepared_at IS NOT NULL)
  ),
  CONSTRAINT claims_channel_ck CHECK (
    (payer_billing_profile_id IS NULL AND (channel IS NULL OR (arrangement_type = 'reimbursement_to_client' AND channel = 'customer_reimbursement')))
    OR (payer_billing_profile_id IS NOT NULL AND ((arrangement_type = 'direct_payer_billing' AND channel IN ('manual_portal', 'manual_email', 'postal'))
      OR (arrangement_type = 'reimbursement_to_client' AND channel = 'customer_reimbursement')))
  ),
  CONSTRAINT claims_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT claims_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  CONSTRAINT claims_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT claims_invoice_scope_fk FOREIGN KEY (tenant_id, invoice_id, organization_id, facility_id, client_id)
    REFERENCES billing.invoices (tenant_id, id, organization_id, facility_id, client_id),
  CONSTRAINT claims_payer_fk FOREIGN KEY (tenant_id, organization_id, payer_id)
    REFERENCES billing.payers (tenant_id, organization_id, id),
  CONSTRAINT claims_arrangement_scope_fk FOREIGN KEY (tenant_id, organization_id, client_id, payer_id, payer_arrangement_id)
    REFERENCES billing.payer_arrangements (tenant_id, organization_id, client_id, payer_id, id),
  CONSTRAINT claims_profile_scope_fk FOREIGN KEY (tenant_id, organization_id, payer_billing_profile_id)
    REFERENCES billing.payer_billing_profiles (tenant_id, organization_id, id),
  CONSTRAINT claims_supersedes_fk FOREIGN KEY (tenant_id, supersedes_claim_id)
    REFERENCES billing.claims (tenant_id, id),
  CONSTRAINT claims_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT claims_tenant_invoice_id_uq UNIQUE (tenant_id, id, invoice_id),
  CONSTRAINT claims_resubmission_reference_ck CHECK (
    (supersedes_claim_id IS NULL AND resubmission_of_submission_id IS NULL)
    OR (supersedes_claim_id IS NOT NULL AND resubmission_of_submission_id IS NOT NULL)
  )
);
CREATE INDEX claims_worklist_idx ON billing.claims (tenant_id, organization_id, status, created_at, id);
CREATE INDEX claims_client_idx ON billing.claims (tenant_id, client_id, created_at, id);
CREATE INDEX claims_invoice_idx ON billing.claims (tenant_id, invoice_id, created_at);
CREATE UNIQUE INDEX claims_resubmission_source_nonnull_uq
  ON billing.claims (tenant_id, supersedes_claim_id) WHERE supersedes_claim_id IS NOT NULL;

CREATE TABLE billing.claim_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_line_id uuid NOT NULL,
  funding_allocation_id uuid,
  evidence_package_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  line_snapshot jsonb NOT NULL CHECK (jsonb_typeof(line_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_lines_claim_invoice_fk FOREIGN KEY (tenant_id, claim_id, invoice_id)
    REFERENCES billing.claims (tenant_id, id, invoice_id),
  CONSTRAINT claim_lines_invoice_source_fk FOREIGN KEY (tenant_id, invoice_id, invoice_line_id)
    REFERENCES billing.invoice_lines (tenant_id, invoice_id, id),
  CONSTRAINT claim_lines_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT claim_lines_claim_source_uq UNIQUE (tenant_id, claim_id, invoice_line_id)
);
CREATE INDEX claim_lines_source_idx ON billing.claim_lines (tenant_id, invoice_line_id, claim_id);

CREATE TABLE billing.claim_submissions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  submission_number integer NOT NULL CHECK (submission_number > 0),
  channel text NOT NULL CHECK (channel IN ('manual_portal', 'manual_email', 'postal', 'customer_reimbursement')),
  submitted_at timestamptz NOT NULL,
  submitted_by uuid NOT NULL,
  recipient_snapshot jsonb NOT NULL CHECK (jsonb_typeof(recipient_snapshot) = 'object'),
  external_reference text CHECK (length(coalesce(external_reference, '')) <= 160),
  protected_note text CHECK (length(coalesce(protected_note, '')) <= 2000),
  package_version integer NOT NULL CHECK (package_version > 0),
  invoice_id uuid NOT NULL,
  package_hash text NOT NULL CHECK (package_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_submissions_claim_fk FOREIGN KEY (tenant_id, claim_id, invoice_id)
    REFERENCES billing.claims (tenant_id, id, invoice_id),
  CONSTRAINT claim_submissions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT claim_submissions_tenant_claim_id_uq UNIQUE (tenant_id, claim_id, id),
  CONSTRAINT claim_submissions_claim_number_uq UNIQUE (tenant_id, claim_id, submission_number)
);
CREATE INDEX claim_submissions_history_idx ON billing.claim_submissions (tenant_id, claim_id, submitted_at);
ALTER TABLE billing.claims
  ADD CONSTRAINT claims_resubmission_submission_fk
  FOREIGN KEY (tenant_id, supersedes_claim_id, resubmission_of_submission_id)
  REFERENCES billing.claim_submissions (tenant_id, claim_id, id);

CREATE TABLE billing.claim_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted', 'partially_accepted', 'rejected', 'clarification_required')),
  decision_date date NOT NULL,
  external_reference text CHECK (length(coalesce(external_reference, '')) <= 160),
  accepted_cents integer NOT NULL CHECK (accepted_cents >= 0),
  rejected_cents integer NOT NULL CHECK (rejected_cents >= 0),
  reason_code text CHECK (length(coalesce(reason_code, '')) <= 80),
  protected_explanation text CHECK (length(coalesce(protected_explanation, '')) <= 4000),
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_decisions_amounts_ck CHECK (
    (decision = 'accepted' AND accepted_cents > 0 AND rejected_cents = 0)
    OR (decision = 'partially_accepted' AND accepted_cents > 0 AND rejected_cents > 0)
    OR (decision = 'rejected' AND accepted_cents = 0 AND rejected_cents > 0)
    OR (decision = 'clarification_required' AND accepted_cents = 0 AND rejected_cents = 0)
  ),
  CONSTRAINT claim_decisions_claim_fk FOREIGN KEY (tenant_id, claim_id)
    REFERENCES billing.claims (tenant_id, id),
  CONSTRAINT claim_decisions_submission_fk FOREIGN KEY (tenant_id, claim_id, submission_id)
    REFERENCES billing.claim_submissions (tenant_id, claim_id, id),
  CONSTRAINT claim_decisions_tenant_id_uq UNIQUE (tenant_id, id)
);
CREATE INDEX claim_decisions_history_idx ON billing.claim_decisions (tenant_id, claim_id, created_at);

CREATE TABLE billing.claim_decision_lines (
  tenant_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  claim_line_id uuid NOT NULL,
  accepted_cents integer NOT NULL CHECK (accepted_cents >= 0),
  rejected_cents integer NOT NULL CHECK (rejected_cents >= 0),
  CONSTRAINT claim_decision_lines_amounts_ck CHECK (accepted_cents + rejected_cents > 0),
  CONSTRAINT claim_decision_lines_source_uq UNIQUE (tenant_id, decision_id, claim_line_id),
  CONSTRAINT claim_decision_lines_decision_fk FOREIGN KEY (tenant_id, decision_id)
    REFERENCES billing.claim_decisions (tenant_id, id),
  CONSTRAINT claim_decision_lines_claim_line_fk FOREIGN KEY (tenant_id, claim_line_id)
    REFERENCES billing.claim_lines (tenant_id, id)
);

CREATE TABLE billing.claim_package_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  package_version integer NOT NULL CHECK (package_version > 0),
  document_kind text NOT NULL CHECK (document_kind IN ('invoice_pdf', 'evidence_pdf', 'mandate_pdf', 'claim_summary')),
  invoice_id uuid NOT NULL,
  invoice_document_id uuid,
  document_artifact_id uuid,
  file_name text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  source_version text NOT NULL CHECK (length(trim(source_version)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_package_documents_source_ck CHECK (
    (document_kind = 'invoice_pdf' AND invoice_document_id IS NOT NULL AND document_artifact_id IS NULL)
    OR (document_kind <> 'invoice_pdf' AND invoice_document_id IS NULL AND document_artifact_id IS NOT NULL)
  ),
  CONSTRAINT claim_package_documents_claim_fk FOREIGN KEY (tenant_id, claim_id, invoice_id)
    REFERENCES billing.claims (tenant_id, id, invoice_id),
  CONSTRAINT claim_package_documents_invoice_document_fk FOREIGN KEY (tenant_id, invoice_id, invoice_document_id)
    REFERENCES billing.invoice_documents (tenant_id, invoice_id, id),
  CONSTRAINT claim_package_documents_artifact_fk FOREIGN KEY (tenant_id, document_artifact_id)
    REFERENCES documents.artifacts (tenant_id, id),
  CONSTRAINT claim_package_documents_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT claim_package_documents_claim_source_uq UNIQUE (tenant_id, claim_id, package_version, document_kind, file_name)
);
CREATE INDEX claim_package_documents_claim_idx
  ON billing.claim_package_documents (tenant_id, claim_id, package_version);

ALTER TABLE billing.payment_allocations ADD COLUMN claim_id uuid;
ALTER TABLE billing.payment_allocations
  ADD CONSTRAINT payment_allocations_claim_invoice_fk
  FOREIGN KEY (tenant_id, claim_id, invoice_id)
  REFERENCES billing.claims (tenant_id, id, invoice_id);
CREATE INDEX payment_allocations_claim_idx
  ON billing.payment_allocations (tenant_id, claim_id, created_at);

CREATE FUNCTION billing.reject_claim_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Claim history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER claim_lines_append_only
  BEFORE UPDATE OR DELETE ON billing.claim_lines
  FOR EACH ROW EXECUTE FUNCTION billing.reject_claim_history_mutation();
CREATE TRIGGER claim_submissions_append_only
  BEFORE UPDATE OR DELETE ON billing.claim_submissions
  FOR EACH ROW EXECUTE FUNCTION billing.reject_claim_history_mutation();
CREATE TRIGGER claim_decisions_append_only
  BEFORE UPDATE OR DELETE ON billing.claim_decisions
  FOR EACH ROW EXECUTE FUNCTION billing.reject_claim_history_mutation();
CREATE TRIGGER claim_decision_lines_append_only
  BEFORE UPDATE OR DELETE ON billing.claim_decision_lines
  FOR EACH ROW EXECUTE FUNCTION billing.reject_claim_history_mutation();
CREATE TRIGGER claim_package_documents_append_only
  BEFORE UPDATE OR DELETE ON billing.claim_package_documents
  FOR EACH ROW EXECUTE FUNCTION billing.reject_claim_history_mutation();
CREATE TRIGGER payer_billing_profiles_append_only
  BEFORE UPDATE OR DELETE ON billing.payer_billing_profiles
  FOR EACH ROW EXECUTE FUNCTION billing.reject_claim_history_mutation();

CREATE FUNCTION billing.guard_claim_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Claims are retained as financial history' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.tenant_id, NEW.organization_id, NEW.facility_id, NEW.client_id, NEW.invoice_id,
         NEW.payer_id, NEW.payer_arrangement_id, NEW.payer_billing_profile_id, NEW.arrangement_type,
         NEW.channel, NEW.funding_source_type, NEW.currency, NEW.amount_cents, NEW.invoice_version,
         NEW.invoice_snapshot, NEW.payer_snapshot, NEW.arrangement_snapshot, NEW.profile_snapshot,
         NEW.snapshot_hash, NEW.supersedes_claim_id, NEW.resubmission_of_submission_id, NEW.created_by,
         NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.organization_id, OLD.facility_id, OLD.client_id, OLD.invoice_id,
         OLD.payer_id, OLD.payer_arrangement_id, OLD.payer_billing_profile_id, OLD.arrangement_type,
         OLD.channel, OLD.funding_source_type, OLD.currency, OLD.amount_cents, OLD.invoice_version,
         OLD.invoice_snapshot, OLD.payer_snapshot, OLD.arrangement_snapshot, OLD.profile_snapshot,
         OLD.snapshot_hash, OLD.supersedes_claim_id, OLD.resubmission_of_submission_id, OLD.created_by,
         OLD.created_at) THEN
    RAISE EXCEPTION 'Claim snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.package_version > 0 AND ROW(NEW.package_version, NEW.package_hash, NEW.prepared_at)
     IS DISTINCT FROM ROW(OLD.package_version, OLD.package_hash, OLD.prepared_at) THEN
    RAISE EXCEPTION 'Prepared claim packages are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Claim version must advance exactly once' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('ready', 'cancelled'))
    OR (OLD.status = 'ready' AND NEW.status IN ('submitted', 'cancelled'))
    OR (OLD.status = 'submitted' AND NEW.status IN ('accepted', 'partially_accepted', 'rejected', 'clarification_required'))
    OR (OLD.status IN ('partially_accepted', 'rejected', 'clarification_required') AND NEW.status = 'resubmitted')
  ) THEN
    RAISE EXCEPTION 'Invalid claim lifecycle transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER claims_lifecycle_guard
  BEFORE UPDATE OR DELETE ON billing.claims
  FOR EACH ROW EXECUTE FUNCTION billing.guard_claim_mutation();

CREATE FUNCTION billing.guard_claim_line_insert() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing.claims c
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.claim_id AND c.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Claim lines can only be added to drafts' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER claim_lines_draft_only
  BEFORE INSERT ON billing.claim_lines
  FOR EACH ROW EXECUTE FUNCTION billing.guard_claim_line_insert();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'payers', 'payer_billing_profiles', 'claims', 'claim_lines', 'claim_submissions',
    'claim_decisions', 'claim_decision_lines', 'claim_package_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE billing.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE billing.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON billing.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      'billing_' || table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON billing.payers TO care_app;
GRANT SELECT, INSERT ON billing.payer_billing_profiles TO care_app;
GRANT SELECT, INSERT, UPDATE ON billing.claims TO care_app;
GRANT SELECT, INSERT ON
  billing.claim_lines, billing.claim_submissions, billing.claim_decisions,
  billing.claim_decision_lines, billing.claim_package_documents
TO care_app;
