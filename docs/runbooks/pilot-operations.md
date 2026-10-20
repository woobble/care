# Pilot deployment and operations

This runbook covers the single-host Docker Compose pilot. It does not provide high availability or a production RTO/RPO. Keep the host patched, restrict SSH and Docker access, and place backups on a separate encrypted volume or encrypted backup service.

## Initial deployment

Use Docker Engine, Compose 2.24.4 or newer, Bun 1.4+, and Node 24+. Point DNS records for the web, API and Authentik hosts at the VPS, and allow inbound ports 80 and 443 so Caddy can obtain certificates.

Mount a dedicated encrypted backup volume at `/srv/care-backups` and prepare its private directory:

```sh
sudo install -d -o 1000 -g 1000 -m 700 /srv/care-backups
```

From the repository root, run the setup wizard:

```sh
bun run deploy:setup -- --production
```

It asks for the three public hostnames, Caddy's certificate contact email and backup volume path. Mount an encrypted volume at `/srv/care-backups` first, or enter its mount path. Setup creates `.env.production`, random application credentials, PostgreSQL connection secret files, the separate SeaweedFS identities, and a private backup directory. It refuses to overwrite an existing production environment. Generated files are owner-only and assigned to UID `1000` for the runtime containers. Secret values are not printed.

Before the first deploy, set `SMTP_HOST`, `SMTP_FROM`, `SMTP_USERNAME`, and `SMTP_PASSWORD` in `.env.production` to real SMTP credentials. Authentik uses SMTP for account messages; Caddy's certificate email is a separate contact setting. Keep `.env.production` at mode `0600` and do not pass secret values as command-line arguments.

The setup wizard enables self-hosted OSRM for the full Germany extract. The first deploy downloads and preprocesses the map, which needs substantial temporary disk space, RAM, CPU and time. Routing sends coordinates only; it does not send names, notes or care details. To disable routing, run setup with `--without-routing`.

Start the production stack with one command:

```sh
bun run deploy:up -- --production
```

This checks Compose configuration and secret-file permissions, pulls the pinned images, prepares OSRM when enabled, starts the stack and waits for service health. The migration service applies checked, checksummed migrations before API and worker startup. It then runs the production preflight for application configuration, PostgreSQL, object storage, Authentik, API readiness, worker heartbeat and the backup destination. Migrations do not reset or recreate databases.

For later readiness checks, use:

```sh
bun run deploy:check -- --production
```

PostgreSQL, Redis, SeaweedFS, the worker and application stay on private networks. Caddy is the only service that publishes host ports (80 and 443). If you use external S3 instead of the private SeaweedFS service, require HTTPS and confirm the provider's access controls, durability and backup guarantees; recovery sets copy all bucket objects.

## First administrator

Create an operator account in Authentik. Obtain its OIDC `sub` value (the configured provider uses the Authentik user UUID), then create the initial tenant and Administrator membership in the otherwise empty Care database:

```sh
bun run deploy:bootstrap-admin -- --production \
  --tenant-name 'Pilot Care' \
  --tenant-slug pilot-care \
  --subject '<Authentik OIDC sub>' \
  --confirm-initial-admin pilot-care
```

This command requires production configuration and a PostgreSQL superuser. It runs once, only when the database has no tenants, memberships or roles. It creates the tenant, the built-in Administrator, Office and Caregiver roles, the active tenant-scoped Administrator membership, and an audit record in one transaction. It does not create demo clients or service data. Sign in with that Authentik account, create the provider organization and facilities, then invite staff through Administration. The application records invitations but does not send invitation email; deliver invitations through an approved operator process.

Keep Authentik's own administrator separate from the Care Platform administrator. Review and rotate the Authentik bootstrap credential after initial setup using the Authentik administration interface.

## Backups and retention

The recovery set includes custom-format dumps of both `care` and `authentik`, PostgreSQL global roles, all current S3 objects and their content metadata, checksums, migration checksums, forced-RLS counts and selected business-record counts. It streams object bytes to disk and requires an absolute backup directory with mode `0700`; files are created with mode `0600`.

For a paired recovery set, schedule a maintenance window. Stop application, worker and Authentik writes, leave PostgreSQL and object storage running, then create and verify the set:

```sh
docker compose --project-name care-platform-prod --env-file .env.production -f compose.yaml -f compose.production.yaml stop web api worker authentik-server authentik-worker
bun run backup:create -- --production --confirm-quiesced
bun run backup:verify -- --production <recovery-set-id>
docker compose --project-name care-platform-prod --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --wait
```

Do not claim an atomic database/S3 snapshot: this procedure bounds consistency by stopping writers while both databases and the bucket are copied. For an external object-storage provider, also stop any other writers to that bucket. A failed create may leave an incomplete directory; verification and pruning ignore incomplete sets.

Set `BACKUP_DIR` to a dedicated encrypted host volume, outside the repository. The operator container expects the mounted directory to be private and writable by its `bun` user (UID 1000). `BACKUP_RETENTION_DAYS` defaults to 30 and is an operational default, not a legal retention period. Pruning is a dry run unless `--apply` is supplied; it deletes only checksum-verified sets and always keeps the newest verified set:

```sh
bun run backup:prune -- --production
bun run backup:prune -- --production --apply
```

Recovery-set verification checks checksums and confirms that PostgreSQL dump files are readable by `pg_restore`. It does not replace a restore drill. Keep the backup volume encrypted and access-restricted; the files contain personal, clinical, financial and authentication data.

## Restore and recovery drill

Use a fresh isolated PostgreSQL cluster and a separate empty S3 bucket. The target PostgreSQL URL file must connect to the `postgres` maintenance database as a superuser. The target storage JSON file has this shape and must be mode `0600`:

```json
{
  "endpoint": "https://storage-test.example.org",
  "region": "eu-central-1",
  "bucket": "care-recovery-test",
  "accessKey": "target-only-key",
  "secretKey": "target-only-secret",
  "forcePathStyle": false
}
```

Place both target files in `OPERATOR_SECRETS_DIR` (default `./secrets`, mounted read-only at `/run/operator-secrets`). The restore command validates the private files, verified manifest, different PostgreSQL host, separate empty bucket, superuser rights and target PostgreSQL version before changing the target. It refuses to overwrite the source bucket or objects. The target cluster and bucket must be disposable and isolated from production.

```sh
bun run backup:restore -- --production <recovery-set-id> \
  --target-database-url-file /run/operator-secrets/recovery-database-url \
  --target-storage-config-file /run/operator-secrets/recovery-storage.json \
  --confirm-target <target-host>:<target-port>
```

After restore, the tool compares migration checksums, forced-RLS counts, selected record counts and database object references; it reads each restored object back and compares its bytes and metadata. If restore fails after changing either target, discard the isolated cluster and bucket and start with fresh targets before retrying. Do not run this procedure against the live PostgreSQL server or production bucket.

## Upgrades

1. Record the deployed image/application commit and migration registry.
2. Enter maintenance and create a verified paired recovery set.
3. Update the checkout to the reviewed release.
4. Run `bun run deploy:up -- --production`; it pulls the pinned images, applies checksummed migrations before API and worker startup, waits for health and runs preflight.
5. Verify Authentik sign-in, client lookup, caregiver assignment, document retrieval and worker status with synthetic pilot data.

The migration runner serializes concurrent runs and rejects checksum changes. It does not automatically reverse schema changes. For a backward-incompatible migration, prepare a corrective forward migration or restore into an isolated cluster; do not promise an in-place rollback.

## Health and common failures

- `https://<API_HOST>/health/live` reports process liveness. `/health/ready` reports PostgreSQL, object storage, worker heartbeat and optional routing status without connection strings or credentials.
- `bun run deploy:check -- --production` validates production configuration, Compose, database migration checksums, object storage, Authentik discovery, API readiness, worker heartbeat, backup destination and latest verified backup integrity. It reports blocking failures separately from warnings.
- The worker's `/health/ready` endpoint is private to the Compose network. The operator preflight prints the latest scheduler success/failure, pending and dead outbox counts, and heartbeat age.
- Routing is optional. An unavailable configured OSRM endpoint is a warning and does not fail API readiness.
- If Caddy cannot issue a certificate, check DNS, public port reachability, host clock and `CADDY_EMAIL`.
- If migrations fail, keep API and worker stopped, read the migration error, correct the configuration or add a forward migration, then rerun the release step.
- If Authentik discovery fails, compare `OIDC_ISSUER`, the Authentik public URL and the provider redirect URI exactly, including trailing slashes.
- If object storage is unavailable, check bucket policy, endpoint TLS and S3 credentials; do not make the bucket public.
- If worker status is stale or degraded, inspect worker logs and the PostgreSQL `platform.worker_health` row before restarting it.

### Metrics and monitoring

The API and worker expose Prometheus metrics on internal ports `3002` and `3003`. These endpoints are not routed through Caddy. Enable the optional observability profile to scrape them; production includes a starter Care Platform dashboard and alert rules for API readiness, worker availability, scheduler degradation, dead-letter messages and document-generation failures. Review the alert thresholds and configure notification routing with the pilot operator. Choose a unique `GRAFANA_ADMIN_PASSWORD` in `.env.production` even when the profile is disabled, because Compose validates the complete production configuration:

```sh
COMPOSE_PROFILES=observability docker compose --project-name care-platform-prod --env-file .env.production -f compose.yaml -f compose.production.yaml up -d
```

Prometheus is available at `http://127.0.0.1:9090` and Grafana at `http://127.0.0.1:3002` on the host loopback interface only. Use an SSH local forward to inspect them remotely; neither UI is published on a public interface. If traces are also needed, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` in `.env.production` and restart with the same profile.

Useful Prometheus queries include `care_api_readiness`, `care_api_dependency_status{state="unavailable"}`, `increase(care_document_generation_failures_total[15m])`, `care_worker_scheduler_status{state="degraded"}`, `increase(care_worker_outbox_failures_total[15m])`, `care_worker_outbox_messages`, and `time() - care_worker_heartbeat_timestamp_seconds`. Use `bun run deploy:check -- --production` for the age and integrity of the latest verified recovery set. Labels use bounded route templates and operation types; they do not contain tenant or client identifiers. Alert rules and notification routing remain operator configuration.

No production deployment, real-secret preflight or production restore has been verified by repository checks alone.
