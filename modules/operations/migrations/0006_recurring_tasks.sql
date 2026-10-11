ALTER TABLE operations.tasks
  ADD COLUMN assignment_warning_code text,
  ADD CONSTRAINT operations_tasks_assignment_warning_ck
    CHECK (assignment_warning_code IS NULL OR assignment_warning_code = 'assignee_unavailable');

CREATE TABLE operations.recurring_task_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  client_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 8000),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_employee_id uuid,
  recurrence_rule jsonb NOT NULL CHECK (
    jsonb_typeof(recurrence_rule) = 'object'
    AND recurrence_rule->>'frequency' IN ('daily', 'weekly', 'monthly', 'yearly')
    AND recurrence_rule->>'interval' ~ '^[0-9]{1,3}$'
  ),
  timezone text NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  start_date date NOT NULL,
  end_date date,
  time_of_day time NOT NULL,
  next_occurrence_date date,
  next_occurrence_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
  generation_policy text NOT NULL CHECK (generation_policy IN ('generate_missed', 'skip_missed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_recurring_task_definitions_end_date_ck
    CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT operations_recurring_task_definitions_cursor_ck
    CHECK ((next_occurrence_date IS NULL) = (next_occurrence_at IS NULL)),
  CONSTRAINT operations_recurring_task_definitions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT operations_recurring_task_definitions_organization_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT operations_recurring_task_definitions_facility_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities(tenant_id, organization_id, id),
  CONSTRAINT operations_recurring_task_definitions_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients(tenant_id, id),
  CONSTRAINT operations_recurring_task_definitions_assignee_fk
    FOREIGN KEY (tenant_id, assigned_employee_id) REFERENCES employees.employees(tenant_id, id),
  CONSTRAINT operations_recurring_task_definitions_org_assignee_fk
    FOREIGN KEY (tenant_id, organization_id, assigned_employee_id)
    REFERENCES employees.employees(tenant_id, organization_id, id)
);

CREATE INDEX operations_recurring_task_definitions_due_idx
  ON operations.recurring_task_definitions (tenant_id, status, next_occurrence_at, id);
CREATE INDEX operations_recurring_task_definitions_scope_idx
  ON operations.recurring_task_definitions (tenant_id, organization_id, facility_id, status, id);

CREATE TABLE operations.recurring_task_occurrences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  recurrence_definition_id uuid NOT NULL,
  occurrence_key date NOT NULL,
  definition_version integer NOT NULL CHECK (definition_version > 0),
  task_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  assignment_warning_code text CHECK (
    assignment_warning_code IS NULL OR assignment_warning_code = 'assignee_unavailable'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_recurring_task_occurrences_definition_key_uq
    UNIQUE (tenant_id, recurrence_definition_id, occurrence_key),
  CONSTRAINT operations_recurring_task_occurrences_task_uq UNIQUE (tenant_id, task_id),
  CONSTRAINT operations_recurring_task_occurrences_definition_fk
    FOREIGN KEY (tenant_id, recurrence_definition_id)
    REFERENCES operations.recurring_task_definitions(tenant_id, id),
  CONSTRAINT operations_recurring_task_occurrences_task_fk
    FOREIGN KEY (tenant_id, task_id) REFERENCES operations.tasks(tenant_id, id)
);
CREATE INDEX operations_recurring_task_occurrences_history_idx
  ON operations.recurring_task_occurrences (tenant_id, recurrence_definition_id, occurrence_key);

CREATE TABLE operations.reminder_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  category text NOT NULL CHECK (
    category IN ('agreements', 'employees', 'benefits', 'billing', 'claims', 'documents', 'onboarding')
  ),
  offsets_days integer[] NOT NULL DEFAULT ARRAY[30, 7, 0],
  enabled boolean NOT NULL DEFAULT true,
  create_follow_up_task boolean NOT NULL DEFAULT false,
  assigned_employee_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_reminder_policies_offsets_ck
    CHECK (cardinality(offsets_days) BETWEEN 1 AND 8 AND array_position(offsets_days, NULL) IS NULL),
  CONSTRAINT operations_reminder_policies_org_category_uq
    UNIQUE (tenant_id, organization_id, category),
  CONSTRAINT operations_reminder_policies_organization_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations.organizations(tenant_id, id),
  CONSTRAINT operations_reminder_policies_assignee_fk
    FOREIGN KEY (tenant_id, organization_id, assigned_employee_id)
    REFERENCES employees.employees(tenant_id, organization_id, id)
);

CREATE TABLE operations.scheduler_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  job_name text NOT NULL CHECK (job_name IN ('recurring_tasks', 'deadline_evaluation')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  worker_id text,
  lease_until timestamptz,
  last_started_at timestamptz NOT NULL,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_failure_code text,
  tasks_created integer NOT NULL DEFAULT 0 CHECK (tasks_created >= 0),
  reminders_triggered integer NOT NULL DEFAULT 0 CHECK (reminders_triggered >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_scheduler_runs_tenant_job_uq UNIQUE (tenant_id, job_name)
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recurring_task_definitions',
    'recurring_task_occurrences',
    'reminder_policies',
    'scheduler_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE operations.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE operations.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON operations.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END $$;

CREATE POLICY operations_scheduler_runs_worker_read ON operations.scheduler_runs
  FOR SELECT TO care_worker USING (true);

GRANT USAGE ON SCHEMA operations TO care_app, care_worker;
GRANT SELECT, INSERT, UPDATE ON operations.tasks TO care_worker;
GRANT INSERT ON operations.task_activity TO care_worker;
GRANT SELECT, INSERT, UPDATE ON operations.recurring_task_definitions,
  operations.recurring_task_occurrences, operations.reminder_policies,
  operations.scheduler_runs TO care_app, care_worker;
GRANT SELECT ON operations.scheduler_runs TO care_worker;
