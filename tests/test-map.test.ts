import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'scripts/ci/test-map');
const py = (...args: string[]) => spawnSync('python3', args, { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });

// Value: protects=the strace parser resolves a relative open through the process's cwd, keeps directory listings apart
// from paths, drops bun's startup config discovery and paths outside the checkout, and records git calls with their cwd;
// fails_when=any of those reads lands in the wrong list or is lost; why_new=the nightly test map (internal-task);
// seam=parse.py over a hand-written strace -f -y log; no_claim=strace's own output format across versions.
test('parse.py turns one strace log into repo paths, listings and git calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-map-parse-'));
  const root = join(dir, 'repo');
  mkdirSync(root);
  const log = [
    '100  getdents64(3<' + root + '/tests>, 0x1 /* 3 entries */, 8192) = 72',
    '100  openat(AT_FDCWD<' + root + '>, "tests/a.test.ts", O_RDONLY) = 3<' + root + '/tests/a.test.ts>',
    '100  openat(AT_FDCWD<' + root + '>, "src/a.ts", O_RDONLY) = 4<' + root + '/src/a.ts>',
    '100  newfstatat(AT_FDCWD<' + root + '>, "src/missing.ts", 0x7f, 0) = -1 ENOENT (No such file or directory)',
    '100  getdents64(5<' + root + '/data>, 0x1 /* 2 entries */, 8192) = 48',
    '100  openat(AT_FDCWD<' + root + '>, "/etc/hosts", O_RDONLY) = 6</etc/hosts>',
    '100  clone3({flags=CLONE_VM}, 88 <unfinished ...>',
    '100  <... clone3 resumed>) = 101',
    '101  chdir("harnesses") = 0',
    '101  stat("h/Dockerfile", {st_mode=S_IFREG}) = 0',
    '101  execve("/usr/bin/git", ["git", "show", "abc:harnesses/h/pin.json"], 0x1 /* 3 vars */) = 0',
    '101  openat(AT_FDCWD<' + root + '/harnesses>, "../.git/HEAD", O_RDONLY) = 3<' + root + '/.git/HEAD>',
  ].join('\n') + '\n';
  writeFileSync(join(dir, 'a.log'), log);
  const r = py(join(DIR, 'parse.py'), join(dir, 'a.log'), root, join(dir, 'a.json'), 'tests/a.test.ts');
  expect(r.status).toBe(0);
  const d = JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8'));
  expect(d.paths).toEqual(['harnesses', 'harnesses/h/Dockerfile', 'src/a.ts', 'tests/a.test.ts']);
  expect(d.missing).toEqual(['src/missing.ts']);
  expect(d.dirs).toEqual(['data']);
  expect(d.startup_dirs).toEqual(['tests']);
  expect(d.execs).toEqual([{ pid: 101, cwd: root + '/harnesses', path: '/usr/bin/git', argv: ['git', 'show', 'abc:harnesses/h/pin.json'], opened_gitdir: true }]);
});

// Value: protects=the map applies the exact reading: path-scoped git calls become paths or trees (git archive <rev>
// harnesses/<h> included), only whole-tree git readers and whole-tree scans go to always, docker contexts and the images
// a test runs become trees, and listings stay apart; fails_when=a scoped git read turns a test into ALWAYS or a whole-tree
// read is mapped as scoped; why_new=the nightly test map (internal-task); seam=build-map.py over synthetic parse records;
// no_claim=the real suite's traces.
test('build-map.py writes a schema 1 map with paths, listings, trees, always and weights', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-map-build-'));
  const root = '/r/repo';
  mkdirSync(join(dir, 'json'));
  const rec = (paths: string[], execs: unknown[] = [], dirs: string[] = []) => ({ paths, missing: [], dirs, execs });
  const git = (cwd: string, ...argv: string[]) => ({ pid: 1, cwd, path: '/usr/bin/git', argv: ['git', ...argv], opened_gitdir: true });
  const docker = (...argv: string[]) => ({ pid: 2, cwd: root, path: '/usr/bin/docker', argv: ['docker', ...argv], opened_gitdir: false });
  const records: Record<string, unknown> = {
    'tests__route.test.ts': rec(['tests/route.test.ts'], [git(root, 'archive', 'abc', 'harnesses/codex'), git(root, 'show', 'abc:harnesses/codex/pin.json'), git(root, 'show', '--format=%H', 'HEAD', '--quiet', '--')]),
    'tests__batch.test.ts': rec(['tests/batch.test.ts'], [git(root, 'cat-file', '--batch')]),
    'tests__status.test.ts': rec(['tests/status.test.ts'], [git(root, 'status', '--porcelain', '--', 'runner/stats'), git('/tmp/elsewhere', 'ls-files')], ['data']),
    'tests__build.test.ts': rec(['tests/build.test.ts'], [docker('build', '-t', 'img:dev', '-f', 'harnesses/h/Dockerfile', 'harnesses/h')]),
    'tests__use.test.ts': rec(['tests/use.test.ts'], [docker('run', '--rm', '-v', root + '/world:/w:ro', 'img:dev', 'true')]),
    'tests__scan.test.ts': rec(Array.from({ length: 50_001 }, (_, i) => 'docs/f' + i + '.md')),
    'tests__sub.test.ts': rec(['tests/sub.test.ts'], [git(root, '-C', 'runner', 'ls-files', '--', 'stats'), git(root + '/scripts', 'grep', 'x', '--', 'ci/*.ts'), git(root + '/harnesses', 'show', 'abc:./h/pin.json')]),
    'tests__fail.test.ts': rec(['tests/fail.test.ts']),
    'tests____snap__.test.ts': rec(['tests/__snap__.test.ts']),
  };
  for (const [f, r] of Object.entries(records)) writeFileSync(join(dir, 'json', f + '.json'), JSON.stringify(r));
  writeFileSync(join(dir, 'timings.tsv'), Object.keys(records).map((f, i) => (f === 'tests____snap__.test.ts' ? 'tests/__snap__.test.ts' : f.replace('__', '/')) + '\t' + (f === 'tests__fail.test.ts' ? 1 : 0) + '\t' + (i + 1) * 100 + '\t0').join('\n') + '\n');
  const out = join(dir, 'map.json.gz');
  const r = py(join(DIR, 'build-map.py'), '--json', join(dir, 'json'), '--timings', join(dir, 'timings.tsv'), '--sha', 'a'.repeat(40), '--root', root, '--out', out, '--generated-at', '2026-11-22T09:00:00Z');
  expect(r.status).toBe(0);
  const m = JSON.parse(gunzipSync(readFileSync(out)).toString());
  expect([m.schema, m.sha, m.generated_at]).toEqual([1, 'a'.repeat(40), '2026-11-22T09:00:00Z']);
  expect(m.tests['tests/route.test.ts']).toEqual({ paths: ['harnesses/codex/pin.json', 'tests/route.test.ts'], dirs: [], trees: ['harnesses/codex'] });
  expect(m.tests['tests/status.test.ts']).toEqual({ paths: ['tests/status.test.ts'], dirs: ['data'], trees: ['runner/stats'] });
  expect(m.tests['tests/build.test.ts'].trees).toEqual(['harnesses/h']);
  expect(m.tests['tests/build.test.ts'].paths).toContain('harnesses/h/Dockerfile');
  expect(m.tests['tests/use.test.ts'].trees).toEqual(['harnesses/h', 'world']);
  expect(m.tests['tests/scan.test.ts']).toEqual({ paths: [], dirs: [], trees: [] });
  expect(m.tests['tests/__snap__.test.ts']).toEqual({ paths: ['tests/__snap__.test.ts'], dirs: [], trees: [] });
  expect(m.tests['tests/sub.test.ts']).toEqual({ paths: ['harnesses/h/pin.json', 'tests/sub.test.ts'], dirs: [], trees: ['runner/stats', 'scripts/ci'] });
  expect(m.always).toEqual({ 'tests/batch.test.ts': ['cat-file --batch'], 'tests/fail.test.ts': ['traced run exited 1'], 'tests/scan.test.ts': ['reads more than 50000 paths'] });
  expect(m.weights_ms['tests/use.test.ts']).toBe(500);
});

// Value: protects=the trace and the tests run with a read-only token and no stored credentials, the write token exists only
// in a push job that runs no repository code, only from main on a schedule or dispatch, and pushes one commit to exactly
// refs/heads/ci-test-map under a lease; fails_when=a pull_request trigger, a workflow-wide write token, a write token in the
// tracing job, repository code in the push job, or a push to any other ref is added; why_new=the nightly test map
// (internal-task-a, internal-task-b's token conditions of 2026-11-22); seam=the workflow's YAML; no_claim=GitHub's ruleset settings.
describe('the test-map workflow', () => {
  type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> };
  const text = readFileSync(join(ROOT, '.github/workflows/test-map.yml'), 'utf8');
  const wf = Bun.YAML.parse(text) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { if: string; 'runs-on': string; needs?: string; permissions: Record<string, string>; steps: Step[] }> };
  const gate = "github.repository == 'garrytan/harness-evals' && github.ref == 'refs/heads/main' && github.event_name != 'pull_request'";
  test('runs only on a schedule or dispatch, from main, in the private repository, on Ubicloud runners', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(wf.jobs)).toEqual(['map', 'push']);
    for (const job of Object.values(wf.jobs)) {
      expect(job.if).toBe(gate);
      expect(job['runs-on']).toStartWith('ubicloud-');
    }
  });
  test('the tracing job can only read and keeps no credentials', () => {
    const job = wf.jobs.map!;
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job.steps[0]!.uses).toStartWith('actions/checkout@');
    expect(job.steps[0]!.with?.['persist-credentials']).toBe(false);
    expect(text.slice(0, text.indexOf('\n  push:'))).not.toContain('github.token');
  });
  test('only the push job can write, it runs no repository code, and only its last step holds the token', () => {
    const job = wf.jobs.push!;
    expect(job.needs).toBe('map');
    expect(job.permissions).toEqual({ contents: 'write' });
    expect(job.steps.map((s) => s.uses?.split('@')[0] ?? 'run')).toEqual(['actions/cache/restore', 'run']);
    const last = job.steps.at(-1)!;
    expect(last.name).toBe('Replace the map on ci-test-map');
    expect(job.steps.filter((s) => JSON.stringify(s.env ?? {}).includes('github.token'))).toEqual([last]);
    expect(last.if).toBe("github.event_name != 'pull_request'");
    expect(last.run).not.toMatch(/\b(bun|bunx|npm|node|python3?|bash|sh) /);
  });
  test('pushes one orphan commit to refs/heads/ci-test-map with a lease, and nowhere else', () => {
    const pushes = [...text.matchAll(/git [^\n]*\bpush\b[^\n]*/g)].map((m) => m[0]);
    expect(pushes).toEqual(['git push --force-with-lease="refs/heads/ci-test-map:$old" "$REMOTE" "$commit:refs/heads/ci-test-map"']);
    const step = wf.jobs.push!.steps.at(-1)!;
    expect(step.run).toContain('git mktree');
    expect(step.run).not.toMatch(/commit-tree[^\n]* -p /);
  });
});
