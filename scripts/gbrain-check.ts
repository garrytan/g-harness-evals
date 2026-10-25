#!/usr/bin/env bun
// One command to check a gbrain commit against this repository's harness machinery (internal-task; docs/gbrain-arm.md,
// "Checking a gbrain commit").
//
//   bun scripts/gbrain-check.ts --gbrain <ref> [--harness fake|openclaw,hermes] [--rungs told,...] [--reps 2]
//       [--model anthropic:claude-haiku-5-5] [--spend-cap 2] [--image <tag>] [--no-build] [--baseline <file>]
//       [--write-baseline] [--force] [--strict-pins] [--dry-run]
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
// Exit codes: 0 checked, 1 a failed keyless assertion, 2 a refusal or a build failure (the HE- line says which), 3 an
// incomplete paid run.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { GbrainCellConfig, TrialGbrainInstall, TrialRecord } from '../runner/contracts.ts';
import { RunnerError } from '../runner/errors.ts';
import { buildManifest, loadPrereg, renderPlan, resolveGbrain, type Cell, type Manifest, type Prereg } from '../runner/run.ts';
import type { InstallFile, InstallManifest } from '../gbrain/build-install.ts';
import type { InstallViewManifest } from '../runner/trial/gbrain.ts';
import type { WorldEvent } from '../world/services/events.ts';

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
export const RUNGS: Record<string, { gbrain: GbrainCellConfig; told: boolean }> = {
  mcp: { gbrain: { surface: 'starter' }, told: false },
  told: { gbrain: { surface: 'starter' }, told: true },
  docs: { gbrain: { surface: 'starter', install: 'gbrain-docs' }, told: false },
  'verbs-told': { gbrain: { surface: 'verbs' }, told: true },
  'semantic-told': { gbrain: { surface: 'starter', embeddings: 'openai:text-embedding-3-small' }, told: true },
  'docs-semantic': { gbrain: { surface: 'starter', install: 'gbrain-docs', embeddings: 'openai:text-embedding-3-small' }, told: false },
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
    if (spec.told && !toldPresent) { skipped.push(`rung ${rung} skipped: the told preamble ${told} is not in this checkout (the ladder's preregistration PR adds it); the untold rungs run`); continue; }
    for (const harness of harnesses) {
      cells.push({ id: `${harness}-${modelLabel(model)}-gbrain-${rung}`, harness, model, slice: 'multiuser', split: 'dev', repetitions: reps, ceiling: { input_tokens: 80_000, output_tokens: 6_000 }, tasks, gbrain: spec.gbrain, ...(spec.told ? { preamble: told } : {}) });
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
  dir: string;
  manifest: InstallViewManifest | null;
  /** The HE-GBRAIN-006 line when the export or its verification failed. */
  error: string | null;
  /** Hermes: the exported .hermes.md's size in bytes. */
  context_bytes: number | null;
}

export interface ReadyInstall { dir: string; split: string; files: number; writable: boolean }

export interface KeylessEvidence {
  image: string;
  pin: PinSurfaces;
  known: { slug: string; query: string };
  surfaces: SurfaceEvidence[];
  /** The image's /install/manifest.json: the bundle digest and every file. */
  bundle: Pick<InstallManifest, 'digest' | 'files'> | null;
  views: ViewEvidence[];
  /** The gbrain-docs trial on the fake harness (it takes the OpenClaw dev view). */
  docs: null | { termination: string; error?: string; install_bundle: TrialGbrainInstall | undefined; ready_install: ReadyInstall | null; expected_view_digest: string | null; expected_files: number | null };
}

/** The view digest export-install.sh computes: sha256 over "<path> <sha256>\n" of the bundle files in the view, in path order. */
export function viewDigestFromBundle(files: InstallFile[], harness: string, split: string): string {
  const mine = files.filter((f) => f.path.startsWith(`${harness}/workspace/`) || (harness === 'hermes' && f.path === `hermes/${split}/.hermes.md`)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(mine.map((f) => `${f.path} ${f.sha256}\n`).join(''));
}

/** Every assertion of the keyless mode over the evidence, as `HE-GBRAIN-008 <where> <check>: expected <x>, actual <y> (<file>)`
 *  lines; pin_diffs are the tool count differences, failures only under strictPins. */
export function keylessAssertions(e: KeylessEvidence, o: { strictPins?: boolean } = {}): { failures: string[]; passed: string[]; pin_diffs: string[] } {
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
  baseline: string; writeBaseline: boolean; force: boolean; strictPins: boolean; dryRun: boolean;
}

export function parseArgs(argv: string[]): Args {
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name: string) => argv.includes(name);
  const valued = new Set(['--gbrain', '--harness', '--rungs', '--reps', '--model', '--spend-cap', '--image', '--baseline']);
  const bare = new Set(['--no-build', '--write-baseline', '--force', '--strict-pins', '--dry-run']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!valued.has(a) && !bare.has(a)) throw new RunnerError('HE-RUN-002', `unknown argument ${a}; usage: bun scripts/gbrain-check.ts --gbrain <ref> [--harness fake|openclaw,hermes] [--rungs told,...] [--reps 2] [--model ${DEFAULT_MODEL}] [--spend-cap 2] [--image <tag>] [--no-build] [--baseline <file>] [--write-baseline] [--force] [--strict-pins] [--dry-run]`);
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
  return { gbrain, harnesses, rungs: (flag('--rungs') ?? 'told').split(',').map((s) => s.trim()).filter(Boolean), reps, model: flag('--model') ?? DEFAULT_MODEL, spendCap, image: flag('--image'), noBuild: has('--no-build'), baseline: flag('--baseline') ?? DEFAULT_BASELINE, writeBaseline: has('--write-baseline'), force: has('--force'), strictPins: has('--strict-pins'), dryRun: has('--dry-run') };
}

const haveDocker = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const imagePresent = (tag: string) => spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0;
const imageId = (tag: string) => { const r = sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', tag]); return r.status === 0 ? r.stdout.trim() : null; };

function imageJson(tag: string): { gbrain_commit?: string; gbrain_version?: string } {
  const r = sh(['docker', 'run', '--rm', '--entrypoint', 'cat', tag, '/opt/sidecar/image.json']);
  try { return r.status === 0 ? JSON.parse(r.stdout) as { gbrain_commit?: string; gbrain_version?: string } : {}; } catch { return {}; }
}

function bundleManifest(tag: string): Pick<InstallManifest, 'digest' | 'files'> | null {
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
export function writeKeylessTasks(tasksRoot: string): Record<'starter' | 'verbs', string> {
  const ids = { starter: 'gbrain-check-starter', verbs: 'gbrain-check-verbs' } as const;
  for (const [surface, id] of Object.entries(ids) as Array<[keyof typeof ids, string]>) {
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
  const { probeGbrainImage, exportInstallView } = await import('../runner/trial/gbrain.ts');
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
  const prereg = scratchPrereg({ runId: `gbrain-check-keyless-${timestamp()}`, cells: [cell('fake-starter', { surface: 'starter' }, ids.starter), cell('fake-verbs', { surface: 'verbs' }, ids.verbs), cell('fake-docs', { surface: 'starter', install: 'gbrain-docs' }, ids.starter)], spendCapUsd: 1, gbrainSha: ref.sha, rungs: ['keyless'], harnesses: ['fake'] });
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
  const docsRec = result.records.find((r) => r.cell === 'fake-docs');
  const openclawDev = views.find((v) => v.harness === 'openclaw' && v.split === 'dev')?.manifest ?? null;
  let readyInstall: ReadyInstall | null = null;
  if (docsRec?.paths.logs && existsSync(join(docsRec.paths.logs, 'ready'))) {
    try { readyInstall = (JSON.parse(readFileSync(join(docsRec.paths.logs, 'ready'), 'utf8')) as { gbrain_install?: ReadyInstall }).gbrain_install ?? null; } catch { readyInstall = null; }
  }
  const evidence: KeylessEvidence = {
    image: tag, pin, known: KNOWN_PAGE, surfaces, bundle, views,
    docs: docsRec ? { termination: docsRec.termination, error: docsRec.error, install_bundle: docsRec.gbrain?.install_bundle, ready_install: readyInstall, expected_view_digest: openclawDev?.view_digest ?? null, expected_files: openclawDev?.files.length ?? null } : { termination: 'not run', install_bundle: undefined, ready_install: null, expected_view_digest: null, expected_files: null },
  };
  const verdict = keylessAssertions(evidence, { strictPins: a.strictPins });
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
  const pre = run(['runner/run.ts', 'preflight', '--manifest', manifestPath, '--gbrain-image', tag, '--ledger', ledger]);
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
      lines.push(`run:        bun runner/run.ts preflight --manifest ${join(dir, 'manifest.json')} --gbrain-image ${tag}; run --harness-mode docker --gbrain-image ${tag} --max-output-tokens 128000 --stop-on-cap --ledger ${join(dir, 'ledger.sqlite')} (trials sequential); scripts/summarize-run.ts --results ${dir}`);
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

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const ts = timestamp();
  const dir = checkDir(process.env.GBRAIN_CHECK_DIR, ts);
  const ref = resolveGbrainRef(a.gbrain, { scratch: join(dirname(dir), '.refs') });
  const tag = a.image ?? imageTagFor(ref.sha);
  console.log(`GBRAIN: ${ref.input} -> ${ref.sha} (${ref.kind}${ref.ref ? ` ${ref.ref}` : ''}); image ${tag}`);
  if (a.dryRun) return dryRun(a, ref, tag, dir, ts);
  if (!haveDocker()) throw new RunnerError('HE-GBRAIN-002', 'docker is not available; the check builds and runs the sidecar image');
  mkdirSync(dir, { recursive: true });
  if (a.image || a.noBuild) {
    if (!imagePresent(tag)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${tag} is not present and ${a.image ? '--image' : '--no-build'} asked to reuse it; fix: scripts/build-gbrain-image.sh --gbrain ${ref.sha} --tag ${tag}`);
  } else buildImage(ref.sha, tag, join(dir, 'image'));
  return a.harnesses.includes('fake') ? keyless(a, ref, tag, dir) : paid(a, ref, tag, dir, ts);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  });
}
