ALTER TABLE documents.templates
  DROP CONSTRAINT IF EXISTS templates_document_type_check,
  ADD CONSTRAINT templates_document_type_ck CHECK (
    document_type IN ('service_evidence', 'service_agreement', 'invoice', 'invoice_correction', 'benefit_overview', 'claim_summary')
  );

ALTER TABLE documents.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_document_type_check,
  ADD CONSTRAINT artifacts_document_type_ck CHECK (
    document_type IN ('service_evidence', 'service_agreement', 'invoice', 'invoice_correction', 'benefit_overview', 'claim_summary')
  );
