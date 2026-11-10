import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { packBundleArchive, readBundleArchive } from '../runner/archive.ts';
import { packTar } from '../runner/heldout/sealed.ts';
import { gunzipSync } from 'node:zlib';
import { build, collect, verify } from '../scripts/bundle.ts';

const j = (...parts: string[]) => parts.join('');
const RUN = 'docs/benchmarks/2026-01-01-fixture';
let root = '';
let out = '';
let preregCommit = '';
let resultsCommit = '';

const sh = (args: string[], cwd = root) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1' } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const put = (rel: string, data: string | Uint8Array) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const commit = (msg: string) => { sh(['add', '-A']); sh(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg]); return sh(['rev-parse', 'HEAD']); };
const trial = (t: string) => `${RUN}/results/trials/cell-a/${t}/r1`;
const code = (f: () => unknown): string => { try { f(); return 'no error'; } catch (e) { return (e as Error).message; } };

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bundle-test-'));
  out = join(root, '..', root.split('/').pop() + '-out');
  sh(['init', '-q', '-b', 'main']);
  put(`${RUN}/prereg.json`, JSON.stringify({ schema_version: 1, run_id: 'fixture-2026-01', cells: [{ id: 'cell-a', harness: 'openclaw', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 1 }] }));
  preregCommit = commit('prereg');
  put(`${RUN}/results/manifest.json`, JSON.stringify({ schema_version: 1, run_id: 'fixture-2026-01' }));
  const lines = ['t1', 't2'].map((t) => JSON.stringify({ trial_id: `fixture-2026-01/cell-a/${t}/r1`, cell: 'cell-a', task: t, harness: 'openclaw', model: 'anthropic:claude-sonnet-5-5', termination: 'completed', grade: t === 't1' ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [], predicates: [], usage: { key: 'sk-trial-' + 'a'.repeat(24), usd: 0.1 } }));
  put(`${RUN}/results/trials.jsonl`, lines.join('\n') + '\n');
  for (const t of ['t1', 't2']) {
    put(`${trial(t)}/grade.json`, '{"grade":"pass"}');
    put(`${trial(t)}/usage.json`, '{"usd":0.1}');
    put(`${trial(t)}/snapshot.json.gz`, gzipSync('{"world":1}'));
    put(`${trial(t)}/logs/adapter.log`, 'adapter ok');
    put(`${trial(t)}/logs/stderr.log`, 'harness stderr');
    put(`${trial(t)}/trial.json`, '{"token":"trial-token:x"}');
    put(`${trial(t)}/workspace/AGENTS.md`, 'harness workspace');
  }
  resultsCommit = commit('results');
  put('README.md', 'later unrelated change');
  commit('unrelated');
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });

describe('bundle build', () => {
  test('is deterministic, keeps trials.jsonl byte for byte and leaves out harness-owned files', () => {
    const a = build({ root, run: RUN, finding: 'fixture', out: join(out, 'a') });
    const b = build({ root, run: RUN, finding: 'fixture', out: join(out, 'b') });
    expect(a.sha256).toBe(b.sha256);
    expect(readFileSync(a.path + '.sha256', 'utf8')).toBe(`${a.sha256}  fixture.bundle.tar.gz\n`);
    const paths = a.manifest.files.map((f) => f.path);
    expect(paths).toContain('results/trials/cell-a/t1/r1/logs/adapter.log');
    expect(paths).toContain('prereg.json');
    expect(paths.some((p) => p.endsWith('trial.json') || p.includes('/workspace/') || p.endsWith('stderr.log'))).toBe(false);
    const entries = readBundleArchive(new Uint8Array(readFileSync(a.path)));
    expect(Buffer.from(entries.find((e) => e.path === 'results/trials.jsonl')!.data).equals(readFileSync(join(root, RUN, 'results/trials.jsonl')))).toBe(true);
    expect(a.manifest).toMatchObject({ schema: 'eval-trial-bundle/1', profile: 'harness-evals/results-1', run_id: 'fixture-2026-01', rerun: { available: true, cells: ['cell-a'], default_reps: 1 } });
    expect(a.manifest.run_commit).toBe(preregCommit);
    expect(a.manifest.receipts_commit).toBe(resultsCommit);
    expect(a.manifest.generator.commit).not.toBe(resultsCommit);
  });

  test('resolves --run-commit and refuses one that is not a commit or not an ancestor of the receipts commit', () => {
    expect(collect({ root, run: RUN, finding: 'fixture', runCommit: preregCommit.slice(0, 12) }).manifest.run_commit).toBe(preregCommit);
    expect(code(() => collect({ root, run: RUN, finding: 'fixture', runCommit: 'deadbeef' }))).toStartWith('HE-BUNDLE-001 --run-commit "deadbeef" is not a commit');
    expect(code(() => collect({ root, run: RUN, finding: 'fixture', runCommit: 'HEAD' }))).toContain('is not an ancestor of receipts_commit');
    expect(code(() => collect({ root, run: RUN, finding: 'fixture', rerunCommit: 'no-such-ref' }))).toStartWith('HE-BUNDLE-001 --rerun-commit');
  });

  test('refuses a token that only appears once the bundle is packed', () => {
    const before = readFileSync(join(root, RUN, 'results/manifest.json'));
    put(`${RUN}/results/manifest.json`, `{"schema_version":1,"run_id":"${j('sk', '\\u002d', 'ant-', 'api03-', 'Q'.repeat(30))}"}`);
    commit('escaped token');
    try {
      const msg = code(() => build({ root, run: RUN, finding: 'fixture', out: join(out, 'esc') }));
      expect(msg).toStartWith('HE-BUNDLE-003');
      expect(msg).toContain('in the bundle as packed');
      expect(msg).not.toContain('QQQQ');
    } finally { put(`${RUN}/results/manifest.json`, before); commit('restore manifest'); }
  });

  test('checks a committed run against custody at HEAD, not only at its receipts commit', () => {
    const S = 'docs/benchmarks/2026-01-08-sealed-later';
    put(`${S}/prereg.json`, JSON.stringify({ run_id: 'sl-2026-01', heldout: { set: 'v9' }, cells: [] }));
    put(`${S}/results/trials.jsonl`, '{}\n');
    commit('run before seal');
    put('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ custody: 'sealed' }));
    commit('seal v9');
    try { expect(code(() => collect({ root, run: S, finding: 'sl' }))).toStartWith(`HE-BUNDLE-002 ${S}`); } finally { rmSync(join(root, S), { recursive: true }); rmSync(join(root, 'tasks'), { recursive: true }); commit('drop sealed-later'); }
  });

  test('refuses a planted token and names the path and pattern, never the token', () => {
    const key = j('sk-', 'ant-', 'api03-', 'Q'.repeat(30));
    put(`${trial('t2')}/usage.json`, JSON.stringify({ note: key }));
    commit('plant');
    const msg = code(() => collect({ root, run: RUN, finding: 'fixture' }));
    expect(msg).toStartWith('HE-BUNDLE-003');
    expect(msg).toContain('results/trials/cell-a/t2/r1/usage.json');
    expect(msg).not.toContain('QQQQ');
    put(`${trial('t2')}/usage.json`, '{"usd":0.1}');
    commit('unplant');
  });

  test('refuses a run planned with a sealed root', () => {
    const msg = code(() => {
      put(`${RUN}/results/manifest.json`, JSON.stringify({ run_id: 'fixture-2026-01', sealed: { set: 'v9' } }));
      try { return collect({ root, run: RUN, finding: 'fixture', local: true }); } finally { put(`${RUN}/results/manifest.json`, JSON.stringify({ schema_version: 1, run_id: 'fixture-2026-01' })); }
    });
    expect(msg).toStartWith('HE-BUNDLE-002');
  });

  test('--local reads the work tree and leaves out git-ignored files', () => {
    put(`${RUN}/results/.gitignore`, 'scratch.txt\n');
    put(`${RUN}/results/scratch.txt`, 'ignored');
    put(`${RUN}/results/extra.json`, '{}');
    const { manifest } = collect({ root, run: RUN, finding: 'fixture', local: true });
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain('results/extra.json');
    expect(paths).not.toContain('results/scratch.txt');
    expect(manifest.receipts_commit).toBeNull();
    rmSync(join(root, RUN, 'results/extra.json')); rmSync(join(root, RUN, 'results/scratch.txt')); rmSync(join(root, RUN, 'results/.gitignore'));
  });

  test('refuses an analysis id that is not on the list', () => {
    expect(code(() => build({ root, run: RUN, finding: 'fixture', out: join(out, 'x'), analyses: ['rm-rf'] }))).toStartWith('HE-BUNDLE-001');
  });

  test('--local refuses a symbolic link instead of reading what it points to', () => {
    put('outside.txt', 'host file');
    symlinkSync(join(root, 'outside.txt'), join(root, RUN, 'results/link.txt'));
    try { expect(code(() => collect({ root, run: RUN, finding: 'fixture', local: true }))).toStartWith('HE-BUNDLE-001 docs/benchmarks/2026-01-01-fixture/results/link.txt is a symbolic link'); } finally { rmSync(join(root, RUN, 'results/link.txt')); rmSync(join(root, 'outside.txt')); }
  });

  test('--local applies the custody checks to the files it bundles, untracked ones included', () => {
    put(`${RUN}/results/notes.txt`, 'note ' + j('AGE-SECRET-KEY-1', 'Q'.repeat(58)));
    try { expect(code(() => collect({ root, run: RUN, finding: 'fixture', local: true }))).toBe('HE-BUNDLE-002 results/notes.txt holds an age identity; fix: stop, do not publish, report the path to internal-task'); } finally { rmSync(join(root, RUN, 'results/notes.txt')); }
    put(`${RUN}/results/access-log.jsonl`, '{}');
    try { expect(code(() => collect({ root, run: RUN, finding: 'fixture', local: true }))).toContain('the custody access log'); } finally { rmSync(join(root, RUN, 'results/access-log.jsonl')); }
    const S = 'docs/benchmarks/2026-01-04-local-sealed';
    put('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ custody: 'sealed' }));
    put(`${S}/prereg.json`, JSON.stringify({ run_id: 'ls-2026-01', heldout: { set: 'v9' }, cells: [] }));
    put(`${S}/results/trials.jsonl`, '{}\n');
    try { expect(code(() => collect({ root, run: S, finding: 'ls', local: true }))).toStartWith('HE-BUNDLE-002 docs/benchmarks/2026-01-04-local-sealed/prereg.json opens set v9'); } finally { rmSync(join(root, S), { recursive: true }); rmSync(join(root, 'tasks'), { recursive: true }); }
  });

  test('--local still runs the sealed-publication scan when the run directory has tracked files', () => {
    put(`${RUN}/sealed-results/raw-receipt.json`, '{}');
    commit('tracked raw sealed receipt');
    try { expect(code(() => collect({ root, run: RUN, finding: 'fixture', local: true }))).toBe(`HE-BUNDLE-002 ${RUN} holds material sealed custody keeps off main (1 path(s), first ${RUN}/sealed-results/raw-receipt.json: a raw sealed receipt (a sealed-results/ directory holds export.json, opening-receipt.json and README.md only)); fix: a run on a set in sealed custody is bundled from its sealed-results export only, after release`); } finally { rmSync(join(root, RUN, 'sealed-results'), { recursive: true }); commit('drop raw sealed receipt'); }
  });

  test('--local refuses a run on a released set whose world slice a live sealed set shares', () => {
    const S = 'docs/benchmarks/2026-01-07-shared';
    const w = 'a'.repeat(64);
    put('tasks/multiuser/v8/heldout/MANIFEST.json', JSON.stringify({ custody: 'released', released: { world_slice_sha256: w } }));
    put('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ custody: 'sealed', sealed: { world_slice_sha256: w } }));
    put(`${S}/prereg.json`, JSON.stringify({ run_id: 'sh-2026-01', heldout: { set: 'v8' }, cells: [] }));
    put(`${S}/results/trials.jsonl`, '{}\n');
    try { expect(code(() => collect({ root, run: S, finding: 'sh', local: true }))).toStartWith('HE-BUNDLE-002 docs/benchmarks/2026-01-07-shared/prereg.json opens set v8'); } finally { rmSync(join(root, S), { recursive: true }); rmSync(join(root, 'tasks'), { recursive: true }); }
  });

  test('--local refuses a file reached through a linked directory', () => {
    const L = 'docs/benchmarks/2026-01-05-linked';
    const outside = mkdtempSync(join(tmpdir(), 'bundle-outside-'));
    writeFileSync(join(outside, 'trials.jsonl'), '{"private":1}\n');
    put(`${L}/prereg.json`, JSON.stringify({ run_id: 'linked-2026-01', cells: [] }));
    put(`${L}/results/trials.jsonl`, '{}\n');
    commit('linked run');
    rmSync(join(root, L, 'results'), { recursive: true });
    symlinkSync(outside, join(root, L, 'results'));
    try { expect(code(() => collect({ root, run: L, finding: 'linked', local: true }))).toBe(`HE-BUNDLE-001 ${L}/results/trials.jsonl is a symbolic link, sits under one, or is not a regular file; fix: a bundle holds regular files only, so replace it with the file it points to or remove it`); } finally { rmSync(join(root, L), { recursive: true }); rmSync(outside, { recursive: true }); commit('drop linked'); }
  });

  test('refuses a committed symbolic link and malformed JSON without quoting it', () => {
    const C = 'docs/benchmarks/2026-01-06-committed-link';
    put(`${C}/prereg.json`, JSON.stringify({ run_id: 'cl-2026-01', cells: [] }));
    put(`${C}/results/trials.jsonl`, '{}\n');
    symlinkSync('trials.jsonl', join(root, C, 'results/alias.jsonl'));
    commit('committed link');
    expect(code(() => collect({ root, run: C, finding: 'cl' }))).toContain('is committed as mode 120000');
    rmSync(join(root, C, 'results/alias.jsonl'));
    const secretish = 'not json ' + 'Z'.repeat(40);
    put(`${C}/results/manifest.json`, secretish);
    commit('bad manifest');
    const msg = code(() => collect({ root, run: C, finding: 'cl' }));
    expect(msg).toBe(`HE-BUNDLE-001 ${C}/results/manifest.json is not valid JSON; fix: check the file in the run's results`);
    rmSync(join(root, C), { recursive: true });
    commit('drop');
  });

  test('bundles a released sealed run as results plus its public export', () => {
    const R = 'docs/benchmarks/2026-01-03-released';
    put(`${R}/prereg.json`, JSON.stringify({ run_id: 'released-2026-01', cells: [{ id: 'cell-r' }] }));
    put(`${R}/results/trials.jsonl`, '{"trial_id":"released-2026-01/cell-r/t1/r1"}\n');
    put(`${R}/results/manifest.json`, JSON.stringify({ run_id: 'released-2026-01', sealed: { set: 'v9' } }));
    put(`${R}/sealed-results/export.json`, '{"decision":"accepted"}');
    commit('released run');
    const { manifest } = collect({ root, run: R, finding: 'released' });
    expect(manifest.profile).toBe('harness-evals/results-1');
    expect(manifest.files.map((f) => f.path)).toEqual(['prereg.json', 'results/manifest.json', 'results/trials.jsonl', 'sealed-results/export.json']);
    expect(manifest.rerun.available).toBe(true);
    expect(code(() => collect({ root, run: R, finding: 'released', local: true }))).toStartWith('HE-BUNDLE-002');
  });

  test('bundles a sealed opening as its public export only, with no rerun', () => {
    const S = 'docs/benchmarks/2026-01-02-sealed';
    put(`${S}/prereg.json`, JSON.stringify({ run_id: 'sealed-2026-01', cells: [{ id: 'cell-s' }] }));
    put(`${S}/sealed-results/export.json`, '{"decision":"accepted"}');
    put(`${S}/sealed-results/opening-receipt.json`, '{}');
    put(`${S}/sealed-results/README.md`, 'export');
    commit('sealed export');
    const { manifest } = collect({ root, run: S, finding: 'sealed' });
    expect(manifest.profile).toBe('harness-evals/sealed-export-1');
    expect(manifest.rerun).toEqual({ available: false, cells: [], default_reps: 1 });
    expect(manifest.files.map((f) => f.path).sort()).toEqual(['prereg.json', 'sealed-results/README.md', 'sealed-results/export.json', 'sealed-results/opening-receipt.json']);
  });
});

describe('bundle verify', () => {
  const fresh = () => build({ root, run: RUN, finding: 'fixture', out: join(out, 'v') });
  const repack = (path: string, edit: (e: { path: string; data: Uint8Array }[]) => { path: string; data: Uint8Array }[]) => {
    const p = join(out, 'tampered.tar.gz');
    writeFileSync(p, packBundleArchive(edit(readBundleArchive(new Uint8Array(readFileSync(path))))));
    return p;
  };

  test('passes a good bundle with its digest, and rebuilds it file by file from the repository', () => {
    const b = fresh();
    expect(verify(b.path, { sha256: b.sha256, rebuild: true, root }).manifest.finding).toBe('fixture');
  });

  test('refuses a wrong digest before reading the archive', () => {
    const b = fresh();
    expect(code(() => verify(b.path, { sha256: '0'.repeat(64) }))).toStartWith('HE-BUNDLE-005');
  });

  test('refuses a changed, an extra and a missing file', () => {
    const b = fresh();
    const changed = repack(b.path, (es) => es.map((e) => (e.path === 'results/trials.jsonl' ? { ...e, data: new Uint8Array([...e.data, 10]) } : e)));
    expect(code(() => verify(changed))).toStartWith('HE-BUNDLE-007 1 file(s) do not match bundle.json, first: changed file results/trials.jsonl');
    const extra = repack(b.path, (es) => [...es, { path: 'results/extra.json', data: new Uint8Array([1]) }]);
    expect(code(() => verify(extra))).toContain('extra file results/extra.json');
    const missing = repack(b.path, (es) => es.filter((e) => e.path !== 'prereg.json'));
    expect(code(() => verify(missing))).toContain('missing file prereg.json');
  });

  test('refuses a bundle.json that is not a manifest object', () => {
    const b = fresh();
    for (const body of ['null', '[]', '{"schema":"eval-trial-bundle/1","files":"x"}']) {
      const p = repack(b.path, (es) => es.map((e) => (e.path === 'bundle.json' ? { ...e, data: new TextEncoder().encode(body) } : e)));
      expect(code(() => verify(p))).toStartWith('HE-BUNDLE-006');
    }
  });

  test('--rebuild refuses changed manifest fields and an analysis step that is not the checked-in one', () => {
    const b = fresh();
    const edit = (f: (m: Record<string, unknown>, es: { path: string; data: Uint8Array }[]) => { path: string; data: Uint8Array }[]) => repack(b.path, (es) => {
      const m = JSON.parse(Buffer.from(es.find((e) => e.path === 'bundle.json')!.data).toString());
      const next = f(m, es.filter((e) => e.path !== 'bundle.json'));
      const listed = new Map(next.map((e) => [e.path, e] as const));
      m.files = [...listed.values()].map((e) => ({ path: e.path, sha256: new Bun.CryptoHasher('sha256').update(e.data).digest('hex'), bytes: e.data.length })).sort((x: { path: string }, y: { path: string }) => (x.path < y.path ? -1 : 1));
      return [...next, { path: 'bundle.json', data: new TextEncoder().encode(JSON.stringify(m)) }];
    });
    const cells = edit((m, es) => { m.rerun = { available: true, cells: ['other-cell'], default_reps: 1 }; return es; });
    expect(code(() => verify(cells))).toBe('no error');
    expect(code(() => verify(cells, { rebuild: true, root }))).toMatch(/^HE-BUNDLE-008 the repository at [0-9a-f]{12} gives 1 file difference\(s\), first: bundle\.json rerun differs$/);
    const steps = edit((_m, es) => [...es, { path: 'analysis.json', data: new TextEncoder().encode(JSON.stringify({ steps: [{ id: 'summarize-run', script: 'evil.ts', args: [] }] })) }, { path: 'expected-output.txt', data: new TextEncoder().encode('made up') }]);
    expect(code(() => verify(steps, { rebuild: true, root }))).toContain('analysis.json names summarize-run (not the checked-in step)');
    const proto = edit((_m, es) => [...es, { path: 'analysis.json', data: new TextEncoder().encode(JSON.stringify({ steps: [{ id: 'constructor' }] })) }, { path: 'expected-output.txt', data: new TextEncoder().encode('x') }]);
    expect(code(() => verify(proto, { rebuild: true, root }))).toContain('analysis.json names constructor');
    const empty = edit((_m, es) => [...es, { path: 'analysis.json', data: new TextEncoder().encode('{"steps":[]}') }, { path: 'expected-output.txt', data: new TextEncoder().encode('made up') }]);
    expect(code(() => verify(empty, { rebuild: true, root }))).toContain('analysis.json lists no steps');
    const bare = edit((_m, es) => [...es, { path: 'expected-output.txt', data: new TextEncoder().encode('made up') }]);
    expect(code(() => verify(bare, { rebuild: true, root }))).toContain('expected-output.txt with no analysis.json');
    const readme = edit((_m, es) => es.map((e) => (e.path === 'README.md' ? { ...e, data: new TextEncoder().encode('trust me') } : e)));
    expect(code(() => verify(readme, { rebuild: true, root }))).toContain('README.md is not the one this repository writes');
  });

  const reedit = (path: string, f: (m: Record<string, unknown>, es: { path: string; data: Uint8Array }[]) => { path: string; data: Uint8Array }[]) => repack(path, (es) => {
    const m = JSON.parse(Buffer.from(es.find((e) => e.path === 'bundle.json')!.data).toString());
    const next = f(m, es.filter((e) => e.path !== 'bundle.json'));
    m.files = next.map((e) => ({ path: e.path, sha256: new Bun.CryptoHasher('sha256').update(e.data).digest('hex'), bytes: e.data.length })).sort((x: { path: string }, y: { path: string }) => (x.path < y.path ? -1 : 1));
    return [...next, { path: 'bundle.json', data: new TextEncoder().encode(JSON.stringify(m)) }];
  });

  test('--rebuild refuses an analysis.json that repeats a step', () => {
    const b = build({ root, run: RUN, finding: 'fixture', out: join(out, 'rep'), analyses: ['summarize-run'] });
    const step = { id: 'summarize-run', script: 'scripts/summarize-run.ts', args: ['--seed', '7'] };
    const p = reedit(b.path, (_m, es) => es.map((e) => (e.path === 'analysis.json' ? { ...e, data: new TextEncoder().encode(JSON.stringify({ steps: [step, step, step] })) } : e)));
    expect(code(() => verify(p, { rebuild: true, root }))).toContain('analysis.json repeats step summarize-run');
  });

  test('--rebuild checks run_commit and rerun_commit the way build does', () => {
    const b = fresh();
    const later = sh(['rev-parse', 'HEAD']);
    const bad = reedit(b.path, (m, es) => { m.run_commit = 'f'.repeat(40); return es; });
    expect(code(() => verify(bad, { rebuild: true, root }))).toContain('bundle.json run_commit is not a commit in this repository');
    const after = reedit(b.path, (m, es) => { m.run_commit = later; return es; });
    expect(code(() => verify(after, { rebuild: true, root }))).toContain('bundle.json run_commit is not an ancestor of receipts_commit');
    const rerun = reedit(b.path, (m, es) => { m.rerun_commit = 'HEAD'; return es; });
    expect(code(() => verify(rerun, { rebuild: true, root }))).toContain('bundle.json rerun_commit is not a commit in this repository');
  });

  test('refuses an archive larger on disk than the caps allow before reading it', () => {
    const big = join(out, 'big.tar.gz');
    writeFileSync(big, new Uint8Array(200_000).map((_, i) => (i * 7919) % 251));
    expect(code(() => verify(big, { maxBytes: 1, maxEntries: 1 }))).toMatch(/^HE-BUNDLE-004 .* bytes, more than an archive under the caps can be/);
  });

  test('--rebuild passes a genuine bundle built with analyses', () => {
    const b = build({ root, run: RUN, finding: 'fixture', out: join(out, 'an'), analyses: ['summarize-run'] });
    expect(b.manifest.files.map((f) => f.path)).toContain('expected-output.txt');
    expect(verify(b.path, { sha256: b.sha256, rebuild: true, root }).manifest.finding).toBe('fixture');
  });

  test('--rebuild refuses a local bundle', () => {
    const p = build({ root, run: RUN, finding: 'fixture', out: join(out, 'local'), local: true }).path;
    expect(code(() => verify(p, { rebuild: true, root }))).toStartWith('HE-BUNDLE-008');
  });

  test('refuses a bundle.json that lists a path twice', () => {
    const b = fresh();
    const p = repack(b.path, (es) => es.map((e) => { if (e.path !== 'bundle.json') return e; const m = JSON.parse(Buffer.from(e.data).toString()); m.files.push(m.files[0]); return { ...e, data: new TextEncoder().encode(JSON.stringify(m)) }; }));
    expect(code(() => verify(p))).toBe('HE-BUNDLE-006 bundle.json lists a path twice; fix: it is not a trial bundle');
  });

  test('refuses an unknown schema major', () => {
    const b = fresh();
    const p = repack(b.path, (es) => es.map((e) => (e.path === 'bundle.json' ? { ...e, data: new TextEncoder().encode(JSON.stringify({ ...JSON.parse(Buffer.from(e.data).toString()), schema: 'eval-trial-bundle/2' })) } : e)));
    expect(code(() => verify(p))).toStartWith('HE-BUNDLE-006');
  });

  test('--rebuild names a file the repository no longer gives', () => {
    const b = fresh();
    const p = repack(b.path, (es) => {
      const m = JSON.parse(Buffer.from(es.find((e) => e.path === 'bundle.json')!.data).toString());
      const data = new TextEncoder().encode('{"usd":0.2}');
      const target = 'results/trials/cell-a/t1/r1/usage.json';
      for (const f of m.files) if (f.path === target) { f.sha256 = new Bun.CryptoHasher('sha256').update(data).digest('hex'); f.bytes = data.length; }
      return es.map((e) => (e.path === target ? { ...e, data } : e.path === 'bundle.json' ? { ...e, data: new TextEncoder().encode(JSON.stringify(m)) } : e));
    });
    expect(code(() => verify(p))).toBe('no error');
    expect(code(() => verify(p, { rebuild: true, root }))).toStartWith('HE-BUNDLE-008');
  });
});

describe('archive reader', () => {
  const header = (path: string, size: number, type: string) => {
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(new TextEncoder().encode(s), at);
    put(path, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
    put(size.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136); put('        ', 148); put(type, 156); put('ustar\0', 257); put('00', 263);
    let sum = 0; for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const tar = (...hs: Uint8Array[]) => { const parts = [...hs, new Uint8Array(1024)]; const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return new Uint8Array(gzipSync(o)); };

  test('wraps the sealed tar writer unchanged: the same entries give the same tar bytes', () => {
    const es = [{ path: 'b/x.json', data: new TextEncoder().encode('{}') }, { path: 'a.txt', data: new Uint8Array([1, 2, 3]) }];
    expect(Buffer.from(gunzipSync(packBundleArchive(es))).equals(Buffer.from(packTar(es)))).toBe(true);
    expect(Buffer.from(packBundleArchive(es)).equals(Buffer.from(packBundleArchive([...es].reverse())))).toBe(true);
  });

  test('refuses a size field the cap walk cannot read instead of skipping the caps', () => {
    const h = header('a', 0, '0');
    h.set([0xef, 0xbb, 0xbf], 124);
    let sum = 0; h.fill(32, 148, 156); for (const b of h) sum += b;
    h.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    expect(code(() => readBundleArchive(tar(h, header('b', 0, '0'))))).toContain('size field that is not plain octal');
  });

  test('refuses links, parent paths, absolute paths and duplicates', () => {
    expect(code(() => readBundleArchive(tar(header('a', 0, '2'))))).toStartWith('HE-BUNDLE-004');
    expect(code(() => readBundleArchive(tar(header('../a', 0, '0'))))).toContain('unsafe path');
    expect(code(() => readBundleArchive(tar(header('/etc/a', 0, '0'))))).toContain('unsafe path');
    expect(code(() => readBundleArchive(tar(header('a', 0, '0'), header('a', 0, '0'))))).toContain('duplicate');
  });

  test('refuses an archive past the entry or byte caps, including a gzip that expands past the cap', () => {
    const three = packBundleArchive([{ path: 'a', data: new Uint8Array(1) }, { path: 'b', data: new Uint8Array(1) }, { path: 'c', data: new Uint8Array(1) }]);
    expect(code(() => readBundleArchive(three, { maxEntries: 2, maxBytes: 1 << 20 }))).toContain('more than 2 files');
    const bomb = packBundleArchive([{ path: 'big', data: new Uint8Array(8 << 20) }]);
    expect(code(() => readBundleArchive(bomb, { maxEntries: 10, maxBytes: 1024 }))).toContain('expands past');
    expect(code(() => readBundleArchive(new Uint8Array([1, 2, 3])))).toContain('not gzip data');
  });

  test('accepts many small files under the byte cap even though their tar headers pass it', () => {
    const many = packBundleArchive(Array.from({ length: 5000 }, (_, i) => ({ path: `f${i}`, data: new Uint8Array(1) })));
    expect(readBundleArchive(many, { maxEntries: 5000, maxBytes: 5000 }).length).toBe(5000);
  });
});

describe('bundle CLI', () => {
  test('exits 2 with one HE-BUNDLE line in a scrubbed environment', () => {
    const r = spawnSync(process.execPath, [join(import.meta.dir, '..', 'scripts/bundle.ts'), 'verify', join(out, 'nope.tar.gz')], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root } });
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toStartWith('HE-BUNDLE-005');
  });

  test('refuses --sha256 with no value rather than skipping the digest check', () => {
    const b = build({ root, run: RUN, finding: 'fixture', out: join(out, 'cli') });
    const run = (...a: string[]) => spawnSync(process.execPath, [join(import.meta.dir, '..', 'scripts/bundle.ts'), 'verify', b.path, ...a], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root } });
    const empty = run('--sha256');
    expect(empty.status).toBe(2);
    expect(empty.stderr.trim()).toBe('HE-BUNDLE-001 --sha256 needs a value');
    expect(run('--sha256', b.sha256).stdout).toContain('sha256_checked=yes');
    expect(run().stdout).toContain('sha256_checked=no');
    expect(run('--max-bytes', 'lots').status).toBe(2);
    expect(run('--max-bytes', '9000000000').stderr).toContain('must be a positive integer below');
    expect(run(`--sha256=${b.sha256}`).stderr.trim()).toBe('HE-BUNDLE-001 --sha256 is not a verify flag (write --flag value, not --flag=value)');
    expect(run('--sha265', b.sha256).stderr.trim()).toBe('HE-BUNDLE-001 --sha265 is not a verify flag');
  });
});
