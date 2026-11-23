#!/usr/bin/env bun
// Adjudication and the judge check for the skills-at-scale eval (internal-task plan, "Labels"; review F2; R78).
//
//   bun scripts/skills-at-scale/adjudicate.ts queue --results <merged results dir> --labels <labels-l.jsonl> --out <dir>
//   bun scripts/skills-at-scale/adjudicate.ts run --queue <queue.jsonl> --requests <setl.jsonl>... --catalog <dir> --out <dir>
//       [--lease-usd 25] [--run-id adjudicate-1] [--batch <dir>]
//   bun scripts/skills-at-scale/adjudicate.ts gold-check --gold <gold.jsonl> --labels <labels-l.jsonl> --out <judge-check.json>
//
// queue: every skill a trial opened that lies outside the acceptable set of the judge that scores that trial (Opus for
// OpenAI models, Astra for the rest), on any request, no-skill requests included, deduplicated by (request, skill) across
// arms, rungs and setups. <out>/queue.jsonl carries only {item, request_id, skill}, in a seeded order, so whoever grades it
// cannot tell which arm opened what; <out>/key.jsonl maps each item to the trials that opened it and stays with the
// analysis until unblinding.
// run: both graders (GPT-6.2 Astra and Opus 5.5, judge-check.ts grade: the request and that one SKILL.md) grade every item. An
// item is acceptable only when both say so; a split is not acceptable and is listed. <out>/adjudications.jsonl
// ({item, request_id, skill, grades, acceptable, split}) is what analyze.ts --adjudications reads; an item whose grading
// failed is left out and stays pending. --batch <dir> grades through the provider batch APIs (batch.ts), one round per run,
// exiting 3 while a batch is open; the answers land in <out>/cache.
// gold-check: R78's check of each judge against gold, adjudicated (request, skill) pairs. Gold file rows:
//   {"id": "<request id>", "skill": "<skill>", "good": true|false, "near_duplicate": true|false, "rung": 1500,
//    "adjudicated_by": "<who>", "reason": "<one sentence>"}
// It needs at least 100 rows (R78 for preregistrations frozen from 2026-11-22), at least half of them near-duplicate cases at the 1,500 rung, with no (id, skill) twice.
// Each judge's labels in labels-l.jsonl are scored against gold with judge-check.ts scoreSources (Cohen's kappa, catch
// rate, false-fail rate), overall and on the near-duplicate half. Output: the shape analyze.ts --judge-check reads.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLlm, LlmError, type ModelId, type Transport } from '../v03/llm.ts';
import { grade, scoreSources, type Sources } from '../skill-resolver/judge-check.ts';
import { judgeFor, loadScaleTrials, type LabelRow } from './analyze.ts';
import { batchCli } from './batch.ts';

export const SEED = 'harn-107-adjudicate-v1';
export const GOLD_MIN = 100;
export const NEAR_DUPLICATE_MIN = 50;
const JUDGE_SOURCE = { astra: 'openai:gpt-6.2-astra', opus: 'anthropic:claude-opus-5-5' } as const;
/** The two graders, the judges' own models (R116: GPT-6.2 Astra, not judge-check.ts's GPT-6 Astra, which #449 froze). */
export const GRADERS: ModelId[] = [JUDGE_SOURCE.astra, JUDGE_SOURCE.opus];
export type QueueItem = { item: string; request_id: string; skill: string };
export type Gold = { id: string; skill: string; good: boolean; near_duplicate: boolean; rung: number; adjudicated_by: string; reason: string };

const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const h = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

export function buildQueue(results: string, labels: LabelRow[]) {
  const byId = new Map(labels.map((l) => [l.id, l]));
  const occ = new Map<string, Array<{ trial_id: string; harness: string; model: string; arm: string | null; rung: number }>>();
  for (const t of loadScaleTrials(results)) {
    if (t.task_phase || t.set_t) continue;
    const j = byId.get(t.task)?.judges[judgeFor(t.model)];
    if (!j) continue;
    const acc = new Set(j.no_skill_needed ? [] : j.acceptable);
    for (const s of new Set(t.opened)) if (!acc.has(s)) {
      const k = t.task + '|' + s;
      occ.set(k, [...(occ.get(k) ?? []), { trial_id: t.id, harness: t.harness, model: t.model, arm: t.arm, rung: t.rung }]);
    }
  }
  const keys = [...occ.keys()].sort((a, b) => h(SEED, a).localeCompare(h(SEED, b)));
  const queue: QueueItem[] = keys.map((k) => { const [request_id, skill] = k.split('|') as [string, string]; return { item: 'q-' + h(SEED, 'item', k).slice(0, 12), request_id, skill }; });
  const key = queue.map((q) => ({ item: q.item, occurrences: occ.get(q.request_id + '|' + q.skill)! }));
  return { queue, key };
}

export async function adjudicate(o: { queue: QueueItem[]; requests: Map<string, string>; catalog: string; out: string; leaseUsd: number; runId: string; transport?: Transport }) {
  mkdirSync(o.out, { recursive: true });
  const llm = await createLlm({ cacheDir: join(o.out, 'cache'), ...(o.transport ? { transport: o.transport } : { proxy: { dir: join(o.out, 'proxy', o.runId), leaseUsd: o.leaseUsd, runId: o.runId } }) });
  const body = (s: string) => readFileSync(join(o.catalog, 'skills', s, 'SKILL.md'), 'utf8').slice(0, 8000);
  const rows: Array<QueueItem & { grades: Record<string, boolean>; acceptable: boolean; split: boolean }> = [];
  const errors: Array<{ item: string; grader: string; error: string }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < o.queue.length) {
      const q = o.queue[next++]!;
      const req = o.requests.get(q.request_id);
      if (!req) { errors.push({ item: q.item, grader: '-', error: 'no request text' }); continue; }
      const grades: Record<string, boolean> = {};
      for (const m of GRADERS) {
        try { grades[m] = await grade(llm, m, req, q.skill, body(q.skill)); }
        catch (e) { errors.push({ item: q.item, grader: m, error: e instanceof LlmError ? e.code : (e as Error).message.slice(0, 120) }); }
      }
      if (Object.keys(grades).length !== GRADERS.length) continue;
      const votes = GRADERS.map((m) => grades[m]);
      rows.push({ ...q, grades, acceptable: votes.every(Boolean), split: votes.some(Boolean) && !votes.every(Boolean) });
    }
  }));
  const stats = await llm.close();
  rows.sort((a, b) => a.item.localeCompare(b.item));
  writeFileSync(join(o.out, 'adjudications.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  const summary = { schema: 'he-skills-at-scale-adjudication/1', graders: GRADERS, queue: o.queue.length, adjudicated: rows.length, pending: o.queue.length - rows.length,
    acceptable: rows.filter((r) => r.acceptable).length, split: rows.filter((r) => r.split).length, errors, llm: stats };
  writeFileSync(join(o.out, 'adjudication-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

export function goldProblems(gold: Gold[]): string[] {
  const p: string[] = [];
  if (gold.length < GOLD_MIN) p.push('gold has ' + gold.length + ' rows; R78 here needs at least ' + GOLD_MIN);
  const near = gold.filter((g) => g.near_duplicate === true && g.rung === 1500).length;
  if (near < NEAR_DUPLICATE_MIN || near * 2 < gold.length) p.push('gold has ' + near + ' near-duplicate rows at the 1,500 rung; at least half of the rows and ' + NEAR_DUPLICATE_MIN + ' are needed');
  const seen = new Set<string>();
  for (const [i, g] of gold.entries()) {
    const k = g.id + '|' + g.skill;
    if (seen.has(k)) p.push('row ' + i + ': (' + k + ') appears twice');
    seen.add(k);
    if (typeof g.good !== 'boolean' || typeof g.near_duplicate !== 'boolean') p.push('row ' + i + ': good and near_duplicate must be true or false');
    if (!g.id || !g.skill || !(typeof g.adjudicated_by === 'string' && g.adjudicated_by.trim()) || !(typeof g.reason === 'string' && g.reason.trim())) p.push('row ' + i + ': id, skill, adjudicated_by and reason are required');
  }
  return p;
}

export function goldCheck(gold: Gold[], labels: LabelRow[]) {
  const problems = goldProblems(gold);
  const sources: Sources = Object.fromEntries((['astra', 'opus'] as const).map((j) => [JUDGE_SOURCE[j], new Map(labels.filter((l) => l.judges[j]).map((l) => [l.id, l.judges[j]!]))]));
  const pairs = gold.map((g) => ({ id: g.id, skill: g.skill, pool: g.near_duplicate ? 'near-duplicate' : 'other', good: g.good }));
  const scored = scoreSources(pairs, sources, {});
  const near = scoreSources(pairs.filter((g) => g.pool === 'near-duplicate'), sources, {});
  const matched = Math.min(...Object.values(scored).map((s) => s.n_bad + s.n_good));
  const passed = !problems.length && matched >= GOLD_MIN && Object.values(scored).every((s) => s.kappa !== null && s.kappa >= 0.6);
  return { schema: 'he-skills-at-scale-judge-check/1', n_gold: problems.length ? 0 : matched, n_rows: gold.length, near_duplicate: gold.filter((g) => g.near_duplicate).length,
    problems, sources: scored, sources_near_duplicate: near, passed };
}

if (import.meta.main) {
  const [cmd, ...a] = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const all = (k: string) => a.flatMap((x, i) => (x === '--' + k && a[i + 1] ? [a[i + 1]!] : []));
  try {
    if (cmd === 'queue' && v('results') && v('labels') && v('out')) {
      const { queue, key } = buildQueue(v('results')!, readJsonl(v('labels')!));
      mkdirSync(v('out')!, { recursive: true });
      writeFileSync(join(v('out')!, 'queue.jsonl'), queue.map((q) => JSON.stringify(q)).join('\n') + (queue.length ? '\n' : ''));
      writeFileSync(join(v('out')!, 'key.jsonl'), key.map((q) => JSON.stringify(q)).join('\n') + (key.length ? '\n' : ''));
      console.log('ADJUDICATION_QUEUE items=' + queue.length + ' out=' + v('out'));
    } else if (cmd === 'run' && v('queue') && all('requests').length && v('catalog') && v('out')) {
      const requests = new Map(all('requests').flatMap((f) => readJsonl(f) as Array<{ id: string; request: string }>).map((r) => [r.id, r.request]));
      const o = { queue: readJsonl(v('queue')!), requests, catalog: v('catalog')!, out: v('out')!, leaseUsd: Number(v('lease-usd') ?? '25'), runId: v('run-id') ?? 'adjudicate-1' };
      const b = v('batch') ? await batchCli({ dir: v('batch')!, cacheDir: join(o.out, 'cache'), runId: o.runId, leaseUsd: o.leaseUsd, work: (transport) => adjudicate({ ...o, transport }) }) : null;
      const s = b ? b.result : await adjudicate(o);
      if (b && !b.done) process.exit(b.exit);
      console.log('ADJUDICATED items=' + s.adjudicated + ' pending=' + s.pending + ' acceptable=' + s.acceptable + ' split=' + s.split + ' usd=' + (b ? b.settled_usd : s.llm.usd));
    } else if (cmd === 'gold-check' && v('gold') && v('labels') && v('out')) {
      const r = goldCheck(readJsonl(v('gold')!), readJsonl(v('labels')!));
      mkdirSync(dirname(v('out')!), { recursive: true });
      writeFileSync(v('out')!, JSON.stringify(r, null, 1) + '\n');
      console.log('GOLD_CHECK rows=' + r.n_rows + ' near_duplicate=' + r.near_duplicate + ' problems=' + r.problems.length + ' ' + Object.entries(r.sources).map(([k, s]) => k + ':kappa=' + s.kappa).join(' ') + ' passed=' + r.passed);
      if (!r.passed) process.exit(1);
    } else {
      console.error('usage: adjudicate.ts queue --results <dir> --labels <labels-l.jsonl> --out <dir>\n       adjudicate.ts run --queue <queue.jsonl> --requests <setl.jsonl>... --catalog <dir> --out <dir> [--lease-usd 25] [--run-id <id>] [--batch <dir>]\n       adjudicate.ts gold-check --gold <gold.jsonl> --labels <labels-l.jsonl> --out <judge-check.json>');
      process.exit(2);
    }
  } catch (e) { console.error((e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SCALE-ADJ-000 ' + (e as Error).message); process.exit(2); }
}
