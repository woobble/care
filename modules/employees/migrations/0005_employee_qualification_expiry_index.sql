CREATE INDEX employee_qualification_tenant_valid_until_idx
  ON employees.employee_qualifications (tenant_id, valid_until)
  WHERE valid_until IS NOT NULL;
