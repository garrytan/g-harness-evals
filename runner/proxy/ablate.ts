// Prompt archaeology (plan decision 1): the metering proxy's request-side layer filter. A trial slot bound with
// a layer map (harnesses/ablation/<harness>.<wire>.layers.json) and a list of layers has every span of those layers cut
// out of each request after the proxy parses it and before it injects the output cap and reserves, so the ledger
// prices the smaller body.
//
// Spans are found only by location, as scripts/ablation/maps.ts defines a unit: a system block, the Responses
// instructions, one content part of a harness-injected message (by role, ordinal and opening anchor), a tool's
// description, or a Codex additional_tools entry's description. User turns, tool results, function_call_output and
// custom_tool_call_output items are never units, so nothing in them is read or changed. A request is matched to a
// family of the map by its fingerprint; a request in no family passes through untouched and is counted.
// A request for one of the cell's declared housekeeping models (Cell.utility_models, which the runner adds to the bind;
// per the 2026-11-01 ruling: the harness's shipped default, metered and labelled, never an arm) is matched before any family:
// it passes through untouched, its receipt names the housekeeping family, and it is never an agent, did-not-take,
// partial or unknown-family request.
//
// A span is removed when its anchors resolve and its length is inside the map's byte range. Each request gets a
// receipt: its family, the layers matched, the bytes removed and the sha256 of every removed span (never its text), the
// expected spans that did not match, and whether the request is did-not-take (an expected layer matched nothing) or
// partial (some expected span missed, or a removed span's text differs from the map's). A span split into paragraphs is
// checked by each removable paragraph's own byte range only, never by the span's total length, since its kept paragraphs
// carry runtime text such as the date, the working directory and the host's OS version. A whole removable span with a
// fixed length and a text sha256 may be followed, before the next span's anchor, by a never-removed insert: text the
// trial itself wrote, such as the persisted memory Hermes puts between its skill index and "Conversation started:". The
// span's own bytes (its mapped length, ending at a line end, with the map's sha256) are removed and the insert is kept
// byte for byte and named in the receipt (bytes and sha256, never its text). This holds only when the map's next span of
// the unit is the one found right after it, so a changed anchor of a skipped span is still refused. A part, block or message left
// empty is dropped, and a cache_control mark it carried moves to the kept sibling before it when that one has none; a
// description or the instructions left empty is deleted. With no layer bound, or nothing matched, the body is untouched.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { systemBlocks } from '../../scripts/anatomy/dissect.ts';
import { EVAL_MARKER, LAYERS, type Family, type Layer, type LayerMap, type Location, type Span, familyOf, resolveAnchors, spansFor, units } from '../../scripts/ablation/maps.ts';

export type Wire = 'anthropic-messages' | 'openai-responses';
/** Wires the docker golden check (tests/ablation.test.ts, scripts/ablation-golden.sh) covers; plan refuses a cell on any other. */
export const GOLDEN_WIRES: readonly Wire[] = ['anthropic-messages', 'openai-responses'];
/** The generation routes a bound slot writes a receipt for; any other route (a model listing, embeddings) gets none. */
export const GENERATION_ROUTES: readonly string[] = ['/v1/messages', '/v1/responses', '/v1/chat/completions'];
/** The family a receipt names for a request to one of the cell's declared housekeeping models. */
export const HOUSEKEEPING_FAMILY = 'housekeeping';

/** What a cell carries and the runner sends on /__proxy/bind: the map file, its sha256 and the layers to remove. The runner
 *  adds the cell's utility_models (provider:model) at bind time; a preregistered ablation never carries them. */
export interface AblationSpec { map: string; map_sha256: string; layers: string[]; utility_models?: string[] }
export interface AblationBinding { spec: AblationSpec; map: LayerMap; layers: Layer[] }

export interface RemovedSpan { span: string; layer: Layer; bytes: number; sha256: string; unit_sha256: string }
/** One line of the run's ablation.ndjson. */
export interface AblationReceipt {
  at: string;
  key: string;
  route: string;
  map_sha256: string;
  layers: Layer[];
  family: string | null;
  kind: Family['kind'] | null;
  unknown_family: boolean;
  expected: number;
  layers_matched: Layer[];
  removed_bytes: number;
  removed: RemovedSpan[];
  /** Expected spans (span ids; a paragraph is <span id>/p<n>) that were not removed, and found spans whose length or text differs from the map. */
  missing: string[];
  changed: string[];
  /** Never-removed text kept after a removed span's own bytes, before the next span's anchor (a trial's persisted memory). */
  inserts: Array<{ span: string; bytes: number; sha256: string }>;
  /** Units the filter could not read (location kinds and reasons only, never text). */
  problems: string[];
  did_not_take: boolean;
  partial: boolean;
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const wireOfRoute = (route: string): Wire | null => (route === '/v1/messages' ? 'anthropic-messages' : route === '/v1/responses' ? 'openai-responses' : null);
/** The wire a cell's model is called on: Anthropic Messages for anthropic:, Responses for openai:. */
export const wireOfModel = (model: string): Wire | null => (model.startsWith('anthropic:') ? 'anthropic-messages' : model.startsWith('openai:') ? 'openai-responses' : null);

/** Every removable layer a map names, on spans or paragraphs. */
export function mapLayers(map: LayerMap): Set<Layer> {
  const out = new Set<Layer>();
  for (const f of map.families) for (const s of f.spans) {
    if (s.layer) out.add(s.layer);
    for (const p of s.paragraphs ?? []) if (p.layer) out.add(p.layer);
  }
  return out;
}

/** Read and check a map to bind: the file's sha256 must be the spec's, and every layer one the map names, once. Throws with the reason. */
export function loadBinding(spec: AblationSpec): AblationBinding {
  if (!isObj(spec) || typeof spec.map !== 'string' || typeof spec.map_sha256 !== 'string' || !Array.isArray(spec.layers)) throw new Error('ablation must be {map, map_sha256, layers}');
  let raw: Buffer;
  try { raw = readFileSync(spec.map); } catch { throw new Error(`ablation map ${spec.map} cannot be read`); }
  const actual = sha256(raw);
  if (actual !== spec.map_sha256) throw new Error(`ablation map ${spec.map} has sha256 ${actual}, not the bound ${spec.map_sha256}`);
  const map = JSON.parse(raw.toString('utf8')) as LayerMap;
  if (map.schema !== 'harness-ablation-layers/1' || !Array.isArray(map.families)) throw new Error(`ablation map ${spec.map} is not a harness-ablation-layers/1 map`);
  const named = mapLayers(map);
  const bad = spec.layers.filter((l) => typeof l !== 'string' || !(LAYERS as readonly string[]).includes(l) || !named.has(l as Layer));
  if (bad.length) throw new Error(`ablation layers ${JSON.stringify(bad)} are not layers of ${spec.map}, which names ${[...named].join(', ') || 'none'}`);
  if (new Set(spec.layers).size !== spec.layers.length) throw new Error('ablation layers name a layer twice');
  if (spec.utility_models !== undefined && (!Array.isArray(spec.utility_models) || spec.utility_models.some((m) => typeof m !== 'string'))) throw new Error('ablation utility_models must be a list of provider:model ids');
  return { spec, map, layers: spec.layers as Layer[] };
}

interface Editable { loc: Location; text: string; set: (text: string) => void }

/** The units of maps.ts units(), in its order, each with a setter that writes in place; a block, part or message a setter leaves empty goes into `emptied`. */
function editables(body: Record<string, any>, wire: Wire, emptied: Set<object>): Editable[] {
  const out: Editable[] = [];
  const seen: Record<string, number> = {};
  const message = (m: Record<string, any>) => {
    const role = m.role as 'system' | 'developer' | 'user';
    const ordinal = seen[role] = (seen[role] ?? -1) + 1;
    if (role !== 'system' && role !== 'developer' && role !== 'user') return;
    if (role === 'user' && Array.isArray(m.content) && m.content.some((c: unknown) => isObj(c) && (c.type === 'tool_result' || c.type === 'function_call_output'))) return;
    const keep = (t: string) => t !== '' && !(role === 'user' && t.includes(EVAL_MARKER));
    if (typeof m.content === 'string') {
      if (keep(m.content)) out.push({ loc: { kind: 'message', role, ordinal, part: 0 }, text: m.content, set: (t) => { m.content = t; if (t === '') emptied.add(m); } });
      return;
    }
    if (!Array.isArray(m.content)) return;
    m.content.forEach((c: unknown, part: number) => {
      if (!isObj(c) || typeof c.text !== 'string' || !(c.type === 'text' || c.type === 'input_text' || c.type === undefined) || !keep(c.text)) return;
      out.push({ loc: { kind: 'message', role, ordinal, part }, text: c.text, set: (t) => { c.text = t; if (t === '') emptied.add(c); } });
    });
  };
  const tools = (list: unknown[], additional: boolean, namespace?: string) => {
    for (const t of list) {
      if (!isObj(t)) continue;
      if (t.type === 'namespace' && Array.isArray(t.tools)) { tools(t.tools, additional, String(t.name ?? '')); continue; }
      const fn = isObj(t.function) ? t.function : null;
      const name = String(t.name ?? fn?.name ?? t.type ?? '');
      const holder = typeof t.description === 'string' ? t : typeof fn?.description === 'string' ? fn : null;
      const ns = namespace !== undefined ? { namespace } : {};
      if (holder) out.push({ loc: additional ? { kind: 'additional_tool', namespace: namespace ?? '', tool: name } : { kind: 'tool_description', tool: name, ...ns }, text: holder.description, set: (d) => { if (d === '') delete holder.description; else holder.description = d; } });
      const def = fn ? { ...t, function: { ...fn, description: undefined } } : { ...t, description: undefined };
      out.push({ loc: { kind: 'tool_definition', tool: name, ...ns, ...(additional ? { additional: true as const } : {}) }, text: JSON.stringify(def), set: () => { throw new Error('a tool definition is never edited'); } });
    }
  };
  if (wire === 'anthropic-messages') {
    if (typeof body.system === 'string') out.push({ loc: { kind: 'system_block', index: 0 }, text: body.system, set: (t) => { if (t === '') delete body.system; else body.system = t; } });
    else if (Array.isArray(body.system)) body.system.forEach((b: unknown, index: number) => { if (isObj(b) && typeof b.text === 'string') out.push({ loc: { kind: 'system_block', index }, text: b.text, set: (t) => { b.text = t; if (t === '') emptied.add(b); } }); });
    if (Array.isArray(body.messages)) for (const m of body.messages) if (isObj(m)) message(m);
    if (Array.isArray(body.tools)) tools(body.tools, false);
    return out;
  }
  if (typeof body.instructions === 'string' && body.instructions !== '') out.push({ loc: { kind: 'instructions' }, text: body.instructions, set: (t) => { if (t === '') delete body.instructions; else body.instructions = t; } });
  const input = Array.isArray(body.input) ? body.input : [];
  for (const m of input) if (isObj(m) && (m.type === undefined || m.type === 'message') && typeof m.role === 'string') message(m);
  if (Array.isArray(body.tools)) tools(body.tools, false);
  for (const m of input) if (isObj(m) && m.type === 'additional_tools' && Array.isArray(m.tools)) tools(m.tools, true);
  return out;
}

/** Drop the emptied entries of a list; a cache_control mark on a dropped entry moves to the nearest kept entry before it that has none. */
function compact(list: unknown[], emptied: Set<object>): unknown[] {
  const kept: unknown[] = [];
  for (const x of list) {
    if (!isObj(x) || !emptied.has(x)) { kept.push(x); continue; }
    const prev = kept[kept.length - 1];
    if (x.cache_control !== undefined && isObj(prev) && prev.cache_control === undefined) prev.cache_control = x.cache_control;
  }
  return kept;
}

/** Remove the bound layers from a parsed request body in place and return its receipt (without at and key). */
export function ablate(b: AblationBinding, route: string, body: Record<string, any>): Omit<AblationReceipt, 'at' | 'key'> {
  const receipt: Omit<AblationReceipt, 'at' | 'key'> = { route, map_sha256: b.spec.map_sha256, layers: b.layers, family: null, kind: null, unknown_family: true, expected: 0, layers_matched: [],
    removed_bytes: 0, removed: [], missing: [], changed: [], inserts: [], problems: [], did_not_take: false, partial: false };
  const wire = wireOfRoute(route);
  if (wire === null) return receipt;
  if (b.spec.utility_models?.includes(`${wire === 'anthropic-messages' ? 'anthropic' : 'openai'}:${body.model}`)) return Object.assign(receipt, { family: HOUSEKEEPING_FAMILY, kind: 'utility', unknown_family: false });
  if (wire !== b.map.wire) return receipt;
  const found = units(body, wire);
  const family = familyOf(b.map, route, body, systemBlocks(body, wire).map((x) => x.text).join(''), found.some((u) => u.loc.kind === 'tool_definition'));
  if (!family) return receipt;
  Object.assign(receipt, { family: family.id, kind: family.kind, unknown_family: false });
  const wanted = new Set<Layer>(b.layers);
  if (!wanted.size) return receipt;
  const expected = new Map<string, Layer>();
  for (const s of family.spans) {
    if (s.presence !== 'always') continue;
    if (s.layer && wanted.has(s.layer)) expected.set(s.id, s.layer);
    s.paragraphs?.forEach((p, j) => { if (p.layer && wanted.has(p.layer)) expected.set(`${s.id}/p${j}`, p.layer); });
  }
  receipt.expected = expected.size;

  const emptied = new Set<object>();
  const eds = editables(body, wire, emptied);
  const removed: RemovedSpan[] = [];
  const changed = new Set<string>();
  const inserts: AblationReceipt['inserts'] = [];
  const problems: string[] = [];
  const same = eds.length === found.length && eds.every((e, i) => JSON.stringify(e.loc) === JSON.stringify(found[i]!.loc) && e.text === found[i]!.text);
  const edits: Array<{ e: Editable; buf: Buffer; cuts: Array<[number, number]> }> = [];
  if (!same) problems.push('the filter found other units than scripts/ablation/maps.ts; nothing was removed');
  for (const e of same ? eds : []) {
    if (e.loc.kind === 'tool_definition') continue;
    let spans: Span[];
    try { spans = spansFor(family, { loc: e.loc, text: e.text }); } catch { problems.push(`${e.loc.kind}: more than one span group starts this message`); continue; }
    if (!spans.some((s) => (s.layer && wanted.has(s.layer)) || s.paragraphs?.some((p) => p.layer && wanted.has(p.layer)))) continue;
    let starts: Array<number | null>;
    try { starts = resolveAnchors(e.text, spans); } catch { problems.push(`${e.loc.kind}: a required anchor did not resolve`); continue; }
    const buf = Buffer.from(e.text, 'utf8');
    const unit_sha256 = sha256(buf);
    const cuts: Array<[number, number]> = [];
    const inRange = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;
    const take = (id: string, layer: Layer, from: number, to: number, range: { min: number; max: number }, textSha?: string, insertAfter = false) => {
      const own = from + range.max;
      if (insertAfter && textSha !== undefined && range.min === range.max && to > own && buf[own - 1] === 0x0a && sha256(buf.subarray(from, own)) === textSha) {
        inserts.push({ span: id, bytes: to - own, sha256: sha256(buf.subarray(own, to)) });
        to = own;
      }
      if (!inRange(to - from, range)) { changed.add(id); return; }
      const sha = sha256(buf.subarray(from, to));
      if (textSha !== undefined && textSha !== sha) changed.add(id);
      cuts.push([from, to]);
      removed.push({ span: id, layer, bytes: to - from, sha256: sha, unit_sha256 });
    };
    const present = spans.map((s, i) => ({ s, i, at: starts[i] })).filter((x): x is { s: Span; i: number; at: number } => x.at !== null);
    present.forEach(({ s, i, at }, k) => {
      const end = k + 1 < present.length ? present[k + 1]!.at : buf.length;
      if (s.layer) { if (wanted.has(s.layer)) take(s.id, s.layer, at, end, s.bytes, s.text_sha256, present[k + 1]?.i === i + 1); return; }
      const paragraphs = s.paragraphs ?? [];
      if (!paragraphs.some((p) => p.layer && wanted.has(p.layer))) return;
      const ps = resolveAnchors(buf.subarray(at, end).toString('utf8'), paragraphs.map((p) => ({ anchor: p.anchor, presence: 'when_present' as const })));
      const live = paragraphs.map((p, j) => ({ p, j, at: ps[j] })).filter((x): x is { p: (typeof paragraphs)[number]; j: number; at: number } => x.at !== null);
      if (live[0]?.at !== 0) { problems.push(`${e.loc.kind}: a paragraph split does not start at its span`); return; }
      live.forEach(({ p, j, at: pa }, q) => { if (p.layer && wanted.has(p.layer)) take(`${s.id}/p${j}`, p.layer, at + pa, at + (q + 1 < live.length ? live[q + 1]!.at : end - at), p.bytes); });
    });
    if (cuts.length) edits.push({ e, buf, cuts });
  }
  for (const { e, buf, cuts } of edits) {
    const kept: Buffer[] = [];
    let at = 0;
    for (const [from, to] of cuts.sort((x, y) => x[0] - y[0])) { kept.push(buf.subarray(at, from)); at = to; }
    kept.push(buf.subarray(at));
    e.set(Buffer.concat(kept).toString('utf8'));
  }
  if (emptied.size) {
    if (Array.isArray(body.system)) body.system = compact(body.system, emptied);
    const messages: unknown[] | null = wire === 'anthropic-messages' ? (Array.isArray(body.messages) ? body.messages : null) : Array.isArray(body.input) ? body.input : null;
    for (const m of messages ?? []) if (isObj(m) && Array.isArray(m.content)) {
      m.content = compact(m.content, emptied);
      if (!m.content.length) emptied.add(m);
    }
    if (messages && wire === 'anthropic-messages') body.messages = compact(messages, emptied);
    else if (messages) body.input = compact(messages, emptied);
  }
  const done = new Set(removed.map((r) => r.span));
  const missing = [...expected.keys()].filter((id) => !done.has(id));
  const matchedLayers = new Set(removed.map((r) => r.layer));
  const did_not_take = [...new Set(expected.values())].some((l) => !matchedLayers.has(l));
  return Object.assign(receipt, {
    layers_matched: b.layers.filter((l) => matchedLayers.has(l)), removed_bytes: removed.reduce((n, r) => n + r.bytes, 0), removed, missing, changed: [...changed], inserts, problems,
    did_not_take, partial: !did_not_take && (missing.length > 0 || changed.size > 0 || problems.length > 0),
  });
}
