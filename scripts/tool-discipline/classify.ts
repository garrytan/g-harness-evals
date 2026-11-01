#!/usr/bin/env bun
// internal-task tool discipline, step 2: label each normalized call row, then summarize per trial.
//
//   bun scripts/tool-discipline/classify.ts --rows <rows.ndjson> --out <dir>    -> <dir>/labels.ndjson, <dir>/trials.ndjson
//
// A label is true, false or "unknown" (the evidence that decides it was clipped away or never recorded). Several kinds can
// apply to one row. The kinds (docs: the internal-task plan, approved 2026-10-31):
//   phantom_tool      the harness answered that the called tool does not exist ("Tool skills_read not found", "unknown
//                     tool", or Hermes's "Tool '<name>' does not exist", which it sends with no error flag). World event logs cannot show it: a call to a tool the harness does not offer never reaches the
//                     world or gbrain, so events rows are always false.
//   malformed_args    the call was rejected for its arguments: invalid_params and other schema or argument errors. World-MCP
//                     validates arguments with zod before the handler that logs events, so on events only gbrain's are seen.
//   wrong_identifier  well-formed arguments naming a channel, file, user, page or recipient that does not exist (the world's
//                     *_not_found and unknown_recipient codes, which it returns before any scope check; a harness "not found"
//                     error on a read or skill tool). Not set when malformed_args or phantom_tool is.
//   denied            a permission denial: a denied or error outcome whose code is a scope or permission refusal (forbidden,
//                     not_in_channel, permission_denied, scope_denied, fenced) or a harness permission message. The world also
//                     logs not-found refusals with outcome "denied"; those are wrong identifiers, not denials, and are counted
//                     apart as denied_outcome in the trial summary.
//   mangled_helper    a shell call that runs a gstack helper (gstack-skill-start, /opt/gstack/bin/*, $GSTACK_ROOT/bin/*; the
//                     helper detection of scripts/gsta-135/evidence.ts helperInvocation) whose exit status is not the
//                     helper's own (a pipe, || :, ; echo, tee: evidence.ts's "ambiguous" rule, read from the extractor's
//                     exit_belongs when the trial has one), gstack-skill-start with a flag its usage does not list, a value flag
//                     with no value, --help or no --skill, or a helper path the shell could not run (exit 127, "No such file"). A clipped command
//                     the extractor did not resolve is "unknown".
// Per trial:
//   skill_md_read     a gstack SKILL.md was read with a successful result (the extractor's skill_open, or a read / skill tool
//                     on a gstack .../SKILL.md path or gstack skill name); null when the source cannot see reads (events).
//                     A read the harness refused to serve ("Skill instructions cannot be partially served", OpenClaw's
//                     whole-document limit) returned no instructions, so it is not an opportunity.
//   start_attempt     a gstack-skill-start run appears, whatever its result
//   skipped_start     skill_md_read and no start_attempt; null when there was no read (no opportunity)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { helperInvocation, shellSegments } from '../gsta-135/evidence.ts';
import type { CallRow } from './normalize.ts';

export const CALL_KINDS = ['phantom_tool', 'malformed_args', 'wrong_identifier', 'denied', 'mangled_helper'] as const;
export type CallKind = typeof CALL_KINDS[number];
export type Label = boolean | 'unknown';
export interface RowLabels {
  locator: string; sha256: string; source: CallRow['source']; run: string; cell: string; harness: string; model: string; task: string; trial: string;
  termination: string | null; tool: string; call_class: CallRow['call_class']; outcome: CallRow['outcome']; clipped: boolean;
  labels: Record<CallKind, Label>; reasons: Partial<Record<CallKind, string>>;
}
export interface TrialSummary {
  source: CallRow['source']; run: string; cell: string; harness: string; model: string; task: string; rep: string; trial: string; arm: string | null;
  termination: string | null; calls: number; counts: Record<CallKind, { yes: number; unknown: number }>; denied_outcome: number;
  skill_md_read: boolean | null; start_attempt: Label | null; skipped_start: Label | null; skill_read_locator: string | null; start_locator: string | null;
}

const SHELL_TOOLS = /^(exec|bash|shell|terminal|run|execute_code)$/;
const READ_TOOLS = /^(read|read_file|cat|view|open)$/;
const SKILL_TOOLS = /^(skill_view|skills_read|skill|load_skill)$/;
const PHANTOM_RE = /\btool\s+['"\u0060]?[\w.:-]+['"\u0060]?\s+(?:not found|does not exist|is not available|not registered)|\b(?:unknown|unrecognized|unsupported|no such) tool\b/i;
const MALFORMED_CODE = /^(?:invalid_params|invalid_arguments?|invalid_request|schema_error|validation_error)$/;
const MALFORMED_RE = /invalid[_ ]param|invalid[_ ]arg|validation (?:failed|error)|schema (?:validation|error|mismatch)|(?:does not|did not|doesn't) match (?:the )?schema|expected \w+, received|required (?:property|parameter|argument|field)|missing required|unexpected (?:property|parameter|argument|keyword)|unrecognized (?:key|keys|property)|additional propert/i;
const NOT_FOUND_CODE = /_not_found$|^unknown_recipient$/;
const NOT_FOUND_RE = /not found|no such file|\bENOENT\b|does not exist|unknown (?:channel|user|file|skill|page)/i;
const PERMISSION_CODE = /^(?:forbidden|not_in_channel|permission_denied|scope_denied|access_denied|not_permitted|fenced)$/;
const GSTACK_HINT = /gstack-skill|GSTACK_ROOT|GSTACK_BIN|\/opt\/gstack|gstack\/bin/;
const LEAD_WORD = /^(?:[A-Za-z_][A-Za-z0-9_]*=.*|bun|bash|sh|env|exec|timeout|nice|command|sudo|nohup|time|node|if|then|else|do|!|\{|-\S*|\d+[smhd]?)$/;
export const START_FLAGS = new Set(['--skill', '--model', '--parent-pid', '--brain-health']);

const argsOf = (r: CallRow) => (r.args && typeof r.args === 'object' ? r.args : {}) as Record<string, unknown>;
const commandOf = (r: CallRow) => { const a = argsOf(r); return typeof a.command === 'string' ? a.command : typeof a.cmd === 'string' ? a.cmd : typeof r.args === 'string' ? r.args : ''; };

/** The flag problems of a gstack-skill-start invocation in one command, or null when the command runs no such helper. */
export function startFlagProblems(command: string): { problems: string[]; complete: boolean; skill: boolean } | null {
  const segs = shellSegments(command);
  for (let k = 0; k < segs.length; k++) {
    const i = segs[k].findIndex(w => /gstack-skill-start$/.test(w));
    if (i < 0 || !segs[k].slice(0, i).every(w => LEAD_WORD.test(w))) continue;
    const words = segs[k].slice(i + 1).filter(w => !/^\d*[<>]/.test(w) && !/^&>/.test(w));
    const problems: string[] = [];
    let skill = false;
    for (let j = 0; j < words.length; j++) {
      const w = words[j];
      if (!w.startsWith('-')) continue;
      const flag = w.split('=')[0];
      if (flag === '-h' || flag === '--help') problems.push('--help starts nothing');
      else if (!START_FLAGS.has(flag)) problems.push('unknown flag ' + flag);
      const takesValue = !w.includes('=') && flag !== '--brain-health';
      const value = w.includes('=') ? w.slice(w.indexOf('=') + 1) : takesValue ? words[j + 1] : undefined;
      const missing = START_FLAGS.has(flag) && flag !== '--brain-health' && (!value || value.startsWith('-'));
      if (missing) problems.push('no value for ' + flag);
      if (flag === '--skill' && !missing) skill = true;
      if (takesValue && !missing) j++;
    }
    return { problems, complete: k < segs.length - 1 || skill, skill };
  }
  return null;
}

/** What kind of wrong identifier a world call used, for the pattern tables. */
export function identifierShape(tool: string, a: Record<string, unknown>): string {
  if (tool === 'conversations.open') {
    const u = String((Array.isArray(a.users) ? a.users[0] : a.users) ?? '');
    return /^[CD][0-9A-Z]{6,}$/.test(u) ? 'users: a channel or DM id' : /\s/.test(u) ? 'users: a display name' : /^[a-z]+[.-]/.test(u) ? 'users: a handle' : 'users: other';
  }
  if (tool === 'files.read') { const p = String(a.path ?? ''); return p === '/' || p === '' ? 'path: the root' : /\.\w+$/.test(p) ? 'path: a guessed file name' : 'path: a folder or extensionless guess'; }
  if (tool === 'mail.draft') return 'recipient: not a member address';
  if (tool.startsWith('gbrain.')) return 'slug: no such page';
  const c = String(a.channel ?? '');
  if (/\/|\.md$/.test(c)) return 'channel: a file path';
  if (/^(?:@|dm:)?[a-z]+(?:[.-][a-z]+)+$/.test(c) && !/^team-/.test(c)) return 'channel: a person handle' + (/^@/.test(c) ? ' with @' : /^dm:/.test(c) ? ' with dm:' : '') + ', not a DM id';
  if (/^c[0-9a-z]{8,}$/.test(c)) return 'channel: a lowercased channel id';
  return 'channel: no such channel name';
}

/** Labels for one call row. */
export function classifyRow(r: CallRow): { labels: Record<CallKind, Label>; reasons: Partial<Record<CallKind, string>> } {
  const labels: Record<CallKind, Label> = { phantom_tool: false, malformed_args: false, wrong_identifier: false, denied: false, mangled_helper: false };
  const reasons: Partial<Record<CallKind, string>> = {};
  const set = (k: CallKind, v: Label, why: string) => { labels[k] = v; if (v !== false) reasons[k] = why; };
  if (r.source === 'events') {
    const code = r.error ?? '';
    if (r.outcome !== 'ok' && MALFORMED_CODE.test(code)) set('malformed_args', true, code + ': args ' + Object.keys(argsOf(r)).sort().join(','));
    else if (r.outcome !== 'ok' && NOT_FOUND_CODE.test(code)) set('wrong_identifier', true, code + ': ' + identifierShape(r.tool, argsOf(r)));
    if (r.outcome !== 'ok' && PERMISSION_CODE.test(code)) set('denied', true, r.outcome + ' ' + code);
    return { labels, reasons };
  }
  const noResult = r.result_text === null;
  const text = r.result_text ?? '';
  const toolError = (r.outcome === 'error' || r.outcome === 'denied') && r.exit === null;
  if (noResult) for (const k of ['phantom_tool', 'malformed_args', 'wrong_identifier', 'denied'] as const) set(k, 'unknown', 'no result line in the excerpt');
  else {
    const refusedByName = text.startsWith("Tool '" + r.tool + "' does not exist");
    if ((toolError || refusedByName) && PHANTOM_RE.test(text)) set('phantom_tool', true, 'result: ' + text.match(PHANTOM_RE)![0]);
    if (toolError && MALFORMED_RE.test(text)) set('malformed_args', true, 'result: ' + text.match(MALFORMED_RE)![0]);
    if (toolError && labels.phantom_tool === false && labels.malformed_args === false && (READ_TOOLS.test(r.tool) || SKILL_TOOLS.test(r.tool)) && NOT_FOUND_RE.test(text)) set('wrong_identifier', true, 'result: ' + text.match(NOT_FOUND_RE)![0]);
    if (r.outcome === 'denied') set('denied', true, 'result: ' + text.slice(0, 80));
    if (toolError && r.result_clipped && labels.phantom_tool === false && labels.malformed_args === false && labels.wrong_identifier === false)
      for (const k of ['phantom_tool', 'malformed_args', 'wrong_identifier'] as const) set(k, 'unknown', 'error reply clipped before any pattern');
  }
  if (SHELL_TOOLS.test(r.tool)) {
    const command = commandOf(r);
    const a = argsOf(r);
    const inv = command ? helperInvocation(command, typeof a.cwd === 'string' ? a.cwd : typeof a.workdir === 'string' ? a.workdir : null) : null;
    const ex = r.extractor?.find(e => e.kind === 'helper_run') ?? null;
    const why: string[] = [];
    let unresolved = false;
    if (ex?.exit_belongs === false || (inv && !inv.exitBelongs)) why.push('exit status is not the helper\'s own (pipe or wrapper after it)');
    else if (inv && r.clipped && !ex) unresolved = true;
    const flags = command && (/gstack-skill-start$/.test(inv?.helper ?? '') || /gstack-skill-start/.test(ex?.detail ?? '')) ? startFlagProblems(command) : null;
    if (flags) { why.push(...flags.problems); if (!flags.skill && !flags.problems.length) { if (!flags.complete && r.clipped) unresolved = true; else why.push('no --skill'); } }
    if ((inv || ex) && (r.exit === 127 || /command not found|no such file or directory/i.test(text))) why.push('helper path did not run');
    if (!inv && !ex && r.clipped && r.extractor === null && GSTACK_HINT.test(command)) unresolved = true;
    if (why.length) set('mangled_helper', true, why.join('; '));
    else if (unresolved) set('mangled_helper', 'unknown', 'helper command clipped and not resolved by the extractor');
  }
  return { labels, reasons };
}

const REFUSED_READ = /cannot be partially served|exceeds this call's read/i;
const okRead = (r: CallRow) => {
  if (r.outcome !== 'ok' || REFUSED_READ.test(r.result_text ?? '')) return false;
  if (r.extractor?.some(e => e.kind === 'skill_open' && e.result === 'ok')) return true;
  const a = argsOf(r);
  const path = String(a.path ?? a.file_path ?? a.filePath ?? '');
  const name = String(a.name ?? a.skill ?? '');
  return (READ_TOOLS.test(r.tool) && /gstack[^\s"]*\/SKILL\.md$/i.test(path)) || (SKILL_TOOLS.test(r.tool) && /^gstack(?:[-/][\w-]+)?$/.test(name));
};
/** true when the row runs gstack-skill-start, "unknown" when a clipped command may hide one, else false. */
const startAttempt = (r: CallRow): Label => {
  if (!SHELL_TOOLS.test(r.tool)) return false;
  if (r.extractor?.some(e => e.kind === 'helper_run' && /gstack-skill-start$/.test(e.detail.split(' in: ')[0]))) return true;
  const command = commandOf(r);
  if (/gstack-skill-start$/.test(helperInvocation(command)?.helper ?? '')) return true;
  return r.clipped && r.extractor === null && GSTACK_HINT.test(command) ? 'unknown' : false;
};

export function classifyAll(rows: CallRow[]): { labels: RowLabels[]; trials: TrialSummary[] } {
  const labels: RowLabels[] = [];
  const trials = new Map<string, TrialSummary>();
  for (const r of rows) {
    const l = classifyRow(r);
    labels.push({ locator: r.locator, sha256: r.sha256, source: r.source, run: r.run, cell: r.cell, harness: r.harness, model: r.model, task: r.task, trial: r.trial,
      termination: r.termination, tool: r.tool, call_class: r.call_class, outcome: r.outcome, clipped: r.clipped, ...l });
    const t = trials.get(r.trial) ?? {
      source: r.source, run: r.run, cell: r.cell, harness: r.harness, model: r.model, task: r.task, rep: r.rep, trial: r.trial, arm: r.arm, termination: r.termination,
      calls: 0, counts: Object.fromEntries(CALL_KINDS.map(k => [k, { yes: 0, unknown: 0 }])) as TrialSummary['counts'], denied_outcome: 0,
      skill_md_read: r.source === 'events' ? null : false, start_attempt: r.source === 'events' ? null : false, skipped_start: null, skill_read_locator: null, start_locator: null,
    };
    trials.set(r.trial, t);
    if (r.call_class !== 'model') continue;
    t.calls++;
    if (r.outcome === 'denied') t.denied_outcome++;
    for (const k of CALL_KINDS) { if (l.labels[k] === true) t.counts[k].yes++; else if (l.labels[k] === 'unknown') t.counts[k].unknown++; }
    if (r.source === 'events') continue;
    if (!t.skill_md_read && okRead(r)) { t.skill_md_read = true; t.skill_read_locator = r.locator; }
    const s = startAttempt(r);
    if (s === true && t.start_attempt !== true) { t.start_attempt = true; t.start_locator = r.locator; }
    else if (s === 'unknown' && t.start_attempt === false) t.start_attempt = 'unknown';
  }
  for (const t of trials.values()) t.skipped_start = t.skill_md_read ? (t.start_attempt === true ? false : t.start_attempt === 'unknown' ? 'unknown' : true) : null;
  return { labels, trials: [...trials.values()] };
}

export const readNdjson = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const rowsPath = arg('--rows'), out = arg('--out');
  if (!rowsPath || !out) { process.stderr.write('usage: classify.ts --rows <rows.ndjson> --out <dir>\n'); process.exit(2); }
  const { labels, trials } = classifyAll(readNdjson<CallRow>(rowsPath));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'labels.ndjson'), labels.map(l => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(out, 'trials.ndjson'), trials.map(t => JSON.stringify(t)).join('\n') + '\n');
  const tally = CALL_KINDS.map(k => k + '=' + labels.filter(l => l.call_class === 'model' && l.labels[k] === true).length + (labels.some(l => l.labels[k] === 'unknown') ? '(+' + labels.filter(l => l.call_class === 'model' && l.labels[k] === 'unknown').length + ' unknown)' : '')).join(' ');
  const opp = trials.filter(t => t.skill_md_read);
  process.stderr.write('labelled ' + labels.length + ' rows (' + labels.filter(l => l.call_class === 'model').length + ' model calls), ' + trials.length + ' trials\n' + tally +
    '\nskipped_start=' + opp.filter(t => t.skipped_start === true).length + '/' + opp.length + ' opportunities (' + opp.filter(t => t.skipped_start === 'unknown').length + ' unknown)\n');
}
