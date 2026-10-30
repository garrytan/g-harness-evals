#!/usr/bin/env bun
// The primary endpoint of run anatomy-instruction-route-2026-11 (HARN-15), keyless: the share of member turns in which the
// bot called gbrain before its first reply of that turn, per cell, and each route against its harness's control.
//
//   bun scripts/instruction-followed.ts --results <merged results dir> --prereg <prereg.json> [--control route-tool]
//     [--cells <id,id,...>] [--tasks <id,id,...>] [--out <dir>]
//
// Read from the evaluator's own records of each trial under <results>/trials/<cell>/<task>/r<k>/ (the trial id without its run):
//   turns.jsonl   one TurnWindow per member turn (runner/contracts.ts): turn, started_seq, ended_seq, reply_ts.
//   events.jsonl  the world's event log (world/services/events.ts): seq, via, tool, outcome, effect.
// A member turn is one line of turns.jsonl. Its window is the events with started_seq < seq <= ended_seq.
// Its first reply is the earlier of
//   - the first chat.postMessage event with via "mcp" and outcome "ok" inside the window (the bot posting through world-MCP), and
//   - the chat.postMessage event with via "slack" and outcome "ok" whose effect.ts equals the turn's reply_ts (the runner
//     posting the turn's reply_text after it read the response, so its seq is past ended_seq).
// The turn is followed when a gbrain tool call (gbrain-usage.ts isGbrainCall: a via "gbrain" event other than initialize and
// tools/list, any outcome) sits inside the window with a seq below the first reply's. The gbrain tap appends its event when
// gbrain's answer comes back, so a call still in flight when the bot posts does not count. A turn with no reply (reply_ts
// null and no world-MCP post in its window) is followed when any gbrain call sits inside its window; such turns stay in the
// denominator and are also counted apart.
// Trials ending model_error, infra_error or exam_fault are excluded with their counts. Planned turns a trial never ran are
// not member turns; they are counted as not run.
// Intervals: task-clustered bootstrap of the pooled share, 10,000 draws, seed 7. A route against the control of its harness
// (same harness, config --control): turns paired on task, repetition index and turn number, clustered on task,
// runner/stats/paired.ts clusteredPairedDelta (bootstrap interval, exact sign-flip p up to 20 clusters), Holm within each
// harness over its routes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnWindow } from '../runner/contracts.ts';
import { clusteredPairedDelta, holmAdjusted, seededRandom, type PairedItem } from '../runner/stats/paired.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { isGbrainCall } from './gbrain-usage.ts';

export const EXCLUDED_TERMINATIONS = ['model_error', 'infra_error', 'exam_fault'];
const DRAWS = 10_000;
const SEED = 7;

export interface TurnOutcome {
  turn: number;
  followed: boolean;
  /** Followed through gbrain search or query, the two tools the instruction names. Descriptive. */
  followed_search_query: boolean;
  /** Where the first reply came from: a world-MCP post inside the window, the runner's post of reply_text, or none. */
  reply: 'world_post' | 'runner_reply' | 'none';
  first_reply_seq: number | null;
  gbrain_calls_before_reply: number;
}

export function turnOutcomes(events: WorldEvent[], turns: TurnWindow[]): TurnOutcome[] {
  const posts = events.filter((e) => e.tool === 'chat.postMessage' && e.outcome === 'ok').sort((a, b) => a.seq - b.seq);
  return turns.map((w) => {
    const inWindow = (e: WorldEvent) => e.seq > w.started_seq && e.seq <= w.ended_seq;
    const worldPost = posts.find((e) => e.via === 'mcp' && inWindow(e));
    const runnerReply = w.reply_ts === null ? undefined : posts.find((e) => e.via === 'slack' && (e.effect as { ts?: unknown } | undefined)?.ts === w.reply_ts);
    if (w.reply_ts !== null && !runnerReply) throw new Error(`turn ${w.turn}: reply_ts ${w.reply_ts} has no chat.postMessage event in events.jsonl`);
    const first = [worldPost, runnerReply].filter((e): e is WorldEvent => e !== undefined).sort((a, b) => a.seq - b.seq)[0];
    const before = events.filter((e) => isGbrainCall(e) && inWindow(e) && (!first || e.seq < first.seq));
    return {
      turn: w.turn,
      followed: before.length > 0,
      followed_search_query: before.some((e) => e.tool === 'gbrain.search' || e.tool === 'gbrain.query'),
      reply: !first ? 'none' : first === worldPost ? 'world_post' : 'runner_reply',
      first_reply_seq: first?.seq ?? null,
      gbrain_calls_before_reply: before.length,
    };
  });
}

interface TrialRow { trial_id: string; cell: string; task: string; termination: string; cap_stop?: boolean; turns: { planned: number } }
interface CellSpec { id: string; harness: string; config?: string }
interface Unit { task: string; repetition: number; outcome: TurnOutcome }
export interface Share { k: number; n: number; rate: number | null; ci95: [number, number] | null; tasks: number }

const readJsonl = <T>(path: string): T[] => {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
};

function share(units: Unit[], pick: (u: Unit) => boolean = (u) => u.outcome.followed): Share {
  const byTask = new Map<string, { n: number; k: number }>();
  for (const u of units) {
    const c = byTask.get(u.task) ?? { n: 0, k: 0 };
    c.n += 1;
    if (pick(u)) c.k += 1;
    byTask.set(u.task, c);
  }
  const clusters = [...byTask.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
  const n = units.length, k = units.filter(pick).length;
  if (!n) return { k, n, rate: null, ci95: null, tasks: 0 };
  if (clusters.length < 2) return { k, n, rate: k / n, ci95: null, tasks: clusters.length };
  const rng = seededRandom(SEED);
  const boot: number[] = [];
  for (let i = 0; i < DRAWS; i++) {
    let kk = 0, nn = 0;
    for (let j = 0; j < clusters.length; j++) {
      const c = clusters[Math.floor(rng() * clusters.length)]!;
      kk += c.k;
      nn += c.n;
    }
    boot.push(kk / nn);
  }
  boot.sort((a, b) => a - b);
  return { k, n, rate: k / n, ci95: [boot[Math.floor(DRAWS * 0.025)]!, boot[Math.ceil(DRAWS * 0.975) - 1]!], tasks: clusters.length };
}

export function analyse(resultsDir: string, cells: CellSpec[], control = 'route-tool', tasks?: string[]) {
  const rows = readJsonl<TrialRow>(join(resultsDir, 'trials.jsonl')).filter((t) => !tasks || tasks.includes(t.task));
  const unitsByCell = new Map<string, Unit[]>();
  const cellSummaries = cells.map((cell) => {
    const trials = rows.filter((t) => t.cell === cell.id);
    const excluded: Record<string, number> = {};
    const units: Unit[] = [];
    let planned = 0, run = 0, capStop = 0, noTurnsLog = 0;
    for (const t of trials) {
      if (EXCLUDED_TERMINATIONS.includes(t.termination)) {
        excluded[t.termination] = (excluded[t.termination] ?? 0) + 1;
        if (t.cap_stop) capStop += 1;
        continue;
      }
      const dir = join(resultsDir, 'trials', ...t.trial_id.split('/').slice(1));
      const turnsLog = join(dir, 'turns.jsonl');
      if (!existsSync(turnsLog) && t.termination !== 'harness_error') throw new Error(`missing ${turnsLog} (termination ${t.termination})`);
      if (!existsSync(turnsLog)) noTurnsLog += 1;
      const outcomes = existsSync(turnsLog) ? turnOutcomes(readJsonl<WorldEvent>(join(dir, 'events.jsonl')), readJsonl<TurnWindow>(turnsLog)) : [];
      planned += t.turns.planned;
      run += outcomes.length;
      const repetition = Number(/r(\d+)$/.exec(t.trial_id)?.[1]);
      for (const outcome of outcomes) units.push({ task: t.task, repetition, outcome });
    }
    unitsByCell.set(cell.id, units);
    const byTurn: Record<string, { turns: number; followed: number }> = {};
    for (const u of units) {
      const b = (byTurn[u.outcome.turn] ??= { turns: 0, followed: 0 });
      b.turns += 1;
      if (u.outcome.followed) b.followed += 1;
    }
    const noReply = units.filter((u) => u.outcome.reply === 'none');
    return {
      cell: cell.id, harness: cell.harness, config: cell.config ?? 'default',
      trials: trials.length, excluded, cap_stop: capStop, no_turns_log: noTurnsLog, turns_planned: planned, turns_not_run: planned - run,
      followed: share(units),
      followed_search_query: share(units, (u) => u.outcome.followed_search_query),
      replied_turns_only: share(units.filter((u) => u.outcome.reply !== 'none')),
      no_reply_turns: noReply.length, no_reply_followed: noReply.filter((u) => u.outcome.followed).length,
      first_reply: { world_post: units.filter((u) => u.outcome.reply === 'world_post').length, runner_reply: units.filter((u) => u.outcome.reply === 'runner_reply').length },
      by_turn: byTurn,
    };
  });

  const comparisons = [];
  for (const harness of [...new Set(cells.map((c) => c.harness))]) {
    const base = cells.find((c) => c.harness === harness && c.config === control);
    if (!base) continue;
    const key = (u: Unit) => `${u.task}/r${u.repetition}/t${u.outcome.turn}`;
    const a = new Map(unitsByCell.get(base.id)!.map((u) => [key(u), u] as const));
    const family = cells.filter((c) => c.harness === harness && c.id !== base.id).map((cell) => {
      const b = new Map(unitsByCell.get(cell.id)!.map((u) => [key(u), u] as const));
      const pairs: PairedItem[] = [...a.keys()].filter((id) => b.has(id)).sort().map((id) => ({ id, cluster: a.get(id)!.task, a: a.get(id)!.outcome.followed ? 1 : 0, b: b.get(id)!.outcome.followed ? 1 : 0 }));
      const unpaired = { control: [...a.keys()].filter((id) => !b.has(id)).length, route: [...b.keys()].filter((id) => !a.has(id)).length };
      const head = { harness, control: base.id, route: cell.id, config: cell.config ?? 'default', n_pairs: pairs.length, unpaired };
      if (!pairs.length) return { ...head, stats: null };
      const { bootstrap: _bootstrap, ...stats } = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
      return { ...head, stats: { ...stats, inferential: stats.n_clusters >= 10, p_holm: 1 } };
    });
    const holm = family.length ? holmAdjusted(family.map((f) => f.stats?.p_two_sided ?? 1)) : [];
    family.forEach((f, i) => { if (f.stats) f.stats.p_holm = holm[i]!; });
    comparisons.push(...family);
  }
  return { control, cells: cellSummaries, comparisons };
}

const pct = (x: number | null) => (x === null ? 'n/a' : (100 * x).toFixed(1) + '%');
const pts = (x: number) => (x >= 0 ? '+' : '') + (100 * x).toFixed(1);
const interval = (ci: [number, number] | null, f: (x: number) => string) => (ci ? ` [${f(ci[0])}, ${f(ci[1])}]` : '');

export function markdown(r: ReturnType<typeof analyse>): string {
  const out = ['# Instruction followed (scripts/instruction-followed.ts)', '',
    "A member turn is followed when a gbrain tool call (any outcome) sits inside its window with a lower event seq than its first reply: the first world-MCP `chat.postMessage` in the window, or the runner's post of the turn's reply. A turn with no reply is followed when any gbrain call sits in its window. Intervals: task-clustered bootstrap, 10,000 draws, seed 7.", '',
    '## Per cell', '',
    '| Cell | Config | Trials (excluded) | Member turns (not run) | Followed | Share [95% CI, task-clustered] | Tasks | No-reply turns (followed) | Share on replied turns | Search or query before reply |',
    '|---|---|---|---|---|---|---|---|---|---|'];
  for (const c of r.cells) {
    const ex = Object.values(c.excluded).reduce((s, n) => s + n, 0);
    const f = c.followed;
    out.push(`| ${c.cell} | ${c.config} | ${c.trials} (${ex}) | ${f.n} (${c.turns_not_run}) | ${f.k} | ${pct(f.rate)}${interval(f.ci95, pct)} | ${f.tasks} | ${c.no_reply_turns} (${c.no_reply_followed}) | ${pct(c.replied_turns_only.rate)} | ${c.followed_search_query.k} |`);
  }
  const capStops = r.cells.filter((c) => c.cap_stop > 0 || c.no_turns_log > 0);
  if (capStops.length) out.push('', ...capStops.map((c) => '- ' + c.cell + ': ' + c.cap_stop + ' cap-stop trials (`model_error` with `cap_stop`, excluded); ' + c.no_turns_log + ' `harness_error` trials with no `turns.jsonl` (no turn ran, planned turns counted as not run).'));
  const maxTurn = Math.max(0, ...r.cells.flatMap((c) => Object.keys(c.by_turn).map(Number)));
  const turnCols = Array.from({ length: maxTurn }, (_, i) => i + 1);
  out.push('', '## By turn number (followed / member turns)', '', `| Cell | ${turnCols.map((t) => `Turn ${t}`).join(' | ')} |`, `|---|${'---|'.repeat(maxTurn)}`);
  for (const c of r.cells) out.push(`| ${c.cell} | ${turnCols.map((t) => (c.by_turn[t] ? `${c.by_turn[t]!.followed} / ${c.by_turn[t]!.turns}` : '-')).join(' | ')} |`);
  if (r.comparisons.length) {
    out.push('', `## Each route against ${r.control}, within its harness (Holm within the harness)`, '',
      '| Harness | Route | Pairs (tasks) | Control | Route | Difference, points [95% CI] | p (two-sided) | Holm p | Unpaired (control, route) |',
      '|---|---|---|---|---|---|---|---|---|');
    for (const c of r.comparisons) {
      const s = c.stats;
      const unpaired = `${c.unpaired.control}, ${c.unpaired.route}`;
      if (!s) { out.push(`| ${c.harness} | ${c.config} | 0 | n/a | n/a | n/a | n/a | n/a | ${unpaired} |`); continue; }
      const note = s.inferential ? '' : ' (descriptive: fewer than 10 task clusters)';
      out.push(`| ${c.harness} | ${c.config} | ${c.n_pairs} (${s.n_clusters}) | ${pct(s.mean_a)} | ${pct(s.mean_b)} | ${pts(s.delta)}${interval(s.ci95, pts)} | ${s.p_two_sided.toFixed(4)} (${s.p_method}) | ${s.p_holm.toFixed(4)}${note} | ${unpaired} |`);
    }
  }
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const results = arg('results'), prereg = arg('prereg'), out = arg('out');
  if (!results || !prereg) { console.error('usage: bun scripts/instruction-followed.ts --results <dir> --prereg <prereg.json> [--control route-tool] [--cells <id,...>] [--tasks <id,...>] [--out <dir>]'); process.exit(2); }
  const only = arg('cells')?.split(',');
  const cells = (JSON.parse(readFileSync(prereg, 'utf8')) as { cells: CellSpec[] }).cells.filter((c) => !only || only.includes(c.id));
  const r = analyse(results, cells, arg('control') ?? 'route-tool', arg('tasks')?.split(','));
  const md = markdown(r);
  if (!out) { process.stdout.write(md); process.exit(0); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'instruction-followed.md'), md);
  writeFileSync(join(out, 'instruction-followed.json'), JSON.stringify(r, null, 2) + '\n');
  console.log(`instruction-followed: ${r.cells.length} cells, ${r.comparisons.length} comparisons -> ${out}`);
}
