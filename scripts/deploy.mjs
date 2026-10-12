import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environmentFile = resolve(projectRoot, '.env.production');
const [operation, ...operatorArguments] = process.argv.slice(2);
const operatorCommands = new Set([
  'preflight',
  'bootstrap-admin',
  'create',
  'verify',
  'restore',
  'prune',
]);

if (!operation || !operatorCommands.has(operation)) {
  process.stderr.write(
    'Usage: bun run deploy:check | deploy:bootstrap-admin -- ... | backup:create | backup:verify | backup:restore | backup:prune\n',
  );
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
  '--env-file',
  '.env.production',
  '-f',
  'compose.yaml',
  '-f',
  'compose.production.yaml',
  '--profile',
  'operations',
];

try {
  const version = execFileSync('docker', ['compose', 'version', '--short'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const numbers = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!numbers || compareVersion(numbers.slice(1).map(Number), [2, 24, 4]) < 0) {
    throw new Error(
      `Docker Compose ${version || 'unknown'} is too old; version 2.24.4 or newer is required.`,
    );
  }
  execFileSync('docker', [...compose, 'config', '--quiet'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  execFileSync('docker', [...compose, 'build', 'operator'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  execFileSync(
    'docker',
    [...compose, 'run', '--rm', '--no-deps', 'operator', operation, ...operatorArguments],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  );
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    process.exit(error.status || 1);
  }
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Deployment command failed.'}\n`,
  );
  process.exit(1);
}

function compareVersion(left, right) {
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validateSecretFiles() {
  const originalEnvironment = new Map(Object.entries(process.env));
  try {
    loadEnvFile(environmentFile);
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
      const configuredPath = process.env[name];
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
  } finally {
    for (const name of Object.keys(process.env)) {
      if (!originalEnvironment.has(name)) delete process.env[name];
    }
    for (const [name, value] of originalEnvironment) process.env[name] = value;
  }
}
