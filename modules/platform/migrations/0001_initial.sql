CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE platform.outbox_messages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  event jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_pending_idx ON platform.outbox_messages(status, available_at, created_at);

ALTER TABLE platform.outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.outbox_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant_isolation ON platform.outbox_messages
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY outbox_worker_access ON platform.outbox_messages
  FOR ALL TO care_worker USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA platform TO care_app, care_worker;
GRANT INSERT ON platform.outbox_messages TO care_app;
GRANT SELECT ON platform.outbox_messages TO care_worker;
GRANT UPDATE (status, attempt_count, available_at, locked_at, locked_by, delivered_at, last_error)
  ON platform.outbox_messages TO care_worker;
