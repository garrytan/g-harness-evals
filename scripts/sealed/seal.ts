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
 *   bun scripts/sealed/seal.ts --from-backup <file.tar.age> --sha256 <hex> [--include <path> ...] [--identity <drive copy>]
 *        --task-set <set> --tasks <path> --slice <path> [--corpus <path>] [the options above]
 *
 * --from-backup seals from a set author's backup: a tar (optionally gzipped) of their working tree encrypted to the
 * recipient (sealFromBackup; scripts/sealed/intake.ts unpacks it). --sha256, the backup file's 64-hex sha256, is required
 * with --from-backup and checked before anything is decrypted; a run without it is refused (HE-RUN-002). --tasks,
 * --slice, --corpus and --include are then paths under the unpacked backup. The identity comes only from identity.ts
 * custodyIdentity after the escrow check; the backup is decrypted in memory, unpacked into a fresh 0700 directory under ~/.capy/work/custody/intake, sealed by sealSet unchanged,
 * and the directory is removed and checked gone on every exit, with one line saying so. --include packs a file of the
 * backup at extras/<path> in the bundle and lists its sha256 under sealed.extras in the manifest. --exposures adds a JSON
 * list of exposures to the manifest's openings ledger; --custodian names the custodian in the access log's "sealed" line.
 * After a seal from a backup, the backup's sha256 is appended for the set to sealed/backups.json in the checkout (the
 * custodian commits it with the manifest); rekey.ts and compare-backups.ts bind a backup to its set by that file on main.
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
 * --kind repo (default multiuser): seals a repository task set (tasks/repo/<set>/, the gstack-native format) from
 * --tasks alone, with no --slice and no --corpus (both refused): a repo set has no world, so the manifest says "kind":
 * "repo", records world_slice_sha256, heldout_corpus_sha256, world_manifest_sha256 and world_json_sha256 as null and says
 * why in sealed.null_digests. --generator <dir> packs the set's generator at generator/ in the bundle (regular files only,
 * links refused) and commits its digest as sealed.generator_sha256 (null without one). Every other refusal holds,
 * including plaintext of the set in the checkout (anything beside MANIFEST.json in tasks/repo/<set>/heldout/, or a
 * tasks/repo/<set>/released/ tree), and a set name another kind already uses is refused.
 *
 * A refusal can name sealed task paths and slice record ids, so the CLI prints only its code, how many problems it found
 * and the path of a private log holding the full message: ~/.capy/work/custody/logs/seal-<epoch ms>-<pid>.log (the
 * directory 0700, the file 0600, beside the default custody clone and outside every checkout; when that directory is
 * inside a git work tree no log is written and the line says so). sealSet's thrown errors keep the full message for callers.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { randomBytes } from 'node:crypto';
import { corpusDigest, decryptWith, encryptTo, OPAQUE_SALT_FILE, packTar, safeRelPath, sha256, sliceProblems, sliceRecords, WORLD_COLLECTIONS, type TarEntry, type WorldSlice } from '../../runner/heldout/sealed.ts';
import { BACKUPS_FILE, heldoutSet, openingsLedger, readManifest, recordedBackups, SET_KINDS, treeFiles, walk, type BackupCommitment, type Exposure, type HeldoutManifest, type SetKind } from '../seal-heldout.ts';
import { checkPrivate, compareAndPush, CUSTODY_REF, CUSTODY_REPO, custodyClone, DEFAULT_CUSTODY_CLONE, ESCROW_FILE, insideGitTree, liveSharersCurrent, PUBLIC_TREES, readAccessLog, syncCustody } from './custody.ts';
import { custodyIdentity } from './identity.ts';
import { backupEntries, INTAKE_ROOT, makeIntakeDir, removeIntakeDir, sweepStaleIntake, writeBackup } from './intake.ts';
import type { World } from '../../world/types.ts';
import { repoTaskKind, REPO_TASK_KINDS } from '../../runner/grade/task.ts';

/** The one instruction a repo task's environment/Dockerfile ends with: cleanup.ts finds held-out images by this
 *  label, and as the last instruction it is in the final stage and no later assignment overrides it. */
export const SEALED_LABEL_LINE = 'LABEL harness-eval.sealed=true';

/** Whether a Dockerfile ends with SEALED_LABEL_LINE as an instruction of its own. Checked by form, never by parsing
 *  Dockerfile syntax, and failing closed: the last line that is not blank or a comment is exactly that line, the instruction
 *  before it does not continue onto it (no trailing backslash), no line but a comment holds `<<` (a sealed task's
 *  Dockerfile has no heredoc, so no line can sit inside one), the first instruction is FROM or ARG (so no `//` or JSON
 *  directive form), an escape directive names the backslash and a syntax directive names docker/dockerfile only. The file
 *  is printable ASCII with LF or CRLF line ends, so this check and BuildKit's parser see the same lines and whitespace. */
export function finalStageSealed(dockerfile: string): boolean {
  if (/[^\t\r\n\x20-\x7e]/.test(dockerfile) || /\r(?!\n)/.test(dockerfile)) return false;
  const lines = dockerfile.split(/\r?\n/);
  if (lines.some((l) => !/^\s*#/.test(l) && l.includes('<<'))) return false;
  const code = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (code.length < 2 || !/^(FROM|ARG)\s/i.test(code[0]!) || code.at(-1) !== SEALED_LABEL_LINE || code.at(-2)!.endsWith('\\')) return false;
  for (const l of lines) {
    if (!/^\s*#/.test(l)) { if (l.trim()) break; continue; }
    const d = /^\s*#\s*(escape|syntax)\s*=(.*)$/i.exec(l);
    if (!d) continue;
    const value = d[2]!.trim();
    if (d[1]!.toLowerCase() === 'escape' ? value !== '\\' : !/^(docker\.io\/)?docker\/dockerfile(:[\w.-]+)?(@sha256:[0-9a-f]{64})?$/.test(value)) return false;
  }
  return true;
}

export interface SealOptions {
  repo: string;
  set: string;
  /** multiuser (the default) or repo (no slice, no corpus, an optional generator). */
  kind?: SetKind;
  tasks: string;
  /** The world slice; required for a multiuser set, refused for a repo set. */
  slice?: string;
  corpus?: string;
  /** A repo set's generator directory, packed at generator/ in the bundle. */
  generator?: string;
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
  /** seal.ts --from-backup: the backup's sha256, recorded as the "sealed" line's source_sha256 and refused under the custody
   *  lock when another set's "sealed" line, or a "reencrypted" or "compared" line, already names it. */
  sourceSha256?: string;
}

/** seal.ts --from-backup: tasks, slice, corpus and include are paths under the unpacked backup. */
export interface BackupSealOptions extends Omit<SealOptions, 'extras'> {
  /** The author's backup: a tar (optionally gzipped) encrypted to the recipient. */
  backup: string;
  /** The sha256 the backup file must have (64 hex characters, required). */
  sha256: string;
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

/** What a repo set's manifest says about its null world and corpus digests. */
export const REPO_NULL_DIGESTS = 'kind repo: a repository task set has no world slice and no corpus pages, so world_slice_sha256 and heldout_corpus_sha256 are null; the tree and the bundle digests commit the tasks';

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
  const kind: SetKind = o.kind ?? 'multiuser';
  if (!(SET_KINDS as readonly string[]).includes(kind)) fail(`--kind must be ${SET_KINDS.join(' or ')} (got ${JSON.stringify(kind)})`);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(o.set) || ['v0.1', ...PUBLIC_TREES].includes(o.set)) fail(`--task-set must name a set other than v0.1, runner, tasks or docs, such as v0.3 (got ${JSON.stringify(o.set)}); a custody clone holding runner/, tasks/ or docs/ is refused as a public tree`);
  if (kind === 'repo' && (o.slice || o.corpus)) fail('--kind repo seals a repository task set, which has no world slice and no corpus pages; drop --slice and --corpus');
  if (kind === 'multiuser' && !o.slice) fail('--slice is required for a multiuser set (its held-out world records)');
  if (kind === 'multiuser' && o.generator) fail('--generator goes with --kind repo; a multiuser bundle holds no generator/');
  const other: SetKind = kind === 'repo' ? 'multiuser' : 'repo';
  if (existsSync(join(repo, 'tasks', other, o.set))) fail(`set name ${o.set} is already used by tasks/${other}/ in the checkout; set names are unique across kinds`);
  for (const [k, p] of [['--tasks', o.tasks], ['--slice', o.slice], ['--corpus', o.corpus], ['--generator', o.generator]] as const) if (p && inside(p, repo)) fail(`${k} ${p} is inside the public checkout; sealed plaintext is written and kept outside it`);
  const recipient = readRecipient(o.recipient);
  if (!/^age1[0-9a-z]+$/.test(recipient)) fail(`the recipient must be a public age recipient (age1...); got a value of ${recipient.length} characters from ${existsSync(o.recipient) ? o.recipient : 'the argument'}`);
  const set = heldoutSet(o.set, repo, kind);
  const present = [...(existsSync(set.dir) ? walk(set.dir).filter((p) => p !== set.manifest) : []), ...(kind === 'repo' && existsSync(set.tree) ? walk(set.tree) : [])];
  if (present.length) fail(`plaintext of set ${o.set} is in the checkout: ${present.length} file(s) under ${relative(repo, set.dir)}${kind === 'repo' ? ` or ${relative(repo, set.tree)}` : ''}; a sealed set's directory holds MANIFEST.json only`, present.length);
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
  if (kind === 'repo') {
    const badKind = taskIds.filter((t) => { try { repoTaskKind(join(tasksDir, t)); return false; } catch { return true; } });
    if (badKind.length) fail(`${badKind.length} repo task(s) have no kind of ${REPO_TASK_KINDS.join(', ')} in task.toml (${badKind.join(', ')}); export counts repo tasks by kind, so the set cannot be sealed`);
    const unlabelled = taskIds.filter((t) => { const f = join(tasksDir, t, 'environment', 'Dockerfile'); return !existsSync(f) || !finalStageSealed(readFileSync(f, 'utf8')); });
    if (unlabelled.length) fail(`${unlabelled.length} repo task(s) have no environment/Dockerfile whose last instruction is ${SEALED_LABEL_LINE} (${unlabelled.join(', ')}); cleanup.ts finds held-out images by that label, so the set cannot be sealed`);
  }
  let sliceBytes: Buffer | null = null;
  if (kind === 'multiuser') {
    const pubText = readFileSync(join(repo, 'world', 'seed', 'world.json'), 'utf8');
    const pub = JSON.parse(pubText) as World;
    sliceBytes = readFileSync(o.slice!);
    const slice = JSON.parse(sliceBytes.toString('utf8')) as WorldSlice;
    const problems = sliceProblems(slice, pub);
    if (problems.length) fail(`the world slice does not fit the public world: ${problems.slice(0, 5).join('; ')}`, problems.length);
    const held = sliceRecords(slice);
    if (!WORLD_COLLECTIONS.some((c) => held[c].length)) fail('the world slice holds no held-out record (split "heldout")');
    const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
    const publicHeld = new Map(WORLD_COLLECTIONS.flatMap((c) => (pub[c] as Array<{ id: string; split?: string }>).filter((r) => r.split === 'heldout').map((r) => [`${c}/${r.id}`, canonical(r)] as const)));
    const copies = WORLD_COLLECTIONS.flatMap((c) => held[c].filter((r) => publicHeld.get(`${c}/${r.id}`) === canonical(r)));
    if (copies.length) fail(`${copies.length} held-out record(s) of the world slice are copies of public held-out records in world/seed/world.json; a slice may reuse a public held-out id, but its held-out content is content the public world does not have`, copies.length);
  }

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
      const st = statSync(p);
      if (!st.isFile()) continue;
      entries.push({ path: rel, data: new Uint8Array(readFileSync(p)), ...(st.mode & 0o111 ? { exec: true } : {}) });
    }
  };
  add(tasksDir, `tasks/${kind}/${o.set}/heldout/`);
  if (sliceBytes) entries.push({ path: 'world/slice.json', data: new Uint8Array(sliceBytes) });
  entries.push({ path: OPAQUE_SALT_FILE, data: new TextEncoder().encode(randomBytes(32).toString('hex') + '\n') });
  const generatorDir = o.generator ? resolve(o.generator) : undefined;
  if (generatorDir) {
    if (!lstatSync(generatorDir, { throwIfNoEntry: false })?.isDirectory()) fail(`--generator ${generatorDir} is not a directory`);
    add(generatorDir, 'generator/');
    if (!entries.some((e) => e.path.startsWith('generator/'))) fail(`--generator ${generatorDir} holds no file; pass a generator with at least one file, or no --generator`);
  }
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
      const taken = o.sourceSha256 ? readAccessLog(clone).find((e) => e.set !== o.set && (e.event === 'sealed' ? e.source_sha256 === o.sourceSha256 : (e.event === 'reencrypted' || e.event === 'compared') && [e.source_sha256, e.output_sha256].includes(o.sourceSha256))) : undefined;
      if (taken) fail(`the access log on ${CUSTODY_REF} ${taken.event === 'sealed' ? `records set ${taken.set} as sealed from this backup` : `has a "${taken.event}" line for set ${taken.set} that names this backup`} (sha256 ${o.sourceSha256!.slice(0, 12)}); a backup belongs to one set, so it cannot seal ${o.set}. Nothing was pushed`);
      return { schema_version: 1, event: 'sealed', at: now(), run_id: '*', set: o.set, bundle_sha256: sha256(ciphertext), ...(o.sourceSha256 ? { source_sha256: o.sourceSha256 } : {}), custodian: o.custodian ?? 'scripts/sealed/seal.ts' };
    },
    stage: () => { mkdirSync(dirname(bundlePath), { recursive: true }); writeFileSync(bundlePath, ciphertext); return [bundleRel]; },
  });

  const worldManifest = kind === 'multiuser' ? readFileSync(join(repo, 'world', 'seed', 'MANIFEST.json'), 'utf8') : null;
  const keep: Partial<HeldoutManifest> = Object.fromEntries((['opening_budget', 'alpha_per_opening', 'status', 'openings', 'exposures'] as const).filter((k) => previous?.[k] !== undefined).map((k) => [k, previous![k]]));
  if (o.exposures?.length) {
    const known = new Set((keep.exposures ?? []).map((e) => JSON.stringify(e)));
    keep.exposures = [...(keep.exposures ?? []), ...o.exposures.filter((e) => !known.has(JSON.stringify(e)))];
  }
  const manifest: HeldoutManifest = {
    schema_version: 1,
    ...(kind === 'repo' ? { kind } : {}),
    generated_at: (o.now ?? (() => new Date().toISOString()))(),
    custody: 'sealed',
    sealed: {
      bundle_sha256: sha256(ciphertext),
      world_slice_sha256: sliceBytes ? sha256(sliceBytes) : null,
      heldout_corpus_sha256: kind === 'repo' ? null : corpusDigest(o.corpus ? resolve(o.corpus) : join(tasksDir, '.no-corpus-pages')),
      ...(kind === 'repo' ? { null_digests: REPO_NULL_DIGESTS, generator_sha256: generatorDir ? corpusDigest(generatorDir) : null } : {}),
      task_count: taskIds.length,
      recipient,
      custody_repo: CUSTODY_REPO,
      custody_ref: CUSTODY_REF,
      bundle: bundleRel,
      sealed_at: now(),
      ...(Object.keys(extras).length ? { extras } : {}),
    },
    world_manifest_sha256: worldManifest === null ? null : sha256(worldManifest),
    world_json_sha256: worldManifest === null ? null : (JSON.parse(worldManifest) as { world_json_sha256?: string }).world_json_sha256 ?? '',
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
 * seal.ts --from-backup: seal from an author's encrypted backup. A missing or malformed --sha256 is refused before anything
 * else, then stale intake directories are swept. The backup's sha256 is checked against --sha256 before anything is
 * decrypted; the identity comes only from custodyIdentity, after the escrow check, as in open.ts. The backup is decrypted in memory and unpacked into a fresh 0700 intake directory, and
 * sealSet runs unchanged on the named paths under it. The intake directory is removed on success, refusal, error and
 * SIGINT, SIGTERM or SIGHUP, and its removal is checked.
 */
export async function sealFromBackup(o: BackupSealOptions): Promise<Awaited<ReturnType<typeof sealSet>>> {
  const log = o.log ?? (() => {});
  const fail = (msg: string): never => { throw new SealRefusal(msg); };
  const want = (o.sha256 ?? '').toLowerCase();
  if (!want) fail('--from-backup needs --sha256, the sha256 of the backup file; nothing was decrypted');
  if (!/^[0-9a-f]{64}$/.test(want)) fail('--sha256 must be 64 hex characters; nothing was decrypted');
  const backupsPath = join(resolve(o.repo), BACKUPS_FILE);
  let commitments: { schema_version: 1; backups: BackupCommitment[] } = { schema_version: 1, backups: [] };
  if (existsSync(backupsPath)) {
    try { commitments = JSON.parse(readFileSync(backupsPath, 'utf8')); } catch { fail(`${BACKUPS_FILE} in the checkout does not parse as JSON; the seal records this backup there, so fix it first. Nothing was decrypted`); }
    if (commitments?.schema_version !== 1 || !Array.isArray(commitments?.backups) || !commitments.backups.every((b) => typeof b?.set === 'string' && typeof b.sha256 === 'string')) fail(`${BACKUPS_FILE} in the checkout is not a list of backups; the seal records this backup there, so fix it first. Nothing was decrypted`);
    const elsewhere = commitments.backups.find((b) => b.sha256 === want && b.set !== o.set);
    if (elsewhere) fail(`${BACKUPS_FILE} records this backup for set ${elsewhere.set}; a backup belongs to one set, so it cannot seal ${o.set}. Nothing was decrypted`);
  }
  const intakeRoot = o.intakeRoot ?? INTAKE_ROOT;
  const stale = sweepStaleIntake(intakeRoot);
  if (stale.removed.length) log(`SEAL: removed ${stale.removed.length} stale intake director${stale.removed.length === 1 ? 'y' : 'ies'} an earlier run left: ${stale.removed.join(', ')}`);
  if (stale.failed.length) fail(`${stale.failed.length} stale intake director${stale.failed.length === 1 ? 'y' : 'ies'} could not be removed (${stale.failed.join(', ')}); remove them before sealing`);
  const rels: Array<[string, string, 'dir' | 'file']> = [['--tasks', o.tasks, 'dir'], ...(o.slice ? [['--slice', o.slice, 'file'] as [string, string, 'file']] : []), ...(o.corpus ? [['--corpus', o.corpus, 'dir'] as [string, string, 'dir']] : []), ...(o.generator ? [['--generator', o.generator, 'dir'] as [string, string, 'dir']] : []), ...(o.include ?? []).map((p) => ['--include', p, 'file'] as [string, string, 'file'])];
  for (const [k, p] of rels) { const n = normalize(p); if (isAbsolute(p) || n === '..' || n.startsWith('../')) fail(`${k} ${p} must be a path under the unpacked backup (relative, not leaving it)`); }
  checkPrivate(CUSTODY_REPO, o.gh);
  const backup = new Uint8Array(readFileSync(o.backup));
  if (sha256(backup) !== want) fail(`--from-backup ${o.backup} has sha256 ${sha256(backup).slice(0, 12)}, --sha256 asks for ${want.slice(0, 12)}; nothing was decrypted`);
  const remote = o.remote ?? 'origin';
  const clone = custodyClone({ dir: o.custody, repo: resolve(o.repo), remote });
  syncCustody(clone, remote);
  const onMain = recordedBackups(liveSharersCurrent(o.set, resolve(o.repo), clone, remote).backups).find((b) => b.sha256 === want && b.set !== o.set);
  if (onMain) fail(`${BACKUPS_FILE} on main records this backup for set ${onMain.set}; a backup belongs to one set, so it cannot seal ${o.set}. Nothing was decrypted`);
  const identity = await custodyIdentity({ identityPath: o.identityPath, escrowPath: join(clone, ESCROW_FILE), recipient: readRecipient(o.recipient), env: o.env });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  let dir = '';
  const onSignal = (sig: (typeof signals)[number]) => {
    const gone = !dir || removeIntakeDir(dir);
    process.stderr.write(`SEAL: ${sig}: ${gone ? 'removed the unpacked intake' : 'could not remove the unpacked intake; remove it by hand:'} ${dir}\n`);
    process.exit(128 + constants.signals[sig]);
  };
  for (const s of signals) process.on(s, onSignal);
  try {
    dir = makeIntakeDir(intakeRoot);
  } catch (e) {
    for (const s of signals) process.off(s, onSignal);
    throw e;
  }
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
      sourceSha256: want,
      tasks: under('--tasks', o.tasks, 'dir'),
      slice: o.slice ? under('--slice', o.slice, 'file') : undefined,
      corpus: o.corpus ? under('--corpus', o.corpus, 'dir') : undefined,
      generator: o.generator ? under('--generator', o.generator, 'dir') : undefined,
      extras: Object.fromEntries((o.include ?? []).map((p) => [normalize(p), under('--include', p, 'file')])),
    });
  } catch (e) {
    error = e;
  }
  const gone = removeIntakeDir(dir);
  for (const s of signals) process.off(s, onSignal);
  if (result && !error) {
    const entry = { set: o.set, sha256: want, what: `the backup set ${o.set} was sealed from (scripts/sealed/seal.ts --from-backup, custodian ${o.custodian ?? 'scripts/sealed/seal.ts'})` };
    try {
      const current: { schema_version: 1; backups: BackupCommitment[] } = existsSync(backupsPath) ? JSON.parse(readFileSync(backupsPath, 'utf8')) : { schema_version: 1, backups: [] };
      if (!Array.isArray(current?.backups)) throw new Error('it is no longer a list of backups');
      if (!current.backups.some((b) => b?.set === o.set && b?.sha256 === want)) {
        current.backups.push(entry);
        mkdirSync(dirname(backupsPath), { recursive: true });
        const tmp = `${backupsPath}.${process.pid}-${randomBytes(4).toString('hex')}`;
        try {
          writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n');
          renameSync(tmp, backupsPath);
        } catch (e) {
          rmSync(tmp, { force: true });
          throw e;
        }
      }
    } catch (e) {
      log(`SEAL: the seal succeeded, but ${BACKUPS_FILE} could not be updated (${e instanceof Error ? e.message : String(e)}); add this entry by hand and commit it with the manifest: ${JSON.stringify(entry)}`);
    }
  }
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
  const need = ['task-set', 'tasks', ...(flag('kind') === 'repo' ? [] : ['slice'])].filter((k) => !flag(k));
  const include = argv.flatMap((a, i) => (a === '--include' && argv[i + 1] ? [argv[i + 1]!] : []));
  const usage = 'usage: bun scripts/sealed/seal.ts --task-set <set> --tasks <dir> --slice <slice.json> [--corpus <dir>] | --kind repo --task-set <set> --tasks <dir> [--generator <dir>]; then [--exposures <file.json>] [--custodian <name>] [--custody <clone>] [--recipient sealed/recipient.txt] [--remote origin]; from an author\'s encrypted backup add --from-backup <file.tar.age> --sha256 <hex> [--include <path> ...] [--identity <drive copy>], with --tasks, --slice, --corpus and --include as paths under the unpacked backup';
  const known = new Set(['repo', 'task-set', 'kind', 'tasks', 'slice', 'corpus', 'generator', 'exposures', 'custodian', 'custody', 'recipient', 'remote', 'from-backup', 'sha256', 'include', 'identity']);
  const unknown = argv.filter((a, i) => i % 2 === 0 && !(a.startsWith('--') && known.has(a.slice(2))));
  if (unknown.length || argv.length % 2) { console.error(`HE-RUN-002 ${unknown.length ? `unknown argument(s) ${unknown.join(' ')}` : 'a flag without a value'}; every flag takes one value; ${usage}`); process.exit(2); }
  const flags = argv.filter((_, i) => i % 2 === 0);
  const repeated = [...new Set(flags.filter((a, i) => a !== '--include' && flags.indexOf(a) !== i))];
  if (repeated.length) { console.error(`HE-RUN-002 ${repeated.join(' ')} given more than once; only --include repeats; ${usage}`); process.exit(2); }
  if (need.length) { console.error(`HE-RUN-002 missing --${need.join(', --')}; ${usage}`); process.exit(2); }
  if (!flag('from-backup') && (include.length || flag('sha256') || flag('identity'))) { console.error(`HE-RUN-002 --include, --sha256 and --identity go with --from-backup; ${usage}`); process.exit(2); }
  if (flag('from-backup') && !flag('sha256')) { console.error(`HE-RUN-002 --from-backup needs --sha256 <hex>, the sha256 of the backup file the author sent; nothing was decrypted; ${usage}`); process.exit(2); }
  if (flag('from-backup') && !/^[0-9a-fA-F]{64}$/.test(flag('sha256')!)) { console.error(`HE-RUN-002 --sha256 must be 64 hex characters; nothing was decrypted; ${usage}`); process.exit(2); }
  try {
    const exposures = flag('exposures') ? JSON.parse(readFileSync(flag('exposures')!, 'utf8')) as Exposure[] : undefined;
    if (exposures !== undefined && !Array.isArray(exposures)) throw new SealRefusal('--exposures must hold a JSON list of exposures');
    const base = { repo, set: flag('task-set')!, kind: flag('kind') as SetKind | undefined, tasks: flag('tasks')!, slice: flag('slice'), corpus: flag('corpus'), generator: flag('generator'), custody: flag('custody'), recipient: flag('recipient') ?? join(repo, 'sealed', 'recipient.txt'), remote: flag('remote'), exposures, custodian: flag('custodian') };
    const r = flag('from-backup')
      ? await sealFromBackup({ ...base, backup: flag('from-backup')!, sha256: flag('sha256')!, include, identityPath: flag('identity'), log: (l) => console.log(l) })
      : await (async () => {
        const stale = sweepStaleIntake();
        if (stale.removed.length) console.log(`SEAL: removed ${stale.removed.length} stale intake director${stale.removed.length === 1 ? 'y' : 'ies'} an earlier --from-backup run left: ${stale.removed.join(', ')}`);
        if (stale.failed.length) console.error(`SEAL: could not remove ${stale.failed.length} stale intake director${stale.failed.length === 1 ? 'y' : 'ies'}: ${stale.failed.join(', ')}; remove them by hand`);
        return sealSet(base);
      })();
    const s = r.manifest.sealed!;
    const short = (x: string | null | undefined) => (x ? x.slice(0, 12) : 'none');
    console.log(`sealed set ${flag('task-set')}${r.manifest.kind === 'repo' ? ' (repo)' : ''}: ${s.task_count} tasks, tree ${r.manifest.tree_sha256.slice(0, 12)}, bundle ${s.bundle_sha256.slice(0, 12)}, world slice ${short(s.world_slice_sha256)}, corpus ${short(s.heldout_corpus_sha256)}${r.manifest.kind === 'repo' ? `, generator ${short(s.generator_sha256)}` : ''}${s.extras ? `, ${Object.keys(s.extras).length} extra file(s)` : ''}`);
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
