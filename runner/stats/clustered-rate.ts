// Our own addition, not vendored (internal-task, owner identity). A rate pooled over items that sit in clusters (facts in tasks):
// the pooled ratio sum(num) / sum(den), its design effect, and a 95% interval that stays honest near 0. At or above the rare
// cut the interval is a task-clustered percentile bootstrap of the ratio (whole clusters resampled); below it, where that
// bootstrap collapses at 0 or 1 events, it is a Wilson interval on the design-effect effective n (n / design effect), the
// cluster-aware interval the internal-task plan preregisters. The design effect is the cluster-robust variance of the ratio over
// its binomial variance, floored at 1; with no events (or all events) it cannot be estimated, and the caller's fallback is
// used, else the mean cluster size (every item in a cluster counted as one, so the effective n is the cluster count).

import { normalQuantile, seededRandom } from './paired.ts';

export interface ClusterCount { cluster: string; num: number; den: number }

export interface ClusteredRate {
  num: number;
  den: number;
  /** num / den; null when den is 0. */
  rate: number | null;
  ci95: [number, number] | null;
  method: 'bootstrap' | 'wilson-deff' | 'none';
  n_clusters: number;
  design_effect: number | null;
  design_effect_source: 'estimated' | 'fallback' | 'mean_cluster_size' | null;
  effective_n: number | null;
}

/** Wilson score interval for x successes in n trials (n may be fractional, an effective n). */
export function wilson(x: number, n: number, z = normalQuantile(0.975)): [number, number] | null {
  if (!(n > 0)) return null;
  const p = x / n, z2 = z * z, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Per-cluster sums, clusters sorted by id so a seeded bootstrap is reproducible whatever the input order. */
function byCluster(items: readonly ClusterCount[]): Array<{ num: number; den: number }> {
  const m = new Map<string, { num: number; den: number }>();
  for (const it of items) { const c = m.get(it.cluster) ?? { num: 0, den: 0 }; c.num += it.num; c.den += it.den; m.set(it.cluster, c); }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
}

export function clusteredRate(items: readonly ClusterCount[], o: { seed: number; draws: number; rare?: number; designEffectFallback?: number }): ClusteredRate {
  const clusters = byCluster(items).filter((c) => c.den > 0);
  const num = clusters.reduce((s, c) => s + c.num, 0), den = clusters.reduce((s, c) => s + c.den, 0), g = clusters.length;
  if (!den) return { num, den, rate: null, ci95: null, method: 'none', n_clusters: g, design_effect: null, design_effect_source: null, effective_n: null };
  const p = num / den;
  const varIid = (p * (1 - p)) / den;
  const varCluster = g > 1 ? (g / (g - 1)) * clusters.reduce((s, c) => s + (c.num - p * c.den) ** 2, 0) / (den * den) : null;
  let design_effect: number, design_effect_source: ClusteredRate['design_effect_source'];
  if (varCluster !== null && varIid > 0) { design_effect = Math.max(1, varCluster / varIid); design_effect_source = 'estimated'; }
  else if (o.designEffectFallback !== undefined) { design_effect = Math.max(1, o.designEffectFallback); design_effect_source = 'fallback'; }
  else { design_effect = Math.max(1, den / g); design_effect_source = 'mean_cluster_size'; }
  const effective_n = den / design_effect;
  const base = { num, den, rate: p, n_clusters: g, design_effect, design_effect_source, effective_n };
  if (p < (o.rare ?? 0.05)) return { ...base, ci95: wilson(p * effective_n, effective_n), method: 'wilson-deff' };
  if (g < 2) return { ...base, ci95: null, method: 'none' };
  const rng = seededRandom(o.seed);
  const boot: number[] = [];
  for (let i = 0; i < o.draws; i++) {
    let n = 0, d = 0;
    for (let j = 0; j < g; j++) { const c = clusters[Math.floor(rng() * g)]!; n += c.num; d += c.den; }
    boot.push(n / d);
  }
  boot.sort((a, b) => a - b);
  return { ...base, ci95: [boot[Math.floor(o.draws * 0.025)]!, boot[Math.ceil(o.draws * 0.975) - 1]!], method: 'bootstrap' };
}
