#!/usr/bin/env bun
// internal-task-a Amendment 3: the exposure rate (internal-task-b), a reported outcome next to the forced-arm comparison. The frozen
// analysis is unchanged; this report script reads turns.jsonl only.
//
//   bun harnesses/qm/gstack/exposure-rate.ts --turns <merged turns.jsonl> [--out <json>]
//
// Per model: of the counted edition trials (the first record of each (model, arm, task, rep), or its one rerun after an
// infra_error, as edition-analysis.ts counts them; model_error and infra_error excluded), the share in which open_matched,
// complete_read and first_step are all true, with a 95 percent task-clustered bootstrap interval (tasks resampled with
// replacement, 10,000 draws, seed 7, percentile interval). Per family as a labelled secondary. A model whose upper bound is
// below 10 percent gets the preregistered "Why null?" exposure line.
import { readFileSync, writeFileSync } from 'node:fs';
import { DRAWS, EXCLUDED_STATUSES, MODELS, SEED, type TurnRecord } from './edition-analysis.ts';
import { seededRandom } from '../../../runner/stats/paired.ts';

export const NEAR_ZERO_UPPER = 0.1;
const NAMES: Record<string, string> = { 'anthropic:claude-opus-5-5': 'Opus 5.5', 'openai:gpt-6.1-sol': 'GPT-6.1 Sol' };

export function countedEdition(turns: TurnRecord[]): TurnRecord[] {
  const first = new Map<string, TurnRecord>(), counted = new Map<string, TurnRecord>();
  for (const t of turns) {
    const k = [t.model, t.arm, t.task_id, t.rep].join('|');
    const head = first.get(k);
    if (!head) { first.set(k, t); counted.set(k, t); continue; }
    if (counted.get(k) === head && head.status === 'infra_error') counted.set(k, t);
  }
  return [...counted.values()].filter((t) => t.arm === 'edition' && !EXCLUDED_STATUSES.includes(t.status));
}

export const exposed = (t: TurnRecord) => t.counts?.open_matched === true && t.counts?.complete_read === true && t.counts?.first_step === true;

export function clusteredRate(trials: TurnRecord[], draws = DRAWS, seed = SEED) {
  const byTask = new Map<string, { k: number; n: number }>();
  for (const t of trials) { const c = byTask.get(t.task_id) ?? { k: 0, n: 0 }; c.n++; if (exposed(t)) c.k++; byTask.set(t.task_id, c); }
  const tasks = [...byTask.keys()].sort(), cells = tasks.map((t) => byTask.get(t)!);
  const k = cells.reduce((s, c) => s + c.k, 0), n = cells.reduce((s, c) => s + c.n, 0);
  if (!n) return { k, n, tasks: 0, rate: null, ci95: null };
  const rand = seededRandom(seed), rates: number[] = [];
  for (let d = 0; d < draws; d++) {
    let dk = 0, dn = 0;
    for (let i = 0; i < cells.length; i++) { const c = cells[Math.floor(rand() * cells.length)]!; dk += c.k; dn += c.n; }
    rates.push(dk / dn);
  }
  rates.sort((a, b) => a - b);
  return { k, n, tasks: tasks.length, rate: k / n, ci95: [rates[Math.floor(0.025 * draws)]!, rates[Math.min(draws - 1, Math.ceil(0.975 * draws) - 1)]!] as [number, number] };
}

const pct = (x: number) => (Math.round(x * 1000) / 10).toString();
export function exposureRate(turns: TurnRecord[]) {
  const edition = countedEdition(turns);
  const models = Object.fromEntries(MODELS.map((m) => {
    const ts = edition.filter((t) => t.model === m), all = clusteredRate(ts);
    const families = Object.fromEntries([...new Set(ts.map((t) => t.family))].sort().map((f) => [f, clusteredRate(ts.filter((t) => t.family === f))]));
    const nearZero = all.ci95 !== null && all.ci95[1] < NEAR_ZERO_UPPER;
    const line = nearZero ? 'Exposure: the edition reached ' + NAMES[m] + ' in ' + all.k + ' of ' + all.n + ' edition trials (' + pct(all.rate!) + ' percent, 95 percent CI ' + pct(all.ci95![0]) + ' to ' + pct(all.ci95![1]) + '), so its edition-minus-plain estimate measures an edition it did not use. Whether the skill helps when it is read is answered by forced minus plain on ' + NAMES[m] + ' (descriptive).' : null;
    return [m, { ...all, families, near_zero: nearZero, why_null_line: line }];
  }));
  return { definition: 'open_matched && complete_read && first_step, counted edition trials', bootstrap: { clusters: 'task', draws: DRAWS, seed: SEED, interval: 'percentile 95' }, models };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const turnsPath = flag('--turns');
  if (!turnsPath) { console.error('usage: bun harnesses/qm/gstack/exposure-rate.ts --turns <turns.jsonl> [--out <json>]'); process.exit(2); }
  const turns = readFileSync(turnsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as TurnRecord);
  const r = exposureRate(turns);
  const text = JSON.stringify(r, null, 2) + '\n';
  if (flag('--out')) writeFileSync(flag('--out')!, text);
  process.stdout.write(text);
}
