import { defineConfig, devices } from '@playwright/test';
const baseURL = `http://localhost:${process.env.EPI_LESS_PORT || 4321}`;
export default defineConfig({
  testDir: 'tests/web',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'EPI_LESS_PREVIEW=true pnpm dev',
    url: baseURL,
    reuseExistingServer: process.env.EPI_LESS_REUSE_SERVER === 'true',
    timeout: 120000,
  },
  reporter: process.env.CI ? 'github' : 'list',
});
