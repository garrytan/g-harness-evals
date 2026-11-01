// internal-task, run v03-opus-dev-2026-10: the report's endpoint 3 to 5 and "Why null?" figures rebuild from the committed
// receipts. Each analysis script runs on the committed results and writes into a scratch directory; its output must
// equal the committed copy byte for byte.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ANALYSIS = join(import.meta.dir, '..', 'docs', 'benchmarks', '2026-10-31-v03-opus-dev', 'results', 'analysis');

describe('v03-opus-dev-2026-10 analysis', () => {
  for (const [script, outputs] of [['endpoints.ts', ['endpoints.json', 'endpoints.md']], ['why-null.ts', ['why-null.json', 'why-null.md']]] as const) {
    test(`${script} reproduces ${outputs.join(' and ')}`, () => {
      const out = mkdtempSync(join(tmpdir(), 'v03-opus-dev-'));
      try {
        const run = Bun.spawnSync([process.execPath, join(ANALYSIS, script), out], { env: { PATH: process.env.PATH ?? '', HOME: out }, stdout: 'ignore', stderr: 'pipe' });
        expect(run.stderr.toString()).toBe('');
        expect(run.exitCode).toBe(0);
        for (const f of outputs) expect(readFileSync(join(out, f), 'utf8')).toBe(readFileSync(join(ANALYSIS, f), 'utf8'));
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
