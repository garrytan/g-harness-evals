#!/usr/bin/env bun
// Post-data rescore of the counted run gbrain-install-2026-11: the pinned finish line with three scorer fixes, and nothing else.
//   a. An OpenClaw tool_call whose arguments.id names a gbrain tool is that MCP gbrain tool, with its unwrapped result as the output.
//   b. A Claude Code SessionStart or UserPromptSubmit hook_response of gbrain's hook in the recall turn, whose output holds the nonce,
//      is a gbrain-served recall when the reply holds the nonce. Strict by default: the hook must be proven gbrain's by its name or by
//      the trial's settings.json; --lenient-b also accepts the recall turn's probe when the archived settings.json is lost.
//   c. memory_index_chunks rows (and its _fts tables' rows) in openclaw-agent.sqlite with source 'sessions' are not harness memory.
// Every column also applies the conservative harness_error rule: a counted trial that ended in harness_error or timeout is a miss.
//
// Rebuild (reads no state):
//   bun --no-install rescore.ts --trials <trials.jsonl> --trial-root <dir with trials/<cell>/gbrain-install/rN/> \
//     --c-scan inputs/c-scan.json --settings-proof inputs/settings-proof.json [--reads <dir or file>]... --out <dir> [--lenient-b]
// Regenerate the two inputs from trial state (a results dir holding trials/, or a trials.tar.zst):
//   bun --no-install rescore.ts --scan-state <dir or archive>... --trials <trials.jsonl> --c-scan <out> --settings-proof <out> --scratch <dir>
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { basename, join, relative, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { hasToken, isGbrainServed, parseTurn, type NEvent } from '../../../../../scripts/gbrain-install/transcript.ts';
import { classifyInstall, type EgressLine, type InstallClassification, type InstallTurn, type Probe } from '../../../../../scripts/gbrain-install/classify.ts';
import { excludedReason, verdict, wilson, type CellVerdict, type InstallTrialRecord } from '../../../../../scripts/gbrain-install/verdict.ts';
import { failureMarkdown, failureTable, type FailureRow } from '../../../../../scripts/gbrain-install/failure-table.ts';

const MIN_FREE_BYTES = 10 * 1024 ** 3;

const str = (v: unknown): string => typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v);
const contentText = (c: unknown): string => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string') ? (x as { text: string }).text : '').join('\n');
  if (c && typeof c === 'object') return JSON.stringify(c);
  return '';
};
const jsonLines = (raw: string): Array<{ line: number; d: Record<string, unknown> }> => raw.split('\n').flatMap((l, i) => {
  const t = l.trim();
  if (!t.startsWith('{')) return [];
  try { return [{ line: i + 1, d: JSON.parse(t) }]; } catch { return []; }
});
const readMaybeGz = (path: string): { path: string; raw: string } | null =>
  existsSync(path) ? { path, raw: readFileSync(path, 'utf8') } : existsSync(path + '.gz') ? { path: path + '.gz', raw: gunzipSync(readFileSync(path + '.gz')).toString('utf8') } : null;
const readNdjson = <T>(path: string): T[] => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as T]; } catch { return []; } }); } catch { return []; } };
const pad = (n: number) => String(n).padStart(4, '0');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sortedKeys = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]!]));

// ---- rule a: OpenClaw's tool_call wrapper ----------------------------------------------------------------------------

/** The MCP name of the gbrain tool a tool_call id names ("mcp:gbrain:gbrain__recall", "gbrain__recall"), or null. */
export function gbrainToolName(id: string): string | null {
  const mcp = id.match(/^mcp:gbrain:(.+)$/);
  if (mcp) return `gbrain__${mcp[1].replace(/^gbrain__/, '')}`;
  const bare = id.match(/(?:^|:)gbrain__(.+)$/);
  return bare ? `gbrain__${bare[1]}` : null;
}

/** The inner result of an OpenClaw tool_call result: the {tool, result} JSON, bare or inside OpenClaw's EXTERNAL_UNTRUSTED_CONTENT
 *  block. null when the text is not that shape (an error object, a cut result). */
export function unwrapToolCallResult(text: string): { id: string | null; output: string; is_error: boolean } | null {
  let body = text;
  const open = text.indexOf('<<<EXTERNAL_UNTRUSTED_CONTENT');
  if (open >= 0) {
    const sep = text.indexOf('\n---\n', open);
    const end = text.lastIndexOf('<<<END_EXTERNAL_UNTRUSTED_CONTENT');
    if (sep < 0 || end < sep) return null;
    body = text.slice(sep + 5, end);
  }
  try {
    const p = JSON.parse(body.trim()) as { tool?: { id?: unknown }; result?: { content?: unknown; isError?: unknown; is_error?: unknown } };
    if (!p || typeof p !== 'object' || !p.result || typeof p.result !== 'object') return null;
    return { id: typeof p.tool?.id === 'string' ? p.tool.id : null, output: contentText(p.result.content ?? p.result), is_error: p.result.isError === true || p.result.is_error === true };
  } catch { return null; }
}

/** The events with every gbrain tool_call turned into the MCP gbrain event it wraps. */
export function applyRuleA(events: NEvent[]): NEvent[] {
  return events.map(e => {
    if (e.kind !== 'other' || e.name !== 'tool_call') return e;
    let args: { id?: unknown; args?: unknown } = {};
    try { const p = JSON.parse(e.input); if (p && typeof p === 'object') args = p; } catch { /* no arguments: an unpaired result */ }
    const inner = unwrapToolCallResult(e.output);
    const id = typeof args.id === 'string' ? args.id : inner?.id ?? null;
    const name = id ? gbrainToolName(id) : null;
    if (!name) return e;
    return { ...e, kind: 'mcp', name, input: str(args.args), output: inner?.output ?? e.output, is_error: e.is_error || !!inner?.is_error };
  });
}

/** Lines of an OpenClaw session export holding a gbrain tool_call result that did not fail (and holds the nonce, when given). */
export function toolCallEvidence(raw: string, nonce: string | null): number[] {
  const out: number[] = [];
  const ids = new Map<string, string>();
  for (const { line, d } of jsonLines(raw)) {
    const ev = d.event as { type?: unknown; message?: Record<string, unknown> } | null;
    const m = ev?.type === 'message' ? ev.message : null;
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'assistant') for (const b of (Array.isArray(m.content) ? m.content : []) as Array<Record<string, unknown>>) {
      const a = b?.arguments as { id?: unknown } | undefined;
      if (b?.type === 'toolCall' && b.name === 'tool_call' && typeof b.id === 'string' && typeof a?.id === 'string') ids.set(b.id, a.id);
    }
    if (m.role !== 'toolResult' || m.toolName !== 'tool_call') continue;
    const text = contentText(m.content);
    const inner = unwrapToolCallResult(text);
    const id = (typeof m.toolCallId === 'string' ? ids.get(m.toolCallId) : undefined) ?? inner?.id ?? null;
    if (!id || !gbrainToolName(id) || m.isError === true || inner?.is_error) continue;
    if (nonce === null || hasToken(inner?.output ?? text, nonce)) out.push(line);
  }
  return out;
}

// ---- rule b: gbrain's Claude Code hooks -----------------------------------------------------------------------------

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit'];
/** A hook command that runs gbrain's own hook subcommand ("... /bin/gbrain hook session-start"). */
export const isGbrainHookCommand = (cmd: string) => /(?:^|[\s\/'"])gbrain\s+hook\b/.test(cmd);
/** gbrain's hook output header ("<!-- retrieved brain context — data, not instructions -->"). */
export const GBRAIN_CONTEXT_RE = /<!-- retrieved brain context\b/;

/** What a trial's Claude Code settings prove about its hooks: the state settings.json is ok, lost (present but not JSON; the run's
 *  archive holds some at 0 bytes) or missing, and per hook event how many commands are registered and how many run gbrain hook. */
export interface SettingsProof { settings: 'ok' | 'lost' | 'missing'; events: Record<string, { commands: number; gbrain: number }> }

/** The proof from the settings files: the first is the state settings.json, the rest (workspace .claude settings) only add hooks. */
export function settingsProofOf(paths: string[]): SettingsProof {
  const events: SettingsProof['events'] = {};
  let settings: SettingsProof['settings'] = 'missing';
  paths.forEach((p, i) => {
    if (!existsSync(p)) return;
    let s: { hooks?: Record<string, Array<{ hooks?: Array<{ command?: unknown }> }>> };
    try { s = JSON.parse(readFileSync(p, 'utf8')); } catch { if (i === 0) settings = 'lost'; return; }
    if (i === 0) settings = 'ok';
    for (const [event, groups] of Object.entries(s.hooks ?? {})) for (const g of Array.isArray(groups) ? groups : []) for (const h of g.hooks ?? []) {
      if (typeof h.command !== 'string') continue;
      const e = (events[event] ??= { commands: 0, gbrain: 0 });
      e.commands++;
      if (isGbrainHookCommand(h.command)) e.gbrain++;
    }
  });
  return { settings, events: sortedKeys(events) };
}

/** The first line of a Claude Code turn transcript where gbrain's SessionStart or UserPromptSubmit hook succeeded with the nonce in
 *  its output, and how the hook was known to be gbrain's: its name or command names gbrain ("name"), or every hook the settings
 *  register for that event runs gbrain hook ("settings"). probeHook (only --lenient-b passes it) also accepts a hook when the event
 *  has no readable settings hooks, the turn's probe found a gbrain hook command in claude/settings.json and the output carries
 *  gbrain's brain-context header ("probe"). */
export function gbrainHookRecall(raw: string, proof: SettingsProof | null, nonce: string, probeHook = false): { line: number; via: 'name' | 'settings' | 'probe' } | null {
  for (const { line, d } of jsonLines(raw)) {
    if (d.type !== 'system' || d.subtype !== 'hook_response' || !HOOK_EVENTS.includes(String(d.hook_event))) continue;
    const ok = (d.outcome === undefined || d.outcome === 'success') && (d.exit_code === undefined || d.exit_code === 0);
    const text = [str(d.output), str(d.stdout)].join('\n');
    if (!ok || !hasToken(text, nonce)) continue;
    const ev = proof?.events[String(d.hook_event)] ?? { commands: 0, gbrain: 0 };
    if (/gbrain/i.test(str(d.hook_name)) || isGbrainHookCommand(str(d.command))) return { line, via: 'name' };
    if (ev.commands > 0 && ev.gbrain === ev.commands) return { line, via: 'settings' };
    if (ev.commands === 0 && probeHook && GBRAIN_CONTEXT_RE.test(text)) return { line, via: 'probe' };
  }
  return null;
}

// ---- rule c: OpenClaw's own session index ---------------------------------------------------------------------------
// The scan is runner/trial/install.ts's outsideBrain and SQLite scan, copied (install.ts itself pulls in a package with no
// node_modules here) and split in two: scanState summarizes what holds the nonce (table, source, row count, never row text), and
// outsideOf turns that summary into outsideBrain's list, with or without rule c. Without rule c it must give the recorded list.

const lowerHas = (data: Buffer, needle: string) => data.toString('latin1').toLowerCase().includes(needle.toLowerCase());
const isSqlite = (data: Buffer) => data.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000';
const SKIP_DIRS = new Set(['.gbrain', '.bun', '.cache', '.npm', '.npm-global', 'node_modules', '.git', 'sessions']);
const TRANSCRIPT_FILE = /\.(jsonl|log)$|^\.claude\.json$|session|history|transcript/i;
const TRANSCRIPT_TABLE = /session|message|transcript|history|log|event|conversation|turn/i;
const CHUNK_TABLE = /^memory_index_chunks(_fts\w*)?$/;
const SOURCED = new Set(['memory_index_chunks', 'memory_index_chunks_fts', 'memory_index_chunks_fts_content']);

/** One file holding the nonce: a plain file (tables null) or a database with the tables whose rows hold it, in sqlite_master order,
 *  each with its matching rows counted by source (null where the table has no source column). */
export interface ScanHit { path: string; tables: Array<{ table: string; matches: Array<{ source: string | null; rows: number }> }> | null }
type Row = Record<string, unknown>;

/** The tables of a database (copied first, with -wal and -shm, into tmp) that are not transcript tables and hold the needle. */
export function scanDb(path: string, needle: string, tmp: string): NonNullable<ScanHit['tables']> {
  mkdirSync(tmp, { recursive: true });
  const dir = mkdtempSync(join(tmp, 'scan-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) cpSync(path + suffix, join(dir, 'db' + suffix));
    const db = new Database(join(dir, 'db'));
    try {
      const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(t => t.name).filter(n => !TRANSCRIPT_TABLE.test(n));
      const n = needle.toLowerCase();
      const holds = (v: unknown) => (typeof v === 'string' && v.toLowerCase().includes(n)) || (v instanceof Uint8Array && lowerHas(Buffer.from(v), needle));
      const ftsCols = names.includes('memory_index_chunks_fts') ? (db.query('PRAGMA table_info("memory_index_chunks_fts")').all() as Array<{ name: string }>).map(x => x.name) : [];
      const contentSource = ftsCols.includes('source') ? `c${ftsCols.indexOf('source')}` : null;
      const out: NonNullable<ScanHit['tables']> = [];
      for (const t of names) {
        const rows = (db.query(`SELECT * FROM "${t.replace(/"/g, '""')}"`).all() as Row[]).filter(row => Object.values(row).some(holds));
        if (!rows.length) continue;
        const col = t === 'memory_index_chunks' || t === 'memory_index_chunks_fts' ? 'source' : t === 'memory_index_chunks_fts_content' ? contentSource : null;
        const by = new Map<string | null, number>();
        for (const r of rows) { const s = col && typeof r[col] === 'string' ? r[col] as string : null; by.set(s, (by.get(s) ?? 0) + 1); }
        out.push({ table: t, matches: [...by].map(([source, rows]) => ({ source, rows })).sort((a, b) => String(a.source).localeCompare(String(b.source))) });
      }
      return out;
    } finally { db.close(); }
  } catch { return [{ table: '(unreadable database)', matches: [] }]; } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Every file under the roots that outsideBrain would search and that holds the nonce, paths relative to base. */
export function scanState(roots: string[], nonce: string, base: string, tmp: string, skip: readonly string[] = []): ScanHit[] {
  const out: ScanHit[] = [];
  const visit = (p: string): void => {
    if (skip.includes(p)) return;
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) for (const n of readdirSync(p).sort()) visit(join(p, n)); return; }
    if (!st.isFile() || TRANSCRIPT_FILE.test(name) || /-(wal|shm|journal)$/.test(name)) return;
    const data = readFileSync(p);
    if (isSqlite(data)) { const tables = scanDb(p, nonce, tmp); if (tables.length) out.push({ path: relative(base, p), tables }); return; }
    if (lowerHas(data, nonce)) out.push({ path: relative(base, p), tables: null });
  };
  for (const r of roots) if (existsSync(r)) visit(r);
  return out;
}

/** outsideBrain's list from a scan summary; with ruleC, in openclaw-agent.sqlite, a memory_index_chunks, _fts or _fts_content hit
 *  whose rows are all source 'sessions' is dropped, and a source-less _fts shadow table (an index) is dropped unless the fts table
 *  has a match of another source. dropped names each table rule c set aside. */
export function outsideOf(hits: ScanHit[], ruleC: boolean): { outside: string[]; dropped: string[] } {
  const outside: string[] = [];
  const dropped: string[] = [];
  for (const h of hits) {
    if (!h.tables) { outside.push(h.path); continue; }
    const c = ruleC && basename(h.path) === 'openclaw-agent.sqlite';
    const fts = h.tables.find(t => t.table === 'memory_index_chunks_fts');
    const ftsReal = !!fts && fts.matches.some(m => m.source !== 'sessions');
    const kept: string[] = [];
    for (const t of h.tables) {
      const real = !c || !CHUNK_TABLE.test(t.table) || (SOURCED.has(t.table) ? t.matches.some(m => m.source !== 'sessions') : ftsReal);
      if (real) { kept.push(t.table); continue; }
      const rows = t.matches.reduce((a, m) => a + m.rows, 0);
      dropped.push(`${h.path}#${t.table} (${rows} row${rows === 1 ? '' : 's'}, ${SOURCED.has(t.table) ? 'all source=sessions' : 'fts index of source=sessions rows only'})`);
    }
    if (kept.length) outside.push(`${h.path} (${kept.join(', ')})`);
  }
  return { outside: outside.sort(), dropped };
}

// ---- scoring --------------------------------------------------------------------------------------------------------

export type Outcome = 'recalled' | 'harness-memory' | 'not-recalled' | 'not-installed';
export interface Finish { reply: boolean; gbrain_call: boolean; hook_recall: boolean; brain: boolean; outside_brain: string[] }

/** install.ts's outcome, in its order: outside the brain first, then the finish line, then the install. */
export function outcomeOf(f: Pick<Finish, 'reply' | 'gbrain_call' | 'brain' | 'outside_brain'>, installed: boolean): Outcome {
  return f.outside_brain.length ? 'harness-memory' : f.reply && f.gbrain_call && f.brain ? 'recalled' : !installed ? 'not-installed' : 'not-recalled';
}

/** The finish of the recall turn, as install.ts's hit() reads it, plus rule b's hook line when it is on. */
export function finishOf(recall: InstallTurn | null, nonce: string, hookLine: number | null, brain: boolean, outside: string[]): Finish {
  const reply = !!recall?.reply_text && hasToken(recall.reply_text, nonce);
  const call = !!recall && recall.events.some(e => isGbrainServed(e) && !e.is_error && hasToken(e.output, nonce));
  const hook = reply && hookLine !== null;
  return { reply, gbrain_call: call || hook, hook_recall: hook && !call, brain, outside_brain: outside };
}

/** The conservative harness_error rule: a trial that ended in harness_error or timeout is a miss in every column. */
export const CONSERVATIVE_TERMINATIONS = ['harness_error', 'timeout'];
export const conservativeOutcome = (outcome: Outcome, termination: string): Outcome => outcome === 'recalled' && CONSERVATIVE_TERMINATIONS.includes(termination) ? 'not-recalled' : outcome;

// ---- scan-state mode ------------------------------------------------------------------------------------------------

type Rec = InstallTrialRecord & { install: InstallTrialRecord['install'] & { nonce: string; finish: { reply: boolean; gbrain_call: boolean; brain: boolean; outside_brain: string[] } } };
const readRecords = (path: string) => readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as Rec);
const tailOf = (trialId: string) => trialId.split('/').slice(1).join('/');
const freeBytes = (p: string) => { const s = statfsSync(p); return Number(s.bavail) * Number(s.bsize); };
export const C_SCAN_ABOUT = 'Rule c input: per OpenClaw trial, every file under state/openclaw that outsideBrain searches and that holds the nonce; for a database, each table holding it with its matching rows counted by source. No row text.';
export const PROOF_ABOUT = "Rule b input: per Claude Code trial, whether state/claude/settings.json parses (ok, lost, missing) and per hook event how many hook commands the settings register and how many run gbrain hook.";

function scanStateMode(sources: string[], records: Rec[], cScanOut: string, proofOut: string, scratch: string): void {
  mkdirSync(scratch, { recursive: true });
  const tmp = resolve(scratch);
  const cScan: Record<string, ScanHit[]> = {};
  const proofs: Record<string, SettingsProof> = {};
  const scanTrials = (root: string, rs: Rec[]) => {
    for (const r of rs) {
      const dir = join(root, tailOf(r.trial_id));
      const state = join(dir, 'state');
      if (!existsSync(state)) continue;
      if (r.harness === 'openclaw') cScan[r.trial_id] = scanState([join(state, 'openclaw')], r.install.nonce, dir, tmp);
      if (r.harness === 'claude-code') proofs[r.trial_id] = settingsProofOf([join(state, 'claude', 'settings.json'), join(dir, 'workspace', '.claude', 'settings.json'), join(dir, 'workspace', '.claude', 'settings.local.json')]);
    }
  };
  const wanted = records.filter(r => r.harness === 'openclaw' || r.harness === 'claude-code');
  for (const src of sources) {
    if (statSync(src).isDirectory()) { scanTrials(existsSync(join(src, 'trials')) ? join(src, 'trials') : src, wanted); continue; }
    for (const cell of [...new Set(wanted.map(r => r.cell))].sort()) {
      if (freeBytes(tmp) < MIN_FREE_BYTES) throw new Error(`less than 10 GB free under ${tmp}; not extracting ${cell}`);
      const x = mkdtempSync(join(tmp, `x-${cell}-`));
      try {
        const base = `trials/${cell}/gbrain-install/r*`;
        const tar = Bun.spawnSync(['tar', '-I', 'zstd', '-xf', src, '-C', x, '--wildcards', `${base}/state/openclaw/*`, `${base}/state/claude/settings.json`, `${base}/workspace/.claude/settings.json`, `${base}/workspace/.claude/settings.local.json`], { stdout: 'ignore', stderr: 'pipe' });
        const errs = tar.stderr.toString().split('\n').filter(l => l.trim() && !/Not found in archive|Exiting with failure status due to previous errors/.test(l));
        if (tar.exitCode !== 0 && (tar.exitCode !== 2 || errs.length)) throw new Error(`tar failed on ${src} for ${cell}: ${errs.at(-1) ?? 'exit ' + tar.exitCode}`);
        if (existsSync(join(x, 'trials', cell))) { scanTrials(join(x, 'trials'), wanted.filter(r => r.cell === cell)); console.log(`scanned ${cell} from ${basename(src)}`); }
      } finally { rmSync(x, { recursive: true, force: true }); }
    }
  }
  writeFileSync(cScanOut, JSON.stringify({ about: C_SCAN_ABOUT, trials: sortedKeys(cScan) }, null, 1) + '\n');
  writeFileSync(proofOut, JSON.stringify({ about: PROOF_ABOUT, trials: sortedKeys(proofs) }, null, 1) + '\n');
  console.log(`wrote ${Object.keys(cScan).length} rule-c scans and ${Object.keys(proofs).length} settings proofs`);
}

// ---- rebuild mode ---------------------------------------------------------------------------------------------------

type Col = 'scored' | 'ac' | 'abc';
const COLS: Col[] = ['scored', 'ac', 'abc'];
const COL_NAME: Record<Col, string> = { scored: 'As scored', ac: 'a+c', abc: 'a+b+c' };
interface Scored { outcome: Outcome; finish: Finish; classification: InstallClassification; counted: boolean; excluded: string | null }
type Reader = { as_read: string; cause: string; file: string };
interface RowOut {
  trial_id: string; cell: string; arm: string; harness: string; model: string; termination: string; counted: boolean; excluded: string | null;
  scored: Outcome; ac: Outcome; abc: Outcome; abc_other_b: Outcome; b_reading: 'strict' | 'lenient';
  changed_by: string[]; changed_by_ac: string[]; changed_by_b: boolean; b_via: string | null; b_unproven_hook: number | null;
  finish_line: Record<Col, boolean>; conservative_miss: Col[]; saved_step: { scored: boolean; ac: boolean };
  finish: { scored: Rec['install']['finish']; ac: Finish; abc: Finish }; unserved: string | null; evidence: string[]; reader: { as_read: string; file: string } | null;
}

const pct = (x: number | null | undefined) => x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`;
const fmt = (k: number, n: number) => { const w = wilson(k, n); return `${k}/${n} (${pct(w?.lo)} to ${pct(w?.hi)})`; };
const wil = (k: number, n: number) => { const w = wilson(k, n); return { k, n, lo: w ? Math.round(w.lo * 10000) / 10000 : null, hi: w ? Math.round(w.hi * 10000) / 10000 : null }; };
const md = (s: string) => s.replace(/\|/g, '\\|');
const short = (id: string) => id.split('/').slice(1).filter(x => x !== 'gbrain-install').join('/');

export function rebuild(o: { trials: string; trialRoot: string; cScan: string; proof: string; reads: string[]; out: string; lenientB: boolean }): { problems: string[] } {
  const records = readRecords(o.trials);
  const cScan = (JSON.parse(readFileSync(o.cScan, 'utf8')) as { trials: Record<string, ScanHit[]> }).trials;
  const proofs = (JSON.parse(readFileSync(o.proof, 'utf8')) as { trials: Record<string, SettingsProof> }).trials;
  const readers = new Map<string, Reader>();
  const readFiles = o.reads.flatMap(p => statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.reads.jsonl')).sort().map(f => join(p, f)) : [p]);
  for (const f of readFiles) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); readers.set(d.trial_id, { as_read: d.as_read, cause: d.cause, file: basename(f) }); }

  const problems: string[] = [];
  const rows: RowOut[] = [];
  const pinned: Record<Col | 'abc_other', Rec[]> = { scored: [], ac: [], abc: [], abc_other: [] };
  const drift: number[] = [];

  for (const rec of records) {
    const tail = tailOf(rec.trial_id);
    const dir = join(o.trialRoot, 'trials', tail);
    const rel = (p: string) => 'trials/' + relative(join(o.trialRoot, 'trials'), p);
    const nonce = rec.install.nonce;
    const stored = JSON.parse(readFileSync(join(dir, 'install-turns.json'), 'utf8')) as Array<Omit<InstallTurn, 'events'> & { events: number }>;
    const turns: InstallTurn[] = stored.map(t => ({ ...t, events: parseTurn(rec.harness, join(dir, 'logs'), t.turn, t.session) }));
    for (let i = 0; i < turns.length; i++) if (turns[i].events.length !== stored[i].events) problems.push(`${rec.trial_id}: turn ${stored[i].turn} parses to ${turns[i].events.length} events, install-turns.json has ${stored[i].events}`);
    const turnsA = turns.map(t => ({ ...t, events: applyRuleA(t.events) }));
    const watch = readNdjson<Probe>(join(dir, 'logs', 'install-watch.ndjson'));
    const egress = readNdjson<EgressLine>(join(dir, 'egress.ndjson'));
    const started = turns[0]?.started_at ?? rec.started_at;
    const installed = turns.some(t => t.probe?.ok);
    const recallIdx = turns.findIndex(t => t.role === 'recall');
    const evidence: string[] = [];

    let strict: ReturnType<typeof gbrainHookRecall> = null;
    let lenient: ReturnType<typeof gbrainHookRecall> = null;
    if (rec.harness === 'claude-code') {
      const proof = proofs[rec.trial_id];
      if (!proof) problems.push(`${rec.trial_id}: no settings proof`);
      const recallTurn = recallIdx >= 0 ? turns[recallIdx] : null;
      const f = recallTurn ? readMaybeGz(join(dir, 'logs', 'turns', `turn-${pad(recallTurn.turn)}.claude.jsonl`)) : null;
      if (f && recallTurn) {
        const probeHook = proof?.settings === 'lost' && recallTurn.probe?.hook === true && (recallTurn.probe.wired ?? []).includes('claude/settings.json');
        strict = gbrainHookRecall(f.raw, proof ?? null, nonce, false);
        lenient = gbrainHookRecall(f.raw, proof ?? null, nonce, probeHook);
        const hit = o.lenientB ? lenient : strict;
        if (hit) evidence.push(`b: ${rel(f.path)}:${hit.line} (${hit.via === 'probe' ? `gbrain's from ${rel(join(dir, 'install-turns.json'))} turn ${recallTurn.turn} probe; state/claude/settings.json is lost` : hit.via === 'settings' ? 'gbrain hook commands in state/claude/settings.json, per the settings proof' : 'hook names gbrain'})`);
      }
    }
    if (rec.harness === 'openclaw') for (const t of turns.filter(t => t.role === 'recall' || t.role === 'save')) {
      const f = readMaybeGz(join(dir, 'logs', 'turns', `turn-${pad(t.turn)}.openclaw-session.jsonl`));
      const lines = f ? toolCallEvidence(f.raw, t.role === 'recall' ? nonce : null) : [];
      if (f && lines.length) evidence.push(`a (${t.role}): ${rel(f.path)}:${lines.join(',')}`);
    }
    const scan = cScan[rec.trial_id];
    const recordedOc = rec.install.finish.outside_brain.filter(x => x.startsWith('state/openclaw/'));
    let outsideC = rec.install.finish.outside_brain;
    if (scan) {
      const plain = outsideOf(scan, false).outside;
      if (JSON.stringify(plain) !== JSON.stringify(recordedOc)) problems.push(`${rec.trial_id}: the rule-c scan without rule c gives ${JSON.stringify(plain)}, the record ${JSON.stringify(recordedOc)}`);
      const c = outsideOf(scan, true);
      outsideC = [...rec.install.finish.outside_brain.filter(x => !x.startsWith('state/openclaw/')), ...c.outside].sort();
      evidence.push(...c.dropped.map(d => `c: ${rel(join(dir, d))}`));
    } else if (recordedOc.some(x => /memory_index_chunks/.test(x))) problems.push(`${rec.trial_id}: a memory_index_chunks hit with no rule-c scan`);

    const score = (a: boolean, hook: number | null, c: boolean): Scored => {
      const ts = a ? turnsA : turns;
      const finish = finishOf(recallIdx >= 0 ? ts[recallIdx] : null, nonce, hook, rec.install.finish.brain, c ? outsideC : rec.install.finish.outside_brain);
      const outcome = outcomeOf(finish, installed);
      const classification = classifyInstall({ harness: rec.harness, turns: ts, watch, egress, started_at: started, finish: outcome === 'recalled' });
      const excluded = excludedReason({ ...rec, install: { ...rec.install, outcome, classification } } as Rec);
      return { outcome, finish, classification, counted: excluded === null, excluded };
    };
    const bLine = (o.lenientB ? lenient : strict)?.line ?? null;
    const otherLine = (o.lenientB ? strict : lenient)?.line ?? null;
    const s = { none: score(false, null, false), a: score(true, null, false), c: score(false, null, true), ac: score(true, null, true), abc: score(true, bLine, true), abcOther: score(true, otherLine, true) };

    const storedC = rec.install.classification;
    const noSteps = (c: InstallClassification) => JSON.stringify({ ...c, steps: null });
    if (s.none.outcome !== rec.install.outcome) problems.push(`${rec.trial_id}: frozen recompute gives ${s.none.outcome}, the record ${rec.install.outcome}`);
    if (s.none.finish.reply !== rec.install.finish.reply || s.none.finish.gbrain_call !== rec.install.finish.gbrain_call) problems.push(`${rec.trial_id}: frozen recompute finish differs from the record`);
    if (noSteps(s.none.classification) !== noSteps(storedC)) problems.push(`${rec.trial_id}: frozen recompute classification differs from the record`);
    const reSteps = s.none.classification.steps as Record<string, number | null>;
    const storedSteps = storedC.steps as Record<string, number | null>;
    for (const [k, v] of Object.entries(storedSteps)) {
      if ((v === null) !== (reSteps[k] === null)) problems.push(`${rec.trial_id}: frozen recompute ${k} is ${reSteps[k]}, the record ${v}`);
      else if (v !== null && reSteps[k] !== null) drift.push(Math.abs(v - reSteps[k]!));
    }
    const settle = (x: Scored): Scored => ({ ...x, classification: { ...x.classification, steps: Object.fromEntries(Object.entries(x.classification.steps as Record<string, number | null>).map(([k, v]) => [k, (v === null) === (reSteps[k] === null) ? storedSteps[k] : v])) as InstallClassification['steps'] } });
    const ac = settle(s.ac), abc = settle(s.abc), abcOther = settle(s.abcOther);

    const changedAc = ac.outcome === rec.install.outcome ? [] : [['a', s.c], ['c', s.a]].filter(([, w]) => (w as Scored).outcome !== ac.outcome).map(([r]) => r as string);
    const changedB = abc.outcome !== ac.outcome;
    const reader = readers.get(rec.trial_id) ?? null;
    const recallA = recallIdx >= 0 ? turnsA[recallIdx] : null;
    const stray = abc.outcome !== 'recalled' && recallA ? recallA.events.find(e => e.kind !== 'text' && !isGbrainServed(e) && !e.is_error && hasToken(e.output, nonce) && /gbrain/i.test(e.input)) : undefined;
    const outcomes: Record<Col, Outcome> = { scored: rec.install.outcome as Outcome, ac: ac.outcome, abc: abc.outcome };
    const counted: Record<Col, boolean> = { scored: excludedReason(rec) === null, ac: ac.counted, abc: abc.counted };
    rows.push({
      trial_id: rec.trial_id, cell: rec.cell, arm: rec.install.arm, harness: rec.harness, model: rec.model, termination: rec.termination,
      counted: abc.counted, excluded: abc.excluded,
      scored: outcomes.scored, ac: ac.outcome, abc: abc.outcome, abc_other_b: abcOther.outcome, b_reading: o.lenientB ? 'lenient' : 'strict',
      changed_by: [...changedAc, ...(changedB ? ['b'] : [])], changed_by_ac: changedAc, changed_by_b: changedB,
      b_via: changedB ? ((o.lenientB ? lenient : strict)?.via ?? null) : null,
      b_unproven_hook: !strict && lenient ? lenient.line : null,
      finish_line: Object.fromEntries(COLS.map(c => [c, counted[c] && conservativeOutcome(outcomes[c], rec.termination) === 'recalled'])) as Record<Col, boolean>,
      conservative_miss: COLS.filter(c => counted[c] && outcomes[c] === 'recalled' && conservativeOutcome(outcomes[c], rec.termination) !== 'recalled'),
      saved_step: { scored: storedC.steps.saved_ms !== null, ac: ac.classification.steps.saved_ms !== null },
      finish: { scored: rec.install.finish, ac: ac.finish, abc: abc.finish },
      unserved: stray ? `${stray.kind} call ${JSON.stringify((stray.kind === 'shell' ? stray.input : stray.name).slice(0, 80))}` : null,
      evidence,
      reader: reader ? { as_read: reader.as_read, file: reader.file } : null,
    });
    const asRec = (x: Scored) => ({ ...rec, install: { ...rec.install, outcome: x.outcome, classification: x.classification } }) as Rec;
    pinned.scored.push(rec);
    pinned.ac.push(asRec(ac));
    pinned.abc.push(asRec(abc));
    pinned.abc_other.push(asRec(abcOther));
  }

  const conservative = (rs: Rec[]) => rs.map(r => ({ ...r, install: { ...r.install, outcome: conservativeOutcome(r.install.outcome as Outcome, r.termination) } }) as Rec);
  const sets = { pinned, conservative: Object.fromEntries(Object.entries(pinned).map(([k, rs]) => [k, conservative(rs)])) as typeof pinned };
  const inputs = { trials_jsonl: sha256(o.trials), c_scan: sha256(o.cScan), settings_proof: sha256(o.proof), reads: readFiles.map(f => ({ file: basename(f), sha256: sha256(f) })) };
  const { markdown, json } = report(rows, sets, readers, problems, drift, Object.keys(cScan).length, Object.keys(proofs).length, inputs, o.lenientB);
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'rescored.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(o.out, 'RESCORE.md'), markdown);
  writeFileSync(join(o.out, 'rescore.json'), JSON.stringify(json, null, 1) + '\n');
  return { problems };
}

type Sets = { pinned: Record<Col | 'abc_other', Rec[]>; conservative: Record<Col | 'abc_other', Rec[]> };

function report(rows: RowOut[], sets: Sets, readers: Map<string, Reader>, problems: string[], drift: number[], nScan: number, nProof: number, inputs: Record<string, unknown>, lenientB: boolean): { markdown: string; json: unknown } {
  type K = Col | 'abc_other';
  const v = Object.fromEntries((['pinned', 'conservative'] as const).map(m => [m, Object.fromEntries((['scored', 'ac', 'abc', 'abc_other'] as K[]).map(k => [k, verdict(sets[m][k])]))])) as Record<'pinned' | 'conservative', Record<K, CellVerdict[]>>;
  const sum = (cs: CellVerdict[], pick: (c: CellVerdict) => boolean = () => true) => cs.filter(pick).reduce((a, c) => ({ k: a.k + c.finish.k, n: a.n + c.finish.n }), { k: 0, n: 0 });
  const C = v.conservative, P = v.pinned;
  const tot = (k: K, pick?: (c: CellVerdict) => boolean) => { const t = sum(C[k], pick); return fmt(t.k, t.n); };
  const T = (m: 'pinned' | 'conservative', k: K) => sum(v[m][k]);
  const bName = lenientB ? 'lenient' : 'strict', otherName = lenientB ? 'strict' : 'lenient';
  const bMoved = rows.filter(r => r.changed_by_b);
  const aMoved = rows.filter(r => r.changed_by_ac.includes('a'));
  const cMoved = rows.filter(r => r.changed_by_ac.includes('c'));
  const consRows = rows.filter(r => r.conservative_miss.length);
  const failing = new Set(problems.map(p => p.split(':')[0]));
  const topStep = (rs: Rec[]) => { const t = failureTable(rs, 'bare'); const max = Math.max(...t.map(r => r.failed_runs)); return { steps: t.filter(r => r.failed_runs === max).map(r => r.step), failed_runs: max }; };
  const tops = Object.fromEntries(COLS.map(c => [c, topStep(sets.conservative[c])])) as Record<Col, { steps: string[]; failed_runs: number }>;
  const out: string[] = [];

  out.push('# Rescore of gbrain-install-2026-11 with three scorer fixes', '');
  out.push(`Generated by rescore.ts from the inputs whose sha256 is listed under Validation; every number here is in rescored.jsonl and rescore.json. A post-data rescore, not preregistered: the pinned verdict stays the counted result, and these columns sit beside it. Rule b is read ${bName}.`, '');
  out.push('## Takeaways', '');
  out.push(`- **Counted finish line over all cells: ${fmt(T('conservative', 'scored').k, T('conservative', 'scored').n)} as scored, ${fmt(T('conservative', 'ac').k, T('conservative', 'ac').n)} with the OpenClaw tool_call and session-index fixes (a+c), ${fmt(T('conservative', 'abc').k, T('conservative', 'abc').n)} when gbrain's own Claude Code hook also counts (a+b+c, b ${bName}).** All three apply the conservative harness_error rule.`);
  out.push(`- Rule a (OpenClaw's tool_call wrapper) is needed for ${aMoved.length} changed outcomes and rule c (OpenClaw's index of its own transcript) for ${cMoved.length}. Rule b moves ${bMoved.length} more; it is a definitional change, since the nonce reached the agent through gbrain's hook with no tool call.`);
  out.push(`- The frozen scorer, recomputed here from the same files, reproduces ${rows.length - failing.size} of ${rows.length} trials (outcome, finish and classification).${problems.length ? ` ${problems.length} problem(s) are listed under Validation.` : ''}`, '');

  out.push('## Per cell', '');
  out.push("Finish line is k of n counted runs, with the Wilson 95% interval from verdict.ts's wilson(). Each column uses verdict.ts's exclusions on its own classification and the conservative harness_error rule.", '');
  out.push('| Cell | Arm | n | As scored | a+c | a+b+c |', '|---|---|---|---|---|---|');
  for (const c of C.scored) {
    const ac = C.ac.find(x => x.cell === c.cell)!, abc = C.abc.find(x => x.cell === c.cell)!;
    const nNote = ac.finish.n !== c.finish.n || abc.finish.n !== c.finish.n ? ` (a+c ${ac.finish.n}, a+b+c ${abc.finish.n})` : '';
    out.push(`| ${c.cell} | ${c.arm} | ${c.finish.n}${nNote} | ${fmt(c.finish.k, c.finish.n)} | ${fmt(ac.finish.k, ac.finish.n)} | ${fmt(abc.finish.k, abc.finish.n)} |`);
  }
  out.push('', '## Totals', '', '| Group | As scored | a+c | a+b+c |', '|---|---|---|---|');
  out.push(`| All cells | ${tot('scored')} | ${tot('ac')} | ${tot('abc')} |`);
  for (const arm of ['bare', 'paste']) out.push(`| Arm ${arm} | ${tot('scored', c => c.arm === arm)} | ${tot('ac', c => c.arm === arm)} | ${tot('abc', c => c.arm === arm)} |`);
  for (const h of [...new Set(C.scored.map(c => c.harness))].sort()) out.push(`| Harness ${h} | ${tot('scored', c => c.harness === h)} | ${tot('ac', c => c.harness === h)} | ${tot('abc', c => c.harness === h)} |`);
  out.push('');

  out.push('## Conservative harness_error rule', '');
  out.push(`A counted trial that ended in harness_error or timeout is a miss in every column, even when its outcome is recalled; the pinned verdict counts such a trial as a finish. Pinned verdict against conservative: as scored ${T('pinned', 'scored').k} vs ${T('conservative', 'scored').k}, a+c ${T('pinned', 'ac').k} vs ${T('conservative', 'ac').k}, a+b+c ${T('pinned', 'abc').k} vs ${T('conservative', 'abc').k} (of ${T('conservative', 'scored').n}).`, '');
  out.push(...(consRows.length ? consRows.map(r => `- ${short(r.trial_id)} (${r.termination}): a finish under the pinned verdict, a miss here, in ${r.conservative_miss.map(c => COL_NAME[c]).join(', ')}.`) : ['- No trial changes.']), '');

  const trans = (key: 'ac' | 'abc') => { const m = new Map<string, number>(); for (const r of rows) if (r.scored !== r[key]) { const t = `${r.scored} to ${r[key]}`; m.set(t, (m.get(t) ?? 0) + 1); } return [...m].sort().map(([k, n]) => `${k} ${n}`).join(', ') || 'none'; };
  out.push('## What each rule moved', '', 'Outcome changes over all 200 trials, counted or not, before the conservative rule:', '', `- a+c: ${trans('ac')}`, `- a+b+c: ${trans('abc')}`);
  out.push(`- Outcomes moved by a or c, per cell: ${[...new Set(rows.map(r => r.cell))].map(c => [c, rows.filter(r => r.cell === c && r.changed_by_ac.length).length] as const).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(', ')}.`);
  out.push(`- Rule a also gives a saved step (saved_ms) to ${rows.filter(r => !r.saved_step.scored && r.saved_step.ac).length} trials whose save went through an OpenClaw MCP tool_call.`, '');

  out.push('## Rule b', '');
  const unproven = rows.filter(r => r.b_unproven_hook !== null);
  out.push(`Rule b (${bName}) changes ${bMoved.length} outcomes. In each, the recall turn's transcript has a successful hook_response from gbrain's SessionStart or UserPromptSubmit hook whose output holds the nonce, the reply holds the nonce, and no gbrain tool call in the turn returned it. Strict counts a hook only when its name names gbrain or the trial's settings proof shows every hook command registered for that event runs ` + '"gbrain hook"' + `.`, '');
  out.push('| Cell | a+c | a+b+c |', '|---|---|---|');
  for (const c of C.ac.filter(c => bMoved.some(r => r.cell === c.cell))) { const abc = C.abc.find(x => x.cell === c.cell)!; out.push(`| ${c.cell} | ${fmt(c.finish.k, c.finish.n)} | ${fmt(abc.finish.k, abc.finish.n)} |`); }
  out.push('');
  out.push(`### Note: rule b read ${otherName}`, '');
  const flips = unproven.filter(r => r.abc_other_b !== r.abc);
  out.push(`${unproven.length} recall turns have a gbrain hook recall that strict b cannot prove, because the trial's archived state/claude/settings.json is lost (0 bytes; in each shard every such file was modified within the same second, after the trials ended). ${flips.length} of them change the a+b+c outcome under the other reading: ${flips.map(r => short(r.trial_id)).join(', ') || 'none'}; the other ${unproven.length - flips.length} were already recalled through a gbrain tool call. The lenient reading (--lenient-b) takes the hook as gbrain's when the probe the adapter wrote at the end of the recall turn found a gbrain hook command in claude/settings.json and the hook output carries gbrain's "retrieved brain context" header.`, '');
  out.push(`With rule b read ${otherName}, a+b+c is ${fmt(T('conservative', 'abc_other').k, T('conservative', 'abc_other').n)} (pinned verdict ${T('pinned', 'abc_other').k}); per cell where it differs:`, '');
  const diffCells = C.abc.filter(c => C.abc_other.find(x => x.cell === c.cell)!.finish.k !== c.finish.k);
  out.push(...(diffCells.length ? diffCells.map(c => { const x = C.abc_other.find(y => y.cell === c.cell)!; return `- ${c.cell}: ${fmt(x.finish.k, x.finish.n)} (${bName}: ${fmt(c.finish.k, c.finish.n)})`; }) : ['- none']), '');

  out.push('## Per-step failure tables', '', "Built with failure-table.ts's own failureTable() and failureMarkdown() on each column's outcomes (after the conservative rule) and classifications. A conservative miss whose probe passed counts at the saved or recalled step, as failedStep() decides. The as-read columns stay empty, as that script leaves them; the reader comparison is below.", '');
  out.push(`Top bare-arm step (most failed runs): as scored ${tops.scored.steps.join(' and ')} (${tops.scored.failed_runs}), a+c ${tops.ac.steps.join(' and ')} (${tops.ac.failed_runs}), a+b+c ${tops.abc.steps.join(' and ')} (${tops.abc.failed_runs}).`, '');
  for (const col of ['abc', 'ac'] as const) for (const arm of ['bare', 'paste']) out.push(`### Arm ${arm}, ${COL_NAME[col]}`, '', failureMarkdown(failureTable(sets.conservative[col], arm)));

  out.push("## Readers' as_read against a+b+c", '');
  const readRows = rows.filter(r => r.reader);
  const disagree: string[] = [], unclear: string[] = [];
  let agree = 0;
  for (const r of readRows) {
    const rd = readers.get(r.trial_id)!;
    const f = r.finish.abc;
    const why = r.b_unproven_hook !== null ? `gbrain's hook returned the nonce (recall turn line ${r.b_unproven_hook}), but the archived settings.json is lost, so strict b cannot prove the hook is gbrain's; lenient b counts it`
      : r.unserved ? `the recall turn's ${r.unserved} returned the nonce, but it is not a gbrain-served call under the frozen rule and none of a, b, c covers it`
      : f.outside_brain.length ? `harness memory remains (${f.outside_brain.join('; ')})` : !f.reply ? 'the recall reply lacks the nonce' : !f.gbrain_call ? 'no gbrain-served result holding the nonce in the recall turn' : !f.brain ? 'the nonce is not in the brain' : 'not counted';
    const cause = md(rd.cause.length > 160 ? rd.cause.slice(0, 157) + '...' : rd.cause);
    if (rd.as_read === 'unclear') { unclear.push(`- ${short(r.trial_id)}: a+b+c ${r.abc}${r.abc === 'recalled' ? ` (rule ${r.changed_by.join('+') || 'none'})` : `: ${why}`}. Reader (${rd.file}): ${cause}`); continue; }
    const readRecalled = rd.as_read === 'recalled';
    if (readRecalled === (r.abc === 'recalled')) { agree++; continue; }
    disagree.push(readRecalled
      ? `- ${short(r.trial_id)}: reader recalled, a+b+c ${r.abc}: ${why}. Reader (${rd.file}): ${cause}`
      : `- ${short(r.trial_id)}: reader missed, a+b+c recalled by rule ${r.changed_by.join('+')} (${r.evidence.filter(e => !e.startsWith('a (save)')).join('; ')}). Reader (${rd.file}): ${cause}`);
  }
  if (!readers.size) out.push('No reader files were given (--reads).', '');
  else {
    out.push(`${readRows.length} trials have a reader line (the readers read the scored misses only). ${agree} agree with a+b+c, ${disagree.length} disagree${disagree.length === 1 ? 's' : ''}, and ${unclear.length} ${unclear.length === 1 ? 'was' : 'were'} read as unclear.`, '');
    out.push('### Disagreements', '', ...(disagree.length ? disagree : ['- none']), '', '### Read as unclear', '', ...(unclear.length ? unclear : ['- none']), '');
  }

  out.push('## Validation', '');
  out.push(`- Frozen recompute: the frozen rules (parseTurn, isGbrainServed, classifyInstall) run on the committed transcripts reach every recorded outcome, finish.reply, finish.gbrain_call and classification except step times; as scored and recomputed give the same pinned total (${T('pinned', 'scored').k}/${T('pinned', 'scored').n}). Step times use the first turn's start in place of the runner's first-message clock, so they drift by at most ${drift.length ? Math.max(...drift) : 0} ms; a corrected column keeps the recorded value of every step whose null-ness it does not change.`);
  out.push(`- Rule c input: ${nScan} OpenClaw trials scanned. For each, the scan with rule c off gives exactly the recorded state/openclaw outside_brain entries.`);
  out.push(`- Rule b input: ${nProof} Claude Code settings proofs.`);
  out.push('- Parsed event counts per turn match install-turns.json for every turn.');
  out.push(`- Inputs (sha256): trials.jsonl ${(inputs as { trials_jsonl: string }).trials_jsonl}, c-scan.json ${(inputs as { c_scan: string }).c_scan}, settings-proof.json ${(inputs as { settings_proof: string }).settings_proof}${(inputs as { reads: Array<{ file: string; sha256: string }> }).reads.map(x => `, ${x.file} ${x.sha256}`).join('')}.`);
  out.push('', problems.length ? 'Problems:' : 'Problems: none.', ...problems.map(p => `- ${p}`), '');

  out.push('## How each rule is applied', '');
  out.push("- **a.** After parseTurn, an OpenClaw event of kind other named tool_call whose arguments.id (or, for a result with no call, the result's tool.id) matches mcp:gbrain:<tool> or (^|:)gbrain__<tool> becomes kind mcp named gbrain__<tool>, with its args as input, the inner result's content as output (OpenClaw wraps {tool, result} in an EXTERNAL_UNTRUSTED_CONTENT block) and is_error when the call or the inner result failed. Every scorer rule then sees an MCP gbrain tool: isGbrainServed for the finish line, and in classifyInstall the saved step, saved_to_harness_memory and the last gbrain code.");
  out.push("- **b.** Claude Code, recall turn only. A system hook_response line with hook_event SessionStart or UserPromptSubmit, outcome success and exit code 0, whose output or stdout holds the nonce, is a gbrain-served recall when the hook is gbrain's and the reply holds the nonce. Strict: its name or command names gbrain, or every hook command the trial's settings register for that event runs gbrain hook. Lenient adds the probe reading in the note above. It sets finish.gbrain_call only; it adds no event, so the saved step and the classification are unchanged.");
  out.push("- **c.** In openclaw-agent.sqlite only. A memory_index_chunks or memory_index_chunks_fts row holding the nonce is harness memory only when its source is not sessions; a memory_index_chunks_fts_content row by its source column (c3); the fts shadow tables with no source (_fts_data, _fts_idx, _fts_docsize, _fts_config) only when the fts table holds the nonce in a row of another source. Every other table, file and database keeps the frozen rule.");
  out.push('- **Conservative harness_error rule.** A counted trial whose termination is harness_error or timeout is a miss in every column.');
  out.push('- Everything else is the frozen scorer: the reply must hold the nonce and the brain must hold it (finish.brain as recorded); outside the brain is checked first, then the finish line, then the install; verdict.ts excludes model_error, infra_error, exam_fault, HE-INSTALL-003 and infra classifications.');

  const colJson = (k: K) => ({ pinned: wil(T('pinned', k).k, T('pinned', k).n), conservative: wil(T('conservative', k).k, T('conservative', k).n) });
  const group = (pick: (c: CellVerdict) => boolean) => Object.fromEntries(COLS.map(k => { const t = sum(C[k], pick); return [k, wil(t.k, t.n)]; }));
  const json = {
    run: 'gbrain-install-2026-11', b_reading: bName, inputs,
    totals: { scored: colJson('scored'), ac: colJson('ac'), abc: colJson('abc') },
    b_note: { reading: otherName, abc: colJson('abc_other'), unproven_hooks: unproven.map(r => r.trial_id), outcome_changes: unproven.filter(r => r.abc_other_b !== r.abc).map(r => r.trial_id) },
    arms: Object.fromEntries(['bare', 'paste'].map(a => [a, group(c => c.arm === a)])),
    harnesses: Object.fromEntries([...new Set(C.scored.map(c => c.harness))].sort().map(h => [h, group(c => c.harness === h)])),
    cells: C.scored.map(c => ({ cell: c.cell, arm: c.arm, harness: c.harness, ...Object.fromEntries(COLS.map(k => { const x = C[k].find(y => y.cell === c.cell)!; return [k, wil(x.finish.k, x.finish.n)]; })) })),
    conservative_changes: consRows.map(r => ({ trial_id: r.trial_id, termination: r.termination, columns: r.conservative_miss })),
    rule_moves: { a_needed: aMoved.length, c_needed: cMoved.length, b: bMoved.length },
    top_bare_step: tops,
    problems,
  };
  return { markdown: out.join('\n') + '\n', json };
}

function parseArgs(argv: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (k === 'lenient-b') { out[k] = ['1']; continue; }
    const val = argv[++i];
    if (val === undefined) throw new Error(`--${k} needs a value`);
    (out[k] ??= []).push(val);
  }
  return out;
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const one = (k: string) => { const v = a[k]; if (!v || v.length !== 1) { console.error(`--${k} is required once; see the header of rescore.ts`); process.exit(2); } return v[0]!; };
  if (a['scan-state']) scanStateMode(a['scan-state'], readRecords(one('trials')), one('c-scan'), one('settings-proof'), one('scratch'));
  else {
    const { problems } = rebuild({ trials: one('trials'), trialRoot: one('trial-root'), cScan: one('c-scan'), proof: one('settings-proof'), reads: a.reads ?? [], out: one('out'), lenientB: !!a['lenient-b'] });
    console.log(`rescored; ${problems.length} validation problem(s)`);
    for (const p of problems) console.log('PROBLEM ' + p);
    if (problems.length) process.exit(1);
  }
}
