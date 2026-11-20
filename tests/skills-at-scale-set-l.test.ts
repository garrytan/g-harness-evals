// Keyless test of scripts/skills-at-scale/gen-set-l.ts with a fake writer: three requests per target in the three
// preregistered overlap strata, rewrites with feedback, drops, the 120 no-skill requests, halves that share no target,
// pending prompts from an empty cache, and the sealed half refused inside the checkout and committed by digest (internal-task).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ATTEMPTS, cacheDirProblem, cacheWriter, generate, sealedDirProblem, stratumOf, writeSet, type WriteRequest, type Writer } from '../scripts/skills-at-scale/gen-set-l.ts';
import { treeFiles } from '../scripts/seal-heldout.ts';

const N = 8;
const names = Array.from({ length: N }, (_, i) => 'sk-' + String(i).padStart(3, '0'));
function catalog() {
  const dir = mkdtempSync(join(tmpdir(), 'setl-cat-'));
  const skills = names.map((n, i) => ({ name: n, original_name: n, pack: i % 2 ? 'hermes' : 'gstack', description: 'Analyze quarterly revenue spreadsheets report', renamed: false, source_path: n }));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ catalog_hash: 'h', skills }));
  for (const [i, n] of names.entries()) { mkdirSync(join(dir, 'skills', n), { recursive: true }); writeFileSync(join(dir, 'skills', n, 'SKILL.md'), '---\nname: ' + n + '\n---\nBody for target number ' + i + '. Steps follow.\n'); }
  return dir;
}
const STYLE_TEXT: Record<string, string> = {
  low: 'Can you help me sort out the budget file Jordan sent over yesterday',
  mid: 'Can you help me sort out the revenue file Jordan sent over yesterday',
  high: 'Please analyze the quarterly revenue report Jordan sent over yesterday from Lisbon',
};
const fake = (calls: WriteRequest[]): Writer => async (r) => {
  calls.push(r);
  const nonSkill = /Variant (\d) of 4/.exec(r.prompt);
  if (nonSkill) return 'Quick question number ' + r.key.slice(0, 8) + ' about ' + r.prompt.split(': ')[1]!.split('.')[0];
  const i = Number(/target number (\d+)/.exec(r.prompt)![1]);
  const style = r.prompt.includes('everyday words') ? 'low' : r.prompt.includes('common terms') ? 'mid' : 'high';
  const attempt = (r.prompt.match(/previous attempt/g) ?? []).length;
  if (i === 0 && style === 'low' && !attempt) return 'Run sk-000 on my files please';
  if (i === 1 && style === 'high') return 'Analyze quarterly revenue spreadsheets report now';
  if (i === 2 && style === 'mid') return STYLE_TEXT.low + ' for case ' + i + ' variant two';
  return STYLE_TEXT[style] + ' for case ' + i;
};

describe('set L generation', () => {
  test('strata are preregistered cut points', () => {
    expect([0, 0.05, 0.06, 0.15, 0.2, 0.35, 0.36].map(stratumOf)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high', null]);
  });

  test('a fake writer: three per target in their strata, rewrites, drops, 120 no-skill requests, halves by target', async () => {
    const calls: WriteRequest[] = [];
    const g = await generate({ catalog: catalog(), targets: names, writer: fake(calls) });
    expect(g.pending).toBe(0);
    const skill = g.rows.filter((r) => r.kind === 'skill') as any[];
    expect(g.rows.filter((r) => r.kind === 'none').length).toBe(120);
    expect(skill.length).toBe(N * 3 - 1);
    expect(g.plan.drops).toEqual([{ id: 'l-s-002-3', target: 'sk-001', style: 'high', reason: expect.stringContaining('too many of the file') }]);
    const first = skill.find((r) => r.id === 'l-s-001-1');
    expect(first.attempts).toBe(2);
    expect(first.stratum).toBe('low');
    const miss = skill.find((r) => r.id === 'l-s-003-2');
    expect(miss).toMatchObject({ style: 'mid', stratum: 'low', style_miss: true, attempts: MAX_ATTEMPTS });
    expect(skill.filter((r) => !r.style_miss).every((r) => r.stratum === r.style)).toBe(true);
    expect(g.plan.spread).toEqual({ low: N + 1, mid: N - 1, high: N - 1 });
    expect(g.plan.spread_met).toBe(true);
    for (const t of names) expect(new Set(skill.filter((r) => r.target === t).map((r) => r.half)).size).toBe(1);
    expect(Object.values(g.plan.target_halves).filter((x) => x === 'dev').length).toBe(N / 2);
    expect(calls.every((c) => c.model === 'google:gemini-4-carbon' && !c.prompt.includes('sk-00'))).toBe(true);
    expect(calls.find((c) => c.prompt.includes('target number 0') && c.prompt.includes('previous attempt'))!.prompt).toContain('names the job too directly');
    expect(calls.filter((c) => c.prompt.includes('target number 4')).at(-1)!.prompt).toContain('Describe a different situation');
    const again = await generate({ catalog: catalog(), targets: names, writer: fake([]) });
    expect(again.rows).toEqual(g.rows);
  });

  test('an empty cache leaves every first prompt pending; answers in the cache move it on', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'setl-cache-'));
    const pending: WriteRequest[] = [];
    const g = await generate({ catalog: catalog(), targets: names, writer: cacheWriter(cache, pending) });
    expect(g.pending).toBe(N + 120);
    expect(pending.length).toBe(N + 120);
    const answer = fake([]);
    for (const p of pending) writeFileSync(join(cache, p.key + '.json'), JSON.stringify({ text: await answer(p) }));
    const round2: WriteRequest[] = [];
    const g2 = await generate({ catalog: catalog(), targets: names, writer: cacheWriter(cache, round2) });
    expect(g2.pending).toBe(N);
    expect(round2.some((p) => p.prompt.includes('previous attempt'))).toBe(true);
  });

  test('the sealed half: refused inside the checkout, committed by digest outside it', async () => {
    const g = await generate({ catalog: catalog(), targets: names, writer: fake([]) });
    const out = mkdtempSync(join(tmpdir(), 'setl-out-'));
    expect(() => writeSet({ rows: g.rows, plan: g.plan, out, sealedDir: join(import.meta.dir, 'tmp-sealed-never') })).toThrow('inside the checkout');
    const repo = mkdtempSync(join(tmpdir(), 'setl-git-'));
    spawnSync('git', ['init', '-q', repo]);
    expect(sealedDirProblem(join(repo, 'sealed'))).toContain('inside a git work tree');
    expect(cacheDirProblem(join(import.meta.dir, 'tmp-cache-never'))).toContain('inside the checkout');
    expect(cacheDirProblem(join(repo, 'cache'))).toContain('inside a git work tree');
    expect(cacheDirProblem(mkdtempSync(join(tmpdir(), 'setl-cache-')))).toBeNull();
    const sealedDir = mkdtempSync(join(tmpdir(), 'setl-sealed-'));
    const s = writeSet({ rows: g.rows, plan: g.plan, out, sealedDir });
    const dev = readFileSync(join(out, 'setl-dev.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const sealed = readFileSync(join(sealedDir, 'setl-test.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(dev.length + sealed.length).toBe(g.rows.length);
    expect(dev.every((r) => r.half === 'dev') && sealed.every((r) => r.half === 'test')).toBe(true);
    expect(s.tree_sha256).toBe(treeFiles(sealedDir).tree_sha256);
    expect(s.ids).toEqual(sealed.map((r) => r.id));
    expect(readFileSync(join(out, 'setl-sealed.json'), 'utf8')).not.toContain('Jordan');
    writeFileSync(join(sealedDir, 'stray.txt'), 'x');
    expect(sealedDirProblem(sealedDir)).toContain('other files');
  });
});
