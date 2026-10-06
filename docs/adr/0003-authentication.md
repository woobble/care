# ADR 0003: Use Authentik OIDC with Better Auth sessions

- Status: Accepted
- Date: 2026-10-06

## Context

The platform needs an external identity provider and a server-side browser session. API requests also need access tokens that the API can verify independently.

## Decision

Authentik is the local and deployment OIDC provider. Better Auth handles the Next.js OAuth callback, encrypted provider tokens, and database-backed sessions. The API validates Authentik access tokens against issuer metadata and JWKS. Local identity records pair issuer and subject; local tenant membership and permissions remain in PostgreSQL.

## Consequences

Changing the identity provider does not change tenant authorization data. The Authentik issuer must match the `OIDC_ISSUER` setting exactly. OAuth discovery and verified ID-token checks remain enabled at runtime.

## Alternatives considered

- NextAuth: rejected because Better Auth provides the required OIDC session integration and token access in the chosen Next.js stack.
- Store passwords in the care platform: rejected because Authentik owns credentials, MFA, recovery, and federation.
- Put tenant roles in Authentik claims: rejected because business authorization belongs in the platform database.
