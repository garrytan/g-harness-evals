// Keyless test of scripts/skills-at-scale/analyze.ts on synthetic trials where the answer is known: a planted +10 at 1,500
// only gives S = 1,500, a planted harm fails its bar, the per-model rule on two-model harnesses, the no-skill drift drop
// (F3), the reachable and all-requests lines (F13), the place breakdown, pins, set T and the loader (internal-task).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUNGS, analyze, interimLook, interimUnitOf, interimUnits, judgeFor, ladderOf, loadScaleTrials, markdown, nonInferior, type LabelRow, type Places, type Request, type ScaleTrial } from '../scripts/skills-at-scale/analyze.ts';

const OPUS = 'anthropic:claude-opus-5-5';
const PARTICLE = 'particle:particle-1';
const TARGETS = Array.from({ length: 100 }, (_, i) => 'sk-' + String(i).padStart(3, '0'));
const extra = (rung: number, n: number) => Array.from({ length: n }, (_, i) => 'd' + rung + '-' + i);
const RUNG_SKILLS: Record<string, string[]> = { '100': TARGETS, '351': [...TARGETS, ...extra(351, 251)] };
RUNG_SKILLS['700'] = [...RUNG_SKILLS['351']!, ...extra(700, 349)];
RUNG_SKILLS['1500'] = [...RUNG_SKILLS['700']!, ...extra(1500, 800)];
const LADDER = ladderOf(RUNG_SKILLS);
const SKILL_REQ = TARGETS.flatMap((t, i) => ['a', 'b', 'c'].map((s) => ({ id: 'l-s-' + String(i).padStart(3, '0') + '-' + s, kind: 'skill' as const, target: t })));
const NONE_REQ = Array.from({ length: 120 }, (_, i) => ({ id: 'l-n-' + String(i).padStart(3, '0'), kind: 'none' as const, target: null }));
const REQUESTS: Request[] = [...SKILL_REQ, ...NONE_REQ];
const label = (acc: string[]) => ({ no_skill_needed: !acc.length, acceptable: acc });
const LABELS: LabelRow[] = [...SKILL_REQ.map((r) => ({ id: r.id, judges: { astra: label([r.target]), opus: label([r.target]) } })), ...NONE_REQ.map((r) => ({ id: r.id, judges: { astra: label([]), opus: label([]) } }))];
const placesFor = (harness: string, notLoaded = 0): Places => ({ [harness]: Object.fromEntries(Object.keys(RUNG_SKILLS).map((r) => [r, {
  described: TARGETS.slice(0, 50), name_only: TARGETS.slice(50, 75), omitted: TARGETS.slice(75, 100 - notLoaded), not_loaded: TARGETS.slice(100 - notLoaded) }])) });

type Plant = { right?: (i: number, rung: number, model: string) => boolean; lose?: (i: number, rung: number) => boolean; wrong?: (i: number, rung: number, model: string) => boolean; noSkill?: (j: number, rung: number, model: string) => boolean; block?: (j: number) => boolean; arm?: string };
function trials(harness: string, models: string[], rungs: number[], plant: Plant): ScaleTrial[] {
  const out: ScaleTrial[] = [];
  for (const model of models) for (const rung of rungs) for (const arm of ['native', plant.arm ?? 'resolver']) {
    const cell = harness + '-' + model.split(':')[1] + '-' + arm + '-' + rung;
    const push = (task: string, opened: string[], block: boolean) => out.push({ id: 'run/' + cell + '/' + task + '/r1', cell, harness, model, arm, task, termination: 'completed', opened, got_skill_file: true,
      turns: arm === 'native' ? [] : [{ session: task, turn: 1, block, block_tokens: block ? 30 : 0, injected: block, on: true, suggestions: [], phase: null, exhausted: false, code: 'OK', infra: [] }],
      infra: [], set_t: null, rung, usage: { input_tokens: arm === 'native' ? 10000 : 10500, usd: arm === 'native' ? 0.05 : 0.0525 }, saw: { described: i0(task) < 150 ? [SKILL_REQ[i0(task)]?.target ?? ''] : [], name_only: [] } });
    const i0 = (task: string) => SKILL_REQ.findIndex((r) => r.id === task);
    SKILL_REQ.forEach((r, i) => {
      const base = i % 2 === 0;
      const on = arm !== 'native';
      const right = (base && !(on && !!plant.lose?.(i, rung))) || (on && !!plant.right?.(i, rung, model));
      const wrong = on && !!plant.wrong?.(i, rung, model);
      push(r.id, [...(right ? [r.target] : []), ...(wrong ? ['d351-0'] : [])], on);
    });
    NONE_REQ.forEach((r, j) => push(r.id, arm !== 'native' && plant.noSkill?.(j, rung, model) ? ['sk-000'] : [], !!plant.block?.(j)));
  }
  return out;
}
const base = { requests: REQUESTS, labels: LABELS, ladder: LADDER };
const decision = (a: ReturnType<typeof analyze>, h: string) => a.decisions.find((d) => d.harness === h)!;

describe('skills-at-scale analysis', () => {
  test('a planted +10 at 1,500 only gives S = 1,500, with 700 failed and the smaller rungs never tested', () => {
    const a = analyze({ ...base, places: placesFor('claude-code'), trials: trials('claude-code', [OPUS], [1500, 700, 351, 100], { right: (i, r) => r === 1500 && i % 10 === 1 }) });
    const d = decision(a, 'claude-code');
    expect(d.S).toBe(1500);
    expect(d.sequence.map((s) => s.status)).toEqual(['pass', 'fail', 'not_tested', 'not_tested']);
    const r1500 = a.per_rung.find((r) => r.rung === 1500)!;
    expect(r1500.outcomes.opened_right_skill.delta).toBeCloseTo(0.1, 6);
    expect(r1500.outcomes.opened_right_skill.n_pairs).toBe(300);
    expect(r1500.outcomes.no_skill_opened_any.n_pairs).toBe(120);
    expect(d.margins_source).toContain('not preregistered');
    expect(a.status.final).toBe(false);
    expect(markdown(a)).toContain('flip on at 1500 skills and above');
  }, 120000);

  test('the same gain at every rung gives S = 100', () => {
    const a = analyze({ ...base, places: placesFor('claude-code'), trials: trials('claude-code', [OPUS], [1500, 700, 351, 100], { right: (i) => i % 10 === 1 }) });
    expect(decision(a, 'claude-code').S).toBe(100);
  }, 120000);

  test('a planted wrong-skill harm fails its bar, so a big gain still gives no S', () => {
    const a = analyze({ ...base, places: placesFor('codex'), margins: { codex: { wrong_skill: 0.045, no_skill_open: 0.045 } },
      trials: trials('codex', ['openai:gpt-6.1-sol'], [1500], { right: (i) => i % 10 < 4 && i % 2 === 1, wrong: (i) => i % 10 === 3 }) });
    const d = decision(a, 'codex');
    const step = d.sequence[0]!.detail as any;
    expect(step.opened_right_skill.pass).toBe(true);
    expect(step.harm.wrong_skill.pass).toBe(false);
    expect(d.S).toBeNull();
    expect(d.verdict).toContain('stays opt-in');
    expect(d.margins_source).toBe('preregistered');
  }, 120000);

  test('a planted no-skill harm fails its bar', () => {
    const a = analyze({ ...base, places: placesFor('claude-code'), margins: { 'claude-code': { wrong_skill: 0.045, no_skill_open: 0.045 } },
      trials: trials('claude-code', [OPUS], [1500], { right: (i) => i % 10 === 1, noSkill: (j) => j % 7 === 0 }) });
    const step = decision(a, 'claude-code').sequence[0]!.detail as any;
    expect(step.harm.wrong_skill.pass).toBe(true);
    expect(step.harm.no_skill_open.pass).toBe(false);
    expect(decision(a, 'claude-code').S).toBeNull();
  }, 120000);

  test('two-model harness: a harm on one model fails the rung even when the other model is clean', () => {
    const a = analyze({ ...base, places: placesFor('hermes'), margins: { hermes: { wrong_skill: 0.045, no_skill_open: 0.045 } },
      trials: trials('hermes', [OPUS, PARTICLE], [1500], { right: (i) => i % 10 === 1, wrong: (i, _r, m) => m === PARTICLE && i % 10 === 3 }) });
    const harm = (decision(a, 'hermes').sequence[0]!.detail as any).harm.wrong_skill;
    expect(harm.per_model.find((x: any) => x.model === OPUS).pass).toBe(true);
    expect(harm.per_model.find((x: any) => x.model === PARTICLE).pass).toBe(false);
    expect(harm.pass).toBe(false);
    expect(decision(a, 'hermes').S).toBeNull();
  }, 120000);

  test('a harm bar with no discordant pair uses the exact bound over clusters', () => {
    const a = analyze({ ...base, places: placesFor('claude-code'), trials: trials('claude-code', [OPUS], [1500], { right: (i) => i % 10 === 1 }) });
    const ws = (decision(a, 'claude-code').sequence[0]!.detail as any).harm.wrong_skill.per_model[0];
    expect(ws.method).toContain('no discordant pair');
    expect(ws.upper).toBeCloseTo(1 - 0.025 ** (1 / 300), 3);
    expect(nonInferior({ n_pairs: 0 } as any, 0.05).pass).toBe(false);
  }, 120000);

  test('F3: a no-skill request with an acceptable skill leaves the no-skill bars at the rungs that hold it', () => {
    const labels = LABELS.map((l) => (l.id === 'l-n-000' ? { id: l.id, judges: { astra: label(['d700-3']), opus: label(['d700-3']) } } : l));
    const a = analyze({ ...base, labels, places: placesFor('claude-code'), trials: trials('claude-code', [OPUS], [700, 351], {}) });
    const at = (r: number) => a.per_rung.find((x) => x.rung === r)!.outcomes.no_skill_opened_any;
    expect(at(700).n_pairs).toBe(119);
    expect(at(700).excluded['acceptable skill at this rung (F3)']).toBe(1);
    expect(at(351).n_pairs).toBe(120);
  }, 120000);

  test('F13 and places: the reachable line drops unlisted targets, every outcome is broken out by place, tokens are paired', () => {
    const a = analyze({ ...base, places: placesFor('openclaw', 10), trials: trials('openclaw', [OPUS], [1500], { right: (i) => i % 10 === 1 }) });
    const r = a.per_rung[0]!;
    expect(r.outcomes.opened_right_skill.n_pairs).toBe(300);
    expect(r.outcomes.opened_right_skill_reachable.n_pairs).toBe(225);
    expect(r.outcomes.opened_right_skill_reachable.excluded['no acceptable skill in the native listing']).toBe(75);
    expect(Object.keys(r.by_place).sort()).toEqual(['described', 'name_only', 'not_loaded', 'omitted']);
    expect(r.by_place.not_loaded!.opened_right_skill.n_pairs).toBe(30);
    expect(r.visibility.target_place).toEqual({ described: 150, name_only: 75, omitted: 45, not_loaded: 30 });
    expect(r.outcomes.input_tokens_per_request.delta).toBe(500);
    expect(r.outcomes.saw_right_skill.mean_a).toBeCloseTo(0.5, 6);
    expect(r.cost_per_arm.resolver!.mean_usd).toBeCloseTo(0.0525, 6);
  }, 120000);

  test('pins: a planted +20 on pinned targets with nothing lost elsewhere says pins help', () => {
    const pins = TARGETS.slice(0, 20);
    const ts = trials('pi', [OPUS], [1500], { arm: 'resolver-pins', right: (i) => i < 60 && i % 2 === 1 && i % 6 !== 5 }); // pregate-literal: MIN_GOLD=60 the 60 pinned-target pairs of this fixture, not a gold count
    const a = analyze({ ...base, places: placesFor('pi'), pins, trials: [...ts, ...trials('pi', [OPUS], [1500], {}).filter((t) => t.arm === 'resolver')] });
    expect(a.pins.pinned_targets.n_pairs).toBe(60); // pregate-literal: MIN_GOLD=60 the 60 pinned-target pairs of this fixture, not a gold count
    expect(a.pins.pinned_targets.delta).toBeGreaterThanOrEqual(0.1);
    expect(a.pins.verdict).toContain('pins help');
  }, 120000);

  test('a no-skill block rate over 25% raises FIX-METHOD without blocking the flip', () => {
    const a = analyze({ ...base, places: placesFor('claude-code'), trials: trials('claude-code', [OPUS], [1500], { right: (i) => i % 10 === 1, block: (j) => j % 2 === 0 }) });
    expect(a.per_rung[0]!.no_skill_block_rate[0]!.no_skill_requests_with_block.rate).toBeCloseTo(0.5, 6);
    expect(decision(a, 'claude-code').fix_method_no_skill_gate).toContain('1500');
    expect(decision(a, 'claude-code').S).toBe(1500);
  }, 120000);

  test('the no-skill block rate reads saw-skill.json block_requests when no status turns exist, and leaves out trials with no record', () => {
    const ts = trials('claude-code', [OPUS], [1500], { right: (i) => i % 10 === 1, block: (j) => j % 2 === 0 }).map((t) => t.arm !== 'resolver' ? t : { ...t, turns: [], saw: { ...t.saw!, resolver: [], block_requests: t.turns.some((u) => u.block) ? 1 : 0, requests: 1 } });
    const a = analyze({ ...base, places: placesFor('claude-code'), trials: ts });
    expect(a.per_rung[0]!.no_skill_block_rate[0]!.no_skill_requests_with_block.rate).toBeCloseTo(0.5, 6);
    const none = ts.map((t) => t.arm === 'resolver' && t.saw!.block_requests === 0 ? { ...t, saw: null } : t);
    const b = analyze({ ...base, places: placesFor('claude-code'), trials: none });
    expect(b.per_rung[0]!.no_skill_block_rate[0]!.no_skill_requests_with_block.rate).toBeCloseTo(1, 6);
  }, 120000);

  test('set T success wholly below 0 blocks the rung', () => {
    const setT = (arm: string, task: string, success: boolean): ScaleTrial => ({ id: 'run/t-' + arm + '/' + task + '/r1', cell: 't-' + arm, harness: 'claude-code', model: OPUS, arm, task, termination: 'completed', opened: [], got_skill_file: true, turns: [], infra: [], task_phase: true,
      set_t: { task, target: 'sk-000', pack: 'x', skill_md_sha256: 'x', arm, request_sha256: 'x', success, used_it: success, instruction_md: 'seeded', checks: [] } as any, rung: 1500, usage: null, saw: null });
    const tasks = Array.from({ length: 48 }, (_, i) => 't' + String(i).padStart(2, '0'));
    const st = tasks.flatMap((t, i) => [setT('native', t, i < 30), setT('resolver', t, i < 10)]);
    const a = analyze({ ...base, places: placesFor('claude-code'), trials: [...trials('claude-code', [OPUS], [1500], { right: (i) => i % 10 === 1 }), ...st] });
    const step = decision(a, 'claude-code').sequence[0]!.detail as any;
    expect(step.task_success.pass).toBe(false);
    expect(decision(a, 'claude-code').S).toBeNull();
    expect(a.set_t.per_rung[0]!.success.delta).toBeCloseTo(-20 / 48, 6);
  }, 120000);

  test('status: final only with a passing judge check and every adjudication done; adjudicated skills join the acceptable set', () => {
    const ts = trials('claude-code', [OPUS], [1500], { wrong: (i) => i === 1 });
    const judgeCheck = { n_gold: 100, sources: { 'openai:gpt-6.2-astra': { kappa: 0.72 }, 'anthropic:claude-opus-5-5': { kappa: 0.65 } } };
    const queue = [{ request_id: SKILL_REQ[1]!.id, skill: 'd351-0' }];
    const pending = analyze({ ...base, places: placesFor('claude-code'), trials: ts, judgeCheck, queue });
    expect(pending.status.final).toBe(false);
    expect(pending.status.adjudication.pending).toBe(1);
    expect(pending.per_rung[0]!.outcomes.opened_wrong_skill.n_better).toBe(1);
    const interim = interimLook({ ...base, places: placesFor('claude-code'), trials: ts });
    const noLook = analyze({ ...base, places: placesFor('claude-code'), trials: ts, judgeCheck, queue, adjudications: [{ ...queue[0]!, acceptable: true }] });
    expect(noLook.status.why_not_final.join()).toContain('R113');
    const noFlags = analyze({ ...base, places: placesFor('claude-code'), trials: ts, judgeCheck, queue, interim, adjudications: [{ ...queue[0]!, acceptable: true }] });
    expect(noFlags.status.final).toBe(false);
    expect(noFlags.status.why_not_final).toEqual(['no flagged-trial file supplied (flags.ts)']);
    const done = analyze({ ...base, places: placesFor('claude-code'), trials: ts, judgeCheck, queue, interim, adjudications: [{ ...queue[0]!, acceptable: true }], flagged: [] });
    expect(done.status.final).toBe(true);
    expect(done.per_rung[0]!.outcomes.opened_wrong_skill.n_better).toBe(0);
    expect(done.per_rung[0]!.outcomes.opened_right_skill.n_better).toBe(1);
    expect(analyze({ ...base, places: placesFor('claude-code'), trials: ts, queue, judgeCheck: { ...judgeCheck, n_gold: 99 } }).status.final).toBe(false);
  }, 120000);

  test('flagged trials: unsettled ones block the final status; settled ones count with the readers\' verdicts and get their own line', () => {
    const ts = trials('claude-code', [OPUS], [1500], { wrong: (i) => i === 1 });
    const t = ts.find((x) => x.arm === 'resolver' && x.task === SKILL_REQ[1]!.id)!;
    const judgeCheck = { n_gold: 100, sources: { 'openai:gpt-6.2-astra': { kappa: 0.72 }, 'anthropic:claude-opus-5-5': { kappa: 0.65 } } };
    const interim = interimLook({ ...base, places: placesFor('claude-code'), trials: ts });
    const flagged = [{ trial_id: t.id, cell: t.cell, arm: 'resolver', harness: 'claude-code', model: OPUS, rung: 1500, flags: ['cd-joined' as const], call_ids: ['toolu_1'], trace_paths: [], sources: [] }];
    const common = { ...base, places: placesFor('claude-code'), trials: ts, judgeCheck, queue: [], interim, flagged };
    const open = analyze(common);
    expect(open.status.final).toBe(false);
    expect(open.status.why_not_final).toEqual(['1 flagged trial(s) not settled by two agreeing readers']);
    expect(open.per_rung[0]!.outcomes.opened_wrong_skill.n_better).toBe(1);
    const settled = analyze({ ...common, settled: [{ trial_id: t.id, contaminated: false, opened: [SKILL_REQ[1]!.target!], readers: ['a', 'b'] }] });
    expect(settled.status.final).toBe(true);
    expect(settled.per_rung[0]!.outcomes.opened_wrong_skill.n_better).toBe(0);
    expect(settled.per_rung[0]!.outcomes.opened_right_skill.n_better).toBe(1);
    expect(settled.flags.per_arm).toEqual([{ harness: 'claude-code', rung: 1500, arm: 'resolver', trials: 420, flagged: 1, settled: 1, unsettled: 0, changed_by_settlement: 1 }]);
    expect(markdown(settled)).toContain('| claude-code | 1500 | resolver | 420 | 1 | 1 | 0 | 1 |');
    const dirty = analyze({ ...common, settled: [{ trial_id: t.id, contaminated: true, opened: [], readers: ['a', 'b'] }] });
    expect(dirty.trials.contaminated).toBe(1);
  }, 120000);

  describe('interim look at half the targets (R113)', () => {
    const units = interimUnits(REQUESTS);
    const firstHalf = (ts: ScaleTrial[]) => ts.filter((t) => t.rung !== 1500 || units.has(interimUnitOf(REQUESTS.find((r) => r.id === t.task)) ?? ''));
    const wide = { 'claude-code': { wrong_skill: 0.12, no_skill_open: 0.12 } };

    test('the units are a fixed half of the targets and a fixed half of the no-skill requests', () => {
      const targets = new Set(REQUESTS.filter((r) => r.kind === 'skill').map((r) => r.target));
      const none = REQUESTS.filter((r) => r.kind === 'none');
      expect([...units].filter((u) => targets.has(u)).length).toBe(Math.floor(targets.size / 2));
      expect(none.filter((r) => units.has(r.id)).length).toBe(Math.floor(none.length / 2));
      expect([...interimUnits([...REQUESTS].reverse())].sort()).toEqual([...units].sort());
    });

    test('an early stop: a large gain stops at the interim, passes 1,500 on half the units and is labelled possibly overstated', () => {
      const ts = trials('claude-code', [OPUS], [1500, 700], { right: (i, r) => r === 1500 && i % 2 === 1 });
      const look = interimLook({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts), margins: wide });
      expect(look.harnesses['claude-code']!.decision).toBe('stop_efficacy');
      expect(look.harnesses['claude-code']!.n_pairs).toBe(150);
      const a = analyze({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts), interim: look, margins: wide });
      expect((a.decisions[0]!.sequence[0]!.detail as any).harm.no_skill_open.look).toBe('interim');
      expect((a.decisions[0]!.sequence[1]!.detail as any).harm.no_skill_open.look).toBe('final');
      const d = decision(a, 'claude-code');
      expect(d.S).toBe(1500);
      expect(d.stopped_early).toBe(true);
      expect(d.verdict).toContain('possibly overstated');
      expect((d.sequence[0]!.detail as any).opened_right_skill.rule).toContain('possibly overstated');
      expect(markdown(a)).toContain('stopped early; possibly overstated');
    }, 120000);

    test('a crossed efficacy bound is held when a harm bar cannot pass on half the units, and the run is judged at the final look', () => {
      const ts = trials('claude-code', [OPUS], [1500, 700], { right: (i, r) => r === 1500 && i % 2 === 1 });
      const x = interimLook({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts) }).harnesses['claude-code']! as any;
      expect(x.z).toBeGreaterThanOrEqual(2.8);
      expect(x.efficacy_bound_crossed).toBe(true);
      expect(x.decision).toBe('continue');
      expect(x.held).toContain('harm bar');
      expect(x.harm_at_interim.no_skill_open.pass).toBe(false);
      const d = decision(analyze({ ...base, places: placesFor('claude-code'), trials: ts, interim: { ...interimLook({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts) }) } }), 'claude-code');
      expect(d.stopped_early).toBe(false);
      expect(d.S).toBe(1500);
      expect((d.sequence[0]!.detail as any).opened_right_skill.rule).toBe('final look: z >= 1.98');
    }, 120000);

    test('a futility stop: a loss at the interim fails 1,500, so nothing smaller is tested', () => {
      const plant = { right: (i: number, r: number) => r === 1500 && Math.floor(i / 3) % 5 === 2, lose: (i: number, r: number) => r === 1500 && Math.floor(i / 3) % 5 < 2 };
      const ts = trials('claude-code', [OPUS], [1500, 700], plant);
      const look = interimLook({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts) });
      const x = look.harnesses['claude-code']!;
      expect(x.decision).toBe('stop_futility');
      expect(x.z!).toBeGreaterThan(-2.8);
      expect(x.conditional_power!).toBeLessThan(0.1);
      const d = decision(analyze({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts), interim: look }), 'claude-code');
      expect(d.S).toBeNull();
      expect(d.sequence.map((s) => s.status)).toEqual(['fail', 'not_tested', 'not_tested', 'not_tested']);
      expect(d.sequence[0]!.detail as any).toMatchObject({ reason: expect.stringContaining('futility') });
    }, 120000);

    test('a run that continues is judged at the end against z >= 1.98', () => {
      const plant = { right: (i: number, r: number) => r === 1500 && [1, 3, 5].includes(i % 10), lose: (i: number, r: number) => r === 1500 && [0, 2].includes(i % 10) };
      const ts = trials('claude-code', [OPUS], [1500, 700], plant);
      const look = interimLook({ ...base, places: placesFor('claude-code'), trials: firstHalf(ts) });
      expect(look.harnesses['claude-code']!.decision).toBe('continue');
      const d = decision(analyze({ ...base, places: placesFor('claude-code'), trials: ts, interim: look }), 'claude-code');
      const right = (d.sequence[0]!.detail as any).opened_right_skill;
      expect(right.rule).toBe('final look: z >= 1.98');
      expect(right.z).toBeGreaterThanOrEqual(1.98);
      expect(d.S).toBe(1500);
      expect(d.stopped_early).toBe(false);
    }, 120000);
  });

  test('judges, ladder and loader', () => {
    expect(judgeFor('openai:gpt-6.1-sol')).toBe('opus');
    expect(judgeFor(OPUS)).toBe('astra');
    expect(judgeFor(PARTICLE)).toBe('astra');
    expect(() => ladderOf({ ...RUNG_SKILLS, '351': ['x'] })).toThrow('HE-SCALE-003');
    expect(() => ladderOf({ '100': [] })).toThrow('HE-SCALE-002');
    const up = [...RUNGS].sort((a, b) => a - b);
    expect(JSON.parse(readFileSync(join(import.meta.dir, '..', 'scripts/skills-at-scale/packs-ladder.json'), 'utf8')).rungs).toEqual(up);
    expect(Object.keys(JSON.parse(readFileSync(join(import.meta.dir, '..', 'tasks/skills-at-scale/catalog/hashes.json'), 'utf8')).rungs).map(Number).sort((a, b) => a - b)).toEqual(up);
    const dir = mkdtempSync(join(tmpdir(), 'scale-analyze-'));
    const cells = [{ id: 'cc-native-1500', harness: 'claude-code', model: OPUS, skill_arm: 'native', rung: 1500 }, { id: 'cc-resolver-1500', harness: 'claude-code', model: OPUS, skill_arm: 'resolver', rung: 1500 }];
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: 'run', cells }));
    const rows = cells.map((c) => {
      const d = join(dir, 'trials', c.id, 'l-s-000-a', 'r1');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'got-skill.json'), JSON.stringify({ catalog_opened: ['sk-000'] }));
      if (c.skill_arm === 'resolver') writeFileSync(join(d, 'saw-skill.json'), JSON.stringify({ described: ['sk-000'], name_only: [], resolver: ['sk-000'], block_requests: 1 }));
      return JSON.stringify({ trial_id: 'run/' + c.id + '/l-s-000-a/r1', cell: c.id, task: 'l-s-000-a', harness: c.harness, model: c.model, termination: 'completed', usage: { input_tokens: 1234, usd: 0.01 } });
    });
    writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
    const loaded = loadScaleTrials(dir);
    expect(loaded.map((t) => [t.arm, t.rung, t.opened, t.usage?.input_tokens, t.saw?.described ?? null])).toEqual([['native', 1500, ['sk-000'], 1234, null], ['resolver', 1500, ['sk-000'], 1234, ['sk-000']]]);
    expect(loaded.map((t) => t.saw?.block_requests ?? null)).toEqual([null, 1]);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: 'run', cells: [{ ...cells[0], rung: 200 }, cells[1]] }));
    expect(() => loadScaleTrials(dir)).toThrow('HE-SCALE-001');
  });
});
