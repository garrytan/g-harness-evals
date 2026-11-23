// The runner's exit codes against the shard scripts' (tests/run-prepare-failure.test.ts covers the behaviour). scripts/run-shard.sh
// passes executeRun's code through to the Ubicloud controller, which gives some codes their own meaning: 4 is "the smoke failed"
// (scripts/ubicloud/run-shard.sh keeps no VM whose results pull failed when rc is 4), 5 a key-scan hit, 124/125/130/143 timeouts and
// signals. A runner code other than 0, 1 and 2 must not collide with any of them, except the ones shared on purpose below.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RUN_EXIT } from '../runner/trial/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPTS = [join(ROOT, 'scripts', 'run-shard.sh'), ...readdirSync(join(ROOT, 'scripts', 'ubicloud')).filter((f) => f.endsWith('.sh')).map((f) => join(ROOT, 'scripts', 'ubicloud', f))];
/** Shared on purpose, with the reason. */
const SHARED: Record<number, string> = { 3: 'the cap or tag stop (HE-BUDGET-001, HE-INSTALL-001): run-shard.sh passes it through so the controller reports an incomplete shard' };

/** Every code the scripts give a meaning: exit N, rc=N, "$rc" != N, [ "$x" -eq N ], a case arm N) and the like. */
function scriptCodes(): Map<number, string[]> {
  const codes = new Map<number, string[]>();
  const pattern = /\bexit\s+(\d+)\b|\brc=(\d+)\b|"\$\{?\w+\}?"\s*!?==?\s*"?(\d+)\b|-(?:eq|ne|lt|le|gt|ge)\s+"?(\d+)\b|^\s*(\d+)\)/g;
  for (const file of SCRIPTS) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(pattern)) {
        const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
        codes.set(n, [...(codes.get(n) ?? []), `${file.slice(ROOT.length + 1)}:${i + 1}`]);
      }
    });
  }
  return codes;
}

describe('runner exit codes', () => {
  const codes = scriptCodes();
  test('the parser finds the codes the shard scripts are known to use', () => {
    for (const n of [0, 1, 2, 3, 4, 5]) expect(codes.has(n)).toBe(true);
  });
  test('RUN_EXIT codes other than 0, 1 and 2 do not overlap the shard scripts\' codes, except the ones shared on purpose', () => {
    const special: number[] = Object.values(RUN_EXIT).filter((n) => n > 2);
    const clashes = special.filter((n) => codes.has(n) && !(n in SHARED)).map((n) => `${n}: ${codes.get(n)!.join(', ')}`);
    expect(clashes).toEqual([]);
    for (const n of Object.keys(SHARED).map(Number)) expect(special).toContain(n);
  });
  test('harnessNotStarted is never used by the shard scripts, and is not 4', () => {
    expect(RUN_EXIT.harnessNotStarted).not.toBe(4);
    expect(codes.get(RUN_EXIT.harnessNotStarted)).toBeUndefined();
  });
});
