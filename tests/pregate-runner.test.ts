// The local pregate lane's runner from .gstack/pregate.json, run the way gstack-pregate runs it.
//
// Value: protects=a fixtures-only selection leaves a PREGATE_SKIP_RECORD line instead of an unexplained exit 0, a real
// test beside fixtures still runs, and a bun run that reports no test count fails the lane; fails_when=the runner drops
// the record, skips a real test or lets ran=null through; why_new=the runner gained a skip record and its own count
// check (internal-task, #355); seam=the runner string under env -i with an allowlisted PATH, a temp directory and a stub bun;
// no_claim=gstack itself still logs a fixtures-only lane as a count-unavailable pass.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const RUNNER = (JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')) as { runner: string }).runner;
const tmp = mkdtempSync(join(tmpdir(), 'he-pregate-runner-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const quote = (f: string) => `'${f.replace(/'/g, `'\\''`)}'`;
function run(files: string[], cwd: string, path: string) {
  const command = RUNNER.replace('{files}', () => files.map(quote).join(' '));
  const r = spawnSync('env', ['-i', `HOME=${tmp}`, `PATH=${path}`, `TMPDIR=${tmp}`, 'LANG=C.UTF-8', 'bash', '-c', command], { cwd, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}
const record = (out: string) => out.split('\n').filter((l) => l.startsWith('PREGATE_SKIP_RECORD: ')).map((l) => JSON.parse(l.slice('PREGATE_SKIP_RECORD: '.length)));

const repo = join(tmp, 'repo');
mkdirSync(repo);
writeFileSync(join(repo, 'real.test.ts'), "import { expect, test } from 'bun:test';\ntest('real', () => expect(1).toBe(1));\n");
const BUN_PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
const FIXTURES = ['tasks/community-claims/rules/a/solution/files/test/cli.spec.ts', './tasks/community-claims/rules/b/environment/app/x.test.ts'];

test('a fixtures-only selection exits 0 with a skip record and runs nothing', () => {
  const r = run(FIXTURES, repo, BUN_PATH);
  expect(r.status).toBe(0);
  expect(record(r.out)).toEqual([{ ran: 0, skipped: 2, reason: 'community-claims fixtures' }]);
  expect(r.out).not.toContain('Ran ');
});

test('fixtures beside a real test still run the real test', () => {
  const r = run([...FIXTURES, 'real.test.ts'], repo, BUN_PATH);
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/Ran 1 test across 1 file/);
  expect(r.out).toContain('skipped 2 fixtures');
  expect(record(r.out)).toEqual([]);
});

test('a bun run that exits 0 without a test count (ran=null) fails the lane', () => {
  const stub = join(tmp, 'stub-bin');
  mkdirSync(stub);
  writeFileSync(join(stub, 'bun'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(stub, 'bun'), 0o755);
  const r = run(['real.test.ts'], repo, `${stub}:/usr/bin:/bin`);
  expect(r.status).toBe(1);
  expect(r.out).toContain('bun reported no test count');
  expect(record(r.out)).toEqual([]);
});
