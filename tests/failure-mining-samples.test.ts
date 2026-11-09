import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stratifiedSample } from '../scripts/failure-mining/build-packets.ts';
import { OUT, ROOT } from '../scripts/failure-mining/corpus.ts';

const rows = (n: number, strata: string[]) => Array.from({ length: n }, (_, i) => ({ trial_id: `t${String(i).padStart(3, '0')}`, stratum: strata[i % strata.length]! }));

describe('failure mining: stratified samples', () => {
  test('a draw depends on its seed alone, and strata get equal counts, give or take one, until they run out', () => {
    const pool = rows(90, ['a', 'b', 'c']).concat(rows(2, ['d']).map((r) => ({ ...r, trial_id: `d${r.trial_id}` })));
    const draw = stratifiedSample(pool, 30, 2020);
    expect(stratifiedSample([...pool].reverse(), 30, 2020)).toEqual(draw);
    expect(stratifiedSample(pool, 30, 2021)).not.toEqual(draw);
    expect(new Set(draw).size).toBe(30);
    const per = (ids: string[]) => ['a', 'b', 'c', 'd'].map((s) => ids.filter((id) => pool.find((r) => r.trial_id === id)!.stratum === s).length);
    expect(per(draw)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), 2]);
    const big = per(draw).slice(0, 3);
    expect(Math.max(...big) - Math.min(...big)).toBeLessThanOrEqual(1);
    expect(stratifiedSample(pool, 500, 7)).toHaveLength(92);
  });

  test('corpus/samples.json is the draw the rule gives from corpus/packet-index.jsonl', () => {
    const dir = join(ROOT, OUT, 'corpus');
    const index = readFileSync(join(dir, 'packet-index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const samples = JSON.parse(readFileSync(join(dir, 'samples.json'), 'utf8'));
    const stratum = (r: Record<string, string | null>) => `${r.layer1_primary ?? 'none'} | ${r.harness} | ${r.model}`;
    const pool = index.filter((r) => r.packet_sha256 && samples.pool.populations.includes(r.population));
    expect(pool).toHaveLength(samples.pool.trials);
    const taken = new Set<string>();
    for (const s of samples.samples) {
      const from = pool.filter((r) => !taken.has(r.trial_id));
      const ids = stratifiedSample(from.map((r) => ({ trial_id: r.trial_id, stratum: stratum(r) })), s.size, s.seed);
      for (const id of ids) taken.add(id);
      expect({ pool: from.length, drawn: ids.length, trial_ids: [...ids].sort() }).toEqual({ pool: s.pool, drawn: s.drawn, trial_ids: s.trial_ids });
    }
  });
});
