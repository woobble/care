ALTER TABLE scheduling.employee_unavailability
  ADD COLUMN reason text NOT NULL DEFAULT 'other',
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by uuid;

UPDATE scheduling.employee_unavailability SET updated_by = created_by;

ALTER TABLE scheduling.employee_unavailability
  ALTER COLUMN updated_by SET NOT NULL,
  ADD CONSTRAINT employee_unavailability_reason_ck
    CHECK (reason IN ('vacation', 'sick_leave', 'training', 'personal_unavailability', 'other')),
  ADD CONSTRAINT employee_unavailability_status_ck CHECK (status IN ('active', 'cancelled'));

CREATE TABLE scheduling.employee_availability (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  timezone text NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  max_daily_minutes integer CHECK (max_daily_minutes IS NULL OR max_daily_minutes BETWEEN 1 AND 1440),
  travel_buffer_minutes integer NOT NULL DEFAULT 0 CHECK (travel_buffer_minutes BETWEEN 0 AND 240),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT employee_availability_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT employee_availability_employee_uq UNIQUE (tenant_id, employee_id),
  CONSTRAINT employee_availability_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE scheduling.employee_availability_windows (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  availability_id uuid NOT NULL,
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  CONSTRAINT employee_availability_windows_range_ck CHECK (starts_at <> ends_at),
  CONSTRAINT employee_availability_windows_unique_uq
    UNIQUE (tenant_id, availability_id, weekday, starts_at, ends_at),
  CONSTRAINT employee_availability_windows_policy_fk
    FOREIGN KEY (tenant_id, availability_id)
    REFERENCES scheduling.employee_availability (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX employee_availability_windows_lookup_idx
  ON scheduling.employee_availability_windows (tenant_id, availability_id, weekday, starts_at);

CREATE TABLE scheduling.employee_availability_exceptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  local_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('working_hours', 'closed', 'unavailable')),
  starts_at time,
  ends_at time,
  created_at timestamptz NOT NULL,
  CONSTRAINT employee_availability_exceptions_range_ck CHECK (
    (kind = 'working_hours' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at <> ends_at)
    OR (kind = 'closed' AND starts_at IS NULL AND ends_at IS NULL)
    OR (kind = 'unavailable' AND ((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at <> ends_at)))
  ),
  CONSTRAINT employee_availability_exceptions_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX employee_availability_exceptions_lookup_idx
  ON scheduling.employee_availability_exceptions (tenant_id, employee_id, local_date, id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'employee_availability', 'employee_availability_windows', 'employee_availability_exceptions'
  ] LOOP
    EXECUTE format('ALTER TABLE scheduling.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE scheduling.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON scheduling.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON scheduling.employee_unavailability TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.employee_availability TO care_app;
GRANT SELECT, INSERT, DELETE ON scheduling.employee_availability_windows TO care_app;
GRANT SELECT, INSERT, DELETE ON scheduling.employee_availability_exceptions TO care_app;
