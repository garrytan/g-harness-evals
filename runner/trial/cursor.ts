// The Cursor CLI harness (harnesses/cursor) on the runner's side. Cursor has no bring-your-own-key: the CLI sends every
// model call to Cursor's own backend with CURSOR_API_KEY, so a Cursor cell runs without a metering-proxy slot (an approved
// exception to methodology item 3; its cost comes from Cursor's usage export, scripts/cursor/usage-export.ts). What the
// runner does instead, for Cursor cells only:
//   - refuses a Cursor cell whose model is not the pin's (HE-CURSOR-001), or that is not a docker cell on the internal
//     network (HE-CURSOR-002), at plan, preflight and run, and a run whose key is missing (HE-CURSOR-002);
//   - moves CURSOR_API_KEY out of its own environment at start (takeCursorKey), so no child process it starts inherits
//     it, and hands it to the Cursor container's docker run alone, by name (docker run -e CURSOR_API_KEY), never in argv;
//   - starts a CONNECT allowlist on the internal network's gateway that tunnels only to the pin's egress hosts on port 443
//     and logs every decision with the trial (egress.ndjson beside the manifest); the container reaches it as
//     HTTPS_PROXY, and the internal network gives it no other route off the machine;
//   - scans each Cursor trial directory for the key's value after the trial (keyValueFound) and stops the run on a hit
//     (HE-CURSOR-003). The scan answers yes or no; it never prints, logs or returns any part of the value.
// --cursor-offline (run) is the keyless rehearsal: a random canary stands in for the key and the allowlist admits no
// host, so a trial runs the world, the container, the adapter and the CLI up to its first connection to Cursor, which the
// allowlist denies and logs; the scan then looks for the canary.

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { RunnerError } from '../errors.ts';

export const CURSOR_HARNESS = 'cursor';
export const CURSOR_KEY_ENV = 'CURSOR_API_KEY';

/** pin.json model_cursor, the declaration that this harness talks to Cursor's backend and to no proxy route. */
export interface CursorTransport { transport: string; proxy_routes: string[]; cell_model: string; model_id: string; turn_model: string; egress_hosts: string[] }

export const isCursorCell = (cell: { harness: string }): boolean => cell.harness === CURSOR_HARNESS;

export function cursorTransport(root = '.'): CursorTransport {
  const path = join(root, 'harnesses', CURSOR_HARNESS, 'pin.json');
  let t: Partial<CursorTransport> | undefined;
  try { t = (JSON.parse(readFileSync(path, 'utf8')) as { model_cursor?: Partial<CursorTransport> }).model_cursor; } catch { t = undefined; }
  if (!t || typeof t.cell_model !== 'string' || typeof t.model_id !== 'string' || typeof t.turn_model !== 'string' || !Array.isArray(t.egress_hosts) || !t.egress_hosts.length || !Array.isArray(t.proxy_routes))
    throw new RunnerError('HE-PIN-001', `${path} has no complete model_cursor transport (cell_model, model_id, turn_model, egress_hosts, proxy_routes); fix: restore the Cursor pin`);
  return t as CursorTransport;
}

export interface CursorCellFields { id: string; harness: string; model: string; network?: string; harness_mode?: string; utility_models?: string[]; gbrain?: { embeddings?: string } }

/** The plan-time checks of one Cursor cell: the pinned model only, docker mode on the internal network, no gbrain
 *  embeddings (they would need the proxy), no utility models (nothing meters them). Other harnesses pass untouched. */
export function checkCursorCell(c: CursorCellFields, root = '.'): void {
  if (!isCursorCell(c)) return;
  const t = cursorTransport(root);
  if (c.model !== t.cell_model) throw new RunnerError('HE-CURSOR-001', `cell ${c.id}: harness cursor runs only on ${t.cell_model} (harnesses/cursor/pin.json model_cursor.cell_model, sent to Cursor as ${t.turn_model}); got ${c.model}. fix: set the cell's model to ${t.cell_model} or run that model on another harness`);
  if (c.utility_models?.length) throw new RunnerError('HE-CURSOR-001', `cell ${c.id}: harness cursor takes no utility_models (${c.utility_models.join(', ')}); its calls go to Cursor's backend, not the metering proxy. fix: drop utility_models`);
  if (c.harness_mode !== undefined && c.harness_mode !== 'docker') throw new RunnerError('HE-CURSOR-002', `cell ${c.id}: harness cursor runs in docker mode only (got harness_mode ${c.harness_mode}); the key goes into its container and nowhere else. fix: drop harness_mode`);
  if (c.network !== 'internal') throw new RunnerError('HE-CURSOR-002', `cell ${c.id}: harness cursor needs network "internal": its only route off the machine is the runner's egress allowlist to ${t.egress_hosts.join(', ')}. fix: add "network": "internal" to the cell`);
  if (c.gbrain?.embeddings && c.gbrain.embeddings !== 'off') throw new RunnerError('HE-CURSOR-002', `cell ${c.id}: harness cursor with gbrain.embeddings ${c.gbrain.embeddings} would need the metering proxy, which a Cursor cell does not use. fix: use gbrain.embeddings "off"`);
}

/** run: every Cursor cell passes checkCursorCell, and the run has a key (CURSOR_API_KEY, or the --cursor-offline canary). */
export function requireCursorCells(cells: CursorCellFields[], keySet: boolean, root = '.'): void {
  const cursor = cells.filter(isCursorCell);
  for (const c of cursor) checkCursorCell(c, root);
  if (cursor.length && !keySet) throw new RunnerError('HE-CURSOR-002', `cells ${cursor.map((c) => c.id).join(', ')} run the Cursor CLI and ${CURSOR_KEY_ENV} is not set in this shell; the runner passes it by name into their containers only. fix: set it in the runner's environment, or pass --cursor-offline for the keyless rehearsal`);
}

/** Moves CURSOR_API_KEY out of the environment (this process's by default) and returns it, so no child process started
 *  afterwards inherits it. runner/run.ts calls it first thing; the value then travels only in RunOptions.cursor. */
export function takeCursorKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const value = env[CURSOR_KEY_ENV];
  delete env[CURSOR_KEY_ENV];
  return value || undefined;
}

/** The stand-in key of a --cursor-offline run: random per run, so the scan's hit can only come from this run. */
export const offlineCanary = (): string => `he-cursor-offline-canary-${randomUUID()}`;

// ---- the key scan --------------------------------------------------------------------------------------------------

/** The byte strings a leak would show: the whole value, its first 16 and its last 12 characters (the public export's
 *  needles, scripts/public-export/scan.ts keyNeedles). A value of 12 characters or fewer is matched whole only. */
function needles(value: string): Buffer[] {
  const out = [Buffer.from(value)];
  if (value.length > 16) out.push(Buffer.from(value.slice(0, 16)));
  if (value.length > 12) out.push(Buffer.from(value.slice(-12)));
  return out;
}

/** The files under the roots that hold the value (raw, or gunzipped for a .gz file), as paths. Symbolic links are not
 *  followed; a file or directory that cannot be read is listed too, so the scan fails closed. The value and the files'
 *  contents never leave this function. */
export function keyValueFiles(roots: string[], value: string): string[] {
  if (!value) throw new RunnerError('HE-CURSOR-003', 'the key scan was given an empty value; fix: run it with CURSOR_API_KEY set');
  const ns = needles(value);
  const hit = (b: Buffer) => ns.some((n) => b.indexOf(n) >= 0);
  const found: string[] = [];
  const visit = (p: string): void => {
    let st;
    try { st = lstatSync(p); } catch { found.push(p); return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      let names: string[];
      try { names = readdirSync(p); } catch { found.push(p); return; }
      for (const n of names) visit(join(p, n));
      return;
    }
    if (!st.isFile()) return;
    let data: Buffer;
    try { data = readFileSync(p); } catch { found.push(p); return; }
    if (hit(data)) { found.push(p); return; }
    if (p.endsWith('.gz')) { try { if (hit(gunzipSync(data))) found.push(p); } catch { /* not gzip after all: its raw bytes were scanned */ } }
  };
  for (const r of roots) if (existsSync(r)) visit(r);
  return found;
}

export const keyValueFound = (roots: string[], value: string): boolean => keyValueFiles(roots, value).length > 0;

// ---- the egress allowlist ------------------------------------------------------------------------------------------

export interface EgressDecision { at: string; trial: string | null; method: string; host: string; port: number; decision: 'allow' | 'deny'; reason?: string }

export interface EgressAllowlist {
  port: number;
  /** The URL a container on the internal network uses as HTTPS_PROXY. */
  proxyUrl: string;
  setTrial(trialId: string | null): void;
  /** Denials logged for one trial so far. */
  denials(trialId: string): EgressDecision[];
  stop(): Promise<void>;
}

/** The environment a Cursor container gets for its egress: the allowlist as its HTTP and HTTPS proxy (the CLI reads them
 *  with NODE_USE_ENV_PROXY=1, Cursor's "Proxy configuration" docs), and no proxy for the world and gbrain on the gateway. */
export const cursorEgressEnv = (proxyUrl: string): Record<string, string> => ({
  HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl, NODE_USE_ENV_PROXY: '1',
  NO_PROXY: 'host.docker.internal,localhost,127.0.0.1', no_proxy: 'host.docker.internal,localhost,127.0.0.1',
});

/** A CONNECT-only proxy: a tunnel to host:443 for a host on the list, 403 for anything else (another host or port, a
 *  plain HTTP request). allowPort exists for the tests, which cannot listen on 443. Each decision is one line in the log with the current trial; no header, and so no credential,
 *  is ever logged. It listens on the given address only (the internal network's gateway), never on every interface. */
export async function startEgressAllowlist(o: { host: string; allow: string[]; logPath: string; port?: number; allowPort?: number }): Promise<EgressAllowlist> {
  const allowPort = o.allowPort ?? 443;
  const allow = new Set(o.allow.map((h) => h.toLowerCase()));
  let trial: string | null = null;
  const decisions: EgressDecision[] = [];
  const sockets = new Set<Socket>();
  const record = (d: Omit<EgressDecision, 'at' | 'trial'>) => {
    const line: EgressDecision = { at: new Date().toISOString(), trial, ...d };
    decisions.push(line);
    appendFileSync(o.logPath, JSON.stringify(line) + '\n');
  };
  const server: Server = createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > 16384) client.destroy(); return; }
      client.off('data', onData);
      client.pause();
      const [method = '', target = ''] = head.subarray(0, head.indexOf('\r\n')).toString('latin1').split(' ');
      const rest = head.subarray(end + 4);
      const m = /^([A-Za-z0-9.-]+):(\d+)$/.exec(target);
      const host = (m?.[1] ?? target.replace(/^[a-z]+:\/\//i, '').split(/[/:]/)[0] ?? '').toLowerCase();
      const port = m ? Number(m[2]) : 0;
      const deny = (reason: string) => { record({ method, host, port, decision: 'deny', reason }); client.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'); };
      if (method !== 'CONNECT') return deny('only CONNECT is tunnelled');
      if (!m) return deny('target is not host:port');
      if (port !== allowPort) return deny(`only port ${allowPort}`);
      if (!allow.has(host)) return deny('host not on the allowlist');
      const upstream = connect({ host, port });
      sockets.add(upstream);
      upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
      client.on('close', () => upstream.destroy());
      upstream.once('connect', () => {
        record({ method, host, port, decision: 'allow' });
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) upstream.write(rest);
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
      upstream.on('error', () => { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'); upstream.destroy(); });
    };
    client.on('data', onData);
  });
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(o.port ?? 0, o.host, () => res()); });
  const port = (server.address() as { port: number }).port;
  return {
    port,
    proxyUrl: `http://host.docker.internal:${port}`,
    setTrial(id) { trial = id; },
    denials: (id) => decisions.filter((d) => d.trial === id && d.decision === 'deny'),
    stop: () => new Promise<void>((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); }),
  };
}
