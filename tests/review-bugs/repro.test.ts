import { describe, expect, test } from 'bun:test';
import type { Candidate } from '../../scripts/review-bugs/mine.ts';
import type { ScreenLine } from '../../scripts/review-bugs/screen.ts';
import { addedTestNames, classify, jobScript, langOf, shard, stageRefs, testScript, type Job } from '../../scripts/review-bugs/repro.ts';

const files = (have: Record<string, string>) => ({ has: (p: string) => p in have, read: (p: string) => have[p] ?? null });
const job = (id: string, repo: string): Job => ({ id, unit: 'u', bug: 0, repo, lang: 'go', head: 'h'.repeat(40), fix: 'f'.repeat(40), tests: ["pkg/a b_test.go"], image: 'golang:1.25', script: "go test './pkg'" });

describe('repro jobs', () => {
  test('find the language of a path', () => {
    expect([langOf('a.go'), langOf('a.rs'), langOf('a.py'), langOf('a.mts'), langOf('a.jsx'), langOf('a.md')]).toEqual(['go', 'rust', 'python', 'ts', 'ts', null]);
  });

  test('read the test names a fix adds, per language', () => {
    expect(addedTestNames('go', '+++ b/x_test.go\n+func TestLast(t *testing.T) {\n func TestOld(t *testing.T) {')).toEqual(['TestLast']);
    expect(addedTestNames('rust', '+    #[test]\n+    fn keeps_last() {\n+    pub async fn other() {')).toEqual(['keeps_last', 'other']);
    expect(addedTestNames('python', '+def test_last():\n+    async def test_async(x):\n+def helper():')).toEqual(['test_last', 'test_async']);
    expect(addedTestNames('ts', "+  it('keeps the last item', () => {\n+test.only(\"b\", () => {})\n-it('gone', () => {})")).toEqual(['keeps the last item', 'b']);
  });

  test('build a test command per language from the head tree', () => {
    expect(testScript('go', ['pkg/x/x_test.go', 'pkg/x/y_test.go'], ['TestA', 'TestB'], files({}))).toBe("export GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false; cd /src && go test -count=1 './pkg/x' -run '^(TestA|TestB)$'");
    const rs = testScript('rust', ['crates/core/tests/last.rs'], ['keeps_last'], files({ 'crates/core/Cargo.toml': '' }));
    expect(rs).toContain("cargo test --manifest-path 'crates/core/Cargo.toml' --test 'last' -- 'keeps_last'");
    const py = testScript('python', ['tests/test_a.py'], ['test_a', 'test_b'], files({ 'uv.lock': '' }));
    expect(py).toContain('(uv sync -q --frozen || uv sync -q)');
    expect(py).toContain("python -m pytest -q -p no:cacheprovider 'tests/test_a.py' -k 'test_a or test_b'");
    const mono = testScript('python', ['backend/tests/test_b.py'], [], files({ 'backend/pyproject.toml': '', 'backend/uv.lock': '' }));
    expect(mono).toStartWith("cd /src && cd 'backend' && pip install -q uv");
    expect(mono).toContain("pytest -q -p no:cacheprovider 'tests/test_b.py'");
    const ts = testScript('ts', ['web/src/a.test.ts'], ['keeps (last)'], files({ 'web/package.json': '{"devDependencies":{"vitest":"1"}}', 'pnpm-lock.yaml': '' }));
    expect(ts).toContain('(pnpm install --frozen-lockfile || pnpm install --frozen-lockfile --ignore-scripts)');
    expect(ts).toContain("cd 'web' && npx --no-install vitest run 'src/a.test.ts' -t 'keeps \\(last\\)'");
    expect(testScript('ts', ['a.test.js'], [], files({ 'package.json': '{}' }))).toContain("(npm ci || npm ci --ignore-scripts) && cd '.' && npx --no-install jest 'a.test.js'");
  });

  test('call a bug confirmed only when the tests fail at the head and pass at the fix', () => {
    const pass = { exit: 0, log: 'ok  \tgithub.com/a/b\t0.1s' };
    const fail = { exit: 1, log: '--- FAIL: TestLast (0.00s)\nFAIL' };
    expect(classify('go', fail, pass).status).toBe('confirmed');
    expect(classify('go', pass, pass).status).toBe('not-confirmed');
    expect(classify('go', fail, fail).detail).toBe('the tests did not pass at the fix (exit 1)');
    expect(classify('go', { exit: 2, log: 'x.go:3: undefined: Last\n--- FAIL: TestLast\n[build failed]' }, pass).status).toBe('inconclusive');
    expect(classify('go', { exit: 124, log: '' }, pass).detail).toBe('a run timed out after 1500 s');
    expect(classify('go', { exit: null, log: '' }, pass).detail).toBe('a run did not finish');
    expect(classify('python', { exit: 1, log: '1 failed, 3 passed' }, { exit: 0, log: '4 passed' }).status).toBe('confirmed');
    expect(classify('rust', { exit: 101, log: 'test result: FAILED. 0 passed; 1 failed' }, { exit: 0, log: 'test result: ok. 0 passed; 0 failed' }).status).toBe('inconclusive');
    expect(classify('ts', { exit: 1, log: 'Tests: 1 failed, 2 passed' }, { exit: 0, log: 'Tests: 3 passed' }).status).toBe('confirmed');
    expect(classify('ts', { exit: 1, log: '\x1b[2m Tests \x1b[22m \x1b[1m\x1b[31m1 failed\x1b[39m' }, { exit: 0, log: '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m1 passed\x1b[39m' }).status).toBe('confirmed');
  });

  test('the job script lays the fix tests over the head and bounds each run', () => {
    const s = jobScript(job('j1', 'acme/web'));
    expect(s).toContain('git clone -q --filter=blob:none https://github.com/acme/web.git $R/src/acme__web');
    expect(s).toContain("git -C $w checkout " + 'f'.repeat(40) + " -- 'pkg/a b_test.go'");
    expect(s).toContain('timeout 1500 sudo docker run --rm');
    expect(s).toContain("bash -c 'go test '\\''./pkg'\\'''");
    expect(s.split('\n').filter((l) => /^run (head|fix) /.test(l))).toEqual(['run head ' + 'h'.repeat(40), 'run fix ' + 'f'.repeat(40)]);
  });

  test('shards keep a repository on one VM and balance job counts', () => {
    const jobs = [...['a1', 'a2', 'a3', 'a4'].map((i) => job(i, 'x/a')), ...['b1', 'b2'].map((i) => job(i, 'x/b')), ...['c1', 'c2'].map((i) => job(i, 'x/c')), job('d1', 'x/d')];
    const g = shard(jobs, 3);
    expect(g.map((x) => x.length).sort()).toEqual([3, 2, 4].sort());
    for (const grp of g) for (const j of grp) expect(g.filter((o) => o.some((k) => k.repo === j.repo)).length).toBe(1);
    expect(shard(jobs.slice(0, 1), 4).length).toBe(1);
  });
});

describe('repro stages', () => {
  const bug = (path: string) => ({ path, line: 1, source: { kind: 'fix-pr' as const, url: '', text: '' }, fix: { commit: 'f', pr: 2, kind: 'later-pr' as const, tests: ['t_test.go'] } });
  const c = (id: string, stratum: Candidate['stratum'], paths: string[], head: string | null = 'h'): Candidate => ({ id, stratum, repo: 'a/a', pr: 1, title: '', merged_at: '', head, base: 'b', diff_lines: 50, reinject: false, bugs: paths.map(bug) });
  const cands = [c('s3', 'S3', ['a.go', 'b.go']), c('gone', 'S3', ['c.go'], null), c('s1', 'S1', ['d.go'])];
  test('s3 takes every S3 candidate bug with a head, before any screen', () => {
    expect(stageRefs('s3', cands, [])).toEqual([{ unit: 's3', bug: 0, file: 'a.go' }, { unit: 's3', bug: 1, file: 'b.go' }]);
  });
  test('kept takes the S1 and S2 bugs the screen kept, at the file the judges named', () => {
    const lines = [{ unit: 's1', bug: 0, kept: true, final: { file: 'e.go' } }, { unit: 's3', bug: 0, kept: true, final: { file: 'a.go' } }, { unit: 's1', bug: 1, kept: false, final: null }] as unknown as ScreenLine[];
    expect(stageRefs('kept', cands, lines)).toEqual([{ unit: 's1', bug: 0, file: 'e.go' }]);
  });
});

