# ADR 0020: Keep workforce readiness as an advisory projection

- Status: Accepted
- Date: 2026-10-08

## Context

Administrators need to see qualification expiry and how current credentials relate to configured professional requirements. The existing competency evaluator authorizes a caller's Care Plan action inside that action's permission, resource-scope, and database transaction. Reusing that evaluator as a dashboard authorization endpoint would mix an administrative worklist with the authority to perform a business operation. Copying its `ANY`/`ALL` rules into another module would let policy semantics drift.

## Decision

The workforce-compliance module owns tenant monitoring settings and read-side projections. Employee qualification assignments remain the source of credential facts; competency policy versions remain the source of operation requirements. Workforce Compliance derives qualification status and readiness without storing duplicate status or eligibility decisions.

The projection reuses the competency-policy module's pure requirement matcher and inclusive date-validity rule. It evaluates the complete current active policy at the reporting date and through the configured warning horizon. Draft or inactive versions are not authoritative. Future readiness assumes that the current active version remains unchanged through the horizon; it does not predict a later policy change.

The current competency evaluator remains the sole authorization authority for Care Plan activation and evaluation. Each mutation continues to check caller permission and resource scope, resolve the linked active employee, and evaluate current qualifications under its transaction locks. A compliance finding cannot grant or deny that action. There is no employee responsibility mapping, so the projection does not label employees noncompliant or use `not_applicable` for an operation without a policy.

Reporting dates use the applicable facility timezone, then organization timezone, then the tenant setting, whose default is `Europe/Berlin`. The thresholds default to 30 critical days and 90 warning days and are tenant-configurable within bounded positive day ranges.

## Consequences

The same pure matching rules govern current eligibility and advisory readiness while their authorization boundaries remain separate. Compliance output can become stale after it is read, so protected mutations must always run the transactional evaluator again. The projection is not a historical record: policy history and revoked qualification rows are retained, but the system does not snapshot each readiness result or preserve all prior assignment-field values needed to reconstruct a past result.

Compliance reads apply employee visibility scope before projection and aggregation, in addition to tenant predicates and forced RLS. Settings changes are audited and emit a versioned outbox event transactionally; reading a finding or reaching an expiry date emits no event. Notification and renewal workflows remain outside this decision.

## Alternatives considered

- Duplicate the `ANY`/`ALL` logic in Workforce Compliance: rejected because authorization and reporting could disagree after a rule change.
- Use the transactional authorization evaluator for dashboard rows: rejected because it evaluates a real caller, permission, and resource scope for a particular mutation rather than an employee worklist.
- Persist projected eligibility: rejected because validity, employee facts, and active policy can change, making stored decisions stale and requiring synchronization or historical snapshot semantics outside this slice.
