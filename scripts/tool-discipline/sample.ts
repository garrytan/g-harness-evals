#!/usr/bin/env bun
// internal-task tool discipline, step 4: draw the hand-check sample and write a blind labels template.
//
//   bun scripts/tool-discipline/sample.ts --rows <rows.ndjson> --labels <labels.ndjson> --trials <trials.ndjson> --out <dir>
//     [--random 50] [--seed 18]                          -> <dir>/sample.jsonl (the key), <dir>/labels-template.jsonl (blind)
//
// Strata, per source, over model calls (normalize.ts call_class "model"):
//   positive   every row with a true label for any call kind                                    inclusion probability 1
//   near_miss  every other row with an unknown label, a non-ok outcome, "not found" or "unknown"
//              in its error or result text, a skills_* / skill tool name, or a gstack helper
//              mentioned in its arguments                                                       inclusion probability 1
//   random     a simple random draw of --random rows from the rest, seeded                       --random / rest
// and per trial, for skipped_start:
//   positive   every trial with skipped_start true                                               1
//   near_miss  every other trial that read a gstack SKILL.md, and every trial with no read whose
//              calls mention gstack (where a missed read would hide)                             1
// sample.jsonl holds each item's stratum, inclusion probability and classifier labels. labels-template.jsonl holds the
// evidence and blank label fields only, shuffled with the same seed, so a labeller cannot see stratum or classifier output.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '../../runner/stats/paired.ts';
import { CALL_KINDS, readNdjson, type RowLabels, type TrialSummary } from './classify.ts';
import type { CallRow } from './normalize.ts';

export interface SampleItem { item_id: string; item_type: 'call' | 'trial'; source: string; stratum: 'positive' | 'near_miss' | 'random'; inclusion_probability: number; stratum_population: number; locator: string | null; trial: string; sha256: string | null; classifier: Record<string, unknown> }

const GSTACK_HINT = /gstack-skill|GSTACK_ROOT|GSTACK_BIN|\/opt\/gstack|gstack\/bin/;
const NEAR_TEXT = /not found|unknown/i;

export function nearMiss(r: CallRow, l: RowLabels): boolean {
  if (CALL_KINDS.some(k => l.labels[k] === 'unknown')) return true;
  if (r.outcome !== 'ok') return true;
  if (NEAR_TEXT.test((r.error ?? '') + ' ' + (r.result_text ?? ''))) return true;
  if (/^skills?_|^skill$/.test(r.tool)) return true;
  return GSTACK_HINT.test(typeof r.args === 'string' ? r.args : JSON.stringify(r.args ?? ''));
}

/** k items drawn without replacement, seeded (partial Fisher-Yates). */
export function draw<T>(xs: T[], k: number, seed: number): T[] {
  const a = xs.slice(), rnd = seededRandom(seed);
  const m = Math.min(k, a.length);
  for (let i = 0; i < m; i++) { const j = i + Math.floor(rnd() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, m);
}

export function drawSample(rows: CallRow[], labels: RowLabels[], trials: TrialSummary[], random = 50, seed = 18): { items: SampleItem[]; template: Record<string, unknown>[] } {
  const items: SampleItem[] = [];
  const template: Record<string, unknown>[] = [];
  const blank = Object.fromEntries(CALL_KINDS.map(k => [k, null]));
  const callItem = (r: CallRow, l: RowLabels, stratum: SampleItem['stratum'], p: number, pop: number) => {
    const item_id = 'call:' + r.locator;
    items.push({ item_id, item_type: 'call', source: r.source, stratum, inclusion_probability: p, stratum_population: pop, locator: r.locator, trial: r.trial, sha256: r.sha256, classifier: { ...l.labels } });
    template.push({ item_id, item_type: 'call', source: r.source, harness: r.harness, model: r.model, tool: r.tool, via: r.via, args: r.args, outcome: r.outcome, exit: r.exit, error: r.error, effect: r.effect, result_text: r.result_text, clipped: r.clipped, result_clipped: r.result_clipped, locator: r.locator, sha256: r.sha256, label: { ...blank }, labeller: null, notes: null });
  };
  const bySource = new Map<string, Array<[CallRow, RowLabels]>>();
  rows.forEach((r, i) => {
    const l = labels[i];
    if (l.locator !== r.locator) throw new Error('labels do not line up with rows at ' + i + ': ' + l.locator + ' vs ' + r.locator);
    if (r.call_class !== 'model') return;
    bySource.set(r.source, [...(bySource.get(r.source) ?? []), [r, l]]);
  });
  for (const [source, pairs] of [...bySource.entries()].sort()) {
    const pos = pairs.filter(([, l]) => CALL_KINDS.some(k => l.labels[k] === true));
    const near = pairs.filter(([r, l]) => !CALL_KINDS.some(k => l.labels[k] === true) && nearMiss(r, l));
    const taken = new Set([...pos, ...near].map(([r]) => r.locator));
    const rest = pairs.filter(([r]) => !taken.has(r.locator));
    for (const [r, l] of pos) callItem(r, l, 'positive', 1, pos.length);
    for (const [r, l] of near) callItem(r, l, 'near_miss', 1, near.length);
    for (const [r, l] of draw(rest, random, seed)) callItem(r, l, 'random', rest.length ? Math.min(1, random / rest.length) : 0, rest.length);
    const mentions = new Set(pairs.filter(([r]) => GSTACK_HINT.test(JSON.stringify(r.args ?? '')) || /gstack/i.test(JSON.stringify(r.args ?? ''))).map(([r]) => r.trial));
    const ts = trials.filter(t => t.source === source && t.skill_md_read !== null);
    const tpos = ts.filter(t => t.skipped_start === true);
    const tnear = ts.filter(t => t.skipped_start !== true && (t.skill_md_read || mentions.has(t.trial)));
    const calls = new Map<string, CallRow[]>();
    for (const [r] of pairs) calls.set(r.trial, [...(calls.get(r.trial) ?? []), r]);
    for (const [stratum, list] of [['positive', tpos], ['near_miss', tnear]] as const) for (const t of list) {
      const item_id = 'trial:' + t.trial;
      items.push({ item_id, item_type: 'trial', source, stratum, inclusion_probability: 1, stratum_population: list.length, locator: t.skill_read_locator, trial: t.trial, sha256: null, classifier: { skill_md_read: t.skill_md_read, start_attempt: t.start_attempt, skipped_start: t.skipped_start } });
      template.push({ item_id, item_type: 'trial', source, harness: t.harness, model: t.model, trial: t.trial, task: t.task, arm: t.arm,
        calls: (calls.get(t.trial) ?? []).map(r => ({ locator: r.locator, tool: r.tool, args: r.args, outcome: r.outcome, result_text: r.result_text, clipped: r.clipped })),
        label: { skill_md_read: null, start_attempt: null, skipped_start: null }, labeller: null, notes: null });
    }
  }
  return { items, template: draw(template, template.length, seed) };
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const rowsPath = arg('--rows'), labelsPath = arg('--labels'), trialsPath = arg('--trials'), out = arg('--out');
  if (!rowsPath || !labelsPath || !trialsPath || !out) { process.stderr.write('usage: sample.ts --rows <f> --labels <f> --trials <f> --out <dir> [--random 50] [--seed 18]\n'); process.exit(2); }
  const { items, template } = drawSample(readNdjson<CallRow>(rowsPath), readNdjson<RowLabels>(labelsPath), readNdjson<TrialSummary>(trialsPath), Number(arg('--random') ?? 50), Number(arg('--seed') ?? 18));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'sample.jsonl'), items.map(i => JSON.stringify(i)).join('\n') + '\n');
  writeFileSync(join(out, 'labels-template.jsonl'), template.map(t => JSON.stringify(t)).join('\n') + '\n');
  const tally = new Map<string, number>();
  for (const i of items) tally.set([i.source, i.item_type, i.stratum].join(' '), (tally.get([i.source, i.item_type, i.stratum].join(' ')) ?? 0) + 1);
  process.stderr.write('sample: ' + items.length + ' items\n' + [...tally].map(([k, n]) => '  ' + k + ' ' + n).join('\n') + '\n');
}
