/**
 * A provider 402 or 429 that a harness prints only on stderr is still a model error (exit 3) when the copies into the log
 * files lag behind the CLI. The adapters copy their output through process-substitution tees that bash never waits for, so a
 * model-error grep that reads a tee'd copy can run before the HTTP line has landed and turn a model error into exit 2.
 * tests/particle-branch.test.ts covers Hermes's run entry; this file covers the other places that grepped a tee'd copy:
 * Hermes's serve turn, OpenClaw's run entry and serve turn, and the Hermes gstack overlay's chat-mode turn.
 *
 * fixtures/particle/slow-tee/ delays every tee write by 200 ms, as a tee the scheduler runs late on a loaded machine does.
 * fixtures/model-error-race/ holds stand-ins whose turn prints the provider error on stderr and in no file the CLI writes
 * itself. QM is not here: its run and serve turns map qm-api.mjs's exit code, which comes from QM's HTTP reply, and read no
 * log. Keyless, no docker: every spawned process gets a scrubbed environment and placeholder keys.
 */
import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUEST, STUB_DIR, TOKEN, type Harness } from './fixtures/openai-branch/capture.ts';
import { hostEnv } from './fixtures/particle/make-golden.ts';

const ROOT = join(import.meta.dir, '..');
const NODE = Bun.which('node');
const SLOW_TEE = join(import.meta.dir, 'fixtures', 'particle', 'slow-tee');
const STDERR_ONLY = join(import.meta.dir, 'fixtures', 'model-error-race');
const PARTICLE_CELL = { baseUrl: 'http://host.docker.internal:18999/golden/particle', model: 'particle-1' };
const WORLD = { HE_WORLD_MCP_URL: 'http://127.0.0.1:9/mcp', HE_WORLD_MCP_TOKEN: 'world-token-race' };
const harnessDir = (h: Harness) => join(ROOT, 'harnesses', h);

/** A trial directory whose stand-in turn fails with status, and the adapter environment with the slow tee and the stand-ins
 *  first on PATH. */
function trial(h: Harness, status: string) {
  const dir = mkdtempSync(join(tmpdir(), 'he-model-error-race-'));
  for (const d of ['workspace', 'state', 'logs', 'turns']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
  writeFileSync(join(dir, 'state', 'stub-error-status'), status);
  const env: Record<string, string> = { ...hostEnv(harnessDir(h), h, NODE!), HE_WORKSPACE_DIR: join(dir, 'workspace'), HE_SESSION_STATE_DIR: join(dir, 'state'),
    HE_LOG_DIR: join(dir, 'logs'), HE_TURNS_DIR: join(dir, 'turns'), HE_MODEL_BASE_URL: PARTICLE_CELL.baseUrl, HE_MODEL_API_KEY: TOKEN,
    HE_MODEL_NAME: PARTICLE_CELL.model, HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'race' };
  env.PATH = [SLOW_TEE, STDERR_ONLY, STUB_DIR, env.PATH].join(':');
  return { dir, env };
}

/** One serve turn: the adapter's serve entry, one request, the exit in its response. */
async function serveExit(h: Harness, status: string): Promise<number | null> {
  const { dir, env } = trial(h, status);
  const child = spawn('bash', [join(harnessDir(h), 'adapter.sh'), 'serve'], { env: { ...env, ...WORLD, HE_TASK_SLICE: 'multiuser' }, stdio: 'ignore' });
  const deadline = Date.now() + 45_000;
  const until = async (p: string) => { while (!existsSync(p) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(50); };
  try {
    await until(join(dir, 'logs', 'ready'));
    writeFileSync(join(dir, 'turns', 'turn-0001.request.json.tmp'), JSON.stringify(REQUEST));
    renameSync(join(dir, 'turns', 'turn-0001.request.json.tmp'), join(dir, 'turns', 'turn-0001.request.json'));
    const resp = join(dir, 'turns', 'turn-0001.response.json');
    await until(resp);
    return existsSync(resp) ? JSON.parse(readFileSync(resp, 'utf8')).exit : null;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise(res => child.once('exit', res)), Bun.sleep(10_000).then(() => child.kill('SIGKILL'))]);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!NODE || !Bun.which('python3'))('a stderr-only provider 402 or 429 is exit 3 when the log copies lag', () => {
  for (const h of ['hermes', 'openclaw'] as Harness[]) {
    test(`${h} serve: the turn's exit is 3`, async () => {
      for (const status of ['402', '429']) expect({ status, exit: await serveExit(h, status) }).toEqual({ status, exit: 3 });
    }, 120_000);
  }

  test('openclaw run: the exit is 3', () => {
    for (const status of ['402', '429']) {
      const { dir, env } = trial('openclaw', status);
      const exit = spawnSync('bash', [join(harnessDir('openclaw'), 'adapter.sh'), 'run'], { env: { ...env, HE_TASK_SLICE: 'smoke' }, stdio: 'ignore', timeout: 60_000 }).status;
      rmSync(dir, { recursive: true, force: true });
      expect({ status, exit }).toEqual({ status, exit: 3 });
    }
  }, 120_000);

  // The overlay's chat block (from its own output tees to the exit mapping) runs as it stands, with the stand-in Hermes under
  // the real pty; wrapper-lib.sh, /opt/harness and the gstack setup above it are the image's and are left out. The watcher
  // polls every 50 ms here, so it sees the session leave well inside the slow tee's 200 ms.
  test.skipIf(!Bun.which('script'))('hermes gstack overlay, chat mode: the exit is 3', () => {
    const overlay = readFileSync(join(harnessDir('hermes'), 'gstack', 'adapter.sh'), 'utf8');
    const block = overlay.slice(overlay.indexOf('exec > >(tee -a "$HE_LOG_DIR/stdout.log")'));
    for (const status of ['402', '429']) {
      const { dir, env } = trial('hermes', status);
      mkdirSync(join(dir, 'state', 'hermes'));
      writeFileSync(join(dir, 'state', 'hermes', 'config.yaml'), 'model:\n  default: "claude-sonnet-5-5"\n');
      writeFileSync(join(dir, 'chat.sh'), 'set -euo pipefail\nwrap_fail() { echo "wrap_fail: $*" >&2; exit 2; }\nwrap_log() { :; }\n' + block);
      const exit = spawnSync('bash', [join(dir, 'chat.sh')], { env: { ...env, HOME: join(dir, 'state'), HERMES_HOME: join(dir, 'state', 'hermes'),
        HE_MODEL_BASE_URL: 'http://host.docker.internal:18999/golden/anthropic', HE_MODEL_NAME: 'claude-sonnet-5-5', HE_GSTACK_CHAT_POLL_S: '0.05' },
        stdio: 'ignore', timeout: 60_000 }).status;
      rmSync(dir, { recursive: true, force: true });
      expect({ status, exit }).toEqual({ status, exit: 3 });
    }
  }, 120_000);
});
