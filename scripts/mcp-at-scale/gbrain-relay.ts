#!/usr/bin/env bun
// Logging relay in front of a stdio MCP server (internal-task plan, "Arms" item 3: gbrain calls are logged by a relay in front
// of gbrain serve, like world/world-mcp/stdio.ts). The harness launches a stdio bridge to a Unix socket owned by the
// sidecar. The sidecar starts a relay and the real server for each connection and passes MCP through, so the harness sees what the
// server sends (initialize result and instructions, tools/list, list_changed notifications). Each client request and the
// matching response's outcome go to the log in the catalog host's line format (catalog-host.ts LogLine), so grade.py
// reads both logs the same way: "relay/start" when the harness launched the relay, "<method>:received" when a request
// arrives, then "<method>" with ok when the server answers (initialize, tools/list and tools/call), so a harness that
// stops the server before it answers still leaves a trace. The first tools/list result is also written whole to <log dir>/tools-list.json.
//
//   bun gbrain-relay.ts --log /var/lib/he-gbrain/calls.jsonl --server gbrain [--trial <id>] [--env K=V]... -- gbrain serve --surface full
//   bun gbrain-relay.ts --dump <file> [--env K=V]... [--args-from <file>] -- gbrain serve
// --env sets a variable for the child (harnesses such as Codex start MCP servers with a cleared environment). --args-from
// appends child arguments from a JSON array, or the serve flags a gbrain setup --dry-run --json record registers.
// --dump is the build-time mode: it is the client, sends initialize and tools/list, and writes {serverInfo, instructions,
// tools} to <file>.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { spawn } from 'node:child_process';

export interface RelayLine {
  at: string; trial: string | null; transport: 'stdio'; server: string; method: string; id?: string | number | null;
  tool?: string; arguments?: unknown; ok?: boolean; error?: string; client?: unknown; protocol_requested?: unknown;
}

/** What one client-to-server JSON-RPC message logs, or null for a response or notification from the client. */
export function requestLine(m: any, server: string, trial: string | null): RelayLine | null {
  if (m?.jsonrpc !== '2.0' || typeof m.method !== 'string' || (typeof m.id !== 'string' && typeof m.id !== 'number')) return null;
  const line: RelayLine = { at: new Date().toISOString(), trial, transport: 'stdio', server, method: m.method, id: m.id };
  if (m.method === 'tools/call') { line.tool = m.params?.name; line.arguments = m.params?.arguments ?? {}; }
  if (m.method === 'initialize') { line.client = m.params?.clientInfo ?? null; line.protocol_requested = m.params?.protocolVersion ?? null; }
  return line;
}

/** The outcome a server response gives the request it answers: a JSON-RPC error, or a tools/call result with isError. */
export function outcome(m: any): { ok: boolean; error?: string } {
  if (m?.error) return { ok: false, error: String(m.error.message ?? 'error').slice(0, 300) };
  if (m?.jsonrpc !== '2.0' || !m.result || typeof m.result !== 'object' || Array.isArray(m.result)) return { ok: false, error: 'invalid JSON-RPC result' };
  if (m?.result?.isError) return { ok: false, error: String(m.result.content?.[0]?.text ?? 'isError').slice(0, 300) };
  return { ok: true };
}

async function runSocketRelay(path: string, log: string, own: string[], child: string[]): Promise<void> {
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, '');
  rmSync(join(dirname(log), 'tools-list.json'), { force: true });
  rmSync(path, { force: true });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    const proc = spawn(process.execPath, [import.meta.path, ...own, '--', ...child], { stdio: ['pipe', 'pipe', 'inherit'] });
    socket.pipe(proc.stdin);
    proc.stdout.pipe(socket);
    socket.on('error', () => socket.destroy());
    proc.stdin.on('error', () => socket.destroy());
    proc.on('error', () => socket.destroy());
    socket.on('close', () => proc.kill());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  chmodSync(path, 0o666);
}

function connectSocket(path: string): void {
  const socket = createConnection(path);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout, { end: false });
  socket.on('error', (e) => { console.error(e.message); process.exitCode = 1; });
  socket.on('close', () => process.stdin.pause());
}

/** Splits a byte stream into newline-delimited lines, keeping the unfinished tail. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
  };
}

async function pump(s: ReadableStream<Uint8Array>, onChunk: (text: string) => void): Promise<void> {
  const reader = s.getReader();
  const dec = new TextDecoder();
  for (;;) { const { done, value } = await reader.read(); if (done) return; onChunk(dec.decode(value, { stream: true })); }
}

/** Extra child arguments from a JSON array, or from a gbrain setup --dry-run --json record's target. */
export function argsFrom(doc: any): string[] {
  if (Array.isArray(doc)) return doc.map(String);
  const t = doc?.target;
  if (!t?.surface) throw new Error('no surface in the setup record');
  return ['--surface', String(t.surface), ...(t.advertise ? ['--advertise', String(t.advertise)] : [])];
}

async function dumpTools(child: string[], env: Record<string, string | undefined>, file: string): Promise<never> {
  const proc = Bun.spawn(child, { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', env });
  const got = new Map<number, any>();
  const split = lineSplitter((t) => { try { const m = JSON.parse(t); if (typeof m.id === 'number') got.set(m.id, m); } catch {} });
  void pump(proc.stdout, split);
  const ask = async (id: number, method: string, params: object) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let i = 0; i < 1200 && !got.has(id); i++) await Bun.sleep(100);
    const m = got.get(id);
    if (!m?.result) { console.error('gbrain-relay --dump: no ' + method + ' result: ' + JSON.stringify(m?.error ?? 'timeout')); process.exit(1); }
    return m.result;
  };
  const init = await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'he-gbrain-dump', version: '1' } });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await ask(2, 'tools/list', {});
  writeFileSync(file, JSON.stringify({ serverInfo: init.serverInfo, protocolVersion: init.protocolVersion, instructions: init.instructions ?? null, tools: list.tools }, null, 1) + '\n');
  proc.kill();
  process.exit(0);
}

async function relay(log: string, server: string, trial: string | null, child: string[], env: Record<string, string | undefined>): Promise<never> {
  mkdirSync(dirname(log), { recursive: true });
  const toolsDump = join(dirname(log), 'tools-list.json');
  const write = (l: RelayLine) => appendFileSync(log, JSON.stringify(l) + '\n');
  const tracked = (method: string) => method === 'initialize' || method === 'tools/list' || method === 'tools/call';
  const pending = new Map<string, RelayLine>();
  write({ at: new Date().toISOString(), trial, transport: 'stdio', server, method: 'relay/start' });
  const proc = Bun.spawn(child, { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', env });
  const fromClient = lineSplitter((text) => {
    let m: any;
    try { m = JSON.parse(text); } catch { proc.stdin.write(text + '\n'); return; }
    const lines = (Array.isArray(m) ? m : [m]).map((one) => requestLine(one, server, trial)).filter((l) => l !== null);
    const ids = lines.map((l) => JSON.stringify(l.id));
    if (new Set(ids).size !== ids.length || ids.some((id) => pending.has(id))) {
      for (const l of lines) if (tracked(l.method)) write({ ...l, method: l.method + ':received' });
      return;
    }
    for (const l of lines) {
      write({ ...l, method: tracked(l.method) ? l.method + ':received' : l.method });
      pending.set(JSON.stringify(l.id), l);
    }
    proc.stdin.write(text + '\n');
  });
  const fromServer = lineSplitter((text) => {
    process.stdout.write(text + '\n');
    let m: any;
    try { m = JSON.parse(text); } catch { return; }
    for (const one of Array.isArray(m) ? m : [m]) {
      if (one?.id === undefined || one.method) continue;
      const l = pending.get(JSON.stringify(one.id));
      if (!l) continue;
      pending.delete(JSON.stringify(one.id));
      if (!tracked(l.method)) continue;
      const result = outcome(one);
      write({ ...l, ...result });
      if (l.method === 'tools/list' && result.ok) {
        try { writeFileSync(toolsDump, JSON.stringify(one.result, null, 1) + '\n', { flag: 'wx' }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      }
    }
  });
  const responses = pump(proc.stdout, fromServer);
  void pump(Bun.stdin.stream(), fromClient).then(() => proc.stdin.end());
  const code = await proc.exited;
  await responses;
  for (const l of pending.values()) if (tracked(l.method)) write({ ...l, ok: false, error: 'the server exited before answering' });
  process.exit(code);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cut = argv.indexOf('--');
  const own = cut >= 0 ? argv.slice(0, cut) : argv;
  const flag = (n: string) => { const i = own.indexOf(n); return i >= 0 ? own[i + 1] : undefined; };
  const connect = flag('--connect');
  if (connect) {
    connectSocket(connect);
  } else {
    const env: Record<string, string | undefined> = { ...process.env };
    own.forEach((a, i) => { if (a === '--env') { const kv = own[i + 1] ?? ''; const eq = kv.indexOf('='); if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1); } });
    const extra = flag('--args-from');
    const child = [...(cut >= 0 ? argv.slice(cut + 1) : []), ...(extra ? argsFrom(JSON.parse(readFileSync(extra, 'utf8'))) : [])];
    const dump = flag('--dump');
    if (dump && child.length) await dumpTools(child, env, dump);
    const log = flag('--log');
    if (!log || !child.length) { console.error('usage: gbrain-relay.ts [--listen <socket>] --log <file> [--server name] [--trial id] [--env K=V] -- <command> [args...] | --connect <socket>'); process.exit(2); }
    const listen = flag('--listen');
    if (listen) {
      const i = own.indexOf('--listen');
      await runSocketRelay(listen, log, [...own.slice(0, i), ...own.slice(i + 2)], child);
    } else {
      await relay(log, flag('--server') ?? 'gbrain', flag('--trial') ?? null, child, env);
    }
  }
}
