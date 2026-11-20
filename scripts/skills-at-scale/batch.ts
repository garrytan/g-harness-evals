// The batch lane for the skills-at-scale labeller and graders (Garry, 2026-11-19: judge and labeller calls go through a
// provider batch API with prompt caching). It follows gbrain-evals' eval/runner/batch/submit.ts pattern (an intent journal,
// a ledger reservation before any submission, submissions only inside runInBatchLane, reconcile before submit, poll that
// joins results by custom id and settles from usage), rebuilt for llm.ts's cache.
//
// A round: reconcile the journal, poll open batches (an ended batch writes each answer into the llm cache under its
// cacheKey, the custom id, and settles its reservation), run the work once with a collecting transport (every cache miss is
// recorded and fails with E_BATCH_PENDING, so the work finishes what the cache already answers), then submit what was
// collected, one batch per provider and model. Callers run rounds until nothing is pending: label-l.ts and adjudicate.ts
// take --batch <dir> and exit 3 while a batch is open. The work's injected transport stays the keyless path.
//
// Bodies are llm.ts requestBody's (Anthropic cache_control on the cached prefix; OpenAI prompt_cache_key over it), so a
// batch answer and a direct answer share one cache entry. The worst case is reserved at list price, and each batch settles
// at its reported usage times BATCH_FACTOR (both providers bill batches at half list). A succeeded answer with no usage is
// charged its worst case; an errored or expired one is free. Intent states: prepared (released on reconcile, never sent),
// sending (adopted when exactly one provider batch matches, else unknown: never resubmitted, reservation held), submitted,
// settled. A request that fails in MAX_FAILURES batches is not sent again and fails with E_BATCH_FAILED.
// Batch calls bypass the metering proxy, which has no batch endpoints: the ledger lease is the meter.

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetRun, installPaidRequestGuard, priceRequest, reservationUsd, runInBatchLane, usageCost, type MeasuredCost } from '../../runner/ledger/budget-ledger.ts';
import { cacheKey, LlmError, requestBody, type CompleteRequest, type Transport } from '../v03/llm.ts';

export const BATCH_FACTOR = 0.5;
export const MAX_FAILURES = 2;
const ADOPT_WINDOW_MS = { before: 5 * 60_000, after: 10 * 60_000 };
const HOST = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com' } as const;

export type Provider = 'anthropic' | 'openai';
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
/** The part of runner/ledger's BudgetRun the lane uses. */
export interface Lease { reserve(usd: number, description: string): string; settle(id: string, actual: MeasuredCost | null): void }
export type BatchItem = { custom_id: string; body: Record<string, unknown> };
export type BatchStatus = { id: string; ended: boolean; status: string; created_at_ms: number; total: number; metadata: Record<string, string> | null; raw: Record<string, any> };
export type BatchResult = { custom_id: string; ok: boolean; text: string | null; usage: Record<string, unknown> | null; error: string | null };
export interface BatchApi {
  create(items: BatchItem[], metadata: Record<string, string>): Promise<BatchStatus>;
  get(id: string): Promise<BatchStatus>;
  list(sinceMs: number): Promise<BatchStatus[]>;
  results(b: BatchStatus): Promise<BatchResult[]>;
}
export type Intent = { intent_id: string; provider: Provider; model: string; custom_ids: string[]; models: Record<string, string>; state: 'prepared' | 'sending' | 'submitted' | 'settled' | 'unknown' | 'abandoned';
  batch_id: string | null; reservation_id: string | null; reserved_usd: number; created_at: number; sending_at: number | null; settled_usd: number | null; failed: string[]; note: string | null };
type Journal = { schema: 'he-skills-at-scale-batch/1'; intents: Intent[]; failures: Record<string, number> };

async function call(f: FetchLike, url: string, init: RequestInit, what: string): Promise<Response> {
  const res = await f(url, init);
  if (!res.ok) throw new LlmError('E_BATCH_' + what + '_' + res.status);
  return res;
}
const jsonl = (text: string) => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, any>);

/** Anthropic Message Batches. The key is read by name at call time and never logged. */
export function anthropicBatches(o: { fetch?: FetchLike } = {}): BatchApi {
  const f: FetchLike = o.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const headers = () => ({ 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
  const base = HOST.anthropic + '/v1/messages/batches';
  const status = (b: Record<string, any>): BatchStatus => {
    const c = b.request_counts ?? {};
    return { id: b.id, ended: b.processing_status === 'ended', status: b.processing_status, created_at_ms: Date.parse(b.created_at ?? '') || 0,
      total: (c.processing ?? 0) + (c.succeeded ?? 0) + (c.errored ?? 0) + (c.canceled ?? 0) + (c.expired ?? 0), metadata: null, raw: b };
  };
  return {
    async create(items) { return status(await (await call(f, base, { method: 'POST', headers: headers(), body: JSON.stringify({ requests: items.map((i) => ({ custom_id: i.custom_id, params: i.body })) }) }, 'CREATE')).json() as any); },
    async get(id) { return status(await (await call(f, base + '/' + id, { headers: headers() }, 'GET')).json() as any); },
    async list(since) { const page = await (await call(f, base + '?limit=100', { headers: headers() }, 'LIST')).json() as { data: any[] }; return page.data.map(status).filter((b) => b.created_at_ms >= since); },
    async results(b) {
      const text = await (await call(f, typeof b.raw.results_url === 'string' ? b.raw.results_url : base + '/' + b.id + '/results', { headers: headers() }, 'RESULTS')).text();
      return jsonl(text).map((l) => {
        const m = l.result?.type === 'succeeded' ? l.result.message : null;
        const text = m && Array.isArray(m.content) ? m.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('') : null;
        return { custom_id: String(l.custom_id), ok: !!text?.trim(), text, usage: m?.usage ?? null, error: m ? (text?.trim() ? null : 'empty response') : String(l.result?.type ?? 'errored') };
      });
    },
  };
}

/** OpenAI Batch over /v1/chat/completions: an uploaded input file, then the batch, the intent id in its metadata. */
export function openaiBatches(o: { fetch?: FetchLike } = {}): BatchApi {
  const f: FetchLike = o.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const auth = () => ({ authorization: 'Bearer ' + (process.env.OPENAI_API_KEY ?? '') });
  const base = HOST.openai + '/v1';
  const status = (b: Record<string, any>): BatchStatus => ({ id: b.id, ended: ['completed', 'failed', 'expired', 'cancelled'].includes(b.status), status: b.status,
    created_at_ms: (b.created_at ?? 0) * 1000, total: b.request_counts?.total ?? 0, metadata: b.metadata ?? null, raw: b });
  return {
    async create(items, metadata) {
      const form = new FormData();
      form.append('purpose', 'batch');
      form.append('file', new Blob([items.map((i) => JSON.stringify({ custom_id: i.custom_id, method: 'POST', url: '/v1/chat/completions', body: i.body })).join('\n') + '\n'], { type: 'application/jsonl' }), 'batch.jsonl');
      const file = await (await call(f, base + '/files', { method: 'POST', headers: auth(), body: form }, 'UPLOAD')).json() as { id: string };
      return status(await (await call(f, base + '/batches', { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ input_file_id: file.id, endpoint: '/v1/chat/completions', completion_window: '24h', metadata }) }, 'CREATE')).json() as any);
    },
    async get(id) { return status(await (await call(f, base + '/batches/' + id, { headers: auth() }, 'GET')).json() as any); },
    async list(since) { const page = await (await call(f, base + '/batches?limit=100', { headers: auth() }, 'LIST')).json() as { data: any[] }; return page.data.map(status).filter((b) => b.created_at_ms >= since); },
    async results(b) {
      const out: BatchResult[] = [];
      for (const k of ['output_file_id', 'error_file_id']) {
        if (typeof b.raw[k] !== 'string' || !b.raw[k]) continue;
        for (const l of jsonl(await (await call(f, base + '/files/' + b.raw[k] + '/content', { headers: auth() }, 'RESULTS')).text())) {
          const body = l.response?.status_code === 200 ? l.response.body : null;
          const text = body?.choices?.[0]?.message?.content;
          out.push({ custom_id: String(l.custom_id), ok: typeof text === 'string' && !!text.trim(), text: typeof text === 'string' ? text : null, usage: body?.usage ?? null, error: body ? (typeof text === 'string' && text.trim() ? null : 'empty response') : JSON.stringify(l.error ?? l.response ?? null).slice(0, 200) });
        }
      }
      return out;
    },
  };
}

/** A transport that answers nothing: each request it is asked for is recorded (once) and fails with E_BATCH_PENDING. */
export function collectingTransport(skip: { open: Set<string>; failures: Record<string, number> }) {
  const pending = new Map<string, CompleteRequest>();
  const transport: Transport = async (req) => {
    const id = cacheKey(req);
    if ((skip.failures[id] ?? 0) >= MAX_FAILURES) throw new LlmError('E_BATCH_FAILED');
    if (!skip.open.has(id)) pending.set(id, req);
    throw new LlmError('E_BATCH_PENDING');
  };
  return { transport, pending };
}

function save(path: string, j: Journal) {
  const tmp = path + '.' + process.pid + '.tmp';
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, JSON.stringify(j, null, 1) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

const worstUsd = (provider: Provider, body: Record<string, unknown>) => {
  const price = priceRequest(HOST[provider] + (provider === 'openai' ? '/v1/chat/completions' : '/v1/messages'), body);
  if (!price) throw new LlmError('E_BATCH_UNPRICED');
  return { price, usd: reservationUsd(price) };
};

export async function batchRound<R>(o: { dir: string; cacheDir: string; lease: () => Lease; apis: Record<Provider, BatchApi>; work: (t: Transport) => Promise<R>; now?: () => number; log?: (line: string) => void }) {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  mkdirSync(o.dir, { recursive: true });
  mkdirSync(o.cacheDir, { recursive: true });
  const path = join(o.dir, 'batches.json');
  const j: Journal = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schema: 'he-skills-at-scale-batch/1', intents: [], failures: {} };
  const set = (i: Intent, fields: Partial<Intent>) => { Object.assign(i, fields); save(path, j); };
  let lease: Lease | null = null;
  const run = () => (lease ??= o.lease());

  for (const i of j.intents.filter((x) => x.state === 'prepared')) {
    if (i.reservation_id) run().settle(i.reservation_id, { usd: 0, input_tokens: 0, output_tokens: 0 });
    set(i, { state: 'abandoned', settled_usd: 0, note: 'stopped before sending; reservation released' });
    log('reconcile: intent ' + i.intent_id + ' never reached the provider; released');
  }
  for (const i of j.intents.filter((x) => x.state === 'sending')) {
    const claimed = new Set(j.intents.map((x) => x.batch_id).filter(Boolean));
    const at = i.sending_at ?? i.created_at;
    const listed = (await o.apis[i.provider].list(at - ADOPT_WINDOW_MS.before)).filter((b) => !claimed.has(b.id) && b.created_at_ms <= at + ADOPT_WINDOW_MS.after);
    const ids = new Set(i.custom_ids);
    const matches: BatchStatus[] = [];
    for (const b of listed) {
      if (i.provider === 'openai') { if (b.metadata?.intent_id === i.intent_id) matches.push(b); continue; }
      if (b.total !== i.custom_ids.length) continue;
      if (!b.ended || (await o.apis.anthropic.results(b)).every((r) => ids.has(r.custom_id))) matches.push(b);
    }
    if (matches.length === 1) set(i, { state: 'submitted', batch_id: matches[0]!.id, note: 'adopted on reconcile' });
    else set(i, { state: 'unknown', note: matches.length + ' provider batches match; not resubmitted, reservation held; check the provider console' });
    log('reconcile: intent ' + i.intent_id + ' is ' + i.state);
  }

  for (const i of j.intents.filter((x) => x.state === 'submitted')) {
    const b = await o.apis[i.provider].get(i.batch_id!);
    if (!b.ended) continue;
    const ids = new Set(i.custom_ids);
    const seen = new Map<string, BatchResult>();
    for (const r of await o.apis[i.provider].results(b)) {
      if (!ids.has(r.custom_id)) throw new LlmError('E_BATCH_UNKNOWN_ID');
      const prev = seen.get(r.custom_id);
      if (prev && JSON.stringify(prev) !== JSON.stringify(r)) throw new LlmError('E_BATCH_CONFLICTING_RESULTS');
      seen.set(r.custom_id, r);
    }
    let usd = 0, input = 0, output = 0;
    const failed: string[] = [];
    for (const id of i.custom_ids) {
      const r = seen.get(id);
      if (r?.ok) writeFileSync(join(o.cacheDir, id + '.json'), JSON.stringify({ model: i.models[id], text: r.text }) + '\n');
      else { failed.push(id); j.failures[id] = (j.failures[id] ?? 0) + 1; }
      if (!r?.ok && !r?.usage) continue;
      const worst = worstUsd(i.provider, requestBody({ model: i.models[id] as CompleteRequest['model'], system: '', prompt: '', maxTokens: 0 }).body);
      const cost = r.usage ? usageCost(worst.price, { usage: r.usage }) : null;
      if (cost) { usd += cost.usd * BATCH_FACTOR; input += cost.input_tokens; output += cost.output_tokens; }
      else usd += i.reserved_usd / i.custom_ids.length;
    }
    run().settle(i.reservation_id!, { usd, input_tokens: input, output_tokens: output });
    set(i, { state: 'settled', settled_usd: Number(usd.toFixed(6)), failed, note: b.status });
    log('batch ' + i.batch_id + ' ended (' + b.status + '): ' + (i.custom_ids.length - failed.length) + ' answered, ' + failed.length + ' failed, $' + usd.toFixed(4));
  }

  const open = new Set(j.intents.filter((x) => x.state === 'submitted' || x.state === 'unknown').flatMap((x) => x.custom_ids));
  const c = collectingTransport({ open, failures: j.failures });
  const result = await o.work(c.transport);

  const groups = new Map<string, Array<[string, CompleteRequest]>>();
  for (const [id, req] of c.pending) groups.set(req.model, [...(groups.get(req.model) ?? []), [id, req]]);
  const submitted: Intent[] = [];
  for (const [model, reqs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const provider = model.split(':')[0] as Provider;
    const items = reqs.map(([id, req]) => ({ custom_id: id, body: requestBody(req).body }));
    const reserved = items.reduce((s, x) => s + worstUsd(provider, x.body).usd, 0);
    const i: Intent = { intent_id: 'i' + randomUUID().replace(/-/g, '').slice(0, 12), provider, model, custom_ids: items.map((x) => x.custom_id), models: Object.fromEntries(reqs.map(([id, r]) => [id, r.model])),
      state: 'prepared', batch_id: null, reservation_id: null, reserved_usd: Number(reserved.toFixed(6)), created_at: now(), sending_at: null, settled_usd: null, failed: [], note: null };
    j.intents.push(i);
    save(path, j);
    let reservation: string;
    try { reservation = run().reserve(reserved, 'batch ' + i.intent_id + ': ' + items.length + ' ' + model + ' requests, worst case at list price'); }
    catch (e) { set(i, { state: 'abandoned', note: 'reservation refused' }); throw e; }
    set(i, { reservation_id: reservation, state: 'sending', sending_at: now() });
    const b = await runInBatchLane(reservation, () => o.apis[provider].create(items, { intent_id: i.intent_id, lane: 'harness-evals-skills-at-scale' }));
    set(i, { state: 'submitted', batch_id: b.id });
    submitted.push(i);
    log('submitted ' + items.length + ' ' + model + ' requests as ' + b.id + ' (intent ' + i.intent_id + ', reserved $' + reserved.toFixed(4) + ')');
  }
  const waiting = j.intents.filter((x) => x.state === 'submitted' || x.state === 'unknown');
  return { result, done: !waiting.length, submitted, waiting, unknown: waiting.filter((x) => x.state === 'unknown').map((x) => x.intent_id),
    failed: Object.entries(j.failures).filter(([, n]) => n >= MAX_FAILURES).map(([id]) => id), settled_usd: Number(j.intents.reduce((s, x) => s + (x.settled_usd ?? 0), 0).toFixed(6)) };
}

/** One CLI round with the real batch APIs: the lease <dir>/ledger.sqlite (resumed on every round) and the paid-request
 *  guard, so a submission outside the batch lane is refused. Prints BATCH lines; returns 3 while a batch is open. */
export async function batchCli<R>(o: { dir: string; cacheDir: string; runId: string; leaseUsd: number; work: (t: Transport) => Promise<R> }) {
  const r = await batchRound({ dir: o.dir, cacheDir: o.cacheDir, apis: { anthropic: anthropicBatches(), openai: openaiBatches() }, work: o.work, log: (l) => console.log('BATCH ' + l),
    lease: () => { const run = BudgetRun.openLease({ runId: o.runId, leaseUsd: o.leaseUsd, ledgerPath: join(o.dir, 'ledger.sqlite'), runner: 'skills-at-scale-batch' }); installPaidRequestGuard(run); return run; } });
  console.log('BATCH_ROUND done=' + r.done + ' submitted=' + r.submitted.reduce((s, i) => s + i.custom_ids.length, 0) + ' waiting_batches=' + r.waiting.length + ' unknown=' + r.unknown.length + ' failed=' + r.failed.length + ' settled_usd=' + r.settled_usd);
  return { ...r, exit: r.done ? 0 : 3 };
}
