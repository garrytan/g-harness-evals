// The 2026-11-25 R126 checks (internal-task): judge-backed numbers checked against labels with no model in them. These tests
// rerun the lookup-reader and failure-mining checks on the committed receipts and check the dated report lines quote them.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const bun = (...a: string[]) => spawnSync('bun', a, { cwd: ROOT, encoding: 'utf8', env: ENV });
const report = (run: string) => readFileSync(join(ROOT, 'docs/benchmarks', run, 'report.md'), 'utf8');

describe('lookup readers against audit.ts signals', () => {
  const r = bun('scripts/corrections/check-lookup-readers.ts', '--json');
  const out: Array<{ run: string; flags: number; agree: number; reader_yes: number; disagreements: Array<{ task: string }> }> = JSON.parse(r.stdout);
  test('particle-swap agrees on 86 of 90 flags and frontier-harness on 20 of 23, every difference on sanitize-git-repo', () => {
    expect(r.status).toBe(0);
    const ps = out.filter((o) => o.run.startsWith('particle-swap'));
    expect([ps.reduce((s, o) => s + o.agree, 0), ps.reduce((s, o) => s + o.flags, 0), ps.reduce((s, o) => s + o.reader_yes, 0)]).toEqual([86, 90, 38]);
    const fh = out.find((o) => o.run === 'frontier-harness')!;
    expect([fh.agree, fh.flags, fh.reader_yes]).toEqual([20, 23, 4]);
    expect(new Set(out.flatMap((o) => o.disagreements.map((d) => d.task)))).toEqual(new Set(['sanitize-git-repo']));
  });
  test('the reports quote it', () => {
    expect(report('2026-11-09-particle-swap')).toContain('They agree on 86 of the 90 flags.');
    expect(report('2026-11-07-frontier-harness')).toContain("the reader's confirmed list matches on 20 of the 23 flags");
  });
});

describe('failure-mining unscoped_brain_search against the scope counter', () => {
  test('kappa 0.904 and the three readings the report quotes', () => {
    const r = bun('scripts/corrections/check-failure-mining-scope.ts');
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].all).toMatchObject({ trials: 1998, labelled_unscoped: 141, counter_yes: 140, both: 128, kappa: 0.904 });
    expect(lines[0].brain_arms).toMatchObject({ trials: 495, kappa: 0.876 });
    expect(lines[1]).toMatchObject({ unscoped_label_without_model_read: 13, of_them_provider_reads: 12 });
    const pts = (x: number) => (x < 0 ? '-' : '+') + Math.abs(100 * x).toFixed(1);
    const range = (d: { delta: number; ci95: [number, number] }) => pts(d.delta) + ' [' + pts(d.ci95[0]) + ', ' + pts(d.ci95[1]) + ']';
    const md = report('2026-11-09-failure-mining');
    expect(md).toContain('the difference is ' + range(lines[3].unscoped_brain_search));
    expect(md).toContain('moved out, ' + range(lines[4].unscoped_brain_search));
    expect(md).toContain('at kappa 0.904 over all 1,998 labelled trials, and 0.876 over the 495 brain-arm trials');
    expect(md).toContain('12 of the 13 label-only trials are QM provider reads');
    expect(md).toContain('both (' + pts(lines[3].retrieval_any.delta) + ' and ' + pts(lines[4].retrieval_any.delta) + ' points)');
  }, 120_000);
});

describe('skill-resolver construction labels', () => {
  test('each relabelled row takes its writer target, or no skill for a row written to need none, in final and in every judge', () => {
    const out = mkdtempSync(join(tmpdir(), 'r126-labels-'));
    const r = bun('scripts/corrections/skill-resolver-construction-labels.ts', '--out', out);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('labels.jsonl: the published final label agrees with construction on 261 of 289 rows');
    expect(r.stdout).toContain('labels-astra.jsonl: the published final label agrees with construction on 263 of 290 rows');
    const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const setp = new Map(lines(join(ROOT, 'docs/benchmarks/2026-11-08-skill-resolver/results/sets/setp.jsonl')).map((p) => [p.id, p]));
    for (const name of ['construction-labels.jsonl', 'construction-labels-astra.jsonl']) {
      for (const row of lines(join(out, name))) {
        const p = setp.get(row.id);
        const want = { no_skill_needed: p.kind === 'none', acceptable: p.kind === 'none' ? [] : [p.writer_target] };
        expect(row.final).toMatchObject(want);
        for (const l of Object.values(row.judges ?? {})) if (l) expect(l).toMatchObject(want);
      }
    }
    for (const row of lines(join(out, 'union-labels.jsonl'))) {
      const p = setp.get(row.id);
      if (p.writer_target) expect(row.final.acceptable).toContain(p.writer_target);
    }
  });
  test('the check script parses and runs the relabel before the sensitivity runs', () => {
    const sh = 'scripts/corrections/check-r126-2026-11-25.sh';
    expect(spawnSync('bash', ['-n', sh], { cwd: ROOT, env: ENV }).status).toBe(0);
    const text = readFileSync(join(ROOT, sh), 'utf8');
    const relabel = text.indexOf('run scripts/corrections/skill-resolver-construction-labels.ts --out "$S/labels"');
    expect(relabel).toBeGreaterThan(0);
    expect(relabel).toBeLessThan(text.indexOf('run $R/results/tools/analyze-sensitivity.ts'));
  });
});
