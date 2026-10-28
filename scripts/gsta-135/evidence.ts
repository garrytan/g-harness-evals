#!/usr/bin/env bun
/**
 * internal-task evidence extractor: reads one trial's native transcript (never the
 * wrapper's gstack-register.log, never adapter.log) and reports, in order,
 *
 *   skill_open   the harness's own skill tool opening a gstack skill
 *                OpenClaw: a skills_read of `gstack`, or a read of
 *                  <state>/openclaw/skills/gstack/SKILL.md (the router), then a
 *                  read of .../gstack/skills/gstack-review/SKILL.md or
 *                  gstack-investigate
 *                Hermes:   skill_view gstack / gstack-review / gstack-investigate
 *                  (or a read_file of a path under hermes/skills/gstack)
 *   helper_run   an exec/terminal tool call whose command RUNS a
 *                /opt/gstack/bin/ helper or gstack-skill-start: the helper is
 *                in command position of a shell segment (after VAR=value
 *                prefixes, runner words such as bun/bash/env/timeout and their
 *                options, inside `bash -c` or `eval` strings, or relative to a
 *                preceding `cd`), never merely mentioned by cat, grep, ls,
 *                echo, `command -v` or `bash -n`, inside a quoted string or in a
 *                heredoc body
 *   gstack_path  every other tool call whose arguments mention gstack, for the
 *                no-gstack arm and the controls
 *
 * each with the transcript file, its locator (session and seq, or row id) and
 * the file's sha256. Prose in assistant text, quoted examples and the
 * wrapper's own output never count: only decoded tool-call events do. A
 * missing, empty or unreadable transcript makes the cell `missing` or
 * `unobservable`; absence is a verdict only when the transcript is
 * `complete`: every row decoded, and every session's last event the
 * assistant's final turn (stopReason stop, or finish_reason stop) with no tool
 * call left without a result. QM has no decoder at this pin (its cells did not
 * run), so a QM cell is `unobservable`.
 *
 * The sqlite stores are hashed as they are, then copied (with any -wal and
 * -shm) to a scratch directory and read there, so reading creates no side
 * files in the trial's state and the hashes name the originals.
 *
 *   bun scripts/gsta-135/evidence.ts <harness> <trial out dir>            -> JSON on stdout
 *   bun scripts/gsta-135/evidence.ts <harness> <trial out dir> --excerpt  -> the decoded turn, one line per event
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';

export interface Event { kind: 'skill_open' | 'helper_run' | 'gstack_path'; tool: string; detail: string; file: string; locator: string; sha256: string }
export interface Evidence {
  transcript: 'complete' | 'truncated' | 'missing' | 'unobservable';
  files: Array<{ path: string; sha256: string; bytes: number }>;
  tool_calls: number;
  events: Event[];
  skill_open: Event | null;
  sub_skill_open: Event | null;
  helper_run: Event | null;
  gstack_paths: number;
  note?: string;
  excerpt: string[];
}

export const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const SKILL_RE = /(?:openclaw|hermes)\/skills\/gstack\/SKILL\.md$/;
const SUB_SKILL_RE = /gstack\/skills\/gstack-(review|investigate)\/SKILL\.md/;
const GSTACK_RE = /gstack/i;
const HELPER_WORD = /^(?:\/opt\/gstack\/bin\/[\w.-]+|\$\{?GSTACK_(?:BIN|ROOT|DIR)\}?(?:\/bin)?\/[\w.-]+|gstack-skill-start)$/;
const RUNNER_WORD = /^(?:bun|bash|sh|env|exec|timeout|nice|command|sudo|nohup|time|node)$/;
const OPTION_WORD = /^(?:--?\w[\w=,.:/-]*|\d+[smhd]?|\d*[<>]\S*|&>\S*|run|x)$/;
const ASSIGN_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORD = /^(?:if|then|else|elif|fi|do|done|while|until|!|\{|\}|time)$/;

/** Shell-like split of one command string into segments of words: quotes group, heredoc bodies are dropped, and
 *  ; & | && || newlines ( ) ` and $( separate segments. Each word keeps its quotes removed. */
export function shellSegments(command: string): string[][] {
  const src = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?(?:\n|^)\2(?=\n|$)/g, '$3');
  const out: string[][] = [];
  let seg: string[] = [], word = '', quoted = false, q: string | null = null;
  // A command substitution ($( ) or backticks, quoted or not) is its own nested command: the outer word and segment
  // are parked while it is read and resume after it, so the rest of the outer command stays an argument list.
  const stack: Array<{ seg: string[]; word: string; quoted: boolean; q: string | null; resume: string }> = [];
  const endWord = () => { if (word || quoted) seg.push(word); word = ''; quoted = false; };
  const endSeg = () => { endWord(); if (seg.length) out.push(seg); seg = []; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!q && stack.length && c === stack[stack.length - 1].resume) {
      endSeg();
      const o = stack.pop()!;
      seg = o.seg; word = o.word; quoted = o.quoted || o.q === '"'; q = o.q;
      continue;
    }
    if (q !== "'" && ((c === '$' && src[i + 1] === '(' && src[i + 2] !== '(') || c === '`')) {
      stack.push({ seg, word, quoted, q, resume: c === '$' ? ')' : '`' });
      seg = []; word = ''; quoted = false; q = null;
      if (c === '$') i++;
      continue;
    }
    if (q) { if (c === q) { q = null; } else if (c === '\\' && q === '"' && i + 1 < src.length) { word += src[++i]; } else { word += c; } continue; }
    if (c === "'" || c === '"') { q = c; quoted = true; continue; }
    if (c === '\\' && i + 1 < src.length) { word += src[++i]; continue; }
    if (c === '#' && !word && !quoted) { while (i + 1 < src.length && src[i + 1] !== '\n') i++; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')') { endSeg(); continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c;
  }
  endSeg();
  while (stack.length) { const o = stack.pop()!; seg = o.seg; word = o.word; quoted = o.quoted; endSeg(); }
  return out.filter(s => s.length);
}

/** The helper a shell command RUNS, or null. */
export function helperRun(command: string, cwd: string | null = null): string | null {
  for (const words of shellSegments(command)) {
    let i = 0;
    while (i < words.length && (ASSIGN_WORD.test(words[i]) || KEYWORD.test(words[i]))) i++;
    if (words[i] === 'cd' && words[i + 1]) { cwd = words[i + 1].startsWith('/') ? words[i + 1] : cwd ? posix.join(cwd, words[i + 1]) : null; continue; }
    if (words[i] === 'eval' && words[i + 1]) { const r = helperRun(words.slice(i + 1).join(' '), cwd); if (r) return r; continue; }
    let runner: string | null = null;
    while (i < words.length && (ASSIGN_WORD.test(words[i]) || RUNNER_WORD.test(words[i]) || (runner && OPTION_WORD.test(words[i])))) {
      if (RUNNER_WORD.test(words[i])) runner = words[i];
      if ((runner === 'command' && /^-[vV]$/.test(words[i])) || (/^(bash|sh)$/.test(runner ?? '') && /^-\w*n/.test(words[i]))) { runner = 'mention'; break; }
      if (/^(bash|sh)$/.test(runner ?? '') && /^-(?!\w*n)\w*c$/.test(words[i]) && words[i + 1]) { const r = helperRun(words[i + 1], cwd); if (r) return r; runner = 'mention'; break; }
      if (runner === 'sudo' && /^(-\w*[ug]|--user|--group)$/.test(words[i])) i++;
      i++;
    }
    if (runner === 'mention' || i >= words.length) continue;
    let w = words[i];
    if (cwd && !w.startsWith('/') && !w.startsWith('$') && w.includes('/')) w = posix.join(cwd, w);
    if (HELPER_WORD.test(w)) return words[i];
  }
  return null;
}

type Call = { tool: string; args: unknown; locator: string; file: string; sha256: string };

/** Classify one decoded tool call; several kinds may apply. */
export function classify(call: Call, harness: string): Event[] {
  const text = typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? '');
  const a = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;
  const out: Event[] = [];
  const ev = (kind: Event['kind'], detail: string): Event => ({ kind, tool: call.tool, detail: detail.slice(0, 300), file: call.file, locator: call.locator, sha256: call.sha256 });
  const path = String(a.path ?? a.file_path ?? a.filePath ?? a.target ?? '');
  const name = String(a.name ?? a.skill ?? a.skill_name ?? '');
  const command = String(a.command ?? a.cmd ?? (Array.isArray(a.argv) ? (a.argv as string[]).join(' ') : ''));
  const ran = command ? helperRun(command, typeof a.cwd === 'string' ? a.cwd : typeof a.workdir === 'string' ? a.workdir : null) : null;
  if (harness === 'openclaw') {
    if (call.tool === 'skills_read' && /^gstack(-\w+)?$/.test(name)) out.push(ev('skill_open', 'skills_read ' + name));
    if (/^(read|read_file)$/.test(call.tool) && (SKILL_RE.test(path) || SUB_SKILL_RE.test(path))) out.push(ev('skill_open', 'read ' + path));
    if (/^(exec|bash|shell|terminal|run)$/.test(call.tool) && ran) out.push(ev('helper_run', ran + ' in: ' + command));
  } else if (harness === 'hermes') {
    if (call.tool === 'skill_view' && /^gstack(-\w+)?$/.test(name)) out.push(ev('skill_open', 'skill_view ' + name));
    if (/^(read_file|read)$/.test(call.tool) && (SKILL_RE.test(path) || SUB_SKILL_RE.test(path) || /hermes\/skills\/gstack\//.test(path))) out.push(ev('skill_open', 'read_file ' + path));
    if (/^(terminal|execute_code|bash|shell)$/.test(call.tool) && ran) out.push(ev('helper_run', ran + ' in: ' + command));
  }
  if (GSTACK_RE.test(text) && !out.length) out.push(ev('gstack_path', call.tool + ' ' + text));
  return out;
}

function summarize(files: Evidence['files'], calls: Call[], harness: string, transcript: Evidence['transcript'], note: string | undefined, excerpt: string[]): Evidence {
  const events = calls.flatMap(c => classify(c, harness));
  const opens = events.filter(e => e.kind === 'skill_open');
  const router = opens.find(e => /skills_read gstack$|skill_view gstack$|\/gstack\/SKILL\.md$/.test(e.detail)) ?? null;
  const sub = opens.find(e => /gstack-(review|investigate)/.test(e.detail)) ?? null;
  return { transcript, files, tool_calls: calls.length, events, skill_open: router ?? sub, sub_skill_open: sub, helper_run: events.find(e => e.kind === 'helper_run') ?? null,
    gstack_paths: events.filter(e => e.kind === 'gstack_path').length, ...(note ? { note } : {}), excerpt };
}

const clip = (s: string, n = 240) => (s.length <= n ? s : s.slice(0, n) + ' ...').replace(/\n/g, ' ');
const nonEmpty = (p: string) => existsSync(p) && statSync(p).size > 0;

/** Per-session completeness: the last event's label and the tool calls still waiting for a result. */
type Session = { last: string; openCalls: number };
const sessionsComplete = (sessions: Map<string, Session>, finalTurn: RegExp) => sessions.size > 0 && [...sessions.values()].every(s => s.openCalls === 0 && finalTurn.test(s.last));
const describe = (sessions: Map<string, Session>) => [...sessions.entries()].map(([id, s]) => 'session ' + id + ' last ' + s.last + (s.openCalls ? ', ' + s.openCalls + ' tool call(s) without a result' : '')).join('; ');

/** Hash the store and its side files where they are, read a scratch copy read-only, always clean the scratch up. */
function withCopy<T>(db: string, files: Evidence['files'], read: (conn: Database) => T): T {
  const mine = [db, db + '-wal', db + '-shm'].filter(nonEmpty).map(p => ({ path: p, sha256: sha256(p), bytes: statSync(p).size }));
  files.push(...mine);
  const scratch = mkdtempSync(join(tmpdir(), 'gsta135-ev-'));
  for (const f of mine) copyFileSync(f.path, join(scratch, basename(f.path)));
  const conn = new Database(join(scratch, basename(db)), { readonly: true });
  try { return read(conn); } finally { conn.close(); rmSync(scratch, { recursive: true, force: true }); }
}

/** OpenClaw 2026.10: the exec session store is agents/<agent>/agent/openclaw-agent.sqlite under the --state-dir; transcript_events
 *  (primary key session_id, seq) holds the pi-agent session events (event_json, or event_zstd for large ones); an assistant message's
 *  content carries toolCall blocks and its stopReason says why the turn ended (stop, toolUse, length, error). */
export function openclaw(out: string): Evidence {
  const root = join(out, 'state', 'openclaw', 'exec', 'agents');
  const found = existsSync(root) ? readdirSync(root).map(a => join(root, a, 'agent', 'openclaw-agent.sqlite')).filter(existsSync) : [];
  const dbs = found.filter(nonEmpty);
  if (!dbs.length) return summarize([], [], 'openclaw', 'missing', found.length ? 'empty openclaw-agent.sqlite' : 'no openclaw-agent.sqlite under state/openclaw/exec/agents', []);
  const files: Evidence['files'] = [];
  const calls: Call[] = [];
  const excerpt: string[] = [];
  const sessions = new Map<string, Session>();
  let rows = 0, undecoded = 0;
  for (const d of dbs) {
    excerpt.push('source: ' + d);
    withCopy(d, files, conn => {
      const sha = files.find(f => f.path === d)!.sha256;
      for (const r of conn.query('select session_id, seq, event_json, event_zstd from transcript_events order by session_id, seq').all() as Array<{ session_id: string; seq: number; event_json: string | null; event_zstd: Uint8Array | null }>) {
        rows++;
        const at = 'session ' + r.session_id.slice(0, 8) + ' seq ' + r.seq;
        let ev: any;
        try { ev = JSON.parse(r.event_json ?? new TextDecoder().decode(Bun.zstdDecompressSync(r.event_zstd!))); } catch { undecoded++; excerpt.push(at + ' undecodable'); continue; }
        const m = ev.message;
        if (ev.type !== 'message' || !m || typeof m !== 'object') continue;
        const s = sessions.get(r.session_id) ?? { last: 'none', openCalls: 0 };
        sessions.set(r.session_id, s);
        if (m.role === 'user') { excerpt.push(at + ' user: ' + clip(typeof m.content === 'string' ? m.content : JSON.stringify(m.content), 160)); s.last = 'user'; continue; }
        if (m.role === 'toolResult') { s.openCalls = Math.max(0, s.openCalls - 1); excerpt.push(at + ' toolResult ' + String(m.toolName ?? '') + ': ' + clip(JSON.stringify(m.content ?? ''), 120)); s.last = 'toolResult'; continue; }
        if (m.role !== 'assistant') continue;
        s.last = 'assistant' + (m.stopReason ? ':' + m.stopReason : '');
        for (const block of Array.isArray(m.content) ? m.content : []) {
          if (block?.type === 'text') excerpt.push(at + ' text: ' + clip(String(block.text ?? ''), 300));
          if (block?.type !== 'toolCall' && block?.type !== 'tool_use') continue;
          s.openCalls++;
          calls.push({ tool: String(block.name ?? ''), args: block.arguments ?? block.input ?? {}, locator: 'transcript_events ' + at, file: d, sha256: sha });
          excerpt.push(at + ' toolCall ' + String(block.name ?? '') + ' ' + clip(JSON.stringify(block.arguments ?? block.input ?? {})));
        }
      }
    });
  }
  const complete = rows > 0 && undecoded === 0 && sessionsComplete(sessions, /^assistant(:(stop|end_turn))?$/);
  return summarize(files, calls, 'openclaw', rows === 0 ? 'missing' : complete ? 'complete' : 'truncated',
    rows + ' events' + (undecoded ? ', ' + undecoded + ' undecodable' : '') + '; ' + describe(sessions), excerpt);
}

/** Hermes: HERMES_HOME/state.db, table messages (role, content, tool_calls JSON, tool_name, tool_call_id, finish_reason). */
export function hermes(out: string): Evidence {
  const db0 = join(out, 'state', 'hermes', 'state.db');
  if (!existsSync(db0)) return summarize([], [], 'hermes', 'missing', 'no state/hermes/state.db', []);
  if (!nonEmpty(db0)) return summarize([], [], 'hermes', 'missing', 'empty state/hermes/state.db', []);
  const files: Evidence['files'] = [];
  const rows = withCopy(db0, files, conn => conn.query('select id, session_id, role, content, tool_calls, tool_name, finish_reason from messages order by session_id, id').all() as Array<{ id: number; session_id: string; role: string; content: string | null; tool_calls: string | null; tool_name: string | null; finish_reason: string | null }>);
  const calls: Call[] = [];
  const excerpt = ['source: ' + db0];
  const sessions = new Map<string, Session>();
  let undecoded = 0;
  for (const r of rows) {
    const s = sessions.get(r.session_id) ?? { last: 'none', openCalls: 0 };
    sessions.set(r.session_id, s);
    if (r.role === 'user') { excerpt.push('id ' + r.id + ' user: ' + clip(r.content ?? '', 160)); s.last = 'user'; continue; }
    if (r.role === 'tool') { s.openCalls = Math.max(0, s.openCalls - 1); excerpt.push('id ' + r.id + ' tool result (' + (r.tool_name ?? '') + '): ' + clip(r.content ?? '', 120)); s.last = 'tool'; continue; }
    if (r.role !== 'assistant') continue;
    s.last = 'assistant/' + (r.finish_reason ?? 'none');
    if (!r.tool_calls) { excerpt.push('id ' + r.id + ' text: ' + clip(r.content ?? '', 300)); continue; }
    let tcs: any[];
    try { tcs = JSON.parse(r.tool_calls); if (!Array.isArray(tcs)) throw new Error('not an array'); } catch { undecoded++; s.last = 'undecodable'; excerpt.push('id ' + r.id + ' undecodable tool_calls'); continue; }
    for (const tc of tcs) {
      const fn = tc.function ?? tc;
      let args = fn.arguments ?? tc.input ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep the string */ } }
      s.openCalls++;
      calls.push({ tool: String(fn.name ?? tc.name ?? ''), args, locator: 'messages id ' + r.id + ' session ' + r.session_id, file: db0, sha256: files[0].sha256 });
      excerpt.push('id ' + r.id + ' tool_call ' + String(fn.name ?? tc.name ?? '') + ' ' + clip(typeof args === 'string' ? args : JSON.stringify(args)));
    }
  }
  const complete = rows.length > 0 && undecoded === 0 && sessionsComplete(sessions, /^assistant\/stop$/);
  return summarize(files, calls, 'hermes', !rows.length ? 'missing' : complete ? 'complete' : 'truncated',
    rows.length + ' messages' + (undecoded ? ', ' + undecoded + ' undecodable' : '') + '; ' + describe(sessions), excerpt);
}

/** QM: no decoder at this pin. The QM cells did not run (the preflight's register failure), so no turn record exists to fix a
 *  decoder against; a QM cell is unobservable until one does. */
export function qm(out: string): Evidence {
  const files = [join(out, 'logs', 'qm-turn.json'), join(out, 'logs', 'core.log')].filter(nonEmpty).map(p => ({ path: p, sha256: sha256(p), bytes: statSync(p).size }));
  return summarize(files, [], 'qm', files.length ? 'unobservable' : 'missing', 'no QM transcript decoder at this pin', []);
}

export function extract(harness: string, out: string): Evidence {
  if (harness === 'openclaw') return openclaw(out);
  if (harness === 'hermes') return hermes(out);
  if (harness === 'qm') return qm(out);
  throw new Error('unknown harness ' + harness);
}

if (import.meta.main) {
  const [harness, out, mode] = process.argv.slice(2);
  if (!harness || !out) { console.error('usage: evidence.ts <openclaw|hermes|qm> <trial out dir> [--excerpt]'); process.exit(64); }
  const ev = extract(harness, out);
  if (mode === '--excerpt') console.log(ev.excerpt.join('\n'));
  else { const { excerpt, ...rest } = ev; console.log(JSON.stringify(rest, null, 2)); }
}
