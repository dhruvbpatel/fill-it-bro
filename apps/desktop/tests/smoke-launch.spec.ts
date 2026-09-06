import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');

// Ticket 28: `--smoke` must print the CDP URL, wait for /json/version and exit 0.
// The CI build-exe job runs the same flow against the packaged portable EXE.
test('--smoke exits 0 once the CDP endpoint answers', async () => {
  const proc = spawn(
    String(electronPath),
    [mainPath, '--no-sandbox', '--dealId=1', '--formId=fixtureDeal', '--smoke'],
    {
      env: { ...process.env, CI: '1', FIB_SMOKE_TIMEOUT_MS: '30000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const { code, stdout } = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
    let out = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.once('exit', (code) => resolve({ code, stdout: out }));
  });
  expect(stdout).toContain('[fib] cdp-url http://127.0.0.1:');
  expect(stdout).toContain(`[fib] smoke ok http://127.0.0.1:`);
  expect(code).toBe(0);
});
