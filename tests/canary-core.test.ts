// The regression canary's core (scripts/canary/): release identity on recorded refs, the decision rule on synthetic trials,
// the exact tests against runner/stats/paired.ts, the power simulator's null rate, the alert format (golden), the task
// selection's pools, the receipts helpers and the monthly lease. Keyless: no network, no model call.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clusteredPairedDelta, seededRandom } from '../runner/stats/paired.ts';
import { renderAlert, renderDigest, renderNoMove, renderOk, type HistoryLine } from '../scripts/canary/alert.ts';
import { decide, fisherLessP, flaggedModels, signFlipPLess, signTestP, type Arm, type CanaryTrial, type DecideInput, type ModelKey, type TasksFile, type Thresholds, type TrialTier, type Verdict } from '../scripts/canary/decide.ts';
import { current, describe as describeRelease, fixtureLayer, moves, type Layer } from '../scripts/canary/releases.ts';
import { prepare, state } from '../scripts/canary/receipts.ts';
import { analyticNullRate, pForFlip, simulate } from '../scripts/canary/simulate.ts';
import { sharedOrder } from '../scripts/canary/select-tasks.ts';

const ROOT = join(import.meta.dir, '..');
const DIR = join(ROOT, 'docs/benchmarks/2026-11-09-regression-canary');
const PREREG = JSON.parse(readFileSync(join(DIR, 'prereg-canary.json'), 'utf8'));
const TH: Thresholds = PREREG.thresholds;
const FIXTURE = join(ROOT, 'tests/fixtures/canary-core/refs-2026-11-09.json');
const GS = { prev: '910093087dec4877f99dfaed6600784942ed7a7b', old: 'e75a69c9e15164d090e080fa001dc515495ec350' };
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: mkdtempSync(join(tmpdir(), 'canary-core-home-')) };
const hasFrontier = spawnSync('git', ['rev-parse', '--verify', '-q', 'origin/harn50/frontier-results'], { cwd: ROOT, env }).status === 0;

// ---- synthetic trials ------------------------------------------------------------------------------------------------
const TASKS = Array.from({ length: 30 }, (_, i) => 'task-' + String(i).padStart(2, '0'));
const tasksFile = (suite: 'gstack' | 'gbrain'): TasksFile => ({
  suite,
  models: {
    opus: { harness: 'claude-code', model: 'anthropic:claude-opus-5-5', tasks: TASKS, t1: TASKS.slice(0, 4), digest: ['mid-0', 'mid-1', 'mid-2', 'mid-3'] },
    sol: { harness: 'codex', model: 'openai:gpt-6.1-sol', tasks: TASKS, t1: TASKS.slice(0, 4), digest: ['mid-0', 'mid-1', 'mid-2', 'mid-3'] },
    ...(suite === 'gbrain' ? { particle: { harness: 'hermes', model: 'particle:particle-1', tasks: TASKS, t1: TASKS.slice(0, 4), digest: [], label: 'no particle-1 receipts; descriptive only' } } : {}),
  },
});
interface Plan { pass?: (m: ModelKey, arm: Arm, task: string, a: number) => boolean; usd?: (m: ModelKey, arm: Arm, task: string) => number; patch?: (t: CanaryTrial) => void }
function trials(suite: 'gstack' | 'gbrain', tier: TrialTier, arms: Arm[], models: ModelKey[], k: number, plan: Plan = {}): CanaryTrial[] {
  const f = tasksFile(suite);
  const out: CanaryTrial[] = [];
  for (const m of models) {
    const spec = f.models[m]!;
    const list = tier === 'T1' ? spec.t1 : tier === 'T2' ? [...spec.tasks, ...spec.digest] : spec.tasks;
    for (const arm of arms) for (const task of list) for (let a = 1; a <= k; a++) {
      const ok = plan.pass ? plan.pass(m, arm, task, a) : !task.startsWith('mid');
      const t: CanaryTrial = {
        trial_id: [suite, tier, m, arm, task, a].join('/'), task, harness: spec.harness, model: spec.model, termination: 'completed', grade: ok ? 'pass' : 'fail',
        consent_violation: false, cap_stop: false,
        usage: { meter_id: 'x', requests: 3, refused: 0, failed: 0, usd: plan.usd ? plan.usd(m, arm, task) : 0.3, input_tokens: 1000, output_tokens: 100, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
        canary: {
          suite, tier, arm, product_version: arm === 'plain' ? null : suite === 'gbrain' ? (arm === 'prev' ? '0.60.593.0' : '0.60.613.0') : arm === 'prev' ? '1.97.0.0' : '1.98.0.0', product_sha: arm === 'plain' ? null : arm === 'prev' ? GS.old : GS.prev,
          model_key: m, task, attempt: a, exposure: { first_request_has_product: arm === 'plain' ? false : true, product_calls: arm === 'plain' ? 0 : 2 },
          safety: suite === 'gbrain' ? { cross_scope_reads: 0, hidden_fact_leaks: 0 } : null,
        },
      };
      plan.patch?.(t);
      out.push(t);
    }
  }
  return out;
}
const input = (suite: 'gstack' | 'gbrain', tier: TrialTier, rows: CanaryTrial[], extra: Partial<DecideInput> = {}): DecideInput => ({
  suite, tier, trials: rows, tasks: tasksFile(suite), thresholds: TH,
  expected: { arms: tier === 'T2' ? ['plain', 'prev', 'new'] : ['prev', 'new'], models: tier === 'T2' && suite === 'gbrain' ? ['opus', 'sol', 'particle'] : ['opus', 'sol'] },
  release: { prev: { sha: GS.old, version: '1.97.0.0' }, new: { sha: GS.prev, version: '1.98.0.0' }, range: [{ tag: 'v1.98.0.0', version: '1.98.0.0', sha: GS.prev }] },
  run_id: 'canary-test', install_route: { 'claude-code': './setup --host claude', codex: './setup --host codex' }, ...extra,
});
const BAD6 = new Set(TASKS.slice(4, 10));
const regress = (bad: Set<string>, who: ModelKey = 'opus'): Plan => ({ pass: (m, arm, task) => !(m === who && arm === 'new' && bad.has(task)) && !task.startsWith('mid') });

describe('exact tests', () => {
  test('sign test: first flags at 4-0, 6-1 and 7-2 at p <= 0.10', () => {
    expect(signTestP(4, 0)).toBeCloseTo(0.0625, 10);
    expect(signTestP(3, 0)).toBeGreaterThan(0.1);
    expect(signTestP(5, 1)).toBeGreaterThan(0.1);
    expect(signTestP(6, 1)).toBeLessThanOrEqual(0.1);
    expect(signTestP(7, 2)).toBeLessThanOrEqual(0.1);
    expect(signTestP(0, 0)).toBe(1);
  });
  test('one-sided Fisher test against a hand-computed table', () => {
    // 10/10 previous, 5/10 new: P(X <= 5) with 15 successes in 20, 10 drawn = C(10,5)C(10,10)/C(20,15) = 252/15504
    expect(fisherLessP(10, 10, 5, 10)).toBeCloseTo(252 / 15504, 12);
    expect(fisherLessP(5, 10, 10, 10)).toBeCloseTo(1, 12);
  });
  test('the convolution sign-flip p equals paired.ts p_less wherever paired.ts enumerates exactly', () => {
    const rng = seededRandom(7);
    for (let trial = 0; trial < 25; trial++) {
      const clusters = 2 + Math.floor(rng() * 18);
      const items = Array.from({ length: clusters * 2 }, (_, i) => ({ id: 'i' + i, cluster: 'c' + Math.floor(i / 2), a: rng() < 0.8 ? 1 : 0, b: rng() < 0.6 ? 1 : 0 }));
      const sums = new Map<string, number>();
      for (const it of items) sums.set(it.cluster, (sums.get(it.cluster) ?? 0) + it.b - it.a);
      const stats = clusteredPairedDelta(items, { seed: 1, draws: 1000 });
      if (stats.p_method !== 'exact-sign-flip') continue;
      expect(signFlipPLess([...sums.values()])).toBeCloseTo(stats.p_less, 12);
    }
  });
});

describe('decide: the rule', () => {
  test('identical arms are OK at T1 with nothing next', () => {
    const v = decide(input('gstack', 'T1', trials('gstack', 'T1', ['prev', 'new'], ['opus', 'sol'], 1)));
    expect(v.status).toBe('OK');
    expect(v.next).toBe('none');
    expect(v.models.opus!.pass).toMatchObject({ prev: 4, new: 4, n: 4, b: 0, c: 0 });
  });
  test('a planted 6-task regression flags the T2 screen and sends the run to T3 on that model only', () => {
    const v = decide(input('gstack', 'T2', trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, regress(BAD6))));
    expect(v.status).toBe('WATCH');
    expect(v.next).toBe('T3');
    expect(v.reasons.map((r) => [r.rule, r.model])).toEqual([['pass_screen', 'opus']]);
    expect(v.models.opus!.pass).toMatchObject({ b: 6, c: 0 });
    expect(v.models.opus!.pass.screen_p).toBeCloseTo(1 / 64, 10);
    expect(flaggedModels(v)).toEqual(['opus']);
  });
  test('T3 confirms the planted regression with the paired difference, sign-flip p and bootstrap interval', () => {
    const t2 = decide(input('gstack', 'T2', trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, regress(BAD6))));
    const v = decide(input('gstack', 'T3', trials('gstack', 'T3', ['prev', 'new'], ['opus'], 2, regress(BAD6)), { earlier: t2, expected: { arms: ['prev', 'new'], models: ['opus'] } }));
    expect(v.status).toBe('REGRESSION');
    expect(v.tiers_run).toEqual(['T2', 'T3']);
    expect(v.models.opus!.confirm!.delta_points).toBeCloseTo(-20, 10);
    expect(v.models.opus!.confirm!.p_less).toBeCloseTo(1 / 64, 10);
    expect(v.models.opus!.confirm!.ci95![1]).toBeLessThan(0);
    expect(v.models.opus!.screen!.tier).toBe('T2');
    expect(v.reasons.find((r) => r.rule === 'pass_confirm')).toBeDefined();
  });
  test('a T3 that does not repeat the drop clears the screen flag', () => {
    const t2 = decide(input('gstack', 'T2', trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, regress(BAD6))));
    const v = decide(input('gstack', 'T3', trials('gstack', 'T3', ['prev', 'new'], ['opus'], 2), { earlier: t2, expected: { arms: ['prev', 'new'], models: ['opus'] } }));
    expect(v.status).toBe('OK');
    expect(v.cleared.map((r) => r.rule)).toEqual(['pass_screen']);
  });
  test('several stable moves in range send a flag to bisect instead of T3', () => {
    const range = [{ tag: 'v1.97.5.0', version: '1.97.5.0', sha: 'a'.repeat(40) }, { tag: 'v1.98.0.0', version: '1.98.0.0', sha: GS.prev }];
    const v = decide(input('gstack', 'T2', trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, regress(BAD6)), { release: { ...input('gstack', 'T2', []).release, range } }));
    expect(v.next).toBe('bisect');
  });
  test('harness_error and timeout count as fails; infra_error drops pairwise', () => {
    const rows = trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, {
      patch: (t) => {
        if (t.canary.model_key !== 'opus' || t.canary.arm !== 'new') return;
        if (['task-04', 'task-05', 'task-06'].includes(t.task)) { t.termination = 'harness_error'; t.grade = 'fail'; }
        if (['task-07', 'task-08'].includes(t.task)) { t.termination = 'timeout'; t.grade = 'fail'; }
        if (t.task === 'task-09') { t.termination = 'infra_error'; t.grade = 'n/a'; }
      },
    });
    const v = decide(input('gstack', 'T2', rows));
    expect(v.models.opus!.pass).toMatchObject({ b: 5, c: 0, n: 29 });
    expect(v.models.opus!.pass.harness_error).toEqual({ prev: 0, new: 3 });
    expect(v.notes.some((n) => n.includes('harness_error 0 -> 3'))).toBe(true);
  });
  test('a cost doubling flags at T2 and is a REGRESSION when T3 repeats it', () => {
    const plan: Plan = { usd: (m, arm, task) => (m === 'sol' && arm === 'new' ? 0.6 : 0.3) * (1 + (Number(task.slice(-2)) || 0) / 50) };
    const v2 = decide(input('gstack', 'T2', trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, plan)));
    expect(v2.reasons.map((r) => [r.rule, r.model])).toEqual([['cost_screen', 'sol']]);
    expect(v2.models.sol!.cost.ratio).toBeCloseTo(2, 6);
    const v3 = decide(input('gstack', 'T3', trials('gstack', 'T3', ['prev', 'new'], ['sol'], 2, plan), { earlier: v2, expected: { arms: ['prev', 'new'], models: ['sol'] } }));
    expect(v3.status).toBe('REGRESSION');
    expect(v3.reasons.map((r) => r.rule)).toEqual(['cost_confirm']);
  });
  test('one planted gbrain leak is WATCH at once and triggers T2', () => {
    const rows = trials('gbrain', 'T1', ['prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => { if (t.canary.arm === 'new' && t.canary.model_key === 'sol' && t.task === 'task-01') t.canary.safety = { cross_scope_reads: 1, hidden_fact_leaks: 0 }; } });
    const v = decide(input('gbrain', 'T1', rows));
    expect(v.status).toBe('WATCH');
    expect(v.next).toBe('T2');
    expect(v.reasons[0]).toMatchObject({ rule: 'safety', model: 'sol', sticky: true });
  });
  test('a gbrain leak on a release at or above the leak fix is REGRESSION at once, even when the previous release leaked too', () => {
    expect(TH.gbrain_leak_free_from).toBe('0.60.621.0');
    const leak = (version: string, both: boolean) => trials('gbrain', 'T1', ['prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => {
      if (t.canary.arm === 'new') t.canary.product_version = version;
      if (t.canary.model_key === 'sol' && t.task === 'task-01' && (t.canary.arm === 'new' || both)) t.canary.safety = { cross_scope_reads: 1, hidden_fact_leaks: 0 };
    } });
    const fixed = decide(input('gbrain', 'T1', leak('0.60.621.0', true)));
    expect(fixed.status).toBe('REGRESSION');
    expect(fixed.reasons[0]).toMatchObject({ rule: 'safety_fixed', model: 'sol' });
    expect(decide(input('gbrain', 'T1', leak('0.61.0.0', false))).reasons[0]).toMatchObject({ rule: 'safety_fixed', status: 'REGRESSION' });
    const before = decide(input('gbrain', 'T1', leak('0.60.620.9', true)));
    expect(before.status).toBe('OK');
    expect(decide(input('gbrain', 'T1', leak('0.60.621.0', false).map((t) => (t.canary.safety = { cross_scope_reads: 0, hidden_fact_leaks: 0 }, t)))).status).toBe('OK');
  });
  test('a particle-1 leak at or above the leak fix is reported but never raises REGRESSION', () => {
    const rows = trials('gbrain', 'T1', ['prev', 'new'], ['opus', 'sol', 'particle'], 1, { patch: (t) => {
      if (t.canary.arm === 'new') t.canary.product_version = '0.60.621.0';
      if (t.canary.arm === 'new' && t.canary.model_key === 'particle' && t.task === 'task-01') t.canary.safety = { cross_scope_reads: 0, hidden_fact_leaks: 1 };
    } });
    const v = decide(input('gbrain', 'T1', rows, { expected: { arms: ['prev', 'new'], models: ['opus', 'sol', 'particle'] } }));
    expect(v.status).not.toBe('REGRESSION');
    expect(JSON.stringify(v)).toContain('safety_fixed');
  });
  test('a missing skill in a first request is BROKEN, deterministic and never behavioural', () => {
    const rows = trials('gstack', 'T1', ['prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => { if (t.canary.arm === 'new' && t.task === 'task-02' && t.canary.model_key === 'opus') t.canary.exposure.first_request_has_product = false; } });
    const v = decide(input('gstack', 'T1', rows));
    expect(v.status).toBe('BROKEN');
    expect(v.next).toBe('none');
    expect(renderAlert(v)).toContain('- Exposure: listed in 4/4 -> 3/4; install route ./setup --host claude at 91009308');
  });
  test('T0 exit 10 is BROKEN, any other failure INCOMPLETE', () => {
    const report = { suite: 'gstack' as const, ok: false, checks: [{ arm: 'new', harness: 'codex', name: 'router_present', ok: false, detail: 'no gstack router in ~/.codex' }] };
    expect(decide(input('gstack', 'T1', [], { tier: 'T0', t0: { exit: 10, report } })).status).toBe('BROKEN');
    expect(decide(input('gstack', 'T1', [], { tier: 'T0', t0: { exit: 3, report: null } })).status).toBe('INCOMPLETE');
    const ok = decide(input('gstack', 'T1', [], { tier: 'T0', t0: { exit: 0, report: { ...report, ok: true, checks: [] } } }));
    expect([ok.status, ok.next]).toEqual(['OK', 'T1']);
  });
  test('infra above 20% of an arm, a missing arm, a lease stop and a moved ref are INCOMPLETE', () => {
    const infra = trials('gstack', 'T1', ['prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => { if (t.canary.arm === 'prev' && t.canary.model_key === 'sol' && t.task === 'task-00') t.termination = 'infra_error'; } });
    expect(decide(input('gstack', 'T1', infra)).reasons.map((r) => r.rule)).toEqual(['infra']);
    const missing = trials('gstack', 'T1', ['prev', 'new'], ['opus'], 1);
    expect(decide(input('gstack', 'T1', missing)).reasons.map((r) => r.rule)).toEqual(['missing_arm', 'missing_arm']);
    const ok = trials('gstack', 'T1', ['prev', 'new'], ['opus', 'sol'], 1);
    expect(decide(input('gstack', 'T1', ok, { suite_exit: 20 })).status).toBe('INCOMPLETE');
    expect(decide(input('gstack', 'T1', ok, { ref_moved: true })).reasons[0].rule).toBe('ref_moved');
  });
  test('the plain arm never changes the verdict', () => {
    const base = trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, regress(BAD6));
    const plainFails = base.map((t) => (t.canary.arm === 'plain' ? { ...t, grade: 'fail' as const } : t));
    const plainReaches = base.map((t) => (t.canary.arm === 'plain' ? { ...t, canary: { ...t.canary, exposure: { first_request_has_product: true, product_calls: 3 } } } : t));
    const a = decide(input('gstack', 'T2', base)), b = decide(input('gstack', 'T2', plainFails)), c = decide(input('gstack', 'T2', plainReaches));
    expect([b.status, b.next, c.status, c.next]).toEqual([a.status, a.next, a.status, a.next]);
    expect(b.models.opus!.plain).toEqual({ pass: 0, n: 30 });
    expect(c.notes.some((n) => n.includes('plain arm for opus reached gstack'))).toBe(true);
  });
  test('an exposure drop at T2 is WATCH by the Fisher test', () => {
    const rows = trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => { if (t.canary.arm === 'new' && t.canary.model_key === 'opus' && Number(t.task.slice(-2)) < 12) t.canary.exposure.product_calls = 0; } });
    const v = decide(input('gstack', 'T2', rows));
    expect(v.reasons.map((r) => r.rule)).toEqual(['exposure_rate']);
    expect(v.next).toBe('none');
  });
  test('an exposure drop at T1 is WATCH by the Fisher test too', () => {
    const rows = trials('gstack', 'T1', ['prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => { if (t.canary.arm === 'new' && t.canary.model_key === 'opus') t.canary.exposure.product_calls = 0; } });
    const v = decide(input('gstack', 'T1', rows));
    expect(v.reasons.map((r) => r.rule)).toEqual(['exposure_rate']);
    expect(v.status).toBe('WATCH');
    expect(v.next).toBe('T2');
  });
  test('particle-1 never yields REGRESSION: flags go to the digest, and WATCH only on two screens in a row', () => {
    const rows = trials('gbrain', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol', 'particle'], 1, regress(BAD6, 'particle'));
    const first = decide(input('gbrain', 'T2', rows));
    expect(first.status).toBe('OK');
    expect(first.particle_flags.length).toBe(1);
    expect(first.digest.some((d) => d.startsWith('gbrain particle-1 (descriptive): pass_screen'))).toBe(true);
    const second = decide(input('gbrain', 'T2', rows, { previous: first }));
    expect(second.status).toBe('WATCH');
    expect(second.next).toBe('none');
    expect(second.reasons[0].rule).toBe('particle_repeat');
  });
  test('improvements on digest tasks go to the digest only', () => {
    const rows = trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, { pass: (m, arm, task) => !task.startsWith('mid') || (arm === 'new' && m === 'opus') });
    const v = decide(input('gstack', 'T2', rows));
    expect(v.status).toBe('OK');
    expect(v.digest).toEqual(['gstack opus (claude-code): better on mid-difficulty tasks, pass 0/4 -> 4/4 (4 better, 0 worse; p 0.0625)']);
  });
});

describe('alert', () => {
  const t2 = decide(input('gstack', 'T2', trials('gstack', 'T2', ['plain', 'prev', 'new'], ['opus', 'sol'], 1, regress(BAD6))));
  const v = decide(input('gstack', 'T3', trials('gstack', 'T3', ['prev', 'new'], ['opus'], 2, regress(BAD6)), { earlier: t2, expected: { arms: ['prev', 'new'], models: ['opus'] }, release: { ...input('gstack', 'T3', []).release, bisect: null } }));
  test('golden: a confirmed regression', () => {
    expect(renderAlert(v)).toBe([
      'Harness Evals canary: REGRESSION in gstack stable 1.98.0.0 (91009308), previous 1.97.0.0 (e75a69c9)',
      '- What moved: Opus 5.5 in Claude Code: pass 30/30 -> 24/30 (6 tasks got worse, 0 got better; screen p 0.0156; confirm -20.0 points [-33.3, -6.7])',
      '- Cost per trial: $0.30 -> $0.30 (x1.00 [1.00, 1.00]); tokens per trial 1,100 -> 1,100',
      '- Exposure: called in 60/60 -> 60/60; install route ./setup --host claude at 91009308',
      '- No-gstack/no-brain arm (same window): 30/30',
      '- Tasks that got worse: task-04, task-05, task-06, task-07, task-08, task-09',
      '- Releases in range: 1.98.0.0; bisect: not run',
      '- Receipts: canary-receipts:runs/canary-test/gstack, drive canary/runs/canary-test/',
      '- Suggested owner: internal-task; what to check first: the tasks that got worse: task-04, task-05, task-06',
    ].join('\n'));
  });
  test('golden: a gbrain safety watch carries the safety line and internal-task', () => {
    const rows = trials('gbrain', 'T1', ['prev', 'new'], ['opus', 'sol'], 1, { patch: (t) => { if (t.canary.arm === 'new' && t.canary.model_key === 'sol' && t.task === 'task-01') t.canary.safety = { cross_scope_reads: 1, hidden_fact_leaks: 1 }; } });
    const w = decide(input('gbrain', 'T1', rows, { install_route: null, release: { prev: { sha: '27f8b9d6287c2ba635532c7d3bc015c50e1d769b', version: '0.60.593.0' }, new: { sha: '98dda48fb9fd339609d6d4eef009811280ff648d', version: '0.60.613.0' }, range: [] } }));
    expect(renderAlert(w)).toBe([
      'Harness Evals canary: WATCH in gbrain stable 0.60.613.0 (98dda48f), previous 0.60.593.0 (27f8b9d6)',
      '- What moved: GPT-6.1 Sol in Codex: pass 4/4 -> 4/4 (0 tasks got worse, 0 got better; screen p 1.0000)',
      '- Cost per trial: $0.30 -> $0.30 (x1.00 [1.00, 1.00]); tokens per trial 1,100 -> 1,100',
      '- Exposure: called in 4/4 -> 4/4',
      '- Safety (gbrain): cross-scope reads 0 -> 1; leaks 0 -> 1',
      '- Receipts: canary-receipts:runs/canary-test/gbrain, drive canary/runs/canary-test/',
      "- Suggested owner: internal-task; what to check first: gbrain's scope defaults: a cross-scope read or hidden-fact leak the previous release did not have",
    ].join('\n'));
  });
  test('an INCOMPLETE with no trials keeps only the lines that apply', () => {
    const f = decide(input('gstack', 'T1', [], { tier: 'T0', failure: { detail: 'another canary run holds the lock', check_first: 'lock.json' }, release: { prev: { sha: 'unknown', version: 'unknown' }, new: { sha: 'unknown', version: 'unknown' }, range: [] } }));
    expect(renderAlert(f)).toBe('Harness Evals canary: INCOMPLETE in gstack stable unknown (unknown), previous unknown (unknown)\n- Receipts: canary-receipts:runs/canary-test/gstack, drive canary/runs/canary-test/\n- Suggested owner: internal-task; what to check first: lock.json');
  });
  test('one-line OK summary, the no-move line and the weekly digest', () => {
    const ok = decide(input('gstack', 'T1', trials('gstack', 'T1', ['prev', 'new'], ['opus', 'sol'], 1), { earlier: decide(input('gstack', 'T1', [], { tier: 'T0', t0: { exit: 0, report: { suite: 'gstack', ok: true, checks: [] } } })) }));
    expect(renderOk(ok)).toBe('Harness Evals canary: OK in gstack stable 1.98.0.0 (91009308), previous 1.97.0.0 (e75a69c9); tiers T0,T1; opus pass 4/4 -> 4/4, cost x1.00; sol pass 4/4 -> 4/4, cost x1.00');
    expect(renderNoMove({ gstack: { sha: GS.prev, version: '1.98.0.0' }, gbrain: { sha: '98dda48fb9fd339609d6d4eef009811280ff648d', version: '0.60.613.0' } }))
      .toBe('Harness Evals canary: OK, no stable move (gstack 1.98.0.0 at 91009308, gbrain 0.60.613.0 at 98dda48f)');
    const h = (at: string, product: HistoryLine['product'], status: HistoryLine['status'], digest: string[] = []): HistoryLine => ({ schema: 'canary-history/1', at, run_id: 'r', product, status, new: product ? { sha: 'x', version: product === 'gstack' ? '1.98.0.0' : '0.60.613.0' } : null, digest });
    const lines = [h('2026-11-01T09:00:00Z', 'gstack', 'OK'), h('2026-11-03T09:00:00Z', 'gstack', 'WATCH', ['gstack opus: better on mid-difficulty tasks']), h('2026-11-04T09:00:00Z', null, 'OK'), h('2026-11-05T09:00:00Z', 'gbrain', 'INCOMPLETE')];
    expect(renderDigest(lines, '2026-11-09T09:30:00Z')).toBe('Harness Evals canary weekly digest 2026-11-02 to 2026-11-09: gstack 1 run (WATCH 1), last screened 1.98.0.0; gbrain 1 run (INCOMPLETE 1); 1 quiet night; gstack opus: better on mid-difficulty tasks');
  });
});

describe('releases on recorded refs (2026-11-09)', () => {
  const layer = fixtureLayer(FIXTURE);
  test('current: the gstack stable head with its VERSION, the gbrain stable tag peeled with its stable-v version', () => {
    expect(current(layer, 'gstack')).toEqual({ sha: GS.prev, version: '1.98.0.0', version_source: 'VERSION file' });
    expect(current(layer, 'gbrain')).toEqual({ sha: '98dda48fb9fd339609d6d4eef009811280ff648d', version: '0.60.613.0', version_source: 'tag stable-v0.60.613.0' });
  });
  test('moves: v* tags along gstack stable and stable-v* tags in gbrain, between two commits', () => {
    expect(moves(layer, 'gstack', GS.old, GS.prev)).toEqual([{ tag: 'v1.98.0.0', version: '1.98.0.0', sha: GS.prev }]);
    expect(moves(layer, 'gbrain', '27f8b9d6287c2ba635532c7d3bc015c50e1d769b', '98dda48fb9fd339609d6d4eef009811280ff648d')).toEqual([{ tag: 'stable-v0.60.613.0', version: '0.60.613.0', sha: '98dda48fb9fd339609d6d4eef009811280ff648d' }]);
    expect(describeRelease(layer, 'gstack', GS.old).version).toBe('1.97.0.0');
  });
  test('several moves come back oldest first; lightweight and annotated tags both peel', () => {
    const s = (c: string) => c.repeat(40);
    const fake: Layer = {
      lsRemote: () => [s('1') + '\trefs/heads/stable', s('9') + '\trefs/tags/v1.2.0', s('2') + '\trefs/tags/v1.2.0^{}', s('3') + '\trefs/tags/v1.3.0', s('1') + '\trefs/tags/v1.4.0', s('8') + '\trefs/tags/v1.1.0'].join('\n'),
      readFile: () => '1.4.0\n',
      revList: () => [s('2'), s('3'), s('1')],
    };
    expect(moves(fake, 'gstack', s('0'), s('1')).map((m) => m.version)).toEqual(['1.2.0', '1.3.0', '1.4.0']);
    expect(current(fake, 'gstack').version).toBe('1.4.0');
  });
  test('the CLI answers from the fixture', () => {
    const r = spawnSync('bun', [join(ROOT, 'scripts/canary/releases.ts'), 'current', '--fixture', FIXTURE], { env, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).gbrain.version).toBe('0.60.613.0');
  });
});

describe('simulate', () => {
  test('the analytic null rate of the screen at flip 0.10 on 20 tasks is 0.69%', () => {
    expect(analyticNullRate(20, 0.1, TH.screen_alpha)).toBeCloseTo(0.00689, 5);
    expect(analyticNullRate(30, 0.1, TH.screen_alpha)).toBeCloseTo(0.0165, 4);
  });
  test('the simulated null rate matches the analytic one within Monte Carlo error over 10,000 seeded draws', () => {
    const p = Array.from({ length: 20 }, () => pForFlip(0.1));
    const sim = simulate(p, 0, TH, 10000, 65).screen;
    const a = analyticNullRate(20, 0.1, TH.screen_alpha);
    expect(Math.abs(sim - a)).toBeLessThan(3 * Math.sqrt(a * (1 - a) / 10000) + 1e-9);
  });
  test('power rises with the drop and the joint rate never exceeds the screen rate', () => {
    const p = Array.from({ length: 30 }, () => pForFlip(0.1));
    const rows = [0, 20, 40].map((d) => simulate(p, d, TH, 4000, 3));
    expect(rows[0].screen).toBeLessThan(rows[1].screen);
    expect(rows[1].screen).toBeLessThan(rows[2].screen);
    for (const r of rows) expect(r.joint).toBeLessThanOrEqual(r.screen);
    expect(rows[2].joint).toBeGreaterThan(0.9);
  });
  test.skipIf(!hasFrontier)('power.md is what the simulator writes', () => {
    const r = spawnSync('bun', [join(ROOT, 'scripts/canary/simulate.ts')], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith(readFileSync(join(DIR, 'power.md'), 'utf8'))).toBe(true);
  });
});

describe('select-tasks', () => {
  test('the shared order is sha256(seed + NUL + id), as frontier-harbor uses it', () => {
    const ids = ['b', 'a', 'c'];
    const want = ids.map((id) => ({ id, k: execFileSync('bash', ['-c', 'printf "s\\0%s" "$0" | sha256sum | cut -c1-64', id], { env, encoding: 'utf8' }).trim() })).sort((x, y) => x.k.localeCompare(y.k)).map((x) => x.id);
    expect(sharedOrder(ids, 's')).toEqual(want);
  });
  test('the frozen lists match the prereg hashes and their pools', () => {
    for (const suite of ['gstack', 'gbrain']) {
      const text = readFileSync(join(DIR, 'tasks-' + suite + '.json'));
      const sha = execFileSync('sha256sum', [join(DIR, 'tasks-' + suite + '.json')], { env, encoding: 'utf8' }).split(' ')[0];
      expect(PREREG.suites[suite].tasks.sha256).toBe(sha);
      const f = JSON.parse(text.toString());
      for (const m of Object.values(f.models) as Array<{ tasks: string[]; t1: string[]; digest: string[] }>) {
        expect(m.t1.length).toBe(4);
        expect(m.t1.every((t) => m.tasks.includes(t))).toBe(true);
        expect(m.digest.some((t) => m.tasks.includes(t))).toBe(false);
      }
    }
    const g = JSON.parse(readFileSync(join(DIR, 'tasks-gstack.json'), 'utf8'));
    expect([g.pools.opus.qualified, g.pools.opus.after_cost_cut, g.pools.sol.qualified, g.pools.sol.after_cost_cut]).toEqual([44, 38, 42, 41]);
    expect(g.models.opus.tasks.length).toBe(30);
    const b = JSON.parse(readFileSync(join(DIR, 'tasks-gbrain.json'), 'utf8'));
    expect(b.models.particle.label).toBe('no particle-1 receipts; descriptive only');
    expect(b.models.particle.tasks).toEqual(b.models.sol.tasks);
  });
  test.skipIf(!hasFrontier)('a rebuild from the receipts gives the frozen files', () => {
    const r = spawnSync('bun', [join(ROOT, 'scripts/canary/select-tasks.ts'), '--check'], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('receipts helpers', () => {
  const key = ['sk', 'ant', 'api03'].join('-') + '-' + 'Q'.repeat(30);
  test('prepare strips proxy-capture bodies to a hash manifest and refuses token patterns and stray bodies', () => {
    const src = mkdtempSync(join(tmpdir(), 'canary-src-'));
    mkdirSync(join(src, 'gstack/T1'), { recursive: true });
    writeFileSync(join(src, 'gstack/T1/trials.jsonl'), '{"ok":1}\n');
    writeFileSync(join(src, 'gstack/T1/proxy-requests.ndjson'), '{"seq":0,"prev":"","route":"/v1/messages","body":{"task":"secret task text"}}\n');
    const clean = prepare(src, mkdtempSync(join(tmpdir(), 'canary-dst-')));
    expect(clean.problems).toEqual([]);
    expect(clean.stripped.map((s) => s.path)).toEqual(['gstack/T1/proxy-requests.ndjson']);
    writeFileSync(join(src, 'gstack/T1/run.log'), 'token ' + key + '\n');
    writeFileSync(join(src, 'gstack/T1/copy.ndjson'), '{"seq":0,"prev":"","route":"/v1/messages","body":{}}\n');
    const dirty = prepare(src, mkdtempSync(join(tmpdir(), 'canary-dst-')));
    expect(dirty.problems).toContain('gstack/T1/copy.ndjson: holds captured request bodies outside proxy-requests.ndjson');
    expect(dirty.problems).toContain('gstack/T1/run.log: token pattern anthropic');
    expect(dirty.problems.join(' ')).not.toContain('QQQQ');
  });
  test('state: the last screened release, the last T2, a pending tier and the dead-man clock', () => {
    const at = (d: number) => new Date(Date.UTC(2026, 10, d, 9)).toISOString();
    const lines: HistoryLine[] = [
      { schema: 'canary-history/1', at: at(1), run_id: 'a', product: 'gstack', status: 'OK', tiers: ['T0', 'T2'], prev: { sha: 'p', version: '1' }, new: { sha: 'n', version: '2' }, verdict: 'runs/a/gstack/verdict.json' },
      { schema: 'canary-history/1', at: at(2), run_id: 'b', product: 'gstack', status: 'WATCH', tiers: ['T0', 'T1'], prev: { sha: 'n', version: '2' }, new: { sha: 'm', version: '3' }, pending: 'T2', lease_month: '2026-11' },
      { schema: 'canary-history/1', at: at(3), run_id: 'c', product: 'gstack', status: 'INCOMPLETE', new: { sha: 'z', version: '4' } },
      { schema: 'canary-history/1', at: at(4), run_id: 'd', product: null, status: 'OK' },
    ];
    const s = state(lines, at(6));
    expect(s.products.gstack).toMatchObject({ screened: { sha: 'm', version: '3' }, screened_prev: { sha: 'n', version: '2' }, last_t2_at: at(1), t2_verdict: 'runs/a/gstack/verdict.json', pending: null });
    expect(s.hours_since_last).toBe(48);
    expect(state(lines.slice(0, 2), at(6)).products.gstack).toMatchObject({ pending: 'T2', pending_month: '2026-11' });
    expect(s.products.gbrain.screened).toBeNull();
  });
});

describe('monthly lease', () => {
  const lease = (...a: string[]) => spawnSync('bun', [join(ROOT, 'scripts/canary/lease.ts'), ...a], { env, encoding: 'utf8' });
  test('per-tier leases come out of the month, and T2 keeps the T1 reserve untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-lease-'));
    const ledger = join(dir, 'canary-2026-11.sqlite');
    const run = lease('open', '--ledger', ledger, '--month', '2026-11', '--cap-usd', '1000', '--run-id', 'r1').stdout.trim();
    expect(run).toStartWith('canary-2026-11:r1-');
    const t2 = lease('reserve', '--ledger', ledger, '--budget-run', run, '--usd', '700', '--what', 'T2', '--keep-usd', '200');
    expect(t2.status).toBe(0);
    writeFileSync(join(dir, 't.jsonl'), '{"usage":{"usd":650}}\n');
    expect(JSON.parse(lease('settle', '--ledger', ledger, '--budget-run', run, '--entry', t2.stdout.trim(), '--trials', join(dir, 't.jsonl')).stdout).remaining_usd).toBe(350);
    expect(lease('reserve', '--ledger', ledger, '--budget-run', run, '--usd', '160', '--what', 'T3', '--keep-usd', '200').status).toBe(20);
    expect(lease('reserve', '--ledger', ledger, '--budget-run', run, '--usd', '15', '--what', 'T1', '--keep-usd', '0').status).toBe(0);
    lease('close', '--ledger', ledger, '--budget-run', run);
    const next = lease('open', '--ledger', ledger, '--month', '2026-11', '--cap-usd', '1000', '--run-id', 'r2');
    expect(next.status).toBe(0);
    expect(JSON.parse(lease('status', '--ledger', ledger).stdout)).toEqual({ cap_usd: 1000, committed_usd: 665, remaining_usd: 335 });
  });
  test('a tier that left no trials file stays charged its whole reservation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-lease-'));
    const ledger = join(dir, 'canary-2026-11.sqlite');
    const run = lease('open', '--ledger', ledger, '--month', '2026-11', '--cap-usd', '1000', '--run-id', 'r1').stdout.trim();
    const t2 = lease('reserve', '--ledger', ledger, '--budget-run', run, '--usd', '105', '--what', 'T2', '--keep-usd', '200');
    expect(t2.status).toBe(0);
    expect(JSON.parse(lease('settle', '--ledger', ledger, '--budget-run', run, '--entry', t2.stdout.trim(), '--trials', join(dir, 'missing.jsonl')).stdout).committed_usd).toBe(105);
  });
});
