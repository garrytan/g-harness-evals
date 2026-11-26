#!/usr/bin/env bun
// gbrain-access-leaks-2026-11: every returned gbrain record the leak tags left unmapped (scope unknown), per cell, by kind,
// with the slug or fact text, so each one is mapped to its origin before a leak count is published (PREREGISTRATION.md,
// "Before publishing a leak count"). Read-only over a merged results folder.
//   bun docs/benchmarks/2026-11-09-gbrain-access-leaks/analysis/unmapped.ts --results <merged results> --out <file.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RunManifest, TrialRecord } from '../../../../runner/contracts.ts';
import { loadTask } from '../../../../runner/grade/index.ts';
import { gbrainExposureDetail, loadWorldData } from '../../../../runner/grade/predicates.ts';
import { storedEvidence } from '../../../../scripts/stored-evidence.ts';

const arg = (n: string) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : undefined; };
const results = resolve(arg('results') ?? '');
const out = arg('out');
const repoRoot = resolve(import.meta.dir, '../../../..');
const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as RunManifest;
const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord)
  .filter((t) => !['model_error', 'infra_error', 'exam_fault'].includes(t.termination as string));
const kind = (s: string): string => {
  if (s.startsWith('before every turn')) return /hot-memory/.test(s) ? 'no_requester_hot_memory' : 'no_requester_read';
  if (/ page \S+ was written at seq=\d+ with unknown scope/.test(s)) return 'page_written_unknown_scope';
  if (/ was remembered at seq=\d+ with unknown scope/.test(s)) return 'fact_remembered_unknown_scope';
  if (/ hot-memory fact/.test(s)) return 'hot_memory_fact_unplaced';
  if (/ fact( #\S+)? "/.test(s)) return 'fact_unplaced';
  if (/ page \S+$/.test(s)) return 'page_unplaced';
  return 'other';
};
const cells: Record<string, { trials: number; unmapped: number; by_kind: Record<string, number>; by_tool: Record<string, number>; slugs: Record<string, number>; facts: Record<string, number>; examples: string[] }> = {};
for (const t of rows) {
  const stored = storedEvidence(t, { results, manifest, repoRoot });
  if ('problem' in stored) continue;
  const ev = stored.evidence;
  const ctx = { evidence: ev, task: loadTask(ev.task_dir), world: loadWorldData(ev.world_path, ev.split), bot: ev.bot_member };
  const { unmapped } = gbrainExposureDetail(ctx);
  const c = (cells[t.cell] ??= { trials: 0, unmapped: 0, by_kind: {}, by_tool: {}, slugs: {}, facts: {}, examples: [] });
  c.trials++;
  for (const u of unmapped) {
    c.unmapped++;
    const k = kind(u); c.by_kind[k] = (c.by_kind[k] ?? 0) + 1;
    const tool = /seq=\d+ (\S+)/.exec(u)?.[1] ?? 'none'; c.by_tool[tool] = (c.by_tool[tool] ?? 0) + 1;
    const slug = / page (\S+)/.exec(u)?.[1];
    if (slug) { const top = slug.split('/').slice(0, 2).join('/'); c.slugs[top] = (c.slugs[top] ?? 0) + 1; }
    const fact = /"(.*)"$/.exec(u)?.[1];
    if (fact) c.facts[fact] = (c.facts[fact] ?? 0) + 1;
    if (c.examples.length < 12 && !c.examples.some((x) => kind(x) === k)) c.examples.push(t.trial_id + ' | ' + u);
  }
}
const text = JSON.stringify(cells, null, 1);
if (out) writeFileSync(out, text + '\n'); else console.log(text);
