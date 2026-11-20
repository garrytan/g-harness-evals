import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argsFrom, lineSplitter, outcome, requestLine } from '../scripts/mcp-at-scale/gbrain-relay.ts';
import { FORCED_CELLS, GBRAIN_EVIDENCE, GBRAIN_SOCKET, newestRelease, relayCommand, relaySidecar, setupServeArgs, syntheticPages, writeGbrainImage } from '../scripts/mcp-at-scale/gbrain.ts';
import { syntheticCatalog, writeCatalog } from '../scripts/mcp-at-scale/catalog-load.ts';
import { BUN_IMAGE, MAIN_IMAGE, materialize } from '../scripts/mcp-at-scale/materialize.ts';
import { ALLOW, TOKEN_PATTERNS } from '../scripts/publish-audit.ts';
import { EGRESS_ENVIRONMENT, writeJobs } from '../scripts/mcp-at-scale/listing-map.ts';

const dir = mkdtempSync(join(tmpdir(), 'mcp-gbrain-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const RELAY = join(import.meta.dir, '../scripts/mcp-at-scale/gbrain-relay.ts');
const GRADE = join(import.meta.dir, '../scripts/mcp-at-scale/grade.py');

// A stand-in stdio MCP server: answers initialize, tools/list and tools/call (isError for the tool named "bad").
const FAKE = `
const dec = new TextDecoder(); let buf = '';
const reader = Bun.stdin.stream().getReader();
for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value);
  let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id === undefined) continue;
    const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' }, instructions: 'hi' }
      : m.method === 'tools/list' ? { tools: [{ name: 'search', description: 'Search.', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: m.params.name === 'bad' ? 'nope' : 'ok' }], isError: m.params.name === 'bad' };
    process.stdout.write(JSON.stringify(m.method === 'nothing' ? { jsonrpc: '2.0', id: m.id, error: { code: 1, message: 'x' } } : { jsonrpc: '2.0', id: m.id, result }) + '\\n'); } }
`;

describe('gbrain relay', () => {
  test('logs requests and outcomes, passes every line through unchanged, and dumps the first tools/list', async () => {
    const fake = join(dir, 'fake.ts');
    writeFileSync(fake, FAKE);
    const log = join(dir, 'relay', 'calls.jsonl');
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'tester', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'heron' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bad', arguments: {} } },
    ];
    const p = Bun.spawn(['bun', RELAY, '--log', log, '--server', 'gbrain', '--trial', 't1', '--env', 'HE_TEST=1', '--', 'bun', fake], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '/usr/bin' } });
    for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n');
    const outText: string[] = [];
    const reader = p.stdout.getReader();
    const dec = new TextDecoder();
    let acc = '';
    while (acc.split('\n').filter(Boolean).length < 4) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value); }
    outText.push(...acc.split('\n').filter(Boolean));
    p.stdin.end();
    await p.exited;
    expect(outText.map((l) => JSON.parse(l).id)).toEqual([1, 2, 3, 4]);
    expect(JSON.parse(outText[1]!).result.tools[0].name).toBe('search');
    const logged = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(logged[0]).toMatchObject({ method: 'relay/start', server: 'gbrain', trial: 't1' });
    const done = logged.filter((l) => !l.method.includes(':') && l.method !== 'relay/start');
    expect(done.map((l) => [l.method, l.tool ?? null, l.ok])).toEqual([['initialize', null, true], ['tools/list', null, true], ['tools/call', 'search', true], ['tools/call', 'bad', false]]);
    expect(done[0]).toMatchObject({ client: { name: 'tester' }, protocol_requested: '2025-06-18' });
    expect(done[2].arguments).toEqual({ query: 'heron' });
    expect(logged.filter((l) => l.method.endsWith(':received')).length).toBe(4);
    expect(JSON.parse(readFileSync(join(dir, 'relay', 'tools-list.json'), 'utf8')).tools[0].name).toBe('search');
  });

  test('--dump writes serverInfo, instructions and tools, with --args-from appending setup flags', () => {
    const fake = join(dir, 'fake.ts');
    writeFileSync(fake, FAKE);
    writeFileSync(join(dir, 'args.json'), JSON.stringify(['--x']));
    const p = Bun.spawnSync(['bun', RELAY, '--dump', join(dir, 'dump.json'), '--args-from', join(dir, 'args.json'), '--', 'bun', fake], { stdout: 'pipe', stderr: 'pipe' });
    expect(p.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'dump.json'), 'utf8'))).toMatchObject({ serverInfo: { name: 'fake' }, instructions: 'hi', tools: [{ name: 'search' }] });
  });

  test('helpers', () => {
    expect(requestLine({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'gbrain', null)).toBeNull();
    expect(requestLine({ jsonrpc: '2.0', id: 9, result: {} }, 'gbrain', null)).toBeNull();
    expect(outcome({ error: { message: 'boom' } })).toEqual({ ok: false, error: 'boom' });
    expect(outcome({ jsonrpc: '2.0', result: { isError: true, content: [{ type: 'text', text: 'bad args' }] } })).toEqual({ ok: false, error: 'bad args' });
    expect(outcome({ jsonrpc: '2.0', id: 9 })).toEqual({ ok: false, error: 'invalid JSON-RPC result' });
    const got: string[] = [];
    const split = lineSplitter((l) => got.push(l));
    split('{"a":1}\n{"b"'); split(':2}\n');
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
    expect(argsFrom({ target: { surface: 'starter', advertise: 'verbs' } })).toEqual(['--surface', 'starter', '--advertise', 'verbs']);
    expect(argsFrom({ target: { surface: 'full', advertise: null } })).toEqual(['--surface', 'full']);
  });

  test('the socket bridge logs actual responses in the sidecar and does not attribute a reused pending ID', async () => {
    const d = mkdtempSync(join(dir, 'socket-'));
    const fake = join(d, 'fake.ts'), sock = join(d, 'mcp.sock'), log = join(d, 'calls.jsonl');
    writeFileSync(fake, FAKE);
    const env = { PATH: process.env.PATH ?? '/usr/bin' };
    const daemon = Bun.spawn(['bun', RELAY, '--listen', sock, '--log', log, '--', 'bun', fake], { env, stdout: 'pipe', stderr: 'pipe' });
    try {
      for (let i = 0; i < 100 && !existsSync(sock); ++i) await Bun.sleep(10);
      expect(existsSync(sock)).toBe(true);
      const client = Bun.spawn(['bun', RELAY, '--connect', sock], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
      client.stdin.write([
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bad' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search' } },
      ].map((m) => JSON.stringify(m)).join('\n') + '\n');
      client.stdin.end();
      const [output, code] = await Promise.all([new Response(client.stdout).text(), client.exited]);
      expect(code).toBe(0);
      expect(output.trim().split('\n').map((line) => JSON.parse(line).id)).toEqual([1, 2]);
      const lines = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(lines.filter((line) => line.method === 'tools/call')).toEqual([expect.objectContaining({ tool: 'bad', ok: false })]);
    } finally {
      daemon.kill();
      await daemon.exited;
    }
  });
});

describe('gbrain build', () => {
  test('the newest release is the highest v-tag, with the peeled commit', () => {
    const ls = ['a'.repeat(40) + '\trefs/tags/v0.60.9.0', 'b'.repeat(40) + '\trefs/tags/v0.60.10.0', 'c'.repeat(40) + '\trefs/tags/v0.60.10.0^{}', 'd'.repeat(40) + '\trefs/tags/nightly'].join('\n');
    expect(newestRelease(ls)).toEqual({ tag: 'v0.60.10.0', commit: 'c'.repeat(40) });
    expect(() => newestRelease('')).toThrow('HE-MCP-020');
  });

  test('cells use the exact flags, and the registered cell takes setup\'s target', () => {
    expect(FORCED_CELLS).toEqual({ full: ['--surface', 'full'], starter: ['--surface', 'starter'], verbs: ['--surface', 'full', '--advertise', 'verbs'] });
    expect(setupServeArgs({ target: { surface: 'starter', advertise: 'verbs' } })).toEqual(['--surface', 'starter', '--advertise', 'verbs']);
    expect(() => setupServeArgs({})).toThrow('HE-MCP-023');
    const r = relayCommand();
    expect(r.command).toBe('/usr/local/bin/bun');
    expect(r.args.slice(-2)).toEqual(['--connect', GBRAIN_SOCKET]);
    const sidecar = relaySidecar('image', ['--surface', 'full'], 'task-1');
    expect(sidecar.command.slice(-5)).toEqual(['--', '/opt/he-gbrain/bun/bin/gbrain', 'serve', '--surface', 'full']);
    expect(sidecar.command).toContain('GBRAIN_HOME=/srv/gbrain');
  });

  test('the synthetic pages are made up and hold no token', () => {
    const text = Object.values(syntheticPages()).join('\n');
    expect(Object.keys(syntheticPages()).length).toBeGreaterThanOrEqual(8);
    for (const re of Object.values(TOKEN_PATTERNS)) expect([...text.matchAll(new RegExp(re.source, re.flags))].map((m) => m[0]).filter((h) => !ALLOW.some((a) => a.test(h)))).toEqual([]);
    expect(text).not.toMatch(/garry|wintermute|@[a-z0-9-]+\.[a-z]{2,}/i);
  });

  test('the image context pins its base images and installs the release by tag', async () => {
    const img = await writeGbrainImage(join(dir, 'gb'), { tag: 'v0.60.743.0', commit: 'e'.repeat(40) });
    const df = readFileSync(join(img.dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('FROM ' + BUN_IMAGE + ' AS bun');
    expect(df).toContain('FROM ' + MAIN_IMAGE);
    expect(df).toContain('bun install -g github:garrytan/gbrain#v0.60.743.0');
    expect(df).toContain('init --pglite --no-embedding');
    expect(df).toContain('setup claude-code --gbrain-bin');
    expect(img.tag).toMatch(/^he-mcp-gbrain:0\.60\.743\.0-[0-9a-f]{12}$/);
    expect(existsSync(join(img.dir, 'relay.js'))).toBe(true);
  });
});

describe('gbrain tasks and grading', () => {
  test('materialize adds gbrain as a stdio server through the relay, one task per cell', async () => {
    const cat = join(dir, 'cat');
    writeCatalog(cat, syntheticCatalog());
    const out = join(dir, 'run');
    const res = await materialize({ catalog: cat, out, rungs: ['150'], requests: [{ id: 'g1', text: 'x', kind: 'tool', acceptable: [{ server: 'gbrain', tool: 'search' }] }],
      gbrain: { image: 'he-mcp-gbrain:test', cells: { full: FORCED_CELLS.full!, verbs: FORCED_CELLS.verbs! } } });
    expect(res.tasks.map((t) => t.task)).toEqual(['g1__r150__gb-full', 'g1__r150__gb-verbs']);
    const toml = readFileSync(join(out, 'tasks', 'g1__r150__gb-verbs', 'task.toml'), 'utf8');
    expect(toml).toContain('{ name = "gbrain", transport = "stdio", command = "/usr/local/bin/bun"');
    expect(toml).toContain('"--connect", "' + GBRAIN_SOCKET + '"] }');
    const compose = JSON.parse(readFileSync(join(out, 'tasks', 'g1__r150__gb-verbs', 'environment', 'docker-compose.yaml'), 'utf8'));
    expect(compose.services.gbrain).toMatchObject({ network_mode: 'none', volumes: ['gbrain-evidence:' + GBRAIN_EVIDENCE] });
    expect(compose.services.gbrain.command.slice(-5)).toEqual(['serve', '--surface', 'full', '--advertise', 'verbs']);
    expect(compose.services.main).toMatchObject({ depends_on: { gbrain: { condition: 'service_healthy' } }, volumes: ['gbrain-evidence:' + GBRAIN_EVIDENCE + ':ro'] });
    expect(readFileSync(join(out, 'tasks', 'g1__r150__gb-full', 'environment', 'Dockerfile'), 'utf8')).toStartWith('FROM he-mcp-gbrain:test\n');
    const exp = JSON.parse(readFileSync(join(out, 'tasks', 'g1__r150__gb-full', 'tests', 'expected.json'), 'utf8'));
    expect(exp.servers.at(-1)).toBe('gbrain');
    expect(exp).toMatchObject({ gbrain_cell: 'full', discovery: [{ server: 'gbrain', tool: 'request_tools' }] });
    expect(exp.local_logs).toBeUndefined();
  });

  test('listing-map jobs: one per gbrain cell, and --egress names the blocklist environment', () => {
    const out = join(dir, 'jobs');
    const jobs = writeJobs({ out, variants: ['codex'], rungs: ['150'], brokerPort: 1, requestId: 'listing', gbrainCells: ['full', 'registered'], egress: true });
    expect(jobs.map((j) => [j.job, j.gbrain_cell])).toEqual([['codex__r150__gb-full', 'full'], ['codex__r150__gb-registered', 'registered']]);
    const cfg = JSON.parse(readFileSync(join(out, 'configs', 'codex__r150__gb-registered.json'), 'utf8'));
    expect(cfg.environment.import_path).toBe(EGRESS_ENVIRONMENT);
    expect(cfg.tasks[0].path).toEndWith('/tasks/listing__r150__gb-registered');
    expect(JSON.parse(readFileSync(join(out, 'configs', 'codex__r150__gb-full.json'), 'utf8')).verifier.disable).toBe(false);
    const plain = writeJobs({ out: join(dir, 'jobs2'), variants: ['codex'], rungs: ['300'], brokerPort: 1, requestId: 'listing' });
    expect(plain.map((j) => j.job)).toEqual(['codex__r300']);
    expect(JSON.parse(readFileSync(join(dir, 'jobs2', 'configs', 'codex__r300.json'), 'utf8')).environment.import_path).toBe('harbor.environments.docker.docker:DockerEnvironment');
  });

  test('grade.py requires explicit GBrain call success and keeps request_tools out of right and wrong', () => {
    const expected = { request: 'g', kind: 'tool', rung: '150', servers: ['ash-tracker', 'gbrain'],
      acceptable: [{ server: 'gbrain', tool: 'search', required: { query: { $contains: 'sorter' } } }], discovery: [{ server: 'gbrain', tool: 'request_tools' }] };
    const connections = expected.servers.flatMap((server) => ['initialize', 'tools/list'].map((method) => ({ server, method, ok: true })));
    const search = { server: 'gbrain', method: 'tools/call', tool: 'search', arguments: { query: 'sorter' } };
    const discovery = { server: 'gbrain', method: 'tools/call', tool: 'request_tools', arguments: { query: 'search' }, ok: true };
    const p = Bun.spawnSync(['python3', '-c', 'import json, runpy, sys; grade = runpy.run_path(sys.argv[1])["grade"]; print(json.dumps([grade(*args) for args in json.loads(sys.argv[2])]))', GRADE,
      JSON.stringify([false, undefined, true].map((ok) => [expected, [...connections, { ...search, ok: false }, discovery, { ...search, ok }]]))],
    { stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
    expect(p.exitCode).toBe(0);
    const [bad, absent, good] = JSON.parse(p.stdout.toString());
    expect(bad).toMatchObject({ infra: null, right_tool: false, reward: 0 });
    expect(absent).toMatchObject({ infra: null, right_tool: false, reward: 0 });
    expect(good).toMatchObject({ infra: null, servers_connected: expected.servers, right_tool: true, first_right_call: 1, wrong_tools: [], reward: 1, discovery_calls: [{ server: 'gbrain', tool: 'request_tools' }] });
    expect(good.calls[1]).toMatchObject({ server: 'gbrain', tool: 'search', result_ok: true, validation_ok: null });
  });

  test('the verifier refuses older agent-writable relay evidence', () => {
    const d = mkdtempSync(join(dir, 'g-'));
    const servers = ['ash-tracker', 'gbrain'];
    const relayLog = join(d, 'gb', 'calls.jsonl');
    Bun.spawnSync(['mkdir', '-p', join(d, 'gb')]);
    writeFileSync(join(d, 'gb', 'tools-list.json'), '{"tools":[]}\n');
    writeFileSync(relayLog, [
      { server: 'gbrain', method: 'relay/start' }, { server: 'gbrain', method: 'initialize', ok: true }, { server: 'gbrain', method: 'tools/list', ok: true },
      { server: 'gbrain', method: 'tools/call', tool: 'request_tools', arguments: { query: 'search' }, ok: true },
      { server: 'gbrain', method: 'tools/call', tool: 'search', arguments: { query: 'sorter' }, ok: true },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(d, 'calls.jsonl'), [{ server: 'ash-tracker', method: 'initialize', ok: true }, { server: 'ash-tracker', method: 'tools/list', ok: true }].map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(d, 'expected.json'), JSON.stringify({ request: 'g', kind: 'tool', rung: '150', servers, acceptable: [{ server: 'gbrain', tool: 'search', required: { query: { $contains: 'sorter' } } }],
      local_logs: [{ server: 'gbrain', path: relayLog, tools_list: join(d, 'gb', 'tools-list.json') }], discovery: [{ server: 'gbrain', tool: 'request_tools' }] }));
    const p = Bun.spawnSync(['python3', GRADE, '--expected', join(d, 'expected.json'), '--log', join(d, 'calls.jsonl'), '--ready', join(d, 'none.json'), '--out', join(d, 'out')], { stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
    expect(p.exitCode).toBe(0);
    const o = JSON.parse(readFileSync(join(d, 'out', 'outcomes.json'), 'utf8'));
    expect(o).toMatchObject({ infra: { code: 'HE-MCP-002' }, right_tool: false, reward: 0 });
    expect(existsSync(join(d, 'out', 'gbrain-calls.jsonl'))).toBe(false);
  });
});
