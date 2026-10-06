ALTER TABLE identity.users
  ADD COLUMN display_name text,
  ADD COLUMN email text;

CREATE INDEX identity_users_email_idx ON identity.users(email) WHERE email IS NOT NULL;

ALTER TABLE identity.tenant_memberships
  DROP CONSTRAINT tenant_memberships_status_check,
  ADD CONSTRAINT tenant_memberships_status_check
    CHECK (status IN ('pending', 'active', 'inactive', 'revoked')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE identity.tenant_memberships SET updated_at = created_at;

ALTER TABLE identity.tenant_memberships
  ADD CONSTRAINT tenant_memberships_tenant_user_uq UNIQUE (tenant_id, user_id),
  ADD CONSTRAINT tenant_memberships_tenant_id_id_uq UNIQUE (tenant_id, id);

ALTER TABLE identity.roles
  ADD CONSTRAINT roles_tenant_id_id_uq UNIQUE (tenant_id, id);

ALTER TABLE identity.membership_roles ADD COLUMN tenant_id uuid;
UPDATE identity.membership_roles AS membership_role
SET tenant_id = membership.tenant_id
FROM identity.tenant_memberships AS membership
WHERE membership.id = membership_role.membership_id;
ALTER TABLE identity.membership_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE identity.membership_roles
  ADD CONSTRAINT membership_roles_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES identity.tenant_memberships (id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT membership_roles_role_tenant_fk
    FOREIGN KEY (role_id, tenant_id)
    REFERENCES identity.roles (id, tenant_id) ON DELETE CASCADE;

ALTER TABLE identity.membership_scopes ADD COLUMN tenant_id uuid;
UPDATE identity.membership_scopes AS membership_scope
SET tenant_id = membership.tenant_id
FROM identity.tenant_memberships AS membership
WHERE membership.id = membership_scope.membership_id;
ALTER TABLE identity.membership_scopes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE identity.membership_scopes
  ADD CONSTRAINT membership_scopes_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES identity.tenant_memberships (id, tenant_id) ON DELETE CASCADE;

CREATE TABLE identity.tenant_invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  email text NOT NULL CHECK (email = lower(btrim(email))),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  created_by uuid NOT NULL REFERENCES identity.users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);

CREATE UNIQUE INDEX tenant_invitations_pending_email_uq
  ON identity.tenant_invitations (tenant_id, email)
  WHERE status = 'pending';
CREATE INDEX tenant_invitations_email_pending_idx
  ON identity.tenant_invitations (email, expires_at)
  WHERE status = 'pending';

CREATE FUNCTION identity.validate_membership_scope_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scope_type = 'tenant' THEN
    IF NEW.scope_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'tenant scope must reference its tenant' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.scope_type = 'organization' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organizations.organizations
      WHERE id = NEW.scope_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'organization scope must reference an organization in the same tenant'
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.scope_type = 'facility' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organizations.facilities
      WHERE id = NEW.scope_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'facility scope must reference a facility in the same tenant'
        USING ERRCODE = '23503';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported membership scope type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_scopes_validate_target
  BEFORE INSERT OR UPDATE OF tenant_id, scope_type, scope_id
  ON identity.membership_scopes
  FOR EACH ROW EXECUTE FUNCTION identity.validate_membership_scope_target();

ALTER TABLE identity.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.tenant_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY tenant_memberships_self_read ON identity.tenant_memberships;
CREATE POLICY tenant_memberships_tenant_read ON identity.tenant_memberships
  FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
CREATE POLICY tenant_memberships_tenant_insert ON identity.tenant_memberships
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_memberships_tenant_update ON identity.tenant_memberships
  FOR UPDATE USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE identity.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership_roles FORCE ROW LEVEL SECURITY;
DROP POLICY membership_roles_self_read ON identity.membership_roles;
CREATE POLICY membership_roles_tenant_read ON identity.membership_roles
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY membership_roles_tenant_insert ON identity.membership_roles
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY membership_roles_tenant_delete ON identity.membership_roles
  FOR DELETE USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE identity.membership_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership_scopes FORCE ROW LEVEL SECURITY;
DROP POLICY membership_scopes_self_read ON identity.membership_scopes;
CREATE POLICY membership_scopes_tenant_read ON identity.membership_scopes
  FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM identity.tenant_memberships AS membership
      WHERE membership.id = membership_scopes.membership_id
        AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
CREATE POLICY membership_scopes_tenant_insert ON identity.membership_scopes
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY membership_scopes_tenant_delete ON identity.membership_scopes
  FOR DELETE USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE identity.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.tenant_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_invitations_tenant_read ON identity.tenant_invitations
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_invitations_email_read ON identity.tenant_invitations
  FOR SELECT USING (
    status = 'pending'
    AND email = NULLIF(current_setting('app.user_email', true), '')
  );
CREATE POLICY tenant_invitations_tenant_insert ON identity.tenant_invitations
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_invitations_tenant_update ON identity.tenant_invitations
  FOR UPDATE USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_invitations_email_accept ON identity.tenant_invitations
  FOR UPDATE USING (
    status = 'pending'
    AND email = NULLIF(current_setting('app.user_email', true), '')
  ) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON identity.tenant_memberships TO care_app;
GRANT SELECT, INSERT, DELETE ON identity.membership_roles, identity.membership_scopes TO care_app;
GRANT SELECT, INSERT, UPDATE ON identity.tenant_invitations TO care_app;
