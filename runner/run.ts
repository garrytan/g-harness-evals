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
 *   bun runner/run.ts preflight --manifest results/<run-id>/manifest.json [--gbrain-image <tag>] [--image <tag>] [--ledger <file>] [--cells a,b]
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
import { lookupEmbeddingPrice } from './pricing/embedding-pricing.ts';
import { taskTurnCount } from './trial/task.ts';
import { DEFAULT_GBRAIN_IMAGE, SOURCE_PROBE_QUERIES } from './trial/gbrain.ts';

export { RunnerError };

// internal-task (the install ladder): the gbrain cell fields, their allowed values and defaults (runner/contracts.ts GbrainCellConfig).
export const GBRAIN_SURFACES = ['starter', 'verbs'] as const;
export const GBRAIN_INSTALLS = ['mcp', 'gbrain-docs', 'gbrain-installer'] as const;
export const GBRAIN_EMBEDDINGS = ['off', 'openai:text-embedding-3-small'] as const;
/** Harnesses the install bundle has a view for (gbrain/pin.json "install"), docs and installer alike; gbrain documents no install
 *  for the others. */
export const GBRAIN_DOCS_HARNESSES = ['openclaw', 'hermes', '_fake'] as const;
/** The planning allowance for a cell with embeddings on: query embeddings per trial and tokens per query, priced from
 *  runner/pricing/embedding-pricing.ts (a search's query is a sentence; gbrain caches the embedding per distinct query). */
export const EMBEDDING_ALLOWANCE = { calls_per_trial: 50, tokens_per_call: 100 } as const;

export interface ResolvedGbrain {
  surface: (typeof GBRAIN_SURFACES)[number];
  install: (typeof GBRAIN_INSTALLS)[number];
  embeddings: (typeof GBRAIN_EMBEDDINGS)[number];
  brain: 'bot-visible' | 'company';
  scope: 'none' | 'member' | 'sources';
}

/** The cell's gbrain configuration with every default filled in; the cell itself is not changed. */
export function resolveGbrain(c: GbrainCellConfig): ResolvedGbrain {
  return { surface: c.surface, install: c.install ?? 'mcp', embeddings: c.embeddings ?? 'off', brain: c.brain ?? 'bot-visible', scope: c.scope ?? 'none' };
}

/** What plan prints for a gbrain cell: <surface>/<install>/<embeddings>. */
export function gbrainLabel(c: GbrainCellConfig): string {
  const r = resolveGbrain(c);
  return `${r.surface}/${r.install}/${r.embeddings}`;
}

/** The per-trial planning allowance for the sidecar's query embeddings, in USD; 0 with embeddings off. */
export function embeddingAllowanceUsd(c: GbrainCellConfig | undefined): number {
  const model = c?.embeddings ?? 'off';
  if (model === 'off') return 0;
  const price = lookupEmbeddingPrice(model);
  if (price.kind !== 'known') throw new RunnerError('HE-PIN-002', `embedding model ${model} has no price in runner/pricing/embedding-pricing.ts`);
  return (EMBEDDING_ALLOWANCE.calls_per_trial * EMBEDDING_ALLOWANCE.tokens_per_call * price.pricePerMTok) / 1e6;
}

export interface Cell {
  id: string;
  /** harnesses/<name>; "scripted" for an oracle or mutation cell. */
  harness: string;
  /** provider:model, priced through runner/pricing; "none" for a scripted cell. */
  model: string;
  slice: 'multiuser' | 'work' | 'continuity' | 'coding-calibration' | 'hello' | 'smoke';
  split: 'dev' | 'heldout';
  /** Harness-specific configuration name, handed to the adapter as HE_HARNESS_CONFIG (internal-task). QM accepts pi (the
   *  default), claude, pi-probe, claude-probe, pi-strict and pi-command-deny (harnesses/qm/pin.json configs); other
   *  harnesses ignore it. */
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
  /** Multi-user task set: "v0.1" (the default, tasks/multiuser/<split>/) or the name of a tree under tasks/multiuser/, such as "v0.2" (tasks/multiuser/v0.2/<split>/). */
  task_set?: string;
  /** How the adapter keys the harness session: "conversation" (the default, one session per DM or channel) or "turn" (a fresh session per turn, the memoryless contrast; HE_SESSION_SCOPE in the adapter). */
  session_scope?: 'conversation' | 'turn';
  /** Models the harness is documented to call beside the cell's model for its own housekeeping (QM's and OpenClaw's one
   *  claude-haiku-5-5 request per turn, harnesses/qm/README.md), as provider:model. They are forwarded when the run's
   *  allowlist admits them, priced into the trial and shown in usage.by_model, and HE-MODEL-001 does not count them as
   *  foreign (docs/errors.md). Preregistered per cell; a cell without the field treats every other model as foreign. */
  utility_models?: string[];
}

const CELL_KEYS = new Set(['id', 'harness', 'model', 'slice', 'split', 'config', 'repetitions', 'ceiling', 'tasks', 'harness_mode', 'script', 'adapter', 'gbrain', 'preamble', 'task_set', 'session_scope', 'utility_models']);
export const DEFAULT_TASK_SET = 'v0.1';

/** The name printed for a cell's task set. */
export function taskSetName(cell: Pick<Cell, 'task_set'>): string {
  return cell.task_set ?? DEFAULT_TASK_SET;
}

/** The directory a cell's multi-user tasks live under: tasks/multiuser/<split>/ for v0.1, tasks/multiuser/<task_set>/<split>/ otherwise. */
export function taskSetDir(cell: Pick<Cell, 'task_set' | 'split'>, tasksRoot = 'tasks'): string {
  const set = taskSetName(cell);
  return set === DEFAULT_TASK_SET ? join(tasksRoot, 'multiuser', cell.split) : join(tasksRoot, 'multiuser', set, cell.split);
}

/** The directory of one task of a cell. Every reader of a task directory (manifest, trial, report scripts) goes through here. */
export function taskDirFor(cell: Pick<Cell, 'task_set' | 'split'>, task: string, tasksRoot = 'tasks'): string {
  return join(taskSetDir(cell, tasksRoot), task);
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
    const unknown = Object.keys(c).filter((k) => !CELL_KEYS.has(k));
    if (unknown.length) throw new RunnerError('HE-PREREG-007', `cell ${String(c.id)}: unknown key(s) ${unknown.join(', ')}; allowed: ${[...CELL_KEYS].join(', ')}`);
    if (c.task_set !== undefined && (typeof c.task_set !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(c.task_set))) throw new RunnerError('HE-PREREG-007', `cell ${c.id}: task_set must be a name such as "v0.1" or "v0.2" (got ${JSON.stringify(c.task_set)})`);
    if (c.session_scope !== undefined && !['conversation', 'turn'].includes(c.session_scope)) throw new RunnerError('HE-PREREG-007', `cell ${c.id}: session_scope must be "conversation" or "turn" (got ${JSON.stringify(c.session_scope)})`);
    if (c.utility_models !== undefined && (!Array.isArray(c.utility_models) || !c.utility_models.length || c.utility_models.some((m) => typeof m !== 'string' || !/^[a-z]+:[A-Za-z0-9._-]+$/.test(m)))) throw new RunnerError('HE-PREREG-007', `cell ${c.id}: utility_models must be a non-empty list of provider:model ids (got ${JSON.stringify(c.utility_models)})`);
    if (!prereg.tasks[c.slice] && !c.tasks && c.slice !== 'multiuser') throw new RunnerError('HE-PREREG-004', `cell ${c.id} names slice ${c.slice} but tasks.${c.slice} is missing`);
    const scripted = c.harness_mode === 'scripted';
    if (scripted && (c.harness !== 'scripted' || !['oracle', 'mutations'].includes(c.script ?? '')))
      throw new RunnerError('HE-PREREG-006', `cell ${c.id}: a scripted cell needs harness "scripted" and script "oracle" or "mutations"`);
    if (!scripted && c.model === 'none') throw new RunnerError('HE-PIN-002', `cell ${c.id}: model "none" is only valid for a scripted cell`);
    if (!scripted && !canonicalLookup(c.model)) throw new RunnerError('HE-PIN-002', `cell ${c.id}: model ${c.model} has no price in runner/pricing/model-pricing.ts; fix: register its list price before any cell runs`);
    if (!(c.repetitions >= 1)) throw new RunnerError('HE-PREREG-005', `cell ${c.id}: repetitions must be >= 1`);
    if (c.preamble !== undefined && (typeof c.preamble !== 'string' || !existsSync(c.preamble))) throw new RunnerError('HE-TASK-002', `cell ${c.id}: preamble not found at ${String(c.preamble)}; fix: name a committed file such as tasks/multiuser/_shared/preamble.md`);
    if (c.gbrain !== undefined) {
      // internal-task: surface, install and embeddings are the ladder's orthogonal fields; HE-GBRAIN-001 names the field, the value and the allowed set.
      const bad = (field: string, value: unknown, allowed: readonly string[]) => new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.${field} must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')} (gbrain/pin.json); got ${JSON.stringify(value)}`);
      if (!c.gbrain || typeof c.gbrain !== 'object') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain must be an object such as {"surface": "starter"}; got ${JSON.stringify(c.gbrain)}`);
      if (!(GBRAIN_SURFACES as readonly string[]).includes(c.gbrain.surface as string)) throw bad('surface', c.gbrain.surface, GBRAIN_SURFACES);
      if (c.gbrain.install !== undefined && !(GBRAIN_INSTALLS as readonly string[]).includes(c.gbrain.install)) throw bad('install', c.gbrain.install, GBRAIN_INSTALLS);
      if (c.gbrain.embeddings !== undefined && !(GBRAIN_EMBEDDINGS as readonly string[]).includes(c.gbrain.embeddings)) throw bad('embeddings', c.gbrain.embeddings, GBRAIN_EMBEDDINGS);
      if (c.gbrain.install !== undefined && c.gbrain.install !== 'mcp' && !(GBRAIN_DOCS_HARNESSES as readonly string[]).includes(c.harness)) throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.install "${c.gbrain.install}" is defined for harnesses ${GBRAIN_DOCS_HARNESSES.filter((h) => !h.startsWith('_')).join(', ')} (gbrain documents no install for ${c.harness}; gbrain/pin.json "install")`);
      if (c.gbrain.embeddings !== undefined && c.gbrain.embeddings !== 'off' && c.gbrain.brain === 'company') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.embeddings ${c.gbrain.embeddings} needs the bot-visible brain; only the bot-visible brains are built with embeddings`);
      if (scripted) throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: a scripted cell cannot carry gbrain; a script plays the bot over world-MCP and has no harness to call the brain`);
      // internal-task (company brain): brain and scope are additive; a cell without them is the gbrain arm's cell.
      if (c.gbrain.brain !== undefined && c.gbrain.brain !== 'bot-visible' && c.gbrain.brain !== 'company') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.brain must be "bot-visible" or "company"; got ${JSON.stringify(c.gbrain.brain)}`);
      if (c.gbrain.scope !== undefined && c.gbrain.scope !== 'member' && c.gbrain.scope !== 'sources') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.scope must be "member", "sources" or absent; got ${JSON.stringify(c.gbrain.scope)}`);
      if (c.gbrain.scope !== undefined && c.gbrain.brain !== 'company') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.scope "${c.gbrain.scope}" needs gbrain.brain "company"; only the company brain carries member tokens and per-member source grants`);
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
  const explicit = cell.tasks?.length ? { list: cell.tasks, from: 'cell.tasks' } : prereg.tasks[cell.slice]?.length ? { list: prereg.tasks[cell.slice]!, from: `prereg.tasks.${cell.slice}` } : null;
  if (cell.slice !== 'multiuser') {
    if (explicit) return explicit.list;
    throw new RunnerError('HE-PREREG-004', `cell ${cell.id}: no tasks in tasks.${cell.slice} or cell.tasks; fix: add the task list`);
  }
  const dir = taskSetDir(cell, tasksRoot);
  if (taskSetName(cell) !== DEFAULT_TASK_SET && !existsSync(join(tasksRoot, 'multiuser', taskSetName(cell)))) throw new RunnerError('HE-PREREG-004', `cell ${cell.id}: task_set "${cell.task_set}" has no directory ${join(tasksRoot, 'multiuser', taskSetName(cell))}/; fix: name an existing set (v0.1 is tasks/multiuser/<split>/) or add the tree (docs/tasks.md)`);
  if (explicit) {
    const missing = explicit.list.filter((t) => !existsSync(join(dir, t, 'task.toml')));
    if (missing.length) throw new RunnerError('HE-PREREG-004', `cell ${cell.id}: ${explicit.from} names ${missing.join(', ')} but task set ${taskSetName(cell)} has no such task under ${dir}/; fix: list tasks of that set, or set task_set to the set the list belongs to`);
    return explicit.list;
  }
  const found = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'task.toml'))).map((d) => d.name).sort() : [];
  if (!found.length) throw new RunnerError('HE-PREREG-004', `cell ${cell.id}: no tasks in tasks.multiuser, cell.tasks or ${dir} (task set ${taskSetName(cell)}); fix: add the task list or the task directories`);
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
      const dir = taskDirFor(cell, task, tasksRoot);
      const turns = taskTurnCount(dir);
      if (!turns) throw new RunnerError('HE-TASK-001', `cell ${cell.id}: ${dir}/task.toml is missing or has no turns; fix: add the task (docs/tasks.md) or drop it from the cell`);
      const scripts: Array<{ name: string; path: string } | null> = cell.script === 'oracle' ? [{ name: 'oracle', path: join(dir, 'oracle.json') }]
        : cell.script === 'mutations' ? listMutations(dir, cell.id)
        : [null];
      for (const s of scripts) {
        cellUsd += (turns * unit + embeddingAllowanceUsd(cell.gbrain)) * cell.repetitions;
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
    lines.push(`CELL: ${c.id} harness=${c.harness} mode=${c.harness_mode ?? 'docker'}${c.script ? ` script=${c.script}` : ''} model=${c.model} slice=${c.slice} split=${c.split}${c.slice === 'multiuser' ? ` task_set=${taskSetName(c)}` : ''}${c.session_scope ? ` session_scope=${c.session_scope}` : ''}${c.utility_models ? ` utility_models=${c.utility_models.join(',')}` : ''}${c.config ? ` config=${c.config}` : ''} reps=${c.repetitions} trials=${mine.length}${turns ? ` turns=${turns}` : ''} ceiling_usd=${m.per_cell_ceiling_usd[c.id]}${c.gbrain ? ` gbrain=${gbrainLabel(c.gbrain)}${c.gbrain.brain ? ` brain=${c.gbrain.brain}` : ''}${c.gbrain.scope ? ` scope=${c.gbrain.scope}` : ''}` : ''}${c.preamble ? ` preamble=${c.preamble}` : ''}`);
  }
  for (const c of m.cells) {
    if (c.gbrain?.brain === 'company' && c.preamble !== 'tasks/multiuser/_shared/preamble.gbrain-company.md') lines.push(`WARN: cell ${c.id} serves the company brain with preamble ${c.preamble ?? 'tasks/multiuser/_shared/preamble.md'}, not the company one (tasks/multiuser/_shared/preamble.gbrain-company.md); intended only for a none-style arm on the company brain`);
  }
  // internal-task: one GBRAIN line per distinct configuration (surface/install/embeddings), naming what each means.
  const configs = new Map<string, Cell[]>();
  for (const c of m.cells) if (c.gbrain) configs.set(gbrainLabel(c.gbrain), [...(configs.get(gbrainLabel(c.gbrain)) ?? []), c]);
  for (const [label, cs] of configs) {
    const g = resolveGbrain(cs[0]!.gbrain!);
    const words = [
      g.surface === 'verbs' ? 'the 7 memory verbs (page search is recall)' : 'the 33-tool starter surface',
      g.install === 'gbrain-docs' ? "gbrain's documented install applied in the harness container from the image's bundle" : g.install === 'gbrain-installer' ? "gbrain's own installer (gbrain setup <harness> --instructions-only) applied in the harness container from the image's bundle" : 'MCP registration only',
      g.embeddings === 'off' ? 'keyword-only, no model call' : `query embeddings ${g.embeddings} through the metering proxy, metered per trial (allowance ${embeddingAllowanceUsd(cs[0]!.gbrain).toFixed(4)} per trial in the ceiling)`,
    ];
    lines.push(`GBRAIN: cells ${cs.map((c) => c.id).join(', ')} run with a gbrain sidecar per trial (image ${DEFAULT_GBRAIN_IMAGE} unless --gbrain-image; ${label}: ${words.join('; ')}; docs/gbrain-arm.md)`);
  }
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
    const { manifest: loaded } = loadManifest(flag('--manifest'));
    const runDir = dirname(flag('--manifest')!);
    // internal-task: --cells scopes the checks to one shard's cells (its harness images, its gbrain configurations); the ladder's shards
    // each built only their own images and failed the whole-manifest preflight on the other harness's image (HE-ADAPTER-005).
    const scope = flag('--cells')?.split(',').map((s) => s.trim()).filter(Boolean);
    if (scope) {
      const known = new Set(loaded.cells.map((c) => c.id));
      const unknown = scope.filter((id) => !known.has(id));
      if (unknown.length) throw new RunnerError('HE-RUN-002', `--cells names ${unknown.join(', ')}, not in the manifest; the cells are ${[...known].join(', ')}`);
    }
    const m = scope ? { ...loaded, cells: loaded.cells.filter((c) => scope.includes(c.id)), trials: loaded.trials.filter((t) => scope.includes(t.cell)) } : loaded;
    if (scope) console.log(`PREFLIGHT: scope --cells ${scope.join(',')} (${m.trials.length} of ${loaded.trials.length} trials)`);
    const missing = m.cells.filter(c => c.harness !== 'scripted' && !existsSync(join('harnesses', c.harness, 'pin.json'))).map(c => c.harness);
    if (missing.length) throw new RunnerError('HE-PIN-001', `no harnesses/<name>/pin.json for: ${[...new Set(missing)].join(', ')}; fix: add the pin before any cell runs`);
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) if (!process.env[k]) console.log(`WARN: HE-PROXY-001 ${k} is not set in this shell; the metering proxy needs it, harness containers never do`);
    // internal-task: a harness image built before an adapter edit silently runs the old adapter; compare the image's adapter with the checkout.
    const dockerCells = m.cells.filter((c) => c.harness !== 'scripted' && (c.harness_mode ?? 'docker') === 'docker' && !existsSync(join('harnesses', c.harness, 'compose.yaml')));
    for (const harness of [...new Set(dockerCells.map((c) => c.harness))]) {
      const image = flag('--image') ?? `harness-eval/${harness.replace(/^_/, '')}:dev`;
      const { adapterProvenance } = await import('./trial/provenance.ts');
      const p = await adapterProvenance(harness, image);
      console.log(`ADAPTER: ${harness} image ${image} (${p.image_id.slice(0, 19)}) carries adapter.sh ${p.image_sha256.slice(0, 12)}, the checkout's is ${p.checkout_sha256.slice(0, 12)}: match`);
    }
    const gbrainCells = m.cells.filter((c) => c.gbrain);
    if (gbrainCells.length) {
      const image = flag('--gbrain-image') ?? DEFAULT_GBRAIN_IMAGE;
      const { gbrainImagePresent, probeGbrainImage, exportInstallView } = await import('./trial/gbrain.ts');
      if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present for cells ${gbrainCells.map((c) => c.id).join(', ')}; fix: scripts/build-gbrain-image.sh --tag ${image}`);
      const pin = JSON.parse(readFileSync(join('gbrain', 'pin.json'), 'utf8')) as { surfaces: Record<string, { tools: number }>; embeddings: { model: string } };
      // internal-task: one probe per distinct keyword configuration (surface, brain): the image serves /health and lists the pinned tool count.
      const keywordConfigs = new Map<string, Cell[]>();
      for (const c of gbrainCells) { const g = resolveGbrain(c.gbrain!); if (g.embeddings === 'off') keywordConfigs.set(`${g.surface}/${g.brain}`, [...(keywordConfigs.get(`${g.surface}/${g.brain}`) ?? []), c]); }
      for (const [label, cs] of keywordConfigs) {
        const g = resolveGbrain(cs[0]!.gbrain!);
        const probe = await probeGbrainImage(image, join(runDir, `preflight-gbrain-${g.surface}`), { surface: g.surface });
        const pinned = pin.surfaces[g.surface]?.tools;
        if (probe.tools.length !== pinned) throw new RunnerError('HE-GBRAIN-002', `image ${image} lists ${probe.tools.length} tools on the ${g.surface} surface, gbrain/pin.json pins ${pinned}; fix: rebuild the image at the pinned commit, or re-pin after a deliberate gbrain change`);
        console.log(`GBRAIN: image ${image} id=${probe.image_id} serves /health (gbrain ${probe.version ?? 'unknown'}, ready in ${probe.ready_ms} ms), ${probe.tools.length} tools on ${g.surface} (pin ${pinned}) for cells ${cs.map((c) => c.id).join(', ')} (${label})`);
      }
      // internal-task: each distinct embedded configuration is probed through the metering proxy under a small lease of its own:
      // one search must produce a forwarded /v1/embeddings line and no degraded stamp, else the semantic cells cannot run.
      const embeddedCells = gbrainCells.filter((c) => resolveGbrain(c.gbrain!).embeddings !== 'off');
      if (embeddedCells.length) {
        if (!process.env.OPENAI_API_KEY) throw new RunnerError('HE-PROXY-001', `cells ${embeddedCells.map((c) => c.id).join(', ')} have embeddings on and OPENAI_API_KEY is not set in this shell; the metering proxy needs it to forward the sidecar's embedding calls (the sidecar never sees it)`);
        const { RunProxy } = await import('./trial/proxy.ts');
        const { isEmbeddingLine } = await import('./trial/proxy.ts');
        const proxy = await RunProxy.start({ runId: `${m.run_id}-preflight`, runDir: join(runDir, 'preflight-proxy'), ledgerPath: flag('--ledger') ?? join(runDir, 'ledger.sqlite'), leaseUsd: 0.05, allowModels: [pin.embeddings.model], reachableFromContainers: true, newRun: true });
        try {
          for (const surface of [...new Set(embeddedCells.map((c) => resolveGbrain(c.gbrain!).surface))]) {
            const model = resolveGbrain(embeddedCells[0]!.gbrain!).embeddings as string;
            const key = `preflight-${surface}`;
            await proxy.bind('preflight', key);
            const probe = await probeGbrainImage(image, join(runDir, `preflight-gbrain-embedded-${surface}`), { surface, embeddings: model as 'openai:text-embedding-3-small', openaiBaseUrl: proxy.baseUrlFor('preflight', 'openai', true), searchQuery: 'renewal pricing discount' });
            await proxy.finalize(key);
            await proxy.unbind('preflight');
            const lines = proxy.usageLines(key).filter(isEmbeddingLine);
            const forwarded = lines.filter((l) => l.outcome === 'forwarded');
            const pinned = pin.surfaces[surface]?.tools;
            if (probe.tools.length !== pinned) throw new RunnerError('HE-GBRAIN-002', `image ${image} lists ${probe.tools.length} tools on the ${surface} surface (embedded brain), gbrain/pin.json pins ${pinned}`);
            if (!forwarded.length || probe.search_degraded) throw new RunnerError('HE-GBRAIN-005', `the embedded ${surface} configuration (${model}) did not embed its probe query through the proxy: ${forwarded.length} forwarded /v1/embeddings line(s), ${lines.length - forwarded.length} refused or failed, degraded stamp ${probe.search_degraded ?? 'none'}; the semantic cells ${embeddedCells.map((c) => c.id).join(', ')} cannot run; fix: read ${join(runDir, 'preflight-proxy', 'proxy.log')} and the sidecar's serve.log under ${join(runDir, `preflight-gbrain-embedded-${surface}`)}`);
            console.log(`GBRAIN: embedded ${surface} (${model}) probe through the proxy: ${forwarded.length} /v1/embeddings line(s) forwarded (${forwarded.reduce((a, l) => a + (l.input_tokens ?? 0), 0)} tokens, ${forwarded.reduce((a, l) => a + (l.actual_usd ?? 0), 0).toFixed(6)}), search returned ${probe.search_slugs?.length ?? 0} page(s), no degraded stamp; lease ${m.run_id}-preflight`);
          }
        } finally {
          await proxy.stop();
          // The probe's lease is closed here so the run's own lease can open in the same ledger.
          const { closeRun } = await import('./ledger/budget-ledger.ts');
          closeRun(flag('--ledger') ?? join(runDir, 'ledger.sqlite'), `${m.run_id}-preflight`);
        }
      }
      // internal-task: every gbrain-docs and gbrain-installer cell's bundle view is exported from the image and verified before any trial mounts it.
      const docsViews = [...new Set(gbrainCells.map((c) => ({ c, install: resolveGbrain(c.gbrain!).install })).filter((x) => x.install !== 'mcp').map((x) => `${x.c.harness}|${x.c.split}|${x.install}`))];
      for (const v of docsViews) {
        const [harness, split, install] = v.split('|') as [string, 'dev' | 'heldout', 'gbrain-docs' | 'gbrain-installer'];
        const { installViewDir } = await import('./trial/trial.ts');
        const view = await exportInstallView(image, harness, split, installViewDir(runDir, harness, split, install), install);
        console.log(`GBRAIN: install bundle view ${view.harness}/${split} (${install}) exported and verified: ${view.files.length} files, ${view.skills} skills, view digest ${view.view_digest.slice(0, 12)}${view.context ? `, context ${view.context.kept_slugs.length} pages (${view.context.tokens ?? '?'} tokens)` : ''} (gbrain ${view.gbrain_commit.slice(0, 12)})`);
      }
      // internal-task: a company brain is probed per split under the unscoped token and must list every page the build holds.
      const companySplits = [...new Set(gbrainCells.filter((c) => c.gbrain!.brain === 'company').map((c) => c.split))];
      if (companySplits.length) {
        const { probeCompanyBrain, probeSourceGrants } = await import('./trial/gbrain.ts');
        const { companyPageList } = await import('../gbrain/build-brain.ts');
        const { worldAt, DEFAULT_WORLD_PATH } = await import('./trial/world.ts');
        const world = worldAt(DEFAULT_WORLD_PATH);
        for (const split of companySplits) {
          const scope = gbrainCells.some((c) => c.gbrain!.brain === 'company' && c.split === split && c.gbrain!.scope === 'member') ? 'member' : 'none';
          const probe = await probeCompanyBrain(image, split, companyPageList(world, split), join(runDir, `preflight-gbrain-company-${split}`), scope);
          console.log(`GBRAIN: image ${image} id=${probe.image_id} brain=company scope=${scope} split=${split} pages=${probe.listed} (${Object.entries(probe.by_kind).map(([k, v]) => `${k} ${v}`).join(', ')}) under the unscoped token${scope === 'member' ? `, tokens=${probe.member_tokens} plus public-only: ${probe.member_check}` : ''}, ready in ${probe.ready_ms} ms`);
          // internal-task (gbrain#7481): a scope "sources" cell needs the per-request source_ids to hold for every member before a paid trial.
          if (gbrainCells.some((c) => c.gbrain!.brain === 'company' && c.split === split && c.gbrain!.scope === 'sources')) {
            const s = await probeSourceGrants(image, split, join(runDir, `preflight-gbrain-sources-${split}`));
            const notDenied = s.denied.filter((d) => d.code !== 'permission_denied');
            if (s.outside.length) throw new RunnerError('HE-GBRAIN-002', `the company brain for ${split} in ${image} returned ${s.outside.length} row(s) outside the requester's source grant under source_ids (${s.outside.slice(0, 3).map((o) => `${o.member} ${o.tool} ${JSON.stringify(o.query)} -> ${o.slug} in ${o.source_id}`).join('; ')}); gbrain's source_ids narrowing does not hold at this commit`);
            if (notDenied.length) throw new RunnerError('HE-GBRAIN-002', `the company brain for ${split} in ${image} answered a source_ids list naming a source no connection holds with ${notDenied.map((d) => `${d.code ?? 'rows'} for ${d.member}/${d.source_id}`).slice(0, 3).join(', ')} instead of permission_denied`);
            if (!s.rows || !s.differs) throw new RunnerError('HE-GBRAIN-002', `the company brain for ${split} in ${image} gave ${s.rows} row(s) over ${s.calls} scoped calls${s.rows && !s.differs ? ' and the same sources to every member' : ''}; the source_ids narrowing is not observable`);
            console.log(`GBRAIN: scope=sources split=${split}: ${s.members} members x ${SOURCE_PROBE_QUERIES.length} queries x search+query = ${s.calls} calls, ${s.rows} rows over ${s.sources_seen} sources, 0 outside the requester's grant; ${s.denied.length} unknown source ids all permission_denied; a federated source outside the member's grant answers rows under the unscoped token in ${s.foreign.filter((f) => f.rows_from_it).length} of ${s.foreign.length} members (gbrain checks the connection's grant, the tap enforces the member's); the narrowing differs between members`);
          }
        }
      }
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
