// The gbrain sidecar of one trial (docs/gbrain-arm.md): one container from harness-eval/gbrain:dev on its own
// docker network, its MCP port published on the host loopback only, a fresh brain for the trial's split, a
// bearer token minted into <trial dir>/gbrain/token. The harness never reaches it: the world's /gbrain tap does,
// with that token, and the harness gets the tap's URL and the world bot token. Everything docker-specific for
// the sidecar lives here, like runner/trial/docker.ts for the harness.
//
// Company brain: the sidecar may serve the company brain (HE_GBRAIN_BRAIN=company) and, under member scope
// (HE_GBRAIN_SCOPE=member), writes the brain's tokens.json beside the token; the runner reads it for the world's tap
// and checks it covers every actor of the task (HE-GBRAIN-004). The record also keeps the docker image id.
//
// Scope "sources" (gbrain#7481): under HE_GBRAIN_SCOPE=sources the entrypoint copies the company brain's manifest.json
// (no tokens; its grants map each member to the source ids that member may read) beside the token; the runner hands the
// grants to the world's tap, which adds source_ids to every search, query, recall and list_pages under the trial's one unscoped token
// (world/services/gbrain-tap.ts), and checks the grants cover every actor of the task (HE-GBRAIN-004).
//
// The install ladder: the sidecar takes the surface (HE_GBRAIN_SURFACE) and, for an embedded brain, the model
// (HE_GBRAIN_EMBEDDINGS) and the metering proxy's slot URL as OPENAI_BASE_URL with the host-gateway route, so its query
// embeddings are metered under the trial key; no key is passed. The docker calls are asynchronous subprocesses so one
// trial's slow container start cannot stall another trial's world under run --parallel. exportInstallView exports and
// verifies one view of the image's install bundle (HE-GBRAIN-006).
//
// On a cell with network "internal" the sidecar joins the run's internal network (runner/trial/docker.ts) instead
// of a network of its own, with host.docker.internal mapped to that network's gateway for the proxy route. An internal
// network publishes no ports, so the world reaches the sidecar at its address on that network, which the host owns a route
// to; inter-container traffic is off there, so the harness cannot reach the sidecar directly any more than before.
//
// internal-task (the access-rules rerun): under access "rules" (HE_GBRAIN_ACCESS=rules) the sidecar serves the member brain built with
// gbrain's folder rules and member-bound tokens (/brains/<split>-member-acl). probeAccessRules collects, keyless, what the preflight
// checks before any trial: gbrain access check per token, gbrain access rule list per source and gbrain access who-can-read per page
// (run in a second container from the image, never the serving one), and the rows search, query, recall and list_pages return under
// each token the tap would present; accessRulesProblems turns that into the fail-closed verdict (HE-GBRAIN-002).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { RunnerError } from '../errors.ts';
import type { BrainIngest, CompanyBrainManifest, CompanyTokens, IngestTokens } from '../../gbrain/build-brain.ts';
import { verifyFiles, type InstallFile, type InstallerRecord } from '../../gbrain/build-install.ts';
import type { GbrainCellConfig } from '../contracts.ts';
import type { InternalNetwork } from './docker.ts';
import { isHostAddress } from './world.ts';

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
  /** The brain to serve and whether tokens.json is wanted; defaults bot-visible and none. */
  brain?: NonNullable<GbrainCellConfig['brain']>;
  scope?: 'none' | 'member' | 'sources' | 'member-sources';
  /** Live ingestion (member brain only): the entrypoint copies ingest-tokens.json beside the token. */
  ingest?: 'off' | 'live';
  /** "rules" serves the access-ruled member brain (member brain, member scope only); default none. */
  access?: 'none' | 'rules';
  /** The surface (default starter) and the embedding model (default off); an embedded brain needs openaiBaseUrl, the
   *  metering proxy's slot URL as the container reaches it (a route, never a key), and proxyToken, the random per-trial token
   *  the proxy requires on that slot (2026-10-28; the entrypoint hands it to gbrain as its OpenAI credential, which the proxy
   *  strips before it injects the real key). */
  surface?: GbrainCellConfig['surface'];
  embeddings?: NonNullable<GbrainCellConfig['embeddings']>;
  openaiBaseUrl?: string;
  proxyToken?: string;
  /** The run's internal network; unset, a bridge network of the sidecar's own with its port published on the loopback. */
  network?: InternalNetwork;
  readyTimeoutMs?: number;
  log?: (line: string) => void;
}

export interface GbrainSidecar {
  /** How the world reaches the sidecar: http://127.0.0.1:<published port>, or on the run's internal network http://<its address there>:3131. */
  url: string;
  token: string;
  tokenPath: string;
  image: string;
  /** sha256 image id behind the tag, from docker image inspect. */
  image_id: string;
  brain: NonNullable<GbrainCellConfig['brain']>;
  scope: 'none' | 'member' | 'sources' | 'member-sources';
  /** Whether the brain gates reads with folder rules and member-bound tokens. */
  access: 'none' | 'rules';
  /** The surface and embedding model the sidecar was started with. */
  surface: GbrainCellConfig['surface'];
  embeddings: NonNullable<GbrainCellConfig['embeddings']>;
  /** Under member scope, the company brain's tokens.json as the entrypoint copied it; the file stays under outDir. */
  tokens: CompanyTokens | null;
  /** gbrain#7481: under scope "sources", the company brain's grants from its manifest.json (member -> readable source ids)
   *  and the source ids every member of the split may read; the tap adds them as source_ids. No token is involved. */
  grants: { members: Record<string, string[]>; public: string[] } | null;
  /** Under live ingestion, the member brain's per-source ingest tokens and the manifest's channel-to-source map, for the
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

/** Sealed custody: the world and held-out corpus inputs the image records in /opt/sidecar/image.json (gbrain/Dockerfile:
 *  world_sha256 of the world.json its brains were built from, heldout_corpus_sha256 of a sealed corpus overlay or null,
 *  and sealed, whether it was built from a sealed root; when image.json has no sealed field, the image's
 *  harness-eval.sealed label decides); when image.json cannot be read, sealed true with null digests if the label says
 *  sealed, else null. */
export function gbrainImageInputs(image = DEFAULT_GBRAIN_IMAGE, run: (argv: string[]) => { status: number | null; stdout: string } = (argv) => spawnSync('docker', argv, { encoding: 'utf8' })): { world_sha256: string | null; heldout_corpus_sha256: string | null; sealed: boolean } | null {
  const label = () => run(['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.sealed"}}', image]).stdout?.trim() === 'true';
  // an unreadable image.json still leaves the label, so a sealed build is never read as public
  const unread = () => (label() ? { world_sha256: null, heldout_corpus_sha256: null, sealed: true } : null);
  const r = run(['run', '--rm', '--entrypoint', 'cat', image, '/opt/sidecar/image.json']);
  if (r.status !== 0) return unread();
  let j: { world_sha256?: string; heldout_corpus_sha256?: string | null; sealed?: unknown };
  try { j = JSON.parse(r.stdout) as typeof j; } catch { return unread(); }
  const sealed = j.sealed === true || (j.sealed !== false && label());
  return { world_sha256: j.world_sha256 ?? null, heldout_corpus_sha256: j.heldout_corpus_sha256 ?? null, sealed };
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

/** internal-task: the image-commit gate of a run whose preregistration names gbrain_commit (preflight and run): the HE-GBRAIN-016 message
 *  body when the image records another commit or none, or when --gbrain-commit names a different one, else null. */
export function preregCommitProblem(o: { image: string; built: string | null; prereg: string; flag?: string }): string | null {
  if (o.flag && o.flag !== o.prereg) return `--gbrain-commit names ${o.flag} and the preregistration's gbrain_commit is ${o.prereg}; a run with a preregistered gbrain commit runs that commit only; fix: drop --gbrain-commit`;
  if (o.built === o.prereg) return null;
  return `image ${o.image} records gbrain ${o.built ?? 'no commit (no /opt/sidecar/image.json, or the image is missing)'}, the preregistration's gbrain_commit is ${o.prereg}; fix: scripts/build-gbrain-image.sh --gbrain ${o.prereg} --tag ${o.image} (scripts/run-shard.sh does this from the preregistration), or --gbrain-image <the image built at that commit>`;
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

/** tokens.json is well formed, for this split, and names a token for every member given (HE-GBRAIN-004). */
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

/** gbrain#7481: the company brain's manifest.json carries a grant for every member given, and the grants map to
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

/** ingest-tokens.json is well formed, for this split, and names a token for every source the manifest's channel map and
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
  const access = o.access ?? 'none';
  const surface = o.surface ?? 'starter';
  const embeddings = o.embeddings ?? 'off';
  if (embeddings !== 'off' && !o.openaiBaseUrl) throw new RunnerError('HE-GBRAIN-002', `an embedded brain (${embeddings}) needs the metering proxy's slot URL as OPENAI_BASE_URL; the runner passes none without a proxy`);
  if (embeddings !== 'off' && !o.proxyToken) throw new RunnerError('HE-GBRAIN-002', `an embedded brain (${embeddings}) needs the proxy slot's per-trial token as HE_GBRAIN_PROXY_TOKEN; the proxy forwards nothing for the slot without it`);
  const log = o.log ?? (() => undefined);
  const name = `he-gbrain-${o.trialSlug}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const network = o.network?.name ?? `${name}-net`;
  const out = resolve(o.outDir);
  mkdirSync(out, { recursive: true });
  const tokenPath = join(out, 'token');
  const tokensPath = join(out, 'tokens.json');
  if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present; fix: docker build -f gbrain/Dockerfile -t ${image} . (gbrain/README.md)`);
  await sh(['docker', 'rm', '-f', name]);
  const removeOwnNetwork = async () => { if (!o.network) await sh(['docker', 'network', 'rm', network]); };
  if (!o.network) {
    await sh(['docker', 'network', 'rm', network]);
    const net = await sh(['docker', 'network', 'create', '--driver', 'bridge', network]);
    if (net.status !== 0) throw new RunnerError('HE-GBRAIN-002', `docker network create ${network} failed: ${(net.stderr || net.stdout).trim().slice(0, 300)}`);
  }
  const started = Date.now();
  const route = o.network ? ['--add-host', `host.docker.internal:${o.network.gateway}`] : ['--add-host', 'host.docker.internal:host-gateway', '-p', `127.0.0.1:0:${GBRAIN_PORT}`];
  // host.docker.internal is the route to the metering proxy for an embedded brain; the entrypoint logs the URL, never a key.
  const run = await sh(['docker', 'run', '-d', '--name', name, '--user', uidGid(), '--network', network, ...route,
    '-v', `${out}:/he-gbrain`,
    '-e', `HE_GBRAIN_SPLIT=${o.split}`, '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', `HE_TRIAL_ID=${o.trialId}`,
    '-e', `HE_GBRAIN_BRAIN=${brain}`, '-e', `HE_GBRAIN_SCOPE=${scope}`, '-e', `HE_GBRAIN_INGEST=${ingest}`, ...(access === 'rules' ? ['-e', 'HE_GBRAIN_ACCESS=rules'] : []),
    '-e', `HE_GBRAIN_SURFACE=${surface}`, '-e', `HE_GBRAIN_EMBEDDINGS=${embeddings}`,
    ...(embeddings !== 'off' ? ['-e', `OPENAI_BASE_URL=${o.openaiBaseUrl}`, '-e', `HE_GBRAIN_PROXY_TOKEN=${o.proxyToken}`] : []),
    image]);
  const image_id = (await sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', image])).stdout.trim();
  if (run.status !== 0) {
    await removeOwnNetwork();
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
      await removeOwnNetwork();
    })();
    return stopped;
  };
  try {
    let url: string;
    if (o.network) {
      const ip = (await sh(['docker', 'inspect', '-f', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name])).stdout.trim();
      if (!isHostAddress(ip)) throw new Error(`docker inspect reported no address for ${name} on ${network}`);
      url = `http://${ip}:${GBRAIN_PORT}`;
    } else {
      const port = (await sh(['docker', 'port', name, `${GBRAIN_PORT}/tcp`])).stdout.trim().split('\n')[0]?.split(':').pop();
      if (!port) throw new Error('docker port reported no published port');
      url = `http://127.0.0.1:${port}`;
    }
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
    if (scope === 'sources' || scope === 'member-sources') {
      const manifestPath = join(out, 'manifest.json');
      while (!existsSync(manifestPath) || !readFileSync(manifestPath, 'utf8').trim()) {
        if (Date.now() > deadline) throw new Error(`no manifest.json at ${manifestPath} after ${Math.round(timeout / 1000)} s`);
        const gone = await exited(); if (gone) throw new Error(gone);
        await Bun.sleep(200);
      }
      grants = checkCompanyGrants(JSON.parse(readFileSync(manifestPath, 'utf8')), o.split, [], manifestPath);
    }
    if (scope === 'member' || scope === 'member-sources') {
      while (!existsSync(tokensPath) || !readFileSync(tokensPath, 'utf8').trim()) {
        if (Date.now() > deadline) throw new Error(`no tokens.json at ${tokensPath} after ${Math.round(timeout / 1000)} s`);
        const gone = await exited();
        if (gone) throw new Error(gone);
        await Bun.sleep(100);
      }
      tokens = JSON.parse(readFileSync(tokensPath, 'utf8')) as CompanyTokens;
    }
    const ready_ms = Date.now() - started;
    log(`gbrain sidecar ${name} (${o.split}, ${image}, brain ${brain}, scope ${scope}, access ${access}, ingest ${ingest}, surface ${surface}, embeddings ${embeddings}) healthy at ${url} after ${ready_ms} ms; token in ${tokenPath}${tokens ? `, ${Object.keys(tokens.members ?? {}).length} member tokens in ${tokensPath}` : ''}${ingestTokens ? `, ${Object.keys(ingestTokens.tokens.sources).length} ingest tokens` : ''}`);
    return { url, token, tokenPath, image, image_id, brain, scope, access, surface, embeddings, tokens, grants, ingest: ingestTokens, ready_ms, stop };
  } catch (e) {
    await stop(5_000);
    const tail = existsSync(join(out, 'docker.log')) ? readFileSync(join(out, 'docker.log'), 'utf8').trim().split('\n').slice(-3).join(' | ') : '';
    throw new RunnerError('HE-GBRAIN-002', `the gbrain sidecar did not become ready: ${(e as Error).message}${tail ? ` (${tail})` : ''}; fix: read ${join(out, 'sidecar.log')} and ${join(out, 'docker.log')}, rebuild the image (gbrain/README.md)`);
  }
}

/** Preflight: the image exists and a container from it serves /health and lists its tools on the given surface (the
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

/** Preflight and keyless check (gbrain#7481) for scope "sources": the company brain of a split, served under the one
 *  unscoped token, is searched and queried once per member and query with source_ids set to that member's grant exactly as the
 *  tap sets it (scopeRequest), and every returned row's source_id must lie inside the grant; one call per member names a
 *  source outside the grant and must come back permission_denied. Rows are counted so an all-empty check cannot pass vacuously.
 *  Every SOURCE_SCOPED_TOOLS tool is probed (recall and list_pages too, gbrain#8074; list_pages once per member, it takes no
 *  query), and under scope "member-sources" each member's calls go out under that member's rescoped token from tokens.json,
 *  as the tap sends them, so the two layers are checked together. */
export const SOURCE_PROBE_QUERIES = ['incident', 'rate', 'door', 'budget', 'meeting', 'contract', 'ticket', 'update'] as const;

export async function probeSourceGrants(image: string, split: 'dev' | 'heldout', scratchDir: string, queries: readonly string[] = SOURCE_PROBE_QUERIES, scope: 'sources' | 'member-sources' = 'sources', brain: 'company' | 'member' = 'company'): Promise<{
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
  /** Rows per SOURCE_SCOPED_TOOLS tool over every member; a tool at 0 was not observed and fails preflight. */
  rows_by_tool: Record<string, number>;
  /** Scope "member-sources" only (null otherwise): the same calls under each member's token with no source_ids, so the
   *  token layer is checked on its own (rows outside the grant land in outside, tool marked "token alone"), and per member one
   *  get_page of a slug from a source outside its grant, which must come back as an error code, never the page (code null), while
 *  the same slug under the unscoped token comes back as the page (unscoped_code null), so the refusal is the member token's; beside
 *  it one get_page of a slug inside the grant, which must come back as the page, so an all-refused read cannot pass vacuously.
 *  "The page" means a reply whose slug is the one asked for. Under the token alone list_pages is paged to the end. */
  token_alone: null | { rows_by_tool: Record<string, number>; slug_reads: Array<{ member: string; slug: string; source_id: string; code: string | null; unscoped_code: string | null; own_slug: string | null; own_code: string | null }> };
}> {
  const { scopeRequest, SOURCE_SCOPED_TOOLS } = await import('../../world/services/gbrain-tap.ts');
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-${scope}-${brain}-${split}-${process.pid}`, split, outDir: scratchDir, image, brain, scope });
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', `the ${brain} brain for ${split} in ${image} ${what}; fix: rebuild the image (gbrain/README.md, "The ${brain} brain")`);
  try {
    if (!sidecar.grants) throw fail(`started under scope "${scope}" without grants`);
    if (scope === 'member-sources' && !sidecar.tokens) throw fail('started under scope "member-sources" without tokens');
    const ROW_KEYS = ['results', 'pages', 'facts', 'items'];
    const rowsOf = (p: unknown): Array<{ slug?: string; source_id?: string }> | null => Array.isArray(p) ? p : p && typeof p === 'object' && ROW_KEYS.some((k) => Array.isArray((p as Record<string, unknown>)[k])) ? ROW_KEYS.flatMap((k) => { const v = (p as Record<string, unknown>)[k]; return Array.isArray(v) ? v : []; }) : null;
    const rows_by_tool: Record<string, number> = Object.fromEntries([...SOURCE_SCOPED_TOOLS].map((t) => [t, 0]));
    const allSources = new Set(Object.values(sidecar.grants.members).flat());
    const outside: Array<{ member: string; tool: string; query: string; slug: string; source_id: string }> = [];
    const denied: Array<{ member: string; source_id: string; code: string | null }> = [];
    const foreign: Array<{ member: string; source_id: string; rows_from_it: boolean | null }> = [];
    const perQuery = new Map<string, Set<string>>();
    let calls = 0, rows = 0;
    const seen = new Set<string>();
    const slugBySource = new Map<string, string>();
    const token_alone = scope === 'member-sources' ? { rows_by_tool: Object.fromEntries([...SOURCE_SCOPED_TOOLS].map((t) => [t, 0])) as Record<string, number>, slug_reads: [] as Array<{ member: string; slug: string; source_id: string; code: string | null; unscoped_code: string | null; own_slug: string | null; own_code: string | null }> } : null;
    const tokenOf = (member: string) => scope === 'member-sources' ? sidecar.tokens!.members[member] : sidecar.token;
    for (const [member, grant] of Object.entries(sidecar.grants.members).sort(([a], [b]) => a.localeCompare(b))) {
      const token = tokenOf(member);
      if (!token) throw fail(`has a source grant for ${member} but no token for it in tokens.json`);
      for (const alone of token_alone ? [false, true] : [false]) for (const query of queries) for (const tool of SOURCE_SCOPED_TOOLS) {
        if (tool === 'list_pages' && query !== queries[0]) continue;
        const args = tool === 'list_pages' ? { limit: 100 } : tool === 'recall' ? { query } : { query, limit: 50 };
        const sent = alone ? args : scopeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }, grant).request.params!.arguments as Record<string, unknown>;
        // Under the token alone list_pages is read to the end, so a broad token cannot pass on a first page that happens to sit inside the grant.
        const paged = alone && tool === 'list_pages';
        const got: Array<{ slug?: string; source_id?: string }> = [];
        for (let offset = 0; ; offset += 100) {
          const payload = await callGbrain(sidecar.url, token, tool, paged ? { ...sent, offset, sort: 'slug' } : sent);
          calls++;
          const page = rowsOf(payload);
          if (!page) throw fail(`answered ${tool} ${JSON.stringify(query)} for ${member}${alone ? ' (token alone)' : ''} with ${JSON.stringify(payload).slice(0, 200)} instead of rows`);
          if (paged && page.length && page.every((r) => got.some((g) => g.slug === r.slug))) throw fail(`answered list_pages for ${member} (token alone) at offset ${offset} with only rows it had already sent; offset paging does not hold`);
          got.push(...page);
          if (!paged || page.length < 100) break;
        }
        for (const r of got) {
          const source_id = typeof r.source_id === 'string' ? r.source_id : '';
          if (r.slug && source_id && !slugBySource.has(source_id)) slugBySource.set(source_id, r.slug);
          if (!grant.includes(source_id)) outside.push({ member, tool: alone ? `${tool} (token alone)` : tool, query: tool === 'list_pages' ? '' : query, slug: r.slug ?? '?', source_id });
          if (alone) { token_alone!.rows_by_tool[tool]!++; continue; }
          rows++;
          rows_by_tool[tool]!++;
          seen.add(source_id);
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
    // The member token is all that guards a slug read (get_page takes no source_ids), so each member asks for a page it may not read.
    if (token_alone) for (const [member, grant] of Object.entries(sidecar.grants.members).sort(([a], [b]) => a.localeCompare(b))) {
      const sorted = [...slugBySource].sort(([a], [b]) => a.localeCompare(b));
      const target = sorted.find(([source_id]) => !grant.includes(source_id));
      if (!target) continue;
      const own = sorted.find(([source_id]) => grant.includes(source_id));
      // Served means the requested page came back (any other page out of grant counts as a leak in run.ts); the same slug is also read under the unscoped token, so a refusal outside the grant is one the token made.
      const read = async (slug: string, token = tokenOf(member)!) => {
        const reply = await callGbrain(sidecar.url, token, 'get_page', { slug }) as Record<string, unknown> | null;
        calls++;
        return reply && typeof reply.code === 'string' ? reply.code : reply && typeof reply.error === 'string' ? reply.error : !reply ? 'empty' : reply.slug === slug ? null : `another page (${String(reply.slug ?? '?')})`;
      };
      token_alone.slug_reads.push({ member, slug: target[1], source_id: target[0], code: await read(target[1]), unscoped_code: await read(target[1], sidecar.token), own_slug: own?.[1] ?? null, own_code: own ? await read(own[1]) : 'no slug inside the grant' });
    }
    let differs = false;
    for (const query of queries) {
      const sets = Object.keys(sidecar.grants.members).map((m) => [...(perQuery.get(`${query}|${m}`) ?? new Set<string>())].sort().join(','));
      if (new Set(sets).size > 1) { differs = true; break; }
    }
    return { ready_ms: sidecar.ready_ms, image_id: sidecar.image_id, members: Object.keys(sidecar.grants.members).length, calls, rows, sources_seen: seen.size, outside, denied, foreign, differs, rows_by_tool, token_alone };
  } finally {
    await sidecar.stop(5_000);
  }
}

/** C4 ("rows with each layer off"): the four ways a call can reach the member brain, by which scope layer is on. */
export const SCOPE_LAYERS = ['both', 'token', 'sources', 'neither'] as const;
export type ScopeLayer = (typeof SCOPE_LAYERS)[number];

/** R40: the most list_pages pages of 100 rows the layer probe reads for one call before it fails closed. */
export const LIST_PAGES_MAX_PAGES = 1000;

/** R40: list_pages paged to the end, 100 rows a page, from offset 0. Fails closed with fail(...) when a full page
 *  repeats an earlier one (gbrain ignored the offset) or the pages run past LIST_PAGES_MAX_PAGES, instead of paging forever. */
export async function listPagesToEnd(page: (offset: number) => Promise<Array<Record<string, unknown>>>, fail: (what: string) => Error): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Map<string, number>();
  for (let n = 0; n < LIST_PAGES_MAX_PAGES; n++) {
    const got = await page(n * 100);
    rows.push(...got);
    if (got.length < 100) return rows;
    const key = JSON.stringify(got);
    if (seen.has(key)) throw fail(`answered list_pages at offset ${n * 100} with the same rows as at offset ${seen.get(key)! * 100}; gbrain ignored the offset, so the probe stops instead of paging forever`);
    seen.set(key, n);
  }
  throw fail(`still answered full list_pages pages after ${LIST_PAGES_MAX_PAGES} pages (${LIST_PAGES_MAX_PAGES * 100} rows); the probe stops instead of paging forever`);
}

/** The fact the layer probe seeds into each member's private source, so recall has a DM fact to leak or keep. */
export const LAYER_PROBE_FACT = (member: string) => `Layer probe: ${member} keeps the spare key in drawer LP-${member}.`;

/**
 * C4 prereg, Freeze gate 3: rows outside each member's grant with each scope layer off, on a brain with member tokens
 * and source grants (the member brain by default), keyless. The sidecar starts under scope "member-sources" (and, for the
 * member brain, live ingestion, whose per-source tokens seed one fact into every private-<member> source with remember, as the
 * world's ingestion writes a DM). Then, per member, every SOURCE_SCOPED_TOOLS tool (search, query and recall once per query,
 * list_pages once, paged to the end, HE-GBRAIN-002 when gbrain ignores the offset (listPagesToEnd); and "recall (question)", recall the way QM's memory provider calls it, with question and
 * max_chars) runs four ways: "both" (the member's rescoped token and its source_ids, what a
 * member-sources cell's tap sends), "token" (the member token, no source_ids), "sources" (the trial's unscoped token with the
 * member's source_ids) and "neither" (the unscoped token, no source_ids: what an unscoped caller such as QM's memory provider
 * under one credential reads). A row is outside when its source_id is not in the member's grant; a row with no source_id is
 * counted apart. Reports, never refuses: preflight's probeSourceGrants is the gate.
 */
export async function probeScopeLayers(image: string, split: 'dev' | 'heldout', scratchDir: string, o: { brain?: 'company' | 'member'; queries?: readonly string[] } = {}): Promise<{
  image_id: string; brain: 'company' | 'member'; split: 'dev' | 'heldout'; members: number; queries: string[]; seeded: Array<{ member: string; source_id: string; ok: boolean }>;
  /** layer -> tool -> calls, rows, rows outside the member's grant, rows without a source_id, and how many of the outside rows are seeded facts. */
  layers: Record<ScopeLayer, Record<string, { calls: number; rows: number; outside: number; unattributed: number; outside_seeded_facts: number }>>;
  /** Up to 3 outside rows per layer and tool, for the receipt. */
  examples: Array<{ layer: ScopeLayer; tool: string; member: string; query: string; slug: string; source_id: string }>;
}> {
  const brain = o.brain ?? 'member';
  const queries = [...(o.queries ?? [...SOURCE_PROBE_QUERIES, 'spare key drawer'])];
  const { scopeRequest, SOURCE_SCOPED_TOOLS } = await import('../../world/services/gbrain-tap.ts');
  const sidecar = await startGbrainSidecar({ trialId: 'layers', trialSlug: `layers-${brain}-${split}-${process.pid}`, split, outDir: scratchDir, image, brain, scope: 'member-sources', ...(brain === 'member' ? { ingest: 'live' as const } : {}) });
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', `the ${brain} brain for ${split} in ${image} ${what}`);
  try {
    if (!sidecar.grants || !sidecar.tokens) throw fail('started under scope "member-sources" without grants or tokens');
    const grants = sidecar.grants.members;
    const seeded: Array<{ member: string; source_id: string; ok: boolean }> = [];
    if (sidecar.ingest) for (const member of Object.keys(grants).sort()) {
      const source_id = `${sidecar.ingest.map.dm_source_prefix}${member}`;
      const token = sidecar.ingest.tokens.sources[source_id];
      if (!token) continue;
      const reply = await callGbrain(sidecar.url, token, 'remember', { fact: LAYER_PROBE_FACT(member), provenance: 'harness-evals layer probe (internal-task)', source_id, request_id: crypto.randomUUID() }) as { status?: unknown } | null;
      seeded.push({ member, source_id, ok: reply?.status === 'inserted' || reply?.status === 'duplicate' });
    }
    const ROW_KEYS = ['results', 'pages', 'facts', 'items'];
    const rowsOf = (p: unknown): Array<Record<string, unknown>> => Array.isArray(p) ? p : p && typeof p === 'object' ? ROW_KEYS.flatMap((k) => { const v = (p as Record<string, unknown>)[k]; return Array.isArray(v) ? v : []; }) : [];
    const probeTools = [...SOURCE_SCOPED_TOOLS, 'recall (question)'];
    const layers = Object.fromEntries(SCOPE_LAYERS.map((l) => [l, Object.fromEntries(probeTools.map((t) => [t, { calls: 0, rows: 0, outside: 0, unattributed: 0, outside_seeded_facts: 0 }]))])) as Record<ScopeLayer, Record<string, { calls: number; rows: number; outside: number; unattributed: number; outside_seeded_facts: number }>>;
    const examples: Array<{ layer: ScopeLayer; tool: string; member: string; query: string; slug: string; source_id: string }> = [];
    for (const [member, grant] of Object.entries(grants).sort(([a], [b]) => a.localeCompare(b))) {
      const memberToken = sidecar.tokens.members[member];
      if (!memberToken) throw fail(`has a source grant for ${member} but no token for it in tokens.json`);
      for (const layer of SCOPE_LAYERS) for (const tool of probeTools) for (const query of tool === 'list_pages' ? [''] : queries) {
        const token = layer === 'both' || layer === 'token' ? memberToken : sidecar.token;
        const name = tool === 'recall (question)' ? 'recall' : tool;
        const base = tool === 'list_pages' ? { limit: 100 } : tool === 'recall' ? { query } : tool === 'recall (question)' ? { question: query, max_chars: 6000 } : { query, limit: 50 };
        const args = layer === 'both' || layer === 'sources' ? scopeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: base } }, grant).request.params!.arguments as Record<string, unknown> : base;
        const n = layers[layer][tool]!;
        const call = async (extra: Record<string, unknown>) => { n.calls++; return rowsOf(await callGbrain(sidecar.url, token, name, { ...args, ...extra })); };
        const got = tool === 'list_pages' ? await listPagesToEnd((offset) => call({ offset, sort: 'slug' }), fail) : await call({});
        for (const r of got) {
          n.rows++;
          const source_id = typeof r.source_id === 'string' ? r.source_id : '';
          if (!source_id) { n.unattributed++; continue; }
          if (grant.includes(source_id)) continue;
          n.outside++;
          const text = JSON.stringify(r);
          if (text.includes('Layer probe:')) n.outside_seeded_facts++;
          if (examples.filter((e) => e.layer === layer && e.tool === tool).length < 3) examples.push({ layer, tool, member, query, slug: String(r.slug ?? r.id ?? '?'), source_id });
        }
      }
    }
    return { image_id: sidecar.image_id, brain, split, members: Object.keys(grants).length, queries, seeded, layers, examples };
  } finally {
    await sidecar.stop(5_000);
  }
}

/** What the access-rules preflight collects from a split's access-ruled member brain, keyless. Token names, rule readers,
 *  slugs and source ids only; no secret. */
export interface AccessRulesEvidence {
  image_id: string;
  ready_ms: number;
  /** (a) gbrain access check --token <name> --json for every token in tokens.json: the bound member, its status and the verdict. */
  checks: Array<{ token: string; member: string | null; status: string | null; verdict: string | null; error?: string }>;
  /** (b) gbrain access rule list --source <id> --json per source: the applied rules (readers as member ids) and how many changes are
   *  held, pending or invalid. */
  rules: Array<{ source: string; rules: Array<{ id: string; prefix: string; readers: string[] }>; held: number; pending: number; invalid: number; error?: string }>;
  /** (b) gbrain access who-can-read <slug> --source <id> --json per page: the page's own readers and the members gbrain names. */
  who: Array<{ slug: string; source_id: string; readers: string[] | null; members: string[] | 'every_source_reader' | null; error?: string }>;
  /** (c) per grant the tap presents (public-only and each member), the rows of search, query and recall per probe query and of
   *  list_pages paged to the end, as slug and source id. */
  tap: Array<{ grant: string; tool: string; query: string; rows: Array<{ slug: string; source_id: string }>; error?: string }>;
  /** (c) get_page by slug under each member token, on every page outside the member's reader set and the first page inside it:
   *  ok when the page came back, refused on an error code or an empty reply, other when another page came back. */
  slug_reads: Array<{ grant: string; slug: string; source_id: string; inside: boolean; outcome: 'ok' | 'refused' | 'other'; code: string | null }>;
}

/** The world's side of the check: every page with its source and reader set, every source with its readers, the token members. */
export interface AccessRulesExpected {
  pages: Array<{ page_slug: string; source: string; readers: string[] }>;
  sources: Array<{ id: string; readers: string[] }>;
  token_members: string[];
}

/** Collect the evidence for one split. The CLI checks run in a second container from the image on its own copy of the
 *  brain (gbrain's PGLite store takes one process at a time, and the serving container holds it); the tap probe goes to the sidecar
 *  under the token world/services/gbrain-tap.ts grantFor picks for each requester, with no source_ids, as the tap sends a call under
 *  scope "member". */
export async function probeAccessRules(image: string, split: 'dev' | 'heldout', scratchDir: string, expected: AccessRulesExpected, queries: readonly string[] = SOURCE_PROBE_QUERIES): Promise<AccessRulesEvidence> {
  const { grantFor, SOURCE_SCOPED_TOOLS } = await import('../../world/services/gbrain-tap.ts');
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', `the access-ruled member brain for ${split} in ${image} ${what}; fix: rebuild the image (docs/gbrain-arm.md, "Access-ruled member brain")`);
  const cli = `he-gbrain-preflight-acl-${split}-${process.pid}`;
  await sh(['docker', 'rm', '-f', cli]);
  const started = await sh(['docker', 'run', '-d', '--name', cli, '--user', uidGid(), '--network', 'none', '--entrypoint', 'sleep', image, 'infinity']);
  if (started.status !== 0) throw fail(`could not start a CLI container: ${(started.stderr || started.stdout).trim().slice(0, 300)}`);
  try {
    const copied = await sh(['docker', 'exec', cli, 'bash', '-c', `cp -a /brains/${split}-member-acl/.gbrain /brain/.gbrain && rm -f /brain/.gbrain/*.lock /brain/.gbrain/persistence/locks/*`]);
    if (copied.status !== 0) throw fail(`has no brain at /brains/${split}-member-acl: ${(copied.stderr || copied.stdout).trim().slice(0, 300)}`);
    const gbrain = async (args: string[]): Promise<Record<string, unknown>> => {
      const r = await sh(['docker', 'exec', '-e', 'GBRAIN_HOME=/brain', '-e', 'HOME=/tmp', '-e', 'GBRAIN_SKIP_STARTUP_HOOKS=1', '-e', 'NO_COLOR=1', cli, 'bun', '/opt/gbrain/src/cli.ts', ...args, '--json']);
      const lines = r.stdout.split('\n');
      const start = lines.map((l) => l.trimEnd()).indexOf('{');
      let parsed: Record<string, unknown> | null = null;
      try { parsed = start >= 0 ? JSON.parse(lines.slice(start).join('\n')) as Record<string, unknown> : null; } catch { parsed = null; }
      if (r.status !== 0 || !parsed) return { error: typeof parsed?.code === 'string' ? parsed.code : `exit ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').slice(-1)[0]?.slice(0, 160) ?? ''}` };
      return parsed;
    };
    const strip = (p: string) => (p.startsWith('member:') ? p.slice(7) : p);
    const checks: AccessRulesEvidence['checks'] = [];
    for (const token of [...expected.token_members.map((m) => `member-${m}`), 'public-only']) {
      const r = await gbrain(['access', 'check', '--token', token]);
      if (typeof r.error === 'string') { checks.push({ token, member: null, status: null, verdict: null, error: r.error }); continue; }
      const m = (r as { member?: { id?: unknown; status?: unknown } | null }).member;
      checks.push({ token, member: m && typeof m.id === 'string' ? m.id : null, status: m && typeof m.status === 'string' ? m.status : null, verdict: typeof r.verdict === 'string' ? r.verdict : null });
    }
    const rules: AccessRulesEvidence['rules'] = [];
    for (const s of expected.sources) {
      const r = await gbrain(['access', 'rule', 'list', '--source', s.id]);
      if (!Array.isArray((r as { rules?: unknown }).rules)) { rules.push({ source: s.id, rules: [], held: 0, pending: 0, invalid: 0, error: typeof r.error === 'string' ? r.error : 'no rules list' }); continue; }
      const st = r as { rules: Array<{ id: string; prefix: string; readable_by: string[] }>; held?: unknown[]; pending?: unknown[]; invalid?: unknown[] };
      rules.push({ source: s.id, rules: st.rules.map((x) => ({ id: x.id, prefix: x.prefix, readers: x.readable_by.map(strip).sort() })), held: st.held?.length ?? 0, pending: st.pending?.length ?? 0, invalid: st.invalid?.length ?? 0 });
    }
    const who: AccessRulesEvidence['who'] = [];
    for (const p of expected.pages) {
      const r = await gbrain(['access', 'who-can-read', p.page_slug, '--source', p.source]);
      const page = (r as { pages?: Array<{ readers: string[] | null; members: string[] | 'every_source_reader' }> }).pages?.[0];
      if (!page) { who.push({ slug: p.page_slug, source_id: p.source, readers: null, members: null, error: typeof r.error === 'string' ? r.error : 'no page in the reply' }); continue; }
      who.push({ slug: p.page_slug, source_id: p.source, readers: page.readers === null ? null : page.readers.map(strip).sort(), members: Array.isArray(page.members) ? [...page.members].sort() : page.members });
    }
    const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-acl-${split}-${process.pid}`, split, outDir: scratchDir, image, brain: 'member', scope: 'member', access: 'rules' });
    try {
      if (!sidecar.tokens) throw fail('started under scope "member" without tokens');
      const upstream = { url: sidecar.url, token: sidecar.token, tokens: sidecar.tokens };
      const ROW_KEYS = ['results', 'pages', 'facts', 'items'];
      const rowsOf = (p: unknown): Array<{ slug?: unknown; source_id?: unknown }> | null => Array.isArray(p) ? p : p && typeof p === 'object' && ROW_KEYS.some((k) => Array.isArray((p as Record<string, unknown>)[k])) ? ROW_KEYS.flatMap((k) => { const v = (p as Record<string, unknown>)[k]; return Array.isArray(v) ? v : []; }) : null;
      const tap: AccessRulesEvidence['tap'] = [];
      for (const requester of [null, ...[...expected.token_members].sort()]) {
        const { grant, token } = grantFor(upstream, requester);
        if (!token) { tap.push({ grant, tool: '-', query: '', rows: [], error: 'no token for this member in tokens.json' }); continue; }
        for (const tool of SOURCE_SCOPED_TOOLS) for (const query of tool === 'list_pages' ? [''] : queries) {
          const got: Array<{ slug: string; source_id: string }> = [];
          let error: string | undefined;
          for (let offset = 0; ; offset += 100) {
            const args = tool === 'list_pages' ? { limit: 100, offset, sort: 'slug' } : tool === 'recall' ? { query } : { query, limit: 50 };
            const page = rowsOf(await callGbrain(sidecar.url, token, tool, args));
            if (!page) { error = 'reply without rows'; break; }
            got.push(...page.map((r) => ({ slug: typeof r.slug === 'string' ? r.slug : '', source_id: typeof r.source_id === 'string' ? r.source_id : '' })));
            if (tool !== 'list_pages' || page.length < 100) break;
          }
          tap.push({ grant, tool, query, rows: got, ...(error ? { error } : {}) });
        }
      }
      // A slug read takes no source_ids, so the folder rules are all that guard it under a member-bound token.
      const slug_reads: AccessRulesEvidence['slug_reads'] = [];
      for (const member of [...expected.token_members].sort()) {
        const { grant, token } = grantFor(upstream, member);
        if (!token) continue;
        const inside = expected.pages.filter((p) => p.readers.includes(member)).slice(0, 1);
        for (const p of [...expected.pages.filter((q) => !q.readers.includes(member)), ...inside]) {
          const reply = await callGbrain(sidecar.url, token, 'get_page', { slug: p.page_slug }) as Record<string, unknown> | null;
          const code = !reply ? 'empty' : typeof reply.code === 'string' ? reply.code : typeof reply.error === 'string' ? reply.error : null;
          const outcome = code !== null ? 'refused' : reply!.slug === p.page_slug ? 'ok' : 'other';
          slug_reads.push({ grant, slug: p.page_slug, source_id: p.source, inside: p.readers.includes(member), outcome, code: outcome === 'other' ? `another page (${String(reply!.slug ?? '?')})` : code });
        }
      }
      return { image_id: sidecar.image_id, ready_ms: sidecar.ready_ms, checks, rules, who, tap, slug_reads };
    } finally {
      await sidecar.stop(5_000);
    }
  } finally {
    await sh(['docker', 'rm', '-f', cli]);
  }
}

/** Write the access-rules preflight record beside preflight.log. Refused (HE-GBRAIN-002, nothing written) in a directory
 *  that holds tokens.json or token, or when the record would carry any token value the sidecar left in tokenDir. */
export function writeAccessPreflight(path: string, record: unknown, tokenDir: string): void {
  if (['tokens.json', 'token'].some((f) => existsSync(join(dirname(path), f)))) throw new RunnerError('HE-GBRAIN-002', `${path}: the access preflight record would sit beside a gbrain token; it goes where no token is kept`);
  const text = JSON.stringify(record, null, 1) + '\n';
  const secrets: string[] = [];
  if (existsSync(join(tokenDir, 'tokens.json'))) {
    const t = JSON.parse(readFileSync(join(tokenDir, 'tokens.json'), 'utf8')) as Partial<CompanyTokens>;
    secrets.push(t.public_only ?? '', ...Object.values(t.members ?? {}));
  }
  if (existsSync(join(tokenDir, 'token'))) secrets.push(readFileSync(join(tokenDir, 'token'), 'utf8').trim());
  if (secrets.some((s) => s && text.includes(s))) throw new RunnerError('HE-GBRAIN-002', `${path}: the access preflight record would carry a gbrain token value from ${tokenDir}; nothing was written`);
  writeFileSync(path, text);
}

/** run's check that the access-rules preflight passed on the image it is about to use. A resumed shard that rebuilt the
 *  image re-mints the tokens and re-adds the rules, so a record for another image id does not cover it. */
export function accessPreflightProblem(path: string, split: string, image: string, imageId: string): string | null {
  const fix = `fix: rerun bun runner/run.ts preflight on this image before run (docs/gbrain-arm.md, "Access-ruled member brain")`;
  if (!existsSync(path)) return `access=rules: no access preflight record for ${split} at ${path}; ${fix}`;
  let r: { ok?: unknown; evidence?: { image_id?: unknown } } | null;
  try { r = JSON.parse(readFileSync(path, 'utf8')) as { ok?: unknown; evidence?: { image_id?: unknown } } | null; } catch { return `access=rules: ${path} is not JSON; ${fix}`; }
  if (r?.ok !== true) return `access=rules: the access preflight for ${split} at ${path} did not pass; ${fix}`;
  if (!imageId || r.evidence?.image_id !== imageId) return `access=rules: the access preflight for ${split} ran on image id ${String(r.evidence?.image_id ?? 'none')}, ${image} is now ${imageId || 'unreadable'}; ${fix}`;
  return null;
}

/** The fail-closed verdict on the evidence. (a) every member token reads as exactly its member and public-only is bound to
 *  nobody; (b) every source but public carries one rule whose readers are the source's readers, nothing held, pending or invalid,
 *  and every page's effective readers (its own readers, if any, within every rule covering its slug) are the world's reader set,
 *  the public pages under no rule; (c) no row under any grant lies outside that grant's reader set (public-only: the public pages),
 *  a row is its source and slug together, every grant's list_pages holds every page it may read, search, query and recall each
 *  returned rows, and get_page under each member token refused every page outside its reader set and served one inside it. who-can-read at
 *  gbrain 0.60.554.0 reads only a page's own readable_by and answers "every_source_reader" for a page that only a folder rule
 *  covers; that answer is counted in rule_blind and the rule list decides. */
export function accessRulesProblems(e: AccessRulesEvidence, x: AccessRulesExpected): { problems: Array<{ check: 'a' | 'b' | 'c'; what: string }>; summary: { tokens: number; rules: number; pages: number; rule_blind: number; calls: number; rows: number; rows_by_tool: Record<string, number>; slug_reads: number } } {
  const problems: Array<{ check: 'a' | 'b' | 'c'; what: string }> = [];
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  const members = new Set(x.token_members);
  for (const m of x.token_members) {
    const c = e.checks.find((k) => k.token === `member-${m}`);
    if (!c) problems.push({ check: 'a', what: `no access check for member-${m}` });
    else if (c.error || c.verdict !== 'reads_as_member' || c.member !== m || c.status !== 'enabled') problems.push({ check: 'a', what: `member-${m} is ${c.error ?? `${c.verdict} as ${c.member ?? 'nobody'} (${c.status ?? '-'})`}, not bound to ${m}` });
  }
  const pub = e.checks.find((k) => k.token === 'public-only');
  if (!pub || pub.error || pub.verdict !== 'unbound' || pub.member !== null) problems.push({ check: 'a', what: `public-only is ${pub ? pub.error ?? `${pub.verdict} as ${pub.member ?? 'nobody'}` : 'unchecked'}, not unbound` });
  for (const k of e.checks) if (k.token !== 'public-only' && !members.has(k.token.replace(/^member-/, ''))) problems.push({ check: 'a', what: `${k.token} is not a token member's token` });

  const sourceReaders = new Map(x.sources.map((s) => [s.id, s.readers]));
  const rulesOf = new Map(e.rules.map((r) => [r.source, r]));
  for (const s of x.sources) {
    const r = rulesOf.get(s.id);
    if (!r || r.error) { problems.push({ check: 'b', what: `no rule list for source ${s.id}${r?.error ? ` (${r.error})` : ''}` }); continue; }
    if (r.held || r.pending || r.invalid) problems.push({ check: 'b', what: `source ${s.id} has ${r.held} held, ${r.pending} pending and ${r.invalid} invalid rule change(s)` });
    if (s.id === 'public') { if (r.rules.length) problems.push({ check: 'b', what: `the public source carries ${r.rules.length} rule(s)` }); continue; }
    if (r.rules.length !== 1 || !same(r.rules[0]!.readers, s.readers)) problems.push({ check: 'b', what: `source ${s.id} carries ${r.rules.map((q) => `${q.prefix} [${q.readers.join(',')}]`).join('; ') || 'no rule'}, not one rule for [${s.readers.join(',')}]` });
  }
  let rule_blind = 0;
  for (const p of x.pages) {
    const w = e.who.find((q) => q.slug === p.page_slug && q.source_id === p.source);
    if (!w || w.error) { problems.push({ check: 'b', what: `no who-can-read for ${p.page_slug} in ${p.source}${w?.error ? ` (${w.error})` : ''}` }); continue; }
    const covering = (rulesOf.get(p.source)?.rules ?? []).filter((r) => p.page_slug.startsWith(r.prefix));
    if (p.source === 'public') {
      if (covering.length || w.readers !== null) problems.push({ check: 'b', what: `public page ${p.page_slug} is restricted (${covering.length} rule(s), readers ${JSON.stringify(w.readers)})` });
      continue;
    }
    if (!covering.length) { problems.push({ check: 'b', what: `${p.page_slug} in ${p.source} is under no rule; every caller reads it` }); continue; }
    const effective = covering.reduce<string[]>((acc, r) => acc.filter((id) => r.readers.includes(id)), w.readers ?? covering[0]!.readers);
    if (!same(effective, p.readers)) problems.push({ check: 'b', what: `${p.page_slug} is readable by [${effective.join(',')}], the world says [${p.readers.join(',')}]` });
    if (w.members === 'every_source_reader') rule_blind++;
    else if (!w.members || !same(w.members, p.readers.filter((id) => members.has(id)))) problems.push({ check: 'b', what: `who-can-read names [${(w.members ?? []).join(',')}] for ${p.page_slug}, the world's token members among its readers are [${p.readers.filter((id) => members.has(id)).join(',')}]` });
  }

  const pageKey = (source_id: string, slug: string) => `${source_id}\u0000${slug}`;
  const pageReaders = new Map(x.pages.map((p) => [pageKey(p.source, p.page_slug), p.readers]));
  const everyone = sourceReaders.get('public') ?? [];
  const mayRead = (grant: string, slug: string, source_id: string) => {
    const readers = slug ? pageReaders.get(pageKey(source_id, slug)) : sourceReaders.get(source_id);
    if (!readers) return false;
    return grant === 'public-only' ? same(readers, everyone) : readers.includes(grant);
  };
  const rows_by_tool: Record<string, number> = { search: 0, query: 0, recall: 0, list_pages: 0 };
  let rows = 0;
  for (const t of e.tap) {
    if (t.error) { problems.push({ check: 'c', what: `${t.grant} ${t.tool} ${JSON.stringify(t.query)}: ${t.error}` }); continue; }
    for (const r of t.rows) {
      rows++;
      rows_by_tool[t.tool] = (rows_by_tool[t.tool] ?? 0) + 1;
      if (!mayRead(t.grant, r.slug, r.source_id)) problems.push({ check: 'c', what: `${t.grant} ${t.tool}${t.query ? ` ${JSON.stringify(t.query)}` : ''} -> ${r.slug || '?'} in ${r.source_id || '?'}, outside its reader set` });
    }
  }
  for (const grant of ['public-only', ...x.token_members]) {
    const listed = new Set(e.tap.filter((t) => t.grant === grant && t.tool === 'list_pages').flatMap((t) => t.rows.map((r) => pageKey(r.source_id, r.slug))));
    const hidden = x.pages.filter((p) => (grant === 'public-only' ? same(p.readers, everyone) : p.readers.includes(grant)) && !listed.has(pageKey(p.source, p.page_slug)));
    if (hidden.length) problems.push({ check: 'c', what: `${grant}'s list_pages misses ${hidden.length} page(s) it may read (${hidden.slice(0, 3).map((p) => p.page_slug).join(', ')}); the gate is closed wider than the world` });
  }
  for (const tool of ['search', 'query', 'recall']) if (!rows_by_tool[tool]) problems.push({ check: 'c', what: `${tool} returned 0 rows under every grant; the probe cannot show the rules hold on it` });
  for (const r of e.slug_reads) {
    if (!r.inside && r.outcome !== 'refused') problems.push({ check: 'c', what: `${r.grant} get_page -> ${r.slug} in ${r.source_id}: ${r.outcome === 'ok' ? 'served' : r.code}, outside its reader set` });
    if (r.inside && r.outcome !== 'ok') problems.push({ check: 'c', what: `${r.grant} get_page -> ${r.slug} in ${r.source_id}, inside its reader set: ${r.code}; a refusal outside the reader set cannot be told from a broken read` });
  }
  for (const m of x.token_members) {
    const read = new Set(e.slug_reads.filter((r) => r.grant === m).map((r) => pageKey(r.source_id, r.slug)));
    const unread = x.pages.filter((p) => !p.readers.includes(m) && !read.has(pageKey(p.source, p.page_slug)));
    const insideRead = e.slug_reads.some((r) => r.grant === m && r.inside);
    if (unread.length || (!insideRead && x.pages.some((p) => p.readers.includes(m)))) problems.push({ check: 'c', what: `${m}: get_page was not tried on ${unread.length ? `${unread.length} page(s) outside its reader set (${unread.slice(0, 3).map((p) => p.page_slug).join(', ')})` : 'a page inside its reader set'}; the probe cannot show the rules hold on slug reads` });
  }
  return { problems, summary: { tokens: e.checks.length, rules: e.rules.reduce((n, r) => n + r.rules.length, 0), pages: e.who.length, rule_blind, calls: e.tap.length, rows, rows_by_tool, slug_reads: e.slug_reads.length } };
}

/** gbrain's own word that a reply fell back to keyword search: recall's search_degraded or facts_degraded.reason, or
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

/** The view manifest gbrain/export-install.sh writes beside an exported view. */
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

/** Export one harness and split view of the image's install bundle into dest and verify every file against the
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

/** Every file the view manifest lists is present under root with its sha256, and the view is of the install kind the
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

/** Company brain preflight: the company brain of a split, served from the image under the unscoped token, lists every page
 *  the build should hold (gbrain/build-brain.ts companyPageList), so a scoped arm's leak counts measure grants and
 *  not a thin brain; under member scope, one member token lists nothing outside that member's reader sets and the
 *  public-only token lists only pages every member may read. Pages through list_pages (remote max 100 rows). */
export async function probeCompanyBrain(image: string, split: 'dev' | 'heldout', expected: Array<{ page_slug: string; kind: string; readers: string[] }>, scratchDir: string, scope: 'none' | 'member' | 'sources' = 'member', brain: 'company' | 'member' = 'company'): Promise<{ ready_ms: number; image_id: string; listed: number; by_kind: Record<string, number>; member_tokens: number; member_check: string }> {
  // The member brain (the bot-visible slice in reader-set sources plus the empty ingest sources) is probed the same way,
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
