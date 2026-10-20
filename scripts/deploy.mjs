import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environmentFile = resolve(projectRoot, '.env.production');
const [operation, ...operatorArguments] = process.argv.slice(2);
const operatorCommands = new Set([
  'up',
  'preflight',
  'bootstrap-admin',
  'create',
  'verify',
  'restore',
  'prune',
]);

if (!operation || !operatorCommands.has(operation)) {
  process.stderr.write(
    'Usage: bun run deploy:up -- --production | deploy:check -- --production | deploy:bootstrap-admin -- --production ... | backup:create -- --production ... | backup:verify -- --production <id> | backup:restore -- --production ... | backup:prune -- --production [--apply]\n',
  );
  process.exit(2);
}

if (operatorArguments[0] !== '--production') {
  process.stderr.write(
    'This command accesses production deployment configuration. Pass --production explicitly before any operation arguments.\n',
  );
  process.exit(2);
}
operatorArguments.shift();
if (operation === 'up' && operatorArguments.length > 0) {
  process.stderr.write('deploy:up does not accept additional arguments.\n');
  process.exit(2);
}

try {
  const file = lstatSync(environmentFile);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error('.env.production must be a regular file.');
  }
  if ((file.mode & 0o077) !== 0) {
    throw new Error('.env.production must be readable only by its owner (chmod 600).');
  }
  validateSecretFiles();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Cannot read .env.production'}\n`,
  );
  process.exit(2);
}

const compose = [
  'compose',
  '--project-name',
  'care-platform-prod',
  '--env-file',
  '.env.production',
  '-f',
  'compose.yaml',
  '-f',
  'compose.production.yaml',
];
let composeEnvironment;

try {
  composeEnvironment = buildComposeEnvironment();
  const version = execFileSync('docker', ['compose', 'version', '--short'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: composeEnvironment,
  }).trim();
  const numbers = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!numbers || compareVersion(numbers.slice(1).map(Number), [2, 24, 4]) < 0) {
    throw new Error(
      `Docker Compose ${version || 'unknown'} is too old; version 2.24.4 or newer is required.`,
    );
  }
  const productionEnvironment = readProductionEnvironment();
  const routingEnabled = usesInternalOsrm(productionEnvironment.ROUTING_OSRM_URL);
  const routingProfile = routingEnabled ? ['--profile', 'routing'] : [];

  execFileSync('docker', [...compose, ...routingProfile, 'config', '--quiet'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: composeEnvironment,
  });

  if (operation === 'up') {
    execFileSync('docker', [...compose, ...routingProfile, 'pull'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: composeEnvironment,
    });
    if (routingEnabled) {
      execFileSync('node', ['scripts/routing.mjs', 'ensure', '--production'], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: composeEnvironment,
      });
    }
    execFileSync(
      'docker',
      [...compose, ...routingProfile, 'up', '-d', '--wait', '--wait-timeout', '900'],
      { cwd: projectRoot, stdio: 'inherit', env: composeEnvironment },
    );
    runOperator('preflight');
  } else {
    runOperator(operation, operatorArguments);
  }
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    process.exit(error.status || 1);
  }
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Deployment command failed.'}\n`,
  );
  process.exit(1);
}

function runOperator(command, args = []) {
  execFileSync(
    'docker',
    [
      ...compose,
      '--profile',
      'operations',
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'bun',
      'operator',
      'apps/api/dist/ops/cli.js',
      command,
      ...args,
    ],
    { cwd: projectRoot, stdio: 'inherit', env: composeEnvironment },
  );
}

function compareVersion(left, right) {
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validateSecretFiles() {
  const productionEnvironment = readProductionEnvironment();
  for (const name of [
    'DATABASE_URL_FILE',
    'MIGRATION_DATABASE_URL_FILE',
    'WORKER_DATABASE_URL_FILE',
    'AUTH_SECRET_FILE',
    'S3_ACCESS_KEY_FILE',
    'S3_SECRET_KEY_FILE',
    'SEAWEEDFS_S3_CONFIG_FILE',
    'S3_INIT_ACCESS_KEY_FILE',
    'S3_INIT_SECRET_KEY_FILE',
  ]) {
    const configuredPath = productionEnvironment[name];
    if (!configuredPath) {
      throw new Error(`Invalid production configuration: ${name} is required.`);
    }
    const path = resolve(projectRoot, configuredPath);
    let file;
    try {
      file = lstatSync(path);
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        file.size === 0 ||
        file.size > 1_048_576 ||
        (file.mode & 0o077) !== 0 ||
        realpathSync(path) !== path
      ) {
        throw new Error();
      }
    } catch {
      throw new Error(
        `Invalid production configuration: ${name} must point to a private regular file with mode 0600 or stricter.`,
      );
    }
  }
}

function readProductionEnvironment() {
  return parseEnv(readFileSync(environmentFile, 'utf8'));
}

function buildComposeEnvironment() {
  const environment = { ...process.env };
  for (const filename of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.development',
    '.env.test',
  ]) {
    let values;
    try {
      values = parseEnv(readFileSync(resolve(projectRoot, filename), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const name of Object.keys(values)) delete environment[name];
  }
  return environment;
}

function usesInternalOsrm(value) {
  try {
    return new URL(value).hostname === 'osrm';
  } catch {
    return false;
  }
}
