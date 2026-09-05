import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = process.env.FIXTURE_PORT ?? '4300';

function cleanupDir(dir: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt >= 14) return; // best-effort: chromium children may still be writing
      const wait = [50, 100, 200, 400][Math.min(attempt, 3)];
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

export const FIXTURE_BASE_URL = `http://localhost:${port}`;

export const FIXTURE_PAGE_URL = /^http:\/\/localhost:\d+\/deal\/\d+$/;

export interface LaunchedChromium {
  cdpUrl: string;
  stop: () => void;
  proc: ChildProcess;
}

export async function launchChromiumOverCdp(
  startUrl = `${FIXTURE_BASE_URL}/deal/1`,
): Promise<LaunchedChromium> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'fib-driver-cdp-'));
  const proc = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      startUrl,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const fail = (message: string): never => {
    proc.kill('SIGKILL');
    cleanupDir(userDataDir);
    throw new Error(`${message}\n--- chromium output ---\n${output.trim() || '(none)'}`);
  };
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (!existsSync(portFile)) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      fail(`chromium exited early (code ${proc.exitCode}, signal ${proc.signalCode})`);
    }
    if (Date.now() > deadline) {
      fail('timed out waiting for chromium to write DevToolsActivePort');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const devtoolsPort = Number.parseInt(readFileSync(portFile, 'utf8').split('\n')[0] ?? '', 10);
  return {
    cdpUrl: `http://127.0.0.1:${devtoolsPort}`,
    proc,
    stop: async () => {
      if (proc.exitCode === null) {
        await new Promise<void>((resolve) => {
          proc.once('exit', () => resolve());
          const killTimer = setTimeout(() => proc.kill('SIGKILL'), 2_000);
          killTimer.unref();
          proc.kill('SIGTERM');
        });
      }
      cleanupDir(userDataDir);
    },
  };
}

export async function evaluateInFixturePage<T>(cdpUrl: string, fn: () => T): Promise<T> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => FIXTURE_PAGE_URL.test(candidate.url()));
    if (!page) throw new Error('fixture page not found over CDP');
    return await page.evaluate(fn);
  } finally {
    await browser.close();
  }
}
