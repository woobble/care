import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectName = 'care-platform-e2e-goal15e-a11y';
const portValues = {
  CARE_E2E_POSTGRES_PORT: '15440',
  CARE_E2E_REDIS_PORT: '16384',
  CARE_E2E_AUTHENTIK_PORT: '19170',
  CARE_E2E_S3_PORT: '19171',
  CARE_E2E_FILER_PORT: '19172',
  CARE_E2E_SMTP_PORT: '11040',
  CARE_E2E_MAILPIT_PORT: '18040',
  AUTHENTIK_HOST_PORT: '19170',
  AUTHENTIK_WEB__BASE_URL: 'http://localhost:19170',
  OIDC_ISSUER: 'http://localhost:19170/application/o/care-platform/',
  OIDC_REDIRECT_URI: 'http://localhost:3010/api/auth/callback/authentik',
  SEAWEEDFS_S3_HOST_PORT: '19171',
  SEAWEEDFS_FILER_HOST_PORT: '19172',
  S3_ENDPOINT: 'http://localhost:19171',
  WEB_ORIGIN: 'http://localhost:3010',
  PLAYWRIGHT_BASE_URL: 'http://localhost:3010',
  API_METRICS_PORT: '3014',
  PLAYWRIGHT_HTML_OPEN: 'never',
  PLAYWRIGHT_BROWSERS_PATH: '/tmp/care-playwright-browsers',
  CARE_DISABLE_DOTENV: 'true',
  COMPOSE_PROJECT_NAME: projectName,
  BUN_ENV: 'test',
};

for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'WORKER_DATABASE_URL']) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing from the explicit .env.test input`);
  const url = new URL(value);
  url.port = portValues.CARE_E2E_POSTGRES_PORT;
  portValues[key] = url.toString();
}

const env = { ...process.env, ...portValues };
const [mode, ...args] = process.argv.slice(2);
const compose = [
  'compose',
  '--env-file=.env.test',
  '--project-name',
  projectName,
  '-f',
  'compose.yaml',
  '-f',
  'compose.e2e.yaml',
  '-f',
  'compose.authentik-patched-e2e.yaml',
];

function run(command, commandArgs, nodeEnvironment) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    env: { ...env, NODE_ENV: nodeEnvironment },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'up') {
  run('docker', [...compose, '--profile', 'development', 'up', '-d', '--wait'], 'development');
  run(
    'docker',
    [
      ...compose,
      '--profile',
      'development',
      '--profile',
      'bootstrap',
      'run',
      '--rm',
      '--no-deps',
      'seaweedfs-init',
    ],
    'development',
  );
} else if (mode === 'migrate') {
  run('bun', ['--env-file=.env.test', 'run', 'migrate'], 'development');
} else if (mode === 'seed') {
  run('bun', ['--env-file=.env.test', 'run', 'seed'], 'development');
} else if (mode === 'e2e') {
  run(
    'node',
    [
      '--env-file=.env.test',
      'apps/web/node_modules/@playwright/test/cli.js',
      'test',
      '--config=apps/web/playwright.config.ts',
      ...args,
    ],
    'test',
  );
} else if (mode === 'down') {
  run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], 'development');
} else {
  throw new Error(
    'Usage: node --env-file=.env.test scripts/accessibility-e2e.mjs <up|migrate|seed|e2e|down>',
  );
}
