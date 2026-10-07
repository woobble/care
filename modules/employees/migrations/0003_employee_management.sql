ALTER TABLE employees.employees
  ADD COLUMN organization_id uuid,
  ADD COLUMN preferred_name text,
  ADD COLUMN email text,
  ADD COLUMN phone text,
  ADD COLUMN personnel_number text,
  ADD COLUMN employment_type text,
  ADD COLUMN start_date date,
  ADD COLUMN end_date date,
  ADD COLUMN weekly_hours numeric(5, 2),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE employees.employees
  DROP CONSTRAINT employees_status_check,
  ADD CONSTRAINT employees_status_check
    CHECK (status IN ('active', 'inactive', 'archived')),
  ADD CONSTRAINT employees_employment_dates_check
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  ADD CONSTRAINT employees_weekly_hours_check
    CHECK (weekly_hours IS NULL OR weekly_hours BETWEEN 0 AND 168),
  ADD CONSTRAINT employees_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES organizations.tenants(id),
  ADD CONSTRAINT employees_tenant_organization_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations.organizations (tenant_id, id),
  ADD CONSTRAINT employees_tenant_id_id_uq UNIQUE (tenant_id, id),
  ADD CONSTRAINT employees_tenant_organization_id_id_uq
    UNIQUE (tenant_id, organization_id, id);

CREATE UNIQUE INDEX employees_personnel_number_uq
  ON employees.employees (tenant_id, personnel_number)
  WHERE personnel_number IS NOT NULL;
CREATE UNIQUE INDEX employees_user_per_tenant_uq
  ON employees.employees (tenant_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX employees_tenant_organization_status_name_idx
  ON employees.employees (tenant_id, organization_id, status, last_name, first_name, id);

CREATE TABLE employees.employee_facility_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  valid_from date,
  valid_until date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_facility_assignment_employee_fk
    FOREIGN KEY (tenant_id, organization_id, employee_id)
    REFERENCES employees.employees (tenant_id, organization_id, id),
  CONSTRAINT employee_facility_assignment_facility_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id),
  CONSTRAINT employee_facility_assignment_dates_check
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE UNIQUE INDEX employee_facility_active_assignment_uq
  ON employees.employee_facility_assignments (tenant_id, employee_id, facility_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX employee_facility_primary_uq
  ON employees.employee_facility_assignments (tenant_id, employee_id)
  WHERE status = 'active' AND is_primary;
CREATE INDEX employee_facility_by_facility_idx
  ON employees.employee_facility_assignments (tenant_id, facility_id, employee_id)
  WHERE status = 'active';

CREATE TABLE employees.employee_team_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  team_id uuid NOT NULL,
  role text,
  valid_from date,
  valid_until date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_team_membership_employee_fk
    FOREIGN KEY (tenant_id, organization_id, employee_id)
    REFERENCES employees.employees (tenant_id, organization_id, id),
  CONSTRAINT employee_team_membership_team_fk
    FOREIGN KEY (tenant_id, organization_id, team_id)
    REFERENCES organizations.teams (tenant_id, organization_id, id),
  CONSTRAINT employee_team_membership_dates_check
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE UNIQUE INDEX employee_team_active_membership_uq
  ON employees.employee_team_memberships (tenant_id, employee_id, team_id)
  WHERE status = 'active';
CREATE INDEX employee_team_by_team_idx
  ON employees.employee_team_memberships (tenant_id, team_id, employee_id)
  WHERE status = 'active';

CREATE TABLE employees.qualification_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  name text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qualification_definitions_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT qualification_definitions_tenant_name_uq UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX qualification_definitions_tenant_code_uq
  ON employees.qualification_definitions (tenant_id, code)
  WHERE code IS NOT NULL;

CREATE TABLE employees.employee_qualifications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  qualification_id uuid NOT NULL,
  valid_from date,
  valid_until date,
  issuer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_qualification_employee_fk
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES employees.employees (tenant_id, id),
  CONSTRAINT employee_qualification_definition_fk
    FOREIGN KEY (tenant_id, qualification_id)
    REFERENCES employees.qualification_definitions (tenant_id, id),
  CONSTRAINT employee_qualification_dates_check
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CONSTRAINT employee_qualification_employee_definition_uq
    UNIQUE (tenant_id, employee_id, qualification_id)
);

CREATE TABLE employees.skill_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  name text NOT NULL,
  code text,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_definitions_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT skill_definitions_tenant_name_uq UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX skill_definitions_tenant_code_uq
  ON employees.skill_definitions (tenant_id, code)
  WHERE code IS NOT NULL;

CREATE TABLE employees.employee_skills (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_skill_employee_fk
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES employees.employees (tenant_id, id),
  CONSTRAINT employee_skill_definition_fk
    FOREIGN KEY (tenant_id, skill_id)
    REFERENCES employees.skill_definitions (tenant_id, id),
  CONSTRAINT employee_skill_employee_definition_uq UNIQUE (tenant_id, employee_id, skill_id)
);

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'employee_facility_assignments',
    'employee_team_memberships',
    'qualification_definitions',
    'employee_qualifications',
    'skill_definitions',
    'employee_skills'
  ]
  LOOP
    EXECUTE format('ALTER TABLE employees.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE employees.%I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format(
      'CREATE POLICY %I ON employees.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      target_table || '_tenant_isolation',
      target_table
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON employees.employees TO care_app;
GRANT SELECT, INSERT, UPDATE ON employees.employee_facility_assignments TO care_app;
GRANT SELECT, INSERT, UPDATE ON employees.employee_team_memberships TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON employees.qualification_definitions,
  employees.employee_qualifications, employees.skill_definitions, employees.employee_skills TO care_app;
