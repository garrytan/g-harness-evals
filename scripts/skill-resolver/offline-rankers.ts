#!/usr/bin/env bun
// Offline ranker arms for the skill-resolver eval (internal-task, Phase A, docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md).
//
//   bun scripts/skill-resolver/offline-rankers.ts --catalog <dir|catalog.jsonl> --set <set.jsonl> --labels <labels.jsonl>
//       --openclaw-dist <openclaw package dir>/dist --out <dir> [--half dev|test|all] [--emb <vectors.json>]
//       [--resolver <ranks.jsonl>] [--private]
//
// Scores each arm's ranking of the whole catalog against the frozen acceptable sets (skill-needing rows only):
//   alpha            the catalog in name order (OpenClaw's and QM's no-query order); alpha_in_80 and alpha_in_150 report
//                    whether an acceptable skill falls inside OpenClaw's first 80 (Wintermute's cap) or 150 (default)
//   openclaw_search  OpenClaw 2026.10.6's skills_search scoring, imported from its own dist (tool-search-index):
//                    name+description weighted 2x plus SKILL.md bodies up to 16,384 bytes (no bodies for a .jsonl catalog)
//   qm_search        QM main@90e4ced7's skills search (src/skills/materialize.ts rankedSkills): count of query words in
//                    name+description, ties by name
//   bm25_nd          BM25 over name and description;  bm25f  BM25F over name (x3), description (x2) and body (x1)
//   emb, rrf_bm25_emb  cosine on --emb vectors (scripts/skill-resolver/embed.mjs), and reciprocal-rank fusion with bm25_nd
//   resolver         ranks from the pinned GBrain resolver (--resolver, one {id, ranked:[names]} row per request)
// Every arm ranks on the text the labels were judged on (queryText): the request alone, or, for a row with prev_user_text (set R),
// "Previous message from the same user: ... Current message: ..." (runner/trial/skill-requests.ts composeRequest, the same text
// label-set.ts gives the judge). --emb vectors must be built on that text too (embed.mjs does).
// Metrics: hit@1/3/5/8 (an acceptable skill in the top k) and MRR (first acceptable rank). --private writes no per-row
// file (set R). Output: <out>/offline.json and <out>/offline.md; without --private also <out>/ranks.jsonl.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeRequest } from '../../runner/trial/skill-requests.ts';

type Skill = { name: string; description: string; body: string };
type Row = { id: string; request?: string; text?: string; prev_user_text?: string | null };
/** The text a row is ranked on: what the judge saw (composeRequest), the request alone when the row has no previous message. */
export const queryText = (r: Row) => composeRequest(r.request ?? r.text ?? '', r.prev_user_text || null);
type Label = { id: string; final: { no_skill_needed: boolean; acceptable: string[] } };

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1);

export function bm25(docs: string[][], k1 = 1.2, b = 0.75) {
  const N = docs.length; const df = new Map<string, number>(); const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const tf = docs.map((d) => { const m = new Map<string, number>(); for (const w of d) m.set(w, (m.get(w) ?? 0) + 1); return m; });
  return (q: string[]) => docs.map((d, i) => {
    let s = 0;
    for (const w of new Set(q)) { const n = df.get(w); if (!n) continue; const f = tf[i]!.get(w) ?? 0; s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg)); }
    return s;
  });
}

export function bm25f(fields: { docs: string[][]; weight: number; b: number }[], k1 = 1.2) {
  const N = fields[0]!.docs.length; const df = new Map<string, number>();
  for (let i = 0; i < N; i++) for (const w of new Set(fields.flatMap((f) => f.docs[i]!))) df.set(w, (df.get(w) ?? 0) + 1);
  const avg = fields.map((f) => f.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N));
  const tfs = fields.map((f) => f.docs.map((d) => { const m = new Map<string, number>(); for (const w of d) m.set(w, (m.get(w) ?? 0) + 1); return m; }));
  return (q: string[]) => Array.from({ length: N }, (_, i) => {
    let s = 0;
    for (const w of new Set(q)) {
      const n = df.get(w); if (!n) continue;
      const tf = fields.reduce((acc, f, j) => acc + f.weight * (tfs[j]![i]!.get(w) ?? 0) / (1 - f.b + f.b * f.docs[i]!.length / (avg[j] || 1)), 0);
      s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * tf / (k1 + tf);
    }
    return s;
  });
}

const order = (scores: number[], names: string[]) => names.map((n, i) => ({ n, s: scores[i]! })).sort((a, b) => b.s - a.s || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)).map((x) => x.n);

const QM_IGNORED = new Set('a an and are as at be by can do for from have help i in is it me my of on or please that the this to today use want what with you your'.split(' '));
const segWords = (t: string) => new Set([...new Intl.Segmenter('en', { granularity: 'word' }).segment(t.toLowerCase())].filter((p) => p.isWordLike).map((p) => p.segment));
export function qmSearch(skills: Skill[], query: string): string[] {
  const q = [...segWords(query)].filter((w) => !QM_IGNORED.has(w));
  return skills.map((s) => { const t = segWords(s.name + ' ' + s.description); return { n: s.name, r: q.filter((w) => t.has(w)).length }; })
    .sort((a, b) => b.r - a.r || a.n.localeCompare(b.n)).map((x) => x.n);
}

export function rrf(...lists: string[][]): string[] {
  const s = new Map<string, number>();
  for (const l of lists) l.slice(0, 100).forEach((n, p) => s.set(n, (s.get(n) ?? 0) + 1 / (60 + p)));
  const rest = lists[0]!.filter((n) => !s.has(n));
  return [...[...s].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n), ...rest];
}

export function score(ranked: string[], acceptable: string[]) {
  const acc = new Set(acceptable); const first = ranked.findIndex((n) => acc.has(n));
  return { rank: first < 0 ? null : first + 1, hit: (k: number) => first >= 0 && first < k };
}

function loadCatalog(path: string): { skills: Skill[]; bodies: boolean } {
  if (path.endsWith('.jsonl')) return { skills: readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return { name: r.name, description: r.description ?? '', body: '' }; }), bodies: false };
  const m = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as { skills: { name: string; description: string }[] };
  return { skills: m.skills.map((s) => ({ ...s, body: readFileSync(join(path, 'skills', s.name, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?\n---\n?/, '') })), bodies: true };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const [catalogPath, setPath, labelsPath, dist, out] = ['--catalog', '--set', '--labels', '--openclaw-dist', '--out'].map((k) => v(k));
  if (!catalogPath || !setPath || !labelsPath || !dist || !out) { console.error('usage: offline-rankers.ts --catalog <c> --set <s> --labels <l> --openclaw-dist <d> --out <o> [--half] [--emb] [--resolver] [--private]'); process.exit(2); }
  const half = v('--half', 'all'); const priv = a.includes('--private');
  const { skills, bodies } = loadCatalog(catalogPath);
  const names = skills.map((s) => s.name);
  const labels = new Map(readFileSync(labelsPath, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l) as Label; return [r.id, r]; }));
  const rows = readFileSync(setPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row & { half?: string })
    .filter((r) => (half === 'all' || r.half === half) && labels.has(r.id) && !labels.get(r.id)!.final.no_skill_needed);
  const ts = await import(join(dist, 'tool-search-index-Dh36KPbY.mjs')) as any;
  const ocIndex = ts.t(skills.map((s) => s.name + ' ' + s.description));
  const ocBodies = bodies ? ts.t(skills.map((s) => Buffer.from(s.body).subarray(0, 16384).toString('utf8'))) : null;
  const ocSearch = (q: string) => {
    const terms = [...new Set(ts.i(q.slice(0, 2000)))].map((term) => ({ term, weight: 1 }));
    const sc = new Array(skills.length).fill(0);
    for (const { value, score } of ts.r(ocIndex, terms)) sc[value] += score * 2;
    if (ocBodies) for (const { value, score } of ts.r(ocBodies, terms)) sc[value] += score;
    return order(sc, names);
  };
  const ndDocs = skills.map((s) => words(s.name.replace(/-/g, ' ') + ' ' + s.description));
  const bmND = bm25(ndDocs);
  const bmF = bm25f([{ docs: skills.map((s) => words(s.name.replace(/-/g, ' '))), weight: 3, b: 0.3 }, { docs: skills.map((s) => words(s.description)), weight: 2, b: 0.5 }, { docs: skills.map((s) => words(s.body)), weight: 1, b: 0.75 }]);
  const emb = v('--emb') ? JSON.parse(readFileSync(v('--emb')!, 'utf8')) as { skills: Record<string, number[]>; queries: Record<string, number[]> } : null;
  const resolver = v('--resolver') ? new Map(readFileSync(v('--resolver')!, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r.ranked as string[]]; })) : null;
  const alpha = [...names].sort((x, y) => x.localeCompare(y, 'en'));
  const arms: Record<string, (r: Row) => string[]> = {
    alpha: () => alpha, openclaw_search: (r) => ocSearch(queryText(r)), qm_search: (r) => qmSearch(skills, queryText(r)),
    bm25_nd: (r) => order(bmND(words(queryText(r))), names), bm25f: (r) => order(bmF(words(queryText(r))), names),
  };
  if (emb) {
    const embRank = (r: Row) => { const q = emb.queries[r.id]!; return order(names.map((n) => emb.skills[n]!.reduce((s, x, i) => s + x * q[i]!, 0)), names); };
    arms.emb = embRank; arms.rrf_bm25_emb = (r) => rrf(arms.bm25_nd!(r), embRank(r));
  }
  if (resolver) arms.resolver = (r) => resolver.get(r.id) ?? [];
  const K = [1, 3, 5, 8];
  const result: any = { catalog: catalogPath.endsWith('.jsonl') ? 'jsonl' : 'dir', skills: skills.length, bodies, half, n: rows.length, arms: {} };
  const perRow: any[] = [];
  for (const [arm, f] of Object.entries(arms)) {
    const ranks = rows.map((r) => score(f(r), labels.get(r.id)!.final.acceptable).rank);
    result.arms[arm] = Object.fromEntries([...K.map((k) => ['hit@' + k, Number((ranks.filter((x) => x !== null && x <= k).length / rows.length).toFixed(4))]), ['mrr', Number((ranks.reduce<number>((s, x) => s + (x ? 1 / x : 0), 0) / rows.length).toFixed(4))]]);
    if (!priv) rows.forEach((r, i) => { (perRow[i] ??= { id: r.id })[arm] = ranks[i]; });
  }
  result.arms.alpha.in_first_80 = Number((rows.filter((r) => labels.get(r.id)!.final.acceptable.some((n) => alpha.indexOf(n) < 80)).length / rows.length).toFixed(4));
  result.arms.alpha.in_first_150 = Number((rows.filter((r) => labels.get(r.id)!.final.acceptable.some((n) => alpha.indexOf(n) < 150)).length / rows.length).toFixed(4));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'offline.json'), JSON.stringify(result, null, 1) + '\n');
  writeFileSync(join(out, 'offline.md'), ['| Arm | hit@1 | hit@3 | hit@5 | hit@8 | MRR |', '|---|---|---|---|---|---|', ...Object.entries(result.arms).map(([k, m]: any) => '| ' + k + ' | ' + K.map((x) => m['hit@' + x]).join(' | ') + ' | ' + m.mrr + ' |')].join('\n') + '\n\nn=' + rows.length + ' skill-needing requests; alpha in first 80: ' + result.arms.alpha.in_first_80 + ', in first 150: ' + result.arms.alpha.in_first_150 + '\n');
  if (!priv) writeFileSync(join(out, 'ranks.jsonl'), perRow.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('OFFLINE n=' + rows.length + ' ' + Object.entries(result.arms).map(([k, m]: any) => k + ':' + m['hit@5']).join(' '));
}
