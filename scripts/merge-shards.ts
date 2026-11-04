#!/usr/bin/env bun
// Merge the shards of one run into the results directory the report scripts read (CREW.md, Parallelism: a long run is
// sharded by whole cells across machines, each shard a clean checkout at the same commit running `plan` itself, trials
// sequential within a shard).
//
//   bun scripts/merge-shards.ts --out <results dir> --shard <name>=<shard results dir> [--shard <name>=<dir> ...] [--sealed-root <dir>] [--partial]
//
// --partial (internal-task, plan decision 9's stop rule): a run that stopped on its cap is reported from what exists and is never
// resumed or backfilled. The merge then accepts manifest trials that no shard recorded, writes them, in manifest order,
// to unstarted.json ({ run_id, count, trials: [{ id, cell }], cap_stops }) and writes trials.jsonl with the recorded trials
// only. Each cell with unstarted trials must show its own cap stop: its recorded trials are an unbroken start of its
// manifest order and the last of them has cap_stop (the runner records the refused trial and stops), backed by a cap
// refusal under that trial's key at or after its started_at in its shard's proxy-usage.ndjson (cap_stop alone can come from
// an earlier attempt, runner/trial/proxy.ts summarizeUsage; see TODOS.md). A cell with no
// record, with a hole before a later record, or whose last record is not a cap stop, is refused: a shard lost to a crash or a failed copy-back is finished with run --resume. This assumes one cell per shard
// with trials in manifest order, as internal-task runs; a multi-cell shard's later cells have no record after a cap stop and are
// refused. cap_stops lists the evidence per cell ({ cell, shard, cap_stop_trial }). Every other refusal still applies.
// Without --partial a missing trial is a refusal.
//
// What it builds, refusing (exit 2, naming the offender) rather than guessing:
//   manifest.json      the first shard's; every other shard's manifest must agree once created_at is removed (run_id,
//                      prereg sha256, cells, trials, ceilings) and is kept as <name>.manifest.json; a sealed block must
//                      name the same set and the same opening (openingDiff on its receipt), so a shard planned from a
//                      receipt rewritten by resuming that opening merges
//   trials.jsonl       every shard's records in the manifest's trial order; a trial id in two shards, in no shard, or in a
//                      shard but not in the manifest is a refusal
//   trials/            each shard's trial directories; a cell directory present in two shards is a refusal
//   <name>.ledger.sqlite, <name>.proxy.log, <name>.proxy-usage.ndjson, <name>.ablation.ndjson (prompt archaeology), <name>.run-summary.json, <name>.run.log,
//   <name>.reconcile*.json, <name>.preflight-*/ (without tokens.json or ingest-tokens.json: the brain's tokens stay on the shard), <name>.laneb/ (a Lane B
//                      shard's Lane B run root: Harbor jobs, Lane B proxy sessions and ledger, docs/gstack-laneb.md), <name>.gbrain-install/ (the first shard's gbrain-install/ is also copied
//                      under its own name), <name>.shard.json: each shard's own files under its name
//   shards.json        { cells: { <cell id>: <shard name> }, shards: { <name>: { machine, commit, images, source, trials,
//                      cells } } }, machine, commit and images from the shard's shard.json ({name, machine, commit, images},
//                      written by whoever dispatched the shard) when it carries one, null otherwise; a shard.json whose
//                      name is not the --shard name is a refusal
// compare-run.ts --pair gbrain reads shards.json to label every cost and latency row with the machines the two cells ran on.
// Nothing is written until every check has passed, and an --out that already holds trials.jsonl, unstarted.json or a
// proxy usage log is refused.
// A sealed run (its manifest.json has a "sealed" block, docs/sealed-custody.md) is merged inside custody with
// --sealed-root <the opened root>, or refused under HE-SEALED-001: a refusal names trial ids, which carry task ids, so
// under the sealed output guard it goes whole to <out>/merge-shards.sealed.log and the terminal gets the merged counts only.
// Every shard's manifest decides: a mix of sealed and plaintext shards is HE-SEALED-001. Before the guard writes its log,
// a sealed merge refuses (HE-SEALED-002) an --out, a --sealed-root or a shard directory inside a git work tree, and
// (HE-SEALED-003) a root whose opening-receipt.json is missing or names another opening than the manifest's. A manifest,
// trials.jsonl or receipt that is not JSON is refused naming the file, the line and the parser's error class only.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';
import { isCapRefusal } from '../runner/trial/proxy.ts';
import type { TrialRecord } from '../runner/contracts.ts';
import { RunnerError } from '../runner/errors.ts';
import { sealedGuard } from '../runner/heldout/guard.ts';
import { openingDiff, readJsonFile, readJsonLines, type OpeningReceipt } from '../runner/heldout/sealed.ts';
import { insideGitTree } from './sealed/custody.ts';

export interface ShardInput { name: string; dir: string }
export interface ShardInfo { name: string; machine: string | null; commit: string | null; images: unknown; source: string; trials: number; cells: string[] }
export interface CapStopEvidence { cell: string; shard: string; cap_stop_trial: string }
export interface ShardsFile { cells: Record<string, string>; shards: Record<string, ShardInfo> }

export class MergeError extends Error {}

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const SECRET_FILES = new Set(['token', 'token.tmp', 'tokens.json', 'ingest-tokens.json', 'tokens.json.tmp', 'ingest-tokens.json.tmp']);
const PER_SHARD_FILES = ['ledger.sqlite', 'proxy.log', 'proxy-usage.ndjson', 'ablation.ndjson', 'run-summary.json', 'run.log', 'shard.json'];
const perShard = (entry: string) => PER_SHARD_FILES.includes(entry) || /^reconcile.*\.json$/.test(entry) || /^preflight-/.test(entry) || entry === 'gbrain-install' || entry === 'laneb';

/** Plan the merge without writing: every refusal is raised here. */
export interface MergeOptions { partial?: boolean }

export function planMerge(out: string, shards: ShardInput[], options: MergeOptions = {}): { manifest: { run_id: string; trials: Array<{ id: string; cell: string }> }; rows: TrialRecord[]; shardsFile: ShardsFile; copies: Array<{ from: string; to: string }>; unstarted: Array<{ id: string; cell: string }>; capStops: CapStopEvidence[] } {
  if (!shards.length) throw new MergeError('no shards: pass --shard <name>=<dir> at least once');
  const names = new Set<string>();
  for (const s of shards) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.name)) throw new MergeError(`shard name ${JSON.stringify(s.name)} must be letters, digits, dot, underscore or dash`);
    if (names.has(s.name)) throw new MergeError(`shard name ${s.name} given twice`);
    names.add(s.name);
    for (const f of ['manifest.json', 'trials.jsonl']) if (!existsSync(join(s.dir, f))) throw new MergeError(`shard ${s.name}: ${join(s.dir, f)} is missing`);
  }
  if (existsSync(join(out, 'trials.jsonl'))) throw new MergeError(`${out} already holds trials.jsonl; merge into an empty directory`);
  const stale = existsSync(out) ? readdirSync(out).filter((f) => f === 'unstarted.json' || /(^|[.])proxy-usage[.]ndjson$/.test(f)) : [];
  if (stale.length) throw new MergeError(`${out} already holds ${stale.slice(0, 3).join(', ')} from an earlier merge; merge into an empty directory`);
  type Sealed = { set: string; receipt_sha256?: string; receipt: OpeningReceipt };
  const manifests = shards.map((s) => readJsonFile<{ run_id: string; created_at?: string; sealed?: Sealed; trials: Array<{ id: string; cell: string }> } & Record<string, unknown>>(join(s.dir, 'manifest.json')));
  const strip = ({ created_at: _c, sealed: _s, ...rest }: Record<string, unknown>) => rest;
  const first = manifests[0]!;
  // A shard planned after the opening was resumed holds the rewritten receipt (and its sha256): the same opening merges.
  const sealedDiff = (a?: Sealed, b?: Sealed): string[] => (!a || !b ? (a || b ? ['sealed'] : []) : a.set !== b.set ? ['sealed.set'] : openingDiff(a.receipt, b.receipt).map((k) => `sealed.receipt.${k}`));
  manifests.forEach((m, i) => {
    if (i === 0) return;
    const a = strip(first), b = strip(m);
    const differing = [...[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canonical(a[k]) !== canonical(b[k])), ...sealedDiff(first.sealed, m.sealed)];
    if (differing.length) throw new MergeError(`shard ${shards[i]!.name}: manifest.json differs from shard ${shards[0]!.name}'s in ${differing.join(', ')}; every shard must run plan at the same commit on the same preregistration`);
  });
  const owner = new Map<string, string>();
  const rowsById = new Map<string, TrialRecord>();
  const infos: Record<string, ShardInfo> = {};
  const cellOwner = new Map<string, string>();
  for (const s of shards) {
    const rows = readJsonLines<TrialRecord>(join(s.dir, 'trials.jsonl'));
    for (const t of rows) {
      const other = owner.get(t.trial_id);
      if (other) throw new MergeError(`trial ${t.trial_id} is in shards ${other} and ${s.name}; a cell runs on one shard`);
      owner.set(t.trial_id, s.name);
      rowsById.set(t.trial_id, t);
      const cellShard = cellOwner.get(t.cell);
      if (cellShard && cellShard !== s.name) throw new MergeError(`cell ${t.cell} has trials in shards ${cellShard} and ${s.name}; a cell runs on one shard`);
      cellOwner.set(t.cell, s.name);
    }
    let meta: { name?: unknown; machine?: unknown; commit?: unknown; images?: unknown } = {};
    if (existsSync(join(s.dir, 'shard.json'))) {
      meta = readJsonFile<typeof meta>(join(s.dir, 'shard.json'));
      if (meta.name !== undefined && meta.name !== s.name) throw new MergeError(`shard ${s.name}: its shard.json names itself ${JSON.stringify(meta.name)}`);
    }
    infos[s.name] = { name: s.name, machine: typeof meta.machine === 'string' ? meta.machine : null, commit: typeof meta.commit === 'string' ? meta.commit : null, images: meta.images ?? null, source: s.dir, trials: rows.length, cells: [...new Set(rows.map((t) => t.cell))].sort() };
  }
  const planned = new Set(first.trials.map((t) => t.id));
  const missing = first.trials.filter((t) => !owner.has(t.id)).map((t) => t.id);
  const shardLogs = new Map<string, UsageLine[]>();
  const capRefusedAfterStart = (dir: string, t: TrialRecord) => {
    const log = join(dir, 'proxy-usage.ndjson');
    if (!shardLogs.has(dir)) shardLogs.set(dir, existsSync(log) ? readFileSync(log, 'utf8').split('\n').flatMap((l) => { try { return [JSON.parse(l) as UsageLine]; } catch { return []; } }) : []);
    const keys = [t.usage?.meter_id, `trial-token:${t.trial_id}`, `sk-trial-${t.trial_id}`].filter(Boolean);
    const start = t.started_at ? Date.parse(t.started_at) : -Infinity;
    return shardLogs.get(dir)!.some((row) => keys.includes(row.key) && Date.parse(row.at) >= start && isCapRefusal(row));
  };
  const capStops: CapStopEvidence[] = [];
  const unexplained: string[] = [];
  for (const cell of [...new Set(first.trials.filter((t) => !owner.has(t.id)).map((t) => t.cell))]) {
    const planned = first.trials.filter((t) => t.cell === cell);
    const gap = planned.findIndex((t) => !owner.has(t.id));
    const last = gap > 0 ? rowsById.get(planned[gap - 1]!.id)! : undefined;
    const late = planned.slice(gap).find((t) => owner.has(t.id));
    if (late) unexplained.push(`${cell} (${planned[gap]!.id} is missing but the later ${late.id} was recorded)`);
    else if (last?.cap_stop && capRefusedAfterStart(shards.find((s) => s.name === owner.get(last.trial_id))!.dir, last)) capStops.push({ cell, shard: owner.get(last.trial_id)!, cap_stop_trial: last.trial_id });
    else if (last?.cap_stop) unexplained.push(`${cell} (last record ${last.trial_id} has cap_stop, but shard ${owner.get(last.trial_id)}'s proxy-usage.ndjson shows no cap refusal for it at or after its started_at)`);
    else unexplained.push(last ? `${cell} (last record ${last.trial_id} is not a cap stop)` : `${cell} (no recorded trial)`);
  }
  if (options.partial && unexplained.length) throw new MergeError(`${missing.length} manifest trial(s) in no shard, and ${unexplained.length} cell(s) with unstarted trials show no cap stop: ${unexplained.slice(0, 10).join('; ')}${unexplained.length > 10 ? '; ...' : ''}. --partial merges only cells that stopped on their cap (the last recorded trial has cap_stop and a cap refusal at or after its started_at in its shard's proxy-usage.ndjson); an incomplete shard without one is finished with run --resume before the merge`);
  if (missing.length && !options.partial) throw new MergeError(`${missing.length} manifest trial(s) in no shard: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? `, and ${missing.length - 20} more` : ''}; an incomplete shard is finished with run --resume before the merge, or, after a cap stop that is never resumed, merged with --partial`);
  const stray = [...owner.keys()].filter((id) => !planned.has(id));
  if (stray.length) throw new MergeError(`${stray.length} trial(s) not in the manifest: ${stray.slice(0, 20).map((id) => `${id} (shard ${owner.get(id)})`).join(', ')}`);
  const cells: Record<string, string> = {};
  for (const t of first.trials) if (owner.has(t.id)) cells[t.cell] = owner.get(t.id)!;
  const copies: Array<{ from: string; to: string }> = [];
  const trialDirs = new Map<string, string>();
  shards.forEach((s, i) => {
    const trialsDir = join(s.dir, 'trials');
    if (existsSync(trialsDir)) {
      for (const cell of readdirSync(trialsDir)) {
        const other = trialDirs.get(cell);
        if (other) throw new MergeError(`trials/${cell} is in shards ${other} and ${s.name}`);
        trialDirs.set(cell, s.name);
        copies.push({ from: join(trialsDir, cell), to: join(out, 'trials', cell) });
      }
    }
    for (const entry of readdirSync(s.dir)) {
      if (perShard(entry)) copies.push({ from: join(s.dir, entry), to: join(out, `${s.name}.${entry}`) });
    }
    if (i > 0) copies.push({ from: join(s.dir, 'manifest.json'), to: join(out, `${s.name}.manifest.json`) });
    if (i === 0 && existsSync(join(s.dir, 'gbrain-install'))) copies.push({ from: join(s.dir, 'gbrain-install'), to: join(out, 'gbrain-install') });
  });
  const rows = first.trials.filter((t) => rowsById.has(t.id)).map((t) => rowsById.get(t.id)!);
  const unstarted = first.trials.filter((t) => !owner.has(t.id)).map((t) => ({ id: t.id, cell: t.cell }));
  return { manifest: first, rows, shardsFile: { cells, shards: infos }, copies, unstarted, capStops };
}

export function mergeShards(out: string, shards: ShardInput[], options: MergeOptions = {}): ShardsFile & { unstarted: number } {
  const plan = planMerge(out, shards, options);
  mkdirSync(out, { recursive: true });
  for (const c of plan.copies) {
    // A preflight directory is a sidecar's own out directory: its bearer token (`token`) and, on a brain with member tokens,
    // tokens.json and ingest-tokens.json (gbrain/entrypoint.sh). They stay on the shard and never enter the merged results
    // directory, whatever its .gitignore says.
    if (statSync(c.from).isDirectory()) cpSync(c.from, c.to, { recursive: true, filter: (src) => !SECRET_FILES.has(basename(src)) });
    else { mkdirSync(join(c.to, '..'), { recursive: true }); cpSync(c.from, c.to); }
  }
  cpSync(join(shards[0]!.dir, 'manifest.json'), join(out, 'manifest.json'));
  writeFileSync(join(out, 'trials.jsonl'), plan.rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(out, 'shards.json'), JSON.stringify(plan.shardsFile, null, 1) + '\n');
  if (options.partial) writeFileSync(join(out, 'unstarted.json'), JSON.stringify({ run_id: plan.manifest.run_id, count: plan.unstarted.length, trials: plan.unstarted, cap_stops: plan.capStops }, null, 1) + '\n');
  return { ...plan.shardsFile, unstarted: plan.unstarted.length };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const out = argv[argv.indexOf('--out') + 1];
  const shards: ShardInput[] = [];
  argv.forEach((a, i) => { if (a === '--shard') { const v = argv[i + 1] ?? ''; const eq = v.indexOf('='); if (eq < 1) { console.error(`--shard takes <name>=<dir>, not ${JSON.stringify(v)}`); process.exit(2); } shards.push({ name: v.slice(0, eq), dir: v.slice(eq + 1) }); } });
  const partial = argv.includes('--partial');
  if (!argv.includes('--out') || !out || !shards.length) {
    console.error('usage: bun scripts/merge-shards.ts --out <results dir> --shard <name>=<shard results dir> [--shard <name>=<dir> ...] [--sealed-root <dir>] [--partial]');
    process.exit(2);
  }
  const sealedRoot = argv.includes('--sealed-root') ? argv[argv.indexOf('--sealed-root') + 1] : undefined;
  const refuse = (msg: string): never => { console.error(msg); process.exit(2); };
  const quiet = <T>(read: () => T): T => { try { return read(); } catch (e) { if (e instanceof RunnerError) refuse(e.message); throw e; } };
  type Planned = { run_id: string; sealed?: { set: string; receipt: OpeningReceipt } };
  const planned = shards.filter((s) => existsSync(join(s.dir, 'manifest.json'))).map((s) => ({ s, m: quiet(() => readJsonFile<Planned>(join(s.dir, 'manifest.json'))) }));
  const sealedShards = planned.filter((p) => p.m.sealed);
  if (sealedShards.length && sealedShards.length < planned.length) refuse(`HE-SEALED-001 shards ${sealedShards.map((p) => p.s.name).join(', ')} were planned with a sealed root and ${planned.filter((p) => !p.m.sealed).map((p) => p.s.name).join(', ')} without one; a merge holds the shards of one run, planned the same way`);
  const sealedRun = sealedShards[0]?.m;
  const sealed = sealedRun?.sealed;
  if (sealed && !sealedRoot) refuse(`HE-SEALED-001 shard ${sealedShards[0]!.s.name} was planned with a sealed root (set ${sealed.set}); merge it inside custody with --sealed-root <the opened root> (docs/sealed-custody.md)`);
  if (sealedRun && sealed && sealedRoot) {
    const inTree = [['--out', out], ['--sealed-root', sealedRoot], ...shards.map((s) => [`--shard ${s.name}`, s.dir])].filter(([, p]) => insideGitTree(p!));
    if (inTree.length) refuse(`HE-SEALED-002 ${inTree.map(([k, p]) => `${k} ${p}`).join(', ')} ${inTree.length > 1 ? 'are' : 'is'} inside a git work tree; a sealed run's raw results and its root stay outside every checkout until release. Nothing was written`);
    const receiptPath = join(sealedRoot, 'opening-receipt.json');
    if (!existsSync(receiptPath)) refuse(`HE-SEALED-003 --sealed-root ${sealedRoot} has no opening-receipt.json; pass the root scripts/sealed/open.ts opened for run ${sealedRun.run_id}`);
    const differs = openingDiff(quiet(() => readJsonFile<OpeningReceipt>(receiptPath)), sealed.receipt);
    if (differs.length) refuse(`HE-SEALED-003 ${receiptPath} is not the opening the shards were planned with (run ${sealedRun.run_id}; it differs in ${differs.join(', ')}); pass that run's opened root`);
  }
  if (sealed) sealedGuard({ root: sealedRoot!, set: sealed.set, repoRoot: process.cwd(), preregJson: sealed.receipt?.prereg_json, logFile: join(out, 'merge-shards.sealed.log'), allow: [/^Merged \d+ shard\(s\) into /, /^\| /, /^Partial merge: \d+ manifest trial/], label: 'scripts/merge-shards.ts' });
  try {
    const f = mergeShards(out, shards, { partial });
    const cellsOf = (name: string) => Object.entries(f.cells).filter(([, s]) => s === name).map(([c]) => c);
    console.log([`Merged ${shards.length} shard(s) into ${out}: ${Object.keys(f.cells).length} cells, ${Object.values(f.shards).reduce((s, i) => s + i.trials, 0)} trials.`, '', '| Shard | Machine | Commit | Trials | Cells |', '|---|---|---|---|---|',
      ...Object.values(f.shards).map((i) => `| ${i.name} | ${i.machine ?? 'unknown'} | ${i.commit ?? 'unknown'} | ${i.trials} | ${cellsOf(i.name).join(', ')} |`)].join('\n'));
    if (partial) console.log(`Partial merge: ${f.unstarted} manifest trial(s) unstarted, listed in ${join(out, 'unstarted.json')}; nothing was backfilled.`);
  } catch (e) {
    if (e instanceof MergeError || e instanceof RunnerError) { console.error(e instanceof MergeError ? `merge-shards: ${e.message}` : e.message); process.exit(2); }
    throw e;
  }
}
