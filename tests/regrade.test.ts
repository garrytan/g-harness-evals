import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { TrialRecord } from '../runner/contracts.ts';
import { regradeResults } from '../scripts/regrade.ts';

const ROOT = join(import.meta.dir, '..');
const H1 = join(ROOT, 'docs/benchmarks/2026-10-24-m3-heldout/results');
const PASS_ID = 'm3-heldout-2026-10/openclaw-sonnet-mu-heldout/ho-03-pellucid-prep-call/r1';
const FAIL_ID = 'm3-heldout-2026-10/hermes-sonnet-mu-heldout/os-04-orlavine-rate/r1';
const h1Records = readFileSync(join(H1, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const temps: string[] = [];

const relDir = (id: string) => join('trials', ...id.split('/').slice(1));

function fixture(edit: (rec: TrialRecord) => TrialRecord = (r) => r) {
  const base = mkdtempSync(join(tmpdir(), 'regrade-test-'));
  temps.push(base);
  const results = join(base, 'results');
  for (const id of [PASS_ID, FAIL_ID]) cpSync(join(H1, relDir(id)), join(results, relDir(id)), { recursive: true });
  cpSync(join(H1, 'manifest.json'), join(results, 'manifest.json'));
  const lines = [PASS_ID, FAIL_ID].map((id) => {
    const rec = structuredClone(h1Records.find((r) => r.trial_id === id)!);
    rec.paths = { ...rec.paths, dir: join('/nonexistent-recorded-root', relDir(id)) };
    return JSON.stringify(edit(rec));
  });
  writeFileSync(join(results, 'trials.jsonl'), lines.join('\n') + '\n');
  return { base, results };
}

function cli(args: string[], home: string) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/regrade.ts'), ...args], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home } });
  return { status: r.status, out: r.stdout + r.stderr };
}

const readRows = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

afterAll(() => {
  for (const t of temps) {
    spawnSync('chmod', ['-R', 'u+w', t]);
    rmSync(t, { recursive: true, force: true });
  }
});

describe('scripts/regrade.ts on a relocated results directory', () => {
  test('a clean regrade reads evidence under --results, writes --out outside a read-only bundle, and exits 0', () => {
    const { base, results } = fixture();
    expect(existsSync(join(results, relDir(PASS_ID), 'snapshot.json'))).toBe(false);
    expect(existsSync(join(results, relDir(PASS_ID), 'snapshot.json.gz'))).toBe(true);
    spawnSync('chmod', ['-R', 'a-w', results]);
    const out = join(base, 'regraded.jsonl');
    const r = cli(['--results', results, '--out', out], base);
    expect(r.out).toContain('regraded 2 of 2 trials');
    expect(r.status).toBe(0);
    expect(existsSync(join(results, 'trials.regraded.jsonl'))).toBe(false);
    const rows = readRows(out);
    expect(rows.map((x) => x.trial_id).sort()).toEqual([FAIL_ID, PASS_ID].sort());
    for (const row of rows) {
      expect(row.regraded).toBe(true);
      expect(row.changed).toBe(false);
      expect(row.evidence_dir).toBe(join(results, relDir(row.trial_id)));
    }
  }, 60_000);

  test('reads events.jsonl.gz and turns.jsonl.gz when the plain files are absent', async () => {
    const { results } = fixture();
    const dir = join(results, relDir(FAIL_ID));
    for (const name of ['events.jsonl', 'turns.jsonl']) {
      writeFileSync(join(dir, name + '.gz'), gzipSync(readFileSync(join(dir, name))));
      rmSync(join(dir, name));
    }
    const report = await regradeResults({ results, repoRoot: ROOT });
    expect(report.problems).toEqual([]);
    expect(report.summary).toMatchObject({ selected: 2, regraded: 2, not_regraded: 0, changed: 0 });
  }, 60_000);

  test('--cells regrades only the named cells and an unknown cell is a usage error', () => {
    const { base, results } = fixture();
    const out = join(base, 'regraded.jsonl');
    const r = cli(['--results', results, '--cells', 'openclaw-sonnet-mu-heldout', '--out', out], base);
    expect(r.status).toBe(0);
    expect(readRows(out).map((x) => x.trial_id)).toEqual([PASS_ID]);
    const bad = cli(['--results', results, '--cells', 'no-such-cell', '--out', out], base);
    expect(bad.status).toBe(2);
    expect(bad.out).toContain('no-such-cell');
  }, 60_000);

  test('a tampered recorded grade exits 1 and names the trial and the predicates that moved', () => {
    let flipped = '';
    const { base, results } = fixture((rec) => {
      if (rec.trial_id !== FAIL_ID) return rec;
      const p = rec.predicates.find((x) => !x.passed)!;
      flipped = p.id;
      p.passed = true;
      return { ...rec, grade: 'pass' };
    });
    const r = cli(['--results', results, '--out', join(base, 'regraded.jsonl')], base);
    expect(r.status).toBe(1);
    const line = r.out.split('\n').find((l) => l.startsWith('changed: '))!;
    expect(line).toContain(FAIL_ID);
    expect(line).toContain('grade pass -> fail');
    expect(line).toContain(flipped);
    expect(r.out).not.toContain('changed: ' + PASS_ID);
  }, 60_000);

  test('missing evidence exits 1 with the trial marked regraded:false', () => {
    const { base, results } = fixture();
    rmSync(join(results, relDir(PASS_ID), 'snapshot.json.gz'));
    const out = join(base, 'regraded.jsonl');
    const r = cli(['--results', results, '--out', out], base);
    expect(r.status).toBe(1);
    expect(r.out).toContain('not regraded: ' + PASS_ID);
    const row = readRows(out).find((x) => x.trial_id === PASS_ID);
    expect(row.regraded).toBe(false);
    expect(row.reason).toContain('snapshot.json');
  }, 60_000);

  test('a missing --results or trials.jsonl is a usage error', () => {
    const base = mkdtempSync(join(tmpdir(), 'regrade-test-'));
    temps.push(base);
    expect(cli([], base).status).toBe(2);
    expect(cli(['--results', base], base).status).toBe(2);
  });
});
