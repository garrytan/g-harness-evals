// scripts/ubicloud/stage_ledger.py: a torn last line in <replicate-to>/stage-ledger.jsonl (a write that never finished)
// no longer blocks later launches.
//
// Value: protects=a ledger whose last line was cut short still counts every whole row, warns about the torn one, and the
// next row is written on a line of its own; fails_when=the reader refuses the whole ledger over the torn line (every later
// launch of the stage is refused) or the next append lands on the end of the fragment; why_new=#490's second-model review
// (internal-task); seam=the module imported by python3; no_claim=an unreadable complete line, which still refuses.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UBI = join(import.meta.dir, '..', 'scripts', 'ubicloud');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const row = (lease: number, reservation: string) => JSON.stringify({ run_id: 'r1', stage: 'main', dest: '/d/' + reservation, lease_usd: lease, resume: false, reservation });

function py(rep: string, code: string, ...args: string[]) {
  return spawnSync('python3', ['-c', 'import json, sys; sys.path.insert(0, sys.argv[1]); import stage_ledger as sl; rep = sys.argv[2]\n' + code, UBI, rep, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: rep },
  });
}
const units = (rep: string) => py(rep, "print(json.dumps(sl.units(rep, 'r1', 'main', 'test', 'before any VM call')))");

describe('stage ledger torn last line', () => {
  test('a torn last line is left out with a warning, and the next row lands on a line of its own', () => {
    const rep = mkdtempSync(join(tmpdir(), 'he-stage-ledger-'));
    dirs.push(rep);
    const ledger = join(rep, 'stage-ledger.jsonl');
    writeFileSync(ledger, row(5, 'a') + '\n' + row(3, 'b').slice(0, 30));
    const before = units(rep);
    expect(before.status).toBe(0);
    expect(JSON.parse(before.stdout)).toEqual({ '/d/a': { a: 5 } });
    expect(before.stderr).toContain('line 2 is unreadable and was cut short');
    const w = py(rep, 'sl.append(rep, json.loads(sys.argv[3]))', row(2, 'c'));
    expect(w.status).toBe(0);
    expect(w.stderr).toContain('ends in a line that was cut short');
    const text = readFileSync(ledger, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.slice(0, -1).split('\n');
    expect(lines.slice(0, 2)).toEqual([row(5, 'a'), row(3, 'b').slice(0, 30)]);
    expect(lines.slice(2).map((l) => JSON.parse(l))).toEqual([{ torn_before: true }, JSON.parse(row(2, 'c'))]);
    const after = units(rep);
    expect(after.status).toBe(0);
    expect(JSON.parse(after.stdout)).toEqual({ '/d/a': { a: 5 }, '/d/c': { c: 2 } });
    expect(after.stderr).toContain('line 2 is unreadable and was cut short');
    expect(py(rep, 'sl.append(rep, json.loads(sys.argv[3]))', row(1, 'd')).stderr).toBe('');
  });

  test('a short write fails the append, so no reservation is issued on a cut row, and the next row ends and marks it', () => {
    const rep = mkdtempSync(join(tmpdir(), 'he-stage-ledger-'));
    dirs.push(rep);
    const short = py(rep, 'w = sl.os.write\nsl.os.write = lambda fd, b: w(fd, b[:20])\ntry: sl.append(rep, json.loads(sys.argv[3]))\nexcept OSError as e: print(e); sys.exit(3)', row(5, 'a'));
    expect(short.status).toBe(3);
    expect(short.stdout).toContain('only 20 of ');
    expect(short.stdout).toContain('a short write, as on a full disk');
    expect(py(rep, 'sl.append(rep, json.loads(sys.argv[3]))', row(2, 'c')).status).toBe(0);
    const r = units(rep);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ '/d/c': { c: 2 } });
    expect(r.stderr).toContain('line 1 is unreadable and was cut short');
  });

  test('an unreadable line that ends in a newline still refuses', () => {
    const rep = mkdtempSync(join(tmpdir(), 'he-stage-ledger-'));
    dirs.push(rep);
    writeFileSync(join(rep, 'stage-ledger.jsonl'), row(5, 'a') + '\n{"run_id": "r1", "lease_usd": \n' + row(2, 'c') + '\n');
    const r = units(rep);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('line 2 is unreadable, so its lease cannot be counted against the stage cap');
  });
});
