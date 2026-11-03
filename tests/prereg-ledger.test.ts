// The public chronology contract (runner/prereg/prereg.ts --public, scripts/prereg-ledger.ts) on synthetic git histories:
// a preregistration committed before its results passes, attested by the ledger or by strict ancestry; an experiment
// after the cutover with its preregistration and results in one commit fails; a ledger whose hashes or dates disagree
// with the history fails; a ledger changed in a second commit fails; writing a ledger that would leave out an experiment
// refuses.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTESTED, buildLedger, checkPublic, type Ledger, LEDGER_PATH, type ManifestEntry } from '../runner/prereg/prereg.ts';

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
