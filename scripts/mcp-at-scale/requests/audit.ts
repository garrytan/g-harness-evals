#!/usr/bin/env bun
// The ambiguity audit of the request sets (internal-task plan, decision G, and the 2026-11-19 batch-routing change): GPT-6 Astra
// and Claude Opus 5.5 each list every tool in the 300-tool catalog that a request's text allows; a tool either lists outside
// the author's set (or a no-tool disagreement) is queued for Gemini 4 Carbon, a third family, which rules it acceptable
// (the item's acceptable set widens), not acceptable, or ambiguous (the item is dropped). An answer with no tool ruled
// acceptable for a request that needs one drops the item too, as ambiguous. A set T task is never widened, since its
// acceptable entry is the chain's last step and it is graded on end state: a tool ruled acceptable for it is listed
// under t_alternatives in audit-status.json, and the task, which now has a real substitute for one of its steps, is
// marked replace until it is rewritten. A near-twin bait item is never dropped or widened because a judge picked its twin. Drop counts are reported per stratum.
//
// Labelling goes through the providers' batch APIs with prompt caching: the catalog is a
// shared prefix (Anthropic cache_control on the system block, OpenAI prompt_cache_key over the system message; Gemini 4
// Carbon refuses explicit caching, so each adjudication request carries the prefix as its system instruction). The pattern is gbrain-evals' eval/runner/batch/submit.ts (read,
// not imported): an intent journal written before anything is sent, the worst case reserved in the ledger before the
// batch is created, creation inside runInBatchLane, results joined by custom id, and settlement from reported usage at the
// batch price (half list).
//
//   bun scripts/mcp-at-scale/requests/audit.ts label      --sets <set.jsonl>... --catalog <dir> --out <dir> --dry-run
//   bun scripts/mcp-at-scale/requests/audit.ts adjudicate --sets <set.jsonl>... --catalog <dir> --out <dir> --dry-run
//   bun scripts/mcp-at-scale/requests/audit.ts adjudicate ... --ledger <f> --run-id <id> --lease-usd <usd>
//       (Gemini 4 Carbon one request at a time through the paid-request guard; see adjudicateInteractive)
//   bun scripts/mcp-at-scale/requests/audit.ts label ... --ledger <ledger.sqlite> --run-id <id> --lease-usd <usd>
//   bun scripts/mcp-at-scale/requests/audit.ts collect    --out <dir> --stage label|adjudicate --ledger <file> --run-id <id> --lease-usd <usd>
//   bun scripts/mcp-at-scale/requests/audit.ts apply      --sets <set.jsonl>... --out <dir>
//
// --dry-run writes <out>/<stage>/batches/<provider>-<model>.jsonl (the exact lines each provider takes) and
// <out>/<stage>/manifest.json (custom id map, sha256 of every file and of the cached prefix, a worst-case
// list-price estimate per batch) and makes no network call. Without it, submit sends each batch once: confirmed submissions
// are skipped on retry and uncertain submissions require reconciliation. collect fetches ended batches, writes
// <out>/<stage>/answers.jsonl and settles each reservation. apply writes <out>/audit-status.json (per item: passed, widened,
// dropped, replace or pending; pilot-gates.ts reads it) and <out>/audited/<set>.jsonl with widened acceptable sets.
// Keys are read by name at call time and never printed.
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatPrice } from '../../../runner/ledger/budget-ledger.ts';
import { loadCatalog } from '../catalog-load.ts';
import { catalogListing, render, template, type GbrainTool } from './prompts.ts';
import { itemSha, readJsonl, type Acceptable, type Item } from './sets.ts';

export type Provider = 'anthropic' | 'openai' | 'gemini';
export type Stage = 'label' | 'adjudicate';
export interface AuditStatus { items: Record<string, string>; audited_item_sha256: Record<string, string> }
export interface ModelSpec { name: string; provider: Provider; model: string; price_id: string; max_output: number }
export const JUDGES: ModelSpec[] = [
  { name: 'opus', provider: 'anthropic', model: 'claude-opus-5-5', price_id: 'anthropic:claude-opus-5-5', max_output: 4096 },
  { name: 'astra', provider: 'openai', model: 'gpt-6-astra', price_id: 'openai:gpt-6-astra', max_output: 8000 },
];
export const ADJUDICATOR: ModelSpec = { name: 'carbon', provider: 'gemini', model: 'gemini-4-carbon', price_id: 'google:gemini-4-carbon', max_output: 16384 };
export const BATCH_FACTOR = 0.5;
export const NO_TOOL = '(no tool)';
const HOST = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', gemini: 'https://generativelanguage.googleapis.com' } as const;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tokens = (s: string) => Math.ceil(s.length / 4);
const batchUnsupported = 'HE-MCP-026 Gemini batch adjudication is not supported; use interactive adjudication';

/** The tools an item's author named: set R and G acceptable tools, every step of a set T task, none for a no-tool request. */
export const authorTools = (it: Item): string[] => (it.set === 'T' ? it.fixtures.map((f) => f.server + '/' + f.tool) : it.acceptable.map((a) => a.server + '/' + a.tool));
export const customId = (stage: Stage, item: string, tool = '') => (stage === 'label' ? 'l' : 'a') + '-' + sha(item + '\u0000' + tool).slice(0, 32);

export interface QueueEntry { item: string; tool: string; judges: string[] }
export interface BatchPlan { provider: Provider; model: string; judge: string; file: string; lines: object[]; requests: Array<{ custom_id: string; item: string; tool: string | null }>; worst_case_list_usd: number }

function body(spec: ModelSpec, prefix: string, user: string): object {
  if (spec.provider === 'anthropic') return { model: spec.model, max_tokens: spec.max_output, system: [{ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] };
  if (spec.provider === 'openai') return { model: spec.model, max_completion_tokens: spec.max_output, reasoning_effort: 'low', prompt_cache_key: 'he-mcp-audit-' + sha(prefix).slice(0, 16), response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prefix }, { role: 'user', content: user }] };
  return { systemInstruction: { parts: [{ text: prefix }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: spec.max_output } };
}
const line = (spec: ModelSpec, custom_id: string, b: object) => (spec.provider === 'anthropic' ? { custom_id, params: b } : spec.provider === 'openai' ? { custom_id, method: 'POST', url: '/v1/chat/completions', body: b } : { key: custom_id, request: b });

/** Worst case at list price: every input token at the dearer of input and cache write, plus the full output allowance. */
export function worstCase(spec: ModelSpec, prefixTokens: number, userTokens: number[]): number {
  const p = chatPrice(spec.price_id);
  if (!p) throw new Error('HE-MCP-022 no price for ' + spec.price_id);
  const inPrice = Math.max(p.input, p.cache_write ?? 0);
  return userTokens.reduce((s, u) => s + ((prefixTokens + u) * inPrice + spec.max_output * p.output) / 1e6, 0);
}

const labelUser = (it: Item) => 'Request id ' + it.id + ':\n' + it.text;
const adjUser = (it: Item, tool: string) => 'Request id ' + it.id + ':\n' + it.text + '\n\nThe author\'s tool(s): ' + (authorTools(it).join(', ') || NO_TOOL) + '\nThe disputed tool: ' + tool;

/** The judges' listing for set G: the 150 rung the gbrain arm runs on, plus every tool of gbrain's full surface. */
export function gbrainListing(cat: ReturnType<typeof loadCatalog>, tools: GbrainTool[]): string {
  const req = (s?: Record<string, any>) => (Array.isArray(s?.required) ? s!.required.join(', ') : 'none');
  return catalogListing(cat, '150') + '\n' + tools.map((t) => '- gbrain/' + t.name + ': ' + (t.description ?? '').replace(/\s+/g, ' ').trim() + '; required: ' + req(t.inputSchema)).join('\n');
}

export function planStage(o: { stage: Stage; items: Item[]; catalogText: string; queue?: QueueEntry[]; labelManifestSha?: string }) {
  const prompt = template('audit-' + o.stage);
  const prefix = render(prompt, { catalog: o.catalogText });
  const byId = new Map(o.items.map((i) => [i.id, i]));
  const work = o.stage === 'label' ? o.items.map((it) => ({ it, tool: null as string | null, user: labelUser(it) }))
    : (o.queue ?? []).map((q) => ({ it: byId.get(q.item)!, tool: q.tool, user: adjUser(byId.get(q.item)!, q.tool) }));
  const specs = o.stage === 'label' ? JUDGES : [ADJUDICATOR];
  const batches = specs.map((spec): BatchPlan => {
    const requests = work.map((w) => ({ custom_id: customId(o.stage, w.it.id, w.tool ?? ''), item: w.it.id, tool: w.tool }));
    const lines = work.map((w, k) => line(spec, requests[k]!.custom_id, body(spec, prefix, w.user)));
    return { provider: spec.provider, model: spec.model, judge: spec.name, file: spec.provider + '-' + spec.model + '.jsonl', lines, requests,
      worst_case_list_usd: Number(worstCase(spec, tokens(prefix), work.map((w) => tokens(w.user))).toFixed(4)) };
  });
  return { prefix, batches, catalog_sha256: sha(o.catalogText), prompt_sha256: sha(prompt),
    item_sha256: Object.fromEntries(o.items.map((it) => [it.id, itemSha(it)])), label_manifest_sha256: o.labelManifestSha ?? null };
}

/** Writes the batch files and the manifest. No network. */
export function writeStage(out: string, stage: Stage, plan: ReturnType<typeof planStage>) {
  const dir = join(out, stage, 'batches');
  mkdirSync(dir, { recursive: true });
  const files = plan.batches.map((b) => {
    const text = b.lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    writeFileSync(join(dir, b.file), text);
    return { provider: b.provider, model: b.model, judge: b.judge, file: 'batches/' + b.file, requests: b.requests.length, sha256: sha(text), worst_case_list_usd: b.worst_case_list_usd, batch_factor: BATCH_FACTOR };
  });
  const manifest = { schema: 'he-mcp-at-scale-audit/2', stage, prefix_sha256: sha(plan.prefix), prefix_tokens_estimate: tokens(plan.prefix), batches: files,
    catalog_sha256: plan.catalog_sha256, prompt_sha256: plan.prompt_sha256, item_sha256: plan.item_sha256, label_manifest_sha256: plan.label_manifest_sha256,
    custom_ids: Object.fromEntries(plan.batches[0]?.requests.map((r) => [r.custom_id, { item: r.item, tool: r.tool }]) ?? []),
    worst_case_list_usd: Number(files.reduce((s, f) => s + f.worst_case_list_usd, 0).toFixed(4)) };
  writeFileSync(join(out, stage, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

type Manifest = ReturnType<typeof writeStage>;
type ManifestBatch = Manifest['batches'][number];
function readManifest(out: string, stage: Stage): Manifest {
  const manifest: Manifest = JSON.parse(readFileSync(join(out, stage, 'manifest.json'), 'utf8'));
  if (manifest.stage !== stage) throw new Error('HE-MCP-024 expected a ' + stage + ' manifest');
  return manifest;
}
const manifestSha = (m: Manifest) => sha(JSON.stringify(m));
const jsonl = (text: string): any[] => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const sameIds = (ids: string[], expected: string[]) => {
  const actual = new Set(ids);
  return ids.length === expected.length && actual.size === expected.length && expected.every((id) => actual.has(id));
};

function readBatch(out: string, manifest: Manifest, b: ManifestBatch): any[] {
  const text = readFileSync(join(out, manifest.stage, b.file), 'utf8');
  if (sha(text) !== b.sha256) throw new Error('HE-MCP-024 ' + b.file + ' does not match the manifest; rewrite it with --dry-run first');
  const lines = jsonl(text);
  if (manifest.schema !== 'he-mcp-at-scale-audit/2' || lines.length !== b.requests || !sameIds(lines.map((l) => b.provider === 'gemini' ? l.key : l.custom_id), Object.keys(manifest.custom_ids))) {
    throw new Error('HE-MCP-024 ' + b.file + ' request IDs do not match the manifest; rewrite it with --dry-run first');
  }
  return lines;
}

// ---- submit and collect ----

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
/** The part of runner/ledger's BudgetRun the lane uses. */
export interface Lease { reserve(usd: number, description: string): string; settle(id: string, actual: { usd: number; input_tokens?: number | null; output_tokens?: number | null } | null): void }
export interface Intent { intent_id: string; provider: Provider; model: string; judge: string; file: string; file_sha256: string; state: 'prepared' | 'sending' | 'submitted' | 'settled' | 'abandoned' | 'unknown';
  manifest_sha256: string; request_ids: string[]; reservation_id: string | null; reserved_usd: number; batch_id: string | null; cache_name: string | null; settled_usd: number | null }
type Journal = { schema: 'he-mcp-at-scale-audit-journal/1'; intents: Intent[] };

const keyHeader = (p: Provider): Record<string, string> => p === 'anthropic' ? { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' }
  : p === 'openai' ? { authorization: 'Bearer ' + (process.env.OPENAI_API_KEY ?? '') } : { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' };
async function call(f: FetchLike, p: Provider, url: string, init: RequestInit = {}, raw = false): Promise<any> {
  const res = await f(url, { ...init, headers: { ...keyHeader(p), ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new Error('HE-MCP-023 ' + p + ' ' + (init.method ?? 'GET') + ' ' + new URL(url).pathname + ' answered ' + res.status);
  const text = await res.text();
  if (raw) return text;
  try { return JSON.parse(text); } catch { return text; }
}

const journalPath = (out: string, stage: Stage) => join(out, stage, 'journal.json');
const readJournal = (out: string, stage: Stage): Journal => (existsSync(journalPath(out, stage)) ? JSON.parse(readFileSync(journalPath(out, stage), 'utf8')) : { schema: 'he-mcp-at-scale-audit-journal/1', intents: [] });
const saveJournal = (out: string, stage: Stage, j: Journal) => writeFileSync(journalPath(out, stage), JSON.stringify(j, null, 1) + '\n');

const newIntent = (b: ManifestBatch, manifest: Manifest, interactive = false): Intent => ({
  intent_id: randomUUID(), provider: b.provider, model: b.model, judge: b.judge, file: b.file, file_sha256: b.sha256,
  manifest_sha256: manifestSha(manifest), request_ids: Object.keys(manifest.custom_ids), state: interactive ? 'sending' : 'prepared',
  reservation_id: null, reserved_usd: interactive ? 0 : b.worst_case_list_usd, batch_id: null, cache_name: null, settled_usd: null,
});

async function create(f: FetchLike, i: Intent, lines: any[]): Promise<{ batch_id: string; cache_name: string | null }> {
  if (i.provider === 'anthropic') return { batch_id: (await call(f, 'anthropic', HOST.anthropic + '/v1/messages/batches', { method: 'POST', body: JSON.stringify({ requests: lines }) })).id, cache_name: null };
  if (i.provider === 'openai') {
    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([lines.map((l) => JSON.stringify(l)).join('\n') + '\n'], { type: 'application/jsonl' }), 'batch-input.jsonl');
    const file = await call(f, 'openai', HOST.openai + '/v1/files', { method: 'POST', body: form });
    return { batch_id: (await call(f, 'openai', HOST.openai + '/v1/batches', { method: 'POST', body: JSON.stringify({ input_file_id: file.id, endpoint: '/v1/chat/completions', completion_window: '24h', metadata: { intent_id: i.intent_id } }) })).id, cache_name: null };
  }
  throw new Error(batchUnsupported);
}

/** Sends each batch of a stage once, in the order: journal, reserve, sending, create inside the lane, submitted. */
export async function submitStage(o: { out: string; stage: Stage; fetch: FetchLike; lease: Lease; inLane?: <T>(reservation: string, fn: () => Promise<T>) => Promise<T> }): Promise<Intent[]> {
  if (o.stage === 'adjudicate') throw new Error(batchUnsupported);
  const manifest = readManifest(o.out, o.stage);
  if (manifest.batches.some((b) => b.provider === 'gemini')) throw new Error(batchUnsupported);
  const batches = manifest.batches.map((b) => ({ b, lines: readBatch(o.out, manifest, b) }));
  const digest = manifestSha(manifest);
  const journal = readJournal(o.out, o.stage);
  const sent: Intent[] = [];
  const uncertain: string[] = [];
  let skipped = 0;
  for (const { b, lines } of batches) {
    if (!lines.length) continue;
    const prior = journal.intents.find((i) => i.file === b.file && i.file_sha256 === b.sha256 && (!i.manifest_sha256 || i.manifest_sha256 === digest) && i.state !== 'abandoned');
    if (prior && (prior.state === 'submitted' || prior.state === 'settled') && prior.batch_id) { skipped++; continue; }
    if (prior && (prior.state !== 'prepared' || prior.reservation_id)) { uncertain.push(prior.intent_id); continue; }
    const intent = prior?.manifest_sha256 ? prior : newIntent(b, manifest);
    if (intent !== prior) {
      if (prior) prior.state = 'abandoned';
      journal.intents.push(intent);
      saveJournal(o.out, o.stage, journal);
    }
    try {
      intent.reservation_id = o.lease.reserve(b.worst_case_list_usd, 'mcp-at-scale audit ' + o.stage + ' ' + b.provider + ':' + b.model + ' intent ' + intent.intent_id);
    } catch (e) { intent.state = 'abandoned'; saveJournal(o.out, o.stage, journal); throw e; }
    intent.state = 'sending'; saveJournal(o.out, o.stage, journal);
    try {
      const r = await (o.inLane ?? ((_r, fn) => fn()))(intent.reservation_id, () => create(o.fetch, intent, lines));
      if (typeof r.batch_id !== 'string' || !r.batch_id) throw new Error('HE-MCP-025 provider returned no batch id for intent ' + intent.intent_id);
      Object.assign(intent, r, { state: 'submitted' });
    } catch (e) { intent.state = 'unknown'; saveJournal(o.out, o.stage, journal); throw e; }
    saveJournal(o.out, o.stage, journal);
    sent.push(intent);
  }
  if (uncertain.length) throw new Error('HE-MCP-025 reconcile uncertain submission intents before retrying them: ' + uncertain.join(', '));
  if (!sent.length && skipped) throw new Error('HE-MCP-025 all batches already submitted; a batch is sent once');
  return sent;
}

/** Batch-price cost from reported usage. */
export function usageUsd(spec: ModelSpec, usage: Record<string, any> | null): { usd: number; input_tokens: number; output_tokens: number } | null {
  const p = chatPrice(spec.price_id);
  if (!usage || !p) return null;
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  let fresh: number, write = 0, read: number, out: number;
  if (spec.provider === 'anthropic') {
    ({ input_tokens: fresh, output_tokens: out } = usage);
    write = usage.cache_creation_input_tokens ?? 0;
    read = usage.cache_read_input_tokens ?? 0;
  } else if (spec.provider === 'openai') {
    ({ completion_tokens: out } = usage);
    read = usage.prompt_tokens_details?.cached_tokens ?? 0;
    if (!valid(usage.prompt_tokens) || !valid(read)) return null;
    fresh = usage.prompt_tokens - read;
  } else {
    const { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, cachedContentTokenCount = 0 } = usage;
    if (!valid(promptTokenCount) || !valid(cachedContentTokenCount) || !(valid(candidatesTokenCount) || valid(thoughtsTokenCount))) return null;
    if (!valid(candidatesTokenCount === undefined ? 0 : candidatesTokenCount) || !valid(thoughtsTokenCount === undefined ? 0 : thoughtsTokenCount)) return null;
    read = cachedContentTokenCount;
    fresh = promptTokenCount - read;
    out = (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0);
  }
  if (![fresh, write, read, out].every(valid)) return null;
  const usd = (fresh * p.input + write * (p.cache_write ?? p.input) + read * (p.cache_read ?? p.input) + out * p.output) / 1e6 * BATCH_FACTOR;
  return { usd, input_tokens: fresh + write + read, output_tokens: out };
}

type Answer = { custom_id: string; text: string | null; usage: Record<string, any> | null; error: string | null };
type AnswerRow = Answer & { judge: string; intent_id: string; manifest_sha256: string };
const answerPath = (out: string, stage: Stage) => join(out, stage, 'answers.jsonl');
const answerRows = (out: string, stage: Stage) => existsSync(answerPath(out, stage)) ? readJsonl<AnswerRow>(answerPath(out, stage)) : [];
const writeAnswers = (out: string, stage: Stage, i: Intent, answers: Answer[]) => {
  if (answers.length) appendFileSync(answerPath(out, stage), answers.map((a) => JSON.stringify({ ...a, judge: i.judge, intent_id: i.intent_id, manifest_sha256: i.manifest_sha256 })).join('\n') + '\n');
};

function measuredUsage(spec: ModelSpec, answers: Answer[]) {
  const cost = { usd: 0, input_tokens: 0, output_tokens: 0 };
  for (const a of answers) {
    const c = usageUsd(spec, a.usage);
    if (!c) return null;
    cost.usd += c.usd;
    cost.input_tokens += c.input_tokens;
    cost.output_tokens += c.output_tokens;
  }
  return cost;
}

const geminiText = (r: any): string | null => r?.candidates?.[0]?.content?.parts?.filter((p: any) => p.thought !== true).map((p: any) => p.text ?? '').join('') ?? null;

async function results(f: FetchLike, i: Intent): Promise<Answer[] | null> {
  if (i.provider === 'anthropic') {
    const b = await call(f, 'anthropic', HOST.anthropic + '/v1/messages/batches/' + i.batch_id);
    if (b.processing_status !== 'ended') return null;
    const text = await call(f, 'anthropic', b.results_url ?? HOST.anthropic + '/v1/messages/batches/' + i.batch_id + '/results', {}, true);
    return jsonl(text).map((l) => {
      const m = l.result?.type === 'succeeded' ? l.result.message : null;
      return { custom_id: l.custom_id, text: m ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') : null, usage: m?.usage ?? null, error: m ? null : String(l.result?.type ?? 'errored') };
    });
  }
  if (i.provider === 'openai') {
    const b = await call(f, 'openai', HOST.openai + '/v1/batches/' + i.batch_id);
    if (!['completed', 'failed', 'expired', 'cancelled'].includes(b.status)) return null;
    const out: Answer[] = [];
    for (const k of ['output_file_id', 'error_file_id']) if (b[k]) {
      const text = await call(f, 'openai', HOST.openai + '/v1/files/' + b[k] + '/content', {}, true);
      for (const l of jsonl(text)) {
        const ok = l.response?.status_code === 200;
        out.push({ custom_id: l.custom_id, text: ok ? l.response.body?.choices?.[0]?.message?.content ?? null : null, usage: l.response?.body?.usage ?? null, error: ok ? null : JSON.stringify(l.error ?? l.response?.body?.error ?? null).slice(0, 300) });
      }
    }
    return out;
  }
  const op = await call(f, 'gemini', HOST.gemini + '/v1beta/' + i.batch_id);
  if (!op.done) return null;
  const inl = op.response?.inlinedResponses?.inlinedResponses ?? op.metadata?.output?.inlinedResponses?.inlinedResponses ?? [];
  return inl.map((r: any) => ({ custom_id: r.metadata?.key, text: geminiText(r.response), usage: r.response?.usageMetadata ?? null, error: r.error ? JSON.stringify(r.error).slice(0, 300) : null }));
}

/** Fetches ended batches, appends their answers and settles each reservation from usage at the batch price. */
export async function collectStage(o: { out: string; stage: Stage; fetch: FetchLike; lease: Lease }): Promise<{ settled: number; open: number }> {
  const journal = readJournal(o.out, o.stage);
  let settled = 0, open = journal.intents.filter((i) => i.reservation_id && (i.state === 'sending' || i.state === 'unknown')).length;
  for (const i of journal.intents.filter((x) => x.state === 'submitted')) {
    const spec = [...JUDGES, ADJUDICATOR].find((s) => s.name === i.judge && s.provider === i.provider && s.model === i.model);
    if (!spec || !i.batch_id || !i.reservation_id || !i.manifest_sha256 || !i.request_ids?.length) { open++; continue; }
    const answers = await results(o.fetch, i);
    if (!answers || !sameIds(answers.map((a) => a.custom_id), i.request_ids)) { open++; continue; }
    const cost = measuredUsage(spec, answers);
    if (!cost) { open++; continue; }
    writeAnswers(o.out, o.stage, i, answers);
    o.lease.settle(i.reservation_id, cost);
    Object.assign(i, { state: 'settled', settled_usd: Number(cost.usd.toFixed(6)) });
    saveJournal(o.out, o.stage, journal);
    settled++;
  }
  return { settled, open };
}

/** The guard reserves and settles each Gemini call at list price. Reruns send only requests without a verdict. */
export async function adjudicateInteractive(o: { out: string; fetch: FetchLike; concurrency?: number }): Promise<{ answers: number; errors: number; usd: number | null }> {
  const manifest = readManifest(o.out, 'adjudicate');
  const b = manifest.batches.find((x) => x.provider === 'gemini');
  if (!b) throw new Error('HE-MCP-026 the adjudicate stage has no Gemini batch');
  const requests = readBatch(o.out, manifest, b) as { key: string; request: object }[];
  const digest = manifestSha(manifest);
  const journal = readJournal(o.out, 'adjudicate');
  const prior = journal.intents.find((i) => i.manifest_sha256 === digest && i.file_sha256 === b.sha256 && i.state !== 'abandoned');
  if (prior && !(prior.state === 'sending' && prior.batch_id === null && prior.reservation_id === null)) throw new Error('HE-MCP-025 ' + b.file + ' was already sent as intent ' + prior.intent_id + ' (' + prior.state + '); a request set is sent once');
  const intent = prior ?? newIntent(b, manifest, true);
  if (!prior) { journal.intents.push(intent); saveJournal(o.out, 'adjudicate', journal); }
  const previous = answerRows(o.out, 'adjudicate').filter((a) => belongsTo(a, intent));
  const done = new Set(previous.filter((a) => parsedAnswer('adjudicate', a)).map((a) => a.custom_id));
  const lines = requests.filter((l) => !done.has(l.key));
  const answers: Answer[] = [];
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < lines.length; k = next++) {
      const l = lines[k]!;
      let a: Answer;
      try {
        const r = await call(o.fetch, 'gemini', HOST.gemini + '/v1beta/models/' + b.model + ':generateContent', { method: 'POST', body: JSON.stringify(l.request) });
        a = { custom_id: l.key, text: geminiText(r), usage: r?.usageMetadata ?? null, error: null };
        if (!parsedAnswer('adjudicate', a)) a.error = 'Gemini returned no valid verdict';
      } catch (e) { a = { custom_id: l.key, text: null, usage: null, error: String((e as Error).message).slice(0, 300) }; }
      answers.push(a);
      writeAnswers(o.out, 'adjudicate', intent, [a]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, worker));
  const errors = answers.filter((a) => a.error).length;
  const cost = measuredUsage(ADJUDICATOR, answers);
  if (!errors) {
    const total = measuredUsage(ADJUDICATOR, [...previous, ...answers]);
    Object.assign(intent, { state: 'settled', settled_usd: total ? Number((total.usd / BATCH_FACTOR).toFixed(6)) : null });
    saveJournal(o.out, 'adjudicate', journal);
  }
  return { answers: answers.length, errors, usd: cost ? cost.usd / BATCH_FACTOR : null };
}

// ---- applying the audit ----

export type Label = { no_tool_needed: boolean; acceptable: string[] };
export type Verdict = { verdict: 'acceptable' | 'not_acceptable' | 'ambiguous'; required?: Record<string, unknown> | null };
const firstJson = (t: string | null) => { if (typeof t !== 'string') return null; const m = /\{[\s\S]*\}/.exec(t); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

function parsedAnswer(stage: Stage, a: Answer): Label | Verdict | null {
  const parsed = a.error ? null : firstJson(a.text);
  if (!parsed) return null;
  if (stage === 'adjudicate') return ['acceptable', 'not_acceptable', 'ambiguous'].includes(parsed.verdict) ? parsed : null;
  return typeof parsed.no_tool_needed === 'boolean' && Array.isArray(parsed.acceptable) && parsed.acceptable.every((t: unknown) => typeof t === 'string') ? parsed : null;
}

const belongsTo = (a: AnswerRow, i: Intent) => a.manifest_sha256 === i.manifest_sha256 && a.intent_id === i.intent_id && a.judge === i.judge && i.request_ids.includes(a.custom_id);

/** Each item's labels per judge, and each queued (item, tool)'s adjudication, from collected answers and a manifest's id map. */
export function readAnswers(out: string, input: Stage | Manifest, items: Item[], expected: { catalogSha?: string; labelManifestSha?: string } = {}): Map<string, Map<string, unknown>> {
  const manifest = typeof input === 'string' ? readManifest(out, input) : input;
  const { stage } = manifest;
  const m = new Map<string, Map<string, unknown>>();
  if (manifest.schema !== 'he-mcp-at-scale-audit/2' || manifest.prompt_sha256 !== sha(template('audit-' + stage)) ||
    (expected.catalogSha !== undefined && manifest.catalog_sha256 !== expected.catalogSha) ||
    (expected.labelManifestSha !== undefined && manifest.label_manifest_sha256 !== expected.labelManifestSha)) return m;
  const digest = manifestSha(manifest);
  const byId = new Map(items.map((it) => [it.id, itemSha(it)]));
  const intents = new Map(readJournal(out, stage).intents.filter((i) => i.manifest_sha256 === digest && Array.isArray(i.request_ids) &&
    (i.state === 'settled' || (stage === 'adjudicate' && i.state === 'sending' && i.batch_id === null && i.reservation_id === null)) &&
    manifest.batches.some((b) => b.judge === i.judge && b.provider === i.provider && b.model === i.model && b.file === i.file && b.sha256 === i.file_sha256))
    .map((i) => [i.intent_id, i]));
  for (const a of answerRows(out, stage)) {
    const i = intents.get(a.intent_id);
    if (!i || !belongsTo(a, i)) continue;
    const ref = manifest.custom_ids[a.custom_id];
    if (!ref || !byId.has(ref.item) || byId.get(ref.item) !== manifest.item_sha256[ref.item]) continue;
    const parsed = parsedAnswer(stage, a);
    if (!parsed) continue;
    const key = stage === 'label' ? ref.item : ref.item + '\u0000' + ref.tool;
    (m.get(key) ?? m.set(key, new Map()).get(key)!).set(a.judge, parsed);
  }
  return m;
}

export function auditQueue(items: Item[], labels: Map<string, Map<string, unknown>>): { queue: QueueEntry[]; twin_kept: QueueEntry[]; unlabelled: string[] } {
  const queue: QueueEntry[] = [], twinKept: QueueEntry[] = [], unlabelled: string[] = [];
  for (const it of items) {
    const ls = labels.get(it.id);
    if (!ls || JUDGES.some((j) => !ls.has(j.name))) { unlabelled.push(it.id); continue; }
    const author = new Set(authorTools(it));
    const add = new Map<string, string[]>();
    for (const j of JUDGES) {
      const l = ls.get(j.name) as Label;
      const listed = l.no_tool_needed ? [NO_TOOL] : (l.acceptable ?? []);
      if (!author.size && listed.length && !l.no_tool_needed) for (const t of listed) add.set(t, [...(add.get(t) ?? []), j.name]);
      if (author.size && l.no_tool_needed) add.set(NO_TOOL, [...(add.get(NO_TOOL) ?? []), j.name]);
      if (author.size) for (const t of listed) if (t !== NO_TOOL && !author.has(t)) add.set(t, [...(add.get(t) ?? []), j.name]);
    }
    for (const [tool, judges] of add) {
      const e = { item: it.id, tool, judges };
      if (it.set === 'R' && it.bait && it.bait_twin && tool.startsWith(it.bait_twin + '/')) twinKept.push(e); else queue.push(e);
    }
  }
  return { queue, twin_kept: twinKept, unlabelled };
}

export const stratumOf = (it: Item) => (it.set === 'R' ? 'R/' + it.stratum + (it.bait ? '+bait' : '') : it.set === 'T' ? 'T/chained' : 'G/' + it.half_kind);

export function applyAudit(items: Item[], labels: Map<string, Map<string, unknown>>, adjudications: Map<string, Map<string, unknown>>) {
  const { queue, twin_kept, unlabelled } = auditQueue(items, labels);
  const status: Record<string, 'passed' | 'widened' | 'dropped' | 'replace' | 'pending'> = {};
  const audited: Item[] = [];
  const drops: Record<string, number> = {};
  const alternatives: Record<string, string[]> = {};
  for (const it of items) {
    if (unlabelled.includes(it.id)) { status[it.id] = 'pending'; audited.push(it); continue; }
    const mine = queue.filter((q) => q.item === it.id);
    const verdicts = mine.map((q) => ({ q, v: adjudications.get(q.item + '\u0000' + q.tool)?.get(ADJUDICATOR.name) as Verdict | undefined }));
    if (verdicts.some((x) => !x.v)) { status[it.id] = 'pending'; audited.push(it); continue; }
    if (verdicts.some((x) => x.v!.verdict === 'ambiguous' || (x.v!.verdict === 'acceptable' && x.q.tool === NO_TOOL))) { status[it.id] = 'dropped'; drops[stratumOf(it)] = (drops[stratumOf(it)] ?? 0) + 1; continue; }
    const widen = verdicts.filter((x) => x.v!.verdict === 'acceptable');
    if (!widen.length) { status[it.id] = 'passed'; audited.push(it); continue; }
    if (it.set === 'T') { status[it.id] = 'replace'; alternatives[it.id] = widen.map((x) => x.q.tool); audited.push(it); continue; }
    const extra: Acceptable[] = widen.map((x) => { const [server, tool] = x.q.tool.split('/') as [string, string]; return { server, tool, ...(x.v!.required ? { required: x.v!.required } : {}) }; });
    status[it.id] = 'widened';
    audited.push({ ...it, acceptable: [...it.acceptable, ...extra] } as Item);
  }
  return { status, audited, queue, twin_kept, drops_by_stratum: drops, t_alternatives: alternatives };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cmd = argv[0] as string;
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const after = argv.includes('--sets') ? argv.slice(argv.indexOf('--sets') + 1) : [];
  const end = after.findIndex((x) => x.startsWith('--'));
  const sets = end < 0 ? after : after.slice(0, end);
  const out = flag('--out');
  const usage = () => { console.error('usage: audit.ts label|adjudicate --sets <set.jsonl>... --catalog <dir> --out <dir> (--dry-run | --ledger <f> --run-id <id> --lease-usd <usd>) | collect --out <dir> --stage <s> --ledger <f> --run-id <id> --lease-usd <usd> | apply --sets <set.jsonl>... --out <dir>'); process.exit(2); };
  if (!out || !['label', 'adjudicate', 'collect', 'apply'].includes(cmd)) usage();
  if (cmd === 'adjudicate' && argv.includes('--batch')) { console.error(batchUnsupported); process.exit(2); }
  const items = sets.flatMap((f) => readJsonl<Item>(f));
  const lane = async () => {
    const ledger = flag('--ledger'), runId = flag('--run-id'), lease = Number(flag('--lease-usd'));
    if (!ledger || !runId || !(lease > 0)) usage();
    const { BudgetRun, installPaidRequestGuard, runInBatchLane } = await import('../../../runner/ledger/budget-ledger.ts');
    const run = BudgetRun.openLease({ runId: runId!, leaseUsd: lease, ledgerPath: ledger!, runner: 'mcp-at-scale-audit' });
    installPaidRequestGuard(run);
    return { run, runInBatchLane };
  };
  if (cmd === 'label' || cmd === 'adjudicate') {
    const catalog = flag('--catalog');
    if (!catalog || !items.length) usage();
    const gbrain = flag('--gbrain-tools');
    const hasG = items.some((i) => i.set === 'G');
    if (hasG && (!gbrain || items.some((i) => i.set !== 'G'))) { console.error('HE-MCP-022 set G is audited on its own, with --gbrain-tools <full tools/list dump>: its judges see rung 150 plus gbrain'); process.exit(2); }
    const catalogText = hasG ? gbrainListing(loadCatalog(catalog!), JSON.parse(readFileSync(gbrain!, 'utf8')).tools) : catalogListing(loadCatalog(catalog!));
    const label = cmd === 'adjudicate' ? readManifest(out!, 'label') : undefined;
    if (label && label.catalog_sha256 !== sha(catalogText)) throw new Error('HE-MCP-024 the catalog does not match the label manifest; rerun label for this catalog first');
    const queue = label ? auditQueue(items, readAnswers(out!, label, items)).queue : undefined;
    const m = writeStage(out!, cmd, planStage({ stage: cmd, items, catalogText, queue, labelManifestSha: label && manifestSha(label) }));
    console.log('audit ' + cmd + ': ' + m.batches.map((b) => b.requests + ' requests to ' + b.provider + ':' + b.model).join(', ') + '; worst case $' + m.worst_case_list_usd + ' at list price; files under ' + join(out!, cmd));
    if (argv.includes('--dry-run')) { console.log('dry run: no network call made'); process.exit(0); }
    const { run, runInBatchLane } = await lane();
    if (cmd === 'adjudicate') {
      const r = await adjudicateInteractive({ out: out!, fetch: (u, i) => globalThis.fetch(u, i) });
      console.log('adjudicated ' + r.answers + ' requests one at a time (' + r.errors + ' errors), ' +
        (r.usd === null ? 'reported usage incomplete' : 'about $' + r.usd.toFixed(4) + ' at list price') + ', reserved and settled per request by the paid-request guard');
      process.exit(r.errors ? 1 : 0);
    }
    const sent = await submitStage({ out: out!, stage: cmd, fetch: (u, i) => globalThis.fetch(u, i), lease: run, inLane: runInBatchLane });
    console.log('submitted ' + sent.map((s) => s.provider + ':' + s.batch_id).join(', '));
  } else if (cmd === 'collect') {
    const stage = flag('--stage') as Stage;
    if (stage !== 'label' && stage !== 'adjudicate') usage();
    const { run } = await lane();
    const r = await collectStage({ out: out!, stage, fetch: (u, i) => globalThis.fetch(u, i), lease: run });
    console.log('collected: ' + r.settled + ' batch(es) settled, ' + r.open + ' still open');
    process.exit(r.open ? 3 : 0);
  } else {
    const label = readManifest(out!, 'label');
    const labelManifestSha = manifestSha(label);
    const adj = existsSync(join(out!, 'adjudicate', 'manifest.json')) ? readManifest(out!, 'adjudicate') : null;
    const a = applyAudit(items, readAnswers(out!, label, items), adj ? readAnswers(out!, adj, items, { catalogSha: label.catalog_sha256, labelManifestSha }) : new Map());
    mkdirSync(join(out!, 'audited'), { recursive: true });
    for (const s of ['R', 'T', 'G']) { const xs = a.audited.filter((i) => i.set === s); if (xs.length) writeFileSync(join(out!, 'audited', 'set-' + s.toLowerCase() + '.jsonl'), xs.map((x) => JSON.stringify(x)).join('\n') + '\n'); }
    const counts = Object.values(a.status).reduce<Record<string, number>>((c, s) => ({ ...c, [s]: (c[s] ?? 0) + 1 }), {});
    writeFileSync(join(out!, 'audit-status.json'), JSON.stringify({ schema: 'he-mcp-at-scale-audit-status/1', counts, drops_by_stratum: a.drops_by_stratum, twin_kept: a.twin_kept.length, t_alternatives: a.t_alternatives, items: a.status,
      item_sha256: Object.fromEntries(items.map((it) => [it.id, itemSha(it)])),
      audited_item_sha256: Object.fromEntries(a.audited.map((it) => [it.id, itemSha(it)])),
      manifest_sha256: { label: labelManifestSha, adjudicate: adj && manifestSha(adj) } }, null, 1) + '\n');
    console.log('audit status ' + JSON.stringify(counts) + ' drops by stratum ' + JSON.stringify(a.drops_by_stratum));
  }
}
