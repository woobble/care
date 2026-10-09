CREATE SCHEMA workforce_compliance;

CREATE TABLE workforce_compliance.settings (
  tenant_id uuid PRIMARY KEY REFERENCES organizations.tenants(id),
  critical_days integer NOT NULL DEFAULT 30,
  warning_days integer NOT NULL DEFAULT 90,
  reporting_timezone text NOT NULL DEFAULT 'Europe/Berlin',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_compliance_settings_thresholds_check
    CHECK (critical_days BETWEEN 1 AND 365 AND warning_days BETWEEN 1 AND 365 AND critical_days <= warning_days),
  CONSTRAINT workforce_compliance_settings_version_check CHECK (version > 0),
  CONSTRAINT workforce_compliance_settings_timezone_check
    CHECK (length(trim(reporting_timezone)) BETWEEN 1 AND 100)
);

ALTER TABLE workforce_compliance.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_compliance.settings FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_compliance_settings_tenant_isolation
  ON workforce_compliance.settings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA workforce_compliance TO care_app;
GRANT SELECT, INSERT, UPDATE ON workforce_compliance.settings TO care_app;
