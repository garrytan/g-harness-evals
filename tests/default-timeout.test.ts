// bunfig.toml preloads tests/setup/default-timeout.ts, which raises Bun's 5 s per-test default to 30 s for every bun test
// run from the repository root (Bun ignores [test] timeout in bunfig.toml, oven-sh/bun#7789).
//
// Value: protects=slow CI runners do not fail healthy tests at 5 s; fails_when=bunfig.toml stops preloading the setup file
// or the setup file stops calling setDefaultTimeout(30_000), or stops setting it again as each test file loads;
// why_new=five tests failed CI at about 5 s in one day, and a serial run kept the default for its first file only;
// seam=the two files as committed, and a serial bun test run on two temporary files; no_claim=how long any one test takes.
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

test('bunfig.toml preloads tests/setup/default-timeout.ts, which sets a 30 s default timeout', () => {
  const bunfig = readFileSync(join(ROOT, 'bunfig.toml'), 'utf8');
  expect(bunfig).toContain('[test]');
  expect(bunfig).toContain('preload = ["./tests/setup/default-timeout.ts"]');
  const setup = readFileSync(join(ROOT, 'tests/setup/default-timeout.ts'), 'utf8');
  expect(setup).toContain("import { setDefaultTimeout } from 'bun:test';");
  expect(setup).toContain('setDefaultTimeout(30_000);');
});

test('a serial bun test run gives every file the 30 s default, not only the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'he-default-timeout-'));
  try {
    writeFileSync(join(dir, 'a-first.test.ts'), "import { test } from 'bun:test';\ntest('first file', () => {});\n");
    writeFileSync(
      join(dir, 'b-second.test.ts'),
      "import { test } from 'bun:test';\ntest('second file takes six seconds', async () => { await Bun.sleep(6_000); });\n",
    );
    const run = Bun.spawnSync([process.execPath, 'test', join(dir, 'a-first.test.ts'), join(dir, 'b-second.test.ts')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    expect(run.stderr.toString()).toContain(' 2 pass');
    expect(run.exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
