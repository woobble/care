# Visit execution and performed services

Scheduling records planned work. Visit execution records what happened during one scheduled visit. A scheduled visit can have no execution, one in-progress execution, or one completed execution. The database stores an execution only after it starts; reads represent its absence as `not_started`.

The execution module owns `VisitExecution` and `PerformedService`. Scheduling continues to own visits, planned visit services, assignments, and planned time. Execution never changes planned quantities or treats a scheduled service as delivered.

## Lifecycle and time

The supported transitions are `not_started` to `in_progress` to `completed`. Starting a cancelled visit is rejected. A visit may start while planned or confirmed. The one execution per visit constraint and a visit-row lock make concurrent start retries return the existing execution.

`actualStart` records the server time when the caregiver starts the visit workflow and represents actual arrival for this initial slice. `actualEnd` records the server time when the caregiver completes it and represents actual departure. The model does not store separate workflow-start and arrival timestamps because the product has no behavior that distinguishes them yet. Corrections use a dedicated endpoint and require `visit_execution.correct`, an expected version, and a reason. Audit metadata retains both old and new values.

The mobile caregiver journey uses `/care/today` and `/care/visits/:id`. Starting a visit records the server timestamp and leaves every planned service `not_recorded`. Caregivers explicitly record each outcome and quantity before the completion command can succeed. The Today page combines the caregiver's authorized assigned visits with the latest published tour order; assignments omitted from that publication remain visible in chronological fallback order. The visit page shows the authorized visit note, address, client scheduling weekdays and time windows when configured, planned services, execution, and documentation in one flow. It omits internal preferred or avoided employee IDs.

The visit page's readiness checklist reads execution, service, and documentation state from the existing APIs. It reports missing documentation separately from visit completion: completing execution does not finalize documentation. Finalization remains a separate, version-checked command after all required service evidence is present. No client timer supplies authoritative start or end times.

## Performed services

At start, the API returns each planned visit service as `not_recorded`; it does not insert a performed row or infer delivery. Each planned service needs an explicit `performed`, `partially_performed`, or `not_performed` result before completion. A partial result requires a positive quantity below the planned quantity. A performed result requires a positive quantity. A not-performed result requires a reason and accepts only zero or no actual quantity.

Quantities are decimal strings with three fractional digits and are stored as PostgreSQL `numeric`, never binary floating point. Planned quantity remains the visit-service snapshot. Actual quantity remains on the performed-service record. Service name, code, and unit snapshots preserve historical display when the catalog entry is later archived.

An unplanned service has no `visitServiceId` or agreement-service link. It must be active, valid for the execution date, and available to the visit's organization and facility. It is never added to the scheduled visit. Stable reason codes are `client_declined`, `client_not_present`, `service_not_required`, `time_constraint`, `provider_decision`, and `other`.

Narrative notes and performed-service evidence belong to Care Documentation, not execution. Execution no longer stores an operational note or a performed-service note. The data migration copies existing values into documentation entries and evidence before dropping those columns. Execution still owns actual times, performed-service outcomes, actual quantities, performers, and structured outcome reasons. Service prices belong to Services; completed service amounts may be allocated by Benefits after execution. This module does not create invoices, claims, or acknowledgements.

## Authorization and privacy

Caregiver access resolves the authenticated local user to an active linked employee and checks for that employee's active visit assignment. Tenant membership, a broad tenant scope, or a team read scope alone does not grant execution mutation rights. Office users with `visit_execution.read` can review executions within their normal visit/client scope. Time correction uses the separate `visit_execution.correct` permission; Office does not impersonate caregiver start, service recording, or completion.

Client and employee detail pages use `GET /api/v1/visit-executions/summaries` for recent and upcoming visits. The bounded batch read returns only execution status and actual start/end times after checking each visit's resource scope; caregiver callers also need an active assignment. It does not return operational notes or performed-service details.

Office Operations also reads a bounded execution projection. An in-progress execution whose planned end has passed appears as a `visit_execution_overdue` issue, scoped by `visit_execution.read` and linked to the source visit. The issue clears when the source execution is completed or no longer overdue. Documentation and acknowledgement issues continue to come from their owning modules.

Execution tables use forced tenant RLS and tenant-qualified foreign keys. The application also includes tenant predicates and checks resource scope. Execution details are returned only through authorized reads. Audit and outbox metadata contain IDs, statuses, changed field names, counts, and versions rather than narrative text. The client timeline shows only visit-started and visit-completed summaries; detailed execution changes remain in visit history.

## Concurrency and planning interaction

Each execution has a monotonically increasing version. Service decisions, notes, completion, and corrections require the version observed by the caller. A stale write returns `409 VISIT_EXECUTION_VERSION_CONFLICT`. Each mutation locks the execution row and writes the domain change, audit entry, and versioned outbox event in one transaction. Completion checks every planned service while holding the execution lock, so a service update racing completion has a deterministic winner.

After execution starts, normal scheduling cannot reschedule, cancel, or change planned services for that visit. Completed executions remain immutable through planning. A client, employee, facility, or organization cannot be archived while an execution that depends on it is in progress. Completed historical snapshots remain readable after service catalog archival.
