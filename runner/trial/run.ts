// Dispatch a manifest: one metering proxy for the run, then each trial in manifest order. Multi-user trials
// go through runner/trial/trial.ts; hello and smoke trials shell out to harnesses/run-trial.sh so the M0
// preregistration still runs through the same command. Every finished trial is one line of trials.jsonl,
// which --resume reads to skip what already ran. A lease refusal from the proxy is recorded on the trial
// as model_error with cap_stop and prints HE-BUDGET-001; the run goes on unless --stop-on-cap.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HarnessMode, Termination, TrialRecord } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import type { Cell, Manifest, Trial } from '../run.ts';
import { RunProxy, reconcile, summarizeUsage, trialKey, trialSlug } from './proxy.ts';
import { DEFAULT_PREAMBLE_PATH, loadPreamble } from './task.ts';
import { type GradeFn, appendRecord, loadGrader, runTrial } from './trial.ts';
import { writeAtomic } from './harness.ts';

export interface RunOptions {
  harnessMode: HarnessMode;
  adapter?: string;
  image?: string;
  /** The gbrain sidecar image for cells that carry gbrain (default harness-eval/gbrain:dev). */
  gbrainImage?: string;
  resume?: boolean;
  stopOnCap?: boolean;
  /** Only these cell ids. */
  cells?: string[];
  ledgerPath?: string;
  leaseUsd?: number;
  newLease?: boolean;
  maxOutputTokens?: number;
  preamblePath?: string;
  worldPath?: string;
  readyTimeoutS?: number;
  turnGraceS?: number;
  stopGraceS?: number;
  harnessEnv?: Record<string, string>;
  /** Tests inject a grader; the default loads runner/grade/index.ts at run time. */
  grade?: GradeFn;
  /** Environment for the proxy process; defaults to this process's environment. */
  proxyEnv?: Record<string, string | undefined>;
  repoRoot?: string;
  log?: (line: string) => void;
}

export interface RunResult {
  exit: 0 | 3;
  records: TrialRecord[];
  skipped: string[];
  cap_stop: boolean;
}

export function readRecords(runDir: string): TrialRecord[] {
  const file = join(runDir, 'trials.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
}

/** results/<run>/trials/<cell>/<task>/[<script>/]r<n>: the trial id without the run id prefix. */
export function trialDirFor(runDir: string, trial: Trial): string {
  const parts = trial.id.split('/');
  return join(runDir, 'trials', ...parts.slice(1).map((p) => p.replace(/[^A-Za-z0-9._-]+/g, '-')));
}

const isSingleShot = (cell: Cell) => cell.slice === 'hello' || cell.slice === 'smoke';

export async function executeRun(manifest: Manifest, manifestPath: string, opts: RunOptions): Promise<RunResult> {
  const runDir = dirname(resolve(manifestPath));
  mkdirSync(runDir, { recursive: true });
  const logFile = join(runDir, 'run.log');
  const log = (line: string) => { const stamped = `${new Date().toISOString()} ${line}`; appendFileSync(logFile, stamped + '\n'); opts.log?.(line); };
  const cells = new Map(manifest.cells.map((c) => [c.id, c]));
  const done = new Set(opts.resume ? readRecords(runDir).map((r) => r.trial_id) : []);
  if (!opts.resume && existsSync(join(runDir, 'trials.jsonl')) && readRecords(runDir).length) throw new RunnerError('HE-RUN-003', `${join(runDir, 'trials.jsonl')} already holds trials; fix: pass --resume to continue this run, or plan a new run id`);
  const selected = manifest.trials.filter((t) => !opts.cells || opts.cells.includes(t.cell));
  const pending = selected.filter((t) => !done.has(t.id));
  const skipped = selected.filter((t) => done.has(t.id)).map((t) => t.id);
  log(`run ${manifest.run_id}: ${pending.length} trials to run, ${skipped.length} already recorded, harness mode ${opts.harnessMode}`);

  const modeFor = (cell: Cell): HarnessMode => (cell.harness_mode === 'scripted' ? 'scripted' : opts.harnessMode);
  const needsProxy = pending.some((t) => modeFor(cells.get(t.cell)!) !== 'scripted');
  const needsGrader = pending.some((t) => !isSingleShot(cells.get(t.cell)!));
  const preambles = new Map<string, string>();
  const preambleFor = (cell: Cell): string => {
    const path = cell.preamble ?? opts.preamblePath ?? DEFAULT_PREAMBLE_PATH;
    if (!preambles.has(path)) preambles.set(path, loadPreamble(path));
    return preambles.get(path)!;
  };
  const grade = needsGrader ? (opts.grade ?? await loadGrader()) : (() => { throw new Error('no grader'); });
  const docker = opts.harnessMode === 'docker';
  const records: TrialRecord[] = [];
  let proxy: RunProxy | null = null;
  let capStop = false;
  let exit: 0 | 3 = 0;
  try {
    if (needsProxy) {
      // internal-task: a cell with embeddings on sends the sidecar's query embeddings through the same proxy, so the embedding model
      // joins the allowlist and the proxy binds every interface (the sidecar is a container whatever the harness mode).
      const embeddingModels: string[] = [...new Set(manifest.cells.map((c) => c.gbrain?.embeddings ?? 'off').filter((m) => m !== 'off'))];
      proxy = await RunProxy.start({
        runId: manifest.run_id, runDir, ledgerPath: opts.ledgerPath ?? join(runDir, 'ledger.sqlite'), leaseUsd: opts.leaseUsd ?? manifest.spend_cap_usd,
        allowModels: [...new Set([...manifest.cells.map((c) => c.model).filter((m) => m !== 'none'), ...embeddingModels])], maxOutputTokens: opts.maxOutputTokens,
        reachableFromContainers: docker || embeddingModels.length > 0, env: opts.proxyEnv, newRun: opts.newLease,
      });
      log(`metering proxy on port ${proxy.port}, lease $${opts.leaseUsd ?? manifest.spend_cap_usd} in ${proxy.ledgerPath}`);
    }
    for (const trial of pending) {
      const cell = cells.get(trial.cell);
      if (!cell) throw new RunnerError('HE-RUN-002', `trial ${trial.id} names cell ${trial.cell}, which the manifest does not define`);
      const trialDir = trialDirFor(runDir, trial);
      log(`trial ${trial.id} starting (${cell.harness}, ${cell.model})`);
      const record = isSingleShot(cell)
        ? await runSingleShot({ cell, trial, trialDir, proxy, log, image: opts.image, repoRoot: opts.repoRoot })
        : await runTrial({ cell, trial, runDir, trialDir, proxy, grade, log, opts: {
          harnessMode: opts.harnessMode, adapter: opts.adapter, image: opts.image, gbrainImage: opts.gbrainImage, preamble: preambleFor(cell), worldPath: opts.worldPath, readyTimeoutS: opts.readyTimeoutS ?? 180,
          turnGraceS: opts.turnGraceS ?? 60, stopGraceS: opts.stopGraceS ?? 60, harnessEnv: opts.harnessEnv, repoRoot: opts.repoRoot } });
      appendRecord(runDir, record);
      records.push(record);
      log(`trial ${trial.id}: termination=${record.termination} grade=${record.grade} consent_violation=${record.consent_violation} wall_ms=${record.wall_ms}${record.usage ? ` usd=${record.usage.usd.toFixed(4)}` : ''}${record.cap_stop ? ' cap_stop' : ''}`);
      if (record.cap_stop) {
        capStop = true;
        console.error(`HE-BUDGET-001 the metering proxy refused a call for trial ${trial.id}: the lease or the program cap in ${proxy?.ledgerPath} is spent; the trial is recorded as model_error with cap_stop. ${opts.stopOnCap ? 'Stopping: the run is incomplete.' : 'Continuing with the next trial.'} Recovery: raise the cap in the ledger (set-cap, with the owner's authorization) and rerun with --resume --lease-usd <new>`);
        if (opts.stopOnCap) { exit = 3; break; }
      }
    }
  } finally {
    if (proxy) await proxy.stop();
  }
  const summary = { run_id: manifest.run_id, finished_at: new Date().toISOString(), trials_recorded: readRecords(runDir).length, trials_planned: manifest.trials.length, cap_stop: capStop, complete: readRecords(runDir).length === manifest.trials.length && !capStop };
  writeAtomic(join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  log(`run ${manifest.run_id}: ${records.length} trials recorded this invocation; ${summary.trials_recorded}/${summary.trials_planned} total${capStop ? '; incomplete (cap stop)' : ''}`);
  return { exit, records, skipped, cap_stop: capStop };
}

/** The M0 single-shot path: harnesses/run-trial.sh does the container and the workspace grader; the runner
 *  adds the proxy slot and the trials.jsonl line. */
async function runSingleShot(o: { cell: Cell; trial: Trial; trialDir: string; proxy: RunProxy | null; log: (l: string) => void; image?: string; repoRoot?: string }): Promise<TrialRecord> {
  const { cell, trial } = o;
  const started = Date.now();
  const key = trialKey(trial.id);
  const slot = trialSlug(trial.id);
  const [provider, modelName] = [cell.model.slice(0, cell.model.indexOf(':')), cell.model.slice(cell.model.indexOf(':') + 1)];
  if (o.proxy) await o.proxy.bind(slot, key);
  const args = [join(o.repoRoot ?? '.', 'harnesses', 'run-trial.sh'), '--harness', cell.harness, '--task', join(o.repoRoot ?? '.', 'tasks', trial.task), '--trial-id', slot,
    '--base-url', o.proxy ? o.proxy.baseUrlFor(slot, provider) : 'http://127.0.0.1:1/none', '--api-key', key, '--model', modelName, '--out', o.trialDir];
  if (o.image) args.push('--image', o.image);
  mkdirSync(dirname(o.trialDir), { recursive: true });
  const r = spawnSync('bash', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  appendFileSync(join(dirname(o.trialDir), `${slot}.run-trial.log`), `${r.stdout}\n${r.stderr}`);
  const resultPath = join(o.trialDir, 'result.json');
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) as { termination: Termination; grade: 'pass' | 'fail'; wall_ms: number; exit_code: number } : null;
  let usage = null;
  let capStop = false;
  const paths: Record<string, string> = { dir: o.trialDir, result: resultPath, logs: join(o.trialDir, 'logs') };
  if (o.proxy) {
    const meter = await o.proxy.finalize(key);
    await o.proxy.unbind(slot);
    const lines = o.proxy.usageLines(key);
    const s = summarizeUsage(key, meter, lines);
    usage = s.usage; capStop = s.cap_stop;
    paths.usage = join(o.trialDir, 'usage.json'); paths.reconcile = join(o.trialDir, 'reconcile.json');
    mkdirSync(o.trialDir, { recursive: true });
    writeAtomic(paths.usage, JSON.stringify(usage, null, 1) + '\n');
    writeAtomic(paths.reconcile, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
  }
  const ended = Date.now();
  return {
    trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: 'smoke', model: cell.model, script: null,
    termination: capStop ? 'model_error' : result?.termination ?? 'infra_error', grade: result?.grade ?? 'n/a', consent_violation: false, approval_stop: false, effects: [], predicates: [],
    cap_stop: capStop, turns: { planned: 1, run: result ? 1 : 0, exits: result ? [result.exit_code] : [] }, usage, wall_ms: ended - started,
    started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), paths,
    ...(result ? {} : { error: `HE-RUN-006 harnesses/run-trial.sh exited ${r.status} without result.json: ${(r.stderr || '').trim().slice(-300)}` }),
  };
}
