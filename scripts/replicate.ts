#!/usr/bin/env bun
/**
 * Check a finding yourself (docs/replicate.md): reanalyze its trial bundle for free, estimate a rerun for free, or rerun
 * one cell with your own key under a hard cap and get WITHIN BAND, OUTSIDE BAND, NO BAND or INCOMPLETE.
 *
 *   bun scripts/replicate.ts --bundle <archive> [--sha256 <digest>] --reanalyze [--json]
 *   bun scripts/replicate.ts --bundle <archive> [--sha256 <digest>] --estimate-only [--cell <id>] [--reps <n>] [--json]
 *   bun scripts/replicate.ts --bundle <archive> [--sha256 <digest>] --cell <id> --max-usd <n> [--reps <n>] [--yes]
 *       [--out <dir>] [--accept-drift] [--allow-short-cap] [--json]
 *   bun scripts/replicate.ts --resume <out> [--replay-charged] [--json]
 *
 * --finding <file> reads the archive's URL and digest from the finding's front matter line "data: <URL> sha256 <digest>"
 * (and its rerun commit from "rerun_commit: <sha>"), so --bundle and --sha256 can be left out.
 *
 * --reanalyze and --estimate-only need only Bun and the bundle: no key, no Docker, no proxy, no container. A paid rerun
 * needs Linux x86_64, Docker, 20 GB free, a clean checkout at the bundle's rerun commit and the cell's provider key in
 * this shell (its presence is checked; it is never printed). The rerun plans from the run's registered preregistration
 * (run.ts plan --replication-of), runs the one cell with trials in sequence under one lease in a local ledger under --out,
 * and stops at the cap (--stop-on-cap). SIGINT stops the runner and the proxy without closing the lease, writes an
 * INCOMPLETE report, and --resume continues the same run id under the same lease. With no runner running (the free
 * modes, a download, the steps before the runner starts) SIGINT exits at once with status 130.
 *
 * Exit: 0 WITHIN BAND (or a reanalysis that matches), 4 OUTSIDE BAND (or a reanalysis that does not), 5 NO BAND (the
 * band's coverage check failed at this repetition count; only the difference is reported), 3 INCOMPLETE, 2 refusal.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync, appendFileSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { RunnerError } from '../runner/errors.ts';
import { DEFAULT_CAPS } from '../runner/archive.ts';
import { canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { ledgerStatus } from '../runner/ledger/budget-ledger.ts';
import { isCapRefusal, trialSlug } from '../runner/trial/proxy.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';
import { DEFAULT_PREAMBLE_PATH } from '../runner/trial/task.ts';
import { registeredHeldout } from '../runner/heldout/openings.ts';
import { seededRandom } from '../runner/stats/paired.ts';
import { EXCLUDED_TERMINATIONS, bandCoverage, cellCounts, pairedDifference, passRate, replicationBand, type TaskCount } from '../runner/replicate/band.ts';
import { ANALYSES, PROFILE_RESULTS, TOOL_ROOT, build as buildBundle, runAnalyses, verify, type BundleManifest } from './bundle.ts';
import { regradeResults } from './regrade.ts';
import { TOKEN_PATTERNS } from './publish-audit.ts';

export const REPORT_SCHEMA = 1;
export const COVERAGE_GATE = 0.93;
export const MAX_OUTPUT_TOKENS = 128000;
const MIN_FREE_BYTES = 20 * 1024 ** 3;
const MAX_DOWNLOAD_BYTES = DEFAULT_CAPS.maxBytes;
const DOWNLOAD_DEADLINE_MS = 30 * 60 * 1000;
const KEY_FOR: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
const CHILD_ENV = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR'];
const MISS_CAUSES = [
  'a newer model snapshot behind the same model id',
  'harness dependencies resolved when the image was built',
  'a provider-side change (rate limits, defaults, tool handling)',
];
const RESULTS_GITIGNORE = [
  '# Evaluator-owned receipts are kept; harness state, workspaces, raw harness logs and per-trial tokens are not.',
  'trials/*/*/*/state/', 'trials/*/*/*/workspace/', 'trials/*/*/*/logs/*', '!trials/*/*/*/logs/adapter.log', 'trials/*/*/*/trial.json',
  'ledger.sqlite-shm', 'ledger.sqlite-wal', 'trials/*/*/*/compose.serve.yaml', '',
].join('\n');

const FLAGS = new Set(['--finding', '--bundle', '--sha256', '--cell', '--reps', '--max-usd', '--out', '--resume']);
const SWITCHES = new Set(['--reanalyze', '--estimate-only', '--yes', '--accept-drift', '--allow-short-cap', '--replay-charged', '--json']);
const USAGE = 'usage: bun scripts/replicate.ts (--finding <file> | --bundle <archive> [--sha256 <digest>]) (--reanalyze | --estimate-only [--cell <id>] [--reps <n>] | --cell <id> --max-usd <n> [--reps <n>] [--yes] [--out <dir>] [--accept-drift] [--allow-short-cap]) [--json]; or --resume <out> [--replay-charged] [--json] (docs/replicate.md)';

export interface Args { [flag: string]: string | true | undefined }

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    if (SWITCHES.has(f)) { a[f.slice(2)] = true; continue; }
    if (!FLAGS.has(f)) throw new RunnerError('HE-REPL-001', `${f.includes('=') ? `${f} (the --flag=value form is not accepted; write --flag value)` : `unknown argument ${f}`}; ${USAGE}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new RunnerError('HE-REPL-001', `${f} needs a value; ${USAGE}`);
    a[f.slice(2)] = v;
    i++;
  }
  const modes = ['reanalyze', 'estimate-only', 'resume'].filter((m) => a[m]);
  if (modes.length > 1) throw new RunnerError('HE-REPL-001', `--${modes.join(' and --')} cannot be combined; ${USAGE}`);
  if (!a.resume && !a.bundle && !a.finding) throw new RunnerError('HE-REPL-001', `name the bundle with --bundle <archive> or --finding <file>; ${USAGE}`);
  for (const k of ['reps']) if (typeof a[k] === 'string' && !/^[1-9][0-9]{0,2}$/.test(a[k] as string)) throw new RunnerError('HE-REPL-001', `--reps ${a[k]} is not a whole number from 1 to 999`);
  if (typeof a['max-usd'] === 'string' && !(Number(a['max-usd']) > 0 && Number.isFinite(Number(a['max-usd'])))) throw new RunnerError('HE-REPL-001', `--max-usd ${a['max-usd']} is not a positive number of dollars`);
  return a;
}

/** The finding's front matter: data: <URL> sha256 <digest>, and rerun_commit: <sha>. */
export function readFinding(text: string): { url?: string; sha256?: string; rerunCommit?: string } {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const front = m ? m[1]! : '';
  const data = /^data:\s*(\S+)\s+sha256\s+([0-9a-f]{64})\s*$/m.exec(front);
  const rerun = /^rerun_commit:\s*([0-9a-f]{7,40})\s*$/m.exec(front);
  return { url: data?.[1], sha256: data?.[2], rerunCommit: rerun?.[1] };
}

export function redact(text: string): string {
  let out = text;
  for (const re of Object.values(TOKEN_PATTERNS)) out = out.replace(new RegExp(re.source, 'g'), (hit) => (/^sk-trial-[^.]*$/.test(hit) ? hit : '<redacted>'));
  return out.replace(/(sk-trial-[A-Za-z0-9._/-]*?)\.[0-9a-f]{32}/g, '$1.<redacted>');
}

/** What the tool touches outside itself; tests replace it. */
export interface Deps {
  platform: string;
  arch: string;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  readLine: (prompt: string) => Promise<string>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  docker: (args: string[]) => { status: number; stdout: string; stderr: string };
  freeBytes: (dir: string) => number;
  /** Start a runner subcommand (bun runner/run.ts ...) in its own process group. */
  startRunner: (args: string[], env: Record<string, string>) => ChildProcess;
  out: (line: string) => void;
  err: (line: string) => void;
  now: () => Date;
  /** HEAD and the tracked files with uncommitted changes. */
  checkout: () => { commit: string | null; dirty: string[] };
}

export const realDeps: Deps = {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
  isTTY: Boolean(process.stdin.isTTY),
  readLine: async (prompt) => { process.stdout.write(prompt); for await (const line of console) return line; return ''; },
  fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  docker: (args) => { const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') }; },
  freeBytes: (dir) => { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); },
  startRunner: (args, env) => spawn(process.execPath, [join(TOOL_ROOT, 'runner', 'run.ts'), ...args], { cwd: TOOL_ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
  now: () => new Date(),
  checkout: () => ({ commit: headCommit(), dirty: (gitOut(['status', '--porcelain', '--untracked-files=no']) ?? '').split('\n').filter(Boolean).map((l) => l.slice(3)) }),
};

const git = (args: string[], cwd = TOOL_ROOT) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const gitOut = (args: string[]) => { const r = git(args); return r.status === 0 ? r.stdout.trim() : null; };
const headCommit = () => gitOut(['rev-parse', 'HEAD']);
/** The trial id a proxy usage key charges; the key prefix changed after some published runs (sk-trial- then trial-token:). */
export const keyTrial = (key: string) => key.replace(/^(trial-token:|sk-trial-)/, '');
const usd = (x: number) => `$${x.toFixed(2)}`;
const ceilCents = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;

interface Loaded { path: string; sha256: string; manifest: BundleManifest; dir: string; results: string; prereg: Record<string, unknown> | null; preregSha256: string | null; analysis?: string; expected?: string; finding: { url?: string; sha256?: string; rerunCommit?: string } }

async function fetchBundle(url: string, digest: string, dest: string, d: Deps): Promise<string> {
  const file = join(dest, `bundle-${digest}.tar.gz`);
  const digestOf = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  if (existsSync(file)) {
    if (digestOf(file) === digest) return file;
    rmSync(file, { force: true });
  }
  mkdirSync(dest, { recursive: true });
  const part = `${file}.part-${process.pid}`;
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try { res = await d.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_DEADLINE_MS) }); } catch (e) { last = (e as Error).message; await d.sleep(1000 * 2 ** (attempt - 1)); continue; }
    if ([401, 403, 404].includes(res.status)) throw new RunnerError('HE-REPL-005', `the bundle URL answered HTTP ${res.status} (host ${new URL(url).host}); fix: download the archive another way and pass --bundle <path>`);
    if (!res.ok || !res.body) { last = `HTTP ${res.status}`; await d.sleep(1000 * 2 ** (attempt - 1)); continue; }
    try {
      const fd = openSync(part, 'w');
      let size = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > MAX_DOWNLOAD_BYTES) throw new RunnerError('HE-REPL-005', `the bundle from host ${new URL(url).host} is larger than ${MAX_DOWNLOAD_BYTES} bytes, past the archive cap; fix: check the finding's data: line`);
          writeSync(fd, chunk);
        }
      } finally { closeSync(fd); }
    } catch (e) {
      rmSync(part, { force: true });
      if (e instanceof RunnerError) throw e;
      last = (e as Error).message;
      await d.sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
    if (digestOf(part) !== digest) { rmSync(part, { force: true }); throw new RunnerError('HE-REPL-005', `the bundle downloaded from host ${new URL(url).host} does not have the finding's sha256 ${digest.slice(0, 12)}; nothing was kept. fix: retry, or download it another way and pass --bundle <path> --sha256 <digest>`); }
    renameSync(part, file);
    return file;
  }
  throw new RunnerError('HE-REPL-005', `could not download the bundle from host ${new URL(url).host} after 3 tries (${redact(last)}); fix: retry later, or download it and pass --bundle <path>`);
}

async function loadBundle(a: Args, d: Deps): Promise<Loaded> {
  const finding = typeof a.finding === 'string' ? readFinding(readFileSync(a.finding, 'utf8')) : {};
  if (typeof a.finding === 'string' && !finding.sha256 && !a.bundle) throw new RunnerError('HE-REPL-001', `${a.finding} has no front matter line "data: <URL> sha256 <digest>"; fix: pass --bundle <archive> --sha256 <digest>`);
  if (typeof a.sha256 === 'string' && finding.sha256 && a.sha256 !== finding.sha256) throw new RunnerError('HE-REPL-001', `--sha256 ${a.sha256} is not the finding's digest ${finding.sha256}; fix: drop --sha256 or use the finding's`);
  const digest = (a.sha256 as string | undefined) ?? finding.sha256;
  const path = typeof a.bundle === 'string' ? resolve(a.bundle) : await fetchBundle(finding.url!, digest!, join(TOOL_ROOT, 'replications', '.bundles'), d);
  const v = verify(path, digest ? { sha256: digest } : {});
  const dir = mkdtempSync(join(tmpdir(), 'replicate-'));
  for (const e of v.entries) { mkdirSync(dirname(join(dir, e.path)), { recursive: true }); writeFileSync(join(dir, e.path), e.data); }
  const text = (p: string) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : undefined);
  const prereg = text('prereg.json');
  if (!digest) d.err(`WARN: no --sha256 given; the archive's sha256 is ${v.sha256}. Compare it with the finding's data: line before trusting it.`);
  return { path, sha256: v.sha256, manifest: v.manifest, dir, results: join(dir, 'results'), prereg: prereg ? JSON.parse(prereg) : null, preregSha256: prereg === undefined ? null : createHash('sha256').update(prereg).digest('hex'), analysis: text('analysis.json'), expected: text('expected-output.txt'), finding };
}

// ---------- --reanalyze ----------

function reanalyze(b: Loaded, d: Deps): { exit: number; report: Record<string, unknown> } {
  if (!b.analysis || b.expected === undefined) throw new RunnerError('HE-REPL-009', `bundle ${b.sha256.slice(0, 12)} carries no analysis.json and expected-output.txt; nothing to reanalyze. fix: use a bundle built with --analysis`);
  let steps: Array<{ id: string; script: string; args: string[] }>;
  try { steps = (JSON.parse(b.analysis) as { steps: typeof steps }).steps; } catch { throw new RunnerError('HE-REPL-009', 'analysis.json is not a list of steps; fix: download the bundle again'); }
  const off = steps.find((s) => !Object.hasOwn(ANALYSES, s.id) || JSON.stringify(s) !== JSON.stringify({ id: s.id, ...ANALYSES[s.id] }));
  if (off) throw new RunnerError('HE-REPL-009', `analysis.json names step ${JSON.stringify(String(off.id))}, which is not a checked-in analyzer with its fixed arguments (allowed: ${Object.keys(ANALYSES).join(', ')}); no file in the archive is ever executed. fix: use a bundle from the finding`);
  const gen = b.manifest.generator?.commit ?? null;
  const head = headCommit();
  let toolRoot = TOOL_ROOT;
  let worktree: string | null = null;
  let analyzers = `this checkout (${head?.slice(0, 12) ?? 'unknown'})`;
  if (gen && gen !== head) {
    if (git(['cat-file', '-e', `${gen}^{commit}`]).status === 0) {
      worktree = mkdtempSync(join(tmpdir(), 'replicate-generator-'));
      const add = git(['worktree', 'add', '--detach', worktree, gen]);
      if (add.status !== 0) throw new RunnerError('HE-REPL-009', `could not check out the generator commit ${gen.slice(0, 12)} in a temporary worktree: ${redact(add.stderr.trim().split('\n')[0] ?? '')}`);
      if (existsSync(join(TOOL_ROOT, 'node_modules'))) symlinkSync(join(TOOL_ROOT, 'node_modules'), join(worktree, 'node_modules'));
      toolRoot = worktree;
      analyzers = `the generator commit ${gen.slice(0, 12)} (a temporary worktree)`;
    } else {
      analyzers += `; the generator commit ${gen.slice(0, 12)} is not in this clone`;
    }
  }
  let output: string;
  try { output = runAnalyses(toolRoot, readdirEntries(b.dir), steps.map((s) => s.id)); }
  finally { if (worktree) { git(['worktree', 'remove', '--force', worktree]); rmSync(worktree, { recursive: true, force: true }); } }
  const match = output === b.expected;
  const report = { schema_version: REPORT_SCHEMA, mode: 'reanalyze', bundle: bundleInfo(b), analyzers, steps: steps.map((s) => s.id), generator_dirty: b.manifest.generator?.dirty ?? null, match };
  if (!match) {
    const diffAt = output.split('\n').findIndex((l, i) => l !== b.expected!.split('\n')[i]);
    d.out(`REANALYZE: DIFFERS from expected-output.txt at line ${diffAt + 1} (analyzers at ${analyzers})`);
    return { exit: 4, report: { ...report, first_difference_line: diffAt + 1 } };
  }
  d.out(`REANALYZE: MATCH: ${steps.map((s) => s.id).join(', ')} at ${analyzers} print expected-output.txt byte for byte (bundle ${b.sha256.slice(0, 12)}, run ${b.manifest.run_id})`);
  return { exit: 0, report };
}

function readdirEntries(dir: string): Array<{ path: string; data: Uint8Array }> {
  const out: Array<{ path: string; data: Uint8Array }> = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p); else out.push({ path: p, data: new Uint8Array(readFileSync(join(dir, p))) });
    }
  };
  walk('');
  return out;
}

const bundleInfo = (b: Loaded) => ({ path: b.path, sha256: b.sha256, finding: b.manifest.finding, run_id: b.manifest.run_id, run_commit: b.manifest.run_commit, receipts_commit: b.manifest.receipts_commit, rerun_commit: rerunCommitOf(b), generator_commit: b.manifest.generator?.commit ?? null });
const rerunCommitOf = (b: Loaded) => b.finding.rerunCommit ?? b.manifest.rerun_commit ?? null;

// ---------- the cell, its estimate ----------

interface CellDef { id: string; harness: string; model: string; split?: string; preamble?: string; gbrain?: unknown; harness_mode?: string; repetitions?: number }
interface Rec { trial_id: string; cell: string; task: string; grade: string; termination?: string; cap_stop?: boolean; wall_ms?: number; usage?: { usd: number; refused: number } | null }

function cellOf(b: Loaded, id: string): CellDef {
  const cells = ((b.prereg?.cells ?? []) as CellDef[]);
  const cell = cells.find((c) => c.id === id);
  if (!cell) throw new RunnerError('HE-REPL-001', `--cell ${id} is not a cell of run ${b.manifest.run_id}; its cells are ${cells.map((c) => c.id).join(', ') || 'none'}`);
  if (b.manifest.profile !== PROFILE_RESULTS || !b.manifest.rerun?.available) throw new RunnerError('HE-REPL-011', `bundle ${b.sha256.slice(0, 12)} is a ${b.manifest.profile} bundle with no rerun (${b.manifest.held_out?.note ?? ''}); fix: --reanalyze still works`);
  if (cell.gbrain) throw new RunnerError('HE-REPL-011', `cell ${id} runs a gbrain sidecar, which this tool does not rerun yet (its corpus, image and paid preflight probe are outside the equivalence check); fix: choose a cell without gbrain`);
  if (cell.harness === 'scripted' || cell.harness_mode === 'scripted') throw new RunnerError('HE-REPL-011', `cell ${id} is a scripted cell, which calls no model; there is nothing to rerun`);
  if (cell.harness === 'qm') throw new RunnerError('HE-REPL-011', `cell ${id} runs QM, which needs its pinned qm-sandbox image and its sandbox teardown; this tool builds and cleans neither yet. fix: choose a cell of another harness`);
  return cell;
}

function records(results: string): Rec[] {
  const f = join(results, 'trials.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec) : [];
}

function usageLines(results: string): UsageLine[] {
  const f = join(results, 'proxy-usage.ndjson');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine) : [];
}

export interface Estimate { cell: string; reps: number; trials: number; expected_usd: number; high_usd: number; max_reservation_usd: number; min_cap_usd: number; wall_minutes: number; repriced: 'per request' | 'approximate'; price_factor: number; model: string }

export function estimate(b: Loaded, cell: CellDef, reps: number): Estimate {
  const recs = records(b.results).filter((r) => r.cell === cell.id);
  const prefix = `${b.manifest.run_id}/${cell.id}/`;
  const lines = usageLines(b.results).filter((l) => keyTrial(l.key).startsWith(prefix) && l.outcome === 'forwarded');
  const price = canonicalLookup(cell.model);
  if (!price) throw new RunnerError('HE-REPL-011', `model ${cell.model} has no price at this commit (runner/pricing/model-pricing.ts); the proxy would refuse every request`);
  let actual = 0;
  let repriced = 0;
  let maxReserved = 0;
  for (const l of lines) {
    const x = l as UsageLine & { actual_usd?: number; reserved_usd?: number; cached_tokens?: number };
    actual += x.actual_usd ?? 0;
    maxReserved = Math.max(maxReserved, x.reserved_usd ?? 0);
    const cached = x.cached_tokens ?? 0;
    repriced += ((Math.max(0, (x.input_tokens ?? 0) - cached)) * price.input + cached * (price.cache_read ?? price.input) + (x.output_tokens ?? 0) * price.output) / 1e6;
  }
  const close = actual > 0 && Math.abs(repriced / actual - 1) <= 0.02;
  const factor = actual > 0 ? Math.max(1, repriced / actual) : 1;
  const byTask = new Map<string, number[]>();
  for (const r of recs) byTask.set(r.task, [...(byTask.get(r.task) ?? []), (r.usage?.usd ?? 0) * factor]);
  const means = [...byTask.values()].map((v) => v.reduce((s, x) => s + x, 0) / v.length);
  const expected = means.reduce((s, x) => s + x, 0) * reps;
  const rand = seededRandom(20261101);
  const totals = new Float64Array(10_000);
  for (let i = 0; i < totals.length; i++) { let s = 0; for (let j = 0; j < means.length; j++) s += means[Math.floor(rand() * means.length)]!; totals[i] = s * reps; }
  totals.sort();
  const high = Math.max(expected, totals[Math.ceil(0.95 * (totals.length - 1))]!);
  const wall = recs.length ? recs.reduce((s, r) => s + (r.wall_ms ?? 0), 0) / recs.length : 0;
  const reservation = maxReserved * factor;
  return { cell: cell.id, reps, trials: byTask.size * reps, expected_usd: ceilCents(expected), high_usd: ceilCents(high), max_reservation_usd: ceilCents(reservation), min_cap_usd: ceilCents(high + reservation), wall_minutes: Math.ceil((wall * byTask.size * reps) / 60000), repriced: close ? 'per request' : 'approximate', price_factor: Number(factor.toFixed(4)), model: cell.model };
}

function printEstimate(e: Estimate, d: Deps) {
  d.out(`ESTIMATE: ${e.cell} at ${e.reps} rep(s): ${e.trials} trials, expected ${usd(e.expected_usd)}, high ${usd(e.high_usd)} (95th percentile of 10,000 task-resampled totals), largest single reservation ${usd(e.max_reservation_usd)}, about ${e.wall_minutes} minutes; smallest --max-usd ${usd(e.min_cap_usd)}${e.repriced === 'approximate' ? ' (approximate: repriced from token counts at this commit and rounded up)' : ''}`);
}

// ---------- equivalence (keyless) ----------

export interface Equivalence { ok: boolean; problems: string[]; diff_summary: string[]; regrade: { selected: number; regraded: number; changed: number; not_regraded: number } }

export async function equivalence(b: Loaded, cell: CellDef): Promise<Equivalence> {
  const problems: string[] = [];
  const runCommit = b.manifest.run_commit;
  const man = existsSync(join(b.results, 'manifest.json')) ? JSON.parse(readFileSync(join(b.results, 'manifest.json'), 'utf8')) as { trials?: Array<{ cell: string; task_dir: string }> } : {};
  const taskDirs = [...new Set((man.trials ?? []).filter((t) => t.cell === cell.id).map((t) => t.task_dir))].sort();
  if (!taskDirs.length) problems.push(`the bundle's results/manifest.json lists no trials for ${cell.id}`);
  const diff_summary: string[] = [];
  if (!runCommit || git(['cat-file', '-e', `${runCommit}^{commit}`]).status !== 0) {
    problems.push(`the run commit ${runCommit ?? '(none recorded)'} is not in this clone, so task files, preamble, seed world and harness pin cannot be compared; fix: clone the full history (no --depth)`);
  } else {
    const changed = (paths: string[]) => {
      const o = gitOut(['diff', '--name-only', runCommit, 'HEAD', '--', ...paths]);
      if (o === null) { problems.push(`git diff ${runCommit.slice(0, 12)} HEAD failed for ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', ...' : ''}, so that comparison could not be made`); return []; }
      return o.split('\n').filter(Boolean);
    };
    const tasks = changed(taskDirs);
    if (tasks.length) problems.push(`task files changed since the run commit ${runCommit.slice(0, 12)}: ${tasks.slice(0, 5).join(', ')}${tasks.length > 5 ? ` and ${tasks.length - 5} more` : ''}`);
    const preamble = changed([cell.preamble ?? DEFAULT_PREAMBLE_PATH]);
    if (preamble.length) problems.push(`the preamble ${cell.preamble ?? DEFAULT_PREAMBLE_PATH} changed since the run commit`);
    const world = changed(['world/seed']);
    if (world.length) problems.push(`the seed world changed since the run commit: ${world.slice(0, 5).join(', ')}`);
    const show = (p: string, c: string) => { const r = git(['show', `${c}:${p}`]); return r.status === 0 ? r.stdout : null; };
    const pinOf = (c: string) => { const t = show(`harnesses/${cell.harness}/pin.json`, c); if (!t) return null; const p = JSON.parse(t) as Record<string, unknown>; return JSON.stringify({ name: p.name, repo: p.repo, version: p.version, commit: p.commit, install: p.install }); };
    const argsOf = (c: string) => (show(`harnesses/${cell.harness}/Dockerfile`, c) ?? '').split('\n').filter((l) => /^ARG\s+\S+=/.test(l)).join('\n');
    if (pinOf(runCommit) !== pinOf('HEAD')) problems.push(`the harness pin (name, repo, version, commit, install in harnesses/${cell.harness}/pin.json) changed since the run commit`);
    if (argsOf(runCommit) !== argsOf('HEAD')) problems.push(`the harness image build arguments (ARG lines in harnesses/${cell.harness}/Dockerfile) changed since the run commit`);
    for (const scope of [`harnesses/${cell.harness}`, 'runner']) {
      const stat = gitOut(['diff', '--shortstat', runCommit, 'HEAD', '--', scope]);
      if (stat === null) problems.push(`git diff --shortstat ${runCommit.slice(0, 12)} HEAD -- ${scope} failed`);
      diff_summary.push(`${scope}: ${stat === null ? 'unknown (git diff failed)' : stat || 'no change'} between the run commit ${runCommit.slice(0, 12)} and this commit`);
    }
  }
  const rg = await regradeResults({ results: b.results, cells: [cell.id], repoRoot: TOOL_ROOT });
  if (rg.summary.not_regraded || rg.summary.changed) problems.push(`the grader at this commit does not reproduce every published grade of ${cell.id}: ${rg.summary.changed} changed, ${rg.summary.not_regraded} not regraded (${rg.problems.slice(0, 3).join('; ')})`);
  return { ok: problems.length === 0, problems, diff_summary, regrade: { selected: rg.summary.selected, regraded: rg.summary.regraded, changed: rg.summary.changed, not_regraded: rg.summary.not_regraded } };
}

// ---------- the paid rerun ----------

interface State { schema_version: number; run_id: string; cell: string; reps: number; max_usd: number; commit: string; bundle_path: string; bundle_sha256: string; finding_rerun_commit: string | null; drift_experiment: boolean; image: { tag: string; id: string | null }; started_at: string; resumes: Array<{ at: string; commit: string; replay_charged: string[] }>; equivalence: Equivalence; estimate: Estimate; interrupted: boolean }

function paidPreflight(cell: CellDef, out: string, d: Deps): void {
  if (d.platform !== 'linux' || d.arch !== 'x64') throw new RunnerError('HE-REPL-004', `a paid rerun needs Linux x86_64; this is ${d.platform} ${d.arch}. The metering proxy binds the Linux docker bridge gateway. fix: use a Linux x86_64 host (HE_CONTAINER_HOST_IP exists but is not supported for this path); --reanalyze and --estimate-only work here`);
  const info = d.docker(['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) throw new RunnerError('HE-REPL-004', `Docker is not reachable (docker info: ${redact(info.stderr.trim().split('\n')[0] ?? '')}); fix: install and start Docker, and let this user run it`);
  mkdirSync(out, { recursive: true });
  const free = d.freeBytes(out);
  if (free < MIN_FREE_BYTES) throw new RunnerError('HE-REPL-004', `${(free / 1024 ** 3).toFixed(1)} GB free under ${out}; a rerun needs 20 GB for images and trial receipts. fix: free space or pass --out on a larger disk`);
  const provider = cell.model.split(':')[0]!;
  const key = KEY_FOR[provider];
  if (!key) throw new RunnerError('HE-REPL-011', `cell ${cell.id} uses provider ${provider}, which this tool does not rerun`);
  if (!d.env[key]) throw new RunnerError('HE-REPL-004', `${key} is not set in this shell; cell ${cell.id} calls ${provider}. fix: read -rs ${key} && export ${key} (your key stays in the metering proxy's environment; containers never see it)`);
}

function cleanCheckout(b: Loaded, accept: boolean, d: Deps): { commit: string; problems: string[] } {
  const { commit, dirty } = d.checkout();
  if (!commit) throw new RunnerError('HE-REPL-004', `${TOOL_ROOT} is not a git checkout; fix: clone garrytan/harness-evals and run from it`);
  if (dirty.length) throw new RunnerError('HE-REPL-004', `the checkout has uncommitted changes (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', ...' : ''}); a rerun runs the committed code it records. fix: git stash, or use a fresh clone`);
  const want = rerunCommitOf(b);
  const problems: string[] = [];
  if (want && !commit.startsWith(want) && !want.startsWith(commit)) {
    if (!accept) throw new RunnerError('HE-REPL-004', `this checkout is at ${commit.slice(0, 12)}, not the finding's rerun commit ${want.slice(0, 12)}; fix: git checkout ${want.slice(0, 12)} (or --accept-drift for a drift experiment)`);
    problems.push(`checkout ${commit.slice(0, 12)} is not the rerun commit ${want.slice(0, 12)}`);
  }
  return { commit, problems };
}

function childEnv(cell: CellDef, d: Deps): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of [...CHILD_ENV, KEY_FOR[cell.model.split(':')[0]!]!]) { const v = d.env[k]; if (v !== undefined) env[k] = v; }
  return env;
}

async function confirm(cap: number, a: Args, d: Deps): Promise<void> {
  if (a.yes) return;
  if (!d.isTTY) throw new RunnerError('HE-REPL-008', `no terminal to confirm the ${usd(cap)} cap and no --yes; nothing was started. fix: rerun with --yes to accept the cap without a prompt`);
  const typed = (await d.readLine(`This rerun may spend up to ${usd(cap)} of your provider credit. Type the cap (${cap}) to start: `)).trim().replace(/^\$/, '');
  if (Number(typed) !== cap) throw new RunnerError('HE-REPL-008', `the typed cap ${JSON.stringify(typed)} is not ${cap}; nothing was started`);
}

/** Runs one runner subcommand, streaming its lines; the runner's own cap-stop recovery text is replaced. SIGINT/SIGTERM stop
 *  the runner's process group (the runner, its proxy and adapters); the proxy exits without closing the lease. */
async function runner(args: string[], env: Record<string, string>, log: string, d: Deps, sig: { interrupted: boolean; child: ChildProcess | null }): Promise<number> {
  const child = d.startRunner(args, env);
  sig.child = child;
  const emit = (raw: string, toErr: boolean) => {
    const line = redact(raw);
    appendFileSync(log, line + '\n');
    if (line.startsWith('HE-BUDGET-001')) { d.err('HE-BUDGET-001 the rerun reached its --max-usd cap; the trial that hit it is left out. A cap stop is the end of this rerun: start a new one with a larger --max-usd if you want.'); return; }
    (toErr ? d.err : d.out)(line);
  };
  const pipe = (stream: NodeJS.ReadableStream | null, toErr: boolean) => {
    let buf = '';
    stream?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        emit(buf.slice(0, nl), toErr);
        buf = buf.slice(nl + 1);
      }
    });
    stream?.on('end', () => { if (buf) emit(buf, toErr); buf = ''; });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);
  const code: number = await new Promise((res) => child.on('close', (c, s) => res(c ?? (s ? 130 : 1))));
  sig.child = null;
  return code;
}

function stopGroup(child: ChildProcess, signal: NodeJS.Signals) { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already gone */ } }

function removeContainers(runId: string, d: Deps): number {
  const ps = d.docker(['ps', '-aq', '--filter', `name=he-${trialSlug(runId)}-`]);
  const ids = ps.status === 0 ? ps.stdout.split('\n').filter(Boolean) : [];
  if (ids.length) d.docker(['rm', '-f', ...ids]);
  return ids.length;
}

/** Interrupted trials: planned, not recorded, but with charged requests (forwarded or failed, not refused) in the proxy log. */
export function chargedUnrecorded(results: string, cell: string): Array<{ trial: string; usd: number }> {
  const man = existsSync(join(results, 'manifest.json')) ? JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { trials: Array<{ id: string; cell: string }> } : { trials: [] };
  const recorded = new Set(records(results).map((r) => r.trial_id));
  const lines = usageLines(results);
  return man.trials.filter((t) => t.cell === cell && !recorded.has(t.id)).map((t) => {
    const mine = lines.filter((l) => keyTrial(l.key) === t.id && l.outcome !== 'refused');
    return { trial: t.id, usd: mine.reduce((s, l) => s + ((l as { actual_usd?: number }).actual_usd ?? 0), 0), n: mine.length };
  }).filter((x) => x.n > 0).map(({ trial, usd: u }) => ({ trial, usd: Number(u.toFixed(6)) }));
}

async function buildImage(cell: CellDef, runId: string, out: string, d: Deps): Promise<{ tag: string; id: string | null }> {
  const tag = `harness-eval/${cell.harness}:${runId}`;
  d.out(`IMAGE: building ${tag} from harnesses/${cell.harness} at this checkout`);
  const r = d.docker(['build', '-q', '-t', tag, join(TOOL_ROOT, 'harnesses', cell.harness)]);
  writeFileSync(join(out, `build-${cell.harness}.log`), redact(r.stdout + r.stderr));
  if (r.status !== 0) throw new RunnerError('HE-REPL-012', `the ${cell.harness} image build failed (${redact((r.stderr || r.stdout).trim().split('\n').slice(-1)[0] ?? '')}); log ${join(out, `build-${cell.harness}.log`)}. fix: rerun with --resume ${out} once the cause is fixed (same run id, same lease)`);
  const id = d.docker(['image', 'inspect', '--format', '{{.Id}}', tag]);
  return { tag, id: id.status === 0 ? id.stdout.trim() : null };
}

function newRunId(cell: string, d: Deps): string {
  const stamp = d.now().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').toLowerCase();
  return `replicate-${cell}-${stamp}`.slice(0, 115).replace(/-+$/, '') + `-${randomBytes(2).toString('hex')}`;
}

async function rerun(a: Args, d: Deps, sig: { interrupted: boolean; child: ChildProcess | null }, loaded: (b: Loaded) => void): Promise<{ exit: number; report: Record<string, unknown> }> {
  let state: State;
  let b: Loaded;
  let out: string;
  let replay: string[] = [];
  if (typeof a.resume === 'string') {
    out = resolve(a.resume);
    const sf = join(out, 'replicate-state.json');
    if (!existsSync(sf)) throw new RunnerError('HE-REPL-010', `${sf} does not exist; --resume names the --out directory of an earlier rerun`);
    state = JSON.parse(readFileSync(sf, 'utf8')) as State;
    b = await loadBundle({ bundle: state.bundle_path, sha256: state.bundle_sha256 }, d);
    loaded(b);
    const cell = cellOf(b, state.cell);
    paidPreflight(cell, out, d);
    const { commit: head, dirty } = d.checkout();
    if (!head || head !== state.commit) throw new RunnerError('HE-REPL-010', `this checkout is at ${head?.slice(0, 12)}, but the rerun started at ${state.commit.slice(0, 12)}; a resume loads the commit the run recorded. fix: git checkout ${state.commit.slice(0, 12)}`);
    if (dirty.length) throw new RunnerError('HE-REPL-010', `the checkout has uncommitted changes (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', ...' : ''}); a resume runs the committed code the run recorded. fix: git stash, then --resume ${out}`);
    d.out(`RESUME: run ${state.run_id} at commit ${head.slice(0, 12)} (the recorded commit), lease ${usd(state.max_usd)} in ${join(out, 'ledger.sqlite')}`);
    const removed = removeContainers(state.run_id, d);
    if (removed) d.out(`RESUME: removed ${removed} container(s) left by the interrupted invocation`);
    const charged = chargedUnrecorded(join(out, 'results'), state.cell);
    if (charged.length && !a['replay-charged']) throw new RunnerError('HE-REPL-010', `${charged.length} interrupted trial(s) were charged but not recorded (${charged.map((c) => `${c.trial} ${usd(c.usd)}`).join(', ')}); they are not replayed automatically. fix: --resume ${out} --replay-charged to run them again under the same lease (their spend stays counted against the cap)`);
    replay = charged.map((c) => c.trial);
    state.image = await buildImage(cell, state.run_id, out, d);
    state.resumes.push({ at: d.now().toISOString(), commit: head, replay_charged: replay });
    state.interrupted = false;
  } else {
    b = await loadBundle(a, d);
    loaded(b);
    if (typeof a.cell !== 'string') throw new RunnerError('HE-REPL-001', `a paid rerun needs --cell; the bundle's cells are ${(b.manifest.rerun?.cells ?? []).join(', ')}. Run --estimate-only to see each one's cost`);
    if (typeof a['max-usd'] !== 'string') throw new RunnerError('HE-REPL-001', `a paid rerun needs --max-usd <dollars>, the hard cap on everything this invocation spends; run --estimate-only --cell ${a.cell} for the smallest cap`);
    const reg = registeredHeldout(TOOL_ROOT).find((r) => r.id === b.manifest.run_id);
    if (!reg) throw new RunnerError('HE-REPL-011', `run ${b.manifest.run_id} has no held-out cells, and a rerun plans through run.ts plan --replication-of, which takes only registered held-out runs (HE-REPL-002); nothing was started. fix: --reanalyze and --estimate-only still work`);
    if (b.preregSha256 !== reg.sha256) throw new RunnerError('HE-REPL-013', `the bundle's prereg.json (sha256 ${b.preregSha256?.slice(0, 12) ?? 'missing'}) is not the registered ${reg.prereg_json} (sha256 ${reg.sha256.slice(0, 12)}); the rerun plans from the registered one, so the bundle's harness, model and published counts do not describe it. Nothing was started. fix: use the bundle the finding names (--finding, or --sha256 from its data: line)`);
    const cell = cellOf(b, a.cell);
    const reps = Number(a.reps ?? b.manifest.rerun?.default_reps ?? 1);
    const runId = newRunId(cell.id, d);
    out = resolve(typeof a.out === 'string' ? a.out : join(TOOL_ROOT, 'replications', runId));
    if (existsSync(out) && readdirSync(out).length) throw new RunnerError('HE-REPL-001', `--out ${out} exists and is not empty; a fresh rerun writes only into a new or empty directory, so it never touches another run's files. fix: --resume ${out} to continue a rerun started there, or a new --out`);
    paidPreflight(cell, out, d);
    const co = cleanCheckout(b, Boolean(a['accept-drift']), d);
    d.out('EQUIVALENCE: comparing task files, preamble, seed world, harness pin and grades with the run (keyless)');
    const eq = await equivalence(b, cell);
    eq.problems.unshift(...co.problems);
    eq.ok = eq.problems.length === 0;
    for (const l of eq.diff_summary) d.out(`EQUIVALENCE: ${l}`);
    d.out(`EQUIVALENCE: regrade ${eq.regrade.regraded}/${eq.regrade.selected} published trials, ${eq.regrade.changed} changed`);
    if (!eq.ok) {
      for (const p of eq.problems) d.err(`EQUIVALENCE: ${p}`);
      if (!a['accept-drift']) throw new RunnerError('HE-REPL-006', `this commit is not equivalent to the run for ${cell.id} (${eq.problems.length} problem(s), first: ${eq.problems[0]}); fix: check out the finding's rerun commit, or pass --accept-drift to run a labelled drift experiment`);
      d.out('EQUIVALENCE: --accept-drift: this rerun is a drift experiment, labelled as such in the report');
    }
    const est = estimate(b, cell, reps);
    printEstimate(est, d);
    const cap = Number(a['max-usd']);
    if (cap < est.min_cap_usd && !a['allow-short-cap']) throw new RunnerError('HE-REPL-007', `--max-usd ${usd(cap)} is under ${usd(est.min_cap_usd)} (the high estimate ${usd(est.high_usd)} plus the largest single reservation ${usd(est.max_reservation_usd)}); a short cap likely ends in a cap stop. fix: --max-usd ${est.min_cap_usd}, or --allow-short-cap to run anyway`);
    await confirm(cap, a, d);
    mkdirSync(join(out, 'results'), { recursive: true });
    writeFileSync(join(out, 'results', '.gitignore'), RESULTS_GITIGNORE);
    state = { schema_version: REPORT_SCHEMA, run_id: runId, cell: cell.id, reps, max_usd: cap, commit: co.commit, bundle_path: b.path, bundle_sha256: b.sha256, finding_rerun_commit: rerunCommitOf(b), drift_experiment: !eq.ok, image: { tag: '', id: null }, started_at: d.now().toISOString(), resumes: [], equivalence: eq, estimate: est, interrupted: false };
    writeFileSync(join(out, 'replicate-state.json'), JSON.stringify(state, null, 2) + '\n');
    state.image = await buildImage(cell, runId, out, d);
    const prereg = { ...(b.prereg ?? {}), run_id: runId, cells: [{ ...cell, repetitions: reps }], replication_of: b.manifest.run_id };
    writeFileSync(join(out, 'prereg.json'), JSON.stringify(prereg, null, 2) + '\n');
  }
  writeFileSync(join(out, 'replicate-state.json'), JSON.stringify(state, null, 2) + '\n');
  const cell = cellOf(b, state.cell);
  const env = childEnv(cell, d);
  const log = join(out, 'runner.log');
  const manifest = join(out, 'results', 'manifest.json');
  const step = async (args: string[], what: string) => {
    if (sig.interrupted) return;
    const code = await runner(args, env, log, d, sig);
    if (sig.interrupted) return;
    if (code === 3 && what === 'run') return;
    if (code !== 0) throw new RunnerError('HE-REPL-012', `runner ${what} exited ${code}; log ${log}. fix: read the log's last HE- line; once fixed, --resume ${out} continues the same run id under the same lease`);
  };
  if (!existsSync(manifest)) await step(['plan', '--replication-of', String(b.manifest.run_id), '--cells', state.cell, '--reps', String(state.reps), '--run-id', state.run_id, '--out', join(out, 'results')], 'plan');
  await step(['preflight', '--manifest', manifest, '--cells', state.cell, '--image', state.image.tag], 'preflight');
  await step(['run', '--manifest', manifest, '--cells', state.cell, '--image', state.image.tag, '--stop-on-cap', '--ledger', join(out, 'ledger.sqlite'), '--lease-usd', String(state.max_usd), '--max-output-tokens', String(MAX_OUTPUT_TOKENS), ...(existsSync(join(out, 'results', 'trials.jsonl')) || state.resumes.length ? ['--resume'] : [])], 'run');
  if (sig.interrupted) {
    const removed = removeContainers(state.run_id, d);
    d.err(`INTERRUPTED: the runner and its proxy were stopped${removed ? ` and ${removed} container(s) removed` : ''}; the lease stays open. Continue with: bun scripts/replicate.ts --resume ${out}`);
    state.interrupted = true;
    writeFileSync(join(out, 'replicate-state.json'), JSON.stringify(state, null, 2) + '\n');
  }
  return compare(b, state, out, d);
}

/** Completeness, band and difference: the report. */
export function compare(b: Loaded, state: State, out: string, d: Deps): { exit: number; report: Record<string, unknown> } {
  const results = join(out, 'results');
  const summaryFile = join(results, 'run-summary.json');
  const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) as { cap_stop?: boolean; complete?: boolean; trials_planned?: number } : null;
  const man = existsSync(join(results, 'manifest.json')) ? JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { trials: Array<{ id: string; cell: string }> } : { trials: [] };
  const planned = man.trials.filter((t) => t.cell === state.cell).length;
  const capTrials = new Set(usageLines(results).filter(isCapRefusal).map((l) => keyTrial(l.key)));
  const recs = records(results).filter((r) => r.cell === state.cell);
  const capped = recs.filter((r) => r.cap_stop || capTrials.has(r.trial_id)).map((r) => r.trial_id);
  const errored = recs.filter((r) => !capped.includes(r.trial_id) && EXCLUDED_TERMINATIONS.has(r.termination ?? '')).map((r) => r.trial_id);
  const excluded = [...capped, ...errored];
  const kept = recs.filter((r) => !excluded.includes(r.trial_id));
  const capStop = Boolean(summary?.cap_stop) || capped.length > 0;
  const complete = !state.interrupted && !capStop && planned > 0 && kept.length === planned;
  const lease = existsSync(join(out, 'ledger.sqlite')) ? ledgerStatus({ ledgerPath: join(out, 'ledger.sqlite'), runId: state.run_id }).run : null;
  const published = cellCounts(readFileSync(join(b.results, 'trials.jsonl'), 'utf8'), state.cell);
  const rerunCounts = cellCounts(kept.map((r) => JSON.stringify(r)).join('\n'), state.cell);
  const passes = rerunCounts.reduce((s: number, t: TaskCount) => s + t.k, 0);
  const base = {
    schema_version: REPORT_SCHEMA, mode: 'rerun', label: 'one cell\'s pass rate; the finding\'s harness comparison is reproduced by --reanalyze',
    tool: identities(b), bundle: bundleInfo(b),
    rerun: { run_id: state.run_id, commit: state.commit, cell: state.cell, reps: state.reps, out, image: state.image, started_at: state.started_at, resumes: state.resumes, interrupted: state.interrupted, drift_experiment: state.drift_experiment },
    equivalence: state.equivalence, estimate: state.estimate,
    spend: { cap_usd: state.max_usd, committed_usd: lease?.committed_usd ?? null, lease_open: lease ? lease.finished_at === null : null },
    completeness: { planned, recorded: recs.length, kept: kept.length, excluded, errored, cap_stop: capStop, complete },
    published: { trials: published.reduce((s: number, t: TaskCount) => s + t.n, 0), passes: published.reduce((s: number, t: TaskCount) => s + t.k, 0), pass_rate: passRate(published) },
  };
  if (!complete) {
    const why = state.interrupted ? 'interrupted' : capStop ? 'cap stop' : errored.length ? `${errored.length} trial(s) ended in a model, infra or exam error and are not scored` : `${kept.length} of ${planned} trials recorded`;
    d.out(`INCOMPLETE (${why}): ${kept.length} of ${planned} trials kept, ${passes} passed; nothing is extrapolated and no band is compared. Spend ${lease ? usd(lease.committed_usd) : 'unknown'} of the ${usd(state.max_usd)} cap.${state.interrupted ? ` Continue with --resume ${out}.` : capStop ? ' A cap stop is the end of this rerun; start a new one with a larger --max-usd if you want.' : ''}`);
    return finish(out, { ...base, verdict: 'INCOMPLETE', exit_code: 3 }, 3, d);
  }
  const publishedTasks = published.map((t) => t.task);
  const rerunTasks = rerunCounts.map((t) => t.task);
  const taskGap = { no_published_scored_trial: rerunTasks.filter((t) => !publishedTasks.includes(t)), not_rerun: publishedTasks.filter((t) => !rerunTasks.includes(t)) };
  const diff = pairedDifference(published, rerunCounts);
  const rerunRate = passRate(rerunCounts);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  d.out(`RERUN: ${passes} of ${kept.length} passed (${pct(rerunRate.estimate)}, 95% CI ${pct(rerunRate.lo)} to ${pct(rerunRate.hi)}); published ${base.published.passes} of ${base.published.trials} (${pct(base.published.pass_rate.estimate)})`);
  d.out(`DIFFERENCE: rerun minus published ${pct(diff.estimate)}, task-paired 95% interval ${pct(diff.lo)} to ${pct(diff.hi)}`);
  let verdict: string;
  let exit: number;
  let band: Record<string, unknown> | null = null;
  const coverage = taskGap.no_published_scored_trial.length || taskGap.not_rerun.length ? null : coverageFor(b, state.cell, state.reps, published);
  if (!coverage) {
    verdict = 'NO BAND';
    exit = 5;
    d.out(`NO BAND: the published counts and the rerun cover different tasks (no published scored trial: ${taskGap.no_published_scored_trial.join(', ') || 'none'}; not rerun: ${taskGap.not_rerun.join(', ') || 'none'}), so a band would describe other tasks; only the difference above is reported`);
  } else if (!coverage.passes) {
    verdict = 'NO BAND';
    exit = 5;
    d.out(`NO BAND: the band's coverage check at ${state.reps} rep(s) gave ${pct(coverage.coverage)}, under the ${pct(COVERAGE_GATE)} gate (${coverage.source}); only the difference above is reported`);
  } else {
    const bd = replicationBand(published, state.reps);
    band = { lo: bd.lo, hi: bd.hi, of: kept.length, attained: bd.attained, coverage: coverage.coverage, coverage_source: coverage.source, seed: bd.seed, draws: bd.draws };
    const inside = passes >= bd.lo && passes <= bd.hi;
    verdict = inside ? 'WITHIN BAND' : 'OUTSIDE BAND';
    exit = inside ? 0 : 4;
    d.out(`BAND: ${bd.lo} to ${bd.hi} passes of ${kept.length} (95% posterior-predictive, attained ${pct(bd.attained)}; coverage ${pct(coverage.coverage)}, ${coverage.source})`);
  }
  d.out(`${verdict}${state.drift_experiment ? ' (drift experiment)' : ''}`);
  if (verdict !== 'WITHIN BAND') d.out(`A miss can come from ${MISS_CAUSES.join('; ')}. One miss is a signal to look, not a refutation.`);
  return finish(out, { ...base, band, task_gap: taskGap, difference: diff, rerun_result: { trials: kept.length, passes, pass_rate: rerunRate }, verdict, exit_code: exit, causes_of_a_miss: MISS_CAUSES }, exit, d);
}

function coverageFor(b: Loaded, cell: string, reps: number, published: TaskCount[]): { coverage: number; passes: boolean; source: string } {
  const dir = join(TOOL_ROOT, 'docs', 'replicate');
  const key = JSON.stringify(published.map((t) => [t.task, t.k, t.n]));
  for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith('band-coverage-') && n.endsWith('.json')) : []) {
    const e = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cell: string; tasks: unknown; rows: Array<{ reps: number; coverage_posterior: number }> };
    const row = e.cell === cell && JSON.stringify(e.tasks) === key ? e.rows.find((r) => r.reps === reps) : undefined;
    if (row) return { coverage: row.coverage_posterior, passes: row.coverage_posterior >= COVERAGE_GATE, source: `docs/replicate/${f}` };
  }
  void b;
  const c = bandCoverage(published, reps, { rounds: 2000, draws: 2000 });
  return { coverage: c.coverage, passes: c.coverage >= COVERAGE_GATE, source: 'simulated now, 2,000 rounds of 2,000 draws' };
}

function finish(out: string, report: Record<string, unknown>, exit: number, d: Deps): { exit: number; report: Record<string, unknown> } {
  let rerunBundle: Record<string, unknown>;
  try {
    const rel = relative(TOOL_ROOT, out);
    if (rel.startsWith('..')) throw new Error(`--out ${out} is outside the checkout`);
    const cell = String((report.rerun as { cell: string }).cell);
    const built = buildBundle({ root: TOOL_ROOT, run: rel, finding: `replicate-${cell}`.toLowerCase(), local: true, rerunCommit: String((report.rerun as { commit: string }).commit), out: join(out, 'rerun.bundle.tar.gz') });
    rerunBundle = { path: built.path, sha256: built.sha256 };
    d.out(`BUNDLE: ${built.path} sha256 ${built.sha256} (share it; check it with bun scripts/bundle.ts verify)`);
  } catch (e) {
    rerunBundle = { error: redact((e as Error).message) };
    d.err(`BUNDLE: not built: ${redact((e as Error).message)}`);
  }
  const full = { ...report, rerun_bundle: rerunBundle };
  writeFileSync(join(out, 'replicate-report.json'), JSON.stringify(full, null, 2) + '\n');
  return { exit, report: full };
}

function identities(b?: Loaded) {
  return { tool_commit: headCommit(), bun: Bun.version, platform: `${process.platform} ${process.arch}`, generator_commit: b?.manifest.generator?.commit ?? null, run_commit: b?.manifest.run_commit ?? null };
}

// ---------- main ----------

export async function main(argv: string[], d: Deps = realDeps): Promise<number> {
  let json = argv.includes('--json');
  const sig: { interrupted: boolean; child: ChildProcess | null } = { interrupted: false, child: null };
  let b: Loaded | undefined;
  const onSignal = () => {
    if (!sig.child) {
      d.err('INTERRUPTED: no runner was running, so nothing was spent by this step; stopping now');
      if (b) rmSync(b.dir, { recursive: true, force: true });
      process.exit(130);
    }
    if (sig.interrupted) { stopGroup(sig.child, 'SIGKILL'); return; }
    sig.interrupted = true;
    d.err('INTERRUPTED: stopping the runner and its proxy (the lease stays open); press Ctrl-C again to kill them at once');
    if (sig.child) { const c = sig.child; stopGroup(c, 'SIGTERM'); setTimeout(() => stopGroup(c, 'SIGKILL'), 60_000).unref(); }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const a = parseArgs(argv);
    json = Boolean(a.json);
    let result: { exit: number; report: Record<string, unknown> };
    if (a.reanalyze) { b = await loadBundle(a, d); result = reanalyze(b, d); }
    else if (a['estimate-only']) {
      b = await loadBundle(a, d);
      const ids = typeof a.cell === 'string' ? [a.cell] : (b.manifest.rerun?.available ? b.manifest.rerun.cells : []);
      if (!ids.length) throw new RunnerError('HE-REPL-011', `bundle ${b.sha256.slice(0, 12)} has no rerunnable cells (${b.manifest.held_out?.note ?? b.manifest.profile})`);
      const ests: Estimate[] = [];
      for (const id of ids) {
        let cell: CellDef;
        try { cell = cellOf(b, id); } catch (e) { if (typeof a.cell === 'string') throw e; d.out(`ESTIMATE: ${id}: ${(e as Error).message}`); continue; }
        const e = estimate(b, cell, Number(a.reps ?? b.manifest.rerun?.default_reps ?? 1));
        printEstimate(e, d);
        ests.push(e);
      }
      result = { exit: 0, report: { schema_version: REPORT_SCHEMA, mode: 'estimate-only', bundle: bundleInfo(b), estimates: ests } };
    } else result = await rerun(a, d, sig, (x) => { b = x; });
    if (json) d.out(JSON.stringify(result.report, null, 2));
    return result.exit;
  } catch (e) {
    const code = e instanceof RunnerError ? e.code : 'HE-REPL-012';
    const message = redact(e instanceof RunnerError ? e.message : `HE-REPL-012 unexpected failure: ${(e as Error).message}`);
    const trace = join(tmpdir(), `replicate-trace-${process.pid}.log`);
    writeFileSync(trace, redact(String((e as Error).stack ?? e)) + '\n');
    const ids = identities(b);
    d.err(message);
    d.err(`context: tool ${ids.tool_commit?.slice(0, 12) ?? 'unknown'}, bun ${ids.bun}, ${ids.platform}${ids.generator_commit ? `, bundle generator ${ids.generator_commit.slice(0, 12)}` : ''}${ids.run_commit ? `, run ${ids.run_commit.slice(0, 12)}` : ''}; trace ${trace}`);
    if (json) d.out(JSON.stringify({ schema_version: REPORT_SCHEMA, error: { code, message, identities: ids, trace } }, null, 2));
    return 2;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (b) rmSync(b.dir, { recursive: true, force: true });
  }
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => process.exit(code));
