// Layer maps for prompt archaeology (internal-task): keyless checks of
// harnesses/ablation/*.layers.json against the committed anatomy receipts.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLog, systemBlocks } from '../scripts/anatomy/dissect.ts';
import { unpack } from '../scripts/anatomy/store.ts';
import { COMBOS, generate } from '../scripts/ablation/gen-anchors.ts';
import { type Assigned, EVAL_MARKER, type Family, type LayerMap, type Unit, ROOT, assignUnit, byteLen, familyOf, locKey, sha256, units, validate } from '../scripts/ablation/maps.ts';
import { DIR, buildMap, mapFile, readCoder, settle } from '../scripts/ablation/settle.ts';

const SCHEMA = JSON.parse(readFileSync(join(DIR, 'layers.schema.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { maps: Array<{ file: string; harness: string; wire: string; model: string; sha256: string }> };
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

interface Req { ref: string; path: string; body: Record<string, unknown> }
function captured(map: LayerMap): Req[] {
  return (map.sources as Array<{ scenario: string; receipts: string; record: string }>).flatMap((s) => {
    const rows = parseLog(unpack(join(ROOT, s.receipts)));
    const rec = JSON.parse(readFileSync(join(ROOT, s.record), 'utf8')) as { requests: Array<{ i: number; class: string }> };
    return rec.requests.filter((r) => r.class === 'agent' || r.class === 'side').map((r) => ({ ref: `${s.scenario}#${r.i}`, path: rows[r.i]!.path, body: rows[r.i]!.body as Record<string, unknown> }));
  });
}

const MAPS = COMBOS.map((c) => ({ combo: c, file: mapFile(c), map: JSON.parse(read(mapFile(c))) as LayerMap }));
const famOf = (m: LayerMap, r: Req): Family | null => familyOf(m, r.path, r.body, systemBlocks(r.body, m.wire).map((b) => b.text).join(''), units(r.body, m.wire).some((u) => u.loc.kind === 'tool_definition'));

/** Every unit of every captured request with its byte assignment. */
const ASSIGNED = new Map(MAPS.map(({ file, map }) => [file, captured(map).map((r) => {
  const fam = famOf(map, r);
  return { r, fam, units: fam ? units(r.body, map.wire).map((u) => ({ u, a: assignUnit(fam, u) })) : [] };
})]));

/** The label of the bytes [start, start+len) of a unit; throws if they carry more than one. */
function labelAt(a: Assigned[], start: number, len: number): string[] {
  return [...new Set(a.filter((x) => x.start < start + len && x.start + x.bytes > start).map((x) => x.label))];
}
const lineRange = (text: string, at: number) => { const buf = Buffer.from(text, 'utf8'); const s = buf.lastIndexOf(0x0a, at - 1) + 1; const e = buf.indexOf(0x0a, at); return { start: s, len: (e < 0 ? buf.length : e) - s }; };
const byteIndex = (text: string, needle: string, from = 0) => Buffer.from(text, 'utf8').indexOf(Buffer.from(needle, 'utf8'), from);

describe('ablation maps', () => {
  test('one map per recaptured harness, wire and model, each in the manifest with its sha256', () => {
    expect(MANIFEST.maps.map((m) => m.file).sort()).toEqual(MAPS.map((m) => m.file).sort());
    for (const { combo, file, map } of MAPS) {
      const row = MANIFEST.maps.find((m) => m.file === file)!;
      expect(row.sha256).toBe(sha256(read(file)));
      expect([map.harness, map.wire, map.model]).toEqual([combo.harness, combo.wire, combo.model]);
      expect([row.harness, row.wire, row.model]).toEqual([combo.harness, combo.wire, combo.model]);
    }
  });

  test('every map validates against layers.schema.json', () => {
    for (const { file, map } of MAPS) expect({ file, errors: validate(map, SCHEMA) }).toEqual({ file, errors: [] });
  });

  test('the schema refuses a span with no label, two labels, or a tool-result location', () => {
    const span = MAPS[0]!.map.families[0]!.spans.find((s) => s.layer)!;
    const bad = (s: object) => validate({ ...MAPS[0]!.map, families: [{ ...MAPS[0]!.map.families[0], spans: [s] }] }, SCHEMA).length > 0;
    expect(bad(span)).toBe(false);
    expect(bad({ ...span, layer: undefined })).toBe(true);
    expect(bad({ ...span, never_removed: 'runtime-environment' })).toBe(true);
    expect(bad({ ...span, location: { kind: 'tool_result', index: 0 } })).toBe(true);
    expect(bad({ ...span, location: { kind: 'message', role: 'assistant', ordinal: 0, part: 0 } })).toBe(true);
    expect(bad({ ...span, layer: 'persona' })).toBe(true);
  });

  test('each map is exactly what settle.ts builds from the candidates and the committed codes', () => {
    const coders = [readCoder('opus.json'), readCoder('sol.json')];
    const [A, B] = coders.map((c) => new Map(c.assignments.map((a) => [a.id, a.label])));
    for (const { combo, file } of MAPS) {
      const cc = generate(combo);
      expect(cc.problems).toEqual([]);
      const tool = new Map<string, boolean>();
      for (const c of cc.candidates) if (!c.fixed) tool.set(c.item, (tool.get(c.item) ?? false) || c.location.kind === 'tool_description' || c.location.kind === 'additional_tool');
      const map = buildMap(cc, (c) => (c.fixed ? c.fixed.never_removed : settle(A!.get(c.item), B!.get(c.item), tool.get(c.item)!).label), coders);
      expect(JSON.stringify(map, null, 1) + '\n').toBe(read(file));
    }
  });

  test('every byte of every captured request family is assigned exactly once', () => {
    for (const { file, map } of MAPS) {
      const rows = ASSIGNED.get(file)!;
      expect(rows.length).toBeGreaterThan(0);
      for (const { r, fam, units: us } of rows) {
        expect({ file, ref: r.ref, family: fam?.id ?? null }).not.toEqual({ file, ref: r.ref, family: null });
        expect(us.length).toBeGreaterThan(0);
        for (const { u, a } of us) expect(a.reduce((n, x) => n + x.bytes, 0)).toBe(byteLen(u.text));
        const bytesOf = (pick: (u: Unit) => boolean) => us.filter(({ u }) => pick(u)).reduce((n, { u }) => n + byteLen(u.text), 0);
        const system = bytesOf((u) => u.loc.kind === 'system_block' || u.loc.kind === 'instructions' || (map.wire === 'openai-responses' && u.loc.kind === 'message' && u.loc.role !== 'user'));
        expect(system).toBe(systemBlocks(r.body, map.wire).reduce((n, b) => n + byteLen(b.text), 0));
      }
      for (const f of map.families) expect(f.requests_seen).toBe(rows.filter((x) => x.fam?.id === f.id).length);
    }
  });

  test('every span addresses text that some captured request carries, so no map holds a stale or unreachable span', () => {
    for (const { file, map } of MAPS) for (const f of map.families) {
      const reached = new Set<string>();
      for (const { fam, units: us } of ASSIGNED.get(file)!) if (fam?.id === f.id) for (const { a } of us) for (const x of a) reached.add(x.span);
      expect({ file, unreached: f.spans.map((s) => s.id).filter((id) => !reached.has(id)) }).toEqual({ file, unreached: [] });
    }
  });

  test('no span addresses a user turn or a tool result', () => {
    for (const { file, map } of MAPS) {
      for (const { units: us } of ASSIGNED.get(file)!) for (const { u } of us) expect(u.text.includes(EVAL_MARKER)).toBe(false);
      const anchors = map.families.flatMap((f) => f.spans.flatMap((s) => [s.anchor, ...(s.paragraphs ?? []).map((p) => p.anchor)])).filter((a): a is string => !!a);
      const r = ASSIGNED.get(file)![0]!.r;
      const body = structuredClone(r.body);
      const blob = anchors.join('\n');
      if (map.wire === 'anthropic-messages') (body.messages as unknown[]).push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: blob }, { type: 'text', text: blob }] }, { role: 'user', content: EVAL_MARKER + '\n' + blob });
      else (body.input as unknown[]).push({ type: 'function_call_output', call_id: 'x', output: blob }, { type: 'custom_tool_call_output', call_id: 'y', output: [{ type: 'input_text', text: blob }] }, { role: 'user', content: [{ type: 'input_text', text: EVAL_MARKER + '\n' + blob }] });
      expect(units(body, map.wire).map((u) => locKey(u.loc) + u.text)).toEqual(units(r.body, map.wire).map((u) => locKey(u.loc) + u.text));
      for (const f of map.families) for (const s of f.spans) if (s.location.kind === 'message' && s.location.role === 'user') expect(s.anchor?.includes(EVAL_MARKER)).toBe(false);
    }
  });

  test('tool names, parameter schemas and grammars (every tool definition) are never removed', () => {
    for (const { file } of MAPS) for (const { units: us } of ASSIGNED.get(file)!) for (const { u, a } of us) {
      if (u.loc.kind === 'tool_definition' || u.world_tool) expect({ file, unit: locKey(u.loc), labels: [...new Set(a.map((x) => x.label))] }).toEqual({ file, unit: locKey(u.loc), labels: ['protocol-and-discovery'] });
    }
  });

  const protocolLines = (file: string, pick: (u: Unit) => boolean, lines: (text: string) => number[]) => {
    let checked = 0;
    for (const { units: us } of ASSIGNED.get(file)!) for (const { u, a } of us) {
      if (!pick(u)) continue;
      for (const at of lines(u.text)) { const { start, len } = lineRange(u.text, at); expect({ file, line: Buffer.from(u.text, 'utf8').subarray(start, start + len).toString('utf8').slice(0, 80), labels: labelAt(a, start, len) }).toEqual({ file, line: Buffer.from(u.text, 'utf8').subarray(start, start + len).toString('utf8').slice(0, 80), labels: ['protocol-and-discovery'] }); checked++; }
    }
    return checked;
  };
  const allAt = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => byteLen(text.slice(0, m.index!)));

  test("OpenClaw's deferred tool section stays (both wires)", () => {
    for (const file of ['openclaw.anthropic-messages.layers.json', 'openclaw.openai-responses.layers.json']) {
      const n = protocolLines(file, (u) => u.loc.kind === 'system_block' || u.loc.kind === 'message', (t) => { const s = byteIndex(t, '### Deferred Tool Schemas'); return s < 0 ? [] : allAt(t, /^### Deferred Tool Schemas$|^- [a-z_]+ \([^)\n]*\): /gm).filter((x) => x >= s); });
      expect(n).toBeGreaterThan(40);
    }
  });

  test("the tool index in Hermes's tool_search description stays (both wires)", () => {
    for (const file of ['hermes.anthropic-messages.layers.json', 'hermes.openai-responses.layers.json']) {
      const n = protocolLines(file, (u) => u.loc.kind === 'tool_description' && u.loc.tool === 'tool_search', (t) => allAt(t, /^- [\w]+: |^[\w ]+ tools \(\d+\):$|^Deferred tool catalog/gm));
      expect(n).toBeGreaterThan(19);
    }
  });

  test("Claude Code's deferred tool names and ToolSearch instructions stay", () => {
    const file = 'claude-code.anthropic-messages.layers.json';
    const n = protocolLines(file, (u) => u.loc.kind === 'message' && u.loc.role === 'system', (t) => { const s = byteIndex(t, 'The following deferred tools are now available via ToolSearch'); if (s < 0) return []; const e = byteIndex(t, '\n\n', s); return [s, ...allAt(t, /^(mcp__\w+|[A-Z]\w+)$/gm).filter((x) => x > s && x < e)]; });
    expect(n).toBeGreaterThan(20);
    expect(protocolLines(file, (u) => u.loc.kind === 'tool_description' && u.loc.tool === 'ToolSearch', (t) => allAt(t, /^.+$/gm))).toBeGreaterThan(4);
  });

  test("Codex's exec contract, nested tool declarations and additional_tools names stay", () => {
    const file = 'codex.openai-responses.layers.json';
    const exec = (u: Unit) => u.loc.kind === 'additional_tool' && u.loc.tool === 'exec';
    expect(protocolLines(file, exec, (t) => allAt(t, /^declare const tools: |ALL_TOOLS|^- All nested tools are available|^Some deferred nested tools|^- Accepts raw JavaScript/gm))).toBeGreaterThan(12);
    const defs = ASSIGNED.get(file)![0]!.units.filter(({ u }) => u.loc.kind === 'tool_definition' && (u.loc as { additional?: true }).additional);
    expect(defs.length).toBeGreaterThan(10);
  });

  test('the date and the token budget line are never removed', () => {
    for (const { file } of MAPS) for (const { units: us } of ASSIGNED.get(file)!) for (const { u, a } of us) for (const at of allAt(u.text, /2026-10-31|October 31, 2026|<total_tokens>/g)) {
      const { start, len } = lineRange(u.text, at);
      expect(labelAt(a, start, len).every((l) => l === 'protocol-and-discovery' || l === 'runtime-environment')).toBe(true);
    }
  });

  test('every span but a tool definition has an anchor, and a paragraph split starts at its span\'s anchor', () => {
    for (const { map } of MAPS) for (const f of map.families) for (const s of f.spans) {
      if (s.location.kind === 'tool_definition') expect(s.anchor).toBeUndefined();
      else expect(typeof s.anchor).toBe('string');
      if (s.paragraphs) expect(s.paragraphs[0]!.anchor).toBe(s.anchor!);
      expect(s.bytes.min).toBeLessThanOrEqual(s.bytes.max);
    }
  });
});
