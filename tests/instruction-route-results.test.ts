// internal-task, run anatomy-instruction-route-2026-11: the published figures rebuild from the committed receipts, and the
// receipts are bound to the preregistration's merge commit as the preregistration's Commit binding asks.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse as followed, markdown as followedMarkdown } from '../scripts/instruction-followed.ts';
import { analyse as secondary, markdown } from '../scripts/instruction-route-secondary.ts';

const ROOT = join(import.meta.dir, '..');
const DIR = join(ROOT, 'docs', 'benchmarks', '2026-10-31-anatomy-instruction-route');
const RESULTS = join(DIR, 'results');
const COMMIT = 'ba456e687eece0ad2250176103a0b28866234665';
// sha256 of prereg.json at COMMIT (git show ba456e687:docs/benchmarks/2026-10-31-anatomy-instruction-route/prereg.json | sha256sum).
const PREREG_AT_COMMIT = '303358221c8fa18fd962b154216244916cac807c65016d6beb38a628fcb81a2f';
const prereg = JSON.parse(readFileSync(join(DIR, 'prereg.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; config?: string }> };
const read = (p: string) => JSON.parse(readFileSync(join(RESULTS, p), 'utf8'));

describe('anatomy-instruction-route-2026-11 results', () => {
  test('every shard ran at the preregistration merge commit, counted, with the preregistered prereg.json', () => {
    for (const s of ['oc-routes', 'he-routes']) {
      expect(read(s + '.shard.json').commit).toBe(COMMIT);
      const vm = read(s + '.shard-vm.json');
      expect(vm).toMatchObject({ commit: COMMIT, scratch_prereg: false, exit: 0 });
    }
    expect(read('manifest.json').prereg_sha256).toBe(PREREG_AT_COMMIT);
    expect(createHash('sha256').update(readFileSync(join(DIR, 'prereg.json'))).digest('hex')).toBe(PREREG_AT_COMMIT);
    const rows = readFileSync(join(RESULTS, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rows).toHaveLength(585);
    expect(new Set(rows.map((r) => r.termination))).toEqual(new Set(['completed']));
  });

  test('the primary endpoint rebuilds from the committed events and turn windows', () => {
    const r = followed(RESULTS, prereg.cells);
    expect(JSON.parse(JSON.stringify(r))).toEqual(read('instruction-followed/instruction-followed.json'));
    expect(followedMarkdown(r)).toBe(readFileSync(join(RESULTS, 'instruction-followed', 'instruction-followed.md'), 'utf8'));
  });

  test('the route evidence and the descriptive paired differences rebuild from the committed receipts', () => {
    const r = secondary(RESULTS, prereg.cells);
    expect(JSON.parse(JSON.stringify(r))).toEqual(read('route-secondary/route-secondary.json'));
    expect(markdown(r)).toBe(readFileSync(join(RESULTS, 'route-secondary', 'route-secondary.md'), 'utf8'));
    for (const e of r.evidence) expect([e.route_record_ok, e.ready_route_ok]).toEqual([65, 65]);
    expect(Object.fromEntries(r.evidence.filter((e) => e.config === 'route-hook').map((e) => [e.harness, e.hook]))).toEqual({ openclaw: { loaded: 65 }, hermes: { healthy: 65 } });
  });
});
