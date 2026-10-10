CREATE SCHEMA IF NOT EXISTS documents;

CREATE TABLE documents.logo_assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE CHECK (
    object_key LIKE 'documents/logos/%' AND length(object_key) <= 300
  ),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 524288),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2400),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1200),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_logo_assets_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT document_logo_assets_tenant_org_id_uq UNIQUE (tenant_id, organization_id, id),
  CONSTRAINT document_logo_assets_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id)
);
CREATE INDEX document_logo_assets_org_idx
  ON documents.logo_assets (tenant_id, organization_id, created_at);

CREATE TABLE documents.templates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  document_type text NOT NULL CHECK (
    document_type IN ('service_evidence', 'service_agreement', 'invoice', 'invoice_correction', 'benefit_overview')
  ),
  logo_asset_id uuid,
  primary_color text NOT NULL CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  header_text text CHECK (length(header_text) <= 500),
  footer_text text CHECK (length(footer_text) <= 500),
  contact_email text CHECK (length(contact_email) <= 254),
  contact_phone text CHECK (length(contact_phone) <= 80),
  contact_website text CHECK (length(contact_website) <= 254),
  default_locale text NOT NULL CHECK (default_locale IN ('de', 'en')),
  contract_terms_text text CHECK (length(contract_terms_text) <= 8000),
  version integer NOT NULL CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_templates_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT document_templates_org_type_version_uq
    UNIQUE (tenant_id, organization_id, document_type, version),
  CONSTRAINT document_templates_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT document_templates_logo_fk FOREIGN KEY (tenant_id, organization_id, logo_asset_id)
    REFERENCES documents.logo_assets (tenant_id, organization_id, id)
);
CREATE INDEX document_templates_current_idx
  ON documents.templates (tenant_id, organization_id, document_type, version DESC);

CREATE TABLE documents.artifacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  client_id uuid,
  document_type text NOT NULL CHECK (
    document_type IN ('service_evidence', 'service_agreement', 'invoice', 'invoice_correction', 'benefit_overview')
  ),
  source_entity_type text NOT NULL CHECK (length(trim(source_entity_type)) BETWEEN 1 AND 80),
  source_entity_id uuid NOT NULL,
  source_version text NOT NULL CHECK (length(trim(source_version)) BETWEEN 1 AND 200),
  template_version integer NOT NULL CHECK (template_version >= 0),
  locale text NOT NULL CHECK (locale IN ('de', 'en')),
  object_key text,
  sha256 text,
  mime_type text NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes integer,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'superseded')),
  idempotency_key uuid NOT NULL,
  generated_at timestamptz,
  generated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_artifacts_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT document_artifacts_idempotency_uq UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT document_artifacts_storage_ck CHECK (
    (status IN ('ready', 'superseded') AND object_key IS NOT NULL
      AND object_key LIKE 'documents/artifacts/%' AND sha256 IS NOT NULL
      AND sha256 ~ '^[a-f0-9]{64}$' AND size_bytes IS NOT NULL AND size_bytes > 0
      AND generated_at IS NOT NULL)
    OR (status IN ('pending', 'failed') AND object_key IS NULL AND sha256 IS NULL
      AND size_bytes IS NULL AND generated_at IS NULL)
  ),
  CONSTRAINT document_artifacts_organization_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  CONSTRAINT document_artifacts_facility_fk FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  CONSTRAINT document_artifacts_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id)
);
CREATE INDEX document_artifacts_client_created_idx
  ON documents.artifacts (tenant_id, client_id, created_at DESC, id DESC);
CREATE INDEX document_artifacts_source_idx
  ON documents.artifacts
    (tenant_id, source_entity_type, source_entity_id, document_type, created_at DESC);

CREATE FUNCTION documents.reject_template_or_logo_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Document template versions and logo assets are immutable'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER templates_immutable
  BEFORE UPDATE OR DELETE ON documents.templates
  FOR EACH ROW EXECUTE FUNCTION documents.reject_template_or_logo_mutation();
CREATE TRIGGER logo_assets_immutable
  BEFORE UPDATE OR DELETE ON documents.logo_assets
  FOR EACH ROW EXECUTE FUNCTION documents.reject_template_or_logo_mutation();

CREATE FUNCTION documents.guard_artifact_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document artifact history is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'ready' AND NEW.status = 'superseded'
    AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('pending', 'failed') AND NEW.status IN ('pending', 'ready', 'failed')
    AND (to_jsonb(NEW) - ARRAY['status', 'object_key', 'sha256', 'size_bytes', 'generated_at'])
      = (to_jsonb(OLD) - ARRAY['status', 'object_key', 'sha256', 'size_bytes', 'generated_at']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid document artifact state transition' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER artifacts_lifecycle_guard
  BEFORE UPDATE OR DELETE ON documents.artifacts
  FOR EACH ROW EXECUTE FUNCTION documents.guard_artifact_transition();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['logo_assets', 'templates', 'artifacts'] LOOP
    EXECUTE format('ALTER TABLE documents.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE documents.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON documents.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      'documents_' || table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA documents TO care_app;
GRANT SELECT, INSERT ON documents.logo_assets, documents.templates TO care_app;
GRANT SELECT, INSERT, UPDATE ON documents.artifacts TO care_app;
