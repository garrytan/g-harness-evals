#!/usr/bin/env bun
// Merge the shards of one run into the results directory the report scripts read (CREW.md, Parallelism: a long run is
// sharded by whole cells across machines, each shard a clean checkout at the same commit running `plan` itself, trials
// sequential within a shard).
//
//   bun scripts/merge-shards.ts --out <results dir> --shard <name>=<shard results dir> [--shard <name>=<dir> ...]
//
// What it builds, refusing (exit 2, naming the offender) rather than guessing:
//   manifest.json      the first shard's; every other shard's manifest must agree once created_at is removed (run_id,
//                      prereg sha256, cells, trials, ceilings) and is kept as <name>.manifest.json
//   trials.jsonl       every shard's records in the manifest's trial order; a trial id in two shards, in no shard, or in a
//                      shard but not in the manifest is a refusal
//   trials/            each shard's trial directories; a cell directory present in two shards is a refusal
//   <name>.ledger.sqlite, <name>.proxy.log, <name>.proxy-usage.ndjson, <name>.run-summary.json, <name>.run.log,
//   <name>.reconcile*.json, <name>.preflight-*/ (without tokens.json or ingest-tokens.json: the brain's tokens stay on the shard), <name>.gbrain-install/ (the first shard's gbrain-install/ is also copied
//                      under its own name), <name>.shard.json: each shard's own files under its name
//   shards.json        { cells: { <cell id>: <shard name> }, shards: { <name>: { machine, commit, images, source, trials,
//                      cells } } }, machine, commit and images from the shard's shard.json ({name, machine, commit, images},
//                      written by whoever dispatched the shard) when it carries one, null otherwise; a shard.json whose
//                      name is not the --shard name is a refusal
// compare-run.ts --pair gbrain reads shards.json to label every cost and latency row with the machines the two cells ran on.
// Nothing is written until every check has passed, and an --out that already holds trials.jsonl is refused.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';

export interface ShardInput { name: string; dir: string }
export interface ShardInfo { name: string; machine: string | null; commit: string | null; images: unknown; source: string; trials: number; cells: string[] }
export interface ShardsFile { cells: Record<string, string>; shards: Record<string, ShardInfo> }

export class MergeError extends Error {}

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const SECRET_FILES = new Set(['token', 'token.tmp', 'tokens.json', 'ingest-tokens.json', 'tokens.json.tmp', 'ingest-tokens.json.tmp']);
const PER_SHARD_FILES = ['ledger.sqlite', 'proxy.log', 'proxy-usage.ndjson', 'run-summary.json', 'run.log', 'shard.json'];
const perShard = (entry: string) => PER_SHARD_FILES.includes(entry) || /^reconcile.*\.json$/.test(entry) || /^preflight-/.test(entry) || entry === 'gbrain-install';

/** Plan the merge without writing: every refusal is raised here. */
export function planMerge(out: string, shards: ShardInput[]): { manifest: { run_id: string; trials: Array<{ id: string; cell: string }> }; rows: TrialRecord[]; shardsFile: ShardsFile; copies: Array<{ from: string; to: string }> } {
  if (!shards.length) throw new MergeError('no shards: pass --shard <name>=<dir> at least once');
  const names = new Set<string>();
  for (const s of shards) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.name)) throw new MergeError(`shard name ${JSON.stringify(s.name)} must be letters, digits, dot, underscore or dash`);
    if (names.has(s.name)) throw new MergeError(`shard name ${s.name} given twice`);
    names.add(s.name);
    for (const f of ['manifest.json', 'trials.jsonl']) if (!existsSync(join(s.dir, f))) throw new MergeError(`shard ${s.name}: ${join(s.dir, f)} is missing`);
  }
  if (existsSync(join(out, 'trials.jsonl'))) throw new MergeError(`${out} already holds trials.jsonl; merge into an empty directory`);
  const manifests = shards.map((s) => JSON.parse(readFileSync(join(s.dir, 'manifest.json'), 'utf8')) as { run_id: string; created_at?: string; trials: Array<{ id: string; cell: string }> } & Record<string, unknown>);
  const strip = ({ created_at: _c, ...rest }: Record<string, unknown>) => rest;
  const first = manifests[0]!;
  manifests.forEach((m, i) => {
    if (i === 0) return;
    const a = strip(first), b = strip(m);
    const differing = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canonical(a[k]) !== canonical(b[k]));
    if (differing.length) throw new MergeError(`shard ${shards[i]!.name}: manifest.json differs from shard ${shards[0]!.name}'s in ${differing.join(', ')}; every shard must run plan at the same commit on the same preregistration`);
  });
  const owner = new Map<string, string>();
  const rowsById = new Map<string, TrialRecord>();
  const infos: Record<string, ShardInfo> = {};
  const cellOwner = new Map<string, string>();
  for (const s of shards) {
    const rows = readFileSync(join(s.dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
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
      meta = JSON.parse(readFileSync(join(s.dir, 'shard.json'), 'utf8')) as typeof meta;
      if (meta.name !== undefined && meta.name !== s.name) throw new MergeError(`shard ${s.name}: its shard.json names itself ${JSON.stringify(meta.name)}`);
    }
    infos[s.name] = { name: s.name, machine: typeof meta.machine === 'string' ? meta.machine : null, commit: typeof meta.commit === 'string' ? meta.commit : null, images: meta.images ?? null, source: s.dir, trials: rows.length, cells: [...new Set(rows.map((t) => t.cell))].sort() };
  }
  const planned = new Set(first.trials.map((t) => t.id));
  const missing = first.trials.filter((t) => !owner.has(t.id)).map((t) => t.id);
  if (missing.length) throw new MergeError(`${missing.length} manifest trial(s) in no shard: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? `, and ${missing.length - 20} more` : ''}; an incomplete shard is finished with run --resume before the merge`);
  const stray = [...owner.keys()].filter((id) => !planned.has(id));
  if (stray.length) throw new MergeError(`${stray.length} trial(s) not in the manifest: ${stray.slice(0, 20).map((id) => `${id} (shard ${owner.get(id)})`).join(', ')}`);
  const cells: Record<string, string> = {};
  for (const t of first.trials) cells[t.cell] = owner.get(t.id)!;
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
  const rows = first.trials.map((t) => rowsById.get(t.id)!);
  return { manifest: first, rows, shardsFile: { cells, shards: infos }, copies };
}

export function mergeShards(out: string, shards: ShardInput[]): ShardsFile {
  const plan = planMerge(out, shards);
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
  return plan.shardsFile;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const out = argv[argv.indexOf('--out') + 1];
  const shards: ShardInput[] = [];
  argv.forEach((a, i) => { if (a === '--shard') { const v = argv[i + 1] ?? ''; const eq = v.indexOf('='); if (eq < 1) { console.error(`--shard takes <name>=<dir>, not ${JSON.stringify(v)}`); process.exit(2); } shards.push({ name: v.slice(0, eq), dir: v.slice(eq + 1) }); } });
  if (!argv.includes('--out') || !out || !shards.length) {
    console.error('usage: bun scripts/merge-shards.ts --out <results dir> --shard <name>=<shard results dir> [--shard <name>=<dir> ...]');
    process.exit(2);
  }
  try {
    const f = mergeShards(out, shards);
    const cellsOf = (name: string) => Object.entries(f.cells).filter(([, s]) => s === name).map(([c]) => c);
    console.log([`Merged ${shards.length} shard(s) into ${out}: ${Object.keys(f.cells).length} cells, ${Object.values(f.shards).reduce((s, i) => s + i.trials, 0)} trials.`, '', '| Shard | Machine | Commit | Trials | Cells |', '|---|---|---|---|---|',
      ...Object.values(f.shards).map((i) => `| ${i.name} | ${i.machine ?? 'unknown'} | ${i.commit ?? 'unknown'} | ${i.trials} | ${cellsOf(i.name).join(', ')} |`)].join('\n'));
  } catch (e) {
    if (e instanceof MergeError) { console.error(`merge-shards: ${e.message}`); process.exit(2); }
    throw e;
  }
}
