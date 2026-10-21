import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir:'test-results/ui',
  testDir:'tests/browser',use:{baseURL:'http://127.0.0.1:5173',channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure',viewport:{width:1440,height:1000}},
  webServer:{command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
});
