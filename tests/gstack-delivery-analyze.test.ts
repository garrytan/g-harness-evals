// internal-task: scripts/gstack-delivery/analyze.ts and the delivery MDD helper in scripts/paired-mdd.ts on a hand-built fixture whose
// every primary number is worked out by hand below (exact sign-flip counts, Holm steps, cost per solve, pass^2).
import { describe, expect, test } from 'bun:test';
import { analyze, complianceGate, piDeliveryTest, trialValue, type DeliveryTrial } from '../scripts/gstack-delivery/analyze.ts';
import { MARKERS, type Arm, type Kind, type MarkerState, type ProbeResult, type ProbeScored } from '../scripts/gstack-delivery/probes.ts';
import { deliveryMdd } from '../scripts/paired-mdd.ts';
import { normalQuantile } from '../runner/stats/paired.ts';

// Fixture. Pairs: Claude Code on Opus (the primary pool), Pi on Opus (held out unless --pi-delivery-passed), Hermes on
// particle-1 (reported apart). Tasks r01..r10 (review) and s01..s10 (ship), reps 1 and 2.
// Claude Code pass: none fails everything; skill passes rep 1 only; hook passes everything; startup passes everything but s10;
// placebo fails everything. Compliance (markers met): review none 0/3, skill 1/3, hook 3/3, startup 2/3 (r10: 1/3), placebo 0/3;
// ship none 0/2, skill 1/2, hook 2/2, startup 1/2, placebo 0/2. Spend: skill $2 a trial, every other arm $1.
// Exclusions: the hook trial at r01 rep 2 has route_not_delivered; the none trial at s01 rep 1 ended infra_error.
// Contamination: the none trial at r02 rep 1 named a gstack file twice; every skill trial once.
// Pi: every arm fails and meets no marker. particle-1: hook passes, none fails.
const CC = { harness: 'claude-code', model: 'anthropic:claude-opus-5-5' };
const PI = { harness: 'pi', model: 'anthropic:claude-opus-5-5' };
const PART = { harness: 'hermes', model: 'particle:particle-1' };
const TASKS: Array<[Kind, string]> = [...Array.from({ length: 10 }, (_, i) => ['review', 'r' + String(i + 1).padStart(2, '0')] as [Kind, string]), ...Array.from({ length: 10 }, (_, i) => ['ship', 's' + String(i + 1).padStart(2, '0')] as [Kind, string])];
const trials: DeliveryTrial[] = [];
const probes: ProbeResult[] = [];
function add(pair: typeof CC, arm: Arm, kind: Kind, task: string, rep: number, pass: boolean, met: number, o: { termination?: DeliveryTrial['termination']; notDelivered?: boolean; reads?: number; usd?: number } = {}) {
  const id = [pair.harness, arm, task, rep].join('.');
  trials.push({ trial_id: id, ...pair, arm, kind, task, rep, termination: o.termination ?? 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, usd: o.usd ?? 1 });
  const ms = Object.keys(MARKERS).filter((m) => MARKERS[m] === kind);
  const markers = Object.fromEntries(ms.map((m, i) => [m, { card_line: 'x', state: (i < met ? 'met' : 'not_met') as MarkerState }]));
  const delivery = arm === 'hook' || arm === 'startup' || arm === 'placebo' ? { expected_sha256: 'x', in_request_1: !o.notDelivered, match: o.notDelivered ? null : 'exact' as const, request_1_seq: 0, agent_requests: 3, requests_with_copy: 3, copies_per_request: [1, 1, 1] } : null;
  probes.push({ trial_id: id, status: 'scored', kind, arm, wire: 'anthropic-messages', requests: 3, agent_requests: 3, tool_calls: 2, session_end: 'assumed_text', last_action: 'observed', markers, descriptive: {},
    compliance: { met, applicable: ms.length, share: met / ms.length, followed: met === ms.length }, delivery, infra_class: o.notDelivered ? 'route_not_delivered' : null, gstack_reads: o.reads ?? 0 } satisfies ProbeScored);
}
for (const [kind, task] of TASKS) for (const rep of [1, 2]) {
  const full = kind === 'review' ? 3 : 2;
  add(CC, 'none', kind, task, rep, false, 0, { termination: task === 's01' && rep === 1 ? 'infra_error' : 'completed', reads: task === 'r02' && rep === 1 ? 2 : 0 });
  add(CC, 'skill', kind, task, rep, rep === 1, 1, { usd: 2, reads: 1 });
  add(CC, 'hook', kind, task, rep, true, full, { notDelivered: task === 'r01' && rep === 2 });
  add(CC, 'startup', kind, task, rep, task !== 's10', kind === 'review' ? (task === 'r10' ? 1 : 2) : 1);
  add(CC, 'placebo', kind, task, rep, false, 0);
  for (const arm of ['none', 'skill', 'hook', 'startup'] as const) add(PI, arm, kind, task, rep, false, 0);
  add(PART, 'none', kind, task, rep, false, 0);
  add(PART, 'hook', kind, task, rep, true, full);
}
const A = analyze(trials, probes, { draws: 10_000, seed: 7 });
const P20 = 2 ** 20, P10 = 2 ** 10;
const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)!;

describe('pools (d2)', () => {
  test('Pi and particle-1 stay out of the primary pool', () => {
    expect(A.pools.primary).toEqual(['claude-code/anthropic:claude-opus-5-5']);
    expect(A.pools.pi_pairs).toEqual(['pi/anthropic:claude-opus-5-5']);
    expect(A.pools.particle_pairs).toEqual(['hermes/particle:particle-1']);
  });
  test('--pi-delivery-passed pools Pi: hook minus none halves (20 Claude Code items at 1, 20 Pi items at 0)', () => {
    const withPi = analyze(trials, probes, { piDeliveryPassed: true });
    expect(withPi.pools.primary).toHaveLength(2);
    expect(byId(withPi.primary2.comparisons, 'hook minus none').delta).toBeCloseTo(0.5, 12);
    expect(byId(withPi.primary2.comparisons, 'hook minus none').n_tasks).toBe(20);
  });
});

describe('primary 2: pass rate, both kinds pooled, Holm over 4', () => {
  test('hook minus none: every task +1, so the exact sign-flip p is 2 of 2^20; the two excluded rep pairs are counted', () => {
    const c = byId(A.primary2.comparisons, 'hook minus none');
    expect(c.delta).toBe(1);
    expect(c.ci95).toEqual([1, 1]);
    expect(c.p_two_sided).toBe(2 / P20);
    expect(c.p_method).toBe('exact-sign-flip');
    expect(c.n_rep_pairs).toBe(38);
    expect(c.excluded).toEqual({ route_not_delivered: 1, infra_error: 1 });
    expect([c.tasks_better, c.tasks_worse, c.tasks_same]).toEqual([20, 0, 0]);
    expect(c.verdict).toBe('higher pass rate');
  });
  test('startup minus none: 19 tasks +1 and s10 at 0, so 0.95 and p 4 of 2^20', () => {
    const c = byId(A.primary2.comparisons, 'startup minus none');
    expect(c.delta).toBeCloseTo(0.95, 12);
    expect(c.p_two_sided).toBe(4 / P20);
    expect([c.tasks_better, c.tasks_worse, c.tasks_same]).toEqual([19, 0, 1]);
  });
  test('skill minus none and hook minus skill: each lose one task to a pairwise exclusion, so 0.475 and p 4 of 2^20', () => {
    for (const id of ['skill minus none', 'hook minus skill']) {
      const c = byId(A.primary2.comparisons, id);
      expect(c.delta).toBeCloseTo(9.5 / 20, 12);
      expect(c.p_two_sided).toBe(4 / P20);
      expect(c.tasks_same).toBe(1);
    }
  });
  test('Holm: p (2, 4, 4, 4) of 2^20 adjust to (8, 12, 12, 12) of 2^20', () => {
    expect(A.primary2.comparisons.map((c) => c.holm_p)).toEqual([8 / P20, 12 / P20, 12 / P20, 12 / P20]);
  });
});

describe('primary 1: compliance per kind, Holm over 4', () => {
  test('review: hook minus skill is 2/3 on all 10 tasks (p 2 of 2^10); startup minus skill is 0.3 (nine at 1/3, r10 at 0; p 4 of 2^10)', () => {
    const h = byId(A.primary1.comparisons, 'hook minus skill (review)');
    expect(h.delta).toBeCloseTo(2 / 3, 12);
    expect(h.p_two_sided).toBe(2 / P10);
    expect(h.excluded).toEqual({ route_not_delivered: 1 });
    const s = byId(A.primary1.comparisons, 'startup minus skill (review)');
    expect(s.delta).toBeCloseTo(0.3, 12);
    expect(s.p_two_sided).toBe(4 / P10);
  });
  test('ship: hook minus skill is 0.5 on all tasks; startup minus skill is 0 everywhere (degenerate, p 1)', () => {
    expect(byId(A.primary1.comparisons, 'hook minus skill (ship)').delta).toBe(0.5);
    const s = byId(A.primary1.comparisons, 'startup minus skill (ship)');
    expect([s.delta, s.p_two_sided, s.p_method]).toEqual([0, 1, 'degenerate']);
    expect(s.ci95).toEqual([0, 0]);
  });
  test('Holm: p (2, 4, 2, 1024) of 2^10 adjust to (8, 8, 8, 1024) of 2^10; three claims, the ship startup contrast none', () => {
    expect(A.primary1.comparisons.map((c) => c.holm_p)).toEqual([8 / P10, 8 / P10, 8 / P10, 1]);
    expect(A.primary1.comparisons.map((c) => c.claim)).toEqual([true, true, true, false]);
    expect(A.primary1.comparisons[3]!.verdict).toBe('no measurable difference');
  });
});

describe('non-inferiority at a 5-point margin', () => {
  test('no bootstrap draw reaches -5 points, so p is 1 of 10,001 and Holm gives 4 of 10,001: all four non-inferior', () => {
    expect(A.non_inferiority.map((n) => n.id)).toEqual(['hook against none', 'startup against none', 'hook against skill', 'startup against skill']);
    for (const n of A.non_inferiority) { expect(n.p).toBe(1 / 10_001); expect(n.holm_p).toBe(4 / 10_001); expect(n.non_inferior).toBe(true); }
    expect(byId(A.non_inferiority, 'startup against skill').delta).toBeCloseTo((19 * 0.5 - 0.5) / 20, 12);
  });
  test('a contrast with fewer than 10 task clusters is never called non-inferior (methodology item 10)', () => {
    const six = new Set(['r01', 'r02', 'r03', 'r04', 'r05', 'r06']);
    const S = analyze(trials.filter((t) => six.has(t.task)), probes.filter((p) => six.has(p.trial_id.split('.')[2]!)), { passKinds: ['review'], draws: 2_000, seed: 7 });
    for (const n of S.non_inferiority) { expect(n.p).toBeNull(); expect(n.non_inferior).toBe(false); }
    for (const r of S.decision_table.replace_skill) { expect(r.non_inferior).toBe(false); expect(r.replaces_skill).toBe(false); }
  });
});

describe('cost per solve, pass^2 and the decision table', () => {
  test('cost per solve: hook $40 over 39 passes, skill $80 over 20, startup $40 over 38, none has no solve', () => {
    expect(A.cost_per_solve.hook!.usd_per_solve).toBeCloseTo(40 / 39, 12);
    expect(A.cost_per_solve.skill!.usd_per_solve).toBe(4);
    expect(A.cost_per_solve.startup!.usd_per_solve).toBeCloseTo(40 / 38, 12);
    expect(A.cost_per_solve.none!.usd_per_solve).toBeNull();
    expect(A.cost_per_solve.hook!.difference).toBeCloseTo(40 / 39 - 4, 12);
    expect(A.cost_per_solve.hook!.difference_ci95![1]).toBeLessThan(0);
  });
  test('a cost difference pairs the populations: an OpenClaw skill cell at $100 with no startup cell leaves startup minus skill unchanged', () => {
    const n = trials.length, m = probes.length;
    for (const [kind, task] of TASKS) add({ harness: 'openclaw', model: 'anthropic:claude-opus-5-5' }, 'skill', kind, task, 1, true, 1, { usd: 100 });
    const ocTrials = trials.splice(n), ocProbes = probes.splice(m);
    const B = analyze([...trials, ...ocTrials], [...probes, ...ocProbes], { draws: 10_000, seed: 7 });
    expect(B.cost_per_solve.startup!.difference).toBeCloseTo(A.cost_per_solve.startup!.difference!, 12);
    expect(B.cost_per_solve.startup!.difference_ci95).toEqual(A.cost_per_solve.startup!.difference_ci95);
    expect(B.cost_per_solve.hook!.difference).toBeCloseTo(40 / 39 - 4, 12);
  });
  test('pass^2: hook 19 complete units all passing, skill 0, startup 19 of 20, none 0 over 19 units', () => {
    expect([A.pass_squared.hook!.pass2, A.pass_squared.hook!.units]).toEqual([1, 19]);
    expect(A.pass_squared.skill!.pass2).toBe(0);
    expect(A.pass_squared.startup!.pass2).toBeCloseTo(0.95, 12);
    expect([A.pass_squared.none!.pass2, A.pass_squared.none!.units]).toEqual([0, 19]);
  });
  test('the card replaces skill where it is non-inferior and cheaper; defaults follow the compliance claims', () => {
    const pooled = A.decision_table.replace_skill.filter((r) => r.scope === 'pooled');
    expect(pooled.map((r) => [r.delivery, r.replaces_skill])).toEqual([['hook', true], ['startup', true]]);
    expect(A.decision_table.defaults.map((d) => [d.delivery, d.kind, d.recommend_default])).toEqual([['hook', 'review', true], ['startup', 'review', true], ['hook', 'ship', true], ['startup', 'ship', false]]);
  });
  test('per-host advice only where the per-host MDE is reported; constant differences give none', () => {
    const cc = A.decision_table.per_host.filter((r) => r.scope.startsWith('harness claude-code'));
    expect(cc.length).toBe(8);
    expect(cc.find((r) => r.contrast === 'hook minus none')!.advice_allowed).toBe(false);
    expect(A.decision_table.per_host.some((r) => r.scope.includes('pi (not pooled'))).toBe(true);
  });
});

describe('secondary readings, contamination and exclusions', () => {
  test('placebo minus hook is -1 on pass; particle-1 is reported apart with hook minus none at +1', () => {
    expect(byId(A.secondary.placebo, 'placebo minus hook').delta).toBe(-1);
    expect(byId(A.secondary.placebo, 'placebo minus hook').tasks_worse).toBe(20);
    expect(A.secondary.particle.find((r) => r.id === 'hook minus none')!.delta).toBe(1);
  });
  test('a gstack read in the none arm marks it contaminated; the skill arm\'s reads are expected', () => {
    expect(A.contamination.find((c) => c.arm === 'none')).toMatchObject({ trials_reading_gstack: 1, gstack_reads: 2, contaminated: true });
    expect(A.contamination.find((c) => c.arm === 'skill')).toMatchObject({ contaminated: false });
    expect(A.contamination.find((c) => c.arm === 'hook')).toMatchObject({ trials_reading_gstack: 0, contaminated: false });
  });
  test('exclusion reasons: infra terminations, route_not_delivered, unconfirmed delivery, unparsed and unobservable captures', () => {
    const t = trials.find((x) => x.arm === 'hook')!;
    const p = probes.find((x) => x.trial_id === t.trial_id)! as ProbeScored;
    expect(trialValue(t, undefined, 'pass')).toEqual({ excluded: 'delivery_unconfirmed' });
    const unparsed: ProbeResult = { trial_id: t.trial_id, status: 'unparsed', kind: 'review', arm: 'hook', code: 'PROBE_LINE_JSON', wire: 'unknown', detail: '' };
    expect(trialValue(t, unparsed, 'pass')).toEqual({ excluded: 'delivery_unconfirmed' });
    const none = trials.find((x) => x.arm === 'none' && x.termination === 'completed')!;
    expect(trialValue(none, { ...unparsed, arm: 'none' }, 'pass')).toEqual({ value: 0 });
    expect(trialValue(none, { ...unparsed, arm: 'none' }, 'compliance')).toEqual({ excluded: 'unparsed' });
    expect(trialValue(t, { ...p, compliance: { ...p.compliance, share: null } }, 'compliance')).toEqual({ excluded: 'unobservable' });
    expect(A.exclusions.find((e) => e.arm === 'hook')!.excluded).toEqual({ 'pass:route_not_delivered': 1, 'compliance:route_not_delivered': 1 });
  });
});

describe('the d5 compliance gate on headroom transcripts', () => {
  test('none at 0% followed and every marker at 0% passes both kinds', () => {
    expect(complianceGate(probes).map((g) => [g.kind, g.pass, g.followed_share, g.markers_at_most_60])).toEqual([['review', true, 0, 3], ['ship', true, 0, 2]]);
  });
  test('a none arm that already follows the card fails the gate', () => {
    const followed = probes.filter((p) => p.arm === 'hook').map((p) => ({ ...p, arm: 'none' as Arm }));
    expect(complianceGate(followed).every((g) => !g.pass)).toBe(true);
  });
  test('ship scores fresh_verification and final_diff_after_commit; tests_after_merge is descriptive and never counts toward the gate', () => {
    const ship = probes.filter((p): p is ProbeScored => p.status === 'scored' && p.kind === 'ship' && p.arm === 'none').map((p) => ({ ...p, descriptive: { 'ship.tests_after_merge': { state: 'met' as MarkerState } } }));
    const [g] = complianceGate(ship).filter((x) => x.kind === 'ship');
    expect(Object.keys(g!.markers).sort()).toEqual(['ship.final_diff_after_commit', 'ship.fresh_verification']);
    expect(g!.descriptive['ship.tests_after_merge']).toEqual({ scored: ship.length, met_share: 1 });
    expect([g!.pass, g!.markers_at_most_60]).toEqual([true, 2]);
  });
});

describe('the delivery MDD helper on headroom data', () => {
  test('16 tasks per kind at a rate of one half: SE and MDD by hand', () => {
    const rows = ['review', 'ship'].flatMap((kind) => Array.from({ length: 16 }, (_, i) => [{ task: 't' + i, kind, pass: 1 }, { task: 't' + i, kind, pass: 0 }]).flat());
    const m = deliveryMdd(rows, { pairs: 8, reps: 2 }, { alpha: 0.05, holmFamily: 4, power: 0.8 });
    const review = m.find((x) => x.endpoint === 'pass' && x.scope === 'review')!;
    const g = 16, se = Math.sqrt((g / (g - 1)) * g * 8 * 2 * 0.25 / 2) / (g * 8);
    expect(review.se_null).toBeCloseTo(se, 12);
    expect(review.mdd).toBeCloseTo((normalQuantile(1 - 0.05 / 8) + normalQuantile(0.8)) * se, 12);
    expect(review.min_one_sided_clusters).toBe(8);
    expect(m.find((x) => x.scope === 'all')!.tasks).toBe(32);
  });
  test('tasks at 0 or 1 add no variance; excluded terminations are dropped; compliance rows give their own line', () => {
    const m = deliveryMdd([{ task: 'a', kind: 'ship', pass: 1 }, { task: 'b', kind: 'ship', pass: 0 }, { task: 'c', kind: 'ship', pass: 1, termination: 'infra_error' }, { task: 'a', kind: 'ship', pass: 1, compliance: 0.5 }]);
    const pass = m.find((x) => x.endpoint === 'pass' && x.scope === 'ship')!;
    expect([pass.tasks, pass.tasks_flat, pass.se_null, pass.mdd]).toEqual([2, 2, null, null]);
    expect(m.some((x) => x.endpoint === 'compliance')).toBe(true);
  });
});

describe('--pass-kinds review: ship is a compliance-only kind (ruling B1)', () => {
  const B = analyze(trials, probes, { draws: 10_000, seed: 7, passKinds: ['review'] });
  test('the default keeps both kinds and reports nothing as descriptive', () => {
    expect(A.pass_kinds).toEqual(['review', 'ship']);
    expect(A.compliance_only_kinds).toEqual([]);
    expect(A.descriptive_pass).toEqual([]);
  });
  test('primary 2 reads review only: hook minus none is +100 points over 10 tasks, exact sign-flip p 2/2^10', () => {
    expect(B.primary2.family).toBe('pass rate, review only, Holm over 4');
    const c = byId(B.primary2.comparisons, 'hook minus none');
    expect(c.kinds).toEqual(['review']);
    expect([c.delta, c.n_tasks, c.p_two_sided]).toEqual([1, 10, 2 / P10]);
    expect(byId(B.primary2.comparisons, 'skill minus none').delta).toBeCloseTo(0.5, 12);
  });
  test('non-inferiority, cost per solve and the replace rows use review only; compliance is unchanged', () => {
    expect(byId(B.non_inferiority, 'hook against none').delta).toBe(1);
    expect(byId(B.non_inferiority, 'startup against skill').delta).toBeCloseTo(0.5, 12);
    expect(B.cost_per_solve.hook!.usd_per_solve).toBeCloseTo(20 / 19, 12);
    expect(B.cost_per_solve.skill!.usd_per_solve).toBe(4);
    expect(B.decision_table.replace_skill.map((r) => [r.delivery, r.scope])).toEqual([['hook', 'pooled'], ['startup', 'pooled']]);
    expect(B.primary1.comparisons.map((c) => [c.id, c.delta])).toEqual(A.primary1.comparisons.map((c) => [c.id, c.delta]));
  });
  test('ship pass rate is reported apart as descriptive, with its cost per solve', () => {
    expect(B.compliance_only_kinds).toEqual(['ship']);
    const d = B.descriptive_pass[0]!;
    expect(d.kind).toBe('ship');
    const c = byId(d.comparisons, 'hook minus none (ship)');
    expect([c.delta, c.n_tasks]).toEqual([1, 10]);
    expect(d.cost_per_solve.skill!.usd_per_solve).toBe(4);
    expect(d.non_inferiority.map((n) => n.id)).toEqual(['hook against none (ship)', 'startup against none (ship)', 'hook against skill (ship)', 'startup against skill (ship)']);
  });
});

describe('Pi delivery test (d2), from delivery records only', () => {
  test('every Pi hook and startup trial of the fixture carries the card on every request: 80 of 80, passed', () => {
    expect(piDeliveryTest(trials, probes)).toEqual({ trials: 80, delivered: 80, share: 1, threshold: 0.95, pass: true });
  });
  test('a hook trial missing a copy on a follow-up, or a card missing from request 1, is not delivered; 5 of 80 missing fails', () => {
    const broken = new Set(trials.filter((t) => t.harness === 'pi' && (t.arm === 'hook' || t.arm === 'startup')).slice(0, 5).map((t) => t.trial_id));
    const ps = probes.map((p) => (broken.has(p.trial_id) && p.status === 'scored' ? { ...p, delivery: { ...p.delivery!, requests_with_copy: p.arm === 'hook' ? 2 : 3, in_request_1: p.arm === 'hook' } } : p));
    expect(piDeliveryTest(trials, ps)).toMatchObject({ trials: 80, delivered: 75, pass: false });
  });
  test('particle-1 and Claude Code trials do not count', () => {
    expect(piDeliveryTest(trials.filter((t) => t.harness !== 'pi'), probes).trials).toBe(0);
  });
});
