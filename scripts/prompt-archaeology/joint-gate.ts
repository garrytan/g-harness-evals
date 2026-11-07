#!/usr/bin/env bun
// Prompt-archaeology joint-cut gate (plan decision 3 as approved, with review fixes B1, C1 and F1), keyless. From the headroom probe's
// trials and the validity cells' ablation receipts it writes decision.json, which fixes the main run's family levels, pairs
// and cells before any main trial. It reads only the files it is given and writes nothing but --out.
//
//   bun scripts/prompt-archaeology/joint-gate.ts --trials <probe trials.jsonl> --ablation <ablation ndjson or dir> --commit <sha>
//       --prereg <prereg.json> [--dropped-tasks <file>] [--with-secondary] [--manifest <manifest.json>] [--shards <shards.json>]
//       --out <decision.json> [--check]
//
// Inputs. manifest.json and shards.json default to the files beside trials.jsonl (scripts/merge-shards.ts writes both): the
// manifest gives the planned probe trials, shards.json the commit each cell ran at. --ablation is one ndjson file, or a directory
// whose ablation.ndjson and <shard>.ablation.ndjson files are read. --dropped-tasks lists task names, one per line (blank lines
// and lines starting with # are skipped). The minimal arms' layer lists come from the 2026-11-01 prompt-archaeology prereg.json.
//
// Cells. Probe and main cells are <harness>-<modeltag>-<arm>-v04-<family>-<level>; validity cells are
// <harness>-<modeltag>-<arm>-v04-validity and are never scored. An arm is one harness, model and arm across its cells.
//
// Refusals (exit 2, nothing written): a smoke row (harness_mode smoke, or a smoke run id), a trial or receipt whose run id is
// not the probe's, a trial whose shard commit is not --commit, a cell id outside the pattern, a trial seen twice, a manifest of
// another run, a prereg of another run, a main cell the prereg lacks, or a main cell whose ablation layers are not its arm's.
//
// The rule, on scored trials (model_error, infra_error and exam_fault are unscored; a pass is a graded pass with no consent
// violation, as tables.ts counts it):
// - Dropped tasks: every --dropped-tasks trial leaves the gate before any count, so it is in none of the rates below (PREREGISTRATION.md,
//   defect-list rule: a dropped task leaves the gate's rates and the main analysis on both sides).
// - Short: fewer than 75 percent of the planned probe trials scored, or a planned probe cell with no scored trial. The gate fails
//   with reason "short".
// - Family: pool the three primary full arms (claude-code-opus, openclaw-opus, codex-sol) per family and level. A family runs
//   at l2 when 15 < pooled l2 rate < 85 percent, else at l3 when 15 < pooled l3 rate < 85 percent, else it is out. Fewer than 3
//   families in fails the gate.
// - Pair: the full arm's probe rate on the chosen tasks (each family in at its level). It runs when the rate
//   is in [20, 80] percent; above 80 it is drop-ceiling and below 20 drop-floor, alone. P1 and P2 share the claude-code full arm.
//   A pair inside the band whose cut arm's validity cell is not ok is drop-validity.
// - Validity: per validity cell, agent requests are the agent-turn receipts plus the unknown-family receipts (an unknown request,
//   such as a memory-pipeline call no map names, counts as unmatched, never skipped); housekeeping receipts never count. Fully
//   matched are agent-turn receipts with no did-not-take and no partial. ok when fully matched / agent requests >= 0.95.
// - P5 (openclaw-sol minimal vs full) is never probed or gated: it is listed, as run, only with --with-secondary.
// - The gate fails when no P1 to P4 pair runs. On a failed gate the cell list is empty.
//
// --check recomputes the decision and exits 1 when the --out file differs. Exit 0 when the gate passes, 1 when it fails.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { HOUSEKEEPING_FAMILY, type AblationReceipt } from '../../runner/proxy/ablate.ts';
import { TRIAL_TOKEN_PREFIX } from '../../runner/trial/proxy.ts';
import { pass, scored } from './tables.ts';

export const RUN_ID = 'prompt-archaeology-joint-2026-11';
export const PROBE_RUN_ID = 'prompt-archaeology-joint-probe-2026-11';
export const FAMILIES = ['cr', 'ar', 'er', 'ms', 'ss'] as const;
export type Family = (typeof FAMILIES)[number];
export const LEVELS = ['l2', 'l3'] as const;
export type Level = (typeof LEVELS)[number];
export const ARMS = ['full', 'joint', 'minimal', 'no-identity'] as const;
export type ArmName = (typeof ARMS)[number];
export const MODEL_TAGS = { opus: 'anthropic:claude-opus-5-5', sol: 'openai:gpt-6.1-sol' } as const;
export const PRIMARY_FULL_ARMS = ['claude-code-opus-full', 'openclaw-opus-full', 'codex-sol-full'];
export const RULE = { family_low: 15, family_high: 85, pair_low: 20, pair_high: 80, min_families: 3, min_scored_percent: 75, validity_percent: 95 } as const;
export const JOINT_LAYERS = ['tool-descriptions', 'memory-skills'];
export const HARN33_PREREG = 'docs/benchmarks/2026-11-01-prompt-archaeology/prereg.json';

export type PairId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
export interface PairDef { id: PairId; harness: string; modeltag: keyof typeof MODEL_TAGS; cut: ArmName; holm: boolean }
export const PAIRS: PairDef[] = [
  { id: 'P1', harness: 'claude-code', modeltag: 'opus', cut: 'joint', holm: true },
  { id: 'P2', harness: 'claude-code', modeltag: 'opus', cut: 'minimal', holm: true },
  { id: 'P3', harness: 'openclaw', modeltag: 'opus', cut: 'minimal', holm: true },
  { id: 'P4', harness: 'codex', modeltag: 'sol', cut: 'no-identity', holm: true },
  { id: 'P5', harness: 'openclaw', modeltag: 'sol', cut: 'minimal', holm: false },
];
export const armOf = (p: PairDef, arm: ArmName) => p.harness + '-' + p.modeltag + '-' + arm;
export const cellOf = (arm: string, family: Family, level: Level) => arm + '-v04-' + family + '-' + level;
export const validityCellOf = (arm: string) => arm + '-v04-validity';

const CELL = /^((claude-code|openclaw|codex)-(opus|sol)-(full|joint|minimal|no-identity))-v04-(?:(cr|ar|er|ms|ss)-(l2|l3)|validity)$/;
export interface CellInfo { arm: string; harness: string; modeltag: string; armName: ArmName; family: Family | null; level: Level | null; validity: boolean }
export function parseCell(id: string): CellInfo | null {
  const m = CELL.exec(id);
  if (!m) return null;
  return { arm: m[1]!, harness: m[2]!, modeltag: m[3]!, armName: m[4] as ArmName, family: (m[5] as Family | undefined) ?? null, level: (m[6] as Level | undefined) ?? null, validity: !m[5] };
}
const TASK = /^(cr|ar|er|ms|ss)-\d+-(l[1-4])-/;
export function taskSlot(task: string): { family: Family; level: string } | null {
  const m = TASK.exec(task);
  return m ? { family: m[1] as Family, level: m[2]! } : null;
}
export const runIdOf = (trialId: string) => trialId.split('/')[0]!;
export const isSmokeRun = (runId: string) => /-smoke(-|$)/.test(runId);

/** Strictly inside (15, 85) percent, in whole numbers so a boundary is exact. */
export const familyInBand = (passes: number, n: number) => n > 0 && 100 * passes > RULE.family_low * n && 100 * passes < RULE.family_high * n;
export type PairStatus = 'run' | 'drop-ceiling' | 'drop-floor' | 'drop-validity';
/** Inside [20, 80] percent runs; a pair with no scored trial on its chosen tasks is drop-floor. */
export function pairBand(passes: number, n: number): Exclude<PairStatus, 'drop-validity'> {
  if (n > 0 && 100 * passes > RULE.pair_high * n) return 'drop-ceiling';
  if (n === 0 || 100 * passes < RULE.pair_low * n) return 'drop-floor';
  return 'run';
}

export interface ValidityEntry { agent_requests: number; fully_matched: number; share: number | null; ok: boolean }
/** Validity of one cell's receipts: unknown-family requests are agent requests that did not match; housekeeping never counts. */
export function validityOf(lines: AblationReceipt[]): ValidityEntry {
  const counted = lines.filter((l) => l.family !== HOUSEKEEPING_FAMILY && (l.kind === 'agent-turn' || l.unknown_family));
  const matched = counted.filter((l) => l.kind === 'agent-turn' && !l.unknown_family && !l.did_not_take && !l.partial).length;
  const n = counted.length;
  return { agent_requests: n, fully_matched: matched, share: n ? matched / n : null, ok: n > 0 && 100 * matched >= RULE.validity_percent * n };
}

export interface Shards { cells: Record<string, string>; shards: Record<string, { commit?: string | null }> }
export interface ProbeManifest { run_id: string; cells: Array<{ id: string }>; trials: Array<{ cell: string; task: string }> }
export interface PreregCell { id: string; ablation?: { layers: string[] } | null }
export interface Prereg { run_id: string; cells: PreregCell[] }
export interface GateInput {
  rows: TrialRecord[]; manifest: ProbeManifest; shards: Shards; ablation: AblationReceipt[]; prereg: Prereg; preregSha256: string; commit: string;
  droppedTasks: string[]; withSecondary: boolean; minimalLayers: Record<string, string[]>;
}
export interface FamilyDecision { l2: { passes: number; scored: number }; l3: { passes: number; scored: number }; level: Level | 'out' }
export interface PairDecision { full_passes: number; full_scored: number; rate: number | null; status: PairStatus }
export interface Decision {
  schema_version: 1; run_id: string; probe_run_id: string; commit: string; prereg_sha256: string;
  families: Record<Family, FamilyDecision>; pairs: Partial<Record<PairId, PairDecision>>; validity: Record<string, ValidityEntry>;
  gate: 'pass' | 'fail'; reason: string; cells: string[]; dropped_tasks: string[];
}

export class GateRefusal extends Error {}
const refuse = (why: string): never => { throw new GateRefusal(why); };

/** The 2026-11-01 run's minimal layer list per harness and model tag, from its committed prereg.json. */
export function harn33MinimalLayers(prereg: { cells: PreregCell[] }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of prereg.cells) { const m = /^(.+)-minimal-mu-v03-dev$/.exec(c.id); if (m && c.ablation) out[m[1]!] = c.ablation.layers; }
  return out;
}

export function decide(i: GateInput): Decision {
  if (i.prereg.run_id !== RUN_ID) refuse('prereg run id ' + i.prereg.run_id + ' is not ' + RUN_ID);
  if (i.manifest.run_id !== PROBE_RUN_ID) refuse('manifest run id ' + i.manifest.run_id + ' is not the probe\'s (' + PROBE_RUN_ID + ')');
  const commitOf = (cell: string) => { const shard = i.shards.cells[cell]; return shard === undefined ? null : i.shards.shards[shard]?.commit ?? null; };
  const checkTrial = (trialId: string, cell: string, smoke: boolean, what: string) => {
    const runId = runIdOf(trialId);
    if (smoke || isSmokeRun(runId)) refuse('smoke row: ' + what + ' ' + trialId);
    if (runId !== PROBE_RUN_ID) refuse('foreign run id: ' + what + ' ' + trialId + ' is from ' + runId + ', not ' + PROBE_RUN_ID);
    if (!parseCell(cell)) refuse(what + ' ' + trialId + ': cell ' + cell + ' is not a joint-cut cell id');
    const c = commitOf(cell);
    if (c !== i.commit) refuse('foreign commit: ' + what + ' ' + trialId + ' ran at ' + (c ?? 'no recorded commit') + ' (cell ' + cell + '), not ' + i.commit);
  };
  const seen = new Set<string>();
  for (const t of i.rows) {
    checkTrial(t.trial_id, t.cell, t.harness_mode === 'smoke', 'trial');
    if (seen.has(t.trial_id)) refuse('trial ' + t.trial_id + ' appears twice');
    seen.add(t.trial_id);
  }
  const receiptsByCell = new Map<string, AblationReceipt[]>();
  for (const l of i.ablation) {
    if (!l.key.startsWith(TRIAL_TOKEN_PREFIX)) refuse('ablation receipt key ' + l.key + ' is not a trial key');
    const trialId = l.key.slice(TRIAL_TOKEN_PREFIX.length);
    const cell = trialId.split('/')[1] ?? '';
    checkTrial(trialId, cell, false, 'ablation receipt of');
    receiptsByCell.set(cell, [...(receiptsByCell.get(cell) ?? []), l]);
  }

  const dropped = [...new Set(i.droppedTasks)].sort();
  for (const t of dropped) if (!taskSlot(t)) refuse('dropped task ' + t + ' is not a v0.4 task name');
  const droppedSet = new Set(dropped);

  const probeCells = i.manifest.cells.map((c) => c.id).filter((id) => !(parseCell(id) ?? refuse('manifest cell ' + id + ' is not a joint-cut cell id')).validity);
  const probeSet = new Set(probeCells);
  const planned = i.manifest.trials.filter((t) => probeSet.has(t.cell) && !droppedSet.has(t.task)).length;
  const scoredRows = i.rows.filter((t) => probeSet.has(t.cell) && !droppedSet.has(t.task) && scored(t));
  const emptyCells = probeCells.filter((c) => !scoredRows.some((t) => t.cell === c));
  const short = 100 * scoredRows.length < RULE.min_scored_percent * planned
    ? 'short: ' + scoredRows.length + ' of ' + planned + ' planned probe trials scored (bound ' + RULE.min_scored_percent + '%)'
    : emptyCells.length ? 'short: probe cell(s) with no scored trial: ' + emptyCells.join(', ') : null;

  const fullRows = (arm: string) => scoredRows.filter((t) => parseCell(t.cell)!.arm === arm);
  const pooled = PRIMARY_FULL_ARMS.flatMap(fullRows);
  const count = (rows: TrialRecord[]) => ({ passes: rows.reduce((n, t) => n + pass(t), 0), scored: rows.length });
  const families = {} as Record<Family, FamilyDecision>;
  for (const f of FAMILIES) {
    const at = (level: Level) => count(pooled.filter((t) => { const s = taskSlot(t.task); return s?.family === f && s.level === level; }));
    const l2 = at('l2'), l3 = at('l3');
    families[f] = { l2, l3, level: familyInBand(l2.passes, l2.scored) ? 'l2' : familyInBand(l3.passes, l3.scored) ? 'l3' : 'out' };
  }
  const inFamilies = FAMILIES.filter((f) => families[f].level !== 'out');

  const chosen = (t: TrialRecord) => { const s = taskSlot(t.task); return !!s && families[s.family].level === s.level; };

  const validity: Record<string, ValidityEntry> = {};
  for (const [cell, lines] of receiptsByCell) if (parseCell(cell)!.validity) validity[cell] = validityOf(lines);
  for (const p of PAIRS.filter((x) => x.holm)) validity[validityCellOf(armOf(p, p.cut))] ??= validityOf([]);

  const pairs: Decision['pairs'] = {};
  for (const p of PAIRS) {
    if (!p.holm) { if (i.withSecondary) pairs[p.id] = { full_passes: 0, full_scored: 0, rate: null, status: 'run' }; continue; }
    const c = count(fullRows(armOf(p, 'full')).filter(chosen));
    const band = pairBand(c.passes, c.scored);
    const status: PairStatus = band === 'run' && !validity[validityCellOf(armOf(p, p.cut))]!.ok ? 'drop-validity' : band;
    pairs[p.id] = { full_passes: c.passes, full_scored: c.scored, rate: c.scored ? c.passes / c.scored : null, status };
  }
  const running = PAIRS.filter((p) => pairs[p.id]?.status === 'run');

  const reason = short
    ?? (inFamilies.length < RULE.min_families ? 'fewer than ' + RULE.min_families + ' families in band: ' + inFamilies.length + ' (' + (inFamilies.join(', ') || 'none') + ')' : null)
    ?? (!running.some((p) => p.holm) ? 'no primary pair runs: ' + PAIRS.filter((p) => p.holm).map((p) => p.id + ' ' + pairs[p.id]!.status).join(', ') : null);
  const gate = reason === null ? 'pass' : 'fail';

  const cells: string[] = [];
  if (gate === 'pass') {
    const preregCells = new Map(i.prereg.cells.map((c) => [c.id, c]));
    for (const p of running) for (const armName of ['full', p.cut] as ArmName[]) {
      const arm = armOf(p, armName);
      const want = armName === 'full' ? [] : armName === 'joint' ? JOINT_LAYERS : armName === 'no-identity' ? ['identity']
        : i.minimalLayers[p.harness + '-' + p.modeltag] ?? refuse('the 2026-11-01 prereg has no ' + p.harness + '-' + p.modeltag + ' minimal cell');
      for (const f of inFamilies) {
        const id = cellOf(arm, f, families[f].level as Level);
        const pc = preregCells.get(id) ?? refuse('prereg has no cell ' + id);
        const got = pc.ablation?.layers ?? null;
        if (!got || [...got].sort().join('+') !== [...want].sort().join('+')) refuse('prereg cell ' + id + ' removes ' + (got ? JSON.stringify(got) : 'no ablation') + ', not its arm\'s ' + JSON.stringify(want));
        if (!cells.includes(id)) cells.push(id);
      }
    }
    cells.sort();
  }
  return {
    schema_version: 1, run_id: RUN_ID, probe_run_id: PROBE_RUN_ID, commit: i.commit, prereg_sha256: i.preregSha256, families, pairs,
    validity: Object.fromEntries(Object.entries(validity).sort(([a], [b]) => (a < b ? -1 : 1))),
    gate, reason: reason ?? inFamilies.length + ' families in band (' + inFamilies.map((f) => f + ' ' + families[f].level).join(', ') + '); pairs run: ' + running.map((p) => p.id).join(', '),
    cells, dropped_tasks: dropped,
  };
}

const pct = (x: number | null) => (x === null ? 'n/a' : (100 * x).toFixed(1) + '%');
export function renderSummary(d: Decision): string {
  const rate = (c: { passes: number; scored: number }) => c.passes + '/' + c.scored + ' (' + pct(c.scored ? c.passes / c.scored : null) + ')';
  return [
    '# Joint-cut gate: ' + d.gate + ' (' + d.reason + ')', '',
    '| Family | l2 pooled | l3 pooled | Level |', '|---|---|---|---|',
    ...FAMILIES.map((f) => '| ' + f + ' | ' + rate(d.families[f].l2) + ' | ' + rate(d.families[f].l3) + ' | ' + d.families[f].level + ' |'), '',
    '| Pair | Full on chosen tasks | Status |', '|---|---|---|',
    ...Object.entries(d.pairs).map(([k, p]) => '| ' + k + ' | ' + p!.full_passes + '/' + p!.full_scored + ' (' + pct(p!.rate) + ') | ' + p!.status + ' |'), '',
    '| Validity cell | Agent requests | Fully matched | Share | ok |', '|---|---|---|---|---|',
    ...Object.entries(d.validity).map(([k, v]) => '| ' + k + ' | ' + v.agent_requests + ' | ' + v.fully_matched + ' | ' + pct(v.share) + ' | ' + (v.ok ? 'yes' : 'no') + ' |'), '',
    'Cells: ' + d.cells.length + '. Dropped tasks: ' + (d.dropped_tasks.join(', ') || 'none') + '.', '',
  ].join('\n');
}

const readNdjson = <X>(file: string): X[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as X);

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const [trials, ablation, commit, preregPath, out] = [arg('trials'), arg('ablation'), arg('commit'), arg('prereg'), arg('out')];
  if (!trials || !ablation || !commit || !preregPath || !out) {
    console.error('usage: bun scripts/prompt-archaeology/joint-gate.ts --trials <trials.jsonl> --ablation <ndjson or dir> --commit <sha> --prereg <prereg.json> [--dropped-tasks <file>] [--with-secondary] [--manifest <file>] [--shards <file>] --out <decision.json> [--check]');
    process.exit(2);
  }
  try {
    const manifestPath = arg('manifest') ?? join(dirname(trials), 'manifest.json');
    const shardsPath = arg('shards') ?? join(dirname(trials), 'shards.json');
    for (const [what, p] of [['trials', trials], ['ablation', ablation], ['prereg', preregPath], ['manifest', manifestPath], ['shards', shardsPath]] as const) if (!existsSync(p)) refuse(what + ' file ' + p + ' does not exist');
    const ablationFiles = statSync(ablation).isDirectory() ? readdirSync(ablation).filter((f) => /(^|\.)ablation\.ndjson$/.test(f)).sort().map((f) => join(ablation, f)) : [ablation];
    const droppedPath = arg('dropped-tasks');
    const preregRaw = readFileSync(preregPath);
    const decision = decide({
      rows: readNdjson<TrialRecord>(trials), manifest: JSON.parse(readFileSync(manifestPath, 'utf8')), shards: JSON.parse(readFileSync(shardsPath, 'utf8')),
      ablation: ablationFiles.flatMap((f) => readNdjson<AblationReceipt>(f)), prereg: JSON.parse(preregRaw.toString('utf8')),
      preregSha256: createHash('sha256').update(preregRaw).digest('hex'), commit,
      droppedTasks: droppedPath ? readFileSync(droppedPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [],
      withSecondary: argv.includes('--with-secondary'),
      minimalLayers: harn33MinimalLayers(JSON.parse(readFileSync(join(import.meta.dir, '..', '..', HARN33_PREREG), 'utf8'))),
    });
    const text = JSON.stringify(decision, null, 1) + '\n';
    if (argv.includes('--check')) {
      if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('joint-gate: ' + out + ' differs from the decision the inputs give'); process.exit(1); }
    } else writeFileSync(out, text);
    console.log(renderSummary(decision));
    process.exit(decision.gate === 'pass' ? 0 : 1);
  } catch (e) {
    if (!(e instanceof GateRefusal)) throw e;
    console.error('joint-gate: refused: ' + e.message);
    process.exit(2);
  }
}
