#!/usr/bin/env bun
/**
 * Remove every plaintext copy of a sealed opening once its encrypted export has landed (internal-task phase 3,
 * docs/sealed-custody.md, "After the export").
 *
 *   bun scripts/sealed/cleanup.ts --export docs/benchmarks/<run>/sealed-results/export.json --sealed-root <opened root>
 *        --results <raw results dir> [--results <shard or merged results dir> ...] [--images] [--custody <clone>]
 *        [--repo .] [--remote origin]
 *
 * First it proves the public export is complete and in place: --export must be <dir of the preregistration>/sealed-results/
 * export.json under docs/benchmarks/ (where export.ts writes it), outside the opened root and every --results directory,
 * with README.md and opening-receipt.json beside it, the receipt's sha256 equal to export.json's receipt_sha256 and its
 * run the export's (export.ts copies export.json last, so a partial copy lacks one of the other two). Then it proves the
 * encrypted copy exists: the custody clone is synced to refs/heads/custody, and under the clone's lock the raw results
 * bundle the export names is there with the export's results_bundle_sha256 and the access log has the run's "exported"
 * line with the same digest. Then it checks that export.json, opening-receipt.json and README.md are committed as they
 * stand (git ls-files, git diff HEAD) in a commit on a remote-tracking branch, since the export-pending/ copy under the
 * results goes too. Otherwise nothing is
 * removed (HE-SEALED-014). Then it removes the opened root (only a
 * directory holding this run's opening-receipt.json), every --results directory (raw shard results, the merged results and the custody logs
 * export.ts wrote into them; each must be outside every git work tree, hold a manifest.json, trials.jsonl, shard.json or
 * shard-vm.json, and name this run: every run id it can read, from manifest.json's run_id, the run part of the first
 * trial_id in trials.jsonl and the run_id of shard.json or shard-vm.json, must be the export's, and at least one must be
 * readable), and with --images every local docker image labelled harness-eval.sealed=true plus the docker build cache,
 * which holds the sealed build contexts. A --results directory named results whose parent holds shard-vm.json or lane.log
 * is a Ubicloud lane's <dest>/results (scripts/ubicloud/run-shard.sh): the lane's plaintext copies beside it go too
 * (run-shard.log, run.stdout.log, run.log and vm-shard.out, which the poll loop and teardown copy there, sealed-upload.log,
 * the diagnostics of the sealed root's upload, and smoke/, the smoke's results), while shard-vm.json, lane.log and
 * cleanup-pending, the VM bookkeeping, stay. A sealed-root-copy.path in a --results directory or a directory directly under
 * it (scripts/run-shard.sh writes one line per launch or resume, the directory holding the shard's private copy of the root
 * at root/) names copies that may have outlived their shard (a SIGKILL skips the exit handler); each line's directory is
 * removed too when it exists on this machine (a Ubicloud lane's lines name VM paths), is named harness-eval-sealed-shard.*,
 * lies outside every git work tree and holds an opening-receipt.json naming this run (run-shard.sh copies it in before the
 * root; root/opening-receipt.json counts too). A listed copy no readable receipt binds to a run is printed as unresolved
 * and the exit code is 3. Any refusal removes nothing.
 *
 * A --results directory whose shard-vm.json (scripts/ubicloud/run-shard.sh) does not record a confirmed destroy is
 * unresolved VM cleanup: its VM id is printed, the directory is still removed, and the exit is 3 so a later sweep
 * (bash scripts/ubicloud/ubi-runner.sh list --mine, then down <vm>) is not forgotten. Output is counts, paths and VM ids.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { readReceipt, RECEIPT_FILE, sha256 } from '../../runner/heldout/sealed.ts';
import { custodyClone, insideGitTree, readAccessLog, syncCustody, withCustodyLock } from './custody.ts';

export interface CleanupOptions { repo: string; exportJson: string; sealedRoot: string; results: string[]; images?: boolean; custody?: string; remote?: string; docker?: string; log?: (l: string) => void }

const countFiles = (p: string): number => (lstatSync(p).isDirectory() ? readdirSync(p).reduce((n, e) => n + countFiles(join(p, e)), 0) : 1);
/** The plaintext copies a Ubicloud lane keeps beside <dest>/results; shard-vm.json, lane.log and cleanup-pending stay. */
const LANE_PLAINTEXT = ['run-shard.log', 'run.stdout.log', 'run.log', 'vm-shard.out', 'sealed-upload.log', 'smoke'];

/** Every run id a results directory names: manifest.json, the first trial_id of trials.jsonl (the part before /<cell>/),
 *  shard.json, shard-vm.json. */
function runIds(dir: string): string[] {
  const read = (f: string, get: (text: string) => unknown): string[] => { try { const v = get(readFileSync(join(dir, f), 'utf8')); return typeof v === 'string' && v ? [v] : []; } catch { return []; } };
  return [
    ...read('manifest.json', (t) => JSON.parse(t).run_id),
    ...read('trials.jsonl', (t) => { const j = JSON.parse(t.split('\n')[0]!) as { trial_id: string; cell: string }; const k = j.trial_id.indexOf(`/${j.cell}/`); return k > 0 ? j.trial_id.slice(0, k) : undefined; }),
    ...read('shard.json', (t) => JSON.parse(t).run_id),
    ...read('shard-vm.json', (t) => JSON.parse(t).run_id),
  ];
}

export function cleanup(o: CleanupOptions): { removed: string[]; files: number; images: number; unresolvedVms: string[]; unresolvedCopies: string[] } {
  const log = o.log ?? ((l: string) => console.log(l));
  const fail = (msg: string): never => { throw new RunnerError('HE-SEALED-014', msg); };
  const repo = resolve(o.repo), remote = o.remote ?? 'origin';
  const exportPath = resolve(repo, o.exportJson);
  if (!existsSync(exportPath)) fail(`--export ${o.exportJson} does not exist; nothing was removed`);
  const root = resolve(o.sealedRoot);
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const within = (p: string, dir: string) => p === dir || p.startsWith(dir + sep);
  for (const t of [root, ...o.results.map((x) => resolve(x))]) if ([exportPath, real(exportPath)].some((p) => within(p, t) || within(p, real(t)))) fail(`--export ${exportPath} is inside ${t}, which cleanup removes; the export is read from the run's sealed-results directory in the checkout, so nothing was removed`);
  const exp = JSON.parse(readFileSync(exportPath, 'utf8')) as { run_id: string; set: string; receipt_sha256?: string; sealed_results: { repository_path: string; results_bundle_sha256: string } };
  const receiptPath = join(dirname(exportPath), RECEIPT_FILE);
  const missing = [RECEIPT_FILE, 'README.md'].filter((n) => !existsSync(join(dirname(exportPath), n)));
  if (missing.length) fail(`${dirname(exportPath)} has export.json but no ${missing.join(' or ')}, so the public export is not a complete copy; finish it with export.ts first; nothing was removed`);
  if (sha256(readFileSync(receiptPath)) !== exp.receipt_sha256) fail(`${receiptPath} is not the receipt export.json names (receipt_sha256 differs); nothing was removed`);
  const receipt = readReceipt(receiptPath);
  const want = join(repo, dirname(String(receipt.prereg_json)), 'sealed-results', 'export.json');
  if (receipt.run_id !== exp.run_id || exportPath !== want || !/^docs\/benchmarks\/[^/]+\/sealed-results\/export\.json$/.test(relative(repo, want))) fail(`--export ${exportPath} is not the sealed-results/export.json beside the preregistration of ${exp.run_id} (docs/benchmarks/<run>/sealed-results/export.json, where export.ts writes it); nothing was removed`);
  const clone = custodyClone({ dir: o.custody, repo, remote });
  withCustodyLock(clone, () => {
    syncCustody(clone, remote);
    const bundle = join(clone, exp.sealed_results.repository_path);
    if (!existsSync(bundle) || sha256(readFileSync(bundle)) !== exp.sealed_results.results_bundle_sha256) fail(`refs/heads/custody has no ${exp.sealed_results.repository_path} with the export's results_bundle_sha256; the encrypted copy is not proven, so nothing was removed`);
    if (!readAccessLog(clone).some((e) => e.event === 'exported' && e.run_id === exp.run_id && e.results_bundle_sha256 === exp.sealed_results.results_bundle_sha256)) fail(`the access log has no "exported" line for ${exp.run_id} with that digest; nothing was removed`);
  });
  const pub = ['export.json', RECEIPT_FILE, 'README.md'].map((n) => relative(repo, join(dirname(exportPath), n)));
  const committed = spawnSync('git', ['-C', repo, 'ls-files', '--error-unmatch', '--', ...pub], { encoding: 'utf8' }).status === 0 && spawnSync('git', ['-C', repo, 'diff', '--quiet', 'HEAD', '--', ...pub]).status === 0;
  if (!committed) fail(`${dirname(exportPath)} is not committed as it stands (git ls-files, git diff HEAD); commit and push the export first, since cleanup removes export-pending/ under the results, the only other copy; nothing was removed`);
  const last = spawnSync('git', ['-C', repo, 'rev-list', '-1', 'HEAD', '--', ...pub], { encoding: 'utf8' }).stdout.trim();
  if (!spawnSync('git', ['-C', repo, 'branch', '-r', '--contains', last], { encoding: 'utf8' }).stdout.trim()) fail(`the commit holding ${dirname(exportPath)} (${last.slice(0, 12)}) is on no remote-tracking branch; push the export first, since cleanup removes export-pending/ under the results, the only other copy; nothing was removed`);
  const targets: string[] = [];
  if (existsSync(root)) {
    if (!existsSync(join(root, RECEIPT_FILE)) || readReceipt(join(root, RECEIPT_FILE)).run_id !== exp.run_id) fail(`--sealed-root ${root} is not the opened root of ${exp.run_id}; nothing was removed`);
    targets.push(root);
  }
  const unresolvedVms: string[] = [], laneCopies: string[] = [], shardCopies: string[] = [], unresolvedCopies: string[] = [];
  for (const r of o.results.map((x) => resolve(x))) {
    if (!existsSync(r)) continue;
    if (!statSync(r).isDirectory() || insideGitTree(r)) fail(`--results ${r} is not a directory outside every git work tree; nothing was removed`);
    if (!['manifest.json', 'trials.jsonl', 'shard.json', 'shard-vm.json'].some((n) => existsSync(join(r, n)))) fail(`--results ${r} holds no manifest.json, trials.jsonl, shard.json or shard-vm.json, so it is not a results directory; nothing was removed`);
    const ids = runIds(r);
    if (!ids.length) fail(`--results ${r} names no run (no readable run_id in manifest.json, trial_id in the first line of trials.jsonl, or run_id in shard.json or shard-vm.json), so it cannot be bound to ${exp.run_id}; nothing was removed`);
    const others = [...new Set(ids.filter((x) => x !== exp.run_id))];
    if (others.length) fail(`--results ${r} holds the results of run ${others.join(', ')}, not ${exp.run_id}; nothing was removed`);
    for (const f of [join(r, 'shard-vm.json'), join(r, '..', 'shard-vm.json')]) {
      if (!existsSync(f)) continue;
      const vm = JSON.parse(readFileSync(f, 'utf8')) as { vm?: string; cleanup?: string; destroyed_at?: string };
      if (vm.vm && (vm.cleanup !== 'done' || !vm.destroyed_at) && !unresolvedVms.includes(vm.vm)) unresolvedVms.push(vm.vm);
      break;
    }
    targets.push(r);
    for (const d of [r, ...readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(r, e.name)).sort()]) {
      let lines: string[];
      try { lines = readFileSync(join(d, 'sealed-root-copy.path'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); } catch { continue; }
      for (const p of lines) {
        if (!isAbsolute(p) || !basename(p).startsWith('harness-eval-sealed-shard.') || !existsSync(p) || !lstatSync(p).isDirectory() || insideGitTree(p) || shardCopies.includes(p) || unresolvedCopies.includes(p)) continue;
        const runOf = (f: string) => { try { const id: unknown = readReceipt(f).run_id; return typeof id === 'string' && id ? id : null; } catch { return null; } };
        const run = runOf(join(p, RECEIPT_FILE)) ?? runOf(join(p, 'root', RECEIPT_FILE));
        if (run === exp.run_id) shardCopies.push(p);
        else if (run === null) unresolvedCopies.push(p);
      }
    }
    const lane = dirname(r);
    if (basename(r) === 'results' && ['shard-vm.json', 'lane.log'].some((n) => existsSync(join(lane, n)))) for (const n of LANE_PLAINTEXT) if (existsSync(join(lane, n))) laneCopies.push(join(lane, n));
  }
  let files = 0;
  for (const t of new Set([...targets, ...laneCopies, ...shardCopies])) { files += countFiles(t); rmSync(t, { recursive: true, force: true }); }
  let images = 0, pruned = false;
  if (o.images) {
    const docker = o.docker ?? 'docker';
    const ls = spawnSync(docker, ['image', 'ls', '-q', '--filter', 'label=harness-eval.sealed=true'], { encoding: 'utf8' });
    if (ls.error) log('CLEANUP: docker is not installed here, so no sealed image is held here');
    else {
      if (ls.status !== 0) fail('docker image ls failed; the sealed images were not removed');
      const ids = [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter(Boolean))];
      if (ids.length && spawnSync(docker, ['image', 'rm', '-f', ...ids], { stdio: 'ignore' }).status !== 0) fail(`docker image rm failed for ${ids.length} sealed image(s)`);
      if (spawnSync(docker, ['builder', 'prune', '-af'], { stdio: 'ignore' }).status !== 0) fail('docker builder prune failed; the build cache may still hold sealed build contexts');
      images = ids.length;
      pruned = true;
    }
  }
  log(`CLEANUP: ${exp.run_id}: encrypted copy verified on refs/heads/custody; removed ${targets.length} plaintext director${targets.length === 1 ? 'y' : 'ies'}${laneCopies.length ? ` and ${laneCopies.length} Ubicloud lane cop${laneCopies.length === 1 ? 'y' : 'ies'} beside results (${[...new Set(laneCopies.map((p) => dirname(p)))].join(', ')}; shard-vm.json and lane.log kept)` : ''}${shardCopies.length ? ` and ${shardCopies.length} sealed shard cop${shardCopies.length === 1 ? 'y' : 'ies'} of the root a killed shard left (${shardCopies.join(', ')})` : ''} (${files} files)${pruned ? `, ${images} sealed image(s) and the build cache` : ''}`);
  if (unresolvedVms.length) log(`CLEANUP: unresolved VM cleanup: ${unresolvedVms.join(', ')} (no confirmed destroy in shard-vm.json); sweep with bash scripts/ubicloud/ubi-runner.sh list --mine and down <vm>`);
  if (unresolvedCopies.length) log(`CLEANUP: unresolved sealed shard copies: ${unresolvedCopies.join(', ')} (named by sealed-root-copy.path, but no readable opening receipt binds them to a run); inspect and remove them by hand`);
  return { removed: [...targets, ...laneCopies, ...shardCopies], files, images, unresolvedVms, unresolvedCopies };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const results = argv.flatMap((a, i) => (a === '--results' && argv[i + 1] ? [argv[i + 1]!] : []));
  if (!flag('export') || !flag('sealed-root') || !results.length) { console.error('HE-RUN-002 usage: bun scripts/sealed/cleanup.ts --export <export.json> --sealed-root <dir> --results <dir> [--results <dir> ...] [--images] [--custody <clone>] [--repo .] [--remote origin]'); process.exit(2); }
  try {
    const r = cleanup({ repo: flag('repo') ?? process.cwd(), exportJson: flag('export')!, sealedRoot: flag('sealed-root')!, results, images: argv.includes('--images'), custody: flag('custody'), remote: flag('remote') });
    process.exit(r.unresolvedVms.length || r.unresolvedCopies.length ? 3 : 0);
  } catch (e) {
    console.error(e instanceof RunnerError ? e.message : `HE-SEALED-014 cleanup failed: ${e instanceof Error ? e.constructor.name : 'error'} (message withheld)`);
    process.exit(2);
  }
}
