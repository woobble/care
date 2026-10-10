ALTER TABLE onboarding.cases
  ADD COLUMN funding_plan_details text,
  ADD CONSTRAINT onboarding_cases_funding_details_ck CHECK (
    funding_plan_details IS NULL OR length(trim(funding_plan_details)) BETWEEN 1 AND 1000
  );

INSERT INTO onboarding.checklist_template_items (
  tenant_id, template_id, template_version, code, category, label,
  source, mandatory, requirement_type, sort_order
)
SELECT
  template.tenant_id,
  template.id,
  template.current_version + 1,
  item.code,
  item.category,
  item.label,
  item.source,
  item.mandatory,
  item.requirement_type,
  item.sort_order
FROM onboarding.checklist_templates template
JOIN onboarding.checklist_template_items item
  ON item.tenant_id = template.tenant_id
  AND item.template_id = template.id
  AND item.template_version = template.current_version
WHERE template.name = 'Default'
  AND template.facility_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM onboarding.checklist_template_items current_item
    WHERE current_item.tenant_id = template.tenant_id
      AND current_item.template_id = template.id
      AND current_item.template_version = template.current_version
      AND current_item.code = 'provider_document_evidence'
  );

INSERT INTO onboarding.checklist_template_items (
  tenant_id, template_id, template_version, code, category, label,
  source, mandatory, requirement_type, sort_order
)
SELECT
  template.tenant_id,
  template.id,
  template.current_version + 1,
  'provider_document_evidence',
  'required_documents',
  'Provider-selected document evidence',
  'document',
  FALSE,
  'policy',
  coalesce(max(item.sort_order), -1) + 1
FROM onboarding.checklist_templates template
JOIN onboarding.checklist_template_items item
  ON item.tenant_id = template.tenant_id
  AND item.template_id = template.id
  AND item.template_version = template.current_version + 1
WHERE template.name = 'Default'
  AND template.facility_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM onboarding.checklist_template_items current_item
    WHERE current_item.tenant_id = template.tenant_id
      AND current_item.template_id = template.id
      AND current_item.template_version = template.current_version
      AND current_item.code = 'provider_document_evidence'
  )
GROUP BY template.tenant_id, template.id, template.current_version;

UPDATE onboarding.checklist_templates template
SET current_version = current_version + 1,
    updated_at = now()
WHERE template.name = 'Default'
  AND template.facility_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM onboarding.checklist_template_items item
    WHERE item.tenant_id = template.tenant_id
      AND item.template_id = template.id
      AND item.template_version = template.current_version + 1
      AND item.code = 'provider_document_evidence'
  );

CREATE OR REPLACE FUNCTION onboarding.prevent_admitted_case_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stage = 'admitted' AND (
    NEW.stage IS DISTINCT FROM OLD.stage OR
    NEW.admitted_at IS DISTINCT FROM OLD.admitted_at OR
    NEW.admitted_by_user_id IS DISTINCT FROM OLD.admitted_by_user_id OR
    NEW.decision_snapshot IS DISTINCT FROM OLD.decision_snapshot OR
    NEW.client_id IS DISTINCT FROM OLD.client_id OR
    NEW.checklist_template_id IS DISTINCT FROM OLD.checklist_template_id OR
    NEW.checklist_template_version IS DISTINCT FROM OLD.checklist_template_version
  ) THEN
    RAISE EXCEPTION 'admission decisions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
