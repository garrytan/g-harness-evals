#!/usr/bin/env bun
/**
 * R126 check of failure-mining's unscoped_brain_search class against the event-log scope counter (internal-task,
 * 2026-11-25). Counter yes: a required cross_scope check in the trial's grade.json failed with an offending gbrain read
 * (not "refused by gbrain") whose event in events.jsonl was not made by the provider (QM injects some reads itself,
 * caller "provider"). Prints the agreement with particle-1's labels and the paired unscoped difference three ways,
 * through analyze.ts's own functions: as published, counter only, and QM provider reads moved out. Costs nothing.
 *
 *   bun scripts/corrections/check-failure-mining-scope.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analysisClasses, gbrainPairs, GRADED_BEFORE_FIX, loadRegrade, OTHER, pooledTests, taskTrees, trialsOf, UNLABELLED, type ManifestRow, type Unit } from '../failure-mining/analyze.ts';
import { readLabels } from '../failure-mining/check-labels.ts';

const ROOT = join(import.meta.dir, '..', '..');
const RUN = join(ROOT, 'docs/benchmarks/2026-11-09-failure-mining');
const UNSCOPED = 'unscoped_brain_search';
const INJECTED = 'harness_injected_out_of_scope';
const jsonl = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const manifest = jsonl<ManifestRow>(join(RUN, 'corpus/manifest.jsonl'));
const byId = new Map(manifest.map((m) => [m.trial_id, m]));
const labels = readLabels(join(RUN, 'results/labels/particle.jsonl'));

interface Row { id: string; brain: boolean; population: string; label: string | null | undefined; model: number; provider: number }
const rows: Row[] = [];
for (const [id, l] of labels.lines) {
  const m = byId.get(id)!;
  const dir = join(ROOT, m.results_dir, 'trials', id.split('/').slice(1).join('/'));
  if (!existsSync(join(dir, 'grade.json'))) throw new Error('no grade.json for labelled trial ' + id);
  const grade = JSON.parse(readFileSync(join(dir, 'grade.json'), 'utf8')) as { predicates?: Array<{ id?: string; kind?: string; passed?: boolean; evidence?: string }> };
  const events = new Map<number, { caller?: string }>();
  if (existsSync(join(dir, 'events.jsonl'))) for (const e of jsonl<{ seq: number; caller?: string }>(join(dir, 'events.jsonl'))) events.set(e.seq, e);
  let model = 0, provider = 0;
  for (const q of grade.predicates ?? []) {
    if (q.kind !== 'required' || q.passed || !/cross_scope/.test(q.id ?? '')) continue;
    for (const part of (q.evidence ?? '').split('; ')) {
      const s = part.match(/seq=(\d+) (\S+)/);
      if (!s || !s[2]!.startsWith('gbrain.') || part.includes(', refused by gbrain (')) continue;
      if (events.get(Number(s[1]))?.caller === 'provider') provider++; else model++;
    }
  }
  rows.push({ id, brain: m.gbrain.present, population: m.population, label: l.root_cause, model, provider });
}

const agreement = (rs: Row[]) => {
  const n = rs.length, u = rs.filter((r) => r.label === UNSCOPED).length, c = rs.filter((r) => r.model > 0).length;
  const a = rs.filter((r) => (r.label === UNSCOPED) === r.model > 0).length;
  const pe = (u / n) * (c / n) + (1 - u / n) * (1 - c / n);
  return { trials: n, labelled_unscoped: u, counter_yes: c, both: rs.filter((r) => r.label === UNSCOPED && r.model > 0).length, agree: a, kappa: Math.round(((a / n - pe) / (1 - pe)) * 1000) / 1000 };
};
console.log(JSON.stringify({ all: agreement(rows), brain_arms: agreement(rows.filter((r) => r.brain)), brain_default: agreement(rows.filter((r) => r.brain && r.population === 'default')) }));
const unexplained = rows.filter((r) => r.label === UNSCOPED && r.model === 0);
console.log(JSON.stringify({ unscoped_label_without_model_read: unexplained.length, of_them_provider_reads: unexplained.filter((r) => r.provider > 0).length,
  other: unexplained.filter((r) => r.provider === 0).map((r) => r.id) }));

const classes = analysisClasses(JSON.parse(readFileSync(join(RUN, 'codebook.json'), 'utf8')));
const classIds = [...classes.map((c) => c.id), ...(classes.some((c) => c.id === GRADED_BEFORE_FIX) ? [] : [GRADED_BEFORE_FIX]), OTHER, UNLABELLED];
const regrade = loadRegrade(join(RUN, 'corpus/regrade.jsonl'), manifest);
const trees = taskTrees(JSON.parse(readFileSync(join(RUN, 'corpus/runs.json'), 'utf8')));
const counter = new Map(rows.map((r) => [r.id, r]));
const reading = (name: string, relabel: (id: string, rc: string | null | undefined) => string | null | undefined) => {
  const lines = new Map([...labels.lines].map(([id, l]) => [id, { ...l, root_cause: relabel(id, l.root_cause) }]));
  const units: Unit[] = gbrainPairs(trialsOf(manifest, trees, lines as typeof labels.lines, new Map(), new Map(regrade.map((r) => [r.trial_id, r])))).flatMap((p) => p.units);
  const res = pooledTests(units, classes, classIds, 'main');
  const pick = (c: string) => { const r = res.find((x) => x.class === c)!; return { delta: r.delta, ci95: r.ci95, p_holm: r.p_holm, units: r.units }; };
  console.log(JSON.stringify({ reading: name, unscoped_brain_search: pick(UNSCOPED), retrieval_any: pick('retrieval_any') }));
};
reading('as published', (_, rc) => rc);
reading('counter only', (id, rc) => { const c = counter.get(id); if (!c) return rc; if (c.model > 0) return UNSCOPED; if (rc === UNSCOPED) return c.provider > 0 ? INJECTED : OTHER; return rc; });
reading('QM provider reads moved out', (id, rc) => (rc === UNSCOPED && (counter.get(id)?.provider ?? 0) > 0 && (counter.get(id)?.model ?? 0) === 0 ? INJECTED : rc));
