// The cost, cache and task endpoints of compare-run.ts --baseline (harness-zero-select-2026-11, loop file "Keep rule" and
// "Switches without an ablation cell"). compare-run.ts pairs each baseline with each other cell on its model and calls
// pairEndpoints on the pairs its pass-rate comparison kept, so every endpoint here reads the same pairs (same task and
// repetition, a model_error, infra_error or exam_fault or a missing trial on either side already excluded). It calls
// repricing once per baseline cell. Nothing here decides a verdict; it computes the inputs the verdict rules read.
//
// Per pair, B minus or over the baseline A:
// - usd_per_trial: the paired difference of each trial's proxy-priced spend (usage.usd), clusteredPairedDelta from the
//   run's statistics kit, as for pass rate.
// - usd_per_trial_ratio: total spend of B over total spend of A on the same pairs.
// - usd_per_success: each side's total spend over its passes, and B's over A's.
// - cached_share: each side's cached input tokens over its input tokens (usage.cached_tokens over usage.input_tokens; the
//   proxy's input_tokens include cache reads and writes), and B minus A.
// - tasks: broken and fixed tasks (R2). A task is broken when it passes in more than half of its paired repetitions in A
//   and in at most half in B, and fixed in the reverse case: 3 of 5 against at most 2 of 5 at five repetitions, 2 of 3
//   against at most 1 of 3 at three. A task with an excluded pair is judged on the pairs it kept.
// A pair whose trial has no usage record on either side leaves the cost and cache endpoints (not the task counts), listed
// under cost_excluded.
//
// Ratio intervals (clusteredRatio): a task-clustered percentile bootstrap. Each draw resamples the tasks with replacement,
// sums each side's numerator and denominator over the drawn tasks' pairs, and recomputes the ratio. It uses the kit's
// seededRandom with the same seed, draw count, task order and draw sequence as clusteredPairedDelta, so when both read the
// same tasks each draw resamples the same tasks as the pass-rate interval's draw. A draw whose ratio is undefined (a zero
// denominator, such as no pass on one side of a cost-per-success draw) is counted, and any such draw leaves the interval
// null with the count, never dropped.
//
// Repricing (caching on the baseline cell): every forwarded proxy line of the cell's scored trials is priced again with
// every input token at the plain input rate and output at the output rate, at the metering ledger's price for the line's
// model (chatPrice, long-prompt tier by the line's input tokens as the ledger bills it). Repriced over actual
// (the lines' actual_usd) is the no-caching cost ratio, with the same task-clustered interval. The lines come from every
// proxy-usage ndjson file beside trials.jsonl (one per shard after merge-shards.ts), matched by the trial's meter key; a
// trial whose forwarded lines do not add up to its usage record's input, output and cached tokens, or with a line that has
// no actual_usd or no price, is excluded with its reason. A line the proxy charged its reservation (a forwarded answer with
// no or partial usage, or a failed upstream call) costs what the meter charged whatever caching does, so its actual_usd is
// added to both actual and repriced, and the cell counts those lines and their spend. The cache-read share is split by the
// gap since the trial's previous forwarded request: the first request, a gap of at most 300 seconds (the 5-minute cache TTL),
// and a longer gap.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import type { PairedDelta, PairedItem } from '../runner/stats/paired.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';
import { chatPrice } from '../runner/ledger/budget-ledger.ts';

export interface Kit {
  clusteredPairedDelta: (pairs: readonly PairedItem[], options: { seed: number; draws: number }) => PairedDelta;
  seededRandom: (seed: number) => () => number;
}
export interface Options { seed: number; draws: number }
export interface ClusteredRatio { estimate: number | null; ci95: [number, number] | null; n_items: number; n_clusters: number; undefined_draws: number; note?: string }
export interface TrialPair { id: string; task: string; a: TrialRecord; b: TrialRecord }

export const TTL_SECONDS = 300;

export function clusteredRatio(items: ReadonlyArray<{ cluster: string; x: number[] }>, stat: (sums: number[]) => number, kit: Kit, o: Options): ClusteredRatio {
  const width = items[0]?.x.length ?? 0;
  const add = (s: number[], x: number[]) => { for (let k = 0; k < width; k++) s[k]! += x[k]!; };
  const byCluster = new Map<string, number[]>();
  for (const it of items) { const s = byCluster.get(it.cluster) ?? new Array<number>(width).fill(0); add(s, it.x); byCluster.set(it.cluster, s); }
  const clusters = [...byCluster.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, s]) => s);
  const g = clusters.length;
  const total = new Array<number>(width).fill(0);
  for (const s of clusters) add(total, s);
  const point = items.length ? stat(total) : NaN;
  const base = { estimate: Number.isFinite(point) ? point : null, n_items: items.length, n_clusters: g };
  if (g < 2) return { ...base, ci95: null, undefined_draws: 0, note: `${g} task cluster(s): no interval` };
  const rng = kit.seededRandom(o.seed);
  const boot: number[] = [];
  let undefinedDraws = 0;
  for (let i = 0; i < o.draws; i++) {
    const s = new Array<number>(width).fill(0);
    for (let j = 0; j < g; j++) add(s, clusters[Math.floor(rng() * g)]!);
    const v = stat(s);
    if (Number.isFinite(v)) boot.push(v); else undefinedDraws++;
  }
  if (undefinedDraws) return { ...base, ci95: null, undefined_draws: undefinedDraws, note: `${undefinedDraws} of ${o.draws} draws had an undefined ratio (a zero denominator), so no interval` };
  boot.sort((x, y) => x - y);
  return { ...base, ci95: [boot[Math.floor(o.draws * 0.025)]!, boot[Math.ceil(o.draws * 0.975) - 1]!], undefined_draws: 0 };
}

const ratio = (num: number, den: number) => (den === 0 ? NaN : num / den);

export function pairEndpoints(pairs: readonly TrialPair[], pass: (t: TrialRecord) => number, kit: Kit, o: Options) {
  const usd = (t: TrialRecord) => (typeof t.usage?.usd === 'number' && Number.isFinite(t.usage.usd) ? t.usage.usd : null);
  const costExcluded: Array<{ id: string; reason: string }> = [];
  const costPairs = pairs.filter((p) => {
    const reason = usd(p.a) === null ? 'no usage in ' + p.a.cell : usd(p.b) === null ? 'no usage in ' + p.b.cell : null;
    if (reason) costExcluded.push({ id: p.id, reason });
    return !reason;
  });
  const sum = (f: (p: TrialPair) => number) => costPairs.reduce((s, p) => s + f(p), 0);
  const spend = { a: sum((p) => usd(p.a)!), b: sum((p) => usd(p.b)!) };
  const passes = { a: sum((p) => pass(p.a)), b: sum((p) => pass(p.b)) };
  const tokens = (t: TrialRecord) => ({ input: t.usage!.input_tokens, cached: t.usage!.cached_tokens });
  const input = { a: sum((p) => tokens(p.a).input), b: sum((p) => tokens(p.b).input) };
  const cached = { a: sum((p) => tokens(p.a).cached), b: sum((p) => tokens(p.b).cached) };
  const delta = costPairs.length ? kit.clusteredPairedDelta(costPairs.map((p) => ({ id: p.id, cluster: p.task, a: usd(p.a)!, b: usd(p.b)! })), o) : null;
  const items = (x: (p: TrialPair) => number[]) => costPairs.map((p) => ({ cluster: p.task, x: x(p) }));

  const byTask = new Map<string, { pairs: number; a: number; b: number }>();
  for (const p of pairs) { const c = byTask.get(p.task) ?? { pairs: 0, a: 0, b: 0 }; c.pairs++; c.a += pass(p.a); c.b += pass(p.b); byTask.set(p.task, c); }
  const perTask = [...byTask.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([task, c]) => {
    const major = (k: number) => 2 * k > c.pairs;
    return { task, pairs: c.pairs, passes_a: c.a, passes_b: c.b, status: major(c.a) && !major(c.b) ? 'broken' as const : !major(c.a) && major(c.b) ? 'fixed' as const : 'same' as const };
  });

  return {
    cost_pairs: costPairs.length,
    cost_excluded: costExcluded,
    usd_per_trial: delta
      ? { mean_a: delta.mean_a, mean_b: delta.mean_b, delta: delta.delta, ci95: delta.ci95, p: delta.p_two_sided, p_method: delta.p_method, n_pairs: delta.n_pairs, n_clusters: delta.n_clusters }
      : null,
    usd_per_trial_ratio: clusteredRatio(items((p) => [usd(p.a)!, usd(p.b)!]), (s) => ratio(s[1]!, s[0]!), kit, o),
    usd_per_success: {
      usd: spend, passes, a: passes.a ? spend.a / passes.a : null, b: passes.b ? spend.b / passes.b : null,
      ratio: clusteredRatio(items((p) => [usd(p.a)!, pass(p.a), usd(p.b)!, pass(p.b)]), (s) => ratio(ratio(s[2]!, s[3]!), ratio(s[0]!, s[1]!)), kit, o),
    },
    cached_share: {
      input_tokens: input, cached_tokens: cached, a: input.a ? cached.a / input.a : null, b: input.b ? cached.b / input.b : null,
      difference: clusteredRatio(items((p) => [tokens(p.a).cached, tokens(p.a).input, tokens(p.b).cached, tokens(p.b).input]), (s) => ratio(s[2]!, s[3]!) - ratio(s[0]!, s[1]!), kit, o),
    },
    tasks: {
      rule: "broken: passes in more than half of the task's paired repetitions in A and in at most half in B; fixed: the reverse",
      broken: perTask.filter((t) => t.status === 'broken').map((t) => t.task),
      fixed: perTask.filter((t) => t.status === 'fixed').map((t) => t.task),
      per_task: perTask,
    },
  };
}

/** Every proxy usage line beside trials.jsonl: proxy-usage.ndjson, and each shard's copy as merge-shards.ts names it. */
export function readUsageLines(results: string): { files: string[]; lines: UsageLine[] } {
  const files = existsSync(results) ? readdirSync(results).filter((f) => /proxy-usage.*\.ndjson$/.test(f)).sort() : [];
  const lines = files.flatMap((f) => readFileSync(join(results, f), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as UsageLine]; } catch { return []; } }));
  return { files, lines };
}

const GAP_BUCKETS = ['first request', 'gap <= ' + TTL_SECONDS + ' s', 'gap > ' + TTL_SECONDS + ' s'] as const;

export function repricing(cell: string, trials: readonly TrialRecord[], excludedTerminations: ReadonlySet<string>, usage: { files: string[]; lines: UsageLine[] }, kit: Kit, o: Options) {
  const excluded: Array<{ id: string; reason: string }> = [];
  if (!usage.files.length) return { cell, usage_files: [], note: 'no proxy-usage ndjson file beside trials.jsonl, so no repricing', trials: 0, excluded, actual_usd: null, repriced_usd: null, charged_reservation: null, actual_per_trial: null, repriced_per_trial: null, ratio: null, cache_by_gap: [] };
  const byKey = new Map<string, UsageLine[]>();
  for (const l of usage.lines) if ((l.outcome === 'forwarded' || l.outcome === 'failed') && l.route !== '/v1/embeddings') byKey.set(l.key, [...(byKey.get(l.key) ?? []), l]);
  const rows: Array<{ task: string; actual: number; repriced: number; lines: UsageLine[] }> = [];
  const charged = { lines: 0, usd: 0 };
  for (const t of trials) {
    const id = t.trial_id;
    if (excludedTerminations.has(t.termination)) { excluded.push({ id, reason: t.termination }); continue; }
    if (!t.usage) { excluded.push({ id, reason: 'no usage record' }); continue; }
    const metered = [t.usage.meter_id, 'trial-token:' + id, 'sk-trial-' + id].map((k) => byKey.get(k)).find((ls) => ls?.length) ?? [];
    const lines = metered.filter((l) => l.outcome === 'forwarded');
    const total = (f: (l: UsageLine) => number | undefined) => lines.reduce((s, l) => s + (f(l) ?? 0), 0);
    if (total((l) => l.input_tokens) !== t.usage.input_tokens || total((l) => l.output_tokens) !== t.usage.output_tokens || total((l) => l.cached_tokens) !== t.usage.cached_tokens) {
      excluded.push({ id, reason: 'its ' + lines.length + " forwarded proxy line(s) do not add up to the trial's usage tokens" });
      continue;
    }
    let repriced = 0, actual = 0, chargedLines = 0, chargedUsd = 0, problem: string | null = null;
    for (const l of metered) {
      if (typeof l.actual_usd !== 'number') { problem = 'a forwarded or failed line has no actual_usd'; break; }
      if (l.charged_reservation) { chargedLines++; chargedUsd += l.actual_usd; continue; }
      if (l.outcome !== 'forwarded') continue;
      const price = chatPrice(l.provider + ':' + l.model);
      if (!price) { problem = 'no price for ' + l.provider + ':' + l.model; break; }
      const inTokens = l.input_tokens ?? 0;
      const rates = price.long && inTokens > price.long.above_input_tokens ? price.long : price;
      repriced += (inTokens * rates.input + (l.output_tokens ?? 0) * rates.output) / 1e6;
      actual += l.actual_usd;
    }
    if (problem) { excluded.push({ id, reason: problem }); continue; }
    charged.lines += chargedLines; charged.usd += chargedUsd;
    rows.push({ task: t.task, actual: actual + chargedUsd, repriced: repriced + chargedUsd, lines });
  }
  const buckets = new Map(GAP_BUCKETS.map((b) => [b as string, { requests: 0, input_tokens: 0, cached_tokens: 0, cache_write_tokens: 0 }]));
  for (const r of rows) {
    const sorted = [...r.lines].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    sorted.forEach((l, i) => {
      const gap = i === 0 ? null : (Date.parse(l.at) - Date.parse(sorted[i - 1]!.at)) / 1000;
      const b = buckets.get(gap === null ? GAP_BUCKETS[0] : gap <= TTL_SECONDS ? GAP_BUCKETS[1] : GAP_BUCKETS[2])!;
      b.requests++; b.input_tokens += l.input_tokens ?? 0; b.cached_tokens += l.cached_tokens ?? 0; b.cache_write_tokens += l.cache_write_tokens ?? 0;
    });
  }
  const actual = rows.reduce((s, r) => s + r.actual, 0), repriced = rows.reduce((s, r) => s + r.repriced, 0);
  return {
    cell, usage_files: usage.files, trials: rows.length, excluded,
    actual_usd: actual, repriced_usd: repriced, charged_reservation: charged,
    actual_per_trial: rows.length ? actual / rows.length : null, repriced_per_trial: rows.length ? repriced / rows.length : null,
    ratio: clusteredRatio(rows.map((r) => ({ cluster: r.task, x: [r.actual, r.repriced] })), (s) => ratio(s[1]!, s[0]!), kit, o),
    cache_by_gap: [...buckets.entries()].map(([bucket, b]) => ({ bucket, ...b, cached_share: b.input_tokens ? b.cached_tokens / b.input_tokens : null })),
  };
}
