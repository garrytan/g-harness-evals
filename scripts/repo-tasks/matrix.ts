// Acceptance matrix for one repository task (docs/repo-tasks.md). Every scenario runs the way a Harbor trial with separate
// verification does: a script (the oracle, a wrong solution, a tamper attempt, or nothing) runs as root in a container from
// the task's agent image; the container's /work is copied out; a fresh container from the verifier image restores it with
// the tar "data" filter and runs /tests/verify.sh. Prints counts only; per-scenario rows go to --out.
//
//   bun scripts/repo-tasks/matrix.ts --task <task dir> [--runs 5] [--out <file.json>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8' };

function docker(args: string[], o: { timeoutS?: number; stdoutFile?: string } = {}) {
  const r = spawnSync('docker', args, { env: ENV, timeout: (o.timeoutS ?? 900) * 1000, maxBuffer: 512 * 1024 * 1024 });
  if (o.stdoutFile && r.stdout) writeFileSync(o.stdoutFile, r.stdout);
  return { status: r.status ?? 124, stdout: o.stdoutFile ? '' : (r.stdout?.toString('utf8') ?? '') };
}

export interface Images { agent: string; verifier: string; agent_id: string; verifier_id: string }

export function taskId(taskDir: string): string {
  const m = /^id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(taskDir, 'task.toml'), 'utf8'));
  if (!m) throw new Error('task.toml has no id');
  return m[1];
}

/** Build the agent image (environment/) and the verifier image (verifier/). */
export function buildImages(taskDir: string): Images {
  const id = taskId(taskDir);
  const agent = 'harness-eval/repo-agent:' + id, verifier = 'harness-eval/repo-verifier:' + id;
  for (const [tag, ctx] of [[agent, join(taskDir, 'environment')], [verifier, join(taskDir, 'verifier')]] as const) {
    if (docker(['build', '-q', '--label', 'harness-eval.repo-task=true', '-t', tag, ctx], { timeoutS: 3600 }).status !== 0) throw new Error('image build failed: ' + tag.split(':')[0]);
  }
  const idOf = (t: string) => docker(['image', 'inspect', '-f', '{{.Id}}', t]).stdout.trim();
  return { agent, verifier, agent_id: idOf(agent), verifier_id: idOf(verifier) };
}

export const RESTORE = [
  'import os, tarfile',
  'os.makedirs("/work", exist_ok=True)',
  'with tarfile.open("/tmp/state.tar") as t:',
  '    for m in t:',
  '        try:',
  '            t.extract(m, "/work", filter="data")',
  '        except Exception:',
  '            pass',
  'os.remove("/tmp/state.tar")',
].join('\n');

export interface ScenarioResult { reward: number; result: Record<string, unknown> | null }

/** One scenario. script is a path inside the agent container (/oracle/solve.sh, /checks/<name>.sh) or null. */
export function scenario(taskDir: string, imgs: Images, script: string | null, verifierTimeoutS = 1800): ScenarioResult {
  const tag = Math.random().toString(36).slice(2, 10);
  const agent = 'repo-agent-' + tag, ver = 'repo-verifier-' + tag;
  const tmp = mkdtempSync(join(tmpdir(), 'repo-matrix-'));
  try {
    if (docker(['run', '-d', '--network', 'none', '--name', agent, imgs.agent, 'sleep', 'infinity']).status !== 0) return { reward: -1, result: null };
    for (const d of ['oracle', 'checks']) if (existsSync(join(taskDir, d))) docker(['cp', join(taskDir, d), agent + ':/' + d]);
    if (script) docker(['exec', '-w', '/work/repo', agent, 'bash', script], { timeoutS: 900 });
    const state = join(tmp, 'state.tar');
    if (docker(['exec', agent, 'tar', '-C', '/work', '-cf', '-', '.'], { stdoutFile: state, timeoutS: 600 }).status !== 0) return { reward: -1, result: null };
    docker(['rm', '-f', agent]);
    if (docker(['run', '-d', '--network', 'none', '--name', ver, imgs.verifier, 'sleep', 'infinity']).status !== 0) return { reward: -1, result: null };
    docker(['cp', state, ver + ':/tmp/state.tar']);
    if (docker(['exec', ver, '/usr/local/bin/python3', '-c', RESTORE]).status !== 0) return { reward: -1, result: null };
    docker(['exec', ver, '/bin/bash', '/tests/verify.sh'], { timeoutS: verifierTimeoutS });
    const reward = Number(docker(['exec', ver, 'cat', '/logs/verifier/reward.txt']).stdout.trim());
    let result: Record<string, unknown> | null = null;
    try { result = JSON.parse(docker(['exec', ver, 'cat', '/logs/verifier/result.json']).stdout); } catch { result = null; }
    return { reward: Number.isFinite(reward) ? reward : -1, result };
  } finally {
    docker(['rm', '-f', agent, ver]);
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface MatrixRow { scenario: string; expected: number; got: number[] }
export interface Matrix { ok: boolean; runs: number; images: { agent_id: string; verifier_id: string }; rows: MatrixRow[] }

/** The oracle must score 1 and the starting state and every checks/*.sh 0, on every run; a scenario stops at its first miss. */
export function matrixPlan(taskDir: string): [string, string | null, number][] {
  const plan: [string, string | null, number][] = [['oracle', '/oracle/solve.sh', 1], ['start', null, 0]];
  const checks = existsSync(join(taskDir, 'checks')) ? readdirSync(join(taskDir, 'checks')).filter((f) => f.endsWith('.sh')).sort() : [];
  for (const c of checks) plan.push(['check:' + c.replace(/\.sh$/, ''), '/checks/' + c, 0]);
  return plan;
}

export function runMatrix(taskDir: string, imgs: Images, runs = 5): Matrix {
  const rows: MatrixRow[] = [];
  for (const [name, script, expected] of matrixPlan(taskDir)) {
    const got: number[] = [];
    for (let i = 0; i < runs; i++) {
      const r = scenario(taskDir, imgs, script).reward;
      got.push(r);
      if (r !== expected) break;
    }
    rows.push({ scenario: name, expected, got });
  }
  return { ok: rows.every((r) => r.got.length === runs && r.got.every((x) => x === r.expected)), runs, images: { agent_id: imgs.agent_id, verifier_id: imgs.verifier_id }, rows };
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const task = arg('--task');
  if (!task) { console.error('usage: bun scripts/repo-tasks/matrix.ts --task <dir> [--runs 5] [--out <file.json>]'); process.exit(2); }
  const runs = Number(arg('--runs') ?? 5);
  const m = runMatrix(task, buildImages(task), runs);
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify(m, null, 1) + '\n');
  console.log('MATRIX: ok=' + m.ok + ' scenarios=' + m.rows.length + ' failing=' + m.rows.filter((r) => !(r.got.length === runs && r.got.every((x) => x === r.expected))).length);
  process.exit(m.ok ? 0 : 1);
}
