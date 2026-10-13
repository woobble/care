CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX payers_name_trgm_idx
  ON billing.payers USING gin (name gin_trgm_ops);
CREATE INDEX payers_identifier_trgm_idx
  ON billing.payers USING gin (payer_identifier gin_trgm_ops)
  WHERE payer_identifier IS NOT NULL;
CREATE INDEX payer_billing_profiles_history_idx
  ON billing.payer_billing_profiles
    (tenant_id, organization_id, payer_id, channel, funding_source_type, version DESC);
