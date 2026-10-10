CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE billing.profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  tax_number text,
  vat_id text,
  creditor_identifier text,
  bank_account_holder text,
  iban text,
  bic text,
  payment_terms_days integer NOT NULL CHECK (payment_terms_days BETWEEN 0 AND 180),
  invoice_number_prefix text NOT NULL CHECK (length(invoice_number_prefix) <= 24 AND invoice_number_prefix !~ '[^A-Za-z0-9/-]'),
  default_currency text NOT NULL CHECK (default_currency = 'EUR'),
  tax_treatment text NOT NULL CHECK (tax_treatment IN ('taxable', 'tax_exempt', 'small_business')),
  tax_rate_basis_points integer,
  tax_exemption_basis text,
  require_acknowledgement boolean NOT NULL DEFAULT false,
  required_invoice_format text NOT NULL DEFAULT 'pdf' CHECK (required_invoice_format IN ('pdf', 'structured')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_profiles_tax_ck CHECK (
    (tax_treatment = 'taxable' AND tax_rate_basis_points BETWEEN 1 AND 10000 AND tax_exemption_basis IS NULL)
    OR (tax_treatment IN ('tax_exempt', 'small_business') AND tax_rate_basis_points IS NULL AND length(trim(coalesce(tax_exemption_basis, ''))) BETWEEN 1 AND 300)
  ),
  CONSTRAINT billing_profiles_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT billing_profiles_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT billing_profiles_tenant_organization_uq UNIQUE (tenant_id, organization_id)
);

CREATE TABLE billing.payer_arrangements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  funding_source_id uuid,
  client_insurance_id uuid,
  payer_type text NOT NULL CHECK (payer_type IN ('statutory_insurance', 'private_insurance', 'other')),
  payer_reference text,
  arrangement_type text NOT NULL CHECK (arrangement_type IN ('direct_payer_billing', 'reimbursement_to_client', 'other')),
  recipient_type text NOT NULL CHECK (recipient_type IN ('client', 'insurance', 'contact', 'other')),
  recipient_name text,
  recipient_address text,
  mandate_status text NOT NULL CHECK (mandate_status IN ('authorized', 'pending', 'revoked', 'not_applicable')),
  documented_source text,
  documented_reference text,
  valid_from date NOT NULL,
  valid_until date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_arrangements_validity_ck CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT payer_arrangements_mandate_ck CHECK (
    arrangement_type <> 'direct_payer_billing'
    OR mandate_status <> 'authorized'
    OR (length(trim(coalesce(documented_source, ''))) > 0
        AND length(trim(coalesce(documented_reference, ''))) > 0 AND recipient_type <> 'client')
  ),
  CONSTRAINT payer_arrangements_recipient_ck CHECK (
    (recipient_type = 'client' AND recipient_name IS NULL AND recipient_address IS NULL)
    OR (recipient_type <> 'client' AND length(trim(coalesce(recipient_name, ''))) BETWEEN 1 AND 200
        AND length(trim(coalesce(recipient_address, ''))) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT payer_arrangements_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT payer_arrangements_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT payer_arrangements_funding_source_fk FOREIGN KEY (tenant_id, client_id, funding_source_id)
    REFERENCES benefits.funding_sources (tenant_id, client_id, id),
  CONSTRAINT payer_arrangements_insurance_fk FOREIGN KEY (tenant_id, client_id, client_insurance_id)
    REFERENCES clients.client_insurances (tenant_id, client_id, id),
  CONSTRAINT payer_arrangements_tenant_id_uq UNIQUE (tenant_id, id)
);

CREATE INDEX payer_arrangements_client_validity_idx
  ON billing.payer_arrangements (tenant_id, organization_id, client_id, valid_from, valid_until);
CREATE INDEX payer_arrangements_funding_source_idx
  ON billing.payer_arrangements (tenant_id, client_id, funding_source_id, valid_from, valid_until);

CREATE TABLE billing.invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  client_id uuid NOT NULL,
  payer_arrangement_id uuid,
  recipient_type text NOT NULL CHECK (recipient_type IN ('client', 'payer')),
  recipient_snapshot jsonb,
  issuer_snapshot jsonb,
  invoice_number text,
  issue_date date,
  service_period_from date,
  service_period_until date,
  due_date date,
  currency text NOT NULL CHECK (currency = 'EUR'),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_total_cents integer NOT NULL DEFAULT 0 CHECK (tax_total_cents >= 0),
  grand_total_cents integer NOT NULL DEFAULT 0 CHECK (grand_total_cents >= 0),
  status text NOT NULL CHECK (status IN ('draft', 'issued', 'cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  issued_by uuid,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_amounts_ck CHECK (grand_total_cents = subtotal_cents + tax_total_cents),
  CONSTRAINT invoices_lifecycle_ck CHECK (
    (status = 'draft' AND invoice_number IS NULL AND issued_at IS NULL AND issued_by IS NULL)
    OR (status = 'issued' AND invoice_number IS NOT NULL AND issue_date IS NOT NULL AND due_date IS NOT NULL
        AND issuer_snapshot IS NOT NULL AND recipient_snapshot IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL)
    OR (status = 'cancelled' AND invoice_number IS NULL AND issued_at IS NULL AND issued_by IS NULL)
  ),
  CONSTRAINT invoices_recipient_ck CHECK (
    (recipient_type = 'client' AND payer_arrangement_id IS NULL)
    OR (recipient_type = 'payer' AND payer_arrangement_id IS NOT NULL)
  ),
  CONSTRAINT invoices_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT invoices_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  CONSTRAINT invoices_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT invoices_payer_arrangement_fk FOREIGN KEY (tenant_id, payer_arrangement_id)
    REFERENCES billing.payer_arrangements (tenant_id, id),
  CONSTRAINT invoices_tenant_id_uq UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX invoices_provider_number_uq
  ON billing.invoices (tenant_id, organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX invoices_status_created_idx
  ON billing.invoices (tenant_id, organization_id, status, created_at);
CREATE INDEX invoices_client_service_period_idx
  ON billing.invoices (tenant_id, client_id, service_period_from);
CREATE INDEX invoices_due_date_idx
  ON billing.invoices (tenant_id, organization_id, due_date);

CREATE TABLE billing.invoice_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  performed_service_id uuid NOT NULL,
  funding_allocation_id uuid,
  service_price_id uuid,
  evidence_package_id uuid NOT NULL,
  evidence_snapshot_hash text NOT NULL CHECK (evidence_snapshot_hash ~ '^[a-f0-9]{64}$'),
  source_key text NOT NULL,
  service_code_snapshot text NOT NULL,
  service_name_snapshot text NOT NULL,
  service_date date NOT NULL,
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (unit IN ('occurrence', 'minute', 'hour', 'day')),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  service_amount_cents integer NOT NULL CHECK (service_amount_cents > 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  tax_treatment text NOT NULL CHECK (tax_treatment IN ('taxable', 'tax_exempt', 'small_business')),
  tax_rate_basis_points integer NOT NULL CHECK (tax_rate_basis_points BETWEEN 0 AND 10000),
  net_cents integer NOT NULL CHECK (net_cents >= 0),
  tax_cents integer NOT NULL CHECK (tax_cents >= 0),
  gross_cents integer NOT NULL CHECK (gross_cents = net_cents + tax_cents AND gross_cents = amount_cents),
  tax_exemption_basis text,
  funding_label_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_lines_source_ck CHECK (
    (funding_allocation_id IS NULL AND source_key = 'self-pay')
    OR (funding_allocation_id IS NOT NULL AND source_key = 'allocation:' || funding_allocation_id::text)
  ),
  CONSTRAINT invoice_lines_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing.invoices (tenant_id, id),
  CONSTRAINT invoice_lines_performed_service_fk FOREIGN KEY (tenant_id, performed_service_id)
    REFERENCES visit_execution.performed_services (tenant_id, id),
  CONSTRAINT invoice_lines_allocation_fk FOREIGN KEY (tenant_id, funding_allocation_id)
    REFERENCES benefits.service_allocations (tenant_id, id),
  CONSTRAINT invoice_lines_price_fk FOREIGN KEY (tenant_id, service_price_id)
    REFERENCES services.service_prices (tenant_id, id),
  CONSTRAINT invoice_lines_evidence_package_fk FOREIGN KEY (tenant_id, evidence_package_id)
    REFERENCES service_evidence.evidence_packages (tenant_id, id),
  CONSTRAINT invoice_lines_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT invoice_lines_invoice_source_uq UNIQUE (tenant_id, invoice_id, source_key)
);

CREATE INDEX invoice_lines_service_idx ON billing.invoice_lines (tenant_id, performed_service_id, invoice_id);
CREATE INDEX invoice_lines_allocation_idx ON billing.invoice_lines (tenant_id, funding_allocation_id);

CREATE TABLE billing.invoice_number_sequences (
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  calendar_year integer NOT NULL CHECK (calendar_year BETWEEN 2000 AND 9999),
  next_sequence integer NOT NULL CHECK (next_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, organization_id, calendar_year),
  CONSTRAINT invoice_number_sequences_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id)
);

CREATE TABLE billing.invoice_numbers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  calendar_year integer NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  invoice_number text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_numbers_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing.invoices (tenant_id, id),
  CONSTRAINT invoice_numbers_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT invoice_numbers_invoice_uq UNIQUE (tenant_id, invoice_id),
  CONSTRAINT invoice_numbers_provider_number_uq UNIQUE (tenant_id, organization_id, invoice_number),
  CONSTRAINT invoice_numbers_provider_sequence_uq UNIQUE (tenant_id, organization_id, calendar_year, sequence_number),
  CONSTRAINT invoice_numbers_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id)
);

CREATE TABLE billing.invoice_corrections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  correction_number text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_corrections_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing.invoices (tenant_id, id),
  CONSTRAINT invoice_corrections_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT invoice_corrections_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT invoice_corrections_number_uq UNIQUE (tenant_id, organization_id, correction_number)
);
CREATE INDEX invoice_corrections_invoice_idx ON billing.invoice_corrections (tenant_id, invoice_id, created_at);

CREATE TABLE billing.invoice_correction_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  correction_id uuid NOT NULL,
  invoice_line_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_correction_lines_correction_fk FOREIGN KEY (tenant_id, correction_id)
    REFERENCES billing.invoice_corrections (tenant_id, id),
  CONSTRAINT invoice_correction_lines_invoice_line_fk FOREIGN KEY (tenant_id, invoice_line_id)
    REFERENCES billing.invoice_lines (tenant_id, id),
  CONSTRAINT invoice_correction_lines_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT invoice_correction_lines_source_uq UNIQUE (tenant_id, correction_id, invoice_line_id)
);

CREATE TABLE billing.invoice_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  correction_id uuid,
  document_version integer NOT NULL CHECK (document_version > 0),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  object_key text,
  sha256 text,
  failure_code text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_documents_artifact_ck CHECK (
    (status = 'ready' AND object_key LIKE 'billing/invoices/%' AND sha256 ~ '^[a-f0-9]{64}$' AND generated_at IS NOT NULL)
    OR (status <> 'ready' AND sha256 IS NULL)
  ),
  CONSTRAINT invoice_documents_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing.invoices (tenant_id, id),
  CONSTRAINT invoice_documents_correction_fk FOREIGN KEY (tenant_id, correction_id)
    REFERENCES billing.invoice_corrections (tenant_id, id),
  CONSTRAINT invoice_documents_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT invoice_documents_invoice_version_uq UNIQUE (tenant_id, invoice_id, document_version)
);
CREATE INDEX invoice_documents_invoice_status_idx ON billing.invoice_documents (tenant_id, invoice_id, status, document_version);

CREATE TABLE billing.payments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  payer_reference text,
  payer_name_snapshot text,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'EUR'),
  received_at timestamptz NOT NULL,
  method text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 500),
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT payments_tenant_id_uq UNIQUE (tenant_id, id)
);
CREATE INDEX payments_provider_received_idx ON billing.payments (tenant_id, organization_id, received_at);

CREATE TABLE billing.payment_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocations_payment_fk FOREIGN KEY (tenant_id, payment_id)
    REFERENCES billing.payments (tenant_id, id),
  CONSTRAINT payment_allocations_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES billing.invoices (tenant_id, id),
  CONSTRAINT payment_allocations_tenant_id_uq UNIQUE (tenant_id, id)
);
CREATE INDEX payment_allocations_payment_idx ON billing.payment_allocations (tenant_id, payment_id);
CREATE INDEX payment_allocations_invoice_idx ON billing.payment_allocations (tenant_id, invoice_id);

CREATE TABLE billing.payment_reversals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  reversed_by uuid NOT NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reversals_allocation_fk FOREIGN KEY (tenant_id, allocation_id)
    REFERENCES billing.payment_allocations (tenant_id, id),
  CONSTRAINT payment_reversals_allocation_uq UNIQUE (tenant_id, allocation_id)
);

CREATE FUNCTION billing.reject_issued_invoice_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Issued invoice snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_issued_immutable
  BEFORE UPDATE OR DELETE ON billing.invoices
  FOR EACH ROW EXECUTE FUNCTION billing.reject_issued_invoice_mutation();

CREATE FUNCTION billing.guard_invoice_line_mutation() RETURNS trigger AS $$
DECLARE
  target_tenant uuid;
  target_invoice uuid;
  invoice_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_invoice := OLD.invoice_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_invoice := NEW.invoice_id;
  END IF;
  SELECT status INTO invoice_status FROM billing.invoices
    WHERE tenant_id = target_tenant AND id = target_invoice FOR UPDATE;
  IF invoice_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Invoice lines may only be changed on drafts' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_lines_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION billing.guard_invoice_line_mutation();

CREATE FUNCTION billing.reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Financial history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_numbers_append_only
  BEFORE UPDATE OR DELETE ON billing.invoice_numbers
  FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();
CREATE TRIGGER invoice_corrections_append_only
  BEFORE UPDATE OR DELETE ON billing.invoice_corrections
  FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();
CREATE TRIGGER invoice_correction_lines_append_only
  BEFORE UPDATE OR DELETE ON billing.invoice_correction_lines
  FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();
CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON billing.payments
  FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();
CREATE TRIGGER payment_allocations_append_only
  BEFORE UPDATE OR DELETE ON billing.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();
CREATE TRIGGER payment_reversals_append_only
  BEFORE UPDATE OR DELETE ON billing.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'payer_arrangements', 'invoices', 'invoice_lines',
    'invoice_number_sequences', 'invoice_numbers', 'invoice_corrections',
    'invoice_correction_lines',
    'invoice_documents', 'payments', 'payment_allocations', 'payment_reversals'
  ] LOOP
    EXECUTE format('ALTER TABLE billing.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE billing.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON billing.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      'billing_' || table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA billing TO care_app;
GRANT SELECT, INSERT, UPDATE ON
  billing.profiles,
  billing.payer_arrangements,
  billing.invoices,
  billing.invoice_number_sequences,
  billing.invoice_documents
TO care_app;
-- Allocation locks payment rows with SELECT FOR UPDATE; the append-only trigger rejects mutations.
GRANT SELECT, INSERT, UPDATE ON billing.payments TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON billing.invoice_lines TO care_app;
GRANT SELECT, INSERT ON
  billing.invoice_numbers,
  billing.invoice_corrections,
  billing.invoice_correction_lines,
  billing.payment_allocations,
  billing.payment_reversals
TO care_app;
