import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const configDirectory = dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Browser tests refuse NODE_ENV=production; configure a dedicated .env.test file.',
  );
}
Reflect.set(process.env, 'NODE_ENV', process.env.NODE_ENV ?? 'test');
const envFile = resolve(configDirectory, '../../.env.test');
if (existsSync(envFile)) loadEnvFile(envFile);

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const useExistingServers = process.env.PLAYWRIGHT_USE_EXISTING_SERVERS === 'true';
const apiPort = useExistingServers ? undefined : await findAvailablePort();
const apiURL = apiPort
  ? `http://localhost:${apiPort}`
  : (process.env.API_INTERNAL_URL ?? 'http://localhost:3001');
const webPort = new URL(baseURL).port || '3000';

if (!useExistingServers && apiURL) {
  // Give each run a fresh API process so an old dev server cannot keep stale storage settings.
  process.env.API_INTERNAL_URL = apiURL;
  process.env.WEB_ORIGIN = baseURL;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: useExistingServers
    ? []
    : [
        {
          name: 'Care API',
          command: 'bun run dev',
          cwd: resolve(configDirectory, '../api'),
          url: `${apiURL!}/health/live`,
          env: {
            CARE_DISABLE_DOTENV: 'true',
            NODE_ENV: 'development',
            PORT: String(apiPort!),
            WEB_ORIGIN: baseURL,
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          name: 'Care web',
          command: 'bun run dev',
          cwd: configDirectory,
          url: baseURL,
          env: {
            CARE_DISABLE_DOTENV: 'true',
            NODE_ENV: 'development',
            PORT: webPort,
            API_INTERNAL_URL: apiURL,
            WEB_ORIGIN: baseURL,
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an API port');
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}
