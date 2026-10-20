import { randomBytes } from 'node:crypto';
import { chmod, chown, lstat, mkdir, open, readdir, realpath, rm, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environmentPath = resolve(projectRoot, '.env.production');
const secretsPath = resolve(projectRoot, 'secrets');
const runtimeUid = 1000;
const rawArguments = process.argv.slice(2);

if (rawArguments.includes('--help') || rawArguments.includes('-h')) {
  printUsage();
  process.exit(0);
}

let options;
try {
  options = parseArguments(rawArguments);
} catch (error) {
  console.error(
    `Production setup: ${error instanceof Error ? error.message : 'invalid arguments.'}`,
  );
  printUsage();
  process.exit(2);
}
if (!options.production) {
  console.error('Production setup requires the explicit --production flag.');
  printUsage();
  process.exit(2);
}

const terminal = process.stdin.isTTY && process.stdout.isTTY;
const prompts = terminal ? createInterface({ input: process.stdin, output: process.stdout }) : null;

try {
  const webHost = validateHost(
    options.webHost ?? (await ask('Web app hostname (for example care.example.org):')),
    'web app hostname',
  );
  const apiHost = validateHost(
    options.apiHost ?? (await ask('API hostname (for example api.care.example.org):')),
    'API hostname',
  );
  const authentikHost = validateHost(
    options.authentikHost ?? (await ask('Authentik hostname (for example auth.care.example.org):')),
    'Authentik hostname',
  );
  const contactEmail = validateEmail(
    options.contactEmail ?? (await ask('Caddy certificate contact email:')),
    'Caddy contact email',
  );
  const backupDirectory =
    options.backupDirectory ?? (await ask('Backup volume path:', '/srv/care-backups'));
  if (!isAbsolute(backupDirectory)) {
    throw new Error('The backup directory must be an absolute path.');
  }
  if (/[\r\n#"'$]/.test(backupDirectory)) {
    throw new Error('The backup directory cannot contain newlines, quotes, # or $.');
  }

  await createProductionSetup({
    webHost,
    apiHost,
    authentikHost,
    contactEmail,
    backupDirectory,
    routing: !options.withoutRouting,
  });
} catch (error) {
  console.error(`Production setup: ${error instanceof Error ? error.message : 'failed.'}`);
  process.exitCode = 1;
} finally {
  prompts?.close();
}

function parseArguments(args) {
  const parsedOptions = { production: false, withoutRouting: false };
  const valueOptions = new Map([
    ['--web-host', 'webHost'],
    ['--api-host', 'apiHost'],
    ['--authentik-host', 'authentikHost'],
    ['--contact-email', 'contactEmail'],
    ['--backup-dir', 'backupDirectory'],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--production') {
      parsedOptions.production = true;
      continue;
    }
    if (argument === '--without-routing') {
      parsedOptions.withoutRouting = true;
      continue;
    }
    const option = valueOptions.get(argument);
    if (!option || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete setup option: ${argument}`);
    }
    parsedOptions[option] = args[index + 1];
    index += 1;
  }
  return parsedOptions;
}

function printUsage() {
  console.log(`Usage:
  bun run deploy:setup -- --production
  bun run deploy:setup -- --production --web-host <host> --api-host <host> \
    --authentik-host <host> --contact-email <email> [--backup-dir <absolute-path>] [--without-routing]

Without hostname arguments, setup asks for them interactively. It creates random application
credentials and secret files. SMTP credentials are entered later in .env.production.`);
}

async function ask(question, defaultValue) {
  if (!prompts) {
    throw new Error(
      'Missing required values. Use an interactive terminal or pass the host and email options shown by --help.',
    );
  }
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await prompts.question(`${question}${suffix} `)).trim();
  return answer || defaultValue || '';
}

function validateHost(value, label) {
  const host = value.trim().toLowerCase();
  const parsed = new URL(`https://${host}`);
  if (
    parsed.hostname !== host ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.example') ||
    host.endsWith('.example.org') ||
    host.endsWith('.example.com') ||
    host.endsWith('.example.net') ||
    host.endsWith('.test') ||
    host.endsWith('.invalid')
  ) {
    throw new Error(`Enter a real public DNS ${label}.`);
  }
  return host;
}

function validateEmail(value, label) {
  const email = value.trim();
  const domain = email.split('@').at(-1)?.toLowerCase() ?? '';
  if (
    !/^\S+@\S+\.\S+$/.test(email) ||
    domain === 'example' ||
    domain.endsWith('.example') ||
    domain.endsWith('.example.org') ||
    domain.endsWith('.example.com') ||
    domain.endsWith('.example.net') ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid')
  ) {
    throw new Error(`Enter a real ${label}.`);
  }
  return email;
}

async function createProductionSetup({
  webHost,
  apiHost,
  authentikHost,
  contactEmail,
  backupDirectory,
  routing,
}) {
  await assertNotInitialized();
  await assertRuntimeOwner();
  await prepareBackupDirectory(backupDirectory);
  await mkdir(secretsPath, { recursive: true, mode: 0o700 });
  await chmod(secretsPath, 0o700);
  await setRuntimeOwner(secretsPath);

  const postgresPassword = secret(32);
  const appPassword = secret(32);
  const workerPassword = secret(32);
  const s3AccessKey = secret(24);
  const s3SecretKey = secret(32);
  const s3InitAccessKey = secret(24);
  const s3InitSecretKey = secret(32);
  const accessKeyFile = './secrets/s3-access-key';
  const secretKeyFile = './secrets/s3-secret-key';
  const initAccessKeyFile = './secrets/seaweedfs-init-access-key';
  const initSecretKeyFile = './secrets/seaweedfs-init-secret-key';

  const files = new Map([
    ['./secrets/care-database-url', databaseUrl('care_app', appPassword)],
    ['./secrets/care-migration-database-url', databaseUrl('care_owner', postgresPassword)],
    ['./secrets/care-worker-database-url', databaseUrl('care_worker', workerPassword)],
    ['./secrets/web-auth-secret', secret(32)],
    [accessKeyFile, `${s3AccessKey}\n`],
    [secretKeyFile, `${s3SecretKey}\n`],
    [initAccessKeyFile, `${s3InitAccessKey}\n`],
    [initSecretKeyFile, `${s3InitSecretKey}\n`],
    [
      './secrets/seaweedfs-s3.json',
      `${JSON.stringify(
        {
          identities: [
            {
              name: 'care-app',
              credentials: [{ accessKey: s3AccessKey, secretKey: s3SecretKey }],
              actions: ['Read', 'List', 'Tagging', 'Write'],
            },
            {
              name: 'care-init',
              credentials: [{ accessKey: s3InitAccessKey, secretKey: s3InitSecretKey }],
              actions: ['Admin', 'List'],
            },
          ],
        },
        null,
        2,
      )}\n`,
    ],
  ]);

  const webOrigin = `https://${webHost}`;
  const apiOrigin = `https://${apiHost}`;
  const authentikOrigin = `https://${authentikHost}`;
  const variables = [
    'NODE_ENV=production',
    '',
    `WEB_HOST=${webHost}`,
    `API_HOST=${apiHost}`,
    `AUTHENTIK_HOST=${authentikHost}`,
    `WEB_ORIGIN=${webOrigin}`,
    `API_PUBLIC_URL=${apiOrigin}`,
    `API_PUBLIC_ORIGIN=${apiOrigin}`,
    `AUTHENTIK_PUBLIC_URL=${authentikOrigin}`,
    `AUTHENTIK_WEB__BASE_URL=${authentikOrigin}`,
    `OIDC_ISSUER=${authentikOrigin}/application/o/care-platform/`,
    `OIDC_REDIRECT_URI=${webOrigin}/api/auth/callback/authentik`,
    'OIDC_CLIENT_ID=care-platform',
    `OIDC_CLIENT_SECRET=${secret(48)}`,
    `CADDY_EMAIL=${contactEmail}`,
    'TRUSTED_PROXY_HOPS=1',
    '',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `CARE_APP_PASSWORD=${appPassword}`,
    `CARE_WORKER_PASSWORD=${workerPassword}`,
    `AUTHENTIK_SECRET_KEY=${secret(32)}`,
    `AUTHENTIK_BOOTSTRAP_PASSWORD=${secret(24)}`,
    `GRAFANA_ADMIN_PASSWORD=${secret(24)}`,
    '',
    '# Set these four values before the first deploy. Change SMTP_PORT if your provider requires it.',
    'SMTP_HOST=',
    'SMTP_PORT=587',
    'SMTP_FROM=',
    'SMTP_USERNAME=',
    'SMTP_PASSWORD=',
    '',
    'DATABASE_URL_FILE=./secrets/care-database-url',
    'MIGRATION_DATABASE_URL_FILE=./secrets/care-migration-database-url',
    'WORKER_DATABASE_URL_FILE=./secrets/care-worker-database-url',
    'AUTH_SECRET_FILE=./secrets/web-auth-secret',
    `S3_ACCESS_KEY_FILE=${accessKeyFile}`,
    `S3_SECRET_KEY_FILE=${secretKeyFile}`,
    'SEAWEEDFS_S3_CONFIG_FILE=./secrets/seaweedfs-s3.json',
    `S3_INIT_ACCESS_KEY_FILE=${initAccessKeyFile}`,
    `S3_INIT_SECRET_KEY_FILE=${initSecretKeyFile}`,
    '',
    'S3_ENDPOINT=http://seaweedfs:8333',
    'S3_REGION=eu-central-1',
    'S3_BUCKET=care-documents',
    'S3_FORCE_PATH_STYLE=true',
    routing ? 'ROUTING_OSRM_URL=http://osrm:5000' : 'ROUTING_OSRM_URL=',
    routing ? 'OSRM_REGION=europe/germany' : 'OSRM_REGION=',
    'ROUTING_OSRM_PROBE_FROM=6.958860,50.9413',
    'ROUTING_OSRM_PROBE_TO=6.956,50.936',
    'WORKER_POLL_INTERVAL_MS=1000',
    'SCHEDULE_GENERATION_HORIZON_DAYS=28',
    'LOG_LEVEL=info',
    'OTEL_EXPORTER_OTLP_ENDPOINT=',
    '',
    `BACKUP_DIR=${backupDirectory}`,
    'BACKUP_RETENTION_DAYS=30',
    'OPERATOR_SECRETS_DIR=./secrets',
    '',
  ];

  const createdFiles = [];
  let environmentCreated = false;
  try {
    // oxlint-disable no-await-in-loop -- Sequential writes let setup remove every file it created if a later write fails.
    for (const [relativePath, content] of files) {
      const path = resolve(projectRoot, relativePath);
      const file = await open(path, 'wx', 0o600);
      createdFiles.push(path);
      try {
        await file.writeFile(content);
      } finally {
        await file.close();
      }
      await chmod(path, 0o600);
      await setRuntimeOwner(path);
    }
    // oxlint-enable no-await-in-loop

    const environmentFile = await open(environmentPath, 'wx', 0o600);
    environmentCreated = true;
    try {
      await environmentFile.writeFile(`${variables.join('\n')}\n`);
    } finally {
      await environmentFile.close();
    }
    await chmod(environmentPath, 0o600);
    await setRuntimeOwner(environmentPath);
  } catch (error) {
    if (environmentCreated) await rm(environmentPath, { force: true });
    await Promise.all(createdFiles.map((path) => rm(path, { force: true })));
    throw error;
  }

  console.log(`Created ${environmentPath} and ${createdFiles.length} private secret files.`);
  console.log('Generated secrets are stored locally and were not printed.');
  console.log(
    'Next, configure SMTP_HOST, SMTP_FROM, SMTP_USERNAME, and SMTP_PASSWORD in .env.production.',
  );
  console.log('Point all three DNS records to this VPS and allow inbound ports 80 and 443.');
  console.log('Then run: bun run deploy:up -- --production');
  if (routing) {
    console.log(
      'The first deploy prepares the full Germany OSRM dataset and needs substantial disk, RAM, and CPU.',
    );
  }
}

async function assertNotInitialized() {
  try {
    await lstat(environmentPath);
    throw new Error(
      '.env.production already exists; setup will not overwrite production configuration.',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    const directory = await lstat(secretsPath);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error('secrets/ must be a regular directory, not a symlink.');
    }
    const entries = await readdir(secretsPath);
    if (entries.length > 0) {
      throw new Error(
        'secrets/ already contains files; setup will not overwrite production secrets.',
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function assertRuntimeOwner() {
  const uid = process.getuid?.();
  if (uid !== 0 && uid !== runtimeUid) {
    throw new Error(
      `Run setup as UID ${runtimeUid}, or as root so generated runtime files can be assigned to UID ${runtimeUid}.`,
    );
  }
}

async function prepareBackupDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('The backup path must be a regular directory, not a symlink.');
  }
  const canonicalPath = await realpath(directory);
  if (canonicalPath !== resolve(directory)) {
    throw new Error('The backup path must not resolve through a symlink.');
  }
  await chmod(directory, 0o700);
  if (process.getuid?.() === 0 && info.uid !== runtimeUid) {
    await chown(directory, runtimeUid, runtimeUid);
  }
  const current = await stat(directory);
  if (current.uid !== runtimeUid) {
    throw new Error(`The backup directory must be owned by UID ${runtimeUid}.`);
  }
}

async function setRuntimeOwner(path) {
  if (process.getuid?.() === 0) await chown(path, runtimeUid, runtimeUid);
}

function databaseUrl(username, password) {
  return `postgres://${username}:${password}@postgres:5432/care\n`;
}

function secret(bytes) {
  return randomBytes(bytes).toString('hex');
}
