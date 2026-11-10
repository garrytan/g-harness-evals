// internal-task: rule 2's 2026-11-09 exception lives in a new file, tasks/multiuser/_shared/preamble.v031.md, which a cell on a
// v0.3.1 task set reads when it names no preamble. Every committed preregistration must still resolve each multi-user cell's
// preamble to the bytes it resolved to before (tests/fixtures/prereg-preamble-digests.json, taken from main at 847f77a78a),
// so no frozen or counted run changes under it.

import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPreambleFor } from '../runner/trial/task.ts';

const ROOT = join(import.meta.dir, '..');
const fixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'prereg-preamble-digests.json'), 'utf8')) as { preregs: Record<string, Record<string, string[]>> };
const sha = (path: string) => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');

test('every committed prereg.json resolves each multi-user cell\'s preamble to the digest it had before preamble.v031.md', () => {
  let cells = 0;
  for (const [file, byDigest] of Object.entries(fixture.preregs)) {
    const prereg = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as { cells: Array<{ id: string; slice?: string; preamble?: string; task_set?: string }> };
    for (const [digest, ids] of Object.entries(byDigest)) for (const id of ids) {
      const cell = prereg.cells.find((c) => c.id === id)!;
      expect([file, id, sha(cell.preamble ?? defaultPreambleFor(cell.task_set))]).toEqual([file, id, digest]);
      cells++;
    }
  }
  expect(cells).toBe(973);
});

test('a cell on a v0.3.1 task set with no preamble of its own reads preamble.v031.md; every other default is preamble.md', () => {
  expect(defaultPreambleFor('v0.3.1')).toBe(join('tasks', 'multiuser', '_shared', 'preamble.v031.md'));
  expect(defaultPreambleFor('v0.3.1/dev-draw-2')).toBe(join('tasks', 'multiuser', '_shared', 'preamble.v031.md'));
  for (const set of [undefined, 'v0.1', 'v0.2', 'v0.3', 'v0.3/dev-draw-2', 'v0.3-gen6', 'v0.4', 'v0.4/rehearsal', 'v0.3.10']) expect(defaultPreambleFor(set)).toBe(join('tasks', 'multiuser', '_shared', 'preamble.md'));
});
