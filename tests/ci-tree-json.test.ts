import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testedFiles } from '../scripts/ci-tree-json';

const SCRIPT = resolve(import.meta.dir, '..', 'scripts', 'ci-tree-json.ts');
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="6" assertions="9" failures="0" skipped="1" time="1.0">
  <testsuite name="tests/a.test.ts" file="tests/a.test.ts" tests="3" assertions="6" failures="0" skipped="0" time="0.1">
    <testsuite name="a group" file="tests/a.test.ts" line="2" tests="3" assertions="6" failures="0" skipped="0" time="0.1">
      <testcase name="one" classname="" time="0.01" file="tests/a.test.ts" line="3" assertions="2" />
    </testsuite>
  </testsuite>
  <testsuite name="tests/b&amp;c.test.ts" file="./tests/b&amp;c.test.ts" tests="3" assertions="3" failures="0" skipped="1" time="0.1">
  </testsuite>
</testsuites>
`;

function repo(): { dir: string; head: string; tree: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ci-tree-json-'));
  const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } }).stdout.trim();
  git('init', '-q');
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  git('add', 'f.txt');
  git('commit', '-qm', 'c');
  return { dir, head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
}

function run(dir: string, env: Record<string, string>, junit = JUNIT) {
  writeFileSync(join(dir, 'junit.xml'), junit);
  const out = join(dir, 'out', 'tree.json');
  const r = spawnSync(process.execPath, [SCRIPT, '--junit', join(dir, 'junit.xml'), '--out', out], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', RUNNER_OS: 'Linux', ...env } });
  return { status: r.status, stderr: r.stderr, out };
}

// Value: protects=the file list gstack's CI carry checks against the lane inventory (git ls-files 'tests/*.test.ts') is
// read from what bun actually ran, so a test file bun skipped is never claimed as covered; fails_when=the parser keeps a
// leading ./ or escaped names, lists a file twice, sums nested describe-block suites into the test count, or counts skipped and todo tests as run; why_new=ship_lanes_from carries the /ship "bun test tests/" lane from CI only when tree.json covers the
// inventory; seam=none; no_claim=bun's own JUnit output format.
test('testedFiles names each testsuite file once, unescaped and without ./, with the report total less skipped tests as the test count', () => {
  expect(testedFiles(JUNIT)).toEqual({ files: ['tests/a.test.ts', 'tests/b&c.test.ts'], tests: 5, skipped_files: ['tests/b&c.test.ts'] });
  expect(testedFiles('<testsuites tests="0"></testsuites>')).toEqual({ files: [], tests: 0, skipped_files: [] });
  expect(testedFiles('<testsuites tests="2" skipped="2"><testsuite file="tests/s.test.ts" tests="2" skipped="2"></testsuite></testsuites>')).toEqual({ files: ['tests/s.test.ts'], tests: 0, skipped_files: ['tests/s.test.ts'] });
});

// Bun 1.4 JUnit for three files: a runs two of three tests, b skips a whole describe.skipIf block with a nested describe,
// c holds only a todo and a skipped test.
const SKIPS = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="7" assertions="0" failures="0" skipped="5" time="0.02">
  <testsuite name="tests/a.test.ts" file="tests/a.test.ts" tests="3" assertions="0" failures="0" skipped="1" time="0.01">
    <testcase name="a1" classname="" time="0.00003" file="tests/a.test.ts" line="2" assertions="0" />
    <testsuite name="d" file="tests/a.test.ts" line="3" tests="2" assertions="0" failures="0" skipped="1" time="0">
      <testcase name="a2" classname="d" time="0.00003" file="tests/a.test.ts" line="3" assertions="0" />
      <testcase name="a3" classname="d" time="0" file="tests/a.test.ts" line="3" assertions="0">
        <skipped />
      </testcase>
    </testsuite>
  </testsuite>
  <testsuite name="tests/b.test.ts" file="tests/b.test.ts" tests="2" assertions="0" failures="0" skipped="2" time="0.001">
    <testsuite name="all" file="tests/b.test.ts" line="2" tests="2" assertions="0" failures="0" skipped="2" time="0">
      <testcase name="b1" classname="all" time="0" file="tests/b.test.ts" line="2" assertions="0">
        <skipped />
      </testcase>
      <testsuite name="inner" file="tests/b.test.ts" line="2" tests="1" assertions="0" failures="0" skipped="1" time="0">
        <testcase name="b2" classname="inner &gt; all" time="0" file="tests/b.test.ts" line="2" assertions="0">
          <skipped />
        </testcase>
      </testsuite>
    </testsuite>
  </testsuite>
  <testsuite name="tests/c.test.ts" file="tests/c.test.ts" tests="2" assertions="0" failures="0" skipped="2" time="0.0003">
    <testcase name="c1" classname="" time="0" file="tests/c.test.ts" line="2" assertions="0">
      <skipped message="TODO" />
    </testcase>
    <testcase name="c2" classname="" time="0" file="tests/c.test.ts" line="3" assertions="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>
`;

// Value: protects=a test file with any test CI skipped (a Docker image, drive path or gstack install the runner lacks) is
// listed in skipped_files, so gstack's carry runs it on the /ship machine instead of counting it as covered; fails_when=a
// fully or partly skipped file is missing from the list, a file with no skipped test is listed, or a nested describe
// block's counts decide the file; why_new=the #240 /ship reviews (tests/internal-network-harnesses.test.ts skips whole in
// CI, tests/installer-cc-codex.test.ts skips only its container tests); seam=none; no_claim=gstack's per_file run of the
// listed files.
test('testedFiles lists the files with any skipped test, fully or partly skipped, by each file\'s own testsuite', () => {
  expect(testedFiles(SKIPS)).toEqual({ files: ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'], tests: 2, skipped_files: ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'] });
  const partly = '<testsuites tests="3" skipped="1"><testsuite file="tests/p.test.ts" tests="2" skipped="1"><testcase name="ran" file="tests/p.test.ts" /><testcase name="container" file="tests/p.test.ts"><skipped /></testcase></testsuite><testsuite file="tests/q.test.ts" tests="1" skipped="0"><testcase name="ran" file="tests/q.test.ts" /></testsuite></testsuites>';
  expect(testedFiles(partly)).toEqual({ files: ['tests/p.test.ts', 'tests/q.test.ts'], tests: 2, skipped_files: ['tests/p.test.ts'] });
});

// Value: protects=tree.json names the run, attempt, event, the tested commit and its tree, and the pull request head
// separately from GitHub's merge commit, which gstack's verifier requires for a pull_request run; fails_when=head_sha
// falls back to the merge commit while PR_HEAD_SHA is set, or the tree is not HEAD's; why_new=the ci/checks run profile;
// seam=a throwaway git repository; no_claim=gstack's verifyRun.
test('writes tree.json for the commit the run tested', () => {
  const { dir, head, tree } = repo();
  const r = run(dir, { GITHUB_SHA: head, GITHUB_EVENT_NAME: 'pull_request', PR_HEAD_SHA: 'a'.repeat(40) });
  expect(r.status).toBe(0);
  expect(JSON.parse(readFileSync(r.out, 'utf8'))).toEqual({ run_id: 42, run_attempt: 2, event: 'pull_request', os: 'Linux', sha: head, head_sha: 'a'.repeat(40), tree, files: ['tests/a.test.ts', 'tests/b&c.test.ts'], tests: 5, skipped_files: ['tests/b&c.test.ts'] });
  const push = run(dir, { GITHUB_SHA: head, GITHUB_EVENT_NAME: 'push' });
  expect(JSON.parse(readFileSync(push.out, 'utf8')).head_sha).toBe(head);
});

// Value: protects=tree.json still covers the whole suite when scripts/run-tests.sh splits it into phases with a JUnit
// report each; fails_when=only the first or last --junit is read, tests are not summed, or skipped_files drops a phase;
// why_new=the parallel test step (internal-task); seam=a throwaway git repository; no_claim=bun's own JUnit output format.
test('merges several --junit reports into one record', () => {
  const { dir, head, tree } = repo();
  const late = '<testsuites name="bun test" tests="2" skipped="1"><testsuite name="tests/z.test.ts" file="./tests/z.test.ts" tests="2" skipped="1"></testsuite></testsuites>';
  writeFileSync(join(dir, 'junit.xml'), JUNIT);
  writeFileSync(join(dir, 'late.xml'), late);
  const out = join(dir, 'out', 'tree.json');
  const r = spawnSync(process.execPath, [SCRIPT, '--junit', join(dir, 'junit.xml'), '--junit', join(dir, 'late.xml'), '--out', out], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', RUNNER_OS: 'Linux', GITHUB_SHA: head, GITHUB_EVENT_NAME: 'push' } });
  expect(r.status).toBe(0);
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  expect({ tree: rec.tree, files: rec.files, tests: rec.tests, skipped_files: rec.skipped_files }).toEqual({ tree, files: ['tests/a.test.ts', 'tests/b&c.test.ts', 'tests/z.test.ts'], tests: 6, skipped_files: ['tests/b&c.test.ts', 'tests/z.test.ts'] });
});

// Value: protects=tree.json never counts a flag as a report or one report twice; fails_when=--junit takes a following flag
// as its path, a valueless trailing --junit is dropped, or a repeated report is summed twice; why_new=the internal-task review
// (adversarial finding 4); seam=a throwaway git repository; no_claim=bun's own JUnit output format.
test('refuses a flag as a --junit value and a report given twice', () => {
  const { dir, head } = repo();
  writeFileSync(join(dir, 'junit.xml'), JUNIT);
  const out = join(dir, 'out', 'tree.json');
  const env = { PATH: process.env.PATH ?? '', HOME: dir, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', RUNNER_OS: 'Linux', GITHUB_SHA: head, GITHUB_EVENT_NAME: 'push' };
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
  const cases: [string[], string][] = [
    [['--junit', '--out', out], '--junit needs a report path, not --out'],
    [['--junit', join(dir, 'junit.xml'), '--out', out, '--junit'], '--junit needs a report path, not nothing'],
    [['--junit', join(dir, 'junit.xml'), '--junit', './junit.xml', '--out', out], 'a --junit report is given twice'],
  ];
  for (const [args, message] of cases) {
    const r = run(...args);
    expect({ args, status: r.status, message: r.stderr.includes(message), written: existsSync(out) }).toEqual({ args, status: 2, message: true, written: false });
  }
});

// Value: protects=no tree.json is written for a commit the job did not test or for a report with no tests, so CI carry
// never vouches for the wrong tree or an empty run; fails_when=the HEAD check or the empty-report check is dropped;
// why_new=the ci/checks run profile; seam=a throwaway git repository; no_claim=gstack's own no_tests refusal.
test('refuses a HEAD other than GITHUB_SHA and a report with no tests', () => {
  const { dir, head } = repo();
  const wrong = run(dir, { GITHUB_SHA: 'b'.repeat(40), GITHUB_EVENT_NAME: 'push' });
  expect(wrong.status).toBe(1);
  expect(wrong.stderr).toContain('not GITHUB_SHA');
  const empty = run(dir, { GITHUB_SHA: head, GITHUB_EVENT_NAME: 'push' }, '<testsuites tests="0"></testsuites>');
  expect(empty.status).toBe(1);
  expect(empty.stderr).toContain('names no test file');
});

// Value: protects=no tree.json is written without the runner OS, so gstack's carry never meets a record with no os and
// refuses it as os_mismatch after the fact; fails_when=os falls back to an empty or default value when RUNNER_OS is unset;
// why_new=tree.json's os field (internal-task); seam=a throwaway git repository; no_claim=gstack's own os check.
test('refuses to write tree.json when RUNNER_OS is unset', () => {
  const { dir, head } = repo();
  const r = run(dir, { GITHUB_SHA: head, GITHUB_EVENT_NAME: 'push', RUNNER_OS: '' });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('RUNNER_OS is not set');
  expect(existsSync(r.out)).toBe(false);
});
