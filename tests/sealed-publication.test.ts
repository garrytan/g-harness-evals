// internal-task phase 3: custody material lives on refs/heads/custody only, so nothing bound for main may hold it.
//
// Value: protects=scripts/check-sealed-publication.ts refuses *.age files, age identities, the access log, raw sealed
// receipts and a sealed set's released files in any tree main could receive, naming the path and kind but never the text,
// and passes the repository as it stands (so CI on every pull request to main enforces it); fails_when=a sealed bundle,
// the escrow, an identity or a raw receipt can reach main, or the check prints what it found; why_new=the custody branch
// is new; seam=the CLI on a throwaway repository and the function on this checkout; no_claim=gstack-pregate's own guard
// (.gstack/pregate.json "sealed" refuses the same paths and identities before a push, visibility forced to public).
import { afterAll, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateX25519Identity } from 'age-encryption';
import { publicationFindings } from '../scripts/check-sealed-publication.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-publication-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('this checkout holds no custody material', () => {
  expect(publicationFindings(ROOT)).toEqual([]);
}, 180_000);

// Value: protects=a git command the check runs that is killed or cannot start stops the check (exit 2) instead of passing
// a tree whose identity scan never finished or reporting a manifest it never read as one that does not parse;
// fails_when=publicationFindings reads a killed git grep as "no identity" or a killed read as an unreadable manifest;
// why_new=bun test kills every child process of a test that ran past its timeout, and CI's whole-checkout case then
// reported 258 v0.1 task files as released content of a set whose MANIFEST.json "could not be read"; seam=the CLI with
// a git on PATH that kills itself when its arguments name one subcommand or file; no_claim=how long the whole-checkout scan takes.
test('a git command killed partway stops the check instead of passing it or misreading a manifest', async () => {
  const repo = join(tmp, 'killed');
  const w = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  execFileSync('git', ['init', '-q', repo]);
  w('tasks/multiuser/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, status: 'retired', released: { world_slice_sha256: 'c'.repeat(64) } }));
  w('tasks/multiuser/heldout/t1/task.toml', 'id = "t1"');
  w('notes/key.txt', `${await generateX25519Identity()}\n`);
  w('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: 'd'.repeat(64), heldout_corpus_sha256: 'd'.repeat(64) }, status: 'open' }));
  w('docs/benchmarks/run9/prereg.json', JSON.stringify({ run_id: 'run9', heldout: { set: 'v9' } }));
  w('docs/benchmarks/run9/results/trials.jsonl', '{}');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=publication-test@example.invalid', '-c', 'user.name=publication test', 'commit', '-qm', 'planted'], { cwd: repo });
  const bin = join(tmp, 'killing-git');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$*" in *"$KILL_GIT"*) kill -KILL $$;; esac\nPATH="\${PATH#*:}" exec '${Bun.which('git')}' "$@"\n`, { mode: 0o755 });
  const check = (kill: string, ref?: string) => spawnSync('bun', [join(ROOT, 'scripts', 'check-sealed-publication.ts'), '--repo', repo, ...(ref ? ['--ref', ref] : [])], {
    encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: tmp, KILL_GIT: kill },
  });
  const intact = check('none');
  expect(intact.status).toBe(1);
  expect(intact.stderr).toContain('HE-SEALED-011 notes/key.txt: an age identity');
  expect(intact.stderr).toContain('HE-SEALED-011 docs/benchmarks/run9/results/trials.jsonl: a raw receipt of a run on set v9');
  for (const [kill, ref, cmd] of [['grep', undefined, 'grep'], ['grep', 'HEAD', 'grep'], ['cat-file', 'HEAD', 'cat-file'], ['prereg.json', 'HEAD', 'cat-file']] as const) {
    const r = check(kill, ref);
    expect({ kill, ref, status: r.status }).toEqual({ kill, ref, status: 2 });
    expect(r.stderr).toContain(`HE-SEALED-011 check-sealed-publication could not run: git ${cmd} was killed by SIGKILL`);
  }
});

// Value: protects=a preregistration or run manifest the check cannot read counts as one that opens a set in sealed custody,
// so the run's raw results stay refused (fail closed, like an unreadable MANIFEST.json); fails_when=an unreadable
// prereg.json or results/manifest.json is read as an empty one and the tree passes; why_new=the reviews on #382 found both
// reads fell back to '{}'; seam=the CLI on a throwaway repository, with the files missing from the work tree and, in
// commit mode, listed by the tree as entries git cat-file cannot read as blobs; no_claim=why a file is unreadable.
test('a preregistration or run manifest the check cannot read keeps the results of its run refused', () => {
  const repo = join(tmp, 'unreadable');
  const w = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=publication-test@example.invalid', '-c', 'user.name=publication test', ...args], { cwd: repo, encoding: 'utf8' });
  execFileSync('git', ['init', '-q', repo]);
  w('docs/benchmarks/run7/results/trials.jsonl', '{}');
  w('docs/benchmarks/run8/results/trials.jsonl', '{}');
  git('add', '-A');
  const gitlink = git('commit-tree', git('write-tree').trim(), '-m', 'stand-in').trim();
  for (const p of ['docs/benchmarks/run7/prereg.json', 'docs/benchmarks/run8/results/manifest.json']) git('update-index', '--add', '--cacheinfo', `160000,${gitlink},${p}`);
  git('commit', '-qm', 'planted');
  const check = (ref?: string) => spawnSync('bun', [join(ROOT, 'scripts', 'check-sealed-publication.ts'), '--repo', repo, ...(ref ? ['--ref', ref] : [])], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp } });
  for (const ref of [undefined, 'HEAD']) {
    const r = check(ref);
    expect({ ref, status: r.status }).toEqual({ ref, status: 1 });
    expect(r.stderr).toContain('HE-SEALED-011 docs/benchmarks/run7/results/trials.jsonl: a raw receipt of a run whose prereg.json could not be read, so it counts as opening a set in sealed custody');
    expect(r.stderr).toContain('HE-SEALED-011 docs/benchmarks/run8/results/manifest.json: a run manifest that could not be read, so it counts as raw sealed receipts of a set in sealed custody');
    expect(r.stderr).not.toContain('docs/benchmarks/run8/results/trials.jsonl');
  }
});

test('released content and raw receipts of a set stay refused while a live sealed set shares its world slice or corpus', () => {
  const repo = join(tmp, 'shared');
  const w = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  execFileSync('git', ['init', '-q', repo]);
  const slice = 'a'.repeat(64);
  w('tasks/multiuser/v8/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, status: 'retired', released: { world_slice_sha256: slice } }));
  w('tasks/multiuser/v8/sealed-world/slice.json', '{}');
  w('docs/benchmarks/run8/prereg.json', JSON.stringify({ run_id: 'run8', heldout: { set: 'v8' } }));
  w('docs/benchmarks/run8/results/trials.jsonl', '{}');
  w('docs/benchmarks/run8b/results/manifest.json', JSON.stringify({ sealed: { set: 'v8' } }));
  const successor = (status: string) => w('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: slice, heldout_corpus_sha256: slice }, status }));
  successor('open');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const shared = 'whose world slice or corpus set v9 shares while still in sealed custody';
  expect(publicationFindings(repo)).toEqual([
    { path: 'docs/benchmarks/run8/results/trials.jsonl', kind: `a raw receipt of a run on set v8, ${shared} (only sealed-results/ is published until release)` },
    { path: 'docs/benchmarks/run8b/results/manifest.json', kind: `raw sealed receipts of set v8, ${shared}` },
    { path: 'tasks/multiuser/v8/sealed-world/slice.json', kind: `released content of set v8, ${shared}` },
  ]);
  successor('retired');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  expect(publicationFindings(repo)).toEqual([]);
});

test('the default set v0.1 at tasks/multiuser/heldout/ gets the same shared-set protection', () => {
  const repo = join(tmp, 'default');
  const w = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  execFileSync('git', ['init', '-q', repo]);
  const slice = 'b'.repeat(64);
  w('tasks/multiuser/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, status: 'retired', released: { world_slice_sha256: slice } }));
  w('tasks/multiuser/heldout/t1/task.toml', 'id = "t1"');
  w('docs/benchmarks/run1/prereg.json', JSON.stringify({ run_id: 'run1', heldout: { set: 'v0.1' } }));
  w('docs/benchmarks/run1/results/trials.jsonl', '{}');
  const successor = (status: string) => w('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: slice, heldout_corpus_sha256: slice }, status }));
  successor('open');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const shared = 'whose world slice or corpus set v9 shares while still in sealed custody';
  expect(publicationFindings(repo)).toEqual([
    { path: 'docs/benchmarks/run1/results/trials.jsonl', kind: `a raw receipt of a run on set v0.1, ${shared} (only sealed-results/ is published until release)` },
    { path: 'tasks/multiuser/heldout/t1/task.toml', kind: `released content of set v0.1, ${shared}` },
  ]);
  successor('retired');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  expect(publicationFindings(repo)).toEqual([]);
});

test('the check refuses ciphertext, an identity, the access log, raw sealed receipts and released files of a sealed set, without printing them', async () => {
  const repo = join(tmp, 'repo');
  const w = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  execFileSync('git', ['init', '-q', repo]);
  const identity = await generateX25519Identity();
  w('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: 'e'.repeat(64), heldout_corpus_sha256: 'e'.repeat(64) } }));
  w('tasks/multiuser/v1/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1 }));
  w('docs/benchmarks/r1/sealed-results/export.json', '{}');
  w('docs/benchmarks/r1/sealed-results/opening-receipt.json', '{}');
  w('docs/benchmarks/r1/sealed-results/README.md', 'ok');
  w('docs/benchmarks/plain/results/manifest.json', JSON.stringify({ run_id: 'plain' }));
  w('docs/benchmarks/released/results/manifest.json', JSON.stringify({ run_id: 'r0', sealed: { set: 'v1' } }));
  w('docs/benchmarks/p2/prereg.json', JSON.stringify({ heldout: { set: 'v1' } }));
  w('docs/benchmarks/p2/results/trials.jsonl', '{}\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const clean = spawnSync('bun', [join(ROOT, 'scripts', 'check-sealed-publication.ts'), '--repo', repo], { encoding: 'utf8' });
  expect(clean.status, clean.stderr).toBe(0);

  w('v9/bundle.tar.age', 'age-encryption.org/v1\n-> X25519 x\n');
  w('escrow/identity.age', 'age-encryption.org/v1\n-> scrypt x 18\n');
  w('notes/key.txt', `# created\n${identity}\n`);
  w('custody/access-log.jsonl', '{}\n');
  w('docs/benchmarks/r1/sealed-results/trials.jsonl', '{}\n');
  w('docs/benchmarks/r1/results/manifest.json', JSON.stringify({ run_id: 'r1', sealed: { set: 'v9' } }));
  w('tasks/multiuser/v9/heldout/t1/task.toml', 'id = "t1"');
  w('tasks/multiuser/v9/sealed-world/slice.json', '{}');
  // a file git treats as binary (one NUL byte) still gets its identity found
  w('notes/ledger.bin', `\0binary\n${identity}\n`);
  // any results file of a run whose preregistration opens a still-sealed set
  w('docs/benchmarks/r2/prereg.json', JSON.stringify({ heldout: { set: 'v9' } }));
  w('docs/benchmarks/r2/results/trials.jsonl', '{}\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const kinds = Object.fromEntries(publicationFindings(repo).map((f) => [f.path, f.kind.split(' (')[0]]));
  expect(kinds).toEqual({
    'notes/key.txt': 'an age identity',
    'notes/ledger.bin': 'an age identity',
    'docs/benchmarks/r2/results/trials.jsonl': 'a raw receipt of a run on set v9, which is still in sealed custody',
    'v9/bundle.tar.age': 'age ciphertext',
    'escrow/identity.age': 'age ciphertext',
    'custody/access-log.jsonl': 'the custody access log',
    'docs/benchmarks/r1/sealed-results/trials.jsonl': 'a raw sealed receipt',
    'docs/benchmarks/r1/results/manifest.json': 'raw sealed receipts of set v9, which is still in sealed custody',
    'tasks/multiuser/v9/heldout/t1/task.toml': 'released content of set v9, which is still in sealed custody',
    'tasks/multiuser/v9/sealed-world/slice.json': 'released content of set v9, which is still in sealed custody',
  });
  const cli = spawnSync('bun', [join(ROOT, 'scripts', 'check-sealed-publication.ts'), '--repo', repo], { encoding: 'utf8' });
  expect(cli.status).toBe(1);
  expect(cli.stderr).toContain('HE-SEALED-011 notes/key.txt: an age identity');
  expect(cli.stdout + cli.stderr).not.toContain(identity);
  // the same findings on a commit, as a pull request's head would be checked
  execFileSync('git', ['config', 'user.email', 'publication-test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'publication test'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'planted'], { cwd: repo });
  expect(publicationFindings(repo, 'HEAD').length).toBe(10);
  expect(readFileSync(join(repo, 'notes', 'key.txt'), 'utf8')).toContain(identity);
});
