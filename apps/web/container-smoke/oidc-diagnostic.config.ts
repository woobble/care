import { defineConfig } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'oidc-diagnostic.spec.ts',
  outputDir: './test-results/oidc-diagnostic',
});
