// The gbrain time-to-first-wow eval (docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md): one trial, start to finish.
// The runner writes the trial's synthetic HOME (scripts/gbrain-first-wow/fixtures.ts) into the state directory, mounted at the
// fixtures' HOME (/home/dev), with ~/.claude and ~/.codex linked to the adapters' own state directories, and starts the harness in install mode, so the adapter
// wires no MCP server of its own and the proxy token never sits in a shell. In the gbrain arms the runner then runs gbrain setup
// inside the container, scripted, as the arm says, and checks the registration it wrote. The question session is one fresh session
// in the target project's folder with questionPrompt; when the reply ends by asking for input, the runner answers once. After it, the
// gbrain arms dump the brain with gbrain export, and the trial is scored by rule (scripts/gbrain-first-wow/score.ts). The token is
// scrubbed from every file and a canary scan must come back clean, as in the install eval (runner/trial/install.ts).

import { existsSync, lstatSync, mkdirSync, chmodSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Termination, TrialRecord, TrialUsage, TurnRequest } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { cellModels, type Cell } from '../run.ts';
import { HarnessGone, type Harness, awaitResponse, makeTrialDirs, writeAtomic, writeRequest } from './harness.ts';
import { startDockerHarness } from './docker.ts';
import { reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from './proxy.ts';
import { type TrialContext, classify, foreignModels, trialTermination } from './trial.ts';
import { InstallLeak, PROVIDER_KEY_NAMES, canaryScan, scrubToken } from './install.ts';
import { FIRST_WOW_SLICE, MAX_ACCEPTS, PERSON_REPLY, QUESTION_BUDGET_S, REGISTRATION, SETUP_TIMEOUT_S, FALLBACK_MARKERS, suggestionIn, type FirstWowArm, type FirstWowCellConfig, imageFor, packRawBrain, readRegistration, seedOfTask, setupArgv } from './first-wow-cell.ts';
import { asksForInput } from '../../scripts/gbrain-install/classify.ts';
import { type NEvent, parseTurn } from '../../scripts/gbrain-install/transcript.ts';
import { HOME_DIR, buildFixture, personaFor, questionPrompt, writeFixture, type FixtureManifest } from '../../scripts/gbrain-first-wow/fixtures.ts';
import { applyCodingTask, codingTaskForSeed, gradeCodingTask, type CodingGrade } from '../../scripts/gbrain-first-wow/coding.ts';
import { type Arm, type BrainPage, readBrainExport, scoreNoHistory, scoreTrial, splitAnswers } from '../../scripts/gbrain-first-wow/score.ts';
import { CODING_CHECK_RULES } from '../../scripts/c2-standing-rules/items.ts';
import { SECTION_MARKER, parseRules } from '../../scripts/c2-standing-rules/score.ts';

/** The reply that is scored: the first one that is a numbered list of the three answers, else the last non-empty one. Once the
 *  session has answered, a follow-up after the runner's one reply does not replace the answers (pilot 1, 2026-11-25). */
export function scoredReply(replies: ReadonlyArray<string | null>): string {
  const given = replies.filter((r): r is string => !!r && r.trim().length > 0);
  return given.find((r) => splitAnswers(r) !== null) ?? given[given.length - 1] ?? '';
}

/** The runner answers once only when the reply ends by asking for input (asksForInput) and its last line holds a question mark: an
 *  offer or a hedge such as "you may want to confirm it" ends no turn for the person (pilot 1, 2026-11-25). */
export function needsPerson(reply: string): boolean {
  const lines = reply.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return asksForInput(reply) && (lines[lines.length - 1] ?? '').includes('?');
}

/** One trial's score from what it left: the fixture, the replies, the session's tool events, the brain and setup's history. */
export function scoreFirstWow(o: { manifest: FixtureManifest; arm: Arm; replies: ReadonlyArray<string | null>; events: NEvent[]; brain: BrainPage[]; readFile: (rel: string) => string | null; setupOutput: string; fileRoots?: readonly string[]; sessionStart?: string }) {
  const input = { manifest: o.manifest, arm: o.arm, reply: scoredReply(o.replies), events: o.events, brain: o.brain, readFile: o.readFile, setupOutput: o.setupOutput, fallbackMarkers: FALLBACK_MARKERS, ...(o.fileRoots ? { fileRoots: o.fileRoots } : {}), ...(o.sessionStart ? { sessionStart: o.sessionStart } : {}) };
  return o.manifest.persona === 'no-history' ? scoreNoHistory(input) : scoreTrial(input);
}

export interface Exec { status: number; stdout: string; stderr: string; ms: number }
/** docker exec in the harness container with a clean environment: HOME, PATH and the harness's state dir only, never a token.
 *  Asynchronous, because the metering proxy answers in this process. */
export async function execIn(container: string, harness: string, argv: string[], timeoutS: number): Promise<Exec> {
  const stateVar = harness === 'codex' ? `CODEX_HOME=${HOME_DIR}/codex` : `CLAUDE_CONFIG_DIR=${HOME_DIR}/claude`;
  const args = ['docker', 'exec', '-w', HOME_DIR, container, 'env', '-i', `HOME=${HOME_DIR}`, 'PATH=/usr/local/bin:/usr/bin:/bin', stateVar, 'timeout', String(timeoutS), ...argv];
  const t0 = Date.now();
  const proc = Bun.spawn(args, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { status, stdout, stderr, ms: Date.now() - t0 };
}

/** execIn for an owner command that asks for a short code (gbrain rules approve, and gbrain correct run by the owner): the same
 *  clean environment, with no agent marker, under a pseudo-terminal that types the code the command prints, as the owner would
 *  (scripts/c2-standing-rules/pty-answer.py). The C2 standing-rules eval only. */
export async function execOwnerAtTerminal(container: string, harness: string, argv: string[], repoRoot: string): Promise<Exec> {
  const stateVar = harness === 'codex' ? `CODEX_HOME=${HOME_DIR}/codex` : `CLAUDE_CONFIG_DIR=${HOME_DIR}/claude`;
  const cmd = ['python3', join(repoRoot, 'scripts', 'c2-standing-rules', 'pty-answer.py'), 'docker', 'exec', '-it', '-w', HOME_DIR, container, 'env', '-i', `HOME=${HOME_DIR}`, 'PATH=/usr/local/bin:/usr/bin:/bin', 'TERM=dumb', stateVar, ...argv];
  const t0 = Date.now();
  const proc = Bun.spawn(cmd, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { status, stdout, stderr, ms: Date.now() - t0 };
}

/** The history object of one setup --json run, without its printed lines. */
export function historyOf(stdout: string): Record<string, unknown> | null {
  try { const h = (JSON.parse(stdout) as { history?: Record<string, unknown> }).history; if (!h) return null; const { lines: _lines, ...rest } = h; return rest; } catch { return null; }
}

/** PR 2's suggestion marker of one setup --json run (state armed, off or unknown, and why), or null when setup printed none. */
function suggestionOf(stdout: string): Record<string, unknown> | null {
  try { return (JSON.parse(stdout) as { suggestion?: Record<string, unknown> }).suggestion ?? null; } catch { return null; }
}

export interface FirstWowTurn { turn: number; role: 'question' | 'person'; reply_text: string | null; exit: number; started_at: string; ended_at: string; events: number }
export interface TrialFirstWow {
  arm: FirstWowArm; seed: number; persona: FixtureManifest['persona']; gbrain_commit: string | null; image: string; image_record: unknown;
  setup: Array<{ argv: string[]; exit: number; ms: number; history: Record<string, unknown> | null; suggestion?: Record<string, unknown> | null }>;
  /** gbrain onboarding status --json after the question session, on a build with the suggestion. */
  onboarding?: unknown;
  /** Whether the first session's transcript holds PR 2's section, and the pages it lists; on a build with the suggestion. */
  suggestion_seen?: { seen: boolean; pages: string[]; brain_text: string; files: string[] };
  setup_ms: number; registration: { file: string; args: string[] | null; ok: boolean } | null;
  sessions_imported: number | null; brain_pages: number | null; export_ok: boolean | null;
  question_ms: number | null; person_needed: number; turns: FirstWowTurn[];
  score: unknown;
  /** The coding check's task and grade, when the session was a coding task. */
  coding?: { task: string; grade: CodingGrade | null };
  /** The C2 coding check: the 30 owner rules saved, how many came back confirmed, the switch, and whether the session's
   *  transcript holds the standing-rules section. */
  standing_rules?: { state: 'on' | 'off'; saved: number; failed: number; confirmed: number; switch_exit: number | null; section_seen: boolean; files: string[] };
}

const readText = (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

/** PR 2's section in the trial's own session transcripts: Claude Code's project jsonl and turn log, and Codex's rollout, written since
 *  the trial started (the fixture's older sessions never hold it). */
function sessionSuggestion(state: string, logs: string, since: number): { seen: boolean; pages: string[]; brain_text: string; files: string[] } {
  const files: string[] = [];
  const walk = (dir: string) => { let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) { const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) walk(p); else if (n.endsWith('.jsonl') && st.mtimeMs >= since) files.push(p); } };
  for (const d of [join(state, 'claude', 'projects'), join(state, 'codex', 'sessions'), join(logs, 'turns')]) walk(d);
  const hits = files.map((f) => ({ f, s: suggestionIn(readText(f)) })).filter((x) => x.s.seen);
  return { seen: hits.length > 0, pages: [...new Set(hits.flatMap((x) => x.s.pages))], brain_text: [...new Set(hits.flatMap((x) => x.s.brain_text ? x.s.brain_text.split('\n') : []))].join('\n'), files: hits.map((x) => x.f.startsWith(state) ? 'state' + x.f.slice(state.length) : 'logs' + x.f.slice(logs.length)) };
}

/** Whether a session transcript written in [since, until) holds marker: Claude Code's project jsonl, Codex's rollout and the turn
 *  log, as sessionSuggestion reads them. The C2 standing-rules eval looks for its section's first line this way. */
/** The trial record with the trial token replaced, so trials.jsonl never holds it (scrubToken covers files on disk only). */
export function scrubRecord<T>(record: T, token: string): T {
  if (!record || !token) return record;
  const s = JSON.stringify(record);
  return s.includes(token) ? JSON.parse(s.split(token).join('[trial-token-removed]')) as T : record;
}

/** Provider key names whose values appear in the serialized trial record. */
export function recordKeyNames(record: unknown, env: Record<string, string | undefined>): string[] {
  if (!record) return [];
  const s = JSON.stringify(record);
  return PROVIDER_KEY_NAMES.filter((k) => !!env[k] && s.includes(env[k]!));
}

export function transcriptMarker(state: string, logs: string, since: number, marker: string, until = Infinity): { seen: boolean; files: string[] } {
  const files: string[] = [];
  const walk = (dir: string) => { let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) { const p = join(dir, n); let st; try { st = lstatSync(p); } catch { continue; } if (st.isDirectory()) walk(p); else if (st.isFile() && n.endsWith('.jsonl') && st.mtimeMs >= since && st.mtimeMs < until) files.push(p); } };
  for (const d of [join(state, 'claude', 'projects'), join(state, 'codex', 'sessions'), join(logs, 'turns')]) { try { if (lstatSync(d).isDirectory()) walk(d); } catch { /* not there */ } }
  const hits = files.filter((f) => readText(f).includes(marker));
  return { seen: hits.length > 0, files: hits.map((f) => f.startsWith(state) ? 'state' + f.slice(state.length) : 'logs' + f.slice(logs.length)) };
}

const CONVERSATION = 'first-wow';

export async function runFirstWowTrial(ctx: Omit<TrialContext, 'grade'> & { keyEnv?: Record<string, string | undefined> }): Promise<TrialRecord> {
  if (ctx.cell.harness === 'qm') return (await import('./first-wow-qm.ts')).runFirstWowQmTrial(ctx);
  const { cell, trial, opts, log } = ctx;
  const fw = (cell as Cell & { first_wow: FirstWowCellConfig }).first_wow;
  if (fw.task === 'correction') return (await import('./c2-rules.ts')).runC2Trial(ctx);
  const repoRoot = resolve(opts.repoRoot ?? '.');
  if (opts.harnessMode !== 'docker' || !opts.network) throw new RunnerError('HE-NET-001', `cell ${cell.id}: a first-wow trial runs in docker mode on the internal network; fix: run it through executeRun with --harness-mode docker`);
  const seed = seedOfTask(trial.task);
  if (seed === null) throw new RunnerError('HE-PREREG-007', `trial ${trial.id}: task ${trial.task} is not a seed-NNNN task`);
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  if (existsSync(ctx.trialDir)) for (const e of readdirSync(ctx.trialDir)) rmSync(join(ctx.trialDir, e), { recursive: true, force: true });
  const dirs = makeTrialDirs(ctx.trialDir);
  const harnessName = cell.harness as 'claude-code' | 'codex';
  const fixture = buildFixture(seed, personaFor(seed), harnessName, started);
  // The adapters keep Claude Code's and Codex's state in $HOME/claude and $HOME/codex. A person has them at ~/.claude and ~/.codex,
  // where the fixture writes the history and gbrain's import reads it, so ~/.claude and ~/.codex link to the adapters' directories.
  for (const d of ['claude', 'codex']) { mkdirSync(join(dirs.state, d), { recursive: true }); symlinkSync(d, join(dirs.state, '.' + d)); }
  writeFixture(fixture, dirs.state, join(dirs.root, 'fixture.json'));
  const codingTask = fw.task === 'coding' ? codingTaskForSeed(seed) : null;
  const coding = codingTask ? applyCodingTask(fixture, codingTask) : null;
  if (coding) for (const [rel, body] of coding.files) { mkdirSync(dirname(join(dirs.state, rel)), { recursive: true }); writeFileSync(join(dirs.state, rel), body); }
  const manifest = fixture.manifest;
  const target = manifest.projects[0]!;
  const image = imageFor(cell as Cell & { first_wow: FirstWowCellConfig });
  const gbrainArm = fw.arm !== 'plain';
  const key = trialKey(trial.id);
  const token = trialToken(trial.id);
  const slot = trialSlug(trial.id);
  const container = `he-${slot}`;
  const provider = cell.model.slice(0, cell.model.indexOf(':'));
  const proxy = ctx.proxy;
  const secretDir = join(dirs.root, 'secret');
  mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  chmodSync(secretDir, 0o700);
  writeFileSync(join(secretDir, 'token'), token, { mode: 0o600 });
  const installDir = join(repoRoot, 'harnesses', '_install');
  const setupDir = join(dirs.root, 'setup');
  mkdirSync(setupDir, { recursive: true });
  let record: TrialRecord | null = null;
  let thrown: unknown = null;
  try {
    const env: Record<string, string> = {
      HE_INSTALL_MODE: '1', HE_TASK_SLICE: FIRST_WOW_SLICE, HE_INSTALL_DIR: '/he-install',
      HE_MODEL_BASE_URL: proxy ? proxy.baseUrlFor(slot, provider, true) : 'http://127.0.0.1:1/none',
      HE_MODEL_API_KEY_FILE: '/he-secret/token', HE_MODEL_NAME: cell.model.slice(cell.model.indexOf(':') + 1),
      HE_TIME_BUDGET_S: String(QUESTION_BUDGET_S), HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: HOME_DIR, HE_TURNS_DIR: '/he-turns',
      HE_WORKSPACE_DIR: `${HOME_DIR}/${target.dir}`, HE_TRIAL_ID: trial.id, ...(opts.harnessEnv ?? {}),
    };
    const paths: Record<string, string> = { dir: dirs.root, logs: dirs.logs, fixture: join(dirs.root, 'fixture.json'), first_wow: join(dirs.root, 'first-wow.json') };
    if (proxy) { paths.usage = join(dirs.root, 'usage.json'); paths.reconcile = join(dirs.root, 'reconcile.json'); }
    log(`first-wow trial ${trial.id}: arm ${fw.arm}, seed ${seed} (${manifest.persona}), image ${image}, question session in ${target.dir}`);

    let harness: Harness | null = null;
    let readyFailure: HarnessGone | null = null;
    let error: string | undefined;
    let setupError = false;
    let infra: string | null = null;
    let usage: TrialUsage | null = null;
    let capStop = false;
    let modelMismatch = false;
    let ended = false;
    let imageRecord: unknown = null;
    const setup: TrialFirstWow['setup'] = [];
    let registration: TrialFirstWow['registration'] = null;
    let brain: BrainPage[] = [];
    let exportOk: boolean | null = null;
    let onboarding: unknown;
    let standingRules: TrialFirstWow['standing_rules'];
    const turns: FirstWowTurn[] = [];
    const events: NEvent[] = [];
    const note = (msg: string) => { log(msg); error = error ? `${error}; ${msg}` : msg; };

    const ask = async (role: FirstWowTurn['role'], text: string): Promise<FirstWowTurn | null> => {
      if (ended || !harness) return null;
      const n = turns.length + 1;
      const req: TurnRequest = { turn: n, trial_id: trial.id, prompt: text, actor: { member: 'user', slack_user_id: 'U0FIRSTWOW', name: 'User', role: 'user', team: null },
        channel: { id: CONVERSATION, name: CONVERSATION, type: 'channel' }, text, ts: (Date.now() / 1000).toFixed(6), thread_ts: null, sim_now: new Date().toISOString(), time_budget_s: QUESTION_BUDGET_S };
      const turnStart = new Date().toISOString();
      writeRequest(dirs.turns, req);
      harness.notify?.(req);
      let exit = 0;
      let reply: string | null = null;
      try {
        const res = await awaitResponse(dirs.turns, n, (QUESTION_BUDGET_S + opts.turnGraceS) * 1000, harness);
        if (!res) { log(`turn ${n}: HE-ADAPTER-003 no response after ${QUESTION_BUDGET_S + opts.turnGraceS} s; killing the harness, exit 124`); await harness.kill(); exit = 124; ended = true; }
        else { exit = [0, 2, 3, 124].includes(Number(res.exit)) ? Number(res.exit) : 2; reply = res.reply_text ?? null; }
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        exit = e.exit === 3 ? 3 : 2; ended = true; log(`turn ${n}: ${e.message}`);
      }
      const ev = parseTurn(cell.harness, dirs.logs, n, CONVERSATION);
      events.push(...ev);
      const t: FirstWowTurn = { turn: n, role, reply_text: reply, exit, started_at: turnStart, ended_at: new Date().toISOString(), events: ev.length };
      turns.push(t);
      log(`turn ${n} (${role}): exit ${exit}, ${ev.length} transcript events`);
      return t;
    };

    try {
      if (proxy) await proxy.bind(slot, key, token, cellModels(cell), undefined, false, {}, true);
      try {
        harness = await startDockerHarness({ harness: cell.harness, image, trialSlug: slot, dirs, env, repoRoot: opts.repoRoot, network: opts.network, stateMount: HOME_DIR,
          readOnlyMounts: { [secretDir]: '/he-secret', [installDir]: '/he-install' } });
        await harness.waitReady(opts.readyTimeoutS * 1000);
        log('harness ready (docker, install mode, HOME /home/dev)');
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        readyFailure = e;
        note(/HE-INSTALL-003[^\n]*/.exec(readText(join(dirs.logs, 'adapter.log')) + readText(join(dirs.logs, 'docker.log')))?.[0] ?? `HE-ADAPTER-002 ${e.message}`);
      }
      if (!readyFailure) {
        const probe = await execIn(container, cell.harness, ['sh', '-c', 'cat /opt/first-wow/image.json 2>/dev/null; command -v gbrain bun || true'], 30);
        imageRecord = probe.stdout.trim();
        const rec = (() => { try { return JSON.parse(probe.stdout.trim().split('\n')[0] ?? '') as { gbrain_commit?: string; gbrain_version?: string }; } catch { return null; } })();
        if (gbrainArm && (rec?.gbrain_commit !== fw.gbrain_commit || rec?.gbrain_version !== fw.gbrain_version))
          throw new RunnerError('HE-FIRSTWOW-001', `image ${image} records gbrain ${JSON.stringify(rec)}, not the cell's ${fw.gbrain_commit} (${fw.gbrain_version}); fix: bash harnesses/_first-wow/build.sh ${fw.gbrain_commit} ${fw.gbrain_version}`);
        if (!gbrainArm && /gbrain|bun/.test(probe.stdout)) throw new RunnerError('HE-FIRSTWOW-001', `image ${image} of the plain arm has gbrain or bun (${probe.stdout.trim().slice(0, 200)}); the plain arm must run with no gbrain. fix: use harness-eval/${cell.harness}:dev`);
        if (gbrainArm) {
          let argv = setupArgv(cell.harness, fw.arm, fw.suggestion_switch === true);
          for (let run = 1; argv.length; run++) {
            const r = await execIn(container, cell.harness, argv, SETUP_TIMEOUT_S);
            writeFileSync(join(setupDir, `setup-${run}.json`), r.stdout);
            writeFileSync(join(setupDir, `setup-${run}.stderr.log`), r.stderr);
            const history = historyOf(r.stdout);
            const suggestion = fw.suggestion_switch ? suggestionOf(r.stdout) : undefined;
            setup.push({ argv, exit: r.status, ms: r.ms, history, ...(suggestion !== undefined ? { suggestion } : {}) });
            log(`setup ${run}: ${argv.slice(1).join(' ')} exit ${r.status} in ${r.ms} ms, history ${history ? `${history.status} (${history.sessions_imported} imported)` : 'missing'}${suggestion !== undefined ? `, suggestion ${suggestion?.state ?? 'missing'}` : ''}`);
            if (r.status !== 0) { setupError = true; note(`HE-FIRSTWOW-003 trial ${trial.id}: gbrain setup run ${run} exited ${r.status}; see setup/setup-${run}.stderr.log`); break; }
            const decision = (history?.decision as { accept_argv?: string[] } | null | undefined)?.accept_argv;
            argv = fw.arm === 'full' && decision && run <= MAX_ACCEPTS ? [...decision, '--json'] : [];
          }
          registration = readRegistration(cell.harness, dirs.state);
          if (!setupError && !registration.ok) { setupError = true; note(`HE-FIRSTWOW-002 trial ${trial.id}: the gbrain entry in ${registration.file} has args ${JSON.stringify(registration.args)}, not gbrain ${REGISTRATION[cell.harness]!.join(' ')}; the trial stops as a setup error`); }
        }
        if (!setupError && fw.standing_rules) {
          const runs = [];
          for (const [i, rule] of CODING_CHECK_RULES.entries()) {
            const r = await execOwnerAtTerminal(container, cell.harness, ['gbrain', 'correct', rule, '--json'], repoRoot);
            writeFileSync(join(setupDir, `rule-${String(i + 1).padStart(2, '0')}.log`), r.stdout + (r.stderr ? '\n--- stderr\n' + r.stderr : ''));
            runs.push(r.status);
          }
          const sw = fw.standing_rules === 'on' ? await execIn(container, cell.harness, ['gbrain', 'config', 'set', 'rules.session_start', 'on'], SETUP_TIMEOUT_S) : null;
          const list = await execIn(container, cell.harness, ['gbrain', 'rules', 'list', '--json'], SETUP_TIMEOUT_S);
          writeFileSync(join(setupDir, 'rules-list.json'), list.stdout);
          const confirmed = parseRules(list.stdout).filter((x) => x.status === 'active' && x.confirmed).length;
          standingRules = { state: fw.standing_rules, saved: runs.filter((s) => s === 0).length, failed: runs.filter((s) => s !== 0).length, confirmed, switch_exit: sw?.status ?? null, section_seen: false, files: [] };
          log(`standing rules: ${standingRules.saved} saved, ${standingRules.failed} failed, ${confirmed} confirmed, switch ${fw.standing_rules}${sw ? ` (exit ${sw.status})` : ''}`);
          if (confirmed !== CODING_CHECK_RULES.length || (sw && sw.status !== 0)) { setupError = true; note(`HE-C2-002 trial ${trial.id}: ${confirmed} of ${CODING_CHECK_RULES.length} owner rules confirmed${sw && sw.status !== 0 ? `, rules.session_start set exited ${sw.status}` : ''}; the trial stops as a setup error`); }
        }
        if (!setupError) {
          const q = await ask('question', coding ? coding.prompt : questionPrompt(manifest));
          if (q?.reply_text && q.exit === 0 && needsPerson(q.reply_text)) await ask('person', PERSON_REPLY);
          if (gbrainArm && harness && !ended && fw.suggestion_switch) {
            const r = await execIn(container, cell.harness, ['gbrain', 'onboarding', 'status', '--json'], SETUP_TIMEOUT_S);
            writeFileSync(join(setupDir, 'onboarding-status.json'), r.stdout + (r.stderr ? '\n--- stderr\n' + r.stderr : ''));
            try { onboarding = JSON.parse(r.stdout); } catch { onboarding = { exit: r.status, unparsed: r.stdout.slice(0, 400) }; }
          }
          if (gbrainArm && harness && !ended && turns.every((t) => t.exit === 0)) {
            const out = '/he-logs/brain-export';
            const r = await execIn(container, cell.harness, ['gbrain', 'export', '--dir', out], SETUP_TIMEOUT_S);
            writeFileSync(join(setupDir, 'export.log'), r.stdout + r.stderr);
            try { brain = readBrainExport(join(dirs.logs, 'brain-export')); exportOk = true; }
            catch (e) { exportOk = false; infra = `HE-FIRSTWOW-004 trial ${trial.id}: ${(e as Error).message}; the trial is infra_error`; note(infra); }
          }
        }
      }
      if (harness) await harness.stop(opts.stopGraceS * 1000);
      if (proxy) {
        const meter = await proxy.finalize(key);
        const lines = proxy.usageLines(key);
        const summary = summarizeUsage(key, meter, lines);
        usage = summary.usage;
        capStop = summary.cap_stop;
        const foreign = foreignModels(cell.model, usage.by_model, lines, 'off', cell.utility_models ?? []);
        if (foreign.length) { modelMismatch = true; note(`HE-MODEL-001 trial ${trial.id} ran model(s) ${foreign.join(', ')} beside the cell's ${cell.model}; the trial is model_error`); }
        writeAtomic(paths.usage!, JSON.stringify(usage, null, 1) + '\n');
        writeAtomic(paths.reconcile!, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
      }
    } finally {
      if (harness) await harness.stop(opts.stopGraceS * 1000).catch(() => undefined);
      if (proxy) await proxy.unbind(slot).catch(() => undefined);
      rmSync(secretDir, { recursive: true, force: true });
    }

    // The coding check is graded outside the harness, in a no-network container of the arm's image, on a copy of the project.
    let codingGrade: CodingGrade | null = null;
    if (coding && codingTask && turns.length) codingGrade = await gradeCodingTask(join(dirs.state, coding.project), codingTask, undefined, (dir, testFile) =>
      ['docker', 'run', '--rm', '--network', 'none', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '-e', 'HOME=/tmp', '--tmpfs', '/tmp', '-v', `${dir}:/work`, '-w', '/work', '--entrypoint', 'bun', image, 'test', './' + testFile]);
    const setupOutput = setup.map((s) => JSON.stringify(s.history)).join('\n');
    const readFile = (rel: string) => { try { return readFileSync(join(dirs.state, rel), 'utf8'); } catch { return null; } };
    const suggestionSeen = fw.suggestion_switch ? sessionSuggestion(dirs.state, dirs.logs, started) : undefined;
    if (standingRules) { const m = transcriptMarker(dirs.state, dirs.logs, started, SECTION_MARKER); standingRules.section_seen = m.seen; standingRules.files = m.files; }
    const score = coding ? null : turns.length ? scoreFirstWow({ manifest, arm: fw.arm as Arm, replies: turns.map((t) => t.reply_text), events, brain, readFile, setupOutput, sessionStart: suggestionSeen?.brain_text }) : null;
    const exits = turns.map((t) => t.exit);
    const fromExits: Termination = readyFailure ? classify([], readyFailure, null, false) : setupError ? 'harness_error' : classify(exits, null, null, false);
    const decided = trialTermination({ cellModel: cell.model, fromExits, since: started_at, lines: proxy ? proxy.usageLines(key) : [], capStop, modelMismatch, infra: !!infra });
    if (decided.note) note(decided.note);
    const firstWow: TrialFirstWow = {
      arm: fw.arm, seed, persona: manifest.persona, gbrain_commit: fw.gbrain_commit ?? null, image, image_record: imageRecord,
      setup, ...(onboarding !== undefined ? { onboarding } : {}), ...(suggestionSeen ? { suggestion_seen: suggestionSeen } : {}), setup_ms: setup.reduce((s, x) => s + x.ms, 0), registration,
      sessions_imported: gbrainArm ? Math.max(0, ...setup.map((x) => Number(x.history?.sessions_imported) || 0)) : null,
      brain_pages: gbrainArm && exportOk ? brain.length : null, export_ok: exportOk,
      question_ms: turns.length ? Date.parse(turns[turns.length - 1]!.ended_at) - Date.parse(turns[0]!.started_at) : null,
      person_needed: turns.filter((t) => t.role === 'person').length, turns, score,
      ...(codingTask ? { coding: { task: codingTask.id, grade: codingGrade } } : {}),
      ...(standingRules ? { standing_rules: standingRules } : {}),
    };
    writeAtomic(paths.first_wow!, JSON.stringify(firstWow, null, 1) + '\n');
    const s = score as { finish_any?: boolean; correct_abstention?: boolean } | null;
    log(`first-wow trial ${trial.id}: ${decided.termination}, ${codingTask ? `coding ${codingTask.id} passed ${codingGrade?.passed ?? null} (${codingGrade?.pass ?? 0} pass, ${codingGrade?.fail ?? 0} fail)` : manifest.persona === 'no-history' ? `abstained ${s?.correct_abstention}` : `finish ${s?.finish_any}`}, sessions imported ${firstWow.sessions_imported}, brain pages ${firstWow.brain_pages}`);
    const endedAt = Date.now();
    record = {
      trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: 'docker', model: cell.model, script: null,
      termination: decided.termination, grade: 'n/a', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: capStop,
      turns: { planned: 2, run: turns.length, exits }, usage, wall_ms: endedAt - started, started_at, ended_at: new Date(endedAt).toISOString(), paths,
      ...(error ? { error } : {}), first_wow: firstWow,
    };
  } catch (e) {
    thrown = e;
    throw e;
  } finally {
    rmSync(secretDir, { recursive: true, force: true });
    const scrubbed = scrubToken(dirs.root, token);
    const canary = canaryScan(dirs.root, token, ctx.keyEnv ?? process.env);
    record = scrubRecord(record, token);
    const recordKeys = recordKeyNames(record, ctx.keyEnv ?? process.env);
    const found = canary.token_files.length > 0 || canary.key_names.length > 0 || recordKeys.length > 0;
    log(`first-wow trial ${trial.id}: token scrubbed from ${scrubbed.length} file(s) and the record; canary ${found ? 'FOUND' : 'clean'}`);
    if (found) throw new InstallLeak(recordKeys.length ? null : record, `HE-INSTALL-005 after first-wow trial ${trial.id}${thrown ? ' (which threw)' : ''}: ${canary.token_files.length ? `the trial token is still in ${canary.token_files.join(', ')}` : ''}${canary.key_names.length ? ` provider key value(s) of ${canary.key_names.join(', ')} found` : ''}${recordKeys.length ? ` provider key value(s) of ${recordKeys.join(', ')} in the trial record` : ''}; the run stops`);
  }
  const packed = packRawBrain(dirs.state);
  if (packed.length) log(`first-wow trial ${trial.id}: packed the trial home (${packed.join(', ')})`);
  return record!;
}
