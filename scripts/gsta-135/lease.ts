#!/usr/bin/env bun
/**
 * Skill-use panel lease arithmetic, used by scripts/gsta-135/discovery.sh in
 * panel mode and by tests/gsta-135-panel.test.ts. Pure functions plus a small
 * CLI; every dollar figure comes from the proxy's own pricing path
 * (priceRequest, the proxy's byte bound, reservationUsd in
 * runner/ledger/budget-ledger.ts), never from a second formula.
 *
 *   bun scripts/gsta-135/lease.ts r-max --model claude-opus-5-5 --max-tokens 128000 [--per-trial-usd 1.00] [--context-tokens 200000]
 *   bun scripts/gsta-135/lease.ts order --trials 5 [--arms none,baseline,candidate]
 *       the panel order; without --arms the plan's two-arm order (baseline, candidate), byte for byte; with the three-arm
 *       list (the no-gstack arm first) each cell gains a none trial with trial_id gsta135-<harness>-t<task>-none-<i>
 *   bun scripts/gsta-135/lease.ts cap-check --lease <usd> --cap <usd> (--budget-ledger <path> --run-id <run id> | --settled <usd> --unknown <usd>)
 *       prints {fits, settled, unknown}; exit 0 fits, 1 does not. With a ledger, settled is the committed value of the run's
 *       settled entries and unknown the reserved value of its open ones (an undrained request), read for the run prefix.
 *   bun scripts/gsta-135/lease.ts spend --usage <ndjson> --key trial-token:<trial> [--budget-ledger <path> --lease-id <run id>.<trial id>]
 *       one trial's spend from its usage lines (and, with the ledger, which lease refusals overlapped an in-flight request)
 *   bun scripts/gsta-135/lease.ts classify --termination <t> --spend <json> [--wrapper-log <file>]
 *   bun scripts/gsta-135/lease.ts ledger-summary --budget-ledger <path> --run-id <run id>
 *   bun scripts/gsta-135/lease.ts placeholder-ceilings   (the manifest's ceilings block when ceilings.ts has not run)
 *
 * A finalized lease is closed with the ledger's own CLI
 * (bun runner/ledger/budget-ledger.ts close --budget-ledger <path> --budget-run-id <lease id>).
 *
 * R_max is the proxy's reservation for a request at the model's input bound:
 * the proxy estimates input at 3 bytes per token (budget-ledger.ts
 * priceRequest) and then bounds the estimate below by the body's bytes plus 64
 * (metering-proxy.ts forwardLeased), so the body that the proxy itself would
 * estimate at the context window is context_tokens x 3 bytes of prompt, with
 * cache_control present (the Anthropic cache-write premium, which both
 * harnesses' requests carried in the discovery run) and max_tokens at the pin.
 * The context window of claude-opus-5-5 is not in the price table; 200,000 is
 * the counted OpenClaw config's contextWindow row
 * (harnesses/openclaw/config/openclaw.json) and Anthropic's published figure.
 *
 * The lease admits requests serially (k = 1): the ledger's reserve() checks
 * settled plus every open reservation plus the new one against the lease, so
 * two concurrent requests near R_max refuse each other with settled near
 * zero. Such a 402 is read from the ledger entries' created_at/settled_at
 * overlap and classified infra:reservation_refused, never ceiling:lease.
 */
import { existsSync, readFileSync } from 'node:fs';
import { priceRequest, readLedger, reservationUsd, type LedgerEntry } from '../../runner/ledger/budget-ledger.ts';
import { PROVIDER_ERROR_NOT_BILLED } from '../../runner/proxy/metering-proxy.ts';

export const PANEL_MODEL = 'claude-opus-5-5';
export const OPUS_CONTEXT_TOKENS = 200_000;
export const PROXY_BYTES_PER_TOKEN = 3;
/** The plan's placeholder ceilings, the manifest's values until ceilings.ts has measured them. */
export const PLACEHOLDER_CEILINGS = { task1: 0.40, task2: 0.40, task3: 0.15 } as const;
const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export interface BoundRequest { model: string; maxTokens: number; contextTokens?: number; bytesPerToken?: number }

/** The Anthropic request body the proxy would see for a prompt at the input bound. */
export function boundRequestBody(o: BoundRequest): Record<string, unknown> {
  const bytes = (o.contextTokens ?? OPUS_CONTEXT_TOKENS) * (o.bytesPerToken ?? PROXY_BYTES_PER_TOKEN);
  return {
    model: o.model, max_tokens: o.maxTokens, stream: true,
    system: [{ type: 'text', text: 'internal-task input bound', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'x'.repeat(bytes) }],
  };
}

/** The reservation the proxy takes for a body: priceRequest, then the byte bound, then reservationUsd. */
export function proxyReservation(body: Record<string, unknown>) {
  const price = priceRequest(ANTHROPIC_MESSAGES, body);
  if (!price) throw new Error('the proxy would not price this request');
  const bodyBytes = Buffer.byteLength(JSON.stringify(body));
  const bounded = { ...price, inputTokens: Math.max(price.inputTokens, bodyBytes + 64) };
  const rates = bounded.long && bounded.inputTokens > bounded.long.above_input_tokens ? bounded.long : bounded;
  const inputRate = bounded.cacheWritePremium ? Math.max(rates.input, rates.cache_write ?? 0) : rates.input;
  return {
    reserved_usd: reservationUsd(bounded), body_bytes: bodyBytes, estimated_input_tokens: price.inputTokens, bounded_input_tokens: bounded.inputTokens,
    cache_write_premium: !!bounded.cacheWritePremium, input_rate_per_mtok: inputRate, output_rate_per_mtok: rates.output, max_output_tokens: bounded.maxOutputTokens,
    input_usd: round6(bounded.inputTokens * inputRate / 1e6), output_usd: round6(bounded.maxOutputTokens * rates.output / 1e6),
  };
}

export function rMax(o: BoundRequest) {
  const contextTokens = o.contextTokens ?? OPUS_CONTEXT_TOKENS;
  const bytesPerToken = o.bytesPerToken ?? PROXY_BYTES_PER_TOKEN;
  const { reserved_usd, ...detail } = proxyReservation(boundRequestBody({ ...o, contextTokens, bytesPerToken }));
  return { r_max_usd: round6(reserved_usd), inputs: { model: o.model, max_tokens: o.maxTokens, context_tokens: contextTokens, bytes_per_token: bytesPerToken, ...detail } };
}

export const leaseUsd = (perTrial: number, rMaxValue: number): number => round6(perTrial + rMaxValue);

/** The panel cap check discovery.sh runs before every lease: what is settled, what is reserved-unknown, and the whole next lease must fit. */
export function panelCapAllows(o: { settled: number; unknown: number; lease: number; cap: number }): boolean {
  for (const [k, v] of Object.entries(o)) if (!Number.isFinite(v) || v < 0) throw new Error(`${k} must be a non-negative number`);
  return o.settled + o.unknown + o.lease <= o.cap + 1e-9;
}

/** The cap check's inputs from the ledger: the run prefix's settled entries at their committed value and its open reservations at their reserved value. A ledger that does not exist yet is zero. */
export function capInputsFromLedger(ledgerPath: string, runId: string): { settled: number; unknown: number } {
  if (!existsSync(ledgerPath)) return { settled: 0, unknown: 0 };
  const s = ledgerSummary(ledgerPath, runId);
  return { settled: round6(s.committed_usd - s.open_reservations_usd), unknown: s.open_reservations_usd };
}

export interface OrderRow { order: number; trial_id: string; harness: string; task: number; arm: string; trial_index: number; time_budget_s: number }
export const PANEL_TASKS = [1, 2, 3] as const;
export const PANEL_HARNESSES = ['openclaw', 'hermes'] as const;
export const PANEL_ARMS = ['baseline', 'candidate'] as const;
/** The three-arm panel: the no-gstack arm, then the two gstack arms. */
export const PANEL_ARMS_WITH_NONE = ['none', 'baseline', 'candidate'] as const;
const ARM_LISTS: ReadonlyArray<readonly string[]> = [PANEL_ARMS, PANEL_ARMS_WITH_NONE];
export const timeBudgetS = (task: number): number => (task === 3 ? 120 : 600);

/** The fixed interleaving: trial_index outer, then task, then harness, then arm. A pure function of the trial count and the arm
 *  list, which is PANEL_ARMS (the default, the plan's two-arm order) or PANEL_ARMS_WITH_NONE; any other list is refused. */
export function panelOrder(trials: number, arms: readonly string[] = PANEL_ARMS): OrderRow[] {
  if (!Number.isInteger(trials) || trials < 1) throw new Error('--trials must be a positive integer');
  if (!ARM_LISTS.some(l => l.join(',') === arms.join(','))) throw new Error('--arms must be ' + ARM_LISTS.map(l => l.join(',')).join(' or ') + ', got ' + JSON.stringify(arms.join(',')));
  const rows: OrderRow[] = [];
  for (let i = 1; i <= trials; i++) for (const task of PANEL_TASKS) for (const harness of PANEL_HARNESSES) for (const arm of arms) {
    rows.push({ order: rows.length + 1, trial_id: `gsta135-${harness}-t${task}-${arm}-${i}`, harness, task, arm, trial_index: i, time_budget_s: timeBudgetS(task) });
  }
  return rows;
}

/** One usage line of the proxy's --usage-log (metering-proxy.ts log()). */
export interface UsageLine { at: string; key: string; outcome: string; status?: number; reason?: string; reserved_usd?: number; actual_usd?: number; charged_reservation?: boolean }

/**
 * One trial's spend, the shape discovery.sh writes on the row. Forwarded rows
 * settle at actual_usd, except those the proxy charged at their reservation
 * because the upstream answered with no usage (a 5xx that is not the
 * provider's own not-billed error, such as a gateway's 529 page or a 504):
 * those dollars are usd_charged_reservation, outside the trial's $1.00 bar
 * and inside the cap (the ledger committed them). A provider's own 5xx error
 * (an Anthropic 529 overloaded_error, an OpenAI 500 server_error) settles at
 * $0 and is counted in provider_errors. Failed rows (the upstream
 * never answered) keep their reservation as unknown. Refused rows cost nothing
 * and are counted by status and reason; 402 is the lease, except the proxy's
 * "unpriced request" 402, which never touched the lease; 403 is a route or
 * credential the proxy does not allow. With the lease's ledger entries, a
 * lease refusal whose time falls inside another request's reservation
 * (created_at before it, settled_at after it or still open) is concurrent.
 */
export interface Spend { forwarded: number; spent: number; unknown: number; charged_reservations: number; charged_reservation_usd: number; provider_errors: number; refused: number; budget_refusals: number; concurrent_refusals: number; refusals: Record<string, number> }

export function spendFromUsage(lines: UsageLine[], key: string, entries: LedgerEntry[] | null): Spend {
  const mine = lines.filter(l => l.key === key);
  const forwarded = mine.filter(l => l.outcome === 'forwarded');
  const charged = forwarded.filter(l => l.charged_reservation === true);
  const refused = mine.filter(l => l.outcome === 'refused');
  const budget = refused.filter(l => l.status === 402 && !String(l.reason).startsWith('unpriced'));
  const overlaps = (at: string) => (entries ?? []).some(e => Date.parse(e.created_at) <= Date.parse(at) && (e.settled_at === null || Date.parse(e.settled_at) > Date.parse(at)));
  const refusals: Record<string, number> = {};
  for (const l of refused) { const k = `${l.status} ${String(l.reason).slice(0, 120)}`; refusals[k] = (refusals[k] ?? 0) + 1; }
  return {
    forwarded: forwarded.length,
    spent: round6(forwarded.filter(l => l.charged_reservation !== true).reduce((n, l) => n + (l.actual_usd ?? 0), 0)),
    unknown: round6(mine.filter(l => l.outcome === 'failed').reduce((n, l) => n + (l.reserved_usd ?? 0), 0)),
    charged_reservations: charged.length, charged_reservation_usd: round6(charged.reduce((n, l) => n + (l.actual_usd ?? 0), 0)),
    provider_errors: forwarded.filter(l => (l.status ?? 0) >= 500 && l.actual_usd === 0 && String(l.reason ?? '').endsWith(PROVIDER_ERROR_NOT_BILLED)).length,
    refused: refused.length, budget_refusals: budget.length, concurrent_refusals: budget.filter(l => overlaps(l.at)).length, refusals,
  };
}

/** The usage lines of one file, every line parsed (a malformed line is an error, never a zero row); a file that does not exist has none. */
export function readUsage(path: string): UsageLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as UsageLine);
}

/**
 * The row's termination from run-trial.sh's termination, the trial's usage
 * lines and the wrapper log. Order: a degraded gstack runtime first (the trial
 * earns no credit whatever else happened), then the provider: after a
 * reservation the proxy charged in full for an upstream failure (a 5xx with no
 * usage that is not a known provider error, such as a gateway's 529 page) and
 * a lease refusal, or after provider-error 5xx answers the proxy settled at $0
 * (an Anthropic 529 overloaded_error) in a trial that did not complete, it is
 * infra:upstream (the provider failed the trial, not the trial itself). A $0
 * provider error consumed no lease, so a lease refusal after one still counts
 * against the trial. Then lease refusals: when the refused request overlapped
 * an in-flight one it is infra:reservation_refused (the lease assumes serial
 * requests); after a forwarded request the trial failed the $1.00 bar
 * (ceiling:lease); before any, the first reservation did not fit the lease
 * (infra:reservation_refused). Then the output-cap 400 and the empty trial,
 * else run-trial's own word.
 */
export function classifyTermination(resultTermination: string, spend: Spend, wrapperLog: string | null): string {
  if (wrapperLog !== null && /\bruntime: degraded\b/.test(wrapperLog)) return 'infra:runtime';
  if (spend.budget_refusals > 0 && spend.charged_reservations > 0) return 'infra:upstream';
  if (spend.budget_refusals === 0 && (spend.provider_errors ?? 0) > 0 && resultTermination !== 'completed') return 'infra:upstream';
  if (spend.budget_refusals > 0) {
    if (spend.concurrent_refusals > 0) return 'infra:reservation_refused';
    return spend.forwarded > 0 ? 'ceiling:lease' : 'infra:reservation_refused';
  }
  const capRefused = Object.keys(spend.refusals).some(k => /^400 requested \d+ output tokens, above this cell's cap/.test(k));
  if (spend.forwarded === 0 && capRefused) return 'infra:cap_refused';
  if (spend.forwarded === 0) return `infra:no_model_request(${resultTermination})`;
  return resultTermination;
}

/** The panel's spend from the ledger's runs table: every lease named <run id>.<trial id>, open or closed, and their sum. */
export function ledgerSummary(ledgerPath: string, runId: string) {
  const snapshot = readLedger(ledgerPath);
  const prefix = `${runId}.`;
  const runs = snapshot.runs.filter(r => r.run_id.startsWith(prefix)).map(r => {
    const mine = snapshot.entries.filter(e => e.run_id === r.run_id);
    const committed = mine.reduce((n, e) => n + (e.actual_usd ?? e.reserved_usd), 0);
    const open = mine.filter(e => e.actual_usd === null).reduce((n, e) => n + e.reserved_usd, 0);
    return { run_id: r.run_id, trial_id: r.run_id.slice(prefix.length), lease_usd: r.budget_usd, committed_usd: round6(committed), open_reservations_usd: round6(open), requests: mine.length, finished_at: r.finished_at };
  });
  return {
    run_id: runId, ledger: ledgerPath, leases: runs.length, open_leases: runs.filter(r => r.finished_at === null).length,
    committed_usd: round6(runs.reduce((n, r) => n + r.committed_usd, 0)), open_reservations_usd: round6(runs.reduce((n, r) => n + r.open_reservations_usd, 0)),
    requests: runs.reduce((n, r) => n + r.requests, 0), runs,
  };
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (name: string): string | undefined => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const num = (name: string, fallback?: number): number => {
    const v = arg(name);
    if (v === undefined) { if (fallback === undefined) throw new Error(`${name} is required`); return fallback; }
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(v)}`);
    return n;
  };
  try {
    if (cmd === 'r-max') {
      const r = rMax({ model: arg('--model') ?? PANEL_MODEL, maxTokens: num('--max-tokens'), contextTokens: num('--context-tokens', OPUS_CONTEXT_TOKENS), bytesPerToken: num('--bytes-per-token', PROXY_BYTES_PER_TOKEN) });
      const perTrial = num('--per-trial-usd', 1);
      console.log(JSON.stringify({ r_max_usd: r.r_max_usd, lease_usd: leaseUsd(perTrial, r.r_max_usd), per_trial_usd: perTrial, inputs: r.inputs }));
    } else if (cmd === 'order') {
      const arms = arg('--arms');
      console.log(JSON.stringify(panelOrder(num('--trials', 5), arms === undefined ? PANEL_ARMS : arms.split(','))));
    } else if (cmd === 'cap-check') {
      const ledger = arg('--budget-ledger'); const runId = arg('--run-id');
      if ((ledger === undefined) !== (runId === undefined)) throw new Error('--budget-ledger and --run-id go together');
      const inputs = ledger !== undefined ? capInputsFromLedger(ledger, runId!) : { settled: num('--settled'), unknown: num('--unknown') };
      const fits = panelCapAllows({ ...inputs, lease: num('--lease'), cap: num('--cap') });
      console.log(JSON.stringify({ fits, ...inputs }));
      process.exit(fits ? 0 : 1);
    } else if (cmd === 'spend') {
      const usage = arg('--usage'); const key = arg('--key'); const ledger = arg('--budget-ledger'); const leaseId = arg('--lease-id');
      if (!usage || !key) throw new Error('--usage and --key are required');
      if ((ledger === undefined) !== (leaseId === undefined)) throw new Error('--budget-ledger and --lease-id go together');
      const entries = ledger !== undefined && existsSync(ledger) ? readLedger(ledger).entries.filter(e => e.run_id === leaseId) : null;
      console.log(JSON.stringify(spendFromUsage(readUsage(usage), key, entries)));
    } else if (cmd === 'classify') {
      const log = arg('--wrapper-log');
      let text: string | null = null;
      if (log !== undefined) { try { text = readFileSync(log, 'utf8'); } catch { text = null; } }
      console.log(classifyTermination(arg('--termination') ?? 'unknown', JSON.parse(arg('--spend') ?? '') as Spend, text));
    } else if (cmd === 'ledger-summary') {
      const ledger = arg('--budget-ledger'); const runId = arg('--run-id');
      if (!ledger || !runId) throw new Error('--budget-ledger and --run-id are required');
      console.log(JSON.stringify(ledgerSummary(ledger, runId)));
    } else if (cmd === 'placeholder-ceilings') {
      console.log(JSON.stringify({ ...PLACEHOLDER_CEILINGS, per_harness: null, source: 'placeholder (internal-task; ceilings.ts has not run)', derived_at: null }));
    } else {
      throw new Error('usage: lease.ts r-max | order | cap-check | spend | classify | ledger-summary | placeholder-ceilings (see the file head)');
    }
  } catch (e) {
    process.stderr.write(`[lease] ${(e as Error).message}\n`);
    process.exit(64);
  }
}
