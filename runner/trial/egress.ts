// GST-2715: the open-egress proxy of the gbrain install trial (network "install"). The agent has to reach GitHub, npm,
// bun.sh and whatever else an install takes, so this proxy admits every host and port except the source's blocklist
// (scripts/egress/egress_blocklist.py gbrain-install: direct provider hosts, so every model call goes through the metering
// proxy, and hosted gbrain, which needs a person). It runs on the host, so it also refuses an IP address as a target (the
// blocklist matches names; decimal, hex and octal IPv4 forms count) and a name that resolves to a loopback, private, link-local
// or other local address, and it connects only to the addresses it checked. A port outside 1 to 65535 is answered 400. It
// tunnels CONNECT and forwards plain HTTP requests in absolute form, one request per connection (it sends "connection: close"
// upstream), and logs every connection, admitted, refused or failed, as one line with the current trial: method, host, port
// and decision, plus the response status of a plain HTTP request. A tunnelled response's status is inside TLS and cannot be seen here. No header,
// and so no credential, is ever logged. It listens on the given address only (the internal network's gateway).

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, type Server, type Socket, connect, createServer, isIP } from 'node:net';
import { join } from 'node:path';
import { RunnerError } from '../errors.ts';

/** decision: allowed (connected, and for plain HTTP answered), blocked (refused by the rules, or a malformed request), or failed
 *  (admitted, but the name did not resolve, the connection failed or the upstream closed with no response; reason says which). */
export interface EgressLine { at: string; trial: string | null; method: string; host: string; port: number; decision: 'allowed' | 'blocked' | 'failed'; reason?: string; status?: number }

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

/** The host is an IP address in any form a resolver takes: dotted, IPv6, or IPv4 written as one decimal, hex or octal number or
 *  in fewer than four parts (2130706433, 0x7f000001 and 0177.1 are all 127.0.0.1). The WHATWG URL parser normalizes the IPv4
 *  forms, so whatever it turns into an IP address is one. */
export function isIpLiteral(host: string): boolean {
  if (isIP(host)) return true;
  try { return isIP(new URL(`http://${host}/`).hostname) !== 0; } catch { return false; }
}

/** The container environment for the open-egress proxy: HTTP and HTTPS proxy for every client that reads them (Node's fetch
 *  with NODE_USE_ENV_PROXY=1, bun, curl, git, pip), and no proxy for the metering proxy on the gateway. */
export const openEgressEnv = (proxyUrl: string): Record<string, string> => ({
  HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl, all_proxy: proxyUrl, NODE_USE_ENV_PROXY: '1',
  NO_PROXY: 'host.docker.internal,localhost,127.0.0.1', no_proxy: 'host.docker.internal,localhost,127.0.0.1',
});

/** `trusted`: targets admitted although they are an IP address or a local one, and `resolve`, which replaces the DNS lookup;
 *  both for tests only. */
export async function startOpenEgress(o: { host: string; block: readonly string[]; logPath: string; port?: number; trusted?: readonly string[]; resolve?: (host: string) => Promise<LookupAddress[]> }): Promise<OpenEgress> {
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
      client.off('data', onChunk);
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
      const refuse = (reason: string, status = '403 Forbidden') => { record({ method: method.slice(0, 16), host, port, decision: 'blocked', reason }, forTrial); client.end(`HTTP/1.1 ${status}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`); };
      let logged = false;
      const failed = (reason: string) => {
        if (!logged) record({ method: method.slice(0, 16), host, port, decision: 'failed', reason }, forTrial);
        logged = true;
        if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
      };
      if (!host) return refuse(method === 'CONNECT' ? 'target is not host:port' : 'not an absolute http:// request');
      if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse(`port ${port} is outside 1 to 65535`, '400 Bad Request');
      const hit = blockedBy(host, o.block);
      if (hit) return refuse(`host matches the blocklist entry ${hit}`);
      const trusted = !!o.trusted?.includes(host);
      if (!trusted && isIpLiteral(host)) return refuse('target is an IP address; the blocklist matches host names');
      const found = await (o.resolve ?? ((h: string) => lookup(h, { all: true })))(host).catch((e: NodeJS.ErrnoException) => e.code ?? 'lookup failed');
      if (typeof found === 'string' || !found.length) return failed(`no address for the host: ${typeof found === 'string' ? found : 'none'}`);
      const local = trusted ? undefined : found.find((a) => LOCAL.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
      if (local) return refuse(`host resolves to the local address ${local.address}`);
      // The vetted addresses, IPv4 first, are the only ones connect may use: its lookup hands back this list, so the name is
      // never resolved again and connect still falls back to the next address when one fails.
      const vetted = [...found.filter((a) => a.family === 4), ...found.filter((a) => a.family !== 4)];
      if (client.destroyed) return;
      let upstream: Socket;
      try {
        upstream = connect({ host, port, lookup: (_name, options, cb) => options.all ? cb(null, vetted) : cb(null, vetted[0]!.address, vetted[0]!.family) });
      } catch (e) { return failed(`connect failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`); }
      sockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        if (forward && !logged) { logged = true; record({ method: method.slice(0, 16), host, port, decision: 'failed', reason: 'upstream closed with no response' }, forTrial); }
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
    const onChunk = (chunk: Buffer) => { onData(chunk).catch(() => client.destroy()); };
    client.on('data', onChunk);
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
