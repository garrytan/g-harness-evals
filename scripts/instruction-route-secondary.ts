#!/usr/bin/env bun
// internal-task, run anatomy-instruction-route-2026-11: the preregistration's secondary endpoints that summarize-run.ts does not
// pair. Per cell, the route evidence (logs/instruction-route.json and the ready file). Within each harness, every route
// against route-tool, paired on task and repetition index: pass, USD, forwarded requests, input, output and cached tokens.
// Task-clustered paired bootstrap (seed 7, 10,000 draws) and exact sign-flip p, with no Holm: these are descriptive.
// A pair with an excluded side leaves the pairing and is counted per side (left_pairing); a scored trial with no
// partner trial at all, or whose forwarded requests in the proxy logs differ from usage.json, stops the script.
// Per cell, the mean of each per trial with a task-clustered bootstrap interval (tasks resampled, seed 7, 10,000 draws).
// Per route cell, the surface-table arithmetic the preregistration sets the input-token difference against: the bytes the
// route adds per copy (harnesses/routes/README.md, "Where the bytes land") times the copies per request, summed over the
// trial's forwarded requests in <shard>.proxy-usage.ndjson. One copy per request, except route-hook: a hook request on turn N
// carries one copy for each turn up to N in the same harness session (adapter.log "turn N: session <key>"), since each
// session keeps its own history. A hook request is put in the turn whose wall window holds its time; when none does, in
// the last turn whose window widened by one second either side holds it, else the trial's last turn (counted unassigned).
//
//   bun scripts/instruction-route-secondary.ts --results <merged results> --prereg <prereg.json> [--out <dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, seededRandom, type PairedItem } from '../runner/stats/paired.ts';
import { EXCLUDED_TERMINATIONS } from './instruction-followed.ts';

const SEED = 7, DRAWS = 10_000;
const INSTRUCTION_SHA256 = '4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f';
interface Cell { id: string; harness: string; config?: string }
interface Row { trial_id: string; cell: string; task: string; termination: string; grade: string; consent_violation: boolean }
interface Usage { usd: number; requests: number; input_tokens: number; output_tokens: number; cached_tokens: number }
const METRICS = ['pass', 'usd', 'requests', 'input_tokens', 'output_tokens', 'cached_tokens'] as const;
const ROUTE_BYTES: Record<string, Record<string, number>> = {
  openclaw: { 'route-startup': 246, 'route-hook': 291, 'route-skill': 192 },
  hermes: { 'route-system': 291, 'route-startup': 291, 'route-hook': 291, 'route-skill': 81 },
};
interface Turn { turn: number; started_wall: string; ended_wall: string }
type Metric = (typeof METRICS)[number];

const json = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);

function clusteredMean(byKey: Map<string, Record<Metric, number>>, m: Metric) {
  const byTask = new Map<string, number[]>();
  for (const [k, v] of byKey) { const t = k.split('/')[0]!; byTask.set(t, [...(byTask.get(t) ?? []), v[m]]); }
  const tasks = [...byTask.values()];
  if (!tasks.length) return { mean: null, ci95: null, n: 0, clusters: 0 };
  const meanOf = (sample: number[][]) => { const flat = sample.flat(); return flat.length ? flat.reduce((s, x) => s + x, 0) / flat.length : 0; };
  const rnd = seededRandom(SEED);
  const stats: number[] = [];
  for (let i = 0; i < DRAWS; i++) stats.push(meanOf(tasks.map(() => tasks[Math.floor(rnd() * tasks.length)]!)));
  stats.sort((a, b) => a - b);
  return { mean: meanOf(tasks), ci95: tasks.length < 2 ? null : [stats[Math.floor(0.025 * DRAWS)]!, stats[Math.ceil(0.975 * DRAWS) - 1]!] as [number, number] | null, n: byKey.size, clusters: tasks.length };
}

function forwardedTimes(resultsDir: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of readdirSync(resultsDir).filter((n) => n.endsWith('.proxy-usage.ndjson')).sort()) {
    for (const l of readFileSync(join(resultsDir, f), 'utf8').split('\n').filter(Boolean)) {
      const o = JSON.parse(l) as { at: string; key?: string; outcome?: string };
      if (o.outcome !== 'forwarded' || !o.key?.startsWith('trial-token:')) continue;
      const k = o.key.slice('trial-token:'.length);
      out.set(k, [...(out.get(k) ?? []), Date.parse(o.at)]);
    }
  }
  return out;
}

export function analyse(resultsDir: string, cells: Cell[]) {
  const rows = readFileSync(join(resultsDir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
  const forwarded = forwardedTimes(resultsDir);
  const values = new Map<string, Map<string, Record<Metric, number>>>();
  const excluded = new Map<string, Set<string>>();
  const evidence = cells.map((cell) => {
    const trials = rows.filter((r) => r.cell === cell.id);
    if (!trials.length) throw new Error(cell.id + ': no trials in trials.jsonl');
    const byKey = new Map<string, Record<Metric, number>>();
    const out = new Set<string>();
    let routeOk = 0, readyOk = 0, unassigned = 0;
    const hook: Record<string, number> = {};
    const perCopy = ROUTE_BYTES[cell.harness]?.[cell.config ?? ''];
    const routeBytes: number[] = [];
    for (const t of trials) {
      const dir = join(resultsDir, 'trials', ...t.trial_id.split('/').slice(1));
      const route = json<{ status: string; route: string; instruction: { sha256: string } }>(join(dir, 'logs', 'instruction-route.json'));
      const ready = json<{ instruction_route?: { route: string; instruction_sha256: string; hook?: string } }>(join(dir, 'logs', 'ready'));
      if (route?.status === 'ok' && route.route === cell.config && route.instruction.sha256 === INSTRUCTION_SHA256) routeOk += 1;
      const ir = ready?.instruction_route;
      if (ir?.route === cell.config && ir?.instruction_sha256 === INSTRUCTION_SHA256) readyOk += 1;
      if (ir?.hook) hook[ir.hook] = (hook[ir.hook] ?? 0) + 1;
      const key = t.task + '/r' + /r(\d+)$/.exec(t.trial_id)![1];
      if (byKey.has(key) || out.has(key)) throw new Error(cell.id + ': two trials for ' + key);
      if (EXCLUDED_TERMINATIONS.includes(t.termination)) { out.add(key); continue; }
      const usage = json<Usage>(join(dir, 'usage.json'));
      if (!usage) throw new Error(t.trial_id + ': a scored trial has no usage.json');
      const times = forwarded.get(t.trial_id) ?? [];
      if (times.length !== usage.requests) throw new Error(t.trial_id + ': ' + times.length + ' forwarded requests in the proxy logs, ' + usage.requests + ' in usage.json');
      if (perCopy !== undefined) {
        if (cell.config !== 'route-hook' || !times.length) routeBytes.push(perCopy * times.length);
        else {
          const turns = readFileSync(join(dir, 'turns.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Turn);
          if (!turns.length) throw new Error(t.trial_id + ': turns.jsonl is empty');
          const last = Math.max(...turns.map((x) => x.turn));
          const session = new Map([...readFileSync(join(dir, 'logs', 'adapter.log'), 'utf8').matchAll(/turn (\d+): session ([^,\s]+)/g)].map((m) => [Number(m[1]), m[2]!]));
          if (turns.some((x) => !session.has(x.turn))) throw new Error(t.trial_id + ': adapter.log names no session for every turn');
          const copiesOn = (n: number) => turns.filter((x) => x.turn <= n && session.get(x.turn) === session.get(n)).length;
          let copies = 0;
          for (const at of times) {
            const within = (pad: number) => turns.filter((x) => Date.parse(x.started_wall) - pad <= at && at <= Date.parse(x.ended_wall) + pad);
            const exact = within(0);
            const inTurn = exact.length ? exact : within(1000);
            if (!inTurn.length) unassigned += 1;
            copies += copiesOn(inTurn.length ? inTurn[inTurn.length - 1]!.turn : last);
          }
          routeBytes.push(perCopy * copies);
        }
      }
      byKey.set(key, { pass: t.grade === 'pass' && !t.consent_violation ? 1 : 0, usd: usage.usd, requests: usage.requests, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cached_tokens: usage.cached_tokens });
    }
    values.set(cell.id, byKey);
    excluded.set(cell.id, out);
    return { cell: cell.id, harness: cell.harness, config: cell.config ?? 'default', trials: trials.length, route_record_ok: routeOk, ready_route_ok: readyOk, hook, per_trial: Object.fromEntries(METRICS.map((m) => [m, clusteredMean(byKey, m)])),
      route_bytes: perCopy === undefined ? null : { per_copy: perCopy, mean_per_trial: routeBytes.length ? routeBytes.reduce((s, x) => s + x, 0) / routeBytes.length : null, max_per_trial: routeBytes.length ? Math.max(...routeBytes) : null, unassigned_requests: unassigned } };
  });
  const comparisons = [];
  for (const harness of [...new Set(cells.map((c) => c.harness))]) {
    const base = cells.find((c) => c.harness === harness && c.config === 'route-tool');
    if (!base) continue;
    const a = values.get(base.id)!;
    for (const cell of cells.filter((c) => c.harness === harness && c.id !== base.id)) {
      const b = values.get(cell.id)!;
      const keys = [...a.keys()].filter((k) => b.has(k)).sort();
      const xa = excluded.get(base.id)!, xb = excluded.get(cell.id)!;
      const missing = [...[...a.keys()].filter((k) => !b.has(k) && !xb.has(k)), ...[...b.keys()].filter((k) => !a.has(k) && !xa.has(k))];
      if (missing.length) throw new Error(base.id + ' against ' + cell.id + ': scored trials with no partner trial ' + [...new Set(missing)].sort().join(', '));
      const left_pairing = { control_excluded: [...b.keys()].filter((k) => xa.has(k)).length, route_excluded: [...a.keys()].filter((k) => xb.has(k)).length };
      const metrics = !keys.length ? null : Object.fromEntries(METRICS.map((m) => {
        const pairs: PairedItem[] = keys.map((k) => ({ id: k, cluster: k.split('/')[0]!, a: a.get(k)![m], b: b.get(k)![m] }));
        const { bootstrap: _b, ...s } = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
        return [m, s];
      }));
      comparisons.push({ harness, control: base.id, route: cell.id, config: cell.config, n_pairs: keys.length, left_pairing, metrics });
    }
  }
  return { evidence, comparisons };
}

const fmt: Record<Metric, (x: number) => string> = {
  pass: (x) => (x >= 0 ? '+' : '') + (100 * x).toFixed(1),
  usd: (x) => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(4),
  requests: (x) => (x >= 0 ? '+' : '') + x.toFixed(1),
  input_tokens: (x) => (x >= 0 ? '+' : '') + Math.round(x).toLocaleString('en-US'),
  output_tokens: (x) => (x >= 0 ? '+' : '') + Math.round(x).toLocaleString('en-US'),
  cached_tokens: (x) => (x >= 0 ? '+' : '') + Math.round(x).toLocaleString('en-US'),
};
const orNa = (f: (x: number) => string) => (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : f(x));
const level: Record<Metric, (x: number) => string> = {
  pass: (x) => (100 * x).toFixed(1) + '%',
  usd: (x) => '$' + x.toFixed(4),
  requests: (x) => x.toFixed(1),
  input_tokens: (x) => Math.round(x).toLocaleString('en-US'),
  output_tokens: (x) => Math.round(x).toLocaleString('en-US'),
  cached_tokens: (x) => Math.round(x).toLocaleString('en-US'),
};

export function markdown(r: ReturnType<typeof analyse>): string {
  const out = ['# Instruction routes: route evidence and descriptive paired differences (scripts/instruction-route-secondary.ts)', '',
    'Descriptive only: no Holm, no decision sentence. Pairs are task and repetition index; intervals are a task-clustered paired bootstrap (seed 7, 10,000 draws); p is the exact two-sided sign flip over task clusters.', '',
    '## Route evidence per cell', '', '| Cell | Config | Trials | Route record names the route and sha256 | Ready file names them | Hook status (ready file) |', '|---|---|---|---|---|---|'];
  for (const e of r.evidence) out.push('| ' + e.cell + ' | ' + e.config + ' | ' + e.trials + ' | ' + e.route_record_ok + ' | ' + e.ready_route_ok + ' | ' + (Object.entries(e.hook).map(([k, v]) => k + ' ' + v).join(', ') || '-') + ' |');
  out.push('', '## Per cell, mean per trial [95% CI, task-clustered]', '', 'Requests are forwarded requests (`usage.requests`); refused requests are not counted.', '', '| Cell | Trials | Pass | USD | Requests | Input tokens | Output tokens | Cached tokens |', '|---|---|---|---|---|---|---|---|');
  for (const e of r.evidence) out.push('| ' + e.cell + ' | ' + e.per_trial.pass.n + ' | ' + METRICS.map((m) => { const s = e.per_trial[m]; const f = orNa(level[m]); return f(s.mean) + ' [' + f(s.ci95?.[0]) + ', ' + f(s.ci95?.[1]) + ']'; }).join(' | ') + ' |');
  out.push('', '## Route bytes per trial, from the surface table', '', 'Bytes the route adds per copy times the copies per request, summed over the trial\'s forwarded requests. One copy per request, except route-hook: one copy for each turn so far in the same harness session (adapter.log). At one token per byte this is the input-token difference the route alone would make.', '', '| Cell | Bytes per copy | Mean per trial | Most in a trial | Hook requests outside every turn window |', '|---|---|---|---|---|');
  for (const e of r.evidence) if (e.route_bytes) out.push('| ' + e.cell + ' | ' + e.route_bytes.per_copy + ' | ' + orNa((x) => Math.round(x).toLocaleString('en-US'))(e.route_bytes.mean_per_trial) + ' | ' + orNa((x) => x.toLocaleString('en-US'))(e.route_bytes.max_per_trial) + ' | ' + (e.config === 'route-hook' ? e.route_bytes.unassigned_requests : '-') + ' |');
  out.push('', '## Each route minus route-tool, per trial (pass in points)', '', '| Harness | Route | Pairs (tasks) | Pass [95% CI], p | USD | Requests | Input tokens | Output tokens | Cached tokens |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of r.comparisons) {
    const metrics = c.metrics;
    if (!metrics) { out.push('| ' + c.harness + ' | ' + c.config + ' | 0 (0) | ' + METRICS.map(() => 'no pairs').join(' | ') + ' |'); continue; }
    const cellOf = (m: Metric) => { const s = metrics[m] as { delta: number; ci95: [number, number] | null; p_two_sided: number }; const f = orNa(fmt[m]); return f(s.delta) + ' [' + f(s.ci95?.[0]) + ', ' + f(s.ci95?.[1]) + ']' + (m === 'pass' ? ', ' + s.p_two_sided.toFixed(4) : ''); };
    const n = (metrics.pass as { n_clusters: number }).n_clusters;
    out.push('| ' + c.harness + ' | ' + c.config + ' | ' + c.n_pairs + ' (' + n + ') | ' + METRICS.map(cellOf).join(' | ') + ' |');
  }
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const results = arg('results'), prereg = arg('prereg'), out = arg('out');
  if (!results || !prereg) { console.error('usage: bun scripts/instruction-route-secondary.ts --results <dir> --prereg <prereg.json> [--out <dir>]'); process.exit(2); }
  const r = analyse(results, (JSON.parse(readFileSync(prereg, 'utf8')) as { cells: Cell[] }).cells);
  const md = markdown(r);
  if (!out) { process.stdout.write(md); process.exit(0); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'route-secondary.md'), md);
  writeFileSync(join(out, 'route-secondary.json'), JSON.stringify(r, null, 2) + '\n');
  console.log('instruction-route-secondary: ' + r.evidence.length + ' cells, ' + r.comparisons.length + ' comparisons -> ' + out);
}
