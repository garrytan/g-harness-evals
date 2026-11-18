import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attemptPairs, baselineReport, flipShare, wilson } from '../scripts/canary/baseline-report.ts';
import type { Arm, CanaryTrial, ModelKey, TasksFile, Thresholds } from '../scripts/canary/decide.ts';

const DIR = join(import.meta.dir, '../docs/benchmarks/2026-11-09-regression-canary');
const th = (JSON.parse(readFileSync(join(DIR, 'prereg-canary.json'), 'utf8')) as { thresholds: Thresholds }).thresholds;
const tasks = JSON.parse(readFileSync(join(DIR, 'tasks-gstack.json'), 'utf8')) as TasksFile;
const release = { prev: { sha: 'a'.repeat(40), version: '1.97.0.0' }, new: { sha: 'b'.repeat(40), version: '1.98.0.0' } };

function trial(mk: ModelKey, arm: Arm, task: string, attempt: number, pass: boolean, termination = 'completed'): CanaryTrial {
  return {
    trial_id: `t/${mk}/${arm}/${task}/${attempt}`, task, harness: mk === 'opus' ? 'claude-code' : 'codex', model: tasks.models[mk]!.model,
    termination: termination as CanaryTrial['termination'], grade: pass ? 'pass' : 'fail',
    usage: { usd: 0.3, input_tokens: 1000, output_tokens: 100, cached_tokens: 0 } as CanaryTrial['usage'],
    canary: {
      suite: 'gstack', tier: 'T2', arm, product_version: arm === 'plain' ? null : '1', product_sha: null, model_key: mk, task, attempt,
      exposure: { first_request_has_product: arm !== 'plain', product_calls: arm === 'plain' ? 0 : 2 }, safety: null,
    },
  };
}

/** Every task passes every attempt, except where fail(mk, arm, task index, attempt) says otherwise. */
function grid(fail: (mk: ModelKey, arm: Arm, i: number, attempt: number) => boolean = () => false): CanaryTrial[] {
  const rows: CanaryTrial[] = [];
  for (const mk of ['opus', 'sol'] as ModelKey[])
    tasks.models[mk]!.tasks.forEach((task, i) => {
      for (const arm of ['plain', 'prev', 'new'] as Arm[]) for (const a of [1, 2, 3]) rows.push(trial(mk, arm, task, a, !fail(mk, arm, i, a)));
    });
  return rows;
}

describe('canary baseline report', () => {
  test('attempt pairs and Wilson interval', () => {
    expect(attemptPairs([1, 2, 3])).toEqual([[1, 2], [1, 3], [2, 3]]);
    expect(wilson(0, 0)).toBeNull();
    const [lo, hi] = wilson(27, 30)!;
    expect(lo).toBeGreaterThan(0.73);
    expect(hi).toBeLessThan(0.97);
  });

  test('flip share skips infra-class trials', () => {
    const list = tasks.models.opus!.tasks.slice(0, 3);
    const rows = [trial('opus', 'prev', list[0], 1, true), trial('opus', 'prev', list[0], 2, false), trial('opus', 'prev', list[1], 1, true),
      trial('opus', 'prev', list[1], 2, true), trial('opus', 'prev', list[2], 1, true), trial('opus', 'prev', list[2], 2, false, 'infra_error')];
    expect(flipShare(rows, list, 1, 2)).toEqual({ flips: 1, tasks: 2 });
  });

  test('a stable grid has no flips and no false alarms', () => {
    const r = baselineReport({ suite: 'gstack', trials: grid(), tasks, thresholds: th, draws: 200, release });
    expect(r.real.status).toBe('OK');
    expect(r.suite_totals).toMatchObject({ trials: 540, infra: 0, same_release_pairs: 12, false_alarms: 0 });
    for (const m of r.models) {
      expect(m.flip_release).toBe(0);
      expect(m.plain).toMatchObject({ pass: 90, n: 90, rate: 1 });
      expect(m.plain_contaminated).toBe(0);
    }
  });

  test('one bad attempt within a release arm is counted as a false alarm for its pairs', () => {
    const r = baselineReport({ suite: 'gstack', trials: grid((mk, arm, i, a) => mk === 'opus' && arm === 'new' && a === 3 && i < 12), tasks, thresholds: th, draws: 200, release });
    const opus = r.models.find((m) => m.model === 'opus')!;
    const flagged = opus.false_alarms.filter((f) => f.rules.length > 0).map((f) => `${f.arm} ${f.a}-${f.b}`);
    expect(flagged).toEqual(['new 1-3', 'new 2-3']);
    expect(r.suite_totals.false_alarms).toBe(2);
    expect(opus.flip.new.rate).toBeCloseTo((0 + 12 / 30 + 12 / 30) / 3, 6);
    expect(opus.modelled?.flip).toBeCloseTo(opus.flip_release!, 6);
  });
  test('an empty or missing trials file, or one with no T2 trial of the suite, is refused instead of reading as a clean baseline', () => {
    expect(() => baselineReport({ suite: 'gstack', trials: [], tasks, thresholds: th, draws: 200, release })).toThrow(/no gstack T2 trials/);
    expect(() => baselineReport({ suite: 'gbrain', trials: grid(), tasks, thresholds: th, draws: 200, release })).toThrow(/no gbrain T2 trials/);
    const dir = mkdtempSync(join(tmpdir(), 'baseline-report-'));
    writeFileSync(join(dir, 'empty.jsonl'), '');
    const run = (file: string) => Bun.spawnSync(['bun', join(import.meta.dir, '../scripts/canary/baseline-report.ts'), '--suite', 'gstack', '--trials', file,
      '--prev-sha', release.prev.sha, '--prev-version', release.prev.version, '--new-sha', release.new.sha, '--new-version', release.new.version], { env: { PATH: process.env.PATH ?? '' } });
    for (const [file, why] of [[join(dir, 'empty.jsonl'), /no gstack T2 trials/], [join(dir, 'missing.jsonl'), /does not exist/]] as const) {
      const r = run(file);
      expect(r.exitCode).toBe(2);
      expect(r.stdout.toString()).toBe('');
      expect(r.stderr.toString()).toMatch(why);
    }
  });
});
