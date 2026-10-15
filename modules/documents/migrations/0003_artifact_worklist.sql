ALTER TABLE documents.artifacts ADD COLUMN title text;
ALTER TABLE documents.artifacts ADD COLUMN source_reference text
  CHECK (length(coalesce(source_reference, '')) <= 160);

CREATE INDEX document_artifacts_worklist_idx
  ON documents.artifacts (tenant_id, created_at, id);

CREATE INDEX document_artifacts_org_worklist_idx
  ON documents.artifacts (tenant_id, organization_id, created_at, id);
