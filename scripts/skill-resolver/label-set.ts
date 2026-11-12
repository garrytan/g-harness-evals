#!/usr/bin/env bun
// Labels a request set with blind judges for the skill-resolver eval (internal-task, docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md).
//
//   bun scripts/skill-resolver/label-set.ts --catalog <dir> --set <set.jsonl> --out <dir> [--judges opus,sol] [--half dev|test|all]
//       [--lease-usd 60] [--run-id <id>]
//
// A judge sees one request and the catalog (every skill's name and full description), never what any agent read. Pass 1
// returns no_skill_needed or up to 8 candidate skills; pass 2 shows the judge the candidates' SKILL.md (first 4,000
// characters each) and returns the acceptable set: the skills a competent agent could open and follow for this request,
// any one of which is a correct pick. With two judges, a request where they disagree (no_skill flag or set) gets a third
// Opus pass that sees both answers and the union of their candidates and gives the final label. Set R runs with
// --judges opus only (decision 1A: Anthropic only), with --catalog naming a catalog.jsonl of {name, description} rows (no
// bodies, so pass 2 shows descriptions) and rows carrying text and prev_user_text, which the judge sees as context. Output: <out>/labels.jsonl and <out>/labels-summary.json (counts,
// agreement, spend). Calls go through the metering proxy under a lease (scripts/v03/llm.ts); responses are cached.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLlm, LlmError, type Llm, type ModelId } from '../v03/llm.ts';
import type { Manifest } from './build-catalog.ts';

type Row = { id: string; request?: string; text?: string; prev_user_text?: string | null; half?: string };
type Verdict = { no_skill_needed: boolean; acceptable: string[]; candidates: string[]; reason?: string };
const MODELS: Record<string, ModelId> = { opus: 'anthropic:claude-opus-5-5', sol: 'openai:gpt-6.1-sol', astra: 'openai:gpt-6-astra' };

const SYSTEM = 'You label evaluation data. An AI agent has a catalog of skills (instruction files for kinds of jobs). For a user request you decide which skills, if any, the agent should open and follow. Judge only from the request and the skills; answer with one JSON object and nothing else.';

export function parseJson(text: string): any {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON object');
  return JSON.parse(text.slice(s, e + 1));
}

export const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a); const B = new Set(b); const u = new Set([...A, ...B]).size;
  return u ? [...A].filter((x) => B.has(x)).length / u : 1;
};

async function judge(llm: Llm, model: ModelId, listing: string, names: Set<string>, bodies: (n: string) => string, req: string): Promise<Verdict> {
  const cachePrefix = 'Skill catalog (name: description):\n' + listing + '\n\n';
  const p1 = parseJson(await llm.complete({ model, system: SYSTEM, maxTokens: 4000, cachePrefix, prompt: cachePrefix + [
    'Request:', req, '',
    'Return {"no_skill_needed": true|false, "candidates": [up to 8 skill names from the catalog, best first]}. no_skill_needed is true when a competent assistant should answer directly without opening any skill. Otherwise list every skill that might be the right one to open.',
  ].join('\n') }));
  const candidates = (Array.isArray(p1.candidates) ? p1.candidates : []).filter((n: unknown) => typeof n === 'string' && names.has(n)).slice(0, 8) as string[];
  if (p1.no_skill_needed === true && !candidates.length) return { no_skill_needed: true, acceptable: [], candidates };
  const p2 = parseJson(await llm.complete({ model, system: SYSTEM, maxTokens: 4000, prompt: [
    'Request:', req, '',
    'Candidate skills (start of each SKILL.md):', ...candidates.map((n) => '=== ' + n + ' ===\n' + bodies(n)), '',
    'Return {"no_skill_needed": true|false, "acceptable": [names from the candidates], "reason": "one sentence"}. acceptable lists every candidate a competent agent could open and follow for this request so that the job is done the intended way; any one of them counts as a correct pick. Leave out skills that are only loosely related. If none fits, return no_skill_needed true and an empty list.',
  ].join('\n') }));
  const acceptable = (Array.isArray(p2.acceptable) ? p2.acceptable : []).filter((n: unknown) => typeof n === 'string' && candidates.includes(n as string)) as string[];
  return { no_skill_needed: p2.no_skill_needed === true || !acceptable.length, acceptable: p2.no_skill_needed === true ? [] : acceptable.sort(), candidates, reason: String(p2.reason ?? '').slice(0, 300) };
}

async function reconcile(llm: Llm, bodies: (n: string) => string, req: string, a: Verdict, b: Verdict): Promise<Verdict> {
  const pool = [...new Set([...a.candidates, ...b.candidates])];
  const r = parseJson(await llm.complete({ model: MODELS.opus!, system: SYSTEM, maxTokens: 4000, prompt: [
    'Request:', req, '',
    'Two labellers disagreed. Labeller A: ' + JSON.stringify({ no_skill_needed: a.no_skill_needed, acceptable: a.acceptable }) + '. Labeller B: ' + JSON.stringify({ no_skill_needed: b.no_skill_needed, acceptable: b.acceptable }) + '.', '',
    'Candidate skills (start of each SKILL.md):', ...pool.map((n) => '=== ' + n + ' ===\n' + bodies(n)), '',
    'Give the final label: {"no_skill_needed": true|false, "acceptable": [names from the candidates], "reason": "one sentence"}, by the same rule: every skill a competent agent could open and follow so the job is done the intended way.',
  ].join('\n') }));
  const acceptable = (Array.isArray(r.acceptable) ? r.acceptable : []).filter((n: unknown) => typeof n === 'string' && pool.includes(n as string)) as string[];
  return { no_skill_needed: r.no_skill_needed === true || !acceptable.length, acceptable: r.no_skill_needed === true ? [] : acceptable.sort(), candidates: pool, reason: String(r.reason ?? '').slice(0, 300) };
}

export async function label(o: { catalog: string; set: string; out: string; judges: string[]; half: string; leaseUsd: number; runId: string }) {
  const jsonl = o.catalog.endsWith('.jsonl');
  const m = jsonl
    ? { catalog_hash: createHash('sha256').update(readFileSync(o.catalog)).digest('hex'), skills: readFileSync(o.catalog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { name: string; description: string }) }
    : JSON.parse(readFileSync(join(o.catalog, 'manifest.json'), 'utf8')) as Pick<Manifest, 'catalog_hash' | 'skills'>;
  const names = new Set(m.skills.map((s) => s.name));
  const descriptions = new Map(m.skills.map((s) => [s.name, s.description]));
  const listing = m.skills.map((s) => '- ' + s.name + ': ' + s.description.replace(/\s+/g, ' ')).join('\n');
  const bodies = (n: string) => jsonl ? '(only the description is available)\n' + descriptions.get(n) : readFileSync(join(o.catalog, 'skills', n, 'SKILL.md'), 'utf8').slice(0, 4000);
  const text = (r: Row) => (r.prev_user_text ? 'Previous message from the same user: ' + r.prev_user_text + '\n\nCurrent message: ' : '') + (r.request ?? r.text ?? '');
  const rows = readFileSync(o.set, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row).filter((r) => o.half === 'all' || r.half === o.half);
  mkdirSync(o.out, { recursive: true });
  const llm = await createLlm({ cacheDir: join(o.out, 'cache'), proxy: { dir: join(o.out, 'proxy', o.runId), leaseUsd: o.leaseUsd, runId: o.runId } });
  const out: any[] = [];
  const errors: { id: string; error: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < rows.length) {
      const r = rows[next++]!;
      try {
        const v: Record<string, Verdict> = {};
        for (const j of o.judges) v[j] = await judge(llm, MODELS[j]!, listing, names, bodies, text(r));
        let final = v[o.judges[0]!]!; let agreement = null; let reconciled = false;
        if (o.judges.length === 2) {
          const [a, b] = [v[o.judges[0]!]!, v[o.judges[1]!]!];
          agreement = { flag_agree: a.no_skill_needed === b.no_skill_needed, jaccard: Number(jaccard(a.acceptable, b.acceptable).toFixed(4)) };
          if (!(agreement.flag_agree && agreement.jaccard === 1)) { final = await reconcile(llm, bodies, text(r), a, b); reconciled = true; }
        }
        out.push({ id: r.id, half: r.half ?? null, judges: v, agreement, reconciled, final: { no_skill_needed: final.no_skill_needed, acceptable: final.acceptable } });
      } catch (e) { errors.push({ id: r.id, error: e instanceof LlmError ? e.code : (e as Error).message.slice(0, 200) }); }
    }
  }));
  const stats = await llm.close();
  out.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(o.out, 'labels.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const two = out.filter((r) => r.agreement);
  const summary = {
    catalog_hash: m.catalog_hash, set: o.set, half: o.half, judges: o.judges, labelled: out.length, errors,
    no_skill_needed: out.filter((r) => r.final.no_skill_needed).length,
    mean_acceptable: Number((out.filter((r) => !r.final.no_skill_needed).reduce((s, r) => s + r.final.acceptable.length, 0) / Math.max(1, out.filter((r) => !r.final.no_skill_needed).length)).toFixed(3)),
    agreement: two.length ? { flag_agree: two.filter((r) => r.agreement.flag_agree).length / two.length, mean_jaccard: two.reduce((s, r) => s + r.agreement.jaccard, 0) / two.length, reconciled: out.filter((r) => r.reconciled).length } : null,
    llm: stats,
  };
  writeFileSync(join(o.out, 'labels-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const catalog = v('--catalog'); const set = v('--set'); const out = v('--out');
  if (!catalog || !set || !out) { console.error('usage: label-set.ts --catalog <dir> --set <jsonl> --out <dir> [--judges opus,sol] [--half dev|test|all] [--lease-usd 60] [--run-id <id>]'); process.exit(2); }
  const judges = v('--judges', 'opus,sol')!.split(',');
  if (judges.some((j) => !MODELS[j])) { console.error('HE-SKILLS-003 unknown judge'); process.exit(2); }
  try {
    const s = await label({ catalog, set, out, judges, half: v('--half', 'all')!, leaseUsd: Number(v('--lease-usd', '60')), runId: v('--run-id', 'label-1')! });
    console.log('LABELS n=' + s.labelled + ' errors=' + s.errors.length + ' no_skill=' + s.no_skill_needed + ' mean_acceptable=' + s.mean_acceptable + ' agreement=' + JSON.stringify(s.agreement) + ' usd=' + s.llm.usd);
  } catch (e) { console.error('HE-SKILLS-004 ' + (e instanceof LlmError ? e.code : (e as Error).message)); process.exit(2); }
}
