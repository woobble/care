# Client service agreements

The `service-agreements` module owns the relationship between a client and the services the provider plans to deliver. The Office UI uses the neutral German term **Leistungsplanung** to distinguish this client-level plan from statutory provider agreements with payers.

## Boundary and ownership

The service catalog defines what a provider can offer. A service agreement records what the provider plans to deliver to one client. The agreement is not a schedule, visit, performed service, care record, or billing source. Scheduling will later interpret its planning data and create concrete visits through a separate workflow.

The module owns `ServiceAgreement` and `AgreementService`. It references clients, organizations, facilities, and catalog definitions through their public application interfaces and tenant-qualified database keys. Each agreement line snapshots the selected service code, name, and unit so its history remains readable after catalog edits or archival.

Every agreement uses the client's organization and primary facility when it is created and must still match the client's current provider context when it is activated or changed. Provider changes are rejected while an active agreement exists. Historical agreements retain their original provider IDs.

## Lifecycle and validity

Agreements move through `draft`, `active`, `suspended`, and `ended`:

- `draft` can be activated or ended.
- `active` can be suspended or ended.
- `suspended` can be resumed or ended.
- `ended` is terminal. Corrections require a new agreement.

Validity is independent from status. `validFrom` and optional `validUntil` are inclusive calendar dates; a one-day agreement is valid when both dates are equal. Future agreements are allowed. An agreement can be active before its validity begins.

Historical and future agreements are allowed. Two active agreements for the same client, organization, and facility cannot have overlapping inclusive validity periods. Client-row locking serializes activation and creation against this rule. One agreement can have at most one active line for a service definition; one cadence rule should describe that service's planned pattern.

Agreement-service rows use `active` or `ended`. Ending a line retains its snapshot and planning data. Ending an agreement ends its active lines in the same transaction. An active agreement must retain at least one active service line.

## Catalog validation and history

Adding a service and activating or updating an active agreement validates the catalog definition and provider availability for the complete line period. Catalog validity and availability end dates are exclusive; agreement and line validity end dates are inclusive. An unbounded agreement therefore requires a service and availability assignment with no end date.

Archived definitions cannot be assigned again. Archival is rejected while an active agreement uses the service. Existing rows keep their service IDs and display snapshots and remain readable after service archival. Service categories are not snapshotted because service history needs only the definition's code, name, and unit.

Agreement lines may narrow the agreement's date range. An omitted line date inherits the corresponding agreement boundary. A line cannot start earlier or end later than its agreement.

## Planning rules and quantity

`scheduleRule` is a typed discriminated value with `daily`, selected `weekly` weekdays, `occurrences_per_week`, `interval_days`, and `on_demand` variants. The API and database reject empty or duplicate weekday lists, out-of-range counts, and malformed variants. No cron language or visit timestamps are stored.

Optional preferred start and end times are local-time preferences, not scheduled timestamps. They must be supplied together and start before end.

Quantity is an exact decimal string backed by PostgreSQL `numeric(12,3)`. It must be positive and have at most three fractional digits. `occurrence` quantities must be whole numbers; minute, hour, and day quantities may be fractional. No price or currency is stored.

Agreement descriptions and line notes are operational planning text. Audit and event metadata contain IDs and changed field names, never note or description content.

## Authorization and scope

The API defines `service_agreement.read`, `create`, `update`, `activate`, `suspend`, `end`, and `manage_services` permissions. Administrator and Office receive management grants. Caregiver receives read access only. Access also requires `client.read` for the associated client.

Tenant, organization, and facility scopes follow the existing client scope rules. A facility-scoped user sees agreements only for clients whose primary facility is in scope. Team and `assigned_clients` scopes remain unsupported until explicit client/team and caregiver/client assignments exist. The API applies the same checks to agreement and service-line endpoints; RLS is defense in depth.

## Archive behavior

- A client with an active agreement cannot be archived. End or suspend the agreement first; archival does not silently change agreement state.
- Organizations and facilities cannot be archived while active agreements reference them.
- A service definition can be archived after active agreements using it have ended. Historical agreement lines remain readable.
- Agreement and service-line history is retained; the API does not physically delete it.

## Transactions, timeline, and events

Each mutation writes the aggregate change, audit entry, and version 1 outbox event in one unit-of-work transaction. Client timeline queries include agreement audit rows by their `clientId` metadata and render fixed German summaries without exposing raw metadata.

The worker registers handlers for agreement and line events and logs their event types. It does not create schedules or visits.

## API

Agreements are listed and created under `/api/v1/clients/:clientId/service-agreements`. The service-agreement resource supports read, update, activate, suspend, resume, and end commands. Service lines can be listed, added, updated, and ended under `/api/v1/service-agreements/:id/services`. Search supports client, status, organization, facility, validity date, service definition, pagination, and deterministic sorting.
