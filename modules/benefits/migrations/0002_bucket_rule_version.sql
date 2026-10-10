ALTER TABLE benefits.allocation_buckets
  ADD COLUMN rule_version_id uuid;

UPDATE benefits.allocation_buckets AS bucket
SET rule_version_id = (
  SELECT rule.id
  FROM benefits.rule_versions AS rule
  WHERE rule.benefit_type = bucket.benefit_type
    AND rule.jurisdiction = 'DE'
    AND rule.effective_from <= bucket.origin_period
    AND (rule.effective_until IS NULL OR rule.effective_until >= bucket.origin_period)
  ORDER BY rule.effective_from DESC, rule.rule_version DESC
  LIMIT 1
)
WHERE bucket.bucket_type = 'monthly_entitlement';

ALTER TABLE benefits.allocation_buckets
  ADD CONSTRAINT benefit_allocation_buckets_rule_version_ck
    CHECK (bucket_type <> 'monthly_entitlement' OR rule_version_id IS NOT NULL),
  ADD CONSTRAINT benefit_allocation_buckets_rule_version_fk
    FOREIGN KEY (rule_version_id) REFERENCES benefits.rule_versions (id);
