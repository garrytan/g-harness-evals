// merge-shards.ts --partial and a shard that runs several cells (the owner-identity shards run a harness's N, G and B cells
// together). The runner interleaves a shard's trials across its cells in manifest order and stops the shard at the first cap
// refusal (scripts/run-shard.sh --stop-on-cap), so only one cell's last record is the cap stop and the other cells simply stop.
// Before, --partial checked each cell on its own and refused every cell but the one that hit the cap.
//
// Value: protects=a multi-cell shard that stopped on a verified cap refusal merges with --partial, every cell of it listed
// under cap_stops and its unstarted suffix in unstarted.json; a gap with a later record, or a last record that is not a cap
// stop, still refuses the whole shard; fails_when=the merge checks cells one at a time again; seam=fixture shard directories
// built here; no_claim=the runner's own stop (tests/trial-loop.test.ts).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planMerge } from '../scripts/merge-shards.ts';

const RUN = 'multi-cell-cap-fixture-2026-11';
const tmp = mkdtempSync(join(tmpdir(), 'he-multi-cell-cap-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const id = (cell: string, task: string) => RUN + '/' + cell + '/' + task + '/r1';
const ORDER = [['a', 't1'], ['b', 't1'], ['b', 't2'], ['a', 't2'], ['a', 't3'], ['b', 't3']] as const;

function shard(recorded: number, o: { capStop?: boolean; refusal?: boolean; skip?: number } = {}) {
  const dir = mkdtempSync(join(tmp, 's-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: RUN, created_at: '2026-11-27T00:00:00.000Z', trials: ORDER.map(([c, t]) => ({ id: id(c, t), cell: c, task: t })) }));
  writeFileSync(join(dir, 'shard.json'), JSON.stringify({ name: 's1', commit: 'c'.repeat(40), cells: 'a,b' }));
  const kept = ORDER.slice(0, recorded).filter((_, i) => i !== o.skip);
  const rows = kept.map(([c, t], i) => {
    const capped = o.capStop && i === kept.length - 1;
    return { trial_id: id(c, t), cell: c, task: t, termination: capped ? 'model_error' : 'completed', grade: capped ? 'n/a' : 'pass', cap_stop: !!capped, usage: null, started_at: '2026-11-27T00:00:00.000Z' };
  });
  writeFileSync(join(dir, 'trials.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const last = rows.at(-1)!;
  if (o.refusal) writeFileSync(join(dir, 'proxy-usage.ndjson'), JSON.stringify({ at: '2026-11-27T00:01:00.000Z', key: 'trial-token:' + last.trial_id, outcome: 'refused', reason: 'trial-token over its $1 budget', actual_usd: 0 }) + '\n');
  for (const r of rows) {
    mkdirSync(join(dir, 'trials', r.cell, r.task, 'r1'), { recursive: true });
    writeFileSync(join(dir, 'trials', r.cell, r.task, 'r1', 'trial.json'), JSON.stringify({ id: r.trial_id }));
  }
  return [{ name: 's1', dir }];
}

describe('merge-shards --partial: a shard of several cells that stopped on its cap', () => {
  test('merges with every cell of the shard under cap_stops and the shard\'s unstarted suffix listed', () => {
    const plan = planMerge(join(tmp, 'out-1'), shard(3, { capStop: true, refusal: true }), { partial: true });
    expect(plan.capStops).toEqual([{ cell: 'a', shard: 's1', cap_stop_trial: id('b', 't2') }, { cell: 'b', shard: 's1', cap_stop_trial: id('b', 't2') }]);
    expect(plan.unstarted).toEqual([{ id: id('a', 't2'), cell: 'a' }, { id: id('a', 't3'), cell: 'a' }, { id: id('b', 't3'), cell: 'b' }]);
    expect(plan.rows.map((r) => r.trial_id)).toEqual([id('a', 't1'), id('b', 't1'), id('b', 't2')]);
  });

  test('a cap_stop without a refusal in the usage log, a last record that is not a cap stop, or a hole is refused for the shard', () => {
    expect(() => planMerge(join(tmp, 'out-2'), shard(3, { capStop: true }), { partial: true })).toThrow("a, b (last record " + id('b', 't2') + " has cap_stop, but shard s1's proxy-usage.ndjson shows no cap refusal");
    expect(() => planMerge(join(tmp, 'out-3'), shard(3), { partial: true })).toThrow('a, b (last record ' + id('b', 't2') + ' is not a cap stop)');
    expect(() => planMerge(join(tmp, 'out-4'), shard(4, { skip: 1, capStop: true, refusal: true }), { partial: true })).toThrow('a, b (' + id('b', 't1') + ' is missing but the later ' + id('b', 't2') + ' was recorded)');
  });
});
