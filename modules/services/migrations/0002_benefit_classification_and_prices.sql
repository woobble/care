CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE services.service_definitions
  ADD COLUMN benefit_category text NOT NULL DEFAULT 'other'
    CHECK (benefit_category IN ('recognized_support', 'clinical_nursing', 'other'));

CREATE TABLE services.service_prices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  pricing_unit text NOT NULL CHECK (pricing_unit IN ('hour', 'minute', 'visit', 'fixed')),
  valid_from date NOT NULL,
  valid_until date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT service_prices_validity_ck CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT service_prices_service_fk FOREIGN KEY (tenant_id, service_id)
    REFERENCES services.service_definitions (tenant_id, id),
  CONSTRAINT service_prices_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT service_prices_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  CONSTRAINT service_prices_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    service_id WITH =,
    organization_id WITH =,
    (coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(valid_from, valid_until, '[)') WITH &&
  )
);

CREATE UNIQUE INDEX service_prices_tenant_id_uq ON services.service_prices (tenant_id, id);
CREATE INDEX service_prices_lookup_idx ON services.service_prices (
  tenant_id, service_id, organization_id, facility_id, valid_from, valid_until
);

ALTER TABLE services.service_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE services.service_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY service_prices_tenant_isolation ON services.service_prices
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON services.service_prices TO care_app;
