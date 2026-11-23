// Keyless test of the set L label tooling (internal-task): label-l.ts through label-set.ts with a fake transport (two judges,
// the full catalog as the cached prefix of pass 1, target acceptance and no-skill drift), the arm-blind adjudication queue,
// adjudication by both graders, the gold file check that gates analyze.ts (R78), and labelling through the batch lane.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompleteRequest } from '../scripts/v03/llm.ts';
import { adjudicate, buildQueue, goldCheck, goldProblems, type Gold } from '../scripts/skills-at-scale/adjudicate.ts';
import { labelL } from '../scripts/skills-at-scale/label-l.ts';
import { batchRound, type BatchApi, type BatchItem, type BatchStatus } from '../scripts/skills-at-scale/batch.ts';

const SKILLS = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f'];
function catalog() {
  const dir = mkdtempSync(join(tmpdir(), 'scale-label-cat-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ catalog_hash: 'h', skills: SKILLS.map((name) => ({ name, description: 'does ' + name })) }));
  for (const s of SKILLS) { mkdirSync(join(dir, 'skills', s), { recursive: true }); writeFileSync(join(dir, 'skills', s, 'SKILL.md'), '# ' + s + '\nbody of ' + s); }
  return dir;
}
const rowsFile = (rows: unknown[]) => { const f = join(mkdtempSync(join(tmpdir(), 'scale-label-set-')), 'set.jsonl'); writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); return f; };
const SET = [
  { id: 'l-s-001-1', kind: 'skill', target: 'sk-a', request: 'Please fix the invoice totals', half: 'dev' },
  { id: 'l-s-002-1', kind: 'skill', target: 'sk-e', request: 'Plan my garden beds', half: 'dev' },
  { id: 'l-n-001', kind: 'none', target: null, request: 'What is 2 plus 2', half: 'dev' },
  { id: 'l-n-002', kind: 'none', target: null, request: 'Weather tomorrow in Oslo', half: 'test' },
];
const ANSWERS: Record<string, Record<string, string[]>> = {
  'Please fix the invoice totals': { 'openai:gpt-6.2-astra': ['sk-a'], 'anthropic:claude-opus-5-5': ['sk-a', 'sk-b'] },
  'Plan my garden beds': { 'openai:gpt-6.2-astra': ['sk-c'], 'anthropic:claude-opus-5-5': ['sk-c'] },
  'What is 2 plus 2': { 'openai:gpt-6.2-astra': [], 'anthropic:claude-opus-5-5': [] },
  'Weather tomorrow in Oslo': { 'openai:gpt-6.2-astra': ['sk-d'], 'anthropic:claude-opus-5-5': [] },
};
function fakeJudges(calls: CompleteRequest[]) {
  return async (r: CompleteRequest) => {
    calls.push(r);
    const req = /Request:\n(.*)\n/.exec(r.prompt)![1]!;
    const acc = ANSWERS[req]![r.model]!;
    if (r.prompt.includes('Two labellers disagreed')) return JSON.stringify({ no_skill_needed: false, acceptable: ['sk-a'], reason: 'r' });
    if (r.prompt.includes('"candidates": [up to 8')) return JSON.stringify({ no_skill_needed: !acc.length, candidates: acc.length ? [...acc, 'sk-f'] : [] });
    return JSON.stringify({ no_skill_needed: !acc.length, acceptable: acc, reason: 'r' });
  };
}

describe('set L labels', () => {
  test('two judges over the full catalog: each judge kept, target acceptance, no-skill drift, the reconciled final', async () => {
    const calls: CompleteRequest[] = [];
    const out = mkdtempSync(join(tmpdir(), 'scale-label-out-'));
    const s = await labelL({ catalog: catalog(), sets: [rowsFile(SET)], out, leaseUsd: 1, runId: 't', transport: fakeJudges(calls) });
    const rows = readFileSync(join(out, 'labels-l.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((r) => r.id)).toEqual(['l-n-001', 'l-n-002', 'l-s-001-1', 'l-s-002-1']);
    const inv = rows.find((r) => r.id === 'l-s-001-1');
    expect(inv.judges.astra.acceptable).toEqual(['sk-a']);
    expect(inv.judges.opus.acceptable).toEqual(['sk-a', 'sk-b']);
    expect(inv.final.acceptable).toEqual(['sk-a']);
    expect(inv.target_accepted).toEqual({ astra: true, opus: true });
    expect(rows.find((r) => r.id === 'l-s-002-1').target_accepted).toEqual({ astra: false, opus: false });
    expect(rows.find((r) => r.id === 'l-n-002').no_skill_drift).toEqual({ astra: ['sk-d'], opus: [] });
    expect(rows.find((r) => r.id === 'l-n-001').no_skill_drift).toBeNull();
    expect(s.target_not_accepted).toEqual({ astra: 1, opus: 1 });
    expect(s.no_skill_drift).toEqual([{ id: 'l-n-002', astra: ['sk-d'], opus: [] }]);
    const pass1 = calls.filter((c) => c.prompt.includes('"candidates": [up to 8'));
    expect(pass1.length).toBe(8);
    expect(pass1.every((c) => SKILLS.every((n) => c.cachePrefix!.includes('- ' + n + ': does ' + n)))).toBe(true);
    expect(new Set(calls.map((c) => c.model))).toEqual(new Set(['openai:gpt-6.2-astra', 'anthropic:claude-opus-5-5']));
  });

  test('sealed rows are never labelled into the checkout', async () => {
    await expect(labelL({ catalog: catalog(), sets: [rowsFile(SET)], out: join(import.meta.dir, 'never-written'), leaseUsd: 1, runId: 't', transport: fakeJudges([]) })).rejects.toThrow('HE-SCALE-LABEL-001');
  });
});

describe('adjudication', () => {
  const labels = [
    { id: 'r1', judges: { astra: { no_skill_needed: false, acceptable: ['sk-a'] }, opus: { no_skill_needed: false, acceptable: ['sk-a', 'sk-b'] } } },
    { id: 'n1', judges: { astra: { no_skill_needed: true, acceptable: [] }, opus: { no_skill_needed: true, acceptable: [] } } },
  ];
  function results() {
    const dir = mkdtempSync(join(tmpdir(), 'scale-adj-'));
    const cells = [
      { id: 'cc-native-1500', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', skill_arm: 'native', rung: 1500 },
      { id: 'cc-resolver-700', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', skill_arm: 'resolver', rung: 700 },
      { id: 'cx-native-1500', harness: 'codex', model: 'openai:gpt-6.1-sol', skill_arm: 'native', rung: 1500 },
    ];
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: 'run', cells }));
    const rows: string[] = [];
    const add = (cell: typeof cells[number], task: string, opened: string[]) => {
      const d = join(dir, 'trials', cell.id, task, 'r1');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'got-skill.json'), JSON.stringify({ catalog_opened: opened }));
      rows.push(JSON.stringify({ trial_id: 'run/' + cell.id + '/' + task + '/r1', cell: cell.id, task, harness: cell.harness, model: cell.model, termination: 'completed' }));
    };
    add(cells[0]!, 'r1', ['sk-b']); add(cells[1]!, 'r1', ['sk-b', 'sk-a']); add(cells[2]!, 'r1', ['sk-b']); add(cells[1]!, 'n1', ['sk-c']);
    writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
    return dir;
  }

  test('the queue is arm-blind and deduplicated; the key keeps who opened what', () => {
    const { queue, key } = buildQueue(results(), labels);
    expect(queue.map((q) => q.request_id + '|' + q.skill).sort()).toEqual(['n1|sk-c', 'r1|sk-b']);
    expect(queue.every((q) => Object.keys(q).sort().join() === 'item,request_id,skill')).toBe(true);
    const k = key.find((x) => x.item === queue.find((q) => q.skill === 'sk-b')!.item)!;
    expect(k.occurrences.map((o) => o.arm + '@' + o.rung).sort()).toEqual(['native@1500', 'resolver@700']);
    expect(buildQueue(results(), labels).queue).toEqual(queue);
  });

  test('both graders must accept; a split is not acceptable; a failed grade stays pending', async () => {
    const queue = [{ item: 'q-1', request_id: 'r1', skill: 'sk-b' }, { item: 'q-2', request_id: 'n1', skill: 'sk-c' }, { item: 'q-3', request_id: 'r9', skill: 'sk-c' }];
    const transport = async (r: CompleteRequest) => JSON.stringify({ correct: r.prompt.includes('Skill: sk-b') || (r.prompt.includes('Skill: sk-c') && r.model === 'openai:gpt-6.2-astra'), reason: 'r' });
    const out = mkdtempSync(join(tmpdir(), 'scale-adj-run-'));
    const s = await adjudicate({ queue, requests: new Map([['r1', 'fix invoices'], ['n1', 'hello']]), catalog: catalog(), out, leaseUsd: 1, runId: 't', transport });
    expect(s).toMatchObject({ queue: 3, adjudicated: 2, pending: 1, acceptable: 1, split: 1 });
    const rows = readFileSync(join(out, 'adjudications.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((r) => [r.request_id, r.skill, r.acceptable, r.split])).toEqual([['r1', 'sk-b', true, false], ['n1', 'sk-c', false, true]]);
  });

  test('gold: 100 rows, half near-duplicate at 1,500; kappa per judge gates the check', () => {
    const gold: Gold[] = Array.from({ length: 100 }, (_, i) => ({ id: 'g' + i, skill: 'sk-a', good: i % 3 !== 0, near_duplicate: i < 50, rung: 1500, adjudicated_by: 'panel', reason: 'r' }));
    const lab = gold.map((g, i) => ({ id: g.id, judges: { astra: { no_skill_needed: false, acceptable: g.good ? ['sk-a'] : [] }, opus: { no_skill_needed: false, acceptable: i % 2 ? ['sk-a'] : [] } } }));
    const r = goldCheck(gold, lab);
    expect(r.problems).toEqual([]);
    expect(r.sources['openai:gpt-6.2-astra']!.kappa).toBe(1);
    expect(r.sources['anthropic:claude-opus-5-5']!.kappa!).toBeLessThan(0.6);
    expect(r.passed).toBe(false);
    expect(goldCheck(gold, lab.map((l) => ({ ...l, judges: { ...l.judges, opus: l.judges.astra } }))).passed).toBe(true);
    expect(goldProblems(gold.slice(0, 99)).join()).toContain('at least 100');
    expect(goldProblems(gold.map((g, i) => ({ ...g, near_duplicate: i < 20 }))).join()).toContain('near-duplicate');
    expect(goldProblems([...gold, gold[0]!]).join()).toContain('appears twice');
    expect(goldCheck(gold.slice(0, 10), lab).n_gold).toBe(0);
    const two = goldCheck(gold, lab.slice(0, 2).map((l) => ({ ...l, judges: { ...l.judges, opus: l.judges.astra } })));
    expect([two.n_gold, two.passed]).toEqual([2, false]);
  });
});

describe('batch lane (batch.ts)', () => {
  function fakeApi(provider: 'anthropic' | 'openai', calls: CompleteRequest[]) {
    const batches = new Map<string, { items: BatchItem[]; ended: boolean; metadata: Record<string, string> }>();
    const answer = fakeJudges(calls);
    const text = (b: Record<string, any>) => { const m = b.messages.at(-1).content; return typeof m === 'string' ? m : m.map((p: any) => p.text).join(''); };
    const status = (id: string): BatchStatus => ({ id, ended: batches.get(id)!.ended, status: batches.get(id)!.ended ? 'ended' : 'in_progress', created_at_ms: 0, total: batches.get(id)!.items.length, metadata: batches.get(id)!.metadata, raw: {} });
    const api: BatchApi = {
      async create(items, metadata) { const id = provider + '-b' + batches.size; batches.set(id, { items, ended: false, metadata }); return status(id); },
      async get(id) { return status(id); },
      async list() { return [...batches.keys()].map(status); },
      async results(b) {
        return Promise.all(batches.get(b.id)!.items.map(async (i) => ({ custom_id: i.custom_id, ok: true, error: null,
          text: await answer({ model: (provider + ':' + i.body.model) as CompleteRequest['model'], system: '', prompt: text(i.body), maxTokens: 0 }),
          usage: provider === 'anthropic' ? { input_tokens: 1000, output_tokens: 100 } : { prompt_tokens: 1000, completion_tokens: 100 } })));
      },
    };
    return { api, batches, end: () => { for (const b of batches.values()) b.ended = true; } };
  }
  const fakeLease = () => { const log: Array<[string, number]> = []; let n = 0; return { log, lease: { reserve: (usd: number) => { log.push(['reserve', usd]); return 'r' + n++; }, settle: (_id: string, c: { usd: number } | null) => { log.push(['settle', c?.usd ?? -1]); } } }; };

  test('rounds submit only what the cache lacks, cache the answers and reach the same labels as the direct path', async () => {
    const cat = catalog(), set = rowsFile(SET);
    const direct = mkdtempSync(join(tmpdir(), 'scale-label-direct-'));
    await labelL({ catalog: cat, sets: [set], out: direct, leaseUsd: 1, runId: 't', transport: fakeJudges([]) });
    const out = mkdtempSync(join(tmpdir(), 'scale-label-batch-'));
    const dir = mkdtempSync(join(tmpdir(), 'scale-batch-'));
    const calls: CompleteRequest[] = [];
    const a = fakeApi('anthropic', calls), o = fakeApi('openai', calls);
    const { log, lease } = fakeLease();
    const rounds = [];
    for (let k = 0; k < 6; k++) {
      const r = await batchRound({ dir, cacheDir: join(out, 'label-set', 'cache'), lease: () => lease, apis: { anthropic: a.api, openai: o.api }, work: (t) => labelL({ catalog: cat, sets: [set], out, leaseUsd: 1, runId: 't', transport: t }) });
      rounds.push(r);
      if (r.done) break;
      a.end(); o.end();
    }
    expect(rounds.length).toBe(4);
    expect(rounds.map((r) => r.submitted.length)).toEqual([2, 2, 1, 0]);
    expect(readFileSync(join(out, 'labels-l.jsonl'), 'utf8')).toBe(readFileSync(join(direct, 'labels-l.jsonl'), 'utf8'));
    const first = [...a.batches.values()][0]!.items;
    expect(first.every((i) => /^[0-9a-f]{64}$/.test(i.custom_id))).toBe(true);
    expect((first[0]!.body.messages as any)[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(typeof [...o.batches.values()][0]!.items[0]!.body.prompt_cache_key).toBe('string');
    expect([...o.batches.values()][0]!.metadata.intent_id).toMatch(/^i/);
    const reserved = log.filter((x) => x[0] === 'reserve').reduce((s, x) => s + x[1], 0);
    const settled = log.filter((x) => x[0] === 'settle').reduce((s, x) => s + x[1], 0);
    expect(log.filter((x) => x[0] === 'settle').length).toBe(5);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(reserved);
    expect(rounds.at(-1)!.settled_usd).toBeCloseTo(settled, 4);
  });
});
