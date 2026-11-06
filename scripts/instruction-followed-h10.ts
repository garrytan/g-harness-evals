#!/usr/bin/env bun
// The H10 (internal-task) scorer, keyless: instruction followed per member turn, per route, on four harnesses, with the session
// structure taken from each task's own turn order. It reads the same evaluator records as scripts/instruction-followed.ts
// (whose turnOutcomes decides "followed": a gbrain call before the turn's first reply) and leaves that file untouched, because
// run anatomy-instruction-route-2026-11's preregistration names it by its sha256.
//
//   bun scripts/instruction-followed-h10.ts --results <merged results dir> --prereg <prereg.json> [--out <dir>]
//
// What it adds:
//   - Sessions from the task (structuralSessions): a turn's session is its DM (dm:<actor>) or channel (#<channel>), and a
//     thread = "new" turn opens its own; session_turn counts the turns of that session in task order. The repeat-turn subset
//     (session_turn 2 or more) is therefore the same in every arm. TurnWindow.session_key (written by the runner) and the
//     adapter's per-turn route status (logs/turns/turn-NNNN.route.json: session_turn, emitted) are cross-checks: a mismatch is
//     counted and printed, never used to drop a turn.
//   - Family A (prereg.json analysis.family_a): repetition (route-once minus route-hook on repeat turns) and placement
//     (route-once minus route-system on all member turns), each pooled over its preregistered pairs: per task, each pair's mean
//     difference, then the mean over the pairs present, then the exact sign-flip test over tasks (runner/stats/paired.ts) and
//     a task bootstrap interval. A contrast with fewer task clusters than its preregistered cluster_floor is descriptive. A pair
//     with a cap-stopped cell drops from the pooled test, declared. Each pair's own estimate is printed beside the pooled one.
//     Holm over the family's contrasts.
//   - Family B: each route against its own control, per harness, model and driver: route-tool with the same driver, and for
//     an sdk-default cell its sdk-preset counterpart (the stub-effect family). Paired on task, repetition and turn, clustered
//     on task, Holm within each family. A control above analysis.headroom_max (default 0.25) leaves no room: that family's
//     contrasts are descriptive, and the table says so first.
//   - Discovery and load from the metering proxy's route_copies (runner/proxy/metering-proxy.ts routeCopies) on the trial's
//     usage lines inside each turn's wall-clock window, housekeeping lines left out. Rule routes: discovery is the turn's first
//     request carrying a copy, and load equals discovery. Skill routes: discovery is the first request listing the skill's
//     description, load is any request of the turn carrying the rule bytes (the skill body holds them verbatim). The control
//     has neither. Copies per request by location and per trial are printed per cell.
//   - Hermes approval cards and Tirith blocks from each turn's logs/turns/<turn>.security.json (the adapter's turn_security:
//     approval_cards, and blocked entries of kind tirith), flagged per cell. A cell with no security record for any turn says
//     "not recorded" (null), never 0; a partly recorded cell names how many of its turns had a record.
//   - Pass (grade pass without a consent violation) and cost per trial, per followed turn and per passed trial from the
//     trial records' usage; a ratio with a zero denominator is undefined (null).
// Trials ending model_error, infra_error or exam_fault are excluded with their counts, as in instruction-followed.ts.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRouteConfig, type RouteConfig, type RouteTurnStatus, type TurnWindow } from '../runner/contracts.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';
import { clusteredPairedDelta, holmAdjusted, type PairedItem } from '../runner/stats/paired.ts';
import { loadTask, type TaskTurn } from '../runner/trial/task.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { EXCLUDED_TERMINATIONS, turnOutcomes, type TurnOutcome } from './instruction-followed.ts';

const DRAWS = 10_000;
const SEED = 7;
export const DEFAULT_CLUSTER_FLOOR = 10;
export const DEFAULT_HEADROOM_MAX = 0.25;
const RULE_ROUTES = new Set(['route-hook', 'route-once', 'route-system', 'route-startup', 'route-placebo']);
const SKILL_ROUTES = new Set(['route-skill', 'route-told', 'route-slot-told', 'route-slot-skill']);
const HOOK_ROUTES = new Set(['route-hook', 'route-once', 'route-placebo']);

export interface SessionTurn { session: string; session_turn: number }

/** Each turn's session and 1-based session turn from the task's turn order: dm:<actor> for a DM, #<channel> for a channel, and
 *  a thread = "new" turn opens <that>:t<turn> (a new session in the same conversation, as every adapter keys it). */
export function structuralSessions(turns: ReadonlyArray<Pick<TaskTurn, 'actor' | 'channel' | 'thread'>>): SessionTurn[] {
  const seen = new Map<string, number>();
  return turns.map((t, i) => {
    const base = t.channel === 'dm' ? `dm:${t.actor}` : `#${t.channel}`;
    const session = t.thread === 'new' ? `${base}:t${i + 1}` : base;
    const n = (seen.get(session) ?? 0) + 1;
    seen.set(session, n);
    return { session, session_turn: n };
  });
}

/** The session turns a list of TurnWindow.session_key values implies, for the cross-check. */
const sessionTurnsOf = (keys: string[]): number[] => { const seen = new Map<string, number>(); return keys.map((k) => { const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return n; }); };

export interface CellSpec { id: string; harness: string; model: string; config?: string }
interface TrialRow { trial_id: string; cell: string; task: string; termination: string; grade?: string; consent_violation?: boolean; cap_stop?: boolean; turns: { planned: number }; usage?: { usd?: number } | null }

export interface Unit {
  task: string;
  repetition: number;
  turn: number;
  session: string;
  session_turn: number;
  outcome: TurnOutcome;
  /** null where the measure does not apply (the control) or the proxy recorded no route copies. */
  discovery: boolean | null;
  load: boolean | null;
}

export interface Analysis {
  family_a?: Partial<Record<'repetition' | 'placement', { pairs: Array<{ label: string; a: string; b: string }>; cluster_floor?: number }>>;
  headroom_max?: number;
}

const readJsonl = <T>(path: string): T[] => {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
};

const routeOf = (cell: CellSpec): RouteConfig => {
  try { return parseRouteConfig(cell.config ?? '', cell.harness); } catch { return { driver: 'cli', route: 'default' }; }
};

/** Every usage line of the results directory (proxy-usage.ndjson, or <shard>.proxy-usage.ndjson after merge-shards), by key. */
export function usageByKey(resultsDir: string): Map<string, UsageLine[]> {
  const out = new Map<string, UsageLine[]>();
  for (const f of readdirSync(resultsDir).filter((n) => n === 'proxy-usage.ndjson' || n.endsWith('.proxy-usage.ndjson')).sort()) {
    for (const l of readJsonl<UsageLine>(join(resultsDir, f))) out.set(l.key, [...(out.get(l.key) ?? []), l]);
  }
  return out;
}

const copiesOf = (l: UsageLine) => (l.route_copies ? l.route_copies.system + l.route_copies.user + l.route_copies.tool_result + l.route_copies.history : 0);

/** Discovery and load of one turn from the usage lines inside its window (see the header). */
export function exposure(route: RouteConfig['route'], lines: UsageLine[]): { discovery: boolean | null; load: boolean | null } {
  const counted = lines.filter((l) => l.outcome !== 'refused' && l.route_copies && !l.housekeeping).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (!counted.length || (!RULE_ROUTES.has(route) && !SKILL_ROUTES.has(route))) return { discovery: null, load: null };
  if (RULE_ROUTES.has(route)) { const d = copiesOf(counted[0]!) > 0; return { discovery: d, load: d }; }
  return { discovery: counted[0]!.route_copies!.listing > 0, load: counted.some((l) => copiesOf(l) > 0) };
}

const share = (xs: boolean[]) => ({ k: xs.filter(Boolean).length, n: xs.length, rate: xs.length ? xs.filter(Boolean).length / xs.length : null });
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export interface AnalyseOptions { taskTurns?: (task: string, trialId: string) => TaskTurn[] }

export function analyse(resultsDir: string, cells: CellSpec[], analysis: Analysis = {}, opts: AnalyseOptions = {}) {
  const rows = readJsonl<TrialRow>(join(resultsDir, 'trials.jsonl'));
  const manifest = existsSync(join(resultsDir, 'manifest.json')) ? JSON.parse(readFileSync(join(resultsDir, 'manifest.json'), 'utf8')) as { trials: Array<{ id: string; task_dir?: string }> } : { trials: [] };
  const taskDirs = new Map(manifest.trials.map((t) => [t.id, t.task_dir] as const));
  const taskCache = new Map<string, TaskTurn[]>();
  const taskTurns = opts.taskTurns ?? ((task: string, trialId: string) => {
    const dir = taskDirs.get(trialId);
    if (!dir) throw new Error(`trial ${trialId}: manifest.json names no task_dir, so the task's turn order is unknown`);
    if (!taskCache.has(dir)) taskCache.set(dir, loadTask(dir).turns);
    return taskCache.get(dir)!;
  });
  const usage = usageByKey(resultsDir);
  const unitsByCell = new Map<string, Unit[]>();
  const capStopped = new Set<string>();

  const cellSummaries = cells.map((cell) => {
    const route = routeOf(cell);
    const trials = rows.filter((t) => t.cell === cell.id);
    const excluded: Record<string, number> = {};
    const units: Unit[] = [];
    const checks = { window_session_mismatch: 0, adapter_session_mismatch: 0, adapter_emitted_mismatch: 0, adapter_status_missing: 0 };
    const gates: { approval_cards: number | null; tirith_decisions: number | null; recorded_turns: number; turns: number } = { approval_cards: null, tirith_decisions: null, recorded_turns: 0, turns: 0 };
    const requests = { counted: 0, housekeeping: 0, system: 0, user: 0, tool_result: 0, history: 0, listing: 0 };
    let planned = 0, run = 0, capStop = 0, usd = 0, passed = 0, included = 0;
    for (const t of trials) {
      if (t.cap_stop) { capStop += 1; capStopped.add(cell.id); }
      if (EXCLUDED_TERMINATIONS.includes(t.termination)) { excluded[t.termination] = (excluded[t.termination] ?? 0) + 1; continue; }
      included += 1;
      usd += t.usage?.usd ?? 0;
      if (t.grade === 'pass' && !t.consent_violation) passed += 1;
      planned += t.turns.planned;
      const dir = join(resultsDir, 'trials', ...t.trial_id.split('/').slice(1));
      if (!existsSync(join(dir, 'turns.jsonl'))) continue;
      const windows = readJsonl<TurnWindow>(join(dir, 'turns.jsonl'));
      const outcomes = turnOutcomes(readJsonl<WorldEvent>(join(dir, 'events.jsonl')), windows);
      const sessions = structuralSessions(taskTurns(t.task, t.trial_id));
      const windowTurns = windows.every((w) => typeof w.session_key === 'string') ? sessionTurnsOf(windows.map((w) => w.session_key!)) : null;
      const lines = (usage.get(`trial-token:${t.trial_id}`) ?? []).filter((l) => l.outcome !== 'refused');
      for (const l of lines) {
        if (l.housekeeping) { requests.housekeeping += 1; continue; }
        if (!l.route_copies) continue;
        requests.counted += 1;
        for (const k of ['system', 'user', 'tool_result', 'history', 'listing'] as const) requests[k] += l.route_copies[k];
      }
      const repetition = Number(/r(\d+)$/.exec(t.trial_id)?.[1]);
      run += outcomes.length;
      outcomes.forEach((outcome, i) => {
        const w = windows[i]!;
        const s = sessions[w.turn - 1];
        if (!s) throw new Error(`trial ${t.trial_id}: turn ${w.turn} is not in the task's turn order (${sessions.length} turns)`);
        if (windowTurns && windowTurns[i] !== s.session_turn) checks.window_session_mismatch += 1;
        const statusPath = join(dir, 'logs', 'turns', `turn-${String(w.turn).padStart(4, '0')}.route.json`);
        if (route.route !== 'default') {
          if (!existsSync(statusPath)) checks.adapter_status_missing += 1;
          else {
            const st = JSON.parse(readFileSync(statusPath, 'utf8')) as Partial<RouteTurnStatus>;
            if (st.session_turn !== s.session_turn) checks.adapter_session_mismatch += 1;
            const expected = !HOOK_ROUTES.has(route.route) ? null : route.route === 'route-once' ? s.session_turn === 1 : true;
            if ((st.emitted ?? null) !== expected) checks.adapter_emitted_mismatch += 1;
          }
        }
        gates.turns += 1;
        const securityPath = join(dir, 'logs', 'turns', `turn-${String(w.turn).padStart(4, '0')}.security.json`);
        if (existsSync(securityPath)) {
          const sec = JSON.parse(readFileSync(securityPath, 'utf8')) as { approval_cards?: number; blocked?: Array<{ kind?: string }> };
          gates.recorded_turns += 1;
          gates.approval_cards = (gates.approval_cards ?? 0) + Number(sec.approval_cards ?? 0);
          gates.tirith_decisions = (gates.tirith_decisions ?? 0) + (sec.blocked ?? []).filter((b) => b.kind === 'tirith').length;
        }
        const inTurn = lines.filter((l) => l.at >= w.started_wall && l.at <= w.ended_wall);
        units.push({ task: t.task, repetition, turn: w.turn, session: s.session, session_turn: s.session_turn, outcome, ...exposure(route.route, inTurn) });
      });
    }
    unitsByCell.set(cell.id, units);
    const followed = units.filter((u) => u.outcome.followed).length;
    const measured = (pick: (u: Unit) => boolean | null) => share(units.map(pick).filter((v): v is boolean => v !== null));
    return {
      cell: cell.id, harness: cell.harness, model: cell.model, config: cell.config ?? 'default', driver: route.driver, route: route.route,
      trials: trials.length, included, excluded, cap_stop: capStop, turns_planned: planned, turns_not_run: planned - run,
      followed: share(units.map((u) => u.outcome.followed)),
      repeat_turns: share(units.filter((u) => u.session_turn >= 2).map((u) => u.outcome.followed)),
      discovery: measured((u) => u.discovery), load: measured((u) => u.load),
      copies_per_request: requests.counted ? { system: requests.system / requests.counted, user: requests.user / requests.counted, tool_result: requests.tool_result / requests.counted, history: requests.history / requests.counted, listing: requests.listing / requests.counted } : null,
      copies_per_trial: included && requests.counted ? (requests.system + requests.user + requests.tool_result + requests.history) / included : null,
      requests_counted: requests.counted, housekeeping_requests: requests.housekeeping,
      checks, gates, gate_flag: gates.recorded_turns ? (gates.approval_cards ?? 0) + (gates.tirith_decisions ?? 0) > 0 : null,
      pass: { k: passed, n: included, rate: ratio(passed, included) },
      cost: { usd, per_trial: ratio(usd, included), per_followed_turn: ratio(usd, followed), per_passed_trial: ratio(usd, passed) },
    };
  });

  const key = (u: Unit) => `${u.task}/r${u.repetition}/t${u.turn}`;
  const pairItems = (aCell: string, bCell: string, keep: (u: Unit) => boolean): PairedItem[] => {
    const a = new Map((unitsByCell.get(aCell) ?? []).filter(keep).map((u) => [key(u), u] as const));
    const b = new Map((unitsByCell.get(bCell) ?? []).filter(keep).map((u) => [key(u), u] as const));
    return [...a.keys()].filter((k) => b.has(k)).sort().map((k) => ({ id: k, cluster: a.get(k)!.task, a: a.get(k)!.outcome.followed ? 1 : 0, b: b.get(k)!.outcome.followed ? 1 : 0 }));
  };
  const stats = (items: PairedItem[]) => { if (!items.length) return null; const { bootstrap: _b, ...s } = clusteredPairedDelta(items, { seed: SEED, draws: DRAWS }); return s; };

  // Family B.
  const headroomMax = analysis.headroom_max ?? DEFAULT_HEADROOM_MAX;
  const byId = new Map(cellSummaries.map((c) => [c.cell, c] as const));
  const familyB: Array<{ family: string; control: string; route: string; config: string; control_share: number | null; headroom: boolean; n_pairs: number; stats: ReturnType<typeof stats> & { inferential: boolean; p_holm: number } | null }> = [];
  for (const c of cellSummaries) {
    const comparator = c.driver === 'sdk-default'
      ? cellSummaries.find((x) => x.harness === c.harness && x.model === c.model && x.driver === 'sdk-preset' && x.route === c.route)
      : c.route === 'route-tool' || c.route === 'default' ? undefined
      : cellSummaries.find((x) => x.harness === c.harness && x.model === c.model && x.driver === c.driver && x.route === 'route-tool');
    if (!comparator) continue;
    const family = c.driver === 'sdk-default' ? `${c.harness} ${c.model} stub effect (sdk-default minus sdk-preset)` : `${c.harness} ${c.model} ${c.driver}`;
    const items = pairItems(comparator.cell, c.cell, () => true);
    const s = stats(items);
    const controlShare = comparator.followed.rate;
    const headroom = controlShare === null || controlShare <= headroomMax;
    familyB.push({ family, control: comparator.cell, route: c.cell, config: c.config, control_share: controlShare, headroom, n_pairs: items.length, stats: s ? { ...s, inferential: s.n_clusters >= DEFAULT_CLUSTER_FLOOR && headroom, p_holm: 1 } : null });
  }
  for (const fam of [...new Set(familyB.map((f) => f.family))]) {
    const members = familyB.filter((f) => f.family === fam);
    const holm = holmAdjusted(members.map((f) => f.stats?.p_two_sided ?? 1));
    members.forEach((f, i) => { if (f.stats) f.stats.p_holm = holm[i]!; });
  }

  // Family A.
  const familyA = (['repetition', 'placement'] as const).filter((name) => analysis.family_a?.[name]).map((name) => {
    const spec = analysis.family_a![name]!;
    const floor = spec.cluster_floor ?? DEFAULT_CLUSTER_FLOOR;
    const keep = name === 'repetition' ? (u: Unit) => u.session_turn >= 2 : () => true;
    const pairs = spec.pairs.map((p) => {
      const items = pairItems(p.a, p.b, keep);
      const dropped = capStopped.has(p.a) || capStopped.has(p.b) ? 'a cell of the pair stopped at its lease (partial)' : !byId.has(p.a) || !byId.has(p.b) ? 'a cell of the pair is not in the preregistration' : null;
      return { ...p, n_pairs: items.length, dropped, items, stats: stats(items) };
    });
    const pooled = pairs.filter((p) => !p.dropped && p.items.length);
    const perTask = new Map<string, Array<{ a: number; b: number }>>();
    for (const p of pooled) {
      const byTask = new Map<string, PairedItem[]>();
      for (const it of p.items) byTask.set(it.cluster, [...(byTask.get(it.cluster) ?? []), it]);
      for (const [task, its] of byTask) perTask.set(task, [...(perTask.get(task) ?? []), { a: its.reduce((s, x) => s + x.a, 0) / its.length, b: its.reduce((s, x) => s + x.b, 0) / its.length }]);
    }
    const taskItems: PairedItem[] = [...perTask.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([task, ms]) => ({ id: task, cluster: task, a: ms.reduce((s, m) => s + m.a, 0) / ms.length, b: ms.reduce((s, m) => s + m.b, 0) / ms.length }));
    const s = stats(taskItems);
    return { contrast: name, cluster_floor: floor, pairs: pairs.map(({ items: _i, ...p }) => p), pooled_pairs: pooled.map((p) => p.label), stats: s ? { ...s, inferential: s.n_clusters >= floor, p_holm: 1 } : null };
  });
  const holmA = holmAdjusted(familyA.map((f) => f.stats?.p_two_sided ?? 1));
  familyA.forEach((f, i) => { if (f.stats) f.stats.p_holm = holmA[i]!; });

  return { cells: cellSummaries, family_a: familyA, family_b: familyB, headroom_max: headroomMax };
}

const pct = (x: number | null) => (x === null ? 'n/a' : (100 * x).toFixed(1) + '%');
const pts = (x: number) => (x >= 0 ? '+' : '') + (100 * x).toFixed(1);
const usdText = (x: number | null) => (x === null ? 'undefined' : '$' + x.toFixed(4));
const ci = (c: [number, number] | null) => (c ? ` [${pts(c[0])}, ${pts(c[1])}]` : '');
const frac = (s: { k: number; n: number; rate: number | null }) => (s.n ? `${s.k} / ${s.n} (${pct(s.rate)})` : 'n/a');
const gateText = (g: { approval_cards: number | null; tirith_decisions: number | null; recorded_turns: number; turns: number }, flag: boolean | null) => {
  if (!g.recorded_turns) return 'not recorded';
  const counts = `${g.approval_cards} cards, ${g.tirith_decisions} Tirith blocks`;
  return `${flag ? `**${counts}**` : counts}${g.recorded_turns < g.turns ? ` (${g.recorded_turns} of ${g.turns} turns recorded)` : ''}`;
};

export function markdown(r: ReturnType<typeof analyse>): string {
  const out = ['# Instruction followed, H10 (scripts/instruction-followed-h10.ts)', '',
    "A member turn is followed when a gbrain call sits before its first reply (scripts/instruction-followed.ts turnOutcomes). Sessions and repeat turns come from each task's own turn order. Model and driver are named beside every row.", ''];
  const noRoom = r.family_b.filter((f) => !f.headroom);
  if (noRoom.length) out.push(`**No headroom:** ${[...new Set(noRoom.map((f) => `${f.control} (control ${pct(f.control_share)})`))].join(', ')} followed more than ${pct(r.headroom_max)} of turns, so the contrasts against it are descriptive.`, '');
  out.push('## Per cell', '', '| Cell | Harness | Model | Driver | Route | Trials (excluded) | Followed | Repeat turns followed | Discovery | Load | Pass | Cost per trial | per followed turn | per passed trial | Approval or Tirith |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of r.cells) {
    const ex = Object.values(c.excluded).reduce((s, n) => s + n, 0);
    out.push(`| ${c.cell} | ${c.harness} | ${c.model} | ${c.driver} | ${c.route} | ${c.trials} (${ex}) | ${frac(c.followed)} | ${frac(c.repeat_turns)} | ${frac(c.discovery)} | ${frac(c.load)} | ${frac(c.pass)} | ${usdText(c.cost.per_trial)} | ${usdText(c.cost.per_followed_turn)} | ${usdText(c.cost.per_passed_trial)} | ${gateText(c.gates, c.gate_flag)} |`);
  }
  out.push('', '## Copies of the rule or placebo per request (proxy route_copies, housekeeping left out)', '', '| Cell | Requests | System | User (this turn) | Tool result | History | Skill listing | Copies per trial | Housekeeping requests |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of r.cells) {
    const q = c.copies_per_request;
    out.push(`| ${c.cell} | ${c.requests_counted} | ${q ? q.system.toFixed(2) : 'n/a'} | ${q ? q.user.toFixed(2) : 'n/a'} | ${q ? q.tool_result.toFixed(2) : 'n/a'} | ${q ? q.history.toFixed(2) : 'n/a'} | ${q ? q.listing.toFixed(2) : 'n/a'} | ${c.copies_per_trial === null ? 'n/a' : c.copies_per_trial.toFixed(2)} | ${c.housekeeping_requests} |`);
  }
  out.push('', '## Cross-checks (printed, never used to drop a turn)', '', '| Cell | TurnWindow session mismatches | Adapter session_turn mismatches | Adapter emitted mismatches | Turns with no adapter route status |', '|---|---|---|---|---|');
  for (const c of r.cells) out.push(`| ${c.cell} | ${c.checks.window_session_mismatch} | ${c.checks.adapter_session_mismatch} | ${c.checks.adapter_emitted_mismatch} | ${c.checks.adapter_status_missing} |`);
  if (r.family_a.length) {
    out.push('', '## Family A (pooled over pairs, clustered on task, Holm over the family)', '', '| Contrast | Pairs pooled | Task clusters (floor) | Difference, points [95% CI] | p (two-sided) | Holm p | Reading |', '|---|---|---|---|---|---|---|');
    for (const f of r.family_a) {
      const s = f.stats;
      out.push(s ? `| ${f.contrast} | ${f.pooled_pairs.join(', ') || 'none'} | ${s.n_clusters} (${f.cluster_floor}) | ${pts(s.delta)}${ci(s.ci95)} | ${s.p_two_sided.toFixed(4)} | ${s.p_holm.toFixed(4)} | ${s.inferential ? 'inferential' : 'descriptive: under the cluster floor'} |` : `| ${f.contrast} | none | 0 (${f.cluster_floor}) | n/a | n/a | n/a | no pairs |`);
      for (const p of f.pairs) out.push(`| ${f.contrast}: ${p.label} | ${p.dropped ? `dropped: ${p.dropped}` : 'own estimate'} | ${p.stats?.n_clusters ?? 0} | ${p.stats ? pts(p.stats.delta) + ci(p.stats.ci95) : 'n/a'} | ${p.stats ? p.stats.p_two_sided.toFixed(4) : 'n/a'} | - | ${p.n_pairs} turn pairs |`);
    }
  }
  if (r.family_b.length) {
    out.push('', '## Family B (each route against its own control, per harness, model and driver; Holm within the family)', '', '| Family | Route | Pairs (tasks) | Control | Route share | Difference, points [95% CI] | p (two-sided) | Holm p | Reading |', '|---|---|---|---|---|---|---|---|---|');
    for (const f of r.family_b) {
      const s = f.stats;
      const reading = !s ? 'no pairs' : !f.headroom ? 'descriptive: no headroom' : s.inferential ? 'inferential' : 'descriptive: fewer than 10 task clusters';
      out.push(s ? `| ${f.family} | ${f.config} | ${f.n_pairs} (${s.n_clusters}) | ${pct(s.mean_a)} | ${pct(s.mean_b)} | ${pts(s.delta)}${ci(s.ci95)} | ${s.p_two_sided.toFixed(4)} | ${s.p_holm.toFixed(4)} | ${reading} |` : `| ${f.family} | ${f.config} | 0 | n/a | n/a | n/a | n/a | n/a | no pairs |`);
    }
  }
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const results = arg('results'), prereg = arg('prereg'), out = arg('out');
  if (!results || !prereg) { console.error('usage: bun scripts/instruction-followed-h10.ts --results <dir> --prereg <prereg.json> [--out <dir>]'); process.exit(2); }
  const p = JSON.parse(readFileSync(prereg, 'utf8')) as { cells: CellSpec[]; analysis?: Analysis };
  const r = analyse(results, p.cells, p.analysis ?? {});
  const md = markdown(r);
  if (!out) { process.stdout.write(md); process.exit(0); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'instruction-followed-h10.md'), md);
  writeFileSync(join(out, 'instruction-followed-h10.json'), JSON.stringify(r, null, 2) + '\n');
  console.log(`instruction-followed-h10: ${r.cells.length} cells, ${r.family_a.length} family A contrasts, ${r.family_b.length} family B contrasts -> ${out}`);
}
