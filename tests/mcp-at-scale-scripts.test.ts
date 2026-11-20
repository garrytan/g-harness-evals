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

  test('scripts/mcp-at-scale/requests/schema.json is the schema sets.ts validates against', () => {
    expect(SCHEMA_FILE).toBe(join(ROOT, 'scripts/mcp-at-scale/requests/schema.json'));
    expect(typeof JSON.parse(read('scripts/mcp-at-scale/requests/schema.json'))).toBe('object');
  });
});
