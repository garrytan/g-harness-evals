// bunfig.toml preloads tests/setup/default-timeout.ts, which raises Bun's 5 s per-test default to 30 s for every bun test
// run from the repository root (Bun ignores [test] timeout in bunfig.toml, oven-sh/bun#7789).
//
// Value: protects=slow CI runners do not fail healthy tests at 5 s; fails_when=bunfig.toml stops preloading the setup file
// or the setup file stops calling setDefaultTimeout(30_000); why_new=five tests failed CI at about 5 s in one day;
// seam=the two files as committed; no_claim=how long any one test takes.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
