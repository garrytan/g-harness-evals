// internal-task (plan fix F1): the non-empty-memory golden fixture (tests/fixtures/ablation/non-empty-memory.json) on the Claude Code
// and Codex layer maps, keyless. Every capture behind the maps started with empty memory, so each case edits the recorded corpus
// requests the way a trial with persisted memory would and checks, per arm, how the filter classifies each request (family,
// did-not-take, partial, inserts), that the memory text survives byte for byte, and whether the request counts as matched or
// unmatched for treatment validity (joint-gate.ts validityOf). A memories-pipeline request no map family names is counted as an
// unmatched agent request, never skipped; TrialRecord.ablation keeps it out of agent_requests and counts it in unknown_families.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ablate, loadBinding, mapLayers, type AblationReceipt, type AblationSpec, type Wire } from '../runner/proxy/ablate.ts';
import { summarizeAblation, trialKey } from '../runner/trial/proxy.ts';
import { parseLog } from '../scripts/anatomy/dissect.ts';
import { isHashesOnly, unpack } from '../scripts/anatomy/store.ts';
import type { LayerMap } from '../scripts/ablation/maps.ts';
import { validityOf } from '../scripts/prompt-archaeology/joint-gate.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'harnesses', 'ablation');
const MANIFEST = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { maps: Array<{ file: string; sha256: string }> };
interface Case {
  id: string; map: string; edit: 'system-before' | 'user-part' | 'developer-part' | 'pipeline'; block?: number; before?: string; developer?: number; wrap?: [string, string]; instructions?: string;
  arms: Record<string, string[] | 'all'>;
  expect: { family: string | null; kind: AblationReceipt['kind']; unknown_family: boolean; did_not_take: boolean; partial: boolean; insert_spans: string[]; counted: 'matched' | 'unmatched' };
}
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'ablation', 'non-empty-memory.json'), 'utf8')) as { memory: string; cases: Case[] };
const MEMORY = FIXTURE.memory;
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const mapOf = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as LayerMap;
// The public copy keeps only the hashes of the Claude Code captures behind a map (scripts/anatomy/store.ts isHashesOnly), so a case on such a map is skipped there.
const hashesOnly = (file: string) => (mapOf(file).sources as Array<{ receipts: string }>).some((s) => isHashesOnly(join(ROOT, s.receipts)));
const specFor = (file: string, layers: string[] | 'all'): AblationSpec => ({ map: join(DIR, file), map_sha256: MANIFEST.maps.find((m) => m.file === file)!.sha256, layers: layers === 'all' ? [...mapLayers(mapOf(file))] : layers });

interface Req { scenario: string; row: number; route: string; body: Record<string, any> }
function corpus(file: string): Req[] {
  return (mapOf(file).sources as Array<{ scenario: string; receipts: string }>).flatMap((s) => {
    expect({ file, receipts: s.receipts, hashes_only: isHashesOnly(join(ROOT, s.receipts)) }).toEqual({ file, receipts: s.receipts, hashes_only: false });
    return parseLog(unpack(join(ROOT, s.receipts))).flatMap((r, row) => {
      const route = r.path.match(/\/v1\/(messages|responses)$/)?.[0];
      return r.method === 'POST' && route ? [{ scenario: s.scenario, row, route, body: r.body as Record<string, any> }] : [];
    });
  });
}

function edited(c: Case, r: Req): Record<string, any> {
  const body = structuredClone(r.body);
  const wrapped = (c.wrap?.[0] ?? '') + MEMORY + (c.wrap?.[1] ?? '');
  if (c.edit === 'system-before') {
    const b = body.system[c.block!] as { text: string };
    expect(b.text.split(c.before!).length).toBe(2);
    b.text = b.text.replace(c.before!, MEMORY + c.before!);
  } else if (c.edit === 'user-part') (body.messages[0].content as unknown[]).splice(1, 0, { type: 'text', text: wrapped });
  else if (c.edit === 'developer-part') (body.input as Array<Record<string, any>>).filter((m) => m.role === 'developer')[c.developer!]!.content.push({ type: 'input_text', text: wrapped });
  else return { model: r.body.model, instructions: c.instructions, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rollout:\n' + MEMORY }] }] };
  return body;
}

const texts = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(texts) : v && typeof v === 'object' ? Object.values(v).flatMap(texts) : []);

describe('non-empty memory on the Claude Code and Codex layer maps (golden fixture)', () => {
  for (const c of FIXTURE.cases) {
    test.skipIf(hashesOnly(c.map))(c.id, () => {
      const reqs = corpus(c.map);
      expect(reqs.length).toBeGreaterThan(1);
      for (const r of c.edit === 'pipeline' ? reqs.slice(0, 1) : reqs) for (const [arm, layers] of Object.entries(c.arms)) {
        const id = c.id + ' ' + r.scenario + '#' + r.row + ' ' + arm;
        const body = edited(c, r);
        const sent = structuredClone(body);
        const got = ablate(loadBinding(specFor(c.map, layers)), r.route, body);
        const { counted, ...want } = c.expect;
        expect({ id, family: got.family, kind: got.kind, unknown_family: got.unknown_family, did_not_take: got.did_not_take, partial: got.partial, insert_spans: got.inserts.map((x) => x.span) }).toEqual({ id, ...want });
        if (c.edit === 'system-before') expect({ id, insert_bytes: got.inserts.map((x) => x.bytes) }).toEqual({ id, insert_bytes: [bytes(MEMORY)] });
        expect({ id, memory_kept: texts(body).filter((t) => t.includes(MEMORY)).length }).toEqual({ id, memory_kept: 1 });
        if (got.unknown_family) expect(body).toEqual(sent);
        const v = validityOf([{ ...got, at: '2026-11-06T00:00:00.000Z', key: trialKey('fixture/' + c.id + '/t/r1') }]);
        expect({ id, counted: v.fully_matched === 1 ? 'matched' : 'unmatched', agent_requests: v.agent_requests }).toEqual({ id, counted, agent_requests: 1 });
      }
    });
  }

  test('a trial with a memories-pipeline request: validity counts it as an unmatched agent request; TrialRecord.ablation counts it in unknown_families only', () => {
    const file = 'codex.openai-responses.layers.json';
    const pipeline = FIXTURE.cases.find((c) => c.edit === 'pipeline')!;
    const summary = FIXTURE.cases.find((c) => c.map === file && c.edit === 'developer-part')!;
    const spec = specFor(file, ['identity']);
    const key = trialKey('fixture/codex-sol-no-identity-v04-validity/ms-05-l2-x/r1');
    const reqs = corpus(file);
    const lines: AblationReceipt[] = [...reqs.map((r) => edited(summary, r)), edited(pipeline, reqs[0]!)].map((body, i) => ({ at: '2026-11-06T00:00:0' + i + '.000Z', key, ...ablate(loadBinding(spec), '/v1/responses', body) }));
    const n = reqs.length;
    expect(validityOf(lines)).toEqual({ agent_requests: n + 1, fully_matched: n, share: n / (n + 1), ok: 100 * n >= 95 * (n + 1) });
    const record = summarizeAblation(spec, 'openai-responses' as Wire, lines);
    expect({ agent_requests: record.agent_requests, matched_requests: record.matched_requests, unknown_families: record.unknown_families, invalid: record.invalid_reason ?? null })
      .toEqual({ agent_requests: n, matched_requests: n, unknown_families: 1, invalid: null });
  });
});
