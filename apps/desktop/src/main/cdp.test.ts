import { describe, expect, it } from 'vitest';
import { buildCdpUrl, pickFreePort, waitForCdpVersion } from './cdp.js';

describe('pickFreePort', () => {
  it('returns a free loopback port that can be bound to again immediately', async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    // pickFreePort must release the port before returning; verify it's free.
    const net = await import('node:net');
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
    });
  });

  it('returns distinct ports across calls', async () => {
    const a = await pickFreePort();
    const b = await pickFreePort();
    expect(a).not.toBe(b);
  });
});

describe('buildCdpUrl', () => {
  it('builds a loopback-only URL', () => {
    expect(buildCdpUrl(9222)).toBe('http://127.0.0.1:9222');
  });
});

describe('waitForCdpVersion', () => {
  it('resolves once /json/version answers ok', async () => {
    const calls: string[] = [];
    const ok = (async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await expect(waitForCdpVersion('http://127.0.0.1:9222', 1000, ok)).resolves.toBeUndefined();
    expect(calls).toEqual(['http://127.0.0.1:9222/json/version']);
  });

  it('keeps polling while the endpoint refuses connections, then succeeds', async () => {
    let attempts = 0;
    const flaky = (async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ECONNREFUSED');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await expect(waitForCdpVersion('http://127.0.0.1:9222', 5000, flaky)).resolves.toBeUndefined();
    expect(attempts).toBe(3);
  });

  it('throws when the endpoint never answers within the timeout', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await expect(waitForCdpVersion('http://127.0.0.1:9222', 50, failing)).rejects.toThrow(
      /did not answer \/json\/version/,
    );
  });

  it('throws when the endpoint answers with an error status', async () => {
    const failing = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(waitForCdpVersion('http://127.0.0.1:9222', 50, failing)).rejects.toThrow(/500/);
  });
});
