import { uiOrigin } from './tests/browser/helpers/origin';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir:'test-results/ui',
  testDir:'tests/browser',use:{baseURL:uiOrigin,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure',viewport:{width:1440,height:1000}},
  webServer:{command:'npm run dev -- --port 5183 --strictPort',url:uiOrigin,reuseExistingServer:false},
});
