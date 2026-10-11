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
      'onboarding',
      'service_agreements',
      'employee_qualifications'
    )),
  ADD CONSTRAINT operations_exception_occurrences_category_ck
    CHECK (category IN (
      'scheduling',
      'visits',
      'documentation',
      'benefits',
      'billing',
      'claims',
      'onboarding',
      'agreements',
      'employees'
    ));

ALTER TABLE operations.tasks ADD COLUMN source_deadline_key text;
CREATE UNIQUE INDEX operations_tasks_deadline_key_uq
  ON operations.tasks (tenant_id, source_deadline_key)
  WHERE source_deadline_key IS NOT NULL;

