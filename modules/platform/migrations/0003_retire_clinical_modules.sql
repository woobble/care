-- Keep existing development data intact while removing the obsolete modules from
-- the application. Archived schemas are inaccessible to care_app and can be
-- dropped later only after their contents have been reviewed and approved.
DO $$
DECLARE
  active_schema text;
  archived_schema text;
BEGIN
  FOREACH active_schema IN ARRAY ARRAY[
    'medication',
    'clinical_documentation',
    'care_planning',
    'competency_policies',
    'workforce_compliance'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = active_schema) THEN
      archived_schema := 'retired_' || active_schema;
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = archived_schema) THEN
        RAISE EXCEPTION 'Cannot archive schema %, target schema % already exists',
          active_schema, archived_schema;
      END IF;

      EXECUTE format('ALTER SCHEMA %I RENAME TO %I', active_schema, archived_schema);
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM care_app', archived_schema);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM care_app', archived_schema);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM care_app', archived_schema);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM care_app', archived_schema);
    END IF;
  END LOOP;
END
$$;
