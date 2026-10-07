-- Existing client rows keep their null provider context. The insert trigger makes the
-- context mandatory for all new records while the API exposes an explicit assignment command.
ALTER TABLE clients.clients
  ADD COLUMN organization_id uuid,
  ADD COLUMN primary_facility_id uuid,
  ADD COLUMN date_of_death date,
  ADD COLUMN gender text CHECK (gender IS NULL OR gender IN ('female', 'male', 'diverse')),
  ADD COLUMN salutation text CHECK (salutation IS NULL OR salutation IN ('mr', 'ms', 'mx', 'other')),
  ADD COLUMN mobile text,
  ADD CONSTRAINT clients_provider_context_pair_ck CHECK (
    (organization_id IS NULL AND primary_facility_id IS NULL)
    OR (organization_id IS NOT NULL AND primary_facility_id IS NOT NULL)
  ),
  ADD CONSTRAINT clients_tenant_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  ADD CONSTRAINT clients_tenant_organization_facility_fk
    FOREIGN KEY (tenant_id, organization_id, primary_facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  ADD CONSTRAINT clients_dates_ck CHECK (
    date_of_birth IS NULL OR date_of_death IS NULL OR date_of_death >= date_of_birth
  );

CREATE FUNCTION clients.require_provider_context_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.organization_id IS NULL OR NEW.primary_facility_id IS NULL) THEN
    RAISE EXCEPTION 'new clients require organization and primary facility'
      USING ERRCODE = '23514', CONSTRAINT = 'clients_provider_context_required';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL AND NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'assigned client provider context cannot be cleared'
      USING ERRCODE = '23514', CONSTRAINT = 'clients_provider_context_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_provider_context_required
  BEFORE INSERT OR UPDATE ON clients.clients
  FOR EACH ROW EXECUTE FUNCTION clients.require_provider_context_on_insert();

CREATE INDEX clients_tenant_organization_status_idx
  ON clients.clients (tenant_id, organization_id, status, last_name, first_name, id);
CREATE INDEX clients_tenant_facility_status_idx
  ON clients.clients (tenant_id, primary_facility_id, status, last_name, first_name, id);
CREATE INDEX clients_preferred_name_trgm_idx
  ON clients.clients USING gin (preferred_name gin_trgm_ops);

CREATE TABLE clients.client_addresses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  address_type text NOT NULL CHECK (address_type IN ('home', 'billing', 'other')),
  street text NOT NULL CHECK (length(trim(street)) > 0),
  house_number text,
  address_addition text,
  postal_code text,
  city text NOT NULL CHECK (length(trim(city)) > 0),
  country_code text NOT NULL DEFAULT 'DE' CHECK (country_code ~ '^[A-Z]{2}$'),
  valid_from date,
  valid_until date,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT client_addresses_validity_ck CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT client_addresses_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT client_addresses_tenant_client_id_uq UNIQUE (tenant_id, client_id, id)
);

CREATE UNIQUE INDEX client_addresses_one_primary_uq
  ON clients.client_addresses (tenant_id, client_id) WHERE is_primary;
CREATE INDEX client_addresses_client_idx
  ON clients.client_addresses (tenant_id, client_id, is_primary DESC, created_at, id);

CREATE TABLE clients.client_contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  first_name text NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name text NOT NULL CHECK (length(trim(last_name)) > 0),
  relationship_type text NOT NULL CHECK (relationship_type IN (
    'daughter', 'son', 'spouse', 'relative', 'legal_representative', 'guardian', 'other'
  )),
  phone text,
  mobile text,
  email text,
  address_street text,
  address_house_number text,
  address_addition text,
  address_postal_code text,
  address_city text,
  address_country_code text CHECK (
    address_country_code IS NULL OR address_country_code ~ '^[A-Z]{2}$'
  ),
  representation_type text CHECK (
    representation_type IS NULL OR representation_type IN (
      'power_of_attorney', 'legal_guardianship', 'authorized_representative'
    )
  ),
  representation_valid_from date,
  representation_valid_until date,
  representation_reference text,
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT client_contacts_representation_validity_ck CHECK (
    representation_valid_from IS NULL
    OR representation_valid_until IS NULL
    OR representation_valid_until > representation_valid_from
  ),
  CONSTRAINT client_contacts_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT client_contacts_tenant_client_id_uq UNIQUE (tenant_id, client_id, id)
);

CREATE INDEX client_contacts_client_idx
  ON clients.client_contacts (tenant_id, client_id, last_name, first_name, id);

CREATE TABLE clients.client_contact_roles (
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN (
    'primary_contact', 'emergency_contact', 'legal_representative',
    'authorized_contact', 'invoice_recipient'
  )),
  PRIMARY KEY (tenant_id, contact_id, role),
  CONSTRAINT client_contact_roles_tenant_client_contact_fk
    FOREIGN KEY (tenant_id, client_id, contact_id)
    REFERENCES clients.client_contacts (tenant_id, client_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX client_contact_one_primary_uq
  ON clients.client_contact_roles (tenant_id, client_id) WHERE role = 'primary_contact';
CREATE UNIQUE INDEX client_contact_one_emergency_uq
  ON clients.client_contact_roles (tenant_id, client_id) WHERE role = 'emergency_contact';
CREATE INDEX client_contact_roles_client_idx
  ON clients.client_contact_roles (tenant_id, client_id, role, contact_id);

CREATE TABLE clients.client_insurances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  insurance_type text NOT NULL CHECK (insurance_type IN (
    'pflegeversicherung', 'krankenversicherung', 'private', 'other'
  )),
  insurer_name text NOT NULL CHECK (length(trim(insurer_name)) > 0),
  insurance_number text,
  member_number text,
  valid_from date,
  valid_until date,
  is_primary boolean NOT NULL DEFAULT false,
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT client_insurances_validity_ck CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT client_insurances_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT client_insurances_tenant_client_id_uq UNIQUE (tenant_id, client_id, id)
);

CREATE UNIQUE INDEX client_insurances_one_primary_uq
  ON clients.client_insurances (tenant_id, client_id) WHERE is_primary;
CREATE INDEX client_insurances_client_idx
  ON clients.client_insurances (tenant_id, client_id, valid_from, valid_until, id);

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE clients.pflegegrad_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 5),
  valid_from date NOT NULL,
  valid_until date,
  decision_date date,
  insurer_reference text,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'revoked')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT pflegegrad_validity_ck CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT pflegegrad_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients (tenant_id, id),
  CONSTRAINT pflegegrad_tenant_client_id_uq UNIQUE (tenant_id, client_id, id),
  CONSTRAINT pflegegrad_periods_exclude
    EXCLUDE USING gist (
      tenant_id WITH =,
      client_id WITH =,
      daterange(valid_from, valid_until, '[)') WITH &&
    ) WHERE (status = 'confirmed')
  );

CREATE INDEX pflegegrad_client_validity_idx
  ON clients.pflegegrad_records (tenant_id, client_id, valid_from, valid_until, grade);

ALTER TABLE clients.client_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients.client_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY client_addresses_tenant_isolation ON clients.client_addresses
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clients.client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients.client_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY client_contacts_tenant_isolation ON clients.client_contacts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clients.client_contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients.client_contact_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY client_contact_roles_tenant_isolation ON clients.client_contact_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clients.client_insurances ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients.client_insurances FORCE ROW LEVEL SECURITY;
CREATE POLICY client_insurances_tenant_isolation ON clients.client_insurances
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clients.pflegegrad_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients.pflegegrad_records FORCE ROW LEVEL SECURITY;
CREATE POLICY pflegegrad_tenant_isolation ON clients.pflegegrad_records
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON clients.client_addresses TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients.client_contacts TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients.client_contact_roles TO care_app;
GRANT SELECT, INSERT, UPDATE ON clients.client_insurances TO care_app;
GRANT SELECT, INSERT, UPDATE ON clients.pflegegrad_records TO care_app;
