// The always-on week's QM wk-05 r3 ended when QM core, restarted mid-week, exited with EADDRINUSE on its host port.
// These tests reproduce that failure with a listener that still holds the port, and check the wait the runner's compose
// restart now makes before it starts a service labelled harness-eval.restart-port.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { portFree, waitPortFree } from '../runner/trial/docker.ts';

// Every address the host has: IPv6 with IPv4 mapped where it can, IPv4 alone on a host without IPv6.
const hostAll = await new Promise<string>((done) => {
  const s = createServer();
  s.once('error', () => done('0.0.0.0'));
  s.listen({ port: 0, host: '::' }, () => s.close(() => done('::')));
});
const hold = () => new Promise<{ server: Server; port: number }>((done) => {
  const server = createServer();
  server.listen({ port: 0, host: hostAll, exclusive: true }, () => done({ server, port: (server.address() as { port: number }).port }));
});
const bind = (port: number) => new Promise<string | null>((done) => {
  const s = createServer();
  s.once('error', (e: NodeJS.ErrnoException) => done(e.code ?? 'error'));
  s.listen({ port, host: hostAll, exclusive: true }, () => s.close(() => done(null)));
});
const close = (s: Server) => new Promise<void>((done) => s.close(() => done()));

describe('compose restart waits for the host port', () => {
  test('a new start while the old listener holds the port fails with EADDRINUSE, as wk-05 r3 did', async () => {
    const { server, port } = await hold();
    try {
      expect(await bind(port)).toBe('EADDRINUSE');
      expect(await portFree(port)).toBe(false);
    } finally { await close(server); }
    expect(await portFree(port)).toBe(true);
  });

  test('the wait returns once the old listener lets go, and the new start then binds', async () => {
    const { server, port } = await hold();
    const t0 = Date.now();
    setTimeout(() => server.close(), 800);
    expect(await waitPortFree(port, 10_000)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
    expect(await bind(port)).toBe(null);
  });

  test('a port that never frees fails the wait at its timeout', async () => {
    const { server, port } = await hold();
    try {
      const t0 = Date.now();
      expect(await waitPortFree(port, 600)).toBe(false);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(600);
    } finally { await close(server); }
  });

  test('a probe that accepts a connection still answers at once', async () => {
    const { server, port } = await hold();
    await new Promise<void>((done) => server.close(() => done()));
    const { connect } = await import('node:net');
    let client: ReturnType<typeof connect> | null = null;
    const probing = portFree(port);
    client = connect({ port, host: '127.0.0.1' }).on('error', () => {});
    const t0 = Date.now();
    expect(await probing).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
    client.destroy();
  });

  test('QM core names its host port for the restart wait', () => {
    const compose = readFileSync(new URL('../harnesses/qm/compose.yaml', import.meta.url), 'utf8');
    expect(compose).toContain('harness-eval.restart-port: "${QM_CORE_PORT:-58080}"');
  });
});
