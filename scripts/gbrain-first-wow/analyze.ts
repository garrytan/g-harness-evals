// Counted-run analysis of the gbrain time-to-first-wow eval (PREREGISTRATION.md: Scoring, Analysis, Interim look, Freeze). Reads a merged
// results directory, or every shard's results directory while shards still run (trials.jsonl, and every shard's proxy-usage.ndjson for provider safety-filter stops), re-scores each question trial
// with the frozen scorer (pilot-summary.ts rescore), turns it into a verdict row under the plan's rules, and applies verdict.ts:
//   - model_error, infra_error and exam_fault drop their pair and are listed; a trial with a provider safety-filter stop is reported apart
//     and drops its pair too; a plain trial whose tool calls name a gstack or gbrain path is contaminated, listed and dropped;
//   - a timeout or another harness error is a miss, with its question time counted at the 600 s cap;
//   - no-history trials are summarised apart, with the made-up-value check (more than 2 of 10 in a gbrain arm), and the coding check
//     with its regression check (full passing at least 3 fewer of the paired tasks than defaults).
// --interim takes the one interim look on INTERIM_SEEDS and reads nothing else; it refuses while any arm of those seeds has no record.
// The final run decides each harness on its primary contrast with its stated difference, after the same interim call; a harness the interim
// look stopped keeps that call and its later pairs are description only, and a harness with planned trials missing gets no decision. Keyless.
//   bun scripts/gbrain-first-wow/analyze.ts <results dir>... [--interim] [--prereg <prereg.json>] [--json <out>] [--md <out>]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NEvent } from '../gbrain-install/transcript.ts';
import { QUESTION_BUDGET_S, taskForSeed } from '../../runner/trial/first-wow-cell.ts';
import { rescore, type Rec } from './pilot-summary.ts';
import { INTERIM_SEEDS, STATED_DIFFERENCE } from './prereg.ts';
import { contrast, contrastMarkdown, contrastsFor, decide, interimCall, noHistorySummary, plainMatches, type ContrastResult, type Row } from './verdict.ts';

const EXCLUDED = ['model_error', 'infra_error', 'exam_fault'];
const CAP_MS = QUESTION_BUDGET_S * 1000;
const CLEAN_ARM_PATH = /gstack|gbrain/i;

export const labelOf = (harness: string, model: string) => harness + '/' + (model.split(':')[1] ?? model);

/** One question trial as a verdict row. score is the frozen scorer's result, events the session's tool events. */
export function rowFor(rec: Rec, score: Record<string, unknown> | null, events: readonly NEvent[], seed: number, persona: Row['persona'], safetyStop: boolean): Row {
  const fw = rec.first_wow;
  const timedOut = rec.termination === 'timeout';
  const completed = rec.termination === 'completed';
  const contaminated = fw.arm === 'plain' && events.some((e) => e.kind !== 'text' && CLEAN_ARM_PATH.test(e.input));
  const excluded = safetyStop ? 'safety_filter' : EXCLUDED.includes(rec.termination) ? rec.termination : contaminated ? 'contaminated' : undefined;
  const time = timedOut ? CAP_MS : fw.question_ms;
  const row: Row = {
    harness: labelOf(rec.harness, rec.model), model: rec.model, arm: fw.arm, seed, persona,
    finish: persona === 'no-history' ? null : completed ? score?.finish_any === true : false,
    time_ms: time, total_ms: time === null ? null : time + fw.setup_ms, timed_out: timedOut,
    commands: Number(score?.commands ?? 0), person_needed: fw.person_needed,
  };
  if (excluded) row.excluded = excluded;
  if (persona === 'no-history') { row.correct_abstention = completed && score?.correct_abstention === true; row.fallback_shown = (score?.fallback_shown as boolean | null | undefined) ?? null; }
  return row;
}

/** Trial ids with a provider safety-filter stop on any usage line of their key (runner/proxy/stops.ts). */
export function safetyStops(dir: string): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => /(^|[.])proxy-usage[.]ndjson$/.test(f)))
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!l.includes('safety_stop')) continue;
      const o = JSON.parse(l) as { key?: string; safety_stop?: string };
      if (o.safety_stop && o.key?.startsWith('trial-token:')) out.add(o.key.slice('trial-token:'.length));
    }
  return out;
}

export interface CodingPair { harness: string; seed: number; defaults: boolean; full: boolean }

/** The coding check's pairs: the same harness and seed on defaults and full, dropping pairs with an excluded trial. */
export function codingPairs(recs: readonly Rec[], safety: ReadonlySet<string>): { pairs: CodingPair[]; excluded: Array<{ harness: string; trial: string; reason: string }> } {
  const by = new Map<string, Rec>();
  const excluded: Array<{ harness: string; trial: string; reason: string }> = [];
  for (const r of recs) by.set(labelOf(r.harness, r.model) + '|' + r.task + '|' + r.first_wow.arm, r);
  const pairs: CodingPair[] = [];
  for (const r of recs.filter((r) => r.first_wow.arm === 'defaults')) {
    const f = by.get(labelOf(r.harness, r.model) + '|' + r.task + '|full');
    if (!f) continue;
    const bad = [r, f].filter((x) => EXCLUDED.includes(x.termination) || safety.has(x.trial_id));
    if (bad.length) { excluded.push(...bad.map((x) => ({ harness: labelOf(x.harness, x.model), trial: x.trial_id, reason: safety.has(x.trial_id) ? 'safety_filter' : x.termination }))); continue; }
    const pass = (x: Rec) => x.termination === 'completed' && x.first_wow.coding?.grade?.passed === true;
    pairs.push({ harness: labelOf(r.harness, r.model), seed: Number(r.task.replace(/^seed-/, '')), defaults: pass(r), full: pass(f) });
  }
  return { pairs, excluded };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const valued = new Set(['--prereg', '--json', '--md']);
  const dirs = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1] ?? ''));
  if (!dirs.length) { console.error('usage: bun scripts/gbrain-first-wow/analyze.ts <results dir>... [--interim] [--prereg <prereg.json>] [--json <out>] [--md <out>]'); process.exit(2); }
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const interimOnly = argv.includes('--interim');
  const prereg = JSON.parse(readFileSync(opt('--prereg') ?? 'docs/benchmarks/2026-11-24-gbrain-first-wow/prereg.json', 'utf8')) as { cells: Array<{ id: string; harness: string; model: string; tasks: string[]; first_wow?: { task?: string } }> };
  const dirOf = new Map<string, string>();
  const all = dirs.flatMap((d) => readFileSync(join(d, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l) as Rec; dirOf.set(r.trial_id, d); return r; }));
  const safety = new Set(dirs.flatMap((d) => [...safetyStops(d)]));
  const questionCells = prereg.cells.filter((c) => c.first_wow?.task !== 'coding').map((c) => c.id);
  const half = new Set(INTERIM_SEEDS);
  const have = new Set(all.map((r) => r.cell + '|' + r.task));
  const missing = questionCells.flatMap((c) => INTERIM_SEEDS.map((s) => c + '|' + taskForSeed(s)).filter((k) => !have.has(k)));
  if (interimOnly && missing.length) { console.error('INTERIM: refused, ' + missing.length + ' interim trials have no record yet, e.g. ' + missing.slice(0, 5).join(', ')); process.exit(2); }
  const missingFinal = interimOnly ? [] : prereg.cells.flatMap((c) => c.tasks.filter((t) => !have.has(c.id + '|' + t)).map((t) => ({ harness: labelOf(c.harness, c.model), key: c.id + '|' + t })));
  const admitted = new Set<string>(), fabricatedIds = new Set<string>();
  const questionRecs = all.filter((r) => !r.first_wow.coding);
  const rows: Row[] = questionRecs.flatMap((r) => {
    const seed = Number(r.task.replace(/^seed-/, ''));
    if (interimOnly && !half.has(seed)) return [];
    const s = rescore(r, dirOf.get(r.trial_id));
    const row = rowFor(r, s.score, s.events, s.manifest.seed, s.manifest.persona, safety.has(r.trial_id));
    if (!row.excluded) admitted.add(r.trial_id);
    if ((s.score.fabricated as boolean[] | undefined)?.some(Boolean)) fabricatedIds.add(r.trial_id);
    return [row];
  });
  const verdictRows = rows;
  const harnesses = [...new Set(verdictRows.map((r) => r.harness))].sort();
  const results = harnesses.map((h) => {
    const arms = [...new Set(verdictRows.filter((r) => r.harness === h).map((r) => r.arm))];
    const cs = contrastsFor(h, arms);
    const primaryC = cs.find((c) => c.label.startsWith('primary') || c.b === 'qm-native');
    const mdd = STATED_DIFFERENCE[h];
    if (!primaryC || mdd === undefined) return { harness: h, decision: 'no primary contrast or stated difference', contrasts: [] as ContrastResult[] };
    const look = contrast(verdictRows, primaryC, half);
    const call = look ? interimCall(look) : 'continue';
    if (interimOnly) return { harness: h, stated_difference: mdd, interim: look, interim_call: call, contrasts: [] as ContrastResult[] };
    const finals = cs.map((c) => contrast(verdictRows, c)).filter((x): x is ContrastResult => !!x);
    const primary = finals.find((x) => x.a === primaryC.a && x.b === primaryC.b);
    const plain = finals.find((x) => x.a === 'plain' && x.b === 'full');
    const missingH = missingFinal.filter((m) => m.harness === h).length;
    const stopped = call !== 'continue';
    const decision = stopped ? decide(look!, mdd, call) : missingH ? 'not decided: ' + missingH + ' planned trials have no record' : primary ? decide(primary, mdd, call) : 'no pairs';
    return { harness: h, stated_difference: mdd, interim: look, interim_call: call, decision, missing_trials: missingH, description_only: stopped, plain_matches: plain && !stopped && !missingH ? plainMatches(plain, mdd) : null, contrasts: finals };
  });
  const listed = rows.filter((r) => r.excluded).map((r) => ({ harness: r.harness, arm: r.arm, seed: r.seed, reason: r.excluded }));
  const noHistory = noHistorySummary(rows).map((s) => {
    const fabricated = questionRecs.filter((r) => labelOf(r.harness, r.model) === s.harness && r.first_wow.arm === s.arm && r.first_wow.persona === 'no-history' && admitted.has(r.trial_id) && fabricatedIds.has(r.trial_id)).length;
    return { ...s, made_up_value_trials: fabricated, flag_to_gbrain: s.arm !== 'plain' && fabricated > 2 };
  });
  const coding = interimOnly ? null : (() => {
    const { pairs, excluded } = codingPairs(all.filter((r) => r.first_wow.coding), safety);
    return [...new Set(pairs.map((p) => p.harness))].map((h) => { const ps = pairs.filter((p) => p.harness === h); const d = ps.filter((p) => p.defaults).length, f = ps.filter((p) => p.full).length;
      return { harness: h, pairs: ps.length, defaults_passed: d, full_passed: f, regression: d - f >= 3, excluded: excluded.filter((x) => x.harness === h) }; });
  })();
  const depsTrees = [...new Set(all.map((r) => { try { return (JSON.parse(String(r.first_wow.image_record ?? '').split('\n')[0]!) as { deps_sha256?: string }).deps_sha256; } catch { return undefined; } }).filter((x): x is string => !!x))].sort();
  const out = { schema: 'gbrain-first-wow-analysis/1', results_dirs: dirs, gbrain_deps_sha256: depsTrees, mode: interimOnly ? 'interim' : missingFinal.length ? 'final-incomplete' : 'final', interim_seeds: INTERIM_SEEDS.length, missing_interim_trials: missing.length, missing_final_trials: missingFinal.length, rows: rows.length, excluded: listed, harnesses: results, no_history: interimOnly ? null : noHistory, coding };
  if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify(out, null, 1) + '\n');
  const pct = (x: number) => (x * 100).toFixed(1);
  const md = [
    '# gbrain first-wow: ' + (interimOnly ? 'interim look (' + INTERIM_SEEDS.length + ' seeds)' : 'counted-run analysis'), '',
    '| Harness | Stated difference | Interim (pairs, delta, McNemar p) | Interim call | Decision | Plain agent matches |', '|---|---|---|---|---|---|',
    ...results.map((r) => '| ' + [r.harness, 'stated_difference' in r ? pct(r.stated_difference as number) : '', r.interim ? r.interim.n_pairs + ', ' + pct(r.interim.delta) + ', ' + r.interim.mcnemar.p_two_sided.toFixed(4) : 'n/a', 'interim_call' in r ? r.interim_call : '', 'decision' in r ? r.decision : '', 'plain_matches' in r ? String(r.plain_matches) : ''].join(' | ') + ' |'),
    '', interimOnly ? '' : contrastMarkdown(results.filter((r) => !('description_only' in r && r.description_only)).flatMap((r) => r.contrasts)),
    ...(results.some((r) => 'description_only' in r && r.description_only) ? ['Description only, not tested again (the interim look stopped these harnesses; their p values are not a test):', '', contrastMarkdown(results.filter((r) => 'description_only' in r && r.description_only).flatMap((r) => r.contrasts))] : []),
    depsTrees.length > 1 ? 'gbrain dependency trees differ between trials (' + depsTrees.map((d) => d.slice(0, 12)).join(', ') + '); the plan requires one.\n' : '',
    missingFinal.length ? 'Incomplete: ' + missingFinal.length + ' planned trials have no record; harnesses missing trials get no decision.\n' : '',
    'Excluded: ' + (listed.length ? listed.map((x) => x.harness + ' ' + x.arm + ' seed ' + x.seed + ' (' + x.reason + ')').join('; ') : 'none') + '.', '',
  ].join('\n');
  if (opt('--md')) writeFileSync(opt('--md')!, md);
  console.log(md);
}
