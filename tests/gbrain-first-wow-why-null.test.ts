import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN = 'docs/benchmarks/2026-11-24-gbrain-first-wow/results';

test('scripts/gbrain-first-wow/why-null.py rebuilds the committed Why-null breakdown from the merged trial list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'why-null-'));
  try {
    const out = join(dir, 'why-null.json');
    const r = Bun.spawnSync(['python3', 'scripts/gbrain-first-wow/why-null.py', join(RUN, 'merged/trials.jsonl'), '--out', out], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(join(RUN, 'analysis/why-null.json'), 'utf8'));
    const w = JSON.parse(readFileSync(out, 'utf8'));
    expect(w['cc-opus-full'].suggestion_seen).toBe(1);
    expect(w._suggestion_hit_pairs['claude-code']['cites a suggested page']).toEqual({ pairs: 29, full_finished: 27, pr1_finished_same_seeds: 24 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('why-null.py refuses to run without --out', () => {
  const r = Bun.spawnSync(['python3', 'scripts/gbrain-first-wow/why-null.py', join(RUN, 'merged/trials.jsonl')], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).not.toBe(0);
  expect(r.stderr.toString()).toContain('usage: why-null.py');
});
