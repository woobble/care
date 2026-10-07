ALTER TABLE visit_execution.performed_services
  ADD CONSTRAINT performed_services_tenant_id_execution_uq
  UNIQUE (tenant_id, id, execution_id);
