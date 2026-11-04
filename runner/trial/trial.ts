// One multi-user trial, start to finish: the world, the proxy slot, the gbrain sidecar when the cell carries
// gbrain, the harness, the turn loop, the fence and snapshot, teardown, the usage meter, classification and
// grading. Everything it writes lands under results/<run>/trials/<cell>/<task>/[<script>/]r<n>/ (the paths
// field of the trials.jsonl line).
//
// The install ladder: the trial directory is emptied before the world starts, so a rerun under --resume
// never appends to an earlier events.jsonl; the sidecar gets the cell's surface and embeddings (and the proxy slot as
// OPENAI_BASE_URL for an embedded brain); a gbrain-docs or gbrain-installer cell has its install bundle view verified
// (HE-GBRAIN-006) and mounted read-only at /he-gbrain-install with HE_GBRAIN_INSTALL naming the kind for the adapter; a sidecar or bundle
// failure is the trial's infra_error, not the run's; and after the meter is read, a trial with embeddings on that
// searched the brain must show a forwarded embedding line and no degraded stamp, else it is infra_error under
// HE-GBRAIN-005 and excluded from its rung.
//
// QM pi-memory-provider (harnesses/qm/memory-provider.ts): a QM cell with config pi-memory-provider gets a per-trial
// OAuth client pair, MEMORY_PROVIDER_CONFIG naming the world's /gbrain tap in its core service's environment, the provider block
// on the gbrain upstream, and no HE_GBRAIN_MCP_* variables, so gbrain is never registered as a model-callable MCP server.
//
// A cell that carries ablation binds its slot with the layer map (path resolved from the repository root),
// and after the meter is read the trial's receipts are copied to <trial dir>/ablation.ndjson and summarized into the
// record's ablation field. The filter's outcome never changes the termination: the primary analysis is intention to treat.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GradeResult, HarnessMode, Termination, TrialAblation, TrialEvidence, TrialEmbeddingUsage, TrialGbrain, TrialGbrainInstall, TrialRecord, TrialUsage, TurnWindow } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { cellModels, taskDirFor, resolveGbrain, type Cell, type ResolvedGbrain, type Trial } from '../run.ts';
import type { WorldEvent } from '../../world/services/events.ts';
import type { World } from '../../world/types.ts';
import { loadScript, startScriptedHarness } from '../scripted/executor.ts';
import { type InternalNetwork, startComposeHarness, startDockerHarness } from './docker.ts';
import { type GbrainSidecar, type InstallViewManifest, checkCompanyGrants, checkCompanyTokens, checkIngestTokens, exportInstallView, startGbrainSidecar, verifyInstallView } from './gbrain.ts';
import { GBRAIN_WRITE_TOOLS, type GbrainUpstream } from '../../world/services/gbrain-tap.ts';
import { isQmMemoryProvider, memoryProviderWiring, type QmProviderBlock, type QmProviderWiring } from '../../harnesses/qm/memory-provider.ts';
import { canReadFile } from '../grade/predicates.ts';
import { HarnessGone, type Harness, makeTrialDirs, startProcessHarness, writeAtomic } from './harness.ts';
import { RunProxy, embeddingUsage, reconcile, summarizeAblation, summarizeUsage, trialKey, trialSlug, trialToken } from './proxy.ts';
import { wireOfModel } from '../proxy/ablate.ts';
import { loadTask, type TaskSpec } from './task.ts';
import { flushIngestAfterFence, runTurns } from './turns.ts';
import { TrialWorld, worldAt } from './world.ts';

/** Where preflight exports each gbrain-docs cell's bundle view, and where the trial reads it. */
export const installViewDir = (runDir: string, harness: string, split: 'dev' | 'heldout', install: 'gbrain-docs' | 'gbrain-installer' = 'gbrain-docs') =>
  join(runDir, 'gbrain-install', install === 'gbrain-installer' ? `${harness.replace(/^_/, '')}-installer` : harness.replace(/^_/, ''), split);

/** Issue #153: for each turn, the gbrain_turn_hook_runs the Claude Code or Codex adapter wrote into
 *  <logs>/turns/turn-NNNN.status.json (how many times the harness fired gbrain's UserPromptSubmit hook in that turn), null when the
 *  file or the field is missing. When ready says "ran", the trial reads each turn as soon as the adapter answers it, before the next
 *  turn starts (so a later turn cannot rewrite an earlier count in the writable logs directory), and records the list as
 *  install_bundle.turn_hook.turn_runs. A turn the adapter never answered (the runner's own timeout, or the harness gone) is not in
 *  it, and neither is a turn the adapter answered with exit 2 (a harness failure, which can come before the CLI ever got the
 *  prompt): the trial keeps its scored termination, as the same failure does in the base cell. */
export const turnHookRuns = (logsDir: string, turns: number[]): Array<number | null> => turns.map((turn) => {
  try {
    const n = (JSON.parse(readFileSync(join(logsDir, 'turns', `turn-${String(turn).padStart(4, '0')}.status.json`), 'utf8')) as { gbrain_turn_hook_runs?: unknown }).gbrain_turn_hook_runs;
    return typeof n === 'number' ? n : null;
  } catch { return null; }
});

/** Issue #193: record one answered turn's hook count and its turn number, unless the adapter answered with exit 2 (left out as
 *  above), so turn_hook.turns names the turn of each turn_runs entry. */
export function noteAnsweredTurn(acc: { turn_runs: Array<number | null>; turns: number[] }, logsDir: string, turn: number, exit: number): void {
  if (exit === 2) return;
  acc.turn_runs.push(...turnHookRuns(logsDir, [turn]));
  acc.turns.push(turn);
}

/** The Hermes compiled context names pages; count, per actor of the task, the ones that actor cannot read in the world
 *  (a chat page's channel the actor is not in; a file the file rule denies). What reaches the model with no gbrain call. */
export function contextExposure(world: World, split: 'dev' | 'heldout', keptSlugs: string[], actors: string[]): NonNullable<TrialGbrainInstall['context']> {
  const byActor: Record<string, number> = {};
  for (const actor of actors) {
    const member = world.members.find((m) => m.id === actor);
    let outside = 0;
    for (const slug of keptSlugs) {
      const bare = slug.startsWith(`${split}/`) ? slug.slice(split.length + 1) : slug;
      const channel = world.channels.find((c) => c.source_slugs.includes(bare));
      if (channel) { if (!channel.members.includes(actor)) outside += 1; continue; }
      const file = world.files.find((f) => f.slug === bare);
      if (file) { if (!member || !canReadFile(member, file)) outside += 1; continue; }
      outside += 1;
    }
    byActor[actor] = outside;
  }
  return { kept_slugs: keptSlugs.length, outside_scope_by_actor: byActor, outside_scope_max: Math.max(0, ...Object.values(byActor)) };
}

export type GradeFn = (evidence: TrialEvidence) => GradeResult | Promise<GradeResult>;

export interface TrialOptions {
  harnessMode: HarnessMode;
  /** process mode: the adapter script to run. */
  adapter?: string;
  /** docker mode: image override (default harness-eval/<harness>:dev). */
  image?: string;
  /** gbrain cells: the sidecar image (default harness-eval/gbrain:dev); independent of the harness image. */
  gbrainImage?: string;
  preamble: string;
  worldPath?: string;
  readyTimeoutS: number;
  turnGraceS: number;
  stopGraceS: number;
  /** Extra environment for the harness (process and docker), for debugging a harness; never a key. */
  harnessEnv?: Record<string, string>;
  /** Capture mode: the in-container harness's DNS server (docker run --dns); compose and process harnesses ignore it. */
  captureDns?: string;
  repoRoot?: string;
  /** The run's internal network, which executeRun creates when a cell has network "internal". */
  network?: InternalNetwork;
}

export interface TrialContext {
  cell: Cell;
  trial: Trial;
  runDir: string;
  trialDir: string;
  proxy: RunProxy | null;
  grade: GradeFn;
  opts: TrialOptions;
  log: (line: string) => void;
}

const GRADER_PATH = '../grade/index.ts';

/** Lane B's gradeTrial, resolved at run time so the runner typechecks and tests run before the grader lands. */
export async function loadGrader(): Promise<GradeFn> {
  const modulePath = GRADER_PATH;
  let mod: { gradeTrial?: GradeFn };
  try { mod = await import(modulePath) as { gradeTrial?: GradeFn }; }
  catch (e) { throw new RunnerError('HE-GRADE-001', `runner/grade/index.ts cannot be loaded (${(e as Error).message.split('\n')[0]}); fix: land the grader (docs/tasks.md predicate library) exporting gradeTrial(evidence)`); }
  if (typeof mod.gradeTrial !== 'function') throw new RunnerError('HE-GRADE-001', 'runner/grade/index.ts does not export gradeTrial(evidence); fix: export it (runner/contracts.ts TrialEvidence -> GradeResult)');
  return mod.gradeTrial;
}

export function classify(exits: number[], readyFailure: HarnessGone | null, endedEarly: string | null, approvalStop: boolean): Termination {
  if (readyFailure) return readyFailure.exit === 2 ? 'harness_error' : readyFailure.exit === 3 ? 'model_error' : 'infra_error';
  if (endedEarly === 'exam_fault') return 'exam_fault';
  if (exits.some((e) => e === 124)) return 'timeout';
  if (exits.some((e) => e === 3)) return 'model_error';
  if (exits.some((e) => e === 2)) return 'harness_error';
  if (exits.some((e) => e !== 0)) return 'infra_error';
  return approvalStop ? 'approval_stop' : 'completed';
}

const EMPTY_GRADE: GradeResult = { grade: 'n/a', predicates: [], consent_violation: false, approval_stop: false, effects: [] };

/** The model the harness actually ran against the cell's. A forwarded request on another model, or a
 *  refused line that names another model (the proxy's allowlist refusal carries the model; QM's claude harness, removed
 *  at b6786d67, fell back to its default model in silence when CLAUDE_MODEL was not supported), is HE-MODEL-001; the message lists them.
 *  Refused lines with no model (a route the proxy does not admit) are counted in usage.refused and never fail a trial.
 *  Amendment 1 to gbrain-ladder-2026-10 (2026-10-25): on an embedded rung the gbrain sidecar embeds each query through the same slot, so the
 *  cell's declared embedding model is the trial's own and is never foreign; it is reported apart in gbrain.embedding_usage.
 *  Amendment 2 to v02-heldout-2026-10 (2026-10-25): a cell may preregister utility_models, the models its harness is
 *  documented to call for its own housekeeping (QM's and OpenClaw's Haiku request per turn); those are the trial's own too,
 *  forwarded when the allowlist admits them and priced into the trial (usage.by_model shows them). */
export function foreignModels(cellModel: string, byModel: Record<string, unknown>, lines: Array<{ outcome: string; model: string | null; provider: string }>, embeddingModel: string = 'off', utilityModels: readonly string[] = []): string[] {
  const own = new Set([cellModel.toLowerCase(), embeddingModel.toLowerCase(), ...utilityModels.map((m) => m.toLowerCase())]);
  const seen = new Set<string>();
  for (const k of Object.keys(byModel)) if (!own.has(k.toLowerCase())) seen.add(k);
  for (const l of lines) if (l.outcome === 'refused' && l.model && !own.has(`${l.provider}:${l.model}`.toLowerCase())) seen.add(`${l.provider}:${l.model}`);
  return [...seen].sort();
}

export async function runTrial(ctx: TrialContext): Promise<TrialRecord> {
  const { cell, trial, opts, log } = ctx;
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  // A rerun (--resume after an interruption) starts from an empty trial directory: events.jsonl, turns and logs are never appended to twice.
  if (existsSync(ctx.trialDir)) for (const e of readdirSync(ctx.trialDir)) rmSync(join(ctx.trialDir, e), { recursive: true, force: true });
  const dirs = makeTrialDirs(ctx.trialDir);
  const task: TaskSpec = loadTask(trial.task_dir ?? taskDirFor(cell, trial.task));
  const mode: HarnessMode = cell.harness_mode === 'scripted' ? 'scripted' : opts.harnessMode;
  const docker = mode === 'docker';
  const key = trialKey(trial.id);
  const token = trialToken(trial.id);
  const slot = trialSlug(trial.id);
  // The gbrain sidecar calls the proxy through its own slot, bound to the same key with its own random token (the harness
  // never sees it), so its embeddings stay attributed to the trial and neither container can spend through the other's slot.
  const gbrainSlot = `${slot}.gbrain`;
  const gbrainToken = trialToken(trial.id);
  const [provider, modelName] = cell.model.includes(':') ? [cell.model.slice(0, cell.model.indexOf(':')), cell.model.slice(cell.model.indexOf(':') + 1)] : ['none', cell.model];

  if (cell.gbrain && mode === 'scripted') throw new RunnerError('HE-GBRAIN-001', `cell ${cell.id} carries gbrain but runs scripted; a script has no harness to call the brain. fix: drop gbrain from the cell or run it in docker or process mode`);
  // A process-mode harness runs as the runner's user beside the trial directory, so it could read the per-source ingest
  // tokens and write every member's private source directly, past the tap; the member brain's tokens stay docker-only.
  if (cell.gbrain?.ingest === 'live' && mode === 'process') throw new RunnerError('HE-GBRAIN-001', `cell ${cell.id} carries gbrain.ingest "live" but runs in process mode; the ingest tokens under the trial directory would be readable by the harness process. fix: run the cell in docker mode`);
  // An internal cell's world, sidecar and harness container use the run's internal network and its gateway.
  if (cell.network === 'internal' && (!docker || !opts.network)) throw new RunnerError('HE-NET-001', `cell ${cell.id} has network "internal" but the trial ${docker ? 'was given no internal network' : `runs in ${mode} mode`}; fix: run it through executeRun in docker mode`);
  const network = cell.network === 'internal' ? opts.network : undefined;
  const world = new TrialWorld({ trialId: trial.id, split: cell.split, actors: task.actors, outDir: dirs.root, worldPath: opts.worldPath, reachableFromContainers: docker, ...(network ? { gatewayAddress: network.gateway } : {}) });
  log(`world for ${trial.id} at ${world.localUrl} (harness sees ${world.harnessUrl}); ${task.turns.length} turns, budget ${task.time_budget_s} s per turn`);
  const proxy = mode === 'scripted' ? null : ctx.proxy;

  // The gbrain sidecar starts before the harness so the tap is live by the time the harness registers it;
  // it is stopped after the world is fenced, so a late call cannot land in the brain unrecorded. A sidecar that does not
  // come up, or a bundle view that does not verify, is this trial's infra_error (HE-GBRAIN-002, HE-GBRAIN-006); the run goes on.
  let sidecar: GbrainSidecar | null = null;
  let infraError: string | null = null;
  const gbrain: ResolvedGbrain | null = cell.gbrain ? resolveGbrain(cell.gbrain) : null;
  let installView: InstallViewManifest | null = null;
  const memoryProvider = isQmMemoryProvider(cell);
  let providerWiring: QmProviderWiring | null = null;
  if (cell.gbrain && gbrain) {
    try {
      if (gbrain.embeddings !== 'off' && !proxy) throw new RunnerError('HE-GBRAIN-005', `cell ${cell.id} has embeddings ${gbrain.embeddings} but the trial runs without a metering proxy; the sidecar's embedding calls must be metered`);
      // The sidecar slot exists only while an embedded brain needs it; a keyword brain makes no provider call and gets no slot.
      if (gbrain.embeddings !== 'off') await proxy!.bind(gbrainSlot, key, gbrainToken, [gbrain.embeddings]);
      sidecar = await startGbrainSidecar({ trialId: trial.id, trialSlug: slot, split: cell.split, outDir: join(dirs.root, 'gbrain'), image: opts.gbrainImage, brain: gbrain.brain, scope: gbrain.scope, ingest: gbrain.ingest, ...(gbrain.access ? { access: gbrain.access } : {}),
        surface: gbrain.surface, embeddings: gbrain.embeddings, ...(gbrain.embeddings !== 'off' ? { openaiBaseUrl: proxy!.baseUrlFor(gbrainSlot, 'openai', true), proxyToken: gbrainToken } : {}), ...(network ? { network } : {}), log });
      // Under member scope the tap needs a granted token for every member who will take a turn (HE-GBRAIN-004).
      if (sidecar.scope === 'member' || sidecar.scope === 'member-sources') checkCompanyTokens(sidecar.tokens, cell.split, task.actors, join(dirs.root, 'gbrain', 'tokens.json'));
      // gbrain#7481: under scope "sources" the tap needs a source grant for every member who will take a turn (HE-GBRAIN-004).
      if (sidecar.scope === 'sources' || sidecar.scope === 'member-sources') checkCompanyGrants(JSON.parse(readFileSync(join(dirs.root, 'gbrain', 'manifest.json'), 'utf8')), cell.split, task.actors, join(dirs.root, 'gbrain', 'manifest.json'));
      // Under live ingestion every actor's DM source and every channel source needs an ingest token (HE-GBRAIN-004).
      if (sidecar.ingest) checkIngestTokens(sidecar.ingest.tokens, JSON.parse(readFileSync(join(dirs.root, 'gbrain', 'manifest.json'), 'utf8')), cell.split, task.actors, join(dirs.root, 'gbrain', 'ingest-tokens.json'));
      if (gbrain.install !== 'mcp') {
        const viewDir = installViewDir(ctx.runDir, cell.harness, cell.split, gbrain.install);
        installView = existsSync(join(viewDir, 'manifest.json'))
          ? verifyInstallView(JSON.parse(readFileSync(join(viewDir, 'manifest.json'), 'utf8')) as InstallViewManifest, viewDir, gbrain.install)
          : await exportInstallView(sidecar.image, cell.harness, cell.split, viewDir, gbrain.install);
        log(`install bundle view ${installView.harness}/${installView.split} (${gbrain.install}) verified (${installView.files.length} files, view digest ${installView.view_digest.slice(0, 12)}) at ${viewDir}`);
      }
    } catch (e) {
      if (!(e instanceof RunnerError)) { if (sidecar) await sidecar.stop(5_000).catch(() => undefined); if (proxy) { await proxy.finalize(key).catch(() => undefined); await proxy.unbind(slot).catch(() => undefined); await proxy.unbind(gbrainSlot).catch(() => undefined); } world.stop(); throw e; }
      infraError = e.message;
      log(infraError);
    }
    if (sidecar && !infraError) {
      if (memoryProvider) {
        providerWiring = memoryProviderWiring({ mcpUrl: `${world.harnessUrl}/gbrain`, actor: world.botMember.id });
        log(`QM memory provider: MEMORY_PROVIDER_CONFIG ${JSON.stringify(providerWiring.config)}; client ${Object.keys(providerWiring.provider.clients).join(', ')} acting as ${providerWiring.provider.actor} (secret per trial, never written); no gbrain MCP server is registered`);
      }
      world.server.setGbrain(gbrainUpstream(sidecar, providerWiring?.provider));
    }
  }
  const installKind = installView ? (installView.install ?? 'gbrain-docs') : null;
  const installViewPath = installKind ? installViewDir(ctx.runDir, cell.harness, cell.split, installKind) : null;

  const env: Record<string, string> = {
    HE_MODEL_BASE_URL: proxy ? proxy.baseUrlFor(slot, provider, docker) : 'http://127.0.0.1:1/none',
    HE_MODEL_API_KEY: token,
    HE_MODEL_NAME: modelName,
    HE_TIME_BUDGET_S: String(task.time_budget_s),
    HE_LOG_DIR: docker ? '/he-logs' : resolve(dirs.logs),
    HE_SESSION_STATE_DIR: docker ? '/harness-state' : resolve(dirs.state),
    ...(cell.session_scope ? { HE_SESSION_SCOPE: cell.session_scope } : {}),
    ...(cell.config ? { HE_HARNESS_CONFIG: cell.config } : {}),
    HE_TASK_SLICE: 'multiuser',
    HE_TRIAL_ID: trial.id,
    HE_TURNS_DIR: docker ? '/he-turns' : resolve(dirs.turns),
    HE_WORLD_MCP_URL: `${world.harnessUrl}/mcp`,
    HE_WORLD_MCP_TOKEN: world.botToken,
    HE_SLACK_API_URL: world.config.slack.api_url,
    HE_SLACK_BOT_TOKEN: world.botToken,
    HE_SLACK_APP_TOKEN: world.config.slack.bot.app_token,
    ...gbrainHarnessEnv(sidecar, world.harnessUrl, world.botToken, memoryProvider),
    // The adapter copies the bundle view into /workspace before the first turn (docs/adapters.md); unset, nothing changes.
    ...(installViewPath && installKind ? { HE_GBRAIN_INSTALL: installKind, HE_GBRAIN_SPLIT: cell.split, HE_GBRAIN_INSTALL_DIR: docker ? '/he-gbrain-install' : resolve(installViewPath) } : {}),
    ...(docker ? {} : { HE_WORKSPACE_DIR: resolve(dirs.workspace) }),
    ...(opts.harnessEnv ?? {}),
  };

  let harness: Harness | null = null;
  let readyFailure: HarnessGone | null = null;
  let readyTurnHook = 'no ready file';
  let windows: TurnWindow[] = [];
  let endedEarly: string | null = null;
  const answeredHook: { turn_runs: Array<number | null>; turns: number[] } = { turn_runs: [], turns: [] };
  let error: string | undefined;
  let grade: GradeResult = EMPTY_GRADE;
  let usage: TrialUsage | null = null;
  let ablation: TrialAblation | undefined;
  let capStop = false;
  let modelMismatch = false;
  const paths: Record<string, string> = { dir: dirs.root, trial_json: join(dirs.root, 'trial.json'), events: join(dirs.root, 'events.jsonl'), turns: join(dirs.root, 'turns.jsonl'), snapshot: join(dirs.root, 'snapshot.json'), grade: join(dirs.root, 'grade.json'), logs: dirs.logs };
  if (proxy) { paths.usage = join(dirs.root, 'usage.json'); paths.reconcile = join(dirs.root, 'reconcile.json'); }
  if (sidecar) paths.gbrain = join(dirs.root, 'gbrain');

  try {
    // The harness slot is bound inside the cleanup try, so nothing thrown from here on can leave a live token behind.
    if (proxy) await proxy.bind(slot, key, token, cellModels(cell), cell.ablation ? { ...cell.ablation, map: resolve(opts.repoRoot ?? '.', cell.ablation.map), ...(cell.utility_models ? { utility_models: cell.utility_models } : {}) } : undefined);
    writeFileSync(paths.turns!, '');
    try {
      if (infraError) throw new HarnessGone(null, infraError);
      if (mode === 'scripted') {
        if (!trial.script) throw new RunnerError('HE-SCRIPT-001', `trial ${trial.id} is scripted but names no script`);
        harness = startScriptedHarness({ script: loadScript(trial.script), dirs, mcpUrl: `${world.localUrl}/mcp`, botToken: world.botToken });
        paths.script = trial.script;
      } else if (mode === 'process') {
        const adapter = cell.adapter ?? opts.adapter;
        if (!adapter) throw new RunnerError('HE-RUN-005', `harness mode process needs an adapter script: set cell.adapter or pass --adapter <path>`);
        harness = startProcessHarness({ adapter, dirs, env });
      } else {
        const harnessDir = join(opts.repoRoot ?? '.', 'harnesses', cell.harness);
        const image = opts.image ?? `harness-eval/${cell.harness.replace(/^_/, '')}:dev`;
        const compose = join(harnessDir, 'compose.yaml');
        harness = existsSync(compose)
          ? await startComposeHarness({ harness: cell.harness, image, trialSlug: slot, dirs, env, composeFile: compose, timeBudgetS: task.time_budget_s, repoRoot: opts.repoRoot, stackEnv: { HE_MODEL_BASE_URL: env.HE_MODEL_BASE_URL!, HE_MODEL_API_KEY: token, HE_MODEL_NAME: modelName, HE_TIME_BUDGET_S: env.HE_TIME_BUDGET_S!, HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: trial.id, ...(cell.config ? { HE_HARNESS_CONFIG: cell.config } : {}) }, ...(providerWiring ? { coreEnv: providerWiring.coreEnv } : {}), modelProvider: provider })
          : await startDockerHarness({ harness: cell.harness, image, trialSlug: slot, dirs, env, repoRoot: opts.repoRoot, ...(installViewPath ? { readOnlyMounts: { [installViewPath]: '/he-gbrain-install' } } : {}), ...(network ? { network } : {}), ...(opts.captureDns ? { dns: opts.captureDns } : {}) });
      }
      await harness.waitReady(opts.readyTimeoutS * 1000);
      log(`harness ready (${harness.kind})`);
      // The adapter writes ready before any turn; /he-logs is writable by the harness, so the hook status is taken now, not after the turns.
      try { readyTurnHook = String((JSON.parse(readFileSync(join(dirs.logs, 'ready'), 'utf8')) as { gbrain_install?: { turn_hook?: string } }).gbrain_install?.turn_hook ?? 'absent from ready'); } catch { readyTurnHook = 'unreadable ready file'; }
    } catch (e) {
      if (!(e instanceof HarnessGone)) throw e;
      readyFailure = e;
      error = infraError ?? `HE-ADAPTER-002 ${e.message}`;
      if (!infraError) log(error);
    }

    if (!readyFailure) {
      const loop = await runTurns({ task, preamble: opts.preamble, world, harness: harness!, turnsDir: dirs.turns, trialId: trial.id, graceS: opts.turnGraceS, log,
        onAnswered: (turn, exit) => { if (readyTurnHook === 'ran') noteAnsweredTurn(answeredHook, dirs.logs, turn, exit); } });
      windows = loop.windows;
      endedEarly = loop.ended_early;
      if (loop.error) error = loop.error;
    }
    if (world.gbrainScoped) await world.setGbrainRequester(null);

    await world.fence();
    // The fence refuses every post, so the ingest queue is final here; drain it before the snapshot and the sidecar
    // stop, on every path, so no write is cut off and counted as a failure (a failure on a completed trial is the exam fault).
    const drained = await flushIngestAfterFence(world, endedEarly, log);
    if (drained) { endedEarly = drained.ended_early; error = drained.error; }
    const snapshot = await world.snapshot();
    writeAtomic(paths.snapshot!, JSON.stringify(snapshot, null, 1) + '\n');
    if (harness) await harness.stop(opts.stopGraceS * 1000);
    if (sidecar) await sidecar.stop();

    if (proxy) {
      const meter = await proxy.finalize(key);
      const lines = proxy.usageLines(key);
      const summary = summarizeUsage(key, meter, lines);
      usage = summary.usage;
      capStop = summary.cap_stop;
      const foreign = foreignModels(cell.model, usage.by_model, lines, gbrain?.embeddings ?? 'off', cell.utility_models ?? []);
      if (foreign.length) {
        modelMismatch = true;
        const msg = `HE-MODEL-001 trial ${trial.id} ran model(s) ${foreign.join(', ')} beside the cell's ${cell.model} (by_model and refused usage lines); the trial is model_error; fix: check the harness's model mapping (QM: PI_MODEL, set from HE_MODEL_NAME), fix the cell's model, or preregister the harness's documented housekeeping model in the cell's utility_models`;
        log(msg);
        error = error ? `${error}; ${msg}` : msg;
      }
      writeAtomic(paths.usage!, JSON.stringify(usage, null, 1) + '\n');
      writeAtomic(paths.reconcile!, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
      if (cell.ablation) {
        const receipts = proxy.ablationLines(key);
        paths.ablation = join(dirs.root, 'ablation.ndjson');
        writeAtomic(paths.ablation, receipts.map((l) => JSON.stringify(l) + '\n').join(''));
        ablation = summarizeAblation(cell.ablation, wireOfModel(cell.model)!, receipts);
      }
    }

    if (windows.length) {
      const evidence: TrialEvidence = { trial_id: trial.id, task_dir: task.dir, split: cell.split, world_path: world.worldPath, bot_member: world.botMember.id, snapshot, events: world.events, turns: windows };
      grade = await ctx.grade(evidence);
    }
    writeAtomic(paths.grade!, JSON.stringify(grade, null, 1) + '\n');
  } finally {
    if (harness) await harness.stop(opts.stopGraceS * 1000).catch(() => undefined);
    if (sidecar) await sidecar.stop().catch(() => undefined);
    // On every exit, the thrown ones included, so a trial's tokens die with it (an unbound slot is refused; unbinding twice is a no-op).
    if (proxy) { await proxy.unbind(slot).catch(() => undefined); if (cell.gbrain) await proxy.unbind(gbrainSlot).catch(() => undefined); }
    world.stop();
  }
  let gbrainRecord: TrialGbrain | undefined = gbrain ? gbrainSummary(gbrain, sidecar ?? { image: opts.gbrainImage ?? 'none', ready_ms: 0 }, world.events, windows) : undefined;
  if (gbrainRecord && installView) {
    gbrainRecord.install_bundle = { harness: installView.harness, split: installView.split, install: installView.install ?? 'gbrain-docs', files: installView.files.length, view_digest: installView.view_digest };
    if (installView.context) gbrainRecord.install_bundle.context = contextExposure(worldAt(world.worldPath), cell.split, installView.context.kept_slugs, task.actors);
    const hook = installView.installer && 'turn_hook' in installView.installer ? installView.installer.turn_hook : undefined;
    if (hook) gbrainRecord.install_bundle.turn_hook = { files: hook.files.length, status: readyTurnHook, ...(readyTurnHook === 'ran' ? { turn_runs: answeredHook.turn_runs, turns: answeredHook.turns } : {}) };
    else if (installView.install === 'gbrain-installer') gbrainRecord.install_bundle.turn_hook = { files: 0, status: 'absent from bundle' };
  }
  let semanticError: string | null = null;
  if (gbrainRecord && gbrain && gbrain.embeddings !== 'off' && proxy) {
    gbrainRecord.embedding_usage = embeddingUsage(gbrain.embeddings, proxy.usageLines(key));
    const check = semanticCheck(world.events, gbrainRecord.embedding_usage);
    gbrainRecord.semantic_check = check;
    if (!check.ok && !infraError && !readyFailure) semanticError = `HE-GBRAIN-005 trial ${trial.id}: ${check.reason}; the trial is infra_error and leaves the rung (docs/gbrain-arm.md, "The install ladder"); fix: read <trial dir>/gbrain/serve.log and the proxy's usage lines for ${key}`;
  }
  if (semanticError) { error = semanticError; log(semanticError); }

  const exits = windows.map((w) => w.exit);
  const termination: Termination = capStop || modelMismatch ? 'model_error' : infraError || semanticError ? 'infra_error' : classify(exits, readyFailure, endedEarly, grade.approval_stop);
  const ended = Date.now();
  return {
    trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: mode, model: cell.model, script: trial.script ?? null,
    termination, grade: grade.grade, consent_violation: grade.consent_violation, approval_stop: grade.approval_stop, effects: grade.effects, predicates: grade.predicates,
    cap_stop: capStop,
    turns: { planned: task.turns.length, run: windows.length, exits },
    usage, wall_ms: ended - started, started_at, ended_at: new Date(ended).toISOString(), paths,
    ...(error ? { error } : {}),
    ...(gbrainRecord ? { gbrain: gbrainRecord } : {}),
    ...(ablation ? { ablation } : {}),
  };
}

/** The gbrain tools that search the brain: a query embedding leaves for each on an embedded brain. */
export const GBRAIN_SEARCH_TOOLS: ReadonlySet<string> = new Set(['gbrain.search', 'gbrain.query', 'gbrain.recall']);

/** The record's gbrain.ingested from the world's gbrain.ingest events: a skip is outcome ok with effect.skipped and no
 *  fact, a failure any outcome other than ok, and the rest are committed facts. The three counts partition the events. */
/** The world's gbrain upstream for the trial's sidecar. internal-task: with QM's memory provider wired, its provider block too
 *  (read by the OAuth issuer and the tap's caller split once #159 and #152 are on main; ignored by a tap without them). */
export function gbrainUpstream(sidecar: Pick<GbrainSidecar, 'url' | 'token' | 'tokens' | 'grants' | 'ingest'>, provider?: QmProviderBlock): GbrainUpstream {
  const upstream: GbrainUpstream = { url: sidecar.url, token: sidecar.token, ...(sidecar.tokens ? { tokens: { members: sidecar.tokens.members, public_only: sidecar.tokens.public_only } } : {}), ...(sidecar.grants ? { grants: sidecar.grants } : {}), ...(sidecar.ingest ? { ingest: { tokens: sidecar.ingest.tokens.sources, channels: sidecar.ingest.map.channels, dm_source_prefix: sidecar.ingest.map.dm_source_prefix } } : {}) };
  return provider ? Object.assign(upstream, { provider }) : upstream;
}

/** The adapter's gbrain variables: the tap URL and the bot token it registers gbrain under as an MCP server. internal-task: none
 *  for QM's memory-provider config, where gbrain reaches QM only through MEMORY_PROVIDER_CONFIG. */
export function gbrainHarnessEnv(sidecar: object | null, harnessUrl: string, botToken: string, memoryProvider: boolean): Record<string, string> {
  return sidecar && !memoryProvider ? { HE_GBRAIN_MCP_URL: `${harnessUrl}/gbrain`, HE_GBRAIN_MCP_TOKEN: botToken } : {};
}

export function ingestedCounts(ingests: WorldEvent[]): { ok: number; skipped: number; failed: number } {
  const skipped = ingests.filter((e) => e.outcome === 'ok' && typeof (e.effect as { skipped?: unknown } | undefined)?.skipped === 'string').length;
  const failed = ingests.filter((e) => e.outcome !== 'ok').length;
  return { ok: ingests.length - skipped - failed, skipped, failed };
}

/** What the trial's log says about the sidecar: how many gbrain events, how many were tool calls, how many of those
 *  fell inside a turn window (started_seq, ended_seq], how many were writes, how many search replies gbrain stamped
 *  degraded. The events themselves are the record. Surface, install and embeddings are the resolved cell fields. */
export function gbrainSummary(config: ResolvedGbrain | GbrainCellSurface, sidecar: Pick<GbrainSidecar, 'image' | 'ready_ms'> & Partial<Pick<GbrainSidecar, 'image_id' | 'brain' | 'scope'>>, events: WorldEvent[], windows: TurnWindow[]): TrialGbrain {
  const resolved: ResolvedGbrain = typeof config === 'string' ? resolveGbrain({ surface: config }) : config;
  const mine = events.filter((e) => e.via === 'gbrain');
  // The world's own writes into the brain are runner events, not gbrain ones; they are counted apart from the harness's calls.
  const ingests = events.filter((e) => e.via === 'runner' && e.tool === 'gbrain.ingest');
  const calls = mine.filter((e) => e.tool !== 'gbrain.initialize' && e.tool !== 'gbrain.tools/list');
  const inTurn = calls.filter((e) => windows.some((w) => e.seq > w.started_seq && e.seq <= w.ended_seq));
  const degraded = calls.filter((e) => GBRAIN_SEARCH_TOOLS.has(e.tool) && typeof (e.effect as { degraded?: unknown } | undefined)?.degraded === 'string').length;
  const writes = calls.filter((e) => GBRAIN_WRITE_TOOLS.has(e.tool.slice('gbrain.'.length)));
  // internal-task: a failed write is counted by its error code (storage_error while member-source page writes fail, #161), never silent.
  const writeErrors: Record<string, number> = {};
  for (const e of writes) if (e.outcome !== 'ok') writeErrors[e.error ?? 'error'] = (writeErrors[e.error ?? 'error'] ?? 0) + 1;
  return {
    surface: resolved.surface, image: sidecar.image, sidecar_ready_ms: sidecar.ready_ms,
    ...(sidecar.image_id ? { image_id: sidecar.image_id } : {}), ...(sidecar.brain ? { brain: sidecar.brain } : {}), ...(sidecar.scope ? { scope: sidecar.scope } : {}),
    ...(resolved.access ? { access: resolved.access } : {}),
    install: resolved.install, embeddings: resolved.embeddings,
    ...(resolved.ingest !== 'off' ? { ingest: resolved.ingest, ingested: ingestedCounts(ingests) } : {}),
    events: { total: mine.length, discovery: mine.length - calls.length, calls: calls.length, in_turn_calls: inTurn.length, writes: writes.length, ...(Object.keys(writeErrors).length ? { write_errors: writeErrors } : {}), ...(resolved.embeddings !== 'off' ? { degraded } : {}) },
  };
}
type GbrainCellSurface = ResolvedGbrain['surface'];

/** A metered embedding line is a billing witness, not a retrieval witness. A trial with embeddings on that searched the
 *  brain is trusted only when at least one /v1/embeddings line was forwarded under its key and no search reply carried a
 *  degraded stamp; otherwise the rung would be counting keyword search as semantic. A trial that never searched is fine. */
export function semanticCheck(events: WorldEvent[], usage: TrialEmbeddingUsage): NonNullable<TrialGbrain['semantic_check']> {
  const searches = events.filter((e) => e.via === 'gbrain' && GBRAIN_SEARCH_TOOLS.has(e.tool) && e.outcome === 'ok');
  const degraded = searches.filter((e) => typeof (e.effect as { degraded?: unknown } | undefined)?.degraded === 'string');
  const base = { search_calls: searches.length, embedding_requests: usage.requests, degraded_calls: degraded.length };
  if (searches.length === 0) return { ...base, ok: true };
  if (usage.requests === 0) return { ...base, ok: false, reason: `${searches.length} gbrain search call(s) and no forwarded /v1/embeddings line under the trial key (${usage.refused} refused, ${usage.failed} failed): the brain answered keyword-only` };
  if (degraded.length) return { ...base, ok: false, reason: `${degraded.length} of ${searches.length} gbrain search replies carry gbrain's degraded stamp (${[...new Set(degraded.map((e) => (e.effect as { degraded: string }).degraded))].join(', ')}): the query embedding did not arrive in time` };
  return { ...base, ok: true };
}

export function appendRecord(runDir: string, record: TrialRecord): void {
  appendFileSync(join(runDir, 'trials.jsonl'), JSON.stringify(record) + '\n');
}
