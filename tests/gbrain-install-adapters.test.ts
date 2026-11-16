// Install mode (HE_INSTALL_MODE=1) in the four adapters and harnesses/_install/probe.sh, keyless. Each adapter serves turns on
// this host with the stand-in CLIs in tests/fixtures/gbrain-install/bin first on PATH (claude, codex, openclaw and hermes run
// "run: <command>" lines in an agent shell; gbrain wires itself where the real one does), under a scrubbed environment. A first
// session installs gbrain and stores a fact, a second session in the same state directory with a new log directory finds the
// wiring at its start and recalls the fact. Checked on every turn: the proxy token reached the harness through its channel and
// never the agent shell, the probe record was written before the response, the watcher ran and stopped with the adapter, and
// nothing under the log directories holds the token. No model is called.
import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { hasToken, isGbrainCall, parseTurn } from '../scripts/gbrain-install/transcript.ts';

const ROOT = resolve(import.meta.dir, '..');
const BIN = join(ROOT, 'tests/fixtures/gbrain-install/bin');
const INSTALL_DIR = join(ROOT, 'harnesses/_install');
const PROBE = join(INSTALL_DIR, 'probe.sh');
const NODE = Bun.which('node');
const SYSTEM_PATH = [...(NODE ? [dirname(NODE)] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const TOKEN = 'he-install-test-token.0123456789abcdef0123456789abcdef';
type Harness = 'claude-code' | 'codex' | 'openclaw' | 'hermes';
const HARNESSES: Harness[] = ['claude-code', 'codex', 'openclaw', 'hermes'];
const URL: Record<Harness, string> = { 'claude-code': 'http://127.0.0.1:1/inst/anthropic', codex: 'http://127.0.0.1:1/inst/openai', openclaw: 'http://127.0.0.1:1/inst/anthropic', hermes: 'http://127.0.0.1:1/inst/anthropic' };
const MODEL: Record<Harness, string> = { 'claude-code': 'claude-opus-5-5', codex: 'gpt-6-luna', openclaw: 'claude-opus-5-5', hermes: 'claude-opus-5-5' };
const pinVersion = (h: Harness) => String(JSON.parse(readFileSync(join(ROOT, 'harnesses', h, 'pin.json'), 'utf8')).version);
const HAS_TOOLS = !!NODE && !!Bun.which('jq') && !!Bun.which('python3');

interface Trial { root: string; state: string; workspace: string; tokenFile: string; stubLog: string }
function trial(h: Harness): Trial {
  const root = mkdtempSync(join(tmpdir(), 'he-install-' + h + '-'));
  const t = { root, state: join(root, 'state'), workspace: join(root, 'workspace'), tokenFile: join(root, 'secret', 'token'), stubLog: join(root, 'stub.ndjson') };
  for (const d of [t.state, t.workspace, dirname(t.tokenFile)]) mkdirSync(d, { recursive: true });
  writeFileSync(t.tokenFile, TOKEN + '\n');
  chmodSync(t.tokenFile, 0o600);
  // Hermes's Anthropic config copy reads the literal /opt/harness/config/config.yaml; on this host it is placed first, as there.
  if (h === 'hermes' && !existsSync('/opt/harness/config/config.yaml')) {
    mkdirSync(join(t.state, 'hermes'));
    writeFileSync(join(t.state, 'hermes', 'config.yaml'), readFileSync(join(ROOT, 'harnesses/hermes/config/config.yaml')));
  }
  return t;
}

function env(h: Harness, t: Trial, logs: string, turns: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const e: Record<string, string | undefined> = {
    PATH: BIN + ':' + SYSTEM_PATH, HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: logs, HE_TURNS_DIR: turns,
    HE_MODEL_BASE_URL: URL[h], HE_MODEL_NAME: MODEL[h], HE_TIME_BUDGET_S: '30', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: 'install-test',
    HE_INSTALL_MODE: '1', HE_INSTALL_DIR: INSTALL_DIR, HE_MODEL_API_KEY_FILE: t.tokenFile,
    STUB_LOG: t.stubLog, STUB_TOKEN_FILE: t.tokenFile, STUB_VERSION: pinVersion(h), ...extra,
  };
  return Object.fromEntries(Object.entries(e).filter((kv): kv is [string, string] => kv[1] !== undefined));
}

const request = (turn: number, member: string, prompt: string) => ({ turn, trial_id: 'install-test', prompt, actor: { member, slack_user_id: 'U0' + member.toUpperCase(), name: member, role: 'engineer', team: null },
  channel: { id: 'D0' + member.toUpperCase(), name: member, type: 'dm' }, text: prompt, ts: '1790000000.00010' + turn, thread_ts: null, sim_now: '2026-11-15T09:00:00-08:00', time_budget_s: 30 });

interface TurnResult { response: { turn: number; exit: number; reply_text: string | null; detail?: string }; probeBeforeResponse: boolean; probe: Record<string, unknown> | null }
interface Session { exit: number | null; ready: Record<string, unknown> | null; turns: TurnResult[]; logs: string; turnsDir: string; watcherGone: boolean }

const watcherPids = (h: Harness, logs: string) => spawnSync('pgrep', ['-f', 'probe.sh watch ' + h + ' ' + logs + '/install-watch.ndjson'], { encoding: 'utf8' }).stdout.trim();

async function session(h: Harness, t: Trial, name: string, member: string, prompts: string[], extra: Record<string, string> = {}): Promise<Session> {
  const logs = join(t.root, 'logs-' + name), turnsDir = join(t.root, 'turns-' + name);
  mkdirSync(logs); mkdirSync(turnsDir);
  const child = spawn('bash', [join(ROOT, 'harnesses', h, 'adapter.sh'), 'serve'], { env: env(h, t, logs, turnsDir, extra), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', (d) => { stderr += d; });
  const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
  const deadline = Date.now() + 60_000;
  const until = async (p: string) => { while (!existsSync(p) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(25); return existsSync(p); };
  const turns: TurnResult[] = [];
  let ready: Record<string, unknown> | null = null;
  try {
    if (await until(join(logs, 'ready'))) ready = JSON.parse(readFileSync(join(logs, 'ready'), 'utf8'));
    for (const [i, prompt] of prompts.entries()) {
      const stem = join(turnsDir, 'turn-' + String(i + 1).padStart(4, '0'));
      writeFileSync(stem + '.request.json.tmp', JSON.stringify(request(i + 1, member, prompt)));
      renameSync(stem + '.request.json.tmp', stem + '.request.json');
      if (!(await until(stem + '.response.json'))) throw new Error(h + ' ' + name + ' turn ' + (i + 1) + ': no response; stderr: ' + stderr.slice(-2000));
      const probePath = join(logs, 'turns', 'turn-' + String(i + 1).padStart(4, '0') + '.probe.json');
      const probeBeforeResponse = existsSync(probePath);
      turns.push({ response: JSON.parse(readFileSync(stem + '.response.json', 'utf8')), probeBeforeResponse, probe: probeBeforeResponse ? JSON.parse(readFileSync(probePath, 'utf8')) : null });
    }
  } finally {
    child.kill('SIGTERM');
  }
  const exit = await Promise.race([exited, Bun.sleep(15_000).then(() => { child.kill('SIGKILL'); return null; })]);
  let watcherGone = false;
  for (let i = 0; i < 50 && !watcherGone; i++) { watcherGone = watcherPids(h, logs) === ''; if (!watcherGone) await Bun.sleep(100); }
  return { exit, ready, turns, logs, turnsDir, watcherGone };
}

const stubCalls = (t: Trial) => existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
}
const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);
const NO_KEY_VARS = { HE_MODEL_API_KEY: false, HE_MODEL_API_KEY_FILE: false, ANTHROPIC_API_KEY: false, OPENAI_API_KEY: false, token: false };

describe.skipIf(!HAS_TOOLS).each(HARNESSES)('%s adapter, install mode', (h) => {
  test('session 1 installs gbrain and stores a fact; session 2 finds the wiring at its start and recalls it; the token stays out of the shell and the logs', async () => {
    const t = trial(h);
    const s1 = await session(h, t, 's1', 'alice', ['run: gbrain init && gbrain setup ' + h, 'run: gbrain remember the launch code is 7319']);
    const s2 = await session(h, t, 's2', 'bob', ['What is the launch code?\nrun: gbrain recall launch code']);
    for (const s of [s1, s2]) {
      expect(s.exit).toBe(0);
      expect(s.ready?.install_mode).toBe(true);
      for (const turn of s.turns) {
        expect(turn.response.exit, turn.response.detail).toBe(0);
        expect(turn.probeBeforeResponse).toBe(true);
        expect(turn.probe?.harness).toBe(h);
      }
      const watch = readFileSync(join(s.logs, 'install-watch.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      expect(watch.length).toBeGreaterThan(0);
      expect(watch.every((w) => w.harness === h)).toBe(true);
      expect(existsSync(join(s.logs, 'install-watch.alive'))).toBe(true);
      expect(s.watcherGone).toBe(true);
    }
    expect(s1.turns[0]!.probe?.ok).toBe(true);
    expect(s1.turns[0]!.probe?.brain).toBe(true);
    expect(s2.turns[0]!.response.reply_text).toContain('the launch code is 7319');

    const calls = stubCalls(t);
    expect(calls.length).toBe(3);
    const [first, second, third] = calls;
    expect(first.session.new).toBe(true);
    expect(second.session.new).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    expect(third.session.new).toBe(true);
    expect(third.session.id).not.toBe(first.session.id);
    expect(first.seen.instructions).toBe(false);
    expect(third.seen.instructions).toBe(true);
    if (h !== 'openclaw') {
      expect(first.seen.mcp_servers).not.toContain('gbrain');
      expect(third.seen.mcp_servers).toContain('gbrain');
    }
    for (const c of calls) {
      expect(c.credential.match).toBe(true);
      expect(c.commands.every((x: { exit: number }) => x.exit === 0)).toBe(true);
      expect(c.shell_env).toEqual(NO_KEY_VARS);
      expect(c.harness_env.HE_MODEL_API_KEY_FILE).toBe(false);
    }
    if (h === 'claude-code') {
      for (const c of calls) expect(c.harness_env).toEqual(NO_KEY_VARS);
      expect(mode(join(t.state, 'he-install', 'api-key'))).toBe('600');
    }
    if (h === 'codex') for (const c of calls) { expect(c.harness_env.HE_MODEL_API_KEY).toBe(true); expect(c.credential.excludes).toContain('HE_MODEL_API_KEY'); }
    if (h === 'openclaw') for (const c of calls) { expect(c.harness_env).toEqual(NO_KEY_VARS); expect(c.credential.mode).toBe('600'); }
    if (h === 'hermes') for (const c of calls) { expect(c.harness_env.ANTHROPIC_API_KEY).toBe(true); expect(c.credential.mode).toBe('600'); }

    for (const f of [...files(s1.logs), ...files(s2.logs), ...files(s1.turnsDir), ...files(s2.turnsDir), t.stubLog]) expect(readFileSync(f, 'utf8').includes(TOKEN), f).toBe(false);
  }, 120_000);

  test.each([
    ['a route config', { HE_HARNESS_CONFIG: 'route-tool' }],
    ['HE_GBRAIN_INSTALL', { HE_GBRAIN_INSTALL: 'gbrain-installer' }],
    ['HE_GBRAIN_MCP_URL', { HE_GBRAIN_MCP_URL: 'http://127.0.0.1:1/gbrain' }],
    ['a missing token file', { HE_MODEL_API_KEY_FILE: '/nonexistent/token' }],
    ['no probe.sh', { HE_INSTALL_DIR: '/nonexistent' }],
  ] as Array<[string, Record<string, string>]>)('refuses %s before ready (HE-INSTALL-003, exit 2)', (_label, extra) => {
    const t = trial(h);
    const logs = join(t.root, 'logs'), turns = join(t.root, 'turns');
    mkdirSync(logs); mkdirSync(turns);
    const r = spawnSync('bash', [join(ROOT, 'harnesses', h, 'adapter.sh'), 'serve'], { env: env(h, t, logs, turns, extra), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(readFileSync(join(logs, 'adapter.log'), 'utf8')).toContain('HE-INSTALL-003');
    expect(existsSync(join(logs, 'ready'))).toBe(false);
  }, 40_000);

  test('refuses the run entry (HE-INSTALL-003, exit 2)', () => {
    const t = trial(h);
    const logs = join(t.root, 'logs'), turns = join(t.root, 'turns');
    mkdirSync(logs); mkdirSync(turns);
    writeFileSync(join(t.workspace, 'instruction.md'), 'Say ok.\n');
    const r = spawnSync('bash', [join(ROOT, 'harnesses', h, 'adapter.sh'), 'run'], { env: env(h, t, logs, turns), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(readFileSync(join(logs, 'adapter.log'), 'utf8')).toContain('HE-INSTALL-003');
    expect(stubCalls(t)).toEqual([]);
  }, 40_000);
});

describe.skipIf(!HAS_TOOLS).each(HARNESSES)('%s adapter, harness PATH', (h) => {
  const extra = (t: Trial) => ['.bun/bin', '.npm-global/bin', '.local/bin'].map((d) => join(t.state, d));
  test('install mode starts each harness session with the PATH plus HOME/.bun/bin, HOME/.npm-global/bin and HOME/.local/bin', async () => {
    const t = trial(h);
    const s = await session(h, t, 's1', 'alice', ['run: printf "PATH=%s" "$PATH"']);
    expect(s.turns[0]!.response.exit, s.turns[0]!.response.detail).toBe(0);
    expect(s.turns[0]!.response.reply_text).toContain('PATH=' + BIN + ':' + SYSTEM_PATH + ':' + extra(t).join(':'));
  }, 60_000);

  test('the run entry outside install mode keeps the PATH it was given', () => {
    const t = trial(h);
    const logs = join(t.root, 'logs'), turns = join(t.root, 'turns');
    mkdirSync(logs); mkdirSync(turns);
    writeFileSync(join(t.workspace, 'instruction.md'), 'run: printf "%s" "$PATH" > "$HE_WORKSPACE_DIR/path.txt"\n');
    const r = spawnSync('bash', [join(ROOT, 'harnesses', h, 'adapter.sh'), 'run'], { env: env(h, t, logs, turns, { HE_INSTALL_MODE: undefined, HE_MODEL_API_KEY: 'he-run-dummy' }), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30_000 });
    const path = existsSync(join(t.workspace, 'path.txt')) ? readFileSync(join(t.workspace, 'path.txt'), 'utf8') : 'missing; exit ' + r.status + ' ' + r.stderr.slice(-800);
    expect(path).toBe(BIN + ':' + SYSTEM_PATH);
  }, 40_000);
});

describe.skipIf(!HAS_TOOLS)('openclaw install mode, per-turn session export', () => {
  test('each turn writes its own decoded transcript events, tool calls with arguments and tool results with output, with the token masked', async () => {
    const t = trial('openclaw');
    const s1 = await session('openclaw', t, 's1', 'alice', ['run: gbrain init', 'run: cat "$OPENCLAW_CONFIG_PATH"']);
    const s2 = await session('openclaw', t, 's2', 'bob', ['run: gbrain --version']);
    const lines = (s: Session, n: number) => readFileSync(join(s.logs, 'turns', 'turn-000' + n + '.openclaw-session.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const one = lines(s1, 1), two = lines(s1, 2), three = lines(s2, 1);
    for (const [events, turn] of [[one, 1], [two, 2], [three, 1]] as const) {
      expect(events.map((e) => e.event.message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
      expect(events.every((e) => e.turn === turn && e.db === 'agents/main/agent/openclaw-agent.sqlite' && !e.error)).toBe(true);
    }
    expect(one[1].event.message.content[0]).toMatchObject({ type: 'toolCall', name: 'exec', arguments: { command: 'gbrain init' } });
    expect(one[2].event.message).toMatchObject({ toolName: 'exec', toolCallId: one[1].event.message.content[0].id, details: { exitCode: 0 } });
    expect(one[2].event.message.content[0].text).toContain('brain ready at');
    expect(two.map((e) => e.seq)).toEqual([4, 5, 6, 7]);
    expect(two[0].session_id).toBe(one[0].session_id);
    expect(three[0].session_id).not.toBe(one[0].session_id);
    expect(three[2].event.message.content[0].text).toBe('0.60.717.0');
    const shown = readFileSync(join(s1.logs, 'turns', 'turn-0002.openclaw-session.jsonl'), 'utf8');
    expect(shown.includes(TOKEN)).toBe(false);
    expect(shown).toContain('[HE_MODEL_API_KEY]');
  }, 120_000);
});

describe.skipIf(!HAS_TOOLS)('hermes install mode, per-turn session export', () => {
  const NOTES = 'run: for i in $(seq 1 120); do gbrain remember "note $i: an older page about the family garden, nothing new here"; done; gbrain remember the launch code is Quillfern';
  const rows = (s: Session, n: number) => readFileSync(join(s.logs, 'turns', 'turn-000' + n + '.hermes-session.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stream = (s: Session, n: number) => readFileSync(join(s.logs, 'turns', 'turn-000' + n + '.hermes.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

  test('a gbrain output past 5,000 characters is cut in stream-json and whole in the export, which the scorer reads; each turn holds its own rows; the token is masked', async () => {
    const t = trial('hermes');
    const s = await session('hermes', t, 's1', 'alice', [NOTES, 'run: gbrain recall', 'run: cat "$HERMES_HOME/.env"']);
    for (const turn of s.turns) expect(turn.response.exit, turn.response.detail).toBe(0);
    const one = rows(s, 1), two = rows(s, 2), three = rows(s, 3);
    for (const [r, n] of [[one, 1], [two, 2], [three, 3]] as const) {
      expect(r.map((x) => x.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
      expect(r.every((x) => x.turn === n && x.session_id === one[0].session_id && x.active === 1)).toBe(true);
    }
    expect(two[0].id).toBe(one[3].id + 1);
    expect(two[1].tool_calls[0].function.name).toBe('terminal');
    expect(JSON.parse(two[1].tool_calls[0].function.arguments)).toEqual({ command: 'gbrain recall' });
    expect(two[2]).toMatchObject({ tool_name: 'terminal', tool_call_id: two[1].tool_calls[0].id, finish_reason: null });
    const whole = JSON.parse(two[2].content).output as string;
    expect(whole.indexOf('Quillfern')).toBeGreaterThan(5000);
    const cut = stream(s, 2).find((e) => e.type === 'tool_result');
    expect(cut.output.length).toBe(5003);
    expect(cut.output.includes('Quillfern')).toBe(false);
    const [call] = parseTurn('hermes', s.logs, 2, 's1');
    expect(isGbrainCall(call!)).toBe(true);
    expect(hasToken(call!.output, 'Quillfern')).toBe(true);
    const shown = readFileSync(join(s.logs, 'turns', 'turn-0003.hermes-session.jsonl'), 'utf8');
    expect(shown.includes(TOKEN)).toBe(false);
    expect(shown).toContain('ANTHROPIC_API_KEY=[HE_MODEL_API_KEY]');
  }, 120_000);

  test('a result Hermes moved to cache/spillover is exported with the saved file, and the scorer reads it', async () => {
    const t = trial('hermes');
    const s = await session('hermes', t, 's1', 'alice', [NOTES, 'run: gbrain recall'], { STUB_HERMES_SPILL_CHARS: '6000' });
    const tool = rows(s, 2).find((x) => x.role === 'tool');
    expect(tool.content).toContain('<persisted-output>');
    expect(tool.content.includes('Quillfern')).toBe(false);
    expect(tool.spillover.path).toBe(join(t.state, 'hermes', 'cache', 'spillover', tool.tool_call_id + '.txt'));
    expect(JSON.parse(tool.spillover.content).output).toContain('the launch code is Quillfern');
    const [call] = parseTurn('hermes', s.logs, 2, 's1');
    expect(hasToken(call!.output, 'Quillfern')).toBe(true);
  }, 120_000);
});

describe('probe.sh', () => {
  const home = () => { const d = mkdtempSync(join(tmpdir(), 'he-probe-')); mkdirSync(join(d, 'workspace')); return d; };
  const probeEnv = (d: string, withGbrain: boolean, extra: Record<string, string> = {}) => ({ PATH: (withGbrain ? BIN + ':' : '') + SYSTEM_PATH, HOME: d, HE_WORKSPACE_DIR: join(d, 'workspace'), ...extra });
  const state = (h: Harness, e: Record<string, string>) => {
    const r = spawnSync('bash', [PROBE, 'state', h], { env: e, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };

  test.each(HARNESSES)('%s: an empty home reports nothing installed', (h) => {
    const d = home();
    const s = state(h, probeEnv(d, false));
    expect(s).toMatchObject({ harness: h, binary: null, version: null, brain: false, brain_path: null, mcp: false, instructions: false, hook: false, wired: [], ok: false });
  });

  test.skipIf(!NODE).each(HARNESSES)('%s: after gbrain init and setup it reports the binary, the brain and the wiring', (h) => {
    const d = home();
    const dirs: Record<Harness, Record<string, string>> = { 'claude-code': { CLAUDE_CONFIG_DIR: join(d, '.claude') }, codex: { CODEX_HOME: join(d, '.codex') }, openclaw: { OPENCLAW_STATE_DIR: join(d, '.openclaw') }, hermes: { HERMES_HOME: join(d, '.hermes') } };
    const e = probeEnv(d, true, dirs[h]);
    for (const args of [['init'], ['setup', h]]) expect(spawnSync(join(BIN, 'gbrain'), args, { env: e, encoding: 'utf8' }).status).toBe(0);
    const s = state(h, e);
    expect(s).toMatchObject({ harness: h, binary: join(BIN, 'gbrain'), version: '0.60.717.0', brain: true, brain_path: join(d, '.gbrain/brain.pglite'), instructions: true, hook: false, ok: true });
    expect(s.mcp).toBe(h !== 'openclaw');
    expect(s.wired.length).toBeGreaterThan(0);
  });

  test('watch appends a line when the state changes, keeps the alive file fresh and exits when the watched process is gone', async () => {
    const d = home();
    const out = join(d, 'logs', 'install-watch.ndjson');
    mkdirSync(dirname(out));
    const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
    const e = probeEnv(d, true, { CLAUDE_CONFIG_DIR: join(d, '.claude') });
    const watcher = spawn('bash', [PROBE, 'watch', 'claude-code', out, String(sleeper.pid)], { env: e, stdio: 'ignore' });
    const exited = new Promise<number | null>((res) => watcher.once('exit', (code) => res(code)));
    const lines = () => existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await Bun.sleep(100); return f(); };
    expect(await until(() => lines().length === 1)).toBe(true);
    expect(lines()[0]).toMatchObject({ brain: false, ok: false });
    spawnSync(join(BIN, 'gbrain'), ['init'], { env: e });
    expect(await until(() => lines().length === 2)).toBe(true);
    expect(lines()[1]).toMatchObject({ brain: true, ok: false });
    await Bun.sleep(1500);
    expect(lines().length).toBe(2);
    expect(Date.now() - statSync(join(dirname(out), 'install-watch.alive')).mtimeMs).toBeLessThan(3000);
    sleeper.kill('SIGKILL');
    const code = await Promise.race([exited, Bun.sleep(5000).then(() => { watcher.kill('SIGKILL'); return 'timeout'; })]);
    expect(code).toBe(0);
  }, 30_000);
});
