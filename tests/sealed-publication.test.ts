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
}, 60_000);

test('the check refuses ciphertext, an identity, the access log, raw sealed receipts and released files of a sealed set, without printing them', async () => {
  const repo = join(tmp, 'repo');
  const w = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  execFileSync('git', ['init', '-q', repo]);
  const identity = await generateX25519Identity();
  w('tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: {} }));
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
