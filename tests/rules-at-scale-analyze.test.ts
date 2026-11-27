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
/** noise flips each rule of every arm but b80k with that chance, so paired differences vary and the look has an SE. */
function world(noise = 0): Trial[] {
  const r = rng(11);
  const out: Trial[] = [];
  const metBy: Record<string, number> = { none: 0, short: 6, b8k: 6, b28k: 6, b80k: 3, b160k: 2, split: 2, hook: 6, cutlift: 6 };
  for (const s of design.setups) for (const arm of s.arms) TASKS.forEach((_, i) => out.push(trial(s.id, arm, i, metBy[arm]!, r, arm === 'b80k' ? 0.15 : noise)));
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
    const rec = interimLook(world(0.05), design);
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
    const ts = world().map((t) => (t.setup === 'cc' && t.arm === 'b160k' ? { ...t, rules: all('met') } : t)).map((t, i) => (t.setup === 'cc' && t.arm === 'short' ? { ...t, rules: { ...all('met'), R6: 'not_met' as RuleState, ...(i % 2 ? { R5: 'not_met' as RuleState } : {}) } } : t));
    const rec = interimLook(ts, design);
    const cc = rec.comparisons.filter((c) => c.setup === 'cc' && c.comparison.startsWith('ladder:'));
    expect(cc[0]!.decision).toBe('stop_loss');
    expect(cc.slice(1).every((c) => c.decision === 'stop_futility')).toBe(true);
  });

  test('the interim look never stops a comparison with a zero SE or fewer than 6 usable pairs', () => {
    const flat = interimLook(world(), design).comparisons.find((c) => c.setup === 'cc' && c.comparison === 'ladder:b160k')!;
    expect(flat.n_pairs).toBe(18);
    expect(flat.decision).toBe('continue');
    const keep = new Set(TASKS.slice(0, 5));
    const few = world(0.05).filter((t) => !(t.setup === 'cc' && t.arm === 'b160k') || keep.has(t.task));
    const step = interimLook(few, design).comparisons.find((c) => c.setup === 'cc' && c.comparison === 'ladder:b160k')!;
    expect(step.n_pairs).toBe(5);
    expect(step.decision).toBe('continue');
    const six = new Set(TASKS.slice(0, 6));
    const enough = interimLook(world(0.05).filter((t) => !(t.setup === 'cc' && t.arm === 'b160k') || six.has(t.task)), design).comparisons.find((c) => c.setup === 'cc' && c.comparison === 'ladder:b160k')!;
    expect(enough.n_pairs).toBe(6);
    expect(enough.decision).toBe('stop_efficacy');
  });

  test('the final analysis keeps interim decisions and flags early stops', () => {
    const all36 = world(0.05);
    const rec = interimLook(all36, design);
    const a = analyze(all36.filter((t) => !rec.cells_stopping.some((c) => c.setup === t.setup && c.arm === t.arm) || rec.tasks.includes(t.task)), design, rec);
    expect(a.status).toBe('final');
    const cc = a.setups.find((s) => s.setup === 'cc')!;
    const top = cc.ladder.steps[0]!;
    expect(top.decided_by).toBe('interim stop_efficacy');
    expect(top.possibly_overstated).toBe(true);
    expect(render(a)).toContain('possibly overstated');
  });

  test('completeness: a missing planned row makes the analysis incomplete; a stopped cell needs only its interim half; a setup with no trials is listed as not run', () => {
    const all36 = world(0.05);
    const rec = interimLook(all36, design);
    expect(rec.missing_rows).toEqual([]);
    const asPlanned = (rows: Trial[], look: typeof rec) => rows.filter((t) => !look.cells_stopping.some((c) => c.setup === t.setup && c.arm === t.arm) || look.tasks.includes(t.task));
    const ts = asPlanned(all36, rec);
    const done = analyze(ts, design, rec);
    expect(done.status).toBe('final');
    expect(done.completeness).toMatchObject({ setups_with_rows: ['cc', 'cx'], setups_without_rows: [], missing_rows: [], extra_rows: [] });
    const gap = analyze(ts.filter((t) => !(t.setup === 'cc' && t.arm === 'b8k' && t.task === TASKS[30])), design, rec);
    expect(gap.status.startsWith('incomplete: 1 planned row(s) have no trial')).toBe(true);
    expect(gap.completeness.missing_rows).toEqual(['cc|b8k|' + TASKS[30]]);
    expect(render(gap)).toContain('Completeness: 1 planned row(s) have no trial, first cc|b8k|' + TASKS[30]);
    const stopped = rec.cells_stopping.find((c) => c.setup === 'cc' && c.arm === 'hook')!;
    const second = new Set(TASKS.slice(18));
    expect(analyze(ts.filter((t) => !(t.setup === stopped.setup && t.arm === stopped.arm && second.has(t.task))), design, rec).status).toBe('final');
    const ccAll = all36.filter((t) => t.setup === 'cc');
    const ccLook = interimLook(ccAll, design);
    const solo = analyze(asPlanned(ccAll, ccLook), design, ccLook);
    expect(solo.status).toBe('final');
    expect(solo.completeness.setups_without_rows).toEqual(['cx']);
    const early = ts.filter((t) => !(t.setup === 'cx' && t.arm === 'short' && t.task === TASKS[2]));
    const lookGap = interimLook(early, design);
    expect(lookGap.missing_rows).toEqual(['cx|short|' + TASKS[2]]);
    expect(lookGap.status).toBe('incomplete: 1 planned row(s) of the interim half have no trial (see missing_rows)');
    expect(rec.status).toBe('complete');
    const dir = mkdtempSync(join(tmpdir(), 'ras-look-'));
    writeFileSync(join(dir, 'trials.jsonl'), early.map((t) => JSON.stringify(t)).join('\n') + '\n');
    writeFileSync(join(dir, 'design.json'), JSON.stringify(design));
    const look = spawnSync('bun', [join(import.meta.dir, '..', 'scripts', 'rules-at-scale', 'analyze.ts'), '--trials', join(dir, 'trials.jsonl'), '--design', join(dir, 'design.json'), '--look', 'interim', '--out', join(dir, 'look')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    expect(look.status).toBe(1);
    expect(look.stderr).toContain('the look is incomplete: 1 planned row(s) of the interim half have no trial: cx|short|' + TASKS[2]);
    expect(JSON.parse(readFileSync(join(dir, 'look', 'interim.json'), 'utf8')).status.startsWith('incomplete')).toBe(true);
    const healed = analyze(asPlanned(all36, lookGap), design, lookGap);
    expect(healed.status).toBe('incomplete: 0 planned row(s) have no trial, and the interim look was taken with 1 missing (see completeness)');
    expect(analyze(all36, design, null).status.startsWith('provisional')).toBe(true);
    const unanswered = analyze(ts.map((t) => (t.setup === 'cc' && t.arm === 'b8k' && t.task === TASKS[3] ? { ...t, infra: 'no_model_response', rules: all('unscorable') } : t)), design, rec);
    expect(unanswered.setups.find((s) => s.setup === 'cc')!.counts.b8k!.no_model_response).toBe(1);
    expect(render(unanswered)).toContain('b8k 0.0% (1 more with no answer from the cell model, unscored, timed out or not)');
  });

  test('completeness rejects rows outside the plan: a second-half row of a cell the interim look stopped, or a task not in the order; the CLI writes the analysis and exits 1', () => {
    const all36 = world(0.05);
    const rec = interimLook(all36, design);
    const stop = rec.cells_stopping[0]!;
    const planned = all36.filter((t) => !rec.cells_stopping.some((c) => c.setup === t.setup && c.arm === t.arm) || rec.tasks.includes(t.task));
    const late = all36.find((t) => t.setup === stop.setup && t.arm === stop.arm && !rec.tasks.includes(t.task))!;
    const stray = { ...planned.find((t) => t.setup === 'cx' && t.arm === 'short')!, task: 'task-99' };
    const a = analyze([...planned, late, stray], design, rec);
    expect(a.completeness.extra_rows).toEqual([stop.setup + '|' + stop.arm + '|' + late.task, 'cx|short|task-99']);
    expect(a.completeness.missing_rows).toEqual([]);
    expect(a.status).toBe('invalid: 2 row(s) outside the plan (see completeness.extra_rows)');
    expect(render(a)).toContain('2 row(s) outside the plan, first ' + stop.setup + '|' + stop.arm + '|' + late.task);
    expect(analyze(planned, design, rec).status).toBe('final');
    expect(rec.setups_with_rows).toEqual(['cc', 'cx']);
    expect(() => analyze(planned, design, { ...rec, tasks: TASKS.slice(1, 19) })).toThrow('not the first half of this design\'s task order');
    const dir = mkdtempSync(join(tmpdir(), 'ras-extra-'));
    writeFileSync(join(dir, 'trials.jsonl'), [...planned, late].map((t) => JSON.stringify(t)).join('\n') + '\n');
    writeFileSync(join(dir, 'design.json'), JSON.stringify(design));
    writeFileSync(join(dir, 'interim.json'), JSON.stringify(rec));
    const cli = spawnSync('bun', [join(import.meta.dir, '..', 'scripts', 'rules-at-scale', 'analyze.ts'), '--trials', join(dir, 'trials.jsonl'), '--design', join(dir, 'design.json'), '--interim', join(dir, 'interim.json'), '--out', join(dir, 'out')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('1 row(s) outside the plan: ' + stop.setup + '|' + stop.arm + '|' + late.task);
    expect(JSON.parse(readFileSync(join(dir, 'out', 'analysis.json'), 'utf8')).status.startsWith('invalid')).toBe(true);
  });

  test('timed-out trials count in every rate, and each arm reports its timeout share and the rates without them', () => {
    const ts = world();
    const hit = ts.filter((t) => t.setup === 'cc' && t.arm === 'b160k').slice(0, 9);
    for (const t of hit) { t.infra = 'agent_timeout'; t.rules = all('met'); }
    hit[0]!.infra = 'AgentTimeoutError';
    const a = analyze(ts, design, null);
    const cc = a.setups.find((s) => s.setup === 'cc')!;
    expect(cc.counts.b160k!.timeouts).toBe(9);
    expect(cc.counts.b160k!.timeout_share).toBeCloseTo(9 / 36, 4);
    expect(cc.counts.short!.timeout_share).toBe(0);
    const arm = cc.arms.b160k!;
    expect(arm.rules_followed.n).toBe(36);
    expect(arm.rules_followed_without_timeouts.n).toBe(27);
    expect(arm.rules_followed.estimate!).toBeGreaterThan(arm.rules_followed_without_timeouts.estimate!);
    const top = cc.ladder.steps[0]!;
    expect(top.contrast!.n_pairs).toBe(36);
    expect(top.contrast_without_timeouts!.n_pairs).toBe(27);
    expect(top.contrast_without_timeouts!.delta).toBeLessThan(top.contrast!.delta);
    expect(cc.repairs[0]!.contrast_without_timeouts!.n_pairs).toBe(27);
    expect(a.pooled.ladder.find((r) => r.rung === 'top')!.contrast_without_timeouts!.n_pairs).toBe(36 + 27);
    const md = render(a);
    expect(md).toContain('Timeout share by arm:');
    expect(md).toContain('b160k 25.0%');
    expect(md).toContain('without timeouts');
  });

  test('timed-out trials with no capture are counted per arm, and housekeeping calls get their own row of calls and dollars', () => {
    const ts = world();
    const cc = (arm: string) => ts.filter((t) => t.setup === 'cc' && t.arm === arm);
    for (const t of cc('b160k').slice(0, 2)) { t.infra = 'TIMEOUT_NO_CAPTURE'; t.rules = all('unscorable'); t.solved = null; }
    cc('b8k')[0]!.housekeeping = [{ model: 'claude-haiku-5-5', requests: 3, usd: 0.012 }];
    cc('b8k')[1]!.housekeeping = [{ model: 'claude-haiku-5-5', requests: 1, usd: null }];
    const a = analyze(ts, design, null);
    const s = a.setups.find((x) => x.setup === 'cc')!;
    expect(s.counts.b160k!.timeout_no_capture).toBe(2);
    expect(s.counts.b160k!.timeouts).toBe(0);
    expect(s.housekeeping.b8k).toEqual({ models: ['claude-haiku-5-5'], requests: 4, usd: 0.012, unpriced_entries: 1 });
    expect(s.housekeeping.short).toEqual({ models: [], requests: 0, usd: null, unpriced_entries: 0 });
    const md = render(a);
    expect(md).toContain('b160k 0.0% (2 with no capture, unscored)');
    expect(md).toContain('Harness housekeeping (metered, never scored) by arm: none none; short none; b8k 4 calls on claude-haiku-5-5, $0.01');
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
