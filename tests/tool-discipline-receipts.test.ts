// internal-task: the committed tool-discipline receipts agree with the numbers docs/tool-discipline publishes. The Opus table in
// README.md is recomputed from the internal-task excerpts under receipts/gsta-135/, labels.jsonl holds both blind labellers for
// every sampled item, and each reply record matches the probe target that wrote it. Keyless; reads committed files only.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyAll } from '../scripts/tool-discipline/classify.ts';
import { normalizeGsta, type RunCount } from '../scripts/tool-discipline/normalize.ts';
import { computeRates } from '../scripts/tool-discipline/rates.ts';
import { TARGETS } from '../scripts/tool-discipline/reply-probe.ts';

const DOCS = join(import.meta.dir, '..', 'docs', 'tool-discipline');
const KIND: Record<string, string> = { 'invented tool': 'phantom_tool', 'broken helper call': 'mangled_helper', 'skipped start': 'skipped_start' };

describe('README Opus table', () => {
  const readme = readFileSync(join(DOCS, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## Rates for frontier models'), readme.indexOf('## Examples'));
  const published = [...section.matchAll(/^\| (OpenClaw|Hermes) \| ([a-z ]+) \| (\d+) \/ (\d+)(?: \(\+(\d+) unknown\))? \|/gm)]
    .map(m => ({ harness: m[1]!.toLowerCase(), kind: KIND[m[2]!], k: Number(m[3]), n: Number(m[4]), unknown: Number(m[5] ?? 0) }));
  const counts: RunCount[] = [];
  const { labels, trials } = classifyAll(normalizeGsta(join(DOCS, 'receipts', 'gsta-135'), counts));
  const { rows } = computeRates(labels, trials);

  test('reads all three runs and 132 trials', () => {
    expect(counts.map(c => [c.run, c.included, c.trials])).toEqual([['gsta135-discovery', true, 12], ['gsta135-panel-run', true, 60], ['gsta135-panel-run-3610', true, 60]]);
    expect(section).toContain('(132 Opus trials)');
  });

  test('every published count is what the receipts give', () => {
    expect(published.length).toBe(6);
    for (const p of published) {
      const r = rows.find(x => x.harness === p.harness && x.kind === p.kind && x.model === 'claude-opus-5-5');
      expect([p.harness, p.kind, r?.k, r?.n, r?.unknown]).toEqual([p.harness, p.kind, p.k, p.n, p.unknown]);
    }
  });
});

describe('labels.jsonl', () => {
  const lines = readFileSync(join(DOCS, 'labels.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

  test('two labellers, each labelling every item once', () => {
    const byItem = new Map<string, string[]>();
    for (const l of lines) byItem.set(l.item_id, [...(byItem.get(l.item_id) ?? []), l.labeller]);
    const agreement = readFileSync(join(DOCS, 'agreement.md'), 'utf8');
    const n = Number(agreement.match(/labelled the same (\d+) items/)?.[1]);
    expect(byItem.size).toBe(n);
    for (const [, who] of byItem) expect(who.sort()).toEqual(['anthropic/claude-opus-5-5', 'openai/gpt-6.1-sol']);
  });
});

describe('reply records', () => {
  const dir = join(DOCS, 'replies');
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();

  test('one record per probe target, each holding that target\'s scripted turns in order', () => {
    expect(files).toEqual(Object.keys(TARGETS).map(t => t + '.json').sort());
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const target = TARGETS[rec.target]!();
      expect([f, rec.schema, rec.harness]).toEqual([rec.target + '.json', 'tool-discipline-replies/1', target.harness]);
      expect(rec.turns.map((t: { label: string }) => t.label)).toEqual(target.steps.map(s => s.label));
    }
  });
});
