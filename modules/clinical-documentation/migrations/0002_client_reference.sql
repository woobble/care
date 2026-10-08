ALTER TABLE clinical_documentation.records
  ADD COLUMN client_id uuid;

-- Backfill under the migration transaction's exclusive DDL lock before restoring forced RLS.
ALTER TABLE clinical_documentation.records DISABLE ROW LEVEL SECURITY;
-- This migration adds derived ownership metadata; it does not revise a clinical record.
-- Keep the application write guard out of this backfill, then restore it in the same
-- transaction before the new schema can be used.
ALTER TABLE clinical_documentation.records DISABLE TRIGGER clinical_records_write_guard;

UPDATE clinical_documentation.records AS clinical_record
SET client_id = visit.client_id
FROM care_documentation.documents AS documentation
JOIN scheduling.visits AS visit
  ON visit.tenant_id = documentation.tenant_id
  AND visit.id = documentation.visit_id
WHERE clinical_record.tenant_id = documentation.tenant_id
  AND clinical_record.documentation_id = documentation.id
  AND clinical_record.execution_id = documentation.execution_id;

-- Updating rows queues the deferred typed-payload constraint trigger. Resolve it
-- before ALTER TABLE; return constraints to their default mode for this transaction.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

ALTER TABLE clinical_documentation.records ENABLE TRIGGER clinical_records_write_guard;

ALTER TABLE clinical_documentation.records
  ALTER COLUMN client_id SET NOT NULL,
  ADD CONSTRAINT clinical_records_tenant_client_fk
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients.clients (tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT clinical_records_tenant_client_id_kind_uq
    UNIQUE (tenant_id, client_id, id, kind);

ALTER TABLE clinical_documentation.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documentation.records FORCE ROW LEVEL SECURITY;

CREATE FUNCTION clinical_documentation.set_record_client_reference()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actual_client_id uuid;
BEGIN
  SELECT visit.client_id INTO actual_client_id
  FROM care_documentation.documents AS documentation
  JOIN scheduling.visits AS visit
    ON visit.tenant_id = documentation.tenant_id
    AND visit.id = documentation.visit_id
  WHERE documentation.tenant_id = NEW.tenant_id
    AND documentation.id = NEW.documentation_id
    AND documentation.execution_id = NEW.execution_id;

  IF actual_client_id IS NULL THEN
    RAISE EXCEPTION 'clinical record documentation context is invalid'
      USING ERRCODE = '23503';
  END IF;
  IF NEW.client_id IS NOT NULL AND NEW.client_id <> actual_client_id THEN
    RAISE EXCEPTION 'clinical record client does not match its visit'
      USING ERRCODE = '23514';
  END IF;
  NEW.client_id := actual_client_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clinical_records_client_reference
  BEFORE INSERT OR UPDATE OF tenant_id, client_id, documentation_id, execution_id
  ON clinical_documentation.records
  FOR EACH ROW EXECUTE FUNCTION clinical_documentation.set_record_client_reference();
