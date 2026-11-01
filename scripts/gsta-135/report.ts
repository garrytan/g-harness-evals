#!/usr/bin/env bun
/**
 * GSTA-135 report: cells.jsonl to report.md.
 *
 * Panel mode (--manifest): per cell (harness x task x arm) the planned and run
 * counts, the counts of matching_skill_opened, matching_skill_started,
 * control_false_open and task_success each with a Wilson 95% interval over the
 * PLANNED n (a trial that did not run or was not observable counts as an
 * absence and never leaves the denominator; nothing is replaced), the median
 * and maximum settled cost against the manifest's ceilings, every trial's cost
 * against the per-trial bar, GSTA-135's bars evaluated per harness with the
 * words "meets the bars; improvement inconclusive at n=5" whenever the arms'
 * intervals overlap, the terminations table with each termination's class
 * (evaluator infrastructure, harness or gstack runtime, the trial's own
 * outcome), the manifest sha256 and the dated deviations. Counts and intervals
 * only: no ranks, no composite scores.
 *
 * Discovery mode (no --manifest, the old --pin/--run-id/--lease-usd/--cap
 * flags): the one-trial-per-cell table of the 2026-10 discovery run, unchanged,
 * so that run's report still renders.
 *
 *   bun scripts/gsta-135/report.ts <cells.jsonl> <report.md> --manifest <manifest.json> [--summary <json>] [--stop <reason>]
 *   bun scripts/gsta-135/report.ts <cells.jsonl> <report.md> --pin <pin8> --run-id <id> --lease-usd <n> --cap <n> [--summary <json>] [--stop <reason>]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const money = (n: number) => '$' + (Math.round(n * 10000) / 10000).toFixed(4);
const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);

/** Wilson score interval for k successes in n trials at 95% (z = 1.96); [0, 0] when n is 0. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 0 };
  const p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
const interval = (k: number, n: number) => { const w = wilson(k, n); return k + '/' + n + ' (' + w.lo.toFixed(2) + ' to ' + w.hi.toFixed(2) + ')'; };
const overlap = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) => a.lo <= b.hi && b.lo <= a.hi;

/** Who owns a termination: the evaluator's own plumbing, the harness or gstack runtime inside the container, or the trial itself. */
export function terminationClass(t: string): 'evaluator infrastructure' | 'harness or gstack runtime' | 'the trial\'s own outcome' | 'unclassified' {
  if (/^(infra:reservation_refused|infra:cap_refused|infra:no_model_request|infra:upstream|infra_error|not_run:)/.test(t)) return 'evaluator infrastructure';
  if (/^(infra:runtime|harness_error|model_error)$/.test(t)) return 'harness or gstack runtime';
  if (/^(completed|timeout|ceiling:lease)$/.test(t)) return 'the trial\'s own outcome';
  return 'unclassified';
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ran = (r: any) => !String(r.termination ?? '').startsWith('not_run');
const metric = (r: any, k: string) => r.evidence?.metrics?.[k];
/** Eligibility, applied before any count: a row counts in a numerator only when it ran, its termination is not infra:* or
 *  not_run:*, its transcript is complete and it did not stop for length. Every other row is an absence in every numerator (planned
 *  n keeps it in the denominator); its raw events are still tallied in the cell's observed counts so nothing is hidden. The one
 *  ceiling, control opens on task 3, counts every trial that ran: a false open on a truncated or degraded trial is still a false
 *  open, and a ceiling that skipped it would fail open. */
export const eligible = (r: any) => ran(r) && !/^infra/.test(String(r.termination ?? '')) && r.evidence?.transcript === 'complete' && (r.termination_hint ?? r.evidence?.termination_hint) !== 'length';

type Counts = { opened: number; started: number; attempted: number; control: number; success: number };
type Cell = { harness: string; task: number; arm: string; planned: number; rows: any[]; run: any[]; observable: number; eligible: number; observed: Counts; costs: number[] } & Counts;

export function cells(rows: any[], order: any[] | null): Cell[] {
  const key = (r: any) => r.harness + '|' + r.task + '|' + r.arm;
  const plan = new Map<string, number>();
  for (const o of order ?? rows) plan.set(key(o), (plan.get(key(o)) ?? 0) + 1);
  for (const r of rows) if (!plan.has(key(r))) plan.set(key(r), 0);
  return [...plan.keys()].sort().map(k => {
    const [harness, task, arm] = k.split('|');
    const mine = rows.filter(r => key(r) === k), run = mine.filter(ran), ok = mine.filter(eligible);
    const counts = (rs: any[]): Counts => ({
      opened: rs.filter(r => metric(r, 'matching_skill_opened') === 1).length,
      started: rs.filter(r => metric(r, 'matching_skill_started') === 1).length,
      attempted: rs.filter(r => metric(r, 'started_attempted') === 1).length,
      control: rs.filter(r => metric(r, 'control_false_open') === 1).length,
      success: rs.filter(r => metric(r, 'task_success') === true).length,
    });
    return {
      harness, task: Number(task), arm, planned: Math.max(plan.get(k) ?? 0, mine.length), rows: mine, run,
      observable: mine.filter(r => r.evidence?.transcript === 'complete').length, eligible: ok.length,
      ...counts(ok), control: counts(run).control, observed: counts(mine),
      costs: run.map(r => Number(r.usd_spent ?? 0)),
    };
  });
}

/** GSTA-135's bars for one harness: each bar with its verdict and the counts behind it, then the one-line call. The bars are
 *  proportions of the planned n of each cell, so they keep their meaning whatever --trials says: opens at least 0.6 of planned
 *  (3 of 5 at n=5, 6 of 10 at n=10) and strictly above baseline, starts at least 0.6, control opens at most 0.2 (1 of 5, 2 of 10),
 *  success not below baseline. The improvement claim is inconclusive when the arms' intervals overlap on any open or start count
 *  (the success and control bars are floors and ceilings, not improvement claims, so they do not decide that wording). */
export const OPEN_FLOOR = 0.6, CONTROL_CEILING = 0.2;
export const needAtLeast = (planned: number) => Math.ceil(3 * planned / 5);
export const allowAtMost = (planned: number) => Math.floor(planned / 5);
const kOfN = (k: number, n: number, rule: string) => { const w = wilson(k, n); return k + ' of ' + n + ' (' + rule + '; Wilson ' + w.lo.toFixed(2) + ' to ' + w.hi.toFixed(2) + ')'; };
export function bars(cs: Cell[], harness: string, perTrialUsd: number, ceilings: Record<string, number | null>, n = 5): { lines: string[]; verdict: string } {
  const cell = (task: number, arm: string) => cs.find(c => c.harness === harness && c.task === task && c.arm === arm);
  const lines: string[] = [];
  let met = true, inconclusive = false;
  const bar = (ok: boolean, text: string) => { lines.push('- ' + (ok ? 'met' : 'not met') + ': ' + text); if (!ok) met = false; };
  for (const task of [1, 2]) {
    const c = cell(task, 'candidate'), b = cell(task, 'baseline');
    if (!c || !b) { bar(false, 'task ' + task + ': a cell is missing (' + (c ? '' : 'candidate ') + (b ? '' : 'baseline') + ')'); continue; }
    const need = needAtLeast(c.planned), rule = 'at least ' + need + ' of ' + c.planned + ' at n=' + c.planned;
    bar(c.opened >= need && c.opened > b.opened, 'task ' + task + ' opens the matching skill in at least ' + OPEN_FLOOR + ' of the planned n and strictly above baseline: candidate ' + kOfN(c.opened, c.planned, rule) + ', baseline ' + interval(b.opened, b.planned));
    if (overlap(wilson(c.opened, c.planned), wilson(b.opened, b.planned))) inconclusive = true;
    bar(c.started >= need, 'task ' + task + ' starts the matching skill (helper exit 0) in at least ' + OPEN_FLOOR + ' of the planned n: candidate ' + kOfN(c.started, c.planned, rule) + ' (' + c.attempted + ' attempted), baseline ' + interval(b.started, b.planned));
    if (overlap(wilson(c.started, c.planned), wilson(b.started, b.planned))) inconclusive = true;
    bar(c.success >= b.success, 'task ' + task + ' success not below baseline: candidate ' + interval(c.success, c.planned) + ', baseline ' + interval(b.success, b.planned));
  }
  const c3 = cell(3, 'candidate'), b3 = cell(3, 'baseline');
  if (c3) {
    const most = allowAtMost(c3.planned);
    bar(c3.control <= most, 'task 3 control opens a skill in at most ' + CONTROL_CEILING + ' of the planned n: candidate ' + kOfN(c3.control, c3.planned, 'at most ' + most + ' of ' + c3.planned + ' at n=' + c3.planned) + (b3 ? ', baseline ' + interval(b3.control, b3.planned) : ''));
  } else bar(false, 'task 3 control cell is missing');
  for (const task of [1, 2, 3]) {
    const c = cell(task, 'candidate'), ceiling = ceilings['task' + task];
    if (!c) continue;
    const m = median(c.costs);
    bar(m !== null && ceiling !== null && ceiling !== undefined && m < ceiling, 'task ' + task + ' candidate median cost under the ceiling: median ' + (m === null ? 'no run trial' : money(m)) + ' against ' + (ceiling === null || ceiling === undefined ? 'no ceiling' : money(ceiling)) + ' over ' + c.run.length + ' run trial(s)');
  }
  const mine = cs.filter(c => c.harness === harness).flatMap(c => c.run);
  const over = mine.filter(r => Number(r.usd_spent ?? 0) >= perTrialUsd || r.termination === 'ceiling:lease');
  bar(mine.length > 0 && over.length === 0, 'every run trial under $' + perTrialUsd.toFixed(2) + ': ' + (mine.length - over.length) + ' of ' + mine.length + (over.length ? ' (over: ' + over.map(r => r.trial_id + ' ' + money(Number(r.usd_spent ?? 0)) + (r.termination === 'ceiling:lease' ? ', lease refusal' : '')).join('; ') + ')' : ''));
  const verdict = !mine.length ? harness + ': not measured (no run trial)'
    : met ? harness + ': meets the bars; ' + (inconclusive ? 'improvement inconclusive at n=' + n + ' (the arms\' intervals overlap)' : 'the arms\' intervals are separated at n=' + n + ' on every bar')
    : harness + ': does not meet the bars (' + lines.filter(l => l.startsWith('- not met')).length + ' of ' + lines.length + ' not met)';
  return { lines, verdict };
}

const refusalNote = (rows: any[]) => {
  const refusals: Record<string, number> = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.refusals ?? {})) refusals[k] = (refusals[k] ?? 0) + (n as number);
  const budget = sum(rows, 'budget_refusals');
  return !sum(rows, 'requests_refused') ? '' : ' (' + (budget ? budget + ' by the lease; ' : 'none by the lease; ') +
    [...Object.entries(refusals).sort((a, b) => b[1] - a[1]).map(([k, n]) => n + ' x ' + k.replace(/[|\n]/g, ' ')), 'a refusal costs nothing'].join('; ') + ')';
};
const requestsLine = (rows: any[]) => {
  const unfinalized = rows.filter(r => r.requests_undrained === null).map(r => r.trial_id);
  return '- requests: ' + sum(rows, 'requests_forwarded') + ' forwarded, ' + sum(rows, 'requests_refused') + ' refused' + refusalNote(rows) + (sum(rows, 'requests_undrained') ? '; ' + sum(rows, 'requests_undrained') + ' still in flight when their trial was finalized (cost in the ledger, not in any row)' : '') + (unfinalized.length ? '; finalize failed for ' + unfinalized.join(', ') + ' (those rows may miss in-flight requests; the ledger summary is authoritative)' : '');
};

export function panelReport(rows: any[], manifest: any, manifestPath: string, arg: (n: string, d?: string) => string): string {
  const day = (rows.find(r => r.started_at)?.started_at ?? manifest.created_at ?? new Date().toISOString()).slice(0, 10);
  const order: any[] | null = Array.isArray(manifest.order) ? manifest.order : null;
  const cs = cells(rows, order);
  const perTrialUsd = Number(manifest.per_trial_usd ?? 1);
  const ceilings: Record<string, number | null> = { task1: manifest.ceilings?.task1 ?? null, task2: manifest.ceilings?.task2 ?? null, task3: manifest.ceilings?.task3 ?? null };
  const harnesses = [...new Set((order ?? rows).map((r: any) => String(r.harness)))].sort();
  const n = order && harnesses.length ? Math.max(...cs.map(c => c.planned)) : 5;
  const fileSha = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
  const sidecar = join(dirname(manifestPath), 'manifest.sha256');
  const written = existsSync(sidecar) ? readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0] : null;
  const byTermination = new Map<string, any[]>();
  for (const r of rows) byTermination.set(r.termination, [...(byTermination.get(r.termination) ?? []), r]);
  const lengthRows = rows.filter(r => (r.termination_hint ?? r.evidence?.termination_hint) === 'length');
  const notRun = rows.filter(r => !ran(r));
  const missing = order ? order.filter((o: any) => !rows.some(r => r.trial_id === o.trial_id)) : [];
  const deviations = [
    ...(arg('--stop') ? ['- ' + day + ': stopped: ' + arg('--stop') + '.'] : []),
    ...(notRun.length ? ['- ' + day + ': ' + notRun.length + ' planned trial(s) not run (' + [...new Set(notRun.map(r => r.termination))].join(', ') + '): ' + notRun.map(r => r.trial_id).join(', ') + '. They stay in every denominator as absences; nothing was replaced.'] : []),
    ...(missing.length ? ['- ' + day + ': ' + missing.length + ' trial(s) in the manifest order have no row in cells.jsonl: ' + missing.map((o: any) => o.trial_id).join(', ') + '. They stay in every denominator as absences.'] : []),
    ...(lengthRows.length ? ['- ' + day + ': ' + lengthRows.length + ' trial(s) ended on a length stop under the max_tokens pin (' + manifest.max_tokens + '): ' + lengthRows.map(r => r.trial_id).join(', ') + '. Paid but unobservable; counted as absences.'] : []),
    ...(rows.filter(r => r.termination === 'infra:runtime').length ? ['- ' + day + ': ' + rows.filter(r => r.termination === 'infra:runtime').map(r => r.trial_id).join(', ') + ': the runtime preflight failed or the wrapper logged a degraded start (harness or gstack runtime, kept in the denominator, an absence in every numerator but the control ceiling whatever the transcript shows; its events are in the observed column).'] : []),
    ...(rows.filter(r => r.evidence?.transcript === 'tampered').length ? ['- ' + day + ': ' + rows.filter(r => r.evidence?.transcript === 'tampered').map(r => r.trial_id).join(', ') + ': the transcript carries a user row after the first assistant row (an injected turn; a trial has one user turn). Tampered, no credit, counted as absences. A Hermes chat session the wall clock killed writes its own `received signal` user row and reads the same way; its termination column says timeout.'] : []),
    ...(rows.filter(r => r.requests_undrained === null).length ? ['- ' + day + ': finalize failed for ' + rows.filter(r => r.requests_undrained === null).map(r => r.trial_id).join(', ') + '; the ledger summary is authoritative for their spend.'] : []),
    ...(written && written !== fileSha ? ['- ' + day + ': manifest.sha256 (' + written.slice(0, 12) + ') does not match the manifest file (' + fileSha.slice(0, 12) + '); the manifest changed after it was sealed.'] : []),
    ...(rows.some(r => r.tree_dirty) ? ['- ' + day + ': the tree carried uncommitted changes when the run started (tree-status.txt beside this report lists them).'] : []),
  ];
  if (!deviations.length) deviations.push('- none recorded by the driver.');
  const arms = manifest.arms ?? {};
  const armLine = (name: string) => { const a = arms[name]; return a ? '- ' + name + ': gstack ' + a.gstack_sha + '; images ' + Object.entries(a.images ?? {}).map(([h, i]: [string, any]) => h + ' ' + i.tag + ' (' + String(i.digest ?? '').slice(0, 19) + ')').join(', ') : '- ' + name + ': not in the manifest'; };
  const perHarness = harnesses.map(h => bars(cs, h, perTrialUsd, ceilings, n));
  const hermesNote = manifest.hermes_mode === 'chat' ? ' Hermes rows are chat-mode under the overlay adapter (the counted Hermes entry is one-shot and is not measured here).' : '';
  return [
    '# GSTA-135 skill-use panel ' + (manifest.run_id ?? arg('--run-id')) + ' (' + day + ')',
    '',
    (arms.none ? 'Three arms: no gstack (none), and two that differ only by the gstack pin' : 'Two arms that differ only by the gstack pin') + ' (baseline: main at freeze; candidate: GSTA-135), ' + n + ' trials per cell in the fixed interleaved order of the manifest. ' +
    'Every count is k of the PLANNED n with a Wilson 95% interval; a trial that did not run, was refused or left an incomplete transcript counts as an absence and is never replaced. ' +
    'Evidence is the harness\'s native transcript joined to its tool results (evidence.ts); assistant prose and the wrapper\'s logs never count. Nothing here orders the harnesses or folds counts into one score.' + hermesNote,
    '',
    '## Settings',
    '',
    ...(arms.none ? [armLine('none')] : []),
    armLine('baseline'),
    armLine('candidate'),
    '- hermes mode: ' + (manifest.hermes_mode ?? '?') + '; max_tokens pin ' + (manifest.max_tokens ?? '?') + '; model ' + (rows[0]?.model ?? '?') + '; tree ' + (manifest.tree ?? rows[0]?.tree ?? '?') + (rows[0]?.tree_dirty ? ' (dirty)' : ''),
    '- lease per trial ' + money(Number(manifest.lease_usd ?? 0)) + ' = per-trial bar ' + money(perTrialUsd) + ' + R_max ' + money(Number(manifest.r_max_usd ?? 0)) + '; panel cap ' + money(Number(manifest.panel_cap_usd ?? 0)) + '; stop rule: ' + (manifest.stop_rule ?? '?'),
    '- test-run marker: ' + (manifest.marker?.line ?? '?') + ' (' + (manifest.marker?.variables ?? []).join(', ') + '); approval: ' + (manifest.approval ? manifest.approval.setting + '=' + manifest.approval.value : '?'),
    '- ceilings (usd medians): task 1 ' + (ceilings.task1 === null ? 'none' : money(ceilings.task1)) + ', task 2 ' + (ceilings.task2 === null ? 'none' : money(ceilings.task2)) + ', task 3 ' + (ceilings.task3 === null ? 'none' : money(ceilings.task3)),
    '- manifest sha256 ' + fileSha + (written ? (written === fileSha ? ' (matches manifest.sha256)' : ' (manifest.sha256 says ' + written + ')') : ' (no manifest.sha256 beside it)'),
    '- spent ' + money(sum(rows, 'usd_spent')) + ' settled; ' + money(sum(rows, 'usd_charged_reservation')) + ' charged at full reservation on upstream failures (committed in the ledger and counted by the cap, outside the per-trial bar); ' + money(sum(rows, 'usd_reserved_unknown')) + ' reserved on failed requests (unknown, not folded into spent); lease summary: ' + (arg('--summary') || 'none'),
    requestsLine(rows),
    '',
    '## Bars (GSTA-135)',
    '',
    ...(manifest.bars ? [String(manifest.bars), ''] : []),
    ...perHarness.flatMap(b => ['**' + b.verdict + '**', '', ...b.lines, '']),
    '## Cells',
    '',
    '| harness | task | arm | planned | run | observable | opened | started (attempted) | control open | task success | cost median | cost max | ceiling | eligible | observed opened/started/control/success |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...cs.map(c => '| ' + [c.harness, c.task, c.arm, c.planned, c.run.length, c.observable, c.task === 3 ? 'n/a' : interval(c.opened, c.planned), c.task === 3 ? 'n/a' : interval(c.started, c.planned) + ' (' + c.attempted + ')', c.task === 3 ? interval(c.control, c.planned) : 'n/a', c.task === 3 ? 'n/a' : interval(c.success, c.planned), c.costs.length ? money(median(c.costs)!) : 'no run trial', c.costs.length ? money(Math.max(...c.costs)) : 'no run trial', ceilings['task' + c.task] === null ? 'none' : money(ceilings['task' + c.task]!) + (c.costs.length && median(c.costs)! >= ceilings['task' + c.task]! ? ' (median over)' : ''), c.eligible, c.observed.opened + '/' + c.observed.started + '/' + c.observed.control + '/' + c.observed.success].join(' | ') + ' |'),
    '',
    'Eligibility comes before every count: a trial counts in a numerator only when it ran, its termination is not infra:* or not_run:*, its transcript is complete and it did not stop for length (eligible column). Every other trial is an absence in every numerator and stays in the planned n; its raw events are tallied in the observed column so nothing is hidden. The control ceiling is the exception: it counts a false open on every trial that ran, eligible or not, so it cannot fail open. The bars are proportions of the planned n (opens and starts at least ' + OPEN_FLOOR + ', control opens at most ' + CONTROL_CEILING + ', success not below baseline), printed with the count they need at this n.',
    '',
    'Task success is a preregistered regex over the final assistant text of the main session (evidence.ts file head): task 1 says do not merge, or carries a weak cue (before merging, the off-by-one named) with no approval beside it; task 2 names the inclusive bound or the failing test. Negated forms ("no off-by-one", "nothing is blocking the merge", "no reason it should not be merged", "exclusive, not inclusive") never count. Known false-positive forms still accepted, so a reader can audit the texts: a do-not-merge for an unrelated reason, "before merging" as a chore with no approval in the text, the off-by-one named as a question, an approval worded outside the list ("ship it") beside a weak cue, and "inclusive" in an unrelated sense.',
    '',
    '## Trials',
    '',
    '| order | trial | harness | task | arm | termination | class | exit | forwarded | spent | unknown | lease | under $' + perTrialUsd.toFixed(2) + ' | opened | started | success | transcript | hint |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...[...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(r => '| ' + [r.order ?? '', r.trial_id, r.harness, r.task, r.arm, r.termination, terminationClass(r.termination), r.exit_code ?? '', r.requests_forwarded ?? 0, money(r.usd_spent ?? 0), money(r.usd_reserved_unknown ?? 0), r.lease_usd === undefined ? '' : money(r.lease_usd), !ran(r) ? 'not run' : (Number(r.usd_spent ?? 0) < perTrialUsd && r.termination !== 'ceiling:lease' ? 'yes' : 'no'), metric(r, 'matching_skill_opened') ?? '', metric(r, 'matching_skill_started') ?? '', metric(r, 'task_success') ?? '', r.evidence?.transcript ?? 'none', r.termination_hint ?? r.evidence?.termination_hint ?? ''].join(' | ') + ' |'),
    '',
    '## Terminations',
    '',
    '| termination | class | count | trials |',
    '|---|---|---|---|',
    ...[...byTermination.entries()].sort().map(([t, rs]) => '| ' + [t, terminationClass(t), rs.length, rs.length > 12 ? rs.length + ' trials' : rs.map(r => r.trial_id).join(', ')].join(' | ') + ' |'),
    '',
    'Evaluator infrastructure: infra:reservation_refused, infra:cap_refused, infra:no_model_request, infra:upstream (an upstream 5xx settled at its reservation, then a lease refusal, or a provider-error 5xx settled at $0 in a trial that did not complete: the provider, not the trial), infra_error, not_run:*. Harness or gstack runtime: infra:runtime, harness_error, model_error. The trial\'s own outcome: completed, timeout, ceiling:lease (a 402 after at least one forwarded request: the trial failed the $' + perTrialUsd.toFixed(2) + ' bar). Every class stays in the denominators.',
    '',
    '## Deviations',
    '',
    ...deviations,
    '',
  ].join('\n');
}

/** The 2026-10 discovery report: one trial per cell, an existence proof per row. */
export function discoveryReport(rows: any[], arg: (n: string, d?: string) => string): string {
  const ev = (r: any, k: string) => {
    const e = r.evidence?.[k];
    if (!r.evidence) return r.termination.startsWith('not_run') ? 'not run' : 'unobservable';
    if (r.evidence.transcript !== 'complete' && !e) return 'unobservable (transcript ' + r.evidence.transcript + ')';
    return e ? e.detail.slice(0, 90) + ' [' + e.locator + '; sha256 ' + e.sha256.slice(0, 12) + ']' : 'absent';
  };
  // A positive event is an existence proof whatever the transcript's state; absence is a verdict only on a complete transcript.
  const verdict = (r: any) => {
    if (r.termination.startsWith('not_run')) return r.termination;
    if (!r.evidence) return 'unobservable';
    const opened = !!r.evidence.skill_open, ran = !!r.evidence.helper_run, any = r.evidence.gstack_paths > 0 || opened || ran;
    const complete = r.evidence.transcript === 'complete';
    const absent = (s: string) => complete ? s : 'unobservable (transcript ' + r.evidence.transcript + ')';
    if (r.arm === 'none') return any ? 'gstack path seen in a no-gstack arm (' + r.evidence.gstack_paths + ' events)' : absent('no gstack path in this trial');
    if (r.task === 3) return opened ? 'gstack skill opened in the control' : absent('no gstack skill opened in this trial');
    return opened && ran ? 'skill opened and helper run in this trial' : opened ? (complete ? 'skill opened, no helper run in this trial' : 'skill opened; helper run unobservable (transcript ' + r.evidence.transcript + ')') : absent('no gstack skill opened in this trial');
  };
  const day = (rows.find(r => r.started_at)?.started_at ?? new Date().toISOString()).slice(0, 10);
  const deviations = [
    ...(Number(arg('--cap')) !== 16384 ? ['- ' + day + ': the lease ran with an output cap of ' + Number(arg('--cap')).toLocaleString('en-US') + ' tokens a request, not the plan\'s 16,384 (the harnesses state their own max_tokens on every turn and the proxy refuses a stated value above the cap). Accepted as a ceiling detail inside the $' + arg('--lease-usd') + ' lease.'] : []),
    ...(rows.some(r => r.termination === 'not_run:register_failed') ? ['- ' + day + ': ' + rows.filter(r => r.termination === 'not_run:register_failed').map(r => r.trial_id).join(', ') + ' not run: ' + (rows.find(r => r.termination === 'not_run:register_failed')?.note ?? 'registration failed in the preflight') + '.'] : []),
    ...(rows.some(r => r.termination?.startsWith('not_run:cap')) ? ['- ' + day + ': ' + rows.filter(r => r.termination.startsWith('not_run:cap')).length + ' planned cell(s) not dispatched after the lease refused a request' + (arg('--stop') ? ' (' + arg('--stop') + ')' : '') + '.'] : []),
  ].concat(rows.some(r => r.tree_dirty) ? ['- ' + day + ': the tree carried uncommitted changes when the run started (tree-status.txt beside this report lists them).'] : []);
  if (!deviations.length) deviations.push('- none recorded by the driver.');
  return [
    '# GSTA-135 live discovery, uncounted diagnostic (' + day + ')',
    '',
    'One trial per cell. Each row is an existence proof for that one trial, not a rate; nothing here is a comparison claim. ' +
    'Evidence comes from the harness\'s native transcript (OpenClaw: the exec session store under state/openclaw/exec/agents; Hermes: HERMES_HOME/state.db; QM: no decoder at this pin, so a QM cell is unobservable), ' +
    'decoded tool-call events only; the wrapper\'s gstack-register.log, assistant prose and quoted examples never count.',
    '',
    '- gstack pin: ' + arg('--pin') + '; tree ' + (rows[0]?.tree ?? '?') + (rows[0]?.tree_dirty ? ' (dirty)' : '') + '; model ' + (rows[0]?.model ?? '?'),
    '- lease: run id ' + arg('--run-id') + ', $' + arg('--lease-usd') + ', output cap ' + arg('--cap') + ' tokens a request; proxy on the docker bridge gateway with per-trial tokens',
    '- spent ' + money(sum(rows, 'usd_spent')) + ' settled; ' + money(sum(rows, 'usd_charged_reservation')) + ' charged at full reservation on upstream failures (committed in the ledger and counted by the cap, outside the per-trial bar); ' + money(sum(rows, 'usd_reserved_unknown')) + ' reserved on failed requests (unknown, not folded into spent); lease summary: ' + (arg('--summary') || 'none'),
    requestsLine(rows),
    ...(arg('--stop') ? ['- stopped: ' + arg('--stop')] : []),
    '',
    '## Deviations',
    '',
    ...deviations,
    '',
    '## Cells',
    '',
    '| trial | harness | task | arm | termination | exit | forwarded | spent | unknown | skill opened | helper run | verdict for this trial |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(r => '| ' + [r.trial_id, r.harness, r.task, r.arm, r.termination, r.exit_code ?? '', r.requests_forwarded ?? 0, money(r.usd_spent ?? 0), money(r.usd_reserved_unknown ?? 0), ev(r, 'skill_open'), ev(r, 'helper_run'), verdict(r)].join(' | ') + ' |'),
    '',
    '## Images',
    '',
    ...[...new Map(rows.map(r => [r.image, r.image_digest])).entries()].map(([i, d]) => '- ' + i + ' ' + d),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const [cellsPath, outPath, ...rest] = process.argv.slice(2);
  if (!cellsPath || !outPath) { console.error('usage: report.ts <cells.jsonl> <report.md> (--manifest <manifest.json> | --pin <pin8> --run-id <id> --lease-usd <n> --cap <n>) [--summary <json>] [--stop <reason>]'); process.exit(64); }
  const arg = (n: string, d = '') => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] ?? d : d; };
  const rows = readFileSync(cellsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const manifestPath = arg('--manifest');
  const md = manifestPath ? panelReport(rows, JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath, arg) : discoveryReport(rows, arg);
  writeFileSync(outPath, md);
  console.log('wrote ' + outPath + ' with ' + rows.length + ' rows' + (manifestPath ? ' (panel)' : ' (discovery)'));
}
