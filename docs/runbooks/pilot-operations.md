# Pilot deployment and operations

This runbook covers the single-host Docker Compose pilot. It does not provide high availability or a production RTO/RPO. Keep the host patched, restrict SSH and Docker access, and place backups on a separate encrypted volume or encrypted backup service.

## Initial deployment

Use Docker Engine and Compose 2.24.4 or newer. Configure DNS for the web, API and Authentik hosts before starting Caddy so it can obtain HTTPS certificates.

```sh
cp .env.production.example .env.production
chmod 600 .env.production
install -d -m 700 secrets /srv/care-backups
```

Edit `.env.production` with the real public hostnames and SMTP settings. Replace every placeholder. Use unique high-entropy values for the PostgreSQL, application, worker, Authentik and OIDC secrets. Keep this file owner-readable only. Do not pass secret values as command-line arguments.

Create the referenced files under `secrets/` with mode `0600` and owner UID `1000`. The API, web, worker and operator containers run as the unprivileged `bun` user with UID `1000`; Compose file secrets preserve host ownership, so a different host operator account must assign the files to UID `1000` for those containers to read them. The deployment command rejects missing, linked, empty, oversized or group/world-readable secret files before invoking Compose.

- `care-database-url`: PostgreSQL URL using `care_app` and database `care`.
- `care-migration-database-url`: PostgreSQL superuser URL using `care_owner` and database `care`; the operator uses it for migrations, paired backups and first-admin setup.
- `care-worker-database-url`: PostgreSQL URL using `care_worker` and database `care`.
- `web-auth-secret`: at least 32 random characters.
- `s3-access-key` and `s3-secret-key`: credentials for the private application bucket.
- `seaweedfs-init-access-key` and `seaweedfs-init-secret-key`: a separate, short-lived bootstrap identity used only to create the bucket.
- `seaweedfs-s3.json`: the SeaweedFS S3 identity configuration. Give the application identity read, list, tagging and write actions; give the bucket-creation identity admin and list actions. Do not reuse the bucket-creation keys for API or worker access.

For the default internal SeaweedFS endpoint, the application identity's keys must match `s3-access-key` and `s3-secret-key`. If using external S3, use external credentials in those two files and keep any unused local SeaweedFS application identity separate. The initialization identity must match the two `S3_INIT_*_FILE` values. The JSON shape is:

```json
{
  "identities": [
    {
      "name": "care-app",
      "credentials": [{ "accessKey": "<app-key>", "secretKey": "<app-secret>" }],
      "actions": ["Read", "List", "Tagging", "Write"]
    },
    {
      "name": "care-init",
      "credentials": [{ "accessKey": "<init-key>", "secretKey": "<init-secret>" }],
      "actions": ["Admin", "List"]
    }
  ]
}
```

The passwords in the three PostgreSQL URLs must match `POSTGRES_PASSWORD`, `CARE_APP_PASSWORD` and `CARE_WORKER_PASSWORD`; URL-encode reserved characters in those URLs. The production Compose file keeps PostgreSQL, Redis, SeaweedFS, the worker and the application on private networks. Caddy is the only service that publishes host ports (80 and 443). The default storage endpoint is the private SeaweedFS service. If you point `S3_ENDPOINT` at an external S3-compatible service, require HTTPS and confirm the provider's access controls, durability and backup guarantees; the recovery tool still copies all bucket objects into the recovery set.

Routing is disabled by default. If enabled, use the internal Compose endpoint `http://osrm:5000` or an HTTPS endpoint for an external routing provider. Route requests contain visit coordinates; approve the provider and processing region before sending real client locations.

Start the stack and check it:

```sh
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build --wait
bun run deploy:check
```

The API migration service applies checksummed migrations before API and worker startup. A PostgreSQL advisory lock serializes concurrent migration invocations. Migrations do not reset or recreate databases.

## First administrator

Create an operator account in Authentik. Obtain its OIDC `sub` value (the configured provider uses the Authentik user UUID), then create the initial tenant and Administrator membership in the otherwise empty Care database:

```sh
bun run deploy:bootstrap-admin -- \
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
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml stop web api worker authentik-server authentik-worker
bun run backup:create -- --confirm-quiesced
bun run backup:verify -- <recovery-set-id>
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --wait
```

Do not claim an atomic database/S3 snapshot: this procedure bounds consistency by stopping writers while both databases and the bucket are copied. For an external object-storage provider, also stop any other writers to that bucket. A failed create may leave an incomplete directory; verification and pruning ignore incomplete sets.

Set `BACKUP_DIR` to a dedicated encrypted host volume, outside the repository. The operator container expects the mounted directory to be private and writable by its `bun` user (UID 1000). `BACKUP_RETENTION_DAYS` defaults to 30 and is an operational default, not a legal retention period. Pruning is a dry run unless `--apply` is supplied; it deletes only checksum-verified sets and always keeps the newest verified set:

```sh
bun run backup:prune
bun run backup:prune -- --apply
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
bun run backup:restore -- <recovery-set-id> \
  --target-database-url-file /run/operator-secrets/recovery-database-url \
  --target-storage-config-file /run/operator-secrets/recovery-storage.json \
  --confirm-target <target-host>:<target-port>
```

After restore, the tool compares migration checksums, forced-RLS counts, selected record counts and database object references; it reads each restored object back and compares its bytes and metadata. If restore fails after changing either target, discard the isolated cluster and bucket and start with fresh targets before retrying. Do not run this procedure against the live PostgreSQL server or production bucket.

## Upgrades

1. Record the deployed image/application commit and migration registry.
2. Enter maintenance and create a verified paired recovery set.
3. Build or pull the reviewed application images.
4. Start the Compose stack; the one-shot migration service applies the additive, checksummed changes before API and worker startup.
5. Run `bun run deploy:check`, then verify Authentik sign-in, client lookup, caregiver assignment, document retrieval and worker status with synthetic pilot data.

The migration runner serializes concurrent runs and rejects checksum changes. It does not automatically reverse schema changes. For a backward-incompatible migration, prepare a corrective forward migration or restore into an isolated cluster; do not promise an in-place rollback.

## Health and common failures

- `https://<API_HOST>/health/live` reports process liveness. `/health/ready` reports PostgreSQL, object storage, worker heartbeat and optional routing status without connection strings or credentials.
- `bun run deploy:check` validates production configuration, Compose, database migration checksums, object storage, Authentik discovery, API readiness, worker heartbeat, backup destination and latest verified backup integrity. It reports blocking failures separately from warnings.
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
COMPOSE_PROFILES=observability docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d
```

Prometheus is available at `http://127.0.0.1:9090` and Grafana at `http://127.0.0.1:3002` on the host loopback interface only. Use an SSH local forward to inspect them remotely; neither UI is published on a public interface. If traces are also needed, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` in `.env.production` and restart with the same profile.

Useful Prometheus queries include `care_api_readiness`, `care_api_dependency_status{state="unavailable"}`, `increase(care_document_generation_failures_total[15m])`, `care_worker_scheduler_status{state="degraded"}`, `increase(care_worker_outbox_failures_total[15m])`, `care_worker_outbox_messages`, and `time() - care_worker_heartbeat_timestamp_seconds`. Use `bun run deploy:check` for the age and integrity of the latest verified recovery set. Labels use bounded route templates and operation types; they do not contain tenant or client identifiers. Alert rules and notification routing remain operator configuration.

No production deployment, real-secret preflight or production restore has been verified by repository checks alone.
