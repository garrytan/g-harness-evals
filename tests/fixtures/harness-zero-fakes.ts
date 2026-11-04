// Keyless fakes for the Harness Zero tests (tests/harness-zero-*.test.ts): a strict fake model upstream that speaks all
// three wires (Anthropic messages, OpenAI Responses, Chat Completions) and refuses with 400 any request whose history
// breaks the wire's rules, a fake MCP server (JSON or SSE, sessions, expiry, a lost write), the real metering proxy in
// lease mode, and a spawner that runs zero.ts under a scrubbed environment. No model is called and no key is read: the
// proxy's upstream keys are placeholders passed in its own environment.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { trialKey, trialToken } from '../../runner/trial/proxy.ts';

export const ROOT = resolve(import.meta.dir, '../..');
export const ZERO_DIR = join(ROOT, 'harnesses/harness-zero');
export const UPSTREAM_KEY = 'placeholder-upstream-key-harness-zero';
type Json = Record<string, any>;
export type FakeWire = 'anthropic' | 'openai-responses' | 'chat-completions';

/** One scripted answer. calls[].args may be a string on the OpenAI wires (sent as-is, so a broken JSON string can be tested). */
export interface FakeTurn {
  text?: string; calls?: Array<{ name: string; args?: Json | string; id?: string }>; think?: boolean; cutoff?: boolean; empty?: boolean;
  status?: number; errorType?: string; headers?: Record<string, string>; hang?: boolean; breakBody?: boolean; failed?: boolean;
}
export interface Seen { wire: FakeWire | 'count'; path: string; body: Json; apiKey: string | null; authorization: string | null; status: number; cacheRead: number; violation?: string }

const PATHS: Record<string, FakeWire | 'count'> = { '/v1/messages': 'anthropic', '/v1/responses': 'openai-responses', '/v1/chat/completions': 'chat-completions', '/v1/messages/count_tokens': 'count' };
const strip = (b: Json) => { const { cache_control: _c, ...rest } = b; return rest; };
const h = (s: string) => createHash('sha256').update(s).digest('hex');

/** The 400 message the Anthropic API gives Opus 5.5 for thinking.type enabled (request req_011CgbFZyRXHJSyZoyCYNi7L). */
export const ANTHROPIC_ENABLED_REFUSAL = '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"';

/** The rules each wire's history must keep; a request that breaks one is answered 400 by the fake. */
function violation(wire: FakeWire, b: Json, issued: { thinking: Map<string, string>; reasoning: Set<string>; reasoningContent: Set<string> }, model: string): string | null {
  if (b.model !== model) return 'model ' + b.model + ' is not ' + model;
  if (wire === 'anthropic') {
    const m = b.messages as Json[];
    if (!Array.isArray(m) || !m.length || m[0]!.role !== 'user') return 'messages must start with a user message';
    if (b.thinking?.type === 'enabled') return ANTHROPIC_ENABLED_REFUSAL;
    if (b.thinking && b.thinking.type !== 'adaptive') return 'thinking.type must be adaptive';
    if (b.output_config !== undefined && !['low', 'medium', 'high', 'max'].includes(b.output_config?.effort)) return 'output_config.effort must be low, medium, high or max';
    for (let i = 0; i < m.length; i++) {
      if (i && m[i]!.role === m[i - 1]!.role) return 'two ' + m[i]!.role + ' messages in a row at ' + i;
      if (m[i]!.role !== 'assistant') continue;
      for (const blk of m[i]!.content) if (blk.type === 'thinking' && issued.thinking.get(blk.signature) !== blk.thinking) return 'thinking block at ' + i + ' was changed or not issued';
      const ids = m[i]!.content.filter((x: Json) => x.type === 'tool_use').map((x: Json) => x.id);
      if (!ids.length) continue;
      if (b.thinking && m[i]!.content[0]?.type !== 'thinking') return 'with thinking on, an assistant tool_use message must start with its thinking block';
      const next = m[i + 1];
      const got = (next?.content ?? []).filter((x: Json) => x.type === 'tool_result').map((x: Json) => x.tool_use_id);
      if (JSON.stringify([...got].sort()) !== JSON.stringify([...ids].sort())) return 'tool_use ' + ids.join(',') + ' at ' + i + ' has results ' + got.join(',');
    }
  } else if (wire === 'openai-responses') {
    if (b.store !== false) return 'store must be false';
    if (!(b.include ?? []).includes('reasoning.encrypted_content')) return 'include must ask for reasoning.encrypted_content';
    const items = b.input as Json[];
    for (const [i, it] of items.entries()) {
      if (it.type === 'reasoning' && !issued.reasoning.has(it.encrypted_content)) return 'reasoning item at ' + i + ' lost its encrypted_content';
      if (it.type === 'function_call' && !items.slice(i + 1).some((o) => o.type === 'function_call_output' && o.call_id === it.call_id)) return 'function_call ' + it.call_id + ' has no output';
      if (it.type === 'function_call_output' && !items.slice(0, i).some((o) => o.type === 'function_call' && o.call_id === it.call_id)) return 'function_call_output ' + it.call_id + ' has no call';
    }
  } else {
    const m = b.messages as Json[];
    if (m[0]?.role !== 'system') return 'the first message must be the system message';
    for (const [i, msg] of m.entries()) {
      if (msg.role === 'assistant' && msg.reasoning_content !== undefined && !issued.reasoningContent.has(msg.reasoning_content)) return 'reasoning_content at ' + i + ' was changed';
      if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
      const ids = msg.tool_calls.map((c: Json) => c.id);
      const got = m.slice(i + 1, i + 1 + ids.length).filter((x) => x.role === 'tool').map((x) => x.tool_call_id);
      if (JSON.stringify(got) !== JSON.stringify(ids)) return 'tool_calls ' + ids.join(',') + ' at ' + i + ' answered by ' + got.join(',');
    }
  }
  return null;
}

/** Anthropic-style prompt cache: every block (tools, system, then message blocks) extends the prefix; a request reads the
 *  longest prefix written before, and writes the prefix at each of its cache_control breakpoints. */
function anthropicCache(b: Json, cache: Set<string>): number {
  const blocks: Array<{ s: string; bp: boolean }> = [];
  for (const t of b.tools ?? []) blocks.push({ s: JSON.stringify(strip(t)), bp: !!t.cache_control });
  for (const s of b.system ?? []) blocks.push({ s: JSON.stringify(strip(s)), bp: !!s.cache_control });
  for (const m of b.messages ?? []) for (const c of m.content) blocks.push({ s: m.role + JSON.stringify(strip(c)), bp: !!c.cache_control });
  let prefix = '', read = 0;
  const writes: string[] = [];
  for (const blk of blocks) {
    prefix += blk.s;
    const key = h(prefix);
    if (cache.has(key)) read = prefix.length;
    if (blk.bp) writes.push(key);
  }
  for (const k of writes) cache.add(k);
  return read;
}

export function startFakeModel(model: string) {
  const script: FakeTurn[] = [];
  const seen: Seen[] = [];
  const issued = { thinking: new Map<string, string>(), reasoning: new Set<string>(), reasoningContent: new Set<string>() };
  const cache = new Set<string>();
  const closed: string[] = [];
  let n = 0;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, async fetch(req) {
    const url = new URL(req.url);
    url.pathname = url.pathname.slice(Math.max(0, url.pathname.indexOf('/v1/')));
    const wire = PATHS[url.pathname];
    const body = await req.json().catch(() => ({})) as Json;
    const rec: Seen = { wire: wire ?? 'count', path: url.pathname, body, apiKey: req.headers.get('x-api-key'), authorization: req.headers.get('authorization'), status: 200, cacheRead: 0 };
    seen.push(rec);
    if (!wire || req.method !== 'POST') { rec.status = 404; return Response.json({ error: { type: 'not_found', message: 'no route' } }, { status: 404 }); }
    if (wire === 'count') return Response.json({ input_tokens: Math.ceil(JSON.stringify(body).length / 4) });
    const bad = violation(wire, body, issued, model);
    if (bad) { rec.status = 400; rec.violation = bad; return Response.json(wire === 'anthropic' ? { type: 'error', error: { type: 'invalid_request_error', message: bad } } : { error: { type: 'invalid_request_error', message: bad } }, { status: 400, headers: { 'request-id': 'req_fake_bad' } }); }
    const k = ++n;
    const turn = script.shift() ?? { text: 'done' };
    if (turn.hang) {
      return new Promise<Response>((res) => req.signal.addEventListener('abort', () => { closed.push(url.pathname); res(new Response('closed', { status: 499 })); }));
    }
    if (turn.breakBody) {
      return new Response(new ReadableStream({ async start(c) { c.enqueue(new TextEncoder().encode('{"id":"partial')); await Bun.sleep(50); c.error(new Error('reset')); } }), { status: turn.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    if (turn.status) {
      rec.status = turn.status;
      const type = turn.errorType ?? (turn.status === 529 ? 'overloaded_error' : turn.status === 429 ? 'rate_limit_error' : turn.status >= 500 ? (wire === 'anthropic' ? 'api_error' : 'server_error') : 'invalid_request_error');
      const headers = { 'request-id': 'req_fake_' + k, ...(turn.status === 429 || turn.status >= 500 ? { 'retry-after': '0' } : {}), ...turn.headers };
      return Response.json(wire === 'anthropic' ? { type: 'error', error: { type, message: 'fake ' + turn.status } } : { error: { type, code: null, message: 'fake ' + turn.status } }, { status: turn.status, headers });
    }
    const calls = (turn.calls ?? []).map((c, i) => ({ id: c.id ?? (wire === 'anthropic' ? 'toolu_' : 'call_') + k + '_' + i, name: c.name, args: c.args ?? {} }));
    const think = turn.think || (wire === 'anthropic' && !!body.thinking) || (wire === 'openai-responses' && body.reasoning?.effort === 'high') || (wire === 'chat-completions' && body.reasoning_effort === 'high');
    if (wire === 'anthropic') {
      rec.cacheRead = anthropicCache(body, cache);
      const content: Json[] = [];
      if (think && !turn.empty) { issued.thinking.set('sig-' + k, 'thought ' + k); content.push({ type: 'thinking', thinking: 'thought ' + k, signature: 'sig-' + k }); }
      if (turn.text && !turn.empty) content.push({ type: 'text', text: turn.text });
      if (!turn.empty) for (const c of calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: typeof c.args === 'string' ? JSON.parse(c.args) : c.args });
      return Response.json({ id: 'msg_' + k, type: 'message', role: 'assistant', model: body.model, content, stop_reason: turn.cutoff ? 'max_tokens' : calls.length ? 'tool_use' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: Math.ceil(rec.cacheRead / 4) } });
    }
    if (wire === 'openai-responses') {
      if (turn.failed) return Response.json({ id: 'resp_' + k, object: 'response', status: 'failed', error: { code: 'server_error', message: 'fake failure' }, model: body.model, output: [] });
      const output: Json[] = [];
      if (think && !turn.empty) { issued.reasoning.add('enc-' + k); output.push({ type: 'reasoning', id: 'rs_' + k, summary: [], encrypted_content: 'enc-' + k }); }
      if (turn.text && !turn.empty) output.push({ type: 'message', id: 'msg_' + k, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: turn.text, annotations: [] }] });
      if (!turn.empty) for (const c of calls) output.push({ type: 'function_call', id: 'fc_' + c.id, call_id: c.id, name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args), status: 'completed' });
      return Response.json({ id: 'resp_' + k, object: 'response', status: turn.cutoff ? 'incomplete' : 'completed', ...(turn.cutoff ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), model: body.model, output,
        usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: think ? 2 : 0 }, total_tokens: 15 } });
    }
    const message: Json = { role: 'assistant', content: turn.empty ? null : turn.text ?? null };
    if (think && !turn.empty) { issued.reasoningContent.add('reasoning ' + k); message.reasoning_content = 'reasoning ' + k; }
    if (calls.length && !turn.empty) message.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) } }));
    return Response.json({ id: 'chatcmpl_' + k, object: 'chat.completion', model: body.model, choices: [{ index: 0, message, finish_reason: turn.cutoff ? 'length' : calls.length ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  } });
  return { port: server.port as number, url: 'http://127.0.0.1:' + server.port, script, seen, closed, stop: () => server.stop(true) };
}
export type FakeModel = ReturnType<typeof startFakeModel>;

export interface McpCall { tool: string; args: Json; session: string | null; answered: boolean }
/** A fake MCP server. Tools: read_notes (readOnlyHint), lookup_member (unannotated, so not a known read), post_message (write), big_dump
 *  (20 kB of text). tools/list pages after two tools. */
export function startFakeMcp(o: { token: string; sse?: boolean; hold?: boolean; sessions?: boolean; instructions?: string | null }) {
  const calls: McpCall[] = [];
  const sessions = new Set<string>();
  const state = { initialized: 0, expireNext: false, loseNextWrite: false, rpcErrorNext: false, failInit: false, expireAfter: null as string | null, methods: [] as string[] };
  const tools = [
    { name: 'read_notes', description: 'Read the team notes.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'lookup_member', description: 'Look up a member by handle.', inputSchema: { type: 'object', properties: { handle: { type: 'string' } } } },
    { name: 'post_message', description: 'Post a message to a channel.', inputSchema: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } },
    { name: 'big_dump', description: 'Dump the whole archive.', inputSchema: { type: 'object', properties: {} } },
  ];
  const answer = (msg: Json, headers: Record<string, string> = {}) => {
    if (!o.sse) return Response.json(msg, { headers });
    const event = 'event: message\ndata: ' + JSON.stringify(msg) + '\n\n';
    const body = o.hold ? new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(event)); } }) : event;
    return new Response(body, { headers: { 'content-type': 'text/event-stream', ...headers } });
  };
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    if (req.headers.get('authorization') !== 'Bearer ' + o.token) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const msg = await req.json() as Json;
    state.methods.push(msg.method);
    const sid = req.headers.get('mcp-session-id');
    if (msg.method === 'initialize') {
      if (state.failInit && state.initialized > 0) return new Response('down', { status: 503 });
      state.initialized++;
      const id = 'sess-' + state.initialized;
      if (o.sessions) sessions.add(id);
      return answer({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1' }, ...(o.instructions ? { instructions: o.instructions } : {}) } }, o.sessions ? { 'mcp-session-id': id } : {});
    }
    if (o.sessions && (!sid || !sessions.has(sid))) return new Response('no such session', { status: 404 });
    if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (msg.method === 'tools/list') return answer({ jsonrpc: '2.0', id: msg.id, result: msg.params?.cursor ? { tools: tools.slice(2) } : { tools: tools.slice(0, 2), nextCursor: 'p2' } });
    if (msg.method !== 'tools/call') return answer({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no method' } });
    if (state.expireNext) { state.expireNext = false; if (sid) sessions.delete(sid); return new Response('session expired', { status: 404 }); }
    const { name, arguments: args } = msg.params;
    const call: McpCall = { tool: name, args, session: sid, answered: true };
    calls.push(call);
    if (name === 'post_message' && state.loseNextWrite) { state.loseNextWrite = false; call.answered = false; return new Response('bad gateway', { status: 502 }); }
    if (state.rpcErrorNext) { state.rpcErrorNext = false; return answer({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'bad channel' } }); }
    if (state.expireAfter === name) { state.expireAfter = null; state.expireNext = true; }
    const text = name === 'big_dump' ? 'x'.repeat(20_000) : name === 'post_message' ? 'posted: ' + args.text : name + ' ok';
    return answer({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: false } });
  } });
  return { url: 'http://127.0.0.1:' + server.port + '/mcp', calls, state, stop: () => server.stop(true) };
}
export type FakeMcp = ReturnType<typeof startFakeMcp>;

/** The real metering proxy in lease mode on the loopback, upstreams pointed at the fake, placeholder keys in its own env. */
export async function startProxy(dir: string, upstream: string, models: string[], extra: string[] = []) {
  const control = 'control-' + process.pid;
  let stderr = '';
  for (let port = 8870 + Math.floor(Math.random() * 20); port < 8920; port++) {
    const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', '127.0.0.1:' + port, '--budget-ledger', join(dir, 'ledger.sqlite'), '--lease-usd', '50',
      '--run-id', 'zero-' + port, '--new-run', '--max-output-tokens', '32768', '--allow-models', models.join(','), '--upstream', 'anthropic=' + upstream, '--upstream', 'openai=' + upstream,
      '--usage-log', join(dir, 'usage.ndjson'), '--control-token', control, ...extra],
      { cwd: ROOT, env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: dir, ANTHROPIC_API_KEY: UPSTREAM_KEY, OPENAI_API_KEY: UPSTREAM_KEY }, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100; i++) {
      if (proc.exitCode !== null) break;
      try { await fetch('http://127.0.0.1:' + port + '/__proxy/status'); return proxyHandle(proc, port, control); } catch { await Bun.sleep(50); }
    }
    proc.kill('SIGKILL'); await proc.exited;
    stderr = await new Response(proc.stderr).text();
    if (!/EADDRINUSE|in use/i.test(stderr)) throw new Error('proxy did not start: ' + stderr.slice(0, 500));
  }
  throw new Error('no free proxy port: ' + stderr.slice(0, 300));
}
function proxyHandle(proc: ReturnType<typeof Bun.spawn>, port: number, control: string) {
  return {
    port,
    /** Bind a trial slot with a fresh per-trial token; returns the base URL for a provider and the token. */
    async bind(trialId: string, provider: 'anthropic' | 'openai', models?: string[]) {
      const token = trialToken(trialId);
      const r = await fetch('http://127.0.0.1:' + port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control },
        body: JSON.stringify({ slot: trialId, key: trialKey(trialId), token, ...(models ? { models } : {}) }) });
      if (r.status !== 200) throw new Error('bind failed ' + r.status);
      return { baseUrl: 'http://127.0.0.1:' + port + '/' + trialId + '/' + provider, token };
    },
    async stop() { proc.kill('SIGTERM'); await proc.exited; },
  };
}

export interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string }
export function trial(instruction = 'Say hello.'): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-zero-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns') };
  for (const d of [t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.workspace, 'instruction.md'), instruction);
  return t;
}

/** A copy of the harness directory with candidates.json replaced, for sets and knobs the frozen files do not hold. */
export function harnessCopy(candidates: Json): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-zero-harness-'));
  cpSync(ZERO_DIR, dir, { recursive: true });
  writeFileSync(join(dir, 'config/candidates.json'), JSON.stringify({ schema_version: 1, sets: candidates }, null, 2));
  return dir;
}

/** The scrubbed environment zero.ts gets: this allowlist and nothing from the test's own environment. */
export function zeroEnv(t: Trial, model: { baseUrl: string; token: string; name: string }, extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: t.state, HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns,
    HE_TRIAL_ID: 'zero-test', HE_TIME_BUDGET_S: '30', HE_TASK_SLICE: 'smoke', HE_MODEL_BASE_URL: model.baseUrl, HE_MODEL_API_KEY: model.token, HE_MODEL_NAME: model.name, ...extra };
}

export async function runZero(env: Record<string, string>, entry = 'run', dir = ZERO_DIR, args: string[] = []) {
  const proc = Bun.spawn([process.execPath, join(dir, 'zero.ts'), entry, ...args], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

export function spawnServe(env: Record<string, string>, dir = ZERO_DIR) {
  return Bun.spawn([process.execPath, join(dir, 'zero.ts'), 'serve'], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
}

export async function waitFor(cond: () => boolean, ms: number, what: string) {
  const until = Date.now() + ms;
  while (!cond()) { if (Date.now() > until) throw new Error('timed out waiting for ' + what); await Bun.sleep(25); }
}

let turnNo = 0;
/** Write a TurnRequest the way the runner does (tmp + rename) and wait for its response. */
export async function turn(t: Trial, o: { member?: string; channel?: { id: string; type: 'dm' | 'channel' }; thread_ts?: string | null; prompt: string; budget?: number; turn?: number }, waitMs = 30_000) {
  const n = o.turn ?? ++turnNo;
  const name = 'turn-' + String(n).padStart(4, '0');
  const req = { turn: n, trial_id: 'zero-test', prompt: o.prompt, actor: { member: o.member ?? 'dana-okafor', slack_user_id: 'U1', name: 'Dana', role: 'pm', team: null },
    channel: o.channel ?? { id: 'D1', type: 'dm' }, text: o.prompt, ts: '1.' + n, thread_ts: o.thread_ts ?? null, sim_now: '2026-10-31T10:00:00-07:00', time_budget_s: o.budget ?? 30 };
  writeFileSync(join(t.turns, name + '.request.json.tmp'), JSON.stringify(req));
  const { renameSync } = await import('node:fs');
  renameSync(join(t.turns, name + '.request.json.tmp'), join(t.turns, name + '.request.json'));
  const resp = join(t.turns, name + '.response.json');
  await waitFor(() => existsSync(resp), waitMs, name + ' response');
  return JSON.parse(readFileSync(resp, 'utf8')) as { turn: number; exit: number; reply_text: string | null; detail?: string; started_at: string; ended_at: string };
}

export const adapterLog = (t: Trial) => existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : '';
export const turnLines = (t: Trial) => adapterLog(t).split('\n').filter((l) => l.includes(' ZERO_TURN ')).map((l) => JSON.parse(l.slice(l.indexOf('ZERO_TURN ') + 10)));

/** Every file under a directory, with its contents. */
export function files(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p)); else out.push({ path: p, text: readFileSync(p, 'latin1') });
  }
  return out;
}
