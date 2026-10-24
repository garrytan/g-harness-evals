/**
 * harness-evals runner: plan, dry-run, preflight and run for a preregistered run.
 *
 * A run is described by a preregistration JSON (docs/benchmarks/<run>/prereg.json)
 * naming its cells; `plan` expands it into a manifest with one preallocated trial
 * id per (cell, task, repetition), prices the cost ceiling from the pinned price
 * table, and writes results/<run-id>/manifest.json. `dry-run` prints the same
 * without writing. Neither spends. `run` dispatches the manifest's trials
 * (runner/trial/run.ts): one metering proxy per run, one world and one harness
 * per trial, and trials.jsonl as the evaluator-owned record.
 *
 *   bun runner/run.ts plan    --prereg <file> [--out results/<run-id>]
 *   bun runner/run.ts dry-run --prereg <file>
 *   bun runner/run.ts preflight --manifest results/<run-id>/manifest.json [--gbrain-image <tag>]
 *   bun runner/run.ts run --manifest results/<run-id>/manifest.json [--harness-mode docker|process|scripted]
 *       [--adapter <script>] [--image <tag>] [--gbrain-image <tag>] [--resume] [--stop-on-cap] [--cells a,b] [--ledger <file>]
 *       [--lease-usd <n>] [--new-lease] [--max-output-tokens <n>] [--preamble <file>] [--ready-timeout-s <n>]
 *       [--turn-grace-s <n>] [--harness-env K=V ...]
 *
 * Every error prints one line starting with its HE- code (docs/errors.md) and
 * exits non-zero. Exit 3 is the budget stop (HE-BUDGET-001).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { GbrainCellConfig, HarnessMode } from './contracts.ts';
import { RunnerError } from './errors.ts';
import { canonicalLookup } from './pricing/model-pricing.ts';
import { taskTurnCount } from './trial/task.ts';
import { DEFAULT_GBRAIN_IMAGE } from './trial/gbrain.ts';

export { RunnerError };

export interface Cell {
  id: string;
  /** harnesses/<name>; "scripted" for an oracle or mutation cell. */
  harness: string;
  /** provider:model, priced through runner/pricing; "none" for a scripted cell. */
  model: string;
  slice: 'multiuser' | 'work' | 'continuity' | 'coding-calibration' | 'hello' | 'smoke';
  split: 'dev' | 'heldout';
  /** Harness-specific configuration name (for example QM's inner harness). */
  config?: string;
  repetitions: number;
  /** Planning ceiling, tokens in and out, used only to price the cap: per trial for single-shot slices,
   *  per turn for multiuser (a trial is priced as turns x ceiling). */
  ceiling: { input_tokens: number; output_tokens: number };
  /** Explicit task ids; default tasks.<slice> from the preregistration, else every task under tasks/multiuser/<split>/. */
  tasks?: string[];
  /** How the harness runs; default docker. */
  harness_mode?: HarnessMode;
  /** Scripted cells: play every task's oracle.json, or every mutations/<predicate>.json. */
  script?: 'oracle' | 'mutations';
  /** Process mode: the adapter script. */
  adapter?: string;
  /** gbrain arm: a gbrain sidecar per trial, registered with the harness as a second MCP server (docs/gbrain-arm.md). */
  gbrain?: GbrainCellConfig;
  /** Alternative preamble for this cell, a path relative to the repository root; default tasks/multiuser/_shared/preamble.md (or --preamble). */
  preamble?: string;
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

export interface Trial {
  id: string;
  cell: string;
  task: string;
  repetition: number;
  /** Multi-user: the task directory and its turn count, as priced. */
  task_dir?: string;
  turns?: number;
  /** Scripted: the Script played for this trial. */
  script?: string;
}

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

export function loadPrereg(path: string): { prereg: Prereg; sha256: string } {
  if (!existsSync(path)) throw new RunnerError('HE-PREREG-001', `preregistration not found: ${path}; fix: pass --prereg <docs/benchmarks/<run>/prereg.json>`);
  const raw = readFileSync(path, 'utf8');
  const prereg = JSON.parse(raw) as Prereg;
  if (prereg.schema_version !== 1) throw new RunnerError('HE-PREREG-002', `schema_version must be 1 (got ${String(prereg.schema_version)})`);
  if (!prereg.cells?.length) throw new RunnerError('HE-PREREG-003', 'no cells; fix: add at least one cell to the preregistration');
  prereg.tasks ??= {};
  for (const c of prereg.cells) {
    if (!prereg.tasks[c.slice] && !c.tasks && c.slice !== 'multiuser') throw new RunnerError('HE-PREREG-004', `cell ${c.id} names slice ${c.slice} but tasks.${c.slice} is missing`);
    const scripted = c.harness_mode === 'scripted';
    if (scripted && (c.harness !== 'scripted' || !['oracle', 'mutations'].includes(c.script ?? '')))
      throw new RunnerError('HE-PREREG-006', `cell ${c.id}: a scripted cell needs harness "scripted" and script "oracle" or "mutations"`);
    if (!scripted && c.model === 'none') throw new RunnerError('HE-PIN-002', `cell ${c.id}: model "none" is only valid for a scripted cell`);
    if (!scripted && !canonicalLookup(c.model)) throw new RunnerError('HE-PIN-002', `cell ${c.id}: model ${c.model} has no price in runner/pricing/model-pricing.ts; fix: register its list price before any cell runs`);
    if (!(c.repetitions >= 1)) throw new RunnerError('HE-PREREG-005', `cell ${c.id}: repetitions must be >= 1`);
    if (c.preamble !== undefined && (typeof c.preamble !== 'string' || !existsSync(c.preamble))) throw new RunnerError('HE-TASK-002', `cell ${c.id}: preamble not found at ${String(c.preamble)}; fix: name a committed file such as tasks/multiuser/_shared/preamble.md`);
    if (c.gbrain !== undefined) {
      if (c.gbrain?.surface !== 'starter') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.surface must be "starter" (the pinned surface, gbrain/pin.json); got ${JSON.stringify(c.gbrain)}`);
      if (scripted) throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: a scripted cell cannot carry gbrain; a script plays the bot over world-MCP and has no harness to call the brain`);
    }
  }
  if (!(prereg.spend_cap_usd > 0)) throw new RunnerError('HE-BUDGET-002', 'spend_cap_usd must be > 0; the cap is written into the preregistration, never passed ad hoc');
  return { prereg, sha256: createHash('sha256').update(raw).digest('hex') };
}

/** Price of one unit of the cell's ceiling: a trial for single-shot slices, a turn for multiuser. Scripted cells cost nothing. */
export function ceilingUsd(cell: Cell): number {
  if (cell.harness_mode === 'scripted') return 0;
  const price = canonicalLookup(cell.model)!;
  return (cell.ceiling.input_tokens * price.input + cell.ceiling.output_tokens * price.output) / 1e6;
}

export interface ManifestOptions {
  /** Where tasks/ lives; the default is the repository's tasks directory. Tests point it at fixtures. */
  tasksRoot?: string;
}

export function cellTasks(prereg: Prereg, cell: Cell, tasksRoot = 'tasks'): string[] {
  if (cell.tasks?.length) return cell.tasks;
  if (prereg.tasks[cell.slice]?.length) return prereg.tasks[cell.slice]!;
  const dir = join(tasksRoot, 'multiuser', cell.split);
  const found = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'task.toml'))).map((d) => d.name).sort() : [];
  if (!found.length) throw new RunnerError('HE-PREREG-004', `cell ${cell.id}: no tasks in tasks.multiuser, cell.tasks or ${dir}; fix: add the task list or the task directories`);
  return found;
}

export function buildManifest(prereg: Prereg, sha256: string, now = new Date().toISOString(), opts: ManifestOptions = {}): Manifest {
  const tasksRoot = opts.tasksRoot ?? 'tasks';
  const trials: Trial[] = [];
  const perCell: Record<string, number> = {};
  let hours = 0;
  for (const cell of prereg.cells) {
    const tasks = cellTasks(prereg, cell, tasksRoot);
    const unit = ceilingUsd(cell);
    let cellUsd = 0;
    for (const task of tasks) {
      if (cell.slice !== 'multiuser') {
        cellUsd += unit * cell.repetitions;
        for (let r = 1; r <= cell.repetitions; r++) trials.push({ id: `${prereg.run_id}/${cell.id}/${task}/r${r}`, cell: cell.id, task, repetition: r });
        continue;
      }
      const dir = join(tasksRoot, 'multiuser', cell.split, task);
      const turns = taskTurnCount(dir);
      if (!turns) throw new RunnerError('HE-TASK-001', `cell ${cell.id}: ${dir}/task.toml is missing or has no turns; fix: add the task (docs/tasks.md) or drop it from the cell`);
      const scripts: Array<{ name: string; path: string } | null> = cell.script === 'oracle' ? [{ name: 'oracle', path: join(dir, 'oracle.json') }]
        : cell.script === 'mutations' ? listMutations(dir, cell.id)
        : [null];
      for (const s of scripts) {
        cellUsd += turns * unit * cell.repetitions;
        for (let r = 1; r <= cell.repetitions; r++) {
          const id = s ? `${prereg.run_id}/${cell.id}/${task}/${s.name}/r${r}` : `${prereg.run_id}/${cell.id}/${task}/r${r}`;
          trials.push({ id, cell: cell.id, task, repetition: r, task_dir: dir, turns, ...(s ? { script: s.path } : {}) });
        }
      }
    }
    perCell[cell.id] = +cellUsd.toFixed(2);
    hours += (trials.filter((t) => t.cell === cell.id).length * (prereg.wall_clock_s[cell.slice] ?? 0)) / 3600;
  }
  const ceiling = +Object.values(perCell).reduce((a, b) => a + b, 0).toFixed(2);
  return { schema_version: 1, run_id: prereg.run_id, prereg_sha256: sha256, created_at: now, cells: prereg.cells, trials, cost_ceiling_usd: ceiling, per_cell_ceiling_usd: perCell, spend_cap_usd: prereg.spend_cap_usd, trial_hours_at_cap: +hours.toFixed(1) };
}

function listMutations(taskDir: string, cellId: string): Array<{ name: string; path: string }> {
  const dir = join(taskDir, 'mutations');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) throw new RunnerError('HE-SCRIPT-001', `cell ${cellId}: ${dir} has no mutation scripts; fix: one mutations/<predicate-id>.json per predicate (docs/tasks.md)`);
  return files.map((f) => ({ name: `mut-${basename(f, '.json')}`, path: join(dir, f) }));
}

export function renderPlan(m: Manifest): string {
  const lines = [`RUN: ${m.run_id} trials=${m.trials.length} cells=${m.cells.length} ceiling_usd=${m.cost_ceiling_usd} cap_usd=${m.spend_cap_usd} trial_hours_at_cap=${m.trial_hours_at_cap}`];
  for (const c of m.cells) {
    const mine = m.trials.filter((t) => t.cell === c.id);
    const turns = mine.reduce((a, t) => a + (t.turns ?? 0), 0);
    lines.push(`CELL: ${c.id} harness=${c.harness} mode=${c.harness_mode ?? 'docker'}${c.script ? ` script=${c.script}` : ''} model=${c.model} slice=${c.slice} split=${c.split} reps=${c.repetitions} trials=${mine.length}${turns ? ` turns=${turns}` : ''} ceiling_usd=${m.per_cell_ceiling_usd[c.id]}${c.gbrain ? ` gbrain=${c.gbrain.surface}` : ''}${c.preamble ? ` preamble=${c.preamble}` : ''}`);
  }
  if (m.cells.some((c) => c.gbrain)) lines.push(`GBRAIN: cells ${m.cells.filter((c) => c.gbrain).map((c) => c.id).join(', ')} run with a gbrain sidecar per trial (image ${DEFAULT_GBRAIN_IMAGE} unless --gbrain-image; keyless, starter surface; docs/gbrain-arm.md)`);
  if (m.cost_ceiling_usd > m.spend_cap_usd) lines.push(`WARN: HE-BUDGET-003 cost ceiling ${m.cost_ceiling_usd} exceeds the preregistered cap ${m.spend_cap_usd}; cells past the cap stop incomplete in drop order`);
  return lines.join('\n');
}

export function loadManifest(path: string | undefined): { manifest: Manifest; path: string } {
  if (!path || !existsSync(path)) throw new RunnerError('HE-RUN-002', 'missing or absent --manifest <results/<run-id>/manifest.json>');
  return { manifest: JSON.parse(readFileSync(path, 'utf8')) as Manifest, path };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const has = (name: string) => rest.includes(name);
  const all = (name: string) => rest.map((a, i) => (a === name ? rest[i + 1] : undefined)).filter((v): v is string => v !== undefined);
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
    return 0;
  }
  if (cmd === 'preflight') {
    const { manifest: m } = loadManifest(flag('--manifest'));
    const missing = m.cells.filter(c => c.harness !== 'scripted' && !existsSync(join('harnesses', c.harness, 'pin.json'))).map(c => c.harness);
    if (missing.length) throw new RunnerError('HE-PIN-001', `no harnesses/<name>/pin.json for: ${[...new Set(missing)].join(', ')}; fix: add the pin before any cell runs`);
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) if (!process.env[k]) console.log(`WARN: HE-PROXY-001 ${k} is not set in this shell; the metering proxy needs it, harness containers never do`);
    const gbrainCells = m.cells.filter((c) => c.gbrain);
    if (gbrainCells.length) {
      const image = flag('--gbrain-image') ?? DEFAULT_GBRAIN_IMAGE;
      const { gbrainImagePresent, probeGbrainImage } = await import('./trial/gbrain.ts');
      if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present for cells ${gbrainCells.map((c) => c.id).join(', ')}; fix: docker build -f gbrain/Dockerfile -t ${image} .`);
      const probe = await probeGbrainImage(image, join(dirname(flag('--manifest')!), 'preflight-gbrain'));
      console.log(`GBRAIN: image ${image} serves /health (gbrain ${probe.version ?? 'unknown'}, ready in ${probe.ready_ms} ms) for cells ${gbrainCells.map((c) => `${c.id} (surface ${c.gbrain!.surface})`).join(', ')}`);
    }
    console.log(`PREFLIGHT: ok run=${m.run_id} trials=${m.trials.length}`);
    return 0;
  }
  if (cmd === 'run') {
    const { manifest, path } = loadManifest(flag('--manifest'));
    const mode = flag('--harness-mode') ?? 'docker';
    if (!['docker', 'process', 'scripted'].includes(mode)) throw new RunnerError('HE-RUN-005', `--harness-mode must be docker, process or scripted (got ${mode})`);
    const harnessEnv: Record<string, string> = {};
    for (const kv of all('--harness-env')) { const eq = kv.indexOf('='); if (eq <= 0) throw new RunnerError('HE-RUN-002', `--harness-env wants K=V (got ${kv})`); harnessEnv[kv.slice(0, eq)] = kv.slice(eq + 1); }
    const { executeRun } = await import('./trial/run.ts');
    const result = await executeRun(manifest, path, {
      harnessMode: mode as HarnessMode, adapter: flag('--adapter'), image: flag('--image'), gbrainImage: flag('--gbrain-image'), resume: has('--resume'), stopOnCap: has('--stop-on-cap'),
      cells: flag('--cells')?.split(',').map((s) => s.trim()).filter(Boolean), ledgerPath: flag('--ledger'), leaseUsd: flag('--lease-usd') ? Number(flag('--lease-usd')) : undefined,
      newLease: has('--new-lease'), maxOutputTokens: flag('--max-output-tokens') ? Number(flag('--max-output-tokens')) : undefined, preamblePath: flag('--preamble'),
      readyTimeoutS: flag('--ready-timeout-s') ? Number(flag('--ready-timeout-s')) : undefined, turnGraceS: flag('--turn-grace-s') ? Number(flag('--turn-grace-s')) : undefined,
      harnessEnv, log: (line) => console.log(line),
    });
    return result.exit;
  }
  throw new RunnerError('HE-RUN-002', 'usage: bun runner/run.ts plan|dry-run --prereg <file> | preflight --manifest <file> | run --manifest <file> [options]');
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  });
}
