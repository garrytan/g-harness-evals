#!/usr/bin/env bun
/**
 * Exposure reader for the review-bugs eval (eval plan, "Exposure gate"; build step 3). For each PR-pass (one review
 * session of one unit) it reads the harness's OWN transcript, never a wrapper log, and prints four signals:
 *
 *   1 skill_opened      the gstack review skill file was opened, with a result that shows the file, not an error
 *   2 army_dispatched   a Review Army specialist was dispatched: a started subagent launch whose prompt names a reader-map
 *                       checklist path (a launch naming two or more covers each named one, gstack-evals' "batched")
 *   3 adv_dispatched    the adversarial reader was dispatched: a started launch that carries a map adversarial marker and
 *                       names no checklist (gstack-evals readerOf: a checklist beats the marker)
 *   4 all_returned      at least one reader was dispatched and every started launch's report came back before the
 *                       session ended (before the main agent's final message), with the readers named
 *
 * then, against the expected readers gstack's depth rule names for the unit (another step computes them), the gate and
 * the strict result side by side:
 *
 *   gate    pass when the skill file was opened and every expected reader was dispatched and returned; an empty
 *           expected list passes on the skill open alone
 *   strict  pass when all four signals hold; "fail (<why>)" otherwise, for example "fail (no readers dispatched)"
 *
 * A launch the harness refused or that never started (OpenClaw's spawn error, Hermes's one-shot delegation budget, a
 * Claude Code launch with no task_started and no subagent message) is counted under refused and covers no reader.
 *
 * Harnesses and the transcript each reads (the path in the sessions file is the session's output dir, or the file):
 *   claude-code  transcript.ndjson (or host/transcript.ndjson) from the gstack-evals review rig: Agent SDK messages, one
 *                per line. Launch: an Agent or Task tool_use from the main agent (no parent_tool_use_id); started: a
 *                task_started for its id or any message whose parent_tool_use_id is its id (gstack-evals readers.ts
 *                readerUsage); returned: its tool_result (not an error) when the launch ran in the foreground, or, when
 *                it ran in the background (run_in_background, or a result that says "Async agent launched"), a
 *                task_notification for its id whose status is completed or absent; both must come before the last result
 *                message. Skill open: a Skill call for review (review, gstack:review, gstack-review) whose result is not
 *                an error, a Read (or shell read) of a review SKILL.md whose result shows the file, or a main-agent user
 *                message carrying the skill body (a /review slash command expands to it), or a main-agent Bash call to
 *                the skill's preamble, gstack-skill-start --skill review, whose result has a line starting
 *                "SKILL_START_PROTO: " (review-real-bugs stage 1, amendment 2: the rig never logs the slash-command
 *                expansion). With --skill ship the same four kinds of signal are read for /ship instead (a Skill call for
 *                ship, a read of ship/SKILL.md, the gstack-skill-start --skill ship preamble), for stage 2's ship-panel
 *                arm; the body-in-a-user-message signal is /review's only.
 *   codex        CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl under <out>/state/codex (Codex 0.165.0's own thread
 *                log). The main thread is the rollout whose session_meta has no parent_thread_id. Launch: a function_call
 *                spawn_agent (namespace collaboration); started: its function_call_output names a task_name; returned: an
 *                agent_message from that agent path with "Message Type: FINAL_ANSWER" before the main thread's last
 *                task_complete. Skill open: an exec_command, shell or code-mode exec call that reads a review SKILL.md and
 *                whose output shows it.
 *   openclaw     <out>/state/openclaw/exec/agents/<agent>/agent/openclaw-agent.sqlite, decoded with
 *                scripts/gsta-135/evidence.ts readOpenclaw. Launch: sessions_spawn, called directly or through the
 *                deferred-tool bridge tool_call {id: "sessions_spawn"}; started: the spawn receipt says status accepted;
 *                returned: a later agents_wait result lists the run as completed with status done, before the main
 *                session's final assistant message. In "openclaw agent exec" at 2026.10.6 no child ever runs (see
 *                exposure.md), so this path is what a future version would need. Skill open: a read (or exec read) of
 *                the real skill file .../skills/gstack/skills/gstack-review/SKILL.md, or a skills_read whose result shows
 *                the real file; the 805-byte stub at <state>/skills/gstack-review/SKILL.md alone is not the skill.
 *   hermes       <out>/state/hermes/state.db, tool calls decoded with evidence.ts readHermes and the rows read directly
 *                for order and session links. The main session is the one with no parent_session_id. Launch: each task of
 *                a delegate_task call (goal, or tasks[]); started: the result lists it (one-shot, synchronous) or says
 *                status dispatched (chat mode, background); a tool error (the one-shot budget) is refused. Returned: the
 *                one-shot result entry has status completed, or, in the background, a main-session user row with
 *                display_kind async_delegation_complete names the delegation_id, before the main session's final
 *                assistant row. That user row is the harness's own delivery, not an injected turn. Skill open:
 *                skill_view gstack-review, or a read_file or terminal read of .../gstack-review/SKILL.md, whose result
 *                shows the file.
 * "Shows the file": the result text carries the review skill's body heading "# Pre-Landing PR Review" or gstack's
 * generated-file line "AUTO-GENERATED from SKILL.md.tmpl" (the stub carries neither), and is not an error.
 *
 * A transcript that cannot be read makes that PR-pass a gap, never exposed or not exposed: the row prints gap, the
 * program writes one line per gap to stderr, "<code> <file>: <detail>; expected <format>", and exits 3 after printing
 * every row. Codes:
 *   E_EXPOSURE_MISSING      no transcript where the harness writes it
 *   E_EXPOSURE_EMPTY        the transcript exists and holds nothing (zero bytes, blank lines, no rows)
 *   E_EXPOSURE_UNDECODABLE  a line or row that does not decode (JSON, zstd, tool_calls)
 *   E_EXPOSURE_TRUNCATED    the session has no end: no final result message (claude-code), no task_complete (codex), or
 *                           a main session whose last row is not the assistant's final stop or has a call with no result
 *                           (openclaw, hermes); a torn last line counts here
 *   E_EXPOSURE_TAMPERED     a user turn after the main session's first assistant row that is not the harness's own
 *                           delivery of a reader's result (evidence.ts's rule)
 *
 *   bun scripts/review-bugs/exposure.ts --sessions <file> --map <reader-map.json> --expected <expected.json> [--skill review|ship] [--json]
 *
 * The sessions file is TSV with a header row (unit, pass, harness, path, and optionally arm) or JSON lines with the same
 * keys; a relative path resolves from the sessions file's folder. expected.json is {"<unit>": ["<reader>", ...]}, reader
 * names from the map plus adversarial-native. Output: one TSV row per PR-pass, then totals per harness (and per harness
 * and arm when the sessions file has an arm column); --json prints {rows, totals} instead.
 *
 * Exit codes: 0 every row was read; 3 at least one gap (every other row is still printed); 64 usage or input error (bad
 * arguments, an unreadable or malformed sessions, map or expected file, a harness outside the four, a unit the expected
 * file does not list).
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readHermes, readOpenclaw, type Call } from '../gsta-135/evidence.ts';
import { shellReadArgs } from '../skill-resolver/got-skill.ts';

export const HARNESSES = ['claude-code', 'codex', 'openclaw', 'hermes'] as const;
export type Harness = typeof HARNESSES[number];
export const ADVERSARIAL = 'adversarial-native';
export const GAP_CODES = { missing: 'E_EXPOSURE_MISSING', empty: 'E_EXPOSURE_EMPTY', undecodable: 'E_EXPOSURE_UNDECODABLE', truncated: 'E_EXPOSURE_TRUNCATED', tampered: 'E_EXPOSURE_TAMPERED' } as const;
export type GapCode = typeof GAP_CODES[keyof typeof GAP_CODES];
export const FORMATS: Record<Harness, string> = {
  'claude-code': 'transcript.ndjson (or host/transcript.ndjson) of Agent SDK messages, one JSON object per line, ending in a result message',
  codex: 'state/codex/sessions/YYYY/MM/DD/rollout-*.jsonl (Codex thread log, one JSON object per line), the main thread ending in task_complete',
  openclaw: 'state/openclaw/exec/agents/<agent>/agent/openclaw-agent.sqlite with transcript_events, the main session ending in an assistant stop',
  hermes: 'state/hermes/state.db with messages and sessions, the main session ending in an assistant row with finish_reason stop',
};
export const EXIT = { ok: 0, gap: 3, usage: 64 } as const;

export class ExposureGap extends Error {
  constructor(readonly code: GapCode, readonly file: string, readonly detail: string) { super(code + ' ' + file + ': ' + detail); }
}

export interface ReaderMap { schema_version: 1; gstack: { repo: string; sha: string }; checklists: Record<string, string>; adversarial: string[] }

/** The map in a file (gstack-evals src/trial/review/readers.ts format), or the problem with it. */
export function loadReaderMap(file: string): { map: ReaderMap } | { problem: string } {
  let m: ReaderMap;
  try { m = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { problem: (e as Error).message }; }
  if (m?.schema_version !== 1) return { problem: 'schema_version must be 1' };
  if (typeof m.gstack?.repo !== 'string' || !/^[0-9a-f]{40}$/.test(m.gstack?.sha ?? '')) return { problem: 'gstack needs repo and a 40-character sha' };
  const names = Object.values(m.checklists ?? {});
  if (!names.length || Object.keys(m.checklists).some(p => !/^[\w.-]+(?:\/[\w.-]+)*\.md$/.test(p))) return { problem: 'checklists must map gstack-relative .md paths to reader names' };
  if (names.some(n => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(n) || n === ADVERSARIAL || n === 'batched' || n === 'other')) return { problem: 'a checklist reader name is not a reader name, or is batched, adversarial-native or other' };
  if (!Array.isArray(m.adversarial) || !m.adversarial.length || m.adversarial.some(a => typeof a !== 'string' || !a.trim())) return { problem: 'adversarial needs at least one marker' };
  return { map: m };
}

const escape = (s: string) => s.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
/** The readers a launch prompt covers: every checklist it names (two or more is gstack-evals' batched, covering each), else
 *  adversarial-native when it carries a marker, else none. A path counts only whole, as in readers.ts readerOf. */
export function readersOf(prompt: string, map: ReaderMap): string[] {
  const hits = Object.entries(map.checklists).filter(([p]) => new RegExp('(?<![\\w.-])' + escape(p) + '(?![\\w-]|\\.\\w)').test(prompt)).map(([, r]) => r);
  if (hits.length) return [...new Set(hits)].sort();
  return map.adversarial.some(a => prompt.includes(a)) ? [ADVERSARIAL] : [];
}

export interface Launch { locator: string; tool: string; prompt: string; started: boolean; refused: string | null; returned: boolean; note: string }
export interface SkillOpen { opened: boolean; locator: string | null; how: string | null }
export interface SessionRead { harness: Harness; files: string[]; skill: SkillOpen; launches: Launch[]; note: string }

const REVIEW_BODY = /# Pre-Landing PR Review|AUTO-GENERATED from SKILL\.md\.tmpl/;
export const GATE_SKILLS = ['review', 'ship'] as const;
export type GateSkill = (typeof GATE_SKILLS)[number];
const skillStart = (skill: GateSkill) => new RegExp('gstack-skill-start\\s+--skill\\s+["\']?' + skill + '["\']?(?=\\s|$)');
const skillMd = (skill: GateSkill) => new RegExp('(?:^|/)(?:gstack-)?' + skill + '/SKILL\\.md$');
const REVIEW_SKILL_MD = skillMd('review');
const REAL_OPENCLAW_SKILL = /gstack\/skills\/gstack-review\/SKILL\.md$/;
const ERROR_TEXT = /^\s*(?:error|no such)\b|<tool_use_error>|No such file or directory|ENOENT|Permission denied/i;
const shows = (text: string | null | undefined): boolean => !!text && REVIEW_BODY.test(text) && !ERROR_TEXT.test(text.slice(0, 400));
const noSkill: SkillOpen = { opened: false, locator: null, how: null };
const textOf = (c: unknown): string => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => (b && typeof b === 'object' ? String((b as Record<string, unknown>).text ?? (typeof (b as Record<string, unknown>).content === 'string' ? (b as Record<string, unknown>).content : '')) : String(b))).join('\n') : '';
const nonEmpty = (p: string) => existsSync(p) && statSync(p).size > 0;

/** JSON lines of a file: missing, empty, undecodable (a bad line before the last) and torn (a bad last line) are gaps. */
function jsonLines(file: string): Array<Record<string, any>> {
  if (!existsSync(file)) throw new ExposureGap(GAP_CODES.missing, file, 'no such file');
  const lines = readFileSync(file, 'utf8').split('\n');
  const idx = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim());
  if (!idx.length) throw new ExposureGap(GAP_CODES.empty, file, 'no lines');
  const out: Array<Record<string, any>> = [];
  for (let k = 0; k < idx.length; k++) {
    const [l, i] = idx[k];
    let v: unknown;
    try { v = JSON.parse(l); } catch { throw new ExposureGap(k === idx.length - 1 ? GAP_CODES.truncated : GAP_CODES.undecodable, file, 'line ' + (i + 1) + ' is not JSON' + (k === idx.length - 1 ? ' (a torn last line)' : '')); }
    if (!v || typeof v !== 'object') throw new ExposureGap(GAP_CODES.undecodable, file, 'line ' + (i + 1) + ' is not a JSON object');
    out.push(v as Record<string, any>);
  }
  return out;
}

// ---- Claude Code (gstack-evals review rig) ----------------------------------------------------------------------------

export function readClaudeCode(path: string, gateSkill: GateSkill = 'review'): SessionRead {
  const file = [path, join(path, 'transcript.ndjson'), join(path, 'host', 'transcript.ndjson')].find(p => existsSync(p) && statSync(p).isFile()) ?? join(path, 'transcript.ndjson');
  const msgs = jsonLines(file);
  const lastResult = msgs.map(m => m.type).lastIndexOf('result');
  if (lastResult < 0) throw new ExposureGap(GAP_CODES.truncated, file, msgs.length + ' messages and no result message: the session has no end');
  const launches = new Map<string, Launch & { at: number; background: boolean }>();
  const started = new Set<string>();
  const results = new Map<string, { at: number; text: string; error: boolean }>();
  const notes = new Map<string, { at: number; status: string | null }>();
  const uses = new Map<string, { name: string; input: Record<string, any>; at: number }>();
  let skill: SkillOpen = noSkill;
  msgs.forEach((m, at) => {
    const main = !m.parent_tool_use_id;
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    if (m.type === 'assistant' && main) for (const b of content) {
      if (b?.type !== 'tool_use' || typeof b.id !== 'string') continue;
      uses.set(b.id, { name: String(b.name), input: b.input ?? {}, at });
      if ((b.name === 'Agent' || b.name === 'Task') && !launches.has(b.id)) launches.set(b.id, { locator: 'line ' + (at + 1) + ' tool_use ' + b.id, tool: b.name, prompt: typeof b.input?.prompt === 'string' ? b.input.prompt : '', started: false, refused: null, returned: false, note: '', at, background: b.input?.run_in_background === true });
    }
    if (m.type === 'user' && main) {
      for (const b of content) if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string' && !results.has(b.tool_use_id)) results.set(b.tool_use_id, { at, text: textOf(b.content), error: b.is_error === true });
      const text = typeof m.message?.content === 'string' ? m.message.content : textOf(content);
      if (!skill.opened && gateSkill === 'review' && shows(text) && /# Pre-Landing PR Review/.test(text)) skill = { opened: true, locator: 'line ' + (at + 1), how: 'skill body in a main-agent user message' };
    }
    if (m.type === 'system' && m.subtype === 'task_started' && typeof m.tool_use_id === 'string') started.add(m.tool_use_id);
    if (typeof m.parent_tool_use_id === 'string') started.add(m.parent_tool_use_id);
    if (m.type === 'system' && m.subtype === 'task_notification' && typeof m.tool_use_id === 'string' && !notes.has(m.tool_use_id)) notes.set(m.tool_use_id, { at, status: typeof m.status === 'string' ? m.status : null });
  });
  for (const [id, u] of uses) {
    if (skill.opened) break;
    const r = results.get(id);
    if (!r || r.error) continue;
    const md = skillMd(gateSkill);
    if (u.name === 'Skill' && new RegExp('^(?:gstack[:-])?' + gateSkill + '$').test(String(u.input.skill ?? ''))) skill = { opened: true, locator: 'line ' + (u.at + 1) + ' tool_use ' + id, how: 'Skill ' + u.input.skill };
    else if (u.name === 'Read' && md.test(String(u.input.file_path ?? u.input.path ?? '')) && shows(r.text)) skill = { opened: true, locator: 'line ' + (u.at + 1) + ' tool_use ' + id, how: 'Read ' + (u.input.file_path ?? u.input.path) };
    else if (u.name === 'Bash' && shellReadArgs(String(u.input.command ?? '')).some(a => md.test(a)) && shows(r.text)) skill = { opened: true, locator: 'line ' + (u.at + 1) + ' tool_use ' + id, how: 'Bash read of a ' + gateSkill + ' SKILL.md' };
    else if (u.name === 'Bash' && skillStart(gateSkill).test(String(u.input.command ?? '')) && /^SKILL_START_PROTO: /m.test(r.text)) skill = { opened: true, locator: 'line ' + (u.at + 1) + ' tool_use ' + id, how: gateSkill + ' skill preamble: gstack-skill-start --skill ' + gateSkill };
  }
  const out: Launch[] = [];
  for (const [id, l] of launches) {
    const r = results.get(id);
    l.started = started.has(id);
    if (!l.started) { l.refused = r?.error ? r.text.slice(0, 160) : 'no task_started and no subagent message'; out.push(l); continue; }
    const background = l.background || /^\s*Async agent launched/i.test(r?.text ?? '');
    const n = notes.get(id);
    if (background) { l.returned = !!n && n.at < lastResult && (n.status === null || n.status === 'completed'); l.note = n ? 'task_notification ' + (n.status ?? 'no status') + ' at line ' + (n.at + 1) : 'no task_notification'; }
    else { l.returned = !!r && !r.error && r.at < lastResult; l.note = r ? 'tool_result at line ' + (r.at + 1) + (r.error ? ' (error)' : '') : 'no tool_result'; }
    if (!l.returned && (background ? n : r) && (background ? n!.at : r!.at) > lastResult) l.note += ', after the final result at line ' + (lastResult + 1);
    out.push(l);
  }
  return { harness: 'claude-code', files: [file], skill, launches: out, note: msgs.length + ' messages, final result at line ' + (lastResult + 1) };
}

// ---- Codex 0.165.0 --------------------------------------------------------------------------------------------------

function rollouts(path: string): string[] {
  if (existsSync(path) && statSync(path).isFile()) return [path];
  const root = [join(path, 'state', 'codex', 'sessions'), join(path, 'codex', 'sessions'), join(path, 'sessions')].find(existsSync);
  if (!root) return [];
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : /^rollout-.*\.jsonl$/.test(e.name) ? [join(d, e.name)] : []);
  return walk(root).sort();
}

export function readCodex(path: string): SessionRead {
  const files = rollouts(path);
  if (!files.length) throw new ExposureGap(GAP_CODES.missing, join(path, 'state', 'codex', 'sessions'), 'no rollout-*.jsonl');
  const threads = files.map(f => ({ file: f, lines: jsonLines(f) }));
  const meta = (t: { lines: Array<Record<string, any>> }) => t.lines.find(l => l.type === 'session_meta')?.payload ?? {};
  const mains = threads.filter(t => !meta(t).parent_thread_id);
  if (mains.length !== 1) throw new ExposureGap(GAP_CODES.undecodable, files[0], mains.length + ' rollouts without a parent_thread_id; one main thread expected');
  const main = mains[0];
  const end = main.lines.map(l => l.type === 'event_msg' && l.payload?.type === 'task_complete').lastIndexOf(true);
  if (end < 0) throw new ExposureGap(GAP_CODES.truncated, main.file, 'the main thread has no task_complete: the session has no end');
  const items = main.lines.map((l, at) => ({ at, p: l.type === 'response_item' ? l.payload ?? {} : {} }));
  const outputs = new Map<string, { at: number; text: string }>();
  for (const { at, p } of items) if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && typeof p.call_id === 'string') outputs.set(p.call_id, { at, text: typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '') });
  let skill: SkillOpen = noSkill;
  const launches: Launch[] = [];
  const loc = (at: number) => basename(main.file) + ' line ' + (at + 1);
  for (const { at, p } of items) {
    if (p.type !== 'function_call' && p.type !== 'custom_tool_call') continue;
    const out = outputs.get(p.call_id);
    let args: Record<string, any> = {};
    if (p.type === 'function_call') { try { args = JSON.parse(p.arguments ?? '{}'); } catch { args = {}; } }
    const input = p.type === 'custom_tool_call' ? String(p.input ?? '') : String(args.cmd ?? args.command ?? '');
    if (!skill.opened && out && (p.name === 'exec' || /^(exec_command|shell|shell_command)$/.test(p.name)) && shows(out.text)
      && (shellReadArgs(Array.isArray(args.command) ? args.command.join(' ') : input).some(a => REVIEW_SKILL_MD.test(a)) || (p.type === 'custom_tool_call' && /(?:gstack-)?review\/SKILL\.md/.test(input))))
      skill = { opened: true, locator: loc(at), how: p.name + ' read of a review SKILL.md' };
    if (p.type === 'function_call' && p.name === 'spawn_agent') {
      const named = out && /"task_name"\s*:\s*"([^"]+)"/.exec(out.text)?.[1];
      const path = named || null;
      const reply = path ? items.find(({ at: a, p: q }) => a > at && q.type === 'agent_message' && q.author === path && /Message Type: FINAL_ANSWER/.test(textOf(q.content))) : undefined;
      launches.push({ locator: loc(at) + ' call ' + p.call_id, tool: 'spawn_agent', prompt: String(args.message ?? ''), started: !!path, refused: path ? null : out ? out.text.slice(0, 160) : 'no function_call_output',
        returned: !!reply && reply.at < end, note: reply ? 'FINAL_ANSWER from ' + path + ' at ' + loc(reply.at) : path ? 'no FINAL_ANSWER from ' + path + ' before task_complete' : '' });
    }
  }
  return { harness: 'codex', files, skill, launches, note: threads.length + ' rollout(s), main ' + basename(main.file) + ' ending at line ' + (end + 1) };
}

// ---- sqlite stores (OpenClaw, Hermes) -------------------------------------------------------------------------------

/** Read a scratch copy of a store (with its -wal and -shm) so reading leaves no side files, as evidence.ts does. */
function withCopy<T>(db: string, read: (conn: Database) => T): T {
  const scratch = mkdtempSync(join(tmpdir(), 'exposure-'));
  for (const f of [db, db + '-wal', db + '-shm'].filter(nonEmpty)) copyFileSync(f, join(scratch, basename(f)));
  try {
    const conn = new Database(join(scratch, basename(db)), { readonly: true });
    try { return read(conn); } finally { conn.close(); }
  } catch (e) {
    if (e instanceof ExposureGap) throw e;
    throw new ExposureGap(GAP_CODES.undecodable, db, 'not a readable sqlite store: ' + (e as Error).message);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const resultText = (c: Call) => c.result?.text ?? null;
function skillFromCalls(calls: Call[], harness: 'openclaw' | 'hermes'): SkillOpen {
  for (const c of calls) {
    const a = (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, unknown>;
    const path = String(a.path ?? a.file_path ?? a.filePath ?? '');
    const name = String(a.name ?? a.skill ?? '');
    const command = String(a.command ?? a.cmd ?? '');
    const text = resultText(c);
    if (c.result?.ok === false || !shows(text)) continue;
    const realPath = (p: string) => harness === 'openclaw' ? REAL_OPENCLAW_SKILL.test(p) : REVIEW_SKILL_MD.test(p);
    if (/^(read|read_file)$/.test(c.tool) && realPath(path)) return { opened: true, locator: c.locator, how: c.tool + ' ' + path };
    if (/^(exec|terminal|bash|shell)$/.test(c.tool) && shellReadArgs(command).some(realPath)) return { opened: true, locator: c.locator, how: c.tool + ' read of the review SKILL.md' };
    if ((c.tool === 'skill_view' || c.tool === 'skills_read') && /^(?:gstack[/-])?(?:gstack-)?review$/.test(name)) return { opened: true, locator: c.locator, how: c.tool + ' ' + name };
  }
  return noSkill;
}

function storeGap(t: { transcript: string; note?: string; files: Array<{ path: string }> }, file: string): never | void {
  if (t.transcript === 'missing') throw new ExposureGap(/empty|^0 (?:events|messages)/.test(t.note ?? '') ? GAP_CODES.empty : GAP_CODES.missing, file, t.note ?? 'missing');
  if (/undecodable/.test(t.note ?? '')) throw new ExposureGap(GAP_CODES.undecodable, file, t.note ?? 'undecodable rows');
}

/** evidence.ts's reader, with a store it cannot open (not sqlite, a missing table) turned into an undecodable gap. */
function decoded<T>(read: () => T, file: string): T {
  try { return read(); } catch (e) { throw e instanceof ExposureGap ? e : new ExposureGap(GAP_CODES.undecodable, file, 'the store does not decode: ' + (e as Error).message); }
}

export function readOpenclawSession(path: string): SessionRead {
  const t = decoded(() => readOpenclaw(path), join(path, 'state', 'openclaw', 'exec', 'agents'));
  const root = join(path, 'state', 'openclaw', 'exec', 'agents');
  const db = t.files[0]?.path ?? join(root, 'main', 'agent', 'openclaw-agent.sqlite');
  storeGap(t, db);
  type Ev = { session: string; seq: number; role: string; stop: string | null; text: string };
  const events = withCopy(db, conn => (conn.query('select session_id, seq, event_json, event_zstd from transcript_events order by session_id, seq').all() as Array<{ session_id: string; seq: number; event_json: string | null; event_zstd: Uint8Array | null }>).map(r => {
    const ev = JSON.parse(r.event_json ?? new TextDecoder().decode(Bun.zstdDecompressSync(r.event_zstd!)));
    const m = ev?.type === 'message' ? ev.message ?? {} : {};
    return { session: r.session_id, seq: r.seq, role: String(m.role ?? ev?.type ?? ''), stop: m.stopReason ?? null, text: JSON.stringify(m) } as Ev;
  }));
  const bySession = new Map<string, Ev[]>();
  for (const e of events) bySession.set(e.session, [...(bySession.get(e.session) ?? []), e]);
  const firstUser = (evs: Ev[]) => evs.find(e => e.role === 'user')?.text ?? '';
  const main = [...bySession.entries()].find(([, evs]) => !/\[Subagent Task\]/.test(firstUser(evs)))?.[0] ?? events[0]?.session;
  const mainEvs = (bySession.get(main ?? '') ?? []).filter(e => ['user', 'assistant', 'toolResult'].includes(e.role));
  const firstAssistant = mainEvs.findIndex(e => e.role === 'assistant');
  const injected = mainEvs.filter((e, i) => e.role === 'user' && firstAssistant >= 0 && i > firstAssistant);
  if (injected.length) throw new ExposureGap(GAP_CODES.tampered, db, injected.length + ' user row(s) after the main session\'s first assistant row (seq ' + injected.map(e => e.seq).join(', ') + ')');
  const last = mainEvs[mainEvs.length - 1];
  if (!last || last.role !== 'assistant' || !/^(stop|end_turn)$/.test(String(last.stop))) throw new ExposureGap(GAP_CODES.truncated, db, 'the main session ends with ' + (last ? last.role + '/' + last.stop : 'no message') + ', not the assistant\'s final stop');
  const mainCalls = t.calls.filter(c => c.locator.includes('session ' + (main ?? '').slice(0, 8)));
  if (mainCalls.some(c => c.result === null)) throw new ExposureGap(GAP_CODES.truncated, db, 'a main-session tool call has no result');
  const launches: Launch[] = [];
  for (const c of mainCalls) {
    const a = (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, any>;
    const spawn = c.tool === 'sessions_spawn' ? a : c.tool === 'tool_call' && /^(?:openclaw:core:)?sessions_spawn$/.test(String(a.id ?? '')) ? (a.args ?? {}) : null;
    if (!spawn) continue;
    const text = resultText(c) ?? '';
    const flat = text.replace(/\\+"/g, '"');
    const status = /"status"\s*:\s*"(\w+)"/.exec(flat)?.[1] ?? null;
    const runId = /"runId"\s*:\s*"([^"]+)"/.exec(flat)?.[1] ?? null;
    const started = status === 'accepted';
    const later = mainCalls.slice(mainCalls.indexOf(c) + 1).filter(w => (w.tool === 'agents_wait' || (w.tool === 'tool_call' && /agents_wait$/.test(String((w.args as Record<string, unknown>)?.id ?? '')))) && runId && (resultText(w) ?? '').includes(runId));
    const done = later.find(w => new RegExp('"runId"\\s*:\\s*"' + escape(runId!) + '"\\s*,\\s*"status"\\s*:\\s*"done"').test((resultText(w) ?? '').replace(/\\+"/g, '"')));
    const failed = later.map(w => /"status"\s*:\s*"(failed|killed|timeout)"[^}]*?"error"\s*:\s*"([^"]*)"/.exec((resultText(w) ?? '').replace(/\\+"/g, '"'))).find(Boolean);
    launches.push({ locator: c.locator, tool: c.tool === 'tool_call' ? 'tool_call sessions_spawn' : 'sessions_spawn', prompt: String(spawn.task ?? ''), started, refused: started ? null : 'spawn ' + (status ?? 'no status') + ': ' + (/"error"\s*:\s*"([^"]*)"/.exec(flat)?.[1] ?? text.slice(0, 120)),
      returned: !!done, note: done ? 'agents_wait done at ' + done.locator : failed ? 'run ' + failed[1] + ': ' + failed[2] : started ? 'no agents_wait result with status done for run ' + runId : '' });
  }
  return { harness: 'openclaw', files: t.files.map(f => f.path), skill: skillFromCalls(mainCalls, 'openclaw'), launches, note: events.length + ' events; main session ' + (main ?? '').slice(0, 8) + ', ' + bySession.size + ' session(s)' };
}

const DELEGATION_DONE = 'async_delegation_complete';
export function readHermesSession(path: string): SessionRead {
  const db = join(path, 'state', 'hermes', 'state.db');
  const t = decoded(() => readHermes(path), db);
  storeGap(t, db);
  type Row = { id: number; session_id: string; role: string; content: string | null; tool_call_id: string | null; tool_calls: string | null; tool_name: string | null; finish_reason: string | null; display_kind: string | null };
  const { rows, parents } = withCopy(db, conn => ({
    rows: conn.query('select id, session_id, role, content, tool_call_id, tool_calls, tool_name, finish_reason, display_kind from messages order by id').all() as Row[],
    parents: new Map((conn.query('select id, parent_session_id from sessions').all() as Array<{ id: string; parent_session_id: string | null }>).map(s => [s.id, s.parent_session_id])),
  }));
  if (!rows.length) throw new ExposureGap(GAP_CODES.empty, db, 'no message rows');
  const roots = [...new Set(rows.map(r => r.session_id))].filter(s => !parents.get(s));
  const main = roots[0] ?? rows[0].session_id;
  const mainRows = rows.filter(r => r.session_id === main);
  const firstAssistant = mainRows.findIndex(r => r.role === 'assistant');
  const injected = mainRows.filter((r, i) => r.role === 'user' && firstAssistant >= 0 && i > firstAssistant && r.display_kind !== DELEGATION_DONE);
  if (injected.length) throw new ExposureGap(GAP_CODES.tampered, db, injected.length + ' user row(s) after the main session\'s first assistant row that are not async_delegation_complete (id ' + injected.map(r => r.id).join(', ') + ')');
  const last = mainRows[mainRows.length - 1];
  if (last.role !== 'assistant' || last.finish_reason !== 'stop') throw new ExposureGap(GAP_CODES.truncated, db, 'the main session (' + main + ') ends with ' + last.role + '/' + (last.finish_reason ?? 'none') + ' at id ' + last.id + ', not the assistant\'s final stop');
  const mainCalls = t.calls.filter(c => c.locator.endsWith('session ' + main));
  if (mainCalls.some(c => c.result === null)) throw new ExposureGap(GAP_CODES.truncated, db, 'a main-session tool call has no result row');
  const idOf = (c: Call) => Number(/messages id (\d+)/.exec(c.locator)?.[1] ?? 0);
  const launches: Launch[] = [];
  for (const c of mainCalls) {
    if (c.tool !== 'delegate_task') continue;
    const a = (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, any>;
    if (a.action && String(a.action).toLowerCase() !== 'spawn') continue;
    const tasks: Array<Record<string, any>> = Array.isArray(a.tasks) && a.tasks.length ? a.tasks : [{ goal: a.goal, context: a.context }];
    const text = resultText(c) ?? '';
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = null; }
    const resultRow = rows.find(r => r.role === 'tool' && r.tool_call_id === c.id && r.session_id === main);
    const error = c.result?.ok === false ? (c.result.error ?? text).slice(0, 160) : null;
    const background = body?.status === 'dispatched';
    const delivered = background && typeof body.delegation_id === 'string' ? mainRows.find(r => r.role === 'user' && r.display_kind === DELEGATION_DONE && (r.content ?? '').includes(body.delegation_id)) : undefined;
    tasks.forEach((task, i) => {
      const prompt = [task.goal, task.context].filter(x => typeof x === 'string').join('\n');
      const entry = Array.isArray(body?.results) ? body.results.find((e: any) => e?.task_index === i) ?? body.results[i] : null;
      const started = !error && (background || !!entry);
      const doneRow = delivered && new RegExp('TASK ' + (i + 1) + '/' + tasks.length + ':[^\\n]*\\(status=completed').test(delivered.content ?? '') ? delivered : undefined;
      const returned = background ? !!doneRow && doneRow.id < last.id : !!entry && entry.status === 'completed' && (resultRow?.id ?? 0) < last.id;
      launches.push({ locator: c.locator + ' task ' + (i + 1), tool: 'delegate_task', prompt, started, refused: error, returned,
        note: background ? (doneRow ? 'async_delegation_complete at id ' + doneRow.id + ' (' + body.delegation_id + ')' : 'dispatched ' + body.delegation_id + ', no async_delegation_complete row before the session ended') : entry ? 'result entry status ' + entry.status + ' at id ' + (resultRow?.id ?? idOf(c)) : error ? '' : 'no result entry' });
    });
  }
  return { harness: 'hermes', files: t.files.map(f => f.path), skill: skillFromCalls(mainCalls, 'hermes'), launches, note: rows.length + ' rows; main session ' + main + ' ending at id ' + last.id + ', ' + (new Set(rows.map(r => r.session_id)).size - 1) + ' child session(s)' };
}

export function readSession(harness: Harness, path: string, gateSkill: GateSkill = 'review'): SessionRead {
  if (harness === 'claude-code') return readClaudeCode(path, gateSkill);
  if (gateSkill !== 'review') throw new UsageError('--skill ' + gateSkill + ' reads only claude-code sessions, not ' + harness);
  if (harness === 'codex') return readCodex(path);
  if (harness === 'openclaw') return readOpenclawSession(path);
  return readHermesSession(path);
}

// ---- assessment -----------------------------------------------------------------------------------------------------

export interface SessionRow { unit: string; pass: string; harness: Harness; path: string; arm?: string }
export interface ExposureRow extends SessionRow {
  gap: { code: GapCode; file: string; detail: string } | null;
  skill_opened: boolean | null; army_dispatched: boolean | null; adv_dispatched: boolean | null; all_returned: boolean | null;
  dispatched: string[]; returned: string[]; not_returned: string[]; refused: number; expected: string[]; expected_missing: string[];
  gate: string; strict: string; skill_how: string | null; note: string;
}

export function assess(s: SessionRead, map: ReaderMap, expected: string[]): Omit<ExposureRow, keyof SessionRow | 'gap'> {
  const started = s.launches.filter(l => l.started);
  const covered = (ls: Launch[]) => [...new Set(ls.flatMap(l => readersOf(l.prompt, map)))].sort();
  const dispatched = covered(started);
  const returned = covered(started.filter(l => l.returned));
  const notReturned = covered(started.filter(l => !l.returned));
  const army = dispatched.some(r => r !== ADVERSARIAL);
  const adv = dispatched.includes(ADVERSARIAL);
  const allReturned = started.length > 0 && started.every(l => l.returned);
  const missing = expected.filter(r => !returned.includes(r)).map(r => r + (dispatched.includes(r) ? ' (not returned)' : ' (not dispatched)'));
  const gateWhy = [...(s.skill.opened ? [] : ['skill not opened']), ...(missing.length ? ['missing ' + missing.join(', ')] : [])];
  const strictWhy = [...(s.skill.opened ? [] : ['skill not opened']), ...(!started.length ? ['no readers dispatched'] : [
    ...(army ? [] : ['no Review Army specialist']), ...(adv ? [] : ['no adversarial reader']), ...(allReturned ? [] : ['not every reader returned'])])];
  return { skill_opened: s.skill.opened, army_dispatched: army, adv_dispatched: adv, all_returned: allReturned, dispatched, returned, not_returned: notReturned,
    refused: s.launches.filter(l => !l.started).length, expected, expected_missing: missing,
    gate: gateWhy.length ? 'fail (' + gateWhy.join('; ') + ')' : 'pass', strict: strictWhy.length ? 'fail (' + strictWhy.join('; ') + ')' : 'pass', skill_how: s.skill.how, note: s.note };
}

export function exposureRow(r: SessionRow, map: ReaderMap, expected: Record<string, string[]>, gateSkill: GateSkill = 'review'): ExposureRow {
  const exp = expected[r.unit] ?? [];
  try {
    return { ...r, gap: null, ...assess(readSession(r.harness, r.path, gateSkill), map, exp) };
  } catch (e) {
    if (!(e instanceof ExposureGap)) throw e;
    return { ...r, gap: { code: e.code, file: e.file, detail: e.detail }, skill_opened: null, army_dispatched: null, adv_dispatched: null, all_returned: null, dispatched: [], returned: [], not_returned: [], refused: 0, expected: exp, expected_missing: [], gate: 'gap', strict: 'gap', skill_how: null, note: e.code };
  }
}

export interface Totals { harness: string; arm: string | null; pass_n: number; gaps: number; skill_opened: number; army_dispatched: number; adv_dispatched: number; all_returned: number; gate_pass: number; strict_pass: number }
export function totals(rows: ExposureRow[]): Totals[] {
  const withArm = rows.some(r => r.arm !== undefined && r.arm !== '');
  const keys = [...new Set(rows.flatMap(r => [r.harness + '\t', ...(withArm ? [r.harness + '\t' + (r.arm ?? '')] : [])]))].sort();
  return keys.map(k => {
    const [harness, arm] = k.split('\t');
    const rs = rows.filter(r => r.harness === harness && (arm === '' || (r.arm ?? '') === arm));
    const count = (f: (r: ExposureRow) => boolean) => rs.filter(f).length;
    return { harness, arm: arm === '' ? null : arm, pass_n: rs.length, gaps: count(r => !!r.gap), skill_opened: count(r => r.skill_opened === true), army_dispatched: count(r => r.army_dispatched === true),
      adv_dispatched: count(r => r.adv_dispatched === true), all_returned: count(r => r.all_returned === true), gate_pass: count(r => r.gate === 'pass'), strict_pass: count(r => r.strict === 'pass') };
  });
}

// ---- inputs and CLI -------------------------------------------------------------------------------------------------

export class UsageError extends Error {}
export function parseSessions(file: string): SessionRow[] {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new UsageError('sessions file ' + file + ': ' + (e as Error).message); }
  const base = dirname(resolve(file));
  const lines = text.split('\n').filter(l => l.trim());
  let raw: Array<Record<string, unknown>>;
  if (/\.jsonl?$/.test(file)) {
    raw = lines.map((l, i) => { try { return JSON.parse(l); } catch { throw new UsageError('sessions file ' + file + ' line ' + (i + 1) + ' is not JSON'); } });
  } else {
    const head = (lines.shift() ?? '').split('\t');
    for (const k of ['unit', 'pass', 'harness', 'path']) if (!head.includes(k)) throw new UsageError('sessions file ' + file + ': the header row needs unit, pass, harness and path (tab-separated)');
    raw = lines.map(l => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])));
  }
  return raw.map((r, i) => {
    const h = String(r.harness ?? '');
    if (!(HARNESSES as readonly string[]).includes(h)) throw new UsageError('sessions file ' + file + ' row ' + (i + 1) + ': harness ' + JSON.stringify(h) + ' is not one of ' + HARNESSES.join(', '));
    if (!r.unit || !r.pass || !r.path) throw new UsageError('sessions file ' + file + ' row ' + (i + 1) + ': unit, pass and path are required');
    const p = String(r.path);
    return { unit: String(r.unit), pass: String(r.pass), harness: h as Harness, path: isAbsolute(p) ? p : join(base, p), ...(r.arm !== undefined && r.arm !== '' ? { arm: String(r.arm) } : {}) };
  });
}

export function parseExpected(file: string, map: ReaderMap): Record<string, string[]> {
  let v: unknown;
  try { v = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new UsageError('expected file ' + file + ': ' + (e as Error).message); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new UsageError('expected file ' + file + ' must be {"<unit>": ["<reader>", ...]}');
  const names = new Set([...Object.values(map.checklists), ADVERSARIAL]);
  for (const [u, rs] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(rs) || rs.some(r => typeof r !== 'string')) throw new UsageError('expected file ' + file + ': unit ' + u + ' needs a list of reader names');
    const bad = (rs as string[]).find(r => !names.has(r));
    if (bad) throw new UsageError('expected file ' + file + ': unit ' + u + ' names ' + JSON.stringify(bad) + ', which is neither a map reader nor adversarial-native');
  }
  return v as Record<string, string[]>;
}

const cell = (v: boolean | null) => v === null ? 'gap' : v ? 'yes' : 'no';
const list = (xs: string[]) => xs.length ? xs.join(',') : '-';
export function tsv(rows: ExposureRow[], tot: Totals[]): string {
  const head = ['unit', 'pass', 'harness', 'arm', 'skill_opened', 'army_dispatched', 'adv_dispatched', 'all_returned', 'dispatched', 'returned', 'not_returned', 'refused', 'expected', 'expected_missing', 'gate', 'strict', 'skill_open', 'note'];
  const body = rows.map(r => [r.unit, r.pass, r.harness, r.arm ?? '-', cell(r.skill_opened), cell(r.army_dispatched), cell(r.adv_dispatched), cell(r.all_returned), list(r.dispatched), list(r.returned), list(r.not_returned), String(r.refused), list(r.expected), list(r.expected_missing), r.gate, r.strict, r.skill_how ?? '-', r.gap ? r.gap.code + ' ' + r.gap.file : r.note].join('\t'));
  const th = ['totals', 'harness', 'arm', 'pr_passes', 'gaps', 'skill_opened', 'army_dispatched', 'adv_dispatched', 'all_returned', 'gate_pass', 'strict_pass'];
  const tb = tot.map(t => ['totals', t.harness, t.arm ?? '-', t.pass_n, t.gaps, t.skill_opened, t.army_dispatched, t.adv_dispatched, t.all_returned, t.gate_pass, t.strict_pass].join('\t'));
  return [head.join('\t'), ...body, '', th.join('\t'), ...tb].join('\n') + '\n';
}

export function main(argv: string[], out: (s: string) => void = s => process.stdout.write(s), err: (s: string) => void = s => process.stderr.write(s)): number {
  const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const usage = 'usage: exposure.ts --sessions <sessions.tsv|.jsonl> --map <reader-map.json> --expected <expected.json> [--skill review|ship] [--json]\n';
  const known = new Set(['--sessions', '--map', '--expected', '--skill', '--json']);
  for (let i = 0; i < argv.length; i++) { if (!known.has(argv[i])) { err('E_EXPOSURE_USAGE unknown argument ' + argv[i] + '\n' + usage); return EXIT.usage; } if (argv[i] !== '--json') i++; }
  const [sessions, mapFile, expFile] = [one('--sessions'), one('--map'), one('--expected')];
  if (!sessions || !mapFile || !expFile) { err(usage); return EXIT.usage; }
  const gateSkill = (one('--skill') ?? 'review') as GateSkill;
  if (!GATE_SKILLS.includes(gateSkill)) { err('E_EXPOSURE_USAGE --skill takes review or ship\n' + usage); return EXIT.usage; }
  try {
    const m = loadReaderMap(mapFile);
    if ('problem' in m) throw new UsageError('reader map ' + mapFile + ': ' + m.problem);
    const expected = parseExpected(expFile, m.map);
    const rows = parseSessions(sessions);
    const unlisted = [...new Set(rows.map(r => r.unit).filter(u => !(u in expected)))];
    if (unlisted.length) throw new UsageError('E_EXPOSURE_EXPECTED expected file ' + expFile + ' lists no readers for unit(s) ' + unlisted.join(', ') + ' (an empty list means the depth rule names none)');
    const result = rows.map(r => exposureRow(r, m.map, expected, gateSkill));
    const tot = totals(result);
    out(argv.includes('--json') ? JSON.stringify({ rows: result, totals: tot }, null, 2) + '\n' : tsv(result, tot));
    for (const r of result) if (r.gap) err(r.gap.code + ' ' + r.gap.file + ': ' + r.gap.detail + ' (unit ' + r.unit + ' pass ' + r.pass + '); expected ' + FORMATS[r.harness] + '\n');
    return result.some(r => r.gap) ? EXIT.gap : EXIT.ok;
  } catch (e) {
    if (e instanceof UsageError) { err((e.message.startsWith('E_') ? '' : 'E_EXPOSURE_USAGE ') + e.message + '\n'); return EXIT.usage; }
    throw e;
  }
}

export const EXPOSURE_SHA256 = createHash('sha256').update(readFileSync(new URL(import.meta.url).pathname)).digest('hex');

if (import.meta.main) process.exit(main(process.argv.slice(2)));
