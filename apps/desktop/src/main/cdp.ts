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
