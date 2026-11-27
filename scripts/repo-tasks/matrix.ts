// Acceptance matrix for one repository task (docs/repo-tasks.md). Every scenario runs the way a Harbor trial with separate
// verification does: a script (the oracle, a wrong solution, a tamper attempt, or nothing) runs as root in a container from
// the task's agent image; the container's /work is copied out; a fresh container from the verifier image restores it with
// the tar "data" filter and runs /tests/verify.sh. Prints counts only; per-scenario rows go to --out.
//
// A task with oracle/steps.sh also runs the steps-followed oracle (internal-task d7): the oracle's solution plus every step of
// a steps card, which must score 1 like the oracle. --steps <card.json> replaces the task's own card (oracle/steps.json),
// so a revised card can be rerun against the same tasks.
//
//   bun scripts/repo-tasks/matrix.ts --task <task dir> [--runs 5] [--steps <card.json>] [--out <file.json>]
//   bun scripts/repo-tasks/matrix.ts --set <set dir> [--split dev] [--only <id,...>] [--jobs 3] [--runs 5] [--steps <card.json>]
//
// --set runs every task of the split (or --only), --jobs at a time, and merges their rows into <split>/ACCEPTANCE.json.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

/** The scenario's reward from verify.sh's exit status and reward.txt: -1 (a miss, whatever was expected) when the verifier
 * exited nonzero or wrote no number, because verify.sh writes 0 before grading and a crashed verifier would otherwise
 * pass every scenario that expects 0. */
export function verifierReward(status: number, rewardText: string): number {
  const text = rewardText.trim();
  const reward = Number(text);
  return status === 0 && text !== '' && Number.isFinite(reward) ? reward : -1;
}

/** One scenario. script is a path inside the agent container (/oracle/solve.sh, /checks/<name>.sh) or null. */
export function scenario(taskDir: string, imgs: Images, script: string | null, verifierTimeoutS = 1800, card?: string): ScenarioResult {
  const tag = Math.random().toString(36).slice(2, 10);
  const agent = 'repo-agent-' + tag, ver = 'repo-verifier-' + tag;
  const tmp = mkdtempSync(join(tmpdir(), 'repo-matrix-'));
  try {
    if (docker(['run', '-d', '--network', 'none', '--name', agent, imgs.agent, 'sleep', 'infinity']).status !== 0) return { reward: -1, result: null };
    for (const d of ['oracle', 'checks']) if (existsSync(join(taskDir, d))) docker(['cp', join(taskDir, d), agent + ':/' + d]);
    if (card) docker(['cp', card, agent + ':/oracle/steps.json']);
    if (script) docker(['exec', '-w', '/work/repo', agent, 'bash', script], { timeoutS: 900 });
    const state = join(tmp, 'state.tar');
    if (docker(['exec', agent, 'tar', '-C', '/work', '-cf', '-', '.'], { stdoutFile: state, timeoutS: 600 }).status !== 0) return { reward: -1, result: null };
    docker(['rm', '-f', agent]);
    if (docker(['run', '-d', '--network', 'none', '--name', ver, imgs.verifier, 'sleep', 'infinity']).status !== 0) return { reward: -1, result: null };
    docker(['cp', state, ver + ':/tmp/state.tar']);
    if (docker(['exec', ver, '/usr/local/bin/python3', '-c', RESTORE]).status !== 0) return { reward: -1, result: null };
    const verified = docker(['exec', ver, '/bin/bash', '/tests/verify.sh'], { timeoutS: verifierTimeoutS }).status;
    const reward = verifierReward(verified, docker(['exec', ver, 'cat', '/logs/verifier/reward.txt']).stdout);
    let result: Record<string, unknown> | null = null;
    try { result = JSON.parse(docker(['exec', ver, 'cat', '/logs/verifier/result.json']).stdout); } catch { result = null; }
    return { reward, result };
  } finally {
    docker(['rm', '-f', agent, ver]);
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface MatrixRow { scenario: string; expected: number; got: number[] }
export interface Matrix { ok: boolean; runs: number; images: { agent_id: string; verifier_id: string }; rows: MatrixRow[] }

/** The oracle (and the steps-followed oracle, when the task has one) must score 1 and the starting state and every
 * checks/*.sh 0, on every run; a scenario stops at its first miss. */
export function matrixPlan(taskDir: string): [string, string | null, number][] {
  const plan: [string, string | null, number][] = [['oracle', '/oracle/solve.sh', 1]];
  if (existsSync(join(taskDir, 'oracle', 'steps.sh'))) plan.push(['steps', '/oracle/steps.sh', 1]);
  plan.push(['start', null, 0]);
  const checks = existsSync(join(taskDir, 'checks')) ? readdirSync(join(taskDir, 'checks')).filter((f) => f.endsWith('.sh')).sort() : [];
  for (const c of checks) plan.push(['check:' + c.replace(/\.sh$/, ''), '/checks/' + c, 0]);
  return plan;
}

export function runMatrix(taskDir: string, imgs: Images, runs = 5, card?: string): Matrix {
  const rows: MatrixRow[] = [];
  for (const [name, script, expected] of matrixPlan(taskDir)) {
    const got: number[] = [];
    for (let i = 0; i < runs; i++) {
      const r = scenario(taskDir, imgs, script, 1800, card).reward;
      got.push(r);
      if (r !== expected) break;
    }
    rows.push({ scenario: name, expected, got });
  }
  return { ok: rows.every((r) => r.got.length === runs && r.got.every((x) => x === r.expected)), runs, images: { agent_id: imgs.agent_id, verifier_id: imgs.verifier_id }, rows };
}

const NOTE = 'Each scenario: the script runs as root in a container from the agent image, /work is copied out, and a fresh container from the verifier image grades it. A scenario stops at its first miss. steps is the steps-followed oracle: the oracle\'s solution plus every step of the card in oracle/steps.json.';

/** Runs every task of a set split, jobs at a time, each in its own process, and merges the rows into ACCEPTANCE.json. */
async function runSet(setDir: string, split: string, only: string[] | undefined, jobs: number, runs: number, card?: string) {
  const dir = join(setDir, split);
  const ids = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && (!only || only.includes(n))).sort();
  const file = join(dir, 'ACCEPTANCE.json');
  const acc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { set: setDir.split('/').pop(), split, script: 'scripts/repo-tasks/matrix.ts', date: '', note: NOTE, tasks: {} };
  const tmp = mkdtempSync(join(tmpdir(), 'repo-matrix-set-'));
  const queue = ids.slice();
  const one = (id: string) => new Promise<void>((done) => {
    const args = [import.meta.path, '--task', join(dir, id), '--runs', String(runs), '--out', join(tmp, id + '.json'), ...(card ? ['--steps', card] : [])];
    const p = spawn(process.execPath, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { out += b; });
    p.on('close', () => { console.log(id + ' ' + (out.trim().split('\n').pop() ?? '')); done(); });
  });
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => { while (queue.length) await one(queue.shift()!); }));
  for (const id of ids) {
    const f = join(tmp, id + '.json');
    const kind = /^kind\s*=\s*"([^"]+)"/m.exec(readFileSync(join(dir, id, 'task.toml'), 'utf8'))?.[1];
    if (!existsSync(f)) { console.log(id + ' produced no matrix'); acc.tasks[id] = { kind, ok: false, runs, error: 'the worker produced no matrix', rows: [] }; continue; }
    acc.tasks[id] = { kind, ...JSON.parse(readFileSync(f, 'utf8')) };
  }
  rmSync(tmp, { recursive: true, force: true });
  acc.date = new Date().toISOString().slice(0, 10);
  acc.note = NOTE;
  acc.tasks = Object.fromEntries(Object.keys(acc.tasks).sort().map((k) => [k, acc.tasks[k]]));
  writeFileSync(file, JSON.stringify(acc, null, 1) + '\n');
  const bad = Object.entries<any>(acc.tasks).filter(([, m]) => !m.ok).map(([k]) => k);
  console.log('MATRIX SET: tasks=' + Object.keys(acc.tasks).length + ' failing=' + bad.length + (bad.length ? ' (' + bad.join(',') + ')' : ''));
  return bad.length === 0;
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const runs = Number(arg('--runs') ?? 5);
  const card = arg('--steps') ? resolve(arg('--steps')!) : undefined;
  const set = arg('--set');
  if (set) {
    const ok = await runSet(resolve(set), arg('--split') ?? 'dev', arg('--only')?.split(','), Number(arg('--jobs') ?? 3), runs, card);
    process.exit(ok ? 0 : 1);
  }
  const task = arg('--task');
  if (!task) { console.error('usage: bun scripts/repo-tasks/matrix.ts --task <dir> [--runs 5] [--steps <card.json>] [--out <file.json>] | --set <dir> [--split dev] [--only <ids>] [--jobs 3]'); process.exit(2); }
  const m = runMatrix(task, buildImages(task), runs, card);
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify(m, null, 1) + '\n');
  console.log('MATRIX: ok=' + m.ok + ' scenarios=' + m.rows.length + ' failing=' + m.rows.filter((r) => !(r.got.length === runs && r.got.every((x) => x === r.expected))).length + ' ' + m.rows.filter((r) => !(r.got.length === runs && r.got.every((x) => x === r.expected))).map((r) => r.scenario + '=' + r.got.join('/')).join(' '));
  process.exit(m.ok ? 0 : 1);
}
