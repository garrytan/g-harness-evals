#!/usr/bin/env bun
/**
 * The publication check for anything bound for main (internal-task phase 3, docs/sealed-custody.md): custody material lives on
 * refs/heads/custody only, so a tree that main could receive must hold none of it, whatever the repository's visibility.
 *
 *   bun scripts/check-sealed-publication.ts [--repo .] [--ref <commit or branch>]
 *
 * It refuses (exit 1, one line per finding naming the path and the kind, never the text):
 *   - any *.age file (sealed bundles, raw results bundles, the escrow);
 *   - any file holding an age identity (AGE-SECRET-KEY-1 followed by 58 bech32 characters);
 *   - any access-log.jsonl (the custody access log);
 *   - raw sealed receipts: a results/manifest.json planned with a sealed root while its set is still in sealed custody,
 *     any file under docs/benchmarks/<run>/results/ when the run's prereg.json opens a set still in sealed custody,
 *     and anything in a sealed-results/ directory beyond the three public export files (export.json,
 *     opening-receipt.json, README.md);
 *   - a set's released files (tasks/multiuser/<set>/sealed-world/, task directories beside MANIFEST.json) while its
 *     MANIFEST.json still says custody "sealed";
 *   - internal-task, repo sets: any file under tasks/repo/<set>/heldout/ but MANIFEST.json, whatever the manifest says (a repo
 *     set's held-out tree exists only inside custody; release writes it to tasks/repo/<set>/released/), and a repo set's
 *     released files (tasks/repo/<set>/released/, tasks/repo/<set>/sealed-bundle/) while its MANIFEST.json says "sealed".
 *     Sets of both kinds count as sealed for the receipt rules above. And anything under a top-level jobs/ (Harbor's job
 *     directory, which holds task bodies, transcripts and logs), whatever the set.
 * tests/sealed-publication.test.ts runs it on the repository, so CI on every pull request to main enforces it; gstack-pregate
 * sealed (.gstack/pregate.json, visibility forced to public) refuses the same paths and identities before a push.
 */
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { IDENTITY_MARKER } from './sealed/custody.ts';

export interface Finding { path: string; kind: string }
export const EXPORT_FILES = ['export.json', 'opening-receipt.json', 'README.md'];

export function publicationFindings(repo: string, ref?: string): Finding[] {
  const g = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const ls = ref ? g(['ls-tree', '-r', '--name-only', '-z', ref]) : g(['ls-files', '-z']);
  if (ls.status !== 0) throw new Error(`git could not list ${ref ?? 'the work tree'} in ${repo}`);
  const files = ls.stdout.split('\0').filter(Boolean);
  const read = (p: string): string | null => {
    const r = ref ? g(['cat-file', 'blob', `${ref}:${p}`]) : spawnSync('cat', ['--', join(repo, p)], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : null;
  };
  const out: Finding[] = [];
  const marker = IDENTITY_MARKER.source;
  const grep = g(['grep', '-l', '-z', '-a', '-E', marker, ...(ref ? [ref] : []), '--']);
  for (const hit of grep.stdout.split('\0').filter(Boolean)) out.push({ path: ref ? hit.slice(ref.length + 1) : hit, kind: 'an age identity' });
  const sealedSets = new Set<string>();
  for (const f of files) {
    const m = /^tasks\/(?:multiuser|repo)\/([^/]+)\/heldout\/MANIFEST\.json$/.exec(f);
    if (!m) continue;
    try { if ((JSON.parse(read(f) ?? '{}') as { custody?: string }).custody === 'sealed') sealedSets.add(m[1]!); } catch { /* seal-heldout.ts --check reports a malformed manifest */ }
  }
  // A run whose preregistration opens a set still in sealed custody publishes only its sealed-results/ export until release.
  const sealedRuns = new Map<string, string>();
  for (const f of files) {
    const m = /^docs\/benchmarks\/([^/]+)\/prereg\.json$/.exec(f);
    if (!m) continue;
    try { const set = (JSON.parse(read(f) ?? '{}') as { heldout?: { set?: string } }).heldout?.set; if (set && sealedSets.has(set)) sealedRuns.set(m[1]!, set); } catch { /* prereg.ts reports a malformed preregistration */ }
  }
  for (const f of files) {
    const base = f.split('/').pop()!;
    if (f.endsWith('.age')) out.push({ path: f, kind: 'age ciphertext (custody material lives on refs/heads/custody only)' });
    if (base === 'access-log.jsonl') out.push({ path: f, kind: 'the custody access log' });
    const sr = /(^|\/)sealed-results\/(.+)$/.exec(f);
    if (sr && !EXPORT_FILES.includes(sr[2]!)) out.push({ path: f, kind: 'a raw sealed receipt (a sealed-results/ directory holds export.json, opening-receipt.json and README.md only)' });
    if (/(^|\/)results\/manifest\.json$/.test(f)) {
      try {
        const set = (JSON.parse(read(f) ?? '{}') as { sealed?: { set?: string } }).sealed?.set;
        if (set && sealedSets.has(set)) out.push({ path: f, kind: `raw sealed receipts of set ${set}, which is still in sealed custody` });
      } catch { /* not JSON: not a run manifest */ }
    }
    const run = /^docs\/benchmarks\/([^/]+)\/results\//.exec(f);
    if (run && sealedRuns.has(run[1]!)) out.push({ path: f, kind: `a raw receipt of a run on set ${sealedRuns.get(run[1]!)}, which is still in sealed custody (only sealed-results/ is published until release)` });
    const t = /^tasks\/multiuser\/([^/]+)\/(heldout|sealed-world)\/(.+)$/.exec(f);
    if (t && sealedSets.has(t[1]!) && !(t[2] === 'heldout' && t[3] === 'MANIFEST.json')) out.push({ path: f, kind: `released content of set ${t[1]}, which is still in sealed custody` });
    const r = /^tasks\/repo\/([^/]+)\/(heldout|released|sealed-bundle)\/(.+)$/.exec(f);
    if (r && r[2] === 'heldout' && r[3] !== 'MANIFEST.json') out.push({ path: f, kind: `a held-out task body of repo set ${r[1]} (a repo set's held-out tree exists only inside custody; tasks/repo/${r[1]}/heldout/ holds MANIFEST.json only)` });
    else if (r && r[2] !== 'heldout' && sealedSets.has(r[1]!)) out.push({ path: f, kind: `released content of set ${r[1]}, which is still in sealed custody` });
    if (f.startsWith('jobs/')) out.push({ path: f, kind: 'a Harbor job directory (Harbor writes jobs/ where it runs, and a job holds task bodies, transcripts and logs)' });
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = resolve(flag('repo') ?? '.');
  try {
    const found = publicationFindings(repo, flag('ref'));
    for (const f of found) console.error(`HE-SEALED-011 ${f.path}: ${f.kind}`);
    if (found.length) { console.error(`check-sealed-publication: ${found.length} finding(s); custody material never goes to main (docs/sealed-custody.md)`); process.exit(1); }
    console.log(`check-sealed-publication: no custody material in ${flag('ref') ?? 'the work tree'}`);
  } catch (e) {
    console.error(`HE-SEALED-011 check-sealed-publication could not run: ${e instanceof Error ? e.message : 'error'}`);
    process.exit(2);
  }
}
