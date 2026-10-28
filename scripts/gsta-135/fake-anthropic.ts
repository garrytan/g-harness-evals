#!/usr/bin/env bun
// A keyless fake Anthropic messages endpoint for the internal-task preflight
// (scripts/gsta-135/preflight.sh). It records every request body to an ndjson
// file and answers one short assistant turn, streamed or not, the way
// tests/adapter-install.test.ts's fakeAnthropic does. It binds the docker
// bridge gateway address only (the address containers reach as
// host.docker.internal), never 0.0.0.0, and holds no credential.
//
//   bun scripts/gsta-135/fake-anthropic.ts --host 172.17.0.1 --port 8798 --log results/gsta-135/preflight/fake-requests.ndjson
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const host = arg('--host', '127.0.0.1');
const port = Number(arg('--port', '8798'));
const log = arg('--log', 'results/gsta-135/preflight/fake-requests.ndjson');
mkdirSync(dirname(log), { recursive: true });

const server = Bun.serve({ port, hostname: host, async fetch(req) {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/v1/models')) return Response.json({ data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false });
  if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, status: 404 }) + '\n');
    return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: url.pathname } }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const body = await req.json() as Record<string, unknown>;
  appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: 'POST', path: url.pathname, body }) + '\n');
  const msg = { id: 'msg_fake', type: 'message', role: 'assistant', model: String(body.model ?? ''), content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!body.stream) return Response.json(msg);
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
} });
console.log(`fake-anthropic listening on http://${host}:${server.port} (log ${log})`);
