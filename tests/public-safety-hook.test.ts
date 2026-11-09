// The public-safety push lane: check.ts --hook, the pre-push.local wrapper and check.ts --doctor.
//
// Value: protects=a push to the public repository goes through only when the pinned gate copy exits 0 and prints a
// receipt for every pushed ref, so a branch that rewrites the gate cannot admit itself; fails_when=the wrapper lets a push
// through on exit 2, a missing bun, a kill or a malformed receipt, a new branch is not scanned from its merge base, a
// deletion is scanned, one bad ref in a multi-ref push passes, a hostile candidate tree that edits check.ts, rules.json,
// allow.json and the hook pushes a private canary, or the doctor is not idempotent, prints an address, sets
// core.hooksPath or overwrites a foreign pre-push hook; why_new=public-first pushes need a local gate in front of
// them; seam=real git pushes to temp bare repositories under a scrubbed environment, with the URL match forced by the
// test-only flag; no_claim=GitHub-side protections and the private lane.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeIdOfDir } from '../scripts/public-safety/lib/git.ts';
import { hookScript } from '../scripts/public-safety/lib/hook.ts';
import { buildPack, check, GATE, gitleaksReady, HOME, keyCanary, rand, repo, scrubbedEnv, writePack } from './public-safety-fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-hook-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const READY = gitleaksReady();
const PUBLIC = 'https://github.com/garrytan/g-harness-evals.git';
const ZERO = '0'.repeat(40);
let n = 0;

function lane() {
  const dir = join(tmp, 'lane' + ++n);
  const bare = join(dir, 'public.git');
  mkdirSync(dir, { recursive: true });
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: scrubbedEnv(HOME) });
  const r = repo(join(dir, 'work'));
  const base = r.commit({ 'docs/methods.md': '# Methods\n' }, 'base');
  r.g('remote', 'add', 'origin', bare);
  r.g('push', '-q', 'origin', 'main');
  r.g('fetch', '-q', 'origin');
  return { ...r, bare, base, root: dir };
}

const packFor = (dir: string, values: string[] = []) => writePack(join(dir, 'pack'), buildPack({ gateTree: treeIdOfDir(GATE), values }));
const hook = (l: ReturnType<typeof lane>, files: { pack: string; pin: string }, input: string, url = PUBLIC) => check(['--hook', 'origin', url, '--private-pack', files.pack, '--pin', files.pin], { cwd: l.dir, input });

test.skipIf(!READY)('--hook: other remotes pass untouched, the public one needs the pinned pack and the gate tree it names', () => {
  const l = lane();
  const head = l.commit({ 'docs/a.md': 'a\n' });
  const line = 'refs/heads/main ' + head + ' refs/heads/main ' + l.base + '\n';
  const other = check(['--hook', 'origin', 'https://github.com/garrytan/harness-evals.git'], { cwd: l.dir, input: line });
  expect(other).toMatchObject({ status: 0, stdout: 'PUBLIC_SAFETY: not-public remote\n' });
  const none = check(['--hook', 'origin', PUBLIC], { cwd: l.dir, input: line });
  expect(none.status).toBe(3);
  expect(none.stdout).toMatch(/^PS-PACK-MISSING /m);
  const stale = writePack(join(l.root, 'stale'), buildPack({ gateTree: 'b'.repeat(40) }));
  expect(hook(l, stale, line).stdout).toMatch(/^PS-GATE-TREE /m);
  const ok = hook(l, packFor(l.root), line);
  expect(ok.status).toBe(0);
  expect(ok.stdout).toMatch(new RegExp('^PUBLIC_SAFETY: ok ref=refs/heads/main head=' + head + ' gate=[0-9a-f]{12} pack=[0-9a-f]{12} objects=4$', 'm'));
}, 120_000);

test.skipIf(!READY)('--hook: a new branch scans from the merge base with the fetched public main, a deletion passes unscanned, and each ref stands alone', () => {
  const l = lane();
  const files = packFor(l.root);
  l.g('checkout', '-q', '-b', 'topic');
  const clean = l.commit({ 'docs/topic.md': 'topic\n' });
  const fresh = hook(l, files, 'refs/heads/topic ' + clean + ' refs/heads/topic ' + ZERO + '\n');
  expect(fresh.status).toBe(0);
  expect(fresh.stdout).toContain('ref=refs/heads/topic head=' + clean);
  expect(fresh.stdout).toContain('objects=4');
  const del = hook(l, files, '(delete) ' + ZERO + ' refs/heads/old ' + l.base + '\n');
  expect(del.status).toBe(0);
  expect(del.stdout.trim()).toMatch(/ref=refs\/heads\/old head=0{40} .* objects=0$/);
  l.g('checkout', '-q', '-b', 'leaky', 'main');
  const key = keyCanary();
  const leaky = l.commit({ 'docs/leak.md': 'k ' + key + '\n' });
  const multi = hook(l, files, ['refs/heads/topic ' + clean + ' refs/heads/topic ' + ZERO, 'refs/heads/leaky ' + leaky + ' refs/heads/leaky ' + ZERO, 'refs/tags/v1 ' + clean + ' refs/tags/v1 ' + ZERO].join('\n') + '\n');
  expect(multi.status).toBe(1);
  expect(multi.stdout).toContain('PS-KEY-SHAPE docs/leak.md:1');
  expect(multi.stdout).toMatch(/^PS-REF ref:refs\/tags\/v1:0 /m);
  expect(multi.stdout).not.toContain('PUBLIC_SAFETY: ok');
  expect(multi.all).not.toContain(key);
  const orphan = repo(join(l.root, 'orphan'));
  const o = orphan.commit({ 'docs/x.md': 'x\n' });
  const noBase = check(['--hook', 'origin', PUBLIC, '--private-pack', files.pack, '--pin', files.pin], { cwd: orphan.dir, input: 'refs/heads/x ' + o + ' refs/heads/x ' + ZERO + '\n' });
  expect(noBase.status).toBe(3);
  expect(noBase.stdout).toMatch(/^PS-BASE /m);
}, 120_000);

test('the wrapper refuses on exit 2, a missing bun, a kill and a malformed or missing receipt, and allows a full receipt', () => {
  const dir = join(tmp, 'wrapper');
  const sha = 'c'.repeat(40);
  const tree = 'd'.repeat(40);
  const input = 'refs/heads/x ' + sha + ' refs/heads/x ' + ZERO + '\n';
  const run = (body: string, env: Record<string, string> = {}) => {
    const gate = join(dir, 'gate' + ++n);
    mkdirSync(gate, { recursive: true });
    writeFileSync(join(gate, 'check.ts'), body);
    const script = join(gate, 'pre-push.local');
    writeFileSync(script, hookScript({ gateDir: gate, gateTree: tree, pack: join(gate, 'pack.json'), pin: join(gate, 'pack.sha256') }));
    chmodSync(script, 0o755);
    const r = spawnSync('bash', [script, 'origin', PUBLIC], { input, env: { ...scrubbedEnv(join(dir, 'home')), ...env }, encoding: 'utf8' });
    return { status: r.status, err: r.stderr };
  };
  const receipt = 'PUBLIC_SAFETY: ok ref=refs/heads/x head=' + sha + ' gate=' + tree.slice(0, 12) + ' pack=' + 'e'.repeat(12) + ' objects=4';
  expect(run('console.log(' + JSON.stringify(receipt) + ');').status).toBe(0);
  expect(run('console.log("PUBLIC_SAFETY: not-public remote");').status).toBe(0);
  const cases: [string, string, Record<string, string>?][] = [
    ['process.exit(2);', 'PS-HOOK-2'],
    ['process.exit(3);', 'PS-HOOK-3'],
    ['console.log(' + JSON.stringify(receipt) + ');', 'PS-HOOK-127', { PATH: '/usr/bin:/bin' }],
    ['process.kill(process.pid, "SIGKILL");', 'PS-HOOK-137'],
    ['console.log(' + JSON.stringify(receipt.replace('pack=eeeeeeeeeeee', 'pack=zz')) + ');', 'PS-HOOK-RECEIPT'],
    ['console.log(' + JSON.stringify(receipt.replace(tree.slice(0, 12), 'f'.repeat(12))) + ');', 'PS-HOOK-RECEIPT'],
    ['console.log(' + JSON.stringify(receipt.replace('refs/heads/x', 'refs/heads/y')) + ');', 'PS-HOOK-RECEIPT'],
    ['console.log("all good");', 'PS-HOOK-RECEIPT'],
  ];
  for (const [body, code, env] of cases) {
    const r = run(body, env);
    expect({ code, status: r.status }).toEqual({ code, status: 1 });
    expect(r.err).toContain('push refused (' + code + ')');
    expect(r.err).toContain('--no-verify to a public remote is forbidden');
  }
}, 60_000);

test.skipIf(!READY)('the doctor brings the lane up idempotently, and a hostile tree that weakens the gate still cannot push a private canary', () => {
  const l = lane();
  cpSync(GATE, join(l.dir, 'scripts', 'public-safety'), { recursive: true });
  l.commit({}, 'add the gate');
  l.g('push', '-q', 'origin', 'main');
  l.g('fetch', '-q', 'origin');
  const tree = l.g('rev-parse', 'HEAD:scripts/public-safety');
  expect(tree).toBe(treeIdOfDir(GATE));
  const secret = 'PRIVATE-' + rand(24);
  const files = writePack(join(l.root, 'pack'), buildPack({ gateTree: tree, values: [secret] }));
  for (let i = 0; i < 2; i++) {
    const d = check(['--doctor', '--pack', files.pack, '--pin', files.pin], { cwd: l.dir });
    expect({ i, out: d.stdout, status: d.status }).toEqual({ i, out: 'public-safety: ok\n', status: 0 });
  }
  const hooks = join(l.dir, '.git', 'hooks');
  expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toContain('pre-push.local');
  expect(readFileSync(join(hooks, 'pre-push.local'), 'utf8')).toContain(join('harness-evals', 'public-safety', tree));
  expect(spawnSync('git', ['-C', l.dir, 'config', '--get', 'core.hooksPath']).status).toBe(1);
  const push = (branch: string) => spawnSync('git', ['-C', l.dir, 'push', 'origin', 'HEAD:refs/heads/' + branch], { env: scrubbedEnv(HOME, { PUBLIC_SAFETY_TEST_FORCE_PUBLIC: '1' }), encoding: 'utf8' });
  l.g('checkout', '-q', '-b', 'clean');
  l.commit({ 'docs/clean.md': 'clean\n' });
  const ok = push('clean');
  expect(ok.status).toBe(0);
  expect(ok.stdout + ok.stderr).toContain('PUBLIC_SAFETY: ok ref=refs/heads/clean');
  const receipt = 'PUBLIC_SAFETY: ok ref=refs/heads/hostile head=$(git rev-parse HEAD) gate=' + tree.slice(0, 12) + ' pack=' + 'e'.repeat(12) + ' objects=1';
  l.g('checkout', '-q', '-b', 'hostile', 'main');
  l.commit({
    'scripts/public-safety/check.ts': 'console.log(' + JSON.stringify(receipt) + ');\n',
    'scripts/public-safety/rules.json': '{"rules":[],"spend_paths":[],"identity":{"allowed":[".*"]},"codes":{}}\n',
    'scripts/public-safety/allow.json': '{"schema":"harness-evals-public-safety-allow/1","entries":[]}\n',
    'scripts/public-safety/lib/hook.ts': 'export const PRE_PUSH = "#!/bin/sh\\nexit 0\\n";\n',
    '.githooks/pre-push': '#!/bin/sh\nexit 0\n',
    'bunfig.toml': 'preload = ["./preload.ts"]\n',
    'preload.ts': 'require("node:fs").writeFileSync(' + JSON.stringify(join(l.root, 'preload-ran')) + ', "ran");\n',
    'docs/leak.md': 'note ' + secret + '\n',
  }, 'hostile');
  const refused = push('hostile');
  expect(refused.status).not.toBe(0);
  expect(existsSync(join(l.root, 'preload-ran'))).toBe(false);
  const all = refused.stdout + refused.stderr;
  expect(all).toContain('PS-PRIVATE-VALUE docs/leak.md:1');
  expect(all).toContain('push refused (PS-HOOK-1)');
  expect(all).not.toContain(secret);
  expect(spawnSync('git', ['--git-dir', l.bare, 'rev-parse', '--verify', '-q', 'refs/heads/hostile']).status).not.toBe(0);
}, 240_000);

test.skipIf(!READY)('the doctor reports a bad identity, a foreign pre-push hook, core.hooksPath and a missing pack, and never prints the address', () => {
  const bad = 'dev.' + rand(6) + '@example.com';
  const l = lane();
  cpSync(GATE, join(l.dir, 'scripts', 'public-safety'), { recursive: true });
  l.commit({}, 'add the gate');
  const files = writePack(join(l.root, 'pack'), buildPack({ gateTree: l.g('rev-parse', 'HEAD:scripts/public-safety') }));
  l.g('config', 'user.email', bad);
  const id = check(['--doctor', '--pack', files.pack, '--pin', files.pin], { cwd: l.dir });
  expect({ out: id.stdout, status: id.status }).toEqual({ out: 'public-safety: fail PS-ID-CONFIG\n', status: 1 });
  expect(id.all).not.toContain(bad);
  l.g('config', 'user.email', '1+tester@users.noreply.github.com');
  writeFileSync(join(l.dir, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n');
  expect(check(['--doctor', '--pack', files.pack, '--pin', files.pin], { cwd: l.dir }).stdout).toBe('public-safety: fail PS-HOOK-CHAIN\n');
  rmSync(join(l.dir, '.git', 'hooks', 'pre-push'));
  l.g('config', 'core.hooksPath', '.githooks');
  expect(check(['--doctor', '--pack', files.pack, '--pin', files.pin], { cwd: l.dir }).stdout).toBe('public-safety: fail PS-HOOK-PATH\n');
  l.g('config', '--unset', 'core.hooksPath');
  const missing = check(['--doctor', '--pack', join(l.root, 'absent.json'), '--pin', files.pin], { cwd: l.dir });
  expect({ out: missing.stdout, status: missing.status }).toEqual({ out: 'public-safety: fail PS-PACK-MISSING\n', status: 3 });
  writeFileSync(files.pin, 'a'.repeat(64) + '\n');
  expect(check(['--doctor', '--pack', files.pack, '--pin', files.pin], { cwd: l.dir }).stdout).toBe('public-safety: fail PS-PACK-SHA\n');
  expect(existsSync(join(l.dir, '.git', 'hooks', 'pre-push.local'))).toBe(true);
}, 240_000);
