// The public chronology contract (runner/prereg/prereg.ts --public, scripts/prereg-ledger.ts) on synthetic git histories:
// a preregistration committed before its results passes, attested by the ledger or by strict ancestry; an experiment
// after the cutover with its preregistration and results in one commit fails; a ledger whose hashes or dates disagree
// with the history fails; a ledger changed in a second commit fails; writing a ledger that would leave out an experiment
// refuses. Across merges, as the export publishes them (main's first-parent line only, with a commit map): a preregistration
// a merge brought in passes before results a later merge brought in, with the receipts' attestations mapped through the
// commit map; results first, results in the preregistration's commit, or both brought in by one merge fail; an attestation
// commit with no published first-parent landing fails closed.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTESTATION_MAP_PATH, ATTESTED, buildAttestationMap, buildLedger, checkOrder, checkPublic, type Ledger, LEDGER_PATH, MAPPED, type ManifestEntry, type Publication, type PublicResult, readAttestationMap } from '../runner/prereg/prereg.ts';

const ROOT = join(import.meta.dir, '..');
const X: ManifestEntry = { id: 'x', preregistration: 'docs/x/PREREGISTRATION.md', results: ['docs/x/results/**'] };
const Y: ManifestEntry = { id: 'y', preregistration: 'docs/y/PREREGISTRATION.md', results: ['docs/y/results/**'] };

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prereg-ledger-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  return dir;
}

function commit(dir: string, files: Record<string, string>, message: string): string {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), body);
    execFileSync('git', ['add', file], { cwd: dir });
  }
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

const date = (dir: string) => execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
const writeLedger = (dir: string, ledger: Ledger) => commit(dir, { [LEDGER_PATH]: JSON.stringify(ledger, null, 2) + '\n' }, 'ledger');
const statuses = (dir: string, entries: ManifestEntry[], ledger: Ledger) => checkPublic(entries, ledger, dir).map((r) => [r.id, r.status]);

/** x preregistered (as PR #7) and then given results, before the cutover; the ledger written and committed after. */
function preCutover(): { dir: string; ledger: Ledger } {
  const dir = repo();
  commit(dir, { [X.preregistration]: 'the rule' }, 'preregister x (#7)');
  commit(dir, { 'docs/x/results/trials.jsonl': '{"pass":true}\n', 'docs/x/results/report.md': 'x passed' }, 'x results (#8)');
  const ledger = buildLedger([X], date(dir), dir);
  writeLedger(dir, ledger);
  return { dir, ledger };
}

describe('the prereg ledger', () => {
  test('records the private commit, date, PR number and both sha256 values of each experiment up to the cutover', () => {
    const dir = repo();
    const pre = commit(dir, { [X.preregistration]: 'the rule' }, 'preregister x (#7)');
    commit(dir, { 'docs/x/results/a.json': '{}' }, 'x results (#8)');
    const ledger = buildLedger([X], date(dir), dir);
    expect(ledger.label).toBe(ATTESTED);
    expect(ledger.experiments).toHaveLength(1);
    expect(ledger.experiments[0]).toMatchObject({ id: 'x', preregistration: X.preregistration, prereg_commit: pre, pr_number: 7, result_files: 1 });
    expect(ledger.experiments[0]!.prereg_sha256).toBe(new Bun.CryptoHasher('sha256').update('the rule').digest('hex'));
    expect(() => buildLedger([X], '2000-01-01T00:00:00Z', dir)).toThrow(/x: preregistration merged .*after the cutover 2000-01-01T00:00:00.000Z/);
  });

  test('prereg before results passes: attested through the ledger, or by strict ancestry with no ledger entry', () => {
    const { dir, ledger } = preCutover();
    expect(statuses(dir, [X], ledger)).toEqual([['x', 'attested']]);
    expect(statuses(dir, [X], { ...ledger, experiments: [] })).toEqual([['x', 'strict']]);
    commit(dir, { 'docs/x/results/late.json': '{}' }, 'a result file added after the ledger');
    commit(dir, { [X.preregistration]: 'the rule\n\nAmendment, dated: a later public change' }, 'amend x');
    expect(statuses(dir, [X], ledger)).toEqual([['x', 'attested']]);
  });

  test('after the cutover, a preregistration and its results in one commit fail, with or without a ledger entry', async () => {
    const { dir, ledger } = preCutover();
    await Bun.sleep(1100);
    commit(dir, { [Y.preregistration]: 'the rule', 'docs/y/results/trials.jsonl': '{}\n' }, 'y prereg and results together');
    const [, y] = checkPublic([X, Y], ledger, dir);
    expect(y).toMatchObject({ id: 'y', status: 'failed' });
    expect(y!.problems[0]).toContain('not after the preregistration commit');
    const forged = { ...ledger, experiments: [...ledger.experiments, { ...buildLedger([Y], date(dir), dir).experiments[0]! }] };
    const [, y2] = checkPublic([X, Y], forged, dir);
    expect(y2!.status).toBe('failed');
    expect(y2!.problems[0]).toContain('dated after the cutover');
    const declared = { ...Y, preregistered_on_main: false as const, reason: 'preregistered on a branch, squash-merged with the results' };
    expect(checkPublic([X, declared], ledger, dir)[1]!.status).toBe('failed');
    await Bun.sleep(1100);
    commit(dir, { 'docs/z/PREREGISTRATION.md': 'the rule' }, 'z prereg');
    commit(dir, { 'docs/z/results/trials.jsonl': '{}\n' }, 'z results');
    expect(statuses(dir, [X, { id: 'z', preregistration: 'docs/z/PREREGISTRATION.md', results: ['docs/z/results/**'] }], ledger)).toEqual([['x', 'attested'], ['z', 'strict']]);
  }, 20_000);

  test('a ledger changed after its first commit fails every experiment, so a later cutover cannot attest a prereg and its results in one commit', async () => {
    const { dir, ledger } = preCutover();
    await Bun.sleep(1100);
    commit(dir, { [Y.preregistration]: 'the rule', 'docs/y/results/trials.jsonl': '{}\n' }, 'y prereg and results together');
    expect(checkPublic([X, Y], ledger, dir)[1]!.status).toBe('failed');
    const later = buildLedger([X, Y], date(dir), dir);
    writeLedger(dir, later);
    expect(checkPublic([X, Y], later, dir)).toEqual([{ id: '*', status: 'failed', problems: [`${LEDGER_PATH} was changed in 2 commits; the ledger is written once and never edited`] }]);
  }, 20_000);

  test('a second ledger written on a side branch and merged in still counts as a second write', () => {
    const { dir, ledger } = preCutover();
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('checkout', '-q', '-b', 'side', 'HEAD~1');
    const side = { ...ledger, cutover: '2100-01-01T00:00:00.000Z' };
    writeLedger(dir, side);
    g('checkout', '-q', 'main');
    g('merge', '-q', '-X', 'theirs', '--no-edit', 'side');
    expect(checkPublic([X], side, dir)[0]).toMatchObject({ id: '*', status: 'failed' });
  });

  test('a ledger rewritten inside a merge commit counts as a second write', () => {
    const { dir, ledger } = preCutover();
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('checkout', '-q', '-b', 'side', 'HEAD~1');
    commit(dir, { 'docs/unrelated.md': 'side' }, 'unrelated side change');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--no-commit', '--no-ff', 'side');
    const rewritten = { ...ledger, cutover: '2100-01-01T00:00:00.000Z' };
    writeFileSync(join(dir, LEDGER_PATH), JSON.stringify(rewritten, null, 2) + '\n');
    g('add', LEDGER_PATH);
    g('commit', '-q', '--no-edit');
    expect(checkPublic([X], rewritten, dir)).toEqual([{ id: '*', status: 'failed', problems: [`${LEDGER_PATH} was changed in 2 commits; the ledger is written once and never edited`] }]);
  });

  test('a result file a merge brought in fails its experiment; an attested deviation is reported', () => {
    const { dir, ledger } = preCutover();
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('checkout', '-q', '-b', 'side');
    commit(dir, { 'docs/unrelated.md': 'side' }, 'unrelated side change');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--no-commit', '--no-ff', 'side');
    mkdirSync(join(dir, 'docs/x/results'), { recursive: true });
    writeFileSync(join(dir, 'docs/x/results/smuggled.json'), '{}');
    g('add', 'docs/x/results/smuggled.json');
    g('commit', '-q', '--no-edit');
    expect(checkPublic([X], ledger, dir)[0]).toMatchObject({ id: 'x', status: 'failed', problems: ["docs/x/results/smuggled.json: no commit in this history adds it (a merge brought it in), so its order can't be checked"] });
    const clean = preCutover();
    const declared = { ...clean.ledger, experiments: [{ ...clean.ledger.experiments[0]!, declared_deviation: 'squash-merged with its results' }] };
    expect(checkPublic([X], declared, clean.dir)[0]).toEqual({ id: 'x', status: 'attested', problems: [], deviation: 'squash-merged with its results' });
  });

  test('a ledger hash mismatch fails: the preregistration, the result files, or a result file changed in the ledger commit', () => {
    const { dir, ledger } = preCutover();
    const entry = ledger.experiments[0]!;
    const fail = (l: Ledger) => checkPublic([X], l, dir)[0]!;
    expect(fail({ ...ledger, experiments: [{ ...entry, prereg_sha256: 'f'.repeat(64) }] })).toMatchObject({ status: 'failed', problems: ['ledger hash mismatch: the preregistration differs from the ledger'] });
    expect(fail({ ...ledger, experiments: [{ ...entry, result_manifest_sha256: 'f'.repeat(64) }] })).toMatchObject({ status: 'failed', problems: ['ledger hash mismatch: the result files differ from the ledger'] });
    const stale = repo();
    commit(stale, { [X.preregistration]: 'the rule' }, 'preregister x (#7)');
    commit(stale, { 'docs/x/results/report.md': 'x passed' }, 'x results (#8)');
    const old = buildLedger([X], date(stale), stale);
    commit(stale, { 'docs/x/results/report.md': 'x passed, edited after the ledger was written', [LEDGER_PATH]: JSON.stringify(old) }, 'stale ledger committed with an edit');
    expect(checkPublic([X], old, stale)[0]).toMatchObject({ status: 'failed', problems: ['ledger hash mismatch: the result files differ from the ledger'] });
  });

  test('a ledger date that disagrees with the history, an unknown experiment and an unreadable cutover fail', () => {
    const { dir, ledger } = preCutover();
    const entry = ledger.experiments[0]!;
    const moved = checkPublic([X], { ...ledger, experiments: [{ ...entry, prereg_merged_at: '2020-01-01T00:00:00.000Z' }] }, dir)[0]!;
    expect(moved.status).toBe('failed');
    expect(moved.problems[0]).toContain('the ledger says 2020-01-01');
    expect(checkPublic([], ledger, dir)).toEqual([{ id: 'x', status: 'failed', problems: ['the ledger names an experiment the manifest does not list'] }]);
    expect(checkPublic([X], { ...ledger, cutover: 'soon' }, dir)[0]!.status).toBe('failed');
  });

  test('prereg.ts --public fails a new out-of-order experiment that declares the private deviation flag, which the private check only warns about', async () => {
    const { dir, ledger } = preCutover();
    await Bun.sleep(1100);
    const declared = { ...Y, preregistered_on_main: false as const, reason: 'preregistered on a branch, squash-merged with the results' };
    commit(dir, { [Y.preregistration]: 'the rule', 'docs/y/results/trials.jsonl': '{}\n', 'docs/benchmarks/preregistrations.json': JSON.stringify({ schema_version: 1, experiments: [X, declared] }) }, 'y prereg and results together');
    expect(ledger.experiments.map((e) => e.id)).toEqual(['x']);
    const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'runner', 'prereg', 'prereg.ts'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    writeFileSync(join(dir, ATTESTATION_MAP_PATH), JSON.stringify({ schema_version: 1, note: '', label: MAPPED, attestations: {}, exceptions: [] }));
    const pub = run('--public');
    expect(pub.status).toBe(1);
    expect(pub.stderr).toContain('prereg-public: y: docs/y/results/trials.jsonl: added in ');
    expect(pub.stdout).toContain('prereg-public: 2 experiments, 1 attested, 0 strict, 1 failed');
    expect(pub.stdout).toContain(`prereg-public: x: ${ATTESTED}`);
    const priv = run();
    expect(priv.status).toBe(0);
    expect(priv.stderr).toContain('prereg-order: warning: y: docs/y/results/trials.jsonl');
  }, 20_000);

  test('scripts/prereg-ledger.ts writes the ledger, and --check fails once a result file changes', () => {
    const dir = repo();
    commit(dir, { [X.preregistration]: 'the rule', 'docs/benchmarks/preregistrations.json': JSON.stringify({ schema_version: 1, experiments: [X] }) }, 'preregister x (#7)');
    commit(dir, { 'docs/x/results/a.json': '{}' }, 'x results');
    const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'prereg-ledger.ts'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    expect(run().status).toBe(64);
    const wrote = run('--cutover', date(dir));
    expect(wrote.stdout).toContain('wrote docs/benchmarks/prereg-ledger.json (1 experiments');
    expect((JSON.parse(readFileSync(join(dir, LEDGER_PATH), 'utf8')) as Ledger).experiments[0]!.pr_number).toBe(7);
    expect(run('--check').status).toBe(0);
    writeFileSync(join(dir, 'docs/x/results/a.json'), '{"changed":true}');
    expect(run('--check').status).toBe(1);
    const refused = run('--cutover', '2000-01-01T00:00:00Z');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('prereg-ledger: x: preregistration merged');
  });
});

const NO_LEDGER: Ledger = { schema_version: 1, note: '', label: ATTESTED, cutover: '2000-01-01T00:00:00.000Z', experiments: [] };
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const attest = (commit: string) => JSON.stringify({ preregistration_attestation: { preregistration: X.preregistration, preregistration_commit: commit } });
const SUMMARY = 'docs/x/results/run-summary.json';

/** A pull request: the commits run on a branch off main, which then lands as a plain merge. Returns the branch commits
 *  and the merge. */
function pr(dir: string, name: string, commits: ((ids: string[]) => Record<string, string>)[]): { ids: string[]; merge: string } {
  git(dir, 'checkout', '-q', '-b', name, 'main');
  const ids: string[] = [];
  for (const files of commits) ids.push(commit(dir, files(ids), `${name} ${ids.length + 1}`));
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '--no-edit', name);
  return { ids, merge: git(dir, 'rev-parse', 'HEAD') };
}

/** What history mode publishes: main's first-parent line, each commit with its own tree, and a commit map from every
 *  private main commit to its public id or "(not published)". The private objects stay in the object store unreachable,
 *  as a commit map row naming a rewritten branch commit main does not hold would. */
function exportFirstParent(src: string, held?: string): { dir: string; publication: Publication } {
  const dir = repo();
  git(dir, 'fetch', '-q', src, 'main:refs/private/main');
  const map = new Map<string, string>();
  let parent = '';
  const index = { ...process.env, GIT_INDEX_FILE: join(dir, '.git', 'held-index') };
  const without = (tree: string) => {
    if (!held) return tree;
    execFileSync('git', ['read-tree', tree], { cwd: dir, env: index });
    execFileSync('git', ['rm', '-r', '-q', '--cached', '--ignore-unmatch', held], { cwd: dir, env: index });
    return execFileSync('git', ['write-tree'], { cwd: dir, env: index, encoding: 'utf8' }).trim();
  };
  for (const c of git(dir, 'rev-list', '--first-parent', '--reverse', 'refs/private/main').split('\n')) {
    parent = git(dir, 'commit-tree', without(git(dir, 'rev-parse', `${c}^{tree}`)), ...(parent ? ['-p', parent] : []), '-m', `public: ${git(dir, 'log', '-1', '--format=%s', c)}`);
    map.set(c, parent);
  }
  if (held) parent = git(dir, 'commit-tree', 'refs/private/main^{tree}', '-p', parent, '-m', `a later export releases ${held}`);
  git(dir, 'update-ref', 'refs/heads/main', parent);
  git(dir, 'reset', '-q', '--hard', 'main');
  git(dir, 'update-ref', '-d', 'refs/private/main');
  for (const c of git(src, 'rev-list', 'main').split('\n')) if (!map.has(c)) map.set(c, '(not published)');
  return { dir, publication: { map, source: src } };
}

/** The frontier-harness shape: x preregistered on one pull request's branch and its results, whose receipt attests the
 *  branch commit, on a later pull request's branch; both land as plain merges. */
function frontier(): { src: string; pre: string; preMerge: string; resultsMerge: string } {
  const src = repo();
  commit(src, { 'README.md': 'base', 'docs/benchmarks/preregistrations.json': JSON.stringify({ schema_version: 1, experiments: [X] }) }, 'base');
  const p = pr(src, 'prereg', [() => ({ [X.preregistration]: 'the rule' }), () => ({ 'docs/x/notes.md': 'notes' })]);
  commit(src, { 'docs/other.md': 'unrelated' }, 'an unrelated main commit');
  const r = pr(src, 'results', [() => ({ [SUMMARY]: attest(p.ids[0]!), 'docs/x/results/trials.jsonl': '{}\n' })]);
  return { src, pre: p.ids[0]!, preMerge: p.merge, resultsMerge: r.merge };
}

describe('the public check across merges, mapped through the commit map', () => {
  test('a preregistration on a merged branch passes before results a later merge brought in, with the attestation mapped through the merge that published it', () => {
    const { src, pre, preMerge } = frontier();
    expect(checkOrder([X], src)).toEqual([]);
    const { dir, publication } = exportFirstParent(src);
    expect(publication.map.get(pre)).toBe('(not published)');
    expect(checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, publication)).toEqual([{ id: 'x', status: 'strict', problems: [] }]);
    const phantom = new Map(publication.map).set(pre, pre);
    expect(checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, { ...publication, map: phantom })[0]!.status).toBe('strict');
    expect(checkPublic([X], NO_LEDGER, dir)[0]).toEqual({ id: 'x', status: 'failed', problems: [`${SUMMARY}: attestation: ${pre.slice(0, 12)} is not in this history; give --commit-map and --source to map it through the export's commit map`] });
    expect(publication.map.get(preMerge)).not.toBe('(not published)');
  });

  test('prereg.ts --public takes the commit map and the private clone, and refuses one without the other', () => {
    const { src } = frontier();
    const { dir, publication } = exportFirstParent(src);
    writeFileSync(join(dir, LEDGER_PATH), JSON.stringify(NO_LEDGER));
    const map = join(dir, '..', `${dir.split('/').pop()}-commit-map.tsv`);
    writeFileSync(map, 'private\tpublic\n' + [...publication.map].map(([a, b]) => `${a}\t${b}\n`).join(''));
    const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'runner', 'prereg', 'prereg.ts'), '--public', ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    const mapped = run('--commit-map', map, '--source', src);
    expect(mapped.stdout).toContain('prereg-public: x: strict ancestry');
    expect(mapped.stdout).toContain('prereg-public: 1 experiments, 0 attested, 1 strict, 0 failed');
    const missing = run();
    expect([missing.status, missing.stdout]).toEqual([1, '']);
    expect(missing.stderr).toContain(`prereg-public: ${ATTESTATION_MAP_PATH} is missing.`);
    expect(run('--commit-map', map).status).toBe(64);
    expect(run('--write-attestation-map', join(dir, ATTESTATION_MAP_PATH)).status).toBe(64);
    expect(run('--commit-map', map, '--source', src, '--write-attestation-map', join(dir, ATTESTATION_MAP_PATH)).status).toBe(0);
    const alone = run();
    expect(alone.status).toBe(0);
    expect(alone.stdout).toContain(`prereg-public: x: strict ancestry; 1 attestation commit(s) read through ${ATTESTATION_MAP_PATH} (${MAPPED})`);
    const before = git(dir, 'rev-parse', 'HEAD');
    commit(dir, { [ATTESTATION_MAP_PATH]: readFileSync(join(dir, ATTESTATION_MAP_PATH), 'utf8') }, 'a pull request adds the map');
    const edited = run('--base', before);
    expect([edited.status, edited.stdout]).toEqual([1, '']);
    expect(edited.stderr).toContain(`prereg-public: ${ATTESTATION_MAP_PATH} differs from ${before}`);
    expect(run('--base', git(dir, 'rev-parse', 'HEAD')).status).toBe(0);
    writeFileSync(join(dir, ATTESTATION_MAP_PATH), JSON.stringify({ schema_version: 1, note: '', label: MAPPED, attestations: { short: 'abc' }, exceptions: [] }));
    expect(run().stderr).toContain('is not an attestation map');
  });

  test('the attestation map lets the check run without the private clone: each private attestation commit at the public commit the commit map gives, and nothing else', () => {
    const { src, pre, preMerge } = frontier();
    const { dir, publication } = exportFirstParent(src);
    const map = buildAttestationMap([X], dir, publication);
    expect(map.attestations).toEqual({ [pre]: publication.map.get(preMerge)! });
    expect(checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, undefined, map)).toEqual([{ id: 'x', status: 'strict', problems: [], mapped: [pre] }]);
    const short = pre.slice(0, 12);
    const using = (attestations: Record<string, string>) => checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, undefined, { ...map, attestations })[0]!;
    expect(using({}).problems).toEqual([`${SUMMARY}: attestation: ${short} is not in this history, and ${ATTESTATION_MAP_PATH} does not map it`]);
    expect(using({ [pre]: preMerge }).problems).toEqual([`${SUMMARY}: attestation: ${short} is not in this history, and ${ATTESTATION_MAP_PATH} maps it to ${preMerge.slice(0, 12)}, which this history does not hold`]);
    const base = git(dir, 'rev-list', '--max-parents=0', 'HEAD');
    expect(using({ [pre]: base }).problems).toEqual([`${SUMMARY}: attestation names ${short}, published as ${base.slice(0, 12)}, which does not contain the preregistration`]);
    const file = join(dir, '..', `${dir.split('/').pop()}-map.json`);
    writeFileSync(file, JSON.stringify(map));
    expect(readAttestationMap(file)).toEqual(map);
    writeFileSync(file, JSON.stringify({ ...map, label: 'something else' }));
    expect(() => readAttestationMap(file)).toThrow('is not an attestation map');
  });

  test('results added before the preregistration fail', () => {
    const src = repo();
    commit(src, { 'README.md': 'base' }, 'base');
    pr(src, 'results', [() => ({ 'docs/x/results/trials.jsonl': '{}\n' })]);
    pr(src, 'prereg', [() => ({ [X.preregistration]: 'the rule' })]);
    const { dir, publication } = exportFirstParent(src);
    const [x] = checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, publication);
    expect(x!.status).toBe('failed');
    expect(x!.problems).toHaveLength(1);
    expect(x!.problems[0]).toContain('docs/x/results/trials.jsonl: added in ');
    expect(x!.problems[0]).toContain('not after the preregistration commit');
  });

  test('a preregistration and results added in the same commit fail', () => {
    const src = repo();
    commit(src, { 'README.md': 'base' }, 'base');
    const both = commit(src, { [X.preregistration]: 'the rule', 'docs/x/results/trials.jsonl': '{}\n' }, 'x prereg and results together');
    const { dir, publication } = exportFirstParent(src);
    const pub = publication.map.get(both)!.slice(0, 12);
    const b = both.slice(0, 12);
    expect(checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, publication)[0]).toEqual({ id: 'x', status: 'failed', problems: [`docs/x/results/trials.jsonl: added in ${b}, published as ${pub}, not after the preregistration commit ${b}, published as ${pub}`] });
  });

  test('a preregistration and results on one branch, brought in by one merge, fail: they reach main in the same commit', () => {
    const src = repo();
    commit(src, { 'README.md': 'base' }, 'base');
    const { ids, merge } = pr(src, 'both', [() => ({ [X.preregistration]: 'the rule' }), (ids) => ({ [SUMMARY]: attest(ids[0]!) })]);
    expect(checkOrder([X], src)).toEqual([]);
    const { dir, publication } = exportFirstParent(src);
    const pub = publication.map.get(merge)!.slice(0, 12);
    const m = merge.slice(0, 12);
    expect(checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, publication)[0]).toEqual({ id: 'x', status: 'failed', problems: [`${SUMMARY}: added in ${ids[1]!.slice(0, 12)} (brought into main by ${m}), published as ${pub}, not after the preregistration commit ${ids[0]!.slice(0, 12)} (brought into main by ${m}), published as ${pub}`] });
    expect(checkPublic([X], NO_LEDGER, src)[0]).toEqual({ id: 'x', status: 'failed', problems: [`${SUMMARY}: added in ${ids[1]!.slice(0, 12)} (brought into main by ${merge.slice(0, 12)}), not after the preregistration commit ${ids[0]!.slice(0, 12)} (brought into main by ${merge.slice(0, 12)})`] });
  });

  test('results held out of one export and released in a later one are judged at their private landing, not where they first appear in public', () => {
    const src = repo();
    commit(src, { 'README.md': 'base' }, 'base');
    const { ids, merge } = pr(src, 'both', [() => ({ [X.preregistration]: 'the rule' }), () => ({ 'docs/x/results/trials.jsonl': '{}\n' })]);
    commit(src, { 'docs/other.md': 'later' }, 'a later main commit');
    const { dir, publication } = exportFirstParent(src, 'docs/x/results');
    const publicAdd = git(dir, 'log', '--diff-filter=A', '--format=%H', '--', 'docs/x/results/trials.jsonl');
    expect(publicAdd).not.toBe(publication.map.get(merge));
    expect(git(dir, 'log', '-1', '--format=%s', publicAdd)).toBe('a later export releases docs/x/results');
    expect(checkPublic([X], NO_LEDGER, dir)[0]!.status).toBe('strict');
    const pub = publication.map.get(merge)!.slice(0, 12);
    const [x] = checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, publication);
    expect(x).toEqual({ id: 'x', status: 'failed', problems: [`docs/x/results/trials.jsonl: added in ${ids[1]!.slice(0, 12)} (brought into main by ${merge.slice(0, 12)}), published as ${pub}, not after the preregistration commit ${ids[0]!.slice(0, 12)} (brought into main by ${merge.slice(0, 12)}), published as ${pub}`] });
    commit(src, { 'publication/prereg-exceptions.json': JSON.stringify({ exceptions: [{ id: 'x-one-merge', experiment: 'x', paths: ['docs/x/results/**'], waives: 'same-landing', preregistration_commit: ids[0], results_commit: ids[1], merge, reason: 'r', approved: 'test' }] }) }, 'record the exception');
    const later = exportFirstParent(src, 'docs/x/results');
    expect(checkPublic([X], NO_LEDGER, later.dir, LEDGER_PATH, later.publication)[0]).toMatchObject({ id: 'x', status: 'strict', problems: [], exceptions: [{ files: ['docs/x/results/trials.jsonl'] }] });
    const { src: headline } = frontier();
    const held = exportFirstParent(headline, 'docs/x/results');
    expect(checkPublic([X], NO_LEDGER, held.dir, LEDGER_PATH, held.publication)).toEqual([{ id: 'x', status: 'strict', problems: [] }]);
  });

  test('an attestation naming a branch commit from before the preregistration fails, though both land in one merge', () => {
    const src = repo();
    commit(src, { 'README.md': 'base' }, 'base');
    const p = pr(src, 'prereg', [() => ({ 'docs/x/notes.md': 'before the preregistration' }), () => ({ [X.preregistration]: 'the rule' })]);
    pr(src, 'results', [() => ({ [SUMMARY]: attest(p.ids[0]!), 'docs/x/results/trials.jsonl': '{}\n' })]);
    const early = p.ids[0]!.slice(0, 12);
    expect(checkOrder([X], src)).toEqual([{ id: 'x', file: SUMMARY, problem: `attestation names ${early}, which does not contain the preregistration` }]);
    const { dir, publication } = exportFirstParent(src);
    expect(publication.map.get(p.ids[0]!)).toBe('(not published)');
    expect(checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, publication)[0]).toEqual({ id: 'x', status: 'failed', problems: [`${SUMMARY}: attestation names ${early}, which does not contain the preregistration (first added in ${p.ids[1]!.slice(0, 12)} in the source)`] });
  });

  test('an attestation commit with no published first-parent landing fails closed', () => {
    const { src, pre, preMerge } = frontier();
    const { dir, publication } = exportFirstParent(src);
    const status = (map: Map<string, string>) => checkPublic([X], NO_LEDGER, dir, LEDGER_PATH, { ...publication, map })[0]!;
    const because = (r: PublicResult, state: string) => {
      expect(r.status).toBe('failed');
      expect(r.problems.length).toBeGreaterThan(0);
      for (const p of r.problems) expect(p).toContain(`${preMerge.slice(0, 12)}, the first-parent commit that brought it into the source main, is ${state}`);
    };
    because(status(new Map(publication.map).set(preMerge, '(pruned)')), '(pruned)');
    because(status(new Map(publication.map).set(preMerge, pre)), `mapped to ${pre.slice(0, 12)}, which this history does not hold`);
    const unmapped = new Map(publication.map);
    unmapped.delete(preMerge);
    because(status(unmapped), 'not in the commit map');
    const stray = repo();
    commit(stray, { 'README.md': 'base', [X.preregistration]: 'the rule' }, 'base with x preregistered');
    git(stray, 'checkout', '-q', '-b', 'never-merged');
    const lost = commit(stray, { 'docs/x/draft.md': 'draft' }, 'a branch commit that never reaches main');
    git(stray, 'checkout', '-q', 'main');
    commit(stray, { [SUMMARY]: attest(lost) }, 'x results attesting the unmerged commit');
    const out = exportFirstParent(stray);
    expect(checkPublic([X], NO_LEDGER, out.dir, LEDGER_PATH, out.publication)[0]).toEqual({ id: 'x', status: 'failed', problems: [`${SUMMARY}: attestation: ${lost.slice(0, 12)} is not published, and no commit on the source main's first-parent line has it as an ancestor`] });
  });
});

describe('a same-landing exception from publication/prereg-exceptions.json', () => {
  const E: ManifestEntry = { id: 'e-extension', preregistration: 'docs/e/prereg-extension.json', results: ['docs/e/results/**'] };
  const EXT = 'docs/e/results/extension/**';
  const exceptionsFile = (src: string, list: object[]) => commit(src, { 'publication/prereg-exceptions.json': JSON.stringify({ schema: 'harness-evals-prereg-exceptions/1', exceptions: list }, null, 2) }, 'record the exceptions');
  /** The frontier extension's shape: an amendment and its results added on one branch, landed by one merge. */
  function oneMerge(extra: Record<string, string> = {}): { src: string; base: string; pre: string; res: string; merge: string; exception: Record<string, unknown> } {
    const src = repo();
    const base = commit(src, { 'README.md': 'base' }, 'base');
    const { ids, merge } = pr(src, 'extension', [() => ({ [E.preregistration]: 'amendment 3' }), () => ({ 'docs/e/results/extension/analysis.json': '{}', ...extra })]);
    const exception = { id: 'e-extension-one-merge', experiment: E.id, run: 'e', paths: [EXT], waives: 'same-landing', preregistration_commit: ids[0], results_commit: ids[1], merge, reason: 'amendment and results came in one merge; privately the amendment is a strict ancestor of the results', approved: 'test' };
    return { src, base, pre: ids[0]!, res: ids[1]!, merge, exception };
  }
  const check = (src: string, entries: ManifestEntry[]) => {
    const { dir, publication } = exportFirstParent(src);
    return checkPublic(entries, NO_LEDGER, dir, LEDGER_PATH, publication);
  };

  test('the extension case passes with the exception, and every use is recorded; without it, it fails', () => {
    const { src, merge, exception } = oneMerge();
    const [without] = check(src, [E]);
    expect(without!.status).toBe('failed');
    expect(without!.problems[0]).toContain('docs/e/results/extension/analysis.json: added in ');
    exceptionsFile(src, [exception]);
    const [withIt] = check(src, [E]);
    expect(withIt).toMatchObject({ id: E.id, status: 'strict', problems: [], exceptions: [{ exception: { id: 'e-extension-one-merge', merge }, files: ['docs/e/results/extension/analysis.json'] }] });
  });

  test('prereg.ts --public prints each use of an exception with its reason', () => {
    const { src, exception } = oneMerge();
    commit(src, { 'docs/benchmarks/preregistrations.json': JSON.stringify({ schema_version: 1, experiments: [E] }) }, 'manifest');
    exceptionsFile(src, [exception]);
    const { dir, publication } = exportFirstParent(src);
    writeFileSync(join(dir, LEDGER_PATH), JSON.stringify(NO_LEDGER));
    const map = join(dir, '..', `${dir.split('/').pop()}-commit-map.tsv`);
    writeFileSync(map, 'private\tpublic\n' + [...publication.map].map(([a, b]) => `${a}\t${b}\n`).join(''));
    const out = spawnSync(process.execPath, [join(ROOT, 'runner', 'prereg', 'prereg.ts'), '--public', '--commit-map', map, '--source', src], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    expect(out.stdout).toContain(`prereg-public: exception e-extension-one-merge: e-extension: 1 result file(s) under ${EXT} reached main in the preregistration's commit`);
    expect(out.stdout).toContain('Reason: amendment and results came in one merge');
    expect(out.stdout).toContain('prereg-public: 1 experiments, 0 attested, 1 strict, 0 failed, 1 exception(s) used');
  });

  test('another experiment with a same-landing order still fails while the exception exists, even with results under its paths', () => {
    const { src, exception } = oneMerge();
    const F: ManifestEntry = { id: 'f', preregistration: 'docs/f/prereg.json', results: ['docs/e/results/extension/f/**'] };
    pr(src, 'f', [() => ({ [F.preregistration]: 'the rule' }), () => ({ 'docs/e/results/extension/f/analysis.json': '{}' })]);
    exceptionsFile(src, [exception]);
    const [e, f] = check(src, [E, F]);
    expect(e!.status).toBe('strict');
    expect(e!.exceptions![0]!.files).toEqual(['docs/e/results/extension/analysis.json']);
    expect(f!.status).toBe('failed');
    expect(f!.problems).toHaveLength(1);
    expect(f!.problems[0]).toMatch(/^docs\/e\/results\/extension\/f\/analysis\.json: added in [^;]+, not after the preregistration commit [^;]+$/);
  });

  test('a file of the same experiment outside the exception paths with a same-landing order still fails', () => {
    const { src, exception } = oneMerge({ 'docs/e/results/core.json': '{}' });
    exceptionsFile(src, [exception]);
    const [e] = check(src, [E]);
    expect(e!.status).toBe('failed');
    expect(e!.problems).toHaveLength(1);
    expect(e!.problems[0]).toMatch(/^docs\/e\/results\/core\.json: added in [^;]+, not after the preregistration commit [^;]+$/);
    expect(e!.exceptions![0]!.files).toEqual(['docs/e/results/extension/analysis.json']);
  });

  test('results added before the preregistration inside the exception paths still fail', () => {
    const src = repo();
    commit(src, { 'README.md': 'base' }, 'base');
    commit(src, { 'docs/e/results/extension/early.json': '{}' }, 'a result before the amendment');
    const { ids, merge } = pr(src, 'extension', [() => ({ [E.preregistration]: 'amendment 3' }), () => ({ 'docs/e/results/extension/analysis.json': '{}' })]);
    exceptionsFile(src, [{ id: 'e-extension-one-merge', experiment: E.id, paths: [EXT], waives: 'same-landing', preregistration_commit: ids[0], results_commit: ids[1], merge, reason: 'r', approved: 'test' }]);
    const [e] = check(src, [E]);
    expect(e!.status).toBe('failed');
    expect(e!.problems).toHaveLength(1);
    expect(e!.problems[0]).toMatch(/^docs\/e\/results\/extension\/early\.json: added in [^;]+, not after the preregistration commit [^;]+$/);
  });

  test('the exception fails when the private order it states is false', () => {
    const { src, base, pre, exception } = oneMerge();
    exceptionsFile(src, [{ ...exception, results_commit: base }]);
    const [e] = check(src, [E]);
    expect(e!.status).toBe('failed');
    expect(e!.problems[0]).toContain(`exception e-extension-one-merge does not hold: ${pre.slice(0, 12)} is not a strict ancestor of ${base.slice(0, 12)} in the source`);
    expect(e!.exceptions).toBeUndefined();
  });

  test('an exception that excuses nothing, or waives any other rule, fails', () => {
    const { src, exception } = frontierWith();
    exceptionsFile(src, [exception]);
    expect(check(src, [X]).find((r) => r.id === 'x' && r.problems.length)).toEqual({ id: 'x', status: 'failed', problems: ['exception x-unused in publication/prereg-exceptions.json excused no result file; remove it'] });
    exceptionsFile(src, [{ ...exception, waives: 'results-first' }]);
    expect(check(src, [X])).toEqual([{ id: '*', status: 'failed', problems: ['publication/prereg-exceptions.json: x-unused needs waives: "same-landing", the one rule an exception can waive'] }]);
  });

  function frontierWith(): { src: string; exception: Record<string, unknown> } {
    const { src, pre, preMerge } = frontier();
    return { src, exception: { id: 'x-unused', experiment: X.id, paths: ['docs/x/results/**'], waives: 'same-landing', preregistration_commit: pre, results_commit: pre, merge: preMerge, reason: 'r', approved: 'test' } };
  }
});
