import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAll, loadEntries, pairedCostPath, perTaskCosts, ratioOf, readResults } from '../scripts/scoreboard/build.ts';
import { entryRecords, pairedCostTable } from '../scripts/scoreboard/paired-cost.ts';
import { analyzeFrontier, type FrontierSpec } from '../scripts/frontier-harbor/analyze.ts';
import type { TrialRecord } from '../runner/contracts.ts';

// Reads the runs' per-trial records, which both copies hold for these runs today; tests/scoreboard.test.ts checks the
// README against the committed per-task tables, which need no per-trial records.

const root = join(import.meta.dir, '..');
const readJson = readResults(root) as (p: string) => any;

describe('scoreboard paired cost tables', () => {
  const { tables } = buildAll(root);

  test('each committed per-task cost table matches its run\'s trial records (run bun scripts/scoreboard/paired-cost.ts)', () => {
    const entries = loadEntries(root).filter((e) => e.paired_cost);
    expect(entries.length).toBeGreaterThan(0);
    const committed: Record<string, string> = {
      'frontier-harness-2026-11': 'docs/scoreboard/paired-cost/frontier-harness-2026-11.json',
      'matrix-mu-2026-11': 'docs/scoreboard/paired-cost/matrix-mu-2026-11.json',
    };
    for (const e of entries) expect(readFileSync(join(root, committed[e.run_id] ?? pairedCostPath(e.run_id)), 'utf8')).toBe(pairedCostTable(root, e));
  });

  test("every frontier paired ratio, in both directions, matches the run's own analysis, run on the records after the 2026-11-09 correction with each cell as the home harness", () => {
    const t = tables.find((x) => x.entry.run_id === 'frontier-harness-2026-11')!;
    const dir = 'docs/benchmarks/2026-11-07-frontier-harness';
    const spec = readJson(`${dir}/analysis-spec.json`) as FrontierSpec;
    const { records, lookups: lookupSet } = entryRecords(root, t.entry);
    expect(records.some((r) => (r.usage?.usd_reserved ?? 0) > 0)).toBe(true);
    const lookups = [...lookupSet];
    const r4 = (x: number) => Number(x.toFixed(4));
    let checked = 0;
    for (const m of spec.models) {
      const cells = spec.cells.filter((c) => c.model === m.id);
      const ids = new Set(cells.map((c) => c.id));
      const recs = records.filter((r) => ids.has(r.cell));
      const kept = new Set(recs.map((r) => r.trial_id));
      for (const home of cells) {
        const a = analyzeFrontier({ records: recs, manifest: null, lookup_fails: lookups.filter((id) => kept.has(id)) }, { ...spec, primary_pairs: { [m.id]: cells.length - 1 }, models: [{ ...m, home: home.id }], cells });
        for (const p of a.pairs) {
          const mine = ratioOf(t.pairs, p.cell, p.home)!;
          expect([p.cell, p.home, mine.tasks, r4(mine.ratio!), mine.ci95!.map(r4)] as unknown[]).toEqual([p.cell, p.home, p.cost_per_solve_ratio.tasks, p.cost_per_solve_ratio.ratio, p.cost_per_solve_ratio.ci95]);
          checked++;
        }
      }
    }
    expect(checked).toBe(24);
  });

  test('a lookup-fails id with no trial record is refused, so a typo never turns a lookup back into a solve', () => {
    const dir = 'docs/benchmarks/2026-11-07-frontier-harness';
    const t = tables.find((x) => x.entry.run_id === 'frontier-harness-2026-11')!;
    const records = readJson(`${dir}/results/merged/trials.jsonl`) as TrialRecord[];
    const lookups = readJson(`${dir}/results/lookup-fails.json`).trial_ids as string[];
    expect(() => perTaskCosts(t.entry.cells, records, new Set(lookups), [])).not.toThrow();
    expect(() => perTaskCosts(t.entry.cells, records, new Set([...lookups, `${lookups[0]}-typo`]), [])).toThrow(/lookup_fails names 1 trial\(s\) with no record: .*-typo/);
  });
});
