#!/usr/bin/env bun
/**
 * Publish a sealed opening (custodian only; docs/sealed-custody.md, decision 4 of the sealed-custody plan).
 *
 *   bun scripts/sealed/export.ts --results <raw results dir, outside the checkout> --sealed-root <opened root>
 *        --opening-receipt <file> [--custody <isolated custody clone>] [--out docs/benchmarks/<run>/sealed-results]
 *        [--repo .] [--mode embargo] [--remote origin] [--custodian <name>]
 *
 * It refuses unless the repository is private (gh api repos/garrytan/harness-evals -q .private; HE-SEALED-013). The
 * access log is read from refs/heads/custody through the isolated custody clone (default ~/.capy/work/custody/harness-evals;
 * scripts/sealed/custody.ts), synced before the embargo decision.
 *
 * It refuses (HE-SEALED-007, nothing pushed or published) when the set's sealed.recipient is not the checkout's
 * sealed/recipient.txt, when the access log has a "released" line for the set, and when the receipt's access.event_sha256
 * is missing or not the digest of the run's first "opened" line there (a run with no such line is refused too); the last two are checked after each sync and again inside the
 * push transaction.
 * Inside custody it runs scripts/summarize-run.ts and makes every claim source again from the current trials.jsonl with
 * scripts/compare-run.ts (both with --sealed-root; the sources are comparisons.json and comparisons.gbrain.json, and any
 * other claim source is refused): the preregistered defaults, plus one --margin per noninferiority claim
 * of that source. A comparisons file already in the raw results is overwritten, never read. It then writes an allowlisted
 * public export into --out:
 *   export.json            run, set, opening number, label, mode; one accept or reject bit per preregistered claim with
 *                          its decision sentence; trial counts and spend; the digests of the opening receipt, the sealed
 *                          bundle, the raw results bundle and the raw receipts (trials.jsonl, manifest.json, summary.json,
 *                          comparisons, ledgers). In full mode also the per-cell aggregates (n, passes, pass rate with its
 *                          interval, task clusters, exclusions, consent violations, spend) and per-task counts under
 *                          opaque ids (T- and ten hex characters of a salted hash, the same ids every sealed log line
 *                          uses; the salt stays sealed until release).
 *   opening-receipt.json   the receipt open.ts wrote (digests only).
 *   README.md              the decision sentences in plain words.
 * Embargo (R3): while the set's reserve opening is unused (fewer confirmatory openings in the access log than the
 * set's opening_budget, and the set not retired), the export carries only the decision bits, the counts, the spend and the
 * digests, and each decision sentence is the claim id, accepted or rejected, and the preregistered claim sentence (no
 * estimate, interval or p); per-cell and per-task diagnostics wait for the full export at release
 * (scripts/sealed/release.ts). --mode embargo forces the embargo; full mode cannot be forced while the reserve is unused.
 * Before anything is published, a leak scan refuses the export when any task id, task string, hidden fact, slice record
 * string, corpus line or raw summary string (eight characters or more, absent from the public world and preregistration)
 * appears in a public file (HE-SEALED-007); the refusal names the file and the kind, never the text.
 * Then the raw results directory (harness state and workspaces under trials/ excluded, and each Claude Code or Codex installer view's
 * compiled gbrain once its view manifest's sha256 vouches for it) is packed, gzipped, encrypted to the
 * set's recipient and pushed to <set>/results/<run_id>.tar.age on refs/heads/custody, without force, with an "exported"
 * access-log line; a bundle over 95 MiB (GitHub refuses a pushed file over 100 MiB) is refused before anything is written.
 * Before the push the three public files are staged in <results>/export-pending/<bundle sha256>/ (mode 0700, outside every git tree, left
 * out of the bundle); only after the push lands are they copied into --out (which must be the run's sealed-results
 * directory), opening-receipt.json and README.md first and export.json last, each through a temporary name, so an
 * export.json in --out marks a complete copy. A push that landed but was reported as failed is recognised on the retry by
 * its exported line (the bundle digest is new to each export), so the run never gets a second line. The custody state is
 * read under the custody clone's lock, in the same hold as the sync that fetched it. A run already exported is never
 * exported again: when custody holds its bundle, every exported line of the run names that bundle's digest and the
 * staged export.json names it too, a rerun finishes a write the earlier export did not complete (a crash or
 * a failed write after the push) by copying the staged files into --out; when --out already holds them it refuses, saying
 * the export is complete; otherwise it refuses and names what is missing. The raw results never enter the public checkout
 * until release; once the push lands, the plaintext copies are removed with bun scripts/sealed/cleanup.ts
 * (docs/sealed-custody.md, "After the export").
 *
 * A claim may carry family ("primary", the default, or "secondary"; Holm runs within each family at the set's
 * alpha) and requires_gate ({"file": "<name>.json", "key": "<model>"}): when that gate file at the top of the raw results
 * says the key's pass is false, the claim is dropped from its family before Holm and published as "dropped, not measuring
 * skill bodies"; a missing gate file, key or boolean pass refuses the export. A repo set (kind "repo") is exported the same
 * way from its root, which has no world slice or corpus pages; its generator/ files are sealed text for the leak scan.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { holmAdjusted } from '../../runner/stats/paired.ts';
import { openSealedContext, type Manifest } from '../../runner/run.ts';
import { encryptTo, idValues, OPAQUE_SALT_FILE, opaqueId, packTar, quotedLiterals, readJsonFile, safeRelPath, sealedPaths, sha256, type OpeningReceipt, type TarEntry } from '../../runner/heldout/sealed.ts';
import { CLAIM_FAMILIES, claimProblems, deriveSet, type HeldoutClaim } from '../../runner/heldout/openings.ts';
import { heldoutSet, openingsLedger, readManifest, walk } from '../seal-heldout.ts';
import type { TrialRecord } from '../../runner/contracts.ts';
import { checkPrivate, compareAndPush, CUSTODY_REF, CUSTODY_REPO, custodyClone, git, insideGitTree, openedRuns, readAccessLog, syncCustody, withCustodyLock } from './custody.ts';

const ROOT = join(import.meta.dir, '..', '..');
/** GitHub refuses a pushed file over 100 MiB; the gzipped, encrypted raw results bundle must stay under this. */
export const MAX_RESULTS_BUNDLE_BYTES = 95 * 1024 * 1024;
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
/** The public files staged under <results>/export-pending/ before the custody push and copied into sealed-results/ after it,
 *  in copy order: export.json last, so its presence in sealed-results/ marks a complete copy. */
const PUBLIC_FILES = ['opening-receipt.json', 'README.md', 'export.json'];
const EXPORT_PENDING = 'export-pending';

/** Copies the staged public files into --out in PUBLIC_FILES order, each written to a temporary name and renamed into place. */
function publish(pending: string, out: string): void {
  mkdirSync(out, { recursive: true });
  for (const n of PUBLIC_FILES) {
    const tmp = join(out, `.${n}.${process.pid}.tmp`);
    try { copyFileSync(join(pending, n), tmp); renameSync(tmp, join(out, n)); } finally { rmSync(tmp, { force: true }); }
  }
}

/** One claim's outcome. A claim whose gate failed is "dropped": it never entered its Holm family, so it has no estimate,
 *  interval or p here. */
export interface Decision { claim: string; family: NonNullable<HeldoutClaim['family']>; decision: 'accept' | 'reject' | 'dropped'; rule: HeldoutClaim['rule']; estimate: number | null; interval: [number, number] | null; p: number | null; holm_p: number | null; sentence: string }

/** The ids of the claims whose requires_gate failed: the gate file (a JSON object at the top of the raw results, keyed by
 *  model or arm) gives the claim's key {"pass": false}. A missing file, a missing key or a pass that is not a boolean is
 *  refused (HE-SEALED-007), since the claim could then not be decided either way. */
export function failedGates(claims: HeldoutClaim[], raw: string): Set<string> {
  const failed = new Set<string>();
  for (const c of claims) {
    const g = c.requires_gate;
    if (!g) continue;
    const file = join(raw, g.file);
    if (!existsSync(file)) throw new RunnerError('HE-SEALED-007', `claim ${c.id} requires the gate ${g.key} in ${g.file}, and the raw results have no ${g.file}; nothing was pushed or published`);
    const entry = (readJsonFile<Record<string, { pass?: unknown } | undefined> | null>(file) ?? {})[g.key];
    if (typeof entry?.pass !== 'boolean') throw new RunnerError('HE-SEALED-007', `claim ${c.id} requires the gate ${g.key} in ${g.file}, which has no boolean pass for it; nothing was pushed or published`);
    if (!entry.pass) failed.add(c.id);
  }
  return failed;
}

const pts = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;

function at(obj: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** The cell pair (and ladder endpoint) a comparison entry of scripts/compare-run.ts is about, for its --margin flag. */
export function entryPair(e: Record<string, unknown>): [string, string, string?] | null {
  if (typeof e.a === 'string' && typeof e.b === 'string') return [e.a, e.b];
  if (typeof e.base_cell === 'string' && typeof e.cell === 'string') return [e.base_cell, e.cell, typeof e.endpoint === 'string' ? e.endpoint : undefined];
  if (typeof e.cell_none === 'string' && typeof e.cell_gbrain === 'string') return [e.cell_none, e.cell_gbrain];
  return null;
}

/** The one entry a claim reads. */
export function claimEntry(c: HeldoutClaim, file: unknown): Record<string, unknown> {
  const list = at(file, c.path);
  if (!Array.isArray(list)) throw new RunnerError('HE-SEALED-007', `claim ${c.id}: ${c.source} has no list at ${JSON.stringify(c.path)}`);
  const hits = list.filter((e) => Object.entries(c.where).every(([k, v]) => (e as Record<string, unknown>)[k] === v));
  if (hits.length !== 1) throw new RunnerError('HE-SEALED-007', `claim ${c.id}: ${hits.length} entries of ${c.source} ${c.path} match ${JSON.stringify(c.where)}; a claim reads exactly one`);
  return hits[0] as Record<string, unknown>;
}

/**
 * One accept or reject per claim. The opening's alpha is split by Holm across the claims of each family (primary, the
 * default, and secondary): a superiority claim enters with its two-sided p and is accepted when its Holm-adjusted p is
 * at most alpha and the estimate points in the claimed direction; a noninferiority claim enters with its one-sided p
 * against the preregistered margin (compare-run.ts --margin, from the cluster bootstrap) and is accepted when its
 * Holm-adjusted p is at most alpha. A claim in dropped (its gate failed, failedGates) enters no family and is "dropped".
 */
export function decide(claims: HeldoutClaim[], read: (source: string) => unknown, alpha: number, dropped: ReadonlySet<string> = new Set()): Decision[] {
  const familyOf = (c: HeldoutClaim) => c.family ?? 'primary';
  const named = claims.some((c) => familyOf(c) !== 'primary' || dropped.has(c.id));
  const rows = claims.filter((c) => !dropped.has(c.id)).map((c) => {
    const e = claimEntry(c, read(c.source));
    const estimate = e[c.estimate ?? 'delta'] as number;
    const interval = e[c.interval ?? 'ci95'] as [number, number];
    if (typeof estimate !== 'number' || !Array.isArray(interval)) throw new RunnerError('HE-SEALED-007', `claim ${c.id}: the matched entry has no numeric estimate or interval`);
    let p: unknown;
    if (c.rule === 'superiority') p = e[c.p ?? 'p'];
    else {
      const want = c.direction === 'increase' ? 'higher' : 'lower';
      const ni = e.noninferiority as { margin?: number; direction?: string; p?: number | null } | undefined;
      if (typeof c.margin !== 'number' || c.margin < 0) throw new RunnerError('HE-SEALED-007', `claim ${c.id}: a noninferiority claim needs a margin >= 0`);
      if (!ni || ni.margin !== c.margin || ni.direction !== want) throw new RunnerError('HE-SEALED-007', `claim ${c.id}: the matched entry has no noninferiority p for margin ${c.margin} (${want}); compare-run.ts needs --margin <a>,<b>,${c.margin},${want}`);
      p = ni.p;
    }
    if (typeof p !== 'number') throw new RunnerError('HE-SEALED-007', `claim ${c.id}: the matched entry has no numeric p`);
    return { c, estimate, interval, p };
  });
  const holm = new Map<string, number>();
  const size = new Map<string, number>();
  for (const fam of CLAIM_FAMILIES) {
    const members = rows.filter((r) => familyOf(r.c) === fam);
    size.set(fam, members.length);
    if (members.length) holmAdjusted(members.map((r) => r.p)).forEach((x, i) => holm.set(members[i]!.c.id, x));
  }
  return claims.map((c) => {
    const family = familyOf(c);
    if (dropped.has(c.id)) return { claim: c.id, family, decision: 'dropped' as const, rule: c.rule, estimate: null, interval: null, p: null, holm_p: null, sentence: `${c.id}: dropped from the ${family} Holm family, not measuring skill bodies (the gate ${c.requires_gate!.key} in ${c.requires_gate!.file} failed). ${c.sentence.trim().replace(/\.$/, '')}.` };
    const r = rows.find((x) => x.c === c)!;
    const h = holm.get(c.id)!;
    const up = c.direction === 'increase';
    const accept = h <= alpha && (c.rule === 'noninferiority' || (up ? r.estimate > 0 : r.estimate < 0));
    const test = c.rule === 'superiority' ? 'superiority' : `noninferiority with a margin of ${(100 * (c.margin ?? 0)).toFixed(1)} points`;
    const sentence = `${c.id}: ${accept ? 'accepted' : 'rejected'}. ${c.sentence.trim().replace(/\.$/, '')}. Estimate ${pts(r.estimate)} points, 95% interval ${pts(r.interval[0])} to ${pts(r.interval[1])}, ${test}, Holm-adjusted p ${h.toPrecision(2)} across the opening's ${size.get(family)}${named ? ` ${family}` : ''} claim(s) against alpha ${alpha}.`;
    return { claim: c.id, family, decision: accept ? 'accept' as const : 'reject' as const, rule: c.rule, estimate: r.estimate, interval: r.interval, p: r.p, holm_p: h, sentence };
  });
}

function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) stringLeaves(x, out);
  return out;
}

export interface Secret { kind: string; text: string }

/** The strings a public export must not contain: task ids, every string in the task tree, the slice, the corpus pages,
 *  the extras (seal.ts --include) and the raw summaries, at least eight characters long (task ids at least three) and absent from every public text. */
export function collectSecrets(o: { root: string; set: string; raw: string; publicTexts: string[]; templateText?: string }): Secret[] {
  const p = sealedPaths(o.root, o.set);
  const out = new Map<string, string>();
  const add = (kind: string, s: string, min = 8) => { const t = s.trim(); if (t.length >= min && !out.has(t)) out.set(t, kind); };
  const lines = (kind: string, dir: string) => { for (const f of existsSync(dir) ? walk(dir) : []) for (const line of readFileSync(f, 'utf8').split('\n')) add(kind, line); };
  for (const d of readdirSync(p.tasks, { withFileTypes: true })) if (d.isDirectory()) add('task id', d.name, 3);
  for (const f of walk(p.tasks)) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.json')) { try { for (const s of stringLeaves(JSON.parse(text))) add('task string', s); } catch { /* not JSON */ } continue; }
    for (const m of text.matchAll(/"""([\s\S]*?)"""|"((?:[^"\\\n]|\\.)*)"|'([^'\n]*)'/g)) add('task string', (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\"/g, '"'));
    if (!f.endsWith('.toml')) for (const line of text.split('\n')) add('task text', line);
  }
  if (existsSync(p.slice)) for (const s of stringLeaves(JSON.parse(readFileSync(p.slice, 'utf8')))) add('world slice string', s);
  lines('corpus line', p.corpus);
  for (const f of existsSync(p.generator) ? walk(p.generator) : []) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.json')) { try { for (const s of stringLeaves(JSON.parse(text))) add('generator string', s); } catch { /* not JSON */ } }
    for (const s of quotedLiterals(text)) add('generator string', s);
    for (const line of text.split('\n')) add('generator line', line);
  }
  for (const f of existsSync(p.extras) ? walk(p.extras) : []) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.json')) { try { const v = JSON.parse(text); for (const s of stringLeaves(v)) add('extra string', s); for (const s of idValues(v)) add('extra id', s, 3); } catch { /* not JSON; lines cover it */ } }
    for (const line of text.split('\n')) add('extra line', line);
  }
  for (const f of readdirSync(o.raw).filter((n) => /^(summary|comparisons)[\w.-]*\.json$/.test(n))) {
    try { for (const s of stringLeaves(JSON.parse(readFileSync(join(o.raw, f), 'utf8')))) add('raw summary string', s); } catch { /* skip */ }
  }
  const secrets: Secret[] = [];
  // templateText (export.ts's own source) exempts only strings of eight or more characters, so a short task id that happens
  // to appear in the source is still scanned for
  for (const [text, kind] of out) if (!o.publicTexts.some((pt) => pt.includes(text)) && !(text.length >= 8 && o.templateText?.includes(text))) secrets.push({ kind, text });
  return secrets;
}

/** The public files that contain a secret, each with the kinds found and a digest prefix per hit (never the text). */
export function leakScan(files: Record<string, string>, secrets: Secret[]): Array<{ file: string; kind: string; secret_sha256: string }> {
  const hits: Array<{ file: string; kind: string; secret_sha256: string }> = [];
  for (const [file, text] of Object.entries(files)) for (const s of secrets) if (text.includes(s.text)) hits.push({ file, kind: s.kind, secret_sha256: sha256(s.text).slice(0, 12) });
  return hits;
}

/** Raw results as tar entries: every regular file except harness state and workspaces under trials/, the staged public
 *  files under export-pending/, and the compiled gbrain in a Claude Code or Codex installer view (gbrain-install/<harness>-installer/<split>/
 *  home/.local/bin/gbrain, and the same under each <shard>.gbrain-install/ after merge-shards; issue #192): 207 MB, about 67 MiB
 *  gzipped, so two copies alone pass the 95 MiB bundle limit. The view's manifest.json, which stays in the bundle, records its sha256
 *  under source_path <harness>/installer/home/.local/bin/gbrain. A binary that does not match that entry, a manifest with no such entry,
 *  or a manifest whose view_digest is not the digest of its own file list (the adapters' check) is refused rather than left out
 *  unchecked. A consistent view whose view_digest no trial in trials.jsonl records for that harness and split
 *  (gbrain.install_bundle.view_digest; every trial of the cell ended before the view was mounted) keeps its binary in the bundle,
 *  under the same 95 MiB limit, since no trial record vouches for it. */
export function rawEntries(raw: string): TarEntry[] {
  const entries: TarEntry[] = [];
  let ran: Set<string> | undefined;
  const trialViews = (): Set<string> => {
    if (ran) return ran;
    ran = new Set();
    const text = existsSync(join(raw, 'trials.jsonl')) ? readFileSync(join(raw, 'trials.jsonl'), 'utf8') : '';
    for (const l of text.split('\n').filter(Boolean)) {
      try { const b = (JSON.parse(l) as TrialRecord).gbrain?.install_bundle; if (b?.view_digest) ran.add(`${b.harness}/${b.split}/${b.view_digest}`); } catch { /* not a record */ }
    }
    return ran;
  };
  for (const f of walk(raw)) {
    const rel = relative(raw, f);
    const segs = rel.split('/');
    if (segs[0] === EXPORT_PENDING || (segs[0] === 'trials' && (segs.includes('state') || segs.includes('workspace')))) continue;
    if (/(^|\.)gbrain-install$/.test(segs[0]!) && /^(claude-code|codex)-installer$/.test(segs[1] ?? '') && segs.slice(3).join('/') === 'home/.local/bin/gbrain') {
      const view = segs.slice(0, 3).join('/');
      const harness = segs[1]!.slice(0, -'-installer'.length);
      let listed: string | undefined;
      let digest: string | undefined;
      try {
        const m = JSON.parse(readFileSync(join(raw, view, 'manifest.json'), 'utf8')) as { view_digest?: string; files?: Array<{ path?: string; source_path?: string; sha256?: string }> };
        const files = m.files ?? [];
        const lines = [...files].sort((a, b) => ((a.source_path as string) < (b.source_path as string) ? -1 : (a.source_path as string) > (b.source_path as string) ? 1 : 0)).map((x) => `${x.source_path} ${x.sha256}\n`).join('');
        digest = m.view_digest;
        listed = sha256(lines) === m.view_digest ? files.find((x) => x.path === 'home/.local/bin/gbrain' && x.source_path === `${harness}/installer/home/.local/bin/gbrain`)?.sha256 : undefined;
      } catch { listed = undefined; }
      if (!listed || sha256(readFileSync(f)) !== listed) throw new RunnerError('HE-SEALED-007', `${rel} is not the binary its view's manifest.json records (no entry with source_path ${harness}/installer/home/.local/bin/gbrain, another sha256, or a view_digest that is not the digest of the manifest's file list); the bundle leaves the installer's gbrain out only when the manifest vouches for it, so nothing was pushed or published (ask the Captain before changing --results)`);
      if (trialViews().has(`${harness}/${segs[2]}/${digest}`)) continue;
    }
    if (!statSync(f).isFile()) continue;
    if (!safeRelPath(rel)) throw new RunnerError('HE-SEALED-007', `raw results hold a path a bundle cannot carry (${rel.length} characters, non-printable or ".."); rename or remove it before export`);
    entries.push({ path: rel, data: new Uint8Array(readFileSync(f)) });
  }
  return entries;
}

export const entriesDigest = (entries: TarEntry[]): string => sha256([...entries].sort((a, b) => (a.path < b.path ? -1 : 1)).map((e) => `${sha256(e.data)}  ${e.path}`).join('\n'));

export interface ExportOptions {
  repo: string;
  results: string;
  sealedRoot: string;
  receipt: string;
  /** The isolated custody clone (default ~/.capy/work/custody/harness-evals, made when missing). */
  custody?: string;
  /** The gh binary asked for the repository's visibility (default gh on PATH). */
  gh?: string;
  out?: string;
  mode?: 'embargo';
  remote?: string;
  custodian?: string;
  now?: () => string;
  log?: (l: string) => void;
}

export async function exportRun(o: ExportOptions): Promise<{ out: string; export: Record<string, unknown> }> {
  const repo = resolve(o.repo), raw = resolve(o.results);
  const log = o.log ?? ((l: string) => console.log(l));
  const now = o.now ?? (() => new Date().toISOString());
  checkPrivate(CUSTODY_REPO, o.gh);
  const remote = o.remote ?? 'origin';
  if (insideGitTree(raw)) throw new RunnerError('HE-SEALED-002', `--results ${raw} is inside a git work tree; a sealed run's raw results stay outside every checkout until release`);
  const manifest = JSON.parse(readFileSync(join(raw, 'manifest.json'), 'utf8')) as Manifest;
  if (!manifest.sealed) throw new RunnerError('HE-SEALED-007', `${raw}/manifest.json was not planned with a sealed root; export.ts publishes sealed runs only`);
  const ctx = openSealedContext({ sealedRoot: o.sealedRoot, receiptPath: o.receipt, set: manifest.sealed.set, runId: manifest.run_id, preregSha: manifest.prereg_sha256, candidate: manifest.sealed.receipt.candidate_sha256, label: manifest.sealed.receipt.label, expectReceipt: manifest.sealed.receipt, root: repo });
  const receipt: OpeningReceipt = ctx.receipt;
  const preregBytes = readFileSync(join(repo, receipt.prereg_json));
  if (sha256(preregBytes) !== receipt.prereg_sha256) throw new RunnerError('HE-SEALED-003', `${receipt.prereg_json} changed since the opening`);
  const prereg = JSON.parse(preregBytes.toString('utf8')) as { heldout?: { claims?: HeldoutClaim[] } };
  const claims = prereg.heldout?.claims ?? [];
  const claimed = claimProblems(prereg.heldout?.claims, manifest.cells.map((c) => c.id));
  if (claimed.length) throw new RunnerError('HE-SEALED-007', `${receipt.prereg_json}: ${claimed.join('; ')}`);
  const set = heldoutSet(receipt.set, repo);
  const setManifest = readManifest(set);
  const ledger = openingsLedger(setManifest);
  if (!ledger) throw new RunnerError('HE-SEALED-007', `set ${receipt.set} has no openings ledger`);
  const recipient = setManifest?.sealed?.recipient ?? '';
  const recipientFile = join(repo, 'sealed', 'recipient.txt');
  const committed = existsSync(recipientFile) ? readFileSync(recipientFile, 'utf8').trim() : '';
  if (!recipient || recipient !== committed) throw new RunnerError('HE-SEALED-007', `set ${receipt.set} is sealed to ${recipient ? `${recipient.slice(0, 16)}...` : 'no recipient'}, but sealed/recipient.txt holds ${committed ? `${committed.slice(0, 16)}...` : 'nothing'}; the raw results would be encrypted to a key the custody identity may not open, so nothing was written or pushed`);

  const want = join(repo, dirname(receipt.prereg_json), 'sealed-results');
  const out = resolve(o.out ?? want);
  if (out !== want) throw new RunnerError('HE-SEALED-007', `--out ${out} is not ${relative(repo, want)}, the run's sealed-results directory beside its preregistration, where the publication and receipts-manifest checks look`);
  const prior = join(out, 'export.json');
  let priorRun: unknown;
  try { priorRun = existsSync(prior) ? (JSON.parse(readFileSync(prior, 'utf8')) as { run_id?: unknown }).run_id : undefined; } catch { priorRun = undefined; }
  if (priorRun !== undefined && priorRun !== receipt.run_id) throw new RunnerError('HE-SEALED-007', `${prior} belongs to another run`);
  // staged files live under the digest of the bundle they name, so two exports of one run never publish each other's files
  const pendingRoot = join(raw, EXPORT_PENDING);
  const clone = custodyClone({ dir: o.custody, repo, remote });
  const resultsRel = `${receipt.set}/results/${receipt.run_id}.tar.age`;
  /** Refuses a released set, and a receipt unless its access.event_sha256 is a sha256 equal to the digest of the run's first
   *  "opened" line in the access log (a missing line and a missing digest are refused, never taken as equal). */
  const checkCustody = () => {
    if (readAccessLog(clone).some((e) => e.event === 'released' && e.set === receipt.set)) throw new RunnerError('HE-SEALED-007', `set ${receipt.set} has a "released" line in the access log on ${CUSTODY_REF}; a released set takes no export, since release has already written the set's receipts and this run's would never be released. Nothing was pushed or published`);
    const admitted = openedRuns(clone, receipt.set).get(receipt.run_id)?.sha256;
    const claimed: unknown = receipt.access?.event_sha256;
    if (!admitted || typeof claimed !== 'string' || !/^[0-9a-f]{64}$/.test(claimed) || claimed !== admitted) throw new RunnerError('HE-SEALED-007', `the opening receipt's access.event_sha256 (${String(claimed ?? 'none').slice(0, 12)}) is not the digest of run ${receipt.run_id}'s "opened" line in the access log on ${CUSTODY_REF} (${admitted ? admitted.slice(0, 12) : 'no such line'}); export publishes only an opening open.ts admitted. Nothing was pushed or published`);
  };
  const { logged, onCustody } = withCustodyLock(clone, () => {
    syncCustody(clone, remote);
    checkCustody();
    const p = join(clone, resultsRel);
    return { logged: readAccessLog(clone).filter((e) => e.event === 'exported' && e.run_id === receipt.run_id), onCustody: existsSync(p) ? sha256(readFileSync(p)) : null };
  });
  if (onCustody || logged.length) {
    // A sealed results bundle is never replaced (its encryption is randomized, so a new one would have another digest).
    // The public files staged before the push can still finish an export whose write into --out did not complete.
    const pushed = onCustody && logged.length && logged.every((e) => e.results_bundle_sha256 === onCustody) ? onCustody : null;
    const names = (dir: string): Record<string, unknown> | null => {
      try { const e = JSON.parse(readFileSync(join(dir, 'export.json'), 'utf8')); return pushed && e.run_id === receipt.run_id && e.sealed_results?.results_bundle_sha256 === pushed && PUBLIC_FILES.every((n) => existsSync(join(dir, n))) ? e : null; } catch { return null; }
    };
    const pending = join(pendingRoot, pushed ?? 'none');
    const staged = names(pending);
    if (staged && PUBLIC_FILES.some((n) => !existsSync(join(out, n)) || !readFileSync(join(out, n)).equals(readFileSync(join(pending, n))))) {
      publish(pending, out);
      log(`EXPORT: ${relative(repo, out)} finished from the files staged in ${pending} before the push; they name ${resultsRel} (${pushed!.slice(0, 12)}), which ${CUSTODY_REF} holds with its exported line`);
      log(`EXPORT: next: commit ${relative(repo, out)}/ in a results pull request; remove the plaintext with bun scripts/sealed/cleanup.ts --export ${relative(repo, out)}/export.json --results ${raw} --sealed-root ${ctx.root}`);
      return { out, export: staged };
    }
    if (staged || names(out)) throw new RunnerError('HE-SEALED-007', `run ${receipt.run_id} is already exported and its public export is complete: ${relative(repo, out)}/ holds the three files, and its export.json names ${resultsRel} (${pushed!.slice(0, 12)}), which ${CUSTODY_REF} holds with its exported line; a sealed results bundle is never replaced. Nothing was written`);
    const state = (dir: string) => (existsSync(join(dir, 'export.json')) ? 'names another run or bundle, or lacks one of the three files' : 'is missing');
    const missing = !onCustody ? `${CUSTODY_REF} has ${logged.length} exported line(s) for the run but no ${resultsRel}`
      : !pushed ? `${CUSTODY_REF} holds ${resultsRel} (${onCustody.slice(0, 12)}) with ${logged.length} exported line(s) for the run, naming ${logged.map((e) => String(e.results_bundle_sha256 ?? 'no digest').slice(0, 12)).join(', ') || 'nothing'}`
      : `${CUSTODY_REF} holds ${resultsRel} (${pushed.slice(0, 12)}) with its exported line, but ${relative(repo, out)}/export.json ${state(out)} and the staged ${pending}/export.json ${state(pending)}`;
    throw new RunnerError('HE-SEALED-007', `run ${receipt.run_id} is already exported and its public export cannot be finished: ${missing}. A sealed results bundle is never replaced, so a new export cannot stand in for it; nothing was written (report this to the Captain)`);
  }

  const bun = process.execPath;
  const runScript = (args: string[]) => {
    const r = spawnSync(bun, args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const logFile = join(raw, `export.${basename(args[0]!, '.ts')}.log`);
    appendFileSync(logFile, `--- ${args.slice(1).join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}`, { mode: 0o600 });
    if (r.status !== 0) throw new RunnerError('HE-SEALED-007', `${basename(args[0]!)} failed inside custody (exit ${r.status}); its output is in ${logFile} (custody only)`);
  };
  runScript([join(ROOT, 'scripts', 'summarize-run.ts'), '--results', raw, '--sealed-root', ctx.root]);
  const compare = (source: string, extra: string[]) => {
    if (source === 'comparisons.json') runScript([join(ROOT, 'scripts', 'compare-run.ts'), '--results', raw, '--sealed-root', ctx.root, ...extra]);
    else if (source === 'comparisons.gbrain.json') runScript([join(ROOT, 'scripts', 'compare-run.ts'), '--results', raw, '--pair', 'gbrain', '--sealed-root', ctx.root, ...extra]);
    else throw new RunnerError('HE-SEALED-007', `claim source ${source} is not one export.ts makes: it makes only comparisons.json and comparisons.gbrain.json, from trials.jsonl, and refuses any other claim source`);
  };
  // A claim whose gate failed is dropped before any comparison is read, so it never enters a Holm family.
  const dropped = failedGates(claims, raw);
  const live = claims.filter((c) => !dropped.has(c.id));
  for (const source of [...new Set(live.map((c) => c.source))]) {
    compare(source, []);
    // Noninferiority claims need their one-sided p against the margin: the comparison is made again with one --margin per claim.
    const ni = live.filter((c) => c.source === source && c.rule === 'noninferiority');
    if (!ni.length) continue;
    const file = JSON.parse(readFileSync(join(raw, source), 'utf8'));
    const specs = ni.map((c) => {
      const pair = entryPair(claimEntry(c, file));
      if (!pair) throw new RunnerError('HE-SEALED-007', `claim ${c.id}: the matched entry of ${source} names no cell pair for a noninferiority margin`);
      return ['--margin', [pair[0], pair[1], String(c.margin), c.direction === 'increase' ? 'higher' : 'lower', ...(pair[2] ? [pair[2]] : [])].join(',')];
    });
    compare(source, specs.flat());
  }
  const decisions = decide(claims, (s) => JSON.parse(readFileSync(join(raw, s), 'utf8')), ledger.alpha_per_opening, dropped);
  // The family is published beside each embargoed bit only when an opening has more than one family or a dropped claim.
  const familyNamed = decisions.some((d) => d.family !== 'primary' || d.decision === 'dropped');

  const opened = withCustodyLock(clone, () => { syncCustody(clone, remote); checkCustody(); return openedRuns(clone, receipt.set); });
  const confirmatoryOpened = [...opened.values()].filter((x) => x.event.label === 'confirmatory').length;
  const reserveUnused = confirmatoryOpened < ledger.opening_budget && ledger.status !== 'retired';
  const mode: 'embargo' | 'full' = reserveUnused || o.mode === 'embargo' ? 'embargo' : 'full';
  const claimSentence = new Map(claims.map((c) => [c.id, c.sentence.trim().replace(/\.$/, '')]));
  // Under the embargo, and for a secondary claim in every mode (bits only), a decision publishes its bit and the
  // preregistered wording only: no estimate, interval or p.
  const bitsOnly = (d: Decision) => mode === 'embargo' || d.family === 'secondary';
  const sentenceOf = (d: Decision) => (bitsOnly(d) && d.decision !== 'dropped' ? `${d.claim}: ${d.decision === 'accept' ? 'accepted' : 'rejected'}. ${claimSentence.get(d.claim)}.` : d.sentence);
  const rows = readFileSync(join(raw, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const scored = rows.filter((t) => !EXCLUDED.has(t.termination));
  let opening: number | null = null;
  try { opening = deriveSet(repo, receipt.set)?.openings.find((x) => x.run_id === receipt.run_id)?.number ?? null; } catch { opening = null; }

  const entries = (() => {
    if (mode === 'full') {
      const salt = readFileSync(join(ctx.root, OPAQUE_SALT_FILE), 'utf8').trim();
      const ids = [...new Set(rows.map((t) => t.task))].map((t) => [opaqueId(salt, t), t]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
      writeFileSync(join(raw, 'opaque-task-ids.json'), JSON.stringify(Object.fromEntries(ids), null, 1) + '\n');
    }
    return rawEntries(raw);
  })();
  const fileSha = (n: string) => (existsSync(join(raw, n)) ? sha256(readFileSync(join(raw, n))) : null);
  const rawFiles = Object.fromEntries(entries.filter((e) => !e.path.includes('/') && /\.(jsonl|json|sqlite|ndjson)$/.test(e.path)).map((e) => [e.path, sha256(e.data)]));
  const receiptBytes = readFileSync(o.receipt);
  const resultsBundle = await encryptTo(recipient, gzipSync(packTar(entries)));
  if (resultsBundle.length > MAX_RESULTS_BUNDLE_BYTES) throw new RunnerError('HE-SEALED-007', `the encrypted raw results bundle is ${(resultsBundle.length / 1048576).toFixed(1)} MiB after gzip, over the ${MAX_RESULTS_BUNDLE_BYTES / 1048576} MiB one pushed file may hold; split bundles are not supported yet, so nothing was written or pushed (ask the Captain before removing anything from --results)`);

  const exp: Record<string, unknown> = {
    schema_version: 1, kind: 'sealed-export', tool: 'scripts/sealed/export.ts', written_at: now(),
    run_id: receipt.run_id, set: receipt.set, opening, label: receipt.label, reason: receipt.reason, mode,
    budget: { opening_budget: ledger.opening_budget, alpha_per_opening: ledger.alpha_per_opening, confirmatory_opened: confirmatoryOpened, reserve_unused: reserveUnused },
    decisions: decisions.map((d) => (bitsOnly(d) ? { claim: d.claim, decision: d.decision, ...(familyNamed ? { family: d.family } : {}), sentence: sentenceOf(d) } : d)),
    trials: { planned: manifest.trials.length, recorded: rows.length, scored: scored.length, excluded: rows.length - scored.length },
    spend_usd: +rows.reduce((a, t) => a + (t.usage?.usd ?? 0), 0).toFixed(4),
    receipt_sha256: sha256(receiptBytes),
    commitments: { bundle_sha256: receipt.bundle_sha256, tree_sha256: receipt.tree_sha256, world_slice_sha256: receipt.world_slice_sha256, heldout_corpus_sha256: receipt.heldout_corpus_sha256, world_sha256: receipt.world_sha256, candidate_sha256: receipt.candidate_sha256, prereg_sha256: receipt.prereg_sha256, access_event_sha256: receipt.access.event_sha256 },
    sealed_results: { repository_path: resultsRel, results_bundle_sha256: sha256(resultsBundle), raw_tree_sha256: entriesDigest(entries), raw_files: rawFiles, trials_jsonl_sha256: fileSha('trials.jsonl') },
  };
  if (mode === 'full') {
    const summary = JSON.parse(readFileSync(join(raw, 'summary.json'), 'utf8')) as { cells: Record<string, Record<string, unknown>> };
    exp.cells = Object.fromEntries(Object.entries(summary.cells).map(([id, c]) => [id, Object.fromEntries(['n', 'passes', 'pass_rate', 'ci95', 'task_clusters', 'excluded', 'consent_violations', 'usd_total'].map((k) => [k, c[k] ?? null]))]));
    const ids = JSON.parse(readFileSync(join(raw, 'opaque-task-ids.json'), 'utf8')) as Record<string, string>;
    const byTask = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    const per: Record<string, Record<string, { passes: number; trials: number }>> = {};
    for (const t of scored) { const e = ((per[byTask[t.task]!] ??= {})[t.cell] ??= { passes: 0, trials: 0 }); e.trials++; if (t.grade === 'pass' && !t.consent_violation) e.passes++; }
    exp.per_task = Object.keys(per).sort().map((k) => ({ task: k, cells: per[k] }));
  }

  const readme = [
    `# Sealed opening: ${receipt.run_id}`, '',
    `Set ${receipt.set}, opening ${opening ?? 'unknown'}, ${receipt.label}${receipt.reason ? ` (${receipt.reason})` : ''}. Export mode: ${mode}${mode === 'embargo' ? ' (the set\'s reserve opening is unused, so only the preregistered decisions are published; per-cell and per-task results come with the full export at release)' : ''}.`, '',
    '## Decisions', '', ...decisions.map((d) => `- ${sentenceOf(d)}`), '',
    `${rows.length} of ${manifest.trials.length} planned trials recorded, ${rows.length - scored.length} excluded; spend $${(exp.spend_usd as number).toFixed(2)}. The raw receipts are sealed on the repository's custody branch until the set retires; export.json lists their digests (docs/sealed-custody.md).`, '',
  ].join('\n');
  const files: Record<string, string> = { 'export.json': JSON.stringify(exp, null, 1) + '\n', 'opening-receipt.json': receiptBytes.toString('utf8'), 'README.md': readme };
  // Text that is public anyway: the world, the preregistration, the set's manifest and, for a repo set, its dev split as
  // committed at HEAD (never the working tree). This script's source is template text (every word and key it prints, so a
  // task string such as "accepted" is no leak), which exempts only strings of eight or more characters.
  const devFiles = set.kind === 'repo' ? git(repo, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', `tasks/repo/${receipt.set}/dev`]).split('\0').filter(Boolean) : [];
  const publicTexts = [readFileSync(join(repo, 'world', 'seed', 'world.json'), 'utf8'), preregBytes.toString('utf8'), readFileSync(set.manifest, 'utf8'), ...devFiles.map((f) => git(repo, ['show', `HEAD:${f}`]))];
  const hits = leakScan(files, collectSecrets({ root: ctx.root, set: receipt.set, raw, publicTexts, templateText: readFileSync(import.meta.path, 'utf8') }));
  if (hits.length) throw new RunnerError('HE-SEALED-007', `the public export would carry sealed content: ${hits.length} hit(s) (${[...new Set(hits.map((h) => `${h.file}: ${h.kind}`))].join('; ')}); nothing was written`);

  // The public files are staged in the raw results before the push and reach --out only once custody holds the bundle they
  // name: a failed push leaves no export.json, and a crash after the push is finished by a rerun from the staged files.
  const pending = join(pendingRoot, sha256(resultsBundle));
  mkdirSync(pending, { recursive: true, mode: 0o700 });
  chmodSync(pendingRoot, 0o700);
  chmodSync(pending, 0o700);
  for (const n of PUBLIC_FILES) writeFileSync(join(pending, n), files[n]!, { mode: 0o600 });
  const bundleSha = sha256(resultsBundle);
  // A push reported as failed may still have landed; the retry then finds this export's line (its digest is new to this
  // export) and stops instead of appending a second one.
  const landed = new Error('the exported line already landed');
  let commit: string;
  try {
    commit = compareAndPush(clone, {
      remote,
      message: () => `export ${receipt.run_id} (set ${receipt.set}, ${mode})`, onFailure: 'nothing was published',
      decide: () => {
        checkCustody();
        if (readAccessLog(clone).some((e) => e.event === 'exported' && e.run_id === receipt.run_id && e.results_bundle_sha256 === bundleSha) && existsSync(join(clone, resultsRel)) && sha256(readFileSync(join(clone, resultsRel))) === bundleSha) throw landed;
        return { schema_version: 1, event: 'exported', at: now(), run_id: receipt.run_id, set: receipt.set, label: receipt.label, results_bundle_sha256: bundleSha, custodian: o.custodian ?? 'scripts/sealed/export.ts' };
      },
      stage: () => { const p = join(clone, resultsRel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, resultsBundle); return [resultsRel]; },
    }).commit;
  } catch (e) {
    if (e !== landed) throw e;
    commit = git(clone, ['rev-parse', 'HEAD']);
  }
  publish(pending, out);
  log(`EXPORT: ${relative(repo, out)} (${mode}; ${decisions.filter((d) => d.decision === 'accept').length} of ${decisions.length} claims accepted${dropped.size ? `, ${dropped.size} dropped by a failed gate` : ''}); raw results sealed at ${resultsRel} (${bundleSha.slice(0, 12)}) on ${CUSTODY_REF} in ${commit.slice(0, 12)}; leak scan clean`);
  log(`EXPORT: next: commit ${relative(repo, out)}/ in a results pull request; remove the plaintext with bun scripts/sealed/cleanup.ts --export ${relative(repo, out)}/export.json --results ${raw} --sealed-root ${ctx.root}`);
  return { out, export: exp };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const need = ['results', 'sealed-root', 'opening-receipt'].filter((k) => !flag(k));
  if (need.length) { console.error(`HE-RUN-002 missing --${need.join(', --')} (see the header of scripts/sealed/export.ts)`); process.exit(2); }
  const mode = flag('mode');
  if (mode && mode !== 'embargo') { console.error('HE-RUN-002 --mode takes embargo only; full mode follows from the ledger and the access log'); process.exit(2); }
  try {
    await exportRun({ repo: flag('repo') ?? process.cwd(), results: flag('results')!, sealedRoot: flag('sealed-root')!, receipt: flag('opening-receipt')!, custody: flag('custody'), out: flag('out'), mode: mode as 'embargo' | undefined, remote: flag('remote'), custodian: flag('custodian') });
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    console.error(`HE-SEALED-007 export failed: ${e instanceof Error ? e.constructor.name : 'error'} (message withheld; it may quote sealed content)`);
    process.exit(2);
  }
}
