ALTER TABLE operations.exception_occurrences
  DROP CONSTRAINT IF EXISTS operations_exception_occurrences_source_domain_ck,
  DROP CONSTRAINT IF EXISTS exception_occurrences_source_domain_check,
  DROP CONSTRAINT IF EXISTS operations_exception_occurrences_category_ck,
  DROP CONSTRAINT IF EXISTS exception_occurrences_category_check;

ALTER TABLE operations.exception_occurrences
  ADD CONSTRAINT operations_exception_occurrences_source_domain_ck
    CHECK (source_domain IN (
      'scheduling',
      'care_documentation',
      'service_evidence',
      'benefits',
      'billing',
      'claims',
      'onboarding'
    )),
  ADD CONSTRAINT operations_exception_occurrences_category_ck
    CHECK (category IN (
      'scheduling',
      'visits',
      'documentation',
      'benefits',
      'billing',
      'claims',
      'onboarding'
    ));
