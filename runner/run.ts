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
 *   bun runner/run.ts plan|dry-run --replication-of <run id> --cells <id,id> --reps <n> --run-id <new id> [--out <dir>]
 *   bun runner/run.ts preflight --manifest results/<run-id>/manifest.json [--gbrain-image <tag>] [--image <tag>] [--ledger <file>] [--cells a,b]
 *   bun runner/run.ts run --manifest results/<run-id>/manifest.json [--harness-mode docker|process|scripted]
 *       [--adapter <script>] [--image <tag>] [--gbrain-image <tag>] [--resume] [--stop-on-cap] [--cells a,b] [--ledger <file>]
 *       [--lease-usd <n>] [--new-lease] [--max-output-tokens <n>] [--preamble <file>] [--ready-timeout-s <n>]
 *       [--turn-grace-s <n>] [--harness-env K=V ...] [--capture-upstream anthropic|openai=<url> ...] [--capture-dns <ip>]
 *
 * plan and dry-run refuse a run with held-out cells unless its opening is in the set's openings ledger and within
 * budget (HE-HELDOUT-001 to 004, runner/heldout/openings.ts); a run's own row passes every time while it is opened or its
 * set is open, so shard planning and resume of the same run id are unchanged.
 *
 * Replication (internal-task, runner/heldout/replication.ts): --replication-of plans named cells of a registered held-out run
 * again from its registered prereg.json, under a new run id and --reps repetitions, and records replication_of in the
 * manifest. It is no opening and writes no ledger row, so it is accepted only when every held-out set the cells run is
 * public: out of sealed custody, spent or retired, plaintext in the tree, and sharing no digest with a live sealed set
 * (HE-REPL-001 to 003). preflight and run do not re-check held-out openings, so they take such a manifest as any other.
 *
 * Sealed custody (docs/sealed-custody.md): a held-out cell of a sealed set (its MANIFEST.json says
 * "custody": "sealed") needs --sealed-root <dir> and --opening-receipt <file> on plan, dry-run, preflight and run
 * (HE-SEALED-001 to 005). The root is the custodian's decrypted bundle outside every checkout (scripts/sealed/open.ts);
 * its task tree feeds the sealed cells' tasks, its world/world.json the trial world, the grader and the preflight probe,
 * and plan copies the receipt into the manifest so preflight and run refuse any other. Trial task paths of sealed cells
 * are stored relative to the root, so the manifest is the same on every machine. A sealed run's gbrain cells default to
 * the image harness-eval/gbrain:sealed-<run_id> (what build-gbrain-image.sh --sealed-root tags) and need it built from the
 * root. run refuses --harness-mode process for every non-scripted cell of a sealed run before it opens the root
 * (HE-SEALED-001): the harness would run as the runner's user and could read the root, whichever cell it serves. A run with no sealed cell ignores both flags and says
 * so, and preflight and run refuse it a gbrain image built from a sealed root (HE-SEALED-005: image.json says sealed or
 * records a held-out corpus digest); plaintext sets and every existing run are otherwise unchanged.
 *
 * Capture mode (runner/trial/capture.ts): --capture-upstream points the metering proxy at a fake model server and
 * gives it dummy provider keys; --capture-dns sets the in-container harness's resolver. Only a run id starting with
 * "anatomy-capture-" may use them (HE-RUN-002): capture runs are never counted runs.
 *
 * Every error prints one line starting with its HE- code (docs/errors.md) and
 * exits non-zero. Exit 3 is the budget stop (HE-BUDGET-001).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { GbrainCellConfig, HarnessMode } from './contracts.ts';
import { RunnerError } from './errors.ts';
import { canonicalLookup } from './pricing/model-pricing.ts';
import { lookupEmbeddingPrice } from './pricing/embedding-pricing.ts';
import { taskTurnCount } from './trial/task.ts';
import { DEFAULT_GBRAIN_IMAGE, SOURCE_PROBE_QUERIES } from './trial/gbrain.ts';
import { CLIENT_ID_ENV, CLIENT_SECRET_ENV, MEMORY_PROVIDER_CONFIG_NAME, isQmMemoryProvider, providerConfig, memoryProviderWiring } from '../harnesses/qm/memory-provider.ts';
import { checkPlan, type HeldoutBlock } from './heldout/openings.ts';
import { planReplication, type ReplicationOf } from './heldout/replication.ts';
import { openingDiff, publicImageProblem, readJsonFile, readReceipt, receiptProblems, sealedImageProblem, sealedImageTag, sha256 as sha256Of, verifySealedRoot, type OpeningReceipt } from './heldout/sealed.ts';
import { insideGitTree } from '../scripts/sealed/custody.ts';
import { heldoutSet, isSealed, readManifest } from '../scripts/seal-heldout.ts';
import { sealedGuard } from './heldout/guard.ts';
import { GOLDEN_WIRES, type AblationSpec, loadBinding, wireOfModel } from './proxy/ablate.ts';
import { setNames as zeroSetNames } from '../harnesses/harness-zero/zero.ts';

export { RunnerError };

// The install ladder: the gbrain cell fields, their allowed values and defaults (runner/contracts.ts GbrainCellConfig).
export const GBRAIN_SURFACES = ['starter', 'verbs'] as const;
export const GBRAIN_INSTALLS = ['mcp', 'gbrain-docs', 'gbrain-installer'] as const;
export const GBRAIN_EMBEDDINGS = ['off', 'openai:text-embedding-3-small'] as const;
/** Harnesses the install bundle has a gbrain-docs view for (gbrain/pin.json "install"); gbrain documents no such install for the others. */
export const GBRAIN_DOCS_HARNESSES = ['openclaw', 'hermes', '_fake'] as const;
/** Harnesses the bundle has a gbrain-installer view for: the docs harnesses, and Claude Code and Codex, where gbrain setup writes the
 *  block and the per-turn UserPromptSubmit hook (gbrain#7989). */
export const GBRAIN_INSTALLER_HARNESSES = [...GBRAIN_DOCS_HARNESSES, 'claude-code', 'codex'] as const;
/** The planning allowance for a cell with embeddings on: query embeddings per trial and tokens per query, priced from
 *  runner/pricing/embedding-pricing.ts (a search's query is a sentence; gbrain caches the embedding per distinct query). */
export const EMBEDDING_ALLOWANCE = { calls_per_trial: 50, tokens_per_call: 100 } as const;

export interface ResolvedGbrain {
  surface: (typeof GBRAIN_SURFACES)[number];
  install: (typeof GBRAIN_INSTALLS)[number];
  embeddings: (typeof GBRAIN_EMBEDDINGS)[number];
  brain: 'bot-visible' | 'company' | 'member';
  scope: 'none' | 'member' | 'sources' | 'member-sources';
  /** Live ingestion of the scenario's messages into the member brain. */
  ingest: 'off' | 'live';
  /** internal-task: present only on a cell of the access-ruled member brain. */
  access?: 'rules';
}

/** The cell's gbrain configuration with every default filled in; the cell itself is not changed. */
export function resolveGbrain(c: GbrainCellConfig): ResolvedGbrain {
  return { surface: c.surface, install: c.install ?? 'mcp', embeddings: c.embeddings ?? 'off', brain: c.brain ?? 'bot-visible', scope: c.scope ?? 'none', ingest: c.ingest ?? 'off', ...(c.access ? { access: c.access } : {}) };
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
  /** Harness-specific configuration name, handed to the adapter as HE_HARNESS_CONFIG. QM accepts pi (the
   *  default), pi-probe, pi-strict, pi-command-deny and pi-memory-provider (gbrain as QM's per-turn memory provider,
   *  no gbrain MCP server; harnesses/qm/memory-provider.ts) (harnesses/qm/pin.json configs). OpenClaw and
   *  Hermes accept default and the instruction routes route-tool, route-system (Hermes only), route-startup, route-hook and
   *  route-skill (harnesses/routes/README.md). Claude Code and Codex accept default and official-minimal (prompt archaeology:
   *  the harness's own system prompt or base instructions replaced by harnesses/ablation/official-minimal.txt, through the
   *  adapter; a config value, not a layer of the ablation field). Harness Zero accepts its set names (internal-task,
   *  harnesses/harness-zero/README.md; HE-ZERO-001 otherwise). The other harnesses ignore it. */
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
  /** "internal" runs the harness container (and a gbrain sidecar) on the run's internal docker network: no DNS and
   *  no route off the machine, the metering proxy, the world and the gbrain tap on that network's gateway, still reached as
   *  host.docker.internal (docs/adapters.md, "Network"). Absent, the default docker bridge, as before. */
  network?: 'internal';
  /** Prompt archaeology: the metering proxy cuts these layers of the harness's built-in prompt out of every request,
   *  by the layer map (harnesses/ablation/<harness>.<wire>.layers.json, path from the repository root) whose sha256 the
   *  preregistration names (runner/proxy/ablate.ts). An empty layer list is the full cell: filter on, nothing removed. */
  ablation?: AblationSpec;
}

const CELL_KEYS = new Set(['id', 'harness', 'model', 'slice', 'split', 'config', 'repetitions', 'ceiling', 'tasks', 'harness_mode', 'script', 'adapter', 'gbrain', 'preamble', 'task_set', 'session_scope', 'utility_models', 'network', 'ablation']);
export const DEFAULT_TASK_SET = 'v0.1';

/** The Particle cells whose harness pin has no model_particle entry, the declaration an adapter makes when it routes
 *  <proxy>/<slot>/particle as Chat Completions. Any other adapter falls back to its Anthropic config on that URL. */
export function particleCellsWithoutRoute<C extends Pick<Cell, 'harness'>>(cells: C[], root = '.'): C[] {
  return cells.filter((c) => {
    try { return !(JSON.parse(readFileSync(join(root, 'harnesses', c.harness, 'pin.json'), 'utf8')) as { model_particle?: unknown }).model_particle; }
    catch { return true; }
  });
}

/** A cell that calls Particle needs PARTICLE_API_KEY in this shell for the metering proxy (HE-PROXY-001) and a harness
 *  whose pin declares a Particle transport (HE-PIN-003). preflight and run both check, because a resumed shard skips a
 *  preflight that already passed (scripts/run-shard.sh). */
function requireParticleCells(cells: Array<Pick<Cell, 'id' | 'harness' | 'model' | 'utility_models'>>): void {
  const particle = cells.filter((c) => cellModels(c).some((id) => id.startsWith('particle:')));
  if (particle.length && !process.env.PARTICLE_API_KEY) throw new RunnerError('HE-PROXY-001', `cells ${particle.map((c) => c.id).join(', ')} call Particle and PARTICLE_API_KEY is not set in this shell; the metering proxy needs it to forward their calls (harness containers never see it)`);
  const noRoute = particleCellsWithoutRoute(particle);
  if (noRoute.length) throw new RunnerError('HE-PIN-003', `cells ${noRoute.map((c) => `${c.id} (${c.harness})`).join(', ')} call Particle, but their harness pin declares no Particle transport (model_particle in harnesses/<name>/pin.json); the proxy routes Particle as Chat Completions only, and an adapter without that branch sends Anthropic Messages to it; fix: run the cell on a harness whose adapter routes <proxy>/<slot>/particle`);
}

/** The provider:model ids a cell's harness may call, its model and its utility_models: what the runner binds the
 *  trial's proxy slot to (POST /__proxy/bind models), so a request for another model on that slot is refused even when
 *  another cell of the run put it on the run-wide --allow-models. */
export const cellModels = (cell: Pick<Cell, 'model' | 'utility_models'>): string[] => [cell.model, ...(cell.utility_models ?? [])].filter((m) => m !== 'none');

/** The name printed for a cell's task set. */
export function taskSetName(cell: Pick<Cell, 'task_set'>): string {
  return cell.task_set ?? DEFAULT_TASK_SET;
}

/** The directory a cell's multi-user tasks live under: tasks/multiuser/<split>/ for v0.1, tasks/multiuser/<task_set>/<split>/ otherwise.
 *  A task set named by a directory tasks/repo/<task_set>/ under tasksRoot is a repo set, tasks/repo/<task_set>/<split>/
 *  (set names are unique across kinds; bun scripts/seal-heldout.ts --check refuses a name both kinds use). */
export function taskSetDir(cell: Pick<Cell, 'task_set' | 'split'>, tasksRoot = 'tasks'): string {
  const set = taskSetName(cell);
  if (set !== DEFAULT_TASK_SET && existsSync(join(tasksRoot, 'repo', set))) return join(tasksRoot, 'repo', set, cell.split);
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
  /** Required when a cell runs a held-out split, unless the preregistration is on the legacy list (runner/heldout/openings.ts). */
  heldout?: HeldoutBlock;
  /** internal-task: the full gbrain commit this run's gbrain image is built at, when it is not gbrain/pin.json's (the pin stays the earlier
   *  run's). scripts/run-shard.sh builds the image at it, and preflight and run refuse an image that records another (HE-GBRAIN-016).
   *  Absent: the pin, as before. */
  gbrain_commit?: string;
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
  /** Sealed custody: the set whose held-out cells read the sealed root, and the opening receipt plan was given (and its sha256). */
  sealed?: { set: string; receipt_sha256: string; receipt: OpeningReceipt };
  /** internal-task: the preregistration's gbrain_commit, copied at plan; present only when the preregistration names one. */
  gbrain_commit?: string;
  /** internal-task: a replication of a past held-out run (runner/heldout/replication.ts), planned from its registered prereg.json. */
  replication_of?: ReplicationOf;
}

/** internal-task: a harness-zero cell's config must be a set zero.ts knows (setNames: features.json, the derived ablations and
 *  candidates.json); plan and dry-run check it at load, preflight again against the checkout it will run. */
export function checkZeroConfig(c: Pick<Cell, 'id' | 'harness' | 'config'>): void {
  if (c.harness !== 'harness-zero' || c.config === undefined || zeroSetNames().includes(c.config)) return;
  throw new RunnerError('HE-ZERO-001', `cell ${c.id}: config ${JSON.stringify(c.config)} is not a Harness Zero set; fix: use one of ${zeroSetNames().join(', ')}`);
}

export function loadPrereg(path: string): { prereg: Prereg; sha256: string } {
  if (!existsSync(path)) throw new RunnerError('HE-PREREG-001', `preregistration not found: ${path}; fix: pass --prereg <docs/benchmarks/<run>/prereg.json>`);
  const raw = readFileSync(path, 'utf8');
  const prereg = JSON.parse(raw) as Prereg;
  if (prereg.schema_version !== 1) throw new RunnerError('HE-PREREG-002', `schema_version must be 1 (got ${String(prereg.schema_version)})`);
  if (!prereg.cells?.length) throw new RunnerError('HE-PREREG-003', 'no cells; fix: add at least one cell to the preregistration');
  prereg.tasks ??= {};
  if (prereg.gbrain_commit !== undefined && (typeof prereg.gbrain_commit !== 'string' || !/^[0-9a-f]{40}$/.test(prereg.gbrain_commit))) throw new RunnerError('HE-GBRAIN-016', `gbrain_commit must be a full 40-character gbrain sha (got ${JSON.stringify(prereg.gbrain_commit)}); fix: name the commit the run's gbrain image is built at, or drop the field to run gbrain/pin.json's`);
  for (const c of prereg.cells) {
    const unknown = Object.keys(c).filter((k) => !CELL_KEYS.has(k));
    if (unknown.length) throw new RunnerError('HE-PREREG-007', `cell ${String(c.id)}: unknown key(s) ${unknown.join(', ')}; allowed: ${[...CELL_KEYS].join(', ')}`);
    if (c.task_set !== undefined && (typeof c.task_set !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(c.task_set))) throw new RunnerError('HE-PREREG-007', `cell ${c.id}: task_set must be a name such as "v0.1" or "v0.2" (got ${JSON.stringify(c.task_set)})`);
    if (c.session_scope !== undefined && !['conversation', 'turn'].includes(c.session_scope)) throw new RunnerError('HE-PREREG-007', `cell ${c.id}: session_scope must be "conversation" or "turn" (got ${JSON.stringify(c.session_scope)})`);
    if (c.utility_models !== undefined && (!Array.isArray(c.utility_models) || !c.utility_models.length || c.utility_models.some((m) => typeof m !== 'string' || !/^[a-z]+:[A-Za-z0-9._-]+$/.test(m)))) throw new RunnerError('HE-PREREG-007', `cell ${c.id}: utility_models must be a non-empty list of provider:model ids (got ${JSON.stringify(c.utility_models)})`);
    if (c.network !== undefined) {
      if (c.network !== 'internal') throw new RunnerError('HE-PREREG-007', `cell ${c.id}: network must be "internal" or absent, the default docker bridge (got ${JSON.stringify(c.network)})`);
      if (c.harness_mode === 'scripted' || c.harness_mode === 'process') throw new RunnerError('HE-NET-001', `cell ${c.id}: network "internal" needs a harness container; harness_mode "${c.harness_mode}" runs none. fix: drop network or harness_mode`);
      if (c.slice === 'hello' || c.slice === 'smoke') throw new RunnerError('HE-NET-001', `cell ${c.id}: network "internal" is for multi-user trials; slice ${c.slice} runs through harnesses/run-trial.sh on the default bridge. fix: drop network from the cell`);
      if (existsSync(join('harnesses', c.harness, 'compose.yaml'))) throw new RunnerError('HE-NET-001', `cell ${c.id}: harness ${c.harness} is a compose stack (harnesses/${c.harness}/compose.yaml), which the runner does not move onto the internal network. fix: drop network from the cell`);
    }
    // Codex 0.165.0 calls chatgpt.com and other hosts directly when its plugins are on. The adapter turns them off, and a
    // Codex cell still runs only where nothing but the proxy, the world and the gbrain tap is reachable, so a direct connection the
    // config missed cannot happen either (harnesses/codex/README.md).
    if (c.harness === 'codex' && c.network !== 'internal') throw new RunnerError('HE-NET-001', `cell ${c.id}: harness codex needs network "internal" (Codex 0.165.0 calls chatgpt.com directly when its plugins are on; the internal network rules out any direct connection the config missed; harnesses/codex/README.md). fix: add "network": "internal" to the cell`);
    if (c.ablation !== undefined) checkAblation(c);
    // internal-task: Harness Zero reaches only the proxy, the world and the gbrain tap by design, and its config names a set from
    // harnesses/harness-zero/config; an unknown set would exit 2 before ready in every trial.
    if (c.harness === 'harness-zero' && c.network !== 'internal') throw new RunnerError('HE-NET-001', `cell ${c.id}: harness harness-zero needs network "internal" (harnesses/harness-zero/pin.json). fix: add "network": "internal" to the cell`);
    checkZeroConfig(c);
    if (!prereg.tasks[c.slice] && !c.tasks && c.slice !== 'multiuser') throw new RunnerError('HE-PREREG-004', `cell ${c.id} names slice ${c.slice} but tasks.${c.slice} is missing`);
    const scripted = c.harness_mode === 'scripted';
    if (scripted && (c.harness !== 'scripted' || !['oracle', 'mutations'].includes(c.script ?? '')))
      throw new RunnerError('HE-PREREG-006', `cell ${c.id}: a scripted cell needs harness "scripted" and script "oracle" or "mutations"`);
    if (!scripted && c.model === 'none') throw new RunnerError('HE-PIN-002', `cell ${c.id}: model "none" is only valid for a scripted cell`);
    if (!scripted && !canonicalLookup(c.model)) throw new RunnerError('HE-PIN-002', `cell ${c.id}: model ${c.model} has no price in the dated price table runner/pricing/prices-<date>.json; fix: register its list price before any cell runs (a price change is a new dated file)`);
    if (!(c.repetitions >= 1)) throw new RunnerError('HE-PREREG-005', `cell ${c.id}: repetitions must be >= 1`);
    if (c.preamble !== undefined && (typeof c.preamble !== 'string' || !existsSync(c.preamble))) throw new RunnerError('HE-TASK-002', `cell ${c.id}: preamble not found at ${String(c.preamble)}; fix: name a committed file such as tasks/multiuser/_shared/preamble.md`);
    if (c.gbrain !== undefined) {
      // Surface, install and embeddings are the ladder's orthogonal fields; HE-GBRAIN-001 names the field, the value and the allowed set.
      const bad = (field: string, value: unknown, allowed: readonly string[]) => new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.${field} must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')} (gbrain/pin.json); got ${JSON.stringify(value)}`);
      if (!c.gbrain || typeof c.gbrain !== 'object') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain must be an object such as {"surface": "starter"}; got ${JSON.stringify(c.gbrain)}`);
      if (!(GBRAIN_SURFACES as readonly string[]).includes(c.gbrain.surface as string)) throw bad('surface', c.gbrain.surface, GBRAIN_SURFACES);
      if (c.gbrain.install !== undefined && !(GBRAIN_INSTALLS as readonly string[]).includes(c.gbrain.install)) throw bad('install', c.gbrain.install, GBRAIN_INSTALLS);
      if (c.gbrain.embeddings !== undefined && !(GBRAIN_EMBEDDINGS as readonly string[]).includes(c.gbrain.embeddings)) throw bad('embeddings', c.gbrain.embeddings, GBRAIN_EMBEDDINGS);
      const installHarnesses: readonly string[] = c.gbrain.install === 'gbrain-installer' ? GBRAIN_INSTALLER_HARNESSES : GBRAIN_DOCS_HARNESSES;
      if (c.gbrain.install !== undefined && c.gbrain.install !== 'mcp' && !installHarnesses.includes(c.harness)) throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.install "${c.gbrain.install}" is defined for harnesses ${installHarnesses.filter((h) => !h.startsWith('_')).join(', ')} (gbrain documents no ${c.gbrain.install} install for ${c.harness}; gbrain/pin.json "install")`);
      if (c.gbrain.embeddings !== undefined && c.gbrain.embeddings !== 'off' && c.gbrain.brain !== undefined && c.gbrain.brain !== 'bot-visible') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.embeddings ${c.gbrain.embeddings} needs the bot-visible brain; only the bot-visible brains are built with embeddings`);
      if (scripted) throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: a scripted cell cannot carry gbrain; a script plays the bot over world-MCP and has no harness to call the brain`);
      // Company brain: brain and scope are additive; a cell without them is the gbrain arm's cell.
      // Member brain: brain "member" carries member tokens and ingest tokens; ingest "live" needs it.
      if (c.gbrain.brain !== undefined && c.gbrain.brain !== 'bot-visible' && c.gbrain.brain !== 'company' && c.gbrain.brain !== 'member') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.brain must be "bot-visible", "company" or "member"; got ${JSON.stringify(c.gbrain.brain)}`);
      if (c.gbrain.scope !== undefined && c.gbrain.scope !== 'member' && c.gbrain.scope !== 'sources' && c.gbrain.scope !== 'member-sources') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.scope must be "member", "sources", "member-sources" or absent; got ${JSON.stringify(c.gbrain.scope)}`);
      if (c.gbrain.scope !== undefined && c.gbrain.brain !== 'company' && c.gbrain.brain !== 'member') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.scope "${c.gbrain.scope}" needs gbrain.brain "company" or "member"; only those brains carry member tokens and per-member source grants`);
      if (c.gbrain.ingest !== undefined && c.gbrain.ingest !== 'off' && c.gbrain.ingest !== 'live') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.ingest must be "off", "live" or absent; got ${JSON.stringify(c.gbrain.ingest)}`);
      if (c.gbrain.ingest === 'live' && c.gbrain.brain !== 'member') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.ingest "live" needs gbrain.brain "member"; only the member brain carries the per-source ingest tokens (gbrain/README.md, "The member brain")`);
      if (c.gbrain.ingest === 'live' && c.harness_mode === 'process') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: gbrain.ingest "live" runs in docker mode only; in process mode the harness runs as the runner's user and could read the ingest tokens under the trial directory. fix: drop harness_mode "process" from the cell`);
      // internal-task: "member-sources" keeps the member-token layer of "member" and adds the member's source_ids, so it satisfies the rule too.
      if (c.gbrain.ingest === 'live' && c.gbrain.scope !== 'member' && c.gbrain.scope !== 'member-sources') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.ingest "live" needs gbrain.scope "member" or "member-sources"; without the member's own token the tap reads under the trial's unscoped token and every member's ingested DM facts come back to every requester, a leak built into the arm`);
      // internal-task (the access-rules rerun): access "rules" is the member brain's read gate; only member tokens read through it.
      if (c.gbrain.access !== undefined && c.gbrain.access !== 'rules') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.access must be "rules" or absent; got ${JSON.stringify(c.gbrain.access)}`);
      if (c.gbrain.access === 'rules' && (c.gbrain.brain !== 'member' || c.gbrain.scope !== 'member')) throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.access "rules" needs gbrain.brain "member" and gbrain.scope "member" (got brain ${JSON.stringify(c.gbrain.brain ?? 'bot-visible')}, scope ${JSON.stringify(c.gbrain.scope ?? 'none')}); only the member brain is built with folder rules, and only the members' own bound tokens read through them`);
      if (c.gbrain.access === 'rules' && c.gbrain.ingest === 'live') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: gbrain.access "rules" runs without live ingestion; the ingested facts land outside the folder rules, where every member token reads them`);
    }
    // internal-task (internal-task plan v3, M1): QM's memory-provider config reaches gbrain only through MEMORY_PROVIDER_CONFIG, so it needs a
    // QM harness in docker (the client secret stays in the compose stack) and a gbrain sidecar behind the tap, served over MCP.
    if (c.config === MEMORY_PROVIDER_CONFIG_NAME) {
      if (c.harness !== 'qm') throw new RunnerError('HE-PREREG-007', `cell ${c.id}: config "${MEMORY_PROVIDER_CONFIG_NAME}" is QM's memory-provider route; harness ${c.harness} has none. fix: drop config or use harness qm`);
      if (c.slice === 'hello' || c.slice === 'smoke') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: config "${MEMORY_PROVIDER_CONFIG_NAME}" is wired for multi-user trials only; slice ${c.slice} runs through harnesses/run-trial.sh, which passes neither the config nor the provider wiring, so QM would run as plain pi with no gbrain. fix: use slice multiuser`);
      if (c.harness_mode !== undefined && c.harness_mode !== 'docker') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: config "${MEMORY_PROVIDER_CONFIG_NAME}" runs in docker mode only; the provider's client secret goes to QM core's container and nowhere else. fix: drop harness_mode`);
      if (!c.gbrain) throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: config "${MEMORY_PROVIDER_CONFIG_NAME}" recalls from the trial's gbrain sidecar; the cell carries no gbrain. fix: add gbrain, such as {"surface": "starter", "brain": "member", "scope": "member", "ingest": "live"}`);
      if (c.gbrain.install !== undefined && c.gbrain.install !== 'mcp') throw new RunnerError('HE-GBRAIN-001', `cell ${c.id}: config "${MEMORY_PROVIDER_CONFIG_NAME}" reaches gbrain over MCP from QM core; gbrain.install "${c.gbrain.install}" installs into the harness. fix: drop gbrain.install`);
      if (c.gbrain.access === 'rules') throw new RunnerError('HE-GBRAIN-003', `cell ${c.id}: config "${MEMORY_PROVIDER_CONFIG_NAME}" with gbrain.access "rules" is untested: the provider reads whole-brain under the trial's unscoped token, which no folder rule binds, and no preregistration has asked for the combination. fix: drop gbrain.access, or preregister the combination with its own preflight`);
    }
  }
  if (!(prereg.spend_cap_usd > 0)) throw new RunnerError('HE-BUDGET-002', 'spend_cap_usd must be > 0; the cap is written into the preregistration, never passed ad hoc');
  return { prereg, sha256: createHash('sha256').update(raw).digest('hex') };
}

/** A cell's ablation at plan time: the shape, a multi-user harness cell, the map file present with the preregistered
 *  sha256, the layers a subset of the map's, and the map made for this cell's harness, model and a golden-tested wire. */
function checkAblation(c: Cell): void {
  const bad = (why: string) => new RunnerError('HE-PREREG-007', `cell ${c.id}: ablation ${why}`);
  const a = c.ablation as unknown as Record<string, unknown>;
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).sort().join(',') !== 'layers,map,map_sha256' || typeof a.map !== 'string' || typeof a.map_sha256 !== 'string' || !Array.isArray(a.layers))
    throw bad(`must be {"map": <layer map path>, "map_sha256": <its sha256>, "layers": [<layer>, ...]} (got ${JSON.stringify(a)})`);
  if (c.slice !== 'multiuser' || c.harness_mode === 'scripted') throw bad(`runs on multi-user harness cells only (slice ${c.slice}, harness_mode ${c.harness_mode ?? 'docker'})`);
  if (!existsSync(a.map)) throw bad(`map ${a.map} not found`);
  let map: ReturnType<typeof loadBinding>['map'];
  try { map = loadBinding(c.ablation!).map; } catch (e) { throw bad((e as Error).message); }
  const wire = wireOfModel(c.model);
  if (map.harness !== c.harness || `${c.model.slice(0, c.model.indexOf(':'))}:${map.model}` !== c.model || wire !== map.wire)
    throw bad(`map ${a.map} is for ${map.harness} on ${map.model} over ${map.wire}, not this cell's ${c.harness} on ${c.model} over ${wire ?? 'an unknown wire'}`);
  if (!GOLDEN_WIRES.includes(map.wire)) throw bad(`wire ${map.wire} has no golden test (runner/proxy/ablate.ts GOLDEN_WIRES)`);
  if (c.utility_models?.includes(c.model)) throw bad(`cannot run with the cell's own model ${c.model} in utility_models: the filter passes housekeeping requests through untouched`);
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
  /** Sealed custody: the held-out cells of sealedSet read their tasks from <sealedRoot>/tasks, and their trials record task
   *  and script paths relative to sealedRoot. */
  sealedRoot?: string;
  sealedSet?: string;
}

/** Whether a cell reads the sealed root: a held-out cell of the sealed set. */
export const isSealedCell = (cell: Pick<Cell, 'split' | 'task_set'>, sealedSet: string | undefined): boolean => !!sealedSet && cell.split === 'heldout' && taskSetName(cell) === sealedSet;

/** The sets in sealed custody that the cells run held-out cells of (checked against the set's MANIFEST.json under root). */
export function sealedSetsOf(cells: Array<Pick<Cell, 'split' | 'task_set'>>, root = process.cwd()): string[] {
  const sets = [...new Set(cells.filter((c) => c.split === 'heldout').map(taskSetName))];
  return sets.filter((s) => isSealed(readManifest(heldoutSet(s, root)))).sort();
}

export interface SealedContext { root: string; set: string; receipt: OpeningReceipt; receipt_sha256: string; worldPath: string }

/**
 * Check a sealed root and its opening receipt before any sealed task or record is read: both flags given (HE-SEALED-001),
 * the root outside every git checkout (HE-SEALED-002), the receipt naming this run, its preregistration bytes, candidate
 * and label and matching the set's public commitments, and when the manifest holds a copy, naming the same opening (HE-SEALED-003),
 * and the root's task tree, slice, corpus pages and merged world matching the receipt (HE-SEALED-004).
 */
export function openSealedContext(o: { sealedRoot?: string; receiptPath?: string; set: string; runId: string; preregSha: string; candidate?: string; label?: string; expectReceipt?: OpeningReceipt; root?: string }): SealedContext {
  const root = o.root ?? process.cwd();
  if (!o.sealedRoot || !o.receiptPath) throw new RunnerError('HE-SEALED-001', `run ${o.runId} has held-out cells of set ${o.set}, which is in sealed custody; pass --sealed-root <the custodian's opened root> and --opening-receipt <its opening-receipt.json> (scripts/sealed/open.ts; docs/sealed-custody.md)`);
  if (!existsSync(o.sealedRoot) || !existsSync(o.receiptPath)) throw new RunnerError('HE-SEALED-001', `--sealed-root ${o.sealedRoot} or --opening-receipt ${o.receiptPath} does not exist`);
  const inside = spawnSync('git', ['-C', o.sealedRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status === 0 && inside.stdout.trim() === 'true') throw new RunnerError('HE-SEALED-002', `--sealed-root ${o.sealedRoot} is inside a git work tree; sealed plaintext stays outside every checkout (scripts/sealed/open.ts writes it under ~/.capy/work/sealed/<run_id>)`);
  const bytes = readFileSync(o.receiptPath);
  const receiptSha = sha256Of(bytes);
  let receipt: OpeningReceipt;
  try { receipt = readReceipt(o.receiptPath); } catch (e) { throw new RunnerError('HE-SEALED-003', `--opening-receipt ${o.receiptPath} is not JSON (${e instanceof Error ? e.name : 'error'}); the parser's message is withheld, since it quotes the input`); }
  const differs = o.expectReceipt ? openingDiff(receipt, o.expectReceipt) : [];
  if (differs.length) throw new RunnerError('HE-SEALED-003', `--opening-receipt ${o.receiptPath} is not the opening plan copied into the manifest (it differs in ${differs.join(', ')}); a run reads only the opening it was planned with (a resumed receipt of that same opening is accepted)`);
  const problems = receiptProblems(receipt, { run_id: o.runId, prereg_sha256: o.preregSha, set: o.set, candidate_sha256: o.candidate, label: o.label }, readManifest(heldoutSet(o.set, root)));
  if (problems.length) throw new RunnerError('HE-SEALED-003', `the opening receipt does not bind this run: ${problems.join('; ')}`);
  let rootProblems: string[];
  try { rootProblems = verifySealedRoot(o.sealedRoot, receipt, root); } catch (e) { throw new RunnerError('HE-SEALED-004', `the sealed root ${o.sealedRoot} could not be read (${e instanceof Error ? e.name : 'error'}); the message is withheld, since it can name a sealed task path; fix: reopen with scripts/sealed/open.ts (the same run id resumes)`); }
  if (rootProblems.length) throw new RunnerError('HE-SEALED-004', `the sealed root does not match its opening receipt: ${rootProblems.join('; ')}; fix: reopen with scripts/sealed/open.ts (the same run id resumes)`);
  const abs = resolve(o.sealedRoot);
  return { root: abs, set: o.set, receipt, receipt_sha256: receiptSha, worldPath: join(abs, 'world', 'world.json') };
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
  const trials: Trial[] = [];
  const perCell: Record<string, number> = {};
  let hours = 0;
  for (const cell of prereg.cells) {
    const sealedCell = isSealedCell(cell, opts.sealedSet) && !!opts.sealedRoot;
    const tasksRoot = sealedCell ? join(opts.sealedRoot!, 'tasks') : (opts.tasksRoot ?? 'tasks');
    const stored = (p: string) => (sealedCell ? relative(opts.sealedRoot!, p) : p);
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
          trials.push({ id, cell: cell.id, task, repetition: r, task_dir: stored(dir), turns, ...(s ? { script: stored(s.path) } : {}) });
        }
      }
    }
    perCell[cell.id] = +cellUsd.toFixed(2);
    hours += (trials.filter((t) => t.cell === cell.id).length * (prereg.wall_clock_s[cell.slice] ?? 0)) / 3600;
  }
  const ceiling = +Object.values(perCell).reduce((a, b) => a + b, 0).toFixed(2);
  return { schema_version: 1, run_id: prereg.run_id, prereg_sha256: sha256, created_at: now, cells: prereg.cells, trials, cost_ceiling_usd: ceiling, per_cell_ceiling_usd: perCell, spend_cap_usd: prereg.spend_cap_usd, trial_hours_at_cap: +hours.toFixed(1), ...(prereg.gbrain_commit ? { gbrain_commit: prereg.gbrain_commit } : {}) };
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
    lines.push(`CELL: ${c.id} harness=${c.harness} mode=${c.harness_mode ?? 'docker'}${c.script ? ` script=${c.script}` : ''} model=${c.model} slice=${c.slice} split=${c.split}${c.slice === 'multiuser' ? ` task_set=${taskSetName(c)}` : ''}${c.session_scope ? ` session_scope=${c.session_scope}` : ''}${c.utility_models ? ` utility_models=${c.utility_models.join(',')}` : ''}${c.config ? ` config=${c.config}` : ''}${c.network ? ` network=${c.network}` : ''}${c.ablation ? ` ablation=${c.ablation.layers.join(',') || 'none'} map=${c.ablation.map} map_sha256=${c.ablation.map_sha256.slice(0, 12)}` : ''} reps=${c.repetitions} trials=${mine.length}${turns ? ` turns=${turns}` : ''} ceiling_usd=${m.per_cell_ceiling_usd[c.id]}${c.gbrain ? ` gbrain=${gbrainLabel(c.gbrain)}${c.gbrain.brain ? ` brain=${c.gbrain.brain}` : ''}${c.gbrain.scope ? ` scope=${c.gbrain.scope}` : ''}${c.gbrain.ingest ? ` ingest=${c.gbrain.ingest}` : ''}${c.gbrain.access ? ` access=${c.gbrain.access}` : ''}` : ''}${c.preamble ? ` preamble=${c.preamble}` : ''}`);
  }
  for (const c of m.cells) {
    if (c.gbrain?.brain === 'company' && c.preamble !== 'tasks/multiuser/_shared/preamble.gbrain-company.md') lines.push(`WARN: cell ${c.id} serves the company brain with preamble ${c.preamble ?? 'tasks/multiuser/_shared/preamble.md'}, not the company one (tasks/multiuser/_shared/preamble.gbrain-company.md); intended only for a none-style arm on the company brain`);
  }
  // One GBRAIN line per distinct configuration (surface/install/embeddings), naming what each means.
  // A QM memory-provider cell gets its own line, since gbrain reaches it through MEMORY_PROVIDER_CONFIG and not MCP registration.
  const configs = new Map<string, Cell[]>();
  const key = (c: Cell) => `${gbrainLabel(c.gbrain!)}${isQmMemoryProvider(c) ? ' memory-provider' : ''}`;
  for (const c of m.cells) if (c.gbrain) configs.set(key(c), [...(configs.get(key(c)) ?? []), c]);
  for (const cs of configs.values()) {
    const label = gbrainLabel(cs[0]!.gbrain!);
    const g = resolveGbrain(cs[0]!.gbrain!);
    const words = [
      g.surface === 'verbs' ? 'the 7 memory verbs (page search is recall)' : 'the 33-tool starter surface',
      isQmMemoryProvider(cs[0]!) ? "QM's memory provider only (MEMORY_PROVIDER_CONFIG: the per-turn recall in personal scope and the model's searches through QM's memory tool, both whole-brain whatever the cell's scope), no gbrain MCP server registered" : g.install === 'gbrain-docs' ? "gbrain's documented install applied in the harness container from the image's bundle" : g.install === 'gbrain-installer' ? "gbrain's own installer (gbrain setup <harness> --instructions-only) applied in the harness container from the image's bundle" : 'MCP registration only',
      g.embeddings === 'off' ? 'keyword-only, no model call' : `query embeddings ${g.embeddings} through the metering proxy, metered per trial (allowance ${embeddingAllowanceUsd(cs[0]!.gbrain).toFixed(4)} per trial in the ceiling)`,
    ];
    lines.push(`GBRAIN: cells ${cs.map((c) => c.id).join(', ')} run with a gbrain sidecar per trial (image ${DEFAULT_GBRAIN_IMAGE} unless --gbrain-image; ${label}: ${words.join('; ')}; docs/gbrain-arm.md)`);
  }
  for (const c of m.cells.filter(isQmMemoryProvider)) {
    const block = memoryProviderWiring({ mcpUrl: '<world /gbrain tap>', actor: '<the bot>', secret: '<per trial>' }).provider;
    const { clients, tokens, ...tap } = block;
    lines.push(`QM-PROVIDER: cell ${c.id}: MEMORY_PROVIDER_CONFIG ${JSON.stringify(providerConfig('<world /gbrain tap, as core reaches it>'))}; core gets ${CLIENT_ID_ENV} ${Object.keys(clients).join(', ')} and ${CLIENT_SECRET_ENV} (per trial, never written); tap provider block ${JSON.stringify(tap)}, the OAuth client acting as the bot and its issued tokens; adapter env without HE_GBRAIN_MCP_URL, so no gbrain MCP server is registered`);
  }
  if (m.cost_ceiling_usd > m.spend_cap_usd) lines.push(`WARN: HE-BUDGET-003 cost ceiling ${m.cost_ceiling_usd} exceeds the preregistered cap ${m.spend_cap_usd}; cells past the cap stop incomplete in drop order`);
  return lines.join('\n');
}

export function loadManifest(path: string | undefined): { manifest: Manifest; path: string } {
  if (!path || !existsSync(path)) throw new RunnerError('HE-RUN-002', 'missing or absent --manifest <results/<run-id>/manifest.json>');
  return { manifest: readJsonFile<Manifest>(path), path };
}

/** The terminal lines a sealed plan, dry-run, preflight or run may print (runner/heldout/guard.ts): the plan's run, cell
 *  and gbrain lines, the opening and preflight lines, run-level counts and progress counts. Trial and turn lines, which
 *  name tasks, channels and grades, go to the log file only. */
const SEALED_RUN_ALLOW = [/^(RUN|CELL|GBRAIN|HELDOUT|SEALED|MANIFEST|PREFLIGHT|ADAPTER): /, /^WARN: (HE-BUDGET-003|HE-PROXY-001|cell \S+ serves)/, /^run \S+: \d+ trials (to run|recorded)/, /^metering proxy on port/, /^progress: \d+ of \d+ trials/];

function installSealedGuard(sealed: SealedContext, logFile: string, label: string): void {
  sealedGuard({ root: sealed.root, set: sealed.set, repoRoot: process.cwd(), preregJson: sealed.receipt.prereg_json, logFile: resolve(logFile), allow: SEALED_RUN_ALLOW, label: `runner/run.ts ${label}` });
}

/** The run's log callback under a sealed root: every line to the guarded log, plus a count line after each trial. */
function sealedProgress(): (line: string) => void {
  let total = 0, done = 0;
  return (line) => {
    console.log(line);
    const start = /^run \S+: (\d+) trials to run/.exec(line);
    if (start) total = Number(start[1]);
    if (/^trial \S+: termination=/.test(line)) console.log(`progress: ${++done} of ${total} trials this invocation`);
  };
}

/** preflight and run: the sealed context of a manifest planned sealed (the flags must name the same opening), or undefined. */
function sealedContextFor(m: Manifest, flag: (name: string) => string | undefined, runDir: string): SealedContext | undefined {
  if (!m.sealed) {
    if (flag('--sealed-root') || flag('--opening-receipt')) console.log('SEALED: this manifest was not planned with a sealed root; --sealed-root and --opening-receipt are ignored');
    return undefined;
  }
  if (insideGitTree(resolve(runDir))) throw new RunnerError('HE-SEALED-002', `--manifest ${runDir} is inside a git work tree; a sealed run writes its raw results and custody logs beside the manifest, and they stay outside every checkout until release`);
  return openSealedContext({ sealedRoot: flag('--sealed-root'), receiptPath: flag('--opening-receipt'), set: m.sealed.set, runId: m.run_id, preregSha: m.prereg_sha256, candidate: m.sealed.receipt.candidate_sha256, label: m.sealed.receipt.label, expectReceipt: m.sealed.receipt });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const has = (name: string) => rest.includes(name);
  const all = (name: string) => rest.map((a, i) => (a === name ? rest[i + 1] : undefined)).filter((v): v is string => v !== undefined);
  if (cmd === 'plan' || cmd === 'dry-run') {
    const path = flag('--prereg');
    const of = flag('--replication-of');
    if (has('--replication-of')) {
      if (has('--prereg')) throw new RunnerError('HE-REPL-001', '--prereg and --replication-of were both given; a replication plans from the registered prereg.json of the run it names. fix: drop --prereg');
      if (!of || of.startsWith('--')) throw new RunnerError('HE-REPL-001', '--replication-of needs the run id of a registered held-out run; fix: --replication-of <run id> --cells <id,id> --reps <n> --run-id <new id>');
    } else {
      const stray = ['--cells', '--reps', '--run-id'].filter(has);
      if (stray.length) throw new RunnerError('HE-REPL-001', `${stray.join(', ')} ${stray.length > 1 ? 'belong' : 'belongs'} to --replication-of; plan otherwise runs every cell of --prereg as preregistered. fix: add --replication-of <run id>, or drop ${stray.join(', ')}`);
      if (!path) throw new RunnerError('HE-RUN-002', 'missing --prereg <file>');
    }
    const replication = of ? planReplication({ root: process.cwd(), of, cells: flag('--cells'), reps: flag('--reps'), runId: flag('--run-id'), load: loadPrereg }) : undefined;
    const { prereg, sha256 } = replication ?? loadPrereg(path!);
    const heldout = replication ? replication.lines : checkPlan(prereg, sha256, process.cwd());
    const sealedSets = sealedSetsOf(prereg.cells);
    if (sealedSets.length > 1) throw new RunnerError('HE-SEALED-001', `run ${prereg.run_id} runs held-out cells of more than one sealed set (${sealedSets.join(', ')}); one run opens one set`);
    const sealed = sealedSets.length ? openSealedContext({ sealedRoot: flag('--sealed-root'), receiptPath: flag('--opening-receipt'), set: sealedSets[0]!, runId: prereg.run_id, preregSha: sha256, candidate: prereg.heldout?.candidate_sha256, label: prereg.heldout?.label }) : undefined;
    if (!sealed && (flag('--sealed-root') || flag('--opening-receipt'))) console.log('SEALED: no held-out cell of a sealed set in this preregistration; --sealed-root and --opening-receipt are ignored');
    const planOut = resolve(flag('--out') ?? join('results', prereg.run_id));
    if (sealed && cmd === 'plan' && insideGitTree(planOut)) throw new RunnerError('HE-SEALED-002', `--out ${planOut} is inside a git work tree; a sealed run's raw results stay outside every checkout until release (pass --out <a directory outside the checkout>)`);
    // The guard goes up before buildManifest reads the sealed task tree, so a refusal that names a task path is redacted too.
    if (sealed) installSealedGuard(sealed, cmd === 'plan' ? join(planOut, 'sealed-console.log') : join(sealed.root, 'logs', 'dry-run.log'), cmd);
    const manifest = buildManifest(prereg, sha256, undefined, sealed ? { sealedRoot: sealed.root, sealedSet: sealed.set } : {});
    if (sealed) manifest.sealed = { set: sealed.set, receipt_sha256: sealed.receipt_sha256, receipt: sealed.receipt };
    if (replication) manifest.replication_of = replication.replication_of;
    console.log(renderPlan(manifest));
    for (const line of heldout) console.log(line);
    if (sealed) console.log(`SEALED: set ${sealed.set} opened for run ${prereg.run_id} (receipt ${sealed.receipt_sha256.slice(0, 12)}, bundle ${sealed.receipt.bundle_sha256.slice(0, 12)}, tree ${sealed.receipt.tree_sha256.slice(0, 12)}, world ${String(sealed.receipt.world_sha256).slice(0, 12)}); sealed cells read the root, task paths are stored relative to it`);
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
    // --cells scopes the checks to one shard's cells (its harness images, its gbrain configurations); the ladder's shards
    // each built only their own images and failed the whole-manifest preflight on the other harness's image (HE-ADAPTER-005).
    const scope = flag('--cells')?.split(',').map((s) => s.trim()).filter(Boolean);
    if (scope) {
      const known = new Set(loaded.cells.map((c) => c.id));
      const unknown = scope.filter((id) => !known.has(id));
      if (unknown.length) throw new RunnerError('HE-RUN-002', `--cells names ${unknown.join(', ')}, not in the manifest; the cells are ${[...known].join(', ')}`);
    }
    const m = scope ? { ...loaded, cells: loaded.cells.filter((c) => scope.includes(c.id)), trials: loaded.trials.filter((t) => scope.includes(t.cell)) } : loaded;
    if (scope) console.log(`PREFLIGHT: scope --cells ${scope.join(',')} (${m.trials.length} of ${loaded.trials.length} trials)`);
    const sealed = sealedContextFor(loaded, flag, runDir);
    if (sealed) installSealedGuard(sealed, join(runDir, 'sealed-console.log'), 'preflight');
    if (sealed) console.log(`SEALED: root and receipt match the manifest's opening (set ${sealed.set}, receipt ${sealed.receipt_sha256.slice(0, 12)}); the world probe reads world ${String(sealed.receipt.world_sha256).slice(0, 12)}`);
    const missing = m.cells.filter(c => c.harness !== 'scripted' && !existsSync(join('harnesses', c.harness, 'pin.json'))).map(c => c.harness);
    if (missing.length) throw new RunnerError('HE-PIN-001', `no harnesses/<name>/pin.json for: ${[...new Set(missing)].join(', ')}; fix: add the pin before any cell runs`);
    for (const c of m.cells) checkZeroConfig(c);
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) if (!process.env[k]) console.log(`WARN: HE-PROXY-001 ${k} is not set in this shell; the metering proxy needs it, harness containers never do`);
    requireParticleCells(m.cells.filter((c) => c.harness_mode !== 'scripted'));
    // A harness image built before an adapter edit silently runs the old adapter; compare the image's adapter with the checkout.
    const dockerCells = m.cells.filter((c) => c.harness !== 'scripted' && (c.harness_mode ?? 'docker') === 'docker' && !existsSync(join('harnesses', c.harness, 'compose.yaml')));
    for (const harness of [...new Set(dockerCells.map((c) => c.harness))]) {
      const image = flag('--image') ?? `harness-eval/${harness.replace(/^_/, '')}:dev`;
      const { adapterProvenance } = await import('./trial/provenance.ts');
      const p = await adapterProvenance(harness, image);
      console.log(`ADAPTER: ${harness} image ${image} (${p.image_id.slice(0, 19)}) carries adapter.sh ${p.image_sha256.slice(0, 12)}, the checkout's is ${p.checkout_sha256.slice(0, 12)}: match${p.files ? `; ${Object.keys(p.files).length} more files (zero.ts, pin.json, Dockerfile, config/) match` : ''}`);
    }
    const gbrainCells = m.cells.filter((c) => c.gbrain);
    if (gbrainCells.length) {
      const image = flag('--gbrain-image') ?? (sealed ? sealedImageTag(sealed.receipt) : DEFAULT_GBRAIN_IMAGE);
      const { gbrainImagePresent, gbrainImageCommit, gbrainImageInputs, imageCommitProblem, preregCommitProblem, installerHookProblem, probeGbrainImage, exportInstallView } = await import('./trial/gbrain.ts');
      if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present for cells ${gbrainCells.map((c) => c.id).join(', ')}; fix: scripts/build-gbrain-image.sh ${sealed ? '--sealed-root <the sealed root>' : `--tag ${image}`}`);
      // A sealed run needs the image built from its root; a run with no sealed root refuses an image built from one.
      const inputs = gbrainImageInputs(image);
      const imageProblem = sealed ? sealedImageProblem(image, inputs, sealed.receipt) : publicImageProblem(image, inputs);
      if (imageProblem) throw new RunnerError('HE-SEALED-005', imageProblem);
      if (sealed) console.log(`SEALED: gbrain image ${image} was built from the sealed world ${String(sealed.receipt.world_sha256).slice(0, 12)} and corpus ${String(sealed.receipt.heldout_corpus_sha256).slice(0, 12)}`);
      const pin = JSON.parse(readFileSync(join('gbrain', 'pin.json'), 'utf8')) as { gbrain: { commit: string }; surfaces: Record<string, { tools: number }>; embeddings: { model: string }; install?: { installer?: { turn_hook_expected?: boolean } } };
      // The image records the gbrain commit it was built from (/opt/sidecar/image.json); a counted run's cells, the told cells
      // with no install view included, run the pinned commit or not at all, and the run log says which.
      // scripts/gbrain-check.ts checks a candidate commit and passes it as --gbrain-commit; a counted run passes nothing and gets the pin.
      // internal-task: a preregistration that names gbrain_commit runs that commit in place of the pin, and any other image is HE-GBRAIN-016.
      const built = gbrainImageCommit(image);
      if (loaded.gbrain_commit) {
        const preregProblem = preregCommitProblem({ image, built, prereg: loaded.gbrain_commit, flag: flag('--gbrain-commit') });
        if (preregProblem) throw new RunnerError('HE-GBRAIN-016', preregProblem);
      } else {
        const commitProblem = imageCommitProblem({ image, built, pin: pin.gbrain.commit, flag: flag('--gbrain-commit') });
        if (commitProblem) throw new RunnerError('HE-GBRAIN-002', commitProblem);
      }
      console.log(`GBRAIN: image ${image} records gbrain ${built}${loaded.gbrain_commit ? ", the preregistration's gbrain_commit" : flag('--gbrain-commit') ? ' (--gbrain-commit)' : ', the pinned commit'}`);
      // One probe per distinct keyword configuration (surface, brain): the image serves /health and lists the pinned tool count.
      const keywordConfigs = new Map<string, Cell[]>();
      for (const c of gbrainCells) { const g = resolveGbrain(c.gbrain!); if (g.embeddings === 'off') keywordConfigs.set(`${g.surface}/${g.brain}`, [...(keywordConfigs.get(`${g.surface}/${g.brain}`) ?? []), c]); }
      for (const [label, cs] of keywordConfigs) {
        const g = resolveGbrain(cs[0]!.gbrain!);
        const probe = await probeGbrainImage(image, join(runDir, `preflight-gbrain-${g.surface}`), { surface: g.surface });
        const pinned = pin.surfaces[g.surface]?.tools;
        if (probe.tools.length !== pinned) throw new RunnerError('HE-GBRAIN-002', `image ${image} lists ${probe.tools.length} tools on the ${g.surface} surface, gbrain/pin.json pins ${pinned}; fix: rebuild the image at the pinned commit, or re-pin after a deliberate gbrain change`);
        console.log(`GBRAIN: image ${image} id=${probe.image_id} serves /health (gbrain ${probe.version ?? 'unknown'}, ready in ${probe.ready_ms} ms), ${probe.tools.length} tools on ${g.surface} (pin ${pinned}) for cells ${cs.map((c) => c.id).join(', ')} (${label})`);
      }
      // Each distinct embedded configuration is probed through the metering proxy under a small lease of its own:
      // one search must produce a forwarded /v1/embeddings line and no degraded stamp, else the semantic cells cannot run.
      const embeddedCells = gbrainCells.filter((c) => resolveGbrain(c.gbrain!).embeddings !== 'off');
      if (embeddedCells.length) {
        if (!process.env.OPENAI_API_KEY) throw new RunnerError('HE-PROXY-001', `cells ${embeddedCells.map((c) => c.id).join(', ')} have embeddings on and OPENAI_API_KEY is not set in this shell; the metering proxy needs it to forward the sidecar's embedding calls (the sidecar never sees it)`);
        const { RunProxy, isEmbeddingLine, trialToken } = await import('./trial/proxy.ts');
        const proxy = await RunProxy.start({ runId: `${m.run_id}-preflight`, runDir: join(runDir, 'preflight-proxy'), ledgerPath: flag('--ledger') ?? join(runDir, 'ledger.sqlite'), leaseUsd: 0.05, allowModels: [pin.embeddings.model], reachableFromContainers: true, newRun: true });
        try {
          for (const surface of [...new Set(embeddedCells.map((c) => resolveGbrain(c.gbrain!).surface))]) {
            const model = resolveGbrain(embeddedCells[0]!.gbrain!).embeddings as string;
            const key = `preflight-${surface}`;
            const preflightToken = trialToken(key);
            await proxy.bind('preflight', key, preflightToken);
            const probe = await probeGbrainImage(image, join(runDir, `preflight-gbrain-embedded-${surface}`), { surface, embeddings: model as 'openai:text-embedding-3-small', openaiBaseUrl: proxy.baseUrlFor('preflight', 'openai', true), proxyToken: preflightToken, searchQuery: 'renewal pricing discount' });
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
      // Every gbrain-docs and gbrain-installer cell's bundle view is exported from the image and verified before any trial mounts it.
      const docsViews = [...new Set(gbrainCells.map((c) => ({ c, install: resolveGbrain(c.gbrain!).install })).filter((x) => x.install !== 'mcp').map((x) => `${x.c.harness}|${x.c.split}|${x.install}`))];
      for (const v of docsViews) {
        const [harness, split, install] = v.split('|') as [string, 'dev' | 'heldout', 'gbrain-docs' | 'gbrain-installer'];
        const { installViewDir } = await import('./trial/trial.ts');
        const view = await exportInstallView(image, harness, split, installViewDir(runDir, harness, split, install), install);
        const hookProblem = installerHookProblem(view, pin, flag('--gbrain-commit'));
        if (hookProblem) throw new RunnerError('HE-GBRAIN-006', hookProblem);
        console.log(`GBRAIN: install bundle view ${view.harness}/${split} (${install}) exported and verified: ${view.files.length} files, ${view.skills} skills, view digest ${view.view_digest.slice(0, 12)}${view.context ? `, context ${view.context.kept_slugs.length} pages (${view.context.tokens ?? '?'} tokens)` : ''} (gbrain ${view.gbrain_commit.slice(0, 12)})`);
      }
      // A company brain is probed per split under the unscoped token and must list every page the build holds.
      // The member brain likewise, with its own page list, under member scope and live ingestion (its tokens checked).
      const companySplits = [...new Set(gbrainCells.filter((c) => c.gbrain!.brain === 'company').map((c) => c.split))];
      const memberSplits = [...new Set(gbrainCells.filter((c) => c.gbrain!.brain === 'member' && !c.gbrain!.access).map((c) => c.split))];
      // internal-task: an access-ruled member brain is checked by its own preflight below; its unscoped token reads only the public pages.
      const aclSplits = [...new Set(gbrainCells.filter((c) => c.gbrain!.access === 'rules').map((c) => c.split))];
      if (companySplits.length || memberSplits.length || aclSplits.length) {
        const { probeCompanyBrain, probeSourceGrants } = await import('./trial/gbrain.ts');
        const { companyPageList, memberPageList } = await import('../gbrain/build-brain.ts');
        const { worldAt, DEFAULT_WORLD_PATH } = await import('./trial/world.ts');
        const world = worldAt(sealed ? sealed.worldPath : DEFAULT_WORLD_PATH);
        // internal-task (the access-rules rerun): before any trial, keyless, for each split an access-ruled cell runs on: (a) every member
        // token is bound to exactly its member and public-only to nobody, (b) the rules give every page the world's reader set, (c) a
        // probe under each token the tap presents returns nothing outside that reader set. Any miss is HE-GBRAIN-002.
        for (const split of aclSplits) {
          const { probeAccessRules, accessRulesProblems, writeAccessPreflight } = await import('./trial/gbrain.ts');
          const { memberSources, tokenMembers } = await import('../gbrain/build-brain.ts');
          const pages = memberPageList(world, split);
          const expected = { pages: pages.map((p) => ({ page_slug: p.page_slug, source: p.source, readers: p.readers })), sources: memberSources(world, split, pages).map((s) => ({ id: s.id, readers: s.readers })), token_members: tokenMembers(world, split).map((mm) => mm.id) };
          const dir = join(runDir, `preflight-gbrain-acl-${split}`);
          const evidence = await probeAccessRules(image, split, dir, expected);
          const { problems, summary } = accessRulesProblems(evidence, expected);
          const record = join(runDir, `access-preflight-${split}.json`);
          writeAccessPreflight(record, { split, image, ok: !problems.length, summary, problems, evidence }, dir);
          if (problems.length) throw new RunnerError('HE-GBRAIN-002', `access=rules: the access-ruled member brain for ${split} in ${image} fails ${[...new Set(problems.map((p) => `(${p.check})`))].join(', ')}: ${problems.slice(0, 4).map((p) => `(${p.check}) ${p.what}`).join('; ')}${problems.length > 4 ? `; ${problems.length - 4} more in ${record}` : ''}`);
          console.log(`GBRAIN: access=rules split=${split} image ${image} id=${evidence.image_id}: (a) ${expected.token_members.length} member tokens each bound to its own member, public-only unbound; (b) ${summary.rules} folder rules over ${expected.sources.length - 1} sources, the public source none, nothing held or pending, ${summary.pages} pages each readable by exactly the world's reader set (who-can-read named every_source_reader for ${summary.rule_blind} rule-covered pages; it reads page readers only); (c) ${expected.token_members.length + 1} grants x ${SOURCE_PROBE_QUERIES.length} queries over search, query and recall plus list_pages to the end, ${summary.rows} rows (${Object.entries(summary.rows_by_tool).map(([t, n]) => `${t} ${n}`).join(', ')}), 0 outside the grant's reader set, every readable page listed; ${summary.slug_reads} get_page reads under the member tokens, every page outside the reader set refused and one inside it served; record ${record}`);
        }
        // gbrain#7481 and the member-sources scope, for the company brain; the member brain too, for a live-ingestion cell
        // under scope "member-sources" (two layers: the member's rescoped token and its source_ids).
        const probeScoped = async (brain: 'company' | 'member', split: 'dev' | 'heldout') => {
          // gbrain#7481: a scope "sources" cell needs the per-request source_ids to hold for every member before a paid trial.
          // A scope "member-sources" cell is probed under the member tokens as well, the way its tap sends calls.
          for (const scope of ['sources', 'member-sources'] as const) {
            if (!gbrainCells.some((c) => c.gbrain!.brain === brain && c.split === split && c.gbrain!.scope === scope)) continue;
            const s = await probeSourceGrants(image, split, join(runDir, `preflight-gbrain-${scope}-${split}${brain === 'company' ? '' : '-member'}`), SOURCE_PROBE_QUERIES, scope, brain);
            const notDenied = s.denied.filter((d) => d.code !== 'permission_denied');
            if (s.outside.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} returned ${s.outside.length} row(s) outside the requester's source grant under source_ids${scope === 'member-sources' ? ' with the member\'s own token, or under that token alone' : ''} (${s.outside.slice(0, 3).map((o) => `${o.member} ${o.tool} ${JSON.stringify(o.query)} -> ${o.slug} in ${o.source_id}`).join('; ')}); not holding at this commit: ${[...new Set(s.outside.map((o) => o.tool.endsWith('(token alone)') ? 'the rescoped member tokens' : 'gbrain\'s source_ids narrowing'))].join(' and ')}`);
            if (notDenied.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} answered a source_ids list naming a source no connection holds with ${notDenied.map((d) => `${d.code ?? 'rows'} for ${d.member}/${d.source_id}`).slice(0, 3).join(', ')} instead of permission_denied`);
            const unseen = Object.entries(s.rows_by_tool).filter(([, n]) => !n).map(([t]) => t);
            if (unseen.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} gave 0 rows to ${unseen.join(', ')} over every member; the probe cannot show the source_ids narrowing holds on ${unseen.length === 1 ? 'that tool' : 'those tools'}`);
            if (s.token_alone) {
              // The member token is the only guard on a slug read, so it is checked on its own as well.
              const leaked = s.token_alone.slug_reads.filter((r) => r.code === null || r.code.startsWith('another page'));
              if (leaked.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} returned ${leaked.length} page(s) through get_page under a member's own token from a source outside its grant (${leaked.slice(0, 3).map((r) => `${r.member} -> ${r.slug} in ${r.source_id}`).join('; ')}); the rescoped member tokens do not hold`);
              const unseenAlone = Object.entries(s.token_alone.rows_by_tool).filter(([, n]) => !n).map(([t]) => t);
              const unreadable = s.token_alone.slug_reads.filter((r) => r.unscoped_code !== null);
              if (unreadable.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} did not serve the slug outside the member's grant under the unscoped token either (${unreadable.slice(0, 3).map((r) => `${r.member} -> ${r.slug} in ${r.source_id}: ${r.unscoped_code}`).join('; ')}); the member token's refusal of it shows nothing`);
              const ownRefused = s.token_alone.slug_reads.filter((r) => r.own_code !== null);
              if (ownRefused.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} refused get_page of a page inside the member's own grant (${ownRefused.slice(0, 3).map((r) => `${r.member} -> ${r.own_slug ?? '-'}: ${r.own_code}`).join('; ')}); the refusals outside the grant cannot be told from a broken read`);
              if (unseenAlone.length || !s.token_alone.slug_reads.length) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} gave ${unseenAlone.length ? `0 rows to ${unseenAlone.join(', ')} under the member tokens alone` : 'no slug outside any member\'s grant to read'}; the probe cannot show the token layer holds`);
            }
            if (!s.rows || !s.differs) throw new RunnerError('HE-GBRAIN-002', `scope=${scope}: the ${brain} brain for ${split} in ${image} gave ${s.rows} row(s) over ${s.calls} scoped calls${s.rows && !s.differs ? ' and the same sources to every member' : ''}; the source_ids narrowing is not observable`);
            console.log(`GBRAIN: scope=${scope}${brain === 'company' ? '' : ' brain=member'} split=${split}: ${s.members} members x ${SOURCE_PROBE_QUERIES.length} queries over search, query and recall, plus list_pages once per member${scope === 'member-sources' ? ' under each member\'s token (paged to the end under the token alone)' : ''}; ${s.calls} calls in all,${scope === 'member-sources' ? ' with the token-alone repeats and get_page reads,' : ''} ${s.rows} rows (${Object.entries(s.rows_by_tool).map(([t, n]) => `${t} ${n}`).join(', ')}) over ${s.sources_seen} sources, 0 outside the requester's grant; ${s.denied.length} unknown source ids all permission_denied; a federated source outside the member's grant answers rows under the unscoped token in ${s.foreign.filter((f) => f.rows_from_it).length} of ${s.foreign.length} members (gbrain checks the connection's grant, the tap enforces the member's); the narrowing differs between members${s.token_alone ? `; under the member tokens alone (no source_ids) ${Object.entries(s.token_alone.rows_by_tool).map(([t, n]) => `${t} ${n}`).join(', ')} rows, 0 outside the grant, and ${s.token_alone.slug_reads.length} get_page reads of a page outside the member's grant all refused under the member's token and served under the unscoped token, while a page inside the grant was served` : ''}`);
          }
        };
        for (const split of memberSplits) {
          const probe = await probeCompanyBrain(image, split, memberPageList(world, split), join(runDir, `preflight-gbrain-member-${split}`), 'member', 'member');
          console.log(`GBRAIN: image ${image} id=${probe.image_id} brain=member scope=member ingest=live split=${split} pages=${probe.listed} (${Object.entries(probe.by_kind).map(([k, v]) => `${k} ${v}`).join(', ')}) under the unscoped token, tokens=${probe.member_tokens} plus public-only: ${probe.member_check}, channel ingest tokens present (no write is tried), ready in ${probe.ready_ms} ms`);
          await probeScoped('member', split);
        }
        for (const split of companySplits) {
          const scope = gbrainCells.some((c) => c.gbrain!.brain === 'company' && c.split === split && (c.gbrain!.scope === 'member' || c.gbrain!.scope === 'member-sources')) ? 'member' : 'none';
          const probe = await probeCompanyBrain(image, split, companyPageList(world, split), join(runDir, `preflight-gbrain-company-${split}`), scope);
          console.log(`GBRAIN: image ${image} id=${probe.image_id} brain=company scope=${scope} split=${split} pages=${probe.listed} (${Object.entries(probe.by_kind).map(([k, v]) => `${k} ${v}`).join(', ')}) under the unscoped token${scope === 'member' ? `, tokens=${probe.member_tokens} plus public-only: ${probe.member_check}` : ''}, ready in ${probe.ready_ms} ms`);
          await probeScoped('company', split);
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
    // Live ingestion is docker-only (HE-GBRAIN-001). The mode is this flag, not a cell field, so it is refused here
    // before any trial starts rather than aborting the run at its first such trial.
    const cells = flag('--cells')?.split(',').map((s) => s.trim()).filter(Boolean);
    const liveCells = manifest.cells.filter((c) => c.gbrain?.ingest === 'live' && (cells ? cells.includes(c.id) : true)).map((c) => c.id);
    if (mode === 'process' && liveCells.length) throw new RunnerError('HE-GBRAIN-001', `cells ${liveCells.join(', ')} carry gbrain.ingest "live", which runs in docker mode only; in process mode the harness runs as the runner's user and could read the ingest tokens under the trial directory. fix: run without --harness-mode process`);
    // internal-task: a pi-memory-provider cell is docker-only too; in process mode core gets no MEMORY_PROVIDER_CONFIG and the cell
    // registers no gbrain MCP server, so the trial would run with no gbrain at all.
    const providerCells = manifest.cells.filter((c) => isQmMemoryProvider(c) && (cells ? cells.includes(c.id) : true)).map((c) => c.id);
    if (mode === 'process' && providerCells.length) throw new RunnerError('HE-GBRAIN-001', `cells ${providerCells.join(', ')} use config "${MEMORY_PROVIDER_CONFIG_NAME}", which runs in docker mode only; in process mode QM core gets no MEMORY_PROVIDER_CONFIG and the trial has no gbrain. fix: run with --harness-mode docker`);
    const sealedRunCells = manifest.sealed ? manifest.cells.filter((c) => c.harness_mode !== 'scripted' && (cells ? cells.includes(c.id) : true)).map((c) => c.id) : [];
    if (mode === 'process' && sealedRunCells.length) throw new RunnerError('HE-SEALED-001', `cells ${sealedRunCells.join(', ')} belong to run ${manifest.run_id}, which opens set ${manifest.sealed!.set} in sealed custody; in process mode the harness runs as the runner's user and could read the opened sealed root and the custody files on this machine, whichever cell it serves. Nothing was opened. fix: run without --harness-mode process`);
    // Capture mode, refused before anything starts unless the run id is a capture run's.
    const { parseCaptureOptions } = await import('./trial/capture.ts');
    const callingCells = manifest.cells.filter((c) => c.harness_mode !== 'scripted' && mode !== 'scripted' && (cells ? cells.includes(c.id) : true));
    const providers = callingCells.flatMap((c) => [c.model, ...(c.utility_models ?? []), c.gbrain?.embeddings ?? 'off']).filter((m) => m.includes(':')).map((m) => m.slice(0, m.indexOf(':')));
    const capture = parseCaptureOptions({ runId: manifest.run_id, upstream: all('--capture-upstream'), dns: has('--capture-dns') ? (flag('--capture-dns') ?? '') : undefined, providers }) ?? undefined;
    requireParticleCells(callingCells);
    const sealed = sealedContextFor(manifest, flag, dirname(path));
    if (sealed) installSealedGuard(sealed, join(dirname(path), 'sealed-console.log'), 'run');
    // A sealed run's trials default to the sealed image tag, and run repeats preflight's image check (HE-SEALED-005).
    const gbrainImage = flag('--gbrain-image') ?? (sealed ? sealedImageTag(sealed.receipt) : undefined);
    if (manifest.cells.some((c) => c.gbrain && (cells ? cells.includes(c.id) : true))) {
      const { gbrainImageCommit, gbrainImageInputs, gbrainImagePresent, preregCommitProblem } = await import('./trial/gbrain.ts');
      const image = gbrainImage ?? DEFAULT_GBRAIN_IMAGE;
      const problem = sealed ? sealedImageProblem(image, gbrainImageInputs(image), sealed.receipt) : gbrainImagePresent(image) ? publicImageProblem(image, gbrainImageInputs(image)) : null;
      if (problem) throw new RunnerError('HE-SEALED-005', problem);
      // internal-task: run repeats preflight's check of the preregistration's gbrain_commit; an image it cannot read counts as another commit.
      if (manifest.gbrain_commit) {
        const preregProblem = preregCommitProblem({ image, built: gbrainImageCommit(image), prereg: manifest.gbrain_commit });
        if (preregProblem) throw new RunnerError('HE-GBRAIN-016', preregProblem);
        console.log(`GBRAIN: image ${image} records gbrain ${manifest.gbrain_commit}, the preregistration's gbrain_commit`);
      }
      // internal-task: an access-ruled cell runs only on the image its access preflight passed on; a resume that rebuilt the image does not.
      const aclSplits = [...new Set(manifest.cells.filter((c) => c.gbrain?.access === 'rules' && (cells ? cells.includes(c.id) : true)).map((c) => c.split))];
      if (aclSplits.length) {
        const { accessPreflightProblem } = await import('./trial/gbrain.ts');
        const imageId = spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', image], { encoding: 'utf8' }).stdout?.trim() ?? '';
        for (const split of aclSplits) {
          const problem = accessPreflightProblem(join(dirname(path), `access-preflight-${split}.json`), split, image, imageId);
          if (problem) throw new RunnerError('HE-GBRAIN-002', problem);
        }
        console.log(`GBRAIN: access=rules ${aclSplits.join(', ')}: the access preflight passed on image id ${imageId}, the image this run uses`);
      }
    }
    const { executeRun } = await import('./trial/run.ts');
    const result = await executeRun(manifest, path, {
      ...(sealed ? { worldPath: sealed.worldPath, sealedRoot: sealed.root, sealedSet: sealed.set } : {}),
      harnessMode: mode as HarnessMode, adapter: flag('--adapter'), image: flag('--image'), gbrainImage, resume: has('--resume'), stopOnCap: has('--stop-on-cap'),
      cells, ledgerPath: flag('--ledger'), leaseUsd: flag('--lease-usd') ? Number(flag('--lease-usd')) : undefined,
      newLease: has('--new-lease'), maxOutputTokens: flag('--max-output-tokens') ? Number(flag('--max-output-tokens')) : undefined, preamblePath: flag('--preamble'),
      readyTimeoutS: flag('--ready-timeout-s') ? Number(flag('--ready-timeout-s')) : undefined, turnGraceS: flag('--turn-grace-s') ? Number(flag('--turn-grace-s')) : undefined,
      harnessEnv, capture, log: sealed ? sealedProgress() : (line) => console.log(line),
    });
    return result.exit;
  }
  throw new RunnerError('HE-RUN-002', 'usage: bun runner/run.ts plan|dry-run --prereg <file> | plan|dry-run --replication-of <run id> --cells <id,id> --reps <n> --run-id <new id> | preflight --manifest <file> | run --manifest <file> [options] [--sealed-root <dir> --opening-receipt <file>]');
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  });
}
