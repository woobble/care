ALTER TABLE operations.tasks
  ADD CONSTRAINT operations_tasks_tenant_organization_assignee_fk
  FOREIGN KEY (tenant_id, organization_id, assigned_employee_id)
  REFERENCES employees.employees (tenant_id, organization_id, id)
  NOT VALID;

ALTER TABLE operations.tasks
  VALIDATE CONSTRAINT operations_tasks_tenant_organization_assignee_fk;
