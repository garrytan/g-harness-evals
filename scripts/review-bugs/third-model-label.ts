#!/usr/bin/env bun
/**
 * A third-model labeller for the review-real-bugs judge checks (R126): Gemini 4 Neon, or Grok 4.7 when Neon abstains on
 * more than 20% of items or fails the known-answer anchors. It never sees a judge's ruling or an arm name.
 *
 *   adjudicate  one fresh tool session per item, with tool-judge.ts's labeller role unchanged: its brief, prompt, read-only
 *               tools over the unit's clone, tool budget and submit_ruling checks. Only the transport is new.
 *   match       one fresh request per label packet (the stage 1 and C2 label passes' own prompt files), no tools, a JSON
 *               reply labelling every item; an invalid reply is asked again once in a fresh request.
 *
 *   bun scripts/review-bugs/third-model-label.ts adjudicate --items <items.jsonl> --brief labeller=<file> --brief judge=<file>
 *       --model google:gemini-4-neon --out <dir> --run-id <id> --lease-usd <n> --ledger <file> [--concurrency 4]
 *   bun scripts/review-bugs/third-model-label.ts match --prompts <dir> [--only <L001.txt,...>] --model google:gemini-4-neon
 *       --out <dir> --run-id <id> --lease-usd <n> --ledger <file> [--concurrency 4]
 *
 * Every request goes through runner/proxy/metering-proxy.ts in lease mode, one bound slot and meter key per read. Rows are
 * appended and fsynced to <out>/rulings.jsonl (adjudicate, tool-judge.ts's row shape) or <out>/labels.jsonl (match) the
 * moment a read ends; <out>/usage.ndjson is the proxy's log.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CANONICAL_PRICING, PRICE_TABLE_FILE } from '../../runner/pricing/model-pricing.ts';
import { appendDurable, briefFor, EXTRA_TURNS, MAX_EXTRA_TURNS, MAX_OUTPUT_TOKENS, parseFlags, promptFor, readItems, RepoView, runTool, sha256, SUBMIT,
  TOOL_BUDGET, toolSpecs, validateRuling, type Ruled } from './tool-judge.ts';

export const THINKING_LEVEL = 'medium';

/** One read's charge from the proxy's finalize reply, or why it can't be counted: a non-200 reply, a body that is not
 *  JSON, no finite usd or request count, or requests still in flight (undrained) all leave the cost incomplete. */
export function meterReading(status: number, text: string): { usd: number; requests: number } | string {
  if (status !== 200) return 'finalize returned HTTP ' + status;
  let m: { usd?: unknown; requests?: unknown; undrained?: unknown };
  try { m = JSON.parse(text); } catch { return 'finalize reply is not JSON'; }
  if (typeof m.usd !== 'number' || !Number.isFinite(m.usd) || typeof m.requests !== 'number' || !Number.isFinite(m.requests)) return 'finalize reply has no usd or request count';
  if (m.undrained !== undefined && (typeof m.undrained !== 'number' || !Number.isFinite(m.undrained))) return 'finalize reply has an unreadable undrained count';
  if ((m.undrained ?? 0) > 0) return 'finalize left ' + m.undrained + ' request(s) undrained';
  return { usd: m.usd, requests: m.requests };
}
export const ABSTAIN_LIMIT = 0.2;
const REPO_ROOT = join(import.meta.dir, '..', '..');

export interface Usage { input: number; cached: number; output: number }
export interface Model { id: string; provider: 'google' | 'xai'; model: string; slug: string }
export function parseModel(id: string): Model {
  const [provider, model] = id.split(':') as [string, string | undefined];
  if ((provider !== 'google' && provider !== 'xai') || !model) throw new Error('--model takes google:<model> or xai:<model>, not ' + id);
  return { id, provider, model, slug: id.replace(/[^A-Za-z0-9.]+/g, '-') };
}

type Send = (body: Record<string, unknown>) => Promise<{ status: number; text: string }>;
interface Call { id: string; name: string; args: Record<string, unknown> }
interface Turn { calls: Call[]; text: string; filtered: boolean; incomplete: boolean; usage: Usage; assistant: unknown[] }

const schemaTools = (tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>) => tools;

/** One request body. Gemini: generateContent with function declarations as JSON Schema; xAI: Responses with store false. */
export function body(m: Model, prompt: string, history: unknown[], tools: ReturnType<typeof toolSpecs> | null): Record<string, unknown> {
  if (m.provider === 'google') return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }, ...history],
    ...(tools ? { tools: [{ functionDeclarations: schemaTools(tools).map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
  };
  return { model: m.model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }, ...history], store: false, include: ['reasoning.encrypted_content'],
    ...(tools ? { tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: true })), tool_choice: 'auto' } : {}),
    reasoning: { effort: THINKING_LEVEL }, max_output_tokens: MAX_OUTPUT_TOKENS };
}

const FILTER_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);
const args = (v: unknown): Record<string, unknown> => { if (v && typeof v === 'object') return v as Record<string, unknown>; try { const o = JSON.parse(String(v)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

export function parse(m: Model, b: any): Turn {
  if (m.provider === 'google') {
    const c = b?.candidates?.[0];
    const parts: any[] = Array.isArray(c?.content?.parts) ? c.content.parts : [];
    const u = b?.usageMetadata ?? {};
    const usage = { input: u.promptTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
    return { calls: parts.filter((p) => p?.functionCall).map((p, i) => ({ id: String(p.functionCall.id ?? 'c' + i), name: String(p.functionCall.name), args: args(p.functionCall.args) })),
      text: parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join(''),
      filtered: Boolean(b?.promptFeedback?.blockReason) || FILTER_FINISH.has(c?.finishReason) || (!c && !usage.output), incomplete: c?.finishReason === 'MAX_TOKENS',
      usage, assistant: c?.content ? [c.content] : [] };
  }
  const output: any[] = Array.isArray(b?.output) ? b.output : [];
  const u = b?.usage ?? {};
  return { calls: output.filter((o) => o?.type === 'function_call').map((o) => ({ id: String(o.call_id), name: String(o.name), args: args(o.arguments) })),
    text: output.filter((o) => o?.type === 'message').flatMap((o) => o.content ?? []).filter((x: any) => x?.type === 'output_text').map((x: any) => x.text).join(''),
    filtered: (!output.length && !(u.output_tokens ?? 0)) || b?.incomplete_details?.reason === 'content_filter' || output.some((o) => o?.type === 'message' && (o.content ?? []).some((x: any) => x?.type === 'refusal')),
    incomplete: b?.status === 'incomplete', usage: { input: u.input_tokens ?? 0, cached: u.input_tokens_details?.cached_tokens ?? 0, output: u.output_tokens ?? 0 }, assistant: output };
}

function results(m: Model, calls: Array<{ call: Call; text: string }>): unknown[] {
  if (m.provider === 'google') return [{ role: 'user', parts: calls.map(({ call, text }) => ({ functionResponse: { name: call.name, ...(call.id.startsWith('c') ? {} : { id: call.id }), response: { result: text } } })) }];
  return calls.map(({ call, text }) => ({ type: 'function_call_output', call_id: call.id, output: text }));
}
const userText = (m: Model, text: string) => (m.provider === 'google' ? { role: 'user', parts: [{ text }] } : { role: 'user', content: [{ type: 'input_text', text }] });

export interface Session { outcome: 'ruled' | 'unanswered' | 'filtered' | 'failed'; ruled: Ruled | null; tool_calls: number; turns: number; usage: Usage; calls: Array<{ name: string; args: unknown }>; note: string }

/** One labeller session, with tool-judge.ts's budget rules: the tool budget, then only submit_ruling for EXTRA_TURNS turns. */
export async function session(view: RepoView, m: Model, prompt: string, send: Send): Promise<Session> {
  const budget = TOOL_BUDGET[view.role];
  const s: Session = { outcome: 'unanswered', ruled: null, tool_calls: 0, turns: 0, usage: { input: 0, cached: 0, output: 0 }, calls: [], note: '' };
  const history: unknown[] = [];
  let nudges = 0, afterBudget = 0;
  for (;;) {
    if (s.turns >= budget + MAX_EXTRA_TURNS) { s.note = 'no accepted submit_ruling within ' + (budget + MAX_EXTRA_TURNS) + ' turns'; return s; }
    if (s.tool_calls >= budget && afterBudget++ >= EXTRA_TURNS) { s.note = 'no submit_ruling within ' + EXTRA_TURNS + ' turns after the tool budget'; return s; }
    const r = await send(body(m, prompt, history, s.tool_calls >= budget ? [SUBMIT] : toolSpecs(view.role)));
    s.turns++;
    if (r.status !== 200) { s.outcome = 'failed'; s.note = 'HTTP ' + r.status + ': ' + r.text.slice(0, 300); return s; }
    let t: Turn;
    try { t = parse(m, JSON.parse(r.text)); } catch { s.outcome = 'failed'; s.note = 'the provider response is not JSON'; return s; }
    for (const k of Object.keys(s.usage) as Array<keyof Usage>) s.usage[k] += t.usage[k];
    if (t.filtered) { s.outcome = 'filtered'; s.note = 'safety stop or empty answer'; return s; }
    history.push(...t.assistant);
    if (!t.calls.length) {
      if (nudges++ >= 2) { s.note = 'answered without submit_ruling three times'; return s; }
      history.push(userText(m, 'Call submit_ruling now with your ruling.'));
      continue;
    }
    const out: Array<{ call: Call; text: string }> = [];
    for (const c of t.calls) {
      s.calls.push({ name: c.name, args: c.args });
      if (c.name === SUBMIT.name) {
        const v = validateRuling(c.args, view.item);
        if (typeof v !== 'string') { s.outcome = 'ruled'; s.ruled = v; return s; }
        out.push({ call: c, text: 'Not accepted: ' + v + '. Call submit_ruling again.' });
      } else if (s.tool_calls >= budget) out.push({ call: c, text: 'The tool budget is spent. Call submit_ruling now.' });
      else { s.tool_calls++; out.push({ call: c, text: runTool(view, c.name, c.args) }); }
    }
    history.push(...results(m, out));
    if (t.incomplete) s.note = 'a turn hit the output cap';
  }
}

/** The label items in a matching label packet's reply: every item the packet lists, or a reason the reply is invalid. */
export function packetItems(prompt: string): string[] {
  const i = prompt.lastIndexOf('=== Items to label');
  if (i < 0) throw new Error('no items section');
  return [...prompt.slice(i).matchAll(/^([A-Z]\d+): kind (match|adjudicate)/gm)].map((x) => x[1]!);
}
export function packetKinds(prompt: string): Map<string, string> {
  return new Map([...prompt.slice(prompt.lastIndexOf('=== Items to label')).matchAll(/^([A-Z]\d+): kind (match|adjudicate)/gm)].map((x) => [x[1]!, x[2]!]));
}
const LABELS: Record<string, string[]> = { match: ['match', 'no-match', 'unsure'], adjudicate: ['defect', 'not-defect', 'unsure'] };
export function readReply(text: string, want: string[], kinds?: Map<string, string>): Array<{ item: string; kind: string; label: string }> | string {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return 'no JSON object';
  let o: any;
  try { o = JSON.parse(m[0]); } catch { return 'invalid JSON'; }
  const items: any[] = Array.isArray(o?.items) ? o.items : [];
  const named = items.filter((x) => typeof x?.item === 'string' && typeof x?.label === 'string');
  const got = new Map(named.map((x) => [x.item, x]));
  const twice = [...new Set(named.filter((x) => got.get(x.item).label !== x.label).map((x) => x.item))];
  if (twice.length) return 'conflicting labels for ' + twice.join(',');
  const missing = want.filter((w) => !got.has(w));
  if (missing.length) return 'unlabelled items: ' + missing.join(',');
  const wrong = want.filter((w) => !(LABELS[kinds?.get(w) ?? ''] ?? [...LABELS.match!, ...LABELS.adjudicate!]).includes(got.get(w).label));
  if (wrong.length) return 'labels outside the allowed set: ' + wrong.join(',');
  return want.map((w) => ({ item: w, kind: String(got.get(w).kind ?? ''), label: String(got.get(w).label) }));
}

interface Proxy { base: string; token: string; child: ChildProcess }
async function startProxy(dir: string, ledger: string, leaseUsd: number, runId: string, m: Model): Promise<Proxy> {
  const token = randomBytes(24).toString('hex');
  const errFd = openSync(join(dir, 'proxy.stderr.log'), 'a');
  const child = spawn('bun', [join(REPO_ROOT, 'runner/proxy/metering-proxy.ts'), '--listen', '127.0.0.1:0', '--budget-ledger', ledger, '--lease-usd', String(leaseUsd), '--run-id', runId,
    '--allow-models', m.id, '--max-output-tokens', String(MAX_OUTPUT_TOKENS), '--control-token', token, '--usage-log', join(dir, 'usage.ndjson'), '--refuse-hosted-tools'],
  { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise<number>((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); fail(new Error('the metering proxy did not start within 20 s; see ' + join(dir, 'proxy.stderr.log'))); }, 20_000);
    child.stderr!.on('data', (d: Buffer) => { writeSync(errFd, d); buf += d.toString('utf8'); const x = buf.match(/ on 127\.0\.0\.1:(\d+);/); if (x) { clearTimeout(timer); done(Number(x[1])); } });
    child.on('exit', () => { clearTimeout(timer); fail(new Error('the metering proxy exited; see ' + join(dir, 'proxy.stderr.log'))); });
  });
  return { base: 'http://127.0.0.1:' + port, token, child };
}
function transport(p: Proxy, slot: string, m: Model): Send {
  const url = m.provider === 'google' ? p.base + '/' + slot + '/google/v1beta/models/' + m.model + ':generateContent' : p.base + '/' + slot + '/xai/v1/responses';
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(m.provider === 'google' ? { 'x-goog-api-key': 'unauthenticated' } : { authorization: 'Bearer unauthenticated' }) };
  return async (b) => {
    let res = { status: 0, text: '' };
    for (const wait of [0, 10_000, 30_000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b), timeout: false } as RequestInit);
      res = { status: r.status, text: await r.text() };
      if (res.status !== 429 && res.status < 500) break;
    }
    return res;
  };
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd !== 'adjudicate' && cmd !== 'match') throw new Error('usage: third-model-label.ts adjudicate|match ... (see the file head)');
  const { f, one, briefs } = parseFlags(argv.slice(1));
  const m = parseModel(one('--model'));
  if (!CANONICAL_PRICING[m.id]) throw new Error(m.id + ' has no list price in runner/pricing/' + PRICE_TABLE_FILE + ', so the metering proxy would refuse every request; Gemini 4 Neon is priced from prices-2026-11-25.json');
  const out = resolve(one('--out'));
  if (existsSync(out)) throw new Error('--out ' + out + ' exists; give each run a new directory');
  mkdirSync(join(out, 'sessions'), { recursive: true });
  const runId = one('--run-id');
  type Read = { id: string; prompt: string; run: (send: Send) => Promise<Record<string, unknown>> };
  let reads: Read[];
  const rowsFile = join(out, cmd === 'adjudicate' ? 'rulings.jsonl' : 'labels.jsonl');
  if (cmd === 'adjudicate') {
    const items = readItems(one('--items'));
    if (items.some((i) => !i.later)) throw new Error('labeller items need later');
    reads = items.map((it) => {
      const view = new RepoView(it, 'labeller');
      const prompt = promptFor(view, briefFor('labeller', briefs));
      return { id: it.item, prompt, run: async (send) => {
        let s = await session(view, m, prompt, send), attempts = 1;
        if (s.outcome === 'unanswered' || s.outcome === 'failed') { const first = s; s = await session(view, m, prompt, send); attempts = 2; s.note = 'retried after: ' + first.note + (s.note ? '; ' + s.note : ''); for (const k of Object.keys(s.usage) as Array<keyof Usage>) s.usage[k] += first.usage[k]; }
        writeFileSync(join(out, 'sessions', it.item.replace(/[^A-Za-z0-9._-]/g, '_') + '.json'), JSON.stringify({ item: it.item, ruled: s.ruled, calls: s.calls, note: s.note }, null, 2) + '\n');
        return { item: it.item, role: 'labeller', judge: m.id, prompt_sha256: sha256(prompt), outcome: s.outcome, attempts, ruling: s.ruled?.ruling ?? null, test: s.ruled?.test ?? null, tool_calls: s.tool_calls, turns: s.turns, usage: s.usage, note: s.note };
      } };
    });
  } else {
    const dir = resolve(one('--prompts'));
    const only = f.get('--only')?.[0]?.split(',');
    reads = readdirSync(dir).filter((n) => n.endsWith('.txt') && (!only || only.includes(n))).sort().map((name) => {
      const prompt = readFileSync(join(dir, name), 'utf8');
      const want = packetItems(prompt), kinds = packetKinds(prompt);
      return { id: name, prompt, run: async (send) => {
        let note = '', usage: Usage = { input: 0, cached: 0, output: 0 }, labels: ReturnType<typeof readReply> = 'not read', outcome = 'failed';
        for (let attempt = 1; attempt <= 2; attempt++) {
          outcome = 'failed';
          const r = await send(body(m, prompt, [], null));
          if (r.status !== 200) { note += 'attempt ' + attempt + ': HTTP ' + r.status + ' ' + r.text.slice(0, 200) + '; '; continue; }
          let reply: unknown;
          try { reply = JSON.parse(r.text); } catch { note += 'attempt ' + attempt + ': the provider response is not JSON; '; continue; }
          const t = parse(m, reply);
          for (const k of Object.keys(usage) as Array<keyof Usage>) usage[k] += t.usage[k];
          if (t.filtered) { outcome = 'filtered'; note += 'attempt ' + attempt + ': safety stop; '; continue; }
          labels = readReply(t.text, want, kinds);
          writeFileSync(join(out, 'sessions', name + '.' + attempt + '.txt'), t.text);
          if (typeof labels !== 'string') { outcome = 'labelled'; break; }
          note += 'attempt ' + attempt + ': ' + labels + '; ';
        }
        return { packet: name, model: m.id, prompt_sha256: sha256(prompt), outcome, labels: typeof labels === 'string' ? [] : labels, usage, note };
      } };
    });
  }
  writeFileSync(rowsFile, '');
  const proxy = await startProxy(out, resolve(one('--ledger')), Number(one('--lease-usd')), runId, m);
  const ctl = (path: string, b: unknown) => fetch(proxy.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': proxy.token }, body: JSON.stringify(b) });
  let usd = 0, n = 0, stopped: string | null = null, costComplete = true;
  const q = [...reads];
  try {
    await Promise.all(Array.from({ length: Math.min(Number(f.get('--concurrency')?.[0] ?? 4), q.length) }, async () => {
      while (q.length && !stopped) {
        const r = q.shift()!;
        const slot = 's' + (++n), key = 'third-model:' + runId + ':' + cmd + ':' + m.slug + ':' + r.id;
        const bound = await ctl('/__proxy/bind', { slot, key, models: [m.id] }).then((b) => b.ok, () => false);
        if (!bound) { stopped = 'the proxy refused the bind for ' + key; break; }
        try {
          let row: Record<string, unknown>;
          try { row = await r.run(transport(proxy, slot, m)); } catch (e) { row = { id: r.id, outcome: 'failed', note: 'error: ' + (e as Error).message }; stopped = 'stopped on ' + key + ': ' + (e as Error).message; }
          let meter: { usd?: number; requests?: number } = {};
          try {
            const res = await ctl('/__proxy/finalize', { key, timeout_ms: 60_000 });
            const read = meterReading(res.status, await res.text());
            if (typeof read === 'string') throw new Error(read);
            meter = read;
          } catch (e) { row = { ...row, meter_error: (e as Error).message }; stopped = 'the proxy did not finalize ' + key + ': ' + (e as Error).message; costComplete = false; }
          row = { ...row, key, usd: meter.usd ?? null, requests: meter.requests ?? null };
          usd += Number(meter.usd ?? 0);
          appendDurable(rowsFile, JSON.stringify(row));
          if (row.outcome === 'failed' && /HTTP 40[23]/.test(String(row.note ?? ''))) stopped = 'stopped on ' + key + ': ' + row.note;
          console.error('third-model: ' + cmd + ' ' + r.id + ': ' + row.outcome + (row.ruling ? ' ' + row.ruling : '') + ', ' + (meter.usd === undefined ? 'charge missing' : '$' + meter.usd.toFixed(3)) + ' (run $' + usd.toFixed(2) + (costComplete ? '' : ', incomplete') + ')');
        } finally { await ctl('/__proxy/unbind', { slot }).catch(() => undefined); }
      }
    }));
  } finally {
    await new Promise<void>((done) => { proxy.child.once('exit', () => done()); proxy.child.kill('SIGTERM'); setTimeout(done, 5_000); });
  }
  writeFileSync(join(out, 'run.json'), JSON.stringify({ version: 1, cmd, run_id: runId, model: m.id, thinking_level: THINKING_LEVEL, reads: reads.length, usd, cost_complete: costComplete, stopped,
    inputs_sha256: cmd === 'adjudicate' ? sha256(readFileSync(one('--items'))) : sha256(reads.map((r) => r.id + ':' + sha256(r.prompt)).join('\n')),
    briefs: Object.fromEntries([...briefs].map(([k, p]) => [k, sha256(readFileSync(p))])) }, null, 2) + '\n');
  console.log(reads.length + ' reads, $' + usd.toFixed(2) + (costComplete ? '' : ' (cost incomplete: a meter reading is missing)') + (stopped ? '; stopped: ' + stopped : ''));
  return stopped ? 3 : 0;
}

if (import.meta.main) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write('third-model-label: ' + (e as Error).message + '\n'); process.exit(2); });
