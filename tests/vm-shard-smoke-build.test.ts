// scripts/ubicloud/vm-shard.sh: whether the counted run rebuilds harness images after the one-trial smoke.
//
// Value: protects=a shard that smoked only its first cell (--smoke-first-cell) still builds every harness image its
// counted cells need, so a shard that mixes harnesses runs; fails_when=the counted run gets --skip-build after a
// first-cell smoke; why_new=on 2026-11-22 every multi-harness shard that used --smoke-first-cell stopped with exit 2 and
// "image ...:dev is missing", because the smoke built only the first cell's harness image and the counted run skipped the
// build; seam=the line vm-shard.sh runs after a passing smoke, read from the script itself; no_claim=the build itself,
// the images or the VM side of the run.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = readFileSync(join(import.meta.dir, '..', 'scripts', 'ubicloud', 'vm-shard.sh'), 'utf8');
const LINE = SCRIPT.split('\n').filter((l) => /^\s*\[ \$\{#sealed\[@\]\} -gt 0 \].*build_flag=\(--skip-build\)\s*$/.test(l));

function buildFlag(sealed: boolean, smokeFirst: boolean): string {
  const prelude = `sealed=(${sealed ? '--sealed-root x' : ''}); smoke_first=${smokeFirst ? 1 : 0}; build_flag=()`;
  const r = spawnSync('bash', ['-c', `${prelude}\n${LINE[0]}\necho "\${build_flag[*]}"`], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

describe('vm-shard.sh build after the smoke', () => {
  test('the post-smoke line is found once', () => {
    expect(LINE.length).toBe(1);
  });

  test('a full smoke of a public shard lets the counted run reuse its images', () => {
    expect(buildFlag(false, false)).toBe('--skip-build');
  });

  test('a first-cell smoke leaves the counted run to build every harness image', () => {
    expect(buildFlag(false, true)).toBe('');
  });

  test('a sealed shard always builds its own sealed image', () => {
    expect(buildFlag(true, false)).toBe('');
    expect(buildFlag(true, true)).toBe('');
  });
});
