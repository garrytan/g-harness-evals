/**
 * Pi (harnesses/pi), keyless. The model key in every test is a per-trial placeholder with a canary suffix, every spawned
 * process gets a scrubbed environment, and the models are fakes.
 *
 * Process level (tests/fixtures/pi/bin/pi stands in for pi 1.5.0; no docker):
 * 1. The pin: pin.json, the Dockerfile, package.json and package-lock.json name the same Pi version and npm integrity, the
 *    one Harbor's stock Pi agent ran in frontier-harness-2026-11, and every locked package carries an integrity.
 * 2. Each route (the last segment of HE_MODEL_BASE_URL) writes its models.json and picks Pi's provider; any other route,
 *    a harness config, the per-turn session scope, the gbrain settings and a Pi version off the pin stop before any turn.
 * 3. The turn command: the message is the last argument, after "--", byte for byte (a message that starts with "- "
 *    included), with --thinking medium, the session directory and UUIDv5 session id, Pi's side traffic off, state under
 *    HE_SESSION_STATE_DIR and stdin not a terminal.
 * 4. The exit mapping from Pi's JSON event stream: provider errors 3, the extension's HE-ADAPTER-004, a world-MCP transport
 *    error, an aborted or other error message, a crash and a non-zero exit 2, a tool's own error 0, the budget 124 with
 *    the turn's processes gone.
 * 5. Serve: ready after tools/list answers, one Pi session per conversation key, a session resumed on the conversation's
 *    next turn, a model error as exit 3 with a null reply, SIGTERM as a clean stop.
 * 6. The canary never appears in a log, a state file or the stand-in's record.
 *
 * Container level (docker and harness-eval/pi:dev, skipped otherwise; the checkout's adapter.sh, config/, extension/ and
 * pin.json are mounted over /opt/harness), against the world mock and tests/fixtures/pi/fake-upstream.ts:
 * 7. The image runs pi 1.5.0 and carries no state, auth.json or models.json.
 * 8. Each route completes a run turn that calls the world tool whoami: the request shape each route sends (endpoint, auth
 *    header, effort medium, the 128000 output cap; on OpenRouter's DeepSeek row Pi's catalog has no medium level, so Pi
 *    raises it to high), the world's tools under their own names with descriptions and schemas
 *    as tools/list gives them (on Anthropic Messages Pi's own encoding drops $schema and turns an absent required into [],
 *    and that is the only difference), Pi's built-in tools beside them, no context-file section in the system prompt, the
 *    whoami result back in the next request, and the canary only in the auth header.
 * 9. A multi-user serve run through the real metering proxy: two members' DMs and a channel thread are separate sessions, a member's next DM turn carries
 *    that member's history and no other, and a message that starts with "- " reaches the model as written. A turn whose
 *    bash tool command outlives the budget is 124, the command (which Pi starts in a session of its own) is gone, and
 *    the next turn completes. The proxy records effort medium on every call, and the fake behind it never sees the canary.
 * 10. The proxy's 403 refusal is exit 3.
 *
 * Extension level (extension/world-mcp.ts loaded in this process against a stub MCP server):
 * 11. An SSE answer is matched to its request by exact JSON-RPC id, so a message with id 20 is never taken for id 2.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { trialKey } from '../runner/trial/proxy.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { startFakeUpstream, type FakeUpstream, type SeenRequest } from './fixtures/pi/fake-upstream.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'harnesses/pi');
const ADAPTER = join(DIR, 'adapter.sh');
const PIN = JSON.parse(readFileSync(join(DIR, 'pin.json'), 'utf8'));
const STUB_BIN = join(ROOT, 'tests/fixtures/pi/bin');
const NODE = Bun.which('node');
const PATH = [STUB_BIN, ...(NODE ? [dirname(NODE)] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const CANARY = trialKey('pi-test') + '.' + 'c0ffee00'.repeat(4);
const IMAGE = 'harness-eval/pi:dev';
const MODELS: Record<string, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-6.1-sol', particle: 'particle-1', openrouter: 'deepseek/deepseek-v4.1-flash-1017' };
const ROUTES = Object.keys(MODELS);

/** The adapter's session id: UUIDv5 in the URL namespace of harness-evals:pi:<key>. */
function sessionUuid(key: string): string {
  const h = createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')).update('harness-evals:pi:' + key).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}

interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string; stubLog: string }

function trial(instruction: string): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-pi-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), stubLog: join(dir, 'stub.ndjson') };
  for (const d of [t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.workspace, 'instruction.md'), instruction);
  return t;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p)); else out.push(p);
  }
  return out;
}

/** Every file under dir whose bytes hold the canary. */
const canaryFiles = (dir: string) => files(dir).filter((f) => readFileSync(f).includes(CANARY));

function baseEnv(t: Trial, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH, HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns,
    HE_MODEL_BASE_URL: 'http://127.0.0.1:1/pi-test/anthropic', HE_MODEL_API_KEY: CANARY, HE_MODEL_NAME: MODELS.anthropic!,
    HE_TIME_BUDGET_S: '20', HE_TRIAL_ID: 'pi-test', STUB_LOG: t.stubLog, ...extra,
  };
}

/** The adapter as its own process, so a world server in this one keeps answering while it runs. */
async function runAdapter(t: Trial, extra: Record<string, string> = {}, entry = 'run') {
  const p = Bun.spawn(['bash', ADAPTER, entry], { env: baseEnv(t, extra), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => p.kill('SIGKILL'), 90_000);
  const [stdout, stderr, status] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { status, stdout, stderr };
}
const stubCalls = (t: Trial) => existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const adapterLog = (t: Trial) => existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : '';
const alive = (command: string) => spawnSync('pgrep', ['-f', '^' + command + '$'], { encoding: 'utf8' }).stdout.trim();

async function until<T>(get: () => T | null | undefined, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await Bun.sleep(100);
  }
}

function turnRequest(turn: number, member: string, channel: { id: string; type: 'dm' | 'channel' }, text: string, threadTs: string | null = null, budget = 60) {
  return { turn, trial_id: 'pi-test', prompt: text, actor: { member, slack_user_id: 'U' + member.toUpperCase(), name: member, role: 'staff', team: null },
    channel: { id: channel.id, name: channel.id.toLowerCase(), type: channel.type }, text, ts: '1790000000.00' + String(turn).padStart(4, '0'), thread_ts: threadTs,
    sim_now: '2026-11-09T09:00:00-08:00', time_budget_s: budget };
}

async function serveTurn(turnsDir: string, req: ReturnType<typeof turnRequest>, ms = 90_000) {
  const name = 'turn-' + String(req.turn).padStart(4, '0');
  writeFileSync(join(turnsDir, name + '.request.json.tmp'), JSON.stringify(req));
  Bun.spawnSync(['mv', join(turnsDir, name + '.request.json.tmp'), join(turnsDir, name + '.request.json')]);
  const resp = join(turnsDir, name + '.response.json');
  return until(() => existsSync(resp) ? JSON.parse(readFileSync(resp, 'utf8')) : null, ms, name);
}

async function worldTools(ws: WorldServer): Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>> {
  const res = await fetch(ws.url + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + ws.credentials.bot.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const text = await res.text();
  return JSON.parse(text.split('\n').map((l) => l.replace(/^data: /, '')).find((l) => l.startsWith('{'))!).result.tools;
}

describe('pi pin', () => {
  test('pin.json, the Dockerfile, package.json and package-lock.json name Pi 1.5.0 with the npm integrity Harbor ran in frontier-harness-2026-11', () => {
    expect(PIN.version).toBe('1.5.0');
    expect(readFileSync(join(DIR, 'Dockerfile'), 'utf8')).toContain('\nARG PI_VERSION=' + PIN.version + '\n');
    expect(JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8')).dependencies).toEqual({ [PIN.package]: PIN.version });
    const lock = JSON.parse(readFileSync(join(DIR, 'package-lock.json'), 'utf8'));
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/' + PIN.package]).toMatchObject({ version: PIN.version, integrity: PIN.integrity.npm_integrity });
    const locked = Object.entries(lock.packages as Record<string, { integrity?: string; link?: boolean }>).filter(([k]) => k !== '');
    expect(locked.length).toBeGreaterThan(100);
    expect(locked.filter(([, v]) => !v.link && !/^sha512-/.test(v.integrity ?? '')).map(([k]) => k)).toEqual([]);
    const harbor = JSON.parse(readFileSync(join(ROOT, 'scripts/frontier-harbor/pin.json'), 'utf8')).harnesses.pi;
    expect({ package: harbor.package, version: harbor.version, integrity: harbor.npm_integrity }).toEqual({ package: PIN.package, version: PIN.version, integrity: PIN.integrity.npm_integrity });
  });

  test('every route template holds no key, no fixed URL and no model name: the adapter fills in the cell values', () => {
    for (const route of ROUTES) {
      const text = readFileSync(join(DIR, 'config', 'models.' + route + '.json'), 'utf8');
      expect(text).toContain('"apiKey": "$HE_MODEL_API_KEY"');
      expect(text).toContain('"baseUrl": "$' + '{HE_MODEL_BASE_URL}');
      expect(text).not.toMatch(/https?:|sk-|he-trial|claude|gpt-|particle-1|deepseek/i);
    }
  });
});

describe.skipIf(!NODE)('pi adapter, process level', () => {
  test('each route writes its models.json under the state directory and hands Pi that provider and the cell model', async () => {
    const want: Record<string, unknown> = {
      anthropic: { providers: { anthropic: { baseUrl: 'http://127.0.0.1:1/pi-test/anthropic', apiKey: '$HE_MODEL_API_KEY', modelOverrides: { 'claude-opus-5-5': { compat: { supportsMidConvoEffort: false } } } } } },
      openai: { providers: { openai: { baseUrl: 'http://127.0.0.1:1/pi-test/openai/v1', apiKey: '$HE_MODEL_API_KEY', modelOverrides: { 'gpt-6.1-sol': { compat: { supportsMidConvoEffort: false } } } } } },
      particle: { providers: { particle: { baseUrl: 'http://127.0.0.1:1/pi-test/particle/v1', apiKey: '$HE_MODEL_API_KEY', api: 'openai-completions',
        models: [{ id: 'particle-1', name: 'particle-1', reasoning: true, input: ['text'], contextWindow: 1048576, maxTokens: 128000,
          compat: { maxTokensField: 'max_completion_tokens', supportsUsageInStreaming: true, supportsReasoningEffort: true } }] } } },
      openrouter: { providers: { openrouter: { baseUrl: 'http://127.0.0.1:1/pi-test/openrouter/v1', apiKey: '$HE_MODEL_API_KEY', modelOverrides: { 'deepseek/deepseek-v4.1-flash-1017': { maxTokens: 128000 } } } } },
    };
    for (const route of ROUTES) {
      const t = trial('Say hello.');
      const r = await runAdapter(t, { HE_MODEL_BASE_URL: 'http://127.0.0.1:1/pi-test/' + route + '/', HE_MODEL_NAME: MODELS[route]! });
      expect(r.status, route + ': ' + adapterLog(t)).toBe(0);
      expect(JSON.parse(readFileSync(join(t.state, 'pi/agent/models.json'), 'utf8'))).toEqual(want[route]);
      const argv = stubCalls(t)[0].argv as string[];
      expect(argv.slice(0, 8)).toEqual(['--mode', 'json', '--provider', route, '--model', MODELS[route], '--thinking', 'medium']);
      expect(canaryFiles(t.dir)).toEqual([]);
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  test('the message is the last argument after "--", byte for byte, so "- " at its start is not an option; side traffic is off and state is under HE_SESSION_STATE_DIR', async () => {
    const message = '- hello\n  --model gpt-6.1-sol\n';
    const t = trial(message);
    const r = await runAdapter(t);
    expect(r.status, adapterLog(t)).toBe(0);
    const sid = sessionUuid('run:pi-test');
    expect(r.stdout).toBe('stub reply 1 in ' + sid + '\n');
    const calls = stubCalls(t);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ argv: ['--mode', 'json', '--provider', 'anthropic', '--model', MODELS.anthropic, '--thinking', 'medium', '--session-dir', join(t.state, 'pi/sessions'), '--session-id', sid, '--', message],
      key: 'set', home: t.state, agent_dir: join(t.state, 'pi/agent'), tmpdir: join(t.state, 'tmp'), offline: '1', telemetry: '0', skip_version: '1', cwd: t.workspace, world: 'unset', stdin_tty: false });
    expect(JSON.parse(readFileSync(join(t.logs, 'run.status.json'), 'utf8'))).toMatchObject({ pi_exit: 0, session_id: sid, provider: 'anthropic', model: MODELS.anthropic, stop_reason: 'stop', thinking_level: 'medium' });
    expect(canaryFiles(t.dir)).toEqual([]);
    rmSync(t.dir, { recursive: true, force: true });
  });

  test('a prompt over the 131072 bytes one argument holds is exit 2 before Pi starts', async () => {
    const t = trial('x'.repeat(131072));
    const r = await runAdapter(t);
    expect(r.status).toBe(2);
    expect(adapterLog(t)).toContain('the prompt is 131072 bytes, over the 131072 bytes one argument may hold');
    expect(stubCalls(t)).toEqual([]);
    rmSync(t.dir, { recursive: true, force: true });
  });

  const refusals: Array<[string, Record<string, string>, string, RegExp]> = [
    ['a route with no Pi provider', { HE_MODEL_BASE_URL: 'http://127.0.0.1:1/pi-test/gemini' }, 'run', /does not end in \/anthropic, \/openai, \/particle or \/openrouter/],
    ['a harness config', { HE_HARNESS_CONFIG: 'gstack' }, 'run', /HE-ADAPTER-007 HE_HARNESS_CONFIG=gstack/],
    ['the per-turn session scope', { HE_SESSION_SCOPE: 'turn' }, 'serve', /HE_SESSION_SCOPE=turn is not supported/],
    ['the gbrain install ladder', { HE_GBRAIN_INSTALL: 'cli' }, 'run', /HE-ADAPTER-006 HE_GBRAIN_INSTALL=cli/],
    ['the gbrain arm', { HE_GBRAIN_MCP_URL: 'http://127.0.0.1:1/mcp' }, 'serve', /HE_GBRAIN_MCP_URL is set/],
    ['a Pi version off the pin', { STUB_PI_VERSION: '1.4.9' }, 'run', /pi --version is '1\.4\.9', pin\.json says 1\.5\.0/],
    ['serve with no world', {}, 'serve', /serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN/],
    ['an unknown entry', {}, 'repl', /unknown entry point: repl/],
  ];
  for (const [what, extra, entry, message] of refusals) {
    test('refused before any turn, exit 2: ' + what, async () => {
      const t = trial('Say hello.');
      const r = await runAdapter(t, extra, entry);
      expect(r.status).toBe(2);
      expect(adapterLog(t)).toMatch(message);
      expect(stubCalls(t)).toEqual([]);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      rmSync(t.dir, { recursive: true, force: true });
    });
  }

  const mapping: Array<[string, number, RegExp]> = [
    ['[stub:403]', 3, /exit 3: model error: 403 \{/],
    ['[stub:openai-402]', 3, /exit 3: model error: OpenAI API error \(402\)/],
    ['[stub:conn]', 3, /exit 3: model error: Connection error\./],
    ['[stub:other-error]', 2, /exit 2: assistant message ended with error: No API key found/],
    ['[stub:aborted]', 2, /exit 2: assistant message ended with aborted/],
    ['[stub:exit1]', 2, /exit 2: pi exit 1/],
    ['[stub:transport]', 2, /exit 2: MCP transport error: post_message: world MCP transport error: HTTP 502/],
    ['[stub:no-world]', 2, /exit 2: world-mcp: HE-ADAPTER-004 could not list the world tools/],
    ['[stub:crash]', 2, /exit 2: no assistant message in the JSON event stream \(pi exit 1, 0 unparsed lines\)/],
    ['[stub:tool-error]', 0, /completed/],
  ];
  for (const [marker, code, line] of mapping) {
    test('exit mapping: ' + marker + ' is ' + code, async () => {
      const t = trial('Do the thing. ' + marker);
      const r = await runAdapter(t);
      expect(r.status).toBe(code);
      expect(adapterLog(t)).toMatch(line);
      if (code !== 0) expect(r.stdout).toBe('');
      expect(canaryFiles(t.dir)).toEqual([]);
      rmSync(t.dir, { recursive: true, force: true });
    });
  }

  test('a turn past HE_TIME_BUDGET_S is 124, and every process of the turn is gone', async () => {
    const t = trial('[stub:sleep]');
    const started = Date.now();
    const r = await runAdapter(t, { HE_TIME_BUDGET_S: '2' });
    expect(r.status).toBe(124);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(adapterLog(t)).toContain('wall clock exceeded (HE_TIME_BUDGET_S=2)');
    expect(alive('sleep 3017')).toBe('');
    expect(alive('sleep 3029')).toBe('');
    rmSync(t.dir, { recursive: true, force: true });
  }, 30_000);

  describe('serve', () => {
    let ws: WorldServer;
    beforeAll(() => { ws = createWorldServer({ world, split: 'dev', trialId: 'pi-test', eventsPath: null, hostname: '127.0.0.1', port: 0 }); });
    afterAll(() => ws.stop());

    test('a world that does not answer tools/list is exit 2 before ready', async () => {
      const t = trial('');
      const r = await runAdapter(t, { HE_WORLD_MCP_URL: 'http://127.0.0.1:1/mcp', HE_WORLD_MCP_TOKEN: 'world-token' }, 'serve');
      expect(r.status).toBe(2);
      expect(adapterLog(t)).toContain('MCP server world did not answer tools/list at http://127.0.0.1:1/mcp');
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      rmSync(t.dir, { recursive: true, force: true });
    }, 30_000);

    test('one Pi session per conversation key, resumed on the conversation\'s next turn; a model error is exit 3 with a null reply; SIGTERM stops it cleanly', async () => {
      const t = trial('');
      const p = Bun.spawn(['bash', ADAPTER, 'serve'], { env: baseEnv(t, { HE_WORLD_MCP_URL: ws.url + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token }), stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
      try {
        const ready = await until(() => existsSync(join(t.logs, 'ready')) ? JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')) : null, 30_000, 'ready');
        expect(ready).toMatchObject({ harness: 'pi', version: '1.5.0', trial: 'pi-test', provider: 'anthropic', mcp_servers: 'world', world_tools: (await worldTools(ws)).length });
        const dm = (m: string) => ({ id: 'D-' + m, type: 'dm' as const });
        const replies = [];
        replies.push(await serveTurn(t.turns, turnRequest(1, 'alice', dm('alice'), 'hi from alice')));
        replies.push(await serveTurn(t.turns, turnRequest(2, 'bob', dm('bob'), 'hi from bob')));
        replies.push(await serveTurn(t.turns, turnRequest(3, 'alice', dm('alice'), 'again from alice')));
        replies.push(await serveTurn(t.turns, turnRequest(4, 'bob', { id: 'C-ops', type: 'channel' }, '- in a thread', '1790000000.000100')));
        replies.push(await serveTurn(t.turns, turnRequest(5, 'alice', dm('alice'), '[stub:403]')));
        const sid = { alice: sessionUuid('dm:alice'), bob: sessionUuid('dm:bob'), thread: sessionUuid('channel:C-ops:t1790000000.000100') };
        expect(replies.map((r) => [r.turn, r.exit, r.reply_text])).toEqual([
          [1, 0, 'stub reply 1 in ' + sid.alice], [2, 0, 'stub reply 1 in ' + sid.bob], [3, 0, 'stub reply 2 in ' + sid.alice], [4, 0, 'stub reply 1 in ' + sid.thread], [5, 3, null]]);
        expect(replies[4].detail).toMatch(/^model error: 403 /);
        const calls = stubCalls(t);
        expect(calls.map((c) => c.argv.at(-1))).toEqual(['hi from alice', 'hi from bob', 'again from alice', '- in a thread', '[stub:403]']);
        for (const c of calls) {
          expect(c.argv.slice(-4)).toEqual(['-e', join(DIR, 'extension/world-mcp.ts'), '--', c.argv.at(-1)]);
          expect(c.world).toBe('set');
        }
        expect(readdirSync(join(t.state, 'pi/sessions')).sort()).toEqual([sid.alice, sid.bob, sid.thread].map((s) => s + '.jsonl').sort());
      } finally {
        p.kill('SIGTERM');
      }
      expect(await p.exited).toBe(0);
      expect(adapterLog(t)).toContain('serve: stopped on signal');
      expect(canaryFiles(t.dir)).toEqual([]);
      rmSync(t.dir, { recursive: true, force: true });
    }, 60_000);
  });
});

const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME! }, timeout });
const haveImage = docker(['info'], 15_000).status === 0 && docker(['image', 'inspect', IMAGE]).status === 0;

describe.skipIf(!haveImage)('pi image, container level (' + IMAGE + ', the world mock and the fake upstream)', () => {
  const gateway = haveImage ? docker(['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}']).stdout.trim() : '';
  let ws: WorldServer, fake: FakeUpstream, listed: Awaited<ReturnType<typeof worldTools>>;
  beforeAll(async () => {
    ws = createWorldServer({ world, split: 'dev', trialId: 'pi-test', eventsPath: null, hostname: gateway, port: 0 });
    fake = startFakeUpstream(gateway);
    listed = await worldTools(ws);
  });
  afterAll(() => { ws.stop(); fake.stop(); });

  function containerArgs(t: Trial, name: string, route: string, slot: string, entry: string): string[] {
    return ['run', '--rm', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--add-host', 'host.docker.internal:host-gateway',
      '-v', t.workspace + ':/workspace', '-v', t.state + ':/harness-state', '-v', t.logs + ':/he-logs', '-v', t.turns + ':/he-turns',
      '-v', ADAPTER + ':/opt/harness/adapter.sh:ro', '-v', join(DIR, 'config') + ':/opt/harness/config:ro', '-v', join(DIR, 'extension') + ':/opt/harness/extension:ro', '-v', join(DIR, 'pin.json') + ':/opt/harness/pin.json:ro',
      '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_TURNS_DIR=/he-turns', '-e', 'HE_TRIAL_ID=pi-test', '-e', 'HE_TIME_BUDGET_S=60',
      '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:' + fake.port + '/' + slot + '/' + route, '-e', 'HE_MODEL_NAME=' + MODELS[route], '-e', 'HE_MODEL_API_KEY',
      '-e', 'HE_WORLD_MCP_URL=http://host.docker.internal:' + new URL(ws.url).port + '/mcp', '-e', 'HE_WORLD_MCP_TOKEN=' + ws.credentials.bot.token,
      IMAGE, entry];
  }
  const containerEnv = { PATH: process.env.PATH!, HOME: process.env.HOME!, HE_MODEL_API_KEY: CANARY };

  async function runContainer(t: Trial, route: string, slot: string) {
    const p = Bun.spawn(['docker', ...containerArgs(t, 'he-pi-test-' + slot + '-' + process.pid, route, slot, 'run')], { env: containerEnv, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, status] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { status, stdout, stderr };
  }

  /** The tool definitions a request sent, by name, as { description, schema }. */
  function sentTools(route: string, body: Record<string, any>): Map<string, { description: string; schema: Record<string, unknown> }> {
    const out = new Map<string, { description: string; schema: Record<string, unknown> }>();
    if (route === 'anthropic') for (const t of body.tools) out.set(t.name, { description: t.description, schema: t.input_schema });
    else if (route === 'openai') for (const t of body.input.find((i: any) => i.type === 'additional_tools').tools) out.set(t.name, { description: t.description, schema: t.parameters });
    else for (const t of body.tools) out.set(t.function.name, { description: t.function.description, schema: t.function.parameters });
    return out;
  }

  /** The canary appears in no request except as the route's auth header. */
  function expectCanaryOnlyInAuth(route: string, requests: SeenRequest[]) {
    for (const r of requests) {
      expect(JSON.stringify(r.body).includes(CANARY)).toBe(false);
      const carrying = Object.entries(r.headers).filter(([, v]) => v.includes(CANARY));
      expect(carrying).toEqual(route === 'anthropic' ? [['x-api-key', CANARY]] : [['authorization', 'Bearer ' + CANARY]]);
    }
  }

  test('the image runs pi 1.5.0 and carries no state, auth.json or models.json', () => {
    const r = docker(['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', 'pi --version; ls -A /harness-state | wc -l; find / -xdev \\( -name auth.json -o -name models.json \\) -path "*/.pi/*" | wc -l']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split('\n').map((l) => l.trim())).toEqual(['1.5.0', '0', '0', '']);
  });

  const wire: Record<string, (body: Record<string, any>, path: string) => void> = {
    anthropic: (b, path) => {
      expect(path).toBe('/v1/messages');
      expect(b).toMatchObject({ model: MODELS.anthropic, max_tokens: 128000, stream: true, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'medium' } });
      expect(b.messages[0].content.map((c: any) => [c.type, c.text])).toEqual([['text', '- hello [call whoami]']]);
    },
    openai: (b, path) => {
      expect(path).toBe('/v1/responses');
      expect(b).toMatchObject({ model: MODELS.openai, stream: true, max_output_tokens: 128000, reasoning: { effort: 'medium', summary: 'auto' } });
      expect(b.tools).toBeUndefined();
      expect(b.input.map((i: any) => i.type ?? i.role)).toEqual(['additional_tools', 'developer', 'user']);
      expect(b.input.at(-1)).toEqual({ role: 'user', content: [{ type: 'input_text', text: '- hello [call whoami]' }] });
    },
    particle: (b, path) => {
      expect(path).toBe('/v1/chat/completions');
      expect(b).toMatchObject({ model: MODELS.particle, stream: true, stream_options: { include_usage: true }, max_completion_tokens: 128000, reasoning_effort: 'medium' });
      expect(b.max_tokens).toBeUndefined();
      expect(b.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: '- hello [call whoami]' }] });
    },
    openrouter: (b, path) => {
      expect(path).toBe('/v1/chat/completions');
      expect(b).toMatchObject({ model: MODELS.openrouter, stream: true, stream_options: { include_usage: true }, max_completion_tokens: 128000, reasoning: { effort: 'high' } });
      expect(b.max_tokens).toBeUndefined();
      expect(b.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: '- hello [call whoami]' }] });
    },
  };

  for (const route of ROUTES) {
    test(route + ': a run turn that calls the world tool whoami completes; effort medium, the 128000 cap, the world tools as listed, no context file, the canary only in the auth header', async () => {
      const t = trial('- hello [call whoami]');
      const slot = 'run-' + route;
      const prefix = '/' + slot + '/' + route;
      const before = fake.requests.length;
      const r = await runContainer(t, route, slot);
      const requests = fake.requests.slice(before);
      expect(r.status, adapterLog(t) + r.stderr.slice(-2000)).toBe(0);
      expect(r.stdout).toBe('fake reply ' + (before + 2) + '\n');
      expect(requests).toHaveLength(2);
      expect(requests.every((q) => q.method === 'POST' && q.path === requests[0]!.path && q.path.startsWith(prefix))).toBe(true);
      wire[route]!(requests[0]!.body, requests[0]!.path.slice(prefix.length));

      const sent = sentTools(route, requests[0]!.body);
      const builtin = route === 'anthropic' ? ['read', 'bash', 'edit', 'write', '__pi_deferred_placeholder__'] : ['read', 'bash', 'edit', 'write'];
      expect([...sent.keys()].sort()).toEqual([...builtin, ...listed.map((w) => w.name)].sort());
      for (const w of listed) {
        const s = sent.get(w.name)!;
        expect(s.description).toBe(w.description);
        if (route === 'anthropic') {
          const { $schema, ...rest } = w.inputSchema;
          expect($schema).toBe('http://json-schema.org/draft-07/schema#');
          expect(s.schema).toEqual({ type: rest.type, properties: rest.properties, required: rest.required ?? [] });
        } else {
          expect(s.schema).toEqual(w.inputSchema);
        }
      }

      const b = requests[0]!.body;
      const system = JSON.stringify(route === 'anthropic' ? b.system : (b.messages ?? b.input).find((m: any) => !m.type && ['system', 'developer'].includes(m.role)).content);
      expect(system).toContain('You are a coding assistant running inside pi, a coding agent harness.');
      expect(system).not.toContain('<project_instructions');

      const followUp = JSON.stringify(requests[1]!.body);
      expect(followUp).toContain('assistant@pemberline.com');
      expect(followUp).toContain('assistant under test');
      expectCanaryOnlyInAuth(route, requests);
      expect(canaryFiles(t.dir)).toEqual([]);
      expect(JSON.parse(readFileSync(join(t.logs, 'run.status.json'), 'utf8'))).toMatchObject({ pi_exit: 0, stop_reason: 'stop', tool_calls: 1, mcp_transport_errors: 0, thinking_level: route === 'openrouter' ? 'high' : 'medium' });
      rmSync(t.dir, { recursive: true, force: true });
    }, 120_000);
  }

  test('the proxy refusing the model with 403 is exit 3', async () => {
    const t = trial('Say hello.');
    const r = await runContainer(t, 'anthropic', 'refuse403');
    expect(r.status, adapterLog(t)).toBe(3);
    expect(adapterLog(t)).toMatch(/exit 3: model error: 403 /);
    expect(r.stdout).toBe('');
    rmSync(t.dir, { recursive: true, force: true });
  }, 120_000);

  test('serve through the metering proxy, two members and a channel thread: one session per conversation, each member\'s history in that member\'s next turn only, effort medium on the proxy\'s record', async () => {
    const t = trial('');
    const tmp = mkdtempSync(join(tmpdir(), 'he-pi-proxy-'));
    const control = 'control-' + process.pid;
    let proxy: { proc: ReturnType<typeof Bun.spawn>; port: number } | null = null;
    for (let attempt = 0; attempt < 3 && !proxy; attempt++) {
      const probe = Bun.serve({ port: 0, hostname: gateway, fetch: () => new Response() });
      const port = probe.port as number;
      probe.stop(true);
      const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', gateway + ':' + port, '--budget-ledger', join(tmp, 'ledger.sqlite'),
        '--lease-usd', '5', '--run-id', 'pi-test', '--new-run', '--max-output-tokens', '128000', '--allow-models', 'anthropic:' + MODELS.anthropic,
        '--upstream', 'anthropic=http://' + gateway + ':' + fake.port + '/upstream', '--usage-log', join(tmp, 'usage.ndjson'), '--control-token', control],
        { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, ANTHROPIC_API_KEY: 'placeholder-anthropic' }, stdout: 'ignore', stderr: 'pipe' });
      for (let i = 0; i < 100 && !proxy; i++) {
        if (proc.exitCode !== null) break;
        try { await fetch('http://' + gateway + ':' + port + '/__proxy/status'); proxy = { proc, port }; } catch { await Bun.sleep(50); }
      }
      if (!proxy) { proc.kill('SIGKILL'); await proc.exited; }
    }
    if (!proxy) throw new Error('the metering proxy did not start');
    const bound = await fetch('http://' + gateway + ':' + proxy.port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control },
      body: JSON.stringify({ slot: 'pi-test', key: trialKey('pi-test'), token: CANARY }) });
    expect(bound.status).toBe(200);

    const name = 'he-pi-test-serve-' + process.pid;
    const args = containerArgs(t, name, 'anthropic', 'pi-test', 'serve')
      .map((a) => a.startsWith('HE_MODEL_BASE_URL=') ? 'HE_MODEL_BASE_URL=http://host.docker.internal:' + proxy!.port + '/pi-test/anthropic' : a);
    const p = Bun.spawn(['docker', ...args], { env: containerEnv, stdout: 'ignore', stderr: 'ignore' });
    const bodies: string[][] = [];
    const turn = async (req: ReturnType<typeof turnRequest>) => {
      const before = fake.requests.length;
      const resp = await serveTurn(t.turns, req);
      const seen = fake.requests.slice(before);
      bodies.push(seen.map((q) => JSON.stringify(q.body)));
      for (const q of seen) {
        expect(q.path).toBe('/upstream/v1/messages');
        expect(q.headers['x-api-key']).toBe('placeholder-anthropic');
        expect(JSON.stringify(q).includes(CANARY)).toBe(false);
      }
      return resp;
    };
    try {
      const ready = await until(() => existsSync(join(t.logs, 'ready')) ? JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')) : null, 60_000, 'ready');
      expect(ready).toMatchObject({ harness: 'pi', version: '1.5.0', provider: 'anthropic', mcp_servers: 'world', world_tools: listed.length });
      const replies = [
        await turn(turnRequest(1, 'alice', { id: 'D-alice', type: 'dm' }, '[call whoami] The word is plum.')),
        await turn(turnRequest(2, 'bob', { id: 'D-bob', type: 'dm' }, 'What word did alice give you?')),
        await turn(turnRequest(3, 'alice', { id: 'D-alice', type: 'dm' }, 'What was my word?')),
        await turn(turnRequest(4, 'bob', { id: 'C-ops', type: 'channel' }, '- a message that starts with a dash', '1790000000.000100')),
      ];
      expect(replies.map((r) => [r.turn, r.exit])).toEqual([[1, 0], [2, 0], [3, 0], [4, 0]]);
      expect(replies.every((r) => /^fake reply \d+$/.test(r.reply_text))).toBe(true);
      expect(bodies.map((b) => b.length)).toEqual([2, 1, 1, 1]);
      expect(bodies[1]![0]).not.toContain('plum');
      expect(bodies[2]![0]).toContain('The word is plum.');
      expect(bodies[2]![0]).toContain('assistant under test');
      expect(bodies[2]![0]).not.toContain('What word did alice give you?');
      expect(bodies[3]![0]).not.toContain('plum');
      const thread = JSON.parse(bodies[3]![0]!).messages;
      expect(thread.map((m: any) => [m.role, m.content.map((c: any) => c.text)])).toEqual([['user', ['- a message that starts with a dash']]]);
      const sessions = readdirSync(join(t.state, 'pi/sessions')).map((f) => f.replace(/^.*_/, '').replace(/\.jsonl$/, '')).sort();
      expect(sessions).toEqual([sessionUuid('dm:alice'), sessionUuid('dm:bob'), sessionUuid('channel:C-ops:t1790000000.000100')].sort());

      const slow = await turn(turnRequest(5, 'bob', { id: 'D-bob', type: 'dm' }, '[call bash-sleep]', null, 4));
      expect([slow.exit, slow.reply_text, slow.detail]).toEqual([124, null, 'wall clock exceeded (4s)']);
      const ps = docker(['exec', name, 'ps', '-eo', 'args']);
      expect(ps.status).toBe(0);
      expect(ps.stdout).not.toContain('sleep 3031');
      expect(ps.stdout).not.toMatch(/\bpi --mode/);
      const after = await turn(turnRequest(6, 'alice', { id: 'D-alice', type: 'dm' }, 'Still there?'));
      expect(after.exit).toBe(0);

      const usage = readFileSync(join(tmp, 'usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.outcome);
      expect(usage.length).toBe(bodies.flat().length);
      for (const u of usage) {
        expect(u).toMatchObject({ outcome: 'forwarded', provider: 'anthropic', model: MODELS.anthropic, output_config_effort: 'medium', thinking_type: 'adaptive' });
        expect(u.unrecognized_effort_fields).toBeUndefined();
      }
      expect(readFileSync(join(tmp, 'usage.ndjson')).includes(CANARY)).toBe(false);
    } finally {
      docker(['stop', '-t', '10', name]);
      proxy.proc.kill('SIGTERM');
      await proxy.proc.exited;
    }
    expect(await p.exited).toBe(0);
    expect(adapterLog(t)).toContain('serve: stopped on signal');
    expect(canaryFiles(t.dir)).toEqual([]);
    rmSync(t.dir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }, 240_000);
});

describe('the world-MCP extension', () => {
  test('takes the SSE message whose JSON-RPC id equals the request id, not one whose id only starts with it', async () => {
    const answers: Record<string, unknown[]> = {
      initialize: [{ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {} } }],
      'tools/list': [{ jsonrpc: '2.0', id: 20, result: { tools: [] } }, { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'whoami', inputSchema: { type: 'object', properties: {} } }] } }],
      'tools/call': [{ jsonrpc: '2.0', id: 30, result: { content: [{ type: 'text', text: 'decoy' }] } }, { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'dana-okafor' }] } }],
    };
    const server = Bun.serve({ port: 0, async fetch(req) {
      const msg = await req.json() as { id?: number; method: string };
      if (msg.id === undefined) return new Response(null, { status: 202 });
      const body = (answers[msg.method] ?? []).map((m) => 'event: message\ndata: ' + JSON.stringify(m) + '\n\n').join('');
      return new Response(body, { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 's1' } });
    } });
    const saved = { url: process.env.HE_WORLD_MCP_URL, token: process.env.HE_WORLD_MCP_TOKEN };
    process.env.HE_WORLD_MCP_URL = 'http://127.0.0.1:' + server.port + '/mcp';
    process.env.HE_WORLD_MCP_TOKEN = 'placeholder';
    try {
      const registered: Array<{ name: string; execute: (id: string, params: unknown) => Promise<{ content: Array<{ text?: string }> }> }> = [];
      const { default: worldMcp } = await import('../harnesses/pi/extension/world-mcp.ts');
      await worldMcp({ registerTool: (t: (typeof registered)[number]) => registered.push(t) });
      expect(registered.map((t) => t.name)).toEqual(['whoami']);
      expect((await registered[0]!.execute('c1', {})).content[0]!.text).toBe('dana-okafor');
    } finally {
      server.stop(true);
      if (saved.url === undefined) delete process.env.HE_WORLD_MCP_URL; else process.env.HE_WORLD_MCP_URL = saved.url;
      if (saved.token === undefined) delete process.env.HE_WORLD_MCP_TOKEN; else process.env.HE_WORLD_MCP_TOKEN = saved.token;
    }
  });
});
