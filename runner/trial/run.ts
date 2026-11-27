// Dispatch a manifest: one metering proxy for the run, then each trial in manifest order. Multi-user trials
// go through runner/trial/trial.ts; hello and smoke trials shell out to harnesses/run-trial.sh so the M0
// preregistration still runs through the same command. Every finished trial is one line of trials.jsonl,
// which --resume reads to skip what already ran. A trial whose harness never started (HarnessNotStarted: docker run, prepare.sh or
// docker compose up failed) gets no trials.jsonl line: it goes to not-started.jsonl, the run goes on, --resume retries it, and the
// invocation exits 7 while a selected trial is in not-started.jsonl and not in trials.jsonl. A lease refusal from the proxy is recorded on the trial
// as model_error with cap_stop and prints HE-BUDGET-001; the run goes on unless --stop-on-cap.
//
// An invocation whose cells have network "internal" creates (or reuses) the run's internal docker network before the
// proxy starts, binds the proxy and every world to its gateway, and removes it when the invocation ends. Its one proxy
// listens on one network, so internal and default-bridge harness cells run in separate invocations (--cells); HE-NET-001.
//
// A manifest with an ablation cell starts the proxy with the run-level receipt log, results/<run>/ablation.ndjson.
// The one proxy logs sections for every request or none, so the model-calling cells of one invocation agree on
// log_sections (HE-PROXY-005); run-summary.json records log_sections: true when it is on.
//
// Cursor cells (runner/trial/cursor.ts) call Cursor's backend, not the proxy: an invocation of only Cursor cells starts
// no proxy, starts the egress allowlist on the internal network's gateway instead, and scans each trial directory for
// the key after the trial (HE-CURSOR-003 stops the run). Cursor and proxied cells run in separate invocations (--cells).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { HarnessMode, Termination, TrialRecord } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { SET_WORLDS_FILE, cellModels, gbrainSetWorld, isSealedCell, setWorldPath, setWorldPinProblem, setWorldPins, type Cell, type Manifest, type Trial } from '../run.ts';
import { HarnessNotStarted, type InternalNetwork, ensureInternalNetwork, internalNetworkName, removeInternalNetwork } from './docker.ts';
import { RunProxy, reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from './proxy.ts';
import { defaultPreambleFor, loadPreamble } from './task.ts';
import { type CaptureConfig, captureDnsGapLine, captureLine, captureSummary } from './capture.ts';
import { type GradeFn, type TrialContext, appendRecord, loadGrader, runTrial, trialTermination } from './trial.ts';
import { writeAtomic } from './harness.ts';
import { SET_T_SLICE, adapterWorkspaceEntries, gradeSetTWorkspace, qmSandboxImage, setTEnv, setTTaskDir, skillArmImage, writeRunTrialTask, writeServeSetTTask } from './set-t.ts';
import { FLAG_FILE, flagTrial } from '../../scripts/skills-at-scale/flags.ts';
import { SAW_FILE, readCatalogDescriptions, sawSkill } from '../../scripts/skills-at-scale/saw.ts';
import { SKILL_REQUESTS_SLICE, checkBlockDelivery, gotSkillRecord, gstackReads, insideDir, readRequestSet, redactRequest, scrubTrialDir, sha256, writeRequestTask, writeRunRequestTask } from './skill-requests.ts';
import { readCatalogNames } from '../../scripts/skill-resolver/got-skill.ts';
import { REQUEST_CAP, type SlotLimits } from '../proxy/metering-proxy.ts';
import { checkoutProvenance } from './provenance.ts';
import { routeTextsFor } from './routes.ts';
import { type EgressAllowlist, cursorTransport, isCursorCell, keyValueFound, startEgressAllowlist } from './cursor.ts';
import { INSTALL_SLICE } from './install-cell.ts';
import { FIRST_WOW_SLICE } from './first-wow-cell.ts';
import { runFirstWowTrial } from './first-wow.ts';
import { InstallLeak, type LsRemote, measureColdDownload, preinstalledProblem, runInstallTrial, tagProblem } from './install.ts';
import { type OpenEgress, loadBlocklist, openEgressEnv, startOpenEgress } from './egress.ts';
import { PROVIDER_STOP_EXIT, PROVIDER_STOP_FILE, type ProviderStop, ProviderStopWatch, stopLine } from '../cost/provider-stop.ts';

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
  /** Sealed custody (runner/run.ts): the held-out cells of sealedSet store task and script paths relative to sealedRoot. */
  sealedRoot?: string;
  sealedSet?: string;
  readyTimeoutS?: number;
  turnGraceS?: number;
  stopGraceS?: number;
  harnessEnv?: Record<string, string>;
  /** Tests inject a grader; the default loads runner/grade/index.ts at run time. */
  grade?: GradeFn;
  /** Environment for the proxy process; defaults to this process's environment. Capture mode keeps only PATH and HOME from it. */
  proxyEnv?: Record<string, string | undefined>;
  /** Capture mode (runner/trial/capture.ts): fake upstreams and dummy keys for the proxy, --dns for in-container harnesses. */
  capture?: CaptureConfig;
  /** The proxy's --upstream per provider outside capture mode (scripts/gbrain-install/real-image-check.ts, keyless). */
  proxyUpstream?: Record<string, string>;
  repoRoot?: string;
  log?: (line: string) => void;
  /** Cursor cells: the key their containers get (CURSOR_API_KEY, or the --cursor-offline canary, with no egress host). */
  cursor?: { key: string; offline: boolean };
  /** gbrain-install cells (runner/trial/install.ts): the stable check's git ls-remote, which tests replace; and where the
   *  canary reads the provider keys' values (default this process's environment). */
  installLsRemote?: LsRemote;
  installKeyEnv?: Record<string, string | undefined>;
  /** One-trial diagnostic scripts: a harness that never started throws HarnessNotStarted, as before not-started.jsonl, so the script reports the docker error. */
  throwOnNotStarted?: boolean;
}

/** executeRun's exit codes. 3 is the cap or tag stop, which scripts/run-shard.sh passes through on purpose. 7 is a trial whose harness
 *  never started: scripts/ubicloud/run-shard.sh reads 4 as a failed smoke, so 4 is never a runner code (tests/exit-codes.test.ts).
 *  8 is the provider stop (runner/cost/provider-stop.ts): one provider refused PROVIDER_STOP_AFTER trials in a row for want of
 *  credit or permission, so the run stopped and wrote provider-stop.json. */
export const RUN_EXIT = { ok: 0, capStop: 3, harnessNotStarted: 7, providerStop: PROVIDER_STOP_EXIT } as const;

export const NOT_STARTED_FILE = 'not-started.jsonl';

/** The trials of `selected` that some invocation wrote to not-started.jsonl and none has recorded in trials.jsonl since. */
export function unstartedTrials(runDir: string, selected: Trial[]): Array<{ trial_id: string; cell: string }> {
  const file = join(runDir, NOT_STARTED_FILE);
  if (!existsSync(file)) return [];
  const recorded = new Set(readRecords(runDir).map((r) => r.trial_id));
  const lines = readFileSync(file, 'utf8').split('\n').map((l, i) => {
    if (!l) return null;
    try { return JSON.parse(l) as { trial_id: string; cell: string }; } catch (e) {
      throw new RunnerError('HE-RUN-007', `${file} line ${i + 1} is not JSON (${(e as Error).name}); fix: read that line on your own machine, then repair or remove it, and rerun`);
    }
  }).filter((l) => l !== null);
  const ids = new Set(lines.map((l) => l.trial_id));
  return selected.filter((t) => ids.has(t.id) && !recorded.has(t.id)).map((t) => ({ trial_id: t.id, cell: t.cell }));
}

export interface RunResult {
  exit: (typeof RUN_EXIT)[keyof typeof RUN_EXIT];
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

const isSingleShot = (cell: Cell) => cell.slice === 'hello' || cell.slice === 'smoke' || cell.slice === SET_T_SLICE;
/** hello and smoke run through harnesses/run-trial.sh on the default bridge only; set T cells may name the internal network. */
const isBridgeOnly = (cell: Cell) => cell.slice === 'hello' || cell.slice === 'smoke';

export async function executeRun(manifest: Manifest, manifestPath: string, opts: RunOptions): Promise<RunResult> {
  const runDir = dirname(resolve(manifestPath));
  mkdirSync(runDir, { recursive: true });
  const logFile = join(runDir, 'run.log');
  const log = (line: string) => { const stamped = `${new Date().toISOString()} ${line}`; appendFileSync(logFile, stamped + '\n'); opts.log?.(line); };
  const cells = new Map(manifest.cells.map((c) => [c.id, c]));
  const sealedPath = (cell: Cell, p: string | undefined) => (p !== undefined && opts.sealedRoot && isSealedCell(cell, opts.sealedSet) ? join(opts.sealedRoot, p) : p);
  const done = new Set(opts.resume ? readRecords(runDir).map((r) => r.trial_id) : []);
  if (!opts.resume && existsSync(join(runDir, 'trials.jsonl')) && readRecords(runDir).length) throw new RunnerError('HE-RUN-003', `${join(runDir, 'trials.jsonl')} already holds trials; fix: pass --resume to continue this run, or plan a new run id`);
  const pinFile = join(runDir, SET_WORLDS_FILE);
  const repoRoot = resolve(opts.repoRoot ?? '.');
  if (existsSync(pinFile) || done.size) {
    const problem = setWorldPinProblem(runDir, manifest.cells, repoRoot);
    if (problem) throw new RunnerError('HE-RUN-008', problem);
  } else {
    const pins = setWorldPins(manifest.cells, repoRoot);
    if (Object.keys(pins).length) writeAtomic(pinFile, JSON.stringify(pins, null, 1) + '\n');
  }
  const selected = manifest.trials.filter((t) => !opts.cells || opts.cells.includes(t.cell));
  const pending = selected.filter((t) => !done.has(t.id));
  const skipped = selected.filter((t) => done.has(t.id)).map((t) => t.id);
  // A torn not-started.jsonl line is HE-RUN-007 here, before any lease or append, not after the trials ran.
  unstartedTrials(runDir, selected);
  log(`run ${manifest.run_id}: ${pending.length} trials to run, ${skipped.length} already recorded, harness mode ${opts.harnessMode}`);

  const modeFor = (cell: Cell): HarnessMode => (cell.harness_mode === 'scripted' ? 'scripted' : opts.harnessMode);
  if (opts.capture) {
    log(captureLine(opts.capture));
    const harnesses = pending.map((t) => cells.get(t.cell)!).filter((c) => modeFor(c) !== 'scripted' && !isSingleShot(c)).map((c) => c.harness);
    const gap = captureDnsGapLine(opts.capture, harnesses, opts.harnessMode, opts.repoRoot);
    if (gap) log(gap);
  }
  const needsProxy = pending.some((t) => modeFor(cells.get(t.cell)!) !== 'scripted' && !isCursorCell(cells.get(t.cell)!));
  const needsGrader = pending.some((t) => !isSingleShot(cells.get(t.cell)!) && cells.get(t.cell)!.slice !== SKILL_REQUESTS_SLICE && cells.get(t.cell)!.slice !== INSTALL_SLICE && cells.get(t.cell)!.slice !== FIRST_WOW_SLICE);
  const preambles = new Map<string, string>();
  const preambleFor = (cell: Cell): string => {
    const path = cell.preamble ?? opts.preamblePath ?? defaultPreambleFor(cell.task_set);
    if (!preambles.has(path)) preambles.set(path, loadPreamble(path));
    return preambles.get(path)!;
  };
  const grade = needsGrader ? (opts.grade ?? await loadGrader()) : (() => { throw new Error('no grader'); });
  const docker = opts.harnessMode === 'docker';
  const pendingCells = [...new Set(pending.map((t) => cells.get(t.cell)).filter((c): c is Cell => !!c))];
  for (const c of pendingCells.filter((x) => x.slice === SKILL_REQUESTS_SLICE)) {
    const planned = manifest.request_sets?.[c.id]?.sha256;
    const now = existsSync(c.requests!) ? createHash('sha256').update(readFileSync(c.requests!)).digest('hex') : 'missing';
    if (planned !== now) throw new RunnerError('HE-PREREG-004', `cell ${c.id}: its request set ${c.requests} is not the file the run was planned with (sha256 ${now === 'missing' ? 'missing' : now.slice(0, 12)}, manifest ${planned?.slice(0, 12) ?? 'none'}); fix: restore the planned file or plan a new run id`);
  }
  const privateCells = pendingCells.filter((c) => c.private === true);
  if (privateCells.length && insideDir(runDir, resolve(import.meta.dir, '..', '..'))) throw new RunnerError('HE-RUN-002', `cells ${privateCells.map((c) => c.id).join(', ')} are private and the run directory ${runDir} is inside the repository; fix: plan the run with --out outside the repository`);
  // internal-task: network "install" is the internal network plus the open-egress proxy on its gateway.
  const internal = pendingCells.filter((c) => c.network === 'internal' || c.network === 'install');
  const installNet = pendingCells.filter((c) => c.network === 'install');
  if (internal.length) {
    const ids = (list: Cell[]) => list.map((c) => c.id).join(', ');
    const bridged = pendingCells.filter((c) => c.network !== 'internal' && c.network !== 'install' && modeFor(c) !== 'scripted');
    const compose = internal.filter((c) => existsSync(join(opts.repoRoot ?? '.', 'harnesses', c.harness, 'compose.yaml')));
    if (!docker) throw new RunnerError('HE-NET-001', `cells ${ids(internal)} have network "internal", which only a harness container gets; this invocation runs in ${opts.harnessMode} mode. fix: run them with --harness-mode docker`);
    if (bridged.length) throw new RunnerError('HE-NET-001', `cells ${ids(internal)} have network "internal" and cells ${ids(bridged)} run on the default bridge; the run's one metering proxy listens on one network's gateway. fix: run each group in its own invocation with --cells`);
    if (compose.length) throw new RunnerError('HE-NET-001', `cells ${ids(compose)} have network "internal" but run a compose stack (harnesses/<name>/compose.yaml), which the runner does not move onto the internal network. fix: drop network from those cells`);
    if (internal.some(isBridgeOnly)) throw new RunnerError('HE-NET-001', `cells ${ids(internal.filter(isBridgeOnly))} have network "internal" but run a single-shot slice through harnesses/run-trial.sh, which uses the default bridge. fix: drop network from those cells`);
  }
  const cursorCells = pendingCells.filter(isCursorCell);
  if (cursorCells.length) {
    const ids = (list: Cell[]) => list.map((c) => c.id).join(', ');
    const others = pendingCells.filter((c) => !isCursorCell(c) && modeFor(c) !== 'scripted');
    if (others.length) throw new RunnerError('HE-CURSOR-002', `cells ${ids(cursorCells)} run the Cursor CLI, which calls Cursor's backend through the egress allowlist, and cells ${ids(others)} call models through the metering proxy; fix: run each group in its own invocation with --cells`);
    if (!opts.cursor?.key) throw new RunnerError('HE-CURSOR-002', `cells ${ids(cursorCells)} run the Cursor CLI and this run has no CURSOR_API_KEY; fix: set it in the runner's environment, or pass --cursor-offline for the keyless rehearsal`);
    if (!docker || cursorCells.some((c) => c.network !== 'internal')) throw new RunnerError('HE-CURSOR-002', `cells ${ids(cursorCells)} run the Cursor CLI, which runs in docker mode on the internal network only; fix: add "network": "internal" and run with --harness-mode docker`);
  }
  const proxied = pendingCells.filter((c) => modeFor(c) !== 'scripted' && !isCursorCell(c));
  const sectioned = proxied.filter((c) => c.log_sections === true);
  if (sectioned.length && sectioned.length < proxied.length) throw new RunnerError('HE-PROXY-005', `cells ${sectioned.map((c) => c.id).join(', ')} set log_sections and cells ${proxied.filter((c) => c.log_sections !== true).map((c) => c.id).join(', ')} do not; the run's one metering proxy logs sections for every request or for none. fix: run each group in its own invocation with --cells`);
  const logSections = sectioned.length > 0;
  const records: TrialRecord[] = [];
  let proxy: RunProxy | null = null;
  let network: InternalNetwork | null = null;
  let egress: EgressAllowlist | null = null;
  let openEgress: OpenEgress | null = null;
  const stoppedCells = new Map<string, string>();
  const downloaded = new Set<string>();
  const offline: Array<{ trial: string; denied_hosts: string[]; denied: number; key_found: boolean }> = [];
  let capStop = false;
  let exit: RunResult['exit'] = RUN_EXIT.ok;
  const providerWatch = new ProviderStopWatch();
  let providerStop: ProviderStop | null = null;
  /** The provider stop after a trial, from its own attempt's proxy lines; written to provider-stop.json when it stops the run. */
  const providerStopAfter = (trialId: string, since: string): ProviderStop | null => {
    const stop = proxy ? providerWatch.observe(trialId, proxy.usageLines(trialKey(trialId)).filter((l) => l.at === undefined || l.at >= since)) : null;
    if (!stop) return null;
    const file = join(runDir, PROVIDER_STOP_FILE);
    writeAtomic(file, JSON.stringify({ ...stop, run_id: manifest.run_id }, null, 1) + '\n');
    const line = stopLine(stop, file);
    log(line);
    console.error(line);
    return stop;
  };
  try {
    if (internal.length) {
      network = await ensureInternalNetwork(internalNetworkName(manifest.run_id));
      log(`internal network ${network.name} (gateway ${network.gateway}) for cells ${internal.map((c) => c.id).join(', ')}`);
    }
    if (cursorCells.length && network) {
      const hosts = cursorTransport(opts.repoRoot).egress_hosts;
      egress = await startEgressAllowlist({ host: network.gateway, allow: opts.cursor!.offline ? [] : hosts, logPath: join(runDir, 'egress.ndjson') });
      log(`cursor egress allowlist on ${network.gateway}:${egress.port} (${opts.cursor!.offline ? `--cursor-offline: no host admitted, a canary stands in for the key` : `CONNECT to ${hosts.join(', ')} on 443 only`}), every decision in ${join(runDir, 'egress.ndjson')}; no metering proxy for cells ${cursorCells.map((c) => c.id).join(', ')}`);
    }
    if (installNet.length && network) {
      const block = loadBlocklist('gbrain-install', repoRoot);
      openEgress = await startOpenEgress({ host: network.gateway, block, logPath: join(runDir, 'install-egress.ndjson') });
      log(`open egress on ${network.gateway}:${openEgress.port} for cells ${installNet.map((c) => c.id).join(', ')}: every host but the ${block.length} entries of scripts/egress/egress_blocklist.py gbrain-install, every connection in ${join(runDir, 'install-egress.ndjson')}`);
    }
    if (needsProxy) {
      // A cell with embeddings on sends the sidecar's query embeddings through the same proxy, so the embedding model
      // joins the allowlist and the proxy binds every interface (the sidecar is a container whatever the harness mode).
      const embeddingModels: string[] = [...new Set(manifest.cells.map((c) => c.gbrain?.embeddings ?? 'off').filter((m) => m !== 'off'))];
      proxy = await RunProxy.start({
        runId: manifest.run_id, runDir, ledgerPath: opts.ledgerPath ?? join(runDir, 'ledger.sqlite'), leaseUsd: opts.leaseUsd ?? manifest.spend_cap_usd,
        allowModels: [...new Set([...manifest.cells.flatMap(cellModels), ...embeddingModels])], maxOutputTokens: opts.maxOutputTokens,
        reachableFromContainers: docker || embeddingModels.length > 0, ...(network ? { gatewayAddress: network.gateway } : {}), env: opts.proxyEnv, newRun: opts.newLease, capture: opts.capture, ...(opts.proxyUpstream ? { upstream: opts.proxyUpstream } : {}), logSections,
        routeTexts: routeTextsFor(manifest.cells, opts.repoRoot),
        ...(manifest.cells.some((c) => c.ablation) ? { ablationLog: true } : {}),
      });
      log(`metering proxy on port ${proxy.port}, lease $${opts.leaseUsd ?? manifest.spend_cap_usd} in ${proxy.ledgerPath}${logSections ? ', log_sections on' : ''}`);
    }
    for (const planned of pending) {
      const cell = cells.get(planned.cell);
      if (!cell) throw new RunnerError('HE-RUN-002', `trial ${planned.id} names cell ${planned.cell}, which the manifest does not define`);
      const trial: Trial = opts.sealedRoot && isSealedCell(cell, opts.sealedSet) ? { ...planned, task_dir: sealedPath(cell, planned.task_dir), script: sealedPath(cell, planned.script) } : planned;
      const trialDir = trialDirFor(runDir, trial);
      if (stoppedCells.has(cell.id)) { log(`trial ${trial.id} not run: its cell stopped (${stoppedCells.get(cell.id)!.slice(0, 15)})`); continue; }
      if (cell.slice === INSTALL_SLICE) {
        const problem = tagProblem(cell, opts.installLsRemote);
        if (problem) {
          stoppedCells.set(cell.id, problem);
          log(problem);
          console.error(problem);
          appendFileSync(join(runDir, 'install-stops.jsonl'), JSON.stringify({ at: new Date().toISOString(), cell: cell.id, trial: trial.id, tag: cell.install!.tag, commit: cell.install!.commit, error: problem }) + '\n');
          exit = RUN_EXIT.capStop;
          continue;
        }
      }
      log(`trial ${trial.id} starting (${cell.harness}, ${cell.model})`);
      const cursorTrial = isCursorCell(cell) && egress ? { proxyUrl: egress.proxyUrl, key: opts.cursor!.key } : undefined;
      egress?.setTrial(cursorTrial ? trial.id : null);
      const serveOpts = (): TrialContext['opts'] => ({
          harnessMode: opts.harnessMode, adapter: opts.adapter, image: opts.image, gbrainImage: opts.gbrainImage ?? (cell.gbrain ? gbrainSetWorld([cell], join(opts.repoRoot ?? '.', 'tasks'))?.image : undefined), preamble: preambleFor(cell), worldPath: setWorldPath(cell, join(opts.repoRoot ?? '.', 'tasks')) ?? opts.worldPath, readyTimeoutS: opts.readyTimeoutS ?? 180,
          turnGraceS: opts.turnGraceS ?? 60, stopGraceS: opts.stopGraceS ?? 60, harnessEnv: opts.harnessEnv, captureDns: opts.capture?.dns ?? undefined, repoRoot: opts.repoRoot, ...(network ? { network } : {}), ...(cursorTrial ? { cursor: cursorTrial } : {}) });
      if (cell.slice === INSTALL_SLICE && openEgress && network && docker) {
        const image = opts.image ?? `harness-eval/${cell.harness}:dev`;
        if (!downloaded.has(`${image} ${cell.install!.tag}`)) {
          downloaded.add(`${image} ${cell.install!.tag}`);
          openEgress.setTrial(null);
          const result = await measureColdDownload(image, network, openEgressEnv(openEgress.proxyUrl), cell.install!.tag);
          appendFileSync(join(runDir, 'install-download.jsonl'), JSON.stringify(result) + '\n');
          log(`cold gbrain download in ${image}: ${JSON.stringify(result)}`);
          const preinstalled = preinstalledProblem(result, image);
          if (preinstalled) throw new RunnerError('HE-INSTALL-006', preinstalled);
        }
      }
      openEgress?.setTrial(cell.slice === INSTALL_SLICE ? trial.id : null);
      const attemptStart = new Date().toISOString();
      let record: TrialRecord;
      try {
        record = cell.slice === INSTALL_SLICE
          ? await runInstallTrial({ cell, trial, runDir, trialDir, proxy, log, opts: serveOpts(), egress: openEgress, keyEnv: opts.installKeyEnv }).catch((e: unknown) => {
            if (e instanceof InstallLeak && e.record) { appendRecord(runDir, e.record); records.push(e.record); }
            throw e;
          })
          : cell.slice === FIRST_WOW_SLICE
          ? await runFirstWowTrial({ cell, trial, runDir, trialDir, proxy, log, opts: serveOpts(), keyEnv: opts.installKeyEnv }).catch((e: unknown) => {
            if (e instanceof InstallLeak && e.record) { appendRecord(runDir, e.record); records.push(e.record); }
            throw e;
          })
          : cell.slice === SET_T_SLICE
          ? await runSetTTrial({ cell, trial, runDir, trialDir, proxy, grade, log, opts: serveOpts() })
          : cell.slice === SKILL_REQUESTS_SLICE
          ? await runSkillRequestTrial({ cell, trial, runDir, trialDir, proxy, grade, log, opts: serveOpts() })
          : isSingleShot(cell)
          ? await runSingleShot({ cell, trial, trialDir, proxy, log, image: opts.image, repoRoot: opts.repoRoot })
          : await runTrial({ cell, trial, runDir, trialDir, proxy, grade, log, opts: serveOpts() });
      } catch (e) {
        if (!(e instanceof HarnessNotStarted) || opts.throwOnNotStarted) throw e;
        // A Cursor trial's key never reaches not-started.jsonl or run.log, even if docker echoed it.
        const error = cursorTrial ? e.message.split(cursorTrial.key).join('[CURSOR_API_KEY]') : e.message;
        const key = trialKey(trial.id);
        const meter = proxy ? await proxy.finalize(key).catch(() => null) : null;
        // The usage log is append-only across a resume: only this attempt's lines count, as in runSkillRequestTrial.
        const startup = meter ? summarizeUsage(key, meter, proxy!.usageLines(key).filter((l) => l.at === undefined || l.at >= attemptStart)) : null;
        appendFileSync(join(runDir, NOT_STARTED_FILE), JSON.stringify({ at: new Date().toISOString(), trial_id: trial.id, cell: cell.id, error, ...(proxy ? { usd: startup?.usage.usd ?? null, undrained: meter ? meter.undrained ?? 0 : null, cap_stop: startup?.cap_stop ?? null } : {}) }) + '\n');
        log(`trial ${trial.id} not started (cell ${cell.id}): ${error}; written to ${NOT_STARTED_FILE}, not trials.jsonl, and --resume retries it${startup?.usage.usd ? ` (usd=${startup.usage.usd.toFixed(4)} metered before the harness failed)` : ''}`);
        if (cursorTrial) {
          egress!.setTrial(null);
          const found = keyValueFound([trialDir], cursorTrial.key);
          log(`cursor trial ${trial.id} (not started): key scan of ${trialDir}: ${found ? 'FOUND' : 'clean'}`);
          if (found) throw new RunnerError('HE-CURSOR-003', `the ${opts.cursor!.offline ? 'offline canary' : 'CURSOR_API_KEY'} value is in a file under ${trialDir} after trial ${trial.id}, whose harness did not start; the run stops before another trial. fix: find the file without printing the value (bun scripts/cursor/key-scan.ts ${trialDir} --list names it), keep that trial directory out of every copy, publication and drive, and fix the path that wrote it before resuming`);
        }
        if (startup?.cap_stop) {
          capStop = true;
          console.error(`HE-BUDGET-001 the metering proxy refused a call for trial ${trial.id} before its harness started: the lease or the program cap in ${proxy?.ledgerPath} is spent. ${opts.stopOnCap ? 'Stopping: the run is incomplete.' : 'Continuing with the next trial.'} Recovery: raise the cap in the ledger (set-cap, with the owner's authorization) and rerun with --resume --lease-usd <new>`);
          if (opts.stopOnCap) { exit = RUN_EXIT.capStop; break; }
        }
        providerStop = providerStopAfter(trial.id, attemptStart);
        if (providerStop) { exit = RUN_EXIT.providerStop; break; }
        continue;
      }
      // internal-task (H10): the harness's provenance-manifest digest (runner/trial/provenance.ts), on harnesses that have one.
      const provenance = checkoutProvenance(cell.harness, opts.repoRoot);
      if (provenance) record.provenance_sha256 = provenance.digest;
      appendRecord(runDir, record);
      records.push(record);
      if (cursorTrial) {
        egress!.setTrial(null);
        const denials = egress!.denials(trial.id);
        const deniedHosts = [...new Set(denials.map((d) => `${d.host}:${d.port}`))].sort();
        const found = keyValueFound([trialDir], cursorTrial.key);
        log(`cursor trial ${trial.id}: egress ${denials.length} denied${deniedHosts.length ? ` (${deniedHosts.join(', ')})` : ''}; key scan of ${trialDir}: ${found ? 'FOUND' : 'clean'}`);
        if (opts.cursor!.offline) offline.push({ trial: trial.id, denied_hosts: deniedHosts, denied: denials.length, key_found: found });
        if (found) throw new RunnerError('HE-CURSOR-003', `the ${opts.cursor!.offline ? 'offline canary' : 'CURSOR_API_KEY'} value is in a file under ${trialDir} after trial ${trial.id}; the run stops before another trial. fix: find the file without printing the value (bun scripts/cursor/key-scan.ts ${trialDir} --list names it), keep that trial directory out of every copy, publication and drive, and fix the path that wrote it before resuming`);
      }
      log(`trial ${trial.id}: termination=${record.termination} grade=${record.grade} consent_violation=${record.consent_violation} wall_ms=${record.wall_ms}${record.usage ? ` usd=${record.usage.usd.toFixed(4)}` : ''}${record.cap_stop ? ' cap_stop' : ''}`);
      if (record.cap_stop) {
        capStop = true;
        console.error(`HE-BUDGET-001 the metering proxy refused a call for trial ${trial.id}: the lease or the program cap in ${proxy?.ledgerPath} is spent; the trial is recorded as model_error with cap_stop. ${opts.stopOnCap ? 'Stopping: the run is incomplete.' : 'Continuing with the next trial.'} Recovery: raise the cap in the ledger (set-cap, with the owner's authorization) and rerun with --resume --lease-usd <new>`);
        if (opts.stopOnCap) { exit = RUN_EXIT.capStop; break; }
      }
      providerStop = providerStopAfter(trial.id, attemptStart);
      if (providerStop) { exit = RUN_EXIT.providerStop; break; }
    }
  } finally {
    if (proxy) await proxy.stop();
    if (egress) await egress.stop();
    if (openEgress) await openEgress.stop();
    if (offline.length) {
      const hosts = cursorTransport(opts.repoRoot).egress_hosts;
      const ok = offline.every((t) => !t.key_found && t.denied_hosts.some((h) => hosts.includes(h.replace(/:443$/, ''))));
      writeAtomic(join(runDir, 'cursor-offline.json'), JSON.stringify({ ok, egress_hosts: hosts, rule: 'every trial reached the allowlist with a CONNECT to a pinned egress host on 443 (denied, since an offline run admits none) and left no copy of the canary in its directory', trials: offline }, null, 1) + '\n');
      log(`cursor offline rehearsal: ${ok ? 'ok' : 'FAILED'} (${offline.length} trials; cursor-offline.json)`);
    }
    if (network) log(await removeInternalNetwork(network.name) ? `internal network ${network.name} removed` : `internal network ${network.name} not removed (a container is still attached); fix: docker network rm ${network.name}`);
  }
  const unstarted = unstartedTrials(runDir, selected);
  if (unstarted.length) {
    log(`run ${manifest.run_id}: ${unstarted.length} trials never started (cells ${[...new Set(unstarted.map((t) => t.cell))].join(', ')}), listed in ${NOT_STARTED_FILE}; fix the harness start and rerun with --resume`);
    if (exit !== RUN_EXIT.capStop && exit !== RUN_EXIT.providerStop) exit = RUN_EXIT.harnessNotStarted;
  }
  const summary = { run_id: manifest.run_id, finished_at: new Date().toISOString(), trials_recorded: readRecords(runDir).length, trials_planned: manifest.trials.length, cap_stop: capStop, ...(providerStop ? { provider_stop: providerStop.provider } : {}), complete: readRecords(runDir).length === manifest.trials.length && !capStop && !providerStop, ...(logSections ? { log_sections: true } : {}), ...(opts.capture ? { capture: captureSummary(opts.capture) } : {}) };
  writeAtomic(join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  log(`run ${manifest.run_id}: ${records.length} trials recorded this invocation; ${summary.trials_recorded}/${summary.trials_planned} total${capStop ? '; incomplete (cap stop)' : ''}${providerStop ? `; incomplete (provider stop: ${providerStop.provider})` : ''}`);
  return { exit, records, skipped, cap_stop: capStop };
}

/** The M0 single-shot path: harnesses/run-trial.sh does the container and the workspace grader; the runner
 *  adds the proxy slot and the trials.jsonl line. */
async function runSingleShot(o: { cell: Cell; trial: Trial; trialDir: string; proxy: RunProxy | null; log: (l: string) => void; image?: string; repoRoot?: string;
  /** Set T: the task directory run-trial.sh reads instead of tasks/<task>, extra harness environment and the internal network. */
  taskDir?: string; env?: Record<string, string>; network?: InternalNetwork | null;
  /** Phase B on QM: the slot's request cap and request collection, and the filter the run-trial log and error pass through. */
  bind?: SlotLimits; redact?: (s: string) => string }): Promise<TrialRecord> {
  const { cell, trial } = o;
  const started = Date.now();
  const key = trialKey(trial.id);
  const token = trialToken(trial.id);
  const slot = trialSlug(trial.id);
  const [provider, modelName] = [cell.model.slice(0, cell.model.indexOf(':')), cell.model.slice(cell.model.indexOf(':') + 1)];
  if (o.proxy) await o.proxy.bind(slot, key, token, cellModels(cell), undefined, false, o.bind);
  const args = [join(o.repoRoot ?? '.', 'harnesses', 'run-trial.sh'), '--harness', cell.harness, '--task', o.taskDir ?? join(o.repoRoot ?? '.', 'tasks', trial.task), '--trial-id', slot,
    '--base-url', o.proxy ? o.proxy.baseUrlFor(slot, provider) : 'http://127.0.0.1:1/none', '--api-key', token, '--model', modelName, '--out', o.trialDir];
  if (o.image) args.push('--image', o.image);
  for (const [k, v] of Object.entries(o.env ?? {})) args.push('--env', `${k}=${v}`);
  if (o.network) args.push('--network', o.network.name, '--host-gateway', o.network.gateway);
  mkdirSync(dirname(o.trialDir), { recursive: true });
  const r = spawnSync('bash', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const redact = o.redact ?? ((s: string) => s);
  appendFileSync(join(dirname(o.trialDir), `${slot}.run-trial.log`), redact(`${r.stdout}\n${r.stderr}`));
  const resultPath = join(o.trialDir, 'result.json');
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) as { termination: Termination; grade: 'pass' | 'fail'; wall_ms: number; exit_code: number } : null;
  let usage = null;
  let capStop = false;
  let lines: ReturnType<RunProxy['usageLines']> = [];
  const paths: Record<string, string> = { dir: o.trialDir, result: resultPath, logs: join(o.trialDir, 'logs') };
  if (o.proxy) {
    const meter = await o.proxy.finalize(key);
    await o.proxy.unbind(slot);
    lines = o.proxy.usageLines(key);
    const s = summarizeUsage(key, meter, lines);
    usage = s.usage; capStop = s.cap_stop;
    paths.usage = join(o.trialDir, 'usage.json'); paths.reconcile = join(o.trialDir, 'reconcile.json');
    mkdirSync(o.trialDir, { recursive: true });
    writeAtomic(paths.usage, JSON.stringify(usage, null, 1) + '\n');
    writeAtomic(paths.reconcile, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
  }
  const decided: { termination: Termination; note?: string } = result ? trialTermination({ cellModel: cell.model, fromExits: result.termination, since: new Date(started).toISOString(), lines, capStop }) : { termination: capStop ? 'model_error' : 'infra_error' };
  if (decided.note) o.log(decided.note);
  const ended = Date.now();
  return {
    trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: 'smoke', model: cell.model, script: null,
    termination: decided.termination, grade: result?.grade ?? 'n/a', consent_violation: false, approval_stop: false, effects: [], predicates: [],
    cap_stop: capStop, turns: { planned: 1, run: result ? 1 : 0, exits: result ? [result.exit_code] : [] }, usage, wall_ms: ended - started,
    started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), paths,
    ...(result ? (decided.note ? { error: decided.note } : {}) : { error: redact(`HE-RUN-006 harnesses/run-trial.sh exited ${r.status} without result.json: ${(r.stderr || '').trim().slice(-300)}`) }),
  };
}

/** Set T (internal-task): OpenClaw, Claude Code, Codex and Hermes run the task on the serve entry, where their skill arms are wired
 *  (scripts/skill-resolver/ARMS.md): start/ and instruction.md are copied into the trial's workspace (/workspace, the adapter's
 *  working directory) before the harness starts, the request is one member DM, and that same workspace is graded. QM runs it on
 *  its run entry (harnesses/run-trial.sh), where its skill arms are wired, with the seeded default sandbox; capture.sh copies the
 *  sandbox workspace back. The checker grades the workspace (runner/trial/set-t.ts): grade is pass exactly when every check
 *  passed; n/a when the run left no workspace to grade. */
async function runSetTTrial(ctx: TrialContext): Promise<TrialRecord> {
  const { cell, trial } = ctx;
  const repoRoot = ctx.opts.repoRoot ?? '.';
  const taskDir = setTTaskDir(join(repoRoot, 'tasks'), trial.task);
  const runTask = mkdtempSync(join(tmpdir(), 'sett-task-'));
  try {
    let record: TrialRecord;
    if (cell.harness === 'qm') {
      writeRunTrialTask(taskDir, runTask);
      const env = setTEnv(cell);
      env.QM_SANDBOX_IMAGE = qmSandboxImage(runTask, repoRoot, process.env.QM_SANDBOX_IMAGE || undefined);
      ctx.log(`trial ${trial.id}: set T QM sandbox image ${env.QM_SANDBOX_IMAGE} (start/ and instruction.md at /root/workspace)`);
      record = await runSingleShot({ cell, trial, trialDir: ctx.trialDir, proxy: ctx.proxy, log: ctx.log, image: ctx.opts.image ?? skillArmImage(cell), repoRoot: ctx.opts.repoRoot, taskDir: runTask, env, network: ctx.opts.network ?? null });
      record.harness_mode = 'docker';
    } else {
      writeServeSetTTask(taskDir, runTask);
      // The grader's task schema has no set T task; the set T checker grades the workspace below.
      const grade: GradeFn = () => ({ grade: 'n/a', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
      record = await runTrial({ ...ctx, grade, trial: { ...trial, task_dir: runTask }, opts: { ...ctx.opts,
        harnessEnv: { ...ctx.opts.harnessEnv, ...(cell.skill_arm ? { HE_SKILL_ARM: cell.skill_arm } : {}) }, seedWorkspace: join(runTask, 'workspace') } });
    }
    const workspace = join(ctx.trialDir, 'workspace');
    if (!existsSync(workspace)) return { ...record, grade: 'n/a', error: record.error ?? `HE-RUN-006 set T trial ${trial.id} left no workspace to grade` };
    const setT = gradeSetTWorkspace(taskDir, workspace, cell.skill_arm ?? null, adapterWorkspaceEntries(cell.harness, taskDir, ctx.trialDir));
    if (cell.harness === 'qm') {
      const file = join(ctx.trialDir, 'logs', 'qm-default-sandbox.json');
      const made = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { set_default?: { http?: number; body?: { defaultSandboxId?: unknown } } } : null;
      setT.qm_default_sandbox = !!made?.set_default && made.set_default.http! >= 200 && made.set_default.http! < 300 && typeof made.set_default.body?.defaultSandboxId === 'string';
    }
    ctx.log(`trial ${trial.id}: set T ${setT.task} success=${setT.success} used_it=${setT.used_it} instruction_md=${setT.instruction_md}${setT.qm_default_sandbox === undefined ? '' : ` qm_default_sandbox=${setT.qm_default_sandbox}`}`);
    return { ...record, grade: setT.success ? 'pass' : 'fail', predicates: [], set_t: setT, paths: { ...record.paths, workspace } };
  } finally { rmSync(runTask, { recursive: true, force: true }); }
}

/** Phase B (internal-task): one request row as a member's one DM turn to a freshly started harness, on the serve entry like every
 *  multi-user trial (the skill arms run on that entry only, scripts/skill-resolver/ARMS.md); runner/trial/skill-requests.ts
 *  writes the one-turn task. QM runs it on its run entry instead (harnesses/run-trial.sh, as set T does): QM's skill arms are
 *  wired there only. The slot collects the forwarded request bodies for got-skill.json and, with the cell's request_cap,
 *  refuses the next request for the cell's model once that many were sent: the trial is then request_cap. grade is n/a (Got the
 *  skill is scored by analyze.ts from got-skill.json), and the trial directory is scrubbed of the request text. */
async function runSkillRequestTrial(ctx: TrialContext): Promise<TrialRecord> {
  const { cell, trial } = ctx;
  const row = readRequestSet(cell.requests!).find((r) => r.id === trial.task);
  if (!row) throw new RunnerError('HE-PREREG-004', `trial ${trial.id}: request ${trial.task} is not in the cell's request set ${cell.requests}; the set changed after planning. fix: plan a new run id`);
  const catalog = readCatalogNames(cell.catalog!);
  const texts = [row.sent, row.text, ...(row.prev_user_text ? [row.prev_user_text] : [])];
  const redact = (s: string) => redactRequest(s, texts).body;
  // The run log sits outside the scrubbed trial directory, and the turn loop writes the adapter's response detail to it.
  const log = (line: string) => ctx.log(redact(line));
  const taskDir = mkdtempSync(join(tmpdir(), 'skillreq-task-'));
  let scrubbed: ReturnType<typeof scrubTrialDir> | null = null;
  try {
    const slotLimits = { collect_requests: true, ...(cell.request_cap ? { max_requests: cell.request_cap } : {}) };
    let record: TrialRecord;
    if (cell.harness === 'qm') {
      // QM wires its skill arms on the run entry only, and its serve entry cannot register the world at this pin (harnesses/qm/README.md).
      writeRunRequestTask(row, taskDir);
      record = await runSingleShot({ cell, trial, trialDir: ctx.trialDir, proxy: ctx.proxy, log, image: ctx.opts.image ?? skillArmImage(cell), repoRoot: ctx.opts.repoRoot, taskDir, env: setTEnv(cell), network: ctx.opts.network ?? null, bind: slotLimits, redact });
      record.harness_mode = 'docker';
    } else {
      writeRequestTask(row, taskDir);
      // The grader's task schema has no Phase B task and Phase B has no predicates: Got the skill is scored from got-skill.json.
      const grade: GradeFn = () => ({ grade: 'n/a', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
      record = await runTrial({ ...ctx, log, grade, trial: { ...trial, task_dir: taskDir }, opts: { ...ctx.opts,
        harnessEnv: { ...ctx.opts.harnessEnv, ...(cell.skill_arm ? { HE_SKILL_ARM: cell.skill_arm } : {}) }, slotLimits } });
    }
    const key = trialKey(trial.id);
    // refused: the first body the request cap refused, which carries the last step's tool calls; read for Got the skill and the
    // clean-arm count, never for block delivery (the model never saw it).
    const { requests, refused } = ctx.proxy ? await ctx.proxy.requests(key) : { requests: [], refused: [] };
    mkdirSync(ctx.trialDir, { recursive: true });
    const got = gotSkillRecord(cell.harness, catalog, requests, ctx.trialDir, refused);
    const delivery = cell.harness === 'qm' ? null : checkBlockDelivery(ctx.trialDir, requests);
    const cleanArm = gstackReads(cell.harness, [...requests, ...refused], ctx.trialDir);
    const gotPath = join(ctx.trialDir, 'got-skill.json');
    writeAtomic(gotPath, JSON.stringify(got.file, null, 1) + '\n');
    // The trials #491's cd handling could get wrong are flagged for settling by hand (scripts/skills-at-scale/flags.ts).
    const flags = flagTrial({ harness: cell.harness, catalog, requests: [...requests, ...refused], trialDir: ctx.trialDir });
    writeAtomic(join(ctx.trialDir, FLAG_FILE), JSON.stringify(flags, null, 1) + '\n');
    // Saw the right skill (skills-at-scale outcome 1): the catalog skills the captured requests listed or a resolver block named.
    const descriptions = readCatalogDescriptions(cell.catalog!);
    if (descriptions) writeAtomic(join(ctx.trialDir, SAW_FILE), JSON.stringify(sawSkill({ harness: cell.harness, catalog: descriptions, requests }), null, 1) + '\n');
    // The usage log is append-only across a resume: only this attempt's lines count, as in trialTermination.
    const lines = ctx.proxy ? ctx.proxy.usageLines(key).filter((l) => l.at === undefined || l.at >= record.started_at) : [];
    const capped = lines.some((l) => l.outcome === 'refused' && (l.reason ?? '').startsWith(REQUEST_CAP));
    const modelRequests = lines.filter((l) => l.outcome !== 'refused' && `${l.provider}:${l.model}` === cell.model).length;
    const termination: Termination = capped && !record.cap_stop && record.termination !== 'infra_error' ? 'request_cap' : record.termination;
    scrubbed = scrubTrialDir(ctx.trialDir, texts);
    const paths = Object.fromEntries(Object.entries({ ...record.paths, got_skill: gotPath }).filter(([k, v]) => k === 'dir' || existsSync(v)));
    ctx.log(`trial ${trial.id}: skill request ${cell.request_set}/${row.id} termination=${termination} model_requests=${modelRequests}${cell.request_cap ? '/' + cell.request_cap : ''} got_skill=${got.opened.join(',') || '-'}${delivery ? ` blocks pushed=${delivery.pushed} carried=${delivery.carried} shadow=${delivery.shadow} leaked=${delivery.leaked}` : ''} gstack_reads=${cleanArm.gstack_reads}${cleanArm.contaminated ? ' contaminated' : ''} kept=${scrubbed.kept.length} removed=${scrubbed.removed} redacted_lines=${scrubbed.redacted_lines}`);
    return {
      ...record, termination, grade: 'n/a', predicates: [], ...(record.error ? { error: redact(record.error) } : {}), paths,
      skill_request: { set: cell.request_set!, request_id: row.id,
        ...(cell.private ? {} : { request_sha256: sha256(row.sent), prev_user_sha256: row.prev_user_text === null ? null : sha256(row.prev_user_text) }),
        arm: cell.skill_arm ?? null, model_requests: modelRequests, request_cap: cell.request_cap ?? null, got_skill: got.opened, ...(delivery ? { block_delivery: delivery } : {}),
        clean_arm: { ...cleanArm, paths: cleanArm.paths.map(redact) }, scrubbed },
    };
  } catch (e) {
    // A harness that never started goes to not-started.jsonl with its message, redacted here as record.error is.
    if (e instanceof HarnessNotStarted) e.message = redact(e.message);
    throw e;
  } finally {
    // A throw before the scrub (the trial, a malformed status line, a trace read) still leaves no request text in the trial directory.
    if (!scrubbed && existsSync(ctx.trialDir)) scrubTrialDir(ctx.trialDir, texts);
    rmSync(taskDir, { recursive: true, force: true });
  }
}
