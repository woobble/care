import { defineConfig } from '@playwright/test';

import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../e2e',
  webServer: [],
  outputDir: '../test-results/container-image-e2e',
  use: {
    ...base.use,
    ignoreHTTPSErrors: true,
    launchOptions: {
      ...base.use?.launchOptions,
      args: [
        ...(base.use?.launchOptions?.args ?? []),
        '--host-resolver-rules=MAP care.home.arpa 127.0.0.1, MAP api.care.home.arpa 127.0.0.1, MAP login.care.home.arpa 127.0.0.1',
      ],
    },
  },
});
