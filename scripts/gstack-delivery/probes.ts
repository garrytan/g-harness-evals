#!/usr/bin/env bun
// Step-compliance probes for the gstack delivery eval (internal-task, plan decision 5 and gate changes d5, d12, d13): what the agent
// did, read from the metering proxy's request captures, scored against the steps-card lines the task text does not already
// demand. Keyless; it reads files and never calls a model.
//
//   bun scripts/gstack-delivery/probes.ts --trial <id> --capture <proxy-requests.ndjson> --kind review|ship
//       --arm none|skill|hook|startup|placebo [--termination <t>] [--responses <file>] [--requests-metered <n>]
//       [--expect <file>] [--out <file>]
//   bun scripts/gstack-delivery/probes.ts --batch <trials.jsonl> [--out <probes.jsonl>]
//       (one JSON object per line: trial_id, capture, kind, arm, and optionally termination, responses, requests_metered, expect)
//
// Input: the capture runner/proxy/capture.ts writes for a slot bound with capture (<trial>/proxy-capture/proxy-requests.ndjson
// on a frontier Harbor run): one line per request the proxy forwarded, {"seq", "prev", "route", "body"}, hash-chained, with a
// {"truncated": true} line when the size cap was reached. Three wire formats are read: Anthropic Messages, OpenAI Responses and
// OpenAI Chat Completions. Each request carries the history so far, so the agent's tool calls are read from every request in
// order and deduplicated by call id (by name, arguments and position in the request when a call has no id). A Responses request
// that continues a stored response (previous_response_id) is PROBE_INCOMPLETE: its earlier tool calls are not in the capture.
//
// Output: one JSON line per trial on stdout (or --out).
//   - status "scored": the markers, each mapped to exactly one card line of harnesses/routes/gstack-cards/selection.json
//     (met, not_met, n/a, unobservable or unscorable), compliance (met over applicable; null when any marker is unobservable or
//     unscorable), followed (every applicable marker met), the card delivery check for the hook, startup and placebo arms, and
//     gstack_reads (tool calls naming a gstack skill file or install, the clean-arm count of CREW.md "Clean no-gstack arms").
//   - status "unparsed": an empty, unparseable, truncated, unchained, incomplete or unknown-wire capture, with a stable code, the
//     trial id and the wire format. It is never scored, so a parse failure can never read as 0 steps (d13). The script exits 3
//     after writing every line when any trial is unparsed, and 2 on a usage error.
//
// Codes: PROBE_CAPTURE_MISSING, PROBE_CAPTURE_EMPTY, PROBE_LINE_JSON, PROBE_CHAIN_BROKEN, PROBE_TRUNCATED, PROBE_INCOMPLETE,
// PROBE_WIRE_UNKNOWN, PROBE_RESPONSE_UNPARSED.
//
// Delivery (d12): on a hook, startup or placebo arm the expected text (the kind's card, or --expect) must be in the first agent
// request (the first request that declares tools; a harness's housekeeping call declares none). Absent, the trial gets
// infra_class "route_not_delivered", which the analysis excludes pairwise and counts. Copies per request are reported (d1).
//
// The last action (d13): request captures never show the model's final response. With a response capture (--responses, one
// JSON line per response, {"seq", "route", "body"} with the provider's response body; the metering proxy writes none today)
// the final response's tool calls are added to the session. Without one, a trial whose termination is "completed" is taken to
// have ended on a reply with no tool call (every harness here ends its loop that way); any other termination leaves the last
// action unobservable, and a marker that one more action could turn from not met to met reads "unobservable", not 0.
//
// Chains: a step that earns a marker (a test, check, diff or read) and runs only if an earlier command of its && or || chain
// succeeded or failed counts only when the capture shows it ran: the call's exit status (Claude Code's is_error, an
// "Exit code N" line or a JSON exit_code in the tool result) is 0 and the step sits in an all-&& chain at the end of the
// command. When the status shows the call failed, the step earns nothing. When the capture shows no status that settles it
// (Codex's exec tool, a chain after ||, a chain that a later ; or newline follows), a marker that only such a step would
// meet reads "unobservable", as for the unseen last action, never met. A cd is no gate. Writes, merges, commits and pushes
// in a chain always count, since they may have run.
//
// Markers (each on one card line; a step the task text already demands has none):
//   review.full_diff_first      a full diff of the branch against the base (git diff <base-ish ref>, or git log -p over a range;
//                               not --stat or --name-only, not limited to paths, not piped to head or tail) before the first
//                               write of review.json
//   review.check_before_finding a check run before the last write of review.json that is not a reported finding's test: python
//                               -c, a python heredoc or script, or pytest on a file the final review.json does not list
//   review.test_per_finding     for every finding the final review.json reports, its test file was written in a captured
//                               action and then run by pytest (named, or its directory) after its last write, all before the
//                               first write of review.json that lists that finding (the card line: for an approved defect,
//                               write the test and prove it fails before going further; this task changes no product code, so
//                               the write-up is the anchor). When review.json cannot be read, every out/tests/*.py file
//                               written before its last write stands in for the findings, anchored on that last write.
//                               n/a when review.json lists no finding; unscorable when it cannot be read and no test file
//                               write was seen
//   ship.fresh_verification     a full test-suite run (pytest with no node id, no -k, -m, --deselect or --lf selection, and no
//                               file target other than a test_*.py or *_test.py at the top of the repository, as its own
//                               documented command names one; unittest, tox, nox, make test) after
//                               the last change to the repository's files and before the last push of the branch (the card
//                               line "IRON LAW: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE"). A change is any
//                               file write in the repository, CHANGELOG and VERSION edits included (an editor or patch tool,
//                               a shell redirect, tee, sed -i, perl -i, cp, mv, rm, touch, a Python script that writes a
//                               file), a merge, rebase or pull of the base, and a git command that rewrites files (apply,
//                               restore, checkout, switch, reset --hard, --keep or --merge, stash pop or apply, cherry-pick, am,
//                               revert; a checkout or switch that only creates a branch at HEAD is no change). Writes outside
//                               /work (under /tmp, ~, $HOME, $GSTACK_STATE_ROOT or any variable but $PWD) do not count
//   ship.final_diff_after_commit a full diff against the base after the last commit and before the last push of the branch
//
// Descriptive only (reported under "descriptive", never part of compliance or followed; gate change d5 after the first
// headroom check, where the none arm already met it in 87.5% of ship trials):
//   ship.tests_after_merge      a full test-suite run after the last merge or rebase of the base and before the last push
// git show is not counted as a diff view: it shows one commit, not the branch against the base.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { CARDS_DIR, loadSelection, sha256, type Selection } from './extract-cards.ts';

// The same pattern as scripts/frontier-harbor/audit.ts's GSTACK_FILE, copied because the public copy leaves audit.ts out;
// tests/gstack-delivery-prereg.test.ts checks the two stay equal.
export const GSTACK_FILE = /(?:\bgstack\/(?:[\w.-]+\/)*SKILL\.md\b|\.claude\/skills\/gstack\b|\.local\/share\/gstack\b|skills\/gstack\/|skills\/gstack-[\w.-]+\/)/i;

export type Wire = 'anthropic-messages' | 'openai-responses' | 'openai-chat';
export type Kind = 'review' | 'ship';
export type Arm = 'none' | 'skill' | 'hook' | 'startup' | 'placebo';
export const ARMS: readonly Arm[] = ['none', 'skill', 'hook', 'startup', 'placebo'];
export const DELIVERY_ARMS: ReadonlySet<Arm> = new Set<Arm>(['hook', 'startup', 'placebo']);
export const UNPARSED_CODES = ['PROBE_CAPTURE_MISSING', 'PROBE_CAPTURE_EMPTY', 'PROBE_LINE_JSON', 'PROBE_CHAIN_BROKEN', 'PROBE_TRUNCATED',
  'PROBE_INCOMPLETE', 'PROBE_WIRE_UNKNOWN', 'PROBE_RESPONSE_UNPARSED'] as const;
export type UnparsedCode = (typeof UNPARSED_CODES)[number];

export const MARKERS: Record<string, Kind> = {
  'review.full_diff_first': 'review',
  'review.check_before_finding': 'review',
  'review.test_per_finding': 'review',
  'ship.fresh_verification': 'ship',
  'ship.final_diff_after_commit': 'ship',
};
/** Counted and reported per trial, never part of compliance or followed. */
export const DESCRIPTIVE: Record<string, Kind> = {
  'ship.tests_after_merge': 'ship',
};
export type MarkerState = 'met' | 'not_met' | 'n/a' | 'unobservable' | 'unscorable';

export class Unparsed extends Error {
  constructor(readonly code: UnparsedCode, readonly wire: Wire | 'unknown', readonly detail: string) { super(code + ': ' + detail); }
}

// ---- reading a capture

export interface CaptureBody { seq: number; route: string; body: Record<string, unknown>; wire: Wire; agent: boolean }

const chainKey = (line: string) => sha256(line).slice(0, 16);

export function wireOf(route: string, body: Record<string, unknown>): Wire | null {
  if (/\/chat\/completions/.test(route)) return 'openai-chat';
  if (/\/responses\b/.test(route)) return 'openai-responses';
  if (/\/messages\b/.test(route)) return 'anthropic-messages';
  if ('input' in body || 'instructions' in body) return 'openai-responses';
  if (!Array.isArray(body.messages)) return null;
  const anthropic = 'system' in body && !(body.messages as Array<{ role?: unknown }>).some((m) => m?.role === 'system')
    || (body.messages as Array<{ content?: unknown }>).some((m) => Array.isArray(m?.content) && (m.content as Array<{ type?: unknown }>).some((b) => b?.type === 'tool_use' || b?.type === 'tool_result'));
  return anthropic ? 'anthropic-messages' : 'openai-chat';
}

/** Whether a request declares tools: in body.tools, or (Codex 0.165 and later) in an additional_tools input item. */
export function declaresTools(body: Record<string, unknown>): boolean {
  if (Array.isArray(body.tools) && body.tools.length > 0) return true;
  return Array.isArray(body.input) && (body.input as Array<{ type?: unknown; tools?: unknown }>).some((it) => it?.type === 'additional_tools' && Array.isArray(it.tools) && it.tools.length > 0);
}

/** The request bodies of one capture, chain checked. Throws Unparsed. requestsMetered: the slot's metered request count, when known. */
export function readCaptureText(text: string, requestsMetered: number | null = null): { bodies: CaptureBody[]; wire: Wire } {
  if (!text.trim()) throw new Unparsed('PROBE_CAPTURE_EMPTY', 'unknown', 'the capture has no lines');
  if (!text.endsWith('\n')) throw new Unparsed('PROBE_TRUNCATED', 'unknown', 'the capture does not end with a newline: its last line was cut');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const bodies: CaptureBody[] = [];
  let prev = '', wire: Wire | 'unknown' = 'unknown';
  lines.forEach((raw, i) => {
    let e: { seq?: unknown; prev?: unknown; route?: unknown; body?: unknown; truncated?: unknown };
    try { e = JSON.parse(raw); } catch { throw new Unparsed('PROBE_LINE_JSON', wire, 'line ' + (i + 1) + ' is not JSON'); }
    if (!e || typeof e !== 'object') throw new Unparsed('PROBE_LINE_JSON', wire, 'line ' + (i + 1) + ' is not a capture line');
    if (e.seq !== i || e.prev !== prev) throw new Unparsed('PROBE_CHAIN_BROKEN', wire, 'line ' + (i + 1) + ' has seq ' + JSON.stringify(e.seq) + ' and prev ' + JSON.stringify(e.prev) + '; the chain expects ' + i + ' and ' + JSON.stringify(prev));
    prev = chainKey(raw);
    if (e.truncated === true) throw new Unparsed('PROBE_TRUNCATED', wire, 'line ' + (i + 1) + ' is the size cap marker: requests after it were not captured');
    if (typeof e.route !== 'string') throw new Unparsed('PROBE_LINE_JSON', wire, 'line ' + (i + 1) + ' has no route');
    if (e.body === null || e.body === undefined) return;
    const body = typeof e.body === 'string' ? (() => { try { return JSON.parse(e.body as string); } catch { return null; } })() : e.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Unparsed('PROBE_LINE_JSON', wire, 'line ' + (i + 1) + ' has a body that is not a JSON object');
    if (/count_tokens/.test(e.route)) return;
    const w = wireOf(e.route, body as Record<string, unknown>);
    if (!w) throw new Unparsed('PROBE_WIRE_UNKNOWN', wire, 'line ' + (i + 1) + ' (' + e.route + ') is none of Anthropic Messages, OpenAI Responses or Chat Completions');
    if (wire === 'unknown') wire = w;
    if (w === 'openai-responses' && typeof (body as { previous_response_id?: unknown }).previous_response_id === 'string') throw new Unparsed('PROBE_INCOMPLETE', w, 'line ' + (i + 1) + ' continues a stored response (previous_response_id), so earlier tool calls are not in the capture');
    bodies.push({ seq: i, route: e.route, body: body as Record<string, unknown>, wire: w, agent: declaresTools(body as Record<string, unknown>) });
  });
  if (requestsMetered !== null && lines.length < requestsMetered) throw new Unparsed('PROBE_INCOMPLETE', wire, lines.length + ' captured requests, ' + requestsMetered + ' metered');
  if (!bodies.length) throw new Unparsed('PROBE_CAPTURE_EMPTY', wire, 'no captured request has a body');
  if (!bodies.some((b) => b.agent)) for (const b of bodies) b.agent = true;
  const agentWire = bodies.find((b) => b.agent)!.wire;
  const mixed = bodies.find((b) => b.agent && b.wire !== agentWire);
  if (mixed) throw new Unparsed('PROBE_WIRE_UNKNOWN', agentWire, 'agent requests mix ' + agentWire + ' and ' + mixed.wire + ' (line ' + (mixed.seq + 1) + ')');
  return { bodies, wire: agentWire };
}

// ---- tool calls

/** status: the exit status the capture shows for the call ('ok' or 'failed'), or null when it shows none. */
export interface Call { key: string; request: number; name: string; args: Record<string, unknown>; command: string | null; cwd: string | null; paths: string[]; content: string | null; raw: string; status: 'ok' | 'failed' | null; from_response?: boolean }

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const parseArgs = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') { try { const o = JSON.parse(v); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* a raw string input */ } return { input: v }; }
  return {};
};

function commandOf(name: string, a: Record<string, unknown>): string | null {
  for (const k of ['command', 'cmd', 'script']) {
    const v = a[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length) {
      const xs = v as string[];
      return /^(?:\/bin\/|\/usr\/bin\/)?(?:ba|z|da)?sh$/.test(xs[0]!) && /^-\w*c$/.test(xs[1] ?? '') ? xs.slice(2).join(' ') : xs.join(' ');
    }
  }
  const action = a.action as { command?: unknown } | undefined;
  if (action && Array.isArray(action.command)) return commandOf(name, { command: action.command });
  if (typeof a.code === 'string' && /code|python|exec/i.test(name)) return "python - <<'PY'\n" + a.code + '\nPY';
  return null;
}

function patchFiles(patch: string): Array<{ path: string; content: string | null }> {
  const out: Array<{ path: string; content: string | null }> = [];
  let cur: { path: string; lines: string[] | null } | null = null;
  for (const l of patch.split('\n')) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(l);
    if (m) { if (cur) out.push({ path: cur.path, content: cur.lines?.join('\n') ?? null }); cur = { path: m[2]!.trim(), lines: m[1] === 'Add' ? [] : null }; continue; }
    if (cur?.lines && l.startsWith('+')) cur.lines.push(l.slice(1));
  }
  if (cur) out.push({ path: cur.path, content: cur.lines?.join('\n') ?? null });
  return out;
}

function makeCall(key: string, request: number, name: string, a: Record<string, unknown>, status: Call['status'] = null): Call {
  const command = commandOf(name, a);
  const cwd = typeof a.workdir === 'string' ? a.workdir : typeof a.cwd === 'string' ? a.cwd : null;
  const paths = ['file_path', 'path', 'filename', 'file', 'target_file', 'notebook_path'].map((k) => a[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  let content: string | null = null;
  for (const k of ['content', 'file_text', 'contents']) if (typeof a[k] === 'string') { content = a[k] as string; break; }
  const patch = typeof a.input === 'string' && /\*\*\* (Add|Update) File:/.test(a.input) ? a.input : typeof a.patch === 'string' ? a.patch : null;
  if (patch) for (const f of patchFiles(patch)) { paths.push(f.path); if (f.content !== null && /review\.json$/.test(f.path)) content = f.content; }
  return { key, request, name, args: a, command, cwd, paths, content, raw: name + ' ' + JSON.stringify(a), status };
}

/** The JSON object a text opens with, read up to its closing brace so text after it (a hook's card appended to the tool
 *  result) cannot hide it; null when the text does not open with one. */
function leadingJson(text: string): string | null {
  const start = text.search(/\S/);
  if (text[start] !== '{') return null;
  let depth = 0, quoted = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) { if (ch === '\\') i++; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** The exit code a tool result states: a JSON exit_code (top level or under metadata) in the JSON object it opens with, or an
 *  "Exit code N" or "Process exited with code N" line; null when it states none. */
function exitCode(output: unknown): number | null {
  const text = typeof output === 'string' ? output : Array.isArray(output) ? output.map((p) => (typeof p === 'string' ? p : str((p as { text?: unknown })?.text))).join('\n') : '';
  const json = leadingJson(text);
  if (json !== null) {
    try {
      const o = JSON.parse(json) as { exit_code?: unknown; metadata?: { exit_code?: unknown } };
      const code = typeof o.exit_code === 'number' ? o.exit_code : o.metadata?.exit_code;
      if (typeof code === 'number') return code;
    } catch { /* not JSON */ }
  }
  const m = /^(?:Exit code:?|Process exited with code)\s*(-?\d+)\s*$/m.exec(text);
  return m ? Number(m[1]) : null;
}
const statusOf = (code: number | null): Call['status'] => (code === null ? null : code === 0 ? 'ok' : 'failed');

/** A JavaScript string literal at s[i] (after spaces): its value and the index after it; null when it is not a literal or
 *  is a template literal with a substitution. */
function jsString(s: string, i: number): { value: string; end: number } | null {
  while (/\s/.test(s[i] ?? '')) i++;
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '' };
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j]!;
    if (ch === q) return { value: out, end: j + 1 };
    if (q === '`' && ch === '$' && s[j + 1] === '{') return null;
    if (ch !== '\\') { out += ch; continue; }
    const n = s[++j] ?? '';
    if (n in esc) out += esc[n];
    else if (n === 'x') { out += String.fromCharCode(parseInt(s.slice(j + 1, j + 3), 16)); j += 2; }
    else if (n === 'u' && s[j + 1] === '{') { const k = s.indexOf('}', j); out += String.fromCodePoint(parseInt(s.slice(j + 2, k), 16)); j = k; }
    else if (n === 'u') { out += String.fromCharCode(parseInt(s.slice(j + 1, j + 5), 16)); j += 4; }
    else out += n;
  }
  return null;
}

/** The literal string properties of a JavaScript object literal at s[i] ('{'), e.g. { cmd: "git diff", workdir: '/work' };
 *  null when it is not an object literal. Non-literal values are skipped. */
function jsObject(s: string, i: number): Record<string, string> | null {
  while (/\s/.test(s[i] ?? '')) i++;
  if (s[i] !== '{') return null;
  const out: Record<string, string> = {};
  let j = i + 1;
  for (;;) {
    while (/[\s,]/.test(s[j] ?? '')) j++;
    if (j >= s.length) return null;
    if (s[j] === '}') return out;
    const quoted = jsString(s, j);
    const ident = quoted ? null : /^[A-Za-z_$][\w$]*/.exec(s.slice(j));
    if (!quoted && !ident) return null;
    const key = quoted ? quoted.value : ident![0];
    j = quoted ? quoted.end : j + ident![0].length;
    while (/\s/.test(s[j] ?? '')) j++;
    if (s[j] !== ':') return null;
    const v = jsString(s, j + 1);
    if (v) { out[key] = v.value; j = v.end; continue; }
    let depth = 0;
    for (j++; j < s.length; j++) {
      const lit = /["'`]/.test(s[j]!) ? jsString(s, j) : null;
      if (lit) { j = lit.end - 1; continue; }
      if ('([{'.includes(s[j]!)) depth++;
      else if (')]}'.includes(s[j]!)) { if (depth === 0) break; depth--; }
      else if (s[j] === ',' && depth === 0) break;
    }
  }
}

/** The nested tool calls in the source of Codex's code-mode exec tool (Codex 0.165 and later), whose shell and patch tools
 *  are tools.exec_command({ cmd, workdir }) and tools.apply_patch(<patch>) inside JavaScript. A nested call whose argument
 *  is not a literal cannot be read; then whole is true and the exec call is kept as well, so its text still counts for
 *  gstack_reads. */
export function execNestedCalls(src: string): { calls: Array<{ name: string; args: Record<string, unknown> }>; whole: boolean } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let whole = false;
  for (const m of src.matchAll(/\btools\s*\.\s*(exec_command|apply_patch)\s*\(/g)) {
    const at = m.index! + m[0].length;
    const lit = jsString(src, at);
    if (m[1] === 'apply_patch') { if (lit) calls.push({ name: 'apply_patch', args: { input: lit.value } }); else whole = true; continue; }
    const obj = lit ? { cmd: lit.value } : jsObject(src, at);
    if (obj && typeof obj.cmd === 'string') calls.push({ name: 'exec_command', args: { ...obj } }); else whole = true;
  }
  return { calls, whole: whole || calls.length === 0 };
}

/** The tool calls in one request body, in order, each with a stable key (its id, else name, arguments and position). */
export function bodyCalls(b: Pick<CaptureBody, 'seq' | 'body' | 'wire'>): Call[] {
  const found: Array<{ id: string | null; name: string; args: Record<string, unknown>; result?: string }> = [];
  const status = new Map<string, Call['status']>();
  if (b.wire === 'anthropic-messages') {
    for (const m of (Array.isArray(b.body.messages) ? b.body.messages : []) as Array<{ role?: unknown; content?: unknown }>) {
      if (!Array.isArray(m?.content)) continue;
      for (const c of m.content as Array<Record<string, unknown>>) {
        if (m.role === 'assistant' && (c?.type === 'tool_use' || c?.type === 'server_tool_use')) found.push({ id: typeof c.id === 'string' ? c.id : null, name: str(c.name), args: parseArgs(c.input), result: typeof c.id === 'string' ? c.id : undefined });
        if (m.role === 'user' && c?.type === 'tool_result' && typeof c.tool_use_id === 'string') status.set(c.tool_use_id, statusOf(exitCode(c.content)) ?? (c.is_error === true ? 'failed' : 'ok'));
      }
    }
  } else if (b.wire === 'openai-responses') {
    for (const it of (Array.isArray(b.body.input) ? b.body.input : []) as Array<Record<string, unknown>>) {
      const type = String(it?.type ?? '');
      const id = typeof it?.call_id === 'string' ? it.call_id : typeof it?.id === 'string' ? it.id : null;
      if (type === 'function_call') found.push({ id, name: str(it.name), args: parseArgs(it.arguments), result: id ?? undefined });
      else if (type === 'custom_tool_call') {
        const input = str(it.input);
        const nested = str(it.name) === 'exec' ? execNestedCalls(input) : { calls: [], whole: true };
        nested.calls.forEach((c, j) => found.push({ id: id === null ? null : id + '/' + (j + 1), name: c.name, args: c.args }));
        if (nested.whole) found.push({ id, name: str(it.name), args: { input } });
      }
      else if (type === 'local_shell_call') found.push({ id, name: 'local_shell', args: { action: it.action }, result: id ?? undefined });
      else if (type.endsWith('_call')) found.push({ id, name: type, args: parseArgs(it.action ?? {}) });
      else if ((type === 'function_call_output' || type === 'local_shell_call_output') && typeof it.call_id === 'string') status.set(it.call_id, statusOf(exitCode(it.output)));
    }
  } else {
    for (const m of (Array.isArray(b.body.messages) ? b.body.messages : []) as Array<Record<string, unknown>>) {
      if (m?.role === 'tool' && typeof m.tool_call_id === 'string') status.set(m.tool_call_id, statusOf(exitCode(m.content)));
      if (m?.role !== 'assistant') continue;
      for (const c of (Array.isArray(m.tool_calls) ? m.tool_calls : []) as Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }>) found.push({ id: typeof c.id === 'string' ? c.id : null, name: str(c.function?.name), args: parseArgs(c.function?.arguments), result: typeof c.id === 'string' ? c.id : undefined });
    }
  }
  const seen = new Map<string, number>();
  return found.map((f) => {
    let key: string;
    if (f.id) key = 'id:' + f.id;
    else { const base = f.name + ':' + sha256(JSON.stringify(f.args)).slice(0, 16); const k = (seen.get(base) ?? 0) + 1; seen.set(base, k); key = base + '#' + k; }
    return makeCall(key, b.seq, f.name, f.args, f.result === undefined ? null : status.get(f.result) ?? null);
  });
}

/** Every tool call of the session, first appearance order, each once. */
export function sessionCalls(bodies: readonly CaptureBody[]): Call[] {
  const seen = new Set<string>();
  const out: Call[] = [];
  for (const b of bodies) for (const c of bodyCalls(b)) { if (seen.has(c.key)) continue; seen.add(c.key); out.push(c); }
  return out;
}

/** The final response's tool calls from a response capture (its last line). Throws Unparsed. */
export function finalResponseCalls(text: string, wire: Wire): Call[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length || !text.endsWith('\n')) throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, 'the response capture is empty or its last line was cut');
  let e: { seq?: unknown; body?: unknown };
  try { e = JSON.parse(lines.at(-1)!); } catch { throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, 'the last response line is not JSON'); }
  const body = e?.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, 'the last response line has no body');
  const seq = typeof e.seq === 'number' ? e.seq : -1;
  let calls: Call[];
  if (wire === 'anthropic-messages') {
    if (!Array.isArray(body.content)) throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, 'an Anthropic response needs content');
    calls = bodyCalls({ seq, wire, body: { messages: [{ role: 'assistant', content: body.content }] } });
  } else if (wire === 'openai-responses') {
    if (!Array.isArray(body.output)) throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, 'a Responses response needs output');
    calls = bodyCalls({ seq, wire, body: { input: body.output } });
  } else {
    const msg = (body.choices as Array<{ message?: unknown }> | undefined)?.[0]?.message;
    if (!msg || typeof msg !== 'object') throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, 'a Chat Completions response needs choices[0].message');
    calls = bodyCalls({ seq, wire, body: { messages: [{ ...(msg as object), role: 'assistant' }] } });
  }
  return calls.map((c) => ({ ...c, key: 'response:' + c.key, from_response: true }));
}

// ---- actions

export type Action =
  | { t: 'diff'; full: boolean }
  | { t: 'diff_to_file'; path: string; full: boolean }
  | { t: 'read'; path: string; limited: boolean }
  | { t: 'test'; suite: boolean; targets: string[]; cwd: string | null }
  | { t: 'check' }
  | { t: 'merge' }
  | { t: 'commit' }
  | { t: 'push'; main: boolean; force: boolean }
  | { t: 'write'; path: string; content: string | null };
/** unsure: a step that earns credit (a test, check, diff or read) which ran only if an earlier command of its && or || chain
 *  succeeded or failed, when the capture does not show that it ran: 'failed' when the call's exit status shows it failed,
 *  'unknown' when the capture holds no status that settles it. */
export type Event = Action & { i: number; unsure?: 'failed' | 'unknown' };

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');
const tokens = (s: string) => (s.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((t) => unquote(t).replace(/^['"]+|['"]+$/g, '')).filter(Boolean);
/** A ref that names the base: main or master, an origin/ ref, a range, a merge-base or command substitution, a variable, a sha. */
const BASE_REF = /(?:^|[./:])(?:main|master)\b|origin\/|\.\.|merge-base|^\$|^[0-9a-f]{7,40}$/;
const STAT_ONLY = /^--(?:stat|name-only|name-status|numstat|shortstat|summary|dirstat|quiet|exit-code|check)\b/;
const LIMITED_PIPE = /\|\s*(?:head|tail|grep|wc|sed\s+-n|awk|cut)\b/;

function heredocs(cmd: string): { text: string; bodies: string[] } {
  const bodies: string[] = [];
  const text = cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g, (_m, _q, _tag, rest: string, body: string) => {
    bodies.push(body);
    return '<<__HEREDOC_' + (bodies.length - 1) + '__' + rest;
  });
  return { text, bodies };
}

function gitActions(sub: string, args: string[], rest: string): Action[] {
  const flags = args.filter((a) => a.startsWith('-'));
  const dashdash = args.indexOf('--');
  const before = (dashdash < 0 ? args : args.slice(0, dashdash)).filter((a) => !a.startsWith('-'));
  const pathspec = dashdash >= 0 ? args.slice(dashdash + 1).length > 0 : before.some((a) => /\.[A-Za-z0-9]+$/.test(a) && !a.includes('..'));
  const baseish = before.some((a) => BASE_REF.test(a));
  const limited = LIMITED_PIPE.test(rest);
  const redirect = /(?:^|[^>&\d])>\s*(\S+)/.exec(rest);
  const full = !flags.some((f) => STAT_ONLY.test(f)) && !pathspec && !limited;
  const view = (ok: boolean): Action[] => (!ok ? [] : redirect ? [{ t: 'diff_to_file', path: unquote(redirect[1]!), full }] : [{ t: 'diff', full }]);
  switch (sub) {
    case 'diff': return view(baseish && !flags.some((f) => /^--(?:cached|staged)$/.test(f)));
    case 'log': return view(baseish && flags.some((f) => /^(?:-p|--patch|-u)$/.test(f)) && !flags.some((f) => /^(?:-\d+|-n|--max-count)/.test(f)));
    case 'merge': return flags.includes('--abort') ? [] : flags.includes('--continue') ? [{ t: 'commit' }] : before.length === 0 || before.some((a) => BASE_REF.test(a)) ? [{ t: 'merge' }, { t: 'commit' }] : [];
    case 'pull': return before.some((a) => /^(?:main|master)$|\/(?:main|master)$/.test(a)) ? [{ t: 'merge' }, { t: 'commit' }] : [];
    case 'rebase': return flags.includes('--abort') ? [] : flags.includes('--continue') ? [{ t: 'commit' }] : before.some((a) => BASE_REF.test(a)) ? [{ t: 'merge' }, { t: 'commit' }] : [];
    case 'commit': return flags.includes('--dry-run') ? [] : [{ t: 'commit' }];
    case 'cherry-pick': case 'am': case 'revert': return flags.includes('--abort') ? [] : [{ t: 'write', path: GIT_WRITE, content: null }, { t: 'commit' }];
    case 'apply': return flags.some((f) => /^--(?:check|stat|numstat|summary)$/.test(f)) ? [] : [{ t: 'write', path: GIT_WRITE, content: null }];
    case 'restore': return [{ t: 'write', path: GIT_WRITE, content: null }];
    case 'reset': return flags.some((f) => /^--(?:hard|keep|merge)$/.test(f)) ? [{ t: 'write', path: GIT_WRITE, content: null }] : [];
    case 'switch': return flags.some((f) => /^(?:-[cC]|--create|--force-create|--orphan)$/.test(f)) && before.length <= 1 ? [] : [{ t: 'write', path: GIT_WRITE, content: null }];
    case 'checkout':
      if (dashdash < 0 && !before.length && !flags.includes('-')) return [];
      return dashdash < 0 && flags.some((f) => /^(?:-[bB]|--orphan)$/.test(f)) && before.length <= 1 ? [] : [{ t: 'write', path: GIT_WRITE, content: null }];
    case 'stash': return before[0] === 'pop' || before[0] === 'apply' ? [{ t: 'write', path: GIT_WRITE, content: null }] : [];
    case 'push': {
      if (flags.some((f) => /^--(?:dry-run|delete)$|^-[nd]$/.test(f))) return [];
      const refspecs = before.slice(1);
      const main = flags.some((f) => /^--(?:mirror|all)$/.test(f)) || refspecs.some((r) => /(?:^|:)(?:refs\/heads\/)?(?:main|master)$/.test(r.replace(/^\+/, '')));
      const force = flags.some((f) => /^(?:-f|--force|--force-with-lease.*|--force-if-includes)$/.test(f)) || refspecs.some((r) => r.startsWith('+'));
      return [{ t: 'push', main, force }];
    }
    default: return [];
  }
}

/** The path of a write seen only as a git command or a Python script that rewrites files somewhere in the repository. */
const GIT_WRITE = '<git>', PY_WRITE = '<python>';

/** Files a sed -i or perl -i command edits in place: the arguments after the script. */
function inPlaceTargets(args: string[]): string[] {
  const files: string[] = [];
  let script = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-e' || a === '-f' || a === '--expression' || a === '--file') { script = true; i++; continue; }
    if (a.startsWith('-')) continue;
    if (!script) { script = true; continue; }
    files.push(a);
  }
  return files;
}

/** The task repository, every delivery task's workdir. */
const REPO = '/work/repo';
/** A test module at the top of the repository (test_*.py or *_test.py), named from there or by its full path: the repository's
 *  own documented test command names one beside its test folders (python -m pytest test_schedule.py tests_feature). */
const rootTest = (t: string) => /^(?:test_[^/]*|[^/]*_test)\.py$/.test(posix.basename(t)) && (posix.dirname(t) === REPO || posix.dirname(t) === '.');

/** A written path, from cwd: $PWD and $(pwd) are cwd; a path under ~ or another variable stays as written (see inRepo). */
function writePath(w: string, cwd: string | null): string {
  const p = w.replace(/^(?:\$PWD|\$\{PWD\}|\$\(pwd\))(?=\/|$)/, '.');
  if (p.startsWith('/') || /^[~$]/.test(p) || !cwd) return p;
  return /^[~$]/.test(cwd) ? posix.join(cwd, p) : posix.resolve(cwd, p);
}

const PYTEST_VALUE_OPTS = new Set(['-k', '-m', '-p', '-c', '-o', '-n', '-W', '--rootdir', '--deselect', '--ignore', '--junitxml', '--basetemp', '--confcutdir', '--maxfail', '--tb', '-r']);

/** A segment's gate: 'and' when it runs only if every earlier command of its chain succeeded and the call's exit status is
 *  that chain's, 'other' when it is conditional in any other way (after ||, or in a chain that a later ; or newline follows,
 *  whose status the call's does not show). null when it runs unconditionally. A cd before the first command is no gate. */
type Gate = 'and' | 'other';
interface Gated { a: Action; gate: Gate | null }
const worse = (x: Gate | null, y: Gate | null): Gate | null => (x === 'other' || y === 'other' ? 'other' : x ?? y);

/** The actions of one shell segment (no ;, && or ||), with its working directory when a cd set it. visible: the call's exit
 *  status is this segment's, so a chain inside a wrapped shell can be settled by it. */
function segmentActions(seg: string, bodies: string[], cwd: string | null, visible: boolean): Gated[] {
  const s = seg.replace(/^\s*(?:(?:sudo|time|nice|env|timeout\s+\d+\w?)\s+|\w+=\S*\s+)*/, '');
  const wrapped = /^\s*(?:(?:docker|podman)\s+(?:compose\s+)?exec(?:\s+-[\w-]+(?:=\S+|\s+(?!-)[^\s'"]+)?)*?\s+\w[\w.-]*\s+)?(?:\/[\w.\/-]*\/)?(?:ba|z|da)?sh\s+(?:[-+][a-zA-Z]*[oO]\s+[\w-]+\s+|-{1,2}[a-zA-Z][\w-]*\s+)*-[a-zA-Z]*c\s+(['"])([\s\S]*)\1[^'"]*$/.exec(s);
  if (wrapped) return actionsOf(wrapped[1] === '"' ? wrapped[2]!.replace(/\\(["\\$`])/g, '$1') : wrapped[2]!, bodies, cwd, visible);
  return plainActions(s, bodies, cwd).map((a) => ({ a, gate: null }));
}

/** The actions of one segment that is not a wrapped shell, its leading prefixes (sudo, env, VAR=) taken off. */
function plainActions(s: string, bodies: string[], cwd: string | null): Action[] {
  const out: Action[] = [];
  const pipeAt = s.indexOf('|');
  const head = pipeAt >= 0 && s[pipeAt + 1] !== '|' ? s.slice(0, pipeAt) : s;
  const rest = s.slice(head.length);
  const bare = unquoted(head);
  const at = (re: RegExp) => { const m = re.exec(bare); if (!m) return null; const y = new RegExp(re.source, 'y'); y.lastIndex = m.index; return y.exec(head); };
  const git = at(/(?:^|[\s("'])git((?:\s+(?:-C\s+\S+|--no-pager|-P|-c\s+\S+|--git-dir=\S+|--work-tree=\S+))*)\s+([a-z][a-z-]*)\b(.*)$/);
  if (git) {
    const tail = git[3]!;
    const redirectAt = tail.search(/(?:^|[^>&\d])>/);
    const args = tokens(redirectAt >= 0 ? tail.slice(0, redirectAt) : tail);
    out.push(...gitActions(git[2]!, args, (redirectAt >= 0 ? tail.slice(redirectAt) : '') + rest));
    return out;
  }
  const pytest = at(/(?:^|[\s(/"'])(?:python3?(?:\.\d+)?\s+-m\s+)?(?:pytest|py\.test)\b(.*)$/);
  if (pytest) {
    const args = tokens(pytest[1]!.replace(/(?:^|[^>&\d])>.*$/, ''));
    const targets: string[] = [];
    let select = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (/^-[km]/.test(a) || a === '--lf' || a === '--last-failed' || a === '--deselect' || a.startsWith('--deselect=')) select = true;
      if (PYTEST_VALUE_OPTS.has(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      targets.push(cwd && !a.startsWith('/') ? posix.resolve(cwd, a) : a);
    }
    out.push({ t: 'test', suite: !select && targets.every((t) => !t.includes('::') && (!/\.py$/.test(t) || rootTest(t))), targets, cwd });
    return out;
  }
  if (/(?:^|\s)(?:python3?(?:\.\d+)?\s+-m\s+unittest|tox|nox|make\s+(?:test|check)|hatch\s+test)\b/.test(bare)) { out.push({ t: 'test', suite: true, targets: [], cwd }); return out; }
  const doc = /__HEREDOC_(\d+)__/.exec(head);
  const docBody = doc ? bodies[Number(doc[1])] ?? null : null;
  const writes: string[] = [];
  for (const m of head.matchAll(/(?:^|[^>&\d<])>{1,2}\s*(['"]?)([^\s'"|;&<>]+)\1/g)) writes.push(m[2]!);
  const tee = /(?:^|[\s|])tee\s+(?:-a\s+)?(\S+)/.exec(s);
  if (tee) writes.push(unquote(tee[1]!));
  const python = /(?:^|[\s(/"'])python3?(?:\.\d+)?\s+(?!-m\b)(-c\b|-\s*(?:<<|$)|<<|[^\s-]\S*\.py\b)/.test(head);
  const pyText = python ? head + (docBody ? '\n' + docBody : '') : '';
  if (python && /review\.json/.test(pyText)) writes.push('review.json');
  if (python) for (const m of pyText.matchAll(/(['"])([^'"]*out\/tests\/[^'"]+\.py)\1/g)) if (/open\(|write_text|>/.test(pyText)) writes.push(m[2]!);
  if (python && !/review\.json|out\/tests\//.test(pyText) && /\bopen\(.*?,\s*(?:mode\s*=\s*)?['"][wax]b?\+?['"]|\.write_(?:text|bytes)\(|\bshutil\.(?:copy|move)/.test(pyText)) {
    const named = [...pyText.matchAll(/\bopen\(\s*(['"])([^'"]+)\1\s*,\s*(?:mode\s*=\s*)?['"][wax]b?\+?['"]/g), ...pyText.matchAll(/Path\(\s*(['"])([^'"]+)\1\s*\)\.write_(?:text|bytes)\(/g)].map((m) => m[2]!);
    writes.push(...(named.length ? named : [PY_WRITE]));
  }
  const inPlace = /^\s*(sed|perl)\s+(.*)$/.exec(head);
  if (inPlace && tokens(inPlace[2]!).some((a) => /^-(?:[a-zA-Z]*i\S*|-in-place\S*)$/.test(a))) writes.push(...inPlaceTargets(tokens(inPlace[2]!)));
  const fileCmd = /^\s*(cp|mv|rm|touch)\s+(.*)$/.exec(head);
  if (fileCmd) {
    const args = tokens(fileCmd[2]!).filter((a) => !a.startsWith('-'));
    writes.push(...(fileCmd[1] === 'cp' || fileCmd[1] === 'mv' ? args.slice(-1) : args));
  }
  for (const w of writes) out.push({ t: 'write', path: writePath(w, cwd), content: /^\s*(?:cat|printf|echo|tee)\b/.test(head) || tee ? docBody : null });
  if (python && !/review\.json/.test(pyText)) out.push({ t: 'check' });
  const read = /^\s*(?:cat|less|more|bat|nl|view|head|tail|sed\s+-n\s+\S+)\s+(.+)$/.exec(head);
  if (read && !writes.length) for (const p of tokens(read[1]!).filter((x) => !x.startsWith('-'))) out.push({ t: 'read', path: cwd && !p.startsWith('/') ? posix.resolve(cwd, p) : p, limited: /^\s*(?:head|tail|sed)\b/.test(head) || LIMITED_PIPE.test(rest) });
  return out;
}

/** s with the text inside quotes turned to _ (newlines kept), except a $( ) inside double quotes, so a command name that is
 *  only quoted text, as in echo 'git push', is not read as a command. Same length as s. */
function unquoted(s: string): string {
  let out = '', quote: string | null = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (!quote) {
      if (ch === '\\' && i + 1 < s.length) { out += ch + s[++i]; continue; }
      if (ch === "'" || ch === '"') quote = ch;
      out += ch;
      continue;
    }
    if (quote === '"' && s.startsWith('$(', i)) { depth++; out += '$('; i++; continue; }
    if (depth > 0) { if (ch === '(') depth++; else if (ch === ')') depth--; out += ch; continue; }
    if (quote === '"' && ch === '\\' && i + 1 < s.length) { out += '__'; i++; continue; }
    if (ch === quote) { quote = null; out += ch; continue; }
    out += ch === '\n' ? ch : '_';
  }
  return out;
}

/** Split a command on newlines, ;, && and || outside quotes; op is the separator before each part ('' for the first). */
function chain(text: string): Array<{ text: string; op: '' | ';' | '&&' | '||' }> {
  const out: Array<{ text: string; op: '' | ';' | '&&' | '||' }> = [];
  let cur = '', quote: string | null = null, op: '' | ';' | '&&' | '||' = '';
  const end = (next: '' | ';' | '&&' | '||') => { if (cur.trim()) { out.push({ text: cur, op }); op = next; } else if (!out.length || op === ';') op = out.length ? next : ''; cur = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) { cur += ch; if (ch === quote) quote = null; else if (ch === '\\' && quote === '"' && i + 1 < text.length) cur += text[++i]; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '\\' && i + 1 < text.length) { cur += ch + text[++i]; continue; }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||') { end(two); i++; continue; }
    if (ch === '\n' || ch === ';') { end(';'); continue; }
    cur += ch;
  }
  end(';');
  return out;
}

/** Split a command on newlines, ;, && and || outside quotes. */
export function segments(text: string): string[] {
  return chain(text).map((p) => p.text);
}

export function shellActions(command: string, cwd0: string | null = null): Action[] {
  return gatedActions(command, cwd0).map((g) => g.a);
}

function gatedActions(command: string, cwd0: string | null): Gated[] {
  const { text, bodies } = heredocs(command);
  return actionsOf(text, bodies, cwd0, true);
}

/** The actions of a command whose heredoc bodies are already taken out, segment by segment, following cd, each with its gate.
 *  visible: the call's exit status is this command's. */
function actionsOf(text: string, bodies: string[], cwd0: string | null, visible: boolean): Gated[] {
  const out: Gated[] = [];
  const parts = chain(text);
  const lastList = parts.reduce((k, p, j) => (p.op === '&&' || p.op === '||' ? k : j), 0);
  let cwd = cwd0, gate: Gate | null = null, ran = false;
  parts.forEach((p, j) => {
    if (p.op === '' || p.op === ';') { gate = null; ran = false; }
    else if (ran) gate = p.op === '&&' && gate !== 'other' ? 'and' : 'other';
    const cd = /^\s*cd\s+(\S+)\s*$/.exec(p.text);
    if (cd) { const d = unquote(cd[1]!); cwd = d.startsWith('/') ? d : cwd ? posix.resolve(cwd, d) : d; return; }
    ran = true;
    const own: Gate | null = gate === 'and' && (!visible || j < lastList) ? 'other' : gate;
    for (const g of segmentActions(p.text, bodies, cwd, visible && j >= lastList && own !== 'other')) out.push({ a: g.a, gate: worse(own, g.gate) });
  });
  return out;
}

/** The actions of one tool call, each with its gate: a shell command, or a native write, edit, patch or read tool. */
function callGated(c: Call): Gated[] {
  if (c.command !== null && /apply_patch/.test(c.command) && /\*\*\* (?:Add|Update|Delete) File:/.test(c.command)) return patchFiles(c.command).map((f) => ({ a: { t: 'write', path: f.path, content: /review\.json$/.test(f.path) ? f.content : null }, gate: null }));
  if (c.command !== null) return gatedActions(c.command, c.cwd);
  if (/read|view|open/i.test(c.name) && !/write|edit/i.test(c.name)) return c.paths.map((p) => ({ a: { t: 'read', path: p, limited: c.args.limit !== undefined || c.args.offset !== undefined || c.args.view_range !== undefined }, gate: null }));
  if (/write|create|edit|replace|patch|apply/i.test(c.name)) return c.paths.map((p) => ({ a: { t: 'write', path: p, content: /review\.json$/.test(p) && (/write|create/i.test(c.name) || c.content !== null) ? c.content : null }, gate: null }));
  return [];
}

/** The actions of one tool call: a shell command, or a native write, edit, patch or read tool. */
export function callActions(c: Call): Action[] {
  return callGated(c).map((g) => g.a);
}

/** Steps that earn a marker credit; the rest (writes, merges, commits, pushes) count whether or not their chain ran them. */
const CREDIT = new Set<Action['t']>(['diff', 'diff_to_file', 'read', 'test', 'check']);

export function sessionEvents(calls: readonly Call[]): Event[] {
  const events: Event[] = [];
  const diffFiles = new Map<string, { full: boolean; unsure: Event['unsure'] }>();
  for (const c of calls) for (const { a, gate } of callGated(c)) {
    const i = events.length;
    const unsure: Event['unsure'] = !CREDIT.has(a.t) || gate === null || (gate === 'and' && c.status === 'ok') ? undefined : gate === 'and' && c.status === 'failed' ? 'failed' : 'unknown';
    const mark = (u: Event['unsure']) => (u ? { unsure: u } : {});
    if (a.t === 'diff_to_file') diffFiles.set(a.path, { full: a.full, unsure });
    if (a.t === 'read') { for (const [p, d] of diffFiles) if (samePath(p, a.path)) events.push({ t: 'diff', full: d.full && !a.limited, i, ...mark(d.unsure === 'failed' || unsure === 'failed' ? 'failed' : d.unsure ?? unsure) }); continue; }
    events.push({ ...a, i, ...mark(unsure) } as Event);
  }
  return events;
}

// ---- markers

const clean = (p: string) => p.replace(/\/+$/, '').replace(/^\.\//, '');
export function samePath(a: string, b: string): boolean {
  const x = clean(a), y = clean(b);
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x);
}
/** Whether a pytest run with these targets (or none, from cwd) collects the file. */
export function covers(run: { targets: string[]; cwd: string | null }, file: string): boolean {
  const f = clean(file);
  const targets = run.targets.length ? run.targets.map((t) => t.split('::')[0]!) : run.cwd ? [run.cwd] : [];
  return targets.some((t) => { const d = clean(t); return samePath(d, f) || (!/\.py$/.test(d) && (f.startsWith(d + '/') || f.includes('/' + d + '/'))); });
}
const isFindings = (p: string) => /(?:^|\/)review\.json$/.test(p);
const isOutTest = (p: string) => /(?:^|\/)out\/tests\/.+\.py$/.test(p);

export interface MarkerResult { state: MarkerState; reason?: string }

/** Whether a write path can be in the task's repository: relative, under /work, or a git or Python rewrite. /dev/null,
 *  /tmp, every other absolute path outside /work, and a path under ~ or a variable other than $PWD ($HOME, $GSTACK_STATE_ROOT,
 *  $TMPDIR: the home folder and gstack's state) are not. */
export function inRepo(path: string): boolean {
  return !/^[~$]/.test(path) && (!path.startsWith('/') || path.startsWith('/work/'));
}

function findingTests(content: string | null): string[] | null {
  if (content === null) return null;
  try {
    const v = JSON.parse(content);
    if (!Array.isArray(v)) return null;
    return v.map((f) => (f && typeof f === 'object' ? (f as { test?: unknown }).test : undefined)).filter((t): t is string => typeof t === 'string');
  } catch { return null; }
}

export function scoreMarker(marker: string, ev: readonly Event[]): MarkerResult {
  const before = (i: number) => ev.filter((e) => e.i < i);
  if (marker.startsWith('review.')) {
    const writes = ev.filter((e): e is Event & { t: 'write' } => e.t === 'write' && isFindings(e.path));
    if (!writes.length) return { state: 'not_met', reason: 'no write of review.json' };
    const first = writes[0]!, last = writes.at(-1)!;
    const tests = findingTests(last.content);
    if (marker === 'review.full_diff_first') return before(first.i).some((e) => e.t === 'diff' && e.full) ? { state: 'met' } : { state: 'not_met', reason: 'no full diff against the base before the first write of review.json' };
    if (marker === 'review.check_before_finding') {
      const ok = before(last.i).some((e) => e.t === 'check' || (tests !== null && e.t === 'test' && e.targets.some((t) => /\.py(?:::|$)/.test(t) && !tests.some((f) => samePath(t.split('::')[0]!, f)))));
      return ok ? { state: 'met' } : { state: 'not_met', reason: 'no check run before review.json other than the reported findings\' tests' };
    }
    if (marker === 'review.test_per_finding') {
      const files = tests ?? [...new Set(before(last.i).filter((e): e is Event & { t: 'write' } => e.t === 'write' && isOutTest(e.path)).map((e) => e.path))];
      if (!files.length) return tests !== null ? { state: 'n/a', reason: 'review.json lists no finding' } : { state: 'unscorable', reason: 'review.json content was not readable and no test file write was seen' };
      let unwritten = 0, unrun = 0;
      for (const f of files) {
        const writeUp = writes.find((w) => findingTests(w.content)?.some((t) => samePath(t, f)))?.i ?? last.i;
        const written = ev.filter((e) => e.t === 'write' && !isFindings(e.path) && e.i < writeUp && samePath(e.path, f)).at(-1);
        if (!written) { unwritten++; continue; }
        if (!ev.some((e) => e.t === 'test' && e.i > written.i && e.i < writeUp && covers(e, f))) unrun++;
      }
      return unwritten + unrun ? { state: 'not_met', reason: files.length + ' reported findings: ' + unwritten + ' with no captured write of the test before the write-up, ' + unrun + ' whose test was not run after its last write and before the write-up' } : { state: 'met' };
    }
  }
  const push = ev.filter((e) => e.t === 'push' && !e.main).at(-1);
  if (!push) return { state: 'not_met', reason: 'no push of the branch' };
  if (marker === 'ship.tests_after_merge') {
    const merge = ev.filter((e) => e.t === 'merge' && e.i < push.i).at(-1);
    if (!merge) return { state: 'not_met', reason: 'no merge of the base before the last push' };
    return ev.some((e) => e.t === 'test' && e.suite && e.i > merge.i && e.i < push.i) ? { state: 'met' } : { state: 'not_met', reason: 'no full test-suite run between the last merge and the last push' };
  }
  if (marker === 'ship.fresh_verification') {
    const change = ev.filter((e) => e.i < push.i && (e.t === 'merge' || (e.t === 'write' && inRepo(e.path)))).at(-1)?.i ?? -1;
    return ev.some((e) => e.t === 'test' && e.suite && e.i > change && e.i < push.i) ? { state: 'met' } : { state: 'not_met', reason: change < 0 ? 'no full test-suite run before the last push' : 'no full test-suite run between the last change to the repository and the last push' };
  }
  if (marker === 'ship.final_diff_after_commit') {
    const commit = ev.filter((e) => e.t === 'commit' && e.i < push.i).at(-1)?.i ?? -1;
    return ev.some((e) => e.t === 'diff' && e.full && e.i > commit && e.i < push.i) ? { state: 'met' } : { state: 'not_met', reason: 'no full diff against the base between the last commit and the last push' };
  }
  throw new Error('unknown marker ' + marker);
}

/** One action the unseen final response could have held, per kind, to test whether a not-met marker could flip. */
function flipCandidates(kind: Kind, ev: readonly Event[]): Action[] {
  if (kind === 'review') {
    const last = ev.filter((e): e is Event & { t: 'write' } => e.t === 'write' && isFindings(e.path)).at(-1);
    return [{ t: 'diff', full: true }, { t: 'check' }, { t: 'test', suite: false, targets: ['/work/out/tests'], cwd: null }, { t: 'write', path: '/work/out/review.json', content: last?.content ?? null }];
  }
  return [{ t: 'diff', full: true }, { t: 'test', suite: true, targets: [], cwd: null }, { t: 'merge' }, { t: 'commit' }, { t: 'push', main: false, force: false }];
}

export interface Delivery { expected_sha256: string; in_request_1: boolean; match: 'exact' | 'trailing-whitespace' | null; request_1_seq: number; agent_requests: number; requests_with_copy: number; copies_per_request: number[] }

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}
const occurrences = (hay: string, needle: string) => { let n = 0, at = hay.indexOf(needle); while (at >= 0) { n++; at = hay.indexOf(needle, at + needle.length); } return n; };

/** The expected card (or placebo) text in the first agent request, and its copies in every agent request (d1, d12). */
export function deliveryCheck(bodies: readonly CaptureBody[], expected: string): Delivery {
  const agent = bodies.filter((b) => b.agent);
  const variants: Array<[string, 'exact' | 'trailing-whitespace']> = [[expected, 'exact']];
  if (expected.trimEnd() !== expected) variants.push([expected.trimEnd(), 'trailing-whitespace']);
  const copies = agent.map((b) => { const all = strings(b.body); return Math.max(...variants.map(([v]) => all.reduce((n, s) => n + occurrences(s, v), 0))); });
  const firstText = strings(agent[0]?.body).join('\u0000');
  const match = variants.find(([v]) => firstText.includes(v))?.[1] ?? null;
  return { expected_sha256: sha256(expected), in_request_1: match !== null, match, request_1_seq: agent[0]?.seq ?? -1, agent_requests: agent.length, requests_with_copy: copies.filter((n) => n > 0).length, copies_per_request: copies };
}

// ---- one trial

export interface ProbeInput { trial_id: string; kind: Kind; arm: Arm; capture: string; termination?: string | null; responses?: string | null; requests_metered?: number | null; expected?: string | null }
export type SessionEnd = 'text' | 'assumed_text' | 'tool_call' | 'unknown';
export interface ProbeScored {
  trial_id: string; status: 'scored'; kind: Kind; arm: Arm; wire: Wire;
  requests: number; agent_requests: number; tool_calls: number;
  session_end: SessionEnd; last_action: 'observed' | 'unobservable';
  markers: Record<string, MarkerResult & { card_line: string }>;
  descriptive: Record<string, MarkerResult>;
  compliance: { met: number; applicable: number; share: number | null; followed: boolean | null };
  delivery: Delivery | null;
  infra_class: 'route_not_delivered' | null;
  gstack_reads: number;
}
export interface ProbeUnparsed { trial_id: string; status: 'unparsed'; kind: Kind; arm: Arm; code: UnparsedCode; wire: Wire | 'unknown'; detail: string }
export type ProbeResult = ProbeScored | ProbeUnparsed;

/** marker -> card line id, from the selection; every marker of MARKERS sits on exactly one line. */
export function markerLines(sel: Selection): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of Object.values(sel.cards)) for (const l of spec.lines) if (l.marker) {
    if (out[l.marker]) throw new Error('marker ' + l.marker + ' is on two card lines');
    out[l.marker] = l.id;
  }
  for (const m of Object.keys(MARKERS)) if (!out[m]) throw new Error('marker ' + m + ' is on no card line');
  for (const m of Object.keys(out)) if (!MARKERS[m]) throw new Error('card marker ' + m + ' has no probe');
  return out;
}

export function probeTrial(input: ProbeInput, sel: Selection = loadSelection()): ProbeResult {
  const unparsed = (e: Unparsed): ProbeUnparsed => ({ trial_id: input.trial_id, status: 'unparsed', kind: input.kind, arm: input.arm, code: e.code, wire: e.wire, detail: e.detail });
  try {
    if (!existsSync(input.capture)) throw new Unparsed('PROBE_CAPTURE_MISSING', 'unknown', input.capture + ' does not exist');
    const { bodies, wire } = readCaptureText(readFileSync(input.capture, 'utf8'), input.requests_metered ?? null);
    const calls = sessionCalls(bodies);
    let sessionEnd: SessionEnd;
    if (input.responses) {
      if (!existsSync(input.responses)) throw new Unparsed('PROBE_RESPONSE_UNPARSED', wire, input.responses + ' does not exist');
      const last = finalResponseCalls(readFileSync(input.responses, 'utf8'), wire);
      calls.push(...last);
      sessionEnd = last.length ? 'tool_call' : 'text';
    } else sessionEnd = input.termination === 'completed' ? 'assumed_text' : 'unknown';
    const ev = sessionEvents(calls);
    const sure = ev.filter((e) => !e.unsure), seen = ev.filter((e) => e.unsure !== 'failed');
    const score = (m: string): MarkerResult => {
      const r = scoreMarker(m, sure);
      if (r.state !== 'not_met' || seen.length === sure.length || scoreMarker(m, seen).state !== 'met') return r;
      return { state: 'unobservable', reason: 'met only by a step after && or || that the capture does not show ran (' + r.reason + ')' };
    };
    const lines = markerLines(sel);
    const markers: ProbeScored['markers'] = {};
    for (const [m, kind] of Object.entries(MARKERS)) {
      if (kind !== input.kind) continue;
      let r = score(m);
      if (r.state === 'not_met' && sessionEnd === 'unknown' && flipCandidates(input.kind, sure).some((a) => scoreMarker(m, [...sure, { ...a, i: ev.length } as Event]).state === 'met')) {
        r = { state: 'unobservable', reason: 'not met in what was captured, and the unseen last action could meet it (' + r.reason + ')' };
      }
      markers[m] = { card_line: lines[m]!, ...r };
    }
    const descriptive: ProbeScored['descriptive'] = {};
    for (const [m, kind] of Object.entries(DESCRIPTIVE)) if (kind === input.kind) descriptive[m] = score(m);
    const states = Object.values(markers).map((r) => r.state);
    const met = states.filter((s) => s === 'met').length;
    const applicable = states.filter((s) => s !== 'n/a').length;
    const open = states.some((s) => s === 'unobservable' || s === 'unscorable');
    const followed = states.includes('not_met') ? false : open || applicable === 0 ? null : true;
    let delivery: Delivery | null = null;
    if (DELIVERY_ARMS.has(input.arm)) {
      if (!input.expected) throw new Error(input.trial_id + ': arm ' + input.arm + ' needs the expected card or placebo text');
      delivery = deliveryCheck(bodies, input.expected);
    }
    return {
      trial_id: input.trial_id, status: 'scored', kind: input.kind, arm: input.arm, wire,
      requests: bodies.length, agent_requests: bodies.filter((b) => b.agent).length, tool_calls: calls.length,
      session_end: sessionEnd, last_action: sessionEnd === 'unknown' ? 'unobservable' : 'observed',
      markers, descriptive, compliance: { met, applicable, share: open || applicable === 0 ? null : met / applicable, followed },
      delivery, infra_class: delivery && !delivery.in_request_1 ? 'route_not_delivered' : null,
      gstack_reads: calls.filter((c) => GSTACK_FILE.test(c.raw)).length,
    };
  } catch (e) {
    if (e instanceof Unparsed) return unparsed(e);
    throw e;
  }
}

/** The card text an arm must deliver: the kind's committed card (checked against its sha256 in the selection) for hook and
 *  startup, the given file for placebo or an explicit --expect. */
export function expectedText(kind: Kind, arm: Arm, sel: Selection, expectFile?: string | null, cardsDir = CARDS_DIR): string | null {
  if (expectFile) return readFileSync(expectFile, 'utf8');
  if (arm === 'placebo') throw new Error('the placebo arm needs --expect <placebo file>');
  if (!DELIVERY_ARMS.has(arm)) return null;
  const spec = sel.cards[kind]!;
  const text = readFileSync(join(cardsDir, spec.file), 'utf8');
  if (sha256(text) !== spec.sha256) throw new Error(join(cardsDir, spec.file) + ' does not match its sha256 in selection.json (bun scripts/gstack-delivery/extract-cards.ts --committed)');
  return text;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const usage = (why: string): never => { console.error('probes: ' + why + '\nusage: bun scripts/gstack-delivery/probes.ts --trial <id> --capture <file> --kind review|ship --arm <arm> [--termination <t>] [--responses <file>] [--requests-metered <n>] [--expect <file>] [--out <file>]\n       bun scripts/gstack-delivery/probes.ts --batch <trials.jsonl> [--out <file>]'); process.exit(2); };
  type Row = { trial_id?: unknown; capture?: unknown; kind?: unknown; arm?: unknown; termination?: unknown; responses?: unknown; requests_metered?: unknown; expect?: unknown };
  let rows: Row[];
  const batch = opt('--batch');
  if (batch) {
    if (!existsSync(batch)) usage(batch + ' does not exist');
    rows = readFileSync(batch, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l) as Row; } catch { return usage(batch + ' line ' + (i + 1) + ' is not JSON'); } });
  } else rows = [{ trial_id: opt('--trial'), capture: opt('--capture'), kind: opt('--kind'), arm: opt('--arm'), termination: opt('--termination'), responses: opt('--responses'), requests_metered: opt('--requests-metered') === undefined ? undefined : Number(opt('--requests-metered')), expect: opt('--expect') }];
  const sel = loadSelection();
  const out: string[] = [];
  let failed = 0;
  for (const r of rows) {
    if (typeof r.trial_id !== 'string' || !r.trial_id || typeof r.capture !== 'string') usage('every trial needs trial_id and capture');
    if (r.kind !== 'review' && r.kind !== 'ship') usage((r.trial_id as string) + ': kind must be review or ship');
    if (!ARMS.includes(r.arm as Arm)) usage((r.trial_id as string) + ': arm must be one of ' + ARMS.join(', '));
    const base = batch ? dirname(batch) : '.';
    const at = (p: unknown) => (typeof p === 'string' && p ? (p.startsWith('/') ? p : join(base, p)) : null);
    let expected: string | null;
    try { expected = expectedText(r.kind as Kind, r.arm as Arm, sel, at(r.expect)); } catch (e) { expected = usage((e as Error).message); }
    const metered = r.requests_metered === undefined || r.requests_metered === null ? null : Number(r.requests_metered);
    if (metered !== null && !Number.isSafeInteger(metered)) usage((r.trial_id as string) + ': requests_metered must be a whole number');
    const res = probeTrial({ trial_id: r.trial_id as string, kind: r.kind as Kind, arm: r.arm as Arm, capture: at(r.capture)!, termination: typeof r.termination === 'string' ? r.termination : null, responses: at(r.responses), requests_metered: metered, expected }, sel);
    if (res.status === 'unparsed') { failed++; console.error('PROBE_UNPARSED trial=' + res.trial_id + ' code=' + res.code + ' wire=' + res.wire + ' ' + res.detail); }
    out.push(JSON.stringify(res));
  }
  const text = out.join('\n') + '\n';
  const file = opt('--out');
  if (file) writeFileSync(file, text); else process.stdout.write(text);
  if (failed) process.exit(3);
}
