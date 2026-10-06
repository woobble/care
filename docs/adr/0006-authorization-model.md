# ADR 0006: Centralize authorization in the platform

- Status: Accepted
- Date: 2026-10-06

## Context

Tenant membership, role permissions, and resource scopes determine access to care records. Authentication claims alone cannot represent those rules safely.

## Decision

Resolve verified OIDC identities to local users. Load active tenant membership and explicit grants in the identity module. Evaluate actions and resource scopes through the shared permissions package before application commands and queries run.

## Consequences

Controllers stay focused on HTTP translation. Role names do not become scattered business checks. PostgreSQL RLS limits accidental tenant leaks while application policies make the allow or deny decision.

## Alternatives considered

- Role checks in controllers: rejected because repeated checks drift and are hard to test consistently.
- Authorization only in Authentik: rejected because tenant, employee, facility, team, and client access belong to the care platform.
- A separate policy service: rejected because the modular monolith already provides a clear central authorization boundary.
