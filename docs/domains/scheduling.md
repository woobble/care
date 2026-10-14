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

## Office planner and visit editor

The Office planner now has a day dispatch view with employee lanes and a separate unassigned lane, a week workload view, and a searchable paginated list for the selected week. Shared date and resource filters stay in the URL. Day and week requests use the visible date range and a bounded 100-visit response; when that ceiling is reached, the planner directs staff to the paginated list. The list query applies its search terms and authorization scope in the database before pagination.

Planner visit links open the existing visit detail workflow in an accessible side Sheet during client navigation. The same detail page remains available as a full route for direct links and reloads, and closing the Sheet returns to the planner state. The Sheet uses the existing server actions for time changes, assignment, confirmation, cancellation, and substitution, so the backend remains authoritative for conflicts and lifecycle rules. Dragging visits between time or employee lanes is not enabled: all such changes go through the validated visit commands, while the Sheet provides a direct editor that works with keyboard and touch input.

## API and interface

The versioned API supports bounded calendar queries, searchable and paginated visit lists, manual creation, rescheduling, lifecycle commands, assignment history, agreement generation, and employee unavailability. Calendar queries return a joined read model with related service and assignment summaries rather than issuing one request or query per visit.

The Office UI provides day/week/list planning, filters, open visits, manual planning, visit details and history, assignment, lifecycle actions, and agreement generation. Client and employee detail pages show upcoming visits. Visit execution is a separate module; once it starts, planning cannot cancel, reschedule, or alter that visit's planned services.

## Operational availability and substitutions

Employee working availability is an explicit weekly set of local-time windows with a timezone, optional daily planned-minute limit, travel buffer, and dated exceptions. It is never inferred from employment type and is not payroll time. An empty weekly availability means no working time is configured and appears as unknown in the worklist; an explicit empty schedule means the employee is unavailable. Existing `employee_unavailability` records represent absences and retain a category, status, actor, and protected optional note. Listing absences also returns assigned visits requiring action; creating an absence does not cancel or reassign visits.

Employee and client scheduling preferences are advisory. Preferred weekdays, time windows, preferred employee, avoided employees, an optional authorized employee work-start coordinate, and driving mode are stored separately from availability. Preference mismatches appear as warnings. Substitution proposals retain the active assignment until confirmation. The confirm operation locks the visit and employee resources, rechecks scope and availability, rejects visits with execution started, then records the new active assignment and prior assignment history in one transaction. Only one proposal may be active for a visit.

## Tours, routing, and publication

A tour is unique per employee and local date and contains ordered references to existing visits. Stop edits and assignment/time changes increment the tour version and put it back in draft; route estimates are cleared when the underlying assignment changes. Route estimates never change visit times or service quantities. Publishing checks assignment, execution, availability, and known route feasibility, writes an immutable publication snapshot, and advances the publication version. Each snapshot records stop order, visit IDs, planned instants, employee, travel estimates, publisher, timestamp, and a compact change summary. Earlier snapshots remain stored when a later version is published.

Office staff reorder stops with labeled move-up and move-down controls that work with keyboard and touch. The editor shows the changed draft order and keeps it marked unsaved until staff explicitly save; saving submits the full order and keeps each stop's dispatcher note with its visit. The server checks the expected tour version and validates the proposed sequence before writing it.

Client coordinates are entered and reviewed by authorized Office staff; addresses are not automatically geocoded. When `ROUTING_OSRM_URL` is configured, the self-hosted OSRM driving backend receives normalized coordinates only, without client identity or care information. An employee's optional work-start coordinate can be used for the first route leg; it is intended for an authorized work location and must not be a private home address. If coordinates or the routing service are unavailable, route status is `unresolved` or `unavailable` and feasibility is reported as unknown. Driving is the only supported travel mode. Route order suggestions are previews and do not move appointments or overwrite a publication.

The optional local service defaults to the Nordrhein-Westfalen Geofabrik extract; requests outside the selected extract cannot be routed. Routing sends normalized coordinates only. The API health response reports routing separately and remains healthy when this optional dependency is disabled or unavailable. OSM data is © OpenStreetMap contributors under the Open Database License (ODbL); deployments should retain attribution for displayed routing results. Setup, status, updates, and region limits are documented under [self-hosted routing](../../README.md#self-hosted-routing).

The caregiver's `/care/today` page shows the latest published tour available to the linked employee, its publication time, version, and change summary, and authorized visits with execution links. Visits assigned to the caregiver but missing from the publication remain visible in chronological order with a fallback label; without a publication, all assigned visits use that order. Recently changed assignments and visits show the schedule update time, while the visit card exposes only the client's name, address, brief service list, and visit status. The Open Navigation action is user initiated and opens Google Maps with the destination address in its URL. The address is disclosed to that external mapping service; client names and care details are not included. The application does not provide turn-by-turn navigation.

Scheduling reads and mutations use the existing `schedule.read`, `schedule.update`, and `schedule.assign` permissions together with tenant, organization, facility, team, client, and employee scope. Caregivers can read only their own linked employee schedule and authorized assigned visits. Availability, absence, substitution, routing-location, preference, tour, and publication mutations write audit records and versioned outbox events in the same transaction; event payloads omit absence notes, addresses, and client care details. The new scheduling tables use tenant-qualified foreign keys and forced RLS.

## Deliberate limits

Scheduling does not start or complete visits, record actual arrival/departure, assert performed services, collect care documentation or signatures, optimize staffing, send notifications, or create billing facts. Routing provides driving estimates only; it has no live traffic, GPS tracking, map view, or turn-by-turn navigation. Agreement changes do not trigger automatic visit reconciliation, and `occurrences_per_week` waits for Office placement.
