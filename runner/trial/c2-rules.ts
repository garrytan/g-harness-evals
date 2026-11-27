// The C2 standing-rules eval (docs/benchmarks/2026-12-c2-standing-rules/PREREGISTRATION.md): one correction trial, start to
// finish. A user corrects their agent in one harness; a fresh session in the other harness gets a task where the old mistake
// would show. The trial's HOME is one state directory mounted at /home/dev in two containers in turn, so both harnesses share one
// gbrain brain, as one person's would:
//   1. Session 1's harness (the cell's harness and model) starts in install mode; the runner runs gbrain setup for it, as the
//      time-to-first-wow eval's defaults arm does, switches rules.session_start on, and plants the item's page and wrong fact as
//      the owner. Session 1 is the item's question, then the correction in fixed words ending in the arm's suffix (the floor arm
//      sends no correction).
//   2. Rules and control arms: the runner approves, as the owner at a terminal (scripts/c2-standing-rules/pty-answer.py under a pty, no
//      agent marker), every rule session 1 saved that is not yet confirmed: an active one, or a proposed one (a correct call over
//      MCP on a brain with no owner set proposes the rule, and the owner's approval also fixes the fact; pilot 1). The control arm
//      then switches rules.session_start off, so it differs from the rules arm only in whether the section loads in session 2.
//   3. Session 2's harness (the other one, on the cell's utility_models model) starts fresh; the runner runs gbrain setup for it
//      the same way, and session 2 is the item's probe, which saves its answer to out.md.
// The trial is scored by rule (scripts/c2-standing-rules/score.ts). The token is scrubbed from every file and a canary scan must
// come back clean, as in the time-to-first-wow eval (runner/trial/first-wow.ts).

import { existsSync, lstatSync, mkdirSync, chmodSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, type Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Termination, TrialRecord, TrialUsage, TurnRequest } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { cellModels, type Cell } from '../run.ts';
import { HarnessGone, type Harness, type TrialDirs, awaitResponse, makeTrialDirs, writeAtomic, writeRequest } from './harness.ts';
import { startDockerHarness } from './docker.ts';
import { reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from './proxy.ts';
import { type TrialContext, classify, foreignModels, trialTermination } from './trial.ts';
import { InstallLeak, canaryScan, scrubToken } from './install.ts';
import { recordKeyNames, scrubRecord } from './first-wow.ts';
import { FIRST_WOW_SLICE, PERSON_REPLY, QUESTION_BUDGET_S, SETUP_TIMEOUT_S, type FirstWowCellConfig, c2ArmOf, imageFor, otherHarness, packRawBrain, readRegistration, registrationFor, secondImageFor, seedOfTask, setupArgv } from './first-wow-cell.ts';
import { execIn, execOwnerAtTerminal, historyOf, needsPerson, transcriptMarker } from './first-wow.ts';
import { type NEvent, parseTurn } from '../../scripts/gbrain-install/transcript.ts';
import { HOME_DIR } from '../../scripts/gbrain-first-wow/fixtures.ts';
import { OUT_FILE, itemFor, sessionOneTurns } from '../../scripts/c2-standing-rules/items.ts';
import { SECTION_MARKER, applied, approvalTargets, gbrainOps, parseRules, partRan, s1ShowedMistake, type C2Score, type RuleRow } from '../../scripts/c2-standing-rules/score.ts';

/** The folder both sessions run in, under the trial's HOME. */
export const C2_PROJECT = 'src/notes';
/** The runner's one answer when session 1's reply ends by asking for input: the person already said what they want. */
export const S1_PERSON_REPLY = 'Yes, go ahead.';
/** Where the owner's page body is staged for gbrain put, removed before session 1 starts. */
const SEED_DIR = '.c2-seed';
const PROVENANCE = 'the user, call notes 2026-11-10';
/** HOME's top-level folders filesWritten leaves out: gbrain's store, the bun cache, tmp and each harness's own state. */
const HOME_SKIP = new Set(['.gbrain', '.bun', 'tmp', 'claude', 'codex']);
/** The instruction files each harness reads at start, inside the folders HOME_SKIP leaves out. */
const INSTRUCTION_FILES = ['claude/CLAUDE.md', 'codex/AGENTS.md'];

/** The regular files under home last written between from and to (epoch ms), outside HOME_SKIP, plus INSTRUCTION_FILES: a route
 *  from session 1 to session 2 other than gbrain. Links are not followed. */
export function filesWritten(home: string, from: number, to: number): string[] {
  const out: string[] = [];
  const keep = (rel: string, st: Stats) => { if (st.isFile() && st.mtimeMs >= from && st.mtimeMs <= to) out.push(rel); };
  const walk = (rel: string) => {
    for (const name of readdirSync(join(home, rel))) {
      const r = rel ? rel + '/' + name : name;
      const st = lstatSync(join(home, r));
      if (st.isDirectory()) { if (rel || !HOME_SKIP.has(name)) walk(r); }
      else keep(r, st);
    }
  };
  walk('');
  for (const f of INSTRUCTION_FILES) { try { keep(f, lstatSync(join(home, f))); } catch { /* not there */ } }
  return out.sort();
}

export interface C2Turn { session: 1 | 2; turn: number; role: 'question' | 'correction' | 'probe' | 'person'; reply_text: string | null; exit: number; started_at: string; ended_at: string; events: number }
export interface C2Step { id: string; argv: string[]; exit: number; ms: number; out?: string }
export interface TrialC2 {
  arm: FirstWowCellConfig['arm']; seed: number; item: number; direction: string; gbrain_commit: string | null;
  images: [string, string]; image_records: [unknown, unknown];
  setup: Array<{ session: 1 | 2; harness: string; argv: string[]; exit: number; ms: number; history: Record<string, unknown> | null }>;
  registrations: Array<{ harness: string; file: string; args: string[] | null; ok: boolean }>;
  seeding: C2Step[];
  rules_after_s1: RuleRow[]; approvals: C2Step[]; rules_after_approval: RuleRow[] | null;
  facts_before: unknown; facts_after_s1: unknown;
  section: { seen_s1: boolean; seen_s2: boolean; files_s2: string[] };
  files_s1: string[];
  out_md: string | null;
  turns: C2Turn[];
  score: C2Score | null;
}

const readText = (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
const json = (s: string): unknown => { try { return JSON.parse(s); } catch { return { unparsed: s.slice(0, 400) }; } };

export async function runC2Trial(ctx: Omit<TrialContext, 'grade'> & { keyEnv?: Record<string, string | undefined> }): Promise<TrialRecord> {
  const { cell, trial, opts, log } = ctx;
  const fw = (cell as Cell & { first_wow: FirstWowCellConfig }).first_wow;
  const arm = c2ArmOf(fw.arm);
  if (!arm) throw new RunnerError('HE-PREREG-007', `cell ${cell.id}: arm ${fw.arm} is not a C2 correction arm`);
  const repoRoot = resolve(opts.repoRoot ?? '.');
  if (opts.harnessMode !== 'docker' || !opts.network) throw new RunnerError('HE-NET-001', `cell ${cell.id}: a C2 trial runs in docker mode on the internal network; fix: run it through executeRun with --harness-mode docker`);
  const seed = seedOfTask(trial.task);
  if (seed === null) throw new RunnerError('HE-PREREG-007', `trial ${trial.id}: task ${trial.task} is not a seed-NNNN task`);
  const item = itemFor(seed);
  const h1 = cell.harness as 'claude-code' | 'codex';
  const h2 = otherHarness(h1);
  const m1 = cell.model;
  const m2 = cell.utility_models![0]!;
  const direction = `${h1 === 'claude-code' ? 'cc' : 'codex'}->${h2 === 'claude-code' ? 'cc' : 'codex'}`;
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  if (existsSync(ctx.trialDir)) for (const e of readdirSync(ctx.trialDir)) rmSync(join(ctx.trialDir, e), { recursive: true, force: true });
  const dirs = makeTrialDirs(ctx.trialDir);
  const dirs2: TrialDirs = { ...dirs, logs: join(dirs.root, 'logs-s2'), turns: join(dirs.root, 'turns-s2') };
  mkdirSync(dirs2.logs, { recursive: true });
  mkdirSync(dirs2.turns, { recursive: true });
  for (const d of ['claude', 'codex']) { mkdirSync(join(dirs.state, d), { recursive: true }); symlinkSync(d, join(dirs.state, '.' + d)); }
  mkdirSync(join(dirs.state, C2_PROJECT), { recursive: true });
  writeFileSync(join(dirs.state, C2_PROJECT, 'README.md'), '# Notes\n\nDrafts for work email and documents.\n');
  writeFileSync(join(dirs.root, 'c2-item.json'), JSON.stringify({ item, arm, direction, session_one: sessionOneTurns(item, arm) }, null, 1) + '\n');
  const images: [string, string] = [imageFor(cell as Cell & { first_wow: FirstWowCellConfig }), secondImageFor(cell as Cell & { first_wow: FirstWowCellConfig })];
  const key = trialKey(trial.id);
  const token = trialToken(trial.id);
  const slot = trialSlug(trial.id);
  const container = `he-${slot}`;
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
    const envFor = (harness: string, model: string, logsDirs: TrialDirs): Record<string, string> => ({
      HE_INSTALL_MODE: '1', HE_TASK_SLICE: FIRST_WOW_SLICE, HE_INSTALL_DIR: '/he-install',
      HE_MODEL_BASE_URL: proxy ? proxy.baseUrlFor(slot, model.slice(0, model.indexOf(':')), true) : 'http://127.0.0.1:1/none',
      HE_MODEL_API_KEY_FILE: '/he-secret/token', HE_MODEL_NAME: model.slice(model.indexOf(':') + 1),
      HE_TIME_BUDGET_S: String(QUESTION_BUDGET_S), HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: HOME_DIR, HE_TURNS_DIR: '/he-turns',
      HE_WORKSPACE_DIR: `${HOME_DIR}/${C2_PROJECT}`, HE_TRIAL_ID: trial.id, ...(opts.harnessEnv ?? {}),
      ...(logsDirs === dirs2 ? { HE_C2_SESSION: '2' } : { HE_C2_SESSION: '1' }),
    });
    const paths: Record<string, string> = { dir: dirs.root, logs: dirs.logs, logs_s2: dirs2.logs, item: join(dirs.root, 'c2-item.json'), first_wow: join(dirs.root, 'first-wow.json') };
    if (proxy) { paths.usage = join(dirs.root, 'usage.json'); paths.reconcile = join(dirs.root, 'reconcile.json'); }
    log(`c2 trial ${trial.id}: arm ${arm}, item ${item.id} (${item.kind}), ${direction}, images ${images.join(' then ')}`);

    let harness: Harness | null = null;
    let readyFailure: HarnessGone | null = null;
    let error: string | undefined;
    let setupError = false;
    let infra: string | null = null;
    let usage: TrialUsage | null = null;
    let capStop = false;
    let modelMismatch = false;
    let ended = false;
    const imageRecords: [unknown, unknown] = [null, null];
    const setup: TrialC2['setup'] = [];
    const registrations: TrialC2['registrations'] = [];
    const seeding: C2Step[] = [];
    const approvals: C2Step[] = [];
    let rulesAfterS1: RuleRow[] = [];
    let rulesAfterApproval: RuleRow[] | null = null;
    let factsBefore: unknown = null, factsAfterS1: unknown = null;
    const turns: C2Turn[] = [];
    const events: Record<1 | 2, NEvent[]> = { 1: [], 2: [] };
    let s2Started = 0;
    let s1From = 0;
    let filesS1: string[] = [];
    const inProject = () => { try { return realpathSync(join(dirs.state, C2_PROJECT)) === join(realpathSync(dirs.state), C2_PROJECT); } catch { return false; } };
    const note = (msg: string) => { log(msg); error = error ? `${error}; ${msg}` : msg; };

    const ask = async (session: 1 | 2, harnessName: string, d: TrialDirs, role: C2Turn['role'], text: string): Promise<C2Turn | null> => {
      if (ended || !harness) return null;
      const n = turns.filter((t) => t.session === session).length + 1;
      const conversation = `c2-s${session}`;
      const req: TurnRequest = { turn: n, trial_id: trial.id, prompt: text, actor: { member: 'user', slack_user_id: 'U0C2USER', name: 'User', role: 'user', team: null },
        channel: { id: conversation, name: conversation, type: 'channel' }, text, ts: (Date.now() / 1000).toFixed(6), thread_ts: null, sim_now: new Date().toISOString(), time_budget_s: QUESTION_BUDGET_S };
      const turnStart = new Date().toISOString();
      writeRequest(d.turns, req);
      harness.notify?.(req);
      let exit = 0;
      let reply: string | null = null;
      try {
        const res = await awaitResponse(d.turns, n, (QUESTION_BUDGET_S + opts.turnGraceS) * 1000, harness);
        if (!res) { log(`session ${session} turn ${n}: HE-ADAPTER-003 no response after ${QUESTION_BUDGET_S + opts.turnGraceS} s; killing the harness, exit 124`); await harness.kill(); exit = 124; ended = true; }
        else { exit = [0, 2, 3, 124].includes(Number(res.exit)) ? Number(res.exit) : 2; reply = res.reply_text ?? null; }
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        exit = e.exit === 3 ? 3 : 2; ended = true; log(`session ${session} turn ${n}: ${e.message}`);
      }
      const ev = parseTurn(harnessName, d.logs, n, conversation);
      events[session].push(...ev);
      const t: C2Turn = { session, turn: n, role, reply_text: reply, exit, started_at: turnStart, ended_at: new Date().toISOString(), events: ev.length };
      turns.push(t);
      log(`session ${session} turn ${n} (${role}): exit ${exit}, ${ev.length} transcript events`);
      return t;
    };
    const owner = async (harnessName: string, id: string, argv: string[], timeoutS = SETUP_TIMEOUT_S): Promise<C2Step> => {
      const r = await execIn(container, harnessName, argv, timeoutS);
      writeFileSync(join(setupDir, `${id}.json`), r.stdout + (r.stderr ? '\n--- stderr\n' + r.stderr : ''));
      return { id, argv, exit: r.status, ms: r.ms, out: r.stdout };
    };
    const ownerAtTerminal = async (harnessName: string, id: string, argv: string[]): Promise<C2Step> => {
      const r = await execOwnerAtTerminal(container, harnessName, argv, repoRoot);
      writeFileSync(join(setupDir, `${id}.log`), r.stdout + (r.stderr ? '\n--- stderr\n' + r.stderr : ''));
      return { id, argv, exit: r.status, ms: r.ms, out: r.stdout.slice(-600) };
    };
    const start = async (session: 1 | 2, harnessName: string, image: string, model: string, d: TrialDirs): Promise<boolean> => {
      try {
        harness = await startDockerHarness({ harness: harnessName, image, trialSlug: slot, dirs: d, env: envFor(harnessName, model, d), repoRoot: opts.repoRoot, network: opts.network, stateMount: HOME_DIR,
          readOnlyMounts: { [secretDir]: '/he-secret', [installDir]: '/he-install' } });
        await harness.waitReady(opts.readyTimeoutS * 1000);
        log(`session ${session}: ${harnessName} ready (docker, install mode, HOME ${HOME_DIR})`);
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        readyFailure = e;
        note(/HE-INSTALL-003[^\n]*/.exec(readText(join(d.logs, 'adapter.log')) + readText(join(d.logs, 'docker.log')))?.[0] ?? `HE-ADAPTER-002 session ${session}: ${e.message}`);
        return false;
      }
      const probe = await execIn(container, harnessName, ['sh', '-c', 'cat /opt/first-wow/image.json 2>/dev/null; command -v gbrain bun || true'], 30);
      imageRecords[session - 1] = probe.stdout.trim();
      const rec = (() => { try { return JSON.parse(probe.stdout.trim().split('\n')[0] ?? '') as { gbrain_commit?: string; gbrain_version?: string }; } catch { return null; } })();
      if (rec?.gbrain_commit !== fw.gbrain_commit || rec?.gbrain_version !== fw.gbrain_version)
        throw new RunnerError('HE-FIRSTWOW-001', `image ${image} records gbrain ${JSON.stringify(rec)}, not the cell's ${fw.gbrain_commit} (${fw.gbrain_version}); fix: bash harnesses/_first-wow/build.sh ${fw.gbrain_commit} ${fw.gbrain_version} ${harnessName}`);
      const argv = setupArgv(harnessName, fw.arm, fw.suggestion_switch === true, fw.claude_code_advertise);
      const r = await execIn(container, harnessName, argv, SETUP_TIMEOUT_S);
      writeFileSync(join(setupDir, `setup-s${session}.json`), r.stdout);
      writeFileSync(join(setupDir, `setup-s${session}.stderr.log`), r.stderr);
      const history = historyOf(r.stdout);
      setup.push({ session, harness: harnessName, argv, exit: r.status, ms: r.ms, history });
      log(`session ${session} setup: ${argv.slice(1).join(' ')} exit ${r.status} in ${r.ms} ms`);
      if (r.status !== 0) { setupError = true; note(`HE-FIRSTWOW-003 trial ${trial.id}: gbrain setup ${harnessName} exited ${r.status}; see setup/setup-s${session}.stderr.log`); return false; }
      const want = registrationFor(harnessName, fw.claude_code_advertise);
      const reg = readRegistration(harnessName, dirs.state, want);
      registrations.push({ harness: harnessName, ...reg });
      if (!reg.ok) { setupError = true; note(`HE-FIRSTWOW-002 trial ${trial.id}: the gbrain entry in ${reg.file} has args ${JSON.stringify(reg.args)}, not gbrain ${want.join(' ')}; the trial stops as a setup error`); return false; }
      return true;
    };
    const exportBrain = async (harnessName: string, name: string) => {
      const r = await execIn(container, harnessName, ['gbrain', 'export', '--dir', `/he-logs/${name}`], SETUP_TIMEOUT_S);
      writeFileSync(join(setupDir, `${name}.log`), r.stdout + r.stderr);
      if (r.status !== 0) { infra = `HE-FIRSTWOW-004 trial ${trial.id}: gbrain export (${name}) exited ${r.status}; the trial is infra_error`; note(infra); }
    };

    try {
      if (proxy) await proxy.bind(slot, key, token, cellModels(cell), undefined, false, {}, true);
      // Session 1: setup, the owner's seed, the question and the correction.
      if (await start(1, h1, images[0], m1, dirs)) {
        mkdirSync(join(dirs.state, SEED_DIR), { recursive: true });
        writeFileSync(join(dirs.state, SEED_DIR, 'page.md'), `---\ntitle: ${item.page.title}\ntype: ${item.page.type}\n---\n# ${item.page.title}\n\n${item.page.body}\n`);
        seeding.push(await owner(h1, 'seed-page', ['sh', '-c', 'gbrain put "$0" < "$1"', item.page.slug, `${HOME_DIR}/${SEED_DIR}/page.md`]));
        rmSync(join(dirs.state, SEED_DIR), { recursive: true, force: true });
        seeding.push(await owner(h1, 'seed-fact', ['gbrain', 'remember', item.wrong_fact, '--entity', item.page.slug, '--provenance', PROVENANCE, '--content-origin', 'user_said', '--json']));
        seeding.push(await owner(h1, 'rules-session-start-on', ['gbrain', 'config', 'set', 'rules.session_start', 'on']));
        const before = await owner(h1, 'facts-before', ['gbrain', 'recall', item.page.slug, '--json']);
        factsBefore = json(before.out ?? '');
        const bad = seeding.find((s) => s.exit !== 0);
        if (bad) { setupError = true; note(`HE-C2-001 trial ${trial.id}: the owner's seed step ${bad.id} exited ${bad.exit}; see setup/${bad.id}.json`); }
        else {
          const texts = sessionOneTurns(item, arm);
          s1From = Date.now();
          for (const [i, text] of texts.entries()) {
            const t = await ask(1, h1, dirs, i === 0 ? 'question' : 'correction', text);
            if (!t || t.exit !== 0) break;
            if (i === texts.length - 1 && t.reply_text && needsPerson(t.reply_text)) await ask(1, h1, dirs, 'person', S1_PERSON_REPLY);
          }
          if (harness && !ended && turns.every((t) => t.exit === 0)) {
            const ownerFailed = (s: C2Step) => { if (s.exit === 0) return false; setupError = true; note(`HE-C2-002 trial ${trial.id}: the owner's step ${s.id} exited ${s.exit}; see setup/${s.id}; the trial stops before session 2`); return true; };
            const listed = await owner(h1, 'rules-after-s1', ['gbrain', 'rules', 'list', '--json']);
            if (!ownerFailed(listed)) rulesAfterS1 = parseRules(listed.out ?? '');
            factsAfterS1 = json((await owner(h1, 'facts-after-s1', ['gbrain', 'recall', item.page.slug, '--json'])).out ?? '');
            if (!setupError && (arm === 'rules' || arm === 'control')) {
              for (const rule of approvalTargets(rulesAfterS1)) {
                const a = await ownerAtTerminal(h1, `approve-${approvals.length + 1}`, ['gbrain', 'rules', 'approve', `${rule.id}@${rule.revision}`]);
                approvals.push(a);
                if (ownerFailed(a)) break;
              }
              const after = await owner(h1, 'rules-after-approval', ['gbrain', 'rules', 'list', '--json']);
              if (!ownerFailed(after)) rulesAfterApproval = parseRules(after.out ?? '');
              log(`${arm} arm: ${rulesAfterS1.length} rule(s) after session 1, ${approvals.length} approval(s), ${(rulesAfterApproval ?? []).filter((x) => x.confirmed).length} confirmed`);
            }
            if (!setupError && arm === 'control') {
              const off = await owner(h1, 'rules-session-start-off', ['gbrain', 'config', 'set', 'rules.session_start', 'off']);
              seeding.push(off);
              if (off.exit !== 0) { setupError = true; note(`HE-C2-001 trial ${trial.id}: the owner's step rules-session-start-off exited ${off.exit}; see setup/rules-session-start-off.json`); }
            }
            await exportBrain(h1, 'brain-export-s1');
          }
        }
      }
      if (harness) await (harness as Harness).stop(opts.stopGraceS * 1000);
      if (s1From) filesS1 = filesWritten(dirs.state, s1From, Date.now());
      // Session 2: a fresh session in the other harness, on the same HOME and brain.
      if (!readyFailure && !setupError && !infra && !ended && turns.length && turns.every((t) => t.exit === 0)) {
        harness = null;
        s2Started = Date.now();
        if (await start(2, h2, images[1], m2, dirs2)) {
          if (inProject()) rmSync(join(dirs.state, C2_PROJECT, OUT_FILE), { force: true, recursive: true });
          const p = await ask(2, h2, dirs2, 'probe', item.probe);
          if (p?.reply_text && p.exit === 0 && needsPerson(p.reply_text)) await ask(2, h2, dirs2, 'person', PERSON_REPLY);
          if (harness && !ended && turns.every((t) => t.exit === 0)) await exportBrain(h2, 'brain-export-s2');
        }
        if (harness) await (harness as Harness).stop(opts.stopGraceS * 1000);
      }
      if (proxy) {
        const meter = await proxy.finalize(key);
        const lines = proxy.usageLines(key);
        const summary = summarizeUsage(key, meter, lines);
        usage = summary.usage;
        capStop = summary.cap_stop;
        const foreign = foreignModels(cell.model, usage.by_model, lines, 'off', cell.utility_models ?? []);
        if (foreign.length) { modelMismatch = true; note(`HE-MODEL-001 trial ${trial.id} ran model(s) ${foreign.join(', ')} beside the cell's ${cellModels(cell).join(', ')}; the trial is model_error`); }
        writeAtomic(paths.usage!, JSON.stringify(usage, null, 1) + '\n');
        writeAtomic(paths.reconcile!, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
      }
    } finally {
      if (harness) await (harness as Harness).stop(opts.stopGraceS * 1000).catch(() => undefined);
      if (proxy) await proxy.unbind(slot).catch(() => undefined);
      rmSync(secretDir, { recursive: true, force: true });
    }

    const s1Section = transcriptMarker(dirs.state, dirs.logs, started, SECTION_MARKER, s2Started || undefined);
    const s2Section = s2Started ? transcriptMarker(dirs.state, dirs2.logs, s2Started, SECTION_MARKER) : { seen: false, files: [] };
    const outPath = join(dirs.state, C2_PROJECT, OUT_FILE);
    const outStat = s2Started ? (() => { try { return lstatSync(outPath); } catch { return null; } })() : null;
    const outInProject = inProject();
    if (s2Started && !outInProject) note(`c2 trial ${trial.id}: ${C2_PROJECT} is not a folder inside the trial's HOME; out.md is scored missing`);
    const out = outInProject && outStat?.isFile() ? readText(outPath) : null;
    const ops = (s: 1 | 2) => gbrainOps(events[s]);
    const s2Ran = turns.some((t) => t.session === 2);
    const firstReply = turns.find((t) => t.session === 1 && t.role === 'question')?.reply_text ?? null;
    const score: C2Score | null = s2Ran ? {
      item: item.id, kind: item.kind, arm,
      s1_mistake: s1ShowedMistake(item, firstReply),
      s2: applied(item, out),
      part: partRan({ arm, s1Ops: ops(1), s2Ops: ops(2), rulesAfterS1, rulesAfterApproval, sectionSeen: s2Section.seen }),
    } : null;
    const exits = turns.map((t) => t.exit);
    const fromExits: Termination = readyFailure ? classify([], readyFailure, null, false) : setupError ? 'harness_error' : classify(exits, null, null, false);
    const decided = trialTermination({ cellModel: cell.model, fromExits, since: started_at, lines: proxy ? proxy.usageLines(key) : [], capStop, modelMismatch, infra: !!infra });
    if (decided.note) note(decided.note);
    const c2: TrialC2 = {
      arm: fw.arm, seed, item: item.id, direction, gbrain_commit: fw.gbrain_commit ?? null, images, image_records: imageRecords,
      setup, registrations, seeding: seeding.map(({ out: _o, ...s }) => s), rules_after_s1: rulesAfterS1, approvals: approvals.map(({ out: _o, ...s }) => s), rules_after_approval: rulesAfterApproval,
      facts_before: factsBefore, facts_after_s1: factsAfterS1,
      section: { seen_s1: s1Section.seen, seen_s2: s2Section.seen, files_s2: s2Section.files }, files_s1: filesS1, out_md: out, turns, score,
    };
    writeAtomic(paths.first_wow!, JSON.stringify(c2, null, 1) + '\n');
    log(`c2 trial ${trial.id}: ${decided.termination}, applied ${score?.s2.applied ?? null}, saved with ${score?.part.saved_with ?? '-'}, section in session 2 ${s2Section.seen}`);
    const endedAt = Date.now();
    record = {
      trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: 'docker', model: cell.model, script: null,
      termination: decided.termination, grade: 'n/a', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: capStop,
      turns: { planned: sessionOneTurns(item, arm).length + 1, run: turns.length, exits }, usage, wall_ms: endedAt - started, started_at, ended_at: new Date(endedAt).toISOString(), paths,
      ...(error ? { error } : {}), first_wow: c2,
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
    log(`c2 trial ${trial.id}: token scrubbed from ${scrubbed.length} file(s) and the record; canary ${found ? 'FOUND' : 'clean'}`);
    if (found) throw new InstallLeak(recordKeys.length ? null : record, `HE-INSTALL-005 after c2 trial ${trial.id}${thrown ? ' (which threw)' : ''}: ${canary.token_files.length ? `the trial token is still in ${canary.token_files.join(', ')}` : ''}${canary.key_names.length ? ` provider key value(s) of ${canary.key_names.join(', ')} found` : ''}${recordKeys.length ? ` provider key value(s) of ${recordKeys.join(', ')} in the trial record` : ''}; the run stops`);
  }
  const packed = packRawBrain(dirs.state);
  if (packed.length) log(`c2 trial ${trial.id}: packed the trial home (${packed.join(', ')})`);
  return record!;
}
