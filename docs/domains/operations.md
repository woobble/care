# Office Operations

Operations provides a bounded Office dashboard, a unified worklist, and manual follow-up tasks. It does not own scheduling, documentation, benefit, billing, or claim facts.

## Source boundaries

The worklist reads the existing Scheduling, care documentation, service evidence, Benefits, Billing, and Claims application services. Each source service performs its own read authorization. Operations then applies `operations.read` to the source resource before returning an item. Work items use a deterministic SHA-256 identity from source domain, entity type, entity ID, and issue code.

Source queries are bounded to 100 rows per domain query. The API returns `truncated` when a source window is incomplete. The dashboard returns at most 1,000 projected issues and marks a capped result. Counts are scoped to the visible source permissions and filters. A worklist refresh records current occurrences and advances their last-observed time. It resolves a missing occurrence when a complete source query covers it, or through a bounded exact source read for older scheduling, documentation, and evidence occurrences that may have moved outside the normal query window. Exact checks use the source module's authorization and issue rules. Tenant-scoped advisory locking serializes reconciliation writes.

Acknowledgements and snoozes are append-only interactions attached to an occurrence. Snoozes apply only to noncritical issues and expire within 30 days. They never change source state. Resolved occurrences remain in history. If the same issue returns, it gets a new occurrence with open state; earlier actions remain attached to the resolved occurrence. `GET /api/v1/operations/work-items/:id/history` returns paginated occurrence and interaction history after checking Operations, source-domain, and client permissions. Interactions from before occurrence tracking have no occurrence ID and are shown as legacy history.

## Manual tasks

Tasks support open, in-progress, completed, and cancelled states; low, normal, high, and urgent priorities; optional client/source references; assignment; due dates; comments; and activity. State edits use optimistic version checks. Completed tasks remain stored and can be reopened. Assigned employees must be active and belong to the task organization or facility.

Comments and task descriptions are scoped Office data and are not copied into audit or outbox payloads. Activity and comments are attributable to the acting user. Meaningful task and exception changes write an audit record and outbox event in the same transaction.

## Authorization

Operations permissions are `operations.read`, `operations.tasks.create`, `operations.tasks.manage`, `operations.tasks.assign`, and `operations.exceptions.manage`. Reads and changes are checked against tenant, organization, and facility scopes. Client-scoped tasks retain their client context. A task reference is stored in a type-specific tenant-qualified foreign key and validated with the source module's read permission. A returned source link is included only when the caller can read that source resource; following a link still invokes the source route's authorization.

Caregiver roles receive no Operations permissions. Employees can use the task workflow only when explicitly granted the required Operations permissions.

## Refresh and limitations

Projections are refreshed on dashboard/worklist reads, so they reflect live source data without an outbox consumer or duplicate resolution state. Existing outbox events are emitted only for meaningful Office actions. The first slice does not include a scheduled reconciler, notifications, automatic task creation, or team workload balancing. Due dates are timestamps; task date/time inputs are converted using the selected organization time zone.
