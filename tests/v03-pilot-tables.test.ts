// v03-pilot-2026-10's tables (internal-task): the go rule's family rates and the opening-1 totals the report quotes are what
// scripts/v03/pilot-tables.ts computes from the committed receipts.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const RESULTS = join(ROOT, 'docs', 'benchmarks', '2026-10-29-v03-pilot', 'results');
const run = (results: string, tasks: string, out: string, ...extra: string[]) => Bun.spawnSync(['bun', join(ROOT, 'scripts/v03/pilot-tables.ts'), '--results', results, '--tasks', tasks, '--out', out, ...extra], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });

describe('v03-pilot-2026-10 pilot tables', () => {
  test('recomputing from the receipts gives the committed tables and the figures the report quotes', () => {
    const out = mkdtempSync(join(tmpdir(), 'pilot-tables-'));
    try {
      const p = run(RESULTS, join(ROOT, 'tasks/multiuser/v0.3/dev'), out);
      expect(p.exitCode).toBe(0);
      expect(readFileSync(join(out, 'pilot-tables.md'), 'utf8')).toBe(readFileSync(join(RESULTS, 'pilot-tables.md'), 'utf8'));
      const j = JSON.parse(readFileSync(join(out, 'pilot-tables.json'), 'utf8')) as {
        go_rule: Array<{ family: string; passes: number; trials: number; informative: boolean; lower: number; upper: number }>;
        mechanism_mdd: Array<{ cell: string; reaches: boolean }>;
        variance: Array<{ pass_all: boolean; pass_any: boolean }>;
        costs: Array<{ family: string; usd_per_success: number | null; success_lower: number | null }>;
        opening1_fit: { trials: number; usd_trials: number; usd_trials_at_cell_upper: number; usd_trials_at_family_uppers: number; reservation: { median: number; p90: number; max: number }; totals: Record<string, number>; fits: Record<string, boolean>; over_cap: Record<string, number>; fitting_at_max_reservation: { four_reps: { trials: number; usd: number }; most_trials_that_fit: number } };
      };
      const g = Object.fromEntries(j.go_rule.map((r) => [r.family, r.passes + '/' + r.trials + (r.informative ? ' yes' : ' no')]));
      expect(g).toEqual({ scope_isolation: '23/40 yes', shared_channel: '13/20 yes', synthesis: '18/30 yes', continuity: '35/40 yes', corrections: '0/40 no', approval_relay: '0/30 no' });
      expect(Object.fromEntries(j.go_rule.map((r) => [r.family, (100 * r.lower).toFixed(1) + '-' + (100 * r.upper).toFixed(1)]))).toEqual({ scope_isolation: '30.0-87.5', shared_channel: '30.0-100.0', synthesis: '40.0-100.0', continuity: '75.0-97.5', corrections: '0.0-0.0', approval_relay: '0.0-0.0' });
      expect(j.variance.every((v) => typeof v.pass_all === 'boolean' && typeof v.pass_any === 'boolean')).toBe(true);
      expect(j.costs.filter((c) => c.usd_per_success === null).every((c) => c.success_lower === null)).toBe(true);
      expect(j.costs.filter((c) => c.usd_per_success !== null).every((c) => typeof c.success_lower === 'number')).toBe(true);
      expect(j.opening1_fit.over_cap.point_at_max_reservation.toFixed(2)).toBe('0.57');
      expect(j.opening1_fit.fitting_at_max_reservation.four_reps.trials).toBe(1984);
      expect(j.opening1_fit.fitting_at_max_reservation.four_reps.usd.toFixed(2)).toBe('26.08');
      expect(j.opening1_fit.trials).toBe(2480);
      expect(j.opening1_fit.usd_trials.toFixed(2)).toBe('22.41');
      expect(j.opening1_fit.usd_trials_at_cell_upper.toFixed(2)).toBe('25.53');
      expect(j.opening1_fit.usd_trials_at_family_uppers.toFixed(2)).toBe('29.05');
      const f = j.opening1_fit;
      expect([f.reservation.median, f.reservation.p90, f.reservation.max].map((x) => x.toFixed(4))).toEqual(['0.0726', '0.3988', '0.5098']);
      expect(Object.fromEntries(Object.entries(f.totals).map(([k, v]) => [k, v.toFixed(2) + (f.fits[k] ? ' fits' : ' over')]))).toEqual({
        point_at_median_reservation: '23.57 fits',
        point_at_p90_reservation: '28.79 fits',
        point_at_max_reservation: '30.57 over',
        cell_upper_at_median_reservation: '26.69 fits',
        family_uppers_at_median_reservation: '30.22 over',
      });
      expect(j.mechanism_mdd.map((m) => m.reaches)).toEqual([true, true, true]);
    } finally { rmSync(out, { recursive: true, force: true }); }
  }, 60_000);

  test('the go rule clusters on the task across both harnesses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tables-shared-'));
    try {
      const results = join(dir, 'results'), tasks = join(dir, 'tasks'), out = join(dir, 'out');
      mkdirSync(results, { recursive: true });
      const rows: string[] = [];
      // Each task passes 5 of 5 on one harness and 0 of 5 on the other, so every resample of whole tasks gives 50%.
      for (const [task, ocPass] of [['si-a', true], ['si-b', false]] as const) {
        mkdirSync(join(tasks, task), { recursive: true });
        writeFileSync(join(tasks, task, 'task.toml'), 'family = "scope_isolation"\n');
        for (const [harness, passes] of [['openclaw', ocPass], ['hermes', !ocPass]] as const) {
          const cell = harness + '-haiku-gbrain-told-mu-v03-dev';
          for (let r = 1; r <= 5; r++) rows.push(JSON.stringify({ trial_id: 'run/' + cell + '/' + task + '/r' + r, cell, task, harness, grade: passes ? 'pass' : 'fail', consent_violation: false, usage: { usd: 0.01 } }));
        }
      }
      writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
      expect(run(results, tasks, out).exitCode).toBe(0);
      const j = JSON.parse(readFileSync(join(out, 'pilot-tables.json'), 'utf8')) as { go_rule: Array<{ family: string; rate: number; lower: number; upper: number }> };
      const si = j.go_rule.find((g) => g.family === 'scope_isolation')!;
      expect([si.rate, si.lower, si.upper]).toEqual([0.5, 0.5, 0.5]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the go rule leaves excluded terminations out of the denominator', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tables-excl-'));
    try {
      const results = join(dir, 'results'), tasks = join(dir, 'tasks'), out = join(dir, 'out');
      mkdirSync(join(tasks, 'ar-a'), { recursive: true });
      mkdirSync(results, { recursive: true });
      writeFileSync(join(tasks, 'ar-a', 'task.toml'), 'family = "approval_relay"\n');
      const cell = 'openclaw-haiku-gbrain-told-mu-v03-dev';
      const row = (r: number, grade: string, termination: string) => JSON.stringify({ trial_id: 'run/' + cell + '/ar-a/r' + r, cell, task: 'ar-a', harness: 'openclaw', grade, termination, consent_violation: false, usage: { usd: 0.01 } });
      const rows = [row(1, 'pass', 'completed'), row(2, 'fail', 'completed'), row(3, 'fail', 'harness_error'), row(4, 'fail', 'infra_error'), row(5, 'fail', 'model_error'), row(6, 'fail', 'exam_fault')];
      writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
      expect(run(results, tasks, out).exitCode).toBe(0);
      const j = JSON.parse(readFileSync(join(out, 'pilot-tables.json'), 'utf8')) as { go_rule: Array<{ family: string; passes: number; trials: number }> };
      const ar = j.go_rule.find((g) => g.family === 'approval_relay')!;
      expect([ar.passes, ar.trials]).toEqual([1, 3]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('--told names the cells the go rule pools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tables-told-'));
    try {
      const results = join(dir, 'results'), tasks = join(dir, 'tasks'), out = join(dir, 'out'), outTold = join(dir, 'out-told');
      mkdirSync(join(tasks, 'ar-a'), { recursive: true });
      mkdirSync(results, { recursive: true });
      writeFileSync(join(tasks, 'ar-a', 'task.toml'), 'family = "approval_relay"\n');
      const rows: string[] = [];
      // The default told cell fails every trial; the two named re-read cells pass 4 of 5 and 2 of 5.
      for (const [cell, harness, passes] of [['openclaw-haiku-gbrain-told-mu-v03-dev', 'openclaw', 0], ['openclaw-haiku-gbrain-told-scoped-mu-v03-ar', 'openclaw', 4], ['hermes-haiku-gbrain-told-scoped-mu-v03-ar', 'hermes', 2]] as const) {
        for (let r = 1; r <= 5; r++) rows.push(JSON.stringify({ trial_id: 'run/' + cell + '/ar-a/r' + r, cell, task: 'ar-a', harness, grade: r <= passes ? 'pass' : 'fail', consent_violation: false, usage: { usd: 0.01 } }));
      }
      writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
      type G = { go_rule: Array<{ family: string; passes: number; trials: number }> };
      const ar = (o: string) => (JSON.parse(readFileSync(join(o, 'pilot-tables.json'), 'utf8')) as G).go_rule.find((g) => g.family === 'approval_relay')!;
      expect(run(results, tasks, out).exitCode).toBe(0);
      expect([ar(out).passes, ar(out).trials]).toEqual([0, 5]);
      expect(run(results, tasks, outTold, '--told', 'openclaw-haiku-gbrain-told-scoped-mu-v03-ar,hermes-haiku-gbrain-told-scoped-mu-v03-ar').exitCode).toBe(0);
      expect([ar(outTold).passes, ar(outTold).trials]).toEqual([6, 10]);
      expect((JSON.parse(readFileSync(join(outTold, 'pilot-tables.json'), 'utf8')) as { told: string[] }).told).toEqual(['openclaw-haiku-gbrain-told-scoped-mu-v03-ar', 'hermes-haiku-gbrain-told-scoped-mu-v03-ar']);
      expect(readFileSync(join(outTold, 'pilot-tables.md'), 'utf8')).toContain('## Go rule: told arm, pooled over openclaw-haiku-gbrain-told-scoped-mu-v03-ar, hermes-haiku-gbrain-told-scoped-mu-v03-ar');
      // A misspelled cell, a bare --told and a run with none of the default cells are refused, not read as 0 of 0.
      const typo = run(results, tasks, join(dir, 'out-typo'), '--told', 'openclaw-haiku-gbrain-told-scoped-mu-v03-ar,hermes-typo');
      expect(typo.exitCode).toBe(2);
      expect(typo.stderr.toString()).toContain('hermes-typo');
      expect(run(results, tasks, join(dir, 'out-bare'), '--told').exitCode).toBe(2);
      writeFileSync(join(results, 'trials.jsonl'), rows.filter((r) => !r.includes('-told-mu-v03-dev')).join('\n') + '\n');
      const none = run(results, tasks, join(dir, 'out-none'));
      expect(none.exitCode).toBe(2);
      expect(none.stderr.toString()).toContain('openclaw-haiku-gbrain-told-mu-v03-dev');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a partial told cell: unrun trials that could change the label make the family undecided; duplicate trial ids are refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tables-partial-'));
    try {
      const results = join(dir, 'results'), tasks = join(dir, 'tasks');
      mkdirSync(join(tasks, 'ar-a'), { recursive: true });
      mkdirSync(results, { recursive: true });
      writeFileSync(join(tasks, 'ar-a', 'task.toml'), 'family = "approval_relay"\n');
      const cell = 'openclaw-haiku-gbrain-told-scoped-mu-v03-ar';
      const id = (r: number) => 'run/' + cell + '/ar-a/r' + r;
      writeFileSync(join(results, 'manifest.json'), JSON.stringify({ trials: Array.from({ length: 10 }, (_, i) => ({ id: id(i + 1), cell, task: 'ar-a' })) }));
      const row = (r: number, grade: string, extra: Record<string, unknown> = {}) => JSON.stringify({ trial_id: id(r), cell, task: 'ar-a', harness: 'openclaw', grade, termination: 'completed', consent_violation: false, usage: { usd: 0.01 }, ...extra });
      type G = { go_rule: Array<{ family: string; passes: number; trials: number; informative: boolean; unrun: number; undecided: boolean }> };
      const read = (rows: string[], name: string) => {
        writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
        const p = run(results, tasks, join(dir, name), '--told', cell);
        return { p, ar: p.exitCode === 0 ? (JSON.parse(readFileSync(join(dir, name, 'pilot-tables.json'), 'utf8')) as G).go_rule.find((g) => g.family === 'approval_relay')! : null };
      };
      // 3 passes of 4 scored (75 percent, in the band); 5 never ran and 1 stopped at the cap. Every outcome of the six lies between 3 of 10 and 9 of 10, all in the band, so the label holds.
      const held = read([row(1, 'pass'), row(2, 'pass'), row(3, 'pass'), row(4, 'fail'), row(5, 'fail', { termination: 'model_error', cap_stop: true })], 'held');
      expect(held.ar).toMatchObject({ passes: 3, trials: 4, unrun: 6, undecided: false, informative: true });
      // 4 passes of 4 scored (100 percent, out of the band) with 6 unrun: six failures would give 40 percent, in the band, so undecided.
      const open = read([row(1, 'pass'), row(2, 'pass'), row(3, 'pass'), row(4, 'pass')], 'open');
      expect(open.ar).toMatchObject({ passes: 4, trials: 4, unrun: 6, undecided: true, informative: false });
      expect(readFileSync(join(dir, 'open', 'pilot-tables.md'), 'utf8')).toContain('no (undecided: 6 unrun)');
      const dup = read([row(1, 'pass'), row(1, 'pass'), row(2, 'fail')], 'dup');
      expect(dup.p.exitCode).toBe(2);
      expect(dup.p.stderr.toString()).toContain(id(1));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('cost per success: draws with no pass make the upper end unbounded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tables-success-'));
    try {
      const results = join(dir, 'results'), tasks = join(dir, 'tasks'), out = join(dir, 'out');
      mkdirSync(results, { recursive: true });
      const cell = 'openclaw-haiku-gbrain-told-mu-v03-dev';
      const rows: string[] = [];
      // si-a passes 1 of 5, si-b 0 of 5: about a quarter of resamples draw si-b twice and have no pass.
      for (const [task, passes] of [['si-a', 1], ['si-b', 0]] as const) {
        mkdirSync(join(tasks, task), { recursive: true });
        writeFileSync(join(tasks, task, 'task.toml'), 'family = "scope_isolation"\n');
        for (let r = 1; r <= 5; r++) rows.push(JSON.stringify({ trial_id: 'run/' + cell + '/' + task + '/r' + r, cell, task, harness: 'openclaw', grade: r <= passes ? 'pass' : 'fail', consent_violation: false, usage: { usd: 0.01 } }));
      }
      writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
      expect(run(results, tasks, out).exitCode).toBe(0);
      const j = JSON.parse(readFileSync(join(out, 'pilot-tables.json'), 'utf8')) as { costs: Array<{ family: string; usd_per_success: number; success_lower: number | null; success_upper: number | null; draws_without_success: number }> };
      const c = j.costs.find((x) => x.family === 'all')!;
      expect(c.usd_per_success).toBeCloseTo(0.1, 10);
      expect(c.success_upper).toBeNull();
      expect(c.draws_without_success).toBeGreaterThan(2000);
      expect(c.draws_without_success).toBeLessThan(3000);
      expect(readFileSync(join(out, 'pilot-tables.md'), 'utf8')).toContain('unbounded]');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a hand-computed fixture: MDD, cost per trial and the fit total', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tables-fixture-'));
    try {
      const results = join(dir, 'results'), tasks = join(dir, 'tasks'), out = join(dir, 'out');
      mkdirSync(results, { recursive: true });
      const cell = 'openclaw-haiku-gbrain-told-mu-v03-dev';
      const rows: string[] = [];
      for (const [task, passes] of [['si-a', 2], ['si-b', 3]] as const) {
        mkdirSync(join(tasks, task), { recursive: true });
        writeFileSync(join(tasks, task, 'task.toml'), 'family = "scope_isolation"\n');
        for (let r = 1; r <= 5; r++) rows.push(JSON.stringify({ trial_id: 'run/' + cell + '/' + task + '/r' + r, cell, task, harness: 'openclaw', grade: r <= passes ? 'pass' : 'fail', consent_violation: false, usage: { usd: 0.01 } }));
      }
      writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
      const p = run(results, tasks, out);
      expect(p.exitCode).toBe(0);
      const j = JSON.parse(readFileSync(join(out, 'pilot-tables.json'), 'utf8')) as { projection: Array<{ mdd_pass: number }>; costs: Array<{ family: string; usd_per_trial: number }>; opening1_fit: { trials: number; usd_trials: number; usd_trials_at_cell_upper: number; reservation: { median: null }; totals: Record<string, null> } };
      // Both tasks have p(1-p) = 0.24. Held-out g = 40 tasks, n = 200; scope_isolation's 7 tasks give 7 * 5 * 2 * 0.24 = 16.8.
      const z = 1.959963984540054 + 0.8416212335729143;
      expect(j.projection[0]!.mdd_pass).toBeCloseTo((z * Math.sqrt((40 / 39) * 16.8)) / 200, 10);
      expect(j.costs.find((c) => c.family === 'all')!.usd_per_trial).toBeCloseTo(0.01, 10);
      // The told cell's 35 held-out trials at $0.01, plus the OpenClaw installer stand-in's 35 at $0.01 + $0.0025.
      expect(j.opening1_fit.trials).toBe(70);
      expect(j.opening1_fit.usd_trials).toBeCloseTo(0.35 + 35 * 0.0125, 10);
      expect(j.opening1_fit.usd_trials_at_cell_upper).toBeCloseTo(0.35 + 35 * 0.0125, 10);
      expect(j.opening1_fit.reservation.median).toBeNull();
      expect(j.opening1_fit.totals.point_at_median_reservation).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
