import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = readFileSync(join(ROOT, 'scripts/run-tests.sh'), 'utf8');
const phase = (name: string) =>
  [...(SCRIPT.match(new RegExp('^' + name + '=\\(\\n([\\s\\S]*?)^\\)', 'm'))?.[1] ?? '').matchAll(/^\s*(\S+)\s*$/gm)].map((m) => m[1]!);

// Value: protects=the builder and serial phases of scripts/run-tests.sh list real test files, each in one phase only, so
// no file runs twice or drops out of the suite; fails_when=a listed file is renamed or deleted, or a file is listed in
// both phases; why_new=the parallel test step (internal-task); seam=the script's text; no_claim=bun's --parallel scheduling.
test('the builder and serial phases name existing test files, once each', () => {
  const builders = phase('BUILDERS'), serial = phase('SERIAL');
  expect(builders.length).toBeGreaterThan(0);
  expect(serial.length).toBeGreaterThan(0);
  expect([...builders, ...serial].filter((f) => !/^tests\/.+\.test\.ts$/.test(f) || !existsSync(join(ROOT, f)))).toEqual([]);
  expect(new Set([...builders, ...serial]).size).toBe(builders.length + serial.length);
});

// Value: protects=tree.json covers every phase, so the CI carry never vouches for a suite whose phase report it skipped;
// fails_when=run-tests.sh gains, renames or drops a JUnit report and ci.yml's tree.json step does not follow;
// why_new=the parallel test step (internal-task); seam=the script's and the workflow's text; no_claim=the reports' contents.
test('ci.yml reads every JUnit report scripts/run-tests.sh writes', () => {
  const written = [...SCRIPT.matchAll(/^report (\w+)$/gm)].map((m) => m[1]!).sort();
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const read = [...ci.matchAll(/--junit "\$RUNNER_TEMP\/junit\/(\w+)\.xml"/g)].map((m) => m[1]!).sort();
  expect(written).toEqual(['builders', 'main', 'serial']);
  expect(read).toEqual(written);
});

// Value: protects=bun's --timings input stays a well-formed per-file table; fails_when=a hand edit breaks the JSON,
// the version, a path or a time; why_new=the parallel test step (internal-task); seam=the file's text; no_claim=that the
// times are current.
test('tests/.timings.json is a per-file table of test times in milliseconds', () => {
  const timings = JSON.parse(readFileSync(join(ROOT, 'tests/.timings.json'), 'utf8'));
  expect(timings.version).toBe(1);
  const bad = Object.entries(timings.files as Record<string, unknown>).filter(([f, ms]) => !/^tests\/.+\.test\.ts$/.test(f) || !Number.isInteger(ms) || (ms as number) < 0);
  expect(bad).toEqual([]);
  expect(Object.keys(timings.files).length).toBeGreaterThan(0);
});

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-tests-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'tests'));
  cpSync(join(ROOT, 'scripts/run-tests.sh'), join(dir, 'scripts/run-tests.sh'));
  writeFileSync(join(dir, 'tests/.timings.json'), '{"version":1,"files":{}}');
  for (const f of [...phase('BUILDERS'), ...phase('SERIAL'), 'tests/other.test.ts']) writeFileSync(join(dir, f), "import { expect, test } from 'bun:test';\ntest('stub', () => expect(1).toBe(1));\n");
  return dir;
};

// Value: protects=run-tests.sh refuses arguments it does not use instead of silently running the whole suite without the
// reports CI's tree.json step reads; fails_when=an unknown, repeated or valueless argument is ignored;
// why_new=the internal-task review (adversarial finding 3); seam=a copy of the script over stub test files in a temp dir;
// no_claim=bun's flags.
test('run-tests.sh refuses unknown, repeated and valueless arguments before any phase runs', () => {
  const dir = fixture();
  const run = (...args: string[]) => spawnSync('bash', [join(dir, 'scripts/run-tests.sh'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir, HE_TEST_PARALLEL: '2' } });
  const cases: [string[], string][] = [
    [['--junit-dir=/tmp/x'], 'unknown argument --junit-dir=/tmp/x'],
    [['tests/a.test.ts'], 'unknown argument tests/a.test.ts'],
    [['--junit-dir', '/tmp/x', '--junit-dir', '/tmp/y'], '--junit-dir is given twice'],
    [['--junit-dir'], '--junit-dir needs a directory'],
    [['--junit-dir', '--parallel=2'], '--junit-dir needs a directory'],
  ];
  for (const [args, message] of cases) {
    const r = run(...args);
    expect({ args, status: r.status, ran: r.stdout.includes('phase 1'), message: r.stderr.includes(message) }).toEqual({ args, status: 2, ran: false, message: true });
  }
});

// Value: protects=the reporter flags reach bun as one argument each, so a report directory with a space still gets all
// three reports; fails_when=the flags go back to unquoted word splitting; why_new=the internal-task review (adversarial
// finding 3); seam=a copy of the script over stub test files in a temp dir; no_claim=the real suite's results.
test('run-tests.sh writes all three reports to a directory whose path has a space', () => {
  const dir = fixture();
  const out = join(dir, 'junit reports');
  const r = spawnSync('bash', [join(dir, 'scripts/run-tests.sh'), '--junit-dir', out], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir, HE_TEST_PARALLEL: '2' } });
  expect(r.status).toBe(0);
  expect(readdirSync(out).sort()).toEqual(['builders.xml', 'main.xml', 'serial.xml']);
});
