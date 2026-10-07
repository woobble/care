# Environment variables

Copy `.env.example` to `.env` for local development. Compose reads it for infrastructure. Bun loads it for workspace commands. Change local development secrets together when changing a database password or OIDC client secret.

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

Local service endpoints: Authentik `9000`, SeaweedFS S3 `9002`, SeaweedFS filer `9004`, Mailpit SMTP/UI `1026`/`8025`, OTLP `4317`/`4318`, Prometheus `9090`, and Grafana `3002`.

`REDIS_URL` is not required by the app worker. Redis remains in Compose for Authentik and future queue-backed jobs.

Both seed commands are development-only and refuse any `NODE_ENV` other than `development`. The general seed creates the Demo Care tenant, organization, two facilities, and Administrator/Office/Caregiver system roles, but grants no user membership. `DEV_SEED_OIDC_SUB` is only used by `bun run seed:identity` to establish the first local administrator. After that bootstrap, tenant access is managed through Administration in the application.

Before `bun run test:e2e`, install the Playwright browser with `bunx playwright install chromium`. On Linux, use `bunx playwright install --with-deps chromium` when system browser libraries are absent. The E2E API token and all bootstrap credentials are for local development only.
