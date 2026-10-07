CREATE OR REPLACE FUNCTION visit_execution.prevent_completed_performed_service_mutation()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  execution_status text;
  target_tenant_id uuid;
  target_execution_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant_id := OLD.tenant_id;
    target_execution_id := OLD.execution_id;
  ELSE
    target_tenant_id := NEW.tenant_id;
    target_execution_id := NEW.execution_id;
  END IF;

  SELECT status INTO execution_status
  FROM visit_execution.executions
  WHERE tenant_id = target_tenant_id AND id = target_execution_id
  FOR UPDATE;

  IF execution_status = 'completed' THEN
    RAISE EXCEPTION 'performed services are immutable after execution completion'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER performed_services_completed_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON visit_execution.performed_services
  FOR EACH ROW EXECUTE FUNCTION visit_execution.prevent_completed_performed_service_mutation();
