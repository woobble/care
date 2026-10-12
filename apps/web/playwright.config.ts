import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(configDirectory, '../../.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const apiPort = await findAvailablePort();
const apiURL = `http://localhost:${apiPort}`;
const webPort = new URL(baseURL).port || '3000';

// Give each run a fresh API process so an old dev server cannot keep stale storage settings.
process.env.API_INTERNAL_URL = apiURL;
process.env.WEB_ORIGIN = baseURL;

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
  webServer: [
    {
      name: 'Care API',
      command: 'bun run dev',
      cwd: resolve(configDirectory, '../api'),
      url: `${apiURL}/health/live`,
      env: { PORT: String(apiPort), WEB_ORIGIN: baseURL },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'Care web',
      command: 'bun run dev',
      cwd: configDirectory,
      url: baseURL,
      env: { PORT: webPort, API_INTERNAL_URL: apiURL, WEB_ORIGIN: baseURL },
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
