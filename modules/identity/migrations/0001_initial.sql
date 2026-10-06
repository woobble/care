CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.external_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  issuer text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE identity.tenant_memberships (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

CREATE TABLE identity.roles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  name text NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE identity.role_permissions (
  role_id uuid NOT NULL REFERENCES identity.roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE identity.membership_roles (
  membership_id uuid NOT NULL REFERENCES identity.tenant_memberships(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES identity.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, role_id)
);

CREATE TABLE identity.membership_scopes (
  membership_id uuid NOT NULL REFERENCES identity.tenant_memberships(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('assigned_clients', 'team', 'facility', 'organization', 'tenant')),
  scope_id uuid NOT NULL,
  PRIMARY KEY (membership_id, scope_type, scope_id)
);

GRANT USAGE ON SCHEMA identity TO care_app;
GRANT SELECT, INSERT, UPDATE ON identity.users, identity.external_identities TO care_app;
GRANT SELECT ON identity.tenant_memberships, identity.roles, identity.role_permissions,
  identity.membership_roles, identity.membership_scopes TO care_app;

ALTER TABLE identity.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_memberships_self_read ON identity.tenant_memberships
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE identity.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_tenant_read ON identity.roles
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM identity.tenant_memberships AS membership
      WHERE membership.tenant_id = roles.tenant_id
        AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.status = 'active'
    )
  );

ALTER TABLE identity.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_tenant_read ON identity.role_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM identity.roles AS role
      WHERE role.id = role_permissions.role_id
    )
  );

ALTER TABLE identity.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_roles_self_read ON identity.membership_roles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM identity.tenant_memberships AS membership
      JOIN identity.roles AS role ON role.id = membership_roles.role_id
      WHERE membership.id = membership_roles.membership_id
        AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND membership.status = 'active'
        AND role.tenant_id = membership.tenant_id
    )
  );

ALTER TABLE identity.membership_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_scopes_self_read ON identity.membership_scopes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM identity.tenant_memberships AS membership
      WHERE membership.id = membership_scopes.membership_id
        AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND membership.status = 'active'
    )
  );

CREATE SCHEMA authentication;

CREATE TABLE authentication.users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX authentication_users_email_uq ON authentication.users(email);

CREATE TABLE authentication.sessions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES authentication.users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX authentication_sessions_token_uq ON authentication.sessions(token);
CREATE INDEX authentication_sessions_user_id_idx ON authentication.sessions(user_id);

CREATE TABLE authentication.accounts (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES authentication.users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX authentication_accounts_provider_account_uq
  ON authentication.accounts(provider_id, account_id);
CREATE INDEX authentication_accounts_user_id_idx ON authentication.accounts(user_id);

CREATE TABLE authentication.verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX authentication_verifications_identifier_idx ON authentication.verifications(identifier);

GRANT USAGE ON SCHEMA authentication TO care_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON authentication.users, authentication.sessions,
  authentication.accounts, authentication.verifications TO care_app;
