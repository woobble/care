# Architecture overview

Care Platform is a TypeScript modular monolith for German ambulatory Betreuungs- und Entlastungsdienste. Its initial regulatory context is NRW and recognized offers under § 45a SGB XI. `apps/web` serves the Office and caregiver workflows, `apps/api` composes NestJS modules and REST transport, and `apps/worker` handles committed outbox events.

## Ownership

Business modules own their schemas, migrations, domain invariants, and public application APIs. The API composes those APIs without owning domain rules. Shared packages provide contracts, database access, authorization evaluation, event envelopes, logging, observability, and UI primitives.

PostgreSQL schemas follow module ownership: `identity`, `organizations`, `employees`, `authorization`, `clients`, `services`, `service_agreements`, `scheduling`, `visit_execution`, `care_documentation`, `service_evidence`, `benefits`, `billing`, `audit`, and `platform`. UUIDv7 identifies internally generated entities. Drizzle maps tables, while the shared database package owns connections and transaction propagation.

## Identity, tenancy, and authorization

Authentik handles OIDC credentials and login policy. Better Auth validates the browser OAuth callback, stores encrypted provider tokens, and creates a database-backed session. The web server uses the access token for API calls. The API independently validates issuer, audience, signature, and expiry, then maps issuer plus subject to a local user.

Authentication provisions a local user but grants no tenant membership. Tenant selection is checked against the user's active memberships. The identity module owns memberships, invitations, roles, and access scopes. The central permissions package checks each requested permission and resource scope; tenant-local PostgreSQL RLS provides a second data boundary.

The seeded Administrator has all current permissions. Office can manage clients, employees, service definitions and prices, service agreements, planning, documentation review, and benefit administration. Caregivers can access assigned operational visits and service documentation; detailed financial balances require benefit permissions and are not granted to caregivers by default. Qualification and skill records remain employee master data and do not authorize an operation by themselves.

## Organizations, clients, and services

The organizations module owns tenants, organizations, facilities, and teams. Employees belong to an organization and retain qualification, skill, assignment, and employment records. Client master data owns personal and contact information, insurance records, and effective-dated Pflegegrad history; benefit projections use that history instead of copying it.

The services module owns service categories, definitions, benefit classifications, provider availability, and effective-dated prices. Prices use integer EUR cents and explicit units. Billing owns invoice facts and snapshots rather than changing service or price history.

The service-agreements module captures a client's agreed services, quantities, cadence, validity, and provider context. Scheduling creates manual or agreement-generated visits and assignments with bounded calendar reads. Locks and unique generation keys protect overlap checks and repeated generation.

## Visit delivery and evidence

Visit execution records actual arrival and departure, performed-service outcomes, quantities, performers, and outcome reasons. Caregiver mutations require an active employee link and visit assignment. Planning cannot change a visit once execution has started.

Care Documentation owns visit notes, service-related notes, deviations, incidents, finalization, amendments, and evidence completeness. Finalized records are immutable; corrections append attributed history. Service Evidence snapshots finalized service facts and records client or representative acknowledgement. Neither documentation nor acknowledgement constitutes an invoice or payer reimbursement.

## Benefits and budgets

The benefits module owns client funding sources, benefit entitlements, effective-dated rules, monthly allocation buckets, opening balances, corrections, service allocations, and budget projections. The initial rules cover § 45b Entlastungsbetrag and externally informed § 45a Abs. 4 conversion entitlements, plus private and explicitly configured other funding.

Budget projections keep legal entitlement, planned service estimates, provider-recorded usage, and payer-confirmed balances distinct. § 45b carryover expires after June 30 of the following year. Service allocations check the service date, historical Pflegegrad, service category, and applicable NRW provider recognition. Unknown external consumption remains visibly uncertain; scheduling creates estimates only and never consumes funds.

Meaningful mutations commit domain data, audit records, and versioned outbox events in the same transaction. Budget reads do not emit events, although they may materialize dated entitlement buckets with audit attribution. The worker currently records delivery state and performs no billing side effect.

The billing module consumes completed service execution, current service evidence, service prices, and Benefits allocation facts. It owns provider profiles, documented payer arrangements, billing candidates, reservations, invoice drafts and immutable issued snapshots, corrections, PDF artifacts, payments, and receivables. Issuance revalidates and locks performed services so reservations and issued amounts cannot exceed the service total across funding sources. Direct-payer invoices require an effective authorized mandate. Billing never infers reimbursement from an allocation or invoice.

## Office workflows and localization

The Office UI supports client master data, Pflegegrad and insurance, service agreements, visit planning and review, service documentation, benefits and budget history, service allocation, billing candidates, invoices, payments, and receivables. Caregiver navigation focuses on assigned visits, execution, documentation, evidence, and acknowledgement. The browser consumes generated API types from the NestJS OpenAPI document and never accesses the database directly.

English is the default locale and German is also supported through `next-intl`. See [frontend internationalization](../frontend/internationalization.md) and [ADR 0015](../adr/0015-application-internationalization.md).

## Local services

Docker Compose starts PostgreSQL, Redis, Authentik, SeaweedFS, Mailpit, an OpenTelemetry Collector, Prometheus, and Grafana. SeaweedFS provides the local S3-compatible endpoint. These infrastructure services do not create domain service boundaries.
