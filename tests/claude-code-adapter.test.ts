// The Claude Code harness (harnesses/claude-code), keyless. Two layers:
//   1. process level, always on: adapter.sh runs in temp directories with a stand-in claude CLI on PATH
//      (tests/fixtures/claude-code/bin/claude), stdin closed and no TTY, under a scrubbed environment: the exit
//      mapping, the session id choice, the MCP checks, the version check and the refusals.
//   2. container level, when docker is available: the image built from the checkout serves turns through the real
//      metering proxy in lease mode to a fake Anthropic endpoint in this process, with an in-process world.
// No model is called and no key is read: the proxy's upstream key is a placeholder passed in its own environment.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TurnRequest, TurnResponse } from '../runner/contracts.ts';
import { trialKey, trialToken } from '../runner/trial/proxy.ts';
import { containerHostAddress } from '../runner/trial/world.ts';
import { stream } from '../scripts/gsta-135/fake-anthropic.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { startWorld, world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'harnesses/claude-code');
const ADAPTER = join(DIR, 'adapter.sh');
const PIN = JSON.parse(readFileSync(join(DIR, 'pin.json'), 'utf8')) as { version: string; integrity: { native_binary_sha256: string } };
const STUB_BIN = join(ROOT, 'tests/fixtures/claude-code/bin');
const NODE = Bun.which('node');
const PATH = [STUB_BIN, ...(NODE ? [dirname(NODE)] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const MODEL = 'claude-haiku-5-5';

/** The adapter's session id: UUIDv5 in the URL namespace of harness-evals:claude-code:<key>. */
function sessionUuid(key: string): string {
  const h = createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')).update('harness-evals:claude-code:' + key).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}

interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string; stubLog: string }

function trial(instruction: string): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-claude-code-'));
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
    HE_MODEL_BASE_URL: 'http://127.0.0.1:1/cc-test/anthropic', HE_MODEL_API_KEY: trialKey('cc-test') + '.0123456789abcdef0123456789abcdef', HE_MODEL_NAME: MODEL,
    HE_TIME_BUDGET_S: '10', HE_TASK_SLICE: 'smoke', HE_TRIAL_ID: 'cc-test', STUB_LOG: t.stubLog,
    ...extra,
  };
}

const runAdapter = (t: Trial, extra: Record<string, string> = {}, entry = 'run') =>
  spawnSync('bash', [ADAPTER, entry], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: baseEnv(t, extra), timeout: 90_000 });
const stubCalls = (t: Trial) => existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const adapterLog = (t: Trial) => existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : '';
const alive = (command: string) => spawnSync('pgrep', ['-f', '^' + command + '$'], { encoding: 'utf8' }).stdout.trim();
const MODEL_VARS = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL', 'CLAUDE_CODE_AUTO_MODE_MODEL', 'CLAUDE_CODE_BG_CLASSIFIER_MODEL'];

describe.skipIf(!NODE)('claude-code adapter, run, process level', () => {
  test('one turn: exit 0, the pinned turn flags, every model setting on the cell model, the trial token as the key, state under HE_SESSION_STATE_DIR', () => {
    const t = trial('Say hello.');
    const r = runAdapter(t);
    expect(r.status, r.stderr).toBe(0);
    const [call] = stubCalls(t);
    const sid = sessionUuid('run:cc-test');
    expect(call.args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--permission-mode', 'bypassPermissions',
      '--disallowedTools', 'WebSearch,WebFetch', '--mcp-config', join(t.state, 'mcp.json'), '--strict-mcp-config', '--session-id', sid]);
    expect(call.tty).toBe(false);
    expect(call.cwd).toBe(t.workspace);
    expect(call.sid).toBe(call.pid);
    expect(Object.keys(call.models).sort()).toEqual([...MODEL_VARS].sort());
    for (const v of MODEL_VARS) expect(call.models[v]).toBe(MODEL);
    expect(call.api_key_is_trial_token).toBe(true);
    expect(call.env).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/cc-test/anthropic', HOME: t.state, CLAUDE_CONFIG_DIR: join(t.state, 'claude'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_MAX_RETRIES: '2', MCP_CONNECTION_NONBLOCKING: 'false', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_NO_MODEL_FALLBACK: '1',
      CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: '1', CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1',
    });
    expect(readFileSync(join(t.logs, 'stdout.log'), 'utf8')).toContain('stub reply: session ' + sid + ' turn 1 model ' + MODEL);
    expect(JSON.parse(readFileSync(join(t.state, 'mcp.json'), 'utf8'))).toEqual({ mcpServers: {} });
    expect(JSON.parse(readFileSync(join(t.state, 'claude/settings.json'), 'utf8'))).toEqual({ permissions: { deny: ['WebSearch', 'WebFetch'] } });
    const projects = readdirSync(join(t.state, 'claude/projects'));
    expect(projects).toHaveLength(1);
    expect(readdirSync(join(t.state, 'claude/projects', projects[0]!))).toEqual([sid + '.jsonl']);
    expect(tree(t.workspace)).toEqual(['instruction.md']);
    expect(readdirSync(t.dir).sort()).toEqual(['logs', 'state', 'stub.ndjson', 'turns', 'workspace']);
    expect(tree(t.dir).some((p) => p.endsWith('.credentials.json'))).toBe(false);
    expect(adapterLog(t)).toContain('claude-code ' + PIN.version + ' model=anthropic/' + MODEL);
  });

  test('exit mapping: an API error status and an unreachable proxy are 3, a crash or unparsed output is 2', () => {
    for (const [marker, code] of [['[stub:api_error 403]', 3], ['[stub:api_error 400]', 3], ['[stub:unreachable]', 3], ['[stub:crash]', 2], ['[stub:garbage]', 2]] as const) {
      const t = trial('hello ' + marker);
      expect(runAdapter(t).status, marker).toBe(code);
    }
  });

  test('HE_MODEL_BASE_URL that does not end in /anthropic is 2 before any turn, with the reason in adapter.log', () => {
    for (const base of ['http://127.0.0.1:1/cc-test/openai', 'http://127.0.0.1:1/cc-test/anthropic/v1', 'http://127.0.0.1:1/cc-test']) {
      const t = trial('hello');
      expect(runAdapter(t, { HE_MODEL_BASE_URL: base }).status, base).toBe(2);
      expect(stubCalls(t)).toEqual([]);
      expect(adapterLog(t)).toContain('HE_MODEL_BASE_URL ' + base + ' does not end in /anthropic: claude-code runs only on an anthropic cell');
    }
    expect(runAdapter(trial('hello'), { HE_MODEL_BASE_URL: 'http://127.0.0.1:1/cc-test/anthropic/' }).status).toBe(0);
  });

  test('SIGTERM during a run turn stops it within the grace: exit 2, the session killed', async () => {
    const t = trial('hello [stub:sleep 7323]');
    const child = spawn('bash', [ADAPTER, 'run'], { stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv(t, { HE_TIME_BUDGET_S: '120' }) });
    const until = Date.now() + 30_000;
    while (alive('sleep 7323') === '' && Date.now() < until) await Bun.sleep(50);
    expect(alive('sleep 7323')).not.toBe('');
    const began = Date.now();
    const done = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
    child.kill('SIGTERM');
    expect(await done).toBe(2);
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(alive('sleep 7323')).toBe('');
    expect(adapterLog(t)).toContain('exit 2: stopped by SIGTERM during the turn');
  }, 60_000);

  test('a turn past HE_TIME_BUDGET_S is 124 and leaves no process of its session behind', () => {
    const t = trial('hello [stub:sleep 7313]');
    const began = Date.now();
    const r = runAdapter(t, { HE_TIME_BUDGET_S: '2' });
    expect(r.status).toBe(124);
    expect(Date.now() - began).toBeLessThan(15_000);
    expect(alive('sleep 7313')).toBe('');
  }, 30_000);

  test('a CLI version other than pin.json is 2 before any turn', () => {
    const t = trial('hello');
    const r = runAdapter(t, { STUB_CLAUDE_VERSION: '2.1.311' });
    expect(r.status).toBe(2);
    expect(stubCalls(t)).toEqual([]);
    expect(adapterLog(t)).toContain("claude --version is '2.1.311', pin.json says " + PIN.version);
  });

  test('HE_SESSION_SCOPE=turn, HE_GBRAIN_INSTALL and an unknown entry point are 2', () => {
    let t = trial('hello');
    expect(runAdapter(t, { HE_SESSION_SCOPE: 'turn' }).status).toBe(2);
    expect(stubCalls(t)).toEqual([]);
    t = trial('hello');
    expect(runAdapter(t, { HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev' }).status).toBe(2);
    expect(adapterLog(t)).toContain('HE-ADAPTER-006 the install bundle could not be applied');
    expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8'))).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'claude-code', install: 'gbrain-docs' });
    expect(stubCalls(t)).toEqual([]);
    t = trial('hello');
    expect(runAdapter(t, {}, 'watch').status).toBe(2);
  });
});

// ---- serve, process level --------------------------------------------------------------------------

function request(turn: number, over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    turn, trial_id: 'cc-test', prompt: 'You are the workspace bot. Dana Okafor asks: hello?',
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

describe.skipIf(!NODE)('claude-code adapter, serve, process level', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('cc-serve'); });
  afterAll(() => { ws.stop(); });
  const worldEnv = () => ({ HE_WORLD_MCP_URL: ws.url + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token, HE_TASK_SLICE: 'multiuser' });
  const startServe = (t: Trial, extra: Record<string, string> = {}) =>
    spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv(t, { ...worldEnv(), ...extra }) });

  test('ready after the tools/list check, --session-id for a new key and --resume after, one session per conversation and thread, a clean stop', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'));
      expect(ready).toMatchObject({ harness: 'claude-code', version: PIN.version, trial: 'cc-test', mcp_servers: 'world' });
      expect(ready.adapter_sha256).toBe(createHash('sha256').update(readFileSync(ADAPTER)).digest('hex'));
      expect(JSON.parse(readFileSync(join(t.state, 'mcp.json'), 'utf8'))).toEqual({
        mcpServers: { world: { type: 'http', url: ws.url + '/mcp', headers: { Authorization: 'Bearer ' + ws.credentials.bot.token } } },
      });
      expect(statSync(join(t.state, 'mcp.json')).mode & 0o077).toBe(0);
      expect(adapterLog(t)).toMatch(/MCP server world: tools\/list answered \d+ tools/);

      const dm = sessionUuid('dm:dana-okafor'), chan = sessionUuid('channel:C0NORTH'), thread = sessionUuid('dm:dana-okafor:t1700000400.000100');
      postRequest(t.turns, request(1));
      expect(await response(t.turns, 1)).toMatchObject({ turn: 1, exit: 0, reply_text: 'stub reply: session ' + dm + ' turn 1 model ' + MODEL });
      postRequest(t.turns, request(2, { actor: { member: 'ilse-varga', slack_user_id: 'U0ILSE', name: 'Ilse Varga', role: 'Engineer', team: 'team-south' },
        channel: { id: 'C0NORTH', name: 'north-team', type: 'channel' } }));
      expect((await response(t.turns, 2)).reply_text).toBe('stub reply: session ' + chan + ' turn 1 model ' + MODEL);
      postRequest(t.turns, request(3));
      expect((await response(t.turns, 3)).reply_text).toBe('stub reply: session ' + dm + ' turn 2 model ' + MODEL);
      postRequest(t.turns, request(4, { ts: '1700000400.000100', thread_ts: '1700000400.000100' }));
      expect((await response(t.turns, 4)).reply_text).toBe('stub reply: session ' + thread + ' turn 1 model ' + MODEL);

      const flags = stubCalls(t).map((c) => c.args.slice(-2).join(' '));
      expect(flags).toEqual(['--session-id ' + dm, '--session-id ' + chan, '--resume ' + dm, '--session-id ' + thread]);
      expect(stubCalls(t).every((c) => c.args.includes('--mcp-config') && c.args.includes('--strict-mcp-config') && c.tty === false && c.sid === c.pid)).toBe(true);
      expect(tree(t.turns).filter((p) => p.endsWith('.response.json'))).toHaveLength(4);
      expect(tree(t.turns).some((p) => p.endsWith('.tmp'))).toBe(false);
      expect(tree(t.workspace)).toEqual(['instruction.md']);
      expect(readFileSync(join(t.logs, 'turns/turn-0001.prompt.md'), 'utf8')).toBe(request(1).prompt);
      expect(adapterLog(t)).toContain('session dm:dana-okafor: the init record says claude-code ' + PIN.version);
    } finally {
      expect(await stop(child)).toBe(0);
    }
    expect(adapterLog(t)).toContain('stopped on signal');
  }, 60_000);

  test('per-turn exit mapping: 3 for an API error or an unreachable proxy, 2 for a crash, unparsed output, a server not connected, a mid-turn MCP transport failure or another version, 124 past the budget; serving goes on', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      const cases: Array<[string, number, RegExp]> = [
        ['[stub:api_error 402]', 3, /model error: API 402/],
        ['[stub:unreachable]', 3, /model error: API unreachable/],
        ['[stub:crash]', 2, /no result record \(claude exit 1\)/],
        ['[stub:garbage]', 2, /no init record/],
        ['[stub:mcp_down]', 2, /MCP server not connected: world failed/],
        ['[stub:mcp_transport]', 2, /^MCP transport error: mcp__world__post_message: ECONNREFUSED: Unable to connect/],
        ['[stub:mcp_http]', 2, /^MCP transport error: mcp__world__post_message: Error POSTing to endpoint: bad gateway/],
        ['[stub:mcp_timeout]', 2, /^MCP transport error: mcp__world__post_message: MCP server "world" tool "post_message" timed out after 1s/],
      ];
      for (const [i, [marker, code, detail]] of cases.entries()) {
        postRequest(t.turns, request(i + 1, { prompt: 'hello ' + marker, channel: { id: 'C' + i, name: 'c' + i, type: 'channel' } }));
        const r = await response(t.turns, i + 1);
        expect(r, marker).toMatchObject({ exit: code, reply_text: null });
        expect(r.detail, marker).toMatch(detail);
      }
      expect(JSON.parse(readFileSync(join(t.logs, 'turns/turn-0006.status.json'), 'utf8'))).toMatchObject({ claude_exit: 0, is_error: false, mcp_servers: { world: 'connected' }, mcp_transport_errors: 1 });
      postRequest(t.turns, request(9, { prompt: 'hello [stub:mcp_tool_error]', channel: { id: 'C9', name: 'c9', type: 'channel' } }));
      expect(await response(t.turns, 9)).toMatchObject({ exit: 0 });
      postRequest(t.turns, request(10, { prompt: 'hello [stub:sleep 7317]', time_budget_s: 2 }));
      const r6 = await response(t.turns, 10);
      expect(r6).toMatchObject({ exit: 124, reply_text: null, detail: 'wall clock exceeded (2s)' });
      expect(Date.parse(r6.ended_at) - Date.parse(r6.started_at)).toBeLessThan(8_000);
      expect(alive('sleep 7317')).toBe('');
      postRequest(t.turns, request(11));
      expect(await response(t.turns, 11)).toMatchObject({ exit: 0 });
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 90_000);

  test('an init record that names another CLI version fails the turn with 2', async () => {
    const t = trial('');
    const child = startServe(t, { STUB_INIT_VERSION: '2.1.400' });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      postRequest(t.turns, request(1));
      expect(await response(t.turns, 1)).toMatchObject({ exit: 2, reply_text: null, detail: 'claude 2.1.400 is not the pinned ' + PIN.version });
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 30_000);

  test('SIGTERM during a turn answers it with 2, kills its session and exits 0', async () => {
    const t = trial('');
    const child = startServe(t);
    await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
    postRequest(t.turns, request(1, { prompt: 'hello [stub:sleep 7319]', time_budget_s: 60 }));
    await waitFor(() => alive('sleep 7319') !== '', 10_000, 'the turn to start');
    const began = Date.now();
    expect(await stop(child)).toBe(0);
    expect(Date.now() - began).toBeLessThan(6_000);
    expect(JSON.parse(readFileSync(join(t.turns, 'turn-0001.response.json'), 'utf8'))).toMatchObject({ exit: 2, reply_text: null, detail: 'stopped by SIGTERM during the turn' });
    expect(alive('sleep 7319')).toBe('');
  }, 30_000);

  test('the MCP check before ready: a refused token, a closed port or a missing world is 2 with no ready file', async () => {
    for (const extra of [{ HE_WORLD_MCP_TOKEN: 'xoxb-wrong' }, { HE_WORLD_MCP_URL: 'http://127.0.0.1:1/mcp' }, { HE_WORLD_MCP_URL: '' }] as Array<Record<string, string>>) {
      const t = trial('');
      const child = startServe(t, extra);
      expect(await exited(child, 30_000), JSON.stringify(extra)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      expect(stubCalls(t)).toEqual([]);
    }
  }, 90_000);

  test('another CLI version, HE_SESSION_SCOPE=turn or HE_GBRAIN_INSTALL stops serve with 2 before ready', async () => {
    for (const extra of [{ STUB_CLAUDE_VERSION: '2.1.311' }, { HE_SESSION_SCOPE: 'turn' }, { HE_GBRAIN_INSTALL: 'gbrain-installer' }] as Array<Record<string, string>>) {
      const t = trial('');
      expect(await exited(startServe(t, extra), 15_000), JSON.stringify(extra)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
    }
  }, 60_000);

  test('gbrain beside world: a second server in mcp.json, its own tools/list check through the world tap, both required connected', async () => {
    const GBRAIN_TOKEN = 'gbrain_' + 'ef'.repeat(32);
    const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      if (req.headers.get('authorization') !== 'Bearer ' + GBRAIN_TOKEN) return Response.json({ error: 'invalid_token' }, { status: 401 });
      const body = await req.json() as { id: number };
      return new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'search' }, { name: 'get_page' }] } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    ws.setGbrain({ url: 'http://127.0.0.1:' + upstream.port, token: GBRAIN_TOKEN });
    const t = trial('');
    const before = ws.log.events.length;
    const child = startServe(t, { HE_GBRAIN_MCP_URL: ws.url + '/gbrain', HE_GBRAIN_MCP_TOKEN: ws.credentials.bot.token });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')).mcp_servers).toBe('world gbrain');
      expect(Object.keys(JSON.parse(readFileSync(join(t.state, 'mcp.json'), 'utf8')).mcpServers)).toEqual(['world', 'gbrain']);
      expect(adapterLog(t)).toContain('MCP server gbrain: tools/list answered 2 tools');
      expect(ws.log.events.slice(before).filter((e) => e.via === 'gbrain').map((e) => e.tool)).toEqual(['gbrain.tools/list']);
      postRequest(t.turns, request(1, { prompt: 'hello [stub:mcp_down]' }));
      expect((await response(t.turns, 1)).detail).toBe('MCP server not connected: world failed, gbrain failed');
    } finally {
      ws.setGbrain(null);
      upstream.stop(true);
      expect(await stop(child)).toBe(0);
    }
  }, 60_000);
});

// ---- container level -------------------------------------------------------------------------------

const DOCKER_ENV: Record<string, string> = { PATH: '/usr/local/bin:/usr/bin:/bin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) };
const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: DOCKER_ENV, timeout });
const haveDocker = docker(['version', '--format', '{{.Server.Version}}'], 15_000).status === 0;
const IMAGE = 'harness-eval/claude-code:dev';
const UPSTREAM_KEY = 'placeholder-upstream-anthropic-key';

interface Seen { path: string; apiKey: string | null; authorization: string | null; model: unknown; maxTokens: unknown; tail: string }

/** A fake Anthropic messages endpoint: the proxy's upstream. It records what reaches it and plays one scripted step per
 *  request from the newest prompt: [cc:post <channel> <text>] asks for the world's post_message tool, [cc:bash <cmd>] for
 *  the Bash tool, anything else (and every request after a tool result) gets a text answer. */
function fakeAnthropic(seen: Seen[]) {
  return Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({})) as { model?: string; max_tokens?: number; messages?: Array<{ role: string; content: unknown }> };
    const messages = body.messages ?? [];
    const lastAssistant = messages.map((m) => m.role).lastIndexOf('assistant');
    const tail = JSON.stringify(messages.slice(lastAssistant + 1));
    const text = messages.slice(lastAssistant + 1).flatMap((m) => typeof m.content === 'string' ? [m.content] : Array.isArray(m.content) ? m.content.map((b: { text?: string }) => b.text ?? '') : []).join('\n');
    seen.push({ path: url.pathname, apiKey: req.headers.get('x-api-key'), authorization: req.headers.get('authorization'), model: body.model, maxTokens: body.max_tokens, tail });
    let content: Array<Record<string, unknown>> = [{ type: 'text', text: 'fake reply ' + seen.length }];
    const post = text.match(/\[cc:post (\S+) ([^\]]+)\]/), bash = text.match(/\[cc:bash ([^\]]+)\]/);
    if (!tail.includes('tool_result') && post) content = [{ type: 'tool_use', id: 'toolu_post_' + seen.length, name: 'mcp__world__post_message', input: { channel: post[1], text: post[2] } }];
    else if (!tail.includes('tool_result') && bash) content = [{ type: 'tool_use', id: 'toolu_bash_' + seen.length, name: 'Bash', input: { command: bash[1], description: 'run it' } }];
    const stop = content[0]!.type === 'tool_use' ? 'tool_use' : 'end_turn';
    const msg = { id: 'msg_fake_' + seen.length, type: 'message', role: 'assistant', model: String(body.model ?? ''), content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    return new Response(stream(msg, content, stop), { headers: { 'content-type': 'text/event-stream' } });
  } });
}

/** The real metering proxy in lease mode on the docker bridge gateway, with a placeholder upstream key in its own environment. */
async function startProxy(o: { host: string; ledger: string; usageLog: string; upstream: number; control: string }) {
  let stderr = '';
  for (let port = 8840; port <= 8849; port++) {
    const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', o.host + ':' + port, '--budget-ledger', o.ledger, '--lease-usd', '5', '--run-id', 'cc-container', '--new-run',
      '--max-output-tokens', '128000', '--allow-models', 'anthropic:' + MODEL, '--upstream', 'anthropic=http://127.0.0.1:' + o.upstream, '--usage-log', o.usageLog, '--control-token', o.control],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ANTHROPIC_API_KEY: UPSTREAM_KEY }, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100; i++) {
      if (proc.exitCode !== null) break;
      try { await fetch('http://' + o.host + ':' + port + '/__proxy/status'); return { proc, port }; } catch { await Bun.sleep(50); }
    }
    proc.kill('SIGKILL'); await proc.exited;
    stderr = await new Response(proc.stderr).text();
    if (!/EADDRINUSE|address already in use|in use/i.test(stderr)) throw new Error('proxy did not start on ' + port + ': ' + stderr);
  }
  throw new Error('no free port in 8840-8849: ' + stderr);
}

describe.skipIf(!haveDocker)('claude-code image, container level', () => {
  test('the image builds from the checkout with the pinned CLI and native binary and no credentials file', () => {
    const build = docker(['build', '-q', '-t', IMAGE, DIR], 900_000);
    expect(build.status, build.stderr).toBe(0);
    const labels = JSON.parse(docker(['inspect', '-f', '{{json .Config.Labels}}', IMAGE]).stdout);
    expect(labels).toMatchObject({ 'harness-eval.harness': 'claude-code', 'harness-eval.version': PIN.version, 'harness-eval.topology': 'in-container' });
    const look = docker(['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'bash', IMAGE, '-c',
      'claude --version; sha256sum /opt/harness/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe; find / -xdev -name .credentials.json 2>/dev/null; sha256sum /opt/harness/adapter.sh']);
    expect(look.status, look.stderr).toBe(0);
    const lines = look.stdout.trim().split('\n');
    expect(lines[0]).toBe(PIN.version + ' (Claude Code)');
    expect(lines[1]!.split(' ')[0]).toBe(PIN.integrity.native_binary_sha256);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.split(' ')[0]).toBe(createHash('sha256').update(readFileSync(ADAPTER)).digest('hex'));
  }, 900_000);

  test('serve through the real proxy to a fake endpoint: metered on the cell model, the session kept, a world-MCP call landed, a timed-out turn killed whole, a mid-turn MCP transport failure is 2, nothing written outside the mounts', async () => {
    const gw = containerHostAddress();
    const seen: Seen[] = [];
    const fake = fakeAnthropic(seen);
    const dir = mkdtempSync(join(tmpdir(), 'he-claude-code-docker-'));
    const t = { workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns') };
    for (const d of Object.values(t)) mkdirSync(d);
    writeFileSync(join(t.workspace, 'instruction.md'), '');
    const trialId = 'cc-docker-' + process.pid;
    const usageLog = join(dir, 'usage.ndjson'), control = 'control-' + process.pid;
    const proxy = await startProxy({ host: gw, ledger: join(dir, 'ledger.sqlite'), usageLog, upstream: fake.port!, control });
    const token = trialToken(trialId);
    const ws = createWorldServer({ world, split: 'dev', trialId, eventsPath: null, hostname: gw, port: 0 });
    // The harness reaches the world through this front, which answers the next tools/call with a 502 when told to: the world
    // server gone behind its gateway in the middle of a turn, after the turn's init connected it.
    let failToolCall = false;
    const front = Bun.serve({ port: 0, hostname: gw, async fetch(req) {
      const u = new URL(req.url);
      const body = req.method === 'GET' ? undefined : await req.arrayBuffer();
      if (failToolCall && body && new TextDecoder().decode(body).includes('"tools/call"')) { failToolCall = false; return new Response('bad gateway', { status: 502 }); }
      return fetch(ws.url + u.pathname + u.search, { method: req.method, headers: req.headers, body });
    } });
    const name = 'he-claude-code-' + process.pid;
    let child: ChildProcess | null = null;
    try {
      const bound = await fetch('http://' + gw + ':' + proxy.port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control },
        body: JSON.stringify({ slot: trialId, key: trialKey(trialId), token }) });
      expect(bound.status).toBe(200);
      const worldPort = String(front.port);
      const env: Record<string, string> = {
        HE_MODEL_BASE_URL: 'http://host.docker.internal:' + proxy.port + '/' + trialId + '/anthropic', HE_MODEL_API_KEY: token, HE_MODEL_NAME: MODEL,
        HE_TIME_BUDGET_S: '90', HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: '/harness-state', HE_TURNS_DIR: '/he-turns', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: trialId,
        HE_WORLD_MCP_URL: 'http://host.docker.internal:' + worldPort + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token,
      };
      docker(['rm', '-f', name]);
      child = spawn('docker', ['run', '-i', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--add-host', 'host.docker.internal:host-gateway',
        '-v', t.workspace + ':/workspace', '-v', t.state + ':/harness-state', '-v', t.logs + ':/he-logs', '-v', t.turns + ':/he-turns',
        ...Object.entries(env).flatMap(([k, v]) => ['-e', k + '=' + v]), IMAGE, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: DOCKER_ENV });
      await waitFor(() => existsSync(join(t.logs, 'ready')), 60_000, 'ready file');
      const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'));
      expect(ready).toMatchObject({ harness: 'claude-code', version: PIN.version, mcp_servers: 'world' });
      expect(ready.adapter_sha256).toBe(createHash('sha256').update(readFileSync(ADAPTER)).digest('hex'));
      const inspect = JSON.parse(docker(['inspect', name]).stdout)[0];
      expect(inspect.Config.Tty).toBe(false);

      const channel = ws.service.channelsFor(ws.service.bot!, 'mcp').find((c) => c.kind !== 'dm')!;
      const before = ws.log.events.length;
      postRequest(t.turns, request(1, { trial_id: trialId, prompt: 'Dana asks you to post a note. [cc:post ' + channel.id + ' claude code container post]', time_budget_s: 90 }));
      const r1 = await response(t.turns, 1, 120_000);
      expect(r1, r1.detail).toMatchObject({ exit: 0 });
      const posted = ws.log.events.slice(before).find((e) => e.tool === 'chat.postMessage');
      expect(posted).toMatchObject({ actor: 'assistant', via: 'mcp', kind: 'write', outcome: 'ok' });
      expect((posted!.args as { text: string }).text).toBe('claude code container post');

      const firstTurnRequests = seen.length;
      postRequest(t.turns, request(2, { trial_id: trialId, prompt: 'Dana asks: what did I ask you before?', time_budget_s: 90 }));
      expect(await response(t.turns, 2, 120_000)).toMatchObject({ exit: 0 });
      const turn2 = seen.slice(firstTurnRequests);
      expect(turn2.length).toBeGreaterThan(0);
      const sid = sessionUuid('dm:dana-okafor');
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('session dm:dana-okafor: --resume ' + sid);
      expect(existsSync(join(t.state, 'claude/projects/-workspace', sid + '.jsonl'))).toBe(true);
      const t2status = JSON.parse(readFileSync(join(t.logs, 'turns/turn-0002.status.json'), 'utf8'));
      expect(t2status).toMatchObject({ session_id: sid, claude_code_version: PIN.version, mcp_servers: { world: 'connected' }, model: MODEL });

      postRequest(t.turns, request(3, { trial_id: trialId, prompt: 'Run this. [cc:bash node -e "setTimeout(() => {}, 7321000)"]', time_budget_s: 8 }));
      await waitFor(() => docker(['top', name, '-eo', 'pid,args']).stdout.includes('7321000'), 30_000, 'the Bash tool child of turn 3');
      expect(await response(t.turns, 3, 60_000)).toMatchObject({ exit: 124, reply_text: null });
      const top = docker(['top', name, '-eo', 'pid,args']).stdout;
      expect(top).not.toContain('7321000');
      expect(top).not.toContain('claude');

      postRequest(t.turns, request(4, { trial_id: trialId, prompt: 'Dana asks: still there?', time_budget_s: 90 }));
      expect(await response(t.turns, 4, 120_000)).toMatchObject({ exit: 0 });

      // A world-MCP tool call that fails at the transport level after a good init: the CLI goes on and exits 0, the turn is 2.
      failToolCall = true;
      const beforeDown = ws.log.events.length;
      postRequest(t.turns, request(5, { trial_id: trialId, prompt: 'Post again. [cc:post ' + channel.id + ' never lands]', time_budget_s: 90 }));
      const r5 = await response(t.turns, 5, 120_000);
      expect(r5).toMatchObject({ exit: 2, reply_text: null, detail: 'MCP transport error: mcp__world__post_message: Error POSTing to endpoint: bad gateway' });
      expect(failToolCall).toBe(false);
      expect(ws.log.events.slice(beforeDown).filter((e) => e.tool === 'chat.postMessage')).toEqual([]);
      expect(JSON.parse(readFileSync(join(t.logs, 'turns/turn-0005.status.json'), 'utf8'))).toMatchObject({ claude_exit: 0, is_error: false, mcp_servers: { world: 'connected' }, mcp_transport_errors: 1 });

      const stopped = docker(['stop', '-t', '20', name]);
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(docker(['inspect', '-f', '{{.State.ExitCode}}', name]).stdout.trim()).toBe('0');
      const diff = docker(['diff', name]).stdout.split('\n').filter((l) => l.trim() && l !== 'A /he-logs' && l !== 'A /he-turns');
      expect(diff).toEqual([]);
      expect(tree(t.workspace)).toEqual(['instruction.md']);
      expect(tree(t.state).some((p) => p.endsWith('.credentials.json'))).toBe(false);

      expect(seen.length).toBeGreaterThan(3);
      for (const s of seen) {
        expect(s.path).toBe('/v1/messages');
        expect(s.apiKey).toBe(UPSTREAM_KEY);
        expect(s.authorization).toBeNull();
        expect(s.model).toBe(MODEL);
        expect(s.maxTokens).toBe(128000);
      }
      const usage = readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { key: string; outcome: string; model: string | null; actual_usd?: number });
      expect(usage.filter((u) => u.outcome !== 'forwarded')).toEqual([]);
      expect(usage.filter((u) => u.key !== trialKey(trialId))).toEqual([]);
      expect(usage).toHaveLength(seen.length);
      for (const u of usage) {
        expect(u.model).toBe(MODEL);
        expect(u.actual_usd).toBeGreaterThan(0);
      }
      expect(readFileSync(usageLog, 'utf8')).not.toContain(UPSTREAM_KEY);
    } finally {
      child?.kill('SIGKILL');
      docker(['rm', '-f', name]);
      ws.stop();
      front.stop(true);
      fake.stop(true);
      proxy.proc.kill('SIGTERM'); await proxy.proc.exited;
    }
  }, 600_000);
});
