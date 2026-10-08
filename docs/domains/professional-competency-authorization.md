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

## Boundaries

This slice gates Care Plan activation and evaluation. It does not make licensing claims, infer qualifications from job titles, grant action permissions, or evaluate other workflows. Tenant policy administrators remain responsible for configuring accurate requirements and maintaining qualification assignments.
