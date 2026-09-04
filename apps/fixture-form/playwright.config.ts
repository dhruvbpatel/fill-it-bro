import { defineConfig, devices } from '@playwright/test';

const port = process.env.FIXTURE_PORT ?? '4300';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: 'pnpm run serve',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
