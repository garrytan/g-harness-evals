#!/usr/bin/env bun
// internal-task tool discipline, step 3: rates per source x harness x model x kind, with two intervals each.
//
//   bun scripts/tool-discipline/rates.ts --labels <labels.ndjson> --trials <trials.ndjson> --out <dir>   -> rates.md, rates.json
//
// Denominators: model calls (normalize.ts call_class "model") for the five call kinds; opportunities (trials that read a gstack
// SKILL.md, classify.ts skill_md_read) for skipped_start. Trials ending model_error, infra_error, exam_fault, infra:* or
// not_run:* are excluded with their count (methodology item 9). k counts true labels; "unknown" labels are counted apart and never in k, so k/n is a
// lower bound when unknown > 0, and (k + unknown)/n the matching upper bound.
// Intervals: Wilson 95% (scripts/gsta-135/report.ts wilson), and a task-clustered bootstrap of the pooled share: resample the
// group's tasks with replacement, 2,000 draws, seed 18 (runner/stats/paired.ts seededRandom), 2.5th and 97.5th percentiles.
// A group with fewer than 5 tasks gets the bootstrap printed but flagged: three clusters (the internal-task panels) cannot carry it.
// Coverage says, per source and kind, whether the source can see the kind at all.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '../../runner/stats/paired.ts';
import { wilson } from '../gsta-135/report.ts';
import { CALL_KINDS, readNdjson, type RowLabels, type TrialSummary } from './classify.ts';

export const KINDS = [...CALL_KINDS, 'skipped_start'] as const;
export type Kind = typeof KINDS[number];
export const EXCLUDED_TERMINATIONS = ['model_error', 'infra_error', 'exam_fault'];
export const DRAWS = 2000;
export const SEED = 18;

export const COVERAGE: Record<string, Record<Kind, { level: 'full' | 'partial' | 'none'; note: string }>> = {
  events: {
    phantom_tool: { level: 'none', note: 'a call to a tool the harness does not offer never reaches the world or gbrain log' },
    malformed_args: { level: 'partial', note: 'gbrain invalid_params only; world-MCP rejects bad arguments with zod before the logging handler' },
    wrong_identifier: { level: 'full', note: 'world *_not_found / unknown_recipient and gbrain page_not_found, for calls that reach the handler' },
    denied: { level: 'full', note: 'world and gbrain scope refusals' },
    mangled_helper: { level: 'none', note: 'no shell commands in the world log' },
    skipped_start: { level: 'none', note: 'no file or skill reads in the world log' },
  },
  gsta135: {
    phantom_tool: { level: 'full', note: 'harness reply text, clipped at 120 characters' },
    malformed_args: { level: 'partial', note: 'reply text clipped at 120 characters' },
    wrong_identifier: { level: 'partial', note: 'reply text clipped at 120 characters; no world tools in these tasks' },
    denied: { level: 'partial', note: 'reply text clipped at 120 characters' },
    mangled_helper: { level: 'partial', note: 'commands clipped at 240 characters; the extractor exit_belongs verdict fills in' },
    skipped_start: { level: 'full', note: 'reads and helper runs both visible; clipped commands resolved by extractor events' },
  },
};

export interface Interval { lo: number; hi: number }
export interface RateRow {
  source: string; harness: string; model: string; kind: Kind; k: number; unknown: number; n: number; rate: number | null;
  wilson: Interval | null; bootstrap: Interval | null; tasks: number; bootstrap_note: string | null; coverage: string; coverage_note: string;
}

/** Task-clustered percentile bootstrap of sum(k)/sum(n). */
export function clusterBootstrap(clusters: Array<{ k: number; n: number }>, draws = DRAWS, seed = SEED): Interval | null {
  if (!clusters.length || clusters.every(c => c.n === 0)) return null;
  const rnd = seededRandom(seed);
  const stats: number[] = [];
  for (let d = 0; d < draws; d++) {
    let k = 0, n = 0;
    for (let i = 0; i < clusters.length; i++) { const c = clusters[Math.floor(rnd() * clusters.length)]; k += c.k; n += c.n; }
    if (n > 0) stats.push(k / n);
  }
  stats.sort((a, b) => a - b);
  const q = (p: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(p * (stats.length - 1))))];
  return { lo: q(0.025), hi: q(0.975) };
}

export function computeRates(labels: RowLabels[], trials: TrialSummary[]): { rows: RateRow[]; excluded_trials: number; patterns: Record<string, Array<{ pattern: string; count: number }>> } {
  const excluded = new Set(trials.filter(t => t.termination && (EXCLUDED_TERMINATIONS.includes(t.termination) || /^(infra:|not_run:)/.test(t.termination))).map(t => t.trial));
  type Acc = { k: number; u: number; n: number; byTask: Map<string, { k: number; n: number }> };
  const groups = new Map<string, Map<Kind, Acc>>();
  const acc = (key: string, kind: Kind) => {
    const g = groups.get(key) ?? new Map<Kind, Acc>();
    groups.set(key, g);
    const a = g.get(kind) ?? { k: 0, u: 0, n: 0, byTask: new Map() };
    g.set(kind, a);
    return a;
  };
  const add = (a: Acc, task: string, v: boolean | 'unknown') => {
    const c = a.byTask.get(task) ?? { k: 0, n: 0 };
    a.byTask.set(task, c);
    a.n++; c.n++;
    if (v === true) { a.k++; c.k++; } else if (v === 'unknown') a.u++;
  };
  for (const l of labels) {
    if (l.call_class !== 'model' || excluded.has(l.trial)) continue;
    const key = [l.source, l.harness, l.model].join('\u0000');
    for (const kind of CALL_KINDS) add(acc(key, kind), l.task, l.labels[kind]);
  }
  for (const t of trials) {
    if (excluded.has(t.trial)) continue;
    const key = [t.source, t.harness, t.model].join('\u0000');
    const a = acc(key, 'skipped_start');
    if (t.skill_md_read) add(a, t.task, t.skipped_start ?? false);
  }
  const rows: RateRow[] = [];
  for (const [key, g] of [...groups.entries()].sort()) {
    const [source, harness, model] = key.split('\u0000');
    for (const kind of KINDS) {
      const a = g.get(kind) ?? { k: 0, u: 0, n: 0, byTask: new Map() };
      const tasks = a.byTask.size;
      const cov = COVERAGE[source]?.[kind] ?? { level: 'none', note: 'unknown source' };
      rows.push({
        source, harness, model, kind, k: a.k, unknown: a.u, n: a.n, rate: a.n ? a.k / a.n : null,
        wilson: a.n ? wilson(a.k, a.n) : null, bootstrap: clusterBootstrap([...a.byTask.values()]), tasks,
        bootstrap_note: a.n && tasks < 5 ? 'only ' + tasks + ' task cluster(s): the bootstrap interval is not informative' : null,
        coverage: cov.level, coverage_note: cov.note,
      });
    }
  }
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].map(([pattern, n]) => ({ pattern, count: n })).sort((a, b) => b.count - a.count);
  const pos = (kind: typeof CALL_KINDS[number]) => labels.filter(l => l.call_class === 'model' && l.labels[kind] === true && !excluded.has(l.trial));
  return {
    rows, excluded_trials: excluded.size,
    patterns: {
      phantom_tool: count(pos('phantom_tool').map(l => l.harness + ' ' + l.tool)),
      wrong_identifier: count(pos('wrong_identifier').map(l => l.tool + ' ' + (l.reasons.wrong_identifier ?? ''))),
      malformed_args: count(pos('malformed_args').map(l => l.harness + ' ' + l.tool)),
      denied: count(pos('denied').map(l => l.tool + ' ' + (l.reasons.denied ?? ''))),
      mangled_helper: count(pos('mangled_helper').map(l => l.harness + ' ' + (l.reasons.mangled_helper ?? ''))),
    },
  };
}

const pct = (x: number) => (100 * x).toFixed(x > 0 && x < 0.001 ? 3 : 2) + '%';
const iv = (i: Interval | null) => i ? pct(i.lo) + ' to ' + pct(i.hi) : 'n/a';

export function markdown(r: ReturnType<typeof computeRates>): string {
  const head = '| source | harness | model | kind | k | unknown | n | rate | Wilson 95% | task bootstrap 95% | tasks | coverage |\n|---|---|---|---|---:|---:|---:|---:|---|---|---:|---|';
  const body = r.rows.map(x => '| ' + [x.source, x.harness, x.model, x.kind, x.k, x.unknown, x.n, x.rate === null ? 'n/a' : pct(x.rate), iv(x.wilson), iv(x.bootstrap) + (x.bootstrap_note ? ' (few tasks)' : ''), x.tasks, x.coverage === 'none' ? 'none: ' + x.coverage_note : x.coverage].join(' | ') + ' |');
  return ['# Tool discipline rates (internal-task, free mining, not hand-checked)', '',
    'Denominators: model calls for the five call kinds; trials that read a gstack SKILL.md for skipped_start. k excludes unknown labels, so k/n is a lower bound when unknown > 0. ' + r.excluded_trials + ' trials excluded for model_error, infra_error, exam_fault, infra:* or not_run:*. Bootstrap: tasks resampled, ' + DRAWS + ' draws, seed ' + SEED + '.', '',
    head, ...body, '', '## Coverage', '', '| source | kind | level | note |', '|---|---|---|---|',
    ...Object.entries(COVERAGE).flatMap(([s, ks]) => Object.entries(ks).map(([k, c]) => '| ' + [s, k, c.level, c.note].join(' | ') + ' |')), '',
    '## Most common patterns', '', ...Object.entries(r.patterns).flatMap(([k, ps]) => ['### ' + k, '', ...(ps.length ? ps.slice(0, 10).map(p => '- ' + p.count + ' x ' + p.pattern) : ['- none']), '']),
  ].join('\n');
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const labelsPath = arg('--labels'), trialsPath = arg('--trials'), out = arg('--out');
  if (!labelsPath || !trialsPath || !out) { process.stderr.write('usage: rates.ts --labels <labels.ndjson> --trials <trials.ndjson> --out <dir>\n'); process.exit(2); }
  const r = computeRates(readNdjson<RowLabels>(labelsPath), readNdjson<TrialSummary>(trialsPath));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'rates.json'), JSON.stringify({ draws: DRAWS, seed: SEED, excluded_terminations: EXCLUDED_TERMINATIONS, coverage: COVERAGE, ...r }, null, 2) + '\n');
  writeFileSync(join(out, 'rates.md'), markdown(r));
  process.stderr.write('wrote ' + r.rows.length + ' rate rows to ' + out + '\n');
}
