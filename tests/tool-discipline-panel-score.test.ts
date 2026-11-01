import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { medianInterval, newcombe, PANEL_ARMS, PANEL_DESIGN, panelManifestProblem, score, smallestShownDrop } from '../scripts/tool-discipline/panel-score.ts';

type Opts = { started?: number; success?: boolean; open?: number; termination?: string; transcript?: string };
const row = (harness: string, task: number, arm: string, i: number, o: Opts = {}) => ({
  trial_id: harness + '-t' + task + '-' + arm + '-' + i, harness, task, arm, trial_index: i,
  termination: o.termination ?? 'completed', usd_spent: o.termination?.startsWith('infra') || o.termination?.startsWith('not_run') ? 0 : 0.1,
  requests_forwarded: o.termination?.startsWith('infra') || o.termination?.startsWith('not_run') ? 0 : 1,
  evidence: o.termination?.startsWith('not_run') ? null : {
    transcript: o.transcript ?? 'complete',
    metrics: task === 3
      ? { control_false_open: o.open ?? 0, task_success: null, matching_skill_started: 0, matching_skill_opened: 0 }
      : { matching_skill_opened: o.started ? 1 : 0, matching_skill_started: o.started ?? 0, started_attempted: o.started ? 1 : 0, started_exit: o.started ? 0 : null, task_success: o.success ?? true, control_false_open: null },
  },
});

/** A full three-arm panel for one harness: 8 per cell; f decides each row's options. */
const panel = (f: (task: number, arm: string, i: number) => Opts, harness = 'openclaw') => {
  const rows: any[] = [];
  for (const arm of ['none', 'baseline', 'candidate']) for (const task of [1, 2, 3]) for (let i = 1; i <= 8; i++) rows.push(row(harness, task, arm, i, f(task, arm, i)));
  return rows;
};
const order = (rows: any[]) => rows.map(r => ({ trial_id: r.trial_id, harness: r.harness, task: r.task, arm: r.arm }));
const one = (rows: any[]) => score(rows, order(rows))[0];

describe('panel-score verdicts', () => {
  test('pass: candidate starts 6 of 16, baseline 0, guards met', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 && i <= 3 ? 1 : 0 }));
    const s = one(rows);
    expect(s.primary.starts).toBe(6);
    expect(s.primary.bar).toBe(5);
    expect(s.verdict).toBe('pass');
  });

  test('fail: candidate starts 4 of 16 is under the bar', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 && i <= 2 ? 1 : 0 }));
    expect(one(rows).verdict).toBe('fail');
  });

  test('fail: two control opens in the candidate', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 ? 1 : 0, open: arm === 'candidate' && task === 3 && i <= 2 ? 1 : 0 }));
    const s = one(rows);
    expect(s.control.worst).toBe(2);
    expect(s.verdict).toBe('fail');
  });

  test('fail: a clear success drop against baseline', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 ? 1 : 0, success: !(arm === 'candidate' && i <= 6) }));
    const s = one(rows);
    expect(s.success.baseline.state).toBe('fail');
    expect(s.verdict).toBe('fail');
  });

  test('inconclusive: one success lost is a drop not shown either way', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 ? 1 : 0, success: !(arm === 'candidate' && task === 1 && i === 1) }));
    const s = one(rows);
    expect(s.success.baseline.state).toBe('inconclusive');
    expect(s.verdict).toBe('inconclusive');
  });

  test('inconclusive: baseline starts reach the bar too', () => {
    const rows = panel((task, arm, i) => ({ started: arm !== 'none' && task !== 3 && i <= 3 ? 1 : 0 }));
    expect(one(rows).verdict).toBe('inconclusive');
  });

  test('incomplete: three absent rows in one cell', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 ? 1 : 0, termination: arm === 'baseline' && task === 2 && i <= 3 ? 'infra_error' : undefined }));
    const s = one(rows);
    expect(s.incomplete_cells.length).toBe(1);
    expect(s.verdict).toBe('incomplete');
  });

  test('worst case: absent candidate rows are non-starts, absent control rows are opens, absent comparator rows are successes', () => {
    const rows = panel((task, arm, i) => ({
      started: arm === 'candidate' && task !== 3 ? 1 : 0,
      termination: (arm === 'candidate' && i === 8) || (arm === 'none' && task === 1 && i === 8) ? 'not_run:panel_cap' : undefined,
    }));
    const s = one(rows);
    expect(s.primary.starts).toBe(14);
    expect(s.control.worst).toBe(1);
    expect(s.success.baseline.candidate_worst).toBe(14);
    expect(s.success.none.other_best).toBe(16);
    expect(s.verdict).toBe('inconclusive');
  });

  test('an unobservable transcript is absent, not a start', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 && i <= 3 ? 1 : 0, transcript: arm === 'candidate' && task === 1 && i === 1 ? 'truncated' : undefined }));
    expect(one(rows).primary.starts).toBe(5);
  });

  test('hermes carries the task-2 secondary bar', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task === 2 && i <= 2 ? 1 : 0 }), 'hermes');
    const s = one(rows);
    expect(s.hermes_task2).toEqual({ starts: 2, n: 8, bar: 2, met: true });
  });

  test('incomplete: a run killed after trial index 3 leaves planned trials with no line, which are absent', () => {
    const full = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 && i <= 3 ? 1 : 0 }));
    const s = score(full.filter(r => r.trial_index <= 3), order(full))[0];
    expect(s.primary.n).toBe(16);
    expect(s.primary.bar).toBe(5);
    expect(s.verdict).toBe('incomplete');
  });

  test('refused: a repeated trial_id, or a trial the plan does not list', () => {
    const rows = panel((task, arm, i) => ({ started: arm === 'candidate' && task !== 3 ? 1 : 0 }));
    const plan = order(rows);
    expect(() => score([...rows, rows[0]], plan)).toThrow(/more than once/);
    expect(() => score(rows, plan.slice(1))).toThrow(/does not list/);
    expect(() => score(rows.map((r, i) => i === 0 ? { ...r, arm: 'candidate' } : r), plan)).toThrow(/does not list/);
    expect(() => score(rows, [])).toThrow(/no planned order/);
  });

  test('the CLI refuses to score without the sealed manifest of a real run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-score-'));
    const rows = [...panel(() => ({})), ...panel(() => ({}), 'hermes')];
    writeFileSync(join(dir, 'cells.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const seal = (m: object) => { const t = JSON.stringify(m); writeFileSync(join(dir, 'manifest.json'), t); writeFileSync(join(dir, 'manifest.sha256'), createHash('sha256').update(t).digest('hex') + '\n'); };
    const cli = (args: string[]) => spawnSync('bun', ['scripts/tool-discipline/panel-score.ts', ...args], { cwd: join(import.meta.dir, '..'), encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    const scored = () => cli([join(dir, 'cells.jsonl'), '--manifest', join(dir, 'manifest.json')]);
    const real = { ...PANEL_DESIGN, upstream: 'default', start_hook: { arm: 'candidate' }, arms: structuredClone(PANEL_ARMS), order: order(rows) };
    seal(real);
    expect(cli([join(dir, 'cells.jsonl')]).status).toBe(64);
    const ok = scored();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('## openclaw: fail');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...real, edited: true }));
    const tampered = scored();
    expect([tampered.status, tampered.stderr]).toEqual([2, expect.stringContaining('does not match the manifest.sha256')]);
    seal(real);
    rmSync(join(dir, 'manifest.sha256'));
    const unsealed = scored();
    expect([unsealed.status, unsealed.stderr]).toEqual([2, expect.stringContaining('does not match the manifest.sha256')]);
    seal({ ...real, dry_run: true });
    const dry = scored();
    expect([dry.status, dry.stderr]).toEqual([2, expect.stringContaining('dry run')]);
    seal({ ...real, upstream: 'http://127.0.0.1:8837' });
    const fake = scored();
    expect([fake.status, fake.stderr]).toEqual([2, expect.stringContaining('not the preregistered start-hook panel: upstream is "http://127.0.0.1:8837"')]);
    const smoke = rows.filter(r => r.trial_index === 1);
    writeFileSync(join(dir, 'cells.jsonl'), smoke.map(r => JSON.stringify(r)).join('\n') + '\n');
    seal({ ...real, trials_per_cell: 1, hermes_mode: 'oneshot', order: order(smoke) });
    const one = scored();
    expect([one.status, one.stderr]).toEqual([2, expect.stringContaining('not the preregistered start-hook panel: hermes_mode is "oneshot", not "chat"')]);
  });

  test('refused: a manifest that is not the preregistered panel (fake upstream, no start hook, other SHAs, the hook on another arm)', () => {
    const plan = order([...panel(() => ({})), ...panel(() => ({}), 'hermes')]);
    const real = () => ({ ...PANEL_DESIGN, upstream: 'default', start_hook: { arm: 'candidate' }, arms: structuredClone(PANEL_ARMS) as any, order: plan } as any);
    expect(panelManifestProblem(real())).toBeNull();
    expect(panelManifestProblem({ ...real(), trials_per_cell: 1 })).toMatch(/trials_per_cell is 1, not 8/);
    expect(panelManifestProblem({ ...real(), model: 'claude-haiku-4-5' })).toMatch(/model is "claude-haiku-4-5", not "claude-opus-5-5"/);
    expect(panelManifestProblem({ ...real(), max_tokens: 64000 })).toMatch(/max_tokens is 64000, not 128000/);
    expect(panelManifestProblem({ ...real(), panel_cap_usd: 40 })).toMatch(/panel_cap_usd is 40, not 28/);
    expect(panelManifestProblem({ ...real(), per_trial_usd: 2 })).toMatch(/per_trial_usd is 2, not 1/);
    expect(panelManifestProblem({ ...real(), tree_dirty: true })).toMatch(/tree_dirty is true, not false/);
    expect(panelManifestProblem({ ...real(), order: plan.filter((o: any) => !(o.harness === 'hermes' && o.task === 2 && o.arm === 'none' && o.trial_id.endsWith('-8'))) })).toMatch(/plans 7 trials for hermes task 2 none, not 8/);
    expect(panelManifestProblem({ ...real(), order: [...plan, ...order(panel(() => ({}), 'qm'))] })).toMatch(/outside the 18 preregistered ones: qm task 1 none/);
    expect(panelManifestProblem({ ...real(), order: [...plan, { trial_id: 'x', harness: 'openclaw', task: 4, arm: 'none' }] })).toMatch(/outside the 18 preregistered ones: openclaw task 4 none$/);
    expect(panelManifestProblem({ ...real(), upstream: undefined })).toMatch(/upstream is undefined, not default/);
    expect(panelManifestProblem({ ...real(), upstream: 'http://172.17.0.1:9' })).toMatch(/upstream is "http:\/\/172\.17\.0\.1:9"/);
    expect(panelManifestProblem({ ...real(), start_hook: null })).toMatch(/start_hook\.arm is undefined, not candidate/);
    const offHook = real(); offHook.arms.candidate.start_hook = 'off';
    expect(panelManifestProblem(offHook)).toMatch(/candidate start_hook is "off", not on/);
    const baseOn = real(); baseOn.arms.baseline.start_hook = 'on';
    expect(panelManifestProblem(baseOn)).toMatch(/baseline start_hook is "on", not off/);
    const otherSha = real(); otherSha.arms.candidate.gstack_sha = 'b15492a148e2744d24b0ca4da5ba290fb109c340';
    expect(panelManifestProblem(otherSha)).toMatch(/candidate gstack_sha is "b15492a1[0-9a-f]+", not b9fda18c6ac232de2b5a99ac3e6893955c55d7c0/);
    const noNone = real(); delete noNone.arms.none;
    expect(panelManifestProblem(noNone)).toMatch(/none gstack_sha is undefined, not none/);
    const otherBase = real(); otherBase.arms.baseline.gstack_sha = '0'.repeat(40);
    expect(panelManifestProblem(otherBase)).toMatch(/baseline gstack_sha/);
  });

  test('cost counts only trials that sent a model request: a skipped image adds no $0 trials', () => {
    const rows = panel((task, arm) => ({ termination: arm === 'none' ? 'infra:runtime' : undefined }));
    const s = one(rows);
    expect(s.arms.none.cost_n).toBe(0);
    expect(s.arms.none.cost_median).toBeNull();
    expect(s.arms.baseline.cost_n).toBe(24);
    expect(s.arms.baseline.cost_interval).toEqual({ lo: 0.1, hi: 0.1 });
  });

  test('refused: a plan without all three arms on tasks 1 to 3', () => {
    const rows = panel(() => ({})).filter(r => r.arm !== 'none');
    expect(() => score(rows, order(rows))).toThrow(/no openclaw task 1 none/);
    const noCand = panel(() => ({})).filter(r => !(r.arm === 'candidate' && r.task === 3));
    expect(() => score(noCand, order(noCand))).toThrow(/task 3 candidate/);
  });

  test('cost adds committed reservation charges and counts unresolved reservations', () => {
    const rows = panel(() => ({})).map(r => r.arm === 'candidate' ? { ...r, usd_charged_reservation: 3, usd_reserved_unknown: r.trial_index === 1 ? 2 : 0 } : r);
    const c = one(rows).arms.candidate;
    expect(c.cost_median).toBeCloseTo(3.1, 6);
    expect(c.cost_unresolved).toBe(3);
  });

  test('an attempted start with no observed exit counts as not attributable', () => {
    const rows = panel(() => ({})).map(r => r.arm === 'candidate' && r.task === 1 && r.trial_index <= 2 ? { ...r, evidence: { ...r.evidence, metrics: { ...r.evidence.metrics, started_attempted: 1, started_exit: r.trial_index === 1 ? null : 'ambiguous' } } } : r);
    expect(one(rows).arms.candidate.attempted_unattributed).toBe(2);
  });

  test('smallest success drop the guard can show at 16 is 4 of 16', () => {
    expect(smallestShownDrop(16)).toBe(0.25);
    expect(newcombe(13, 16, 16, 16).hi).toBeGreaterThan(0);
  });

  test('median interval: order statistics 7 and 18 of 24, none under 6 values', () => {
    expect(medianInterval(Array.from({ length: 24 }, (_, i) => i + 1))).toEqual({ lo: 7, hi: 18 });
    expect(medianInterval([1, 2, 3, 4, 5])).toBeNull();
    expect(medianInterval([1, 2, 3, 4, 5, 6])).toEqual({ lo: 1, hi: 6 });
  });

  test('newcombe interval brackets the difference', () => {
    const d = newcombe(6, 16, 0, 16);
    expect(d.d).toBeCloseTo(0.375, 3);
    expect(d.lo).toBeGreaterThan(0);
    expect(d.hi).toBeLessThan(1);
  });
});
