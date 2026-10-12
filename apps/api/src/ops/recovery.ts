import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadMigrationConfig, loadStorageConfig, resolveSecretFiles } from '@care/config';

// oxlint-disable no-await-in-loop -- backup I/O stays sequential to bound memory and preserve the quiesced object set

const databaseNames = ['care', 'authentik'] as const;
const trackedObjectQueries = [
  'SELECT object_key AS key, sha256 FROM documents.logo_assets',
  "SELECT object_key AS key, sha256 FROM documents.artifacts WHERE status IN ('ready', 'superseded')",
  "SELECT object_key AS key, sha256 FROM billing.invoice_documents WHERE status = 'ready'",
  'SELECT signature_storage_key AS key, signature_sha256 AS sha256 FROM service_evidence.acknowledgements WHERE signature_storage_key IS NOT NULL',
] as const;
const countableTables = [
  ['tenants', 'organizations', 'tenants'],
  ['clients', 'clients', 'clients'],
  ['invoices', 'billing', 'invoices'],
  ['payments', 'billing', 'payments'],
  ['claims', 'billing', 'claims'],
  ['documentArtifacts', 'documents', 'artifacts'],
] as const;

interface StoredObject {
  key: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  contentType?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  cacheControl?: string;
  expires?: string;
  metadata: Record<string, string>;
}

interface RecoveryManifest {
  formatVersion: 1;
  id: string;
  createdAt: string;
  verifiedAt: string | null;
  applicationCommit: string | null;
  postgres: { serverVersion: string; dumpToolVersion: string };
  schema: {
    migrations: { module: string; name: string; checksum: string }[];
    forcedRlsTableCount: number;
    businessCounts: Record<string, number>;
  };
  databases: { name: string; file: string; sha256: string }[];
  globals: { file: string; sha256: string };
  storage: {
    endpoint: string;
    bucket: string;
    objectCount: number;
    objects: StoredObject[];
    databaseReferenceCount: number;
    orphanObjectCount: number;
  };
}

interface StorageTarget {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
}

export async function createRecoverySet(args: string[]): Promise<void> {
  if (!args.includes('--confirm-quiesced')) {
    throw new Error(
      'Creation requires --confirm-quiesced after application and Authentik writes are stopped.',
    );
  }
  const source = resolveSecretFiles(process.env);
  const databaseConfig = loadMigrationConfig(source);
  const storageConfig = loadStorageConfig(source);
  const backupRoot = await getBackupRoot(source.BACKUP_DIR);
  const id = `care-${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomBytes(4).toString('hex')}`;
  const databaseUrl = new URL(databaseConfig.MIGRATION_DATABASE_URL);
  if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== 'care') {
    throw new Error(
      'MIGRATION_DATABASE_URL must target the care database for a paired recovery set.',
    );
  }
  const setPath = join(backupRoot, id);
  await mkdir(setPath, { mode: 0o700 });
  await mkdir(join(setPath, 'objects'), { mode: 0o700 });
  await chmod(setPath, 0o700);
  await chmod(join(setPath, 'objects'), 0o700);
  const info = await readDatabaseFacts(databaseConfig.MIGRATION_DATABASE_URL);
  const dumpToolVersion = await toolVersion('pg_dump');
  const serverMajor = Number(info.serverVersion.split('.')[0]);
  const dumpMajor = Number(dumpToolVersion.match(/\b(\d+)\./)?.[1]);
  if (!Number.isFinite(dumpMajor) || dumpMajor < serverMajor) {
    throw new Error(`pg_dump ${dumpToolVersion} cannot back up PostgreSQL ${info.serverVersion}.`);
  }

  const globalsFile = 'postgres-globals.sql';
  const globalsPath = join(setPath, globalsFile);
  await reservePrivateFile(globalsPath);
  const globalsDatabaseUrl = new URL(databaseUrl);
  globalsDatabaseUrl.pathname = '/postgres';
  globalsDatabaseUrl.password = '';
  await runPostgresTool('pg_dumpall', databaseConfig.MIGRATION_DATABASE_URL, [
    '--globals-only',
    '--dbname',
    globalsDatabaseUrl.toString(),
    '--file',
    globalsPath,
  ]);

  const databaseArtifacts: RecoveryManifest['databases'] = [];
  for (const name of databaseNames) {
    const artifact = `database-${name}.dump`;
    const artifactPath = join(setPath, artifact);
    await reservePrivateFile(artifactPath);
    const sourceUrl = new URL(databaseConfig.MIGRATION_DATABASE_URL);
    sourceUrl.pathname = `/${name}`;
    await runPostgresTool('pg_dump', sourceUrl.toString(), [
      '--format=custom',
      '--create',
      '--file',
      artifactPath,
      ...connectionArguments(sourceUrl, name),
    ]);
    await runPostgresTool('pg_restore', sourceUrl.toString(), ['--list', artifactPath]);
    databaseArtifacts.push({
      name,
      file: artifact,
      sha256: await fileSha256(artifactPath),
    });
  }

  const client = createStorageClient(storageConfig);
  const objectRecords: StoredObject[] = [];
  try {
    await client.send(new HeadBucketCommand({ Bucket: storageConfig.S3_BUCKET }));
    for await (const key of listObjectKeys(client, storageConfig.S3_BUCKET)) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: storageConfig.S3_BUCKET, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
      if (!response.Body) throw new Error('Object storage returned an empty object body.');
      const file = `objects/${createHash('sha256').update(key).digest('hex')}`;
      const filePath = join(setPath, file);
      const { sizeBytes, sha256 } = await streamBodyToFile(response.Body, filePath);
      objectRecords.push({
        key,
        file,
        sizeBytes,
        sha256,
        ...(response.ContentType ? { contentType: response.ContentType } : {}),
        ...(response.ContentEncoding ? { contentEncoding: response.ContentEncoding } : {}),
        ...(response.ContentLanguage ? { contentLanguage: response.ContentLanguage } : {}),
        ...(response.ContentDisposition ? { contentDisposition: response.ContentDisposition } : {}),
        ...(response.CacheControl ? { cacheControl: response.CacheControl } : {}),
        ...(response.Expires ? { expires: response.Expires.toISOString() } : {}),
        metadata: response.Metadata ?? {},
      });
    }
  } finally {
    client.destroy();
  }

  const objectReferences = await readDatabaseObjectReferences(
    databaseConfig.MIGRATION_DATABASE_URL,
  );
  const storageIndex = new Map(objectRecords.map((object) => [object.key, object.sha256]));
  const orphanObjectCount = assertStorageReferences(storageIndex, objectRecords, objectReferences);

  const manifest: RecoveryManifest = {
    formatVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    verifiedAt: null,
    applicationCommit: await applicationCommit(),
    postgres: { serverVersion: info.serverVersion, dumpToolVersion },
    schema: {
      migrations: info.migrations,
      forcedRlsTableCount: info.forcedRlsTableCount,
      businessCounts: info.businessCounts,
    },
    databases: databaseArtifacts,
    globals: { file: globalsFile, sha256: await fileSha256(globalsPath) },
    storage: {
      endpoint: safeEndpoint(storageConfig.S3_ENDPOINT),
      bucket: storageConfig.S3_BUCKET,
      objectCount: objectRecords.length,
      objects: objectRecords,
      databaseReferenceCount: objectReferences.length,
      orphanObjectCount,
    },
  };
  await writeManifest(setPath, manifest);
  await verifyRecoverySet(id, { markVerified: true });
  process.stdout.write(
    `Recovery set ${id} created and verified (${databaseArtifacts.length} databases, ${objectRecords.length} objects).\n`,
  );
}

export async function verifyRecoverySet(
  idOrPath: string,
  options: { markVerified?: boolean; quiet?: boolean } = {},
): Promise<RecoveryManifest> {
  const setPath = await resolveSetPath(idOrPath);
  const manifest = await readManifest(setPath);
  if (manifest.id !== relative(await getBackupRoot(), setPath)) {
    throw new Error('Recovery set identifier does not match its directory.');
  }

  const globals = await checkedArtifactPath(setPath, manifest.globals.file);
  if ((await fileSha256(globals)) !== manifest.globals.sha256) {
    throw new Error('PostgreSQL global-role backup checksum does not match.');
  }
  for (const database of manifest.databases) {
    const artifact = await checkedArtifactPath(setPath, database.file);
    if ((await fileSha256(artifact)) !== database.sha256) {
      throw new Error(`Database backup checksum does not match for ${database.name}.`);
    }
    await runPostgresTool('pg_restore', '', ['--list', artifact]);
  }
  for (const object of manifest.storage.objects) {
    const artifact = await checkedArtifactPath(setPath, object.file);
    const file = await lstat(artifact);
    if (!file.isFile() || file.isSymbolicLink())
      throw new Error('Object backup artifact is not a regular file.');
    if (file.size !== object.sizeBytes || (await fileSha256(artifact)) !== object.sha256) {
      throw new Error('Object backup artifact integrity verification failed.');
    }
  }
  if (manifest.storage.objects.length !== manifest.storage.objectCount) {
    throw new Error('Recovery manifest object count does not match its object list.');
  }
  if (options.markVerified && !manifest.verifiedAt) {
    manifest.verifiedAt = new Date().toISOString();
    await writeManifest(setPath, manifest);
  }
  if (!options.quiet && (options.markVerified || manifest.verifiedAt)) {
    process.stdout.write(
      `Recovery set ${manifest.id} verified (${manifest.storage.objectCount} objects).\n`,
    );
  }
  return manifest;
}

export async function restoreRecoverySet(args: string[]): Promise<void> {
  const id = args.find((argument) => !argument.startsWith('--'));
  const targetDatabaseFile = optionValue(args, '--target-database-url-file');
  const targetStorageFile = optionValue(args, '--target-storage-config-file');
  const confirmation = optionValue(args, '--confirm-target');
  if (!id || !targetDatabaseFile || !targetStorageFile || !confirmation) {
    throw new Error(
      'Usage: restore <set-id> --target-database-url-file <path> --target-storage-config-file <path> --confirm-target <host:port>',
    );
  }
  const manifest = await verifyRecoverySet(id);
  if (!manifest.verifiedAt) throw new Error('Restore requires a verified recovery set.');

  const targetDatabaseUrl = (
    await readPrivateOperatorFile(targetDatabaseFile, 'target database URL')
  ).trim();
  let target: URL;
  try {
    target = new URL(targetDatabaseUrl);
  } catch {
    throw new Error('Restore target database URL is invalid.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    !target.username ||
    !target.password
  ) {
    throw new Error('Restore target must be a PostgreSQL URL with a host and credentials.');
  }
  if (decodeURIComponent(target.pathname.slice(1)) !== 'postgres') {
    throw new Error('Restore target URL must connect to the empty postgres maintenance database.');
  }
  const expectedConfirmation = `${target.hostname.replace(/^\[|\]$/g, '')}:${target.port || '5432'}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Restore requires --confirm-target ${expectedConfirmation}.`);
  }
  const source = resolveSecretFiles(process.env);
  const sourceUrl = new URL(loadMigrationConfig(source).MIGRATION_DATABASE_URL);
  if (
    sourceUrl.hostname === target.hostname &&
    (sourceUrl.port || '5432') === (target.port || '5432')
  ) {
    throw new Error(
      'Restore target is the source PostgreSQL server; use a separate isolated cluster.',
    );
  }

  const sourceStorage = loadStorageConfig(source);
  const storageTarget = parseStorageTarget(
    await readPrivateOperatorFile(targetStorageFile, 'target object-storage configuration'),
  );
  assertSafeStorageTarget(manifest, storageTarget, sourceStorage);
  const storageClient = createTargetStorageClient(storageTarget);
  try {
    await assertEmptyStorageTarget(storageClient, storageTarget.bucket);
    await checkStorageTargetWriteAccess(storageClient, storageTarget.bucket);

    const targetClient = new Client({
      connectionString: targetDatabaseUrl,
      connectionTimeoutMillis: 5_000,
    });
    await targetClient.connect();
    try {
      const targetFacts = await targetClient.query<{ version: string; is_superuser: boolean }>(
        `SELECT current_setting('server_version') AS version,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`,
      );
      const sourceMajor = Number(manifest.postgres.serverVersion.split('.')[0]);
      const targetMajor = Number(targetFacts.rows[0]?.version.split('.')[0]);
      if (!Number.isFinite(targetMajor) || targetMajor < sourceMajor) {
        throw new Error(
          'Restore target PostgreSQL version must be the same as or newer than the recovery source.',
        );
      }
      if (!targetFacts.rows[0]?.is_superuser) {
        throw new Error(
          'Restore target PostgreSQL credentials must be a superuser on the isolated cluster.',
        );
      }
      const existingDatabases = await targetClient.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname IN ('care', 'authentik')",
      );
      const existingRoles = await targetClient.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('care_owner', 'care_app', 'care_worker')",
      );
      if (existingDatabases.rowCount || existingRoles.rowCount) {
        throw new Error(
          'Restore target already contains Care databases or roles; use a fresh isolated PostgreSQL cluster.',
        );
      }

      const setPath = await resolveSetPath(id);
      await runPostgresTool('psql', targetDatabaseUrl, [
        '--set',
        'ON_ERROR_STOP=1',
        '--file',
        join(setPath, manifest.globals.file),
        ...connectionArguments(target, 'postgres'),
      ]);
      for (const database of manifest.databases) {
        await runPostgresTool('pg_restore', targetDatabaseUrl, [
          '--create',
          '--exit-on-error',
          '--dbname',
          'postgres',
          ...connectionArguments(target, 'postgres'),
          join(setPath, database.file),
        ]);
      }
    } finally {
      await targetClient.end();
    }

    const restoredCareUrl = new URL(targetDatabaseUrl);
    restoredCareUrl.pathname = '/care';
    const restoredFacts = await readDatabaseFacts(restoredCareUrl.toString());
    assertDatabaseFacts(manifest, restoredFacts);
    const restoredReferences = await readDatabaseObjectReferences(restoredCareUrl.toString());
    assertStorageReferences(
      new Map(manifest.storage.objects.map((object) => [object.key, object.sha256])),
      manifest.storage.objects,
      restoredReferences,
      manifest.storage,
    );
    await restoreObjects(id, manifest, storageTarget, storageClient, restoredReferences);
    process.stdout.write(
      `Recovery set ${manifest.id} restored to an empty isolated PostgreSQL cluster and object bucket; database, RLS, and artifact integrity checks passed.\n`,
    );
  } finally {
    storageClient.destroy();
  }
}

export async function pruneRecoverySets(args: string[]): Promise<void> {
  const source = resolveSecretFiles(process.env);
  const root = await getBackupRoot(source.BACKUP_DIR);
  const retentionDays = Number(source.BACKUP_RETENTION_DAYS || '30');
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS must be an integer from 1 to 3650.');
  }
  const apply = args.includes('--apply');
  const threshold = Date.now() - retentionDays * 86_400_000;
  const candidates: { path: string; id: string; createdAt: number }[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    try {
      const manifest = await readManifest(path);
      if (!manifest.verifiedAt) continue;
      await verifyRecoverySet(entry.name, { quiet: true });
      candidates.push({ path, id: manifest.id, createdAt: Date.parse(manifest.createdAt) });
    } catch {
      continue;
    }
  }
  candidates.sort((left, right) => right.createdAt - left.createdAt);
  const newestId = candidates[0]?.id;
  const expired = candidates.filter(
    (candidate) => candidate.id !== newestId && candidate.createdAt < threshold,
  );
  for (const candidate of expired) {
    process.stdout.write(
      `${apply ? 'Deleting' : 'Would delete'} verified recovery set ${candidate.id}.\n`,
    );
    if (apply) await rm(candidate.path, { recursive: true, force: false });
  }
  process.stdout.write(
    `${apply ? 'Pruned' : 'Dry run'} complete; retained ${candidates.length - (apply ? expired.length : 0)} verified sets, including the newest.\n`,
  );
}

export async function readDatabaseFacts(connectionString: string): Promise<{
  serverVersion: string;
  migrations: { module: string; name: string; checksum: string }[];
  forcedRlsTableCount: number;
  businessCounts: Record<string, number>;
}> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const version = await client.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    const migrations = await client.query<{
      module: string;
      name: string;
      checksum: string;
    }>('SELECT module, name, checksum FROM platform.migration_registry ORDER BY module, name');
    const rls = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE relation.relkind IN ('r', 'p')
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
         AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')`,
    );
    const businessCounts: Record<string, number> = {};
    for (const [key, schema, table] of countableTables) {
      const countResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}"."${table}"`,
      );
      businessCounts[key] = Number(countResult.rows[0]?.count ?? 0);
    }
    return {
      serverVersion: version.rows[0]?.version ?? 'unknown',
      migrations: migrations.rows,
      forcedRlsTableCount: Number(rls.rows[0]?.count ?? 0),
      businessCounts,
    };
  } finally {
    await client.end();
  }
}

export async function readDatabaseObjectReferences(
  connectionString: string,
): Promise<{ key: string; sha256: string }[]> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const references: { key: string; sha256: string }[] = [];
    for (const query of trackedObjectQueries) {
      const result = await client.query<{ key: string; sha256: string }>(query);
      references.push(...result.rows);
    }
    return references;
  } finally {
    await client.end();
  }
}

export function assertDatabaseObjectReferences(
  objects: Map<string, string>,
  references: { key: string; sha256: string }[],
): void {
  let missing = 0;
  let mismatched = 0;
  for (const reference of references) {
    const sha256 = objects.get(reference.key);
    if (!sha256) missing += 1;
    else if (sha256 !== reference.sha256) mismatched += 1;
  }
  if (missing || mismatched) {
    throw new Error(
      `Object recovery mismatch: ${missing} referenced objects missing, ${mismatched} hashes differ.`,
    );
  }
}

function assertStorageReferences(
  objectIndex: Map<string, string>,
  objects: StoredObject[],
  references: { key: string; sha256: string }[],
  expected?: RecoveryManifest['storage'],
): number {
  assertDatabaseObjectReferences(objectIndex, references);
  if (expected && references.length !== expected.databaseReferenceCount) {
    throw new Error(
      'Restored database object-reference count does not match the recovery manifest.',
    );
  }
  const referencedKeys = new Set(references.map((reference) => reference.key));
  const orphanObjectCount = objects.filter((object) => !referencedKeys.has(object.key)).length;
  if (expected && orphanObjectCount !== expected.orphanObjectCount) {
    throw new Error('Restored object orphan count does not match the recovery manifest.');
  }
  return orphanObjectCount;
}

function assertDatabaseFacts(
  manifest: RecoveryManifest,
  actual: Awaited<ReturnType<typeof readDatabaseFacts>>,
): void {
  const expected = new Map(
    manifest.schema.migrations.map((migration) => [
      `${migration.module}/${migration.name}`,
      migration.checksum,
    ]),
  );
  const restored = new Map(
    actual.migrations.map((migration) => [
      `${migration.module}/${migration.name}`,
      migration.checksum,
    ]),
  );
  if (
    expected.size !== restored.size ||
    [...expected].some(([migration, checksum]) => restored.get(migration) !== checksum)
  ) {
    throw new Error('Restored database migration registry does not match the recovery manifest.');
  }
  if (manifest.schema.forcedRlsTableCount !== actual.forcedRlsTableCount) {
    throw new Error('Restored forced-RLS table count does not match the recovery manifest.');
  }
  for (const [table, expectedCount] of Object.entries(manifest.schema.businessCounts)) {
    if (actual.businessCounts[table] !== expectedCount) {
      throw new Error(`Restored business record count does not match for ${table}.`);
    }
  }
}

async function restoreObjects(
  id: string,
  manifest: RecoveryManifest,
  target: StorageTarget,
  client: S3Client,
  references: { key: string; sha256: string }[],
): Promise<void> {
  await assertEmptyStorageTarget(client, target.bucket);

  const setPath = await resolveSetPath(id);
  const restoredIndex = new Map<string, string>();
  for (const object of manifest.storage.objects) {
    const filePath = await checkedArtifactPath(setPath, object.file);
    let response: GetObjectCommandOutput;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: target.bucket,
          Key: object.key,
          Body: createReadStream(filePath),
          ContentLength: object.sizeBytes,
          ContentType: object.contentType,
          ContentEncoding: object.contentEncoding,
          ContentLanguage: object.contentLanguage,
          ContentDisposition: object.contentDisposition,
          CacheControl: object.cacheControl,
          Expires: object.expires ? new Date(object.expires) : undefined,
          Metadata: object.metadata,
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
      response = await client.send(
        new GetObjectCommand({ Bucket: target.bucket, Key: object.key }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
    } catch {
      throw new Error('Object storage failed while restoring or verifying an object.');
    }
    if (!response.Body) throw new Error('Restored object could not be read back.');
    const restored = await hashBody(response.Body);
    if (restored.sha256 !== object.sha256 || restored.sizeBytes !== object.sizeBytes) {
      throw new Error('Restored object failed its byte-integrity check.');
    }
    assertRestoredMetadata(object, response);
    restoredIndex.set(object.key, restored.sha256);
  }
  assertDatabaseObjectReferences(restoredIndex, references);
}

async function* listObjectKeys(client: S3Client, bucket: string): AsyncGenerator<string> {
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    for (const object of page.Contents ?? []) {
      if (object.Key !== undefined) yield object.Key;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function readManifest(setPath: string): Promise<RecoveryManifest> {
  const manifestPath = join(setPath, 'manifest.json');
  const file = await lstat(manifestPath);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
    throw new Error('Recovery manifest is not a private regular file.');
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RecoveryManifest;
  if (
    manifest.formatVersion !== 1 ||
    !/^care-[0-9TZ]+-[a-f0-9]{8}$/.test(manifest.id) ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    (manifest.verifiedAt !== null && !Number.isFinite(Date.parse(manifest.verifiedAt))) ||
    !manifest.postgres?.serverVersion ||
    !manifest.postgres?.dumpToolVersion ||
    !Array.isArray(manifest.schema?.migrations) ||
    !Number.isSafeInteger(manifest.schema?.forcedRlsTableCount) ||
    manifest.schema.forcedRlsTableCount < 0 ||
    !manifest.schema?.businessCounts ||
    Object.values(manifest.schema.businessCounts).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    !Array.isArray(manifest.databases) ||
    manifest.databases.length !== databaseNames.length ||
    !Array.isArray(manifest.storage?.objects) ||
    typeof manifest.storage.endpoint !== 'string' ||
    typeof manifest.storage.bucket !== 'string' ||
    !Number.isSafeInteger(manifest.storage.objectCount) ||
    !Number.isSafeInteger(manifest.storage.databaseReferenceCount) ||
    !Number.isSafeInteger(manifest.storage.orphanObjectCount) ||
    manifest.storage.databaseReferenceCount < 0 ||
    manifest.storage.orphanObjectCount < 0 ||
    manifest.storage.orphanObjectCount > manifest.storage.objectCount ||
    manifest.globals?.file !== 'postgres-globals.sql' ||
    !/^[a-f0-9]{64}$/.test(manifest.globals?.sha256 ?? '') ||
    manifest.schema.migrations.some(
      (migration) =>
        !migration.module || !migration.name || !/^[a-f0-9]{64}$/.test(migration.checksum),
    ) ||
    databaseNames.some((name) => {
      const database = manifest.databases.find((entry) => entry.name === name);
      return (
        !database ||
        database.file !== `database-${name}.dump` ||
        !/^[a-f0-9]{64}$/.test(database.sha256)
      );
    }) ||
    manifest.storage.objects.some(
      (object) =>
        typeof object.key !== 'string' ||
        object.key.length === 0 ||
        !/^objects\/[a-f0-9]{64}$/.test(object.file) ||
        object.file !== `objects/${createHash('sha256').update(object.key).digest('hex')}` ||
        !/^[a-f0-9]{64}$/.test(object.sha256) ||
        !Number.isSafeInteger(object.sizeBytes) ||
        object.sizeBytes < 0 ||
        !object.metadata ||
        typeof object.metadata !== 'object' ||
        Array.isArray(object.metadata) ||
        Object.entries(object.metadata).some(([key, value]) => !key || typeof value !== 'string'),
    )
  ) {
    throw new Error('Recovery manifest has an unsupported or incomplete format.');
  }
  const objectKeys = manifest.storage.objects.map((object) => object.key);
  const objectFiles = manifest.storage.objects.map((object) => object.file);
  if (
    new Set(objectKeys).size !== objectKeys.length ||
    new Set(objectFiles).size !== objectFiles.length ||
    manifest.storage.objects.length !== manifest.storage.objectCount
  ) {
    throw new Error('Recovery manifest contains duplicate objects or an incorrect object count.');
  }
  return manifest;
}

async function writeManifest(setPath: string, manifest: RecoveryManifest): Promise<void> {
  const path = join(setPath, 'manifest.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function checkedArtifactPath(setPath: string, relativePath: string): Promise<string> {
  if (
    isAbsolute(relativePath) ||
    relative(setPath, resolve(setPath, relativePath)).startsWith('..')
  ) {
    throw new Error('Recovery manifest contains an unsafe artifact path.');
  }
  const filePath = resolve(setPath, relativePath);
  let parent = setPath;
  for (const segment of relativePath.split('/').slice(0, -1)) {
    parent = join(parent, segment);
    const directory = await lstat(parent);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
      throw new Error('Recovery artifact directory is not private and regular.');
    }
  }
  const file = await lstat(filePath);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
    throw new Error('Recovery artifact is not a regular file.');
  }
  return filePath;
}

async function resolveSetPath(idOrPath: string): Promise<string> {
  const root = await getBackupRoot();
  if (!idOrPath || idOrPath.includes('/') || idOrPath.includes('\\')) {
    throw new Error('Use a recovery set identifier, not a filesystem path.');
  }
  const setPath = join(root, idOrPath);
  const directory = await lstat(setPath);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
    throw new Error('Recovery set directory is missing or unsafe.');
  }
  return setPath;
}

async function getBackupRoot(
  configuredPath = resolveSecretFiles(process.env).BACKUP_DIR,
): Promise<string> {
  if (!configuredPath || !isAbsolute(configuredPath)) {
    throw new Error('BACKUP_DIR must be an absolute path.');
  }
  const root = resolve(configuredPath);
  const info = await lstat(root).catch(async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    return lstat(root);
  });
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('BACKUP_DIR must be a private directory with mode 0700 or stricter.');
  }
  if ((await realpath(root)) !== root) {
    throw new Error('BACKUP_DIR cannot resolve through a symbolic link.');
  }
  return root;
}

async function reservePrivateFile(path: string): Promise<void> {
  const file = await writeFile(path, '', { mode: 0o600, flag: 'wx' });
  void file;
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

interface S3BodyStream {
  transformToWebStream(): ReadableStream<Uint8Array>;
}

async function streamBodyToFile(
  body: S3BodyStream,
  path: string,
): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(
      body.transformToWebStream() as unknown as Parameters<typeof Readable.fromWeb>[0],
    ),
    meter,
    createWriteStream(path, { flags: 'wx', mode: 0o600 }),
  );
  return { sizeBytes, sha256: hash.digest('hex') };
}

async function hashBody(body: S3BodyStream): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of Readable.fromWeb(
    body.transformToWebStream() as unknown as Parameters<typeof Readable.fromWeb>[0],
  )) {
    sizeBytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

function assertRestoredMetadata(object: StoredObject, actual: GetObjectCommandOutput): void {
  const originalExpires = object.expires
    ? Math.floor(Date.parse(object.expires) / 1000)
    : undefined;
  const restoredExpires = actual.Expires ? Math.floor(actual.Expires.getTime() / 1000) : undefined;
  if (
    object.contentType !== actual.ContentType ||
    object.contentEncoding !== actual.ContentEncoding ||
    object.contentLanguage !== actual.ContentLanguage ||
    object.contentDisposition !== actual.ContentDisposition ||
    object.cacheControl !== actual.CacheControl ||
    originalExpires !== restoredExpires ||
    JSON.stringify(Object.entries(object.metadata).sort()) !==
      JSON.stringify(Object.entries(actual.Metadata ?? {}).sort())
  ) {
    throw new Error('Restored object metadata does not match the recovery manifest.');
  }
}

async function toolVersion(tool: string): Promise<string> {
  const result = await runChild(tool, ['--version'], { captureStdout: true });
  return result.stdout.trim().split('\n')[0] ?? 'unknown';
}

async function runPostgresTool(tool: string, connection: string, args: string[]): Promise<void> {
  const parsed = connection ? new URL(connection) : undefined;
  const tempDirectory = await mkdtemp(join(tmpdir(), 'care-pg-'));
  await chmod(tempDirectory, 0o700);
  const passFile = join(tempDirectory, 'pgpass');
  if (parsed) {
    const entry = [
      '*',
      parsed.port || '5432',
      '*',
      decodeURIComponent(parsed.username),
      decodeURIComponent(parsed.password),
    ]
      .map(escapePgpass)
      .join(':');
    await writeFile(passFile, `${entry}\n`, { mode: 0o600 });
  }
  try {
    const pgEnvironment = parsed ? postgresEnvironment(parsed, passFile) : process.env;
    const sensitiveValues = parsed
      ? [decodeURIComponent(parsed.password), process.env.OIDC_CLIENT_SECRET ?? '']
      : [];
    const result = await runChild(tool, args, { env: pgEnvironment, redact: sensitiveValues });
    if (result.stderr.trim())
      process.stdout.write(redactText(result.stderr, sensitiveValues).trim().slice(0, 400) + '\n');
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function postgresEnvironment(parsed: URL, passFile: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSFILE: passFile,
    PGCONNECT_TIMEOUT: '5',
  };
  const mappings: Record<string, string> = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    sslcrl: 'PGSSLCRL',
    gssencmode: 'PGGSSENCMODE',
    application_name: 'PGAPPNAME',
  };
  for (const [parameter, variable] of Object.entries(mappings)) {
    const value = parsed.searchParams.get(parameter);
    if (value) environment[variable] = value;
  }
  return environment;
}

function connectionArguments(parsed: URL, database: string): string[] {
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('PostgreSQL connection URL must specify a host.');
  return [
    '--host',
    host,
    '--port',
    parsed.port || '5432',
    '--username',
    decodeURIComponent(parsed.username),
    '--dbname',
    database,
  ];
}

function escapePgpass(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function runChild(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; captureStdout?: boolean; redact?: string[] } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: ['ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) =>
      rejectPromise(new Error(`${command} could not be started: ${error.name}`)),
    );
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        const safeDetail = redactText(stderr, options.redact ?? []).slice(0, 400);
        rejectPromise(
          new Error(`${command} exited with code ${code}${safeDetail ? `: ${safeDetail}` : '.'}`),
        );
      }
    });
  });
}

async function applicationCommit(): Promise<string | null> {
  try {
    return (await runChild('git', ['rev-parse', 'HEAD'], { captureStdout: true })).stdout.trim();
  } catch {
    return null;
  }
}

function createStorageClient(config: ReturnType<typeof loadStorageConfig>): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
}

function safeEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  return parsed.origin;
}

function redactText(value: string, secrets: string[]): string {
  let safe = value.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]');
  for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
    safe = safe.replaceAll(secret, '[redacted]');
  }
  return safe;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseStorageTarget(contents: string): StorageTarget {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Restore object-storage configuration is not valid JSON.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('endpoint' in parsed) ||
    !('region' in parsed) ||
    !('bucket' in parsed) ||
    !('accessKey' in parsed) ||
    !('secretKey' in parsed)
  ) {
    throw new Error('Restore object-storage configuration is missing required fields.');
  }
  const target = parsed as StorageTarget;
  if (
    typeof target.endpoint !== 'string' ||
    typeof target.region !== 'string' ||
    typeof target.bucket !== 'string' ||
    typeof target.accessKey !== 'string' ||
    typeof target.secretKey !== 'string'
  ) {
    throw new Error('Restore object-storage configuration has invalid field types.');
  }
  if (typeof target.forcePathStyle !== 'undefined' && typeof target.forcePathStyle !== 'boolean') {
    throw new Error('Restore object-storage configuration has an invalid path-style setting.');
  }
  return target;
}

async function readPrivateOperatorFile(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`The ${label} file path must be absolute.`);
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 1_048_576
  ) {
    throw new Error(`The ${label} file must be a private regular file no larger than 1 MiB.`);
  }
  if ((await realpath(path)) !== resolve(path)) {
    throw new Error(`The ${label} file cannot resolve through a symbolic link.`);
  }
  return readFile(path, 'utf8');
}

function assertSafeStorageTarget(
  manifest: RecoveryManifest,
  target: StorageTarget,
  source: ReturnType<typeof loadStorageConfig>,
): void {
  let endpoint: URL;
  try {
    endpoint = new URL(target.endpoint);
  } catch {
    throw new Error('Restore object-storage endpoint is invalid.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    !endpoint.hostname ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !target.region.trim() ||
    !/^[a-zA-Z0-9._-]{3,63}$/.test(target.bucket) ||
    !target.accessKey.trim() ||
    !target.secretKey.trim()
  ) {
    throw new Error('Restore object-storage configuration is incomplete or unsafe.');
  }
  const endpointId = endpoint.origin;
  const sourceId = safeEndpoint(source.S3_ENDPOINT);
  if (
    (endpointId === sourceId && target.bucket === source.S3_BUCKET) ||
    (endpointId === manifest.storage.endpoint && target.bucket === manifest.storage.bucket)
  ) {
    throw new Error(
      'Restore object storage must use a separate target bucket from the recovery source.',
    );
  }
}

function createTargetStorageClient(target: StorageTarget): S3Client {
  return new S3Client({
    endpoint: target.endpoint,
    region: target.region,
    forcePathStyle: target.forcePathStyle ?? true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: target.accessKey, secretAccessKey: target.secretKey },
  });
}

async function assertEmptyStorageTarget(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    throw new Error('Restore target bucket is unavailable or credentials were rejected.');
  }
  let existing;
  try {
    existing = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  } catch {
    throw new Error('Restore target bucket could not be checked for existing objects.');
  }
  if (existing.Contents?.length || existing.IsTruncated) {
    throw new Error('Restore target bucket must be empty; no existing objects were overwritten.');
  }
}

async function checkStorageTargetWriteAccess(client: S3Client, bucket: string): Promise<void> {
  const key = `.care-restore-preflight/${randomBytes(16).toString('hex')}`;
  let operationFailed = false;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: 'care-restore-preflight',
        ContentLength: 22,
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!response.Body) throw new Error('Object storage returned an empty preflight object.');
    const result = await hashBody(response.Body);
    if (result.sha256 !== createHash('sha256').update('care-restore-preflight').digest('hex')) {
      throw new Error('Object storage preflight read-back differed.');
    }
  } catch {
    operationFailed = true;
  }
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      'Restore target could not remove its storage permission probe; discard that empty target bucket.',
    );
  }
  if (operationFailed) {
    throw new Error(
      'Restore target credentials must allow object read, write and delete operations.',
    );
  }
  await assertEmptyStorageTarget(client, bucket);
}
