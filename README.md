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

Authentik runs at <http://localhost:9000>. Sign in as `akadmin` with the bootstrap password from `.env`. Its blueprint creates the Care Platform OIDC provider and registers `http://localhost:3000/api/auth/callback/authentik`; no provider setup in the UI is needed.

Create a local Authentik user. The provider uses the Authentik user UUID as the OIDC subject. Set that UUID as `DEV_SEED_OIDC_SUB`, then grant the demo tenant's Administrator role:

```sh
DEV_SEED_OIDC_SUB=<authentik-user-uuid> bun run seed:identity
```

Sign in at <http://localhost:3000>. The demo tenant is `Demo Care`. SeaweedFS provides the S3 endpoint at <http://localhost:9002> and its filer UI at <http://localhost:9004>. SeaweedFS is Apache-2.0 licensed. Use the S3 credentials from `.env` and create the `care-documents` bucket before using document storage.

Mailpit is at <http://localhost:8025> and accepts local SMTP on port `1026`. Prometheus is at <http://localhost:9090>; Grafana is at <http://localhost:3002> (`admin` and the local password in `.env`). The OpenTelemetry Collector accepts OTLP on ports `4317` and `4318`.

`bun run dev` starts web, API, and worker tasks. The web task starts API alongside it when selected on its own. Run without Turbo's deprecated `--parallel` flag.

## Commands

| Command                    | Purpose                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `bun install`              | Install root and workspace dependencies from `bun.lock`                  |
| `bun run build`            | Generate OpenAPI types and build all workspaces                          |
| `bun run typecheck`        | Typecheck every workspace                                                |
| `bun run test`             | Run unit tests                                                           |
| `bun run test:integration` | Run PostgreSQL Testcontainers and API integration tests; Docker required |
| `bun run test:e2e`         | Start Compose, migrate and seed, then run Authentik client lifecycle E2E |
| `bun run migrate`          | Apply checked, transactional SQL migrations                              |
| `bun run seed`             | Create demo tenant, organization, facility, and roles                    |
| `bun run seed:identity`    | Grant a configured Authentik subject demo tenant access                  |
| `bun run infra:down`       | Stop local services; keeps named volumes                                 |

The same module-owned SQL migrations run in development and integration tests. Once applied, a migration's checksum is immutable; add a new numbered migration for schema changes. The identity module has an additional migration for membership and role RLS policies.

The Playwright flow uses the local `AUTHENTIK_E2E_API_TOKEN` to create a temporary user, verifies first-login provisioning grants no tenant membership, grants only client permissions, exercises create/view/activate/archive, then removes its records. Do not use this local token in deployed environments. See [Authentik setup](infra/authentik/README.md) and [environment variables](docs/environment.md).

## Deployment images

Build images from the repository root so each Dockerfile can access the workspace lockfile and sibling packages:

```sh
docker build -f apps/api/Dockerfile -t care-api .
docker build -f apps/worker/Dockerfile -t care-worker .
docker build -f apps/web/Dockerfile -t care-web .
```

Pass runtime settings through the deployment environment. Do not use `.env.example` secrets outside local development. Run migrations as a separate release step with the migration database role.

See [architecture overview](docs/architecture/overview.md), [tenant isolation](docs/security/tenant-isolation.md), and the [ADRs](docs/adr/) for design decisions.
