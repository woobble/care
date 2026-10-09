# Professional competency authorization

This document describes the tenant-owned qualification policies used to authorize Care Plan activation and evaluation. It does not define professional licensing rules; each tenant configures the qualifications required for its own operations.

## Ownership and policy lifecycle

The competency-policy module owns one policy per supported operation: `care_plan.activate` and `care_plan.evaluate`. A policy contains immutable, numbered versions. Administrators create drafts from active qualification definitions, select `ALL` or `ANY` matching, and activate a version. Activation retires the prior active version in the same transaction. Deactivation leaves the policy inactive, so the protected operation remains denied until a version is activated.

Versions and their requirements are append-only after activation. A change creates a new draft version. The database enforces version order, one active version per tenant and operation, lifecycle transitions, non-empty active requirements, same-tenant references, and tenant RLS. An active policy protects its qualification definitions from archival.

## Authorization decision

Care Plan activation and evaluation check the caller's existing permission and the actual plan's tenant, organization, facility, and client scope first. Only then does the evaluator look up the active policy and resolve the caller to a linked employee in that tenant. The employee must be active. Required qualification assignments must be active and valid on the action date; `valid_from` and `valid_until` are inclusive.

`ALL` requires every configured qualification. `ANY` requires at least one. A missing policy, inactive policy, invalid policy, missing employee link, inactive employee, revoked or missing qualification, expired qualification, or incomplete requirement match denies the operation. There is no administrative bypass in this slice. Eligibility previews apply the same permission and evaluation rules used by the mutation.

The evaluator locks the active version and the relevant employee, qualification definition, and assignment rows inside the action transaction. A concurrent version activation, deactivation, archival, employee status change, or assignment revocation therefore waits for the authorized care-plan operation to commit or roll back.

## Evidence and privacy

Successful activation and evaluation record the operation, policy ID and version, employee ID, matched qualification IDs, and evaluation time in audit metadata and the transactional outbox event. Denials use stable, locale-neutral reason codes. Care-plan narratives are not copied into policy events or authorization metadata.

Qualification revocation preserves the assignment row with its revocation timestamp. A later assignment creates a new active row, keeping the prior grant history available to authorized employee readers.

## Relationship to Workforce Compliance

Workforce Compliance uses the competency-policy module's pure `evaluateRequirements` matcher and `qualificationIsValidAt` date rule. It evaluates the complete current active policy for expiry impact and projected readiness, so `ANY` alternatives and `ALL` requirements keep the same meaning in both reporting and authorization. It does not call the transactional evaluator as a worklist decision or copy its caller, permission, resource-scope, and employee-link checks into an employee-wide classification.

The projection is advisory and assumes the current active policy remains unchanged through its configured warning horizon. A missing or inactive policy is a separate blocking configuration finding, not `not_applicable` and not evidence that an employee is noncompliant. No employee-to-operation responsibility mapping exists. Workforce Compliance does not snapshot historical readiness; policy versions and revoked assignments remain reviewable, but a past projection cannot be reconstructed from current assignment facts and the active policy.

Care Plan activation and evaluation continue to run the authoritative evaluator inside the mutation transaction. A compliance result never grants an action, replaces the current policy check, or removes its row locks. See [Workforce qualification compliance](workforce-compliance.md) and [ADR 0020](../adr/0020-advisory-workforce-readiness-projections.md).

## Boundaries

This authorization slice gates Care Plan activation and evaluation. It does not make licensing claims, infer qualifications from job titles, grant action permissions, or evaluate other workflows. Workforce Compliance adds administrative monitoring only; tenant policy administrators remain responsible for configuring accurate requirements and maintaining qualification assignments.
