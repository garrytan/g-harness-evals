// The DeepSeek Harness (dsh) harness (harnesses/dsh), keyless. Two layers:
//   1. process level, always on: adapter.sh runs against a stub "dsh" on PATH (a stand-in that prints the --json events
//      dsh 0.2.2-rc.1 prints, scripted by markers in the prompt), in temp directories, with a scrubbed environment, stdin
//      closed and no TTY: the profile it renders for each of the four routes, the refusals, the exit mapping, the session
//      store and its resume form, the MCP rows and probe.
//   2. container level, when docker is available: the image built from the checkout runs the real dsh against
//      tests/fixtures/dsh/fake-upstream.ts and an in-process world: a three-turn multi-user serve trial on the OpenRouter
//      route (the DeepSeek route), one run turn on each of the Anthropic and OpenAI routes, and one on the Particle route
//      through the real metering proxy in lease mode.
// No model is called and no real key is read: every key here is a placeholder or a canary string.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { trialKey, trialToken } from '../runner/trial/proxy.ts';
import { containerHostAddress } from '../runner/trial/world.ts';
import { WORLD_MCP_TOOLS } from '../world/world-mcp/tools.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { startFakeUpstream, type FakeUpstream } from './fixtures/dsh/fake-upstream.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const HARNESS = join(ROOT, 'harnesses/dsh');
const ADAPTER = join(HARNESS, 'adapter.sh');
const PIN = JSON.parse(readFileSync(join(HARNESS, 'pin.json'), 'utf8'));
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
type Json = Record<string, any>;

/** The four routes and the cell model each one runs (pin.json model_*). */
const ROUTES = {
  anthropic: { model: 'claude-opus-5-5', provider: 'he-anthropic', api: 'anthropic-messages', v1: false, compat: { forceAdaptiveThinking: true } },
  openai: { model: 'gpt-6.1-sol', provider: 'he-openai', api: 'openai-responses', v1: true, compat: undefined },
  particle: { model: 'particle-1', provider: 'he-particle', api: 'openai-completions', v1: true, compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: true, maxTokensField: 'max_completion_tokens' } },
  openrouter: { model: 'deepseek/deepseek-v4.1-flash-1017', provider: 'he-openrouter', api: 'openai-completions', v1: true, compat: { thinkingFormat: 'openrouter', supportsDeveloperRole: false, supportsStore: false } },
} as const;
type Route = keyof typeof ROUTES;

const STUB = String.raw`#!/usr/bin/env bash
# A stand-in for dsh 0.2.2-rc.1: --version, --dump-config, and the headless profile printing the --json events the real CLI
# prints (session, status, tool_call, tool_result, final), scripted by markers in the prompt.
if [ "$1" = --version ]; then if [ -n "$STUB_DSH_VERSION" ]; then echo "$STUB_DSH_VERSION"; else echo 0.2.2-rc.1; fi; exit 0; fi
if [ "$3" = --dump-config ]; then [ -z "$STUB_DUMP_FAIL" ] || { echo "dsh: bad patch" >&2; exit 1; }; echo "# composed"; exit 0; fi
printf '%s\n' "$*" >> "$STUB_LOG"
{ if [ -n "$HE_MODEL_API_KEY" ]; then echo key=set; fi; echo "home=$HOME dsh_home=$DSH_HOME cwd=$PWD telemetry=$DSH_TELEMETRY_MODE"; } >> "$STUB_LOG.env"
prompt=$(cat)
sid=''
while [ $# -gt 0 ]; do [ "$1" = --session-id ] && sid=$2; shift; done
[ -n "$sid" ] || sid="session-stub-$RANDOM$RANDOM"
ev() { printf '%s\n' "$1"; }
ev '{"type":"session","sessionId":"'"$sid"'","cwd":"'"$PWD"'"}'
ev '{"type":"status","phase":"turn_start","turn":1}'
fail() { ev '{"type":"final","sessionId":"'"$sid"'","reason":{"kind":"error","error":{"message":'"$1"',"code":"'"$2"'"}},"text":""}'; echo "dsh: $2" >&2; exit 1; }
case "$prompt" in
  *'[stub:400]'*) fail '"400: {\"error\":{\"message\":\"bad\"}}"' INVALID_REQUEST ;;
  *'[stub:402]'*) fail '"402: {\"error\":{\"message\":\"metering proxy: lease spent\"}}"' INVALID_REQUEST ;;
  *'[stub:transport]'*) fail '"Connection error."' TRANSPORT ;;
  *'[stub:unknown]'*) fail '"model x is not configured"' UNKNOWN_MODEL ;;
  *'[stub:outside]'*) ev '{"type":"error","message":"no stored session","code":"SESSION_NOT_FOUND"}'; exit 1 ;;
  *'[stub:sleep]'*) setsid sleep 3017 & sleep 3029 & wait; exit 0 ;;
esac
ev '{"type":"tool_call","callId":"c1","tool":"mcp__world__whoami","input":{}}'
ev '{"type":"tool_result","callId":"c1","status":"completed","result":"ok"}'
ev '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":1,"outputTokens":1,"totalTokens":2}}'
ev '{"type":"final","sessionId":"'"$sid"'","reason":{"kind":"completed"},"text":"stub reply in '"$sid"'"}'
`;

interface Trial { dir: string; bin: string; workspace: string; state: string; logs: string; turns: string; stubLog: string }
function trial(instruction = 'Say hello.'): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-dsh-'));
  const t = { dir, bin: join(dir, 'bin'), workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), stubLog: join(dir, 'bin', 'stub.log') };
  for (const d of [t.bin, t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.bin, 'dsh'), STUB);
  chmodSync(join(t.bin, 'dsh'), 0o755);
  writeFileSync(join(t.workspace, 'instruction.md'), instruction);
  return t;
}

/** Everything under a directory, relative, sorted. */
function tree(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? prefix + '/' + name : name;
    out.push(rel);
    if (statSync(join(dir, name)).isDirectory()) out.push(...tree(join(dir, name), rel));
  }
  return out;
}
/** The text of every file under a directory. */
const allText = (dir: string) => tree(dir).filter((p) => statSync(join(dir, p)).isFile()).map((p) => readFileSync(join(dir, p), 'latin1')).join('\n');

const TOKEN = trialToken('dsh-slot');
/** The scrubbed environment: the adapter protocol's variables and a PATH with the stub first, nothing inherited. */
const ENV = (t: Trial, route: Route = 'openrouter', extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: t.bin + ':/usr/local/bin:/usr/bin:/bin',
  HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns,
  HE_MODEL_BASE_URL: 'http://127.0.0.1:1/dsh-slot/' + route, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: ROUTES[route].model,
  HE_TIME_BUDGET_S: '10', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: 'dsh-test', STUB_LOG: t.stubLog, ...extra,
});
const run = (t: Trial, route: Route = 'openrouter', extra: Record<string, string> = {}) =>
  spawnSync('bash', [ADAPTER, 'run'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: ENV(t, route, extra), timeout: 60_000 });
const patchOf = (t: Trial) => readFileSync(join(t.state, '.dsh/profiles/headless/cordis.patch.yml'), 'utf8');
const rows = (t: Trial) => Bun.YAML.parse(patchOf(t)) as Json[];
const row = (t: Trial, id: string) => rows(t).find((r) => r.id === id);

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const until = Date.now() + ms;
  while (!cond()) { if (Date.now() > until) throw new Error('timed out waiting for ' + what); await Bun.sleep(50); }
}
function request(n: number, o: Json = {}): Json {
  return { turn: n, trial_id: 'dsh-test', prompt: o.prompt ?? 'hello', actor: { member: o.member ?? 'dana-okafor', slack_user_id: 'U1', name: 'Dana', role: 'pm', team: null },
    channel: o.channel ?? { id: 'D1', name: 'dm', type: 'dm' }, text: o.prompt ?? 'hello', ts: '1.' + n, thread_ts: o.thread_ts ?? null, sim_now: '2026-11-03T10:00:00-08:00', time_budget_s: o.time_budget_s ?? 10 };
}
function post(t: Trial, req: Json) {
  const name = 'turn-' + String(req.turn).padStart(4, '0');
  writeFileSync(join(t.turns, name + '.request.json.tmp'), JSON.stringify(req));
  renameSync(join(t.turns, name + '.request.json.tmp'), join(t.turns, name + '.request.json'));
}
async function response(t: Trial, n: number, ms = 30_000): Promise<Json> {
  const p = join(t.turns, 'turn-' + String(n).padStart(4, '0') + '.response.json');
  await waitFor(() => existsSync(p), ms, 'turn ' + n + ' response');
  return JSON.parse(readFileSync(p, 'utf8'));
}

describe('dsh adapter, process level (stub dsh)', () => {
  for (const route of Object.keys(ROUTES) as Route[]) {
    test('run renders the ' + route + ' route: a custom provider on the proxy with the per-trial token by name, the cell model, effort high, a 128000 cap', () => {
      const t = trial();
      const r = run(t, route);
      expect(r.status, r.stderr).toBe(0);
      const want = ROUTES[route];
      expect(row(t, 'agent-default-model')).toEqual({ id: 'agent-default-model', config: { provider: want.provider, model: want.model } });
      const providers = row(t, 'llm-pi-ai')!.config.providers;
      expect(Object.keys(providers)).toEqual([want.provider]);
      const p = providers[want.provider];
      expect(p).toMatchObject({ apiKeyEnv: 'HE_MODEL_API_KEY', api: want.api, baseURL: 'http://127.0.0.1:1/dsh-slot/' + route + (want.v1 ? '/v1' : ''), reasoning: 'high',
        models: [{ id: want.model, maxTokens: 128000, reasoningEfforts: { high: 'high' } }] });
      expect(p.compat).toEqual(want.compat);
      // The shipped DeepSeek routes, web search and fetch, the instruction loader and telemetry are off on every route.
      for (const id of ['llm-deepseek', 'llm-deepseek-account', 'plugin-package-inventory-deepseek', 'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web', 'agent-instructions'])
        expect(row(t, id)).toEqual({ id, disabled: true });
      expect(row(t, 'session-telemetry-otel')).toEqual({ id: 'session-telemetry-otel', config: { mode: 'DISABLED' } });
      expect(rows(t).some((x) => x.insert)).toBe(false);
      // No credential in any file the adapter wrote, and the headless invocation is the pinned one.
      expect(allText(t.state) + allText(t.logs)).not.toContain(TOKEN.split('.')[1]!);
      expect(readFileSync(t.stubLog, 'utf8').trim()).toBe('--profile headless --json --permission-mode workspace-write --approval-policy never -');
      expect(readFileSync(t.stubLog + '.env', 'utf8')).toBe('key=set\nhome=' + t.state + ' dsh_home=' + t.state + '/.dsh cwd=' + t.workspace + ' telemetry=DISABLED\n');
      expect(readFileSync(join(t.logs, 'run.reply.txt'), 'utf8')).toMatch(/^stub reply in session-stub-/);
      expect(readFileSync(join(t.logs, 'cordis.patch.yml'), 'utf8')).toBe(patchOf(t));
    });
  }

  test('the route rows are the committed templates with the URL and model filled in, and the base rows follow unchanged', () => {
    const t = trial();
    expect(run(t, 'particle').status).toBe(0);
    const tmpl = readFileSync(join(HARNESS, 'config/route.particle.patch.yml'), 'utf8').replaceAll('@MODEL@', '"particle-1"').replaceAll('@BASE_URL_V1@', '"http://127.0.0.1:1/dsh-slot/particle/v1"');
    expect(patchOf(t)).toBe('# Written by harnesses/dsh/adapter.sh for trial dsh-test (route particle). Do not edit: the adapter rewrites it on start.\n' + tmpl + readFileSync(join(HARNESS, 'config/base.patch.yml'), 'utf8'));
  });

  test('refusals before any turn: another route, a config, a per-turn scope, a gbrain install, another dsh version, a profile dsh cannot compose', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ HE_MODEL_BASE_URL: 'http://127.0.0.1:1/dsh-slot/gemini' }, /ends in \/gemini: dsh runs on an anthropic, openai, particle or openrouter route/],
      [{ HE_HARNESS_CONFIG: 'route-hook' }, /HE-ADAPTER-007 HE_HARNESS_CONFIG=route-hook is not a dsh config/],
      [{ HE_SESSION_SCOPE: 'turn' }, /HE_SESSION_SCOPE=turn is not supported/],
      [{ HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev' }, /HE-ADAPTER-006/],
      [{ STUB_DSH_VERSION: '0.2.1-rc.5' }, /dsh 0.2.1-rc.5 is not the pinned 0.2.2-rc.1/],
      [{ STUB_DUMP_FAIL: '1' }, /dsh --dump-config refused the profile: dsh: bad patch/],
    ];
    for (const [extra, msg] of cases) {
      const t = trial();
      const r = run(t, 'openrouter', extra);
      expect(r.status).toBe(2);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toMatch(msg);
      expect(existsSync(t.stubLog)).toBe(false);
    }
    const t = trial();
    expect(spawnSync('bash', [ADAPTER, 'chat'], { env: ENV(t), encoding: 'utf8' }).status).toBe(2);
  });

  test('exit mapping: a provider HTTP status and an unreachable endpoint are 3, another error code or an error outside a turn is 2, the budget is 124', () => {
    const want: Array<[string, number, string]> = [
      ['[stub:400]', 3, 'model error (HTTP 400, INVALID_REQUEST)'],
      ['[stub:402]', 3, 'model error (HTTP 402, INVALID_REQUEST)'],
      ['[stub:transport]', 3, 'model error (the model endpoint is unreachable: Connection error.)'],
      ['[stub:unknown]', 2, 'harness error (dsh exit 1, reason error, UNKNOWN_MODEL: model x is not configured)'],
      ['[stub:outside]', 2, 'harness error (dsh exit 1, SESSION_NOT_FOUND: no stored session)'],
    ];
    for (const [marker, code, detail] of want) {
      const t = trial(marker);
      expect(run(t).status).toBe(code);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8').trim().split('\n').at(-1)!).toEndWith(' exit ' + code + ' (' + detail + ')');
    }
    const t = trial('[stub:sleep]');
    const started = Date.now();
    expect(run(t, 'openrouter', { HE_TIME_BUDGET_S: '2' }).status).toBe(124);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(spawnSync('pgrep', ['-f', 'sleep 30(17|29)']).status).toBe(1);
  }, 60_000);
});

describe('dsh adapter, serve, process level (stub dsh)', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = createWorldServer({ world, split: 'dev', trialId: 'dsh-serve', eventsPath: null, hostname: '127.0.0.1', port: 0 }); });
  afterAll(() => ws?.stop());
  const serveEnv = (t: Trial, extra: Record<string, string> = {}) => ENV(t, 'openrouter', { HE_WORLD_MCP_URL: ws.url + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token, ...extra });

  test('probes world-MCP, inserts the MCP row with the bearer by name, writes ready, keeps one dsh session per key and resumes it, and stops on SIGTERM', async () => {
    const t = trial();
    const child = spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: serveEnv(t) });
    const exited = new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 20_000, 'ready');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'))).toMatchObject({ harness: 'dsh', version: PIN.version, route: 'openrouter', mcp_servers: ['world'], adapter_sha256: sha256(readFileSync(ADAPTER)) });
      expect(JSON.parse(readFileSync(join(t.logs, 'mcp-probe.world.json'), 'utf8')).sort()).toEqual([...WORLD_MCP_TOOLS].sort());
      const patch = patchOf(t);
      expect(patch).toContain("- insert:\n    - id: mcp-world\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: world\n        transport: streamable-http\n        url: " + JSON.stringify(ws.url + '/mcp') +
        "\n        headers:\n          Authorization: !!js '" + "\u0060" + "Bearer $" + "{process.env.HE_WORLD_MCP_TOKEN}" + "\u0060" + "'\n        failOnStartupError: true\n        toolCallTimeoutMs: 120000\n");
      expect(patch).not.toContain(ws.credentials.bot.token);
      expect(patch).not.toContain('mcp-gbrain');
      post(t, request(1));
      const r1 = await response(t, 1);
      expect(r1).toMatchObject({ turn: 1, exit: 0 });
      post(t, request(2, { member: 'ben', channel: { id: 'C1', name: 'general', type: 'channel' } }));
      expect(await response(t, 2)).toMatchObject({ exit: 0 });
      post(t, request(3));
      const r3 = await response(t, 3);
      expect(r3.reply_text).toBe(r1.reply_text);
      post(t, request(4, { thread_ts: '1.4' }));
      expect(await response(t, 4)).toMatchObject({ exit: 0 });
      const store = JSON.parse(readFileSync(join(t.state, 'dsh-sessions.json'), 'utf8'));
      expect(Object.keys(store).sort()).toEqual(['channel:C1', 'dm:dana-okafor', 'dm:dana-okafor:t1.4']);
      const args = readFileSync(t.stubLog, 'utf8').trim().split('\n');
      expect(args).toEqual([
        '--profile headless --json --permission-mode workspace-write --approval-policy never -',
        '--profile headless --json --permission-mode workspace-write --approval-policy never -',
        '--profile headless --json --permission-mode workspace-write --approval-policy never --session-id ' + store['dm:dana-okafor'] + ' -',
        '--profile headless --json --permission-mode workspace-write --approval-policy never -',
      ]);
      post(t, request(5, { prompt: '[stub:400]' }));
      expect(await response(t, 5)).toMatchObject({ exit: 3, reply_text: null, detail: 'model error (HTTP 400, INVALID_REQUEST)' });
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally { child.kill('SIGKILL'); }
  }, 60_000);

  test('SIGTERM during a turn answers it as exit 2 and leaves nothing running', async () => {
    const t = trial();
    const child = spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: serveEnv(t) });
    const exited = new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 20_000, 'ready');
      post(t, request(1, { prompt: '[stub:sleep]', time_budget_s: 60 }));
      await waitFor(() => existsSync(t.stubLog), 10_000, 'the turn to start');
      await Bun.sleep(500);
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
      expect(await response(t, 1, 5000)).toMatchObject({ exit: 2, reply_text: null, detail: 'stopped by SIGTERM during the turn' });
      expect(spawnSync('pgrep', ['-f', 'sleep 30(17|29)']).status).toBe(1);
    } finally { child.kill('SIGKILL'); }
  }, 60_000);

  test('a world-MCP server that does not answer, or no world variables, is exit 2 before ready; a gbrain tap adds a second row', async () => {
    const t1 = trial();
    expect(spawnSync('bash', [ADAPTER, 'serve'], { env: serveEnv(t1, { HE_WORLD_MCP_URL: 'http://127.0.0.1:1/mcp' }), encoding: 'utf8', timeout: 60_000 }).status).toBe(2);
    expect(existsSync(join(t1.logs, 'ready'))).toBe(false);
    const t2 = trial();
    const env2 = ENV(t2);
    expect(spawnSync('bash', [ADAPTER, 'serve'], { env: env2, encoding: 'utf8', timeout: 30_000 }).status).toBe(2);
    const t3 = trial();
    const child = spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: serveEnv(t3, { HE_GBRAIN_MCP_URL: ws.url + '/mcp', HE_GBRAIN_MCP_TOKEN: ws.credentials.bot.token }) });
    try {
      await waitFor(() => existsSync(join(t3.logs, 'ready')), 20_000, 'ready');
      expect(JSON.parse(readFileSync(join(t3.logs, 'ready'), 'utf8')).mcp_servers).toEqual(['world', 'gbrain']);
      expect(patchOf(t3)).toContain("- insert:\n    - id: mcp-gbrain\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: gbrain\n");
      expect(patchOf(t3)).toContain('process.env.HE_GBRAIN_MCP_TOKEN');
    } finally { child.kill('SIGTERM'); }
  }, 90_000);
});

// ---- container level ----------------------------------------------------------------------------------------------------
const haveDocker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const IMAGE = 'harness-eval/dsh:dev';
/** Canary values for every provider key a harness could pick up from its environment. None may reach a request or a file. */
const CANARIES = { ANTHROPIC_API_KEY: 'canary-anthropic-7f1c', OPENAI_API_KEY: 'canary-openai-7f1c', OPENROUTER_API_KEY: 'canary-openrouter-7f1c', DEEPSEEK_API_KEY: 'canary-deepseek-7f1c', PARTICLE_API_KEY: 'canary-particle-7f1c' };
const INSTRUCTION_MARK = 'AUTO-LOADED-INSTRUCTION-7f1c';
/** A workspace skill's description: dsh's shipped skill catalog lists it (frontmatter only), so it is expected in requests. */
const SKILL_MARK = 'LISTED-WORKSPACE-SKILL-7f1c';
const PLACEHOLDER_PARTICLE = 'placeholder-particle-dsh';

describe.skipIf(!haveDocker)('dsh image, container level, against a fake streaming upstream and an in-process world', () => {
  let gateway: string;
  let ws: WorldServer;
  let tmp: string;
  let proxy: { proc: ReturnType<typeof Bun.spawn>; port: number } | undefined;
  const control = 'control-' + process.pid;

  beforeAll(async () => {
    const build = spawnSync('docker', ['build', '-q', '-t', IMAGE, HARNESS], { encoding: 'utf8', timeout: 1_800_000 });
    expect(build.status, build.stderr).toBe(0);
    gateway = containerHostAddress();
    tmp = mkdtempSync(join(tmpdir(), 'he-dsh-cx-'));
    ws = createWorldServer({ world, split: 'dev', trialId: 'dsh-cx', eventsPath: null, hostname: gateway, port: 0 });
  }, 1_900_000);
  afterAll(async () => { proxy?.proc.kill('SIGTERM'); await proxy?.proc.exited; ws?.stop(); });

  /** docker run of the image as the runner runs it: four mounts, the calling user, stdin closed, no TTY, the canaries in its env. */
  function dockerArgs(t: Trial, name: string, entry: string, env: Record<string, string>): string[] {
    const e = { HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: '/harness-state', HE_TURNS_DIR: '/he-turns', HE_TIME_BUDGET_S: '90', HE_TASK_SLICE: 'multiuser', ...CANARIES, ...env };
    return ['run', '-i', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
      '-v', t.workspace + ':/workspace', '-v', t.state + ':/harness-state', '-v', t.logs + ':/he-logs', '-v', t.turns + ':/he-turns',
      ...Object.entries(e).flatMap(([k, v]) => ['-e', k + '=' + v]), IMAGE, entry];
  }
  /** Instruction files a harness might load on its own, with a marker no request may carry, and a workspace skill the catalog lists. */
  function seedInstructionFiles(t: Trial) {
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md']) writeFileSync(join(t.workspace, f), INSTRUCTION_MARK + ' ' + f + '\n');
    mkdirSync(join(t.workspace, '.agents/skills/marker'), { recursive: true });
    writeFileSync(join(t.workspace, '.agents/skills/marker/SKILL.md'), '---\nname: marker\ndescription: ' + SKILL_MARK + '\n---\n' + INSTRUCTION_MARK + ' skill body\n');
  }
  const noLeaks = (t: Trial, token: string) => {
    const text = allText(t.state) + allText(t.logs);
    for (const c of Object.values(CANARIES)) expect(text).not.toContain(c);
    expect(text).not.toContain(token.split('.')[1]!);
  };

  test('the image pins dsh and every package from the lock, with no credential file', () => {
    const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'bash', IMAGE, '-c',
      'dsh --version && node -p "require(\'/opt/harness/dsh/node_modules/@deepseek-ai/dsh/package.json\').version" && sha256sum /opt/harness/dsh/package-lock.json && ls /opt/harness/dsh/node_modules/@deepseek-ai/dsh-mcp-client/package.json && find / -xdev \\( -name .credentials.yaml -o -name .env \\) 2>/dev/null | wc -l'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const [version, pkg, lock, mcp, creds] = r.stdout.trim().split('\n');
    expect([version, pkg]).toEqual([PIN.version, PIN.version]);
    expect(lock!.split(' ')[0]).toBe(sha256(readFileSync(join(HARNESS, 'package-lock.json'))));
    const locked = JSON.parse(readFileSync(join(HARNESS, 'package-lock.json'), 'utf8')).packages['node_modules/@deepseek-ai/dsh'];
    expect(locked).toMatchObject({ version: PIN.version, integrity: PIN.integrity.npm_integrity });
    expect(mcp).toContain('dsh-mcp-client');
    expect(creds).toBe('0');
  }, 120_000);

  test('serve on the OpenRouter route: three multi-user turns, world-MCP calls as the bot, the DM session resumed with its reasoning, tool parity, nothing auto-loaded, no canary', async () => {
    const t = trial();
    seedInstructionFiles(t);
    const slot = 'dsh-or';
    const token = trialToken(slot);
    const route = '/' + slot + '/openrouter';
    const name = 'he-dsh-cx-' + process.pid;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const local = startFakeUpstream({ host: gateway, token, canaries: [...Object.values(CANARIES), INSTRUCTION_MARK] });
    const child = spawn('docker', dockerArgs(t, name, 'serve', {
      HE_MODEL_BASE_URL: 'http://host.docker.internal:' + local.port + route, HE_MODEL_API_KEY: token, HE_MODEL_NAME: ROUTES.openrouter.model, HE_TRIAL_ID: 'dsh-cx',
      HE_WORLD_MCP_URL: 'http://host.docker.internal:' + new URL(ws.url).port + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token,
    }), { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 120_000, 'ready file');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'))).toMatchObject({ harness: 'dsh', version: PIN.version, route: 'openrouter', mcp_servers: ['world'], adapter_sha256: sha256(readFileSync(ADAPTER)) });
      expect(spawnSync('docker', ['inspect', '-f', '{{.Config.Tty}}', name], { encoding: 'utf8' }).stdout.trim()).toBe('false');

      // Turn 1, Dana in a DM: a read through world-MCP.
      post(t, request(1, { prompt: 'Who are you? [fake:call mcp__world__whoami {}]', time_budget_s: 90 }));
      const r1 = await response(t, 1, 120_000);
      expect(r1).toMatchObject({ exit: 0 });
      expect(r1.reply_text).toMatch(/^fake reply \d+ after mcp__world__whoami$/);

      // Turn 2, Ben in a shared channel: a write through world-MCP, attributed to the bot.
      const channel = ws.service.channelsFor(ws.service.bot!, 'mcp').find((c) => c.kind !== 'dm')!;
      const before = ws.log.events.length;
      post(t, request(2, { member: 'ben', channel: { id: channel.id, name: channel.name, type: 'channel' }, time_budget_s: 90,
        prompt: 'Post it. [fake:call mcp__world__post_message {"channel":"' + channel.id + '","text":"dsh bot post"}]' }));
      expect((await response(t, 2, 120_000)).reply_text).toMatch(/after mcp__world__post_message$/);
      const posted = ws.log.events.slice(before).find((e) => e.tool === 'chat.postMessage');
      expect(posted).toMatchObject({ actor: 'assistant', via: 'mcp', kind: 'write', outcome: 'ok' });
      expect((posted!.args as { text: string }).text).toBe('dsh bot post');

      // Turn 3, Dana's DM again: the same dsh session, so the request carries turn 1 and its reasoning.
      post(t, request(3, { prompt: 'And again.', time_budget_s: 90 }));
      expect(await response(t, 3, 120_000)).toMatchObject({ exit: 0 });
      const store = JSON.parse(readFileSync(join(t.state, 'dsh-sessions.json'), 'utf8'));
      expect(Object.keys(store).sort()).toEqual(['channel:' + channel.id, 'dm:dana-okafor']);
      const sid = (n: number) => readFileSync(join(t.logs, 'turns/turn-' + String(n).padStart(4, '0') + '.dsh.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'session').sessionId;
      expect(sid(3)).toBe(sid(1));
      expect(sid(2)).not.toBe(sid(1));

      const main = local.seen.filter((s) => (s.body.tools ?? []).length > 0);
      const last = main.at(-1)!.body.messages as Json[];
      expect(JSON.stringify(last)).toContain('Who are you?');
      expect(JSON.stringify(last)).not.toContain('dsh bot post');
      // DeepSeek reasoning goes back on tool turns: every assistant message the session replays carries the reasoning_details
      // OpenRouter streamed for it, the tool-call message of turn 1 included.
      const replayed = last.filter((m) => m.role === 'assistant');
      expect(replayed.length).toBeGreaterThanOrEqual(2);
      expect(replayed.some((m) => m.tool_calls?.length)).toBe(true);
      for (const m of replayed) expect(m.reasoning_details?.[0]).toMatchObject({ type: 'reasoning.text', text: expect.stringMatching(/^fake reasoning \d+ /) });

      // Every request: the fake's OpenRouter route, the per-trial token, the cell model, effort high, the 128000 cap.
      for (const s of local.seen) {
        expect(s).toMatchObject({ method: 'POST', path: '/v1/chat/completions', prefix: route, credential: 'expected', status: 200, canaries: [] });
        expect(s.body).toMatchObject({ model: ROUTES.openrouter.model, stream: true, reasoning: { effort: 'high' } });
      }
      for (const s of main) expect(s.body.max_completion_tokens).toBe(128000);
      // Housekeeping: dsh's session-title request goes once per new session, on the cell's own route and model.
      const titles = local.seen.filter((s) => !(s.body.tools ?? []).length);
      expect(titles.length).toBe(2);
      for (const s of titles) expect(s.body.max_completion_tokens).toBe(4096);

      // Tool parity: the world tools the model is offered are exactly the world MCP server's tools/list.
      const offered = (main[0]!.body.tools as Json[]).map((x) => x.function.name as string);
      expect(offered.filter((n) => n.startsWith('mcp__world__')).map((n) => n.slice('mcp__world__'.length)).sort()).toEqual([...WORLD_MCP_TOOLS].sort());
      expect(JSON.parse(readFileSync(join(t.logs, 'mcp-probe.world.json'), 'utf8')).sort()).toEqual([...WORLD_MCP_TOOLS].sort());
      expect(offered.some((n) => /web|fetch|search/i.test(n) && !n.startsWith('mcp__world__'))).toBe(false);
      // The shipped skill catalog lists a workspace skill's description; its body stays unread until the skill tool loads it.
      expect(JSON.stringify(main[0]!.body.messages)).toContain(SKILL_MARK);
      writeFileSync(join(tmp, 'openrouter-tools.json'), JSON.stringify(offered.sort(), null, 1));

      const stopped = spawnSync('docker', ['stop', '-t', '20', name], { encoding: 'utf8' });
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', name], { encoding: 'utf8' }).stdout.trim()).toBe('0');
      const diff = spawnSync('docker', ['diff', name], { encoding: 'utf8' });
      expect(diff.stdout.split('\n').filter((l) => l.trim() && l !== 'A /he-logs' && l !== 'A /he-turns')).toEqual([]);
      noLeaks(t, token);
    } finally {
      child.kill('SIGKILL');
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      local.stop();
    }
  }, 600_000);

  /** One run turn in the container: a shell command through dsh's bash tool, then text. Returns the requests the upstream saw. */
  async function runTurn(route: Route, baseUrl: string, token: string, up: FakeUpstream | null) {
    const t = trial('Write the file. [fake:call bash {"command":"echo dsh > /workspace/made.txt","description":"write made.txt"}]');
    seedInstructionFiles(t);
    const name = 'he-dsh-run-' + route + '-' + process.pid;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    // Not spawnSync: the fake upstream answers from this process's event loop.
    const proc = Bun.spawn(['docker', ...dockerArgs(t, name, 'run', { HE_MODEL_BASE_URL: baseUrl, HE_MODEL_API_KEY: token, HE_MODEL_NAME: ROUTES[route].model, HE_TRIAL_ID: 'dsh-run-' + route })],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', timeout: 300_000 });
    const status = await proc.exited;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    expect(status, readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toBe(0);
    expect(readFileSync(join(t.workspace, 'made.txt'), 'utf8')).toBe('dsh\n');
    expect(readFileSync(join(t.logs, 'run.reply.txt'), 'utf8')).toMatch(/after bash$/);
    noLeaks(t, token);
    return up ? up.seen.filter((s) => s.prefix.endsWith('/' + route)) : [];
  }

  test('run on the Anthropic route: Messages with adaptive thinking at effort high, the signed thinking block replayed on the tool turn', async () => {
    const token = trialToken('dsh-an');
    const up = startFakeUpstream({ host: gateway, token, canaries: [...Object.values(CANARIES), INSTRUCTION_MARK] });
    try {
      const seen = await runTurn('anthropic', 'http://host.docker.internal:' + up.port + '/dsh-an/anthropic', token, up);
      expect(seen.length).toBe(3);
      for (const s of seen) {
        expect(s).toMatchObject({ path: '/v1/messages', credential: 'expected', status: 200, canaries: [] });
        expect(s.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
      }
      const tool = seen.filter((s) => s.body.tools?.length).at(-1)!.body.messages as Json[];
      const asst = tool.find((m) => m.role === 'assistant')!;
      expect(asst.content[0]).toMatchObject({ type: 'thinking', signature: expect.stringMatching(/^sig-\d+$/) });
      expect(seen.filter((s) => s.body.tools?.length).every((s) => s.body.max_tokens === 128000)).toBe(true);
    } finally { up.stop(); }
  }, 360_000);

  test('run on the OpenAI route: Responses at effort high with encrypted reasoning, the reasoning item replayed on the tool turn', async () => {
    const token = trialToken('dsh-oa');
    const up = startFakeUpstream({ host: gateway, token, canaries: [...Object.values(CANARIES), INSTRUCTION_MARK] });
    try {
      const seen = await runTurn('openai', 'http://host.docker.internal:' + up.port + '/dsh-oa/openai', token, up);
      expect(seen.length).toBe(3);
      for (const s of seen) {
        expect(s).toMatchObject({ path: '/v1/responses', credential: 'expected', status: 200, canaries: [] });
        expect(s.body).toMatchObject({ model: 'gpt-6.1-sol', stream: true, store: false, reasoning: { effort: 'high' }, include: ['reasoning.encrypted_content'] });
      }
      const input = seen.filter((s) => s.body.tools?.length).at(-1)!.body.input as Json[];
      expect(input.find((x) => x.type === 'reasoning')).toMatchObject({ encrypted_content: expect.stringMatching(/^enc-\d+$/) });
      expect(seen.filter((s) => s.body.tools?.length).every((s) => s.body.max_output_tokens === 128000)).toBe(true);
    } finally { up.stop(); }
  }, 360_000);

  test('run on the Particle route through the real metering proxy in lease mode: Chat Completions at effort high, reasoning_content replayed, every call metered on the cell model', async () => {
    const up = startFakeUpstream({ host: '127.0.0.1', token: PLACEHOLDER_PARTICLE, canaries: [...Object.values(CANARIES), INSTRUCTION_MARK] });
    let stderr = '';
    for (let attempt = 0; attempt < 3 && !proxy; attempt++) {
      const probe = Bun.serve({ port: 0, hostname: gateway, fetch: () => new Response() });
      const port = probe.port as number;
      probe.stop(true);
      const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', gateway + ':' + port, '--budget-ledger', join(tmp, 'ledger.sqlite'),
        '--lease-usd', '5', '--run-id', 'dsh-cx', '--new-run', '--max-output-tokens', '128000', '--allow-models', 'particle:particle-1',
        '--upstream', 'particle=http://127.0.0.1:' + up.port, '--usage-log', join(tmp, 'usage.ndjson'), '--control-token', control],
        { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, PARTICLE_API_KEY: PLACEHOLDER_PARTICLE }, stdout: 'pipe', stderr: 'pipe' });
      for (let i = 0; i < 100 && !proxy; i++) {
        if (proc.exitCode !== null) break;
        try { await fetch('http://' + gateway + ':' + port + '/__proxy/status'); proxy = { proc, port }; } catch { await Bun.sleep(50); }
      }
      if (!proxy) { proc.kill('SIGKILL'); await proc.exited; stderr = await new Response(proc.stderr).text(); }
    }
    if (!proxy) throw new Error('the metering proxy did not start: ' + stderr);
    const slot = 'dsh-pa';
    const token = trialToken(slot);
    const bound = await fetch('http://' + gateway + ':' + proxy.port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control },
      body: JSON.stringify({ slot, key: trialKey(slot), token, models: ['particle:particle-1'] }) });
    expect(bound.status).toBe(200);
    try {
      await runTurn('particle', 'http://host.docker.internal:' + proxy.port + '/' + slot + '/particle', token, null);
      const seen = up.seen;
      expect(seen.length).toBe(3);
      for (const s of seen) {
        expect(s).toMatchObject({ path: '/v1/chat/completions', credential: 'expected', status: 200, canaries: [] });
        expect(s.body).toMatchObject({ model: 'particle-1', stream: true, reasoning_effort: 'high', stream_options: { include_usage: true } });
        expect(s.body.store).toBeUndefined();
        expect((s.body.messages as Json[])[0]!.role).toBe('system');
      }
      const tool = seen.filter((s) => s.body.tools?.length).at(-1)!.body.messages as Json[];
      expect(tool.find((m) => m.role === 'assistant' && m.tool_calls)).toMatchObject({ reasoning_content: expect.stringMatching(/^fake reasoning \d+ /) });
      const usage = readFileSync(join(tmp, 'usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      expect(usage.length).toBe(3);
      for (const u of usage) expect(u).toMatchObject({ key: trialKey(slot), provider: 'particle', route: '/v1/chat/completions', model: 'particle-1', outcome: 'forwarded', status: 200, streamed: true, input_tokens: 40, output_tokens: 12 });
    } finally { up.stop(); }
  }, 360_000);
});
