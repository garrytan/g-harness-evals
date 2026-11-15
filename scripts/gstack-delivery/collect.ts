#!/usr/bin/env bun
// Collects a frontier Harbor run of the gstack delivery eval (HARN-61) into the two inputs the preregistered analysis reads,
// with no model call: one row per trial for scripts/gstack-delivery/analyze.ts and scripts/paired-mdd.ts --delivery, and one
// line per trial for scripts/gstack-delivery/probes.ts --batch.
//
//   bun scripts/gstack-delivery/collect.ts --prereg <prereg-harbor.json> --out <dir> <results dir> [<results dir> ...]
//
// A results dir is a shard's results (or the merged run) holding trials.jsonl and Harbor's run/jobs tree. Per trial record:
// the arm, harness and model come from the preregistration's cell, the kind from the task's task.toml in the preregistration's
// repo_tasks split, the rep from frontier.attempt, and the capture is run/jobs/<harbor_job>/<harbor_trial>/proxy-capture/
// proxy-requests.ndjson. A placebo trial's batch line names the preregistration's placebo file as its expected text.
// Writes <out>/trials.jsonl and <out>/probe-batch.jsonl, then: bun scripts/gstack-delivery/probes.ts --batch
// <out>/probe-batch.jsonl --out <out>/probes.jsonl. A record whose cell, task kind or capture is missing stops the run (exit 3)
// after naming every such record; a recovered record (no Harbor directory), and a model_error, infra_error or exam_fault record
// whose capture is missing because it ended before any request, keep their rows and get no capture, so probes.ts marks them
// PROBE_CAPTURE_MISSING, which the analysis excludes and counts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXCLUDED_TERMINATIONS, KINDS, type DeliveryTrial } from './analyze.ts';
import { ARMS, type Arm, type Kind } from './probes.ts';

interface Cell { id: string; harness: string; model: string; arm?: Arm }
interface Prereg { run_id: string; repo_tasks?: { dir: string; placebo?: string }; cells: Cell[] }
interface Record { trial_id: string; cell: string; task: string; termination: DeliveryTrial['termination']; grade: DeliveryTrial['grade']; consent_violation?: boolean; usage?: { usd?: number } | null; frontier?: { harbor_job?: string; harbor_trial?: string; attempt?: number; infra_class?: string | null; recovered?: unknown } }

export interface Collected { rows: Array<DeliveryTrial & { infra_class: string | null }>; batch: Array<{ trial_id: string; capture: string; kind: Kind; arm: Arm; termination: string; expect?: string }>; problems: string[] }

export function taskKind(root: string, dir: string, task: string): Kind | null {
  const toml = join(root, dir, task, 'task.toml');
  if (!existsSync(toml)) return null;
  const m = readFileSync(toml, 'utf8').match(/^kind\s*=\s*"([a-z]+)"/m);
  return m && (KINDS as readonly string[]).includes(m[1]!) ? (m[1] as Kind) : null;
}

export function collect(prereg: Prereg, resultsDirs: readonly string[], root = process.cwd()): Collected {
  const out: Collected = { rows: [], batch: [], problems: [] };
  if (!prereg.repo_tasks) { out.problems.push('the preregistration has no repo_tasks block'); return out; }
  const cells = new Map(prereg.cells.map((c) => [c.id, c]));
  const placebo = resolve(root, prereg.repo_tasks.placebo ?? 'harnesses/routes/placebo.md');
  for (const dir of resultsDirs) {
    const file = join(dir, 'trials.jsonl');
    if (!existsSync(file)) { out.problems.push(file + ' does not exist'); continue; }
    for (const line of readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())) {
      const r = JSON.parse(line) as Record;
      const cell = cells.get(r.cell);
      if (!cell || !cell.arm || !ARMS.includes(cell.arm)) { out.problems.push(r.trial_id + ': cell ' + r.cell + ' is not a cell of the preregistration with a delivery arm'); continue; }
      const kind = taskKind(root, prereg.repo_tasks.dir, r.task);
      if (!kind) { out.problems.push(r.trial_id + ': task ' + r.task + ' has no review or ship kind in ' + prereg.repo_tasks.dir); continue; }
      const f = r.frontier ?? {};
      const rep = f.attempt;
      if (!Number.isSafeInteger(rep)) { out.problems.push(r.trial_id + ': no frontier.attempt'); continue; }
      out.rows.push({ trial_id: r.trial_id, harness: cell.harness, model: cell.model, arm: cell.arm, kind, task: r.task, rep: rep!, termination: r.termination, grade: r.grade, consent_violation: r.consent_violation ?? false, usd: r.usage?.usd ?? null, infra_class: f.infra_class ?? null });
      const capture = f.harbor_job && f.harbor_trial ? resolve(dir, 'run', 'jobs', f.harbor_job, f.harbor_trial, 'proxy-capture', 'proxy-requests.ndjson') : '';
      const missing = capture !== '' && !existsSync(capture);
      if (missing && !f.recovered && !EXCLUDED_TERMINATIONS.has(r.termination)) { out.problems.push(r.trial_id + ': no capture at ' + capture); continue; }
      out.batch.push({ trial_id: r.trial_id, capture: missing ? '' : capture, kind, arm: cell.arm, termination: r.termination, ...(cell.arm === 'placebo' ? { expect: placebo } : {}) });
    }
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const preregFile = opt('--prereg'), outDir = opt('--out');
  if (!preregFile || !outDir || !argv.length) { console.error('usage: bun scripts/gstack-delivery/collect.ts --prereg <prereg-harbor.json> --out <dir> <results dir> [...]'); process.exit(2); }
  const c = collect(JSON.parse(readFileSync(preregFile, 'utf8')) as Prereg, argv);
  if (c.problems.length) { for (const p of c.problems) console.error('collect: ' + p); process.exit(3); }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'trials.jsonl'), c.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(outDir, 'probe-batch.jsonl'), c.batch.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('collect: ' + c.rows.length + ' trials, ' + c.batch.length + ' probe lines, to ' + outDir);
}
