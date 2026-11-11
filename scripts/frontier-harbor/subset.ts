#!/usr/bin/env bun
// A copy of a merged frontier results directory with some trials removed, from trials.jsonl and from the manifest's
// planned trials, for the descriptive sensitivity lines of frontier-harness-2026-11 (internal-task). analyze.ts then runs on
// the copy with the same specs.
//
//   bun scripts/frontier-harbor/subset.ts --results <merged dir> --out <dir> <one rule>
//     --drop-tasks <id,id,...>                 every trial of these tasks (amendment 1: the three drifted tasks)
//     --drop-exception <Harbor exception>      every trial with this frontier.exception (amendment 2: AgentSafetyRefusalError)
//     --drop-first-runs-ended <from> <to>      every trial that is not a rerun and ended in [from, to), ISO instants
//                                              (amendment 4: the GitHub outage window)
//     --drop-trials <list.json>                every trial of a { trial_ids } list (refusals.ts: a provider refusal
//                                              found the same way in every harness)
//     --infra-as-fail <harness>:<task>         drops nothing: every infra_error trial of this harness and task is scored
//                                              as a harness_error fail instead (Pi exits before any request on a task
//                                              whose instruction starts with "- ")
//
// It writes manifest.json, trials.jsonl and subset.json ({ rule, dropped, by_cell }, by_cell counting the trials dropped,
// or rescored under --infra-as-fail) and never writes the source.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import type { PredicateResult, Termination } from '../../runner/contracts.ts';

export interface SubsetRecord {
  trial_id: string; task: string; harness: string; cell: string; termination: Termination; ended_at: string;
  grade: 'pass' | 'fail' | 'n/a'; predicates: PredicateResult[]; frontier: { exception: string | null; rerun: number | null };
}

const fail = (m: string): never => { throw new RunnerError('HE-FRONTIER-007', 'subset: ' + m); };

export type SubsetRule = { trial_ids: string[] } | { tasks: string[] } | { exception: string } | { from: string; to: string } | { infra_as_fail: { harness: string; task: string } };

export function dropped(r: SubsetRecord, rule: SubsetRule): boolean {
  if ('infra_as_fail' in rule) return false;
  if ('trial_ids' in rule) return rule.trial_ids.includes(r.trial_id);
  if ('tasks' in rule) return rule.tasks.includes(r.task);
  if ('exception' in rule) return r.frontier.exception === rule.exception;
  const t = Date.parse(r.ended_at);
  return !r.frontier.rerun && t >= Date.parse(rule.from) && t < Date.parse(rule.to);
}

export function subset<R extends SubsetRecord>(records: R[], manifest: { trials: Array<{ id: string; cell: string }> }, rule: SubsetRule) {
  if ('infra_as_fail' in rule) {
    const { harness, task } = rule.infra_as_fail;
    const byCell: Record<string, number> = {};
    const out = records.map((r) => {
      if (r.harness !== harness || r.task !== task || r.termination !== 'infra_error') return r;
      byCell[r.cell] = (byCell[r.cell] ?? 0) + 1;
      return { ...r, termination: 'harness_error', grade: 'fail', predicates: [{ id: 'verifier_reward', kind: 'required', passed: false, evidence: 'scored as a fail by subset.ts --infra-as-fail' }] } as R;
    });
    return { records: out, manifest, dropped: 0, by_cell: byCell };
  }
  const gone = new Set(records.filter((r) => dropped(r, rule)).map((r) => r.trial_id));
  const byCell: Record<string, number> = {};
  for (const r of records) if (gone.has(r.trial_id)) byCell[r.cell] = (byCell[r.cell] ?? 0) + 1;
  return { records: records.filter((r) => !gone.has(r.trial_id)), manifest: { ...manifest, trials: manifest.trials.filter((t) => !gone.has(t.id)) }, dropped: gone.size, by_cell: byCell };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string, k = 1) => (argv.includes(n) ? argv[argv.indexOf(n) + k] : undefined);
  try {
    const src = resolve(flag('--results') ?? fail('--results is required'));
    const out = resolve(flag('--out') ?? fail('--out is required'));
    const tasks = flag('--drop-tasks'), exception = flag('--drop-exception'), from = flag('--drop-first-runs-ended'), to = flag('--drop-first-runs-ended', 2), asFail = flag('--infra-as-fail'), list = flag('--drop-trials');
    const pair = asFail ? /^([^:]+):([^:]+)$/.exec(asFail) ?? fail('--infra-as-fail takes <harness>:<task>') : null;
    const rules = [tasks && { tasks: tasks.split(',') }, exception && { exception }, from && { from, to: to ?? fail('--drop-first-runs-ended takes <from> <to>') }, pair && { infra_as_fail: { harness: pair[1]!, task: pair[2]! } }, list && { trial_ids: (JSON.parse(readFileSync(resolve(list), 'utf8')) as { trial_ids: string[] }).trial_ids }].filter(Boolean) as SubsetRule[];
    if (rules.length !== 1) fail('give exactly one rule: --drop-tasks, --drop-exception, --drop-first-runs-ended, --drop-trials or --infra-as-fail');
    if ('from' in rules[0]! && (Number.isNaN(Date.parse(rules[0].from)) || Number.isNaN(Date.parse(rules[0].to)))) fail('--drop-first-runs-ended takes two ISO instants');
    if (existsSync(join(out, 'trials.jsonl'))) fail(out + ' already holds trials.jsonl');
    const records = readFileSync(join(src, 'trials.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as SubsetRecord);
    const s = subset(records, JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')), rules[0]!);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(s.manifest, null, 2) + '\n');
    writeFileSync(join(out, 'trials.jsonl'), s.records.map((r) => JSON.stringify(r)).join('\n') + (s.records.length ? '\n' : ''));
    writeFileSync(join(out, 'subset.json'), JSON.stringify({ rule: 'trial_ids' in rules[0]! ? { trials_from: list } : rules[0], dropped: s.dropped, by_cell: s.by_cell }, null, 1) + '\n');
    console.log('subset: ' + s.dropped + ' of ' + records.length + ' trial(s) dropped' + ('infra_as_fail' in rules[0]! ? ', ' + Object.values(s.by_cell).reduce((a, b) => a + b, 0) + ' rescored as fails' : ''));
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  }
}
