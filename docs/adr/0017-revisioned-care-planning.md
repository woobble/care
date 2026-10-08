# ADR 0017: Model care planning as a revisioned longitudinal domain

- Status: Accepted
- Date: 2026-10-08

## Context

Care planning changes over time as a person's situation, goals, risks, and support needs change. A single editable record would erase the plan staff acted on, while daily visit documentation and the service agreement answer different questions. Evaluation also needs to describe the result of a particular plan state without silently changing that state.

## Decision

Treat care planning as a first-class domain scoped to a client and provider context (organization and facility). Keep the continuing `CarePlan` identity separate from its versioned revisions. A revision contains the planning state for that point in time: client and professional perspectives, needs, resources, care-plan responses to referenced risks, goals, and measures.

Draft revisions are editable and copy forward the current planning content where applicable. Activation commits the revision as an immutable snapshot. Changes after activation require a new draft revision; prior revisions and their authorship, timestamps, reason, effective date, and history remain readable. Version checks and transaction-level concurrency protection prevent stale or overlapping activation. Enforce at most one current plan in `active` or `under_review` status for a client in a given organization/facility context.

Evaluation is a separate append-only record linked to the plan and evaluated revision. It records the result, summary, evaluator, evaluation time, and optional next review date. An evaluation can leave the plan unchanged or lead to a new revision; it does not rewrite active measures.

Keep measures separate from service agreements, visits, and performed services. Keep clinical observations, assessments, and risk records in clinical documentation and reference them deliberately rather than copying their values. Audit and outbox metadata identify the plan, revision, operation, and changed fields without carrying sensitive narrative content.

## Consequences

The current plan state is derived from its active revision, and history remains reconstructable without a generic diff engine. Editing and activation need version/concurrency checks, parent-child consistency, and a persistence invariant for active-plan uniqueness. Read and management access require client resource scope in addition to tenant isolation. Caregiver visibility can be read-only and visit-relevant without exposing revision administration.

The model adds lifecycle and revision concepts that are more deliberate than editing a single row. Evaluations may call for a revision, but revision creation remains explicit. If a future provider context needs multiple concurrent programs, the model must add an explicit program scope before allowing multiple active plans.

## Alternatives considered

- Destructively update one active plan: rejected because it loses the historic planning state and weakens review of prior care.
- Treat each plan edit as an unstructured status change: rejected because status does not identify an immutable content snapshot or its effective date.
- Put planned measures in service agreements or scheduled visits: rejected because a care instruction is not necessarily a contracted service or a one-to-one scheduled activity.
- Rewrite measures automatically from evaluation results or changed clinical records: rejected because the new planning decision needs explicit professional authorship and a new revision.
