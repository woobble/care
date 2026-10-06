ALTER TABLE employees.employees
  ADD CONSTRAINT employees_user_fk
    FOREIGN KEY (user_id) REFERENCES identity.users(id),
  ADD CONSTRAINT employees_tenant_membership_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES identity.tenant_memberships (tenant_id, user_id);
