// GST-2715: one gbrain install trial, start to finish. The agent gets the arm's first message in conversation s1 and installs
// gbrain however it chooses; whenever it ends a turn while the install probe (harnesses/_install/probe.sh, written by the
// adapter after every turn) still fails, it gets the task's one scripted reply, at most the task's max times. Then s1 saves a
// fact holding the trial's nonce, a new conversation s2 asks for it back, and only when that misses, a third conversation s3
// asks again with a hint (descriptive only). No world, no grader and no MCP server of ours: the finish line is counted
// mechanically (runner/contracts.ts TrialInstall).
//
// The harness token never sits in the agent's shell: it is a 0600 file mounted read-only at /he-secret/token
// (HE_MODEL_API_KEY_FILE), and the adapter hands it to the harness through its own config channel (docs/adapters.md,
// "Install mode"). The slot is an install slot (HE-PROXY-010), so every request that is not the harness's own model call is
// refused at $0 and counted. After the trial the secret directory is deleted, the token is scrubbed from every file under
// the trial directory, and a canary scan for the token and the runner's provider keys must come back clean (HE-INSTALL-005).
//
// executeRun (runner/trial/run.ts) checks before each trial that the cell's gbrain release tag still names the cell's commit
// (HE-INSTALL-001); a moved tag stops the cell's remaining trials and no record is written for them.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import type { Termination, TrialInstall, TrialRecord, TrialUsage, TurnRequest } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { cellModels, type Cell, type Trial } from '../run.ts';
import { HarnessGone, type Harness, awaitResponse, makeTrialDirs, startProcessHarness, writeAtomic, writeRequest } from './harness.ts';
import { startDockerHarness } from './docker.ts';
import { type RunProxy, reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from './proxy.ts';
import { installTotals } from '../proxy/metering-proxy.ts';
import { type OpenEgress, openEgressEnv } from './egress.ts';
import { type TrialContext, classify, foreignModels, trialTermination } from './trial.ts';
import { keyValueFiles } from './cursor.ts';
import { installNonce } from '../../tasks/gbrain-install/nonce.ts';
import { hasToken, isGbrainServed, parseTurn } from '../../scripts/gbrain-install/transcript.ts';
import { type InstallTurn, type Probe, classifyInstall } from '../../scripts/gbrain-install/classify.ts';

export const GBRAIN_REPO = 'https://github.com/garrytan/gbrain';
/** The provider keys the canary scan looks for, by name; their values are read from the runner's environment and never printed. */
export const PROVIDER_KEY_NAMES: readonly string[] = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'PARTICLE_API_KEY', 'VOYAGE_API_KEY'];

export interface InstallTask {
  arms: { bare: string };
  /** The line both arms end with, word for word; {tag} becomes the cell's release tag. */
  version_line: string;
  reply: { text: string; max: number };
  save: string;
  recall: string;
  hinted: string;
  conversations: { install: string; save: string; recall: string; hinted: string };
  time_budget_s: number;
}

export function loadInstallTask(repoRoot = '.'): InstallTask {
  const path = join(repoRoot, 'tasks', 'gbrain-install', 'task.json');
  try { return JSON.parse(readFileSync(path, 'utf8')) as InstallTask; }
  catch (e) { throw new RunnerError('HE-TASK-001', `${path} is missing or not JSON (${(e as Error).name}); fix: restore tasks/gbrain-install/task.json`); }
}

/** The arm's first message: the bare prompt, or the paste file's text, without its final newline, then a blank line and the
 *  task's version line with the cell's release tag. gbrain's docs install #stable, which can lag the newest release by days, so
 *  both arms name the release, in the same words. */
export function armPrompt(cell: Pick<Cell, 'install'>, task: InstallTask, repoRoot = '.'): string {
  const file = cell.install!.arm === 'paste' ? cell.install!.paste_file! : task.arms.bare;
  return readFileSync(join(repoRoot, file), 'utf8').replace(/\n$/, '') + '\n\n' + task.version_line.replaceAll('{tag}', cell.install!.tag);
}

// ---- the release pin -----------------------------------------------------------------------------------------------

/** git ls-remote of one gbrain release tag; tests inject their own. */
export type LsRemote = (tag: string) => { status: number; stdout: string; stderr: string };
export const gbrainLsRemote: LsRemote = (tag) => {
  const r = spawnSync('git', ['ls-remote', GBRAIN_REPO, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), GIT_TERMINAL_PROMPT: '0' } });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? r.error?.message ?? '' };
};

/** The commit a tag names: the peeled commit of an annotated tag, else the tag itself (a lightweight tag); null when there is none. */
export function tagCommit(stdout: string, tag: string): string | null {
  const refs = new Map(stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2).map(([sha, ref]) => [ref!, sha!]));
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

/** null when the cell's release tag still names its commit; else the HE-INSTALL-001 message. */
export function tagProblem(cell: Pick<Cell, 'id' | 'install'>, lsRemote: LsRemote = gbrainLsRemote): string | null {
  const { tag, commit: want } = cell.install!;
  const r = lsRemote(tag);
  if (r.status !== 0) return `HE-INSTALL-001 cell ${cell.id}: git ls-remote ${GBRAIN_REPO} failed (${r.stderr.trim().split('\n').pop() ?? 'no output'}), so the runner cannot confirm ${tag} names ${want.slice(0, 12)}; the cell's remaining trials are not run. fix: check the network and rerun with --resume`;
  const got = tagCommit(r.stdout, tag);
  if (got === want) return null;
  return `HE-INSTALL-001 cell ${cell.id}: gbrain's tag ${tag} names ${got ? got.slice(0, 12) : 'nothing (no such tag)'}, not the preregistered ${want.slice(0, 12)}; an install now would test other code, so the cell's remaining trials are not run. fix: finish the wave under a dated amendment that pins the commit the tag names now`;
}

// ---- the cold download ---------------------------------------------------------------------------------------------

/** The shell script of the cold download: in a fresh HOME inside the harness image, bun from npm when the image has none, then
 *  gbrain at the cell's release tag, each timed; one JSON line out. Nothing of it is kept, and no key is in its environment. */
export const coldDownloadScript = (tag: string): string => [
  'export HOME="$(mktemp -d)"; export BUN_INSTALL="$HOME/.bun"; export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"',
  'pre=$(command -v gbrain 2>/dev/null || true)',
  'ms() { date +%s%3N; }; t0=$(ms); had=1',
  // An image with no npm (Hermes's Python image) gets Bun's release zip through Python instead.
  'command -v bun >/dev/null 2>&1 || { had=0; if command -v npm >/dev/null 2>&1; then npm install -g --prefix "$HOME/.npm-global" bun >/dev/null 2>&1; else python3 -c "import io, os, urllib.request, zipfile; d = os.path.expanduser(\'~/.bun/bin\'); os.makedirs(d, exist_ok=True); z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(\'https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip\', timeout=300).read())); open(os.path.join(d, \'bun\'), \'wb\').write(z.read(\'bun-linux-x64/bun\')); os.chmod(os.path.join(d, \'bun\'), 0o755)" >/dev/null 2>&1; fi; }',
  `t1=$(ms); bun install -g github:garrytan/gbrain#${tag} >/dev/null 2>&1; rc=$?; t2=$(ms)`,
  'v=$(gbrain --version 2>/dev/null | head -n 1 | tr -cd "0-9.")',
  'printf \'{"gbrain_preinstalled":"%s","bun_preinstalled":%s,"bun_ms":%s,"gbrain_ms":%s,"exit":%s,"version":"%s"}\\n\' "$pre" "$([ $had = 1 ] && echo true || echo false)" $((t1 - t0)) $((t2 - t1)) $rc "$v"',
].join('\n');

/** HE-INSTALL-006 when the cold download found gbrain already on PATH in a fresh HOME of the image, before any install: the pin
 *  counts read the first gbrain version on PATH, so an image that ships one would make every trial's count wrong. */
export function preinstalledProblem(result: Record<string, unknown>, image: string): string | null {
  const path = result.gbrain_preinstalled;
  return typeof path === 'string' && path ? `HE-INSTALL-006 image ${image}: gbrain is already on PATH (${path}) before any install, so the first version a trial sees is not the agent's. fix: rebuild the image without gbrain` : null;
}

/** The docker run of the cold download on the run's install network, through the open-egress proxy, as container `name`. */
export function coldDownloadArgs(image: string, network: { name: string; gateway: string }, egressEnv: Record<string, string>, tag: string, name = 'he-cold-download'): string[] {
  return ['docker', 'run', '--rm', '--name', name, '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--network', network.name, '--add-host', `host.docker.internal:${network.gateway}`,
    ...Object.entries(egressEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]), '--entrypoint', 'sh', image, '-c', coldDownloadScript(tag)];
}

/** Time a cold gbrain download once per image before the first install trial, reported apart from every trial
 *  (<run>/install-download.jsonl). A failure is recorded, never fatal: the trials measure the agent, not this line.
 *  Asynchronous on purpose: the open-egress proxy the download goes through runs in this process, so a blocking spawn would
 *  leave every proxied request unanswered. Past the deadline the container is removed, since killing the docker CLI alone
 *  leaves it running. */
export async function measureColdDownload(image: string, network: { name: string; gateway: string }, egressEnv: Record<string, string>, tag: string, timeoutMs = 900_000): Promise<Record<string, unknown>> {
  const at = new Date().toISOString();
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
  const name = `he-cold-download-${randomBytes(6).toString('hex')}`;
  const proc = Bun.spawn(coldDownloadArgs(image, network, egressEnv, tag, name), { env, stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; Bun.spawnSync(['docker', 'rm', '-f', name], { env, stdout: 'ignore', stderr: 'ignore' }); proc.kill(9); }, timeoutMs);
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (timedOut) return { at, image, tag, error: `no result within ${timeoutMs / 1000} s; container ${name} removed` };
  const line = stdout.trim().split('\n').pop() ?? '';
  try { return { at, image, tag, ...(JSON.parse(line) as Record<string, unknown>) }; }
  catch { return { at, image, tag, error: `no result line (docker exit ${status}): ${stderr.trim().split('\n').pop()?.slice(0, 200) ?? ''}` }; }
}

// ---- scans ---------------------------------------------------------------------------------------------------------

const lowerHas = (data: Buffer, needle: string) => data.toString('latin1').toLowerCase().includes(needle.toLowerCase());
const isSqlite = (data: Buffer) => data.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000';
const SKIP_DIRS = new Set(['.gbrain', '.bun', '.cache', '.npm', '.npm-global', 'node_modules', '.git', 'sessions']);
const TRANSCRIPT_FILE = /\.(jsonl|log)$|^\.claude\.json$|session|history|transcript/i;
const TRANSCRIPT_TABLE = /session|message|transcript|history|log|event|conversation|turn/i;

/** Files under root that hold the needle, case-insensitively, as paths relative to base. */
export function filesHolding(root: string, needle: string, base = root): string[] {
  const out: string[] = [];
  const visit = (p: string): void => {
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { for (const n of readdirSync(p)) visit(join(p, n)); return; }
    if (st.isFile() && lowerHas(readFileSync(p), needle)) out.push(relative(base, p));
  };
  if (existsSync(root)) visit(root);
  return out.sort();
}

/** The text cells of a SQLite database's tables that are not a session or message store, searched for the needle. The
 *  database is copied first with its -wal and -shm, so a write still in the write-ahead log is read and the original is untouched. */
function sqliteHolds(path: string, needle: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'install-scan-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) cpSync(path + suffix, join(dir, 'db' + suffix));
    const db = new Database(join(dir, 'db'));
    try {
      const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name).filter((n) => !TRANSCRIPT_TABLE.test(n));
      const n = needle.toLowerCase();
      return tables.filter((t) => (db.query(`SELECT * FROM "${t.replace(/"/g, '""')}"`).all() as Array<Record<string, unknown>>)
        .some((row) => Object.values(row).some((v) => (typeof v === 'string' && v.toLowerCase().includes(n)) || (v instanceof Uint8Array && lowerHas(Buffer.from(v), needle)))));
    } finally { db.close(); }
  } catch { return ['(unreadable database)']; } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Where the nonce sits outside the brain: every file under the roots but the brain, tool caches and transcripts (session and
 *  history stores, *.jsonl and *.log) and the paths in skip (the harness's TMPDIR, $HE_SESSION_STATE_DIR/tmp, where Claude Code
 *  and Codex keep scratch files such as a tool's captured output), with a SQLite database searched by table, its session and
 *  message tables left out. Paths are relative to base; a database hit names its tables. */
export function outsideBrain(roots: string[], nonce: string, base: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  const visit = (p: string): void => {
    if (skip.includes(p)) return;
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) for (const n of readdirSync(p)) visit(join(p, n)); return; }
    if (!st.isFile() || TRANSCRIPT_FILE.test(name) || /-(wal|shm|journal)$/.test(name)) return;
    const data = readFileSync(p);
    if (isSqlite(data)) { const tables = sqliteHolds(p, nonce); if (tables.length) out.push(`${relative(base, p)} (${tables.join(', ')})`); return; }
    if (lowerHas(data, nonce)) out.push(relative(base, p));
  };
  for (const r of roots) if (existsSync(r)) visit(r);
  return out.sort();
}

/** The byte strings that would show the trial token: the whole token and its random tail (its head is the trial key, which
 *  logs name on purpose). */
const tokenNeedles = (token: string): Buffer[] => [Buffer.from(token), Buffer.from(token.slice(token.lastIndexOf('.') + 1))];

/** Overwrite every copy of the token under root with a marker of the same length (so a database keeps its layout); returns
 *  the files changed, relative to root. */
export function scrubToken(root: string, token: string): string[] {
  const changed: string[] = [];
  const needles = tokenNeedles(token);
  const visit = (p: string): void => {
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { for (const n of readdirSync(p)) visit(join(p, n)); return; }
    if (!st.isFile()) return;
    const data = readFileSync(p);
    let hit = false;
    for (const n of needles) {
      const mark = Buffer.from('[trial-token-removed]'.padEnd(n.length, '-').slice(0, n.length));
      for (let i = data.indexOf(n); i >= 0; i = data.indexOf(n, i + n.length)) { mark.copy(data, i); hit = true; }
    }
    if (hit) { writeFileSync(p, data); changed.push(relative(root, p)); }
  };
  if (existsSync(root)) visit(root);
  return changed.sort();
}

/** The canary: files under root that still hold the trial token, and the names of provider keys whose values are found. */
export function canaryScan(root: string, token: string, env: Record<string, string | undefined>): { token_files: string[]; key_names: string[] } {
  const needles = tokenNeedles(token);
  const tokenFiles: string[] = [];
  const visit = (p: string): void => {
    let st;
    try { st = lstatSync(p); } catch { tokenFiles.push(relative(root, p)); return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { for (const n of readdirSync(p)) visit(join(p, n)); return; }
    if (st.isFile() && needles.some((n) => readFileSync(p).indexOf(n) >= 0)) tokenFiles.push(relative(root, p));
  };
  if (existsSync(root)) visit(root);
  const keyNames = PROVIDER_KEY_NAMES.filter((k) => !!env[k] && keyValueFiles([root], env[k]!).length > 0);
  return { token_files: tokenFiles.sort(), key_names: keyNames };
}

/** The canary found the token or a provider key under the trial directory: executeRun records the trial, when the trial got as
 *  far as a record, then stops the run. */
export class InstallLeak extends RunnerError {
  constructor(readonly record: TrialRecord | null, message: string) { super('HE-INSTALL-005', message); }
}

// ---- the trial -----------------------------------------------------------------------------------------------------

export interface InstallTrialContext extends Omit<TrialContext, 'grade'> {
  /** The run's open-egress proxy (network "install"); null in process mode. */
  egress: OpenEgress | null;
  /** Where the canary reads the provider keys' values; the runner's environment by default. */
  keyEnv?: Record<string, string | undefined>;
}

const readProbe = (path: string): Probe | null => { try { return JSON.parse(readFileSync(path, 'utf8')) as Probe; } catch { return null; } };
const readLines = <T>(path: string): T[] => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } }); } catch { return []; } };
const pad = (n: number) => String(n).padStart(4, '0');

export async function runInstallTrial(ctx: InstallTrialContext): Promise<TrialRecord> {
  const { cell, trial, opts, log } = ctx;
  const repoRoot = resolve(opts.repoRoot ?? '.');
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  if (existsSync(ctx.trialDir)) for (const e of readdirSync(ctx.trialDir)) rmSync(join(ctx.trialDir, e), { recursive: true, force: true });
  const dirs = makeTrialDirs(ctx.trialDir);
  const mode = opts.harnessMode;
  if (mode === 'scripted') throw new RunnerError('HE-PREREG-007', `cell ${cell.id}: a gbrain-install cell needs a harness; it cannot run scripted`);
  const docker = mode === 'docker';
  if (docker && (!opts.network || !ctx.egress)) throw new RunnerError('HE-NET-001', `cell ${cell.id} runs in docker mode on network "install" but the trial was given ${!opts.network ? 'no internal network' : 'no open-egress proxy'}; fix: run it through executeRun`);
  const task = loadInstallTask(repoRoot);
  const nonce = installNonce(cell.install!.seed, trial.id);
  const first = armPrompt(cell, task, repoRoot);
  const key = trialKey(trial.id);
  const token = trialToken(trial.id);
  const slot = trialSlug(trial.id);
  const provider = cell.model.slice(0, cell.model.indexOf(':'));
  const modelName = cell.model.slice(cell.model.indexOf(':') + 1);
  const proxy = ctx.proxy;
  const secretDir = join(dirs.root, 'secret');
  mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  chmodSync(secretDir, 0o700);
  writeFileSync(join(secretDir, 'token'), token, { mode: 0o600 });
  let record: TrialRecord | null = null;
  let thrown: unknown = null;
  try {
    const installDir = join(repoRoot, 'harnesses', '_install');
    const env: Record<string, string> = {
      HE_INSTALL_MODE: '1',
      HE_TASK_SLICE: 'gbrain-install',
      HE_INSTALL_DIR: docker ? '/he-install' : installDir,
      HE_MODEL_BASE_URL: proxy ? proxy.baseUrlFor(slot, provider, docker) : 'http://127.0.0.1:1/none',
      HE_MODEL_API_KEY_FILE: docker ? '/he-secret/token' : join(secretDir, 'token'),
      HE_MODEL_NAME: modelName,
      HE_TIME_BUDGET_S: String(task.time_budget_s),
      HE_LOG_DIR: docker ? '/he-logs' : resolve(dirs.logs),
      HE_SESSION_STATE_DIR: docker ? '/harness-state' : resolve(dirs.state),
      HE_TURNS_DIR: docker ? '/he-turns' : resolve(dirs.turns),
      HE_TRIAL_ID: trial.id,
      ...(docker ? openEgressEnv(ctx.egress!.proxyUrl) : { HE_WORKSPACE_DIR: resolve(dirs.workspace) }),
      ...(opts.harnessEnv ?? {}),
    };
    const paths: Record<string, string> = { dir: dirs.root, logs: dirs.logs, install_turns: join(dirs.root, 'install-turns.json'), install_classification: join(dirs.root, 'install-classification.json') };
    if (proxy) { paths.usage = join(dirs.root, 'usage.json'); paths.reconcile = join(dirs.root, 'reconcile.json'); }
    if (ctx.egress) paths.egress = join(dirs.root, 'egress.ndjson');
    log(`install trial ${trial.id}: arm ${cell.install!.arm}, release ${cell.install!.tag} (${cell.install!.commit.slice(0, 12)}), ${task.time_budget_s} s per turn, at most ${task.reply.max} scripted replies`);

    let harness: Harness | null = null;
    let readyFailure: HarnessGone | null = null;
    let error: string | undefined;
    const turns: InstallTurn[] = [];
    let usage: TrialUsage | null = null;
    let capStop = false;
    let modelMismatch = false;
    let nonHarness = 0;
    let modelRequests = 0;
    let ended = false;

    const ask = async (session: string, role: InstallTurn['role'], text: string): Promise<InstallTurn | null> => {
      if (ended || !harness) return null;
      const n = turns.length + 1;
      const req: TurnRequest = { turn: n, trial_id: trial.id, prompt: text, actor: { member: 'user', slack_user_id: 'U0INSTALL', name: 'User', role: 'user', team: null },
        channel: { id: session, name: session, type: 'channel' }, text, ts: (Date.now() / 1000).toFixed(6), thread_ts: null, sim_now: new Date().toISOString(), time_budget_s: task.time_budget_s };
      const turnStart = new Date().toISOString();
      writeRequest(dirs.turns, req);
      harness.notify?.(req);
      let exit = 0;
      let reply: string | null = null;
      try {
        const res = await awaitResponse(dirs.turns, n, (task.time_budget_s + opts.turnGraceS) * 1000, harness);
        if (!res) { log(`turn ${n}: HE-ADAPTER-003 no response after ${task.time_budget_s + opts.turnGraceS} s; killing the harness, exit 124`); await harness.kill(); exit = 124; ended = true; }
        else { exit = [0, 2, 3, 124].includes(Number(res.exit)) ? Number(res.exit) : 2; reply = res.reply_text ?? null; }
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        exit = e.exit === 3 ? 3 : 2;
        ended = true;
        log(`turn ${n}: ${e.message}`);
      }
      const t: InstallTurn = { turn: n, session: session as InstallTurn['session'], role, text, reply_text: reply, exit, started_at: turnStart, ended_at: new Date().toISOString(),
        probe: readProbe(join(dirs.logs, 'turns', `turn-${pad(n)}.probe.json`)), events: parseTurn(cell.harness, dirs.logs, n, session) };
      turns.push(t);
      log(`turn ${n} (${session}, ${role}): exit ${exit}, probe ${t.probe ? (t.probe.ok ? 'ok' : 'failing') : 'missing'}, ${t.events.length} transcript events`);
      return t;
    };

    let probeExhausted = false;
    let scripted = 0;
    let recall: InstallTurn | null = null;
    let hinted: InstallTurn | null = null;
    let finishMs: number | null = null;
    const firstAt = { ms: 0 };
    const hit = (t: InstallTurn | null) => ({ reply: !!t?.reply_text && hasToken(t.reply_text, nonce), gbrain_call: !!t && t.events.some((e) => isGbrainServed(e) && !e.is_error && hasToken(e.output, nonce)) });
    const brainHolds = () => filesHolding(join(dirs.state, '.gbrain'), nonce).length > 0;
    try {
      if (proxy) await proxy.bind(slot, key, token, cellModels(cell), undefined, false, {}, true);
      try {
        if (docker) {
          harness = await startDockerHarness({ harness: cell.harness, image: opts.image ?? `harness-eval/${cell.harness}:dev`, trialSlug: slot, dirs, env, repoRoot: opts.repoRoot, network: opts.network!,
            readOnlyMounts: { [secretDir]: '/he-secret', [installDir]: '/he-install' }, ...(opts.captureDns ? { dns: opts.captureDns } : {}) });
        } else {
          const adapter = cell.adapter ?? opts.adapter ?? join(repoRoot, 'harnesses', cell.harness, 'adapter.sh');
          harness = startProcessHarness({ adapter, dirs, env });
        }
        await harness.waitReady(opts.readyTimeoutS * 1000);
        log(`harness ready (${harness.kind}, install mode)`);
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        readyFailure = e;
        const adapterLog = ['harness.stderr.log', 'harness.stdout.log', 'stderr.log', 'docker.log'].map((f) => { try { return readFileSync(join(dirs.logs, f), 'utf8'); } catch { return ''; } }).join('\n');
        const refused = /HE-INSTALL-003[^\n]*/.exec(adapterLog)?.[0];
        error = refused ?? `HE-ADAPTER-002 ${e.message}`;
        log(error);
      }
      if (!readyFailure) {
        firstAt.ms = Date.now();
        let t = await ask(task.conversations.install, 'arm', first);
        while (t && !t.probe?.ok && scripted < task.reply.max && !ended) { scripted++; t = await ask(task.conversations.install, 'reply', task.reply.text); }
        if (t && !t.probe?.ok) {
          probeExhausted = true;
          log(`HE-INSTALL-002 trial ${trial.id}: the install probe still fails after ${scripted} scripted repl${scripted === 1 ? 'y' : 'ies'}; the trial goes on to the save and recall turns and scores as the probe and the transcript show`);
        }
        await ask(task.conversations.save, 'save', task.save.replace('{nonce}', nonce));
        recall = await ask(task.conversations.recall, 'recall', task.recall);
        if (recall) finishMs = Date.parse(recall.ended_at) - firstAt.ms;
      }
      const plain = hit(recall);
      if (recall && !(plain.reply && plain.gbrain_call && brainHolds())) hinted = await ask(task.conversations.hinted, 'hinted', task.hinted);
      if (harness) await harness.stop(opts.stopGraceS * 1000);

      if (proxy) {
        const meter = await proxy.finalize(key);
        const lines = proxy.usageLines(key);
        const summary = summarizeUsage(key, meter, lines);
        usage = summary.usage;
        capStop = summary.cap_stop;
        const foreign = foreignModels(cell.model, usage.by_model, lines, 'off', cell.utility_models ?? []);
        if (foreign.length) { modelMismatch = true; const msg = `HE-MODEL-001 trial ${trial.id} ran model(s) ${foreign.join(', ')} beside the cell's ${cell.model}; the trial is model_error`; log(msg); error = error ? `${error}; ${msg}` : msg; }
        const totals = installTotals([...lines, ...proxy.usageLines(`slot:${slot}`)]);
        nonHarness = Object.values(totals).reduce((s, t) => s + Object.values(t.non_harness).reduce((a, b) => a + b, 0), 0);
        modelRequests = lines.filter((l) => l.outcome === 'forwarded' && `${l.provider}:${l.model}` === cell.model).length;
        writeAtomic(paths.usage!, JSON.stringify(usage, null, 1) + '\n');
        writeAtomic(paths.reconcile!, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
        if (nonHarness) log(`trial ${trial.id}: ${nonHarness} install-slot request(s) that were not the harness's own model call (HE-PROXY-010); reported per run`);
      }
    } finally {
      if (harness) await harness.stop(opts.stopGraceS * 1000).catch(() => undefined);
      if (proxy) await proxy.unbind(slot).catch(() => undefined);
      rmSync(secretDir, { recursive: true, force: true });
    }

    // The finish line, read after the harness stopped, from the transcripts, the brain and every other state store.
    const r2 = hit(recall);
    const brain = brainHolds();
    const outside = [...outsideBrain([dirs.state], nonce, dirs.state, [join(dirs.state, 'tmp')]).map((p) => `state/${p}`), ...outsideBrain([dirs.workspace], nonce, dirs.workspace).map((p) => `workspace/${p}`)];
    const installed = turns.some((t) => t.probe?.ok);
    const outcome: TrialInstall['outcome'] = outside.length ? 'harness-memory' : r2.reply && r2.gbrain_call && brain ? 'recalled' : !installed ? 'not-installed' : 'not-recalled';
    const watch = readLines<Probe>(join(dirs.logs, 'install-watch.ndjson'));
    const watcher: TrialInstall['watcher'] = existsSync(join(dirs.logs, 'install-watch.alive')) ? 'ok' : 'missing';
    const egressLines = ctx.egress ? ctx.egress.lines(trial.id) : [];
    if (ctx.egress) writeAtomic(paths.egress!, egressLines.map((l) => JSON.stringify(l) + '\n').join(''));
    const classification = classifyInstall({ harness: cell.harness, turns, watch, egress: egressLines, started_at: firstAt.ms ? new Date(firstAt.ms).toISOString() : started_at, finish: outcome === 'recalled' });
    writeAtomic(paths.install_turns!, JSON.stringify(turns.map(({ events, ...t }) => ({ ...t, events: events.length })), null, 1) + '\n');
    writeAtomic(paths.install_classification!, JSON.stringify(classification, null, 1) + '\n');

    let infra: string | null = null;
    if (!readyFailure && watcher === 'missing') infra = `HE-INSTALL-004 trial ${trial.id}: the install watcher left no ${join(dirs.logs, 'install-watch.alive')}, so the step times have no filesystem record; the trial is infra_error and is rerun once. fix: read the adapter's stderr for the watcher's start`;
    else if (classification.infra) infra = `trial ${trial.id}: ${classification.infra} (GitHub refused a download), an infrastructure failure; the trial is infra_error and is rerun once after a cool-down`;
    if (infra) { log(infra); error = error ? `${error}; ${infra}` : infra; }

    const exits = turns.map((t) => t.exit);
    const fromExits: Termination = readyFailure ? (error?.startsWith('HE-INSTALL-003') ? 'harness_error' : classify([], readyFailure, null, false)) : classify(exits, null, null, false);
    const decided = trialTermination({ cellModel: cell.model, fromExits, since: started_at, lines: proxy ? proxy.usageLines(key) : [], capStop, modelMismatch, infra: !!infra });
    if (decided.note) { log(decided.note); error = error ? `${error}; ${decided.note}` : decided.note; }

    const lastIndex = recall ? turns.indexOf(recall) + 1 : turns.length;
    const install: TrialInstall = {
      arm: cell.install!.arm, tag: cell.install!.tag, commit: cell.install!.commit, nonce, outcome,
      finish: { reply: r2.reply, gbrain_call: r2.gbrain_call, brain, outside_brain: outside },
      hinted: { ran: !!hinted, ...(hinted ? hit(hinted) : { reply: false, gbrain_call: false }) },
      scripted_replies: scripted, probe_exhausted: probeExhausted,
      finish_ms: outcome === 'recalled' ? finishMs : null, agent_turns: lastIndex, model_requests: modelRequests, non_harness_requests: nonHarness,
      watcher, classification,
    };
    log(`install trial ${trial.id}: outcome ${outcome} (reply ${r2.reply}, gbrain call ${r2.gbrain_call}, brain ${brain}, outside the brain ${outside.length}), scripted replies ${scripted}, watcher ${watcher}`);
    const endedAt = Date.now();
    record = {
      trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: mode, model: cell.model, script: null,
      termination: decided.termination, grade: 'n/a', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: capStop,
      turns: { planned: 3 + task.reply.max + 1, run: turns.length, exits }, usage, wall_ms: endedAt - started, started_at, ended_at: new Date(endedAt).toISOString(), paths,
      ...(error ? { error } : {}), install,
    };
  } catch (e) {
    thrown = e;
    throw e;
  } finally {
    // The token dies with the trial, finished or thrown: scrubbed from every copy the harness wrote, then the canary must find nothing.
    rmSync(secretDir, { recursive: true, force: true });
    const scrubbed = scrubToken(dirs.root, token);
    const canary = canaryScan(dirs.root, token, ctx.keyEnv ?? process.env);
    const found = canary.token_files.length > 0 || canary.key_names.length > 0;
    log(`install trial ${trial.id}: token scrubbed from ${scrubbed.length} file(s); canary ${found ? 'FOUND' : 'clean'}${thrown ? ' after the trial threw' : ''}`);
    if (found) throw new InstallLeak(record, `HE-INSTALL-005 after trial ${trial.id}${thrown ? ` (which threw: ${thrown instanceof Error ? thrown.message : String(thrown)})` : ''}, ${canary.token_files.length ? `the trial token is still in ${canary.token_files.join(', ')}` : ''}${canary.token_files.length && canary.key_names.length ? ' and ' : ''}${canary.key_names.length ? `the value of ${canary.key_names.join(', ')} is in a file under ${dirs.root}` : ''}; the run stops before another trial. fix: keep that trial directory out of every copy, publication and drive, find the path that wrote it and fix it before resuming`);
  }
  return record!;
}
