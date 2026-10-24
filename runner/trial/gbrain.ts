// The gbrain sidecar of one trial (docs/gbrain-arm.md): one container from harness-eval/gbrain:dev on its own
// docker network, its MCP port published on the host loopback only, a fresh brain for the trial's split, a
// bearer token minted into <trial dir>/gbrain/token. The harness never reaches it: the world's /gbrain tap does,
// with that token, and the harness gets the tap's URL and the world bot token. Everything docker-specific for
// the sidecar lives here, like runner/trial/docker.ts for the harness.
//
// internal-task (company brain): the sidecar may serve the company brain (HE_GBRAIN_BRAIN=company) and, under member scope
// (HE_GBRAIN_SCOPE=member), writes the brain's tokens.json beside the token; the runner reads it for the world's tap
// and checks it covers every actor of the task (HE-GBRAIN-004). The record also keeps the docker image id.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../errors.ts';
import type { CompanyTokens } from '../../gbrain/build-brain.ts';
import type { GbrainCellConfig } from '../contracts.ts';

export const DEFAULT_GBRAIN_IMAGE = 'harness-eval/gbrain:dev';
export const GBRAIN_PORT = 3131;

function sh(args: string[], timeoutMs?: number) {
  return spawnSync(args[0]!, args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
}

const uidGid = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;

export interface GbrainSidecarOptions {
  trialId: string;
  trialSlug: string;
  split: 'dev' | 'heldout';
  /** <trial dir>/gbrain: the token, the sidecar's logs; excluded from committed results. */
  outDir: string;
  image?: string;
  /** internal-task: the brain to serve and whether tokens.json is wanted; defaults bot-visible and none. */
  brain?: NonNullable<GbrainCellConfig['brain']>;
  scope?: 'none' | 'member';
  readyTimeoutMs?: number;
  log?: (line: string) => void;
}

export interface GbrainSidecar {
  /** How the world reaches the sidecar: http://127.0.0.1:<published port>. */
  url: string;
  token: string;
  tokenPath: string;
  image: string;
  /** internal-task: sha256 image id behind the tag, from docker image inspect. */
  image_id: string;
  brain: NonNullable<GbrainCellConfig['brain']>;
  scope: 'none' | 'member';
  /** internal-task: under member scope, the company brain's tokens.json as the entrypoint copied it; the file stays under outDir. */
  tokens: CompanyTokens | null;
  /** Milliseconds from docker run to a healthy /health and a token on disk. */
  ready_ms: number;
  /** SIGTERM, wait, collect docker logs into outDir, remove the container and its network. Idempotent. */
  stop(graceMs?: number): Promise<void>;
}

/** The image exists locally. */
export function gbrainImagePresent(image = DEFAULT_GBRAIN_IMAGE): boolean {
  return sh(['docker', 'image', 'inspect', image]).status === 0;
}

export async function waitHealthy(url: string, timeoutMs: number, exited: () => string | null): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not listening yet */ }
    const gone = exited();
    if (gone) throw new Error(gone);
    await Bun.sleep(200);
  }
  throw new Error(`no healthy /health at ${url} after ${Math.round(timeoutMs / 1000)} s`);
}

/** internal-task: tokens.json is well formed, for this split, and names a token for every member given (HE-GBRAIN-004). */
export function checkCompanyTokens(value: unknown, split: 'dev' | 'heldout', members: string[], path: string): CompanyTokens {
  const t = value as Partial<CompanyTokens> | null;
  const bad = (what: string) => new RunnerError('HE-GBRAIN-004', `${path}: ${what}; fix: rebuild the company brain image (gbrain/README.md, "The company brain") so tokens.json carries one granted token per member of the split plus public-only`);
  if (!t || typeof t !== 'object') throw bad('not a JSON object');
  if (t.schema_version !== 1 || t.brain !== 'company') throw bad(`expected schema_version 1 and brain "company", got ${JSON.stringify({ schema_version: t.schema_version, brain: t.brain })}`);
  if (t.split !== split) throw bad(`tokens are for split ${String(t.split)}, the trial runs ${split}`);
  if (typeof t.public_only !== 'string' || !t.public_only) throw bad('no public_only token');
  if (!t.members || typeof t.members !== 'object') throw bad('no members map');
  const missing = members.filter((m) => typeof t.members![m] !== 'string' || !t.members![m]);
  if (missing.length) throw bad(`no token for member(s) ${missing.join(', ')}`);
  return t as CompanyTokens;
}

export async function startGbrainSidecar(o: GbrainSidecarOptions): Promise<GbrainSidecar> {
  const image = o.image ?? DEFAULT_GBRAIN_IMAGE;
  const brain = o.brain ?? 'bot-visible';
  const scope = o.scope ?? 'none';
  const log = o.log ?? (() => undefined);
  const name = `he-gbrain-${o.trialSlug}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const network = `${name}-net`;
  const out = resolve(o.outDir);
  mkdirSync(out, { recursive: true });
  const tokenPath = join(out, 'token');
  const tokensPath = join(out, 'tokens.json');
  if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present; fix: docker build -f gbrain/Dockerfile -t ${image} . (gbrain/README.md)`);
  sh(['docker', 'rm', '-f', name]);
  sh(['docker', 'network', 'rm', network]);
  const net = sh(['docker', 'network', 'create', '--driver', 'bridge', network]);
  if (net.status !== 0) throw new RunnerError('HE-GBRAIN-002', `docker network create ${network} failed: ${(net.stderr || net.stdout).trim().slice(0, 300)}`);
  const started = Date.now();
  const run = sh(['docker', 'run', '-d', '--name', name, '--user', uidGid(), '--network', network,
    '-p', `127.0.0.1:0:${GBRAIN_PORT}`, '-v', `${out}:/he-gbrain`,
    '-e', `HE_GBRAIN_SPLIT=${o.split}`, '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', `HE_TRIAL_ID=${o.trialId}`,
    '-e', `HE_GBRAIN_BRAIN=${brain}`, '-e', `HE_GBRAIN_SCOPE=${scope}`,
    image]);
  const image_id = sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', image]).stdout.trim();
  if (run.status !== 0) {
    sh(['docker', 'network', 'rm', network]);
    throw new RunnerError('HE-GBRAIN-002', `docker run failed for ${image}: ${(run.stderr || run.stdout).trim().slice(0, 400)}; fix: build the image (gbrain/README.md) and check the docker daemon`);
  }
  const exited = (): string | null => {
    const r = sh(['docker', 'inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]);
    if (r.status !== 0) return `container ${name} vanished`;
    const [status, code] = r.stdout.trim().split(' ');
    return status === 'running' || status === 'created' ? null : `the sidecar exited ${code} before it was ready`;
  };
  let stopped: Promise<void> | null = null;
  const stop = (graceMs = 10_000) => {
    stopped ??= (async () => {
      sh(['docker', 'stop', '-t', String(Math.ceil(graceMs / 1000)), name], graceMs + 30_000);
      const logs = sh(['docker', 'logs', name]);
      writeFileSync(join(out, 'docker.log'), `${logs.stdout}\n${logs.stderr}`);
      sh(['docker', 'rm', '-f', name]);
      sh(['docker', 'network', 'rm', network]);
    })();
    return stopped;
  };
  try {
    const port = sh(['docker', 'port', name, `${GBRAIN_PORT}/tcp`]).stdout.trim().split('\n')[0]?.split(':').pop();
    if (!port) throw new Error('docker port reported no published port');
    const url = `http://127.0.0.1:${port}`;
    const timeout = o.readyTimeoutMs ?? 60_000;
    await waitHealthy(url, timeout, exited);
    const deadline = started + timeout;
    while (!existsSync(tokenPath) || !readFileSync(tokenPath, 'utf8').trim()) {
      if (Date.now() > deadline) throw new Error(`no token at ${tokenPath} after ${Math.round(timeout / 1000)} s`);
      const gone = exited();
      if (gone) throw new Error(gone);
      await Bun.sleep(100);
    }
    const token = readFileSync(tokenPath, 'utf8').trim();
    let tokens: CompanyTokens | null = null;
    if (scope === 'member') {
      while (!existsSync(tokensPath) || !readFileSync(tokensPath, 'utf8').trim()) {
        if (Date.now() > deadline) throw new Error(`no tokens.json at ${tokensPath} after ${Math.round(timeout / 1000)} s`);
        const gone = exited();
        if (gone) throw new Error(gone);
        await Bun.sleep(100);
      }
      tokens = JSON.parse(readFileSync(tokensPath, 'utf8')) as CompanyTokens;
    }
    const ready_ms = Date.now() - started;
    log(`gbrain sidecar ${name} (${o.split}, ${image}, brain ${brain}, scope ${scope}) healthy at ${url} after ${ready_ms} ms; token in ${tokenPath}${tokens ? `, ${Object.keys(tokens.members ?? {}).length} member tokens in ${tokensPath}` : ''}`);
    return { url, token, tokenPath, image, image_id, brain, scope, tokens, ready_ms, stop };
  } catch (e) {
    await stop(5_000);
    const tail = existsSync(join(out, 'docker.log')) ? readFileSync(join(out, 'docker.log'), 'utf8').trim().split('\n').slice(-3).join(' | ') : '';
    throw new RunnerError('HE-GBRAIN-002', `the gbrain sidecar did not become ready: ${(e as Error).message}${tail ? ` (${tail})` : ''}; fix: read ${join(out, 'sidecar.log')} and ${join(out, 'docker.log')}, rebuild the image (gbrain/README.md)`);
  }
}

/** Preflight: the image exists and a container from it serves /health. Starts and stops one sidecar. */
export async function probeGbrainImage(image: string, scratchDir: string): Promise<{ ready_ms: number; version: string | null }> {
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-${process.pid}`, split: 'dev', outDir: scratchDir, image });
  try {
    const health = await fetch(`${sidecar.url}/health`).then((r) => r.json() as Promise<{ version?: string }>).catch(() => ({} as { version?: string }));
    return { ready_ms: sidecar.ready_ms, version: health.version ?? null };
  } finally {
    await sidecar.stop(5_000);
  }
}

/** One tools/call against the sidecar directly, under the token given; the parsed JSON of the first text content. */
export async function callGbrain(url: string, token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('text/event-stream') ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('') : text;
  const msg = JSON.parse(data) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } };
  if (msg.error) throw new Error(`gbrain ${name}: ${msg.error.message ?? 'rpc error'}`);
  const first = msg.result?.content?.[0]?.text;
  return first ? JSON.parse(first) : null;
}

/** internal-task preflight: the company brain of a split, served from the image under the unscoped token, lists every page
 *  the build should hold (gbrain/build-brain.ts companyPageList), so a scoped arm's leak counts measure grants and
 *  not a thin brain; under member scope, one member token lists nothing outside that member's reader sets and the
 *  public-only token lists only pages every member may read. Pages through list_pages (remote max 100 rows). */
export async function probeCompanyBrain(image: string, split: 'dev' | 'heldout', expected: Array<{ page_slug: string; kind: string; readers: string[] }>, scratchDir: string, scope: 'none' | 'member' = 'member'): Promise<{ ready_ms: number; image_id: string; listed: number; by_kind: Record<string, number>; member_tokens: number; member_check: string }> {
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-company-${split}-${process.pid}`, split, outDir: scratchDir, image, brain: 'company', scope });
  const listAll = async (token: string): Promise<Set<string>> => {
    const listed = new Set<string>();
    for (let offset = 0; ; offset += 100) {
      const rows = await callGbrain(sidecar.url, token, 'list_pages', { limit: 100, offset, sort: 'slug' }) as Array<{ slug?: string }> | null;
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) if (typeof r.slug === 'string') listed.add(r.slug);
      if (rows.length < 100) break;
    }
    return listed;
  };
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', `the company brain for ${split} in ${image} ${what}; fix: rebuild the image (gbrain/README.md, "The company brain")`);
  try {
    const listed = await listAll(sidecar.token);
    const missing = expected.filter((p) => !listed.has(p.page_slug));
    if (missing.length) throw fail(`lists ${listed.size} pages but ${missing.length} expected page(s) are missing (${missing.slice(0, 5).map((p) => p.page_slug).join(', ')}${missing.length > 5 ? ', ...' : ''})`);
    const by_kind: Record<string, number> = {};
    for (const p of expected) by_kind[p.kind] = (by_kind[p.kind] ?? 0) + 1;
    let member_check = 'not checked';
    if (sidecar.tokens) {
      const allMembers = new Set(Object.keys(sidecar.tokens.members));
      const [member, token] = Object.entries(sidecar.tokens.members).sort(([a], [b]) => a.localeCompare(b))[0]!;
      const mine = await listAll(token);
      const allowed = new Set(expected.filter((p) => p.readers.includes(member)).map((p) => p.page_slug));
      const outside = [...mine].filter((s) => !allowed.has(s));
      if (outside.length) throw fail(`lists ${outside.length} page(s) outside ${member}'s reader sets under that member's token (${outside.slice(0, 3).join(', ')})`);
      const pub = await listAll(sidecar.tokens.public_only);
      const everyone = new Set(expected.filter((p) => [...allMembers].every((m) => p.readers.includes(m))).map((p) => p.page_slug));
      const pubOutside = [...pub].filter((s) => !everyone.has(s));
      if (pubOutside.length) throw fail(`lists ${pubOutside.length} page(s) not readable by every member under the public-only token (${pubOutside.slice(0, 3).join(', ')})`);
      member_check = `${member} lists ${mine.size} of its ${allowed.size} readable pages and nothing else, public-only lists ${pub.size} of ${everyone.size}`;
    }
    return { ready_ms: sidecar.ready_ms, image_id: sidecar.image_id, listed: listed.size, by_kind, member_tokens: Object.keys(sidecar.tokens?.members ?? {}).length, member_check };
  } finally {
    await sidecar.stop(5_000);
  }
}
