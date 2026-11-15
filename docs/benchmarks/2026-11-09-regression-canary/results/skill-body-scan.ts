
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const T = process.argv[2];
const recs = readFileSync(join(T, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const skills = new Set<string>();
for (const f of readdirSync(join(T, 'arms'))) if (f.endsWith('.json')) for (const s of (JSON.parse(readFileSync(join(T, 'arms', f), 'utf8')).skills ?? [])) { skills.add(s); skills.add(String(s).replace(/^gstack-/, '')); }
const parsed = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
const asText = (v: any): string => typeof v === 'string' ? v : Array.isArray(v) ? v.map(asText).filter(Boolean).join('\n') : v && typeof v === 'object' ? asText(v.text ?? v.content ?? v.output ?? '') : '';
const outputsIn = (v: any): string[] => Array.isArray(v) ? v.flatMap(outputsIn) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => (k === 'output' && typeof x === 'string' ? [x] : outputsIn(x))) : [];
const FM = /^---[ \t]*\r?\n(?:(?!---)[^\n]*\n)*?name:[ \t]*['"]?([\w.-]+)/gm;
function bodies(t: string): string[] { const all = [t, ...t.split('\n').flatMap((l) => l.trimStart().startsWith('{') ? outputsIn(parsed(l)) : [])].join('\n').replace(/^[ \t]*\d+(?:\t|→|\|)/gm, ''); return [...all.matchAll(FM)].map((m) => m[1]!).filter((n) => skills.has(n) || skills.has(n.replace(/^gstack-/, ''))); }
const rows: any[] = [];
for (const r of recs) {
  const arm = r.canary?.arm; if (!arm || arm === 'plain') { if (arm !== 'plain') continue; }
  const cap = [join(T, 'shard', r.paths.trial_dir, 'harbor', 'proxy-capture', 'proxy-requests.ndjson'), join(T, 'shard', r.paths.trial_dir, 'proxy-capture', 'proxy-requests.ndjson')].find(existsSync);
  const seen = new Set<string>(); const got = new Set<string>(); let resultsSeen = 0;
  if (cap) for (const line of readFileSync(cap, 'utf8').split('\n')) {
    const e = parsed(line); if (!e) continue; const body = typeof e.body === 'string' ? parsed(e.body) : e.body; if (!body) continue;
    const items: Array<[string, string]> = [];
    for (const m of body.messages ?? []) { if (typeof m?.content === 'string' && m.role === 'tool') items.push([String(m.tool_call_id), m.content]); else if (Array.isArray(m?.content)) for (const b of m.content) if (b?.type === 'tool_result') items.push([String(b.tool_use_id), asText(b.content)]); }
    for (const it of body.input ?? []) if (String(it?.type ?? '').endsWith('_call_output')) items.push([String(it.call_id), asText(it.output)]);
    for (const [id, t] of items) { if (seen.has(id)) continue; seen.add(id); resultsSeen++; for (const n of bodies(t)) got.add(n); }
  }
  rows.push({ model: r.canary.model_key, arm, task: r.canary.task, attempt: r.canary.attempt, cap: !!cap, results: resultsSeen, product_calls: r.canary.exposure?.product_calls ?? null, bodies: [...got].sort() });
}
console.log(JSON.stringify(rows));
