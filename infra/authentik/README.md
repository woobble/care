# Local Authentik

Compose loads `blueprints/care-platform.yaml` into Authentik. The blueprint creates the Care Platform OIDC provider and application with Authorization Code Flow, PKCE support, `openid`, `profile`, and `email` scopes, and this callback:

```text
http://localhost:3000/api/auth/callback/authentik
```

The issuer is `http://localhost:9000/application/o/care-platform/`. Keep the trailing slash and use the same value in `OIDC_ISSUER`; issuer matching is exact.

Authentik owns login credentials and OIDC. Better Auth handles the web session and encrypted provider tokens. The API validates Authentik access tokens independently. Local users, memberships, roles, and permissions stay in PostgreSQL.

The local Care Platform email scope mapping returns `email_verified: true` only when the Authentik user has the administrator-managed `care_email_verified` attribute set to boolean `true`. Authentik's stock email mapping always returns `false`, so invitations intentionally remain unmatched unless the identity provider makes this verification claim. In other environments, configure the provider mapping to use the identity provider's trusted email-verification signal; do not mark every email as verified by default.

For normal local work, create a development user in Authentik, copy that user's OIDC subject into `DEV_SEED_OIDC_SUB`, then run:

```sh
bun run seed:identity
```

The seed grants that configured subject the Demo Care Administrator role. Authentication by itself never grants a tenant membership.

The `care-platform-e2e.yaml` blueprint creates a local, non-expiring API token from `AUTHENTIK_E2E_API_TOKEN` for Playwright. Non-expiring is required because Authentik rotates expired API-token keys, which would invalidate the fixed local secret. Unlike Authentik's `AUTHENTIK_BOOTSTRAP_TOKEN`, the blueprint also works with an existing Authentik database. The single sequential browser journey verifies that sign-in alone grants no access, checks invitation matching and scoped Office access, then follows onboarding and scheduling through caregiver visit execution, evidence acknowledgement, billing, claims, and payment. Keep this token local and out of application runtime configuration in deployed environments. Run the journey in the isolated `care-platform-e2e` Compose project; see [the E2E setup and cleanup steps](../../docs/environment.md#isolated-authentik-browser-e2e).
