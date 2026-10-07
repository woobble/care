-- Keep writes from racing the identifier map or the reference rewrite.
DO $lock_tables$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN (
      'identity', 'organizations', 'employees', 'clients', 'services',
      'service_agreements', 'scheduling', 'visit_execution', 'audit',
      'platform', 'authentication'
    )
      AND relation.relkind IN ('r', 'p')
    ORDER BY namespace.nspname, relation.relname
  LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE', target.schema_name, target.table_name);
  END LOOP;
  END;
$lock_tables$;

CREATE TEMPORARY TABLE uuid_id_rekey_map (
  old_id uuid PRIMARY KEY,
  new_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMPORARY TABLE auth_id_rekey_map (
  model text NOT NULL,
  old_id text NOT NULL,
  new_id text NOT NULL,
  PRIMARY KEY (model, old_id),
  UNIQUE (model, new_id)
) ON COMMIT DROP;

CREATE TEMPORARY TABLE uuidv7_fk_state (
  schema_name name NOT NULL,
  table_name name NOT NULL,
  constraint_name name NOT NULL,
  was_deferrable boolean NOT NULL,
  was_deferred boolean NOT NULL,
  PRIMARY KEY (schema_name, table_name, constraint_name)
) ON COMMIT DROP;

CREATE TEMPORARY TABLE uuidv7_rls_state (
  schema_name name NOT NULL,
  table_name name NOT NULL,
  PRIMARY KEY (schema_name, table_name)
) ON COMMIT DROP;

CREATE TEMPORARY TABLE uuidv7_trigger_state (
  schema_name name NOT NULL,
  table_name name NOT NULL,
  trigger_name name NOT NULL,
  enabled_state "char" NOT NULL,
  PRIMARY KEY (schema_name, table_name, trigger_name)
) ON COMMIT DROP;

INSERT INTO uuidv7_fk_state (schema_name, table_name, constraint_name, was_deferrable, was_deferred)
SELECT namespace.nspname, relation.relname, constraint_entry.conname,
       constraint_entry.condeferrable, constraint_entry.condeferred
FROM pg_constraint AS constraint_entry
JOIN pg_class AS relation ON relation.oid = constraint_entry.conrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE constraint_entry.contype = 'f'
  AND namespace.nspname IN (
    'identity', 'organizations', 'employees', 'clients', 'services',
    'service_agreements', 'scheduling', 'visit_execution', 'audit',
    'platform', 'authentication'
  );

INSERT INTO uuidv7_rls_state (schema_name, table_name)
SELECT namespace.nspname, relation.relname
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE relation.relforcerowsecurity
  AND namespace.nspname IN (
    'identity', 'organizations', 'employees', 'clients', 'services',
    'service_agreements', 'scheduling', 'visit_execution', 'audit',
    'platform', 'authentication'
  );

INSERT INTO uuidv7_trigger_state (schema_name, table_name, trigger_name, enabled_state)
SELECT namespace.nspname, relation.relname, trigger_entry.tgname, trigger_entry.tgenabled
FROM pg_trigger AS trigger_entry
JOIN pg_class AS relation ON relation.oid = trigger_entry.tgrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE NOT trigger_entry.tgisinternal
  AND namespace.nspname IN (
    'identity', 'organizations', 'employees', 'clients', 'services',
    'service_agreements', 'scheduling', 'visit_execution', 'audit',
    'platform', 'authentication'
  );

DO $defer_constraints$
DECLARE
  target record;
BEGIN
  FOR target IN SELECT * FROM uuidv7_fk_state ORDER BY schema_name, table_name, constraint_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',
      target.schema_name, target.table_name, target.constraint_name
    );
  END LOOP;

  FOR target IN SELECT * FROM uuidv7_rls_state ORDER BY schema_name, table_name
  LOOP
    EXECUTE format('ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY', target.schema_name, target.table_name);
  END LOOP;

  FOR target IN
    SELECT DISTINCT schema_name, table_name
    FROM uuidv7_trigger_state
    ORDER BY schema_name, table_name
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER USER', target.schema_name, target.table_name);
  END LOOP;
  END;
$defer_constraints$;

SET CONSTRAINTS ALL DEFERRED;

DO $rekey_ids$
DECLARE
  target record;
BEGIN
  -- Map every stored UUID value so references to deleted records in history
  -- are rekeyed along with live primary keys.
  FOR target IN
    SELECT table_schema AS schema_name, table_name, column_name
    FROM information_schema.columns
    WHERE data_type = 'uuid'
      AND table_schema IN (
        'identity', 'organizations', 'employees', 'clients', 'services',
        'service_agreements', 'scheduling', 'visit_execution', 'audit', 'platform'
      )
    ORDER BY table_schema, table_name, ordinal_position
  LOOP
    EXECUTE format(
      'INSERT INTO pg_temp.uuid_id_rekey_map (old_id, new_id) '
      'SELECT old_id, uuidv7() FROM (SELECT DISTINCT %1$I AS old_id FROM %2$I.%3$I '
      'WHERE %1$I::text !~* %4$L) AS stored_ids '
      'ON CONFLICT (old_id) DO NOTHING',
      target.column_name, target.schema_name, target.table_name,
      '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
  END LOOP;

  -- Better Auth stores local IDs as text. Preserve valid UUIDv7 values and
  -- replace all other local IDs, including non-UUID legacy values.
  INSERT INTO auth_id_rekey_map (model, old_id, new_id)
  SELECT 'users', id, uuidv7()::text FROM authentication.users
  WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  INSERT INTO auth_id_rekey_map (model, old_id, new_id)
  SELECT 'sessions', id, uuidv7()::text FROM authentication.sessions
  WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  INSERT INTO auth_id_rekey_map (model, old_id, new_id)
  SELECT 'accounts', id, uuidv7()::text FROM authentication.accounts
  WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  INSERT INTO auth_id_rekey_map (model, old_id, new_id)
  SELECT 'verifications', id, uuidv7()::text FROM authentication.verifications
  WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  -- Rewrite every UUID-typed ID and reference, including non-FK references
  -- such as membership scopes, audit fields, and outbox tenant IDs.
  FOR target IN
    SELECT table_schema AS schema_name, table_name, column_name
    FROM information_schema.columns
    WHERE data_type = 'uuid'
      AND table_schema IN (
        'identity', 'organizations', 'employees', 'clients', 'services',
        'service_agreements', 'scheduling', 'visit_execution', 'audit', 'platform'
      )
    ORDER BY table_schema, table_name, ordinal_position
  LOOP
    EXECUTE format(
      'UPDATE %I.%I AS target SET %I = mapping.new_id '
      'FROM pg_temp.uuid_id_rekey_map AS mapping WHERE target.%I = mapping.old_id',
      target.schema_name, target.table_name, target.column_name, target.column_name
    );
  END LOOP;

  UPDATE authentication.users AS auth_user
  SET id = mapping.new_id
  FROM pg_temp.auth_id_rekey_map AS mapping
  WHERE mapping.model = 'users' AND auth_user.id = mapping.old_id;

  UPDATE authentication.sessions AS auth_session
  SET user_id = mapping.new_id
  FROM pg_temp.auth_id_rekey_map AS mapping
  WHERE mapping.model = 'users' AND auth_session.user_id = mapping.old_id;
  UPDATE authentication.accounts AS auth_account
  SET user_id = mapping.new_id
  FROM pg_temp.auth_id_rekey_map AS mapping
  WHERE mapping.model = 'users' AND auth_account.user_id = mapping.old_id;

  UPDATE authentication.sessions AS auth_session
  SET id = mapping.new_id
  FROM pg_temp.auth_id_rekey_map AS mapping
  WHERE mapping.model = 'sessions' AND auth_session.id = mapping.old_id;
  UPDATE authentication.accounts AS auth_account
  SET id = mapping.new_id
  FROM pg_temp.auth_id_rekey_map AS mapping
  WHERE mapping.model = 'accounts' AND auth_account.id = mapping.old_id;
  UPDATE authentication.verifications AS auth_verification
  SET id = mapping.new_id
  FROM pg_temp.auth_id_rekey_map AS mapping
  WHERE mapping.model = 'verifications' AND auth_verification.id = mapping.old_id;
  END;
$rekey_ids$;

CREATE FUNCTION pg_temp.rewrite_uuidv7_json_references(value jsonb, rewrite_value boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
AS $rewrite_json$
DECLARE
  item record;
  rewritten jsonb;
  old_uuid uuid;
  new_uuid uuid;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    rewritten := '{}'::jsonb;
    FOR item IN SELECT pair.key, pair.nested_value FROM jsonb_each(value) AS pair(key, nested_value)
    LOOP
      rewritten := rewritten || jsonb_build_object(
        item.key,
        pg_temp.rewrite_uuidv7_json_references(
          item.nested_value,
          item.key ~* '(id|ids|_id|_ids)$'
          AND item.key !~* '(external|provider|subject|account|issuer)'
        )
      );
    END LOOP;
    RETURN rewritten;
  ELSIF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.rewrite_uuidv7_json_references(element, rewrite_value)),
      '[]'::jsonb
    ) INTO rewritten
    FROM jsonb_array_elements(value) AS elements(element);
    RETURN rewritten;
  ELSIF jsonb_typeof(value) = 'string' AND rewrite_value THEN
    IF (value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      old_uuid := (value #>> '{}')::uuid;
      SELECT new_id INTO new_uuid
      FROM pg_temp.uuid_id_rekey_map
      WHERE old_id = old_uuid;
      IF FOUND THEN
        RETURN to_jsonb(new_uuid::text);
      END IF;
    END IF;
  END IF;
  RETURN value;
  END;
$rewrite_json$;

CREATE FUNCTION pg_temp.collect_uuidv7_json_references(value jsonb, rewrite_value boolean DEFAULT false)
RETURNS SETOF uuid
LANGUAGE plpgsql
AS $collect_json$
DECLARE
  item record;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    FOR item IN SELECT pair.key, pair.nested_value FROM jsonb_each(value) AS pair(key, nested_value)
    LOOP
      RETURN QUERY
      SELECT * FROM pg_temp.collect_uuidv7_json_references(
        item.nested_value,
        item.key ~* '(id|ids|_id|_ids)$'
        AND item.key !~* '(external|provider|subject|account|issuer)'
      );
    END LOOP;
  ELSIF jsonb_typeof(value) = 'array' THEN
    FOR item IN SELECT element FROM jsonb_array_elements(value) AS elements(element)
    LOOP
      RETURN QUERY
      SELECT * FROM pg_temp.collect_uuidv7_json_references(item.element, rewrite_value);
    END LOOP;
  ELSIF jsonb_typeof(value) = 'string' AND rewrite_value THEN
    IF (value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN NEXT (value #>> '{}')::uuid;
    END IF;
  END IF;
  RETURN;
END
$collect_json$;

WITH json_ids AS (
  SELECT found_id AS old_id
  FROM audit.audit_entries AS entry
  CROSS JOIN LATERAL pg_temp.collect_uuidv7_json_references(entry.metadata) AS found_ids(found_id)
  UNION ALL
  SELECT found_id AS old_id
  FROM platform.outbox_messages AS message
  CROSS JOIN LATERAL pg_temp.collect_uuidv7_json_references(message.event) AS found_ids(found_id)
), distinct_json_ids AS (
  SELECT DISTINCT old_id
  FROM json_ids
  WHERE old_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
INSERT INTO uuid_id_rekey_map (old_id, new_id)
SELECT old_id, uuidv7()
FROM distinct_json_ids
ON CONFLICT (old_id) DO NOTHING;

UPDATE audit.audit_entries AS entry
SET metadata = pg_temp.rewrite_uuidv7_json_references(entry.metadata)
WHERE entry.metadata IS DISTINCT FROM pg_temp.rewrite_uuidv7_json_references(entry.metadata);

UPDATE platform.outbox_messages AS message
SET event = pg_temp.rewrite_uuidv7_json_references(message.event)
WHERE message.event IS DISTINCT FROM pg_temp.rewrite_uuidv7_json_references(message.event);

SET CONSTRAINTS ALL IMMEDIATE;

DO $restore_constraints_and_rls$
DECLARE
  target record;
BEGIN
  FOR target IN SELECT * FROM uuidv7_fk_state ORDER BY schema_name, table_name, constraint_name
  LOOP
    IF target.was_deferrable THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY %s',
        target.schema_name, target.table_name, target.constraint_name,
        CASE WHEN target.was_deferred THEN 'DEFERRED' ELSE 'IMMEDIATE' END
      );
    ELSE
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER CONSTRAINT %I NOT DEFERRABLE',
        target.schema_name, target.table_name, target.constraint_name
      );
    END IF;
  END LOOP;

  FOR target IN SELECT * FROM uuidv7_rls_state ORDER BY schema_name, table_name
  LOOP
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', target.schema_name, target.table_name);
  END LOOP;

  FOR target IN
    SELECT * FROM uuidv7_trigger_state
    WHERE enabled_state <> 'D'
    ORDER BY schema_name, table_name, trigger_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE %s TRIGGER %I',
      target.schema_name, target.table_name,
      CASE target.enabled_state
        WHEN 'A' THEN 'ALWAYS'
        WHEN 'R' THEN 'REPLICA'
        ELSE ''
      END,
      target.trigger_name
    );
  END LOOP;
  END;
$restore_constraints_and_rls$;
