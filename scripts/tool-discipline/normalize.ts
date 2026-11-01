#!/usr/bin/env bun
// internal-task tool discipline, step 1: one ndjson row per assistant tool call, from two published sources.
//
//   bun scripts/tool-discipline/normalize.ts [--benchmarks <dir>] [--gsta <dir>] [--out <file>]
//
// (a) World event logs: <benchmarks>/<run>/results/trials/<cell>/<task>/<rep>/events.jsonl (world/services/events.ts), the
//     rows with actor "assistant" only. Model, harness and termination come from the run's results/trials.jsonl by trial id;
//     a trial missing there falls back to the cell name. call_class says which rows are the model's own calls:
//       model     via "mcp" (a world-MCP call) and gbrain tool calls (gbrain-usage.ts isGbrainCall)
//       protocol  gbrain.initialize and gbrain.tools/list, the harness's MCP client handshake
//       channel   via "slack": the bot's Slack identity, used by the runner posting the turn's reply_text (runner/trial/turns.ts)
//                 and by harness channel plumbing such as QM's conversations.list; not a model tool call
//     A run directory is skipped when it holds sealed material: any *.age file, a directory named sealed, or a prereg.json
//     whose custody is "sealed". The published m3-heldout and v02-heldout result directories hold none and are included.
//     The repository's sealed/ directory and the custody branch are never read.
// (b) internal-task evidence summaries: <gsta>/{panel-run,panel-run-3610}/evidence/*.txt and <gsta>/run/evidence/*.md, the
//     extractor excerpts of scripts/gsta-135/evidence.ts. Lines are "session S seq N toolCall <tool> <json>" (OpenClaw;
//     "seq N ..." in the discovery run) with "toolResult <tool> (error|exit N): <text>", and "id N tool_call <tool> <json>"
//     (Hermes) with "id N tool result (<tool>) (error|exit N): <text>". The extractor clips call arguments at 240 and
//     result text at 120 characters, ending a clipped field with " ..."; such rows carry clipped / result_clipped true.
//     A result joins the oldest waiting call of the same tool in the same session. The extractor's own events for the
//     trial (cells.jsonl evidence.events, computed on the full native store) join by locator and tool, so a clipped
//     helper command still has the extractor's exit_belongs verdict.
//
// The inclusion rule and per-run counts go to stderr.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { WorldEvent } from '../../world/services/events.ts';
import { isGbrainCall } from '../gbrain-usage.ts';

export type Outcome = 'ok' | 'denied' | 'error' | 'unknown';
export interface ExtractorEvent { kind: string; tool: string; detail: string; skill: string | null; result: string; exit: number | null; exit_belongs: boolean | null }
export interface CallRow {
  source: 'events' | 'gsta135';
  run: string;
  cell: string;
  harness: string;
  model: string;
  task: string;
  rep: string;
  trial: string;
  arm: string | null;
  termination: string | null;
  seq: number;
  session: string | null;
  tool: string;
  via: string;
  call_class: 'model' | 'protocol' | 'channel';
  args: unknown;
  outcome: Outcome;
  exit: number | null;
  effect: unknown;
  error: string | null;
  result_text: string | null;
  clipped: boolean;
  result_clipped: boolean;
  /** internal-task only: the extractor's events at this call's locator, [] when it saw nothing there, null when the trial has none. */
  extractor: ExtractorEvent[] | null;
  locator: string;
  sha256: string;
}

const ROOT = join(import.meta.dir, '..', '..');
const KNOWN_HARNESSES = ['claude-code', 'qm-claude', 'qm-pi', 'codex', 'hermes', 'openclaw', 'qm'];
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const CLIP = ' ...';

/** The cell's harness: its leading harness name, multi-word names (claude-code, qm-pi, qm-claude) kept whole. */
export const harnessOf = (cell: string) => KNOWN_HARNESSES.find(h => cell === h || cell.startsWith(h + '-')) ?? cell.split('-')[0];
const stripProvider = (m: string) => m.replace(/^[a-z]+:/, '');
const modelFromCell = (cell: string) => {
  const word = cell.slice(harnessOf(cell).length + 1).split('-')[0];
  return ({ sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', opus: 'claude-opus-5-5', luna: 'gpt-6-luna' } as Record<string, string>)[word] ?? 'unknown';
};

/** Why a benchmark run directory is excluded, or null when it is included. */
export function sealedReason(dir: string): string | null {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name === 'sealed') return 'has a sealed/ directory'; stack.push(join(d, e.name)); continue; }
      if (e.name.endsWith('.age')) return 'has an age-encrypted file ' + relative(dir, join(d, e.name));
    }
  }
  const prereg = join(dir, 'prereg.json');
  if (existsSync(prereg) && /"custody"\s*:\s*"sealed"/.test(readFileSync(prereg, 'utf8'))) return 'prereg.json custody is sealed';
  return null;
}

const callClass = (e: WorldEvent): CallRow['call_class'] => e.via === 'slack' ? 'channel' : (e.via as string) === 'gbrain' && !isGbrainCall(e) ? 'protocol' : 'model';

/** Rows of one events.jsonl. */
export function eventsRows(file: string, locatorPath: string, meta: { run: string; cell: string; task: string; rep: string; harness: string; model: string; termination: string | null }): CallRow[] {
  const sha = sha256(file);
  const rows: CallRow[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as WorldEvent;
    if (e.actor !== 'assistant') continue;
    rows.push({
      source: 'events', run: meta.run, cell: meta.cell, harness: meta.harness, model: meta.model, task: meta.task, rep: meta.rep,
      trial: [meta.run, meta.cell, meta.task, meta.rep].join('/'), arm: null, termination: meta.termination,
      seq: e.seq, session: null, tool: e.tool, via: e.via, call_class: callClass(e), args: e.args, outcome: e.outcome, exit: null,
      effect: e.effect ?? null, error: e.error ?? null, result_text: null, clipped: false, result_clipped: false, extractor: null,
      locator: locatorPath + '#' + e.seq, sha256: sha,
    });
  }
  return rows;
}

export interface RunCount { source: string; run: string; included: boolean; reason: string; files: number; trials: number; rows: number; model: number; protocol: number; channel: number }

export function normalizeBenchmarks(dir: string, counts: RunCount[]): CallRow[] {
  const out: CallRow[] = [];
  for (const run of readdirSync(dir).sort()) {
    const runDir = join(dir, run);
    const trialsDir = join(runDir, 'results', 'trials');
    if (!statSync(runDir).isDirectory() || !existsSync(trialsDir)) continue;
    const reason = sealedReason(runDir);
    const count: RunCount = { source: 'events', run, included: !reason, reason: reason ?? (run.includes('heldout') ? 'held-out name, published results, no sealed material' : 'published results'), files: 0, trials: 0, rows: 0, model: 0, protocol: 0, channel: 0 };
    counts.push(count);
    if (reason) continue;
    const meta = new Map<string, { harness: string; model: string; termination: string | null }>();
    const tj = join(runDir, 'results', 'trials.jsonl');
    if (existsSync(tj)) for (const line of readFileSync(tj, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const t = JSON.parse(line);
      meta.set(String(t.trial_id).split('/').slice(1).join('/'), { harness: harnessOf(String(t.cell)), model: t.model ? stripProvider(String(t.model)) : modelFromCell(String(t.cell)), termination: t.termination ?? null });
    }
    for (const cell of readdirSync(trialsDir).sort()) for (const task of readdirSync(join(trialsDir, cell)).sort()) {
      const taskDir = join(trialsDir, cell, task);
      if (!statSync(taskDir).isDirectory()) continue;
      for (const rep of readdirSync(taskDir).sort()) {
        const f = join(taskDir, rep, 'events.jsonl');
        if (!existsSync(f)) continue;
        const m = meta.get([cell, task, rep].join('/')) ?? { harness: harnessOf(cell), model: modelFromCell(cell), termination: null };
        const rows = eventsRows(f, relative(ROOT, f).startsWith('..') ? relative(dir, f) : relative(ROOT, f), { run, cell, task, rep, ...m });
        count.files++; count.trials++; count.rows += rows.length;
        for (const r of rows) count[r.call_class]++;
        out.push(...rows);
      }
    }
  }
  return out;
}

const SHELL_TOOLS = /^(exec|bash|shell|terminal|run|execute_code)$/;
const unclip = (s: string) => s.endsWith(CLIP) ? { text: s.slice(0, -CLIP.length), clipped: true } : { text: s, clipped: false };

/** A JSON object text that may be cut short: parsed when whole, else the string fields that are readable up to the cut. */
export function partialArgs(text: string): Record<string, unknown> | string {
  try { return JSON.parse(text); } catch { /* clipped */ }
  const out: Record<string, unknown> = {};
  for (const m of text.matchAll(/"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g)) {
    const body = m[2].replace(/\\$/, '');
    try { out[m[1]] = JSON.parse('"' + body + '"'); } catch { out[m[1]] = body; }
  }
  return Object.keys(out).length ? out : text;
}

interface TrialMeta { harness: string; task: number; arm: string; trial_index: number | null; model: string; termination: string | null; image: string; events: Array<ExtractorEvent & { locator: string }> | null }

/** Rows of one internal-task evidence summary. */
export function evidenceRows(file: string, locatorPath: string, run: string, trialId: string, meta: TrialMeta): CallRow[] {
  const sha = sha256(file);
  const rows: CallRow[] = [];
  const open = new Map<string, CallRow[]>();
  const perSeq = new Map<string, number>();
  const harness = meta.harness;
  const cell = harness + (/-chat$/.test(meta.image) ? '-chat' : '') + '-opus-' + meta.arm;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const oc = line.match(/^(?:session ([0-9a-f]+) )?seq (\d+) (toolCall|toolResult) ([^\s:]+)(.*)$/);
    const he = line.match(/^id (\d+) (tool_call (\S+) (.*)|tool result \(([^)]*)\)(.*))$/);
    if (!oc && !he) continue;
    const session = oc ? oc[1] ?? null : null;
    const seq = Number(oc ? oc[2] : he![1]);
    const sessKey = session ?? '';
    if (oc ? oc[3] === 'toolCall' : !!he![3]) {
      const tool = oc ? oc[4] : he![3];
      const raw = unclip(oc ? oc[5].replace(/^ /, '') : he![4]);
      const k = sessKey + ':' + seq;
      const n = perSeq.get(k) ?? 0;
      perSeq.set(k, n + 1);
      const row: CallRow = {
        source: 'gsta135', run, cell, harness, model: meta.model, task: 't' + meta.task, rep: String(meta.trial_index ?? 1), trial: run + '/' + trialId,
        arm: meta.arm, termination: meta.termination, seq, session, tool, via: 'native', call_class: 'model', args: partialArgs(raw.text),
        outcome: 'unknown', exit: null, effect: null, error: null, result_text: null, clipped: raw.clipped, result_clipped: false,
        extractor: meta.events ? extractorAt(meta.events, harness, session, seq, tool, raw.text) : null,
        locator: locatorPath + '#' + (session ? session + ':' : '') + seq + '.' + n, sha256: sha,
      };
      rows.push(row);
      open.set(sessKey + '|' + tool, [...(open.get(sessKey + '|' + tool) ?? []), row]);
      continue;
    }
    const tool = oc ? oc[4] : he![5];
    const m = (oc ? oc[5] : he![6]).match(/^((?: \((?:error|exit -?\d+|matches no waiting call)\))*):? ?([\s\S]*)$/)!;
    const flags = m[1];
    if (flags.includes('(matches no waiting call)')) continue;
    const call = open.get(sessKey + '|' + tool)?.shift();
    if (!call) continue;
    const res = unclip(m[2]);
    const exitM = flags.match(/\(exit (-?\d+)\)/);
    call.exit = exitM ? Number(exitM[1]) : null;
    call.result_text = res.text;
    call.result_clipped = res.clipped;
    call.outcome = /\(error\)/.test(flags) ? (/permission denied|not permitted|not allowed|requires approval|denied by/i.test(res.text) ? 'denied' : 'error')
      : call.exit !== null ? (call.exit === 0 ? 'ok' : 'error') : SHELL_TOOLS.test(tool) && oc ? 'unknown' : 'ok';
    if (call.outcome === 'error' || call.outcome === 'denied') call.error = res.text;
  }
  return rows;
}

/** The extractor events at a call's locator. Several calls can share one seq (one assistant message); the event's detail then
 *  has to carry the call's own command or path. */
function extractorAt(events: Array<ExtractorEvent & { locator: string }>, harness: string, session: string | null, seq: number, tool: string, argsText: string): ExtractorEvent[] {
  const at = events.filter(e => e.tool === tool && (harness === 'hermes'
    ? new RegExp('^messages id ' + seq + '(?: |$)').test(e.locator)
    : e.locator === 'transcript_events ' + (session ? 'session ' + session + ' ' : '') + 'seq ' + seq));
  const args = partialArgs(argsText);
  const key = typeof args === 'object' ? String(args.command ?? args.path ?? args.name ?? '').slice(0, 60) : '';
  return at.filter(e => key ? e.detail.includes(key) : at.length === 1)
    .map(({ kind, tool, detail, skill, result, exit, exit_belongs }) => ({ kind, tool, detail, skill, result, exit, exit_belongs }));
}

export const GSTA_RUNS: Array<{ dir: string; run: string; ext: string }> = [
  { dir: 'run', run: 'gsta135-discovery', ext: '.md' },
  { dir: 'panel-run', run: 'gsta135-panel-run', ext: '.txt' },
  { dir: 'panel-run-3610', run: 'gsta135-panel-run-3610', ext: '.txt' },
];

export function normalizeGsta(dir: string, counts: RunCount[]): CallRow[] {
  const out: CallRow[] = [];
  for (const g of GSTA_RUNS) {
    const evDir = join(dir, g.dir, 'evidence');
    const count: RunCount = { source: 'gsta135', run: g.run, included: existsSync(evDir), reason: existsSync(evDir) ? 'internal-task extractor excerpts (clipped)' : 'no evidence directory', files: 0, trials: 0, rows: 0, model: 0, protocol: 0, channel: 0 };
    counts.push(count);
    if (!count.included) continue;
    const cells = new Map<string, any>();
    const cj = join(dir, g.dir, 'cells.jsonl');
    if (existsSync(cj)) for (const line of readFileSync(cj, 'utf8').split('\n')) if (line.trim()) { const c = JSON.parse(line); cells.set(c.trial_id, c); }
    for (const f of readdirSync(evDir).filter(f => f.endsWith(g.ext)).sort()) {
      const trialId = basename(f, g.ext);
      const c = cells.get(trialId);
      const m = trialId.match(/^gsta135-(\w+)-t(\d)-(\w+?)(?:-(\d+))?$/);
      if (!m) continue;
      const meta: TrialMeta = {
        harness: c?.harness ?? m[1], task: Number(c?.task ?? m[2]), arm: c?.arm ?? m[3], trial_index: c?.trial_index ?? (m[4] ? Number(m[4]) : null),
        model: stripProvider(String(c?.model ?? 'claude-opus-5-5')), termination: c?.termination ?? null, image: String(c?.image ?? ''),
        events: Array.isArray(c?.evidence?.events) ? c.evidence.events : null,
      };
      const rows = evidenceRows(join(evDir, f), basename(dir) + '/' + g.dir + '/evidence/' + f, g.run, trialId, meta);
      count.files++; count.trials++; count.rows += rows.length; count.model += rows.length;
      out.push(...rows);
    }
  }
  return out;
}

export const INCLUSION_RULE = [
  'inclusion rule:',
  '  (a) docs/benchmarks/<run>/results/trials/<cell>/<task>/<rep>/events.jsonl, actor "assistant" rows only; a run directory is',
  '      skipped only when it holds sealed material (*.age, a sealed/ directory, prereg custody "sealed"); sealed/ and the custody',
  '      branch are never read. call_class model = via mcp or a gbrain tool call; protocol = gbrain initialize and tools/list;',
  '      channel = via slack (runner reply posts, harness channel plumbing). Rates use model rows.',
  '  (b) internal-task extractor excerpts: panel-run and panel-run-3610 evidence/*.txt, run/evidence/*.md (discovery); every tool',
  '      call line; clipped:true when the call text ends with " ..."; results joined by session, tool and order.',
].join('\n');

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const counts: RunCount[] = [];
  const rows = [...normalizeBenchmarks(arg('--benchmarks') ?? join(ROOT, 'docs', 'benchmarks'), counts)];
  const gsta = arg('--gsta');
  if (gsta) rows.push(...normalizeGsta(gsta, counts));
  process.stderr.write(INCLUSION_RULE + '\n' + (gsta ? '' : '  (b) skipped: no --gsta directory given\n') + 'per run:\n' +
    counts.map(c => '  ' + [c.source, c.run, c.included ? 'included' : 'EXCLUDED', c.reason, 'trials=' + c.trials, 'rows=' + c.rows, 'model=' + c.model, 'protocol=' + c.protocol, 'channel=' + c.channel].join('  ')).join('\n') +
    '\ntotal rows=' + rows.length + ' model=' + rows.filter(r => r.call_class === 'model').length + '\n');
  const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  const out = arg('--out');
  if (out) writeFileSync(out, text); else process.stdout.write(text);
}
