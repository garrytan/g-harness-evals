#!/usr/bin/env bun
// Writes golden/stack-environments.json from a harness tree: what QM's stack hands core and the task container on an Opus,
// a Particle and a GPT-6.1 Sol cell. For each cell prepare.sh runs with a stand-in docker that answers its image check with
// the pinned commit, and docker compose renders compose.yaml, plus compose.<provider>.yaml when it exists as
// runner/trial/docker.ts merges it, with the prepare.sh lines and fixed placeholder paths and secrets ("docker compose config",
// no daemon call). tests/qm-openai-branch.test.ts compares the checkout's stack against it, so a change for one cell model
// cannot move another's. The file was written from main at 2a47028c6b and rewritten on 2026-11-21 from the QM 7689355c (now 77024e79)
// re-pin tree (internal-task), whose only change is PRIVATE_NETWORK_ALLOWED_ORIGINS for core and QM_PRIVATE_NETWORK_ALLOWED_ORIGINS
// for the task container (empty on the Opus and Sol cells, the proxy origin on the Particle cell):
//
//   mkdir /tmp/he-2a47028c6b && git archive 2a47028c6b harnesses/qm | tar -x -C /tmp/he-2a47028c6b
//   bun tests/fixtures/qm-openai/make-golden.ts --from /tmp/he-2a47028c6b/harnesses
//
// QM_DOCKER_GID is left out: prepare.sh reads it from the host's docker socket, so it differs between machines.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const QM_GOLDEN = join(import.meta.dir, 'golden', 'stack-environments.json');
export const TOKEN = 'trial-token:golden.00000000000000000000000000000000';
export const QM_CELLS = {
  opus: { model: 'anthropic:claude-opus-5-5', baseUrl: 'http://host.docker.internal:18999/golden/anthropic' },
  particle: { model: 'particle:particle-1', baseUrl: 'http://host.docker.internal:18999/golden/particle' },
  sol: { model: 'openai:gpt-6.1-sol', baseUrl: 'http://host.docker.internal:18999/golden/openai' },
} as const;
export type QmCell = keyof typeof QM_CELLS;
export interface StackEnvironment { prepare: Record<string, string>; files: string[]; core: Record<string, string | null>; task: Record<string, string | null> }

const PATHS = { HE_STATE: '/golden/state', HE_LOGS: '/golden/logs', HE_TURNS: '/golden/turns', HE_WORKSPACE: '/golden/workspace' };

/** prepare.sh's NAME=value lines for a cell, run with a stand-in docker and fixed secrets, so nothing depends on the host. */
export function qmPrepare(qmDir: string, baseUrl: string, modelName: string): { status: number | null; stderr: string; vars: Record<string, string> } {
  const pin: string = JSON.parse(readFileSync(join(qmDir, 'pin.json'), 'utf8')).commit;
  const bin = mkdtempSync(join(tmpdir(), 'he-qm-golden-docker-'));
  const out = mkdtempSync(join(tmpdir(), 'he-qm-golden-out-'));
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho ${pin}\n`, { mode: 0o755 });
  try {
    const r = spawnSync('bash', [join(qmDir, 'prepare.sh'), out], { encoding: 'utf8',
      env: { PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`, HOME: tmpdir(), HE_MODEL_BASE_URL: baseUrl, HE_MODEL_NAME: modelName, QM_SIGNING_SECRET: 'golden-signing', QM_CONNECTOR_SECRET_KEY: 'golden-connector' } });
    const vars: Record<string, string> = {};
    for (const line of r.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1); }
    return { status: r.status, stderr: r.stderr, vars };
  } finally {
    rmSync(bin, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

/** The core and task environments docker compose renders for a cell, with the compose files it loaded. */
export function qmStack(qmDir: string, cell: QmCell): StackEnvironment {
  const { model, baseUrl } = QM_CELLS[cell];
  const [provider, modelName] = [model.slice(0, model.indexOf(':')), model.slice(model.indexOf(':') + 1)];
  const prep = qmPrepare(qmDir, baseUrl, modelName);
  if (prep.status !== 0) throw new Error(`qm prepare.sh exited ${prep.status} on the ${cell} cell: ${prep.stderr}`);
  const files = ['compose.yaml', `compose.${provider}.yaml`].filter((f) => existsSync(join(qmDir, f)));
  const r = spawnSync('docker', ['compose', ...files.flatMap((f) => ['-f', join(qmDir, f)]), 'config', '--format', 'json'], { encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ...prep.vars, ...PATHS,
      HE_MODEL_BASE_URL: baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: modelName, HE_TIME_BUDGET_S: '60', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: 'golden' } });
  if (r.status !== 0) throw new Error(`docker compose config failed on the ${cell} cell: ${r.stderr}`);
  const services = JSON.parse(r.stdout).services;
  const { QM_DOCKER_GID: _gid, ...prepare } = prep.vars;
  return { prepare, files, core: services.core.environment, task: services.task.environment };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const from = argv[argv.indexOf('--from') + 1];
  if (!argv.includes('--from') || !from) throw new Error('usage: make-golden.ts --from <harnesses dir>');
  const qmDir = join(from, 'qm');
  mkdirSync(join(import.meta.dir, 'golden'), { recursive: true });
  const golden = Object.fromEntries((Object.keys(QM_CELLS) as QmCell[]).map((cell) => [cell, qmStack(qmDir, cell)]));
  writeFileSync(QM_GOLDEN, JSON.stringify(golden, null, 1) + '\n');
  console.log(`${QM_GOLDEN}: ${Object.keys(golden).join(', ')}`);
}
