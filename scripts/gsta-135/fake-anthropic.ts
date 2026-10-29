#!/usr/bin/env bun
// A keyless fake Anthropic messages endpoint for the internal-task preflight
// (scripts/gsta-135/preflight.sh). It records every request body to an ndjson
// file and answers one short assistant turn, streamed or not, the way
// tests/adapter-install.test.ts's fakeAnthropic does. It binds the docker
// bridge gateway address only (the address containers reach as
// host.docker.internal), never 0.0.0.0, and holds no credential.
//
//   bun scripts/gsta-135/fake-anthropic.ts --host 172.17.0.1 --port 8798 --log results/gsta-135/preflight/fake-requests.ndjson [--script turns.json]
//
// --script <file>: a JSON list of turns the fake plays, in order, against the
// requests that carry a tools array (the harness's agent loop; a request with
// no tools, such as a title or summary call, always gets the plain "ok" text).
// {"tool": "<shell command>"} answers with one tool_use block for the
// harness's own shell tool, found by name in that request's tools array
// (OpenClaw exec, Hermes terminal, else bash or shell), input {command}.
// {"text": "<reply>"} answers with that text and end_turn. When the script is
// used up, every later request gets "ok" and end_turn, so the loop ends;
// with --loop the script starts over instead, so the agent loop never ends
// (the wall-clock test). --fail-status <code> answers every messages request
// with that HTTP status and an Anthropic error body (the model-error test).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Turn = { tool: string } | { text: string };
const SHELL_TOOLS = ['exec', 'terminal', 'bash', 'shell'];

/** The harness's shell tool name from the request's tools array, or null. */
export function shellTool(tools: unknown): string | null {
  if (!Array.isArray(tools)) return null;
  const names = tools.map(t => (t && typeof t === 'object' ? String((t as Record<string, unknown>).name ?? '') : ''));
  return SHELL_TOOLS.find(n => names.includes(n)) ?? null;
}

/** The content blocks and stop reason for one request: the next scripted turn when the request carries tools, else "ok". */
export function answer(body: Record<string, unknown>, turns: Turn[], index: number, loop = false): { content: Array<Record<string, unknown>>; stop_reason: string; consumed: boolean } {
  const tool = shellTool(body.tools);
  const turn = tool ? turns[loop && turns.length ? index % turns.length : index] : undefined;
  if (!turn) return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', consumed: false };
  if ('tool' in turn) return { content: [{ type: 'tool_use', id: 'toolu_fake_' + (index + 1), name: tool!, input: { command: turn.tool } }], stop_reason: 'tool_use', consumed: true };
  return { content: [{ type: 'text', text: turn.text }], stop_reason: 'end_turn', consumed: true };
}

/** The SSE body for one answer, the event shapes the Anthropic SDKs decode. */
export function stream(msg: Record<string, unknown>, content: Array<Record<string, unknown>>, stopReason: string): string {
  const events: Array<[string, unknown]> = [['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }]];
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
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}

if (import.meta.main) {
  const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
  const host = arg('--host', '127.0.0.1');
  const port = Number(arg('--port', '8798'));
  const log = arg('--log', 'results/gsta-135/preflight/fake-requests.ndjson');
  const scriptPath = arg('--script', '');
  const loop = process.argv.includes('--loop');
  const failStatus = Number(arg('--fail-status', '0'));
  mkdirSync(dirname(log), { recursive: true });
  const script: Turn[] = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : [];
  if (!Array.isArray(script) || script.some(t => typeof t !== 'object' || t === null || (!('tool' in t) && !('text' in t)))) throw new Error('--script must be a JSON list of {"tool": cmd} or {"text": reply} turns');
  let played = 0;
  const server = Bun.serve({ port, hostname: host, async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/v1/models')) return Response.json({ data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false });
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
      appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, status: 404 }) + '\n');
      return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: url.pathname } }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    const body = await req.json() as Record<string, unknown>;
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: 'POST', path: url.pathname, body, ...(failStatus ? { status: failStatus } : {}) }) + '\n');
    if (failStatus) return new Response(JSON.stringify({ type: 'error', error: { type: failStatus === 401 ? 'authentication_error' : 'api_error', message: 'fake endpoint answers ' + failStatus } }), { status: failStatus, headers: { 'content-type': 'application/json' } });
    const a = answer(body, script, played, loop);
    if (a.consumed) played++;
    const msg = { id: 'msg_fake_' + Date.now(), type: 'message', role: 'assistant', model: String(body.model ?? ''), content: a.content, stop_reason: a.stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    return new Response(stream(msg, a.content, a.stop_reason), { headers: { 'content-type': 'text/event-stream' } });
  } });
  console.log(`fake-anthropic listening on http://${host}:${server.port} (log ${log}${script.length ? ', script ' + script.length + ' turns' + (loop ? ', looping' : '') : ''}${failStatus ? ', every request fails ' + failStatus : ''})`);
}
