// check.ts --doctor: idempotent bring-up of the public push lane on one checkout (plan R3). It verifies the private pack
// against its pin, extracts the gate tree the pack pins into the cache and checks its id, readies the pinned gitleaks,
// installs .git/hooks/pre-push.local (and a pre-push that runs it, through gstack's managed hook when gstack is
// installed), probes the checkout's commit identity, and pushes a canary through the installed hook to a temp bare
// repository, which must be refused. It never sets core.hooksPath and never prints an address.
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { identityProblems, parseCommit, treeIdOfDir } from './git.ts';
import { hookScript, PRE_PUSH } from './hook.ts';
import { loadPack, type LoadedPack } from './pack.ts';
import { PsError, runSync } from './proc.ts';
import { readLock, readyTool } from './tools.ts';

const GATE = join(import.meta.dir, '..');
const IDENTITY = (JSON.parse(readFileSync(join(GATE, 'rules.json'), 'utf8')) as { identity: { allowed: string[] } }).identity.allowed.map((p) => new RegExp(p, 'i'));

export interface DoctorOptions { pack: string; pin: string; env: Record<string, string>; cacheRoot: string; cwd: string }

const codeOf = (e: unknown) => (e instanceof PsError ? e.code : 'PS-INTERNAL');

export async function doctor(o: DoctorOptions): Promise<{ codes: string[] }> {
  const codes: string[] = [];
  const pack = resolve(o.pack);
  const pin = resolve(o.pin);
  let lp: LoadedPack;
  try { lp = loadPack(pack, pin); } catch (e) { return { codes: [codeOf(e)] }; }
  const git = (args: string[], op: string, extra: { cwd?: string; env?: Record<string, string>; input?: Buffer } = {}) => runSync(['git', ...args], { op, timeoutMs: 120_000, env: extra.env ?? o.env, cwd: extra.cwd ?? o.cwd, input: extra.input });
  const tree = lp.pack.gate_tree;
  const gateDir = join(o.cacheRoot, tree);
  try {
    if (!existsSync(gateDir) || treeIdOfDir(gateDir) !== tree) {
      const archive = git(['archive', '--format=tar', tree], 'git archive');
      if (archive.status !== 0) throw new PsError('PS-GATE-TREE', 'the pinned gate tree is not in this repository');
      const tmp = gateDir + '.tmp-' + randomBytes(4).toString('hex');
      mkdirSync(tmp, { recursive: true });
      try {
        if (runSync(['tar', '-x', '-C', tmp], { op: 'tar -x', timeoutMs: 60_000, env: o.env, input: archive.stdout }).status !== 0 || treeIdOfDir(tmp) !== tree) throw new PsError('PS-GATE-TREE', 'the extracted gate tree does not hash to its id');
        rmSync(gateDir, { recursive: true, force: true });
        renameSync(tmp, gateDir);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  } catch (e) { return { codes: [codeOf(e)] }; }
  const work = mkdtempSync(join(tmpdir(), 'public-safety-doctor-'));
  try {
    try {
      const lock = readLock(join(gateDir, 'tools.lock'));
      readyTool('gitleaks', lock.tools.gitleaks!, { cache: join(o.cacheRoot, 'tools'), dest: join(work, 'bin'), env: o.env });
    } catch (e) { codes.push(codeOf(e)); }
    let hooks = '';
    try {
      if (git(['config', '--get', 'core.hooksPath'], 'git config').status === 0) throw new PsError('PS-HOOK-PATH', 'core.hooksPath is set');
      const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], 'git rev-parse');
      if (common.status !== 0) throw new PsError('PS-USAGE', 'run --doctor inside a git checkout');
      hooks = join(common.stdout.toString('utf8').trim(), 'hooks');
      mkdirSync(hooks, { recursive: true });
      writeFileSync(join(hooks, 'pre-push.local'), hookScript({ gateDir, gateTree: tree, pack, pin }));
      chmodSync(join(hooks, 'pre-push.local'), 0o755);
      const prePush = join(hooks, 'pre-push');
      const redact = join(o.env.HOME ?? '', '.claude', 'skills', 'gstack', 'bin', 'gstack-redact');
      if (!existsSync(prePush) && existsSync(redact)) runSync([redact, 'install-prepush-hook'], { op: 'gstack-redact install-prepush-hook', timeoutMs: 60_000, env: o.env, cwd: o.cwd });
      if (!existsSync(prePush)) { writeFileSync(prePush, PRE_PUSH); chmodSync(prePush, 0o755); }
      if (!readFileSync(prePush, 'utf8').includes('pre-push.local')) throw new PsError('PS-HOOK-CHAIN', 'the existing pre-push hook does not run pre-push.local');
    } catch (e) { codes.push(codeOf(e)); hooks = ''; }
    try { identityProbe(o, git, lp, join(work, 'id')); } catch (e) { codes.push(e instanceof PsError && e.code !== 'PS-ID-CONFIG' ? e.code : 'PS-ID-CONFIG'); }
    if (hooks) {
      try { canary(o, git, hooks, join(work, 'canary')); } catch (e) { codes.push(codeOf(e)); }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { codes: [...new Set(codes)] };
}

type Git = (args: string[], op: string, extra?: { cwd?: string; env?: Record<string, string>; input?: Buffer }) => ReturnType<typeof runSync>;

// A throwaway commit in a temp repository with the checkout's configured identity, read back through the identity gate.
function identityProbe(o: DoctorOptions, git: Git, lp: LoadedPack, dir: string): void {
  const ident = (v: string) => {
    const r = git(['var', v], 'git var');
    const m = /^(.*) <([^>]*)> \d+ [+-]\d{4}$/.exec(r.stdout.toString('utf8').trim());
    if (r.status !== 0 || !m) throw new PsError('PS-ID-CONFIG', 'no commit identity');
    return { name: m[1]!, email: m[2]! };
  };
  const a = ident('GIT_AUTHOR_IDENT');
  const c = ident('GIT_COMMITTER_IDENT');
  mkdirSync(dir, { recursive: true });
  const env = { ...o.env, GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_COMMITTER_NAME: c.name, GIT_COMMITTER_EMAIL: c.email };
  if (git(['init', '-q'], 'git init', { cwd: dir, env }).status !== 0 || git(['commit', '-q', '--allow-empty', '-m', 'public-safety identity probe'], 'git commit', { cwd: dir, env }).status !== 0) throw new PsError('PS-ID-CONFIG', 'the probe commit failed');
  const raw = git(['cat-file', 'commit', 'HEAD'], 'git cat-file', { cwd: dir, env });
  if (identityProblems(parseCommit(raw.stdout), IDENTITY, lp).length) throw new PsError('PS-ID-CONFIG', 'the checkout identity is not a GitHub noreply address');
}

// Push a commit holding a synthetic key-shaped canary through copies of the installed hooks; it must be refused.
function canary(o: DoctorOptions, git: Git, hooks: string, dir: string): void {
  const bare = join(dir, 'public.git');
  const wt = join(dir, 'work');
  mkdirSync(wt, { recursive: true });
  const env = { ...o.env, PATH: dirname(process.execPath) + ':' + (o.env.PATH ?? '/usr/bin:/bin'), GIT_AUTHOR_NAME: 'canary', GIT_AUTHOR_EMAIL: '0+public-safety-canary@users.noreply.github.com', GIT_COMMITTER_NAME: 'canary', GIT_COMMITTER_EMAIL: '0+public-safety-canary@users.noreply.github.com' };
  const g = (args: string[], op: string, cwd = wt) => { const r = git(args, op, { cwd, env }); if (r.status !== 0) throw new PsError('PS-CANARY', op + ' failed while setting up the canary'); return r; };
  g(['init', '-q', '--bare', bare], 'git init --bare', dir);
  g(['init', '-q'], 'git init');
  writeFileSync(join(wt, 'README.md'), '# canary\n');
  g(['add', 'README.md'], 'git add');
  g(['commit', '-q', '-m', 'base'], 'git commit');
  g(['remote', 'add', 'origin', bare], 'git remote add');
  g(['push', '-q', 'origin', 'HEAD:refs/heads/main'], 'git push base');
  g(['fetch', '-q', 'origin'], 'git fetch');
  for (const h of ['pre-push', 'pre-push.local']) copyFileSync(join(hooks, h), join(wt, '.git', 'hooks', h));
  const alnum = randomBytes(32).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(30, 'A');
  writeFileSync(join(wt, 'docs-canary.md'), 'canary ' + 'sk-' + 'ant-api03-' + alnum + '\n');
  g(['add', 'docs-canary.md'], 'git add');
  g(['commit', '-q', '-m', 'canary'], 'git commit');
  const push = git(['push', 'origin', 'HEAD:refs/heads/public-safety-canary'], 'git push canary', { cwd: wt, env: { ...env, PUBLIC_SAFETY_TEST_FORCE_PUBLIC: '1' } });
  if (push.status === 0 || !push.stderr.toString('utf8').includes('PS-HOOK-1')) throw new PsError('PS-CANARY', 'the installed hook did not refuse the canary push');
}
