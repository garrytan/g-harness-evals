import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, scan, sums } from '../scripts/mcp-at-scale/catalog/scan.ts';

const ladder = JSON.parse(readFileSync(join(CATALOG, 'ladder.json'), 'utf8'));
const serverFiles = new Map<string, any>(readdirSync(join(CATALOG, 'servers')).map((f) => {
  const s = JSON.parse(readFileSync(join(CATALOG, 'servers', f), 'utf8'));
  return [s.server, s];
}));
const OSI = new Set(['MIT', 'Apache-2.0', 'MPL-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']);

describe('MCP-at-scale catalog ladder', () => {
  test('has the four rungs, each within 5 tools of its target', () => {
    expect(ladder.rungs.map((r: any) => r.target)).toEqual([30, 75, 150, 300]);
    for (const r of ladder.rungs) {
      expect(Math.abs(r.size - r.target)).toBeLessThanOrEqual(5);
      expect(r.tool_names.length).toBe(r.size);
      expect(r.servers.reduce((a: number, s: any) => a + s.tools, 0)).toBe(r.size);
    }
    expect(ladder.rungs[0].size).toBe(30);
  });

  test('rungs are nested: each holds every server and tool of the one below', () => {
    for (let i = 1; i < ladder.rungs.length; i++) {
      const lo = ladder.rungs[i - 1];
      const hi = ladder.rungs[i];
      expect(hi.servers.slice(0, lo.servers.length)).toEqual(lo.servers);
      const names = new Set(hi.tool_names);
      for (const n of lo.tool_names) expect(names.has(n)).toBe(true);
    }
  });

  test('tool names are unique per rung once the server prefix is applied', () => {
    for (const r of ladder.rungs) expect(new Set(r.tool_names).size).toBe(r.tool_names.length);
  });

  test('every rung tool exists in its server capture, core trimmed and distractors whole', () => {
    const core = new Map(ladder.core.map((c: any) => [c.server, c]));
    for (const r of ladder.rungs) {
      for (const m of r.servers) {
        const file = serverFiles.get(m.server);
        expect(file).toBeDefined();
        const own = r.tool_names.filter((n: string) => n.startsWith(`${m.server}__`)).map((n: string) => n.slice(m.server.length + 2));
        expect(own.length).toBe(m.tools);
        const all = file.tools.map((t: any) => t.name);
        for (const t of own) expect(all).toContain(t);
        if (core.has(m.server)) expect(own).toEqual((core.get(m.server) as any).tools);
        else expect(own).toEqual(all);
      }
    }
  });

  test('core is six servers of about five tools, spread through the alphabet, each with its switch', () => {
    expect(ladder.core.length).toBe(6);
    const n = ladder.servers_alphabetical.length;
    const sixths = ladder.core.map((c: any) => Math.floor(((c.position - 1) * 6) / n));
    expect(new Set(sixths).size).toBe(6);
    for (const c of ladder.core) {
      expect(c.tools.length).toBeGreaterThanOrEqual(4);
      expect(c.tools.length).toBeLessThanOrEqual(6);
      expect(c.switch.length).toBeGreaterThan(0);
      expect(c.filter_verified_by_capture).toBe(true);
    }
  });

  test('distractor rungs mix near-twins of core servers with unrelated servers', () => {
    for (const r of ladder.rungs.slice(1)) {
      const roles = new Set(r.servers.map((s: any) => s.role));
      expect(roles.has('twin')).toBe(true);
      expect(roles.has('unrelated')).toBe(true);
    }
  });

  test('the top rung holds a near-twin of every core server that has one', () => {
    const top = ladder.rungs[ladder.rungs.length - 1].servers;
    const twinsOf = new Set(ladder.distractor_order.filter((d: any) => d.kind === 'twin').map((d: any) => d.twin_of));
    for (const c of twinsOf) expect(top.some((s: any) => s.role === 'twin' && s.twin_of === c)).toBe(true);
  });

  test('every server has an OSI licence id, a shipped licence file and its NOTICE', () => {
    const modifications = readFileSync(join(CATALOG, 'LICENSES', 'MODIFICATIONS.md'), 'utf8');
    for (const [name, s] of serverFiles) {
      for (const id of s.source.spdx.split(' AND ')) expect(OSI.has(id)).toBe(true);
      expect(s.source.licence_file.length).toBeGreaterThan(0);
      expect(s.source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(['runtime', 'static']).toContain(s.source.capture_method);
      const dir = join(CATALOG, 'LICENSES', s.source.repo.replace('/', '__'));
      expect(existsSync(join(dir, s.source.licence_file))).toBe(true);
      if (s.source.notice_file) expect(existsSync(join(dir, s.source.notice_file))).toBe(true);
      expect(modifications).toContain(`**${name}**`);
    }
  });

  test('server files carry the initialize fields and full tool records', () => {
    for (const s of serverFiles.values()) {
      expect(s.initialize).toHaveProperty('protocolVersion');
      expect(s.initialize).toHaveProperty('capabilities');
      expect(s.initialize).toHaveProperty('serverInfo');
      expect(s.initialize).toHaveProperty('instructions');
      for (const t of s.tools) expect(Object.keys(t).sort()).toEqual(['annotations', 'description', 'inputSchema', 'name']);
    }
  });

  test('the leak scan is current and blocks nothing', () => {
    const report = scan();
    expect(report.blocked).toBe(0);
    expect(readFileSync(join(CATALOG, 'leak-scan.json'), 'utf8')).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });

  test('SHA256SUMS matches every file in the snapshot', () => {
    expect(readFileSync(join(CATALOG, 'SHA256SUMS'), 'utf8')).toBe(sums());
  });
});
