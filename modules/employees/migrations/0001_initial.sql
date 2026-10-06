CREATE SCHEMA IF NOT EXISTS employees;

CREATE TABLE employees.employees (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employees.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees.employees FORCE ROW LEVEL SECURITY;
CREATE POLICY employees_tenant_isolation ON employees.employees
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA employees TO care_app;
GRANT SELECT, INSERT, UPDATE ON employees.employees TO care_app;
