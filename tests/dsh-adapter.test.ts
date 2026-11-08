// The DeepSeek Harness (dsh) adapter (harnesses/dsh), keyless, process level: adapter.sh runs in temp directories with a
// stand-in dsh CLI on PATH (tests/fixtures/dsh/bin/dsh), stdin closed and no TTY, under a scrubbed environment: the exit
// mapping, the session id kept per key, the MCP check, the version check and the refusals. No model is called and no key
// is read. The image itself is checked with harnesses/serve-smoke.ts (harnesses/dsh/README.md).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TurnRequest, TurnResponse } from '../runner/contracts.ts';
import { trialKey } from '../runner/trial/proxy.ts';
import type { WorldServer } from '../world/services/server.ts';
import { startWorld } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'harnesses/dsh');
const ADAPTER = join(DIR, 'adapter.sh');
const PATCH = join(DIR, 'config/patch.yml');
const PIN = JSON.parse(readFileSync(join(DIR, 'pin.json'), 'utf8')) as { version: string };
const STUB_BIN = join(ROOT, 'tests/fixtures/dsh/bin');
const NODE = Bun.which('node');
const PATH = [STUB_BIN, ...(NODE ? [dirname(NODE)] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const MODEL = 'claude-opus-5-5';
const BASE = 'http://127.0.0.1:1/dsh-test/anthropic';
const TURN_FLAGS = ['--profile', 'headless', '--patch', PATCH, '--json', '--permission-mode', 'danger-full-access'];

interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string; stubLog: string }

function trial(instruction: string): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-dsh-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), stubLog: join(dir, 'stub.ndjson') };
  for (const d of [t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.workspace, 'instruction.md'), instruction);
  return t;
}

function tree(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? prefix + '/' + name : name;
    out.push(rel);
    if (statSync(join(dir, name)).isDirectory()) out.push(...tree(join(dir, name), rel));
  }
  return out;
}

/** The scrubbed environment every adapter process gets: this allowlist and nothing from the test's own environment. */
function baseEnv(t: Trial, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH,
    HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns,
    HE_MODEL_BASE_URL: BASE, HE_MODEL_API_KEY: trialKey('dsh-test') + '.0123456789abcdef0123456789abcdef', HE_MODEL_NAME: MODEL,
    HE_TIME_BUDGET_S: '10', HE_TASK_SLICE: 'smoke', HE_TRIAL_ID: 'dsh-test', STUB_LOG: t.stubLog,
    ...extra,
  };
}

const runAdapter = (t: Trial, extra: Record<string, string> = {}, entry = 'run') =>
  spawnSync('bash', [ADAPTER, entry], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: baseEnv(t, extra), timeout: 90_000 });
const stubCalls = (t: Trial) => existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const adapterLog = (t: Trial) => existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : '';
const alive = (command: string) => spawnSync('pgrep', ['-f', '^' + command + '$'], { encoding: 'utf8' }).stdout.trim();

describe.skipIf(!NODE)('dsh adapter, run, process level', () => {
  test('one turn: exit 0, the pinned turn flags, the patch reads the cell model and base URL, the trial token as the key, state under HE_SESSION_STATE_DIR', () => {
    const t = trial('Say hello.');
    const r = runAdapter(t);
    expect(r.status, r.stderr).toBe(0);
    const [call] = stubCalls(t);
    expect(call.args).toEqual([...TURN_FLAGS, '-']);
    expect(call.tty).toBe(false);
    expect(call.cwd).toBe(t.workspace);
    expect(call.sid).toBe(call.pid);
    expect(call.api_key_is_trial_token).toBe(true);
    expect(call.env).toEqual({
      HOME: t.state, DSH_HOME: join(t.state, 'dsh'), TMPDIR: join(t.state, 'tmp'), DSH_TELEMETRY_DISABLED: '1', HE_MODEL_NAME: MODEL, HE_MODEL_BASE_URL: BASE,
    });
    expect(readFileSync(join(t.logs, 'stdout.log'), 'utf8')).toContain('stub reply: session session-stub-1 turn 1 model ' + MODEL);
    expect(JSON.parse(readFileSync(join(t.state, 'dsh-sessions.json'), 'utf8'))).toEqual({ 'run:dsh-test': 'session-stub-1' });
    expect(tree(t.workspace)).toEqual(['instruction.md']);
    expect(tree(t.dir).some((p) => p.endsWith('.credentials.yaml'))).toBe(false);
    expect(adapterLog(t)).toContain('dsh ' + PIN.version + ' model=anthropic/' + MODEL);
  });

  test('exit mapping: an HTTP status and an unreachable proxy are 3; another error, a crash, a startup failure or unparsed output is 2', () => {
    for (const [marker, code] of [['[stub:api_error 402]', 3], ['[stub:api_error 500]', 3], ['[stub:unreachable]', 3], ['[stub:other_error]', 2],
      ['[stub:crash]', 2], ['[stub:startup_fail]', 2], ['[stub:garbage]', 2]] as const) {
      const t = trial('hello ' + marker);
      expect(runAdapter(t).status, marker).toBe(code);
    }
  });

  test('HE_MODEL_BASE_URL that does not end in /anthropic is 2 before any turn, with the reason in adapter.log', () => {
    for (const base of ['http://127.0.0.1:1/dsh-test/openai', 'http://127.0.0.1:1/dsh-test/anthropic/v1', 'http://127.0.0.1:1/dsh-test']) {
      const t = trial('hello');
      expect(runAdapter(t, { HE_MODEL_BASE_URL: base }).status, base).toBe(2);
      expect(stubCalls(t)).toEqual([]);
      expect(adapterLog(t)).toContain('HE_MODEL_BASE_URL ' + base + ' does not end in /anthropic: dsh runs only on an anthropic cell');
    }
  });

  test('a turn past HE_TIME_BUDGET_S is 124 and leaves no process of its session behind', () => {
    const t = trial('hello [stub:sleep 7413]');
    const began = Date.now();
    expect(runAdapter(t, { HE_TIME_BUDGET_S: '2' }).status).toBe(124);
    expect(Date.now() - began).toBeLessThan(15_000);
    expect(alive('sleep 7413')).toBe('');
  }, 30_000);

  test('SIGTERM during a run turn stops it within the grace: exit 2, the session killed', async () => {
    const t = trial('hello [stub:sleep 7423]');
    const child = spawn('bash', [ADAPTER, 'run'], { stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv(t, { HE_TIME_BUDGET_S: '120' }) });
    const until = Date.now() + 30_000;
    while (alive('sleep 7423') === '' && Date.now() < until) await Bun.sleep(50);
    expect(alive('sleep 7423')).not.toBe('');
    const done = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
    child.kill('SIGTERM');
    expect(await done).toBe(2);
    expect(alive('sleep 7423')).toBe('');
    expect(adapterLog(t)).toContain('exit 2: stopped by SIGTERM during the turn');
  }, 60_000);

  test('a dsh version other than pin.json, HE_SESSION_SCOPE=turn, HE_GBRAIN_INSTALL, an unknown config or entry point is 2 before any turn', () => {
    let t = trial('hello');
    expect(runAdapter(t, { STUB_DSH_VERSION: '0.2.1-rc.5' }).status).toBe(2);
    expect(adapterLog(t)).toContain("dsh --version is '0.2.1-rc.5', pin.json says " + PIN.version);
    expect(stubCalls(t)).toEqual([]);
    t = trial('hello');
    expect(runAdapter(t, { HE_SESSION_SCOPE: 'turn' }).status).toBe(2);
    expect(stubCalls(t)).toEqual([]);
    t = trial('hello');
    expect(runAdapter(t, { HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev' }).status).toBe(2);
    expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8'))).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'dsh', install: 'gbrain-docs' });
    expect(stubCalls(t)).toEqual([]);
    t = trial('hello');
    expect(runAdapter(t, { HE_HARNESS_CONFIG: 'official-minimal' }).status).toBe(2);
    expect(adapterLog(t)).toContain('HE-ADAPTER-007 HE_HARNESS_CONFIG=official-minimal is not a dsh config');
    expect(runAdapter(trial('hello'), {}, 'watch').status).toBe(2);
  });
});

// ---- serve, process level --------------------------------------------------------------------------

function request(turn: number, over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    turn, trial_id: 'dsh-test', prompt: 'You are the workspace bot. Dana Okafor asks: hello?',
    actor: { member: 'dana-okafor', slack_user_id: 'U0DANA', name: 'Dana Okafor', role: 'Account Manager', team: 'team-north' },
    channel: { id: 'D0DANA', name: 'dana-okafor', type: 'dm' }, text: 'hello?', ts: '1791986400.000001', thread_ts: null,
    sim_now: '2026-10-14T09:00:00-05:00', time_budget_s: 10, ...over,
  };
}

function postRequest(turnsDir: string, req: TurnRequest): void {
  const name = 'turn-' + String(req.turn).padStart(4, '0');
  writeFileSync(join(turnsDir, name + '.request.json.tmp'), JSON.stringify(req));
  renameSync(join(turnsDir, name + '.request.json.tmp'), join(turnsDir, name + '.request.json'));
}

async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (pred()) return; await Bun.sleep(50); }
  throw new Error('timed out after ' + ms + ' ms waiting for ' + what);
}

async function response(turnsDir: string, turn: number, ms = 20_000): Promise<TurnResponse> {
  const path = join(turnsDir, 'turn-' + String(turn).padStart(4, '0') + '.response.json');
  await waitFor(() => existsSync(path), ms, 'response for turn ' + turn);
  return JSON.parse(readFileSync(path, 'utf8')) as TurnResponse;
}

function exited(child: ChildProcess, ms: number): Promise<number | null | 'hung'> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return Promise.race([new Promise<number | null>((res) => child.once('exit', (code) => res(code))), Bun.sleep(ms).then(() => 'hung' as const)]);
}

async function stop(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const done = exited(child, 6_000);
  child.kill('SIGTERM');
  const v = await done;
  if (v === 'hung') { child.kill('SIGKILL'); throw new Error('serve did not stop within 6 s of SIGTERM'); }
  return v;
}

describe.skipIf(!NODE)('dsh adapter, serve, process level', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('dsh-serve'); });
  afterAll(() => { ws.stop(); });
  const worldEnv = () => ({ HE_WORLD_MCP_URL: ws.url + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token, HE_TASK_SLICE: 'multiuser' });
  const startServe = (t: Trial, extra: Record<string, string> = {}) =>
    spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv(t, { ...worldEnv(), ...extra }) });

  test('ready after the tools/list check, a new Session for a new key and --session-id after, one Session per conversation and thread, a clean stop', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'));
      expect(ready).toMatchObject({ harness: 'dsh', version: PIN.version, trial: 'dsh-test', mcp_servers: 'world' });
      expect(ready.adapter_sha256).toBe(createHash('sha256').update(readFileSync(ADAPTER)).digest('hex'));
      expect(adapterLog(t)).toMatch(/MCP server world: tools\/list answered \d+ tools/);

      postRequest(t.turns, request(1));
      expect(await response(t.turns, 1)).toMatchObject({ turn: 1, exit: 0, reply_text: 'stub reply: session session-stub-1 turn 1 model ' + MODEL });
      postRequest(t.turns, request(2, { actor: { member: 'ilse-varga', slack_user_id: 'U0ILSE', name: 'Ilse Varga', role: 'Engineer', team: 'team-south' },
        channel: { id: 'C0NORTH', name: 'north-team', type: 'channel' } }));
      expect((await response(t.turns, 2)).reply_text).toBe('stub reply: session session-stub-2 turn 1 model ' + MODEL);
      postRequest(t.turns, request(3));
      expect((await response(t.turns, 3)).reply_text).toBe('stub reply: session session-stub-1 turn 2 model ' + MODEL);
      postRequest(t.turns, request(4, { ts: '1700000400.000100', thread_ts: '1700000400.000100' }));
      expect((await response(t.turns, 4)).reply_text).toBe('stub reply: session session-stub-3 turn 1 model ' + MODEL);

      const flags = stubCalls(t).map((c) => c.args.slice(TURN_FLAGS.length).join(' '));
      expect(flags).toEqual(['-', '-', '--session-id session-stub-1 -', '-']);
      expect(stubCalls(t).every((c) => c.tty === false && c.sid === c.pid)).toBe(true);
      expect(JSON.parse(readFileSync(join(t.state, 'dsh-sessions.json'), 'utf8'))).toEqual({
        'dm:dana-okafor': 'session-stub-1', 'channel:C0NORTH': 'session-stub-2', 'dm:dana-okafor:t1700000400.000100': 'session-stub-3',
      });
      expect(tree(t.turns).filter((p) => p.endsWith('.response.json'))).toHaveLength(4);
      expect(tree(t.turns).some((p) => p.endsWith('.tmp'))).toBe(false);
      expect(readFileSync(join(t.logs, 'turns/turn-0001.prompt.md'), 'utf8')).toBe(request(1).prompt);
    } finally {
      expect(await stop(child)).toBe(0);
    }
    expect(adapterLog(t)).toContain('stopped on signal');
  }, 60_000);

  test('per-turn exit mapping: 3 for an HTTP status or an unreachable proxy, 2 for a crash, unparsed output or a mid-turn MCP transport failure, 0 for a tool\'s own error, 124 past the budget; serving goes on', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      const cases: Array<[string, number, RegExp]> = [
        ['[stub:api_error 402]', 3, /^model error: PI_AI_ERROR 402 /],
        ['[stub:unreachable]', 3, /^model error: TRANSPORT Connection error\./],
        ['[stub:other_error]', 2, /^final reason error: TOOL_LOOP/],
        ['[stub:crash]', 2, /^no final event \(dsh exit 1\)/],
        ['[stub:garbage]', 2, /^no session event/],
        ['[stub:mcp_http]', 2, /^MCP transport error: mcp__world__post_message: Error: Error POSTing to endpoint: bad gateway/],
        ['[stub:mcp_timeout]', 2, /^MCP transport error: mcp__world__post_message: MCP error -32001: Request timed out/],
      ];
      for (const [i, [marker, code, detail]] of cases.entries()) {
        postRequest(t.turns, request(i + 1, { prompt: 'hello ' + marker, channel: { id: 'C' + i, name: 'c' + i, type: 'channel' } }));
        const r = await response(t.turns, i + 1);
        expect(r, marker).toMatchObject({ exit: code, reply_text: null });
        expect(r.detail, marker).toMatch(detail);
      }
      expect(JSON.parse(readFileSync(join(t.logs, 'turns/turn-0006.status.json'), 'utf8'))).toMatchObject({ dsh_exit: 0, reason: 'completed', mcp_tool_calls: 1, mcp_transport_errors: 1 });
      postRequest(t.turns, request(8, { prompt: 'hello [stub:mcp_tool_error]', channel: { id: 'C8', name: 'c8', type: 'channel' } }));
      expect(await response(t.turns, 8)).toMatchObject({ exit: 0 });
      postRequest(t.turns, request(9, { prompt: 'hello [stub:sleep 7417]', time_budget_s: 2 }));
      const r9 = await response(t.turns, 9);
      expect(r9).toMatchObject({ exit: 124, reply_text: null, detail: 'wall clock exceeded (2s)' });
      expect(alive('sleep 7417')).toBe('');
      postRequest(t.turns, request(10));
      expect(await response(t.turns, 10)).toMatchObject({ exit: 0 });
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 90_000);

  test('SIGTERM during a turn answers it with 2, kills its session and exits 0', async () => {
    const t = trial('');
    const child = startServe(t);
    await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
    postRequest(t.turns, request(1, { prompt: 'hello [stub:sleep 7419]', time_budget_s: 60 }));
    await waitFor(() => alive('sleep 7419') !== '', 10_000, 'the turn to start');
    expect(await stop(child)).toBe(0);
    expect(JSON.parse(readFileSync(join(t.turns, 'turn-0001.response.json'), 'utf8'))).toMatchObject({ exit: 2, reply_text: null, detail: 'stopped by SIGTERM during the turn' });
    expect(alive('sleep 7419')).toBe('');
  }, 30_000);

  test('the MCP check before ready: a refused token, a closed port or a missing world is 2 with no ready file', async () => {
    for (const extra of [{ HE_WORLD_MCP_TOKEN: 'xoxb-wrong' }, { HE_WORLD_MCP_URL: 'http://127.0.0.1:1/mcp' }, { HE_WORLD_MCP_URL: '' }] as Array<Record<string, string>>) {
      const t = trial('');
      expect(await exited(startServe(t, extra), 30_000), JSON.stringify(extra)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      expect(stubCalls(t)).toEqual([]);
    }
  }, 90_000);
});
