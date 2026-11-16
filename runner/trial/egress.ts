// internal-task: the open-egress proxy of the gbrain install trial (network "install"). The agent has to reach GitHub, npm,
// bun.sh and whatever else an install takes, so this proxy admits every host and port except the source's blocklist
// (scripts/egress/egress_blocklist.py gbrain-install: direct provider hosts, so every model call goes through the metering
// proxy, and hosted gbrain, which needs a person). It runs on the host, so it also refuses an IP address as a target (the
// blocklist matches names) and a name that resolves to a loopback, private, link-local or other local address, and it
// connects to the address it checked. It tunnels CONNECT and forwards plain HTTP requests in absolute form, one request per
// connection (it sends "connection: close" upstream), and
// logs every connection, admitted or refused, as one line with the current trial: method, host, port and decision, plus the
// response status of a plain HTTP request. A tunnelled response's status is inside TLS and cannot be seen here. No header,
// and so no credential, is ever logged. It listens on the given address only (the internal network's gateway).

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { BlockList, type Server, type Socket, connect, createServer, isIP } from 'node:net';
import { join } from 'node:path';
import { RunnerError } from '../errors.ts';

export interface EgressLine { at: string; trial: string | null; method: string; host: string; port: number; decision: 'allowed' | 'blocked'; reason?: string; status?: number }

export interface OpenEgress {
  port: number;
  /** The URL a container on the internal network uses as HTTPS_PROXY and HTTP_PROXY. */
  proxyUrl: string;
  setTrial(trialId: string | null): void;
  /** Every line logged for one trial so far. */
  lines(trialId: string): EgressLine[];
  stop(): Promise<void>;
}

/** The source's blocklist from scripts/egress/egress_blocklist.py, which checks it by the frontier rules (HE-FRONTIER-004). */
export function loadBlocklist(source: string, repoRoot = '.'): string[] {
  const r = spawnSync('python3', [join(repoRoot, 'scripts', 'egress', 'egress_blocklist.py'), source], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  if (r.status !== 0) throw new RunnerError('HE-NET-001', `the egress blocklist of ${source} did not load: ${(r.stderr || r.error?.message || '').trim().split('\n').pop()}; fix: python3 scripts/egress/egress_blocklist.py ${source}`);
  return r.stdout.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean);
}

/** The blocklist entry a host matches, or null: exact, or with "*" matching any run of characters ("*.gbrain.io" matches
 *  every subdomain, "*-aiplatform.googleapis.com" every regional host). Case and a trailing dot are ignored. */
export function blockedBy(host: string, patterns: readonly string[]): string | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  for (const p of patterns) {
    if (!p.includes('*')) { if (h === p) return p; continue; }
    const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\-]/g, '\\$&')).join('.*') + '$');
    if (re.test(h)) return p;
  }
  return null;
}

/** Addresses the open-egress proxy never connects to: unspecified, loopback, private, shared, link-local (cloud metadata
 *  included), benchmark, multicast and reserved ranges. An IPv4-mapped IPv6 address is checked as its IPv4 address. */
const LOCAL = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) LOCAL.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) LOCAL.addSubnet(net, bits, 'ipv6');

/** The container environment for the open-egress proxy: HTTP and HTTPS proxy for every client that reads them (Node's fetch
 *  with NODE_USE_ENV_PROXY=1, bun, curl, git, pip), and no proxy for the metering proxy on the gateway. */
export const openEgressEnv = (proxyUrl: string): Record<string, string> => ({
  HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl, all_proxy: proxyUrl, NODE_USE_ENV_PROXY: '1',
  NO_PROXY: 'host.docker.internal,localhost,127.0.0.1', no_proxy: 'host.docker.internal,localhost,127.0.0.1',
});

/** `trusted`: targets admitted although they are an IP address or a local one, for tests only. */
export async function startOpenEgress(o: { host: string; block: readonly string[]; logPath: string; port?: number; trusted?: readonly string[] }): Promise<OpenEgress> {
  let trial: string | null = null;
  const all: EgressLine[] = [];
  const sockets = new Set<Socket>();
  const record = (d: Omit<EgressLine, 'at' | 'trial'>, forTrial: string | null) => {
    const line: EgressLine = { at: new Date().toISOString(), trial: forTrial, ...d };
    all.push(line);
    appendFileSync(o.logPath, JSON.stringify(line) + '\n');
  };
  const server: Server = createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    const forTrial = trial;
    let head = Buffer.alloc(0);
    const onData = async (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > 65536) client.destroy(); return; }
      client.off('data', onData);
      client.pause();
      const lineEnd = head.indexOf('\r\n');
      const [method = '', target = '', version = 'HTTP/1.1'] = head.subarray(0, lineEnd).toString('latin1').split(' ');
      const rest = head.subarray(end + 4);
      let host = '';
      let port = 0;
      let forward: Buffer | null = null;
      if (method === 'CONNECT') {
        const m = /^\[?([A-Za-z0-9.:-]+?)\]?:(\d+)$/.exec(target);
        host = (m?.[1] ?? '').toLowerCase();
        port = m ? Number(m[2]) : 0;
      } else {
        let url: URL | null = null;
        try { url = new URL(target); } catch { url = null; }
        if (url && url.protocol === 'http:') {
          host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
          port = Number(url.port || 80);
          const headers = head.subarray(lineEnd + 2, end).toString('latin1').split('\r\n').filter((h) => h && !/^(proxy-connection|proxy-authorization|connection|keep-alive):/i.test(h));
          forward = Buffer.concat([Buffer.from(`${method} ${url.pathname}${url.search} ${version}\r\n${[...headers, 'connection: close'].join('\r\n')}\r\n\r\n`, 'latin1'), rest]);
        }
      }
      const refuse = (reason: string) => { record({ method: method.slice(0, 16), host, port, decision: 'blocked', reason }, forTrial); client.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'); };
      let logged = false;
      const failed = (reason: string) => {
        if (!logged) record({ method: method.slice(0, 16), host, port, decision: 'allowed', reason }, forTrial);
        logged = true;
        if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
      };
      if (!host || !port) return refuse(method === 'CONNECT' ? 'target is not host:port' : 'not an absolute http:// request');
      const hit = blockedBy(host, o.block);
      if (hit) return refuse(`host matches the blocklist entry ${hit}`);
      let address = host;
      if (!o.trusted?.includes(host)) {
        if (isIP(host)) return refuse('target is an IP address; the blocklist matches host names');
        const found = await lookup(host, { all: true }).catch((e: NodeJS.ErrnoException) => e.code ?? 'lookup failed');
        if (typeof found === 'string' || !found.length) return failed(`no address for the host: ${typeof found === 'string' ? found : 'none'}`);
        const local = found.find((a) => LOCAL.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
        if (local) return refuse(`host resolves to the local address ${local.address}`);
        address = (found.find((a) => a.family === 4) ?? found[0]).address;
      }
      if (client.destroyed) return;
      const upstream = connect({ host: address, port });
      sockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        if (forward && !logged) { logged = true; record({ method: method.slice(0, 16), host, port, decision: 'allowed', reason: 'upstream closed with no response' }, forTrial); }
        client.destroy();
      });
      client.on('close', () => upstream.destroy());
      upstream.once('connect', () => {
        if (forward) {
          upstream.on('data', (b: Buffer) => {
            if (logged) return;
            logged = true;
            const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(b.subarray(0, 32).toString('latin1'))?.[1] ?? 0);
            record({ method: method.slice(0, 16), host, port, decision: 'allowed', ...(status ? { status } : {}) }, forTrial);
          });
          upstream.write(forward);
        } else {
          logged = true;
          record({ method, host, port, decision: 'allowed' }, forTrial);
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (rest.length) upstream.write(rest);
        }
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
      upstream.on('error', (e: NodeJS.ErrnoException) => { failed(`upstream error: ${e.code ?? e.message}`); upstream.destroy(); });
    };
    client.on('data', onData);
  });
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(o.port ?? 0, o.host, () => res()); });
  const port = (server.address() as { port: number }).port;
  return {
    port,
    proxyUrl: `http://host.docker.internal:${port}`,
    setTrial(id) { trial = id; },
    lines: (id) => all.filter((l) => l.trial === id),
    stop: () => new Promise<void>((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); }),
  };
}
