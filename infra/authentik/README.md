# Local Authentik

Compose loads `blueprints/care-platform.yaml` into Authentik. The blueprint creates the Care Platform OIDC provider and application with Authorization Code Flow, PKCE support, `openid`, `profile`, and `email` scopes, and this callback:

```text
http://localhost:3000/api/auth/callback/authentik
```

The issuer is `http://localhost:9000/application/o/care-platform/`. Keep the trailing slash and use the same value in `OIDC_ISSUER`; issuer matching is exact.

Authentik owns login credentials and OIDC. Better Auth handles the web session and encrypted provider tokens. The API validates Authentik access tokens independently. Local users, memberships, roles, and permissions stay in PostgreSQL.

For normal local work, create a development user in Authentik, copy that user's OIDC subject into `DEV_SEED_OIDC_SUB`, then run:

```sh
bun run seed:identity
```

The seed grants that configured subject the Demo Care Administrator role. Authentication by itself never grants a tenant membership.

The `care-platform-e2e.yaml` blueprint creates a local API token from `AUTHENTIK_E2E_API_TOKEN` for Playwright. Unlike Authentik's `AUTHENTIK_BOOTSTRAP_TOKEN`, it also works with an existing Authentik database because the blueprint reapplies it on startup. The E2E flow creates a temporary user, verifies just-in-time provisioning, grants only client lifecycle permissions, and removes its own database and Authentik records. Keep this token local and out of application runtime configuration in deployed environments.
