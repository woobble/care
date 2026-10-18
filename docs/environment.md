# Environment variables

Copy `.env.example` to `.env` for local development. Compose reads it for infrastructure. Bun's automatic env-file loading is disabled; application entry points explicitly load `.env` only in development and `.env.test` only in tests. Production application processes do not load dotenv files. Change local development secrets together when changing a database password or OIDC client secret.

Create `.env.test` from a dedicated synthetic test configuration when a test needs environment variables. Test processes do not fall back to `.env`, and neither Bun nor application dotenv setup selects `.env.production` implicitly.

| Variable                           | Used by                    | Purpose                                                                                                  |
| ---------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | Web, API, worker, seed     | `development`, `test`, or `production`.                                                                  |
| `DATABASE_URL`                     | Web, API                   | Restricted `care_app` connection for application queries.                                                |
| `MIGRATION_DATABASE_URL`           | Migration, seed, E2E setup | Privileged local database connection for schema and fixture operations. Never expose it to browser code. |
| `WORKER_DATABASE_URL`              | Worker                     | Restricted `care_worker` connection for outbox processing.                                               |
| `POSTGRES_PASSWORD`                | Compose                    | PostgreSQL owner password.                                                                               |
| `CARE_APP_PASSWORD`                | Compose                    | Creates the application database password.                                                               |
| `CARE_WORKER_PASSWORD`             | Compose                    | Creates the worker database password.                                                                    |
| `OIDC_ISSUER`                      | Web, API, seed             | Exact Authentik issuer URL, including its trailing slash.                                                |
| `OIDC_CLIENT_ID`                   | Web, API, seed             | OIDC client identifier.                                                                                  |
| `OIDC_CLIENT_SECRET`               | Web, Compose               | Confidential OIDC client secret.                                                                         |
| `AUTH_SECRET`                      | Web                        | Better Auth signing and encryption secret; at least 32 characters.                                       |
| `WEB_ORIGIN`                       | Web, API                   | Public browser origin used for trusted origins and CORS.                                                 |
| `API_INTERNAL_URL`                 | Web                        | API origin used by server-side requests.                                                                 |
| `PORT`                             | API                        | API listen port; defaults to `3001`.                                                                     |
| `SCHEDULE_GENERATION_HORIZON_DAYS` | API                        | Maximum inclusive date range for one visit-generation command; defaults to `28`.                         |
| `OSRM_REGION`                      | Routing CLI                | Geofabrik path for the extract; defaults to `europe/germany/nordrhein-westfalen`.                        |
| `ROUTING_OSRM_URL`                 | API                        | Optional OSRM base URL for driving estimates; leave unset to report routing as unavailable.              |
| `ROUTING_OSRM_PROBE_FROM`          | API, routing CLI           | Region-specific longitude,latitude route health probe start.                                             |
| `ROUTING_OSRM_PROBE_TO`            | API, routing CLI           | Region-specific longitude,latitude route health probe destination.                                       |
| `ROUTING_OSRM_PORT`                | Compose, routing CLI       | Host port for the loopback-only OSRM mapping; defaults to `5000`.                                        |
| `S3_ENDPOINT`                      | Storage                    | S3-compatible SeaweedFS endpoint; local default is `http://localhost:9002`.                              |
| `S3_REGION`                        | Storage                    | S3 signing region.                                                                                       |
| `S3_BUCKET`                        | Storage                    | Bucket for document objects.                                                                             |
| `S3_ACCESS_KEY`                    | Storage, Compose           | Local SeaweedFS access key.                                                                              |
| `S3_SECRET_KEY`                    | Storage, Compose           | Local SeaweedFS secret key.                                                                              |
| `S3_FORCE_PATH_STYLE`              | Storage                    | Use path-style S3 requests; defaults to `true`.                                                          |
| `AUTHENTIK_SECRET_KEY`             | Compose                    | Authentik encryption secret.                                                                             |
| `AUTHENTIK_BOOTSTRAP_PASSWORD`     | Compose                    | Local `akadmin` bootstrap password.                                                                      |
| `AUTHENTIK_E2E_API_TOKEN`          | Compose worker, E2E test   | Local non-expiring API token used to manage temporary E2E identities.                                    |
| `DEV_SEED_OIDC_SUB`                | Identity seed              | Authentik subject granted the local Demo Care Administrator role.                                        |
| `GRAFANA_ADMIN_PASSWORD`           | Compose                    | Local Grafana administrator password.                                                                    |
| `MAILPIT_SMTP_PORT`                | Compose                    | Host port mapped to Mailpit SMTP; defaults to `1026`.                                                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT`      | API, worker                | Optional OTLP HTTP endpoint; local Collector listens on `http://localhost:4318`.                         |
| `WORKER_POLL_INTERVAL_MS`          | Worker                     | Outbox poll interval; defaults to `1000`.                                                                |
| `PLAYWRIGHT_BASE_URL`              | E2E test                   | Optional browser base URL. Defaults to `WEB_ORIGIN`.                                                     |
| `PLAYWRIGHT_BROWSERS_PATH`         | E2E test                   | Optional Playwright browser installation path.                                                           |

Local service endpoints: Authentik `9000`, SeaweedFS S3 `9002`, SeaweedFS filer `9004`, Mailpit SMTP/UI `1026`/`8025`, OTLP `4317`/`4318`, Prometheus `9090`, Grafana `3002`, and optional loopback-only OSRM `5000` when the `routing` Compose profile is enabled. For a host-run API, set `ROUTING_OSRM_URL` to `http://localhost:<ROUTING_OSRM_PORT>`; an API container on the same Compose network uses `http://osrm:5000`. Set the probe coordinates to connected roads inside `OSRM_REGION`. See [self-hosted routing](../README.md#self-hosted-routing) for setup and update commands.

## Production Compose

Production uses `compose.yaml` with `compose.production.yaml` in the separate `care-platform-prod` Compose project and a protected `.env.production` file. Production wrappers require the explicit `--production` argument before accessing that file; direct Compose access must follow the runbook and specify `--project-name care-platform-prod --env-file .env.production`. Local Compose commands target `care-platform-dev`, or a validated isolated `care-platform-e2e` project name. The override removes direct host ports for PostgreSQL, Redis, Authentik, SeaweedFS and OSRM; only Caddy publishes ports 80 and 443. Applications read supported secret files from Docker Compose mounts. Authentik SMTP credentials and bootstrap settings remain in the owner-only environment file because Authentik consumes those environment variables directly.

Copy `.env.production.example` only as a configuration template, replace all placeholders, and create the referenced protected secret files. It is not a runnable deployment or evidence of production readiness. Follow the [pilot operations runbook](runbooks/pilot-operations.md) and [readiness checklist](pilot-readiness.md) before using real data.

`REDIS_URL` is not required by the app worker. Redis remains in Compose for Authentik and future queue-backed jobs.

Both seed commands are development-only and refuse any `NODE_ENV` other than `development`. The general seed creates the Demo Care tenant, organization, two facilities, and Administrator/Office/Caregiver system roles, but grants no user membership. `DEV_SEED_OIDC_SUB` is only used by `bun run seed:identity` to establish the first local administrator. After that bootstrap, tenant access is managed through Administration in the application.

Before `bun run test:e2e`, install the Playwright browser with `bunx playwright install chromium`. On Linux, use `bunx playwright install --with-deps chromium` when system browser libraries are absent. Keep the E2E API token and bootstrap credentials local to the disposable test project.

## Isolated Authentik browser E2E

Run the browser journey against its own Compose project so its PostgreSQL and Authentik data stay separate from the normal local stack. The Compose ports default to `9000` for Authentik, `9002` for SeaweedFS S3, and `9004` for its filer; override them when another local stack uses those ports. Keep `OIDC_ISSUER` and `S3_ENDPOINT` aligned with the chosen ports:

Create an ignored `.env.test` from `.env.example` for the host-run Playwright API, web app, and fixture setup. Set `NODE_ENV=test` and point its database, OIDC, and object-storage settings at the same isolated E2E services. Docker Compose still uses `.env` for the E2E service interpolation. The application loader reads `.env.test` only in test mode; it does not fall back to `.env`.

```sh
SWC_NATIVE_BINDING_CACHE="${XDG_RUNTIME_DIR:?Set a private runtime directory}/care-swc-cache" \
AUTHENTIK_HOST_PORT=19000 \
AUTHENTIK_WEB__BASE_URL=http://localhost:19000 \
SEAWEEDFS_S3_HOST_PORT=19002 \
SEAWEEDFS_FILER_HOST_PORT=19004 \
OIDC_ISSUER=http://localhost:19000/application/o/care-platform/ \
S3_ENDPOINT=http://localhost:19002 \
COMPOSE_PROJECT_NAME=care-platform-e2e \
bun run test:e2e
```

The command starts Compose, applies migrations, seeds the demo tenant, then Playwright starts the API and web app using `.env.test`. The sequential 12-test suite covers identity and access, office onboarding and scheduling, caregiver visit execution and acknowledgement, Operations, and billing, claims, and payment. It needs the local `AUTHENTIK_E2E_API_TOKEN` blueprint. Use a private, user-owned SWC cache directory writable by the execution environment.

The test uses run-scoped records and removes them on early failures. A failure after billing setup can retain records for diagnosis; keep them in the disposable E2E database until browser debugging is complete. Then remove only the isolated stack and its volumes:

```sh
COMPOSE_PROJECT_NAME=care-platform-e2e docker compose -f compose.yaml down --volumes
```

Do not use the general `bun run reset` command to clean E2E data. If SWC reports `ERR_SWC_NATIVE_CACHE`, point `SWC_NATIVE_BINDING_CACHE` at a private, user-owned directory the execution environment can write; do not weaken filesystem permissions.
