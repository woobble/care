# Architecture overview

Care Platform is a TypeScript modular monolith in a Bun workspace. `apps/web` renders the office UI, `apps/api` composes NestJS modules and REST transport, and `apps/worker` handles committed outbox events. Turborepo orders workspace builds and checks.

## Ownership

Business modules own their schemas, migrations, domain invariants, and public application APIs. The API composes those APIs without owning domain rules. Shared packages provide contracts, database access, authorization evaluation, event envelopes, logging, observability, and UI primitives.

PostgreSQL schemas follow module ownership: `identity`, `organizations`, `employees`, `clients`, `services`, `audit`, and `platform`. UUIDv7 identifies entities. Drizzle maps tables, while the shared database package owns connections and transaction propagation.

## Request and identity flow

Authentik handles OIDC credentials and login policy. Better Auth validates the browser OAuth callback, stores the encrypted provider tokens, and creates a database-backed session. The web server uses the access token for API calls. The API independently validates issuer, audience, signature, and expiry, then maps issuer plus subject to a local user.

Authentication provisions a local user but grants no tenant membership. Tenant selection is checked against the user's active memberships. The API loads role permissions and scopes through the central authorization package.

## Identity and tenant access administration

The identity module owns tenant memberships, pending invitations, system role assignments, and access scopes. The permanent external identity key is `(issuer, subject)`. A verified Authentik email is a mutable profile attribute used to match an invitation; it never replaces the external identity key. When a verified identity matches an invitation, the platform creates a pending membership without roles. An administrator assigns a seeded role and tenant, organization, or facility scopes, then activates the membership. Inactive memberships can be reactivated by an administrator; revoked memberships are terminal.

Administration endpoints reload the actor's active membership and grants inside each mutation transaction. The central permissions package checks the requested permission and scope, while composite foreign keys and scope-target validation prevent cross-tenant grants from being stored. Each access change commits its audit entry and versioned outbox event with the membership or invitation update. The read side exposes organizations, facilities, members, roles, and tenant audit entries for the office UI.

The seeded Administrator has all current permissions. Office can manage client master data, employees, and the service catalog, read organization structure, and manage employee assignments, qualifications, skills, and employment metadata. Office cannot administer tenant access, create or archive organizations, or read audit records. Caregiver has read access to clients, employees, operational structure, and services but cannot mutate their master data. Roles describe permissions; scope rows describe where those permissions apply. New clients require an owning organization and primary facility; legacy clients without provider context remain visible only under tenant scope.

## Organization and employee management

The organizations module owns tenant organizations, facilities, and teams. Facilities and teams retain their organization and tenant keys; a team may optionally be based at one facility. The employees module owns employee records, facility assignments, team memberships, employment metadata, and qualification and skill assignments. Qualification and skill definitions are tenant-owned data. Identity remains the owner of local users, memberships, roles, and access scopes: an employee can exist without a user and can link only to an active local user with active membership in the same tenant.

New employees require an owning organization. That ownership defines organization scope even before the employee has a facility assignment. Facility scope includes employees with an active assignment to that facility; team scope includes employees with active membership in that team. Inactive assignments and memberships do not grant scope. Facility assignments retain optional validity dates and one active primary facility; removing the primary promotes another active assignment when one remains. Employees move through active, inactive, and archived states. Organizations, facilities, and teams use active and archived states; archiving an organization with active facilities or teams, or a facility with active teams, is rejected.

The office UI manages organizations, facilities, teams, employee lifecycle and search, assignments, user links, qualifications, skills, and basic employment metadata. Employee search is PostgreSQL-backed, paginated, scoped, and sorted by last name, first name, or creation time. Mutations write audit entries and versioned outbox events in their database transaction. The worker logs these event types until a workflow has a real side effect.

## Tenant data flow

Tenant commands and queries run through a unit of work. The unit of work sets the tenant ID with transaction-local PostgreSQL context. RLS provides a second tenant boundary. Client services check permission and scope before reading or changing records.

Client, organization, and employee changes, audit entries, and versioned domain events commit together. The worker claims pending outbox rows with a lease, dispatches them, and records delivery, retry, or dead-letter state in PostgreSQL.

## Client slice

The clients module owns provider context, personal data, addresses, contacts and their representative roles, insurance relationships, Pflegegrad history, and a client-oriented timeline projection. Organization scope follows the client's owning organization; facility scope follows the primary facility. Team and assigned-client scopes remain unsupported until explicit client/team and caregiver/client assignment records exist. Existing client rows can retain a pair of null provider references after migration; a deliberate provider-context command assigns them, and a database trigger prevents new unassigned clients.

The services module owns service categories, service definitions, and time-bounded organization or facility availability. It is separate from billing: service definitions have no price, payer code, claim, or invoice fields. Service search is PostgreSQL-backed and filters active status, validity, and availability for the caller's organization or facility scope. The worker logs committed domain events until a workflow has a real side effect.

The service-agreements module owns client-level service planning. Agreements capture validity, current provider context, service snapshots, quantities, cadence rules, preferred times, and lifecycle state. They remain separate from the catalog and from future scheduling, visits, performed services, and billing. Active overlaps for a client and provider are rejected; catalog checks run when a line is assigned and when an agreement is activated. Agreement mutations commit audit and versioned outbox rows with the domain change, and the worker currently logs these events without creating schedules.

The Office UI supports paginated client search, client creation and lifecycle, personal data, provider context, addresses, contacts and roles, insurance, Pflegegrad history, the timeline, and client Leistungsplanung. The agreement screen supports draft management, catalog selection by provider and validity, cadence, quantity, preferred time, and lifecycle changes. The service catalog UI supports category and service maintenance, validity, archiving, and organizational availability. These workflows use generated API types from the NestJS OpenAPI document and never access the database directly.

Tenant access, organization structure, qualification and skill definitions, and audit entries are managed from Administration. Employee master data is managed under Employees. The browser consumes API types generated from the NestJS OpenAPI document. The API client generator is pinned to TypeScript 5.9.3 because `openapi-typescript` 7.13 uses TypeScript 5 AST APIs; app and module typechecks use the workspace TypeScript 7.0.2 compiler.

## Local services

Docker Compose starts PostgreSQL, Redis, Authentik, SeaweedFS, Mailpit, an OpenTelemetry Collector, Prometheus, and Grafana. SeaweedFS provides the local S3-compatible endpoint. The app remains a modular monolith; these local infrastructure services do not create domain service boundaries.
