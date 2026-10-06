CREATE INDEX audit_entries_tenant_action_timestamp_idx
  ON audit.audit_entries (tenant_id, action, timestamp DESC);
CREATE INDEX audit_entries_tenant_actor_timestamp_idx
  ON audit.audit_entries (tenant_id, actor_id, timestamp DESC);
