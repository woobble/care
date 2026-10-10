ALTER TABLE scheduling.visit_assignments
  ADD CONSTRAINT visit_assignments_tenant_visit_id_uq UNIQUE (tenant_id, visit_id, id);

CREATE TABLE scheduling.visit_substitutions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  original_assignment_id uuid NOT NULL,
  original_employee_id uuid NOT NULL,
  substitute_employee_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'confirmed', 'cancelled')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid,
  CONSTRAINT visit_substitutions_employees_differ_ck CHECK (original_employee_id <> substitute_employee_id),
  CONSTRAINT visit_substitutions_resolution_ck CHECK (
    (status = 'proposed' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status <> 'proposed' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  ),
  CONSTRAINT visit_substitutions_visit_fk
    FOREIGN KEY (tenant_id, visit_id) REFERENCES scheduling.visits (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_substitutions_assignment_fk
    FOREIGN KEY (tenant_id, visit_id, original_assignment_id)
    REFERENCES scheduling.visit_assignments (tenant_id, visit_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_substitutions_original_employee_fk
    FOREIGN KEY (tenant_id, original_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT visit_substitutions_substitute_employee_fk
    FOREIGN KEY (tenant_id, substitute_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX visit_substitutions_one_proposal_uq
  ON scheduling.visit_substitutions (tenant_id, visit_id) WHERE status = 'proposed';
CREATE INDEX visit_substitutions_employee_status_idx
  ON scheduling.visit_substitutions (tenant_id, substitute_employee_id, status, created_at DESC);

CREATE TABLE scheduling.tours (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  facility_id uuid,
  local_date date NOT NULL,
  timezone text NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  CONSTRAINT tours_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT tours_employee_date_uq UNIQUE (tenant_id, employee_id, local_date),
  CONSTRAINT tours_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT tours_provider_fk
    FOREIGN KEY (tenant_id, organization_id, facility_id)
    REFERENCES organizations.facilities (tenant_id, organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX tours_date_employee_idx
  ON scheduling.tours (tenant_id, local_date, employee_id, id);

CREATE TABLE scheduling.tour_stops (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  tour_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 1),
  estimated_travel_minutes integer CHECK (estimated_travel_minutes IS NULL OR estimated_travel_minutes >= 0),
  estimated_distance_meters integer CHECK (estimated_distance_meters IS NULL OR estimated_distance_meters >= 0),
  route_status text NOT NULL DEFAULT 'unknown' CHECK (route_status IN ('unknown', 'available', 'unavailable', 'unresolved')),
  dispatcher_note text CHECK (dispatcher_note IS NULL OR length(dispatcher_note) <= 500),
  CONSTRAINT tour_stops_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT tour_stops_tour_sequence_uq UNIQUE (tenant_id, tour_id, sequence),
  CONSTRAINT tour_stops_tour_visit_uq UNIQUE (tenant_id, tour_id, visit_id),
  CONSTRAINT tour_stops_tour_fk
    FOREIGN KEY (tenant_id, tour_id) REFERENCES scheduling.tours (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tour_stops_visit_fk
    FOREIGN KEY (tenant_id, visit_id) REFERENCES scheduling.visits (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX tour_stops_visit_idx ON scheduling.tour_stops (tenant_id, visit_id);

CREATE TABLE scheduling.tour_publications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  tour_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  employee_id uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'array'),
  change_summary jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(change_summary) = 'array'),
  published_at timestamptz NOT NULL,
  published_by uuid NOT NULL,
  CONSTRAINT tour_publications_tour_version_uq UNIQUE (tenant_id, tour_id, version),
  CONSTRAINT tour_publications_tour_fk
    FOREIGN KEY (tenant_id, tour_id) REFERENCES scheduling.tours (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT tour_publications_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX tour_publications_latest_idx
  ON scheduling.tour_publications (tenant_id, tour_id, version DESC);

CREATE TABLE scheduling.client_routing_locations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  CONSTRAINT client_routing_locations_client_uq UNIQUE (tenant_id, client_id),
  CONSTRAINT client_routing_locations_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE scheduling.employee_scheduling_preferences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  preferred_weekdays smallint[] NOT NULL DEFAULT '{}',
  preferred_time_windows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preferred_time_windows) = 'array'),
  preferred_start_latitude numeric(9, 6) CHECK (preferred_start_latitude BETWEEN -90 AND 90),
  preferred_start_longitude numeric(9, 6) CHECK (preferred_start_longitude BETWEEN -180 AND 180),
  travel_mode text NOT NULL DEFAULT 'driving' CHECK (travel_mode IN ('driving')),
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  CONSTRAINT employee_scheduling_preferences_employee_uq UNIQUE (tenant_id, employee_id),
  CONSTRAINT employee_scheduling_preferences_days_ck CHECK (preferred_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT employee_scheduling_preferences_start_pair_ck CHECK (
    (preferred_start_latitude IS NULL) = (preferred_start_longitude IS NULL)
  ),
  CONSTRAINT employee_scheduling_preferences_employee_fk
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE scheduling.client_scheduling_preferences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  preferred_weekdays smallint[] NOT NULL DEFAULT '{}',
  preferred_time_windows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preferred_time_windows) = 'array'),
  preferred_employee_id uuid,
  avoided_employee_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  CONSTRAINT client_scheduling_preferences_client_uq UNIQUE (tenant_id, client_id),
  CONSTRAINT client_scheduling_preferences_days_ck CHECK (preferred_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT client_scheduling_preferences_client_fk
    FOREIGN KEY (tenant_id, client_id) REFERENCES clients.clients (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT client_scheduling_preferences_preferred_employee_fk
    FOREIGN KEY (tenant_id, preferred_employee_id) REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'visit_substitutions', 'tours', 'tour_stops', 'tour_publications',
    'client_routing_locations', 'employee_scheduling_preferences', 'client_scheduling_preferences'
  ] LOOP
    EXECUTE format('ALTER TABLE scheduling.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE scheduling.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON scheduling.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON scheduling.visit_assignments TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.visit_substitutions TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.tours TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.tour_stops TO care_app;
GRANT SELECT, INSERT ON scheduling.tour_publications TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.client_routing_locations TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.employee_scheduling_preferences TO care_app;
GRANT SELECT, INSERT, UPDATE ON scheduling.client_scheduling_preferences TO care_app;
