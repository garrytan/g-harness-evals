// QM in the MCP-at-scale cells (internal-task): listing-map.ts runs QM through agents_qm.py, and agents_qm.py's own tests
// (tests/mcp_at_scale_qm_test.py) pass on Harbor 0.24.0. The Python tests need the Harbor venv vm-run.sh installs
// (~/.frontier-harbor/venv, or HE_HARBOR_VENV); without it they are skipped, and say so.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SKIPPED, VARIANTS, writeJobs } from '../scripts/mcp-at-scale/listing-map.ts';
import { syntheticCatalog, writeCatalog } from '../scripts/mcp-at-scale/catalog-load.ts';

const ROOT = resolve(import.meta.dir, '..');
const VENV = process.env.HE_HARBOR_VENV ?? join(process.env.HOME ?? '/tmp', '.frontier-harbor/venv');
const PY = join(VENV, 'bin/python');
const dir = mkdtempSync(join(tmpdir(), 'mcp-qm-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('listing-map.ts QM variant', () => {
  test('QM runs through agents_qm.py:McpQm on Opus 5.5, and nothing is skipped', () => {
    expect(VARIANTS.qm).toEqual({ cls: 'agents_qm:McpQm', harness: 'qm', model: 'anthropic/claude-opus-5-5' });
    expect(SKIPPED).toEqual({});
    const jobs = writeJobs({ out: dir, variants: ['qm', 'codex'], rungs: ['30'], brokerPort: 8791, requestId: 'listing' });
    const cfg = (job: string) => JSON.parse(readFileSync(join(dir, 'configs', job + '.json'), 'utf8')).agents[0];
    expect(jobs.map((j) => j.job)).toEqual(['qm__r30', 'codex__r30']);
    expect(cfg('qm__r30').import_path).toBe('agents_qm:McpQm');
    expect(cfg('codex__r30').import_path).toBe('agents:McpCodex');
  });
});

describe('stdio-http-bridge.ts in front of the gbrain relay', () => {
  test('QM-style HTTP calls reach a stdio server through the real relay, which logs them', async () => {
    const cat = join(dir, 'cat');
    writeCatalog(cat, syntheticCatalog());
    const relayLog = join(dir, 'relay', 'calls.jsonl');
    const port = 20000 + Math.floor(Math.random() * 20000);
    const here = join(ROOT, 'scripts/mcp-at-scale');
    const bridge = Bun.spawn(['bun', join(here, 'stdio-http-bridge.ts'), '--port', String(port), '--host', '127.0.0.1', '--',
      'bun', join(here, 'gbrain-relay.ts'), '--log', relayLog, '--server', 'gbrain', '--trial', 't1', '--',
      'bun', join(here, 'catalog-host.ts'), '--stdio', 'ash-tracker', '--catalog', cat, '--rung', '30', '--log', join(dir, 'host.jsonl')], { stdout: 'ignore', stderr: 'pipe' });
    try {
      const url = 'http://127.0.0.1:' + port;
      for (let i = 0; i < 50; i++) { if (await fetch(url + '/healthz').then((r) => r.ok, () => false)) break; await Bun.sleep(100); }
      const post = (body: object, sid?: string) => fetch(url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
      const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qm-test', version: '0' } } });
      const sid = init.headers.get('mcp-session-id')!;
      expect(((await init.json()) as any).result.serverInfo).toBeTruthy();
      expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)).status).toBe(202);
      const list = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)).json()) as any;
      expect(list.result.tools.map((t: any) => t.name)).toContain('create_issue');
      const call = (await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_issue', arguments: { workspace: 'acme', title: 'x' } } }, sid)).json()) as any;
      expect(call.id).toBe(3);
      expect((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).status).toBe(400);
      expect((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, 'nope')).status).toBe(404);
      const lines = readFileSync(relayLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.filter((l) => !l.method.endsWith(':received')).map((l) => l.method)).toEqual(['relay/start', 'initialize', 'tools/list', 'tools/call']);
      expect(lines.find((l) => l.method === 'tools/call')).toMatchObject({ server: 'gbrain', trial: 't1', tool: 'create_issue', ok: true });
    } finally {
      bridge.kill();
    }
  });

  test('refuses to start without a host or on a wildcard address', () => {
    const bridge = join(ROOT, 'scripts/mcp-at-scale/stdio-http-bridge.ts');
    for (const host of [[], ['--host', '0.0.0.0'], ['--host', '::']]) {
      const out = Bun.spawnSync(['bun', bridge, ...host, '--port', '1', '--', 'true'], { stdout: 'pipe', stderr: 'pipe' });
      expect(out.exitCode).toBe(64);
      expect(out.stderr.toString()).toContain('not a wildcard');
    }
  });
});

describe('agents_qm.py on Harbor 0.24.0', () => {
  test.skipIf(!existsSync(PY))('tests/mcp_at_scale_qm_test.py passes' + (existsSync(PY) ? '' : ' (skipped: no Harbor venv at ' + VENV + ')'), () => {
    const p = Bun.spawnSync([PY, '-m', 'unittest', 'tests/mcp_at_scale_qm_test.py'], {
      cwd: ROOT, env: { PATH: '/usr/bin:/bin', HOME: dir, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: join(ROOT, 'scripts/mcp-at-scale') }, stdout: 'pipe', stderr: 'pipe',
    });
    const err = p.stderr.toString();
    expect(err).toMatch(/\nOK\n$/);
    expect(p.exitCode).toBe(0);
  });
});
