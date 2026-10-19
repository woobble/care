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

if (process.env.OIDC_ISSUER) await waitForOidcDiscovery(process.env.OIDC_ISSUER);

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

async function waitForOidcDiscovery(issuer: string): Promise<void> {
  const discoveryUrl = new URL('.well-known/openid-configuration', issuer);
  const deadline = Date.now() + 90_000;
  let lastStatus: number | undefined;

  while (Date.now() < deadline) {
    let response: Response | undefined;
    try {
      // oxlint-disable-next-line no-await-in-loop -- poll until Authentik exposes its OIDC endpoints
      response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(2_000) });
    } catch {
      // Authentik can be healthy before its application blueprint is available.
    }

    if (response?.ok) {
      // oxlint-disable-next-line no-await-in-loop -- validate this response before the next poll
      const metadata = (await response.json()) as {
        issuer?: unknown;
        authorization_endpoint?: unknown;
        token_endpoint?: unknown;
      };
      if (metadata.issuer !== issuer) {
        throw new Error('Authentik discovery issuer does not match OIDC_ISSUER.');
      }
      if (
        typeof metadata.authorization_endpoint !== 'string' ||
        typeof metadata.token_endpoint !== 'string'
      ) {
        throw new Error('Authentik discovery is missing an authorization or token endpoint.');
      }
      return;
    }

    lastStatus = response?.status;
    // oxlint-disable-next-line no-await-in-loop -- poll the observable OIDC discovery endpoint
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  const responseStatus = lastStatus ? `HTTP ${lastStatus}` : 'no response';
  throw new Error(
    `Authentik OIDC discovery was not ready before Playwright servers started (${responseStatus}).`,
  );
}
