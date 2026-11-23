import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BUILDERS, EXPORT_FULL_RUN } from '../scripts/ci/select-tests.ts';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts/ci/select-tests.ts');
const NOW = '2026-11-22T12:00:00Z';
const TEMP: string[] = [];
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP.push(d); return d; };
afterAll(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

function sh(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dirname(cwd), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@invalid' } });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
const put = (dir: string, files: Record<string, string>) => {
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
};

/** A repository whose base commit has two mapped tests, an ALWAYS test, a listed directory and a docker context. */
function repo() {
  const dir = join(temp('select-tests-'), 'repo');
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  put(dir, {
    'package.json': '{}\n', 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'tests/a.test.ts': 'a\n', 'tests/b.test.ts': 'b\n', 'tests/x.test.ts': 'x\n',
    'data/one.json': '1\n', 'data/dir/f.json': 'f\n', 'docs/page.md': 'p\n', 'harnesses/h/Dockerfile': 'FROM x\n',
  });
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'base');
  const base = sh(dir, 'rev-parse', 'HEAD');
  return { dir, base };
}

const map = (sha: string, generated_at = '2026-11-22T06:00:00Z') => ({
  schema: 1, sha, generated_at,
  tests: {
    'tests/a.test.ts': { paths: ['src/a.ts', 'tests/a.test.ts'], dirs: ['data'], trees: [] },
    'tests/b.test.ts': { paths: ['src/b.ts', 'tests/b.test.ts'], dirs: [], trees: ['harnesses/h'] },
    'tests/x.test.ts': { paths: [], dirs: [], trees: [] },
  },
  always: { 'tests/x.test.ts': ['git ls-files (whole tree)'] },
  weights_ms: { 'tests/a.test.ts': 10, 'tests/b.test.ts': 20, 'tests/x.test.ts': 30 },
});

/** Runs the selector for a change made on a branch off the base; returns its stdout lines and its reason. */
function run(change: (dir: string) => void, mapBody?: unknown | Uint8Array | null, opts: { now?: string } = {}) {
  const { dir, base } = repo();
  sh(dir, 'checkout', '-q', '-b', 'pr');
  change(dir);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'change');
  const head = sh(dir, 'rev-parse', 'HEAD');
  const file = join(dir, '..', 'map-' + base.slice(0, 8) + '.json.gz');
  const body = mapBody === undefined ? map(base) : mapBody;
  if (body instanceof Uint8Array) writeFileSync(file, body);
  else if (body !== null) writeFileSync(file, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(typeof body === 'function' ? (body as (d: string) => unknown)(dir) : body))));
  return cli(dir, base, head, body === null ? join(dir, 'no-such-map.json.gz') : file, opts.now ?? NOW);
}

/** The selector as CI runs it: no bunfig.toml, tsconfig.json or .env from the repository. */
function cli(dir: string, base: string, head: string, mapFile: string, now = NOW, extra: string[] = []) {
  const cfg = temp('select-tests-cfg-');
  writeFileSync(join(cfg, 'bunfig.toml'), '');
  writeFileSync(join(cfg, 'tsconfig.json'), '{}');
  const r = spawnSync('bun', ['--no-env-file', '--config=' + join(cfg, 'bunfig.toml'), '--tsconfig-override=' + join(cfg, 'tsconfig.json'), SCRIPT, '--base', base, '--head', head, '--map-file', mapFile, '--now', now, ...extra], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir } });
  expect(r.status).toBe(0);
  return { out: r.stdout.trim().split('\n').filter(Boolean), why: r.stderr.trim() };
}

// Value: protects=every way the map can be unusable runs the full suite instead of a stale or foreign selection (the
// Captain's required missing and stale cases among them); fails_when=a missing, unreadable, stale or unrelated map
// yields a file list; why_new=PR test selection (internal-task); seam=the CLI CI runs, over a temp git repository;
// no_claim=the real map's contents.
describe('select-tests falls back to the full suite', () => {
  const edit = (dir: string) => put(dir, { 'src/a.ts': 'a2\n' });
  test('when the map is missing', () => {
    const r = run(edit, null);
    expect(r.out).toEqual(['all']);
    expect(r.why).toContain('no test map');
  });
  test('when the map is unreadable', () => {
    expect(run(edit, new TextEncoder().encode('not gzip')).out).toEqual(['all']);
    const r = run(edit, { schema: 2 });
    expect(r.out).toEqual(['all']);
    expect(r.why).toContain('not schema 1');
  });
  test('when the map is more than 3 days old', () => {
    const r = run(edit, undefined, { now: '2026-11-25T06:00:01Z' });
    expect(r.out).toEqual(['all']);
    expect(r.why).toContain('hours old');
    expect(run(edit, undefined, { now: '2026-11-25T05:59:00Z' }).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
  });
  test("when the map's traced commit is not an ancestor of the base", () => {
    const r = run(edit, (dir: string) => map(sh(dir, 'commit-tree', 'main^{tree}', '-p', 'main', '-m', 'a commit main never reached')));
    expect(r.out).toEqual(['all']);
    expect(r.why).toContain('not an ancestor');
    expect(run(edit, map('f'.repeat(40))).out).toEqual(['all']);
  });
  test('when a FULL_RUN path changes', () => {
    for (const p of ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', '.github/workflows/ci.yml', 'tests/setup/x.ts', 'scripts/run-tests.sh', 'scripts/ci/select-tests.ts']) {
      expect({ p, out: run((dir) => put(dir, { [p]: 'changed\n' })).out }).toEqual({ p, out: ['all'] });
    }
  });
  test('when the map is dated in the future', () => {
    const r = run(edit, (dir: string) => map(sh(dir, 'rev-parse', 'main'), '2026-11-22T14:00:00Z'));
    expect(r.out).toEqual(['all']);
    expect(r.why).toContain('dated in the future');
  });
  test('when a changed file of any kind is one the map ties to no test', () => {
    const r = run((dir) => put(dir, { 'src/c.ts': 'c\n' }));
    expect(r.out).toEqual(['all']);
    expect(r.why).toContain('src/c.ts is a file no test in the map reads');
    for (const p of ['docs/page.md', 'data/one.json', 'data/dir/g.json']) {
      const v = run((dir) => put(dir, { [p]: 'changed\n' }));
      expect({ p, out: v.out, why: v.why }).toEqual({ p, out: ['all'], why: 'full run: ' + p + ' is a file no test in the map reads' });
    }
  });
});

// Value: protects=the exact reading: a mapped path selects its tests, a listed directory only when its entries change,
// a docker context as a whole tree, changed test files and ALWAYS tests always; fails_when=a mapped change misses its
// test or a modified file selects a directory's listers; why_new=PR test selection (internal-task); seam=the CLI over a temp
// git repository; no_claim=the real map's contents.
describe('select-tests picks', () => {
  test('the tests that read a changed path, plus ALWAYS', () => {
    expect(run((dir) => put(dir, { 'src/a.ts': 'a2\n' })).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
  });
  test('a listing test only when the listed directory gains or loses an entry', () => {
    expect(run((dir) => put(dir, { 'data/two.json': '2\n' })).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
    expect(run((dir) => put(dir, { 'data/new/g.json': 'g\n' })).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
  });
  test('a tree reader for any change below its tree', () => {
    expect(run((dir) => put(dir, { 'harnesses/h/deep/file.sh': 'x\n' })).out).toEqual(['tests/b.test.ts', 'tests/x.test.ts']);
  });
  test('a changed or new test file', () => {
    expect(run((dir) => put(dir, { 'tests/new.test.ts': 'n\n' })).out).toEqual(['tests/new.test.ts', 'tests/x.test.ts']);
  });
  test('the listers of a directory that loses an entry, and no full run for a deleted test file', () => {
    expect(run((dir) => rmSync(join(dir, 'data/one.json'))).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
    expect(run((dir) => rmSync(join(dir, 'tests/b.test.ts'))).out).toEqual(['tests/x.test.ts']);
  });
});

// Value: protects=CI's merge-commit invocation lists only files in the tree the tests run in, and picks up tests the base
// changed after the map was traced; fails_when=a test the base deleted after the pull request branched is listed (so
// run-tests.sh --only fails a correct pull request) or a test the base added is missed; why_new=the /ship review of #558
// (red-team and testing findings); seam=the CLI over a temp repository with a real merge commit; no_claim=GitHub's merge.
test('select-tests judges the merge commit CI tests', () => {
  const { dir, base } = repo();
  const file = join(dir, '..', 'map.json.gz');
  writeFileSync(file, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(map(base)))));
  sh(dir, 'checkout', '-q', '-b', 'pr');
  put(dir, { 'src/a.ts': 'a2\n' });
  sh(dir, 'commit', '-q', '-am', 'change');
  sh(dir, 'checkout', '-q', 'main');
  rmSync(join(dir, 'tests/a.test.ts'));
  put(dir, { 'tests/n.test.ts': 'n\n' });
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'main moves on');
  const tip = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'pr');
  const r = cli(dir, tip, sh(dir, 'rev-parse', 'HEAD'), file);
  expect(r.out).toEqual(['tests/n.test.ts', 'tests/x.test.ts']);
  expect(r.why).toContain('and 2 path(s) the base changed after the traced commit');
});

/** The selector for a pull request off a base that moved on (mainChange) after the map was traced. */
type Deps = { paths: string[]; dirs: string[]; trees: string[] };
type MapBody = { always: Record<string, string[]>; tests: Record<string, Deps> };

function drifted(mainChange: (dir: string) => void, prChange: (dir: string) => void, mapOf: (base: string) => unknown = map, extra: string[] = []) {
  const { dir, base } = repo();
  const file = join(dir, '..', 'map.json.gz');
  writeFileSync(file, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(mapOf(base)))));
  mainChange(dir);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'main moves on');
  const tip = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', 'pr');
  prChange(dir);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'change');
  return cli(dir, tip, sh(dir, 'rev-parse', 'HEAD'), file, NOW, extra);
}

// Value: protects=a test whose reads changed with the base after the trace still runs (it is picked by the files it read
// when traced), a build or CI change on the base still runs everything, and every way a trace can say nothing selects the
// test; fails_when=main changes a file test T read so that T now reads the pull request's file, and T is skipped, or an
// empty list passes with no test run; why_new=the /ship review of #558 (second-model blocker at select-tests.ts:151, and
// the targeted reader's testfile_seen finding on #557); seam=the CLI over a temp repository; no_claim=the real map.
describe('select-tests and what the trace cannot see', () => {
  const editA = (dir: string) => put(dir, { 'src/a.ts': 'a2\n' });
  test('picks the tests that read a file the base changed after the traced commit', () => {
    const r = drifted((dir) => put(dir, { 'src/b.ts': "import './a.ts';\n" }), editA);
    expect(r.out).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/x.test.ts']);
    expect(r.why).toContain('and 1 path(s) the base changed after the traced commit');
  });
  test('runs everything when the base changed a FULL_RUN path after the traced commit', () => {
    const r = drifted((dir) => put(dir, { 'package.json': '{"a":1}\n' }), editA);
    expect(r.out).toEqual(['all']);
    expect(r.why).toBe('full run: package.json changed (the base changed it after the traced commit)');
  });
  test('needs no test to read a file only the base added after the traced commit', () => {
    expect(drifted((dir) => put(dir, { 'src/c.ts': 'c\n' }), editA).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
  });
  test('selects a test whose map entry does not hold its own file', () => {
    const m = (base: string) => { const v: MapBody = map(base); v.tests['tests/b.test.ts'].paths = ['src/b.ts']; return v; };
    expect(drifted(() => {}, editA, m).out).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/x.test.ts']);
  });
  test('selects a test the map does not list', () => {
    const m = (base: string) => { const v: MapBody = map(base); delete v.tests['tests/b.test.ts']; return v; };
    expect(drifted(() => {}, editA, m).out).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/x.test.ts']);
  });
  test('runs everything when the selection comes out empty', () => {
    const m = (base: string) => { const v: MapBody = map(base); v.always = {}; v.tests['tests/x.test.ts'].paths = ['tests/x.test.ts']; return v; };
    const r = drifted(() => {}, (dir) => rmSync(join(dir, 'tests/b.test.ts')), m);
    expect(r.out).toEqual(['all']);
    expect(r.why).toBe('full run: the selection is empty');
  });
});

// Value: protects=a selected docker test never runs without the phase-1 builder that makes its image, also when its trace
// ties it to one builder and a new case needs another, and the selector's BUILDERS list matches run-tests.sh's;
// fails_when=a test that runs a built image is selected alone (it skips on a clean runner), a docker test the map ties to
// the claude-code builder gets only that builder, or the two lists drift; why_new=the /ship review of #558 (second-model
// findings at select-tests.ts:107 and :117, internal-task's round grant and the export-selection follow-up);
// seam=the CLI over a temp repository; no_claim=docker itself.
test('select-tests adds the image builders a selected docker test needs', () => {
  const { dir } = repo();
  put(dir, {
    'tests/adapter-conformance.test.ts': 'b\n', 'tests/claude-code-adapter.test.ts': 'b\n', 'tests/codex-adapter.test.ts': 'b\n',
    'tests/sdk.test.ts': "spawnSync('docker', ['run', IMAGE]);\n", 'tests/plain.test.ts': "spawnSync('docker', ['run', 'x']);\n",
    'tests/ctx.test.ts': "readFileSync('harnesses/cc/Dockerfile');\n", 'harnesses/cc/Dockerfile': 'FROM x\n', 'src/s.ts': 's\n', 'src/p.ts': 'p\n', 'src/c.ts': 'c\n',
  });
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'builders');
  const base = sh(dir, 'rev-parse', 'HEAD');
  const m = map(base);
  Object.assign(m.tests, {
    'tests/adapter-conformance.test.ts': { paths: ['tests/adapter-conformance.test.ts'], dirs: [], trees: [] },
    'tests/claude-code-adapter.test.ts': { paths: ['tests/claude-code-adapter.test.ts'], dirs: [], trees: ['harnesses/cc'] },
    'tests/codex-adapter.test.ts': { paths: ['tests/codex-adapter.test.ts'], dirs: [], trees: [] },
    'tests/sdk.test.ts': { paths: ['src/s.ts', 'tests/sdk.test.ts'], dirs: [], trees: ['harnesses/cc'] },
    'tests/plain.test.ts': { paths: ['src/p.ts', 'tests/plain.test.ts'], dirs: [], trees: [] },
    'tests/ctx.test.ts': { paths: ['src/c.ts', 'tests/ctx.test.ts'], dirs: [], trees: ['harnesses/cc'] },
  });
  const file = join(dir, '..', 'map.json.gz');
  writeFileSync(file, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(m))));
  const pick = (path: string) => {
    sh(dir, 'checkout', '-q', '-B', 'pr', base);
    put(dir, { [path]: 'changed\n' });
    sh(dir, 'commit', '-q', '-am', 'change ' + path);
    return cli(dir, base, sh(dir, 'rev-parse', 'HEAD'), file);
  };
  const all = ['tests/adapter-conformance.test.ts', 'tests/claude-code-adapter.test.ts', 'tests/codex-adapter.test.ts'];
  expect(pick('src/s.ts').out).toEqual([...all, 'tests/sdk.test.ts', 'tests/x.test.ts']);
  expect(pick('src/c.ts').out).toEqual(['tests/claude-code-adapter.test.ts', 'tests/ctx.test.ts', 'tests/x.test.ts']);
  const r = pick('src/p.ts');
  expect(r.out).toEqual(['tests/adapter-conformance.test.ts', 'tests/claude-code-adapter.test.ts', 'tests/codex-adapter.test.ts', 'tests/plain.test.ts', 'tests/x.test.ts']);
  expect(r.why).toContain('plus 3 image builder(s)');
  const runTests = readFileSync(join(ROOT, 'scripts/run-tests.sh'), 'utf8');
  expect(runTests.match(/^BUILDERS=\(\n([^)]*)\)/m)![1]!.trim().split(/\s+/)).toEqual([...BUILDERS]);
});

// Value: protects=CI runs the base commit's copy with the map from this repository's ci-test-map branch, writes no
// tree.json for a selected run (so gstack's carry never counts it as the full lane) and never selects on a push;
// fails_when=the workflow runs the head's copy, reads the map from the pull request, or lets a selected run upload
// tree.json; why_new=PR test selection (internal-task); seam=the workflow's YAML; no_claim=GitHub's runtime behaviour.
test('ci.yml runs the base copy on pull requests only and writes tree.json only for a full run', () => {
  const text = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const steps = (Bun.YAML.parse(text) as { jobs: { checks: { steps: { name?: string; if?: string; run?: string }[] } } }).jobs.checks.steps;
  const step = (name: string) => steps.find((s) => s.name === name)!;
  const sel = step('Test selection (pull requests)');
  expect(sel.if).toBe("github.repository == 'garrytan/harness-evals' && github.event_name == 'pull_request' && steps.docs.outputs.docs_only != 'true'");
  expect(sel.run).toBe('bash scripts/ci/select-step.sh "$RUNNER_TEMP/select-tests"');
  const exportSel = (Bun.YAML.parse(text) as { jobs: Record<string, { steps: { name?: string; run?: string }[] }> }).jobs['public-export']!.steps.find((s) => s.name === 'Test selection (pull requests)')!;
  expect(exportSel.run).toBe('bash scripts/ci/select-step.sh "$RUNNER_TEMP/select-tests" --profile export');
  const script = readFileSync(join(ROOT, 'scripts/ci/select-step.sh'), 'utf8');
  expect(script).toContain('git show "$base:scripts/ci/select-tests.ts" > "$d/select-tests.ts"');
  expect(script).toContain('git fetch -q --no-tags origin +refs/heads/ci-test-map:refs/ci-test-map/map');
  expect(script).toContain('bun --no-env-file --config="$d/bunfig.toml" --tsconfig-override="$d/tsconfig.json" "$d/select-tests.ts"');
  expect(script).not.toContain('--depth');
  expect(script).toContain('--base "$base" --head HEAD --map-rev refs/ci-test-map/map "${profile[@]}"');
  const docs = step('Docs-only change').run!;
  expect(docs.indexOf("grep -qiF '[full tests]'")).toBeGreaterThan(-1);
  expect(docs.indexOf("grep -qiF '[full tests]'")).toBeLessThan(docs.indexOf('docs-only.ts'));
  expect(steps.findIndex((s) => s === sel)).toBeLessThan(steps.findIndex((s) => s.name === 'Install (frozen lockfile)'));
  for (const name of ['Tested tree record (tree.json)', 'Tested tree record in the log', 'Upload the tested tree', 'Tests (statistics kit, preregistration checker)']) {
    expect({ name, if: step(name).if }).toEqual({ name, if: "steps.docs.outputs.docs_only != 'true' && steps.select.outputs.selected != 'true'" });
  }
  expect(step('Selected tests (pull request)').if).toBe("steps.docs.outputs.docs_only != 'true' && steps.select.outputs.selected == 'true'");
});

// Value: protects=the public-export job's selected run on the export tree still runs everything when the pull request
// changes what the export publishes or writes (its manifest, rules and scrub table, the export tool, the preregistration
// ledger and the run documents), while what the base changed after the trace never forces it; fails_when=a pull request
// that changes publication/ or docs/benchmarks/ gets a selected export run, the default profile starts treating export
// inputs as a full run, or base drift under an export input forces every export run to full until the next map;
// why_new=test selection on the export tree (internal-task's option A, 2026-11-23); seam=the CLI over a temp repository;
// no_claim=the export itself.
describe('select-tests --profile export', () => {
  const exportMap = (base: string) => { const v: MapBody = map(base); v.tests['tests/a.test.ts'].paths.push('docs/benchmarks/run/r.json', 'publication/manifest.json'); return v; };
  const seed = (dir: string) => { put(dir, { 'docs/benchmarks/run/r.json': '1\n', 'publication/manifest.json': '{}\n' }); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'seed'); };
  const pr = (path: string, extra: string[]) => drifted(seed, (dir) => put(dir, { [path]: 'changed\n' }), (base) => exportMap(base), extra);
  test('runs everything when the pull request changes an export input', () => {
    for (const path of ['docs/benchmarks/run/r.json', 'publication/manifest.json']) {
      const r = pr(path, ['--profile', 'export']);
      expect(r.out).toEqual(['all']);
      expect(r.why).toBe('full run: ' + path + ' changed, and ' + EXPORT_FULL_RUN.find((p) => path.startsWith(p)) + ' is an export input');
    }
  });
  test('selects as usual without the profile, and for a change outside the export inputs', () => {
    expect(pr('docs/benchmarks/run/r.json', []).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
    expect(pr('src/a.ts', ['--profile', 'export']).out).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
  });
  test('never runs everything for what the base changed under an export input after the trace', () => {
    const r = drifted((dir) => put(dir, { 'docs/benchmarks/run/r.json': '2\n' }), (dir) => put(dir, { 'src/b.ts': 'b2\n' }), (base) => exportMap(base), ['--profile', 'export']);
    expect(r.out).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/x.test.ts']);
  });
  test('refuses an unknown profile', () => {
    const { dir, base } = repo();
    const r = spawnSync('bun', [SCRIPT, '--base', base, '--head', base, '--map-file', join(dir, 'none.gz'), '--profile', 'nope'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir } });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
});

// Value: protects=the step script both CI jobs run turns every unclear case into the full run: the label, [full tests],
// an empty selection, and a base whose selector predates the export profile; fails_when=one of those yields
// selected=true, or a clean list is not passed through; why_new=the step moved out of ci.yml so the public-export job can
// share it, and #558's final review found an empty list read as a selection (ci.yml:126); seam=scripts/ci/select-step.sh
// on a temp repository with a merge commit and a stub base selector; no_claim=the real selector (tested above).
test('select-step.sh runs everything unless the base selector prints a clean list', () => {
  const { dir } = repo();
  const stub = (marker: string) => { put(dir, { 'scripts/ci/select-tests.ts': marker + "console.log(process.env.STUB_OUT ?? '');\n" }); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '--allow-empty', '-m', 'stub'); };
  sh(dir, 'remote', 'add', 'origin', dir);
  sh(dir, 'branch', 'ci-test-map');
  const merge = (marker: string, message: string) => {
    sh(dir, 'checkout', '-q', '-B', 'main');
    stub(marker);
    sh(dir, 'checkout', '-q', '-B', 'pr');
    put(dir, { 'src/a.ts': 'a' + Math.random() + '\n' });
    sh(dir, 'commit', '-q', '-am', message);
    sh(dir, 'checkout', '-q', 'main');
    sh(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'pr');
  };
  const step = (env: Record<string, string>, ...args: string[]) => {
    const out = temp('select-step-');
    const r = spawnSync('bash', [join(ROOT, 'scripts/ci/select-step.sh'), join(out, 'sel'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir, GITHUB_OUTPUT: join(out, 'out'), GITHUB_STEP_SUMMARY: join(out, 'summary'), ...env } });
    expect(r.status).toBe(0);
    return { output: readFileSync(join(out, 'out'), 'utf8').trim(), list: readFileSync(join(out, 'sel', 'selection.txt'), 'utf8').trim(), log: r.stdout };
  };
  merge('// EXPORT_FULL_RUN\n', 'change');
  expect(step({ STUB_OUT: 'tests/a.test.ts' })).toMatchObject({ output: 'selected=true', list: 'tests/a.test.ts' });
  expect(step({ STUB_OUT: 'tests/a.test.ts' }, '--profile', 'export')).toMatchObject({ output: 'selected=true', list: 'tests/a.test.ts' });
  expect(step({ STUB_OUT: '' })).toMatchObject({ output: 'selected=false', list: 'all' });
  expect(step({ STUB_OUT: 'tests/a.test.ts', FULL_LABEL: 'true' })).toMatchObject({ output: 'selected=false', list: 'all', log: 'full run: the full-tests label\n' });
  expect(step({ STUB_OUT: 'tests/a.test.ts', HEAD_REF: 'ci-test-map' })).toMatchObject({ output: 'selected=false', list: 'all' });
  merge('', 'change [Full Tests]');
  expect(step({ STUB_OUT: 'tests/a.test.ts' })).toMatchObject({ output: 'selected=false', log: "full run: [full tests] in the head commit's message\n" });
  merge('', 'change');
  expect(step({ STUB_OUT: 'tests/a.test.ts' })).toMatchObject({ output: 'selected=true' });
  expect(step({ STUB_OUT: 'tests/a.test.ts' }, '--profile', 'export')).toMatchObject({ output: 'selected=false', log: "full run: the base's scripts/ci/select-tests.ts has no export profile\n" });
});
