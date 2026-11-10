#!/usr/bin/env bun
// Keyless sizing for the 2026-11-10 correction (docs/corrections/2026-11-10/README.md): model requests that the Harbor
// egress sidecar cut at 15 s in a frontier Harbor run. gost 3.2.7's red handler, which the sidecar ran before
// e4acedadaa, closes a connection whose HTTP reply has not started 15 s after the request. The metering proxy never
// sees the client go away, so it finishes the upstream call, records it and pays for it, and the harness usually sends
// the same request again.
//
//   bun scripts/corrections/harbor-cut.ts --results <run results dir> --merged <merged results dir> --out <dir> [--resent-only]
//
// It reads every proxy-usage.ndjson under --results with the ledger.sqlite beside it (entries.created_at and settled_at
// give each paid call's upstream duration) and every trials.jsonl under --results (frontier.harbor_trial maps a Harbor
// trial key to its trial id). A forwarded, answered (status 200), paid request is cut when either rule holds:
//   resend_15s          the next request of the same key on the same model and route has the same prompt token total and
//                       starts 15.0 to 17.0 s later, and the ledger does not show the call finishing within 15 s;
//   nonstream_over_15s  it was not streamed and the ledger shows its upstream call took more than 15 s.
// A cut counts against the run whose spend the published cost reads: the run a merged record carries (usage.usd), or the
// first run of a trial whose rerun the lease stopped (frontier.first_run_usd). A cut in a run a rerun replaced comes off
// frontier.replaced_usd, which analyze.ts reads only with --cost-with-replaced.
//
// Writes cuts.json (per cell and per cut), trials.jsonl (the merged records with each cut's paid cost taken out of that
// field; every other field as recorded) and cut-trials-all.json and cut-trials-failed.json (the trials whose counted run
// had a cut, for subset.ts --drop-trials). With --resent-only it keeps only the cuts the harness sent again (resend_15s),
// the correction's lower bound. Never writes --results or --merged.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

type ProxyLine = { at: string; key: string; model: string | null; route?: string; outcome?: string; status?: number; streamed?: boolean;
  input_tokens?: number; cached_tokens?: number; cache_write_tokens?: number; actual_usd?: number | null };
type Request = ProxyLine & { t: number; durMs: number | null };
export type TrialRow = { trial_id: string; cell: string; task: string; model: string; termination: string; grade?: string | null;
  usage?: { usd: number; by_model?: { [m: string]: { usd: number } } }; frontier?: { harbor_trial?: string; first_run_usd?: number; replaced_usd?: number } };

const CUT_MS = 15_000;
const RESEND_MS: [number, number] = [15_000, 17_000];

const promptTokens = (r: ProxyLine) => (r.input_tokens ?? 0) + (r.cached_tokens ?? 0) + (r.cache_write_tokens ?? 0);
const jsonLines = <T>(f: string): T[] => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const walk = (d: string, name: string): string[] => readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), name) : e.name === name ? [join(d, e.name)] : []));

/** Each paid ledger entry of a key: when the proxy created it, how long the upstream call took, and what it cost. */
function ledger(dir: string) {
  const out = new Map<string, Array<{ start: number; durMs: number | null; usd: number; used: boolean }>>();
  const path = join(dir, 'ledger.sqlite');
  if (!existsSync(path)) throw new Error(path + ' is missing: without it no paid request can be matched or timed');
  const db = new Database(path, { readonly: true });
  const rows = db.query('select description, created_at, settled_at, actual_usd from entries order by seq').all() as Array<{ description: string; created_at: string; settled_at: string | null; actual_usd: number | null }>;
  db.close();
  for (const e of rows) {
    if (!e.description.endsWith(']')) continue;
    const key = e.description.slice(e.description.lastIndexOf('[') + 1, -1);
    const start = Date.parse(e.created_at);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ start, durMs: e.settled_at ? Date.parse(e.settled_at) - start : null, usd: e.actual_usd ?? 0, used: false });
  }
  return out;
}

export function scan(results: string) {
  const trialOf = new Map<string, string>();
  for (const f of walk(results, 'trials.jsonl')) for (const t of jsonLines<TrialRow>(f)) {
    const k = t.frontier?.harbor_trial;
    if (!k) continue;
    if (trialOf.has(k) && trialOf.get(k) !== t.trial_id) throw new Error(`key ${k} maps to two trial ids`);
    trialOf.set(k, t.trial_id);
  }
  const cuts: Array<{ key: string; trial_id: string | null; log: string; at: string; model: string; route?: string; streamed?: boolean;
    duration_s: number | null; usd: number; rules: string[]; resend_gap_s: number | null }> = [];
  const paidByKey = new Map<string, number>();
  let unmatched = 0;
  const logs = walk(results, 'proxy-usage.ndjson');
  for (const log of logs) {
    const led = ledger(dirname(log));
    const byKey = new Map<string, Request[]>();
    for (const r of jsonLines<ProxyLine>(log)) {
      if (r.outcome !== 'forwarded') continue;
      if (!byKey.has(r.key)) byKey.set(r.key, []);
      byKey.get(r.key)!.push({ ...r, t: Date.parse(r.at), durMs: null });
    }
    for (const [key, rs] of byKey) {
      rs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const paid = rs.filter((r) => r.model !== null && r.model !== undefined);
      for (const r of paid) {
        const e = (led.get(key) ?? []).find((e) => !e.used && Math.abs(e.start - r.t) < 3000 && Math.abs(e.usd - (r.actual_usd ?? 0)) < 1e-6);
        if (e) { e.used = true; r.durMs = e.durMs; } else unmatched++;
      }
      paidByKey.set(key, (paidByKey.get(key) ?? 0) + paid.length);
      paid.forEach((a, i) => {
        if (a.status !== 200) return;
        const rules: string[] = [];
        let resend: Request | undefined;
        for (const b of paid.slice(i + 1)) {
          const gap = b.t - a.t;
          if (gap > RESEND_MS[1]) break;
          if ((a.durMs === null || a.durMs > CUT_MS) && gap >= RESEND_MS[0] && b.model === a.model && b.route === a.route && promptTokens(b) === promptTokens(a) && promptTokens(a) > 0) {
            resend = b;
            rules.push('resend_15s');
            break;
          }
        }
        if (a.streamed === false && a.durMs !== null && a.durMs > CUT_MS) rules.push('nonstream_over_15s');
        if (!rules.length) return;
        cuts.push({ key, trial_id: trialOf.get(key) ?? null, log: relative(results, log), at: a.at, model: a.model!, route: a.route, streamed: a.streamed,
          duration_s: a.durMs === null ? null : a.durMs / 1000, usd: a.actual_usd ?? 0, rules, resend_gap_s: resend ? (resend.t - a.t) / 1000 : null });
      });
    }
  }
  return { logs: logs.map((l) => relative(results, l)), unmatched, cuts, paidByKey, trialOf };
}

/** The spend field a cut in Harbor run `key` comes off for merged record `t`: the run it carries, the run a rerun replaced, or the first run of a trial whose rerun the lease stopped. */
export function fieldOf(key: string, t: TrialRow) {
  const f = t.frontier ?? {};
  const field = key === f.harbor_trial ? 'usage.usd' : 'replaced_usd' in f ? 'frontier.replaced_usd' : 'first_run_usd' in f ? 'frontier.first_run_usd' : null;
  if (!field) throw new Error(t.trial_id + ': cut in run ' + key + ', which this record neither carries nor replaced');
  return field;
}

/** Takes each cut's paid cost off the field fieldOf names, in place in the records of byId. */
export function applyCuts(cuts: Array<{ key: string; trial_id: string; usd: number }>, byId: Map<string, TrialRow>) {
  const perRun = new Map<string, { t: TrialRow; key: string; usd: number }>();
  for (const c of cuts) {
    const k = c.trial_id + ' ' + c.key;
    if (!perRun.has(k)) perRun.set(k, { t: byId.get(c.trial_id)!, key: c.key, usd: 0 });
    perRun.get(k)!.usd += c.usd;
  }
  for (const { t, key, usd } of perRun.values()) {
    const field = fieldOf(key, t);
    if (field === 'usage.usd') {
      t.usage!.usd -= usd;
      const m = t.usage!.by_model?.[t.model];
      if (m) m.usd -= usd;
    } else if (field === 'frontier.replaced_usd') t.frontier!.replaced_usd! -= usd;
    else t.frontier!.first_run_usd! -= usd;
  }
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf('--' + n); return i < 0 ? undefined : process.argv[i + 1]; };
  if (!arg('results') || !arg('merged') || !arg('out')) {
    console.error('usage: bun scripts/corrections/harbor-cut.ts --results <run results dir> --merged <merged results dir> --out <dir> [--resent-only]');
    process.exit(2);
  }
  const results = resolve(arg('results')!), merged = resolve(arg('merged')!), out = resolve(arg('out')!);
  if (out === merged || out === results) throw new Error('refusing to write over the source');
  const s = scan(results);
  if (s.unmatched) {
    console.error(`${s.unmatched} paid request(s) have no ledger entry, so they can't be timed; refusing to write corrected trials`);
    process.exit(1);
  }
  if (process.argv.includes('--resent-only')) s.cuts = s.cuts.filter((c) => c.resend_gap_s !== null);
  const records = jsonLines<TrialRow>(join(merged, 'trials.jsonl'));
  const byId = new Map(records.map((t) => [t.trial_id, t]));
  const r7 = (x: number) => Math.round(x * 1e7) / 1e7;
  const cuts = s.cuts.map((c) => {
    const t = c.trial_id === null ? undefined : byId.get(c.trial_id);
    if (!t) throw new Error('cut in run ' + c.key + ', whose trial has no record in ' + merged);
    const field = fieldOf(c.key, t);
    return { ...c, trial_id: t.trial_id, cell: t.cell, task: t.task, field, counted: field !== 'frontier.replaced_usd', termination: t.termination, grade: t.grade ?? null };
  });
  applyCuts(cuts, byId);
  const cells: { [cell: string]: { trials: number; harbor_runs: number; paid_requests: number; cut_requests: number; resends: number; trials_with_cut: number; cut_usd: number; cut_requests_replaced: number; cut_usd_replaced: number } } = {};
  for (const t of records) (cells[t.cell] ??= { trials: 0, harbor_runs: 0, paid_requests: 0, cut_requests: 0, resends: 0, trials_with_cut: 0, cut_usd: 0, cut_requests_replaced: 0, cut_usd_replaced: 0 }).trials++;
  for (const [key, trial] of s.trialOf) {
    const t = byId.get(trial);
    if (!t || fieldOf(key, t) === 'frontier.replaced_usd') continue;
    cells[t.cell]!.harbor_runs++;
    cells[t.cell]!.paid_requests += s.paidByKey.get(key) ?? 0;
  }
  for (const c of cuts) {
    const cell = cells[c.cell]!;
    if (c.counted) { cell.cut_requests++; cell.resends += c.resend_gap_s === null ? 0 : 1; cell.cut_usd += c.usd; } else { cell.cut_requests_replaced++; cell.cut_usd_replaced += c.usd; }
  }
  const countedTrials = [...new Set(cuts.filter((c) => c.counted).map((c) => c.trial_id!))].sort();
  for (const id of countedTrials) cells[byId.get(id)!.cell]!.trials_with_cut++;
  for (const c of Object.values(cells)) { c.cut_usd = r7(c.cut_usd); c.cut_usd_replaced = r7(c.cut_usd_replaced); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'trials.jsonl'), records.map((t) => JSON.stringify(t)).join('\n') + '\n');
  const rel = (p: string) => relative(resolve(import.meta.dir, '..', '..'), p);
  writeFileSync(join(out, 'cuts.json'), JSON.stringify({
    results: rel(results), merged: rel(merged), cut_after_s: CUT_MS / 1000, resend_window_s: RESEND_MS.map((x) => x / 1000),
    proxy_logs: s.logs.length, ledger_unmatched_requests: s.unmatched, cells, cuts,
  }, null, 1) + '\n');
  const list = (ids: string[], why: string) => JSON.stringify({ trial_ids: ids, why }, null, 1) + '\n';
  writeFileSync(join(out, 'cut-trials-all.json'), list(countedTrials, 'every trial whose counted run had at least one 15 s cut'));
  writeFileSync(join(out, 'cut-trials-failed.json'), list(countedTrials.filter((id) => byId.get(id)!.grade === 'fail'), 'trials whose counted run had a 15 s cut and that were scored a fail'));
  for (const [k, c] of Object.entries(cells)) if (c.cut_requests || c.cut_requests_replaced) console.log(k, JSON.stringify(c));
}
