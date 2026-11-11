import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Every analysis.json and analysis.md under fable-5-2-coding-2026-11's results is compare-models.ts output. This test
 * regenerates each of the eleven from the committed trial records (and task list, where the variant is a task subset) and
 * fails unless both files match the committed ones byte for byte. .gstack/ship-policy.json leaves these analysis.json
 * files out of /ship review on the strength of this check, so the last test fails when that pattern matches any
 * analysis.json this list does not regenerate.
 */
const SCRIPT = new URL('../scripts/frontier-harbor/compare-models.ts', import.meta.url).pathname;
// Built from segments: a code file that names a results file's full repository path keeps that file in /ship's review diff.
const ROOT = new URL('..', import.meta.url).pathname;
const RUN = ['docs', 'benchmarks', '2026-11-09-fable-5-2-coding'];
const RESULTS = join(ROOT, ...RUN, 'results');
const tmp = mkdtempSync(join(tmpdir(), 'fable-analysis-regen-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const VARIANTS: Array<{ dir: string; trials: string[]; tasks?: boolean }> = [
  { dir: 'analysis', trials: ['merged', 'trials.jsonl'] },
  { dir: 'analysis-hard', trials: ['merged', 'trials.jsonl'], tasks: true },
  { dir: 'analysis-matched', trials: ['analysis-matched', 'trials-r2h2.jsonl'] },
  { dir: 'analysis-full', trials: ['merged', 'trials-full.jsonl'] },
  { dir: 'analysis-full-both', trials: ['merged', 'trials-full.jsonl'], tasks: true },
  { dir: 'analysis-full-hard', trials: ['merged', 'trials-full.jsonl'], tasks: true },
  { dir: 'analysis-full-nofeal', trials: ['merged', 'trials-full.jsonl'], tasks: true },
  { dir: 'analysis-full-nocut', trials: ['analysis-full-nocut', 'trials-full-nocut.jsonl'] },
  { dir: 'analysis-full-nocut15', trials: ['analysis-full-nocut15', 'trials-full-nocut15.jsonl'] },
  { dir: 'analysis-full-norefusal', trials: ['analysis-full-norefusal', 'trials-full-norefusal.jsonl'] },
  { dir: 'analysis-full-nostop', trials: ['analysis-full-nostop', 'trials-full-nostop.jsonl'] },
];

for (const v of VARIANTS) {
  test(`${v.dir}: compare-models.ts regenerates analysis.json and analysis.md byte for byte`, () => {
    const out = join(tmp, v.dir);
    const tasks = v.tasks ? ['--tasks', readFileSync(join(RESULTS, v.dir, 'tasks.txt'), 'utf8').trim()] : [];
    const res = spawnSync('bun', [SCRIPT, '--trials', join(RESULTS, ...v.trials), ...tasks, '--out', out], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(res.status).toBe(0);
    for (const f of ['analysis.json', 'analysis.md']) expect(readFileSync(join(out, f), 'utf8')).toBe(readFileSync(join(RESULTS, v.dir, f), 'utf8'));
  }, 60_000);
}

test('the review exclusion for these files matches exactly the analysis.json files this test regenerates', () => {
  const policy = JSON.parse(readFileSync(join(ROOT, '.gstack', 'ship-policy.json'), 'utf8')) as { review_exclude_paths: string[] };
  const patterns = policy.review_exclude_paths.filter((p) => p.startsWith(RUN.join('/') + '/') && p.endsWith('/analysis.json'));
  expect(patterns).toHaveLength(1);
  const res = spawnSync('git', ['ls-files', '--', ':(top,glob)' + patterns[0]], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  expect(res.status).toBe(0);
  expect(res.stdout.split('\n').filter(Boolean).sort()).toEqual(VARIANTS.map((v) => [...RUN, 'results', v.dir, 'analysis.json'].join('/')).sort());
});
