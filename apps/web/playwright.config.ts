import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000';

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
  webServer: {
    command: 'bunx turbo run dev --filter=@care/web',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
