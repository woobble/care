# Architecture overview

Care Platform is a TypeScript modular monolith in a Bun workspace. `apps/web` renders the office UI, `apps/api` composes NestJS modules and REST transport, and `apps/worker` handles committed outbox events. Turborepo orders workspace builds and checks.

## Ownership

Business modules own their schemas, migrations, domain invariants, and public application APIs. The API composes those APIs without owning domain rules. Shared packages provide contracts, database access, authorization evaluation, event envelopes, logging, observability, and UI primitives.

PostgreSQL schemas follow module ownership: `identity`, `organizations`, `employees`, `clients`, `audit`, and `platform`. UUIDv7 identifies entities. Drizzle maps tables, while the shared database package owns connections and transaction propagation.

## Request and identity flow

Authentik handles OIDC credentials and login policy. Better Auth validates the browser OAuth callback, stores the encrypted provider tokens, and creates a database-backed session. The web server uses the access token for API calls. The API independently validates issuer, audience, signature, and expiry, then maps issuer plus subject to a local user.

Authentication provisions a local user but grants no tenant membership. Tenant selection is checked against the user's active memberships. The API loads role permissions and scopes through the central authorization package.

## Identity and tenant access administration

The identity module owns tenant memberships, pending invitations, system role assignments, and access scopes. The permanent external identity key is `(issuer, subject)`. A verified Authentik email is a mutable profile attribute used to match an invitation; it never replaces the external identity key. When a verified identity matches an invitation, the platform creates a pending membership without roles. An administrator assigns a seeded role and tenant, organization, or facility scopes, then activates the membership. Inactive memberships can be reactivated by an administrator; revoked memberships are terminal.

Administration endpoints reload the actor's active membership and grants inside each mutation transaction. The central permissions package checks the requested permission and scope, while composite foreign keys and scope-target validation prevent cross-tenant grants from being stored. Each access change commits its audit entry and versioned outbox event with the membership or invitation update. The read side exposes organizations, facilities, members, roles, and tenant audit entries for the office UI.

The seeded Administrator has all current permissions. Office can work with clients, employees, organizations, and facilities but cannot administer tenant access or read audit records. Caregiver has read access to clients and employees and no tenant administration permissions. Roles describe permissions; scope rows describe where those permissions apply. Client records currently have tenant ownership only, so the platform does not infer an organization or facility for client authorization.

## Tenant data flow

Tenant commands and queries run through a unit of work. The unit of work sets the tenant ID with transaction-local PostgreSQL context. RLS provides a second tenant boundary. Client services check permission and scope before reading or changing records.

Client changes, audit entries, and versioned domain events commit together. The worker claims pending outbox rows with a lease, dispatches them, and records delivery, retry, or dead-letter state in PostgreSQL.

## Client slice

The current office slice supports tenant selection, client list and detail, creation, activation, and archival. The browser consumes API types generated from the NestJS OpenAPI document. Shared controls use shadcn/ui component patterns backed by Radix UI and Tailwind CSS.

Tenant members, organization/facility structure, and audit entries are also managed or read from the Administration section. The API client generator is pinned to TypeScript 5.9.3 because `openapi-typescript` 7.13 uses TypeScript 5 AST APIs; app and module typechecks use the workspace TypeScript 7.0.2 compiler.

## Local services

Docker Compose starts PostgreSQL, Redis, Authentik, SeaweedFS, Mailpit, an OpenTelemetry Collector, Prometheus, and Grafana. SeaweedFS provides the local S3-compatible endpoint. The app remains a modular monolith; these local infrastructure services do not create domain service boundaries.
