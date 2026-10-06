# Tenant isolation

The API treats the OIDC subject and requested tenant as untrusted until verified. A tenant header selects a candidate tenant; it does not grant access.

`OidcGuard` validates the access token and resolves its issuer plus subject to an active local user. `TenantContextGuard` opens the identity transaction, sets `app.user_id` locally, verifies an active membership and tenant, then sets `app.tenant_id` before loading role grants. Client use cases check the requested permission and resource scope before accessing tenant data.

RLS is enabled and forced on tenant-owned tables. Identity membership policies allow self-membership reads when `app.user_id` is set. Role and grant policies also require the verified tenant context. Missing context returns no rows. The worker has a separate, explicit policy for outbox processing.

Context uses PostgreSQL `set_config(..., true)`, so it is transaction-local and cannot leak to a later pooled connection. Application queries still include tenant predicates and authorization checks. RLS is defense in depth, not the fine-grained authorization model.

Integration tests connect as `care_app` and `care_worker`, not only as the migration owner. Changes to identity grants or RLS policies must retain tests for missing context, cross-user memberships, cross-tenant access, and transaction cleanup.
