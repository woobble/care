# Care Platform

Care Platform is a Bun workspace with a Next.js office app, a NestJS API, and an outbox worker. PostgreSQL owns tenant data, access rules, audit entries, and the event outbox. Authentik provides OIDC; Better Auth manages browser sessions. Shared controls follow shadcn/ui patterns with Radix UI and Tailwind CSS.

## Local setup

Requirements: Bun 1.4.2 (the repository's pinned version), Node.js 24 or newer, and Docker Engine with the Compose v2 plugin for local services and integration tests. The package manifest accepts Bun 1.4.0 or newer; use the pinned 1.4.2 version for reproducible installs.

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run infra:up
bun run migrate
bun run seed
bun run dev
```

`bun run build` generates the API OpenAPI document and API client types before building the workspaces. No separate workspace initialization or code-generation step is needed.

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

| Command                         | Purpose                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile` | Install root and workspace dependencies from `bun.lock`                        |
| `bun run build`                 | Generate OpenAPI types and build all workspaces                                |
| `bun run typecheck`             | Typecheck every workspace                                                      |
| `bun run test`                  | Run unit tests                                                                 |
| `bun run test:integration`      | Run PostgreSQL Testcontainers and API integration tests; Docker required       |
| `bun run test:e2e`              | Start Compose, migrate and seed, then run Authentik, client, and workforce E2E |
| `bun run migrate`               | Apply checked, transactional SQL migrations                                    |
| `bun run seed`                  | Create demo tenant, organization, facility, and roles                          |
| `bun run seed:identity`         | Grant a configured Authentik subject demo tenant access                        |
| `bun run infra:down`            | Stop local services; keeps named volumes                                       |
| `bun run reset`                 | Confirm and reset Compose data; reruns migrations and demo seed                |

If Bun reports `EROFS accessing temporary directory`, run from a writable checkout and point its temporary files and package cache at writable paths. For example:

```sh
mkdir -p /tmp/care-bun-tmp /tmp/care-bun-cache
BUN_TMPDIR=/tmp/care-bun-tmp bun install --frozen-lockfile --cache-dir /tmp/care-bun-cache
```

This is an execution-environment filesystem restriction when the configured paths are read-only; do not change workspace manifests or permissions to work around it. Keep generated files and `node_modules` out of commits.

If Next.js reports `ERR_SWC_NATIVE_CACHE`, set `SWC_NATIVE_BINDING_CACHE` to a user-owned cache directory with trusted parent permissions. Some sandboxes reject every writable cache path; run the build in a normal host checkout rather than weakening filesystem permissions.

The same module-owned SQL migrations run in development and integration tests. Once applied, a migration's checksum is immutable; add a new numbered migration for schema changes. The identity module has an additional migration for membership and role RLS policies.

The Playwright flow uses the local `AUTHENTIK_E2E_API_TOKEN` to create temporary Authentik identities, bootstraps one test administrator, invites a second identity, assigns Office access to Facility West, checks the audit UI and tenant scope, then removes its records. The local OIDC email mapping only emits `email_verified: true` when an Authentik administrator sets `care_email_verified: true`; the test does this only for its invitee. Do not use this local token in deployed environments. See [Authentik setup](infra/authentik/README.md) and [environment variables](docs/environment.md).

## Tenant access administration

Tenant administrators manage membership under **Administration → Users & Access**. They can invite an email address, review members and invitations, assign the seeded Administrator, Office, or Caregiver role, choose tenant, organization, facility, or team scopes, activate or deactivate access, and revoke access permanently. Sign-in alone never grants access. An invited identity must sign in through Authentik with that verified email before it appears as a pending member; an administrator then assigns access and activates it. Invitations are recorded in the platform, but this slice does not send email.

**Administration → Organizations, Facilities, and Teams** manage the provider hierarchy. Organization scope includes employees and clients owned by that organization; facility scope follows an employee's active facility assignment or a client's primary facility. Team scope remains meaningful for employees only; client-team and assigned-client scopes are unsupported until those relationships exist. Legacy clients without provider context remain tenant-visible and appear as unassigned; organization- and facility-scoped users cannot access them. New clients require an organization and primary facility. **Clients** manages personal data, addresses, contacts and representative roles, insurance relationships, Pflegegrad history, and a client-oriented timeline. **Leistungen** manages service categories, service definitions, validity, and organization/facility availability. Service definitions are not billing items and contain no prices. The seeded Caregiver can read services but cannot change the catalog. **Employees** provides paginated search and employee lifecycle, employment metadata, assignments, optional local-user links, qualifications, and skills. Employee records are separate from local identity accounts. **Administration → Qualifications & skills** manages tenant-wide definitions. **Administration → Audit Log** shows access and domain changes permitted by `audit.read`. The API remains authoritative for permissions, tenant boundaries, scope validation, and transactional audit/outbox writes.

The general `bun run seed` command creates Demo Care, Demo Pflegedienst, Main Office, Facility West, the three system roles, and neutral service catalog examples. It does not grant a user access. `bun run seed:identity` grants the configured local Authentik subject the Demo Care Administrator role. Both seed commands refuse to run unless `NODE_ENV=development`; use them only to create the initial local administrator, then manage memberships in the application.

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

## Self-hosted routing

Routing is optional. Normal Compose startup neither starts OSRM nor downloads map data. Leave `ROUTING_OSRM_URL` unset to keep Scheduling's existing unavailable fallback.

The default region is `europe/germany/nordrhein-westfalen`. Copy `.env.example` to `.env`, check that the configured probe points are on connected drivable roads inside the selected region, then prepare and check the dataset:

```sh
cp .env.example .env
bun run routing:setup
bun run routing:status
```

The commands require Node 24+, Docker Compose, `curl`, and network access. They validate `OSRM_REGION` against Geofabrik's official index, download only that extract over HTTPS, and run the MLD pipeline with the same digest-pinned v26.10.0 image used at runtime. The generation-specific PBF and OSRM files live under ignored `data/osrm/`; the runtime mount is read-only. Setup explicitly starts the `routing` profile after preparation. It verifies the configured route probe before reporting ready.

To use a smaller or different extract, set `OSRM_REGION` to a Geofabrik path such as `europe/germany/berlin` and set both `ROUTING_OSRM_PROBE_FROM` and `ROUTING_OSRM_PROBE_TO` to connected road points inside it, then run setup again. An API process on the host uses `ROUTING_OSRM_URL=http://localhost:5000`; an API container on the same Compose network uses `ROUTING_OSRM_URL=http://osrm:5000`. Change the host URL when changing `ROUTING_OSRM_PORT`. This Compose file runs infrastructure only, so pass the internal URL through the API container's deployment environment.

Run `bun run routing:update` to download the latest extract for the configured region. Preprocessing occurs beside the active generation; a failed download or preprocessing leaves the active dataset alone. Updates recreate OSRM and wait for its route health check before discarding the prior generation. If startup fails, the command restores the prior generation and restarts it. Updates briefly interrupt routing. `bun run routing:status` reports application configuration, configured and active region, preparation state, download/preparation dates, dataset availability, and endpoint readiness. To disable routing, unset `ROUTING_OSRM_URL` for the API and stop OSRM with `docker compose --profile routing stop osrm`.

The API health response keeps its overall status healthy when optional routing is disabled or unavailable and reports routing as `not_configured`, `unverified`, `ready`, or `unavailable`. Compose health checks a real OSRM route using the active dataset's probe file. The service is on the internal Compose network; its optional host mapping is bound to loopback, not a public interface.

The selected extract defines routing coverage. Choose a larger region when dispatch routes cross its boundary; OSRM will not fetch adjacent regions automatically. Preprocessing needs temporary disk space for the PBF and generated graph and can require substantial memory and CPU, so size the host for the chosen region. OSM data is © OpenStreetMap contributors under the [Open Database License (ODbL)](https://www.openstreetmap.org/copyright); Geofabrik distributes the extracts. Retain attribution where derived routing results are shown. Routing sends coordinates only, never names, notes, or care details.

See [architecture overview](docs/architecture/overview.md), the [client master-data domain](docs/domains/client-master-data.md), the [service catalog domain](docs/domains/service-catalog.md), [visit execution](docs/domains/visit-execution.md), [care documentation](docs/domains/care-documentation.md), [tenant isolation](docs/security/tenant-isolation.md), [privacy boundaries](docs/security/privacy.md), and the [ADRs](docs/adr/) for design decisions.
