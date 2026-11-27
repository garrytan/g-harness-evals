import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rungServers, syntheticCatalog, writeCatalog } from '../scripts/mcp-at-scale/catalog-load.ts';
import { createHost } from '../scripts/mcp-at-scale/catalog-host.ts';
import { compose, materialize, taskToml } from '../scripts/mcp-at-scale/materialize.ts';
import { classify, declaredWithSchemas } from '../scripts/mcp-at-scale/listing-map.ts';

const dir = mkdtempSync(join(tmpdir(), 'mcp-cells-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const GRADE = join(import.meta.dir, '../scripts/mcp-at-scale/grade.py');
const cat = syntheticCatalog();
const r30 = rungServers(cat, '30');
const servers30 = r30.map((s) => s.server);

/** Grades a host log; ready, when given, is the host's ready line, logged first. */
function runGrade(expected: object, lines: object[] | null, ready: object | null = null): any {
  const d = mkdtempSync(join(dir, 'g-'));
  writeFileSync(join(d, 'expected.json'), JSON.stringify(expected));
  const log = join(d, 'calls.jsonl');
  if (lines) writeFileSync(log, [...(ready ? [ready] : []), ...lines].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const p = Bun.spawnSync(['python3', GRADE, '--expected', join(d, 'expected.json'), '--log', log, '--out', join(d, 'out')], { env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
  expect(p.exitCode).toBe(0);
  const out = JSON.parse(readFileSync(join(d, 'out', 'outcomes.json'), 'utf8'));
  expect(readFileSync(join(d, 'out', 'reward.txt'), 'utf8').trim()).toBe(String(out.reward));
  return out;
}
const connectAll = (names: string[]) => names.flatMap((server) => [{ server, method: 'initialize', ok: true }, { server, method: 'tools/list', ok: true }]);
const call = (server: string, tool: string, args: object, ok: boolean | null = true) => ({ server, method: 'tools/call', tool, arguments: args, validation: { ok }, fixture: 'default' });
const toolReq = { request: 'r1', kind: 'tool', rung: '30', servers: servers30, acceptable: [{ server: 'ash-tracker', tool: 'create_issue', required: { workspace: { $ci: 'acme' }, title: { $contains: 'login' } } }] };

describe('grade.py', () => {
  test('right tool with the required arguments, after a wrong tool', () => {
    const out = runGrade(toolReq, [...connectAll(servers30), call('fern-chat', 'get_message', { workspace: 'acme', message_id: 'x' }), call('ash-tracker', 'create_issue', { workspace: 'ACME', title: 'Login fails' })]);
    expect(out).toMatchObject({ infra: null, right_tool: true, first_right_call: 1, wrong_tools: ['fern-chat/get_message'], tool_when_none: null, reward: 1 });
    expect(out.servers_connected).toEqual(servers30);
  });

  test('the right tool with a missing required value, or refused by the schema, is not right', () => {
    expect(runGrade(toolReq, [...connectAll(servers30), call('ash-tracker', 'create_issue', { workspace: 'other', title: 'Login' })])).toMatchObject({ right_tool: false, reward: 0, wrong_tools: [] });
    expect(runGrade(toolReq, [...connectAll(servers30), call('ash-tracker', 'create_issue', { workspace: 'acme', title: 'login', bogus: 1 }, false)])).toMatchObject({ right_tool: false, invalid_calls: 1, reward: 0 });
  });

  test('a near-twin tool of the same name on another server is wrong', () => {
    const out = runGrade(toolReq, [...connectAll(servers30), call('birch-tracker', 'create_issue', { workspace: 'acme', title: 'login' })]);
    expect(out).toMatchObject({ right_tool: false, wrong_tools: ['birch-tracker/create_issue'] });
  });

  test('no-tool requests: any catalog call is a tool when none was needed', () => {
    const none = { request: 'n1', kind: 'none', rung: '30', servers: servers30 };
    expect(runGrade(none, connectAll(servers30))).toMatchObject({ right_tool: null, tool_when_none: false, reward: 1 });
    expect(runGrade(none, [...connectAll(servers30), call('kiln-db', 'list_rows', { workspace: 'a', query: 'b' })])).toMatchObject({ tool_when_none: true, reward: 0 });
  });

  test('INFRA with a stable code when a server got no tools/list, or when the log is unreadable', () => {
    const lines = connectAll(servers30).filter((l) => !(l.server === 'kiln-db' && l.method === 'tools/list'));
    const out = runGrade(toolReq, [...lines, call('ash-tracker', 'create_issue', { workspace: 'acme', title: 'login' })]);
    expect(out.infra.code).toBe('HE-MCP-001');
    expect(out.servers_missing).toEqual(['kiln-db']);
    expect(out.right_tool).toBe(true);
    expect(out.reward).toBe(0);
    expect(runGrade(toolReq, null).infra.code).toBe('HE-MCP-002');
  });
});

describe('grade.py connection rule', () => {
  const up = (connect: string) => ({ server: '', method: 'ready', ok: true, connect, variant: 'v' });
  const none = { ...toolReq, kind: 'none', acceptable: [] };
  const right = call('ash-tracker', 'create_issue', { workspace: 'acme', title: 'login' });
  test('a lazy cell that answers with no MCP traffic is scored, not INFRA', () => {
    expect(runGrade(toolReq, [], up('lazy'))).toMatchObject({ connect: 'lazy', infra: null, right_tool: false, reward: 0, servers_missing: servers30 });
    expect(runGrade(none, [], up('lazy'))).toMatchObject({ infra: null, tool_when_none: false, reward: 1 });
  });
  test('the same trial on an eager cell, or with no probe record, is INFRA HE-MCP-001', () => {
    expect(runGrade(toolReq, [], up('eager')).infra.code).toBe('HE-MCP-001');
    expect(runGrade(toolReq, []).infra.code).toBe('HE-MCP-001');
  });
  test('a rejected or unproven handshake does not establish a catalog connection', () => {
    const server = 'ash-tracker';
    const req = { ...toolReq, servers: [server] };
    const receipts = [{ server, method: 'initialize' }, { server, method: 'tools/list', ok: false }];
    expect(runGrade(req, receipts)).toMatchObject({ servers_connected: [], infra: { code: 'HE-MCP-001' } });
    expect(runGrade(req, [{ server, method: 'tools/list:rejected', ok: false }], up('lazy'))).toMatchObject({ servers_connected: [], infra: { code: 'HE-MCP-001' } });
  });
  test('a lazy cell is INFRA once it used MCP with a server unconnected; initialize alone is not a failed connect', () => {
    const starting = servers30.slice(0, 5).map((server) => ({ server, method: 'initialize', ok: true }));
    expect(runGrade(none, starting, up('lazy'))).toMatchObject({ servers_incomplete: servers30.slice(0, 5), infra: null, reward: 1 });
    const listed = runGrade(none, [...starting, { server: 'ash-tracker', method: 'tools/list', ok: true }], up('lazy'));
    expect(listed).toMatchObject({ reward: 0 });
    expect(listed.infra.code).toBe('HE-MCP-001');
    const partial = runGrade(toolReq, [...connectAll(servers30.slice(0, 2)), right], up('lazy'));
    expect(partial.infra.code).toBe('HE-MCP-001');
    expect(partial.infra.detail).toContain('1 tool calls');
    expect(runGrade(toolReq, [...connectAll(servers30), right], up('lazy'))).toMatchObject({ infra: null, right_tool: true, reward: 1 });
  });
  test('readiness comes only from the host: its ready line before any MCP request sets the mode; a later one or a probe file does not', async () => {
    const host = createHost({ servers: r30, log: null });
    expect((await host.fetch(new Request('http://catalog:8080/_he/ready?connect=lazy&variant=pi-deferred'))).status).toBe(200);
    expect(host.lines).toMatchObject([{ method: 'ready', ok: true, connect: 'lazy', variant: 'pi-deferred' }]);
    expect(runGrade(none, [...host.lines])).toMatchObject({ connect: 'lazy', ready: { ok: true, connect: 'lazy' }, infra: null, reward: 1 });
    const late = runGrade(none, [...connectAll(servers30.slice(0, 1)), up('lazy')]);
    expect(late).toMatchObject({ connect: 'eager', ready: null });
    expect(late.infra.code).toBe('HE-MCP-001');
    const d = mkdtempSync(join(dir, 'g-'));
    writeFileSync(join(d, 'expected.json'), JSON.stringify({ ...none, require_ready: true }));
    writeFileSync(join(d, 'mcp-ready.json'), JSON.stringify({ ok: true, connect: 'lazy', variant: 'v' }));
    writeFileSync(join(d, 'none.jsonl'), '');
    const forged = Bun.spawnSync(['python3', GRADE, '--expected', join(d, 'expected.json'), '--log', join(d, 'none.jsonl'), '--out', join(d, 'out')], { cwd: d, env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
    expect(forged.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(d, 'out', 'outcomes.json'), 'utf8'))).toMatchObject({ ready: null, infra: { code: 'HE-MCP-001' } });
  });
  test('a probe that could not reach the host leaves no ready line, so the trial is graded as eager', () => {
    expect(runGrade(toolReq, [...connectAll(servers30), right])).toMatchObject({ connect: 'eager', infra: null, right_tool: true, reward: 1 });
    expect(runGrade(none, []).infra.code).toBe('HE-MCP-001');
    expect(runGrade(none, null).infra.code).toBe('HE-MCP-002');
  });
  test('a trial with complete connections still fails closed if a required setup probe was missing', () => {
    expect(runGrade({ ...toolReq, require_ready: true }, [...connectAll(servers30), right])).toMatchObject({
      ready: null, infra: { code: 'HE-MCP-001' }, reward: 0,
    });
  });
});

describe('grade.py held calls (QM approval stops)', () => {
  const right = { server: 'ash-tracker', tool: 'create_issue', arguments: { workspace: 'ACME', title: 'Login fails' } };
  /** Grades a QM-style trial against a live host: its ready line names the variant, the held file is beside the task. */
  async function gradeHeld(variant: string, held: unknown, offline = false): Promise<any> {
    const host = createHost({ servers: r30, log: null, logToken: 'tok' });
    const srv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: host.fetch });
    try {
      await host.fetch(new Request('http://catalog:8080/_he/ready?connect=eager&variant=' + variant));
      host.lines.push(...(connectAll(servers30) as any[]));
      const d = mkdtempSync(join(dir, 'h-'));
      writeFileSync(join(d, 'expected.json'), JSON.stringify(toolReq));
      writeFileSync(join(d, 'held.json'), typeof held === 'string' ? held : JSON.stringify(held));
      const args = ['python3', GRADE, '--expected', join(d, 'expected.json'), '--out', join(d, 'out'), '--held', join(d, 'held.json')];
      if (offline) {
        writeFileSync(join(d, 'calls.jsonl'), host.lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        args.push('--log', join(d, 'calls.jsonl'));
      }
      const p = Bun.spawn(args, { env: { PATH: '/usr/local/bin:/usr/bin:/bin', HE_CATALOG_URL: 'http://127.0.0.1:' + srv.port, HE_CATALOG_LOG_TOKEN: 'tok' }, stdout: 'pipe', stderr: 'pipe' });
      expect(await p.exited).toBe(0);
      return JSON.parse(readFileSync(join(d, 'out', 'outcomes.json'), 'utf8'));
    } finally {
      srv.stop(true);
    }
  }

  test('a QM cell grades a held call the host validates as a call the model made', async () => {
    const out = await gradeHeld('qm', { calls: [right], other: [] });
    expect(out).toMatchObject({ infra: null, right_tool: true, reward: 1, approval_pending_calls: 1, held_error: null });
    expect(out.calls.at(-1)).toMatchObject({ ...right, approval_pending: true, validation_ok: true, result_ok: null });
  });

  test('a held call the schema refuses is invalid and not right', async () => {
    const out = await gradeHeld('qm', { calls: [{ ...right, arguments: { ...right.arguments, bogus: 1 } }], other: [] });
    expect(out).toMatchObject({ infra: null, right_tool: false, reward: 0, invalid_calls: 1, approval_pending_calls: 1 });
  });

  test('no other cell reads the held file the agent could have written', async () => {
    expect(await gradeHeld('codex', { calls: [right], other: [] })).toMatchObject({ right_tool: false, approval_pending_calls: 0, calls: [], held_error: null });
  });

  test('an unreadable held file counts no held call and the trial is still scored', async () => {
    const out = await gradeHeld('qm', 'not json');
    expect(out).toMatchObject({ infra: null, right_tool: false, approval_pending_calls: 0 });
    expect(out.held_error).toContain('held-calls.json could not be read');
  });

  test('held calls the host could not check make the trial INFRA HE-MCP-002, as an unreadable log does', async () => {
    const out = await gradeHeld('qm', { calls: [right], other: [] }, true);
    expect(out.infra.code).toBe('HE-MCP-002');
    expect(out.infra.detail).toContain('the catalog host could not check the held calls');
    expect(out.reward).toBe(0);
  });
});

describe('materialize.ts', () => {
  test('task.toml lists every rung server for Harbor, and the verifier holds the log token', () => {
    const t = Bun.TOML.parse(taskToml({ name: 'x__r30', servers: servers30, token: 'abc' })) as any;
    expect(t.environment.mcp_servers.map((s: any) => s.name)).toEqual(servers30);
    expect(t.environment.mcp_servers[0]).toEqual({ name: 'ash-tracker', transport: 'streamable-http', url: 'http://catalog:8080/mcp/ash-tracker' });
    expect(t.verifier.env.HE_CATALOG_LOG_TOKEN).toBe('abc');
    expect(t.environment.env ?? {}).toEqual({});
  });

  test('compose escapes $ for docker compose and makes the agent wait for a healthy host', () => {
    const c = compose({ tag: 'he-mcp-catalog:x', rung: '30', request: 'r1', fixtures: [{ id: 'a', tool: 't', match: { w: { $ci: 'x' } }, result: { json: 1 } }], token: 'tok' }) as any;
    expect(c.services.catalog.environment.HE_FIXTURES).toContain('"$$ci"');
    expect(c.services.catalog.pull_policy).toBe('never');
    expect(c.services.main.depends_on.catalog.condition).toBe('service_healthy');
    expect(c.services.catalog.command).toContain('--log-token-env');
    expect(c.services.catalog.networks).toEqual(['default']);
    expect(c.services.main.networks).toBeUndefined();
  });

  test('one task per request and rung, refusing an acceptable tool that is not on the rung', async () => {
    const catDir = join(dir, 'cat');
    writeCatalog(catDir, cat);
    const out = join(dir, 'run');
    const res = await materialize({ catalog: catDir, out, rungs: ['30', '300'], requests: [
      { id: 'r1', text: 'Create the issue.', kind: 'tool', acceptable: [{ server: 'ash-tracker', tool: 'create_issue', required: { workspace: 'acme' } }] },
      { id: 'n1', text: 'Say hi.', kind: 'none' },
    ] });
    expect(res.tasks.map((t) => t.task)).toEqual(['r1__r30', 'r1__r300', 'n1__r30', 'n1__r300']);
    expect(res.image.tag).toMatch(/^he-mcp-catalog:[0-9a-f]{16}$/);
    for (const f of ['instruction.md', 'task.toml', 'environment/Dockerfile', 'environment/docker-compose.yaml', 'tests/test.sh', 'tests/grade.py', 'tests/expected.json']) expect(existsSync(join(out, 'tasks', 'r1__r300', f))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'tasks', 'r1__r300', 'tests', 'expected.json'), 'utf8')).servers.length).toBe(15);
    expect(existsSync(join(out, 'catalog-image', 'host.js'))).toBe(true);
    await expect(materialize({ catalog: catDir, out: join(dir, 'run2'), rungs: ['30'], requests: [{ id: 'bad', text: 'x', kind: 'tool', acceptable: [{ server: 'tundra-ci', tool: 'list_jobs' }] }] })).rejects.toThrow('HE-MCP-012');
  });

  test('a wider-rung alternative does not block a task that still has a valid tool', async () => {
    const out = join(dir, 'alternatives');
    const catalog = join(dir, 'alternatives-catalog');
    writeCatalog(catalog, cat);
    const acceptable = [...toolReq.acceptable, { server: 'tundra-ci', tool: 'list_jobs' }];
    await materialize({ catalog, out, rungs: ['30', '300'], requests: [{ id: 'alt', text: 'Create the issue.', kind: 'tool', acceptable }] });
    for (const rung of ['30', '300']) {
      const task = JSON.parse(readFileSync(join(out, 'tasks', 'alt__r' + rung, 'tests', 'expected.json'), 'utf8'));
      expect(task.acceptable).toEqual(acceptable);
    }
  });
});

describe('listing-map classify', () => {
  const ash = r30.find((s) => s.server === 'ash-tracker')!;
  test('declared tools with a schema count as full schema, and namespaces are read', () => {
    const t = ash.tools[0]!;
    const body = { tools: [{ name: 'mcp__ash-tracker__' + t.name, description: t.description, input_schema: t.inputSchema }] };
    expect(classify(body, r30).get('ash-tracker/' + t.name)).toBe('full_schema');
    const ns = { tools: [{ type: 'namespace', name: 'mcp__ash_tracker', tools: [{ type: 'function', name: t.name, parameters: t.inputSchema }] }] };
    expect(declaredWithSchemas(ns)[0]!.name).toBe('mcp__ash_tracker__' + t.name);
    expect(classify(ns, r30).get('ash-tracker/' + t.name)).toBe('full_schema');
  });

  test('names with a description line, names only, server only, absent; a twin name stays with its own server', () => {
    const [a, b] = ash.tools;
    const twins = [...r30, ...rungServers(cat, '75').filter((s) => s.server === 'birch-tracker')];
    const text = 'Deferred tools:\nmcp__ash-tracker__' + a!.name + ': ' + a!.description + '\nmcp__ash-tracker__' + b!.name + '\nServers: fern-chat\n'
      + 'birch-tracker: ' + a!.name;
    const got = classify({ system: text, tools: [{ name: 'ToolSearch', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }] }, twins);
    expect(got.get('ash-tracker/' + a!.name)).toBe('description');
    expect(got.get('ash-tracker/' + b!.name)).toBe('name_only');
    expect(got.get('fern-chat/' + r30[1]!.tools[0]!.name)).toBe('server_only');
    expect(got.get('kiln-db/' + r30[2]!.tools[0]!.name)).toBe('absent');
    expect(got.get('birch-tracker/' + a!.name)).toBe('name_only');
    expect(got.get('birch-tracker/' + b!.name)).toBe('server_only');
  });
});
