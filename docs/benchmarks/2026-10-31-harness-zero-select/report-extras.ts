#!/usr/bin/env bun
// The verdicts and the report's numbers that summarize-run.ts and compare-run.ts do not print, from the committed
// receipts, keyless:
//
//   bun docs/benchmarks/2026-10-31-harness-zero-select/report-extras.ts [--check]
//   bun docs/benchmarks/2026-10-31-harness-zero-select/report-extras.ts --audit <dest>
//
// Default mode reads results/comparisons.json, summary.json, shards.json, trials.jsonl, each trial's adapter.log, each
// shard's proxy-usage.ndjson, shard.json, shard-vm.json and manifest, raw-audit.json and this run's entry in
// docs/receipts-manifest.json. It writes results/report-extras.json and results/verdicts.md. With --check it writes
// nothing and exits 1 when either differs from what is on disk.
//
// - Verdicts: the loop file's rules (docs/loops/2026-10-31-harness-zero.md, "Keep rule") as Amendment 1 section 4 says
//   each reads comparisons.json, tried in order keep, cut, can't tell. F is the pass half-width of zero-full-b against
//   zero-full-a. The ceiling gate reads zero-full-a's pass rate in summary.json.
// - Candidates: lean, conservative and zero-control from the verdicts (loop file, "Candidates"), plus the Sol sets when
//   Sol's caching or effort-high verdict differs from Opus's. Each must equal its set in harnesses/harness-zero/config/
//   candidates.json, and its candidate_sha256 is computed with zero.ts's own candidateHash.
// - Design sensitivity for Phase D (preregistration, Endpoints): every 3-of-5 repetition subset, the same repetitions
//   on both sides, paired interval of zero-full-b minus zero-full-a with the kit's clusteredPairedDelta (seed 7, 10,000
//   draws); median and 90th percentile (nearest rank, the 9th of 10) of the half-widths.
// - Descriptive per cell: ZERO_TURN and ZERO_CALL lines of each trial's adapter.log (turns, steps, stop reasons,
//   retries, notes, tool errors), the set and candidate prefix adapter.log prints, forwarded proxy lines by model and by
//   thinking or reasoning setting, pass^k and pass@k per task, tasks at floor and ceiling, wall time, leaks, spend and
//   VM cost.
//
// --audit <dest> reads the full shard trees the fan-out copied back (<dest>/<shard>/results/trials, harness state
// included, which is not committed) and writes results/raw-audit.json: the clean-arm audit (trials with "gstack",
// case-insensitive, in events, turns, turn requests and replies, logs/ and state/zero/sessions/), each cell's
// candidate_sha256 from its ready files, the system prompts its session files carry, and how many session files show
// the output-cap marker.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateHash, loadConfig, resolveSet } from '../../../harnesses/harness-zero/zero.ts';
import { clusteredPairedDelta } from '../../../runner/stats/paired.ts';

const DIR = 'docs/benchmarks/2026-10-31-harness-zero-select';
const RES = join(DIR, 'results');
const RUN = 'harness-zero-select-2026-11';
const SEED = 7, DRAWS = 10000;
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const SLUGS = ['caching', 'tool-search', 'layer-tool-use', 'layer-safety', 'layer-scope', 'layer-style', 'layer-planning', 'scoped-notes', 'output-cap', 'mcp-instructions', 'effort-high'];
const LAYERS = SLUGS.filter((s) => s.startsWith('layer-'));
const ZFA = 'zero-full-a-opus-none-mu-v03-dev', ZFB = 'zero-full-b-opus-none-mu-v03-dev', ZFS = 'zero-full-sol-none-mu-v03-dev', ZMS = 'zero-min-sol-none-mu-v03-dev';
const NOEH_SOL = 'zero-full-no-effort-high-sol-none-mu-v03-dev';
const ABLATIONS: Array<{ cell: string; switches: string[]; label: string }> = [
  { cell: 'zero-full-no-effort-high-opus-none-mu-v03-dev', switches: ['effort-high'], label: 'effort-high' },
  { cell: 'zero-full-no-tool-search-opus-none-mu-v03-dev', switches: ['tool-search'], label: 'tool-search' },
  { cell: 'zero-full-no-scoped-notes-opus-none-mu-v03-dev', switches: ['scoped-notes'], label: 'scoped-notes' },
  { cell: 'zero-full-minus-layers-opus-none-mu-v03-dev', switches: LAYERS, label: 'layer-* (five, bundled)' },
];
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const readJson = <T>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;
const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

interface Trial { trial_id: string; cell: string; task: string; model: string; termination: string; grade: string; consent_violation: boolean; approval_stop: boolean; wall_ms: number; predicates?: Array<{ id: string; passed: boolean }> }
const trialDir = (t: { trial_id: string }) => join(RES, 'trials', ...t.trial_id.split('/').slice(1));

function audit(dest: string) {
  const shards = readJson<{ shards: Record<string, { cells: string[] }> }>(join(RES, 'shards.json')).shards;
  const walk = (d: string): string[] => existsSync(d) ? readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
  const cells: Record<string, unknown> = {};
  for (const [shard, s] of Object.entries(shards)) for (const cell of s.cells) {
    const root = join(dest, shard, 'results', 'trials', cell);
    let trials = 0, files = 0, outputCapSessions = 0, sessions = 0;
    const hits: Array<{ trial: string; file: string }> = [], candidates = new Map<string, number>(), systems = new Map<string, { bytes: number; sessions: number }>();
    for (const task of readdirSync(root).sort()) for (const rep of readdirSync(join(root, task)).sort()) {
      trials++;
      const t = join(root, task, rep);
      const scanned = [join(t, 'events.jsonl'), join(t, 'turns.jsonl'), ...walk(join(t, 'turns')), ...walk(join(t, 'logs')), ...walk(join(t, 'state', 'zero', 'sessions'))].filter((f) => existsSync(f));
      for (const f of scanned) { files++; if (/gstack/i.test(readFileSync(f, 'latin1'))) hits.push({ trial: `${cell}/${task}/${rep}`, file: f.slice(t.length + 1) }); }
      const ready = readJson<{ candidate_sha256: string }>(join(t, 'logs', 'ready'));
      candidates.set(ready.candidate_sha256, (candidates.get(ready.candidate_sha256) ?? 0) + 1);
      for (const f of walk(join(t, 'state', 'zero', 'sessions'))) {
        sessions++;
        const text = readFileSync(f, 'utf8');
        if (text.includes('[harness-zero output-cap: cut')) outputCapSessions++;
        const sys = (JSON.parse(text) as { system: string }).system;
        const k = sha256(sys), e = systems.get(k) ?? { bytes: Buffer.byteLength(sys), sessions: 0 };
        e.sessions++;
        systems.set(k, e);
      }
    }
    cells[cell] = { shard, trials, files_scanned: files, trials_with_gstack: new Set(hits.map((h) => h.trial)).size, hits, candidate_sha256: Object.fromEntries(candidates), session_files: sessions, session_files_with_output_cap_marker: outputCapSessions, system_prompts: Object.fromEntries(systems) };
  }
  const out = { run_id: RUN, generator: DIR + '/report-extras.ts --audit', scope: "each shard's results/trials tree as its teardown copied it back (harness state included), read on the PR 3 machine on 2026-11-05: events.jsonl, turns.jsonl, turns/, logs/ (adapter.log, ready, stdout, stderr, docker) and state/zero/sessions/ of every trial", pattern: '/gstack/i', cells };
  writeFileSync(join(RES, 'raw-audit.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote ' + join(RES, 'raw-audit.json'));
}

const auditAt = process.argv.indexOf('--audit');
if (auditAt > 0) { audit(process.argv[auditAt + 1]!); process.exit(0); }

interface Ratio { estimate: number | null; ci95: [number, number] | null }
interface Endpoints { pass_half_width: number; usd_per_trial: { mean_a: number; mean_b: number; delta: number; ci95: [number, number] }; usd_per_trial_ratio: Ratio; usd_per_success: { a: number; b: number; ratio: Ratio }; cached_share: { a: number; b: number; difference: Ratio }; tasks: { broken: string[]; fixed: string[] } }
interface Comparison { a: string; b: string; delta: number; ci95: [number, number]; mean_a: number; mean_b: number; n_pairs: number; n_clusters: number; endpoints: Endpoints }
const cmp = readJson<{ comparisons: Comparison[]; repricing: Record<string, { ratio: Ratio; trials: number }> }>(join(RES, 'comparisons.json'));
const summary = readJson<{ cells: Record<string, { pass_rate: number; ci95: [number, number] }> }>(join(RES, 'summary.json'));
const shardsFile = readJson<{ shards: Record<string, { machine: string; cells: string[] }>; skipped_by_rule: Array<{ cell: string; reason: string; planned_trials: number }> }>(join(RES, 'shards.json'));
const trials = lines(join(RES, 'trials.jsonl')).map((l) => JSON.parse(l) as Trial);
const pair = (a: string, b: string) => { const c = cmp.comparisons.find((x) => x.a === a && x.b === b); if (!c) throw new Error(`no comparison ${a} -> ${b}`); return c; };

const floor = pair(ZFA, ZFB);
const F = floor.endpoints.pass_half_width;
const gate = summary.cells[ZFA]!;
const costOnly = gate.pass_rate < 0.10 || gate.pass_rate > 0.90;
const above = (r: Ratio, bar: number) => r.estimate !== null && r.ci95 !== null && r.estimate > bar && r.ci95[0] > 1.0;

function opusVerdict(c: Comparison) {
  const e = c.endpoints;
  const keepPass = c.ci95[1] < 0;
  const keepCost = above(e.usd_per_success.ratio, 1.10) && c.delta >= -F;
  const costLevel = e.usd_per_trial.delta <= 0 || (e.usd_per_trial.ci95[0] <= 0 && e.usd_per_trial.ci95[1] >= 0);
  const withinF = c.delta >= -F && c.delta <= F;
  const brokenOk = e.tasks.broken.length <= 2;
  const verdict = costOnly
    ? (above(e.usd_per_trial_ratio, 1.10) ? 'keep' : costLevel && brokenOk && c.delta >= -F ? 'cut' : "can't tell")
    : (keepPass || keepCost ? 'keep' : costLevel && withinF && brokenOk ? 'cut' : "can't tell");
  return { rule: costOnly ? 'cost-only (ceiling gate)' : 'normal', keep_pass_interval_below_zero: keepPass, keep_cost_per_success: keepCost, cut_cost_level_or_lower: costLevel, cut_pass_within_F: withinF, cut_broken_at_most_2: brokenOk, verdict };
}

const ablations = ABLATIONS.map(({ cell, switches, label }) => {
  const c = pair(ZFA, cell), e = c.endpoints;
  return {
    switch: label, switches, cell,
    pass: { a: c.mean_a, b: c.mean_b, delta: c.delta, ci95: c.ci95, half_width: e.pass_half_width, pairs: c.n_pairs, tasks: c.n_clusters },
    usd_per_trial: { a: e.usd_per_trial.mean_a, b: e.usd_per_trial.mean_b, delta: e.usd_per_trial.delta, ci95: e.usd_per_trial.ci95, ratio: e.usd_per_trial_ratio },
    usd_per_success: { a: e.usd_per_success.a, b: e.usd_per_success.b, ratio: e.usd_per_success.ratio },
    cached_share: { a: e.cached_share.a, b: e.cached_share.b, difference: e.cached_share.difference },
    broken: e.tasks.broken, fixed: e.tasks.fixed,
    ...opusVerdict(c),
  };
});

const rep = cmp.repricing[ZFA]!;
const cachingOpus = { rule: "repriced over actual above 1.10 with an interval excluding 1.00: keep; at or below 1.00: cut; else can't tell", ratio: rep.ratio, trials: rep.trials, verdict: above(rep.ratio, 1.10) ? 'keep' : rep.ratio.estimate !== null && rep.ratio.estimate <= 1.0 ? 'cut' : "can't tell" };
const solMin = pair(ZFS, ZMS);
const solDiff = solMin.endpoints.cached_share.difference;
const cachingSol = {
  rule: "zero-full Sol cached share at least 10 points above zero-min Sol with an interval excluding zero: keep; else can't tell (Amendment 1: the zero-min-sol comparison's cached_share.difference at or below -0.10 with its interval wholly below 0)",
  zero_full_sol: solMin.endpoints.cached_share.a, zero_min_sol: solMin.endpoints.cached_share.b, zero_min_minus_zero_full: solDiff,
  verdict: solDiff.estimate !== null && solDiff.ci95 !== null && solDiff.estimate <= -0.10 && solDiff.ci95[1] < 0 ? 'keep' : "can't tell",
};

const opus: Record<string, { verdict: string; source: string }> = {};
for (const a of ablations) for (const s of a.switches) opus[s] = { verdict: a.verdict, source: a.switches.length > 1 ? `bundle ${a.cell}` : a.cell };
opus.caching = { verdict: cachingOpus.verdict, source: `repricing ${ZFA}` };
opus['mcp-instructions'] = { verdict: "can't tell", source: 'no cell (loop file: inert without gbrain)' };
opus['output-cap'] = { verdict: "can't tell", source: 'no cell (loop file: no sibling verdict)' };
const skipped = shardsFile.skipped_by_rule.find((s) => s.cell === NOEH_SOL);
const solEffortRun = opus['effort-high']!.verdict === 'keep';
if (solEffortRun === !!skipped) throw new Error(`conditional Sol cell: Opus effort-high is ${opus['effort-high']!.verdict} but shards.json ${skipped ? 'skips' : 'does not skip'} ${NOEH_SOL}`);
const sol: Record<string, { verdict: string; source: string }> = {};
for (const s of SLUGS) sol[s] = { verdict: opus[s]!.verdict, source: `inherited from Opus (${opus[s]!.source})` };
sol.caching = { verdict: cachingSol.verdict, source: `cached share ${ZFS} against ${ZMS}` };

const lean = (v: Record<string, { verdict: string }>) => SLUGS.filter((s) => v[s]!.verdict === 'keep');
const conservative = (v: Record<string, { verdict: string }>) => SLUGS.filter((s) => v[s]!.verdict !== 'cut');
const sets: Record<string, string[]> = { 'zero-lean': lean(opus) };
if (conservative(opus).join() !== lean(opus).join()) sets['zero-conservative'] = conservative(opus);
sets['zero-control'] = lean(opus);
if (sol.caching!.verdict !== opus.caching!.verdict || sol['effort-high']!.verdict !== opus['effort-high']!.verdict) {
  sets['zero-lean-sol'] = lean(sol);
  sets['zero-conservative-sol'] = conservative(sol);
}

const zeroCfg = loadConfig();
const frozen = Object.fromEntries(Object.entries(sets).map(([name, features]) => {
  if (JSON.stringify(zeroCfg.candidates.sets[name]) !== JSON.stringify(features)) throw new Error(`candidates.json ${name} is ${JSON.stringify(zeroCfg.candidates.sets[name])}, the verdicts give ${JSON.stringify(features)}`);
  return [name, { features, candidate_sha256: candidateHash(resolveSet(name, zeroCfg)).candidate_sha256 }];
}));
const baselineHashes = Object.fromEntries(['zero-full', 'zero-min'].map((n) => [n, candidateHash(resolveSet(n, zeroCfg)).candidate_sha256]));

const passOf = (t: Trial) => !EXCLUDED.has(t.termination) && t.grade === 'pass' && !t.consent_violation ? 1 : 0;
const sensitivity = (() => {
  const byKey = (cell: string) => new Map(trials.filter((t) => t.cell === cell).map((t) => [`${t.task}/${t.trial_id.split('/').at(-1)}`, t]));
  const A = byKey(ZFA), B = byKey(ZFB);
  const subsets: number[][] = [];
  for (let i = 1; i <= 5; i++) for (let j = i + 1; j <= 5; j++) for (let k = j + 1; k <= 5; k++) subsets.push([i, j, k]);
  const rows = subsets.map((reps) => {
    const items = [...A.keys()].filter((k) => reps.includes(Number(k.split('/r')[1])) && B.has(k)).sort().map((k) => ({ id: k, cluster: k.split('/')[0]!, a: passOf(A.get(k)!), b: passOf(B.get(k)!) }));
    const d = clusteredPairedDelta(items, { seed: SEED, draws: DRAWS });
    return { reps, pairs: items.length, delta: r4(d.delta), ci95: d.ci95 ? [r4(d.ci95[0]), r4(d.ci95[1])] : null, half_width: d.ci95 ? r4((d.ci95[1] - d.ci95[0]) / 2) : null };
  });
  const hw = rows.map((r) => r.half_width).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const p90 = hw[Math.ceil(0.9 * hw.length) - 1] ?? null;
  return { method: '3 of 5 repetitions per task, the same repetitions in zero-full-a and zero-full-b, all 10 subsets; the 90th percentile is the nearest rank (9th of 10)', subsets: rows, median_half_width: median(hw), p90_half_width: p90, p90_at_least_10_points: p90 === null ? null : p90 >= 0.10 };
})();

interface Usage { key: string; model: string; outcome: string; thinking_type?: string; reasoning_effort?: string }
const usage = new Map<string, Usage[]>();
for (const shard of Object.keys(shardsFile.shards)) for (const l of lines(join(RES, `${shard}.proxy-usage.ndjson`))) {
  const u = JSON.parse(l) as Usage;
  const cell = u.key.split('/')[1]!;
  usage.set(cell, [...(usage.get(cell) ?? []), u]);
}
const manifest = readJson<{ runs: Array<{ directory: string; ledgers: Array<{ path: string; ledger_committed_usd: number; requests: number; leases: Array<{ budget_usd: number; overshoot_usd: number }> }> }> }>('docs/receipts-manifest.json');
const runEntry = manifest.runs.find((r) => r.directory === DIR);
if (!runEntry) throw new Error(`docs/receipts-manifest.json has no entry for ${DIR}; run bun scripts/receipts-manifest.ts first`);
const ledgerOf = (path: string) => { const l = runEntry.ledgers.find((x) => x.path === path); if (!l) throw new Error(`no manifest ledger ${path}`); return l; };
const preregSha = sha256(readFileSync(join(DIR, 'prereg.json')));
type RawCell = { trials_with_gstack: number; candidate_sha256: Record<string, number>; session_files_with_output_cap_marker: number; session_files: number; system_prompts: Record<string, { bytes: number; sessions: number }> };
const raw = existsSync(join(RES, 'raw-audit.json')) ? readJson<{ cells: Record<string, RawCell> }>(join(RES, 'raw-audit.json')) : null;

const cells = Object.entries(shardsFile.shards).map(([shard, s]) => {
  const cell = s.cells[0]!;
  const ts = trials.filter((t) => t.cell === cell);
  const shardJson = readJson<{ commit: string; exit: number; lease_usd: number }>(join(RES, `${shard}.shard.json`));
  const vm = readJson<{ commit: string; scratch_prereg: boolean; exit: number; name: string; size: string; location: string; cost: { list_price_usd: number; vm_minutes: number } }>(join(RES, `${shard}.shard-vm.json`));
  const shardManifest = readJson<{ prereg_sha256: string }>(join(RES, existsSync(join(RES, `${shard}.manifest.json`)) ? `${shard}.manifest.json` : 'manifest.json'));
  const turnsLog: Array<{ steps: number; stop_reason: string; retries: number; notes_written: number; notes_shown: number; tool_outcomes: { error: number }; ms: number }> = [];
  const setLines = new Set<string>();
  let toolSearch = 0, saveNote = 0, calls = 0, trialsWithRetry = 0;
  for (const t of ts) {
    let retried = false;
    for (const l of lines(join(trialDir(t), 'logs', 'adapter.log'))) {
      const set = l.match(/harness-zero (set=\S+ candidate=\S+) wire=\S+ model=\S+ (features=\S+)/);
      if (set) setLines.add(`${set[1]} ${set[2]}`);
      const turn = l.match(/ ZERO_TURN (\{.*\})$/);
      if (turn) { const j = JSON.parse(turn[1]!); turnsLog.push(j); if (j.retries > 0) retried = true; }
      const call = l.match(/ ZERO_CALL (\{.*\})$/);
      if (call) { const j = JSON.parse(call[1]!) as { tool: string }; calls++; if (j.tool === 'tool_search') toolSearch++; if (j.tool === 'save_note') saveNote++; }
    }
    if (retried) trialsWithRetry++;
  }
  const tally = <T>(xs: T[], f: (x: T) => string | undefined) => { const o: Record<string, number> = {}; for (const x of xs) { const k = f(x) ?? 'none'; o[k] = (o[k] ?? 0) + 1; } return o; };
  const stops = tally(turnsLog, (t) => t.stop_reason);
  const byTask = new Map<string, { passes: number; scored: number }>();
  for (const t of ts) { const st = byTask.get(t.task) ?? { passes: 0, scored: 0 }; if (!EXCLUDED.has(t.termination)) { st.scored++; st.passes += passOf(t); } byTask.set(t.task, st); }
  const reps = Math.max(...[...byTask.values()].map((st) => st.scored));
  const full = [...byTask.values()].filter((st) => st.scored === reps);
  const u = usage.get(cell) ?? [];
  const ledger = ledgerOf(`${RES}/${shard}.ledger.sqlite`), smoke = ledgerOf(`${RES}/${shard}.smoke.ledger.sqlite`);
  const rc = raw?.cells[cell];
  return {
    cell, shard, model: ts[0]!.model, trials: ts.length, terminations: tally(ts, (t) => t.termination),
    vm: { name: vm.name, size: vm.size, location: vm.location, minutes: vm.cost.vm_minutes, list_price_usd: vm.cost.list_price_usd, machine: s.machine },
    provenance: { shard_commit: shardJson.commit, shard_vm_commit: vm.commit, scratch_prereg: vm.scratch_prereg, shard_exit: shardJson.exit, vm_exit: vm.exit, manifest_prereg_sha256: shardManifest.prereg_sha256, prereg_json_sha256_now: preregSha, prereg_sha_matches: shardManifest.prereg_sha256 === preregSha, adapter_set_lines: [...setLines], candidate_sha256: rc?.candidate_sha256 ?? null },
    exposure: { requests_by_model: tally(u, (x) => x.outcome === 'forwarded' ? x.model : `${x.outcome} ${x.model}`), thinking_type: tally(u, (x) => x.thinking_type), reasoning_effort: tally(u, (x) => x.reasoning_effort), tool_calls: calls, tool_search_calls: toolSearch, save_note_calls: saveNote, notes_written: turnsLog.reduce((x, t) => x + t.notes_written, 0), notes_shown: turnsLog.reduce((x, t) => x + t.notes_shown, 0), session_files: rc?.session_files ?? null, session_files_with_output_cap_marker: rc?.session_files_with_output_cap_marker ?? null, system_prompt_bytes: rc ? [...new Set(Object.values(rc.system_prompts).map((p) => p.bytes))].sort((a, b) => a - b) : null },
    turns: { count: turnsLog.length, steps_median: median(turnsLog.map((t) => t.steps)), steps_mean: r4(turnsLog.reduce((x, t) => x + t.steps, 0) / turnsLog.length), steps_max: Math.max(...turnsLog.map((t) => t.steps)), stop_reasons: stops, step_cap_stops: stops.step_cap ?? 0, retries: turnsLog.reduce((x, t) => x + t.retries, 0), trials_with_a_retry: trialsWithRetry, tool_errors: turnsLog.reduce((x, t) => x + t.tool_outcomes.error, 0), turn_ms_median: median(turnsLog.map((t) => t.ms)) },
    wall_s_median: r4(median(ts.map((t) => t.wall_ms / 1000))!),
    tasks: { reps, at_ceiling: [...byTask].filter(([, st]) => st.scored && st.passes === st.scored).map(([k]) => k).sort(), at_floor: [...byTask].filter(([, st]) => st.scored && st.passes === 0).map(([k]) => k).sort(), pass_hat_k: full.filter((st) => st.passes === reps).length, pass_at_k: full.filter((st) => st.passes > 0).length, complete_groups: full.length },
    approval_stops: ts.filter((t) => t.approval_stop).map((t) => t.trial_id), consent_violations: ts.filter((t) => t.consent_violation).map((t) => t.trial_id),
    hidden_fact_leaks: ts.filter((t) => t.predicates?.some((p) => p.id === 'no_leak' && !p.passed)).map((t) => t.trial_id),
    clean_arm_trials_with_gstack: rc?.trials_with_gstack ?? null,
    spend: { lease_usd: shardJson.lease_usd, committed_usd: ledger.ledger_committed_usd, requests: ledger.requests, overshoot_usd: ledger.leases.reduce((x, l) => x + l.overshoot_usd, 0), smoke_committed_usd: smoke.ledger_committed_usd, smoke_lease_usd: smoke.leases.reduce((x, l) => x + l.budget_usd, 0) },
  };
});

const zm = pair(ZFA, 'zero-min-opus-none-mu-v03-dev');
const out = {
  run_id: RUN, generator: DIR + '/report-extras.ts', seed: SEED, draws: DRAWS,
  inputs: { comparisons_json_sha256: sha256(readFileSync(join(RES, 'comparisons.json'))), trials_jsonl_sha256: sha256(readFileSync(join(RES, 'trials.jsonl'))), raw_audit_json_sha256: raw ? sha256(readFileSync(join(RES, 'raw-audit.json'))) : null },
  ceiling_gate: { cell: ZFA, pass_rate: gate.pass_rate, ci95: gate.ci95, band: [0.10, 0.90], mode: costOnly ? 'cost-only' : 'normal' },
  floor: { F, zero_full_b_minus_a: { delta: floor.delta, ci95: floor.ci95, pairs: floor.n_pairs, tasks: floor.n_clusters }, cost_per_trial_ratio: floor.endpoints.usd_per_trial_ratio, cost_per_success_ratio: floor.endpoints.usd_per_success.ratio, broken: floor.endpoints.tasks.broken, fixed: floor.endpoints.tasks.fixed },
  ablations, caching_opus: cachingOpus, caching_sol: cachingSol,
  zero_min: {
    opus: { delta: zm.delta, ci95: zm.ci95, usd_per_trial_ratio: zm.endpoints.usd_per_trial_ratio, usd_per_success_ratio: zm.endpoints.usd_per_success.ratio, broken: zm.endpoints.tasks.broken, fixed: zm.endpoints.tasks.fixed },
    sol: { delta: solMin.delta, ci95: solMin.ci95, usd_per_trial_ratio: solMin.endpoints.usd_per_trial_ratio, usd_per_success_ratio: solMin.endpoints.usd_per_success.ratio, broken: solMin.endpoints.tasks.broken, fixed: solMin.endpoints.tasks.fixed },
  },
  conditional_sol_cell: { cell: NOEH_SOL, rule: 'runs only if Opus keeps effort-high', opus_effort_high: opus['effort-high']!.verdict, run: solEffortRun, skipped_by_rule: skipped ?? null },
  verdicts: { opus, sol }, candidates: frozen, baseline_candidate_sha256: baselineHashes,
  design_sensitivity: sensitivity,
  cells,
  spend: { cap_usd: 213, committed_usd: r6(cells.reduce((x, c) => x + c.spend.committed_usd, 0)), leases_usd: r6(cells.reduce((x, c) => x + c.spend.lease_usd, 0)), smoke_committed_usd: r6(cells.reduce((x, c) => x + c.spend.smoke_committed_usd, 0)), vm_list_price_usd: r6(cells.reduce((x, c) => x + c.vm.list_price_usd, 0)), requests: cells.reduce((x, c) => x + c.spend.requests, 0) },
};

const pct = (x: number | null) => x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;
const ci = (c: [number, number] | null, f: (x: number) => string) => c ? `[${f(c[0])}, ${f(c[1])}]` : '[n/a]';
const usd = (x: number) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(4)}`;
const rat = (r: Ratio) => r.estimate === null ? 'n/a' : `${r.estimate.toFixed(2)} ${ci(r.ci95, (x) => x.toFixed(2))}`;
const md = [
  `# ${RUN}: verdicts (dev)`,
  '',
  `Generated by \`bun ${DIR}/report-extras.ts\` from \`comparisons.json\`, \`summary.json\` and \`shards.json\`. Ceiling gate: \`${ZFA}\` pass rate ${(100 * gate.pass_rate).toFixed(0)}%, mode ${out.ceiling_gate.mode}. F = ${(100 * F).toFixed(1)} points; zero-full-b minus zero-full-a ${pct(floor.delta)} ${ci(floor.ci95, pct)} points.`,
  '',
  '## Opus 5.5 ablations (each minus zero-full-a, 20 tasks x 5 repetitions, 100 pairs)',
  '',
  '| Switch dropped | Pass delta, points [95% CI] | Half-width | Cost per trial delta [95% CI] | Cost per trial ratio [95% CI] | Cost per success ratio [95% CI] | Broken | Fixed | Verdict (dev) |',
  '|---|---|---:|---|---|---|---:|---:|---|',
  ...ablations.map((a) => `| \`${a.switch}\` | ${pct(a.pass.delta)} ${ci(a.pass.ci95, pct)} | ${(100 * a.pass.half_width).toFixed(1)} | ${usd(a.usd_per_trial.delta)} ${ci(a.usd_per_trial.ci95, usd)} | ${rat(a.usd_per_trial.ratio)} | ${rat(a.usd_per_success.ratio)} | ${a.broken.length} | ${a.fixed.length} | ${a.verdict} |`),
  '',
  '## Every switch',
  '',
  '| Switch | Opus 5.5 verdict (dev) | From | GPT-6.1 Sol verdict (dev) | From |',
  '|---|---|---|---|---|',
  ...SLUGS.map((s) => `| \`${s}\` | ${opus[s]!.verdict} | ${opus[s]!.source} | ${sol[s]!.verdict} | ${sol[s]!.source} |`),
  '',
  '## Caching',
  '',
  '| Cell | Trials | Repriced over actual [95% CI] |',
  '|---|---:|---|',
  ...Object.entries(cmp.repricing).map(([c, r]) => `| \`${c}\` | ${r.trials} | ${rat(r.ratio)} |`),
  '',
  `Sol cached share: zero-full ${(100 * cachingSol.zero_full_sol).toFixed(1)}%, zero-min ${(100 * cachingSol.zero_min_sol).toFixed(1)}%, zero-min minus zero-full ${pct(solDiff.estimate)} ${ci(solDiff.ci95, pct)} points.`,
  '',
  '## Frozen candidates',
  '',
  ...Object.entries(frozen).map(([n, c]) => `- \`${n}\`: ${c.features.length ? c.features.map((x) => '`' + x + '`').join(', ') : '(no switches)'}; candidate_sha256 \`${c.candidate_sha256}\``),
  '',
].join('\n');

const text = JSON.stringify(out, null, 1) + '\n';
const files: Array<[string, string]> = [[join(RES, 'report-extras.json'), text], [join(RES, 'verdicts.md'), md]];
if (process.argv.includes('--check')) {
  const stale = files.filter(([p, t]) => !existsSync(p) || readFileSync(p, 'utf8') !== t).map(([p]) => p);
  console.log(stale.length ? 'differs: ' + stale.join(', ') : 'up to date: ' + files.map(([p]) => p).join(', '));
  process.exit(stale.length ? 1 : 0);
}
for (const [p, t] of files) writeFileSync(p, t);
console.log('wrote ' + files.map(([p]) => p).join(', '));
