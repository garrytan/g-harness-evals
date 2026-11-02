#!/usr/bin/env bun
// Turns one capture's fake-endpoint request log into a harness anatomy record
// (scripts/anatomy/record.schema.json). The log is ndjson, one line per request
// the harness sent: {at, method, path, status, body?, headers?,
// authorization_sha256?, played?, sent_at?}. Older logs from
// scripts/gsta-135/fake-anthropic.ts carry only {at, method, path, body,
// status?} and leave status out on success; those rows keep status null.
//
//   bun scripts/anatomy/dissect.ts --log <ndjson[.gz]> --harness <name> --config <label> [--out <record.json>] [--prompt-file <file>]
//
// Prints a short summary: the first agent request's body and system bytes, the
// ten largest system sections, the tools, the side calls and the note that
// announces deferred tools. --prompt-file names the task prompt the capture
// sent, so the record can say how many user-message bytes the harness added
// around it (user_prefix_bytes); without it that field is null.
//
// Classes: error is any status of 400 or more; agent is a POST to a messages or
// responses path with a non-empty tools array (on Responses, or a non-empty
// additional_tools input item); side is a POST to such a path without tools;
// discovery is everything else (GET /v1/models, count_tokens, Ollama-style
// /api/show probes). All byte counts are UTF-8 bytes; a body's bytes are those
// of its compact JSON (JSON.stringify), not of the raw line.
//
// On the Responses wire the system is `instructions` followed by the text of
// every input message with role system or developer, in input order (Codex
// 0.165.0 sends no instructions and puts its whole prompt in developer
// messages); each text part is one block, and the block records where it came
// from (source). The messages are the other input items. The tools are the
// top-level tools array and the tools of every additional_tools input item,
// namespaces flattened (each entry keeps its namespace), and, for a tool whose
// description documents nested tools under "### `<name>`" headings (Codex's
// code-mode exec), one entry per nested tool, marked nested_in.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export type Wire = 'anthropic-messages' | 'openai-responses';
export type RequestClass = 'agent' | 'side' | 'discovery' | 'error';

export interface LogRow {
  at: string;
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, unknown>;
  authorization_sha256?: string;
  played?: unknown;
  sent_at?: string;
}

export interface Section { title: string; block: number; start: number; bytes: number; sha256: string }
export interface CacheMark { where: 'system' | 'tools' | 'messages'; index: number; block?: number }
export interface ToolEntry { name: string; description_bytes: number; schema_bytes: number; deferred?: true; namespace?: string; source?: 'additional_tools'; nested_in?: string }

export interface RequestEntry {
  i: number;
  at: string;
  method: string;
  path: string;
  status: number | null;
  class: RequestClass;
  model: string | null;
  stream: boolean | null;
  max_tokens: number | null;
  body_bytes: number;
  system_bytes: number;
  tools: { count: number; bytes: number; names: string[] };
  messages: { count: number; bytes: number };
  cache_control: CacheMark[];
  thinking: unknown;
  played: unknown;
}

export interface FirstAgent {
  i: number;
  body_bytes: number;
  system: { bytes: number; blocks: Array<{ start: number; bytes: number; cache_control: boolean; source?: string }>; sections: Section[] };
  tools: ToolEntry[];
  deferred_tools_note?: string;
  deferred_tools_omitted?: number;
  user_text_bytes: number;
  user_prefix_bytes: number | null;
}

export interface AnatomyRecord {
  schema: 'harness-anatomy/1';
  wire: Wire;
  harness: string;
  config: string;
  source_log_sha256: string;
  requests: RequestEntry[];
  first_agent: FirstAgent | null;
  side_calls: Array<{ i: number; purpose_guess: string; body_bytes: number }>;
  growth: Array<{ i: number; body_bytes: number; messages: number }>;
  compaction: Array<{ i: number; before_messages: number; after_messages: number; summary_like: boolean; summary_call: number | null; kind: 'compaction' | 'new_session' }>;
  retries: Array<{ i: number; status: number; next_i: number | null; gap_ms: number | null; same_body: boolean | null }>;
  totals: { requests: number; agent: number; side: number; discovery: number; error: number };
}

type Obj = Record<string, unknown>;
const GENERATION = /\/(messages|responses)$/;
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const jsonBytes = (v: unknown) => (v === undefined ? 0 : bytes(JSON.stringify(v)));
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

/** Reads a log, gunzipping it when it is gzip; the sha256 is over the decompressed ndjson bytes. */
export function readLog(path: string): { rows: LogRow[]; sha256: string } {
  const raw = readFileSync(path);
  const data = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return { rows: parseLog(data.toString('utf8')), sha256: sha256(data) };
}

export function parseLog(text: string): LogRow[] {
  return text.split('\n').flatMap((line, n) => {
    if (!line.trim()) return [];
    let row: unknown;
    try { row = JSON.parse(line); } catch { throw new Error(`log line ${ n + 1} is not JSON`); }
    if (!isObj(row) || typeof row.method !== 'string' || typeof row.path !== 'string') throw new Error(`log line ${ n + 1} has no method or path`);
    return [row as unknown as LogRow];
  });
}

/** The wire format of one row: the path decides, else a body with input or instructions and no messages is a Responses body. */
export function wireOf(row: LogRow): Wire {
  const b = row.body;
  if (row.path.endsWith('/responses')) return 'openai-responses';
  return isObj(b) && ('input' in b || 'instructions' in b) && !('messages' in b) ? 'openai-responses' : 'anthropic-messages';
}

export function classify(row: LogRow): RequestClass {
  if ((row.status ?? 0) >= 400) return 'error';
  if (row.method !== 'POST' || !GENERATION.test(row.path)) return 'discovery';
  const tools = isObj(row.body) ? row.body.tools : undefined;
  if (Array.isArray(tools) && tools.length > 0) return 'agent';
  return additionalTools(row.body).some(t => t.length > 0) ? 'agent' : 'side';
}

/** The tools arrays of a Responses body's additional_tools input items (Codex). */
function additionalTools(body: unknown): unknown[][] {
  if (!isObj(body) || !Array.isArray(body.input)) return [];
  return body.input.filter(m => isObj(m) && m.type === 'additional_tools' && Array.isArray(m.tools)).map(m => (m as Obj).tools as unknown[]);
}

/** A Responses input item that carries system text: a message with role system or developer. */
const systemItem = (m: unknown): m is Obj => isObj(m) && (m.role === 'system' || m.role === 'developer') && (m.type === undefined || m.type === 'message');

/** The system prompt as text blocks: Anthropic system (a string or text blocks), or Responses instructions then the system and developer input messages. */
export function systemBlocks(body: unknown, wire: Wire): Array<{ text: string; cache_control: boolean; source?: string }> {
  if (!isObj(body)) return [];
  const blocks = (s: unknown, source?: string) => {
    const at = (k?: number) => (source === undefined ? {} : { source: k === undefined ? source : `${source}.content[${k}]` });
    if (typeof s === 'string') return [{ text: s, cache_control: false, ...at() }];
    if (!Array.isArray(s)) return [];
    return s.flatMap((b, k) => (isObj(b) ? [{ text: str(b.text) ?? '', cache_control: b.cache_control !== undefined, ...at(k) }] : []));
  };
  if (wire !== 'openai-responses') return blocks(body.system);
  const out: Array<{ text: string; cache_control: boolean; source?: string }> = blocks(body.instructions, 'instructions').map(b => ({ ...b, source: 'instructions' }));
  if (Array.isArray(body.input)) body.input.forEach((m, i) => { if (systemItem(m)) out.push(...blocks(m.content, `input[${i}]`).filter(b => b.text !== '')); });
  return out;
}

/** Every tool a request offers. Anthropic: the tools array as sent. Responses: the tools array and every additional_tools item's tools, namespaces flattened. */
function toolList(body: unknown, wire: Wire): Array<{ tool: unknown; namespace?: string; source?: 'additional_tools' }> {
  if (!isObj(body)) return [];
  if (wire !== 'openai-responses') return Array.isArray(body.tools) ? body.tools.map(tool => ({ tool })) : [];
  const out: Array<{ tool: unknown; namespace?: string; source?: 'additional_tools' }> = [];
  const walk = (list: unknown[], source?: 'additional_tools', namespace?: string) => {
    for (const t of list) {
      if (isObj(t) && t.type === 'namespace' && Array.isArray(t.tools)) walk(t.tools, source, str(t.name) ?? '');
      else out.push({ tool: t, ...(namespace !== undefined ? { namespace } : {}), ...(source ? { source } : {}) });
    }
  };
  if (Array.isArray(body.tools)) walk(body.tools);
  for (const list of additionalTools(body)) walk(list, 'additional_tools');
  return out;
}

/** Bytes of every tool definition a request offers: the tools array, plus each additional_tools item's tools on Responses. */
function toolBytes(body: Obj, wire: Wire): number {
  const top = Array.isArray(body.tools) && body.tools.length ? jsonBytes(body.tools) : 0;
  return wire === 'openai-responses' ? additionalTools(body).reduce((n, t) => n + (t.length ? jsonBytes(t) : 0), top) : top;
}

/** Throws unless the sections tile [0, total) with no gap or overlap. */
export function checkSections(sections: Section[], total: number): void {
  let at = 0;
  for (const s of sections) {
    if (s.start !== at) throw new Error(`section "${ s.title}" starts at byte ${ s.start}, expected ${ at}`);
    at += s.bytes;
  }
  if (at !== total) throw new Error(`sections sum to ${ at} bytes, system is ${ total}`);
}

/**
 * Splits system text blocks into sections at markdown headings (#, ##, ###) and
 * at top-level XML-like tags: a line holding only <tag ...> with a matching
 * line holding only </tag> later in the same block becomes one section (so
 * does <a b> closed by </a b>, as Codex writes <permissions instructions>), and
 * the text after the closing tag continues the enclosing heading as
 * "<heading> (cont.)". Text before a block's first heading is "preamble".
 * Fenced code and tag bodies are never split. A section never crosses a block
 * boundary; start is a byte offset into the blocks joined with no separator.
 */
export function splitSections(blocks: string[]): Section[] {
  const out: Section[] = [];
  let offset = 0;
  blocks.forEach((block, b) => {
    const lines = block.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const bare = (line: string) => line.replace(/\r?\n$/, '');
    let title = 'preamble';
    let heading = 'preamble';
    let cur = '';
    let fence = false;
    let closeTag: string | null = null;
    const flush = () => {
      if (!cur) return;
      const n = bytes(cur);
      out.push({ title, block: b, start: offset, bytes: n, sha256: sha256(cur) });
      offset += n;
      cur = '';
    };
    lines.forEach((line, k) => {
      const text = bare(line);
      if (closeTag) {
        cur += line;
        if (text.trim() === `</${ closeTag}>`) { flush(); closeTag = null; title = `${ heading} (cont.)`; }
        return;
      }
      if (/^(```|~~~)/.test(text)) { fence = !fence; cur += line; return; }
      if (!fence && /^#{1,3}\s+\S/.test(text)) { flush(); title = heading = text.trim(); cur = line; return; }
      const open = fence ? null : text.match(/^<([A-Za-z][\w.:-]*)(?:\s[^<>]*)?>\s*$/);
      const closes = (tag: string) => lines.slice(k + 1).some(l => bare(l).trim() === `</${ tag}>`);
      const tag = !open ? null : closes(open[1]) ? open[1] : closes(text.trim().slice(1, -1)) ? text.trim().slice(1, -1) : null;
      if (tag) { flush(); title = `<${ tag}>`; closeTag = tag; cur = line; return; }
      cur += line;
    });
    flush();
  });
  checkSections(out, blocks.reduce((n, s) => n + bytes(s), 0));
  return out;
}

function toolEntry(t: unknown): ToolEntry {
  const o = isObj(t) ? t : {};
  const fn = isObj(o.function) ? o.function : {};
  return {
    name: str(o.name) ?? str(fn.name) ?? str(o.type) ?? '',
    description_bytes: bytes(str(o.description) ?? str(fn.description) ?? ''),
    schema_bytes: jsonBytes(o.input_schema ?? o.parameters ?? fn.parameters ?? o.format),
  };
}

/** The nested tools a tool's description documents under "### `<name>`" headings (Codex's exec), each with the bytes of its subsection, which ends at the next heading of any level. */
export function nestedTools(parent: string, description: string): ToolEntry[] {
  const out: ToolEntry[] = [];
  const lines = description.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let cur: ToolEntry | null = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = fenced ? null : line.match(/^### `([^`]+)`\s*$/);
    if (m) { cur = { name: m[1], description_bytes: 0, schema_bytes: 0, nested_in: parent }; out.push(cur); }
    else if (!fenced && /^#{1,3}\s/.test(line)) cur = null;
    if (cur) cur.description_bytes += bytes(line);
  }
  return out;
}

/** The conversation items: Anthropic messages, or a Responses input (a string, or its items other than system and developer messages and additional_tools). */
function items(body: unknown, wire: Wire): unknown {
  if (!isObj(body)) return undefined;
  if (wire !== 'openai-responses') return body.messages;
  return Array.isArray(body.input) ? body.input.filter(m => !systemItem(m) && !(isObj(m) && m.type === 'additional_tools')) : body.input;
}

/** Text of the user messages, one string per text block. */
function userText(body: unknown, wire: Wire): string[] {
  const list = items(body, wire);
  if (typeof list === 'string') return [list];
  if (!Array.isArray(list)) return [];
  return list.filter(m => isObj(m) && m.role === 'user').flatMap(m => {
    const c = (m as Obj).content;
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(isObj).map(x => str(x.text)).filter((x): x is string => x !== null) : [];
  });
}

function requestEntry(row: LogRow, i: number, wire: Wire): RequestEntry {
  const b = isObj(row.body) ? row.body : {};
  const responses = wire === 'openai-responses';
  const tools = Array.isArray(b.tools) ? b.tools : [];
  const offered = toolList(b, wire);
  const list = items(b, wire);
  const cache: CacheMark[] = [];
  if (!responses) {
    if (Array.isArray(b.system)) b.system.forEach((x, index) => { if (isObj(x) && x.cache_control !== undefined) cache.push({ where: 'system', index }); });
    tools.forEach((x, index) => { if (isObj(x) && x.cache_control !== undefined) cache.push({ where: 'tools', index }); });
    if (Array.isArray(list)) list.forEach((m, index) => {
      if (!isObj(m)) return;
      if (m.cache_control !== undefined) cache.push({ where: 'messages', index });
      if (Array.isArray(m.content)) m.content.forEach((x, block) => { if (isObj(x) && x.cache_control !== undefined) cache.push({ where: 'messages', index, block }); });
    });
  }
  return {
    i,
    at: row.at,
    method: row.method,
    path: row.path,
    status: num(row.status),
    class: classify(row),
    model: str(b.model),
    stream: typeof b.stream === 'boolean' ? b.stream : null,
    max_tokens: num(responses ? b.max_output_tokens : b.max_tokens),
    body_bytes: jsonBytes(row.body),
    system_bytes: systemBlocks(row.body, wire).reduce((n, x) => n + bytes(x.text), 0),
    tools: { count: offered.length, bytes: toolBytes(b, wire), names: offered.map(t => toolEntry(t.tool).name) },
    messages: { count: Array.isArray(list) ? list.length : typeof list === 'string' ? 1 : 0, bytes: jsonBytes(list) },
    cache_control: cache,
    thinking: (responses ? b.reasoning : b.thinking) ?? null,
    played: row.played ?? null,
  };
}

function firstAgent(row: LogRow, i: number, wire: Wire, prompt?: string): FirstAgent {
  const body = row.body as Obj;
  const blocks = systemBlocks(body, wire);
  const sections = splitSections(blocks.map(x => x.text));
  const text = Buffer.from(blocks.map(x => x.text).join(''), 'utf8');
  let start = 0;
  const blockInfo = blocks.map(x => { const n = bytes(x.text); const info = { start, bytes: n, cache_control: x.cache_control, ...(x.source !== undefined ? { source: x.source } : {}) }; start += n; return info; });
  const tools: ToolEntry[] = toolList(body, wire).flatMap(({ tool, namespace, source }) => {
    const entry: ToolEntry = { ...toolEntry(tool), ...(namespace !== undefined ? { namespace } : {}), ...(source ? { source } : {}) };
    const description = isObj(tool) ? str(tool.description) : null;
    return wire === 'openai-responses' && description ? [entry, ...nestedTools(entry.name, description)] : [entry];
  });
  for (const s of sections.filter(s => /deferred/i.test(s.title))) {
    const listing = text.subarray(s.start, s.start + s.bytes).toString('utf8');
    for (const m of listing.matchAll(/^- ([\w.:-]+) \([^)\n]*\): ?(.*)$/gm)) tools.push({ name: m[1], description_bytes: bytes(m[2]), schema_bytes: 0, deferred: true });
  }
  const note = text.toString('utf8').match(/^.*\b(\d+) (?:additional |more )?tools? (?:were |are )?omitted\b.*$/im);
  const user = userText(body, wire);
  const userBytes = user.reduce((n, x) => n + bytes(x), 0);
  let prefix: number | null = null;
  if (prompt !== undefined) {
    if (!user.some(x => x.includes(prompt))) throw new Error("the prompt is not in the first agent request's user text");
    prefix = userBytes - bytes(prompt);
  }
  return {
    i,
    body_bytes: jsonBytes(body),
    system: { bytes: start, blocks: blockInfo, sections },
    tools,
    ...(note ? { deferred_tools_note: note[0].trim(), deferred_tools_omitted: Number(note[1]) } : {}),
    user_text_bytes: userBytes,
    user_prefix_bytes: prefix,
  };
}

/** A guess at what a tool-free call is for, from its system and user text; labelled a guess in the record. */
export function purposeGuess(row: LogRow, wire: Wire): string {
  const b = isObj(row.body) ? row.body : {};
  const sys = systemBlocks(b, wire).map(x => x.text).join('\n').toLowerCase();
  const all = sys + '\n' + userText(b, wire).join('\n').toLowerCase();
  if (/\btitle\b/.test(sys)) return 'session title';
  if (/summar|compact|condense/.test(all)) return 'summary';
  if (/memor|extract (facts|notes)/.test(sys)) return 'memory extraction';
  if ((num(wire === 'openai-responses' ? b.max_output_tokens : b.max_tokens) ?? Infinity) <= 16) return 'probe';
  return 'unknown';
}

export function dissect(rows: LogRow[], opts: { harness: string; config: string; source_log_sha256: string; prompt?: string }): AnatomyRecord {
  const gen = rows.filter(r => GENERATION.test(r.path));
  const wires = new Set(gen.map(wireOf));
  if (wires.size > 1) throw new Error('the log mixes wire formats: ' + [...wires].join(', '));
  const wire: Wire = gen.length ? wireOf(gen[0]) : 'anthropic-messages';
  const requests = rows.map((r, i) => requestEntry(r, i, wire));
  const agents = requests.filter(r => r.class === 'agent');
  const first = agents[0];

  const compaction: AnatomyRecord['compaction'] = [];
  for (let k = 1; k < agents.length; k++) {
    const before = agents[k - 1];
    const after = agents[k];
    if (after.messages.count >= before.messages.count) continue;
    const list = (r: RequestEntry) => { const l = items(rows[r.i].body, wire); return Array.isArray(l) ? l.map(m => JSON.stringify(m)) : []; };
    const seen = new Set(list(before));
    const fresh = list(after).filter(m => !seen.has(m)).join('\n');
    const summaryLike = /summar|compact|condens|previous conversation|earlier conversation|context (?:was )?(?:truncated|trimmed)/i.test(fresh);
    const summaryCall = requests.find(r => r.class === 'side' && r.i > before.i && r.i < after.i && purposeGuess(rows[r.i], wire) === 'summary')?.i ?? null;
    const afterItems = items(rows[after.i].body, wire);
    const hasAssistant = Array.isArray(afterItems) && afterItems.some(m => isObj(m) && (m.role === 'assistant' || m.type === 'function_call'));
    const afterList = list(after);
    const freshFirst = afterList.length > 0 && !seen.has(afterList[0]);
    const kind = summaryCall === null && !hasAssistant && freshFirst ? 'new_session' : 'compaction';
    compaction.push({ i: after.i, before_messages: before.messages.count, after_messages: after.messages.count, summary_like: summaryLike, summary_call: summaryCall, kind });
  }

  const retries: AnatomyRecord['retries'] = requests.filter(r => r.class === 'error' && GENERATION.test(r.path)).map(r => {
    const next = requests.find(n => n.i > r.i && n.method === r.method && n.path === r.path && (n.tools.count > 0) === (r.tools.count > 0));
    const row = rows[r.i];
    return {
      i: r.i,
      status: r.status as number,
      next_i: next ? next.i : null,
      gap_ms: next ? Date.parse(next.at) - Date.parse(row.sent_at ?? row.at) : null,
      same_body: next ? JSON.stringify(row.body ?? null) === JSON.stringify(rows[next.i].body ?? null) : null,
    };
  });

  const count = (c: RequestClass) => requests.filter(r => r.class === c).length;
  return {
    schema: 'harness-anatomy/1',
    wire,
    harness: opts.harness,
    config: opts.config,
    source_log_sha256: opts.source_log_sha256,
    requests,
    first_agent: first ? firstAgent(rows[first.i], first.i, wire, opts.prompt) : null,
    side_calls: requests.filter(r => r.class === 'side').map(r => ({ i: r.i, purpose_guess: purposeGuess(rows[r.i], wire), body_bytes: r.body_bytes })),
    growth: agents.map(r => ({ i: r.i, body_bytes: r.body_bytes, messages: r.messages.count })),
    compaction,
    retries,
    totals: { requests: requests.length, agent: agents.length, side: count('side'), discovery: count('discovery'), error: count('error') },
  };
}

export function summary(rec: AnatomyRecord): string {
  const n = (x: number) => x.toLocaleString('en-US');
  const t = rec.totals;
  const lines = [`${ rec.harness} (${ rec.config}), ${ rec.wire}: ${ t.requests} requests (agent ${ t.agent}, side ${ t.side}, discovery ${ t.discovery}, error ${ t.error})`];
  const fa = rec.first_agent;
  if (!fa) {
    lines.push('no agent request in this log');
  } else {
    const direct = fa.tools.filter(x => !x.deferred && !x.nested_in);
    const deferred = fa.tools.filter(x => x.deferred);
    const nested = fa.tools.filter(x => x.nested_in);
    lines.push(`first agent request (#${ fa.i}): ${ n(fa.body_bytes)} body bytes, system ${ n(fa.system.bytes)} bytes in ${ fa.system.blocks.length} block(s), ${ fa.system.sections.length} sections`);
    lines.push('largest system sections:');
    for (const s of [...fa.system.sections].sort((a, b) => b.bytes - a.bytes).slice(0, 10)) lines.push(`  ${ n(s.bytes).padStart(7)}  ${ s.title}`);
    lines.push(`tools: ${ direct.length} sent (${ direct.map(x => x.name).join(', ')})`);
    if (nested.length) lines.push(`nested tools documented inside a tool's description: ${ nested.length} (${ nested.map(x => `${ x.nested_in}.${ x.name}`).join(', ')})`);
    if (deferred.length) lines.push(`deferred tools listed in the system prompt: ${ deferred.length} (${ deferred.map(x => x.name).join(', ')})`);
    lines.push(`deferred-tool note: ${ fa.deferred_tools_note ?? 'none'}`);
    const added = fa.user_prefix_bytes === null ? '' : `, ${ n(fa.user_prefix_bytes)} added by the harness`;
    lines.push(`user text: ${ n(fa.user_text_bytes)} bytes${ added}`);
  }
  const side = rec.side_calls.map(s => `#${ s.i} ${ s.purpose_guess} (${ n(s.body_bytes)} bytes)`).join('; ');
  lines.push('side calls: ' + (side || 'none'));
  lines.push(`compactions: ${ rec.compaction.length}, retries: ${ rec.retries.length}`);
  return lines.join('\n');
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const log = arg('--log');
  const harness = arg('--harness');
  const config = arg('--config');
  if (!log || !harness || !config) {
    console.error('usage: bun scripts/anatomy/dissect.ts --log <ndjson[.gz]> --harness <name> --config <label> [--out <record.json>] [--prompt-file <file>]');
    process.exit(2);
  }
  const promptFile = arg('--prompt-file');
  const { rows, sha256: digest } = readLog(log);
  const rec = dissect(rows, { harness, config, source_log_sha256: digest, prompt: promptFile ? readFileSync(promptFile, 'utf8') : undefined });
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
  console.log(summary(rec));
}
