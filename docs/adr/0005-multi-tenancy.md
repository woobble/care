# ADR 0005: Enforce tenant boundaries in PostgreSQL

- Status: Accepted
- Date: 2026-10-06

## Context

Every tenant-scoped API operation must apply the selected tenant and the caller's permissions. A missed application filter could expose another tenant's personal data.

## Decision

Use PostgreSQL row-level security on tenant-owned tables. The API runs as `care_app`, which is not a table owner or superuser. Identity queries set `app.user_id` locally. Tenant access is verified before the same transaction sets `app.tenant_id` and reads tenant grants. Business queries set `app.tenant_id` locally and still check application permissions and resource scope.

## Consequences

Repository predicates remain explicit, while RLS provides a second tenant boundary. Tests connect with the restricted application and worker roles. Background workers receive a narrow explicit policy for outbox delivery.

## Alternatives considered

- Tenant filtering only in application code: rejected because one missed predicate could expose another tenant's records.
- A database per tenant: rejected because the platform must support many tenants without per-tenant connection and migration operations.
- RLS as the only authorization layer: rejected because it cannot express all role, scope, and resource policies.
