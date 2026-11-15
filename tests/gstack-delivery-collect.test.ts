// internal-task: scripts/gstack-delivery/collect.ts turns a frontier Harbor results directory into analyze.ts rows and a probes.ts
// batch, reading arms from the preregistration's cells and kinds from the committed task split.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, taskKind } from '../scripts/gstack-delivery/collect.ts';

const DIR = 'tasks/repo/gstack-delivery-v1/dev';
const prereg = { run_id: 'fixture', repo_tasks: { dir: DIR, placebo: 'harnesses/routes/placebo.md' }, cells: [
  { id: 'opus-cc-hook', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', arm: 'hook' as const },
  { id: 'opus-cc-placebo', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', arm: 'placebo' as const },
] };
const record = (cell: string, task: string, job: string, trial: string, extra: Record<string, unknown> = {}) => JSON.stringify({ trial_id: 'fixture/' + cell + '/' + task + '/a2', cell, task, termination: 'completed', grade: 'pass', consent_violation: false, usage: { usd: 0.25 }, frontier: { harbor_job: job, harbor_trial: trial, attempt: 2, infra_class: null, ...extra } });

function results(lines: string[], captures: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  writeFileSync(join(dir, 'trials.jsonl'), lines.join('\n') + '\n');
  for (const c of captures) { mkdirSync(join(dir, 'run/jobs', c, 'proxy-capture'), { recursive: true }); writeFileSync(join(dir, 'run/jobs', c, 'proxy-capture/proxy-requests.ndjson'), ''); }
  return dir;
}

describe('collect.ts', () => {
  test('task kinds come from the split', () => {
    expect([taskKind(process.cwd(), DIR, 'gd-dev-review-01'), taskKind(process.cwd(), DIR, 'gd-dev-ship-16'), taskKind(process.cwd(), DIR, 'gd-dev-nope')]).toEqual(['review', 'ship', null]);
  });
  test('a row per trial with the cell arm, the split kind and the attempt as rep; placebo lines name the placebo file', () => {
    const dir = results([record('opus-cc-hook', 'gd-dev-review-03', 'opus-cc-hook__a2', 't1'), record('opus-cc-placebo', 'gd-dev-ship-04', 'opus-cc-placebo__a2', 't2')], ['opus-cc-hook__a2/t1', 'opus-cc-placebo__a2/t2']);
    const c = collect(prereg, [dir]);
    expect(c.problems).toEqual([]);
    expect(c.rows.map((r) => [r.arm, r.kind, r.task, r.rep, r.usd, r.harness])).toEqual([['hook', 'review', 'gd-dev-review-03', 2, 0.25, 'claude-code'], ['placebo', 'ship', 'gd-dev-ship-04', 2, 0.25, 'claude-code']]);
    expect(c.batch[0]!.capture).toBe(join(dir, 'run/jobs/opus-cc-hook__a2/t1/proxy-capture/proxy-requests.ndjson'));
    expect(c.batch[0]!.expect).toBeUndefined();
    expect(c.batch[1]!.expect).toEndWith('harnesses/routes/placebo.md');
  });
  test('an unknown cell, a task with no kind and a missing capture are each named; a recovered record keeps its row with no capture', () => {
    const dir = results([record('sol-x', 'gd-dev-review-01', 'j', 't'), record('opus-cc-hook', 'gd-dev-nope', 'j', 't'), record('opus-cc-hook', 'gd-dev-review-02', 'j', 'gone'), JSON.stringify({ trial_id: 'fixture/opus-cc-hook/gd-dev-review-05/a1', cell: 'opus-cc-hook', task: 'gd-dev-review-05', termination: 'completed', grade: 'fail', frontier: { attempt: 1, recovered: { from: 'mirror' } } })], []);
    const c = collect(prereg, [dir]);
    expect(c.problems).toHaveLength(3);
    expect(c.problems[0]).toContain('cell sol-x is not a cell');
    expect(c.problems[1]).toContain('has no review or ship kind');
    expect(c.problems[2]).toContain('no capture at');
    expect(c.rows.map((r) => r.task)).toEqual(['gd-dev-review-02', 'gd-dev-review-05']);
    expect(c.batch.map((b) => [b.trial_id.split('/')[2], b.capture])).toEqual([['gd-dev-review-05', '']]);
  });
});

describe('collect.ts, infrastructure records', () => {
  test('an infra_error record written before any request keeps its row and its exclusion, needs no capture and stops nothing', () => {
    const line = JSON.parse(record('opus-cc-hook', 'gd-dev-review-06', 'opus-cc-hook__a2', 'never', { infra_class: 'no_model_response' }));
    const dir = results([JSON.stringify({ ...line, termination: 'infra_error', grade: 'n/a' })], []);
    const c = collect(prereg, [dir]);
    expect(c.problems).toEqual([]);
    expect(c.rows.map((r) => [r.task, r.termination, r.infra_class])).toEqual([['gd-dev-review-06', 'infra_error', 'no_model_response']]);
    expect(c.batch.map((b) => [b.trial_id.split('/')[2], b.capture])).toEqual([['gd-dev-review-06', '']]);
  });
});
