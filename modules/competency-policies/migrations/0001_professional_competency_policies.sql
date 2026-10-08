CREATE SCHEMA IF NOT EXISTS "authorization";

CREATE TABLE "authorization".professional_competency_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES organizations.tenants(id),
  operation_key text NOT NULL CHECK (operation_key IN ('care_plan.activate', 'care_plan.evaluate')),
  latest_version integer NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_competency_policies_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT professional_competency_policies_tenant_id_operation_uq
    UNIQUE (tenant_id, id, operation_key),
  CONSTRAINT professional_competency_policies_tenant_operation_uq UNIQUE (tenant_id, operation_key)
);

CREATE TABLE "authorization".professional_competency_policy_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  operation_key text NOT NULL CHECK (operation_key IN ('care_plan.activate', 'care_plan.evaluate')),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  description text,
  requirement_mode text NOT NULL CHECK (requirement_mode IN ('ANY', 'ALL')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  requirement_count integer NOT NULL DEFAULT 0 CHECK (
    requirement_count >= 0 AND (status <> 'active' OR requirement_count > 0)
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  CONSTRAINT professional_competency_policy_versions_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT professional_competency_policy_versions_policy_version_uq
    UNIQUE (tenant_id, policy_id, version),
  CONSTRAINT professional_competency_policy_versions_lifecycle_timestamps_check CHECK (
    (status = 'draft' AND activated_at IS NULL AND deactivated_at IS NULL) OR
    (status = 'active' AND activated_at IS NOT NULL AND deactivated_at IS NULL) OR
    (status = 'inactive' AND activated_at IS NOT NULL AND deactivated_at IS NOT NULL)
  ),
  CONSTRAINT professional_competency_policy_versions_policy_fk
    FOREIGN KEY (tenant_id, policy_id, operation_key)
    REFERENCES "authorization".professional_competency_policies (tenant_id, id, operation_key)
);

CREATE UNIQUE INDEX professional_competency_policy_versions_active_operation_uq
  ON "authorization".professional_competency_policy_versions (tenant_id, operation_key)
  WHERE status = 'active';
CREATE INDEX professional_competency_policy_versions_history_idx
  ON "authorization".professional_competency_policy_versions (tenant_id, policy_id, version);

CREATE TABLE "authorization".professional_competency_policy_requirements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  qualification_definition_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_competency_policy_requirements_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT professional_competency_policy_requirements_version_qualification_uq
    UNIQUE (tenant_id, policy_version_id, qualification_definition_id),
  CONSTRAINT professional_competency_policy_requirements_version_fk
    FOREIGN KEY (tenant_id, policy_version_id)
    REFERENCES "authorization".professional_competency_policy_versions (tenant_id, id),
  CONSTRAINT professional_competency_policy_requirements_qualification_fk
    FOREIGN KEY (tenant_id, qualification_definition_id)
    REFERENCES employees.qualification_definitions (tenant_id, id)
);
CREATE INDEX professional_competency_policy_requirements_qualification_idx
  ON "authorization".professional_competency_policy_requirements (tenant_id, qualification_definition_id);

CREATE FUNCTION "authorization".guard_competency_policy_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.operation_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.operation_key, OLD.created_at) OR
     NEW.latest_version < OLD.latest_version OR NEW.latest_version > OLD.latest_version + 1 THEN
    RAISE EXCEPTION 'Competency policy identity is immutable and versions increase one at a time'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_update_check';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER professional_competency_policy_update
  BEFORE UPDATE ON "authorization".professional_competency_policies
  FOR EACH ROW EXECUTE FUNCTION "authorization".guard_competency_policy_update();

CREATE FUNCTION "authorization".guard_competency_policy_version_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'inactive' THEN
    RAISE EXCEPTION 'Inactive competency policy versions are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_version_transition_check';
  END IF;

  IF (NEW.tenant_id, NEW.policy_id, NEW.operation_key, NEW.version, NEW.name, NEW.description,
      NEW.requirement_mode, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.policy_id, OLD.operation_key, OLD.version, OLD.name, OLD.description,
      OLD.requirement_mode, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Competency policy version configuration is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_version_immutable_check';
  END IF;

  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'active') OR
    (OLD.status = 'active' AND NEW.status = 'inactive')
  ) THEN
    RAISE EXCEPTION 'Invalid competency policy version status transition'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_version_transition_check';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'draft' AND
     (NEW.activated_at IS NOT NULL OR NEW.deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Draft competency policy versions cannot have lifecycle timestamps'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_version_transition_check';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'active' AND
     (NEW.activated_at IS NULL OR NEW.deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Activation requires a timestamp and no deactivation timestamp'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_version_transition_check';
  END IF;

  IF OLD.status = 'active' AND
     (NEW.status <> 'inactive' OR NEW.requirement_count <> OLD.requirement_count OR
      NEW.activated_at <> OLD.activated_at OR NEW.deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Active versions may only transition to inactive'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_version_transition_check';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER professional_competency_policy_version_transition
  BEFORE UPDATE ON "authorization".professional_competency_policy_versions
  FOR EACH ROW EXECUTE FUNCTION "authorization".guard_competency_policy_version_transition();

CREATE FUNCTION "authorization".guard_competency_policy_requirement_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
  target_version_id uuid;
  target_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Competency policy requirements are replaced by a new version'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_requirement_immutable_check';
  END IF;

  target_tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.policy_version_id ELSE NEW.policy_version_id END;
  SELECT status INTO target_status
  FROM "authorization".professional_competency_policy_versions
  WHERE tenant_id = target_tenant_id AND id = target_version_id
  FOR UPDATE;

  IF target_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft competency policy requirements may change'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_requirement_immutable_check';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM employees.qualification_definitions
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.qualification_definition_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Archived or missing qualifications cannot be added to policy requirements'
      USING ERRCODE = '23514', CONSTRAINT = 'professional_competency_policy_requirement_active_qualification_check';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER professional_competency_policy_requirement_change
  BEFORE INSERT OR UPDATE OR DELETE ON "authorization".professional_competency_policy_requirements
  FOR EACH ROW EXECUTE FUNCTION "authorization".guard_competency_policy_requirement_change();

CREATE FUNCTION "authorization".adjust_competency_policy_requirement_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "authorization".professional_competency_policy_versions
    SET requirement_count = requirement_count + 1
    WHERE tenant_id = NEW.tenant_id AND id = NEW.policy_version_id;
  ELSE
    UPDATE "authorization".professional_competency_policy_versions
    SET requirement_count = requirement_count - 1
    WHERE tenant_id = OLD.tenant_id AND id = OLD.policy_version_id;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER professional_competency_policy_requirement_count
  AFTER INSERT OR DELETE ON "authorization".professional_competency_policy_requirements
  FOR EACH ROW EXECUTE FUNCTION "authorization".adjust_competency_policy_requirement_count();

ALTER TABLE "authorization".professional_competency_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization".professional_competency_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE "authorization".professional_competency_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization".professional_competency_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE "authorization".professional_competency_policy_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization".professional_competency_policy_requirements FORCE ROW LEVEL SECURITY;

CREATE POLICY professional_competency_policies_tenant_isolation
  ON "authorization".professional_competency_policies
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY professional_competency_policy_versions_tenant_isolation
  ON "authorization".professional_competency_policy_versions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY professional_competency_policy_requirements_tenant_isolation
  ON "authorization".professional_competency_policy_requirements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA "authorization" TO care_app;
GRANT SELECT, INSERT, UPDATE ON "authorization".professional_competency_policies,
  "authorization".professional_competency_policy_versions TO care_app;
GRANT SELECT, INSERT, DELETE ON "authorization".professional_competency_policy_requirements TO care_app;
