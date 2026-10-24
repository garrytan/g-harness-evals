#!/usr/bin/env bun
// Provider-side spend reconciliation (TODOS: HE-PROXY-002; methodology item 3).
//
//   bun scripts/reconcile-provider.ts --results <results/<run-id>> [--results <dir> ...] [--write]
//                                     [--tz America/Los_Angeles] [--api-key-id <apikey_...>] [--provider-fixture <file>]
//
// Proxy side, always, per run: the priced lines of proxy-usage.ndjson (forwarded, status 200, actual_usd present) summed
// per UTC day and per model (requests, USD at list price, input tokens, output tokens, cache reads), the same spend read
// from trials.jsonl (usage.usd) and from the lease ledger (runs.committed_usd and the settled entries), and the largest
// difference between the four views. A per-day sheet in the shape of the console's Usage page, by UTC day and by the
// viewer's local day. The proxy's input_tokens already include cache writes and cache reads (runner/ledger/budget-ledger.ts,
// usageCost), so the sheet says so and the cache-read column sits beside it.
//
// Provider side, when ANTHROPIC_ADMIN_KEY is set (an Admin API key; the proxy's ANTHROPIC_API_KEY is never read here):
// usage_report/messages (1d buckets, by model and api_key_id) and cost_report (1d, by description) for the span of every
// run given, compared against the proxy totals pooled per UTC day and model across those runs, because runs that share a
// day and a key (the pilot and the held-out run both spent Sonnet on 2026-10-23) are one bucket to the provider. One
// api_key_id must be given (--api-key-id); without it the comparison is "unattributed" and lists the key ids seen. A day
// that ended less than 24 hours before the fetch is "not settled" and excluded from the verdict. The verdict is a
// relative residual per day and model against the 1% bar, with a boolean and an exit code, never prose alone.
// --provider-fixture <file> replays recorded responses for tests and refuses --write, so a fixture can never stamp a run.
//
// Output: the Markdown sheet on stdout and, with --write, results/spend-reconciliation.json per run (run level; per-trial
// reconcile.json files are receipts of a counted run and are never edited). The provider rows kept as a receipt are
// filtered to the chosen key id, so other keys' usage in the organisation is not published. Every byte that leaves the
// script passes a tripwire against the actual key value and a redaction of key-shaped strings; a hit aborts the write.
//
// Errors: HE-RECONCILE-001 the Admin API refused or failed (status, request id and the fix); HE-RECONCILE-002 a malformed
// or truncated page; HE-RECONCILE-003 a results directory is missing a receipt this check needs; HE-RECONCILE-004 the bar
// was missed (exit 1 after writing). Exit 2 on usage or input errors.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { TrialRecord } from '../runner/contracts.ts';

export const SCRIPT_VERSION = '1.1.0';
export const OUTPUT_FILE = 'spend-reconciliation.json';
// The prefixes are split so this file never carries a key-shaped literal that a secret scan would stop on.
const KEY_SHAPES = ['sk-' + 'ant-[A-Za-z0-9_-]{8,}', 'sk-' + 'proj-[A-Za-z0-9_-]{8,}', 'xox' + '[bp]-[A-Za-z0-9-]{8,}', 'xapp' + '-[A-Za-z0-9-]{8,}', 'wadm' + '-[A-Za-z0-9-]{8,}', 'gbrain' + '_[0-9a-f]{20}'].map((p) => new RegExp(p));
const BAR = 0.01;
const SETTLE_MS = 24 * 3600_000;

function args(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  return out;
}
const arg = (name: string, fallback?: string) => args(name)[0] ?? fallback;

export interface UsageLine {
  at: string; key: string; provider?: string; model?: string | null; outcome: string; status?: number;
  actual_usd?: number; input_tokens?: number; output_tokens?: number; cached_tokens?: number; charged_reservation?: boolean;
}
export interface Bucket { requests: number; usd: number; input_tokens: number; output_tokens: number; cached_tokens: number }
const zero = (): Bucket => ({ requests: 0, usd: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 });
const add = (b: Bucket, l: UsageLine) => { b.requests++; b.usd += l.actual_usd ?? 0; b.input_tokens += l.input_tokens ?? 0; b.output_tokens += l.output_tokens ?? 0; b.cached_tokens += l.cached_tokens ?? 0; };
const round = (x: number, d = 6) => Number(x.toFixed(d));

/** YYYY-MM-DD of an instant in a time zone. */
export function dayIn(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface ProxySide {
  priced_requests: number; forwarded_4xx: number; charged_reservations: number; refused_requests: number; failed_requests: number;
  first_at: string | null; last_at: string | null;
  total: Bucket; by_model: Record<string, Bucket>;
  by_utc_day: Record<string, Record<string, Bucket>>; by_local_day: Record<string, Record<string, Bucket>>; local_tz: string;
}

/** The proxy's priced usage for one run. */
export function summarizeProxy(lines: UsageLine[], runId: string, tz: string): ProxySide {
  const mine = lines.filter((l) => l.key?.startsWith(`sk-trial-${runId}/`));
  const forwarded = mine.filter((l) => l.outcome === 'forwarded');
  const priced = forwarded.filter((l) => l.status === 200 && typeof l.actual_usd === 'number');
  const out: ProxySide = {
    priced_requests: priced.length, forwarded_4xx: forwarded.filter((l) => (l.status ?? 0) >= 400 && (l.status ?? 0) < 500).length,
    charged_reservations: forwarded.filter((l) => l.charged_reservation).length,
    refused_requests: mine.filter((l) => l.outcome === 'refused').length, failed_requests: mine.filter((l) => l.outcome !== 'forwarded' && l.outcome !== 'refused').length,
    first_at: null, last_at: null, total: zero(), by_model: {}, by_utc_day: {}, by_local_day: {}, local_tz: tz,
  };
  for (const l of priced) {
    const model = l.model ?? 'unknown';
    add(out.total, l); add((out.by_model[model] ??= zero()), l);
    add(((out.by_utc_day[dayIn(l.at, 'UTC')] ??= {})[model] ??= zero()), l);
    add(((out.by_local_day[dayIn(l.at, tz)] ??= {})[model] ??= zero()), l);
    if (!out.first_at || l.at < out.first_at) out.first_at = l.at;
    if (!out.last_at || l.at > out.last_at) out.last_at = l.at;
  }
  return out;
}

export interface LedgerSide { run_id: string; lease_usd: number; committed_usd: number; overshoot_usd: number; entries: number; settled_usd: number; statuses: Record<string, number> }
export function summarizeLedger(path: string, runId: string): LedgerSide | null {
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  try {
    const run = db.query('select run_id, budget_usd, committed_usd, overshoot_usd from runs where run_id = ?').get(runId) as { run_id: string; budget_usd: number; committed_usd: number; overshoot_usd: number } | null;
    if (!run) return null;
    const rows = db.query('select status, count(*) as n, coalesce(sum(actual_usd), 0) as usd from entries where run_id = ? group by status').all(runId) as Array<{ status: string; n: number; usd: number }>;
    const statuses: Record<string, number> = {}; let entries = 0, settled = 0;
    for (const r of rows) { statuses[r.status] = r.n; entries += r.n; settled += r.usd; }
    return { run_id: run.run_id, lease_usd: run.budget_usd, committed_usd: run.committed_usd, overshoot_usd: run.overshoot_usd, entries, settled_usd: settled, statuses };
  } finally { db.close(); }
}

export interface TrialsSide { trials: number; harness_trials: number; with_usage: number; usd: number; requests: number; input_tokens: number; output_tokens: number; cached_tokens: number }
export function summarizeTrials(rows: TrialRecord[]): TrialsSide {
  const out: TrialsSide = { trials: rows.length, harness_trials: rows.filter((t) => t.script === null).length, with_usage: 0, usd: 0, requests: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
  for (const t of rows) {
    if (!t.usage) continue;
    out.with_usage++; out.usd += t.usage.usd; out.requests += t.usage.requests; out.input_tokens += t.usage.input_tokens; out.output_tokens += t.usage.output_tokens; out.cached_tokens += t.usage.cached_tokens;
  }
  return out;
}

// ---- provider side ---------------------------------------------------------------------------------------

export interface ProviderUsageRow { api_key_id?: string | null; model?: string | null; uncached_input_tokens: number; cache_read_input_tokens: number; cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }; output_tokens: number }
export interface ProviderBucket { starting_at: string; ending_at: string; results: ProviderUsageRow[] }
export interface ProviderCostRow { amount: string; currency: string; model?: string | null; token_type?: string | null; cost_type?: string | null; description?: string | null; workspace_id?: string | null }
export interface ProviderCostBucket { starting_at: string; ending_at: string; results: ProviderCostRow[] }
export interface ProviderFixture { usage: ProviderBucket[]; cost: ProviderCostBucket[]; fetched_at: string; source: string }

const ADMIN_BASE = 'https://api.anthropic.com/v1/organizations';

/** Every string that leaves this script passes through here: a key-shaped token becomes [redacted]. */
export function redact(text: string): string {
  let t = text;
  for (const re of KEY_SHAPES) t = t.replace(new RegExp(re.source, 'g'), '[redacted]');
  return t;
}

/** Follow next_page until has_more is false. A repeated cursor, a malformed envelope or more than 50 pages is an error,
 *  never a silently truncated report. Remote error bodies are not echoed; the status and request id are. */
export async function fetchPaged<T>(url: string, adminKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 30_000): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let page: string | null = null;
  for (let i = 0; i < 50; i++) {
    const u = new URL(url); if (page) u.searchParams.set('page', page);
    let res: Response;
    try { res = await fetchImpl(u, { headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new Error(`HE-RECONCILE-001 Admin API ${u.pathname} did not answer within ${timeoutMs / 1000} s (${(e as Error).name}); run again later`); }
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? '; ANTHROPIC_ADMIN_KEY must be an Admin API key with usage and cost read access' : res.status === 429 || res.status >= 500 ? '; transient, run again later' : '';
      throw new Error(`HE-RECONCILE-001 Admin API ${u.pathname} answered ${res.status}${hint}; request id ${res.headers.get('request-id') ?? 'unknown'}`);
    }
    const body = await res.json() as { data?: T[]; has_more?: boolean; next_page?: string | null };
    if (!Array.isArray(body.data) || typeof body.has_more !== 'boolean') throw new Error(`HE-RECONCILE-002 Admin API ${u.pathname} returned an envelope without data[] and has_more`);
    out.push(...body.data);
    if (!body.has_more) return out;
    if (!body.next_page || seen.has(body.next_page)) throw new Error(`HE-RECONCILE-002 Admin API ${u.pathname} has_more without a fresh next_page cursor`);
    seen.add(body.next_page); page = body.next_page;
  }
  throw new Error(`HE-RECONCILE-002 Admin API ${new URL(url).pathname} did not finish within 50 pages`);
}

/** Day buckets from the provider for [firstDay, lastDay]. */
export async function fetchProvider(firstDay: string, lastDay: string, adminKey: string, fetchImpl: typeof fetch = fetch): Promise<ProviderFixture> {
  const start = `${firstDay}T00:00:00Z`;
  const end = new Date(Date.parse(`${lastDay}T00:00:00Z`) + 86_400_000).toISOString();
  const usage = await fetchPaged<ProviderBucket>(`${ADMIN_BASE}/usage_report/messages?starting_at=${start}&ending_at=${end}&bucket_width=1d&limit=31&group_by[]=model&group_by[]=api_key_id`, adminKey, fetchImpl);
  const cost = await fetchPaged<ProviderCostBucket>(`${ADMIN_BASE}/cost_report?starting_at=${start}&ending_at=${end}&bucket_width=1d&limit=31&group_by[]=description`, adminKey, fetchImpl);
  return { usage, cost, fetched_at: new Date().toISOString(), source: 'anthropic admin api' };
}

const providerTokens = (r: ProviderUsageRow) => ({ input_tokens: r.uncached_input_tokens + r.cache_read_input_tokens + (r.cache_creation?.ephemeral_1h_input_tokens ?? 0) + (r.cache_creation?.ephemeral_5m_input_tokens ?? 0), output_tokens: r.output_tokens, cached_tokens: r.cache_read_input_tokens });

export interface DayModelCompare {
  day: string; model: string; runs: string[]; settled: boolean;
  proxy: Bucket; provider: { input_tokens: number; output_tokens: number; cached_tokens: number } | null;
  residual: { input_tokens: number; output_tokens: number; cached_tokens: number } | null;
  rel_residual: { input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null } | null;
  within_bar: boolean | null;
}
export interface ProviderComparison {
  method: string; fetched_at: string; api_key_id: string | null; api_key_ids_seen: string[];
  cells: DayModelCompare[]; covered: number; settled: number; max_rel_residual: number | null; within_bar: boolean | null;
  cost_by_day: Array<{ day: string; proxy_usd: number; workspace_usd: number | null; workspace_usd_matching_models: number | null }>;
  receipt: { usage: ProviderBucket[]; cost: ProviderCostBucket[] };
  notes: string[];
}

/** Compare proxy totals pooled per UTC day and model across runs with the provider's buckets for one api key. */
export function compareProvider(pooled: Map<string, { bucket: Bucket; runs: Set<string> }>, fixture: ProviderFixture, apiKeyId: string | null): ProviderComparison {
  const notes: string[] = [];
  const keyIds = [...new Set(fixture.usage.flatMap((b) => b.results.map((r) => r.api_key_id)).filter((x): x is string => !!x))].sort();
  const fetched = Date.parse(fixture.fetched_at);
  const cells: DayModelCompare[] = [];
  for (const [k, v] of [...pooled.entries()].sort()) {
    const [day, model] = k.split('|') as [string, string];
    const settled = fetched - (Date.parse(`${day}T00:00:00Z`) + 86_400_000) >= SETTLE_MS;
    const rows = apiKeyId ? fixture.usage.filter((u) => u.starting_at.startsWith(day)).flatMap((u) => u.results).filter((r) => r.api_key_id === apiKeyId && (r.model ?? model) === model) : [];
    const prov = rows.length ? rows.map(providerTokens).reduce((s, r) => ({ input_tokens: s.input_tokens + r.input_tokens, output_tokens: s.output_tokens + r.output_tokens, cached_tokens: s.cached_tokens + r.cached_tokens })) : null;
    const residual = prov ? { input_tokens: prov.input_tokens - v.bucket.input_tokens, output_tokens: prov.output_tokens - v.bucket.output_tokens, cached_tokens: prov.cached_tokens - v.bucket.cached_tokens } : null;
    const rel = (p: number, q: number) => (p === 0 ? (q === 0 ? 0 : null) : round(Math.abs(q - p) / p, 4));
    const relr = prov ? { input_tokens: rel(v.bucket.input_tokens, prov.input_tokens), output_tokens: rel(v.bucket.output_tokens, prov.output_tokens), cached_tokens: rel(v.bucket.cached_tokens, prov.cached_tokens) } : null;
    const vals = relr ? Object.values(relr) : [];
    const within = relr ? (vals.some((x) => x === null) ? false : vals.every((x) => (x as number) <= BAR)) : null;
    cells.push({ day, model, runs: [...v.runs].sort(), settled, proxy: v.bucket, provider: prov, residual, rel_residual: relr, within_bar: within });
  }
  const judged = cells.filter((c) => c.settled && c.provider);
  const rels = judged.flatMap((c) => Object.values(c.rel_residual!)).filter((x): x is number => x !== null);
  const costDays = [...new Set(cells.map((c) => c.day))];
  const cost_by_day = costDays.map((day) => {
    const rows = fixture.cost.filter((c) => c.starting_at.startsWith(day)).flatMap((c) => c.results).filter((r) => r.currency === 'USD');
    const models = new Set(cells.filter((c) => c.day === day).map((c) => c.model));
    const usd = (rs: ProviderCostRow[]) => rs.reduce((s, r) => s + Number(r.amount) / 100, 0);
    const proxyUsd = cells.filter((c) => c.day === day).reduce((s, c) => s + c.proxy.usd, 0);
    return { day, proxy_usd: round(proxyUsd), workspace_usd: rows.length ? round(usd(rows)) : null, workspace_usd_matching_models: rows.length ? round(usd(rows.filter((r) => r.model && models.has(r.model)))) : null };
  });
  if (!apiKeyId) notes.push(`unattributed: no --api-key-id was given, so no provider row is matched to the proxy; api_key_ids seen in the span: ${keyIds.join(', ') || 'none'}`);
  notes.push('the cost report is per workspace, not per api key, so workspace_usd is an upper bound on these runs when other work used the workspace that day');
  notes.push('per-trial reconciliation is not possible provider-side: every trial of a run shares one upstream key and the finest Admin API bucket is one hour; runs that share a day are compared pooled');
  if (cells.some((c) => !c.settled)) notes.push('a day that ended less than 24 hours before the fetch is not settled and is left out of the verdict');
  const receipt = { usage: fixture.usage.map((b) => ({ ...b, results: b.results.filter((r) => apiKeyId !== null && r.api_key_id === apiKeyId) })), cost: fixture.cost.map((b) => ({ ...b, results: b.results.filter((r) => cells.some((c) => c.day === b.starting_at.slice(0, 10) && c.model === r.model)) })) };
  const days = cells.map((c) => c.day);
  return { method: `${fixture.source}: usage_report/messages (1d, by model and api_key_id) and cost_report (1d, by description), ${days[0]} to ${days.at(-1)} UTC, proxy totals pooled per day across ${[...new Set(cells.flatMap((c) => c.runs))].length} run(s)`, fetched_at: fixture.fetched_at, api_key_id: apiKeyId, api_key_ids_seen: keyIds,
    cells, covered: cells.filter((c) => c.provider).length, settled: cells.filter((c) => c.settled).length, max_rel_residual: rels.length ? Math.max(...rels) : null, within_bar: judged.length ? judged.every((c) => c.within_bar) : null, cost_by_day, receipt, notes };
}

// ---- runs ------------------------------------------------------------------------------------------------

export type Status = 'performed' | 'performed_mismatch' | 'performed_unattributed' | 'performed_no_data' | 'not_performed';
export interface RunReconciliation {
  run_id: string; results: string; generated_at: string; script_version: string;
  proxy: ProxySide; ledger: LedgerSide; trials: TrialsSide;
  cross_check: { usage_lines_usd: number; trials_usd: number; ledger_committed_usd: number; ledger_settled_usd: number; max_abs_diff_usd: number; consistent: boolean };
  provider: ProviderComparison | null;
  status: Status;
  provider_reconciliation: string;
}

export function readRun(results: string, tz: string): Omit<RunReconciliation, 'provider' | 'status' | 'provider_reconciliation' | 'generated_at' | 'script_version'> {
  const trialsPath = join(results, 'trials.jsonl');
  if (!existsSync(trialsPath)) throw new Error(`HE-RECONCILE-003 ${trialsPath} is missing; pass --results <results/<run-id>> (the directory that holds trials.jsonl)`);
  if (!existsSync(join(results, 'proxy-usage.ndjson'))) throw new Error(`HE-RECONCILE-003 ${join(results, 'proxy-usage.ndjson')} is missing; the proxy's usage log is the receipt this check reads`);
  const rows = readFileSync(trialsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const runId = rows[0]?.trial_id.split('/')[0] ?? '';
  const lines = readFileSync(join(results, 'proxy-usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
  const proxy = summarizeProxy(lines, runId, tz);
  const ledger = summarizeLedger(join(results, 'ledger.sqlite'), runId);
  if (!ledger) throw new Error(`HE-RECONCILE-003 ${join(results, 'ledger.sqlite')} has no lease for run ${runId}; the ledger is one of the views this check compares, so the check cannot run without it`);
  const trials = summarizeTrials(rows);
  if (trials.with_usage !== trials.harness_trials) throw new Error(`HE-RECONCILE-003 ${trials.harness_trials - trials.with_usage} harness trial(s) in trials.jsonl carry no usage block; an incomplete run is reconciled after --resume finishes it`);
  const views = [proxy.total.usd, trials.usd, ledger.committed_usd, ledger.settled_usd];
  const maxAbs = Math.max(...views) - Math.min(...views);
  return { run_id: runId, results, proxy, ledger, trials, cross_check: { usage_lines_usd: round(proxy.total.usd), trials_usd: round(trials.usd), ledger_committed_usd: round(ledger.committed_usd), ledger_settled_usd: round(ledger.settled_usd), max_abs_diff_usd: round(maxAbs), consistent: maxAbs <= 0.01 } };
}

export async function reconcileAll(dirs: string[], opts: { tz: string; apiKeyId: string | null; fixture: ProviderFixture | null; adminKey: string | null; fetchImpl?: typeof fetch }): Promise<RunReconciliation[]> {
  const runs = dirs.map((d) => readRun(d, opts.tz));
  const pooled = new Map<string, { bucket: Bucket; runs: Set<string> }>();
  for (const r of runs) for (const [day, models] of Object.entries(r.proxy.by_utc_day)) for (const [model, b] of Object.entries(models)) {
    const k = `${day}|${model}`;
    const p = pooled.get(k) ?? { bucket: zero(), runs: new Set<string>() };
    p.bucket.requests += b.requests; p.bucket.usd += b.usd; p.bucket.input_tokens += b.input_tokens; p.bucket.output_tokens += b.output_tokens; p.bucket.cached_tokens += b.cached_tokens; p.runs.add(r.run_id);
    pooled.set(k, p);
  }
  const days = [...pooled.keys()].map((k) => k.split('|')[0]!).sort();
  let provider: ProviderComparison | null = null;
  if (days.length && (opts.fixture || opts.adminKey)) {
    const fixture = opts.fixture ?? await fetchProvider(days[0]!, days.at(-1)!, opts.adminKey!, opts.fetchImpl);
    provider = compareProvider(pooled, fixture, opts.apiKeyId);
  }
  const now = new Date().toISOString();
  return runs.map((r) => {
    let status: Status; let line: string;
    if (!r.proxy.first_at) { status = 'not_performed'; line = 'not performed: the run has no priced proxy usage to reconcile'; }
    else if (!provider) { status = 'not_performed'; line = 'not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy\'s ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console\'s Usage page (filter by the proxy\'s API key and these UTC days) until then'; }
    else {
      const mine = provider.cells.filter((c) => c.runs.includes(r.run_id));
      const judged = mine.filter((c) => c.settled && c.provider);
      const shared = mine.filter((c) => c.runs.length > 1);
      if (!provider.api_key_id) { status = 'performed_unattributed'; line = `performed, unattributed: ${provider.method}; no --api-key-id given, so no provider row is matched to this run (keys seen: ${provider.api_key_ids_seen.join(', ') || 'none'})`; }
      else if (!judged.length) { status = 'performed_no_data'; line = `performed, no data: ${provider.method}; the provider reported no settled usage for this run's days and models under api key ${provider.api_key_id}`; }
      else {
        const ok = judged.every((c) => c.within_bar);
        status = ok ? 'performed' : 'performed_mismatch';
        const worst = Math.max(...judged.flatMap((c) => Object.values(c.rel_residual!)).map((x) => x ?? 1));
        line = `performed${ok ? '' : ', MISMATCH'}: ${provider.method}; api key ${provider.api_key_id}; ${judged.length} of ${mine.length} day x model cell(s) judged, largest relative residual ${(100 * worst).toFixed(2)}% against the 1% bar${shared.length ? `; ${shared.length} cell(s) pooled with ${[...new Set(shared.flatMap((c) => c.runs).filter((x) => x !== r.run_id))].join(', ')}` : ''}; USD per day: ${provider.cost_by_day.filter((c) => mine.some((m) => m.day === c.day)).map((c) => `${c.day} proxy (pooled) $${c.proxy_usd.toFixed(2)} vs workspace $${c.workspace_usd === null ? 'n/a' : c.workspace_usd.toFixed(2)}`).join(', ')}`;
      }
    }
    return { ...r, generated_at: now, script_version: SCRIPT_VERSION, provider, status, provider_reconciliation: line };
  });
}

export function renderMarkdown(r: RunReconciliation): string {
  const usd = (x: number) => `$${x.toFixed(2)}`;
  const n = (x: number) => x.toLocaleString('en-US');
  const out: string[] = [];
  out.push(`## Spend reconciliation: ${r.run_id}`, '');
  out.push(`Proxy: ${n(r.proxy.priced_requests)} priced requests, ${usd(r.proxy.total.usd)} at list price, ${n(r.proxy.total.input_tokens)} input tokens (uncached plus cache writes plus cache reads; ${n(r.proxy.total.cached_tokens)} were cache reads), ${n(r.proxy.total.output_tokens)} output tokens; ${n(r.proxy.refused_requests)} refused, ${n(r.proxy.forwarded_4xx)} forwarded 4xx at $0, ${n(r.proxy.failed_requests)} failed. From ${r.proxy.first_at ?? '-'} to ${r.proxy.last_at ?? '-'}.`);
  out.push(`Cross-check: usage lines ${usd(r.cross_check.usage_lines_usd)}, trials.jsonl ${usd(r.cross_check.trials_usd)}, ledger committed ${usd(r.cross_check.ledger_committed_usd)}, ledger settled ${usd(r.cross_check.ledger_settled_usd)}; largest difference ${usd(r.cross_check.max_abs_diff_usd)} (${r.cross_check.consistent ? 'consistent' : 'NOT consistent: a view disagrees by more than a cent; compare the per-trial usage.json files with the usage lines for that run'}).`, '');
  out.push(`Provider (${r.status}): ${r.provider_reconciliation}`, '');
  const sheet = (title: string, days: Record<string, Record<string, Bucket>>) => {
    out.push(`### ${title}`, '', '| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |', '|---|---|---|---|---|---|---|');
    for (const day of Object.keys(days).sort()) for (const [model, b] of Object.entries(days[day]!)) out.push(`| ${day} | ${model} | ${n(b.requests)} | ${n(b.input_tokens)} | ${n(b.cached_tokens)} | ${n(b.output_tokens)} | ${usd(b.usd)} |`);
    out.push('');
  };
  sheet('By UTC day (the Admin API\'s buckets)', r.proxy.by_utc_day);
  sheet(`By local day, ${r.proxy.local_tz} (the console as a viewer there sees it)`, r.proxy.by_local_day);
  if (r.provider) {
    const p = r.provider;
    out.push('### Provider comparison (proxy totals pooled per UTC day across the runs given)', '', '| UTC day | Model | Runs in the bucket | Settled | Proxy input | Provider input | Proxy output | Provider output | Proxy cache reads | Provider cache reads | Largest relative residual | Within 1% |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of p.cells.filter((c) => c.runs.includes(r.run_id))) {
      const rel = c.rel_residual ? Math.max(...Object.values(c.rel_residual).map((x) => x ?? 1)) : null;
      out.push(`| ${c.day} | ${c.model} | ${c.runs.join(', ')} | ${c.settled ? 'yes' : 'no'} | ${n(c.proxy.input_tokens)} | ${c.provider ? n(c.provider.input_tokens) : 'n/a'} | ${n(c.proxy.output_tokens)} | ${c.provider ? n(c.provider.output_tokens) : 'n/a'} | ${n(c.proxy.cached_tokens)} | ${c.provider ? n(c.provider.cached_tokens) : 'n/a'} | ${rel === null ? 'n/a' : (100 * rel).toFixed(2) + '%'} | ${c.within_bar === null ? 'n/a' : c.within_bar ? 'yes' : 'no'} |`);
    }
    out.push('', '| UTC day | Proxy USD (pooled) | Workspace USD (cost report) | of which these models |', '|---|---|---|---|');
    for (const c of p.cost_by_day) out.push(`| ${c.day} | ${usd(c.proxy_usd)} | ${c.workspace_usd === null ? 'n/a' : usd(c.workspace_usd)} | ${c.workspace_usd_matching_models === null ? 'n/a' : usd(c.workspace_usd_matching_models)} |`);
    out.push('', ...p.notes.map((x) => `- ${x}`), '');
  }
  return out.join('\n');
}

/** Refuse to emit anything that carries the actual key value or a key-shaped string. */
export function assertNoKeyShapes(text: string, secrets: string[] = []): void {
  for (const s of secrets) if (s && text.includes(s)) throw new Error('refusing to write output: it carries the Admin key value itself');
  for (const re of KEY_SHAPES) if (re.test(text.replace(/sk-trial-[^\s"]+/g, ''))) throw new Error(`refusing to write output: it carries a key-shaped string matching ${re}; find it in the inputs before writing anything`);
}

if (import.meta.main) {
  const dirs = args('results');
  const usage = 'usage: bun scripts/reconcile-provider.ts --results <results/<run-id>> [--results ...] [--write] [--tz <zone>] [--api-key-id <apikey_...>] [--provider-fixture <file>]';
  if (!dirs.length) { console.error(usage); process.exit(2); }
  const write = process.argv.includes('--write');
  const fixturePath = arg('provider-fixture');
  if (fixturePath && write) { console.error('--provider-fixture replays a recorded response for tests and cannot be combined with --write (HE-RECONCILE-003)'); process.exit(2); }
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY ?? null;
  try {
    const fixture = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) as ProviderFixture : null;
    const runs = await reconcileAll(dirs, { tz: arg('tz', 'America/Los_Angeles')!, apiKeyId: arg('api-key-id') ?? null, fixture, adminKey });
    let exit = 0;
    for (const r of runs) {
      const md = renderMarkdown(r), json = JSON.stringify(r, null, 1);
      assertNoKeyShapes(md, adminKey ? [adminKey] : []); assertNoKeyShapes(json, adminKey ? [adminKey] : []);
      process.stdout.write(redact(md) + '\n');
      if (!r.cross_check.consistent) { console.error(`[reconcile-provider] ${r.run_id}: the proxy-side views of spend differ by $${r.cross_check.max_abs_diff_usd}`); exit = 1; }
      if (r.status === 'performed_mismatch') { console.error(`[reconcile-provider] HE-RECONCILE-004 ${r.run_id}: provider usage differs from the proxy by more than 1% in at least one settled day x model cell; see the comparison table`); exit = 1; }
      if (write) { writeFileSync(join(r.results, OUTPUT_FILE), redact(json) + '\n'); console.error(`[reconcile-provider] wrote ${join(r.results, OUTPUT_FILE)} (${r.status})`); }
    }
    process.exit(exit);
  } catch (e) {
    console.error(redact(`[reconcile-provider] ${(e as Error).message}`).replace(adminKey ?? '\u0000', '[redacted]'));
    process.exit((e as Error).message.startsWith('HE-RECONCILE-00') ? 1 : 2);
  }
}
