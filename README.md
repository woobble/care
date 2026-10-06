# Care Platform

Care Platform is a Bun workspace with a Next.js office app, a NestJS API, and an outbox worker. PostgreSQL owns tenant data, access rules, audit entries, and the event outbox. Authentik provides OIDC; Better Auth manages browser sessions. Shared controls follow shadcn/ui patterns with Radix UI and Tailwind CSS.

## Local setup

Requirements: Bun 1.4.2 or newer, Docker Compose, and Node.js 24 or newer.

```sh
cp .env.example .env
bun install
bun run infra:up
bun run migrate
bun run seed
bun run dev
```

`bun run infra:up` waits for healthy infrastructure. The first database start creates `care_app`, `care_worker`, and Authentik's separate database. PostgreSQL init scripts run only when its volume is empty. If you change a database password later, update the database role and matching URL variables together. Removing the database volume deletes all local database data.

To reset local Docker-backed data, stop `bun run dev` and run `bun run reset` from a terminal. It asks you to type `RESET`, removes the current Compose project's containers and volumes, starts the infrastructure again, then runs migrations and the demo seed. This deletes PostgreSQL data (including Authentik users), Redis data, SeaweedFS files, Prometheus metrics, and Grafana state. Source files, `.env`, dependencies, and Docker images are kept. After creating a new Authentik user, run `DEV_SEED_OIDC_SUB=<new-authentik-user-uuid> bun run seed:identity` to restore tenant access.

Authentik runs at <http://localhost:9000>. Sign in as `akadmin` with the bootstrap password from `.env`. Its blueprint creates the Care Platform OIDC provider and registers `http://localhost:3000/api/auth/callback/authentik`; no provider setup in the UI is needed.

Create a local Authentik user. The provider uses the Authentik user UUID as the OIDC subject. Set that UUID as `DEV_SEED_OIDC_SUB`, then grant the demo tenant's Administrator role:

```sh
DEV_SEED_OIDC_SUB=<authentik-user-uuid> bun run seed:identity
```

Sign in at <http://localhost:3000>. The demo tenant is `Demo Care`. SeaweedFS provides the S3 endpoint at <http://localhost:9002> and its filer UI at <http://localhost:9004>. SeaweedFS is Apache-2.0 licensed. Use the S3 credentials from `.env` and create the `care-documents` bucket before using document storage.

Mailpit is at <http://localhost:8025> and accepts local SMTP on port `1026`. Prometheus is at <http://localhost:9090>; Grafana is at <http://localhost:3002> (`admin` and the local password in `.env`). The OpenTelemetry Collector accepts OTLP on ports `4317` and `4318`.

`bun run dev` starts web, API, and worker tasks. The web task starts API alongside it when selected on its own. Run without Turbo's deprecated `--parallel` flag.

## Commands

| Command                    | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `bun install`              | Install root and workspace dependencies from `bun.lock`                   |
| `bun run build`            | Generate OpenAPI types and build all workspaces                           |
| `bun run typecheck`        | Typecheck every workspace                                                 |
| `bun run test`             | Run unit tests                                                            |
| `bun run test:integration` | Run PostgreSQL Testcontainers and API integration tests; Docker required  |
| `bun run test:e2e`         | Start Compose, migrate and seed, then run Authentik access and client E2E |
| `bun run migrate`          | Apply checked, transactional SQL migrations                               |
| `bun run seed`             | Create demo tenant, organization, facility, and roles                     |
| `bun run seed:identity`    | Grant a configured Authentik subject demo tenant access                   |
| `bun run infra:down`       | Stop local services; keeps named volumes                                  |
| `bun run reset`            | Confirm and reset Compose data; reruns migrations and demo seed           |

The same module-owned SQL migrations run in development and integration tests. Once applied, a migration's checksum is immutable; add a new numbered migration for schema changes. The identity module has an additional migration for membership and role RLS policies.

The Playwright flow uses the local `AUTHENTIK_E2E_API_TOKEN` to create temporary Authentik identities, bootstraps one test administrator, invites a second identity, assigns Office access to Facility West, checks the audit UI and tenant scope, then removes its records. The local OIDC email mapping only emits `email_verified: true` when an Authentik administrator sets `care_email_verified: true`; the test does this only for its invitee. Do not use this local token in deployed environments. See [Authentik setup](infra/authentik/README.md) and [environment variables](docs/environment.md).

## Tenant access administration

Tenant administrators manage membership under **Administration → Users & Access**. They can invite an email address, review members and invitations, assign the seeded Administrator, Office, or Caregiver role, choose tenant, organization, or facility scopes, activate or deactivate access, and revoke access permanently. Sign-in alone never grants access. An invited identity must sign in through Authentik with that verified email before it appears as a pending member; an administrator then assigns access and activates it. Invitations are recorded in the platform, but this slice does not send email.

**Administration → Organizations** shows the tenant's readable organization and facility structure. **Administration → Audit Log** shows access and domain changes permitted by `audit.read`. The API remains authoritative for permission checks, tenant boundaries, scope validation, and audit/outbox writes. Client records currently have tenant ownership only, so facility and organization scopes apply to organization/facility reads but are not inferred for clients.

The general `bun run seed` command creates Demo Care, Demo Pflegedienst, Main Office, Facility West, and the three system roles. It does not grant a user access. `bun run seed:identity` grants the configured local Authentik subject the Demo Care Administrator role. Both seed commands refuse to run unless `NODE_ENV=development`; use them only to create the initial local administrator, then manage memberships in the application.

Install the Playwright Chromium browser once before running the browser suite:

```sh
bunx playwright install chromium
```

On Linux hosts missing browser libraries, install them through Playwright with `bunx playwright install --with-deps chromium`. The browser suite uses the local Authentik blueprint and API token; see [Authentik setup](infra/authentik/README.md).

`openapi-typescript` requires TypeScript 5.x and currently fails against the workspace's TypeScript 7 AST API. The API client package therefore pins TypeScript 5.9.3 for schema generation; application workspaces use TypeScript 7.0.2. Keep the split until the generator supports the workspace compiler version.

## Deployment images

Build images from the repository root so each Dockerfile can access the workspace lockfile and sibling packages:

```sh
docker build -f apps/api/Dockerfile -t care-api .
docker build -f apps/worker/Dockerfile -t care-worker .
docker build -f apps/web/Dockerfile -t care-web .
```

Pass runtime settings through the deployment environment. Do not use `.env.example` secrets outside local development. Run migrations as a separate release step with the migration database role.

See [architecture overview](docs/architecture/overview.md), [tenant isolation](docs/security/tenant-isolation.md), and the [ADRs](docs/adr/) for design decisions.
