# Scheduling and visit planning

The `scheduling` module turns active service-agreement intent into concrete future visits. A `Visit` is one planned appointment with a client, provider context, time range, planned service snapshots, and zero or more employee assignments. It does not state that a service was delivered. Visit execution, performed services, care records, signatures, routes, and billing remain separate future domains.

## Ownership and lifecycle

Scheduling owns visits, visit services, visit assignments, employee unavailability, and generation history. A visit is either `planned`, `confirmed`, or `cancelled`; only planned and confirmed visits participate in overlap checks. Cancellation retains the visit and its history. Visits have one of two explicit origins: `agreement_generated` or `manual`.

Each visit belongs to one tenant, client, organization, and facility. Composite database references keep that context consistent. Each visit service snapshots the catalog code, name, and unit. Agreement-generated services also retain the agreement and agreement-service IDs. Snapshots keep historical schedules readable after catalog changes.

Assignments have active or unassigned status. Unassignment records history instead of deleting the row. Employees must be active and assigned to the visit's facility for the local visit date. The model permits multiple employees per visit; each employee can be assigned only once to the same visit.

## Timezone and conflicts

Visits store unambiguous `timestamptz` values plus the timezone used to plan them. The timezone is selected from facility, then organization, then the platform default `Europe/Berlin`. Office entry uses local dates and times; nonexistent DST wall times are rejected. Repeated fall-back times resolve to the earlier instant. New organizations and facilities can use validated IANA timezone identifiers.

Active visits cannot overlap for the same client. Active assignments cannot overlap for the same employee. An employee unavailability interval blocks assignment. These checks run transactionally with transaction-scoped PostgreSQL advisory locks keyed by client and employee, so concurrent scheduling commands serialize on the same resources. Half-open interval comparison allows one visit to begin exactly when another ends. Facility-wide overlap is allowed.

## Agreement generation

Generation is an explicit Office command with an inclusive `from` and `until` date. The configured maximum range defaults to 28 days. Only active agreements and active agreement services in their validity dates are considered.

- `daily` proposes one visit per date.
- `weekly` proposes visits on configured weekdays.
- `interval_days` counts from the agreement-service start date, falling back to the agreement start date.
- `occurrences_per_week` returns unresolved placement counts; it does not choose weekdays.
- `on_demand` creates no visits and remains available for manual visit creation.

An automatic proposal also needs preferred start and end times and a catalog default duration. If the time does not exist at a DST transition, no visit is proposed for that occurrence and it is counted for manual placement. Multiple service lines with the same proposed start and time window are grouped into one visit.

Each generated visit service stores the durable key `<agreementServiceId>:<local-date>`, protected by a tenant-scoped unique index. Generation takes a transaction-scoped client lock before reading keys and writes visits, snapshots, audit, outbox, and generation summary in one transaction. Repeating or concurrently submitting the same range creates each occurrence once. Existing keys are counted and left untouched; manual rescheduling or notes are never overwritten. Agreement edits do not reconcile existing visits. Staff must explicitly resolve future visits before ending an agreement or narrowing validity. Suspension stops new generation but leaves existing visits intact.

Generation reports `generated`, `alreadyExisting`, and `requiresManualPlacement`. A placement conflict is reported as unresolved work so staff can choose another time. No partial batch commits: a database or audit/outbox failure rolls back the command.

## Authorization and privacy

Scheduling requires the corresponding `schedule.*` permission as well as access to the client. Tenant, organization, and facility scope filter visits to the intersection of schedule and client access. Team-scoped schedule reads include only visits with an active assignment to an employee whose team membership is active on the visit's local date. Unassigned visits are not visible through team scope. `assigned_clients` remains unsupported. Caregiver execution reads and mutations use the self-schedule endpoint and additionally require the authenticated user's linked employee to have an active assignment.

Calendar responses expose the client display name, provider names, planned time, status, service snapshots, and active employee summaries. They omit insurance, Pflegegrad, contacts, and the client timeline. Notes stay out of audit metadata and outbox payloads. All scheduling-owned tables have forced tenant RLS in addition to application authorization.

## Audit, events, timeline, and archives

Mutations write audit records and version 1 outbox events in the same transaction. The client timeline shows visit creation, generation, rescheduling, and cancellation with fixed summaries; assignment changes remain in visit history and audit. Event payloads carry resource IDs and operation metadata, not notes.

Future non-cancelled visits prevent client, facility, or organization archive when their context would become invalid. Future assigned visits prevent employee deactivation or archive. Ending an agreement or agreement service is blocked while incompatible future visits remain. Cancelling a visit resolves these guards while preserving operational history. Catalog archival may proceed after active agreements no longer depend on the service; existing visit snapshots remain readable.

## API and interface

The versioned API supports bounded calendar queries, manual creation, rescheduling, lifecycle commands, assignment history, agreement generation, and employee unavailability. Calendar queries return a joined read model with related service and assignment summaries rather than issuing one request or query per visit.

The Office UI provides a week/day planning board, filters, open visits, manual planning, visit details and history, assignment, lifecycle actions, and agreement generation. Client and employee detail pages show upcoming visits. Visit execution is a separate module; once it starts, planning cannot cancel, reschedule, or alter that visit's planned services.

## Deliberate limits

Scheduling does not start or complete visits, record actual arrival/departure, assert performed services, collect care documentation or signatures, calculate travel, optimize routes or staffing, send notifications, or create billing facts. Agreement changes do not trigger automatic visit reconciliation, and `occurrences_per_week` waits for Office placement.
