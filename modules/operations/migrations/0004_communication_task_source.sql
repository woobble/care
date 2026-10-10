ALTER TABLE operations.tasks
  ADD COLUMN source_communication_id uuid;

ALTER TABLE operations.tasks
  DROP CONSTRAINT tasks_source_type_check;

ALTER TABLE operations.tasks
  ADD CONSTRAINT operations_tasks_source_type_ck CHECK (
    source_type IN ('client', 'visit', 'service_agreement', 'service_evidence', 'invoice', 'claim', 'benefit_entitlement', 'document', 'communication')
  );

ALTER TABLE operations.tasks
  DROP CONSTRAINT operations_tasks_source_pair_ck;

ALTER TABLE operations.tasks
  ADD CONSTRAINT operations_tasks_source_pair_ck CHECK (
    (source_type IS NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 0)
    OR (source_type = 'client' AND source_client_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'visit' AND source_visit_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'service_agreement' AND source_agreement_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'service_evidence' AND source_evidence_package_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'invoice' AND source_invoice_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'claim' AND source_claim_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'benefit_entitlement' AND source_entitlement_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'document' AND source_document_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
    OR (source_type = 'communication' AND source_communication_id IS NOT NULL AND num_nonnulls(source_client_id, source_visit_id, source_agreement_id, source_evidence_package_id, source_invoice_id, source_claim_id, source_entitlement_id, source_document_id, source_communication_id) = 1)
  );

CREATE INDEX operations_tasks_source_communication_idx
  ON operations.tasks (tenant_id, source_communication_id)
  WHERE source_communication_id IS NOT NULL;
