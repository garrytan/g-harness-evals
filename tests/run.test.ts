import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, loadPrereg, renderPlan, RunnerError, type Prereg } from '../runner/run.ts';

const base: Prereg = {
  schema_version: 1,
  run_id: 'test-run',
  question: 'q',
  tasks: { hello: ['hello', 'hello-2'] },
  cells: [
    { id: 'a', harness: 'openclaw', model: 'anthropic:claude-sonnet-5-5', slice: 'hello', split: 'dev', repetitions: 5, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } },
    { id: 'b', harness: 'hermes', model: 'openai:gpt-6.1-sol', slice: 'hello', split: 'dev', repetitions: 1, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } },
  ],
  wall_clock_s: { hello: 600 },
  spend_cap_usd: 1,
  drop_order: ['b'],
  minimum_v01: ['a'],
};

function write(p: Prereg): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-prereg-'));
  const file = join(dir, 'prereg.json');
  writeFileSync(file, JSON.stringify(p));
  return file;
}

describe('manifest', () => {
  test('preallocates one trial id per cell, task and repetition and prices the ceiling from the pin table', () => {
    const { prereg, sha256 } = loadPrereg(write(base));
    const m = buildManifest(prereg, sha256, '2026-10-22T00:00:00Z');
    expect(m.trials.length).toBe(2 * 5 + 2 * 1);
    expect(new Set(m.trials.map(t => t.id)).size).toBe(m.trials.length);
    expect(m.trials[0]!.id).toBe('test-run/a/hello/r1');
    // Sonnet 5.5 list price: $2 in, $10 out per million; 100k in + 10k out = $0.30 per trial, 10 trials.
    expect(m.per_cell_ceiling_usd.a).toBeCloseTo(3.0, 2);
    expect(m.cost_ceiling_usd).toBeGreaterThan(m.per_cell_ceiling_usd.a!);
    expect(m.trial_hours_at_cap).toBe(2);
    expect(m.prereg_sha256).toHaveLength(64);
  });

  test('renders a warning when the ceiling exceeds the preregistered cap', () => {
    const { prereg, sha256 } = loadPrereg(write(base));
    const out = renderPlan(buildManifest(prereg, sha256));
    expect(out).toContain('WARN: HE-BUDGET-003');
    expect(out.split('\n').filter(l => l.startsWith('CELL:')).length).toBe(2);
  });
});

describe('refusals carry stable codes', () => {
  const expectCode = (p: Prereg, code: string) => {
    try { loadPrereg(write(p)); } catch (e) { expect(e).toBeInstanceOf(RunnerError); expect((e as RunnerError).code).toBe(code); return; }
    throw new Error('expected a refusal');
  };
  test('unpriced model', () => expectCode({ ...base, cells: [{ ...base.cells[0]!, model: 'anthropic:claude-made-up-9' }] }, 'HE-PIN-002'));
  test('slice without tasks', () => expectCode({ ...base, cells: [{ ...base.cells[0]!, slice: 'work' }] }, 'HE-PREREG-004'));
  test('missing cap', () => expectCode({ ...base, spend_cap_usd: 0 }, 'HE-BUDGET-002'));
  test('missing file', () => {
    try { loadPrereg('/nonexistent/prereg.json'); } catch (e) { expect((e as RunnerError).code).toBe('HE-PREREG-001'); return; }
    throw new Error('expected a refusal');
  });
});
