// scripts/instruction-route-secondary.ts on small hand-built results: the refusals, the excluded-side pairing count and
// the zero-request hook trial. The committed run reaches none of these paths (585 of 585 trials completed).
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyse, markdown } from '../scripts/instruction-route-secondary.ts';

const RUN = 'fixture-run';
const cells = [
  { id: 'oc-tool', harness: 'openclaw', config: 'route-tool' },
  { id: 'oc-hook', harness: 'openclaw', config: 'route-hook' },
];
interface Trial { cell: string; task: string; rep: number; termination?: string; requests?: number; usage?: boolean; turns?: boolean; proxy?: number }
let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

function results(trials: Trial[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'route-secondary-'));
  dirs.push(dir);
  const rows: string[] = [], proxy: string[] = [];
  for (const t of trials) {
    const id = RUN + '/' + t.cell + '/' + t.task + '/r' + t.rep;
    const requests = t.requests ?? 1;
    rows.push(JSON.stringify({ trial_id: id, cell: t.cell, task: t.task, termination: t.termination ?? 'completed', grade: 'pass', consent_violation: false }));
    const td = join(dir, 'trials', t.cell, t.task, 'r' + t.rep);
    mkdirSync(join(td, 'logs'), { recursive: true });
    if (t.usage !== false) writeFileSync(join(td, 'usage.json'), JSON.stringify({ usd: 0.01, requests, input_tokens: 100, output_tokens: 10, cached_tokens: 0 }));
    if (t.turns !== false) {
      writeFileSync(join(td, 'turns.jsonl'), JSON.stringify({ turn: 1, started_wall: '2026-10-31T00:00:00.000Z', ended_wall: '2026-10-31T00:01:00.000Z' }) + '\n');
      writeFileSync(join(td, 'logs', 'adapter.log'), 'turn 1: session dm-1\n');
    }
    for (let i = 0; i < (t.proxy ?? requests); i++) proxy.push(JSON.stringify({ at: '2026-10-31T00:00:30.000Z', key: 'trial-token:' + id, outcome: 'forwarded' }));
  }
  writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
  writeFileSync(join(dir, 'shard.proxy-usage.ndjson'), proxy.join('\n') + '\n');
  return dir;
}
const both = (task: string, rep: number): Trial[] => [{ cell: 'oc-tool', task, rep }, { cell: 'oc-hook', task, rep }];

describe('instruction-route-secondary on hand-built results', () => {
  test('a complete pairing analyses, with nothing left out', () => {
    const r = analyse(results([...both('a', 1), ...both('b', 1)]), cells);
    expect(r.comparisons[0]).toMatchObject({ n_pairs: 2, left_pairing: { control_excluded: 0, route_excluded: 0 } });
    expect(r.evidence[1]!.route_bytes).toMatchObject({ per_copy: 291, mean_per_trial: 291, unassigned_requests: 0 });
  });

  test('a pair with an excluded side leaves the pairing and is counted per side', () => {
    const r = analyse(results([
      ...both('a', 1),
      { cell: 'oc-tool', task: 'b', rep: 1, termination: 'infra_error', usage: false, turns: false, proxy: 0 }, { cell: 'oc-hook', task: 'b', rep: 1 },
      { cell: 'oc-tool', task: 'c', rep: 1 }, { cell: 'oc-hook', task: 'c', rep: 1, termination: 'model_error', usage: false, turns: false, proxy: 0 },
    ]), cells);
    expect(r.comparisons[0]).toMatchObject({ n_pairs: 1, left_pairing: { control_excluded: 1, route_excluded: 1 } });
  });

  test('a zero-request hook trial adds no route bytes and needs no turns.jsonl', () => {
    const r = analyse(results([...both('a', 1), { cell: 'oc-tool', task: 'b', rep: 1 }, { cell: 'oc-hook', task: 'b', rep: 1, requests: 0, turns: false }]), cells);
    expect(r.evidence[1]!.route_bytes).toMatchObject({ mean_per_trial: 291 / 2, max_per_trial: 291 });
  });

  test('a route cell with every trial excluded renders with no pairs and no means', () => {
    const r = analyse(results([{ cell: 'oc-tool', task: 'a', rep: 1 }, { cell: 'oc-hook', task: 'a', rep: 1, termination: 'infra_error', usage: false, turns: false, proxy: 0 }]), cells);
    expect(r.comparisons[0]).toMatchObject({ n_pairs: 0, metrics: null, left_pairing: { control_excluded: 0, route_excluded: 1 } });
    expect(r.evidence[1]!.per_trial.pass).toEqual({ mean: null, ci95: null, n: 0, clusters: 0 });
    const md = markdown(r);
    expect(md).toContain('| openclaw | route-hook | 0 (0) | no pairs |');
    expect(md).toContain('| oc-hook | 0 | n/a [n/a, n/a] |');
  });

  test('pairs from a single task render without an interval', () => {
    const r = analyse(results([...both('a', 1), ...both('a', 2)]), cells);
    expect(r.evidence[0]!.per_trial.pass).toEqual({ mean: 1, ci95: null, n: 2, clusters: 1 });
    const md = markdown(r);
    expect(md).toContain('| openclaw | route-hook | 2 (1) |');
    expect(md).toContain('| oc-tool | 2 | 100.0% [n/a, n/a] |');
  });

  test('a hook request inside one turn is not moved to the next turn by the padding', () => {
    const dir = results([...both('a', 1), { cell: 'oc-tool', task: 'b', rep: 1 }, { cell: 'oc-hook', task: 'b', rep: 1, requests: 2 }]);
    const td = join(dir, 'trials', 'oc-hook', 'b', 'r1');
    writeFileSync(join(td, 'turns.jsonl'), [
      { turn: 1, started_wall: '2026-10-31T00:00:00.000Z', ended_wall: '2026-10-31T00:00:01.000Z' },
      { turn: 2, started_wall: '2026-10-31T00:00:01.001Z', ended_wall: '2026-10-31T00:00:02.000Z' },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n');
    writeFileSync(join(td, 'logs', 'adapter.log'), 'turn 1: session dm-1\nturn 2: session dm-1\n');
    const id = RUN + '/oc-hook/b/r1';
    const proxy = join(dir, 'shard.proxy-usage.ndjson');
    const lines = readFileSync(proxy, 'utf8').split('\n').filter((l) => l && !l.includes(id));
    for (const at of ['2026-10-31T00:00:00.500Z', '2026-10-31T00:00:01.500Z']) lines.push(JSON.stringify({ at, key: 'trial-token:' + id, outcome: 'forwarded' }));
    writeFileSync(proxy, lines.join('\n') + '\n');
    const r = analyse(dir, cells);
    expect(r.evidence[1]!.route_bytes).toMatchObject({ max_per_trial: 291 * 3, unassigned_requests: 0 });
  });

  test('refuses two trials for the same task and repetition in one cell', () => {
    expect(() => analyse(results([...both('a', 1), { cell: 'oc-hook', task: 'a', rep: 1, proxy: 0 }]), cells)).toThrow('oc-hook: two trials for a/r1');
  });

  test('refuses a scored trial with no partner trial', () => {
    expect(() => analyse(results([...both('a', 1), { cell: 'oc-tool', task: 'b', rep: 1 }]), cells)).toThrow('scored trials with no partner trial b/r1');
  });

  test('refuses a proxy-log request count that differs from usage.json', () => {
    expect(() => analyse(results([...both('a', 1), { cell: 'oc-tool', task: 'b', rep: 1 }, { cell: 'oc-hook', task: 'b', rep: 1, requests: 2, proxy: 1 }]), cells)).toThrow('1 forwarded requests in the proxy logs, 2 in usage.json');
  });

  test('refuses a scored trial with no usage.json', () => {
    expect(() => analyse(results([...both('a', 1), { cell: 'oc-tool', task: 'b', rep: 1, usage: false }, { cell: 'oc-hook', task: 'b', rep: 1 }]), cells)).toThrow('a scored trial has no usage.json');
  });

  test('refuses a cell with no trials', () => {
    expect(() => analyse(results([{ cell: 'oc-tool', task: 'a', rep: 1 }]), cells)).toThrow('oc-hook: no trials in trials.jsonl');
  });

  test('refuses an empty turns.jsonl on a hook trial with requests', () => {
    const dir = results(both('a', 1));
    writeFileSync(join(dir, 'trials', 'oc-hook', 'a', 'r1', 'turns.jsonl'), '');
    expect(() => analyse(dir, cells)).toThrow('turns.jsonl is empty');
  });

  test('refuses an adapter.log that names no session for a turn', () => {
    const dir = results(both('a', 1));
    writeFileSync(join(dir, 'trials', 'oc-hook', 'a', 'r1', 'logs', 'adapter.log'), '');
    expect(() => analyse(dir, cells)).toThrow('adapter.log names no session for every turn');
  });
});
