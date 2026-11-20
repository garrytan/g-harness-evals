#!/usr/bin/env bun
// Labels set L for the skills-at-scale eval (internal-task plan, "Labels"; review F2 and F3), by running
// scripts/skill-resolver/label-set.ts with two judges, GPT-6 Astra and Opus 5.5, over the 1,500-skill catalog.
//
//   bun scripts/skills-at-scale/label-l.ts --catalog <1,500-skill catalog dir> --set <setl-dev.jsonl> [--set <setl-test.jsonl>]
//       --out <dir> [--lease-usd 120] [--run-id label-l-1] [--batch <dir>]
//
// --batch <dir> sends the judges' calls through the provider batch APIs (batch.ts: half price, the catalog prefix cached)
// instead of the metering proxy: each run is one round, and the command exits 3 while a batch is open; run it again until it
// exits 0. The lease is <dir>/ledger.sqlite; the answers land in label-set's own cache, so a later run without --batch
// reuses them.
//
// label-set.ts is #449's full-catalog labelling: pass 1 shows each judge one request and the whole catalog listing (every
// name and description, sent as a cached prefix, so no ranker under test picks what gets judged) and asks for up to 8
// candidates; pass 2 shows the candidates' SKILL.md and asks for the acceptable set. Each judge's own label is kept: analyze.ts
// scores OpenAI runs with Opus's and every other run with Astra's (R78); the reconciled final is a sensitivity only. Every
// no-skill request is labelled the same way against the 1,500 catalog, and one that either judge gives an acceptable skill
// is listed as drift: analyze.ts drops it from the no-skill bars at the rungs that hold that skill (F3).
// Output: <out>/labels-l.jsonl, one row per request: {id, kind, target, half, judges: {astra, opus}, final, target_accepted
// (skill requests: whether each judge accepted the writer's target), no_skill_drift (no-skill requests: each judge's
// acceptable set, when any)}, and <out>/labels-l-summary.json. label-set.ts's own files, cache included, sit under
// <out>/label-set/. The cache holds request text, so a run that labels sealed (test-half) rows must write outside the checkout.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Transport } from '../v03/llm.ts';
import { label } from '../skill-resolver/label-set.ts';
import { batchCli } from './batch.ts';

export const JUDGES = ['astra', 'opus'] as const;
const ROOT = resolve(import.meta.dir, '..', '..');
type Core = { no_skill_needed: boolean; acceptable: string[]; candidates: string[] };
type SetRow = { id: string; kind: 'skill' | 'none'; target: string | null; request: string; half: string };

const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

export async function labelL(o: { catalog: string; sets: string[]; out: string; leaseUsd: number; runId: string; transport?: Transport }) {
  const rows = o.sets.flatMap((f) => readJsonl(f) as SetRow[]);
  const rel = relative(ROOT, resolve(o.out));
  if (rows.some((r) => r.half === 'test') && !rel.startsWith('..') && !rel.startsWith('/')) throw new Error('HE-SCALE-LABEL-001 sealed test-half rows are being labelled into ' + o.out + ', inside the checkout; the label cache holds their text, so write outside it');
  const ids = new Set<string>();
  for (const r of rows) { if (ids.has(r.id)) throw new Error('HE-SCALE-LABEL-002 request ' + r.id + ' appears twice'); ids.add(r.id); }
  mkdirSync(o.out, { recursive: true });
  const merged = join(o.out, 'set.jsonl');
  writeFileSync(merged, rows.map((r) => JSON.stringify({ id: r.id, request: r.request, half: r.half })).join('\n') + '\n');
  const summary = await label({ catalog: o.catalog, set: merged, out: join(o.out, 'label-set'), judges: [...JUDGES], half: 'all', leaseUsd: o.leaseUsd, runId: o.runId, transport: o.transport });
  const labelled = new Map((readJsonl(join(o.out, 'label-set', 'labels.jsonl')) as Array<{ id: string; judges: Record<string, Core>; final: unknown }>).map((l) => [l.id, l]));
  const out = rows.filter((r) => labelled.has(r.id)).sort((a, b) => a.id.localeCompare(b.id)).map((r) => {
    const l = labelled.get(r.id)!;
    const judges = Object.fromEntries(JUDGES.map((j) => [j, l.judges[j]]));
    const extra = r.kind === 'skill'
      ? { target_accepted: Object.fromEntries(JUDGES.map((j) => [j, !l.judges[j]!.no_skill_needed && l.judges[j]!.acceptable.includes(r.target!)])) }
      : { no_skill_drift: JUDGES.some((j) => l.judges[j]!.acceptable.length) ? Object.fromEntries(JUDGES.map((j) => [j, l.judges[j]!.acceptable])) : null };
    return { id: r.id, kind: r.kind, target: r.target, half: r.half, judges, final: l.final, ...extra };
  });
  writeFileSync(join(o.out, 'labels-l.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const skill = out.filter((r) => r.kind === 'skill') as Array<{ target_accepted: Record<string, boolean> }>;
  const none = out.filter((r) => r.kind === 'none') as Array<{ id: string; no_skill_drift: Record<string, string[]> | null }>;
  const result = {
    schema: 'he-skills-at-scale-labels/1', judges: JUDGES, labelled: out.length, unlabelled: rows.length - out.length, errors: summary.errors,
    target_not_accepted: Object.fromEntries(JUDGES.map((j) => [j, skill.filter((r) => !r.target_accepted[j]).length])),
    no_skill_drift: none.filter((r) => r.no_skill_drift).map((r) => ({ id: r.id, astra: r.no_skill_drift!.astra ?? [], opus: r.no_skill_drift!.opus ?? [] })),
    agreement: summary.agreement, llm: summary.llm,
  };
  writeFileSync(join(o.out, 'labels-l-summary.json'), JSON.stringify(result, null, 1) + '\n');
  return result;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const sets = a.flatMap((x, i) => (x === '--set' && a[i + 1] ? [a[i + 1]!] : []));
  const catalog = v('catalog'), out = v('out');
  if (!catalog || !out || !sets.length) { console.error('usage: label-l.ts --catalog <dir> --set <setl.jsonl>... --out <dir> [--lease-usd 120] [--run-id label-l-1] [--batch <dir>]'); process.exit(2); }
  try {
    const leaseUsd = Number(v('lease-usd') ?? '120'), runId = v('run-id') ?? 'label-l-1';
    const batch = v('batch');
    const b = batch ? await batchCli({ dir: batch, cacheDir: join(out, 'label-set', 'cache'), runId, leaseUsd, work: (transport) => labelL({ catalog, sets, out, leaseUsd, runId, transport }) }) : null;
    const s = b ? b.result : await labelL({ catalog, sets, out, leaseUsd, runId });
    if (b && !b.done) process.exit(b.exit);
    console.log('LABELS_L n=' + s.labelled + ' errors=' + s.errors.length + ' target_not_accepted=' + JSON.stringify(s.target_not_accepted) + ' no_skill_drift=' + s.no_skill_drift.length + ' usd=' + (b ? b.settled_usd : s.llm.usd));
  } catch (e) { console.error((e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SCALE-LABEL-000 ' + (e as Error).message); process.exit(2); }
}
