import { describe, expect, it } from 'vitest';
import { buildCdpUrl, pickFreePort } from './cdp.js';

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
