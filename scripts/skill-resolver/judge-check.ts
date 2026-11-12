#!/usr/bin/env bun
// R78 judge check for the skill-resolver eval (internal-task, docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md).
//
//   bun scripts/skill-resolver/judge-check.ts --catalog <dir> --set <setp-dev.jsonl> --labels <labels.jsonl> --astra <labels-astra.jsonl>
//       [--pairs <opened.jsonl>] [--results <pilot results dir>] [--n 120] [--seed 20261108] [--lease-usd 25] [--run-id <id>] [--ledger <file>]
//       [--max-output-tokens <n>] [--pool <name>] [--prior <grades.jsonl>] [--cache <dir>] --out <dir>
//
// --ledger and --max-output-tokens let the check spend under a lease another run opened (a pilot's): the same ledger file,
// --run-id the lease id, --lease-usd and --max-output-tokens what that lease was opened with.
//
// Got the skill is scored against judge labels, so the labels are checked before any number gates a verdict. The unit is
// one output: a (request, skill) pair, meaning "an agent opened this skill for this request". Pairs come from set P dev rows
// only, never the sealed test half: every pair in --pairs (skills agents opened in the pilot, {id, skill}), then a seeded
// draw split evenly over three pools until --n: skills either label source accepts, candidates a judge considered and
// rejected, and the resolver's top suggestion on rows every label source calls no_skill_needed. The suggestions come from the
// pilot's trial records under --results (each trial's logs/skill-resolver/status.ndjson, pushed blocks and shadow logs alike:
// suggestions[0] of every status line), deduplicated by (request, skill); without --results that pool is empty, because the
// labels carry no candidates on no_skill_needed rows. Two graders, openai:gpt-6-astra and
// anthropic:claude-opus-5-5 (Garry's R78 amendment, "Use Astra vs opus"), each see the request and that one SKILL.md
// (first 8,000 characters) and answer whether opening it is correct. A pair is gold only when both agree. Each label source
// (the Astra labels, the Opus labels, the Sol labels and the panel final) is then scored against gold: catch rate (gold-bad
// pairs the source rejects), false-fail rate (gold-good pairs it rejects) and Cohen's kappa. The graders are the same models
// as two label sources, with a different prompt (one skill, its full body, no catalog listing); the report says so.
// Calls go through the metering proxy under a lease (scripts/v03/llm.ts) and responses are cached (<out>/cache, or --cache).
// --pool grades one pool only, the whole pool whatever --n says; --prior adds an earlier pass's grades.jsonl to the gold the
// label sources are scored on (pairs graded again here replace theirs), and graded_here scores this pass's pairs alone.
// Output: <out>/judge-check.json (the shape analyze.ts --judge-check reads) and <out>/grades.jsonl.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLlm, LlmError, type Llm, type ModelId, type Transport } from '../v03/llm.ts';
import { parseJson } from './label-set.ts';

export const GRADERS: ModelId[] = ['openai:gpt-6-astra', 'anthropic:claude-opus-5-5'];
export const MIN_GOLD = 40;
type Core = { no_skill_needed: boolean; acceptable: string[]; candidates?: string[] };
export type Pair = { id: string; skill: string; pool: string };
export type Sources = Record<string, Map<string, Core>>;

const SYSTEM = 'You check evaluation labels. An AI agent has a catalog of skills (instruction files for kinds of jobs). For one user request and one skill, you decide whether opening and following that skill is a correct way to handle the request. Answer with one JSON object and nothing else.';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
const accepts = (c: Core | undefined, skill: string) => !!c && !c.no_skill_needed && c.acceptable.includes(skill);

/** Seeded, dev-only sample: given pairs first, then an even draw from accepted, rejected-candidate and no-skill pools. */
export const POOLS = ['opened', 'accepted', 'rejected candidate', 'no-skill row'];

/** The resolver's top suggestion on every turn of every recorded trial, pushed or shadow, as (request, skill) pairs, deduplicated. */
export function topSuggestions(results: string): Array<{ id: string; skill: string }> {
  const seen = new Map<string, { id: string; skill: string }>();
  for (const r of readJsonl(join(results, 'trials.jsonl')) as Array<{ trial_id: string; skill_request?: { request_id: string } }>) {
    if (!r.skill_request) continue;
    const status = join(results, 'trials', ...r.trial_id.split('/').slice(1), 'logs', 'skill-resolver', 'status.ndjson');
    if (!existsSync(status)) continue;
    for (const s of readJsonl(status) as Array<{ suggestions?: unknown }>) {
      const top = Array.isArray(s.suggestions) ? s.suggestions[0] : undefined;
      if (typeof top === 'string') seen.set(r.skill_request.request_id + '|' + top, { id: r.skill_request.request_id, skill: top });
    }
  }
  return [...seen.values()];
}

export function samplePairs(o: { dev: Set<string>; sources: Sources; given: Array<{ id: string; skill: string }>; suggested?: Array<{ id: string; skill: string }>; n: number; seed: number; pool?: string }): Pair[] {
  const r = rng(o.seed);
  const seen = new Set<string>();
  const out: Pair[] = [];
  const add = (p: Pair) => { const k = p.id + '|' + p.skill; if (!o.dev.has(p.id) || seen.has(k)) return false; seen.add(k); out.push(p); return true; };
  for (const g of o.given) add({ ...g, pool: 'opened' });
  const ids = [...o.dev].sort();
  const all = Object.values(o.sources);
  const accepted: Pair[] = [], rejected: Pair[] = [], none: Pair[] = [];
  const suggested = new Map<string, Set<string>>();
  for (const s of o.suggested ?? []) suggested.set(s.id, (suggested.get(s.id) ?? new Set()).add(s.skill));
  for (const id of ids) {
    const cs = all.map((m) => m.get(id)).filter(Boolean) as Core[];
    if (!cs.length) continue;
    const acc = new Set(cs.flatMap((c) => (c.no_skill_needed ? [] : c.acceptable)));
    for (const s of acc) accepted.push({ id, skill: s, pool: 'accepted' });
    const cand = new Set(cs.flatMap((c) => c.candidates ?? []));
    for (const s of cand) if (!acc.has(s)) rejected.push({ id, skill: s, pool: 'rejected candidate' });
    if (cs.every((c) => c.no_skill_needed)) for (const s of suggested.get(id) ?? []) none.push({ id, skill: s, pool: 'no-skill row' });
  }
  const pools = [shuffle(accepted, r), shuffle(rejected, r), shuffle(none, r)];
  if (o.pool) {
    if (o.pool === 'opened') return out;
    const p = pools[POOLS.indexOf(o.pool) - 1];
    if (!p) throw new Error('HE-SKILLS-004 unknown pool ' + o.pool + '; pools: ' + POOLS.join(', '));
    return p;
  }
  let i = 0;
  while (out.length < o.n && pools.some((p) => p.length)) { const p = pools[i++ % 3]!; const x = p.shift(); if (x) add(x); }
  return out;
}

/** Cohen's kappa for two binary raters over the same items. */
export function kappa(a: boolean[], b: boolean[]): number | null {
  const n = a.length;
  if (!n) return null;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pa = a.filter(Boolean).length / n, pb = b.filter(Boolean).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? (po === 1 ? 1 : null) : Number(((po - pe) / (1 - pe)).toFixed(4));
}

/** Scores each label source against the gold pairs. */
export function scoreSources(gold: Array<Pair & { good: boolean }>, sources: Sources, judges: Record<string, string>) {
  const out: Record<string, { judge: string; kappa: number | null; catch_rate: number | null; false_fail_rate: number | null; n_bad: number; n_good: number }> = {};
  for (const [name, m] of Object.entries(sources)) {
    const g = gold.filter((p) => m.has(p.id));
    const pred = g.map((p) => accepts(m.get(p.id), p.skill));
    const bad = g.filter((p) => !p.good), good = g.filter((p) => p.good);
    const caught = bad.filter((p) => !accepts(m.get(p.id), p.skill)).length;
    const failed = good.filter((p) => !accepts(m.get(p.id), p.skill)).length;
    out[name] = { judge: judges[name] ?? name, kappa: kappa(pred, g.map((p) => p.good)), catch_rate: bad.length ? Number((caught / bad.length).toFixed(4)) : null,
      false_fail_rate: good.length ? Number((failed / good.length).toFixed(4)) : null, n_bad: bad.length, n_good: good.length };
  }
  return out;
}

export async function grade(llm: Llm, model: ModelId, request: string, skill: string, body: string): Promise<boolean> {
  const r = parseJson(await llm.complete({ model, system: SYSTEM, maxTokens: 2000, prompt: [
    'Request:', request, '', 'Skill: ' + skill, '=== SKILL.md (start) ===', body, '=== end ===', '',
    'Return {"correct": true|false, "reason": "one sentence"}. correct is true when a competent agent could open and follow this skill for this request so the job is done the intended way. A skill that is only loosely related is not correct. If the request needs no skill at all, opening any skill is not correct.',
  ].join('\n') }));
  if (typeof r.correct !== 'boolean') throw new LlmError('E_BAD_GRADE');
  return r.correct;
}

const readJsonl = (f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

export async function judgeCheck(o: { catalog: string; set: string; labels: string; astra: string; pairs?: string; results?: string; n: number; seed: number; out: string; leaseUsd: number; runId: string; ledger?: string; maxOutputTokens?: number; pool?: string; prior?: string; cache?: string; transport?: Transport }) {
  const rows = readJsonl(o.set) as Array<{ id: string; request: string; half?: string }>;
  if (rows.some((r) => r.half !== 'dev')) throw new Error('HE-SKILLS-005 judge check takes set P dev rows only');
  const req = new Map(rows.map((r) => [r.id, r.request]));
  const labels = readJsonl(o.labels), astra = readJsonl(o.astra);
  const pick = (rs: any[], f: (r: any) => any) => new Map(rs.filter((r) => f(r)).map((r) => [r.id as string, f(r) as Core]));
  const sources: Sources = {
    'openai:gpt-6-astra': pick(astra, (r) => r.judges?.astra), 'anthropic:claude-opus-5-5': pick(labels, (r) => r.judges?.opus),
    'openai:gpt-6.1-sol': pick(labels, (r) => r.judges?.sol), panel: pick(labels, (r) => r.final),
  };
  const given = o.pairs ? (readJsonl(o.pairs) as Array<{ id: string; skill: string }>) : [];
  const pairs = samplePairs({ dev: new Set(req.keys()), sources, given, suggested: o.results ? topSuggestions(o.results) : [], n: o.n, seed: o.seed, pool: o.pool });
  const body = (s: string) => readFileSync(join(o.catalog, 'skills', s, 'SKILL.md'), 'utf8').slice(0, 8000);
  mkdirSync(o.out, { recursive: true });
  const llm = await createLlm({ cacheDir: o.cache ?? join(o.out, 'cache'), ...(o.transport ? { transport: o.transport } : { proxy: { dir: join(o.out, 'proxy', o.runId), leaseUsd: o.leaseUsd, runId: o.runId, ledger: o.ledger, maxOutputTokens: o.maxOutputTokens } }) });
  const grades: Array<Pair & { grades: Record<string, boolean | null> }> = [];
  const errors: Array<{ id: string; skill: string; grader: string; error: string }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < pairs.length) {
      const p = pairs[next++]!;
      const g: Record<string, boolean | null> = {};
      for (const m of GRADERS) {
        try { g[m] = await grade(llm, m, req.get(p.id)!, p.skill, body(p.skill)); }
        catch (e) { g[m] = null; errors.push({ id: p.id, skill: p.skill, grader: m, error: e instanceof LlmError ? e.code : (e as Error).message.slice(0, 120) }); }
      }
      grades.push({ ...p, grades: g });
    }
  }));
  const stats = await llm.close();
  grades.sort((a, b) => (a.id + a.skill).localeCompare(b.id + b.skill));
  const here = new Set(grades.map((g) => g.id + '|' + g.skill));
  const prior = o.prior ? (readJsonl(o.prior) as typeof grades).filter((g) => !here.has(g.id + '|' + g.skill)) : [];
  const goldOf = (gs: typeof grades) => gs.filter((g) => GRADERS.every((m) => g.grades[m] !== null) && g.grades[GRADERS[0]!] === g.grades[GRADERS[1]!]).map((g) => ({ ...g, good: g.grades[GRADERS[0]!] === true }));
  const both = [...prior, ...grades].filter((g) => GRADERS.every((m) => g.grades[m] !== null));
  const gold = goldOf([...prior, ...grades]);
  const judges = { panel: 'panel: Opus and Sol, a third Opus pass where they disagreed (label-set.ts)' };
  const hereGold = goldOf(grades);
  const result = {
    schema: 'he-skill-resolver-judge-check/1', graders: GRADERS, grader_prompt_sha256: createHash('sha256').update(SYSTEM).digest('hex'),
    note: 'gold = pairs both graders agree on; the graders are the same models as two label sources, with a different prompt (one skill, its full SKILL.md, no catalog listing)',
    set: o.set, seed: o.seed, n_pairs: pairs.length, pools: Object.fromEntries(POOLS.map((k) => [k, pairs.filter((p) => p.pool === k).length])),
    ...(o.pool ? { pool_only: o.pool } : {}), ...(o.prior ? { prior: { file: o.prior, n_pairs: prior.length } } : {}),
    n_both_graded: both.length, grader_kappa: kappa(both.map((g) => g.grades[GRADERS[0]!]!), both.map((g) => g.grades[GRADERS[1]!]!)),
    n_gold: gold.length, gold_good: gold.filter((g) => g.good).length, gold_bad: gold.filter((g) => !g.good).length, enough_gold: gold.length >= MIN_GOLD,
    sources: scoreSources(gold, sources, judges),
    ...(o.prior ? { graded_here: { n_gold: hereGold.length, gold_good: hereGold.filter((g) => g.good).length, gold_bad: hereGold.filter((g) => !g.good).length, sources: scoreSources(hereGold, sources, judges) } } : {}),
    errors, llm: stats,
  };
  writeFileSync(join(o.out, 'grades.jsonl'), grades.map((g) => JSON.stringify(g)).join('\n') + '\n');
  writeFileSync(join(o.out, 'judge-check.json'), JSON.stringify(result, null, 1) + '\n');
  return result;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const [catalog, set, labels, astra, out] = ['--catalog', '--set', '--labels', '--astra', '--out'].map((k) => v(k));
  if (!catalog || !set || !labels || !astra || !out) { console.error('usage: judge-check.ts --catalog <dir> --set <setp-dev.jsonl> --labels <labels.jsonl> --astra <labels-astra.jsonl> [--pairs <jsonl>] [--results <dir>] [--pool <name>] [--prior <grades.jsonl>] [--cache <dir>] [--n 120] [--seed 20261108] [--lease-usd 25] [--run-id <id>] [--ledger <file>] [--max-output-tokens <n>] --out <dir>'); process.exit(2); }
  try {
    const r = await judgeCheck({ catalog, set, labels, astra, pairs: v('--pairs'), results: v('--results'), pool: v('--pool'), prior: v('--prior'), cache: v('--cache'), n: Number(v('--n', '120')), seed: Number(v('--seed', '20261108')), out, leaseUsd: Number(v('--lease-usd', '25')), runId: v('--run-id', 'judge-check-1')!, ledger: v('--ledger'), maxOutputTokens: v('--max-output-tokens') ? Number(v('--max-output-tokens')) : undefined });
    console.log('JUDGE_CHECK pairs=' + r.n_pairs + ' gold=' + r.n_gold + ' (good ' + r.gold_good + ', bad ' + r.gold_bad + ') grader_kappa=' + r.grader_kappa + ' ' + Object.entries(r.sources).map(([k, s]) => k + ':kappa=' + s.kappa).join(' ') + ' errors=' + r.errors.length + ' usd=' + r.llm.usd);
  } catch (e) { console.error(e instanceof LlmError ? 'HE-SKILLS-004 ' + e.code : (e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SKILLS-004 ' + (e as Error).message.slice(0, 200)); process.exit(2); }
}
