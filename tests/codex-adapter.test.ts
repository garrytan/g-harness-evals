// The Codex CLI harness (harnesses/codex), keyless. Two layers:
//   1. process level, always on: adapter.sh runs against a stub "codex" on PATH (a stand-in that prints
//      the JSONL events codex 0.165.0 prints, scripted by markers in the prompt), in temp directories,
//      with a scrubbed environment (nothing but the variables listed here), stdin closed and no TTY:
//      the config it writes, the exit mapping, the thread store and the resume form, the MCP probe,
//      the version check, the refusals and the stops.
//   2. container level, when docker is available: the image built from the checkout runs serve through
//      the real metering proxy in lease mode into tests/fixtures/fake-responses.ts, with an in-process
//      world, the way the runner runs it.
// No model is called and no real key is read: the proxy's upstream key is a placeholder.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TurnRequest, TurnResponse } from '../runner/contracts.ts';
import { trialKey, trialToken } from '../runner/trial/proxy.ts';
import { containerHostAddress } from '../runner/trial/world.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { startFakeResponses, type FakeResponses } from './fixtures/fake-responses.ts';
import { startWorld, world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const HARNESS = join(ROOT, 'harnesses/codex');
const ADAPTER = join(HARNESS, 'adapter.sh');
const PIN = JSON.parse(readFileSync(join(HARNESS, 'pin.json'), 'utf8'));
const MODEL = 'gpt-6-luna';
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

const STUB = String.raw`#!/usr/bin/env bash
# A stand-in for codex 0.165.0: --version, and "exec" / "exec resume <id>" printing the JSONL events the real CLI
# prints (thread.started, turn.started, item.completed, turn.completed or turn.failed), scripted by markers in the prompt.
if [ "$1" = --version ]; then if [ -n "$STUB_CODEX_VERSION" ]; then echo "codex-cli $STUB_CODEX_VERSION"; else echo "codex-cli 0.165.0"; fi; exit 0; fi
printf '%s\n' "$*" >> "$STUB_LOG"
{ if [ -n "$HE_MODEL_API_KEY" ]; then echo key=set; fi; echo "codex_home=$CODEX_HOME"; echo "cwd=$PWD"; } >> "$STUB_LOG.env"
prompt=$(cat)
if [ "$1" = exec ] && [ "$2" = resume ]; then tid=$3; else tid="stub-$RANDOM$RANDOM"; fi
ev() { printf '%s\n' "$1"; }
ev '{"type":"thread.started","thread_id":"'"$tid"'"}'
ev '{"type":"turn.started"}'
case "$prompt" in
  *'[stub:402]'*)
    ev '{"type":"error","message":"Reconnecting... 1/1 (unexpected status 402 Payment Required: metering proxy: lease spent, url: http://proxy/v1/responses)"}'
    ev '{"type":"turn.failed","error":{"message":"unexpected status 402 Payment Required: metering proxy: lease spent, url: http://proxy/v1/responses"}}'
    exit 1 ;;
  *'[stub:400]'*)
    ev '{"type":"turn.failed","error":{"message":"{\"error\":{\"kind\":\"invalid_request\",\"type\":\"invalid_request\",\"message\":\"metering proxy: gpt-x is not on this cell'"'"'s model allowlist\"}}"}}'
    exit 1 ;;
  *'[stub:500]'*)
    ev '{"type":"error","message":"Reconnecting... 1/1 (We’re currently experiencing high demand, which may cause temporary errors.)"}'
    ev '{"type":"turn.failed","error":{"message":"We’re currently experiencing high demand, which may cause temporary errors."}}'
    exit 1 ;;
  *'[stub:429]'*)
    ev '{"type":"turn.failed","error":{"message":"exceeded retry limit, last status: 429 Too Many Requests"}}'
    exit 1 ;;
  *'[stub:conn]'*)
    ev '{"type":"error","message":"Reconnecting... 1/1 (Connection failed: error sending request)"}'
    ev '{"type":"turn.failed","error":{"message":"Connection failed: error sending request"}}'
    exit 1 ;;
  *'[stub:reconnect]'*)
    ev '{"type":"error","message":"Reconnecting... 1/1 (unexpected status 503 Service Unavailable: busy, url: http://proxy/v1/responses)"}' ;;
  *'[stub:mcp]'*)
    ev '{"type":"item.completed","item":{"id":"item_0","type":"mcp_tool_call","server":"world","tool":"whoami","arguments":{},"result":null,"error":{"message":"tool call error: tool call failed for world/whoami\n\nCaused by:\n    Transport send error: Transport [rmcp::transport::worker::WorkerTransport] error: unexpected server response: HTTP 502"},"status":"failed"}}' ;;
  *'[stub:crash]'*)
    echo "thread 'main' panicked" >&2
    exit 101 ;;
  *'[stub:sleep]'*)
    setsid sleep 3017 &
    sleep 3029 &
    wait
    exit 0 ;;
esac
ev '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"stub reply in thread '"$tid"'"}}'
ev '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}'
`;

interface Trial { dir: string; bin: string; workspace: string; state: string; logs: string; turns: string; stubLog: string }

function trial(instruction = ''): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-codex-'));
  const t = { dir, bin: join(dir, 'bin'), workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), stubLog: join(dir, 'bin', 'stub.log') };
  for (const d of [t.bin, t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.bin, 'codex'), STUB);
  chmodSync(join(t.bin, 'codex'), 0o755);
  writeFileSync(join(t.workspace, 'instruction.md'), instruction);
  return t;
}

/** Everything under a directory, relative, sorted. */
function tree(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    out.push(rel);
    if (statSync(join(dir, name)).isDirectory()) out.push(...tree(join(dir, name), rel));
  }
  return out;
}

/** The scrubbed environment: the adapter protocol's variables and a PATH with the stub first, nothing inherited. */
const ENV = (t: Trial, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: `${t.bin}:/usr/local/bin:/usr/bin:/bin`,
  HE_WORKSPACE_DIR: t.workspace,
  HE_SESSION_STATE_DIR: t.state,
  HE_LOG_DIR: t.logs,
  HE_TURNS_DIR: t.turns,
  HE_MODEL_BASE_URL: 'http://127.0.0.1:1/codex-slot/openai/',
  HE_MODEL_API_KEY: trialToken('codex-slot'),
  HE_MODEL_NAME: MODEL,
  HE_TIME_BUDGET_S: '10',
  HE_TASK_SLICE: 'multiuser',
  HE_TRIAL_ID: 'codex-test',
  STUB_LOG: t.stubLog,
  ...extra,
});

function run(t: Trial, extra: Record<string, string> = {}) {
  return spawnSync('bash', [ADAPTER, 'run'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: ENV(t, extra), timeout: 60_000 });
}

const stubCalls = (t: Trial) => (existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const survivors = () => spawnSync('pgrep', ['-f', '^sleep 30(17|29)$'], { encoding: 'utf8' }).stdout.trim();

function request(turn: number, over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    turn,
    trial_id: 'codex-test',
    prompt: 'You are the workspace bot. Dana Okafor asks: hello?',
    actor: { member: 'dana-okafor', slack_user_id: 'U0DANA', name: 'Dana Okafor', role: 'Account Manager', team: 'team-north' },
    channel: { id: 'D0DANA', name: 'dana-okafor', type: 'dm' },
    text: 'hello?',
    ts: '1791986400.000001',
    thread_ts: null,
    sim_now: '2026-10-14T09:00:00-05:00',
    time_budget_s: 10,
    ...over,
  };
}

function postRequest(t: Trial, req: TurnRequest) {
  const name = `turn-${String(req.turn).padStart(4, '0')}`;
  writeFileSync(join(t.turns, `${name}.request.json.tmp`), JSON.stringify(req));
  renameSync(join(t.turns, `${name}.request.json.tmp`), join(t.turns, `${name}.request.json`));
}

async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

async function response(t: Trial, turn: number, ms = 20_000): Promise<TurnResponse> {
  const path = join(t.turns, `turn-${String(turn).padStart(4, '0')}.response.json`);
  await waitFor(() => existsSync(path), ms, `response for turn ${turn}`);
  return JSON.parse(readFileSync(path, 'utf8')) as TurnResponse;
}

function exited(child: ChildProcess, ms: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return Promise.race([
    new Promise<number | null>((res) => child.once('exit', (code) => res(code))),
    Bun.sleep(ms).then(() => { child.kill('SIGKILL'); throw new Error(`the adapter did not exit within ${ms} ms`); }),
  ]);
}

async function stop(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  child.kill('SIGTERM');
  return exited(child, 5_000);
}

describe('codex adapter, process level (stub codex)', () => {
  test('run writes config.toml from pin.json for the cell model and the proxy, then runs one new-thread turn', () => {
    const t = trial('Say hello.');
    const r = run(t);
    expect(r.status, r.stderr).toBe(0);
    expect(stubCalls(t)).toEqual([`exec --json --skip-git-repo-check --strict-config -C ${t.workspace} -`]);
    expect(readFileSync(t.stubLog + '.env', 'utf8')).toBe(`key=set\ncodex_home=${t.state}/codex\ncwd=${t.workspace}\n`);
    expect(readFileSync(join(t.logs, 'run.reply.txt'), 'utf8')).toStartWith('stub reply in thread stub-');
    const config = readFileSync(join(t.state, 'codex/config.toml'), 'utf8');
    for (const key of ['model', 'review_model', 'experimental_realtime_ws_model', 'default_subagent_model', 'extract_model', 'consolidation_model']) {
      expect(config).toContain(`\n${key} = "${MODEL}"\n`);
    }
    expect(config).toContain('\nmodel_provider = "he-proxy"\n');
    expect(config).toContain('\nbase_url = "http://127.0.0.1:1/codex-slot/openai/v1"\n');
    expect(config).toContain('\nenv_key = "HE_MODEL_API_KEY"\n');
    expect(config).toContain('\nwire_api = "responses"\n');
    expect(config).toContain(`\nmodel_reasoning_effort = "${PIN.codex_config.model_reasoning_effort}"\n`);
    expect(config).toContain(`\nrequest_max_retries = ${PIN.codex_config.request_max_retries}\nstream_max_retries = ${PIN.codex_config.stream_max_retries}\n`);
    for (const line of ['approval_policy = "never"', 'sandbox_mode = "danger-full-access"', 'web_search = "disabled"', 'check_for_update_on_startup = false', 'plugins = false', 'unbounded_connection_retries = false', 'remote_compaction = "unsupported"']) {
      expect(config).toContain(`\n${line}\n`);
    }
    expect(config).not.toMatch(/@[A-Z_]+@/);
    expect(config).not.toContain('\n[mcp_servers.');
    expect(config).not.toContain('trial-token:');
    expect(tree(t.workspace)).toEqual(['instruction.md']);
    expect(tree(t.state).filter((p) => /auth\.json|credentials/.test(p))).toEqual([]);
    expect(readdirSync(t.dir).sort()).toEqual(['bin', 'logs', 'state', 'turns', 'workspace']);
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('codex-cli 0.165.0 (pin.json 0.165.0)');
  });

  test.each([
    ['[stub:402]', 3, 'model error (HTTP 402)'],
    ['[stub:400]', 3, 'model error (HTTP 400)'],
    ['[stub:500]', 3, 'model error (HTTP 500)'],
    ['[stub:429]', 3, 'model error (HTTP 429)'],
    ['[stub:reconnect]', 0, ''],
    ['[stub:conn]', 3, 'model error (the model endpoint is unreachable: Connection failed'],
    ['[stub:mcp]', 2, 'MCP transport error'],
    ['[stub:crash]', 2, 'harness error (codex exit 101)'],
  ])('run maps %s to exit %d', (marker, code, detail) => {
    const t = trial(`hello ${marker}`);
    const r = run(t);
    expect(r.status, r.stderr).toBe(code);
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain(`exit ${code}${detail ? ' (' + detail : ''}`);
  });

  test('a turn past its budget is 124, and the process group and the processes in their own session are gone', () => {
    const t = trial('hello [stub:sleep]');
    const started = Date.now();
    const r = run(t, { HE_TIME_BUDGET_S: '2' });
    expect(r.status, r.stderr).toBe(124);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(survivors()).toBe('');
  });

  test('a codex-cli version other than pin.json is exit 2 before any turn', () => {
    const t = trial('hello');
    const r = run(t, { STUB_CODEX_VERSION: '0.164.0' });
    expect(r.status).toBe(2);
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('codex-cli 0.164.0 is not the pinned 0.165.0');
    expect(stubCalls(t)).toEqual([]);
  });

  test('HE_SESSION_SCOPE=turn and HE_GBRAIN_INSTALL are refused with exit 2', () => {
    let t = trial();
    let r = spawnSync('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: ENV(t, { HE_SESSION_SCOPE: 'turn' }) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE_SESSION_SCOPE=turn is not supported');
    t = trial();
    r = spawnSync('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: ENV(t, { HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev' }) });
    expect(r.status).toBe(2);
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('HE-ADAPTER-006 the install bundle could not be applied: the codex adapter has no documented install for HE_GBRAIN_INSTALL=gbrain-docs');
    expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8'))).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'codex', install: 'gbrain-docs' });
    expect(existsSync(join(t.logs, 'ready'))).toBe(false);
    expect(stubCalls(t)).toEqual([]);
  });

  test('HE_MODEL_BASE_URL that does not end in /openai is exit 2 before any turn, with the reason in adapter.log', () => {
    for (const base of ['http://127.0.0.1:1/codex-slot/anthropic', 'http://127.0.0.1:1/codex-slot/openai/v1', 'http://127.0.0.1:1/codex-slot']) {
      const t = trial('hello');
      const r = run(t, { HE_MODEL_BASE_URL: base });
      expect(r.status, base).toBe(2);
      expect(stubCalls(t)).toEqual([]);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain(`HE_MODEL_BASE_URL ${base} does not end in /openai: codex runs only on an openai cell`);
      expect(existsSync(join(t.state, 'codex', 'config.toml'))).toBe(false);
    }
    expect(run(trial('hello'), { HE_MODEL_BASE_URL: 'http://127.0.0.1:1/codex-slot/openai' }).status).toBe(0);
  });

  test('an unknown entry point is exit 2', () => {
    expect(spawnSync('bash', [ADAPTER, 'chat'], { stdio: ['ignore', 'pipe', 'pipe'], env: ENV(trial()) }).status).toBe(2);
  });
});

describe('codex adapter, serve, process level (stub codex)', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('codex-serve'); });
  afterAll(() => { ws.stop(); });

  const worldEnv = () => ({ HE_WORLD_MCP_URL: `${ws.url}/mcp`, HE_WORLD_MCP_TOKEN: ws.credentials.bot.token });
  const startServe = (t: Trial, extra: Record<string, string> = {}) => spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: ENV(t, { ...worldEnv(), ...extra }) });

  test('probes world-MCP, writes ready, keeps one thread per session key and resumes it, and stops on SIGTERM', async () => {
    const t = trial();
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 10_000, 'ready file');
      const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'));
      expect(ready).toMatchObject({ harness: 'codex', version: '0.165.0', trial: 'codex-test', mcp_servers: ['world'], adapter_sha256: sha256(readFileSync(ADAPTER)) });
      expect(JSON.parse(readFileSync(join(t.logs, 'mcp-probe.world.json'), 'utf8'))).toContain('post_message');
      const config = readFileSync(join(t.state, 'codex/config.toml'), 'utf8');
      expect(config).toContain(`\n[mcp_servers.world]\nurl = "${ws.url}/mcp"\nbearer_token_env_var = "HE_WORLD_MCP_TOKEN"\n`);
      expect(config).not.toContain(ws.credentials.bot.token);
      expect(config).not.toContain('\n[mcp_servers.gbrain]');

      postRequest(t, request(1));
      const r1 = await response(t, 1);
      expect(r1).toMatchObject({ turn: 1, exit: 0 });
      const thread = r1.reply_text!.replace('stub reply in thread ', '');
      postRequest(t, request(2));
      expect((await response(t, 2)).reply_text).toBe(`stub reply in thread ${thread}`);
      postRequest(t, request(3, { channel: { id: 'C0NORTH', name: 'north-team', type: 'channel' } }));
      const r3 = await response(t, 3);
      expect(r3.reply_text).not.toContain(thread);
      postRequest(t, request(4, { ts: '1700000400.000100', thread_ts: '1700000400.000100' }));
      expect((await response(t, 4)).reply_text).not.toContain(thread);

      const calls = stubCalls(t);
      expect(calls[0]).toBe(`exec --json --skip-git-repo-check --strict-config -C ${t.workspace} -`);
      expect(calls[1]).toBe(`exec resume ${thread} --json --skip-git-repo-check --strict-config -`);
      expect(calls[2]).toStartWith('exec --json');
      expect(calls[3]).toStartWith('exec --json');
      const threads = JSON.parse(readFileSync(join(t.state, 'codex-threads.json'), 'utf8'));
      expect(Object.keys(threads).sort()).toEqual(['channel:C0NORTH', 'dm:dana-okafor', 'dm:dana-okafor:t1700000400.000100']);
      expect(threads['dm:dana-okafor']).toBe(thread);
      expect(readFileSync(join(t.turns, 'turn-0001.request.json'), 'utf8')).toContain('hello?');
      expect(readFileSync(join(t.logs, 'turns/turn-0001.prompt.md'), 'utf8')).toBe(request(1).prompt);
      expect(tree(t.turns).some((p) => p.endsWith('.tmp'))).toBe(false);
      expect(tree(t.workspace)).toEqual(['instruction.md']);
      expect(readdirSync(t.dir).sort()).toEqual(['bin', 'logs', 'state', 'turns', 'workspace']);
    } finally {
      expect(await stop(child)).toBe(0);
    }
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('stopped on signal');
  }, 60_000);

  test('maps each turn (402, MCP transport error, budget) and keeps serving; a timed-out turn leaves no process behind', async () => {
    const t = trial();
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 10_000, 'ready file');
      postRequest(t, request(1, { prompt: 'hello [stub:402]' }));
      expect(await response(t, 1)).toMatchObject({ exit: 3, reply_text: null, detail: 'model error (HTTP 402)' });
      postRequest(t, request(2, { prompt: 'hello [stub:mcp]' }));
      expect(await response(t, 2)).toMatchObject({ exit: 2, reply_text: null, detail: 'MCP transport error' });
      postRequest(t, request(3, { prompt: 'hello [stub:sleep]', time_budget_s: 2 }));
      const r3 = await response(t, 3);
      expect(r3).toMatchObject({ exit: 124, reply_text: null, detail: 'wall clock exceeded (2s)' });
      expect(Date.parse(r3.ended_at) - Date.parse(r3.started_at)).toBeLessThan(9_000);
      expect(survivors()).toBe('');
      postRequest(t, request(4));
      expect(await response(t, 4)).toMatchObject({ exit: 0 });
      expect(stubCalls(t)[3]).toStartWith('exec resume stub-');
      expect(readFileSync(join(t.logs, 'stderr.log'), 'utf8')).not.toContain('/environ');
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 60_000);

  test('SIGTERM during a turn answers it as exit 2 and exits 0 with nothing left running', async () => {
    const t = trial();
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 10_000, 'ready file');
      postRequest(t, request(1, { prompt: 'hello [stub:sleep]', time_budget_s: 60 }));
      await waitFor(() => survivors().split('\n').filter(Boolean).length === 2, 10_000, 'the turn to start');
      expect(await stop(child)).toBe(0);
      expect(await response(t, 1, 1_000)).toMatchObject({ exit: 2, reply_text: null, detail: 'stopped by SIGTERM during the turn' });
      expect(survivors()).toBe('');
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);

  test('a world-MCP server that does not answer tools/list is exit 2 before ready', async () => {
    for (const extra of [{ HE_WORLD_MCP_URL: 'http://127.0.0.1:1/mcp' }, { HE_WORLD_MCP_TOKEN: 'not-the-bot-token' }] as Array<Record<string, string>>) {
      const t = trial();
      const child = startServe(t, extra);
      expect(await exited(child, 40_000)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toMatch(/MCP world: tools\/list (failed|returned no tools)/);
      expect(stubCalls(t)).toEqual([]);
    }
  }, 90_000);

  test('serve without the world variables is exit 2', async () => {
    const t = trial();
    const child = spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: ENV(t) });
    expect(await exited(child, 20_000)).toBe(2);
  }, 30_000);

  test('with HE_GBRAIN_MCP_URL set, [mcp_servers.gbrain] goes in beside world and is probed too', async () => {
    const t = trial();
    // The world's own MCP endpoint stands in for the gbrain tap here: it answers tools/list as the bot.
    const child = startServe(t, { HE_GBRAIN_MCP_URL: `${ws.url}/mcp`, HE_GBRAIN_MCP_TOKEN: ws.credentials.bot.token });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 10_000, 'ready file');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')).mcp_servers).toEqual(['world', 'gbrain']);
      expect(readFileSync(join(t.state, 'codex/config.toml'), 'utf8')).toContain(`\n[mcp_servers.gbrain]\nurl = "${ws.url}/mcp"\nbearer_token_env_var = "HE_GBRAIN_MCP_TOKEN"\n`);
      expect(existsSync(join(t.logs, 'mcp-probe.gbrain.json'))).toBe(true);
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 30_000);
});

const haveDocker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const IMAGE = 'harness-eval/codex:dev';
const PLACEHOLDER_KEY = 'placeholder-openai';

describe.skipIf(!haveDocker)('codex image, container level, through the metering proxy into a fake Responses endpoint', () => {
  let tmp: string;
  let fake: FakeResponses;
  let ws: WorldServer;
  let proxy: { proc: ReturnType<typeof Bun.spawn>; port: number };
  let gateway: string;
  const control = 'control-' + process.pid;
  const slot = 'codex-cx';
  const token = trialToken(slot);

  beforeAll(async () => {
    const build = spawnSync('docker', ['build', '-q', '-t', IMAGE, HARNESS], { encoding: 'utf8', timeout: 1_200_000 });
    expect(build.status, build.stderr).toBe(0);
    tmp = mkdtempSync(join(tmpdir(), 'he-codex-cx-'));
    gateway = containerHostAddress();
    fake = startFakeResponses({ log: join(tmp, 'fake.ndjson') });
    ws = createWorldServer({ world, split: 'dev', trialId: 'codex-cx', eventsPath: null, hostname: gateway, port: 0 });
    let stderr = '';
    for (let attempt = 0; attempt < 3 && !proxy; attempt++) {
      const probe = Bun.serve({ port: 0, hostname: gateway, fetch: () => new Response() });
      const port = probe.port as number;
      probe.stop(true);
      const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', `${gateway}:${port}`, '--budget-ledger', join(tmp, 'ledger.sqlite'),
        '--lease-usd', '5', '--run-id', 'codex-cx', '--new-run', '--max-output-tokens', '128000', '--allow-models', 'openai:' + MODEL,
        '--upstream', `openai=http://127.0.0.1:${fake.port}`, '--usage-log', join(tmp, 'usage.ndjson'), '--control-token', control],
        { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, OPENAI_API_KEY: PLACEHOLDER_KEY }, stdout: 'pipe', stderr: 'pipe' });
      for (let i = 0; i < 100 && !proxy; i++) {
        if (proc.exitCode !== null) break;
        try { await fetch(`http://${gateway}:${port}/__proxy/status`); proxy = { proc, port }; } catch { await Bun.sleep(50); }
      }
      if (!proxy) { proc.kill('SIGKILL'); await proc.exited; stderr = await new Response(proc.stderr).text(); }
    }
    if (!proxy) throw new Error('the metering proxy did not start: ' + stderr);
    const bound = await fetch(`http://${gateway}:${proxy.port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot, key: trialKey(slot), token }) });
    expect(bound.status).toBe(200);
  }, 1_300_000);

  afterAll(async () => {
    proxy?.proc.kill('SIGTERM');
    await proxy?.proc.exited;
    fake?.stop();
    ws?.stop();
  });

  test('the image pins codex-cli and the vendored binary pin.json records', () => {
    const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'bash', IMAGE, '-c', `codex --version && sha256sum ${PIN.binary.path}`], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('codex-cli ' + PIN.version);
    expect(r.stdout).toContain(PIN.binary.sha256);
  }, 60_000);

  test('serve: a shell command, a kept thread, a world-MCP call, model errors, a killed turn and a clean stop, every call metered on the cell model', async () => {
    const t = trial();
    const name = `he-codex-cx-${process.pid}`;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const child = spawn('docker', [
      'run', '-i', '--name', name, '--user', `${process.getuid!()}:${process.getgid!()}`, '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
      '-v', `${t.workspace}:/workspace`, '-v', `${t.state}:/harness-state`, '-v', `${t.logs}:/he-logs`, '-v', `${t.turns}:/he-turns`,
      '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TURNS_DIR=/he-turns', '-e', 'HE_TIME_BUDGET_S=60',
      '-e', `HE_MODEL_BASE_URL=http://host.docker.internal:${proxy.port}/${slot}/openai`, '-e', `HE_MODEL_API_KEY=${token}`, '-e', `HE_MODEL_NAME=${MODEL}`,
      '-e', 'HE_TASK_SLICE=multiuser', '-e', 'HE_TRIAL_ID=codex-cx',
      '-e', `HE_WORLD_MCP_URL=http://host.docker.internal:${new URL(ws.url).port}/mcp`, '-e', `HE_WORLD_MCP_TOKEN=${ws.credentials.bot.token}`,
      IMAGE, 'serve',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 60_000, 'ready file');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'))).toMatchObject({ harness: 'codex', version: PIN.version, mcp_servers: ['world'], adapter_sha256: sha256(readFileSync(ADAPTER)) });
      expect(spawnSync('docker', ['inspect', '-f', '{{.Config.Tty}}', name], { encoding: 'utf8' }).stdout.trim()).toBe('false');

      fake.setScript([{ tool: 'printf hi > /workspace/x' }, { text: 'wrote x' }]);
      postRequest(t, request(1, { time_budget_s: 60 }));
      expect(await response(t, 1, 90_000)).toMatchObject({ exit: 0, reply_text: 'wrote x' });
      expect(readFileSync(join(t.workspace, 'x'), 'utf8')).toBe('hi');

      fake.setScript([{ text: 'second reply' }]);
      postRequest(t, request(2, { time_budget_s: 60 }));
      expect(await response(t, 2, 90_000)).toMatchObject({ exit: 0, reply_text: 'second reply' });
      const threadOf = (n: number) => readFileSync(join(t.logs, `turns/turn-${String(n).padStart(4, '0')}.codex.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'thread.started')?.thread_id;
      expect(threadOf(2)).toBe(threadOf(1));
      expect(JSON.parse(readFileSync(join(t.state, 'codex-threads.json'), 'utf8'))).toEqual({ 'dm:dana-okafor': threadOf(1) });

      const channel = ws.service.channelsFor(ws.service.bot!, 'mcp').find((c) => c.kind !== 'dm')!;
      const before = ws.log.events.length;
      fake.setScript([{ call: 'mcp__world__post_message', arguments: { channel: channel.id, text: 'codex bot post' } }, { text: 'posted' }]);
      postRequest(t, request(3, { channel: { id: channel.id, name: channel.name, type: 'channel' }, time_budget_s: 60 }));
      expect(await response(t, 3, 90_000)).toMatchObject({ exit: 0, reply_text: 'posted' });
      const posted = ws.log.events.slice(before).find((e) => e.tool === 'chat.postMessage');
      expect(posted).toMatchObject({ actor: 'assistant', via: 'mcp', kind: 'write', outcome: 'ok' });
      expect((posted!.args as { text: string }).text).toBe('codex bot post');

      fake.setScript([{ status: 402 }], true);
      postRequest(t, request(4, { time_budget_s: 60 }));
      expect(await response(t, 4, 90_000)).toMatchObject({ exit: 3, reply_text: null, detail: 'model error (HTTP 402)' });
      fake.setScript([{ status: 400 }], true);
      postRequest(t, request(5, { time_budget_s: 60 }));
      expect(await response(t, 5, 90_000)).toMatchObject({ exit: 3, reply_text: null, detail: 'model error (HTTP 400)' });
      fake.setScript([{ status: 500 }], true);
      postRequest(t, request(6, { time_budget_s: 60 }));
      expect(await response(t, 6, 90_000)).toMatchObject({ exit: 3, reply_text: null, detail: 'model error (HTTP 500)' });

      fake.setScript([{ tool: 'sleep 3031' }], true);
      postRequest(t, request(7, { time_budget_s: 8 }));
      const r7 = await response(t, 7, 60_000);
      expect(r7).toMatchObject({ exit: 124, reply_text: null });
      expect(Date.parse(r7.ended_at) - Date.parse(r7.started_at)).toBeLessThan(20_000);
      const ps = spawnSync('docker', ['exec', name, 'ps', '-eo', 'args'], { encoding: 'utf8' }).stdout;
      expect(ps).not.toContain('sleep 3031');
      expect(ps).not.toMatch(/codex/);

      fake.setScript([{ text: 'after the killed turn' }]);
      postRequest(t, request(8, { time_budget_s: 60 }));
      expect(await response(t, 8, 90_000)).toMatchObject({ exit: 0, reply_text: 'after the killed turn' });

      const stopped = spawnSync('docker', ['stop', '-t', '20', name], { encoding: 'utf8' });
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', name], { encoding: 'utf8' }).stdout.trim()).toBe('0');
      const diff = spawnSync('docker', ['diff', name], { encoding: 'utf8' });
      expect(diff.stdout.split('\n').filter((l) => l.trim() && l !== 'A /he-logs' && l !== 'A /he-turns')).toEqual([]);
      expect(tree(t.state).filter((p) => /auth\.json|credentials/.test(p))).toEqual([]);
      expect(tree(t.workspace)).toEqual(['instruction.md', 'x']);

      // The fake saw only the proxy: POST /v1/responses, the placeholder upstream key, the cell model, the proxy's output cap.
      expect(fake.requests.length).toBeGreaterThan(8);
      for (const r of fake.requests) {
        expect(r).toMatchObject({ method: 'POST', path: '/v1/responses', model: MODEL, stream: true, max_output_tokens: 128000, authorization_sha256: sha256('Bearer ' + PLACEHOLDER_KEY) });
        expect((r.reasoning as { effort?: string }).effort).toBe(PIN.codex_config.model_reasoning_effort);
      }
      // The proxy forwarded every call on the trial's slot and token, on the cell model, priced; none was refused.
      const usage = readFileSync(join(tmp, 'usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      expect(usage.filter((u) => u.outcome !== 'forwarded')).toEqual([]);
      expect(usage.length).toBe(fake.requests.length);
      for (const u of usage) expect(u).toMatchObject({ key: trialKey(slot), provider: 'openai', route: '/v1/responses', model: MODEL });
      const ok = usage.filter((u) => u.status === 200);
      expect(ok.length).toBeGreaterThan(5);
      for (const u of ok) expect(u).toMatchObject({ charged_reservation: false, streamed: true, input_tokens: 1200, output_tokens: 40, cached_tokens: 200 });
      for (const u of usage.filter((x) => x.status === 402 || x.status === 400)) expect(u.actual_usd).toBe(0);
      const status = await (await fetch(`http://${gateway}:${proxy.port}/__proxy/status`)).json() as { committed_usd: number; refused: number; max_output_tokens: number };
      expect(status).toMatchObject({ refused: 0, max_output_tokens: 128000 });
      expect(status.committed_usd).toBeGreaterThan(0);
    } finally {
      child.kill('SIGKILL');
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    }
  }, 600_000);
});
