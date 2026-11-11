#!/usr/bin/env bun
// Freezes the regression canary's task lists (plan decisions 2 and 3) from named receipts.
//
//   bun scripts/canary/select-tasks.ts [--seed <s>] [--out-dir docs/benchmarks/2026-11-09-regression-canary] [--check]
//
// gstack, per model: the Terminal-Bench 2.1 tasks the model's home cell (opus-cc, sol-codex) passed on both attempts in the
// frontier run's merged trials (branch harn50/frontier-results), less those whose mean home cost is over $1.00 a trial, then 30
// drawn in the shared order (ids sorted by sha256(seed + "\0" + id), as scripts/frontier-harbor/materialize.ts). t1 is the 4
// cheapest of the 30 by home cost; digest is 4 mid-difficulty tasks (home passed exactly one attempt, or only the other model's
// home cell passed both), drawn in the order of seed + ":digest".
// gbrain, per model: the same rule over the v0.3 dev-draw-2 receipts on main (harness-zero-h2h): Opus qualifies a task only
// when both Claude Code cells (no brain and gbrain) passed every repetition; Sol uses the Codex cell; 20 per model or all if
// fewer. particle-1 reuses Sol's list, labelled descriptive. A task under a sealed or held-out path is refused.
// Writes tasks-gstack.json and tasks-gbrain.json and prints pool sizes and mean costs. --check rebuilds and compares instead,
// reading the frontier receipts at the commit the frozen tasks-gstack.json records, so later reruns on that branch do not move it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ModelKey, TasksModel } from './decide.ts';

const ROOT = resolve(import.meta.dir, '../..');
export const DEFAULT_SEED = 'regression-canary-2026-11-09';
export const FRONTIER = { branch: 'harn50/frontier-results', path: 'docs/benchmarks/2026-11-07-frontier-harness/results/merged/trials.jsonl' };
export const GBRAIN_RECEIPTS = ['docs/benchmarks/2026-11-06-harness-zero-h2h/results/trials.jsonl'];
export const DEV_DRAW_2 = 'tasks/multiuser/v0.3/dev-draw-2/dev';
const MAX_HOME_USD = 1.0;
const MODELS = { opus: 'anthropic:claude-opus-5-5', sol: 'openai:gpt-6.1-sol', particle: 'particle:particle-1' } as const;

interface Trial { cell: string; task: string; termination: string; grade: string; consent_violation?: boolean; usage: { usd: number } | null; frontier?: { attempt: number } }
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/** The shared order: ids sorted by sha256(seed + "\0" + id), ties by id. Any prefix is a uniform random subset. */
export const sharedOrder = (ids: Iterable<string>, seed: string) =>
  [...ids].map((id) => ({ id, k: sha256(seed + '\0' + id) })).sort((a, b) => a.k.localeCompare(b.k) || a.id.localeCompare(b.id)).map((x) => x.id);
const passed = (t: Trial) => t.grade === 'pass' && !t.consent_violation;
const parse = (text: string) => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Trial);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 10000) / 10000;

/** Refuses any task that sits under a sealed or held-out path anywhere in the task tree, or (gbrain) outside the public dev split. */
export function refuseSealed(ids: readonly string[], opts: { taskRoot: string; publicDir?: string }): void {
  const sealed = /(^|\/)(heldout|held-out|sealed)(\/|$)/;
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      if (ids.includes(name) && sealed.test(relative(opts.taskRoot, p))) hits.push(relative(ROOT, p));
      walk(p, depth + 1);
    }
  };
  walk(opts.taskRoot, 0);
  if (opts.publicDir) for (const id of ids) if (!existsSync(join(opts.publicDir, id))) hits.push(`${id} (not in ${relative(ROOT, opts.publicDir)})`);
  for (const id of ids) if (sealed.test(id)) hits.push(id);
  if (hits.length) throw new Error('refusing sealed or held-out tasks: ' + hits.join(', '));
}

interface Pick { spec: TasksModel; pool: { qualified: number; after_cost_cut: number; drawn: number; mean_home_usd_pool: number; mean_home_usd_drawn: number; digest_candidates: number } }

function draw(pool: string[], cost: Map<string, number>, digestPool: string[], seed: string, take: number, spec: Omit<TasksModel, 'tasks' | 't1' | 'digest'>, qualified: number): Pick {
  const tasks = sharedOrder(pool, seed).slice(0, take);
  const t1 = [...tasks].sort((a, b) => cost.get(a)! - cost.get(b)! || a.localeCompare(b)).slice(0, 4);
  const digest = sharedOrder(digestPool, seed + ':digest').slice(0, 4);
  return {
    spec: { ...spec, tasks, t1, digest },
    pool: { qualified, after_cost_cut: pool.length, drawn: tasks.length, mean_home_usd_pool: round(mean(pool.map((t) => cost.get(t)!))), mean_home_usd_drawn: round(mean(tasks.map((t) => cost.get(t)!))), digest_candidates: digestPool.length },
  };
}

function byCell(rows: Trial[], cell: string) {
  const m = new Map<string, Trial[]>();
  for (const r of rows) if (r.cell === cell) m.set(r.task, [...(m.get(r.task) ?? []), r]);
  return m;
}

export function selectGstack(rows: Trial[], seed: string) {
  const home: Record<'opus' | 'sol', string> = { opus: 'opus-cc', sol: 'sol-codex' };
  const harness = { opus: 'claude-code', sol: 'codex' };
  const out: Partial<Record<ModelKey, Pick>> = {};
  for (const mk of ['opus', 'sol'] as const) {
    const mine = byCell(rows, home[mk]), other = byCell(rows, home[mk === 'opus' ? 'sol' : 'opus']);
    const passes = (m: Map<string, Trial[]>, t: string) => (m.get(t) ?? []).filter(passed).length;
    const both = (m: Map<string, Trial[]>, t: string) => (m.get(t) ?? []).length === 2 && passes(m, t) === 2;
    const cost = new Map([...mine].map(([t, rs]) => [t, mean(rs.map((r) => r.usage?.usd ?? 0))]));
    const qualified = [...mine.keys()].filter((t) => both(mine, t));
    const pool = qualified.filter((t) => cost.get(t)! <= MAX_HOME_USD);
    const digestPool = [...mine.keys()].filter((t) => (mine.get(t)!.length === 2 && passes(mine, t) === 1) || (both(other, t) && passes(mine, t) === 0));
    out[mk] = draw(pool, cost, digestPool, seed, 30, { harness: harness[mk], model: MODELS[mk] }, qualified.length);
  }
  return out;
}

export function selectGbrain(rows: Trial[], seed: string) {
  const cells = { opus: ['claude-code-opus-none-mu-v03-dev2', 'claude-code-opus-gbrain-mu-v03-dev2'], sol: ['codex-sol-none-mu-v03-dev2'] };
  const out: Partial<Record<ModelKey, Pick>> = {};
  const all = (cs: string[], t: string) => cs.every((c) => { const rs = byCell(rows, c).get(t) ?? []; return rs.length > 0 && rs.every(passed); });
  const none = (cs: string[], t: string) => cs.every((c) => (byCell(rows, c).get(t) ?? []).every((r) => !passed(r)));
  const tasks = [...new Set(rows.map((r) => r.task))].sort();
  for (const mk of ['opus', 'sol'] as const) {
    const cs = cells[mk], others = cells[mk === 'opus' ? 'sol' : 'opus'];
    const cost = new Map(tasks.map((t) => [t, mean(cs.flatMap((c) => (byCell(rows, c).get(t) ?? []).map((r) => r.usage?.usd ?? 0)))]));
    const qualified = tasks.filter((t) => all(cs, t));
    const pool = qualified.filter((t) => cost.get(t)! <= MAX_HOME_USD);
    const digestPool = tasks.filter((t) => (!all(cs, t) && !none(cs, t)) || (all(others, t) && none(cs, t)));
    out[mk] = draw(pool, cost, digestPool, seed, 20, { harness: mk === 'opus' ? 'claude-code' : 'codex', model: MODELS[mk] }, qualified.length);
  }
  out.particle = { spec: { ...out.sol!.spec, harness: 'hermes', model: MODELS.particle, label: 'no particle-1 receipts; descriptive only' }, pool: out.sol!.pool };
  return out;
}

const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

export function build(seed: string, frontierRef = 'origin/' + FRONTIER.branch) {
  const frontierCommit = git(['rev-parse', frontierRef + '^{commit}']).trim();
  const frontierText = git(['show', `${frontierCommit}:${FRONTIER.path}`]);
  const pinTasks = Object.keys(JSON.parse(git(['show', `${frontierCommit}:scripts/frontier-harbor/pin.json`])).task_selection.tasks);
  const gstack = selectGstack(parse(frontierText), seed);
  const receiptCommits = GBRAIN_RECEIPTS.map((p) => git(['log', '-1', '--format=%H', 'HEAD', '--', p]).trim());
  const gbrainTexts = GBRAIN_RECEIPTS.map((p) => readFileSync(join(ROOT, p), 'utf8'));
  const gbrain = selectGbrain(gbrainTexts.flatMap(parse), seed);
  for (const [mk, p] of Object.entries(gstack)) {
    const ids = [...p!.spec.tasks, ...p!.spec.digest];
    const outside = ids.filter((t) => !pinTasks.includes(t));
    if (outside.length) throw new Error(`gstack ${mk}: not in the frontier pin's public task list: ${outside.join(', ')}`);
    refuseSealed(ids, { taskRoot: join(ROOT, 'tasks') });
  }
  for (const p of Object.values(gbrain)) refuseSealed([...p!.spec.tasks, ...p!.spec.digest], { taskRoot: join(ROOT, 'tasks'), publicDir: join(ROOT, DEV_DRAW_2) });
  const file = (suite: 'gstack' | 'gbrain', picks: Partial<Record<ModelKey, Pick>>, source: object) => ({
    schema: 'canary-tasks/1', suite,
    models: Object.fromEntries(Object.entries(picks).map(([k, p]) => [k, p!.spec])),
    pools: Object.fromEntries(Object.entries(picks).map(([k, p]) => [k, p!.pool])),
    source: { ...source, seed, max_home_usd: MAX_HOME_USD },
  });
  return {
    gstack: file('gstack', gstack, {
      receipts: [`origin/${FRONTIER.branch}@${frontierCommit}:${FRONTIER.path}`], sha256s: [sha256(frontierText)], branch: FRONTIER.branch, commit: frontierCommit,
      home_cells: { opus: 'opus-cc', sol: 'sol-codex' }, rule: 'home cell passed both attempts; mean home cost <= $1.00; 30 in the shared order; t1 = 4 cheapest; digest = 4 drawn from home passed exactly one attempt or only the other model passed both',
    }),
    gbrain: file('gbrain', gbrain, {
      receipts: GBRAIN_RECEIPTS.map((p, i) => `main@${receiptCommits[i]}:${p}`), sha256s: gbrainTexts.map(sha256), commits: receiptCommits, task_set: 'v0.3/dev-draw-2 (dev, public)', label: 'dev',
      home_cells: { opus: ['claude-code-opus-none-mu-v03-dev2', 'claude-code-opus-gbrain-mu-v03-dev2'], sol: ['codex-sol-none-mu-v03-dev2'], particle: 'reuses sol' },
      rule: 'home cells passed every repetition (Opus: both Claude Code cells); mean home cost <= $1.00; 20 in the shared order or all if fewer; t1 = 4 cheapest; digest = 4 drawn from home passed some but not every repetition or only the other model passed every repetition',
    }),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const seed = flag('--seed') ?? DEFAULT_SEED;
  const dir = resolve(flag('--out-dir') ?? join(ROOT, 'docs/benchmarks/2026-11-09-regression-canary'));
  const frozen = join(dir, 'tasks-gstack.json');
  try {
    const files = build(seed, argv.includes('--check') && existsSync(frozen) ? JSON.parse(readFileSync(frozen, 'utf8')).source.commit : undefined);
    let stale = false;
    for (const [suite, f] of Object.entries(files)) {
      for (const [mk, p] of Object.entries(f.pools)) {
        const note = mk === 'particle' ? ' (reuses sol; no particle-1 receipts; descriptive only)' : p.drawn < (suite === 'gstack' ? 30 : 20) ? ' (fewer than the target, so all are used)' : '';
        console.log(`${suite} ${mk}: ${p.qualified} qualified, ${p.after_cost_cut} after the $1.00 cut, ${p.drawn} drawn${note}; mean home cost $${p.mean_home_usd_pool.toFixed(4)} pool, $${p.mean_home_usd_drawn.toFixed(4)} drawn; ${p.digest_candidates} digest candidates`);
      }
      const path = join(dir, `tasks-${suite}.json`);
      const text = JSON.stringify(f, null, 2) + '\n';
      if (argv.includes('--check')) { if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { console.error(`select-tasks: ${relative(ROOT, path)} differs from a rebuild`); stale = true; } }
      else { mkdirSync(dir, { recursive: true }); writeFileSync(path, text); }
    }
    process.exit(stale ? 1 : 0);
  } catch (error) {
    console.error('select-tasks: ' + (error as Error).message);
    process.exit(1);
  }
}
