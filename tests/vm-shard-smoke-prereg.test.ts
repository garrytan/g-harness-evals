// scripts/ubicloud/vm-shard.sh's smoke preregistration: the one-trial smoke plans from a scratch copy of the shard's
// preregistration that keeps only the shard's cells.
//
// Value: protects=the scratch copy also trims order.blocks to the shard's cells and drops blocks left empty, so plan
// accepts it (HE-PREREG-008) for every shard of the skill-resolver run; fails_when=a block still names a cell outside the
// shard, or an emptied block is kept; why_new=the one-VM pre-smoke at 49055a6f stopped every skill-resolver shard's smoke
// on HE-PREREG-008 because only drop_order and minimum_v01 were trimmed; seam=the heredoc vm-shard.sh runs, read from the
// script itself; no_claim=the VM side of the smoke (images, proxy, the trial).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrereg } from '../runner/run.ts';

const ROOT = join(import.meta.dir, '..');
const PREREG = join(ROOT, 'docs', 'benchmarks', '2026-11-08-skill-resolver', 'prereg.json');
const SCRIPT = readFileSync(join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), 'utf8');
const SMOKE_PY = SCRIPT.slice(SCRIPT.indexOf("<<'PY' || finish 2\n") + "<<'PY' || finish 2\n".length).split('\nPY\n')[0];

function smokePrereg(cells: string[]): { code: number | null; err: string; prereg?: { order?: { blocks?: Array<{ name: string; cells: string[] }> } }; path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'he-smoke-prereg-'));
  const py = join(dir, 'smoke.py');
  const out = join(dir, 'prereg.json');
  writeFileSync(py, SMOKE_PY);
  const r = spawnSync('python3', [py, PREREG, cells.join(','), 'shard', '', '6', out, '0'], { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr, prereg: r.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : undefined, path: out, dir };
}

const src = JSON.parse(readFileSync(PREREG, 'utf8')) as { cells: Array<{ id: string }>; order: { blocks: Array<{ name: string; cells: string[] }> } };

describe('vm-shard.sh smoke preregistration (internal-task)', () => {
  test('the heredoc is found', () => {
    expect(SMOKE_PY).toContain("for k in ('drop_order', 'minimum_v01')");
  });

  const shards: Array<[string, string[]]> = [
    ['the oc Opus pair canary', ['pb-oc-opus-native', 'pb-oc-opus-resolver-on']],
    ['a names-only cell on its own', [src.order.blocks[2]!.cells[0]!]],
    ['the set T canary', ['st-oc-opus-native']],
    ['a set T triple', src.order.blocks[3]!.cells.slice(3, 6)],
  ];
  for (const [what, cells] of shards) {
    test(`${what}: blocks keep only the shard's cells and plan accepts the scratch copy`, () => {
      for (const c of cells) expect(src.cells.some((x) => x.id === c)).toBe(true);
      const r = smokePrereg(cells);
      try {
        expect(r.err).toBe('');
        expect(r.code).toBe(0);
        const blocks = r.prereg!.order!.blocks!;
        expect(blocks.flatMap((b) => b.cells).sort()).toEqual([...cells].sort());
        expect(blocks.every((b) => b.cells.length > 0)).toBe(true);
        expect(() => loadPrereg(r.path)).not.toThrow();
      } finally {
        rmSync(r.dir, { recursive: true, force: true });
      }
    });
  }
});
