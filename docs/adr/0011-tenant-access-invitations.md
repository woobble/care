# ADR 0011: Match tenant invitations to verified Authentik email

- Status: Accepted
- Date: 2026-10-06

## Context

Authentik owns user credentials, while the Care Platform owns tenant membership and permissions. Administrators need to invite an identity before it has signed in to the platform. Email can change and may be shared across identity providers, so it is not a stable identity key.

## Decision

The permanent external identity key remains `(issuer, subject)`. The platform stores email only when Authentik marks it verified. An administrator may create a tenant invitation for a normalized email address. On sign-in, the platform accepts a matching invitation only when the verified email belongs to the just-resolved local user. It creates a pending membership with no roles; the administrator assigns a seeded role and scopes, then activates it.

Membership states are `pending`, `active`, `inactive`, and `revoked`. Administrators may activate pending or inactive memberships, deactivate active memberships, and revoke any non-revoked membership. Revocation is terminal. An invitation cannot recreate access for a user whose membership in that tenant was revoked; the administrator must use a separate, deliberate identity recovery process if that policy changes later.

Roles and scopes remain separate. The platform seeds Administrator, Office, and Caregiver role definitions. Tenant, organization, and facility scopes are supported where the resource has that context. Client records remain tenant-scoped until the domain has a correct organization or facility relationship.

## Consequences

Authentication by itself never grants tenant access. Invitation matching depends on a verified Authentik email, and the initial platform slice does not send email. Every access mutation is authorized, tenant-scoped, and committed with its audit record and outbox event. Changing a user's email does not alter the stable external identity mapping.

## Alternatives considered

- Use email as the permanent identity key: rejected because email is mutable and does not identify an issuer.
- Activate memberships automatically after sign-in: rejected because an invitation proves identity matching, not the access level to grant.
- Restore revoked memberships when the same email signs in: rejected because revocation must not be bypassed by an invitation.
