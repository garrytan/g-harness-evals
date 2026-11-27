import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { checkCatalog, loadCatalog, qualifiedName, rungServers, syntheticCatalog, writeCatalog, type Catalog } from '../scripts/mcp-at-scale/catalog-load.ts';
import { argsMatch, createHost, matches, type Fixtures, type LogLine } from '../scripts/mcp-at-scale/catalog-host.ts';

const HOST = join(import.meta.dir, '../scripts/mcp-at-scale/catalog-host.ts');
const cat = syntheticCatalog();
const dir = mkdtempSync(join(tmpdir(), 'mcp-host-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('catalog', () => {
  test('the synthetic catalog is nested, sized to its rungs and unique per rung', () => {
    expect(checkCatalog(cat)).toEqual([]);
    for (const r of ['30', '75', '150', '300']) {
      const names = rungServers(cat, r).flatMap((s) => s.tools.map((t) => qualifiedName(s.server, t.name)));
      expect(names.length).toBe(Number(r));
      expect(new Set(names).size).toBe(names.length);
    }
    expect(Object.keys(cat.servers).length).toBe(15);
    expect(Object.values(cat.servers).every((s) => s.tools.length === 20)).toBe(true);
  });

  test('near-twin servers repeat tool names, so only the qualified name is unique', () => {
    const bare = rungServers(cat, '300').flatMap((s) => s.tools.map((t) => t.name));
    expect(new Set(bare).size).toBeLessThan(bare.length);
  });

  test('a qualified-name clash, a missing tool, a dropped tool and a wrong size are each reported', () => {
    const bad: Catalog = JSON.parse(JSON.stringify(cat));
    bad.servers['a-b'] = { ...JSON.parse(JSON.stringify(cat.servers['ash-tracker'])), server: 'a-b' };
    bad.servers['a_b'] = { ...JSON.parse(JSON.stringify(cat.servers['ash-tracker'])), server: 'a_b' };
    bad.ladder.rungs['300']!.servers.push({ server: 'a-b', tools: ['create_issue'] }, { server: 'a_b', tools: ['create_issue', 'no_such_tool'] });
    bad.ladder.rungs['150']!.servers[0]!.tools.pop();
    const problems = checkCatalog(bad).join('\n');
    expect(problems).toContain('share the qualified name mcp__a_b__create_issue');
    expect(problems).toContain('server a_b has no tool no_such_tool');
    expect(problems).toContain('rung 300 serves 303 tools, more than 0 from 300');
    expect(problems).toContain('rung 150 drops');
    expect(problems).toContain('does not serve core tool');
  });
});

describe('matchers', () => {
  test('literal, case-insensitive, contains and regex', () => {
    expect(matches('ATL-12', 'ATL-12')).toBe(true);
    expect(matches('ATL-12', 'atl-12')).toBe(false);
    expect(matches({ $ci: 'ATL-12' }, ' atl-12 ')).toBe(true);
    expect(matches({ $contains: 'invoice' }, 'Q3 Invoices')).toBe(true);
    expect(matches({ $re: '^acme$' }, 'ACME')).toBe(true);
    expect(matches(5, 5)).toBe(true);
    expect(matches({ $ci: 'x' }, undefined)).toBe(false);
    expect(argsMatch({ workspace: { $ci: 'acme' }, issue_id: 'A-1' }, { workspace: 'Acme', issue_id: 'A-1', limit: 3 })).toBe(true);
    expect(argsMatch({ workspace: { $ci: 'acme' } }, {})).toBe(false);
  });
});

describe('catalog host over streamable HTTP', () => {
  const fixtures: Fixtures = {
    requests: {
      'req-1': [
        { id: 'find', server: 'ash-tracker', tool: 'create_issue', match: { workspace: { $ci: 'acme' } }, result: { json: { issue_id: 'ACME-7' } } },
        { id: 'follow', server: 'fern-chat', tool: 'get_message', match: { message_id: 'ACME-7' }, after: ['find'], result: { text: 'chained answer' } },
      ],
    },
  };
  const log = join(dir, 'calls.jsonl');
  let host: ReturnType<typeof createHost>;
  let server: ReturnType<typeof Bun.serve>;
  let base = '';
  beforeAll(() => {
    writeCatalog(join(dir, 'cat'), cat);
    host = createHost({ catalogDir: join(dir, 'cat'), rung: '30', log, fixtures, request: 'req-1', trial: 'trial-a', logToken: 'tok' });
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: host.fetch });
    base = 'http://127.0.0.1:' + server.port;
  });
  afterAll(() => server.stop(true));
  const connect = async (name: string) => {
    const c = new Client({ name: 'test-client', version: '9.9.9' });
    await c.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/' + name)));
    return c;
  };
  const logged = (): LogLine[] => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  test('replays the captured initialize result and only the rung tools, in captured order', async () => {
    const c = await connect('ash-tracker');
    expect(c.getServerVersion()).toMatchObject({ name: 'ash-tracker-mcp', version: '1.0.0' });
    expect(c.getInstructions()).toBe(cat.servers['ash-tracker']!.initialize.instructions);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(cat.ladder.rungs['30']!.servers.find((s) => s.server === 'ash-tracker')!.tools);
    expect(tools[0]!.inputSchema).toEqual(cat.servers['ash-tracker']!.tools.find((t) => t.name === tools[0]!.name)!.inputSchema as any);
    await c.close();
  });

  test('a server outside the rung is not served', async () => {
    const res = await fetch(base + '/mcp/tundra-ci', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(res.status).toBe(404);
  });

  test('validates arguments, answers the default, then chains fixtures', async () => {
    const tracker = await connect('ash-tracker');
    const chat = await connect('fern-chat');
    const invalid = await tracker.callTool({ name: 'create_issue', arguments: { title: 'no workspace' } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain('Invalid arguments');
    const early = await chat.callTool({ name: 'get_message', arguments: { workspace: 'acme', message_id: 'ACME-7' } });
    expect(JSON.parse((early.content as any)[0].text)).toEqual({ results: [], total: 0, note: 'No results matched.' });
    const first = await tracker.callTool({ name: 'create_issue', arguments: { workspace: 'ACME', title: 'Broken login' } });
    expect(JSON.parse((first.content as any)[0].text)).toEqual({ issue_id: 'ACME-7' });
    const second = await chat.callTool({ name: 'get_message', arguments: { workspace: 'acme', message_id: 'ACME-7' } });
    expect((second.content as any)[0].text).toBe('chained answer');
    const unknown = await tracker.callTool({ name: 'delete_everything', arguments: {} });
    expect(unknown.isError).toBe(true);
    await tracker.close();
    await chat.close();
  });

  test('writes one log line per initialize, tools/list and tools/call, with validation and fixture', () => {
    const lines = logged();
    expect(lines.every((l) => l.run === host.run && l.trial === 'trial-a' && l.request === 'req-1' && l.transport === 'http')).toBe(true);
    const init = lines.find((l) => l.method === 'initialize' && l.server === 'ash-tracker')!;
    expect(init.client).toEqual({ name: 'test-client', version: '9.9.9' });
    expect(init.ok).toBe(true);
    expect(typeof init.protocol_requested).toBe('string');
    expect(lines.some((l) => l.method === 'tools/list' && l.server === 'ash-tracker' && l.ok === true)).toBe(true);
    const calls = lines.filter((l) => l.method === 'tools/call');
    expect(calls.map((c) => [c.server, c.tool, c.validation?.ok, c.fixture ?? null])).toEqual([
      ['ash-tracker', 'create_issue', false, null],
      ['fern-chat', 'get_message', true, 'default'],
      ['ash-tracker', 'create_issue', true, 'find'],
      ['fern-chat', 'get_message', true, 'follow'],
      ['ash-tracker', 'delete_everything', false, null],
    ]);
    expect(calls[0]!.validation!.error).toContain('workspace');
    expect(calls[2]!.arguments).toEqual({ workspace: 'ACME', title: 'Broken login' });
    expect(calls.map((line) => line.ok)).toEqual([false, true, true, true, false]);
    expect(typeof calls[0]!.at).toBe('string');
  });

  test('a transport-rejected initialize or tools/list never logs a successful handshake', async () => {
    const start = host.lines.length;
    const send = (message: object, accept: string, version?: string) => fetch(base + '/mcp/ash-tracker', {
      method: 'POST', headers: { 'content-type': 'application/json', accept, ...(version ? { 'mcp-protocol-version': version } : {}) }, body: JSON.stringify(message),
    });
    const accept = 'application/json, text/event-stream';
    expect((await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rejected', version: '1' } } }, 'application/json')).status).toBe(406);
    expect((await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, accept, 'never-negotiated')).status).toBe(400);
    expect(host.lines.slice(start).map((line) => [line.method, line.ok])).toEqual([['initialize:rejected', false], ['tools/list:rejected', false]]);
  });

  test('the log endpoint needs the token', async () => {
    expect((await fetch(base + '/_he/log')).status).toBe(404);
    expect((await fetch(base + '/_he/log', { headers: { 'x-he-log-token': 'wrong' } })).status).toBe(404);
    const res = await fetch(base + '/_he/log', { headers: { 'x-he-log-token': 'tok' } });
    expect(res.status).toBe(200);
    expect((await res.text()).trim().split('\n').length).toBe(logged().length);
  });

  test('the validate endpoint needs the token, checks held arguments as tools/call does and logs nothing', async () => {
    const before = host.lines.length;
    const body = JSON.stringify([
      { server: 'ash-tracker', tool: 'create_issue', arguments: { title: 'no workspace' } },
      { server: 'ash-tracker', tool: 'create_issue', arguments: { workspace: 'ACME', title: 'Broken login' } },
      { server: 'ash-tracker', tool: 'delete_everything', arguments: {} },
      { server: 'not-on-this-rung', tool: 'create_issue', arguments: {} },
    ]);
    expect((await fetch(base + '/_he/validate', { method: 'POST', body })).status).toBe(404);
    expect((await fetch(base + '/_he/validate', { method: 'POST', headers: { 'x-he-log-token': 'wrong' }, body })).status).toBe(404);
    expect((await fetch(base + '/_he/validate', { headers: { 'x-he-log-token': 'tok' } })).status).toBe(404);
    expect((await fetch(base + '/_he/validate', { method: 'POST', headers: { 'x-he-log-token': 'tok' }, body: '{}' })).status).toBe(400);
    const res = await fetch(base + '/_he/validate', { method: 'POST', headers: { 'x-he-log-token': 'tok' }, body });
    const checks = (await res.json()) as Array<{ ok: boolean | null; error?: string }>;
    expect(checks.map((c) => c.ok)).toEqual([false, true, false, false]);
    expect(checks[0]!.error).toContain('workspace');
    expect(checks[2]!.error).toBe('unknown tool');
    expect(host.lines.length).toBe(before);
  });

  test('a GET to an endpoint is refused, as a stateless server does', async () => {
    expect((await fetch(base + '/mcp/ash-tracker')).status).toBe(405);
  });
});

describe('catalog host over stdio', () => {
  test('serves one server and logs to its own file', async () => {
    const catDir = join(dir, 'cat-stdio');
    writeCatalog(catDir, cat);
    const log = join(dir, 'stdio.jsonl');
    const fx = join(dir, 'fx.json');
    writeFileSync(fx, JSON.stringify({ requests: { r: [{ id: 'one', tool: 'get_message', result: { json: { ok: 1 } } }] } }));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [HOST, '--stdio', 'fern-chat', '--catalog', catDir, '--rung', '75', '--log', log, '--fixtures', fx, '--request', 'r'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir },
      stderr: 'pipe',
    });
    const c = new Client({ name: 'stdio-test', version: '1' });
    await c.connect(transport);
    expect((await c.listTools()).tools.length).toBe(5);
    const r = await c.callTool({ name: 'get_message', arguments: { workspace: 'w', message_id: 'm' } });
    expect(JSON.parse((r.content as any)[0].text)).toEqual({ ok: 1 });
    await c.close();
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LogLine);
    expect(lines.map((l) => l.method)).toEqual(expect.arrayContaining(['initialize', 'tools/list', 'tools/call']));
    expect(lines.every((l) => l.transport === 'stdio' && l.server === 'fern-chat')).toBe(true);
    expect(lines.find((l) => l.method === 'tools/call')!.fixture).toBe('one');
  });
});

describe('the committed public snapshot', () => {
  test('loads through the host loader, passes the check, and serves 30, 74, 145 and 303 tools', () => {
    const cat = loadCatalog(join(import.meta.dir, '../tasks/mcp-at-scale/catalog'));
    expect(checkCatalog(cat)).toEqual([]);
    const sizes = ['30', '75', '150', '300'].map((k) => rungServers(cat, k).reduce((n, s) => n + s.tools.length, 0));
    expect(sizes).toEqual([30, 74, 145, 303]);
  });
});
