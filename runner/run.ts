/**
 * harness-evals runner: plan, dry-run and preflight for a preregistered run.
 *
 * A run is described by a preregistration JSON (docs/benchmarks/<run>/prereg.json)
 * naming its cells; `plan` expands it into a manifest with one preallocated trial
 * id per (cell, task, repetition), prices the cost ceiling from the pinned price
 * table, and writes results/<run-id>/manifest.json. `dry-run` prints the same
 * without writing. Neither spends. Trial dispatch (`run`) lands with the adapter
 * and world lanes; this file refuses it with HE-RUN-001 until then.
 *
 *   bun runner/run.ts plan    --prereg <file> [--out results/<run-id>]
 *   bun runner/run.ts dry-run --prereg <file>
 *   bun runner/run.ts preflight --manifest results/<run-id>/manifest.json
 *
 * Every error prints one line starting with its HE- code (docs/errors.md) and
 * exits non-zero. Exit 3 is reserved for a budget stop and is never used here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalLookup } from './pricing/model-pricing.ts';

export interface Cell {
  id: string;
  harness: string;
  /** provider:model, priced through runner/pricing. */
  model: string;
  slice: 'multiuser' | 'work' | 'continuity' | 'coding-calibration' | 'hello';
  split: 'dev' | 'heldout';
  /** Harness-specific configuration name (for example QM's inner harness). */
  config?: string;
  repetitions: number;
  /** Planning ceiling per trial, tokens in and out, used only to price the cap. */
  ceiling: { input_tokens: number; output_tokens: number };
}

export interface Prereg {
  schema_version: 1;
  run_id: string;
  question: string;
  tasks: Record<string, string[]>;
  cells: Cell[];
  wall_clock_s: Record<string, number>;
  spend_cap_usd: number;
  drop_order: string[];
  minimum_v01: string[];
}

export interface Trial { id: string; cell: string; task: string; repetition: number }

export interface Manifest {
  schema_version: 1;
  run_id: string;
  prereg_sha256: string;
  created_at: string;
  cells: Cell[];
  trials: Trial[];
  cost_ceiling_usd: number;
  per_cell_ceiling_usd: Record<string, number>;
  spend_cap_usd: number;
  trial_hours_at_cap: number;
}

export class RunnerError extends Error {
  constructor(readonly code: string, message: string, readonly exit = 2) { super(`${code} ${message}`); }
}

export function loadPrereg(path: string): { prereg: Prereg; sha256: string } {
  if (!existsSync(path)) throw new RunnerError('HE-PREREG-001', `preregistration not found: ${path}; fix: pass --prereg <docs/benchmarks/<run>/prereg.json>`);
  const raw = readFileSync(path, 'utf8');
  const prereg = JSON.parse(raw) as Prereg;
  if (prereg.schema_version !== 1) throw new RunnerError('HE-PREREG-002', `schema_version must be 1 (got ${String(prereg.schema_version)})`);
  if (!prereg.cells?.length) throw new RunnerError('HE-PREREG-003', 'no cells; fix: add at least one cell to the preregistration');
  for (const c of prereg.cells) {
    if (!prereg.tasks[c.slice]) throw new RunnerError('HE-PREREG-004', `cell ${c.id} names slice ${c.slice} but tasks.${c.slice} is missing`);
    if (!canonicalLookup(c.model)) throw new RunnerError('HE-PIN-002', `cell ${c.id}: model ${c.model} has no price in runner/pricing/model-pricing.ts; fix: register its list price before any cell runs`);
    if (!(c.repetitions >= 1)) throw new RunnerError('HE-PREREG-005', `cell ${c.id}: repetitions must be >= 1`);
  }
  if (!(prereg.spend_cap_usd > 0)) throw new RunnerError('HE-BUDGET-002', 'spend_cap_usd must be > 0; the cap is written into the preregistration, never passed ad hoc');
  return { prereg, sha256: createHash('sha256').update(raw).digest('hex') };
}

export function ceilingUsd(cell: Cell): number {
  const price = canonicalLookup(cell.model)!;
  return (cell.ceiling.input_tokens * price.input + cell.ceiling.output_tokens * price.output) / 1e6;
}

export function buildManifest(prereg: Prereg, sha256: string, now = new Date().toISOString()): Manifest {
  const trials: Trial[] = [];
  const perCell: Record<string, number> = {};
  let hours = 0;
  for (const cell of prereg.cells) {
    const tasks = prereg.tasks[cell.slice];
    const perTrial = ceilingUsd(cell);
    perCell[cell.id] = +(perTrial * tasks.length * cell.repetitions).toFixed(2);
    hours += (tasks.length * cell.repetitions * (prereg.wall_clock_s[cell.slice] ?? 0)) / 3600;
    for (const task of tasks) for (let r = 1; r <= cell.repetitions; r++) trials.push({ id: `${prereg.run_id}/${cell.id}/${task}/r${r}`, cell: cell.id, task, repetition: r });
  }
  const ceiling = +Object.values(perCell).reduce((a, b) => a + b, 0).toFixed(2);
  return { schema_version: 1, run_id: prereg.run_id, prereg_sha256: sha256, created_at: now, cells: prereg.cells, trials, cost_ceiling_usd: ceiling, per_cell_ceiling_usd: perCell, spend_cap_usd: prereg.spend_cap_usd, trial_hours_at_cap: +hours.toFixed(1) };
}

export function renderPlan(m: Manifest): string {
  const lines = [`RUN: ${m.run_id} trials=${m.trials.length} cells=${m.cells.length} ceiling_usd=${m.cost_ceiling_usd} cap_usd=${m.spend_cap_usd} trial_hours_at_cap=${m.trial_hours_at_cap}`];
  for (const c of m.cells) lines.push(`CELL: ${c.id} harness=${c.harness} model=${c.model} slice=${c.slice} split=${c.split} reps=${c.repetitions} trials=${m.trials.filter(t => t.cell === c.id).length} ceiling_usd=${m.per_cell_ceiling_usd[c.id]}`);
  if (m.cost_ceiling_usd > m.spend_cap_usd) lines.push(`WARN: HE-BUDGET-003 cost ceiling ${m.cost_ceiling_usd} exceeds the preregistered cap ${m.spend_cap_usd}; cells past the cap stop incomplete in drop order`);
  return lines.join('\n');
}

function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'plan' || cmd === 'dry-run') {
    const path = flag('--prereg');
    if (!path) throw new RunnerError('HE-RUN-002', 'missing --prereg <file>');
    const { prereg, sha256 } = loadPrereg(path);
    const manifest = buildManifest(prereg, sha256);
    console.log(renderPlan(manifest));
    if (cmd === 'plan') {
      const out = flag('--out') ?? join('results', prereg.run_id);
      mkdirSync(out, { recursive: true });
      const file = join(out, 'manifest.json');
      if (existsSync(file)) throw new RunnerError('HE-RUN-003', `${file} exists; a run id is used once. fix: choose a new run_id or remove the directory if nothing ran`);
      writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`MANIFEST: ${file}`);
    }
    return;
  }
  if (cmd === 'preflight') {
    const path = flag('--manifest');
    if (!path || !existsSync(path)) throw new RunnerError('HE-RUN-002', 'missing or absent --manifest <results/<run-id>/manifest.json>');
    const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    const missing = m.cells.filter(c => !existsSync(join('harnesses', c.harness, 'pin.json'))).map(c => c.harness);
    if (missing.length) throw new RunnerError('HE-PIN-001', `no harnesses/<name>/pin.json for: ${[...new Set(missing)].join(', ')}; fix: add the pin before any cell runs`);
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) if (!process.env[k]) console.log(`WARN: HE-PROXY-001 ${k} is not set in this shell; the metering proxy needs it, harness containers never do`);
    console.log(`PREFLIGHT: ok run=${m.run_id} trials=${m.trials.length}`);
    return;
  }
  if (cmd === 'run') throw new RunnerError('HE-RUN-001', 'trial dispatch is not implemented yet (M0 lanes B and C land the adapters and world); use plan or dry-run');
  throw new RunnerError('HE-RUN-002', 'usage: bun runner/run.ts plan|dry-run --prereg <file> | preflight --manifest <file>');
}

if (import.meta.main) {
  try { main(process.argv.slice(2)); }
  catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  }
}
