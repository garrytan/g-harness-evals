// The MCP-at-scale analysis (internal-task): power, the analysis and its decision rules, the R113 interim look and the R111
// pilot gates, on synthetic outcomes whose answers are known. Keyless; spawned scripts run under env -i with an allowlist.
import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, cell, context, decision1, decision4, DESCRIPTIVE_NOTE, FIX_METHOD_CEILING, rungContrast } from '../scripts/mcp-at-scale/analysis/analyze.ts';
import { dryGate, gate, surfaceRan, type Arm, type ArmsFile } from '../scripts/mcp-at-scale/analysis/pilot-gates.ts';
import { conditionalPower, decide, interimUnits, look, obfBounds, STOPPED_NOTE, type Design } from '../scripts/mcp-at-scale/analysis/interim.ts';
import { COMPARISONS, gbrainMargin, gbrainNiPower, pilotEstimates, sdd, table } from '../scripts/mcp-at-scale/analysis/power.ts';
import { contrastOf, loadTrials, normalCdf, paired, requestIndex, setupItemRep, VALUES, type Trial } from '../scripts/mcp-at-scale/analysis/stats.ts';
import { syntheticRun } from '../scripts/mcp-at-scale/analysis/synthetic.ts';
import { itemSha, loadLadder, twinsOf, type Item } from '../scripts/mcp-at-scale/requests/sets.ts';
import { SYNTHETIC_SURFACES } from '../scripts/mcp-at-scale/requests/synthetic.ts';
import { effort, trialEffort } from '../scripts/mcp-at-scale/search-effort.ts';

const ROOT = join(import.meta.dir, '..');
const CATALOG = join(ROOT, 'tasks', 'mcp-at-scale', 'catalog');
const A = join(ROOT, 'scripts', 'mcp-at-scale', 'analysis');
const run = (args: string[], cwd = ROOT) => {
  const p = Bun.spawnSync(['env', '-i', 'PATH=' + (process.env.PATH ?? '/usr/bin:/bin'), 'HOME=' + tmpdir(), process.execPath, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

const ladder = loadLadder(), twins = twinsOf();
let main: ReturnType<typeof syntheticRun>, pilot: ReturnType<typeof syntheticRun>, items: Item[], result: ReturnType<typeof analyze>;
beforeAll(() => {
  main = syntheticRun(ladder, twins);
  pilot = syntheticRun(ladder, twins, { pilot: true });
  items = [...main.sets.R, ...main.sets.T, ...main.sets.G];
  result = analyze({ trials: main.trials, items, places: null, margin: null });
});

describe('power', () => {
  test('2.80 x sqrt(d x deff / n) gives the plan\'s figures', () => {
    expect(sdd(0.2, 1.5, 240)).toBeCloseTo(0.099, 3);
    expect(sdd(0.2, 2.5, 240)).toBeCloseTo(0.128, 3);
    const rows = table();
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect([row('right_tool_per_setup_rung').sdd_points_deff_1_5, row('right_tool_per_setup_rung').sdd_points_deff_2_5]).toEqual([9.9, 12.8]);
    expect([row('right_tool_per_two_model_harness').sdd_points_deff_1_5, row('right_tool_per_two_model_harness').sdd_points_deff_2_5]).toEqual([7, 9]);
    expect([row('right_tool_pooled_10_setups').sdd_points_deff_1_5, row('right_tool_pooled_10_setups').sdd_points_deff_2_5]).toEqual([3.1, 4]);
    expect(row('mechanism_per_arm_rung').plan_matches).toBe(true);
    expect(row('gbrain_surface_half_pooled').plan_matches).toBe(true);
    expect(row('gbrain_surface_half_pooled').pairs).toBe(600);
    expect(row('gbrain_surface_both_halves_pooled').pairs).toBe(1200);
    expect(row('gbrain_surface_half_per_harness').pairs).toBe(120);
    expect(rows).toHaveLength(COMPARISONS.length);
    expect(gbrainMargin()).toBeCloseTo(0.0626, 3);
    const [at1, at15] = gbrainNiPower(0.52);
    expect(at1!.margin_for_80_power).toBeCloseTo(0.0824, 3);
    expect(at15!.margin_for_80_power).toBeCloseTo(0.1010, 3);
    expect(at1!.power_at_10_points).toBeCloseTo(0.925, 2);
    expect(at15!.power_at_10_points).toBeCloseTo(0.792, 2);
  });
  test('pilot mode re-estimates d and the design effect from pilot pairs', () => {
    const est = pilotEstimates(pilot.trials, [...pilot.sets.R, ...pilot.sets.T, ...pilot.sets.G]);
    const rt = est.right_tool as { d: number; deff: number };
    expect(rt.d).toBeGreaterThan(0);
    expect(rt.deff).toBeGreaterThanOrEqual(1);
    expect('note' in est.tool_when_none!).toBe(true);
    const rows = table({ right_tool: { ...rt, source: 'pilot' } });
    expect(rows.find((r) => r.id === 'right_tool_per_setup_rung')!.pilot!.d).toBeCloseTo(rt.d, 3);
  });
});

describe('analysis and decisions', () => {
  test('repeated trials pair by repetition, unpaired repetitions are counted, and a duplicate key stops the analysis', () => {
    const t = (rung: number, rep: number, right: boolean) => ({ trial_id: 'x/' + rung + '/' + rep, set: 'R', harness: 'h', model: 'm', arm: 'native', rung, request: 'r1', rep,
      outcomes: { kind: 'tool', infra: null, right_tool: right, wrong_tools: [], calls: [] } } as unknown as Trial);
    const c = context([t(30, 1, true), t(300, 1, true), t(30, 2, true), t(300, 2, false), t(30, 3, true)], []);
    expect(rungContrast(c, 'h', 300)).toMatchObject({ n_pairs: 2, delta: -0.5, unpaired: 1 });
    expect(() => rungContrast(context([t(30, 1, true), t(300, 1, true), { ...t(300, 1, false), trial_id: 'again' }], []), 'h', 300)).toThrow('HE-MCP-031');
  });
  test('outcomes the runner never measures are reported as not measured, not as zero', () => {
    const hermes = Object.entries(result.cells).find(([k]) => k.startsWith('hermes:') && k.endsWith(' native'))![1] as Record<string, ReturnType<typeof cell>>;
    expect(hermes[30]).toMatchObject({ cache_broken_after_load: null, builtin_substitution: null });
    expect(hermes[30]!.not_measured).toContain('the runner does not record them');
  });
  test('INFRA trials are counted and never scored', () => {
    expect(result.counts.infra).toBeGreaterThan(0);
    expect(result.counts.scored + result.counts.infra).toBe(main.trials.length);
    const h = result.decision2_3.find((x) => x.harness === 'hermes')!;
    expect(h.sequence[0]!.contrast.infra_excluded).toBeGreaterThan(0);
    expect(h.sequence[0]!.contrast.n_pairs + h.sequence[0]!.contrast.infra_excluded).toBe(240);
  });
  test('decision 2: slip point tested 300, then 150, then 75; holding needs the lower limit above minus 7', () => {
    const cc = result.decision2_3.find((x) => x.harness === 'claude-code')!;
    const he = result.decision2_3.find((x) => x.harness === 'hermes')!;
    expect(cc.slip_point).toBeNull();
    expect(cc.sequence.map((s) => s.rung)).toEqual([300]);
    expect(cc.holds_through_300).toBe(true);
    expect(cc.named).toBe(true);
    expect(he.sequence.map((s) => [s.rung, s.slips])).toEqual([[300, true], [150, true], [75, false]]);
    expect(he.slip_point).toBe(150);
    expect(he.holds_through_300).toBe(false);
    expect(he.result).toBe('slips at 150');
    expect(he.named).toBe(false);
    expect(he.vs_opus_mean![300]!.ci95![1]).toBeLessThan(0);
  });
  test('decision 3: accuracy advice at the smallest slipping rung with a 10-point drop, else cost, else none', () => {
    expect(result.decision2_3.find((x) => x.harness === 'hermes')!.prune_advice).toEqual({ kind: 'accuracy', text: 'keep below 150 tools' });
    expect(result.decision2_3.find((x) => x.harness === 'claude-code')!.prune_advice.kind).toBe('none');
  });
  test('set T success is paired per setup and task, 300 against 30', () => {
    expect(result.set_t.pooled_300_vs_30.n_pairs).toBe(80);
    expect(result.set_t.pooled_300_vs_30.delta!).toBeLessThan(0);
  });
  test('decision 4: search non-inferior and cheaper than send-everything on these trials', () => {
    const m = result.decision4[0]!;
    expect(m.harness).toBe('claude-code');
    expect(m.search_costs_accuracy_from).toBeNull();
    expect(m.rungs.every((r) => r.search_non_inferior && r.search_cheaper)).toBe(true);
  });
  test('decision 1: verbs passes both halves and the other requests, while starter is measured on both halves', () => {
    const d = result.decision1!;
    expect(d.margin_provisional).toBe(true);
    expect(d.decision.pick).toBe('verbs');
    const starter = d.surfaces.find((s) => s.surface === 'starter')!;
    expect(starter.halves.find((h) => h.half === 'full_only')!.contrast!.n_pairs).toBe(120);
    expect(d.surfaces.find((s) => s.surface === 'registered')!.pass).toBe(false);
    expect(d.request_tools.verdict).toBe('no FIX-METHOD');
  });
  test('pairing uses rep even when trial arrival order differs, without adding clusters', () => {
    const row = main.trials.find((t) => t.arm === 'gbrain-full' && t.set === 'G' && t.outcomes)!;
    const t = (rep: number | undefined, right_tool: boolean): Trial => ({ ...row, rep, outcomes: { ...row.outcomes!, right_tool } });
    const a = [t(undefined, true), t(2, false)], b = [t(2, false), t(1, true)];
    const req = requestIndex(items);
    const c = paired(a, b, VALUES.right_tool, setupItemRep, (x) => req.cluster(x.request));
    expect([c.n_pairs, c.n_clusters, c.discordant]).toEqual([2, 1, 0]);
    expect(paired(a, [b[0]!], VALUES.right_tool, setupItemRep, (x) => req.cluster(x.request)).unpaired).toBe(1);
    const replicated = main.trials.flatMap((t) => t.set === 'G' ? [t, { ...t, rep: 2, trial_id: t.trial_id + '/rep2' }] : [t]);
    const original = result.decision1!.surfaces.find((s) => s.surface === 'verbs')!.halves[0]!.contrast!;
    const result2 = analyze({ trials: replicated, items, places: null, margin: 0.1 }).decision1!;
    const repeated = result2.surfaces.find((s) => s.surface === 'verbs')!.halves[0]!.contrast!;
    expect([repeated.n_pairs, repeated.n_clusters]).toEqual([original.n_pairs * 2, original.n_clusters]);
  });
  test('decision 1: request_tools gets FIX-METHOD when verbs\' full-only half sits below 70%', () => {
    const fullOnly = new Set(main.sets.G.filter((g) => g.half_kind === 'full_only').map((g) => g.id));
    const trials: Trial[] = main.trials.map((t) => (t.arm === 'gbrain-verbs' && fullOnly.has(t.request) && t.outcomes ? { ...t, outcomes: { ...t.outcomes, right_tool: (Number(t.trial_id.slice(1)) % 3) === 0, reward: 0 } } : t));
    const d = analyze({ trials, items, places: null, margin: 0.08 }).decision1!;
    expect(d.margin_provisional).toBe(false);
    expect(d.request_tools.verdict).toBe('FIX-METHOD');
    expect(d.request_tools.pooled!.ci95![1]).toBeLessThan(FIX_METHOD_CEILING);
    expect(d.decision.pick).not.toBe('verbs');
  });
  test('decision 1: starter passing while verbs fails keeps starter as the setup default', () => {
    const full = new Map(main.trials.filter((t) => t.arm === 'gbrain-full' && t.set === 'G' && t.outcomes).map((t) => [setupItemRep(t), t.outcomes!]));
    const trials: Trial[] = main.trials.map((t) => (t.set !== 'G' || !t.outcomes ? t
      : t.arm === 'gbrain-verbs' ? { ...t, outcomes: { ...t.outcomes, right_tool: false, reward: 0 } }
      : t.arm === 'gbrain-starter' && full.has(setupItemRep(t)) ? { ...t, outcomes: { ...t.outcomes, right_tool: full.get(setupItemRep(t))!.right_tool, reward: full.get(setupItemRep(t))!.reward } } : t));
    const d = analyze({ trials, items, places: null, margin: 0.1 }).decision1!;
    expect(d.surfaces.find((s) => s.surface === 'verbs')!.pass).toBe(false);
    expect(d.surfaces.find((s) => s.surface === 'starter')!.pass).toBe(true);
    expect(d.decision).toMatchObject({ pick: 'starter', text: expect.stringContaining('starter stays the setup default') });
  });
});

describe('interim look (R113)', () => {
  test('O\'Brien-Fleming two-look bounds at a two-sided 0.05 are about 2.80 and 1.98', () => {
    const b = obfBounds(0.05, 2);
    expect(b.interim).toBeCloseTo(2.797, 2);
    expect(b.final).toBeCloseTo(1.977, 2);
    const one = obfBounds(0.025, 1);
    expect(one.interim).toBeCloseTo(b.interim, 6);
    const holm = obfBounds(0.025, 2);
    expect(holm.interim).toBeGreaterThan(b.interim);
    expect(holm.final).toBeGreaterThan(b.final);
  });
  test('the normal CDF is accurate', () => {
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 9);
    expect(normalCdf(-3)).toBeCloseTo(0.0013498980316, 11);
  });
  test('decisions: a crossed bound says stopped early, low conditional power stops for futility', () => {
    const design = { fraction: 0.5, futility_conditional_power: 0.1, seed: 's', comparisons: [] } as Design;
    const cmp = { id: 'x', kind: 'slip' as const, alpha: 0.05, sides: 2 as const, direction: 'lower' as const, planned_effect: 0.07 };
    const mk = (delta: number, se: number) => ({ ...contrastOf([{ id: 'a', cluster: 'a', a: 0, b: 1 }, { id: 'b', cluster: 'b', a: 1, b: 0 }]), delta, se_cluster: se });
    const stop = decide(mk(-0.2, 0.05), cmp, 0, design);
    expect(stop.decision).toBe('stop_efficacy');
    expect(stop.note).toBe(STOPPED_NOTE);
    expect(decide(mk(0.15, 0.05), cmp, 0, design).note).toBe(STOPPED_NOTE);
    const fut = decide(mk(0.05, 0.03), cmp, 0, design);
    expect(fut.decision).toBe('stop_futility');
    expect(fut.conditional_power!).toBeLessThan(0.1);
    expect(decide(mk(-0.05, 0.03), cmp, 0, design).decision).toBe('continue');
    expect(conditionalPower(0, 0, 1.977)).toBeLessThan(0.01);
  });
  test('the look reads only the first half of the units', () => {
    const design = JSON.parse(readFileSync(join(A, 'interim-design.json'), 'utf8')) as Design;
    expect(design.comparisons.filter((c) => c.kind === 'gbrain_ni').map((c) => c.id)).toEqual([
      'gbrain:starter:starter', 'gbrain:starter:full_only', 'gbrain:verbs:starter', 'gbrain:verbs:full_only',
    ]);
    const units = interimUnits(items, design.seed);
    expect([...units].filter((u) => !u.includes('/') || u.startsWith('gbrain/')).length).toBeGreaterThan(0);
    const r = look({ trials: main.trials, items, design });
    expect(r.trials_outside_units).toBeGreaterThan(0);
    expect(r.results.find((x) => x.id === 'slip:hermes')!.decision).toBe('stop_efficacy');
    expect(r.results.find((x) => x.id === 'slip:codex')!.decision).toBe('no data at the look');
  });
  test('a fixed-look pass below 1.977 remains inconclusive at the final look', () => {
    const row = main.trials.find((t) => t.harness === 'hermes' && t.set === 'R' && t.outcomes?.kind === 'tool')!;
    const trials = Array.from({ length: 58 }, (_, i) => [30, 300].map((rung) => ({
      ...row, rung, request: 'r' + String(i).padStart(3, '0'), trial_id: rung + ':' + i,
      outcomes: { ...row.outcomes!, infra: null, right_tool: rung === 30 ? i < 22 : i >= 22 && i < 33 },
    }))).flat();
    const input = { trials, items: [], interimDecisions: { 'slip:hermes': 'continue' as const } };
    const [harness] = analyze(input).decision2_3;
    const [step] = harness!.sequence;
    expect(step!.contrast.ci95![1]).toBeLessThan(0);
    const z = -step!.contrast.delta! / step!.contrast.se_cluster!;
    expect(z).toBeGreaterThan(1.96);
    expect(z).toBeLessThan(1.977);
    expect(step!.slips).toBe(false);
    expect(step!.final_look).toMatchObject({ interim_decision: 'continue', boundary: 1.977, boundary_crossed: false });
    expect(harness!.result).toBe('not shown');
    const stronger = trials.map((t) => t.trial_id === '300:32' ? { ...t, outcomes: { ...t.outcomes, right_tool: false } } : t);
    expect(analyze({ ...input, trials: stronger }).decision2_3[0]!.sequence[0]).toMatchObject({ slips: true, final_look: { boundary_crossed: true } });
  });
  test('stopped mechanism and gbrain comparisons get no final recommendation', () => {
    const c = context(main.trials, items, {
      'mechanism:claude-code': 'stop_opposite',
      'gbrain:verbs:full_only': 'stop_futility',
    });
    const m = decision4(c)[0]!.rungs.find((r) => r.rung === 300)!;
    expect(m).toMatchObject({ search_non_inferior: null, send_everything_beats_search: null, final_look: { interim_decision: 'stop_opposite', z: null, note: STOPPED_NOTE, label: DESCRIPTIVE_NOTE } });
    expect(m.send_everything_minus_search.n_pairs).toBeGreaterThan(0);
    const g = decision1(c, gbrainMargin(), false)!;
    const verbs = g.surfaces.find((s) => s.surface === 'verbs')!;
    expect(verbs.pass).toBeNull();
    expect(verbs.halves.find((h) => h.half === 'full_only')).toMatchObject({ pass: null, final_look: { interim_decision: 'stop_futility', z: null, label: DESCRIPTIVE_NOTE } });
    expect(verbs.halves.find((h) => h.half === 'full_only')!.contrast!.n_pairs).toBeGreaterThan(0);
    expect(g.decision.pick).toBeNull();
    expect(g.request_tools.verdict).toContain('no final decision');
  });
});

describe('pilot gates (R111)', () => {
  const arms = (): ArmsFile => {
    const f = JSON.parse(readFileSync(join(A, 'arms.json'), 'utf8')) as ArmsFile;
    return { ...f, arms: f.arms.filter((a) => ['native:claude-code', 'native:hermes', 'mechanism:claude-code-tool-search-off', 'gbrain:full', 'gbrain:starter', 'gbrain:verbs', 'gbrain:registered'].includes(a.id)) };
  };
  const sets = () => ({ R: main.sets.R, T: main.sets.T, G: main.sets.G });
  const audit = () => ({ items: Object.fromEntries(items.map((i) => [i.id, 'passed'])),
    audited_item_sha256: Object.fromEntries(items.map((i) => [i.id, itemSha(i)])) });
  test('every arm passes on the synthetic pilot, and the judge check is not applicable', () => {
    const r = gate({ arms: arms(), pilot: pilot.trials, sets: sets(), audit: audit(), catalogDir: CATALOG, surfaces: SYNTHETIC_SURFACES });
    expect(r.map((x) => [x.arm, x.pass])).toEqual(arms().arms.map((a) => [a.id, true]));
    expect(r[0]!.checks.b_judge.reasons[0]).toContain('not applicable');
  });
  test('a model or version mismatch cannot prove an arm ran, but its spend remains counted', () => {
    const allInfra = pilot.trials.map((t) => ({ ...t, outcomes: { ...t.outcomes!, infra: { code: 'HE-MCP-047', detail: 'version mismatch' } } }));
    const r = gate({ arms: arms(), pilot: allInfra, sets: sets(), audit: audit(), catalogDir: CATALOG, surfaces: SYNTHETIC_SURFACES });
    expect(r.every((arm) => !arm.checks.a_part_under_test_ran.pass && arm.spent_usd > 0)).toBe(true);
  });
  test('a changed request cannot reuse the audit status of the original item', () => {
    const changed = sets();
    changed.R = changed.R.map((item, i) => i === 0 ? { ...item, text: item.text + ' Use the details above.' } : item);
    const r = gate({ arms: arms(), pilot: pilot.trials, sets: changed, audit: audit(), catalogDir: CATALOG, surfaces: SYNTHETIC_SURFACES });
    expect(r[0]!.checks.c_tasks_supplied.reasons.join(' ')).toContain('does not match its audited request');
  });
  test('an arm fails on spend over a tenth, a search in a send-everything arm, an unaudited item and a missing surface file', () => {
    const a = arms();
    a.arms[0]!.planned_usd = 10;
    const searched = pilot.trials.map((t) => (t.arm === 'tool-search-off' ? { ...t, effort: { ...t.effort!, search_calls: 1, search_calls_before_right: 1 } } : t));
    const au = audit();
    au.items[main.sets.T[0]!.id] = 'pending';
    const r = gate({ arms: a, pilot: searched, sets: sets(), audit: au, catalogDir: CATALOG, surfaces: null });
    const by = Object.fromEntries(r.map((x) => [x.arm, x]));
    expect(by['native:claude-code']!.checks.spend.pass).toBe(false);
    expect(by['native:claude-code']!.checks.c_tasks_supplied.reasons.join(' ')).toContain('not passed the ambiguity audit');
    expect(by['mechanism:claude-code-tool-search-off']!.checks.a_part_under_test_ran.pass).toBe(false);
    expect(by['gbrain:verbs']!.checks.a_part_under_test_ran.reasons[0]).toContain('--gbrain-surfaces');
    expect(by['native:hermes']!.checks.c_tasks_supplied.pass).toBe(false);
    expect(by['native:hermes']!.checks.a_part_under_test_ran.pass && by['native:hermes']!.checks.spend.pass).toBe(true);
    expect(by['gbrain:full']!.checks.c_tasks_supplied.pass).toBe(true);
  });
  test('search and send-everything require parsed evidence, and search after a right call still counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-no-transcript-'));
    const target = { server: 'github', tool: 'list_issues' };
    const missing = trialEffort(dir, target);
    expect(missing.source).toBeNull();
    const zero = effort([[{ name: 'mcp__github__list_issues', args: {} }]], target, 'trajectory');
    const searched = effort([[{ name: 'mcp__github__list_issues', args: {} }, { name: 'ToolSearch', args: {} }]], target, 'trajectory');
    expect(searched.search_calls_before_right).toBe(0);
    const row = pilot.trials.find((t) => t.outcomes?.calls.some((c) => c.server !== 'gbrain') && !t.outcomes.infra)!;
    const gate = (surface: string, e: typeof missing) => surfaceRan({
      id: surface, match: { arm: row.arm }, surface, sets: ['R'], rungs: [row.rung], planned_usd: 10,
    }, [{ ...row, effort: e }], null);
    expect(gate('send_everything', missing).pass).toBe(false);
    expect(gate('send_everything', effort([], target, 'trajectory')).pass).toBe(false);
    expect(gate('send_everything', zero).pass).toBe(true);
    expect(gate('send_everything', searched).pass).toBe(false);
    for (const surface of ['search', 'qm_connectors']) {
      expect(gate(surface, { ...missing, turns: 1, search_calls: 1, search_calls_before_right: 1 }).pass).toBe(false);
      expect(gate(surface, zero).pass).toBe(false);
      expect(gate(surface, searched).pass).toBe(true);
    }
  });
  test('an arm with no pilot trials fails', () => {
    const f = JSON.parse(readFileSync(join(A, 'arms.json'), 'utf8')) as ArmsFile;
    const r = gate({ arms: { ...f, arms: f.arms.filter((x) => x.id === 'native:qm') }, pilot: pilot.trials, sets: sets(), audit: audit(), catalogDir: CATALOG, surfaces: SYNTHETIC_SURFACES });
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.checks.a_part_under_test_ran.reasons).toEqual(['no pilot trials for this arm']);
  });
  test('the gbrain relay log beside the host log joins it in time order, so request_tools is seen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-relay-'));
    mkdirSync(join(dir, 't/verifier'), { recursive: true });
    const line = (o: object) => JSON.stringify(o) + '\n';
    writeFileSync(join(dir, 't/verifier/catalog-calls.jsonl'), line({ at: '2026-01-01T00:00:01Z', server: 'github', method: 'initialize' }));
    writeFileSync(join(dir, 't/verifier/gbrain-calls.jsonl'), line({ at: '2026-01-01T00:00:03Z', server: 'gbrain', method: 'tools/call', tool: 'get_page' }) + line({ at: '2026-01-01T00:00:02Z', server: 'gbrain', method: 'tools/call', tool: 'request_tools' }));
    writeFileSync(join(dir, 't/verifier/gbrain-tools-list.json'), JSON.stringify({ tools: [{ name: 'search' }, { name: 'request_tools' }] }));
    writeFileSync(join(dir, 'trials.jsonl'), line({ trial_id: 'x', set: 'G', harness: 'claude-code', model: 'm', arm: 'gbrain-verbs', request: 'g1', rung: 150, outcomes: null, host_log: 't/verifier/catalog-calls.jsonl' }));
    const [loaded] = loadTrials(join(dir, 'trials.jsonl'));
    expect(loaded!.host_log_lines!.map((l) => l.tool ?? l.method)).toEqual(['initialize', 'request_tools', 'get_page']);
    expect(loaded!.gbrain_listed_tools).toEqual(['search', 'request_tools']);
  });
  const starterTrial = (log: Array<Record<string, any>>, set: 'G' | 'R' = 'G'): Trial => ({
    trial_id: 't' + log.length, set, harness: 'claude-code', model: 'm', arm: 'gbrain-starter', rung: 150, request: 'g', usage: null,
    outcomes: { servers_expected: ['github'], servers_connected: ['github'], calls: [], infra: null } as unknown as Trial['outcomes'],
    gbrain_listed_tools: SYNTHETIC_SURFACES.starter,
    host_log_lines: [{ server: 'github', method: 'initialize', ok: true }, { server: 'github', method: 'tools/list', ok: true }, { server: 'gbrain', method: 'tools/list', ok: true }, ...log],
  });
  const starterArm: Arm = { id: 'gbrain:starter', match: { arm: 'gbrain-starter' }, surface: 'gbrain:starter', sets: ['G', 'R'], rungs: [150], planned_usd: 10 };
  const call = (tool: string, ok = true) => ({ server: 'gbrain', method: 'tools/call', tool, ok });
  test('starter verifies its first tool list and reports successful widening, direct and full-only calls', () => {
    const fullOnly = SYNTHETIC_SURFACES.full.find((t) => !SYNTHETIC_SURFACES.starter.includes(t))!;
    const direct = starterTrial([call(fullOnly)]);
    const result = surfaceRan(starterArm, [
      starterTrial([call('request_tools'), call(fullOnly)]),
      direct,
      starterTrial([{ ...call(fullOnly), method: 'tools/call:received' }, call(fullOnly, false), call('request_tools', false), call(SYNTHETIC_SURFACES.starter[0]!)]),
    ], SYNTHETIC_SURFACES);
    expect(result.pass).toBe(true);
    expect(result.reasons.join(' ')).toContain('widened through request_tools 1/3 (33.3%), called an unlisted tool directly 1/3 (33.3%), reached a full-only tool 2/3 (66.7%)');
    const wrong = surfaceRan(starterArm, [{ ...direct, gbrain_listed_tools: SYNTHETIC_SURFACES.full }], SYNTHETIC_SURFACES);
    expect(wrong.pass).toBe(false);
    expect(wrong.reasons[0]).toContain('first gbrain tools/list');
  });
  test('gbrain needs catalog listing and a relay call, but catalog calls must come from set R if present', () => {
    const g = starterTrial([call(SYNTHETIC_SURFACES.starter[0]!)]);
    const r = starterTrial([], 'R');
    const catalog = { server: 'github', method: 'tools/call', tool: 'list_issues' };
    const gate = (trials: Trial[]) => surfaceRan(starterArm, trials, SYNTHETIC_SURFACES);
    expect(gate([g]).pass).toBe(true);
    expect(gate([{ ...g, host_log_lines: g.host_log_lines!.filter((x) => x.server !== 'github') }]).reasons[0]).toContain('no trial listed every expected server');
    expect(gate([starterTrial([call(SYNTHETIC_SURFACES.starter[0]!, false)])]).reasons.join(' ')).toContain('no gbrain tool call succeeded');
    expect(gate([{ ...g, host_log_lines: [...g.host_log_lines!, catalog] }, r]).reasons[0]).toContain('no catalog tool was called on set R');
    expect(gate([g, { ...r, host_log_lines: [...r.host_log_lines!, catalog] }]).pass).toBe(true);
  });
  test('catalog readiness requires successful initialize and tools/list in the host log', () => {
    const g = starterTrial([call(SYNTHETIC_SURFACES.starter[0]!)]);
    const gate = (trial: Trial) => surfaceRan(starterArm, [trial], SYNTHETIC_SURFACES);
    expect(gate({ ...g, host_log_lines: g.host_log_lines!.map((line) => line.server === 'github' ? { ...line, ok: undefined } : line) }).reasons[0]).toContain('no trial listed every expected server');
    expect(gate({ ...g, host_log_lines: g.host_log_lines!.map((line) => line.server === 'github' && line.method === 'tools/list' ? { ...line, ok: false } : line) }).pass).toBe(false);
    expect(gate(g).pass).toBe(true);
  });
  test('the dry form checks planned rungs and planned spend, before any outcome exists', () => {
    const planned = pilot.trials.map(({ outcomes: _o, effort: _e, ...t }) => ({ ...t, usage: { input_tokens: 0, usd: 0.01 } })) as typeof pilot.trials;
    const r = dryGate({ arms: arms(), planned, sets: sets(), audit: audit(), catalogDir: CATALOG, surfaces: SYNTHETIC_SURFACES });
    expect(r.map((x) => [x.arm, x.pass])).toEqual(arms().arms.map((a) => [a.id, true]));
    const thin = planned.filter((t) => !(t.harness === 'claude-code' && t.arm === 'native' && t.rung === 75)).map((t) => (t.arm === 'native' && t.harness === 'hermes' ? { ...t, usage: { input_tokens: 0, usd: 5 } } : t));
    const by = Object.fromEntries(dryGate({ arms: arms(), planned: thin, sets: sets(), audit: audit(), catalogDir: CATALOG, surfaces: SYNTHETIC_SURFACES }).map((x) => [x.arm, x]));
    expect(by['native:claude-code']!.checks.a_rungs_planned.reasons[0]).toBe('no planned trial at rung 75');
    expect(by['native:hermes']!.checks.spend.reasons[0]).toContain('shrink the arm');
  });
});

describe('end to end on synthetic outcomes (2 harnesses x 4 rungs)', () => {
  test('synthetic -> exploratory and final analysis around one interim look -> pilot gates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-e2e-'));
    expect(run([join(A, 'synthetic.ts'), '--out', dir]).code).toBe(0);
    const sets = ['set-r', 'set-t', 'set-g'].map((s) => join(dir, 'sets', s + '.jsonl'));
    const analysisArgs = [join(A, 'analyze.ts'), '--trials', join(dir, 'trials.jsonl'), '--sets', ...sets];
    expect(run([...analysisArgs, '--out', join(dir, 'analysis')]).code).toBe(2);
    const an = run([...analysisArgs, '--exploratory', '--places', join(dir, 'places.json'), '--out', join(dir, 'analysis')]);
    expect(an.code).toBe(0);
    const a = JSON.parse(readFileSync(join(dir, 'analysis', 'analysis.json'), 'utf8'));
    expect(a.decision2_3.map((h: { harness: string; slip_point: number | null }) => [h.harness, h.slip_point])).toEqual([['claude-code', null], ['hermes', 150]]);
    expect(a.places.length).toBeGreaterThan(0);
    const state = join(dir, 'state.json');
    const lookArgs = [join(A, 'interim.ts'), 'look', '--trials', join(dir, 'trials.jsonl'), '--sets', ...sets, '--state', state];
    const unproven = run([...lookArgs, '--out', join(dir, 'interim')]);
    expect(unproven.code).toBe(2);
    expect(unproven.err).toContain('phase 1 is not shown complete and drained');
    expect(existsSync(state)).toBe(false);
    const sha = (p: string) => new Bun.CryptoHasher('sha256').update(readFileSync(p)).digest('hex');
    const receipt = { schema: 'he-mcp-at-scale-phase-1-index/1', run_id: 'synthetic', shards: { a: 'synthetic' },
      trials_sha256: sha(join(dir, 'trials.jsonl')), design_sha256: sha(join(A, 'interim-design.json')), sets_sha256: sets.map(sha) };
    writeFileSync(join(dir, 'phase-1-index.json'), JSON.stringify({ ...receipt, trials_sha256: 'a partial index' }));
    expect(run([...lookArgs, '--out', join(dir, 'interim')]).code).toBe(2);
    expect(existsSync(state)).toBe(false);
    writeFileSync(join(dir, 'phase-1-index.json'), JSON.stringify(receipt));
    const partialLook = run([join(A, 'interim.ts'), 'look', '--trials', join(dir, 'trials.jsonl'), '--sets', sets[0]!, '--state', state, '--out', join(dir, 'interim')]);
    expect(partialLook.err).toContain('do not match the phase 1 index');
    expect(existsSync(state)).toBe(false);
    const first = run([...lookArgs, '--out', join(dir, 'interim')]);
    expect(first.code).toBe(0);
    expect(first.out).toContain('slip:hermes: stop_efficacy');
    expect(first.out).toContain(STOPPED_NOTE);
    expect(JSON.parse(readFileSync(state, 'utf8')).status).toBe('complete');
    const noRecord = run([...analysisArgs, '--interim-state', state, '--out', join(dir, 'no-record')]);
    expect(noRecord.code).not.toBe(0);
    expect(noRecord.err).toContain('needs the interim look\'s record');
    const record = join(dir, 'interim', 'interim.json');
    const editedRecord = join(dir, 'edited-interim.json');
    const rec = JSON.parse(readFileSync(record, 'utf8'));
    writeFileSync(editedRecord, JSON.stringify({ ...rec, results: rec.results.map((x: { id: string }) => (x.id === 'slip:hermes' ? { ...x, decision: 'continue' } : x)) }));
    const edited = run([...analysisArgs, '--interim-state', state, '--interim-record', editedRecord, '--out', join(dir, 'edited')]);
    expect(edited.code).not.toBe(0);
    expect(edited.err).toContain('the interim record does not match the interim state');
    for (const [name, changed] of [['other-digest', { ...rec, trials_digest: 'x' }], ['short', { ...rec, results: rec.results.slice(1) }]] as const) {
      const p = join(dir, name + '-interim.json');
      writeFileSync(p, JSON.stringify(changed));
      const refused = run([...analysisArgs, '--interim-state', state, '--interim-record', p, '--out', join(dir, name)]);
      expect(refused.code).not.toBe(0);
      expect(refused.err).toContain('the interim record does not match the interim state');
    }
    const editedNumbers = join(dir, 'edited-numbers-interim.json');
    writeFileSync(editedNumbers, JSON.stringify({ ...rec, results: rec.results.map((x: { id: string; z: number; contrast: { delta: number } }) =>
      (x.id === 'slip:hermes' ? { ...x, z: x.z + 1, contrast: { ...x.contrast, delta: x.contrast.delta + 0.1 } } : x)) }));
    const numbersRefused = run([...analysisArgs, '--interim-state', state, '--interim-record', editedNumbers, '--out', join(dir, 'edited-numbers')]);
    expect(numbersRefused.code).not.toBe(0);
    expect(numbersRefused.err).toContain('the interim record does not match the look recomputed from these trials: slip:hermes');
    expect(existsSync(join(dir, 'edited-numbers'))).toBe(false);
    const fin = run([...analysisArgs, '--interim-state', state, '--interim-record', record, '--out', join(dir, 'final')]);
    expect(fin.code).toBe(0);
    expect(fin.out).toContain(STOPPED_NOTE);
    expect(fin.out).toContain('slip:hermes: stop_efficacy (' + STOPPED_NOTE + '; look ');
    expect(fin.out).toContain(DESCRIPTIVE_NOTE);
    const changedMargin = join(dir, 'changed-margin.json');
    writeFileSync(changedMargin, JSON.stringify({ gbrain: 0.5 }));
    const marginRefused = run([...analysisArgs, '--interim-state', state, '--margins', changedMargin, '--out', join(dir, 'refused-margin')]);
    expect(marginRefused.code).not.toBe(0);
    expect(marginRefused.err).toContain('does not match the interim gbrain margin');
    expect(existsSync(join(dir, 'refused-margin'))).toBe(false);
    const f = JSON.parse(readFileSync(join(dir, 'final', 'analysis.json'), 'utf8'));
    const hermes = f.decision2_3.find((h: { harness: string }) => h.harness === 'hermes');
    expect(hermes.slip_point).toBeNull();
    expect(hermes.holds_through_300).toBeNull();
    expect(hermes.sequence).toHaveLength(1);
    expect(hermes.sequence[0].slips).toBeNull();
    expect(hermes.sequence[0].final_look).toMatchObject({ interim_decision: 'stop_efficacy', z: null, boundary_crossed: null, note: STOPPED_NOTE, label: DESCRIPTIVE_NOTE,
      look: { decision: 'stop_efficacy', z: rec.results.find((x: { id: string }) => x.id === 'slip:hermes').z } });
    expect(hermes.sequence[0].contrast.n_pairs).toBeGreaterThan(0);
    expect(f.interim_stops.find((x: { comparison: string }) => x.comparison === 'slip:hermes').look.decision).toBe('stop_efficacy');
    const otherDir = join(dir, 'other');
    mkdirSync(otherDir);
    const other = readFileSync(join(dir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((t) => (t.outcomes ? { ...t, outcomes: { ...t.outcomes, invalid_calls: 1 } } : t));
    writeFileSync(join(otherDir, 'trials.jsonl'), other.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const rebound = run([join(A, 'analyze.ts'), '--trials', join(otherDir, 'trials.jsonl'), '--sets', ...sets, '--interim-state', state, '--out', join(dir, 'refused-trials')]);
    expect(rebound.code).not.toBe(0);
    expect(rebound.err).toContain('interim state was computed from different trials');
    expect(existsSync(join(dir, 'refused-trials'))).toBe(false);
    const withQm = join(dir, 'with-qm');
    mkdirSync(withQm);
    const runRows = readFileSync(join(dir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const qmRows = runRows.filter((t) => t.harness === runRows[0].harness).map((t) => ({ ...t, trial_id: t.trial_id + '-qm', harness: 'qm' }));
    writeFileSync(join(withQm, 'trials.jsonl'), [...runRows, ...qmRows].map((t) => JSON.stringify(t)).join('\n') + '\n');
    const merged = run([join(A, 'analyze.ts'), '--trials', join(withQm, 'trials.jsonl'), '--sets', ...sets, '--interim-state', state, '--interim-record', record, '--out', join(dir, 'with-qm-final')]);
    expect(merged.code).not.toBe(0);
    expect(merged.err).toContain('the final analysis reads only the run\'s own harnesses; analyze qm rows on their own with --exploratory');
    expect(existsSync(join(dir, 'with-qm-final'))).toBe(false);
    const qmOnly = join(withQm, 'qm.jsonl');
    writeFileSync(qmOnly, qmRows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    expect(run([join(A, 'analyze.ts'), '--trials', qmOnly, '--sets', ...sets, '--exploratory', '--out', join(dir, 'qm-alone')]).code).toBe(0);
    const lookItems = sets.flatMap((s) => readFileSync(s, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Item));
    const design = JSON.parse(readFileSync(join(A, 'interim-design.json'), 'utf8')) as Design;
    const withQmLook = look({ trials: loadTrials(join(withQm, 'trials.jsonl')), items: lookItems, design });
    expect(withQmLook.trials_digest).toBe(look({ trials: loadTrials(join(dir, 'trials.jsonl')), items: lookItems, design }).trials_digest);
    const invalidState = join(dir, 'invalid-state.json');
    writeFileSync(invalidState, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), design_sha256: 'not-the-frozen-design' }));
    const refused = run([...analysisArgs, '--interim-state', invalidState, '--out', join(dir, 'refused')]);
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain('does not match the frozen design');
    expect(existsSync(join(dir, 'refused'))).toBe(false);
    const second = run([join(A, 'interim.ts'), 'look', '--trials', join(dir, 'trials.jsonl'), '--sets', ...sets, '--state', state, '--out', join(dir, 'interim2')]);
    expect(second.code).toBe(4);
    expect(second.err).toContain('refused');
    expect(existsSync(join(dir, 'interim2'))).toBe(false);
    const g = run([join(A, 'pilot-gates.ts'), '--pilot', join(dir, 'pilot-trials.jsonl'), '--sets', ...sets, '--audit', join(dir, 'audit-status.json'), '--catalog', CATALOG, '--arms', join(dir, 'arms.json'), '--gbrain-surfaces', join(dir, 'gbrain-surfaces.json')]);
    expect(g.code).toBe(0);
    expect(g.out.split('\n').filter((l) => /^(PASS|FAIL) /.test(l)).every((l) => l.startsWith('PASS'))).toBe(true);
    const b = run([join(A, 'interim.ts'), 'bounds']);
    expect(b.out).toContain('| slip:hermes | 0.05 | 2 | 2.797 | 1.977 |');
    expect(run([join(A, 'power.ts')]).out).toContain('| Right tool, one setup at one rung against its 30 rung | 240 | 0.2 | 9.9 | 12.8 |');
  }, 60_000);
});
