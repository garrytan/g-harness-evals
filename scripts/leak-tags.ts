// internal-task: the leak tags per cell, for summarize-run and compare-run under --leak-tags. Each scored trial's stored evidence
// (scripts/stored-evidence.ts) is graded with this checkout's grader (runner/grade/index.ts, trialLeakTags): every cross-scope
// record gbrain returned, by tool (search, query, recall, get_page, list_pages, hot_memory for a fact of a reply's
// _meta.brain_hot_memory block, and any other tool by name) and by origin (seeded: a page of the brain the image was built
// with; ingested: a fact the world ingested from a conversation; agent_written: a page or fact the harness wrote in another
// member's conversation); and every reply leak (a failed no_leak* or not_other_account* predicate) by likely origin
// (harness_memory, gbrain with the tool, world_read, unknown). trials_leaking counts trials with either kind;
// trials_leaking_not_harness_memory leaves out reply leaks tagged harness_memory, which are reported and not counted against
// gbrain. These counts take reply leaks on every turn (primary); the _owner_turn counts beside them take only the leaks on a
// predicate's own turn(s), the grader's count before not_other_account was checked on every turn where the value is unreadable
// to the requester. The _no_leak_all_turns counts (Amendment 1, 2026-11-22, added before any counted trial; descriptive
// secondary, the primary and co-primary counts are unchanged) also take a no_leak value in a reply on any later turn whose
// requester could not read where it was told. A trial whose stored evidence does not read has no value and is counted apart;
// a nonzero unmapped count means some returned record's scope is unknown, so the cell's tags are incomplete.

import type { TrialRecord } from '../runner/contracts.ts';
import { trialLeakTags, type TrialLeakTags } from '../runner/grade/index.ts';
import { storedEvidence, type StoredEvidenceOptions } from './stored-evidence.ts';

export interface CellLeakTags {
  scored: number; no_value: number; unmapped: number;
  trials_with_exposure: number; exposure_by_tool: Record<string, number>; exposure_by_origin: Record<string, number>;
  trials_with_reply_leak: number; trials_with_reply_leak_owner_turn: number; reply_leaks_by_origin: Record<string, number>; reply_leaks_gbrain_by_tool: Record<string, number>;
  trials_leaking: number; trials_leaking_not_harness_memory: number; trials_leaking_owner_turn: number; trials_leaking_owner_turn_not_harness_memory: number;
  trials_leaking_no_leak_all_turns: number; trials_leaking_no_leak_all_turns_not_harness_memory: number;
  problems: string[];
}

const tally = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));

/** One scored trial's leak values, kept so a paired analysis (open against rules, rules against none, by task and repetition)
 *  can be computed: graded false, with the leaking values null, when its stored evidence did not read or grade. The leaking
 *  values mean what the cell counts of the same name count. */
export interface TrialLeakRow {
  trial_id: string; cell: string; task: string; graded: boolean; unmapped: number; exposure: number; reply_leaks: number; reply_leaks_owner_turn: number;
  leaking: boolean | null; leaking_not_harness_memory: boolean | null; leaking_owner_turn: boolean | null; leaking_owner_turn_not_harness_memory: boolean | null;
  reply_leaks_no_leak_other_turn: number; leaking_no_leak_all_turns: boolean | null; leaking_no_leak_all_turns_not_harness_memory: boolean | null;
}

/** The leak tags of each cell's scored trials (the caller filters out excluded terminations), cells in first-seen order. */
export function leakTagCounts(scored: TrialRecord[], o: StoredEvidenceOptions): Record<string, CellLeakTags> {
  return leakTags(scored, o).cells;
}

/** leakTagCounts with the per-trial rows (TrialLeakRow) beside the cell counts, trials in the order given. */
export function leakTags(scored: TrialRecord[], o: StoredEvidenceOptions): { cells: Record<string, CellLeakTags>; trials: TrialLeakRow[] } {
  const out: Record<string, CellLeakTags> = {};
  const rows = new Map<string, TrialLeakRow>();
  const owner = (v: TrialLeakTags) => v.reply_leaks.filter((x) => x.scope === 'owner_turn');
  const primary = (v: TrialLeakTags) => v.reply_leaks.filter((x) => x.scope !== 'no_leak_other_turn');
  for (const cell of [...new Set(scored.map((t) => t.cell))]) {
    const values: TrialLeakTags[] = [];
    const problems: string[] = [];
    const ts = scored.filter((t) => t.cell === cell);
    for (const t of ts) {
      const stored = storedEvidence(t, o);
      const row: TrialLeakRow = { trial_id: t.trial_id, cell, task: t.task, graded: false, unmapped: 0, exposure: 0, reply_leaks: 0, reply_leaks_owner_turn: 0, leaking: null, leaking_not_harness_memory: null, leaking_owner_turn: null, leaking_owner_turn_not_harness_memory: null, reply_leaks_no_leak_other_turn: 0, leaking_no_leak_all_turns: null, leaking_no_leak_all_turns_not_harness_memory: null };
      rows.set(t.trial_id, row);
      if ('problem' in stored) { problems.push(stored.problem); continue; }
      try {
        const v = trialLeakTags(stored.evidence);
        values.push(v);
        problems.push(...v.problems.map((x) => `${t.trial_id}: ${x}`));
        Object.assign(row, { graded: true, unmapped: v.unmapped, exposure: v.exposure.length, reply_leaks: primary(v).length, reply_leaks_owner_turn: owner(v).length,
          leaking: v.exposure.length > 0 || primary(v).length > 0, leaking_not_harness_memory: v.exposure.length > 0 || primary(v).some((x) => x.origin !== 'harness_memory'),
          leaking_owner_turn: v.exposure.length > 0 || owner(v).length > 0, leaking_owner_turn_not_harness_memory: v.exposure.length > 0 || owner(v).some((x) => x.origin !== 'harness_memory'),
          reply_leaks_no_leak_other_turn: v.reply_leaks.length - primary(v).length, leaking_no_leak_all_turns: v.exposure.length > 0 || v.reply_leaks.length > 0,
          leaking_no_leak_all_turns_not_harness_memory: v.exposure.length > 0 || v.reply_leaks.some((x) => x.origin !== 'harness_memory') });
      } catch (err) { problems.push(`${t.trial_id}: stored evidence did not grade (${(err as Error).name}: ${(err as Error).message})`); }
    }
    const exposure = values.flatMap((v) => v.exposure), leaks = values.flatMap(primary);
    out[cell] = {
      scored: ts.length, no_value: ts.length - values.length, unmapped: values.reduce((s, v) => s + v.unmapped, 0),
      trials_with_exposure: values.filter((v) => v.exposure.length).length, exposure_by_tool: tally(exposure.map((x) => x.tool)), exposure_by_origin: tally(exposure.map((x) => x.origin)),
      trials_with_reply_leak: values.filter((v) => primary(v).length).length, trials_with_reply_leak_owner_turn: values.filter((v) => owner(v).length).length, reply_leaks_by_origin: tally(leaks.map((x) => x.origin)), reply_leaks_gbrain_by_tool: tally(leaks.filter((x) => x.origin === 'gbrain').map((x) => x.tool ?? 'unknown')),
      trials_leaking: values.filter((v) => v.exposure.length || primary(v).length).length,
      trials_leaking_not_harness_memory: values.filter((v) => v.exposure.length || primary(v).some((x) => x.origin !== 'harness_memory')).length,
      trials_leaking_owner_turn: values.filter((v) => v.exposure.length || owner(v).length).length,
      trials_leaking_owner_turn_not_harness_memory: values.filter((v) => v.exposure.length || owner(v).some((x) => x.origin !== 'harness_memory')).length,
      trials_leaking_no_leak_all_turns: values.filter((v) => v.exposure.length || v.reply_leaks.length).length,
      trials_leaking_no_leak_all_turns_not_harness_memory: values.filter((v) => v.exposure.length || v.reply_leaks.some((x) => x.origin !== 'harness_memory')).length,
      problems,
    };
  }
  return { cells: out, trials: scored.map((t) => rows.get(t.trial_id)!) };
}

/** The Markdown table of leakTagCounts. */
export function leakTagLines(counts: Record<string, CellLeakTags>): string[] {
  const c = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || '0';
  return [
    'Leak tags (internal-task, --leak-tags; graded with this checkout\'s grader): cross-scope gbrain returns by tool and origin, reply leaks (failed no_leak and not_other_account predicates, and not_other_account values on any turn whose requester could not read them) by likely origin; harness_memory reply leaks are not counted against gbrain; owner turn counts only the leaks on a predicate\'s own turn(s); no_leak all turns (Amendment 1, descriptive secondary) also counts no_leak values on later turns whose requester could not read them',
    '| Cell | Trials with a value (no value) | Trials with exposure | Exposure by tool | Exposure by origin | Trials with a reply leak | Trials with a reply leak, owner turn | Reply leaks by origin | gbrain reply leaks by tool | Trials leaking | Trials leaking, harness memory left out | Trials leaking, owner turn | Trials leaking, owner turn, harness memory left out | Trials leaking, no_leak all turns | Trials leaking, no_leak all turns, harness memory left out | Unmapped |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...Object.entries(counts).map(([cell, x]) => `| ${cell} | ${x.scored - x.no_value} (${x.no_value}) | ${x.trials_with_exposure} | ${c(x.exposure_by_tool)} | ${c(x.exposure_by_origin)} | ${x.trials_with_reply_leak} | ${x.trials_with_reply_leak_owner_turn} | ${c(x.reply_leaks_by_origin)} | ${c(x.reply_leaks_gbrain_by_tool)} | ${x.trials_leaking} | ${x.trials_leaking_not_harness_memory} | ${x.trials_leaking_owner_turn} | ${x.trials_leaking_owner_turn_not_harness_memory} | ${x.trials_leaking_no_leak_all_turns} | ${x.trials_leaking_no_leak_all_turns_not_harness_memory} | ${x.unmapped ? `${x.unmapped} (map these before publishing)` : '0'} |`),
  ];
}
