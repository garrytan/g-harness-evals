// Adapter protocol conformance, proven on the fake harness (harnesses/_fake).
// The protocol is docs/adapters.md. Two layers:
//   1. process level, always on: the adapter script runs in temp directories
//      with HE_WORKSPACE_DIR / HE_SESSION_STATE_DIR / HE_LOG_DIR pointed at
//      them, stdin closed and no TTY; exit codes and file placement are checked.
//   2. container level, when docker is available: the fake image runs with the
//      three mounts, and `docker diff` proves the container filesystem outside
//      those mounts is untouched.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const ADAPTER = join(ROOT, 'harnesses/_fake/adapter.sh');
const HELLO = readFileSync(join(ROOT, 'tasks/hello/instruction.md'), 'utf8');

interface Trial { dir: string; workspace: string; state: string; logs: string }

function trial(instruction: string): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-conformance-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs') };
  for (const d of [t.workspace, t.state, t.logs]) mkdirSync(d);
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
      HE_MODEL_API_KEY: 'sk-trial-test',
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

  test('exit 2 for an entry point other than run (serve is reserved, not implemented)', () => {
    const t = trial(HELLO);
    const r = spawnSync('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
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
      '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:8787/anthropic', '-e', 'HE_MODEL_API_KEY=sk-trial-test',
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
      '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:8787/anthropic', '-e', 'HE_MODEL_API_KEY=sk-trial-test',
      '-e', 'HE_TRIAL_ID=conformance-ro',
      IMAGE, 'run',
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    expect(run.status, run.stderr).toBe(0);
  }, 60_000);
});
