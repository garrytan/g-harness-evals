#!/usr/bin/env bun
/**
 * Open a sealed held-out set for one preregistered run (custodian only; docs/sealed-custody.md).
 *
 *   bun scripts/sealed/open.ts --prereg docs/benchmarks/<run>/prereg.json [--custody <isolated custody clone>]
 *        [--identity <drive copy>] [--repo <public checkout, default .>] [--out <dir>, default ~/.capy/work/sealed/<run_id>]
 *        [--remote origin] [--custodian <name>]
 *   bun scripts/sealed/open.ts --close <dir>      remove an opened root after export (the custody close step)
 *
 * Two refs, never mixed: the public ref <remote>/main (always main; there is no --branch) holds the preregistration, the
 * ledger and the set's MANIFEST.json; the custody ref refs/heads/custody of the same repository holds the bundle, the
 * escrow and the access log, and is read and written only through the isolated custody clone (--custody, default
 * ~/.capy/work/custody/harness-evals; scripts/sealed/custody.ts). In order, before anything is decrypted:
 *   0. The repository must be private (gh api repos/garrytan/harness-evals -q .private answers true; HE-SEALED-013).
 *   1. The public checkout must be clean and at <remote>/main after a fetch: the preregistration, its heldout block and
 *      the set's MANIFEST.json are read there, so the ledger row is checked against current main (runner/heldout/openings.ts
 *      checkPlan: the row exists, matches the block and is within budget by preregistration order).
 *   2. The custody clone is synced to the custody ref; the set must be sealed and its bundle there must have the committed
 *      bundle_sha256; the escrow check must pass (keygen.ts --check-escrow: the drive copy and the escrow under the current
 *      UBICLOUD_API_KEY both derive sealed/recipient.txt, HE-SEALED-012), and that recipient must be the one the set was
 *      sealed to; the output directory must be outside every git work tree and empty, or an earlier root of this same run.
 *   3. Admission against current state, rerun on every attempt of the custody transaction: main is fetched again, the
 *      checkout must still be clean and at <remote>/main, the preregistration, the set's whole sealed block and
 *      sealed/recipient.txt must be unchanged, and checkPlan and the row checks rerun on that fresh tree, so a withdrawal,
 *      amendment or order change that landed since step 1 is seen. The access log on the custody ref decides what was
 *      consumed. A set with a "released" line there takes no opening or resume (its plaintext is on its way to main). A
 *      run already opened there resumes only with the same candidate, preregistration digest, label and bundle
 *      (idempotent; a "resumed" line is logged). A new opening needs its public row to be planned; a confirmatory one needs the set open, a candidate never
 *      opened confirmatory on the set, and the confirmatory openings already logged (whatever their public rows now say: a
 *      withdrawn or superseded row never refunds an opening) plus this one within opening_budget. The "opened" line is
 *      committed, validated and pushed to refs/heads/custody without force; when the push is rejected because another
 *      opening landed first, the custody ref is fetched again and the whole admission reruns, so two opens can never both
 *      take the last opening. A push that keeps failing ends the open before anything is decrypted. The two refs cannot
 *      move in one transaction: a main change landing after the push that admitted the opening is not seen by it, and the
 *      custody log stays the record of what was opened.
 * Then the bundle is decrypted into the output directory (files 0600), every entry checked (an extras/ file only when the
 * manifest's sealed.extras lists it with the same sha256, and every listed one present), the world slice merged into the
 * public world as world/world.json, every digest verified against the public commitments, and opening-receipt.json
 * written. Any failure after decryption removes the directory. Output names paths and digests only, never content.
 *
 * A repo set (MANIFEST.json "kind": "repo", tasks/repo/<set>/): the bundle is decrypted into the root the same
 * way (tasks/repo/<set>/heldout/, generator/ when the set has one, extras/, opaque-salt), with no world slice to merge and
 * no world or corpus check; the task tree and generator digests are verified, and the receipt says kind "repo" with the
 * world and corpus digests null. open.ts does not hand off to runner/run.ts, which runs multi-user cells only: it prints
 * the access-log line, the root's path and its counts, and the bridge that runs repository tasks reads the root.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { checkPlan, claimProblems, deriveSet, heldoutSetsOf, type HeldoutBlock } from '../../runner/heldout/openings.ts';
import { bundleEntryProblem, corpusDigest, decryptWith, mergeWorld, OPAQUE_SALT_FILE, RECEIPT_FILE, readReceipt, renderWorld, sealedPaths, sha256, sliceProblems, unpackTar, type OpeningReceipt, type WorldSlice } from '../../runner/heldout/sealed.ts';
import { heldoutSet, openingsLedger, readManifest, treeFiles, type HeldoutManifest } from '../seal-heldout.ts';
import type { World } from '../../world/types.ts';
import { checkCustodyRemoteOf, checkPrivate, compareAndPush, CUSTODY_REF, CUSTODY_REPO, custodyClone, ESCROW_FILE, git, insideGitTree, netEnv, openedRuns, readAccessLog, syncCustody, type AccessEvent } from './custody.ts';
import { custodyIdentity } from './identity.ts';

export interface OpenOptions {
  repo: string;
  prereg: string;
  /** The isolated custody clone (default ~/.capy/work/custody/harness-evals, made when missing). */
  custody?: string;
  /** The drive copy of the custody identity (default identity.ts DEFAULT_IDENTITY_PATH). */
  identityPath?: string;
  /** Where UBICLOUD_API_KEY is read for the escrow check (default process.env). */
  env?: Record<string, string | undefined>;
  /** The gh binary asked for the repository's visibility (default gh on PATH). */
  gh?: string;
  out?: string;
  remote?: string;
  custodian?: string;
  now?: () => string;
  log?: (line: string) => void;
  /** Called after the access-log commit and before its push (the race tests run another custodian here). */
  beforePush?: () => void;
}

export interface OpenResult { root: string; receipt: OpeningReceipt; resumed: boolean; opening: number | null }

export async function openRun(o: OpenOptions): Promise<OpenResult> {
  const remote = o.remote ?? 'origin', branch = 'main';
  const now = o.now ?? (() => new Date().toISOString());
  const log = o.log ?? ((l: string) => console.log(l));
  const repo = resolve(o.repo);
  const fail = (code: string, msg: string): never => { throw new RunnerError(code, msg); };
  checkPrivate(CUSTODY_REPO, o.gh);

  // 1. the public checkout at current main (read again at every admission attempt, step 3)
  const readMain = () => {
    checkCustodyRemoteOf(repo, remote);
    git(repo, ['fetch', '-q', remote, branch], netEnv());
    const publicCommit = git(repo, ['rev-parse', `${remote}/${branch}`]);
    if (git(repo, ['rev-parse', 'HEAD']) !== publicCommit) fail('HE-SEALED-006', `the public checkout ${repo} is at ${git(repo, ['rev-parse', '--short', 'HEAD'])}, not ${remote}/${branch} (${publicCommit.slice(0, 12)}); open checks the ledger at current main: git checkout --detach ${remote}/${branch}`);
    if (git(repo, ['status', '--porcelain', '--untracked-files=no'])) fail('HE-SEALED-006', `the public checkout ${repo} has local changes; open reads the ledger from a clean checkout of ${remote}/${branch}`);
    const preregPath = relative(repo, resolve(repo, o.prereg));
    if (!existsSync(join(repo, preregPath))) fail('HE-SEALED-006', `${preregPath} is not on ${remote}/${branch}; a sealed set opens only for a preregistration merged to main`);
    const raw = readFileSync(join(repo, preregPath));
    const preregSha = sha256(raw);
    const prereg = JSON.parse(raw.toString('utf8')) as { run_id: string; cells: Array<{ id?: string; split: string; task_set?: string }>; heldout?: HeldoutBlock };
    const block = prereg.heldout;
    const sets = heldoutSetsOf(prereg);
    if (!block || sets.length !== 1 || block.set !== sets[0]) fail('HE-SEALED-006', `${preregPath} must run held-out cells of exactly one set and carry a heldout block naming it`);
    const setName = block!.set;
    const set = heldoutSet(setName, repo);
    const manifest = readManifest(set);
    if (manifest?.custody !== 'sealed' || !manifest.sealed) fail('HE-SEALED-006', `set ${setName} is not in sealed custody (${relative(repo, set.manifest)} has no "custody": "sealed")`);
    const claimed = claimProblems(block!.claims, prereg.cells.map((c) => String(c.id)));
    if (claimed.length) fail('HE-SEALED-006', `${preregPath}: ${claimed.join('; ')}; nothing was opened, since export.ts could not decide these claims and the opening would be spent`);
    const m = manifest as HeldoutManifest & { sealed: NonNullable<HeldoutManifest['sealed']> };
    return { publicCommit, preregPath, preregSha, prereg, block: block!, setName, set, m, ledger: openingsLedger(m) };
  };
  const atStart = readMain();
  const { preregPath, preregSha, prereg, block, setName, set, m } = atStart;
  let publicCommit = atStart.publicCommit;
  let planLines = checkPlan(prereg, preregSha, repo);
  let ledger = atStart.ledger!;

  // 2. the custody ref: bundle, escrow check, identity and output directory
  const clone = custodyClone({ dir: o.custody, repo, remote });
  syncCustody(clone, remote);
  const bundlePath = join(clone, m.sealed.bundle);
  if (!existsSync(bundlePath)) fail('HE-SEALED-006', `${CUSTODY_REF} has no ${m.sealed.bundle}`);
  const bundle = readFileSync(bundlePath);
  if (sha256(bundle) !== m.sealed.bundle_sha256) fail('HE-SEALED-006', `${m.sealed.bundle} has sha256 ${sha256(bundle).slice(0, 12)}, the public commitment is ${m.sealed.bundle_sha256.slice(0, 12)}; the bundle changed since sealing`);
  const recipientFile = join(repo, 'sealed', 'recipient.txt');
  if (!existsSync(recipientFile)) fail('HE-SEALED-012', `sealed/recipient.txt is not on ${remote}/${branch}; the escrow check compares against it`);
  const recipient = readFileSync(recipientFile, 'utf8').trim();
  if (recipient !== m.sealed.recipient) fail('HE-SEALED-006', `sealed/recipient.txt (${recipient.slice(0, 16)}...) is not the recipient set ${setName} was sealed to (${m.sealed.recipient.slice(0, 16)}...)`);
  const identity = await custodyIdentity({ identityPath: o.identityPath, escrowPath: join(clone, ESCROW_FILE), recipient, env: o.env });
  const out = resolve(o.out ?? join(homedir(), '.capy', 'work', 'sealed', prereg.run_id));
  if (insideGitTree(out)) fail('HE-SEALED-002', `--out ${out} is inside a git work tree; sealed plaintext stays outside every checkout`);
  if (existsSync(out) && readdirSync(out).length) {
    const prior = existsSync(join(out, RECEIPT_FILE)) ? readReceipt(join(out, RECEIPT_FILE)) : null;
    if (!prior) fail('HE-SEALED-006', `--out ${out} exists and is not an opened root; choose an empty directory`);
    if (prior!.run_id !== prereg.run_id) fail('HE-SEALED-006', `--out ${out} holds the opened root of run ${prior!.run_id}; close it first (bun scripts/sealed/open.ts --close ${out}) or choose another directory`);
  }

  // 3. admission against current main and current custody state, then the push
  const custodian = o.custodian ?? 'scripts/sealed/open.ts';
  let resumedFrom: { event: AccessEvent; sha256: string } | undefined;
  const canonical = (block: object) => JSON.stringify(Object.entries(block).sort(([a], [b]) => (a < b ? -1 : 1)));
  const pushed = compareAndPush(clone, {
    remote, beforePush: o.beforePush,
    message: (e) => `${e.event === 'opened' ? 'open' : 'resume'} ${e.run_id} (set ${e.set}, ${e.label})`,
    decide: () => {
      const fresh = readMain();
      const freshRecipient = existsSync(recipientFile) ? readFileSync(recipientFile, 'utf8').trim() : '';
      if (fresh.preregSha !== preregSha || fresh.setName !== setName || canonical(fresh.m.sealed) !== canonical(m.sealed) || freshRecipient !== recipient) fail('HE-SEALED-006', `${preregPath}, the sealed block of set ${setName} or sealed/recipient.txt changed on ${remote}/${branch} during admission (prereg sha256 ${preregSha.slice(0, 12)} now ${fresh.preregSha.slice(0, 12)}, bundle sha256 ${m.sealed.bundle_sha256.slice(0, 12)} now ${fresh.m.sealed.bundle_sha256.slice(0, 12)}); nothing was pushed or decrypted, rerun open`);
      if (!fresh.ledger) fail('HE-SEALED-006', `${relative(repo, set.manifest)} lost its openings ledger on ${remote}/${branch} during admission; nothing was pushed or decrypted`);
      publicCommit = fresh.publicCommit;
      ledger = fresh.ledger!;
      if (readAccessLog(clone).some((e) => e.event === 'released' && e.set === setName)) fail('HE-SEALED-006', `set ${setName} has a "released" line in the access log on ${CUSTODY_REF}; a released set takes no opening or resume, since its plaintext is on its way to main. Nothing was pushed or decrypted`);
      const opened = openedRuns(clone, setName);
      const base = { schema_version: 1 as const, at: now(), run_id: prereg.run_id, set: setName, label: block!.label, candidate_sha256: block!.candidate_sha256, prereg_json: preregPath, prereg_sha256: preregSha, public_ref: `${remote}/${branch}`, public_commit: publicCommit, bundle_sha256: m.sealed.bundle_sha256, custodian };
      const mine = opened.get(prereg.run_id);
      if (mine) {
        for (const k of ['candidate_sha256', 'prereg_sha256', 'label', 'bundle_sha256'] as const) {
          if (mine.event[k] !== base[k]) fail('HE-SEALED-006', `run ${prereg.run_id} was opened with ${k} ${String(mine.event[k]).slice(0, 16)}, and now asks with ${String(base[k]).slice(0, 16)}; a resume reopens the same opening exactly, anything else is a new run id`);
        }
        planLines = checkPlan(prereg, preregSha, repo);
        resumedFrom = mine;
        return { ...base, event: 'resumed', opened_event_sha256: mine.sha256 };
      }
      resumedFrom = undefined;
      if (block!.label === 'confirmatory') {
        if (ledger.status !== 'open') fail('HE-SEALED-006', `set ${setName} is ${ledger.status}; it takes no new confirmatory opening`);
        const confirmed = [...opened.values()].filter((x) => x.event.label === 'confirmatory');
        const reused = confirmed.find((x) => x.event.candidate_sha256 === block!.candidate_sha256);
        if (reused) fail('HE-SEALED-006', `candidate ${block!.candidate_sha256.slice(0, 12)} already had its confirmatory opening of set ${setName} (run ${reused.event.run_id}); a candidate gets one`);
        const publicOnly = ledger.openings.filter((r) => r.label === 'confirmatory' && r.status === 'opened' && !opened.has(r.run_id)).length;
        const used = confirmed.length + publicOnly;
        if (used + 1 > ledger.opening_budget) fail('HE-SEALED-006', `set ${setName} has had ${used} confirmatory opening(s) (${confirmed.map((x) => x.event.run_id).join(', ') || 'none in custody'}) against a budget of ${ledger.opening_budget}; withdrawn or superseded rows never refund an opening that was opened`);
      }
      planLines = checkPlan(prereg, preregSha, repo);
      const row = ledger.openings.find((r) => r.run_id === prereg.run_id)!;
      if (row.status !== 'planned') fail('HE-SEALED-006', `run ${prereg.run_id}'s ledger row is ${row.status} on main but custody has no opening for it; only a planned row opens`);
      return { ...base, event: 'opened' };
    },
  });
  const resumed = pushed.event.event === 'resumed';
  const first = resumed ? resumedFrom! : { event: pushed.event, sha256: pushed.sha256 };
  log(`CUSTODY: ${resumed ? 'resumed' : 'opened'} run ${prereg.run_id} on set ${setName} (${block!.label}); access-log line ${pushed.sha256.slice(0, 12)} pushed to ${CUSTODY_REF} in ${pushed.commit.slice(0, 12)}`);

  // 4. decrypt, unpack, merge, verify, receipt
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  try {
    const kind = set.kind;
    const entries = unpackTar(await decryptWith(identity, new Uint8Array(bundle)));
    const problem = bundleEntryProblem(entries, setName, m.sealed.extras, kind);
    if (problem) throw new RunnerError('HE-SEALED-006', problem);
    for (const e of entries) {
      const dest = join(out, e.path);
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      writeFileSync(dest, e.data, { mode: e.exec ? 0o700 : 0o600 });
    }
    const p = sealedPaths(out, setName, kind);
    if (!existsSync(join(out, OPAQUE_SALT_FILE))) throw new RunnerError('HE-SEALED-006', `the bundle has no ${OPAQUE_SALT_FILE}; reseal the set with scripts/sealed/seal.ts`);
    const taskCount = () => (existsSync(p.tasks) ? readdirSync(p.tasks, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(p.tasks, d.name, 'task.toml'))).length : 0);
    const openingNumber = () => { try { return deriveSet(repo, setName)?.openings.find((x) => x.run_id === prereg.run_id)?.number ?? null; } catch { return null; } };
    const base = {
      schema_version: 1 as const, tool: 'scripts/sealed/open.ts' as const, run_id: prereg.run_id, set: setName, label: block!.label, reason: block!.reason ?? null, candidate_sha256: block!.candidate_sha256,
      prereg_json: preregPath, prereg_sha256: preregSha, public_ref: `${remote}/${branch}`, public_commit: publicCommit, public_manifest_sha256: sha256(readFileSync(set.manifest)),
      bundle_sha256: m.sealed.bundle_sha256,
    };
    const access = { event_sha256: first.sha256, custody_ref: CUSTODY_REF, custody_commit: pushed.commit, opened_at: first.event.at, resumed };
    if (kind === 'repo') {
      const tree = treeFiles(p.tasks).tree_sha256;
      const generator = existsSync(p.generator) ? corpusDigest(p.generator) : null;
      if (tree !== m.tree_sha256) throw new RunnerError('HE-SEALED-006', `the decrypted bundle's tree_sha256 is ${tree.slice(0, 12)}, the public commitment is ${m.tree_sha256.slice(0, 12)}`);
      if (generator !== (m.sealed.generator_sha256 ?? null)) throw new RunnerError('HE-SEALED-006', `the decrypted bundle's generator_sha256 is ${String(generator).slice(0, 12)}, the public commitment is ${String(m.sealed.generator_sha256 ?? null).slice(0, 12)}`);
      const n = taskCount();
      if (n !== m.sealed.task_count) throw new RunnerError('HE-SEALED-006', `the decrypted bundle holds ${n} task(s), the public commitment is ${m.sealed.task_count}`);
      const receipt: OpeningReceipt = {
        ...base, kind: 'repo', tree_sha256: tree, world_slice_sha256: null, heldout_corpus_sha256: null, ...(m.sealed.extras ? { extras: m.sealed.extras } : {}),
        public_world_sha256: null, world_sha256: null, generator_sha256: generator, task_count: n, access, written_at: now(),
      };
      writeFileSync(p.receipt, JSON.stringify(receipt, null, 1) + '\n', { mode: 0o600 });
      log(`CUSTODY: root ${out} (repo set, ${n} tasks, tree ${tree.slice(0, 12)}, generator ${generator ? generator.slice(0, 12) : 'none'}, ${Object.keys(m.sealed.extras ?? {}).length} extra file(s)); receipt ${p.receipt}`);
      return { root: out, receipt, resumed, opening: openingNumber() };
    }
    mkdirSync(p.corpus, { recursive: true, mode: 0o700 });
    if (!existsSync(p.slice)) throw new RunnerError('HE-SEALED-006', 'the bundle has no world/slice.json');
    const pubWorldBytes = readFileSync(join(repo, 'world', 'seed', 'world.json'));
    const pub = JSON.parse(pubWorldBytes.toString('utf8')) as World;
    let slice: WorldSlice;
    try { slice = JSON.parse(readFileSync(p.slice, 'utf8')) as WorldSlice; } catch { throw new RunnerError('HE-SEALED-006', 'the bundle\'s world/slice.json is not valid JSON (the parser\'s message quotes it, so it is not printed)'); }
    const sp = sliceProblems(slice, pub);
    if (sp.length) throw new RunnerError('HE-SEALED-006', `the world slice does not fit the public world (${sp.length} problem(s); the details name sealed records, so they are not printed): the public world changed since sealing, which bun scripts/seal-heldout.ts --check also reports`);
    writeFileSync(p.world, renderWorld(mergeWorld(pub, slice)), { mode: 0o600 });
    const tree = treeFiles(p.tasks);
    const checks: Array<[string, string, string | null]> = [
      ['tree_sha256', tree.tree_sha256, m.tree_sha256],
      ['world_slice_sha256', sha256(readFileSync(p.slice)), m.sealed.world_slice_sha256],
      ['heldout_corpus_sha256', corpusDigest(p.corpus), m.sealed.heldout_corpus_sha256],
    ];
    for (const [k, got, want] of checks) if (got !== want) throw new RunnerError('HE-SEALED-006', `the decrypted bundle's ${k} is ${got.slice(0, 12)}, the public commitment is ${String(want).slice(0, 12)}`);
    const n = taskCount();
    const receipt: OpeningReceipt = {
      ...base, tree_sha256: tree.tree_sha256, world_slice_sha256: m.sealed.world_slice_sha256, heldout_corpus_sha256: m.sealed.heldout_corpus_sha256, ...(m.sealed.extras ? { extras: m.sealed.extras } : {}),
      public_world_sha256: sha256(pubWorldBytes), world_sha256: sha256(readFileSync(p.world)), task_count: n, access, written_at: now(),
    };
    writeFileSync(p.receipt, JSON.stringify(receipt, null, 1) + '\n', { mode: 0o600 });
    for (const l of planLines) log(l);
    log(`CUSTODY: root ${out} (${n} tasks, tree ${tree.tree_sha256.slice(0, 12)}, world ${String(receipt.world_sha256).slice(0, 12)}); receipt ${p.receipt}`);
    log(`CUSTODY: next: bun runner/run.ts plan --prereg ${preregPath} --sealed-root ${out} --opening-receipt ${p.receipt} --out <a results directory outside the checkout>`);
    return { root: out, receipt, resumed, opening: openingNumber() };
  } catch (e) {
    rmSync(out, { recursive: true, force: true });
    throw e;
  }
}

/** The custody close step: remove an opened root (after export). Refuses a directory that is not an opened root. */
export function closeRoot(dir: string): void {
  const d = resolve(dir);
  if (!existsSync(d)) return;
  if (!existsSync(join(d, RECEIPT_FILE))) throw new RunnerError('HE-SEALED-006', `${d} is not an opened root (no ${RECEIPT_FILE}); nothing removed`);
  rmSync(d, { recursive: true, force: true });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    if (flag('close')) { closeRoot(flag('close')!); console.log(`CUSTODY: closed ${resolve(flag('close')!)}`); process.exit(0); }
    const prereg = flag('prereg');
    if (!prereg) throw new RunnerError('HE-RUN-002', 'usage: bun scripts/sealed/open.ts --prereg <prereg.json> [--custody <clone>] [--identity <drive copy>] [--repo .] [--out <dir>] [--remote origin] [--custodian <name>] | --close <dir>');
    await openRun({ repo: flag('repo') ?? process.cwd(), prereg, custody: flag('custody'), identityPath: flag('identity'), out: flag('out'), remote: flag('remote'), custodian: flag('custodian') });
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    console.error(`HE-SEALED-006 open failed: ${e instanceof Error ? e.constructor.name : 'error'} (message withheld; it may quote sealed content)`);
    process.exit(2);
  }
}
