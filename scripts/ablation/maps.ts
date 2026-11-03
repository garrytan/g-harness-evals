// Layer maps for prompt archaeology: the request surfaces a map may
// address, how a map's spans are found in a request body, and the subset of
// JSON Schema the maps use. scripts/ablation/gen-anchors.ts generates span
// candidates with it, scripts/ablation/settle.ts writes the maps, and
// tests/ablation-maps.test.ts checks every captured request against them.
//
// A unit is one piece of harness text a map may address: an Anthropic system
// block, the Responses instructions, one content part of a harness-injected
// message (role system or developer, or a user-role part that is not the
// eval's task message and not in a tool-result turn), the description of one
// tool, or one tool's definition without its description (name and parameter
// schema). User turns, tool results, function_call_output and
// custom_tool_call_output items are never units, so no span can address them.
//
// Spans inside a unit are found in order by their anchors: the first span
// starts at byte 0, each later span starts at the first line-start match of
// its anchor after the previous span's anchor, and every span ends where the
// next one starts. A span that may be absent (presence "when_present") is
// skipped when its anchor is not found.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Wire } from '../anatomy/dissect.ts';

export const ROOT = resolve(import.meta.dir, '../..');
export const LAYERS = ['identity', 'tool-guide', 'tool-descriptions', 'safety', 'memory-skills', 'work-habits', 'style'] as const;
export const NEVER_REMOVED = ['protocol-and-discovery', 'runtime-environment'] as const;
export type Layer = (typeof LAYERS)[number];
export type NeverRemoved = (typeof NEVER_REMOVED)[number];
export type Label = Layer | NeverRemoved;

export type Location =
  | { kind: 'system_block'; index: number }
  | { kind: 'instructions' }
  | { kind: 'message'; role: 'system' | 'developer' | 'user'; ordinal: number | 'any'; part: number }
  | { kind: 'tool_description'; tool: string; namespace?: string }
  | { kind: 'additional_tool'; namespace: string; tool: string }
  | { kind: 'tool_definition'; tool: string; namespace?: string; additional?: true };

export interface Unit { loc: Location; text: string; world_tool?: true }
export interface Paragraph { anchor: string; layer?: Layer; never_removed?: NeverRemoved; bytes: { min: number; max: number }; candidates: string[] }
export interface Span {
  id: string;
  unit: string;
  location: Location;
  anchor?: string;
  section: string;
  presence: 'always' | 'when_present';
  bytes: { min: number; max: number };
  text_sha256?: string;
  layer?: Layer;
  never_removed?: NeverRemoved;
  paragraphs?: Paragraph[];
  candidates: string[];
}
export interface Family { id: string; kind: 'agent-turn' | 'compaction' | 'subagent' | 'utility' | 'side'; fingerprint: { path_suffix: string; has_tools: boolean; system_prefix: string }; requests_seen: number; spans: Span[] }
export interface LayerMap { schema: 'harness-ablation-layers/1'; harness: string; wire: Wire; model: string; families: Family[]; [k: string]: unknown }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const byteLen = (s: string) => Buffer.byteLength(s, 'utf8');

/** The first line of the eval's shared preamble; a user-role part holding it is the eval's task message. */
export const EVAL_MARKER = readFileSync(join(ROOT, 'tasks/multiuser/_shared/preamble.md'), 'utf8').split('\n')[0]!.slice(0, 48);

/** The world MCP server's tool names (world/world-mcp/tools.ts). Their definitions belong to the eval, not the harness. */
export const WORLD_TOOLS = new Set([...readFileSync(join(ROOT, 'world/world-mcp/tools.ts'), 'utf8').matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]!));
export const isWorldTool = (name: string) => { const m = name.match(/^(?:mcp__world__|mcp_world_|world__|world_)(.+)$/); return !!m && WORLD_TOOLS.has(m[1]!); };

/** Text parts of a message's content: a string is part 0; an array keeps its indices, text parts only. */
function parts(content: unknown): Array<{ part: number; text: string }> {
  if (typeof content === 'string') return [{ part: 0, text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((c, part) => (isObj(c) && typeof c.text === 'string' && (c.type === 'text' || c.type === 'input_text' || c.type === undefined) ? [{ part, text: c.text }] : []));
}

const toolResultTurn = (m: Obj) => Array.isArray(m.content) && m.content.some((c) => isObj(c) && (c.type === 'tool_result' || c.type === 'function_call_output'));

function toolUnits(list: unknown[], additional: boolean, namespace?: string): Unit[] {
  const out: Unit[] = [];
  for (const t of list) {
    if (!isObj(t)) continue;
    if (t.type === 'namespace' && Array.isArray(t.tools)) { out.push(...toolUnits(t.tools, additional, String(t.name ?? ''))); continue; }
    const fn = isObj(t.function) ? t.function : null;
    const name = String(t.name ?? fn?.name ?? t.type ?? '');
    const description = typeof t.description === 'string' ? t.description : typeof fn?.description === 'string' ? fn.description : null;
    const world = isWorldTool(name) ? { world_tool: true as const } : {};
    const ns = namespace !== undefined ? { namespace } : {};
    if (description !== null) out.push({ loc: additional ? { kind: 'additional_tool', namespace: namespace ?? '', tool: name } : { kind: 'tool_description', tool: name, ...ns }, text: description, ...world });
    const def = fn ? { ...t, function: { ...fn, description: undefined } } : { ...t, description: undefined };
    out.push({ loc: { kind: 'tool_definition', tool: name, ...ns, ...(additional ? { additional: true as const } : {}) }, text: JSON.stringify(def), ...world });
  }
  return out;
}

/** Every unit of one request body, in request order: system, injected messages, then tools. */
export function units(body: unknown, wire: Wire): Unit[] {
  if (!isObj(body)) return [];
  const out: Unit[] = [];
  const seen: Record<string, number> = {};
  const message = (m: Obj) => {
    const role = m.role as 'system' | 'developer' | 'user';
    const ordinal = seen[role] = (seen[role] ?? -1) + 1;
    if (role !== 'system' && role !== 'developer' && role !== 'user') return;
    if (role === 'user' && toolResultTurn(m)) return;
    for (const p of parts(m.content)) {
      if (role === 'user' && p.text.includes(EVAL_MARKER)) continue;
      if (p.text === '') continue;
      out.push({ loc: { kind: 'message', role, ordinal, part: p.part }, text: p.text });
    }
  };
  if (wire === 'anthropic-messages') {
    if (typeof body.system === 'string') out.push({ loc: { kind: 'system_block', index: 0 }, text: body.system });
    else if (Array.isArray(body.system)) body.system.forEach((b, index) => { if (isObj(b) && typeof b.text === 'string') out.push({ loc: { kind: 'system_block', index }, text: b.text }); });
    if (Array.isArray(body.messages)) for (const m of body.messages) if (isObj(m)) message(m);
    if (Array.isArray(body.tools)) out.push(...toolUnits(body.tools, false));
    return out;
  }
  if (typeof body.instructions === 'string' && body.instructions !== '') out.push({ loc: { kind: 'instructions' }, text: body.instructions });
  const input = Array.isArray(body.input) ? body.input : [];
  for (const m of input) if (isObj(m) && (m.type === undefined || m.type === 'message') && typeof m.role === 'string') message(m);
  if (Array.isArray(body.tools)) out.push(...toolUnits(body.tools, false));
  for (const m of input) if (isObj(m) && m.type === 'additional_tools' && Array.isArray(m.tools)) out.push(...toolUnits(m.tools, true));
  return out;
}

/** A stable key for a location; message keys leave the ordinal out (it is matched separately). */
export function locKey(l: Location): string {
  switch (l.kind) {
    case 'system_block': return `system[${l.index}]`;
    case 'instructions': return 'instructions';
    case 'message': return `message:${l.role}.part[${l.part}]`;
    case 'tool_description': return `tool:${l.namespace ? l.namespace + '/' : ''}${l.tool}`;
    case 'additional_tool': return `additional_tool:${l.namespace}/${l.tool}`;
    case 'tool_definition': return `definition:${l.additional ? 'additional/' : ''}${l.namespace ? l.namespace + '/' : ''}${l.tool}`;
  }
}

/** Byte offset of the first line-start match of anchor in buf at or after from, or -1. */
export function findAnchor(buf: Buffer, anchor: string, from: number): number {
  const a = Buffer.from(anchor, 'utf8');
  for (let at = buf.indexOf(a, from); at >= 0; at = buf.indexOf(a, at + 1)) if (at === 0 || buf[at - 1] === 0x0a) return at;
  return -1;
}

/** Start offsets of an ordered anchor list in text: null for an absent optional anchor; throws when a required one is missing or the first is not at 0. */
export function resolveAnchors(text: string, list: Array<{ anchor?: string; presence: 'always' | 'when_present' }>): Array<number | null> {
  const buf = Buffer.from(text, 'utf8');
  const out: Array<number | null> = [];
  let cursor = 0;
  let first = true;
  for (const s of list) {
    const at = s.anchor === undefined ? (first ? 0 : -1) : first ? (buf.subarray(0, byteLen(s.anchor)).toString('utf8') === s.anchor ? 0 : -1) : findAnchor(buf, s.anchor, cursor);
    if (at < 0) {
      if (s.presence === 'always') throw new Error(`anchor ${JSON.stringify((s.anchor ?? '').slice(0, 60))} not found${first ? ' at byte 0' : ` after byte ${cursor}`}`);
      out.push(null);
      continue;
    }
    out.push(at);
    cursor = at + Math.max(1, byteLen(s.anchor ?? ''));
    first = false;
  }
  return out;
}

export interface Assigned { span: string; label: Label; start: number; bytes: number }

/** The spans of a family that address one unit, in map order: same location, and for messages the ordinal (or "any") and the first anchor at byte 0. */
export function spansFor(family: Family, u: Unit): Span[] {
  const key = locKey(u.loc);
  const group = family.spans.filter((s) => locKey(s.location) === key);
  if (u.loc.kind !== 'message') return group;
  const ord = u.loc.ordinal;
  const byUnit = new Map<string, Span[]>();
  for (const s of group) (byUnit.get(s.unit) ?? byUnit.set(s.unit, []).get(s.unit)!).push(s);
  const fits = [...byUnit.values()].filter((g) => { const o = (g[0]!.location as { ordinal: number | 'any' }).ordinal; return (o === 'any' || o === ord) && g[0]!.anchor !== undefined && u.text.startsWith(g[0]!.anchor); });
  if (fits.length > 1) throw new Error(`${key}: more than one span group starts this message`);
  return fits[0] ?? [];
}

/** Assigns every byte of a unit to one label, or throws. */
export function assignUnit(family: Family, u: Unit): Assigned[] {
  const spans = spansFor(family, u);
  if (!spans.length) throw new Error(`no span addresses ${locKey(u.loc)}${u.loc.kind === 'message' ? ` ordinal ${u.loc.ordinal}` : ''} (${JSON.stringify(u.text.slice(0, 60))})`);
  const total = byteLen(u.text);
  const starts = resolveAnchors(u.text, spans);
  const present = spans.map((s, i) => ({ s, at: starts[i] })).filter((x): x is { s: Span; at: number } => x.at !== null);
  const out: Assigned[] = [];
  present.forEach(({ s, at }, k) => {
    const end = k + 1 < present.length ? present[k + 1]!.at : total;
    if (!s.paragraphs) { out.push({ span: s.id, label: (s.layer ?? s.never_removed)!, start: at, bytes: end - at }); return; }
    const sub = Buffer.from(u.text, 'utf8').subarray(at, end).toString('utf8');
    const ps = resolveAnchors(sub, s.paragraphs.map((p) => ({ anchor: p.anchor, presence: 'when_present' as const })));
    if (ps[0] !== 0) throw new Error(`${s.id}: first paragraph anchor is not at the span start`);
    const live = s.paragraphs.map((p, i) => ({ p, at: ps[i] })).filter((x): x is { p: Paragraph; at: number } => x.at !== null);
    live.forEach(({ p, at: pa }, j) => out.push({ span: s.id, label: (p.layer ?? p.never_removed)!, start: at + pa, bytes: (j + 1 < live.length ? live[j + 1]!.at : end - at) - pa }));
  });
  let at = 0;
  for (const a of out) { if (a.start !== at) throw new Error(`${locKey(u.loc)}: bytes ${at}..${a.start} unassigned`); at += a.bytes; }
  if (at !== total) throw new Error(`${locKey(u.loc)}: assigned ${at} of ${total} bytes`);
  return out;
}

/** The system text as dissect.ts joins it, for fingerprints. */
export function familyOf(map: LayerMap, path: string, body: unknown, systemText: string, hasTools: boolean): Family | null {
  return map.families.find((f) => path.endsWith(f.fingerprint.path_suffix) && f.fingerprint.has_tools === hasTools && systemText.startsWith(f.fingerprint.system_prefix)) ?? null;
}

/** The subset of JSON Schema layers.schema.json uses: $ref, const, enum, type, required, properties, additionalProperties, items, oneOf, minimum, minLength, pattern, not. */
export function validate(value: unknown, schema: Record<string, any>, root: Record<string, any> = schema, path = '$'): string[] {
  if (schema.$ref) return validate(value, root.$defs[schema.$ref.replace('#/$defs/', '')], root, path);
  const errors: string[] = [];
  if (schema.oneOf) {
    const ok = schema.oneOf.filter((s: Record<string, any>) => validate(value, s, root, path).length === 0).length;
    if (ok !== 1) errors.push(`${path}: matches ${ok} of oneOf`);
  }
  if (schema.not && validate(value, schema.not, root, path).length === 0) errors.push(`${path}: matches a forbidden shape`);
  if ('const' in schema && value !== schema.const) errors.push(`${path}: not ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
    const types = [schema.type].flat();
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return [...errors, `${path}: ${t} is not ${types.join('|')}`];
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  if (Array.isArray(value) && schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
  if (isObj(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validate(v, schema.properties[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${k}`);
      else if (isObj(schema.additionalProperties)) errors.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
    }
  }
  return errors;
}
