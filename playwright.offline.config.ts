import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/offline',
  outputDir: 'test-results/offline',
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4174/rocos-configurator/',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'node scripts/serve-static.mjs --port 4174 --base /rocos-configurator/',
    url: 'http://127.0.0.1:4174/rocos-configurator/',
    reuseExistingServer: false,
  },
});
