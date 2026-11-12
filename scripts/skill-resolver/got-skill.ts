#!/usr/bin/env bun
// "Got the skill" (internal-task): which catalog skills a trial opened, from its captured model requests and its tool trace.
//
//   bun scripts/skill-resolver/got-skill.ts --harness <openclaw|claude-code|codex|hermes> --catalog <manifest.json | names file>
//       [--requests <fake.ndjson or proxy capture>]... [--trace <harness event log>]... [--json]
//
// A skill counts as opened when the agent:
//   OpenClaw     called skills_read (directly or through tool_call), or read a <name>/SKILL.md file (read, or exec running a reader)
//   Claude Code  called the Skill tool, or read a <name>/SKILL.md file (Read, or Bash running a reader)
//   Codex        read a <name>/SKILL.md file (its shell tools running a reader; in code mode, a reader command in a string of
//                exec's JavaScript), or named it as $<name> in a user message
//   Hermes       called skill_view (a category/name selector counts as name), or read a <name>/SKILL.md file (read_file, or
//                terminal running a reader)
// Only a read counts (PREREGISTRATION.md, "a SKILL.md read"): the harness's file-read tool (READ_TOOL), or its shell tool
// (SHELL_TOOL) when the command segment that names the path runs a reader (READERS: cat, head, tail, sed without -i, less, more,
// nl, awk, bat, tac, as harnesses/qm/skill-opens.ts counts QM's execute reads) and the path is not a redirect target. A Write, Edit or patch, an echo, a grep, find or ls, or any other tool
// that names the path is not an open.
// A call whose tool result says the tool or file was not found (or is marked is_error) is listed with ok false and does not
// count. Tool calls come from every assistant tool call carried in the requests (Anthropic Messages tool_use blocks, Responses
// function_call, custom_tool_call and local_shell_call items) and, when given, the harness's own trace: Claude Code stream-json
// (assistant tool_use records) and Codex exec --json events (command_execution items). Calls are deduplicated by call id.
// A skill that is not in the catalog (a bundled or system skill) is listed under other.

import { existsSync, readFileSync } from 'node:fs';

export type Harness = 'openclaw' | 'claude-code' | 'codex' | 'hermes';
export type ToolCall = { id: string | null; name: string; input: unknown; ok: boolean | null; source: 'request' | 'trace'; result?: string };
export type Opened = { skill: string; via: string; ok: boolean; call_id: string | null; source: 'request' | 'trace' | 'user'; catalog: boolean };
export type GotSkill = { harness: Harness; opened: Opened[]; catalog_opened: string[]; other_opened: string[]; failed: Opened[]; tool_calls: number };

const SKILL_TOOL: Record<Harness, string | null> = { openclaw: 'skills_read', 'claude-code': 'Skill', codex: null, hermes: 'skill_view' };
/** Each harness's file-read tool: any SKILL.md path in its input is a read. */
const READ_TOOL: Record<Harness, string[]> = { openclaw: ['read'], 'claude-code': ['Read'], codex: [], hermes: ['read_file'] };
/** Each harness's shell tool (Codex: its exec tools, the Responses local_shell call and its exec --json command_execution items). */
const SHELL_TOOL: Record<Harness, string[]> = { openclaw: ['exec'], 'claude-code': ['Bash'], codex: ['exec', 'exec_command', 'shell', 'local_shell', 'command_execution'], hermes: ['terminal'] };
const READERS = new Set(['cat', 'head', 'tail', 'sed', 'less', 'more', 'nl', 'awk', 'bat', 'batcat', 'tac']);
const LEAD = new Set(['env', 'sudo', 'command', 'time', 'nice', 'exec']);

/** The arguments a shell command reads as files: each command segment (split at ; & | newlines, $( and backticks, with a
 *  bash/sh -c wrapper and its quotes taken off) whose program is a reader gives its arguments that are not a redirect target
 *  (> or >>), and, for sed, only without -i. */
export function shellReadArgs(command: string): string[] {
  const out: string[] = [];
  for (const seg of command.split(/&&|\|\||[;&|\n]|\$\(|`|[()]/)) {
    const words = seg.replace(/['"]/g, ' ').split(/\s+/).filter(Boolean);
    while (words.length && (LEAD.has(words[0]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!))) words.shift();
    while (words.length > 1 && /^(?:ba|z|da)?sh$/.test(words[0]!.split('/').pop()!) && /^-[a-z]*c[a-z]*$/.test(words[1]!)) words.splice(0, 2);
    const prog = words[0]?.split('/').pop();
    if (!prog || !READERS.has(prog) || (prog === 'sed' && words.some((w) => /^-[a-zA-Z]*i/.test(w) || w.startsWith('--in-place')))) continue;
    words.slice(1).forEach((w, i, rest) => {
      if (/^\d*>>?/.test(w) || /^\d*>>?$/.test(rest[i - 1] ?? '')) return;
      out.push(w);
    });
  }
  return out;
}

/** The skill names whose <name>/SKILL.md a shell command reads (shellReadArgs). */
export const shellReads = (command: string): string[] => shellReadArgs(command).flatMap((w) => [...w.matchAll(SKILL_MD)].map((m) => m[1]!));
const FAILED = /\bnot found\b|unknown tool|no such file|ENOENT|does not exist|is not a known skill/i;
const SKILL_MD = /([A-Za-z0-9._-]+)\/SKILL\.md\b/g;

const parseJson = (s: unknown): unknown => { if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return s; } };
/** The string literals of a Codex code-mode exec body, JavaScript such as tools.exec_command({"cmd":"cat a/SKILL.md"}). */
const codeStrings = (code: string): string[] => [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)]
  .map((m) => m[1] !== undefined ? String(parseJson('"' + m[1] + '"')) : (m[2] ?? m[3])!);
const textOf = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' ? String((x as { text?: unknown }).text ?? (x as { output?: unknown }).output ?? '') : String(x))).join('\n') : c && typeof c === 'object' ? String((c as { text?: unknown }).text ?? '') : '';

/** Every tool call an Anthropic Messages or Responses request body carries in its history, with the result's verdict and text. */
export function callsFromRequest(body: unknown): ToolCall[] {
  const b = (body ?? {}) as { messages?: unknown[]; input?: unknown[] };
  const calls: ToolCall[] = [], results = new Map<string, boolean>(), texts = new Map<string, string>();
  for (const m of Array.isArray(b.messages) ? b.messages : []) {
    const content = (m as { content?: unknown }).content;
    for (const blk of Array.isArray(content) ? content as Record<string, unknown>[] : []) {
      if (blk?.type === 'tool_use') calls.push({ id: (blk.id as string) ?? null, name: String(blk.name), input: blk.input, ok: null, source: 'request' });
      if (blk?.type === 'tool_result') { results.set(String(blk.tool_use_id), !(blk.is_error === true || FAILED.test(textOf(blk.content).slice(0, 400)))); texts.set(String(blk.tool_use_id), textOf(blk.content)); }
    }
  }
  for (const it of Array.isArray(b.input) ? b.input as Record<string, unknown>[] : []) {
    if (it?.type === 'function_call' || it?.type === 'custom_tool_call') calls.push({ id: (it.call_id as string) ?? null, name: String(it.name), input: parseJson(it.arguments ?? it.input), ok: null, source: 'request' });
    if (it?.type === 'local_shell_call') calls.push({ id: (it.call_id as string) ?? null, name: 'local_shell', input: it.action, ok: null, source: 'request' });
    if (it?.type === 'function_call_output' || it?.type === 'custom_tool_call_output' || it?.type === 'local_shell_call_output') {
      const out = parseJson(it.output);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      results.set(String(it.call_id), !FAILED.test(text.slice(0, 400)));
      texts.set(String(it.call_id), text);
    }
  }
  for (const c of calls) if (c.id && results.has(c.id)) { c.ok = results.get(c.id)!; c.result = texts.get(c.id); }
  return calls;
}

/** The user messages of a request (Codex $name mentions). */
export function userTexts(body: unknown): string[] {
  const b = (body ?? {}) as { messages?: { role?: string; content?: unknown }[]; input?: { role?: string; type?: string; content?: unknown }[] };
  return [...(b.messages ?? []).filter((m) => m.role === 'user').map((m) => textOf(m.content)), ...(b.input ?? []).filter((i) => i.role === 'user').map((i) => textOf(i.content))];
}

/** Tool calls from a harness's own event log: Claude Code stream-json, Codex exec --json. Other lines are ignored. */
export function callsFromTrace(lines: string[]): ToolCall[] {
  const calls: ToolCall[] = [], results = new Map<string, boolean>(), texts = new Map<string, string>();
  for (const l of lines) {
    if (!l.trim()) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(l); } catch { continue; }
    const content = (ev.message as { content?: unknown } | undefined)?.content;
    for (const blk of Array.isArray(content) ? content as Record<string, unknown>[] : []) {
      if (ev.type === 'assistant' && blk?.type === 'tool_use') calls.push({ id: (blk.id as string) ?? null, name: String(blk.name), input: blk.input, ok: null, source: 'trace' });
      if (ev.type === 'user' && blk?.type === 'tool_result') { results.set(String(blk.tool_use_id), !(blk.is_error === true || FAILED.test(textOf(blk.content).slice(0, 400)))); texts.set(String(blk.tool_use_id), textOf(blk.content)); }
    }
    const item = ev.item as Record<string, unknown> | undefined;
    if (ev.type === 'item.completed' && item?.type === 'command_execution') {
      const exit = item.exit_code;
      calls.push({ id: (item.id as string) ?? null, name: 'command_execution', input: { command: item.command }, ok: typeof exit === 'number' ? exit === 0 : null, source: 'trace', ...(typeof item.aggregated_output === 'string' ? { result: item.aggregated_output } : {}) });
    }
  }
  for (const c of calls) if (c.id && results.has(c.id) && c.ok === null) { c.ok = results.get(c.id)!; c.result = texts.get(c.id); }
  return calls;
}

/** Unwrap a deferred-tool call (OpenClaw and Hermes tool_call) into the calls it makes. */
function unwrap(c: ToolCall): ToolCall[] {
  if (c.name !== 'tool_call' && c.name !== 'call_tool') return [c];
  const i = (c.input ?? {}) as Record<string, unknown>;
  const inner = Array.isArray(i.calls) ? i.calls as Record<string, unknown>[] : [i];
  return inner.filter((x) => typeof (x.name ?? x.tool) === 'string').map((x) => ({ ...c, name: String(x.name ?? x.tool), input: parseJson(x.arguments ?? x.args ?? x.input ?? {}) }));
}

export function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** Every tool call in the request bodies and traces, deferred calls unwrapped, deduplicated by call id (a call with a verdict
 *  replaces the same call without one). */
export function toolCalls(requests: unknown[], traces: string[][] = []): ToolCall[] {
  const seen = new Map<string, ToolCall>();
  const add = (c: ToolCall) => { const key = c.id ? c.id + ':' + c.name : c.source + ':' + c.name + ':' + JSON.stringify(c.input); const prev = seen.get(key); if (!prev || (prev.ok === null && c.ok !== null)) seen.set(key, c); };
  for (const body of requests) callsFromRequest(body).flatMap(unwrap).forEach(add);
  for (const t of traces) callsFromTrace(t).flatMap(unwrap).forEach(add);
  return [...seen.values()];
}

/** What a tool call reads as files, by the read definition above: every string of the harness's file-read tool's input, and
 *  the reader arguments of its shell tool's command (Codex code mode: of each string in exec's JavaScript). [] for any other call. */
export function readArgs(harness: Harness, c: ToolCall): string[] {
  const read = READ_TOOL[harness].includes(c.name), shell = SHELL_TOOL[harness].includes(c.name);
  if (!read && !shell) return [];
  const texts = shell && harness === 'codex' && c.name === 'exec' && typeof c.input === 'string' ? codeStrings(c.input) : strings(c.input);
  return read ? texts : texts.flatMap(shellReadArgs);
}

export function gotSkill(opts: { harness: Harness; catalog: string[]; requests: unknown[]; traces?: string[][] }): GotSkill {
  const catalog = new Set(opts.catalog);
  const calls = toolCalls(opts.requests, opts.traces);
  const users = new Set(opts.requests.flatMap(userTexts));
  const opened: Opened[] = [];
  const skillTool = SKILL_TOOL[opts.harness];
  for (const c of calls) {
    const ok = c.ok !== false;
    if (skillTool && c.name === skillTool) {
      const i = (c.input ?? {}) as Record<string, unknown>;
      const sel = [i.name, i.skill, i.id, i.command].find((x) => typeof x === 'string') as string | undefined;
      if (sel) { const skill = sel.replace(/^\//, '').split(/\s/)[0]!.split('/').pop()!; opened.push({ skill, via: c.name, ok, call_id: c.id, source: c.source, catalog: catalog.has(skill) }); }
      continue;
    }
    for (const s of readArgs(opts.harness, c)) {
      for (const m of s.matchAll(SKILL_MD)) {
        const skill = m[1]!;
        if (skill === '.system' || skill === 'skills') continue;
        opened.push({ skill, via: 'SKILL.md via ' + c.name, ok, call_id: c.id, source: c.source, catalog: catalog.has(skill) });
      }
    }
  }
  if (opts.harness === 'codex') {
    for (const t of users) for (const m of t.matchAll(/(?:^|[^A-Za-z0-9_$])\$([a-z0-9][a-z0-9._-]*)/g)) {
      if (catalog.has(m[1]!)) opened.push({ skill: m[1]!, via: '$name', ok: true, call_id: null, source: 'user', catalog: true });
    }
  }
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return {
    harness: opts.harness, opened, tool_calls: calls.length,
    catalog_opened: uniq(opened.filter((o) => o.ok && o.catalog).map((o) => o.skill)),
    other_opened: uniq(opened.filter((o) => o.ok && !o.catalog).map((o) => o.skill)),
    failed: opened.filter((o) => !o.ok),
  };
}

/** Request bodies from a fake.ndjson capture ({method, path, body} lines) or plain body lines. */
export function readRequests(path: string): unknown[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { const r = JSON.parse(l) as Record<string, unknown>; return r.body && typeof r.body === 'object' ? [r.body] : r.messages || r.input ? [r] : []; } catch { return []; }
  });
}

export function readCatalogNames(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  try { const m = JSON.parse(text) as { skills?: { name: string }[] }; if (Array.isArray(m.skills)) return m.skills.map((s) => s.name); } catch { /* a names file */ }
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const all = (n: string) => argv.flatMap((a, i) => (a === '--' + n && argv[i + 1] ? [argv[i + 1]!] : []));
  const harness = all('harness')[0] as Harness | undefined, catalog = all('catalog')[0];
  if (!harness || !SKILL_TOOL.hasOwnProperty(harness) || !catalog) { console.error('usage: got-skill.ts --harness <openclaw|claude-code|codex|hermes> --catalog <manifest.json|names> [--requests <file>]... [--trace <file>]... [--json]'); process.exit(2); }
  const missing = [...all('requests'), ...all('trace'), catalog].filter((p) => !existsSync(p));
  if (missing.length) { console.error('got-skill: missing ' + missing.join(', ')); process.exit(2); }
  const r = gotSkill({ harness, catalog: readCatalogNames(catalog), requests: all('requests').flatMap(readRequests), traces: all('trace').map((p) => readFileSync(p, 'utf8').split('\n')) });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else console.log('GOT ' + harness + ' catalog=' + (r.catalog_opened.join(',') || '-') + ' other=' + (r.other_opened.join(',') || '-') + ' failed=' + r.failed.length + ' tool_calls=' + r.tool_calls);
}
