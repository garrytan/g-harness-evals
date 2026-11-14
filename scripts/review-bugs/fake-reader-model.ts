#!/usr/bin/env bun
// A keyless fake model endpoint for the background-wait canaries (scripts/review-bugs/wait-canary.ts). Unlike
// scripts/gsta-135/fake-anthropic.ts, whose script is one ordered list of turns, this fake answers by rules: each request
// gets the first rule whose conditions it meets, so the main session and a reader it dispatched can talk to the same
// endpoint in any order. It speaks the two wires the canaries use: Anthropic messages (POST .../v1/messages, OpenClaw and
// Hermes) and OpenAI Responses (POST .../v1/responses, Codex), streamed or not, with the event shapes of
// fake-anthropic.ts's stream() and tests/fixtures/fake-responses.ts's stream(). It holds no credential and records every
// request to an ndjson log.
//
//   bun scripts/review-bugs/fake-reader-model.ts --host 172.17.0.1 --port 8811 --rules rules.json --log requests.ndjson
//
// The rules file is a JSON list. A rule:
//   {"id": "reader",                       a name for the log
//    "when": {                             every condition given must hold (all optional; strings or lists of strings,
//                                          a list means every item):
//      "system_contains": "...",           the system text: Anthropic "system", Responses "instructions" and
//                                          developer or system role input messages
//      "user_contains": "...",             the text of some user-role message (tool results excluded)
//      "contains": "...",                  anywhere in the request body's JSON
//      "absent": "..."},                   nowhere in the request body's JSON
//    "reply": {"text": "..."}              an assistant text and end of turn, or
//           | {"tool": "<name>", "input": {...}}   one tool call named exactly <name> (Responses: a function_call; add
//                                          "namespace" for a namespaced tool), or
//           | {"custom_tool": "exec", "code": "..."}  Responses only: a custom_tool_call (Codex's code-mode exec takes
//                                          JavaScript such as const r = await tools.exec_command({cmd: "cat f"})),
//    "delay_s": 120,                       optional: the answer's content comes only after this many seconds. A streamed
//                                          answer sends its headers and first event at once and an SSE comment every
//                                          5 s until then, the way a long model call keeps its stream open; a
//                                          non-streamed answer sends nothing until then
//    "times": 1}                           optional: how many requests the rule may answer (default unlimited)
// A string anywhere in a tool reply's input may hold {{re:<regex>}}: it is replaced by the first capture group of the
// regex's last match in the request body's JSON (empty when none), so a later call can name an id an earlier tool result
// returned, such as OpenClaw's collector runId for agents_wait.
// A request that meets no rule gets the text "ok" and end of turn. Requests without tools (title or summary calls) are
// answered "ok" before any rule is tried.
//
// The log has one line per request: {at, method, path, wire, model, stream, rule (the id, or null), delay_s, sent_at
// (when the content was sent; null when the client went away first), first_user (the first 160 characters of the first
// user message), authorization_sha256 (never the value)}. With --log-bodies the request body is kept too.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stream as anthropicStream } from '../gsta-135/fake-anthropic.ts';
import { stream as responsesStream } from '../../tests/fixtures/fake-responses.ts';

type Cond = string | string[];
export interface Rule {
  id: string;
  when?: { system_contains?: Cond; user_contains?: Cond; contains?: Cond; absent?: Cond };
  reply: { text: string } | { tool: string; input?: Record<string, unknown>; namespace?: string } | { custom_tool: string; code: string };
  delay_s?: number;
  times?: number;
}
export interface RequestLine {
  at: string; method: string; path: string; wire: 'anthropic' | 'responses' | 'other'; model: string | null; stream: boolean;
  rule: string | null; delay_s: number; sent_at: string | null; first_user: string; authorization_sha256: string | null; body?: unknown;
}

const list = (c: Cond | undefined): string[] => (c === undefined ? [] : Array.isArray(c) ? c : [c]);
const textOf = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(b => (b && typeof b === 'object' && ['text', 'input_text', 'output_text'].includes(String((b as Record<string, unknown>).type)) ? String((b as Record<string, unknown>).text ?? '') : '')).join('\n') : '';

/** The system text and the user-message texts of a request body, for either wire. */
export function texts(body: Record<string, unknown>): { system: string; users: string[] } {
  const system: string[] = [];
  const users: string[] = [];
  if (typeof body.system === 'string') system.push(body.system);
  else if (Array.isArray(body.system)) system.push(textOf(body.system));
  if (typeof body.instructions === 'string') system.push(body.instructions);
  for (const m of [...(Array.isArray(body.messages) ? body.messages : []), ...(Array.isArray(body.input) ? body.input : [])] as Array<Record<string, unknown>>) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'system' || m.role === 'developer') system.push(textOf(m.content));
    if (m.role === 'user' && textOf(m.content)) users.push(textOf(m.content));
  }
  return { system: system.join('\n'), users };
}

const hasTools = (body: Record<string, unknown>): boolean => (Array.isArray(body.tools) && body.tools.length > 0)
  || (Array.isArray(body.input) && body.input.some(i => i && typeof i === 'object' && (i as Record<string, unknown>).type === 'additional_tools'));

/** The rule that answers a request (the first whose conditions hold and that has uses left), or null. */
export function pick(body: Record<string, unknown>, rules: Rule[], used: Map<string, number>): Rule | null {
  if (!hasTools(body)) return null;
  const all = JSON.stringify(body);
  const t = texts(body);
  for (const r of rules) {
    if (r.times !== undefined && (used.get(r.id) ?? 0) >= r.times) continue;
    const w = r.when ?? {};
    if (!list(w.system_contains).every(s => t.system.includes(s))) continue;
    if (!list(w.user_contains).every(s => t.users.some(u => u.includes(s)))) continue;
    if (!list(w.contains).every(s => all.includes(s))) continue;
    if (list(w.absent).some(s => all.includes(s))) continue;
    return r;
  }
  return null;
}

export function validateRules(v: unknown): Rule[] {
  const ok = (r: unknown) => {
    if (!r || typeof r !== 'object') return false;
    const x = r as Record<string, unknown>, reply = x.reply as Record<string, unknown> | undefined;
    if (typeof x.id !== 'string' || !reply || typeof reply !== 'object') return false;
    if (!(typeof reply.text === 'string' || typeof reply.tool === 'string' || (typeof reply.custom_tool === 'string' && typeof reply.code === 'string'))) return false;
    return (x.delay_s === undefined || (typeof x.delay_s === 'number' && x.delay_s >= 0)) && (x.times === undefined || (Number.isInteger(x.times) && (x.times as number) > 0));
  };
  if (!Array.isArray(v) || !v.every(ok)) throw new Error('--rules must be a JSON list of {"id", "when"?, "reply": {"text"} | {"tool", "input"?} | {"custom_tool", "code"}, "delay_s"?, "times"?}');
  return v as Rule[];
}

/** A tool input with every {{re:<regex>}} replaced from the request body's JSON (the last match's first group). */
export function fill(input: unknown, all: string): unknown {
  if (typeof input === 'string') return input.replace(/\{\{re:(.+?)\}\}/g, (_, re: string) => { const ms = [...all.matchAll(new RegExp(re, 'g'))]; return ms.length ? ms[ms.length - 1][1] ?? '' : ''; });
  if (Array.isArray(input)) return input.map(v => fill(v, all));
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, fill(v, all)]));
  return input;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface FakeReaderModel { port: number; requests: RequestLine[]; stop(): void }

export function startFakeReaderModel(o: { host?: string; port?: number; rules: Rule[]; log?: string | null; logBodies?: boolean }): FakeReaderModel {
  const requests: RequestLine[] = [];
  const used = new Map<string, number>();
  if (o.log) mkdirSync(dirname(o.log), { recursive: true });
  const record = (r: RequestLine) => { requests.push(r); if (o.log) appendFileSync(o.log, JSON.stringify(r) + '\n'); };
  let n = 0;
  const server = Bun.serve({ port: o.port ?? 0, hostname: o.host ?? '127.0.0.1', idleTimeout: 0, async fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get('x-api-key') ?? req.headers.get('authorization');
    const wire = req.method === 'POST' && url.pathname.endsWith('/v1/messages') ? 'anthropic' : req.method === 'POST' && url.pathname.endsWith('/v1/responses') ? 'responses' : 'other';
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') { try { body = await req.json() as Record<string, unknown>; } catch { body = {}; } }
    const line: RequestLine = { at: new Date().toISOString(), method: req.method, path: url.pathname, wire, model: typeof body.model === 'string' ? body.model : null, stream: body.stream === true,
      rule: null, delay_s: 0, sent_at: null, first_user: (texts(body).users[0] ?? '').slice(0, 160), authorization_sha256: auth ? sha256(auth) : null, ...(o.logBodies ? { body } : {}) };
    if (req.method === 'GET' && url.pathname.endsWith('/v1/models')) { record({ ...line, sent_at: line.at }); return Response.json({ data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false }); }
    if (wire === 'other') { record({ ...line, sent_at: line.at }); return Response.json({ type: 'error', error: { type: 'not_found_error', message: url.pathname } }, { status: 404 }); }
    const rule = pick(body, o.rules, used);
    if (rule) used.set(rule.id, (used.get(rule.id) ?? 0) + 1);
    line.rule = rule?.id ?? null;
    line.delay_s = rule?.delay_s ?? 0;
    n++;
    const r0 = rule?.reply ?? { text: 'ok' };
    const reply = 'tool' in r0 ? { ...r0, input: fill(r0.input ?? {}, JSON.stringify(body)) as Record<string, unknown> } : r0;
    const model = String(body.model ?? '');
    let payload: string;
    if (wire === 'anthropic') {
      if ('custom_tool' in reply) { record({ ...line, sent_at: new Date().toISOString() }); return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'fake: custom_tool replies are Responses only' } }, { status: 400 }); }
      const content = 'text' in reply ? [{ type: 'text', text: reply.text }] : [{ type: 'tool_use', id: 'toolu_fake_' + n, name: reply.tool, input: reply.input ?? {} }];
      const stop = 'text' in reply ? 'end_turn' : 'tool_use';
      const msg = { id: 'msg_fake_' + n, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      payload = body.stream ? anthropicStream(msg, content, stop) : JSON.stringify(msg);
    } else {
      const output = 'text' in reply
        ? [{ type: 'message', id: 'msg_fake_' + n, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply.text, annotations: [] }] }]
        : 'custom_tool' in reply ? [{ type: 'custom_tool_call', id: 'ctc_fake_' + n, call_id: 'call_fake_' + n, name: reply.custom_tool, input: reply.code, status: 'completed' }]
        : [{ type: 'function_call', id: 'fc_fake_' + n, call_id: 'call_fake_' + n, name: reply.tool, ...(reply.namespace ? { namespace: reply.namespace } : {}), arguments: JSON.stringify(reply.input ?? {}), status: 'completed' }];
      payload = body.stream ? responsesStream('resp_fake_' + n, model, output) : JSON.stringify({ id: 'resp_fake_' + n, object: 'response', status: 'completed', model, output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    }
    const headers = { 'content-type': body.stream ? 'text/event-stream' : 'application/json' };
    const delayMs = (rule?.delay_s ?? 0) * 1000;
    if (!body.stream) {
      if (delayMs) await sleep(delayMs);
      record({ ...line, sent_at: new Date().toISOString() });
      return new Response(payload, { headers });
    }
    // A streamed answer: the first SSE event at once (so the client sees a live stream), a comment line every 5 s while the
    // delay runs, then the rest.
    const split = payload.indexOf('\n\n') + 2;
    const enc = new TextEncoder();
    const out = new ReadableStream({
      async start(c) {
        try {
          c.enqueue(enc.encode(payload.slice(0, split)));
          for (let waited = 0; waited < delayMs; waited += 5000) { await sleep(Math.min(5000, delayMs - waited)); c.enqueue(enc.encode(': waiting\n\n')); }
          c.enqueue(enc.encode(payload.slice(split)));
          record({ ...line, sent_at: new Date().toISOString() });
          c.close();
        } catch { record(line); }
      },
    });
    return new Response(out, { headers });
  } });
  return { port: server.port as number, requests, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const rulesPath = arg('--rules');
  if (!rulesPath) { console.error('usage: fake-reader-model.ts --rules <rules.json> [--host 127.0.0.1] [--port 0] [--log requests.ndjson] [--log-bodies]'); process.exit(64); }
  const rules = validateRules(JSON.parse(readFileSync(rulesPath, 'utf8')));
  const host = arg('--host') ?? '127.0.0.1';
  const fake = startFakeReaderModel({ host, port: Number(arg('--port') ?? 0), rules, log: arg('--log') ?? null, logBodies: process.argv.includes('--log-bodies') });
  console.log('fake-reader-model listening on http://' + host + ':' + fake.port + ' (' + rules.length + ' rules)');
}
