import { createHash } from 'node:crypto';
import { access, lstat, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from 'pg';

import { loadProductionConfig } from '@care/config';
import { migrationFiles } from '@care/database/migrations';
import { createS3ObjectStorage } from '@care/storage';

import { readDatabaseFacts, verifyRecoverySet } from './recovery';

interface WorkerStatus {
  host_name: string;
  heartbeat_at: Date;
  scheduler_status: string;
  last_scheduled_success_at: Date | null;
  last_scheduled_failure_at: Date | null;
  last_scheduled_failure_name: string | null;
  last_outbox_failure_at: Date | null;
  last_outbox_failure_name: string | null;
  pending_outbox_count: number;
  dead_outbox_count: number;
}

export async function runProductionPreflight(): Promise<void> {
  const config = loadProductionConfig();
  const failures: string[] = [];
  const warnings: string[] = [];
  const pass = (name: string, detail: string) => process.stdout.write(`PASS  ${name}: ${detail}\n`);
  const fail = (name: string, detail: string) => {
    failures.push(name);
    process.stdout.write(`FAIL  ${name}: ${detail}\n`);
  };
  const warn = (name: string, detail: string) => {
    warnings.push(name);
    process.stdout.write(`WARN  ${name}: ${detail}\n`);
  };

  pass(
    'production configuration',
    'required URLs, secrets, proxy hops, and retention values are valid',
  );

  try {
    const raw = JSON.parse(await readFile(config.compose.SEAWEEDFS_S3_CONFIG_FILE, 'utf8')) as {
      identities?: {
        credentials?: { accessKey?: string; secretKey?: string }[];
        actions?: string[];
      }[];
    };
    const initIdentity = raw.identities?.find((identity) =>
      identity.credentials?.some(
        (credential) =>
          credential.accessKey === config.compose.S3_INIT_ACCESS_KEY &&
          credential.secretKey === config.compose.S3_INIT_SECRET_KEY,
      ),
    );
    if (!initIdentity?.actions?.includes('Admin') || !initIdentity.actions.includes('List')) {
      throw new Error('SeaweedFS initialization identity is missing the required actions.');
    }
    pass('SeaweedFS initialization identity', 'separate bucket-creation credential is mounted');
  } catch {
    fail(
      'SeaweedFS secret configuration',
      'config file is unreadable or lacks the separate bucket-creation identity',
    );
  }

  try {
    const facts = await readDatabaseFacts(config.migration.MIGRATION_DATABASE_URL);
    const expectedMigrations = await Promise.all(
      migrationFiles.map(async (migration) => ({
        module: migration.module,
        name: migration.name,
        checksum: createHash('sha256')
          .update(await readFile(migration.path, 'utf8'))
          .digest('hex'),
      })),
    );
    const expected = new Map(
      expectedMigrations.map((migration) => [
        `${migration.module}/${migration.name}`,
        migration.checksum,
      ]),
    );
    const applied = new Map(
      facts.migrations.map((migration) => [
        `${migration.module}/${migration.name}`,
        migration.checksum,
      ]),
    );
    const missing = [...expected].filter(
      ([name, checksum]) => applied.get(name) !== checksum,
    ).length;
    const unknown = [...applied.keys()].filter((name) => !expected.has(name)).length;
    if (missing || unknown) {
      fail(
        'database migrations',
        `${missing} missing or changed, ${unknown} newer than this application`,
      );
    } else {
      pass('database connectivity', `PostgreSQL ${facts.serverVersion}`);
      pass('migration readiness', `${facts.migrations.length} checksummed migrations applied`);
      if (facts.forcedRlsTableCount === 0)
        fail('tenant isolation', 'no forced-RLS tables were found');
      else pass('tenant isolation', `${facts.forcedRlsTableCount} forced-RLS tables found`);
    }
  } catch (error) {
    fail('database and migrations', safeError(error));
  }

  try {
    await createS3ObjectStorage({
      endpoint: config.storage.S3_ENDPOINT,
      region: config.storage.S3_REGION,
      bucket: config.storage.S3_BUCKET,
      accessKey: config.storage.S3_ACCESS_KEY,
      secretKey: config.storage.S3_SECRET_KEY,
      forcePathStyle: config.storage.S3_FORCE_PATH_STYLE,
    }).check();
    pass('object storage', `private bucket ${config.storage.S3_BUCKET} is reachable`);
  } catch {
    fail('object storage', 'configured bucket is unavailable or credentials were rejected');
  }

  try {
    const issuerUrl = new URL('.well-known/openid-configuration', config.web.OIDC_ISSUER);
    const response = await fetch(issuerUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`issuer returned HTTP ${response.status}`);
    const metadata = (await response.json()) as { issuer?: string };
    if (metadata.issuer !== config.web.OIDC_ISSUER)
      throw new Error('issuer metadata does not match OIDC_ISSUER');
    pass('Authentik issuer', 'discovery endpoint is reachable and issuer matches exactly');
  } catch (error) {
    fail('Authentik issuer', safeError(error));
  }

  try {
    const response = await fetch(new URL('/health/ready', config.web.API_INTERNAL_URL), {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as {
      status?: string;
      dependencies?: { database?: string; storage?: string; worker?: string; routing?: string };
    };
    if (!response.ok || body.status !== 'ok')
      throw new Error(`API readiness returned HTTP ${response.status}`);
    pass('API readiness', 'database and storage dependencies are ready');
    if (body.dependencies?.worker === 'ready')
      pass('worker heartbeat', 'API sees a current worker heartbeat');
    else if (body.dependencies?.worker === 'degraded')
      warn('worker heartbeat', 'scheduler is running with recent evaluation failures');
    else fail('worker heartbeat', 'API does not see a current worker heartbeat');
    if (body.dependencies?.routing === 'unavailable') {
      warn('optional routing', 'OSRM is configured but unavailable');
    } else {
      pass('optional routing', body.dependencies?.routing ?? 'status not reported');
    }
  } catch (error) {
    fail('API readiness', safeError(error));
  }

  try {
    const response = await fetch('http://worker:3002/health/ready', {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`worker health endpoint returned HTTP ${response.status}`);
    pass('worker process', 'worker health endpoint is ready');
  } catch (error) {
    fail('worker process', safeError(error));
  }

  const worker = await latestWorkerStatus(config.migration.MIGRATION_DATABASE_URL).catch(
    () => null,
  );
  if (worker) {
    const heartbeatAge = Math.max(0, Date.now() - new Date(worker.heartbeat_at).getTime());
    process.stdout.write(
      `Worker status: ${worker.scheduler_status}; last success ${formatTime(worker.last_scheduled_success_at)}; ` +
        `last failure ${formatTime(worker.last_scheduled_failure_at, worker.last_scheduled_failure_name)}; ` +
        `outbox pending ${worker.pending_outbox_count}, dead ${worker.dead_outbox_count}; heartbeat ${Math.round(heartbeatAge / 1000)}s ago.\n`,
    );
    if (worker.dead_outbox_count > 0)
      warn('outbox', `${worker.dead_outbox_count} messages are in the dead-letter state`);
    if (worker.scheduler_status === 'degraded')
      warn('scheduler', 'the latest evaluation cycle reported a failure');
  } else {
    warn('worker diagnostics', 'no persisted worker health row is available');
  }

  try {
    const backupRoot = config.compose.BACKUP_DIR;
    const directory = await lstat(backupRoot);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
      throw new Error('backup destination must be a private directory with mode 0700 or stricter');
    }
    await access(backupRoot, 2);
    const probePath = join(backupRoot, `.preflight-${process.pid}`);
    await writeFile(probePath, 'ok', { mode: 0o600, flag: 'wx' });
    await unlink(probePath);
    pass('backup destination', 'mounted directory is private and writable');
    const latest = await latestVerifiedBackup(backupRoot);
    if (!latest) warn('backup age', 'no verified recovery set exists yet');
    else {
      const ageDays = (Date.now() - Date.parse(latest.createdAt)) / 86_400_000;
      if (ageDays > config.compose.BACKUP_RETENTION_DAYS) {
        warn('backup age', `latest verified set is ${ageDays.toFixed(1)} days old`);
      } else {
        pass('backup age', `latest verified set is ${ageDays.toFixed(1)} days old`);
      }
    }
    warn(
      'backup encryption',
      'operator must keep this destination on an encrypted volume or encrypted backup service',
    );
  } catch (error) {
    fail('backup destination', safeError(error));
  }

  if (failures.length) {
    process.stdout.write(
      `Preflight failed: ${failures.length} blocking checks, ${warnings.length} warnings.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Preflight passed: no blocking checks, ${warnings.length} warnings.\n`);
  }
}

async function latestWorkerStatus(connectionString: string): Promise<WorkerStatus | null> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const result = await client.query<WorkerStatus>(
      `SELECT host_name, heartbeat_at, scheduler_status, last_scheduled_success_at,
              last_scheduled_failure_at, last_scheduled_failure_name, last_outbox_failure_at,
              last_outbox_failure_name, pending_outbox_count, dead_outbox_count
         FROM platform.worker_health
        ORDER BY heartbeat_at DESC
        LIMIT 1`,
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function latestVerifiedBackup(root: string): Promise<{ createdAt: string } | null> {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map(async (entry) => {
          try {
            const manifest = JSON.parse(
              await readFile(join(root, entry.name, 'manifest.json'), 'utf8'),
            ) as {
              verifiedAt?: string | null;
              createdAt?: string;
            };
            return manifest.verifiedAt &&
              manifest.createdAt &&
              Number.isFinite(Date.parse(manifest.createdAt))
              ? { id: entry.name, createdAt: manifest.createdAt }
              : null;
          } catch {
            // Incomplete recovery sets are excluded from the reported backup age.
            return null;
          }
        }),
    )
  ).filter((candidate) => candidate !== null);
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const candidate of candidates) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- check newest first and stop at the first usable set
      await verifyRecoverySet(candidate.id, { quiet: true });
      return { createdAt: candidate.createdAt };
    } catch {
      // A verified marker alone is not enough to report a usable recovery point.
    }
  }
  return null;
}

function formatTime(value: Date | null, detail?: string | null): string {
  return value ? `${new Date(value).toISOString()}${detail ? ` (${detail})` : ''}` : 'never';
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unexpected failure';
  return `${error.name}: ${error.message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]')
    .slice(0, 240)}`;
}
