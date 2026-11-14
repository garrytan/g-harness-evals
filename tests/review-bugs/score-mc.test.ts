import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { seededRandom } from '../../runner/stats/paired.ts';
import { exactSignFlip, holmSteps } from '../../scripts/review-bugs/noloss-stats.ts';
import { bugPairs, decideVerdict, loadArm, loadSuite, RECALL_ONLY_KEEP, scoreCell, type ArmData, type Finding, type Judgment, type Options, type Suite, type Unit } from '../../scripts/review-bugs/score-mc.ts';

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'review-bugs', 'noloss-small');
const expected = await Bun.file(join(FIXTURE, 'noloss-expected.json')).json();
const { suite: fxSuite, sha256: fxSha } = loadSuite(join(FIXTURE, 'suite.json'));
const fxArm = (id: string) => loadArm(join(FIXTURE, 'arms', fxSuite.id, id), fxSuite, fxSha);
const base: Options = { seed: 7, draws: 10000, mc_seed: 1, mc_draws: 10000, mdd_points: 17, kappa: 'pass', exposure: { review: 'pass', 'ship-panel': 'pass' } };
const within3se = (mc: number, exact: number, draws: number) => expect(Math.abs(mc - exact)).toBeLessThanOrEqual(3 * Math.sqrt((exact * (1 - exact)) / draws));

test("fixture: the restated exact test reproduces noloss score's exact p", () => {
  const plain = fxArm('plain');
  const review = fxArm('review');
  const b = exactSignFlip(bugPairs(fxSuite, review, plain, 'blocking'), [2, 2]);
  expect(b.greater).toBeCloseTo(expected.blocking.p_greater, 5);
  expect(b.greater).toBe(24 / 1024);
  expect(b.less).toBeCloseTo(expected.blocking.p_less, 5);
  const a = exactSignFlip(bugPairs(fxSuite, review, plain, 'any_severity'), [2, 2]);
  expect(a.greater).toBe(expected.any_severity.p_greater);
  expect(a.less).toBe(expected.any_severity.p_less);
});

test("fixture: Monte Carlo p within 3 Monte Carlo SEs of noloss's exact p, intervals equal to noloss score's", () => {
  const plain = fxArm('plain');
  const review = fxArm('review');
  for (const mc_seed of [1, 2, 3]) {
    const c = scoreCell(fxSuite, fxSha, plain, [review], { ...base, mc_seed }).comparisons[0]!;
    for (const k of ['blocking', 'any_severity'] as const) {
      const e = expected[k];
      const sf = c[k].sign_flip!;
      within3se(sf.p_greater, e.p_greater, sf.draws);
      within3se(sf.p_less, e.p_less, sf.draws);
      within3se(sf.p_two_sided, Math.min(1, 2 * Math.min(e.p_greater, e.p_less)), sf.draws);
    }
    expect(c.blocking.bugs).toBe(expected.blocking.bugs);
    expect(c.blocking.clusters).toBe(expected.blocking.clusters);
    expect(c.blocking.sign_flip!.informative_clusters).toBe(expected.blocking.discordant_clusters);
    expect(c.blocking.recall).toEqual(expected.blocking.recall);
    expect(c.blocking.delta).toBe(expected.blocking.delta);
    expect(c.blocking.ci95).toEqual(expected.blocking.ci95);
    const g = c.false_alarms_per_decoy;
    expect(g.prs).toBe(expected.false_alarm_gate.decoys);
    expect(g.per_pr).toEqual({ variant: expected.false_alarm_gate.per_decoy.review, reference: expected.false_alarm_gate.per_decoy.plain });
    expect(g.difference).toBe(expected.false_alarm_gate.excess);
    expect(g.ci95).toEqual(expected.false_alarm_gate.ci95);
    expect(c.verdict.label).toBe('FIX-METHOD');
  }
});

test('fixture: an arm read against the wrong suite or suite digest is refused', () => {
  expect(() => loadArm(join(FIXTURE, 'arms', fxSuite.id, 'review'), { ...fxSuite, id: 'other' }, fxSha)).toThrow(/names suite/);
  expect(() => loadArm(join(FIXTURE, 'arms', fxSuite.id, 'review'), fxSuite, 'f'.repeat(64))).toThrow(/suite digest/);
});

interface SynthArm { rate: number; dRate?: number; decoyFalse?: number; bugFalse?: number; unadjudicatedDecoy?: boolean }

/** A synthetic cell: bug PRs (every fourth with 2 bugs, so 1.25 per PR) and decoys, outcomes drawn per bug and pass. */
function synth(o: { prs: number; decoys: number; passes: number; seed: number; plain: SynthArm; arms: Record<string, SynthArm> }): { suite: Suite; plain: ArmData; arms: ArmData[] } {
  const units: Unit[] = [];
  for (let i = 0; i < o.prs + o.decoys; i++) {
    const pr = 1000 + i;
    const decoy = i >= o.prs;
    const head = pr.toString(16).padStart(40, '0');
    units.push({ id: 'synthetic/repo#' + pr + '@' + head.slice(0, 12), repo: 'synthetic/repo', pr, head, cluster: 'synthetic/repo#' + pr, group: decoy ? 'decoy' : 'bug', blockers: decoy ? [{ id: 'B1', counts: 'over-blocking' }] : i % 4 === 0 ? [{ id: 'B1', counts: 'blocking' }, { id: 'B2', counts: 'blocking' }] : [{ id: 'B1', counts: 'blocking' }] });
  }
  const suite: Suite = { id: 'synthetic', kind: 'noloss', units };
  const rng = seededRandom(o.seed);
  const build = (id: string, s: SynthArm): ArmData => {
    const findings = new Map<string, Finding[]>();
    const judgments: Judgment[] = [];
    const adjudications: ArmData['adjudications'] = [];
    for (const u of units) {
      const list: Finding[] = [];
      const decoy = u.blockers[0]!.counts === 'over-blocking';
      for (let pass = 1; pass <= o.passes; pass++) {
        for (const b of u.blockers) {
          const x = rng();
          const outcome = decoy ? 'M' : x < s.rate ? 'F' : x < s.rate + (s.dRate ?? 0) ? 'D' : 'M';
          const key = u.id + '\0' + pass + '\0' + b.id;
          if (outcome !== 'M') list.push({ key, mapped: outcome === 'F' ? 'CRITICAL' : 'INFORMATIONAL' });
          judgments.push({ unit: u.id, blocker: b.id, pass, outcome, matched: outcome === 'M' ? [] : [key], saw_label: false, coverage: 'complete' });
        }
        const extra = decoy ? (s.decoyFalse ?? 0) : (s.bugFalse ?? 0);
        for (let k = 0; k < extra; k++) {
          const key = u.id + '\0' + pass + '\0x' + k;
          list.push({ key, mapped: 'CRITICAL' });
          if (!(decoy && s.unadjudicatedDecoy)) adjudications.push({ finding: key, ruling: 'not-defect', saw_label: false });
        }
      }
      findings.set(u.id, list);
    }
    return { id, passes: o.passes, status: 'complete', tree_sha256: null, findings, judgments, adjudications };
  };
  return { suite, plain: build('plain', o.plain), arms: Object.entries(o.arms).map(([id, s]) => build(id, s)) };
}

const run = (s: ReturnType<typeof synth>, o: Partial<Options> = {}) => scoreCell(s.suite, 'synthetic', s.plain, s.arms, { ...base, ...o });

test('synthetic: a strong true effect gives KEEP', () => {
  const c = run(synth({ prs: 120, decoys: 15, passes: 2, seed: 11, plain: { rate: 0.2 }, arms: { review: { rate: 0.6 } } })).comparisons[0]!;
  expect(c.blocking.ci95![0]).toBeGreaterThan(0);
  expect(c.any_severity.ci95![0]).toBeGreaterThan(0);
  expect(c.false_alarms_per_decoy.within_limit).toBe(true);
  expect(c.false_blockers_per_bug_pr.within_limit).toBe(true);
  expect(c.verdict.label).toBe('KEEP');
});

test('synthetic: a strong negative effect gives LOSS', () => {
  const c = run(synth({ prs: 120, decoys: 15, passes: 2, seed: 12, plain: { rate: 0.6 }, arms: { review: { rate: 0.2 } } })).comparisons[0]!;
  expect(c.blocking.ci95![1]).toBeLessThan(0);
  expect(c.verdict.label).toBe('LOSS');
});

test('synthetic: a null with a narrow interval under the MDD gives CUT-CANDIDATE', () => {
  const c = run(synth({ prs: 150, decoys: 15, passes: 2, seed: 13, plain: { rate: 0.3 }, arms: { review: { rate: 0.3 } } })).comparisons[0]!;
  expect(c.blocking.ci95![0]).toBeLessThan(0);
  expect(c.blocking.ci95![1] * 100).toBeLessThan(17);
  expect(c.verdict.label).toBe('CUT-CANDIDATE');
  expect(c.verdict.rule).toContain('Why null?');
});

test('synthetic: a wide null gives INCONCLUSIVE', () => {
  const c = run(synth({ prs: 12, decoys: 3, passes: 2, seed: 15, plain: { rate: 0.3 }, arms: { review: { rate: 0.3 } } })).comparisons[0]!;
  expect(c.blocking.ci95![0]).toBeLessThan(0);
  expect(c.blocking.ci95![1] * 100).toBeGreaterThanOrEqual(17);
  expect(c.verdict.label).toBe('INCONCLUSIVE');
});

test('synthetic: an effect with false alarms over +0.5 per PR gives FIX-METHOD', () => {
  const c = run(synth({ prs: 120, decoys: 15, passes: 2, seed: 15, plain: { rate: 0.2 }, arms: { review: { rate: 0.6, decoyFalse: 1 } } })).comparisons[0]!;
  expect(c.blocking.ci95![0]).toBeGreaterThan(0);
  expect(c.false_alarms_per_decoy.difference).toBe(1);
  expect(c.false_alarms_per_decoy.within_limit).toBe(false);
  expect(c.verdict.label).toBe('FIX-METHOD');
});

test('synthetic: a failed exposure gate gives FIX-METHOD whatever the recall', () => {
  const s = synth({ prs: 120, decoys: 15, passes: 2, seed: 11, plain: { rate: 0.2 }, arms: { review: { rate: 0.6 } } });
  const c = run(s, { exposure: { review: 'fail' } }).comparisons[0]!;
  expect(c.blocking.ci95![0]).toBeGreaterThan(0);
  expect(c.verdict.label).toBe('FIX-METHOD');
  expect(c.verdict.rule).toContain('exposure gate failed');
});

test('synthetic: the kappa flag decides whether false blockers on bug PRs guard the verdict', () => {
  const s = synth({ prs: 120, decoys: 15, passes: 2, seed: 16, plain: { rate: 0.2 }, arms: { review: { rate: 0.6, bugFalse: 1 } } });
  const pass = run(s).comparisons[0]!;
  expect(pass.false_blockers_per_bug_pr.within_limit).toBe(false);
  expect(pass.verdict.label).toBe('FIX-METHOD');
  const failed = run(s, { kappa: 'fail' }).comparisons[0]!;
  expect(failed.false_blockers_per_bug_pr.role).toBe('descriptive');
  expect(failed.verdict.label).toBe(RECALL_ONLY_KEEP);
});

test('synthetic: an unadjudicated finding on a decoy leaves a recall gain INCONCLUSIVE', () => {
  const c = run(synth({ prs: 120, decoys: 15, passes: 2, seed: 11, plain: { rate: 0.2 }, arms: { review: { rate: 0.6, decoyFalse: 1, unadjudicatedDecoy: true } } })).comparisons[0]!;
  expect(c.false_alarms_per_decoy.within_limit).toBeNull();
  expect(c.verdict.label).toBe('INCONCLUSIVE');
});

test('verdict rules at their edges', () => {
  const g = [{ scope: 'decoys' as const, ci95: [0, 0.2] as [number, number], within_limit: true, reasons: [] }];
  const v = (blocking: [number, number], any_severity: [number, number], extra: Partial<Parameters<typeof decideVerdict>[0]> = {}) => decideVerdict({ blocking, any_severity, exposure: 'pass', mdd_points: 17, kappa: 'pass', guards: g, no_verdict: null, ...extra }).label;
  expect(v([0.01, 0.3], [0.02, 0.3])).toBe('KEEP');
  expect(v([0.01, 0.3], [-0.05, 0.2])).toBe('KEEP');
  expect(v([-0.05, 0.3], [0.01, 0.3])).toBe('INCONCLUSIVE');
  expect(v([-0.05, 0.16], [0.01, 0.3])).toBe('CUT-CANDIDATE');
  expect(v([-0.05, 0.17], [0.01, 0.3])).toBe('INCONCLUSIVE');
  expect(v([0.01, 0.3], [-0.3, -0.01])).toBe('LOSS');
  expect(v([-0.3, -0.01], [0.01, 0.3])).toBe('LOSS');
  expect(v([-0.3, -0.01], [0.01, 0.3], { exposure: 'fail' })).toBe('FIX-METHOD');
  expect(v([0.01, 0.3], [0.02, 0.3], { guards: [{ ...g[0]!, ci95: [0.1, 0.51], within_limit: false }] })).toBe('FIX-METHOD');
  expect(v([0.01, 0.3], [0.02, 0.3], { kappa: 'fail' })).toBe(RECALL_ONLY_KEEP);
  expect(v([0.01, 0.3], [0.02, 0.3], { no_verdict: 'arm review stopped' })).toBe('NO VERDICT');
});

test('Holm step-down over the two co-primaries within each comparison', () => {
  expect(holmSteps([0.01, 0.04])).toEqual({ adjusted: [0.02, 0.04], step: [1, 2] });
  expect(holmSteps([0.04, 0.01])).toEqual({ adjusted: [0.04, 0.02], step: [2, 1] });
  expect(holmSteps([0.03, 0.02]).adjusted).toEqual([0.04, 0.04]);
  expect(holmSteps([0.6, 0.7]).adjusted).toEqual([1, 1]);
  const s = synth({ prs: 120, decoys: 15, passes: 2, seed: 17, plain: { rate: 0.2 }, arms: { review: { rate: 0.6 }, 'ship-panel': { rate: 0.3 } } });
  const rec = run(s);
  expect(rec.holm!.family).toEqual(['blocking', 'any_severity']);
  for (const c of rec.comparisons) {
    const adj = holmSteps([c.blocking.sign_flip!.p_two_sided, c.any_severity.sign_flip!.p_two_sided]).adjusted.map((p) => Math.round(p * 1e6) / 1e6);
    expect([c.blocking.p_holm, c.any_severity.p_holm]).toEqual(adj);
  }
  expect(rec.comparisons[0]!.verdict.label).toBe('KEEP');
  expect(rec.comparisons[0]!.keep_holds_after_holm).toBe(true);
  expect(rec.comparisons[0]!.unadjusted_verdict).toBeNull();
  expect(run({ ...s, arms: [s.arms[0]!] }).comparisons[0]!.blocking.p_holm).toBe(rec.comparisons[0]!.blocking.p_holm);
});

test('a single-arm KEEP whose Holm-adjusted blocking p is above 0.05 is reported as INCONCLUSIVE, with the KEEP beside it', () => {
  const c = run(synth({ prs: 40, decoys: 10, passes: 2, seed: 8, plain: { rate: 0.2 }, arms: { review: { rate: 0.3 } } })).comparisons[0]!;
  expect(c.blocking.ci95![0]).toBeGreaterThan(0);
  expect(c.blocking.sign_flip!.p_two_sided).toBeLessThan(0.05);
  expect(c.blocking.p_holm!).toBeGreaterThan(0.05);
  expect(c.keep_holds_after_holm).toBe(false);
  expect(c.verdict.label).toBe('INCONCLUSIVE');
  expect(c.unadjusted_verdict!.label).toBe('KEEP');
});

test('deterministic for a given seed, and the seeds are recorded', () => {
  const s = synth({ prs: 40, decoys: 5, passes: 2, seed: 18, plain: { rate: 0.3 }, arms: { review: { rate: 0.45 } } });
  const a = run(s, { seed: 5, mc_seed: 9, mc_draws: 4000 });
  expect(JSON.stringify(run(s, { seed: 5, mc_seed: 9, mc_draws: 4000 }))).toBe(JSON.stringify(a));
  expect(a.inputs).toMatchObject({ seed: 5, draws: 10000, mc_seed: 9, mc_draws: 4000 });
  expect(a.comparisons[0]!.blocking.sign_flip).toMatchObject({ seed: 9, draws: 4000 });
  const b = run(s, { seed: 6, mc_seed: 10, mc_draws: 4000 });
  expect(b.comparisons[0]!.blocking.sign_flip!.p_two_sided).not.toBe(a.comparisons[0]!.blocking.sign_flip!.p_two_sided);
  expect(b.comparisons[0]!.blocking.ci95).not.toEqual(a.comparisons[0]!.blocking.ci95);
});

test('the command line prints the same summary and record twice', () => {
  const args = ['scripts/review-bugs/score-mc.ts', '--suite', join(FIXTURE, 'suite.json'), '--root', join(FIXTURE, 'arms'), '--reference', 'plain', '--variant', 'review', '--exposure', 'review=pass', '--mdd', '17', '--kappa', 'pass', '--seed', '7', '--mc-seed', '3', '--cell', 'fixture'];
  const go = (extra: string[]) => Bun.spawnSync(['bun', ...args, ...extra], { cwd: join(import.meta.dir, '..', '..'), env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  const one = go([]);
  expect(one.exitCode).toBe(0);
  expect(one.stdout.toString()).toBe(go([]).stdout.toString());
  expect(one.stdout.toString()).toContain('verdict: FIX-METHOD');
  const rec = JSON.parse(go(['--json']).stdout.toString());
  expect(rec.inputs).toMatchObject({ seed: 7, draws: 10000, mc_seed: 3, mc_draws: 10000, mdd_points: 17, kappa: 'pass', limit_per_pr: 0.5 });
  const bad = go(['--exposure', 'nope']);
  expect(bad.exitCode).toBe(2);
  expect(bad.stderr.toString()).toContain('--exposure takes');
});
