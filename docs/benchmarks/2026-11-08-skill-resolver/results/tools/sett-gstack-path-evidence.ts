#!/usr/bin/env bun
// Evidence dump for internal-task check 1 (derived from sett-clean-arm-audit.ts): every set T tool call whose input names a
// skills/gstack path, with the first 400 characters of its result, so the result shows whether that path exists in the image.
// Set T clean-arm audit extractors follow. Set T records carry no skill_request.clean_arm, so this applies the
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
import { callsFromTrace } from '../../../../../scripts/skill-resolver/got-skill.ts';

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
const hits: Array<Record<string, unknown>> = [];
for (const dest of dests) {
  for (const l of readFileSync(join(dest, 'trials.jsonl'), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    const dir = join(dest, 'trials', ...String(r.trial_id).split('/').slice(1));
    const h = String(r.harness);
    let calls: Array<{ name: string; input: unknown; result?: string; ok?: boolean | null }> = h === 'openclaw' ? openclawCalls(dir) : h === 'hermes' ? hermesCalls(dir) : h === 'qm' ? qmCalls(dir) : [];
    if (h === 'claude-code' || h === 'codex') {
      const t = join(dir, 'logs', 'turns');
      const ext = h === 'codex' ? '.codex.jsonl' : '.claude.jsonl';
      calls = existsSync(t) ? readdirSync(t).filter((f) => f.endsWith(ext)).sort().flatMap((f) => callsFromTrace(readFileSync(join(t, f), 'utf8').split('\n'))) : [];
    }
    for (const c of calls) {
      const inp = JSON.stringify(c.input ?? '');
      if (!/\.claude\/skills\/gstack|\.local\/share\/gstack|\.capy\/drive/.test(inp)) continue;
      hits.push({ trial_id: r.trial_id, harness: h, tool: c.name, input: inp.slice(0, 400), result: String(c.result ?? '').slice(0, 400), result_lines_naming_gstack_or_claude: String(c.result ?? '').split('\n').filter((x) => /\.claude|gstack|denied|No such file|not found/i.test(x)).map((x) => x.slice(0, 300)).slice(0, 12), ok: (c as any).ok ?? null });
    }
  }
}
writeFileSync(out, JSON.stringify(hits, null, 1) + '\n');
const by = new Map<string, number>();
for (const x of hits) by.set(String(x.harness), (by.get(String(x.harness)) ?? 0) + 1);
console.log('calls naming a gstack install path: ' + hits.length + ' ' + JSON.stringify(Object.fromEntries(by)));
