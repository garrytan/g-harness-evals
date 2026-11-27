#!/usr/bin/env bun
// A streamable HTTP front for a stdio MCP server, for harnesses that take only HTTP MCP servers (QM: its core registers
// http(s) URLs only, and runs in its own container). Each MCP session (an initialize without Mcp-Session-Id) starts its
// own child, as a stdio client would start the server, and gets a new Mcp-Session-Id; every later POST with that id is
// written to the child's stdin as one JSON-RPC line, and the child's answer with the same id is the HTTP response
// (application/json). Notifications from the client get 202; DELETE ends the session and its child. Messages the child
// sends unasked (notifications, server-to-client requests) are not delivered: the plain JSON response mode has no stream
// for them, and their count goes to stderr. GET /healthz answers ok. Node builtins only, so it runs as a single file.
//
//   bun stdio-http-bridge.ts --host <address> --port 58090 -- <command> [args...]
// --host is required and never a wildcard: the caller names the one address its client reaches.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

interface Session { child: ChildProcessByStdio<Writable, Readable, null>; pending: Map<string, (m: unknown) => void>; unasked: number }

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 && (sep < 0 || i < sep) ? argv[i + 1] : undefined; };
const command = sep >= 0 ? argv.slice(sep + 1) : [];
const port = Number(flag('--port'));
const host = flag('--host');
if (!command.length || !Number.isInteger(port) || !host || /^(0+\.){3}0+$|^\[?::\]?$/.test(host)) {
  console.error('usage: stdio-http-bridge.ts --host <address, not a wildcard> --port <n> -- <command> [args...]');
  process.exit(64);
}
const sessions = new Map<string, Session>();
const rpcError = (id: unknown, message: string, status: number) => Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message } }, { status });

function start(id: string): Session {
  const child = spawn(command[0]!, command.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });
  const s: Session = { child, pending: new Map(), unasked: 0 };
  child.stdin.on('error', (e) => console.error('stdio-http-bridge: session ' + id + ' stdin: ' + e.message));
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      const answer = m && m.id !== undefined && m.method === undefined ? s.pending.get(JSON.stringify(m.id)) : undefined;
      if (answer) { s.pending.delete(JSON.stringify(m.id)); answer(m); } else console.error('stdio-http-bridge: not delivered (' + ++s.unasked + '): ' + String(m?.method ?? 'response'));
    }
  });
  child.on('exit', (code) => {
    sessions.delete(id);
    for (const [key, answer] of s.pending) answer({ jsonrpc: '2.0', id: JSON.parse(key), error: { code: -32000, message: 'the server exited (' + code + ')' } });
    s.pending.clear();
  });
  return s;
}

Bun.serve({
  hostname: host, port, idleTimeout: 255,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/healthz') return new Response('ok');
    if (path !== '/mcp') return new Response('not found', { status: 404 });
    const sid = req.headers.get('mcp-session-id');
    if (req.method === 'DELETE') {
      sessions.get(sid ?? '')?.child.kill();
      return new Response(null, { status: sessions.delete(sid ?? '') ? 200 : 404 });
    }
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } });
    let msg: any;
    try { msg = await req.json(); } catch { return rpcError(null, 'the body is not JSON', 400); }
    if (Array.isArray(msg)) return rpcError(null, 'batches are not supported', 400);
    let id = sid;
    if (msg?.method === 'initialize') { id = randomUUID(); sessions.set(id, start(id)); }
    else if (!id) return rpcError(msg?.id, 'Mcp-Session-Id is required', 400);
    const s = sessions.get(id);
    if (!s) return rpcError(msg?.id, 'unknown Mcp-Session-Id', 404);
    s.child.stdin.write(JSON.stringify(msg) + '\n');
    const headers = { 'mcp-session-id': id };
    if (msg?.id === undefined) return new Response(null, { status: 202, headers });
    const reply = await new Promise((resolve) => s.pending.set(JSON.stringify(msg.id), resolve));
    return Response.json(reply, { headers });
  },
});
