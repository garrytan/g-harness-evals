import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RULE_IDS, analyze, followed, interimLook, render, validateTrials, type Design, type RuleId, type RuleState, type Trial } from '../scripts/rules-at-scale/analyze.ts';
import { obfBounds } from '../scripts/rules-at-scale/sequential.ts';

const TASKS = Array.from({ length: 36 }, (_, i) => 'task-' + String(i).padStart(2, '0'));
const sizes = ['none', 'short', 'b8k', 'b28k', 'b80k', 'b160k'];
const design: Design = {
  alpha: 0.05, power: 0.8, planned_effect: 0.10, sd: 0.22, seed: 7, draws: 4000, task_order: TASKS,
  pooled_setups: ['cc', 'cx'],
  setups: [
    { id: 'cc', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', arms: [...sizes, 'split', 'hook'] },
    { id: 'cx', harness: 'codex', model: 'openai:gpt-6.1-sol', arms: [...sizes, 'split', 'hook', 'cutlift'] },
  ],
};

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const all = (st: RuleState) => Object.fromEntries(RULE_IDS.map((id) => [id, st])) as Record<RuleId, RuleState>;
function trial(setup: string, arm: string, i: number, met: number, r: () => number, flip = 0): Trial {
  const rules = all('not_met');
  RULE_IDS.forEach((id, k) => { rules[id] = k < met ? 'met' : 'not_met'; if (r() < flip) rules[id] = rules[id] === 'met' ? 'not_met' : 'met'; });
  return { setup, arm, task: TASKS[i]!, rotation: (i % 3) as 0 | 1 | 2, rules, delivery: Object.fromEntries(RULE_IDS.map((id) => [id, 'whole'])) as Trial['delivery'], solved: 1, usd: 0.3 + (arm === 'b160k' ? 0.2 : 0), input_tokens: 1000, infra: null };
}
function world(): Trial[] {
  const r = rng(11);
  const out: Trial[] = [];
  const metBy: Record<string, number> = { none: 0, short: 6, b8k: 6, b28k: 6, b80k: 3, b160k: 2, split: 2, hook: 6, cutlift: 6 };
  for (const s of design.setups) for (const arm of s.arms) TASKS.forEach((_, i) => out.push(trial(s.id, arm, i, metBy[arm]!, r, arm === 'b80k' ? 0.15 : 0)));
  return out;
}

describe('rules-at-scale analysis', () => {
  test('two-look bounds match the plan', () => {
    const b = obfBounds(0.05, 2);
    expect(b.interim).toBeCloseTo(2.797, 2);
    expect(b.final).toBeCloseTo(1.977, 2);
    expect(obfBounds(0.05 / 3, 2).final).toBeGreaterThan(b.final);
  });

  test('rules followed leaves out not applicable and unscorable rules', () => {
    const t = trial('cc', 'short', 0, 6, () => 1);
    t.rules.R5 = 'not_applicable'; t.rules.R6 = 'unscorable'; t.rules.R1 = 'not_met';
    expect(followed(t)).toBeCloseTo(3 / 4, 6);
    expect(followed({ ...t, rules: all('unscorable') })).toBeNull();
  });

  test('ladder finds the drop size and the safe size, repairs pass or fail', () => {
    const a = analyze(world(), design, null);
    const cc = a.setups.find((s) => s.setup === 'cc')!;
    expect(cc.ladder.order).toEqual(['b160k', 'b80k', 'b28k', 'b8k']);
    expect(cc.ladder.steps.map((s) => s.status)).toEqual(['pass', 'pass', 'fail', 'not_tested']);
    expect(cc.ladder.drop_size).toBe('b80k');
    expect(cc.ladder.safe_size).toBe('b28k');
    const rep = Object.fromEntries(cc.repairs.map((r) => [r.arm, r.status]));
    expect(rep).toEqual({ split: 'fail', hook: 'pass' });
    const cx = a.setups.find((s) => s.setup === 'cx')!;
    expect(cx.repairs.map((r) => r.arm)).toEqual(['split', 'hook', 'cutlift']);
    expect(a.status.startsWith('provisional')).toBe(true);
    expect(a.pooled.ladder.find((r) => r.rung === 'top')!.contrast!.n_pairs).toBe(72);
    expect(cc.cost.find((c) => c.arm === 'b160k')!.usd!.delta).toBeCloseTo(0.2, 4);
    expect(render(a)).toContain('Drop size: b80k. Safe size: b28k.');
  });

  test('unscorable and contaminated trials are counted, never scored', () => {
    const ts = world();
    const t = ts.find((x) => x.setup === 'cc' && x.arm === 'b8k' && x.task === 'task-00')!;
    t.rules = all('unscorable');
    ts.find((x) => x.setup === 'cc' && x.arm === 'b8k' && x.task === 'task-01')!.contaminated = true;
    const cc = analyze(ts, design, null).setups.find((s) => s.setup === 'cc')!;
    expect(cc.counts.b8k.no_value).toBe(1);
    expect(cc.counts.b8k.contaminated).toBe(1);
    const step8 = cc.ladder.steps.find((s) => s.rung === 'b8k')!;
    expect(step8.contrast!.n_pairs).toBe(34);
    expect(step8.contrast!.only_one_arm).toBe(2);
    const step28 = cc.ladder.steps.find((s) => s.rung === 'b28k')!;
    expect(step28.contrast!.n_pairs).toBe(36);
  });

  test('the interim look uses half the tasks and stops only cells whose comparisons all stopped', () => {
    const rec = interimLook(world(), design);
    expect(rec.tasks).toEqual(TASKS.slice(0, 18));
    const cc = rec.comparisons.filter((c) => c.setup === 'cc');
    expect(cc.find((c) => c.comparison === 'ladder:b160k')!.decision).toBe('stop_efficacy');
    expect(cc.find((c) => c.comparison === 'ladder:b160k')!.n_pairs).toBe(18);
    expect(cc.find((c) => c.comparison === 'repair:hook')!.decision).toBe('stop_efficacy');
    expect(cc.find((c) => c.comparison === 'repair:hook')!.alpha).toBeCloseTo(0.025, 6);
    const stopping = rec.cells_stopping.filter((c) => c.setup === 'cc').map((c) => c.arm);
    expect(stopping).not.toContain('short');
    expect(stopping).toContain('hook');
    expect(stopping).not.toContain('none');
  });

  test('a ladder step that stops for loss ends the sequence at the look', () => {
    const ts = world().map((t) => (t.setup === 'cc' && t.arm === 'b160k' ? { ...t, rules: all('met') } : t)).map((t) => (t.setup === 'cc' && t.arm === 'short' ? { ...t, rules: { ...all('met'), R6: 'not_met' as RuleState } } : t));
    const rec = interimLook(ts, design);
    const cc = rec.comparisons.filter((c) => c.setup === 'cc' && c.comparison.startsWith('ladder:'));
    expect(cc[0]!.decision).toBe('stop_loss');
    expect(cc.slice(1).every((c) => c.decision === 'stop_futility')).toBe(true);
  });

  test('the final analysis keeps interim decisions and flags early stops', () => {
    const ts = world();
    const rec = interimLook(ts, design);
    const a = analyze(ts, design, rec);
    expect(a.status).toBe('final');
    const cc = a.setups.find((s) => s.setup === 'cc')!;
    const top = cc.ladder.steps[0]!;
    expect(top.decided_by).toBe('interim stop_efficacy');
    expect(top.possibly_overstated).toBe(true);
    expect(render(a)).toContain('possibly overstated');
  });

  test('validation refuses unknown arms and second trials', () => {
    const ts = world();
    expect(() => validateTrials([...ts, ts[0]], design)).toThrow(/second trial/);
    expect(() => validateTrials([{ ...ts[0]!, arm: 'qm-top' }], design)).toThrow(/no arm qm-top/);
  });

  test('the command line writes analysis.json and analysis.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ras-analyze-'));
    writeFileSync(join(dir, 'design.json'), JSON.stringify(design));
    writeFileSync(join(dir, 'trials.jsonl'), world().map((t) => JSON.stringify(t)).join('\n') + '\n');
    const run = spawnSync('bun', ['scripts/rules-at-scale/analyze.ts', '--trials', join(dir, 'trials.jsonl'), '--design', join(dir, 'design.json'), '--out', join(dir, 'out')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'out', 'analysis.json'), 'utf8')).setups).toHaveLength(2);
    expect(readFileSync(join(dir, 'out', 'analysis.md'), 'utf8')).toContain('# Rules at scale: analysis');
  });

  test('the shipped design names every setup of the plan', () => {
    const d: Design = JSON.parse(readFileSync('scripts/rules-at-scale/design.json', 'utf8'));
    expect(d.setups.map((s) => s.id).sort()).toEqual(['claude-code-opus', 'codex-sol', 'hermes-opus', 'hermes-particle', 'openclaw-opus', 'pi-opus', 'pi-particle', 'qm-opus', 'qm-particle']);
    expect(d.setups.reduce((n, s) => n + s.arms.length, 0)).toBe(66);
  });
});
