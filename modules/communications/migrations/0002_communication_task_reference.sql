ALTER TABLE operations.tasks
  ADD CONSTRAINT operations_tasks_communication_client_ck
  CHECK (source_type <> 'communication' OR client_id IS NOT NULL);

ALTER TABLE operations.tasks
  ADD CONSTRAINT operations_tasks_source_communication_fk
  FOREIGN KEY (tenant_id, client_id, source_communication_id)
  REFERENCES communications.interactions (tenant_id, client_id, id);
