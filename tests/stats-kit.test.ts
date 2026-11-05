import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clusteredPairedDelta } from '../runner/stats/paired.ts';
import { loadPairedKit, statsKitFor } from '../runner/stats/kit.ts';

const ROOT = join(import.meta.dir, '..');

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stats-kit-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  return dir;
}

function commit(dir: string, files: Record<string, string>, message: string): string {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
    execFileSync('git', ['add', file], { cwd: dir });
  }
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

const registry = (entry: Record<string, unknown>) => JSON.stringify({ schema_version: 1, experiments: [entry] });
const entry = { id: 'x-2026-10', preregistration: 'docs/benchmarks/x/PREREGISTRATION.md', results: ['docs/benchmarks/x/results/**'] };

function fixture() {
  const dir = repo();
  const v1 = commit(dir, { 'runner/stats/paired.ts': "export const KIT = 'v1';\n", 'docs/benchmarks/preregistrations.json': JSON.stringify({ schema_version: 1, experiments: [] }) }, 'kit v1');
  const prereg = commit(dir, { 'docs/benchmarks/x/PREREGISTRATION.md': 'rule', 'docs/benchmarks/preregistrations.d/x.json': registry(entry) }, 'prereg');
  commit(dir, { 'docs/benchmarks/x/results/trials.jsonl': '{}\n' }, 'results');
  const v2 = commit(dir, { 'runner/stats/paired.ts': "export const KIT = 'v2';\n" }, 'kit v2');
  return { dir, v1, prereg, v2, results: join(dir, 'docs/benchmarks/x/results') };
}

describe('statsKitFor', () => {
  test('a run preregistered before a kit change keeps the kit at its preregistration commit, by run id or by results glob', () => {
    const { dir, v1, prereg, results } = fixture();
    const expected = { commit: v1, source: 'preregistration' as const, experiment: 'x-2026-10', preregistration: entry.preregistration, preregistration_commit: prereg };
    expect(statsKitFor(results, dir)).toEqual(expected);
    expect(statsKitFor(dir, dir, 'x-2026-10')).toEqual(expected);
  });

  test('a dated amendment in the registry entry moves the run to the kit it names', () => {
    const { dir, v2, results } = fixture();
    commit(dir, { 'docs/benchmarks/preregistrations.d/x.json': registry({ ...entry, stats_kit: { commit: v2, amendment: 'docs/benchmarks/x/PREREGISTRATION.md, Amendment 2026-11-05' } }) }, 'amendment');
    expect(statsKitFor(results, dir)).toMatchObject({ commit: v2, source: 'amendment', amendment: 'docs/benchmarks/x/PREREGISTRATION.md, Amendment 2026-11-05' });
    commit(dir, { 'docs/benchmarks/preregistrations.d/x.json': registry({ ...entry, stats_kit: { commit: 'deadbeef'.repeat(5), amendment: 'a' } }) }, 'bad amendment');
    expect(() => statsKitFor(results, dir)).toThrow(`stats_kit.commit ${'deadbeef'.repeat(5)} is not a commit`);
  });

  test('an amendment kit commit must be a full hex sha, not a short sha or a moving ref', () => {
    const { dir, v2, results } = fixture();
    for (const ref of [v2.slice(0, 12), 'HEAD', 'main', v2.toUpperCase()]) {
      commit(dir, { 'docs/benchmarks/preregistrations.d/x.json': registry({ ...entry, stats_kit: { commit: ref, amendment: 'a' } }) }, `amendment ${ref}`);
      expect(() => statsKitFor(results, dir)).toThrow('is not a full 40-character lowercase hex commit sha');
    }
  });

  test('a shallow clone is refused instead of reporting the shallow root as the preregistration commit', () => {
    const { dir } = fixture();
    const shallow = mkdtempSync(join(tmpdir(), 'stats-kit-shallow-'));
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, shallow], { stdio: 'ignore' });
    expect(() => statsKitFor(join(shallow, 'docs/benchmarks/x/results'), shallow)).toThrow('x-2026-10: this is a shallow clone');
  });

  test('a directory no entry covers uses the checkout kit and says why', () => {
    const { dir, v2 } = fixture();
    const scratch = mkdtempSync(join(tmpdir(), 'stats-kit-scratch-'));
    expect(statsKitFor(scratch, dir, 'other-run')).toMatchObject({ commit: v2, source: 'checkout', dirty: false });
    expect(statsKitFor(scratch, dir).reason).toContain('no entry in docs/benchmarks/preregistrations*.json');
    writeFileSync(join(dir, 'runner/stats/paired.ts'), "export const KIT = 'local';\n");
    expect(statsKitFor(scratch, dir).dirty).toBe(true);
  });
});

describe('loadPairedKit', () => {
  test('loads the chosen commit\'s paired.ts when its tree differs from the checkout', async () => {
    const { dir, results } = fixture();
    const kit = statsKitFor(results, dir);
    const loaded = await loadPairedKit(kit, dir) as unknown as { KIT: string };
    expect(loaded.KIT).toBe('v1');
  });

  test('removes the extract directory after the import', async () => {
    const { dir, results } = fixture();
    const kit = statsKitFor(results, dir);
    const extracts = () => new Set(readdirSync(tmpdir()).filter(name => name.startsWith('harness-evals-stats-kit-')));
    const before = extracts();
    const loaded = await loadPairedKit(kit, dir) as unknown as { KIT: string };
    expect(loaded.KIT).toBe('v1');
    expect([...extracts()].filter(name => !before.has(name))).toEqual([]);
  });

  test('does not import a kit planted at a guessable tmpdir path', async () => {
    const { dir, results } = fixture();
    const kit = statsKitFor(results, dir);
    const planted = join(tmpdir(), `harness-evals-stats-kit-${kit.commit}`, 'runner/stats');
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'paired.ts'), "export const KIT = 'planted';\n");
    const loaded = await loadPairedKit(kit, dir) as unknown as { KIT: string };
    expect(loaded.KIT).toBe('v1');
  });

  test('v03-opus-dev-2026-10 and laneb-tb2-replication-2026-10 are analysed with the kit before v2', async () => {
    const tenTasks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, cluster: `t${i}`, a: i < 3 ? 0 : 0.5, b: i < 3 ? 1 : 0.5 }));
    for (const [dir, run] of [['docs/benchmarks/2026-10-31-v03-opus-dev/results', 'v03-opus-dev-2026-10'], ['docs/benchmarks/2026-10-30-laneb-tb2-replication', 'laneb-tb2-replication-2026-10']] as const) {
      const kit = statsKitFor(join(ROOT, dir), ROOT, run);
      expect(kit).toMatchObject({ source: 'preregistration', experiment: run });
      const old = await loadPairedKit(kit, ROOT);
      const stats = old.clusteredPairedDelta(tenTasks, { seed: 7, draws: 2000 });
      expect(old.superiorityP(stats, 0, 'higher')!).toBeLessThan(0.05);
    }
    const { superiorityP } = await import('../runner/stats/paired.ts');
    expect(superiorityP(clusteredPairedDelta(tenTasks, { seed: 7, draws: 2000 }), 0, 'higher')).toBe(0.125);
  });
});
