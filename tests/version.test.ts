// The release version is written in three places that must agree: VERSION, package.json and the newest CHANGELOG.md section
// (CLAUDE.md: versions follow VERSION and package.json; every pull request cuts a release since 0.0.6).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

test('VERSION, package.json and the newest CHANGELOG.md section name the same release', () => {
  const version = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  expect(pkg.version).toBe(version);
  const heading = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m);
  expect(heading?.[1]).toBe(version);
});

// Value: protects=a pregate key gstack added in a later release comes with a ship-policy floor at that release, so a crew
// machine on an older gstack is told to upgrade instead of refusing the whole policy as an unknown key on every push;
// fails_when=timeout_s stays in .gstack/pregate.json while min_gstack_version drops below 1.91.364.0; why_new=the /ship
// fix-check on #148 found timeout_s landing with the floor still at 1.91.311.0; seam=none; no_claim=gstack's own parsing.
test('pregate timeout_s comes with a gstack floor of 1.91.364.0 or later', () => {
  const pregate = JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')) as { timeout_s?: number };
  if (pregate.timeout_s === undefined) return;
  const floor = (JSON.parse(readFileSync(join(ROOT, '.gstack', 'ship-policy.json'), 'utf8')) as { min_gstack_version: string }).min_gstack_version.split('.').map(Number);
  const release = [1, 91, 364, 0];
  const firstDiff = release.findIndex((n, i) => (floor[i] ?? 0) !== n);
  expect(firstDiff === -1 || (floor[firstDiff] ?? 0) > release[firstDiff]).toBe(true);
});

// Value: protects=ship_lanes_from and run_profiles (gstack 1.94.0.0, CI carry) come with a ship-policy floor at 1.94.4.0
// or later, the R66 roll-out release, so a crew machine on an older gstack is told to upgrade instead of refusing the
// whole policy as an unknown key; fails_when=either key stays in .gstack/pregate.json while min_gstack_version drops
// below 1.94.4.0; why_new=gstack 1.93.x lists no ship_lanes_from key and rejects pregate.json with PREGATE_CONFIG_INVALID;
// seam=none; no_claim=gstack's own parsing.
test('pregate CI carry keys come with a gstack floor of 1.94.4.0 or later', () => {
  const pregate = JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')) as Record<string, unknown>;
  if (!('ship_lanes_from' in pregate) && !('run_profiles' in pregate)) return;
  const floor = (JSON.parse(readFileSync(join(ROOT, '.gstack', 'ship-policy.json'), 'utf8')) as { min_gstack_version: string }).min_gstack_version.split('.').map(Number);
  const release = [1, 94, 4, 0];
  const firstDiff = release.findIndex((n, i) => (floor[i] ?? 0) !== n);
  expect(firstDiff === -1 || (floor[firstDiff] ?? 0) > release[firstDiff]).toBe(true);
});

// Value: protects=no Markdown page but CHANGELOG.md names the current release, so a pull request renumbered after another
// merges changes only VERSION, package.json and CHANGELOG.md, which gstack's receipt carry counts as release metadata;
// fails_when=a page (README's version line, a hub page's opening, a page changelog entry) writes v<VERSION> or
// "harness-evals <VERSION>" again; why_new=README's version line and its "moves from X to Y" entry made every renumber a
// product change, and #150's carry was refused (RECEIPT_CARRY_PRODUCT_CHANGED); seam=git ls-files; no_claim=gstack's
// carry itself, which needs gstack installed.
test('no Markdown page but CHANGELOG.md names the current release', () => {
  const version = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  const files = spawnSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter((f) => f && f !== 'CHANGELOG.md');
  expect(files).toContain('README.md');
  const escaped = version.replace(/\./g, '\\.');
  const stamp = new RegExp(`(?:\\bv|harness-evals )${escaped}(?![0-9])`);
  const offenders = files.filter((f) => stamp.test(readFileSync(join(ROOT, f), 'utf8')));
  expect(offenders).toEqual([]);
});
