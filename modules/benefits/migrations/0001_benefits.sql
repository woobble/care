CREATE SCHEMA IF NOT EXISTS benefits;

CREATE TABLE benefits.definitions (
  id text PRIMARY KEY,
  benefit_type text NOT NULL UNIQUE CHECK (benefit_type IN (
    'entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'
  )),
  name text NOT NULL,
  statutory_reference text
);

CREATE TABLE benefits.rule_versions (
  id uuid PRIMARY KEY,
  benefit_type text NOT NULL CHECK (benefit_type IN ('entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4')),
  jurisdiction text NOT NULL,
  effective_from date NOT NULL CHECK (extract(day from effective_from) = 1),
  effective_until date,
  monthly_amount_cents integer CHECK (monthly_amount_cents IS NULL OR monthly_amount_cents >= 0),
  annual_amount_cents integer CHECK (annual_amount_cents IS NULL OR annual_amount_cents >= 0),
  eligible_care_grades smallint[] NOT NULL CHECK (cardinality(eligible_care_grades) > 0),
  carryover_policy text NOT NULL CHECK (carryover_policy IN ('calendar_year_june_30', 'none')),
  eligibility_requirements text NOT NULL,
  rule_version integer NOT NULL CHECK (rule_version > 0),
  source_reference text NOT NULL,
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE (benefit_type, jurisdiction, effective_from, rule_version)
);

CREATE INDEX benefit_rule_versions_effective_idx
  ON benefits.rule_versions (benefit_type, jurisdiction, effective_from, effective_until);

INSERT INTO benefits.definitions (id, benefit_type, name, statutory_reference) VALUES
  ('entlastungsbetrag_45b', 'entlastungsbetrag_45b', 'Entlastungsbetrag', '§ 45b SGB XI'),
  ('umwandlungsanspruch_45a_4', 'umwandlungsanspruch_45a_4', 'Umwandlungsanspruch', '§ 45a Abs. 4 SGB XI'),
  ('private', 'private', 'Private payment', NULL),
  ('other', 'other', 'Other funding', NULL);

INSERT INTO benefits.rule_versions (
  id, benefit_type, jurisdiction, effective_from, monthly_amount_cents,
  eligible_care_grades, carryover_policy, eligibility_requirements, rule_version,
  source_reference
) VALUES
  (
    '019b7d8e-0000-7000-8000-0000000000b5',
    'entlastungsbetrag_45b', 'DE', '2025-01-01', 13100,
    ARRAY[1, 2, 3, 4, 5]::smallint[], 'calendar_year_june_30',
    'Confirmed Pflegegrad 1–5 on the service date; provider and service must be recognized for the applicable jurisdiction.',
    1,
    '§ 45b SGB XI https://www.gesetze-im-internet.de/sgb_11/__45b.html; BMG benefits guidance https://www.bundesgesundheitsministerium.de/leistungen-der-pflege.html'
  ),
  (
    '019b7d8e-0000-7000-8000-000000000045',
    'umwandlungsanspruch_45a_4', 'DE', '2025-01-01', NULL,
    ARRAY[2, 3, 4, 5]::smallint[], 'none',
    'Pflegegrad 2–5 and explicit external information about remaining ambulatory in-kind benefits; this rule does not calculate available funding.',
    1,
    '§ 45a Abs. 4 SGB XI https://www.gesetze-im-internet.de/sgb_11/__45a.html; BMG benefits guidance https://www.bundesgesundheitsministerium.de/leistungen-der-pflege.html'
  );

CREATE TABLE benefits.funding_sources (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'statutory_long_term_care_insurance', 'private_long_term_care_insurance', 'self_pay', 'other'
  )),
  client_insurance_id uuid,
  label text CHECK (label IS NULL OR length(trim(label)) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (source_type IN ('statutory_long_term_care_insurance', 'private_long_term_care_insurance') AND client_insurance_id IS NOT NULL)
    OR (source_type IN ('self_pay', 'other') AND client_insurance_id IS NULL)
  ),
  CONSTRAINT benefit_funding_sources_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT benefit_funding_sources_insurance_fk FOREIGN KEY (tenant_id, client_id, client_insurance_id)
    REFERENCES clients.client_insurances (tenant_id, client_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, client_id, id)
);

CREATE INDEX benefit_funding_sources_client_idx
  ON benefits.funding_sources (tenant_id, client_id, status);

CREATE TABLE benefits.client_entitlements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  benefit_type text NOT NULL CHECK (benefit_type IN (
    'entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'
  )),
  funding_source_id uuid NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL CHECK (status IN ('confirmed', 'provisional', 'suspended', 'ended')),
  calculation_mode text NOT NULL CHECK (calculation_mode IN ('rule_based', 'manual', 'external_input')),
  source text NOT NULL CHECK (source IN ('payer_confirmed', 'client_reported', 'provider_reported', 'contract')),
  verified_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT client_benefit_entitlements_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT client_benefit_entitlements_funding_source_fk FOREIGN KEY (tenant_id, client_id, funding_source_id)
    REFERENCES benefits.funding_sources (tenant_id, client_id, id),
  CONSTRAINT client_benefit_entitlements_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    client_id WITH =,
    benefit_type WITH =,
    daterange(valid_from, valid_until, '[]') WITH &&
  ) WHERE (status IN ('confirmed', 'provisional', 'suspended')),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, client_id, id)
);

CREATE INDEX client_benefit_entitlements_client_validity_idx
  ON benefits.client_entitlements (tenant_id, client_id, benefit_type, valid_from, valid_until);

CREATE TABLE benefits.allocation_buckets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  funding_source_id uuid NOT NULL,
  entitlement_id uuid,
  benefit_type text NOT NULL CHECK (benefit_type IN (
    'entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'
  )),
  origin_period date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  expires_at date,
  bucket_type text NOT NULL CHECK (bucket_type IN (
    'monthly_entitlement', 'opening_balance', 'manual_adjustment', 'external_input'
  )),
  verification_status text NOT NULL CHECK (verification_status IN (
    'estimated', 'client_reported', 'provider_reported', 'payer_confirmed'
  )),
  source_reference text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (bucket_type <> 'monthly_entitlement' OR extract(day from origin_period) = 1),
  CONSTRAINT benefit_allocation_buckets_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT benefit_allocation_buckets_funding_source_fk FOREIGN KEY (tenant_id, client_id, funding_source_id)
    REFERENCES benefits.funding_sources (tenant_id, client_id, id),
  CONSTRAINT benefit_allocation_buckets_entitlement_fk FOREIGN KEY (tenant_id, client_id, entitlement_id)
    REFERENCES benefits.client_entitlements (tenant_id, client_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_reference)
);

CREATE INDEX benefit_allocation_buckets_client_expiry_idx
  ON benefits.allocation_buckets (tenant_id, client_id, expires_at, origin_period);

CREATE TABLE benefits.service_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  performed_service_id uuid NOT NULL,
  funding_source_id uuid NOT NULL,
  entitlement_id uuid,
  service_price_id uuid,
  idempotency_key uuid NOT NULL,
  service_amount_cents integer NOT NULL CHECK (service_amount_cents > 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0 AND amount_cents <= service_amount_cents),
  price_cents_snapshot integer,
  pricing_unit_snapshot text CHECK (pricing_unit_snapshot IS NULL OR pricing_unit_snapshot IN ('hour', 'minute', 'visit', 'fixed')),
  actual_quantity_snapshot text,
  status text NOT NULL CHECK (status IN ('provisional', 'confirmed')),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT service_allocations_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT service_allocations_performed_service_fk FOREIGN KEY (tenant_id, performed_service_id)
    REFERENCES visit_execution.performed_services (tenant_id, id),
  CONSTRAINT service_allocations_funding_source_fk FOREIGN KEY (tenant_id, client_id, funding_source_id)
    REFERENCES benefits.funding_sources (tenant_id, client_id, id),
  CONSTRAINT service_allocations_entitlement_fk FOREIGN KEY (tenant_id, client_id, entitlement_id)
    REFERENCES benefits.client_entitlements (tenant_id, client_id, id),
  CONSTRAINT service_allocations_price_fk FOREIGN KEY (tenant_id, service_price_id)
    REFERENCES services.service_prices (tenant_id, id),
  UNIQUE (tenant_id, id),
  CONSTRAINT service_allocations_idempotency_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX service_allocations_performed_service_idx
  ON benefits.service_allocations (tenant_id, performed_service_id, recorded_at);
CREATE INDEX service_allocations_client_date_idx
  ON benefits.service_allocations (tenant_id, client_id, recorded_at);

CREATE TABLE benefits.ledger_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  funding_source_id uuid NOT NULL,
  allocation_bucket_id uuid,
  service_allocation_id uuid,
  performed_service_id uuid,
  entry_type text NOT NULL CHECK (entry_type IN (
    'entitlement_allocated', 'opening_balance_adjusted', 'external_consumption_recorded',
    'service_consumption_allocated', 'service_consumption_reversed', 'manual_adjustment', 'benefit_expired'
  )),
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  effective_date date NOT NULL,
  source_type text NOT NULL,
  reference text,
  source_reference text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN (
    'estimated', 'client_reported', 'provider_reported', 'payer_confirmed'
  )),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT benefit_ledger_entries_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT benefit_ledger_entries_funding_source_fk FOREIGN KEY (tenant_id, client_id, funding_source_id)
    REFERENCES benefits.funding_sources (tenant_id, client_id, id),
  CONSTRAINT benefit_ledger_entries_bucket_fk FOREIGN KEY (tenant_id, allocation_bucket_id)
    REFERENCES benefits.allocation_buckets (tenant_id, id),
  CONSTRAINT benefit_ledger_entries_allocation_fk FOREIGN KEY (tenant_id, service_allocation_id)
    REFERENCES benefits.service_allocations (tenant_id, id),
  CONSTRAINT benefit_ledger_entries_performed_service_fk FOREIGN KEY (tenant_id, performed_service_id)
    REFERENCES visit_execution.performed_services (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_reference)
);

CREATE INDEX benefit_ledger_entries_client_history_idx
  ON benefits.ledger_entries (tenant_id, client_id, effective_date, recorded_at);
CREATE INDEX benefit_ledger_entries_bucket_idx
  ON benefits.ledger_entries (tenant_id, allocation_bucket_id, effective_date);

CREATE TABLE benefits.service_allocation_reversals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  idempotency_key uuid NOT NULL,
  reversed_by uuid NOT NULL,
  reversed_at timestamptz NOT NULL,
  CONSTRAINT service_allocation_reversals_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT service_allocation_reversals_allocation_fk FOREIGN KEY (tenant_id, allocation_id)
    REFERENCES benefits.service_allocations (tenant_id, id),
  UNIQUE (tenant_id, id),
  CONSTRAINT service_allocation_reversals_allocation_uq UNIQUE (tenant_id, allocation_id),
  CONSTRAINT service_allocation_reversals_idempotency_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE benefits.provider_recognitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  recognized_offering text NOT NULL,
  jurisdiction text NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  reference text,
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT provider_recognitions_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE INDEX provider_recognitions_validity_idx
  ON benefits.provider_recognitions (tenant_id, organization_id, jurisdiction, status, valid_from, valid_until);

CREATE FUNCTION benefits.reject_immutable_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'benefit history is append-only'
    USING ERRCODE = '55000', CONSTRAINT = 'benefit_history_immutable';
END;
$$;

CREATE TRIGGER benefit_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON benefits.rule_versions
  FOR EACH ROW EXECUTE FUNCTION benefits.reject_immutable_fact_mutation();
CREATE TRIGGER benefit_allocation_buckets_immutable
  BEFORE UPDATE OR DELETE ON benefits.allocation_buckets
  FOR EACH ROW EXECUTE FUNCTION benefits.reject_immutable_fact_mutation();
CREATE TRIGGER benefit_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON benefits.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION benefits.reject_immutable_fact_mutation();
CREATE TRIGGER service_allocations_immutable
  BEFORE UPDATE OR DELETE ON benefits.service_allocations
  FOR EACH ROW EXECUTE FUNCTION benefits.reject_immutable_fact_mutation();
CREATE TRIGGER service_allocation_reversals_immutable
  BEFORE UPDATE OR DELETE ON benefits.service_allocation_reversals
  FOR EACH ROW EXECUTE FUNCTION benefits.reject_immutable_fact_mutation();

ALTER TABLE benefits.funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.funding_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY benefit_funding_sources_tenant_isolation ON benefits.funding_sources
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE benefits.client_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.client_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY client_benefit_entitlements_tenant_isolation ON benefits.client_entitlements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE benefits.allocation_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.allocation_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY benefit_allocation_buckets_tenant_isolation ON benefits.allocation_buckets
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE benefits.service_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.service_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY service_allocations_tenant_isolation ON benefits.service_allocations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE benefits.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY benefit_ledger_entries_tenant_isolation ON benefits.ledger_entries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE benefits.service_allocation_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.service_allocation_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY service_allocation_reversals_tenant_isolation ON benefits.service_allocation_reversals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE benefits.provider_recognitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits.provider_recognitions FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_recognitions_tenant_isolation ON benefits.provider_recognitions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA benefits TO care_app;
GRANT SELECT ON benefits.definitions, benefits.rule_versions TO care_app;
GRANT SELECT, INSERT, UPDATE ON benefits.funding_sources, benefits.client_entitlements,
  benefits.provider_recognitions TO care_app;
GRANT SELECT, INSERT ON benefits.allocation_buckets, benefits.service_allocations,
  benefits.ledger_entries, benefits.service_allocation_reversals TO care_app;
