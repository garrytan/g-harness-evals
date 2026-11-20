#!/usr/bin/env bun
// The MCP-at-scale catalog host (internal-task plan, "Fake servers"): one process serving every server of one catalog rung as
// its own MCP endpoint over streamable HTTP at /mcp/<server>, replaying each server's captured initialize result
// (serverInfo, capabilities, instructions) and its captured tools, in the captured order, limited to the rung's tools.
//
//   bun scripts/mcp-at-scale/catalog-host.ts --catalog <dir> --rung <30|75|150|300> --log <calls.jsonl>
//       [--listen <host>:8080, default 127.0.0.1:8080; cells bind the compose service name] [--fixtures <file> | --fixtures-env <NAME>] [--request <id>] [--trial <id>]
//       [--log-token-env <NAME>]
//   bun scripts/mcp-at-scale/catalog-host.ts --stdio <server> --catalog <dir> --rung <n> --log <calls.jsonl> [...]
//   bun scripts/mcp-at-scale/catalog-host.ts --stdio <server> --upstream http://<host>:8080
//
// tools/call: the arguments are validated against the tool's inputSchema (a failure answers isError, as a real server
// would), then answered from the fixtures file: the first rule of the request whose server, tool and argument matchers fit
// and whose "after" rules have all fired already (chaining), else the neutral default {"results":[],"total":0,...}.
//
//   fixtures.json { "default"?: <result>, "requests": { "<request id>": [ { "id": "r1", "server"?: "...", "tool": "...",
//                   "match"?: { "<arg>": <matcher> }, "after"?: ["r0"], "result": <result> } ] } }
//   <result>      { "json": <any> } | { "text": "..." } | { "error": "..." }
//   <matcher>     a literal (equal as JSON) | { "$ci": "x" } (equal ignoring case and outer spaces)
//                 | { "$contains": "x" } (substring, ignoring case) | { "$re": "..." } (regular expression, case-insensitive)
//
// The log is the evaluator's: one JSON line per completed request, including tool failures, but only successful
// initialize and tools/list responses count as connections. run is a random id per host process. GET /_he/log returns it to a caller holding the token in
// the variable --log-token-env names (header x-he-log-token), so a verifier can read it and the agent cannot. GET
// /healthz answers ok. Stdio mode serves one server the same way (logging locally), or with --upstream relays every
// request to a running host so the sidecar's log stays the one record.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import {
  CallToolRequestSchema, CompleteRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema, SetLevelRequestSchema, isJSONRPCRequest, isJSONRPCResultResponse, isJSONRPCErrorResponse,
  type CallToolResult, type JSONRPCRequest, type RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import { loadCatalog, rungServers, type CatalogTool, type RungServer } from './catalog-load.ts';

export type Matcher = unknown;
export type FixtureResult = { json: unknown } | { text: string } | { error: string };
export interface FixtureRule { id: string; server?: string; tool: string; match?: Record<string, Matcher>; after?: string[]; result: FixtureResult }
export interface Fixtures { default?: FixtureResult; requests: Record<string, FixtureRule[]> }
export interface LogLine {
  at: string; run: string; trial: string | null; request: string | null; transport: 'http' | 'stdio'; server: string; method: string;
  tool?: string; arguments?: unknown; validation?: { ok: boolean | null; error?: string }; fixture?: string;
  client?: unknown; protocol_requested?: unknown; ok?: boolean;
}

export const DEFAULT_RESULT: FixtureResult = { json: { results: [], total: 0, note: 'No results matched.' } };

/** One argument matcher against a value (see the header). */
export function matches(m: Matcher, v: unknown): boolean {
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const o = m as Record<string, unknown>;
    const norm = (x: unknown) => (typeof x === 'string' ? x.trim().toLowerCase() : JSON.stringify(x ?? null).toLowerCase());
    if ('$ci' in o) return v !== undefined && norm(v) === norm(o.$ci);
    if ('$contains' in o) return v !== undefined && norm(v).includes(String(o.$contains).toLowerCase());
    if ('$re' in o) return v !== undefined && new RegExp(String(o.$re), 'i').test(typeof v === 'string' ? v : JSON.stringify(v));
  }
  return JSON.stringify(m) === JSON.stringify(v);
}

export const argsMatch = (match: Record<string, Matcher> | undefined, args: Record<string, unknown>) =>
  Object.entries(match ?? {}).every(([k, m]) => matches(m, args[k]));

export function toCallResult(r: FixtureResult): CallToolResult {
  if ('error' in r) return { content: [{ type: 'text', text: r.error }], isError: true };
  if ('text' in r) return { content: [{ type: 'text', text: r.text }] };
  return { content: [{ type: 'text', text: JSON.stringify(r.json) }] };
}

export interface HostOptions {
  catalogDir?: string; rung?: string; servers?: RungServer[]; log: string | null; fixtures?: Fixtures | null; request?: string | null;
  trial?: string | null; logToken?: string | null;
}

/** The host: its servers, the fired fixture rules and the log. fetch answers HTTP; serverFor builds one server's MCP Server. */
export function createHost(o: HostOptions) {
  const servers = o.servers ?? rungServers(loadCatalog(o.catalogDir!), o.rung!);
  const byName = new Map(servers.map((s) => [s.server, s]));
  const run = randomUUID();
  const fired = new Set<string>();
  const rules = (o.request && o.fixtures?.requests[o.request]) || [];
  const validator = new AjvJsonSchemaValidator();
  const compiled = new Map<string, ((input: unknown) => { valid: boolean; errorMessage?: string }) | Error>();
  const lines: LogLine[] = [];
  if (o.log) mkdirSync(dirname(o.log), { recursive: true });

  const write = (l: Omit<LogLine, 'at' | 'run' | 'trial' | 'request'>) => {
    const line: LogLine = { at: new Date().toISOString(), run, trial: o.trial ?? null, request: o.request ?? null, ...l };
    lines.push(line);
    if (o.log) appendFileSync(o.log, JSON.stringify(line) + '\n');
  };

  const validate = (server: string, tool: CatalogTool, args: unknown): { ok: boolean | null; error?: string } => {
    const key = server + '/' + tool.name;
    if (!compiled.has(key)) {
      const { $schema: _drop, ...schema } = tool.inputSchema as Record<string, unknown>;
      try { compiled.set(key, validator.getValidator(schema as any) as any); } catch (e) { compiled.set(key, e as Error); }
    }
    const v = compiled.get(key)!;
    if (v instanceof Error) return { ok: null, error: 'schema not compilable: ' + v.message.slice(0, 300) };
    const r = v(args);
    return r.valid ? { ok: true } : { ok: false, error: r.errorMessage };
  };

  const answer = (server: string, tool: string, args: Record<string, unknown>): { id: string; result: FixtureResult } => {
    for (const r of rules) {
      if (r.tool !== tool || (r.server && r.server !== server)) continue;
      if (!(r.after ?? []).every((a) => fired.has(a))) continue;
      if (!argsMatch(r.match, args)) continue;
      fired.add(r.id);
      return { id: r.id, result: r.result };
    }
    return { id: 'default', result: o.fixtures?.default ?? DEFAULT_RESULT };
  };

  type CallDetails = Pick<LogLine, 'tool' | 'arguments' | 'validation' | 'fixture'>;
  const serverFor = (s: RungServer, calls: Map<RequestId, CallDetails>): Server => {
    const init = s.captured.initialize;
    const caps: Record<string, any> = { ...(init.capabilities ?? {}), tools: init.capabilities?.tools ?? {} };
    const srv = new Server({ ...init.serverInfo }, { capabilities: caps, ...(init.instructions ? { instructions: init.instructions } : {}) });
    srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: s.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as any, ...(t.annotations ? { annotations: t.annotations } : {}) })) }));
    srv.setRequestHandler(CallToolRequestSchema, async (req, { requestId }) => {
      const name = req.params.name;
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      const tool = s.tools.find((t) => t.name === name);
      if (!tool) {
        calls.set(requestId, { tool: name, arguments: args, validation: { ok: false, error: 'unknown tool' } });
        return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
      }
      const validation = validate(s.server, tool, args);
      if (validation.ok === false) {
        calls.set(requestId, { tool: name, arguments: args, validation });
        return { content: [{ type: 'text', text: 'Invalid arguments for tool ' + name + ': ' + validation.error }], isError: true };
      }
      const a = answer(s.server, name, args);
      calls.set(requestId, { tool: name, arguments: args, validation, fixture: a.id });
      return toCallResult(a.result);
    });
    if (caps.resources) {
      srv.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
      srv.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
    }
    if (caps.prompts) srv.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
    if (caps.logging) srv.setRequestHandler(SetLevelRequestSchema, async () => ({}));
    if (caps.completions) srv.setRequestHandler(CompleteRequestSchema, async () => ({ completion: { values: [] } }));
    return srv;
  };

  const observe = (s: RungServer, transport: 'http' | 'stdio') => {
    const pending = new Map<RequestId, JSONRPCRequest>();
    const calls = new Map<RequestId, CallDetails>();
    const sent = (m: unknown) => {
      if (!isJSONRPCResultResponse(m) && !isJSONRPCErrorResponse(m)) return;
      if (m.id === undefined) return;
      const req = pending.get(m.id);
      if (!req) return;
      pending.delete(m.id);
      const call = calls.get(m.id);
      calls.delete(m.id);
      const ok = isJSONRPCResultResponse(m) && m.result.isError !== true;
      const method = !ok && (req.method === 'initialize' || req.method === 'tools/list') ? req.method + ':rejected' : req.method;
      write({ transport, server: s.server, method, ok,
        ...(method === 'initialize' ? { client: req.params?.clientInfo ?? null, protocol_requested: req.params?.protocolVersion ?? null } : {}),
        ...(method === 'tools/call' ? { tool: typeof req.params?.name === 'string' ? req.params.name : undefined, arguments: req.params?.arguments, ...call } : {}),
      });
    };
    return { pending, sent, srv: serverFor(s, calls) };
  };

  const serveStdio = async (s: RungServer, transport = new StdioServerTransport()) => {
    const { pending, sent, srv } = observe(s, 'stdio');
    const send = transport.send.bind(transport);
    transport.send = async (msg) => { await send(msg); sent(msg); };
    transport.onmessage = (msg) => {
      if (!isJSONRPCRequest(msg)) return;
      pending.set(msg.id, msg);
    };
    await srv.connect(transport);
    const onmessage = transport.onmessage;
    transport.onmessage = (msg) => {
      if (isJSONRPCRequest(msg) && pending.has(msg.id)) return;
      onmessage?.(msg);
    };
  };

  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok\n');
    if (url.pathname === '/_he/log') {
      if (!o.logToken || req.headers.get('x-he-log-token') !== o.logToken) return new Response('not found\n', { status: 404 });
      return new Response(lines.map((l) => JSON.stringify(l) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } });
    }
    const m = /^\/mcp\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    const s = m ? byName.get(m[1]!) : undefined;
    if (!s) return Response.json({ jsonrpc: '2.0', error: { code: -32001, message: 'no such MCP server on this rung' }, id: null }, { status: 404 });
    if (req.method !== 'POST') {
      return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed; this server is stateless and only serves POST' }, id: null }, { status: 405, headers: { allow: 'POST' } });
    }
    let body: unknown;
    try { body = await req.json(); } catch {
      return Response.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, { status: 400 });
    }
    const { pending, sent, srv } = observe(s, 'http');
    for (const msg of Array.isArray(body) ? body : [body]) {
      if (!isJSONRPCRequest(msg)) continue;
      if (pending.has(msg.id)) return Response.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Duplicate MCP request ID' }, id: null }, { status: 400 });
      pending.set(msg.id, msg);
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await srv.connect(transport);
    try {
      const response = await transport.handleRequest(req, { parsedBody: body });
      if (response.status === 200 && pending.size) {
        const json = await response.clone().json();
        for (const msg of Array.isArray(json) ? json : [json]) sent(msg);
      }
      for (const m of pending.values()) {
        if (m.method === 'initialize' || m.method === 'tools/list') write({ transport: 'http', server: s.server, method: m.method + ':rejected', ok: false });
      }
      return response;
    } finally { void transport.close().catch(() => undefined); }
  };

  return { run, servers, lines, fired, fetch, serveStdio };
}

async function relayStdio(server: string, upstream: string): Promise<void> {
  const client = new Client({ name: 'catalog-host-stdio-relay', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(upstream.replace(/\/$/, '') + '/mcp/' + server)));
  const info = client.getServerVersion() ?? { name: server, version: '0' };
  const caps = client.getServerCapabilities() ?? { tools: {} };
  const instructions = client.getInstructions();
  const srv = new Server(info, { capabilities: { tools: caps.tools ?? {} }, ...(instructions ? { instructions } : {}) });
  srv.setRequestHandler(ListToolsRequestSchema, async () => client.listTools());
  srv.setRequestHandler(CallToolRequestSchema, async (req) => client.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} }) as Promise<CallToolResult>);
  await srv.connect(new StdioServerTransport());
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const usage = () => { console.error('usage: catalog-host.ts --catalog <dir> --rung <n> --log <file> [--listen h:p] [--fixtures f | --fixtures-env NAME] [--request id] [--trial id] [--log-token-env NAME] | --stdio <server> (--catalog ... | --upstream <url>)'); process.exit(2); };
  const stdio = flag('--stdio');
  const upstream = flag('--upstream');
  if (stdio && upstream) {
    await relayStdio(stdio, upstream);
  } else {
    const catalogDir = flag('--catalog');
    const rung = flag('--rung');
    const log = flag('--log');
    if (!catalogDir || !rung || !log) usage();
    const fixturesEnv = flag('--fixtures-env');
    const fixturesText = flag('--fixtures') ? readFileSync(flag('--fixtures')!, 'utf8') : fixturesEnv ? process.env[fixturesEnv] ?? null : null;
    const fixtures = fixturesText ? (JSON.parse(fixturesText) as Fixtures) : null;
    const tokenEnv = flag('--log-token-env');
    const host = createHost({ catalogDir, rung, log: log!, fixtures, request: flag('--request') ?? null, trial: flag('--trial') ?? null, logToken: tokenEnv ? process.env[tokenEnv] ?? null : null });
    if (stdio) {
      const s = host.servers.find((x) => x.server === stdio);
      if (!s) { console.error('catalog-host: rung ' + rung + ' has no server ' + stdio); process.exit(2); }
      await host.serveStdio(s);
    } else {
      const [hostname, port] = (flag('--listen') ?? '127.0.0.1:8080').split(':') as [string, string];
      Bun.serve({ hostname, port: Number(port), fetch: host.fetch });
      console.error('catalog host: rung ' + rung + ', ' + host.servers.length + ' servers, ' + host.servers.reduce((n, s) => n + s.tools.length, 0) + ' tools on ' + hostname + ':' + port + ' (run ' + host.run + ')');
    }
  }
}
