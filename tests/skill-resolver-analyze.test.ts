// Keyless test of scripts/skill-resolver/analyze.ts on a synthetic merged results directory: the primary contrast, Holm per
// harness, denominators with a reachable set, TOST against names-only, false suggestions on and off, INFRA by code
// (intention-to-treat), the task phase with its strata, the footprint and the printed seed (internal-task).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTAMINATED, DRAWS, SEED, analyze, loadLabels, loadTrials, markdown, type JudgeCheck, type Label } from '../scripts/skill-resolver/analyze.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'skill-resolver-synthetic';
const SKILLS = Array.from({ length: 30 }, (_, i) => 'skill-' + i);
const NEED = SKILLS.map((_, i) => 'p-' + i);
const NONE = Array.from({ length: 10 }, (_, i) => 'p-none-' + i);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-analyze-'));
  const cells = [
    { id: 'oc-native', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', config: 'skills-native' },
    { id: 'oc-on', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', config: 'skills-resolver' },
    { id: 'oc-names', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', config: 'skills-names-only' },
    { id: 'qm-native', harness: 'qm', model: 'anthropic:claude-opus-5-5', config: 'pi-skills-native' },
    { id: 'qm-on', harness: 'qm', model: 'anthropic:claude-opus-5-5', config: 'pi-skills-push' },
    { id: 't-native', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'skill-tasks', skill_arm: 'native' },
    { id: 't-on', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'skill-tasks', skill_arm: 'resolver-on' },
    { id: 't-none', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'skill-tasks', skill_arm: 'no-catalog' },
  ];
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: RUN, cells }));
  const records: unknown[] = [];
  const trial = (cell: typeof cells[number], task: string, extra: Record<string, unknown> = {}) => {
    const id = RUN + '/' + cell.id + '/' + task + '/r1';
    const tdir = join(dir, 'trials', cell.id, task, 'r1');
    mkdirSync(join(tdir, 'logs', 'skill-resolver'), { recursive: true });
    records.push({ trial_id: id, cell: cell.id, task, harness: cell.harness, model: cell.model, termination: 'completed', grade: 'n/a', ...extra });
    return tdir;
  };
  for (const cell of cells.filter((c) => c.config)) {
    const qm = cell.harness === 'qm';
    const on = cell.config === 'skills-resolver' || cell.config === 'pi-skills-push';
    const names = cell.config === 'skills-names-only';
    [...NEED, ...NONE].forEach((task, i) => {
      const need = i < NEED.length;
      const hit = need && (on ? i < 25 : names ? i < 24 : i < 10);
      const offTarget = on && !need && i % 5 === 0;
      const tdir = trial(cell, task);
      const opened = [...(hit ? [SKILLS[i]!] : []), ...(offTarget ? ['zz-wrong'] : [])];
      writeFileSync(join(tdir, 'got-skill.json'), JSON.stringify(qm ? { opened } : { catalog_opened: opened }));
      if (names) return;
      const block = on || i % 2 === 0;
      const suggestions = need ? [SKILLS[i]!] : ['zz-wrong'];
      const infra = qm && on && i === 3 ? ['index_stale'] : [];
      const line = qm
        ? { schema: 'he-skill-resolver-status/1', trial: task, turn: 1, call: on ? 'push' : 'shadow', code: infra.length ? 'OK' : 'OK', block_chars: block ? 120 : 0, block_tokens: block ? 30 : 0, suggestions, budget_phase: 'under_half', budget_exhausted: false, injected: on && block, infra }
        : { session_key: 's-' + task, session_turn: 1, mode: on ? 'push' : 'shadow', code: block ? 'OK' : 'NO_SKILL', block_bytes: block ? 120 : 0, block_tokens: block ? 30 : 0, suggestions, budget_phase: 'under_half', budget_exhausted: false, injected: on && block, infra: false, infra_reasons: [], repeat: false };
      writeFileSync(join(tdir, 'logs', qm ? 'skill-resolver.ndjson' : 'skill-resolver/status.ndjson'), JSON.stringify(line) + '\n');
      if (infra.length) writeFileSync(join(tdir, 'logs', 'skill-resolver.infra.json'), JSON.stringify({ reasons: infra }));
    });
  }
  const longSession = join(dir, 'trials', 'oc-on', NEED[0]!, 'r1', 'logs', 'skill-resolver', 'status.ndjson');
  writeFileSync(longSession, Array.from({ length: 12 }, (_, t) => JSON.stringify({ session_key: 'long', session_turn: t + 1, mode: 'push', code: t >= 10 ? 'BUDGET_EXHAUSTED' : 'OK', block_bytes: t >= 10 ? 0 : 400, block_tokens: t >= 10 ? 0 : 100, suggestions: t >= 10 ? [] : [SKILLS[0]!], budget_phase: t >= 10 ? 'exhausted' : 'under_half', budget_exhausted: t >= 10, injected: t < 10, infra: false, infra_reasons: [], repeat: false })).join('\n') + '\n');
  const tasks = ['t09-guess', 't15-plain', 't22-strict', 't40-guess'];
  const pass: Record<string, number[]> = { 't-native': [1, 0, 0, 0], 't-on': [1, 1, 1, 0], 't-none': [0, 0, 0, 0] };
  for (const cell of cells.filter((c) => c.skill_arm)) tasks.forEach((task, i) => {
    const ok = pass[cell.id]![i] === 1;
    trial(cell, task, { grade: ok ? 'pass' : 'fail', set_t: { task, target: 'x', pack: 'hermes', skill_md_sha256: 'x', arm: cell.skill_arm, request_sha256: 'x', success: ok, used_it: ok, instruction_md: 'seeded', checks: [] } });
  });
  writeFileSync(join(dir, 'trials.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const labels = join(dir, 'labels.jsonl');
  writeFileSync(labels, [...NEED.map((id, i) => ({ id, half: i % 2 ? 'test' : 'dev', final: { no_skill_needed: false, acceptable: [SKILLS[i]] } })), ...NONE.map((id) => ({ id, half: 'dev', final: { no_skill_needed: true, acceptable: [] } }))].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const requests = join(dir, 'setp.jsonl');
  writeFileSync(requests, [...NEED.map((id, i) => ({ id, kind: 'skill', overlap: { nd_jaccard: i < 15 ? 0 : 0.08 } })), ...NONE.map((id) => ({ id, kind: 'none', overlap: null }))].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const reachable = join(dir, 'reachable.json');
  writeFileSync(reachable, JSON.stringify({ catalog_hash: 'x', harnesses: { openclaw: { native: SKILLS.slice(0, 29), 'names-only': SKILLS.slice(0, 29) }, qm: { native: SKILLS, 'names-only': SKILLS } }, excluded: {} }));
  const setT = new Map(tasks.map((t, i) => [t, { bin: i < 2 ? 'none' : 'low', body_coverage: 0.1 * (i + 1) }]));
  return { dir, labels, requests, reachable, setT };
}

describe('skill-resolver analysis on synthetic results', () => {
  const f = fixture();
  const passing: JudgeCheck = { n_gold: 50, sources: { panel: { judge: 'panel', kappa: 0.8, catch_rate: 0.9, false_fail_rate: 0.05, n_bad: 20, n_good: 30 } } };
  const a = analyze({ trials: loadTrials(f.dir), labels: loadLabels([['P', f.labels]], [['P', f.requests]]), reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT, judgeCheck: passing });

  test('primary: per request within a cell, clustered by request, with exact McNemar on discordant pairs', () => {
    expect(a.primary.n_pairs).toBe(59);
    expect(a.primary.n_clusters).toBe(30);
    expect(a.primary.excluded).toEqual({ 'no_skill_needed': 20, 'no acceptable skill reachable': 1 });
    expect(a.primary.delta).toBeCloseTo(30 / 59, 10);
    expect(a.primary.mcnemar).toMatchObject({ wins: 30, losses: 0, discordant: 30 });
    expect(a.primary).toMatchObject({ significant: true, gated_by_judge_check: true, cross_family_labels: false, claim_met: false });
    expect(a.sensitivity_test_half.n_pairs).toBe(29);
    expect(a.primary).toMatchObject({ n_better: 30, n_worse: 0, n_same: 29, reading: 'resolver-on higher' });
    expect(a.primary.mdd80!).toBeGreaterThan(0);
    expect(a.set_r.descriptive).toBe(true);
  });

  test('R78: no judge check, too few gold outputs, or kappa under 0.6 leaves Got the skill descriptive', () => {
    const run = (judgeCheck: JudgeCheck | null) => analyze({ trials: loadTrials(f.dir), labels: loadLabels([['P', f.labels]], [['P', f.requests]]), reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT, judgeCheck });
    for (const j of [null, { ...passing, n_gold: 39 }, { n_gold: 50, sources: { panel: { ...passing.sources.panel!, kappa: 0.59 } } }]) {
      const g = run(j);
      expect(g.primary.significant).toBe(true);
      expect(g.primary.claim_met).toBe(false);
      expect(g.judge.gates_verdict).toBe(false);
    }
    expect(markdown(run(null))).toContain('Got the skill is descriptive');
  });

  test('R78 cross-family labels: Claude cells are scored with the Astra label, GPT cells with the Opus label', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-cross-'));
    const base = readFileSync(f.labels, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const labels = join(dir, 'labels.jsonl'), astra = join(dir, 'labels-astra.jsonl');
    writeFileSync(labels, base.map((r) => JSON.stringify({ ...r, judges: { opus: { ...r.final, candidates: [] } } })).join('\n') + '\n');
    writeFileSync(astra, base.map((r, i) => JSON.stringify({ id: r.id, judges: { astra: i < 5 ? { no_skill_needed: true, acceptable: [], candidates: [] } : { ...r.final, candidates: [] } } })).join('\n') + '\n');
    const L = loadLabels([['P', labels]], [['P', f.requests]], [], [['P', astra]]);
    expect(L.get('p-0')!.by_family).toMatchObject({ anthropic: { no_skill_needed: true, judge: 'openai:gpt-6-astra' }, openai: { no_skill_needed: false, judge: 'anthropic:claude-opus-5-5' } });
    const g = analyze({ trials: loadTrials(f.dir), labels: L, reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT, judgeCheck: null });
    expect(g.judge.label_source).toEqual({ 'anthropic cells': 'openai:gpt-6-astra', 'openai cells': 'anthropic:claude-opus-5-5' });
    expect(g.primary.n_pairs).toBe(49);
    expect(g.primary.excluded.no_skill_needed).toBe(30);
    expect(g.panel_labels!.n_pairs).toBe(59);
  });

  test('R78: the claim is met only on cross-family labels with their own judge check; panel labels and a panel check cannot stand in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-claim-'));
    const base = readFileSync(f.labels, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const labels = join(dir, 'labels.jsonl'), astra = join(dir, 'labels-astra.jsonl'), partial = join(dir, 'labels-astra-partial.jsonl');
    writeFileSync(labels, base.map((r) => JSON.stringify({ ...r, judges: { opus: { ...r.final, candidates: [] } } })).join('\n') + '\n');
    writeFileSync(astra, base.map((r) => JSON.stringify({ id: r.id, judges: { astra: { ...r.final, candidates: [] } } })).join('\n') + '\n');
    writeFileSync(partial, base.slice(1).map((r) => JSON.stringify({ id: r.id, judges: { astra: { ...r.final, candidates: [] } } })).join('\n') + '\n');
    const astraCheck: JudgeCheck = { n_gold: 50, sources: { 'openai:gpt-6-astra': { ...passing.sources.panel!, judge: 'openai:gpt-6-astra' } } };
    const run = (L: Map<string, Label>, judgeCheck: JudgeCheck) => analyze({ trials: loadTrials(f.dir), labels: L, reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT, judgeCheck }).primary;
    const cross = loadLabels([['P', labels]], [['P', f.requests]], [], [['P', astra]]);
    expect(run(cross, astraCheck)).toMatchObject({ significant: true, cross_family_labels: true, gated_by_judge_check: true, claim_met: true });
    expect(run(cross, passing)).toMatchObject({ gated_by_judge_check: false, claim_met: false });
    expect(run(loadLabels([['P', f.labels]], [['P', f.requests]]), passing)).toMatchObject({ significant: true, gated_by_judge_check: true, cross_family_labels: false, claim_met: false });
    expect(run(loadLabels([['P', labels]], [['P', f.requests]], [], [['P', partial]]), astraCheck)).toMatchObject({ cross_family_labels: false, claim_met: false });
  });

  test('a set T trial that left no workspace (no set_t) stays in the set T comparison as a failure, not in Phase B', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-analyze-noworkspace-'));
    cpSync(f.dir, dir, { recursive: true });
    const lines = readFileSync(join(dir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const r of lines) if (r.cell === 't-on' && r.task === 't15-plain') { delete r.set_t; r.grade = 'n/a'; r.error = 'HE-RUN-006 set T trial left no workspace to grade'; }
    writeFileSync(join(dir, 'trials.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const g = analyze({ trials: loadTrials(dir), labels: loadLabels([['P', f.labels]], [['P', f.requests]]), reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT, judgeCheck: passing });
    expect(g.trials).toEqual(a.trials);
    expect(g.infra.no_set_t_grade).toBe(1);
    const pooled = (x: typeof a) => x.task_phase.pooled.success['resolver-on_minus_native'];
    expect({ n: pooled(g).n_pairs, on: pooled(g).mean_b }).toEqual({ n: pooled(a).n_pairs, on: pooled(a).mean_b! - 1 / pooled(a).n_pairs });
    expect(markdown(g)).toContain('| set T trial with no workspace graded | scored as a failure | 1 |');
  });

  test('exact-duplicate requests in one request_duplicate_groups entry share a cluster', () => {
    const g = analyze({ trials: loadTrials(f.dir), labels: loadLabels([['P', f.labels]], [['P', f.requests]], [['p-0', 'p-1'], ['p-2', 'p-3', 'p-4']]), reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT });
    expect(g.primary.n_pairs).toBe(a.primary.n_pairs);
    expect(g.primary.n_clusters).toBe(a.primary.n_clusters - 3);
    expect(g.primary.delta).toBeCloseTo(a.primary.delta!, 10);
  });

  test('contaminated trials (skill_request.clean_arm) are reported per cell and left out of every scored number, with the count shown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-analyze-clean-'));
    cpSync(f.dir, dir, { recursive: true });
    const dirty = new Set(['oc-on/p-0', 'oc-on/p-1', 'oc-on/p-20', 'oc-native/p-none-0']);
    const lines = readFileSync(join(dir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    writeFileSync(join(dir, 'trials.jsonl'), lines.map((r) => JSON.stringify(r.trial_id.split('/')[1] === 'oc-on' || r.trial_id.split('/')[1] === 'oc-native'
      ? { ...r, skill_request: { clean_arm: dirty.has(r.cell + '/' + r.task) ? { gstack_reads: 2, paths: ['~/.local/share/gstack/SKILL.md'], contaminated: true } : { gstack_reads: 0, paths: [], contaminated: false } } } : r)).join('\n') + '\n');
    const trials = loadTrials(dir);
    expect(trials.filter((t) => t.contaminated).map((t) => t.cell + '/' + t.task).sort()).toEqual([...dirty].sort());
    const c = analyze({ trials, labels: loadLabels([['P', f.labels]], [['P', f.requests]]), reachable: JSON.parse(readFileSync(f.reachable, 'utf8')), setT: f.setT, judgeCheck: passing });
    expect(c.primary.excluded).toEqual({ 'no_skill_needed': 20, 'no acceptable skill reachable': 1, [CONTAMINATED]: 3 });
    expect(c.primary.n_pairs).toBe(a.primary.n_pairs - 3);
    expect(c.primary.n_better).toBe(a.primary.n_better - 1);
    expect(c.contamination.total).toBe(4);
    expect(c.contamination.per_cell.filter((x) => x.contaminated)).toEqual([
      { cell: 'oc-native', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', arm: 'native', trials: 40, contaminated: 1, gstack_reads: 2 },
      { cell: 'oc-on', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', arm: 'resolver-on', trials: 40, contaminated: 3, gstack_reads: 6 },
    ]);
    const cell = (x: typeof a) => x.per_cell.find((p) => p.harness === 'openclaw')!.got_the_skill;
    expect(cell(c)['resolver-on']!.n).toBe(cell(a)['resolver-on']!.n - 3);
    expect(cell(c)['resolver-on']!.x).toBe(cell(a)['resolver-on']!.x - 3);
    const pooledOff = (x: typeof a) => x.false_suggestions.rows.find((r) => r.scope === 'openclaw' && r.mode !== 'on')!.a_no_skill_requests_with_block.n;
    expect(pooledOff(c)).toBe(pooledOff(a) - 1);
    expect(a.contamination.total).toBe(0);
    const md = markdown(c);
    expect(md).toContain('## Clean-arm audit (contaminated trials left out of every scored number)');
    expect(md).toContain('| oc-on | openclaw | anthropic:claude-opus-5-5 | resolver-on | 40 | 3 | 6 |');
  });

  test('per harness carries Holm-adjusted p; denominators count exclusions; per cell has intervals', () => {
    expect(a.per_harness.map((h) => h.harness)).toEqual(['openclaw', 'qm']);
    for (const h of a.per_harness) expect(h.p_holm!).toBeGreaterThanOrEqual(h.p_sign_flip!);
    expect(a.denominators).toEqual([{ harness: 'openclaw', model: 'anthropic:claude-opus-5-5', requests: 40, 'in denominator': 29, no_skill_needed: 10, 'no acceptable skill reachable': 1 }, { harness: 'qm', model: 'anthropic:claude-opus-5-5', requests: 40, 'in denominator': 30, no_skill_needed: 10 }]);
    const oc = a.per_cell.find((c) => c.harness === 'openclaw')!;
    expect(oc.got_the_skill.native).toMatchObject({ x: 10, n: 29 });
    expect(oc.got_the_skill.native!.ci95![0]).toBeLessThan(10 / 29);
  });

  test('names-only gets a TOST at 10 points: one discordant request in 29 is too few to show equivalence', () => {
    const e = a.equivalence.find((x) => x.comparator === 'names-only')!;
    expect(e).toMatchObject({ harness: 'openclaw', set: 'P', comparator: 'names-only' });
    expect(e.contrast.n_pairs).toBe(29);
    expect(e.contrast.delta).toBeCloseTo(1 / 29, 10);
    expect(e.tost.p_lower!).toBeLessThan(0.05);
    expect(e.tost.p!).toBeGreaterThan(0.05);
    expect(e.tost.verdict).toBe('could not tell apart');
  });

  test('false suggestions: (a) and (b) on and off, pooled and per harness, by budget phase', () => {
    const pooledOn = a.false_suggestions.rows.find((r) => r.scope === 'pooled' && r.mode === 'on')!;
    const pooledOff = a.false_suggestions.rows.find((r) => r.scope === 'pooled' && r.mode !== 'on')!;
    expect(pooledOn.a_no_skill_requests_with_block).toMatchObject({ x: 20, n: 20 });
    expect(pooledOff.a_no_skill_requests_with_block).toMatchObject({ x: 10, n: 20 });
    expect(pooledOn.b_off_target_reads_per_block_turn).toMatchObject({ x: 4 });
    expect(pooledOn.a_meets_bar).toBe(false);
    expect(Object.keys(pooledOn.a_by_budget_phase)).toEqual(['under_half']);
  });

  test('INFRA is counted by reason and code and stays in (intention-to-treat)', () => {
    expect(a.infra.by_reason).toEqual({ index_stale: 1 });
    expect(a.infra.infra_trials).toEqual({ 'qm resolver-on': 1 });
    expect(a.infra.by_code.OK).toBeGreaterThan(0);
    expect(a.infra.handling).toContain('intention-to-treat');
  });

  test('task phase: paired success and used_it, the 10-point TOST, per cell, strata and flagged groups', () => {
    const s = a.task_phase.pooled.success!['resolver-on_minus_native'];
    expect(s).toMatchObject({ n_pairs: 4, mean_a: 0.25, mean_b: 0.75 });
    expect(a.task_phase.success_tost.margin).toBe(0.1);
    expect(a.task_phase.per_cell[0]!.arms['no-catalog']!.success).toMatchObject({ x: 0, n: 4 });
    const strata = a.task_phase.strata as Array<{ stratum: string; success: { n_pairs: number } }>;
    expect(strata.map((x) => x.stratum)).toEqual(['overlap none', 'overlap low', 'flagged guessable', 'flagged strict_used_it', 'flagged may_stall']);
    expect(strata.find((x) => x.stratum === 'flagged guessable')!.success.n_pairs).toBe(2);
  });

  test('footprint at turns 1, 10 and 50 and the first budget_exhausted turn', () => {
    const f1 = a.footprint.find((x) => x.harness === 'openclaw' && x.arm === 'resolver-on')! as unknown as Record<string, { sessions: number; median_tokens: number | null; max_tokens: number | null }> & { budget_exhausted: { sessions: number; first_turn_min: number } };
    expect(f1.turn_10).toMatchObject({ sessions: 1, median_tokens: 1000 });
    expect(f1.turn_50!.sessions).toBe(0);
    expect(f1.budget_exhausted).toMatchObject({ sessions: 1, first_turn_min: 11 });
  });

  test('set P strata by overlap bin; the markdown has every section and no ranking words', () => {
    expect(a.strata_set_p.map((s) => s.bin)).toEqual(['none', 'mid']);
    const md = markdown(a);
    for (const h of ['## Primary', '## Per harness', '## Per cell', '## Against the config-only arms', '## False suggestions', '## INFRA', '## Task phase', '## Context footprint', '## Set P by overlap bin', '## Denominators']) expect(md).toContain(h);
    expect(md).not.toMatch(/\b(best|worst|winner|ranks?|ranking|leader)\b/i);
  });

  test('the CLI writes analysis.json and analysis.md and prints the seed and draw count', () => {
    const out = join(f.dir, 'out');
    const r = spawnSync(process.execPath, ['scripts/skill-resolver/analyze.ts', '--results', f.dir, '--labels', 'P=' + f.labels, '--requests', 'P=' + f.requests, '--reachable', f.reachable, '--set-t', 'tasks/skill-resolver/T/tasks', '--out', out],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() } });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ANALYSIS seed=' + SEED + ' draws=' + DRAWS);
    const j = JSON.parse(readFileSync(join(out, 'analysis.json'), 'utf8'));
    expect({ seed: j.seed, draws: j.draws, pairs: j.primary.n_pairs }).toEqual({ seed: SEED, draws: DRAWS, pairs: 59 });
    expect(readFileSync(join(out, 'analysis.md'), 'utf8')).toContain('Bootstrap seed ' + SEED);
  });
});
