// Task repository contract checks for rules-fix-v1 (wave 0 spec): for each task, a container from its agent
// image (network off) runs contract_check.py, which checks the starting repository (clean tree on main at the recorded
// base commit, git identity, empty /work/.he, no rules files), scripts/notes and scripts/precheck output and logs, the
// precheck tree hash against an independent computation, precheck on the oracle and on a broken file, watch.py's
// created, modified and deleted lines, and git commit -s. It also checks that the verifier image holds exactly the files
// of the task's verifier/ folder, with verifier/tests.tar counted as the files it unpacks to (see the Docker build
// gotcha in README.md). Prints counts; writes rows to
// <set>/dev/CONTRACT.json.
//
//   bun scripts/repo-tasks/rules-fix/contract.ts [--set tasks/repo/rules-fix-v1] [--only <id,...>]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildImages } from '../matrix.ts';
import { readTar } from '../delivery/lib.ts';

const ENV = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8' };
const docker = (args: string[], timeoutS = 600) => {
  const r = spawnSync('docker', args, { env: ENV, timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 124, stdout: r.stdout?.toString('utf8') ?? '' };
};

const IMAGE_HASHES = [
  'import hashlib, os',
  'rows = []',
  'for d, _, fs in os.walk("/tests"):',
  '    for f in fs:',
  '        p = os.path.join(d, f)',
  '        rows.append(os.path.relpath(p, "/tests") + " " + hashlib.sha256(open(p, "rb").read()).hexdigest())',
  'print("\\n".join(sorted(rows)))',
].join('\n');

function verifierHashes(taskDir: string): string {
  const root = join(taskDir, 'verifier'), rows: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (d === root && n === 'tests.tar') for (const [q, e] of readTar(readFileSync(p))) rows.push(q + ' ' + createHash('sha256').update(e.data).digest('hex'));
      else if (d !== root || !['Dockerfile', 'requirements.lock'].includes(n)) rows.push(relative(root, p) + ' ' + createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(root);
  return rows.sort().join('\n') + '\n';
}

export function contract(taskDir: string): { ok: boolean; image: string; checks: Record<string, boolean> } {
  const toml = Bun.TOML.parse(readFileSync(join(taskDir, 'task.toml'), 'utf8')) as any;
  const patch = readFileSync(join(taskDir, 'oracle', 'fix.patch'), 'utf8');
  const src = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]).sort();
  const imgs = buildImages(taskDir);
  const name = 'rf-contract-' + Math.random().toString(36).slice(2, 10);
  try {
    if (docker(['run', '-d', '--network', 'none', '--name', name, imgs.agent, 'sleep', 'infinity']).status !== 0) return { ok: false, image: imgs.agent_id, checks: {} };
    docker(['cp', join(taskDir, 'oracle'), name + ':/oracle']);
    docker(['cp', join(import.meta.dir, 'contract_check.py'), name + ':/opt/contract_check.py']);
    const r = docker(['exec', '-w', '/work/repo', name, 'python3', '/opt/contract_check.py', JSON.stringify({ base_commit: toml.base_commit, src_files: src, tests_dir: toml.tests_dir })], 900);
    const m = /@@CONTRACT(.*)/.exec(r.stdout);
    const checks: Record<string, boolean> = m ? JSON.parse(m[1]) : {};
    if (m) checks.verifier_image_matches_files = verifierHashes(taskDir) === docker(['run', '--rm', '--network', 'none', imgs.verifier, 'python3', '-c', IMAGE_HASHES]).stdout;
    return { ok: !!m && Object.values(checks).every(Boolean), image: imgs.agent_id, checks };
  } finally {
    docker(['rm', '-f', name]);
  }
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = join(resolve(arg('--set') ?? join(import.meta.dir, '..', '..', '..', 'tasks', 'repo', 'rules-fix-v1')), 'dev');
  const only = arg('--only')?.split(',');
  const ids = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && (!only || only.includes(n))).sort();
  const file = join(dir, 'CONTRACT.json');
  const acc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { set: 'rules-fix-v1', script: 'scripts/repo-tasks/rules-fix/contract.ts', date: '', tasks: {} };
  for (const id of ids) {
    const c = contract(join(dir, id));
    acc.tasks[id] = c;
    console.log(id + ' ok=' + c.ok + ' failing=' + Object.entries(c.checks).filter(([, v]) => !v).map(([k]) => k).join(','));
  }
  acc.date = new Date().toISOString().slice(0, 10);
  acc.tasks = Object.fromEntries(Object.keys(acc.tasks).sort().map((k) => [k, acc.tasks[k]]));
  writeFileSync(file, JSON.stringify(acc, null, 1) + '\n');
  const bad = Object.entries<any>(acc.tasks).filter(([, v]) => !v.ok).map(([k]) => k);
  console.log('CONTRACT: tasks=' + Object.keys(acc.tasks).length + ' failing=' + bad.length + (bad.length ? ' (' + bad.join(',') + ')' : ''));
  process.exit(bad.length ? 1 : 0);
}
