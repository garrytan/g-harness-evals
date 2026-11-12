// Keyless test of scripts/skill-resolver/judge-check.ts: the dev-only seeded sample, kappa, per-source scoring and the
// whole check through an injected transport (internal-task, R78).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeCheck, kappa, samplePairs, scoreSources, topSuggestions } from '../scripts/skill-resolver/judge-check.ts';

const core = (acc: string[], cand: string[] = acc) => ({ no_skill_needed: !acc.length, acceptable: acc, candidates: cand });

describe('judge check', () => {
  test('kappa: perfect, chance and undefined', () => {
    expect(kappa([true, false, true, false], [true, false, true, false])).toBe(1);
    expect(kappa([true, true, false, false], [true, false, true, false])).toBe(0);
    expect(kappa([], [])).toBeNull();
  });

  test('sample: given pairs first, dev rows only, seeded and even over the three pools', () => {
    const m = new Map([['d1', core(['a'], ['a', 'b'])], ['d2', core([], ['c'])], ['t1', core(['a'])]]);
    const s = samplePairs({ dev: new Set(['d1', 'd2']), sources: { x: m }, given: [{ id: 'd1', skill: 'z' }, { id: 't1', skill: 'a' }], suggested: [{ id: 'd2', skill: 'c' }], n: 10, seed: 1 });
    expect(s[0]).toEqual({ id: 'd1', skill: 'z', pool: 'opened' });
    expect(s.some((p) => p.id === 't1')).toBe(false);
    expect(s.map((p) => p.pool).sort()).toEqual(['accepted', 'no-skill row', 'opened', 'rejected candidate']);
    expect(samplePairs({ dev: new Set(['d1', 'd2']), sources: { x: m }, given: [], n: 10, seed: 1 })).toEqual(samplePairs({ dev: new Set(['d1', 'd2']), sources: { x: m }, given: [], n: 10, seed: 1 }));
  });

  test('no-skill pool: the resolver\'s top suggestion on rows every source calls no_skill_needed, pushed or shadow, deduplicated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-judge-sugg-'));
    const trial = (cell: string, task: string, lines: unknown[]) => {
      const d = join(dir, 'trials', cell, task, 'r1', 'logs', 'skill-resolver');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'status.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      return JSON.stringify({ trial_id: 'run/' + cell + '/' + task + '/r1', skill_request: { request_id: task } });
    };
    writeFileSync(join(dir, 'trials.jsonl'), [
      trial('native', 'n1', [{ mode: 'shadow', suggestions: ['x', 'y'] }]), trial('resolver-on', 'n1', [{ mode: 'push', suggestions: ['x'] }]),
      trial('resolver-on', 'n2', [{ mode: 'push', suggestions: ['w'] }, { mode: 'push', suggestions: [] }]), trial('native', 's1', [{ mode: 'shadow', suggestions: ['a'] }]),
      JSON.stringify({ trial_id: 'run/other/t/r1' }),
    ].join('\n') + '\n');
    const suggested = topSuggestions(dir);
    expect(suggested).toEqual([{ id: 'n1', skill: 'x' }, { id: 'n2', skill: 'w' }, { id: 's1', skill: 'a' }]);
    const sources = { x: new Map([['n1', core([])], ['n2', core([])], ['s1', core(['a'])], ['n3', core([])]]), y: new Map([['n1', core([])], ['n2', core(['w'])]]) };
    const dev = new Set(['n1', 'n2', 's1', 'n3']);
    const pool = samplePairs({ dev, sources, given: [{ id: 'n1', skill: 'x' }], suggested, n: 1, seed: 20261108, pool: 'no-skill row' });
    expect(pool).toEqual([{ id: 'n1', skill: 'x', pool: 'no-skill row' }]);
    expect(samplePairs({ dev, sources, given: [], suggested: [], n: 10, seed: 20261108, pool: 'no-skill row' })).toEqual([]);
    expect(() => samplePairs({ dev, sources, given: [], n: 10, seed: 1, pool: 'nope' })).toThrow('unknown pool');
  });

  test('scoring: catch rate on gold-bad, false-fail rate on gold-good', () => {
    const gold = [{ id: 'r', skill: 'a', pool: 'accepted', good: true }, { id: 'r', skill: 'b', pool: 'rejected candidate', good: false }, { id: 's', skill: 'c', pool: 'accepted', good: true }];
    const src = { strict: new Map([['r', core(['a'])], ['s', core([])]]) };
    expect(scoreSources(gold, src, {}).strict).toMatchObject({ catch_rate: 1, false_fail_rate: 0.5, n_bad: 1, n_good: 2 });
  });

  test('end to end through a fake transport: gold needs both graders, refuses test-half rows; a pool-only pass with prior grades and a shared cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-judge-'));
    for (const s of ['a', 'b', 'c']) { mkdirSync(join(dir, 'cat', 'skills', s), { recursive: true }); writeFileSync(join(dir, 'cat', 'skills', s, 'SKILL.md'), 'skill ' + s); }
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: 'p-' + i, request: 'request ' + i, half: 'dev' }));
    writeFileSync(join(dir, 'set.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify({ id: r.id, judges: { opus: core(['a'], ['a', 'b']), sol: core(['a', 'b']) }, final: core(['a']) })).join('\n') + '\n');
    writeFileSync(join(dir, 'astra.jsonl'), rows.map((r) => JSON.stringify({ id: r.id, judges: { astra: core(['a'], ['a', 'b']) } })).join('\n') + '\n');
    const transport = async (req: { model: string; prompt: string }) => {
      const skillA = req.prompt.includes('Skill: a\n');
      const disagree = req.prompt.includes('request 7\n') && req.model.startsWith('anthropic');
      return JSON.stringify({ correct: disagree ? !skillA : skillA, reason: 'x' });
    };
    const r = await judgeCheck({ catalog: join(dir, 'cat'), set: join(dir, 'set.jsonl'), labels: join(dir, 'labels.jsonl'), astra: join(dir, 'astra.jsonl'), n: 60, seed: 3, out: join(dir, 'out'), leaseUsd: 1, runId: 't', transport: transport as never });
    expect(r.n_pairs).toBe(60);
    expect(r.n_gold).toBeLessThan(r.n_both_graded);
    expect(r.sources['openai:gpt-6-astra']!.kappa).toBe(1);
    expect(r.sources['openai:gpt-6.1-sol']!.catch_rate).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'out', 'judge-check.json'), 'utf8')).enough_gold).toBe(true);
    const calls = { n: 0 };
    const counted = async (req: { model: string; prompt: string }) => { calls.n++; return transport(req); };
    const results = join(dir, 'results');
    mkdirSync(join(results, 'trials', 'c', 'p-0', 'r1', 'logs', 'skill-resolver'), { recursive: true });
    writeFileSync(join(results, 'trials.jsonl'), JSON.stringify({ trial_id: 'run/c/p-0/r1', skill_request: { request_id: 'p-0' } }) + '\n');
    writeFileSync(join(results, 'trials', 'c', 'p-0', 'r1', 'logs', 'skill-resolver', 'status.ndjson'), JSON.stringify({ mode: 'shadow', suggestions: ['c'] }) + '\n');
    const none = core([]);
    writeFileSync(join(dir, 'labels.jsonl'), rows.map((r) => JSON.stringify(r.id === 'p-0' ? { id: r.id, judges: { opus: none, sol: none }, final: none } : { id: r.id, judges: { opus: core(['a'], ['a', 'b']), sol: core(['a', 'b']) }, final: core(['a']) })).join('\n') + '\n');
    writeFileSync(join(dir, 'astra.jsonl'), rows.map((r) => JSON.stringify({ id: r.id, judges: { astra: r.id === 'p-0' ? none : core(['a'], ['a', 'b']) } })).join('\n') + '\n');
    const second = await judgeCheck({ catalog: join(dir, 'cat'), set: join(dir, 'set.jsonl'), labels: join(dir, 'labels.jsonl'), astra: join(dir, 'astra.jsonl'), results, pool: 'no-skill row', prior: join(dir, 'out', 'grades.jsonl'), cache: join(dir, 'out', 'cache'), n: 60, seed: 3, out: join(dir, 'out-noskill'), leaseUsd: 1, runId: 't', transport: counted as never });
    expect({ n: second.n_pairs, pools: second.pools, prior: second.prior?.n_pairs, here: second.graded_here?.n_gold, calls: calls.n }).toEqual({ n: 1, pools: { opened: 0, accepted: 0, 'rejected candidate': 0, 'no-skill row': 1 }, prior: 60, here: 1, calls: 2 });
    expect(second.n_gold).toBe(r.n_gold + 1);
    expect(second.graded_here!.sources['openai:gpt-6-astra']).toMatchObject({ n_bad: 1, n_good: 0, catch_rate: 1 });
    const again = await judgeCheck({ catalog: join(dir, 'cat'), set: join(dir, 'set.jsonl'), labels: join(dir, 'labels.jsonl'), astra: join(dir, 'astra.jsonl'), results, pool: 'no-skill row', cache: join(dir, 'out', 'cache'), n: 60, seed: 3, out: join(dir, 'out-noskill2'), leaseUsd: 1, runId: 't', transport: counted as never });
    expect({ hits: again.llm.cache_hits, calls: calls.n }).toEqual({ hits: 2, calls: 2 });
    writeFileSync(join(dir, 'set.jsonl'), JSON.stringify({ id: 'x', request: 'y', half: 'test' }) + '\n');
    await expect(judgeCheck({ catalog: join(dir, 'cat'), set: join(dir, 'set.jsonl'), labels: join(dir, 'labels.jsonl'), astra: join(dir, 'astra.jsonl'), n: 5, seed: 3, out: join(dir, 'out2'), leaseUsd: 1, runId: 't', transport: transport as never })).rejects.toThrow('HE-SKILLS-005');
  });
});
