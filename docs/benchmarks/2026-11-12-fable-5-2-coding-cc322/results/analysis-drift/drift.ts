#!/usr/bin/env bun
// The cross-run lines of fable-5-2-coding-cc322-2026-11 (descriptive, never pooled): each arm's paired per-task change from
// the Claude Code 2.1.312 run (fable-5-2-coding-2026-11) to this 2.1.322 run on the same 52 tasks, and the Fable 5.2 change
// minus the Opus 5.5 change and minus the Fable 5.1 change. A task's arm value is its pass share over its scored attempts
// (scripts/matrix-analysis.ts trialValue); the interval is runner/stats/paired.ts clusteredPairedDelta, one pair per task,
// seed 20261109, 10,000 draws, as compare-models.ts uses. The 2.1.312 input is that run's headline analysis input,
// results/analysis-full-nostop/trials-full-nostop.jsonl, checked against the sha256 the preregistration names.
//
//   bun docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/results/analysis-drift/drift.ts
//
// Run from the repository root. Writes drift.json beside this file.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta } from '../../../../../runner/stats/paired.ts';
import { trialValue } from '../../../../../scripts/matrix-analysis.ts';
import type { TrialRecord } from '../../../../../runner/contracts.ts';

const THEN = 'docs/benchmarks/2026-11-09-fable-5-2-coding/results/analysis-full-nostop/trials-full-nostop.jsonl';
const THEN_SHA = '01150a8c36517c8a7552e07efcdcc81494d7bcf31d478a017c6731224d3816ba';
const NOW = 'docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/results/merged/trials.jsonl';
const OPTS = { seed: 20261109, draws: 10000 };
const ARMS = ['fable52', 'fable51', 'opus55'] as const;

const raw = readFileSync(THEN);
if (createHash('sha256').update(raw).digest('hex') !== THEN_SHA) throw new Error(THEN + ' does not match the preregistered sha256');
const values = (text: string) => {
  const by = new Map<string, number[]>();
  for (const line of text.split('\n').filter(Boolean)) {
    const t = JSON.parse(line) as TrialRecord;
    const v = trialValue(t);
    if (v === null) continue;
    const key = t.cell.split('-')[0] + '/' + t.task;
    by.set(key, [...(by.get(key) ?? []), v]);
  }
  return new Map([...by].map(([k, v]) => [k, v.reduce((s, x) => s + x, 0) / v.length]));
};
const then = values(raw.toString('utf8'));
const now = values(readFileSync(NOW, 'utf8'));
const tasks = [...new Set([...now.keys()].map((k) => k.split('/')[1]!))].sort();
const round = (x: number) => Math.round(x * 1000) / 10;
const summary = (d: ReturnType<typeof clusteredPairedDelta>, n: number) => ({ tasks: n, then_points: round(d.mean_a), now_points: round(d.mean_b), change_points: round(d.delta), ci95_points: d.ci95 ? d.ci95.map(round) : null });

const change: Record<string, ReturnType<typeof summary>> = {};
for (const arm of ARMS) {
  const pairs = tasks.filter((t) => then.has(arm + '/' + t) && now.has(arm + '/' + t)).map((t) => ({ id: t, cluster: t, a: then.get(arm + '/' + t)!, b: now.get(arm + '/' + t)! }));
  change[arm] = summary(clusteredPairedDelta(pairs, OPTS), pairs.length);
}
const did: Record<string, ReturnType<typeof summary>> = {};
for (const other of ['opus55', 'fable51'] as const) {
  const ok = (t: string) => ['fable52', other].every((a) => then.has(a + '/' + t) && now.has(a + '/' + t));
  const pairs = tasks.filter(ok).map((t) => ({ id: t, cluster: t, a: now.get(other + '/' + t)! - then.get(other + '/' + t)!, b: now.get('fable52/' + t)! - then.get('fable52/' + t)! }));
  did['fable52 change minus ' + other + ' change'] = summary(clusteredPairedDelta(pairs, OPTS), pairs.length);
}
const out = { note: 'Descriptive cross-run lines: different dates and different Claude Code versions (2.1.312 then, 2.1.322 now), never pooled and never confirmatory. For the difference-in-differences lines, then_points and now_points are the mean changes of the comparator and of Fable 5.2.', then: THEN, then_sha256: THEN_SHA, now: NOW, options: OPTS, per_arm_change: change, difference_in_differences: did };
writeFileSync(join(import.meta.dir, 'drift.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out));
