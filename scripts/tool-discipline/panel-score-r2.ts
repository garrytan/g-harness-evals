#!/usr/bin/env bun
/**
 * HARN-18 Hermes rerun of the start-hook panel (tool-discipline-start-hermes-r2-2026-11): the verdict of
 * docs/benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION-hermes-r2.md.
 *
 *   bun scripts/tool-discipline/panel-score-r2.ts <cells.jsonl> --manifest <manifest.json> [--json]
 *
 * The rules are panel-score.ts's, unchanged: this file imports its score() and markdown() and adds no threshold. Only the
 * manifest it accepts differs. The candidate is gstack e2d9c798 (v1.92.57.0, gstack#3825) instead of b9fda18c, the cap is $19,
 * the run id is this run's, and only Hermes runs. discovery.sh always plans the 144-row three-arm order for both harnesses, so
 * the run passes --only with the 72 Hermes trial ids and every OpenClaw row is not_run:not_selected. Those rows and their planned
 * order entries are dropped before scoring; an OpenClaw row with any other termination (a dispatched OpenClaw trial) is refused.
 * The manifest must match the manifest.sha256 beside it and must not be a dry run's, as in panel-score.ts.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { markdown, PANEL_DESIGN, score, type HarnessScore } from './panel-score.ts';

export const R2_RUN_ID = 'tool-discipline-start-hermes-r2-2026-11';

/** The preregistered arms of the Hermes rerun: none and baseline as in tool-discipline-start-2026-11, the candidate moved to e2d9c798. */
export const R2_ARMS = {
  none: { gstack_sha: 'none', start_hook: 'off' },
  baseline: { gstack_sha: '482ffd1440ab13d105bfd3e571be3d7a0a7bb99a', start_hook: 'off' },
  candidate: { gstack_sha: 'e2d9c798b2a69cd7870513f1d280d757a4e527de', start_hook: 'on' },
} as const;

/** panel-score.ts's design with the rerun's cap. */
export const R2_DESIGN = { ...PANEL_DESIGN, panel_cap_usd: 19 } as const;

const PLANNED_HARNESSES = ['openclaw', 'hermes'], SCORED = 'hermes', NOT_SELECTED = 'not_run:not_selected';

/** Why a manifest is not this rerun's (run id, the real upstream, the design, the SHAs, the hook on the candidate alone, 8 planned
 *  trials in each of the 18 cells lease.ts plans), or null. */
export function r2ManifestProblem(manifest: any): string | null {
  if (manifest.run_id !== R2_RUN_ID) return 'run_id is ' + JSON.stringify(manifest.run_id) + ', not ' + R2_RUN_ID;
  if (manifest.upstream !== 'default') return 'upstream is ' + JSON.stringify(manifest.upstream) + ', not default (a fake or overridden upstream is never a counted run)';
  for (const [key, want] of Object.entries(R2_DESIGN)) if (manifest[key] !== want) return key + ' is ' + JSON.stringify(manifest[key]) + ', not ' + JSON.stringify(want);
  const cells = new Map<string, number>();
  for (const o of Array.isArray(manifest.order) ? manifest.order : []) cells.set(o.harness + ' task ' + o.task + ' ' + o.arm, (cells.get(o.harness + ' task ' + o.task + ' ' + o.arm) ?? 0) + 1);
  const planned = PLANNED_HARNESSES.flatMap(h => [1, 2, 3].flatMap(t => Object.keys(R2_ARMS).map(arm => h + ' task ' + t + ' ' + arm)));
  for (const k of planned) if ((cells.get(k) ?? 0) !== R2_DESIGN.trials_per_cell) return 'the order plans ' + (cells.get(k) ?? 0) + ' trials for ' + k + ', not ' + R2_DESIGN.trials_per_cell;
  const extra = [...cells.keys()].filter(k => !planned.includes(k));
  if (extra.length) return 'the order plans cells outside the 18 lease.ts plans: ' + extra.join(', ');
  if (manifest.start_hook?.arm !== 'candidate') return 'start_hook.arm is ' + JSON.stringify(manifest.start_hook?.arm) + ', not candidate (discovery.sh ran without --start-hook candidate)';
  for (const [arm, want] of Object.entries(R2_ARMS)) {
    const got = manifest.arms?.[arm];
    if (got?.gstack_sha !== want.gstack_sha) return arm + ' gstack_sha is ' + JSON.stringify(got?.gstack_sha) + ', not ' + want.gstack_sha;
    if (got?.start_hook !== want.start_hook) return arm + ' start_hook is ' + JSON.stringify(got?.start_hook) + ', not ' + want.start_hook;
  }
  return null;
}

/** The Hermes rows and planned order; refuses a row of another harness that --only did not leave out. */
export function hermesOnly(rows: any[], order: any[]): { rows: any[]; order: any[] } {
  const dispatched = rows.filter(r => r.harness !== SCORED && r.termination !== NOT_SELECTED);
  if (dispatched.length) throw new Error('cells.jsonl has ' + dispatched.length + ' non-Hermes rows that are not ' + NOT_SELECTED + ' (first: ' + dispatched[0].trial_id + ' ' + dispatched[0].termination + '); the rerun dispatches Hermes only');
  return { rows: rows.filter(r => r.harness === SCORED), order: order.filter(o => o.harness === SCORED) };
}

export function scoreR2(rows: any[], order: any[]): HarnessScore[] {
  const h = hermesOnly(rows, order);
  return score(h.rows, h.order);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--manifest');
  const mi = args.indexOf('--manifest');
  if (!file || mi < 0 || !args[mi + 1]) { console.error('usage: panel-score-r2.ts <cells.jsonl> --manifest <manifest.json> [--json]'); process.exit(64); }
  let rows: any[];
  try { rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { console.error('panel-score-r2: ' + file + ' is not readable JSON lines: ' + (e as Error).message); process.exit(2); }
  const text = readFileSync(args[mi + 1], 'utf8'), seal = join(dirname(args[mi + 1]), 'manifest.sha256');
  if (!existsSync(seal) || readFileSync(seal, 'utf8').trim() !== createHash('sha256').update(text).digest('hex')) { console.error('panel-score-r2: ' + args[mi + 1] + ' does not match the manifest.sha256 beside it'); process.exit(2); }
  const manifest = JSON.parse(text), order = manifest.order;
  if (manifest.dry_run === true) { console.error('panel-score-r2: ' + args[mi + 1] + ' is a dry run\'s manifest'); process.exit(2); }
  if (!Array.isArray(order)) { console.error('panel-score-r2: ' + args[mi + 1] + ' has no order array'); process.exit(2); }
  const problem = r2ManifestProblem(manifest);
  if (problem) { console.error('panel-score-r2: ' + args[mi + 1] + ' is not the preregistered Hermes rerun: ' + problem); process.exit(2); }
  let scores: HarnessScore[];
  try { scores = scoreR2(rows, order); } catch (e) { console.error('panel-score-r2: ' + (e as Error).message); process.exit(2); }
  console.log(args.includes('--json') ? JSON.stringify(scores, null, 2) : markdown(scores).replace(/^# .*/, '# Start-hook panel verdict, Hermes rerun (scripts/tool-discipline/panel-score-r2.ts, the rules of panel-score.ts)'));
}
