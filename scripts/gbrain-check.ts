#!/usr/bin/env bun
// One command to check a gbrain commit against this repository's harness machinery (internal-task; docs/gbrain-arm.md,
// "Checking a gbrain commit").
//
//   bun scripts/gbrain-check.ts --gbrain <ref> [--harness fake|openclaw,hermes] [--rungs told,...] [--reps 2]
//       [--model anthropic:claude-haiku-5-5] [--spend-cap 2] [--image <tag>] [--no-build] [--baseline <file>]
//       [--write-baseline] [--force] [--strict-pins] [--expect-hook] [--dry-run]
//   bun scripts/gbrain-check.ts --gbrain <ref> --rungs recall [--recall-cases <file>] [--recall-tasks <task id>,...]
//       [--recall-baseline <file>] [--recall-target <task>=<n>]... [--recall-routes] [--gbrain-config <key>=<value>]...
//       [--resume <check dir>] [--write-baseline [--force]] [--dry-run]       (the keyless recall rung, internal-task; below)
//
// --expect-hook makes an installer bundle without gbrain#7489's per-turn hook (installer.turn_hook) a failure instead of the
// "block-only installer" line, for a pin that is meant to carry the hook (run gbrain-installer-hook-2026-10).
//
// --gbrain is a full or abbreviated sha (taken as is, the build's shallow fetch verifies it; an abbreviation is expanded
// against the remote's refs, else through a treeless clone), a branch or tag (git ls-remote on garrytan/gbrain, annotated
// tags peeled) or a local checkout path (its HEAD commit, which must be clean, because the sidecar image fetches the
// commit from GitHub). Anything else is HE-GBRAIN-009 with the ls-remote output. The sidecar image is built as
// harness-eval/gbrain:check-<sha12> through scripts/build-gbrain-image.sh (--image or --no-build reuses one).
//
// Keyless mode (the default, --harness fake): the fake harness runs one dev task per surface through the real runner
// (plan and run in-process, the way tests/gbrain-runner.test.ts drives executeRun) and the world's gbrain tap, listing the
// tools and retrieving a known dev page (search on starter, recall on verbs), plus one gbrain-docs trial that mounts the
// install bundle view. It asserts: the sidecar healthy with its ready time, tool counts against gbrain/pin.json (a
// difference is printed as a diff and fails only under --strict-pins), the search tool and the verbs present, the
// retrieval returning the known slug with no RPC error and no isError, every install bundle view (openclaw and hermes,
// dev and heldout) matching the image's bundle manifest digest for digest, a non-empty Hermes .hermes.md with kept slugs
// in both splits, and the docs trial's mount as the fake adapter reported it. One line per failed assertion under
// HE-GBRAIN-008; exit 1 on any failure. No key is read, and the proxy runs with placeholder keys the fake never uses.
//
// Paid mode (--harness openclaw,hermes): the harness images must be present and carry the checkout's adapter
// (HE-ADAPTER-005; the build commands are printed otherwise). A scratch preregistration goes under results/gbrain-check/<ts>/
// (GBRAIN_CHECK_DIR overrides; a path under docs/benchmarks/ is HE-GBRAIN-010) with run_id gbrain-check-<ts>, a question
// saying the run is uncounted, the requested rungs (default told) on the dev split with --reps and --model, and
// spend_cap_usd from --spend-cap; then plan, preflight with the image, run --max-output-tokens 128000 --stop-on-cap under
// a scratch ledger beside the run (trials sequential), summarize-run, and the one-page summary against the baseline
// (scripts/gbrain-check.baseline.json, or --baseline for candidate against candidate), also written to summary.md. A run
// with any excluded trial (infra_error, model_error, exam_fault, a cap stop, missing evidence) prints INCOMPLETE first,
// reports no pass figure for a cell that lost trials, exits 3 and never writes a baseline. Baseline compatibility is a
// fingerprint (model, resolved rung configuration, preamble sha, task and repetition set, scorer and runner commit,
// harness image digests, sharding); a mismatch prints NOT_COMPARABLE and suppresses the delta. --write-baseline refuses to
// overwrite without --force (HE-GBRAIN-010; the old file is kept as .prev). --dry-run prints the plan and the missing
// prerequisites and spends nothing.
//
// Exit codes: 0 checked, 1 a failed keyless assertion (the recall rung: a case lost against its baseline or a missed
// target), 2 a refusal or a build failure (the HE- line says which), 3 an incomplete paid run, 4 a recall run with error or
// degraded rows (HE-GBRAIN-013).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { GbrainCellConfig, TrialGbrainInstall, TrialRecord } from '../runner/contracts.ts';
import { RunnerError } from '../runner/errors.ts';
import { buildManifest, loadPrereg, renderPlan, resolveGbrain, type Cell, type Manifest, type Prereg } from '../runner/run.ts';
import { INSTALLER_BLOCK_BEGIN, type InstallFile, type InstallManifest } from '../gbrain/build-install.ts';
import type { InstallViewManifest } from '../runner/trial/gbrain.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { factFor, postedAt, RETRYABLE_CODES } from '../world/services/gbrain-ingest.ts';
import { describeCall, parseRpcBody } from '../world/services/gbrain-tap.ts';
import { startGbrainSidecar } from '../runner/trial/gbrain.ts';
import type { Member, Message, World } from '../world/types.ts';

const ROOT = resolve(import.meta.dir, '..');
export const GBRAIN_REMOTE = 'https://github.com/garrytan/gbrain';
export const DEFAULT_BASELINE = join('scripts', 'gbrain-check.baseline.json');
export const TOLD_PREAMBLE = 'tasks/multiuser/_shared/preamble.gbrain-ladder.md';
export const UNTOLD_PREAMBLE = 'tasks/multiuser/_shared/preamble.md';
export const DEFAULT_MODEL = 'anthropic:claude-haiku-5-5';
/** A dev page the bot-visible brain holds (world/seed/world.json: channel north-random, source slug chats/north-team-random)
 *  and a query whose keyword search returns it on both surfaces at the pin. */
export const KNOWN_PAGE = { slug: 'dev/chats/north-team-random', query: 'ticket 4092' } as const;

/** The rung table of docs/gbrain-arm.md, "The install ladder": each rung is a gbrain cell configuration plus whether the
 *  told preamble applies. */
export const COMPANY_TOLD_PREAMBLE = 'tasks/multiuser/_shared/preamble.gbrain-company.md';
export const RUNGS: Record<string, { gbrain: GbrainCellConfig; told: boolean; preamble?: string }> = {
  mcp: { gbrain: { surface: 'starter' }, told: false },
  told: { gbrain: { surface: 'starter' }, told: true },
  docs: { gbrain: { surface: 'starter', install: 'gbrain-docs' }, told: false },
  installer: { gbrain: { surface: 'starter', install: 'gbrain-installer' }, told: false },
  'verbs-told': { gbrain: { surface: 'verbs' }, told: true },
  'semantic-told': { gbrain: { surface: 'starter', embeddings: 'openai:text-embedding-3-small' }, told: true },
  'docs-semantic': { gbrain: { surface: 'starter', install: 'gbrain-docs', embeddings: 'openai:text-embedding-3-small' }, told: false },
  // internal-task (gbrain#7481): the company brain under the one unscoped token, and the same brain with the tap adding the requesting
  // member's source_ids to every search and query. Both take internal-task's company told clause; the harness prompt is the same in both.
  'told-company': { gbrain: { surface: 'starter', brain: 'company' }, told: true, preamble: COMPANY_TOLD_PREAMBLE },
  'told-scoped': { gbrain: { surface: 'starter', brain: 'company', scope: 'sources' }, told: true, preamble: COMPANY_TOLD_PREAMBLE },
};

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const sh = (argv: string[], o: { cwd?: string; timeoutMs?: number } = {}) =>
  spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: o.cwd, timeout: o.timeoutMs ?? 600_000 });

// ---- --gbrain resolution -----------------------------------------------------------------------------------------------

export interface ResolvedRef { input: string; sha: string; kind: 'sha' | 'abbreviated-sha' | 'branch' | 'tag' | 'path'; ref: string | null }

export function parseLsRemote(text: string): Array<{ sha: string; ref: string }> {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [sha, ref] = l.split(/\s+/); return { sha: sha ?? '', ref: ref ?? '' }; }).filter((r) => /^[0-9a-f]{40}$/.test(r.sha) && r.ref);
}

/** A branch or tag name against ls-remote lines: refs/heads/<name>, then the peeled refs/tags/<name>^{} (an annotated tag's
 *  commit), then refs/tags/<name> (a lightweight tag), then an exact ref path. */
export function resolveFromRefs(name: string, refs: Array<{ sha: string; ref: string }>): { sha: string; kind: 'branch' | 'tag'; ref: string } | null {
  const find = (ref: string) => refs.find((r) => r.ref === ref);
  const head = find(`refs/heads/${name}`);
  if (head) return { sha: head.sha, kind: 'branch', ref: head.ref };
  const peeled = find(`refs/tags/${name}^{}`);
  if (peeled) return { sha: peeled.sha, kind: 'tag', ref: `refs/tags/${name}` };
  const tag = find(`refs/tags/${name}`);
  if (tag) return { sha: tag.sha, kind: 'tag', ref: tag.ref };
  if (name.startsWith('refs/')) {
    const exact = find(`${name}^{}`) ?? find(name);
    if (exact) return { sha: exact.sha, kind: name.startsWith('refs/tags/') ? 'tag' : 'branch', ref: name };
  }
  return null;
}

export interface ResolveOptions {
  remote?: string;
  /** Scratch directory for the treeless clone that expands an abbreviated sha no ref points at. */
  scratch?: string;
  /** Tests replace the two git calls; the defaults shell out to git. */
  lsRemote?: (remote: string) => string;
  expandSha?: (remote: string, abbreviated: string, scratch: string) => string | null;
}

export function gitLsRemote(remote: string): string {
  const r = sh(['git', 'ls-remote', remote], { timeoutMs: 120_000 });
  if (r.status !== 0) throw new RunnerError('HE-GBRAIN-009', `git ls-remote ${remote} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout;
}

/** Expand an abbreviated sha through a bare, treeless clone (commits only) and rev-parse; null when git cannot. */
export function gitExpandSha(remote: string, abbreviated: string, scratch: string): string | null {
  const dir = join(scratch, 'gbrain-refs.git');
  if (!existsSync(dir)) {
    mkdirSync(scratch, { recursive: true });
    const c = sh(['git', '-c', 'uploadpack.allowFilter=true', 'clone', '--quiet', '--bare', '--no-local', '--filter=tree:0', remote, dir], { timeoutMs: 300_000 });
    if (c.status !== 0) return null;
  }
  const r = sh(['git', '-C', dir, 'rev-parse', '--verify', '--quiet', `${abbreviated}^{commit}`]);
  return r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout.trim()) ? r.stdout.trim() : null;
}

export function resolveGbrainRef(input: string, o: ResolveOptions = {}): ResolvedRef {
  const remote = o.remote ?? GBRAIN_REMOTE;
  const lsRemote = o.lsRemote ?? gitLsRemote;
  const expand = o.expandSha ?? gitExpandSha;
  const value = input.trim();
  if (!value) throw new RunnerError('HE-GBRAIN-009', 'missing --gbrain <sha | branch | tag | path>');
  if (/^[0-9a-f]{40}$/.test(value)) return { input, sha: value, kind: 'sha', ref: null };
  if (existsSync(value) && statSync(value).isDirectory()) {
    const head = sh(['git', '-C', value, 'rev-parse', '--verify', 'HEAD']);
    if (head.status !== 0) throw new RunnerError('HE-GBRAIN-009', `${value} is a directory but not a git checkout (${(head.stderr || '').trim().slice(0, 200)}); fix: pass a gbrain checkout, a sha, a branch or a tag`);
    const dirty = sh(['git', '-C', value, 'status', '--porcelain']).stdout.trim();
    if (dirty) throw new RunnerError('HE-GBRAIN-009', `${value} has uncommitted changes (${dirty.split('\n').length} path(s)); the sidecar image is built from a commit fetched from ${remote}, so commit and push first, or pass the sha of the commit to check`);
    return { input, sha: head.stdout.trim(), kind: 'path', ref: null };
  }
  const listing = lsRemote(remote);
  const refs = parseLsRemote(listing);
  const excerpt = () => `git ls-remote ${remote} lists ${refs.length} refs:\n${listing.trim().split('\n').slice(0, 20).join('\n')}${refs.length > 20 ? '\n...' : ''}`;
  if (/^[0-9a-f]{7,39}$/.test(value)) {
    const prefixed = [...new Set(refs.filter((r) => r.sha.startsWith(value)).map((r) => r.sha))];
    if (prefixed.length === 1) return { input, sha: prefixed[0]!, kind: 'abbreviated-sha', ref: null };
    if (prefixed.length > 1) throw new RunnerError('HE-GBRAIN-009', `--gbrain ${value} is ambiguous on ${remote}: ${prefixed.join(', ')}; fix: pass more characters`);
    const full = expand(remote, value, o.scratch ?? join(ROOT, 'results', 'gbrain-check', '.refs'));
    if (full) return { input, sha: full, kind: 'abbreviated-sha', ref: null };
    throw new RunnerError('HE-GBRAIN-009', `--gbrain ${value} names no commit on ${remote} (no ref starts with it and a treeless clone cannot expand it); fix: pass a full sha, a branch or a tag. ${excerpt()}`);
  }
  const hit = resolveFromRefs(value, refs);
  if (hit) return { input, sha: hit.sha, kind: hit.kind, ref: hit.ref };
  throw new RunnerError('HE-GBRAIN-009', `--gbrain ${JSON.stringify(value)} is not a sha, a branch, a tag or a local checkout; fix: pass one of those. ${excerpt()}`);
}

export const imageTagFor = (sha: string) => `harness-eval/gbrain:check-${sha.slice(0, 12)}`;

// ---- the scratch run directory and preregistration ----------------------------------------------------------------------

/** results/gbrain-check/<ts>/ unless GBRAIN_CHECK_DIR (or the argument) names another; docs/benchmarks/ is refused because
 *  that tree holds counted runs and the preregistration order check reads it (HE-GBRAIN-010). */
export function checkDir(explicit: string | undefined, ts: string, root = ROOT): string {
  const dir = resolve(root, explicit ?? join('results', 'gbrain-check', ts));
  const rel = relative(root, dir);
  if (rel === 'docs/benchmarks' || rel.startsWith('docs/benchmarks/') || /(^|\/)docs\/benchmarks(\/|$)/.test(dir)) throw new RunnerError('HE-GBRAIN-010', `${dir} is under docs/benchmarks/, which holds counted runs and their receipts; the check's scratch run goes under results/gbrain-check/ (GBRAIN_CHECK_DIR names another place outside docs/benchmarks/)`);
  return dir;
}

export const timestamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** The short model label in a cell id: anthropic:claude-haiku-5-5 -> haiku. */
export function modelLabel(model: string): string {
  const name = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model;
  return name.replace(/^claude-/, '').split('-')[0] || name;
}

export interface PaidCells { cells: Cell[]; skipped: string[] }

/** The dev tasks the paid check runs: every multi-user dev task of the v0.1 set except the product probes (family
 *  `product_probe`, internal-task's QM probes, which test one product's claim and are not harness-neutral); listed explicitly in
 *  the cell so the task set is part of the fingerprint and a task added to the directory later does not change a check. */
export function devCheckTasks(root = ROOT): string[] {
  const dir = join(root, 'tasks', 'multiuser', 'dev');
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'task.toml')) && !/^family\s*=\s*"product_probe"/m.test(readFileSync(join(dir, d, 'task.toml'), 'utf8'))).sort();
}

/** One cell per harness and rung on the dev split. A told rung needs the ladder's told preamble; when it is absent the rung is
 *  skipped with a message instead of silently running untold. */
export function paidCells(harnesses: string[], rungs: string[], o: { model?: string; reps?: number; toldPreamble?: string; root?: string } = {}): PaidCells {
  const model = o.model ?? DEFAULT_MODEL;
  const reps = o.reps ?? 2;
  const told = o.toldPreamble ?? TOLD_PREAMBLE;
  const toldPresent = existsSync(resolve(o.root ?? ROOT, told));
  const tasks = devCheckTasks(o.root ?? ROOT);
  const cells: Cell[] = [];
  const skipped: string[] = [];
  for (const rung of rungs) {
    const spec = RUNGS[rung];
    if (!spec) throw new RunnerError('HE-RUN-002', `--rungs names ${JSON.stringify(rung)}; the rungs are ${Object.keys(RUNGS).join(', ')} (docs/gbrain-arm.md, "The install ladder")`);
    const preamble = spec.preamble ?? told;
    if (spec.told && !(spec.preamble ? existsSync(resolve(o.root ?? ROOT, spec.preamble)) : toldPresent)) { skipped.push(`rung ${rung} skipped: the told preamble ${preamble} is not in this checkout (the ladder's preregistration PR adds it); the untold rungs run`); continue; }
    for (const harness of harnesses) {
      cells.push({ id: `${harness}-${modelLabel(model)}-gbrain-${rung}`, harness, model, slice: 'multiuser', split: 'dev', repetitions: reps, ceiling: { input_tokens: 80_000, output_tokens: 6_000 }, tasks, gbrain: spec.gbrain, ...(spec.told ? { preamble } : {}) });
    }
  }
  return { cells, skipped };
}

export function scratchPrereg(o: { runId: string; cells: Cell[]; spendCapUsd: number; gbrainSha: string; rungs: string[]; harnesses: string[] }): Prereg {
  return {
    schema_version: 1,
    run_id: o.runId,
    question: `UNCOUNTED gbrain-check of gbrain ${o.gbrainSha} on the dev split: does the ${o.rungs.join(', ')} rung behave on ${o.harnesses.join(' and ')} as the baseline recorded (discovered, used, calls per trial, cross-scope reads via gbrain; pass informational)? A scratch preregistration written by scripts/gbrain-check.ts; not a benchmark result and never cited as one.`,
    tasks: {},
    cells: o.cells,
    wall_clock_s: { multiuser: 1500 },
    spend_cap_usd: o.spendCapUsd,
    drop_order: [],
    minimum_v01: [],
  };
}

// ---- keyless assertions ---------------------------------------------------------------------------------------------------

export interface PinSurfaces { surfaces: Record<string, { tools: number; search_tool: string; names?: string[] }> }

export interface SurfaceEvidence {
  surface: 'starter' | 'verbs';
  /** The direct probe of the image on this surface: healthy with a tool list, or not. */
  healthy: boolean;
  ready_ms: number | null;
  version: string | null;
  tools: string[];
  /** The fake-harness trial through the runner and the tap on this surface. */
  trial: null | {
    termination: string;
    exits: number[];
    error?: string;
    sidecar_ready_ms: number;
    events_file: string;
    /** The tap's gbrain.tools/list event count, when one was recorded. */
    list_count: number | null;
    /** The retrieval event (gbrain.search on starter, gbrain.recall on verbs): outcome, the tap's error class and the pages. */
    retrieval: null | { tool: string; outcome: string; error: string | null; pages: string[] };
  };
}

export interface ViewEvidence {
  harness: 'openclaw' | 'hermes';
  split: 'dev' | 'heldout';
  /** The view's install kind; absent means gbrain-docs. */
  install?: 'gbrain-docs' | 'gbrain-installer';
  dir: string;
  manifest: InstallViewManifest | null;
  /** The HE-GBRAIN-006 line when the export or its verification failed. */
  error: string | null;
  /** Hermes: the exported .hermes.md's size in bytes. */
  context_bytes: number | null;
}

/** internal-task: the gbrain-installer view per harness, when the image's gbrain commit has the setup target; otherwise the bundle
 *  manifest's reason, reported and not failed (every gbrain before #7489 has none). */
export interface InstallerEvidence {
  harness: 'openclaw' | 'hermes';
  available: boolean;
  /** The bundle manifest's unavailable reason, gbrain's own words. */
  reason: string | null;
  dir: string;
  manifest: InstallViewManifest | null;
  error: string | null;
  /** Every exported instruction file holds the brain-first block marker; null when nothing was exported. */
  block_present: boolean | null;
  /** gbrain#7489 at 10949a15: the per-turn hook the bundle records, and which hook files hold the rule text (OpenClaw's index.js, Hermes's config.yaml and allowlist); null without a hook. */
  hook?: { files: string[]; action: string; rule_files: string[]; commands: number } | null;
}

export interface ReadyInstall { dir: string; split: string; files: number; writable: boolean }

/** internal-task (gbrain#7481): the scope "sources" evidence. The direct probe searches and queries the dev company brain once per member
 *  and query under that member's source_ids; the fake trial runs two members through the runner and the tap on the same query. */
export interface ScopedEvidence {
  probe: null | { members: number; calls: number; rows: number; sources_seen: number; outside: Array<{ member: string; tool: string; query: string; slug: string; source_id: string }>; denied: Array<{ member: string; source_id: string; code: string | null }>; foreign: Array<{ member: string; source_id: string; rows_from_it: boolean | null }>; differs: boolean };
  probe_error: string | null;
  /** member -> granted source ids, from the trial's gbrain/manifest.json. */
  grants: Record<string, string[]> | null;
  trial: null | {
    termination: string; error?: string; events_file: string;
    calls: Array<{ actor: string | null; grant: string | null; tool: string; outcome: string; error: string | null; source_ids: string[] | null; source_ids_requested: string[] | null; sources: string[]; pages: string[] }>;
  };
}

/** internal-task: the live-ingestion evidence. The fake trial runs the member brain with live ingestion: a member gives the bot an
 *  instruction in a DM on turn 1, another member searches for it from a channel on turn 2, the first member searches again on turn
 *  3; every fact a search returned maps through the gbrain.ingest event that wrote it to the conversation it came from. */
export interface IngestEvidence {
  code_word: string;
  dm_member: string;
  other_member: string;
  /** member -> granted source ids, from the trial's gbrain/manifest.json. */
  grants: Record<string, string[]> | null;
  trial: null | {
    termination: string; error?: string; events_file: string;
    writes: Array<{ seq: number; channel: string; author: string | null; source: string; outcome: string; error: string | null; fact_id: string | number | null; latency_ms: number | null; skipped: string | null }>;
    searches: Array<{ seq: number; grant: string | null; tool: string; outcome: string; error: string | null; facts: Array<{ id: string | number | null; fact: string; source_id: string | null }>; pages: string[] }>;
  };
}

export interface KeylessEvidence {
  image: string;
  pin: PinSurfaces;
  known: { slug: string; query: string };
  surfaces: SurfaceEvidence[];
  /** The image's /install/manifest.json: the bundle digest and every file. */
  bundle: Pick<InstallManifest, 'digest' | 'files'> | null;
  views: ViewEvidence[];
  /** internal-task: the installer view per harness; absent in evidence written before the installer rung. */
  installer?: InstallerEvidence[];
  /** internal-task (gbrain#7481): the scope "sources" probe and trial; absent in evidence written before the told-scoped rung. */
  scoped?: ScopedEvidence;
  /** internal-task: the live-ingestion trial on the member brain; absent in evidence written before it. */
  ingest?: IngestEvidence;
  /** The gbrain-docs trial on the fake harness (it takes the OpenClaw dev view). */
  docs: null | { termination: string; error?: string; install_bundle: TrialGbrainInstall | undefined; ready_install: ReadyInstall | null; expected_view_digest: string | null; expected_files: number | null };
}

/** The view digest export-install.sh computes: sha256 over "<path> <sha256>\n" of the bundle files in the view, in path order. */
export function viewDigestFromBundle(files: InstallFile[], harness: string, split: string, install: 'gbrain-docs' | 'gbrain-installer' = 'gbrain-docs'): string {
  const mine = files.filter((f) => install === 'gbrain-installer' ? f.path.startsWith(`${harness}/installer/`) : f.path.startsWith(`${harness}/workspace/`) || (harness === 'hermes' && f.path === `hermes/${split}/.hermes.md`)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(mine.map((f) => `${f.path} ${f.sha256}\n`).join(''));
}

/** Every assertion of the keyless mode over the evidence, as `HE-GBRAIN-008 <where> <check>: expected <x>, actual <y> (<file>)`
 *  lines; pin_diffs are the tool count differences, failures only under strictPins. */
export function keylessAssertions(e: KeylessEvidence, o: { strictPins?: boolean; expectHook?: boolean } = {}): { failures: string[]; passed: string[]; pin_diffs: string[] } {
  const failures: string[] = [];
  const passed: string[] = [];
  const pin_diffs: string[] = [];
  const fail = (where: string, check: string, expected: unknown, actual: unknown, file: string) => failures.push(`HE-GBRAIN-008 ${where} ${check}: expected ${String(expected)}, actual ${String(actual)} (${file})`);
  const ok = (line: string) => passed.push(`ok ${line}`);
  for (const s of e.surfaces) {
    const where = `surface=${s.surface}`;
    const file = s.trial?.events_file ?? `probe of ${e.image}`;
    if (!s.healthy) { fail(where, 'sidecar health', '/health ok with a tool list', 'no healthy sidecar', file); continue; }
    ok(`${where} sidecar healthy (gbrain ${s.version ?? 'unknown'}) ready in ${s.ready_ms ?? '?'} ms`);
    const pin = e.pin.surfaces[s.surface];
    if (!pin) { fail(where, 'pin', `gbrain/pin.json surfaces.${s.surface}`, 'absent', 'gbrain/pin.json'); continue; }
    if (s.tools.length !== pin.tools) {
      pin_diffs.push(`${where} tool count ${s.tools.length} differs from gbrain/pin.json ${pin.tools}${pin.names ? `; missing ${pin.names.filter((n) => !s.tools.includes(n)).join(', ') || 'none'}, extra ${s.tools.filter((n) => !pin.names!.includes(n)).join(', ') || 'none'}` : ''}`);
      if (o.strictPins) fail(where, 'tool count (--strict-pins)', pin.tools, s.tools.length, 'gbrain/pin.json');
    } else ok(`${where} ${s.tools.length} tools (pin ${pin.tools})`);
    if (!s.tools.includes(pin.search_tool)) fail(where, `search tool ${pin.search_tool} present`, 'present', `absent from ${s.tools.length} tools`, 'gbrain/pin.json');
    else ok(`${where} search tool ${pin.search_tool} present`);
    for (const n of pin.names ?? []) if (!s.tools.includes(n)) fail(where, `tool ${n} present`, 'present', 'absent', 'gbrain/pin.json');
    if (pin.names && pin.names.every((n) => s.tools.includes(n))) ok(`${where} every pinned name present (${pin.names.join(', ')})`);
    if (!s.trial) { fail(where, 'fake trial through the runner', 'a recorded trial', 'none', file); continue; }
    const t = s.trial;
    if (t.termination !== 'completed' || t.exits.some((x) => x !== 0)) fail(where, 'trial termination', 'completed, every turn exit 0', `${t.termination}, exits ${JSON.stringify(t.exits)}${t.error ? `, ${t.error}` : ''}`, file);
    else ok(`${where} trial completed (sidecar ready in ${t.sidecar_ready_ms} ms)`);
    if (t.list_count === null) fail(where, 'tools/list through the tap', 'one gbrain.tools/list event', 'none', file);
    else if (t.list_count !== s.tools.length) fail(where, 'tools/list through the tap', `${s.tools.length} tools (the direct probe)`, t.list_count, file);
    else ok(`${where} tools/list through the tap counts ${t.list_count}`);
    if (!t.retrieval) fail(where, `retrieval of ${e.known.slug}`, `one gbrain.${pin.search_tool} event`, 'no retrieval event', file);
    else {
      const r = t.retrieval;
      if (r.tool !== `gbrain.${pin.search_tool}`) fail(where, 'retrieval tool', `gbrain.${pin.search_tool}`, r.tool, file);
      if (r.outcome !== 'ok') fail(where, `retrieval ${r.tool} outcome`, 'ok (no RPC error, no isError)', `${r.outcome}${r.error ? ` (${r.error})` : ''}`, file);
      else if (!r.pages.includes(e.known.slug)) fail(where, `retrieval ${r.tool} effect.pages for ${JSON.stringify(e.known.query)}`, `contains ${e.known.slug}`, r.pages.length ? r.pages.join(', ') : 'no pages', file);
      else ok(`${where} ${r.tool} for ${JSON.stringify(e.known.query)} returned ${e.known.slug} (${r.pages.length} page(s))`);
    }
  }
  if (!e.bundle) fail('bundle', 'image /install/manifest.json', 'a bundle manifest with a digest', 'none', e.image);
  for (const v of e.views) {
    const where = `view=${v.harness}/${v.split}`;
    const file = join(v.dir, 'manifest.json');
    if (!v.manifest) { fail(where, 'export and verify', 'every file present with its sha256', v.error ?? 'no manifest', file); continue; }
    if (e.bundle) {
      const expected = viewDigestFromBundle(e.bundle.files, v.harness, v.split);
      const bySource = new Map(e.bundle.files.map((f) => [f.path, f.sha256]));
      const drift = v.manifest.files.filter((f) => bySource.get(f.source_path) !== f.sha256);
      if (v.manifest.bundle_digest !== e.bundle.digest) fail(where, 'bundle digest', e.bundle.digest.slice(0, 12), v.manifest.bundle_digest.slice(0, 12), file);
      if (v.manifest.view_digest !== expected) fail(where, 'view digest against the bundle manifest', expected.slice(0, 12), v.manifest.view_digest.slice(0, 12), file);
      if (drift.length) fail(where, 'file digests against the bundle manifest', 'every view file listed with the same sha256', `${drift.length} differ (${drift.slice(0, 3).map((f) => f.path).join(', ')})`, file);
      if (v.manifest.bundle_digest === e.bundle.digest && v.manifest.view_digest === expected && !drift.length) ok(`${where} ${v.manifest.files.length} files, view digest ${v.manifest.view_digest.slice(0, 12)} matches the bundle manifest (${v.manifest.skills} skills)`);
    }
    if (v.harness === 'hermes') {
      const kept = v.manifest.context?.kept_slugs.length ?? 0;
      if (!v.context_bytes) fail(where, '.hermes.md', 'a non-empty compiled context', `${v.context_bytes ?? 'missing'} bytes`, join(v.dir, '.hermes.md'));
      else if (!kept) fail(where, '.hermes.md kept slugs', 'at least one kept page slug', 0, file);
      else ok(`${where} .hermes.md ${v.context_bytes} bytes, ${kept} kept slugs`);
    }
  }
  for (const i of e.installer ?? []) {
    const where = `installer=${i.harness}`;
    const file = join(i.dir, 'manifest.json');
    if (!i.available) { ok(`${where} not in this gbrain commit (${i.reason ?? 'no reason recorded'}); the installer rung needs gbrain#7489 or later`); continue; }
    if (!i.manifest) { fail(where, 'export and verify', 'every file present with its sha256', i.error ?? 'no manifest', file); continue; }
    if (e.bundle) {
      const expected = viewDigestFromBundle(e.bundle.files, i.harness, 'dev', 'gbrain-installer');
      const bySource = new Map(e.bundle.files.map((f) => [f.path, f.sha256]));
      const drift = i.manifest.files.filter((f) => bySource.get(f.source_path) !== f.sha256);
      if (i.manifest.view_digest !== expected) fail(where, 'view digest against the bundle manifest', expected.slice(0, 12), i.manifest.view_digest.slice(0, 12), file);
      if (drift.length) fail(where, 'file digests against the bundle manifest', 'every view file listed with the same sha256', `${drift.length} differ (${drift.slice(0, 3).map((f) => f.path).join(', ')})`, file);
    }
    if (!i.manifest.files.length) fail(where, 'installer files', 'at least one file written by gbrain setup', 0, file);
    if (i.block_present === false) fail(where, 'brain-first block', `every installer instruction file holds ${INSTALLER_BLOCK_BEGIN}`, 'a file without it', i.dir);
    if (i.hook) {
      const ruleOk = i.hook.rule_files.length > 0;
      if (!ruleOk) fail(where, 'per-turn hook files', 'a hook file holding the rule text', `none of ${i.hook.files.join(', ')}`, i.dir);
      if (i.harness === 'openclaw' && i.hook.commands !== 3) fail(where, 'per-turn hook install commands', 'the three openclaw commands', i.hook.commands, join(i.dir, 'manifest.json'));
      if (ruleOk && (i.harness !== 'openclaw' || i.hook.commands === 3)) ok(`${where} per-turn hook ${i.hook.action}: ${i.hook.files.length} files, the rule in ${i.hook.rule_files.join(', ')}${i.harness === 'openclaw' ? ', three install commands printed' : ''}`);
    } else if (o.expectHook) fail(where, 'per-turn hook (--expect-hook)', 'installer.turn_hook in the bundle manifest', 'none (the block-only installer)', file);
    else ok(`${where} no per-turn hook in this gbrain commit (the block-only installer)`);
    const rec = i.manifest.installer && 'files' in i.manifest.installer ? i.manifest.installer : null;
    if (i.harness === 'hermes' && !rec?.seed) fail(where, 'Hermes SOUL.md seed', 'recorded (sha256, bytes, hermes commit)', 'absent', file);
    if (i.manifest.files.length && i.block_present && (i.harness !== 'hermes' || rec?.seed)) ok(`${where} ${i.manifest.files.map((f) => f.path).join(', ')} (block ${rec?.block_version ?? 'version unknown'}), view digest ${i.manifest.view_digest.slice(0, 12)} matches the bundle manifest${rec?.seed ? `; home seeded with Hermes SOUL.md ${rec.seed.sha256.slice(0, 12)} (${rec.seed.bytes} bytes)` : ''}`);
  }
  if (e.scoped) {
    const s = e.scoped;
    const where = 'scoped=company/dev';
    if (!s.probe) fail(where, 'source_ids probe of the company brain', 'one search and one query per member and query under that member\'s grant', s.probe_error ?? 'no probe', e.image);
    else {
      const p = s.probe;
      const notDenied = p.denied.filter((d) => d.code !== 'permission_denied');
      if (p.outside.length) fail(where, 'rows outside the requester\'s grant under source_ids', 'none', `${p.outside.length} (${p.outside.slice(0, 3).map((o) => `${o.member} ${o.tool} ${JSON.stringify(o.query)} -> ${o.slug} in ${o.source_id}`).join('; ')})`, e.image);
      if (notDenied.length) fail(where, 'a source_ids list naming a source no connection holds', 'permission_denied for every member', notDenied.map((d) => `${d.code ?? 'rows'} for ${d.member}/${d.source_id}`).slice(0, 3).join(', '), e.image);
      if (!p.rows) fail(where, 'rows under source_ids', 'some', 0, e.image);
      else if (!p.differs) fail(where, 'narrowing observable', 'the same query answers different source sets to members with different grants', 'identical sources for every member', e.image);
      if (!p.outside.length && !notDenied.length && p.rows && p.differs) ok(`${where} ${p.members} members, ${p.calls} scoped search/query calls, ${p.rows} rows over ${p.sources_seen} sources, none outside the requester's grant; ${p.denied.length} unknown source ids all permission_denied`);
      const readable = p.foreign.filter((f) => f.rows_from_it === true).length;
      ok(`${where} under the unscoped token a source_ids list naming a federated source outside the member's grant answered rows from it for ${readable} of ${p.foreign.length} members: gbrain checks source_ids against the connection's grant, so the member narrowing is the tap's to enforce (it intersects a harness-supplied list with the grant and denies an all-foreign one)`);
    }
    if (!s.trial) fail(where, 'fake trial under scope "sources"', 'a completed trial', 'none', 'trials.jsonl');
    else if (!s.grants) fail(where, 'the trial\'s gbrain/manifest.json grants', 'present', 'absent', s.trial.events_file);
    else {
      const t = s.trial;
      const file = t.events_file;
      if (t.termination !== 'completed') fail(where, 'trial termination', 'completed', `${t.termination}${t.error ? ` (${t.error})` : ''}`, 'trials.jsonl');
      const scopedCalls = t.calls.filter((c) => c.tool === 'gbrain.search' || c.tool === 'gbrain.query');
      if (scopedCalls.length < 4) fail(where, 'search and query events through the tap', 'at least 4 (two members, one denied)', scopedCalls.length, file);
      // The tap's events carry the bot as actor (the harness's world token) and the requesting member as grant.
      for (const c of scopedCalls) {
        const grant = c.grant ? s.grants[c.grant] ?? null : null;
        const label = `${c.tool} for ${c.grant ?? 'nobody'}`;
        if (c.actor !== 'assistant') fail(where, `${label} event actor`, 'assistant (the harness\'s world token)', c.actor ?? 'none', file);
        if (!grant) { fail(where, `${label} grant for the requester`, 'a source grant', c.grant ?? 'no requester', file); continue; }
        if (c.source_ids_requested) {
          if (c.outcome !== 'error' || c.error !== 'permission_denied') fail(where, `${label} naming ${c.source_ids_requested.join(', ')} outside the grant`, 'error permission_denied from the tap', `${c.outcome}${c.error ? ` (${c.error})` : ''}`, file);
          else if (c.source_ids?.length) fail(where, `${label} denied request forwarded source_ids`, 'none', c.source_ids.join(', '), file);
          else ok(`${where} ${label} naming ${c.source_ids_requested.join(', ')} (outside the grant) was answered permission_denied by the tap`);
          continue;
        }
        const sorted = (a: string[]) => [...a].sort().join(',');
        if (!c.source_ids || sorted(c.source_ids) !== sorted(grant)) fail(where, `${label} args.source_ids`, `the ${grant.length} sources of ${c.grant}'s grant`, c.source_ids ? `${c.source_ids.length} ids` : 'absent', file);
        const outside = c.sources.filter((src) => !grant.includes(src));
        if (c.outcome !== 'ok') fail(where, `${label} outcome`, 'ok', `${c.outcome}${c.error ? ` (${c.error})` : ''}`, file);
        else if (outside.length) fail(where, `${label} returned sources`, `inside ${c.grant}'s grant`, `${outside.join(', ')} outside`, file);
        else ok(`${where} ${label} carried ${c.source_ids!.length} source_ids and returned ${c.pages.length} page(s) from ${c.sources.length} source(s), all inside the grant`);
      }
      const known = e.known.slug;
      const knownSource = 'channel-north-random';
      const grants = s.grants;
      const reader = scopedCalls.find((c) => c.tool === 'gbrain.search' && !c.source_ids_requested && c.grant && (grants[c.grant] ?? []).includes(knownSource));
      const nonReader = scopedCalls.find((c) => c.tool === 'gbrain.search' && !c.source_ids_requested && c.grant && grants[c.grant] && !grants[c.grant]!.includes(knownSource));
      if (!reader || !nonReader) fail(where, 'a reader and a non-reader of the known page both searched', 'one each', `${reader ? 'reader' : 'no reader'}, ${nonReader ? 'non-reader' : 'no non-reader'}`, file);
      else {
        if (!reader.pages.includes(known)) fail(where, `${reader.grant}'s search for ${JSON.stringify(e.known.query)}`, `returns ${known} (in the grant)`, reader.pages.length ? reader.pages.join(', ') : 'no pages', file);
        if (nonReader.pages.includes(known)) fail(where, `${nonReader.grant}'s search for ${JSON.stringify(e.known.query)}`, `never returns ${known} (outside the grant)`, 'returned it', file);
        if (reader.pages.includes(known) && !nonReader.pages.includes(known)) ok(`${where} the same query returned ${known} to ${reader.grant} and not to ${nonReader.grant}`);
      }
    }
  }
  if (e.ingest) {
    const g = e.ingest;
    const where = 'ingest=member/dev';
    if (!g.trial) fail(where, 'fake trial under brain member, scope member, ingest live', 'a completed trial', 'none', 'trials.jsonl');
    else if (!g.grants) fail(where, 'the trial\'s gbrain/manifest.json grants', 'present', 'absent', g.trial.events_file);
    else {
      const t = g.trial;
      const file = t.events_file;
      const grants = g.grants;
      if (t.termination !== 'completed') fail(where, 'trial termination', 'completed', `${t.termination}${t.error ? ` (${t.error})` : ''}`, 'trials.jsonl');
      const failed = t.writes.filter((w) => w.outcome !== 'ok');
      const skipped = t.writes.filter((w) => w.outcome === 'ok' && w.skipped !== null);
      const written = t.writes.filter((w) => w.outcome === 'ok' && w.skipped === null);
      // Three actor messages and three replies at least; every one lands as a committed fact with an id.
      if (t.writes.length < 6) fail(where, 'gbrain.ingest events', 'at least 6 (three actor messages and three replies)', t.writes.length, file);
      if (failed.length) fail(where, 'ingest writes', 'every write ok', `${failed.length} failed (${failed.slice(0, 3).map((w) => `${w.source || 'no source'}: ${w.error ?? w.outcome}`).join('; ')})`, file);
      if (skipped.length) fail(where, 'ingest routing', 'a source for every conversation of the check task', `${skipped.length} skipped (${skipped.slice(0, 3).map((w) => w.skipped).join('; ')})`, file);
      if (written.some((w) => w.fact_id === null)) fail(where, 'ingest fact ids', 'an id on every ok write', 'a write without one', file);
      const latencies = written.map((w) => w.latency_ms ?? 0).sort((a, b) => a - b);
      const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
      if (t.writes.length >= 6 && !failed.length && !skipped.length && !written.some((w) => w.fact_id === null)) ok(`${where} ${written.length} messages ingested as facts into ${new Set(written.map((w) => w.source)).size} sources, median ${median} ms per write, slowest ${latencies[latencies.length - 1]} ms`);
      const dmSource = `private-${g.dm_member}`;
      const dmWrite = written.find((w) => w.source === dmSource && w.author === g.dm_member);
      if (!dmWrite) fail(where, `the turn-1 DM ingested into ${dmSource}`, 'one ok write by the member into that source', written.filter((w) => w.author === g.dm_member).map((w) => w.source).join(', ') || 'no write by the member', file);
      else ok(`${where} the turn-1 DM landed in ${dmSource} as fact #${dmWrite.fact_id}`);
      const bySeq = new Map(written.filter((w) => w.fact_id !== null).map((w) => [String(w.fact_id), w]));
      const turn1 = dmWrite ? String(dmWrite.fact_id) : null;
      // The positive control for the other member: their own turn-2 marker, ingested into their channel before the turn, must
      // come back, or an empty reply (a broken tap, a token without saved facts) would pass as "no leak".
      const otherMarker = written.find((w) => w.author === g.other_member && w.source !== dmSource);
      const sources = (s: { facts: Array<{ id: string | number | null }> }) => [...new Set(s.facts.map((f) => bySeq.get(String(f.id))?.source ?? 'unmapped'))].join(', ') || 'no source';
      // internal-task: search answers facts in its saved-facts block, query as fact rows (its facts arm); both must route the same way.
      for (const tool of ['gbrain.search', 'gbrain.query', 'gbrain.recall'] as const) {
        const verb = tool.slice('gbrain.'.length);
        const other = t.searches.find((s) => s.tool === tool && s.grant === g.other_member);
        const same = t.searches.find((s) => s.tool === tool && s.grant === g.dm_member);
        if (!other || !same) { fail(where, `a ${verb} by the member and by another member through the tap`, 'one each', `${same ? 'member' : `no member ${verb}`}, ${other ? 'other' : `no other ${verb}`}`, file); continue; }
        for (const s of [other, same]) {
          const label = `${verb} for ${JSON.stringify(g.code_word)} as ${s.grant}`;
          if (s.outcome !== 'ok') { fail(where, `${label} outcome`, 'ok', `${s.outcome}${s.error ? ` (${s.error})` : ''}`, file); continue; }
          const grant = grants[s.grant!] ?? [];
          const unmapped = s.facts.filter((f) => f.id === null || !bySeq.has(String(f.id)));
          const outside = s.facts.filter((f) => f.id !== null && bySeq.has(String(f.id)) && !grant.includes(bySeq.get(String(f.id))!.source));
          if (unmapped.length) fail(where, `${label} facts mapped to ingest events`, 'every fact id written this trial', `${unmapped.length} unmapped (${unmapped.slice(0, 2).map((f) => f.id === null ? 'no id' : `#${f.id}`).join(', ')})`, file);
          if (outside.length) fail(where, `${label} fact sources`, `inside ${s.grant}'s grant`, outside.map((f) => `#${f.id} from ${bySeq.get(String(f.id))!.source}`).join(', '), file);
        }
        // The turn-1 DM itself (by fact id), not the searcher's own marker message in the same source.
        const sameHit = same.facts.find((f) => f.id !== null && String(f.id) === turn1 && f.fact.includes(g.code_word));
        const otherDm = other.facts.filter((f) => f.id !== null && bySeq.get(String(f.id))?.source === dmSource);
        const otherHit = otherMarker ? other.facts.find((f) => f.id !== null && String(f.id) === String(otherMarker.fact_id)) : undefined;
        if (same.outcome === 'ok' && turn1 && !sameHit) fail(where, `${g.dm_member}'s turn-3 ${verb}`, `fact #${turn1} (the turn-1 DM, holding the code word)`, same.facts.length ? `${same.facts.length} fact(s): ${same.facts.map((f) => `#${f.id}`).join(', ')} from ${sources(same)}` : 'no facts', file);
        if (other.outcome === 'ok' && otherDm.length) fail(where, `${g.other_member}'s turn-2 ${verb}`, `no fact from ${dmSource}`, `${otherDm.length} (${otherDm.map((f) => `#${f.id}`).join(', ')})`, file);
        if (other.outcome === 'ok' && !otherHit) fail(where, `${g.other_member}'s turn-2 ${verb} (positive control)`, otherMarker ? `fact #${otherMarker.fact_id} (their own turn-2 message in ${otherMarker.source})` : `an ingested message by ${g.other_member}`, other.facts.length ? `${other.facts.length} fact(s): ${other.facts.map((f) => `#${f.id}`).join(', ')} from ${sources(other)}` : 'no facts', file);
        if (same.outcome === 'ok' && other.outcome === 'ok' && sameHit && otherHit && !otherDm.length) ok(`${where} ${verb}: the turn-1 DM (fact #${turn1}) came back to ${g.dm_member} on turn 3 (${same.facts.length} fact(s) from ${sources(same)}) and not to ${g.other_member} on turn 2 (${other.facts.length} fact(s) from ${sources(other)}, their own fact #${otherMarker!.fact_id} among them)`);
      }
    }
  }
  if (e.docs) {
    const d = e.docs;
    const where = 'docs=fake/dev';
    if (d.termination !== 'completed') fail(where, 'gbrain-docs trial termination', 'completed', `${d.termination}${d.error ? ` (${d.error})` : ''}`, 'trials.jsonl');
    if (!d.install_bundle) fail(where, 'record gbrain.install_bundle', 'present', 'absent', 'trials.jsonl');
    else if (d.expected_view_digest && d.install_bundle.view_digest !== d.expected_view_digest) fail(where, 'record view digest', d.expected_view_digest.slice(0, 12), d.install_bundle.view_digest.slice(0, 12), 'trials.jsonl');
    else ok(`${where} record carries install_bundle ${d.install_bundle.harness}/${d.install_bundle.split}, ${d.install_bundle.files} files, view digest ${d.install_bundle.view_digest.slice(0, 12)}`);
    if (!d.ready_install) fail(where, 'adapter ready gbrain_install', '{dir: /he-gbrain-install, writable: false}', 'absent', 'logs/ready');
    else {
      const wantFiles = d.expected_files === null ? null : d.expected_files + 1;
      if (d.ready_install.dir !== '/he-gbrain-install' || d.ready_install.writable || d.ready_install.split !== 'dev' || (wantFiles !== null && d.ready_install.files !== wantFiles)) fail(where, 'adapter ready gbrain_install', `{dir: /he-gbrain-install, split: dev, files: ${wantFiles ?? '?'} (the view plus manifest.json), writable: false}`, JSON.stringify(d.ready_install), 'logs/ready');
      else ok(`${where} mounted read-only at ${d.ready_install.dir} with ${d.ready_install.files} files`);
    }
  }
  return { failures, passed, pin_diffs };
}

// ---- the baseline and the paid summary ------------------------------------------------------------------------------------

export interface Fingerprint {
  model: string;
  /** cell id -> resolved rung configuration and the harness. */
  cells: Record<string, { harness: string; rung: string; surface: string; install: string; embeddings: string; preamble: string }>;
  /** preamble path -> sha256 of the file. */
  preambles: Record<string, string>;
  tasks: string[];
  repetitions: number;
  /** The harness-evals commit, which pins the scorer (runner/grade) and the runner together; "+dirty" when the tree had changes. */
  harness_evals_commit: string;
  harness_images: Record<string, string>;
  sharding: 'sequential';
}

export interface BaselineCell {
  harness: string;
  rung: string;
  n: number;
  excluded: number;
  pass: { passes: number; n: number; rate: number; ci95: [number, number]; by_task: Record<string, string> };
  use: { discovered: number; used: number; calls_per_trial_median: number };
  cross_scope_gbrain: number;
  usd_total: number;
  usd_median_per_trial: number;
}

export interface Baseline {
  schema_version: 1;
  written_at: string;
  run_id: string;
  gbrain: { commit: string; version: string | null };
  fingerprint: { sha256: string; fields: Fingerprint };
  cells: Record<string, BaselineCell>;
  receipts: string;
}

export type EmptyBaseline = { schema_version: 1; empty: true; note: string };

export function fingerprintSha(f: Fingerprint): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;
  return sha256(JSON.stringify(sorted(f)));
}

export function fingerprintOf(manifest: Manifest, rungOf: Record<string, string>, o: { harnessEvalsCommit: string; harnessImages: Record<string, string>; root?: string }): { sha256: string; fields: Fingerprint } {
  const cells: Fingerprint['cells'] = {};
  const preambles: Record<string, string> = {};
  for (const c of manifest.cells) {
    const g = resolveGbrain(c.gbrain ?? { surface: 'starter' });
    const preamble = c.preamble ?? UNTOLD_PREAMBLE;
    cells[c.id] = { harness: c.harness, rung: rungOf[c.id] ?? 'unknown', surface: g.surface, install: g.install, embeddings: g.embeddings, preamble };
    if (!preambles[preamble]) { const p = resolve(o.root ?? ROOT, preamble); preambles[preamble] = existsSync(p) ? sha256(readFileSync(p)) : 'missing'; }
  }
  const fields: Fingerprint = {
    model: [...new Set(manifest.cells.map((c) => c.model))].sort().join(','),
    cells, preambles,
    tasks: [...new Set(manifest.trials.map((t) => t.task))].sort(),
    repetitions: Math.max(...manifest.cells.map((c) => c.repetitions)),
    harness_evals_commit: o.harnessEvalsCommit,
    harness_images: o.harnessImages,
    sharding: 'sequential',
  };
  return { sha256: fingerprintSha(fields), fields };
}

/** The fields of two fingerprints that differ, named for the NOT_COMPARABLE line. */
export function fingerprintDiff(a: Fingerprint, b: Fingerprint): string[] {
  const out: string[] = [];
  for (const k of Object.keys(a) as Array<keyof Fingerprint>) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  return out;
}

/** Validate a baseline file's shape; an explicit empty baseline returns null (treated as "no baseline"). */
export function validateBaseline(value: unknown, path: string): Baseline | null {
  const bad = (what: string) => new RunnerError('HE-GBRAIN-010', `${path}: ${what}; the baseline is written by scripts/gbrain-check.ts --write-baseline from a complete paid run (docs/gbrain-arm.md, "Checking a gbrain commit")`);
  if (!value || typeof value !== 'object') throw bad('not a JSON object');
  const b = value as Partial<Baseline> & Partial<EmptyBaseline>;
  if (b.schema_version !== 1) throw bad(`schema_version must be 1 (got ${String(b.schema_version)})`);
  if (b.empty === true) return null;
  if (typeof b.run_id !== 'string' || typeof b.written_at !== 'string') throw bad('run_id and written_at must be strings');
  if (!b.gbrain || typeof b.gbrain.commit !== 'string' || !/^[0-9a-f]{40}$/.test(b.gbrain.commit)) throw bad('gbrain.commit must be a full sha');
  if (!b.fingerprint || typeof b.fingerprint.sha256 !== 'string' || !b.fingerprint.fields) throw bad('fingerprint.sha256 and fingerprint.fields are required');
  if (fingerprintSha(b.fingerprint.fields) !== b.fingerprint.sha256) throw bad('fingerprint.sha256 does not match fingerprint.fields');
  if (!b.cells || typeof b.cells !== 'object' || !Object.keys(b.cells).length) throw bad('cells must name at least one cell');
  for (const [id, c] of Object.entries(b.cells)) {
    if (typeof c.n !== 'number' || typeof c.excluded !== 'number') throw bad(`cells.${id}: n and excluded must be numbers`);
    if (c.excluded !== 0) throw bad(`cells.${id}: a baseline is written only from a complete run (excluded ${c.excluded})`);
    if (!c.pass || typeof c.pass.passes !== 'number' || typeof c.pass.n !== 'number' || typeof c.pass.rate !== 'number' || !Array.isArray(c.pass.ci95) || c.pass.ci95.length !== 2 || !c.pass.by_task) throw bad(`cells.${id}.pass needs passes, n, rate, ci95 [lower, upper] and by_task`);
    if (!c.use || typeof c.use.discovered !== 'number' || typeof c.use.used !== 'number' || typeof c.use.calls_per_trial_median !== 'number') throw bad(`cells.${id}.use needs discovered, used and calls_per_trial_median`);
    if (typeof c.cross_scope_gbrain !== 'number' || typeof c.usd_total !== 'number' || typeof c.usd_median_per_trial !== 'number') throw bad(`cells.${id}: cross_scope_gbrain, usd_total and usd_median_per_trial must be numbers`);
  }
  if (typeof b.receipts !== 'string') throw bad('receipts must name the results directory the baseline came from');
  return b as Baseline;
}

export function readBaseline(path: string): Baseline | null {
  if (!existsSync(path)) return null;
  return validateBaseline(JSON.parse(readFileSync(path, 'utf8')), path);
}

/** Write the baseline; an existing one is refused without force (HE-GBRAIN-010) and kept as <path>.prev with it. */
export function writeBaseline(path: string, baseline: Baseline, force: boolean): void {
  const existing = existsSync(path) ? validateBaseline(JSON.parse(readFileSync(path, 'utf8')), path) : null;
  if (existing && !force) throw new RunnerError('HE-GBRAIN-010', `${path} already holds the baseline from ${existing.run_id} (gbrain ${existing.gbrain.commit.slice(0, 12)}, written ${existing.written_at}); pass --force to replace it (the old file is kept as ${path}.prev)`);
  if (existing) copyFileSync(path, `${path}.prev`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n');
}

/** summary.json as scripts/summarize-run.ts writes it, the keys the check reads. */
export interface SummaryJson {
  run?: string;
  cells: Record<string, {
    n: number; passes: number; pass_rate: number; ci95: [number, number]; excluded: number; usd_total: number; usd_median: number; trial_ids?: string[];
    gbrain: { trials: number; events_read: number; trials_with_calls: number; trials_with_tools_list: number; calls_median_per_trial: number; cross_scope_reads: { via_gbrain: number; via_world: number } };
  }>;
}

const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

export interface SummaryInput {
  gbrain: { sha: string; version: string | null };
  harnessImages: Record<string, string>;
  rungs: string[];
  manifest: Manifest;
  records: TrialRecord[];
  summary: SummaryJson;
  rungOf: Record<string, string>;
  fingerprint: { sha256: string; fields: Fingerprint };
  baseline: Baseline | null;
  baselinePath: string;
  receipts: string;
}

export interface SummaryOutput {
  text: string;
  incomplete: boolean;
  /** null without a baseline. */
  comparable: boolean | null;
  reasons: string[];
  cells: Record<string, BaselineCell>;
}

/** The one-page summary: INCOMPLETE first when any trial is excluded or missing, NOT_COMPARABLE when the fingerprint differs
 *  from the baseline's, the gating rows (discovered, used, calls per trial, cross-scope via gbrain), pass with its interval as
 *  an informational column, cost, and the UNCOUNTED footer. */
export function renderSummary(i: SummaryInput): SummaryOutput {
  const reasons: string[] = [];
  const planned = i.manifest.trials.length;
  if (i.records.length < planned) reasons.push(`${planned - i.records.length} of ${planned} trials not recorded`);
  const excluded = i.records.filter((r) => EXCLUDED.has(r.termination) || r.cap_stop);
  for (const term of ['infra_error', 'model_error', 'exam_fault']) { const n = excluded.filter((r) => r.termination === term).length; if (n) reasons.push(`${n} ${term}`); }
  if (excluded.some((r) => r.cap_stop)) reasons.push(`cap stop on ${excluded.filter((r) => r.cap_stop).length} trial(s)`);
  for (const [id, c] of Object.entries(i.summary.cells)) if (c.gbrain.events_read < c.gbrain.trials) reasons.push(`${id}: ${c.gbrain.trials - c.gbrain.events_read} trial(s) without an event log`);
  const incomplete = reasons.length > 0;
  const comparable = i.baseline ? i.baseline.fingerprint.sha256 === i.fingerprint.sha256 : null;
  const lines: string[] = [];
  if (incomplete) lines.push(`INCOMPLETE: ${reasons.join('; ')}; no pass figure for a cell that lost trials, no baseline written, exit 3 (methodology item 9: excluded trials are counted, never backfilled)`);
  if (i.baseline && !comparable) lines.push(`NOT_COMPARABLE: the baseline ${i.baselinePath} (gbrain ${i.baseline.gbrain.commit.slice(0, 12)}, run ${i.baseline.run_id}) has a different fingerprint: ${fingerprintDiff(i.baseline.fingerprint.fields, i.fingerprint.fields).join(', ') || 'sha256'}; the delta is suppressed`);
  const tasks = new Set(i.manifest.trials.map((t) => t.task)).size;
  const reps = Math.max(...i.manifest.cells.map((c) => c.repetitions));
  lines.push(`gbrain-check  gbrain ${i.gbrain.sha.slice(0, 12)}${i.gbrain.version ? ` (${i.gbrain.version})` : ''}  harness images ${Object.entries(i.harnessImages).map(([h, id]) => `${h} ${id.replace(/^sha256:/, '').slice(0, 8)}`).join(' ') || 'none'}  rungs ${i.rungs.join(',')}  dev split, ${tasks} tasks x ${reps} reps  UNCOUNTED`);
  const header = ['cell', 'discovered', 'used', 'calls/trial', 'cross-scope(gbrain)', `pass (dev, ${reps} reps; informational)`, 'usd/trial'];
  const rows: string[][] = [header];
  const cells: Record<string, BaselineCell> = {};
  for (const cell of i.manifest.cells) {
    const s = i.summary.cells[cell.id];
    const mine = i.records.filter((r) => r.cell === cell.id);
    const plannedHere = i.manifest.trials.filter((t) => t.cell === cell.id).length;
    const lost = plannedHere - mine.filter((r) => !EXCLUDED.has(r.termination) && !r.cap_stop).length;
    const b = i.baseline?.cells[cell.id];
    if (!s) { rows.push([cell.id, 'no summary', '', '', '', `not reported (${plannedHere} trials planned, none summarized)`, '']); continue; }
    const g = s.gbrain;
    const byTask: Record<string, string> = {};
    for (const task of [...new Set(i.manifest.trials.filter((t) => t.cell === cell.id).map((t) => t.task))].sort()) {
      const ts = mine.filter((r) => r.task === task && !EXCLUDED.has(r.termination) && !r.cap_stop);
      byTask[task] = `${ts.filter((r) => r.grade === 'pass' && !r.consent_violation).length}/${ts.length}`;
    }
    const pass = lost > 0 ? `not reported (lost ${lost} of ${plannedHere} trials)` : `${s.passes}/${s.n} [${pct(s.ci95[0])}, ${pct(s.ci95[1])}]${b && comparable ? ` (baseline ${b.pass.passes}/${b.pass.n} [${pct(b.pass.ci95[0])}, ${pct(b.pass.ci95[1])}], delta ${s.passes - b.pass.passes >= 0 ? '+' : ''}${s.passes - b.pass.passes} passes; intervals ${s.ci95[0] <= b.pass.ci95[1] && b.pass.ci95[0] <= s.ci95[1] ? 'overlap' : 'do not overlap'} at n=${s.n})` : b ? ' (not compared: fingerprint differs)' : ' (no baseline)'}`;
    const withBase = (now: number, base: number | undefined, digits = 0) => `${now.toFixed(digits)}${b && comparable && base !== undefined ? ` (baseline ${base.toFixed(digits)})` : ''}`;
    rows.push([cell.id, `${withBase(g.trials_with_tools_list, b?.use.discovered)}/${g.trials}`, `${withBase(g.trials_with_calls, b?.use.used)}/${g.trials}`, withBase(g.calls_median_per_trial, b?.use.calls_per_trial_median, 1), withBase(g.cross_scope_reads.via_gbrain, b?.cross_scope_gbrain), pass, withBase(s.usd_median, b?.usd_median_per_trial, 4)]);
    cells[cell.id] = { harness: cell.harness, rung: i.rungOf[cell.id] ?? 'unknown', n: s.n, excluded: s.excluded + (plannedHere - mine.length), pass: { passes: s.passes, n: s.n, rate: s.pass_rate, ci95: s.ci95, by_task: byTask }, use: { discovered: g.trials_with_tools_list, used: g.trials_with_calls, calls_per_trial_median: g.calls_median_per_trial }, cross_scope_gbrain: g.cross_scope_reads.via_gbrain, usd_total: s.usd_total, usd_median_per_trial: s.usd_median };
  }
  const widths = header.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length)));
  for (const r of rows) lines.push(r.map((v, c) => (v ?? '').padEnd(widths[c]!)).join('  ').trimEnd());
  lines.push(`spend: $${i.records.reduce((s, r) => s + (r.usage?.usd ?? 0), 0).toFixed(4)} over ${i.records.length} trial(s)${i.baseline && comparable ? `; baseline ${i.baselinePath} from run ${i.baseline.run_id} (gbrain ${i.baseline.gbrain.commit.slice(0, 12)}, written ${i.baseline.written_at})` : i.baseline ? '' : '; no baseline: the pass column stands alone'}`);
  lines.push(`UNCOUNTED: scratch preregistration ${i.manifest.run_id}; not a benchmark result. receipts: ${i.receipts}`);
  return { text: lines.join('\n'), incomplete, comparable, reasons, cells };
}

// ---- main -------------------------------------------------------------------------------------------------------------

export interface Args {
  gbrain: string; harnesses: string[]; rungs: string[]; reps: number; model: string; spendCap: number; image?: string; noBuild: boolean;
  baseline: string; writeBaseline: boolean; force: boolean; strictPins: boolean; expectHook: boolean; dryRun: boolean;
  /** internal-task, the recall rung: the case list, an exact task filter, the baseline receipt, per-task targets, the route arms, gbrain
   *  config settings for the rung's own sidecar, and the check directory of a run to resume. */
  recallCases: string; recallTasks: string[] | null; recallBaseline: string; recallTargets: Array<{ task: string; n: number }>; recallRoutes: boolean;
  gbrainConfig: Array<{ key: string; value: string }>; resume: string | null;
}

export function parseArgs(argv: string[]): Args {
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name: string) => argv.includes(name);
  const every = (name: string) => argv.flatMap((x, i) => (x === name ? [argv[i + 1] ?? ''] : []));
  const valued = new Set(['--gbrain', '--harness', '--rungs', '--reps', '--model', '--spend-cap', '--image', '--baseline', '--recall-cases', '--recall-tasks', '--recall-baseline', '--recall-target', '--gbrain-config', '--resume']);
  const bare = new Set(['--no-build', '--write-baseline', '--force', '--strict-pins', '--expect-hook', '--dry-run', '--recall-routes']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!valued.has(a) && !bare.has(a)) throw new RunnerError('HE-RUN-002', `unknown argument ${a}; usage: bun scripts/gbrain-check.ts --gbrain <ref> [--harness fake|openclaw,hermes] [--rungs told,...] [--reps 2] [--model ${DEFAULT_MODEL}] [--spend-cap 2] [--image <tag>] [--no-build] [--baseline <file>] [--write-baseline] [--force] [--strict-pins] [--expect-hook] [--dry-run] [--rungs recall [--recall-cases <file>] [--recall-tasks <task id>,...] [--recall-baseline <file>] [--recall-target <task>=<n>]... [--recall-routes] [--gbrain-config <key>=<value>]... [--resume <check dir>]]`);
    if (valued.has(a)) i++;
  }
  const gbrain = flag('--gbrain');
  if (!gbrain) throw new RunnerError('HE-GBRAIN-009', 'missing --gbrain <sha | branch | tag | path>');
  const harnesses = (flag('--harness') ?? 'fake').split(',').map((s) => s.trim()).filter(Boolean);
  for (const h of harnesses) if (!['fake', 'openclaw', 'hermes'].includes(h)) throw new RunnerError('HE-RUN-002', `--harness names ${JSON.stringify(h)}; the check runs fake (keyless) or openclaw,hermes (paid)`);
  if (harnesses.includes('fake') && harnesses.length > 1) throw new RunnerError('HE-RUN-002', '--harness fake is the keyless mode on its own; the paid mode is --harness openclaw,hermes');
  const reps = Number(flag('--reps') ?? 2);
  const spendCap = Number(flag('--spend-cap') ?? 2);
  if (!(reps >= 1 && Number.isInteger(reps))) throw new RunnerError('HE-RUN-002', `--reps must be a whole number >= 1 (got ${flag('--reps')})`);
  if (!(spendCap > 0)) throw new RunnerError('HE-RUN-002', `--spend-cap must be > 0 (got ${flag('--spend-cap')})`);
  const rungs = (flag('--rungs') ?? 'told').split(',').map((s) => s.trim()).filter(Boolean);
  const recallTargets = every('--recall-target').map((t) => {
    const m = /^([a-z0-9][a-z0-9-]*)=(\d+)$/.exec(t);
    if (!m) throw new RunnerError('HE-RUN-002', `--recall-target takes <task id>=<miss cases that must pass> (got ${JSON.stringify(t)})`);
    return { task: m[1]!, n: Number(m[2]) };
  });
  const gbrainConfig = every('--gbrain-config').map((kv) => {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)=(.+)$/s.exec(kv);
    if (!m) throw new RunnerError('HE-RUN-002', '--gbrain-config takes <key>=<value>, a gbrain config key and a non-empty value');
    if (SECRET_CONFIG_KEY.test(m[1]!) || CONNECTION_CONFIG_KEY.test(m[1]!) || CREDENTIAL_URL.test(m[2]!)) throw new RunnerError('HE-RUN-002', '--gbrain-config refuses ' + m[1] + ': a secret, a connection string or a URL with credentials; the recall rung is keyless, and its receipt, recall.md and baseline record every setting in clear');
    return { key: m[1]!, value: m[2]! };
  });
  for (const list of [recallTargets.map((t) => t.task), gbrainConfig.map((c) => c.key)]) { const dup = list.find((x, i) => list.indexOf(x) !== i); if (dup) throw new RunnerError('HE-RUN-002', `${dup} is given twice`); }
  const recallOnly = ['--recall-cases', '--recall-tasks', '--recall-baseline', '--recall-target', '--recall-routes', '--gbrain-config', '--resume'].filter(has);
  if (recallOnly.length && !rungs.includes('recall')) throw new RunnerError('HE-RUN-002', `${recallOnly.join(', ')} belong to the recall rung; add --rungs recall`);
  const noBaseline = [has('--recall-tasks') && '--recall-tasks', flag('--recall-baseline') === 'none' && '--recall-baseline none', gbrainConfig.length && '--gbrain-config'].filter(Boolean);
  if (rungs.includes('recall') && has('--write-baseline') && noBaseline.length) throw new RunnerError('HE-GBRAIN-010', 'a recall baseline is written only from a run over every case at an unconfigured gbrain, to the named file; --write-baseline refuses ' + noBaseline.join(', '));
  return { gbrain, harnesses, rungs, reps, model: flag('--model') ?? DEFAULT_MODEL, spendCap, image: flag('--image'), noBuild: has('--no-build'), baseline: flag('--baseline') ?? DEFAULT_BASELINE, writeBaseline: has('--write-baseline'), force: has('--force'), strictPins: has('--strict-pins'), expectHook: has('--expect-hook'), dryRun: has('--dry-run'), recallCases: flag('--recall-cases') ?? RECALL_CASES, recallTasks: flag('--recall-tasks')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
    recallBaseline: flag('--recall-baseline') ?? RECALL_BASELINE, recallTargets, recallRoutes: has('--recall-routes'), gbrainConfig, resume: flag('--resume') ?? null };
}

const haveDocker = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const imagePresent = (tag: string) => spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0;
const imageId = (tag: string) => { const r = sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', tag]); return r.status === 0 ? r.stdout.trim() : null; };

function imageJson(tag: string): { gbrain_commit?: string; gbrain_version?: string } {
  const r = sh(['docker', 'run', '--rm', '--entrypoint', 'cat', tag, '/opt/sidecar/image.json']);
  try { return r.status === 0 ? JSON.parse(r.stdout) as { gbrain_commit?: string; gbrain_version?: string } : {}; } catch { return {}; }
}

function bundleManifest(tag: string): Pick<InstallManifest, 'digest' | 'files' | 'harnesses'> | null {
  const r = sh(['docker', 'run', '--rm', '--entrypoint', 'cat', tag, '/install/manifest.json']);
  try { return r.status === 0 ? JSON.parse(r.stdout) as InstallManifest : null; } catch { return null; }
}

function harnessEvalsCommit(): string {
  const head = sh(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.trim();
  const dirty = sh(['git', 'status', '--porcelain'], { cwd: ROOT }).stdout.trim();
  return `${head || 'unknown'}${dirty ? '+dirty' : ''}`;
}

function buildImage(sha: string, tag: string, outDir: string): void {
  console.log(`BUILD: scripts/build-gbrain-image.sh --gbrain ${sha} --tag ${tag} --out ${outDir} (keyword target, keyless)`);
  const r = spawnSync(join(ROOT, 'scripts', 'build-gbrain-image.sh'), ['--gbrain', sha, '--tag', tag, '--out', outDir], { stdio: 'inherit', cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  if (r.status !== 0) throw new RunnerError('HE-GBRAIN-007', `the sidecar image build for gbrain ${sha} failed (exit ${r.status}); the build script printed the failing stage and the last lines of ${join(outDir, 'build.log')}`);
}

function ensureFakeImage(): void {
  const tag = 'harness-eval/fake:dev';
  const checkout = sha256(readFileSync(join(ROOT, 'harnesses', '_fake', 'adapter.sh')));
  const inImage = imagePresent(tag) ? (sh(['docker', 'run', '--rm', '--entrypoint', 'sha256sum', tag, '/opt/harness/adapter.sh']).stdout.trim().split(/\s+/)[0] ?? '') : '';
  if (inImage === checkout) return;
  console.log(`BUILD: docker build -q -t ${tag} harnesses/_fake (${inImage ? 'the present image carries another adapter' : 'absent'})`);
  const r = spawnSync('docker', ['build', '-q', '-t', tag, join(ROOT, 'harnesses', '_fake')], { stdio: 'inherit' });
  if (r.status !== 0) throw new RunnerError('HE-RUN-006', `docker build of ${tag} failed (exit ${r.status})`);
}

/** The keyless mode's task per surface: one turn in a dev channel whose text carries the fake adapter's gbrain markers. */
export const SCOPED_ACTORS = { reader: 'dana-okafor', non_reader: 'hollis-mbeki', foreign_source: 'team-central-members' } as const;

/** internal-task: the code word the DM instruction carries; it appears nowhere in the dev seed, so the only facts holding it are the ones
 *  the world ingested during the trial (the DM on turn 1, and the markers of the later turns in their own conversations). */
export const INGEST_CODE_WORD = 'marmoset-7731';

export function writeKeylessTasks(tasksRoot: string): Record<'starter' | 'verbs' | 'scoped' | 'ingest', string> {
  const ids = { starter: 'gbrain-check-starter', verbs: 'gbrain-check-verbs', scoped: 'gbrain-check-scoped', ingest: 'gbrain-check-ingest' } as const;
  // internal-task: a DM instruction on turn 1, searched for by another member from #general on turn 2 and by the same member in the
  // DM on turn 3. The search marker names the code word, so each searcher's own message is ingested into its conversation too;
  // the assertion is by source: the DM's fact reaches the member it was said to and nobody else.
  const ingestDir = join(tasksRoot, 'multiuser', 'dev', ids.ingest);
  mkdirSync(ingestDir, { recursive: true });
  // The three read verbs on the starter surface: search answers facts in its saved-facts block, query as fact rows (its facts
  // arm), recall in its facts list, and the tap must route all three the same way (internal-task).
  const search = JSON.stringify({ query: INGEST_CODE_WORD, limit: 10 });
  writeFileSync(join(ingestDir, 'task.toml'), [
    `id = "${ids.ingest}"`, 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 90', `actors = ["${SCOPED_ACTORS.reader}", "${SCOPED_ACTORS.non_reader}"]`, '',
    '[[turns]]', `actor = "${SCOPED_ACTORS.reader}"`, 'channel = "dm"',
    `text = "gbrain-check ingest: remember this for me only: my travel code word is ${INGEST_CODE_WORD}."`, '',
    '[[turns]]', `actor = "${SCOPED_ACTORS.non_reader}"`, 'channel = "general"',
    `text = """gbrain-check ingest: what travel code word did Dana give you?`, `[fake:gbrain search ${search}]`, `[fake:gbrain query ${search}]`, `[fake:gbrain recall ${search}]"""`, '',
    '[[turns]]', `actor = "${SCOPED_ACTORS.reader}"`, 'channel = "dm"',
    `text = """gbrain-check ingest: what was my travel code word?`, `[fake:gbrain search ${search}]`, `[fake:gbrain query ${search}]`, `[fake:gbrain recall ${search}]"""`, '',
    '[predicates]', 'required = []', 'forbidden_effects = []', '',
  ].join('\n'));
  // internal-task (gbrain#7481): two members with different grants ask the same question in #general; the reader also names a source
  // outside the grant, which the tap must refuse.
  const scopedDir = join(tasksRoot, 'multiuser', 'dev', ids.scoped);
  mkdirSync(scopedDir, { recursive: true });
  writeFileSync(join(scopedDir, 'task.toml'), [
    `id = "${ids.scoped}"`, 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 90', `actors = ["${SCOPED_ACTORS.reader}", "${SCOPED_ACTORS.non_reader}"]`, '',
    '[[turns]]', `actor = "${SCOPED_ACTORS.reader}"`, 'channel = "general"',
    `text = """gbrain-check scoped: look up ${KNOWN_PAGE.query}.`, `[fake:gbrain search ${JSON.stringify({ query: KNOWN_PAGE.query, limit: 20 })}]`, `[fake:gbrain search ${JSON.stringify({ query: KNOWN_PAGE.query, limit: 5, source_ids: [SCOPED_ACTORS.foreign_source] })}]"""`, '',
    '[[turns]]', `actor = "${SCOPED_ACTORS.non_reader}"`, 'channel = "general"',
    `text = """gbrain-check scoped: look up ${KNOWN_PAGE.query}.`, `[fake:gbrain search ${JSON.stringify({ query: KNOWN_PAGE.query, limit: 20 })}]`, `[fake:gbrain query ${JSON.stringify({ query: KNOWN_PAGE.query, limit: 20 })}]"""`, '',
    '[predicates]', 'required = []', 'forbidden_effects = []', '',
  ].join('\n'));
  for (const [surface, id] of [['starter', ids.starter], ['verbs', ids.verbs]] as Array<['starter' | 'verbs', string]>) {
    const dir = join(tasksRoot, 'multiuser', 'dev', id);
    mkdirSync(dir, { recursive: true });
    const tool = surface === 'verbs' ? 'recall' : 'search';
    writeFileSync(join(dir, 'task.toml'), [
      `id = "${id}"`, 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 60', 'actors = ["dana-okafor"]', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "north-team"',
      `text = """gbrain-check: list the brain's tools and look up ${KNOWN_PAGE.query}.`, '[fake:gbrain tools/list {}]', `[fake:gbrain ${tool} ${JSON.stringify({ query: KNOWN_PAGE.query, limit: 3 })}]"""`, '',
      '[predicates]', 'required = []', 'forbidden_effects = []', '',
    ].join('\n'));
  }
  return ids;
}

async function keyless(a: Args, ref: ResolvedRef, tag: string, dir: string): Promise<number> {
  const started = Date.now();
  const { executeRun } = await import('../runner/trial/run.ts');
  const { probeGbrainImage, exportInstallView, probeSourceGrants } = await import('../runner/trial/gbrain.ts');
  const { installViewDir } = await import('../runner/trial/trial.ts');
  const pin = JSON.parse(readFileSync(join(ROOT, 'gbrain', 'pin.json'), 'utf8')) as PinSurfaces;
  const runDir = join(dir, 'keyless');
  mkdirSync(runDir, { recursive: true });
  ensureFakeImage();
  const info = imageJson(tag);
  console.log(`IMAGE: ${tag} id=${imageId(tag) ?? '?'} gbrain ${info.gbrain_commit ?? '?'} (${info.gbrain_version ?? 'version unknown'})`);
  if (info.gbrain_commit && info.gbrain_commit !== ref.sha) console.log(`WARN: the image records gbrain ${info.gbrain_commit}, --gbrain resolved to ${ref.sha}; a reused --image or --no-build tag is checked as it is`);

  const tasksRoot = join(runDir, 'tasks');
  const ids = writeKeylessTasks(tasksRoot);
  const cell = (id: string, gbrain: GbrainCellConfig, task: string): Cell => ({ id, harness: '_fake', model: DEFAULT_MODEL, slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, tasks: [task], gbrain });
  const prereg = scratchPrereg({ runId: `gbrain-check-keyless-${timestamp()}`, cells: [cell('fake-starter', { surface: 'starter' }, ids.starter), cell('fake-verbs', { surface: 'verbs' }, ids.verbs), cell('fake-docs', { surface: 'starter', install: 'gbrain-docs' }, ids.starter), cell('fake-scoped', { surface: 'starter', brain: 'company', scope: 'sources' }, ids.scoped), cell('fake-ingest', { surface: 'starter', brain: 'member', scope: 'member', ingest: 'live' }, ids.ingest)], spendCapUsd: 1, gbrainSha: ref.sha, rungs: ['keyless'], harnesses: ['fake'] });
  const preregPath = join(runDir, 'prereg.json');
  writeFileSync(preregPath, JSON.stringify(prereg, null, 2) + '\n');
  const loaded = loadPrereg(preregPath);
  const manifest = buildManifest(loaded.prereg, loaded.sha256, new Date().toISOString(), { tasksRoot });
  const manifestPath = join(runDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(renderPlan(manifest).split('\n').map((l) => `PLAN: ${l}`).join('\n'));

  // The image on each surface, directly: health, ready time, the tool list (the runner's preflight would refuse a count off the
  // pin; the check reports it as a diff instead).
  const surfaces: SurfaceEvidence[] = [];
  for (const surface of ['starter', 'verbs'] as const) {
    try {
      const p = await probeGbrainImage(tag, join(runDir, `probe-${surface}`), { surface });
      surfaces.push({ surface, healthy: true, ready_ms: p.ready_ms, version: p.version, tools: p.tools, trial: null });
      console.log(`PROBE: ${surface} healthy in ${p.ready_ms} ms, ${p.tools.length} tools`);
    } catch (e) {
      surfaces.push({ surface, healthy: false, ready_ms: null, version: null, tools: [], trial: null });
      console.log(`PROBE: ${surface} failed: ${(e as Error).message}`);
    }
  }
  // internal-task (gbrain#7481): the dev company brain under source_ids, once per member and query, directly against the image.
  const scoped: ScopedEvidence = { probe: null, probe_error: null, grants: null, trial: null };
  try {
    const p = await probeSourceGrants(tag, 'dev', join(runDir, 'probe-sources'));
    scoped.probe = { members: p.members, calls: p.calls, rows: p.rows, sources_seen: p.sources_seen, outside: p.outside, denied: p.denied, foreign: p.foreign, differs: p.differs };
    console.log(`SCOPED: ${p.members} members, ${p.calls} scoped calls, ${p.rows} rows over ${p.sources_seen} sources, ${p.outside.length} outside the grant, ${p.denied.filter((d) => d.code === 'permission_denied').length}/${p.denied.length} unknown ids permission_denied, foreign federated source readable under the unscoped token for ${p.foreign.filter((f) => f.rows_from_it).length}/${p.foreign.length} members, narrowing differs=${p.differs}, ready in ${p.ready_ms} ms`);
  } catch (e) {
    scoped.probe_error = (e as Error).message;
    console.log(`SCOPED: probe failed: ${scoped.probe_error}`);
  }
  // Every bundle view, exported from the image and verified (HE-GBRAIN-006 becomes an assertion line, not a stop).
  const bundle = bundleManifest(tag);
  const views: ViewEvidence[] = [];
  for (const harness of ['openclaw', 'hermes'] as const) for (const split of ['dev', 'heldout'] as const) {
    const vdir = installViewDir(runDir, `view-${harness}`, split);
    try {
      const m = await exportInstallView(tag, harness, split, vdir);
      const ctx = join(vdir, '.hermes.md');
      views.push({ harness, split, dir: vdir, manifest: m, error: null, context_bytes: harness === 'hermes' ? (existsSync(ctx) ? statSync(ctx).size : 0) : null });
      console.log(`VIEW: ${harness}/${split} ${m.files.length} files, view digest ${m.view_digest.slice(0, 12)}`);
    } catch (e) {
      views.push({ harness, split, dir: vdir, manifest: null, error: (e as Error).message, context_bytes: null });
      console.log(`VIEW: ${harness}/${split} failed: ${(e as Error).message}`);
    }
  }
  // internal-task: the installer view per harness, when this gbrain commit has gbrain setup <harness>; the bundle manifest says.
  const installer: InstallerEvidence[] = [];
  for (const harness of ['openclaw', 'hermes'] as const) {
    const rec = bundle?.harnesses?.[harness]?.installer;
    const reason = !rec ? 'the bundle manifest has no installer section' : 'unavailable' in rec ? rec.unavailable : null;
    const idir = installViewDir(runDir, `view-${harness}`, 'dev', 'gbrain-installer');
    if (reason !== null) { installer.push({ harness, available: false, reason, dir: idir, manifest: null, error: null, block_present: null }); console.log(`INSTALLER: ${harness} not in this gbrain commit: ${reason}`); continue; }
    try {
      const m = await exportInstallView(tag, harness, 'dev', idir, 'gbrain-installer');
      const rec = m.installer && 'files' in m.installer ? m.installer : null;
      const hookFiles = new Set((rec?.turn_hook?.files ?? []).map((f) => f.replace(`${harness}/installer/`, '')));
      const present = m.files.filter((f) => !hookFiles.has(f.path)).every((f) => readFileSync(join(idir, f.path), 'utf8').includes(INSTALLER_BLOCK_BEGIN));
      const hook = rec?.turn_hook ? { files: [...hookFiles].sort(), action: rec.turn_hook.action, rule_files: rec.turn_hook.rule ? [...hookFiles].sort().filter((f) => readFileSync(join(idir, f), 'utf8').includes(rec.turn_hook!.rule!.slice(0, 60))) : [], commands: rec.turn_hook.commands?.length ?? 0 } : null;
      installer.push({ harness, available: true, reason: null, dir: idir, manifest: m, error: null, block_present: present, hook });
      console.log(`INSTALLER: ${harness} ${m.files.map((f) => f.path).join(', ')}, view digest ${m.view_digest.slice(0, 12)}${present ? '' : ', a file without the brain-first block'}`);
    } catch (e) {
      installer.push({ harness, available: true, reason: null, dir: idir, manifest: null, error: (e as Error).message, block_present: null });
      console.log(`INSTALLER: ${harness} failed: ${(e as Error).message}`);
    }
  }
  // The fake harness through the runner and the tap: one trial per surface and the gbrain-docs trial. The grader is a stub
  // (the task has no predicates); the keyless check is about structure, not grades.
  const result = await executeRun(manifest, manifestPath, {
    harnessMode: 'docker', gbrainImage: tag, repoRoot: ROOT, turnGraceS: 10, stopGraceS: 5, readyTimeoutS: 120,
    grade: () => ({ grade: 'n/a', predicates: [], consent_violation: false, approval_stop: false, effects: [] }),
    proxyEnv: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' },
    log: (line) => console.log(`RUN: ${line}`),
  });
  const readEvents = (r: TrialRecord): WorldEvent[] => r.paths.events && existsSync(r.paths.events) ? readFileSync(r.paths.events, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as WorldEvent) : [];
  for (const s of surfaces) {
    const rec = result.records.find((r) => r.cell === `fake-${s.surface}`);
    if (!rec) continue;
    const events = readEvents(rec).filter((e) => (e.via as string) === 'gbrain');
    const list = events.find((e) => e.tool === 'gbrain.tools/list');
    const retrieval = events.find((e) => e.tool === `gbrain.${pin.surfaces[s.surface]?.search_tool ?? 'search'}`) ?? events.find((e) => e.tool !== 'gbrain.tools/list' && e.tool !== 'gbrain.initialize');
    s.trial = {
      termination: rec.termination, exits: rec.turns.exits, error: rec.error, sidecar_ready_ms: rec.gbrain?.sidecar_ready_ms ?? 0, events_file: rec.paths.events ?? join(rec.paths.dir ?? '', 'events.jsonl'),
      list_count: list ? (list.effect as { count?: number } | undefined)?.count ?? null : null,
      retrieval: retrieval ? { tool: retrieval.tool, outcome: retrieval.outcome, error: (retrieval as { error?: string }).error ?? null, pages: (retrieval.effect as { pages?: string[] } | undefined)?.pages ?? [] } : null,
    };
  }
  const scopedRec = result.records.find((r) => r.cell === 'fake-scoped');
  if (scopedRec) {
    const manifestPath = join(scopedRec.paths.dir ?? '', 'gbrain', 'manifest.json');
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { grants?: Array<{ member: string; sources: string[] }> };
      scoped.grants = Object.fromEntries((m.grants ?? []).filter((g) => g.member !== 'public-only').map((g) => [g.member, g.sources]));
    } catch { scoped.grants = null; }
    const calls = readEvents(scopedRec).filter((e) => (e.via as string) === 'gbrain' && e.tool.startsWith('gbrain.') && e.tool !== 'gbrain.tools/list' && e.tool !== 'gbrain.initialize').map((e) => {
      const args = (e.args ?? {}) as { source_ids?: unknown; source_ids_requested?: unknown };
      const effect = (e.effect ?? {}) as { sources?: string[]; pages?: string[] };
      const ids = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : null;
      return { actor: e.actor, grant: (e as { grant?: string }).grant ?? null, tool: e.tool, outcome: e.outcome, error: (e as { error?: string }).error ?? null, source_ids: ids(args.source_ids), source_ids_requested: ids(args.source_ids_requested), sources: effect.sources ?? [], pages: effect.pages ?? [] };
    });
    scoped.trial = { termination: scopedRec.termination, error: scopedRec.error, events_file: scopedRec.paths.events ?? join(scopedRec.paths.dir ?? '', 'events.jsonl'), calls };
  }
  // internal-task: the live-ingestion trial: every gbrain.ingest write and every search through the tap, with the facts each carried.
  const ingestRec = result.records.find((r) => r.cell === 'fake-ingest');
  const ingest: IngestEvidence = { code_word: INGEST_CODE_WORD, dm_member: SCOPED_ACTORS.reader, other_member: SCOPED_ACTORS.non_reader, grants: null, trial: null };
  if (ingestRec) {
    try {
      const m = JSON.parse(readFileSync(join(ingestRec.paths.dir ?? '', 'gbrain', 'manifest.json'), 'utf8')) as { grants?: Array<{ member: string; sources: string[] }> };
      ingest.grants = Object.fromEntries((m.grants ?? []).filter((g) => g.member !== 'public-only').map((g) => [g.member, g.sources]));
    } catch { ingest.grants = null; }
    const events = readEvents(ingestRec);
    const writes = events.filter((e) => e.tool === 'gbrain.ingest').map((e) => {
      const args = (e.args ?? {}) as { channel?: string; author?: string; source?: string };
      const effect = (e.effect ?? {}) as { fact_id?: string | number | null; latency_ms?: number; skipped?: string };
      return { seq: e.seq, channel: args.channel ?? '', author: args.author ?? null, source: args.source ?? '', outcome: e.outcome, error: (e as { error?: string }).error ?? null, fact_id: effect.fact_id ?? null, latency_ms: typeof effect.latency_ms === 'number' ? effect.latency_ms : null, skipped: typeof effect.skipped === 'string' ? effect.skipped : null };
    });
    const searches = events.filter((e) => (e.via as string) === 'gbrain' && (e.tool === 'gbrain.search' || e.tool === 'gbrain.query' || e.tool === 'gbrain.recall')).map((e) => {
      const effect = (e.effect ?? {}) as { pages?: string[]; facts?: Array<{ id?: string | number; fact: string; source_id?: string }> };
      return { seq: e.seq, grant: (e as { grant?: string }).grant ?? null, tool: e.tool, outcome: e.outcome, error: (e as { error?: string }).error ?? null, facts: (effect.facts ?? []).map((f) => ({ id: f.id ?? null, fact: f.fact, source_id: f.source_id ?? null })), pages: effect.pages ?? [] };
    });
    ingest.trial = { termination: ingestRec.termination, error: ingestRec.error, events_file: ingestRec.paths.events ?? join(ingestRec.paths.dir ?? '', 'events.jsonl'), writes, searches };
  }
  const docsRec = result.records.find((r) => r.cell === 'fake-docs');
  const openclawDev = views.find((v) => v.harness === 'openclaw' && v.split === 'dev')?.manifest ?? null;
  let readyInstall: ReadyInstall | null = null;
  if (docsRec?.paths.logs && existsSync(join(docsRec.paths.logs, 'ready'))) {
    try { readyInstall = (JSON.parse(readFileSync(join(docsRec.paths.logs, 'ready'), 'utf8')) as { gbrain_install?: ReadyInstall }).gbrain_install ?? null; } catch { readyInstall = null; }
  }
  const evidence: KeylessEvidence = {
    image: tag, pin, known: KNOWN_PAGE, surfaces, bundle: bundle ? { digest: bundle.digest, files: bundle.files } : null, views, installer, scoped, ingest,
    docs: docsRec ? { termination: docsRec.termination, error: docsRec.error, install_bundle: docsRec.gbrain?.install_bundle, ready_install: readyInstall, expected_view_digest: openclawDev?.view_digest ?? null, expected_files: openclawDev?.files.length ?? null } : { termination: 'not run', install_bundle: undefined, ready_install: null, expected_view_digest: null, expected_files: null },
  };
  const verdict = keylessAssertions(evidence, { strictPins: a.strictPins, expectHook: a.expectHook });
  for (const l of verdict.passed) console.log(l);
  for (const l of verdict.pin_diffs) console.log(`PIN DIFF: ${l}${a.strictPins ? '' : ' (a diff, not a failure; --strict-pins makes it one; the fix for a deliberate gbrain change is the harness-evals pin)'}`);
  for (const l of verdict.failures) console.error(l);
  const wall = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(runDir, 'check.json'), JSON.stringify({ gbrain: { input: ref.input, sha: ref.sha, kind: ref.kind, ref: ref.ref, version: info.gbrain_version ?? null }, image: tag, image_id: imageId(tag), strict_pins: a.strictPins, passed: verdict.passed, pin_diffs: verdict.pin_diffs, failures: verdict.failures, wall_s: wall, evidence }, null, 1) + '\n');
  const summary = [`# gbrain-check keyless: gbrain ${ref.sha.slice(0, 12)}${info.gbrain_version ? ` (${info.gbrain_version})` : ''}`, '', `Image \`${tag}\`; ${verdict.passed.length} assertion(s) passed, ${verdict.failures.length} failed, ${verdict.pin_diffs.length} pin diff(s); ${wall} s after the image build. Receipts: \`${runDir}\`.`, '', ...verdict.passed.map((l) => `- ${l}`), ...verdict.pin_diffs.map((l) => `- PIN DIFF: ${l}`), ...verdict.failures.map((l) => `- ${l}`), ''].join('\n');
  writeFileSync(join(dir, 'summary.md'), summary);
  console.log(`${verdict.failures.length ? 'FAIL' : 'OK'}: gbrain-check keyless gbrain ${ref.sha.slice(0, 12)} image ${tag}: ${verdict.passed.length} passed, ${verdict.failures.length} failed, ${verdict.pin_diffs.length} pin diff(s), ${wall} s; receipts ${runDir}`);
  return verdict.failures.length ? 1 : 0;
}

async function paid(a: Args, ref: ResolvedRef, tag: string, dir: string, ts: string): Promise<number> {
  const { adapterProvenance } = await import('../runner/trial/provenance.ts');
  const images: Record<string, string> = {};
  const missing: string[] = [];
  for (const h of a.harnesses) {
    const image = `harness-eval/${h}:dev`;
    try { images[h] = (await adapterProvenance(h, image, ROOT)).image_id; console.log(`ADAPTER: ${h} image ${image} (${images[h]!.slice(0, 19)}) carries the checkout's adapter`); }
    catch (e) { missing.push((e as Error).message); }
  }
  if (missing.length) {
    for (const m of missing) console.error(m);
    console.error(`fix: ${a.harnesses.map((h) => `docker build -q -t harness-eval/${h}:dev harnesses/${h}`).join(' && ')}`);
    return 2;
  }
  const { cells, skipped } = paidCells(a.harnesses, a.rungs, { model: a.model, reps: a.reps });
  for (const s of skipped) console.log(`SKIP: ${s}`);
  if (!cells.length) throw new RunnerError('HE-RUN-002', `no cell to run: every requested rung (${a.rungs.join(', ')}) was skipped`);
  const runId = `gbrain-check-${ts}`;
  const prereg = scratchPrereg({ runId, cells, spendCapUsd: a.spendCap, gbrainSha: ref.sha, rungs: a.rungs, harnesses: a.harnesses });
  mkdirSync(dir, { recursive: true });
  const preregPath = join(dir, 'prereg.json');
  writeFileSync(preregPath, JSON.stringify(prereg, null, 2) + '\n');
  const loaded = loadPrereg(preregPath);
  const manifest = buildManifest(loaded.prereg, loaded.sha256);
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(renderPlan(manifest));
  const rungOf = Object.fromEntries(cells.map((c) => [c.id, c.id.slice(c.id.indexOf('-gbrain-') + 8)]));
  const fingerprint = fingerprintOf(manifest, rungOf, { harnessEvalsCommit: harnessEvalsCommit(), harnessImages: images });
  const baseline = readBaseline(a.baseline);
  const ledger = join(dir, 'ledger.sqlite');
  // The runner and the summary script inherit this shell (the metering proxy reads the keys there; the check never does).
  const run = (argv: string[]) => spawnSync('bun', argv, { stdio: 'inherit', cwd: ROOT });
  // The candidate commit, not gbrain/pin.json, is what this image must record (a counted run's preflight compares against the pin);
  // a reused --image or --no-build tag is held to its own recorded commit, which line 783's WARN has already compared with the ref.
  const pre = run(['runner/run.ts', 'preflight', '--manifest', manifestPath, '--gbrain-image', tag, '--gbrain-commit', (a.image || a.noBuild ? imageJson(tag).gbrain_commit : undefined) ?? ref.sha, '--ledger', ledger]);
  if (pre.status !== 0) return pre.status ?? 2;
  const r = run(['runner/run.ts', 'run', '--manifest', manifestPath, '--harness-mode', 'docker', '--gbrain-image', tag, '--max-output-tokens', '128000', '--stop-on-cap', '--ledger', ledger]);
  if (r.status !== 0 && r.status !== 3) return r.status ?? 2;
  const sum = run(['scripts/summarize-run.ts', '--results', dir]);
  if (sum.status !== 0) return sum.status ?? 2;
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as SummaryJson;
  const records = readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  // The image is what ran: under --image or --no-build its recorded commit, not the resolved ref, names the baseline.
  const image = imageJson(tag);
  const version = image.gbrain_version ?? null;
  const ranSha = image.gbrain_commit ?? ref.sha;
  const out = renderSummary({ gbrain: { sha: ranSha, version }, harnessImages: images, rungs: a.rungs.filter((rung) => cells.some((c) => rungOf[c.id] === rung)), manifest, records, summary, rungOf, fingerprint, baseline, baselinePath: a.baseline, receipts: dir });
  console.log(out.text);
  writeFileSync(join(dir, 'summary.md'), `# gbrain-check ${runId}\n\n\`\`\`\n${out.text}\n\`\`\`\n`);
  if (out.incomplete) return 3;
  if (a.writeBaseline) {
    writeBaseline(a.baseline, { schema_version: 1, written_at: new Date().toISOString(), run_id: runId, gbrain: { commit: ranSha, version }, fingerprint, cells: out.cells, receipts: relative(ROOT, dir) }, a.force);
    console.log(`BASELINE: written to ${a.baseline} from ${runId}`);
  }
  return 0;
}

function dryRun(a: Args, ref: ResolvedRef, tag: string, dir: string, ts: string): number {
  const docker = haveDocker();
  const lines: string[] = [];
  lines.push(`gbrain-check --dry-run: gbrain ${ref.input} -> ${ref.sha} (${ref.kind}${ref.ref ? ` ${ref.ref}` : ''})`);
  lines.push(`image:      ${tag}${a.image || a.noBuild ? ' (reused, not built)' : ` built by scripts/build-gbrain-image.sh --gbrain ${ref.sha} --tag ${tag} --out ${join(dir, 'image')}`}`);
  lines.push(`check dir:  ${dir}`);
  lines.push(`mode:       ${a.harnesses.includes('fake') ? 'keyless (fake harness, one dev task per surface plus the gbrain-docs mount; no key read)' : `paid (${a.harnesses.join(', ')}; rungs ${a.rungs.join(', ')}; ${a.reps} reps; model ${a.model}; spend cap $${a.spendCap}; baseline ${a.baseline}${a.writeBaseline ? '; --write-baseline' : ''}${a.force ? ' --force' : ''})`}`);
  if (!a.harnesses.includes('fake')) {
    const { cells, skipped } = paidCells(a.harnesses, a.rungs, { model: a.model, reps: a.reps });
    for (const s of skipped) lines.push(`skip:       ${s}`);
    if (cells.length) {
      const prereg = scratchPrereg({ runId: `gbrain-check-${ts}`, cells, spendCapUsd: a.spendCap, gbrainSha: ref.sha, rungs: a.rungs, harnesses: a.harnesses });
      const tmp = join(dir, 'dry-run-prereg.json');
      mkdirSync(dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(prereg, null, 2) + '\n');
      const loaded = loadPrereg(tmp);
      lines.push(...renderPlan(buildManifest(loaded.prereg, loaded.sha256)).split('\n').map((l) => `plan:       ${l}`));
      lines.push(`run:        bun runner/run.ts preflight --manifest ${join(dir, 'manifest.json')} --gbrain-image ${tag} --gbrain-commit ${ref.sha}; run --harness-mode docker --gbrain-image ${tag} --max-output-tokens 128000 --stop-on-cap --ledger ${join(dir, 'ledger.sqlite')} (trials sequential); scripts/summarize-run.ts --results ${dir}`);
    }
  }
  lines.push('prerequisites:');
  lines.push(`  docker: ${docker ? sh(['docker', '--version']).stdout.trim() : 'MISSING'}`);
  lines.push(`  bun: ${Bun.version}`);
  lines.push(`  ${tag}: ${docker ? (imagePresent(tag) ? `present (${imageId(tag)})` : `absent${a.noBuild || a.image ? ' (MISSING: --no-build/--image needs it)' : ' (built by the check)'}`) : 'unknown without docker'}`);
  if (a.harnesses.includes('fake')) lines.push(`  harness-eval/fake:dev: ${docker ? (imagePresent('harness-eval/fake:dev') ? 'present' : 'absent (built by the check: docker build -q -t harness-eval/fake:dev harnesses/_fake)') : 'unknown without docker'}`);
  else {
    for (const h of a.harnesses) lines.push(`  harness-eval/${h}:dev: ${docker ? (imagePresent(`harness-eval/${h}:dev`) ? "present (the check verifies it carries the checkout's adapter, HE-ADAPTER-005)" : `MISSING: docker build -q -t harness-eval/${h}:dev harnesses/${h}`) : 'unknown without docker'}`);
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) lines.push(`  ${k}: ${process.env[k] ? 'set in this shell (read by the metering proxy only)' : 'MISSING in this shell (the proxy needs it; no container ever sees it)'}`);
    lines.push(`  told preamble ${TOLD_PREAMBLE}: ${existsSync(join(ROOT, TOLD_PREAMBLE)) ? 'present' : 'absent (told rungs are skipped until the preregistration PR adds it)'}`);
    const b = existsSync(a.baseline) ? readBaseline(a.baseline) : null;
    lines.push(`  baseline ${a.baseline}: ${!existsSync(a.baseline) ? 'absent (no comparison)' : b ? `from run ${b.run_id}, gbrain ${b.gbrain.commit.slice(0, 12)}, written ${b.written_at}` : 'explicit empty baseline (no comparison)'}`);
  }
  console.log(lines.join('\n'));
  return 0;
}

// ---- the recall rung (internal-task) ---------------------------------------------------------------------------------------------
//
// bun scripts/gbrain-check.ts --gbrain <ref> --rungs recall [--recall-cases scripts/gbrain-check.recall.json]
//     [--recall-tasks <task id>,...] [--recall-baseline scripts/gbrain-check.recall.baseline.json] [--recall-target <task>=<n>]...
//     [--recall-routes] [--gbrain-config <key>=<value>]... [--resume <check dir>] [--write-baseline [--force]] [--dry-run]
//
// Keyless. Replays gbrain-memory-2026-10's own memory against a gbrain commit: for every trial a case names, a fresh member
// brain (the image's heldout-member brain, member scope, live ingestion) is started, every fact the run ingested in that trial
// is written again in event order with the same text, provenance, valid_from and source (world/services/gbrain-ingest.ts factFor
// over the post's text in events.jsonl), each remember carrying one request_id across its retries so a retry cannot insert
// twice, and at the seq of each case the exact read the harness sent (tool and arguments) is sent under the same member's
// token. Two oracles score each read: original (the needed message, needed_ids) and information (it or an accepted assistant
// restatement, restatement_ids), each through saved facts (gbrain-tap.ts describeCall) and through _meta.brain_hot_memory,
// counted apart. Before any sidecar starts, every fact text the run's tap recorded is checked against the replay's
// reconstruction of the same fact id, so a replay that would write different facts is refused (HE-GBRAIN-012).
//
// Pass rule: exit 1 when a case that passes the original oracle in the baseline receipt (--recall-baseline, the rung at gbrain
// master) fails now, or when a --recall-target task=N (the task's miss cases passing the original oracle) is not met; every
// other miss is a count. The reads that were themselves errors in the counted run are excluded from the rule and listed. A tool
// error, a replay write that never committed, or a degraded reply (a degraded stamp other than the keyword-only brain's own)
// is an error row, never a miss, and exits 4 (RECALL_ERROR_EXIT). --recall-routes adds, per consumer turn and on the same
// ingested state, the turn's question as search, query, recall and recall with the needed fact's entity (an upper bound),
// reported per route and outside the exit rule. Rows stream to recall/recall.jsonl after a header row; --resume <check dir>
// reuses that receipt only from a clean tree and when every header field matches (HE-GBRAIN-014), and replays every trial
// without a complete marker. --gbrain-config refuses secret and connection keys and credential URLs: receipts and the baseline
// record values.

export const RECALL_CASES = join('scripts', 'gbrain-check.recall.json');
export const RECALL_BASELINE = join('scripts', 'gbrain-check.recall.baseline.json');
export const RECALL_HOT_MEMORY = join('docs', 'benchmarks', '2026-10-26-gbrain-memory', 'results', 'hot-memory-blocks.json');
/** A recall run with error rows exits 4: 1 is a regression or a missed target, 2 a refusal, 3 the paid mode's INCOMPLETE. */
export const RECALL_ERROR_EXIT = 4;
export const RECALL_ROUTES = ['search', 'query', 'recall', 'recall_entity'] as const;
/** gbrain's own test for a secret config key (src/commands/config.ts); --gbrain-config refuses these. */
export const SECRET_CONFIG_KEY = /(^|[._-])(key|secret|token|password|pwd|passwd|auth)([._-]|$)/i;
/** Keys that point gbrain at another store (database_url and the like), whose values can carry a password; refused too. */
export const CONNECTION_CONFIG_KEY = /(^|[._-])(url|uri|dsn)([._-]|$)/i;
/** A value holding a URL with user info (scheme://user:password@host); refused under any key. */
export const CREDENTIAL_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@/i;
/** gbrain's stamps for a keyword-only brain, which the image builds: on every reply, so never a degradation of the replay. */
export const KEYWORD_ONLY_STAMPS = new Set(['embedding_disabled', 'keyword_only_embedding_disabled', 'keyword_only_no_embedding_provider']);

/** A fact named by its run fact id or by the post it was ingested from. */
export type FactRef = string | { channel: string; ts: string };
export interface RecallCase {
  id: string; kind: 'miss' | 'control'; task: string; harness: string; model: string; fact_type: string; turn: number; grant: string;
  tool: string; args: Record<string, unknown>; events: string; seq: number;
  needed: Array<{ id?: string; channel: string; ts: string; author: string; source: string }>;
  /** scripts/recall-audit.ts --cases: the requester's message at the consumer turn, the run fact ids of the needed original
   *  fact and of the accepted assistant restatements; without needed_ids every needed entry is the original. */
  question?: string | null; needed_ids?: FactRef[]; restatement_ids?: FactRef[];
}
export interface ReplayFact { seq: number; fact_id: string; channel: string; ts: string; author: string; source: string; fact: string; provenance: string; valid_from: string; harness_remember?: { grant: string; args: Record<string, unknown> } }
type RecallEvent = { seq: number; via: string; tool: string; outcome?: string; args?: Record<string, unknown>; effect?: Record<string, unknown>; grant?: string };

const factKey = (channel: string, ts: string) => channel + '/' + ts;

/** The facts the live ingestion wrote in one trial, rebuilt as the ingestion built them: the post's text from the same event log,
 *  the author from the world seed, the conversation from the ingest event (a DM's source is private-<member>). */
export function replayFacts(events: RecallEvent[], world: World): ReplayFact[] {
  const text = new Map<string, string>();
  for (const e of events) {
    const ts = e.effect?.ts, ch = e.effect?.channel ?? e.args?.channel, t = e.args?.text;
    if (typeof ts === 'string' && typeof ch === 'string' && typeof t === 'string') text.set(factKey(ch, ts), t);
  }
  const bot = world.members.find((m) => m.id === 'assistant') ?? ({ id: 'assistant', name: 'assistant', role: 'workspace bot' } as Member);
  const ingested = events.filter((e) => e.tool === 'gbrain.ingest' && e.outcome === 'ok' && e.effect?.fact_id != null && e.effect?.status !== 'duplicate').map((e): ReplayFact => {
    const a = e.args as { channel: string; ts: string; author: string; source: string };
    const body = text.get(factKey(a.channel, a.ts));
    if (body === undefined) throw new RunnerError('HE-GBRAIN-012', 'no post with channel ' + a.channel + ' ts ' + a.ts + ' in the event log for ingest seq ' + e.seq + '; the replay cannot rebuild that fact');
    const author = a.author === bot.id ? bot : world.members.find((m) => m.id === a.author);
    if (!author) throw new RunnerError('HE-GBRAIN-012', 'ingest seq ' + e.seq + ' names author ' + a.author + ', who is not in world/seed/world.json');
    const channel = a.source.startsWith('private-') ? { name: 'dm:' + [bot.id, a.source.slice('private-'.length)].sort().join('+'), kind: 'dm' } : (() => { const c = world.channels.find((x) => x.id === a.channel); if (!c) throw new RunnerError('HE-GBRAIN-012', 'ingest seq ' + e.seq + ' names channel ' + a.channel + ', which is not in world/seed/world.json'); return { name: c.name, kind: c.kind }; })();
    const posted = postedAt(a.ts, world.time_zone.offset_minutes);
    const { fact, provenance } = factFor({ text: body } as Message, author, channel, bot.id, posted);
    return { seq: e.seq, fact_id: String(e.effect!.fact_id), channel: a.channel, ts: a.ts, author: a.author, source: a.source, fact, provenance, valid_from: posted };
  });
  // The harness's own remember calls (outcome ok) are in the brain too, in the requesting member's private source; the tap does
  // not record the id gbrain gave them, and gbrain numbers facts in write order, so each takes the id after the write before it.
  const remembered: ReplayFact[] = events.filter((e) => e.via === 'gbrain' && e.tool === 'gbrain.remember' && e.outcome === 'ok').map((e) => ({ seq: e.seq, fact_id: '', channel: 'remember', ts: String(e.seq), author: bot.id, source: 'private-' + (e.grant ?? ''), fact: String(e.args?.fact ?? ''), provenance: String(e.args?.provenance ?? ''), valid_from: '', harness_remember: { grant: e.grant ?? 'public-only', args: e.args ?? {} } }));
  const all = [...ingested, ...remembered].sort((x, y) => x.seq - y.seq);
  for (const [i, f] of all.entries()) if (f.harness_remember) f.fact_id = String(i === 0 ? 1 : Number(all[i - 1]!.fact_id) + 1);
  return all;
}

/** Every fact text the counted run's tap recorded in this trial against the replay's text for the same id: the mismatches. */
export function replayMismatches(events: RecallEvent[], facts: ReplayFact[]): string[] {
  const byId = new Map(facts.map((f) => [f.fact_id, f.fact]));
  const out: string[] = [];
  for (const e of events) for (const f of (e.effect?.facts as Array<{ id?: unknown; fact?: unknown }> | undefined) ?? []) {
    const id = f.id === undefined ? null : String(f.id);
    const recorded = f.fact;
    if (id === null || typeof recorded !== 'string') continue;
    const mine = byId.get(id);
    if (mine === undefined) out.push('seq ' + e.seq + ' fact #' + id + ' has no ingest event');
    else if (mine.trim() !== recorded.trim() && !facts.some((x) => x.harness_remember && x.fact_id === id && recorded.includes(mine.trim()))) out.push('seq ' + e.seq + ' fact #' + id + ': recorded ' + JSON.stringify(recorded.slice(0, 80)) + ', replay ' + JSON.stringify(mine.slice(0, 80)));
  }
  return out;
}

/** The hot-memory block of a search reply (internal-task): _meta.brain_hot_memory on the result or on its JSON payload. */
export function hotMemoryOf(result: Record<string, unknown> | null): { source_id: string | null; facts: Array<{ id: string; fact: string }> } | null {
  if (!result) return null;
  for (const m of [result._meta, ...payloadsOf(result).map((p) => (p && typeof p === 'object' ? (p as { _meta?: unknown })._meta : undefined))]) {
    const b = m && typeof m === 'object' ? (m as { brain_hot_memory?: unknown }).brain_hot_memory : undefined;
    if (!b || typeof b !== 'object') continue;
    const o = b as { source_id?: unknown; facts?: unknown };
    const facts = (Array.isArray(o.facts) ? o.facts : []).map((f) => f as { id?: unknown; fact?: unknown }).filter((f) => f.id !== undefined).map((f) => ({ id: String(f.id), fact: typeof f.fact === 'string' ? f.fact : '' }));
    return { source_id: typeof o.source_id === 'string' ? o.source_id : null, facts };
  }
  return null;
}

/** The fact keys (channel/ts) of a case's two oracles: original (the needed message) and information (it or a restatement). */
export function oracleKeys(c: RecallCase, facts: ReplayFact[]): { original: string[]; information: string[] } {
  const keyOf = (r: FactRef): string | null => {
    if (typeof r !== 'string') return factKey(r.channel, r.ts);
    const n = c.needed.find((x) => x.id === r) ?? facts.find((f) => f.fact_id === r);
    return n ? factKey(n.channel, n.ts) : null;
  };
  const keys = (refs: FactRef[]) => [...new Set(refs.map(keyOf).filter((k): k is string => k !== null))];
  const original = keys(c.needed_ids ?? c.needed);
  return { original, information: [...new Set([...original, ...keys(c.restatement_ids ?? [])])] };
}

/** One oracle's verdict on a reply: which of its facts came back, through saved facts or the hot-memory block. */
export function judgeRecall(keys: string[], idOf: Map<string, string>, saved: Array<{ id?: unknown }>, hot: Array<{ id: string }>): { pass: boolean; ids: string[]; in_saved_facts: string[]; in_hot_memory: string[] } {
  const ids = keys.map((k) => idOf.get(k)).filter((x): x is string => x !== undefined);
  const savedIds = new Set(saved.map((f) => String(f.id)));
  const hotIds = new Set(hot.map((f) => f.id));
  const inSaved = ids.filter((id) => savedIds.has(id));
  const inHot = ids.filter((id) => hotIds.has(id));
  return { pass: inSaved.length > 0 || inHot.length > 0, ids, in_saved_facts: inSaved, in_hot_memory: inHot };
}

const payloadsOf = (result: Record<string, unknown>): unknown[] => {
  const out: unknown[] = [];
  for (const c of Array.isArray(result.content) ? result.content as Array<{ text?: unknown }> : []) {
    if (typeof c.text !== 'string' || !/^\s*[[{]/.test(c.text)) continue;
    try { out.push(JSON.parse(c.text)); } catch { /* prose */ }
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') out.push(result.structuredContent);
  return out;
};

/** gbrain's degraded stamps on a read: _meta.retrieval.degraded reasons (search, query), search_degraded and
 *  facts_degraded.reason (recall) and a projection that is not ready. The keyword-only stamps are on every reply of this brain;
 *  any other stamp marks a degraded reply, which is counted apart from misses. */
export function degradedOf(result: Record<string, unknown> | null): { keyword_only: boolean; degraded: string[] } {
  if (!result) return { keyword_only: false, degraded: [] };
  const stamps: string[] = [];
  const retrieval = (result._meta as { retrieval?: { degraded?: unknown; projection_readiness?: { ready?: unknown } } } | undefined)?.retrieval;
  for (const d of Array.isArray(retrieval?.degraded) ? retrieval!.degraded as Array<{ stage?: unknown; reason?: unknown }> : []) stamps.push(String(d.reason ?? d.stage));
  if (retrieval?.projection_readiness?.ready === false) stamps.push('projection_not_ready');
  for (const p of payloadsOf(result)) {
    const o = (p && typeof p === 'object' ? p : {}) as { search_degraded?: unknown; facts_degraded?: { reason?: unknown } };
    if (typeof o.search_degraded === 'string') stamps.push(o.search_degraded);
    if (typeof o.facts_degraded?.reason === 'string') stamps.push(o.facts_degraded.reason);
  }
  return { keyword_only: stamps.some((s) => KEYWORD_ONLY_STAMPS.has(s)), degraded: [...new Set(stamps.filter((s) => !KEYWORD_ONLY_STAMPS.has(s)))] };
}

/** The figures (numbers) of a fact, read after the "<who> wrote in <where> on <date> <time>: " header the ingestion adds. */
export function figuresOf(fact: string): string[] {
  return [...new Set(fact.replace(/^[\s\S]*? on \d{4}-\d{2}-\d{2} \d{2}:\d{2}: /, '').match(/\d+(?:[.,]\d+)*/g) ?? [])];
}

/** #92's results/hot-memory-blocks.json, Hermes only: per read (cell/task/rep#seq) the block's source_id and fact count, or null
 *  when the read carried no block or an empty one. The file holds counts by position, not fact ids. */
export type HotMemoryIndex = Map<string, { source_id: string; facts: number } | null>;
export function loadHotMemoryIndex(path: string): HotMemoryIndex {
  const file = JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as { trials: Array<{ cell: string; task: string; rep: string; calls: Array<{ seq: number; hot_memory: { source_id: string; facts: number } | null }> }> };
  const index: HotMemoryIndex = new Map();
  for (const t of file.trials) for (const c of t.calls) index.set(t.cell + '/' + t.task + '/' + t.rep + '#' + c.seq, c.hot_memory && c.hot_memory.facts > 0 ? { source_id: c.hot_memory.source_id, facts: c.hot_memory.facts } : null);
  return index;
}

/** The rule against #92's file: the replay agrees when neither read carried a block, or both carried one from the same
 *  source_id with the same number of facts. */
export function hotMemoryAgrees(recorded: { source_id: string; facts: number } | null, replay: { source_id: string | null; facts: unknown[] } | null): boolean {
  const mine = replay && replay.facts.length > 0 ? replay : null;
  if (!recorded || !mine) return !recorded && !mine;
  return recorded.source_id === mine.source_id && recorded.facts === mine.facts.length;
}

type McpReply = { result?: Record<string, unknown>; error?: { code?: number; message?: string } };
type McpCall = { status: number | null; reply: McpReply | undefined; request: { jsonrpc: string; id: number; method: string; params: Record<string, unknown> }; error?: string; ms: number };
async function mcpCall(url: string, token: string, name: string, args: Record<string, unknown>): Promise<McpCall> {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  const started = Date.now();
  try {
    const res = await fetch(url + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(request), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    const reply = parseRpcBody(text, res.headers.get('content-type')).find((r) => String(r.id) === '1') as McpReply | undefined;
    return { status: res.status, reply, request, ms: Date.now() - started };
  } catch (e) {
    return { status: null, reply: undefined, request, error: 'transport: ' + (e as Error).message, ms: Date.now() - started };
  }
}

/** The live ingestion's resend schedule and retry_after_ms cap (world/services/gbrain-ingest.ts RETRY_WAITS_MS, RETRY_AFTER_CAP_MS). */
const REMEMBER_RETRY_WAITS_MS = [500, 1500];
const REMEMBER_RETRY_AFTER_CAP_MS = 10_000;
/** One remember of the replay, classified in the live ingestion's order (gbrain-ingest.ts exchange): a transport failure or a
 *  5xx is resent; any other non-2xx, a missing reply and an RPC error are final; a tool error is resent when it is a pending
 *  write (write_error write_pending or queue_capacity) or stamped retryable, and final otherwise. Three attempts in all, after
 *  0.5 and 1.5 s, or the write_request.retry_after_ms gbrain asks for when longer (capped at 10 s). The request_id is fixed before the
 *  first attempt, so a retry asks gbrain for the same write and cannot insert the fact twice. */
export async function rememberFact(url: string, token: string, f: ReplayFact): Promise<{ id: string; entity: string | null } | { error: string }> {
  const attempts = REMEMBER_RETRY_WAITS_MS.length + 1;
  const args = { ...(f.harness_remember ? f.harness_remember.args : { fact: f.fact, provenance: f.provenance, valid_from: f.valid_from, source_id: f.source }), request_id: crypto.randomUUID() };
  let last = '';
  for (let attempt = 1; ; attempt++) {
    const r = await mcpCall(url, token, 'remember', args);
    const payload = (r.reply?.result ? payloadsOf(r.reply.result).find((p) => p && typeof p === 'object' && !Array.isArray(p)) : null) as { id?: unknown; status?: unknown; entity_slug?: unknown; retryable?: unknown; code?: unknown; write_error?: unknown; write_request?: { retry_after_ms?: unknown } } | null;
    const refused = (why: string) => ({ error: 'remember of ingest seq ' + f.seq + ' into ' + f.source + ' was refused: ' + why });
    let retryAfter = 0;
    if (r.status === null || r.status >= 500) last = r.error ?? 'upstream_' + r.status;
    else if (r.status < 200 || r.status >= 300) return refused('upstream_' + r.status);
    else if (!r.reply) return refused('no_response');
    else if (r.reply.error) return refused('rpc_' + (r.reply.error.code ?? 'error'));
    else if (r.reply.result?.isError) {
      last = String(payload?.write_error ?? payload?.code ?? 'tool_error');
      if (!RETRYABLE_CODES.has(last) && payload?.retryable !== true) return refused(last + ' ' + JSON.stringify(payload).slice(0, 200));
      const after = payload?.write_request?.retry_after_ms;
      retryAfter = typeof after === 'number' && after > 0 ? Math.min(after, REMEMBER_RETRY_AFTER_CAP_MS) : 0;
    } else if (payload && (payload.status === 'inserted' || payload.status === 'duplicate') && payload.id != null) return { id: String(payload.id), entity: typeof payload.entity_slug === 'string' ? payload.entity_slug : null };
    else return refused('remember answered status ' + String(payload?.status) + (payload?.id == null ? ', no id' : ''));
    const wait = REMEMBER_RETRY_WAITS_MS[attempt - 1];
    if (wait === undefined) break;
    await Bun.sleep(Math.max(wait, retryAfter));
  }
  return { error: 'remember of ingest seq ' + f.seq + ' into ' + f.source + ' did not commit after ' + attempts + ' attempts under request_id ' + args.request_id + ': ' + last };
}

/** The trial's sidecar as the replay sees it: where it answers and the tokens it holds. */
export interface RecallSidecar {
  url: string; members: Record<string, string>; public_only: string; sources: Record<string, string>;
  config: Array<{ key: string; value: string; read_back: string }>; ready_ms: number; stop(): Promise<void>;
}

/** One trial of the plan: its cases in seq order, the facts to write, what the counted run returned per read, and the case ids
 *  excluded from the pass rule (their counted read was itself an error) with the reason. */
export interface RecallTrial { events: string; cases: RecallCase[]; facts: ReplayFact[]; runSaved: Map<number, string[]>; excluded: Map<string, string> }

type Saved = { id: string | null; fact: string; entity_slug: string | null };
/** A read and its verdicts under both oracles; an error reply keeps its error and passes neither. pass_original is null when the
 *  case names no original fact in reach (only restatements), so it is neither a pass nor a miss. */
async function readAndJudge(url: string, token: string, tool: string, args: Record<string, unknown>, keys: { original: string[]; information: string[] }, idOf: Map<string, string>) {
  const r = await mcpCall(url, token, tool, args);
  const d = describeCall(r.request as never, r.reply as never, r.ms, r.status);
  const saved: Saved[] = ((d?.effect.facts ?? []) as Array<{ id?: unknown; fact: string; entity_slug?: unknown }>).map((f) => ({ id: f.id === undefined ? null : String(f.id), fact: f.fact, entity_slug: typeof f.entity_slug === 'string' ? f.entity_slug : null }));
  const hot = hotMemoryOf(r.reply?.result ?? null);
  const original = judgeRecall(keys.original, idOf, saved, hot?.facts ?? []);
  const information = judgeRecall(keys.information, idOf, saved, hot?.facts ?? []);
  const result = r.reply?.result;
  const error = r.error ?? (d?.outcome === 'error' ? d.error ?? 'error' : !result || typeof result !== 'object' || !Array.isArray(result.content) ? 'malformed_result: the reply carries no tool result with a content array' : undefined);
  return {
    outcome: error ? 'error' : 'ok', ...(error ? { error } : {}), ...degradedOf(r.reply?.result ?? null),
    pass_original: error ? false : keys.original.length ? original.pass : null, pass_information: !error && information.pass,
    needed_ids: original.ids, restatement_ids: information.ids.filter((id) => !original.ids.includes(id)),
    in_saved_facts: original.in_saved_facts, in_hot_memory: original.in_hot_memory, information_in_saved_facts: information.in_saved_facts, information_in_hot_memory: information.in_hot_memory,
    saved_facts: saved, hot_memory: hot ? { source_id: hot.source_id, ids: hot.facts.map((f) => f.id) } : null, hot_memory_block: hot, pages: d?.effect.pages ?? [],
  };
}

/** Replays one trial into the sidecar and emits its rows: one per case, and with routes one per route and consumer turn, asked
 *  once at the turn's first read. A write that never committed turns every later read of the trial into an error row. A missing
 *  token is a refusal (HE-GBRAIN-012), since the brain cannot hold the run's facts. Returns the trial's error rows. */
export async function replayTrial(p: RecallTrial, sc: RecallSidecar, o: { routes: boolean; hot: HotMemoryIndex | null }, emit: (row: Record<string, unknown>) => void): Promise<number> {
  const idOf = new Map<string, string>();
  const entityOf = new Map<string, string | null>();
  const renumbered: string[] = [];
  const asked = new Set<number>();
  let next = 0, broken: string | null = null, errors = 0;
  const memberToken = (grant: string) => {
    const t = grant === 'public-only' ? sc.public_only : sc.members[grant];
    if (!t) throw new RunnerError('HE-GBRAIN-012', 'the sidecar holds no member token for ' + grant);
    return t;
  };
  const keyOfRunId = new Map(p.facts.map((f) => [f.fact_id, factKey(f.channel, f.ts)]));
  for (const c of p.cases) {
    while (broken === null && next < p.facts.length && p.facts[next]!.seq < c.seq) {
      const f = p.facts[next++]!;
      const token = f.harness_remember ? memberToken(f.harness_remember.grant) : sc.sources[f.source];
      if (!token) throw new RunnerError('HE-GBRAIN-012', 'the sidecar holds no ingest token for source ' + f.source);
      const w = await rememberFact(sc.url, token, f);
      if ('error' in w) { broken = w.error; break; }
      idOf.set(factKey(f.channel, f.ts), w.id);
      entityOf.set(factKey(f.channel, f.ts), w.entity);
      if (w.id !== f.fact_id) renumbered.push(f.fact_id + '->' + w.id);
    }
    const keys = oracleKeys(c, p.facts);
    const excluded = p.excluded.get(c.id) ?? null;
    const base = { type: 'case', trial: p.events, id: c.id, kind: c.kind, task: c.task, harness: c.harness, model: c.model, fact_type: c.fact_type, turn: c.turn, grant: c.grant, tool: c.tool, args: c.args, excluded };
    const token = memberToken(c.grant);
    if (broken !== null) {
      const row = { ...base, outcome: 'error', error: 'replay write failed: ' + broken, pass_original: false, pass_information: false };
      emit(row);
      if (unscored(row)) errors += 1;
    } else {
      const { hot_memory_block, ...v } = await readAndJudge(sc.url, token, c.tool, c.args, keys, idOf);
      const runSaved = (p.runSaved.get(c.seq) ?? []).map((id) => idOf.get(keyOfRunId.get(id) ?? '') ?? 'run#' + id).sort();
      const replaySaved = v.saved_facts.map((f) => String(f.id)).sort();
      const recorded = c.harness === 'hermes' && o.hot ? o.hot.get(c.id) : undefined;
      const row = { ...base, ...v, needed_text: keys.original.map((k) => p.facts.find((f) => factKey(f.channel, f.ts) === k)?.fact ?? ''),
        run_saved_facts: runSaved, same_saved_facts_as_run: JSON.stringify(runSaved) === JSON.stringify(replaySaved), renumbered: [...renumbered],
        ...(recorded !== undefined ? { hermes_hot_memory: { recorded, agrees: hotMemoryAgrees(recorded, hot_memory_block) } } : {}) };
      emit(row);
      if (unscored(row)) errors += 1;
    }
    if (!o.routes || asked.has(c.turn)) continue;
    asked.add(c.turn);
    const entity = keys.original.map((k) => entityOf.get(k)).find((e): e is string => typeof e === 'string') ?? null;
    const needed = p.facts.find((f) => keys.original.includes(factKey(f.channel, f.ts)));
    const neededId = needed ? idOf.get(factKey(needed.channel, needed.ts)) : undefined;
    const figures = needed ? figuresOf(needed.fact) : [];
    for (const route of RECALL_ROUTES) {
      const question = c.question ?? '';
      const args = route === 'search' || route === 'query' ? { query: question } : route === 'recall' ? { question } : { question, entity };
      const rbase = { type: 'route', trial: p.events, case: c.id, task: c.task, harness: c.harness, model: c.model, turn: c.turn, grant: c.grant, route, tool: route === 'recall_entity' ? 'recall' : route, args, entity };
      if (broken !== null) { emit({ ...rbase, outcome: 'error', error: 'replay write failed: ' + broken, pass_original: false, pass_information: false }); continue; }
      if (route === 'recall_entity' && entity === null) { emit({ ...rbase, outcome: 'n/a', reason: keys.original.length ? 'the needed original fact was stored with no entity' : 'the case names no original fact (only restatements), so there is no entity to pass', pass_original: keys.original.length ? false : null, pass_information: false }); continue; }
      const { hot_memory_block, ...v } = await readAndJudge(sc.url, token, rbase.tool, args, keys, idOf);
      const crossEntity = route !== 'recall' ? [] : v.saved_facts.filter((f) => f.entity_slug !== null && f.entity_slug !== entity && f.id !== neededId)
        .flatMap((f) => figuresOf(f.fact).filter((x) => figures.includes(x)).map((figure) => ({ fact_id: f.id, entity: f.entity_slug, figure })));
      emit({ ...rbase, ...v, ...(route === 'recall' ? { cross_entity_figures: crossEntity } : {}) });
    }
  }
  return errors;
}

/** The plan: cases grouped by trial, each trial's facts rebuilt and checked against the run's tap, and the counted reads that
 *  were themselves errors excluded with their error. Refuses a task filter naming no case and routes without questions. */
export function planRecall(path: string, tasks: string[] | null, routes: boolean, targets: string[] = []): { cases: RecallCase[]; trials: RecallTrial[]; sha256: string } {
  const text = readFileSync(resolve(ROOT, path), 'utf8');
  const all = (JSON.parse(text) as { cases: RecallCase[] }).cases;
  const cases = all.filter((c) => !tasks || tasks.includes(c.task));
  for (const [flag, names, among] of [['--recall-tasks', tasks ?? [], all], ['--recall-target', targets, cases]] as const) {
    const unknown = names.filter((t) => !among.some((c) => c.task === t));
    if (unknown.length) throw new RunnerError('HE-RUN-002', flag + ' names ' + unknown.join(', ') + ', which no case in ' + path + (among === all ? '' : ' under --recall-tasks') + ' has; tasks are exact ids: ' + [...new Set(among.map((c) => c.task))].sort().join(', '));
  }
  if (!cases.length) throw new RunnerError('HE-RUN-002', 'no recall case in ' + path);
  const bare = routes ? cases.filter((c) => typeof c.question !== 'string' || !c.question.trim()) : [];
  if (bare.length) throw new RunnerError('HE-RUN-002', '--recall-routes needs each case\'s question; ' + bare.length + ' case(s) in ' + path + ' have none (first ' + bare[0]!.id + '); regenerate it with scripts/recall-audit.ts --cases');
  const world = JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')) as World;
  const byTrial = new Map<string, RecallCase[]>();
  for (const c of cases) { if (!byTrial.has(c.events)) byTrial.set(c.events, []); byTrial.get(c.events)!.push(c); }
  const trials = [...byTrial.entries()].map(([events, cs]): RecallTrial => {
    const log = readFileSync(resolve(ROOT, events), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RecallEvent & { error?: string });
    const facts = replayFacts(log, world);
    const bad = replayMismatches(log, facts);
    if (bad.length) throw new RunnerError('HE-GBRAIN-012', 'the replay of ' + events + ' would not write the facts the run wrote: ' + bad.slice(0, 3).join('; '));
    const runSaved = new Map(log.filter((e) => e.via === 'gbrain').map((e) => [e.seq, ((e.effect?.facts as Array<{ id?: unknown }> | undefined) ?? []).map((f) => String(f.id))]));
    const written = new Map(facts.map((f) => [factKey(f.channel, f.ts), f.seq]));
    for (const c of cs) for (const ref of [...(c.needed_ids ?? c.needed), ...(c.restatement_ids ?? [])]) {
      const key = oracleKeys({ ...c, needed_ids: [ref], restatement_ids: [] }, facts).original[0];
      if (key === undefined || !((written.get(key) ?? Infinity) < c.seq)) throw new RunnerError('HE-GBRAIN-012', c.id + ' names ' + JSON.stringify(ref) + ', which ' + (key === undefined ? 'resolves to no fact of ' + events : 'the replay does not write before the read (seq ' + c.seq + ')') + '; regenerate the cases with scripts/recall-audit.ts --cases');
    }
    const excluded = new Map<string, string>();
    for (const c of cs) { const e = log.find((x) => x.seq === c.seq); if (e && e.outcome !== 'ok') excluded.set(c.id, 'the counted read was an error (' + (e.error ?? e.outcome) + ')'); }
    return { events, cases: cs.sort((x, y) => x.seq - y.seq), facts, runSaved, excluded };
  });
  return { cases, trials, sha256: sha256(text) };
}

export interface RecallHeader {
  type: 'header'; schema: 1; harness_evals_commit: string; dirty: boolean; cases_file: string; cases_sha256: string; recall_tasks: string[] | null; routes: boolean;
  image: string; image_id: string | null; gbrain_commit: string | null; gbrain_version: string | null; gbrain_config: Array<{ key: string; value: string }>;
}

/** --resume: the receipt's rows of every complete trial, refused (HE-GBRAIN-014) from a dirty tree, over a line that is not JSON
 *  (other than a torn last line, which is dropped), or unless its header matches field for field. A trial with no complete
 *  marker (cut off, or with error rows) is dropped and replayed from scratch. */
export function resumeReceipt(path: string, header: RecallHeader): { rows: Record<string, unknown>[]; done: Set<string> } {
  if (!existsSync(path)) throw new RunnerError('HE-GBRAIN-014', '--resume names no receipt: ' + path + ' does not exist');
  if (header.dirty) throw new RunnerError('HE-GBRAIN-014', '--resume refused: the tree is dirty, and two different uncommitted trees at one commit would merge into one verdict; commit, then start a new run without --resume');
  const parts = readFileSync(path, 'utf8').split('\n');
  const tail = parts.pop()!;
  const lines = parts.flatMap((l, i) => {
    if (!l.trim()) return [];
    try { return [JSON.parse(l) as Record<string, unknown>]; } catch { throw new RunnerError('HE-GBRAIN-014', '--resume refused: line ' + (i + 1) + ' of ' + path + ' is not a JSON row; only a torn last line (an append cut off before its newline) is dropped'); }
  });
  try { if (tail.trim()) lines.push(JSON.parse(tail) as Record<string, unknown>); } catch { /* an append cut off before its newline: its trial has no complete marker, so it is replayed */ }
  const old = lines[0];
  if (old?.type !== 'header') throw new RunnerError('HE-GBRAIN-014', '--resume refused: ' + path + ' does not start with a header row');
  const now = header as unknown as Record<string, unknown>;
  const differ = [...new Set([...Object.keys(old), ...Object.keys(now)])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(now[k]));
  if (differ.length) throw new RunnerError('HE-GBRAIN-014', '--resume refused: ' + path + ' was written under another ' + differ.map((k) => k + ' (' + JSON.stringify(old[k]) + ' there, ' + JSON.stringify(now[k]) + ' now)').join(', ') + '; start a new run without --resume');
  const done = new Set(lines.filter((r) => r.type === 'trial' && r.complete === true).map((r) => String(r.trial)));
  return { rows: lines.slice(1).filter((r) => r.type !== 'summary' && done.has(String(r.trial))), done };
}

export interface RecallBaseline {
  schema: 1; source: string; header: Omit<RecallHeader, 'type'>;
  cases: Record<string, { original: boolean | null; information: boolean; outcome: string }>;
  routes: Record<string, Record<string, boolean | null>>;
}

export function readRecallBaseline(path: string, casesSha: string): RecallBaseline {
  if (!existsSync(path)) throw new RunnerError('HE-GBRAIN-014', 'no recall baseline at ' + path + '; write one from a complete run at gbrain master with --write-baseline, pass --recall-baseline <file>, or --recall-baseline none to compare against nothing');
  const b = (() => { try { return JSON.parse(readFileSync(path, 'utf8')) as RecallBaseline; } catch { return null; } })();
  if (!b || b.schema !== 1 || !b.header || typeof b.header.cases_sha256 !== 'string' || !b.cases || typeof b.cases !== 'object') throw new RunnerError('HE-GBRAIN-014', path + ' does not have the recall baseline shape (schema 1, header, cases, routes)');
  if (b.header.cases_sha256 !== casesSha) throw new RunnerError('HE-GBRAIN-014', path + ' was written from cases ' + b.header.cases_sha256.slice(0, 12) + ', this run reads ' + casesSha.slice(0, 12) + '; a baseline compares only the same cases file');
  return b;
}

export function recallBaselineOf(rows: Record<string, unknown>[], header: RecallHeader): RecallBaseline {
  const { type: _type, ...h } = header;
  const cases: RecallBaseline['cases'] = {};
  for (const r of rows.filter((x) => x.type === 'case')) cases[String(r.id)] = { original: r.pass_original === null ? null : r.pass_original === true, information: r.pass_information === true, outcome: String(r.outcome) };
  const routes: RecallBaseline['routes'] = {};
  for (const r of rows.filter((x) => x.type === 'route')) (routes[String(r.trial) + '#t' + r.turn] ??= {})[String(r.route)] = r.outcome === 'ok' ? r.pass_original === true : null;
  return { schema: 1, source: 'bun scripts/gbrain-check.ts --rungs recall --write-baseline: the rung\'s verdicts at gbrain ' + (header.gbrain_commit ?? 'unknown') + ', the pass rule\'s reference', header: h, cases, routes };
}

/** --write-baseline under the recall rung: refused (HE-GBRAIN-010) over a run with error or degraded rows, or over an existing
 *  file without --force; with it the old file is kept as .prev. parseArgs refuses a filtered, configured or unnamed baseline. */
export function writeRecallBaseline(path: string, rows: Record<string, unknown>[], header: RecallHeader, exit: number, force: boolean): void {
  if (exit === RECALL_ERROR_EXIT) throw new RunnerError('HE-GBRAIN-010', 'a recall baseline is written only from a run with no error or degraded row; nothing written');
  if (existsSync(path) && !force) throw new RunnerError('HE-GBRAIN-010', path + ' exists; pass --force to replace it (the old file is kept as .prev)');
  if (existsSync(path)) copyFileSync(path, path + '.prev');
  writeFileSync(path, JSON.stringify(recallBaselineOf(rows, header), null, 1) + '\n');
}

/** A case row the pass rule does not score: not excluded, and an error or a miss whose reply carried a degraded stamp. The
 *  replay leaves a trial with such a row without its complete marker, so --resume replays it. */
export function unscored(r: Record<string, unknown>): boolean {
  return !r.excluded && (r.outcome === 'error' || (r.outcome === 'ok' && r.pass_original === false && ((r.degraded as string[] | undefined)?.length ?? 0) > 0));
}

/** The pass rule over a run's case rows. Error and degraded rows are never misses: any of them exits 4. Else a case that passes
 *  the original oracle in the baseline and fails now, or a target the task's miss cases do not reach, exits 1. Excluded cases
 *  are listed and never counted. */
export function recallVerdict(rows: Record<string, unknown>[], o: { baseline: RecallBaseline | null; targets: Array<{ task: string; n: number }> }) {
  const cases = rows.filter((r) => r.type === 'case');
  const judged = cases.filter((r) => !r.excluded);
  const errors = judged.filter((r) => unscored(r) && r.outcome === 'error').map((r) => String(r.id));
  const degraded = judged.filter((r) => unscored(r) && r.outcome !== 'error').map((r) => String(r.id));
  const misses = judged.filter((r) => r.outcome === 'ok' && r.pass_original === false && !unscored(r));
  const regressions = o.baseline ? misses.filter((r) => o.baseline!.cases[String(r.id)]?.original === true).map((r) => String(r.id)) : [];
  const targets = o.targets.map((t) => { const got = judged.filter((r) => r.task === t.task && r.kind === 'miss' && r.pass_original === true).length; return { ...t, got, met: got >= t.n }; });
  const exit = errors.length || degraded.length ? RECALL_ERROR_EXIT : regressions.length || targets.some((t) => !t.met) ? 1 : 0;
  return { exit, errors, degraded, misses: misses.map((r) => String(r.id)), regressions, targets, excluded: cases.filter((r) => r.excluded).map((r) => ({ id: String(r.id), reason: String(r.excluded) })) };
}

const count = <T,>(rows: T[], f: (r: T) => boolean) => rows.filter(f).length;
type Row = Record<string, unknown>;
const ids = (r: Row, k: string) => (r[k] as string[] | undefined) ?? [];

/** The per-group counts of one table row: original passes split by saved facts and hot memory only, information passes. */
function passCounts(rs: Row[]) {
  const pass = rs.filter((r) => r.pass_original === true);
  const viaSaved = count(pass, (r) => ids(r, 'in_saved_facts').length > 0);
  return { n: rs.length, pass: pass.length, viaSaved, hotOnly: pass.length - viaSaved, noOriginal: count(rs, (r) => r.pass_original === null), information: count(rs, (r) => r.pass_information === true) };
}

/** recall.md: the exact replay per task and kind, Hermes's hot memory against #92, the routes one table each, then every
 *  regression, target, excluded case, error row and failing case. */
export function renderRecall(rows: Row[], header: RecallHeader, v: ReturnType<typeof recallVerdict>, baseline: RecallBaseline | null, elapsedMs: number): string {
  const cases = rows.filter((r) => r.type === 'case');
  const L: string[] = ['# gbrain-check recall: gbrain ' + (header.gbrain_commit ?? 'unknown') + (header.gbrain_version ? ' (' + header.gbrain_version + ')' : '') + ', image ' + header.image, '',
    'harness-evals ' + header.harness_evals_commit + (header.dirty ? ' (dirty tree)' : '') + '; cases ' + header.cases_file + ' (sha256 ' + header.cases_sha256.slice(0, 12) + ')' + (header.recall_tasks ? ', tasks ' + header.recall_tasks.join(', ') : '') + '; image id ' + (header.image_id ?? 'unknown') + '; gbrain config ' + (header.gbrain_config.length ? header.gbrain_config.map((c) => c.key + '=' + c.value).join(', ') : 'none') + '; ' + Math.round(elapsedMs / 60_000) + ' min.', '',
    'Original oracle: the needed message came back in saved facts or in _meta.brain_hot_memory (no original fact: the case names only restatements, so it is neither a pass nor a miss). Information oracle: it or an accepted assistant restatement did. The pass rule reads the original oracle against the baseline (' + (baseline ? 'gbrain ' + (baseline.header.gbrain_commit ?? 'unknown').slice(0, 12) : 'none') + '). Degraded: a miss whose reply carried a degraded stamp other than the keyword-only brain\'s own. Error: a tool error or a replay write that never committed. Neither counts as a miss.', '',
    '## Exact replay', '', '| task | kind | cases | original | via saved facts | via hot memory only | no original fact | information | degraded | errors | excluded | lost against baseline |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const t of [...new Set(cases.map((r) => String(r.task)))].sort()) for (const kind of ['miss', 'control']) {
    const rs = cases.filter((r) => r.task === t && r.kind === kind);
    if (!rs.length) continue;
    const c = passCounts(rs);
    L.push('| ' + [t, kind, c.n, c.pass, c.viaSaved, c.hotOnly, c.noOriginal, c.information, count(rs, (r) => v.degraded.includes(String(r.id))), count(rs, (r) => v.errors.includes(String(r.id))), count(rs, (r) => !!r.excluded), count(rs, (r) => v.regressions.includes(String(r.id)))].join(' | ') + ' |');
  }
  const answered = cases.filter((r) => r.outcome === 'ok');
  const hermes = cases.filter((r) => r.hermes_hot_memory);
  L.push('', count(cases, (r) => r.same_saved_facts_as_run === true) + ' of ' + cases.length + ' replayed reads returned the same saved facts as the counted run. ' + count(answered, (r) => r.keyword_only === true) + ' of ' + answered.length + ' answered reads carried the keyword-only stamp.',
    '', 'Hermes hot memory against #92 (results/hot-memory-blocks.json, counts by position): ' + count(hermes, (r) => (r.hermes_hot_memory as { agrees: boolean }).agrees) + ' of ' + hermes.length + ' Hermes reads agree (no block in either, or a block from the same source_id with the same number of facts in both).');
  const routes = rows.filter((r) => r.type === 'route');
  if (routes.length) {
    L.push('', '## Routes', '', 'Per consumer turn, on the replay\'s ingested state at the turn\'s first read, the turn\'s question sent four ways under the requester\'s grant. recall_entity passes the entity gbrain stored on the needed original fact (remember\'s entity_slug) and is an upper bound; n/a when that fact has no entity. Outside the exit rule.');
    for (const route of RECALL_ROUTES) {
      const rr = routes.filter((r) => r.route === route);
      L.push('', '### ' + route, '', '| task | turns | original | via saved facts | via hot memory only | information | degraded | errors | n/a |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
      for (const t of [...new Set(rr.map((r) => String(r.task)))].sort()) {
        const rs = rr.filter((r) => r.task === t);
        const c = passCounts(rs);
        L.push('| ' + [t, c.n, c.pass, c.viaSaved, c.hotOnly, c.information, count(rs, (r) => r.outcome === 'ok' && r.pass_original === false && ids(r, 'degraded').length > 0), count(rs, (r) => r.outcome === 'error'), count(rs, (r) => r.outcome === 'n/a')].join(' | ') + ' |');
      }
      if (route === 'recall') L.push('', 'Turns where a figure of the needed fact came back in a fact gbrain filed under another entity: ' + count(rr, (r) => ids(r, 'cross_entity_figures').length > 0) + ' of ' + rr.length + '.');
    }
  }
  L.push('', '## Pass rule', '', v.regressions.length ? 'Lost against the baseline (' + v.regressions.length + '): ' + v.regressions.join(', ') : 'Lost against the baseline: none.');
  for (const t of v.targets) L.push('', 'Target ' + t.task + ' >= ' + t.n + ' miss cases: ' + t.got + (t.met ? ' (met)' : ' (NOT met)'));
  L.push('', 'Excluded from the rule (' + v.excluded.length + '): ' + (v.excluded.map((x) => x.id + ': ' + x.reason).join('; ') || 'none'));
  if (v.errors.length || v.degraded.length) L.push('', 'Error rows (' + v.errors.length + '): ' + (v.errors.join(', ') || 'none'), '', 'Degraded rows (' + v.degraded.length + '): ' + (v.degraded.join(', ') || 'none'));
  L.push('', '## Failing cases', '', '| case | grant | tool: arguments | needed | saved facts returned | hot memory |', '|---|---|---|---|---|---|');
  for (const r of cases.filter((x) => x.outcome === 'ok' && x.pass_original === false)) L.push('| ' + [r.id, r.grant, r.tool + ': ' + JSON.stringify(r.args).replace(/\|/g, '/'), ids(r, 'needed_ids').map((x) => '#' + x).join(', '), (r.saved_facts as Saved[]).map((f) => '#' + f.id).join(', '), ((r.hot_memory as { ids: string[] } | null)?.ids ?? []).map((x) => '#' + x).join(', ')].join(' | ') + ' |');
  return L.join('\n') + '\n';
}

/** --gbrain-config on a running rung sidecar. gbrain serve holds the brain's PGLite lock, so gbrain config set cannot run
 *  beside it (pglite_busy) and gbrain has no config operation over MCP: the sidecar is stopped, the key is set and read back
 *  with gbrain config get on a copy of its brain in a one-off container from the same image (no network), the copy replaces
 *  the brain the entrypoint serves from inside this container only (/brains/<split>-member), and the container is started
 *  again, so the entrypoint copies the configured brain to /brain and serve starts with the key in place. */
export function gbrainConfigCommands(o: { container: string; image: string; brainDir: string; split: 'dev' | 'heldout'; user: string; settings: Array<{ key: string; value: string }> }): { stop: string[]; copyOut: string[]; set: string[][]; get: string[][]; copyIn: string[]; start: string[] } {
  const cli = (args: string[]) => ['docker', 'run', '--rm', '--network', 'none', '--user', o.user, '-v', o.brainDir + ':/brain/.gbrain', '-e', 'GBRAIN_HOME=/brain', '-e', 'HOME=/tmp', '-e', 'GBRAIN_SKIP_STARTUP_HOOKS=1', '-e', 'NO_COLOR=1', '--entrypoint', 'bun', o.image, '/opt/gbrain/src/cli.ts', 'config', ...args];
  return {
    stop: ['docker', 'stop', '-t', '10', o.container],
    copyOut: ['docker', 'cp', '-a', o.container + ':/brain/.gbrain', o.brainDir],
    set: o.settings.map((s) => cli(['set', s.key, s.value])),
    get: o.settings.map((s) => cli(['get', s.key])),
    copyIn: ['docker', 'cp', '-a', o.brainDir + '/.', o.container + ':/brains/' + o.split + '-member/.gbrain'],
    start: ['docker', 'start', o.container],
  };
}

async function applyGbrainConfig(container: string, image: string, outDir: string, settings: Array<{ key: string; value: string }>): Promise<{ url: string; read_back: Array<{ key: string; value: string; read_back: string }> }> {
  const brainDir = join(outDir, 'config-brain');
  const cmds = gbrainConfigCommands({ container, image, brainDir, split: 'heldout', user: process.getuid!() + ':' + process.getgid!(), settings });
  const run = (argv: string[], what: string) => { const r = sh(argv, { timeoutMs: 120_000 }); if (r.status !== 0) throw new RunnerError('HE-GBRAIN-015', '--gbrain-config: ' + what + ' failed: ' + (r.stderr || r.stdout).trim().slice(0, 300)); return r.stdout.trim(); };
  run(cmds.stop, 'stopping the sidecar');
  rmSync(brainDir, { recursive: true, force: true });
  run(cmds.copyOut, 'copying its brain out');
  for (const f of readdirSync(brainDir)) if (f.endsWith('.lock')) rmSync(join(brainDir, f), { force: true });
  rmSync(join(brainDir, 'persistence', 'locks'), { recursive: true, force: true });
  cmds.set.forEach((argv, i) => run(argv, 'gbrain config set ' + settings[i]!.key));
  const read_back = cmds.get.map((argv, i) => ({ ...settings[i]!, read_back: run(argv, 'gbrain config get ' + settings[i]!.key) }));
  const off = read_back.filter((c) => c.read_back !== c.value);
  if (off.length) throw new RunnerError('HE-GBRAIN-015', '--gbrain-config: gbrain config get read back another value for ' + off.map((c) => c.key).join(', ') + ', so the setting did not take; compare with gbrain config get on ' + brainDir);
  run(cmds.copyIn, 'copying the configured brain in');
  run(cmds.start, 'starting the sidecar again');
  const port = run(['docker', 'port', container, '3131/tcp'], 'reading the published port').split('\n')[0]?.split(':').pop();
  const url = 'http://127.0.0.1:' + port;
  for (const deadline = Date.now() + 60_000; ; await Bun.sleep(200)) {
    if (await fetch(url + '/health', { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)) break;
    if (Date.now() > deadline) throw new RunnerError('HE-GBRAIN-015', '--gbrain-config: the sidecar ' + container + ' served no /health within 60 s of its restart; read ' + join(outDir, 'serve.log'));
  }
  return { url, read_back };
}

/** The rung's sidecar, started exactly as the counted runner starts a live member-brain sidecar; --gbrain-config runs after. */
export async function startRecallSidecar(tag: string, out: string, slug: string, index: number, settings: Array<{ key: string; value: string }>): Promise<RecallSidecar> {
  const outDir = join(out, 'sidecar-' + index);
  const sc = await startGbrainSidecar({ trialId: 'gbrain-check-recall-' + index, trialSlug: slug, split: 'heldout', outDir, image: tag, brain: 'member', scope: 'member', ingest: 'live' });
  try {
    if (!sc.tokens || !sc.ingest) throw new RunnerError('HE-GBRAIN-012', 'the sidecar started without member or ingest tokens');
    const configured = settings.length ? await applyGbrainConfig(('he-gbrain-' + slug).toLowerCase().replace(/[^a-z0-9._-]+/g, '-'), tag, outDir, settings) : { url: sc.url, read_back: [] };
    return { url: configured.url, members: sc.tokens.members, public_only: sc.tokens.public_only, sources: sc.ingest.tokens.sources, config: configured.read_back, ready_ms: sc.ready_ms, stop: () => sc.stop() };
  } catch (e) { await sc.stop(); throw e; }
}

function recallDryRun(a: Args): number {
  const plan = planRecall(a.recallCases, a.recallTasks, a.recallRoutes, a.recallTargets.map((t) => t.task));
  const excluded = plan.trials.flatMap((t) => [...t.excluded.keys()]);
  const turns = new Set(plan.cases.map((c) => c.events + '#t' + c.turn)).size;
  console.log('recall:     ' + plan.cases.length + ' case(s) (' + count(plan.cases, (c) => c.kind === 'miss') + ' miss, ' + count(plan.cases, (c) => c.kind === 'control') + ' control) over ' + plan.trials.length + ' trial(s) and ' + turns + ' consumer turn(s) from ' + a.recallCases + ' (sha256 ' + plan.sha256.slice(0, 12) + '); every fact text the run recorded matches its replay');
  console.log('excluded:   ' + (excluded.join(', ') || 'none') + ' (the counted read was itself an error)');
  console.log('routes:     ' + (a.recallRoutes ? RECALL_ROUTES.join(', ') + ', ' + turns * RECALL_ROUTES.length + ' extra reads' : 'off'));
  console.log('baseline:   ' + (a.writeBaseline ? 'written to ' + a.recallBaseline : a.recallBaseline + (a.recallBaseline === 'none' || existsSync(resolve(ROOT, a.recallBaseline)) ? '' : ' (MISSING)')) + '; targets ' + (a.recallTargets.map((t) => t.task + '=' + t.n).join(', ') || 'none') + '; gbrain config ' + (a.gbrainConfig.map((c) => c.key + '=' + c.value).join(', ') || 'none'));
  return 0;
}

async function recallRung(a: Args, ref: ResolvedRef, tag: string, dir: string): Promise<number> {
  const started = Date.now();
  const plan = planRecall(a.recallCases, a.recallTasks, a.recallRoutes, a.recallTargets.map((t) => t.task));
  const info = imageJson(tag);
  if (info.gbrain_commit && info.gbrain_commit !== ref.sha) console.log('WARN: the image records gbrain ' + info.gbrain_commit + ', --gbrain resolved to ' + ref.sha + '; a reused --image or --no-build tag is checked as it is');
  const header: RecallHeader = { type: 'header', schema: 1, harness_evals_commit: sh(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.trim() || 'unknown', dirty: sh(['git', 'status', '--porcelain'], { cwd: ROOT }).stdout.trim() !== '',
    cases_file: a.recallCases, cases_sha256: plan.sha256, recall_tasks: a.recallTasks, routes: a.recallRoutes, image: tag, image_id: imageId(tag), gbrain_commit: info.gbrain_commit ?? null, gbrain_version: info.gbrain_version ?? null, gbrain_config: a.gbrainConfig };
  const baselinePath = resolve(ROOT, a.recallBaseline);
  const baseline = a.writeBaseline || a.recallBaseline === 'none' ? null : readRecallBaseline(baselinePath, plan.sha256);
  if (!baseline && !a.writeBaseline) console.log('NOTE: --recall-baseline none: no baseline, so the pass rule reads only the targets and the error rows');
  if (a.writeBaseline && existsSync(baselinePath) && !a.force) throw new RunnerError('HE-GBRAIN-010', a.recallBaseline + ' exists; pass --force to replace it (the old file is kept as .prev)');
  const hot = loadHotMemoryIndex(RECALL_HOT_MEMORY);
  const out = join(dir, 'recall');
  const receipt = join(out, 'recall.jsonl');
  mkdirSync(out, { recursive: true });
  const resumed = a.resume ? resumeReceipt(receipt, header) : { rows: [], done: new Set<string>() };
  writeFileSync(receipt, [header, ...resumed.rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const rows: Row[] = [...resumed.rows];
  const emit = (r: Row) => { rows.push(r); appendFileSync(receipt, JSON.stringify(r) + '\n'); };
  console.log('RECALL: ' + plan.cases.length + ' case(s) (' + count(plan.cases, (c) => c.kind === 'miss') + ' miss, ' + count(plan.cases, (c) => c.kind === 'control') + ' control) over ' + plan.trials.length + ' trial(s); every fact text the run recorded matches its replay' + (a.resume ? '; resuming ' + receipt + ' with ' + resumed.done.size + ' trial(s) complete' : '') + (a.gbrainConfig.length ? '; --gbrain-config restarts each sidecar once (gbrain serve holds the PGLite lock, so config set runs on its stopped brain)' : ''));
  for (const [i, p] of plan.trials.entries()) {
    if (resumed.done.has(p.events)) continue;
    const t0 = Date.now();
    const sc = await startRecallSidecar(tag, out, 'recall-' + ref.sha.slice(0, 8) + '-' + process.pid + '-' + i, i, a.gbrainConfig);
    let errors = 0;
    try {
      errors = await replayTrial(p, sc, { routes: a.recallRoutes, hot }, emit);
    } finally { await sc.stop(); }
    emit({ type: 'trial', trial: p.events, index: i, complete: errors === 0, errors, ready_ms: sc.ready_ms, config: sc.config, ms: Date.now() - t0 });
    if ((i + 1) % 10 === 0) console.log('RECALL: ' + (i + 1) + ' of ' + plan.trials.length + ' trials replayed');
  }
  const v = recallVerdict(rows, { baseline, targets: a.recallTargets });
  const elapsed = Date.now() - started;
  emit({ type: 'summary', exit: v.exit, regressions: v.regressions, targets: v.targets, errors: v.errors, degraded: v.degraded, excluded: v.excluded, ms: elapsed });
  writeFileSync(join(out, 'recall.md'), renderRecall(rows, header, v, baseline, elapsed));
  const cases = rows.filter((r) => r.type === 'case');
  for (const t of [...new Set(cases.map((r) => String(r.task)))].sort()) for (const kind of ['miss', 'control']) {
    const rs = cases.filter((r) => r.task === t && r.kind === kind);
    if (!rs.length) continue;
    const c = passCounts(rs);
    const lost = count(rs, (r) => v.regressions.includes(String(r.id)));
    console.log('recall/' + t + ' ' + kind + ': ' + c.pass + ' of ' + (c.n - c.noOriginal) + ' original (' + c.viaSaved + ' in saved facts, ' + c.hotOnly + ' in hot memory only' + (c.noOriginal ? '; ' + c.noOriginal + ' of ' + c.n + ' name no original fact' : '') + '), ' + c.information + ' of ' + c.n + ' information' + (lost ? ', ' + lost + ' LOST against the baseline' : ''));
  }
  const routes = rows.filter((r) => r.type === 'route');
  for (const route of routes.length ? RECALL_ROUTES : []) {
    const rr = routes.filter((r) => r.route === route);
    const c = passCounts(rr);
    console.log('route ' + route + ': ' + c.pass + ' of ' + c.n + ' turns original (' + c.hotOnly + ' in hot memory only), ' + c.information + ' information; ' + count(rr, (r) => r.outcome === 'n/a') + ' n/a, ' + count(rr, (r) => r.outcome === 'error') + ' error(s), ' + count(rr, (r) => r.outcome === 'ok' && r.pass_original === false && ids(r, 'degraded').length > 0) + ' degraded' + (route === 'recall' ? ', ' + count(rr, (r) => ids(r, 'cross_entity_figures').length > 0) + ' with a needed figure under another entity' : '') + (route === 'recall_entity' ? ' (an upper bound)' : ''));
  }
  for (const r of v.regressions) console.log('  LOST ' + r);
  for (const t of v.targets) console.log((t.met ? 'ok' : 'FAIL') + ' target ' + t.task + ' >= ' + t.n + ': ' + t.got + ' miss case(s) pass the original oracle');
  if (v.excluded.length) console.log('excluded from the pass rule: ' + v.excluded.map((x) => x.id).join(', ') + ' (the counted read was itself an error)');
  if (v.exit === RECALL_ERROR_EXIT) console.log('HE-GBRAIN-013 ' + v.errors.length + ' error row(s) and ' + v.degraded.length + ' degraded row(s) are not scored: ' + [...v.errors, ...v.degraded].slice(0, 5).join(', ') + '; fix: read their rows in ' + receipt + ', then rerun with --resume ' + dir + ' (trials with error rows are replayed)');
  if (a.writeBaseline) {
    writeRecallBaseline(baselinePath, rows, header, v.exit, a.force);
    console.log('BASELINE: wrote ' + a.recallBaseline);
  }
  const pass = count(cases, (r) => r.pass_original === true);
  console.log((v.exit === 0 ? 'OK' : v.exit === 1 ? 'FAIL' : 'ERROR') + ': gbrain-check recall gbrain ' + ref.sha.slice(0, 12) + ' image ' + tag + ': original ' + pass + ' of ' + cases.length + ' (miss cases ' + count(cases, (r) => r.kind === 'miss' && r.pass_original === true) + ' of ' + count(cases, (r) => r.kind === 'miss') + ', controls ' + count(cases, (r) => r.kind === 'control' && r.pass_original === true) + ' of ' + count(cases, (r) => r.kind === 'control') + '), information ' + count(cases, (r) => r.pass_information === true) + ' of ' + cases.length + '; ' + v.regressions.length + ' lost against the baseline' + (baseline ? ' (gbrain ' + (baseline.header.gbrain_commit ?? 'unknown').slice(0, 12) + ')' : '') + ', ' + count(v.targets, (t) => !t.met) + ' target(s) missed, ' + v.errors.length + ' error row(s), ' + v.degraded.length + ' degraded, ' + v.excluded.length + ' excluded; ' + Math.round(elapsed / 60_000) + ' min; receipts ' + out);
  return v.exit;
}

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const ts = timestamp();
  if (a.rungs.includes('recall') && (a.rungs.length > 1 || !a.harnesses.includes('fake'))) throw new RunnerError('HE-RUN-002', '--rungs recall is a keyless rung on its own (no --harness, no other rung)');
  const dir = checkDir(a.resume ?? process.env.GBRAIN_CHECK_DIR, ts);
  const ref = resolveGbrainRef(a.gbrain, { scratch: join(dirname(dir), '.refs') });
  const tag = a.image ?? imageTagFor(ref.sha);
  console.log(`GBRAIN: ${ref.input} -> ${ref.sha} (${ref.kind}${ref.ref ? ` ${ref.ref}` : ''}); image ${tag}`);
  if (a.dryRun && a.rungs.includes('recall')) return recallDryRun(a);
  if (a.dryRun) return dryRun(a, ref, tag, dir, ts);
  if (!haveDocker()) throw new RunnerError('HE-GBRAIN-002', 'docker is not available; the check builds and runs the sidecar image');
  mkdirSync(dir, { recursive: true });
  if (a.image || a.noBuild) {
    if (!imagePresent(tag)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${tag} is not present and ${a.image ? '--image' : '--no-build'} asked to reuse it; fix: scripts/build-gbrain-image.sh --gbrain ${ref.sha} --tag ${tag}`);
  } else buildImage(ref.sha, tag, join(dir, 'image'));
  if (a.rungs.includes('recall')) return recallRung(a, ref, tag, dir);
  return a.harnesses.includes('fake') ? keyless(a, ref, tag, dir) : paid(a, ref, tag, dir, ts);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  });
}
