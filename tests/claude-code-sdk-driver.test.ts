/**
 * H10 (internal-task) PR 4: the Claude Code Agent SDK driver (harnesses/claude-code/sdk-driver.ts), driven through the built image only.
 * Nothing here imports from harnesses/claude-code, and no checkout file is mounted into the container: every case runs the image
 * as built (harness-eval/claude-code:dev, or HE_CLAUDE_CODE_IMAGE), so what it tests is what a trial runs. Without docker or
 * without the image the whole file skips. Keyless throughout: the model is a fake Messages endpoint in this process (the PR 3
 * goldens' shape, tests/instruction-route-cc-codex.test.ts), the world MCP server is the real one on the docker bridge, and the
 * docker client gets PATH and HOME only.
 *
 * Build first: docker build -t harness-eval/claude-code:dev harnesses/claude-code
 *
 * 1. Sessions, records and MCP: sdk-preset+route-tool on cr-01 (three turns in one channel) and cn-02 (a DM resumed): the
 *    adapter's UUIDv5 session id with --session-id on a session's first turn and --resume after; the init record the adapter
 *    reads (CLI 2.1.312, world connected, the same session id); an MCP tool call by name through the world; history carried on
 *    resume; ready names the driver and the SDK version.
 * 2. The system block per driver: the cli driver, sdk-preset and sdk-default on route-skill, one turn each. The captured system
 *    field is recorded (HE_SDK_CAPTURE_OUT writes it in full) and the three are told apart; the brain-first skill listing is in
 *    every request.
 * 3. Timeout: a turn whose model never answers ends at its budget with exit 124 and no driver or CLI process left; the session's
 *    next turn resumes and completes.
 * 4. SIGTERM: to the driver alone (it aborts the query and the SDK stops the CLI: exit 2, no CLI left), and to the container (the
 *    adapter's trap ends the turn with exit 2 and serve exits 0). The CLI's argv, read while the turn hangs, carries the cli
 *    driver's permission mode, disallowed tools, strict MCP config and session id, plus setting sources user.
 * 5. Failure exits: a provider 403 is exit 3; route-system on an SDK driver and configs parseRouteConfig refuses are
 *    HE-ADAPTER-007, exit 2, no ready; the run entry answers on an SDK driver.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRouteConfig, type RouteTurnStatus, type TurnRequest } from '../runner/contracts.ts';
import { containerHostAddress } from '../runner/trial/world.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { world } from './world-helpers.ts';

const ROOT = join(import.meta.dir, '..');
const IMAGE = process.env.HE_CLAUDE_CODE_IMAGE || 'harness-eval/claude-code:dev';
const MODEL = 'claude-opus-5-5';
const CLI_VERSION = '2.1.312';
const SDK_VERSION = '0.3.312';
const DOCKER_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore', env: DOCKER_ENV }).status === 0;
const haveImage = haveDocker && spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', env: DOCKER_ENV }).status === 0;
if (!haveImage) console.log('claude-code-sdk-driver: skipped, ' + (haveDocker ? 'no image ' + IMAGE + ' (docker build -t ' + IMAGE + ' harnesses/claude-code)' : 'no docker'));
const tmp = mkdtempSync(join(tmpdir(), 'he-cc-sdk-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;

/** The adapter's session id: UUIDv5 (URL namespace) of 'harness-evals:claude-code:<key>' (pin.json serve.session_id). */
function uuid5(key: string): string {
  const h = createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')).update('harness-evals:claude-code:' + key).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}

/** The TurnRequests the runner would hand the adapter for a v0.3 dev task (as in the PR 3 goldens), with the adapter's key. */
interface TaskTurn { actor: string; channel: string; thread?: string; text: string }
function requestsFor(task: string, budget = 120): TurnRequest[] {
  const turns = (Bun.TOML.parse(readFileSync(join(ROOT, 'tasks', 'multiuser', 'v0.3', 'dev', task, 'task.toml'), 'utf8')) as { turns: TaskTurn[] }).turns;
  return turns.map((t, i) => {
    const ts = '1790000000.' + String(100 * (i + 1)).padStart(6, '0');
    const channel = t.channel === 'dm' ? { id: 'D' + t.actor.toUpperCase().replace(/-/g, ''), name: 'dm:' + t.actor, type: 'dm' as const } : { id: 'C' + t.channel.toUpperCase().replace(/-/g, ''), name: t.channel, type: 'channel' as const };
    return { turn: i + 1, trial_id: 'sdk', prompt: t.text, actor: { member: t.actor, slack_user_id: 'U' + i, name: t.actor, role: 'member', team: null }, channel, text: t.text, ts,
      thread_ts: t.thread === 'new' ? ts : null, sim_now: '2026-10-29T09:00:00-07:00', time_budget_s: budget };
  });
}
const adapterKey = (r: TurnRequest) => (r.channel.type === 'dm' ? 'dm:' + r.actor.member : 'channel:' + r.channel.id) + (r.thread_ts ? ':t' + r.thread_ts : '');
const windowKey = (r: TurnRequest) => r.channel.id + (r.thread_ts ? ':' + r.thread_ts : '');
const CR01 = 'cr-01-marrow-agrisupply-site-retraction';
const CN02 = 'cn-02-tansleigh-packaging-deadline';

/** Async docker: the fake endpoint serves from this event loop, so spawnSync would starve it. */
async function docker(args: string[], timeoutMs = 120_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe', env: DOCKER_ENV });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [status, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { status, stdout, stderr };
}

/** What the fake model answers a request that offers tools (any other request, such as a title call, gets "ok"). */
type Reply = { text: string } | { tool: string; input: Record<string, unknown> } | { hang: true } | { status: number; message: string };
interface Rec { turn: number; tools: boolean; headers: Record<string, string>; body: Record<string, any> }
interface Fake { port: number; recs: Rec[]; state: { turn: number }; stop: () => void }
function fakeModel(host: string, plan: (rec: Rec, recs: Rec[]) => Reply): Fake {
  const recs: Rec[] = [], state = { turn: 0 };
  const server = Bun.serve({ port: 0, hostname: host, idleTimeout: 0, async fetch(req) {
    if (!new URL(req.url).pathname.endsWith('/v1/messages')) return new Response('{}', { status: 404 });
    const body = await req.json() as Record<string, any>;
    const headers = Object.fromEntries([...req.headers].filter(([k]) => !/^(x-api-key|authorization)$/i.test(k)));
    const rec: Rec = { turn: state.turn, tools: (body.tools ?? []).length > 0, headers, body };
    recs.push(rec);
    const reply: Reply = rec.tools ? plan(rec, recs) : { text: 'ok' };
    if ('hang' in reply) return new Promise<Response>(() => {});
    if ('status' in reply) return Response.json({ type: 'error', error: { type: 'permission_error', message: reply.message } }, { status: reply.status });
    const block = 'tool' in reply ? { type: 'tool_use', id: 'toolu_sdk_' + recs.length, name: reply.tool, input: reply.input } : { type: 'text', text: reply.text };
    const ev: Array<[string, unknown]> = [['message_start', { type: 'message_start', message: { id: 'msg_' + recs.length, type: 'message', role: 'assistant', model: String(body.model ?? ''), content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }]];
    if (block.type === 'tool_use') ev.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { ...block, input: {} } }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify((block as any).input) } }]);
    else ev.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: (block as any).text } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: 0 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]);
    return new Response(ev.map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port as number, recs, state, stop: () => server.stop(true) };
}
const ok: Reply = { text: 'ok' };

interface Dirs { workspace: string; state: string; logs: string; turns: string }
interface Box { name: string; d: Dirs; fake: Fake; log: () => string; ready: () => Record<string, any> | null }

describe.skipIf(!haveImage)('claude-code Agent SDK driver (docker, ' + IMAGE + ', fake Messages endpoint, ' + MODEL + ')', () => {
  let ws: WorldServer;
  let gateway: string;
  const boxes: Box[] = [];
  beforeAll(() => {
    gateway = containerHostAddress();
    ws = createWorldServer({ world, split: 'dev', trialId: 'cc-sdk', eventsPath: null, hostname: gateway, port: 0 });
  });
  afterAll(async () => {
    for (const b of boxes) { await docker(['rm', '-f', b.name]); b.fake.stop(); }
    ws?.stop();
  });

  /** Start the image on an entry with HE_HARNESS_CONFIG set (or not). serve returns once ready exists or the container ended. */
  async function start(config: string | undefined, plan: (rec: Rec, recs: Rec[]) => Reply, entry: 'serve' | 'run' = 'serve', budget = 120): Promise<Box> {
    const fake = fakeModel(gateway, plan);
    const root = join(tmp, 'box-' + ++seq);
    const d: Dirs = { workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
    for (const p of Object.values(d)) mkdirSync(p, { recursive: true });
    writeFileSync(join(d.workspace, 'instruction.md'), 'Say ok.\n');
    const name = 'he-cc-sdk-' + process.pid + '-' + seq;
    const env: Record<string, string> = { HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_SESSION_STATE_DIR: '/harness-state', HE_TRIAL_ID: name, HE_TASK_SLICE: entry === 'run' ? 'smoke' : 'multiuser',
      HE_TIME_BUDGET_S: String(budget), HE_MODEL_BASE_URL: 'http://host.docker.internal:' + fake.port + '/sdk/anthropic', HE_MODEL_API_KEY: 'trial-token:sdk.0123456789abcdef0123456789abcdef', HE_MODEL_NAME: MODEL,
      HE_WORLD_MCP_URL: 'http://host.docker.internal:' + new URL(ws.url).port + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token, ...(config !== undefined ? { HE_HARNESS_CONFIG: config } : {}) };
    const args = ['run', '-d', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
      '-v', d.workspace + ':/workspace', '-v', d.state + ':/harness-state', '-v', d.logs + ':/he-logs', '-v', d.turns + ':/he-turns'];
    for (const [k, v] of Object.entries(env)) args.push('-e', k + '=' + v);
    const box: Box = { name, d, fake,
      log: () => ['adapter.log', 'stderr.log'].map((f) => (existsSync(join(d.logs, f)) ? readFileSync(join(d.logs, f), 'utf8') : '')).join('\n').slice(-4000),
      ready: () => (existsSync(join(d.logs, 'ready')) ? JSON.parse(readFileSync(join(d.logs, 'ready'), 'utf8')) : null) };
    boxes.push(box);
    const started = await docker([...args, IMAGE, entry]);
    expect(started.status, started.stderr).toBe(0);
    if (entry === 'serve') {
      const deadline = Date.now() + 120_000;
      while (!box.ready() && (await running(name)) && Date.now() < deadline) await Bun.sleep(100);
    }
    return box;
  }
  const running = async (name: string) => (await docker(['inspect', '-f', '{{.State.Running}}', name])).stdout.trim() === 'true';
  async function exited(name: string, ms = 60_000): Promise<number | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const s = (await docker(['inspect', '-f', '{{.State.Running}} {{.State.ExitCode}}', name])).stdout.trim().split(' ');
      if (s[0] === 'false') return Number(s[1]);
      await Bun.sleep(200);
    }
    return null;
  }
  /** Post one TurnRequest and wait for its response. */
  async function turn(box: Box, q: TurnRequest, ms = 180_000): Promise<{ exit: number; reply_text: string | null; detail?: string }> {
    box.fake.state.turn = q.turn;
    const f = join(box.d.turns, 'turn-' + String(q.turn).padStart(4, '0'));
    writeFileSync(f + '.request.json.tmp', JSON.stringify(q));
    renameSync(f + '.request.json.tmp', f + '.request.json');
    const deadline = Date.now() + ms;
    while (!existsSync(f + '.response.json') && Date.now() < deadline) await Bun.sleep(100);
    expect(existsSync(f + '.response.json'), box.log()).toBe(true);
    return JSON.parse(readFileSync(f + '.response.json', 'utf8'));
  }
  const turnFile = (box: Box, n: number, ext: string) => join(box.d.logs, 'turns', 'turn-' + String(n).padStart(4, '0') + '.' + ext);
  /** Processes in the container, one "pid args" line each. */
  const ps = async (box: Box) => (await docker(['exec', box.name, 'ps', '-eo', 'pid,args'])).stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const turnProcs = (lines: string[]) => lines.filter((l) => /sdk-driver\.ts|\/opt\/harness\/bin\/claude|claude\.exe/.test(l));
  async function until(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (await cond()) return true; await Bun.sleep(100); }
    return false;
  }

  test('sessions, records and MCP: session id then resume on cr-01 and cn-02, the init record, an MCP call through the world, history carried', async () => {
    for (const task of [CR01, CN02]) {
      const reqs = requestsFor(task);
      const box = await start('sdk-preset+route-tool', (rec, recs) => (rec.turn === 1 && recs.filter((r) => r.tools).length === 1 ? { tool: 'mcp__world__whoami', input: {} } : ok));
      expect(box.ready(), box.log()).toMatchObject({ harness: 'claude-code', version: CLI_VERSION, mcp_servers: 'world', sdk: { driver: 'sdk-preset', agent_sdk_version: SDK_VERSION, claude: '/opt/harness/bin/claude' },
        instruction_route: { config: 'sdk-preset+route-tool', driver: 'sdk-preset', route: 'route-tool' } });
      const seen = new Map<string, number>();
      for (const q of reqs) {
        const r = await turn(box, q);
        expect(r, box.log()).toMatchObject({ exit: 0, reply_text: 'ok' });
        const key = adapterKey(q), n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        expect(box.log()).toContain('session ' + key + ': ' + (n === 1 ? '--session-id ' : '--resume ') + uuid5(key));
        expect(JSON.parse(readFileSync(turnFile(box, q.turn, 'status.json'), 'utf8'))).toMatchObject({ claude_exit: 0, claude_code_version: CLI_VERSION, mcp_servers: { world: 'connected' }, session_id: uuid5(key), is_error: false, mcp_transport_errors: 0 });
        expect(JSON.parse(readFileSync(turnFile(box, q.turn, 'route.json'), 'utf8')) as RouteTurnStatus).toEqual({ config: 'sdk-preset+route-tool', driver: 'sdk-preset', route: 'route-tool', session_key: windowKey(q), session_turn: n, emitted: null });
        const lines = readFileSync(turnFile(box, q.turn, 'claude.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        expect(lines[0]).toMatchObject({ type: 'system', subtype: 'init', claude_code_version: CLI_VERSION, session_id: uuid5(key), model: MODEL });
        expect(lines.at(-1)).toMatchObject({ type: 'result', is_error: false, result: 'ok', session_id: uuid5(key) });
        // A resumed turn's requests carry the session's earlier prompts; a session's first turn carries none of another session's.
        const asked = box.fake.recs.filter((x) => x.tools && x.turn === q.turn);
        expect(asked.length).toBeGreaterThan(0);
        for (const x of asked) {
          expect(x.body.model).toBe(MODEL);
          const text = JSON.stringify(x.body.messages);
          for (const p of reqs.slice(0, q.turn - 1)) expect(text.includes(JSON.stringify(p.prompt).slice(1, -1)), task + ' turn ' + q.turn).toBe(adapterKey(p) === key);
        }
      }
      // Turn 1's MCP call went through the world and came back as a tool result that is not an error.
      const follow = box.fake.recs.filter((x) => x.tools && x.turn === 1)[1]!;
      const result = (follow.body.messages as any[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b: any) => b.type === 'tool_result');
      expect(result?.is_error ?? false).toBe(false);
      expect(JSON.stringify(result?.content)).toContain('assistant under test');
    }
  }, 600_000);

  test('the system block per driver: cli, sdk-preset and sdk-default on route-skill, the skill listing in each', async () => {
    const q = requestsFor(CN02)[0]!;
    interface Capture { system: string[]; user_agent: string | null; listing_in: string[]; tool_names: string[]; max_tokens: unknown; body: Record<string, any> }
    const capture: Record<string, Capture> = {};
    const CONFIGS = ['route-skill', 'sdk-preset+route-skill', 'sdk-default+route-skill'] as const;
    for (const config of CONFIGS) {
      const box = await start(config, () => ok);
      expect(await turn(box, q), box.log()).toMatchObject({ exit: 0 });
      const first = box.fake.recs.find((x) => x.tools)!;
      capture[config] = { system: (first.body.system ?? []).map((s: any) => String(s.text)), user_agent: first.headers['user-agent'] ?? null,
        listing_in: (['system', 'messages', 'tools'] as const).filter((k) => JSON.stringify(first.body[k] ?? '').includes('brain-first')),
        tool_names: (first.body.tools as any[]).map((t) => String(t.name)), max_tokens: first.body.max_tokens, body: first.body };
    }
    if (process.env.HE_SDK_CAPTURE_OUT) writeFileSync(process.env.HE_SDK_CAPTURE_OUT, JSON.stringify(capture, null, 1) + '\n');
    console.log('SDK_SYSTEM_CAPTURE ' + JSON.stringify(Object.fromEntries(Object.entries(capture).map(([k, v]) => [k, { blocks: v.system.map((s) => s.length), heads: v.system.map((s) => s.slice(0, 80)), user_agent: v.user_agent, listing_in: v.listing_in, tools: v.tool_names.length, max_tokens: v.max_tokens }]))));
    const [cli, preset, stub] = CONFIGS.map((c) => capture[c]!);
    const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
    const BILLING_HEADER_NAME_SHA256 = '0385b570c92841a6d2f4f2c00eefcfd50672878b8e471e2ace10e34bffc39614';
    const IDENTITY_SHA256 = '0d7062851dd7bd7e66d4be4f12ac4951e3d2f587ec408295333a49963bd3f6b7';
    const expectBilling = (block: string, entry: string) => {
      const colon = block.indexOf(': ');
      expect(colon).toBeGreaterThan(0);
      expect(sha256(block.slice(0, colon))).toBe(BILLING_HEADER_NAME_SHA256);
      expect(block.slice(colon + 2)).toMatch(new RegExp('^cc_version=' + CLI_VERSION.replace(/\./g, '\\.') + '\\.[0-9a-f]+; cc_entrypoint=' + entry + ';$'));
    };
    // cli: billing header (cc_entrypoint=sdk-cli), the identity line, then the guidance block with the skill rule internal-task sized.
    expect(cli.system).toHaveLength(3);
    expectBilling(cli.system[0]!, 'sdk-cli');
    expect(sha256(cli.system[1]!.trim())).toBe(IDENTITY_SHA256);
    expect(cli.system[2]).toContain('When the user types `/<skill-name>`, invoke it via Skill.');
    expect(cli.system[2]!.length).toBe(6210);
    expect(cli.user_agent).toBe('claude-cli/' + CLI_VERSION + ' (external, sdk-cli)');
    // sdk-preset: the same identity line and guidance block byte for byte; only the entrypoint in the billing header and the user agent differ.
    expect(preset.system).toHaveLength(3);
    expectBilling(preset.system[0]!, 'sdk-ts');
    expect(preset.system.slice(1)).toEqual(cli.system.slice(1));
    expect(preset.user_agent).toBe('claude-cli/' + CLI_VERSION + ' (external, sdk-ts, agent-sdk/' + SDK_VERSION + ')');
    // sdk-default: the stub, the billing header and the identity line with no guidance block.
    expect(stub.system).toHaveLength(2);
    expect(stub.system[0]).toBe(preset.system[0]!);
    expect(stub.system[1]).toBe(cli.system[1]!);
    expect(stub.user_agent).toBe(preset.user_agent);
    // Three different system fields. Everything else in the request is the same under all three drivers but one tool text: the
    // Bash tool's run_in_background default timeout reads 600000 under the cli driver and 1800000 under the SDK. The messages,
    // with the skill listing (a system-reminder in the first user message), are byte-identical.
    expect(new Set(CONFIGS.map((c) => JSON.stringify(capture[c]!.system))).size).toBe(3);
    for (const v of [preset, stub]) {
      expect(v.tool_names).toEqual(cli.tool_names);
      expect(JSON.stringify(v.body.tools)).toBe(JSON.stringify(cli.body.tools).replaceAll('default 600000', 'default 1800000'));
      expect(JSON.stringify(v.body.tools)).not.toBe(JSON.stringify(cli.body.tools));
      expect(v.body.messages).toEqual(cli.body.messages);
      for (const k of ['model', 'max_tokens', 'thinking', 'output_config', 'context_management']) expect(v.body[k]).toEqual(cli.body[k]);
      expect(v.listing_in).toEqual(cli.listing_in);
    }
    expect(cli.listing_in).toEqual(['messages']);
    expect(JSON.stringify(cli.body.messages)).toContain('The following skills are available for use with the Skill tool:\\n\\n- brain-first: Check GBrain first, before answering any turn.');
  }, 600_000);

  test('timeout: a turn whose model never answers ends at its budget with exit 124 and no driver or CLI left; the next turn resumes', async () => {
    let hang = true;
    const box = await start('sdk-default+route-tool', () => (hang ? { hang: true } : ok));
    const [q1, q2] = requestsFor(CR01, 6);
    const t0 = Date.now();
    const r = await turn(box, q1!);
    expect(r, box.log()).toMatchObject({ exit: 124, reply_text: null, detail: 'wall clock exceeded (6s)' });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(turnProcs(await ps(box))).toEqual([]);
    hang = false;
    const r2 = await turn(box, { ...q2!, time_budget_s: 120 });
    expect(r2, box.log()).toMatchObject({ exit: 0, reply_text: 'ok' });
    expect(box.log()).toContain('session ' + adapterKey(q2!) + ': --resume ' + uuid5(adapterKey(q2!)));
  }, 300_000);

  test('SIGTERM: the driver forwards it to the CLI (exit 2, nothing left), and the container stops serving on it', async () => {
    const box = await start('sdk-preset+route-tool', () => ({ hang: true }));
    const q = requestsFor(CR01)[0]!;
    const pending = turn(box, q);
    expect(await until(() => box.fake.recs.some((x) => x.tools), 60_000), box.log()).toBe(true);
    // The CLI the SDK started, read while the turn hangs: the cli driver's settings plus setting sources user.
    const procs = turnProcs(await ps(box));
    const cliLine = procs.find((l) => !l.includes('sdk-driver.ts'))!;
    expect(procs.some((l) => l.includes('node --disable-warning=ExperimentalWarning /opt/harness/sdk-driver.ts --driver sdk-preset --claude /opt/harness/bin/claude --model ' + MODEL + ' --mcp-config /harness-state/mcp.json --session-id ' + uuid5(adapterKey(q)))), procs.join('\n')).toBe(true);
    for (const want of ['/opt/harness/bin/claude --output-format stream-json --verbose --input-format stream-json', '--model=' + MODEL, '--disallowedTools=WebSearch,WebFetch', '--setting-sources=user',
      '--strict-mcp-config', '--permission-mode=bypassPermissions', '--allow-dangerously-skip-permissions', '--session-id=' + uuid5(adapterKey(q)), '--mcp-config /harness-state/mcp.json']) expect(cliLine, procs.join('\n')).toContain(want);
    console.log('SDK_CLI_ARGV ' + cliLine.replace(/^\d+ /, ''));
    expect(cliLine).not.toContain('--system-prompt');
    // SIGTERM to the driver alone: it aborts the query, the SDK stops the CLI, and the turn ends without a result record.
    const pid = procs.find((l) => l.includes('sdk-driver.ts'))!.split(' ')[0]!;
    expect((await docker(['exec', box.name, 'kill', '-TERM', pid])).status).toBe(0);
    const r = await pending;
    expect(r.exit).toBe(2);
    expect(r.detail).toContain('no result record (claude exit 143)');
    expect(readFileSync(turnFile(box, 1, 'stderr.log'), 'utf8')).toContain('sdk-driver: SIGTERM, aborting the query');
    expect(await until(async () => turnProcs(await ps(box)).length === 0, 15_000)).toBe(true);
    // SIGTERM to the container mid-turn: the adapter's trap stops the turn's session, answers exit 2 and serve exits 0.
    const q2 = requestsFor(CR01)[1]!;
    const pending2 = turn(box, q2);
    expect(await until(() => box.fake.recs.filter((x) => x.tools).length >= 2, 60_000), box.log()).toBe(true);
    expect((await docker(['kill', '-s', 'TERM', box.name])).status).toBe(0);
    const r2 = await pending2;
    expect(r2).toMatchObject({ exit: 2, detail: 'stopped by SIGTERM during the turn' });
    expect(await exited(box.name, 30_000)).toBe(0);
    expect(box.log()).toContain('serve: stopped on signal');
  }, 300_000);

  test('failure exits: a provider 403 is exit 3; refused configs are HE-ADAPTER-007, exit 2, no ready, as parseRouteConfig refuses them; run answers', async () => {
    const box = await start('sdk-preset+route-tool', () => ({ status: 403, message: 'lease refused' }));
    const r = await turn(box, requestsFor(CN02)[0]!);
    expect(r.exit, box.log()).toBe(3);
    expect(r.detail).toContain('model error: API 403');
    expect(JSON.parse(readFileSync(turnFile(box, 1, 'status.json'), 'utf8'))).toMatchObject({ is_error: true, api_error_status: 403, claude_code_version: CLI_VERSION });
    // route-system is refused on the SDK drivers by the adapter (parseRouteConfig accepts it: support is the adapter's call);
    // the rest are configs parseRouteConfig itself refuses.
    for (const [config, why] of [['sdk-preset+route-system', 'H10 runs route-system on the cli driver only'], ['sdk-default+route-system', 'H10 runs route-system on the cli driver only'],
      ['nope+route-tool', 'names no known driver'], ['sdk-preset+route-hook@x', 'gives a slot id'], ['sdk-default+route-slot-skill', 'needs @<slot_id>']] as const) {
      const parsed = (() => { try { parseRouteConfig(config, 'claude-code'); return 'accepted'; } catch (e) { return (e as Error).message; } })();
      if (!config.endsWith('route-system')) expect(parsed).toStartWith('HE-ADAPTER-007 HE_HARNESS_CONFIG=' + config + ' ' + why);
      else expect(parsed).toBe('accepted');
      const refused = await start(config, () => ok);
      expect(await exited(refused.name)).toBe(2);
      expect(refused.ready()).toBeNull();
      expect(refused.log()).toContain('HE-ADAPTER-007 HE_HARNESS_CONFIG=' + config);
      expect(refused.log()).toContain(why);
      expect(refused.fake.recs).toEqual([]);
    }
    // The run entry on an SDK driver: one turn, the reply on stdout, exit 0.
    const run = await start('sdk-default+route-tool', () => ok, 'run');
    expect(await exited(run.name, 120_000), run.log()).toBe(0);
    expect(readFileSync(join(run.d.logs, 'stdout.log'), 'utf8')).toContain('ok');
    expect(JSON.parse(readFileSync(join(run.d.logs, 'run.status.json'), 'utf8'))).toMatchObject({ claude_exit: 0, claude_code_version: CLI_VERSION, session_id: uuid5('run:' + run.name) });
    expect(JSON.parse(readFileSync(join(run.d.logs, 'run.route.json'), 'utf8'))).toMatchObject({ driver: 'sdk-default', route: 'route-tool', session_turn: 1 });
  }, 600_000);
});
