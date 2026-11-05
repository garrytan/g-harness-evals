#!/usr/bin/env bun
// Trial bundles (docs/trial-bundle.md): one archive per finding holding a run's trial-level data, with a digest the finding
// file prints. Keyless; no network.
//
//   bun scripts/bundle.ts build --run docs/benchmarks/<run> --finding <id> --out <dir>
//                         [--receipts-commit <ref>] [--run-commit <sha>] [--rerun-commit <sha>] [--local]
//                         [--analysis summarize-run,compare-run]
//   bun scripts/bundle.ts verify <archive> [--sha256 <hex>] [--rebuild] [--max-bytes <n>] [--max-entries <n>]
//
// build reads the run's results/ (and its prereg.json) as committed at --receipts-commit (default HEAD; the manifest records
// the last commit at or before it that touched those files, so later unrelated commits do not move it), or from the work
// tree with --local (a fresh rerun whose results are not committed; git-ignored files are left out as they would be from a
// commit). What goes in is a rule: those files minus what scripts/publish-audit.ts harnessOwned() treats as harness-owned
// (trial.json, harness state and workspace, sidecar tokens, logs other than adapter.log and the kept receipts). trials.jsonl
// is copied byte for byte, so its sha256 still matches docs/receipts-manifest.json. A run whose set is in sealed custody is
// refused (HE-BUNDLE-002); a sealed opening with only its public export becomes an export-only bundle with rerun.available
// false. Every file is scanned with publish-audit's token patterns and allowlist first, and any hit stops the build
// (HE-BUNDLE-003): a token in committed receipts is a leak to report to internal-task, not something to strip and retry.
// --analysis runs checked-in analyzers from an allowlist on the bundle's own files and records their output as
// expected-output.txt; nothing in an archive is ever executed.
//
// verify hashes the archive before reading it, reads it under entry and byte caps (runner/archive.ts), and checks every
// file against bundle.json's manifest: a missing, extra or changed file is refused (HE-BUNDLE-007). --rebuild rebuilds the
// file list from this repository at the bundle's receipts_commit and compares it file by file (HE-BUNDLE-008).
//
// Exit 0 on success, 2 on any refusal (one HE-BUNDLE line on stderr).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants as bufferConstants } from 'node:buffer';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { RunnerError } from '../runner/errors.ts';
import { DEFAULT_CAPS, packBundleArchive, readBundleArchive, tarLimit, type TarEntry } from '../runner/archive.ts';
import { harnessOwned, scanText, type Hit } from './publish-audit.ts';
import { EXPORT_FILES, publicationFindings } from './check-sealed-publication.ts';
import { heldoutSets, liveSharers, readManifest } from './seal-heldout.ts';
import { IDENTITY_MARKER } from './sealed/custody.ts';

export const SCHEMA = 'eval-trial-bundle/1';
export const PROFILE_RESULTS = 'harness-evals/results-1';
export const PROFILE_SEALED_EXPORT = 'harness-evals/sealed-export-1';
const RESERVED = new Set(['bundle.json', 'analysis.json', 'expected-output.txt', 'README.md']);

/** Checked-in analyzers --analysis may name, with fixed arguments. An archive can only name an id from this list. */
export const ANALYSES: Record<string, { script: string; args: string[] }> = {
  'summarize-run': { script: 'scripts/summarize-run.ts', args: ['--seed', '7'] },
  'compare-run': { script: 'scripts/compare-run.ts', args: ['--seed', '7'] },
};

const TOOL_ROOT = resolve(import.meta.dir, '..');
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();
const utf8 = (b: Uint8Array) => Buffer.from(b).toString('utf8');

export interface BundleFile { path: string; sha256: string; bytes: number }
export interface BundleManifest {
  schema: string;
  profile: string;
  finding: string;
  repo: string;
  run_id: string | null;
  run_dir: string;
  run_commit: string | null;
  receipts_commit: string | null;
  rerun_commit: string | null;
  source: { mode: 'committed' | 'local'; rule: string };
  prereg: { path: string; sha256: string; commit: string | null } | null;
  cells: Array<{ id: string }>;
  held_out: { sealed: boolean; note: string };
  rerun: { available: boolean; cells: string[]; default_reps: number };
  generator: { script: string; commit: string | null; dirty: boolean };
  files: BundleFile[];
}

function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new RunnerError('HE-BUNDLE-001', `git ${args[0]} failed in ${root}: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
}

const commitSha = (root: string, ref: string): string | null => {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const isAncestor = (root: string, a: string, b: string): boolean => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0;

function gitBlobs(root: string, commit: string, paths: string[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (!paths.length) return out;
  const r = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: paths.map((p) => `${commit}:${p}`).join('\n') + '\n', maxBuffer: 4 * 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new RunnerError('HE-BUNDLE-001', 'git cat-file --batch failed');
  const buf = r.stdout as Buffer;
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, at);
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(buf.subarray(at, nl).toString('utf8'));
    if (!m) throw new RunnerError('HE-BUNDLE-001', `git has no blob for ${p} at ${commit.slice(0, 12)}`);
    const size = Number(m[1]);
    out.set(p, new Uint8Array(buf.subarray(nl + 1, nl + 1 + size)));
    at = nl + 1 + size + 1;
  }
  return out;
}


const textOf = (buf: Uint8Array, path: string): string => {
  if (!path.endsWith('.gz')) return Buffer.from(buf).toString('latin1');
  try { return Buffer.from(gunzipSync(buf, { maxOutputLength: 512 * 1024 * 1024 })).toString('latin1'); } catch { throw new RunnerError('HE-BUNDLE-001', `${path} is not readable gzip under 512 MiB, so it cannot be scanned for tokens; fix: check the file in the run's results`); }
};

const parseJson = <T>(buf: Uint8Array, path: string): T => {
  try { return JSON.parse(utf8(buf)) as T; } catch { throw new RunnerError('HE-BUNDLE-001', `${path} is not valid JSON; fix: check the file in the run's results`); }
};

/** Whether a held-out set is protected in the checkout, by check-sealed-publication's rule: in sealed custody itself, or
 *  sharing its world slice or corpus with a set that is (scripts/seal-heldout.ts liveSharers). */
function setIsSealed(root: string, set: string): boolean {
  const s = heldoutSets(root).find((h) => h.name === set);
  return (s ? readManifest(s)?.custody === 'sealed' : false) || liveSharers(set, root).length > 0;
}

export interface BuildOptions {
  root: string;
  run: string;
  finding: string;
  receiptsCommit?: string;
  runCommit?: string;
  rerunCommit?: string;
  local?: boolean;
  analyses?: string[];
}

/** The bundle's files (paths relative to the run directory) and its manifest, without packing. */
export function collect(opts: BuildOptions): { entries: TarEntry[]; manifest: BundleManifest } {
  const root = opts.root;
  const run = relative(root, resolve(root, opts.run)).replace(/\/+$/, '');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(opts.finding)) throw new RunnerError('HE-BUNDLE-001', `--finding ${JSON.stringify(opts.finding)} is not a finding id (lowercase letters, digits, dots, dashes, underscores)`);
  if (!run || run.startsWith('..')) throw new RunnerError('HE-BUNDLE-001', `--run ${opts.run} is not inside the repository at ${root}`);
  const inRun = (p: string) => p === `${run}/prereg.json` || p.startsWith(`${run}/results/`) || p.startsWith(`${run}/sealed-results/`);
  let files: string[];
  let read: (p: string) => Uint8Array | undefined;
  let receiptsCommit: string | null = null;
  if (opts.local) {
    const abs = join(root, run);
    if (!existsSync(abs)) throw new RunnerError('HE-BUNDLE-001', `${run} does not exist`);
    files = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', `${run}/prereg.json`, `${run}/results`, `${run}/sealed-results`]).split('\0').filter((p) => p && inRun(p) && lstatSync(join(root, p), { throwIfNoEntry: false }));
    files = [...new Set(files)].sort();
    const realRoot = realpathSync(root);
    const link = files.find((p) => !lstatSync(join(root, p)).isFile() || realpathSync(join(root, p)) !== join(realRoot, p));
    if (link) throw new RunnerError('HE-BUNDLE-001', `${link} is a symbolic link, sits under one, or is not a regular file; fix: a bundle holds regular files only, so replace it with the file it points to or remove it`);
    const listed = new Set(files);
    read = (p) => (listed.has(p) ? new Uint8Array(readFileSync(join(root, p))) : undefined);
  } else {
    const ref = git(root, ['rev-parse', '--verify', `${opts.receiptsCommit ?? 'HEAD'}^{commit}`]).trim();
    const commit = git(root, ['log', '-1', '--format=%H', ref, '--', `${run}/prereg.json`, `${run}/results`, `${run}/sealed-results`]).trim() || ref;
    receiptsCommit = commit;
    const tree = git(root, ['ls-tree', '-r', '-z', commit, '--', `${run}/prereg.json`, `${run}/results`, `${run}/sealed-results`]).split('\0').filter(Boolean).map((l) => { const tab = l.indexOf('\t'); return { mode: l.slice(0, 6), path: l.slice(tab + 1) }; });
    const odd = tree.find((t) => t.mode !== '100644' && t.mode !== '100755');
    if (odd) throw new RunnerError('HE-BUNDLE-001', `${odd.path} is committed as mode ${odd.mode} (a symbolic link or submodule); fix: a bundle holds regular files only`);
    files = tree.map((t) => t.path).sort();
    let blobs: Map<string, Uint8Array> | null = null;
    read = (p) => (blobs ??= gitBlobs(root, commit, files)).get(p);
  }
  const resolveCommit = (flag: string, ref: string | undefined): string | undefined => {
    if (ref === undefined) return undefined;
    const sha = commitSha(root, ref);
    if (!sha) throw new RunnerError('HE-BUNDLE-001', `--${flag} ${JSON.stringify(ref)} is not a commit in this repository; fix: pass the sha of the commit`);
    return sha;
  };
  const runCommit = resolveCommit('run-commit', opts.runCommit);
  const rerunCommit = resolveCommit('rerun-commit', opts.rerunCommit);
  if (runCommit && receiptsCommit && !isAncestor(root, runCommit, receiptsCommit)) throw new RunnerError('HE-BUNDLE-001', `--run-commit ${runCommit.slice(0, 12)} is not an ancestor of receipts_commit ${receiptsCommit.slice(0, 12)}; fix: pass the commit the run executed from`);
  const hasTrials = files.includes(`${run}/results/trials.jsonl`);
  const exportFiles = files.filter((p) => EXPORT_FILES.some((f) => p === `${run}/sealed-results/${f}`));
  if (!hasTrials && !exportFiles.length) throw new RunnerError('HE-BUNDLE-001', `${run} has no results/trials.jsonl and no sealed-results export${receiptsCommit ? ` at ${receiptsCommit.slice(0, 12)}` : ''}; fix: point --run at a run directory, or pass --receipts-commit the commit that added its results`);
  const profile = hasTrials ? PROFILE_RESULTS : PROFILE_SEALED_EXPORT;
  if (opts.local && hasTrials && exportFiles.length) throw new RunnerError('HE-BUNDLE-002', `${run} has local results beside a sealed-results export; fix: a released run is bundled from main, not with --local`);

  const findings = [...publicationFindings(root, receiptsCommit ?? undefined), ...(receiptsCommit ? publicationFindings(root, 'HEAD') : [])].filter((f) => f.path === run || f.path.startsWith(`${run}/`));
  if (findings.length) throw new RunnerError('HE-BUNDLE-002', `${run} holds material sealed custody keeps off main (${findings.length} path(s), first ${findings[0]!.path}: ${findings[0]!.kind}); fix: a run on a set in sealed custody is bundled from its sealed-results export only, after release`);

  let keep: string[];
  if (profile === PROFILE_RESULTS) {
    const manBytes = read(`${run}/results/manifest.json`);
    const man = manBytes ? parseJson<{ sealed?: unknown }>(manBytes, `${run}/results/manifest.json`) : {};
    const preregBytes = read(`${run}/prereg.json`);
    const set = preregBytes ? parseJson<{ heldout?: { set?: string } }>(preregBytes, `${run}/prereg.json`).heldout?.set : undefined;
    if (set && setIsSealed(root, set)) throw new RunnerError('HE-BUNDLE-002', `${run}/prereg.json opens set ${set}, which is in sealed custody or shares its world slice or corpus with a set that is; fix: a run on a sealed set is bundled from its sealed-results export only, after release`);
    if (man.sealed && (opts.local || !exportFiles.length)) throw new RunnerError('HE-BUNDLE-002', `${run}/results/manifest.json was planned with a sealed root and the run is not a released one on main; fix: bundle a sealed opening from its sealed-results export`);
    const owned = new Set(harnessOwned(files));
    keep = files.filter((p) => !owned.has(p) && (!p.startsWith(`${run}/sealed-results/`) || exportFiles.includes(p)));
  } else {
    keep = [...exportFiles, ...(files.includes(`${run}/prereg.json`) ? [`${run}/prereg.json`] : [])];
  }

  const entries: TarEntry[] = [];
  const hits: Hit[] = [];
  const counts: Record<string, number> = {};
  for (const p of keep) {
    const data = read(p);
    if (!data) throw new RunnerError('HE-BUNDLE-001', `${p} could not be read`);
    const rel = p.slice(run.length + 1);
    const base = rel.split('/').pop()!;
    if (base === 'access-log.jsonl' || base.endsWith('.age')) throw new RunnerError('HE-BUNDLE-002', `${rel} is custody material (${base === 'access-log.jsonl' ? 'the custody access log' : 'age ciphertext'}); fix: it never goes in a bundle; report the path to internal-task`);
    const text = textOf(data, p);
    if (IDENTITY_MARKER.test(text)) throw new RunnerError('HE-BUNDLE-002', `${rel} holds an age identity; fix: stop, do not publish, report the path to internal-task`);
    scanText(text, rel, hits, counts);
    entries.push({ path: rel, data });
  }
  if (hits.length) {
    const first = hits[0]!;
    throw new RunnerError('HE-BUNDLE-003', `${hits.length} token-shaped string(s) in the bundle's files, first in ${first.where} (pattern ${first.pattern}); fix: stop, do not publish, do not strip and retry; report the path and pattern to internal-task`);
  }

  const preregEntry = entries.find((e) => e.path === 'prereg.json');
  const prereg = preregEntry ? parseJson<{ run_id?: string; cells?: Array<{ id: string }> }>(preregEntry.data, 'prereg.json') : null;
  const runManifest = entries.find((e) => e.path === 'results/manifest.json');
  const runId = (runManifest ? parseJson<{ run_id?: string }>(runManifest.data, 'results/manifest.json').run_id : undefined) ?? prereg?.run_id ?? null;
  const lastLine = (args: string[]) => { const s = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return s.status === 0 && s.stdout.trim() ? s.stdout.trim().split('\n').pop()! : null; };
  const preregCommit = preregEntry ? lastLine(['log', '--diff-filter=A', '--format=%H', ...(receiptsCommit ? [receiptsCommit] : []), '--', `${run}/prereg.json`]) : null;
  const head = lastLine(['rev-parse', 'HEAD']);
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).stdout.trim() !== '';
  const cells = prereg?.cells ?? [];
  const results = profile === PROFILE_RESULTS;
  const manifest: BundleManifest = {
    schema: SCHEMA,
    profile,
    finding: opts.finding,
    repo: 'garrytan/harness-evals',
    run_id: runId,
    run_dir: run,
    run_commit: runCommit ?? preregCommit,
    receipts_commit: receiptsCommit,
    rerun_commit: rerunCommit ?? null,
    source: { mode: opts.local ? 'local' : 'committed', rule: `${run}/prereg.json, results/ and sealed-results/ ${opts.local ? 'in the work tree, git-ignored files left out' : 'at receipts_commit'}, minus scripts/publish-audit.ts harnessOwned(); a sealed-export bundle keeps only the public export files` },
    prereg: preregEntry ? { path: `${run}/prereg.json`, sha256: sha256(preregEntry.data), commit: preregCommit } : null,
    cells,
    held_out: results
      ? { sealed: false, note: exportFiles.length ? 'released sealed run: its raw receipts, published at release, and its public export' : 'plaintext run: every task it used is in the repository with its seal digests' }
      : { sealed: true, note: 'sealed opening: the public export only (counts, digests, decision bits); outsiders can verify digests but cannot rerun until the set retires' },
    rerun: { available: results, cells: results ? cells.map((c) => c.id) : [], default_reps: 1 },
    generator: { script: 'scripts/bundle.ts', commit: head, dirty },
    files: entries.map((e) => ({ path: e.path, sha256: sha256(e.data), bytes: e.data.length })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return { entries, manifest };
}

function runAnalyses(root: string, entries: TarEntry[], ids: string[]): string {
  for (const id of ids) if (!Object.hasOwn(ANALYSES, id)) throw new RunnerError('HE-BUNDLE-001', `--analysis ${id} is not one of ${Object.keys(ANALYSES).join(', ')}`);
  const dir = mkdtempSync(join(tmpdir(), 'trial-bundle-'));
  try {
    for (const e of entries) { mkdirSync(dirname(join(dir, e.path)), { recursive: true }); writeFileSync(join(dir, e.path), e.data); }
    let out = '';
    for (const id of ids) {
      const a = ANALYSES[id]!;
      const r = spawnSync(process.execPath, [join(TOOL_ROOT, a.script), '--results', join(dir, 'results'), ...a.args], { cwd: TOOL_ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, maxBuffer: 256 * 1024 * 1024 });
      if (r.status !== 0) throw new RunnerError('HE-BUNDLE-001', `analysis ${id} exited ${r.status}: ${(r.stderr || '').trim().split('\n')[0]}`);
      out += `## ${id}\n\n${r.stdout.split(dir).join('<bundle>')}\n`;
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readme(m: BundleManifest): string {
  return [
    `# Trial bundle: ${m.finding}`,
    '',
    `Format ${m.schema}, profile ${m.profile}, run ${m.run_id ?? 'unknown'} from ${m.repo} ${m.run_dir}.`,
    '',
    '- bundle.json: the manifest (every file with its sha256), the commits, the cells and what was left out.',
    "- prereg.json: the run's preregistration, verbatim.",
    m.profile === PROFILE_RESULTS
      ? "- results/: the run's results directory as committed (trials.jsonl byte for byte), minus harness-owned files (trial.json, harness state and workspace, sidecar tokens, logs other than adapter.log)."
      : "- sealed-results/: the sealed opening's public export only.",
    "- analysis.json and expected-output.txt (when present): the checked-in analyzers that reproduce the finding's tables, and their output.",
    '',
    'Check it with `bun scripts/bundle.ts verify <archive> --sha256 <digest>` from a harness-evals checkout (docs/trial-bundle.md).',
    '',
  ].join('\n');
}

export function build(opts: BuildOptions & { out: string }): { path: string; sha256: string; manifest: BundleManifest } {
  const { entries, manifest } = collect(opts);
  const extra: TarEntry[] = [];
  if (opts.analyses?.length) {
    const output = runAnalyses(opts.root, entries, opts.analyses);
    extra.push({ path: 'analysis.json', data: enc.encode(JSON.stringify({ steps: opts.analyses.map((id) => ({ id, ...ANALYSES[id]! })), expected_output_sha256: sha256(output) }, null, 2) + '\n') });
    extra.push({ path: 'expected-output.txt', data: enc.encode(output) });
  }
  extra.push({ path: 'README.md', data: enc.encode(readme(manifest)) });
  manifest.files = [...manifest.files, ...extra.map((e) => ({ path: e.path, sha256: sha256(e.data), bytes: e.data.length }))].sort((a, b) => (a.path < b.path ? -1 : 1));
  const packed = [...entries, ...extra, { path: 'bundle.json', data: enc.encode(JSON.stringify(manifest, null, 2) + '\n') }];
  const hits: Hit[] = [];
  for (const e of packed) scanText(textOf(e.data, e.path), e.path, hits, {});
  if (hits.length) throw new RunnerError('HE-BUNDLE-003', `${hits.length} token-shaped string(s) in the bundle as packed, first in ${hits[0]!.where} (pattern ${hits[0]!.pattern}); fix: stop, do not publish, do not strip and retry; report the path and pattern to internal-task`);
  let archive: Uint8Array;
  try { archive = packBundleArchive(packed); } catch (e) { throw new RunnerError('HE-BUNDLE-001', `a file could not be packed (${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}); fix: bundle paths must be ASCII and fit a ustar header`); }
  const digest = sha256(archive);
  mkdirSync(opts.out, { recursive: true });
  const path = join(opts.out, `${opts.finding}.bundle.tar.gz`);
  writeFileSync(path, archive);
  writeFileSync(path + '.sha256', `${digest}  ${basename(path)}\n`);
  return { path, sha256: digest, manifest };
}

export interface VerifyOptions { sha256?: string; rebuild?: boolean; root?: string; maxBytes?: number; maxEntries?: number }

export function verify(archivePath: string, opts: VerifyOptions = {}): { sha256: string; manifest: BundleManifest; entries: TarEntry[] } {
  if (!existsSync(archivePath)) throw new RunnerError('HE-BUNDLE-005', `${archivePath} does not exist; fix: download the bundle named by the finding's data: line, or pass its local path`);
  if (opts.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(opts.sha256)) throw new RunnerError('HE-BUNDLE-005', '--sha256 must be 64 lowercase hex characters');
  const caps = { maxBytes: opts.maxBytes ?? DEFAULT_CAPS.maxBytes, maxEntries: opts.maxEntries ?? DEFAULT_CAPS.maxEntries };
  const size = statSync(archivePath).size;
  if (size > tarLimit(caps) * 1.01 + 1024) throw new RunnerError('HE-BUNDLE-004', `${archivePath} is ${size} bytes, more than an archive under the caps can be; fix: do not use it, or raise --max-bytes or --max-entries for a bundle you trust`);
  const hash = createHash('sha256');
  const fd = openSync(archivePath, 'r');
  try { const chunk = Buffer.alloc(1 << 20); for (let n = readSync(fd, chunk); n > 0; n = readSync(fd, chunk)) hash.update(chunk.subarray(0, n)); } finally { closeSync(fd); }
  const digest = hash.digest('hex');
  if (opts.sha256 !== undefined && opts.sha256 !== digest) throw new RunnerError('HE-BUNDLE-005', `archive sha256 ${digest} is not the expected ${opts.sha256}; fix: download it again from the finding's data: URL; do not use this file`);
  const entries = readBundleArchive(readFileSync(archivePath), caps);
  const mEntry = entries.find((e) => e.path === 'bundle.json');
  if (!mEntry) throw new RunnerError('HE-BUNDLE-006', 'the archive has no bundle.json; fix: it is not a trial bundle');
  let manifest: BundleManifest;
  try { manifest = JSON.parse(utf8(mEntry.data)); } catch { throw new RunnerError('HE-BUNDLE-006', 'bundle.json is not JSON; fix: it is not a trial bundle'); }
  const fileShape = (f: unknown) => !!f && typeof f === 'object' && typeof (f as BundleFile).path === 'string' && typeof (f as BundleFile).sha256 === 'string' && typeof (f as BundleFile).bytes === 'number';
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.files) || !manifest.files.every(fileShape)) throw new RunnerError('HE-BUNDLE-006', 'bundle.json is not an object with a files list of {path, sha256, bytes}; fix: it is not a trial bundle');
  const major = /^eval-trial-bundle\/(\d+)$/.exec(String(manifest.schema ?? ''))?.[1];
  if (major !== '1') throw new RunnerError('HE-BUNDLE-006', `bundle.json schema ${JSON.stringify(manifest.schema)} is not ${SCHEMA}; fix: use scripts/bundle.ts at the bundle's generator commit (${String(manifest.generator?.commit ?? 'unknown')}) or later`);
  if (![PROFILE_RESULTS, PROFILE_SEALED_EXPORT].includes(manifest.profile)) throw new RunnerError('HE-BUNDLE-006', `bundle.json profile ${JSON.stringify(manifest.profile)} is not one this repository reads`);
  const listed = new Map(manifest.files.map((f) => [f.path, f] as const));
  if (listed.size !== manifest.files.length) throw new RunnerError('HE-BUNDLE-006', 'bundle.json lists a path twice; fix: it is not a trial bundle');
  for (const k of ['run_dir', 'receipts_commit'] as const) if (manifest[k] !== null && typeof manifest[k] !== 'string') throw new RunnerError('HE-BUNDLE-006', `bundle.json ${k} is not a string; fix: it is not a trial bundle`);
  const problems: string[] = [];
  for (const e of entries) {
    if (e.path === 'bundle.json') continue;
    const f = listed.get(e.path);
    if (!f) problems.push(`extra file ${e.path}`);
    else if (f.sha256 !== sha256(e.data) || f.bytes !== e.data.length) problems.push(`changed file ${e.path}`);
  }
  const present = new Set(entries.map((e) => e.path));
  for (const p of listed.keys()) if (!present.has(p)) problems.push(`missing file ${p}`);
  if (problems.length) throw new RunnerError('HE-BUNDLE-007', `${problems.length} file(s) do not match bundle.json, first: ${problems[0]}; fix: do not use this bundle; download it again`);
  if (opts.rebuild) {
    if (!manifest.receipts_commit) throw new RunnerError('HE-BUNDLE-008', 'the bundle was built from local results (no receipts_commit), so it cannot be rebuilt from the repository');
    const again = collect({ root: opts.root ?? process.cwd(), run: manifest.run_dir, finding: manifest.finding, receiptsCommit: manifest.receipts_commit });
    const want = new Map(again.manifest.files.map((f) => [f.path, f.sha256] as const));
    const diffs: string[] = [];
    for (const f of manifest.files) if (!RESERVED.has(f.path) && want.get(f.path) !== f.sha256) diffs.push(want.has(f.path) ? `changed ${f.path}` : `not in the repository ${f.path}`);
    for (const p of want.keys()) if (!listed.has(p)) diffs.push(`missing from the bundle ${p}`);
    for (const k of ['profile', 'run_id', 'run_dir', 'prereg', 'cells', 'held_out', 'rerun'] as const) if (JSON.stringify(manifest[k]) !== JSON.stringify(again.manifest[k])) diffs.push(`bundle.json ${k} differs`);
    const rebuildRoot = opts.root ?? process.cwd();
    for (const k of ['run_commit', 'rerun_commit'] as const) { const v: unknown = manifest[k]; if (v !== null && (typeof v !== 'string' || commitSha(rebuildRoot, v) !== v)) diffs.push(`bundle.json ${k} is not a commit in this repository`); }
    if (typeof manifest.run_commit === 'string' && commitSha(rebuildRoot, manifest.run_commit) === manifest.run_commit && !isAncestor(rebuildRoot, manifest.run_commit, manifest.receipts_commit)) diffs.push('bundle.json run_commit is not an ancestor of receipts_commit');
    const analysis = entries.find((e) => e.path === 'analysis.json');
    const expected = entries.find((e) => e.path === 'expected-output.txt');
    const readmeEntry = entries.find((e) => e.path === 'README.md');
    if (readmeEntry && utf8(readmeEntry.data) !== readme(again.manifest)) diffs.push('README.md is not the one this repository writes');
    if (expected && !analysis) diffs.push('expected-output.txt with no analysis.json');
    if (analysis && !diffs.length) {
      let ids: string[] = [];
      try { ids = (JSON.parse(utf8(analysis.data)) as { steps: Array<{ id: string; script: string; args: string[] }> }).steps.map((s) => (JSON.stringify(s) === JSON.stringify({ id: s.id, ...ANALYSES[s.id] }) ? s.id : `${String(s.id)} (not the checked-in step)`)); } catch { diffs.push('analysis.json is not a list of steps'); }
      const odd = ids.find((id) => !Object.hasOwn(ANALYSES, id));
      const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
      if (odd) diffs.push(`analysis.json names ${odd}`);
      else if (!ids.length) diffs.push('analysis.json lists no steps');
      else if (repeated) diffs.push(`analysis.json repeats step ${repeated}`);
      else if (runAnalyses(opts.root ?? process.cwd(), again.entries, ids) !== utf8(entries.find((e) => e.path === 'expected-output.txt')?.data ?? new Uint8Array())) diffs.push(`expected-output.txt is not what the checked-in analyzers print (if summarize-run or compare-run changed since the generator commit ${String(manifest.generator?.commit ?? 'unknown').slice(0, 12)}, run verify --rebuild from that commit)`);
    }
    if (diffs.length) throw new RunnerError('HE-BUNDLE-008', `the repository at ${manifest.receipts_commit.slice(0, 12)} gives ${diffs.length} file difference(s), first: ${diffs[0]}`);
  }
  return { sha256: digest, manifest, entries };
}

function main(argv: string[]): void {
  const [cmd, ...rest] = argv;
  const KNOWN: Record<string, { values: string[]; bools: string[] }> = {
    build: { values: ['run', 'finding', 'out', 'receipts-commit', 'run-commit', 'rerun-commit', 'analysis'], bools: ['local'] },
    verify: { values: ['sha256', 'max-bytes', 'max-entries'], bools: ['rebuild'] },
  };
  const known = KNOWN[cmd ?? ''];
  if (known) {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (!a.startsWith('--')) continue;
      const n = a.slice(2);
      if (known.values.includes(n)) { i++; continue; }
      if (!known.bools.includes(n)) throw new RunnerError('HE-BUNDLE-001', `${a.split('=')[0]} is not a ${cmd} flag${a.includes('=') ? ' (write --flag value, not --flag=value)' : ''}`);
    }
  }
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    if (i < 0) return undefined;
    const v = rest[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) throw new RunnerError('HE-BUNDLE-001', `--${n} needs a value`);
    return v;
  };
  const has = (n: string) => rest.includes(`--${n}`);
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
  if (cmd === 'build') {
    const run = flag('run'); const finding = flag('finding'); const out = flag('out');
    if (!run || !finding || !out) throw new RunnerError('HE-BUNDLE-001', 'usage: bun scripts/bundle.ts build --run docs/benchmarks/<run> --finding <id> --out <dir> [--receipts-commit <ref>] [--run-commit <sha>] [--rerun-commit <sha>] [--local] [--analysis summarize-run,compare-run]');
    const r = build({ root, run, finding, out, receiptsCommit: flag('receipts-commit'), runCommit: flag('run-commit'), rerunCommit: flag('rerun-commit'), local: has('local'), analyses: flag('analysis')?.split(',').filter(Boolean) });
    console.log(`BUNDLE: ${r.path} sha256=${r.sha256} profile=${r.manifest.profile} files=${r.manifest.files.length + 1} run=${r.manifest.run_id} receipts_commit=${r.manifest.receipts_commit ?? 'local'}`);
    if (r.manifest.generator.dirty) console.log('WARN the generator checkout had uncommitted changes; bundle.json records dirty: true');
    return;
  }
  if (cmd === 'verify') {
    const archive = rest.find((a, i) => !a.startsWith('--') && !(rest[i - 1]?.startsWith('--') && rest[i - 1] !== '--rebuild'));
    if (!archive) throw new RunnerError('HE-BUNDLE-001', 'usage: bun scripts/bundle.ts verify <archive> [--sha256 <hex>] [--rebuild] [--max-bytes <n>] [--max-entries <n>]');
    const num = (n: string) => { const v = flag(n); if (v === undefined) return undefined; if (!/^[1-9]\d*$/.test(v) || Number(v) > bufferConstants.MAX_LENGTH - 2 * 1024 * 1024) throw new RunnerError('HE-BUNDLE-001', `--${n} must be a positive integer below ${bufferConstants.MAX_LENGTH - 2 * 1024 * 1024}`); return Number(v); };
    const sha = flag('sha256');
    const r = verify(archive, { sha256: sha, rebuild: has('rebuild'), root, maxBytes: num('max-bytes'), maxEntries: num('max-entries') });
    console.log(`VERIFY: ok sha256=${r.sha256} sha256_checked=${sha ? 'yes' : 'no'} finding=${r.manifest.finding} profile=${r.manifest.profile} files=${r.entries.length} run=${r.manifest.run_id}${has('rebuild') ? ` rebuilt_from=${r.manifest.receipts_commit}` : ''}`);
    return;
  }
  throw new RunnerError('HE-BUNDLE-001', 'usage: bun scripts/bundle.ts build|verify ... (docs/trial-bundle.md)');
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    console.error(`HE-BUNDLE-001 unexpected ${e instanceof Error ? e.name : 'error'}; fix: rerun with BUNDLE_DEBUG=1 for the stack, and report it`);
    if (process.env.BUNDLE_DEBUG === '1') console.error(e);
    process.exit(2);
  }
}
