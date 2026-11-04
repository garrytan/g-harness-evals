// Adapter protocol conformance, proven on the fake harness (harnesses/_fake).
// The protocol is docs/adapters.md. Two layers:
//   1. process level, always on: the adapter script runs in temp directories
//      with HE_WORKSPACE_DIR / HE_SESSION_STATE_DIR / HE_LOG_DIR pointed at
//      them, stdin closed and no TTY; exit codes and file placement are checked.
//   2. container level, when docker is available: the fake image runs with the
//      three mounts, and `docker diff` proves the container filesystem outside
//      those mounts is untouched.
// Both layers also cover `serve`: the ready file, TurnRequest -> TurnResponse
// through the file queue, the exit mapping per turn, a world-MCP call landing
// in an in-process world's event log, and a clean stop on SIGTERM.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TurnRequest, TurnResponse } from '../runner/contracts.ts';
import { trialKey } from '../runner/trial/proxy.ts';
import type { WorldServer } from '../world/services/server.ts';
import { startWorld } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const ADAPTER = join(ROOT, 'harnesses/_fake/adapter.sh');
const HELLO = readFileSync(join(ROOT, 'tasks/hello/instruction.md'), 'utf8');

interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string }

function trial(instruction: string): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-conformance-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns') };
  for (const d of [t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
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

function runProcess(t: Trial, env: Record<string, string> = {}) {
  // stdin is closed ('ignore') and nothing is a TTY: the protocol forbids prompting.
  return spawnSync('bash', [ADAPTER, 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HE_WORKSPACE_DIR: t.workspace,
      HE_SESSION_STATE_DIR: t.state,
      HE_LOG_DIR: t.logs,
      HE_MODEL_BASE_URL: 'http://127.0.0.1:1/anthropic',
      HE_MODEL_API_KEY: trialKey('test'),
      HE_MODEL_NAME: 'none',
      HE_TIME_BUDGET_S: '10',
      HE_TASK_SLICE: 'smoke',
      HE_TRIAL_ID: 'conformance',
      ...env,
    },
  });
}

describe('fake adapter, process level', () => {
  test('completes the hello task with exit 0, stdin closed and no TTY', () => {
    const t = trial(HELLO);
    const r = runProcess(t);
    expect(r.status).toBe(0);
    expect(readFileSync(join(t.workspace, 'hello.txt'), 'utf8')).toBe('hello');
    expect(spawnSync(join(ROOT, 'tasks/hello/grader/check.sh'), [t.workspace]).status).toBe(0);
  });

  test('writes nothing but the workspace, the state dir and the log dir', () => {
    const t = trial(HELLO);
    expect(runProcess(t).status).toBe(0);
    expect(tree(t.dir)).toEqual([
      'logs', 'logs/adapter.log', 'logs/stderr.log', 'logs/stdout.log',
      'state', 'state/fake', 'state/fake/session.json',
      'turns',
      'workspace', 'workspace/hello.txt', 'workspace/instruction.md',
    ]);
  });

  test('keeps session state in HE_SESSION_STATE_DIR, not in the workspace', () => {
    const t = trial(HELLO);
    runProcess(t);
    const session = JSON.parse(readFileSync(join(t.state, 'fake/session.json'), 'utf8'));
    expect(session.trial).toBe('conformance');
    expect(existsSync(join(t.workspace, 'fake'))).toBe(false);
  });

  test('captures stdout and stderr under HE_LOG_DIR', () => {
    const t = trial(HELLO);
    runProcess(t);
    expect(readFileSync(join(t.logs, 'stdout.log'), 'utf8')).toContain('fake turn complete');
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('completed');
  });

  test('a no-op instruction leaves the workspace unchanged', () => {
    const t = trial('Do nothing.');
    expect(runProcess(t).status).toBe(0);
    expect(tree(t.workspace)).toEqual(['instruction.md']);
  });

  test('exit 2 on a harness error', () => {
    const t = trial('[fake:harness_error] ' + HELLO);
    expect(runProcess(t).status).toBe(2);
    expect(existsSync(join(t.workspace, 'hello.txt'))).toBe(false);
  });

  test('exit 2 when instruction.md is missing', () => {
    const t = trial(HELLO);
    writeFileSync(join(t.workspace, 'instruction.md'), '');
    spawnSync('rm', [join(t.workspace, 'instruction.md')]);
    expect(runProcess(t).status).toBe(2);
  });

  test('exit 2 for an entry point other than run or serve', () => {
    const t = trial(HELLO);
    const r = spawnSync('bash', [ADAPTER, 'watch'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs } });
    expect(r.status).toBe(2);
  });

  test('exit 3 on a model error', () => {
    const t = trial('[fake:model_error] ' + HELLO);
    expect(runProcess(t).status).toBe(3);
  });

  test('exit 124 when the turn outlives HE_TIME_BUDGET_S', () => {
    const t = trial('[fake:sleep 5] ' + HELLO);
    const r = runProcess(t, { HE_TIME_BUDGET_S: '1' });
    expect(r.status).toBe(124);
    expect(existsSync(join(t.workspace, 'hello.txt'))).toBe(false);
  });
});


// ---- serve ------------------------------------------------------------------------------------------

const SERVE_ENV = (t: Trial): Record<string, string> => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HE_WORKSPACE_DIR: t.workspace,
  HE_SESSION_STATE_DIR: t.state,
  HE_LOG_DIR: t.logs,
  HE_TURNS_DIR: t.turns,
  HE_MODEL_BASE_URL: 'http://127.0.0.1:1/anthropic',
  HE_MODEL_API_KEY: trialKey('test'),
  HE_MODEL_NAME: 'none',
  HE_TIME_BUDGET_S: '10',
  HE_TASK_SLICE: 'multiuser',
  HE_TRIAL_ID: 'conformance-serve',
});

function request(turn: number, over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    turn,
    trial_id: 'conformance-serve',
    prompt: `You are the workspace bot. Dana Okafor asks: hello?`,
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

/** Write a TurnRequest the way the runner does: whole file, then rename into place. */
function postRequest(t: Trial, req: TurnRequest): string {
  const name = `turn-${String(req.turn).padStart(4, '0')}`;
  writeFileSync(join(t.turns, `${name}.request.json.tmp`), JSON.stringify(req));
  renameSync(join(t.turns, `${name}.request.json.tmp`), join(t.turns, `${name}.request.json`));
  return name;
}

async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

async function response(t: Trial, turn: number, ms = 15_000): Promise<TurnResponse> {
  const path = join(t.turns, `turn-${String(turn).padStart(4, '0')}.response.json`);
  await waitFor(() => existsSync(path), ms, `response for turn ${turn}`);
  return JSON.parse(readFileSync(path, 'utf8')) as TurnResponse;
}

async function stop(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
  child.kill('SIGTERM');
  return await Promise.race([exited, Bun.sleep(5_000).then(() => 'hung' as const)]).then((v) => {
    if (v === 'hung') { child.kill('SIGKILL'); throw new Error('serve did not stop within 5 s of SIGTERM'); }
    return v;
  });
}

describe('fake adapter, serve, process level', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('conformance-serve'); });
  afterAll(() => { ws.stop(); });

  function startServe(t: Trial, extra: Record<string, string> = {}): ChildProcess {
    return spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...SERVE_ENV(t), ...extra } });
  }

  test('writes the ready file, answers requests in order with per-session keys, and stops on SIGTERM', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'))).toMatchObject({ harness: '_fake', trial: 'conformance-serve' });
      // internal-task: the ready file carries the sha256 of the adapter file that ran (what preflight checks against the image, HE-ADAPTER-005).
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')).adapter_sha256).toBe(createHash('sha256').update(readFileSync(ADAPTER)).digest('hex'));
      expect(tree(t.turns)).toEqual([]);

      postRequest(t, request(1));
      const r1 = await response(t, 1);
      expect(r1).toMatchObject({ turn: 1, exit: 0 });
      expect(r1.reply_text).toContain('Hi Dana Okafor');
      expect(r1.reply_text).toContain('session dm:dana-okafor');
      expect(Date.parse(r1.ended_at)).toBeGreaterThanOrEqual(Date.parse(r1.started_at));

      postRequest(t, request(2, {
        actor: { member: 'ilse-varga', slack_user_id: 'U0ILSE', name: 'Ilse Varga', role: 'Engineer', team: 'team-south' },
        channel: { id: 'C0NORTH', name: 'north-team', type: 'channel' }, text: 'status?',
      }));
      const r2 = await response(t, 2);
      expect(r2.exit).toBe(0);
      expect(r2.reply_text).toContain('Hi Ilse Varga');
      expect(r2.reply_text).toContain('session channel:C0NORTH');

      postRequest(t, request(3));
      const r3 = await response(t, 3);
      expect(r3.reply_text).toContain('turn 2 of this session');

      // internal-task: a thread turn (thread_ts set) is a new session in the same conversation, keyed dm:<member>:t<ts>.
      postRequest(t, request(4, { ts: '1700000400.000100', thread_ts: '1700000400.000100' }));
      const r4 = await response(t, 4);
      expect(r4.exit).toBe(0);
      expect(r4.reply_text).toContain('session dm:dana-okafor:t1700000400.000100');
      expect(r4.reply_text).toContain('turn 1 of this session');

      // Nothing outside the four writable places: workspace untouched, responses only in the turns dir.
      expect(tree(t.workspace)).toEqual(['instruction.md']);
      expect(tree(t.turns).filter((p) => p.endsWith('.response.json'))).toEqual([
        'turn-0001.response.json', 'turn-0002.response.json', 'turn-0003.response.json', 'turn-0004.response.json',
      ]);
      expect(tree(t.turns).some((p) => p.endsWith('.tmp'))).toBe(false);
      expect(tree(t.state)).toEqual([
        'fake', 'fake/session.json', 'fake/sessions', 'fake/sessions/channel_C0NORTH.json', 'fake/sessions/dm_dana-okafor.json', 'fake/sessions/dm_dana-okafor_t1700000400.000100.json',
      ]);
      expect(readdirSync(t.dir).sort()).toEqual(['logs', 'state', 'turns', 'workspace']);
    } finally {
      expect(await stop(child)).toBe(0);
    }
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('stopped on signal');
  }, 30_000);

  test('maps a turn that outlives its budget to 124, a model error to 3 and a harness error to 2, and keeps serving', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
      postRequest(t, request(1, { prompt: '[fake:sleep 5] hello', time_budget_s: 2 }));
      const r1 = await response(t, 1);
      expect(r1).toMatchObject({ turn: 1, exit: 124, reply_text: null });
      expect(Date.parse(r1.ended_at) - Date.parse(r1.started_at)).toBeLessThan(5_000);

      postRequest(t, request(2, { prompt: '[fake:model_error] hello' }));
      expect(await response(t, 2)).toMatchObject({ turn: 2, exit: 3, reply_text: null });

      postRequest(t, request(3, { prompt: '[fake:harness_error] hello' }));
      expect(await response(t, 3)).toMatchObject({ turn: 3, exit: 2, reply_text: null });

      postRequest(t, request(4));
      expect((await response(t, 4)).exit).toBe(0);
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 30_000);

  test('a [fake:call] marker makes a world-MCP call as the bot that lands in the event log', async () => {
    const t = trial('');
    const child = startServe(t, { HE_WORLD_MCP_URL: `${ws.url}/mcp`, HE_WORLD_MCP_TOKEN: ws.credentials.bot.token });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
      const before = ws.log.events.length;
      const channel = ws.service.channelsFor(ws.service.bot!, 'mcp').find((c) => c.kind !== 'dm')!;
      postRequest(t, request(1, { prompt: `hello\n[fake:call post_message {"channel":"${channel.id}","text":"fake bot post for conformance"}]\n` }));
      const r1 = await response(t, 1);
      expect(r1.exit).toBe(0);
      const posted = ws.log.events.slice(before).find((e) => e.tool === 'chat.postMessage');
      expect(posted).toMatchObject({ actor: 'assistant', via: 'mcp', kind: 'write', outcome: 'ok' });
      expect((posted!.args as { text: string }).text).toBe('fake bot post for conformance');
      const messages = (ws.service.snapshot() as { messages: Array<{ text: string; channel: string }> }).messages;
      expect(messages.some((m) => m.text === 'fake bot post for conformance' && m.channel === channel.id)).toBe(true);
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 30_000);

  test('SIGTERM during a turn stops the harness turn and exits within seconds', async () => {
    const t = trial('');
    const child = startServe(t);
    await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
    postRequest(t, request(1, { prompt: '[fake:sleep 20] hello', time_budget_s: 30 }));
    // adapter.log appears a moment after the ready file; a missing file means "not yet", not a failure.
    const adapterLog = join(t.logs, 'adapter.log');
    await waitFor(() => existsSync(adapterLog) && readFileSync(adapterLog, 'utf8').includes('turn 1: session'), 5_000, 'turn start');
    const began = Date.now();
    expect(await stop(child)).toBe(0);
    expect(Date.now() - began).toBeLessThan(4_000);
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('SIGTERM during the turn');
  }, 30_000);

  // Value: protects=a serve that has handled no turn yet exits 0 and logs "stopped on signal" on SIGTERM;
  // fails_when=the TERM trap reads tpid before serve scope initialises it (set -u aborts the trap, exit 1) or kills
  // an empty pid without the -n guard (errexit in the trap, exit 1); why_new=the other stop tests send SIGTERM only
  // after turns ran, when tpid has been assigned and cleared, so a loop-local tpid passes them and fails only here;
  // seam=none; no_claim=does not force the SIGTERM-between-spawn-and-wait window the trap's kill exists for.
  test('SIGTERM before the first turn stops an idle serve cleanly', async () => {
    const t = trial('');
    const child = startServe(t);
    await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
    expect(tree(t.turns)).toEqual([]);
    expect(await stop(child)).toBe(0);
    expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('stopped on signal');
    expect(readFileSync(join(t.logs, 'stderr.log'), 'utf8')).not.toContain('unbound variable');
  }, 30_000);

  test('a [fake:gbrain] marker calls gbrain through the world tap and lands as a via gbrain event inside the turn', async () => {
    // A fake sidecar speaking gbrain's wire shape: SSE-framed JSON-RPC, bearer token required.
    const GBRAIN_TOKEN = 'gbrain_' + 'cd'.repeat(32);
    const upstream = Bun.serve({
      port: 0, hostname: '127.0.0.1',
      async fetch(req) {
        if (req.headers.get('authorization') !== `Bearer ${GBRAIN_TOKEN}`) return Response.json({ error: 'invalid_token' }, { status: 401 });
        const body = await req.json() as { id: number; method: string; params?: { name: string } };
        const result = body.method === 'tools/list'
          ? { tools: Array.from({ length: 33 }, (_, i) => ({ name: `t${i}` })) }
          : { content: [{ type: 'text', text: JSON.stringify([{ slug: 'dev/chats/north-team-random', title: '#north-random' }]) }] };
        return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN });
    const t = trial('');
    const child = startServe(t, { HE_WORLD_MCP_URL: `${ws.url}/mcp`, HE_WORLD_MCP_TOKEN: ws.credentials.bot.token, HE_GBRAIN_MCP_URL: `${ws.url}/gbrain`, HE_GBRAIN_MCP_TOKEN: ws.credentials.bot.token });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')).gbrain_mcp).toBe(true);
      const startedSeq = ws.log.events.length;
      postRequest(t, request(1, { prompt: 'hello\n[fake:gbrain tools/list {}]\n[fake:gbrain search {"query":"ticket 4092","limit":3}]\n' }));
      const r1 = await response(t, 1);
      expect(r1.exit).toBe(0);
      const endedSeq = ws.log.events.length;
      const mine = ws.log.events.filter((e) => e.via === 'gbrain' && e.seq > startedSeq && e.seq <= endedSeq);
      expect(mine.map((e) => e.tool)).toEqual(['gbrain.tools/list', 'gbrain.search']);
      expect(mine[0]).toMatchObject({ actor: 'assistant', kind: 'read', outcome: 'ok', effect: { pages: [], count: 33 } });
      expect(mine[1]).toMatchObject({ actor: 'assistant', kind: 'read', outcome: 'ok', args: { query: 'ticket 4092', limit: 3 }, effect: { pages: ['dev/chats/north-team-random'], count: 1 } });
      expect(readFileSync(join(t.logs, 'gbrain-calls.jsonl'), 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    } finally {
      ws.setGbrain(null);
      upstream.stop(true);
      expect(await stop(child)).toBe(0);
    }
  }, 30_000);

  test('a [fake:call] marker without a world is a harness error for that turn, not a crash', async () => {
    const t = trial('');
    const child = startServe(t);
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 5_000, 'ready file');
      postRequest(t, request(1, { prompt: '[fake:call whoami {}]' }));
      expect(await response(t, 1)).toMatchObject({ exit: 2, reply_text: null });
      expect(child.exitCode).toBeNull();
    } finally {
      expect(await stop(child)).toBe(0);
    }
  }, 30_000);
});

const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
const haveDocker = docker.status === 0;
const IMAGE = 'harness-eval/fake:dev';

describe.skipIf(!haveDocker)('fake adapter, container level', () => {
  test('image builds and a stdin-closed run touches nothing outside the mounts', () => {
    const build = spawnSync('docker', ['build', '-q', '-t', IMAGE, join(ROOT, 'harnesses/_fake')], { encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);

    const t = trial(HELLO);
    const name = `he-conformance-${process.pid}`;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const run = spawnSync('docker', [
      'run', '-i', '--name', name, '--network', 'none',
      '-v', `${t.workspace}:/workspace`, '-v', `${t.state}:/harness-state`, '-v', `${t.logs}:/he-logs`,
      '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TIME_BUDGET_S=10',
      '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:8787/anthropic', '-e', 'HE_MODEL_API_KEY=trial-token:test',
      '-e', 'HE_MODEL_NAME=none', '-e', 'HE_TASK_SLICE=smoke', '-e', 'HE_TRIAL_ID=conformance-docker',
      IMAGE, 'run',
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    try {
      expect(run.status, run.stderr).toBe(0);
      // docker diff lists every path the container changed in its own
      // filesystem; bind mount contents are not part of it, only a mount
      // point docker had to create (/he-logs is not in the image). Nothing
      // else means the task image is unchanged (methodology item 2).
      const diff = spawnSync('docker', ['diff', name], { encoding: 'utf8' });
      expect(diff.status).toBe(0);
      const changed = diff.stdout.split('\n').filter(l => l.trim() && l !== 'A /he-logs');
      expect(changed).toEqual([]);
      expect(readFileSync(join(t.workspace, 'hello.txt'), 'utf8')).toBe('hello');
      expect(existsSync(join(t.state, 'fake/session.json'))).toBe(true);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('completed');
    } finally {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    }
  }, 120_000);

  test('/opt/harness is not written to during a run', () => {
    const t = trial(HELLO);
    const name = `he-conformance-ro-${process.pid}`;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const run = spawnSync('docker', [
      'run', '-i', '--name', name, '--network', 'none', '--read-only', '--tmpfs', '/tmp',
      '-v', `${t.workspace}:/workspace`, '-v', `${t.state}:/harness-state`, '-v', `${t.logs}:/he-logs`,
      '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TIME_BUDGET_S=10',
      '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:8787/anthropic', '-e', 'HE_MODEL_API_KEY=trial-token:test',
      '-e', 'HE_TRIAL_ID=conformance-ro',
      IMAGE, 'run',
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    expect(run.status, run.stderr).toBe(0);
  }, 60_000);
  test('serve in a container: ready, one turn each way, a clean stop, nothing outside the mounts', async () => {
    const t = trial('');
    const name = `he-conformance-serve-${process.pid}`;
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const child = spawn('docker', [
      'run', '-i', '--name', name, '--network', 'none', '--user', `${process.getuid!()}:${process.getgid!()}`,
      '-v', `${t.workspace}:/workspace`, '-v', `${t.state}:/harness-state`, '-v', `${t.logs}:/he-logs`, '-v', `${t.turns}:/he-turns`,
      '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TURNS_DIR=/he-turns', '-e', 'HE_TIME_BUDGET_S=10',
      '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:8787/anthropic', '-e', 'HE_MODEL_API_KEY=trial-token:test',
      '-e', 'HE_MODEL_NAME=none', '-e', 'HE_TASK_SLICE=multiuser', '-e', 'HE_TRIAL_ID=conformance-serve-docker',
      IMAGE, 'serve',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await waitFor(() => existsSync(join(t.logs, 'ready')), 30_000, 'ready file');
      postRequest(t, request(1));
      expect((await response(t, 1)).reply_text).toContain('Hi Dana Okafor');
      postRequest(t, request(2, { prompt: '[fake:sleep 5] hello', time_budget_s: 1 }));
      expect((await response(t, 2)).exit).toBe(124);
      // docker stop sends SIGTERM to the adapter and waits; the adapter exits 0 on its own.
      const stopped = spawnSync('docker', ['stop', '-t', '10', name], { encoding: 'utf8' });
      expect(stopped.status, stopped.stderr).toBe(0);
      const exit = spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', name], { encoding: 'utf8' });
      expect(exit.stdout.trim()).toBe('0');
      const diff = spawnSync('docker', ['diff', name], { encoding: 'utf8' });
      const changed = diff.stdout.split('\n').filter((l) => l.trim() && l !== 'A /he-logs' && l !== 'A /he-turns');
      expect(changed).toEqual([]);
      expect(tree(t.workspace)).toEqual(['instruction.md']);
    } finally {
      child.kill('SIGKILL');
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    }
  }, 120_000);
});


// ---- shared protocol assertions, every adapter ------------------------------------------------------------------------
// internal-task (build requirement 11): the serve and run protocol of docs/adapters.md, asserted the same way for each adapter
// below. A fixture supplies what differs: the model upstream, the workload (the prompt that makes a turn reply, outlive its
// budget, fail at the model, fail in the harness, or post through the world MCP) and the state layout the adapter keeps.
// The fake-only assertions above are unchanged; file-writing assertions stay fake-only, since Harness Zero has no file
// tools. Harness Zero's container level is in tests/harness-zero-image.test.ts.

interface Workload { reply: string; budget: string; modelError: string; harnessError: string; post: (args: { channel: string; text: string }) => string }
interface AdapterFixture { harness: string; adapter: string; model: () => { env: Record<string, string>; stop: () => void }; workload: Workload; state: (keys: string[], turns: number) => string[] }

/** A fake Anthropic Messages endpoint for Harness Zero (JSON, not streamed): [zero:hang] never answers, [zero:401] and
 *  [zero:400] answer that status, [zero:post <json>] asks for the world's post_message through call_tool, and anything
 *  else gets a text reply that counts the session's user turns. */
function zeroUpstream() {
  let n = 0;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const body = await req.json() as { model: string; messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> };
    const last = body.messages.at(-1)!;
    const said = last.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    n++;
    if (said.includes('[zero:hang]')) return new Promise<Response>(() => {});
    const status = said.match(/\[zero:(401|400)\]/)?.[1];
    if (status) return Response.json({ type: 'error', error: { type: status === '401' ? 'authentication_error' : 'invalid_request_error', message: 'conformance' } }, { status: Number(status) });
    const post = said.match(/\[zero:post (\{.*\})\]/)?.[1];
    const turns = body.messages.filter((m) => m.role === 'user' && m.content.some((b) => b.type === 'text')).length;
    const content = post
      ? [{ type: 'tool_use', id: 'toolu_conformance_' + n, name: 'call_tool', input: { name: 'mcp__world__post_message', arguments: JSON.parse(post) } }]
      : [{ type: 'text', text: `done, turn ${turns} of this session` }];
    return Response.json({ id: 'msg_conformance_' + n, type: 'message', role: 'assistant', model: body.model, content, stop_reason: post ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  } });
  return { env: { HE_MODEL_BASE_URL: `http://127.0.0.1:${server.port}/anthropic`, HE_MODEL_NAME: 'claude-opus-5-5' }, stop: () => server.stop(true) };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const FIXTURES: AdapterFixture[] = [
  {
    harness: '_fake', adapter: ADAPTER, model: () => ({ env: {}, stop: () => {} }),
    workload: { reply: 'hello?', budget: '[fake:sleep 5] hello', modelError: '[fake:model_error] hello', harnessError: '[fake:harness_error] hello',
      post: (a) => `hello\n[fake:call post_message ${JSON.stringify(a)}]\n` },
    state: (keys) => ['fake', 'fake/session.json', 'fake/sessions', ...keys.map((k) => `fake/sessions/${k.replace(/:/g, '_')}.json`).sort()],
  },
  {
    harness: 'harness-zero', adapter: join(ROOT, 'harnesses/harness-zero/adapter.sh'), model: zeroUpstream,
    workload: { reply: 'hello?', budget: '[zero:hang] hello', modelError: '[zero:401] hello', harnessError: '[zero:400] hello', post: (a) => `hello [zero:post ${JSON.stringify(a)}]` },
    state: (keys, turns) => ['tmp', 'zero', 'zero/sessions', ...keys.map((k) => `zero/sessions/${sha256(k)}.json`).sort(), 'zero/started',
      ...Array.from({ length: turns }, (_, i) => `zero/started/turn-${String(i + 1).padStart(4, '0')}.request.json`)],
  },
];

for (const fx of FIXTURES) {
  describe(`${fx.harness} adapter, shared protocol, process level`, () => {
    let ws: WorldServer;
    let model: ReturnType<AdapterFixture['model']>;
    beforeAll(() => { ws = startWorld('conformance-shared-' + fx.harness); model = fx.model(); });
    afterAll(() => { model.stop(); ws.stop(); });
    const env = (t: Trial): Record<string, string> => ({ ...SERVE_ENV(t), HE_WORLD_MCP_URL: `${ws.url}/mcp`, HE_WORLD_MCP_TOKEN: ws.credentials.bot.token, ...model.env });
    const startServe = (t: Trial) => spawn('bash', [fx.adapter, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: env(t) });
    const ask = (turn: number, prompt: string, over: Partial<TurnRequest> = {}) => request(turn, { prompt: `You are the workspace bot. Dana Okafor asks: ${prompt}`, ...over });

    test('run: one turn with stdin closed and no TTY exits 0, logs under HE_LOG_DIR and leaves the workspace unchanged', async () => {
      const t = trial('Do nothing.');
      // Not spawnSync: the model upstream and the world answer from this process, so its event loop must keep running.
      const child = spawn('bash', [fx.adapter, 'run'], { stdio: ['ignore', 'pipe', 'pipe'], env: env(t) });
      const code = await new Promise<number | null>((res) => child.once('exit', res));
      expect(code, readFileSync(join(t.logs, 'stderr.log'), 'utf8')).toBe(0);
      expect(tree(t.workspace)).toEqual(['instruction.md']);
      for (const f of ['adapter.log', 'stdout.log', 'stderr.log']) expect(existsSync(join(t.logs, f)), f).toBe(true);
      expect(readdirSync(t.dir).sort()).toEqual(['logs', 'state', 'turns', 'workspace']);
    }, 30_000);

    test('an entry point other than run or serve is exit 2', () => {
      const t = trial('');
      expect(spawnSync('bash', [fx.adapter, 'watch'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: env(t), timeout: 30_000 }).status).toBe(2);
    });

    test('serve: ready with the adapter sha256, turns answered in order, one session per conversation and per thread, nothing outside the four directories', async () => {
      const t = trial('');
      const child = startServe(t);
      try {
        await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
        const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'));
        expect(ready).toMatchObject({ harness: fx.harness, trial: 'conformance-serve', adapter_sha256: createHash('sha256').update(readFileSync(fx.adapter)).digest('hex') });
        postRequest(t, ask(1, fx.workload.reply));
        const r1 = await response(t, 1);
        expect(r1).toMatchObject({ turn: 1, exit: 0 });
        expect(r1.reply_text).toContain('turn 1 of this session');
        expect(Date.parse(r1.ended_at)).toBeGreaterThanOrEqual(Date.parse(r1.started_at));
        postRequest(t, ask(2, fx.workload.reply, { channel: { id: 'C0NORTH', name: 'north-team', type: 'channel' } }));
        expect((await response(t, 2)).reply_text).toContain('turn 1 of this session');
        postRequest(t, ask(3, fx.workload.reply));
        expect((await response(t, 3)).reply_text).toContain('turn 2 of this session');
        postRequest(t, ask(4, fx.workload.reply, { ts: '1700000400.000100', thread_ts: '1700000400.000100' }));
        expect((await response(t, 4)).reply_text).toContain('turn 1 of this session');
        expect(tree(t.workspace)).toEqual(['instruction.md']);
        expect(tree(t.turns).filter((p) => p.endsWith('.response.json'))).toEqual(['turn-0001.response.json', 'turn-0002.response.json', 'turn-0003.response.json', 'turn-0004.response.json']);
        expect(tree(t.turns).some((p) => p.endsWith('.tmp'))).toBe(false);
        expect(tree(t.state)).toEqual(fx.state(['dm:dana-okafor', 'channel:C0NORTH', 'dm:dana-okafor:t1700000400.000100'], 4));
        expect(readdirSync(t.dir).sort()).toEqual(['logs', 'state', 'turns', 'workspace']);
      } finally {
        expect(await stop(child)).toBe(0);
      }
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('stopped on signal');
    }, 60_000);

    test('serve: exit 124 past the turn budget, 3 on a model error, 2 on a harness error, and serving goes on', async () => {
      const t = trial('');
      const child = startServe(t);
      try {
        await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
        postRequest(t, ask(1, fx.workload.budget, { time_budget_s: 2 }));
        const r1 = await response(t, 1);
        expect(r1).toMatchObject({ turn: 1, exit: 124, reply_text: null });
        expect(Date.parse(r1.ended_at) - Date.parse(r1.started_at)).toBeLessThan(5_000);
        postRequest(t, ask(2, fx.workload.modelError));
        expect(await response(t, 2)).toMatchObject({ turn: 2, exit: 3, reply_text: null });
        postRequest(t, ask(3, fx.workload.harnessError));
        expect(await response(t, 3)).toMatchObject({ turn: 3, exit: 2, reply_text: null });
        postRequest(t, ask(4, fx.workload.reply));
        expect((await response(t, 4)).exit).toBe(0);
      } finally {
        expect(await stop(child)).toBe(0);
      }
    }, 60_000);

    test('serve: a world-MCP call lands in the event log as the bot', async () => {
      const t = trial('');
      const child = startServe(t);
      try {
        await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
        const before = ws.log.events.length;
        const channel = ws.service.channelsFor(ws.service.bot!, 'mcp').find((c) => c.kind !== 'dm')!;
        const text = `${fx.harness} bot post for shared conformance`;
        postRequest(t, ask(1, fx.workload.post({ channel: channel.id, text })));
        expect((await response(t, 1)).exit).toBe(0);
        const posted = ws.log.events.slice(before).filter((e) => e.tool === 'chat.postMessage');
        expect(posted.map((e) => [e.actor, e.via, e.kind, e.outcome, (e.args as { text: string }).text])).toEqual([['assistant', 'mcp', 'write', 'ok', text]]);
      } finally {
        expect(await stop(child)).toBe(0);
      }
    }, 60_000);

    test('serve: SIGTERM before the first turn exits 0', async () => {
      const t = trial('');
      const child = startServe(t);
      await waitFor(() => existsSync(join(t.logs, 'ready')), 15_000, 'ready file');
      expect(await stop(child)).toBe(0);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('stopped on signal');
    }, 30_000);
  });
}
