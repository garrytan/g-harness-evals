// gstack arms of a frontier Harbor run (internal-task): what the model was shown and what it opened, read from the trial's
// captured request bodies (<trial>/proxy-capture/proxy-requests.ndjson, runner/proxy/capture.ts). to-trials.ts writes the
// result as the record's "gstack" field; audit.ts and analyze.ts read it.
//
// The checks, per trial of a cell with a "gstack" block ({ arm, spec, lock, spec_sha256 } in prereg-harbor.json):
//   exposure      The first agent-loop request (the same definition as the effort check: a request on the cell model that
//                 declares at least one tool, every cell-model request when none does) is parsed for the host's skill
//                 listing, each listed gstack skill is mapped to its canonical skill, and the set must equal the lock's
//                 skills (gstack-names.ts lockSkills) less the skills the host leaves out by design (HOST_UNLISTED).
//                 "mismatch" makes the trial an infra_error, infra class gstack_exposure_mismatch, HE-FRONTIER-010.
//                 "not-applicable" means the trial got no model answer and sent no agent-loop request, so there was
//                 nothing to show. A trial that got model answers but whose first agent-loop request cannot be inspected
//                 (no capture file, an empty capture, a first line cut mid-write, or only other requests) is a mismatch:
//                 nothing shows the listing.
//   removed_seen  Every request of the trial: listing entries, and skill paths (skills/<dir>/..., skills/gstack/<dir>/...,
//                 .agents/skills/gstack-<dir>/..., a category folder skills/<category>/<dir>/... except on Hermes, and
//                 <install_root>/<dir>/... in the gstack checkout every arm uploads, with or without the home prefix),
//                 of a gstack skill the arm's lock does not hold, and every counted open or section read of such a skill
//                 (a Skill or skill_view call names no path). On Hermes a skill name counts only as the gstack listing
//                 names it (gstack-<dir>), so Hermes's own bundled codex and claude-code never count. The skill universe is the lock plus full.lock.json beside it. Bare words
//                 (review, verify, spec) never count: a name counts only inside a listing or a skills/ path.
//   opens         Tool calls that open a skill's SKILL.md: Claude Code's Skill tool ({ skill }), Hermes's skill_view
//                 ({ name } with no file_path), and any tool call (Read, Bash, Codex exec or shell, Hermes read_file or
//                 terminal) whose arguments name <skills path>/<dir>/SKILL.md. One call counts once per skill, and only
//                 when its tool result returns the body: a SKILL.md's frontmatter (--- then name:), after a read tool's
//                 line numbers and Hermes's JSON wrapper come off; for the Skill tool, the "Base directory for this
//                 skill:" message of that skill in the request that carries the result. Existence probes, writes,
//                 failed reads and path mentions return no body and never count.
//   section_reads The same for <dir>/sections/*.md (skill_view with file_path sections/*.md), whose returned body is
//                 Markdown (a heading, or gstack's generated-file comment). Never an open.
//   listing_bytes UTF-8 bytes of the gstack entries of the listing in the first agent-loop request (each entry's line or
//                 lines with its newline). The host's header and usage text are not counted: they are the same with any
//                 skill set, so arm differences come from the entries alone.
//   opened_body_tokens  Bytes of the tool results of the counted opening and section-reading calls (each call id once, the first
//                 time it appears; later requests resend it as history, which is not counted again), plus Claude Code's
//                 "Base directory for this skill:" message that carries the body after a Skill call, divided by the
//                 trial's bytes per token: captured request bytes over the proxy's input tokens for the captured
//                 requests (input tokens include cache reads and writes on every provider, runner/ledger usageCost).
//   capture_truncated  The capture ends in the proxy's truncation marker (runner/proxy/capture.ts, 256 MiB): requests
//                 after it were not captured, so their opens are unobserved. to-trials.ts then counts input tokens
//                 only over the trial's first forwarded or failed requests by arrival time, as many as were captured. With no token count
//                 the ratio is 4 bytes per token and bytes_per_token_source says "default".
//
// Listing formats, read from each pinned host's own source:
//   Claude Code 2.1.312  a system-reminder in the first user message, "The following skills are available for use with
//                        the Skill tool:" then "- <name>: <description>" lines, "- <name>" when only the name fits the
//                        budget, "- <name> (<dir>)" when the name differs from the folder (the skill_listing attachment;
//                        the Skill tool's own description no longer lists skills). The older <available_skills><skill>
//                        <name> form in a tool description is read too. Skills whose frontmatter sets
//                        disable-model-invocation are never listed (the listing filters !disableModelInvocation).
//   Codex 0.165.0        a developer message <skills_instructions> with "## Skills", an optional "### Skill roots" table
//                        ("- `r0` = `/root/.agents/skills`"), and "### Available skills" lines
//                        "- <name>: <description> (file: <path or r0/...>)" (codex-rs/ext/skills/src/catalog_prompt.rs,
//                        render.rs). The name is the frontmatter name (review), so entries map by path (gstack-review).
//   Hermes v2026.9.24    the system prompt's "## Skills" block, <available_skills> with "  <category>: <description>" and
//                        "    - <name>: <description>" lines, or "  <category> [names only]: a, b" for a demoted category
//                        (agent/prompt_builder.py _render_skills_index).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lockSkills, nameMap, type Lock } from './gstack-names.ts';

export type GstackHost = 'claude' | 'codex' | 'hermes';
export const GSTACK_HOSTS: Readonly<Record<string, GstackHost>> = { 'claude-code': 'claude', codex: 'codex', hermes: 'hermes' };
export const EXPOSURE_CODE = 'HE-FRONTIER-010';
export const DEFAULT_BYTES_PER_TOKEN = 4;

/** Skills a host never lists by design, at gstack 1.98.0.0 (68b1d05): Claude Code drops a skill whose frontmatter sets
 *  disable-model-invocation: true, which land-and-deploy and modernize do. Subtracted from the lock's skills. */
export const HOST_UNLISTED: Readonly<Record<GstackHost, readonly string[]>> = { claude: ['land-and-deploy', 'modernize'], codex: [], hermes: [] };

/** A cell's "gstack" block in prereg-harbor.json. */
export interface GstackCell { arm: string; spec: string; lock: string; spec_sha256: string }

/** The record's "gstack" field. */
export interface GstackTrial {
  arm: string; spec_sha256: string; lock: string;
  expected: string[]; listed: string[]; exposure: 'ok' | 'mismatch' | 'not-applicable'; not_listed_by_host: string[];
  removed_seen: string[]; opens: Record<string, number>; section_reads: Record<string, number>;
  listing_bytes: number; opened_body_bytes: number; opened_body_tokens: number; bytes_per_token: number; bytes_per_token_source: 'proxy' | 'default';
  capture_truncated: boolean;
}

type Body = Record<string, any>;
export interface CapturedRequest { route?: string; body: Body | null; bytes: number }

/** Every line of a capture file, and whether it ends in the proxy's truncation marker (which is not a request) or in a
 *  half-written last line (the capture stopped mid-write; that line is dropped); null when there is no file. */
export function readCapture(file: string): { requests: CapturedRequest[]; truncated: boolean } | null {
  if (!existsSync(file)) return null;
  const requests: CapturedRequest[] = [];
  let truncated = false;
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  for (const [i, raw] of lines.entries()) {
    let e: { route?: string; body?: Body | null; truncated?: boolean };
    try {
      e = JSON.parse(raw);
    } catch (err) {
      if (i < lines.length - 1) throw err;
      truncated = true;
      continue;
    }
    if (e.truncated) { truncated = true; continue; }
    requests.push({ route: e.route, body: e.body && typeof e.body === 'object' ? e.body : null, bytes: e.body ? Buffer.byteLength(raw) : 0 });
  }
  return { requests, truncated };
}

export const readCaptureFile = (file: string): CapturedRequest[] | null => readCapture(file)?.requests ?? null;

/** Agent-loop requests: on the cell model, not a count_tokens call, declaring at least one tool (every cell-model request
 *  when none declares a tool). */
export function agentLoopRequests(requests: CapturedRequest[], cellModel: string): Array<{ route?: string; body: Body }> {
  const name = cellModel.split(':').slice(1).join(':');
  const onModel = requests.filter((r): r is { route?: string; body: Body; bytes: number } => r.body !== null && !r.route?.endsWith('/count_tokens') && r.body.model === name);
  const withTools = onModel.filter((r) => Array.isArray(r.body.tools) && r.body.tools.length > 0);
  return (withTools.length ? withTools : onModel).map(({ route, body }) => ({ route, body }));
}

export const readLock = (path: string): Lock => JSON.parse(readFileSync(path, 'utf8')) as Lock;

/** The arm's lock and the skill universe: the lock plus full.lock.json in the same folder when it exists. */
export function loadLocks(lockPath: string): { lock: Lock; universe: Lock | null } {
  const lock = readLock(lockPath);
  const full = join(dirname(lockPath), 'full.lock.json');
  return { lock, universe: full !== lockPath && existsSync(full) ? readLock(full) : null };
}

// ---- resolving names and paths to canonical skills

export interface Resolver { known: Set<string>; name(c: string): string | null; path(text: string): Array<{ skill: string; rest: string }> }

export function resolver(lock: Lock, universe: Lock | null, host: GstackHost): Resolver {
  const known = new Set([...lockSkills(lock), ...(universe ? lockSkills(universe) : [])]);
  const names = new Map([...(universe ? nameMap(universe, host) : []), ...nameMap(lock, host)]);
  const name = (c: string): string | null => {
    if (names.has(c)) return names.get(c)!;
    if (host === 'hermes') return null;
    if (known.has(c)) return c;
    return c.startsWith('gstack-') && known.has(c.slice(7)) ? c.slice(7) : null;
  };
  const roots = [...new Set([lock.install_root, universe?.install_root].filter((p): p is string => !!p).map((p) => p.replace(/^\/(?:root|home\/[^/]+)(?=\/)/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))];
  const checkout = roots.length ? new RegExp('(?:' + roots.join('|') + ')\\/((?:[\\w.-]+\\/)*[\\w.-]+)', 'g') : null;
  const path = (text: string) => {
    const out: Array<{ skill: string; rest: string }> = [];
    for (const m of text.matchAll(/(?<![\w-])skills\/((?:[\w.-]+\/)+[\w.-]*)/g)) {
      const segs = m[1]!.split('/');
      const at = segs[0] === 'gstack' && segs.length > 2 && name(segs[1]!) ? 1 : name(segs[0]!) ? 0 : host !== 'hermes' && segs.length > 2 && name(segs[1]!) ? 1 : -1;
      if (at >= 0) out.push({ skill: name(segs[at]!)!, rest: segs.slice(at + 1).join('/') });
    }
    for (const m of checkout ? text.matchAll(checkout) : []) {
      const segs = m[1]!.split('/');
      if (segs.length === 1 && segs[0] === 'SKILL.md' && known.has('gstack')) out.push({ skill: 'gstack', rest: 'SKILL.md' });
      else if (segs.length > 1 && known.has(segs[0]!)) out.push({ skill: segs[0]!, rest: segs.slice(1).join('/') });
    }
    return out;
  };
  return { known, name, path };
}

const isSection = (rest: string) => /^sections\/[\w.-]+\.md$/.test(rest);

// ---- request bodies: strings, listings, calls and results

/** Every string under a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** The text of a request a model reads as context: system, instructions, messages, input and tool descriptions. */
const contextStrings = (body: Body) => strings([body.system, body.instructions, body.messages, body.input, (Array.isArray(body.tools) ? body.tools : []).map((t: Body) => t?.description ?? t?.function?.description)]);

export interface ListingEntry { name: string; path: string | null; text: string; category?: string }

const CLAUDE_HEADER = 'The following skills are available for use with the Skill tool:';

function claudeEntries(text: string): ListingEntry[] {
  const out: ListingEntry[] = [];
  let at = text.indexOf(CLAUDE_HEADER);
  while (at >= 0) {
    let block = text.slice(at + CLAUDE_HEADER.length);
    const next = block.indexOf(CLAUDE_HEADER);
    const end = block.indexOf('</system-reminder>');
    block = block.slice(0, Math.min(...[next, end, block.length].filter((i) => i >= 0)));
    let current: ListingEntry | null = null;
    for (const line of block.split('\n')) {
      const m = /^- (\S+?)(?: \(([^()\s]+)\))?(?:: |$)/.exec(line);
      if (m) out.push(current = { name: m[1]!, path: m[2] ? 'skills/' + m[2] + '/SKILL.md' : null, text: line + '\n' });
      else if (current && line.trim()) current.text += line + '\n';
    }
    at = text.indexOf(CLAUDE_HEADER, at + CLAUDE_HEADER.length);
  }
  for (const block of text.matchAll(/<available_skills>([\s\S]*?)<\/available_skills>/g)) {
    for (const s of block[1]!.matchAll(/<skill>[\s\S]*?<\/skill>/g)) {
      const n = /<name>\s*([^<]+?)\s*<\/name>/.exec(s[0]);
      if (n) out.push({ name: n[1]!, path: null, text: s[0] + '\n' });
    }
  }
  return out;
}

function codexEntries(text: string): ListingEntry[] {
  const out: ListingEntry[] = [];
  for (const block of text.matchAll(/## Skills\n([\s\S]*?)(?:<\/skills_instructions>|$)/g)) {
    const roots = new Map([...block[1]!.matchAll(/^- \x60([\w.-]+)\x60 = \x60([^\x60]+)\x60$/gm)].map((m) => [m[1]!, m[2]!.replace(/\/+$/, '')]));
    const avail = /### Available skills\n([\s\S]*?)(?:\n### |$)/.exec(block[1]!)?.[1] ?? '';
    for (const m of avail.matchAll(/^- (\S+?):[ \n][\s\S]*?\((?:file|executor package|cloud package|custom resource): ([^()\n]+)\)$/gm)) {
      const [root, ...rest] = m[2]!.split('/');
      out.push({ name: m[1]!, path: roots.has(root!) ? [roots.get(root!)!, ...rest].join('/') : m[2]!, text: m[0] + '\n' });
    }
  }
  return out;
}

/** Hermes lists gstack's skills under the gstack category (the install check's real capture) or, for a per-skill folder
 *  layout, under gstack-<skill> categories; its own bundled skills (claude-code, codex and others) sit in other categories
 *  and never resolve to a gstack skill, whatever their names (the none arm lists Hermes's own claude-code and codex). */
const isGstackCategory = (c: string) => c === 'gstack' || c.startsWith('gstack-');

function hermesEntries(text: string): ListingEntry[] {
  const out: ListingEntry[] = [];
  for (const block of text.matchAll(/<available_skills>\n([\s\S]*?)<\/available_skills>/g)) {
    let category = '';
    for (const line of block[1]!.split('\n')) {
      const entry = /^ {4}- (\S+?)(?:: |$)/.exec(line);
      if (entry) { out.push({ name: entry[1]!, path: null, text: line + '\n', category }); continue; }
      const names = /^ {2}(\S[^\n]*?) \[names only\]: (.+)$/.exec(line);
      if (names) { for (const n of names[2]!.split(', ')) out.push({ name: n.trim(), path: null, text: n.trim() + ', ', category: names[1]!.trim() }); continue; }
      const cat = /^ {2}(\S[^:\n]*):/.exec(line);
      if (cat) category = cat[1]!.trim();
    }
  }
  return out;
}

/** Every skill entry of the host's listing in one request body, gstack or not, in order. */
export function listingEntries(body: Body, host: GstackHost): ListingEntry[] {
  const parse = host === 'claude' ? claudeEntries : host === 'codex' ? codexEntries : hermesEntries;
  return contextStrings(body).flatMap(parse);
}

/** The canonical skill of a listing entry: by its path when it has one, else by its name. */
function entrySkill(e: ListingEntry, r: Resolver): string | null {
  if (e.category !== undefined && !isGstackCategory(e.category)) return null;
  if (e.path) return r.path(e.path).find((p) => p.rest === 'SKILL.md')?.skill ?? null;
  return r.name(e.name);
}

export interface Call { id: string; name: string; input: unknown; args: string }

const parsed = (s: unknown) => { if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return s; } };
/** The text of a tool result: a string, or the text of its blocks (an image block has none). */
const asText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  if (!v || typeof v !== 'object') return '';
  const o = v as Body;
  return asText(o.text ?? o.content ?? o.output ?? '');
};

/** Tool calls, tool results by call id, and the other text a request carries, for Anthropic Messages, OpenAI Responses
 *  and Chat Completions bodies. */
export function walk(body: Body): { calls: Call[]; results: Map<string, string>; texts: string[] } {
  const calls: Call[] = [];
  const results = new Map<string, string>();
  const texts: string[] = [];
  const call = (id: unknown, name: unknown, input: unknown) => { const args = typeof input === 'string' ? input : JSON.stringify(input ?? null); calls.push({ id: String(id ?? name + '\0' + args), name: String(name ?? ''), input: parsed(input), args }); };
  for (const m of (Array.isArray(body.messages) ? body.messages : []) as Body[]) {
    if (typeof m?.content === 'string') { if (m.role === 'tool') results.set(String(m.tool_call_id), m.content); else texts.push(m.content); }
    else if (Array.isArray(m?.content)) for (const b of m.content as Body[]) {
      if (b?.type === 'tool_use' || b?.type === 'server_tool_use') call(b.id, b.name, b.input);
      else if (b?.type === 'tool_result') results.set(String(b.tool_use_id), asText(b.content));
      else if (m.role === 'tool') results.set(String(m.tool_call_id), asText(m.content));
      else if (typeof b?.text === 'string') texts.push(b.text);
    }
    for (const c of (Array.isArray(m?.tool_calls) ? m.tool_calls : []) as Body[]) call(c.id, c.function?.name, c.function?.arguments);
  }
  for (const it of (Array.isArray(body.input) ? body.input : []) as Body[]) {
    const type = String(it?.type ?? 'message');
    if (type === 'function_call') call(it.call_id, it.name, it.arguments);
    else if (type === 'custom_tool_call') call(it.call_id, it.name, it.input);
    else if (type === 'local_shell_call') call(it.call_id, 'local_shell', it.action);
    else if (type.endsWith('_call_output')) results.set(String(it.call_id), asText(it.output));
    else if (type === 'message') texts.push(...strings(it.content));
  }
  return { calls, results, texts };
}

/** What one tool call names for opening: skill -> 'open' | 'section'. measureGstack counts it only when the result returns the body. */
export function callOpens(c: Call, r: Resolver): Map<string, 'open' | 'section'> {
  const out = new Map<string, 'open' | 'section'>();
  const input = (c.input && typeof c.input === 'object' ? c.input : {}) as Body;
  if (c.name === 'Skill' && typeof input.skill === 'string') {
    const s = r.name(input.skill);
    if (s) out.set(s, 'open');
    return out;
  }
  if ((c.name === 'skill_view' || c.name === 'skill') && typeof input.name === 'string') {
    const s = r.name(input.name);
    const file = typeof input.file_path === 'string' ? input.file_path.replace(/^\.\//, '') : '';
    if (s && (file === '' || file === 'SKILL.md')) out.set(s, 'open');
    else if (s && isSection(file)) out.set(s, 'section');
    return out;
  }
  for (const p of r.path(c.args)) {
    if (p.rest === 'SKILL.md') out.set(p.skill, 'open');
    else if (isSection(p.rest) && out.get(p.skill) !== 'open') out.set(p.skill, 'section');
  }
  return out;
}

const BASE_DIRECTORY = 'Base directory for this skill: ';

/** The text a tool result returns: a JSON result's content or output (Hermes), nothing for a failed one, else the result,
 *  with read tools' line numbers ("     1\t", "1|") taken off. */
function returnedText(result: string): string {
  const o = result.trimStart().startsWith('{') ? parsed(result) : null;
  const text = o && typeof o === 'object' ? (o.success === false ? '' : typeof o.content === 'string' ? o.content : typeof o.output === 'string' ? o.output : result) : result;
  return text.replace(/^[ \t]*\d+(?:\t|→|\|)/gm, '');
}

/** Whether a tool result returns a SKILL.md body (its frontmatter) or a section body (Markdown). */
const returnsBody = (result: string, kind: 'open' | 'section') =>
  (kind === 'open' ? /^---[ \t]*\r?\n(?:(?!---)[^\n]*\n)*?name:[ \t]*\S/m : /^(?:#{1,6}[ \t]|<!--)/m).test(returnedText(result));

export interface MeasureInput {
  cell: GstackCell; host: GstackHost; cellModel: string; lock: Lock; universe: Lock | null;
  /** The trial's captured requests, or null when there is no capture file. */
  requests: CapturedRequest[] | null;
  /** The proxy's input tokens over the trial's captured forwarded requests, and whether any request got a model answer. */
  inputTokens: number; answered: boolean;
  /** The capture ends in the proxy's truncation marker. */
  truncated?: boolean;
}

export function measureGstack(o: MeasureInput): GstackTrial {
  const r = resolver(o.lock, o.universe, o.host);
  const inLock = new Set(lockSkills(o.lock));
  const notListed = HOST_UNLISTED[o.host].filter((s) => inLock.has(s));
  const expected = [...inLock].filter((s) => !notListed.includes(s)).sort();
  const requests = o.requests ?? [];
  const first = agentLoopRequests(requests, o.cellModel)[0];
  const listedEntries = first ? listingEntries(first.body, o.host).map((e) => ({ e, skill: entrySkill(e, r) })).filter((x) => x.skill !== null) : [];
  const listed = [...new Set(listedEntries.map((x) => x.skill!))].sort();
  const exposure: GstackTrial['exposure'] = !first
    ? (o.answered ? 'mismatch' : 'not-applicable')
    : listed.length === expected.length && listed.every((s, i) => s === expected[i]) ? 'ok' : 'mismatch';

  const removed = new Set<string>();
  const seenText = new Set<string>();
  const seenCalls = new Set<string>();
  const opens: Record<string, number> = {}, sections: Record<string, number> = {};
  let bodyBytes = 0;
  const baseSkills = (t: string) => (t.startsWith(BASE_DIRECTORY) ? r.path(t.slice(BASE_DIRECTORY.length).split('\n')[0]!.trim().replace(/\/*$/, '/')).map((p) => p.skill) : []);
  const pending: Array<{ c: Call; got: Map<string, 'open' | 'section'> }> = [];
  for (const req of requests) {
    if (!req.body) continue;
    const w = walk(req.body);
    for (const t of contextStrings(req.body)) {
      if (seenText.has(t)) continue;
      seenText.add(t);
      for (const e of listingEntries({ system: t }, o.host)) { const s = entrySkill(e, r); if (s && !inLock.has(s)) removed.add(s); }
      for (const p of r.path(t)) if (!inLock.has(p.skill)) removed.add(p.skill);
      if (baseSkills(t).length) bodyBytes += Buffer.byteLength(t);
    }
    for (const c of w.calls) {
      if (seenCalls.has(c.id)) continue;
      seenCalls.add(c.id);
      for (const p of r.path(c.args)) if (!inLock.has(p.skill)) removed.add(p.skill);
      const got = callOpens(c, r);
      if (got.size) pending.push({ c, got });
    }
    const based = new Set(w.texts.flatMap(baseSkills));
    for (const p of pending.splice(0)) {
      const result = w.results.get(p.c.id);
      if (result === undefined) { pending.push(p); continue; }
      const skillTool = p.c.name === 'Skill' && typeof (p.c.input as Body | null)?.skill === 'string';
      const shown = [...p.got].filter(([s, kind]) => (skillTool ? based.has(s) : returnsBody(result, kind)));
      for (const [s, kind] of shown) {
        const tally = kind === 'open' ? opens : sections;
        tally[s] = (tally[s] ?? 0) + 1;
        if (!inLock.has(s)) removed.add(s);
      }
      if (shown.length) bodyBytes += Buffer.byteLength(result);
    }
  }
  const captured = requests.reduce((n, q) => n + q.bytes, 0);
  const fromProxy = o.inputTokens > 0 && captured > 0;
  const bpt = fromProxy ? captured / o.inputTokens : DEFAULT_BYTES_PER_TOKEN;
  const sortKeys = (x: Record<string, number>) => Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    arm: o.cell.arm, spec_sha256: o.cell.spec_sha256, lock: o.cell.lock, expected, listed, exposure, not_listed_by_host: notListed,
    removed_seen: [...removed].sort(), opens: sortKeys(opens), section_reads: sortKeys(sections),
    listing_bytes: listedEntries.reduce((n, x) => n + Buffer.byteLength(x.e.text), 0),
    opened_body_bytes: bodyBytes, opened_body_tokens: Math.round(bodyBytes / bpt), bytes_per_token: Number(bpt.toFixed(4)), bytes_per_token_source: fromProxy ? 'proxy' : 'default',
    capture_truncated: o.truncated ?? false,
  };
}

/** The one-line reason an exposure mismatch gives, for the record's error: unchecked when there is no capture file or the
 *  capture holds no agent-loop request. */
export function exposureError(g: GstackTrial, unchecked: 'no capture' | 'no agent-loop request' | null): string {
  if (unchecked === 'no capture') return EXPOSURE_CODE + ' gstack exposure unchecked: the trial got model answers but has no captured request bodies, so nothing shows which skills it listed (arm ' + g.arm + ', lock ' + g.lock + '); excluded pairwise';
  if (unchecked) return EXPOSURE_CODE + ' gstack exposure unchecked: the trial got model answers but its capture holds no agent-loop request to inspect (empty, cut before the first request, or only other requests), so nothing shows which skills it listed (arm ' + g.arm + ', lock ' + g.lock + '); excluded pairwise';
  const missing = g.expected.filter((s) => !g.listed.includes(s)), extra = g.listed.filter((s) => !g.expected.includes(s));
  return EXPOSURE_CODE + ' gstack exposure mismatch: the first agent-loop request listed ' + g.listed.length + ' gstack skill(s), the lock ' + g.lock + ' (arm ' + g.arm + ') expects ' + g.expected.length
    + '; missing [' + missing.join(', ') + '], extra [' + extra.join(', ') + ']; excluded pairwise';
}
