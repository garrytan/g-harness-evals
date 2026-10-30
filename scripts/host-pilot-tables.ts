#!/usr/bin/env bun
// host-harness-pilot-2026-10 tables (internal-task), keyless: what the run's PREREGISTRATION.md asks for beyond
// summarize-run.ts and compare-run.ts.
//
//   bun scripts/host-pilot-tables.ts --results <results dir> [--out <dir>] [--seed 7] [--draws 10000]
//
// Writes host-pilot-tables.md and host-pilot-tables.json to --out (default: beside trials.jsonl) and prints the Markdown.
//
// 1. The six preregistered comparisons (Endpoints, "The six comparisons"), B minus A in pass rate, paired by task and
//    repetition, task-clustered bootstrap interval and exact sign-flip p (runner/stats/paired.ts). A pair whose trial
//    ended model_error, infra_error or exam_fault on either side is excluded with its count published. Holm runs over
//    these six only. compare-run.ts's default mode adjusts across all 36 cell pairs and keeps every trial, so its
//    p for the same pair is printed beside ours as "p as compare-run". The decision sentence: a difference is
//    reported only when the Holm p is below 0.05 and the interval excludes zero.
// 2. Descriptive rows with an interval and no test: OpenClaw minus Hermes inside each model and arm, and told minus
//    none for each Haiku harness (the preregistration names the first descriptive; the second crosses an arm).
// 3. Paired cost per trial inside the six comparisons, with intervals and no verdict.
// 4. Per cell: cost per trial over every trial run and per success (that spend over the scored passes), tokens,
//    wall time per trial (median of wall_ms) and per turn (median of each turn's ended_wall minus started_wall in
//    the trial's turns.jsonl), each with a task-clustered interval; pass^5 (a task whose every trial was scored and
//    passed) and pass@5 (a task with a scored pass); terminations; the VM from <shard>.shard-vm.json.
// 5. Per shard, from <shard>.proxy-usage.ndjson: requests by outcome, route, model and status, and every model a
//    forwarded request named.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { clusteredPairedDelta, holmAdjusted, seededRandom } from '../runner/stats/paired.ts';

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const results = arg('results');
const out = arg('out') ?? results;
const seed = Number(arg('seed') ?? 7);
const draws = Number(arg('draws') ?? 10000);
if (!results || !out || !existsSync(join(results, 'trials.jsonl'))) { console.error('usage: bun scripts/host-pilot-tables.ts --results <dir with trials.jsonl> [--out <dir>] [--seed 7] [--draws 10000]'); process.exit(2); }

const SIX = [
  { n: 1, model: 'claude-haiku-5-5', arm: 'none', a: 'openclaw-haiku-none-mu-v03-dev', b: 'claude-code-haiku-none-mu-v03-dev' },
  { n: 2, model: 'claude-haiku-5-5', arm: 'none', a: 'hermes-haiku-none-mu-v03-dev', b: 'claude-code-haiku-none-mu-v03-dev' },
  { n: 3, model: 'claude-haiku-5-5', arm: 'told', a: 'openclaw-haiku-gbrain-told-mu-v03-dev', b: 'claude-code-haiku-gbrain-told-mu-v03-dev' },
  { n: 4, model: 'claude-haiku-5-5', arm: 'told', a: 'hermes-haiku-gbrain-told-mu-v03-dev', b: 'claude-code-haiku-gbrain-told-mu-v03-dev' },
  { n: 5, model: 'gpt-6-luna', arm: 'none', a: 'openclaw-luna-none-mu-v03-dev', b: 'codex-luna-none-mu-v03-dev' },
  { n: 6, model: 'gpt-6-luna', arm: 'none', a: 'hermes-luna-none-mu-v03-dev', b: 'codex-luna-none-mu-v03-dev' },
];
const OC_MINUS_HE = [
  { label: 'claude-haiku-5-5, none', a: 'hermes-haiku-none-mu-v03-dev', b: 'openclaw-haiku-none-mu-v03-dev' },
  { label: 'claude-haiku-5-5, told', a: 'hermes-haiku-gbrain-told-mu-v03-dev', b: 'openclaw-haiku-gbrain-told-mu-v03-dev' },
  { label: 'gpt-6-luna, none', a: 'hermes-luna-none-mu-v03-dev', b: 'openclaw-luna-none-mu-v03-dev' },
];
const TOLD_MINUS_NONE = [
  { label: 'Claude Code', a: 'claude-code-haiku-none-mu-v03-dev', b: 'claude-code-haiku-gbrain-told-mu-v03-dev' },
  { label: 'OpenClaw', a: 'openclaw-haiku-none-mu-v03-dev', b: 'openclaw-haiku-gbrain-told-mu-v03-dev' },
  { label: 'Hermes Agent', a: 'hermes-haiku-none-mu-v03-dev', b: 'hermes-haiku-gbrain-told-mu-v03-dev' },
];
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);

const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const cells = [...new Set(rows.map((t) => t.cell))];
const pass = (t: TrialRecord) => (t.grade === 'pass' && !t.consent_violation ? 1 : 0);
const crossScope = (t: TrialRecord) => ((t.predicates ?? []).some((p) => p.id === 'no_cross_scope_reads' && !p.passed) ? 1 : 0);
const failedChecks = (t: TrialRecord) => (t.predicates ?? []).filter((p) => p.kind !== 'secondary' && !p.passed).map((p) => p.id);
const crossScopeOnly = (t: TrialRecord) => t.grade !== 'pass' && failedChecks(t).join() === 'no_cross_scope_reads';
const gbrainRowsByTool = (ts: TrialRecord[]) => {
  const tools: Record<string, number> = {};
  for (const t of ts) for (const p of t.predicates ?? []) if (p.id === 'no_cross_scope_reads' && !p.passed) for (const m of p.evidence.matchAll(/seq=\d+ gbrain\.(\w+) page /g)) tools[m[1]!] = (tools[m[1]!] ?? 0) + 1;
  return tools;
};
const usd = (t: TrialRecord) => t.usage?.usd ?? 0;
const scored = (t: TrialRecord) => !EXCLUDED.has(t.termination);
const pairKey = (t: TrialRecord) => `${t.task}/${t.trial_id.split('/').at(-1)}`;
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)}`;
const money = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(4)}` : 'unbounded');
const signed = (x: number) => `${x >= 0 ? '+' : '-'}${money(Math.abs(x))}`;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const turnSeconds = (t: TrialRecord) => readFileSync(join(results, 'trials', ...t.trial_id.split('/').slice(1), 'turns.jsonl'), 'utf8').split('\n').filter(Boolean)
  .map((l) => { const turn = JSON.parse(l) as { started_wall: string; ended_wall: string }; return (Date.parse(turn.ended_wall) - Date.parse(turn.started_wall)) / 1000; });
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

function paired(a: string, b: string, value: (t: TrialRecord) => number, exclude: boolean) {
  const left = new Map(rows.filter((t) => t.cell === a).map((t) => [pairKey(t), t]));
  const excluded: Array<{ pair: string; reason: string }> = [];
  const pairs = [];
  for (const y of rows.filter((t) => t.cell === b)) {
    const x = left.get(pairKey(y));
    if (!x) throw new Error(`no ${a} trial for ${b} ${pairKey(y)}`);
    const why = [x, y].filter((t) => EXCLUDED.has(t.termination)).map((t) => `${t.cell} ${t.termination}`);
    if (exclude && why.length) { excluded.push({ pair: pairKey(y), reason: why.join(', ') }); continue; }
    pairs.push({ id: pairKey(y), cluster: y.task, a: value(x), b: value(y) });
  }
  const d = clusteredPairedDelta(pairs, { seed, draws });
  return { mean_a: d.mean_a, mean_b: d.mean_b, delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, n_pairs: d.n_pairs, n_clusters: d.n_clusters, excluded };
}

/** Task-clustered bootstrap of a statistic of a cell's trials: whole tasks resampled with replacement. */
function bootstrap(ts: TrialRecord[], stat: (xs: TrialRecord[]) => number): { point: number; ci95: [number, number] } {
  const byTask = [...Map.groupBy(ts, (t) => t.task).entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([, v]) => v);
  const rng = seededRandom(seed);
  const boot = Array.from({ length: draws }, () => stat(Array.from({ length: byTask.length }, () => byTask[Math.floor(rng() * byTask.length)]!).flat()));
  boot.sort((x, y) => x - y);
  return { point: stat(ts), ci95: [boot[Math.floor(draws * 0.025)]!, boot[Math.ceil(draws * 0.975) - 1]!] };
}

const six = SIX.map((c) => ({ ...c, ...paired(c.a, c.b, pass, true), as_compare_run_p: paired(c.a, c.b, pass, false).p }));
const holm = holmAdjusted(six.map((c) => c.p));
const comparisons = six.map((c, i) => {
  const excludesZero = c.ci95 !== null && (c.ci95[0] > 0 || c.ci95[1] < 0);
  const verdict = holm[i]! < 0.05 && excludesZero ? (c.delta > 0 ? 'B higher (dev)' : 'B lower (dev)') : 'not distinguished at 20 tasks (dev)';
  return { ...c, holm_p: holm[i]!, holm_family_size: six.length, verdict };
});
const descriptive = (list: Array<{ label: string; a: string; b: string }>) => list.map((r) => {
  const p = paired(r.a, r.b, pass, true);
  const x = paired(r.a, r.b, crossScope, true);
  const side = (cell: string) => rows.filter((t) => t.cell === cell && scored(t));
  return {
    ...r, pass: { mean_a: p.mean_a, mean_b: p.mean_b, delta: p.delta, ci95: p.ci95, n_pairs: p.n_pairs, excluded: p.excluded.length },
    cross_scope: { mean_a: x.mean_a, mean_b: x.mean_b, delta: x.delta, ci95: x.ci95 },
    cross_scope_only: { a: side(r.a).filter(crossScopeOnly).length, b: side(r.b).filter(crossScopeOnly).length },
    gbrain_rows_by_tool: { a: gbrainRowsByTool(side(r.a)), b: gbrainRowsByTool(side(r.b)) },
  };
});
const ocMinusHe = descriptive(OC_MINUS_HE);
const toldMinusNone = descriptive(TOLD_MINUS_NONE);
const costPairs = SIX.map((c) => ({ n: c.n, a: c.a, b: c.b, ...paired(c.a, c.b, usd, true) }));

const shards = JSON.parse(readFileSync(join(results, 'shards.json'), 'utf8')) as { cells: Record<string, string> };
const perCell = cells.map((cell) => {
  const all = rows.filter((t) => t.cell === cell);
  const ok = all.filter(scored);
  const shard = shards.cells[cell]!;
  const vmFile = join(results, `${shard}.shard-vm.json`);
  const vm = existsSync(vmFile) ? (JSON.parse(readFileSync(vmFile, 'utf8')) as { vm: string; size: string }) : null;
  const byTask = Map.groupBy(ok, (t) => t.task);
  const planned = Map.groupBy(all, (t) => t.task);
  const turns = new Map(all.map((t) => [t.trial_id, turnSeconds(t)]));
  return {
    cell, shard, vm: vm ? `${vm.vm} (${vm.size})` : null, trials: all.length, scored: ok.length, passes: sum(ok.map(pass)),
    terminations: Object.fromEntries([...Map.groupBy(all, (t) => t.termination).entries()].map(([k, v]) => [k, v.length])),
    usd_total: sum(all.map(usd)),
    usd_per_trial: bootstrap(all, (xs) => sum(xs.map(usd)) / xs.length),
    usd_per_success: bootstrap(all, (xs) => { const p = sum(xs.filter(scored).map(pass)); return p ? sum(xs.map(usd)) / p : Infinity; }),
    tokens: { input: sum(all.map((t) => t.usage?.input_tokens ?? 0)), output: sum(all.map((t) => t.usage?.output_tokens ?? 0)), cached: sum(all.map((t) => t.usage?.cached_tokens ?? 0)) },
    input_tokens_per_trial: bootstrap(all, (xs) => median(xs.map((t) => t.usage?.input_tokens ?? 0))),
    wall_s_per_trial: bootstrap(all, (xs) => median(xs.map((t) => t.wall_ms / 1000))),
    wall_s_per_turn: bootstrap(all, (xs) => median(xs.flatMap((t) => turns.get(t.trial_id)!))),
    pass_hat_5: [...byTask.entries()].filter(([task, ts]) => ts.length === 5 && ts.length === planned.get(task)!.length && ts.every((t) => pass(t) === 1)).length,
    pass_at_5: [...byTask.values()].filter((ts) => ts.some((t) => pass(t) === 1)).length,
    tasks_short_of_5: [...planned.entries()].filter(([task, ts]) => (byTask.get(task)?.length ?? 0) < Math.max(5, ts.length)).map(([task]) => `${task} ${byTask.get(task)?.length ?? 0}`),
  };
});

type UsageLine = { key: string; route?: string; model?: string | null; outcome: string; status?: number };
const proxy = [...new Set(Object.values(shards.cells))].map((shard) => {
  const lines = readFileSync(join(results, `${shard}.proxy-usage.ndjson`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
  const groups = Map.groupBy(lines, (l) => [l.outcome, l.route ?? '', l.model ?? 'none', String(l.status ?? '')].join('|'));
  return {
    shard,
    lines: lines.length,
    by_route: [...groups.entries()].map(([k, v]) => { const [outcome, route, model, status] = k.split('|'); return { outcome, route, model, status, requests: v.length, trials: new Set(v.map((l) => l.key)).size }; }).sort((x, y) => y.requests - x.requests),
    forwarded_models: [...new Set(lines.filter((l) => l.outcome === 'forwarded' && l.model).map((l) => l.model!))],
  };
});

const ci = (c: [number, number] | null, f: (x: number) => string) => (c ? `[${f(c[0])}, ${f(c[1])}]` : '[n/a]');
const short = (cell: string) => cell.replace(/-mu-v03-dev$/, '');
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const int = (x: number) => Math.round(x).toLocaleString('en-US');
const terms = (t: Record<string, number>) => Object.entries(t).map(([k, v]) => `${k} ${v}`).join(', ');
const shortOf = (xs: string[]) => (xs.length ? ` (scored trials short of 5: ${xs.join(', ')})` : '');
const md = [
  '# host-harness-pilot-2026-10 tables (scripts/host-pilot-tables.ts)',
  '',
  `Task-clustered bootstrap intervals (whole tasks resampled with replacement), seed ${seed}, ${draws} draws. Every row is dev.`,
  '',
  '## The six preregistered comparisons, Holm over these six',
  '',
  'B minus A in pass-rate points, paired by task and repetition. A pair with a model_error, infra_error or exam_fault trial on either side is excluded. "p as compare-run" is the same pair with every trial kept, as compare-run.ts\'s default mode computes it.',
  '',
  '| # | Model | Arm | A | B | Pass A | Pass B | B minus A [95% CI] | p (two-sided, sign-flip) | Holm p (6) | p as compare-run | Tasks | Pairs | Excluded pairs | Decision |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...comparisons.map((c) => `| ${c.n} | ${c.model} | ${c.arm} | ${short(c.a)} | ${short(c.b)} | ${pct(c.mean_a)} | ${pct(c.mean_b)} | ${pts(c.delta)} ${ci(c.ci95, pts)} | ${c.p.toFixed(3)} | ${c.holm_p.toFixed(3)} | ${c.as_compare_run_p.toFixed(3)} | ${c.n_clusters} | ${c.n_pairs} | ${c.excluded.length} | ${c.verdict} |`),
  '',
  ...comparisons.filter((c) => c.excluded.length).map((c) => `Excluded pairs in #${c.n}: ${c.excluded.map((x) => x.pair + ' (' + x.reason + ')').join('; ')}.`),
  '',
  '## Descriptive, no test: OpenClaw minus Hermes Agent inside a model and arm',
  '',
  '| Model, arm | Pass Hermes | Pass OpenClaw | OpenClaw minus Hermes [95% CI] | Pairs | Excluded pairs |',
  '|---|---|---|---|---|---|',
  ...ocMinusHe.map((r) => `| ${r.label} | ${pct(r.pass.mean_a)} | ${pct(r.pass.mean_b)} | ${pts(r.pass.delta)} ${ci(r.pass.ci95, pts)} | ${r.pass.n_pairs} | ${r.pass.excluded} |`),
  '',
  '## Descriptive, no test: told minus none for each Haiku harness (crosses an arm, so not a preregistered comparison)',
  '',
  'A cross-scope failure is a failed no_cross_scope_reads check. "Only check failed" counts trials whose one failed required or forbidden check is no_cross_scope_reads. "gbrain rows cited" counts the gbrain reads named in those failures\' evidence, by tool.',
  '',
  '| Harness | Pass none | Pass told | told minus none [95% CI] | Cross-scope failures none | Cross-scope failures told | told minus none [95% CI] | Only check failed (none, told) | gbrain rows cited (told) | Pairs |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...toldMinusNone.map((r) => `| ${r.label} | ${pct(r.pass.mean_a)} | ${pct(r.pass.mean_b)} | ${pts(r.pass.delta)} ${ci(r.pass.ci95, pts)} | ${pct(r.cross_scope.mean_a)} | ${pct(r.cross_scope.mean_b)} | ${pts(r.cross_scope.delta)} ${ci(r.cross_scope.ci95, pts)} | ${r.cross_scope_only.a}, ${r.cross_scope_only.b} | ${Object.entries(r.gbrain_rows_by_tool.b).map(([k, v]) => k + ' ' + v).join(', ') || 'none'} | ${r.pass.n_pairs} |`),
  '',
  '## Paired cost per trial inside the six comparisons (no verdict)',
  '',
  '| # | A | B | USD per trial A | USD per trial B | B minus A [95% CI] | Pairs |',
  '|---|---|---|---|---|---|---|',
  ...costPairs.map((c) => `| ${c.n} | ${short(c.a)} | ${short(c.b)} | ${money(c.mean_a)} | ${money(c.mean_b)} | ${signed(c.delta)} ${ci(c.ci95, signed)} | ${c.n_pairs} |`),
  '',
  '## Per cell',
  '',
  'Cost per trial is every trial\'s proxy-priced spend over every trial run. Cost per success is that spend over the passes among scored trials; a bootstrap draw with no pass is unbounded. Wall time per turn is the median of every turn\'s ended_wall minus started_wall (turns.jsonl). pass^5 counts a task only when all five of its trials were scored and passed; pass@5 counts a task with any scored pass. Wall time is labelled with the VM the shard ran on: each cell ran on its own VM, so a wall-time difference is confounded with the machine.',
  '',
  '| Cell | Shard | VM | Trials (scored) | Terminations | USD total | USD per trial [95% CI] | USD per success [95% CI] | Input / output / cached tokens | Input tokens per trial, median [95% CI] | Wall s per trial, median [95% CI] | Wall s per turn, median [95% CI] | pass^5 / pass@5 tasks |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...perCell.map((c) => `| ${short(c.cell)} | ${c.shard} | ${c.vm ?? 'n/a'} | ${c.trials} (${c.scored}) | ${terms(c.terminations)} | $${c.usd_total.toFixed(4)} | ${money(c.usd_per_trial.point)} ${ci(c.usd_per_trial.ci95, money)} | ${money(c.usd_per_success.point)} ${ci(c.usd_per_success.ci95, money)} | ${int(c.tokens.input)} / ${int(c.tokens.output)} / ${int(c.tokens.cached)} | ${int(c.input_tokens_per_trial.point)} ${ci(c.input_tokens_per_trial.ci95, int)} | ${c.wall_s_per_trial.point.toFixed(1)} ${ci(c.wall_s_per_trial.ci95, (x) => x.toFixed(1))} | ${c.wall_s_per_turn.point.toFixed(1)} ${ci(c.wall_s_per_turn.ci95, (x) => x.toFixed(1))} | ${c.pass_hat_5} / ${c.pass_at_5}${shortOf(c.tasks_short_of_5)} |`),
  '',
  '## Proxy requests per shard (from <shard>.proxy-usage.ndjson)',
  '',
  '| Shard | Outcome | Route | Model | Status | Requests | Trials |',
  '|---|---|---|---|---|---|---|',
  ...proxy.flatMap((p) => p.by_route.map((r) => `| ${p.shard} | ${r.outcome} | ${r.route} | ${r.model} | ${r.status} | ${r.requests} | ${r.trials} |`)),
  '',
  'Models named in forwarded requests: ' + proxy.map((p) => p.shard + ' ' + (p.forwarded_models.join(', ') || 'none')).join('; ') + '.',
  '',
];
writeFileSync(join(out, 'host-pilot-tables.md'), md.join('\n'));
const json = { seed, draws, comparisons, oc_minus_he: ocMinusHe, told_minus_none: toldMinusNone, cost_pairs: costPairs.map(({ excluded, ...c }) => ({ ...c, excluded: excluded.length })), per_cell: perCell, proxy };
writeFileSync(join(out, 'host-pilot-tables.json'), JSON.stringify(json, (_, v) => (v === Infinity ? 'unbounded' : v), 1) + '\n');
console.log(md.join('\n'));
