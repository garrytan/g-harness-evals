#!/usr/bin/env bun
// A keyless fake OpenAI Responses endpoint for the Codex harness tests
// (tests/codex-adapter.test.ts). It stands where the metering proxy's
// `--upstream openai=<url>` points, so it accepts only `POST /v1/responses`
// (the path the proxy forwards after it strips `/<slot>/openai`) and answers
// every other method or path 404. Every request is recorded to an ndjson file,
// one line per request, with the model, the stream flag, the output cap, the
// reasoning settings, the tool names, the sha256 of the Authorization header
// (never the header itself), the logged headers (user-agent, originator,
// openai-beta and every x-stainless-* header) and, for a POST with a JSON body,
// the whole request body as `body` (the shape scripts/gsta-135/fake-anthropic.ts
// logs, so scripts/anatomy/dissect.ts and store.ts read both). Each request is
// answered as a Responses SSE stream with `response.completed` usage, the shape
// the proxy meters.
//
//   bun tests/fixtures/fake-responses.ts --host 127.0.0.1 --port 8799 --log fake.ndjson [--script turns.json] [--loop] [--fail-status 400]
//       [--require-key-prefix sk-capture-dummy] [--max-requests 200] [--max-seconds 900]
//
// --script <file>: a JSON list of turns the fake plays, in order, against the
// requests that carry a tools array (the agent loop; a request with no tools
// always gets the plain "ok" text and consumes nothing).
//   {"text": "<reply>"}                      an assistant message
//   {"tool": "<shell command>"}              run that shell command with the
//                                            harness's own shell tool
//   {"call": "<tool>", "arguments": {...}}   call that tool (an MCP tool is
//                                            mcp__<server>__<tool>)
// When the request offers Codex's code-mode tool (a custom tool named exec, as
// codex 0.165.0 does for gpt-6 models; OpenClaw's function tool exec is not one) both become one custom_tool_call to exec
// whose JavaScript calls tools.exec_command({cmd}) or tools.<tool>(arguments);
// otherwise a function_call for the shell tool found by name (exec_command,
// shell_command or shell) or for the tool whose name equals <tool>,
// else ends with __<tool>, else ends with _<tool> (Hermes names MCP tools
// mcp_<server>_<tool>).
//   {"status": 400 | 402 | 500 | ...}        that HTTP status with an OpenAI
//                                            error body and no usage
// A call or shell turn whose tool is not offered still consumes the turn: the
// answer is the text "fake: no tool ..." and the log marks the turn missing: true,
// as scripts/gsta-135/fake-anthropic.ts does.
// When the script is used up every later request gets "ok", so the loop ends;
// with --loop the script starts over, so the loop never ends (the wall-clock
// test). --fail-status <code> answers every request with that status.
// --require-key-prefix <p> answers 401 to any request whose Authorization
// bearer value does not start with <p>, so an anatomy capture shows that only
// the proxy's dummy key reached the fake. --max-requests <n> and
// --max-seconds <s> cap a capture: after n /v1/responses requests, or s seconds
// after the fake started, every request gets "ok" and its log line carries
// capped: true.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Turn = { text: string } | { tool: string } | { call: string; arguments?: Record<string, unknown> } | { status: number; message?: string };
export interface FakeRequestRecord {
  at: string; method: string; path: string; status: number; model?: string | null; stream?: boolean; max_output_tokens?: number | null;
  reasoning?: unknown; tools?: string[]; tool_choice?: unknown; authorization_sha256?: string | null; user_agent?: string | null; originator?: string | null; played?: (Turn & { missing?: true }) | null;
  headers?: Record<string, string>; body?: Record<string, unknown>; capped?: true;
}

const SHELL_TOOLS = ['exec_command', 'shell_command', 'shell'];
const LOGGED_HEADERS = ['user-agent', 'originator', 'openai-beta'];
/** Tool names a request offers: the top-level tools array and the additional_tools input items, namespaces flattened. */
export function toolNames(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (tools: unknown) => {
    if (!Array.isArray(tools)) return;
    for (const t of tools) {
      if (!t || typeof t !== 'object') continue;
      const r = t as Record<string, unknown>;
      if (r.type === 'namespace') walk(r.tools);
      else if (r.name ?? r.type) out.push(String(r.name ?? r.type));
    }
  };
  walk(body.tools);
  if (Array.isArray(body.input)) for (const item of body.input) if (item && typeof item === 'object' && (item as Record<string, unknown>).type === 'additional_tools') walk((item as Record<string, unknown>).tools);
  return out;
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Codex's code mode: the request offers a custom (freeform) tool named exec. OpenClaw's exec is a function tool and is not one. */
function offersCodeMode(body: Record<string, unknown>): boolean {
  const walk = (tools: unknown): boolean => Array.isArray(tools) && tools.some((t) => t && typeof t === 'object' && (((t as Record<string, unknown>).type === 'custom' && (t as Record<string, unknown>).name === 'exec') || ((t as Record<string, unknown>).type === 'namespace' && walk((t as Record<string, unknown>).tools))));
  return walk(body.tools) || (Array.isArray(body.input) && body.input.some((i) => i && typeof i === 'object' && (i as Record<string, unknown>).type === 'additional_tools' && walk((i as Record<string, unknown>).tools)));
}

/** The arguments a shell tool takes, by tool name (function tools; under code mode the call goes through exec). */
function shellArguments(name: string, command: string): Record<string, unknown> {
  if (name === 'exec_command') return { cmd: command };
  if (name === 'shell_command') return { command };
  return { command: ['bash', '-c', command] };
}

export function validateScript(script: unknown): Turn[] {
  if (!Array.isArray(script) || script.some(t => typeof t !== 'object' || t === null || !('text' in t || 'tool' in t || 'call' in t || 'status' in t))) {
    throw new Error('--script must be a JSON list of {"text"}, {"tool"}, {"call", "arguments"} or {"status"} turns');
  }
  return script as Turn[];
}

/** The output items for one request, the HTTP status to answer with, and the scripted turn it used, if any. */
export function answer(body: Record<string, unknown>, turns: Turn[], index: number, loop = false): { status: number; output: Array<Record<string, unknown>>; turn: Turn | null; message?: string; missing?: true } {
  const names = toolNames(body);
  const turn = names.length ? turns[loop && turns.length ? index % turns.length : index] ?? null : null;
  const text = (t: string) => [{ type: 'message', id: 'msg_fake_' + (index + 1), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: t, annotations: [] }] }];
  if (!turn) return { status: 200, output: text('ok'), turn: null };
  if ('status' in turn) return { status: turn.status, output: [], turn, message: turn.message };
  if ('text' in turn) return { status: 200, output: text(turn.text), turn };
  // Codex 0.165.0 code mode: the only shell and MCP route is the custom tool exec, whose JavaScript calls tools.<name>(args).
  const exec = (code: string) => [{ type: 'custom_tool_call', id: 'ctc_fake_' + (index + 1), call_id: 'call_fake_' + (index + 1), name: 'exec', input: code, status: 'completed' }];
  if (offersCodeMode(body)) {
    const [tool, args] = 'tool' in turn ? ['exec_command', { cmd: turn.tool, login: false }] : [turn.call, turn.arguments ?? {}];
    return { status: 200, output: exec('const r = await tools.' + tool + '(' + JSON.stringify(args) + ');\ntext(JSON.stringify(r));'), turn };
  }
  if ('tool' in turn) {
    const name = SHELL_TOOLS.find(n => names.includes(n));
    if (!name) return { status: 200, output: text('fake: no shell tool among ' + names.join(',')), turn, missing: true };
    return { status: 200, output: [{ type: 'function_call', id: 'fc_fake_' + (index + 1), call_id: 'call_fake_' + (index + 1), name, arguments: JSON.stringify(shellArguments(name, turn.tool)), status: 'completed' }], turn };
  }
  const name = names.find(n => n === turn.call) ?? names.find(n => n.endsWith('__' + turn.call)) ?? names.find(n => n.endsWith('_' + turn.call));
  if (!name) return { status: 200, output: text('fake: no tool ' + turn.call + ' among ' + names.join(',')), turn, missing: true };
  return { status: 200, output: [{ type: 'function_call', id: 'fc_fake_' + (index + 1), call_id: 'call_fake_' + (index + 1), name, arguments: JSON.stringify(turn.arguments ?? {}), status: 'completed' }], turn };
}

export const USAGE = { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 1240 };

/** The SSE body for one answer: the Responses event shapes Codex decodes, ending in response.completed with usage. */
export function stream(id: string, model: string, output: Array<Record<string, unknown>>): string {
  const base = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), model };
  const events: Array<Record<string, unknown>> = [{ type: 'response.created', response: { ...base, status: 'in_progress', output: [] } }];
  output.forEach((item, i) => {
    events.push({ type: 'response.output_item.added', output_index: i, item: item.type === 'message' ? { ...item, status: 'in_progress', content: [] } : item.type === 'custom_tool_call' ? { ...item, input: '', status: 'in_progress' } : { ...item, arguments: '', status: 'in_progress' } });
    if (item.type === 'message') {
      const t = String(((item.content as Array<Record<string, unknown>>)[0] ?? {}).text ?? '');
      events.push({ type: 'response.output_text.delta', item_id: item.id, output_index: i, content_index: 0, delta: t });
      events.push({ type: 'response.output_text.done', item_id: item.id, output_index: i, content_index: 0, text: t });
    } else if (item.type === 'custom_tool_call') {
      events.push({ type: 'response.custom_tool_call_input.delta', item_id: item.id, output_index: i, delta: item.input });
      events.push({ type: 'response.custom_tool_call_input.done', item_id: item.id, output_index: i, input: item.input });
    } else {
      events.push({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: i, delta: item.arguments });
      events.push({ type: 'response.function_call_arguments.done', item_id: item.id, output_index: i, arguments: item.arguments });
    }
    events.push({ type: 'response.output_item.done', output_index: i, item });
  });
  events.push({ type: 'response.completed', response: { ...base, status: 'completed', output, usage: USAGE } });
  return events.map((e, n) => 'event: ' + e.type + '\ndata: ' + JSON.stringify({ ...e, sequence_number: n }) + '\n\n').join('');
}

export interface FakeResponses { port: number; requests: FakeRequestRecord[]; setScript(turns: Turn[], loop?: boolean): void; stop(): void }

/** onBody gets every parsed /v1/responses request body (tests that read what the harness sent, such as a hook's context). */
export function startFakeResponses(o: { host?: string; port?: number; log?: string | null; script?: Turn[]; loop?: boolean; failStatus?: number; onBody?: (body: Record<string, unknown>) => void; requireKeyPrefix?: string; maxRequests?: number; maxSeconds?: number } = {}): FakeResponses {
  let script = o.script ?? [];
  let loop = o.loop ?? false;
  const requests: FakeRequestRecord[] = [];
  if (o.log) mkdirSync(dirname(o.log), { recursive: true });
  const record = (r: FakeRequestRecord) => { requests.push(r); if (o.log) appendFileSync(o.log, JSON.stringify(r) + '\n'); };
  let played = 0, responsesRequests = 0;
  const started = performance.now();
  const server = Bun.serve({ port: o.port ?? 0, hostname: o.host ?? '127.0.0.1', idleTimeout: 0, async fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get('authorization');
    const headers: Record<string, string> = {};
    for (const [k, v] of req.headers) if (LOGGED_HEADERS.includes(k) || k.startsWith('x-stainless-')) headers[k] = v;
    const meta = { at: new Date().toISOString(), method: req.method, path: url.pathname + url.search, authorization_sha256: auth ? sha256(auth) : null, user_agent: req.headers.get('user-agent'), originator: req.headers.get('originator'), headers };
    if (o.requireKeyPrefix !== undefined && !(auth ?? '').replace(/^Bearer\s+/i, '').startsWith(o.requireKeyPrefix)) {
      record({ ...meta, status: 401 });
      return Response.json({ error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'fake-responses: credential does not start with the required prefix' } }, { status: 401 });
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/responses' || url.search) {
      record({ ...meta, status: 404 });
      return Response.json({ error: { type: 'invalid_request_error', code: 'not_found', message: 'fake-responses: no route ' + req.method + ' ' + url.pathname } }, { status: 404 });
    }
    let body: Record<string, unknown>;
    try { body = await req.json() as Record<string, unknown>; } catch { record({ ...meta, status: 400 }); return Response.json({ error: { type: 'invalid_request_error', message: 'fake-responses: body is not JSON' } }, { status: 400 }); }
    o.onBody?.(body);
    const fields = { model: typeof body.model === 'string' ? body.model : null, stream: body.stream === true, max_output_tokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : null, reasoning: body.reasoning ?? null, tools: toolNames(body), tool_choice: body.tool_choice ?? null, body };
    responsesRequests++;
    if ((o.maxRequests !== undefined && responsesRequests > o.maxRequests) || (o.maxSeconds !== undefined && (performance.now() - started) / 1000 > o.maxSeconds)) {
      const output = answer({}, [], 0).output;
      const capped: FakeRequestRecord = { ...meta, ...fields, status: 200, played: null, capped: true };
      if (o.log) appendFileSync(o.log, JSON.stringify(capped) + '\n');
      const { body: _kept_in_log, ...light } = capped;
      requests.push(light);
      const id = 'resp_fake_' + requests.length;
      if (!body.stream) return Response.json({ id, object: 'response', status: 'completed', model: fields.model, output, usage: USAGE });
      return new Response(stream(id, String(fields.model ?? ''), output), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (o.failStatus) {
      record({ ...meta, ...fields, status: o.failStatus });
      return Response.json({ error: { type: o.failStatus === 401 ? 'invalid_api_key' : 'api_error', message: 'fake-responses answers ' + o.failStatus } }, { status: o.failStatus });
    }
    const a = answer(body, script, played, loop);
    if (a.turn) played++;
    record({ ...meta, ...fields, status: a.status, played: a.turn && a.missing ? { ...a.turn, missing: true } : a.turn });
    if (a.status !== 200) return Response.json({ error: { type: a.status === 402 ? 'insufficient_quota' : a.status >= 500 ? 'server_error' : 'invalid_request_error', message: a.message ?? 'fake-responses answers ' + a.status } }, { status: a.status });
    const id = 'resp_fake_' + requests.length;
    if (!body.stream) return Response.json({ id, object: 'response', status: 'completed', model: fields.model, output: a.output, usage: USAGE });
    return new Response(stream(id, String(fields.model ?? ''), a.output), { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port as number, requests, setScript: (turns, again = false) => { script = turns; loop = again; played = 0; }, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
  const host = arg('--host', '127.0.0.1');
  const log = arg('--log', 'results/fake-responses.ndjson');
  const scriptPath = arg('--script', '');
  const failStatus = Number(arg('--fail-status', '0'));
  const num = (name: string) => { const v = arg(name, ''); if (!v) return undefined; if (!(Number(v) >= 0)) throw new Error(name + ' must be a non-negative number'); return Number(v); };
  const requireKeyPrefix = arg('--require-key-prefix', '') || undefined;
  const maxRequests = num('--max-requests'), maxSeconds = num('--max-seconds');
  const fake = startFakeResponses({ host, port: Number(arg('--port', '8799')), log, script: scriptPath ? validateScript(JSON.parse(readFileSync(scriptPath, 'utf8'))) : [], loop: process.argv.includes('--loop'), failStatus, requireKeyPrefix, maxRequests, maxSeconds });
  const notes = [scriptPath ? 'script ' + scriptPath : '', failStatus ? 'every request fails ' + failStatus : '', requireKeyPrefix !== undefined ? 'key prefix required' : '',
    maxRequests !== undefined ? 'cap ' + maxRequests + ' requests' : '', maxSeconds !== undefined ? 'cap ' + maxSeconds + ' s' : ''].filter(Boolean);
  console.log('fake-responses listening on http://' + host + ':' + fake.port + ' (log ' + log + notes.map(n => ', ' + n).join('') + ')');
}
