#!/usr/bin/env bun
// A keyless fake Anthropic messages endpoint for the internal-task preflight
// (scripts/gsta-135/preflight.sh) and the internal-task anatomy captures. It records
// every request to an ndjson file and answers one short assistant turn,
// streamed or not, the way tests/adapter-install.test.ts's fakeAnthropic does.
// The preflight binds it to the docker bridge gateway address only (the
// address containers reach as host.docker.internal), never 0.0.0.0, and it
// holds no credential.
//
//   bun scripts/gsta-135/fake-anthropic.ts --host 172.17.0.1 --port 8798 --log results/gsta-135/preflight/fake-requests.ndjson
//       [--script turns.json] [--loop] [--fail-status 500] [--require-key-prefix trial-token:]
//       [--max-requests 200] [--max-seconds 600]
//
// --script <file>: a JSON list of turns the fake plays, in order, against the
// agent requests (the harness's agent loop). A request with no tools, such as
// a title or summary call, always gets the plain "ok" text and never consumes
// a turn. When the script is used up, every later request gets "ok" and
// end_turn, so the loop ends; with --loop the script starts over instead, so
// the agent loop never ends (the wall-clock test). The turns:
//   {"tool": "<shell command>"}             one tool_use block for the
//                                           harness's own shell tool, found by
//                                           name in that request's tools array
//                                           (OpenClaw exec, Hermes terminal,
//                                           else bash or shell), input {command}.
//   {"text": "<reply>"}                     that text and end_turn.
//   {"call": "<tool>", "arguments": {...}}  one tool_use block for the offered
//                                           tool whose name is <tool> or ends
//                                           with __<tool> or _<tool> (MCP tools
//                                           look like mcp__world__read_channel).
//                                           Without "arguments" the input is made
//                                           from the tool's input_schema: each
//                                           required property gets "x", 1, false,
//                                           [] or {} by type (its first enum
//                                           value when it has one). When no such
//                                           tool is offered the answer is the
//                                           text "fake: tool <tool> not offered"
//                                           and the log marks the turn missing.
//   {"raw_tool": "<name>", "input": {...}}  one tool_use block named exactly
//                                           <name> with that input ({} without
//                                           "input"), whether or not the request
//                                           offers the tool: a phantom or
//                                           malformed call, to record what the
//                                           harness answers (internal-task). Never
//                                           marked missing.
//   {"status": 529, "error_type": "overloaded_error", "message": "...", "headers": {"retry-after": "1"}}
//                                           that HTTP status with an Anthropic
//                                           error body {type: "error", error:
//                                           {type, message}} and those headers,
//                                           streamed request or not. error_type
//                                           defaults to overloaded_error for 529,
//                                           rate_limit_error for 429 and
//                                           api_error otherwise.
// Any turn may also carry:
//   "usage": {"input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"}
//       reported instead of the default input 1, output 1: in the JSON body,
//       and in a stream in both message_start and message_delta.
//   "match": {"min_messages": n, "system_contains": "<text>"}
//       the turn waits for an agent request with at least n messages and a
//       system prompt (string or text blocks) containing the text. A request
//       that does not match gets "ok" and the turn stays next.
// Which requests count as agent requests: a {"tool"} or {"text"} turn without
// "match" waits, as before, for a request whose tools array offers the shell
// tool. Every other turn ({"call"}, {"status"}, or any turn with "match",
// even "match": {}) waits for a request with a non-empty tools array.
// A {"raw_tool"} turn is one of those: it waits for an agent request, then
// plays its name whatever the tools array holds.
//
// --fail-status <code> answers every messages request with that HTTP status
// and an Anthropic error body (the model-error test).
// --require-key-prefix <p> refuses, with 401 authentication_error, any request
// whose x-api-key or Authorization bearer value does not start with <p>, so a
// capture shows that only the dummy trial token ever reached the fake.
// --max-requests <n> and --max-seconds <s> cap a capture: after n messages
// requests, or s seconds after the fake started, every messages request gets
// "ok" and end_turn and its log line carries capped: true.
//
// The log has one line per request, every path included (GET /v1/models and
// 404s too), written when the response body has been handed to the socket:
// {at, method, path, status, body (POST JSON only), headers (anthropic-version,
// anthropic-beta, user-agent and every x-stainless-* header), authorization_sha256
// (the sha256 of the x-api-key value, else of the Authorization value; never
// the value), played (the scripted turn, with missing: true when its tool was
// not offered, or null), capped (only when true), sent_at (ISO time the body
// was sent; null when the client went away first)}.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
export type Match = { min_messages?: number; system_contains?: string };
export type Turn = (
  | { tool: string }
  | { text: string }
  | { call: string; arguments?: Record<string, unknown> }
  | { raw_tool: string; input?: Record<string, unknown> }
  | { status: number; error_type?: string; message?: string; headers?: Record<string, string> }
) & { usage?: Usage; match?: Match };
const SHELL_TOOLS = ['exec', 'terminal', 'bash', 'shell'];
const DEFAULT_USAGE: Usage = { input_tokens: 1, output_tokens: 1 };
const ERROR_TYPES: Record<number, string> = { 529: 'overloaded_error', 429: 'rate_limit_error' };
const LOGGED_HEADERS = ['anthropic-version', 'anthropic-beta', 'user-agent', 'x-stainless-retry-count'];

/** The harness's shell tool name from the request's tools array, or null. */
export function shellTool(tools: unknown): string | null {
  if (!Array.isArray(tools)) return null;
  const names = tools.map(t => (t && typeof t === 'object' ? String((t as Record<string, unknown>).name ?? '') : ''));
  return SHELL_TOOLS.find(n => names.includes(n)) ?? null;
}

const toolList = (tools: unknown): Array<Record<string, unknown>> => (Array.isArray(tools) ? tools.filter(t => t && typeof t === 'object') : []);

/** The offered tool a {"call"} turn names: the exact name, else one ending in __<tool>, else one ending in _<tool>. */
export function findTool(tools: unknown, call: string): Record<string, unknown> | null {
  const list = toolList(tools);
  const name = (t: Record<string, unknown>) => String(t.name ?? '');
  return list.find(t => name(t) === call) ?? list.find(t => name(t).endsWith('__' + call)) ?? list.find(t => name(t).endsWith('_' + call)) ?? null;
}

/** Minimal arguments for an input_schema: each required property gets "x", 1, false, [] or {} by type, or its first enum value. */
export function minimalArguments(schema: unknown): Record<string, unknown> {
  const s = (schema && typeof schema === 'object' ? schema : {}) as { properties?: Record<string, Record<string, unknown>>; required?: unknown };
  const out: Record<string, unknown> = {};
  for (const key of Array.isArray(s.required) ? s.required.map(String) : []) {
    const p = s.properties?.[key] ?? {};
    if (Array.isArray(p.enum) && p.enum.length) { out[key] = p.enum[0]; continue; }
    const type = [p.type].flat().find(t => t !== 'null');
    out[key] = type === 'number' || type === 'integer' ? 1 : type === 'boolean' ? false : type === 'array' ? [] : type === 'object' ? {} : 'x';
  }
  return out;
}

const systemText = (system: unknown): string => typeof system === 'string' ? system
  : Array.isArray(system) ? system.map(b => (b && typeof b === 'object' ? String((b as Record<string, unknown>).text ?? '') : String(b))).join('\n') : '';

/** Whether a request may consume this turn: the shell-tool gate for a {"tool"} or {"text"} turn without "match", else a non-empty tools array that satisfies "match". */
export function eligible(body: Record<string, unknown>, turn: Turn): boolean {
  if (!turn.match && ('tool' in turn || 'text' in turn)) return shellTool(body.tools) !== null;
  if (!toolList(body.tools).length) return false;
  const { min_messages, system_contains } = turn.match ?? {};
  if (min_messages !== undefined && !(Array.isArray(body.messages) && body.messages.length >= min_messages)) return false;
  return system_contains === undefined || systemText(body.system).includes(system_contains);
}

export type Play = {
  status: number; content: Array<Record<string, unknown>>; stop_reason: string; turn: Turn | null; missing: boolean;
  usage: Usage; headers: Record<string, string>; error?: { type: string; message: string };
};

/** The full answer for one request: the next scripted turn when the request may consume it, else "ok". */
export function play(body: Record<string, unknown>, turns: Turn[], index: number, loop = false): Play {
  const turn = turns[loop && turns.length ? index % turns.length : index];
  const ok: Play = { status: 200, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', turn: null, missing: false, usage: DEFAULT_USAGE, headers: {} };
  if (!turn || !eligible(body, turn)) return ok;
  const base: Play = { ...ok, turn, usage: { ...DEFAULT_USAGE, ...turn.usage } };
  const id = 'toolu_fake_' + (index + 1);
  if ('status' in turn) {
    const error = { type: turn.error_type ?? ERROR_TYPES[turn.status] ?? 'api_error', message: turn.message ?? 'fake endpoint answers ' + turn.status };
    return { ...base, status: turn.status, content: [], stop_reason: '', headers: turn.headers ?? {}, error };
  }
  if ('text' in turn) return { ...base, content: [{ type: 'text', text: turn.text }] };
  if ('tool' in turn) {
    const name = shellTool(body.tools);
    if (!name) return { ...base, missing: true, content: [{ type: 'text', text: 'fake: no shell tool offered' }] };
    return { ...base, content: [{ type: 'tool_use', id, name, input: { command: turn.tool } }], stop_reason: 'tool_use' };
  }
  if ('raw_tool' in turn) return { ...base, content: [{ type: 'tool_use', id, name: turn.raw_tool, input: turn.input ?? {} }], stop_reason: 'tool_use' };
  const tool = findTool(body.tools, turn.call);
  if (!tool) return { ...base, missing: true, content: [{ type: 'text', text: 'fake: tool ' + turn.call + ' not offered' }] };
  return { ...base, content: [{ type: 'tool_use', id, name: String(tool.name), input: turn.arguments ?? minimalArguments(tool.input_schema) }], stop_reason: 'tool_use' };
}

/** The content blocks and stop reason for one request: the next scripted turn when the request carries tools, else "ok". */
export function answer(body: Record<string, unknown>, turns: Turn[], index: number, loop = false): { content: Array<Record<string, unknown>>; stop_reason: string; consumed: boolean } {
  const p = play(body, turns, index, loop);
  return { content: p.content, stop_reason: p.stop_reason, consumed: p.turn !== null };
}

/** The SSE body for one answer, the event shapes the Anthropic SDKs decode. With usage, message_start and message_delta report it instead of the default. */
export function stream(msg: Record<string, unknown>, content: Array<Record<string, unknown>>, stopReason: string, usage?: Usage): string {
  const events: Array<[string, unknown]> = [['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: usage ? { ...usage, output_tokens: 0 } : { input_tokens: 1, output_tokens: 0 } } }]];
  content.forEach((block, index) => {
    if (block.type === 'tool_use') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }]);
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }]);
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: usage ?? { output_tokens: 1 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join('');
}

/** Checks a parsed --script file and returns its turns. */
export function validateScript(script: unknown): Turn[] {
  const ok = (t: unknown) => {
    if (typeof t !== 'object' || t === null) return false;
    const r = t as Record<string, unknown>;
    if ('status' in r) return typeof r.status === 'number';
    if ('call' in r) return typeof r.call === 'string';
    if ('raw_tool' in r) return typeof r.raw_tool === 'string' && r.raw_tool !== '' && (r.input === undefined || (typeof r.input === 'object' && r.input !== null && !Array.isArray(r.input)));
    return 'tool' in r || 'text' in r;
  };
  if (!Array.isArray(script) || !script.every(ok)) throw new Error('--script must be a JSON list of {"tool": cmd}, {"text": reply}, {"call": tool, "arguments"}, {"raw_tool": name, "input"} or {"status": code} turns');
  return script as Turn[];
}

export type RequestRecord = {
  at: string; method: string; path: string; status: number; body?: Record<string, unknown>; headers: Record<string, string>;
  authorization_sha256: string | null; played: (Turn & { missing?: true }) | null; capped?: true; sent_at: string | null;
};
export type FakeOptions = {
  host?: string; port?: number; log?: string | null; script?: Turn[]; loop?: boolean; failStatus?: number;
  requireKeyPrefix?: string; maxRequests?: number; maxSeconds?: number;
};
export interface FakeAnthropic { port: number; url: string; requests: RequestRecord[]; stop(): void }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const errorBody = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } });

/** Starts the fake on host:port (port 0 picks a free one); it is listening when this returns. */
export function startFakeAnthropic(o: FakeOptions = {}): FakeAnthropic {
  const script = o.script ?? [];
  const requests: RequestRecord[] = [];
  if (o.log) mkdirSync(dirname(o.log), { recursive: true });
  const record = (r: RequestRecord) => { requests.push(r); if (o.log) appendFileSync(o.log, JSON.stringify(r) + '\n'); };
  const started = performance.now();
  let played = 0, messageRequests = 0;

  /** A response whose log line is written once its body has been handed to the socket, or when the client goes away first. */
  const send = (r: Omit<RequestRecord, 'sent_at'>, payload: string, headers: Record<string, string>) => {
    const bytes = new TextEncoder().encode(payload);
    let pushed = false, done = false;
    const finish = (sentAt: string | null) => { if (!done) { done = true; record({ ...r, sent_at: sentAt }); } };
    const body = new ReadableStream({
      pull(c) { if (!pushed) { pushed = true; c.enqueue(bytes); return; } finish(new Date().toISOString()); c.close(); },
      cancel() { finish(null); },
    });
    return new Response(body, { status: r.status, headers: { ...headers, 'content-length': String(bytes.length) } });
  };

  const server = Bun.serve({ port: o.port ?? 0, hostname: o.host ?? '127.0.0.1', async fetch(req) {
    const url = new URL(req.url);
    const at = new Date().toISOString();
    const xKey = req.headers.get('x-api-key'), auth = req.headers.get('authorization');
    const credential = xKey ?? auth;
    const headers: Record<string, string> = {};
    for (const [k, v] of req.headers) if (LOGGED_HEADERS.includes(k) || k.startsWith('x-stainless-')) headers[k] = v;
    let body: Record<string, unknown> | undefined;
    if (req.method === 'POST') { try { body = await req.json() as Record<string, unknown>; } catch { body = undefined; } }
    const reply = (status: number, payload: string, extra: { played?: RequestRecord['played']; capped?: boolean; headers?: Record<string, string> } = {}) => send({
      at, method: req.method, path: url.pathname, status, ...(body !== undefined ? { body } : {}), headers,
      authorization_sha256: credential === null ? null : sha256(credential), played: extra.played ?? null, ...(extra.capped ? { capped: true as const } : {}),
    }, payload, { 'content-type': 'application/json', ...extra.headers });

    if (o.requireKeyPrefix !== undefined) {
      const presented = [xKey, auth === null ? null : auth.replace(/^Bearer\s+/i, '')].filter((v): v is string => v !== null);
      if (!presented.length || presented.some(v => !v.startsWith(o.requireKeyPrefix!))) return reply(401, errorBody('authentication_error', 'fake endpoint: credential does not start with the required prefix'));
    }
    if (req.method === 'GET' && url.pathname.endsWith('/v1/models')) return reply(200, JSON.stringify({ data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false }));
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return reply(404, errorBody('not_found_error', url.pathname));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, errorBody('invalid_request_error', 'fake endpoint: body is not a JSON object'));
    const request = body;

    const msg = (content: Array<Record<string, unknown>>, stopReason: string, usage: Usage) => ({ id: 'msg_fake_' + Date.now(), type: 'message', role: 'assistant', model: String(request.model ?? ''), content, stop_reason: stopReason, stop_sequence: null, usage });
    const sse = { 'content-type': 'text/event-stream' };
    messageRequests++;
    if ((o.maxRequests !== undefined && messageRequests > o.maxRequests) || (o.maxSeconds !== undefined && (performance.now() - started) / 1000 > o.maxSeconds)) {
      const content = [{ type: 'text', text: 'ok' }];
      const m = msg(content, 'end_turn', DEFAULT_USAGE);
      return request.stream ? reply(200, stream(m, content, 'end_turn'), { capped: true, headers: sse }) : reply(200, JSON.stringify(m), { capped: true });
    }
    if (o.failStatus) return reply(o.failStatus, errorBody(o.failStatus === 401 ? 'authentication_error' : 'api_error', 'fake endpoint answers ' + o.failStatus));

    const p = play(request, script, played, o.loop ?? false);
    if (p.turn) played++;
    const turn = p.turn && p.missing ? { ...p.turn, missing: true as const } : p.turn;
    if (p.error) return reply(p.status, errorBody(p.error.type, p.error.message), { played: turn, headers: p.headers });
    const m = msg(p.content, p.stop_reason, p.usage);
    if (!request.stream) return reply(200, JSON.stringify(m), { played: turn });
    return reply(200, stream(m, p.content, p.stop_reason, p.turn?.usage ? p.usage : undefined), { played: turn, headers: sse });
  } });
  return { port: server.port as number, url: 'http://' + (o.host ?? '127.0.0.1') + ':' + server.port, requests, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
  const num = (name: string) => {
    const v = arg(name, '');
    if (!v) return undefined;
    if (!(Number(v) >= 0)) throw new Error(name + ' must be a non-negative number');
    return Number(v);
  };
  const host = arg('--host', '127.0.0.1');
  const log = arg('--log', 'results/gsta-135/preflight/fake-requests.ndjson');
  const scriptPath = arg('--script', '');
  const loop = process.argv.includes('--loop');
  const failStatus = Number(arg('--fail-status', '0'));
  const requireKeyPrefix = arg('--require-key-prefix', '') || undefined;
  const maxRequests = num('--max-requests'), maxSeconds = num('--max-seconds');
  const script = scriptPath ? validateScript(JSON.parse(readFileSync(scriptPath, 'utf8'))) : [];
  const fake = startFakeAnthropic({ host, port: Number(arg('--port', '8798')), log, script, loop, failStatus, requireKeyPrefix, maxRequests, maxSeconds });
  const notes = [
    script.length ? 'script ' + script.length + ' turns' + (loop ? ', looping' : '') : '',
    failStatus ? 'every request fails ' + failStatus : '',
    requireKeyPrefix !== undefined ? 'key prefix required' : '',
    maxRequests !== undefined ? 'cap ' + maxRequests + ' requests' : '',
    maxSeconds !== undefined ? 'cap ' + maxSeconds + ' s' : '',
  ].filter(Boolean);
  console.log('fake-anthropic listening on http://' + host + ':' + fake.port + ' (log ' + log + notes.map(n => ', ' + n).join('') + ')');
}
