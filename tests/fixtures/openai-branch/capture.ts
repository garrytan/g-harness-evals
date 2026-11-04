// Captures what an OpenClaw or Hermes adapter hands its harness for one turn, without a model:
// the harness's own config file as the adapter left it in /harness-state, the turn command's
// arguments and provider environment (recorded by the stand-ins in stub/), the serve response and
// the ready file. The adapter, config/ and pin.json come from a harness directory mounted over
// /opt/harness in the image, so a checkout and an older commit can be compared on the same pinned
// runtime. Used by tests/openai-branch.test.ts and by make-golden.ts, which wrote golden/ from
// c1c7ed1b3. Needs docker and the harness image; spawns docker with a scrubbed environment.
//
// captureProcess() is the same capture without docker or the image: the adapter runs on this host under a scrubbed
// environment with the stand-ins in stub/ first on PATH (they answer --version and the mcp commands themselves when the
// pinned CLI is absent), and the trial directories' host paths are written back as the container paths the goldens hold.
// Hermes's Anthropic config copy reads the literal /opt/harness/config/config.yaml (the line its gstack overlay copies), so
// on a host without it the checkout's config.yaml is placed in HERMES_HOME first, as that copy would place it.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Harness = 'openclaw' | 'hermes';
export type Entry = 'run' | 'serve';
export interface Turn { argv: string[]; env: Record<string, string> }
export interface Capture { exit: number | null; turns: Turn[]; config: string; response: Record<string, unknown> | null; ready: Record<string, unknown> | null; adapter_sha256: string | null; logs: string; dir: string; mcp?: Array<{ name: string; definition: unknown }> }

export const STUB_DIR = join(import.meta.dir, 'stub');
export const GOLDEN_DIR = join(import.meta.dir, 'golden');
export const TOKEN = 'trial-token:golden.00000000000000000000000000000000';
const CONFIG: Record<Harness, string> = { openclaw: 'openclaw/openclaw.json', hermes: 'hermes/config.yaml' };
export const dockerEnv = () => ({ PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' });
const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: dockerEnv(), timeout, stdio: ['ignore', 'pipe', 'pipe'] });

export function imagePath(image: string): string {
  const env = JSON.parse(docker(['image', 'inspect', image, '-f', '{{json .Config.Env}}']).stdout || '[]') as string[];
  return (env.find(e => e.startsWith('PATH=')) ?? 'PATH=/usr/local/bin:/usr/bin:/bin').slice(5);
}

/** The serve request every capture answers. */
export const REQUEST = { turn: 1, trial_id: 'golden', prompt: 'Say ok.', actor: { member: 'alice', slack_user_id: 'U0ALICE', name: 'Alice', role: 'engineer', team: null },
  channel: { id: 'D0ALICE', name: 'alice', type: 'dm' }, text: 'Say ok.', ts: '1790000000.000100', thread_ts: null, sim_now: '2026-10-29T09:00:00-07:00', time_budget_s: 60 };
const WORLD = { url: 'http://127.0.0.1:9/mcp', token: 'world-token-golden' };

/** stub: false runs the pinned CLI itself (a real turn against whatever HE_MODEL_BASE_URL reaches); token defaults to TOKEN. */
export async function capture(o: { harness: Harness; entry: Entry; harnessDir: string; image: string; baseUrl: string; model: string; name: string; stub?: boolean; token?: string; budgetS?: number }): Promise<Capture> {
  const dir = mkdtempSync(join(tmpdir(), 'he-openai-branch-'));
  for (const d of ['workspace', 'state', 'logs', 'turns']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
  const args = ['--user', `${process.getuid!()}:${process.getgid!()}`, '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${join(dir, 'workspace')}:/workspace`, '-v', `${join(dir, 'state')}:/harness-state`, '-v', `${join(dir, 'logs')}:/he-logs`,
    '-v', `${join(o.harnessDir, 'adapter.sh')}:/opt/harness/adapter.sh:ro`, '-v', `${join(o.harnessDir, 'config')}:/opt/harness/config:ro`,
    '-v', `${join(o.harnessDir, 'pin.json')}:/opt/harness/pin.json:ro`,
    ...(o.stub === false ? [] : ['-v', `${STUB_DIR}:/he-stub:ro`, '-e', `PATH=/he-stub:${imagePath(o.image)}`]),
    '-e', `HE_MODEL_BASE_URL=${o.baseUrl}`, '-e', `HE_MODEL_API_KEY=${o.token ?? TOKEN}`, '-e', `HE_MODEL_NAME=${o.model}`,
    '-e', `HE_TIME_BUDGET_S=${o.budgetS ?? 60}`, '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TRIAL_ID=golden'];
  let exit: number | null;
  let response: Record<string, unknown> | null = null;
  if (o.entry === 'run') {
    exit = docker(['run', '-i', '--rm', '--name', o.name, ...args, '-e', 'HE_TASK_SLICE=smoke', o.image, 'run'], 180_000).status;
  } else {
    const started = docker(['run', '-d', '--name', o.name, ...args, '-v', `${join(dir, 'turns')}:/he-turns`, '-e', 'HE_TURNS_DIR=/he-turns', '-e', 'HE_TASK_SLICE=multiuser',
      '-e', `HE_WORLD_MCP_URL=${WORLD.url}`, '-e', `HE_WORLD_MCP_TOKEN=${WORLD.token}`, o.image, 'serve']);
    if (started.status !== 0) throw new Error(`docker run ${o.name} failed: ${started.stderr}`);
    try {
      const request = REQUEST;
      const deadline = Date.now() + 150_000;
      while (!existsSync(join(dir, 'logs', 'ready')) && Date.now() < deadline) await Bun.sleep(250);
      writeFileSync(join(dir, 'turns', 'turn-0001.request.json.tmp'), JSON.stringify(request));
      renameSync(join(dir, 'turns', 'turn-0001.request.json.tmp'), join(dir, 'turns', 'turn-0001.request.json'));
      while (!existsSync(join(dir, 'turns', 'turn-0001.response.json')) && Date.now() < deadline) await Bun.sleep(250);
      if (existsSync(join(dir, 'turns', 'turn-0001.response.json'))) {
        const { started_at: _s, ended_at: _e, ...rest } = JSON.parse(readFileSync(join(dir, 'turns', 'turn-0001.response.json'), 'utf8'));
        response = rest;
      }
    } finally {
      docker(['stop', '-t', '10', o.name], 60_000);
      exit = Number(docker(['inspect', o.name, '-f', '{{.State.ExitCode}}']).stdout.trim());
      docker(['rm', '-f', o.name]);
    }
  }
  return collect(o.harness, dir, exit, response);
}

/** The adapter in harnessDir on this host, with stub/ first on PATH and env (the image's PATH tools and its *_VERSION) added to
 *  the protocol variables; nothing else from this process's environment reaches it. */
export async function captureProcess(o: { harness: Harness; entry: Entry; harnessDir: string; baseUrl: string; model: string; env: Record<string, string> }): Promise<Capture> {
  const dir = mkdtempSync(join(tmpdir(), 'he-openai-branch-proc-'));
  for (const d of ['workspace', 'state', 'logs', 'turns']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
  const env: Record<string, string> = { ...o.env, PATH: `${STUB_DIR}:${o.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
    HE_WORKSPACE_DIR: join(dir, 'workspace'), HE_SESSION_STATE_DIR: join(dir, 'state'), HE_LOG_DIR: join(dir, 'logs'), HE_TURNS_DIR: join(dir, 'turns'),
    HE_MODEL_BASE_URL: o.baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: o.model, HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'golden',
    HE_TASK_SLICE: o.entry === 'run' ? 'smoke' : 'multiuser', ...(o.entry === 'serve' ? { HE_WORLD_MCP_URL: WORLD.url, HE_WORLD_MCP_TOKEN: WORLD.token } : {}) };
  if (o.harness === 'hermes' && !/\/(openai|particle)\/?$/.test(o.baseUrl) && !existsSync('/opt/harness/config/config.yaml')) {
    mkdirSync(join(dir, 'state', 'hermes'));
    writeFileSync(join(dir, 'state', 'hermes', 'config.yaml'), readFileSync(join(o.harnessDir, 'config', 'config.yaml')));
  }
  const adapter = join(o.harnessDir, 'adapter.sh');
  let exit: number | null;
  let response: Record<string, unknown> | null = null;
  if (o.entry === 'run') {
    exit = spawnSync('bash', [adapter, 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).status;
  } else {
    const child = spawn('bash', [adapter, 'serve'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
    const exited = new Promise<number | null>(res => child.once('exit', code => res(code)));
    const deadline = Date.now() + 30_000;
    const wait = async (p: string) => { while (!existsSync(p) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(50); };
    try {
      await wait(join(dir, 'logs', 'ready'));
      writeFileSync(join(dir, 'turns', 'turn-0001.request.json.tmp'), JSON.stringify(REQUEST));
      renameSync(join(dir, 'turns', 'turn-0001.request.json.tmp'), join(dir, 'turns', 'turn-0001.request.json'));
      await wait(join(dir, 'turns', 'turn-0001.response.json'));
      if (existsSync(join(dir, 'turns', 'turn-0001.response.json'))) {
        const { started_at: _s, ended_at: _e, ...rest } = JSON.parse(readFileSync(join(dir, 'turns', 'turn-0001.response.json'), 'utf8'));
        response = rest;
      }
    } finally {
      child.kill('SIGTERM');
      exit = await Promise.race([exited, Bun.sleep(10_000).then(() => { child.kill('SIGKILL'); return null; })]);
    }
  }
  // The host paths of the trial directories, written back as the container paths the goldens were captured with.
  const containerPaths = (s: string) => s.replaceAll(join(dir, 'state'), '/harness-state').replaceAll(join(dir, 'workspace'), '/workspace').replaceAll(join(dir, 'logs'), '/he-logs');
  for (const f of ['stub-turns.jsonl', 'stub-mcp.jsonl']) if (existsSync(join(dir, 'logs', f))) writeFileSync(join(dir, 'logs', f), containerPaths(readFileSync(join(dir, 'logs', f), 'utf8')));
  const c = collect(o.harness, dir, exit, response);
  const mcpLog = join(dir, 'logs', 'stub-mcp.jsonl');
  return { ...c, config: containerPaths(c.config), ...(existsSync(mcpLog) ? { mcp: readFileSync(mcpLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } : {}) };
}

function collect(harness: Harness, dir: string, exit: number | null, response: Record<string, unknown> | null): Capture {
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  const turns = read(join(dir, 'logs', 'stub-turns.jsonl')).split('\n').filter(Boolean).map(l => JSON.parse(l) as Turn);
  const readyText = read(join(dir, 'logs', 'ready'));
  let ready: Record<string, unknown> | null = null;
  let adapterSha: string | null = null;
  if (readyText) {
    const { ready_at: _r, adapter_sha256, ...rest } = JSON.parse(readyText);
    ready = rest; adapterSha = adapter_sha256;
  }
  return { exit, turns, config: read(join(dir, 'state', CONFIG[harness])), response, ready, adapter_sha256: adapterSha, logs: read(join(dir, 'logs', 'adapter.log')) + read(join(dir, 'logs', 'stderr.log')), dir };
}

/** The part of a capture an Anthropic cell must keep byte for byte: everything but the logs, the exit code and the adapter's own sha256. */
export const goldenOf = (c: Capture) => ({ turns: c.turns, config: c.config, response: c.response, ready: c.ready });
export const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const goldenPath = (harness: Harness, entry: Entry) => join(GOLDEN_DIR, `${harness}-${entry}-anthropic.json`);
export const ANTHROPIC_CELL = { baseUrl: 'http://host.docker.internal:18999/golden/anthropic', model: 'claude-haiku-5-5' };
