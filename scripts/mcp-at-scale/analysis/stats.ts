// Shared pieces of the MCP-at-scale analysis (internal-task): the trial index, the outcome values read from grade.py's
// outcomes.json, paired contrasts clustered by target on runner/stats/paired.ts (cluster bootstrap for the 95% range,
// cluster sign-flip for p), and the normal distribution for the interim look.
//
// The trial index (trials.jsonl) is one row per trial, written when shards are merged:
//   { trial_id, set: "R" | "T" | "G", harness, model, arm, rung, request,
//     outcomes: <grade.py outcomes.json> | outcomes_path: "<path relative to the index>",
//     usage?: { input_tokens, cache_read_tokens?, usd }, effort?: <search-effort.ts Effort>, builtin_attempts?: n,
//     cache_break_after_load?: bool, host_log?: "<catalog-calls.jsonl relative to the index>" }
// arm is native, tool-search-off (Claude Code, ENABLE_TOOL_SEARCH=false), pi-deferred, pi-direct, or gbrain-<surface>
// (full, starter, verbs, registered). A trial whose outcomes carry infra (HE-MCP-001, HE-MCP-002) is counted and never
// scored: a pair with an INFRA side is left out of every contrast and counted under infra_excluded.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clusteredPairedDelta, type PairedItem } from '../../../runner/stats/paired.ts';
import type { GItem, Item, RItem, TItem } from '../requests/sets.ts';
import type { Effort } from '../search-effort.ts';

export const SEED = 108;
export const DRAWS = 4000;
export const RUNGS = [30, 75, 150, 300] as const;

export interface Outcomes {
  request: string; kind: 'tool' | 'none'; rung: string | number | null; servers_expected: string[]; servers_connected: string[]; servers_missing: string[];
  infra: { code: string; detail: string } | null;
  calls: Array<{ server: string; tool: string; arguments: unknown; validation_ok: boolean | null; fixture: string | null }>;
  right_tool: boolean | null; first_right_call: number | null; wrong_tools: string[]; tool_when_none: boolean | null; invalid_calls: number; reward: number;
}
export interface Trial {
  trial_id: string; set: 'R' | 'T' | 'G'; harness: string; model: string; arm: string; rung: number; request: string; rep?: number; outcomes: Outcomes | null;
  usage?: { input_tokens: number; cache_read_tokens?: number; usd: number } | null;
  effort?: Pick<Effort, 'source' | 'turns' | 'found' | 'turns_before_right' | 'search_calls' | 'search_calls_before_right'> | null;
  builtin_attempts?: number; cache_break_after_load?: boolean; host_log?: string; host_log_lines?: Array<Record<string, any>>;
  gbrain_listed_tools?: string[];
}

export const readJsonl = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

/** Loads the trial index; outcomes_path and host_log are read relative to it, and the gbrain relay's gbrain-calls.jsonl beside
 *  the host log joins its lines in time order (the catalog host never sees gbrain). A row with no outcomes counts as INFRA. */
export function loadTrials(path: string): Trial[] {
  const dir = dirname(path);
  return readJsonl<Trial & { outcomes_path?: string }>(path).map((t) => {
    for (const k of ['trial_id', 'set', 'harness', 'model', 'arm', 'request'] as const) if (typeof t[k] !== 'string') throw new Error('HE-MCP-030 trial row without ' + k + ': ' + JSON.stringify(t).slice(0, 200));
    if (!Number.isFinite(Number(t.rung))) throw new Error('HE-MCP-030 trial ' + t.trial_id + ' has no rung');
    if (t.rep !== undefined && (!Number.isSafeInteger(t.rep) || t.rep < 1)) throw new Error('HE-MCP-030 trial ' + t.trial_id + ' has an invalid rep');
    const outcomes = t.outcomes ?? (t.outcomes_path && existsSync(join(dir, t.outcomes_path)) ? JSON.parse(readFileSync(join(dir, t.outcomes_path), 'utf8')) : null);
    const hostPath = t.host_log ? join(dir, t.host_log) : null;
    const relayPath = hostPath ? join(dirname(hostPath), 'gbrain-calls.jsonl') : null;
    const relayList = hostPath ? join(dirname(hostPath), 'gbrain-tools-list.json') : null;
    const host = hostPath && existsSync(hostPath) ? readJsonl<Record<string, any>>(hostPath) : t.host_log_lines;
    const host_log_lines = relayPath && existsSync(relayPath)
      ? [...(host ?? []), ...readJsonl<Record<string, any>>(relayPath)].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
      : host;
    const gbrain_listed_tools = relayList && existsSync(relayList)
      ? (JSON.parse(readFileSync(relayList, 'utf8')).tools as { name: string }[]).map((tool) => tool.name)
      : t.gbrain_listed_tools;
    return { ...t, rung: Number(t.rung), outcomes, host_log_lines, gbrain_listed_tools };
  });
}

export const isInfra = (t: Trial) => !t.outcomes || !!t.outcomes.infra;
export const hasTranscript = ({ effort }: Trial) => (effort?.source === 'trajectory' || effort?.source === 'openclaw-session') && effort.turns > 0;
export const setup = (t: Trial) => t.harness + ':' + t.model;
export const setupItemRep = (t: Trial) => JSON.stringify([setup(t), t.request, t.rep ?? 1]);
export const isOpus = (model: string) => /opus/i.test(model);

/** Request metadata from the set files, by id. */
export function requestIndex(items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const cluster = (id: string): string => {
    const it = byId.get(id);
    if (!it) return 'unknown:' + id;
    if (it.set === 'R') return (it as RItem).kind === 'tool' && (it as RItem).target ? (it as RItem).target!.server + '/' + (it as RItem).target!.tool : 'none:' + it.id;
    if (it.set === 'G') return 'gbrain/' + (it as GItem).target.tool;
    return 'task:' + it.id;
  };
  return { byId, cluster, kind: (id: string) => (byId.get(id) as RItem | undefined)?.kind ?? 'tool' };
}
export type Requests = ReturnType<typeof requestIndex>;

/** Outcome values; null leaves a trial out of that outcome (the wrong kind of request, or INFRA). */
export const VALUES = {
  right_tool: (t: Trial) => (isInfra(t) || t.outcomes!.kind !== 'tool' ? null : t.outcomes!.right_tool ? 1 : 0),
  wrong_tool: (t: Trial) => (isInfra(t) || t.outcomes!.kind !== 'tool' ? null : t.outcomes!.wrong_tools.length ? 1 : 0),
  tool_when_none: (t: Trial) => (isInfra(t) || t.outcomes!.kind !== 'none' ? null : t.outcomes!.tool_when_none ? 1 : 0),
  reward: (t: Trial) => (isInfra(t) ? null : t.outcomes!.reward),
  usd: (t: Trial) => (isInfra(t) || !t.usage ? null : t.usage.usd),
  input_tokens: (t: Trial) => (isInfra(t) || !t.usage ? null : t.usage.input_tokens),
};

/** Set T success: every rule end_state.fired names was answered by the host (the call's fixture id) with valid arguments. */
export function taskSuccess(t: Trial, item: TItem | undefined): number | null {
  if (isInfra(t) || !item) return null;
  const fired = new Set(t.outcomes!.calls.filter((c) => c.validation_ok !== false && c.fixture).map((c) => c.fixture!));
  return item.end_state.fired.every((f) => fired.has(f)) ? 1 : 0;
}

export interface Contrast {
  n_pairs: number; n_clusters: number; infra_excluded: number; unpaired: number;
  mean_a: number | null; mean_b: number | null; delta: number | null; ci95: [number, number] | null;
  p_two_sided: number | null; p_method: string | null; se_cluster: number | null; design_effect: number | null; discordant: number | null;
}
const r6 = (x: number | null | undefined) => (x === null || x === undefined ? null : Number(x.toFixed(6)));

export function contrastOf(pairs: PairedItem[], extra: { infra_excluded?: number; unpaired?: number } = {}): Contrast {
  const base = { infra_excluded: extra.infra_excluded ?? 0, unpaired: extra.unpaired ?? 0 };
  if (!pairs.length) return { n_pairs: 0, n_clusters: 0, ...base, mean_a: null, mean_b: null, delta: null, ci95: null, p_two_sided: null, p_method: null, se_cluster: null, design_effect: null, discordant: null };
  const s = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
  const binary = pairs.every((p) => (p.a === 0 || p.a === 1) && (p.b === 0 || p.b === 1));
  return { n_pairs: s.n_pairs, n_clusters: s.n_clusters, ...base, mean_a: r6(s.mean_a), mean_b: r6(s.mean_b), delta: r6(s.delta), ci95: s.ci95 ? [r6(s.ci95[0])!, r6(s.ci95[1])!] : null,
    p_two_sided: r6(s.p_two_sided), p_method: s.p_method, se_cluster: r6(s.se_cluster), design_effect: r6(s.design_effect), discordant: binary ? pairs.filter((p) => p.a !== p.b).length : null };
}

/** Pairs B against A by key; a pair with an INFRA side is counted and left out; cluster from the request. */
export function paired(a: Trial[], b: Trial[], value: (t: Trial) => number | null, key: (t: Trial) => string, cluster: (t: Trial) => string): Contrast {
  const left = new Map(a.map((t) => [key(t), t])), right = new Map(b.map((t) => [key(t), t]));
  const pairs: PairedItem[] = [];
  let infra = 0, unpaired = 0;
  for (const [k, x] of left) {
    const y = right.get(k);
    if (!y) { unpaired++; continue; }
    if (isInfra(x) || isInfra(y)) {
      const cleared = (t: Trial) => (t.outcomes ? value({ ...t, outcomes: { ...t.outcomes, infra: null } }) : 0);
      if (cleared(x) !== null || cleared(y) !== null) infra++;
      continue;
    }
    const va = value(x), vb = value(y);
    if (va === null || vb === null) continue;
    pairs.push({ id: k, cluster: cluster(x), a: va, b: vb });
  }
  for (const k of right.keys()) if (!left.has(k)) unpaired++;
  return contrastOf(pairs, { infra_excluded: infra, unpaired });
}

/** A rate (or mean) with its cluster-bootstrap 95% range: the same machinery with every A value 0. */
export function rate(rows: Trial[], value: (t: Trial) => number | null, cluster: (t: Trial) => string) {
  const pairs = rows.filter((t) => !isInfra(t)).flatMap((t) => { const v = value(t); return v === null ? [] : [{ id: t.trial_id, cluster: cluster(t), a: 0, b: v }]; });
  const c = contrastOf(pairs);
  return { n: c.n_pairs, n_clusters: c.n_clusters, mean: c.delta, ci95: c.ci95, infra: rows.filter(isInfra).length };
}

/** Standard normal CDF, Hart's double-precision algorithm as given by West (2005), "Better approximations to cumulative
 *  normal functions", Wilmott. */
export function normalCdf(z: number): number {
  const x = Math.abs(z);
  let c: number;
  if (x > 37) c = 0;
  else {
    const e = Math.exp(-x * x / 2);
    if (x < 7.07106781186547) {
      let n = 3.52624965998911e-2 * x + 0.700383064443688;
      n = n * x + 6.37396220353165; n = n * x + 33.912866078383; n = n * x + 112.079291497871; n = n * x + 221.213596169931; n = n * x + 220.206867912376;
      let d = 8.83883476483184e-2 * x + 1.75566716318264;
      d = d * x + 16.064177579207; d = d * x + 86.7807322029461; d = d * x + 296.564248779674; d = d * x + 637.333633378831; d = d * x + 793.826512519948; d = d * x + 440.413735824752;
      c = e * n / d;
    } else {
      let b = x + 0.65; b = x + 4 / b; b = x + 3 / b; b = x + 2 / b; b = x + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return z > 0 ? 1 - c : c;
}
