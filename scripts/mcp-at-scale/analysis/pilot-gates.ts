#!/usr/bin/env bun
// The R111 pilot gates of the MCP-at-scale eval (internal-task plan, dated change 2026-11-19): per arm, on that arm's own pilot
// outputs, before its counted run.
//   (a) The part under test ran: the catalog host's log shows the arm's surface was listed (initialize and tools/list on
//       every expected server) and called (a tools/call on a catalog server) at every rung the arm runs, and the surface's
//       own evidence: a search surface (native listing plus a search tool, and QM's connectors with tool_search) shows a
//       search call in the transcript (search-effort.ts); a send-everything surface shows none; a gbrain surface shows
//       gbrain listed and called, verbs and as-registered show request_tools and then a full-only tool, full shows a
//       full-only tool, and starter must list the starter surface first. It can widen through request_tools or answer
//       a direct call to an unlisted tool; both paths and full-only calls are reported. For gbrain arms, a catalog call
//       is only required if there are set R pilot trials, and it must come from one of those trials.
//   (b) The judge check is not applicable: grading is deterministic, from the catalog host's log (decision G), so R78's
//       kappa check has nothing to check, and no pre-counted judge stage runs.
//   (c) The tasks can be supplied: each set the arm uses has its planned counts (requests/sets.ts), every item passed the
//       ambiguity audit (audit-status.json: passed or widened), and every rung the arm uses loads in the catalog host's
//       loader with no catalog problem.
// Spend: the arm's pilot cost (the trials' metered usd) is at most a tenth of its planned spend (arms.json).
//
//   bun scripts/mcp-at-scale/analysis/pilot-gates.ts --pilot <pilot trials.jsonl> --sets <set-r.jsonl> <set-t.jsonl> <set-g.jsonl>
//       --audit <audit-status.json> --catalog <dir> [--arms <arms.json>] [--gbrain-surfaces <json>] [--json <out.json>]
//
// Prints PASS or FAIL per arm with its reasons; exits 1 when any arm fails. A failing arm is fixed and piloted again, or
// left out and reported as left out (not a dropped arm under R71).
//
// Dry form, before the pilot spends anything: --planned <pilot spec.json> --estimates <estimates.json> in place of --pilot.
// It reads the spec's planned trials (scripts/mcp-at-scale/run.ts checkSpec), prices each with the first estimate rule that
// matches it, and checks per arm what can be checked before a trial runs: (a) a planned trial at every rung the arm runs,
// (c) as above, and the spend gate on the planned usd. Estimates: { "basis": "<where the numbers come from>",
// "rules": [ { "variant"?, "model"?, "set"?, "rung"?, "usd": <per trial> } ] }.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCatalog, loadCatalog, rungServers } from '../catalog-load.ts';
import type { AuditStatus } from '../requests/audit.ts';
import { itemSha, loadLadder, twinsOf, validateSet, type Item, type SetName, type Surfaces } from '../requests/sets.ts';
import { hasTranscript, isInfra, loadTrials, readJsonl, type Trial } from './stats.ts';
import { checkSpec, loadSpec } from '../run.ts';

export interface Arm { id: string; match: { arm: string; harness?: string }; surface: string; search_tool?: string; sets: SetName[]; rungs: number[]; planned_usd: number }
export interface ArmsFile { pilot_share_max: number; arms: Arm[] }
export const ARMS_FILE = join(import.meta.dir, 'arms.json');

type Check = { pass: boolean; reasons: string[] };
const ok = (reasons: string[] = []): Check => ({ pass: true, reasons });
const fail = (reasons: string[]): Check => ({ pass: false, reasons });

type LogLine = { server: string; method: string; tool?: string; ok?: boolean };
const gbrainCalls = (log: LogLine[]) => log.filter((x) => x.server === 'gbrain' && x.method === 'tools/call' && x.ok === true);

/** Catalog handshake evidence requires the raw host log, not derived outcomes from an older grader. */
function hostLog(t: Trial): LogLine[] {
  if (t.host_log_lines) return t.host_log_lines as LogLine[];
  return (t.outcomes?.calls ?? []).map((c) => ({ server: c.server, method: 'tools/call', tool: c.tool }));
}

export function starterUsage(trials: Trial[], surfaces: Surfaces) {
  const starter = new Set(surfaces.starter);
  const fullOnly = new Set(surfaces.full.filter((tool) => !starter.has(tool)));
  let widened = 0, direct = 0, reached = 0, wrongList = 0;
  for (const t of trials) {
    const log = hostLog(t);
    const advertised = t.gbrain_listed_tools;
    if (log.some((x) => x.server === 'gbrain' && x.method === 'tools/list' && x.ok === true)
      && (!advertised || advertised.length !== starter.size || new Set(advertised).size !== starter.size || advertised.some((tool) => !starter.has(tool)))) wrongList++;
    const calls = gbrainCalls(log);
    const firstRequest = calls.findIndex((x) => x.tool === 'request_tools');
    if (firstRequest >= 0) widened++;
    if (advertised && (firstRequest < 0 ? calls : calls.slice(0, firstRequest)).some((x) => x.tool && x.tool !== 'request_tools' && !advertised.includes(x.tool))) direct++;
    if (calls.some((x) => fullOnly.has(x.tool ?? ''))) reached++;
  }
  return { n: trials.length, widened, direct, reached, wrongList };
}

export function surfaceRan(arm: Arm, trials: Trial[], surfaces: Surfaces | null): Check {
  const reasons: string[] = [], bad: string[] = [];
  const isGbrain = arm.surface.startsWith('gbrain:');
  for (const r of arm.rungs) {
    const rows = trials.filter((t) => t.rung === r);
    if (!rows.length) { bad.push('no pilot trial at rung ' + r); continue; }
    const listed = rows.filter((t) => {
      const log = hostLog(t).filter((l) => l.ok === true);
      const exp = t.outcomes?.servers_expected ?? [];
      return exp.length > 0 && exp.every((s) => log.some((l) => l.server === s && l.method === 'initialize') && log.some((l) => l.server === s && l.method === 'tools/list'));
    });
    const catalogRows = isGbrain ? rows.filter((t) => t.set === 'R') : rows;
    const called = catalogRows.filter((t) => hostLog(t).some((l) => l.method === 'tools/call' && l.server !== 'gbrain'));
    if (!listed.length) bad.push('rung ' + r + ': no trial listed every expected server');
    if (catalogRows.length && !called.length) bad.push('rung ' + r + ': no catalog tool was called' + (isGbrain ? ' on set R' : ''));
    reasons.push('rung ' + r + ': ' + listed.length + '/' + rows.length + ' trials listed every server, ' + (catalogRows.length ? called.length + '/' + catalogRows.length + (isGbrain ? ' set R' : '') + ' trials called a catalog tool' : 'no set R trials to check for catalog calls') + ', ' + rows.filter(isInfra).length + ' INFRA');
  }
  if (['search', 'qm_connectors', 'send_everything'].includes(arm.surface)) {
    const evidence = trials.filter((t) => hasTranscript(t) && Number.isSafeInteger(t.effort!.search_calls) && t.effort!.search_calls >= 0);
    const searches = evidence.filter((t) => t.effort!.search_calls > 0).length;
    if (!evidence.length) bad.push('no parsed transcript with search-call evidence');
    else if (arm.surface === 'send_everything') {
      if (searches) bad.push(searches + ' trials searched, so tools were not all sent up front');
      else reasons.push('no search call in ' + evidence.length + ' parsed transcripts');
    } else if (!searches) bad.push('the search tool (' + (arm.search_tool ?? 'search') + ') was never called in ' + evidence.length + ' parsed transcripts');
    else reasons.push('search tool called in ' + searches + ' of ' + evidence.length + ' parsed transcripts');
  }
  if (isGbrain) {
    const s = arm.surface.slice(7);
    const logs = trials.map(hostLog);
    const calls = logs.map(gbrainCalls);
    if (!logs.some((l) => l.some((x) => x.server === 'gbrain' && x.method === 'tools/list' && x.ok === true))) bad.push('gbrain was never listed (no successful tools/list on the gbrain relay)');
    if (!calls.some((c) => c.length)) bad.push('no gbrain tool call succeeded on the relay');
    if (!surfaces) bad.push('no --gbrain-surfaces file, so the ' + s + ' surface cannot be told apart from the others');
    else {
      const fullOnly = new Set(surfaces.full.filter((x) => !surfaces.starter.includes(x)));
      const reachedFullOnly = calls.filter((c) => c.some((x) => fullOnly.has(x.tool ?? ''))).length;
      const requested = calls.filter((c) => { const k = c.findIndex((x) => x.tool === 'request_tools'); return k >= 0 && c.slice(k + 1).some((x) => fullOnly.has(x.tool ?? '')); }).length;
      if (s === 'starter') {
        const { n, widened, direct, reached, wrongList } = starterUsage(trials, surfaces);
        if (wrongList) bad.push(wrongList + ' trials did not show the frozen starter tools in their first gbrain tools/list');
        const share = (k: number) => k + '/' + n + ' (' + (n ? (100 * k / n).toFixed(1) : '0.0') + '%)';
        reasons.push('starter as shipped: widened through request_tools ' + share(widened) + ', called an unlisted tool directly ' + share(direct) + ', reached a full-only tool ' + share(reached));
      }
      if (s === 'full' && !reachedFullOnly) bad.push('no trial called a full-only tool');
      if ((s === 'verbs' || s === 'registered') && !requested) bad.push('no trial called request_tools and then a full-only tool');
      if (s !== 'starter') reasons.push('gbrain: ' + reachedFullOnly + ' trials reached a full-only tool, ' + requested + ' through request_tools');
    }
  }
  return bad.length ? fail([...bad, ...reasons]) : ok(reasons);
}

export function tasksSupplied(arm: Arm, sets: Partial<Record<SetName, Item[]>>, audit: AuditStatus | null, catalogDir: string, surfaces: Surfaces | null): Check {
  const bad: string[] = [], reasons: string[] = [];
  const ladderPath = join(catalogDir, 'ladder.json');
  for (const s of arm.sets) {
    const items = sets[s];
    if (!items) { bad.push('set ' + s + ' was not given'); continue; }
    const r = validateSet(s, items, { ladder: loadLadder(ladderPath), twins: twinsOf(ladderPath), surfaces: surfaces ?? undefined });
    if (!r.ok) bad.push('set ' + s + ': ' + r.problems.length + ' problem(s), first: ' + r.problems[0]);
    else reasons.push('set ' + s + ' has its planned counts ' + JSON.stringify(r.counts));
    if (!audit) { bad.push('no audit status file'); continue; }
    const notPassed = items.filter((i) => !['passed', 'widened'].includes(audit.items[i.id] ?? 'missing'));
    const changed = items.find((i) => audit.audited_item_sha256?.[i.id] !== itemSha(i));
    if (notPassed.length) bad.push('set ' + s + ': ' + notPassed.length + ' item(s) have not passed the ambiguity audit (first ' + notPassed[0]!.id + ': ' + (audit.items[notPassed[0]!.id] ?? 'missing') + ')');
    else if (changed) bad.push('set ' + s + ': ' + changed.id + ' does not match its audited request');
    else reasons.push('set ' + s + ': every item passed the audit');
  }
  try {
    const cat = loadCatalog(catalogDir);
    const problems = checkCatalog(cat);
    if (problems.length) bad.push('the catalog has ' + problems.length + ' problem(s), first: ' + problems[0]);
    for (const r of arm.rungs) {
      const servers = rungServers(cat, String(r));
      reasons.push('rung ' + r + ' loads: ' + servers.length + ' servers, ' + servers.reduce((n, s) => n + s.tools.length, 0) + ' tools');
    }
  } catch (e) { bad.push('the catalog does not load: ' + (e as Error).message); }
  return bad.length ? fail([...bad, ...reasons]) : ok(reasons);
}

export function gate(o: { arms: ArmsFile; pilot: Trial[]; sets: Partial<Record<SetName, Item[]>>; audit: AuditStatus | null; catalogDir: string; surfaces: Surfaces | null }) {
  return o.arms.arms.map((arm) => {
    const trials = o.pilot.filter((t) => t.arm === arm.match.arm && (!arm.match.harness || t.harness === arm.match.harness));
    const spent = trials.reduce((s, t) => s + (t.usage?.usd ?? 0), 0);
    const cap = arm.planned_usd * o.arms.pilot_share_max;
    const unmetered = trials.filter((t) => !t.usage).length;
    const checks = {
      a_part_under_test_ran: trials.length ? surfaceRan(arm, trials, o.surfaces) : fail(['no pilot trials for this arm']),
      b_judge: ok(['not applicable: grading is deterministic, from the catalog host\'s log (plan decision G), so R78\'s judge check has nothing to check']),
      c_tasks_supplied: tasksSupplied(arm, o.sets, o.audit, o.catalogDir, o.surfaces),
      spend: spent <= cap && !unmetered ? ok(['pilot spent $' + spent.toFixed(2) + ', cap $' + cap.toFixed(2) + ' (a tenth of $' + arm.planned_usd + ')'])
        : fail([unmetered ? unmetered + ' pilot trials have no metered usage' : 'pilot spent $' + spent.toFixed(2) + ', over the cap of $' + cap.toFixed(2) + ' (a tenth of $' + arm.planned_usd + ')']),
    };
    return { arm: arm.id, pass: Object.values(checks).every((c) => c.pass), trials: trials.length, spent_usd: Number(spent.toFixed(4)), cap_usd: Number(cap.toFixed(4)), checks };
  });
}

export interface EstimateRule { variant?: string; model?: string; set?: string; rung?: number; usd: number }

/** The spec's planned trials, priced by the first matching estimate rule, as the rows the gates read (no outcomes). */
export function plannedTrials(specPath: string, rules: EstimateRule[]): Array<Trial & { variant: string; planned: true }> {
  const { problems, plan } = checkSpec(loadSpec(specPath));
  if (problems.length) throw new Error('the pilot spec has ' + problems.length + ' problem(s), first: ' + problems[0]);
  return [...plan.cells.values()].flatMap((c) => c.trials.map((t) => {
    const set = plan.items.get(t.request)!.set;
    const rule = rules.find((r) => (r.variant === undefined || r.variant === c.cell.variant) && (r.model === undefined || r.model === c.cell.model) && (r.set === undefined || r.set === set) && (r.rung === undefined || r.rung === t.rung));
    if (!rule) throw new Error('no estimate rule prices ' + c.cell.variant + ' ' + c.cell.model + ' set ' + set + ' rung ' + t.rung);
    return { trial_id: t.trial_id, arm: c.arm, harness: c.harness, variant: c.cell.variant, model: c.cell.model, rung: t.rung, set, usage: { usd: rule.usd }, planned: true as const } as unknown as Trial & { variant: string; planned: true };
  }));
}

/** The dry gates: rung coverage for (a), (c) unchanged, and the spend gate on the planned usd. */
export function dryGate(o: { arms: ArmsFile; planned: Trial[]; sets: Partial<Record<SetName, Item[]>>; audit: AuditStatus | null; catalogDir: string; surfaces: Surfaces | null }) {
  return o.arms.arms.map((arm) => {
    const trials = o.planned.filter((t) => t.arm === arm.match.arm && (!arm.match.harness || t.harness === arm.match.harness));
    const spent = trials.reduce((s, t) => s + (t.usage?.usd ?? 0), 0);
    const cap = arm.planned_usd * o.arms.pilot_share_max;
    const missing = arm.rungs.filter((r) => !trials.some((t) => t.rung === r));
    const perRung = arm.rungs.map((r) => 'rung ' + r + ': ' + trials.filter((t) => t.rung === r).length + ' planned').join(', ');
    const checks = {
      a_rungs_planned: !trials.length ? fail(['no pilot trials planned for this arm']) : missing.length ? fail(['no planned trial at rung ' + missing.join(', '), perRung]) : ok([perRung]),
      c_tasks_supplied: tasksSupplied(arm, o.sets, o.audit, o.catalogDir, o.surfaces),
      spend: spent <= cap ? ok(['planned $' + spent.toFixed(2) + ', cap $' + cap.toFixed(2) + ' (a tenth of $' + arm.planned_usd + ')'])
        : fail(['planned $' + spent.toFixed(2) + ', over the cap of $' + cap.toFixed(2) + ' (a tenth of $' + arm.planned_usd + '): shrink the arm']),
    };
    return { arm: arm.id, pass: Object.values(checks).every((c) => c.pass), trials: trials.length, spent_usd: Number(spent.toFixed(4)), cap_usd: Number(cap.toFixed(4)), checks };
  });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const after = argv.includes('--sets') ? argv.slice(argv.indexOf('--sets') + 1) : [];
  const end = after.findIndex((x) => x.startsWith('--'));
  const setFiles = end < 0 ? after : after.slice(0, end);
  const pilot = flag('--pilot'), planned = flag('--planned'), estimates = flag('--estimates'), catalog = flag('--catalog');
  if (!catalog || (!pilot && !(planned && estimates))) { console.error('usage: pilot-gates.ts (--pilot <trials.jsonl> | --planned <pilot spec.json> --estimates <json>) --sets <set.jsonl>... --audit <audit-status.json> --catalog <dir> [--arms <arms.json>] [--gbrain-surfaces <json>] [--json <out>]'); process.exit(2); }
  const sets: Partial<Record<SetName, Item[]>> = {};
  for (const f of setFiles) for (const it of readJsonl<Item>(f)) (sets[it.set] ??= []).push(it);
  const common = {
    arms: JSON.parse(readFileSync(flag('--arms') ?? ARMS_FILE, 'utf8')) as ArmsFile, sets, catalogDir: catalog,
    audit: flag('--audit') ? JSON.parse(readFileSync(flag('--audit')!, 'utf8')) : null,
    surfaces: flag('--gbrain-surfaces') ? JSON.parse(readFileSync(flag('--gbrain-surfaces')!, 'utf8')) : null,
  };
  const report = pilot ? gate({ ...common, pilot: loadTrials(pilot) }) : dryGate({ ...common, planned: plannedTrials(planned!, JSON.parse(readFileSync(estimates!, 'utf8')).rules) });
  for (const r of report) {
    console.log((pilot ? '' : 'DRY ') + (r.pass ? 'PASS ' : 'FAIL ') + r.arm + ' (' + r.trials + (pilot ? ' pilot trials, $' : ' planned trials, $') + r.spent_usd + ' of a $' + r.cap_usd + ' cap)');
    for (const [k, c] of Object.entries(r.checks)) for (const reason of c.reasons) console.log('  ' + (c.pass ? 'ok   ' : 'FAIL ') + k + ': ' + reason);
  }
  if (flag('--json')) writeFileSync(flag('--json')!, JSON.stringify(report, null, 1) + '\n');
  process.exit(report.every((r) => r.pass) ? 0 : 1);
}
