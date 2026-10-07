CREATE SCHEMA IF NOT EXISTS service_evidence;

CREATE TABLE service_evidence.evidence_packages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  documentation_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  documentation_version integer NOT NULL CHECK (documentation_version > 0),
  execution_version integer NOT NULL CHECK (execution_version > 0),
  amendment_count integer NOT NULL CHECK (amendment_count >= 0),
  snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot) = 'object'
    AND snapshot->>'snapshotVersion' IS NOT NULL
    AND snapshot->>'snapshotVersion' = '1'
    AND jsonb_typeof(snapshot->'items') IS NOT NULL
    AND jsonb_typeof(snapshot->'items') = 'array'
  ),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL,
  CONSTRAINT evidence_packages_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT evidence_packages_tenant_document_version_uq
    UNIQUE (tenant_id, documentation_id, version),
  CONSTRAINT evidence_packages_document_fk
    FOREIGN KEY (tenant_id, documentation_id)
    REFERENCES care_documentation.documents (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX evidence_packages_tenant_document_generated_idx
  ON service_evidence.evidence_packages (tenant_id, documentation_id, generated_at DESC, version DESC);

CREATE TABLE service_evidence.acknowledgements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  evidence_package_id uuid NOT NULL,
  evidence_package_hash text NOT NULL CHECK (evidence_package_hash ~ '^[a-f0-9]{64}$'),
  client_id uuid NOT NULL,
  signatory_type text NOT NULL CHECK (
    signatory_type IN ('client', 'representative', 'other_authorized_person')
  ),
  signatory_name_snapshot text NOT NULL CHECK (length(trim(signatory_name_snapshot)) BETWEEN 1 AND 200),
  signatory_contact_id uuid,
  signatory_capacity text NOT NULL CHECK (
    signatory_capacity IN ('client', 'legal_guardian', 'authorized_representative', 'relative', 'other')
  ),
  signatory_relationship_snapshot text,
  representation_type_snapshot text,
  status text NOT NULL CHECK (status IN ('acknowledged', 'declined')),
  method text NOT NULL CHECK (method IN ('touch_signature', 'typed_confirmation', 'staff_recorded_decline')),
  signature_storage_key text,
  signature_sha256 text,
  statement_version text NOT NULL CHECK (length(trim(statement_version)) BETWEEN 1 AND 40),
  statement_text_snapshot text NOT NULL CHECK (length(trim(statement_text_snapshot)) BETWEEN 1 AND 500),
  decline_reason_code text,
  decline_note text CHECK (decline_note IS NULL OR length(decline_note) <= 500),
  captured_by_employee_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  acknowledged_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  CONSTRAINT acknowledgements_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT acknowledgements_tenant_idempotency_uq UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT acknowledgements_signatory_ck CHECK (
    (signatory_type = 'client' AND signatory_contact_id IS NULL
      AND signatory_capacity = 'client'
      AND signatory_relationship_snapshot IS NULL
      AND representation_type_snapshot IS NULL)
    OR (signatory_type <> 'client' AND signatory_contact_id IS NOT NULL
      AND signatory_capacity <> 'client'
      AND signatory_relationship_snapshot IS NOT NULL
      AND representation_type_snapshot IS NOT NULL
      AND representation_type_snapshot IN (
        'power_of_attorney', 'legal_guardianship', 'authorized_representative'
      ))
  ),
  CONSTRAINT acknowledgements_outcome_ck CHECK (
    (status = 'acknowledged' AND method IN ('touch_signature', 'typed_confirmation')
      AND acknowledged_at IS NOT NULL AND declined_at IS NULL
      AND decline_reason_code IS NULL AND decline_note IS NULL)
    OR (status = 'declined' AND method = 'staff_recorded_decline'
      AND acknowledged_at IS NULL AND declined_at IS NOT NULL
      AND decline_reason_code IS NOT NULL
      AND decline_reason_code IN (
        'declined_without_reason', 'disagrees_with_record', 'unable_to_sign',
        'signatory_not_available', 'other'
      ))
  ),
  CONSTRAINT acknowledgements_signature_ck CHECK (
    (method = 'touch_signature' AND status = 'acknowledged'
      AND signature_storage_key IS NOT NULL
      AND signature_storage_key LIKE 'service-evidence/signatures/%'
      AND length(signature_storage_key) <= 300
      AND signature_sha256 IS NOT NULL
      AND signature_sha256 ~ '^[a-f0-9]{64}$')
    OR (method <> 'touch_signature' AND signature_storage_key IS NULL AND signature_sha256 IS NULL)
  ),
  CONSTRAINT acknowledgements_revocation_ck CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
    OR (status = 'acknowledged' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL
      AND revocation_reason IS NOT NULL
      AND length(trim(revocation_reason)) BETWEEN 1 AND 500)
  ),
  CONSTRAINT acknowledgements_package_fk
    FOREIGN KEY (tenant_id, evidence_package_id)
    REFERENCES service_evidence.evidence_packages (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT acknowledgements_client_fk
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT acknowledgements_signatory_contact_fk
    FOREIGN KEY (tenant_id, client_id, signatory_contact_id)
    REFERENCES clients.client_contacts (tenant_id, client_id, id) ON DELETE RESTRICT,
  CONSTRAINT acknowledgements_captured_by_employee_fk
    FOREIGN KEY (tenant_id, captured_by_employee_id)
    REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX acknowledgements_one_unrevoked_per_package_uq
  ON service_evidence.acknowledgements (tenant_id, evidence_package_id)
  WHERE revoked_at IS NULL;
CREATE INDEX acknowledgements_tenant_client_created_idx
  ON service_evidence.acknowledgements (tenant_id, client_id, created_at DESC);

CREATE FUNCTION service_evidence.prevent_evidence_package_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence packages are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER evidence_packages_immutable
  BEFORE UPDATE OR DELETE ON service_evidence.evidence_packages
  FOR EACH ROW EXECUTE FUNCTION service_evidence.prevent_evidence_package_mutation();

CREATE FUNCTION service_evidence.protect_acknowledgement_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'acknowledged'
    AND OLD.revoked_at IS NULL
    AND OLD.revoked_by_user_id IS NULL
    AND OLD.revocation_reason IS NULL
    AND NEW.status = OLD.status
    AND NEW.revoked_at IS NOT NULL
    AND NEW.revoked_by_user_id IS NOT NULL
    AND length(trim(NEW.revocation_reason)) BETWEEN 1 AND 500
    AND (to_jsonb(NEW) - 'revoked_at' - 'revoked_by_user_id' - 'revocation_reason')
      = (to_jsonb(OLD) - 'revoked_at' - 'revoked_by_user_id' - 'revocation_reason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'acknowledgements are immutable except explicit revocation'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER acknowledgements_append_only
  BEFORE UPDATE OR DELETE ON service_evidence.acknowledgements
  FOR EACH ROW EXECUTE FUNCTION service_evidence.protect_acknowledgement_history();

ALTER TABLE service_evidence.evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_evidence.evidence_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_packages_tenant_isolation ON service_evidence.evidence_packages
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE service_evidence.acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_evidence.acknowledgements FORCE ROW LEVEL SECURITY;
CREATE POLICY acknowledgements_tenant_isolation ON service_evidence.acknowledgements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA service_evidence TO care_app;
GRANT SELECT, INSERT ON service_evidence.evidence_packages TO care_app;
GRANT SELECT, INSERT, UPDATE ON service_evidence.acknowledgements TO care_app;
