CREATE TABLE platform.worker_health (
  worker_id text PRIMARY KEY,
  host_name text NOT NULL,
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  scheduler_status text NOT NULL CHECK (
    scheduler_status IN ('starting', 'running', 'degraded', 'stopping', 'stopped')
  ),
  last_scheduled_success_at timestamptz,
  last_scheduled_failure_at timestamptz,
  last_scheduled_failure_name text,
  last_outbox_failure_at timestamptz,
  last_outbox_failure_name text,
  pending_outbox_count integer NOT NULL DEFAULT 0 CHECK (pending_outbox_count >= 0),
  dead_outbox_count integer NOT NULL DEFAULT 0 CHECK (dead_outbox_count >= 0)
);

CREATE INDEX worker_health_heartbeat_idx ON platform.worker_health(heartbeat_at DESC);

ALTER TABLE platform.worker_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.worker_health FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_health_worker_access ON platform.worker_health
  FOR ALL TO care_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_health_api_read ON platform.worker_health
  FOR SELECT TO care_app USING (true);

REVOKE ALL ON platform.worker_health FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON platform.worker_health TO care_worker;
GRANT SELECT ON platform.worker_health TO care_app;
