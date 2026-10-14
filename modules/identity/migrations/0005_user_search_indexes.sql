CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX identity_users_display_name_trgm_idx
  ON identity.users USING gin (display_name gin_trgm_ops)
  WHERE display_name IS NOT NULL;
CREATE INDEX identity_users_email_trgm_idx
  ON identity.users USING gin (email gin_trgm_ops)
  WHERE email IS NOT NULL;
