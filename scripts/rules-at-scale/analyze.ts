#!/usr/bin/env bun
// The rules-at-scale analysis: every outcome and decision rule in the plan's "Outcomes", "Sample size"
// and "Changes accepted at the gate", from collected trials. Keyless and offline; tests/rules-at-scale-analyze.test.ts runs
// it on synthetic trials where the answer is known. The statistics come from runner/stats (cluster bootstrap and exact
// cluster sign-flip in paired.ts, fixedSequence, minimumDetectable, taskBootstrapMean) and the R113 look from sequential.ts.
//
//   bun scripts/rules-at-scale/analyze.ts --trials <trials.jsonl> [--design <design.json>] [--look interim]
//       [--interim <interim.json>] --out <dir>
//
// Inputs:
//   --trials: one JSON row per trial, {setup, arm, task, rotation, rules: {R1..R6: met|not_met|not_applicable|unscorable},
//     delivery: {R1..R6: whole|partial|fetched_later|absent|unscorable} | null, solved: 0|1|null, usd, input_tokens,
//     infra: <code>|null, contaminated: bool}. One trial per setup, arm and task.
//   --design: scripts/rules-at-scale/design.json by default: alpha, power, the planned effect (the smallest detectable
//     difference stated in advance), the assumed SD, seed, draws, the task order the run follows, the setups with their
//     arms and the setups pooled for the pooled outcomes.
//
// Rules, from the plan:
//   - Rules followed (primary) is a trial's share of applicable planted rules met: met / (met + not met). Not applicable
//     and unscorable rules leave the denominator and are counted; a trial with none left has no value. Contaminated trials
//     are left out and counted. Pairs are per task within a setup; a task with a value in only one arm drops out of that
//     pair and is counted. Intervals are 95% task-clustered bootstrap ranges; p is the exact cluster sign-flip.
//   - The size ladder, per setup, is a fixed sequence (largest rung first: 160 KB or QM's top, then 80, 28 and 8 KB), each
//     step "rung minus short". A step shows a drop when the difference is below 0 and the two-sided sign-flip p is at or
//     below the final O'Brien-Fleming nominal level (two-sided 0.0478 at alpha 0.05). The sequence stops at the first step
//     with no measured drop; the drop size S_h is the smallest rung that showed one. The safe size is the largest rung such
//     that it and every smaller rung keep the lower end of their interval above minus the planned effect.
//   - Split, hook and cut lifted, per setup, are compared with the top rung (confirmatory, Holm over the ones the setup
//     runs, each Holm-adjusted p against the same final nominal level) and with the 8 KB rung (reported, no decision).
//   - Everything else (pooled ladder, position, rule, delivery, delivered and ignored, cost, task solved) is reported with
//     intervals and decides nothing.
//
// The interim look (R113): with --look interim, only the first half of the design's task order is used. Each confirmatory
// comparison gets z = delta / cluster-robust SE, oriented so the planned effect is positive (a drop for ladder steps, a
// gain for repairs), conditional power under the planned effect, and a decision from sequential.ts lookDecision with
// two-look O'Brien-Fleming bounds at its own alpha: alpha for a ladder step (fixed sequence), alpha / k for the k repair
// contrasts of a setup (Holm's first step, the conservative choice before the order of the p-values is known). A cell stops
// only when every comparison it feeds has stopped; the short, none and qm-repo arms never stop while anything in the setup
// runs. Output: <out>/interim.json. The final analysis takes it with --interim: a comparison that stopped keeps its
// interim decision and every output marks a stop_efficacy estimate "possibly overstated". A run that names a look and has
// no record stays provisional.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, holmAdjusted, normalQuantile, type PairedItem } from '../../runner/stats/paired.ts';
import { fixedSequence } from '../../runner/stats/fixed-sequence.ts';
import { minimumDetectable } from '../../runner/stats/sizing.ts';
import { taskBootstrapMean } from '../../runner/stats/frontier.ts';
import { LOOKS, driftFor, lookDecision, obfBounds, type LookDecision } from './sequential.ts';

export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;
export type RuleId = (typeof RULE_IDS)[number];
export type RuleState = 'met' | 'not_met' | 'not_applicable' | 'unscorable';
export type DeliveryState = 'whole' | 'partial' | 'fetched_later' | 'absent' | 'unscorable';
export type Position = 'top' | 'middle' | 'end';
export const POSITIONS: Position[] = ['top', 'middle', 'end'];
export const SIZE_ARMS = ['b8k', 'b28k', 'b80k', 'b160k', 'qm-top'] as const;
export const REPAIR_ARMS = ['split', 'hook', 'cutlift'] as const;
const RULE_STATES: RuleState[] = ['met', 'not_met', 'not_applicable', 'unscorable'];
const DELIVERY_STATES: DeliveryState[] = ['whole', 'partial', 'fetched_later', 'absent', 'unscorable'];

export interface Trial {
  setup: string; arm: string; task: string; rotation: 0 | 1 | 2;
  rules: Record<RuleId, RuleState>;
  delivery?: Record<RuleId, DeliveryState> | null;
  solved?: 0 | 1 | null; usd?: number | null; input_tokens?: number | null;
  infra?: string | null; contaminated?: boolean;
}
export interface Setup { id: string; harness: string; model: string; arms: string[] }
export interface Design {
  alpha: number; power: number; planned_effect: number; sd: number; seed: number; draws: number;
  task_order: string[]; pooled_setups: string[]; setups: Setup[];
}
type Rotations = Record<string, Record<Position, RuleId[]>>;

export const DESIGN_FILE = join(import.meta.dir, 'design.json');
export const loadRotations = (): Rotations => JSON.parse(readFileSync(join(import.meta.dir, 'rules.json'), 'utf8')).rotations;

const r4 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(4)));

export function validateTrials(rows: unknown[], design: Design): Trial[] {
  const setups = new Map(design.setups.map((s) => [s.id, new Set(s.arms)]));
  const seen = new Set<string>();
  const problems: string[] = [];
  rows.forEach((row, i) => {
    const t = row as Trial;
    const at = 'row ' + (i + 1);
    if (!setups.has(t.setup)) return problems.push(at + ': unknown setup ' + t.setup);
    if (!setups.get(t.setup)!.has(t.arm)) return problems.push(at + ': setup ' + t.setup + ' has no arm ' + t.arm);
    if (typeof t.task !== 'string' || !t.task) return problems.push(at + ': no task');
    if (![0, 1, 2].includes(t.rotation)) return problems.push(at + ': rotation must be 0, 1 or 2');
    for (const id of RULE_IDS) if (!RULE_STATES.includes(t.rules?.[id])) problems.push(at + ': rule ' + id + ' has state ' + String(t.rules?.[id]));
    if (t.delivery) for (const id of RULE_IDS) if (!DELIVERY_STATES.includes(t.delivery[id])) problems.push(at + ': delivery ' + id + ' has state ' + String(t.delivery[id]));
    const key = t.setup + '|' + t.arm + '|' + t.task;
    if (seen.has(key)) problems.push(at + ': a second trial for ' + key);
    seen.add(key);
  });
  if (problems.length) throw new Error('invalid trials:\n' + problems.slice(0, 20).join('\n'));
  return rows as Trial[];
}

/** met / (met + not met) over the given rules; null when none of them is met or not met. */
export function followed(t: Trial, ids: readonly RuleId[] = RULE_IDS): number | null {
  let met = 0, n = 0;
  for (const id of ids) {
    if (t.rules[id] === 'met') { met++; n++; } else if (t.rules[id] === 'not_met') n++;
  }
  return n ? met / n : null;
}

type Metric = (t: Trial) => number | null | undefined;
const usable = (trials: Trial[]) => trials.filter((t) => !t.contaminated);
function values(trials: Trial[], setup: string, arm: string, f: Metric): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trials) if (t.setup === setup && t.arm === arm) { const v = f(t); if (typeof v === 'number' && Number.isFinite(v)) m.set(t.task, v); }
  return m;
}

export interface Contrast {
  a: string; b: string; n_pairs: number; only_one_arm: number; mean_a: number; mean_b: number; delta: number;
  ci95: [number, number] | null; p_two_sided: number; se_cluster: number | null;
}
function contrastOf(pairs: PairedItem[], a: string, b: string, onlyOne: number, design: Design): Contrast | null {
  if (!pairs.length) return null;
  const d = clusteredPairedDelta(pairs, { seed: design.seed, draws: design.draws });
  return { a, b, n_pairs: d.n_pairs, only_one_arm: onlyOne, mean_a: r4(d.mean_a)!, mean_b: r4(d.mean_b)!, delta: r4(d.delta)!,
    ci95: d.ci95 ? [r4(d.ci95[0])!, r4(d.ci95[1])!] : null, p_two_sided: r4(d.p_two_sided)!, se_cluster: r4(d.se_cluster) };
}
/** b minus a, paired per task within one setup. */
export function contrast(trials: Trial[], setup: string, a: string, b: string, f: Metric, design: Design): Contrast | null {
  const va = values(trials, setup, a, f), vb = values(trials, setup, b, f);
  const pairs: PairedItem[] = [];
  let onlyOne = 0;
  for (const task of new Set([...va.keys(), ...vb.keys()])) {
    if (va.has(task) && vb.has(task)) pairs.push({ id: task, cluster: task, a: va.get(task)!, b: vb.get(task)! });
    else onlyOne++;
  }
  return contrastOf(pairs, a, b, onlyOne, design);
}
/** b minus a pooled over setups, every setup-task pair clustered by task (the same tasks run in every setup). */
export function pooledContrast(trials: Trial[], setups: Array<{ setup: string; a: string; b: string }>, f: Metric, design: Design, label: { a: string; b: string }): Contrast | null {
  const pairs: PairedItem[] = [];
  let onlyOne = 0;
  for (const s of setups) {
    const va = values(trials, s.setup, s.a, f), vb = values(trials, s.setup, s.b, f);
    for (const task of new Set([...va.keys(), ...vb.keys()])) {
      if (va.has(task) && vb.has(task)) pairs.push({ id: s.setup + ':' + task, cluster: task, a: va.get(task)!, b: vb.get(task)! });
      else onlyOne++;
    }
  }
  return contrastOf(pairs, label.a, label.b, onlyOne, design);
}

export const ladderOf = (s: Setup) => SIZE_ARMS.filter((a) => s.arms.includes(a)).reverse();
export const topRung = (s: Setup) => ladderOf(s)[0];
const repairsOf = (s: Setup) => REPAIR_ARMS.filter((a) => s.arms.includes(a));

export interface InterimEntry { setup: string; comparison: string; a: string; b: string; z: number; conditional_power: number; decision: LookDecision; bounds: { interim: number; final: number }; alpha: number; n_pairs: number }
export interface InterimRecord { look: 'interim'; fraction: number; tasks: string[]; comparisons: InterimEntry[]; cells_stopping: Array<{ setup: string; arm: string }> }

/** The comparisons a setup's run decides, with the arms each one feeds and its own alpha at the look. */
function confirmatory(s: Setup, design: Design) {
  const out: Array<{ comparison: string; a: string; b: string; orient: 1 | -1; alpha: number; ladder: boolean }> = [];
  for (const rung of ladderOf(s)) out.push({ comparison: 'ladder:' + rung, a: 'short', b: rung, orient: -1, alpha: design.alpha, ladder: true });
  const top = topRung(s), reps = repairsOf(s);
  for (const r of reps) out.push({ comparison: 'repair:' + r, a: top, b: r, orient: 1, alpha: design.alpha / reps.length, ladder: false });
  return out;
}

export function interimLook(all: Trial[], design: Design): InterimRecord {
  const half = design.task_order.slice(0, Math.ceil(design.task_order.length * LOOKS.fraction));
  const keep = new Set(half);
  const trials = usable(all).filter((t) => keep.has(t.task));
  const comparisons: InterimEntry[] = [];
  const cells_stopping: Array<{ setup: string; arm: string }> = [];
  for (const s of design.setups) {
    const entries: InterimEntry[] = [];
    let sequenceEnded = false;
    for (const c of confirmatory(s, design)) {
      const k = contrast(trials, s.id, c.a, c.b, followed, design);
      const bounds = obfBounds(c.alpha, 2);
      const look = k ? lookDecision({ delta: c.orient * k.delta, se: k.se_cluster, plannedEffect: design.planned_effect, bounds })
        : { z: 0, conditional_power: 0, decision: 'continue' as LookDecision };
      let decision = look.decision;
      if (c.ladder && sequenceEnded) decision = 'stop_futility';
      if (c.ladder && (decision === 'stop_futility' || decision === 'stop_loss')) sequenceEnded = true;
      entries.push({ setup: s.id, comparison: c.comparison, a: c.a, b: c.b, z: look.z, conditional_power: look.conditional_power, decision, bounds: { interim: r4(bounds.interim)!, final: r4(bounds.final)! }, alpha: r4(c.alpha)!, n_pairs: k?.n_pairs ?? 0 });
    }
    comparisons.push(...entries);
    const stopped = (arm: string) => {
      const fed = entries.filter((e) => e.a === arm || e.b === arm);
      return fed.length > 0 && fed.every((e) => e.decision !== 'continue') && arm !== 'short';
    };
    for (const arm of s.arms) if (stopped(arm)) cells_stopping.push({ setup: s.id, arm });
  }
  return { look: 'interim', fraction: LOOKS.fraction, tasks: half, comparisons, cells_stopping };
}

function meanCi(xs: number[], design: Design) {
  const m = xs.length ? taskBootstrapMean(xs, { seed: design.seed, draws: design.draws }) : null;
  return m ? { estimate: r4(m.estimate), n: m.n, ci95: m.ci95 ? [r4(m.ci95[0]), r4(m.ci95[1])] : null } : { estimate: null, n: 0, ci95: null };
}

export function analyze(all: Trial[], design: Design, interim: InterimRecord | null) {
  const rot = loadRotations();
  const trials = usable(all);
  const finalBounds = obfBounds(design.alpha, 2);
  const level = 2 * finalBounds.nominal_final;
  const look = (setup: string, comparison: string) => interim?.comparisons.find((e) => e.setup === setup && e.comparison === comparison) ?? null;
  const mdd = design.planned_effect;
  const nTasks = design.task_order.length;
  const fixedMdd = nTasks ? minimumDetectable(nTasks, design.sd, { alpha: design.alpha / 2, power: design.power }) : null;
  const inflation = driftFor(design.power, finalBounds) / (normalQuantile(1 - design.alpha / 2) + normalQuantile(design.power));

  const setups = design.setups.map((s) => {
    const counts = Object.fromEntries(s.arms.map((arm) => {
      const ts = all.filter((t) => t.setup === s.id && t.arm === arm);
      const states = Object.fromEntries(RULE_IDS.map((id) => [id, Object.fromEntries(RULE_STATES.map((st) => [st, ts.filter((t) => !t.contaminated && t.rules[id] === st).length]))]));
      return [arm, { trials: ts.length, contaminated: ts.filter((t) => t.contaminated).length, infra: ts.filter((t) => t.infra).length,
        no_value: ts.filter((t) => !t.contaminated && followed(t) === null).length, rule_states: states }];
    }));
    const arms = Object.fromEntries(s.arms.map((arm) => {
      const ts = trials.filter((t) => t.setup === s.id && t.arm === arm);
      const num = (f: Metric) => ts.map((t) => f(t)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return [arm, { rules_followed: meanCi(num(followed), design), solved: meanCi(num((t) => t.solved), design),
        usd: meanCi(num((t) => t.usd), design), input_tokens: meanCi(num((t) => t.input_tokens), design) }];
    }));

    const steps = ladderOf(s).map((rung) => ({ rung, c: contrast(trials, s.id, 'short', rung, followed, design), look: look(s.id, 'ladder:' + rung) }));
    const seq = fixedSequence(steps.map((st) => ({ id: st.rung, evaluate: () => {
      if (st.look && st.look.decision !== 'continue') return { pass: st.look.decision === 'stop_efficacy', detail: { by: 'interim ' + st.look.decision } };
      return { pass: !!st.c && st.c.delta < 0 && st.c.p_two_sided <= level, detail: { by: 'final' } };
    } })));
    const drop = seq.longest_passing_prefix.at(-1) ?? null;
    let safe: string | null = null, safeNote = '';
    for (const st of [...steps].reverse()) {
      if (!st.c?.ci95) { safeNote = 'no interval at ' + st.rung; break; }
      if (st.c.ci95[0] <= -mdd) break;
      safe = st.rung;
    }
    if (!safe && !safeNote) safeNote = 'even the smallest rung may lose more than the planned effect';
    const ladder = { order: steps.map((st) => st.rung), level: r4(level), steps: steps.map((st, i) => ({ rung: st.rung, contrast: st.c, status: seq.results[i]!.status,
      decided_by: (seq.results[i]!.detail as { by: string } | undefined)?.by ?? null, possibly_overstated: st.look?.decision === 'stop_efficacy' })),
      drop_size: drop, safe_size: safe, safe_note: safeNote || null };

    const top = topRung(s), reps = repairsOf(s);
    const repC = reps.map((r) => ({ arm: r, c: contrast(trials, s.id, top, r, followed, design), look: look(s.id, 'repair:' + r) }));
    const adj = holmAdjusted(repC.map((x) => x.c?.p_two_sided ?? 1));
    const repairs = repC.map((x, i) => {
      const stopped = x.look && x.look.decision !== 'continue';
      const pass = stopped ? x.look!.decision === 'stop_efficacy' : !!x.c && x.c.delta > 0 && adj[i]! <= level;
      return { arm: x.arm, against: top, contrast: x.c, holm_p: r4(adj[i]), status: pass ? 'pass' : 'fail', decided_by: stopped ? 'interim ' + x.look!.decision : 'final',
        possibly_overstated: x.look?.decision === 'stop_efficacy', against_8k: s.arms.includes('b8k') ? contrast(trials, s.id, 'b8k', x.arm, followed, design) : null };
    });

    const positions = [...ladderOf(s), 'short'].map((arm) => {
      const byPos = (p: Position): Metric => (t) => followed(t, rot[String(t.rotation)]![p]);
      const pairsFor = (p: Position) => {
        const items: PairedItem[] = [];
        for (const t of trials) if (t.setup === s.id && t.arm === arm) { const a = byPos('top')(t), b = byPos(p)(t); if (typeof a === 'number' && typeof b === 'number') items.push({ id: t.task, cluster: t.task, a, b }); }
        return items;
      };
      return { arm, middle_minus_top: contrastOf(pairsFor('middle'), 'top', 'middle', 0, design), end_minus_top: contrastOf(pairsFor('end'), 'top', 'end', 0, design) };
    });

    const byRule = Object.fromEntries(RULE_IDS.map((id) => [id, Object.fromEntries(s.arms.map((arm) => {
      const ts = trials.filter((t) => t.setup === s.id && t.arm === arm && (t.rules[id] === 'met' || t.rules[id] === 'not_met'));
      return [arm, { met: ts.filter((t) => t.rules[id] === 'met').length, n: ts.length }];
    }))]));

    const delivery = Object.fromEntries(s.arms.map((arm) => {
      const ts = all.filter((t) => t.setup === s.id && t.arm === arm && !t.contaminated);
      const st = Object.fromEntries(DELIVERY_STATES.map((d) => [d, 0])) as Record<DeliveryState, number>;
      let noCapture = 0, wholeN = 0, wholeMet = 0;
      for (const t of ts) {
        if (!t.delivery) { noCapture++; continue; }
        for (const id of RULE_IDS) {
          st[t.delivery[id]]++;
          if (t.delivery[id] === 'whole' && (t.rules[id] === 'met' || t.rules[id] === 'not_met')) { wholeN++; if (t.rules[id] === 'met') wholeMet++; }
        }
      }
      return [arm, { states: st, trials_without_capture: noCapture, followed_when_delivered_whole: { met: wholeMet, n: wholeN, share: wholeN ? r4(wholeMet / wholeN) : null } }];
    }));

    const cost = s.arms.filter((a) => a !== 'none').map((arm) => ({ arm, usd: contrast(trials, s.id, 'none', arm, (t) => t.usd, design), input_tokens: contrast(trials, s.id, 'none', arm, (t) => t.input_tokens, design) }));
    const solved = ladderOf(s).map((rung) => ({ rung, contrast: contrast(trials, s.id, 'short', rung, (t) => t.solved, design) }));
    return { setup: s.id, harness: s.harness, model: s.model, counts, arms, ladder, repairs, positions, by_rule: byRule, delivery, cost, solved_vs_short: solved };
  });

  const pooledSetups = design.setups.filter((s) => design.pooled_setups.includes(s.id));
  const rungNames = ['b8k', 'b28k', 'b80k', 'top'];
  const pooled = {
    setups: pooledSetups.map((s) => s.id),
    ladder: rungNames.map((name) => ({ rung: name, contrast: pooledContrast(trials, pooledSetups.filter((s) => name === 'top' || s.arms.includes(name)).map((s) => ({ setup: s.id, a: 'short', b: name === 'top' ? topRung(s)! : name })), followed, design, { a: 'short', b: name }) })),
    by_rule_top_minus_short: Object.fromEntries(RULE_IDS.map((id) => [id, pooledContrast(trials, pooledSetups.map((s) => ({ setup: s.id, a: 'short', b: topRung(s)! })), (t) => followed(t, [id]), design, { a: 'short', b: 'top' })])),
    position_at_top_rung: (['middle', 'end'] as const).map((p) => {
      const items: PairedItem[] = [];
      for (const s of pooledSetups) for (const t of trials) if (t.setup === s.id && t.arm === topRung(s)) {
        const a = followed(t, rot[String(t.rotation)]!.top), b = followed(t, rot[String(t.rotation)]![p]);
        if (a !== null && b !== null) items.push({ id: s.id + ':' + t.task, cluster: t.task, a, b });
      }
      return { contrast: p + '_minus_top', result: contrastOf(items, 'top', p, 0, design) };
    }),
  };

  const lookNamed = interim !== null;
  return {
    status: lookNamed ? 'final' : 'provisional: the preregistered interim look has no record here (--interim)',
    design: { alpha: design.alpha, power: design.power, planned_effect: design.planned_effect, sd: design.sd, tasks: nTasks,
      final_level_two_sided: r4(level), bounds: { interim: r4(finalBounds.interim), final: r4(finalBounds.final) },
      smallest_detectable_fixed: r4(fixedMdd), smallest_detectable_with_look: r4(fixedMdd === null ? null : fixedMdd * inflation) },
    interim: interim ? { tasks: interim.tasks.length, cells_stopped: interim.cells_stopping } : null,
    setups, pooled,
  };
}

const pts = (x: number | null | undefined) => (x === null || x === undefined ? '-' : (100 * x).toFixed(1));
const ci = (c: [number, number] | null | undefined) => (c ? '[' + pts(c[0]) + ', ' + pts(c[1]) + ']' : '-');
export function render(a: ReturnType<typeof analyze>): string {
  const out = ['# Rules at scale: analysis', '', 'Status: ' + a.status + '. Points are percentage points of rules followed; ranges are 95% task-clustered bootstrap ranges.', '',
    'Smallest detectable difference per setup and rung: ' + pts(a.design.smallest_detectable_fixed) + ' points (' + pts(a.design.smallest_detectable_with_look) + ' with the interim look), at SD ' + a.design.sd + ' over ' + a.design.tasks + ' tasks.', ''];
  for (const s of a.setups) {
    out.push('## ' + s.setup + ' (' + s.harness + ', ' + s.model + ')', '', 'Drop size: ' + (s.ladder.drop_size ?? 'no measured drop') + '. Safe size: ' + (s.ladder.safe_size ?? 'none (' + s.ladder.safe_note + ')') + '.', '',
      '| step | short | rung | difference | range | p | n | status |', '|---|---|---|---|---|---|---|---|');
    for (const st of s.ladder.steps) out.push('| ' + [st.rung, pts(st.contrast?.mean_a), pts(st.contrast?.mean_b), pts(st.contrast?.delta), ci(st.contrast?.ci95), st.contrast?.p_two_sided ?? '-', st.contrast?.n_pairs ?? 0, st.status + (st.possibly_overstated ? ' (stopped early, possibly overstated)' : '')].join(' | ') + ' |');
    if (s.repairs.length) {
      out.push('', '| repair | vs | difference | range | Holm p | status | vs 8 KB |', '|---|---|---|---|---|---|---|');
      for (const r of s.repairs) out.push('| ' + [r.arm, r.against, pts(r.contrast?.delta), ci(r.contrast?.ci95), r.holm_p ?? '-', r.status + (r.possibly_overstated ? ' (possibly overstated)' : ''), pts(r.against_8k?.delta) + ' ' + ci(r.against_8k?.ci95)].join(' | ') + ' |');
    }
    out.push('');
  }
  out.push('## Pooled over ' + a.pooled.setups.join(', '), '', '| rung | difference from short | range | n pairs |', '|---|---|---|---|');
  for (const r of a.pooled.ladder) out.push('| ' + [r.rung, pts(r.contrast?.delta), ci(r.contrast?.ci95), r.contrast?.n_pairs ?? 0].join(' | ') + ' |');
  for (const p of a.pooled.position_at_top_rung) out.push('', 'Position at the top rung, ' + p.contrast.replace(/_/g, ' ') + ': ' + pts(p.result?.delta) + ' ' + ci(p.result?.ci95) + ', n ' + (p.result?.n_pairs ?? 0) + '.');
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
  const trialsPath = arg('trials'), outDir = arg('out');
  if (!trialsPath || !outDir) { console.error('usage: analyze.ts --trials <trials.jsonl> [--design <design.json>] [--look interim] [--interim <interim.json>] --out <dir>'); process.exit(2); }
  const design: Design = JSON.parse(readFileSync(arg('design') ?? DESIGN_FILE, 'utf8'));
  const rows = readFileSync(trialsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const trials = validateTrials(rows, design);
  mkdirSync(outDir, { recursive: true });
  if (arg('look') === 'interim') {
    writeFileSync(join(outDir, 'interim.json'), JSON.stringify(interimLook(trials, design), null, 2) + '\n');
  } else {
    const interimPath = arg('interim');
    const result = analyze(trials, design, interimPath ? JSON.parse(readFileSync(interimPath, 'utf8')) : null);
    writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(result, null, 2) + '\n');
    writeFileSync(join(outDir, 'analysis.md'), render(result));
  }
}
