#!/usr/bin/env bun
/**
 * Clean-arm audit (CREW.md "Clean no-gstack and no-brain arms"): per arm, how many trials read a gstack SKILL.md or skill file,
 * counted in three places, and whether the none arm is contaminated.
 *
 *   bun scripts/tool-discipline/clean-arm-audit.ts <run dir> [--harness hermes] [--json]
 *
 * <run dir> is discovery.sh's results/gsta-135/runs/<run id>, with cells.jsonl and trials/<trial>/state/. Per dispatched trial of
 * the harness (Hermes by default; a not_run:* row is skipped):
 *
 * - tool calls: the evidence.ts events on the trial's cells.jsonl row. A skill_open event (the harness's skill tool opening a
 *   gstack skill, or a read of a gstack SKILL.md) is a read, and so is a gstack_path event whose detail names a skill file.
 * - transcripts: every assistant tool call in the trial's state.db messages (trials/<trial>/state/hermes/state.db).
 *   A call is a read when its tool is skill_view or skills_read with a gstack skill name, or its arguments name a gstack skill
 *   file (SKILL_FILE_RE: a SKILL.md under a gstack path, a skills/gstack directory, /opt/gstack, or the Capy drive's gstack skill).
 * - requests: the system prompts the harness sent, from state.db system_prompts and sessions.system_prompt. A gstack skill
 *   listed there (a gstack-<name> skill, the bare gstack router, or a gstack SKILL.md path) is exposure, not a read, and is
 *   counted on its own.
 *
 * A call counts whether or not it succeeded: in the none arm an attempt to reach gstack is exposure too. The state.db is read
 * from a copy (with its -wal and -shm), as evidence.ts reads it. A trial is unaudited when its state.db is missing, empty,
 * unreadable or has no messages, or when any tool_calls row does not decode (its raw text is still searched).
 *
 * Any mention of a Capy drive path (.capy/drive) in any of the three places is counted too. The none arm is contaminated when
 * any of its trials has a read, a listed gstack skill, or a Capy drive path; the gstack arms' reads are expected and printed.
 * A dispatched trial with no state.db is unaudited for the transcript and request sources, and a none arm with an unaudited
 * trial and no contamination reads unaudited, never clean.
 *
 * Tirith: per trial, the lines "tirith installed to" in trials/<trial>/state/hermes/logs/agent.log and its rotated agent.log.N, the line Hermes writes when
 * it downloads a scanner instead of using the pinned TIRITH_BIN (#214's tirith-download.json counted the same line). Any
 * download, in any arm, is reported as an unpinned trial; a trial with no agent.log reads unknown.
 *
 * Exit 1 when the none arm is contaminated, unaudited or absent (no dispatched none trial), or any trial downloaded Tirith or
 * has no agent.log; 2 on unreadable cells.jsonl; else 0.
 */
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SKILL_FILE_RE = /gstack[\w./-]*\/SKILL\.md|skills\/gstack(?:-[\w-]+)?(?:\/|\b)|\/opt\/gstack\/|user-garry-tan\/skills\/gstack/i;
export const GSTACK_SKILL_NAME_RE = /^(?:gstack\/)?gstack(?:-[\w-]+)?$/;
export const LISTED_RE = /\bgstack(?:-[a-z]+)*\b|gstack\/SKILL\.md/;
export const DRIVE_RE = /\.capy\/drive/;
export const TIRITH_DOWNLOAD_RE = /tirith installed to/;

export interface TrialAudit { trial_id: string; arm: string; tool_call_reads: number; transcript_reads: number; prompt_lists_gstack: boolean | null; drive_paths: number; state_db: boolean; undecoded: number; tirith_downloads: number | null }
/** none_arm: clean, contaminated or unaudited for the none arm; null for the gstack arms. */
export interface ArmAudit { arm: string; dispatched: number; trials_with_read: number; tool_call_reads: number; transcript_reads: number; trials_prompt_lists_gstack: number; trials_with_drive_path: number; unaudited: number; trials_with_tirith_download: number; tirith_unknown: number; none_arm: 'clean' | 'contaminated' | 'unaudited' | 'absent' | null }

type DbAudit = { reads: number; listed: boolean; drive: number; undecoded: number; messages: number };

/** Reads in one state.db, from a copy: tool calls that open a gstack skill, whether a system prompt lists one, Capy drive
 *  mentions, undecodable tool_calls rows, and the message count. Null when the file is empty, unreadable or has no messages table. */
export function auditStateDb(path: string): DbAudit | null {
  if (statSync(path).size === 0) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'clean-arm-db-'));
  try {
    const copy = join(tmp, 'state.db');
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix);
    const db = new Database(copy);
    try { return readStateDb(db); } finally { db.close(); }
  } catch { return null; } finally { rmSync(tmp, { recursive: true, force: true }); }
}

function readStateDb(db: Database): DbAudit {
  let reads = 0, drive = 0, listed = false, undecoded = 0;
  const rows = db.query("select content, tool_calls from messages").all() as { content: string | null; tool_calls: string | null }[];
  for (const m of rows) {
    if (DRIVE_RE.test(m.content ?? '') || DRIVE_RE.test(m.tool_calls ?? '')) drive++;
    if (!m.tool_calls) continue;
    let calls: any[] = [];
    try { calls = JSON.parse(m.tool_calls); } catch { undecoded++; if (SKILL_FILE_RE.test(m.tool_calls)) reads++; continue; }
    for (const c of Array.isArray(calls) ? calls : []) {
      const tool = String(c?.function?.name ?? c?.name ?? '');
      const raw = c?.function?.arguments ?? c?.arguments ?? c?.args ?? '';
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      let args: any = {};
      try { args = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}; } catch { args = {}; undecoded++; }
      const name = String(args?.name ?? args?.skill ?? args?.skill_name ?? '');
      const skillTool = tool === 'skill_view' || tool === 'skills_read';
      if ((skillTool && (GSTACK_SKILL_NAME_RE.test(name) || /\bgstack\b/.test(text))) || SKILL_FILE_RE.test(text)) reads++;
    }
  }
  const tables = new Set((db.query("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map(t => t.name));
  const prompts: string[] = [];
  if (tables.has('system_prompts')) for (const p of db.query('select prompt from system_prompts').all() as { prompt: string | null }[]) prompts.push(p.prompt ?? '');
  if (tables.has('sessions')) for (const s of db.query('select system_prompt from sessions').all() as { system_prompt: string | null }[]) prompts.push(s.system_prompt ?? '');
  for (const p of prompts) { if (LISTED_RE.test(p)) listed = true; if (DRIVE_RE.test(p)) drive++; }
  return { reads, listed, drive, undecoded, messages: rows.length };
}

/** One trial's audit from its cells.jsonl row and its state.db (if any). */
export function auditTrial(row: any, runDir: string, harness: string): TrialAudit {
  const events: any[] = row.evidence?.events ?? [];
  const toolCallReads = events.filter(e => e.kind === 'skill_open' || (e.kind === 'gstack_path' && SKILL_FILE_RE.test(String(e.detail ?? '')))).length;
  const eventDrive = events.filter(e => DRIVE_RE.test(String(e.detail ?? ''))).length;
  const state = join(runDir, 'trials', row.trial_id, 'state', harness), db = join(state, 'state.db'), agentLog = join(state, 'logs', 'agent.log');
  const logs = existsSync(agentLog) ? readdirSync(join(state, 'logs')).filter(n => /^agent\.log(\.\d+)?$/.test(n)) : [];
  const tirith = logs.length ? logs.reduce((n, l) => n + readFileSync(join(state, 'logs', l), 'utf8').split('\n').filter(x => TIRITH_DOWNLOAD_RE.test(x)).length, 0) : null;
  const s = existsSync(db) ? auditStateDb(db) : null;
  if (!s || s.messages === 0) return { trial_id: row.trial_id, arm: row.arm, tool_call_reads: toolCallReads, transcript_reads: s?.reads ?? 0, prompt_lists_gstack: s ? s.listed : null, drive_paths: eventDrive + (s?.drive ?? 0), state_db: false, undecoded: s?.undecoded ?? 0, tirith_downloads: tirith };
  return { trial_id: row.trial_id, arm: row.arm, tool_call_reads: toolCallReads, transcript_reads: s.reads, prompt_lists_gstack: s.listed, drive_paths: eventDrive + s.drive, state_db: true, undecoded: s.undecoded, tirith_downloads: tirith };
}

export function summarize(trials: TrialAudit[]): ArmAudit[] {
  const arms = [...new Set([...trials.map(t => t.arm), 'none'])].sort();
  return arms.map(arm => {
    const mine = trials.filter(t => t.arm === arm);
    const withRead = mine.filter(t => t.tool_call_reads + t.transcript_reads > 0).length;
    const listed = mine.filter(t => t.prompt_lists_gstack === true).length, drive = mine.filter(t => t.drive_paths > 0).length;
    const unaudited = mine.filter(t => !t.state_db || t.undecoded > 0).length;
    return {
      arm, dispatched: mine.length, trials_with_read: withRead,
      tool_call_reads: mine.reduce((n, t) => n + t.tool_call_reads, 0), transcript_reads: mine.reduce((n, t) => n + t.transcript_reads, 0),
      trials_prompt_lists_gstack: listed, trials_with_drive_path: drive, unaudited,
      trials_with_tirith_download: mine.filter(t => (t.tirith_downloads ?? 0) > 0).length, tirith_unknown: mine.filter(t => t.tirith_downloads === null).length,
      none_arm: arm !== 'none' ? null : withRead + listed + drive > 0 ? 'contaminated' : mine.length === 0 ? 'absent' : unaudited > 0 ? 'unaudited' : 'clean',
    };
  });
}

export function markdown(arms: ArmAudit[], trials: TrialAudit[]): string {
  const out = ['# Clean-arm audit (scripts/tool-discipline/clean-arm-audit.ts)', '',
    '| arm | dispatched | trials with a gstack skill read | reads in tool calls (evidence.ts) | reads in transcripts (state.db) | trials whose system prompt lists a gstack skill | trials naming a Capy drive path | unaudited (state.db missing, empty or undecodable) | trials that downloaded Tirith | no agent.log | none arm |',
    '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const a of arms) out.push('| ' + [a.arm, a.dispatched, a.trials_with_read, a.tool_call_reads, a.transcript_reads, a.trials_prompt_lists_gstack, a.trials_with_drive_path, a.unaudited, a.trials_with_tirith_download, a.tirith_unknown, a.none_arm === null ? 'n/a' : a.none_arm === 'clean' ? 'clean' : '**' + a.none_arm + '**'].join(' | ') + ' |');
  const bad = trials.filter(t => t.arm === 'none' && (t.tool_call_reads + t.transcript_reads > 0 || t.prompt_lists_gstack || t.drive_paths > 0));
  if (bad.length) out.push('', 'None-arm trials with gstack exposure: ' + bad.map(t => t.trial_id).join(', '));
  const unpinned = trials.filter(t => (t.tirith_downloads ?? 0) > 0);
  if (unpinned.length) out.push('', 'Trials that downloaded Tirith (unpinned scanner): ' + unpinned.map(t => t.trial_id).join(', '));
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const runDir = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--harness');
  const hi = args.indexOf('--harness'), harness = hi >= 0 ? args[hi + 1] : 'hermes';
  if (!runDir || !harness) { console.error('usage: clean-arm-audit.ts <run dir> [--harness hermes] [--json]'); process.exit(64); }
  const cells = join(runDir, 'cells.jsonl');
  if (!existsSync(cells)) { console.error('clean-arm-audit: no ' + cells); process.exit(2); }
  let trials: TrialAudit[];
  try {
    const rows = readFileSync(cells, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    trials = rows.filter(r => r.harness === harness && !String(r.termination ?? '').startsWith('not_run')).map(r => auditTrial(r, runDir, harness));
  } catch (e) { console.error('clean-arm-audit: ' + (e as Error).message); process.exit(2); }
  const arms = summarize(trials);
  console.log(args.includes('--json') ? JSON.stringify({ harness, arms, trials }, null, 2) : markdown(arms, trials));
  process.exit(arms.some(a => (a.none_arm !== null && a.none_arm !== 'clean') || a.trials_with_tirith_download > 0 || a.tirith_unknown > 0) ? 1 : 0);
}
