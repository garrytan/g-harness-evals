// internal-task check: does got-skill.ts count OpenClaw's skills_read when called through tool_call {id, args}? Rebuilds each
// OpenClaw set T trial's calls as an Anthropic Messages body (as sett-clean-arm-audit.ts does) and runs got-skill.ts gotSkill on it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

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



import { gotSkill } from '../../../../../scripts/skill-resolver/got-skill.ts';

const catalog = readdirSync(process.env.CATALOG_SKILLS ?? '.skill-resolver/catalog/skills');
const out: Record<string, Record<string, number>> = {};
for (const dest of process.argv.slice(2)) for (const l of readFileSync(join(dest, 'trials.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue; const r = JSON.parse(l); if (r.harness !== 'openclaw') continue;
  const calls = openclawCalls(join(dest, 'trials', ...String(r.trial_id).split('/').slice(1)));
  const viaToolCall = calls.filter((c) => c.name === 'tool_call' && /(^|:)skills_read$/.test(String((c.input as any)?.id ?? '')) && !c.is_error && catalog.includes(String((c.input as any)?.args?.name ?? '')));
  const g = gotSkill({ harness: 'openclaw', catalog, requests: [body(calls)] });
  const counted = new Set(g.catalog_opened);
  const missed = viaToolCall.filter((c) => !counted.has(String((c.input as any).args.name)));
  const e = (out[r.cell] ??= { trials: 0, trials_with_tool_call_skills_read: 0, trials_got_skill_counts_any_open: 0, trials_with_an_uncounted_skills_read: 0, trials_whose_only_opens_are_uncounted: 0 });
  e.trials++;
  if (viaToolCall.length) e.trials_with_tool_call_skills_read++;
  if (counted.size) e.trials_got_skill_counts_any_open++;
  if (missed.length) e.trials_with_an_uncounted_skills_read++;
  if (missed.length && !counted.size) e.trials_whose_only_opens_are_uncounted++;
}
console.log(JSON.stringify(out, null, 1));
