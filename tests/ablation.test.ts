// internal-task PR 1b: the metering proxy's layer filter (runner/proxy/ablate.ts) and its plumbing, keyless. Location unit tests on
// both wires; every anchor of every map put inside tool results and the eval's task message, where nothing may change; the
// recorded corpus (every generation request of the anatomy receipts the six maps came from: four harnesses, two wires)
// forwarded unbound and bound with zero layers, byte for byte what the proxy at the base commit forwarded
// (tests/fixtures/ablation/base-forwarded.json); the minimal-cell invariant (plan round-2 resolution 7); the bind's sha256
// check, receipts and cache_write_tokens through the proxy; TrialRecord.ablation through a process-mode trial; plan-time
// validation; merge-shards. The docker golden block (each harness image, full and minimal, two turns with a tool-call
// follow-up, against the fake Messages and Responses endpoints) runs only with HE_DOCKER=always and a docker daemon, as
// scripts/ablation-golden.sh runs it on a shard VM.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { GradeResult, TrialRecord } from '../runner/contracts.ts';
import { BudgetRun } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, ProxyControl, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { ablate, GOLDEN_WIRES, loadBinding, mapLayers, type AblationReceipt, type AblationSpec, type Wire } from '../runner/proxy/ablate.ts';
import { buildManifest, loadPrereg, renderPlan, RunnerError, type Cell, type Prereg } from '../runner/run.ts';
import { executeRun } from '../runner/trial/run.ts';
import { RunProxy, summarizeAblation, summarizeUsage, trialKey } from '../runner/trial/proxy.ts';
import { mergeShards } from '../scripts/merge-shards.ts';
import { parseLog, systemBlocks } from '../scripts/anatomy/dissect.ts';
import { unpack } from '../scripts/anatomy/store.ts';
import { SCENARIOS } from '../scripts/anatomy/capture.ts';
import { CAPTURE_DUMMY_KEYS } from '../runner/trial/capture.ts';
import { EVAL_MARKER, NEVER_REMOVED, assignUnit, familyOf, locKey, units, type Family, type Label, type LayerMap, type Location, type Span } from '../scripts/ablation/maps.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'harnesses', 'ablation');
const tmp = mkdtempSync(join(tmpdir(), 'he-ablation-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { maps: Array<{ file: string; harness: string; wire: Wire; model: string; sha256: string }> };
const MAPS = new Map(MANIFEST.maps.map((m) => [m.file, JSON.parse(readFileSync(join(DIR, m.file), 'utf8')) as LayerMap]));
const specFor = (file: string, layers: string[]): AblationSpec => ({ map: join(DIR, file), map_sha256: MANIFEST.maps.find((m) => m.file === file)!.sha256, layers });
const allLayers = (file: string) => [...mapLayers(MAPS.get(file)!)];

interface Req { map: string; scenario: string; row: number; route: '/v1/messages' | '/v1/responses'; provider: 'anthropic' | 'openai'; body: Record<string, any> }
/** Every generation request of the receipts each map lists as a source, in manifest, source and row order (the fixture's order). */
const CORPUS: Req[] = MANIFEST.maps.flatMap((m) => (MAPS.get(m.file)!.sources as Array<{ scenario: string; receipts: string }>).flatMap((s) =>
  parseLog(unpack(join(ROOT, s.receipts))).flatMap((r, row) => {
    const route = r.path.match(/\/v1\/(messages|responses)$/)?.[0] as Req['route'] | undefined;
    return r.method === 'POST' && route ? [{ map: m.file, scenario: s.scenario, row, route, provider: route === '/v1/messages' ? 'anthropic' as const : 'openai' as const, body: r.body as Record<string, any> }] : [];
  })));
const BASE = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'ablation', 'base-forwarded.json'), 'utf8')) as { base_commit: string; max_output_tokens: number; requests: Array<{ map: string; scenario: string; row: number; bytes: number; sha256: string }> };
const familyFor = (map: LayerMap, route: string, body: unknown): Family | null => familyOf(map, route, body, systemBlocks(body, map.wire).map((b) => b.text).join(''), units(body, map.wire).some((u) => u.loc.kind === 'tool_definition'));

// ---- synthetic maps for the location tests ----------------------------------------------------------------------

type Piece = [label: Label, text: string, anchor?: string];
const labelOf = (l: Label) => ((NEVER_REMOVED as readonly string[]).includes(l) ? { never_removed: l } : { layer: l });
/** Spans of one unit: each piece starts at its anchor (default: its first line) and gets exact byte bounds and its sha256. */
function unitSpans(unit: string, location: Location, pieces: Piece[], paragraphs: Record<number, Piece[]> = {}): Span[] {
  return pieces.map(([label, text, anchor], k) => {
    const base = { id: `${unit}.${k}`, unit, location, anchor: anchor ?? text.split('\n')[0]!, section: unit, presence: 'always' as const, bytes: { min: bytes(text), max: bytes(text) }, text_sha256: sha256(text), candidates: ['x'] };
    if (paragraphs[k]) return { ...base, paragraphs: paragraphs[k]!.map(([l, t, a]) => ({ anchor: a ?? t.split('\n')[0]!, ...labelOf(l), bytes: { min: bytes(t), max: bytes(t) }, candidates: ['x'] })) } as Span;
    return { ...base, ...labelOf(label) } as Span;
  });
}
const joinText = (pieces: Piece[]) => pieces.map((p) => p[1]).join('');
function writeMap(name: string, wire: Wire, prefix: string, spans: Span[]): AblationSpec {
  const map = { schema: 'harness-ablation-layers/1', harness: 'fixture', wire, model: 'fixture-model', sources: [], coding: {}, families: [{ id: 'agent', kind: 'agent-turn', fingerprint: { path_suffix: wire === 'anthropic-messages' ? '/messages' : '/responses', has_tools: true, system_prefix: prefix }, requests_seen: 1, spans }] };
  const file = join(tmp, `${name}.layers.json`);
  writeFileSync(file, JSON.stringify(map, null, 1));
  return { map: file, map_sha256: sha256(readFileSync(file)), layers: [] };
}

const A_SYS0: Piece[] = [['runtime-environment', 'SYS-RUNTIME date 2026-10-31\n'], ['style', 'Be terse and kind.\n'], ['safety', 'Ask before deleting files.\n'], ['memory-skills', 'Memory: keep notes.\nPlan: think first.\n']];
const A_SYS0_PARAS = { 3: [['memory-skills', 'Memory: keep notes.\n'], ['work-habits', 'Plan: think first.\n', 'Plan:']] as Piece[] };
const A_SYS1: Piece[] = [['identity', 'You are Fixture Bot.\n']];
const A_REMINDER: Piece[] = [['work-habits', '<system-reminder>Check the plan.</system-reminder>\n']];
const A_BASH: Piece[] = [['tool-descriptions', 'Runs a shell command.\n', 'Runs'], ['protocol-and-discovery', 'Usage: bash <cmd>\n'], ['tool-descriptions', 'Tip: prefer short commands.\n', 'Tip:']];
const ANCHORS = [...A_SYS0, ...A_SYS1, ...A_REMINDER, ...A_BASH, ...A_SYS0_PARAS[3]].map((p) => p[1]).join('');
const A_SPEC = writeMap('fixture-anthropic', 'anthropic-messages', 'SYS-RUNTIME', [
  ...unitSpans('system.0', { kind: 'system_block', index: 0 }, A_SYS0, A_SYS0_PARAS),
  ...unitSpans('system.1', { kind: 'system_block', index: 1 }, A_SYS1),
  ...unitSpans('user.0', { kind: 'message', role: 'user', ordinal: 0, part: 0 }, A_REMINDER),
  ...unitSpans('tool.Bash', { kind: 'tool_description', tool: 'Bash' }, A_BASH),
  { id: 'def.Bash', unit: 'def.Bash', location: { kind: 'tool_definition', tool: 'Bash' }, section: 'def', presence: 'always', bytes: { min: 0, max: 100000 }, never_removed: 'protocol-and-discovery', candidates: ['x'] } as Span,
]);
const anthropicBody = (over: { sys0?: string; bash?: string } = {}) => ({
  model: 'claude-opus-5-5', max_tokens: 100,
  system: [{ type: 'text', text: over.sys0 ?? joinText(A_SYS0) }, { type: 'text', text: joinText(A_SYS1), cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Third block.\n', cache_control: { type: 'ephemeral' } }] as Array<Record<string, any>>,
  messages: [
    { role: 'user', content: [{ type: 'text', text: joinText(A_REMINDER) }, { type: 'text', text: `${EVAL_MARKER}\nplease help\n${ANCHORS}` }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: ANCHORS }, { type: 'text', text: ANCHORS }] },
  ] as Array<Record<string, any>>,
  tools: [{ name: 'Bash', description: over.bash ?? joinText(A_BASH), input_schema: { type: 'object', properties: { cmd: { type: 'string', description: 'Be terse and kind. The command.' } }, required: ['cmd'] } }] as Array<Record<string, any>>,
});

const R_INSTR: Piece[] = [['identity', 'You are Resp Bot.\n'], ['runtime-environment', 'RUNTIME cwd /w\n']];
const R_DEV0: Piece[] = [['style', 'Format answers as bullets.\n']];
const R_DEV1: Piece[] = [['safety', 'Never run rm -rf.\n'], ['runtime-environment', 'Sandbox: workspace-write\n']];
const R_EXEC: Piece[] = [['tool-descriptions', 'Run code.\n'], ['protocol-and-discovery', 'Grammar: js\n']];
const R_SLEEP: Piece[] = [['tool-descriptions', 'Sleep a while.\n']];
const R_ANCHORS = [...R_INSTR, ...R_DEV0, ...R_DEV1, ...R_EXEC, ...R_SLEEP].map((p) => p[1]).join('');
const R_SPEC = writeMap('fixture-responses', 'openai-responses', 'You are Resp Bot.', [
  ...unitSpans('instructions', { kind: 'instructions' }, R_INSTR),
  ...unitSpans('developer.0', { kind: 'message', role: 'developer', ordinal: 0, part: 0 }, R_DEV0),
  ...unitSpans('developer.1', { kind: 'message', role: 'developer', ordinal: 1, part: 0 }, R_DEV1),
  ...unitSpans('tool.exec', { kind: 'tool_description', tool: 'exec' }, R_EXEC),
  ...unitSpans('additional.clock.sleep', { kind: 'additional_tool', namespace: 'clock', tool: 'sleep' }, R_SLEEP),
]);
const responsesBody = (): Record<string, any> => ({
  model: 'gpt-6.1-sol', instructions: joinText(R_INSTR),
  input: [
    { type: 'additional_tools', tools: [{ type: 'namespace', name: 'clock', tools: [{ type: 'function', name: 'sleep', description: joinText(R_SLEEP), parameters: { type: 'object', properties: {} } }] }] },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: joinText(R_DEV0) }] },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: joinText(R_DEV1) }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${EVAL_MARKER}\ndo the task\n${R_ANCHORS}` }] },
    { type: 'function_call', call_id: 'c1', name: 'exec', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: R_ANCHORS },
    { type: 'custom_tool_call_output', call_id: 'c2', output: [{ type: 'input_text', text: R_ANCHORS }] },
  ],
  tools: [{ type: 'function', name: 'exec', description: joinText(R_EXEC), parameters: { type: 'object', properties: { code: { type: 'string', description: 'Run code.' } } } }],
});
const bind = (s: AblationSpec, layers: string[]) => loadBinding({ ...s, layers });

describe('the layer filter on the Anthropic Messages wire', () => {
  test('a system-block sub-span: only its bytes go, the receipt names its layer, length and sha256 and never its text', () => {
    const body = anthropicBody();
    const r = ablate(bind(A_SPEC, ['style']), '/v1/messages', body);
    expect(body.system[0]!.text).toBe('SYS-RUNTIME date 2026-10-31\nAsk before deleting files.\nMemory: keep notes.\nPlan: think first.\n');
    expect(body.tools[0]!.input_schema.properties.cmd.description).toBe('Be terse and kind. The command.');
    expect(JSON.stringify(body.messages)).toBe(JSON.stringify(anthropicBody().messages));
    expect(r).toMatchObject({ family: 'agent', kind: 'agent-turn', unknown_family: false, expected: 1, layers_matched: ['style'], removed_bytes: bytes('Be terse and kind.\n'), missing: [], changed: [], problems: [], did_not_take: false, partial: false });
    expect(r.removed).toEqual([{ span: 'system.0.1', layer: 'style', bytes: bytes('Be terse and kind.\n'), sha256: sha256('Be terse and kind.\n'), unit_sha256: sha256(joinText(A_SYS0)) }]);
    expect(JSON.stringify(r)).not.toContain('terse');
  });

  test('a whole system block goes and its cache_control moves to the block before it; paragraphs split a mixed span', () => {
    const body = anthropicBody();
    const r = ablate(bind(A_SPEC, ['identity', 'memory-skills']), '/v1/messages', body);
    expect(body.system).toEqual([{ type: 'text', text: 'SYS-RUNTIME date 2026-10-31\nBe terse and kind.\nAsk before deleting files.\nPlan: think first.\n', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Third block.\n', cache_control: { type: 'ephemeral' } }]);
    expect(r.removed.map((x) => x.span)).toEqual(['system.0.3/p0', 'system.1.0']);
    expect(r).toMatchObject({ expected: 2, layers_matched: ['identity', 'memory-skills'], did_not_take: false, partial: false });
  });

  test('a harness-injected user part goes and the eval task part beside it stays; a tool description keeps its protocol and schema', () => {
    const body = anthropicBody();
    const r = ablate(bind(A_SPEC, ['work-habits', 'tool-descriptions']), '/v1/messages', body);
    expect(body.messages[0]!.content).toEqual([anthropicBody().messages[0]!.content[1]]);
    expect(body.system[0]!.text).not.toContain('Plan: think first.');
    expect(body.tools[0]).toEqual({ ...anthropicBody().tools[0], description: 'Usage: bash <cmd>\n' });
    expect(r).toMatchObject({ expected: 4, did_not_take: false, partial: false, layers_matched: ['work-habits', 'tool-descriptions'] });
    expect(body.messages.slice(1)).toEqual(anthropicBody().messages.slice(1));
  });

  test('zero layers is the full cell: the body is not touched and the receipt says agent family, nothing expected', () => {
    const body = anthropicBody();
    const r = ablate(bind(A_SPEC, []), '/v1/messages', body);
    expect(JSON.stringify(body)).toBe(JSON.stringify(anthropicBody()));
    expect(r).toMatchObject({ family: 'agent', expected: 0, removed_bytes: 0, did_not_take: false, partial: false, unknown_family: false });
  });

  test('a request in no family, or on the other wire, passes through untouched and is counted', () => {
    const other = { ...anthropicBody(), system: [{ type: 'text', text: 'Another harness.\n' }] };
    const r = ablate(bind(A_SPEC, ['style']), '/v1/messages', other);
    expect(other.system[0]!.text).toBe('Another harness.\n');
    expect(r).toMatchObject({ family: null, kind: null, unknown_family: true, removed_bytes: 0, did_not_take: false });
    expect(ablate(bind(A_SPEC, ['style']), '/v1/responses', anthropicBody())).toMatchObject({ unknown_family: true });
  });

  test("a request to one of the cell's utility_models is housekeeping: untouched even in a family, never agent, did-not-take, partial or unknown", () => {
    const hk = loadBinding({ ...A_SPEC, layers: ['style', 'safety'], utility_models: ['anthropic:claude-haiku-5-5'] });
    const housekeeping = { family: 'housekeeping', kind: 'utility', unknown_family: false, expected: 0, layers_matched: [], removed_bytes: 0, removed: [], missing: [], changed: [], problems: [], did_not_take: false, partial: false };
    const inFamily = { ...anthropicBody(), model: 'claude-haiku-5-5' };
    expect(ablate(hk, '/v1/messages', inFamily)).toMatchObject(housekeeping);
    expect(JSON.stringify(inFamily)).toBe(JSON.stringify({ ...anthropicBody(), model: 'claude-haiku-5-5' }));
    const side = { model: 'claude-haiku-5-5', max_tokens: 50, system: [{ type: 'text', text: 'Write a short title.\n' }], messages: [{ role: 'user', content: 'hello' }] };
    expect(ablate(hk, '/v1/messages', side)).toMatchObject(housekeeping);
    expect(ablate(bind(A_SPEC, ['style']), '/v1/messages', structuredClone(side))).toMatchObject({ family: null, unknown_family: true });
    expect(ablate(hk, '/v1/messages', anthropicBody())).toMatchObject({ family: 'agent', kind: 'agent-turn', layers_matched: ['style', 'safety'], did_not_take: false, partial: false });
    expect(() => loadBinding({ ...A_SPEC, utility_models: 'anthropic:claude-haiku-5-5' as unknown as string[] })).toThrow('ablation utility_models must be a list of provider:model ids');
  });

  test("Claude Code's # Environment paragraph with a longer or shorter host kernel: minimal still takes every span; a changed removable paragraph is still refused", () => {
    const file = 'claude-code.anthropic-messages.layers.json';
    const cc = CORPUS.find((r) => r.map === file)!;
    const text = JSON.stringify(cc.body);
    const OS = 'OS Version: Linux 6.1.158+';
    expect(text.split(OS).length).toBe(2);
    const minimal = (body: Record<string, any>) => ablate(loadBinding(specFor(file, allLayers(file))), cc.route, body);
    const taken = (r: ReturnType<typeof ablate>) => ({ did_not_take: r.did_not_take, partial: r.partial, missing: r.missing, changed: r.changed, problems: r.problems, removed: r.removed.map((x) => [x.span, x.bytes, x.sha256]) });
    const base = taken(minimal(structuredClone(cc.body)));
    expect(base.removed.some(([span]) => String(span).startsWith('agent.message:system#0.part[0].s9/'))).toBe(true);
    for (const kernel of ['Linux 6.8.0-106-generic', 'Linux 6.1']) {
      expect({ kernel, ...taken(minimal(JSON.parse(text.replace(OS, `OS Version: ${kernel}`)))) }).toEqual({ kernel, ...base });
    }
    const edited = minimal(JSON.parse(text.replace(OS, 'OS Version: Linux 6.8.0-106-generic').replace(' - Downloaded files', ' - Downloaded files (edited)')));
    expect(edited.changed).toEqual(['agent.message:system#0.part[0].s9/p1']);
    expect(edited.partial).toBe(true);
    expect(edited.removed.filter((x) => x.span.startsWith('agent.message:system#0.part[0].s9/')).map((x) => x.span)).toEqual(['agent.message:system#0.part[0].s9/p4', 'agent.message:system#0.part[0].s9/p5', 'agent.message:system#0.part[0].s9/p7']);
  });

  test("a never-removed insert after a fixed removable span is kept only when the map's next span is found right after it", () => {
    const spans = unitSpans('system.0', { kind: 'system_block', index: 0 }, [['runtime-environment', 'SYS-INSERT runtime\n'], ['style', 'Be terse and kind.\n', 'Be terse'], ['safety', 'Ask first.\n'], ['runtime-environment', 'Date: today\n']]);
    spans[2] = { ...spans[2]!, presence: 'when_present' };
    const spec = writeMap('fixture-insert', 'anthropic-messages', 'SYS-INSERT', spans);
    const run = (text: string) => {
      const body = { model: 'claude-opus-5-5', max_tokens: 100, system: [{ type: 'text', text }], messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'Bash', description: 'Runs.', input_schema: {} }] };
      const r = ablate(bind(spec, ['style', 'safety']), '/v1/messages', body);
      return { text: body.system[0]?.text, did_not_take: r.did_not_take, partial: r.partial, changed: r.changed, inserts: r.inserts, removed: r.removed.map((x) => x.span) };
    };
    const note = 'NOTE the trial wrote this\n';
    expect(run(`SYS-INSERT runtime\nBe terse and kind.\n${note}Ask first.\nDate: today\n`)).toEqual({ text: `SYS-INSERT runtime\n${note}Date: today\n`, did_not_take: false, partial: false, changed: [], inserts: [{ span: 'system.0.1', bytes: bytes(note), sha256: sha256(note) }], removed: ['system.0.1', 'system.0.2'] });
    expect(run(`SYS-INSERT runtime\nBe terse and kind.\nAlways ask first.\nDate: today\n`)).toEqual({ text: `SYS-INSERT runtime\nBe terse and kind.\nAlways ask first.\nDate: today\n`, did_not_take: true, partial: false, changed: ['system.0.1'], inserts: [], removed: [] });
    expect(run(`SYS-INSERT runtime\nBe terse and calm.\n${note}Ask first.\nDate: today\n`)).toEqual({ text: `SYS-INSERT runtime\nBe terse and calm.\n${note}Date: today\n`, did_not_take: true, partial: false, changed: ['system.0.1'], inserts: [], removed: ['system.0.2'] });
  });

  test('a missing required anchor removes nothing from that unit (did not take); a span of the wrong length is not removed (changed)', () => {
    const missing = anthropicBody({ sys0: 'SYS-RUNTIME date 2026-10-31\nBe terse and kind.\nMemory: keep notes.\nPlan: think first.\n' });
    const r1 = ablate(bind(A_SPEC, ['safety', 'style']), '/v1/messages', missing);
    expect(missing.system[0]!.text).toBe('SYS-RUNTIME date 2026-10-31\nBe terse and kind.\nMemory: keep notes.\nPlan: think first.\n');
    expect(r1).toMatchObject({ did_not_take: true, partial: false, removed_bytes: 0, missing: ['system.0.1', 'system.0.2'], problems: ['system_block: a required anchor did not resolve'] });
    const longer = anthropicBody({ bash: 'Runs a shell command.\nUsage: bash <cmd>\nTip: prefer short commands, always.\n' });
    const r2 = ablate(bind(A_SPEC, ['tool-descriptions']), '/v1/messages', longer);
    expect(longer.tools[0]!.description).toBe('Usage: bash <cmd>\nTip: prefer short commands, always.\n');
    expect(r2).toMatchObject({ did_not_take: false, partial: true, changed: ['tool.Bash.2'], missing: ['tool.Bash.2'] });
    const same = anthropicBody({ bash: 'Runs a shell commanX.\nUsage: bash <cmd>\nTip: prefer short commands.\n' });
    const r3 = ablate(bind(A_SPEC, ['tool-descriptions']), '/v1/messages', same);
    expect(same.tools[0]!.description).toBe('Usage: bash <cmd>\n');
    expect(r3).toMatchObject({ partial: true, changed: ['tool.Bash.0'], missing: [] });
  });

  test('a span split into paragraphs is checked by the removed paragraph only, so runtime text in a kept paragraph does not make it partial', () => {
    const body = anthropicBody({ sys0: 'SYS-RUNTIME date 2026-10-31\nBe terse and kind.\nAsk before deleting files.\nMemory: keep notes.\nPlan: think firsT.\n' });
    const r = ablate(bind(A_SPEC, ['memory-skills']), '/v1/messages', body);
    expect(body.system[0]!.text).toBe('SYS-RUNTIME date 2026-10-31\nBe terse and kind.\nAsk before deleting files.\nPlan: think firsT.\n');
    expect(r).toMatchObject({ removed_bytes: bytes('Memory: keep notes.\n'), missing: [], changed: [], did_not_take: false, partial: false });
  });
});

describe('the layer filter on the Responses wire', () => {
  test('instructions, developer messages by ordinal, tool and additional_tools descriptions; outputs and the task message untouched', () => {
    const body = responsesBody();
    const r = ablate(bind(R_SPEC, ['identity', 'style', 'safety', 'tool-descriptions']), '/v1/responses', body);
    expect(body.instructions).toBe('RUNTIME cwd /w\n');
    expect(body.input.filter((m: any) => m.role === 'developer').map((m: any) => m.content[0].text)).toEqual(['Sandbox: workspace-write\n']);
    expect(body.tools[0]!.description).toBe('Grammar: js\n');
    expect(body.tools[0]!.parameters).toEqual(responsesBody().tools[0]!.parameters);
    expect('description' in body.input[0].tools[0].tools[0]).toBe(false);
    const kept = (b: any) => b.input.filter((m: any) => m.role === 'user' || m.type?.endsWith('output') || m.type === 'function_call');
    expect(kept(body)).toEqual(kept(responsesBody()));
    expect(r).toMatchObject({ expected: 5, did_not_take: false, partial: false, layers_matched: ['identity', 'style', 'safety', 'tool-descriptions'], removed_bytes: bytes('You are Resp Bot.\nFormat answers as bullets.\nNever run rm -rf.\nRun code.\nSleep a while.\n') });
  });
});

describe('the layer maps on the recorded corpus', () => {
  test("the corpus is the fixture's: every generation request of the six maps' sources, four harnesses on two wires", () => {
    expect(CORPUS.map((r) => [r.map, r.scenario, r.row])).toEqual(BASE.requests.map((r) => [r.map, r.scenario, r.row]));
    expect(new Set(CORPUS.map((r) => MAPS.get(r.map)!.harness))).toEqual(new Set(['claude-code', 'openclaw', 'hermes', 'codex']));
    expect(new Set(CORPUS.map((r) => MAPS.get(r.map)!.wire))).toEqual(new Set(GOLDEN_WIRES));
  });

  test('every anchor of every map inside tool results, function_call_output, custom_tool_call_output and the task message changes nothing there', () => {
    for (const [file, map] of MAPS) {
      const r = CORPUS.find((x) => x.map === file)!;
      const anchors = map.families.flatMap((f) => f.spans.flatMap((s) => [s.anchor, ...(s.paragraphs ?? []).map((p) => p.anchor)])).filter((a): a is string => !!a).join('\n');
      const body = structuredClone(r.body);
      const added = map.wire === 'anthropic-messages'
        ? [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: anchors }, { type: 'text', text: anchors }] }, { role: 'user', content: EVAL_MARKER + '\n' + anchors }]
        : [{ type: 'function_call_output', call_id: 'x', output: anchors }, { type: 'custom_tool_call_output', call_id: 'y', output: [{ type: 'input_text', text: anchors }] }, { role: 'user', content: [{ type: 'input_text', text: EVAL_MARKER + '\n' + anchors }] }];
      (map.wire === 'anthropic-messages' ? body.messages : body.input).push(...structuredClone(added));
      const receipt = ablate(loadBinding(specFor(file, allLayers(file))), r.route, body);
      const after = (map.wire === 'anthropic-messages' ? body.messages : body.input) as unknown[];
      expect({ file, tail: after.slice(-added.length) }).toEqual({ file, tail: added });
      expect({ file, missing: receipt.missing, problems: receipt.problems, removed: receipt.removed_bytes > 0 }).toEqual({ file, missing: [], problems: [], removed: true });
    }
  });

  test('minimal keeps every tool name, schema, deferred index and protocol span byte for byte, and removes exactly the removable bytes (resolution 7)', () => {
    const NEVER = new Set<string>(NEVER_REMOVED);
    const key = (l: Location) => (l.kind === 'system_block' ? 'system' : l.kind === 'message' ? `message:${l.role}` : locKey(l));
    for (const r of CORPUS) {
      const map = MAPS.get(r.map)!;
      const fam = familyFor(map, r.route, r.body)!;
      const before = units(r.body, map.wire);
      const body = structuredClone(r.body);
      const receipt = ablate(loadBinding(specFor(r.map, allLayers(r.map))), r.route, body);
      const id = `${r.map} ${r.scenario}#${r.row}`;
      expect({ id, did_not_take: receipt.did_not_take, partial: receipt.partial, missing: receipt.missing }).toEqual({ id, did_not_take: false, partial: false, missing: [] });
      let removable = 0;
      const expected = before.flatMap((u) => {
        if (u.loc.kind === 'tool_definition') return [[key(u.loc), u.text]];
        const buf = Buffer.from(u.text, 'utf8');
        const pieces = assignUnit(fam, u);
        removable += pieces.filter((a) => !NEVER.has(a.label)).reduce((n, a) => n + a.bytes, 0);
        const kept = Buffer.concat(pieces.filter((a) => NEVER.has(a.label)).map((a) => buf.subarray(a.start, a.start + a.bytes))).toString('utf8');
        return kept ? [[key(u.loc), kept]] : [];
      });
      expect({ id, units: units(body, map.wire).map((u) => [key(u.loc), u.text]) }).toEqual({ id, units: expected });
      expect({ id, removed: receipt.removed_bytes }).toEqual({ id, removed: removable });
    }
  });

  test("Hermes's persisted memory, where Hermes puts it (between the skill index and \"Conversation started:\"), survives minimal and memory-skills byte for byte with zero partial on both wires; an edited or missing skill index is still refused", () => {
    // The blocks Hermes v2026.9.24 rendered from MEMORY.md and USER.md in a keyless capture (tools/memory_tool_store.py
    // _render_block, joined into the volatile tier by agent/system_prompt.py with "\n\n"), verbatim.
    const SEP = '═'.repeat(46);
    const MEMORY = `${SEP}\nMEMORY (your personal notes) [5% — 112/2,200 chars]\n${SEP}\nMarrow Agrisupply site work: the staging host is staging.marrow.example and deploys go through the #ops channel.\n\n`
      + `${SEP}\nUSER PROFILE (who the user is) [5% — 72/1,375 chars]\n${SEP}\nDana prefers short status updates and wants links to every changed page.\n\n`;
    const TS = 'Conversation started:';
    for (const file of ['hermes.anthropic-messages.layers.json', 'hermes.openai-responses.layers.json']) {
      const map = MAPS.get(file)!;
      const index = map.families[0]!.spans.find((s) => s.anchor === '<available_skills>')!;
      expect({ file, layer: index.layer, sha: !!index.text_sha256 }).toEqual({ file, layer: 'memory-skills', sha: true });
      const volatile = (body: Record<string, any>): { text: string; set: (t: string) => void } => {
        if (map.wire === 'openai-responses') return { text: body.instructions, set: (t) => { body.instructions = t; } };
        const b = (body.system as Array<Record<string, any>>).find((x) => x.text.includes(TS))!;
        return { text: b.text, set: (t) => { b.text = t; } };
      };
      const withMemory = (body: Record<string, any>, edit: (t: string) => string = (t) => t) => {
        const out = structuredClone(body);
        const v = volatile(out);
        expect(v.text.split(TS).length).toBe(2);
        v.set(edit(v.text).replace(TS, MEMORY + TS));
        return out;
      };
      const reqs = CORPUS.filter((r) => r.map === file);
      expect(reqs.length).toBeGreaterThan(1);
      for (const r of reqs) for (const layers of [allLayers(file), ['memory-skills']]) {
        const id = `${file} ${r.scenario}#${r.row} ${layers.length === 1 ? 'memory-skills' : 'minimal'}`;
        const b = loadBinding(specFor(file, layers));
        const plain = structuredClone(r.body);
        const base = ablate(b, r.route, plain);
        const body = withMemory(r.body);
        const got = ablate(b, r.route, body);
        expect({ id, did_not_take: got.did_not_take, partial: got.partial, missing: got.missing, changed: got.changed, problems: got.problems })
          .toEqual({ id, did_not_take: false, partial: false, missing: [], changed: [], problems: [] });
        expect({ id, removed: got.removed.map((x) => [x.span, x.bytes, x.sha256]) }).toEqual({ id, removed: base.removed.map((x) => [x.span, x.bytes, x.sha256]) });
        expect({ id, inserts: got.inserts }).toEqual({ id, inserts: [{ span: index.id, bytes: bytes(MEMORY), sha256: sha256(MEMORY) }] });
        expect({ id, text: volatile(body).text }).toEqual({ id, text: volatile(plain).text.replace(TS, MEMORY + TS) });
      }
      const r = reqs[reqs.length - 1]!;
      const minimal = (body: Record<string, any>) => ablate(loadBinding(specFor(file, allLayers(file))), r.route, body);
      const LINE = '  web: Skills for reaching web content';
      expect(volatile(r.body).text.split(LINE).length).toBe(2);
      for (const [what, edit] of [['same length', (t: string) => t.replace(LINE, '  web: Skills for fetching web content')], ['longer', (t: string) => t.replace(LINE, LINE + ' (edited)')]] as const) {
        const body = withMemory(r.body, edit);
        const got = minimal(body);
        expect({ file, what, changed: got.changed, partial: got.partial, inserts: got.inserts, index_kept: volatile(body).text.includes('<available_skills>'), memory_kept: volatile(body).text.includes(MEMORY + TS) })
          .toEqual({ file, what, changed: [index.id], partial: true, inserts: [], index_kept: true, memory_kept: true });
      }
      const gone = withMemory(r.body, (t) => t.replace('<available_skills>', '<skills>'));
      const refused = minimal(gone);
      expect({ file, missing_index: refused.missing.includes(index.id), refused: refused.partial || refused.did_not_take, memory_kept: volatile(gone).text.includes(MEMORY + TS) }).toEqual({ file, missing_index: true, refused: true, memory_kept: true });
    }
  });
});

// ---- the proxy -----------------------------------------------------------------------------------------------------

let proxies = 0;
function startProxy(o: { ablationLog?: boolean; usage?: Record<string, number>; allowModels?: string[] } = {}) {
  const n = ++proxies;
  const lease = BudgetRun.openLease({ runId: `ablation-${n}`, leaseUsd: 10_000, ledgerPath: join(tmp, `ledger-${n}.sqlite`), runner: 'test', maxOutputTokens: 128_000, newRun: true });
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return Response.json({ usage: o.usage ?? { input_tokens: 10, output_tokens: 1 } }); }) as unknown as typeof fetch;
  const usageLog = join(tmp, `usage-${n}.ndjson`);
  const ablationLog = join(tmp, `ablation-${n}.ndjson`);
  const proxy = new MeteringProxy({ fetchImpl, controlToken: 'ctl', policy: { lease, env: { ANTHROPIC_API_KEY: 'dummy', OPENAI_API_KEY: 'dummy' }, maxOutputTokens: 128_000, usageLog, ...(o.ablationLog === false ? {} : { ablationLog }), ...(o.allowModels ? { allowModels: o.allowModels } : {}) } });
  proxy.start();
  const base = `http://127.0.0.1:${proxy.port}`;
  const post = (slot: string, r: { provider: string; route: string; body: unknown }) => fetch(`${base}/${slot}/${r.provider}${r.route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) }).then(async (res) => { await res.text(); return res.status; });
  const read = <T>(f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);
  return { proxy, sent, base, post, control: new ProxyControl(base, 'ctl'), usage: () => read<UsageLine>(usageLog), receipts: () => read<AblationReceipt>(ablationLog) };
}

describe('the metering proxy with the filter', () => {
  test('unbound and bound with zero layers, the recorded corpus is forwarded byte for byte as the base commit forwarded it', async () => {
    const p = startProxy();
    try {
      await p.control.bind('unset', 'k-unset');
      for (const [file] of MAPS) await p.control.bind(`zero-${file}`, 'k-zero', undefined, undefined, specFor(file, []));
      for (const [i, r] of CORPUS.entries()) {
        const want = BASE.requests[i]!;
        for (const slot of ['unset', `zero-${r.map}`]) {
          p.sent.length = 0;
          expect(await p.post(slot, r)).toBe(200);
          const ref = `${slot} ${r.scenario}#${r.row}`;
          expect({ ref, bytes: bytes(p.sent[0]!), sha256: sha256(p.sent[0]!) }).toEqual({ ref, bytes: want.bytes, sha256: want.sha256 });
        }
      }
      const receipts = p.receipts();
      expect(receipts.map((x) => x.key)).toEqual(CORPUS.map(() => 'k-zero'));
      expect(receipts.every((x) => x.family === 'agent' && x.kind === 'agent-turn' && x.removed_bytes === 0 && !x.did_not_take && !x.partial)).toBe(true);
    } finally { p.proxy.stop(); }
  });

  test('bind refuses a map whose sha256 differs, a layer the map lacks, and any map on a proxy without --ablation-log', async () => {
    const p = startProxy();
    const q = startProxy({ ablationLog: false });
    try {
      const refusal = async (base: string, ablation: unknown) => {
        const res = await fetch(`${base}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': 'ctl' }, body: JSON.stringify({ slot: 's', key: 'k', ablation }) });
        return [res.status, ((await res.json()) as { error: { message: string } }).error.message];
      };
      const file = 'hermes.anthropic-messages.layers.json';
      expect(await refusal(p.base, { ...specFor(file, ['style']), map_sha256: '0'.repeat(64) })).toEqual([400, `metering proxy: bind ablation refused: ablation map ${join(DIR, file)} has sha256 ${specFor(file, []).map_sha256}, not the bound ${'0'.repeat(64)}`]);
      expect((await refusal(p.base, specFor(file, ['identity'])))[1]).toContain('ablation layers ["identity"] are not layers of');
      expect(await refusal(q.base, specFor(file, ['style']))).toEqual([400, 'metering proxy: bind ablation needs a lease proxy started with --ablation-log']);
      expect(p.receipts()).toEqual([]);
    } finally { p.proxy.stop(); q.proxy.stop(); }
  });

  test('the ledger prices the filtered body; the cap is injected after the filter; a refused request writes no receipt; cache writes reach the usage line', async () => {
    const p = startProxy({ usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 40, cache_creation_input_tokens: 300 }, allowModels: ['anthropic:claude-opus-5-5'] });
    try {
      const file = 'claude-code.anthropic-messages.layers.json';
      await p.control.bind('full', 'k-full', undefined, undefined, specFor(file, []));
      await p.control.bind('min', 'k-min', undefined, undefined, specFor(file, allLayers(file)));
      const r = CORPUS.find((x) => x.map === file)!;
      const noCap = { ...r, body: { ...r.body, max_tokens: undefined } };
      expect(await p.post('full', noCap)).toBe(200);
      expect(await p.post('min', noCap)).toBe(200);
      expect(await p.post('min', { ...r, body: { ...r.body, model: 'claude-sonnet-5-5' } })).toBe(403);
      const [full, min] = p.sent.map((s) => JSON.parse(s));
      expect([full.max_tokens, min.max_tokens]).toEqual([128_000, 128_000]);
      const lines = p.usage();
      expect(lines.map((l) => [l.key, l.outcome])).toEqual([['k-full', 'forwarded'], ['k-min', 'forwarded'], ['k-min', 'refused']]);
      expect(lines[1]!.reserved_usd!).toBeLessThan(lines[0]!.reserved_usd!);
      expect(lines.slice(0, 2).map((l) => [l.cached_tokens, l.cache_write_tokens])).toEqual([[40, 300], [40, 300]]);
      const receipts = p.receipts();
      expect(receipts.map((x) => x.key)).toEqual(['k-full', 'k-min']);
      expect(bytes(p.sent[0]!) - bytes(p.sent[1]!)).toBeGreaterThan(receipts[1]!.removed_bytes * 0.9);
      const meter = await p.proxy.finalize('k-min');
      expect(summarizeUsage('k-min', meter, lines.filter((l) => l.key === 'k-min')).usage.cache_write_tokens).toBe(300);
    } finally { p.proxy.stop(); }
  });

  test('a usage line without cache_creation_input_tokens carries no cache_write_tokens, and neither does TrialUsage', async () => {
    const p = startProxy({ ablationLog: false });
    try {
      await p.control.bind('s', 'k');
      expect(await p.post('s', CORPUS[0]!)).toBe(200);
      const lines = p.usage();
      expect('cache_write_tokens' in lines[0]!).toBe(false);
      expect('cache_write_tokens' in summarizeUsage('k', await p.proxy.finalize('k'), lines).usage).toBe(false);
    } finally { p.proxy.stop(); }
  });
});

describe('TrialRecord.ablation', () => {
  const receipt = (over: Partial<AblationReceipt>): AblationReceipt => ({ at: 'x', key: 'k', route: '/v1/messages', map_sha256: 'm', layers: ['style'], family: 'agent', kind: 'agent-turn', unknown_family: false, expected: 1, layers_matched: ['style'],
    removed_bytes: 10, removed: [{ span: 's1', layer: 'style', bytes: 10, sha256: 'a', unit_sha256: 'u' }], missing: [], changed: [], inserts: [], problems: [], did_not_take: false, partial: false, ...over });
  const spec: AblationSpec = { map: 'harnesses/ablation/x.layers.json', map_sha256: 'm', layers: ['style'] };

  test('counts agent requests, matched, did-not-take, partial and unknown families from the receipts', () => {
    const lines = [receipt({}), receipt({ did_not_take: true, removed: [], removed_bytes: 0 }), receipt({ partial: true }), receipt({ family: null, kind: null, unknown_family: true, removed: [], removed_bytes: 0 })];
    expect(summarizeAblation(spec, 'anthropic-messages', lines)).toEqual({ layers: ['style'], map: spec.map, map_sha256: 'm', wire: 'anthropic-messages', agent_requests: 3, matched_requests: 1, removed_bytes: 20, did_not_take: 1, partial: 1, unknown_families: 1, unstable_filter: false });
  });

  test('a removed span that changes between consecutive agent requests while its block did not is an unstable filter', () => {
    const changedSpan = receipt({ removed: [{ span: 's1', layer: 'style', bytes: 10, sha256: 'b', unit_sha256: 'u' }] });
    const changedBlock = receipt({ removed: [{ span: 's1', layer: 'style', bytes: 10, sha256: 'b', unit_sha256: 'v' }] });
    expect(summarizeAblation(spec, 'anthropic-messages', [receipt({}), changedSpan]).unstable_filter).toBe(true);
    expect(summarizeAblation(spec, 'anthropic-messages', [receipt({}), changedBlock]).unstable_filter).toBe(false);
  });

  test('a trial with no receipts, or with no agent request, carries invalid_reason', () => {
    expect(summarizeAblation(spec, 'anthropic-messages', []).invalid_reason).toBe('no ablation receipts: the proxy filtered no request of this trial');
    expect(summarizeAblation(spec, 'anthropic-messages', [receipt({ family: null, kind: null, unknown_family: true })]).invalid_reason).toBe('1 receipt(s) and no agent request (unknown families: 1)');
    expect('invalid_reason' in summarizeAblation(spec, 'anthropic-messages', [receipt({})])).toBe(false);
  });

  test('housekeeping requests are counted on their own and in none of agent, did-not-take, partial or unknown families', () => {
    const hk = receipt({ family: 'housekeeping', kind: 'utility', expected: 0, layers_matched: [], removed: [], removed_bytes: 0 });
    expect(summarizeAblation(spec, 'anthropic-messages', [receipt({}), hk, hk])).toEqual({ layers: ['style'], map: spec.map, map_sha256: 'm', wire: 'anthropic-messages', agent_requests: 1, matched_requests: 1, removed_bytes: 10, did_not_take: 0, partial: 0, unknown_families: 0, housekeeping_requests: 2, unstable_filter: false });
    expect('housekeeping_requests' in summarizeAblation(spec, 'anthropic-messages', [receipt({})])).toBe(false);
  });
});

// ---- the runner ----------------------------------------------------------------------------------------------------

const FIXTURES = join(ROOT, 'tests', 'fixtures');
const CC_MAP = 'harnesses/ablation/claude-code.anthropic-messages.layers.json';
const CC_SHA = MANIFEST.maps.find((m) => m.file === 'claude-code.anthropic-messages.layers.json')!.sha256;
const fxCell = (over: Partial<Cell> = {}): Cell => ({ id: 'cc-style', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1,
  ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, ablation: { map: CC_MAP, map_sha256: CC_SHA, layers: ['style'] }, ...over });
let plans = 0;
function planCells(cells: Cell[], tasksRoot = join(FIXTURES, 'tasks')) {
  const runId = `ablation-run-${++plans}`;
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'prereg.json');
  const prereg: Prereg = { schema_version: 1, run_id: runId, question: 'fixture', tasks: {}, cells, wall_clock_s: { multiuser: 120 }, spend_cap_usd: 5, drop_order: [], minimum_v01: [] };
  writeFileSync(file, JSON.stringify(prereg));
  const loaded = loadPrereg(file);
  const manifest = buildManifest(loaded.prereg, loaded.sha256, '2026-10-31T00:00:00Z', { tasksRoot });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath, dir };
}
const refusedWith = (cells: Cell[]) => { try { planCells(cells); return 'planned'; } catch (e) { return e instanceof RunnerError ? e.message : String(e); } };

describe("plan-time validation of a cell's ablation", () => {
  test('a valid cell plans and its CELL line names the layers, the map and the sha256; a cell without ablation prints as before', () => {
    const { manifest } = planCells([fxCell(), fxCell({ id: 'cc-full', ablation: { map: CC_MAP, map_sha256: CC_SHA, layers: [] } }), fxCell({ id: 'plain', ablation: undefined })]);
    const lines = renderPlan(manifest).split('\n').filter((l) => l.startsWith('CELL: '));
    expect(lines[0]).toContain(` ablation=style map=${CC_MAP} map_sha256=${CC_SHA.slice(0, 12)} reps=1 `);
    expect(lines[1]).toContain(' ablation=none map=');
    expect(lines[2]).toMatch(/^CELL: plain harness=claude-code mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0\.1 reps=1 trials=\d+ turns=\d+ ceiling_usd=[0-9.]+$/);
  });

  test('refused: a wrong sha256, a missing map, a layer the map lacks, another harness or model, a non-multi-user cell, a bad shape', () => {
    expect(refusedWith([fxCell({ ablation: { map: CC_MAP, map_sha256: 'f'.repeat(64), layers: [] } })])).toBe(`HE-PREREG-007 cell cc-style: ablation ablation map ${CC_MAP} has sha256 ${CC_SHA}, not the bound ${'f'.repeat(64)}`);
    expect(refusedWith([fxCell({ ablation: { map: 'harnesses/ablation/none.layers.json', map_sha256: CC_SHA, layers: [] } })])).toBe('HE-PREREG-007 cell cc-style: ablation map harnesses/ablation/none.layers.json not found');
    const hermes = MANIFEST.maps.find((m) => m.file === 'hermes.anthropic-messages.layers.json')!;
    expect(refusedWith([fxCell({ harness: 'hermes', ablation: { map: 'harnesses/ablation/' + hermes.file, map_sha256: hermes.sha256, layers: ['identity'] } })])).toContain('ablation layers ["identity"] are not layers of');
    expect(refusedWith([fxCell({ harness: 'openclaw' })])).toBe(`HE-PREREG-007 cell cc-style: ablation map ${CC_MAP} is for claude-code on claude-opus-5-5 over anthropic-messages, not this cell's openclaw on anthropic:claude-opus-5-5 over anthropic-messages`);
    expect(refusedWith([fxCell({ model: 'anthropic:claude-sonnet-5-5' })])).toContain("not this cell's claude-code on anthropic:claude-sonnet-5-5");
    expect(refusedWith([fxCell({ slice: 'smoke', tasks: ['x'] })])).toBe('HE-PREREG-007 cell cc-style: ablation runs on multi-user harness cells only (slice smoke, harness_mode docker)');
    expect(refusedWith([fxCell({ ablation: { map: CC_MAP, layers: [] } as unknown as AblationSpec })])).toContain('ablation must be {"map": <layer map path>, "map_sha256": <its sha256>, "layers": [<layer>, ...]}');
    expect(refusedWith([fxCell({ ablation: { map: CC_MAP, map_sha256: CC_SHA, layers: ['style', 'style'] } })])).toBe('HE-PREREG-007 cell cc-style: ablation ablation layers name a layer twice');
  });

  test("a declared housekeeping model plans; the cell's own model in utility_models, or utility_models inside ablation, is refused", () => {
    expect(refusedWith([fxCell({ utility_models: ['anthropic:claude-haiku-5-5'] })])).toBe('planned');
    expect(refusedWith([fxCell({ utility_models: ['anthropic:claude-opus-5-5'] })])).toBe("HE-PREREG-007 cell cc-style: ablation cannot run with the cell's own model anthropic:claude-opus-5-5 in utility_models: the filter passes housekeeping requests through untouched");
    expect(refusedWith([fxCell({ ablation: { map: CC_MAP, map_sha256: CC_SHA, layers: [], utility_models: ['anthropic:claude-haiku-5-5'] } })])).toContain('ablation must be {"map"');
  });
});

describe('a process-mode trial through the proxy with the filter bound', () => {
  test('the slot is bound with the map, the run writes ablation.ndjson, the trial copies its lines and records ablation and cache writes', async () => {
    const cc = CORPUS.find((r) => r.map === 'claude-code.anthropic-messages.layers.json')!;
    const bodyFile = join(tmp, 'cc-body.json');
    writeFileSync(bodyFile, JSON.stringify(cc.body));
    const seen: string[] = [];
    const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (req) => { seen.push(await req.text()); return Response.json({ usage: { input_tokens: 100, output_tokens: 5, cache_creation_input_tokens: 50 } }); } });
    const adapter = join(tmp, 'ablation-adapter.ts');
    writeFileSync(adapter, `
      import { readFileSync } from 'node:fs';
      const body = readFileSync(${JSON.stringify(bodyFile)}, 'utf8');
      const send = (b: string) => fetch(process.env.HE_MODEL_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.HE_MODEL_API_KEY! }, body: b }).then((r) => r.text());
      await send(body);
      await send(body);
      await send(JSON.stringify({ ...JSON.parse(body), system: [{ type: 'text', text: 'a side call' }] }));
      await import(${JSON.stringify(join(FIXTURES, 'serve-adapter.ts'))});
    `);
    try {
      const { manifest, manifestPath, dir } = planCells([fxCell({ harness_mode: 'process', adapter, tasks: ['fx-leak'] })]);
      const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
      const result = await executeRun(manifest, manifestPath, { harnessMode: 'process', preamblePath: join(FIXTURES, 'preamble.md'), grade, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, maxOutputTokens: 128_000, leaseUsd: 50,
        proxyEnv: { PATH: process.env.PATH, HOME: process.env.HOME }, capture: { upstream: { anthropic: `http://127.0.0.1:${fake.port}` }, dns: null } });
      const rec = result.records[0]!;
      const removed = ablate(loadBinding(specFor('claude-code.anthropic-messages.layers.json', ['style'])), '/v1/messages', structuredClone(cc.body)).removed_bytes;
      expect(removed).toBeGreaterThan(0);
      expect(rec.ablation).toEqual({ layers: ['style'], map: CC_MAP, map_sha256: CC_SHA, wire: 'anthropic-messages', agent_requests: 2, matched_requests: 2, removed_bytes: 2 * removed, did_not_take: 0, partial: 0, unknown_families: 1, unstable_filter: false });
      expect(rec.usage!.cache_write_tokens).toBe(150);
      const trialLines = readFileSync(rec.paths.ablation!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as AblationReceipt);
      expect(trialLines.map((l) => [l.key, l.family, l.layers_matched])).toEqual([[trialKey(rec.trial_id), 'agent', ['style']], [trialKey(rec.trial_id), 'agent', ['style']], [trialKey(rec.trial_id), null, []]]);
      expect(readFileSync(join(dir, 'ablation.ndjson'), 'utf8')).toBe(readFileSync(rec.paths.ablation!, 'utf8'));
      expect(seen.length).toBe(3);
      expect(bytes(JSON.stringify(cc.body)) - bytes(seen[0]!)).toBeGreaterThanOrEqual(removed);
    } finally { fake.stop(true); }
  }, 60_000);

  test("the slot is bound with the cell's utility_models: a housekeeping request is forwarded untouched and counted apart from agent and unknown requests", async () => {
    const cc = CORPUS.find((r) => r.map === 'claude-code.anthropic-messages.layers.json')!;
    const agentBody = JSON.stringify(cc.body);
    const hkInFamily = JSON.stringify({ ...cc.body, model: 'claude-haiku-5-5' });
    const hkSide = JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 50, system: [{ type: 'text', text: 'Write a short title.' }], messages: [{ role: 'user', content: 'hello' }] });
    const files = [agentBody, hkInFamily, hkSide].map((b, i) => { const f = join(tmp, `hk-body-${i}.json`); writeFileSync(f, b); return f; });
    const seen: string[] = [];
    const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (req) => { seen.push(await req.text()); return Response.json({ usage: { input_tokens: 100, output_tokens: 5 } }); } });
    const adapter = join(tmp, 'hk-adapter.ts');
    writeFileSync(adapter, `
      import { readFileSync } from 'node:fs';
      for (const f of ${JSON.stringify(files)}) await fetch(process.env.HE_MODEL_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.HE_MODEL_API_KEY! }, body: readFileSync(f, 'utf8') }).then((r) => r.text());
      await import(${JSON.stringify(join(FIXTURES, 'serve-adapter.ts'))});
    `);
    try {
      const { manifest, manifestPath } = planCells([fxCell({ harness_mode: 'process', adapter, tasks: ['fx-leak'], utility_models: ['anthropic:claude-haiku-5-5'] })]);
      const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
      const result = await executeRun(manifest, manifestPath, { harnessMode: 'process', preamblePath: join(FIXTURES, 'preamble.md'), grade, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, maxOutputTokens: 128_000, leaseUsd: 50,
        proxyEnv: { PATH: process.env.PATH, HOME: process.env.HOME }, capture: { upstream: { anthropic: `http://127.0.0.1:${fake.port}` }, dns: null } });
      const rec = result.records[0]!;
      const removed = ablate(loadBinding(specFor('claude-code.anthropic-messages.layers.json', ['style'])), '/v1/messages', structuredClone(cc.body)).removed_bytes;
      expect(rec.termination).toBe('completed');
      expect(rec.ablation).toEqual({ layers: ['style'], map: CC_MAP, map_sha256: CC_SHA, wire: 'anthropic-messages', agent_requests: 1, matched_requests: 1, removed_bytes: removed, did_not_take: 0, partial: 0, unknown_families: 0, housekeeping_requests: 2, unstable_filter: false });
      expect(Object.keys(rec.usage!.by_model).sort()).toEqual(['anthropic:claude-haiku-5-5', 'anthropic:claude-opus-5-5']);
      expect(seen.length).toBe(3);
      expect(JSON.parse(seen[1]!)).toEqual(JSON.parse(hkInFamily));
      expect(JSON.parse(seen[2]!)).toEqual(JSON.parse(hkSide));
      const lines = readFileSync(rec.paths.ablation!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as AblationReceipt);
      expect(lines.map((l) => [l.family, l.kind, l.unknown_family])).toEqual([['agent', 'agent-turn', false], ['housekeeping', 'utility', false], ['housekeeping', 'utility', false]]);
    } finally { fake.stop(true); }
  }, 60_000);

  test('a run proxy started without the receipt log refuses an ablation bind', async () => {
    const proxy = await RunProxy.start({ runId: 'abl-noflag', runDir: join(tmp, 'noflag'), ledgerPath: join(tmp, 'noflag', 'ledger.sqlite'), leaseUsd: 1, allowModels: [], reachableFromContainers: false, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    try {
      expect(proxy.ablationLog).toBeNull();
      expect(proxy.ablationLines('k')).toEqual([]);
      await expect(proxy.bind('s', 'k', 'tok', undefined, specFor('hermes.anthropic-messages.layers.json', ['style']))).rejects.toThrow(/metering proxy \/__proxy\/bind answered HTTP 400: .*bind ablation needs a lease proxy started with --ablation-log/);
    } finally { await proxy.stop(); }
  }, 30_000);
});

describe('merge-shards', () => {
  test("keeps TrialRecord.ablation and copies each shard's ablation.ndjson under its name", () => {
    const manifest = { schema_version: 1, run_id: 'abl-merge', prereg_sha256: 'x', created_at: '2026-10-31T00:00:00Z', cells: [], trials: [{ id: 'abl-merge/a/t/r1', cell: 'a' }, { id: 'abl-merge/b/t/r1', cell: 'b' }] };
    const ablation = { layers: ['style'], map: CC_MAP, map_sha256: CC_SHA, wire: 'anthropic-messages', agent_requests: 3, matched_requests: 3, removed_bytes: 10, did_not_take: 0, partial: 0, unknown_families: 0, unstable_filter: false };
    const shards = ['s1', 's2'].map((name, i) => {
      const d = join(tmp, 'merge', name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(d, 'trials.jsonl'), JSON.stringify({ trial_id: manifest.trials[i]!.id, cell: manifest.trials[i]!.cell, ablation }) + '\n');
      writeFileSync(join(d, 'ablation.ndjson'), JSON.stringify({ key: name }) + '\n');
      return { name, dir: d };
    });
    const out = join(tmp, 'merge', 'out');
    mergeShards(out, shards);
    const rows = readFileSync(join(out, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as TrialRecord);
    expect(rows.map((r) => r.ablation)).toEqual([ablation, ablation] as TrialRecord['ablation'][]);
    expect(['s1', 's2'].map((n) => readFileSync(join(out, `${n}.ablation.ndjson`), 'utf8'))).toEqual(['{"key":"s1"}\n', '{"key":"s2"}\n']);
  });
});

describe('scripts/ubicloud/run-shard.sh --pre-smoke', () => {
  function lane(args: string[], preExit = 0) {
    const dir = mkdtempSync(join(tmpdir(), 'he-ablation-lane-'));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
    for (const f of ['run-shard.sh', 'ablation-golden.sh']) writeFileSync(join(repo, 'scripts', f), readFileSync(join(ROOT, 'scripts', f)));
    for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts']) writeFileSync(join(repo, 'scripts', 'ubicloud', f), readFileSync(join(ROOT, 'scripts', 'ubicloud', f)));
    const g = (...a: string[]) => spawnSync('git', a, { cwd: repo, stdio: 'ignore' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
    const calls = join(dir, 'calls.log');
    writeFileSync(join(dir, 'ubi-runner.sh'), [
      'cmd=$1; shift',
      'printf "%s\\n" "$cmd $*" >> "' + calls + '"',
      'case "$cmd" in',
      '  up) echo vm1 ;;',
      '  owner) echo fake-owner ;;',
      '  ssh) shift; case "$1" in',
      '    *"bash -l scripts/ablation-golden.sh"*) echo "ablation-golden: fake check"; exit ' + preExit + ' ;;',
      '    *"cat ~/shard/exit"*) cat > /dev/null; echo 0; echo "::trials 0" ;;',
      '    *) cat > /dev/null ;;',
      '  esac ;;',
      '  *) cat > /dev/null 2>&1 < /dev/null || true ;;',
      'esac',
    ].join('\n'));
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'lane-test', cells: [] }));
    const dest = join(dir, 'dest');
    const env = { PATH: process.env.PATH ?? '', HOME: dir, UBI_RUNNER: join(dir, 'ubi-runner.sh'), UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: 'placeholder', ANTHROPIC_API_KEY: 'placeholder' };
    const base = ['--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'c1', '--lease-usd', '7', '--dest', dest, '--poll-seconds', '1'];
    const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), ...base, ...args], { encoding: 'utf8', timeout: 60_000, env });
    const log = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
    const laneLog = existsSync(join(dest, 'lane.log')) ? readFileSync(join(dest, 'lane.log'), 'utf8') : '';
    const shardVm = existsSync(join(dest, 'shard-vm.json')) ? JSON.parse(readFileSync(join(dest, 'shard-vm.json'), 'utf8')) : {};
    rmSync(dir, { recursive: true, force: true });
    return { code: r.status, err: r.stderr, log, laneLog, shardVm };
  }
  const at = (log: string[], needle: string) => log.findIndex((l) => l.includes(needle));

  test('off unless named: no check runs and the lane launches as before', () => {
    const r = lane([]);
    expect(r.code).toBe(0);
    expect(at(r.log, 'ablation-golden')).toBe(-1);
    expect(at(r.log, 'bash ~/shard/bin/launch.sh')).toBeGreaterThan(-1);
  });

  test('a passing check runs after bootstrap and before the keys and the launch', () => {
    const r = lane(['--pre-smoke', 'scripts/ablation-golden.sh']);
    expect(r.code).toBe(0);
    const pre = at(r.log, 'bash -l scripts/ablation-golden.sh');
    expect(pre).toBeGreaterThan(at(r.log, 'bootstrap.sh'));
    expect(pre).toBeLessThan(at(r.log, 'cat > ~/.ubirun-env'));
    expect(pre).toBeLessThan(at(r.log, 'bash ~/shard/bin/launch.sh'));
    expect(r.laneLog).toContain('ablation-golden: fake check');
    expect(r.laneLog).toContain('pre-smoke scripts/ablation-golden.sh passed');
  });

  test('a failing check ends the lane with exit 4: no key reaches the VM, no smoke or trial runs, the VM is destroyed', () => {
    const r = lane(['--pre-smoke', 'scripts/ablation-golden.sh'], 4);
    expect(r.code).toBe(4);
    expect(at(r.log, 'cat > ~/.ubirun-env')).toBe(-1);
    expect(at(r.log, 'launch.sh')).toBe(-1);
    expect(at(r.log, 'down vm1')).toBeGreaterThan(at(r.log, 'bash -l scripts/ablation-golden.sh'));
    expect(r.shardVm).toMatchObject({ exit: 4, cleanup: 'done' });
    expect(r.laneLog).toContain('pre-smoke scripts/ablation-golden.sh failed (exit 4); no smoke and no trial ran');
  });

  test('a path outside scripts/, not at the commit, or with --attach is refused before any VM', () => {
    for (const [args, msg] of [
      [['--pre-smoke', '../x.sh'], '--pre-smoke must be a .sh file under scripts/'],
      [['--pre-smoke', 'scripts/../../x.sh'], '--pre-smoke must be a .sh file under scripts/'],
      [['--pre-smoke', 'scripts/nope.sh'], '--pre-smoke scripts/nope.sh is not in the repository at'],
      [['--attach', '--pre-smoke', 'scripts/ablation-golden.sh'], '--pre-smoke applies only to a new harness shard'],
    ] as Array<[string[], string]>) {
      const r = lane(args);
      expect(r.code).toBe(2);
      expect(r.err).toContain(msg);
      expect(at(r.log, 'up ')).toBe(-1);
    }
  });
});

// ---- the docker golden block -------------------------------------------------------------------------------------

/** HE_DOCKER=always (the flag scripts/ubicloud/docker-applies.sh reads) and a docker daemon; HE_ABLATION_GOLDEN_OUT keeps the
 *  runs (scripts/ablation-golden.sh sets it) and HE_ABLATION_GOLDEN_MAPS narrows the maps (comma-separated map files). */
const GOLDEN = process.env.HE_DOCKER === 'always' && spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const GOLDEN_OUT = process.env.HE_ABLATION_GOLDEN_OUT ?? join(tmp, 'golden');
const GOLDEN_MAPS = process.env.HE_ABLATION_GOLDEN_MAPS ? process.env.HE_ABLATION_GOLDEN_MAPS.split(',').filter(Boolean) : MANIFEST.maps.map((m) => m.file);
const GOLDEN_TASK = 'si-01-marrow-agrisupply-site';
const GOLDEN_ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };

async function waitFor(ok: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (ok()) return; await Bun.sleep(200); }
  throw new Error(`timed out waiting for ${what}`);
}

/** One keyless capture-mode run of one cell (the map's harness, model and wire) on the v0.3 task with two turns, the fake playing
 *  capture.ts's tools scenario (tool calls, then text, so the first turn has a tool-call follow-up) unless a script is given. */
async function goldenRun(m: (typeof MANIFEST.maps)[number], layers: string[], label: string, script: unknown[] = SCENARIOS.tools!(m.harness)): Promise<{ record: TrialRecord; requests: Array<{ route: string; body: Record<string, any> }>; embeddings: number }> {
  const provider = m.wire === 'anthropic-messages' ? 'anthropic' : 'openai';
  const out = join(GOLDEN_OUT, `${m.harness}.${m.wire}.${label}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'script.json'), JSON.stringify(script));
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  const fakeOut = openSync(join(out, 'fake.out'), 'a');
  const fake = spawn(process.execPath, [join(ROOT, provider === 'anthropic' ? 'scripts/gsta-135/fake-anthropic.ts' : 'tests/fixtures/fake-responses.ts'), '--host', '127.0.0.1', '--port', String(port),
    '--log', join(out, 'fake.ndjson'), '--script', join(out, 'script.json'), '--require-key-prefix', CAPTURE_DUMMY_KEYS[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'], '--max-requests', '200', '--max-seconds', '1500'],
    { env: GOLDEN_ENV, stdio: ['ignore', fakeOut, fakeOut] });
  try {
    await waitFor(() => readFileSync(join(out, 'fake.out'), 'utf8').includes('listening'), 20_000, 'the fake model endpoint');
    const cell = { id: `${m.harness}-${label}`, harness: m.harness, model: `${provider}:${m.model}`, slice: 'multiuser', split: 'dev', task_set: 'v0.3', tasks: [GOLDEN_TASK], repetitions: 1,
      ceiling: { input_tokens: 200_000, output_tokens: 128_000 }, ...(m.harness === 'codex' ? { network: 'internal' } : {}), ablation: { map: `harnesses/ablation/${m.file}`, map_sha256: m.sha256, layers } };
    const runId = `anatomy-capture-ablation-golden-${m.harness}-${m.wire}-${label}`;
    writeFileSync(join(out, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: runId, question: 'internal-task ablation golden check: uncounted and keyless, against a fake model endpoint', tasks: {}, cells: [cell], wall_clock_s: { multiuser: 3600 }, spend_cap_usd: 5, drop_order: [], minimum_v01: [] }, null, 1));
    const runDir = join(out, 'run');
    const plan = spawnSync(process.execPath, ['runner/run.ts', 'plan', '--prereg', join(out, 'prereg.json'), '--out', runDir], { cwd: ROOT, env: GOLDEN_ENV, encoding: 'utf8' });
    writeFileSync(join(out, 'plan.log'), plan.stdout + plan.stderr);
    expect({ label, plan: plan.status, out: plan.status ? plan.stdout + plan.stderr : '' }).toEqual({ label, plan: 0, out: '' });
    const run = spawnSync(process.execPath, ['runner/run.ts', 'run', '--manifest', join(runDir, 'manifest.json'), '--lease-usd', '5', '--new-lease', '--max-output-tokens', '128000', '--capture-upstream', `${provider}=http://127.0.0.1:${port}`],
      { cwd: ROOT, env: GOLDEN_ENV, encoding: 'utf8', timeout: 1_500_000 });
    writeFileSync(join(out, 'run.log'), (run.stdout ?? '') + (run.stderr ?? ''));
    expect({ label, run: run.status, tail: run.status ? (run.stderr ?? '').slice(-1500) : '' }).toEqual({ label, run: 0, tail: '' });
    const record = JSON.parse(readFileSync(join(runDir, 'trials.jsonl'), 'utf8').trim().split('\n')[0]!) as TrialRecord;
    const requests = parseLog(readFileSync(join(out, 'fake.ndjson'), 'utf8')).flatMap((r) => {
      const route = r.path.match(/\/v1\/(messages|responses)$/)?.[0];
      return r.method === 'POST' && route ? [{ route, body: r.body as Record<string, any> }] : [];
    });
    const lines = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { path?: string; route?: string }) : [];
    const embeddings = [...lines(join(out, 'fake.ndjson')), ...lines(join(runDir, 'proxy-usage.ndjson'))].filter((l) => (l.path ?? l.route ?? '').includes('/embeddings')).length;
    return { record, requests, embeddings };
  } finally { fake.kill('SIGTERM'); }
}

describe.skipIf(!GOLDEN)('docker golden: every map through its harness image against the fake endpoint, full and minimal, two turns and a tool-call follow-up', () => {
  for (const m of MANIFEST.maps.filter((x) => GOLDEN_MAPS.includes(x.file))) {
    test(`${m.file}`, async () => {
      const full = await goldenRun(m, [], 'full');
      const min = await goldenRun(m, allLayers(m.file), 'minimal');
      for (const [label, g] of [['full', full], ['minimal', min]] as const) {
        const a = g.record.ablation!;
        expect({ label, termination: g.record.termination, error: g.record.error ?? null }).toEqual({ label, termination: 'completed', error: null });
        expect({ label, matched: a.matched_requests, did_not_take: a.did_not_take, partial: a.partial, unknown: a.unknown_families, unstable: a.unstable_filter, invalid: a.invalid_reason ?? null })
          .toEqual({ label, matched: a.agent_requests, did_not_take: 0, partial: 0, unknown: 0, unstable: false, invalid: null });
        expect({ label, agent_requests_at_least_3: a.agent_requests >= 3, forwarded: g.requests.length, removed: a.removed_bytes > 0 }).toEqual({ label, agent_requests_at_least_3: true, forwarded: a.agent_requests, removed: label === 'minimal' });
        // internal-task: OpenClaw on an OpenAI cell searches memory by keyword only (memory.search.provider none), so no /v1/embeddings call reaches the proxy or the fake.
        if (m.harness === 'openclaw' && m.wire === 'openai-responses') expect({ label, embeddings: g.embeddings }).toEqual({ label, embeddings: 0 });
      }
      expect(min.requests.length).toBe(full.requests.length);
      const again = loadBinding(specFor(m.file, allLayers(m.file)));
      const definitions = (body: Record<string, any>) => units(body, m.wire).filter((u) => u.loc.kind === 'tool_definition').map((u) => u.text);
      full.requests.forEach((f, i) => {
        const n = min.requests[i]!;
        expect({ i, definitions: definitions(n.body) }).toEqual({ i, definitions: definitions(f.body) });
        expect({ i, removed_again: ablate(again, n.route, structuredClone(n.body)).removed_bytes }).toEqual({ i, removed_again: 0 });
      });
      if (m.harness !== 'hermes') return;
      // Persisted memory: turn 1 writes MEMORY.md and USER.md through Hermes's own memory tool, so turn 2's fresh hermes process
      // loads them into its system prompt between the skill index and "Conversation started:". Minimal must still match every
      // request, keep the memory text and name it as an insert after the skill index.
      const note = 'Marrow Agrisupply site work: the staging host is staging.marrow.example and deploys go through the #ops channel.';
      const mem = await goldenRun(m, allLayers(m.file), 'minimal-memory', [
        { call: 'memory', arguments: { action: 'add', target: 'memory', content: note } },
        { call: 'memory', arguments: { action: 'add', target: 'user', content: 'Dana prefers short status updates and wants links to every changed page.' } },
        { text: 'noted' },
      ]);
      const a = mem.record.ablation!;
      expect({ termination: mem.record.termination, matched: a.matched_requests, did_not_take: a.did_not_take, partial: a.partial, unknown: a.unknown_families })
        .toEqual({ termination: 'completed', matched: a.agent_requests, did_not_take: 0, partial: 0, unknown: 0 });
      const index = MAPS.get(m.file)!.families[0]!.spans.find((s) => s.anchor === '<available_skills>')!;
      const receipts = readFileSync(mem.record.paths.ablation!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as AblationReceipt);
      expect(receipts.some((x) => x.inserts.length === 1 && x.inserts[0]!.span === index.id)).toBe(true);
      const system = (body: Record<string, any>) => systemBlocks(body, m.wire).map((b) => b.text).join('');
      const last = system(mem.requests[mem.requests.length - 1]!.body);
      expect({ memory: last.includes('MEMORY (your personal notes)') && last.includes(note), skill_index: last.includes('<available_skills>') }).toEqual({ memory: true, skill_index: false });
    }, 3_600_000);
  }
});

describe('scripts/ablation-golden.sh docker-group re-exec', () => {
  function reexec(args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'he-ablation-sg-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const seen = join(dir, 'sg.log');
    const stub = (name: string, body: string) => { writeFileSync(join(bin, name), '#!/bin/sh\n' + body + '\n'); spawnSync('chmod', ['+x', join(bin, name)]); };
    stub('getent', 'exit 0');
    stub('id', 'case "$1" in -un) echo u ;; -nG) [ -n "$2" ] && echo "u docker" || echo u ;; esac');
    stub('sg', 'printf "%s" "$3" > "' + seen + '"');
    const r = spawnSync('bash', [join(ROOT, 'scripts', 'ablation-golden.sh'), ...args], { cwd: dir, env: { PATH: bin + ':/usr/bin:/bin', HOME: dir, USER: 'u' }, encoding: 'utf8' });
    return { status: r.status, cmd: readFileSync(seen, 'utf8') };
  }

  test('with no arguments the re-exec passes no empty argument', () => {
    const r = reexec([]);
    expect(r.status).toBe(0);
    expect(r.cmd).toBe('bash ' + join(ROOT, 'scripts', 'ablation-golden.sh'));
  });

  test('arguments survive the re-exec quoted', () => {
    const r = reexec(['--maps', 'a.layers.json,b.layers.json', '--skip-build']);
    expect(r.cmd).toBe('bash ' + join(ROOT, 'scripts', 'ablation-golden.sh') + ' --maps a.layers.json\\,b.layers.json --skip-build ');
  });
});

