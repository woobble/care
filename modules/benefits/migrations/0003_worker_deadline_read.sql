GRANT USAGE ON SCHEMA benefits TO care_worker;
GRANT SELECT ON benefits.rule_versions,
  benefits.funding_sources,
  benefits.client_entitlements,
  benefits.allocation_buckets,
  benefits.ledger_entries TO care_worker;
