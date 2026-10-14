CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX employees_first_name_trgm_idx
  ON employees.employees USING gin (first_name gin_trgm_ops);
CREATE INDEX employees_last_name_trgm_idx
  ON employees.employees USING gin (last_name gin_trgm_ops);
CREATE INDEX employees_full_name_trgm_idx
  ON employees.employees USING gin ((coalesce(preferred_name, first_name) || ' ' || last_name) gin_trgm_ops);
CREATE INDEX employees_preferred_name_trgm_idx
  ON employees.employees USING gin (preferred_name gin_trgm_ops)
  WHERE preferred_name IS NOT NULL;
CREATE INDEX employees_personnel_number_trgm_idx
  ON employees.employees USING gin (personnel_number gin_trgm_ops)
  WHERE personnel_number IS NOT NULL;
CREATE INDEX employees_email_trgm_idx
  ON employees.employees USING gin (email gin_trgm_ops)
  WHERE email IS NOT NULL;
CREATE INDEX employees_phone_trgm_idx
  ON employees.employees USING gin (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;

CREATE INDEX employees_tenant_status_name_order_idx
  ON employees.employees (tenant_id, status, last_name, first_name, id);

CREATE INDEX employee_qualification_definitions_name_trgm_idx
  ON employees.qualification_definitions USING gin (name gin_trgm_ops);
CREATE INDEX employee_qualification_definitions_code_trgm_idx
  ON employees.qualification_definitions USING gin (code gin_trgm_ops)
  WHERE code IS NOT NULL;
CREATE INDEX employee_skill_definitions_name_trgm_idx
  ON employees.skill_definitions USING gin (name gin_trgm_ops);
CREATE INDEX employee_skill_definitions_code_trgm_idx
  ON employees.skill_definitions USING gin (code gin_trgm_ops)
  WHERE code IS NOT NULL;
