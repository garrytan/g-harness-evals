// One multi-user trial, start to finish: the world, the proxy slot, the gbrain sidecar when the cell carries
// gbrain, the harness, the turn loop, the fence and snapshot, teardown, the usage meter, classification and
// grading. Everything it writes lands under results/<run>/trials/<cell>/<task>/[<script>/]r<n>/ (the paths
// field of the trials.jsonl line).

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GradeResult, HarnessMode, Termination, TrialEvidence, TrialGbrain, TrialRecord, TrialUsage, TurnWindow } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { taskDirFor, type Cell, type Trial } from '../run.ts';
import type { WorldEvent } from '../../world/services/events.ts';
import { loadScript, startScriptedHarness } from '../scripted/executor.ts';
import { startComposeHarness, startDockerHarness } from './docker.ts';
import { type GbrainSidecar, checkCompanyTokens, startGbrainSidecar } from './gbrain.ts';
import { GBRAIN_WRITE_TOOLS } from '../../world/services/gbrain-tap.ts';
import { HarnessGone, type Harness, makeTrialDirs, startProcessHarness, writeAtomic } from './harness.ts';
import { RunProxy, reconcile, summarizeUsage, trialKey, trialSlug } from './proxy.ts';
import { loadTask, type TaskSpec } from './task.ts';
import { runTurns } from './turns.ts';
import { TrialWorld } from './world.ts';

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
  repoRoot?: string;
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

export async function runTrial(ctx: TrialContext): Promise<TrialRecord> {
  const { cell, trial, opts, log } = ctx;
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  const dirs = makeTrialDirs(ctx.trialDir);
  const task: TaskSpec = loadTask(trial.task_dir ?? taskDirFor(cell, trial.task));
  const mode: HarnessMode = cell.harness_mode === 'scripted' ? 'scripted' : opts.harnessMode;
  const docker = mode === 'docker';
  const key = trialKey(trial.id);
  const slot = trialSlug(trial.id);
  const [provider, modelName] = cell.model.includes(':') ? [cell.model.slice(0, cell.model.indexOf(':')), cell.model.slice(cell.model.indexOf(':') + 1)] : ['none', cell.model];

  if (cell.gbrain && mode === 'scripted') throw new RunnerError('HE-GBRAIN-001', `cell ${cell.id} carries gbrain but runs scripted; a script has no harness to call the brain. fix: drop gbrain from the cell or run it in docker or process mode`);
  const world = new TrialWorld({ trialId: trial.id, split: cell.split, actors: task.actors, outDir: dirs.root, worldPath: opts.worldPath, reachableFromContainers: docker });
  log(`world for ${trial.id} at ${world.localUrl} (harness sees ${world.harnessUrl}); ${task.turns.length} turns, budget ${task.time_budget_s} s per turn`);
  const proxy = mode === 'scripted' ? null : ctx.proxy;
  if (proxy) await proxy.bind(slot, key);

  // The gbrain sidecar starts before the harness so the tap is live by the time the harness registers it;
  // it is stopped after the world is fenced, so a late call cannot land in the brain unrecorded.
  let sidecar: GbrainSidecar | null = null;
  if (cell.gbrain) {
    try {
      sidecar = await startGbrainSidecar({ trialId: trial.id, trialSlug: slot, split: cell.split, outDir: join(dirs.root, 'gbrain'), image: opts.gbrainImage, brain: cell.gbrain.brain, scope: cell.gbrain.scope ?? 'none', log });
      // internal-task: under member scope the tap needs a granted token for every member who will take a turn (HE-GBRAIN-004).
      if (sidecar.scope === 'member') checkCompanyTokens(sidecar.tokens, cell.split, task.actors, join(dirs.root, 'gbrain', 'tokens.json'));
    } catch (e) {
      if (sidecar) await sidecar.stop(5_000).catch(() => undefined);
      if (proxy) { await proxy.finalize(key).catch(() => undefined); await proxy.unbind(slot).catch(() => undefined); }
      world.stop();
      throw e;
    }
    world.server.setGbrain({ url: sidecar.url, token: sidecar.token, ...(sidecar.tokens ? { tokens: { members: sidecar.tokens.members, public_only: sidecar.tokens.public_only } } : {}) });
  }

  const env: Record<string, string> = {
    HE_MODEL_BASE_URL: proxy ? proxy.baseUrlFor(slot, provider) : 'http://127.0.0.1:1/none',
    HE_MODEL_API_KEY: key,
    HE_MODEL_NAME: modelName,
    HE_TIME_BUDGET_S: String(task.time_budget_s),
    HE_LOG_DIR: docker ? '/he-logs' : resolve(dirs.logs),
    HE_SESSION_STATE_DIR: docker ? '/harness-state' : resolve(dirs.state),
    ...(cell.session_scope ? { HE_SESSION_SCOPE: cell.session_scope } : {}),
    HE_TASK_SLICE: 'multiuser',
    HE_TRIAL_ID: trial.id,
    HE_TURNS_DIR: docker ? '/he-turns' : resolve(dirs.turns),
    HE_WORLD_MCP_URL: `${world.harnessUrl}/mcp`,
    HE_WORLD_MCP_TOKEN: world.botToken,
    HE_SLACK_API_URL: world.config.slack.api_url,
    HE_SLACK_BOT_TOKEN: world.botToken,
    HE_SLACK_APP_TOKEN: world.config.slack.bot.app_token,
    ...(sidecar ? { HE_GBRAIN_MCP_URL: `${world.harnessUrl}/gbrain`, HE_GBRAIN_MCP_TOKEN: world.botToken } : {}),
    ...(docker ? {} : { HE_WORKSPACE_DIR: resolve(dirs.workspace) }),
    ...(opts.harnessEnv ?? {}),
  };

  let harness: Harness | null = null;
  let readyFailure: HarnessGone | null = null;
  let windows: TurnWindow[] = [];
  let endedEarly: string | null = null;
  let error: string | undefined;
  let grade: GradeResult = EMPTY_GRADE;
  let usage: TrialUsage | null = null;
  let capStop = false;
  const paths: Record<string, string> = { dir: dirs.root, trial_json: join(dirs.root, 'trial.json'), events: join(dirs.root, 'events.jsonl'), turns: join(dirs.root, 'turns.jsonl'), snapshot: join(dirs.root, 'snapshot.json'), grade: join(dirs.root, 'grade.json'), logs: dirs.logs };
  if (proxy) { paths.usage = join(dirs.root, 'usage.json'); paths.reconcile = join(dirs.root, 'reconcile.json'); }
  if (sidecar) paths.gbrain = join(dirs.root, 'gbrain');
  writeFileSync(paths.turns!, '');

  try {
    try {
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
          ? startComposeHarness({ harness: cell.harness, image, trialSlug: slot, dirs, env, composeFile: compose, timeBudgetS: task.time_budget_s, repoRoot: opts.repoRoot, stackEnv: { HE_MODEL_BASE_URL: env.HE_MODEL_BASE_URL!, HE_MODEL_API_KEY: key, HE_MODEL_NAME: modelName, HE_TIME_BUDGET_S: env.HE_TIME_BUDGET_S!, HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: trial.id } })
          : startDockerHarness({ harness: cell.harness, image, trialSlug: slot, dirs, env, repoRoot: opts.repoRoot });
      }
      await harness.waitReady(opts.readyTimeoutS * 1000);
      log(`harness ready (${harness.kind})`);
    } catch (e) {
      if (!(e instanceof HarnessGone)) throw e;
      readyFailure = e;
      error = `HE-ADAPTER-002 ${e.message}`;
      log(error);
    }

    if (!readyFailure) {
      const loop = await runTurns({ task, preamble: opts.preamble, world, harness: harness!, turnsDir: dirs.turns, trialId: trial.id, graceS: opts.turnGraceS, log });
      windows = loop.windows;
      endedEarly = loop.ended_early;
      if (loop.error) error = loop.error;
    }
    if (world.gbrainScoped) await world.setGbrainRequester(null);

    await world.fence();
    const snapshot = await world.snapshot();
    writeAtomic(paths.snapshot!, JSON.stringify(snapshot, null, 1) + '\n');
    if (harness) await harness.stop(opts.stopGraceS * 1000);
    if (sidecar) await sidecar.stop();

    if (proxy) {
      const meter = await proxy.finalize(key);
      await proxy.unbind(slot);
      const lines = proxy.usageLines(key);
      const summary = summarizeUsage(key, meter, lines);
      usage = summary.usage;
      capStop = summary.cap_stop;
      writeAtomic(paths.usage!, JSON.stringify(usage, null, 1) + '\n');
      writeAtomic(paths.reconcile!, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
    }

    if (windows.length) {
      const evidence: TrialEvidence = { trial_id: trial.id, task_dir: task.dir, split: cell.split, world_path: world.worldPath, bot_member: world.botMember.id, snapshot, events: world.events, turns: windows };
      grade = await ctx.grade(evidence);
    }
    writeAtomic(paths.grade!, JSON.stringify(grade, null, 1) + '\n');
  } finally {
    if (harness) await harness.stop(opts.stopGraceS * 1000).catch(() => undefined);
    if (sidecar) await sidecar.stop().catch(() => undefined);
    world.stop();
  }
  const gbrainRecord: TrialGbrain | undefined = sidecar ? gbrainSummary(cell.gbrain!.surface, sidecar, world.events, windows) : undefined;

  const exits = windows.map((w) => w.exit);
  const termination: Termination = capStop ? 'model_error' : classify(exits, readyFailure, endedEarly, grade.approval_stop);
  const ended = Date.now();
  return {
    trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: mode, model: cell.model, script: trial.script ?? null,
    termination, grade: grade.grade, consent_violation: grade.consent_violation, approval_stop: grade.approval_stop, effects: grade.effects, predicates: grade.predicates,
    cap_stop: capStop,
    turns: { planned: task.turns.length, run: windows.length, exits },
    usage, wall_ms: ended - started, started_at, ended_at: new Date(ended).toISOString(), paths,
    ...(error ? { error } : {}),
    ...(gbrainRecord ? { gbrain: gbrainRecord } : {}),
  };
}

/** What the trial's log says about the sidecar: how many gbrain events, how many were tool calls, how many of those
 *  fell inside a turn window (started_seq, ended_seq], how many were writes. The events themselves are the record. */
export function gbrainSummary(surface: 'starter', sidecar: Pick<GbrainSidecar, 'image' | 'ready_ms'> & Partial<Pick<GbrainSidecar, 'image_id' | 'brain' | 'scope'>>, events: WorldEvent[], windows: TurnWindow[]): TrialGbrain {
  const mine = events.filter((e) => e.via === 'gbrain');
  const calls = mine.filter((e) => e.tool !== 'gbrain.initialize' && e.tool !== 'gbrain.tools/list');
  const inTurn = calls.filter((e) => windows.some((w) => e.seq > w.started_seq && e.seq <= w.ended_seq));
  return {
    surface, image: sidecar.image, sidecar_ready_ms: sidecar.ready_ms,
    ...(sidecar.image_id ? { image_id: sidecar.image_id } : {}), ...(sidecar.brain ? { brain: sidecar.brain } : {}), ...(sidecar.scope ? { scope: sidecar.scope } : {}),
    events: { total: mine.length, discovery: mine.length - calls.length, calls: calls.length, in_turn_calls: inTurn.length, writes: calls.filter((e) => GBRAIN_WRITE_TOOLS.has(e.tool.slice('gbrain.'.length))).length },
  };
}

export function appendRecord(runDir: string, record: TrialRecord): void {
  appendFileSync(join(runDir, 'trials.jsonl'), JSON.stringify(record) + '\n');
}
