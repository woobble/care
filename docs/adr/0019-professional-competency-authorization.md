# ADR 0019: Gate Care Plan activation and evaluation with tenant competency policies

- Status: Accepted
- Date: 2026-10-08

## Context

Care-plan authoring permission and resource scope do not establish that the linked professional has the qualifications required for activation or evaluation. Qualification assignments also need valid dates and revocation history. These checks must remain consistent when a policy changes or an assignment is revoked during an action.

## Decision

Add a competency-policy module for the fixed operations `care_plan.activate` and `care_plan.evaluate`. Each tenant can manage versioned `ANY` or `ALL` requirements from active qualification definitions. A care-plan mutation checks permission and plan scope first, then evaluates the active policy, linked employee status, and qualification validity in the same database transaction as the plan change.

Missing or invalid policy configuration denies activation and evaluation. Active policy versions and requirements are immutable; changes use a new draft version, and deactivation leaves the operation denied. Database row locks serialize authorization with policy lifecycle changes, qualification archival, employee status changes, and assignment revocation. Successful mutations write authorization evidence to audit and outbox in the plan transaction. Qualification revocation retains its history row.

## Consequences

Policy administration and qualification assignment need separate grants from care-plan action permissions. Tenants must configure policies and keep employee qualifications current before staff can activate or evaluate plans. A tenant can temporarily block both operations by deactivating its policy. Policy history and revocation history remain available for review.

The authorization evidence records identifiers and time, not clinical narrative. Eligibility preview uses the same evaluator and actual plan resource scope, but the mutation remains authoritative because policy and qualification state can change between preview and action.

## Alternatives considered

- Trust only care-plan permission grants: rejected because they do not establish professional competency.
- Infer qualification from employee title or role: rejected because neither is a verified qualification assignment.
- Permit actions when a tenant has not configured a policy: rejected because an absent requirement would silently bypass the competency gate.
- Reuse one active policy for every operation: rejected because activation and evaluation can require different qualifications.
