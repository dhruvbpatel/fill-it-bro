import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');

test('missing --dealId/--formId exits with code 2', async () => {
  const proc = spawn(String(electronPath), [mainPath], {
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
  });
  expect(exitCode).toBe(2);
});
