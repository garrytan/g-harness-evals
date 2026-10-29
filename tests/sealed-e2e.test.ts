// internal-task phase 3, item 24: the sealed pipeline end to end on a synthetic set, offline and keyless. Seal a two-task set
// with a world slice and corpus pages, preregister a confirmatory opening, open it as the custodian, plan and run the
// scripted cells against the sealed root, export in embargo mode, scan every public byte for the sealed strings, then
// remove the plaintext copies once the encrypted export is proven on the custody branch (and refuse, removing nothing, a
// missing export or a --results directory not bound to the run), then retire and release the set and check the released
// files against the public commitments; release refuses, writing nothing, an exported run without export.json, a digest
// that does not hold or a conflicting destination, and a failed "released" push leaves the set sealed for a rerun. The key
// is generated here.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decryptWith, sha256, unpackTar } from '../runner/heldout/sealed.ts';
import { heldoutSet, manifestProblems, readManifest, treeFiles } from '../scripts/seal-heldout.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { readAccessLog } from '../scripts/sealed/custody.ts';
import { exportRun } from '../scripts/sealed/export.ts';
import { releaseSet } from '../scripts/sealed/release.ts';
import { cleanup } from '../scripts/sealed/cleanup.ts';
import { publicationFindings } from '../scripts/check-sealed-publication.ts';
import { candidate, cloneCustody, co, commitPush, git, makeFixture, manifestPath, register, ROOT, SECRETS, SET, type Fixture } from './sealed-fixture.ts';

let f: Fixture | undefined;
afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); });

const TASKS = ['sx-01-vault-ask', 'sx-02-dm-guard'];
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

test('seal, open, run, export under embargo, leak scan, release', async () => {
  f = await makeFixture(2);
  const run = { runId: 'syn-e2e', dir: '2026-11-10-syn-e2e', label: 'confirmatory' as const, candidate: candidate('e2e') };
  register(f, run);
  const prereg = `docs/benchmarks/${run.dir}/prereg.json`;

  // nothing sealed is in the public checkout
  for (const p of filesUnder(f.repo).filter((p) => !p.includes('/.git/'))) {
    const text = readFileSync(p, 'utf8');
    for (const s of [...Object.values(SECRETS), ...TASKS]) expect(`${relative(f.repo, p)}: ${text.includes(s)}`).toBe(`${relative(f.repo, p)}: false`);
  }

  const opened = await openRun({ repo: f.repo, prereg, ...co(f), out: join(f.work, 'root'), log: () => undefined });
  const root = opened.root, receipt = join(root, 'opening-receipt.json');
  const sealedFlags = ['--sealed-root', root, '--opening-receipt', receipt];
  const results = join(f.work, 'results', run.runId);
  const bun = (args: string[]) => spawnSync(process.execPath, args, { cwd: f!.repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });

  const plan = bun([join(ROOT, 'runner', 'run.ts'), 'plan', '--prereg', prereg, '--out', results, ...sealedFlags]);
  expect(plan.stderr).toBe('');
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8'));
  expect(manifest.trials.length).toBe(8);
  expect(manifest.sealed.set).toBe(SET);
  expect(manifest.sealed.receipt_sha256).toBe(sha256(readFileSync(receipt)));
  for (const t of manifest.trials) expect(t.task_dir.startsWith('/')).toBe(false);

  const exec = bun([join(ROOT, 'runner', 'run.ts'), 'run', '--manifest', join(results, 'manifest.json'), '--harness-mode', 'scripted', ...sealedFlags]);
  expect(exec.status, exec.stderr + exec.stdout).toBe(0);
  const trials = readFileSync(join(results, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(trials.length).toBe(8);
  expect(new Set(trials.map((t) => t.task))).toEqual(new Set(TASKS));

  // the raw results need the root to summarize; without it the family is never silently "unknown"
  expect(bun([join(ROOT, 'scripts', 'summarize-run.ts'), '--results', results]).stderr).toContain('HE-SEALED-001');

  const exportClone = cloneCustody(f, 'custody-export');
  const { out, export: exp } = await exportRun({ repo: f.repo, results, sealedRoot: root, receipt, custody: exportClone, gh: f.gh, log: () => undefined });
  expect(relative(f.repo, out)).toBe(`docs/benchmarks/${run.dir}/sealed-results`);
  expect(exp.mode).toBe('embargo');
  expect(exp.cells).toBeUndefined();
  expect(exp.per_task).toBeUndefined();
  expect((exp.decisions as Array<Record<string, unknown>>).map((d) => Object.keys(d).sort())).toEqual([['claim', 'decision', 'sentence'], ['claim', 'decision', 'sentence']]);
  // identical cells: no superiority, and noninferiority within ten points through compare-run --margin, in one Holm family
  expect((exp.decisions as Array<{ claim: string; decision: string }>).map((d) => [d.claim, d.decision])).toEqual([['C1', 'reject'], ['C2', 'accept']]);
  const comparisons = JSON.parse(readFileSync(join(results, 'comparisons.json'), 'utf8')) as { comparisons: Array<{ a?: string; b?: string; delta: number; ci95: [number, number]; noninferiority?: { margin: number; direction: string; p: number } }> };
  expect(comparisons.comparisons[0]!.noninferiority).toMatchObject({ margin: 0.1, direction: 'higher' });
  expect(readdirSync(out).sort()).toEqual(['README.md', 'export.json', 'opening-receipt.json']);

  // the leak scan, done again here over every public byte the export wrote
  for (const p of filesUnder(out)) {
    const text = readFileSync(p, 'utf8');
    for (const s of [...Object.values(SECRETS), ...TASKS, 'syn-vault', 'Quoll']) expect(`${relative(f.repo, p)} holds ${s}: ${text.includes(s)}`).toBe(`${relative(f.repo, p)} holds ${s}: false`);
  }
  // under the embargo a decision sentence is the bit and the preregistered wording: no estimate, interval or Holm p in any
  // serialized public file, and none of the estimate's digits
  expect((exp.decisions as Array<{ sentence: string }>).map((d) => d.sentence)).toEqual(['C1: rejected. The candidate cell passes more often than the base cell.', 'C2: accepted. The candidate cell passes no less often than the base cell, within ten points.']);
  const claimed = comparisons.comparisons.find((c) => c.a === 'base' && c.b === 'cand')!;
  const pts = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;
  for (const p of filesUnder(out)) {
    const text = readFileSync(p, 'utf8');
    expect(`${relative(f.repo, p)}: ${/estimate|interval|holm/i.test(text)}`).toBe(`${relative(f.repo, p)}: false`);
    for (const s of [claimed.delta, ...claimed.ci95].map(pts)) expect(`${relative(f.repo, p)} holds ${s}: ${text.includes(s)}`).toBe(`${relative(f.repo, p)} holds ${s}: false`);
  }

  // the raw results are sealed in custody and decrypt to the run's trials.jsonl
  const log = readAccessLog(cloneCustody(f, 'custody-check'));
  expect(log.map((e) => e.event)).toEqual(['sealed', 'opened', 'exported']);
  const sealedResults = exp.sealed_results as { repository_path: string; trials_jsonl_sha256: string; results_bundle_sha256: string };
  const bundle = readFileSync(join(cloneCustody(f, 'custody-check-2'), sealedResults.repository_path));
  const raw = unpackTar(gunzipSync(await decryptWith(f.identity, new Uint8Array(bundle))));
  expect(sha256(raw.find((e) => e.path === 'trials.jsonl')!.data)).toBe(sealedResults.trials_jsonl_sha256);
  expect(sealedResults.trials_jsonl_sha256).toBe(sha256(readFileSync(join(results, 'trials.jsonl'))));

  // cleanup refuses an export that was never committed: it removes export-pending/, the only other copy
  expect(() => cleanup({ repo: f!.repo, exportJson: join(out, 'export.json'), sealedRoot: root, results: [results], custody: exportClone, log: () => undefined })).toThrow(/HE-SEALED-014 \S+\/sealed-results is not committed as it stands .*nothing was removed$/);
  commitPush(f, 'sealed export of syn-e2e');
  expect(manifestProblems(heldoutSet(SET, f.repo))).toEqual([]);
  // main holds only the three public export files: no ciphertext, no identity, no raw receipt
  expect(publicationFindings(f.repo, 'origin/main')).toEqual([]);

  // cleanup removes nothing until the encrypted copy is proven, then every plaintext copy
  const shardDir = join(f.work, 'results', 'shard-1');
  spawnSync('cp', ['-r', results, shardDir]);
  writeFileSync(join(f.work, 'results', 'shard-vm.json'), JSON.stringify({ vm: 'vm-unresolved', cleanup: 'pending' }));
  const exportBytes = readFileSync(join(out, 'export.json'));
  writeFileSync(join(out, 'export.json'), JSON.stringify({ ...exp, sealed_results: { ...sealedResults, results_bundle_sha256: '0'.repeat(64) } }));
  expect(() => cleanup({ repo: f!.repo, exportJson: join(out, 'export.json'), sealedRoot: root, results: [results], custody: exportClone, log: () => undefined })).toThrow(/HE-SEALED-014 refs\/heads\/custody has no .*the encrypted copy is not proven, so nothing was removed/);
  writeFileSync(join(out, 'export.json'), exportBytes);
  // an export not committed as it stands is refused: cleanup removes export-pending/, the only other copy
  const readme = readFileSync(join(out, 'README.md'));
  writeFileSync(join(out, 'README.md'), 'edited after the commit\n');
  expect(() => cleanup({ repo: f!.repo, exportJson: join(out, 'export.json'), sealedRoot: root, results: [results], custody: exportClone, log: () => undefined })).toThrow(/HE-SEALED-014 \S+\/sealed-results is not committed as it stands .*nothing was removed$/);
  writeFileSync(join(out, 'README.md'), readme);
  expect(existsSync(root) && existsSync(results)).toBe(true);
  // a missing --export, a directory with no results marker, another run's results and a directory naming no run are each
  // refused before anything is removed
  const refusedCleanup = (exportJson: string, extra: string[]) => {
    try { cleanup({ repo: f!.repo, exportJson, sealedRoot: root, results: [results, ...extra], custody: exportClone, log: () => undefined }); return 'no refusal'; } catch (e) { return (e as Error).message; }
  };
  const bad = (name: string, files: Record<string, string>) => { const d = join(f!.work, name); mkdirSync(d, { recursive: true }); for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t); return d; };
  const noMarker = bad('no-marker', { 'notes.txt': 'not a results directory\n' });
  const otherManifest = bad('other-manifest', { 'manifest.json': JSON.stringify({ run_id: 'syn-other' }) });
  const otherTrials = bad('other-trials', { 'trials.jsonl': JSON.stringify({ trial_id: 'syn-other/base/x/r1', cell: 'base' }) + '\n' });
  const noRunId = bad('no-run-id', { 'manifest.json': '{"run_id": not json', 'shard.json': JSON.stringify({ name: 's1' }) });
  expect(refusedCleanup(join(f.work, 'no-such', 'export.json'), [])).toMatch(/^HE-SEALED-014 --export .*no-such\/export\.json does not exist; nothing was removed$/);
  expect(refusedCleanup(join(out, 'export.json'), [noMarker])).toMatch(/^HE-SEALED-014 --results .*no-marker holds no manifest\.json, trials\.jsonl, shard\.json or shard-vm\.json, so it is not a results directory; nothing was removed$/);
  expect(refusedCleanup(join(out, 'export.json'), [otherManifest])).toMatch(/^HE-SEALED-014 --results .*other-manifest holds the results of run syn-other, not syn-e2e; nothing was removed$/);
  expect(refusedCleanup(join(out, 'export.json'), [otherTrials])).toMatch(/^HE-SEALED-014 --results .*other-trials holds the results of run syn-other, not syn-e2e; nothing was removed$/);
  expect(refusedCleanup(join(out, 'export.json'), [noRunId])).toMatch(/^HE-SEALED-014 --results .*no-run-id names no run .*so it cannot be bound to syn-e2e; nothing was removed$/);
  expect([root, results, noMarker, otherManifest, otherTrials, noRunId].map((d) => existsSync(d))).toEqual([true, true, true, true, true, true]);
  for (const d of [noMarker, otherManifest, otherTrials, noRunId]) rmSync(d, { recursive: true });
  // a Ubicloud lane's <dest>/results: the plaintext copies beside it go, the VM bookkeeping stays
  const lane = join(f.work, 'lane-s1'), laneResults = join(lane, 'results');
  mkdirSync(lane);
  spawnSync('cp', ['-r', results, laneResults]);
  writeFileSync(join(lane, 'shard-vm.json'), JSON.stringify({ vm: 'vm-done', cleanup: 'done', destroyed_at: '2026-11-10T00:00:00Z', run_id: run.runId }));
  for (const n of ['lane.log', 'run-shard.log', 'run.stdout.log', 'run.log', 'vm-shard.out', 'sealed-upload.log']) writeFileSync(join(lane, n), `${n}\n`);
  mkdirSync(join(lane, 'smoke', 'results'), { recursive: true });
  writeFileSync(join(lane, 'smoke', 'results', 'run.log'), 'smoke\n');
  const lines: string[] = [];
  const cleaned = cleanup({ repo: f.repo, exportJson: join(out, 'export.json'), sealedRoot: root, results: [results, shardDir, laneResults], custody: exportClone, log: (l) => lines.push(l) });
  expect(cleaned.removed).toEqual([root, results, shardDir, laneResults, ...['run-shard.log', 'run.stdout.log', 'run.log', 'vm-shard.out', 'sealed-upload.log', 'smoke'].map((n) => join(lane, n))]);
  expect(cleaned.unresolvedVms).toEqual(['vm-unresolved']);
  expect(existsSync(root) || existsSync(results) || existsSync(shardDir)).toBe(false);
  expect(readdirSync(lane).sort()).toEqual(['lane.log', 'shard-vm.json']);
  expect(lines[0]).toContain(`and 6 Ubicloud lane copies beside results (${lane}; shard-vm.json and lane.log kept)`);
  for (const s of [...Object.values(SECRETS), ...TASKS]) expect(lines.join('\n')).not.toContain(s);

  // release refuses, writing nothing, while an exported run has no export.json, while a committed digest does not hold,
  // and while a destination exists with other bytes or under a link
  const relOpts = { repo: f.repo, set: SET, ...co(f), custody: cloneCustody(f, 'custody-release'), log: () => undefined };
  const status = () => git(f!.repo, 'status', '--porcelain', '--untracked-files=all');
  const refusedRelease = async () => { const before = status(); const msg = await releaseSet(relOpts).then(() => 'no refusal', (e: Error) => e.message); expect(status()).toBe(before); return msg; };
  const parked = join(f.tmp, 'parked-export');
  renameSync(out, parked);
  expect(await refusedRelease()).toMatch(/^HE-SEALED-008 the access log has an "exported" line for 1 run\(s\) of set vsyn with no docs\/benchmarks\/\*\/sealed-results\/export\.json \(syn-e2e\);.* Nothing was written$/);
  renameSync(parked, out);
  const manifestBytes = readFileSync(manifestPath(f));
  writeFileSync(manifestPath(f), JSON.stringify({ ...JSON.parse(manifestBytes.toString('utf8')), tree_sha256: 'f'.repeat(64) }, null, 2) + '\n');
  expect(await refusedRelease()).toMatch(/^HE-SEALED-008 the bundle's task tree has digest [0-9a-f]{12}, the manifest committed f{12}; nothing was written$/);
  writeFileSync(manifestPath(f), manifestBytes);
  const plantedTrials = join(f.repo, 'docs', 'benchmarks', run.dir, 'results', 'trials.jsonl');
  mkdirSync(join(plantedTrials, '..'), { recursive: true });
  writeFileSync(plantedTrials, 'not the sealed trials\n');
  expect(await refusedRelease()).toMatch(/^HE-SEALED-008 1 destination\(s\) in the public checkout already exist .*\(path sha256 [0-9a-f]{12}\); release writes only new files or identical ones, so nothing was written$/);
  rmSync(join(plantedTrials, '..'), { recursive: true });
  const elsewhere = join(f.tmp, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(f.repo, 'tasks', 'multiuser', SET, 'sealed-world'));
  expect(await refusedRelease()).toMatch(/^HE-SEALED-008 \d+ destination\(s\) in the public checkout already exist as a link/);
  expect(readdirSync(elsewhere)).toEqual([]);
  rmSync(join(f.repo, 'tasks', 'multiuser', SET, 'sealed-world'));
  expect(status()).toBe('');

  // a rejected "released" push leaves the manifest sealed; once the remote takes pushes again, a rerun finishes the release.
  // A part file left as a link to an unrelated file is replaced, and the unrelated file keeps its bytes.
  const unrelated = join(f.tmp, 'unrelated.txt');
  writeFileSync(unrelated, 'unrelated bytes\n');
  const releasedTrials = join(f.repo, 'docs', 'benchmarks', run.dir, 'results', 'trials.jsonl');
  mkdirSync(join(releasedTrials, '..'), { recursive: true });
  symlinkSync(unrelated, releasedTrials + '.release-part');
  const hook = join(f.bare, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/usr/bin/env bash\nwhile read -r old new ref; do [ "$ref" = refs/heads/custody ] && { echo "custody push refused by the test hook" >&2; exit 1; }; done\nexit 0\n');
  chmodSync(hook, 0o755);
  const pushFailed = await releaseSet(relOpts).then(() => 'no refusal', (e: Error) => e.message);
  expect(pushFailed).toMatch(/^HE-SEALED-006 the push to origin refs\/heads\/custody was rejected 5 times .*the manifest is left sealed; rerun the release$/);
  expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBe('sealed');
  expect(readFileSync(manifestPath(f)).equals(manifestBytes)).toBe(true);
  expect(readFileSync(unrelated, 'utf8')).toBe('unrelated bytes\n');
  expect([lstatSync(releasedTrials).isFile(), lstatSync(releasedTrials + '.release-part', { throwIfNoEntry: false })]).toEqual([true, undefined]);
  rmSync(hook);

  // retire and release: the files written match the commitments published at sealing
  const before = readManifest(heldoutSet(SET, f.repo))!;
  const rel = await releaseSet(relOpts);
  expect(rel).toEqual({ runs: ['syn-e2e'], tasks: 2 });
  const after = readManifest(heldoutSet(SET, f.repo))!;
  expect(after.custody).toBeUndefined();
  expect(after.tasks.sort()).toEqual(TASKS);
  expect(after.tree_sha256).toBe(before.tree_sha256);
  expect(treeFiles(heldoutSet(SET, f.repo).dir, heldoutSet(SET, f.repo).manifest).tree_sha256).toBe(before.tree_sha256);
  expect((after as unknown as { status?: string }).status).toBe('retired');
  expect(sha256(readFileSync(join(f.repo, 'docs', 'benchmarks', run.dir, 'results', 'trials.jsonl')))).toBe(sealedResults.trials_jsonl_sha256);
  expect(sha256(readFileSync(join(f.repo, 'tasks', 'multiuser', SET, 'sealed-world', 'slice.json')))).toBe(before.sealed!.world_slice_sha256);
  expect(statSync(join(f.repo, 'tasks', 'multiuser', SET, 'heldout', TASKS[1]!, 'task.toml')).isFile()).toBe(true);
  expect(readAccessLog(cloneCustody(f, 'custody-final')).map((e) => e.event)).toEqual(['sealed', 'opened', 'exported', 'released']);
  // after release the set is plaintext, so its receipts and files may go to main
  expect(publicationFindings(f.repo)).toEqual([]);
}, 180_000);
