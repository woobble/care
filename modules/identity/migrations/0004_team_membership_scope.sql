CREATE OR REPLACE FUNCTION identity.validate_membership_scope_target()
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
  ELSIF NEW.scope_type = 'team' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organizations.teams
      WHERE id = NEW.scope_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'team scope must reference a team in the same tenant'
        USING ERRCODE = '23503';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported membership scope type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
