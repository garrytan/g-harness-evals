#!/usr/bin/env bun
/**
 * Seal a held-out set (docs/sealed-custody.md): bundle the plaintext task tree, its world slice and its corpus pages into a
 * reproducible tar, encrypt it to the committed age recipient, push the ciphertext to <set>/bundle.tar.age on the
 * repository's custody branch (refs/heads/custody, without force, with a "sealed" access-log line), and write the set's
 * public MANIFEST.json with the commitments (custody "sealed").
 *
 *   bun scripts/sealed/seal.ts --task-set <set> --tasks <plaintext held-out tree> --slice <world slice.json>
 *        [--corpus <dir holding heldout/<slug>.md>] [--custody <isolated custody clone>]
 *        [--recipient <file or age1...>, default sealed/recipient.txt] [--repo <public checkout, default .>] [--remote origin]
 *        [--exposures <file.json>] [--custodian <name, default scripts/sealed/seal.ts>]
 *   bun scripts/sealed/seal.ts --from-backup <file.tar.age> [--sha256 <hex>] [--include <path> ...] [--identity <drive copy>]
 *        --task-set <set> --tasks <path> --slice <path> [--corpus <path>] [the options above]
 *
 * --from-backup seals from a set author's backup: a tar (optionally gzipped) of their working tree encrypted to the
 * recipient (sealFromBackup; scripts/sealed/intake.ts unpacks it). --tasks, --slice, --corpus and --include are then paths
 * under the unpacked backup. The identity comes only from identity.ts custodyIdentity after the escrow check; the backup is
 * decrypted in memory, unpacked into a fresh 0700 directory under ~/.capy/work/custody/intake, sealed by sealSet unchanged,
 * and the directory is removed and checked gone on every exit, with one line saying so. --include packs a file of the
 * backup at extras/<path> in the bundle and lists its sha256 under sealed.extras in the manifest. --exposures adds a JSON
 * list of exposures to the manifest's openings ledger; --custodian names the custodian in the access log's "sealed" line.
 *
 * It refuses unless the repository is private (gh api repos/garrytan/harness-evals -q .private; HE-SEALED-013), and works
 * on the custody branch only through the isolated custody clone (default ~/.capy/work/custody/harness-evals;
 * scripts/sealed/custody.ts).
 * Refuses a set named v0.1, runner, tasks or docs (a custody clone holding runner/, tasks/ or docs/ is refused as a public
 * tree, so such a bundle would lock every custody command out), when any input is inside the public checkout, when the
 * set's held-out directory in the checkout holds anything but MANIFEST.json (plaintext of the set in the checkout), when
 * a held-out slice record copies a public held-out record unchanged, in any key order (a public held-out id may be reused, since every public
 * held-out record is replaced, but not its content), when the slice
 * does not fit the public world, and when the set's ledger already has an opened row (new content is a new set). The
 * openings ledger of an existing manifest is carried through. A bundle already on the custody branch is never replaced (new content is a new set). The public manifest is
 * written but not committed: the output names it. The output names paths and digests only.
 *
 * A refusal can name sealed task paths and slice record ids, so the CLI prints only its code, how many problems it found
 * and the path of a private log holding the full message: ~/.capy/work/custody/logs/seal-<epoch ms>-<pid>.log (the
 * directory 0700, the file 0600, beside the default custody clone and outside every checkout; when that directory is
 * inside a git work tree no log is written and the line says so). sealSet's thrown errors keep the full message for callers.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { randomBytes } from 'node:crypto';
import { corpusDigest, decryptWith, encryptTo, OPAQUE_SALT_FILE, packTar, safeRelPath, sha256, sliceProblems, sliceRecords, WORLD_COLLECTIONS, type TarEntry, type WorldSlice } from '../../runner/heldout/sealed.ts';
import { heldoutSet, openingsLedger, readManifest, treeFiles, walk, type Exposure, type HeldoutManifest } from '../seal-heldout.ts';
import { checkPrivate, compareAndPush, CUSTODY_REF, CUSTODY_REPO, custodyClone, DEFAULT_CUSTODY_CLONE, ESCROW_FILE, insideGitTree, PUBLIC_TREES, syncCustody } from './custody.ts';
import { custodyIdentity } from './identity.ts';
import { backupEntries, INTAKE_ROOT, makeIntakeDir, removeIntakeDir, sweepStaleIntake, writeBackup } from './intake.ts';
import type { World } from '../../world/types.ts';

export interface SealOptions {
  repo: string;
  set: string;
  tasks: string;
  slice: string;
  corpus?: string;
  /** The isolated custody clone (default ~/.capy/work/custody/harness-evals, made when missing). */
  custody?: string;
  recipient: string;
  /** The gh binary asked for the repository's visibility (default gh on PATH). */
  gh?: string;
  remote?: string;
  now?: () => string;
  /** Extra files packed under extras/ in the bundle: name (the path below extras/) to source file. */
  extras?: Record<string, string>;
  /** Exposures added to the manifest's openings-ledger exposures (access to the set that is not a run). */
  exposures?: Exposure[];
  /** The access-log line's custodian (default scripts/sealed/seal.ts), as open.ts --custodian. */
  custodian?: string;
}

/** seal.ts --from-backup: tasks, slice, corpus and include are paths under the unpacked backup. */
export interface BackupSealOptions extends Omit<SealOptions, 'extras'> {
  /** The author's backup: a tar (optionally gzipped) encrypted to the recipient. */
  backup: string;
  /** The sha256 the backup file must have. */
  sha256?: string;
  /** Files under the unpacked backup packed under extras/<path>. */
  include?: string[];
  /** The drive copy of the custody identity (default identity.ts DEFAULT_IDENTITY_PATH). */
  identityPath?: string;
  /** Where UBICLOUD_API_KEY is read for the escrow check (default process.env). */
  env?: Record<string, string | undefined>;
  /** Where intake directories are made (default ~/.capy/work/custody/intake). */
  intakeRoot?: string;
  log?: (line: string) => void;
}

/** A seal.ts refusal (HE-SEALED-006); count is how many problems the message lists. */
export class SealRefusal extends RunnerError {
  constructor(message: string, readonly count = 1) { super('HE-SEALED-006', message); }
}

const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));
const readRecipient = (r: string) => (existsSync(r) ? readFileSync(r, 'utf8') : r).trim();
const inside = (child: string, parent: string) => { const r = relative(real(parent), real(child)); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };

export async function sealSet(o: SealOptions): Promise<{ manifest: HeldoutManifest; bundlePath: string; manifestPath: string; commit: string }> {
  const repo = resolve(o.repo);
  const fail = (msg: string, count = 1): never => { throw new SealRefusal(msg, count); };
  checkPrivate(CUSTODY_REPO, o.gh);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(o.set) || ['v0.1', ...PUBLIC_TREES].includes(o.set)) fail(`--task-set must name a set other than v0.1, runner, tasks or docs, such as v0.3 (got ${JSON.stringify(o.set)}); a custody clone holding runner/, tasks/ or docs/ is refused as a public tree`);
  for (const [k, p] of [['--tasks', o.tasks], ['--slice', o.slice], ['--corpus', o.corpus]] as const) if (p && inside(p, repo)) fail(`${k} ${p} is inside the public checkout; sealed plaintext is written and kept outside it`);
  const recipient = readRecipient(o.recipient);
  if (!/^age1[0-9a-z]+$/.test(recipient)) fail(`the recipient must be a public age recipient (age1...); got a value of ${recipient.length} characters from ${existsSync(o.recipient) ? o.recipient : 'the argument'}`);
  const set = heldoutSet(o.set, repo);
  const present = existsSync(set.dir) ? walk(set.dir).filter((p) => p !== set.manifest) : [];
  if (present.length) fail(`plaintext of set ${o.set} is in the checkout: ${present.length} file(s) under ${relative(repo, set.dir)}; a sealed set's directory holds MANIFEST.json only`, present.length);
  const previous = readManifest(set);
  const ledger = openingsLedger(previous);
  if (ledger?.openings.some((r) => r.status === 'opened')) fail(`set ${o.set} has an opened row in its ledger; new content is a new set`);
  const exposureProblems = (o.exposures ?? []).flatMap((e, i) => [
    ...(['date', 'kind', 'recipient', 'what', 'source'] as const).filter((k) => !(typeof e?.[k] === 'string' && e[k].trim())).map((k) => `exposures[${i}]: ${k} is missing`),
    ...(typeof e?.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ? [`exposures[${i}]: date must be YYYY-MM-DD`] : []),
  ]);
  if (exposureProblems.length) fail(`--exposures: ${exposureProblems.slice(0, 5).join('; ')} (each exposure has date, kind, recipient, what and source)`, exposureProblems.length);

  const tasksDir = resolve(o.tasks);
  const taskIds = readdirSync(tasksDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(tasksDir, d.name, 'task.toml'))).map((d) => d.name).sort();
  if (!taskIds.length) fail(`--tasks ${tasksDir} holds no task directory with a task.toml`);
  const pubText = readFileSync(join(repo, 'world', 'seed', 'world.json'), 'utf8');
  const pub = JSON.parse(pubText) as World;
  const sliceBytes = readFileSync(o.slice);
  const slice = JSON.parse(sliceBytes.toString('utf8')) as WorldSlice;
  const problems = sliceProblems(slice, pub);
  if (problems.length) fail(`the world slice does not fit the public world: ${problems.slice(0, 5).join('; ')}`, problems.length);
  const held = sliceRecords(slice);
  if (!WORLD_COLLECTIONS.some((c) => held[c].length)) fail('the world slice holds no held-out record (split "heldout")');
  const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
  const publicHeld = new Map(WORLD_COLLECTIONS.flatMap((c) => (pub[c] as Array<{ id: string; split?: string }>).filter((r) => r.split === 'heldout').map((r) => [`${c}/${r.id}`, canonical(r)] as const)));
  const copies = WORLD_COLLECTIONS.flatMap((c) => held[c].filter((r) => publicHeld.get(`${c}/${r.id}`) === canonical(r)));
  if (copies.length) fail(`${copies.length} held-out record(s) of the world slice are copies of public held-out records in world/seed/world.json; a slice may reuse a public held-out id, but its held-out content is content the public world does not have`, copies.length);

  const entries: TarEntry[] = [];
  const add = (base: string, prefix: string) => {
    const firstLink = (dir: string): string | undefined => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isSymbolicLink()) return p;
        const inner = e.isDirectory() ? firstLink(p) : undefined;
        if (inner) return inner;
      }
      return undefined;
    };
    const link = firstLink(base);
    if (link) fail(`${JSON.stringify(`${prefix}${relative(base, link)}`)} is a symbolic link; a bundle holds regular files only, so the corpus commitment covers every packed page`);
    for (const p of walk(base)) {
      const rel = `${prefix}${relative(base, p)}`;
      if (!safeRelPath(rel)) fail(`${JSON.stringify(rel)} is not a path a bundle may hold (printable ASCII, no "..", at most 255 characters)`);
      if (!statSync(p).isFile()) continue;
      entries.push({ path: rel, data: new Uint8Array(readFileSync(p)) });
    }
  };
  add(tasksDir, `tasks/multiuser/${o.set}/heldout/`);
  entries.push({ path: 'world/slice.json', data: new Uint8Array(sliceBytes) });
  entries.push({ path: OPAQUE_SALT_FILE, data: new TextEncoder().encode(randomBytes(32).toString('hex') + '\n') });
  if (o.corpus) {
    const c = resolve(o.corpus);
    const strays = readdirSync(c).filter((n) => n !== 'heldout').sort();
    if (strays.length) fail(`--corpus ${c} holds ${strays.join(', ')}; it holds one directory, heldout/, of <slug>.md pages`);
    add(c, 'corpus/');
    if (!entries.some((e) => e.path.startsWith('corpus/'))) fail(`--corpus ${c} holds no page under heldout/; pass a corpus with at least one page, or no --corpus`);
  }
  const extras: Record<string, string> = {};
  for (const [name, file] of Object.entries(o.extras ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const path = `extras/${name}`;
    if (!safeRelPath(path)) fail(`${JSON.stringify(path)} is not a path a bundle may hold (printable ASCII, no "..", at most 255 characters)`);
    if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) fail(`--include ${name} is not a regular file; an extra is one file, never a link or a directory`);
    const data = new Uint8Array(readFileSync(file));
    entries.push({ path, data });
    extras[path] = sha256(data);
  }
  const ciphertext = await encryptTo(recipient, packTar(entries));
  const bundleRel = `${o.set}/bundle.tar.age`;
  const remote = o.remote ?? 'origin';
  const clone = custodyClone({ dir: o.custody, repo, remote });
  const bundlePath = join(clone, bundleRel);
  const now = o.now ?? (() => new Date().toISOString());
  const pushed = compareAndPush(clone, {
    remote,
    message: () => `seal ${o.set}`,
    decide: () => {
      if (existsSync(bundlePath)) fail(`${CUSTODY_REF} already holds ${bundleRel}; a sealed bundle is never replaced, so new content is a new set`);
      return { schema_version: 1, event: 'sealed', at: now(), run_id: '*', set: o.set, bundle_sha256: sha256(ciphertext), custodian: o.custodian ?? 'scripts/sealed/seal.ts' };
    },
    stage: () => { mkdirSync(dirname(bundlePath), { recursive: true }); writeFileSync(bundlePath, ciphertext); return [bundleRel]; },
  });

  const worldManifest = readFileSync(join(repo, 'world', 'seed', 'MANIFEST.json'), 'utf8');
  const keep: Partial<HeldoutManifest> = Object.fromEntries((['opening_budget', 'alpha_per_opening', 'status', 'openings', 'exposures'] as const).filter((k) => previous?.[k] !== undefined).map((k) => [k, previous![k]]));
  if (o.exposures?.length) {
    const known = new Set((keep.exposures ?? []).map((e) => JSON.stringify(e)));
    keep.exposures = [...(keep.exposures ?? []), ...o.exposures.filter((e) => !known.has(JSON.stringify(e)))];
  }
  const manifest: HeldoutManifest = {
    schema_version: 1,
    generated_at: (o.now ?? (() => new Date().toISOString()))(),
    custody: 'sealed',
    sealed: {
      bundle_sha256: sha256(ciphertext),
      world_slice_sha256: sha256(sliceBytes),
      heldout_corpus_sha256: corpusDigest(o.corpus ? resolve(o.corpus) : join(tasksDir, '.no-corpus-pages')),
      task_count: taskIds.length,
      recipient,
      custody_repo: CUSTODY_REPO,
      custody_ref: CUSTODY_REF,
      bundle: bundleRel,
      sealed_at: now(),
      ...(Object.keys(extras).length ? { extras } : {}),
    },
    world_manifest_sha256: sha256(worldManifest),
    world_json_sha256: (JSON.parse(worldManifest) as { world_json_sha256?: string }).world_json_sha256 ?? '',
    tasks: [],
    files: {},
    tree_sha256: treeFiles(tasksDir).tree_sha256,
    ...keep,
  };
  mkdirSync(set.dir, { recursive: true });
  writeFileSync(set.manifest, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, bundlePath, manifestPath: set.manifest, commit: pushed.commit };
}

/**
 * seal.ts --from-backup: seal from an author's encrypted backup. Stale intake directories are swept first. The backup's
 * sha256 is checked against --sha256 before anything is decrypted; the identity comes only from custodyIdentity, after the
 * escrow check, as in open.ts. The backup is decrypted in memory and unpacked into a fresh 0700 intake directory, and
 * sealSet runs unchanged on the named paths under it. The intake directory is removed on success, refusal, error and
 * SIGINT, SIGTERM or SIGHUP, and its removal is checked.
 */
export async function sealFromBackup(o: BackupSealOptions): Promise<Awaited<ReturnType<typeof sealSet>>> {
  const log = o.log ?? (() => {});
  const fail = (msg: string): never => { throw new SealRefusal(msg); };
  const intakeRoot = o.intakeRoot ?? INTAKE_ROOT;
  const stale = sweepStaleIntake(intakeRoot);
  if (stale.removed.length) log(`SEAL: removed ${stale.removed.length} stale intake director${stale.removed.length === 1 ? 'y' : 'ies'} an earlier run left: ${stale.removed.join(', ')}`);
  if (stale.failed.length) fail(`${stale.failed.length} stale intake director${stale.failed.length === 1 ? 'y' : 'ies'} could not be removed (${stale.failed.join(', ')}); remove them before sealing`);
  const rels: Array<[string, string, 'dir' | 'file']> = [['--tasks', o.tasks, 'dir'], ['--slice', o.slice, 'file'], ...(o.corpus ? [['--corpus', o.corpus, 'dir'] as [string, string, 'dir']] : []), ...(o.include ?? []).map((p) => ['--include', p, 'file'] as [string, string, 'file'])];
  for (const [k, p] of rels) { const n = normalize(p); if (isAbsolute(p) || n === '..' || n.startsWith('../')) fail(`${k} ${p} must be a path under the unpacked backup (relative, not leaving it)`); }
  const want = o.sha256?.toLowerCase();
  if (want !== undefined && !/^[0-9a-f]{64}$/.test(want)) fail('--sha256 must be 64 hex characters');
  checkPrivate(CUSTODY_REPO, o.gh);
  const backup = new Uint8Array(readFileSync(o.backup));
  if (want && sha256(backup) !== want) fail(`--from-backup ${o.backup} has sha256 ${sha256(backup).slice(0, 12)}, --sha256 asks for ${want.slice(0, 12)}; nothing was decrypted`);
  const remote = o.remote ?? 'origin';
  const clone = custodyClone({ dir: o.custody, repo: resolve(o.repo), remote });
  syncCustody(clone, remote);
  const identity = await custodyIdentity({ identityPath: o.identityPath, escrowPath: join(clone, ESCROW_FILE), recipient: readRecipient(o.recipient), env: o.env });
  const dir = makeIntakeDir(intakeRoot);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const onSignal = (sig: (typeof signals)[number]) => {
    const gone = removeIntakeDir(dir);
    process.stderr.write(`SEAL: ${sig}: ${gone ? 'removed the unpacked intake' : 'could not remove the unpacked intake; remove it by hand:'} ${dir}\n`);
    process.exit(128 + constants.signals[sig]);
  };
  for (const s of signals) process.on(s, onSignal);
  let result: Awaited<ReturnType<typeof sealSet>> | undefined;
  let error: unknown;
  try {
    const entries = backupEntries(await decryptWith(identity, backup));
    const named = rels.map(([, p]) => normalize(p).replace(/\/+$/, ''));
    writeBackup(dir, named.includes('.') ? entries : entries.filter((e) => named.some((n) => e.path === n || e.path.startsWith(n + '/'))));
    const under = (k: string, p: string, kind: 'dir' | 'file') => {
      const full = join(dir, normalize(p));
      const st = lstatSync(full, { throwIfNoEntry: false });
      if (!(kind === 'dir' ? st?.isDirectory() : st?.isFile())) fail(`${k} ${p} is not a ${kind === 'dir' ? 'directory' : 'regular file'} in the backup`);
      return full;
    };
    result = await sealSet({
      ...o,
      tasks: under('--tasks', o.tasks, 'dir'),
      slice: under('--slice', o.slice, 'file'),
      corpus: o.corpus ? under('--corpus', o.corpus, 'dir') : undefined,
      extras: Object.fromEntries((o.include ?? []).map((p) => [normalize(p), under('--include', p, 'file')])),
    });
  } catch (e) {
    error = e;
  }
  const gone = removeIntakeDir(dir);
  for (const s of signals) process.off(s, onSignal);
  log(gone ? `SEAL: removed the unpacked intake ${dir} (checked: it no longer exists)` : `SEAL: could not remove the unpacked intake ${dir}; remove it by hand`);
  if (!gone && result && !error) return result;
  if (!gone) throw new SealRefusal(`the unpacked intake ${dir} could not be removed${error ? `; the seal also failed: ${error instanceof Error ? error.message : String(error)}` : ''}`, error instanceof SealRefusal ? error.count : 1);
  if (error) throw error;
  return result!;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = flag('repo') ?? join(import.meta.dir, '..', '..');
  const need = ['task-set', 'tasks', 'slice'].filter((k) => !flag(k));
  const include = argv.flatMap((a, i) => (a === '--include' && argv[i + 1] ? [argv[i + 1]!] : []));
  const usage = 'usage: bun scripts/sealed/seal.ts --task-set <set> --tasks <dir> --slice <slice.json> [--corpus <dir>] [--exposures <file.json>] [--custodian <name>] [--custody <clone>] [--recipient sealed/recipient.txt] [--remote origin]; from an author\'s encrypted backup add --from-backup <file.tar.age> [--sha256 <hex>] [--include <path> ...] [--identity <drive copy>], with --tasks, --slice, --corpus and --include as paths under the unpacked backup';
  const known = new Set(['repo', 'task-set', 'tasks', 'slice', 'corpus', 'exposures', 'custodian', 'custody', 'recipient', 'remote', 'from-backup', 'sha256', 'include', 'identity']);
  const unknown = argv.filter((a, i) => i % 2 === 0 && !(a.startsWith('--') && known.has(a.slice(2))));
  if (unknown.length || argv.length % 2) { console.error(`HE-RUN-002 ${unknown.length ? `unknown argument(s) ${unknown.join(' ')}` : 'a flag without a value'}; every flag takes one value; ${usage}`); process.exit(2); }
  if (need.length) { console.error(`HE-RUN-002 missing --${need.join(', --')}; ${usage}`); process.exit(2); }
  if (!flag('from-backup') && (include.length || flag('sha256') || flag('identity'))) { console.error(`HE-RUN-002 --include, --sha256 and --identity go with --from-backup; ${usage}`); process.exit(2); }
  try {
    const exposures = flag('exposures') ? JSON.parse(readFileSync(flag('exposures')!, 'utf8')) as Exposure[] : undefined;
    if (exposures !== undefined && !Array.isArray(exposures)) throw new SealRefusal('--exposures must hold a JSON list of exposures');
    const base = { repo, set: flag('task-set')!, tasks: flag('tasks')!, slice: flag('slice')!, corpus: flag('corpus'), custody: flag('custody'), recipient: flag('recipient') ?? join(repo, 'sealed', 'recipient.txt'), remote: flag('remote'), exposures, custodian: flag('custodian') };
    const r = flag('from-backup')
      ? await sealFromBackup({ ...base, backup: flag('from-backup')!, sha256: flag('sha256'), include, identityPath: flag('identity'), log: (l) => console.log(l) })
      : await (async () => {
        const stale = sweepStaleIntake();
        if (stale.removed.length) console.log(`SEAL: removed ${stale.removed.length} stale intake director${stale.removed.length === 1 ? 'y' : 'ies'} an earlier --from-backup run left: ${stale.removed.join(', ')}`);
        if (stale.failed.length) console.error(`SEAL: could not remove ${stale.failed.length} stale intake director${stale.failed.length === 1 ? 'y' : 'ies'}: ${stale.failed.join(', ')}; remove them by hand`);
        return sealSet(base);
      })();
    const s = r.manifest.sealed!;
    console.log(`sealed set ${flag('task-set')}: ${s.task_count} tasks, tree ${r.manifest.tree_sha256.slice(0, 12)}, bundle ${s.bundle_sha256.slice(0, 12)}, world slice ${s.world_slice_sha256.slice(0, 12)}, corpus ${s.heldout_corpus_sha256.slice(0, 12)}${s.extras ? `, ${Object.keys(s.extras).length} extra file(s)` : ''}`);
    console.log(`${s.bundle} pushed to ${CUSTODY_REF} in ${r.commit.slice(0, 12)}; next: commit ${relative(repo, r.manifestPath)} in a pull request to main; bun scripts/seal-heldout.ts --check must pass`);
    if (r.manifest.exposures && r.manifest.opening_budget === undefined) console.log('the manifest carries exposures but no openings ledger yet: add opening_budget, alpha_per_opening, status and openings before committing, or bun scripts/seal-heldout.ts --check fails');
  } catch (e) {
    const code = e instanceof RunnerError ? e.code : 'HE-SEALED-006';
    const count = e instanceof SealRefusal ? e.count : 1;
    const what = e instanceof RunnerError ? 'seal refused' : `seal failed: ${e instanceof Error ? e.constructor.name : 'error'}`;
    const logDir = join(dirname(DEFAULT_CUSTODY_CLONE), 'logs');
    if (insideGitTree(logDir)) console.error(`${code} ${what} (${count} problem(s)); the message is withheld from this terminal and no log was written, since ${logDir} is inside a git work tree`);
    else {
      mkdirSync(logDir, { recursive: true, mode: 0o700 });
      const log = join(logDir, `seal-${Date.now()}-${process.pid}.log`);
      writeFileSync(log, `${new Date().toISOString()} scripts/sealed/seal.ts ${argv.join(' ')}\n${e instanceof Error ? e.message : String(e)}\n`, { mode: 0o600 });
      console.error(`${code} ${what} (${count} problem(s)); the message can name sealed tasks or slice records, so it is withheld from this terminal; read ${log} inside custody only`);
    }
    process.exit(2);
  }
}
