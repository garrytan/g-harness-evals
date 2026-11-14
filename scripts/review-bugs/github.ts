// The GitHub client the review-bugs scripts share (the real-bug review eval, build step 1). Every call goes through the
// gh CLI, so the token never enters this process, a log or a file: gh api reads it from gh's own config.
//
// On Capy machines the gh token authenticates search (30 requests a minute) and GraphQL, but repository endpoints of
// repositories outside the organization's GitHub App installation answer as anonymous (60 requests an hour). So mining
// reads repository data from git clones and GH Archive, and uses REST only for search; GraphQL is used once per batch of
// units, for the first revision of each PR body (build-unit.ts), never in a loop over pages.
//
// Pacing: at most one request every 0.8 s, and one search request every 2.1 s (30 a minute). A 403 or 429 waits for
// Retry-After, else the rate-limit reset, else 30 s doubling, capped at 15 minutes and 6 tries, then throws. When a
// response says fewer than floor requests remain in its rate-limit window (default 300 for core and GraphQL, 3 for
// search), the next call waits for the reset, so the organization's shared quota keeps its headroom for the merge lane.
// Responses are cached on disk by request, so a resumed run asks GitHub only for what it has not seen.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GhResponse { status: number; headers: Record<string, string>; json: unknown }
/** Runs one request; injected in tests. */
export type GhTransport = (args: { method: 'GET' | 'POST'; path: string; body?: string }) => GhResponse;

export interface GhOptions {
  cacheDir: string;
  transport?: GhTransport;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
  minIntervalMs?: number;
  searchIntervalMs?: number;
  floor?: number;
}

export const MAX_TRIES = 6;
export const MAX_WAIT_MS = 15 * 60_000;

export class GhError extends Error {
  constructor(readonly status: number, readonly path: string) { super('E_GH_' + status + ' ' + path); }
}

/** Parses gh api -i output: a status line, headers, a blank line, the body. */
export function parseIncluded(text: string): GhResponse {
  const split = text.search(/\r?\n\r?\n/);
  const head = split < 0 ? text : text.slice(0, split);
  const body = split < 0 ? '' : text.slice(split).replace(/^\r?\n\r?\n/, '');
  const lines = head.split(/\r?\n/);
  const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(lines[0] ?? '')?.[1] ?? 0);
  const headers: Record<string, string> = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':');
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  let json: unknown = null;
  try { json = body.trim() ? JSON.parse(body) : null; } catch { json = null; }
  return { status, headers, json };
}

const ghCli: GhTransport = ({ method, path, body }) => {
  const args = ['api', '-i', '--method', method, path, ...(body ? ['--input', '-'] : [])];
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };
  for (const k of ['GH_CONFIG_DIR', 'XDG_CONFIG_HOME']) if (process.env[k]) env[k] = process.env[k]!;
  const r = spawnSync('gh', args, { input: body, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 });
  return parseIncluded(r.stdout ?? '');
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** How long to wait before retrying a 403 or 429, or null when the answer is not a rate limit. */
export function backoffMs(res: GhResponse, attempt: number, nowMs: number): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const ra = Number(res.headers['retry-after']);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_WAIT_MS);
  const reset = Number(res.headers['x-ratelimit-reset']);
  if (res.headers['x-ratelimit-remaining'] === '0' && Number.isFinite(reset)) return Math.min(Math.max(reset * 1000 - nowMs, 0) + 2_000, MAX_WAIT_MS);
  return Math.min(30_000 * 2 ** attempt, MAX_WAIT_MS);
}

export class Gh {
  private last = { core: 0, search: 0 };
  private holdUntil = { core: 0, search: 0, graphql: 0 };
  private readonly t: GhTransport;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  requests = 0;

  constructor(private readonly o: GhOptions) {
    mkdirSync(o.cacheDir, { recursive: true });
    this.t = o.transport ?? ghCli;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((l) => process.stderr.write(l + '\n'));
  }

  /** A cached GET of a REST path (search paths are paced as search). */
  get(path: string): Promise<unknown> { return this.call('GET', path); }

  /** A cached GraphQL query. */
  graphql(query: string): Promise<unknown> { return this.call('POST', 'graphql', JSON.stringify({ query })); }

  private async call(method: 'GET' | 'POST', path: string, body?: string): Promise<unknown> {
    const file = join(this.o.cacheDir, sha(method + ' ' + path + ' ' + (body ?? '')) + '.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    const kind = path === 'graphql' ? 'graphql' : path.startsWith('search/') ? 'search' : 'core';
    const pace = kind === 'search' ? 'search' : 'core';
    for (let attempt = 0; ; attempt++) {
      const interval = pace === 'search' ? this.o.searchIntervalMs ?? 2_100 : this.o.minIntervalMs ?? 800;
      const wait = Math.max(this.last[pace] + interval, this.holdUntil[kind]) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last[pace] = this.now();
      this.requests += 1;
      const res = this.t({ method, path, body });
      const remaining = Number(res.headers['x-ratelimit-remaining']);
      const reset = Number(res.headers['x-ratelimit-reset']);
      const floor = this.o.floor ?? (kind === 'search' ? 3 : 300);
      if (Number.isFinite(remaining) && Number.isFinite(reset) && remaining < floor) {
        this.holdUntil[kind] = reset * 1000 + 1_000;
        this.log('gh: ' + kind + ' quota at ' + remaining + ', holding until the reset');
      }
      const back = backoffMs(res, attempt, this.now());
      if (back !== null) {
        if (attempt + 1 >= MAX_TRIES) throw new GhError(res.status, path);
        this.log('gh: ' + res.status + ' on ' + kind + ', waiting ' + Math.round(back / 1000) + ' s (try ' + (attempt + 1) + ' of ' + MAX_TRIES + ')');
        await this.sleep(back);
        continue;
      }
      if (res.status >= 500 && attempt + 1 < MAX_TRIES) { await this.sleep(5_000 * 2 ** attempt); continue; }
      if (res.status < 200 || res.status >= 300) throw new GhError(res.status, path);
      const tmp = file + '.' + process.pid + '.tmp';
      writeFileSync(tmp, JSON.stringify(res.json));
      renameSync(tmp, file);
      return res.json;
    }
  }
}
