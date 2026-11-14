#!/usr/bin/env bun
// Set T clean-arm audit (internal-task results check 2). Set T records carry no skill_request.clean_arm, so this applies the
// preregistered rule c counter, runner/trial/skill-requests.ts gstackReads (imported, unchanged), to every set T trial
// from the per-trial logs the run kept:
//   claude-code, codex  gstackReads reads logs/turns/*.claude.jsonl / *.codex.jsonl itself (requests = [])
//   openclaw            state/openclaw/agents/*/agent/openclaw-agent.sqlite transcript_events (toolCall / toolResult)
//   hermes              logs/turns/*.hermes.jsonl (tool_use / tool_result, paired in order)
//   qm                  logs/qm-db.sql.gz, public.items ToolCall / ToolResult rows
// The OpenClaw, Hermes and QM calls are rebuilt as one Anthropic Messages body (tool_use + tool_result blocks), the shape
// got-skill.ts callsFromRequest reads, so the same read definition, catalog-copy list and missing-file rule apply.
//   bun <this file> <out.json> <dest results dir>...   (run from the pinned worktree)
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { gstackReads } from '../../../../../runner/trial/skill-requests.ts';

type Call = { id: string; name: string; input: unknown; result: string; is_error: boolean };
const body = (calls: Call[]) => ({ messages: calls.flatMap((c) => [
  { role: 'assistant', content: [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: c.result, is_error: c.is_error }] }]) });
const textOf = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' ? String((x as any).text ?? '') : String(x))).join('\n') : '';

function openclawCalls(trial: string): Call[] {
  const root = join(trial, 'state', 'openclaw', 'agents');
  if (!existsSync(root)) return [];
  const calls = new Map<string, Call>();
  for (const agent of readdirSync(root)) {
    const dir = join(root, agent, 'agent');
    if (!existsSync(join(dir, 'openclaw-agent.sqlite'))) continue;
    const tmp = mkdtempSync('/tmp/ocaudit-');
    for (const f of readdirSync(dir).filter((f) => f.startsWith('openclaw-agent.sqlite'))) copyFileSync(join(dir, f), join(tmp, f));
    const d = new Database(join(tmp, 'openclaw-agent.sqlite'));
    for (const row of d.query('select event_json, event_zstd from transcript_events order by session_id, seq').all() as Array<{ event_json: string | null; event_zstd: Uint8Array | null }>) {
      const raw = row.event_json ?? (row.event_zstd ? new TextDecoder().decode(Bun.zstdDecompressSync(row.event_zstd)) : null);
      if (!raw) continue;
      const m = JSON.parse(raw).message;
      if (!m) continue;
      if (m.role === 'assistant' && Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'toolCall') calls.set(b.id, { id: b.id, name: b.name, input: b.arguments, result: '', is_error: false });
      if (m.role === 'toolResult') { const c = calls.get(m.toolCallId); if (c) { c.result = textOf(m.content); c.is_error = m.isError === true; } }
    }
    d.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  return [...calls.values()];
}

function hermesCalls(trial: string): Call[] {
  const turns = join(trial, 'logs', 'turns');
  if (!existsSync(turns)) return [];
  const calls: Call[] = [], open: Call[] = [];
  for (const f of readdirSync(turns).filter((f) => f.endsWith('.hermes.jsonl')).sort()) {
    for (const l of readFileSync(join(turns, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let ev: any; try { ev = JSON.parse(l); } catch { continue; }
      if (ev.type === 'tool_use') { const c = { id: 'h' + calls.length, name: String(ev.name), input: ev.input, result: '', is_error: false }; calls.push(c); open.push(c); }
      if (ev.type === 'tool_result') { const i = open.findIndex((c) => c.name === ev.name); const c = i >= 0 ? open.splice(i, 1)[0] : undefined; if (c) { c.result = typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output ?? ''); c.is_error = ev.is_error === true; } }
    }
  }
  return calls;
}

const pgUnescape = (s: string) => s === '\\N' ? null : s.replace(/\\(\\|n|t|r)/g, (_m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'));
function qmCalls(trial: string): Call[] {
  const dump = join(trial, 'logs', 'qm-db.sql.gz');
  if (!existsSync(dump)) return [];
  const lines = gunzipSync(readFileSync(dump)).toString('utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('COPY public.items '));
  if (start < 0) return [];
  const head = lines[start]!;
  const cols = head.slice(head.indexOf('(') + 1, head.indexOf(')')).split(',').map((s) => s.trim());
  const calls = new Map<string, Call>();
  for (let i = start + 1; i < lines.length && lines[i] !== '\\.'; i++) {
    const v = lines[i]!.split('\t').map(pgUnescape);
    const r: Record<string, string | null> = Object.fromEntries(cols.map((c, j) => [c, v[j] ?? null]));
    if (r.kind === 'ToolCall' && r.call_id) {
      const b = r.body ? JSON.parse(r.body) : {};
      const input = b.wire?.argumentsJson ? JSON.parse(b.wire.argumentsJson) : b;
      calls.set(r.call_id, { id: r.call_id, name: String(r.tool), input, result: '', is_error: false });
    }
    if (r.kind === 'ToolResult' && r.call_id) { const c = calls.get(r.call_id); if (c) { c.result = r.text ?? ''; c.is_error = r.is_error === 't'; } }
  }
  return [...calls.values()];
}

const [out, ...dests] = process.argv.slice(2);
if (!out || !dests.length) { console.error('usage: sett-clean-arm-audit.ts <out.json> <dest results dir>...'); process.exit(2); }
const rows: Array<Record<string, unknown>> = [];
for (const dest of dests) {
  for (const l of readFileSync(join(dest, 'trials.jsonl'), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    const dir = join(dest, 'trials', ...String(r.trial_id).split('/').slice(1));
    const h = String(r.harness);
    const calls = h === 'openclaw' ? openclawCalls(dir) : h === 'hermes' ? hermesCalls(dir) : h === 'qm' ? qmCalls(dir) : [];
    const source = h === 'openclaw' ? 'openclaw-agent.sqlite transcript_events' : h === 'hermes' ? 'logs/turns/*.hermes.jsonl' : h === 'qm' ? 'logs/qm-db.sql.gz public.items' : 'logs/turns/*.' + (h === 'codex' ? 'codex' : 'claude') + '.jsonl';
    const traceLines = ['claude-code', 'codex'].includes(h) && existsSync(join(dir, 'logs', 'turns')) ? readdirSync(join(dir, 'logs', 'turns')).filter((f) => f.endsWith(h === 'codex' ? '.codex.jsonl' : '.claude.jsonl')).length : null;
    const g = gstackReads(h, calls.length ? [body(calls)] : [], dir);
    rows.push({ trial_id: r.trial_id, cell: r.cell, harness: h, model: r.model, dest, source, rebuilt_calls: calls.length, trace_files: traceLines, trial_dir_present: existsSync(dir), ...g });
  }
}
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
const per = new Map<string, { trials: number; contaminated: number; reads: number; no_trace: number }>();
for (const r of rows) {
  const k = String(r.cell);
  const e = per.get(k) ?? { trials: 0, contaminated: 0, reads: 0, no_trace: 0 };
  e.trials++; if (r.contaminated) e.contaminated++; e.reads += Number(r.gstack_reads);
  if ((['openclaw', 'hermes', 'qm'].includes(String(r.harness)) && !r.rebuilt_calls) || r.trace_files === 0) e.no_trace++;
  per.set(k, e);
}
for (const [k, e] of [...per.entries()].sort()) console.log(k + '\ttrials=' + e.trials + '\tcontaminated=' + e.contaminated + '\tgstack_reads=' + e.reads + '\tno_tool_calls_recovered=' + e.no_trace);
