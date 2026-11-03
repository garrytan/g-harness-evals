#!/usr/bin/env bun
/**
 * Skill-use panel evidence extractor: reads one trial's native transcript (never the
 * wrapper's gstack-register.log, never adapter.log) and reports, in order,
 *
 *   skill_open   the harness's own skill tool opening a gstack skill
 *                OpenClaw: a skills_read of `gstack`, or a read of
 *                  <state>/openclaw/skills/gstack/SKILL.md (the router), then a
 *                  read of .../gstack/skills/gstack-<name>/SKILL.md
 *                Hermes:   skill_view gstack / gstack-<name> (or a read_file of
 *                  a path under hermes/skills/gstack/<name>/)
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
 * run), so a QM cell is `unobservable`. A trial has exactly one user turn
 * (Hermes chat mode: the task, then /exit, which never becomes a message row;
 * OpenClaw: the one prompt), so a user row after a session's first assistant
 * row is an injected turn: the transcript is `tampered`, its events are still
 * listed for the record, and it earns no credit (every count 0, task_success
 * false). The synthetic `received signal <n>` user row a killed Hermes chat
 * session writes is read the same way on purpose: a row prefix is no proof
 * of origin, and a killed trial earned no credit either way.
 *
 * Every tool call is joined to its native result row (OpenClaw: the toolResult
 * event with the same toolCallId, isError and details.exitCode; Hermes: the
 * tool row with the same tool_call_id, whose content is the tool's JSON with
 * exit_code, error or success; a Hermes tool row whose content is not JSON is
 * ok when it is non-empty text, unless it starts with Error or No such, or its
 * first line says not found: a served error message, so result error). A
 * result row is joined by id when it names one; a row that names an id no
 * waiting call carries (a duplicate, a re-emitted or a stray result) settles
 * nothing and is counted in `unmatched_results` and the note, never credited
 * to another call. Only a row with no id at all falls back to the oldest
 * waiting call. An event's `result` is ok, error, unknown (a result row
 * without the field that decides, such as an OpenClaw exec whose details were
 * truncated past 8 KiB and lost exitCode) or none (no result row).
 *
 * The per-trial `metrics` object (the plan's names; `--task <1|2|3>` picks the
 * predicates, without it the task-bound fields are null):
 *   matching_skill_opened  1 when a skill_open of the matching skill (task 1:
 *                          gstack-review; task 2: gstack-investigate or
 *                          gstack-qa) has result ok: the native store shows the
 *                          file content or a success status, not an error. The
 *                          router (gstack/SKILL.md, skills_read gstack,
 *                          skill_view gstack) alone never counts.
 *   matching_skill_started 1 when a helper_run of gstack-skill-start
 *                          --skill <matching> (with or without the gstack-
 *                          prefix; the --skill is read from the helper's own
 *                          argv, never from another command in the string)
 *                          has a result whose exit code is 0 and that exit is
 *                          the helper's own: the helper is the last top-level
 *                          command of the string (alone, or after cd / && / ;
 *                          / |), with nothing after it. A shell's exit is not
 *                          the helper's when something follows it (`|| true`,
 *                          `|| :`, `; echo done`, a then-branch, a pipe into
 *                          tee): that attempt is ambiguous, sets
 *                          started_attempted 1, started_exit "ambiguous" and
 *                          counts 0. An attempt with a non-zero exit, an
 *                          unknown exit or no result sets started_attempted 1
 *                          and counts 0; started_exit carries the exit code
 *                          seen (null when none).
 *   control_false_open     task 3 only: 1 when any skill_open has result ok,
 *                          the router included (opening gstack's index on a
 *                          poem is the false trigger the control measures);
 *                          null on tasks 1 and 2. router_opened says whether
 *                          the router was read successfully on any task.
 *   skills_opened          the distinct skill names opened with result ok, the
 *                          router excluded; other_skills_opened is that list
 *                          minus the matching skill(s).
 *   task_success           read from the final assistant text (the last
 *                          assistant message with text in the main session:
 *                          the session whose first user row carries the task
 *                          sentence, else the earliest session; the note names
 *                          it. Another session is a delegated child whose text
 *                          never decides task_success, though its skill opens
 *                          and helper runs still count as events), only when
 *                          the transcript is complete, else null (false when it
 *                          is tampered). Task 1: the text says do not merge (do
 *                          not / don't / should not / must not / cannot /
 *                          would not / never ... merge(d), not ready / safe /
 *                          fit to merge, block / hold / reject the merge,
 *                          against merging), or carries a weak cue (before
 *                          merging, or it names the off-by-one) with no
 *                          approval beside it (safe / ready / ok / fine / good
 *                          / clear to merge, can be merged, merge it, go ahead
 *                          and merge, approved, LGTM, looks good). A negated
 *                          cue never counts: no / not / without / never (up to
 *                          three words) before off-by-one ("no off-by-one
 *                          here", "does not introduce an off-by-one"),
 *                          nothing / no / not before blocking the merge
 *                          ("nothing is blocking the merge"), and no / nothing
 *                          (up to four words) before should not be merged ("no
 *                          reason it should not be merged"). Task 2: the text
 *                          names the inclusive bound (inclusive, closed
 *                          interval / bound / range / window) or the failing
 *                          test (test_window_includes_its_last_day,
 *                          InclusiveBoundTests, test_window.py with a line
 *                          number); "not inclusive", "exclusive, not
 *                          inclusive", "rather than inclusive" never count.
 *                          Task 3: null (no success notion).
 *                          Known false-positive forms still accepted: a
 *                          do-not-merge for an unrelated reason ("do not merge
 *                          until CI passes"), "before merging" as a chore with
 *                          no approval in the text ("bump the version before
 *                          merging"), the off-by-one named as a question ("is
 *                          there an off-by-one?"), an approval worded outside
 *                          the list ("ship it") beside a weak cue, and
 *                          "inclusive" in an unrelated sense ("inclusive of
 *                          fees"). The preregistered predicate is this text
 *                          and the regexes below; the report lists the same
 *                          forms beside the task success column.
 *   termination_hint       (top level) "length" when a session's last
 *                          assistant turn stopped for length under the
 *                          max_tokens pin (OpenClaw stopReason length, Hermes
 *                          finish_reason length), so the row can carry it; a
 *                          length stop leaves the transcript truncated and the
 *                          trial paid but unobservable.
 *
 * The sqlite stores are hashed as they are, then copied (with any -wal and
 * -shm) to a scratch directory and read there, so reading creates no side
 * files in the trial's state and the hashes name the originals.
 *
 *   bun scripts/gsta-135/evidence.ts <harness> <trial out dir> [--task <1|2|3>]            -> JSON on stdout
 *   bun scripts/gsta-135/evidence.ts <harness> <trial out dir> [--task <1|2|3>] --excerpt  -> the decoded turn, one line per event
 *   bun scripts/gsta-135/evidence.ts <harness> <trial out dir> [--task <1|2|3>] --raw      -> the JSON, each event also carrying
 *                                                                                          raw_args, result_text and error_text
 *
 * For other scorers (scripts/tool-discipline), the module exports the readers (readOpenclaw, readHermes, readQm and the
 * readers map: every decoded tool call joined to its result, before classification), the Call, Result and Event types, score()
 * (a decoded transcript to this evidence object) and scoreEvents() (classified events to the scored fields). Without --raw (or
 * {raw: true}) the output is what it was before those exports: no field added, none changed.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';

export type ResultState = 'ok' | 'error' | 'unknown' | 'none';
/** A classified tool call. raw_args, result_text and error_text are present only when the reader was asked for them ({raw: true},
 *  the CLI's --raw): the call's decoded arguments unclipped, the result row's text and, for a result that is an error, its error
 *  text (null when there is none). The default output carries none of them, so a published evidence object is unchanged. */
export interface Event { kind: 'skill_open' | 'helper_run' | 'gstack_path'; tool: string; detail: string; file: string; locator: string; sha256: string; skill: string | null; result: ResultState; exit: number | null; exit_belongs: boolean | null; raw_args?: unknown; result_text?: string | null; error_text?: string | null }
export interface Metrics {
  task: 1 | 2 | 3 | null;
  matching_skill: string[];
  matching_skill_opened: 0 | 1 | null;
  matching_skill_started: 0 | 1 | null;
  started_attempted: 0 | 1;
  started_exit: number | 'ambiguous' | null;
  control_false_open: 0 | 1 | null;
  router_opened: 0 | 1;
  skills_opened: string[];
  other_skills_opened: string[];
  task_success: boolean | null;
}
export interface Evidence {
  transcript: 'complete' | 'truncated' | 'tampered' | 'missing' | 'unobservable';
  files: Array<{ path: string; sha256: string; bytes: number }>;
  tool_calls: number;
  unmatched_results: number;
  events: Event[];
  skill_open: Event | null;
  sub_skill_open: Event | null;
  helper_run: Event | null;
  gstack_paths: number;
  final_text: string | null;
  termination_hint: 'length' | null;
  metrics: Metrics;
  note?: string;
  excerpt: string[];
}

export const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const SKILL_RE = /(?:openclaw|hermes)\/skills\/gstack\/SKILL\.md$/;
const SUB_SKILL_RE = /gstack\/skills\/(gstack(?:-[\w-]+)?)\/SKILL\.md/;
const HERMES_SKILL_DIR_RE = /hermes\/skills\/gstack\/(gstack(?:-[\w-]+)?)(?:\/|$)/;
const GSTACK_RE = /gstack/i;
const HELPER_WORD = /^(?:\/opt\/gstack\/bin\/[\w.-]+|\$\{?GSTACK_(?:BIN|ROOT|DIR)\}?(?:\/bin)?\/[\w.-]+|gstack-skill-start)$/;
const RUNNER_WORD = /^(?:bun|bash|sh|env|exec|timeout|nice|command|sudo|nohup|time|node)$/;
const OPTION_WORD = /^(?:--?\w[\w=,.:/-]*|\d+[smhd]?|\d*[<>]\S*|&>\S*|run|x)$/;
const ASSIGN_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORD = /^(?:if|then|else|elif|fi|do|done|while|until|!|\{|\}|time)$/;
const MATCHING: Record<number, string[]> = { 1: ['gstack-review'], 2: ['gstack-investigate', 'gstack-qa'], 3: [] };
const TASK1_RE = /\b(?:do not|don'?t|don\u2019t|never|should not|shouldn'?t|shouldn\u2019t|must not|mustn'?t|cannot|can'?t|would not|wouldn'?t|wouldn\u2019t) (?:be )?merged?\b|\bnot (?:ready|safe|fit) (?:to|for) merg|\b(?:block|hold|reject)(?:ing|ed|s)? (?:the |this )?(?:merge|pr|change)\b|\bagainst merging\b|\bbefore (?:you )?merg|\boff[- ]by[- ]one\b/i;
const TASK2_RE = /\binclusive\b|\bclosed (?:interval|bound|range|window)\b|test_window_includes_its_last_day|InclusiveBoundTests|test_window\.py(?::|["'],? line )\s?\d+/i;
const NEG = "(?:\\b(?:no|not|never|nor|nothing|without|neither)\\b|n['\\u2019]t\\b)";
const TASK1_NEGATED_RE = new RegExp(NEG + "(?:\\s+[\\w'\\u2019-]+){0,3}?\\s+off[- ]by[- ]one\\b|" + NEG + "(?:\\s+[\\w'\\u2019-]+){0,3}?\\s+(?:block|hold|reject)(?:ing|ed|s)? (?:the |this )?(?:merge|pr|change)\\b|\\b(?:no|nothing)\\b(?:\\s+[\\w'\\u2019-]+){0,4}?\\s+(?:do not|don['\\u2019]?t|never|should not|shouldn['\\u2019]?t|must not|mustn['\\u2019]?t|cannot|can['\\u2019]?t|would not|wouldn['\\u2019]?t) (?:be )?merged?\\b", 'gi');
const TASK1_STRONG_RE = /\b(?:do not|don'?t|don\u2019t|never|should not|shouldn'?t|shouldn\u2019t|must not|mustn'?t|cannot|can'?t|would not|wouldn'?t|wouldn\u2019t) (?:be )?merged?\b|\bnot (?:ready|safe|fit) (?:to|for) merg|\b(?:block|hold|reject)(?:ing|ed|s)? (?:the |this )?(?:merge|pr|change)\b|\bagainst merging\b/i;
const TASK1_WEAK_RE = /\bbefore (?:you )?merg|\boff[- ]by[- ]one\b/i;
const TASK1_APPROVAL_RE = /(?<!\bnot |n't |n\u2019t |never |un)\b(?:safe|ready|ok|okay|fine|good|clear) (?:to|for) merg|(?<!\bnot |n't |n\u2019t |never )\bcan be merged\b|\bmerge it\b|\bgo ahead and merge\b|(?<!\bnot |n't |n\u2019t |never )\bapproved?\b|\blgtm\b|(?<!\bnot |n't |n\u2019t |never )\blooks good\b/i;
const TASK2_NEGATED_RE = /(?:\b(?:not|never|nor|neither)\b|n['\u2019]t\b|\brather than\b|\binstead of\b)(?:\s+[\w'\u2019-]+){0,2}?\s+inclusive\b/gi;

/** The task's success cue in a final text, or null: the preregistered predicate from the file head. Negated forms are
 *  blanked before the cues are read, and a task 1 weak cue (before merging, off-by-one) needs the text to carry no approval. */
export function taskSuccessMatch(task: 1 | 2 | 3 | null, text: string): string | null {
  if (task === 1) {
    const t = text.replace(TASK1_NEGATED_RE, m => ' '.repeat(m.length));
    const strong = t.match(TASK1_STRONG_RE);
    if (strong) return strong[0];
    const weak = t.match(TASK1_WEAK_RE);
    return weak && !TASK1_APPROVAL_RE.test(t) ? weak[0] : null;
  }
  if (task === 2) return text.replace(TASK2_NEGATED_RE, m => ' '.repeat(m.length)).match(TASK2_RE)?.[0] ?? null;
  return null;
}

/** Shell-like split of one command string into segments of words: quotes group, heredoc bodies are dropped, and
 *  ; & | && || newlines ( ) ` and $( separate segments. Each word keeps its quotes removed. Each segment carries its
 *  nesting depth (0 at top level, 1 inside a command substitution) so a caller can tell the last top-level command. */
function shellParse(command: string): Array<{ words: string[]; depth: number }> {
  const src = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?(?:\n|^)\2(?=\n|$)/g, '$3');
  const out: Array<{ words: string[]; depth: number }> = [];
  let seg: string[] = [], word = '', quoted = false, q: string | null = null;
  // A command substitution ($( ) or backticks, quoted or not) is its own nested command: the outer word and segment
  // are parked while it is read and resume after it, so the rest of the outer command stays an argument list.
  const stack: Array<{ seg: string[]; word: string; quoted: boolean; q: string | null; resume: string }> = [];
  const endWord = () => { if (word || quoted) seg.push(word); word = ''; quoted = false; };
  const endSeg = () => { endWord(); if (seg.length) out.push({ words: seg, depth: stack.length }); seg = []; };
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
  return out.filter(s => s.words.length);
}
export function shellSegments(command: string): string[][] { return shellParse(command).map(s => s.words); }

/** The helper invocation a shell command RUNS, or null: the helper word, the skill its own argv names (--skill <name> or
 *  --skill=<name> after the helper word, never from another command in the string), and whether the tool's exit status is
 *  the helper's own: only when the helper is the last top-level command (alone, or last after cd / && / ; / |, with nothing
 *  after it such as `|| true`, `; echo` or a then-branch). A helper inside `bash -c` or `eval` inherits that test from both
 *  the inner string and the outer segment. */
export type HelperInvocation = { helper: string; skill: string | null; exitBelongs: boolean };
export function helperInvocation(command: string, cwd: string | null = null): HelperInvocation | null {
  const segs = shellParse(command);
  const lastTop = segs.map(s => s.depth).lastIndexOf(0);
  for (let k = 0; k < segs.length; k++) {
    const words = segs[k].words, isLast = k === lastTop;
    let i = 0;
    while (i < words.length && (ASSIGN_WORD.test(words[i]) || KEYWORD.test(words[i]))) i++;
    if (words[i] === 'cd' && words[i + 1]) { cwd = words[i + 1].startsWith('/') ? words[i + 1] : cwd ? posix.join(cwd, words[i + 1]) : null; continue; }
    if (words[i] === 'eval' && words[i + 1]) { const r = helperInvocation(words.slice(i + 1).join(' '), cwd); if (r) return { ...r, exitBelongs: r.exitBelongs && isLast }; continue; }
    let runner: string | null = null;
    while (i < words.length && (ASSIGN_WORD.test(words[i]) || RUNNER_WORD.test(words[i]) || (runner && OPTION_WORD.test(words[i])))) {
      if (RUNNER_WORD.test(words[i])) runner = words[i];
      if ((runner === 'command' && /^-[vV]$/.test(words[i])) || (/^(bash|sh)$/.test(runner ?? '') && /^-\w*n/.test(words[i]))) { runner = 'mention'; break; }
      if (/^(bash|sh)$/.test(runner ?? '') && /^-(?!\w*n)\w*c$/.test(words[i]) && words[i + 1]) { const r = helperInvocation(words[i + 1], cwd); if (r) return { ...r, exitBelongs: r.exitBelongs && isLast }; runner = 'mention'; break; }
      if (runner === 'sudo' && /^(-\w*[ug]|--user|--group)$/.test(words[i])) i++;
      i++;
    }
    if (runner === 'mention' || i >= words.length) continue;
    let w = words[i];
    if (cwd && !w.startsWith('/') && !w.startsWith('$') && w.includes('/')) w = posix.join(cwd, w);
    if (!HELPER_WORD.test(w)) continue;
    let skill: string | null = null;
    if (/gstack-skill-start$/.test(w)) {
      for (let j = i + 1; j < words.length; j++) {
        const m = words[j].match(/^--skill(?:=(.*))?$/);
        if (!m) continue;
        const v = m[1] !== undefined ? m[1] : words[j + 1] ?? '';
        const name = v.match(/^(?:gstack-)?([\w][\w-]*)$/);
        skill = name ? 'gstack-' + name[1] : null;
        break;
      }
    }
    return { helper: words[i], skill, exitBelongs: isLast };
  }
  return null;
}

/** The helper a shell command RUNS, or null. */
export function helperRun(command: string, cwd: string | null = null): string | null { return helperInvocation(command, cwd)?.helper ?? null; }

/** A tool call's native result: ok (null when the row lacks the field that decides), the exit code, the row's text and, when the
 *  row is an error, its error text. */
export type Result = { ok: boolean | null; exit: number | null; text?: string | null; error?: string | null };
/** One decoded tool call, joined to its result row (null when none came). */
export type Call = { id: string | null; tool: string; args: unknown; locator: string; file: string; sha256: string; result: Result | null };

const resultState = (r: Result | null | undefined): ResultState => !r ? 'none' : r.ok === true ? 'ok' : r.ok === false ? 'error' : 'unknown';

/** The skill the gstack-skill-start invocation a command RUNS names, as gstack-<name>, or null. */
export function startedSkill(command: string): string | null { return helperInvocation(command)?.skill ?? null; }

/** Classify one decoded tool call; several kinds may apply. With raw, each event also carries the call's raw arguments and its
 *  result and error text. */
export function classify(call: Call | Omit<Call, 'id' | 'result'>, harness: string, raw = false): Event[] {
  const text = typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? '');
  const a = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;
  const result = 'result' in call ? call.result : null;
  const out: Event[] = [];
  const ev = (kind: Event['kind'], detail: string, skill: string | null = null, exitBelongs: boolean | null = null): Event =>
    ({ kind, tool: call.tool, detail: detail.slice(0, 300), file: call.file, locator: call.locator, sha256: call.sha256, skill, result: resultState(result), exit: result?.exit ?? null, exit_belongs: exitBelongs,
      ...(raw ? { raw_args: call.args, result_text: result?.text ?? null, error_text: result?.error ?? null } : {}) });
  const path = String(a.path ?? a.file_path ?? a.filePath ?? a.target ?? '');
  const name = String(a.name ?? a.skill ?? a.skill_name ?? '').replace(/^gstack\/(?=gstack)/, '');
  const command = String(a.command ?? a.cmd ?? (Array.isArray(a.argv) ? (a.argv as string[]).join(' ') : ''));
  const inv = command ? helperInvocation(command, typeof a.cwd === 'string' ? a.cwd : typeof a.workdir === 'string' ? a.workdir : null) : null;
  const ran = inv?.helper ?? null, ranSkill = inv?.skill ?? null, ranExit = inv ? inv.exitBelongs : null;
  const pathSkill = SKILL_RE.test(path) ? 'gstack' : (path.match(SUB_SKILL_RE)?.[1] ?? null);
  if (harness === 'openclaw') {
    if (call.tool === 'skills_read' && /^gstack(-[\w-]+)?$/.test(name)) out.push(ev('skill_open', 'skills_read ' + name, name));
    if (/^(read|read_file)$/.test(call.tool) && pathSkill) out.push(ev('skill_open', 'read ' + path, pathSkill));
    if (/^(exec|bash|shell|terminal|run)$/.test(call.tool) && ran) out.push(ev('helper_run', ran + ' in: ' + command, ranSkill, ranExit));
  } else if (harness === 'hermes') {
    if (call.tool === 'skill_view' && /^gstack(-[\w-]+)?$/.test(name)) out.push(ev('skill_open', 'skill_view ' + name, name));
    if (/^(read_file|read)$/.test(call.tool) && (pathSkill || HERMES_SKILL_DIR_RE.test(path))) out.push(ev('skill_open', 'read_file ' + path, pathSkill ?? path.match(HERMES_SKILL_DIR_RE)![1]));
    if (/^(terminal|execute_code|bash|shell)$/.test(call.tool) && ran) out.push(ev('helper_run', ran + ' in: ' + command, ranSkill, ranExit));
  }
  if (GSTACK_RE.test(text) && !out.length) out.push(ev('gstack_path', call.tool + ' ' + text));
  return out;
}

/** The plan's per-trial metrics from the classified events and the final text; the predicates are in the file head. */
export function metrics(events: Event[], finalText: string | null, transcript: Evidence['transcript'], task: 1 | 2 | 3 | null): Metrics {
  const matching = task ? MATCHING[task] : [];
  const opened = events.filter(e => e.kind === 'skill_open' && e.result === 'ok');
  const skills = [...new Set(opened.map(e => e.skill).filter((s): s is string => !!s && s !== 'gstack'))];
  const attempts = events.filter(e => e.kind === 'helper_run' && e.skill && matching.includes(e.skill));
  const started = attempts.find(e => e.exit === 0 && e.exit_belongs === true) ?? null;
  const seen = attempts.find(e => e.exit !== null) ?? null;
  const success = transcript !== 'complete' || finalText === null || task !== 1 && task !== 2 ? null : taskSuccessMatch(task, finalText) !== null;
  if (transcript === 'tampered') return { task, matching_skill: matching, matching_skill_opened: task === null ? null : 0, matching_skill_started: task === null ? null : 0, started_attempted: 0, started_exit: null, control_false_open: task === 3 ? 0 : null, router_opened: 0, skills_opened: [], other_skills_opened: [], task_success: task === 1 || task === 2 ? false : null };
  return {
    task,
    matching_skill: matching,
    matching_skill_opened: task === null ? null : skills.some(s => matching.includes(s)) ? 1 : 0,
    matching_skill_started: task === null ? null : started ? 1 : 0,
    started_attempted: attempts.length ? 1 : 0,
    started_exit: started ? 0 : seen === null ? null : seen.exit_belongs ? seen.exit : 'ambiguous',
    control_false_open: task === 3 ? (opened.length ? 1 : 0) : null,
    router_opened: opened.some(e => e.skill === 'gstack') ? 1 : 0,
    skills_opened: skills,
    other_skills_opened: skills.filter(s => !matching.includes(s)),
    task_success: success,
  };
}

/** The scored fields of an evidence object from its classified events: the first router open (else the first sub-skill open),
 *  the first sub-skill open, the first helper run, the gstack_path count and the metrics. Pure, so published events can be
 *  re-scored (tests/gsta-135-golden.test.ts). */
export function scoreEvents(events: Event[], finalText: string | null, transcript: Evidence['transcript'], task: 1 | 2 | 3 | null) {
  const opens = events.filter(e => e.kind === 'skill_open');
  const router = opens.find(e => e.skill === 'gstack') ?? null;
  const sub = opens.find(e => e.skill && e.skill !== 'gstack') ?? null;
  return { skill_open: router ?? sub, sub_skill_open: sub, helper_run: events.find(e => e.kind === 'helper_run') ?? null, gstack_paths: events.filter(e => e.kind === 'gstack_path').length, metrics: metrics(events, finalText, transcript, task) };
}

/** One trial's decoded native transcript before classification: every tool call joined to its result row, the transcript
 *  verdict, the final text, the length hint, the result rows that settled no call, the hashed files, the note and the excerpt.
 *  readOpenclaw, readHermes and readQm (the readers map) produce it; score() turns it into the evidence object. */
export interface Transcript {
  harness: string; transcript: Evidence['transcript']; files: Evidence['files']; calls: Call[]; note: string | undefined; excerpt: string[];
  final_text: string | null; termination_hint: 'length' | null; unmatched_results: number;
}
type Extra = { final_text: string | null; termination_hint: 'length' | null; unmatched_results: number };
const NO_EXTRA: Extra = { final_text: null, termination_hint: null, unmatched_results: 0 };
const transcriptOf = (files: Evidence['files'], calls: Call[], harness: string, transcript: Evidence['transcript'], note: string | undefined, excerpt: string[], extra: Extra = NO_EXTRA): Transcript =>
  ({ harness, transcript, files, calls, note, excerpt, ...extra });

/** The evidence object for a decoded transcript; with raw, every event carries raw_args, result_text and error_text. */
export function score(t: Transcript, task: 1 | 2 | 3 | null = null, opts: { raw?: boolean } = {}): Evidence {
  const events = t.calls.flatMap(c => classify(c, t.harness, opts.raw === true));
  const s = scoreEvents(events, t.final_text, t.transcript, task);
  return { transcript: t.transcript, files: t.files, tool_calls: t.calls.length, unmatched_results: t.unmatched_results, events, skill_open: s.skill_open, sub_skill_open: s.sub_skill_open, helper_run: s.helper_run,
    gstack_paths: s.gstack_paths, final_text: t.final_text, termination_hint: t.termination_hint,
    metrics: s.metrics, ...(t.note ? { note: t.note } : {}), excerpt: t.excerpt };
}

const clip = (s: string, n = 240) => (s.length <= n ? s : s.slice(0, n) + ' ...').replace(/\n/g, ' ');
const nonEmpty = (p: string) => existsSync(p) && statSync(p).size > 0;

/** Per-session state: the last event's label, the calls still waiting for a result (oldest first), the latest stop reason, how
 *  many assistant rows and injected user rows were seen, and the result rows that settled no call. */
type Session = { last: string; open: Call[]; stop: string | null; assistantRows: number; injectedUsers: number; unmatched: number; first: number; firstUser: string | null; finalText: string | null };
const newSession = (first: number): Session => ({ last: 'none', open: [], stop: null, assistantRows: 0, injectedUsers: 0, unmatched: 0, first, firstUser: null, finalText: null });
const TASK_SENTENCES: Record<number, string> = { 1: 'Review the uncommitted change in this repo before I merge it.', 2: 'The test suite fails. Find out why.', 3: 'Write a two-line poem about the sea.' };
/** The main session: the one whose first user row carries the task sentence (the --task's, or any of the three without --task),
 *  else the earliest session; its last assistant text is the final text. Every other session is a child (a delegated task) whose
 *  text never decides task_success. */
function mainSession(sessions: Map<string, Session>, task: 1 | 2 | 3 | null): { id: string; s: Session; how: string } | null {
  const all = [...sessions.entries()].sort((a, b) => a[1].first - b[1].first);
  if (!all.length) return null;
  const sentences = task ? [TASK_SENTENCES[task]] : Object.values(TASK_SENTENCES);
  const hit = all.find(([, s]) => s.firstUser !== null && sentences.some(t => s.firstUser!.includes(t)));
  if (hit) return { id: hit[0], s: hit[1], how: 'its first user row carries the task sentence' };
  return { id: all[0][0], s: all[0][1], how: 'the earliest session; no first user row carries the task sentence' };
}
const finalTextNote = (sessions: Map<string, Session>, task: 1 | 2 | 3 | null) => { const m = mainSession(sessions, task); return m ? '; final text from session ' + m.id + ' (' + m.how + (sessions.size > 1 ? ', ' + (sessions.size - 1) + ' other session(s) treated as children' : '') + ')' : ''; };
const sessionsComplete = (sessions: Map<string, Session>, finalTurn: RegExp) => sessions.size > 0 && [...sessions.values()].every(s => s.open.length === 0 && finalTurn.test(s.last));
const describe = (sessions: Map<string, Session>) => [...sessions.entries()].map(([id, s]) => 'session ' + id + ' last ' + s.last + (s.open.length ? ', ' + s.open.length + ' tool call(s) without a result' : '') + (s.unmatched ? ', ' + s.unmatched + ' result row(s) matching no call' : '') + (s.injectedUsers ? ', ' + s.injectedUsers + ' user row(s) after the first assistant row' : '')).join('; ');
const lengthHint = (sessions: Map<string, Session>): 'length' | null => [...sessions.values()].some(s => s.stop === 'length') ? 'length' : null;
const tampered = (sessions: Map<string, Session>) => [...sessions.values()].some(s => s.injectedUsers > 0);
const unmatched = (sessions: Map<string, Session>) => [...sessions.values()].reduce((n, s) => n + s.unmatched, 0);
/** A user row is the task when the session has no assistant row yet; after one it is an injected turn. */
const userRow = (s: Session, text: string) => { if (s.assistantRows) s.injectedUsers++; else if (s.firstUser === null) s.firstUser = text; s.last = 'user'; };
/** Join a result row to its call: by id when the row names one; a named id no waiting call carries settles nothing and is
 *  counted as unmatched. Only a row with no id falls back to the oldest waiting call. */
function settle(s: Session, id: string | null, result: Result): Call | null {
  const i = id ? s.open.findIndex(c => c.id === id) : s.open.length ? 0 : -1;
  if (i < 0) { s.unmatched++; return null; }
  const [call] = s.open.splice(i, 1);
  call.result = result;
  return call;
}

/** Hash the store and its side files where they are, read a scratch copy read-only, always clean the scratch up. */
function withCopy<T>(db: string, files: Evidence['files'], read: (conn: Database) => T): T {
  const mine = [db, db + '-wal', db + '-shm'].filter(nonEmpty).map(p => ({ path: p, sha256: sha256(p), bytes: statSync(p).size }));
  files.push(...mine);
  const scratch = mkdtempSync(join(tmpdir(), 'gsta135-ev-'));
  for (const f of mine) copyFileSync(f.path, join(scratch, basename(f.path)));
  const conn = new Database(join(scratch, basename(db)), { readonly: true });
  try { return read(conn); } finally { conn.close(); rmSync(scratch, { recursive: true, force: true }); }
}

const blocksText = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('\n') : '';

/** OpenClaw 2026.10: the exec session store is agents/<agent>/agent/openclaw-agent.sqlite under the --state-dir; transcript_events
 *  (primary key session_id, seq) holds the pi-agent session events (event_json, or event_zstd for large ones); an assistant message's
 *  content carries toolCall blocks and its stopReason says why the turn ended (stop, toolUse, length, error); a toolResult message
 *  names its toolCallId, isError and, for exec, details.exitCode (details are dropped past 8 KiB, so exitCode can be missing). */
export function readOpenclaw(out: string, task: 1 | 2 | 3 | null = null): Transcript {
  const root = join(out, 'state', 'openclaw', 'exec', 'agents');
  const found = existsSync(root) ? readdirSync(root).map(a => join(root, a, 'agent', 'openclaw-agent.sqlite')).filter(existsSync) : [];
  const dbs = found.filter(nonEmpty);
  if (!dbs.length) return transcriptOf([], [], 'openclaw', 'missing', found.length ? 'empty openclaw-agent.sqlite' : 'no openclaw-agent.sqlite under state/openclaw/exec/agents', []);
  const files: Evidence['files'] = [];
  const calls: Call[] = [];
  const excerpt: string[] = [];
  const sessions = new Map<string, Session>();
  let rows = 0, undecoded = 0;
  for (const d of dbs) {
    excerpt.push('source: ' + d);
    withCopy(d, files, conn => {
      const sha = files.find(f => f.path === d)!.sha256;
      for (const r of conn.query('select session_id, seq, created_at, event_json, event_zstd from transcript_events order by session_id, seq').all() as Array<{ session_id: string; seq: number; created_at: number | null; event_json: string | null; event_zstd: Uint8Array | null }>) {
        rows++;
        const at = 'session ' + r.session_id.slice(0, 8) + ' seq ' + r.seq;
        let ev: any;
        try { ev = JSON.parse(r.event_json ?? new TextDecoder().decode(Bun.zstdDecompressSync(r.event_zstd!))); } catch { undecoded++; excerpt.push(at + ' undecodable'); continue; }
        const m = ev.message;
        if (ev.type !== 'message' || !m || typeof m !== 'object') continue;
        const s = sessions.get(r.session_id) ?? newSession(Number(r.created_at) || 0);
        sessions.set(r.session_id, s);
        if (m.role === 'user') { userRow(s, blocksText(m.content)); excerpt.push(at + ' user' + (s.injectedUsers ? ' (after an assistant row)' : '') + ': ' + clip(typeof m.content === 'string' ? m.content : JSON.stringify(m.content), 160)); continue; }
        if (m.role === 'toolResult') {
          const exit = typeof m.details?.exitCode === 'number' ? m.details.exitCode : null;
          const isError = m.isError === true;
          const shell = /^(exec|bash|shell|terminal|run)$/.test(String(m.toolName ?? ''));
          const text = typeof m.content === 'string' ? m.content : blocksText(m.content);
          const call = settle(s, typeof m.toolCallId === 'string' ? m.toolCallId : null, { ok: isError ? false : shell ? (exit === null ? null : exit === 0) : true, exit, text, error: isError ? text : null });
          excerpt.push(at + ' toolResult ' + String(m.toolName ?? '') + (isError ? ' (error)' : exit !== null ? ' (exit ' + exit + ')' : '') + (call ? '' : ' (matches no waiting call)') + ': ' + clip(JSON.stringify(m.content ?? ''), 120));
          s.last = 'toolResult';
          continue;
        }
        if (m.role !== 'assistant') continue;
        s.assistantRows++;
        s.last = 'assistant' + (m.stopReason ? ':' + m.stopReason : '');
        s.stop = m.stopReason ? String(m.stopReason) : null;
        const text = blocksText(m.content);
        if (text.trim()) s.finalText = text;
        for (const block of Array.isArray(m.content) ? m.content : []) {
          if (block?.type === 'text') excerpt.push(at + ' text: ' + clip(String(block.text ?? ''), 300));
          if (block?.type !== 'toolCall' && block?.type !== 'tool_use') continue;
          const call: Call = { id: typeof block.id === 'string' ? block.id : null, tool: String(block.name ?? ''), args: block.arguments ?? block.input ?? {}, locator: 'transcript_events ' + at, file: d, sha256: sha, result: null };
          s.open.push(call);
          calls.push(call);
          excerpt.push(at + ' toolCall ' + String(block.name ?? '') + ' ' + clip(JSON.stringify(block.arguments ?? block.input ?? {})));
        }
      }
    });
  }
  const complete = rows > 0 && undecoded === 0 && sessionsComplete(sessions, /^assistant(:(stop|end_turn))?$/);
  return transcriptOf(files, calls, 'openclaw', rows === 0 ? 'missing' : tampered(sessions) ? 'tampered' : complete ? 'complete' : 'truncated',
    rows + ' events' + (undecoded ? ', ' + undecoded + ' undecodable' : '') + '; ' + describe(sessions) + finalTextNote(sessions, task), excerpt, { final_text: mainSession(sessions, task)?.s.finalText ?? null, termination_hint: lengthHint(sessions), unmatched_results: unmatched(sessions) });
}
export function openclaw(out: string, task: 1 | 2 | 3 | null = null, opts: { raw?: boolean } = {}): Evidence { return score(readOpenclaw(out, task), task, opts); }

const HERMES_PLAIN_ERROR_RE = /^\s*(?:error|no such)\b|^[^\n]{0,80}\bnot found\b/i;

/** Hermes: HERMES_HOME/state.db, table messages (role, content, tool_calls JSON, tool_name, tool_call_id, finish_reason); a tool
 *  row's content is the tool's JSON: terminal {output, exit_code, error}, read_file {content, ...} or {error}, skill_view
 *  {success, name, content} or {success: false, error}; plain text content is a served file unless it reads as an error
 *  message (HERMES_PLAIN_ERROR_RE). */
export function readHermes(out: string, task: 1 | 2 | 3 | null = null): Transcript {
  const db0 = join(out, 'state', 'hermes', 'state.db');
  if (!existsSync(db0)) return transcriptOf([], [], 'hermes', 'missing', 'no state/hermes/state.db', []);
  if (!nonEmpty(db0)) return transcriptOf([], [], 'hermes', 'missing', 'empty state/hermes/state.db', []);
  const files: Evidence['files'] = [];
  const rows = withCopy(db0, files, conn => conn.query('select id, session_id, role, content, tool_call_id, tool_calls, tool_name, finish_reason from messages order by session_id, id').all() as Array<{ id: number; session_id: string; role: string; content: string | null; tool_call_id: string | null; tool_calls: string | null; tool_name: string | null; finish_reason: string | null }>);
  const calls: Call[] = [];
  const excerpt = ['source: ' + db0];
  const sessions = new Map<string, Session>();
  let undecoded = 0;
  for (const r of rows) {
    const s = sessions.get(r.session_id) ?? newSession(r.id);
    sessions.set(r.session_id, s);
    if (r.role === 'user') { userRow(s, r.content ?? ''); excerpt.push('id ' + r.id + ' user' + (s.injectedUsers ? ' (after an assistant row)' : '') + ': ' + clip(r.content ?? '', 160)); continue; }
    if (r.role === 'tool') {
      const text = r.content ?? '';
      let body: any = null;
      try { body = JSON.parse(text); } catch { body = null; }
      const exit = body && typeof body === 'object' && typeof body.exit_code === 'number' ? body.exit_code : null;
      const failed = body === null ? HERMES_PLAIN_ERROR_RE.test(text) : typeof body === 'object' && (!!body.error || body.success === false);
      const ok = failed ? false : exit !== null ? exit === 0 : text.trim() ? true : null;
      const error = !failed ? null : body && typeof body === 'object' && body.error ? (typeof body.error === 'string' ? body.error : JSON.stringify(body.error)) : text;
      const call = settle(s, r.tool_call_id, { ok, exit, text, error });
      excerpt.push('id ' + r.id + ' tool result (' + (r.tool_name ?? '') + ')' + (failed ? ' (error)' : exit !== null ? ' (exit ' + exit + ')' : '') + (call ? '' : ' (matches no waiting call)') + ': ' + clip(text, 120));
      s.last = 'tool';
      continue;
    }
    if (r.role !== 'assistant') continue;
    s.assistantRows++;
    s.last = 'assistant/' + (r.finish_reason ?? 'none');
    s.stop = r.finish_reason ?? null;
    if ((r.content ?? '').trim()) s.finalText = r.content!;
    if (!r.tool_calls) { excerpt.push('id ' + r.id + ' text: ' + clip(r.content ?? '', 300)); continue; }
    let tcs: any[];
    try { tcs = JSON.parse(r.tool_calls); if (!Array.isArray(tcs)) throw new Error('not an array'); } catch { undecoded++; s.last = 'undecodable'; excerpt.push('id ' + r.id + ' undecodable tool_calls'); continue; }
    for (const tc of tcs) {
      const fn = tc.function ?? tc;
      let args = fn.arguments ?? tc.input ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep the string */ } }
      const call: Call = { id: typeof tc.id === 'string' ? tc.id : typeof tc.call_id === 'string' ? tc.call_id : null, tool: String(fn.name ?? tc.name ?? ''), args, locator: 'messages id ' + r.id + ' session ' + r.session_id, file: db0, sha256: files[0].sha256, result: null };
      s.open.push(call);
      calls.push(call);
      excerpt.push('id ' + r.id + ' tool_call ' + String(fn.name ?? tc.name ?? '') + ' ' + clip(typeof args === 'string' ? args : JSON.stringify(args)));
    }
  }
  const complete = rows.length > 0 && undecoded === 0 && sessionsComplete(sessions, /^assistant\/stop$/);
  return transcriptOf(files, calls, 'hermes', !rows.length ? 'missing' : tampered(sessions) ? 'tampered' : complete ? 'complete' : 'truncated',
    rows.length + ' messages' + (undecoded ? ', ' + undecoded + ' undecodable' : '') + '; ' + describe(sessions) + finalTextNote(sessions, task), excerpt, { final_text: mainSession(sessions, task)?.s.finalText ?? null, termination_hint: lengthHint(sessions), unmatched_results: unmatched(sessions) });
}
export function hermes(out: string, task: 1 | 2 | 3 | null = null, opts: { raw?: boolean } = {}): Evidence { return score(readHermes(out, task), task, opts); }

/** QM: no decoder at this pin. The QM cells did not run (the preflight's register failure), so no turn record exists to fix a
 *  decoder against; a QM cell is unobservable until one does. */
export function readQm(out: string, _task: 1 | 2 | 3 | null = null): Transcript {
  const files = [join(out, 'logs', 'qm-turn.json'), join(out, 'logs', 'core.log')].filter(nonEmpty).map(p => ({ path: p, sha256: sha256(p), bytes: statSync(p).size }));
  return transcriptOf(files, [], 'qm', files.length ? 'unobservable' : 'missing', 'no QM transcript decoder at this pin', []);
}
export function qm(out: string, task: 1 | 2 | 3 | null = null, opts: { raw?: boolean } = {}): Evidence { return score(readQm(out, task), task, opts); }

/** The transcript readers by harness: every decoded tool call with its result, before classification (scripts/tool-discipline). */
export const readers: Record<'openclaw' | 'hermes' | 'qm', (out: string, task?: 1 | 2 | 3 | null) => Transcript> = { openclaw: readOpenclaw, hermes: readHermes, qm: readQm };

export function extract(harness: string, out: string, task: 1 | 2 | 3 | null = null, opts: { raw?: boolean } = {}): Evidence {
  if (harness === 'openclaw') return openclaw(out, task, opts);
  if (harness === 'hermes') return hermes(out, task, opts);
  if (harness === 'qm') return qm(out, task, opts);
  throw new Error('unknown harness ' + harness);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const taskAt = argv.indexOf('--task');
  const taskArg = taskAt >= 0 ? argv.splice(taskAt, 2)[1] : null;
  const excerptAt = argv.indexOf('--excerpt');
  if (excerptAt >= 0) argv.splice(excerptAt, 1);
  const rawAt = argv.indexOf('--raw');
  if (rawAt >= 0) argv.splice(rawAt, 1);
  const [harness, out] = argv;
  const task = taskArg === null ? null : Number(taskArg);
  if (!harness || !out || argv.length > 2 || (task !== null && ![1, 2, 3].includes(task))) { console.error('usage: evidence.ts <openclaw|hermes|qm> <trial out dir> [--task <1|2|3>] [--excerpt] [--raw]'); process.exit(64); }
  const ev = extract(harness, out, task as 1 | 2 | 3 | null, { raw: rawAt >= 0 });
  if (excerptAt >= 0) console.log(ev.excerpt.join('\n'));
  else { const { excerpt, ...rest } = ev; console.log(JSON.stringify(rest, null, 2)); }
}
