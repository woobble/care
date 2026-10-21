import { defineConfig, devices } from '@playwright/test';

// Component interaction tests: no OIDC, API, database or application server.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['rhf-action-form.spec.ts', 'error-notices.spec.ts'],
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
