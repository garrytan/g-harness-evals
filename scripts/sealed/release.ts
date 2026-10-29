#!/usr/bin/env bun
/**
 * Retire a sealed set and release it (custodian only; docs/sealed-custody.md).
 *
 *   bun scripts/sealed/release.ts --task-set <set> --retire [--custody <isolated custody clone>] [--identity <drive copy>]
 *        [--repo .] [--remote origin]
 *
 * The identity comes from the drive copy after the escrow check (identity.ts custodyIdentity); the bundles and the access
 * log come from refs/heads/custody through the isolated custody clone (scripts/sealed/custody.ts).
 * Decrypts the set's bundle and every raw results bundle its sealed exports name, verifies each against the digests the
 * public files committed (bundle_sha256, tree_sha256, world_slice_sha256, heldout_corpus_sha256 in the set's
 * MANIFEST.json; results_bundle_sha256, raw_tree_sha256 and raw_files in each docs/benchmarks/<run>/sealed-results/
 * export.json; the task tree and corpus digests are computed on the decrypted entries in memory), and only when every
 * digest holds and no destination exists as a link or with other bytes (an identical file is accepted, so a rerun can
 * finish a release) writes into the public checkout:
 *   tasks/multiuser/<set>/heldout/<task>/...         the task tree
 *   tasks/multiuser/<set>/sealed-world/slice.json   the world slice, sealed-world/corpus/heldout/ its corpus pages,
 *                                                   sealed-world/extras/ the files sealed.extras lists (seal.ts --include), and
 *                                                   sealed-world/opaque-salt, which maps the opaque task ids back
 *   docs/benchmarks/<run>/results/                   each run's raw receipts, where every plaintext run keeps them
 * and rewrites the set's MANIFEST.json as a plaintext manifest (files and tasks listed, the same tree_sha256, ledger
 * status "retired", the sealed commitments kept under "released"), so bun scripts/seal-heldout.ts --check checks it as any
 * plaintext set. A "released" line goes to the access log. Nothing is committed in the public repository: the custodian
 * commits the release on a branch and opens its pull request, after which the full per-task numbers can be written from
 * the released receipts. It refuses, before anything is decrypted or written, when the access log has an "opened" line for
 * a run of the set with no "exported" line (a released set takes no export, so that run would never get a decision or an
 * encrypted copy of its raw results: finish and export it first), and when it has an "exported" line for a run of the set
 * that has no docs/benchmarks/<run>/sealed-results/export.json (finish that export first: a rerun of
 * scripts/sealed/export.ts completes it from the files it staged). Every other refusal comes before the first write, so the
 * public checkout is unchanged. Each file is written to <name>.release-part beside it and renamed into place, so a failed
 * write leaves no truncated file (a rerun overwrites the part file). The "released" line is pushed after the files are
 * written and before the manifest turns plaintext, so a failed push leaves the set sealed and a rerun, which accepts the
 * identical files, finishes the release. That push's admission reads the synced access log again and refuses, leaving the
 * manifest sealed, when an "opened" line for a run with no "exported" line, or an "exported" line for a run whose export
 * release did not verify, landed in the meantime.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { bundleEntryProblem, decryptWith, sha256, unpackTar, type TarEntry } from '../../runner/heldout/sealed.ts';
import { heldoutSet, openingsLedger, readManifest, walk, type HeldoutManifest } from '../seal-heldout.ts';
import { compareAndPush, custodyClone, ESCROW_FILE, readAccessLog, syncCustody, type AccessEvent } from './custody.ts';
import { custodyIdentity } from './identity.ts';
import { entriesDigest } from './export.ts';

export interface ReleaseOptions { repo: string; set: string; custody?: string; identityPath?: string; env?: Record<string, string | undefined>; remote?: string; custodian?: string; now?: () => string; log?: (l: string) => void; beforePush?: () => void }

export async function releaseSet(o: ReleaseOptions): Promise<{ runs: string[]; tasks: number }> {
  const repo = resolve(o.repo);
  const log = o.log ?? ((l: string) => console.log(l));
  const now = o.now ?? (() => new Date().toISOString());
  const fail = (msg: string): never => { throw new RunnerError('HE-SEALED-008', msg); };
  const set = heldoutSet(o.set, repo);
  const m = readManifest(set);
  if (m?.custody !== 'sealed' || !m.sealed) return fail(`set ${o.set} is not in sealed custody`);
  const s = m.sealed;
  const remote = o.remote ?? 'origin';
  const clone = custodyClone({ dir: o.custody, repo, remote });
  syncCustody(clone, remote);
  const bench = join(repo, 'docs', 'benchmarks');
  const published = (existsSync(bench) ? readdirSync(bench).sort() : []).map((d) => ({ d, p: join(bench, d, 'sealed-results', 'export.json') })).filter((x) => existsSync(x.p))
    .map((x) => ({ ...x, exp: JSON.parse(readFileSync(x.p, 'utf8')) })).filter((x) => x.exp.set === o.set);
  const logged = readAccessLog(clone).filter((e) => e.set === o.set);
  /** Runs of the set with an "opened" line and no "exported" line: releasing would leave each without a decision and
   *  without the encrypted copy of its raw results that cleanup.ts needs before it removes the plaintext. */
  const unexported = (log: AccessEvent[]) => { const done = new Set(log.filter((e) => e.event === 'exported').map((e) => e.run_id)); return [...new Set(log.filter((e) => e.event === 'opened' && !done.has(e.run_id)).map((e) => e.run_id))]; };
  const stranded = unexported(logged);
  if (stranded.length) fail(`the access log has an "opened" line and no "exported" line for ${stranded.length} run(s) of set ${o.set} (${stranded.join(', ')}); a released set takes no export, so releasing now would leave each run without a decision and without an encrypted copy of its raw results. Finish and export each run first. Nothing was decrypted or written`);
  const unpublished = [...new Set(logged.filter((e) => e.event === 'exported').map((e) => e.run_id))].filter((r) => !published.some((x) => x.exp.run_id === r));
  if (unpublished.length) fail(`the access log has an "exported" line for ${unpublished.length} run(s) of set ${o.set} with no docs/benchmarks/*/sealed-results/export.json (${unpublished.join(', ')}); release finds raw results only through export.json, so finish each export first (a rerun of scripts/sealed/export.ts completes it from the files it staged). Nothing was written`);
  const bundle = readFileSync(join(clone, s.bundle));
  if (sha256(bundle) !== s.bundle_sha256) fail(`${s.bundle} does not have the committed bundle_sha256`);
  const identity = await custodyIdentity({ identityPath: o.identityPath, escrowPath: join(clone, ESCROW_FILE), recipient: s.recipient, env: o.env });
  const entries = unpackTar(await decryptWith(identity, new Uint8Array(bundle)));
  const prefix = `tasks/multiuser/${o.set}/heldout/`;
  const problem = bundleEntryProblem(entries, o.set, s.extras);
  if (problem) fail(`${problem}; nothing was written`);
  const staged = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.path.startsWith(prefix)) staged.set(join(repo, e.path), e.data);
    else if (e.path === 'world/slice.json') staged.set(join(repo, 'tasks', 'multiuser', o.set, 'sealed-world', 'slice.json'), e.data);
    else staged.set(join(repo, 'tasks', 'multiuser', o.set, 'sealed-world', e.path), e.data);
  }
  const sliceBytes = entries.find((e) => e.path === 'world/slice.json')?.data;
  if (!sliceBytes || sha256(sliceBytes) !== s.world_slice_sha256) fail('the bundle\'s world/slice.json does not have the committed world_slice_sha256');
  // The digests seal-heldout.ts treeFiles and sealed.ts corpusDigest compute on disk, computed here on the decrypted entries:
  // the task tree in walk order (names compared with localeCompare level by level), the corpus pages in byte order.
  const walkOrder = (a: string, b: string) => { const x = a.split('/'), y = b.split('/'); const i = x.findIndex((seg, k) => seg !== y[k]); return i < 0 ? x.length - y.length : x[i]!.localeCompare(y[i] ?? ''); };
  const files: Record<string, string> = Object.fromEntries(entries.filter((e) => e.path.startsWith(prefix)).map((e) => [e.path.slice(prefix.length), sha256(e.data)] as const).sort((a, b) => walkOrder(a[0], b[0])));
  const treeSha = sha256(Object.entries(files).map(([k, v]) => `${v}  ${k}`).join('\n'));
  if (treeSha !== m.tree_sha256) fail(`the bundle's task tree has digest ${treeSha.slice(0, 12)}, the manifest committed ${m.tree_sha256.slice(0, 12)}; nothing was written`);
  const corpus = entries.filter((e) => e.path.startsWith('corpus/')).map((e) => [e.path.slice('corpus/'.length), sha256(e.data)] as const).sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  if (sha256(corpus.map(([r, h]) => `${h}  ${r}\n`).join('')) !== s.heldout_corpus_sha256) fail('the bundle\'s corpus pages do not have the committed heldout_corpus_sha256; nothing was written');

  const exports: Array<{ dir: string; run_id: string; exp: { sealed_results: { repository_path: string; results_bundle_sha256: string; raw_tree_sha256: string; raw_files: Record<string, string> } }; entries: TarEntry[] }> = [];
  for (const { d, p, exp } of published) {
    const rb = readFileSync(join(clone, exp.sealed_results.repository_path));
    if (sha256(rb) !== exp.sealed_results.results_bundle_sha256) fail(`${exp.sealed_results.repository_path} does not have the results_bundle_sha256 that ${relative(repo, p)} committed`);
    const es = unpackTar(gunzipSync(await decryptWith(identity, new Uint8Array(rb))));
    if (entriesDigest(es) !== exp.sealed_results.raw_tree_sha256) fail(`the raw results of ${exp.run_id} do not have the committed raw_tree_sha256`);
    for (const [f, h] of Object.entries(exp.sealed_results.raw_files as Record<string, string>)) if (sha256(es.find((e) => e.path === f)?.data ?? new Uint8Array()) !== h) fail(`${exp.run_id}: ${f} does not have the committed sha256`);
    exports.push({ dir: d, run_id: exp.run_id, exp, entries: es });
  }

  // Every digest checked against the bytes in memory. A destination (or a directory above it) that is a link, or a file
  // there with other bytes, is refused; an identical file is kept. A file in the task tree or sealed-world/ that the
  // bundle does not hold would change the released digests, so it is refused too; a part file a failed write left beside
  // a file still to be written is removed (a link itself, never its target) and written again exclusively, not refused.
  const writes = new Map(staged);
  for (const x of exports) for (const e of x.entries) writes.set(join(bench, x.dir, 'results', e.path), e.data);
  const conflicts = [...writes].filter(([p, data]) => {
    for (let q = dirname(p); q.startsWith(repo + '/'); q = dirname(q)) { const st = lstatSync(q, { throwIfNoEntry: false }); if (st && !st.isDirectory()) return true; }
    const st = lstatSync(p, { throwIfNoEntry: false });
    return !!st && (!st.isFile() || !readFileSync(p).equals(data));
  }).map(([p]) => p);
  const PART = '.release-part';
  for (const dir of [set.dir, join(repo, 'tasks', 'multiuser', o.set, 'sealed-world')]) for (const p of existsSync(dir) ? walk(dir) : []) if (p !== set.manifest && !writes.has(p) && !(p.endsWith(PART) && writes.has(p.slice(0, -PART.length)) && !existsSync(p.slice(0, -PART.length)))) conflicts.push(p);
  if (conflicts.length) fail(`${conflicts.length} destination(s) in the public checkout already exist as a link, with other bytes, or beside the released tree without being in the bundle (path sha256 ${conflicts.slice(0, 3).map((p) => sha256(relative(repo, p)).slice(0, 12)).join(', ')}${conflicts.length > 3 ? ', ...' : ''}); release writes only new files or identical ones, so nothing was written`);
  for (const [p, data] of writes) {
    if (existsSync(p)) continue;
    mkdirSync(dirname(p), { recursive: true });
    rmSync(p + PART, { force: true });
    try { writeFileSync(p + PART, data, { flag: 'wx' }); renameSync(p + PART, p); } catch (e) { rmSync(p + PART, { force: true }); throw e; }
  }

  const ledger = openingsLedger(m);
  const { custody: _c, sealed: _s, ...rest } = m;
  const released: HeldoutManifest & { released: typeof s & { released_at: string } } = {
    ...rest, tasks: [...new Set(Object.keys(files).map((f) => f.split('/')[0]!))].filter((d) => files[`${d}/task.toml`]), files,
    ...(ledger ? { status: 'retired' as const } : {}), released: { ...s, released_at: now() },
  };
  // The "released" line lands before the manifest turns plaintext, so a failed push leaves the set sealed and a rerun
  // (which rewrites the same verified files) can finish the release.
  const verified = new Set(exports.map((x) => x.run_id));
  compareAndPush(clone, {
    remote, beforePush: o.beforePush, message: () => `release set ${o.set}`, onFailure: 'the manifest is left sealed; rerun the release',
    decide: () => {
      const current = readAccessLog(clone).filter((e) => e.set === o.set);
      const late = [...new Set([...unexported(current), ...current.filter((e) => e.event === 'exported' && !verified.has(e.run_id)).map((e) => e.run_id)])];
      if (late.length) fail(`the access log has an "opened" line with no "exported" line, or an "exported" line release did not verify, for ${late.length} run(s) of set ${o.set} that landed after release read it (${late.join(', ')}); the manifest is left sealed and the released line was not pushed. Finish and export each run, then rerun the release, which accepts the files already written`);
      return { schema_version: 1, event: 'released', at: now(), run_id: '*', set: o.set, bundle_sha256: s.bundle_sha256, custodian: o.custodian ?? 'scripts/sealed/release.ts' };
    },
  });
  writeFileSync(set.manifest, JSON.stringify(released, null, 2) + '\n');
  log(`RELEASE: set ${o.set}: ${released.tasks.length} tasks and ${exports.length} run(s) (${exports.map((x) => x.run_id).join(', ') || 'none'}) written and verified; MANIFEST.json is plaintext with status retired; commit on a branch and open the release pull request`);
  return { runs: exports.map((x) => x.run_id), tasks: released.tasks.length };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (!flag('task-set') || !argv.includes('--retire')) { console.error('HE-RUN-002 usage: bun scripts/sealed/release.ts --task-set <set> --retire [--custody <clone>] [--identity <drive copy>] [--repo .]  (--retire confirms the set is retired: no opening of it will ever count again)'); process.exit(2); }
  try {
    await releaseSet({ repo: flag('repo') ?? process.cwd(), set: flag('task-set')!, custody: flag('custody'), identityPath: flag('identity'), remote: flag('remote') });
  } catch (e) {
    console.error(e instanceof RunnerError ? e.message : `HE-SEALED-008 release failed: ${e instanceof Error ? e.constructor.name : 'error'} (message withheld)`);
    process.exit(2);
  }
}
