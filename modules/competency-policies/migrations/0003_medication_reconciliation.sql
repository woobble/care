ALTER TABLE "authorization".professional_competency_policies
  DROP CONSTRAINT professional_competency_policies_operation_key_check,
  ADD CONSTRAINT professional_competency_policies_operation_key_check
    CHECK (operation_key IN ('care_plan.activate', 'care_plan.evaluate', 'medication.administer', 'medication.administration.correct', 'medication.reconciliation.complete'));

ALTER TABLE "authorization".professional_competency_policy_versions
  DROP CONSTRAINT professional_competency_policy_versions_operation_key_check,
  ADD CONSTRAINT professional_competency_policy_versions_operation_key_check
    CHECK (operation_key IN ('care_plan.activate', 'care_plan.evaluate', 'medication.administer', 'medication.administration.correct', 'medication.reconciliation.complete'));
