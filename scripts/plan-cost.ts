#!/usr/bin/env bun
// Price a plan from its pilot (docs/cost-projection.md).
//
//   bun scripts/plan-cost.ts <plan folder> --pilot <results dir> [--pilot <dir> ...] [--results <counted results dir> ...]
//     [--ledger <ledger.sqlite> ...] [--plan-file <prereg json> ...] [--map <pilot cell>=<counted cell> ...] [--stop <usd>]
//     [--own-usd <n>] [--json] [--out <receipt.json>]
//
// Reads the plan's counted units (prereg.json through runner/run.ts buildManifest, or frontier-harbor/1 plan files' cells),
// every pilot trial record, the counted records already finished, the shard VM receipts beside them and every ledger given,
// and prints a CELL line per cell, the spend so far, the total and the verdict against the plan's spend stop
// ("- Spend stop: $<n>" in PREREGISTRATION.md's "## Cost projection" section, or --stop for a plan that has none).
// Exit 0 under the stop, 3 over it (HE-BUDGET-005), 4 when a cell with units left has no pilot price (HE-BUDGET-006),
// 2 on bad input; 2 wins over 4, and 4 over 3. The receipt names inputs by repo-relative path or basename and sha256, never
// an absolute path, and carries no key.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { RunnerError } from '../runner/errors.ts';
import { costRecord, money, project, renderProjection, type CostRecord, type PlanCell, type PlanUnits, type Projection } from '../runner/cost/projection.ts';
import { dollars, fields, sections } from '../runner/prereg/practices.ts';
import { buildManifest, loadPrereg } from '../runner/run.ts';
import { settledSpend } from './ubicloud/wave2-admit.ts';

export interface PlanCostOptions {
  folder: string;
  pilot: string[];
  results: string[];
  ledgers: string[];
  planFiles: string[];
  map: Record<string, string>;
  stop: number | null;
  own: number | null;
}

export interface PlanCostResult {
  projection: Projection;
  plan: PlanUnits;
  stop_source: string;
  receipt: Record<string, unknown>;
  lines: string[];
  exit: 0 | 3 | 4;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const shown = (path: string) => { const r = relative(process.cwd(), path); return r.startsWith('..') || r.startsWith('/') ? basename(path) : r; };

interface HarborFile { schema: 'frontier-harbor/1'; run_id: string; concurrency?: number; cells: Array<{ id: string; model: string; attempts: number; tasks: { from?: number; to?: number; ids?: string[]; subset?: string; key?: string; sha256?: string } }>; shards?: Array<{ name: string; cells: string[] | string; lease_usd?: number }> }
const REPO = resolve(import.meta.dir, '..');

/** The task count of a { subset, key, sha256? } cell: subsets[key].tasks of the subset file, read the way frontier-harbor's subsetIds reads it. */
function subsetCount(t: { subset: string; key?: string; sha256?: string }, where: string): number {
  const bad = (m: string): never => { throw new RunnerError('HE-BUDGET-006', `${where}: ${m}`); };
  if (typeof t.key !== 'string' || !t.key) bad('a subset needs a key; fix: give tasks as { subset, key }');
  const path = resolve(REPO, t.subset);
  if (!existsSync(path)) bad(`subset file ${t.subset} not found; fix: name the subset file by its repo-relative path`);
  const raw = readFileSync(path);
  if (t.sha256 !== undefined && sha256(raw) !== t.sha256) bad(`subset file ${t.subset} does not have the preregistered sha256; fix: restore the file or the plan's sha256`);
  const tasks = (JSON.parse(raw.toString('utf8')) as { subsets?: Record<string, { tasks?: unknown }> }).subsets?.[t.key!]?.tasks;
  if (!Array.isArray(tasks) || !tasks.length || !tasks.every(x => typeof x === 'string') || new Set(tasks).size !== tasks.length) bad(`subsets.${t.key} in ${t.subset} is not a non-empty list of distinct task ids; fix: correct the subset file or the cell's key`);
  return (tasks as string[]).length;
}

const cellList = (cells: string[] | string) => (Array.isArray(cells) ? cells : cells.split(',')).map(c => c.trim()).filter(Boolean);

/** The counted units of the plan's preregistration files: every prereg*.json in the folder, or the --plan-file ones. */
export function readPlan(folder: string, planFiles: string[]): { plan: PlanUnits; files: string[] } {
  const files = planFiles.length ? planFiles : readdirSync(folder).filter(f => /^prereg.*\.json$/.test(f)).sort().map(f => join(folder, f));
  if (!files.length) throw new RunnerError('HE-BUDGET-006', `no prereg*.json in ${folder}; fix: pass the plan folder that holds the run's preregistration, or --plan-file <file>`);
  const parsed = files.map(file => {
    if (!existsSync(file)) throw new RunnerError('HE-BUDGET-006', `plan file ${file} does not exist`);
    const json = JSON.parse(readFileSync(file, 'utf8')) as { schema?: string; schema_version?: number; run_id?: string };
    if (json.schema === 'frontier-harbor/1') return { file, format: 'frontier-harbor' as const, run_id: json.run_id!, json: json as HarborFile };
    if (json.schema_version === 1 && Array.isArray((json as { cells?: unknown }).cells)) return { file, format: 'runner' as const, run_id: json.run_id!, json };
    throw new RunnerError('HE-BUDGET-006', `${file} is neither a runner prereg.json (schema_version 1) nor a frontier-harbor/1 plan; fix: name the plan files with --plan-file`);
  });
  const runIds = [...new Set(parsed.map(p => p.run_id))];
  if (runIds.length > 1) throw new RunnerError('HE-BUDGET-006', `${folder} holds plans for ${runIds.length} run ids (${runIds.join(', ')}); fix: pass --plan-file for the files that count against this stop`);
  const formats = new Set(parsed.map(p => p.format));
  if (formats.size > 1) throw new RunnerError('HE-BUDGET-006', `${folder} mixes runner and frontier-harbor plan files for ${runIds[0]}; fix: pass --plan-file`);
  const cells: PlanCell[] = [];
  const shards: PlanUnits['shards'] = [];
  let concurrency = Infinity;
  for (const p of parsed) {
    if (p.format === 'runner') {
      const { prereg, sha256: sha } = loadPrereg(p.file);
      const manifest = buildManifest(prereg, sha);
      for (const c of prereg.cells) {
        cells.push({ id: c.id, model: c.model, also: c.utility_models ?? [], units: manifest.trials.filter(t => t.cell === c.id).length, lease_usd: manifest.per_cell_ceiling_usd[c.id] ?? null, shard: null });
      }
      concurrency = Math.min(concurrency, 1);
      continue;
    }
    const h = p.json as HarborFile;
    concurrency = Math.min(concurrency, h.concurrency ?? 1);
    const shardOf = new Map<string, { name: string; cells: string[]; lease_usd: number | null }>();
    for (const s of h.shards ?? []) {
      const entry = { name: s.name, cells: cellList(s.cells), lease_usd: s.lease_usd ?? null };
      shards.push(entry);
      for (const c of entry.cells) shardOf.set(c, entry);
    }
    for (const c of h.cells) {
      if (cells.some(x => x.id === c.id)) throw new RunnerError('HE-BUDGET-006', `cell ${c.id} appears in more than one plan file of ${p.run_id}`);
      const shard = shardOf.get(c.id) ?? null;
      const t = c.tasks ?? {};
      const tasks = 'ids' in t ? (Array.isArray(t.ids) ? t.ids.length : NaN)
        : typeof t.subset === 'string' ? subsetCount({ ...t, subset: t.subset }, `cell ${c.id} in ${p.file}`)
        : Number.isInteger(t.from) && Number.isInteger(t.to) ? Math.max(0, t.to! - t.from!)
        : NaN;
      const units = tasks * c.attempts;
      if (!Number.isInteger(units)) throw new RunnerError('HE-BUDGET-006', `cell ${c.id} in ${p.file} has no countable tasks (${JSON.stringify(c.tasks)}) or attempts (${JSON.stringify(c.attempts)}); fix: give tasks as { from, to }, { ids } or { subset, key } and attempts as a whole number`);
      cells.push({ id: c.id, model: c.model, also: [], units, lease_usd: shard && shard.cells.length === 1 ? shard.lease_usd : null, shard: shard?.name ?? null });
    }
  }
  return { plan: { run_id: runIds[0]!, format: [...formats][0]!, concurrency: Number.isFinite(concurrency) ? concurrency : 1, cells, shards }, files };
}

/** The spend stop the plan states in "## Cost projection" ("- Spend stop: $<n>"), or null when it states none. */
export function planStop(folder: string): number | null {
  const md = join(folder, 'PREREGISTRATION.md');
  if (!existsSync(md)) return null;
  const s = sections(readFileSync(md, 'utf8')).get('cost projection');
  return s ? dollars(fields(s).get('spend stop')) : null;
}

function trialsFile(dir: string): string {
  for (const f of [join(dir, 'trials.jsonl'), join(dir, 'results', 'trials.jsonl')]) if (existsSync(f)) return f;
  throw new RunnerError('HE-BUDGET-006', `no trials.jsonl in ${dir} or ${join(dir, 'results')}; fix: pass a results directory`);
}

/** Cost records from one results directory, cell ids rewritten by --map; a directory whose cells all miss the plan is refused. */
export function readRecords(dir: string, plan: PlanUnits, map: Record<string, string>, what: string): { records: CostRecord[]; file: string; sha256: string } {
  const file = trialsFile(dir);
  const text = readFileSync(file, 'utf8');
  const ids = new Set(plan.cells.map(c => c.id));
  const records = text.split('\n').filter(l => l.trim()).map(l => costRecord(JSON.parse(l) as TrialRecord)).map(r => ({ ...r, cell: map[r.cell] ?? r.cell }));
  if (records.length && !records.some(r => ids.has(r.cell))) {
    const seen = [...new Set(records.map(r => r.cell))].slice(0, 5).join(', ');
    throw new RunnerError('HE-BUDGET-006', `${what} ${dir} holds no records for this plan's cells (it has ${seen}); fix: pass --map <its cell>=<plan cell>, or leave it out`);
  }
  return { records, file, sha256: sha256(text) };
}

/** VM list-price dollars from the shard-vm.json receipts beside a results directory (run-shard.sh's cost.list_price_usd). */
export function readVm(dirs: string[]): Array<{ name: string; usd: number }> {
  const found = new Map<string, number>();
  for (const dir of dirs) {
    const candidates = [join(dir, 'shard-vm.json'), join(dirname(dir), 'shard-vm.json'), ...(existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.shard-vm.json')).map(f => join(dir, f)) : [])];
    for (const c of candidates) {
      if (!existsSync(c)) continue;
      const real = realpathSync(c);
      if (found.has(real)) continue;
      const usd = (JSON.parse(readFileSync(c, 'utf8')) as { cost?: { list_price_usd?: number | null } }).cost?.list_price_usd;
      found.set(real, typeof usd === 'number' ? usd : 0);
    }
  }
  return [...found.entries()].map(([path, usd]) => ({ name: shown(path), usd }));
}

export function planCost(o: PlanCostOptions): PlanCostResult {
  const { plan, files } = readPlan(o.folder, o.planFiles);
  const fromPlan = planStop(o.folder);
  const stop = o.stop ?? fromPlan;
  if (stop === null) throw new RunnerError('HE-BUDGET-005', `${o.folder} states no spend stop; fix: add "- Spend stop: $<n>" under "## Cost projection" in PREREGISTRATION.md, or pass --stop <usd> for a frozen plan`);
  const stopSource = o.stop !== null ? (fromPlan !== null && fromPlan !== o.stop ? `stop from the command line; the plan says ${money(fromPlan)}` : 'stop from the command line') : 'stop from PREREGISTRATION.md';
  const pilot = o.pilot.map(d => ({ dir: d, ...readRecords(d, plan, o.map, 'pilot') }));
  const results = o.results.map(d => ({ dir: d, ...readRecords(d, plan, o.map, 'results') }));
  const spent = o.ledgers.length ? settledSpend(o.ledgers) : { total: 0, by_ledger: [] };
  const vm = readVm([...o.pilot, ...o.results]);
  const projection = project({
    plan, pilot: pilot.flatMap(p => p.records), results: results.flatMap(r => r.records),
    spent_usd: spent.total, vm_spent_usd: vm.reduce((a, v) => a + v.usd, 0), own_usd: o.own, stop_usd: stop,
  });
  const lines = renderProjection(projection, stopSource);
  if (!o.ledgers.length) lines.splice(lines.length - 2, 0, 'WARN: no --ledger given, so the spend so far counts no ledger; pass every pilot and counted ledger');
  let exit: 0 | 3 | 4 = 0;
  if (projection.unpriced.length) {
    exit = 4;
    lines.push(`VERDICT: UNPRICED HE-BUDGET-006 ${projection.unpriced.join(', ')} ${projection.unpriced.length === 1 ? 'has' : 'have'} fewer than 5 scored pilot units, so the total is only a lower bound`);
    lines.push(`NEXT: run a pilot of each unpriced cell under its pilot cap (the plan's "## Pilot" table) until it has at least 5 scored trials, then pass its results directory with --pilot`);
  } else if (projection.over_stop) {
    exit = 3;
    lines.push(`VERDICT: OVER HE-BUDGET-005 the projected total ${money(projection.total_usd)} passes the stop ${money(stop)} by ${money(projection.total_usd - stop)}`);
    lines.push('NEXT: shrink the plan, or raise the stop by a dated amendment with the owner\'s approval, then rerun; for one launch the coordinating agent can pass --override "<reason>" --override-by <thread code> to scripts/launch-preflight.ts');
  } else {
    lines.push(`VERDICT: UNDER the projected total ${money(projection.total_usd)} is ${money(stop - projection.total_usd)} under the stop ${money(stop)}`);
  }
  const receipt = {
    schema: 'plan-cost/1', generated_at: new Date().toISOString(), run_id: plan.run_id, verdict: exit === 0 ? 'under' : exit === 3 ? 'over' : 'unpriced',
    plan_files: files.map(f => ({ path: shown(f), sha256: sha256(readFileSync(f)) })),
    stop_usd: stop, stop_source: stopSource,
    inputs: {
      pilot: pilot.map(p => ({ name: basename(p.dir), trials_sha256: p.sha256, records: p.records.length })),
      results: results.map(r => ({ name: basename(r.dir), trials_sha256: r.sha256, records: r.records.length })),
      ledgers: spent.by_ledger.map(l => ({ name: basename(l.ledger), usd: l.usd })),
      vm, map: o.map,
    },
    projection,
  };
  return { projection, plan, stop_source: stopSource, receipt, lines, exit };
}

/** Repeated --flag values and the single ones, with the first bare argument as the plan folder. */
export function parseArgs(argv: string[], repeated: string[], single: string[], booleans: string[] = []): { positional: string[]; many: Record<string, string[]>; one: Record<string, string | undefined>; bool: Set<string> } {
  const many: Record<string, string[]> = Object.fromEntries(repeated.map(k => [k, []]));
  const one: Record<string, string | undefined> = {};
  const bool = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (booleans.includes(a)) { bool.add(a); continue; }
    if (repeated.includes(a) || single.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new RunnerError('HE-RUN-002', `${a} needs a value`);
      if (repeated.includes(a)) many[a]!.push(v); else one[a] = v;
      continue;
    }
    if (a.startsWith('--')) throw new RunnerError('HE-RUN-002', `unknown flag ${a}`);
    positional.push(a);
  }
  return { positional, many, one, bool };
}

export function positiveUsd(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(/^\$/, '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new RunnerError('HE-RUN-002', `${flag} must be a dollar amount (got ${JSON.stringify(raw)})`);
  return n;
}

export function parseMap(pairs: string[]): Record<string, string> {
  return Object.fromEntries(pairs.map(p => {
    const [a, b] = p.split('=');
    if (!a || !b) throw new RunnerError('HE-RUN-002', `--map takes <pilot cell>=<plan cell> (got ${JSON.stringify(p)})`);
    return [a, b];
  }));
}

export const PLAN_COST_USAGE = 'usage: bun scripts/plan-cost.ts <plan folder> --pilot <results dir> [--pilot <dir> ...] [--results <counted results dir> ...] [--ledger <ledger.sqlite> ...] [--plan-file <prereg json> ...] [--map <pilot cell>=<plan cell> ...] [--stop <usd>] [--own-usd <n>] [--json] [--out <receipt.json>]';

if (import.meta.main) {
  try {
    const a = parseArgs(process.argv.slice(2), ['--pilot', '--results', '--ledger', '--plan-file', '--map'], ['--stop', '--own-usd', '--out'], ['--json']);
    if (a.positional.length !== 1) throw new RunnerError('HE-RUN-002', PLAN_COST_USAGE);
    const r = planCost({ folder: a.positional[0]!, pilot: a.many['--pilot']!, results: a.many['--results']!, ledgers: a.many['--ledger']!, planFiles: a.many['--plan-file']!,
      map: parseMap(a.many['--map']!), stop: positiveUsd(a.one['--stop'], '--stop'), own: positiveUsd(a.one['--own-usd'], '--own-usd') });
    if (a.one['--out']) writeFileSync(a.one['--out'], JSON.stringify(r.receipt, null, 2) + '\n');
    console.log(a.bool.has('--json') ? JSON.stringify(r.receipt, null, 2) : r.lines.join('\n') + (a.one['--out'] ? `\nRECEIPT: ${a.one['--out']} sha256=${sha256(readFileSync(a.one['--out']))}` : ''));
    process.exit(r.exit);
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
