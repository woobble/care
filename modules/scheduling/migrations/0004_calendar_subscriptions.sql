CREATE TABLE scheduling.calendar_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT calendar_subscriptions_revoked_at_ck
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT calendar_subscriptions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT calendar_subscriptions_employee_fk
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES employees.employees (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT calendar_subscriptions_membership_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES identity.tenant_memberships (tenant_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX calendar_subscriptions_tenant_token_hash_uq
  ON scheduling.calendar_subscriptions (tenant_id, token_hash);
CREATE UNIQUE INDEX calendar_subscriptions_active_employee_uq
  ON scheduling.calendar_subscriptions (tenant_id, employee_id)
  WHERE revoked_at IS NULL;
CREATE INDEX calendar_subscriptions_employee_created_idx
  ON scheduling.calendar_subscriptions (tenant_id, employee_id, created_at);

ALTER TABLE scheduling.calendar_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.calendar_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_subscriptions_tenant_isolation
  ON scheduling.calendar_subscriptions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON scheduling.calendar_subscriptions TO care_app;
