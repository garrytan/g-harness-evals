#!/usr/bin/env bun
// Headroom of one run: per task and per arm, the pass rate, whether every arm passed or every arm failed, and how many
// tasks are left that can tell arms apart (runner/stats/headroom.ts). Prints the plain-English section a results pull
// request includes; summarize-run.ts prints the same section.
//
//   bun scripts/headroom.ts --results <results dir> [--json]
//
// Reads <results>/trials.jsonl. Scored trials only: model_error, infra_error and exam_fault are excluded, and a cell whose
// scored trials are all product-probe tasks is left out, as in summarize-run.ts; a trial passes when its grade is pass with
// no consent violation, and harness_error is a fail. A run
// planned with a sealed root (manifest.json has a "sealed" block) is refused, because the table names every task.
//
// The gate in matrix-analysis.ts and frontier-harbor/analyze.ts uses the same tags. The spec files listed below were
// published before the gate existed: an analysis run with exactly that spec (sha256 of its parsed JSON) keeps the output
// it was published with, so a re-run reproduces the committed files. Any other spec, an edited copy of one of these
// included, gets the gate.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { RunnerError } from '../runner/errors.ts';
import { readJsonFile, readJsonLines } from '../runner/heldout/sealed.ts';
import { renderHeadroom, runHeadroom, type RunHeadroom } from '../runner/stats/headroom.ts';

export const PUBLISHED_BEFORE_HEADROOM_GATE: ReadonlyArray<{ spec: string; sha256: string }> = [
  { spec: 'docs/benchmarks/2026-11-04-matrix-mu/matrix-spec.json', sha256: 'efd33574f8f73c2c7be6f5ff132ee8aa3fc36d5b80706e3c500452ae716212da' },
  { spec: 'docs/benchmarks/2026-11-07-frontier-harness/analysis-spec.json', sha256: '33c21651891fdfd2e6412716f58a941ec3bfa4f98a31c642247fc95ad30f764c' },
  { spec: 'docs/benchmarks/2026-11-07-frontier-harness/analysis-spec-kept.json', sha256: 'f4d6c108a670bfae546e9c78ac3d7a93763c4f99dd6abe5ffc583f8c09e8383e' },
  { spec: 'docs/benchmarks/2026-11-07-frontier-harness/analysis-spec-extension.json', sha256: '07cc1bb4a85ae05f8def13b3f35d946f09767f1514a8d4d744a3f38347a805d7' },
];
export const specSha256 = (spec: unknown) => createHash('sha256').update(JSON.stringify(spec)).digest('hex');
export const headroomGated = (spec: unknown) => !PUBLISHED_BEFORE_HEADROOM_GATE.some((p) => p.sha256 === specSha256(spec));

const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);

export function headroomOf(records: readonly TrialRecord[], familyOf: (t: TrialRecord) => string = () => 'unknown'): RunHeadroom {
  const scored = records.filter((t) => !EXCLUDED.has(t.termination));
  const probeCells = new Set(scored.map((t) => t.cell).filter((cell) => scored.filter((t) => t.cell === cell).every((t) => familyOf(t) === 'product_probe')));
  return runHeadroom(scored.filter((t) => !probeCells.has(t.cell)).map((t) => ({ arm: t.cell, task: t.task, pass: t.grade === 'pass' && !t.consent_violation ? 1 : 0 })));
}

if (import.meta.main) {
  const i = process.argv.indexOf('--results');
  const results = i >= 0 ? process.argv[i + 1] : undefined;
  if (!results || !existsSync(join(results, 'trials.jsonl'))) {
    console.error('usage: bun scripts/headroom.ts --results <results dir> [--json]');
    process.exit(2);
  }
  try {
    const manifestPath = join(results, 'manifest.json');
    const manifest = existsSync(manifestPath) ? readJsonFile<{ sealed?: unknown; cells?: Array<{ id: string; task_set?: string; split: 'dev' | 'heldout' }> }>(manifestPath) : null;
    if (manifest?.sealed) {
      console.error(`HE-SEALED-001 ${results} was planned with a sealed root; its headroom table names every task, so read it inside custody with summarize-run.ts --sealed-root (docs/sealed-custody.md)`);
      process.exit(2);
    }
    const { taskDirFor } = await import('../runner/run.ts');
    const { taskFamily } = await import('../runner/grade/task.ts');
    const familyOf = (t: TrialRecord) => {
      const dir = taskDirFor(manifest?.cells?.find((c) => c.id === t.cell) ?? { split: 'dev' }, t.task, join(import.meta.dir, '..', 'tasks'));
      if (!existsSync(join(dir, 'task.toml'))) return 'unknown';
      try { return taskFamily(dir); } catch { return 'unknown'; }
    };
    const h = headroomOf(readJsonLines<TrialRecord>(join(results, 'trials.jsonl')), familyOf);
    process.stdout.write(process.argv.includes('--json') ? JSON.stringify(h, null, 2) + '\n' : renderHeadroom(h));
  } catch (e) {
    if (!(e instanceof RunnerError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
}
