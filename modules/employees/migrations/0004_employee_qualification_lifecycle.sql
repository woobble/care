ALTER TABLE employees.employee_qualifications
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE employees.employee_qualifications
SET updated_at = created_at;

ALTER TABLE employees.employee_qualifications
  DROP CONSTRAINT employee_qualification_employee_definition_uq,
  ADD CONSTRAINT employee_qualification_status_check
    CHECK (status IN ('active', 'revoked')),
  ADD CONSTRAINT employee_qualification_revocation_check
    CHECK (
      (status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    );

CREATE UNIQUE INDEX employee_qualification_active_employee_definition_uq
  ON employees.employee_qualifications (tenant_id, employee_id, qualification_id)
  WHERE status = 'active';

CREATE INDEX employee_qualification_employee_history_idx
  ON employees.employee_qualifications (tenant_id, employee_id, qualification_id);
