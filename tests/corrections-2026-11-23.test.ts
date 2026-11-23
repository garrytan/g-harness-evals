// The 2026-11-23 correction re-grades the fable-diagnosis run with stronger tests, keyless (docs/corrections/2026-11-23/README.md).
// These tests rerun the reproducer on the committed receipts and check that the published prose quotes sensitivity.json.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const DIR = 'docs/corrections/2026-11-23';

describe('2026-11-23 correction: every number rebuilds from committed receipts', () => {
  test('reproduce-2026-11-23.sh --check rebuilds sensitivity.json byte for byte', () => {
    const r = spawnSync('bash', ['scripts/corrections/reproduce-2026-11-23.sh', mkdtempSync(join(tmpdir(), 'he-corrections-s23-')), '--check'], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.stderr + r.stdout).toBe('');
    expect(r.status).toBe(0);
  }, 300_000);

  test('the reproducer runs every script the numbers come from', () => {
    const sh = readFileSync(join(ROOT, 'scripts/corrections/reproduce-2026-11-23.sh'), 'utf8');
    for (const script of ['scripts/frontier-harbor/feature-split.ts', 'scripts/corrections/fable-diagnosis-regrade.ts']) expect(sh).toContain(script);
  });
});

describe('the published prose quotes sensitivity.json', () => {
  const s = JSON.parse(readFileSync(join(ROOT, DIR, 'sensitivity.json'), 'utf8'));
  const md = readFileSync(join(ROOT, DIR, 'README.md'), 'utf8');
  type Try = { task: string; model: string; attempt: string; recorded: number; replay: number; stronger: number; read_opus: string | null; read_astra: string | null };
  const tries: Try[] = readFileSync(join(ROOT, DIR, 'regrade.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const pts = (x: number) => (x < 0 ? '-' : '+') + Math.abs(100 * x).toFixed(1);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const usd = (x: number) => `$${x.toFixed(2)}`;
  const range = (d: { delta: number; ci95: [number, number] }) => `${pts(d.delta)} [${pts(d.ci95[0])}, ${pts(d.ci95[1])}]`;
  const ratio = (r: { ratio: number; ci95: [number, number] }) => `${r.ratio.toFixed(2)}x [${r.ci95[0].toFixed(2)}x, ${r.ci95[1].toFixed(2)}x]`;
  const extra = (e: { usd: number; ci95: [number, number] }) => `${usd(e.usd)} [${usd(e.ci95[0])}, ${usd(e.ci95[1])}]`;
  const row = (k: string) => {
    const r = s.readings[k];
    return `${pct(r.all.pass_rate.fable)} | ${pct(r.all.pass_rate.opus)} | ${range(r.all.difference)} | ${ratio(r.all.cost_ratio)} | ${extra(r.all.extra_cost_per_extra_solve)} | ${range({ delta: r.interaction.estimate, ci95: r.interaction.ci95 })} |`;
  };

  test('the readings table', () => {
    expect(md).toContain(`| As published | 107 | ${row('published')}`);
    const bold = row('stronger_tests').slice(0, -2).split(' | ').map((c) => `**${c}**`).join(' | ');
    expect(md).toContain(`| **Stronger tests (corrected)** | **107** | ${bold} |`);
    expect(md).toContain(`| Stronger tests plus both reads (sensitivity) | 107 | ${row('stronger_tests_and_reads')}`);
    expect(md).toContain(`| Stronger tests, without the 4 tasks whose replay missed | 103 | ${row('stronger_tests_without_mismatched_tasks')}`);
    expect(md).toContain(`| Stronger tests plus both reads, without those 4 tasks | 103 | ${row('stronger_tests_and_reads_without_mismatched_tasks')}`);
    expect(s.readings.published.all.difference.delta).toBeCloseTo(0.0654, 4);
    expect(range(s.readings.stronger_tests.all.difference)).toBe('+7.9 [+1.9, +14.0]');
  });

  test('the published reading is the report as merged', () => {
    const a = JSON.parse(readFileSync(join(ROOT, 'docs/benchmarks/2026-11-14-fable-diagnosis/results/analysis/analysis.json'), 'utf8'));
    expect(JSON.stringify(a)).toContain(String(s.readings.published.all.difference.delta));
  });

  test('the cost, group and power lines', () => {
    const st = s.readings.stronger_tests, pub = s.readings.published;
    expect(md).toContain(`a solved try cost ${usd(st.all.cost_per_solve.fable)} with Fable 5.2 and ${usd(st.all.cost_per_solve.opus)} with Opus 5.5 (published: ${usd(pub.all.cost_per_solve.fable)} and ${usd(pub.all.cost_per_solve.opus)})`);
    expect(md).toContain(`On the ${st.diagnosis.tasks} issues that name no file the fix changes: ${range(st.diagnosis.difference).replace(' [', ' points [')}, ${usd(st.diagnosis.extra_cost_per_extra_solve.usd)} per extra solve`);
    expect(st.diagnosis.extra_cost_per_extra_solve.ci95).toBeNull();
    expect(md).toContain(`On the ${st.pointed.tasks} that name one: ${range(st.pointed.difference)}, ${extra(st.pointed.extra_cost_per_extra_solve)}`);
    const [l, m, h] = st.all.fable_lower_same_higher, [pl, pm, ph] = pub.all.fable_lower_same_higher;
    expect(md).toContain(`lower on ${l} tasks, the same on ${m} and higher on ${h} (published: ${pl}, ${pm}, ${ph})`);
    expect(md).toContain(`it is ${(100 * st.all.mde80).toFixed(1)} points with the stronger tests (published: ${(100 * pub.all.mde80).toFixed(1)})`);
  });

  test('the counts', () => {
    const c = s.counts;
    expect([c.tries, c.replay_reproduced_recorded_grade, c.replay_mismatches.length, c.tasks_without_mismatches]).toEqual([428, 424, 4, 103]);
    expect(md).toContain(`${c.replay_reproduced_recorded_grade} of ${c.tries} rebuilt diffs re-grade to the recorded result`);
    expect(c.recorded_passes).toEqual({ fable: tries.filter((t) => t.recorded === 1 && t.model.includes('fable')).length, opus: tries.filter((t) => t.recorded === 1 && t.model.includes('opus')).length });
    expect(md).toContain(`7 of Opus 5.5's ${c.recorded_passes.opus} recorded passes and 4 of Fable 5.2's ${c.recorded_passes.fable}. All 11 are among the ${c.recorded_passes_replay_reproduced.opus} and ${c.recorded_passes_replay_reproduced.fable} passes whose replay reproduced`);
    const reproduced = c.recorded_passes_replay_reproduced.opus + c.recorded_passes_replay_reproduced.fable;
    for (const page of ['docs/corrections.md', 'docs/README.md']) expect(readFileSync(join(ROOT, page), 'utf8')).toContain(`11 of the ${reproduced} recorded passes whose replay reproduced`);
    expect(c.recorded_passes_failing_stronger_tests).toEqual({ fable: 4, opus: 7 });
    expect(md).toContain(`The readers agreed on ${c.reads_agree} of ${c.tries_read.fable + c.tries_read.opus} tries (Cohen's kappa ${c.reads_kappa.toFixed(2)})`);
    const both = c.read_pairs_opus_astra['flaw / flaw'];
    expect(md).toContain(`both did on ${both} (${c.both_reads_flaw.fable} of Fable 5.2's tries and ${c.both_reads_flaw.opus} of Opus 5.5's)`);
    const opusFlaw = both + c.read_pairs_opus_astra['flaw / wrong'], astraFlaw = both + c.read_pairs_opus_astra['wrong / flaw'];
    expect(md).toContain(`Opus 5.5 called ${opusFlaw} of them correct fixes and Astra ${astraFlaw}`);
    const flaw = tries.filter((t) => t.read_opus === 'flaw' && t.read_astra === 'flaw');
    expect(flaw.length).toBe(both);
    expect([flaw.filter((t) => t.replay === 0 && t.stronger === 1).length, flaw.filter((t) => t.replay === 1 && t.stronger === 0).length, flaw.filter((t) => t.replay === 0 && t.stronger === 0).length]).toEqual([51, 2, 2]);
    expect(md).toContain('51 of the 55 fail the task\'s own tests but pass the stronger tests');
  });

  test('the rejected passes table lists exactly the tries regrade.jsonl rejects', () => {
    const mismatch = new Set(s.counts.replay_mismatches.map((m: Try) => `${m.task} ${m.model} ${m.attempt}`));
    const rejected = tries.filter((t) => t.recorded === 1 && t.stronger === 0 && !mismatch.has(`${t.task} ${t.model} ${t.attempt}`));
    expect(rejected.length).toBe(11);
    const name = (m: string) => (m.includes('fable') ? 'Fable 5.2' : 'Opus 5.5');
    const table = md.split('## 2.')[1].split('## 3.')[0];
    for (const t of rejected) {
      const task = t.task.replace('__', '/').replace(/-(\d+)$/, '#$1');
      const line = table.split('\n').find((l) => l.startsWith(`| ${task} |`));
      expect(line).toBeDefined();
      expect(line).toMatch(new RegExp(`${name(t.model)} [^|]*${t.attempt}`));
    }
    expect(table.split('\n').filter((l) => /^\| [a-z-]+\/[a-z-]+#\d+ \|/i.test(l)).length).toBe(new Set(rejected.map((t) => t.task)).size);
  });

  test('the docs index and the corrections list quote the corrected numbers', () => {
    const st = s.readings.stronger_tests;
    const idx = readFileSync(join(ROOT, 'docs/README.md'), 'utf8'), list = readFileSync(join(ROOT, 'docs/corrections.md'), 'utf8');
    const inter = range({ delta: st.interaction.estimate, ci95: st.interaction.ci95 }).replace(' [', ' points [');
    expect(idx).toContain(`${range(st.all.difference).replace(' [', ' points [')} at ${ratio(st.all.cost_ratio)} and ${usd(st.all.extra_cost_per_extra_solve.usd)} per extra solve [${usd(st.all.extra_cost_per_extra_solve.ci95[0])}, ${usd(st.all.extra_cost_per_extra_solve.ci95[1])}]; the interaction stays below zero (${inter})`);
    expect(list).toContain(`to ${range(st.all.difference)} (${pct(st.all.pass_rate.fable)} against ${pct(st.all.pass_rate.opus)}), the cost ratio from 2.49x to ${ratio(st.all.cost_ratio)}, and the extra cost per extra solve from $31.34 [$15.92, $150.61] to ${extra(st.all.extra_cost_per_extra_solve)}`);
    expect(list).toContain(`(interaction ${inter})`);
    expect(list).toContain(`without their tasks the lead is ${range(s.readings.stronger_tests_without_mismatched_tasks.all.difference)}`);
    const g2 = s.readings.stronger_tests_and_reads.all;
    expect(list).toContain(`(kappa ${s.counts.reads_kappa.toFixed(2)}, below our 0.6 bar) gives ${range(g2.difference)} at ${usd(g2.extra_cost_per_extra_solve.usd)} per extra solve`);
  });
});
