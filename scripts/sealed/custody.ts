#!/usr/bin/env bun
/**
 * The custody branch (internal-task phase 3, docs/sealed-custody.md). Sealed bundles, encrypted raw results, the identity
 * escrow and the access log live on an orphan branch, refs/heads/custody, of the public repository, never on main. Every
 * custody command works in an isolated custody clone (a separate directory whose HEAD is the custody branch, never the
 * public checkout) and keeps two refs apart: the public ref (<remote>/main) for preregistrations and the ledger, and the
 * custody ref for ciphertext and the access log.
 *
 * Every write is one compare-and-push transaction under the clone's lock (withCustodyLock: a custody.lock directory in the
 * clone's git directory, so two processes sharing the default clone take turns): fetch the custody ref, reset the clone to
 * it, let the caller decide on the current state (admission), commit one appended access-log line plus any new ciphertext,
 * validate that commit (validateCustodyChange) and push that commit's sha to refs/heads/custody without force. A rejected
 * push means another custodian step landed first; the loop fetches and decides again. Every fetch and push first checks
 * each URL the remote resolves to (checkCustodyRemoteOf): a network URL must name garrytan/harness-evals on github.com or
 * git.capy.ai, over https or ssh.
 *
 *   bun scripts/sealed/custody.ts --init <dir> --url <remote url> [--repo <public checkout>]   make an isolated clone
 *   bun scripts/sealed/custody.ts --validate <clone> [--base <commit>]                         check HEAD against base
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { Encrypter } from 'age-encryption';
import { RunnerError } from '../../runner/errors.ts';
import { sha256 } from '../../runner/heldout/sealed.ts';

/** The repository whose custody branch holds the ciphertext; it must stay private (checkPrivate). */
export const CUSTODY_REPO = 'garrytan/harness-evals';
export const CUSTODY_HOSTS = ['github.com', 'git.capy.ai'];
export const CUSTODY_BRANCH = 'custody';
export const CUSTODY_REF = 'refs/heads/custody';
export const ACCESS_LOG = 'access-log.jsonl';
export const ESCROW_FILE = 'escrow/identity.age';
/** Where custody commands keep their isolated clone when --custody is not given: outside every checkout, on this machine. */
export const DEFAULT_CUSTODY_CLONE = join(homedir(), '.capy', 'work', 'custody', 'harness-evals');
/** How long a custody command waits for another process's lock on the same clone (a large export push takes minutes). */
export const CUSTODY_LOCK_WAIT_MS = 10 * 60_000;
/** A real age identity: the bech32 charset, 58 characters after the prefix. */
export const IDENTITY_MARKER = /AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}/;
const AGE_HEADER = 'age-encryption.org/v1\n';

export interface AccessEvent {
  schema_version: 1;
  event: 'sealed' | 'opened' | 'resumed' | 'exported' | 'released' | 'escrowed' | 'reencrypted' | 'compared';
  at: string;
  run_id: string;
  set: string;
  label?: 'confirmatory' | 'dev';
  candidate_sha256?: string;
  prereg_json?: string;
  prereg_sha256?: string;
  public_commit?: string;
  public_ref?: string;
  bundle_sha256?: string;
  opened_event_sha256?: string;
  results_bundle_sha256?: string;
  escrow_sha256?: string;
  /** rekey.ts ("reencrypted") and compare-backups.ts ("compared"): the backup read, and the file written (rekey) or the
   *  second backup read (compare). */
  source_sha256?: string;
  output_sha256?: string;
  /** rekey.ts: the age X25519 recipient the backup was re-encrypted to. */
  recipient?: string;
  custodian: string;
}

export const ACCESS_EVENTS = ['sealed', 'opened', 'resumed', 'exported', 'released', 'escrowed', 'reencrypted', 'compared'] as const;

const EVENT_FIELDS: Record<string, 'string' | 'hex' | 'label' | 'recipient'> = {
  at: 'string', run_id: 'string', set: 'string', custodian: 'string', prereg_json: 'string', public_ref: 'string', label: 'label',
  candidate_sha256: 'hex', prereg_sha256: 'hex', bundle_sha256: 'hex', opened_event_sha256: 'hex', results_bundle_sha256: 'hex', escrow_sha256: 'hex', public_commit: 'string',
  source_sha256: 'hex', output_sha256: 'hex', recipient: 'recipient',
};

/** A set name, as seal.ts takes it (never "*"). */
export const SET_NAME = /^[a-z0-9][a-z0-9.-]*$/;

/** The exact fields of the two regeneration events (rekey.ts, compare-backups.ts); no other event carries the three new ones. */
const REGENERATION_FIELDS: Record<string, string[]> = {
  reencrypted: ['schema_version', 'event', 'at', 'run_id', 'set', 'custodian', 'source_sha256', 'output_sha256', 'recipient'],
  compared: ['schema_version', 'event', 'at', 'run_id', 'set', 'custodian', 'source_sha256', 'output_sha256'],
};

/** Whether s is an age X25519 recipient: lowercase age1 plus 58 bech32 characters, accepted by the age library's own
 *  recipient parser (bech32 checksum, prefix "age", 32 bytes). Hybrid and tag recipients are refused. */
export function isX25519Recipient(s: unknown): s is string {
  if (typeof s !== 'string' || !/^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/.test(s)) return false;
  try { new Encrypter().addRecipient(s); return true; } catch { return false; }
}

/** Schema problems of one access-log line. */
export function eventProblems(line: string): string[] {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line); } catch { return ['not JSON']; }
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['not an object'];
  const problems: string[] = [];
  if (e.schema_version !== 1) problems.push('schema_version is not 1');
  if (!(ACCESS_EVENTS as readonly string[]).includes(e.event as string)) problems.push('unknown event');
  const regen = REGENERATION_FIELDS[e.event as string];
  if (regen) {
    for (const k of Object.keys(e)) if (EVENT_FIELDS[k] && !regen.includes(k)) problems.push(`${k} is not a field of a ${e.event as string} line`);
    for (const k of regen) if (['source_sha256', 'output_sha256', 'recipient'].includes(k) && e[k] === undefined) problems.push(`${k} missing`);
    if (e.run_id !== undefined && e.run_id !== '*') problems.push('run_id is not *');
    if (typeof e.set === 'string' && e.set && !SET_NAME.test(e.set)) problems.push('set is not a set name');
  } else for (const k of ['source_sha256', 'output_sha256', 'recipient']) if (k in e) problems.push(`${k} is only on reencrypted and compared lines`);
  for (const k of ['at', 'run_id', 'set', 'custodian']) if (typeof e[k] !== 'string' || !e[k]) problems.push(`${k} missing`);
  for (const [k, v] of Object.entries(e)) {
    if (k === 'schema_version' || k === 'event') continue;
    const kind = EVENT_FIELDS[k];
    if (!kind) { problems.push(`unknown field ${k}`); continue; }
    if (kind === 'hex' && !(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))) problems.push(`${k} is not a sha256`);
    if (kind === 'label' && v !== 'confirmatory' && v !== 'dev') problems.push(`${k} is not confirmatory or dev`);
    if (kind === 'recipient' && !isX25519Recipient(v)) problems.push(`${k} is not an age X25519 recipient`);
    if (kind === 'string' && (typeof v !== 'string' || v.length > 512)) problems.push(`${k} is not a short string`);
  }
  if (IDENTITY_MARKER.test(line)) problems.push('carries an age identity');
  return problems;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
}

/** Whether a path (or its nearest existing ancestor) is inside a git work tree. */
export function insideGitTree(path: string): boolean {
  let p = resolve(path);
  while (!existsSync(p)) p = dirname(p);
  const r = spawnSync('git', ['-C', p, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** Top-level directories of the public tree; checkCustodyClone refuses a clone holding one, so no set or custody file uses them. */
export const PUBLIC_TREES = ['runner', 'tasks', 'docs'];

/** Refuse anything but an isolated custody clone: its own git directory, not the public checkout or inside it, no public
 *  tree in its work tree, and HEAD on the custody branch (or unborn). */
export function checkCustodyClone(clone: string, publicRepo?: string): void {
  const c = resolve(clone);
  if (!existsSync(join(c, '.git'))) throw new RunnerError('HE-SEALED-011', `--custody ${c} is not a git clone (make one with bun scripts/sealed/custody.ts --init <dir> --url <remote>)`);
  const top = realpathSync(git(c, ['rev-parse', '--show-toplevel']));
  if (top !== realpathSync(c)) throw new RunnerError('HE-SEALED-011', `--custody ${c} is inside the work tree ${top}; the custody clone is its own repository`);
  if (publicRepo) {
    const pub = realpathSync(git(resolve(publicRepo), ['rev-parse', '--show-toplevel']));
    const common = (d: string) => realpathSync(resolve(d, git(d, ['rev-parse', '--git-common-dir'])));
    if (pub === top || common(pub) === common(top) || !relative(pub, top).startsWith('..')) throw new RunnerError('HE-SEALED-011', `--custody ${c} is the public checkout or shares its repository; custody uses an isolated clone`);
  }
  for (const d of PUBLIC_TREES) if (existsSync(join(c, d))) throw new RunnerError('HE-SEALED-011', `--custody ${c} holds ${d}/, a public tree; the custody clone checks out refs/heads/custody only`);
  const head = spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: c, encoding: 'utf8' }).stdout.trim();
  if (head !== CUSTODY_REF) throw new RunnerError('HE-SEALED-011', `--custody ${c} has HEAD at ${head || 'a detached commit'}, not ${CUSTODY_REF}`);
}

/** Make an isolated custody clone at dir from url: the custody branch when the remote has it, else an unborn orphan. */
export function initCustodyClone(dir: string, url: string, publicRepo?: string): void {
  const d = resolve(dir);
  if (existsSync(d)) throw new RunnerError('HE-SEALED-011', `${d} exists; a custody clone is made in a new directory`);
  if (insideGitTree(d)) throw new RunnerError('HE-SEALED-011', `${d} is inside a git work tree; the custody clone is its own repository`);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  git(d, ['init', '-q']);
  git(d, ['remote', 'add', 'origin', url]);
  git(d, ['symbolic-ref', 'HEAD', CUSTODY_REF]);
  syncCustody(d, 'origin');
  checkCustodyClone(d, publicRepo);
}

/** The custody clone a command uses: dir (default DEFAULT_CUSTODY_CLONE), made from the public checkout's remote URL when
 *  it does not exist yet, and checked isolated either way. */
export function custodyClone(o: { dir?: string; repo: string; remote?: string }): string {
  const d = resolve(o.dir ?? DEFAULT_CUSTODY_CLONE);
  const repo = resolve(o.repo), remote = o.remote ?? 'origin';
  if (!existsSync(d)) { checkCustodyRemoteOf(repo, remote); initCustodyClone(d, git(repo, ['remote', 'get-url', remote]), o.repo); }
  checkCustodyClone(d, o.repo);
  checkCustodyRemoteOf(d, 'origin');
  return d;
}

/** checkPrivate asks about CUSTODY_REPO, so a network URL a custody command fetches from or pushes to must name that
 *  repository as its whole owner/name path on an allowed host (CUSTODY_HOSTS: github.com, or git.capy.ai, the git proxy
 *  for it; any port), over https:// or ssh:// (git's scp form is ssh). Any other scheme is refused: http:// and git://
 *  do not authenticate the server, and any other name hands the transfer to a remote helper program. A network URL
 *  holding whitespace, ?, # or a backslash is refused, since git may read its host differently. Local means only a file:// URL, or a path with no scheme and no host: prefix (git's scp form is a colon
 *  before the first slash) that is an existing directory, resolved from cwd (a bare repository on this machine, as the
 *  tests use); it publishes nothing. Everything else, the scp form without a user included, is network. */
export function checkCustodyRemote(url: string, cwd = process.cwd()): string {
  const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  if (/^file:\/\//i.test(url) || (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[^/]*:/.test(url) && isDir(resolve(cwd, url)))) return url;
  const m = /^(?:https|ssh):\/\/(?:[^/@]*@)?([^/:@]+)(?::\d*)?\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url) ?? /^(?:[^/@:]+@)?([^/:@]+):\/?([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  if (/[\s?#\\]/.test(url) || !m || !CUSTODY_HOSTS.includes(m[1]!.toLowerCase()) || m[2] !== CUSTODY_REPO) throw new RunnerError('HE-SEALED-013', `the custody remote URL ${url.replace(/\/\/[^/@]*@/, '//').replace(/^[^/@:]+@/, '')} is not ${CUSTODY_REPO} on ${CUSTODY_HOSTS.join(' or ')} over https or ssh, the repository whose visibility is checked; custody material goes nowhere else. Nothing was read or written`);
  return url;
}

/** Check every URL a fetch or push through remote reaches from the clone. A remote configured in the clone gives all its
 *  fetch and push URLs (git remote get-url --all and --push --all, which expand insteadOf and pushInsteadOf); any other
 *  value is itself the URL or path git uses, plus whatever an insteadOf or pushInsteadOf rule rewrites it to. */
export function checkCustodyRemoteOf(clone: string, remote: string): void {
  const named = git(clone, ['remote']).split('\n').includes(remote);
  const rules = (spawnSync('git', ['config', '--get-regexp', '^url\\..*\\.(pushinsteadof|insteadof)$'], { cwd: clone, encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean);
  const urls = named
    ? [...git(clone, ['remote', 'get-url', '--all', remote]).split('\n'), ...git(clone, ['remote', 'get-url', '--push', '--all', remote]).split('\n')]
    : [remote, ...rules.flatMap((l) => { const [key, prefix = ''] = l.split(' '); return prefix && remote.startsWith(prefix) ? [key!.slice(4, key!.lastIndexOf('.')) + remote.slice(prefix.length)] : []; })];
  for (const u of urls) checkCustodyRemote(u, clone);
}

const heldLocks = new Set<string>();
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const ageMs = (p: string) => { try { return Date.now() - statSync(p).mtimeMs; } catch { return 0; } };
const lockOwner = (lock: string) => { try { const n = Number.parseInt(readFileSync(join(lock, 'pid'), 'utf8'), 10); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; } };
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/**
 * Run fn holding the clone's custody lock: a directory custody.lock in the clone's git directory holding the owner's pid,
 * made atomically with it (a temporary directory with the pid file, renamed to custody.lock only when no lock exists; a
 * rename onto a lock that appeared meanwhile fails, so the lock is held). Another process waits up to waitMs, polling, and takes over a lock whose pid no longer runs
 * (or that has had no pid for 30 s) under a second mkdir guard that rechecks the owner and the staleness, so two waiters
 * never both remove it. Reentrant within one process; released when fn returns or throws.
 */
export function withCustodyLock<T>(clone: string, fn: () => T, waitMs = CUSTODY_LOCK_WAIT_MS): T {
  const lock = join(git(clone, ['rev-parse', '--absolute-git-dir']), 'custody.lock');
  if (heldLocks.has(lock)) return fn();
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (!existsSync(lock)) {
      const fresh = `${lock}.${process.pid}.new`;
      rmSync(fresh, { recursive: true, force: true });
      mkdirSync(fresh);
      writeFileSync(join(fresh, 'pid'), `${process.pid}\n`);
      try { renameSync(fresh, lock); break; } catch (e) { rmSync(fresh, { recursive: true, force: true }); if (!['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    }
    const owner = lockOwner(lock);
    const stale = (o: number | null) => (o === null ? ageMs(lock) > 30_000 : !running(o));
    if (stale(owner)) {
      const guard = `${lock}.takeover`;
      try { mkdirSync(guard); } catch { if (ageMs(guard) > 30_000) rmSync(guard, { recursive: true, force: true }); continue; }
      try { if (lockOwner(lock) === owner && stale(owner)) rmSync(lock, { recursive: true, force: true }); } finally { rmSync(guard, { recursive: true, force: true }); }
      continue;
    }
    if (Date.now() > deadline) throw new RunnerError('HE-SEALED-011', `the custody clone ${clone} is locked by process ${owner ?? '(no pid yet)'} (${lock}) and stayed locked for ${Math.round(waitMs / 1000)} s; another custody command is using this clone. Nothing was read or written; if no custody command is running, remove ${lock}`);
    pause(200);
  }
  heldLocks.add(lock);
  try {
    return fn();
  } finally {
    heldLocks.delete(lock);
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Refuse unless the custody repository is private: the custody branch's ciphertext and escrow are only as hidden as the
 * repository. Asks gh api repos/<repo> for .private; anything but "true" (false, an error, no gh, no answer) refuses.
 */
export function checkPrivate(repo = CUSTODY_REPO, gh = 'gh'): void {
  const r = spawnSync(gh, ['api', `repos/${repo}`, '-q', '.private'], { encoding: 'utf8', timeout: 20_000 });
  const answer = r.status === 0 ? (r.stdout ?? '').trim() : '';
  if (answer === 'true') return;
  if (answer === 'false') throw new RunnerError('HE-SEALED-013', `${repo} is not private; its custody branch would publish the sealed ciphertext and the escrow. Nothing was read or written. Before any visibility change, move or delete the custody branch and re-key (docs/sealed-custody.md, "If the repository is to become public")`);
  throw new RunnerError('HE-SEALED-013', `could not read the visibility of ${repo} (gh api repos/${repo} -q .private ${r.error ? 'did not run' : `exited ${r.status}`}${answer ? ` and answered ${JSON.stringify(answer.slice(0, 40))}` : ''}); an unknown visibility counts as public, so nothing was read or written`);
}

/** Fetch the custody ref and reset the clone to it, holding the clone's lock and after checking every URL of remote.
 *  Returns the remote commit, or null when the remote has no custody branch yet (the clone is then an unborn orphan with
 *  an empty tree). */
export function syncCustody(clone: string, remote: string): string | null {
  return withCustodyLock(clone, () => {
    checkCustodyRemoteOf(clone, remote);
    const ls = spawnSync('git', ['ls-remote', '--exit-code', remote, CUSTODY_REF], { cwd: clone, encoding: 'utf8' });
    if (ls.status === 2) {
      if (spawnSync('git', ['rev-parse', '-q', '--verify', 'HEAD'], { cwd: clone }).status === 0) throw new RunnerError('HE-SEALED-011', `${remote} has no ${CUSTODY_REF} but the clone ${clone} has commits on it; refusing to create the branch from a stale clone`);
      return null;
    }
    if (ls.status !== 0) throw new RunnerError('HE-SEALED-011', `could not read ${CUSTODY_REF} from ${remote} (git ls-remote exit ${ls.status})`);
    git(clone, ['fetch', '-q', remote, `+${CUSTODY_REF}:refs/remotes/${remote}/${CUSTODY_BRANCH}`]);
    git(clone, ['checkout', '-q', '-B', CUSTODY_BRANCH, `refs/remotes/${remote}/${CUSTODY_BRANCH}`]);
    git(clone, ['reset', '-q', '--hard', `refs/remotes/${remote}/${CUSTODY_BRANCH}`]);
    git(clone, ['clean', '-q', '-fdx']);
    return git(clone, ['rev-parse', 'HEAD']);
  });
}

/** What a custody commit may change against its base: access-log.jsonl appended with schema-valid lines; new
 *  <set>/bundle.tar.age and <set>/results/<run_id>.tar.age that are age ciphertext to an X25519 recipient; a new
 *  or replaced escrow/identity.age that is age scrypt ciphertext; README.md as text. Nothing deleted, renamed or re-moded, nothing
 *  else, nothing under a top-level runner/, tasks/ or docs/, and no age identity anywhere. */
export function validateCustodyChange(clone: string, base: string | null, head = 'HEAD'): string[] {
  const problems: string[] = [];
  const blob = (rev: string, p: string) => execFileSync('git', ['cat-file', 'blob', `${rev}:${p}`], { cwd: clone, maxBuffer: 1024 * 1024 * 1024 });
  const changes = base
    ? git(clone, ['diff', '--no-renames', '--name-status', base, head]).split('\n').filter(Boolean).map((l) => { const [s, ...p] = l.split('\t'); return { status: s!, path: p.join('\t') }; })
    : git(clone, ['ls-tree', '-r', '--name-only', head]).split('\n').filter(Boolean).map((p) => ({ status: 'A', path: p }));
  const modes = git(clone, ['ls-tree', '-r', head]).split('\n').filter(Boolean).map((l) => l.split(/\s+/));
  for (const [mode, type, , path] of modes) if (mode !== '100644' || type !== 'blob') problems.push(`${path}: mode ${mode} ${type}; custody holds regular files only`);
  const name = /^[A-Za-z0-9._-]{1,64}$/;
  for (const { status, path } of changes) {
    const parts = path.split('/');
    const data = status === 'D' ? null : blob(head, path);
    if (data && IDENTITY_MARKER.test(data.toString('latin1'))) problems.push(`${path}: holds an age identity`);
    if (path === ACCESS_LOG) {
      if (status !== 'A' && status !== 'M') { problems.push(`${path}: ${status} is not an append`); continue; }
      const before = status === 'M' ? blob(base!, path).toString('utf8') : '';
      const after = data!.toString('utf8');
      if (!after.startsWith(before) || (before && !before.endsWith('\n'))) { problems.push(`${path}: the change is not an append to the existing lines`); continue; }
      const added = after.slice(before.length);
      if (!added.endsWith('\n')) problems.push(`${path}: the appended text does not end in a newline`);
      for (const [i, line] of added.split('\n').filter(Boolean).entries()) for (const p of eventProblems(line)) problems.push(`${path}: appended line ${i + 1}: ${p}`);
      continue;
    }
    if (status !== 'A' && !(status === 'M' && path === ESCROW_FILE)) { problems.push(`${path}: ${status}; custody files are added once and never changed or removed (the escrow alone is replaced, by keygen.ts --re-escrow)`); continue; }
    if (PUBLIC_TREES.includes(parts[0]!)) { problems.push(`${path}: under ${parts[0]}/, a public tree; checkCustodyClone refuses every clone holding it`); continue; }
    const text = data!.subarray(0, 64).toString('latin1');
    const isAge = text.startsWith(AGE_HEADER);
    if ((parts.length === 2 && name.test(parts[0]!) && parts[1] === 'bundle.tar.age') || (parts.length === 3 && name.test(parts[0]!) && parts[1] === 'results' && /^[A-Za-z0-9._-]{1,128}\.tar\.age$/.test(parts[2]!))) {
      if (!isAge || !text.slice(AGE_HEADER.length).startsWith('-> X25519 ')) problems.push(`${path}: not age ciphertext to an X25519 recipient`);
    } else if (path === ESCROW_FILE) {
      if (!isAge || !text.slice(AGE_HEADER.length).startsWith('-> scrypt ')) problems.push(`${path}: not age scrypt ciphertext`);
    } else if (path === 'README.md') {
      if (data!.includes(0)) problems.push(`${path}: not text`);
    } else problems.push(`${path}: not a file the custody branch holds (access-log.jsonl, <set>/bundle.tar.age, <set>/results/<run_id>.tar.age, ${ESCROW_FILE}, README.md)`);
  }
  return problems;
}

export function readAccessLog(clone: string): AccessEvent[] {
  const p = join(clone, ACCESS_LOG);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as AccessEvent);
}

/** The first "opened" line per run of one set, with the sha256 of the line as it stands in the log. */
export function openedRuns(clone: string, set: string): Map<string, { event: AccessEvent; sha256: string }> {
  const out = new Map<string, { event: AccessEvent; sha256: string }>();
  const p = join(clone, ACCESS_LOG);
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())) {
    const e = JSON.parse(line) as AccessEvent;
    if (e.set === set && e.event === 'opened' && !out.has(e.run_id)) out.set(e.run_id, { event: e, sha256: sha256(line) });
  }
  return out;
}

/**
 * One custody transaction, holding the clone's lock from the sync through the push (withCustodyLock; lockWaitMs bounds the
 * wait for another process, default CUSTODY_LOCK_WAIT_MS): sync the clone to the custody ref (checking every URL of the
 * remote), let decide() read the current state and return the line to append (or throw to refuse), write it with any files
 * stage() adds, commit, validate that commit against the synced base, and push its sha to refs/heads/custody without
 * force. Returns the pushed commit. A rejected push syncs and decides again, up to five times.
 */
export function compareAndPush(clone: string, o: { remote?: string; message: (e: AccessEvent) => string; decide: () => AccessEvent; stage?: () => string[]; beforePush?: () => void; onFailure?: string; lockWaitMs?: number }): { event: AccessEvent; line: string; sha256: string; commit: string } {
  const remote = o.remote ?? 'origin';
  return withCustodyLock(clone, () => {
    const attempts = 5;
    let last = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const base = syncCustody(clone, remote);
      const event = o.decide();
      const line = JSON.stringify(event);
      const lineProblems = eventProblems(line);
      if (lineProblems.length) throw new RunnerError('HE-SEALED-011', `the access-log line is invalid: ${lineProblems.join('; ')}`);
      const p = join(clone, ACCESS_LOG);
      const before = existsSync(p) ? readFileSync(p, 'utf8') : '';
      writeFileSync(p, before + (before && !before.endsWith('\n') ? '\n' : '') + line + '\n');
      const extra = o.stage?.() ?? [];
      git(clone, ['add', '--', ACCESS_LOG, ...extra]);
      git(clone, ['commit', '-q', '-m', o.message(event)]);
      const commit = git(clone, ['rev-parse', 'HEAD']);
      const problems = validateCustodyChange(clone, base, commit);
      if (problems.length) throw new RunnerError('HE-SEALED-011', `the custody commit would change what the custody branch may not hold: ${problems.slice(0, 5).join('; ')}; nothing was pushed`);
      o.beforePush?.();
      const push = spawnSync('git', ['push', '-q', '--no-force-with-lease', remote, `${commit}:${CUSTODY_REF}`], { cwd: clone, encoding: 'utf8' });
      if (push.status === 0) return { event, line, sha256: sha256(line), commit };
      last = (push.stderr || '').trim().split('\n').pop() ?? '';
    }
    throw new RunnerError('HE-SEALED-006', `the push to ${remote} ${CUSTODY_REF} was rejected ${attempts} times (${last}); ${o.onFailure ?? 'nothing was decrypted'}`);
  }, o.lockWaitMs);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    if (flag('init')) {
      if (!flag('url')) throw new RunnerError('HE-RUN-002', 'usage: bun scripts/sealed/custody.ts --init <dir> --url <remote url> [--repo <public checkout>]');
      initCustodyClone(flag('init')!, flag('url')!, flag('repo'));
      console.log(`CUSTODY: isolated clone ${resolve(flag('init')!)} on ${CUSTODY_REF}`);
    } else if (flag('validate')) {
      const problems = validateCustodyChange(resolve(flag('validate')!), flag('base') ?? null);
      if (problems.length) { console.error(`HE-SEALED-011 ${problems.join('\n  ')}`); process.exit(1); }
      console.log('CUSTODY: the change holds only validated ciphertext and schema-checked access-log appends');
    } else throw new RunnerError('HE-RUN-002', 'usage: bun scripts/sealed/custody.ts --init <dir> --url <remote url> | --validate <clone> [--base <commit>]');
  } catch (e) {
    console.error(e instanceof RunnerError ? e.message : `HE-SEALED-011 ${e instanceof Error ? e.constructor.name : 'error'} (message withheld)`);
    process.exit(2);
  }
}
