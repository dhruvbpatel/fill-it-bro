import { defineConfig } from '@playwright/test';

const port = process.env.FIXTURE_PORT ?? '4300';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  webServer: {
    command: 'pnpm --filter fixture-form run serve',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
