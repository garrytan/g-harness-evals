import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_FILE } from '../scripts/mcp-at-scale/requests/sets.ts';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: ROOT, env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });

describe('MCP at scale: scripts the other tests do not load still parse', () => {
  test.each([
    'scripts/mcp-at-scale/catalog/build-ladder.ts',
    'scripts/mcp-at-scale/catalog/capture.ts',
    'scripts/mcp-at-scale/catalog/sources.ts',
    'scripts/mcp-at-scale/upstream.ts',
  ])('%s transpiles', (p) => {
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(read(p))).not.toThrow();
  });

  test('scripts/mcp-at-scale/catalog/egress-proxy.mjs transpiles', () => {
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(read('scripts/mcp-at-scale/catalog/egress-proxy.mjs'))).not.toThrow();
  });

  test('scripts/mcp-at-scale/egress-check.sh passes bash -n', () => {
    const r = run(['bash', '-n', 'scripts/mcp-at-scale/egress-check.sh']);
    expect(r.stderr.toString()).toBe('');
    expect(r.exitCode).toBe(0);
  });

  test('scripts/mcp-at-scale/agents.py parses as Python', () => {
    const r = run(['python3', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])', 'scripts/mcp-at-scale/agents.py']);
    expect(r.stderr.toString()).toBe('');
    expect(r.exitCode).toBe(0);
  });

  test('agents.py resolves the codex model GPT-6.2 Sol from versions.json, keeps pin.json rows, and refuses a model in neither', () => {
    const r = run(['python3', '-c', [
      'import json, sys, tempfile',
      'from pathlib import Path',
      'sys.path[:0] = ["tests/fixtures/frontier-delivery/stub", "scripts/mcp-at-scale"]',
      'import agents as mcp',
      'fs = mcp.fs',
      'out = {"variant": mcp.VARIANTS["codex"][2], "in_pin": "openai:gpt-6.2-sol" in fs.PIN["models"], "spec": fs.model_spec("openai:gpt-6.2-sol"),',
      '       "codex_model": fs.codex_config("openai:gpt-6.2-sol", "http://gw/s/openai")["model"], "pin_row": fs.model_spec("openai:gpt-6.1-sol") == {**fs.PIN["models"]["openai:gpt-6.1-sol"], "id": "openai:gpt-6.1-sol", "name": "gpt-6.1-sol", "provider": "openai"},',
      '       "agent_model": mcp.McpCodex(logs_dir=Path(tempfile.mkdtemp()), model_name=mcp.VARIANTS["codex"][2])._frontier_model}',
      'try:',
      '    fs.check_cell("codex", "openai:gpt-nonesuch")',
      'except ValueError as e:',
      '    out["neither"] = str(e)',
      'print(json.dumps(out))',
    ].join('\n')]);
    expect(r.stderr.toString()).toBe('');
    const out = JSON.parse(r.stdout.toString());
    const versions = JSON.parse(read('scripts/mcp-at-scale/versions.json'));
    expect(out.variant).toBe('openai/gpt-6.2-sol');
    expect(out.in_pin).toBe(true);
    expect(out.spec).toEqual({ ...versions.models['openai:gpt-6.2-sol'], id: 'openai:gpt-6.2-sol', name: 'gpt-6.2-sol', provider: 'openai' });
    expect(out.codex_model).toBe('gpt-6.2-sol');
    expect(out.pin_row).toBe(true);
    expect(out.agent_model).toBe('openai:gpt-6.2-sol');
    expect(out.neither).toBe('HE-MCP-048 model openai:gpt-nonesuch is in neither scripts/frontier-harbor/pin.json models nor scripts/mcp-at-scale/versions.json models');
  });

  test('scripts/mcp-at-scale/requests/schema.json is the schema sets.ts validates against', () => {
    expect(SCHEMA_FILE).toBe(join(ROOT, 'scripts/mcp-at-scale/requests/schema.json'));
    expect(typeof JSON.parse(read('scripts/mcp-at-scale/requests/schema.json'))).toBe('object');
  });
});
