import net from 'node:net';

/** Binds an ephemeral loopback port and releases it for Chromium's remote-debugging-port switch. */
export async function pickFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export function buildCdpUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

const CDP_POLL_INTERVAL_MS = 200;

/**
 * Polls the DevTools `/json/version` endpoint until Chromium's remote-debugging
 * server answers (the `--smoke` CI check). Throws once `timeoutMs` elapses.
 */
export async function waitForCdpVersion(
  cdpUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = new Error('not attempted');
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${cdpUrl}/json/version`);
      if (res.ok) return;
      lastError = new Error(`${cdpUrl}/json/version responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, CDP_POLL_INTERVAL_MS));
  }
  throw new Error(
    `CDP endpoint ${cdpUrl} did not answer /json/version within ${timeoutMs} ms: ${String(lastError)}`,
  );
}
