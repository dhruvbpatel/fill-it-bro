import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');

test('missing --dealId/--formId exits with code 2', async () => {
  // --no-sandbox: matches host.spec.ts's Playwright electron launch (which adds it
  // automatically) -- GitHub's Linux runners can't run Electron's sandbox without it,
  // and the process dies to a signal (exit code null) before reaching app.exit(2).
  const proc = spawn(String(electronPath), [mainPath, '--no-sandbox'], {
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
  });
  expect(exitCode).toBe(2);
});
