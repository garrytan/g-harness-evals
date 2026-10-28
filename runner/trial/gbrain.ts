// The gbrain sidecar of one trial (docs/gbrain-arm.md): one container from harness-eval/gbrain:dev on its own
// docker network, its MCP port published on the host loopback only, a fresh brain for the trial's split, a
// bearer token minted into <trial dir>/gbrain/token. The harness never reaches it: the world's /gbrain tap does,
// with that token, and the harness gets the tap's URL and the world bot token. Everything docker-specific for
// the sidecar lives here, like runner/trial/docker.ts for the harness.
//
// internal-task (company brain): the sidecar may serve the company brain (HE_GBRAIN_BRAIN=company) and, under member scope
// (HE_GBRAIN_SCOPE=member), writes the brain's tokens.json beside the token; the runner reads it for the world's tap
// and checks it covers every actor of the task (HE-GBRAIN-004). The record also keeps the docker image id.
//
// internal-task (gbrain#7481, scope "sources"): under HE_GBRAIN_SCOPE=sources the entrypoint copies the company brain's manifest.json
// (no tokens; its grants map each member to the source ids that member may read) beside the token; the runner hands the
// grants to the world's tap, which adds source_ids to every search and query under the trial's one unscoped token
// (world/services/gbrain-tap.ts), and checks the grants cover every actor of the task (HE-GBRAIN-004).
//
// internal-task (the install ladder): the sidecar takes the surface (HE_GBRAIN_SURFACE) and, for an embedded brain, the model
// (HE_GBRAIN_EMBEDDINGS) and the metering proxy's slot URL as OPENAI_BASE_URL with the host-gateway route, so its query
// embeddings are metered under the trial key; no key is passed. The docker calls are asynchronous subprocesses so one
// trial's slow container start cannot stall another trial's world under run --parallel. exportInstallView exports and
// verifies one view of the image's install bundle (HE-GBRAIN-006).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../errors.ts';
import type { BrainIngest, CompanyBrainManifest, CompanyTokens, IngestTokens } from '../../gbrain/build-brain.ts';
import { verifyFiles, type InstallFile, type InstallerRecord } from '../../gbrain/build-install.ts';
import type { GbrainCellConfig } from '../contracts.ts';

export const DEFAULT_GBRAIN_IMAGE = 'harness-eval/gbrain:dev';
export const GBRAIN_PORT = 3131;

/** A docker call as a child process the event loop keeps running beside: other trials' worlds answer while it runs. */
async function sh(args: string[], timeoutMs = 120_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { status, stdout, stderr };
  } finally { clearTimeout(timer); }
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
  scope?: 'none' | 'member' | 'sources';
  /** internal-task: live ingestion (member brain only): the entrypoint copies ingest-tokens.json beside the token. */
  ingest?: 'off' | 'live';
  /** internal-task: the surface (default starter) and the embedding model (default off); an embedded brain needs openaiBaseUrl, the
   *  metering proxy's slot URL as the container reaches it (a route, never a key), and proxyToken, the random per-trial token
   *  the proxy requires on that slot (2026-10-28; the entrypoint hands it to gbrain as its OpenAI credential, which the proxy
   *  strips before it injects the real key). */
  surface?: GbrainCellConfig['surface'];
  embeddings?: NonNullable<GbrainCellConfig['embeddings']>;
  openaiBaseUrl?: string;
  proxyToken?: string;
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
  scope: 'none' | 'member' | 'sources';
  /** internal-task: the surface and embedding model the sidecar was started with. */
  surface: GbrainCellConfig['surface'];
  embeddings: NonNullable<GbrainCellConfig['embeddings']>;
  /** internal-task: under member scope, the company brain's tokens.json as the entrypoint copied it; the file stays under outDir. */
  tokens: CompanyTokens | null;
  /** internal-task (gbrain#7481): under scope "sources", the company brain's grants from its manifest.json (member -> readable source ids)
   *  and the source ids every member of the split may read; the tap adds them as source_ids. No token is involved. */
  grants: { members: Record<string, string[]>; public: string[] } | null;
  /** internal-task: under live ingestion, the member brain's per-source ingest tokens and the manifest's channel-to-source map, for the
   *  world's ingestion module. The tokens file stays under outDir. */
  ingest: { tokens: IngestTokens; map: BrainIngest } | null;
  /** Milliseconds from docker run to a healthy /health and a token on disk. */
  ready_ms: number;
  /** SIGTERM, wait, collect docker logs into outDir, remove the container and its network. Idempotent. */
  stop(graceMs?: number): Promise<void>;
}

/** The image exists locally (synchronous: a one-off check before anything runs). */
export function gbrainImagePresent(image = DEFAULT_GBRAIN_IMAGE): boolean {
  return spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
}

/** The gbrain commit the image was built from, as /opt/sidecar/image.json records it (gbrain/Dockerfile writes it at build); null
 *  when the image carries no such file or no commit. */
export function gbrainImageCommit(image = DEFAULT_GBRAIN_IMAGE, run: (argv: string[]) => { status: number | null; stdout: string } = (argv) => spawnSync('docker', argv, { encoding: 'utf8' })): string | null {
  const r = run(['run', '--rm', '--entrypoint', 'cat', image, '/opt/sidecar/image.json']);
  if (r.status !== 0) return null;
  try { return (JSON.parse(r.stdout) as { gbrain_commit?: string }).gbrain_commit ?? null; } catch { return null; }
}

/** preflight's installer-hook gate: when gbrain/pin.json's install.installer.turn_hook_expected is true, an installer view whose
 *  record carries no turn_hook (a block-only image) is refused before any trial, with the HE-GBRAIN-006 message body; else null.
 *  The gate is the pin's: a candidate commit named by --gbrain-commit (scripts/gbrain-check.ts) is not held to it, since the check
 *  asserts the hook itself under --expect-hook. */
export function installerHookProblem(view: Pick<InstallViewManifest, 'harness' | 'install' | 'installer'>, pin: { install?: { installer?: { turn_hook_expected?: boolean } } }, candidate?: string): string | null {
  if (candidate || view.install !== 'gbrain-installer' || !pin.install?.installer?.turn_hook_expected) return null;
  if (view.installer && 'turn_hook' in view.installer && view.installer.turn_hook) return null;
  return `the ${view.harness} installer view carries no per-turn hook (installer.turn_hook) and gbrain/pin.json says the pinned installer writes one; the image is block-only or built at another commit; fix: rebuild it at the pinned commit, or clear install.installer.turn_hook_expected for a block-only pin`;
}

/** preflight's image-commit gate: the HE-GBRAIN-002 message body when the image's recorded gbrain commit is not the expected one
 *  (the pin, or the commit --gbrain-commit names), else null. */
export function imageCommitProblem(o: { image: string; built: string | null; pin: string; flag?: string }): string | null {
  const expected = o.flag ?? o.pin;
  if (o.built === expected) return null;
  return `image ${o.image} records gbrain ${o.built ?? 'no commit (no /opt/sidecar/image.json)'}, ${o.flag ? '--gbrain-commit names' : 'gbrain/pin.json pins'} ${expected}; fix: scripts/build-gbrain-image.sh --gbrain ${expected} --tag ${o.image}, or --gbrain-image <the image built at that commit>`;
}

export async function waitHealthy(url: string, timeoutMs: number, exited: () => string | null | Promise<string | null>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not listening yet */ }
    const gone = await exited();
    if (gone) throw new Error(gone);
    await Bun.sleep(200);
  }
  throw new Error(`no healthy /health at ${url} after ${Math.round(timeoutMs / 1000)} s`);
}

/** internal-task: tokens.json is well formed, for this split, and names a token for every member given (HE-GBRAIN-004). */
export function checkCompanyTokens(value: unknown, split: 'dev' | 'heldout', members: string[], path: string): CompanyTokens {
  const t = value as Partial<CompanyTokens> | null;
  const bad = (what: string) => new RunnerError('HE-GBRAIN-004', `${path}: ${what}; fix: rebuild the company or member brain image (gbrain/README.md, "The company brain") so tokens.json carries one granted token per member of the split plus public-only`);
  if (!t || typeof t !== 'object') throw bad('not a JSON object');
  if (t.schema_version !== 1 || (t.brain !== 'company' && t.brain !== 'member')) throw bad(`expected schema_version 1 and brain "company" or "member", got ${JSON.stringify({ schema_version: t.schema_version, brain: t.brain })}`);
  if (t.split !== split) throw bad(`tokens are for split ${String(t.split)}, the trial runs ${split}`);
  if (typeof t.public_only !== 'string' || !t.public_only) throw bad('no public_only token');
  if (!t.members || typeof t.members !== 'object') throw bad('no members map');
  const missing = members.filter((m) => typeof t.members![m] !== 'string' || !t.members![m]);
  if (missing.length) throw bad(`no token for member(s) ${missing.join(', ')}`);
  return t as CompanyTokens;
}

/** internal-task (gbrain#7481): the company brain's manifest.json carries a grant for every member given, and the grants map to
 *  the tap's shape: each member's sources, and the sources every member of the split may read (HE-GBRAIN-004). */
export function checkCompanyGrants(value: unknown, split: 'dev' | 'heldout', members: string[], path: string): { members: Record<string, string[]>; public: string[] } {
  const m = value as Partial<CompanyBrainManifest> | null;
  const bad = (what: string) => new RunnerError('HE-GBRAIN-004', `${path}: ${what}; fix: rebuild the company brain image (gbrain/README.md, "The company brain") so manifest.json carries one source grant per member of the split`);
  if (!m || typeof m !== 'object') throw bad('not a JSON object');
  if (!((m.schema_version === 2 && m.brain === 'company') || (m.schema_version === 3 && m.brain === 'member'))) throw bad(`expected schema_version 2 and brain "company" or schema_version 3 and brain "member", got ${JSON.stringify({ schema_version: m.schema_version, brain: m.brain })}`);
  if (m.split !== split) throw bad(`the manifest is for split ${String(m.split)}, the trial runs ${split}`);
  if (!Array.isArray(m.grants) || !Array.isArray(m.sources)) throw bad('no grants or sources list');
  const byMember: Record<string, string[]> = {};
  for (const g of m.grants) if (g && typeof g.member === 'string' && g.member !== 'public-only' && Array.isArray(g.sources)) byMember[g.member] = g.sources.filter((s): s is string => typeof s === 'string');
  const missing = members.filter((id) => !byMember[id]?.length);
  if (missing.length) throw bad(`no source grant for member(s) ${missing.join(', ')}`);
  const everyone = Object.keys(byMember);
  const pub = m.sources.filter((s) => everyone.every((id) => s.readers.includes(id))).map((s) => s.id);
  if (!pub.length) throw bad('no source every member may read');
  return { members: byMember, public: pub };
}

/** internal-task: ingest-tokens.json is well formed, for this split, and names a token for every source the manifest's channel map and
 *  the private-<member> rule can send a message to (HE-GBRAIN-004); the manifest (schema 3) carries that map. */
export function checkIngestTokens(tokensValue: unknown, manifestValue: unknown, split: 'dev' | 'heldout', members: string[], path: string): { tokens: IngestTokens; map: BrainIngest } {
  const bad = (what: string) => new RunnerError('HE-GBRAIN-004', `${path}: ${what}; fix: rebuild the member brain image (gbrain/README.md, "The member brain") so ingest-tokens.json carries one token per source and manifest.json the channel map`);
  const t = tokensValue as Partial<IngestTokens> | null;
  if (!t || typeof t !== 'object') throw bad('not a JSON object');
  if (t.schema_version !== 1 || t.brain !== 'member') throw bad(`expected schema_version 1 and brain "member", got ${JSON.stringify({ schema_version: t.schema_version, brain: t.brain })}`);
  if (t.split !== split) throw bad(`ingest tokens are for split ${String(t.split)}, the trial runs ${split}`);
  if (!t.sources || typeof t.sources !== 'object') throw bad('no sources map');
  const m = manifestValue as Partial<CompanyBrainManifest> | null;
  if (!m || typeof m !== 'object' || m.schema_version !== 3 || m.brain !== 'member' || !m.ingest || typeof m.ingest.channels !== 'object') throw bad('the manifest beside it is not a member brain manifest (schema_version 3 with ingest.channels)');
  // Every source of the brain (the build mints one ingest token per source), plus what the channel map and the actors' private
  // sources name, so a token a build dropped is refused here and a missing token at write time means, by construction, a
  // conversation the brain has no source for.
  const needed = new Set<string>([...(Array.isArray(m.sources) ? m.sources.map((s) => s.id) : []), ...Object.values(m.ingest.channels), ...members.map((id) => `${m.ingest!.dm_source_prefix}${id}`)]);
  const missing = [...needed].filter((s) => typeof t.sources![s] !== 'string' || !t.sources![s]);
  if (missing.length) throw bad(`no ingest token for source(s) ${missing.join(', ')}`);
  return { tokens: t as IngestTokens, map: m.ingest };
}

export async function startGbrainSidecar(o: GbrainSidecarOptions): Promise<GbrainSidecar> {
  const image = o.image ?? DEFAULT_GBRAIN_IMAGE;
  const brain = o.brain ?? 'bot-visible';
  const scope = o.scope ?? 'none';
  const ingest = o.ingest ?? 'off';
  const surface = o.surface ?? 'starter';
  const embeddings = o.embeddings ?? 'off';
  if (embeddings !== 'off' && !o.openaiBaseUrl) throw new RunnerError('HE-GBRAIN-002', `an embedded brain (${embeddings}) needs the metering proxy's slot URL as OPENAI_BASE_URL; the runner passes none without a proxy`);
  if (embeddings !== 'off' && !o.proxyToken) throw new RunnerError('HE-GBRAIN-002', `an embedded brain (${embeddings}) needs the proxy slot's per-trial token as HE_GBRAIN_PROXY_TOKEN; the proxy forwards nothing for the slot without it`);
  const log = o.log ?? (() => undefined);
  const name = `he-gbrain-${o.trialSlug}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const network = `${name}-net`;
  const out = resolve(o.outDir);
  mkdirSync(out, { recursive: true });
  const tokenPath = join(out, 'token');
  const tokensPath = join(out, 'tokens.json');
  if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present; fix: docker build -f gbrain/Dockerfile -t ${image} . (gbrain/README.md)`);
  await sh(['docker', 'rm', '-f', name]);
  await sh(['docker', 'network', 'rm', network]);
  const net = await sh(['docker', 'network', 'create', '--driver', 'bridge', network]);
  if (net.status !== 0) throw new RunnerError('HE-GBRAIN-002', `docker network create ${network} failed: ${(net.stderr || net.stdout).trim().slice(0, 300)}`);
  const started = Date.now();
  // host.docker.internal is the route to the metering proxy for an embedded brain; the entrypoint logs the URL, never a key.
  const run = await sh(['docker', 'run', '-d', '--name', name, '--user', uidGid(), '--network', network, '--add-host', 'host.docker.internal:host-gateway',
    '-p', `127.0.0.1:0:${GBRAIN_PORT}`, '-v', `${out}:/he-gbrain`,
    '-e', `HE_GBRAIN_SPLIT=${o.split}`, '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', `HE_TRIAL_ID=${o.trialId}`,
    '-e', `HE_GBRAIN_BRAIN=${brain}`, '-e', `HE_GBRAIN_SCOPE=${scope}`, '-e', `HE_GBRAIN_INGEST=${ingest}`,
    '-e', `HE_GBRAIN_SURFACE=${surface}`, '-e', `HE_GBRAIN_EMBEDDINGS=${embeddings}`,
    ...(embeddings !== 'off' ? ['-e', `OPENAI_BASE_URL=${o.openaiBaseUrl}`, '-e', `HE_GBRAIN_PROXY_TOKEN=${o.proxyToken}`] : []),
    image]);
  const image_id = (await sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', image])).stdout.trim();
  if (run.status !== 0) {
    await sh(['docker', 'network', 'rm', network]);
    throw new RunnerError('HE-GBRAIN-002', `docker run failed for ${image}: ${(run.stderr || run.stdout).trim().slice(0, 400)}; fix: build the image (gbrain/README.md) and check the docker daemon`);
  }
  const exited = async (): Promise<string | null> => {
    const r = await sh(['docker', 'inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]);
    if (r.status !== 0) return `container ${name} vanished`;
    const [status, code] = r.stdout.trim().split(' ');
    return status === 'running' || status === 'created' ? null : `the sidecar exited ${code} before it was ready`;
  };
  let stopped: Promise<void> | null = null;
  const stop = (graceMs = 10_000) => {
    stopped ??= (async () => {
      await sh(['docker', 'stop', '-t', String(Math.ceil(graceMs / 1000)), name], graceMs + 30_000);
      const logs = await sh(['docker', 'logs', name]);
      writeFileSync(join(out, 'docker.log'), `${logs.stdout}\n${logs.stderr}`);
      await sh(['docker', 'rm', '-f', name]);
      await sh(['docker', 'network', 'rm', network]);
    })();
    return stopped;
  };
  try {
    const port = (await sh(['docker', 'port', name, `${GBRAIN_PORT}/tcp`])).stdout.trim().split('\n')[0]?.split(':').pop();
    if (!port) throw new Error('docker port reported no published port');
    const url = `http://127.0.0.1:${port}`;
    const timeout = o.readyTimeoutMs ?? 60_000;
    await waitHealthy(url, timeout, exited);
    const deadline = started + timeout;
    while (!existsSync(tokenPath) || !readFileSync(tokenPath, 'utf8').trim()) {
      if (Date.now() > deadline) throw new Error(`no token at ${tokenPath} after ${Math.round(timeout / 1000)} s`);
      const gone = await exited();
      if (gone) throw new Error(gone);
      await Bun.sleep(100);
    }
    const token = readFileSync(tokenPath, 'utf8').trim();
    let tokens: CompanyTokens | null = null;
    let grants: GbrainSidecar['grants'] = null;
    let ingestTokens: GbrainSidecar['ingest'] = null;
    if (ingest === 'live') {
      const ingestPath = join(out, 'ingest-tokens.json');
      while (!existsSync(ingestPath) || !readFileSync(ingestPath, 'utf8').trim()) {
        if (Date.now() > deadline) throw new Error(`no ingest-tokens.json at ${ingestPath} after ${Math.round(timeout / 1000)} s`);
        const gone = await exited(); if (gone) throw new Error(gone);
        await Bun.sleep(100);
      }
      ingestTokens = checkIngestTokens(JSON.parse(readFileSync(ingestPath, 'utf8')), JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), o.split, [], ingestPath);
    }
    if (scope === 'sources') {
      const manifestPath = join(out, 'manifest.json');
      while (!existsSync(manifestPath) || !readFileSync(manifestPath, 'utf8').trim()) {
        if (Date.now() > deadline) throw new Error(`no manifest.json at ${manifestPath} after ${Math.round(timeout / 1000)} s`);
        const gone = await exited(); if (gone) throw new Error(gone);
        await Bun.sleep(200);
      }
      grants = checkCompanyGrants(JSON.parse(readFileSync(manifestPath, 'utf8')), o.split, [], manifestPath);
    }
    if (scope === 'member') {
      while (!existsSync(tokensPath) || !readFileSync(tokensPath, 'utf8').trim()) {
        if (Date.now() > deadline) throw new Error(`no tokens.json at ${tokensPath} after ${Math.round(timeout / 1000)} s`);
        const gone = await exited();
        if (gone) throw new Error(gone);
        await Bun.sleep(100);
      }
      tokens = JSON.parse(readFileSync(tokensPath, 'utf8')) as CompanyTokens;
    }
    const ready_ms = Date.now() - started;
    log(`gbrain sidecar ${name} (${o.split}, ${image}, brain ${brain}, scope ${scope}, ingest ${ingest}, surface ${surface}, embeddings ${embeddings}) healthy at ${url} after ${ready_ms} ms; token in ${tokenPath}${tokens ? `, ${Object.keys(tokens.members ?? {}).length} member tokens in ${tokensPath}` : ''}${ingestTokens ? `, ${Object.keys(ingestTokens.tokens.sources).length} ingest tokens` : ''}`);
    return { url, token, tokenPath, image, image_id, brain, scope, surface, embeddings, tokens, grants, ingest: ingestTokens, ready_ms, stop };
  } catch (e) {
    await stop(5_000);
    const tail = existsSync(join(out, 'docker.log')) ? readFileSync(join(out, 'docker.log'), 'utf8').trim().split('\n').slice(-3).join(' | ') : '';
    throw new RunnerError('HE-GBRAIN-002', `the gbrain sidecar did not become ready: ${(e as Error).message}${tail ? ` (${tail})` : ''}; fix: read ${join(out, 'sidecar.log')} and ${join(out, 'docker.log')}, rebuild the image (gbrain/README.md)`);
  }
}

/** Preflight: the image exists and a container from it serves /health and lists its tools on the given surface (internal-task: the
 *  count is compared with gbrain/pin.json by the caller). Starts and stops one sidecar; with an embedding model, the sidecar
 *  serves the embedded brain and a search goes through it so the caller can look for the embedding usage line. */
export async function probeGbrainImage(image: string, scratchDir: string, o: { surface?: GbrainCellConfig['surface']; embeddings?: NonNullable<GbrainCellConfig['embeddings']>; openaiBaseUrl?: string; proxyToken?: string; split?: 'dev' | 'heldout'; searchQuery?: string } = {}): Promise<{ ready_ms: number; version: string | null; tools: string[]; image_id: string; search_slugs: string[] | null; search_degraded: string | null }> {
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-${process.pid}-${o.surface ?? 'starter'}-${o.embeddings ?? 'off'}`, split: o.split ?? 'dev', outDir: scratchDir, image, surface: o.surface, embeddings: o.embeddings, openaiBaseUrl: o.openaiBaseUrl, proxyToken: o.proxyToken });
  try {
    const health = await fetch(`${sidecar.url}/health`).then((r) => r.json() as Promise<{ version?: string }>).catch(() => ({} as { version?: string }));
    const tools = await listGbrainTools(sidecar.url, sidecar.token);
    let search_slugs: string[] | null = null;
    let search_degraded: string | null = null;
    if (o.searchQuery) {
      const tool = sidecar.surface === 'verbs' ? 'recall' : 'search';
      const payload = await callGbrain(sidecar.url, sidecar.token, tool, { query: o.searchQuery, limit: 3 }) as unknown;
      const rows = Array.isArray(payload) ? payload : (payload as { results?: unknown[] } | null)?.results ?? [];
      search_slugs = (rows as Array<{ slug?: string }>).map((r) => r.slug).filter((s): s is string => typeof s === 'string');
      search_degraded = degradedStamp(payload);
    }
    return { ready_ms: sidecar.ready_ms, version: health.version ?? null, tools, image_id: sidecar.image_id, search_slugs, search_degraded };
  } finally {
    await sidecar.stop(5_000);
  }
}

/** internal-task (gbrain#7481) preflight and keyless check for scope "sources": the company brain of a split, served under the one
 *  unscoped token, is searched and queried once per member and query with source_ids set to that member's grant exactly as the
 *  tap sets it (scopeRequest), and every returned row's source_id must lie inside the grant; one call per member names a
 *  source outside the grant and must come back permission_denied. Rows are counted so an all-empty check cannot pass vacuously. */
export const SOURCE_PROBE_QUERIES = ['incident', 'rate', 'door', 'budget', 'meeting', 'contract', 'ticket', 'update'] as const;

export async function probeSourceGrants(image: string, split: 'dev' | 'heldout', scratchDir: string, queries: readonly string[] = SOURCE_PROBE_QUERIES): Promise<{
  ready_ms: number; image_id: string; members: number; calls: number; rows: number; sources_seen: number;
  /** Every row outside the requester's grant: member, tool, query, slug and source. Empty is the pass. */
  outside: Array<{ member: string; tool: string; query: string; slug: string; source_id: string }>;
  /** Per member: a source id no connection holds, named beside the grant, and gbrain's reply code (permission_denied is the pass). */
  denied: Array<{ member: string; source_id: string; code: string | null }>;
  /** Per member: a federated source outside the member's grant named beside it under the unscoped token, and whether rows from it
   *  came back. gbrain checks source_ids against the connection's grant, not the member's, so under the one unscoped token this is
   *  expected to be true: the member narrowing is the tap's to enforce (it intersects a harness-supplied list with the grant). */
  foreign: Array<{ member: string; source_id: string; rows_from_it: boolean | null }>;
  /** The same query for two members with different grants answered different source sets, so the narrowing is observable. */
  differs: boolean;
}> {
  const { scopeRequest } = await import('../../world/services/gbrain-tap.ts');
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-sources-${split}-${process.pid}`, split, outDir: scratchDir, image, brain: 'company', scope: 'sources' });
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', `the company brain for ${split} in ${image} ${what}; fix: rebuild the image (gbrain/README.md, "The company brain")`);
  try {
    if (!sidecar.grants) throw fail('started under scope "sources" without grants');
    const allSources = new Set(Object.values(sidecar.grants.members).flat());
    const outside: Array<{ member: string; tool: string; query: string; slug: string; source_id: string }> = [];
    const denied: Array<{ member: string; source_id: string; code: string | null }> = [];
    const foreign: Array<{ member: string; source_id: string; rows_from_it: boolean | null }> = [];
    const perQuery = new Map<string, Set<string>>();
    let calls = 0, rows = 0;
    const seen = new Set<string>();
    for (const [member, grant] of Object.entries(sidecar.grants.members).sort(([a], [b]) => a.localeCompare(b))) {
      for (const query of queries) for (const tool of ['search', 'query'] as const) {
        const { request } = scopeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { query, limit: 50 } } }, grant);
        const payload = await callGbrain(sidecar.url, sidecar.token, tool, request.params!.arguments as Record<string, unknown>);
        calls++;
        if (!Array.isArray(payload)) throw fail(`answered ${tool} ${JSON.stringify(query)} for ${member} with ${JSON.stringify(payload).slice(0, 200)} instead of rows`);
        for (const r of payload as Array<{ slug?: string; source_id?: string }>) {
          rows++;
          const source_id = typeof r.source_id === 'string' ? r.source_id : '';
          seen.add(source_id);
          if (!grant.includes(source_id)) outside.push({ member, tool, query, slug: r.slug ?? '?', source_id });
          if (tool === 'search') { const k = `${query}|${member}`; perQuery.set(k, (perQuery.get(k) ?? new Set()).add(source_id)); }
        }
      }
      const unknown = 'he-no-such-source';
      const reply = await callGbrain(sidecar.url, sidecar.token, 'search', { query: queries[0], limit: 5, source_ids: [...grant, unknown] }) as { code?: unknown } | unknown[] | null;
      calls++;
      denied.push({ member, source_id: unknown, code: reply && !Array.isArray(reply) && typeof (reply as { code?: unknown }).code === 'string' ? (reply as { code: string }).code : null });
      const other = [...allSources].filter((s) => !grant.includes(s)).sort((a, b) => a.localeCompare(b));
      if (other.length) {
        let rows_from_it: boolean | null = null;
        for (const source_id of other) {
          const r2 = await callGbrain(sidecar.url, sidecar.token, 'search', { query: queries[0], limit: 50, source_ids: [source_id] }) as Array<{ source_id?: string }> | { code?: unknown } | null;
          calls++;
          if (Array.isArray(r2) && r2.length) { rows_from_it = r2.some((r) => r.source_id === source_id); foreign.push({ member, source_id, rows_from_it }); break; }
          if (!Array.isArray(r2)) { rows_from_it = false; foreign.push({ member, source_id, rows_from_it }); break; }
        }
        if (rows_from_it === null) foreign.push({ member, source_id: other[0]!, rows_from_it: null });
      }
    }
    let differs = false;
    for (const query of queries) {
      const sets = Object.keys(sidecar.grants.members).map((m) => [...(perQuery.get(`${query}|${m}`) ?? new Set<string>())].sort().join(','));
      if (new Set(sets).size > 1) { differs = true; break; }
    }
    return { ready_ms: sidecar.ready_ms, image_id: sidecar.image_id, members: Object.keys(sidecar.grants.members).length, calls, rows, sources_seen: seen.size, outside, denied, foreign, differs };
  } finally {
    await sidecar.stop(5_000);
  }
}

/** internal-task: gbrain's own word that a reply fell back to keyword search: recall's search_degraded or facts_degraded.reason, or
 *  a search row's degraded_recall notice when embeddings are off; null when the reply carries no such stamp. */
export function degradedStamp(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { search_degraded?: unknown; facts_degraded?: { reason?: unknown } };
  if (typeof p.search_degraded === 'string') return p.search_degraded;
  if (typeof p.facts_degraded?.reason === 'string') return p.facts_degraded.reason;
  return null;
}

/** tools/list through the sidecar directly: the tool names in order. */
export async function listGbrainTools(url: string, token: string): Promise<string[]> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('text/event-stream') ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('') : text;
  const msg = JSON.parse(data) as { result?: { tools?: Array<{ name: string }> }; error?: { message?: string } };
  if (msg.error) throw new Error(`gbrain tools/list: ${msg.error.message ?? 'rpc error'}`);
  return (msg.result?.tools ?? []).map((t) => t.name);
}

/** internal-task: the view manifest gbrain/export-install.sh writes beside an exported view. */
export interface InstallViewManifest {
  harness: string;
  split: 'dev' | 'heldout';
  /** The view's install kind; absent in views exported before the installer rung (gbrain-docs). */
  install?: 'gbrain-docs' | 'gbrain-installer';
  /** gbrain-installer views: the bundle's installer record (the command, its files, the block version, the Hermes seed). */
  installer?: InstallerRecord | { unavailable: string } | null;
  gbrain_commit: string;
  gbrain_version: string | null;
  bundle_digest: string;
  view_digest: string;
  workspace_entries: string[];
  skills: number;
  context: { path: string; bytes: number; tokens: number | null; kept_slugs: string[] } | null;
  files: Array<InstallFile & { source_path: string }>;
}

/** internal-task: export one harness and split view of the image's install bundle into dest and verify every file against the
 *  view manifest (HE-GBRAIN-006 on a missing view, a failed export or a digest mismatch); install picks the gbrain-docs view
 *  (the default) or the gbrain-installer view, which the image refuses when its gbrain commit has no setup target. */
export async function exportInstallView(image: string, harness: string, split: 'dev' | 'heldout', dest: string, install: 'gbrain-docs' | 'gbrain-installer' = 'gbrain-docs'): Promise<InstallViewManifest> {
  const out = resolve(dest);
  mkdirSync(out, { recursive: true });
  // The fake harness has no documented install; it takes the OpenClaw view so a keyless trial proves the mount and the adapter variables.
  const bundleHarness = harness === '_fake' ? 'openclaw' : harness;
  const r = await sh(['docker', 'run', '--rm', '--user', uidGid(), '-v', `${out}:/out`, '--entrypoint', '/opt/sidecar/gbrain/export-install.sh', image, bundleHarness, split, '/out', install], 300_000);
  if (r.status !== 0) throw new RunnerError('HE-GBRAIN-006', `export-install.sh ${bundleHarness} ${split} ${install} from ${image} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}; fix: rebuild the image (scripts/build-gbrain-image.sh) so it carries the install bundle`);
  const manifestPath = join(out, 'manifest.json');
  if (!existsSync(manifestPath)) throw new RunnerError('HE-GBRAIN-006', `the exported view at ${out} has no manifest.json; fix: rebuild the image (scripts/build-gbrain-image.sh)`);
  const view = JSON.parse(readFileSync(manifestPath, 'utf8')) as InstallViewManifest;
  return verifyInstallView(view, out, install);
}

/** internal-task: every file the view manifest lists is present under root with its sha256, and the view is of the install kind the
 *  cell asked for (HE-GBRAIN-006 otherwise). */
export function verifyInstallView(view: InstallViewManifest, root: string, install: 'gbrain-docs' | 'gbrain-installer' = 'gbrain-docs'): InstallViewManifest {
  const kind = view.install ?? 'gbrain-docs';
  if (kind !== install) throw new RunnerError('HE-GBRAIN-006', `the install bundle view at ${root} is a ${kind} view, the cell's gbrain.install is ${install}; fix: remove the directory and run preflight again`);
  if (kind === 'gbrain-installer' && !view.files.length) throw new RunnerError('HE-GBRAIN-006', `the ${view.harness} installer view at ${root} lists no file; gbrain setup ${view.harness} --instructions-only wrote nothing at this gbrain commit`);
  const check = verifyFiles(root, view.files);
  if (!check.ok) throw new RunnerError('HE-GBRAIN-006', `the install bundle view at ${root} (${view.harness} ${view.split}) does not match its manifest: ${check.missing.length} missing (${check.missing.slice(0, 3).join(', ')}), ${check.changed.length} changed (${check.changed.slice(0, 3).join(', ')}); fix: re-export it from the image (gbrain/export-install.sh) or rebuild the image`);
  if (kind === 'gbrain-docs' && view.harness === 'hermes' && (!view.context || view.context.kept_slugs.length === 0)) throw new RunnerError('HE-GBRAIN-006', `the hermes ${view.split} view at ${root} has an empty compiled context; the bundle was built from an empty brain (gbrain/build-install.ts copies each brain to /brain first); fix: rebuild the image`);
  return view;
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
export async function probeCompanyBrain(image: string, split: 'dev' | 'heldout', expected: Array<{ page_slug: string; kind: string; readers: string[] }>, scratchDir: string, scope: 'none' | 'member' | 'sources' = 'member', brain: 'company' | 'member' = 'company'): Promise<{ ready_ms: number; image_id: string; listed: number; by_kind: Record<string, number>; member_tokens: number; member_check: string }> {
  // internal-task: the member brain (the bot-visible slice in reader-set sources plus the empty ingest sources) is probed the same way,
  // with its own page list (gbrain/build-brain.ts memberPageList) and ingest live so the ingest tokens are checked too.
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-${brain}-${split}-${process.pid}`, split, outDir: scratchDir, image, brain, scope, ...(brain === 'member' ? { ingest: 'live' as const } : {}) });
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
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', `the ${brain} brain for ${split} in ${image} ${what}; fix: rebuild the image (gbrain/README.md, "The ${brain} brain")`);
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
